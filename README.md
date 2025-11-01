# @augusdogus/ytsr

A modern TypeScript library for anonymous YouTube search requests.

## Features

- Search for videos on YouTube
- Support for `video` and `playlist` types
- Modern TypeScript with runtime validation using Zod
- Built with Bun for high performance
- Zero dependencies (except Zod for type safety)

## Installation

```bash
bun add @augusdogus/ytsr
```

or

```bash
npm install @augusdogus/ytsr
```

## Usage

### Basic Search

```typescript
import ytsr from '@augusdogus/ytsr'

// Search for videos
const result = await ytsr('music', { safeSearch: true, limit: 1 })

console.log('Query:', result.query)
console.log('Total results:', result.results)
console.log('Items:', result.items)

if (result.items[0]) {
  const video = result.items[0]
  console.log('ID:', video.id)
  console.log('Name:', video.name)
  console.log('URL:', video.url)
  console.log('Views:', video.views)
  console.log('Duration:', video.duration)
  console.log('Live:', video.isLive)
}
```

### Search for Playlists

```typescript
const result = await ytsr('chill music', { type: 'playlist', limit: 5 })

result.items.forEach(playlist => {
  if (playlist.type === 'playlist') {
    console.log(playlist.name)
    console.log(`${playlist.length} videos`)
    console.log(playlist.url)
  }
})
```

### Options

- `safeSearch` (boolean): Enable YouTube's safe search mode
- `limit` (number): Maximum number of results to return (default: 10)
- `hl` (string): Language code for localization (default: 'en')
- `gl` (string): Country code for localization (default: 'US')
- `utcOffsetMinutes` (number): UTC offset for localization
- `type` ('video' | 'playlist'): Filter by content type (default: 'video')
- `requestOptions` (RequestInit): Additional fetch options

## Troubleshooting

### Connection Pooling Issues (Bun)

If you're experiencing timeouts or connection issues when using this library with Bun, you may be hitting YouTube's bot detection due to connection pooling. Set the following environment variable to disable HTTP keep-alive:

```bash
export YTSR_DISABLE_KEEPALIVE=true
```

Or in your code:

```typescript
process.env.YTSR_DISABLE_KEEPALIVE = 'true'
```

## API

### `ytsr(query: string, options?: SearchOptions): Promise<VideoResult | PlaylistResult>`

Searches YouTube for the given query string.

**Returns:**
- For videos: `{ query: string, items: Video[], results: number }`
- For playlists: `{ query: string, items: Playlist[], results: number }`

**Video Object:**
```typescript
{
  type: 'video'
  id: string
  name: string
  url: string
  thumbnail: string
  thumbnails: Image[]
  isUpcoming: boolean
  upcoming: number | null
  isLive: boolean
  badges: string[]
  author: Author | null
  description: string
  views: number | null
  duration: string
  uploadedAt: string
}
```

**Playlist Object:**
```typescript
{
  type: 'playlist'
  id: string
  name: string
  url: string
  owner: Author | null
  publishedAt: string | null
  length: number
}
```

## Contributing

Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for contribution guidelines.

## License

MIT

## Acknowledgments

- Forked from [@distube/ytsr](https://www.npmjs.com/package/@distube/ytsr) (originally built for [DisTube](https://distube.js.org))
- Original [ytsr](https://www.npmjs.com/package/ytsr) library by @TimeForANinja
