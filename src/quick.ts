import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { filepathFrom, ProgressTracker, trackingArgs } from './downloaders/ytdlp';
import { lastError, run } from './process';
import { fileTitle } from './rules';

/**
 * Quick downloads: one video (or its audio) fetched on request, outside any subscription,
 * and kept for a limited time so it can be saved from the web page. Files live in a
 * hidden folder of the download root (".quick", marked with a ".ignore" file so Jellyfin
 * skips it); the list lives in quick.json in the data folder.
 */

export type QuickKind = 'video' | 'audio';
export type QuickStatus = 'downloading' | 'ready' | 'failed';

export const QUICK_QUALITIES = ['2160', '1440', '1080', '720', '480'] as const;
export type QuickQuality = (typeof QUICK_QUALITIES)[number];

export interface QuickDownload {
  id: string;
  url: string;
  kind: QuickKind;
  quality: QuickQuality;
  title: string | null;
  thumbnail: string | null;
  channel: string | null;
  duration: number | null;
  status: QuickStatus;
  progress: number | null;
  error: string | null;
  /** File name inside the item's folder, once the download is complete. */
  file: string | null;
  size: number | null;
  createdAt: string;
  /** When the file and the entry are deleted. */
  expiresAt: string;
}

export interface QuickInput {
  url?: unknown;
  kind?: unknown;
  quality?: unknown;
}

const QUICK_FOLDER = '.quick';
const INFO_MARKER = 'YOUTUBAAR_QUICK_INFO:';
const PROGRESS_INTERVAL_MS = 1_000;
const SAVE_DELAY_MS = 300;

/** yt-dlp arguments for a quick download into `directory`. */
export function buildQuickArgs(item: Pick<QuickDownload, 'url' | 'kind' | 'quality'>, directory: string, extraArgs: string[]): string[] {
  const args = [
    '--no-playlist',
    '--newline',
    '--no-simulate',
    '--embed-metadata',
    ...trackingArgs(),
    '--print', `before_dl:${INFO_MARKER}%(.{title,thumbnail,channel,duration})j`,
    '-o', path.join(directory, '%(id)s.%(ext)s'),
  ];
  if (item.kind === 'audio') {
    args.push('-f', 'ba/b', '-x', '--audio-format', 'm4a', '--audio-quality', '0');
  } else {
    // H.264 + AAC in MP4 plays on every phone and computer; YouTube has it up to 1080p,
    // above that the resolution wins and the codec is whatever YouTube offers.
    args.push('-f', 'bv*+ba/b', '-S', `res:${item.quality},vcodec:h264,acodec:aac`, '--merge-output-format', 'mp4');
  }
  args.push(...extraArgs, item.url);
  return args;
}

/** Validates a quick download request; throws with a message for the user. */
export function parseQuickInput(input: QuickInput): Pick<QuickDownload, 'url' | 'kind' | 'quality'> {
  const raw = typeof input.url === 'string' ? input.url.trim() : '';
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Paste the link of a video (https://...)');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Paste the link of a video (https://...)');
  }
  const kind = input.kind === undefined ? 'video' : input.kind;
  if (kind !== 'video' && kind !== 'audio') {
    throw new Error('"kind" must be "video" or "audio"');
  }
  const quality = input.quality === undefined ? '1080' : String(input.quality);
  if (!(QUICK_QUALITIES as readonly string[]).includes(quality)) {
    throw new Error(`"quality" must be one of ${QUICK_QUALITIES.join(', ')}`);
  }
  return { url: url.toString(), kind, quality: quality as QuickQuality };
}

export class QuickDownloads {
  private readonly items = new Map<string, QuickDownload>();
  private readonly running = new Map<string, AbortController>();
  private readonly listFile: string;
  readonly root: string;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(
    dataDir: string,
    downloadDir: string,
    private readonly ytdlpPath: () => string,
    private readonly extraArgs: string[],
    private readonly keepHours: number,
    private readonly log: (message: string) => void,
  ) {
    this.listFile = path.join(dataDir, 'quick.json');
    this.root = path.join(downloadDir, QUICK_FOLDER);
    try {
      for (const item of JSON.parse(fs.readFileSync(this.listFile, 'utf8')) as QuickDownload[]) {
        this.items.set(item.id, item);
      }
    } catch {
      // No list yet, or unreadable: start empty.
    }
  }

  /** Downloads that are running now (yt-dlp updates wait for them). */
  get active(): number {
    return this.running.size;
  }

  /** Newest first. */
  list(): QuickDownload[] {
    return [...this.items.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id: string): QuickDownload | undefined {
    return this.items.get(id);
  }

  /** Absolute path of a ready item's file, or null. */
  filePath(item: QuickDownload): string | null {
    return item.status === 'ready' && item.file !== null ? path.join(this.root, item.id, item.file) : null;
  }

  add(input: QuickInput): QuickDownload {
    const request = parseQuickInput(input);
    const now = new Date();
    const item: QuickDownload = {
      id: randomUUID(),
      ...request,
      title: null,
      thumbnail: null,
      channel: null,
      duration: null,
      status: 'downloading',
      progress: 0,
      error: null,
      file: null,
      size: null,
      createdAt: now.toISOString(),
      expiresAt: this.expiry(now),
    };
    this.items.set(item.id, item);
    this.save();
    void this.download(item);
    return item;
  }

  /** Stops the download if it runs, then deletes the file and the entry. */
  async remove(id: string): Promise<boolean> {
    const item = this.items.get(id);
    if (item === undefined) {
      return false;
    }
    this.items.delete(id);
    this.running.get(id)?.abort();
    this.save();
    await fs.promises.rm(path.join(this.root, id), { recursive: true, force: true });
    return true;
  }

  /** Restarts downloads cut by a restart, then deletes expired items and stray folders. */
  async start(): Promise<void> {
    await this.prepareRoot();
    for (const item of this.items.values()) {
      if (item.status === 'downloading') {
        void this.download(item);
      }
    }
    await this.cleanup();
  }

  async cleanup(now = new Date()): Promise<void> {
    for (const item of [...this.items.values()]) {
      if (item.expiresAt <= now.toISOString() && !this.running.has(item.id)) {
        this.log(`quick download expired: ${item.title ?? item.url}`);
        await this.remove(item.id);
      }
    }
    let folders: string[] = [];
    try {
      folders = await fs.promises.readdir(this.root);
    } catch {
      return;
    }
    for (const folder of folders) {
      if (folder !== '.ignore' && !this.items.has(folder)) {
        await fs.promises.rm(path.join(this.root, folder), { recursive: true, force: true });
      }
    }
  }

  flush(): void {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    const tmp = `${this.listFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.list()));
    fs.renameSync(tmp, this.listFile);
  }

  private expiry(from: Date): string {
    return new Date(from.getTime() + this.keepHours * 3_600_000).toISOString();
  }

  private save(): void {
    if (this.saveTimer === null) {
      this.saveTimer = setTimeout(() => {
        try {
          this.flush();
        } catch (error) {
          this.log(`quick downloads could not be saved: ${(error as Error).message}`);
        }
      }, SAVE_DELAY_MS);
    }
  }

  private async prepareRoot(): Promise<void> {
    await fs.promises.mkdir(this.root, { recursive: true });
    const ignore = path.join(this.root, '.ignore');
    if (!fs.existsSync(ignore)) {
      await fs.promises.writeFile(ignore, '');
    }
  }

  private async download(item: QuickDownload): Promise<void> {
    const directory = path.join(this.root, item.id);
    const controller = new AbortController();
    this.running.set(item.id, controller);
    item.status = 'downloading';
    item.progress = 0;
    item.error = null;
    this.save();
    const tracker = new ProgressTracker();
    let filename: string | null = null;
    let lastReport = 0;
    try {
      await this.prepareRoot();
      await fs.promises.mkdir(directory, { recursive: true });
      const result = await run(this.ytdlpPath(), buildQuickArgs(item, directory, this.extraArgs), {
        signal: controller.signal,
        onLine: (line) => {
          const file = filepathFrom(line);
          if (file !== null) {
            filename = file;
            return;
          }
          if (line.startsWith(INFO_MARKER)) {
            this.readInfo(item, line.slice(INFO_MARKER.length));
            return;
          }
          const percent = tracker.line(line);
          if (percent !== null && Date.now() - lastReport >= PROGRESS_INTERVAL_MS) {
            lastReport = Date.now();
            item.progress = percent;
          }
        },
      });
      if (controller.signal.aborted) {
        return;
      }
      if (result.code !== 0 || filename === null) {
        throw new Error(result.code !== 0 ? lastError(result.stderr) : 'yt-dlp did not report the downloaded file');
      }
      const finalPath = await this.nameFile(item, filename);
      item.file = path.basename(finalPath);
      item.size = (await fs.promises.stat(finalPath)).size;
      item.status = 'ready';
      item.progress = 100;
      // The full time to save it counts from when it is ready.
      item.expiresAt = this.expiry(new Date());
      this.log(`quick download ready: ${item.title ?? item.url}`);
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      item.status = 'failed';
      item.progress = null;
      item.error = (error as Error).message;
      this.log(`quick download failed: ${item.url}: ${item.error}`);
    } finally {
      this.running.delete(item.id);
      if (this.items.has(item.id)) {
        this.save();
      }
    }
  }

  private readInfo(item: QuickDownload, json: string): void {
    try {
      const info = JSON.parse(json) as { title?: string; thumbnail?: string; channel?: string; duration?: number };
      item.title = info.title ?? item.title;
      item.thumbnail = info.thumbnail ?? item.thumbnail;
      item.channel = info.channel ?? item.channel;
      item.duration = typeof info.duration === 'number' ? info.duration : item.duration;
      this.save();
    } catch {
      // Without it the item just shows its link instead of a title.
    }
  }

  /** Renames "<id>.<ext>" to the readable title, the name the browser saves it under. */
  private async nameFile(item: QuickDownload, filename: string): Promise<string> {
    const title = fileTitle(item.title ?? '', 120);
    if (title === '') {
      return filename;
    }
    const target = path.join(path.dirname(filename), `${title}${path.extname(filename)}`);
    await fs.promises.rename(filename, target);
    return target;
  }
}
