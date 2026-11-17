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
 * Normalizes a folder relative to the download root.
 * Refuses absolute paths and ".." so a subscription cannot write outside it.
 */
export function normalizeFolder(folder: string): string {
  const parts = folder
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part !== '' && part !== '.');
  for (const part of parts) {
    if (part === '..') {
      throw new Error('Folder cannot contain ".."');
    }
  }
  return parts.join('/');
}

/** Folder name derived from a channel or playlist title. */
export function folderFromName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'YouTube';
}
