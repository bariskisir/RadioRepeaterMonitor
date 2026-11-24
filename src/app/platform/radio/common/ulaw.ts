const ULAW_TABLE = [0, 132, 396, 924, 1980, 4092, 8316, 16764] as const

export function decodeUlawSample(value: number): number {
  const exponentMask = 255 - (value & 0xff)
  const sign = exponentMask & 0x80
  const exponent = (exponentMask >> 4) & 7
  const mantissa = exponentMask & 0x0f
  const magnitude = (ULAW_TABLE[exponent] ?? 0) + (mantissa << (exponent + 3))
  return sign ? -magnitude : magnitude
}

export function decodeUlawToPcm(data: Uint8Array): Int16Array {
  const pcm = new Int16Array(data.length)
  for (let index = 0; index < data.length; index += 1) {
    pcm[index] = decodeUlawSample(data[index] ?? 0)
  }
  return pcm
}

export function pcmToBytes(pcm: Int16Array): Uint8Array {
  return new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength)
}
