import type { Video } from '../types';
import { videoIdFromUrl } from '../youtube';
import type { DownloadJob, Downloader, UpdateCallback } from './types';

const REQUEST_TIMEOUT_MS = 30_000;

/** One entry of MeTube's GET /history lists (only the fields Youtubaar reads). */
export interface MeTubeItem {
  id?: string;
  url?: string;
  status?: string;
  msg?: string | null;
  error?: string | null;
  percent?: number | null;
  filename?: string | null;
  /** Nanoseconds since epoch. */
  timestamp?: number;
}

export interface MeTubeHistory {
  queue?: MeTubeItem[];
  pending?: MeTubeItem[];
  done?: MeTubeItem[];
}

/**
 * Body of POST /add. download_type is the current MeTube schema; quality and format
 * are also what older MeTube versions read, so the same body works on both.
 * auto_start is forced on: picking already happened in Youtubaar.
 */
export function buildAddRequest(job: DownloadJob): Record<string, unknown> {
  const { video, subscription } = job;
  return {
    url: video.url,
    download_type: subscription.downloadType,
    quality: subscription.quality,
    format: subscription.format,
    folder: subscription.folder,
    auto_start: true,
  };
}

function itemVideoId(item: MeTubeItem): string | null {
  if (item.url !== undefined) {
    const fromUrl = videoIdFromUrl(item.url);
    if (fromUrl !== null) {
      return fromUrl;
    }
  }
  return item.id !== undefined && /^[\w-]{11}$/.test(item.id) ? item.id : null;
}

/** Indexes MeTube items by video id. Later lists win, so pass the queue before done. */
export function indexHistory(history: MeTubeHistory): { active: Map<string, MeTubeItem>; done: Map<string, MeTubeItem> } {
  const active = new Map<string, MeTubeItem>();
  const done = new Map<string, MeTubeItem>();
  for (const item of [...(history.pending ?? []), ...(history.queue ?? [])]) {
    const id = itemVideoId(item);
    if (id !== null) {
      active.set(id, item);
    }
  }
  for (const item of history.done ?? []) {
    const id = itemVideoId(item);
    // Keep the most recent attempt when the same video was downloaded more than once.
    const previous = id === null ? undefined : done.get(id);
    if (id !== null && (previous === undefined || (item.timestamp ?? 0) >= (previous.timestamp ?? 0))) {
      done.set(id, item);
    }
  }
  return { active, done };
}

export class MeTubeDownloader implements Downloader {
  readonly name = 'MeTube';
  readonly capacity = Number.POSITIVE_INFINITY;
  private readonly baseUrl: string;

  constructor(baseUrl: string, private readonly onUpdate: UpdateCallback) {
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  }

  async start(job: DownloadJob): Promise<void> {
    const response = await fetch(new URL('add', this.baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildAddRequest(job)),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`MeTube refused the download: HTTP ${response.status} ${text || response.statusText}`.trim());
    }
    let body: { status?: string; msg?: string } | null = null;
    try {
      body = JSON.parse(text) as { status?: string; msg?: string };
    } catch {
      // Older versions may answer with plain text; a 2xx is enough.
    }
    if (body?.status === 'error') {
      throw new Error(`MeTube: ${body.msg ?? 'unknown error'}`);
    }
    this.onUpdate(job.video.id, { status: 'downloading', progress: 0 });
  }

  async sync(active: Video[]): Promise<void> {
    if (active.length === 0) {
      return;
    }
    const response = await fetch(new URL('history', this.baseUrl), { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!response.ok) {
      throw new Error(`MeTube history: HTTP ${response.status}`);
    }
    const { active: running, done } = indexHistory((await response.json()) as MeTubeHistory);

    for (const video of active) {
      const finished = done.get(video.id);
      const sentAtNs = video.sentAt === null ? 0 : Date.parse(video.sentAt) * 1e6;
      // Ignore a result left over from an earlier attempt at the same video.
      const isCurrent = finished !== undefined && (finished.timestamp === undefined || finished.timestamp >= sentAtNs - 60e9);
      if (finished !== undefined && isCurrent && !running.has(video.id)) {
        if (finished.status === 'finished') {
          this.onUpdate(video.id, { status: 'done', progress: 100, filename: finished.filename ?? null, note: null });
        } else {
          this.onUpdate(video.id, { status: 'failed', note: finished.msg ?? finished.error ?? `MeTube status: ${finished.status ?? 'unknown'}` });
        }
        continue;
      }
      const item = running.get(video.id);
      if (item !== undefined && typeof item.percent === 'number') {
        this.onUpdate(video.id, { status: 'downloading', progress: Math.round(item.percent) });
      }
    }
  }
}
