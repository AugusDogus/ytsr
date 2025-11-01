import { expect, test } from 'bun:test'
import { ytsr } from '../src'

// Disable keepalive for tests to avoid connection pooling issues with YouTube's bot detection
if (!process.env.YTSR_DISABLE_KEEPALIVE) {
	process.env.YTSR_DISABLE_KEEPALIVE = 'true'
}

test('should search for videos', async () => {
	const result = await ytsr('test', { limit: 1 })
	expect(result.items).toBeDefined()
	expect(result.items.length).toBeGreaterThan(0)
	expect(result.query).toBe('test')
	expect(result.results).toBeGreaterThan(0)
})

test('should search for videos with options', async () => {
	const result = await ytsr('disTube', { safeSearch: true, limit: 1 })
	expect(result.items).toBeDefined()
	expect(result.items.length).toBeGreaterThan(0)
	const video = result.items[0]
	if (video.type === 'video') {
		expect(video.id).toBeDefined()
		expect(video.name).toBeDefined()
		expect(video.url).toBeDefined()
		expect(video.thumbnail).toBeDefined()
		expect(video.thumbnails).toBeInstanceOf(Array)
		expect(video.type).toBe('video')
	}
})

test('should search for playlists', async () => {
	const result = await ytsr('chill music', { type: 'playlist', limit: 3 })
	expect(result.items).toBeDefined()
	expect(Array.isArray(result.items)).toBe(true)
	expect(result.items.length).toBeGreaterThan(0)

	// Playlists may be empty, so just verify structure if any exist
	if (result.items.length > 0) {
		const playlist = result.items[0]
		if (playlist.type === 'playlist') {
			expect(playlist.id).toBeDefined()
			expect(playlist.name).toBeDefined()
			expect(playlist.url).toBeDefined()
			expect(playlist.length).toBeGreaterThanOrEqual(0)
			expect(typeof playlist.length).toBe('number')
		}
	}
})

test('should respect limit option', async () => {
	const result = await ytsr('music', { limit: 5 })
	expect(result.items.length).toBeLessThanOrEqual(5)
})

test('should return video with all expected fields', async () => {
	const result = await ytsr('disTube', { limit: 1 })
	const video = result.items[0]

	if (video && video.type === 'video') {
		expect(typeof video.isUpcoming).toBe('boolean')
		expect(typeof video.isLive).toBe('boolean')
		expect(video.badges).toBeInstanceOf(Array)
		expect(typeof video.description).toBe('string')
		expect(typeof video.duration).toBe('string')
		expect(typeof video.uploadedAt).toBe('string')
		expect(typeof video.views).toMatch(/number|null/)
		expect(video.thumbnail).toContain('ytimg.com')
		expect(video.url).toContain('youtube.com/watch')
	}
})

test('should handle zero results gracefully', async () => {
	const result = await ytsr('asdfghjklzxcvbnm999111222', { limit: 10 })
	expect(result.items).toBeDefined()
	expect(Array.isArray(result.items)).toBe(true)
})

test('should support localization options', async () => {
	const result = await ytsr('test', { hl: 'es', gl: 'MX', limit: 1 })
	expect(result.items.length).toBeGreaterThan(0)
})
