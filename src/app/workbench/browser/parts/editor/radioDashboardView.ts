import './radioDashboardView.scss'
import { renderCodicon } from '@app/base/browser/codicons'
import { $, addDisposableListener, clearNode, toggleClass } from '@app/base/browser/dom'
import { Button } from '@app/base/browser/ui'
import { Disposable, DisposableStore } from '@app/base/common/lifecycle'
import {
  findTalkgroup,
  getRegionTitleKey,
  getTalkgroupLabel,
  getTalkgroupName,
} from '@app/platform/radio/common/catalog'
import type { RadioCall, RadioLogEntry, RadioStateSnapshot } from '@app/platform/radio/common/radio'
import { APP_LOGO_URL } from '@app/workbench/browser/assets/brand'
import { IWorkbenchLocalizationService } from '@app/workbench/services/localization/browser/localizationService'
import { IRadioAudioPlayer } from '@app/workbench/services/radio/browser/radioAudioPlayer'
import { IWorkbenchRadioService } from '@app/workbench/services/radio/browser/radioWorkbenchService'

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export class RadioDashboardView extends Disposable {
  readonly element: HTMLElement

  private readonly dynamicDisposables = this._register(new DisposableStore())

  private readonly titleElement: HTMLHeadingElement
  private readonly subtitleElement: HTMLParagraphElement

  private readonly statusElement: HTMLDivElement
  private readonly statusLabel: HTMLSpanElement
  private readonly statusDetail: HTMLSpanElement
  private readonly liveCallElement: HTMLDivElement
  private readonly liveCallChannel: HTMLSpanElement
  private readonly liveCallSender: HTMLSpanElement
  private readonly liveCallDuration: HTMLSpanElement
  private readonly connectButton: Button

  private readonly selectionTitle: HTMLHeadingElement
  private readonly selectionCount: HTMLSpanElement
  private readonly selectionClear: HTMLButtonElement
  private readonly selectionList: HTMLDivElement

  private readonly recentTitle: HTMLHeadingElement
  private readonly recentCount: HTMLSpanElement
  private readonly recentList: HTMLDivElement

  private tickTimer: ReturnType<typeof setInterval> | null = null

  constructor(
    @IWorkbenchRadioService private readonly radioService: IWorkbenchRadioService,
    @IRadioAudioPlayer private readonly audioPlayer: IRadioAudioPlayer,
    @IWorkbenchLocalizationService
    private readonly localizationService: IWorkbenchLocalizationService,
  ) {
    super()

    this.element = $<HTMLElement>('section.radio-dashboard')
    const scroll = $<HTMLDivElement>('div.radio-dashboard-scroll')
    const inner = $<HTMLDivElement>('div.radio-dashboard-inner')

    const header = $<HTMLDivElement>('div.radio-dashboard-header')
    const logoWrap = $<HTMLDivElement>('div.radio-dashboard-logo-wrap')
    const logo = $<HTMLImageElement>('img.radio-dashboard-logo', { src: APP_LOGO_URL, alt: '' })
    logoWrap.appendChild(logo)
    const headerText = $<HTMLDivElement>('div.radio-dashboard-header-text')
    const titleRow = $<HTMLDivElement>('div.radio-dashboard-title-row')
    this.titleElement = $<HTMLHeadingElement>('h1.radio-dashboard-title')
    titleRow.appendChild(this.titleElement)
    this.subtitleElement = $<HTMLParagraphElement>('p.radio-dashboard-subtitle')
    headerText.appendChild(titleRow)
    headerText.appendChild(this.subtitleElement)
    header.appendChild(logoWrap)
    header.appendChild(headerText)

    this.statusElement = $<HTMLDivElement>('div.radio-dashboard-status')
    const statusTop = $<HTMLDivElement>('div.radio-status-top')
    const statusInfo = $<HTMLDivElement>('div.radio-status-info')
    const statusHeading = $<HTMLDivElement>('div.radio-status-heading')
    const statusDot = $<HTMLSpanElement>('span.radio-live-dot')
    this.statusLabel = $<HTMLSpanElement>('span.radio-status-label')
    statusHeading.appendChild(statusDot)
    statusHeading.appendChild(this.statusLabel)
    this.statusDetail = $<HTMLSpanElement>('span.radio-status-detail')
    statusInfo.appendChild(statusHeading)
    statusInfo.appendChild(this.statusDetail)

    const statusActions = $<HTMLDivElement>('div.radio-status-actions')
    this.connectButton = this._register(
      new Button(statusActions, {
        label: this.localizationService.t('radio.connect'),
        icon: 'broadcast',
        variant: 'primary',
      }),
    )
    statusTop.appendChild(statusInfo)
    statusTop.appendChild(statusActions)

    this.liveCallElement = $<HTMLDivElement>('div.radio-live-call.hidden')
    const liveWave = $<HTMLDivElement>(
      'div.radio-live-wave',
      { 'aria-hidden': 'true' },
      $<HTMLSpanElement>('span.radio-live-wave-bar.wave-1'),
      $<HTMLSpanElement>('span.radio-live-wave-bar.wave-2'),
      $<HTMLSpanElement>('span.radio-live-wave-bar.wave-3'),
      $<HTMLSpanElement>('span.radio-live-wave-bar.wave-4'),
    )
    const liveCallMeta = $<HTMLDivElement>('div.radio-live-call-meta')
    this.liveCallChannel = $<HTMLSpanElement>('span.radio-live-call-channel')
    this.liveCallSender = $<HTMLSpanElement>('span.radio-live-call-sender')
    liveCallMeta.appendChild(this.liveCallChannel)
    liveCallMeta.appendChild(this.liveCallSender)
    this.liveCallDuration = $<HTMLSpanElement>('span.radio-live-call-duration')
    this.liveCallElement.appendChild(liveWave)
    this.liveCallElement.appendChild(liveCallMeta)
    this.liveCallElement.appendChild(this.liveCallDuration)

    this.statusElement.appendChild(statusTop)
    this.statusElement.appendChild(this.liveCallElement)

    this._register(
      this.connectButton.onDidClick(() => {
        void this.toggleConnection()
      }),
    )

    const selectionSection = $<HTMLElement>('section.radio-panel.radio-selection-panel')
    const selectionHeader = $<HTMLDivElement>('div.radio-panel-header')
    const selectionTitleWrap = $<HTMLDivElement>('div.radio-panel-title-wrap')
    this.selectionTitle = $<HTMLHeadingElement>('h2.radio-panel-title')
    this.selectionCount = $<HTMLSpanElement>('span.radio-panel-badge')
    selectionTitleWrap.appendChild(this.selectionTitle)
    selectionTitleWrap.appendChild(this.selectionCount)
    this.selectionClear = $<HTMLButtonElement>('button.radio-text-button', {
      type: 'button',
    })
    selectionHeader.appendChild(selectionTitleWrap)
    selectionHeader.appendChild(this.selectionClear)
    this.selectionList = $<HTMLDivElement>('div.radio-selection-list')
    selectionSection.appendChild(selectionHeader)
    selectionSection.appendChild(this.selectionList)
    this._register(
      addDisposableListener(this.selectionClear, 'click', () => {
        this.radioService.clearSelection()
      }),
    )

    const recentSection = $<HTMLElement>('section.radio-panel.radio-recent-panel')
    const recentHeader = $<HTMLDivElement>('div.radio-panel-header')
    const recentTitleWrap = $<HTMLDivElement>('div.radio-panel-title-wrap')
    this.recentTitle = $<HTMLHeadingElement>('h2.radio-panel-title')
    this.recentCount = $<HTMLSpanElement>('span.radio-panel-badge')
    recentTitleWrap.appendChild(this.recentTitle)
    recentTitleWrap.appendChild(this.recentCount)
    recentHeader.appendChild(recentTitleWrap)
    this.recentList = $<HTMLDivElement>('div.radio-recent-list')
    recentSection.appendChild(recentHeader)
    recentSection.appendChild(this.recentList)

    inner.appendChild(header)
    inner.appendChild(this.statusElement)
    inner.appendChild(selectionSection)
    inner.appendChild(recentSection)
    scroll.appendChild(inner)
    this.element.appendChild(scroll)

    this.syncCopy()
    this.sync(this.radioService.snapshot)

    this._register(
      this.radioService.onDidChangeState((snapshot) => {
        this.sync(snapshot)
      }),
    )
    this._register(
      this.radioService.onDidChangeSelection(() => {
        this.renderSelection()
        this.sync(this.radioService.snapshot)
      }),
    )
    this._register(
      this.localizationService.onDidChangeLocale(() => {
        this.syncCopy()
        this.sync(this.radioService.snapshot)
      }),
    )

    this.tickTimer = setInterval(() => {
      this.updateLiveDuration()
    }, 1000)
  }

  override dispose(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer)
      this.tickTimer = null
    }
    super.dispose()
  }

  private async toggleConnection(): Promise<void> {
    const state = this.radioService.snapshot.state
    if (state === 'connected' || state === 'connecting' || state === 'reconnecting') {
      await this.radioService.disconnect()
      return
    }
    const selected = this.radioService.selectedTalkgroups
    if (selected.length === 0) {
      return
    }
    await this.audioPlayer.unlock()
    await this.radioService.connect(selected)
  }

  private syncCopy(): void {
    const t = (key: string, options?: Record<string, unknown>): string =>
      this.localizationService.t(key, options)

    this.titleElement.textContent = t('radio.title')
    this.subtitleElement.textContent = t('radio.subtitle')
    this.selectionTitle.textContent = t('radio.selectedTalkgroups')
    this.selectionClear.textContent = t('radio.clearSelection')
    this.recentTitle.textContent = t('radio.recentCalls')
  }

  private sync(snapshot: RadioStateSnapshot): void {
    const t = (key: string, options?: Record<string, unknown>): string =>
      this.localizationService.t(key, options)

    const state = snapshot.state
    const isActive = state === 'connected' || state === 'connecting' || state === 'reconnecting'
    const activeCall = snapshot.activeCalls[0]

    this.statusElement.setAttribute('data-state', activeCall ? 'live' : state)
    this.statusLabel.textContent = activeCall ? t('radio.live') : this.getStateLabel(state)
    this.statusDetail.textContent = this.getStateDetail(snapshot)

    this.syncLiveCall(activeCall)

    if (isActive) {
      this.connectButton.setLabel(
        state === 'connecting' || state === 'reconnecting'
          ? t('radio.connecting')
          : t('radio.disconnect'),
      )
      this.connectButton.setIcon('close')
    } else {
      this.connectButton.setLabel(t('radio.listenSelected'))
      this.connectButton.setIcon('broadcast')
    }
    this.connectButton.setEnabled(isActive || this.radioService.selectedTalkgroups.length > 0)

    this.renderSelection(snapshot)
    this.renderRecentCalls(snapshot.recentCalls)
  }

  private syncLiveCall(call: RadioCall | undefined): void {
    toggleClass(this.liveCallElement, 'hidden', call === undefined)
    if (!call) {
      this.liveCallDuration.removeAttribute('data-started-at')
      return
    }
    const breadcrumb = this.formatCallBreadcrumb(call)
    this.liveCallChannel.textContent = breadcrumb
    this.liveCallChannel.setAttribute('title', breadcrumb)
    this.liveCallSender.textContent =
      call.callsign ??
      (call.sourceId ? `ID ${call.sourceId}` : this.localizationService.t('radio.unknownSource'))
    this.liveCallDuration.textContent = formatDuration(Date.now() - call.startedAt)
    this.liveCallDuration.setAttribute('data-started-at', String(call.startedAt))
  }

  private formatCallBreadcrumb(call: RadioCall): string {
    const segments: string[] = []
    const pushSegment = (value: string | undefined): void => {
      const trimmed = value?.trim()
      if (trimmed && segments[segments.length - 1] !== trimmed) {
        segments.push(trimmed)
      }
    }

    if (call.talkgroup !== null) {
      const trTalkgroup = findTalkgroup(call.talkgroup)
      if (trTalkgroup) {
        pushSegment(this.localizationService.t('radio.countries.tr'))
        pushSegment(this.localizationService.t(getRegionTitleKey(trTalkgroup.region)))
        pushSegment(trTalkgroup.name)
      } else {
        const context = this.radioService.getTalkgroupContext(call.talkgroup)
        pushSegment(context?.country)
        pushSegment(context?.region)
        pushSegment(context?.talkgroupName)
      }
      pushSegment(`TG ${call.talkgroup}`)
    } else {
      pushSegment(getTalkgroupLabel(null))
    }

    return segments.join(' – ')
  }

  private updateLiveDuration(): void {
    const startedAt = Number(this.liveCallDuration.getAttribute('data-started-at'))
    if (Number.isFinite(startedAt) && startedAt > 0) {
      this.liveCallDuration.textContent = formatDuration(Date.now() - startedAt)
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

  private getStateDetail(snapshot: RadioStateSnapshot): string {
    const t = (key: string, options?: Record<string, unknown>): string =>
      this.localizationService.t(key, options)
    if (snapshot.lastError) {
      return snapshot.lastError
    }
    if (snapshot.state === 'connected') {
      const countText = t('radio.talkgroupCount', {
        count: snapshot.talkgroups.length,
      })
      return snapshot.activeCalls.length > 0
        ? countText
        : `${t('radio.noActiveCall')} · ${countText}`
    }
    if (this.radioService.selectedTalkgroups.length === 0) {
      return t('radio.noSelection')
    }
    return t('radio.selectedCount', {
      count: this.radioService.selectedTalkgroups.length,
    })
  }

  private formatTalkgroupName(talkgroup: number): string {
    const trTalkgroup = findTalkgroup(talkgroup)
    if (trTalkgroup) {
      return trTalkgroup.name
    }
    const context = this.radioService.getTalkgroupContext(talkgroup)
    if (context?.talkgroupName) {
      return context.talkgroupName
    }
    return getTalkgroupName(talkgroup)
  }

  private formatTalkgroupTitle(talkgroup: number | null): string {
    if (talkgroup === null) {
      return getTalkgroupLabel(null)
    }
    const trTalkgroup = findTalkgroup(talkgroup)
    if (trTalkgroup) {
      return `TG ${talkgroup} · ${trTalkgroup.name}`
    }
    const context = this.radioService.getTalkgroupContext(talkgroup)
    if (context?.talkgroupName) {
      return `TG ${talkgroup} · ${context.talkgroupName}`
    }
    return `TG ${talkgroup}`
  }

  private formatRelativeTime(timestamp: number): string {
    const t = (key: string, options?: Record<string, unknown>): string =>
      this.localizationService.t(key, options)
    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000))
    if (elapsedSeconds < 10) {
      return t('radio.justNow')
    }
    if (elapsedSeconds < 60) {
      return t('radio.secondsAgo', { count: elapsedSeconds })
    }
    const minutes = Math.floor(elapsedSeconds / 60)
    if (minutes < 60) {
      return t('radio.minutesAgo', { count: minutes })
    }
    return t('radio.hoursAgo', { count: Math.floor(minutes / 60) })
  }

  private renderSelection(snapshot: RadioStateSnapshot = this.radioService.snapshot): void {
    this.dynamicDisposables.clear()
    clearNode(this.selectionList)
    const t = (key: string, options?: Record<string, unknown>): string =>
      this.localizationService.t(key, options)
    const selected = this.radioService.selectedTalkgroups
    this.selectionCount.textContent = String(selected.length)
    toggleClass(this.selectionClear, 'hidden', selected.length === 0)

    if (selected.length === 0) {
      const empty = $<HTMLDivElement>('div.radio-selection-empty')
      const iconWrap = $<HTMLSpanElement>(
        'span.radio-selection-empty-icon',
        { 'aria-hidden': 'true' },
        renderCodicon('broadcast', 15),
      )
      empty.appendChild(iconWrap)
      empty.appendChild(
        $<HTMLSpanElement>('span.radio-selection-empty-text', undefined, t('radio.noSelection')),
      )
      this.selectionList.appendChild(empty)
      return
    }

    const activeTalkgroups = new Set<number>()
    for (const call of snapshot.activeCalls) {
      if (call.talkgroup !== null) {
        activeTalkgroups.add(call.talkgroup)
      }
    }
    const connected = snapshot.state === 'connected'
    const listening = new Set(snapshot.talkgroups)

    for (const talkgroup of selected) {
      const chip = $<HTMLButtonElement>('button.radio-chip', {
        type: 'button',
        title: t('radio.remove'),
        'data-talkgroup': String(talkgroup),
        'data-state': activeTalkgroups.has(talkgroup)
          ? 'live'
          : connected && listening.has(talkgroup)
            ? 'listening'
            : 'idle',
      })
      chip.appendChild($<HTMLSpanElement>('span.radio-chip-signal', { 'aria-hidden': 'true' }))
      const body = $<HTMLSpanElement>('span.radio-chip-body')
      body.appendChild(
        $<HTMLSpanElement>('span.radio-chip-label', undefined, this.formatTalkgroupName(talkgroup)),
      )
      body.appendChild($<HTMLSpanElement>('span.radio-chip-meta', undefined, `TG ${talkgroup}`))
      chip.appendChild(body)
      chip.appendChild(
        $<HTMLSpanElement>(
          'span.radio-chip-remove',
          { 'aria-hidden': 'true' },
          renderCodicon('close', 12),
        ),
      )
      this.dynamicDisposables.add(
        addDisposableListener(chip, 'click', () => {
          this.radioService.toggleTalkgroup(talkgroup)
        }),
      )
      this.selectionList.appendChild(chip)
    }
  }

  private renderRecentCalls(recentCalls: readonly RadioLogEntry[]): void {
    clearNode(this.recentList)
    this.recentCount.textContent = String(recentCalls.length)

    if (recentCalls.length === 0) {
      this.recentList.appendChild(
        $<HTMLDivElement>(
          'div.radio-recent-empty',
          undefined,
          this.localizationService.t('radio.noRecentCalls'),
        ),
      )
      return
    }

    for (const entry of recentCalls.slice(0, 12)) {
      const sender =
        entry.callsign ??
        (entry.sourceId
          ? `ID ${entry.sourceId}`
          : this.localizationService.t('radio.unknownSource'))

      const row = $<HTMLDivElement>('div.radio-recent-row')
      const lead = $<HTMLSpanElement>('span.radio-recent-dot', { 'aria-hidden': 'true' })
      const main = $<HTMLDivElement>(
        'div.radio-recent-main',
        undefined,
        $<HTMLSpanElement>(
          'span.radio-recent-talkgroup',
          undefined,
          this.formatTalkgroupTitle(entry.talkgroup),
        ),
        $<HTMLSpanElement>('span.radio-recent-source', undefined, sender),
      )
      const meta = $<HTMLDivElement>(
        'div.radio-recent-meta',
        undefined,
        $<HTMLSpanElement>(
          'span.radio-recent-duration',
          undefined,
          formatDuration(entry.durationMs),
        ),
        $<HTMLSpanElement>(
          'span.radio-recent-when',
          undefined,
          this.formatRelativeTime(entry.endedAt),
        ),
      )
      row.appendChild(lead)
      row.appendChild(main)
      row.appendChild(meta)
      this.recentList.appendChild(row)
    }
  }
}
