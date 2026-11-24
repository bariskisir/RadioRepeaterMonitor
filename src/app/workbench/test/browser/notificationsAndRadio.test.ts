import { toDisposable } from '@app/base/common/lifecycle'
import {
  type FakeDomHarness,
  type FakeElement,
  installFakeDom,
} from '@app/base/test/browser/fakeDom'
import { ensureNoDisposablesAreLeakedInTestSuite, must } from '@app/base/test/common/utils'
import { ServiceCollection } from '@app/platform/instantiation/common/serviceCollection'
import { IMainProcessService } from '@app/workbench/services/ipc/electron-browser/mainProcessService'
import { INativeHostService } from '@app/platform/native/common/native'
import { IProductService, ProductService } from '@app/platform/product/common/productService'
import { NotificationsPart } from '@app/workbench/browser/parts/notifications/notificationsPart'
import { StartupOverlay } from '@app/workbench/browser/parts/notifications/startupOverlay'
import { RadioPlayerPart } from '@app/workbench/browser/parts/player/radioPlayerPart'
import { Workbench } from '@app/workbench/browser/workbench'
import {
  type WorkbenchContributionsRegistry,
  getWorkbenchContributionsRegistry,
} from '@app/workbench/common/contributions'
import { TR_REPEATERS, TR_TALKGROUPS } from '@app/platform/radio/common/catalog'
import {
  RADIO_LISTEN_VIEW_ID,
  RadioListenView,
  createRadioListenView,
} from '@app/workbench/contrib/radio/browser/radioListenView'
import {
  RADIO_DIRECTORY_VIEW_ID,
  RadioDirectoryView,
  createRadioDirectoryView,
} from '@app/workbench/contrib/radio/browser/radioDirectoryView'
import {
  WINDOW_COMMANDS,
  WindowWorkbenchContribution,
} from '@app/workbench/contrib/window/browser/window.contribution'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWorkbenchTestContext } from './workbenchTestServices'

describe('NotificationsPart, StartupOverlay, radio views, WindowWorkbenchContribution, and Workbench', () => {
  let dom: FakeDomHarness

  beforeEach(() => {
    dom = installFakeDom()
  })

  afterEach(() => {
    vi.useRealTimers()
    dom.restore()
  })

  const disposables = ensureNoDisposablesAreLeakedInTestSuite()

  it('displays and dismisses transient and update notifications and StartupOverlay states', async () => {
    const ctx = await createWorkbenchTestContext(disposables)
    const notificationsPart = disposables.add(
      ctx.instantiationService.createInstance(NotificationsPart),
    )
    notificationsPart.create(dom.container as unknown as HTMLElement)
    const notificationsEl = must(notificationsPart.element)

    vi.useFakeTimers()
    ctx.notificationService.success('Saved cleanly')
    expect(notificationsEl.querySelectorAll('.notification-toast')).toHaveLength(1)
    vi.advanceTimersByTime(4_100)
    expect(notificationsEl.querySelectorAll('.notification-toast')).toHaveLength(0)

    ctx.updateStateEmitter.fire({ state: 'downloading', version: '2.1.0', percent: 30 })
    ctx.updateStateEmitter.fire({ state: 'downloading', version: '2.1.0', percent: 75 })
    expect(notificationsEl.textContent).toContain('75%')

    ctx.updateStateEmitter.fire({ state: 'downloaded', version: '2.1.0' })
    const installBtn = notificationsEl.querySelector(
      '.notification-toast-actions .monaco-text-button',
    ) as unknown as FakeElement
    expect(installBtn).not.toBeNull()
    dom.dispatch(installBtn, 'click')

    ctx.updateStateEmitter.fire({
      state: 'available',
      version: '2.2.0',
      pageUrl: 'https://github.com/bariskisir/BaseApp/releases/latest',
    })
    const openBtn = notificationsEl.querySelector(
      '.notification-toast-actions .monaco-text-button',
    ) as unknown as FakeElement
    dom.dispatch(openBtn, 'click')
    expect(ctx.openExternalSpy).toHaveBeenCalledOnce()

    const dismissBtn = notificationsEl.querySelector(
      '.notification-toast-dismiss',
    ) as unknown as FakeElement
    dom.dispatch(dismissBtn, 'click')

    const overlay = disposables.add(new StartupOverlay(dom.container as unknown as HTMLElement))
    overlay.showLoading('Booting...')
    expect(overlay.element.classList.contains('hidden')).toBe(false)
    let retried = false
    overlay.showError('Failed', 'Retry', () => {
      retried = true
    })
    const retryBtn = overlay.element.querySelector('.monaco-text-button') as unknown as FakeElement
    dom.dispatch(retryBtn, 'click')
    expect(retried).toBe(true)
    overlay.hide()
    expect(overlay.element.classList.contains('hidden')).toBe(true)
  })

  it('operates RadioListenView tree, search, selection, and connection actions', async () => {
    const ctx = await createWorkbenchTestContext(disposables)
    const view = disposables.add(ctx.instantiationService.createInstance(RadioListenView))
    dom.container.appendChild(view.element as unknown as FakeElement)

    expect(view.id).toBe(RADIO_LISTEN_VIEW_ID)
    expect(view.getHeaderActions().map((item) => item.id)).toEqual(['radio-clear-selection'])
    expect(view.element.querySelectorAll('.radio-tree-country')).toHaveLength(1)
    expect(view.element.querySelectorAll('.radio-tree-region')).toHaveLength(8)
    expect(view.element.querySelectorAll('.radio-tree-row')).toHaveLength(TR_TALKGROUPS.length)

    const searchInput = view.element.querySelector(
      '.monaco-inputbox-input',
    ) as unknown as FakeElement
    searchInput.value = 'Ankara'
    dom.dispatch(searchInput, 'input')
    expect(view.element.querySelectorAll('.radio-tree-row')).toHaveLength(TR_TALKGROUPS.length)
    dom.dispatch(searchInput, 'keydown', { key: 'Enter' })
    expect(view.element.querySelectorAll('.radio-tree-row')).toHaveLength(1)

    searchInput.value = 'NoMatch'
    dom.dispatch(searchInput, 'input')
    expect(view.element.querySelector('.radio-view-empty')).toBeNull()
    dom.dispatch(searchInput, 'keydown', { key: 'Enter' })
    expect(view.element.querySelector('.radio-view-empty')).not.toBeNull()

    const clearButton = view.element.querySelector(
      '.monaco-inputbox-clear',
    ) as unknown as FakeElement
    dom.dispatch(clearButton, 'click')
    expect(view.element.querySelectorAll('.radio-tree-row')).toHaveLength(TR_TALKGROUPS.length)

    const firstRow = view.element.querySelector('.radio-tree-row') as unknown as FakeElement
    dom.dispatch(firstRow, 'click')
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(ctx.radioService.selectedTalkgroups).toHaveLength(1)
    expect(ctx.radioService.snapshot.state).toBe('connected')
    expect(ctx.radioService.snapshot.talkgroups).toHaveLength(1)

    const actions = view.getHeaderActions()
    actions[0]?.run()
    expect(ctx.radioService.selectedTalkgroups).toHaveLength(0)
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(ctx.radioService.snapshot.state).toBe('idle')

    const countryCheckbox = view.element.querySelector(
      '.radio-tree-country .radio-checkbox',
    ) as unknown as FakeElement
    countryCheckbox.checked = true
    dom.dispatch(countryCheckbox, 'change')
    expect(ctx.radioService.selectedTalkgroups).toHaveLength(TR_TALKGROUPS.length)

    await ctx.radioService.connect([...ctx.radioService.selectedTalkgroups])
    expect(ctx.radioService.snapshot.state).toBe('connected')
    expect(ctx.radioService.snapshot.talkgroups).toHaveLength(TR_TALKGROUPS.length)

    await ctx.radioService.disconnect()
    expect(ctx.radioService.snapshot.state).toBe('idle')

    const viaFactory = disposables.add(
      ctx.instantiationService.invokeFunction((accessor) => createRadioListenView(accessor)),
    )
    expect(viaFactory.id).toBe(RADIO_LISTEN_VIEW_ID)
    view.focus()
  })

  it('operates RadioDirectoryView country filters, world groups, and listen actions', async () => {
    const ctx = await createWorkbenchTestContext(disposables)
    const talkgroupRequests = vi.spyOn(ctx.radioService, 'getRepeaterTalkgroups')
    const view = disposables.add(ctx.instantiationService.createInstance(RadioDirectoryView))
    dom.container.appendChild(view.element as unknown as FakeElement)

    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(talkgroupRequests).not.toHaveBeenCalled()

    expect(view.id).toBe(RADIO_DIRECTORY_VIEW_ID)
    expect(view.getHeaderActions()).toHaveLength(0)
    expect(view.element.querySelectorAll('.radio-city-header').length).toBeGreaterThan(0)
    expect(view.element.querySelector('.radio-view-note')).toBeNull()
    expect(view.element.querySelectorAll('.radio-directory-row')).toHaveLength(TR_REPEATERS.length)

    const selects = view.element.querySelectorAll('.monaco-select-box') as unknown as FakeElement[]
    expect(selects).toHaveLength(2)

    dom.dispatch(must(selects[0]), 'click')
    const countryOptions = dom.document.body.querySelectorAll(
      '.monaco-select-box-option',
    ) as unknown as FakeElement[]
    expect(countryOptions.some((option) => option.textContent?.includes('Albania'))).toBe(false)
    const germany = countryOptions.find((option) => option.textContent?.includes('Germany'))
    expect(germany).toBeDefined()
    expect(countryOptions.some((option) => option.textContent?.includes('United States'))).toBe(
      true,
    )
    dom.dispatch(must(germany), 'click')

    const worldHeaders = view.element.querySelectorAll(
      '.radio-world-city-header',
    ) as unknown as FakeElement[]
    expect(worldHeaders).toHaveLength(2)
    expect(view.element.querySelectorAll('.radio-world-row')).toHaveLength(0)

    const berlin = worldHeaders.find((header) => header.textContent?.includes('Berlin'))
    dom.dispatch(must(berlin), 'click')
    expect(view.element.querySelectorAll('.radio-world-row')).toHaveLength(2)
    expect(talkgroupRequests).not.toHaveBeenCalled()

    const worldRows = view.element.querySelectorAll('.radio-world-row') as unknown as FakeElement[]
    const singleRow = worldRows.find((row) => row.textContent?.includes('DB0ABC'))
    dom.dispatch(must(singleRow), 'click')
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(talkgroupRequests).toHaveBeenCalledTimes(1)
    expect(ctx.radioService.snapshot.state).toBe('connected')
    expect(ctx.radioService.snapshot.talkgroups).toEqual([262])

    const multiRow = worldRows.find((row) => row.textContent?.includes('DB0BER'))
    dom.dispatch(must(multiRow), 'click')
    await new Promise((resolve) => setTimeout(resolve, 10))
    const talkgroupOptions = view.element.querySelectorAll(
      '.radio-world-talkgroup',
    ) as unknown as FakeElement[]
    expect(talkgroupOptions).toHaveLength(2)
    const berlinTalkgroup = talkgroupOptions.find((option) => option.textContent?.includes('2024'))
    dom.dispatch(must(berlinTalkgroup), 'click')
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(ctx.radioService.snapshot.talkgroups).toEqual([2024])
    expect(must(berlinTalkgroup).classList.contains('active')).toBe(true)
    expect(ctx.radioService.getTalkgroupContext(2024)).toEqual({
      country: 'Germany',
      region: 'Berlin',
      talkgroupName: 'Berlin',
    })

    const refreshedWorldHeaders = Array.from(
      view.element.querySelectorAll('.radio-world-city-header') as unknown as FakeElement[],
    )
    const hamburg = refreshedWorldHeaders.find((header) => header.textContent?.includes('Hamburg'))
    dom.dispatch(must(hamburg), 'click')
    const hamburgRow = Array.from(
      view.element.querySelectorAll('.radio-world-row') as unknown as FakeElement[],
    ).find((row) => row.textContent?.includes('DM0HAM'))
    expect(hamburgRow).toBeDefined()
    dom.dispatch(must(hamburgRow), 'click')
    await new Promise((resolve) => setTimeout(resolve, 10))
    const hamburgEntry = view.element.querySelector('[data-device-id="262103"]')
    expect(hamburgEntry).not.toBeNull()
    expect(hamburgEntry?.querySelector('.radio-world-notice')?.textContent).toContain(
      'No talkgroups',
    )

    dom.dispatch(must(selects[0]), 'click')
    const turkeyOptions = dom.document.body.querySelectorAll(
      '.monaco-select-box-option',
    ) as unknown as FakeElement[]
    const turkey = turkeyOptions[0]
    dom.dispatch(must(turkey), 'click')
    expect(view.element.querySelectorAll('.radio-directory-row')).toHaveLength(TR_REPEATERS.length)

    const searchInput = view.element.querySelector(
      '.monaco-inputbox-input',
    ) as unknown as FakeElement
    searchInput.value = 'YM5KAA'
    dom.dispatch(searchInput, 'input')
    expect(view.element.querySelectorAll('.radio-directory-row')).toHaveLength(TR_REPEATERS.length)
    dom.dispatch(searchInput, 'keydown', { key: 'Enter' })
    expect(view.element.querySelectorAll('.radio-directory-row')).toHaveLength(1)

    searchInput.value = 'NoMatch'
    dom.dispatch(searchInput, 'input')
    expect(view.element.querySelector('.radio-view-empty')).toBeNull()
    dom.dispatch(searchInput, 'keydown', { key: 'Enter' })
    expect(view.element.querySelector('.radio-view-empty')).not.toBeNull()

    const clearButton = view.element.querySelector(
      '.monaco-inputbox-clear',
    ) as unknown as FakeElement
    dom.dispatch(clearButton, 'click')
    expect(view.element.querySelectorAll('.radio-directory-row')).toHaveLength(TR_REPEATERS.length)

    const cityHeader = view.element.querySelector('.radio-city-header') as unknown as FakeElement
    dom.dispatch(cityHeader, 'click')
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(ctx.radioService.snapshot.state).toBe('connected')
    expect(ctx.radioService.snapshot.talkgroups).toHaveLength(1)
    expect(cityHeader.classList.contains('active')).toBe(true)

    const viaFactory = disposables.add(
      ctx.instantiationService.invokeFunction((accessor) => createRadioDirectoryView(accessor)),
    )
    expect(viaFactory.id).toBe(RADIO_DIRECTORY_VIEW_ID)
    view.focus()
  })

  it('handles WindowWorkbenchContribution keyboard shortcuts and zoom', async () => {
    const ctx = await createWorkbenchTestContext(disposables)
    disposables.add(ctx.instantiationService.createInstance(WindowWorkbenchContribution))

    dom.dispatch(dom.window, 'keydown', { key: 'b', ctrlKey: true })
    expect(ctx.layoutService.sidebarOpen).toBe(false)

    dom.dispatch(dom.window, 'keydown', { key: 'b', ctrlKey: true, altKey: true })
    expect(ctx.layoutService.auxiliaryBarOpen).toBe(false)
    dom.dispatch(dom.window, 'keydown', { key: 'b', ctrlKey: true, altKey: true })
    expect(ctx.layoutService.auxiliaryBarOpen).toBe(true)

    dom.dispatch(dom.window, 'keydown', { key: '=', ctrlKey: true })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(ctx.configurationService.getValue('zoomLevel')).toBe(1)

    dom.dispatch(dom.window, 'keydown', { key: '-', ctrlKey: true })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(ctx.configurationService.getValue('zoomLevel')).toBe(0)

    dom.dispatch(dom.window, 'keydown', { key: ',', ctrlKey: true })
    expect(ctx.layoutService.page).toBe('settings')

    await ctx.commandService.executeCommand(WINDOW_COMMANDS.cycleTheme)
    expect(ctx.configurationService.getValue('theme')).toBe('light')
    await ctx.commandService.executeCommand(WINDOW_COMMANDS.toggleAlwaysOnTop)
    expect(ctx.configurationService.getValue('alwaysOnTop')).toBe(true)
    await ctx.commandService.executeCommand(WINDOW_COMMANDS.toggleSideBarPosition)
    expect(ctx.configurationService.getValue('sideBarLocation')).toBe('right')
    await ctx.commandService.executeCommand(WINDOW_COMMANDS.toggleStatusBar)
    expect(ctx.configurationService.getValue('statusBarVisible')).toBe(false)
    await ctx.commandService.executeCommand(WINDOW_COMMANDS.toggleFullScreen)
    expect(ctx.nativeHost.toggleFullScreen).toHaveBeenCalledOnce()
    await ctx.commandService.executeCommand(WINDOW_COMMANDS.zoomIn)
    await ctx.commandService.executeCommand(WINDOW_COMMANDS.zoomOut)
    await ctx.commandService.executeCommand(WINDOW_COMMANDS.zoomReset)
    await ctx.commandService.executeCommand(WINDOW_COMMANDS.resetLayout)
    await ctx.commandService.executeCommand(WINDOW_COMMANDS.relaunch)
    expect(ctx.nativeHost.relaunch).toHaveBeenCalledOnce()

    dom.dispatch(dom.window, 'keydown', { key: '0', ctrlKey: true })
    ctx.maximizedEmitter.fire(true)
    expect(ctx.layoutService.maximized).toBe(true)
    ctx.fullScreenEmitter.fire(true)
    expect(ctx.layoutService.fullScreen).toBe(true)
    ctx.layoutService.setPage('home')
    ctx.openSettingsEmitter.fire()
    expect(ctx.layoutService.page).toBe('settings')

    const inputEl = dom.document.createElement('input')
    dom.document.body.appendChild(inputEl)
    const beforeSidebar = ctx.layoutService.sidebarOpen
    dom.dispatch(inputEl, 'keydown', { key: 'b', ctrlKey: true, bubbles: true })
    expect(ctx.layoutService.sidebarOpen).toBe(beforeSidebar)
  })

  it('renders the full-width radio player bar and reflects connection and mute state', async () => {
    const ctx = await createWorkbenchTestContext(disposables)
    const player = disposables.add(ctx.instantiationService.createInstance(RadioPlayerPart))
    player.create(dom.container as unknown as HTMLElement)
    const playerEl = must(player.element)
    const bar = playerEl.querySelector('.radio-player-bar') as unknown as FakeElement

    expect(bar).not.toBeNull()
    expect(playerEl.querySelector('.radio-player-title')?.textContent).toContain('No talkgroups')

    const muteButton = playerEl.querySelector('button[aria-label="Mute"]') as unknown as FakeElement
    expect(playerEl.querySelector('.radio-player-volume-main')).toBeNull()
    dom.dispatch(muteButton, 'click')
    expect(muteButton.getAttribute('aria-label')).toBe('Unmute')
    expect(muteButton.getAttribute('aria-pressed')).toBe('true')
    expect(bar.classList.contains('audio-muted')).toBe(true)
    dom.dispatch(muteButton, 'click')
    expect(muteButton.getAttribute('aria-label')).toBe('Mute')
    expect(muteButton.getAttribute('aria-pressed')).toBe('false')
    expect(bar.classList.contains('audio-muted')).toBe(false)

    await ctx.radioService.connect([28634])
    expect(playerEl.querySelector('.radio-player-title')?.textContent).toContain('Quiet')
    expect(bar.getAttribute('data-state')).toBe('connected')

    ctx.radioStateEmitter.fire({
      ...ctx.radioService.snapshot,
      state: 'connected',
      talkgroups: [28634],
      activeCalls: [
        {
          id: 'call-tr-1',
          talkgroup: 28634,
          sourceId: 2861234,
          callsign: 'TA1ABC',
          startedAt: Date.now() - 4000,
          lastAudioAt: Date.now(),
        },
      ],
    })
    expect(bar.classList.contains('live')).toBe(true)
    expect(playerEl.querySelector('.radio-player-title')?.textContent).toBe(
      'Türkiye – Marmara – İstanbul – TG 28634',
    )
    expect(playerEl.querySelector('.radio-player-subtitle')?.textContent).toBe('TA1ABC')

    ctx.radioService.rememberTalkgroupContext(2024, {
      country: 'Germany',
      region: 'Berlin',
      talkgroupName: 'Berlin',
    })
    ctx.radioStateEmitter.fire({
      ...ctx.radioService.snapshot,
      state: 'connected',
      talkgroups: [2024],
      activeCalls: [
        {
          id: 'call-de-1',
          talkgroup: 2024,
          sourceId: 2621234,
          callsign: 'DL1XYZ',
          startedAt: Date.now() - 2000,
          lastAudioAt: Date.now(),
        },
      ],
    })
    expect(playerEl.querySelector('.radio-player-title')?.textContent).toBe(
      'Germany – Berlin – TG 2024',
    )
    expect(playerEl.querySelector('.radio-player-subtitle')?.textContent).toBe('DL1XYZ')

    await ctx.radioService.disconnect()
    expect(bar.getAttribute('data-state')).toBe('idle')
  })

  it('mounts the Workbench shell without ActivityBar or tertiary sidebar and completes bootstrap', async () => {
    const ctx = await createWorkbenchTestContext(disposables)
    const services = new ServiceCollection(
      [IMainProcessService, ctx.instantiationService.get(IMainProcessService)],
      [INativeHostService, ctx.nativeHost],
      [IProductService, new ProductService('2.0.0')],
    )

    const root = dom.document.createElement('div')
    dom.document.body.appendChild(root)
    disposables.add(
      toDisposable(() => {
        ;(getWorkbenchContributionsRegistry() as WorkbenchContributionsRegistry).clearForTest()
      }),
    )
    const workbench = disposables.add(new Workbench(root as unknown as HTMLElement, services))
    await workbench.startup()

    expect(root.querySelector('.part.titlebar')).not.toBeNull()
    expect(root.querySelector('.part.activitybar')).toBeNull()
    expect(root.querySelector('.part.sidebar')).not.toBeNull()
    expect(root.querySelector('.monaco-workbench-center')).not.toBeNull()
    expect(root.querySelector('.part.editor')).not.toBeNull()
    expect(root.querySelector('.part.tertiarybar')).toBeNull()
    expect(root.querySelector('.part.auxiliarybar')).not.toBeNull()
    expect(root.querySelector('.part.radio-player')).not.toBeNull()
    expect(root.querySelector('.part.statusbar')).not.toBeNull()
    expect(root.querySelector('.part.notifications')).not.toBeNull()
    expect(root.querySelector('.startup-overlay')?.classList.contains('hidden')).toBe(true)
  })
})
