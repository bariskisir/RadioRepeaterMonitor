import type { RadioRepeaterTalkgroup } from './radio'

export function parseRepeaterTalkgroups(
  payload: unknown,
  names: ReadonlyMap<number, string> = new Map(),
): RadioRepeaterTalkgroup[] {
  if (!Array.isArray(payload)) {
    return []
  }

  const byTalkgroup = new Map<number, RadioRepeaterTalkgroup>()
  for (const value of payload) {
    if (!value || typeof value !== 'object') {
      continue
    }
    const record = value as Record<string, unknown>
    const talkgroup = toPositiveInteger(record.talkgroup)
    if (talkgroup === null) {
      continue
    }
    const slot = toPositiveInteger(record.slot) ?? 0
    const existing = byTalkgroup.get(talkgroup)
    if (existing && existing.slot <= slot) {
      continue
    }
    byTalkgroup.set(talkgroup, {
      talkgroup,
      slot,
      name: names.get(talkgroup) ?? '',
    })
  }

  return [...byTalkgroup.values()].sort((left, right) => left.talkgroup - right.talkgroup)
}

function toPositiveInteger(value: unknown): number | null {
  const number =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim().length > 0
        ? Number(value)
        : Number.NaN
  if (!Number.isInteger(number) || number <= 0) {
    return null
  }
  return number
}
