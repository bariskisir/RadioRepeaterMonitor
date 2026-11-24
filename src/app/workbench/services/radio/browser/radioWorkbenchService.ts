import { Emitter, type Event } from '@app/base/common/event'
import { Disposable } from '@app/base/common/lifecycle'
import { InstantiationType, registerSingleton } from '@app/platform/instantiation/common/extensions'
import { createDecorator } from '@app/platform/instantiation/common/instantiation'
import { ILogService } from '@app/platform/log/common/log'
import { TR_TALKGROUP_IDS } from '@app/platform/radio/common/catalog'
import {
  EMPTY_RADIO_SNAPSHOT,
  type RadioAudioChunk,
  type RadioDirectorySnapshot,
  type RadioLogEntry,
  type RadioRepeaterTalkgroup,
  type RadioStateSnapshot,
} from '@app/platform/radio/common/radio'
import { RADIO_CHANNEL_NAME, RadioChannelClient } from '@app/platform/radio/common/radioIpc'
import { IMainProcessService } from '@app/workbench/services/ipc/electron-browser/mainProcessService'
import { IWorkbenchLocalizationService } from '@app/workbench/services/localization/browser/localizationService'
import { INotificationService } from '@app/workbench/services/notification/browser/notificationService'

const SELECTION_APPLY_DELAY_MS = 350

export interface RadioTalkgroupContext {
  readonly country?: string | undefined
  readonly region?: string | undefined
  readonly talkgroupName?: string | undefined
}

export interface IWorkbenchRadioService {
  readonly _serviceBrand: undefined
  readonly snapshot: RadioStateSnapshot
  readonly selectedTalkgroups: readonly number[]
  readonly onDidChangeState: Event<RadioStateSnapshot>
  readonly onDidChangeSelection: Event<readonly number[]>
  readonly onDidReceiveAudio: Event<RadioAudioChunk>
  readonly onDidReceiveLog: Event<RadioLogEntry>
  initialize(): Promise<void>
  getDirectory(): Promise<RadioDirectorySnapshot>
  getRepeaterTalkgroups(deviceId: string): Promise<readonly RadioRepeaterTalkgroup[]>
  rememberTalkgroupContext(talkgroupId: number, context: RadioTalkgroupContext): void
  getTalkgroupContext(talkgroupId: number): RadioTalkgroupContext | undefined
  connect(talkgroups: readonly number[]): Promise<void>
  disconnect(): Promise<void>
  toggleTalkgroup(talkgroupId: number): void
  setSelectedTalkgroups(talkgroups: readonly number[]): void
  selectAllTurkey(): void
  clearSelection(): void
}

export const IWorkbenchRadioService =
  createDecorator<IWorkbenchRadioService>('workbenchRadioService')

export class RadioWorkbenchService extends Disposable implements IWorkbenchRadioService {
  declare readonly _serviceBrand: undefined

  private readonly _onDidChangeState = this._register(new Emitter<RadioStateSnapshot>())
  readonly onDidChangeState: Event<RadioStateSnapshot> = this._onDidChangeState.event

  private readonly _onDidChangeSelection = this._register(new Emitter<readonly number[]>())
  readonly onDidChangeSelection: Event<readonly number[]> = this._onDidChangeSelection.event

  private readonly _onDidReceiveAudio = this._register(new Emitter<RadioAudioChunk>())
  readonly onDidReceiveAudio: Event<RadioAudioChunk> = this._onDidReceiveAudio.event

  private readonly _onDidReceiveLog = this._register(new Emitter<RadioLogEntry>())
  readonly onDidReceiveLog: Event<RadioLogEntry> = this._onDidReceiveLog.event

  private readonly channelClient: RadioChannelClient
  private readonly talkgroupContexts = new Map<number, RadioTalkgroupContext>()
  private _snapshot: RadioStateSnapshot = EMPTY_RADIO_SNAPSHOT
  private _selectedTalkgroups: number[] = []
  private initialized = false
  private applyTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    @IMainProcessService mainProcessService: IMainProcessService,
    @ILogService private readonly logService: ILogService,
    @INotificationService private readonly notificationService: INotificationService,
    @IWorkbenchLocalizationService
    private readonly localizationService: IWorkbenchLocalizationService,
  ) {
    super()
    this.channelClient = new RadioChannelClient(mainProcessService.getChannel(RADIO_CHANNEL_NAME))
  }

  get snapshot(): RadioStateSnapshot {
    return this._snapshot
  }

  get selectedTalkgroups(): readonly number[] {
    return this._selectedTalkgroups
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return
    }
    this.initialized = true

    this._register(
      this.channelClient.onDidChangeState((snapshot) => {
        this.setSnapshot(snapshot)
      }),
    )
    this._register(
      this.channelClient.onDidReceiveAudio((chunk) => {
        this._onDidReceiveAudio.fire(chunk)
      }),
    )
    this._register(
      this.channelClient.onDidReceiveLog((entry) => {
        this._onDidReceiveLog.fire(entry)
      }),
    )

    try {
      const snapshot = await this.channelClient.getSnapshot()
      this.setSnapshot(snapshot)
      if (snapshot.talkgroups.length > 0 && this._selectedTalkgroups.length === 0) {
        this.setSelection(snapshot.talkgroups)
      }
    } catch (error) {
      this.reportFailure('Radio state could not be loaded.', error)
    }
  }

  async getDirectory(): Promise<RadioDirectorySnapshot> {
    return this.channelClient.getDirectory()
  }

  async getRepeaterTalkgroups(deviceId: string): Promise<readonly RadioRepeaterTalkgroup[]> {
    return this.channelClient.getRepeaterTalkgroups(deviceId)
  }

  rememberTalkgroupContext(talkgroupId: number, context: RadioTalkgroupContext): void {
    const existing = this.talkgroupContexts.get(talkgroupId)
    const country = context.country?.trim() || existing?.country
    const region = context.region?.trim() || existing?.region
    const talkgroupName = context.talkgroupName?.trim() || existing?.talkgroupName
    this.talkgroupContexts.set(talkgroupId, {
      ...(country ? { country } : {}),
      ...(region ? { region } : {}),
      ...(talkgroupName ? { talkgroupName } : {}),
    })
  }

  getTalkgroupContext(talkgroupId: number): RadioTalkgroupContext | undefined {
    return this.talkgroupContexts.get(talkgroupId)
  }

  async connect(talkgroups: readonly number[]): Promise<void> {
    this.cancelPendingSelectionApply()
    const selected = Array.from(new Set(talkgroups))
    if (selected.length === 0) {
      await this.disconnect()
      return
    }

    this.setSelection(selected)
    this.setSnapshot({
      ...this._snapshot,
      state: 'connecting',
      talkgroups: selected,
      lastError: null,
    })

    try {
      this.setSnapshot(await this.channelClient.connect(selected))
    } catch (error) {
      this.setSnapshot({
        ...this._snapshot,
        state: 'error',
        lastError: error instanceof Error ? error.message : String(error),
      })
      this.reportFailure('Radio connection could not be started.', error)
    }
  }

  async disconnect(): Promise<void> {
    this.cancelPendingSelectionApply()
    try {
      this.setSnapshot(await this.channelClient.disconnect())
    } catch (error) {
      this.reportFailure('Radio connection could not be stopped.', error)
    }
  }

  toggleTalkgroup(talkgroupId: number): void {
    const next = this._selectedTalkgroups.includes(talkgroupId)
      ? this._selectedTalkgroups.filter((id) => id !== talkgroupId)
      : [...this._selectedTalkgroups, talkgroupId]
    this.setSelection(next)
    this.scheduleSelectionApply()
  }

  setSelectedTalkgroups(talkgroups: readonly number[]): void {
    this.setSelection(Array.from(new Set(talkgroups)))
    this.scheduleSelectionApply()
  }

  selectAllTurkey(): void {
    this.setSelection(TR_TALKGROUP_IDS)
    this.scheduleSelectionApply()
  }

  clearSelection(): void {
    this.setSelection([])
    this.scheduleSelectionApply()
  }

  override dispose(): void {
    this.cancelPendingSelectionApply()
    super.dispose()
  }

  private setSelection(talkgroups: readonly number[]): void {
    const next = [...talkgroups].sort((left, right) => left - right)
    if (
      next.length === this._selectedTalkgroups.length &&
      next.every((talkgroup, index) => talkgroup === this._selectedTalkgroups[index])
    ) {
      return
    }
    this._selectedTalkgroups = next
    this._onDidChangeSelection.fire(next)
  }

  private scheduleSelectionApply(): void {
    this.cancelPendingSelectionApply()
    if (this._snapshot.state !== 'connected' && this._snapshot.state !== 'reconnecting') {
      return
    }
    this.applyTimer = setTimeout(() => {
      this.applyTimer = null
      if (this.isDisposed) {
        return
      }
      if (this._selectedTalkgroups.length === 0) {
        void this.disconnect()
      } else {
        void this.connect(this._selectedTalkgroups)
      }
    }, SELECTION_APPLY_DELAY_MS)
  }

  private cancelPendingSelectionApply(): void {
    if (this.applyTimer) {
      clearTimeout(this.applyTimer)
      this.applyTimer = null
    }
  }

  private setSnapshot(snapshot: RadioStateSnapshot): void {
    this._snapshot = snapshot
    this._onDidChangeState.fire(snapshot)
  }

  private reportFailure(message: string, error: unknown): void {
    this.logService.error('RadioWorkbenchService', message, error)
    this.notificationService.error(this.localizationService.t('errors.generic'))
  }
}

registerSingleton(IWorkbenchRadioService, RadioWorkbenchService, InstantiationType.Eager)
