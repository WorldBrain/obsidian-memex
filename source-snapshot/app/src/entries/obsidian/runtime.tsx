import React from 'react'
import { useSyncExternalStore } from 'react'
import { StyleSheetManager } from 'styled-components'
import {
    normalizeLocalProductThemeSettings,
    resolveProductThemeForColorTheme,
} from '~/utils/product-theme-bootstrap'
import { MemexThemeProvider } from '~/features/ui-theme/memex-theme-provider'
import { FontLoader } from '@memex/common/features/ui-theme/font-loader'
import { GlobalStyle } from '@memex/common/features/ui-theme/global-styles'
import type {
    AuthSessionPayload,
    OAuthProviderId,
} from '@memex/common/features/auth/services/types'
import { setupWebPlatformContext } from '~/entries/web-platform-setup'
import { OverlayProvider } from '~/features/in-page-ui/ui/overlay-provider'
import { getObsidianHostedAuthUrl } from '~/features/obsidian/sidebar-iframe-bridge'
import type { OptionsContextType } from '~/options-script/types'
import { ExtUIContext } from '~/ui-scripts/context-provider'
import type { UITheme } from '~/utils/ui-theme-bootstrap'
import { OBSIDIAN_INLINE_RESULT_CARD_ICONS } from './inline-result-card-icons'

export interface ObsidianRuntimeContextValue extends Omit<
    OptionsContextType,
    'globalState'
> {
    globalState: OptionsContextType['globalLogic']['state']
}

export interface ObsidianRuntimeOptions {
    resolveRuntimeUrl?: (path: string) => string | null
    initialTheme?: UITheme
}

export class ObsidianRuntime {
    private contextPromise: Promise<OptionsContextType> | null = null
    private context: OptionsContextType | null = null
    private stateListeners = new Set<() => void>()
    private restoreSetState: (() => void) | null = null
    private hostTheme: UITheme

    constructor(private options: ObsidianRuntimeOptions = {}) {
        this.hostTheme = options.initialTheme ?? 'dark'
    }

    async ensureContext(): Promise<OptionsContextType> {
        if (this.context != null) {
            return this.context
        }
        if (this.contextPromise == null) {
            this.contextPromise = this.createContext()
        }
        return this.contextPromise
    }

    private async createContext(): Promise<OptionsContextType> {
        const context = await setupWebPlatformContext({
            disableExtensionAuthSync: true,
            disableSystemThemeDetection: true,
            disablePersistedThemeBootstrap: true,
            disableDocumentThemeBootstrap: true,
            initialTheme: this.hostTheme,
            resolveRuntimeUrl: this.options.resolveRuntimeUrl,
            inlineIcons: OBSIDIAN_INLINE_RESULT_CARD_ICONS,
        })

        await context.globalLogic.initialize()
        this.applyHostColorThemeToContext(context)
        this.attachStateListener(context)
        this.context = context

        return context
    }

    private applyHostColorThemeToContext(context: OptionsContextType): void {
        context.globalLogic.setState({
            colorTheme: this.hostTheme,
            colorThemePreference: this.hostTheme,
        })
    }

    private attachStateListener(context: OptionsContextType): void {
        const logic = context.globalLogic
        const originalSetState = logic.setState.bind(logic)

        logic.setState = (newState) => {
            originalSetState(newState)
            for (const listener of this.stateListeners) {
                listener()
            }
        }

        this.restoreSetState = () => {
            logic.setState = originalSetState
        }
    }

    getContextValue(): ObsidianRuntimeContextValue {
        if (this.context == null) {
            throw new Error('Obsidian runtime has not been initialized')
        }

        return {
            services: this.context.services,
            bgModules: this.context.bgModules,
            globalLogic: this.context.globalLogic,
            events: this.context.events,
            globalState: this.context.globalLogic.state,
        }
    }

    subscribeState(listener: () => void): () => void {
        this.stateListeners.add(listener)
        return () => {
            this.stateListeners.delete(listener)
        }
    }

    getStateSnapshot(): OptionsContextType['globalLogic']['state'] {
        if (this.context == null) {
            throw new Error('Obsidian runtime has not been initialized')
        }
        return this.context.globalLogic.state
    }

    setHostColorTheme(theme: UITheme): void {
        this.hostTheme = theme
        if (this.context == null) {
            return
        }

        this.applyHostColorThemeToContext(this.context)
    }

    async startOAuthLogin(): Promise<string | null> {
        return getObsidianHostedAuthUrl()
    }

    async completeOAuthFromCallbackUrl(
        callbackUrl: string,
        provider: OAuthProviderId = 'google',
    ): Promise<void> {
        const context = await this.ensureContext()
        await context.bgModules.auth.completeOAuthFromCallbackUrl(
            callbackUrl,
            provider,
        )
        await context.bgModules.auth.confirmAuth()
    }

    async getAuthSession(): Promise<AuthSessionPayload | null> {
        const context = await this.ensureContext()

        try {
            return await context.bgModules.auth.refreshIdToken()
        } catch {
            return null
        }
    }

    async dispose(): Promise<void> {
        this.stateListeners.clear()
        this.restoreSetState?.()
        this.restoreSetState = null

        if (this.context != null) {
            await this.context.globalLogic.cleanup()
        }

        this.context = null
        this.contextPromise = null
    }
}

function useRuntimeContextValue(
    runtime: ObsidianRuntime,
): ObsidianRuntimeContextValue {
    const globalState = useSyncExternalStore(
        React.useCallback(
            (onStoreChange) => runtime.subscribeState(onStoreChange),
            [runtime],
        ),
        React.useCallback(() => runtime.getStateSnapshot(), [runtime]),
    )
    const base = runtime.getContextValue()
    return {
        ...base,
        globalState,
    }
}

export const ObsidianRuntimeProvider: React.FC<
    React.PropsWithChildren<{
        runtime: ObsidianRuntime
        isolationRoot?: ShadowRoot
    }>
> = ({ runtime, isolationRoot, children }) => {
    const contextValue = useRuntimeContextValue(runtime)
    const productTheme = resolveProductThemeForColorTheme({
        settings: normalizeLocalProductThemeSettings(
            contextValue.globalState.productThemeSettings,
        ),
        colorTheme: contextValue.globalState.colorTheme,
    })

    const content = (
        <MemexThemeProvider
            theme={contextValue.globalState.colorTheme}
            defaultTheme="dark"
            productTheme={productTheme}
            iconsService={contextValue.services.icons}
            cssVariableTarget={isolationRoot}
        >
            <FontLoader />
            <GlobalStyle />
            <ExtUIContext.Provider
                value={{
                    ...contextValue,
                    shadowRoot: isolationRoot,
                }}
            >
                <OverlayProvider>{children}</OverlayProvider>
            </ExtUIContext.Provider>
        </MemexThemeProvider>
    )

    if (isolationRoot == null) {
        return content
    }

    return (
        <StyleSheetManager target={isolationRoot}>{content}</StyleSheetManager>
    )
}
