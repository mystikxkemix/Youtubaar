import { loadConfig } from './config';
import { MeTubeDownloader } from './downloaders/metube';
import type { Downloader } from './downloaders/types';
import { YtdlpDownloader } from './downloaders/ytdlp';
import { Library } from './library';
import { createServer, type YtdlpControl } from './server';
import { Store } from './store';
import { YtdlpManager } from './ytdlpManager';

const SYNC_INTERVAL_MS = 15_000;
const FIRST_POLL_DELAY_MS = 5_000;
const FIRST_UPDATE_DELAY_MS = 20_000;
const BUSY_RETRY_MS = 15 * 60_000;

function log(message: string): void {
  console.log(`${new Date().toISOString()} ${message}`);
}

function main(): void {
  const config = loadConfig();
  const store = Store.open(config.dataDir);
  const ytdlp = new YtdlpManager({
    fallbackPath: config.ytdlpPath,
    dataDir: config.dataDir,
    pythonPath: config.pythonPath,
    channel: config.ytdlpChannel,
  });
  const library = new Library(store, config, () => ytdlp.path);
  for (const change of library.normalizeFolders()) {
    log(`folder renamed for new downloads: ${change}`);
  }

  let downloader: Downloader;
  if (config.downloader === 'metube') {
    downloader = new MeTubeDownloader(config.metubeUrl, library.onDownloadUpdate);
  } else {
    downloader = new YtdlpDownloader(() => ytdlp.path, config.downloadDir, config.ytdlpConcurrency, config.ytdlpExtraArgs, library.onDownloadUpdate);
    // MeTube keeps downloading across our restarts; local yt-dlp processes do not.
    library.requeueInterrupted();
  }
  library.setDownloader(downloader);

  /** Replaces yt-dlp while no local download is using it; new downloads wait meanwhile. */
  const ytdlpControl: YtdlpControl = {
    status: () => ytdlp.status(),
    update: async () => {
      const running = config.downloader === 'ytdlp' ? library.activeDownloads : 0;
      if (running > 0) {
        throw new Error(`Wait for the ${running} running download(s) to finish before updating yt-dlp`);
      }
      library.paused = true;
      try {
        const result = await ytdlp.update();
        log(`yt-dlp updated: ${result.before ?? 'none'} -> ${result.after ?? 'unknown'}`);
        return result;
      } finally {
        library.paused = false;
        library.processQueue();
      }
    },
  };

  const autoUpdate = async (): Promise<void> => {
    try {
      await ytdlp.refreshLatest();
      const status = await ytdlp.status();
      // Nightlies are not on PyPI, so that channel just reinstalls (pip is a no-op when current).
      if (!status.managed || status.updateAvailable || config.ytdlpChannel === 'nightly') {
        await ytdlpControl.update();
      }
    } catch (error) {
      log(`yt-dlp auto-update skipped: ${(error as Error).message}`);
      setTimeout(() => void autoUpdate(), BUSY_RETRY_MS);
    }
  };
  if (config.ytdlpAutoUpdateHours > 0) {
    setTimeout(() => void autoUpdate(), FIRST_UPDATE_DELAY_MS);
    setInterval(() => void autoUpdate(), config.ytdlpAutoUpdateHours * 3_600_000);
  }

  const poll = async (): Promise<void> => {
    const added = await library.checkAll();
    log(`poll: ${added} new video(s) across ${library.subscriptions.length} subscription(s)`);
  };
  const pollIntervalMs = config.pollIntervalMinutes * 60_000;
  const schedule = (delayMs: number): void => {
    library.nextPollAt = new Date(Date.now() + delayMs).toISOString();
  };
  schedule(FIRST_POLL_DELAY_MS);
  const tick = (): void => {
    schedule(pollIntervalMs);
    void poll();
  };
  setTimeout(() => {
    tick();
    setInterval(tick, pollIntervalMs);
  }, FIRST_POLL_DELAY_MS);
  setInterval(() => {
    library.syncDownloads().catch((error: Error) => log(`download sync failed: ${error.message}`));
  }, SYNC_INTERVAL_MS);
  library.processQueue();

  const server = createServer(config, library, downloader.name, ytdlpControl);
  server.listen(config.port, () => {
    log(`Youtubaar ${config.version} listening on :${config.port}, downloader ${downloader.name}, polling every ${config.pollIntervalMinutes} min`);
    if (config.authPassword === '') {
      log('AUTH_PASSWORD is not set: the UI is open to anyone who can reach this port');
    }
  });

  const shutdown = (): void => {
    store.flush();
    server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
