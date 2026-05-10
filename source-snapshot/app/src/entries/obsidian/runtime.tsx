import React from 'react'
import { useSyncExternalStore } from 'react'
import { resolveProductThemeForColorTheme } from '~/utils/product-theme-bootstrap'
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

export interface ObsidianRuntimeContextValue extends Omit<
    OptionsContextType,
    'globalState'
> {
    globalState: OptionsContextType['globalLogic']['state']
}

export interface ObsidianRuntimeOptions {
    resolveRuntimeUrl?: (path: string) => string | null
}

export class ObsidianRuntime {
    private contextPromise: Promise<OptionsContextType> | null = null
    private context: OptionsContextType | null = null
    private stateListeners = new Set<() => void>()
    private restoreSetState: (() => void) | null = null

    constructor(private options: ObsidianRuntimeOptions = {}) {}

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
            initialTheme: 'dark',
            resolveRuntimeUrl: this.options.resolveRuntimeUrl,
        })

        await context.globalLogic.initialize()
        this.attachStateListener(context)
        this.context = context

        return context
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
    React.PropsWithChildren<{ runtime: ObsidianRuntime }>
> = ({ runtime, children }) => {
    const contextValue = useRuntimeContextValue(runtime)
    const productTheme = resolveProductThemeForColorTheme({
        settings: contextValue.globalState.productThemeSettings,
        colorTheme: contextValue.globalState.colorTheme,
    })

    return (
        <MemexThemeProvider
            theme={contextValue.globalState.colorTheme}
            defaultTheme="dark"
            productTheme={productTheme}
            iconsService={contextValue.services.icons}
        >
            <FontLoader />
            <GlobalStyle />
            <ExtUIContext.Provider value={contextValue}>
                <OverlayProvider>{children}</OverlayProvider>
            </ExtUIContext.Provider>
        </MemexThemeProvider>
    )
}
