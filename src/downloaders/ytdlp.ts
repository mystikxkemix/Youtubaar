import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureShowMetadata, PLAYLIST_SEASON_FOLDER, placeEpisode, SEASON_FOLDER, type VideoMetadata } from '../jellyfin';
import { lastError, run } from '../process';
import type { Video } from '../types';
import type { DownloadJob, Downloader, UpdateCallback } from './types';

/** "2026-11-17_Cool_Down_Your_Room_NKeZ_HRk_O8.mp4": with --restrict-filenames, no spaces or special characters. */
const OUTPUT_TEMPLATE = '%(upload_date>%Y-%m-%d)s_%(title)s_%(id)s.%(ext)s';
const PROGRESS_INTERVAL_MS = 1_000;
const FILEPATH_MARKER = 'YOUTUBAAR_FILE:';
const FORMATS_MARKER = 'YOUTUBAAR_FORMATS:';
const PROGRESS_MARKER = 'YOUTUBAAR_PROGRESS:';
const META_MARKER = 'YOUTUBAAR_META:';

/**
 * The file name stem without the leftovers --restrict-filenames allows inside a title
 * ("Room..._With" -> "Room_With"): only letters, digits, "_" and "-" remain.
 */
export function tidyStem(stem: string): string {
  return stem.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
}

/** Renames the downloaded file (and its "-thumb.jpg") to the tidy stem; returns the new path. */
async function tidyDownload(filePath: string): Promise<string> {
  const directory = path.dirname(filePath);
  const extension = path.extname(filePath);
  const stem = path.basename(filePath, extension);
  const tidy = tidyStem(stem);
  if (tidy === stem || tidy === '') {
    return filePath;
  }
  const target = path.join(directory, `${tidy}${extension}`);
  await fs.rename(filePath, target);
  await fs.rename(path.join(directory, `${stem}-thumb.jpg`), path.join(directory, `${tidy}-thumb.jpg`)).catch(() => undefined);
  return target;
}

/** Whether this job is saved in the Jellyfin show layout. */
export function usesJellyfin(job: DownloadJob): boolean {
  return job.subscription.jellyfin === true && job.subscription.downloadType === 'video';
}

export function buildYtdlpArgs(job: DownloadJob, downloadDir: string, extraArgs: string[]): string[] {
  const { subscription } = job;
  const args = [
    '--no-playlist',
    // Titles in file names keep only ASCII letters, digits, "_", "-" and ".".
    '--restrict-filenames',
    '--newline',
    '--embed-metadata',
    '--no-simulate',
    // Final file path, reported once the file is in place.
    '--print', `after_move:${FILEPATH_MARKER}%(filepath)s`,
    // The streams about to be downloaded (video + audio) and their sizes when YouTube
    // gives them, so progress covers the whole download instead of restarting per stream.
    // Each stream is printed as an object: plain lists would drop unknown sizes and
    // shift the others onto the wrong stream.
    '--print', `before_dl:${FORMATS_MARKER}%(format_id)s|%(filesize)s|%(filesize_approx)s|%(requested_formats.:.{format_id,filesize,filesize_approx})j`,
    // --print implies --quiet; --progress keeps progress lines, in a parseable template.
    '--progress',
    '--progress-template', `download:${PROGRESS_MARKER}%(info.format_id)s:%(progress.downloaded_bytes)s:%(progress.total_bytes)s:%(progress.total_bytes_estimate)s`,
    // Recent yt-dlp needs a JavaScript runtime to solve YouTube's challenges; only Deno is
    // enabled by default, so point it at the Node running Youtubaar.
    '--js-runtimes', `node:${process.execPath}`,
  ];

  if (subscription.downloadType === 'audio') {
    args.push('-f', 'ba/b', '-x', '--audio-format', subscription.format, '--audio-quality', '0', '--embed-thumbnail');
  } else {
    args.push('-f', 'bv*+ba/b');
    // -S res:N prefers the largest resolution up to N without failing when N is unavailable.
    if (subscription.quality !== 'best') {
      args.push('-S', `res:${subscription.quality}`);
    }
    if (subscription.format === 'mp4') {
      args.push('--merge-output-format', 'mp4');
    }
  }
  if (usesJellyfin(job)) {
    // Downloaded into its season under a temporary name with a "-thumb.jpg", plus the
    // metadata the .nfo is written from; placeEpisode then gives it its Kodi name.
    // Channels: one season per upload year. Playlists: one season, in playlist order.
    const ordered = subscription.kind === 'playlist' && Boolean(job.episode);
    const seasonDir = path.join(downloadDir, subscription.folder, ordered ? PLAYLIST_SEASON_FOLDER : SEASON_FOLDER);
    args.push(
      '-o', path.join(seasonDir, OUTPUT_TEMPLATE),
      '--write-thumbnail', '--convert-thumbnails', 'jpg',
      '-o', `thumbnail:${path.join(seasonDir, OUTPUT_TEMPLATE.replace('.%(ext)s', '-thumb.%(ext)s'))}`,
      '--print', `after_move:${META_MARKER}%(.{id,title,description,upload_date,timestamp,duration,channel,uploader,webpage_url,tags})j`,
    );
  } else {
    args.push('-o', path.join(downloadDir, subscription.folder, OUTPUT_TEMPLATE));
  }
  args.push(...extraArgs, job.video.url);
  return args;
}

function toBytes(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return value !== null && value !== undefined && value !== 'NA' && Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseList(json: string): unknown[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Turns yt-dlp's per-stream progress into one percentage for the whole download.
 * A video is usually two streams (video, then audio), each going from 0 to 100%;
 * reporting them raw makes the bar fill, drop back and fill again.
 * Fragmented streams (HLS) have no size upfront, only a live estimate, so each
 * stream's size is the best figure known so far.
 */
export class ProgressTracker {
  private streams: string[] = [];
  private readonly announced = new Map<string, number>();
  private readonly exact = new Map<string, number>();
  private readonly estimated = new Map<string, number>();
  private readonly downloaded = new Map<string, number>();
  private percent = 0;

  /** Feeds one output line; returns the new percentage when the line was progress. */
  line(line: string): number | null {
    if (line.startsWith(FORMATS_MARKER)) {
      this.readFormats(line.slice(FORMATS_MARKER.length));
      return null;
    }
    if (!line.startsWith(PROGRESS_MARKER)) {
      return null;
    }
    const [formatId, downloaded, total, estimate] = line.slice(PROGRESS_MARKER.length).split(':');
    if (!this.streams.includes(formatId)) {
      this.streams.push(formatId);
    }
    this.downloaded.set(formatId, Math.max(toBytes(downloaded) ?? 0, this.downloaded.get(formatId) ?? 0));
    const exact = toBytes(total);
    if (exact !== null) {
      this.exact.set(formatId, exact);
    }
    const estimated = toBytes(estimate);
    if (estimated !== null) {
      this.estimated.set(formatId, estimated);
    }
    // 100% is only reported once the file is merged and moved; never go backwards.
    this.percent = Math.max(this.percent, Math.min(99, Math.floor(this.fraction() * 100)));
    return this.percent;
  }

  private readFormats(payload: string): void {
    const [formatId, filesize, approx, streams] = payload.split('|');
    const requested = parseList(streams ?? '[]') as { format_id?: unknown; filesize?: unknown; filesize_approx?: unknown }[];
    if (requested.length === 0) {
      this.streams = [formatId];
      const size = toBytes(filesize) ?? toBytes(approx);
      if (size !== null) {
        this.announced.set(formatId, size);
      }
      return;
    }
    this.streams = [];
    for (const stream of requested) {
      const id = String(stream.format_id);
      this.streams.push(id);
      const size = toBytes(stream.filesize) ?? toBytes(stream.filesize_approx);
      if (size !== null) {
        this.announced.set(id, size);
      }
    }
  }

  private sizeOf(formatId: string): number | null {
    return this.exact.get(formatId) ?? this.announced.get(formatId) ?? this.estimated.get(formatId) ?? null;
  }

  private fraction(): number {
    const sizes = this.streams.map((id) => this.sizeOf(id));
    if (sizes.every((size) => size !== null)) {
      let done = 0;
      let total = 0;
      this.streams.forEach((id, index) => {
        total += sizes[index] as number;
        done += Math.min(this.downloaded.get(id) ?? 0, sizes[index] as number);
      });
      return total > 0 ? done / total : 0;
    }
    // A stream's size is still unknown: give each stream an equal share.
    let sum = 0;
    this.streams.forEach((id, index) => {
      const size = sizes[index];
      sum += size === null ? 0 : Math.min(1, (this.downloaded.get(id) ?? 0) / size);
    });
    return sum / this.streams.length;
  }
}

/** Runs yt-dlp locally; used when there is no MeTube, or to bypass it. */
export class YtdlpDownloader implements Downloader {
  readonly name = 'yt-dlp';

  constructor(
    private readonly ytdlpPath: () => string,
    private readonly downloadDir: string,
    readonly capacity: number,
    private readonly extraArgs: string[],
    private readonly onUpdate: UpdateCallback,
  ) {}

  async start(job: DownloadJob): Promise<void> {
    const videoId = job.video.id;
    const tracker = new ProgressTracker();
    let filename: string | null = null;
    let metadata: VideoMetadata | null = null;
    let lastReport = 0;
    let lastPercent = -1;
    this.onUpdate(videoId, { status: 'downloading', progress: 0 });

    const result = await run(this.ytdlpPath(), buildYtdlpArgs(job, this.downloadDir, this.extraArgs), {
      onLine: (line) => {
        if (line.startsWith(FILEPATH_MARKER)) {
          filename = line.slice(FILEPATH_MARKER.length);
          return;
        }
        if (line.startsWith(META_MARKER)) {
          try {
            metadata = JSON.parse(line.slice(META_MARKER.length)) as VideoMetadata;
          } catch {
            // Without metadata the video is still downloaded, only without its .nfo.
          }
          return;
        }
        const percent = tracker.line(line);
        const now = Date.now();
        if (percent !== null && percent !== lastPercent && now - lastReport >= PROGRESS_INTERVAL_MS) {
          lastReport = now;
          lastPercent = percent;
          this.onUpdate(videoId, { status: 'downloading', progress: percent });
        }
      },
    });
    if (result.code !== 0) {
      throw new Error(lastError(result.stderr));
    }
    let note: string | null = null;
    if (usesJellyfin(job)) {
      ({ filename, note } = await this.placeForJellyfin(job, filename, metadata));
    } else if (filename !== null) {
      try {
        filename = await tidyDownload(filename);
      } catch {
        // Keep yt-dlp's name if the rename fails; the download itself is fine.
      }
    }
    this.onUpdate(videoId, {
      status: 'done',
      progress: 100,
      filename: filename === null ? null : path.relative(this.downloadDir, filename),
      note,
    });
  }

  /** Kodi name, season folder and metadata; a failure is reported on the video but keeps the download. */
  private async placeForJellyfin(job: DownloadJob, filename: string | null, metadata: VideoMetadata | null): Promise<{ filename: string | null; note: string | null }> {
    if (filename === null || metadata === null) {
      return { filename, note: 'Downloaded, but yt-dlp gave no metadata for the Jellyfin .nfo' };
    }
    try {
      const showDir = path.join(this.downloadDir, job.subscription.folder);
      await ensureShowMetadata(showDir, job.subscription);
      return { filename: await placeEpisode(filename, showDir, metadata, job.subscription, job.episode), note: null };
    } catch (error) {
      return { filename, note: `Downloaded, but it could not be named and tagged for Jellyfin: ${(error as Error).message}` };
    }
  }

  async sync(_active: Video[]): Promise<void> {
    // yt-dlp runs in-process, so progress is reported as it happens.
  }
}
