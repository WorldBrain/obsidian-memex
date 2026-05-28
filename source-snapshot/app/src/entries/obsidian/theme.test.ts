// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getObsidianColorTheme } from './theme'

describe('getObsidianColorTheme', () => {
    afterEach(() => {
        document.body.className = ''
        document.documentElement.className = ''
        vi.restoreAllMocks()
    })

    it('reads light mode from the Obsidian body theme class', () => {
        document.body.classList.add('theme-light')
        document.documentElement.classList.add('theme-dark')

        expect(getObsidianColorTheme()).toBe('light')
    })

    it('reads dark mode from the Obsidian body theme class', () => {
        document.body.classList.add('theme-dark')

        expect(getObsidianColorTheme()).toBe('dark')
    })

    it('falls back to the document element theme class', () => {
        document.documentElement.classList.add('theme-light')

        expect(getObsidianColorTheme()).toBe('light')
    })

    it('can infer the theme from computed color-scheme', () => {
        vi.spyOn(window, 'getComputedStyle').mockReturnValue({
            colorScheme: 'light',
        } as CSSStyleDeclaration)

        expect(getObsidianColorTheme()).toBe('light')
    })
})
