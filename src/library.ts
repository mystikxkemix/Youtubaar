import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Config } from './config';
import type { Downloader, DownloadUpdate } from './downloaders/types';
import { ensureShowMetadata, placeEpisode, playlistEpisode, type VideoMetadata } from './jellyfin';
import { compileTitleFilter, filterReason, folderFromName, normalizeFolder, validateDownloadOptions } from './rules';
import type { Store } from './store';
import { PLAYLIST_ORDERS, type DownloadType, type InitialAction, type Mode, type PlaylistOrder, type Subscription, type Video, type VideoStatus } from './types';
import { fetchAvatar, fetchBacklog, fetchChannelPlaylists, fetchFeed, fetchVideoMetadata, mergeListing, resolveSource, sourceUrl, type ChannelPlaylist, type FeedEntry, type SourceRef } from './youtube';

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
  playlistOrder?: PlaylistOrder;
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

/**
 * Removes a downloaded video and the files saved next to it: the Jellyfin .nfo and
 * "-thumb.jpg", and the thumbnail yt-dlp leaves with the same name. Refuses paths outside
 * the download folder. Returns how many files were removed; a missing file is not an error.
 */
export async function deleteDownloadFiles(downloadDir: string, filename: string): Promise<number> {
  const root = path.resolve(downloadDir);
  const media = path.resolve(root, filename);
  if (!media.startsWith(`${root}${path.sep}`)) {
    throw new Error(`"${filename}" is outside the download folder`);
  }
  const stem = media.slice(0, media.length - path.extname(media).length);
  let removed = 0;
  for (const file of [media, `${stem}.nfo`, `${stem}-thumb.jpg`, `${stem}.jpg`, `${stem}.webp`]) {
    try {
      await fs.promises.rm(file);
      removed++;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }
  return removed;
}

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

  /** Called with the show name each time episodes are placed in the Jellyfin layout. */
  onEpisodesPlaced: (showName: string) => void = () => undefined;

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
      // A playlist is its own show, so its default folder sits next to the channel's,
      // never inside it: "mistermv_Zelda_Ocarina_of_Time".
      folder: normalizeFolder(input.folder?.trim() || folderFromName(ref.kind === 'playlist' && feed.ownerName ? `${feed.ownerName}_${name}` : name)),
      mode: input.mode ?? 'manual',
      downloadType: input.downloadType ?? 'video',
      format: input.format ?? 'any',
      quality: input.quality ?? 'best',
      titleInclude: input.titleInclude ?? '',
      titleExclude: input.titleExclude ?? '',
      skipShorts: input.skipShorts ?? false,
      jellyfin: input.jellyfin ?? false,
      playlistOrder: input.playlistOrder ?? 'auto',
      enabled: input.enabled ?? true,
      createdAt: now(),
      lastCheckedAt: now(),
      lastError: null,
    };
    this.validate(subscription);
    this.subscriptions.push(subscription);
    let added = this.ingest(subscription, feed.entries, input.initial ?? 'available');
    if (subscription.kind === 'playlist') {
      added += await this.listWholePlaylist(subscription, feed.entries);
    }
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
      playlistOrder: input.playlistOrder ?? current.playlistOrder ?? 'auto',
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
      if (subscription.kind === 'playlist' && !subscription.fullyListed) {
        added += await this.listWholePlaylist(subscription, feed.entries);
      }
      added += this.ingest(subscription, await this.playlistAware(subscription, feed.entries), 'follow-mode');
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

  /**
   * Brings videos already downloaded for a subscription into the Jellyfin layout: season
   * folder, episode name, .nfo and thumbnail. Metadata is read again from YouTube (no
   * re-download). Safe to run twice: placed videos keep their name and number.
   */
  async organizeForJellyfin(id: string): Promise<{ organized: number; failed: string[] }> {
    const subscription = this.getSubscription(id);
    if (!subscription.jellyfin) {
      throw new Error('Turn on Jellyfin metadata for this subscription first');
    }
    if (this.config.downloader !== 'ytdlp') {
      throw new Error('Organizing needs the built-in yt-dlp downloader (MeTube keeps its own files)');
    }
    const showDir = path.join(this.config.downloadDir, subscription.folder);
    await ensureShowMetadata(showDir, subscription);
    let organized = 0;
    const failed: string[] = [];
    for (const video of Object.values(this.store.data.videos)) {
      if (video.subscriptionId !== id || video.status !== 'done' || video.filename === null) {
        continue;
      }
      const current = path.join(this.config.downloadDir, video.filename);
      if (!fs.existsSync(current)) {
        failed.push(`${video.title}: file not found (${video.filename})`);
        continue;
      }
      try {
        const metadata = (await fetchVideoMetadata(video.url, this.ytdlpPath())) as unknown as VideoMetadata;
        const placed = await placeEpisode(current, showDir, metadata, subscription, this.episodeInPlaylist(video, subscription), video.thumbnail);
        video.filename = path.relative(this.config.downloadDir, placed);
        video.updatedAt = now();
        organized++;
      } catch (error) {
        failed.push(`${video.title}: ${(error as Error).message}`);
      }
    }
    this.store.save();
    if (organized > 0) {
      this.onEpisodesPlaced(subscription.name);
    }
    return { organized, failed };
  }

  /**
   * Deletes downloaded videos from disk and marks them ignored, so an auto-download
   * subscription does not grab them again ("Move back to new" or "Download" brings one back).
   * Videos not downloaded are left alone. Returns how many were deleted.
   */
  async deleteDownloads(ids: string[]): Promise<{ deleted: number; failed: string[] }> {
    if (this.config.downloader !== 'ytdlp') {
      throw new Error('Deleting needs the built-in yt-dlp downloader (MeTube keeps its own files)');
    }
    let deleted = 0;
    const failed: string[] = [];
    for (const id of ids) {
      const video = this.store.data.videos[id];
      if (video === undefined || video.status !== 'done') {
        continue;
      }
      try {
        if (video.filename !== null) {
          await deleteDownloadFiles(this.config.downloadDir, video.filename);
        }
        video.status = 'ignored';
        video.note = null;
        video.progress = null;
        video.filename = null;
        video.updatedAt = now();
        deleted++;
      } catch (error) {
        failed.push(`${video.title}: ${(error as Error).message}`);
      }
    }
    if (deleted > 0) {
      this.store.save();
    }
    return { deleted, failed };
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
      downloader.start({ video, subscription, episode: this.episodeInPlaylist(video, subscription) }).catch((error: Error) => {
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
    if (update.status === 'done') {
      const subscription = this.subscriptions.find((candidate) => candidate.id === video.subscriptionId);
      if (subscription?.jellyfin === true && subscription.downloadType === 'video' && this.config.downloader === 'ytdlp') {
        this.onEpisodesPlaced(subscription.name);
      }
    }
    if (update.status !== 'downloading') {
      this.processQueue();
    }
  };

  /** Playlist episode number of a video, from all the videos of its playlist; null for channels. */
  private episodeInPlaylist(video: Video, subscription: Subscription): number | null {
    if (subscription.kind !== 'playlist') {
      return null;
    }
    const items: Video[] = [];
    for (const candidate of Object.values(this.store.data.videos)) {
      if (candidate.subscriptionId === subscription.id) {
        items.push(candidate);
      }
    }
    return playlistEpisode(video.position, items, subscription.playlistOrder);
  }

  private validate(subscription: Subscription): void {
    validateDownloadOptions(subscription);
    compileTitleFilter(subscription.titleInclude);
    compileTitleFilter(subscription.titleExclude);
    if (subscription.jellyfin === true && subscription.downloadType !== 'video') {
      throw new Error('The Jellyfin layout is for video downloads; turn it off for audio');
    }
    // A Jellyfin show folder inside another subscription's folder would read as a season.
    for (const other of this.subscriptions) {
      if (other.id === subscription.id || !(subscription.jellyfin || other.jellyfin)) {
        continue;
      }
      const inside = (a: string, b: string): boolean => a === b || a.startsWith(`${b}/`);
      if (inside(subscription.folder, other.folder) || inside(other.folder, subscription.folder)) {
        throw new Error(`With Jellyfin metadata, "${subscription.folder}" cannot share or sit inside "${other.folder}" (${other.name}); pick a folder next to it`);
      }
    }
    if (subscription.playlistOrder !== undefined && !PLAYLIST_ORDERS.includes(subscription.playlistOrder)) {
      throw new Error(`Playlist order must be one of: ${PLAYLIST_ORDERS.join(', ')}`);
    }
    if (subscription.mode !== 'auto' && subscription.mode !== 'manual') {
      throw new Error('Mode must be "auto" or "manual"');
    }
  }

  /**
   * A video listed by two subscriptions belongs to the first that found it, but changes
   * hands while you have not decided about it yet:
   * - to a playlist, when the current owner is a channel: the more specific source wins,
   *   so a let's play lands in its own show and folder;
   * - to a subscription that auto-downloads, which then queues it.
   * Videos you ignored yourself stay ignored; videos only skipped by the other
   * subscription's filters do not.
   */
  private canClaim(video: Video, subscription: Subscription, entry: FeedEntry, autoDownloads: boolean): boolean {
    const undecided = video.status === 'available' || (video.status === 'ignored' && video.note !== null);
    if (!undecided || filterReason(subscription, entry) !== null) {
      return false;
    }
    const owner = this.subscriptions.find((candidate) => candidate.id === video.subscriptionId);
    const moreSpecific = subscription.kind === 'playlist' && owner?.kind !== 'playlist';
    return moreSpecific || autoDownloads;
  }

  /**
   * For playlists, the whole listing (new videos are often appended past the feed's 15).
   * Falls back to the feed when yt-dlp cannot list it.
   */
  private async playlistAware(subscription: Subscription, feedEntries: FeedEntry[]): Promise<FeedEntry[]> {
    if (subscription.kind !== 'playlist') {
      return feedEntries;
    }
    try {
      const listing = await fetchBacklog(subscription, this.ytdlpPath(), this.config.backlogLimit);
      return mergeListing(listing.entries, feedEntries);
    } catch {
      return feedEntries;
    }
  }

  /**
   * First full listing of a playlist: what is already in it is shown as new, never
   * downloaded automatically, so following a long playlist does not grab its backlog.
   */
  private async listWholePlaylist(subscription: Subscription, feedEntries: FeedEntry[]): Promise<number> {
    try {
      const listing = await fetchBacklog(subscription, this.ytdlpPath(), this.config.backlogLimit);
      const added = this.ingest(subscription, mergeListing(listing.entries, feedEntries), 'available');
      subscription.fullyListed = true;
      return added;
    } catch {
      return 0;
    }
  }

  /** Files entries not seen before; returns how many were new. */
  private ingest(subscription: Subscription, entries: FeedEntry[], policy: IngestPolicy): number {
    const videos = this.store.data.videos;
    let added = 0;
    for (const entry of entries) {
      const existing = videos[entry.videoId];
      if (existing !== undefined) {
        const autoDownloads = policy === 'follow-mode' && subscription.mode === 'auto' && subscription.enabled;
        if (existing.subscriptionId === subscription.id) {
          existing.position = entry.position ?? existing.position ?? null;
        } else if (this.canClaim(existing, subscription, entry, autoDownloads)) {
          existing.subscriptionId = subscription.id;
          existing.position = entry.position ?? null;
          existing.status = autoDownloads ? 'queued' : 'available';
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
        position: entry.position ?? null,
        foundAt: now(),
        updatedAt: now(),
      };
      added++;
    }
    return added;
  }
}

export class NotFoundError extends Error {}
