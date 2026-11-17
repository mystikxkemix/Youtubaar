import type { DownloadOptions, Subscription } from './types';
import type { FeedEntry } from './youtube';

/** Accepted values, mirroring MeTube's format catalog so both downloaders take the same settings. */
export const VIDEO_FORMATS = ['any', 'mp4'];
export const VIDEO_QUALITIES = ['best', '2160', '1440', '1080', '720', '480', '360'];
export const AUDIO_FORMATS = ['m4a', 'mp3', 'opus'];

export function compileTitleFilter(pattern: string): RegExp | null {
  if (pattern.trim() === '') {
    return null;
  }
  try {
    return new RegExp(pattern, 'i');
  } catch (error) {
    throw new Error(`Invalid title filter "${pattern}": ${(error as Error).message}`);
  }
}

/** Why a new entry should be skipped, or null to keep it. */
export function filterReason(subscription: Subscription, entry: FeedEntry): string | null {
  if (subscription.skipShorts && entry.isShort) {
    return 'Short';
  }
  const include = compileTitleFilter(subscription.titleInclude);
  if (include !== null && !include.test(entry.title)) {
    return 'Title does not match the include filter';
  }
  const exclude = compileTitleFilter(subscription.titleExclude);
  if (exclude !== null && exclude.test(entry.title)) {
    return 'Title matches the exclude filter';
  }
  return null;
}

export function validateDownloadOptions(options: DownloadOptions): void {
  if (options.downloadType === 'video') {
    if (!VIDEO_FORMATS.includes(options.format)) {
      throw new Error(`Video format must be one of ${VIDEO_FORMATS.join(', ')}`);
    }
    if (!VIDEO_QUALITIES.includes(options.quality)) {
      throw new Error(`Video quality must be one of ${VIDEO_QUALITIES.join(', ')}`);
    }
    return;
  }
  if (options.downloadType === 'audio') {
    if (!AUDIO_FORMATS.includes(options.format)) {
      throw new Error(`Audio format must be one of ${AUDIO_FORMATS.join(', ')}`);
    }
    if (options.quality !== 'best') {
      throw new Error('Audio quality must be "best"');
    }
    return;
  }
  throw new Error('Download type must be "video" or "audio"');
}

/**
 * A file-system-safe name: accents dropped, then anything but ASCII letters, digits,
 * "." "_" "-" becomes "_" ("Kurzgesagt – In a Nutshell" -> "Kurzgesagt_In_a_Nutshell").
 * Keeps paths free of spaces and special characters for shells, Samba and media servers.
 */
export function safeName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '');
}

/**
 * Normalizes a folder relative to the download root: each level is made safe with
 * safeName. Refuses absolute paths and ".." so a subscription cannot write outside it.
 */
export function normalizeFolder(folder: string): string {
  const parts = folder
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part !== '' && part !== '.');
  const safe: string[] = [];
  for (const part of parts) {
    if (part === '..') {
      throw new Error('Folder cannot contain ".."');
    }
    const name = safeName(part);
    if (name !== '') {
      safe.push(name);
    }
  }
  return safe.join('/');
}

/**
 * Like safeName, for one part of a file name: dots become "_" too, and long text is cut
 * at a word boundary ("Room... With" -> "Room_With").
 */
export function fileSlug(text: string, maxLength: number): string {
  let slug = safeName(text).replace(/\.+/g, '_').replace(/_+/g, '_').replace(/^[_-]+|[_-]+$/g, '');
  if (slug.length > maxLength) {
    const cut = slug.slice(0, maxLength);
    const boundary = cut.lastIndexOf('_');
    slug = (boundary > maxLength / 2 ? cut.slice(0, boundary) : cut).replace(/[_-]+$/g, '');
  }
  return slug;
}

/** Folder name derived from a channel or playlist title. */
export function folderFromName(name: string): string {
  return safeName(name) || 'YouTube';
}
