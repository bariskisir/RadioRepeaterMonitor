export const HOSELINE_URL = 'wss://hose.brandmeister.network/spotter/?token=test:test'

export const HOSELINE_FRAME = {
  groupJoin: 1,
  callStart: 11,
  callEnd: 13,
  callAudio: 20,
  callAlias: 21,
  callMeter: 22,
} as const

export type HoselineFrame =
  | { readonly type: 'group-join' }
  | {
      readonly type: 'call-start'
      readonly sourceId: number | null
      readonly talkgroup: number | null
    }
  | { readonly type: 'call-alias'; readonly alias: string }
  | { readonly type: 'call-end' }
  | { readonly type: 'call-audio'; readonly pcm: Uint8Array }
  | { readonly type: 'call-meter' }
  | { readonly type: 'unknown'; readonly frameType: number }

function toNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function toUint8Array(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) {
    return value
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value)
  }
  if (Array.isArray(value) && value.every((item) => typeof item === 'number')) {
    return Uint8Array.from(value as number[])
  }
  return null
}

export function parseHoselineFrame(input: unknown): HoselineFrame | null {
  if (!Array.isArray(input) || input.length === 0) {
    return null
  }

  const frameType = input[0]

  switch (frameType) {
    case HOSELINE_FRAME.groupJoin:
      return { type: 'group-join' }
    case HOSELINE_FRAME.callStart:
      return {
        type: 'call-start',
        sourceId: toNumberOrNull(input[2]),
        talkgroup: toNumberOrNull(input[3]),
      }
    case HOSELINE_FRAME.callEnd:
      return { type: 'call-end' }
    case HOSELINE_FRAME.callAlias: {
      const alias = input[1]
      return typeof alias === 'string' && alias.trim().length > 0
        ? { type: 'call-alias', alias: alias.trim() }
        : null
    }
    case HOSELINE_FRAME.callAudio: {
      const pcm = toUint8Array(input[1])
      return pcm ? { type: 'call-audio', pcm } : null
    }
    case HOSELINE_FRAME.callMeter:
      return { type: 'call-meter' }
    default:
      return typeof frameType === 'number' ? { type: 'unknown', frameType } : null
  }
}
