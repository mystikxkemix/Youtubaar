/**
 * Asks a Jellyfin server to read the metadata of new episodes again. Jellyfin's real-time
 * monitor adds new files by itself, but it does not re-read an .nfo that changes later
 * (e.g. "Organize for Jellyfin"), so the show is refreshed through the API a little after
 * its episodes are placed. Optional: only used when JELLYFIN_URL and JELLYFIN_API_KEY are set.
 *
 * tvshow.nfo locks the show (so Jellyfin never matches it against TV databases), and
 * Jellyfin skips every refresh of a locked show and of its episodes. The show is unlocked
 * for the refresh and locked again a little later, once the refresh has run.
 */

export interface JellyfinStatus {
  configured: boolean;
  url: string | null;
  lastRefreshAt: string | null;
  lastRefreshed: string | null;
  lastError: string | null;
}

interface JellyfinItem {
  Id: string;
  Name: string;
}

const REQUEST_TIMEOUT_MS = 15_000;
/** Jellyfin refreshes in the background; the show is locked again after this. */
const RELOCK_DELAY_MS = 120_000;

export class JellyfinRefresher {
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private lastRefreshAt: string | null = null;
  private lastRefreshed: string | null = null;
  private lastError: string | null = null;
  private userId: string | null = null;

  constructor(
    private readonly url: string,
    private readonly apiKey: string,
    /** Wait after the last placed episode, so Jellyfin's monitor has added the files first. */
    private readonly delayMs: number,
    private readonly log: (message: string) => void,
    private readonly relockDelayMs = RELOCK_DELAY_MS,
  ) {}

  get configured(): boolean {
    return this.url !== '' && this.apiKey !== '';
  }

  status(): JellyfinStatus {
    return {
      configured: this.configured,
      url: this.configured ? this.url : null,
      lastRefreshAt: this.lastRefreshAt,
      lastRefreshed: this.lastRefreshed,
      lastError: this.lastError,
    };
  }

  /** Schedules a refresh of the show; more episodes placed meanwhile push it back. */
  episodesPlaced(showName: string): void {
    if (!this.configured) {
      return;
    }
    clearTimeout(this.timers.get(showName));
    this.timers.set(showName, setTimeout(() => {
      this.timers.delete(showName);
      void this.refreshShow(showName);
    }, this.delayMs));
  }

  /**
   * Re-reads all metadata of the show and its episodes (local .nfo files win), keeping
   * images. A show Jellyfin does not know yet gets a library scan instead.
   */
  async refreshShow(showName: string): Promise<void> {
    try {
      const series = await this.findSeries(showName);
      if (series === null) {
        await this.request('POST', '/Library/Refresh');
        this.done(`library scan (new show "${showName}")`);
        return;
      }
      const query = new URLSearchParams({
        Recursive: 'true',
        MetadataRefreshMode: 'FullRefresh',
        ImageRefreshMode: 'Default',
        ReplaceAllMetadata: 'true',
        ReplaceAllImages: 'false',
      });
      const wasLocked = await this.setLocked(series.Id, false);
      await this.request('POST', `/Items/${series.Id}/Refresh?${query}`);
      if (wasLocked) {
        // unref: a pending relock does not keep the process alive on shutdown.
        setTimeout(() => {
          this.setLocked(series.Id, true).catch((error: Error) => this.log(`Jellyfin could not lock "${showName}" again: ${error.message}`));
        }, this.relockDelayMs).unref();
      }
      this.done(showName);
    } catch (error) {
      this.lastError = (error as Error).message;
      this.log(`Jellyfin refresh of "${showName}" failed: ${this.lastError}`);
    }
  }

  private done(what: string): void {
    this.lastRefreshAt = new Date().toISOString();
    this.lastRefreshed = what;
    this.lastError = null;
    this.log(`Jellyfin refresh: ${what}`);
  }

  /** The series whose name is exactly the show name (tvshow.nfo locks it to the subscription name). */
  private async findSeries(showName: string): Promise<JellyfinItem | null> {
    const query = new URLSearchParams({ IncludeItemTypes: 'Series', Recursive: 'true', SearchTerm: showName, Limit: '50' });
    const response = await this.request('GET', `/Items?${query}`);
    const { Items } = (await response.json()) as { Items?: JellyfinItem[] };
    for (const item of Items ?? []) {
      if (item.Name === showName) {
        return item;
      }
    }
    return null;
  }

  /**
   * Sets an item's metadata lock; returns whether it was locked before. Jellyfin only
   * updates an item from its whole description, read through a user (an administrator).
   */
  private async setLocked(itemId: string, locked: boolean): Promise<boolean> {
    if (this.userId === null) {
      const users = (await (await this.request('GET', '/Users')).json()) as { Id: string; Policy?: { IsAdministrator?: boolean } }[];
      this.userId = users.find((user) => user.Policy?.IsAdministrator === true)?.Id ?? null;
      if (this.userId === null) {
        throw new Error('Jellyfin has no administrator to update the show with');
      }
    }
    const item = (await (await this.request('GET', `/Users/${this.userId}/Items/${itemId}`)).json()) as { LockData?: boolean };
    const wasLocked = item.LockData === true;
    if (wasLocked !== locked) {
      await this.request('POST', `/Items/${itemId}`, { ...item, LockData: locked });
    }
    return wasLocked;
  }

  private async request(method: string, pathAndQuery: string, body?: unknown): Promise<Response> {
    const response = await fetch(`${this.url}${pathAndQuery}`, {
      method,
      headers: {
        Authorization: `MediaBrowser Token="${this.apiKey}"`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(response.status === 401 ? 'Jellyfin refused the API key (HTTP 401)' : `Jellyfin answered HTTP ${response.status}`);
    }
    return response;
  }
}
