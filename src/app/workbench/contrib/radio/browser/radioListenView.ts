import './radioViews.scss'
import { setCodicon } from '@app/base/browser/codicons'
import { $, addDisposableListener, clearNode, toggleClass } from '@app/base/browser/dom'
import { type ActionBarItem, InputBox } from '@app/base/browser/ui'
import { Emitter, type Event } from '@app/base/common/event'
import { Disposable, DisposableStore } from '@app/base/common/lifecycle'
import {
  IInstantiationService,
  type ServicesAccessor,
} from '@app/platform/instantiation/common/instantiation'
import {
  TALKGROUP_REGIONS,
  TR_TALKGROUPS,
  type TalkgroupInfo,
  type TalkgroupRegionId,
  getRegionTitleKey,
} from '@app/platform/radio/common/catalog'
import type { RadioStateSnapshot } from '@app/platform/radio/common/radio'
import type { IViewPane } from '@app/workbench/browser/viewPane'
import { IWorkbenchLocalizationService } from '@app/workbench/services/localization/browser/localizationService'
import { IRadioAudioPlayer } from '@app/workbench/services/radio/browser/radioAudioPlayer'
import { IWorkbenchRadioService } from '@app/workbench/services/radio/browser/radioWorkbenchService'

export const RADIO_LISTEN_VIEW_ID = 'workbench.view.radioListen'

function createTalkgroupCheckbox(checked: boolean): HTMLInputElement {
  return $<HTMLInputElement>('input.radio-checkbox', {
    type: 'checkbox',
    checked,
    tabindex: '-1',
    'aria-hidden': 'true',
  })
}

function setCheckboxState(checkbox: HTMLInputElement, checked: boolean): void {
  checkbox.checked = checked
  checkbox.indeterminate = false
}

export class RadioListenView extends Disposable implements IViewPane {
  readonly id = RADIO_LISTEN_VIEW_ID
  readonly element: HTMLElement

  private readonly _onDidChangeHeaderActions = this._register(new Emitter<void>())
  readonly onDidChangeHeaderActions: Event<void> = this._onDidChangeHeaderActions.event

  private readonly searchInput: InputBox
  private readonly treeElement: HTMLDivElement
  private readonly treeDisposables = this._register(new DisposableStore())
  private readonly footerDot: HTMLSpanElement
  private readonly footerCount: HTMLSpanElement
  private readonly stateText: HTMLSpanElement
  private readonly expandedRegions = new Set<TalkgroupRegionId>(
    TALKGROUP_REGIONS.map((region) => region.id),
  )
  private countryExpanded = true
  private query = ''

  constructor(
    @IWorkbenchRadioService private readonly radioService: IWorkbenchRadioService,
    @IRadioAudioPlayer private readonly audioPlayer: IRadioAudioPlayer,
    @IWorkbenchLocalizationService
    private readonly localizationService: IWorkbenchLocalizationService,
  ) {
    super()

    this.element = $<HTMLElement>('section.radio-view.radio-listen-view')

    const searchContainer = $<HTMLDivElement>('div.radio-view-search')
    this.searchInput = this._register(
      new InputBox(searchContainer, {
        placeholder: this.localizationService.t('radio.searchTalkgroups'),
        prefixIcon: 'search',
        allowClear: true,
        ariaLabel: this.localizationService.t('radio.searchTalkgroups'),
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

    const treeContainer = $<HTMLDivElement>('div.radio-view-scroll')
    this.treeElement = $<HTMLDivElement>('div.radio-tree', {
      role: 'tree',
      'aria-label': this.localizationService.t('radio.talkgroups'),
    })
    treeContainer.appendChild(this.treeElement)

    const footer = $<HTMLDivElement>('div.radio-view-footer')
    this.footerDot = $<HTMLSpanElement>('span.radio-footer-dot', { 'aria-hidden': 'true' })
    this.stateText = $<HTMLSpanElement>('span.radio-footer-state')
    const stateWrap = $<HTMLDivElement>(
      'div.radio-footer-status',
      undefined,
      this.footerDot,
      this.stateText,
    )
    this.footerCount = $<HTMLSpanElement>('span.radio-footer-count')
    const footerInfo = $<HTMLDivElement>(
      'div.radio-footer-info',
      undefined,
      stateWrap,
      this.footerCount,
    )

    footer.appendChild(footerInfo)

    this.element.appendChild(searchContainer)
    this.element.appendChild(treeContainer)
    this.element.appendChild(footer)

    this.renderTree()
    this.syncFooter(this.radioService.snapshot)

    this._register(
      this.radioService.onDidChangeSelection(() => {
        this.renderTree()
        this.syncFooter(this.radioService.snapshot)
      }),
    )
    this._register(
      this.radioService.onDidChangeState((snapshot) => {
        this.syncFooter(snapshot)
        this.syncActiveRows(snapshot)
      }),
    )
    this._register(
      this.localizationService.onDidChangeLocale(() => {
        this.searchInput.inputElement.placeholder =
          this.localizationService.t('radio.searchTalkgroups')
        this.searchInput.inputElement.setAttribute(
          'aria-label',
          this.localizationService.t('radio.searchTalkgroups'),
        )
        this.renderTree()
        this.syncFooter(this.radioService.snapshot)
        this._onDidChangeHeaderActions.fire()
      }),
    )
  }

  getHeaderActions(): readonly ActionBarItem[] {
    return [
      {
        id: 'radio-clear-selection',
        icon: 'clear-all',
        title: this.localizationService.t('radio.clearSelection'),
        ariaLabel: this.localizationService.t('radio.clearSelection'),
        run: () => {
          this.radioService.clearSelection()
        },
      },
    ]
  }

  focus(): void {
    this.searchInput.focus()
  }

  private syncFooter(snapshot: RadioStateSnapshot): void {
    const t = (key: string, options?: Record<string, unknown>): string =>
      this.localizationService.t(key, options)

    const state = snapshot.state
    const isActive = state === 'connected' || state === 'connecting' || state === 'reconnecting'
    const count = this.radioService.selectedTalkgroups.length

    this.footerCount.textContent = t('radio.selectedCount', { count })
    this.stateText.textContent = this.getStateLabel(state)
    const live = snapshot.activeCalls.length > 0
    toggleClass(this.footerDot, 'live', live)
    toggleClass(this.footerDot, 'connected', !live && state === 'connected')
    toggleClass(this.footerDot, 'connecting', state === 'connecting' || state === 'reconnecting')
    toggleClass(this.footerDot, 'error', state === 'error')
    toggleClass(this.stateText, 'radio-state-connected', state === 'connected')
    toggleClass(this.stateText, 'radio-state-error', state === 'error')

    if (isActive && snapshot.talkgroups.length > 0) {
      this.stateText.textContent = `${this.getStateLabel(state)} · ${t('radio.talkgroupCount', {
        count: snapshot.talkgroups.length,
      })}`
    }
  }

  private syncActiveRows(snapshot: RadioStateSnapshot): void {
    const liveTalkgroups = new Set<number>()
    for (const call of snapshot.activeCalls) {
      if (call.talkgroup !== null) {
        liveTalkgroups.add(call.talkgroup)
      }
    }
    for (const row of this.treeElement.querySelectorAll<HTMLElement>('.radio-tree-row')) {
      const talkgroup = Number(row.getAttribute('data-talkgroup'))
      toggleClass(row, 'live', liveTalkgroups.has(talkgroup))
    }
  }

  private getStateLabel(state: RadioStateSnapshot['state']): string {
    const t = (key: string): string => this.localizationService.t(key)
    switch (state) {
      case 'connecting':
        return t('radio.connecting')
      case 'connected':
        return t('radio.connected')
      case 'reconnecting':
        return t('radio.reconnecting')
      case 'error':
        return t('radio.error')
      default:
        return t('radio.idle')
    }
  }

  private applySearch(value: string): void {
    this.query = value.trim().toLocaleLowerCase('tr')
    this.renderTree()
  }

  private renderTree(): void {
    this.treeDisposables.clear()
    clearNode(this.treeElement)
    const selected = new Set(this.radioService.selectedTalkgroups)

    if (this.query.length > 0) {
      const matches = TR_TALKGROUPS.filter((talkgroup) => this.matchesQuery(talkgroup))
      if (matches.length === 0) {
        this.treeElement.appendChild(
          $<HTMLDivElement>(
            'div.radio-view-empty',
            undefined,
            this.localizationService.t('radio.noSearchResults'),
          ),
        )
        return
      }
      this.treeElement.appendChild(
        $<HTMLDivElement>(
          'div.radio-tree-hint',
          undefined,
          this.localizationService.t('radio.searchResultsCount', { count: matches.length }),
        ),
      )
      for (const talkgroup of matches) {
        this.treeElement.appendChild(this.createTalkgroupRow(talkgroup, selected, 0))
      }
      return
    }

    const countryRow = $<HTMLDivElement>('div.radio-tree-country')
    const countryToggle = $<HTMLButtonElement>('button.radio-tree-branch.radio-tree-country-row', {
      type: 'button',
      'aria-expanded': this.countryExpanded,
    })
    const countryChevron = $<HTMLSpanElement>('span.radio-tree-chevron')
    setCodicon(countryChevron, this.countryExpanded ? 'chevron-down' : 'chevron-right', 14)
    const countryCheckbox = createTalkgroupCheckbox(
      TR_TALKGROUPS.every((talkgroup) => selected.has(talkgroup.id)),
    )
    countryCheckbox.indeterminate =
      !countryCheckbox.checked && TR_TALKGROUPS.some((talkgroup) => selected.has(talkgroup.id))
    countryToggle.appendChild(countryChevron)
    countryToggle.appendChild($<HTMLSpanElement>('span.radio-tree-flag', undefined, 'TR'))
    countryToggle.appendChild(
      $<HTMLSpanElement>(
        'span.radio-tree-label',
        undefined,
        this.localizationService.t('radio.countries.tr'),
      ),
    )
    countryToggle.appendChild(
      $<HTMLSpanElement>(
        'span.radio-tree-count',
        undefined,
        this.localizationService.t('radio.talkgroupCount', { count: TR_TALKGROUPS.length }),
      ),
    )
    this.treeDisposables.add(
      addDisposableListener(countryToggle, 'click', () => {
        this.countryExpanded = !this.countryExpanded
        this.renderTree()
      }),
    )
    this.treeDisposables.add(
      addDisposableListener(countryCheckbox, 'change', () => {
        this.selectTalkgroups(
          TR_TALKGROUPS.map((talkgroup) => talkgroup.id),
          countryCheckbox.checked,
        )
      }),
    )
    countryRow.appendChild(countryCheckbox)
    countryRow.appendChild(countryToggle)
    this.treeElement.appendChild(countryRow)

    if (!this.countryExpanded) {
      return
    }

    for (const region of TALKGROUP_REGIONS) {
      const talkgroups = TR_TALKGROUPS.filter((talkgroup) => talkgroup.region === region.id)
      if (talkgroups.length === 0) {
        continue
      }

      const expanded = this.expandedRegions.has(region.id)
      const regionRow = $<HTMLDivElement>('div.radio-tree-region')
      const regionToggle = $<HTMLButtonElement>('button.radio-tree-branch.radio-tree-region-row', {
        type: 'button',
        'aria-expanded': expanded,
      })
      const chevron = $<HTMLSpanElement>('span.radio-tree-chevron')
      setCodicon(chevron, expanded ? 'chevron-down' : 'chevron-right', 14)
      const regionCheckbox = createTalkgroupCheckbox(
        talkgroups.every((talkgroup) => selected.has(talkgroup.id)),
      )
      regionCheckbox.indeterminate =
        !regionCheckbox.checked && talkgroups.some((talkgroup) => selected.has(talkgroup.id))
      regionToggle.appendChild(chevron)
      regionToggle.appendChild(
        $<HTMLSpanElement>(
          'span.radio-tree-label',
          undefined,
          this.localizationService.t(getRegionTitleKey(region.id)),
        ),
      )
      regionToggle.appendChild(
        $<HTMLSpanElement>('span.radio-tree-count', undefined, String(talkgroups.length)),
      )
      this.treeDisposables.add(
        addDisposableListener(regionToggle, 'click', () => {
          if (this.expandedRegions.has(region.id)) {
            this.expandedRegions.delete(region.id)
          } else {
            this.expandedRegions.add(region.id)
          }
          this.renderTree()
        }),
      )
      this.treeDisposables.add(
        addDisposableListener(regionCheckbox, 'change', () => {
          this.selectTalkgroups(
            talkgroups.map((talkgroup) => talkgroup.id),
            regionCheckbox.checked,
          )
        }),
      )
      regionRow.appendChild(regionCheckbox)
      regionRow.appendChild(regionToggle)
      this.treeElement.appendChild(regionRow)

      if (!expanded) {
        continue
      }

      for (const talkgroup of talkgroups) {
        this.treeElement.appendChild(this.createTalkgroupRow(talkgroup, selected, 1))
      }
    }
  }

  private createTalkgroupRow(
    talkgroup: TalkgroupInfo,
    selected: ReadonlySet<number>,
    depth: number,
  ): HTMLDivElement {
    const row = $<HTMLDivElement>('div.radio-tree-row', {
      role: 'treeitem',
      'aria-selected': selected.has(talkgroup.id),
      'data-depth': String(depth),
      'data-talkgroup': String(talkgroup.id),
    })
    const checkbox = createTalkgroupCheckbox(selected.has(talkgroup.id))
    setCheckboxState(checkbox, selected.has(talkgroup.id))

    const label = $<HTMLSpanElement>(
      'span.radio-tree-label',
      undefined,
      talkgroup.city ?? talkgroup.name,
    )
    const meta = $<HTMLSpanElement>('span.radio-tree-meta')
    const name = talkgroup.city ? talkgroup.name : ''
    meta.textContent =
      name && name !== talkgroup.city ? `${talkgroup.id} · ${name}` : `TG ${talkgroup.id}`

    this.treeDisposables.add(
      addDisposableListener(checkbox, 'change', () => {
        this.radioService.toggleTalkgroup(talkgroup.id)
      }),
    )
    this.treeDisposables.add(
      addDisposableListener(row, 'click', (event) => {
        if (event.target === checkbox) {
          return
        }
        const current = this.radioService.selectedTalkgroups
        if (current.length === 1 && current[0] === talkgroup.id) {
          this.radioService.clearSelection()
          return
        }
        this.radioService.setSelectedTalkgroups([talkgroup.id])
        const state = this.radioService.snapshot.state
        if (state === 'connected' || state === 'connecting' || state === 'reconnecting') {
          return
        }
        void this.audioPlayer.unlock()
        void this.radioService.connect([talkgroup.id])
      }),
    )

    row.appendChild(checkbox)
    row.appendChild(label)
    row.appendChild(meta)
    toggleClass(row, 'selected', selected.has(talkgroup.id))
    toggleClass(
      row,
      'live',
      this.radioService.snapshot.activeCalls.some((call) => call.talkgroup === talkgroup.id),
    )
    return row
  }

  private selectTalkgroups(talkgroupIds: readonly number[], select: boolean): void {
    const current = new Set(this.radioService.selectedTalkgroups)
    for (const id of talkgroupIds) {
      if (select) {
        current.add(id)
      } else {
        current.delete(id)
      }
    }
    this.radioService.setSelectedTalkgroups([...current])
  }

  private matchesQuery(talkgroup: TalkgroupInfo): boolean {
    const regionLabel = this.localizationService
      .t(getRegionTitleKey(talkgroup.region))
      .toLocaleLowerCase('tr')
    return (
      talkgroup.name.toLocaleLowerCase('tr').includes(this.query) ||
      (talkgroup.city?.toLocaleLowerCase('tr').includes(this.query) ?? false) ||
      String(talkgroup.id).includes(this.query) ||
      regionLabel.includes(this.query)
    )
  }
}

export function createRadioListenView(accessor: ServicesAccessor): IViewPane {
  return accessor.get(IInstantiationService).createInstance(RadioListenView)
}
