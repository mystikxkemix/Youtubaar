import path from 'node:path';

export type DownloaderKind = 'metube' | 'ytdlp';

export interface Config {
  /** Release shown in the UI: the image's 1.N tag, "dev" outside a CI build. */
  version: string;
  port: number;
  dataDir: string;
  publicDir: string;
  downloader: DownloaderKind;
  /** Base URL of MeTube, including its URL_PREFIX if any. */
  metubeUrl: string;
  /** Download root for the yt-dlp downloader (MeTube uses its own). */
  downloadDir: string;
  /** yt-dlp used until Youtubaar installs its own updatable copy in DATA_DIR. */
  ytdlpPath: string;
  ytdlpConcurrency: number;
  /** stable follows PyPI releases; nightly gets YouTube fixes days earlier. */
  ytdlpChannel: 'stable' | 'nightly';
  /** Hours between automatic yt-dlp updates; 0 turns them off. */
  ytdlpAutoUpdateHours: number;
  pythonPath: string;
  /** Extra yt-dlp arguments appended to every download, e.g. "--cookies /data/cookies.txt". */
  ytdlpExtraArgs: string[];
  pollIntervalMinutes: number;
  /** Hours a quick download stays available before its file is deleted. */
  quickDownloadHours: number;
  /** Max number of videos fetched when loading a source's full history. */
  backlogLimit: number;
  /** Jellyfin base URL and API key; when both are set, shows are refreshed after new episodes. */
  jellyfinUrl: string;
  jellyfinApiKey: string;
  authUser: string;
  authPassword: string;
}

function intEnv(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < min) {
    throw new Error(`${name} must be an integer >= ${min}, got "${raw}"`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const downloader = (env.DOWNLOADER ?? 'ytdlp').trim().toLowerCase();
  if (downloader !== 'metube' && downloader !== 'ytdlp') {
    throw new Error(`DOWNLOADER must be "metube" or "ytdlp", got "${downloader}"`);
  }
  const metubeUrl = (env.METUBE_URL ?? '').trim();
  if (downloader === 'metube' && metubeUrl === '') {
    throw new Error('METUBE_URL is required when DOWNLOADER=metube (e.g. http://metube:8081)');
  }
  const extraArgs = (env.YTDLP_EXTRA_ARGS ?? '').trim();
  const channel = (env.YTDLP_CHANNEL ?? 'stable').trim().toLowerCase();
  if (channel !== 'stable' && channel !== 'nightly') {
    throw new Error(`YTDLP_CHANNEL must be "stable" or "nightly", got "${channel}"`);
  }

  return {
    version: env.APP_VERSION?.trim() || 'dev',
    port: intEnv(env, 'PORT', 8085, 1),
    dataDir: path.resolve(env.DATA_DIR ?? './data'),
    publicDir: path.resolve(__dirname, '../../public'),
    downloader,
    metubeUrl,
    downloadDir: path.resolve(env.DOWNLOAD_DIR ?? './downloads'),
    ytdlpPath: env.YTDLP_PATH ?? 'yt-dlp',
    ytdlpConcurrency: intEnv(env, 'YTDLP_CONCURRENCY', 1, 1),
    ytdlpChannel: channel,
    ytdlpAutoUpdateHours: intEnv(env, 'YTDLP_AUTO_UPDATE_HOURS', 24, 0),
    pythonPath: env.PYTHON_PATH ?? 'python3',
    ytdlpExtraArgs: extraArgs === '' ? [] : extraArgs.split(/\s+/),
    pollIntervalMinutes: intEnv(env, 'POLL_INTERVAL_MINUTES', 30, 1),
    quickDownloadHours: intEnv(env, 'QUICK_DOWNLOAD_HOURS', 48, 1),
    backlogLimit: intEnv(env, 'BACKLOG_LIMIT', 500, 1),
    jellyfinUrl: (env.JELLYFIN_URL ?? '').trim().replace(/\/+$/, ''),
    jellyfinApiKey: (env.JELLYFIN_API_KEY ?? '').trim(),
    authUser: env.AUTH_USER ?? 'admin',
    authPassword: env.AUTH_PASSWORD ?? '',
  };
}
