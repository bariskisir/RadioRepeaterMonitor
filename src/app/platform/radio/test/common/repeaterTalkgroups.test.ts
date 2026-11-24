import { describe, expect, it } from 'vitest'
import { parseRepeaterTalkgroups } from '@app/platform/radio/common/repeaterTalkgroups'

describe('repeater talkgroup parser', () => {
  it('reads, deduplicates, sorts, and names repeater talkgroups', () => {
    const names = new Map<number, string>([
      [262, 'Germany'],
      [2024, 'Berlin'],
    ])

    expect(
      parseRepeaterTalkgroups(
        [
          { talkgroup: '2024', slot: '2' },
          { talkgroup: 262, slot: 1 },
          { talkgroup: '262', slot: 2 },
          { talkgroup: 0, slot: 1 },
          { talkgroup: 'invalid', slot: 1 },
          null,
        ],
        names,
      ),
    ).toEqual([
      { talkgroup: 262, slot: 1, name: 'Germany' },
      { talkgroup: 2024, slot: 2, name: 'Berlin' },
    ])
  })

  it('accepts an empty or malformed payload', () => {
    expect(parseRepeaterTalkgroups([])).toEqual([])
    expect(parseRepeaterTalkgroups(null)).toEqual([])
    expect(parseRepeaterTalkgroups({ talkgroup: 91 })).toEqual([])
  })
})
