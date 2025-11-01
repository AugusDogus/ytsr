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
