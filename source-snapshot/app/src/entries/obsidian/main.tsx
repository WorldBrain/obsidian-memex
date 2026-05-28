import React from 'react'
import { createRoot, Root } from 'react-dom/client'
import {
    App,
    Editor,
    MarkdownRenderChild,
    Modal,
    Notice,
    Plugin,
    PluginSettingTab,
    SecretComponent,
    Setting,
    normalizePath,
} from 'obsidian'
import { ObsidianResultCardBlock } from './result-card-block'
import { ObsidianRuntime } from './runtime'
import { ObsidianSidebarSessionCache } from './sidebar-session-cache'
import { ObsidianAuthSessionPersistence } from './auth-session-persistence'
import { MEMEX_OBSIDIAN_VIEW_TYPE, MemexSidebarView } from './view'
import { openExternalUrlInObsidianHost } from './external-url'
import { getObsidianColorTheme } from './theme'
import {
    formatDroppedMemexResultCardCodeBlock,
    getEditorPositionAfterInsertedText,
    MEMEX_RESULT_CARD_CODE_BLOCK_LANGUAGE,
    MEMEX_RESULT_CARD_DRAG_MIME_TYPE,
} from '~/features/obsidian/result-card-format'
import { getSupabaseClient } from '~/setup/supabase'

const OAUTH_PROTOCOL_ACTION = 'memex-auth'
const OAUTH_LOGIN_PROVIDER = 'google'

interface MemexObsidianSettings {
    callbackSecretId: string
}

const DEFAULT_SETTINGS: MemexObsidianSettings = {
    callbackSecretId: 'memex-last-oauth-callback-url',
}

class CallbackUrlModal extends Modal {
    private callbackUrl = ''

    constructor(
        app: App,
        private readonly onSubmit: (callbackUrl: string) => void,
    ) {
        super(app)
    }

    onOpen(): void {
        const { contentEl } = this
        contentEl.replaceChildren()

        const title = document.createElement('h3')
        title.textContent = 'Paste Memex OAuth Callback URL'
        contentEl.appendChild(title)

        new Setting(contentEl)
            .setName('Callback URL')
            .setDesc('Paste the full URL you were redirected to after login.')
            .addTextArea((text) => {
                text.setPlaceholder('obsidian://memex-auth?code=...')
                text.inputEl.rows = 4
                text.onChange((value) => {
                    this.callbackUrl = value.trim()
                })
            })

        new Setting(contentEl).addButton((button) => {
            button
                .setButtonText('Complete Login')
                .setCta()
                .onClick(() => {
                    if (!this.callbackUrl) {
                        new Notice('Please paste a callback URL first.')
                        return
                    }
                    this.onSubmit(this.callbackUrl)
                    this.close()
                })
        })
    }
}

class ResultCardRenderChild extends MarkdownRenderChild {
    private root: Root | null = null
    private shadowHost: HTMLDivElement | null = null
    private shadowRoot: ShadowRoot | null = null
    private stopContainerClickHandling: (() => void) | null = null

    constructor(
        containerEl: HTMLElement,
        private readonly plugin: MemexObsidianPlugin,
        private readonly runtime: ObsidianRuntime,
        private readonly source: string,
    ) {
        super(containerEl)
    }

    async onload(): Promise<void> {
        await this.runtime.ensureContext()
        const shadowHost = document.createElement('div')
        shadowHost.className = 'memex-obsidian-result-card-shadow-host'
        shadowHost.style.display = 'block'
        shadowHost.style.margin = '1rem 0'
        const shadowRoot = shadowHost.attachShadow({ mode: 'open' })
        const mountEl = document.createElement('div')
        mountEl.style.display = 'block'
        shadowRoot.appendChild(mountEl)
        this.containerEl.replaceChildren(shadowHost)
        this.shadowHost = shadowHost
        this.shadowRoot = shadowRoot

        this.root = createRoot(mountEl)
        this.root.render(
            <ObsidianResultCardBlock
                runtime={this.runtime}
                source={this.source}
                isolationRoot={shadowRoot}
                onOpenExternalUrl={(url) => this.plugin.openExternalUrl(url)}
                onOpenNotes={(params) =>
                    this.plugin.openSearchNotesInSidebar(params)
                }
            />,
        )
        this.stopContainerClickHandling = this.registerContainerClickHandling()
    }

    onunload(): void {
        this.stopContainerClickHandling?.()
        this.stopContainerClickHandling = null
        this.root?.unmount()
        this.root = null
        this.shadowHost?.remove()
        this.shadowHost = null
        this.shadowRoot = null
    }

    private hasInteractiveTarget(event: MouseEvent): boolean {
        const interactiveTargetSelector = [
            'a[href]',
            'button',
            'input',
            'textarea',
            'select',
            '[contenteditable="true"]',
            '[data-result-card-interactive="true"]',
            '[data-inline-video-player="true"]',
            '[data-result-card-action-menu="true"]',
            '[data-result-card-tag-pill="true"]',
            '[data-testid="mobile-action-sheet-panel"]',
        ].join(',')

        return event.composedPath().some((target) => {
            return (
                target instanceof HTMLElement &&
                target.matches(interactiveTargetSelector)
            )
        })
    }

    private registerContainerClickHandling(): () => void {
        const handleContainerClick = (event: MouseEvent) => {
            if (this.hasInteractiveTarget(event)) {
                return
            }

            const resultCardBlock = this.shadowRoot?.querySelector(
                '.memex-obsidian-result-card-block',
            ) as HTMLElement | null

            if (resultCardBlock == null) {
                return
            }

            if (event.shiftKey) {
                const notesContentEntityId =
                    resultCardBlock.dataset.notesContentId
                const notesTitle = resultCardBlock.dataset.notesTitle
                if (!notesContentEntityId || !notesTitle) {
                    return
                }

                event.preventDefault()
                event.stopPropagation()
                void this.plugin.openSearchNotesInSidebar({
                    contentEntityId: notesContentEntityId,
                    title: notesTitle,
                })
                return
            }

            const resultUrl = resultCardBlock.dataset.resultUrl
            if (!resultUrl) {
                return
            }

            event.preventDefault()
            event.stopPropagation()
            void this.plugin.openExternalUrl(resultUrl)
        }

        this.containerEl.addEventListener('click', handleContainerClick)

        return () => {
            this.containerEl.removeEventListener('click', handleContainerClick)
        }
    }
}

class MemexObsidianSettingTab extends PluginSettingTab {
    constructor(
        app: App,
        private readonly plugin: MemexObsidianPlugin,
    ) {
        super(app, plugin)
    }

    display(): void {
        const { containerEl } = this
        containerEl.replaceChildren()

        new Setting(containerEl)
            .setName('Login with Memex')
            .setDesc('Start OAuth login in your browser and redirect back.')
            .addButton((button) => {
                button
                    .setButtonText('Login')
                    .setCta()
                    .onClick(() => {
                        void this.plugin.startLoginFlow()
                    })
            })

        new Setting(containerEl)
            .setName('Manual callback fallback')
            .setDesc(
                'Use this when callback redirect handling fails on your platform.',
            )
            .addButton((button) => {
                button
                    .setButtonText('Paste Callback URL')
                    .onClick(() => this.plugin.openCallbackUrlModal())
            })

        new Setting(containerEl)
            .setName('Callback URL secret')
            .setDesc(
                'SecretStorage key for remembering the last successful callback URL.',
            )
            .addComponent((el) =>
                new SecretComponent(this.app, el)
                    .setValue(this.plugin.settings.callbackSecretId)
                    .onChange((value) => {
                        this.plugin.settings.callbackSecretId = value
                        void this.plugin.saveSettings()
                    }),
            )
    }
}

export default class MemexObsidianPlugin extends Plugin {
    public settings: MemexObsidianSettings = DEFAULT_SETTINGS
    private readonly runtime = new ObsidianRuntime({
        resolveRuntimeUrl: (path) => this.resolveRuntimeUrl(path),
        initialTheme: getObsidianColorTheme(),
    })
    private readonly sidebarSessionCache = new ObsidianSidebarSessionCache({
        runtime: this.runtime,
        startLoginFlow: () => this.startLoginFlow(),
    })
    private authSessionPersistence: ObsidianAuthSessionPersistence | null = null
    private stopAuthSessionSync: (() => void) | null = null

    private resolveRuntimeUrl(path: string): string | null {
        const adapter = this.app.vault?.adapter
        const pluginDir = this.manifest?.dir
        if (adapter?.getResourcePath == null || !pluginDir) {
            return null
        }

        const normalizedPath = normalizePath(
            `${pluginDir}/${path.startsWith('/') ? path.slice(1) : path}`,
        )
        return adapter.getResourcePath(normalizedPath)
    }

    async onload(): Promise<void> {
        this.syncObsidianTheme()
        this.registerStartupThemeSync()
        await this.loadSettings()
        const authSessionPersistence = this.getAuthSessionPersistence()
        await authSessionPersistence.restoreSession()
        this.stopAuthSessionSync = authSessionPersistence.startSync()
        await authSessionPersistence.syncCurrentSession()

        this.registerView(
            MEMEX_OBSIDIAN_VIEW_TYPE,
            (leaf) =>
                new MemexSidebarView(
                    leaf,
                    this.runtime,
                    this.sidebarSessionCache,
                ),
        )

        this.addSettingTab(new MemexObsidianSettingTab(this.app, this))

        this.addCommand({
            id: 'toggle-memex-sidebar',
            name: 'Toggle Memex Sidebar',
            callback: () => {
                void this.toggleSidebar()
            },
        })

        this.addCommand({
            id: 'memex-login-with-browser',
            name: 'Login with Memex',
            callback: () => {
                void this.startLoginFlow()
            },
        })

        this.addCommand({
            id: 'memex-paste-callback-url',
            name: 'Paste Memex Callback URL',
            callback: () => this.openCallbackUrlModal(),
        })

        this.registerEvent(
            this.app.workspace.on('editor-drop', (event, editor) => {
                void this.handleEditorDrop(event, editor)
            }),
        )

        this.registerEvent(
            this.app.workspace.on('css-change', () => {
                this.syncObsidianTheme()
            }),
        )

        this.registerObsidianProtocolHandler(
            OAUTH_PROTOCOL_ACTION,
            (params) => {
                void this.handleProtocolCallback(params)
            },
        )

        this.registerMarkdownCodeBlockProcessor(
            MEMEX_RESULT_CARD_CODE_BLOCK_LANGUAGE,
            (source, el, context) => {
                const child = new ResultCardRenderChild(
                    el,
                    this,
                    this.runtime,
                    source,
                )
                context.addChild(child)
            },
        )
    }

    private syncObsidianTheme(): void {
        this.runtime.setHostColorTheme(getObsidianColorTheme())
    }

    private registerStartupThemeSync(): void {
        this.app.workspace.onLayoutReady?.(() => {
            this.syncObsidianTheme()
        })

        const requestAnimationFrameId = window.requestAnimationFrame(() => {
            this.syncObsidianTheme()
        })
        this.register(() => {
            window.cancelAnimationFrame(requestAnimationFrameId)
        })

        const timeoutIds = [0, 100, 500].map((delay) =>
            window.setTimeout(() => {
                this.syncObsidianTheme()
            }, delay),
        )
        this.register(() => {
            timeoutIds.forEach((timeoutId) => {
                window.clearTimeout(timeoutId)
            })
        })
    }

    async onunload(): Promise<void> {
        this.stopAuthSessionSync?.()
        this.stopAuthSessionSync = null
        this.sidebarSessionCache.dispose()
        await this.runtime.dispose()
        this.app.workspace
            .getLeavesOfType(MEMEX_OBSIDIAN_VIEW_TYPE)
            .forEach((leaf) => leaf.detach())
    }

    async loadSettings(): Promise<void> {
        const loaded = await this.loadData()
        this.settings = {
            ...DEFAULT_SETTINGS,
            ...(loaded ?? {}),
        }
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings)
    }

    async toggleSidebar(): Promise<void> {
        const existingLeaves = this.app.workspace.getLeavesOfType(
            MEMEX_OBSIDIAN_VIEW_TYPE,
        )
        if (existingLeaves.length > 0) {
            existingLeaves.forEach((leaf) => leaf.detach())
            return
        }

        const leaf =
            this.app.workspace.getRightLeaf(false) ??
            this.app.workspace.getLeaf(false)

        if (!leaf) {
            new Notice('Could not open Memex sidebar leaf.')
            return
        }

        await leaf.setViewState({
            type: MEMEX_OBSIDIAN_VIEW_TYPE,
            active: true,
        })
        await this.app.workspace.revealLeaf(leaf)
    }

    async ensureSidebarOpen(): Promise<void> {
        const existingLeaves = this.app.workspace.getLeavesOfType(
            MEMEX_OBSIDIAN_VIEW_TYPE,
        )
        if (existingLeaves.length > 0) {
            await this.app.workspace.revealLeaf(existingLeaves[0])
            return
        }

        const leaf =
            this.app.workspace.getRightLeaf(false) ??
            this.app.workspace.getLeaf(false)

        if (!leaf) {
            new Notice('Could not open Memex sidebar leaf.')
            return
        }

        await leaf.setViewState({
            type: MEMEX_OBSIDIAN_VIEW_TYPE,
            active: true,
        })
        await this.app.workspace.revealLeaf(leaf)
    }

    async openSearchNotesInSidebar(params: {
        contentEntityId: string
        title: string
    }): Promise<void> {
        await this.ensureSidebarOpen()
        const sidebarView = this.app.workspace.getLeavesOfType(
            MEMEX_OBSIDIAN_VIEW_TYPE,
        )[0]?.view

        if (!(sidebarView instanceof MemexSidebarView)) {
            return
        }

        sidebarView.openSearchNotes(params)
    }

    async startLoginFlow(): Promise<void> {
        try {
            const authUrl = await this.runtime.startOAuthLogin()
            if (!authUrl) {
                new Notice('Could not generate Memex login URL.')
                return
            }

            window.open(authUrl, '_blank', 'noopener,noreferrer')
            new Notice('Opened Memex login in your browser.')
        } catch (error) {
            new Notice(
                error instanceof Error
                    ? `Memex login failed: ${error.message}`
                    : 'Memex login failed.',
            )
        }
    }

    openCallbackUrlModal(): void {
        const modal = new CallbackUrlModal(this.app, (callbackUrl) => {
            void this.completeOAuthFromCallbackUrl(callbackUrl)
        })
        modal.open()
    }

    async completeOAuthFromCallbackUrl(callbackUrl: string): Promise<void> {
        try {
            await this.runtime.completeOAuthFromCallbackUrl(
                callbackUrl,
                OAUTH_LOGIN_PROVIDER,
            )
            await this.getAuthSessionPersistence().syncCurrentSession()
            try {
                this.app.secretStorage.setSecret(
                    this.settings.callbackSecretId,
                    callbackUrl,
                )
            } catch (error) {
                console.warn(
                    'Could not save callback URL into SecretStorage',
                    error,
                )
            }
            new Notice('Memex login complete.')
        } catch (error) {
            new Notice(
                error instanceof Error
                    ? `OAuth callback failed: ${error.message}`
                    : 'OAuth callback failed.',
            )
        }
    }

    private async handleProtocolCallback(
        params: Record<string, string>,
    ): Promise<void> {
        const callbackUrl = this.buildCallbackUrlFromProtocolParams(params)
        if (!callbackUrl) {
            new Notice('Missing callback params in obsidian://memex-auth URL.')
            return
        }
        await this.completeOAuthFromCallbackUrl(callbackUrl)
    }

    openExternalUrl(url: string): void {
        const workspaceOpenUrl = this.app.workspace.openUrl
        const didOpen =
            workspaceOpenUrl != null
                ? (workspaceOpenUrl.call(this.app.workspace, url), true)
                : openExternalUrlInObsidianHost(url)
        if (!didOpen) {
            new Notice('Could not open external URL.')
        }
    }

    private buildCallbackUrlFromProtocolParams(
        params: Record<string, string>,
    ): string | null {
        const query = new URLSearchParams()
        let hashPayload: string | null = null

        for (const [key, value] of Object.entries(params)) {
            const normalizedKey = key.trim()
            if (normalizedKey.length === 0 || normalizedKey === 'action') {
                continue
            }

            if (normalizedKey === 'hash') {
                const normalizedHash = this.normalizeOAuthHashPayload(value)
                if (normalizedHash.length > 0) {
                    hashPayload = normalizedHash
                }
                continue
            }

            query.set(normalizedKey, value)
        }

        const queryString = query.toString()
        if (!queryString && !hashPayload) {
            return null
        }

        return `obsidian://${OAUTH_PROTOCOL_ACTION}${queryString ? `?${queryString}` : ''}${hashPayload ? `#${hashPayload}` : ''}`
    }

    private normalizeOAuthHashPayload(rawHash: string): string {
        let normalized = rawHash.trim()
        if (normalized.startsWith('#')) {
            normalized = normalized.slice(1)
        }

        // Obsidian protocol handlers may pass URL-encoded hash fragments in a
        // dedicated "hash" query parameter. Decode up to twice to handle nested
        // encoding without risking an infinite loop on malformed input.
        for (let index = 0; index < 2; index += 1) {
            try {
                const decoded = decodeURIComponent(normalized)
                if (decoded === normalized) {
                    break
                }
                normalized = decoded
            } catch {
                break
            }
        }

        return normalized
    }

    private async handleEditorDrop(
        event: DragEvent,
        editor: Editor,
    ): Promise<void> {
        if (event.defaultPrevented) {
            return
        }

        const resultCardCodeBlock = event.dataTransfer?.getData(
            MEMEX_RESULT_CARD_DRAG_MIME_TYPE,
        )
        if (resultCardCodeBlock?.trim()) {
            event.preventDefault()
            const insertAt = editor.getCursor()
            const insertedText =
                formatDroppedMemexResultCardCodeBlock(resultCardCodeBlock)
            editor.replaceRange(insertedText, insertAt)
            editor.setCursor(
                getEditorPositionAfterInsertedText(insertAt, insertedText),
            )
            return
        }

        const rawData = event.dataTransfer?.getData(
            'application/x-memex-reference',
        )
        if (!rawData) {
            return
        }

        const parsed = this.parseMemexReferenceDragData(rawData)
        if (parsed == null) {
            return
        }

        event.preventDefault()

        const insertionText = await this.resolveDroppedReferenceText(
            parsed.contentId,
        )
        editor.replaceRange(insertionText, editor.getCursor())
    }

    private parseMemexReferenceDragData(
        rawData: string,
    ): { contentId: string } | null {
        try {
            const parsed = JSON.parse(rawData) as { contentId?: string }
            if (!parsed.contentId) {
                return null
            }
            return { contentId: parsed.contentId }
        } catch {
            return null
        }
    }

    private async resolveDroppedReferenceText(
        contentId: string,
    ): Promise<string> {
        return `[[memex:${contentId}]]`
    }

    private getAuthSessionPersistence(): ObsidianAuthSessionPersistence {
        if (this.authSessionPersistence == null) {
            this.authSessionPersistence = new ObsidianAuthSessionPersistence({
                secretStorage: this.app.secretStorage,
                auth: getSupabaseClient().auth,
                onWarning: (message, error) => {
                    console.warn(`[Memex Obsidian] ${message}`, error)
                },
            })
        }

        return this.authSessionPersistence
    }
}
