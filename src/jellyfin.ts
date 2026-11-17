import fs from 'node:fs/promises';
import path from 'node:path';
import { fileSlug } from './rules';
import type { Subscription } from './types';

/**
 * Jellyfin "Shows" layout: each subscription is a show, each upload year a season,
 * each video an episode with a Kodi-style .nfo next to it.
 *
 *   <folder>/tvshow.nfo, poster.jpg
 *   <folder>/Season_2026/Show_S2026E111701_Title.mp4
 *                        Show_S2026E111701_Title.nfo
 *                        Show_S2026E111701_Title-thumb.jpg
 *
 * Files follow Kodi's episode naming (Show_SxxEyy_Title), and the .nfo files give
 * Jellyfin and Kodi titles, descriptions and air dates without querying TV databases.
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

export const SEASON_FOLDER = 'Season_%(upload_date>%Y)s';
/** Playlists are a single season in playlist order. */
export const PLAYLIST_SEASON_FOLDER = 'Season_01';

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

/** Season and episode of an .nfo already in a season folder. */
interface ExistingEpisode {
  videoId: string | null;
  aired: string | null;
  episode: number;
}

async function readSeasonEpisodes(seasonDir: string): Promise<ExistingEpisode[]> {
  const episodes: ExistingEpisode[] = [];
  let names: string[] = [];
  try {
    names = await fs.readdir(seasonDir);
  } catch {
    return episodes;
  }
  for (const name of names) {
    if (!name.endsWith('.nfo')) {
      continue;
    }
    try {
      const xml = await fs.readFile(path.join(seasonDir, name), 'utf8');
      const episode = xml.match(/<episode>(\d+)<\/episode>/);
      if (episode) {
        episodes.push({
          videoId: xml.match(/<uniqueid type="youtube"[^>]*>([^<]+)<\/uniqueid>/)?.[1] ?? null,
          aired: xml.match(/<aired>([^<]+)<\/aired>/)?.[1] ?? null,
          episode: Number(episode[1]),
        });
      }
    } catch {
      // Unreadable .nfo: ignore it.
    }
  }
  return episodes;
}

export interface EpisodePlan {
  season: number;
  episode: number;
  /** Season folder name, e.g. "Season_2026" or "Season_01". */
  seasonFolder: string;
}

/**
 * Season and episode for a video. Playlists: season 1, episode = place in the playlist.
 * Channels: season = upload year, episode = MMDD + index of the day; a video already
 * numbered in that season keeps its number (retries, re-organizing).
 */
export async function planEpisode(showDir: string, meta: VideoMetadata, subscription: Subscription, position?: number | null): Promise<EpisodePlan> {
  if (subscription.kind === 'playlist' && position) {
    return { season: 1, episode: position, seasonFolder: PLAYLIST_SEASON_FOLDER };
  }
  const aired = airDate(meta) ?? new Date().toISOString().slice(0, 10);
  const season = Number(aired.slice(0, 4));
  const seasonFolder = `Season_${season}`;
  const existing = await readSeasonEpisodes(path.join(showDir, seasonFolder));
  const same = existing.find((entry) => entry.videoId === meta.id);
  if (same !== undefined) {
    return { season, episode: same.episode, seasonFolder };
  }
  let lastIndex = 0;
  for (const entry of existing) {
    if (entry.aired === aired) {
      lastIndex = Math.max(lastIndex, entry.episode % 100);
    }
  }
  return { season, episode: episodeNumber(aired, lastIndex + 1), seasonFolder };
}

/**
 * Kodi-style episode name without spaces or special characters:
 * "mistermv_S2026E112401_Le_mystere_de_la_partie_de_bridge" or "Zelda_OoT_S01E02_Bides_et_musiques".
 */
export function kodiBaseName(showName: string, season: number, episode: number, title: string): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return [fileSlug(showName, 60), `S${pad(season)}E${pad(episode)}`, fileSlug(title, 100)].filter((part) => part !== '').join('_');
}

/**
 * Puts a downloaded video in its Kodi place: season folder, Kodi name for the video,
 * its "-thumb.jpg" and its .nfo. Returns the video's new path.
 * thumbnail: the image to use when none sits next to the file yet (e.g. older downloads).
 */
export async function placeEpisode(
  mediaPath: string,
  showDir: string,
  meta: VideoMetadata,
  subscription: Subscription,
  position?: number | null,
  thumbnailUrl?: string | null,
): Promise<string> {
  const plan = await planEpisode(showDir, meta, subscription, position);
  const seasonDir = path.join(showDir, plan.seasonFolder);
  await fs.mkdir(seasonDir, { recursive: true });

  const extension = path.extname(mediaPath);
  const oldStem = path.join(path.dirname(mediaPath), path.basename(mediaPath, extension));
  const base = path.join(seasonDir, kodiBaseName(subscription.name, plan.season, plan.episode, meta.title ?? meta.id));
  const target = `${base}${extension}`;
  if (target !== mediaPath) {
    await fs.rename(mediaPath, target);
  }

  const thumbTarget = `${base}-thumb.jpg`;
  if (`${oldStem}-thumb.jpg` !== thumbTarget && (await exists(`${oldStem}-thumb.jpg`))) {
    await fs.rename(`${oldStem}-thumb.jpg`, thumbTarget);
  } else if (thumbnailUrl && !(await exists(thumbTarget))) {
    try {
      const response = await fetch(thumbnailUrl, { signal: AbortSignal.timeout(20_000) });
      if (response.ok) {
        await fs.writeFile(thumbTarget, Buffer.from(await response.arrayBuffer()));
      }
    } catch {
      // No episode image: Jellyfin extracts a frame instead.
    }
  }
  if (`${oldStem}.nfo` !== `${base}.nfo` && (await exists(`${oldStem}.nfo`))) {
    await fs.rm(`${oldStem}.nfo`);
  }
  await fs.writeFile(`${base}.nfo`, episodeNfo(meta, subscription.name, plan.season, plan.episode));
  return target;
}
