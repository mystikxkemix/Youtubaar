import type { Subscription, Video } from '../types';

export interface DownloadJob {
  video: Video;
  subscription: Subscription;
}

export interface DownloadUpdate {
  status: 'downloading' | 'done' | 'failed';
  progress?: number | null;
  note?: string | null;
  filename?: string | null;
}

export type UpdateCallback = (videoId: string, update: DownloadUpdate) => void;

/** A download client, in the Sonarr sense: Youtubaar decides what to grab, the client grabs it. */
export interface Downloader {
  readonly name: string;
  /** Max downloads in flight; Infinity for a client that keeps its own queue. */
  readonly capacity: number;
  /** Starts a download. Rejecting marks the video failed; progress and completion go through the callback. */
  start(job: DownloadJob): Promise<void>;
  /** Polls the client for the videos still downloading (no-op for clients that report by themselves). */
  sync(active: Video[]): Promise<void>;
}
