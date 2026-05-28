import React from 'react'
import type { ObsidianRuntime } from './runtime'
import { ObsidianSidebarBridgeController } from './sidebar-bridge-controller'
import { openExternalUrlInObsidianHost } from './external-url'
import {
    OBSIDIAN_SIDEBAR_BRIDGE_VERSION,
    getObsidianSidebarEmbedUrl,
    getObsidianSidebarHostedBaseUrl,
    type MemexSidebarHostMessage,
} from '~/features/obsidian/sidebar-iframe-bridge'

const FEATURE_FLAGS = {
    localMarkdownRendering: true,
    localEditorDropHandling: true,
    localInlineSearchRendering: false,
} as const

export interface ObsidianSidebarSurfaceProps {
    runtime: ObsidianRuntime
    startLoginFlow: () => Promise<void>
    onHostBridgeReady?: (
        sendMessage: (message: MemexSidebarHostMessage) => void,
    ) => void
    onHostBridgeClosed?: () => void
}

export const ObsidianSidebarSurface: React.FC<ObsidianSidebarSurfaceProps> = ({
    runtime,
    startLoginFlow,
    onHostBridgeReady,
    onHostBridgeClosed,
}) => {
    const iframeRef = React.useRef<HTMLIFrameElement | null>(null)
    const controllerRef = React.useRef<ObsidianSidebarBridgeController | null>(
        null,
    )
    const syncStateRef = React.useRef<{
        theme: 'light' | 'dark' | null
        authFingerprint: string | null
    }>({
        theme: null,
        authFingerprint: null,
    })
    const embedUrl = React.useMemo(() => getObsidianSidebarEmbedUrl(), [])
    const iframeOrigin = React.useMemo(
        () => new URL(embedUrl).origin,
        [embedUrl],
    )

    const postHostMessage = React.useCallback(
        (message: MemexSidebarHostMessage) => {
            controllerRef.current?.postMessage(message)
        },
        [],
    )

    const sendInitialHostState = React.useCallback(async () => {
        await runtime.ensureContext()
        const runtimeState = runtime.getStateSnapshot()

        postHostMessage({
            type: 'memex:host:init',
            bridgeVersion: OBSIDIAN_SIDEBAR_BRIDGE_VERSION,
            theme: runtimeState.colorTheme,
            baseUrl: getObsidianSidebarHostedBaseUrl(),
            hostEnvironment: 'obsidian',
            featureFlags: FEATURE_FLAGS,
        })

        const session = await runtime.getAuthSession()

        postHostMessage({
            type: 'memex:host:auth-session',
            bridgeVersion: OBSIDIAN_SIDEBAR_BRIDGE_VERSION,
            session,
        })

        syncStateRef.current = {
            theme: runtimeState.colorTheme,
            authFingerprint:
                session != null
                    ? `${runtimeState.user?.id ?? ''}:${runtimeState.hasAuthSession === true}`
                    : null,
        }
    }, [postHostMessage, runtime])

    const syncRuntimeStateToIframe = React.useCallback(async () => {
        const controller = controllerRef.current
        if (!controller?.ready()) {
            return
        }

        const runtimeState = runtime.getStateSnapshot()
        const previousState = syncStateRef.current

        if (previousState.theme !== runtimeState.colorTheme) {
            postHostMessage({
                type: 'memex:host:event',
                bridgeVersion: OBSIDIAN_SIDEBAR_BRIDGE_VERSION,
                event: {
                    type: 'themeChanged',
                    theme: runtimeState.colorTheme,
                },
            })
        }

        const authFingerprint =
            runtimeState.hasAuthSession === true
                ? `${runtimeState.user?.id ?? ''}:true`
                : null

        if (authFingerprint !== previousState.authFingerprint) {
            postHostMessage({
                type: 'memex:host:auth-session',
                bridgeVersion: OBSIDIAN_SIDEBAR_BRIDGE_VERSION,
                session:
                    runtimeState.hasAuthSession === true
                        ? await runtime.getAuthSession()
                        : null,
            })
        }

        syncStateRef.current = {
            theme: runtimeState.colorTheme,
            authFingerprint,
        }
    }, [postHostMessage, runtime])

    React.useEffect(() => {
        void runtime.ensureContext()
    }, [runtime])

    React.useEffect(() => {
        const controller = new ObsidianSidebarBridgeController({
            iframeOrigin,
            bridgeVersion: OBSIDIAN_SIDEBAR_BRIDGE_VERSION,
            onReady: () => {
                void sendInitialHostState()
                    .then(() => {})
                    .then(() => {
                        onHostBridgeReady?.(postHostMessage)
                    })
                    .catch((error) => {
                        console.warn(
                            '[Memex Obsidian] Failed to initialize hosted dashboard state:',
                            error,
                        )
                    })
            },
            onBridgeVersionMismatch: (message) => {
                console.warn(
                    '[Memex Obsidian] Hosted dashboard bridge version mismatch:',
                    message,
                )
            },
            onReadyTimeout: () => {
                console.warn(
                    '[Memex Obsidian] Hosted dashboard did not finish loading before the bridge timeout.',
                )
            },
            onRequestAuth: () => {
                void startLoginFlow()
            },
            onOpenExternalUrl: (url) => {
                void openExternalUrlInObsidianHost(url)
            },
            onNativeAction: (message) => {
                console.warn(
                    '[Memex Obsidian] Unsupported iframe native action:',
                    message.action,
                    message.payload,
                )
            },
            onTelemetry: (message) => {
                console.warn('[Memex Obsidian]', message.name, message.payload)
            },
        })

        controllerRef.current = controller
        if (iframeRef.current != null) {
            controller.attach(iframeRef.current)
        }

        return () => {
            controller.detach()
            controllerRef.current = null
            onHostBridgeClosed?.()
        }
    }, [
        iframeOrigin,
        onHostBridgeClosed,
        onHostBridgeReady,
        postHostMessage,
        sendInitialHostState,
        startLoginFlow,
    ])

    React.useEffect(() => {
        return runtime.subscribeState(() => {
            void syncRuntimeStateToIframe()
        })
    }, [runtime, syncRuntimeStateToIframe])

    const handleIframeLoad = React.useCallback(() => {
        controllerRef.current?.handleIframeLoad()
    }, [])

    const handleIframeRef = React.useCallback(
        (node: HTMLIFrameElement | null) => {
            const controller = controllerRef.current
            if (iframeRef.current === node) {
                return
            }

            if (controller != null) {
                if (iframeRef.current != null) {
                    controller.detach()
                }
                if (node != null) {
                    controller.attach(node)
                }
            }

            iframeRef.current = node
        },
        [],
    )

    return (
        <div
            className="memex-obsidian-sidebar-host"
            style={{
                position: 'relative',
                display: 'flex',
                flex: 1,
                width: '100%',
                height: '100%',
                minHeight: 0,
                overflow: 'hidden',
                background: 'var(--background-primary)',
            }}
        >
            <iframe
                ref={handleIframeRef}
                className="memex-obsidian-sidebar-iframe"
                src={embedUrl}
                title="Memex Sidebar"
                allow="clipboard-write"
                onLoad={handleIframeLoad}
                style={{
                    flex: 1,
                    width: '100%',
                    height: '100%',
                    border: 0,
                    background: 'transparent',
                }}
            />
        </div>
    )
}
