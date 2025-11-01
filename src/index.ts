import { type Playlist, parseItem, type Video } from './parseItem'
import {
	buildPostContext,
	checkArgs,
	doPost,
	getPlaylistParams,
	type NormalizedOptions,
	type ParsedBody,
	parseBody,
	parsePage2Response,
	parsePage2Wrapper,
	parseSearchResponse,
	parseWrapper,
} from './utils'

const BASE_SEARCH_URL = 'https://www.youtube.com/results'
const BASE_API_URL = 'https://www.youtube.com/youtubei/v1/search'
const CACHE = new Map([
	['clientVersion', '2.20240606.06.00'],
	['playlistParams', 'EgIQAw%3D%3D'],
])

interface SearchOptions {
	safeSearch?: boolean
	limit?: number
	hl?: string
	gl?: string
	utcOffsetMinutes?: number
	type?: 'video' | 'playlist'
	requestOptions?: RequestInit
}

interface VideoResult {
	query: string
	items: Video[]
	results: number
}

interface PlaylistResult {
	query: string
	items: Playlist[]
	results: number
}

function saveCache(parsed: ParsedBody, opts: NormalizedOptions) {
	if (parsed.context?.client?.clientVersion) {
		CACHE.set('clientVersion', parsed.context.client.clientVersion)
	} else if (CACHE.has('clientVersion')) {
		parsed.context = buildPostContext(CACHE.get('clientVersion') || '', opts)
	}
	const plParams = getPlaylistParams(parsed)
	if (plParams) CACHE.set('playlistParams', plParams)
}

async function parsePage2(
	token: string,
	context: ParsedBody['context'],
	opts: NormalizedOptions,
): Promise<(Video | Playlist | null)[]> {
	const headers = new Headers(opts.requestOptions?.headers)
	headers.set('Content-Type', 'application/json')
	const json = await doPost(
		BASE_API_URL,
		{
			...opts.requestOptions,
			method: 'POST',
			headers,
		},
		{ context, continuation: token },
	)

	const items = parsePage2Response(json)
	if (!items) {
		return []
	}

	try {
		const { rawItems, continuation } = parsePage2Wrapper(items)
		const parsedItems = rawItems
			.map((item) => parseItem(item))
			.filter((r): r is Video | Playlist => r !== null && r.type === opts.type)
			.filter((_, index) => index < opts.limit)

		opts.limit -= parsedItems.length

		let nextToken: string | null = null
		if (continuation) {
			nextToken =
				continuation.continuationItemRenderer.continuationEndpoint
					.continuationCommand.token
		}

		if (!nextToken || opts.limit < 1) return parsedItems

		const nestedResp = await parsePage2(nextToken, context, opts)
		parsedItems.push(
			...nestedResp.filter((item): item is Video | Playlist => item !== null),
		)
		return parsedItems
	} catch (_e) {
		return []
	}
}

export async function ytsr(
	searchString: string,
	options: SearchOptions & { type: 'video' },
): Promise<VideoResult>
export async function ytsr(
	searchString: string,
	options: SearchOptions & { type: 'playlist' },
): Promise<PlaylistResult>
export async function ytsr(
	searchString: string,
	options?: SearchOptions,
): Promise<VideoResult | PlaylistResult>
export async function ytsr(
	searchString: string,
	options?: SearchOptions,
	retries?: number,
): Promise<VideoResult | PlaylistResult>
export async function ytsr(
	searchString: string,
	options: SearchOptions = {},
	retries = 3,
): Promise<VideoResult | PlaylistResult> {
	if (retries === 2) {
		CACHE.delete('clientVersion')
		CACHE.delete('playlistParams')
	}
	if (retries === 0) throw new Error('Unable to find JSON!')

	const opts = checkArgs(searchString, options)

	let parsed: ParsedBody = {
		json: undefined,
		apiKey: undefined,
		context: undefined,
	}

	const shouldFetch =
		!opts.safeSearch ||
		!CACHE.has('clientVersion') ||
		!CACHE.has('playlistParams')

	if (shouldFetch) {
		const url = new URL(BASE_SEARCH_URL)
		for (const [key, value] of Object.entries(opts.query)) {
			url.searchParams.set(key, value)
		}

		// Disable keepalive if YTSR_DISABLE_KEEPALIVE is set to avoid connection pooling issues with YouTube's bot detection
		const fetchOpts: RequestInit = opts.requestOptions || {}
		if (process.env.YTSR_DISABLE_KEEPALIVE === 'true') {
			fetchOpts.keepalive = false
		}

		const res = await fetch(url.toString(), fetchOpts)
		const body = await res.text()
		parsed = parseBody(body, opts)
	}

	saveCache(parsed, opts)

	if (opts.type === 'playlist') {
		const params = CACHE.get('playlistParams')
		const headers = new Headers(opts.requestOptions?.headers)
		headers.set('Content-Type', 'application/json')
		const json = await doPost(
			BASE_API_URL,
			{
				...opts.requestOptions,
				method: 'POST',
				headers,
			},
			{
				context: parsed.context,
				params,
				query: searchString,
			},
		)
		parsed.json = json
		if (!parsed.json) throw new Error('Cannot searching for Playlist!')
	} else if (opts.safeSearch || !parsed.json) {
		try {
			const headers = new Headers(opts.requestOptions?.headers)
			headers.set('Content-Type', 'application/json')
			const json = await doPost(
				BASE_API_URL,
				{
					...opts.requestOptions,
					method: 'POST',
					headers,
				},
				{
					context: parsed.context,
					query: searchString,
				},
			)
			parsed.json = json
		} catch (e) {
			if (retries === 1) throw e
		}
	}

	if (!parsed.json) return ytsr(searchString, options, retries - 1)

	const searchResponse = parseSearchResponse(parsed.json)
	if (!searchResponse) return ytsr(searchString, options, retries - 1)

	const { rawItems, continuation } = parseWrapper(
		searchResponse.primaryContents,
	)

	const items = rawItems
		.map((a) => parseItem(a))
		.filter((r): r is Video | Playlist => r !== null && r.type === opts.type)
		.filter((_, index) => index < opts.limit)

	opts.limit -= items.length

	const results =
		typeof searchResponse.estimatedResults === 'number'
			? searchResponse.estimatedResults
			: typeof searchResponse.estimatedResults === 'string'
				? Number(searchResponse.estimatedResults) || 0
				: 0

	let token: string | null = null
	if (continuation) {
		token =
			continuation.continuationItemRenderer.continuationEndpoint
				.continuationCommand.token
	}

	if (!token || opts.limit < 1) {
		if (opts.type === 'video') {
			return {
				query: opts.search,
				items: items.filter((item): item is Video => item.type === 'video'),
				results,
			}
		} else {
			return {
				query: opts.search,
				items: items.filter(
					(item): item is Playlist => item.type === 'playlist',
				),
				results,
			}
		}
	}

	const nestedResp = await parsePage2(token, parsed.context, opts)

	const allItems = [
		...items,
		...nestedResp.filter((item): item is Video | Playlist => item !== null),
	]
	if (opts.type === 'video') {
		return {
			query: opts.search,
			items: allItems.filter((item): item is Video => item.type === 'video'),
			results,
		}
	} else {
		return {
			query: opts.search,
			items: allItems.filter(
				(item): item is Playlist => item.type === 'playlist',
			),
			results,
		}
	}
}

export default ytsr
