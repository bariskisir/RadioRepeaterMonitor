import { Event } from '@app/base/common/event'
import { DisposableStore } from '@app/base/common/lifecycle'
import {
  FakeDataTransfer,
  type FakeDomHarness,
  type FakeElement,
  installFakeDom,
} from '@app/base/test/browser/fakeDom'
import { ensureNoDisposablesAreLeakedInTestSuite, must } from '@app/base/test/common/utils'
import { AuxiliaryBarPart } from '@app/workbench/browser/parts/auxiliarybar/auxiliaryBarPart'
import { SidebarPart } from '@app/workbench/browser/parts/sidebar/sidebarPart'
import { VIEW_DRAG_MIME_TYPE } from '@app/workbench/browser/viewPane'
import { registerView } from '@app/workbench/common/views'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createWorkbenchTestContext } from './workbenchTestServices'

describe('Primary and Secondary sidebar parts', () => {
  let dom: FakeDomHarness

  beforeEach(() => {
    dom = installFakeDom()
  })

  afterEach(() => {
    dom.restore()
  })

  const disposables = ensureNoDisposablesAreLeakedInTestSuite()

  it('starts at minimum default sizes, opens the move menu, supports drag-and-drop and Sash resizing', async () => {
    const ctx = await createWorkbenchTestContext(disposables)

    const regOne = disposables.add(
      registerView({
        id: 'test.sidebar.one',
        titleKey: 'nav.sessions',
        iconId: 'files',
        defaultLocation: 'sidebar',
        order: 1,
        canMoveView: true,
        factory: () => () => {
          const store = new DisposableStore()
          const element = dom.document.createElement('div') as unknown as HTMLElement
          element.textContent = 'View One'
          return {
            id: 'test.sidebar.one',
            element,
            onDidChangeHeaderActions: Event.None,
            getHeaderActions: () => [],
            dispose: () => store.dispose(),
          }
        },
      }),
    )
    const regTwo = disposables.add(
      registerView({
        id: 'test.sidebar.two',
        titleKey: 'nav.settings',
        iconId: 'settings-gear',
        defaultLocation: 'sidebar',
        order: 2,
        canMoveView: true,
        factory: () => () => {
          const store = new DisposableStore()
          const element = dom.document.createElement('div') as unknown as HTMLElement
          element.textContent = 'View Two'
          return {
            id: 'test.sidebar.two',
            element,
            onDidChangeHeaderActions: Event.None,
            getHeaderActions: () => [],
            dispose: () => store.dispose(),
          }
        },
      }),
    )

    const primary = disposables.add(ctx.instantiationService.createInstance(SidebarPart))
    const secondary = disposables.add(ctx.instantiationService.createInstance(AuxiliaryBarPart))

    primary.create(dom.container as unknown as HTMLElement)
    secondary.create(dom.container as unknown as HTMLElement)

    const primaryEl = must(primary.element)
    const secondaryEl = must(secondary.element)

    expect(primaryEl.style.width).toBe('340px')
    expect(secondaryEl.style.width).toBe('340px')

    const viewTabs = primaryEl.querySelectorAll('.sidebar-view-tab') as unknown as FakeElement[]
    expect(viewTabs).toHaveLength(2)
    dom.dispatch(must(viewTabs[1]), 'click')
    expect(ctx.viewDescriptorService.getActiveViewId('sidebar')).toBe('test.sidebar.two')

    const moveButton = primaryEl.querySelector(
      'button[aria-label="Move View"]',
    ) as unknown as FakeElement
    expect(moveButton).not.toBeNull()
    dom.dispatch(moveButton, 'click')

    const menuItems = dom.document.body.querySelectorAll('.monaco-menu-item')
    expect(menuItems).toHaveLength(1)
    expect(menuItems[0]?.textContent).toContain('Secondary Side Bar')

    dom.dispatch(must(menuItems[0]), 'click')
    expect(ctx.viewDescriptorService.getViewLocation('test.sidebar.two')).toBe('auxiliarybar')
    expect(ctx.layoutService.auxiliaryBarOpen).toBe(true)

    const dt = new FakeDataTransfer()
    dt.setData(VIEW_DRAG_MIME_TYPE, 'test.sidebar.one')
    dom.dispatch(secondaryEl as unknown as FakeElement, 'dragenter', { dataTransfer: dt })
    dom.dispatch(secondaryEl as unknown as FakeElement, 'dragover', { dataTransfer: dt })
    dom.dispatch(secondaryEl as unknown as FakeElement, 'drop', { dataTransfer: dt })
    expect(ctx.viewDescriptorService.getViewLocation('test.sidebar.one')).toBe('auxiliarybar')
    expect(ctx.layoutService.auxiliaryBarOpen).toBe(true)

    const primaryHeader = primaryEl.querySelector('.sidebar-header') as unknown as FakeElement
    dom.dispatch(primaryHeader, 'contextmenu', { clientX: 50, clientY: 50 })
    expect(dom.document.body.querySelector('.monaco-menu')).not.toBeNull()

    const primaryEmptyButtons = primaryEl.querySelectorAll(
      '.sidebar-empty-actions .monaco-text-button',
    ) as unknown as FakeElement[]
    expect(primaryEmptyButtons.length).toBeGreaterThanOrEqual(2)
    dom.dispatch(must(primaryEmptyButtons[0]), 'click')

    const primarySash = primaryEl.querySelector('.monaco-sash.vertical') as unknown as FakeElement
    dom.dispatch(primarySash, 'pointerdown', { button: 0, clientX: 340, pointerId: 2 })
    dom.dispatch(dom.window, 'pointermove', { clientX: 250 })
    dom.dispatch(dom.window, 'pointerup')
    expect(ctx.layoutService.sidebarWidth).toBe(250)

    regOne.dispose()
    regTwo.dispose()
  })
})
