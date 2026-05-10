import { describe, expect, it } from 'vitest'
// @ts-expect-error Local build helper is authored as .mjs without TypeScript declarations.
import { applyReleaseVersionToObsidianManifest } from '../../../../scripts/release-version.mjs'

describe('applyReleaseVersionToObsidianManifest', () => {
    it('stamps Obsidian release metadata from the central release config', () => {
        const manifest = applyReleaseVersionToObsidianManifest(
            {
                id: 'memex',
                version: '0.0.0',
                minAppVersion: '0.0.0',
            },
            {
                obsidian: {
                    version: '1.2.3',
                    minAppVersion: '1.7.2',
                },
            },
        )

        expect(manifest).toMatchObject({
            version: '1.2.3',
            minAppVersion: '1.7.2',
        })
    })
})
