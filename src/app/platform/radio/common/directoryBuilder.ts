import { MCC_COUNTRIES } from './mcc'
import type {
  RadioDirectoryCity,
  RadioDirectoryCountry,
  RadioDirectoryRepeater,
  RadioDirectorySnapshot,
} from './radio'

export const RADIO_DIRECTORY_SOURCE_URL = 'https://api.brandmeister.network/v2/device'

const UNKNOWN_COUNTRY_PREFIX = 'mcc:'

export interface RadioCountryOption {
  readonly code: string
  readonly name: string
  readonly iso: string | null
}

interface MutableCity {
  readonly name: string
  readonly repeaters: RadioDirectoryRepeater[]
  onlineCount: number
}

interface MutableCountry {
  name: string
  readonly iso: string | null
  readonly mccCodes: Set<string>
  readonly cities: Map<string, MutableCity>
  repeaterCount: number
  onlineCount: number
}

export function listRadioCountries(): readonly RadioCountryOption[] {
  const byCode = new Map<string, RadioCountryOption>()
  for (const [mcc, country] of Object.entries(MCC_COUNTRIES)) {
    const code = country.iso ?? `${UNKNOWN_COUNTRY_PREFIX}${mcc}`
    if (!byCode.has(code)) {
      byCode.set(code, { code, name: country.name, iso: country.iso })
    }
  }
  return [...byCode.values()].sort((left, right) => left.name.localeCompare(right.name, 'en'))
}

export function buildRadioDirectory(
  devices: readonly unknown[],
  fetchedAt = Date.now(),
): RadioDirectorySnapshot {
  const countries = new Map<string, MutableCountry>()
  let totalRepeaters = 0
  let totalOnline = 0

  for (const value of devices) {
    const device = asRecord(value)
    if (!device) {
      continue
    }

    const deviceId = readString(device, 'id')
    if (!/^\d{3,}$/.test(deviceId)) {
      continue
    }

    const mcc = deviceId.slice(0, 3)
    const countryInfo = MCC_COUNTRIES[mcc]
    const countryName = countryInfo?.name ?? `MCC ${mcc}`
    const iso = countryInfo?.iso ?? null
    const countryCode = iso ?? `${UNKNOWN_COUNTRY_PREFIX}${mcc}`

    let country = countries.get(countryCode)
    if (!country) {
      country = {
        name: countryName,
        iso,
        mccCodes: new Set(),
        cities: new Map(),
        repeaterCount: 0,
        onlineCount: 0,
      }
      countries.set(countryCode, country)
    }
    country.mccCodes.add(mcc)

    const cityName = normalizeText(readString(device, 'city'))
    const status = readNumber(device, 'status')
    const repeater: RadioDirectoryRepeater = {
      deviceId,
      callsign: normalizeText(readString(device, 'callsign')),
      city: cityName,
      txMhz: normalizeText(readString(device, 'tx')),
      rxMhz: normalizeText(readString(device, 'rx')),
      band: getRadioBand(readString(device, 'tx')),
      status,
      lastSeen: normalizeText(readString(device, 'last_seen')),
    }

    let city = country.cities.get(cityName)
    if (!city) {
      city = { name: cityName, repeaters: [], onlineCount: 0 }
      country.cities.set(cityName, city)
    }
    city.repeaters.push(repeater)
    country.repeaterCount += 1
    if (status === 3) {
      country.onlineCount += 1
      city.onlineCount += 1
      totalOnline += 1
    }
    totalRepeaters += 1
  }

  return {
    countries: [...countries.entries()]
      .map(([code, country]) => createCountry(code, country))
      .sort((left, right) => left.name.localeCompare(right.name, 'en')),
    fetchedAt,
    totalRepeaters,
    totalOnline,
    sourceUrl: RADIO_DIRECTORY_SOURCE_URL,
  }
}

function createCountry(code: string, country: MutableCountry): RadioDirectoryCountry {
  const cities = [...country.cities.values()]
    .map((city): RadioDirectoryCity => ({
      name: city.name,
      repeaters: city.repeaters.sort(compareRepeaters),
    }))
    .sort(compareCities)

  return {
    code,
    name: country.name,
    iso: country.iso,
    mccCodes: [...country.mccCodes].sort((left, right) => Number(left) - Number(right)),
    cities,
    repeaterCount: country.repeaterCount,
    onlineCount: country.onlineCount,
  }
}

function compareCities(left: RadioDirectoryCity, right: RadioDirectoryCity): number {
  if (left.name.length === 0) {
    return right.name.length === 0 ? 0 : 1
  }
  if (right.name.length === 0) {
    return -1
  }
  return left.name.localeCompare(right.name)
}

function compareRepeaters(left: RadioDirectoryRepeater, right: RadioDirectoryRepeater): number {
  const callsignOrder = left.callsign.localeCompare(right.callsign)
  return callsignOrder !== 0 ? callsignOrder : left.deviceId.localeCompare(right.deviceId)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (typeof value === 'string') {
    return value
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }
  return ''
}

function readNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key]
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function normalizeText(value: string): string {
  const trimmed = value.trim()
  const lowered = trimmed.toLocaleLowerCase('en')
  if (
    trimmed.length === 0 ||
    lowered === 'null' ||
    lowered === 'undefined' ||
    lowered === '(null)'
  ) {
    return ''
  }
  return trimmed
}

export function getRadioBand(txMhz: string): string {
  const frequency = Number.parseFloat(txMhz)
  if (!Number.isFinite(frequency) || frequency <= 0) {
    return ''
  }
  if (frequency >= 28 && frequency < 30) {
    return 'HF 10m'
  }
  if (frequency < 30) {
    return 'HF'
  }
  if (frequency >= 50 && frequency < 54) {
    return 'VHF 6m'
  }
  if (frequency >= 144 && frequency < 148) {
    return 'VHF 2m'
  }
  if (frequency >= 220 && frequency < 225) {
    return 'VHF 1.25m'
  }
  if (frequency >= 420 && frequency < 450) {
    return 'UHF 70cm'
  }
  if (frequency >= 902 && frequency < 928) {
    return 'UHF 33cm'
  }
  if (frequency >= 1240 && frequency < 1300) {
    return 'UHF 23cm'
  }
  return frequency < 300 ? 'VHF' : frequency < 1000 ? 'UHF' : 'SHF'
}
