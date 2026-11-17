import { randomUUID } from 'node:crypto';
import type { Config } from './config';
import type { Downloader, DownloadUpdate } from './downloaders/types';
import { compileTitleFilter, filterReason, folderFromName, normalizeFolder, validateDownloadOptions } from './rules';
import type { Store } from './store';
import type { DownloadType, InitialAction, Mode, Subscription, Video, VideoStatus } from './types';
import { fetchAvatar, fetchBacklog, fetchChannelPlaylists, fetchFeed, resolveSource, sourceUrl, type ChannelPlaylist, type FeedEntry, type SourceRef } from './youtube';

export interface SubscriptionInput {
  url?: string;
  name?: string;
  folder?: string;
  mode?: Mode;
  downloadType?: DownloadType;
  format?: string;
  quality?: string;
  titleInclude?: string;
  titleExclude?: string;
  skipShorts?: boolean;
  jellyfin?: boolean;
  enabled?: boolean;
  /** Creation only: what to do with the videos already in the source. */
  initial?: InitialAction;
}

export type VideoAction = 'download' | 'ignore' | 'restore';

/** What the add dialog shows before subscribing. */
export interface SourcePreview extends SourceRef {
  name: string;
  url: string;
  avatar: string | null;
  suggestedFolder: string;
  alreadySubscribed: boolean;
  recent: FeedEntry[];
}

/** A channel playlist, with the subscription following it if any. */
export interface PlaylistOption extends ChannelPlaylist {
  subscriptionId: string | null;
  mode: Mode | null;
}

const PLAYLIST_CACHE_MS = 10 * 60_000;
const PLAYLIST_LIMIT = 300;

/** Per-subscription figures for the library view. */
export interface SubscriptionStats {
  counts: Record<VideoStatus, number>;
  total: number;
  latestAt: string | null;
  cover: string | null;
}

/** Statuses each action applies to; videos in any other status are left alone. */
const ACTION_SOURCES: Record<VideoAction, readonly VideoStatus[]> = {
  download: ['available', 'ignored', 'failed'],
  ignore: ['available', 'failed', 'queued'],
  restore: ['ignored'],
};

/** How newly seen entries are classified. */
type IngestPolicy = 'follow-mode' | InitialAction;

export interface VideoQuery {
  statuses?: VideoStatus[];
  subscriptionId?: string;
  search?: string;
  /** published: newest upload first. updated: most recent status change first. */
  sortBy?: 'published' | 'updated';
  limit: number;
  offset: number;
}

function now(): string {
  return new Date().toISOString();
}

/**
 * Newest first. Videos listed from the backlog often have no date: they sort last,
 * and the stable sort keeps them in the source's own (newest first) order.
 */
function sortDate(video: Video): string {
  return video.publishedAt ?? '';
}

/** The core: subscriptions, the video library, polling and the download queue. */
export class Library {
  private checking = false;
  private lastPollAt: string | null = null;

  constructor(
    private readonly store: Store,
    private readonly config: Config,
    /** Path of the yt-dlp to run; it changes once the managed copy is installed. */
    private readonly ytdlpPath: () => string,
    private downloader: Downloader | null = null,
  ) {}

  /** Stops handing new downloads to the downloader, e.g. while yt-dlp is being replaced. */
  paused = false;

  get activeDownloads(): number {
    let count = 0;
    for (const video of Object.values(this.store.data.videos)) {
      if (video.status === 'downloading') {
        count++;
      }
    }
    return count;
  }

  setDownloader(downloader: Downloader): void {
    this.downloader = downloader;
  }

  get subscriptions(): Subscription[] {
    return this.store.data.subscriptions;
  }

  get isChecking(): boolean {
    return this.checking;
  }

  get lastPoll(): string | null {
    return this.lastPollAt;
  }

  private readonly playlistCache = new Map<string, { at: number; playlists: ChannelPlaylist[] }>();

  /** Set by the scheduler so the UI can say when the next check happens. */
  nextPollAt: string | null = null;

  getSubscription(id: string): Subscription {
    const subscription = this.subscriptions.find((candidate) => candidate.id === id);
    if (subscription === undefined) {
      throw new NotFoundError(`Subscription ${id} not found`);
    }
    return subscription;
  }

  private isSubscribed(ref: SourceRef): boolean {
    return this.subscriptions.some((existing) => existing.kind === ref.kind && existing.sourceId === ref.sourceId);
  }

  /** Resolves a pasted URL and shows what subscribing would bring, without saving anything. */
  async lookup(input: string): Promise<SourcePreview> {
    if (input.trim() === '') {
      throw new Error('Paste a channel or playlist URL');
    }
    const ref = await resolveSource(input, this.ytdlpPath());
    const [feed, avatar] = await Promise.all([fetchFeed(ref), fetchAvatar(ref)]);
    const name = feed.title || ref.sourceId;
    return {
      kind: ref.kind,
      sourceId: ref.sourceId,
      name,
      url: sourceUrl(ref),
      avatar,
      suggestedFolder: folderFromName(name),
      alreadySubscribed: this.isSubscribed(ref),
      recent: feed.entries,
    };
  }

  /** Playlists of a channel, marked with the ones already followed. Cached for a few minutes. */
  async channelPlaylists(channelId: string): Promise<PlaylistOption[]> {
    if (!/^UC[\w-]{22}$/.test(channelId)) {
      throw new Error('Not a channel id');
    }
    let cached = this.playlistCache.get(channelId);
    if (cached === undefined || Date.now() - cached.at > PLAYLIST_CACHE_MS) {
      cached = { at: Date.now(), playlists: await fetchChannelPlaylists(channelId, this.ytdlpPath(), PLAYLIST_LIMIT) };
      this.playlistCache.set(channelId, cached);
    }
    return cached.playlists.map((playlist) => {
      const followed = this.subscriptions.find((s) => s.kind === 'playlist' && s.sourceId === playlist.id);
      return { ...playlist, subscriptionId: followed?.id ?? null, mode: followed?.mode ?? null };
    });
  }

  async addSubscription(input: SubscriptionInput): Promise<{ subscription: Subscription; added: number }> {
    if (input.url === undefined || input.url.trim() === '') {
      throw new Error('A channel or playlist URL is required');
    }
    const ref = await resolveSource(input.url, this.ytdlpPath());
    if (this.isSubscribed(ref)) {
      throw new Error(`This ${ref.kind} is already subscribed`);
    }
    const [feed, avatar] = await Promise.all([fetchFeed(ref), fetchAvatar(ref)]);
    const name = input.name?.trim() || feed.title || ref.sourceId;
    const subscription: Subscription = {
      id: randomUUID(),
      kind: ref.kind,
      sourceId: ref.sourceId,
      name,
      url: sourceUrl(ref),
      avatar,
      ownerChannelId: ref.kind === 'playlist' ? feed.ownerChannelId : ref.sourceId,
      ownerName: ref.kind === 'playlist' ? feed.ownerName : name,
      folder: normalizeFolder(input.folder?.trim() || folderFromName(name)),
      mode: input.mode ?? 'manual',
      downloadType: input.downloadType ?? 'video',
      format: input.format ?? 'any',
      quality: input.quality ?? 'best',
      titleInclude: input.titleInclude ?? '',
      titleExclude: input.titleExclude ?? '',
      skipShorts: input.skipShorts ?? false,
      jellyfin: input.jellyfin ?? false,
      enabled: input.enabled ?? true,
      createdAt: now(),
      lastCheckedAt: now(),
      lastError: null,
    };
    this.validate(subscription);
    this.subscriptions.push(subscription);
    const added = this.ingest(subscription, feed.entries, input.initial ?? 'available');
    this.store.save();
    return { subscription, added };
  }

  updateSubscription(id: string, input: SubscriptionInput): Subscription {
    const current = this.getSubscription(id);
    const next: Subscription = {
      ...current,
      name: input.name?.trim() || current.name,
      folder: input.folder === undefined ? current.folder : normalizeFolder(input.folder),
      mode: input.mode ?? current.mode,
      downloadType: input.downloadType ?? current.downloadType,
      format: input.format ?? current.format,
      quality: input.quality ?? current.quality,
      titleInclude: input.titleInclude ?? current.titleInclude,
      titleExclude: input.titleExclude ?? current.titleExclude,
      skipShorts: input.skipShorts ?? current.skipShorts,
      jellyfin: input.jellyfin ?? current.jellyfin ?? false,
      enabled: input.enabled ?? current.enabled,
    };
    this.validate(next);
    Object.assign(current, next);
    this.store.save();
    return current;
  }

  /** Forgets the subscription and its videos. Downloaded files stay on disk. */
  deleteSubscription(id: string): void {
    const subscription = this.getSubscription(id);
    this.store.data.subscriptions = this.subscriptions.filter((candidate) => candidate !== subscription);
    const videos = this.store.data.videos;
    for (const videoId of Object.keys(videos)) {
      if (videos[videoId].subscriptionId === id) {
        delete videos[videoId];
      }
    }
    this.store.save();
  }

  /** Reads the source's feed and files the videos not seen before. Never throws. */
  async checkSubscription(subscription: Subscription): Promise<number> {
    let added = 0;
    try {
      const feed = await fetchFeed(subscription);
      added = this.ingest(subscription, feed.entries, 'follow-mode');
      if (subscription.avatar === undefined) {
        // Subscriptions created before avatars existed get theirs on the next check.
        subscription.avatar = await fetchAvatar(subscription);
      }
      if (subscription.ownerChannelId === undefined) {
        subscription.ownerChannelId = subscription.kind === 'playlist' ? feed.ownerChannelId : subscription.sourceId;
        subscription.ownerName = subscription.kind === 'playlist' ? feed.ownerName : subscription.name;
      }
      subscription.lastError = null;
    } catch (error) {
      subscription.lastError = (error as Error).message;
    }
    subscription.lastCheckedAt = now();
    this.store.save();
    this.processQueue();
    return added;
  }

  async checkAll(): Promise<number> {
    if (this.checking) {
      return 0;
    }
    this.checking = true;
    let added = 0;
    try {
      for (const subscription of this.subscriptions) {
        if (subscription.enabled) {
          added += await this.checkSubscription(subscription);
        }
      }
    } finally {
      this.checking = false;
      this.lastPollAt = now();
    }
    return added;
  }

  /** Lists the source's older videos (beyond the feed's latest 15) into the inbox. Needs yt-dlp. */
  async loadBacklog(id: string): Promise<number> {
    const subscription = this.getSubscription(id);
    const backlog = await fetchBacklog(subscription, this.ytdlpPath(), this.config.backlogLimit);
    const added = this.ingest(subscription, backlog.entries, 'available');
    this.store.save();
    return added;
  }

  listVideos(query: VideoQuery): { total: number; items: Video[] } {
    const search = query.search?.trim().toLowerCase() ?? '';
    const matches: Video[] = [];
    for (const video of Object.values(this.store.data.videos)) {
      if (query.statuses !== undefined && !query.statuses.includes(video.status)) {
        continue;
      }
      if (query.subscriptionId !== undefined && video.subscriptionId !== query.subscriptionId) {
        continue;
      }
      if (search !== '' && !video.title.toLowerCase().includes(search) && !video.channel.toLowerCase().includes(search)) {
        continue;
      }
      matches.push(video);
    }
    if (query.sortBy === 'updated') {
      matches.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    } else {
      matches.sort((a, b) => sortDate(b).localeCompare(sortDate(a)));
    }
    return { total: matches.length, items: matches.slice(query.offset, query.offset + query.limit) };
  }

  /** Counts, newest upload date and a cover thumbnail for each subscription. */
  subscriptionStats(): Record<string, SubscriptionStats> {
    const { bySubscription } = this.counts();
    const stats: Record<string, SubscriptionStats> = {};
    for (const subscription of this.subscriptions) {
      stats[subscription.id] = { counts: bySubscription[subscription.id], total: 0, latestAt: null, cover: null };
    }
    for (const video of Object.values(this.store.data.videos)) {
      const entry = stats[video.subscriptionId];
      if (entry === undefined) {
        continue;
      }
      entry.total++;
      if (video.publishedAt !== null && (entry.latestAt === null || video.publishedAt > entry.latestAt)) {
        entry.latestAt = video.publishedAt;
        entry.cover = video.thumbnail;
      }
    }
    return stats;
  }

  /** Video counts per status, overall and per subscription. */
  counts(): { total: Record<VideoStatus, number>; bySubscription: Record<string, Record<VideoStatus, number>> } {
    const empty = (): Record<VideoStatus, number> => ({ available: 0, ignored: 0, queued: 0, downloading: 0, done: 0, failed: 0 });
    const total = empty();
    const bySubscription: Record<string, Record<VideoStatus, number>> = {};
    for (const subscription of this.subscriptions) {
      bySubscription[subscription.id] = empty();
    }
    for (const video of Object.values(this.store.data.videos)) {
      total[video.status]++;
      const perSubscription = bySubscription[video.subscriptionId];
      if (perSubscription !== undefined) {
        perSubscription[video.status]++;
      }
    }
    return { total, bySubscription };
  }

  /** Applies a user action to videos; returns how many changed. */
  applyAction(ids: string[], action: VideoAction): number {
    const allowed = ACTION_SOURCES[action];
    if (allowed === undefined) {
      throw new Error(`Unknown action "${action}"`);
    }
    let changed = 0;
    for (const id of ids) {
      const video = this.store.data.videos[id];
      if (video === undefined || !allowed.includes(video.status)) {
        continue;
      }
      video.status = action === 'download' ? 'queued' : action === 'ignore' ? 'ignored' : 'available';
      video.note = null;
      video.progress = null;
      video.updatedAt = now();
      changed++;
    }
    if (changed > 0) {
      this.store.save();
      this.processQueue();
    }
    return changed;
  }

  /** Hands queued videos to the downloader, oldest request first, within its capacity. */
  processQueue(): void {
    const downloader = this.downloader;
    if (downloader === null || this.paused) {
      return;
    }
    const videos = Object.values(this.store.data.videos);
    let inFlight = 0;
    const queued: Video[] = [];
    for (const video of videos) {
      if (video.status === 'downloading') {
        inFlight++;
      } else if (video.status === 'queued') {
        queued.push(video);
      }
    }
    queued.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));

    for (const video of queued) {
      if (inFlight >= downloader.capacity) {
        break;
      }
      const subscription = this.subscriptions.find((candidate) => candidate.id === video.subscriptionId);
      if (subscription === undefined) {
        continue;
      }
      inFlight++;
      video.status = 'downloading';
      video.progress = 0;
      video.sentAt = now();
      video.updatedAt = now();
      downloader.start({ video, subscription }).catch((error: Error) => {
        this.onDownloadUpdate(video.id, { status: 'failed', note: error.message });
      });
    }
    this.store.save();
  }

  /** Asks the downloader for news about running downloads, then refills the queue. */
  async syncDownloads(): Promise<void> {
    if (this.downloader === null) {
      return;
    }
    const active = Object.values(this.store.data.videos).filter((video) => video.status === 'downloading');
    await this.downloader.sync(active);
    this.processQueue();
  }

  /**
   * Folders saved before safe names existed get them now, so new downloads never land
   * in paths with spaces or special characters. Files already downloaded stay put.
   */
  normalizeFolders(): string[] {
    const changed: string[] = [];
    for (const subscription of this.subscriptions) {
      const safe = normalizeFolder(subscription.folder);
      if (safe !== subscription.folder) {
        changed.push(`${subscription.folder} -> ${safe}`);
        subscription.folder = safe;
      }
    }
    if (changed.length > 0) {
      this.store.save();
    }
    return changed;
  }

  /** After a restart, local downloads that were cut off go back to the queue. */
  requeueInterrupted(): void {
    for (const video of Object.values(this.store.data.videos)) {
      if (video.status === 'downloading') {
        video.status = 'queued';
        video.progress = null;
      }
    }
    this.store.save();
  }

  readonly onDownloadUpdate = (videoId: string, update: DownloadUpdate): void => {
    const video = this.store.data.videos[videoId];
    // The user may have deleted the subscription or ignored the video meanwhile.
    if (video === undefined || video.status !== 'downloading') {
      return;
    }
    video.status = update.status;
    if (update.progress !== undefined) {
      video.progress = update.progress;
    }
    if (update.note !== undefined) {
      video.note = update.note;
    }
    if (update.filename !== undefined) {
      video.filename = update.filename;
    }
    video.updatedAt = now();
    this.store.save();
    if (update.status !== 'downloading') {
      this.processQueue();
    }
  };

  private validate(subscription: Subscription): void {
    validateDownloadOptions(subscription);
    compileTitleFilter(subscription.titleInclude);
    compileTitleFilter(subscription.titleExclude);
    if (subscription.jellyfin === true && subscription.downloadType !== 'video') {
      throw new Error('The Jellyfin layout is for video downloads; turn it off for audio');
    }
    if (subscription.mode !== 'auto' && subscription.mode !== 'manual') {
      throw new Error('Mode must be "auto" or "manual"');
    }
  }

  /**
   * A video found first through a subscription where you pick (e.g. the whole channel)
   * is handed to an auto-downloading subscription that also lists it (e.g. one of the
   * channel's playlists), unless you already decided about it. Videos you ignored
   * yourself stay ignored; videos only skipped by the other subscription's filters do not.
   */
  private canClaim(video: Video, subscription: Subscription, entry: FeedEntry): boolean {
    if (video.subscriptionId === subscription.id || subscription.mode !== 'auto' || !subscription.enabled) {
      return false;
    }
    const undecided = video.status === 'available' || (video.status === 'ignored' && video.note !== null);
    return undecided && filterReason(subscription, entry) === null;
  }

  /** Files entries not seen before; returns how many were new. */
  private ingest(subscription: Subscription, entries: FeedEntry[], policy: IngestPolicy): number {
    const videos = this.store.data.videos;
    let added = 0;
    for (const entry of entries) {
      const existing = videos[entry.videoId];
      if (existing !== undefined) {
        if (policy === 'follow-mode' && this.canClaim(existing, subscription, entry)) {
          existing.subscriptionId = subscription.id;
          existing.status = 'queued';
          existing.note = null;
          existing.updatedAt = now();
        }
        continue;
      }
      const reason = filterReason(subscription, entry);
      let status: VideoStatus;
      if (reason !== null || policy === 'ignore') {
        status = 'ignored';
      } else if (policy === 'download' || (policy === 'follow-mode' && subscription.mode === 'auto')) {
        status = 'queued';
      } else {
        status = 'available';
      }
      videos[entry.videoId] = {
        id: entry.videoId,
        subscriptionId: subscription.id,
        title: entry.title,
        channel: entry.channel || subscription.name,
        url: entry.url,
        thumbnail: entry.thumbnail,
        publishedAt: entry.publishedAt,
        isShort: entry.isShort,
        status,
        note: reason,
        progress: null,
        filename: null,
        sentAt: null,
        foundAt: now(),
        updatedAt: now(),
      };
      added++;
    }
    return added;
  }
}

export class NotFoundError extends Error {}
