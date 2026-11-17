import { lastError, run } from './process';
import type { SourceKind } from './types';

const FEED_BASE = 'https://www.youtube.com/feeds/videos.xml';
const REQUEST_TIMEOUT_MS = 20_000;
/** Skips the EU cookie-consent interstitial when scraping a channel page. */
const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.8',
  Cookie: 'SOCS=CAI; CONSENT=YES+1',
};

export interface SourceRef {
  kind: SourceKind;
  sourceId: string;
}

export interface FeedEntry {
  videoId: string;
  title: string;
  channel: string;
  url: string;
  thumbnail: string;
  publishedAt: string | null;
  isShort: boolean;
}

export interface Feed {
  title: string;
  /** Channel that publishes the feed: the channel itself, or a playlist's owner. */
  ownerChannelId: string | null;
  ownerName: string | null;
  entries: FeedEntry[];
}

export interface ChannelPlaylist {
  id: string;
  title: string;
  url: string;
  thumbnail: string | null;
}

export function watchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export function thumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

/** Page used to browse the source on YouTube, and given to yt-dlp to list its videos. */
export function sourceUrl(ref: SourceRef): string {
  return ref.kind === 'channel'
    ? `https://www.youtube.com/channel/${ref.sourceId}/videos`
    : `https://www.youtube.com/playlist?list=${ref.sourceId}`;
}

export function feedUrl(ref: SourceRef): string {
  const param = ref.kind === 'channel' ? 'channel_id' : 'playlist_id';
  return `${FEED_BASE}?${param}=${encodeURIComponent(ref.sourceId)}`;
}

/** Extracts the 11-character video id from any YouTube video URL. */
export function videoIdFromUrl(url: string): string | null {
  const match = url.match(/(?:[?&]v=|\/shorts\/|youtu\.be\/|\/embed\/|\/live\/)([\w-]{11})/);
  return match ? match[1] : null;
}

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (match: string, code: string) => {
    if (code.startsWith('#')) {
      const isHex = code[1] === 'x' || code[1] === 'X';
      const value = Number.parseInt(code.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      return Number.isFinite(value) ? String.fromCodePoint(value) : match;
    }
    return XML_ENTITIES[code] ?? match;
  });
}

function tagText(xml: string, name: string): string | null {
  const match = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return match ? decodeXml(match[1].trim()) : null;
}

function attribute(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return match ? decodeXml(match[1]) : null;
}

/**
 * Parses a YouTube Atom feed. The feed is small and regular, so a few regexes
 * are enough and avoid an XML dependency.
 */
export function parseFeed(xml: string): Feed {
  const firstEntry = xml.indexOf('<entry>');
  const head = firstEntry === -1 ? xml : xml.slice(0, firstEntry);
  const feedTitle = tagText(head, 'title') ?? '';
  const entries: FeedEntry[] = [];
  const entryPattern = /<entry>([\s\S]*?)<\/entry>/g;
  let match: RegExpExecArray | null;

  while ((match = entryPattern.exec(xml)) !== null) {
    const body = match[1];
    const videoId = tagText(body, 'yt:videoId');
    if (videoId === null) {
      continue;
    }
    let url = watchUrl(videoId);
    for (const link of body.match(/<link\s[^>]*>/g) ?? []) {
      const href = attribute(link, 'href');
      if (attribute(link, 'rel') === 'alternate' && href !== null) {
        url = href;
      }
    }
    const thumbnailTag = body.match(/<media:thumbnail\s[^>]*>/);
    const author = body.match(/<author>([\s\S]*?)<\/author>/);
    entries.push({
      videoId,
      title: tagText(body, 'title') ?? videoId,
      channel: (author ? tagText(author[1], 'name') : null) ?? feedTitle,
      url,
      thumbnail: (thumbnailTag ? attribute(thumbnailTag[0], 'url') : null) ?? thumbnailUrl(videoId),
      publishedAt: tagText(body, 'published'),
      // The feed links Shorts as /shorts/<id>; best effort, YouTube does not flag them otherwise.
      isShort: url.includes('/shorts/'),
    });
  }
  const owner = head.match(/<author>([\s\S]*?)<\/author>/);
  const ownerUri = owner ? tagText(owner[1], 'uri') : null;
  const ownerId = ownerUri?.match(/\/channel\/(UC[\w-]{22})/);
  return {
    title: feedTitle,
    ownerChannelId: ownerId ? ownerId[1] : null,
    ownerName: owner ? tagText(owner[1], 'name') : null,
    entries,
  };
}

/**
 * Recognizes inputs that carry their id directly: a channel id, a playlist id,
 * a /channel/UC... URL or any URL with a list= parameter.
 * Returns null for handles (@name), /c/ and /user/ URLs, which need a lookup.
 */
export function parseSourceInput(input: string): SourceRef | null {
  const text = input.trim();
  if (/^UC[\w-]{22}$/.test(text)) {
    return { kind: 'channel', sourceId: text };
  }
  if (/^(PL|UU|OL|FL)[\w-]{14,}$/.test(text)) {
    return { kind: 'playlist', sourceId: text };
  }
  let url: URL;
  try {
    url = new URL(text.includes('://') ? text : `https://${text}`);
  } catch {
    return null;
  }
  const list = url.searchParams.get('list');
  if (list !== null && list !== '') {
    return { kind: 'playlist', sourceId: list };
  }
  const channel = url.pathname.match(/^\/channel\/(UC[\w-]{22})/);
  return channel ? { kind: 'channel', sourceId: channel[1] } : null;
}

/** Turns "@name" or "youtube.com/@name" into a full URL. */
export function normalizeSourceUrl(input: string): string {
  const text = input.trim();
  if (text.startsWith('@')) {
    return `https://www.youtube.com/${text}`;
  }
  return text.includes('://') ? text : `https://${text}`;
}

async function fetchText(url: string, headers: Record<string, string> = {}): Promise<string> {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}`);
  }
  return response.text();
}

async function channelIdFromYtdlp(url: string, ytdlpPath: string): Promise<string | null> {
  const result = await run(ytdlpPath, ['--flat-playlist', '--playlist-end', '1', '-J', url], { timeoutMs: 60_000 });
  if (result.code !== 0) {
    throw new Error(lastError(result.stderr));
  }
  const info = JSON.parse(result.stdout) as { channel_id?: string; uploader_id?: string };
  return info.channel_id ?? null;
}

async function channelIdFromPage(url: string): Promise<string | null> {
  const html = await fetchText(url, BROWSER_HEADERS);
  const patterns = [
    /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/,
    /"externalId":"(UC[\w-]{22})"/,
    /"channelId":"(UC[\w-]{22})"/,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      return match[1];
    }
  }
  return null;
}

/**
 * Resolves what the user pasted (URL, @handle, channel or playlist id) to a feed source.
 * Handles go through yt-dlp when available, then fall back to reading the channel page.
 */
export async function resolveSource(input: string, ytdlpPath: string): Promise<SourceRef> {
  const direct = parseSourceInput(input);
  if (direct !== null) {
    return direct;
  }
  const url = normalizeSourceUrl(input);
  if (!/^https?:\/\/([\w-]+\.)?youtube\.com\//.test(url)) {
    throw new Error('Paste a YouTube channel URL, an @handle, or a playlist URL');
  }
  const errors: string[] = [];
  for (const lookup of [() => channelIdFromYtdlp(url, ytdlpPath), () => channelIdFromPage(url)]) {
    try {
      const channelId = await lookup();
      if (channelId !== null) {
        return { kind: 'channel', sourceId: channelId };
      }
    } catch (error) {
      errors.push((error as Error).message);
    }
  }
  throw new Error(`Could not find the channel behind ${url}${errors.length > 0 ? ` (${errors.join('; ')})` : ''}`);
}

/** Page whose og:image is the channel avatar or the playlist cover. */
function pageUrl(ref: SourceRef): string {
  return ref.kind === 'channel'
    ? `https://www.youtube.com/channel/${ref.sourceId}`
    : `https://www.youtube.com/playlist?list=${ref.sourceId}`;
}

/** Channel avatar or playlist cover image, or null when YouTube does not expose one. */
export async function fetchAvatar(ref: SourceRef): Promise<string | null> {
  try {
    const html = await fetchText(pageUrl(ref), BROWSER_HEADERS);
    const match = html.match(/<meta property="og:image" content="([^"]+)"/);
    return match ? decodeXml(match[1]) : null;
  } catch {
    return null;
  }
}

/** Latest ~15 videos of the source, from its public RSS feed (no API key, cheap to poll). */
export async function fetchFeed(ref: SourceRef): Promise<Feed> {
  try {
    return parseFeed(await fetchText(feedUrl(ref)));
  } catch (error) {
    const message = (error as Error).message;
    if (message.startsWith('HTTP 404')) {
      throw new Error(`YouTube has no feed for this ${ref.kind} (deleted, private, or wrong id)`);
    }
    throw error;
  }
}

interface FlatEntry {
  id?: string;
  title?: string;
  url?: string;
  timestamp?: number;
  release_timestamp?: number;
  upload_date?: string;
  channel?: string;
  uploader?: string;
}

function flatEntryDate(entry: FlatEntry): string | null {
  const seconds = entry.timestamp ?? entry.release_timestamp;
  if (seconds !== undefined) {
    return new Date(seconds * 1000).toISOString();
  }
  const day = entry.upload_date?.match(/^(\d{4})(\d{2})(\d{2})$/);
  return day ? `${day[1]}-${day[2]}-${day[3]}T00:00:00.000Z` : null;
}

/** Full list of the source's videos (newest first) through yt-dlp, beyond the feed's 15. */
export async function fetchBacklog(ref: SourceRef, ytdlpPath: string, limit: number): Promise<Feed> {
  const result = await run(ytdlpPath, ['--flat-playlist', '--playlist-end', String(limit), '-J', sourceUrl(ref)], {
    timeoutMs: 10 * 60_000,
  });
  if (result.code !== 0) {
    throw new Error(lastError(result.stderr));
  }
  const info = JSON.parse(result.stdout) as { title?: string; channel?: string; uploader?: string; entries?: FlatEntry[] };
  const fallbackChannel = info.channel ?? info.uploader ?? info.title ?? '';
  const entries: FeedEntry[] = [];
  for (const entry of info.entries ?? []) {
    if (entry.id === undefined || !/^[\w-]{11}$/.test(entry.id)) {
      continue;
    }
    entries.push({
      videoId: entry.id,
      title: entry.title ?? entry.id,
      channel: entry.channel ?? entry.uploader ?? fallbackChannel,
      url: watchUrl(entry.id),
      thumbnail: thumbnailUrl(entry.id),
      publishedAt: flatEntryDate(entry),
      isShort: entry.url?.includes('/shorts/') ?? false,
    });
  }
  return { title: info.title ?? '', ownerChannelId: null, ownerName: null, entries };
}

interface FlatPlaylist {
  id?: string;
  title?: string;
  url?: string;
  thumbnails?: { url?: string }[];
}

/** Public playlists of a channel (its Playlists tab), through yt-dlp. */
export async function fetchChannelPlaylists(channelId: string, ytdlpPath: string, limit: number): Promise<ChannelPlaylist[]> {
  const result = await run(ytdlpPath, ['--flat-playlist', '--playlist-end', String(limit), '-J', `https://www.youtube.com/channel/${channelId}/playlists`], {
    timeoutMs: 2 * 60_000,
  });
  if (result.code !== 0) {
    throw new Error(lastError(result.stderr));
  }
  const info = JSON.parse(result.stdout) as { entries?: FlatPlaylist[] };
  const playlists: ChannelPlaylist[] = [];
  for (const entry of info.entries ?? []) {
    if (entry.id === undefined || entry.id === '') {
      continue;
    }
    const thumbnails = entry.thumbnails ?? [];
    playlists.push({
      id: entry.id,
      title: entry.title ?? entry.id,
      url: `https://www.youtube.com/playlist?list=${entry.id}`,
      thumbnail: thumbnails.length > 0 ? thumbnails[thumbnails.length - 1].url ?? null : null,
    });
  }
  return playlists;
}
