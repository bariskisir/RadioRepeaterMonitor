import './radioViews.scss'
import { renderCodicon, setCodicon } from '@app/base/browser/codicons'
import { $, addDisposableListener, clearNode, toggleClass } from '@app/base/browser/dom'
import { type ActionBarItem, Button, InputBox, SelectBox } from '@app/base/browser/ui'
import { Emitter, type Event } from '@app/base/common/event'
import { Disposable, DisposableStore } from '@app/base/common/lifecycle'
import {
  IInstantiationService,
  type ServicesAccessor,
} from '@app/platform/instantiation/common/instantiation'
import {
  listRadioCountries,
  type RadioCountryOption,
} from '@app/platform/radio/common/directoryBuilder'
import {
  TR_REPEATERS,
  type RepeaterInfo,
  getRepeaterCities,
  getTalkgroupName,
} from '@app/platform/radio/common/catalog'
import type {
  RadioDirectoryCity,
  RadioDirectoryCountry,
  RadioDirectoryRepeater,
  RadioDirectorySnapshot,
  RadioRepeaterTalkgroup,
  RadioStateSnapshot,
} from '@app/platform/radio/common/radio'
import type { IViewPane } from '@app/workbench/browser/viewPane'
import { IWorkbenchLocalizationService } from '@app/workbench/services/localization/browser/localizationService'
import { IRadioAudioPlayer } from '@app/workbench/services/radio/browser/radioAudioPlayer'
import { IWorkbenchRadioService } from '@app/workbench/services/radio/browser/radioWorkbenchService'

export const RADIO_DIRECTORY_VIEW_ID = 'workbench.view.radioDirectory'

const ALL_CITIES = 'all'
const COUNTRY_TR = 'TR'
const UNKNOWN_CITY_KEY = '\u0000unknown'
const UNKNOWN_CITY_VALUE = '\u0000unknown-city'

function normalizeSearch(value: string, locale: string): string {
  return value.trim().toLocaleLowerCase(locale)
}

function cityKey(name: string): string {
  return name.length > 0 ? name : UNKNOWN_CITY_KEY
}

export class RadioDirectoryView extends Disposable implements IViewPane {
  readonly id = RADIO_DIRECTORY_VIEW_ID
  readonly element: HTMLElement

  private readonly _onDidChangeHeaderActions = this._register(new Emitter<void>())
  readonly onDidChangeHeaderActions: Event<void> = this._onDidChangeHeaderActions.event

  private readonly searchInput: InputBox
  private readonly countrySelect: SelectBox<string>
  private readonly citySelect: SelectBox<string>
  private readonly listElement: HTMLDivElement
  private readonly resultCount: HTMLSpanElement
  private readonly listDisposables = this._register(new DisposableStore())
  private directory: RadioDirectorySnapshot | null = null
  private directoryState: 'loading' | 'ready' | 'error' = 'loading'
  private selectedCountry = COUNTRY_TR
  private selectedCity = ALL_CITIES
  private expandedCities = new Set<string>()
  private readonly worldTalkgroups = new Map<string, readonly RadioRepeaterTalkgroup[]>()
  private readonly expandedRepeaters = new Set<string>()
  private readonly loadingRepeaters = new Set<string>()
  private query = ''
  private requestToken = 0

  constructor(
    @IWorkbenchRadioService private readonly radioService: IWorkbenchRadioService,
    @IRadioAudioPlayer private readonly audioPlayer: IRadioAudioPlayer,
    @IWorkbenchLocalizationService
    private readonly localizationService: IWorkbenchLocalizationService,
  ) {
    super()

    this.element = $<HTMLElement>('section.radio-view.radio-directory-view')

    const filters = $<HTMLDivElement>('div.radio-view-filters')
    this.searchInput = this._register(
      new InputBox(filters, {
        placeholder: this.localizationService.t('radio.searchRepeaters'),
        prefixIcon: 'search',
        allowClear: true,
        ariaLabel: this.localizationService.t('radio.searchRepeaters'),
      }),
    )
    this._register(
      this.searchInput.onDidSubmit((value) => {
        this.applySearch(value)
      }),
    )
    this._register(
      this.searchInput.onDidChange((value) => {
        if (value.length === 0) {
          this.applySearch(value)
        }
      }),
    )

    const selectRow = $<HTMLDivElement>('div.radio-view-selects')
    const countryWrap = $<HTMLDivElement>('div.radio-select-wrap')
    countryWrap.appendChild(
      $<HTMLSpanElement>(
        'span.radio-select-label',
        undefined,
        this.localizationService.t('radio.country'),
      ),
    )
    this.countrySelect = this._register(
      new SelectBox(countryWrap, {
        options: this.buildCountryOptions(),
        value: COUNTRY_TR,
        ariaLabel: this.localizationService.t('radio.country'),
      }),
    )
    this._register(
      this.countrySelect.onDidChange((value) => {
        this.selectedCountry = value
        this.selectedCity = ALL_CITIES
        this.expandedCities.clear()
        this.syncCityOptions()
        this.renderList()
      }),
    )

    const cityWrap = $<HTMLDivElement>('div.radio-select-wrap')
    cityWrap.appendChild(
      $<HTMLSpanElement>(
        'span.radio-select-label',
        undefined,
        this.localizationService.t('radio.city'),
      ),
    )
    this.citySelect = this._register(
      new SelectBox<string>(cityWrap, {
        options: this.buildCityOptions(),
        value: ALL_CITIES,
        ariaLabel: this.localizationService.t('radio.city'),
      }),
    )
    this._register(
      this.citySelect.onDidChange((value) => {
        this.selectedCity = value
        if (value !== ALL_CITIES) {
          this.expandedCities.add(cityKey(this.cityValueName(value)))
        }
        this.renderList()
      }),
    )
    selectRow.appendChild(countryWrap)
    selectRow.appendChild(cityWrap)

    this.resultCount = $<HTMLSpanElement>('span.radio-list-count')
    const scroll = $<HTMLDivElement>('div.radio-view-scroll')
    this.listElement = $<HTMLDivElement>('div.radio-directory-list')
    scroll.appendChild(this.resultCount)
    scroll.appendChild(this.listElement)

    filters.appendChild(selectRow)
    this.element.appendChild(filters)
    this.element.appendChild(scroll)

    this.renderList()

    this._register(
      this.radioService.onDidChangeState((snapshot) => {
        this.syncActiveState(snapshot)
      }),
    )
    this._register(
      this.radioService.onDidChangeSelection(() => {
        this.syncActiveState(this.radioService.snapshot)
      }),
    )
    this._register(
      this.localizationService.onDidChangeLocale(() => {
        this.searchInput.inputElement.placeholder =
          this.localizationService.t('radio.searchRepeaters')
        this.searchInput.inputElement.setAttribute(
          'aria-label',
          this.localizationService.t('radio.searchRepeaters'),
        )
        this.countrySelect.setOptions(this.buildCountryOptions(), this.selectedCountry)
        this.syncCityOptions()
        this.renderList()
        this._onDidChangeHeaderActions.fire()
      }),
    )

    void this.loadDirectory()
  }

  getHeaderActions(): readonly ActionBarItem[] {
    return []
  }

  focus(): void {
    this.searchInput.focus()
  }

  private async loadDirectory(): Promise<void> {
    const token = this.requestToken + 1
    this.requestToken = token
    this.directoryState = 'loading'
    if (this.selectedCountry !== COUNTRY_TR) {
      this.renderList()
    }

    try {
      const snapshot = await this.radioService.getDirectory()
      if (this.isDisposed || token !== this.requestToken) {
        return
      }
      this.directory = snapshot
      this.directoryState = 'ready'
    } catch {
      if (this.isDisposed || token !== this.requestToken) {
        return
      }
      this.directoryState = 'error'
    }

    this.countrySelect.setOptions(this.buildCountryOptions(), this.selectedCountry)
    this.syncCityOptions()
    this.renderList()
  }

  private buildCountryOptions(): readonly { value: string; label: string }[] {
    const onlineCountries = new Set(
      (this.directory?.countries ?? [])
        .filter((country) => country.onlineCount > 0)
        .map((country) => country.code),
    )
    const options = new Map<string, RadioCountryOption>()
    for (const option of listRadioCountries()) {
      if (option.code === COUNTRY_TR || onlineCountries.has(option.code)) {
        options.set(option.code, option)
      }
    }
    for (const country of this.directory?.countries ?? []) {
      if (country.onlineCount === 0 || options.has(country.code)) {
        continue
      }
      options.set(country.code, {
        code: country.code,
        name: country.name,
        iso: country.iso,
      })
    }
    if (!options.has(this.selectedCountry)) {
      this.selectedCountry = COUNTRY_TR
      this.selectedCity = ALL_CITIES
    }

    return [...options.values()]
      .map((option) => ({ value: option.code, label: this.countryLabel(option) }))
      .sort((left, right) => {
        if (left.value === COUNTRY_TR) {
          return -1
        }
        if (right.value === COUNTRY_TR) {
          return 1
        }
        return left.label.localeCompare(right.label, this.localizationService.locale)
      })
  }

  private countryLabel(option: { readonly iso: string | null; readonly name: string }): string {
    if (option.iso) {
      try {
        const display = new Intl.DisplayNames([this.localizationService.locale], {
          type: 'region',
        }).of(option.iso)
        if (display && display.trim().length > 0) {
          return display
        }
      } catch {
        return option.name
      }
    }
    return option.name
  }

  private cityLabel(name: string): string {
    return name.length > 0 ? name : this.localizationService.t('radio.unknownCity')
  }

  private cityValueName(value: string): string {
    return value === UNKNOWN_CITY_VALUE ? '' : value
  }

  private buildCityOptions(): readonly { value: string; label: string }[] {
    const allCities = { value: ALL_CITIES, label: this.localizationService.t('radio.allCities') }
    if (this.selectedCountry === COUNTRY_TR) {
      return [
        allCities,
        ...getRepeaterCities().map((city) => ({
          value: city,
          label: city === 'Türkiye' ? this.localizationService.t('radio.unknownCity') : city,
        })),
      ]
    }

    const country = this.getDirectoryCountry(this.selectedCountry)
    if (!country) {
      return [allCities]
    }

    return [
      allCities,
      ...country.cities
        .filter((city) => city.repeaters.some((repeater) => repeater.status === 3))
        .map((city) => ({
          value: city.name.length > 0 ? city.name : UNKNOWN_CITY_VALUE,
          label: this.cityLabel(city.name),
        }))
        .sort((left, right) => {
          if (left.label === this.localizationService.t('radio.unknownCity')) {
            return 1
          }
          if (right.label === this.localizationService.t('radio.unknownCity')) {
            return -1
          }
          return left.label.localeCompare(right.label, this.localizationService.locale)
        }),
    ]
  }

  private syncCityOptions(): void {
    const options = this.buildCityOptions()
    if (!options.some((option) => option.value === this.selectedCity)) {
      this.selectedCity = ALL_CITIES
    }
    this.citySelect.setOptions(options, this.selectedCity)
  }

  private getDirectoryCountry(code: string): RadioDirectoryCountry | null {
    return this.directory?.countries.find((country) => country.code === code) ?? null
  }

  private applySearch(value: string): void {
    this.query = normalizeSearch(value, this.localizationService.locale)
    if (this.query.length > 0) {
      this.expandMatchingCities()
    }
    this.renderList()
  }

  private renderList(): void {
    this.listDisposables.clear()
    clearNode(this.listElement)

    if (this.selectedCountry === COUNTRY_TR) {
      this.renderTurkey()
    } else {
      this.renderWorld()
    }

    this.syncActiveState(this.radioService.snapshot)
  }

  private renderTurkey(): void {
    const repeaters = this.getFilteredTurkeyRepeaters()
    this.resultCount.textContent = this.localizationService.t('radio.searchResultsCount', {
      count: repeaters.length,
    })

    if (repeaters.length === 0) {
      this.appendEmpty(this.localizationService.t('radio.noSearchResults'))
      return
    }

    const groups = new Map<string, RepeaterInfo[]>()
    for (const repeater of repeaters) {
      const key = repeater.city === 'Türkiye' ? '' : repeater.city
      const group = groups.get(key)
      if (group) {
        group.push(repeater)
      } else {
        groups.set(key, [repeater])
      }
    }

    const sortedCities = [...groups.keys()].sort((left, right) =>
      this.compareCityNames(left, right),
    )
    for (const city of sortedCities) {
      const cityRepeaters = groups.get(city) ?? []
      const talkgroup = cityRepeaters[0]?.talkgroup
      if (talkgroup !== undefined) {
        this.listElement.appendChild(
          this.createTurkeyCityHeader(city, talkgroup, cityRepeaters.length),
        )
      }
      for (const repeater of cityRepeaters) {
        this.listElement.appendChild(this.createTurkeyRow(repeater))
      }
    }
  }

  private renderWorld(): void {
    if (this.directoryState === 'loading') {
      this.resultCount.textContent = this.localizationService.t('radio.loadingDirectory')
      this.appendLoading(this.localizationService.t('radio.loadingDirectory'))
      return
    }

    if (this.directoryState === 'error') {
      this.resultCount.textContent = ''
      this.appendError(this.localizationService.t('radio.directoryLoadFailed'))
      return
    }

    const country = this.getDirectoryCountry(this.selectedCountry)
    if (!country || country.onlineCount === 0) {
      this.resultCount.textContent = this.localizationService.t('radio.repeaterCount', {
        count: 0,
      })
      this.appendEmpty(this.localizationService.t('radio.noRepeatersInCountry'))
      return
    }

    const sections: { city: RadioDirectoryCity; repeaters: readonly RadioDirectoryRepeater[] }[] =
      []
    for (const city of country.cities) {
      const repeaters = this.filterWorldCity(city)
      if (repeaters && repeaters.length > 0) {
        sections.push({ city, repeaters })
      }
    }
    sections.sort((left, right) => this.compareCityNames(left.city.name, right.city.name))

    const visibleCount = sections.reduce((total, section) => total + section.repeaters.length, 0)
    this.resultCount.textContent =
      this.query.length > 0
        ? this.localizationService.t('radio.searchResultsCount', { count: visibleCount })
        : this.localizationService.t('radio.worldRepeaterSummary', {
            count: country.onlineCount,
          })

    if (sections.length === 0) {
      this.appendEmpty(this.localizationService.t('radio.noSearchResults'))
      return
    }

    for (const section of sections) {
      const key = cityKey(section.city.name)
      const expanded = this.expandedCities.has(key)
      this.listElement.appendChild(
        this.createWorldCityHeader(section.city, section.repeaters.length, expanded),
      )
      if (!expanded) {
        continue
      }
      for (const repeater of section.repeaters) {
        this.listElement.appendChild(this.createWorldEntry(repeater))
      }
    }
  }

  private filterWorldCity(city: RadioDirectoryCity): readonly RadioDirectoryRepeater[] | null {
    if (this.selectedCity !== ALL_CITIES && city.name !== this.cityValueName(this.selectedCity)) {
      return null
    }
    const online = city.repeaters.filter((repeater) => repeater.status === 3)
    if (online.length === 0) {
      return null
    }
    if (this.query.length === 0) {
      return online
    }
    if (
      this.cityLabel(city.name)
        .toLocaleLowerCase(this.localizationService.locale)
        .includes(this.query)
    ) {
      return online
    }
    const matches = online.filter((repeater) => this.matchesWorldQuery(repeater))
    return matches.length > 0 ? matches : null
  }

  private matchesWorldQuery(repeater: RadioDirectoryRepeater): boolean {
    const locale = this.localizationService.locale
    return (
      repeater.callsign.toLocaleLowerCase(locale).includes(this.query) ||
      repeater.city.toLocaleLowerCase(locale).includes(this.query) ||
      repeater.deviceId.includes(this.query) ||
      repeater.band.toLocaleLowerCase(locale).includes(this.query) ||
      repeater.txMhz.toLocaleLowerCase(locale).includes(this.query) ||
      repeater.rxMhz.toLocaleLowerCase(locale).includes(this.query)
    )
  }

  private expandMatchingCities(): void {
    if (this.selectedCountry === COUNTRY_TR || this.query.length === 0) {
      return
    }
    const country = this.getDirectoryCountry(this.selectedCountry)
    for (const city of country?.cities ?? []) {
      const online = city.repeaters.filter((repeater) => repeater.status === 3)
      if (
        online.length > 0 &&
        (this.cityLabel(city.name)
          .toLocaleLowerCase(this.localizationService.locale)
          .includes(this.query) ||
          online.some((repeater) => this.matchesWorldQuery(repeater)))
      ) {
        this.expandedCities.add(cityKey(city.name))
      }
    }
  }

  private getFilteredTurkeyRepeaters(): readonly RepeaterInfo[] {
    const locale = this.localizationService.locale
    return TR_REPEATERS.filter((repeater) => {
      if (this.selectedCity !== ALL_CITIES) {
        const key = repeater.city === 'Türkiye' ? '' : repeater.city
        if (key !== this.cityValueName(this.selectedCity)) {
          return false
        }
      }
      if (this.query.length === 0) {
        return true
      }
      const talkgroupName = getTalkgroupName(repeater.talkgroup)
      return (
        repeater.callsign.toLocaleLowerCase(locale).includes(this.query) ||
        repeater.city.toLocaleLowerCase(locale).includes(this.query) ||
        repeater.deviceId.includes(this.query) ||
        repeater.band.toLocaleLowerCase(locale).includes(this.query) ||
        String(repeater.talkgroup).includes(this.query) ||
        talkgroupName.toLocaleLowerCase(locale).includes(this.query)
      )
    })
  }

  private createTurkeyCityHeader(
    city: string,
    talkgroup: number,
    count: number,
  ): HTMLButtonElement {
    const name = this.cityLabel(city)
    const header = $<HTMLButtonElement>('button.radio-city-header', {
      type: 'button',
      'data-talkgroup': String(talkgroup),
      'aria-label': `${name} — ${this.localizationService.t('radio.listen')}`,
    })
    header.appendChild($<HTMLSpanElement>('span.radio-city-name', undefined, name))
    header.appendChild(
      $<HTMLSpanElement>(
        'span.radio-city-channel',
        undefined,
        `TG ${talkgroup} · ${getTalkgroupName(talkgroup)}`,
      ),
    )
    header.appendChild($<HTMLSpanElement>('span.radio-city-count', undefined, String(count)))
    header.appendChild(
      $<HTMLSpanElement>(
        'span.radio-city-action',
        undefined,
        renderCodicon('broadcast', 12),
        $<HTMLSpanElement>('span', undefined, this.localizationService.t('radio.listen')),
      ),
    )
    this.listDisposables.add(
      addDisposableListener(header, 'click', () => {
        void this.listenToTalkgroup(talkgroup)
      }),
    )
    return header
  }

  private createTurkeyRow(repeater: RepeaterInfo): HTMLDivElement {
    const row = $<HTMLDivElement>('div.radio-directory-row', {
      title: this.localizationService.t('radio.listenCity'),
      'data-talkgroup': String(repeater.talkgroup),
    })

    const statusDot = $<HTMLSpanElement>(
      `span.radio-status-dot.${this.statusClass(repeater.status)}`,
    )
    statusDot.setAttribute('title', `Status ${repeater.status}`)

    const header = $<HTMLDivElement>(
      'div.radio-directory-header',
      undefined,
      statusDot,
      $<HTMLSpanElement>('span.radio-directory-callsign', undefined, repeater.callsign),
      $<HTMLSpanElement>('span.radio-directory-band', undefined, repeater.band),
    )

    const meta = $<HTMLDivElement>('div.radio-directory-meta')
    meta.appendChild(
      $<HTMLSpanElement>(
        'span.radio-directory-frequency',
        undefined,
        `TX ${repeater.txMhz} · RX ${repeater.rxMhz}`,
      ),
    )
    meta.appendChild(
      $<HTMLSpanElement>(
        'span.radio-directory-talkgroup',
        undefined,
        `${this.localizationService.t('radio.talkgroup')} ${repeater.talkgroup} · ${getTalkgroupName(
          repeater.talkgroup,
        )}`,
      ),
    )

    const info = $<HTMLDivElement>('div.radio-directory-info', undefined, header, meta)
    this.listDisposables.add(
      addDisposableListener(row, 'click', () => {
        void this.listenToRepeater(repeater)
      }),
    )
    row.appendChild(info)
    return row
  }

  private createWorldCityHeader(
    city: RadioDirectoryCity,
    count: number,
    expanded: boolean,
  ): HTMLButtonElement {
    const header = $<HTMLButtonElement>('button.radio-city-header.radio-world-city-header', {
      type: 'button',
      'aria-expanded': expanded,
    })
    const chevron = $<HTMLSpanElement>('span.radio-city-chevron')
    setCodicon(chevron, expanded ? 'chevron-down' : 'chevron-right', 12)
    header.appendChild(chevron)
    header.appendChild(
      $<HTMLSpanElement>('span.radio-city-name', undefined, this.cityLabel(city.name)),
    )
    header.appendChild(
      $<HTMLSpanElement>(
        'span.radio-city-channel',
        undefined,
        this.localizationService.t('radio.worldRepeaterSummary', { count }),
      ),
    )
    this.listDisposables.add(
      addDisposableListener(header, 'click', () => {
        const key = cityKey(city.name)
        if (this.expandedCities.has(key)) {
          this.expandedCities.delete(key)
        } else {
          this.expandedCities.add(key)
        }
        this.renderList()
      }),
    )
    return header
  }

  private createWorldEntry(repeater: RadioDirectoryRepeater): HTMLDivElement {
    const entry = $<HTMLDivElement>('div.radio-world-entry', {
      'data-device-id': repeater.deviceId,
    })
    const row = this.createWorldRow(repeater, entry)
    entry.appendChild(row)

    const talkgroups = this.worldTalkgroups.get(repeater.deviceId)
    if (talkgroups && this.expandedRepeaters.has(repeater.deviceId)) {
      entry.appendChild(
        talkgroups.length === 0
          ? this.createWorldEmptyNotice()
          : this.createWorldTalkgroupPanel(repeater, talkgroups),
      )
      toggleClass(entry, 'expanded', true)
    }

    return entry
  }

  private createWorldRow(repeater: RadioDirectoryRepeater, entry: HTMLDivElement): HTMLDivElement {
    const row = $<HTMLDivElement>('div.radio-directory-row.radio-world-row', {
      title: this.localizationService.t('radio.listen'),
    })
    const statusDot = $<HTMLSpanElement>(
      `span.radio-status-dot.${this.statusClass(repeater.status)}`,
    )
    statusDot.setAttribute('title', `Status ${repeater.status}`)

    const callsign = repeater.callsign.length > 0 ? repeater.callsign : `#${repeater.deviceId}`
    const headerChildren: (HTMLSpanElement | HTMLDivElement)[] = [statusDot]
    headerChildren.push($<HTMLSpanElement>('span.radio-directory-callsign', undefined, callsign))
    if (repeater.band.length > 0) {
      headerChildren.push($<HTMLSpanElement>('span.radio-directory-band', undefined, repeater.band))
    }
    const header = $<HTMLDivElement>('div.radio-directory-header', undefined, ...headerChildren)

    const meta = $<HTMLDivElement>('div.radio-directory-meta')
    const frequencies = [
      repeater.txMhz.length > 0 ? `TX ${repeater.txMhz}` : '',
      repeater.rxMhz.length > 0 ? `RX ${repeater.rxMhz}` : '',
    ]
      .filter((part) => part.length > 0)
      .join(' · ')
    if (frequencies.length > 0) {
      meta.appendChild($<HTMLSpanElement>('span.radio-directory-frequency', undefined, frequencies))
    }
    meta.appendChild(
      $<HTMLSpanElement>('span.radio-directory-device', undefined, `#${repeater.deviceId}`),
    )

    const info = $<HTMLDivElement>('div.radio-directory-info', undefined, header, meta)
    const listen = $<HTMLButtonElement>('button.radio-world-listen', {
      type: 'button',
      title: this.localizationService.t('radio.listen'),
      'aria-label': `${callsign} — ${this.localizationService.t('radio.listen')}`,
    })
    listen.appendChild(renderCodicon('broadcast', 14))

    const toggle = (): void => {
      void this.toggleWorldRepeater(repeater, entry)
    }
    this.listDisposables.add(addDisposableListener(row, 'click', toggle))
    this.listDisposables.add(
      addDisposableListener(listen, 'click', (event) => {
        event.stopPropagation()
        toggle()
      }),
    )

    row.appendChild(info)
    row.appendChild(listen)
    return row
  }

  private async toggleWorldRepeater(
    repeater: RadioDirectoryRepeater,
    entry: HTMLDivElement,
  ): Promise<void> {
    const deviceId = repeater.deviceId
    if (this.loadingRepeaters.has(deviceId)) {
      return
    }

    const openPanel = entry.querySelector('.radio-world-talkgroups')
    if (openPanel) {
      this.expandedRepeaters.delete(deviceId)
      openPanel.remove()
      toggleClass(entry, 'expanded', false)
      return
    }

    const cached = this.worldTalkgroups.get(deviceId)
    if (cached) {
      this.expandWorldRepeater(repeater, entry, cached)
      return
    }

    const button = entry.querySelector<HTMLButtonElement>('.radio-world-listen')
    this.loadingRepeaters.add(deviceId)
    if (button) {
      button.disabled = true
      clearNode(button)
      button.appendChild($<HTMLSpanElement>('span.radio-view-spinner'))
    }

    try {
      const talkgroups = await this.radioService.getRepeaterTalkgroups(deviceId)
      if (this.isDisposed) {
        return
      }
      this.worldTalkgroups.set(deviceId, talkgroups)
      if (!entry.isConnected) {
        return
      }
      const onlyTalkgroup = talkgroups[0]
      if (talkgroups.length === 1 && onlyTalkgroup) {
        this.rememberWorldTalkgroup(repeater, onlyTalkgroup)
        await this.listenToTalkgroup(onlyTalkgroup.talkgroup)
        return
      }
      this.expandWorldRepeater(repeater, entry, talkgroups)
    } catch {
      if (this.isDisposed || !entry.isConnected) {
        return
      }
      this.expandedRepeaters.add(deviceId)
      entry.appendChild(
        $<HTMLDivElement>(
          'div.radio-world-talkgroups.radio-world-notice',
          undefined,
          this.localizationService.t('radio.repeaterTalkgroupsFailed'),
        ),
      )
      toggleClass(entry, 'expanded', true)
    } finally {
      this.loadingRepeaters.delete(deviceId)
      if (!this.isDisposed && entry.isConnected) {
        this.resetWorldListenButton(entry)
      }
    }
  }

  private expandWorldRepeater(
    repeater: RadioDirectoryRepeater,
    entry: HTMLDivElement,
    talkgroups: readonly RadioRepeaterTalkgroup[],
  ): void {
    if (entry.querySelector('.radio-world-talkgroups')) {
      return
    }

    this.expandedRepeaters.add(repeater.deviceId)
    entry.appendChild(
      talkgroups.length === 0
        ? this.createWorldEmptyNotice()
        : this.createWorldTalkgroupPanel(repeater, talkgroups),
    )
    toggleClass(entry, 'expanded', true)
  }

  private createWorldEmptyNotice(): HTMLDivElement {
    return $<HTMLDivElement>(
      'div.radio-world-talkgroups.radio-world-notice',
      undefined,
      this.localizationService.t('radio.noRepeaterTalkgroups'),
    )
  }

  private createWorldTalkgroupPanel(
    repeater: RadioDirectoryRepeater,
    talkgroups: readonly RadioRepeaterTalkgroup[],
  ): HTMLDivElement {
    const panel = $<HTMLDivElement>('div.radio-world-talkgroups')
    for (const talkgroup of talkgroups) {
      const option = $<HTMLButtonElement>('button.radio-world-talkgroup', {
        type: 'button',
        'data-talkgroup': String(talkgroup.talkgroup),
        title: this.localizationService.t('radio.listen'),
      })
      option.appendChild(
        $<HTMLSpanElement>('span.radio-world-talkgroup-id', undefined, `TG ${talkgroup.talkgroup}`),
      )
      if (talkgroup.slot > 0) {
        option.appendChild(
          $<HTMLSpanElement>('span.radio-world-talkgroup-slot', undefined, `TS ${talkgroup.slot}`),
        )
      }
      if (talkgroup.name.length > 0) {
        option.appendChild(
          $<HTMLSpanElement>('span.radio-world-talkgroup-name', undefined, talkgroup.name),
        )
      }
      this.listDisposables.add(
        addDisposableListener(option, 'click', () => {
          this.rememberWorldTalkgroup(repeater, talkgroup)
          void this.listenToTalkgroup(talkgroup.talkgroup)
        }),
      )
      panel.appendChild(option)
    }
    return panel
  }

  private rememberWorldTalkgroup(
    repeater: RadioDirectoryRepeater,
    talkgroup: RadioRepeaterTalkgroup,
  ): void {
    const country = this.getDirectoryCountry(this.selectedCountry)
    this.radioService.rememberTalkgroupContext(talkgroup.talkgroup, {
      ...(country ? { country: this.countryLabel(country) } : {}),
      ...(repeater.city.length > 0 ? { region: repeater.city } : {}),
      ...(talkgroup.name.length > 0 ? { talkgroupName: talkgroup.name } : {}),
    })
  }

  private resetWorldListenButton(entry: HTMLDivElement): void {
    const button = entry.querySelector<HTMLButtonElement>('.radio-world-listen')
    if (!button) {
      return
    }
    button.disabled = false
    clearNode(button)
    button.appendChild(renderCodicon('broadcast', 14))
  }

  private appendLoading(message: string): void {
    const loading = $<HTMLDivElement>(
      'div.radio-view-loading',
      undefined,
      $<HTMLSpanElement>('span.radio-view-spinner'),
      $<HTMLSpanElement>('span.radio-view-loading-text', undefined, message),
    )
    this.listElement.appendChild(loading)
  }

  private appendError(message: string): void {
    const error = $<HTMLDivElement>(
      'div.radio-view-loading.radio-view-error',
      undefined,
      $<HTMLSpanElement>('span.radio-view-loading-text', undefined, message),
    )
    const retry = new Button(error, {
      label: this.localizationService.t('common.retry'),
      icon: 'refresh',
      variant: 'secondary',
      small: true,
    })
    this.listDisposables.add(retry)
    this.listDisposables.add(
      retry.onDidClick(() => {
        void this.loadDirectory()
      }),
    )
    this.listElement.appendChild(error)
  }

  private appendEmpty(message: string): void {
    this.listElement.appendChild($<HTMLDivElement>('div.radio-view-empty', undefined, message))
  }

  private compareCityNames(left: string, right: string): number {
    if (left.length === 0) {
      return right.length === 0 ? 0 : 1
    }
    if (right.length === 0) {
      return -1
    }
    return left.localeCompare(right, this.localizationService.locale)
  }

  private statusClass(status: number): string {
    return `status-${status}`
  }

  private async listenToRepeater(repeater: RepeaterInfo): Promise<void> {
    await this.listenToTalkgroup(repeater.talkgroup)
  }

  private async listenToTalkgroup(talkgroup: number): Promise<void> {
    await this.audioPlayer.unlock()
    await this.radioService.connect([talkgroup])
  }

  private syncActiveState(snapshot: RadioStateSnapshot): void {
    const activeTalkgroups = new Set<number>(snapshot.talkgroups)
    const connected = snapshot.state === 'connected' || snapshot.state === 'connecting'
    for (const header of this.listElement.querySelectorAll<HTMLElement>('[data-talkgroup]')) {
      const talkgroup = Number(header.getAttribute('data-talkgroup'))
      const active = connected && activeTalkgroups.has(talkgroup)
      toggleClass(header, 'active', active)
      if (active) {
        header.setAttribute('aria-current', 'true')
      } else {
        header.removeAttribute('aria-current')
      }
    }
  }
}

export function createRadioDirectoryView(accessor: ServicesAccessor): IViewPane {
  return accessor.get(IInstantiationService).createInstance(RadioDirectoryView)
}
