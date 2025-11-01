import { z } from 'zod'

const BASE_URL = 'https://www.youtube.com/'
const DEFAULT_OPTIONS = { limit: 10, safeSearch: false }
const DEFAULT_QUERY = { gl: 'US', hl: 'en' }
const DEFAULT_CONTEXT: {
	client: {
		utcOffsetMinutes: number
		gl: string
		hl: string
		clientName: string
		clientVersion: string
	}
	user: {
		enableSafetyMode?: boolean
	}
} = {
	client: {
		utcOffsetMinutes: -300,
		gl: 'US',
		hl: 'en',
		clientName: 'WEB',
		clientVersion: '<important information>',
	},
	user: {},
}
const CONSENT_COOKIE = 'SOCS=CAI'

const YouTubeTextSchema = z.union([
	z.object({
		simpleText: z.string(),
	}),
	z.object({
		runs: z.array(
			z.object({
				text: z.string(),
			}),
		),
	}),
])

const YouTubeImageSchema = z
	.object({
		url: z.string(),
		width: z.number(),
		height: z.number(),
	})
	.passthrough()

type YouTubeImage = z.infer<typeof YouTubeImageSchema>

const YouTubeInitialDataSchema = z
	.object({
		responseContext: z.object({
			serviceTrackingParams: z.array(
				z.object({
					params: z
						.array(
							z.object({
								key: z.string(),
								value: z.string(),
							}),
						)
						.optional(),
				}),
			),
		}),
	})
	.passthrough()

function tryParseBetween(
	body: string,
	left: string,
	right: string,
	addEndCurly = false,
) {
	try {
		let data = between(body, left, right)
		if (!data) return null
		if (addEndCurly) data += '}'
		return JSON.parse(data)
	} catch (_e) {
		return null
	}
}

function getClientVersion(json: unknown): string | null {
	try {
		const parsed = YouTubeInitialDataSchema.safeParse(json)
		if (!parsed.success) return null

		const { serviceTrackingParams } = parsed.data.responseContext
		for (const service of serviceTrackingParams) {
			if (!service.params) continue
			const param = service.params.find((p) => p.key === 'cver')
			if (!param || !param.value) continue
			return param.value
		}
	} catch (_e) {
		// noop
	}
	return null
}

export const ParsedBodySchema = z.object({
	json: z.unknown().optional(),
	apiKey: z.string().optional(),
	context: z
		.object({
			client: z.object({
				clientVersion: z.string(),
				utcOffsetMinutes: z.number(),
				gl: z.string(),
				hl: z.string(),
				clientName: z.string(),
			}),
			user: z.object({
				enableSafetyMode: z.boolean().optional(),
			}),
		})
		.optional(),
})

export const NormalizedOptionsSchema = z.object({
	limit: z.number(),
	safeSearch: z.boolean(),
	type: z.enum(['video', 'playlist']),
	requestOptions: z.custom<RequestInit>().optional(),
	query: z.record(z.string()),
	search: z.string(),
	gl: z.string().optional(),
	hl: z.string().optional(),
	utcOffsetMinutes: z.number().optional(),
})

export type ParsedBody = z.infer<typeof ParsedBodySchema>
export type NormalizedOptions = z.infer<typeof NormalizedOptionsSchema>

export function parseBody(
	body: string,
	options: Partial<NormalizedOptions> = {},
): ParsedBody {
	const json =
		tryParseBetween(body, 'var ytInitialData = ', '};', true) ||
		tryParseBetween(body, 'window["ytInitialData"] = ', '};', true) ||
		tryParseBetween(body, 'var ytInitialData = ', ';</script>') ||
		tryParseBetween(body, 'window["ytInitialData"] = ', ';</script>')

	const apiKey = undefined
	const clientVersion =
		getClientVersion(json) ||
		between(body, 'INNERTUBE_CONTEXT_CLIENT_VERSION":"', '"') ||
		between(body, 'innertube_context_client_version":"', '"')
	const context = buildPostContext(clientVersion || '', options)

	return ParsedBodySchema.parse({ json, apiKey, context })
}

export function buildPostContext(
	clientVersion: string,
	options: Partial<NormalizedOptions> = {},
) {
	const context = structuredClone(DEFAULT_CONTEXT)
	context.client.clientVersion = clientVersion || ''

	if (options.gl) context.client.gl = options.gl
	if (options.hl) context.client.hl = options.hl
	if (options.utcOffsetMinutes)
		context.client.utcOffsetMinutes = options.utcOffsetMinutes
	if (options.safeSearch) {
		context.user.enableSafetyMode = true
	}

	return context
}

export function parseText(txt: unknown): string {
	const parsed = YouTubeTextSchema.safeParse(txt)
	if (!parsed.success) return ''

	if ('simpleText' in parsed.data) {
		return parsed.data.simpleText
	}

	return parsed.data.runs.map((a) => a.text).join('')
}

export function parseIntegerFromText(x: unknown): number {
	return typeof x === 'string'
		? Number(x)
		: Number(parseText(x).replace(/\D+/g, ''))
}

export async function doPost(
	url: string,
	opts: RequestInit,
	payload: unknown,
): Promise<unknown> {
	const reqOpts = {
		...opts,
		method: 'POST',
		body: JSON.stringify(payload),
	}
	const r = await fetch(url, reqOpts)
	return r.json()
}

export function checkArgs(
	searchString: string,
	options: {
		safeSearch?: boolean
		limit?: number
		hl?: string
		gl?: string
		utcOffsetMinutes?: number
		type?: 'video' | 'playlist'
		requestOptions?: RequestInit
	} = {},
): NormalizedOptions {
	if (!searchString) {
		throw new Error('search string is mandatory')
	}
	if (typeof searchString !== 'string') {
		throw new Error('search string must be of type string')
	}

	if (
		typeof options.type !== 'string' ||
		!['video', 'playlist'].includes(options.type)
	) {
		options.type = 'video'
	}

	const obj: Record<string, unknown> = { ...DEFAULT_OPTIONS, ...options }

	if (Number.isNaN(Number(obj.limit)) || Number(obj.limit) <= 0) {
		obj.limit = DEFAULT_OPTIONS.limit
	}
	if (typeof obj.safeSearch !== 'boolean') {
		obj.safeSearch = DEFAULT_OPTIONS.safeSearch
	}

	const requestOptionsValue = options.requestOptions || {}
	const headers = new Headers(requestOptionsValue.headers)

	const cookie = headers.get('cookie') || headers.get('Cookie')
	if (!cookie) {
		headers.set('cookie', CONSENT_COOKIE)
	} else if (!cookie.includes('SOCS=')) {
		headers.set('cookie', `${cookie}; ${CONSENT_COOKIE}`)
	}

	obj.requestOptions = { ...requestOptionsValue, headers }

	const inputURL = new URL(searchString, BASE_URL)
	let query: Record<string, string> = {}
	if (
		searchString.startsWith(BASE_URL) &&
		inputURL.pathname === '/results' &&
		inputURL.searchParams.has('sp')
	) {
		if (!inputURL.searchParams.get('search_query')) {
			throw new Error('filter links have to include a "search_string" query')
		}
		for (const key of inputURL.searchParams.keys()) {
			query[key] = inputURL.searchParams.get(key) || ''
		}
	} else {
		query = { search_query: searchString }
	}

	const search = query.search_query

	query = { ...DEFAULT_QUERY, ...query }
	if (options.gl && typeof options.gl === 'string') {
		query.gl = options.gl
	}
	if (options.hl && typeof options.hl === 'string') {
		query.hl = options.hl
	}

	const gl = typeof options.gl === 'string' ? options.gl : undefined
	const hl = typeof options.hl === 'string' ? options.hl : undefined
	const utcOffsetMinutes =
		typeof options.utcOffsetMinutes === 'number'
			? options.utcOffsetMinutes
			: undefined

	return NormalizedOptionsSchema.parse({
		...obj,
		query,
		search,
		gl,
		hl,
		utcOffsetMinutes,
	})
}

function between(haystack: string, left: string, right: string): string {
	let pos: number
	pos = haystack.indexOf(left)
	if (pos === -1) {
		return ''
	}
	pos += left.length
	haystack = haystack.slice(pos)
	pos = haystack.indexOf(right)
	if (pos === -1) {
		return ''
	}
	haystack = haystack.slice(0, pos)
	return haystack
}

export function betweenFromRight(
	haystack: string,
	left: string,
	right: string,
): string {
	let pos: number
	pos = haystack.indexOf(right)
	if (pos === -1) {
		return ''
	}
	haystack = haystack.slice(0, pos)
	pos = haystack.lastIndexOf(left)
	if (pos === -1) {
		return ''
	}
	pos += left.length
	haystack = haystack.slice(pos)
	return haystack
}

export function prepImg(img: unknown[]): YouTubeImage[] {
	const images = img
		.map((x) => {
			const parsed = YouTubeImageSchema.safeParse(x)
			if (!parsed.success) return null
			return {
				...parsed.data,
				url: parsed.data.url
					? new URL(parsed.data.url, BASE_URL).toString()
					: null,
			}
		})
		.filter((x): x is YouTubeImage => x !== null)

	return images.sort((a, b) => b.width - a.width)
}

const YouTubeItemSectionRendererSchema = z.object({
	itemSectionRenderer: z.object({
		contents: z.array(z.record(z.unknown())),
	}),
})

const YouTubeRichItemRendererSchema = z.object({
	richItemRenderer: z.object({
		content: z.record(z.unknown()),
	}),
})

const YouTubeRichSectionRendererSchema = z.object({
	richSectionRenderer: z.object({
		content: z.record(z.unknown()),
	}),
})

const YouTubeRendererItemSchema = z.union([
	YouTubeItemSectionRendererSchema,
	YouTubeRichItemRendererSchema,
	YouTubeRichSectionRendererSchema,
	z.object({ continuationItemRenderer: z.unknown() }),
])

const YouTubePrimaryContentsSchema = z.union([
	z.object({
		sectionListRenderer: z.object({
			contents: z.array(YouTubeRendererItemSchema),
		}),
	}),
	z.object({
		richGridRenderer: z.object({
			contents: z.array(YouTubeRendererItemSchema),
		}),
	}),
])

const YouTubeSearchResponseSchema = z.object({
	contents: z.object({
		twoColumnSearchResultsRenderer: z.object({
			primaryContents: YouTubePrimaryContentsSchema,
		}),
	}),
	estimatedResults: z.union([z.string(), z.number()]).optional(),
})

export function parseSearchResponse(json: unknown) {
	const parsed = YouTubeSearchResponseSchema.safeParse(json)
	if (!parsed.success) {
		return null
	}
	return {
		primaryContents:
			parsed.data.contents.twoColumnSearchResultsRenderer.primaryContents,
		estimatedResults: parsed.data.estimatedResults,
	}
}

export function parseWrapper(primaryContents: unknown) {
	const parsed = YouTubePrimaryContentsSchema.safeParse(primaryContents)
	if (!parsed.success) return { rawItems: [], continuation: null }

	const data = parsed.data
	let rawItems: Record<string, unknown>[] = []
	let continuation: z.infer<
		typeof YouTubeContinuationItemRendererSchema
	> | null = null

	if ('sectionListRenderer' in data) {
		const itemSection = data.sectionListRenderer.contents.find(
			(x) => 'itemSectionRenderer' in x,
		)
		if (itemSection && 'itemSectionRenderer' in itemSection) {
			const itemSectionParsed =
				YouTubeItemSectionRendererSchema.safeParse(itemSection)
			if (itemSectionParsed.success) {
				rawItems = itemSectionParsed.data.itemSectionRenderer.contents
			}
		}
		const contItem = data.sectionListRenderer.contents.find(
			(x) => 'continuationItemRenderer' in x,
		)
		if (contItem) {
			const contParsed =
				YouTubeContinuationItemRendererSchema.safeParse(contItem)
			if (contParsed.success) {
				continuation = contParsed.data
			}
		}
	} else if ('richGridRenderer' in data) {
		rawItems = data.richGridRenderer.contents
			.filter((x) => !('continuationItemRenderer' in x))
			.map((x) => {
				if ('richItemRenderer' in x) {
					const richParsed = YouTubeRichItemRendererSchema.safeParse(x)
					if (richParsed.success) {
						return richParsed.data.richItemRenderer.content
					}
				}
				if ('richSectionRenderer' in x) {
					const richParsed = YouTubeRichSectionRendererSchema.safeParse(x)
					if (richParsed.success) {
						return richParsed.data.richSectionRenderer.content
					}
				}
				return null
			})
			.filter((x): x is Record<string, unknown> => x !== null)
		const contItem = data.richGridRenderer.contents.find(
			(x) => 'continuationItemRenderer' in x,
		)
		if (contItem) {
			const contParsed =
				YouTubeContinuationItemRendererSchema.safeParse(contItem)
			if (contParsed.success) {
				continuation = contParsed.data
			}
		}
	}

	return { rawItems, continuation }
}

const YouTubeContinuationItemRendererSchema = z.object({
	continuationItemRenderer: z.object({
		continuationEndpoint: z.object({
			continuationCommand: z.object({
				token: z.string(),
			}),
		}),
	}),
})

const YouTubeContinuationItemsActionSchema = z.object({
	appendContinuationItemsAction: z.object({
		continuationItems: z.array(z.unknown()),
	}),
})

const YouTubePage2ResponseSchema = z.object({
	onResponseReceivedCommands: z.array(YouTubeContinuationItemsActionSchema),
})

const YouTubeSearchHeaderSchema = z.object({
	header: z.object({
		searchHeaderRenderer: z.object({
			searchFilterButton: z.object({
				buttonRenderer: z.object({
					command: z.object({
						openPopupAction: z.object({
							popup: z.object({
								searchFilterOptionsDialogRenderer: z.object({
									groups: z.array(
										z.object({
											searchFilterGroupRenderer: z.object({
												filters: z.array(
													z.object({
														searchFilterRenderer: z.object({
															navigationEndpoint: z.object({
																searchEndpoint: z.object({
																	params: z.string(),
																}),
															}),
														}),
													}),
												),
											}),
										}),
									),
								}),
							}),
						}),
					}),
				}),
			}),
		}),
	}),
})

export function parsePage2Response(json: unknown): unknown[] | null {
	const parsed = YouTubePage2ResponseSchema.safeParse(json)
	if (!parsed.success || parsed.data.onResponseReceivedCommands.length === 0) {
		return null
	}
	const firstCommand = parsed.data.onResponseReceivedCommands[0]
	return firstCommand
		? firstCommand.appendContinuationItemsAction.continuationItems
		: null
}

export function parsePage2Wrapper(continuationItems: unknown[]) {
	const rawItems: Record<string, unknown>[] = []
	let continuation: z.infer<
		typeof YouTubeContinuationItemRendererSchema
	> | null = null

	for (const ci of continuationItems) {
		const parsed = YouTubeRendererItemSchema.safeParse(ci)
		if (!parsed.success) continue

		if ('itemSectionRenderer' in parsed.data) {
			const itemSectionParsed = YouTubeItemSectionRendererSchema.safeParse(
				parsed.data,
			)
			if (itemSectionParsed.success) {
				rawItems.push(...itemSectionParsed.data.itemSectionRenderer.contents)
			}
		} else if ('richItemRenderer' in parsed.data) {
			const richParsed = YouTubeRichItemRendererSchema.safeParse(parsed.data)
			if (richParsed.success) {
				rawItems.push(richParsed.data.richItemRenderer.content)
			}
		} else if ('richSectionRenderer' in parsed.data) {
			const richParsed = YouTubeRichSectionRendererSchema.safeParse(parsed.data)
			if (richParsed.success) {
				rawItems.push(richParsed.data.richSectionRenderer.content)
			}
		} else if ('continuationItemRenderer' in parsed.data) {
			const contParsed = YouTubeContinuationItemRendererSchema.safeParse(
				parsed.data,
			)
			if (contParsed.success) {
				continuation = contParsed.data
			}
		}
	}

	return { rawItems, continuation }
}

export function getPlaylistParams(parsed: unknown): string | null {
	try {
		const parsedData = ParsedBodySchema.safeParse(parsed)
		if (!parsedData.success || !parsedData.data.json) return null

		const headerParsed = YouTubeSearchHeaderSchema.safeParse(
			parsedData.data.json,
		)
		if (!headerParsed.success) return null

		const groups =
			headerParsed.data.header.searchHeaderRenderer.searchFilterButton
				.buttonRenderer.command.openPopupAction.popup
				.searchFilterOptionsDialogRenderer.groups

		if (groups.length < 2) return null

		const group = groups[1]
		if (!group) return null

		const filters = group.searchFilterGroupRenderer.filters
		if (filters.length < 3) return null

		const filter = filters[2]
		if (!filter) return null

		return filter.searchFilterRenderer.navigationEndpoint.searchEndpoint.params
	} catch {
		return null
	}
}
