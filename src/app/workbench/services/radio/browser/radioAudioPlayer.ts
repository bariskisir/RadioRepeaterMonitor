import { Emitter, type Event } from '@app/base/common/event'
import { Disposable } from '@app/base/common/lifecycle'
import { clamp } from '@app/base/common/number'
import { addDisposableListener } from '@app/base/browser/dom'
import { InstantiationType, registerSingleton } from '@app/platform/instantiation/common/extensions'
import { createDecorator } from '@app/platform/instantiation/common/instantiation'
import { RADIO_SAMPLE_RATE, type RadioAudioChunk } from '@app/platform/radio/common/radio'
import { IWorkbenchRadioService } from './radioWorkbenchService'

export type RadioAudioContextState = 'uninitialized' | 'suspended' | 'running' | 'unsupported'

export interface RadioAudioPlayerState {
  readonly contextState: RadioAudioContextState
  readonly level: number
  readonly volume: number
  readonly muted: boolean
}

export interface IRadioAudioPlayer {
  readonly _serviceBrand: undefined
  readonly state: RadioAudioPlayerState
  readonly onDidChangeState: Event<RadioAudioPlayerState>
  unlock(): Promise<void>
  setVolume(volume: number): void
  setMuted(muted: boolean): void
}

export const IRadioAudioPlayer = createDecorator<IRadioAudioPlayer>('radioAudioPlayer')

type AudioContextConstructor = new (options?: AudioContextOptions) => AudioContext

const JITTER_BUFFER_SECONDS = 0.32
const MAX_BUFFER_SECONDS = 2.4
const FADE_SECONDS = 0.006
const SILENCE_RESET_MS = 700
const AUDIO_PROCESSOR_SIZE = 1024

function getAudioContextConstructor(): AudioContextConstructor | null {
  if (typeof AudioContext !== 'undefined') {
    return AudioContext
  }
  const legacy = (globalThis as { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext
  return legacy ?? null
}

function toInt16Array(pcm: Uint8Array): Int16Array {
  if (pcm.byteLength < 2) {
    return new Int16Array(0)
  }
  const length = Math.floor(pcm.byteLength / 2)
  return new Int16Array(pcm.buffer, pcm.byteOffset, length)
}

function computeLevel(pcm: Int16Array): number {
  if (pcm.length === 0) {
    return 0
  }
  let sum = 0
  for (const sample of pcm) {
    const normalized = sample / 32768
    sum += normalized * normalized
  }
  return Math.sqrt(sum / pcm.length)
}

export class RadioAudioPlayer extends Disposable implements IRadioAudioPlayer {
  declare readonly _serviceBrand: undefined

  private readonly _onDidChangeState = this._register(new Emitter<RadioAudioPlayerState>())
  readonly onDidChangeState: Event<RadioAudioPlayerState> = this._onDidChangeState.event

  private context: AudioContext | null = null
  private gainNode: GainNode | null = null
  private processor: ScriptProcessorNode | null = null
  private ringBuffer: Float32Array | null = null
  private ringRead = 0
  private ringWrite = 0
  private ringCount = 0
  private playbackActive = false
  private fadeInRemaining = 0
  private fadeSamples = 0
  private prebufferSamples = 0
  private lastAudioAt = 0
  private lastChunkAt = 0
  private lastLevelEmit = 0
  private currentLevel = 0
  private _state: RadioAudioPlayerState = {
    contextState: 'uninitialized',
    level: 0,
    volume: 0.85,
    muted: false,
  }

  constructor(@IWorkbenchRadioService radioService: IWorkbenchRadioService) {
    super()

    this._register(
      radioService.onDidReceiveAudio((chunk) => {
        this.handleAudio(chunk)
      }),
    )

    if (typeof window !== 'undefined') {
      this._register(
        addDisposableListener(
          window,
          'pointerdown',
          () => {
            void this.unlock()
          },
          { once: true },
        ),
      )
    }

    const decayTimer = setInterval(() => {
      if (this.isDisposed || this.currentLevel === 0) {
        return
      }
      if (Date.now() - this.lastAudioAt < 350) {
        return
      }
      this.currentLevel = Math.max(0, this.currentLevel * 0.72)
      if (this.currentLevel < 0.004) {
        this.currentLevel = 0
      }
      this.emitState()
    }, 120)
    this._register({
      dispose: () => clearInterval(decayTimer),
    })
  }

  get state(): RadioAudioPlayerState {
    return this._state
  }

  async unlock(): Promise<void> {
    if (!this.context || this.context.state === 'closed') {
      const AudioContextCtor = getAudioContextConstructor()
      if (!AudioContextCtor) {
        this.updateState({ contextState: 'unsupported' })
        return
      }
      try {
        let context: AudioContext
        try {
          context = new AudioContextCtor({
            sampleRate: RADIO_SAMPLE_RATE,
            latencyHint: 'interactive',
          })
        } catch {
          context = new AudioContextCtor({ latencyHint: 'interactive' })
        }
        this.context = context
        this.gainNode = context.createGain()
        this.gainNode.gain.value = this._state.muted ? 0 : this._state.volume
        this.gainNode.connect(context.destination)
        this.ringBuffer = new Float32Array(Math.ceil(context.sampleRate * MAX_BUFFER_SECONDS))
        this.ringRead = 0
        this.ringWrite = 0
        this.ringCount = 0
        this.playbackActive = false
        this.fadeSamples = Math.max(1, Math.round(context.sampleRate * FADE_SECONDS))
        this.prebufferSamples = Math.round(context.sampleRate * JITTER_BUFFER_SECONDS)
        this.processor = context.createScriptProcessor(AUDIO_PROCESSOR_SIZE, 0, 1)
        this.processor.onaudioprocess = (event) => this.processAudio(event)
        this.processor.connect(this.gainNode)
        context.onstatechange = () => {
          if (!this.context || this.context.state === 'closed') {
            return
          }
          this.updateState({
            contextState: this.context.state === 'running' ? 'running' : 'suspended',
          })
        }
      } catch {
        this.releaseAudioGraph()
        this.updateState({ contextState: 'unsupported' })
        return
      }
    }

    if (this.context.state === 'suspended') {
      try {
        await this.context.resume()
      } catch {
        this.updateState({ contextState: 'suspended' })
        return
      }
    }

    this.updateState({ contextState: this.context.state === 'running' ? 'running' : 'suspended' })
  }

  setVolume(volume: number): void {
    const nextVolume = clamp(volume, 0, 1)
    if (this._state.volume === nextVolume) {
      return
    }
    this._state = { ...this._state, volume: nextVolume }
    this.applyGain()
    this.emitState()
  }

  setMuted(muted: boolean): void {
    if (this._state.muted === muted) {
      return
    }
    this._state = { ...this._state, muted }
    this.applyGain()
    this.emitState()
  }

  override dispose(): void {
    this.releaseAudioGraph()
    super.dispose()
  }

  private handleAudio(chunk: RadioAudioChunk): void {
    if (this.isDisposed) {
      return
    }

    const pcm = toInt16Array(chunk.pcm)
    if (pcm.length === 0) {
      return
    }

    const now = Date.now()
    if (now - this.lastChunkAt > SILENCE_RESET_MS) {
      this.resetPlaybackBuffer()
    }
    this.lastChunkAt = now
    this.lastAudioAt = now

    const level = computeLevel(pcm)
    this.currentLevel = Math.max(level, this.currentLevel * 0.75)
    if (now - this.lastLevelEmit >= 80) {
      this.emitState()
    }

    if (!this.context || !this.ringBuffer || !this.gainNode) {
      return
    }

    this.writeChunk(pcm, chunk.sampleRate)
  }

  private writeChunk(pcm: Int16Array, sampleRate: number): void {
    const targetRate = this.context?.sampleRate ?? sampleRate
    if (targetRate === sampleRate) {
      for (const sample of pcm) {
        this.writeSample(sample / 32768)
      }
      return
    }

    const ratio = sampleRate / targetRate
    const length = Math.max(1, Math.round(pcm.length * ratio))
    for (let index = 0; index < length; index += 1) {
      const position = index / ratio
      const lower = Math.min(Math.floor(position), pcm.length - 1)
      const upper = Math.min(lower + 1, pcm.length - 1)
      const fraction = position - lower
      const sample = (pcm[lower] ?? 0) * (1 - fraction) + (pcm[upper] ?? 0) * fraction
      this.writeSample(sample / 32768)
    }
  }

  private writeSample(sample: number): void {
    const ring = this.ringBuffer
    if (!ring) {
      return
    }
    if (this.ringCount >= ring.length) {
      this.ringRead = (this.ringRead + 1) % ring.length
      this.ringCount -= 1
    }
    ring[this.ringWrite] = sample
    this.ringWrite = (this.ringWrite + 1) % ring.length
    this.ringCount += 1
  }

  private readSample(): number {
    const ring = this.ringBuffer
    if (!ring || this.ringCount <= 0) {
      return 0
    }
    const sample = ring[this.ringRead] ?? 0
    this.ringRead = (this.ringRead + 1) % ring.length
    this.ringCount -= 1
    return sample
  }

  private resetPlaybackBuffer(): void {
    this.playbackActive = false
    this.fadeInRemaining = 0
    this.ringRead = this.ringWrite
    this.ringCount = 0
  }

  private processAudio(event: AudioProcessingEvent): void {
    const channel = event.outputBuffer.getChannelData(0)
    channel.fill(0)

    if (!this.ringBuffer) {
      return
    }

    if (!this.playbackActive) {
      if (this.ringCount < this.prebufferSamples) {
        return
      }
      this.playbackActive = true
      this.fadeInRemaining = this.fadeSamples
    }

    const available = Math.min(this.ringCount, channel.length)
    const underrun = this.ringCount < channel.length + this.fadeSamples
    for (let index = 0; index < available; index += 1) {
      let sample = this.readSample()
      if (this.fadeInRemaining > 0) {
        sample *= 1 - this.fadeInRemaining / this.fadeSamples
        this.fadeInRemaining -= 1
      }
      if (underrun) {
        const remaining = available - index
        if (remaining < this.fadeSamples) {
          sample *= remaining / this.fadeSamples
        }
      }
      channel[index] = sample
    }

    if (underrun) {
      this.resetPlaybackBuffer()
    }
  }

  private applyGain(): void {
    if (!this.gainNode) {
      return
    }
    const target = this._state.muted ? 0 : this._state.volume
    if (this.context) {
      const now = this.context.currentTime
      this.gainNode.gain.cancelScheduledValues(now)
      this.gainNode.gain.setTargetAtTime(target, now, 0.012)
    } else {
      this.gainNode.gain.value = target
    }
  }

  private releaseAudioGraph(): void {
    if (this.processor) {
      this.processor.onaudioprocess = null
      this.processor.disconnect()
      this.processor = null
    }
    if (this.gainNode) {
      this.gainNode.disconnect()
      this.gainNode = null
    }
    if (this.context && this.context.state !== 'closed') {
      void this.context.close().catch(() => undefined)
    }
    this.context = null
    this.ringBuffer = null
    this.ringRead = 0
    this.ringWrite = 0
    this.ringCount = 0
    this.playbackActive = false
    this.fadeInRemaining = 0
  }

  private updateState(patch: Partial<RadioAudioPlayerState>): void {
    this._state = { ...this._state, ...patch }
    this.emitState()
  }

  private emitState(): void {
    if (this.isDisposed) {
      return
    }
    this.lastLevelEmit = Date.now()
    this._state = { ...this._state, level: this.currentLevel }
    this._onDidChangeState.fire(this._state)
  }
}

registerSingleton(IRadioAudioPlayer, RadioAudioPlayer, InstantiationType.Eager)
