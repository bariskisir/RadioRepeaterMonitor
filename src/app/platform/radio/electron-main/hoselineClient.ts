import { Disposable } from '@app/base/common/lifecycle'
import { decode, encode } from '@msgpack/msgpack'
import WebSocket, { type RawData } from 'ws'
import { HOSELINE_FRAME, HOSELINE_URL, parseHoselineFrame } from '../common/hoselineProtocol'
import type { RadioConnectionState } from '../common/radio'
import { decodeUlawToPcm } from '../common/ulaw'
import { createChromeUserAgent } from './chromeUserAgent'

const INITIAL_RECONNECT_DELAY_MS = 2_000
const MAX_RECONNECT_DELAY_MS = 30_000

export interface HoselineClientHandlers {
  readonly onStateChange: (state: RadioConnectionState, lastError: string | null) => void
  readonly onCallStart: (sourceId: number | null, talkgroup: number | null) => void
  readonly onCallAlias: (alias: string) => void
  readonly onCallEnd: () => void
  readonly onAudio: (pcm: Int16Array, talkgroup: number | null) => void
}

export class HoselineClient extends Disposable {
  private socket: WebSocket | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private reconnectAttempt = 0
  private talkgroups: readonly number[] = []
  private currentTalkgroup: number | null = null
  private closedByUser = false
  private hasConnectedOnce = false
  private lastError: string | null = null

  constructor(private readonly handlers: HoselineClientHandlers) {
    super()
  }

  connect(talkgroups: readonly number[]): void {
    this.closedByUser = false
    this.talkgroups = [...talkgroups]
    this.reconnectAttempt = 0
    this.hasConnectedOnce = false
    this.lastError = null
    this.closeSocket()
    this.openSocket()
  }

  disconnect(): void {
    this.closedByUser = true
    this.clearReconnectTimer()
    this.closeSocket()
    this.handlers.onStateChange('idle', null)
  }

  override dispose(): void {
    this.closedByUser = true
    this.clearReconnectTimer()
    this.closeSocket()
    super.dispose()
  }

  private openSocket(): void {
    if (this.closedByUser || this.isDisposed) {
      return
    }

    this.handlers.onStateChange(
      this.hasConnectedOnce ? 'reconnecting' : 'connecting',
      this.lastError,
    )

    const socket = new WebSocket(HOSELINE_URL, ['spotter'], {
      handshakeTimeout: 15_000,
      headers: {
        'User-Agent': createChromeUserAgent(),
      },
    })
    this.socket = socket

    socket.on('open', () => {
      if (this.socket !== socket || this.closedByUser || this.isDisposed) {
        socket.close()
        return
      }
      this.hasConnectedOnce = true
      this.reconnectAttempt = 0
      this.lastError = null
      socket.send(encode([HOSELINE_FRAME.groupJoin, [...this.talkgroups]]))
      this.handlers.onStateChange('connected', null)
    })

    socket.on('message', (data: RawData, isBinary: boolean) => {
      if (this.socket !== socket || !isBinary) {
        return
      }
      this.handleMessage(data)
    })

    socket.on('error', (error: Error) => {
      if (this.socket !== socket) {
        return
      }
      this.lastError = error.message
    })

    socket.on('close', () => {
      if (this.socket !== socket) {
        return
      }
      this.socket = null
      this.currentTalkgroup = null
      this.handlers.onCallEnd()
      if (!this.closedByUser && !this.isDisposed) {
        this.scheduleReconnect()
      }
    })
  }

  private handleMessage(data: RawData): void {
    let decoded: unknown
    try {
      const buffer = Array.isArray(data)
        ? Buffer.concat(data)
        : Buffer.isBuffer(data)
          ? data
          : Buffer.from(data as ArrayBuffer)
      decoded = decode(buffer)
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error)
      return
    }

    const frame = parseHoselineFrame(decoded)
    if (!frame) {
      return
    }

    switch (frame.type) {
      case 'call-start':
        this.currentTalkgroup = frame.talkgroup
        this.handlers.onCallStart(frame.sourceId, frame.talkgroup)
        return
      case 'call-alias':
        this.handlers.onCallAlias(frame.alias)
        return
      case 'call-end':
        this.currentTalkgroup = null
        this.handlers.onCallEnd()
        return
      case 'call-audio': {
        const pcm = decodeUlawToPcm(frame.pcm)
        this.handlers.onAudio(pcm, this.currentTalkgroup)
        return
      }
      default:
        return
    }
  }

  private scheduleReconnect(): void {
    this.clearReconnectTimer()
    const attempt = this.reconnectAttempt
    this.reconnectAttempt = Math.min(this.reconnectAttempt + 1, 8)
    const delay = Math.min(MAX_RECONNECT_DELAY_MS, INITIAL_RECONNECT_DELAY_MS * 2 ** attempt)

    this.handlers.onStateChange('reconnecting', this.lastError)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.openSocket()
    }, delay)
    this.reconnectTimer.unref()
  }

  private closeSocket(): void {
    const socket = this.socket
    this.socket = null
    if (!socket) {
      return
    }
    socket.removeAllListeners()
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close()
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }
}
