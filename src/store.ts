import fs from 'node:fs';
import path from 'node:path';
import type { Subscription, Video } from './types';

export interface Db {
  version: 1;
  subscriptions: Subscription[];
  videos: Record<string, Video>;
}

const SAVE_DELAY_MS = 300;

/**
 * The whole state lives in one JSON file: a personal library is a few thousand
 * videos at most, which keeps this far simpler than a database.
 * Writes are debounced and atomic (temp file + rename).
 */
export class Store {
  private timer: NodeJS.Timeout | null = null;

  private constructor(private readonly file: string, public readonly data: Db) {}

  static open(dataDir: string): Store {
    fs.mkdirSync(dataDir, { recursive: true });
    const file = path.join(dataDir, 'youtubaar.json');
    if (!fs.existsSync(file)) {
      return new Store(file, { version: 1, subscriptions: [], videos: {} });
    }
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<Db>;
    return new Store(file, {
      version: 1,
      subscriptions: parsed.subscriptions ?? [],
      videos: parsed.videos ?? {},
    });
  }

  /** Schedules a write; call after every mutation. */
  save(): void {
    if (this.timer !== null) {
      return;
    }
    this.timer = setTimeout(() => this.flush(), SAVE_DELAY_MS);
  }

  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }
}
