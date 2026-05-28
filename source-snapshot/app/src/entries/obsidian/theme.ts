import type { UITheme } from '~/utils/ui-theme-bootstrap'

function readThemeFromClassList(classList: DOMTokenList): UITheme | null {
    if (classList.contains('theme-light')) {
        return 'light'
    }
    if (classList.contains('theme-dark')) {
        return 'dark'
    }
    return null
}

export function getObsidianColorTheme(doc: Document = document): UITheme {
    const bodyTheme =
        doc.body != null ? readThemeFromClassList(doc.body.classList) : null
    if (bodyTheme != null) {
        return bodyTheme
    }

    return (
        readThemeFromClassList(doc.documentElement.classList) ??
        inferObsidianColorThemeFromComputedStyle(doc) ??
        'dark'
    )
}

function inferObsidianColorThemeFromComputedStyle(
    doc: Document,
): UITheme | null {
    if (typeof doc.defaultView?.getComputedStyle !== 'function') {
        return null
    }

    const target = doc.body ?? doc.documentElement
    const colorScheme =
        doc.defaultView.getComputedStyle(target).colorScheme ?? ''
    const supportsLight = /\blight\b/.test(colorScheme)
    const supportsDark = /\bdark\b/.test(colorScheme)

    if (supportsLight && !supportsDark) {
        return 'light'
    }
    if (supportsDark && !supportsLight) {
        return 'dark'
    }

    return null
}
