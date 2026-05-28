// @vitest-environment happy-dom
import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Dropdown } from '@memex/common/features/ui-components/dropdown'
import { normalizeLocalProductThemeSettings } from '~/utils/product-theme-bootstrap'
import { useUIContext } from '~/ui-scripts/context-provider'
import { ObsidianRuntimeProvider } from './runtime'
import type { ObsidianRuntime } from './runtime'

function createRuntime(state: Record<string, unknown>): ObsidianRuntime {
    return {
        subscribeState: vi.fn(() => () => {}),
        getStateSnapshot: vi.fn(() => state),
        getContextValue: vi.fn(() => ({
            services: {
                icons: {
                    getAllIconURLs: () => ({}),
                },
            },
            bgModules: {},
            events: {
                emit: vi.fn(),
                listen: vi.fn(() => () => {}),
            },
            globalLogic: {
                state,
                registerOverlay: vi.fn(),
                unregisterOverlay: vi.fn(),
                getOverlayZIndex: vi.fn(() => 1200),
            },
            globalState: state,
        })),
    } as unknown as ObsidianRuntime
}

const DropdownProbe: React.FC = () => {
    const context = useUIContext()
    const [targetElement, setTargetElement] =
        React.useState<HTMLButtonElement | null>(null)

    return React.createElement(
        React.Fragment,
        null,
        React.createElement(
            'button',
            { ref: setTargetElement, type: 'button' },
            'Open',
        ),
        targetElement != null
            ? React.createElement(Dropdown, {
                  targetRef: targetElement,
                  items: [
                      {
                          id: 'probe',
                          label: 'Probe action',
                          action: vi.fn(),
                      },
                  ],
                  onClose: vi.fn(),
                  portalContainer: context.shadowRoot,
              })
            : null,
    )
}

describe('ObsidianRuntimeProvider style isolation', () => {
    let root: Root | null = null

    beforeEach(() => {
        ;(
            globalThis as {
                IS_REACT_ACT_ENVIRONMENT?: boolean
            }
        ).IS_REACT_ACT_ENVIRONMENT = true
    })

    afterEach(async () => {
        await act(async () => {
            root?.unmount()
        })
        root = null
        document.body.innerHTML = ''
        document.head.innerHTML = ''
        document.documentElement.removeAttribute('data-memex-theme')
        document.documentElement.removeAttribute('style')
    })

    it('scopes styled-components styles and theme variables to the Obsidian shadow root', async () => {
        const host = document.createElement('div')
        const shadowRoot = host.attachShadow({ mode: 'open' })
        const mount = document.createElement('div')
        shadowRoot.appendChild(mount)
        document.body.appendChild(host)
        const runtime = createRuntime({
            colorTheme: 'dark',
            productThemeSettings: normalizeLocalProductThemeSettings(null),
            contentEntities: {},
            referencesByContentEntityId: {},
            tags: { tagEntities: {} },
        })

        root = createRoot(mount)
        await act(async () => {
            root?.render(
                React.createElement(
                    ObsidianRuntimeProvider,
                    {
                        runtime,
                        isolationRoot: shadowRoot,
                    },
                    React.createElement('div', null, 'Inline card'),
                ),
            )
        })

        expect(document.head.querySelector('style')).toBeNull()
        expect(document.documentElement.dataset.memexTheme).toBeUndefined()
        expect(document.documentElement.style.backgroundColor).toBe('')
        expect(
            document.documentElement.style.getPropertyValue(
                '--memex-theme-colors-text-primary',
            ),
        ).toBe('')
        expect(
            host.style.getPropertyValue('--memex-theme-colors-text-primary'),
        ).not.toBe('')
        expect(shadowRoot.querySelector('style')).not.toBeNull()
    })

    it('passes the Obsidian shadow root through context for portals', async () => {
        const host = document.createElement('div')
        const shadowRoot = host.attachShadow({ mode: 'open' })
        const mount = document.createElement('div')
        shadowRoot.appendChild(mount)
        document.body.appendChild(host)
        const runtime = createRuntime({
            colorTheme: 'dark',
            productThemeSettings: normalizeLocalProductThemeSettings(null),
            contentEntities: {},
            referencesByContentEntityId: {},
            tags: { tagEntities: {} },
        })

        root = createRoot(mount)
        await act(async () => {
            root?.render(
                React.createElement(
                    ObsidianRuntimeProvider,
                    {
                        runtime,
                        isolationRoot: shadowRoot,
                    },
                    React.createElement(DropdownProbe),
                ),
            )
        })

        expect(shadowRoot.textContent).toContain('Probe action')
        expect(document.body.textContent).not.toContain('Probe action')
    })
})
