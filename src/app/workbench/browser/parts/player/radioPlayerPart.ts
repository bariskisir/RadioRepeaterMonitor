import './radioPlayerPart.scss'
import { $, addDisposableListener, toggleClass } from '@app/base/browser/dom'
import { Button, Slider } from '@app/base/browser/ui'
import {
  findTalkgroup,
  getRegionTitleKey,
  getTalkgroupLabel,
} from '@app/platform/radio/common/catalog'
import type { RadioCall, RadioStateSnapshot } from '@app/platform/radio/common/radio'
import { APP_LOGO_URL } from '@app/workbench/browser/assets/brand'
import { Part } from '@app/workbench/browser/part'
import { IWorkbenchLocalizationService } from '@app/workbench/services/localization/browser/localizationService'
import {
  IRadioAudioPlayer,
  type RadioAudioPlayerState,
} from '@app/workbench/services/radio/browser/radioAudioPlayer'
import { IWorkbenchRadioService } from '@app/workbench/services/radio/browser/radioWorkbenchService'

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export class RadioPlayerPart extends Part {
  protected readonly partClassName = 'radio-player'

  private playerBar!: HTMLDivElement
  private playerDot!: HTMLSpanElement
  private playerTitle!: HTMLSpanElement
  private playerSubtitle!: HTMLDivElement
  private playerExtra!: HTMLSpanElement
  private playerTime!: HTMLSpanElement
  private playerState!: HTMLSpanElement
  private equalizer!: HTMLDivElement
  private muteButton!: Button
  private volumeSlider!: Slider
  private volumeValue!: HTMLSpanElement
  private levelMeter!: HTMLDivElement
  private levelFill!: HTMLSpanElement

  private tickTimer: ReturnType<typeof setInterval> | null = null

  constructor(
    @IWorkbenchRadioService private readonly radioService: IWorkbenchRadioService,
    @IRadioAudioPlayer private readonly audioPlayer: IRadioAudioPlayer,
    @IWorkbenchLocalizationService
    private readonly localizationService: IWorkbenchLocalizationService,
  ) {
    super('workbench.parts.radioPlayer')
  }

  protected createContentArea(parent: HTMLElement): void {
    this.playerBar = $<HTMLDivElement>('div.radio-player-bar')
    parent.appendChild(this.playerBar)

    const track = $<HTMLDivElement>('div.radio-player-track')
    const artworkWrap = $<HTMLDivElement>('div.radio-player-artwork-wrap')
    const artwork = $<HTMLImageElement>('img.radio-player-artwork', {
      src: APP_LOGO_URL,
      alt: '',
    })
    this.equalizer = $<HTMLDivElement>(
      'div.radio-player-equalizer',
      { 'aria-hidden': 'true' },
      $<HTMLSpanElement>('span.radio-player-eq-bar.radio-player-eq-1'),
      $<HTMLSpanElement>('span.radio-player-eq-bar.radio-player-eq-2'),
      $<HTMLSpanElement>('span.radio-player-eq-bar.radio-player-eq-3'),
      $<HTMLSpanElement>('span.radio-player-eq-bar.radio-player-eq-4'),
    )
    artworkWrap.appendChild(artwork)
    artworkWrap.appendChild(this.equalizer)

    const playerInfo = $<HTMLDivElement>('div.radio-player-info')
    const playerTitleRow = $<HTMLDivElement>('div.radio-player-title-row')
    this.playerDot = $<HTMLSpanElement>('span.radio-player-dot')
    this.playerTitle = $<HTMLSpanElement>('span.radio-player-title', {
      'aria-live': 'polite',
    })
    this.playerExtra = $<HTMLSpanElement>('span.radio-player-extra')
    this.playerState = $<HTMLSpanElement>('span.radio-player-state')
    playerTitleRow.appendChild(this.playerDot)
    playerTitleRow.appendChild(this.playerTitle)
    playerTitleRow.appendChild(this.playerExtra)
    playerTitleRow.appendChild(this.playerState)

    this.playerSubtitle = $<HTMLDivElement>('div.radio-player-subtitle')
    this.playerTime = $<HTMLSpanElement>('span.radio-player-time')
    const playerMeta = $<HTMLDivElement>(
      'div.radio-player-meta',
      undefined,
      this.playerSubtitle,
      this.playerTime,
    )
    playerInfo.appendChild(playerTitleRow)
    playerInfo.appendChild(playerMeta)
    track.appendChild(artworkWrap)
    track.appendChild(playerInfo)

    const controls = $<HTMLDivElement>('div.radio-player-controls')
    const volume = $<HTMLDivElement>('div.radio-player-volume')
    this.muteButton = this._register(
      new Button(volume, {
        icon: 'unmute',
        variant: 'icon',
        ariaLabel: this.localizationService.t('radio.mute'),
        title: this.localizationService.t('radio.mute'),
      }),
    )
    const volumeSlider = $<HTMLDivElement>('div.radio-player-volume-slider')
    this.volumeSlider = this._register(
      new Slider(volumeSlider, {
        min: 0,
        max: 100,
        step: 1,
        value: Math.round(this.audioPlayer.state.volume * 100),
        ariaLabel: this.localizationService.t('radio.volume'),
        formatValue: (value) => `${value}%`,
      }),
    )
    this.volumeValue = $<HTMLSpanElement>('span.radio-player-volume-value')
    this.levelMeter = $<HTMLDivElement>('div.radio-player-level', {
      title: this.localizationService.t('radio.audioLevel'),
      'aria-hidden': 'true',
    })
    this.levelFill = $<HTMLSpanElement>('span.radio-player-level-fill')
    this.levelMeter.appendChild(this.levelFill)
    volume.appendChild(volumeSlider)
    volume.appendChild(this.volumeValue)
    volume.appendChild(this.levelMeter)
    controls.appendChild(volume)

    this.playerBar.appendChild(track)
    this.playerBar.appendChild(controls)

    this._register(
      addDisposableListener(this.playerBar, 'pointerdown', () => {
        void this.audioPlayer.unlock()
      }),
    )
    this._register(
      this.muteButton.onDidClick(() => {
        void this.audioPlayer.unlock()
        this.audioPlayer.setMuted(!this.audioPlayer.state.muted)
      }),
    )
    this._register(
      this.volumeSlider.onDidInput((value) => {
        void this.audioPlayer.unlock()
        this.audioPlayer.setVolume(value / 100)
      }),
    )
    this._register(
      addDisposableListener(
        volume,
        'wheel',
        (event) => {
          event.preventDefault()
          const direction = event.deltaY > 0 ? -0.05 : 0.05
          this.audioPlayer.setVolume(this.audioPlayer.state.volume + direction)
          void this.audioPlayer.unlock()
        },
        { passive: false },
      ),
    )
    this._register(
      this.radioService.onDidChangeState((snapshot) => {
        this.sync(snapshot)
      }),
    )
    this._register(
      this.radioService.onDidChangeSelection(() => {
        this.sync(this.radioService.snapshot)
      }),
    )
    this._register(
      this.localizationService.onDidChangeLocale(() => {
        this.syncCopy()
        this.sync(this.radioService.snapshot)
        this.syncAudio(this.audioPlayer.state)
      }),
    )
    this._register(
      this.audioPlayer.onDidChangeState((state) => {
        this.syncAudio(state)
      }),
    )

    this.syncCopy()
    this.sync(this.radioService.snapshot)
    this.syncAudio(this.audioPlayer.state)

    this.tickTimer = setInterval(() => {
      this.updateDurations()
    }, 1000)
  }

  override dispose(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer)
      this.tickTimer = null
    }
    super.dispose()
  }

  private syncCopy(): void {
    const label = this.localizationService.t(
      this.audioPlayer.state.muted ? 'radio.unmute' : 'radio.mute',
    )
    this.muteButton.setIcon(this.audioPlayer.state.muted ? 'mute' : 'unmute')
    this.muteButton.setTitle(label)
    this.muteButton.element.setAttribute('aria-label', label)
    this.levelMeter.setAttribute('title', this.localizationService.t('radio.audioLevel'))
  }

  private sync(snapshot: RadioStateSnapshot): void {
    const state = snapshot.state
    const connected = state === 'connected'
    const call = snapshot.activeCalls[0]

    this.playerBar.setAttribute('data-state', state)
    toggleClass(this.playerBar, 'live', call !== undefined)
    toggleClass(this.equalizer, 'active', call !== undefined)
    this.playerTime.textContent = ''
    this.playerExtra.textContent = ''
    this.playerTime.removeAttribute('data-started-at')
    this.playerTitle.removeAttribute('title')
    this.playerSubtitle.removeAttribute('title')

    if (call) {
      this.renderLiveCall(call, snapshot.activeCalls.length)
      this.playerState.textContent = this.localizationService.t('radio.live')
      return
    }

    const t = (key: string, options?: Record<string, unknown>): string =>
      this.localizationService.t(key, options)

    if (state === 'error') {
      this.playerTitle.textContent = t('radio.error')
      this.playerSubtitle.textContent = snapshot.lastError ?? ''
      this.playerState.textContent = t('radio.error')
      return
    }
    if (state === 'connecting' || state === 'reconnecting') {
      this.playerTitle.textContent = t('radio.connecting')
      this.playerSubtitle.textContent =
        snapshot.talkgroups.length > 0
          ? this.formatListening(snapshot.talkgroups)
          : t('radio.talkgroupCount', { count: snapshot.talkgroups.length })
      this.playerState.textContent = t('radio.connecting')
      return
    }
    if (connected) {
      this.playerTitle.textContent = t('radio.noActiveCall')
      this.playerSubtitle.textContent = this.formatListening(snapshot.talkgroups)
      this.playerState.textContent = t('radio.connected')
      return
    }
    if (this.radioService.selectedTalkgroups.length > 0) {
      this.playerTitle.textContent = t('radio.selectedTalkgroups')
      this.playerSubtitle.textContent = this.formatListening(this.radioService.selectedTalkgroups)
      this.playerState.textContent = t('radio.idle')
      return
    }
    this.playerTitle.textContent = t('radio.noSelection')
    this.playerSubtitle.textContent = t('radio.subtitle')
    this.playerState.textContent = t('radio.idle')
  }

  private formatListening(talkgroups: readonly number[]): string {
    const labels = talkgroups.slice(0, 2).map((talkgroup) => this.formatTalkgroupTitle(talkgroup))
    if (talkgroups.length > 2) {
      labels.push(`+${talkgroups.length - 2}`)
    }
    return labels.join(' · ')
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

  private renderLiveCall(call: RadioCall, activeCount: number): void {
    const breadcrumb = this.formatCallBreadcrumb(call)
    const sender =
      call.callsign ??
      (call.sourceId ? `ID ${call.sourceId}` : this.localizationService.t('radio.unknownSource'))
    this.playerTitle.textContent = breadcrumb
    this.playerTitle.setAttribute('title', breadcrumb)
    this.playerSubtitle.textContent = sender
    this.playerTime.textContent = formatDuration(Date.now() - call.startedAt)
    this.playerTime.setAttribute('data-started-at', String(call.startedAt))
    if (activeCount > 1) {
      this.playerExtra.textContent = `+${activeCount - 1}`
    }
  }

  private updateDurations(): void {
    const startedAt = Number(this.playerTime.getAttribute('data-started-at'))
    if (Number.isFinite(startedAt) && startedAt > 0) {
      this.playerTime.textContent = formatDuration(Date.now() - startedAt)
    }
  }

  private syncAudio(state: RadioAudioPlayerState): void {
    const volume = Math.round(state.volume * 100)
    this.volumeSlider.value = volume
    this.volumeValue.textContent = `${volume}%`
    this.syncMuteCopy(state)

    const level = Math.min(1, state.level * 4)
    this.levelFill.style.width = `${(level * 100).toFixed(1)}%`
    toggleClass(this.levelMeter, 'active', state.level > 0)
    toggleClass(this.playerBar, 'audio-muted', state.muted)
    toggleClass(
      this.playerBar,
      'audio-blocked',
      state.contextState === 'uninitialized' || state.contextState === 'suspended',
    )
  }

  private syncMuteCopy(state: RadioAudioPlayerState): void {
    const label = this.localizationService.t(state.muted ? 'radio.unmute' : 'radio.mute')
    this.muteButton.setIcon(state.muted ? 'mute' : 'unmute')
    this.muteButton.setTitle(label)
    this.muteButton.element.setAttribute('aria-label', label)
    this.muteButton.setAriaPressed(state.muted)
  }
}
