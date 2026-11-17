import fs from 'node:fs/promises';
import path from 'node:path';
import type { Subscription } from './types';

/**
 * Jellyfin "Shows" layout: each subscription is a show, each upload year a season,
 * each video an episode with a Kodi-style .nfo next to it.
 *
 *   <folder>/tvshow.nfo, poster.jpg
 *   <folder>/Season 2026/2026-11-17 - Title [id].mp4
 *                        2026-11-17 - Title [id].nfo
 *                        2026-11-17 - Title [id]-thumb.jpg
 *
 * Jellyfin reads the date-prefixed names as daily episodes, and the .nfo files give it
 * titles, descriptions and air dates without querying TV databases.
 */

/** Fields yt-dlp prints after a download (see buildYtdlpArgs). */
export interface VideoMetadata {
  id: string;
  title?: string;
  description?: string | null;
  upload_date?: string | null;
  timestamp?: number | null;
  duration?: number | null;
  channel?: string | null;
  uploader?: string | null;
  webpage_url?: string | null;
  tags?: string[] | null;
}

export const SEASON_FOLDER = 'Season %(upload_date>%Y)s';

export function escapeXml(text: string): string {
  return text
    // Characters XML 1.0 cannot carry at all.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function element(name: string, value: string | number | null | undefined, attributes = ''): string {
  if (value === null || value === undefined || value === '') {
    return '';
  }
  return `  <${name}${attributes}>${escapeXml(String(value))}</${name}>\n`;
}

/** YYYY-MM-DD from yt-dlp's upload_date (YYYYMMDD), or null. */
export function airDate(meta: VideoMetadata): string | null {
  const match = meta.upload_date?.match(/^(\d{4})(\d{2})(\d{2})$/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

/**
 * Episode number inside the year season: MMDD followed by a two-digit index, so
 * 17 Nov is 111701, a second video that day 111702. Keeps episodes in upload order.
 */
export function episodeNumber(aired: string, indexInDay: number): number {
  const [, month, day] = aired.split('-');
  return Number(`${month}${day}`) * 100 + indexInDay;
}

export function episodeNfo(meta: VideoMetadata, showTitle: string, season: number, episode: number): string {
  const aired = airDate(meta);
  const runtime = meta.duration ? Math.max(1, Math.round(meta.duration / 60)) : null;
  let body = '';
  body += element('title', meta.title ?? meta.id);
  body += element('showtitle', showTitle);
  body += element('season', season);
  body += element('episode', episode);
  body += element('aired', aired);
  body += element('premiered', aired);
  body += element('year', aired?.slice(0, 4));
  body += element('plot', meta.description);
  body += element('runtime', runtime);
  body += element('studio', meta.channel ?? meta.uploader);
  body += element('uniqueid', meta.id, ' type="youtube" default="true"');
  for (const tag of (meta.tags ?? []).slice(0, 20)) {
    body += element('tag', tag);
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<episodedetails>\n${body}</episodedetails>\n`;
}

export function showNfo(subscription: Subscription): string {
  let body = '';
  body += element('title', subscription.name);
  body += element('studio', subscription.ownerName ?? subscription.name);
  body += element('genre', 'YouTube');
  body += element('plot', subscription.kind === 'playlist'
    ? `YouTube playlist${subscription.ownerName ? ` by ${subscription.ownerName}` : ''}.`
    : 'YouTube channel.');
  body += element('uniqueid', subscription.sourceId, ` type="youtube" default="true"`);
  // Stops Jellyfin from trying to match the show against TV databases.
  body += '  <lockdata>true</lockdata>\n';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<tvshow>\n${body}</tvshow>\n`;
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

/** Writes tvshow.nfo and poster.jpg once per show folder; failures only cost artwork. */
export async function ensureShowMetadata(showDir: string, subscription: Subscription): Promise<void> {
  await fs.mkdir(showDir, { recursive: true });
  const nfo = path.join(showDir, 'tvshow.nfo');
  if (!(await exists(nfo))) {
    await fs.writeFile(nfo, showNfo(subscription));
  }
  const poster = path.join(showDir, 'poster.jpg');
  if (subscription.avatar && !(await exists(poster))) {
    try {
      const response = await fetch(subscription.avatar, { signal: AbortSignal.timeout(20_000) });
      if (response.ok) {
        await fs.writeFile(poster, Buffer.from(await response.arrayBuffer()));
      }
    } catch {
      // No poster: Jellyfin falls back to an episode thumbnail.
    }
  }
}

/**
 * Writes the episode .nfo next to the downloaded file. The index within the day comes
 * from the .nfo files already in the season folder, so re-downloads keep their number.
 */
export async function writeEpisodeMetadata(mediaPath: string, meta: VideoMetadata, subscription: Subscription): Promise<string> {
  const directory = path.dirname(mediaPath);
  const base = path.basename(mediaPath, path.extname(mediaPath));
  const aired = airDate(meta) ?? new Date().toISOString().slice(0, 10);
  const season = Number(aired.slice(0, 4));

  const sameDay: string[] = [];
  for (const name of await fs.readdir(directory)) {
    if (name.endsWith('.nfo') && name.startsWith(aired) && name !== `${base}.nfo`) {
      sameDay.push(name);
    }
  }
  const nfoPath = path.join(directory, `${base}.nfo`);
  let index = sameDay.length + 1;
  // Keep the number of an episode written before (e.g. after a retry).
  try {
    const previous = (await fs.readFile(nfoPath, 'utf8')).match(/<episode>(\d+)<\/episode>/);
    if (previous) {
      index = Number(previous[1]) % 100;
    }
  } catch {
    // First time for this episode.
  }
  await fs.writeFile(nfoPath, episodeNfo(meta, subscription.name, season, episodeNumber(aired, index)));
  return nfoPath;
}
