import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ObsidianRuntime } from './runtime'

const { setupWebPlatformContextMock } = vi.hoisted(() => ({
    setupWebPlatformContextMock: vi.fn(),
}))

vi.mock('~/entries/web-platform-setup', () => ({
    setupWebPlatformContext: setupWebPlatformContextMock,
}))

describe('ObsidianRuntime', () => {
    beforeEach(() => {
        setupWebPlatformContextMock.mockReset()
    })

    it('boots the shared web platform context with Obsidian result-card icon overrides', async () => {
        const initialize = vi.fn()

        setupWebPlatformContextMock.mockResolvedValue({
            services: {},
            bgModules: {},
            globalLogic: {
                initialize,
                cleanup: vi.fn(),
                setState: vi.fn(),
                state: {},
                events: {},
            },
            events: {},
        })

        const runtime = new ObsidianRuntime()
        await runtime.ensureContext()

        expect(setupWebPlatformContextMock).toHaveBeenCalledTimes(1)
        expect(
            setupWebPlatformContextMock.mock.calls[0]?.[0]?.inlineIcons,
        ).toEqual(
            expect.objectContaining({
                '/public/files/icons/bookmark.svg': expect.stringMatching(
                    /^data:image\/svg\+xml;utf8,/,
                ),
            }),
        )
        expect(initialize).toHaveBeenCalledTimes(1)
    })

    it('boots with the Obsidian host theme and skips persisted Memex theme bootstrap', async () => {
        setupWebPlatformContextMock.mockResolvedValue({
            services: {},
            bgModules: {},
            globalLogic: {
                initialize: vi.fn(),
                cleanup: vi.fn(),
                setState: vi.fn(),
                state: {},
                events: {},
            },
            events: {},
        })

        const runtime = new ObsidianRuntime({ initialTheme: 'light' })
        await runtime.ensureContext()

        expect(setupWebPlatformContextMock).toHaveBeenCalledWith(
            expect.objectContaining({
                initialTheme: 'light',
                disableSystemThemeDetection: true,
                disablePersistedThemeBootstrap: true,
                disableDocumentThemeBootstrap: true,
            }),
        )
    })

    it('pushes host theme changes into initialized runtime state', async () => {
        const setStateMock = vi.fn(function (
            this: { state: Record<string, unknown> },
            updates: Record<string, unknown>,
        ) {
            this.state = {
                ...this.state,
                ...updates,
            }
        })
        const globalLogic = {
            initialize: vi.fn(),
            cleanup: vi.fn(),
            setState: setStateMock,
            state: {
                colorTheme: 'dark',
                colorThemePreference: 'dark',
            },
            events: {},
        }

        setupWebPlatformContextMock.mockResolvedValue({
            services: {},
            bgModules: {},
            globalLogic,
            events: {},
        })

        const runtime = new ObsidianRuntime()
        await runtime.ensureContext()

        runtime.setHostColorTheme('light')

        expect(setStateMock).toHaveBeenCalledWith({
            colorTheme: 'light',
            colorThemePreference: 'light',
        })
        expect(runtime.getStateSnapshot().colorTheme).toBe('light')
    })

    it('re-applies the Obsidian host theme after persisted UI state initializes', async () => {
        const setStateMock = vi.fn(function (
            this: { state: Record<string, unknown> },
            updates: Record<string, unknown>,
        ) {
            this.state = {
                ...this.state,
                ...updates,
            }
        })
        const globalLogic = {
            initialize: vi.fn(function (this: {
                state: Record<string, unknown>
            }) {
                this.state = {
                    ...this.state,
                    colorTheme: 'dark',
                    colorThemePreference: 'dark',
                }
            }),
            cleanup: vi.fn(),
            setState: setStateMock,
            state: {
                colorTheme: 'light',
                colorThemePreference: 'light',
                productThemeSettings: {},
            },
            events: {},
        }

        setupWebPlatformContextMock.mockResolvedValue({
            services: {},
            bgModules: {},
            globalLogic,
            events: {},
        })

        const runtime = new ObsidianRuntime({ initialTheme: 'light' })
        await runtime.ensureContext()

        expect(setStateMock).toHaveBeenCalledWith({
            colorTheme: 'light',
            colorThemePreference: 'light',
        })
        expect(runtime.getStateSnapshot().colorTheme).toBe('light')
    })
})
