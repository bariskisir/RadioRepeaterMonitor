import { Emitter, Event } from '@app/base/common/event'
import type { DisposableStore } from '@app/base/common/lifecycle'
import type { IChannel } from '@app/base/parts/ipc/common/ipc'
import { ICommandService } from '@app/platform/commands/common/commands'
import {
  type AppConfiguration,
  type AppConfigurationPatch,
  DEFAULT_CONFIGURATION,
  IConfigurationService,
} from '@app/platform/configuration/common/configuration'
import { CONFIGURATION_CHANNEL_NAME } from '@app/platform/configuration/common/configurationIpc'
import { TestInstantiationService } from '@app/platform/instantiation/test/common/instantiationServiceMock'
import { ILocalizationService } from '@app/platform/localization/common/localization'
import { ILogService } from '@app/platform/log/common/log'
import { LOG_CHANNEL_NAME } from '@app/platform/log/common/logIpc'
import { INativeHostService, type RuntimeInfo } from '@app/platform/native/common/native'
import { IProductService, ProductService } from '@app/platform/product/common/productService'
import { buildRadioDirectory } from '@app/platform/radio/common/directoryBuilder'
import { EMPTY_RADIO_SNAPSHOT, type RadioStateSnapshot } from '@app/platform/radio/common/radio'
import { RADIO_CHANNEL_NAME } from '@app/platform/radio/common/radioIpc'
import type { IColorScheme } from '@app/platform/theme/common/theme'
import { THEME_CHANNEL_NAME } from '@app/platform/theme/common/themeIpc'
import { IThemeService } from '@app/platform/theme/common/themeService'
import type { UpdateStateEvent } from '@app/platform/update/common/update'
import { UPDATE_CHANNEL_NAME } from '@app/platform/update/common/updateIpc'
import { DEFAULT_SIDEBAR_STATE, type SidebarState } from '@app/platform/window/common/window'
import { CommandService } from '@app/workbench/services/commands/browser/commandService'
import {
  IWorkbenchConfigurationService,
  WorkbenchConfigurationService,
} from '@app/workbench/services/configuration/browser/workbenchConfigurationService'
import {
  ContextMenuService,
  IContextMenuService,
} from '@app/workbench/services/contextmenu/browser/contextMenuService'
import { DialogService, IDialogService } from '@app/workbench/services/dialog/browser/dialogService'
import { IMainProcessService } from '@app/workbench/services/ipc/electron-browser/mainProcessService'
import {
  IWorkbenchLayoutService,
  WorkbenchLayoutService,
} from '@app/workbench/services/layout/browser/layoutService'
import {
  IWorkbenchLifecycleService,
  WorkbenchLifecycleService,
} from '@app/workbench/services/lifecycle/browser/lifecycleService'
import {
  IWorkbenchLocalizationService,
  WorkbenchLocalizationService,
} from '@app/workbench/services/localization/browser/localizationService'
import {
  IWorkbenchLogService,
  RendererLogService,
} from '@app/workbench/services/log/browser/rendererLogService'
import {
  INotificationService,
  NotificationService,
} from '@app/workbench/services/notification/browser/notificationService'
import {
  IWorkbenchRadioService,
  RadioWorkbenchService,
} from '@app/workbench/services/radio/browser/radioWorkbenchService'
import {
  IRadioAudioPlayer,
  RadioAudioPlayer,
} from '@app/workbench/services/radio/browser/radioAudioPlayer'
import {
  IWorkbenchThemeService,
  WorkbenchThemeService,
} from '@app/workbench/services/themes/browser/workbenchThemeService'
import {
  IWorkbenchUpdateService,
  UpdateWorkbenchService,
} from '@app/workbench/services/update/browser/updateWorkbenchService'
import {
  IViewDescriptorService,
  ViewDescriptorService,
} from '@app/workbench/services/views/browser/viewDescriptorService'
import { vi } from 'vitest'

export interface WorkbenchTestContext {
  readonly instantiationService: TestInstantiationService
  readonly configurationService: WorkbenchConfigurationService
  readonly layoutService: WorkbenchLayoutService
  readonly viewDescriptorService: ViewDescriptorService
  readonly radioService: RadioWorkbenchService
  readonly audioPlayer: RadioAudioPlayer
  readonly localizationService: WorkbenchLocalizationService
  readonly themeService: WorkbenchThemeService
  readonly updateService: UpdateWorkbenchService
  readonly notificationService: NotificationService
  readonly commandService: CommandService
  readonly contextMenuService: ContextMenuService
  readonly dialogService: DialogService
  readonly logService: RendererLogService
  readonly nativeHost: INativeHostService
  readonly updateStateEmitter: Emitter<UpdateStateEvent>
  readonly colorSchemeEmitter: Emitter<IColorScheme>
  readonly maximizedEmitter: Emitter<boolean>
  readonly fullScreenEmitter: Emitter<boolean>
  readonly openSettingsEmitter: Emitter<void>
  readonly radioStateEmitter: Emitter<RadioStateSnapshot>
  readonly openExternalSpy: ReturnType<typeof vi.fn>
}

export async function createWorkbenchTestContext(
  disposables: Pick<DisposableStore, 'add'>,
  options?: { readonly platform?: 'win32' | 'darwin' | 'linux' },
): Promise<WorkbenchTestContext> {
  const platform = options?.platform ?? 'win32'
  let storedConfig: AppConfiguration = { ...DEFAULT_CONFIGURATION }
  let sidebarState: SidebarState = { ...DEFAULT_SIDEBAR_STATE }
  let activeSessionId: string | null = null
  let radioSnapshot: RadioStateSnapshot = EMPTY_RADIO_SNAPSHOT
  const radioDirectory = buildRadioDirectory(
    [
      {
        id: '262101',
        callsign: 'DB0BER',
        city: 'Berlin',
        tx: '439.1000',
        rx: '431.5000',
        status: 3,
        last_seen: '2026-11-24 15:28:30',
      },
      {
        id: '262102',
        callsign: 'DB0ABC',
        city: 'Berlin',
        tx: '145.6000',
        rx: '145.0000',
        status: 3,
        last_seen: '2026-11-24 14:02:00',
      },
      {
        id: '262104',
        callsign: 'DB0OFF',
        city: 'Berlin',
        tx: '438.8000',
        rx: '431.3000',
        status: 2,
        last_seen: '2026-11-24 11:00:00',
      },
      {
        id: '262103',
        callsign: 'DM0HAM',
        city: 'Hamburg',
        tx: '439.9500',
        rx: '431.3500',
        status: 3,
        last_seen: '2026-11-24 15:20:00',
      },
      {
        id: '310201',
        callsign: 'W1AW',
        city: 'New York',
        tx: '441.0000',
        rx: '446.0000',
        status: 3,
        last_seen: '2026-11-24 15:25:00',
      },
      {
        id: '276101',
        callsign: 'ZA1A',
        city: 'Tirana',
        tx: '145.6000',
        rx: '145.0000',
        status: 2,
        last_seen: '2026-11-24 09:00:00',
      },
    ],
    1_700_000_000_000,
  )

  const configPush = disposables.add(new Emitter<AppConfiguration>())
  const colorSchemeEmitter = disposables.add(new Emitter<IColorScheme>())
  const updateStateEmitter = disposables.add(new Emitter<UpdateStateEvent>())
  const maximizedEmitter = disposables.add(new Emitter<boolean>())
  const fullScreenEmitter = disposables.add(new Emitter<boolean>())
  const openSettingsEmitter = disposables.add(new Emitter<void>())
  const radioStateEmitter = disposables.add(new Emitter<RadioStateSnapshot>())
  let updateState: UpdateStateEvent = { state: 'idle' }

  const channels: Record<string, IChannel> = {
    [CONFIGURATION_CHANNEL_NAME]: {
      async call<T>(command: string, arg?: unknown): Promise<T> {
        if (command === 'getConfiguration') {
          return { ...storedConfig } as T
        }
        if (command === 'updateConfiguration') {
          const patch = arg as AppConfigurationPatch
          const next: Record<string, unknown> = { ...storedConfig }
          for (const [key, value] of Object.entries(patch)) {
            if (value !== undefined) {
              next[key] = value
            }
          }
          storedConfig = next as unknown as AppConfiguration
          return { ...storedConfig } as T
        }
        if (command === 'resetConfiguration') {
          storedConfig = { ...DEFAULT_CONFIGURATION }
          return { ...storedConfig } as T
        }
        throw new Error(`Unknown config command: ${command}`)
      },
      listen: <T>() => configPush.event as Event<T>,
    },
    [RADIO_CHANNEL_NAME]: {
      async call<T>(command: string, arg?: unknown): Promise<T> {
        if (command === 'getSnapshot') {
          return radioSnapshot as T
        }
        if (command === 'getDirectory') {
          return radioDirectory as T
        }
        if (command === 'getRepeaterTalkgroups') {
          const deviceId = arg as string
          const talkgroups =
            deviceId === '262101'
              ? [
                  { talkgroup: 262, slot: 1, name: 'Germany' },
                  { talkgroup: 2024, slot: 2, name: 'Berlin' },
                ]
              : deviceId === '262102'
                ? [{ talkgroup: 262, slot: 1, name: 'Germany' }]
                : []
          return talkgroups as T
        }
        if (command === 'connect') {
          const talkgroups = arg as readonly number[]
          radioSnapshot = {
            ...EMPTY_RADIO_SNAPSHOT,
            state: 'connected',
            talkgroups: [...talkgroups],
            connectedAt: Date.now(),
          }
          radioStateEmitter.fire(radioSnapshot)
          return radioSnapshot as T
        }
        if (command === 'disconnect') {
          radioSnapshot = EMPTY_RADIO_SNAPSHOT
          radioStateEmitter.fire(radioSnapshot)
          return radioSnapshot as T
        }
        throw new Error(`Unknown radio command: ${command}`)
      },
      listen: <T>(eventName: string) =>
        (eventName === 'onDidChangeState' ? radioStateEmitter.event : Event.None) as Event<T>,
    },
    [THEME_CHANNEL_NAME]: {
      async call<T>(command: string): Promise<T> {
        if (command === 'getColorScheme') {
          return { dark: true } as T
        }
        return undefined as T
      },
      listen: <T>() => colorSchemeEmitter.event as Event<T>,
    },
    [UPDATE_CHANNEL_NAME]: {
      async call<T>(command: string): Promise<T> {
        if (command === 'getState') {
          return updateState as T
        }
        if (command === 'checkForUpdates') {
          updateState = { state: 'up-to-date', version: '2.0.0' }
          updateStateEmitter.fire(updateState)
        }
        return undefined as T
      },
      listen: <T>() => updateStateEmitter.event as Event<T>,
    },
    [LOG_CHANNEL_NAME]: {
      async call<T>(command: string): Promise<T> {
        if (command === 'getLogsSummary') {
          return { fileCount: 2, totalBytes: 2048 } as T
        }
        if (command === 'clearLogs') {
          return { fileCount: 0, totalBytes: 0 } as T
        }
        return undefined as T
      },
      listen: () => Event.None,
    },
  }

  const mainProcessService: IMainProcessService = {
    _serviceBrand: undefined,
    getChannel: (name) => {
      const channel = channels[name]
      if (!channel) {
        throw new Error(`Unknown channel: ${name}`)
      }
      return channel
    },
  }

  const openExternalSpy = vi.fn(async () => undefined)
  const runtimeInfo: RuntimeInfo = {
    appVersion: '2.0.0',
    electron: '45.4.1',
    chromium: '138.0.0',
    node: '24.0.0',
    v8: '13.8.0',
    os: 'Windows_NT 10.0',
    arch: 'x64',
    platform,
  }

  const nativeHost: INativeHostService = {
    _serviceBrand: undefined,
    onDidChangeWindowMaximized: maximizedEmitter.event,
    onDidChangeWindowFullScreen: fullScreenEmitter.event,
    onDidRequestOpenSettings: openSettingsEmitter.event,
    getPlatform: async () => platform,
    getVersion: async () => '2.0.0',
    getRuntimeInfo: async () => runtimeInfo,
    getSidebarState: async () => ({ ...sidebarState }),
    setSidebarState: async (next) => {
      sidebarState = { ...next }
    },
    getActiveSessionId: async () => activeSessionId,
    setActiveSessionId: async (id) => {
      activeSessionId = id
    },
    resetWindowLayout: vi.fn(async () => {
      sidebarState = { ...DEFAULT_SIDEBAR_STATE }
      return { ...DEFAULT_SIDEBAR_STATE }
    }),
    setAlwaysOnTop: vi.fn(async () => undefined),
    setOpacity: vi.fn(async (v: number) => v),
    getOpacity: async () => 1,
    minimizeWindow: vi.fn(async () => undefined),
    toggleMaximizeWindow: vi.fn(async () => true),
    isWindowMaximized: async () => false,
    toggleFullScreen: vi.fn(async () => true),
    isFullScreen: async () => false,
    closeWindow: vi.fn(async () => undefined),
    openExternal: openExternalSpy,
    openDataDirectory: vi.fn(async () => undefined),
    openLogsDirectory: vi.fn(async () => undefined),
    exportConfiguration: vi.fn(async () => ({
      status: 'completed' as const,
      filePath: '/cfg.json',
    })),
    importConfiguration: vi.fn(async () => ({
      status: 'completed' as const,
      configuration: { ...storedConfig },
    })),
    relaunch: vi.fn(async () => undefined),
  }

  const instantiationService = disposables.add(new TestInstantiationService())
  const productService = new ProductService('2.0.0')
  const notificationService = disposables.add(new NotificationService())
  const logService = disposables.add(new RendererLogService(mainProcessService, nativeHost))
  const configurationService = disposables.add(
    new WorkbenchConfigurationService(
      mainProcessService,
      nativeHost,
      logService,
      notificationService,
    ),
  )
  const localizationService = disposables.add(
    new WorkbenchLocalizationService(configurationService, logService),
  )
  const themeService = disposables.add(
    new WorkbenchThemeService(mainProcessService, configurationService, logService),
  )
  const layoutService = disposables.add(
    new WorkbenchLayoutService(
      nativeHost,
      configurationService,
      logService,
      notificationService,
      localizationService,
    ),
  )
  const radioService = disposables.add(
    new RadioWorkbenchService(
      mainProcessService,
      logService,
      notificationService,
      localizationService,
    ),
  )
  const audioPlayer = disposables.add(new RadioAudioPlayer(radioService))
  const updateService = disposables.add(
    new UpdateWorkbenchService(
      mainProcessService,
      logService,
      notificationService,
      localizationService,
    ),
  )
  const lifecycleService = disposables.add(new WorkbenchLifecycleService())
  const contextMenuService = disposables.add(new ContextMenuService())
  const dialogService = disposables.add(new DialogService())
  const commandService = disposables.add(new CommandService(instantiationService, logService))
  const viewDescriptorService = disposables.add(
    new ViewDescriptorService(layoutService, instantiationService),
  )

  instantiationService.set(IMainProcessService, mainProcessService)
  instantiationService.set(INativeHostService, nativeHost)
  instantiationService.set(IProductService, productService)
  instantiationService.set(INotificationService, notificationService)
  instantiationService.set(IWorkbenchLogService, logService)
  instantiationService.set(ILogService, logService)
  instantiationService.set(IWorkbenchConfigurationService, configurationService)
  instantiationService.set(IConfigurationService, configurationService)
  instantiationService.set(IWorkbenchLocalizationService, localizationService)
  instantiationService.set(ILocalizationService, localizationService)
  instantiationService.set(IWorkbenchThemeService, themeService)
  instantiationService.set(IThemeService, themeService)
  instantiationService.set(IWorkbenchLayoutService, layoutService)
  instantiationService.set(IWorkbenchRadioService, radioService)
  instantiationService.set(IRadioAudioPlayer, audioPlayer)
  instantiationService.set(IWorkbenchUpdateService, updateService)
  instantiationService.set(IWorkbenchLifecycleService, lifecycleService)
  instantiationService.set(IContextMenuService, contextMenuService)
  instantiationService.set(IDialogService, dialogService)
  instantiationService.set(ICommandService, commandService)
  instantiationService.set(IViewDescriptorService, viewDescriptorService)

  await localizationService.initialize()
  await configurationService.initialize()
  await themeService.initialize()
  await Promise.all([
    layoutService.initialize(),
    radioService.initialize(),
    updateService.initialize(),
  ])

  return {
    instantiationService,
    configurationService,
    layoutService,
    viewDescriptorService,
    radioService,
    audioPlayer,
    localizationService,
    themeService,
    updateService,
    notificationService,
    commandService,
    contextMenuService,
    dialogService,
    logService,
    nativeHost,
    updateStateEmitter,
    colorSchemeEmitter,
    maximizedEmitter,
    fullScreenEmitter,
    openSettingsEmitter,
    radioStateEmitter,
    openExternalSpy,
  }
}
