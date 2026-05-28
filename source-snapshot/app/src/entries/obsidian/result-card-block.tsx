import React from 'react'
import type {
    AnnotationEntity,
    ContentEntity,
    PageEntity,
    RedditContentEntity,
    TagEntity,
    TweetContentEntity,
    TwitterProfileContentEntity,
} from '@memex/common/features/page-interactions/types'
import {
    getContentEntityReferenceIds,
    toContentEntityReferences,
} from '@memex/common/features/page-interactions/types'
import { getContentEntityUrl } from '@memex/common/features/page-interactions/utils'
import {
    findAnnotationTargetReferenceId,
    getAnnotationReferenceContentIds,
} from '@memex/common/features/annotations/util/reference-content-ids'
import { parseMemexResultCardPayload } from '~/features/obsidian/result-card-format'
import { UniversalResultCard } from '~/features/search/ui/result-cards'
import { getAnnotationTitle } from '~/features/search/ui/utils/safe-content'
import { ExtUIContext, useUIContext } from '~/ui-scripts/context-provider'
import { buildLoadedContentEntityCacheEntries } from '~/features/global-ui-state/ui/content-entity-cache'
import { openExternalUrlWithAnchor } from './external-url'
import { ObsidianRuntime, ObsidianRuntimeProvider } from './runtime'

const PayloadScopedContext: React.FC<
    React.PropsWithChildren<{
        entity: ContentEntity
        tagEntities?: TagEntity[]
        relatedContentEntities?: ContentEntity[]
    }>
> = ({ entity, tagEntities, relatedContentEntities, children }) => {
    const context = useUIContext()

    const scopedContext = React.useMemo(() => {
        const mergedContentEntities = {
            ...(context.globalState.contentEntities ?? {}),
        }
        const mergedReferencesByContentEntityId = {
            ...(context.globalState.referencesByContentEntityId ?? {}),
        }

        for (const [
            cacheKey,
            contentEntity,
        ] of buildLoadedContentEntityCacheEntries([
            entity,
            ...(relatedContentEntities ?? []),
        ])) {
            mergedContentEntities[cacheKey] = contentEntity
        }
        if (relatedContentEntities?.length) {
            mergedReferencesByContentEntityId[entity.id] = {
                contentEntityIds: toContentEntityReferences(
                    relatedContentEntities.map(
                        (relatedEntity) => relatedEntity.id,
                    ),
                ),
                tagIds:
                    context.globalState.referencesByContentEntityId[entity.id]
                        ?.tagIds ?? [],
            }
        }

        const mergedTagEntities = {
            ...(context.globalState.tags?.tagEntities ?? {}),
        }

        for (const tagEntity of tagEntities ?? []) {
            mergedTagEntities[tagEntity.id] = tagEntity
        }

        return {
            ...context,
            globalLogic: {
                ...context.globalLogic,
                state: {
                    ...context.globalLogic.state,
                    contentEntities: mergedContentEntities,
                    referencesByContentEntityId:
                        mergedReferencesByContentEntityId,
                    tags: {
                        ...(context.globalLogic.state.tags ?? {}),
                        tagEntities: mergedTagEntities,
                    },
                },
            },
            globalState: {
                ...context.globalState,
                contentEntities: mergedContentEntities,
                referencesByContentEntityId: mergedReferencesByContentEntityId,
                tags: {
                    ...(context.globalState.tags ?? {}),
                    tagEntities: mergedTagEntities,
                },
            },
        }
    }, [context, entity, relatedContentEntities, tagEntities])

    return (
        <ExtUIContext.Provider value={scopedContext}>
            {children}
        </ExtUIContext.Provider>
    )
}

const getEntityTitle = (entity: ContentEntity): string => {
    if (entity.type === 'annotation') {
        return getAnnotationTitle(entity as AnnotationEntity)
    }

    if (
        entity.type === 'web' ||
        entity.type === 'pdf' ||
        entity.type === 'youtube'
    ) {
        return (entity as PageEntity).title || (entity as PageEntity).url
    }

    if (entity.type === 'twitter' || entity.type === 'reddit') {
        return (entity as TweetContentEntity | RedditContentEntity).text
    }

    if (entity.type === 'twitterProfile') {
        return (
            (entity as TwitterProfileContentEntity).author_name ||
            (entity as TwitterProfileContentEntity).description ||
            (entity as TwitterProfileContentEntity).author_handle ||
            entity.id
        )
    }

    return entity.id
}

const RenderedResultCard: React.FC<{
    entity: ContentEntity
    snippets?: Array<string | { text: string; offset: number }>
    onOpenExternalUrl: (url: string) => Promise<void> | void
    onOpenNotes: (params: {
        contentEntityId: string
        title: string
    }) => Promise<void>
}> = ({ entity, snippets, onOpenExternalUrl, onOpenNotes }) => {
    const context = useUIContext()
    const url = React.useMemo(
        () =>
            getContentEntityUrl(entity, {
                userId: context.globalState.user?.id,
                getParentEntity: (id) =>
                    context.globalState.contentEntities[id] as
                        | ContentEntity
                        | undefined,
                getRelatedContentIds: (id) =>
                    getContentEntityReferenceIds(
                        context.globalState.referencesByContentEntityId[id]
                            ?.contentEntityIds,
                    ),
            }) ?? null,
        [
            context.globalState.contentEntities,
            context.globalState.referencesByContentEntityId,
            context.globalState.user?.id,
            entity,
        ],
    )
    const notesTargetContentId = React.useMemo(() => {
        if (entity.type !== 'annotation') {
            return entity.id
        }

        const annotationReferenceIds = getAnnotationReferenceContentIds({
            annotationContent: (entity as AnnotationEntity).content,
            relatedContentIds: getContentEntityReferenceIds(
                context.globalState.referencesByContentEntityId[entity.id]
                    ?.contentEntityIds,
            ),
        })

        return (
            findAnnotationTargetReferenceId({
                annotationContent: (entity as AnnotationEntity).content,
                referenceContentIds: annotationReferenceIds,
            }) ??
            annotationReferenceIds[0] ??
            entity.id
        )
    }, [context.globalState.referencesByContentEntityId, entity])
    const notesTargetEntity = React.useMemo(
        () =>
            context.globalState.contentEntities[notesTargetContentId] ?? entity,
        [context.globalState.contentEntities, entity, notesTargetContentId],
    )
    const notesTargetTitle = React.useMemo(
        () => getEntityTitle(notesTargetEntity),
        [notesTargetEntity],
    )

    const handleOpen = React.useCallback(() => {
        if (!url) {
            return
        }

        openExternalUrlWithAnchor(url)
    }, [url])

    const handleOpenNotes = React.useCallback(async () => {
        await onOpenNotes({
            contentEntityId: notesTargetContentId,
            title: notesTargetTitle,
        })
    }, [notesTargetContentId, notesTargetTitle, onOpenNotes])

    const handleCardClick = React.useCallback(
        (event?: React.MouseEvent) => {
            event?.stopPropagation()
            event?.nativeEvent.stopImmediatePropagation()
            if (event?.shiftKey) {
                void handleOpenNotes()
                return
            }

            handleOpen()
        },
        [handleOpen, handleOpenNotes],
    )

    return (
        <div
            className="memex-obsidian-result-card-block memex-obsidian-result-card-block-clickable"
            data-result-url={url ?? ''}
            data-notes-content-id={notesTargetContentId}
            data-notes-title={notesTargetTitle}
            title={
                url
                    ? 'Click to open original document. Shift+click to open notes in Memex sidebar.'
                    : 'Shift+click to open notes in Memex sidebar.'
            }
        >
            <UniversalResultCard
                entity={entity}
                snippets={snippets}
                disableActions
                annotationHydrationState="partial-error"
                onOpenExternalUrl={onOpenExternalUrl}
                onClick={handleCardClick}
            />
        </div>
    )
}

export const ObsidianResultCardBlock: React.FC<{
    runtime: ObsidianRuntime
    source: string
    isolationRoot?: ShadowRoot
    onOpenExternalUrl: (url: string) => Promise<void> | void
    onOpenNotes: (params: {
        contentEntityId: string
        title: string
    }) => Promise<void>
}> = ({ runtime, source, isolationRoot, onOpenExternalUrl, onOpenNotes }) => {
    const payload = React.useMemo(
        () => parseMemexResultCardPayload(source),
        [source],
    )

    if (payload == null) {
        return (
            <div className="memex-obsidian-result-card-error">
                Invalid Memex result card payload.
            </div>
        )
    }

    return (
        <ObsidianRuntimeProvider
            runtime={runtime}
            isolationRoot={isolationRoot}
        >
            <PayloadScopedContext
                entity={payload.entity}
                tagEntities={payload.tagEntities}
                relatedContentEntities={payload.relatedContentEntities}
            >
                <RenderedResultCard
                    entity={payload.entity}
                    snippets={payload.snippets}
                    onOpenExternalUrl={onOpenExternalUrl}
                    onOpenNotes={onOpenNotes}
                />
            </PayloadScopedContext>
        </ObsidianRuntimeProvider>
    )
}
