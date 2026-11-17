import path from 'node:path';
import { lastError, run } from '../process';
import type { Video } from '../types';
import type { DownloadJob, Downloader, UpdateCallback } from './types';

const OUTPUT_TEMPLATE = '%(upload_date>%Y-%m-%d)s - %(title)s [%(id)s].%(ext)s';
const PROGRESS_INTERVAL_MS = 2_000;
const FILEPATH_MARKER = 'YOUTUBAAR_FILE:';

export function buildYtdlpArgs(job: DownloadJob, downloadDir: string, extraArgs: string[]): string[] {
  const { subscription, video } = job;
  // --print (used to learn the final file path) implies --quiet; --progress brings the
  // progress lines back so the UI can show a percentage.
  const args = ['--no-playlist', '--newline', '--progress', '--embed-metadata', '--no-simulate', '--print', `after_move:${FILEPATH_MARKER}%(filepath)s`];
  // Recent yt-dlp needs a JavaScript runtime to solve YouTube's challenges; only Deno is
  // enabled by default, so point it at the Node running Youtubaar.
  args.push('--js-runtimes', `node:${process.execPath}`);

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
  args.push('-o', path.join(downloadDir, subscription.folder, OUTPUT_TEMPLATE), ...extraArgs, video.url);
  return args;
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
    let filename: string | null = null;
    let lastReport = 0;
    this.onUpdate(videoId, { status: 'downloading', progress: 0 });

    const result = await run(this.ytdlpPath(), buildYtdlpArgs(job, this.downloadDir, this.extraArgs), {
      onLine: (line) => {
        if (line.startsWith(FILEPATH_MARKER)) {
          filename = line.slice(FILEPATH_MARKER.length);
          return;
        }
        const progress = line.match(/^\[download\]\s+([\d.]+)%/);
        const now = Date.now();
        if (progress !== null && now - lastReport >= PROGRESS_INTERVAL_MS) {
          lastReport = now;
          this.onUpdate(videoId, { status: 'downloading', progress: Math.round(Number.parseFloat(progress[1])) });
        }
      },
    });
    if (result.code !== 0) {
      throw new Error(lastError(result.stderr));
    }
    this.onUpdate(videoId, {
      status: 'done',
      progress: 100,
      filename: filename === null ? null : path.relative(this.downloadDir, filename),
      note: null,
    });
  }

  async sync(_active: Video[]): Promise<void> {
    // yt-dlp runs in-process, so progress is reported as it happens.
  }
}
