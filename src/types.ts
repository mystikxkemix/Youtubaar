/** Whether new videos of a subscription are downloaded right away or wait in the inbox. */
export type Mode = 'auto' | 'manual';

export type SourceKind = 'channel' | 'playlist';

export type DownloadType = 'video' | 'audio';

/**
 * Lifecycle of a video:
 * available (in the inbox) -> queued -> downloading -> done | failed.
 * ignored is a side state the user (or a filter) can put a video in, and take it back out of.
 */
export type VideoStatus = 'available' | 'ignored' | 'queued' | 'downloading' | 'done' | 'failed';

export const VIDEO_STATUSES: readonly VideoStatus[] = ['available', 'ignored', 'queued', 'downloading', 'done', 'failed'];

/** What to do with the videos already in a source when it is first added. */
export type InitialAction = 'available' | 'ignore' | 'download';

export interface DownloadOptions {
  downloadType: DownloadType;
  /** video: any | mp4. audio: m4a | mp3 | opus. */
  format: string;
  /** video: best | 2160 | 1440 | 1080 | 720 | 480 | 360. audio: best. */
  quality: string;
}

export interface Subscription extends DownloadOptions {
  id: string;
  kind: SourceKind;
  /** UC... channel id or playlist id. */
  sourceId: string;
  name: string;
  url: string;
  /** Channel avatar or playlist cover; undefined until first looked up, null when none was found. */
  avatar?: string | null;
  /** For playlists: the channel that owns it, read from the feed. */
  ownerChannelId?: string | null;
  ownerName?: string | null;
  /** Folder relative to the download root. */
  folder: string;
  mode: Mode;
  /** Case-insensitive regexes on the title; empty means no filter. */
  titleInclude: string;
  titleExclude: string;
  skipShorts: boolean;
  /** Save as a Jellyfin show: season folders, .nfo files and thumbnails (yt-dlp downloader). */
  jellyfin?: boolean;
  /** Playlists: set once yt-dlp listed the whole playlist (the feed only shows the first 15). */
  fullyListed?: boolean;
  enabled: boolean;
  createdAt: string;
  lastCheckedAt: string | null;
  lastError: string | null;
}

export interface Video {
  /** YouTube video id; a video seen by two subscriptions is tracked once, under the first. */
  id: string;
  subscriptionId: string;
  title: string;
  channel: string;
  url: string;
  thumbnail: string;
  publishedAt: string | null;
  isShort: boolean;
  status: VideoStatus;
  /** Why a video was ignored by a filter, or why a download failed. */
  note: string | null;
  progress: number | null;
  filename: string | null;
  /** When the download was handed to the downloader (used to match MeTube history). */
  sentAt: string | null;
  /** Position in its playlist subscription (1 = first), for playlist-ordered episodes. */
  position?: number | null;
  foundAt: string;
  updatedAt: string;
}
