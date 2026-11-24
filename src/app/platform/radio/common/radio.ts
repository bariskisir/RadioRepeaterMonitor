import type { Event } from '@app/base/common/event'
import { createDecorator } from '@app/platform/instantiation/common/instantiation'

export const RADIO_SAMPLE_RATE = 8000

export const RADIO_CONNECTION_STATES = [
  'idle',
  'connecting',
  'connected',
  'reconnecting',
  'error',
] as const

export type RadioConnectionState = (typeof RADIO_CONNECTION_STATES)[number]

export interface RadioCall {
  readonly id: string
  readonly talkgroup: number | null
  readonly sourceId: number | null
  readonly callsign: string | null
  readonly startedAt: number
  readonly lastAudioAt: number | null
}

export interface RadioLogEntry {
  readonly id: string
  readonly talkgroup: number | null
  readonly sourceId: number | null
  readonly callsign: string | null
  readonly startedAt: number
  readonly endedAt: number
  readonly durationMs: number
}

export interface RadioStateSnapshot {
  readonly state: RadioConnectionState
  readonly talkgroups: readonly number[]
  readonly activeCalls: readonly RadioCall[]
  readonly recentCalls: readonly RadioLogEntry[]
  readonly lastAudioAt: number | null
  readonly connectedAt: number | null
  readonly lastError: string | null
}

export interface RadioAudioChunk {
  readonly talkgroup: number | null
  readonly sampleRate: number
  readonly pcm: Uint8Array
}

export interface RadioDirectoryRepeater {
  readonly deviceId: string
  readonly callsign: string
  readonly city: string
  readonly txMhz: string
  readonly rxMhz: string
  readonly band: string
  readonly status: number
  readonly lastSeen: string
}

export interface RadioRepeaterTalkgroup {
  readonly talkgroup: number
  readonly slot: number
  readonly name: string
}

export interface RadioDirectoryCity {
  readonly name: string
  readonly repeaters: readonly RadioDirectoryRepeater[]
}

export interface RadioDirectoryCountry {
  readonly code: string
  readonly name: string
  readonly iso: string | null
  readonly mccCodes: readonly string[]
  readonly cities: readonly RadioDirectoryCity[]
  readonly repeaterCount: number
  readonly onlineCount: number
}

export interface RadioDirectorySnapshot {
  readonly countries: readonly RadioDirectoryCountry[]
  readonly fetchedAt: number
  readonly totalRepeaters: number
  readonly totalOnline: number
  readonly sourceUrl: string
}

export const EMPTY_RADIO_DIRECTORY: RadioDirectorySnapshot = {
  countries: [],
  fetchedAt: 0,
  totalRepeaters: 0,
  totalOnline: 0,
  sourceUrl: 'https://api.brandmeister.network/v2/device',
}

export const EMPTY_RADIO_SNAPSHOT: RadioStateSnapshot = {
  state: 'idle',
  talkgroups: [],
  activeCalls: [],
  recentCalls: [],
  lastAudioAt: null,
  connectedAt: null,
  lastError: null,
}

export interface IRadioService {
  readonly _serviceBrand: undefined
  readonly onDidChangeState: Event<RadioStateSnapshot>
  readonly onDidReceiveAudio: Event<RadioAudioChunk>
  readonly onDidReceiveLog: Event<RadioLogEntry>
  getSnapshot(): Promise<RadioStateSnapshot>
  getDirectory(): Promise<RadioDirectorySnapshot>
  getRepeaterTalkgroups(deviceId: string): Promise<readonly RadioRepeaterTalkgroup[]>
  connect(talkgroups: readonly number[]): Promise<RadioStateSnapshot>
  disconnect(): Promise<RadioStateSnapshot>
}

export const IRadioService = createDecorator<IRadioService>('radioService')
