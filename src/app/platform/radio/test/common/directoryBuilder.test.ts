import { describe, expect, it } from 'vitest'
import {
  buildRadioDirectory,
  getRadioBand,
  listRadioCountries,
  RADIO_DIRECTORY_SOURCE_URL,
} from '@app/platform/radio/common/directoryBuilder'

describe('radio directory builder', () => {
  it('lists every MCC country once, including countries without an ISO code', () => {
    const countries = listRadioCountries()
    const byCode = new Map(countries.map((country) => [country.code, country]))

    expect(countries.length).toBeGreaterThan(200)
    expect(new Set(countries.map((country) => country.code)).size).toBe(countries.length)
    expect(byCode.get('TR')).toEqual({ code: 'TR', name: 'Turkey', iso: 'TR' })
    expect(byCode.get('DE')?.iso).toBe('DE')
    expect(byCode.get('US')?.iso).toBe('US')
    expect(byCode.get('mcc:289')).toEqual({ code: 'mcc:289', name: 'Abkhazia', iso: null })
    expect(countries.filter((country) => country.code === 'US')).toHaveLength(1)
  })

  it('groups devices by country and city, merging MCCs that share an ISO code', () => {
    const snapshot = buildRadioDirectory(
      [
        {
          id: '310001',
          callsign: ' W1AW ',
          city: 'New York',
          tx: '441.0000',
          rx: '446.0000',
          status: 3,
          last_seen: '2026-11-24 15:25:00',
        },
        {
          id: '311002',
          callsign: 'K2ABC',
          city: 'New York',
          tx: '145.5000',
          rx: '145.0000',
          status: 2,
        },
        {
          id: '311003',
          callsign: 'K3XYZ',
          city: '',
          tx: '',
          rx: '',
          status: 0,
        },
      ],
      1_700_000_000_000,
    )

    expect(snapshot.totalRepeaters).toBe(3)
    expect(snapshot.totalOnline).toBe(1)
    expect(snapshot.sourceUrl).toBe(RADIO_DIRECTORY_SOURCE_URL)
    expect(snapshot.fetchedAt).toBe(1_700_000_000_000)

    const unitedStates = snapshot.countries.find((country) => country.code === 'US')
    expect(unitedStates?.mccCodes).toEqual(['310', '311'])
    expect(unitedStates?.repeaterCount).toBe(3)
    expect(unitedStates?.onlineCount).toBe(1)
    expect(unitedStates?.cities.map((city) => city.name)).toEqual(['New York', ''])

    const newYork = unitedStates?.cities[0]
    expect(newYork?.repeaters.map((repeater) => repeater.callsign)).toEqual(['K2ABC', 'W1AW'])
    expect(newYork?.repeaters[1]?.band).toBe('UHF 70cm')
    expect(newYork?.repeaters[0]?.band).toBe('VHF 2m')
    expect(newYork?.repeaters[1]?.city).toBe('New York')

    const unknownCity = unitedStates?.cities[1]
    expect(unknownCity?.repeaters[0]?.band).toBe('')
  })

  it('skips malformed devices and derives radio bands from TX frequencies', () => {
    const snapshot = buildRadioDirectory([
      null,
      {},
      { id: '12' },
      { id: 'not-a-device' },
      { id: '262001', callsign: 'DB0ABC', city: 'Berlin', tx: '439.1000', status: 3 },
    ])

    expect(snapshot.totalRepeaters).toBe(1)
    expect(snapshot.countries[0]?.code).toBe('DE')
    expect(snapshot.countries[0]?.cities[0]?.repeaters[0]?.band).toBe('UHF 70cm')

    expect(getRadioBand('29.6000')).toBe('HF 10m')
    expect(getRadioBand('51.0000')).toBe('VHF 6m')
    expect(getRadioBand('145.6000')).toBe('VHF 2m')
    expect(getRadioBand('223.5000')).toBe('VHF 1.25m')
    expect(getRadioBand('439.1000')).toBe('UHF 70cm')
    expect(getRadioBand('915.0000')).toBe('UHF 33cm')
    expect(getRadioBand('1296.0000')).toBe('UHF 23cm')
    expect(getRadioBand('10.1000')).toBe('HF')
    expect(getRadioBand('2400.0000')).toBe('SHF')
    expect(getRadioBand('')).toBe('')
  })
})
