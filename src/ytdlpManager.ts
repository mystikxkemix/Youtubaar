import fs from 'node:fs';
import path from 'node:path';
import { lastError, run } from './process';

export type YtdlpChannel = 'stable' | 'nightly';

export interface YtdlpManagerOptions {
  /** yt-dlp used until a managed copy exists (the one baked into the image, or from PATH). */
  fallbackPath: string;
  dataDir: string;
  pythonPath: string;
  channel: YtdlpChannel;
}

export interface YtdlpStatus {
  version: string | null;
  latest: string | null;
  updateAvailable: boolean;
  channel: YtdlpChannel;
  /** True once yt-dlp runs from the updatable copy in the data volume. */
  managed: boolean;
  path: string;
  updating: boolean;
  lastUpdateAt: string | null;
  lastError: string | null;
}

const PYPI_URL = 'https://pypi.org/pypi/yt-dlp/json';

/**
 * Keeps yt-dlp current. YouTube changes often break old yt-dlp versions, and a
 * container image only carries the version it was built with, so updates go into
 * a Python venv inside the data volume: they survive restarts and image recreation,
 * and need no rebuild.
 */
export class YtdlpManager {
  private readonly venvDir: string;
  private version: string | null = null;
  private latest: string | null = null;
  private updating = false;
  private lastUpdateAt: string | null = null;
  private lastErrorMessage: string | null = null;

  constructor(private readonly options: YtdlpManagerOptions) {
    this.venvDir = path.join(options.dataDir, 'yt-dlp');
  }

  private get managedPath(): string {
    return path.join(this.venvDir, 'bin', 'yt-dlp');
  }

  /** The yt-dlp to run: the managed copy once installed, else the fallback. */
  get path(): string {
    return fs.existsSync(this.managedPath) ? this.managedPath : this.options.fallbackPath;
  }

  get isUpdating(): boolean {
    return this.updating;
  }

  async refreshVersion(): Promise<string | null> {
    try {
      const result = await run(this.path, ['--version'], { timeoutMs: 30_000 });
      this.version = result.code === 0 ? result.stdout.trim() : null;
    } catch {
      this.version = null;
    }
    return this.version;
  }

  /** Latest stable release on PyPI. Nightlies are not listed there, so this stays null on that channel. */
  async refreshLatest(): Promise<string | null> {
    if (this.options.channel === 'nightly') {
      return null;
    }
    try {
      const response = await fetch(PYPI_URL, { signal: AbortSignal.timeout(15_000) });
      if (response.ok) {
        this.latest = ((await response.json()) as { info?: { version?: string } }).info?.version ?? null;
      }
    } catch {
      // Offline: keep the last known value.
    }
    return this.latest;
  }

  async status(): Promise<YtdlpStatus> {
    if (this.version === null) {
      await this.refreshVersion();
    }
    if (this.latest === null) {
      await this.refreshLatest();
    }
    return {
      version: this.version,
      latest: this.latest,
      updateAvailable: this.latest !== null && this.version !== null && isNewer(this.latest, this.version),
      channel: this.options.channel,
      managed: fs.existsSync(this.managedPath),
      path: this.path,
      updating: this.updating,
      lastUpdateAt: this.lastUpdateAt,
      lastError: this.lastErrorMessage,
    };
  }

  /** Installs or upgrades yt-dlp in the data volume. Returns the versions before and after. */
  async update(): Promise<{ before: string | null; after: string | null }> {
    if (this.updating) {
      throw new Error('An update is already running');
    }
    this.updating = true;
    const before = await this.refreshVersion();
    try {
      if (!fs.existsSync(path.join(this.venvDir, 'bin', 'pip'))) {
        await this.exec(this.options.pythonPath, ['-m', 'venv', this.venvDir], 'create the Python venv');
      }
      const pipArgs = ['install', '--upgrade', '--disable-pip-version-check', '--no-cache-dir'];
      if (this.options.channel === 'nightly') {
        pipArgs.push('--pre');
      }
      // [default] brings the optional dependencies, including the YouTube challenge solver scripts.
      pipArgs.push('yt-dlp[default]');
      await this.exec(path.join(this.venvDir, 'bin', 'pip'), pipArgs, 'install yt-dlp');
      this.lastErrorMessage = null;
      this.lastUpdateAt = new Date().toISOString();
    } catch (error) {
      this.lastErrorMessage = (error as Error).message;
      throw error;
    } finally {
      this.updating = false;
    }
    const after = await this.refreshVersion();
    await this.refreshLatest();
    return { before, after };
  }

  private async exec(command: string, args: string[], what: string): Promise<void> {
    const result = await run(command, args, { timeoutMs: 10 * 60_000 });
    if (result.code !== 0) {
      throw new Error(`Could not ${what}: ${lastError(result.stderr || result.stdout)}`);
    }
  }
}

/** yt-dlp versions are dates like 2026.10.26 or 2026.10.26.1; compares them numerically. */
export function isNewer(candidate: string, current: string): boolean {
  const a = candidate.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const b = current.split('.').map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const difference = (a[i] ?? 0) - (b[i] ?? 0);
    if (difference !== 0) {
      return difference > 0;
    }
  }
  return false;
}
