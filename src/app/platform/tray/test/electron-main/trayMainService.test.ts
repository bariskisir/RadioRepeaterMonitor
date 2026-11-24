import { ensureNoDisposablesAreLeakedInTestSuite } from '@app/base/test/common/utils'
import type { IEnvironmentMainService } from '@app/platform/environment/electron-main/environmentMainService'
import type { ILogService } from '@app/platform/log/common/log'
import { ProductService } from '@app/platform/product/common/productService'
import { TrayMainService } from '@app/platform/tray/electron-main/trayMainService'
import type { IWindowManager } from '@app/platform/window/electron-main/windowManager'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const trayState = vi.hoisted(() => {
  type MenuEntry = { label: string; click?: () => void; role?: string }
  class HoistedFakeTray {
    destroyed = false
    tooltip = ''
    contextMenuSetCount = 0
    setImageCount = 0
    private readonly listeners = new Map<string, Set<() => void>>()

    constructor(public image: unknown) {
      state.createdTrays.push(this)
    }

    on(event: string, listener: () => void): void {
      let set = this.listeners.get(event)
      if (!set) {
        set = new Set()
        this.listeners.set(event, set)
      }
      set.add(listener)
    }

    removeListener(event: string, listener: () => void): void {
      this.listeners.get(event)?.delete(listener)
    }

    emit(event: string): void {
      for (const listener of [...(this.listeners.get(event) ?? [])]) {
        listener()
      }
    }

    setToolTip(tip: string): void {
      this.tooltip = tip
    }

    setImage(image: unknown): void {
      this.image = image
      this.setImageCount += 1
    }

    setContextMenu(): void {
      this.contextMenuSetCount += 1
    }

    destroy(): void {
      this.destroyed = true
    }
  }

  const state = {
    createdTrays: [] as HoistedFakeTray[],
    lastMenuTemplate: [] as MenuEntry[],
    emptyImage: false,
    FakeTray: HoistedFakeTray,
  }
  return state
})

vi.mock('electron', () => ({
  Tray: trayState.FakeTray,
  Menu: {
    buildFromTemplate(template: Array<{ label: string; click?: () => void; role?: string }>) {
      trayState.lastMenuTemplate = template
      return template
    },
  },
  nativeImage: {
    createFromPath: (path: string) => ({
      iconPath: path,
      isEmpty: () => trayState.emptyImage,
      resize: () => ({ iconPath: path, resized: true }),
    }),
  },
}))

describe('TrayMainService', () => {
  const disposables = ensureNoDisposablesAreLeakedInTestSuite()

  beforeEach(() => {
    trayState.createdTrays = []
    trayState.lastMenuTemplate = []
    trayState.emptyImage = false
  })

  it('creates tray icon, updates menu locale in place, switches presets, and handles quit/errors', () => {
    const requestOpenSettings = vi.fn()
    const windowManager = {
      getMainWindow: () => ({
        isDestroyed: () => false,
        isMinimized: () => false,
        show: vi.fn(),
        restore: vi.fn(),
        focus: vi.fn(),
      }),
      requestOpenSettings,
    } as unknown as IWindowManager

    const env = {
      platform: 'win32' as const,
      isPackaged: false,
      appPath: '/app',
      resourcesPath: '/res',
    } as unknown as IEnvironmentMainService
    const logService = { error: vi.fn() } as unknown as ILogService
    const product = new ProductService('2.0.0')

    const trayService = disposables.add(
      new TrayMainService(windowManager, env, logService, product),
    )
    expect(trayService.shouldMinimizeOnClose()).toBe(false)

    trayService.applyConfiguration({
      showTrayIcon: true,
      minimizeToTrayOnClose: true,
      trayIcon: 'default',
      uiLanguage: 'en',
    })
    expect(trayState.createdTrays).toHaveLength(1)
    expect(trayService.shouldMinimizeOnClose()).toBe(true)
    const tray = trayState.createdTrays[0]
    expect(tray).toBeDefined()
    if (!tray) {
      throw new Error('Tray was not created.')
    }
    expect((tray.image as { iconPath?: string }).iconPath).toContain('icon.png')

    trayService.setReceivingAudio(true)
    expect(trayState.createdTrays).toHaveLength(1)
    expect(tray.setImageCount).toBe(1)
    expect((tray.image as { iconPath?: string }).iconPath).toContain('tray-icon-active.png')
    trayService.setReceivingAudio(false)
    expect(tray.setImageCount).toBe(2)
    expect((tray.image as { iconPath?: string }).iconPath).toContain('icon.png')

    trayService.applyConfiguration({
      showTrayIcon: true,
      minimizeToTrayOnClose: true,
      trayIcon: 'default',
      uiLanguage: 'tr',
    })
    expect(trayState.createdTrays).toHaveLength(1)
    expect(tray.contextMenuSetCount).toBe(2)

    trayState.lastMenuTemplate[0]?.click?.()
    trayState.lastMenuTemplate[1]?.click?.()
    expect(requestOpenSettings).toHaveBeenCalledOnce()
    tray.emit('click')

    trayService.applyConfiguration({
      showTrayIcon: true,
      minimizeToTrayOnClose: false,
      trayIcon: 'weather',
      uiLanguage: 'tr',
    })
    expect(trayState.createdTrays).toHaveLength(1)
    expect(tray.destroyed).toBe(false)
    expect(tray.setImageCount).toBe(3)
    expect((tray.image as { iconPath?: string }).iconPath).toContain('tray-icon-weather.png')

    trayState.emptyImage = true
    trayService.applyConfiguration({
      showTrayIcon: true,
      minimizeToTrayOnClose: false,
      trayIcon: 'bluetooth',
      uiLanguage: 'tr',
    })
    expect(logService.error).toHaveBeenCalled()

    trayService.prepareToQuit()
    expect(trayService.shouldMinimizeOnClose()).toBe(false)

    const linuxTray = disposables.add(
      new TrayMainService(
        windowManager,
        { ...env, platform: 'linux' } as unknown as IEnvironmentMainService,
        logService,
        product,
      ),
    )
    linuxTray.applyConfiguration({ showTrayIcon: true, minimizeToTrayOnClose: true })
    expect(linuxTray.shouldMinimizeOnClose()).toBe(false)
  })
})
