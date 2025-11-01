import { z } from 'zod'
import { parseIntegerFromText, parseText, prepImg } from './utils'

const BASE_VIDEO_URL = 'https://www.youtube.com/watch?v='

export const ImageSchema = z.object({
	url: z.string().nullable(),
	width: z.number(),
	height: z.number(),
})

export const AuthorSchema = z.object({
	name: z.string(),
	channelID: z.string(),
	url: z.string(),
	bestAvatar: ImageSchema.nullable(),
	avatars: z.array(ImageSchema),
	ownerBadges: z.array(z.string()),
	verified: z.boolean(),
})

export const VideoSchema = z.object({
	type: z.literal('video'),
	name: z.string(),
	id: z.string(),
	url: z.string(),
	thumbnail: z.string(),
	thumbnails: z.array(ImageSchema),
	isUpcoming: z.boolean(),
	upcoming: z.number().nullable(),
	isLive: z.boolean(),
	badges: z.array(z.string()),
	author: AuthorSchema.nullable(),
	description: z.string(),
	views: z.number().nullable(),
	duration: z.string(),
	uploadedAt: z.string(),
})

export const PlaylistSchema = z.object({
	type: z.literal('playlist'),
	id: z.string(),
	name: z.string(),
	url: z.string(),
	owner: AuthorSchema.nullable(),
	publishedAt: z.string().nullable(),
	length: z.number(),
})

export const SearchResultSchema = z.union([VideoSchema, PlaylistSchema])

export type Image = z.infer<typeof ImageSchema>
export type Author = z.infer<typeof AuthorSchema>
export type Video = z.infer<typeof VideoSchema>
export type Playlist = z.infer<typeof PlaylistSchema>
export type SearchResult = z.infer<typeof SearchResultSchema>

// YouTube API response schemas
const YouTubeMetadataBadgeSchema = z
	.object({
		metadataBadgeRenderer: z.object({
			label: z.string(),
			tooltip: z.string().optional(),
		}),
	})
	.passthrough()

const YouTubeNavigationEndpointSchema = z.object({
	browseEndpoint: z.object({
		browseId: z.string(),
		canonicalBaseUrl: z.string().optional(),
	}),
	commandMetadata: z
		.object({
			webCommandMetadata: z.object({
				url: z.string().optional(),
			}),
		})
		.optional(),
})

const YouTubeUpcomingEventDataSchema = z.object({
	startTime: z.string(),
})

const YouTubeThumbnailOverlaySchema = z
	.object({
		thumbnailOverlayTimeStatusRenderer: z
			.object({
				text: z.union([z.string(), z.object({}).passthrough()]),
			})
			.optional(),
	})
	.passthrough()

const YouTubeThumbnailSchemas = z.object({
	thumbnails: z.array(
		z.object({
			url: z.string(),
			width: z.number(),
			height: z.number(),
		}),
	),
})

const YouTubeVideoRendererSchema = z
	.object({
		videoId: z.string(),
		title: z.union([z.string(), z.object({}).passthrough()]).optional(),
		lengthText: z.union([z.string(), z.object({}).passthrough()]).optional(),
		thumbnail: YouTubeThumbnailSchemas,
		thumbnailOverlays: z.array(YouTubeThumbnailOverlaySchema).optional(),
		badges: z.array(YouTubeMetadataBadgeSchema).optional(),
		upcomingEventData: YouTubeUpcomingEventDataSchema.optional(),
		descriptionSnippet: z
			.union([z.string(), z.object({}).passthrough()])
			.optional(),
		viewCountText: z.union([z.string(), z.object({}).passthrough()]).optional(),
		publishedTimeText: z
			.union([z.string(), z.object({}).passthrough()])
			.optional(),
		channelThumbnailSupportedRenderers: z
			.object({
				channelThumbnailWithLinkRenderer: z.object({
					thumbnail: YouTubeThumbnailSchemas,
				}),
			})
			.optional(),
		ownerText: z
			.object({
				runs: z.array(
					z.object({
						text: z.string(),
						navigationEndpoint: YouTubeNavigationEndpointSchema,
					}),
				),
			})
			.optional(),
		ownerBadges: z.array(YouTubeMetadataBadgeSchema).optional(),
	})
	.passthrough()

const YouTubePlaylistRendererSchema = z
	.object({
		playlistId: z.string(),
		title: z.union([z.string(), z.object({}).passthrough()]).optional(),
		videoCount: z.union([z.string(), z.number()]).optional(),
		publishedTimeText: z
			.union([z.string(), z.object({}).passthrough()])
			.optional(),
		shortBylineText: z
			.object({
				simpleText: z.string().optional(),
				runs: z
					.array(
						z.object({
							text: z.string(),
							navigationEndpoint: YouTubeNavigationEndpointSchema,
						}),
					)
					.optional(),
			})
			.optional(),
		longBylineText: z
			.object({
				runs: z.array(
					z.object({
						text: z.string(),
						navigationEndpoint: YouTubeNavigationEndpointSchema,
					}),
				),
			})
			.optional(),
		ownerBadges: z.array(YouTubeMetadataBadgeSchema).optional(),
	})
	.passthrough()

const YouTubeItemSchema = z.union([
	z.object({ videoRenderer: YouTubeVideoRendererSchema }),
	z.object({ playlistRenderer: YouTubePlaylistRendererSchema }),
	z.object({ gridVideoRenderer: YouTubeVideoRendererSchema }),
])

type YouTubeVideoRenderer = z.infer<typeof YouTubeVideoRendererSchema>
type YouTubePlaylistRenderer = z.infer<typeof YouTubePlaylistRendererSchema>

export function parseItem(
	item: Record<string, unknown>,
): Video | Playlist | null {
	if ('lockupViewModel' in item) {
		return parsePlaylistFromLockup(
			item.lockupViewModel as Record<string, unknown>,
		)
	}
	const parsed = YouTubeItemSchema.safeParse(item)
	if (!parsed.success) {
		return null
	}

	const itemData = parsed.data
	if ('videoRenderer' in itemData) {
		return parseVideo(itemData.videoRenderer)
	}
	if ('playlistRenderer' in itemData) {
		return parsePlaylist(itemData.playlistRenderer)
	}
	if ('gridVideoRenderer' in itemData) {
		return parseVideo(itemData.gridVideoRenderer)
	}
	return null
}

function parseVideo(obj: YouTubeVideoRenderer): Video | null {
	const badges = obj.badges
		? obj.badges.map((a) => a.metadataBadgeRenderer.label)
		: []
	const isLive = badges.some((b) => ['LIVE NOW', 'LIVE'].includes(b))
	const upcoming = obj.upcomingEventData
		? Number(`${obj.upcomingEventData.startTime}000`)
		: null
	const lengthFallback = obj.thumbnailOverlays?.find(
		(x) => 'thumbnailOverlayTimeStatusRenderer' in x,
	)
	const lengthText = lengthFallback?.thumbnailOverlayTimeStatusRenderer?.text
	const length = obj.lengthText || lengthText

	const result = {
		type: 'video' as const,
		name: parseText(obj.title),
		id: obj.videoId,
		url: BASE_VIDEO_URL + obj.videoId,
		thumbnail: prepImg(obj.thumbnail.thumbnails)[0]?.url || '',
		thumbnails: prepImg(obj.thumbnail.thumbnails),
		isUpcoming: !!upcoming,
		upcoming,
		isLive,
		badges,
		author: parseAuthor(obj),
		description: parseText(obj.descriptionSnippet),
		views: obj.viewCountText ? parseIntegerFromText(obj.viewCountText) : null,
		duration: parseText(length),
		uploadedAt: parseText(obj.publishedTimeText),
	}

	try {
		return VideoSchema.parse(result)
	} catch {
		return null
	}
}

function parseAuthor(obj: YouTubeVideoRenderer): Author | null {
	const ctsr = obj.channelThumbnailSupportedRenderers
	const authorImg = ctsr?.channelThumbnailWithLinkRenderer || {
		thumbnail: { thumbnails: [] },
	}
	const ownerBadgesString = obj.ownerBadges
		? JSON.stringify(obj.ownerBadges)
		: undefined
	const isOfficial = !!ownerBadgesString?.includes('OFFICIAL')
	const isVerified = !!ownerBadgesString?.includes('VERIFIED')
	const author = obj.ownerText?.runs[0]
	if (!author || !author.navigationEndpoint) return null

	const browseEndpoint = author.navigationEndpoint.browseEndpoint
	const authorUrl =
		browseEndpoint.canonicalBaseUrl ||
		author.navigationEndpoint.commandMetadata?.webCommandMetadata?.url

	if (!authorUrl || !browseEndpoint.browseId) return null

	const result = {
		name: author.text,
		channelID: browseEndpoint.browseId,
		url: new URL(authorUrl, BASE_VIDEO_URL).toString(),
		bestAvatar: prepImg(authorImg.thumbnail.thumbnails)[0] || null,
		avatars: prepImg(authorImg.thumbnail.thumbnails),
		ownerBadges: obj.ownerBadges
			? obj.ownerBadges.map((a) => a.metadataBadgeRenderer.tooltip)
			: [],
		verified: isOfficial || isVerified,
	}

	try {
		return AuthorSchema.parse(result)
	} catch {
		return null
	}
}

function parsePlaylist(obj: YouTubePlaylistRenderer): Playlist | null {
	const result = {
		type: 'playlist' as const,
		id: obj.playlistId,
		name: parseText(obj.title),
		url: `https://www.youtube.com/playlist?list=${obj.playlistId}`,
		owner: parseOwner(obj),
		publishedAt: parseText(obj.publishedTimeText),
		length: Number(obj.videoCount),
	}

	try {
		return PlaylistSchema.parse(result)
	} catch {
		return null
	}
}

function parseOwner(obj: YouTubePlaylistRenderer): Author | null {
	// Auto generated playlists (starting with OL) only provide a simple string
	// Eg: https://www.youtube.com/playlist?list=OLAK5uy_nCItxg-iVIgQUZnPViEyd8xTeRAIr0y5I

	if (obj.shortBylineText?.simpleText) return null

	const owner = obj.shortBylineText?.runs?.[0] || obj.longBylineText?.runs?.[0]

	if (!owner?.navigationEndpoint) return null

	const browseEndpoint = owner.navigationEndpoint.browseEndpoint
	const commandMetadata =
		owner.navigationEndpoint.commandMetadata?.webCommandMetadata
	const ownerUrl = browseEndpoint.canonicalBaseUrl || commandMetadata?.url
	const ownerBadgesString = obj.ownerBadges
		? JSON.stringify(obj.ownerBadges)
		: undefined
	const isOfficial = !!ownerBadgesString?.includes('OFFICIAL')
	const isVerified = !!ownerBadgesString?.includes('VERIFIED')

	if (!ownerUrl || !browseEndpoint.browseId) return null

	const result = {
		name: owner.text,
		channelID: browseEndpoint.browseId,
		url: new URL(ownerUrl, BASE_VIDEO_URL).toString(),
		ownerBadges: obj.ownerBadges
			? obj.ownerBadges.map((a) => a.metadataBadgeRenderer.tooltip)
			: [],
		verified: isOfficial || isVerified,
		bestAvatar: null as Image | null,
		avatars: [] as Image[],
	}

	try {
		return AuthorSchema.parse(result)
	} catch {
		return null
	}
}

function parsePlaylistFromLockup(
	lockup: Record<string, unknown>,
): Playlist | null {
	try {
		// Extract playlist ID
		const contentId = lockup.contentId
		if (typeof contentId !== 'string') return null

		// Extract metadata
		const metadata = lockup.metadata
		if (!metadata || typeof metadata !== 'object') return null
		const metadataObj = metadata as Record<string, unknown>

		const lockupMetadataViewModel = metadataObj.lockupMetadataViewModel
		if (!lockupMetadataViewModel || typeof lockupMetadataViewModel !== 'object')
			return null
		const lockupMeta = lockupMetadataViewModel as Record<string, unknown>

		// Extract title
		const title = lockupMeta.title
		if (!title || typeof title !== 'object') return null
		const titleObj = title as Record<string, unknown>
		const name = titleObj.content
		if (typeof name !== 'string') return null

		// Extract owner from metadata
		const contentMetadata = lockupMeta.metadata
		let owner: Author | null = null
		if (contentMetadata && typeof contentMetadata === 'object') {
			const contentMeta = contentMetadata as Record<string, unknown>
			const contentMetaViewModel = contentMeta.contentMetadataViewModel
			if (contentMetaViewModel && typeof contentMetaViewModel === 'object') {
				const metaVM = contentMetaViewModel as Record<string, unknown>
				const metadataRows = metaVM.metadataRows
				if (Array.isArray(metadataRows) && metadataRows.length > 0) {
					const firstRow = metadataRows[0]
					if (firstRow && typeof firstRow === 'object') {
						const row = firstRow as Record<string, unknown>
						const metadataParts = row.metadataParts
						if (Array.isArray(metadataParts) && metadataParts.length > 0) {
							const firstPart = metadataParts[0]
							if (firstPart && typeof firstPart === 'object') {
								const part = firstPart as Record<string, unknown>
								const text = part.text
								if (text && typeof text === 'object') {
									const textObj = text as Record<string, unknown>
									const ownerName = textObj.content
									if (typeof ownerName === 'string') {
										// For lockupViewModel, we don't have full owner info
										owner = {
											name: ownerName,
											channelID: '',
											url: '',
											ownerBadges: [],
											verified: false,
											bestAvatar: null,
											avatars: [],
										}
									}
								}
							}
						}
					}
				}
			}
		}

		// Extract video count from thumbnail badge
		let length = 0
		const contentImage = lockup.contentImage
		if (contentImage && typeof contentImage === 'object') {
			const contentImg = contentImage as Record<string, unknown>
			const collectionThumbnail = contentImg.collectionThumbnailViewModel
			if (collectionThumbnail && typeof collectionThumbnail === 'object') {
				const collection = collectionThumbnail as Record<string, unknown>
				const primaryThumbnail = collection.primaryThumbnail
				if (primaryThumbnail && typeof primaryThumbnail === 'object') {
					const primary = primaryThumbnail as Record<string, unknown>
					const thumbnailViewModel = primary.thumbnailViewModel
					if (thumbnailViewModel && typeof thumbnailViewModel === 'object') {
						const thumbnail = thumbnailViewModel as Record<string, unknown>
						const overlays = thumbnail.overlays
						if (Array.isArray(overlays)) {
							for (const overlay of overlays) {
								if (overlay && typeof overlay === 'object') {
									const overlayObj = overlay as Record<string, unknown>
									const badge = overlayObj.thumbnailOverlayBadgeViewModel
									if (badge && typeof badge === 'object') {
										const badgeObj = badge as Record<string, unknown>
										const thumbnailBadges = badgeObj.thumbnailBadges
										if (Array.isArray(thumbnailBadges)) {
											for (const tb of thumbnailBadges) {
												if (tb && typeof tb === 'object') {
													const tbObj = tb as Record<string, unknown>
													const tbm = tbObj.thumbnailBadgeViewModel
													if (tbm && typeof tbm === 'object') {
														const tbmObj = tbm as Record<string, unknown>
														const text = tbmObj.text
														if (typeof text === 'string') {
															// Extract number from "N videos" or "N episodes"
															const match = text.match(/(\d+)/)
															if (match) {
																length = Number(match[1])
																break
															}
														}
													}
												}
											}
										}
									}
								}
							}
						}
					}
				}
			}
		}

		const result = {
			type: 'playlist' as const,
			id: contentId,
			name,
			url: `https://www.youtube.com/playlist?list=${contentId}`,
			owner,
			publishedAt: null,
			length,
		}

		return PlaylistSchema.parse(result)
	} catch {
		return null
	}
}
