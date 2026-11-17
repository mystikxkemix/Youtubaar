import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config';
import { Library } from '../src/library';
import { Store } from '../src/store';
import { test } from 'node:test';
import { indexHistory } from '../src/downloaders/metube';
import { buildYtdlpArgs } from '../src/downloaders/ytdlp';
import { filterReason, normalizeFolder, validateDownloadOptions } from '../src/rules';
import type { Subscription, Video } from '../src/types';
import { parseFeed, parseSourceInput, videoIdFromUrl } from '../src/youtube';
import { isNewer } from '../src/ytdlpManager';

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
 <link rel="self" href="http://www.youtube.com/feeds/videos.xml?channel_id=UCabcdefghijklmnopqrstuv"/>
 <id>yt:channel:abcdefghijklmnopqrstuv</id>
 <yt:channelId>abcdefghijklmnopqrstuv</yt:channelId>
 <title>Tom &amp; Jerry&#39;s Lab</title>
 <author><name>Tom &amp; Jerry</name><uri>https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv</uri></author>
 <entry>
  <id>yt:video:AAAAAAAAAAA</id>
  <yt:videoId>AAAAAAAAAAA</yt:videoId>
  <title>Building a &quot;thing&quot; &lt;part 1&gt;</title>
  <link rel="alternate" href="https://www.youtube.com/watch?v=AAAAAAAAAAA"/>
  <author><name>Tom &amp; Jerry</name><uri>https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv</uri></author>
  <published>2026-11-10T12:00:00+00:00</published>
  <media:group>
   <media:title>Building a thing</media:title>
   <media:thumbnail url="https://i1.ytimg.com/vi/AAAAAAAAAAA/hqdefault.jpg" width="480" height="360"/>
  </media:group>
 </entry>
 <entry>
  <id>yt:video:BBBBBBBBBBB</id>
  <yt:videoId>BBBBBBBBBBB</yt:videoId>
  <title>Quick tip #shorts</title>
  <link href="https://www.youtube.com/shorts/BBBBBBBBBBB" rel="alternate"/>
  <published>2026-11-09T12:00:00+00:00</published>
 </entry>
</feed>`;

function subscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: 'sub', kind: 'channel', sourceId: 'UCabcdefghijklmnopqrstuv', name: 'Lab', url: '', folder: 'YouTube/Lab',
    mode: 'manual', downloadType: 'video', format: 'any', quality: 'best', titleInclude: '', titleExclude: '',
    skipShorts: false, enabled: true, createdAt: '', lastCheckedAt: null, lastError: null, ...overrides,
  };
}

function video(overrides: Partial<Video> = {}): Video {
  return {
    id: 'AAAAAAAAAAA', subscriptionId: 'sub', title: 'T', channel: 'C', url: 'https://www.youtube.com/watch?v=AAAAAAAAAAA',
    thumbnail: '', publishedAt: null, isShort: false, status: 'queued', note: null, progress: null, filename: null,
    sentAt: null, foundAt: '', updatedAt: '', ...overrides,
  };
}

test('parseFeed reads entries, decodes entities and flags Shorts', () => {
  const feed = parseFeed(FEED);
  assert.equal(feed.title, "Tom & Jerry's Lab");
  assert.equal(feed.ownerChannelId, 'UCabcdefghijklmnopqrstuv');
  assert.equal(feed.ownerName, 'Tom & Jerry');
  assert.equal(feed.entries.length, 2);
  const [first, second] = feed.entries;
  assert.equal(first.videoId, 'AAAAAAAAAAA');
  assert.equal(first.title, 'Building a "thing" <part 1>');
  assert.equal(first.channel, 'Tom & Jerry');
  assert.equal(first.thumbnail, 'https://i1.ytimg.com/vi/AAAAAAAAAAA/hqdefault.jpg');
  assert.equal(first.isShort, false);
  assert.equal(second.isShort, true);
  assert.equal(second.url, 'https://www.youtube.com/shorts/BBBBBBBBBBB');
  assert.equal(second.channel, "Tom & Jerry's Lab");
  assert.equal(second.thumbnail, 'https://i.ytimg.com/vi/BBBBBBBBBBB/hqdefault.jpg');
});

test('parseSourceInput recognizes ids and URLs that carry them', () => {
  assert.deepEqual(parseSourceInput('UCabcdefghijklmnopqrstuv'), { kind: 'channel', sourceId: 'UCabcdefghijklmnopqrstuv' });
  assert.deepEqual(parseSourceInput('https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv/videos'), { kind: 'channel', sourceId: 'UCabcdefghijklmnopqrstuv' });
  assert.deepEqual(parseSourceInput('https://www.youtube.com/playlist?list=PLxyz1234567890abcd'), { kind: 'playlist', sourceId: 'PLxyz1234567890abcd' });
  assert.deepEqual(parseSourceInput('youtube.com/watch?v=AAAAAAAAAAA&list=PLxyz1234567890abcd'), { kind: 'playlist', sourceId: 'PLxyz1234567890abcd' });
  assert.equal(parseSourceInput('https://www.youtube.com/@somehandle'), null);
  assert.equal(parseSourceInput('@somehandle'), null);
});

test('videoIdFromUrl handles watch, shorts and short links', () => {
  assert.equal(videoIdFromUrl('https://www.youtube.com/watch?v=AAAAAAAAAAA&t=10'), 'AAAAAAAAAAA');
  assert.equal(videoIdFromUrl('https://www.youtube.com/shorts/BBBBBBBBBBB'), 'BBBBBBBBBBB');
  assert.equal(videoIdFromUrl('https://youtu.be/CCCCCCCCCCC'), 'CCCCCCCCCCC');
  assert.equal(videoIdFromUrl('https://example.com/'), null);
});

test('filterReason applies Shorts and case-insensitive title filters', () => {
  const entry = { videoId: 'x', title: 'Live Stream Replay', channel: '', url: '', thumbnail: '', publishedAt: null, isShort: false };
  assert.equal(filterReason(subscription(), entry), null);
  assert.equal(filterReason(subscription({ skipShorts: true }), { ...entry, isShort: true }), 'Short');
  assert.equal(filterReason(subscription({ titleExclude: 'live' }), entry), 'Title matches the exclude filter');
  assert.equal(filterReason(subscription({ titleInclude: 'tutorial' }), entry), 'Title does not match the include filter');
  assert.equal(filterReason(subscription({ titleInclude: 'stream|tutorial' }), entry), null);
});

test('normalizeFolder trims slashes and refuses parent segments', () => {
  assert.equal(normalizeFolder('/YouTube//Lab/ '), 'YouTube/Lab');
  assert.equal(normalizeFolder('a\\b'), 'a/b');
  assert.throws(() => normalizeFolder('../etc'), /\.\./);
});

test('validateDownloadOptions rejects mismatched formats', () => {
  assert.doesNotThrow(() => validateDownloadOptions({ downloadType: 'audio', format: 'mp3', quality: 'best' }));
  assert.throws(() => validateDownloadOptions({ downloadType: 'audio', format: 'mp4', quality: 'best' }));
  assert.throws(() => validateDownloadOptions({ downloadType: 'video', format: 'any', quality: '999' }));
});

test('buildYtdlpArgs maps quality, format and folder', () => {
  const args = buildYtdlpArgs({ video: video(), subscription: subscription({ quality: '1080', format: 'mp4' }) }, '/downloads', ['--cookies', 'c.txt']);
  assert.ok(args.includes('res:1080'));
  assert.ok(args.includes('--progress'), 'progress lines must survive --print');
  assert.equal(args[args.indexOf('--js-runtimes') + 1], `node:${process.execPath}`);
  assert.ok(args.includes('--merge-output-format'));
  assert.ok(args[args.indexOf('-o') + 1].startsWith('/downloads/YouTube/Lab/'));
  assert.deepEqual(args.slice(-3), ['--cookies', 'c.txt', 'https://www.youtube.com/watch?v=AAAAAAAAAAA']);

  const audio = buildYtdlpArgs({ video: video(), subscription: subscription({ downloadType: 'audio', format: 'mp3' }) }, '/downloads', []);
  assert.ok(audio.includes('-x'));
  assert.equal(audio[audio.indexOf('--audio-format') + 1], 'mp3');
});

test('indexHistory keeps the latest finished attempt per video', () => {
  const { active, done } = indexHistory({
    queue: [{ url: 'https://www.youtube.com/watch?v=QQQQQQQQQQQ', status: 'downloading', percent: 40 }],
    done: [
      { url: 'https://www.youtube.com/watch?v=AAAAAAAAAAA', status: 'error', msg: 'old', timestamp: 1 },
      { url: 'https://www.youtube.com/watch?v=AAAAAAAAAAA', status: 'finished', filename: 'a.mp4', timestamp: 2 },
    ],
  });
  assert.equal(active.get('QQQQQQQQQQQ')?.percent, 40);
  assert.equal(done.get('AAAAAAAAAAA')?.status, 'finished');
});

test('isNewer compares yt-dlp date versions', () => {
  assert.equal(isNewer('2026.11.02', '2026.10.26'), true);
  assert.equal(isNewer('2026.10.26.1', '2026.10.26'), true);
  assert.equal(isNewer('2026.10.26', '2026.10.26'), false);
  assert.equal(isNewer('2025.12.01', '2026.01.01'), false);
});

test('an auto-download playlist claims videos still undecided under the channel', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'youtubaar-test-'));
  const store = Store.open(dir);
  const channel = subscription({ id: 'channel', mode: 'manual' });
  const playlist = subscription({ id: 'playlist', kind: 'playlist', sourceId: 'PLxyz1234567890abcd', mode: 'auto', folder: 'Lab/Best of' });
  store.data.subscriptions.push(channel, playlist);
  store.data.videos = {
    AAAAAAAAAAA: video({ id: 'AAAAAAAAAAA', subscriptionId: 'channel', status: 'available' }),
    BBBBBBBBBBB: video({ id: 'BBBBBBBBBBB', subscriptionId: 'channel', status: 'ignored', note: null }),
    CCCCCCCCCCC: video({ id: 'CCCCCCCCCCC', subscriptionId: 'channel', status: 'ignored', note: 'Short' }),
    DDDDDDDDDDD: video({ id: 'DDDDDDDDDDD', subscriptionId: 'channel', status: 'done' }),
  };
  const library = new Library(store, loadConfig({ DATA_DIR: dir }), () => 'yt-dlp');
  const entry = (id: string) => ({ videoId: id, title: 'T', channel: 'C', url: `https://www.youtube.com/watch?v=${id}`, thumbnail: '', publishedAt: null, isShort: false });
  const ingest = (library as unknown as { ingest: (s: Subscription, e: unknown[], p: string) => number }).ingest.bind(library);

  ingest(playlist, ['AAAAAAAAAAA', 'BBBBBBBBBBB', 'CCCCCCCCCCC', 'DDDDDDDDDDD'].map(entry), 'follow-mode');
  const videos = store.data.videos;
  assert.equal(videos.AAAAAAAAAAA.status, 'queued');
  assert.equal(videos.AAAAAAAAAAA.subscriptionId, 'playlist');
  assert.equal(videos.BBBBBBBBBBB.status, 'ignored', 'ignored by the user stays ignored');
  assert.equal(videos.CCCCCCCCCCC.status, 'queued', 'skipped only by the channel filter');
  assert.equal(videos.DDDDDDDDDDD.status, 'done');
  fs.rmSync(dir, { recursive: true, force: true });
});
