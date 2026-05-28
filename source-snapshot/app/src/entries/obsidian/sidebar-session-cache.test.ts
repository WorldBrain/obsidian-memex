// @vitest-environment happy-dom
import React from 'react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ObsidianSidebarSessionCache } from './sidebar-session-cache'
import type { MemexSidebarHostMessage } from '~/features/obsidian/sidebar-iframe-bridge'

const OVERLAY_SELECTOR = '[data-memex-obsidian-sidebar-overlay="true"]'

const TEST_MESSAGE: MemexSidebarHostMessage = {
    type: 'memex:host:event',
    bridgeVersion: 1,
    event: {
        type: 'openSearchNotes',
        contentEntityId: 'content-1',
        title: 'Test note',
    },
}

describe('ObsidianSidebarSessionCache', () => {
    beforeEach(() => {
        ;(
            globalThis as typeof globalThis & {
                IS_REACT_ACT_ENVIRONMENT?: boolean
            }
        ).IS_REACT_ACT_ENVIRONMENT = true

        document.body.innerHTML = ''
        document.head.innerHTML = ''

        vi.stubGlobal(
            'ResizeObserver',
            class ResizeObserver {
                observe(): void {}
                disconnect(): void {}
            },
        )
    })

    afterEach(() => {
        document.body.innerHTML = ''
        document.head.innerHTML = ''
        vi.restoreAllMocks()
        vi.unstubAllGlobals()
    })

    it('keeps the iframe under a permanent overlay host across park and reattach', async () => {
        const firstContainer = createContainerWithBounds({
            left: 10,
            top: 20,
            width: 320,
            height: 640,
        })
        const secondContainer = createContainerWithBounds({
            left: 40,
            top: 60,
            width: 280,
            height: 480,
        })
        document.body.append(firstContainer, secondContainer)

        let mountCount = 0
        let unmountCount = 0

        const cache = new ObsidianSidebarSessionCache({
            renderSurface: () =>
                React.createElement(TestSurface, {
                    onMount: () => {
                        mountCount += 1
                    },
                    onUnmount: () => {
                        unmountCount += 1
                    },
                }),
        })

        await act(async () => {
            cache.attach(firstContainer)
        })

        const overlayHost =
            document.body.querySelector<HTMLDivElement>(OVERLAY_SELECTOR)
        const firstIframe = overlayHost?.shadowRoot?.querySelector('iframe')

        expect(firstIframe).not.toBeNull()
        expect(overlayHost?.querySelector('iframe')).toBeNull()
        expect(firstContainer.querySelector('iframe')).toBeNull()
        expect(mountCount).toBe(1)
        expect(unmountCount).toBe(0)
        expect(overlayHost?.style.left).toBe('10px')
        expect(overlayHost?.style.top).toBe('20px')
        expect(overlayHost?.style.width).toBe('320px')
        expect(overlayHost?.style.height).toBe('640px')
        expect(overlayHost?.style.visibility).toBe('visible')

        await act(async () => {
            cache.park()
        })

        expect(overlayHost?.style.visibility).toBe('hidden')
        expect(overlayHost?.style.pointerEvents).toBe('none')

        await act(async () => {
            cache.attach(secondContainer)
        })

        const secondIframe = overlayHost?.shadowRoot?.querySelector('iframe')
        expect(secondIframe).toBe(firstIframe)
        expect(secondContainer.querySelector('iframe')).toBeNull()
        expect(mountCount).toBe(1)
        expect(unmountCount).toBe(0)
        expect(overlayHost?.style.left).toBe('40px')
        expect(overlayHost?.style.top).toBe('60px')
        expect(overlayHost?.style.width).toBe('280px')
        expect(overlayHost?.style.height).toBe('480px')
        expect(overlayHost?.style.visibility).toBe('visible')

        await act(async () => {
            cache.dispose()
        })

        expect(unmountCount).toBe(1)
    })

    it('flushes queued host messages and keeps messaging working after reattach', async () => {
        const firstContainer = createContainerWithBounds({
            left: 0,
            top: 0,
            width: 300,
            height: 500,
        })
        const secondContainer = createContainerWithBounds({
            left: 15,
            top: 25,
            width: 310,
            height: 510,
        })
        document.body.append(firstContainer, secondContainer)

        const sendMessage = vi.fn()

        const cache = new ObsidianSidebarSessionCache({
            renderSurface: ({ onHostBridgeReady }) =>
                React.createElement(BridgeReadySurface, {
                    onReady: onHostBridgeReady,
                    sendMessage,
                }),
        })

        cache.postMessage(TEST_MESSAGE)

        await act(async () => {
            cache.attach(firstContainer)
        })

        expect(sendMessage).toHaveBeenCalledTimes(1)
        expect(sendMessage).toHaveBeenNthCalledWith(1, TEST_MESSAGE)

        await act(async () => {
            cache.park()
            cache.attach(secondContainer)
        })

        cache.postMessage(TEST_MESSAGE)

        expect(sendMessage).toHaveBeenCalledTimes(2)
        expect(sendMessage).toHaveBeenNthCalledWith(2, TEST_MESSAGE)
    })

    it('fully tears down the overlay session on dispose', async () => {
        const container = createContainerWithBounds({
            left: 25,
            top: 35,
            width: 400,
            height: 700,
        })
        document.body.appendChild(container)

        const onBridgeClosed = vi.fn()

        const cache = new ObsidianSidebarSessionCache({
            renderSurface: ({ onHostBridgeClosed }) =>
                React.createElement(TestSurface, {
                    onUnmount: onHostBridgeClosed,
                    onBridgeClosed,
                }),
        })

        await act(async () => {
            cache.attach(container)
            cache.park()
        })

        expect(document.body.querySelector(OVERLAY_SELECTOR)).not.toBeNull()

        await act(async () => {
            cache.dispose()
        })

        expect(onBridgeClosed).toHaveBeenCalledTimes(1)
        expect(document.body.querySelector(OVERLAY_SELECTOR)).toBeNull()
    })
})

function createContainerWithBounds(bounds: {
    left: number
    top: number
    width: number
    height: number
}): HTMLDivElement {
    const container = document.createElement('div')
    Object.defineProperty(container, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({
            left: bounds.left,
            top: bounds.top,
            width: bounds.width,
            height: bounds.height,
            right: bounds.left + bounds.width,
            bottom: bounds.top + bounds.height,
            x: bounds.left,
            y: bounds.top,
            toJSON: () => ({}),
        }),
    })
    return container
}

const TestSurface: React.FC<{
    onMount?: () => void
    onUnmount?: () => void
    onBridgeClosed?: () => void
}> = ({ onMount, onUnmount, onBridgeClosed }) => {
    React.useEffect(() => {
        onMount?.()
        return () => {
            onUnmount?.()
            onBridgeClosed?.()
        }
    }, [onBridgeClosed, onMount, onUnmount])

    return React.createElement('iframe', {
        title: 'Memex Sidebar',
        src: 'about:blank',
    })
}

const BridgeReadySurface: React.FC<{
    onReady?: (sendMessage: (message: MemexSidebarHostMessage) => void) => void
    sendMessage: (message: MemexSidebarHostMessage) => void
}> = ({ onReady, sendMessage }) => {
    React.useEffect(() => {
        onReady?.(sendMessage)
    }, [onReady, sendMessage])

    return React.createElement('iframe', {
        title: 'Memex Sidebar',
        src: 'about:blank',
    })
}
