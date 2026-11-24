import { Emitter, type Event } from '@app/base/common/event'
import { Disposable, MutableDisposable } from '@app/base/common/lifecycle'
import { buildRadioDirectory, RADIO_DIRECTORY_SOURCE_URL } from '../common/directoryBuilder'
import {
  EMPTY_RADIO_SNAPSHOT,
  type IRadioService,
  RADIO_SAMPLE_RATE,
  type RadioAudioChunk,
  type RadioCall,
  type RadioConnectionState,
  type RadioDirectorySnapshot,
  type RadioLogEntry,
  type RadioRepeaterTalkgroup,
  type RadioStateSnapshot,
} from '../common/radio'
import { parseRepeaterTalkgroups } from '../common/repeaterTalkgroups'
import { pcmToBytes } from '../common/ulaw'
import { createChromeUserAgent } from './chromeUserAgent'
import { HoselineClient } from './hoselineClient'

const AUDIO_CHUNK_SAMPLES = Math.round(RADIO_SAMPLE_RATE / 10)
const STATE_PUBLISH_INTERVAL_MS = 500
const MIN_LOGGED_CALL_DURATION_MS = 500
const MAX_RECENT_CALLS = 30
const DIRECTORY_CACHE_TTL_MS = 10 * 60 * 1000
const REPEATER_TALKGROUP_CACHE_TTL_MS = 10 * 60 * 1000
const TALKGROUP_NAME_CACHE_TTL_MS = 24 * 60 * 60 * 1000
const DIRECTORY_REQUEST_TIMEOUT_MS = 30_000
const REPEATER_TALKGROUP_SOURCE_URL = 'https://api.brandmeister.network/v2/device'
const TALKGROUP_NAME_SOURCE_URL = 'https://api.brandmeister.network/v2/talkgroup'

export class RadioMainService extends Disposable implements IRadioService {
  declare readonly _serviceBrand: undefined

  private readonly _onDidChangeState = this._register(new Emitter<RadioStateSnapshot>())
  readonly onDidChangeState: Event<RadioStateSnapshot> = this._onDidChangeState.event

  private readonly _onDidReceiveAudio = this._register(new Emitter<RadioAudioChunk>())
  readonly onDidReceiveAudio: Event<RadioAudioChunk> = this._onDidReceiveAudio.event

  private readonly _onDidReceiveLog = this._register(new Emitter<RadioLogEntry>())
  readonly onDidReceiveLog: Event<RadioLogEntry> = this._onDidReceiveLog.event

  private readonly clientSlot = this._register(new MutableDisposable<HoselineClient>())

  private connectionState: RadioConnectionState = 'idle'
  private talkgroups: number[] = []
  private activeCalls = new Map<number, RadioCall>()
  private currentCall: RadioCall | null = null
  private recentCalls: RadioLogEntry[] = []
  private lastAudioAt: number | null = null
  private connectedAt: number | null = null
  private lastError: string | null = null
  private lastStatePublishAt = 0

  private pendingPcm: Int16Array[] = []
  private pendingSamples = 0
  private pendingTalkgroup: number | null = null

  private directory: RadioDirectorySnapshot | null = null
  private directoryRequest: Promise<RadioDirectorySnapshot> | null = null
  private readonly repeaterTalkgroups = new Map<
    string,
    { readonly talkgroups: readonly RadioRepeaterTalkgroup[]; readonly fetchedAt: number }
  >()
  private talkgroupNames: {
    readonly names: ReadonlyMap<number, string>
    readonly fetchedAt: number
  } | null = null
  private talkgroupNamesRequest: Promise<ReadonlyMap<number, string>> | null = null

  async getSnapshot(): Promise<RadioStateSnapshot> {
    return this.createSnapshot()
  }

  async getDirectory(): Promise<RadioDirectorySnapshot> {
    if (this.directory && Date.now() - this.directory.fetchedAt < DIRECTORY_CACHE_TTL_MS) {
      return this.directory
    }
    if (this.directoryRequest) {
      return this.directoryRequest
    }

    const request = this.loadDirectory().finally(() => {
      if (this.directoryRequest === request) {
        this.directoryRequest = null
      }
    })
    this.directoryRequest = request
    return request
  }

  async getRepeaterTalkgroups(deviceId: string): Promise<readonly RadioRepeaterTalkgroup[]> {
    const cached = this.repeaterTalkgroups.get(deviceId)
    if (cached && Date.now() - cached.fetchedAt < REPEATER_TALKGROUP_CACHE_TTL_MS) {
      return cached.talkgroups
    }

    try {
      const [payload, names] = await Promise.all([
        this.fetchJson(
          `${REPEATER_TALKGROUP_SOURCE_URL}/${encodeURIComponent(deviceId)}/talkgroup`,
        ),
        this.getTalkgroupNames(),
      ])
      const talkgroups = parseRepeaterTalkgroups(payload, names)
      this.repeaterTalkgroups.set(deviceId, { talkgroups, fetchedAt: Date.now() })
      return talkgroups
    } catch (error) {
      if (cached) {
        return cached.talkgroups
      }
      throw error
    }
  }

  async connect(talkgroups: readonly number[]): Promise<RadioStateSnapshot> {
    const uniqueTalkgroups = Array.from(new Set(talkgroups))
    if (uniqueTalkgroups.length === 0) {
      return this.disconnect()
    }

    if (this.connectionState === 'connected' && sameTalkgroups(uniqueTalkgroups, this.talkgroups)) {
      return this.createSnapshot()
    }

    this.clientSlot.clear()
    this.finishCurrentCall(Date.now())
    this.flushAudio()
    this.activeCalls.clear()
    this.connectedAt = null
    this.lastError = null
    this.talkgroups = uniqueTalkgroups
    this.connectionState = 'connecting'
    this.publishState()

    const client = new HoselineClient({
      onStateChange: (state, lastError) => this.handleConnectionState(state, lastError),
      onCallStart: (sourceId, talkgroup) => this.handleCallStart(sourceId, talkgroup),
      onCallAlias: (alias) => this.handleCallAlias(alias),
      onCallEnd: () => this.handleCallEnd(),
      onAudio: (pcm, talkgroup) => this.handleAudio(pcm, talkgroup),
    })
    this.clientSlot.value = client
    client.connect(uniqueTalkgroups)

    return this.createSnapshot()
  }

  async disconnect(): Promise<RadioStateSnapshot> {
    this.clientSlot.clear()
    this.finishCurrentCall(Date.now())
    this.flushAudio()
    this.activeCalls.clear()
    this.connectionState = 'idle'
    this.connectedAt = null
    this.lastError = null
    this.talkgroups = []
    this.publishState()
    return this.createSnapshot()
  }

  override dispose(): void {
    this.clientSlot.clear()
    this.flushAudio()
    super.dispose()
  }

  private handleConnectionState(state: RadioConnectionState, lastError: string | null): void {
    if (this.isDisposed) {
      return
    }

    if (state === 'connected') {
      this.connectedAt = Date.now()
      this.lastError = null
    } else {
      this.connectedAt = null
      if (state === 'reconnecting' || state === 'error' || state === 'idle') {
        this.finishCurrentCall(Date.now())
        this.flushAudio()
        this.activeCalls.clear()
      }
      if (lastError) {
        this.lastError = lastError
      }
    }

    this.connectionState = state
    this.publishState()
  }

  private handleCallStart(sourceId: number | null, talkgroup: number | null): void {
    if (this.isDisposed) {
      return
    }

    const now = Date.now()
    this.finishCurrentCall(now)

    const call: RadioCall = {
      id: `${talkgroup ?? 'unknown'}-${now}-${sourceId ?? 0}`,
      talkgroup,
      sourceId,
      callsign: null,
      startedAt: now,
      lastAudioAt: null,
    }
    this.currentCall = call
    if (talkgroup !== null) {
      this.activeCalls.set(talkgroup, call)
    }
    this.publishState()
  }

  private handleCallAlias(alias: string): void {
    if (this.isDisposed || !this.currentCall) {
      return
    }

    const call: RadioCall = { ...this.currentCall, callsign: alias }
    this.currentCall = call
    if (call.talkgroup !== null) {
      this.activeCalls.set(call.talkgroup, call)
    }
    this.publishState()
  }

  private handleCallEnd(): void {
    if (this.isDisposed) {
      return
    }
    this.finishCurrentCall(Date.now())
    this.flushAudio()
    this.publishState()
  }

  private handleAudio(pcm: Int16Array, talkgroup: number | null): void {
    if (this.isDisposed) {
      return
    }

    const now = Date.now()
    this.lastAudioAt = now

    if (this.currentCall) {
      const call: RadioCall = { ...this.currentCall, lastAudioAt: now }
      this.currentCall = call
      if (call.talkgroup !== null) {
        this.activeCalls.set(call.talkgroup, call)
      }
    }

    this.queueAudio(pcm, talkgroup)
    this.publishStateThrottled()
  }

  private queueAudio(pcm: Int16Array, talkgroup: number | null): void {
    if (this.pendingSamples > 0 && this.pendingTalkgroup !== talkgroup) {
      this.flushAudio()
    }

    this.pendingTalkgroup = talkgroup
    this.pendingPcm.push(pcm)
    this.pendingSamples += pcm.length

    if (this.pendingSamples >= AUDIO_CHUNK_SAMPLES) {
      this.flushAudio()
    }
  }

  private flushAudio(): void {
    if (this.pendingSamples === 0) {
      return
    }

    const combined = new Int16Array(this.pendingSamples)
    let offset = 0
    for (const chunk of this.pendingPcm) {
      combined.set(chunk, offset)
      offset += chunk.length
    }

    this.pendingPcm = []
    this.pendingSamples = 0

    this._onDidReceiveAudio.fire({
      talkgroup: this.pendingTalkgroup,
      sampleRate: RADIO_SAMPLE_RATE,
      pcm: pcmToBytes(combined),
    })
  }

  private finishCurrentCall(now: number): void {
    const call = this.currentCall
    if (!call) {
      return
    }

    this.currentCall = null
    if (call.talkgroup !== null) {
      const active = this.activeCalls.get(call.talkgroup)
      if (active?.id === call.id) {
        this.activeCalls.delete(call.talkgroup)
      }
    }

    const durationMs = Math.max(0, now - call.startedAt)
    if (durationMs < MIN_LOGGED_CALL_DURATION_MS) {
      return
    }

    const entry: RadioLogEntry = {
      id: call.id,
      talkgroup: call.talkgroup,
      sourceId: call.sourceId,
      callsign: call.callsign,
      startedAt: call.startedAt,
      endedAt: now,
      durationMs,
    }
    this.recentCalls = [entry, ...this.recentCalls].slice(0, MAX_RECENT_CALLS)
    this._onDidReceiveLog.fire(entry)
  }

  private publishStateThrottled(): void {
    const now = Date.now()
    if (now - this.lastStatePublishAt < STATE_PUBLISH_INTERVAL_MS) {
      return
    }
    this.publishState()
  }

  private publishState(): void {
    if (this.isDisposed) {
      return
    }
    this.lastStatePublishAt = Date.now()
    this._onDidChangeState.fire(this.createSnapshot())
  }

  private createSnapshot(): RadioStateSnapshot {
    const activeCalls = [...this.activeCalls.values()].sort(
      (left, right) => left.startedAt - right.startedAt,
    )
    if (this.currentCall && this.currentCall.talkgroup === null) {
      activeCalls.push(this.currentCall)
    }

    return {
      ...EMPTY_RADIO_SNAPSHOT,
      state: this.connectionState,
      talkgroups: [...this.talkgroups],
      activeCalls,
      recentCalls: [...this.recentCalls],
      lastAudioAt: this.lastAudioAt,
      connectedAt: this.connectedAt,
      lastError: this.lastError,
    }
  }

  private async getTalkgroupNames(): Promise<ReadonlyMap<number, string>> {
    if (
      this.talkgroupNames &&
      Date.now() - this.talkgroupNames.fetchedAt < TALKGROUP_NAME_CACHE_TTL_MS
    ) {
      return this.talkgroupNames.names
    }
    if (this.talkgroupNamesRequest) {
      return this.talkgroupNamesRequest
    }

    const request = this.loadTalkgroupNames().finally(() => {
      if (this.talkgroupNamesRequest === request) {
        this.talkgroupNamesRequest = null
      }
    })
    this.talkgroupNamesRequest = request
    return request
  }

  private async loadTalkgroupNames(): Promise<ReadonlyMap<number, string>> {
    try {
      const payload = await this.fetchJson(TALKGROUP_NAME_SOURCE_URL)
      const names = new Map<number, string>()
      if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        for (const [key, value] of Object.entries(payload)) {
          const talkgroup = Number(key)
          if (
            Number.isInteger(talkgroup) &&
            talkgroup > 0 &&
            typeof value === 'string' &&
            value.trim().length > 0
          ) {
            names.set(talkgroup, value.trim())
          }
        }
      }
      this.talkgroupNames = { names, fetchedAt: Date.now() }
      return names
    } catch {
      return this.talkgroupNames?.names ?? new Map()
    }
  }

  private async fetchJson(url: string): Promise<unknown> {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': createChromeUserAgent(),
      },
      signal: AbortSignal.timeout(DIRECTORY_REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) {
      throw new Error(`BrandMeister request failed (${response.status}).`)
    }
    return response.json()
  }

  private async loadDirectory(): Promise<RadioDirectorySnapshot> {
    try {
      const response = await fetch(RADIO_DIRECTORY_SOURCE_URL, {
        headers: {
          Accept: 'application/json',
          'User-Agent': createChromeUserAgent(),
        },
        signal: AbortSignal.timeout(DIRECTORY_REQUEST_TIMEOUT_MS),
      })
      if (!response.ok) {
        throw new Error(`BrandMeister directory request failed (${response.status}).`)
      }
      const payload: unknown = await response.json()
      if (!Array.isArray(payload)) {
        throw new Error('BrandMeister directory response is not a list.')
      }
      const snapshot = buildRadioDirectory(payload, Date.now())
      this.directory = snapshot
      return snapshot
    } catch (error) {
      if (this.directory) {
        return this.directory
      }
      throw error
    }
  }
}

function sameTalkgroups(left: readonly number[], right: readonly number[]): boolean {
  return (
    left.length === right.length && left.every((talkgroup, index) => talkgroup === right[index])
  )
}
