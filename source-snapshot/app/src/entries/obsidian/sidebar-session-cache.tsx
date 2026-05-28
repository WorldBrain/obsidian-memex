import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ObsidianSidebarSurface } from './sidebar-surface'
import type { ObsidianRuntime } from './runtime'
import type { MemexSidebarHostMessage } from '~/features/obsidian/sidebar-iframe-bridge'

const OVERLAY_HOST_ATTRIBUTE = 'data-memex-obsidian-sidebar-overlay'

type SurfaceCallbacks = Pick<
    React.ComponentProps<typeof ObsidianSidebarSurface>,
    'onHostBridgeReady' | 'onHostBridgeClosed'
>

export interface ObsidianSidebarSessionCacheOptions {
    runtime?: ObsidianRuntime
    startLoginFlow?: () => Promise<void>
    renderSurface?: (callbacks: SurfaceCallbacks) => React.ReactNode
}

export class ObsidianSidebarSessionCache {
    private overlayHost: HTMLDivElement | null = null
    private surfaceRoot: HTMLDivElement | null = null
    private shadowRoot: ShadowRoot | null = null
    private root: Root | null = null
    private activeContainer: HTMLElement | null = null
    private resizeObserver: ResizeObserver | null = null
    private windowListenersBound = false
    private rafId: number | null = null
    private sendHostMessage:
        | ((message: MemexSidebarHostMessage) => void)
        | null = null
    private pendingHostMessages: MemexSidebarHostMessage[] = []

    constructor(private readonly options: ObsidianSidebarSessionCacheOptions) {}

    attach(containerEl: HTMLElement): void {
        this.ensureSession()
        this.activeContainer = containerEl
        this.observeContainer(containerEl)
        this.bindWindowListeners()
        this.updateOverlayPosition()
        this.scheduleOverlayPositionUpdate()
    }

    park(): void {
        this.activeContainer = null
        this.disconnectResizeObserver()
        this.unbindWindowListeners()
        this.cancelOverlayPositionUpdate()

        if (this.overlayHost == null) {
            return
        }

        this.overlayHost.style.visibility = 'hidden'
        this.overlayHost.style.pointerEvents = 'none'
        this.overlayHost.style.opacity = '0'
    }

    postMessage(message: MemexSidebarHostMessage): void {
        if (this.sendHostMessage != null) {
            this.sendHostMessage(message)
            return
        }

        this.pendingHostMessages.push(message)
    }

    dispose(): void {
        this.park()

        this.root?.unmount()
        this.root = null

        this.surfaceRoot?.remove()
        this.surfaceRoot = null

        this.overlayHost?.remove()
        this.overlayHost = null
        this.shadowRoot = null

        this.sendHostMessage = null
        this.pendingHostMessages = []
    }

    private ensureSession(): void {
        if (this.overlayHost != null) {
            return
        }

        const overlayHost = document.createElement('div')
        overlayHost.setAttribute(OVERLAY_HOST_ATTRIBUTE, 'true')
        overlayHost.setAttribute('aria-hidden', 'true')
        overlayHost.style.position = 'fixed'
        overlayHost.style.inset = '0 auto auto 0'
        overlayHost.style.width = '0'
        overlayHost.style.height = '0'
        overlayHost.style.overflow = 'hidden'
        overlayHost.style.pointerEvents = 'none'
        overlayHost.style.opacity = '0'
        overlayHost.style.visibility = 'hidden'
        overlayHost.style.background = 'var(--background-primary)'

        const shadowRoot = overlayHost.attachShadow({ mode: 'open' })
        const surfaceRoot = document.createElement('div')
        surfaceRoot.className = 'memex-obsidian-sidebar-root'
        surfaceRoot.style.display = 'flex'
        surfaceRoot.style.height = '100%'
        surfaceRoot.style.minHeight = '0'
        surfaceRoot.style.width = '100%'
        surfaceRoot.style.overflow = 'hidden'
        shadowRoot.appendChild(surfaceRoot)

        document.body.appendChild(overlayHost)

        this.overlayHost = overlayHost
        this.surfaceRoot = surfaceRoot
        this.shadowRoot = shadowRoot

        const root = createRoot(surfaceRoot)
        root.render(this.renderSurface())

        this.root = root
    }

    private renderSurface(): React.ReactNode {
        const callbacks: SurfaceCallbacks = {
            onHostBridgeReady: (sendMessage) => {
                this.sendHostMessage = sendMessage
                const pendingMessages = [...this.pendingHostMessages]
                this.pendingHostMessages = []
                for (const message of pendingMessages) {
                    sendMessage(message)
                }
            },
            onHostBridgeClosed: () => {
                this.sendHostMessage = null
            },
        }

        if (this.options.renderSurface != null) {
            return this.options.renderSurface(callbacks)
        }

        if (
            this.options.runtime == null ||
            this.options.startLoginFlow == null
        ) {
            throw new Error(
                'Obsidian sidebar session cache requires runtime and login flow handlers.',
            )
        }

        return (
            <ObsidianSidebarSurface
                runtime={this.options.runtime}
                startLoginFlow={this.options.startLoginFlow}
                {...callbacks}
            />
        )
    }

    private observeContainer(containerEl: HTMLElement): void {
        this.disconnectResizeObserver()

        if (typeof ResizeObserver === 'undefined') {
            return
        }

        const resizeObserver = new ResizeObserver(() => {
            this.updateOverlayPosition()
        })
        resizeObserver.observe(containerEl)
        this.resizeObserver = resizeObserver
    }

    private disconnectResizeObserver(): void {
        this.resizeObserver?.disconnect()
        this.resizeObserver = null
    }

    private bindWindowListeners(): void {
        if (this.windowListenersBound) {
            return
        }

        window.addEventListener('resize', this.handleViewportChange)
        window.addEventListener('scroll', this.handleViewportChange, true)
        this.windowListenersBound = true
    }

    private unbindWindowListeners(): void {
        if (!this.windowListenersBound) {
            return
        }

        window.removeEventListener('resize', this.handleViewportChange)
        window.removeEventListener('scroll', this.handleViewportChange, true)
        this.windowListenersBound = false
    }

    private handleViewportChange = (): void => {
        this.updateOverlayPosition()
    }

    private scheduleOverlayPositionUpdate(): void {
        this.cancelOverlayPositionUpdate()
        this.rafId = window.requestAnimationFrame(() => {
            this.rafId = null
            this.updateOverlayPosition()
        })
    }

    private cancelOverlayPositionUpdate(): void {
        if (this.rafId != null) {
            window.cancelAnimationFrame(this.rafId)
            this.rafId = null
        }
    }

    private updateOverlayPosition(): void {
        const overlayHost = this.overlayHost
        const activeContainer = this.activeContainer
        if (overlayHost == null) {
            return
        }

        if (activeContainer == null || !activeContainer.isConnected) {
            overlayHost.style.visibility = 'hidden'
            overlayHost.style.pointerEvents = 'none'
            overlayHost.style.opacity = '0'
            return
        }

        const bounds = activeContainer.getBoundingClientRect()
        const width = Math.max(0, Math.round(bounds.width))
        const height = Math.max(0, Math.round(bounds.height))

        overlayHost.style.left = `${Math.round(bounds.left)}px`
        overlayHost.style.top = `${Math.round(bounds.top)}px`
        overlayHost.style.width = `${width}px`
        overlayHost.style.height = `${height}px`

        const isVisible = width > 0 && height > 0
        overlayHost.style.visibility = isVisible ? 'visible' : 'hidden'
        overlayHost.style.pointerEvents = isVisible ? 'auto' : 'none'
        overlayHost.style.opacity = isVisible ? '1' : '0'
    }
}
