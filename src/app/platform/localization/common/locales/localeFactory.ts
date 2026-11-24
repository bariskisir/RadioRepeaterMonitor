import type { DateFormat, TimeFormat } from '@app/base/common/formatters'
import type { LogLevel } from '@app/platform/log/common/log'
import type { SideBarPosition } from '@app/platform/window/common/window'
import type { AppLocale } from '../localization'

export const TRAY_MENU_KEYS = ['open', 'settings', 'exit'] as const

export type TrayMenuKey = (typeof TRAY_MENU_KEYS)[number]

export interface RadioLocaleStrings {
  readonly navListen: string
  readonly navDirectory: string
  readonly title: string
  readonly subtitle: string
  readonly connect: string
  readonly disconnect: string
  readonly connecting: string
  readonly connected: string
  readonly reconnecting: string
  readonly idle: string
  readonly error: string
  readonly live: string
  readonly listening: string
  readonly selectedCount: string
  readonly allTurkey: string
  readonly allTurkeyDescription: string
  readonly clearSelection: string
  readonly listenSelected: string
  readonly searchTalkgroups: string
  readonly searchRepeaters: string
  readonly noSearchResults: string
  readonly searchResultsCount: string
  readonly country: string
  readonly city: string
  readonly allCities: string
  readonly region: string
  readonly talkgroup: string
  readonly talkgroups: string
  readonly repeater: string
  readonly repeaters: string
  readonly callsign: string
  readonly band: string
  readonly tx: string
  readonly rx: string
  readonly lastSeen: string
  readonly listenCity: string
  readonly worldRepeaterSummary: string
  readonly loadingDirectory: string
  readonly directoryLoadFailed: string
  readonly noRepeatersInCountry: string
  readonly noRepeaterTalkgroups: string
  readonly repeaterTalkgroupsFailed: string
  readonly unknownCity: string
  readonly generalTalkgroup: string
  readonly nowPlaying: string
  readonly activeTalkgroup: string
  readonly noActiveCall: string
  readonly silent: string
  readonly lastAudio: string
  readonly never: string
  readonly justNow: string
  readonly secondsAgo: string
  readonly minutesAgo: string
  readonly hoursAgo: string
  readonly recentCalls: string
  readonly noRecentCalls: string
  readonly source: string
  readonly unknownSource: string
  readonly duration: string
  readonly mute: string
  readonly unmute: string
  readonly volume: string
  readonly audioBlocked: string
  readonly enableAudio: string
  readonly audioLevel: string
  readonly audioUnsupported: string
  readonly quickStart: string
  readonly selectedTalkgroups: string
  readonly noSelection: string
  readonly remove: string
  readonly listen: string
  readonly stop: string
  readonly expandAll: string
  readonly collapseAll: string
  readonly repeaterCount: string
  readonly talkgroupCount: string
  readonly countries: Record<'tr', string>
  readonly regions: Record<
    | 'general'
    | 'marmara'
    | 'aegean'
    | 'mediterranean'
    | 'centralAnatolia'
    | 'blackSea'
    | 'east'
    | 'emergency',
    string
  >
}

export interface LocaleResource {
  app: Record<'name' | 'tagline', string>
  common: Record<
    'cancel' | 'rename' | 'delete' | 'dismiss' | 'loading' | 'retry' | 'save' | 'close',
    string
  >
  nav: Record<'sessions' | 'settings', string>
  trayMenu: Record<TrayMenuKey, string>
  sessions: Record<
    | 'newSession'
    | 'renameSession'
    | 'deleteAll'
    | 'deleteAllConfirmTitle'
    | 'deleteAllConfirmDescription'
    | 'searchPlaceholder'
    | 'noSearchResults'
    | 'pin'
    | 'unpin'
    | 'pinned'
    | 'emptyTitle',
    string
  >
  sidebar: Record<
    | 'primarySideBar'
    | 'secondarySideBar'
    | 'tertiarySideBar'
    | 'showPrimarySideBar'
    | 'hidePrimarySideBar'
    | 'showSecondarySideBar'
    | 'hideSecondarySideBar'
    | 'showTertiarySideBar'
    | 'hideTertiarySideBar'
    | 'movePrimarySideBarLeft'
    | 'movePrimarySideBarRight'
    | 'moveToPrimarySideBar'
    | 'moveToSecondarySideBar'
    | 'moveToTertiarySideBar'
    | 'moveView'
    | 'emptyHint'
    | 'customizeLayout'
    | 'toggleFullScreen'
    | 'resetViewLocations',
    string
  >
  workspace: Record<
    | 'title'
    | 'description'
    | 'shellTitle'
    | 'shellDescription'
    | 'sessionsTitle'
    | 'sessionsDescription'
    | 'securityTitle'
    | 'securityDescription'
    | 'compactView'
    | 'fullView',
    string
  >
  windowControls: Record<'minimize' | 'maximize' | 'restore' | 'close', string>
  statusBar: Record<'pinnedCount' | 'zoomLevel' | 'statusBar', string>
  settings: {
    title: string
    searchPlaceholder: string
    noSearchResults: string
    searchResultsCount: string
    modified: string
    resetSetting: string
    general: string
    languageAndRegion: string
    interfaceLanguage: string
    interfaceLanguageDescription: string
    dateFormat: string
    dateFormatDescription: string
    dateFormats: Record<DateFormat, string>
    timeFormat: string
    timeFormatDescription: string
    timeFormats: Record<TimeFormat, string>
    startup: string
    launchAtStartup: string
    launchAtStartupDescription: string
    startupUnavailable: string
    appearance: string
    interfaceSettings: string
    theme: string
    themeDescription: string
    sideBarLocation: string
    sideBarLocationDescription: string
    sideBarLocations: Record<SideBarPosition, string>
    statusBarVisible: string
    statusBarVisibleDescription: string
    pageZoom: string
    pageZoomDescription: string
    zoomOut: string
    zoomIn: string
    resetZoom: string
    windowSettings: string
    windowOpacity: string
    windowOpacityDescription: string
    alwaysOnTop: string
    alwaysOnTopDescription: string
    resetWindowLayout: string
    resetWindowLayoutDescription: string
    resetWindowLayoutAction: string
    windowLayoutReset: string
    trayAndTaskbar: string
    systemTray: string
    taskbar: string
    trayUnavailable: string
    showTrayIcon: string
    showTrayIconDescription: string
    minimizeToTrayOnClose: string
    minimizeToTrayOnCloseDescription: string
    trayIcon: string
    trayIconDescription: string
    trayIconDefault: string
    trayIconBluetooth: string
    trayIconWeather: string
    showTaskbar: string
    showTaskbarDescription: string
    startMinimized: string
    startMinimizedDescription: string
    hiddenFromShellWarning: string
    privacyAndData: string
    privacy: string
    contentProtection: string
    contentProtectionDescription: string
    telemetryCollection: string
    telemetryDescription: string
    dataAndBackup: string
    backupSettings: string
    backupSettingsDescription: string
    exportSettings: string
    importSettings: string
    settingsExported: string
    settingsImported: string
    dataFolder: string
    dataFolderDescription: string
    openFolder: string
    resetSettings: string
    resetSettingsDescription: string
    resetSettingsAction: string
    resetSettingsConfirmTitle: string
    resetSettingsConfirmDescription: string
    settingsReset: string
    system: string
    performance: string
    hardwareAcceleration: string
    hardwareAccelerationDescription: string
    restartRequired: string
    restartNow: string
    logging: string
    logLevel: string
    logLevelDescription: string
    logFiles: string
    logFilesDescription: string
    logFilesSummary: string
    openLogs: string
    clearLogs: string
    clearLogsConfirmTitle: string
    clearLogsConfirmDescription: string
    logsCleared: string
    logLevels: Record<LogLevel, string>
    updates: string
    checkUpdatesOnStartup: string
    checkUpdatesOnStartupDescription: string
    unattendedUpdates: string
    unattendedUpdatesDescription: string
    version: string
    checkUpdates: string
    checking: string
    upToDate: string
    updateAvailable: string
    downloading: string
    readyToInstall: string
    updateError: string
    installNow: string
    openDownloadPage: string
    releaseNotes: string
    about: string
    aboutSystemInfo: string
    aboutResources: string
    aboutVersionLabel: string
    aboutElectron: string
    aboutChromium: string
    aboutNode: string
    aboutV8: string
    aboutOs: string
    aboutLicense: string
    aboutLicenseValue: string
    author: string
    sourceCode: string
    releases: string
    releasesDescription: string
    reportIssue: string
    reportIssueDescription: string
  }
  themes: Record<'system' | 'light' | 'dark', string>
  locales: Record<AppLocale, string>
  errors: Record<'generic' | 'startup' | 'unexpected', string>
  radio?: RadioLocaleStrings
}

export const createLocale = (resource: LocaleResource): LocaleResource => resource
