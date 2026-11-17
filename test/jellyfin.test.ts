import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildYtdlpArgs } from '../src/downloaders/ytdlp';
import { airDate, episodeNfo, episodeNumber, showNfo, writeEpisodeMetadata, type VideoMetadata } from '../src/jellyfin';
import type { Subscription, Video } from '../src/types';

const subscription: Subscription = {
  id: 'sub', kind: 'channel', sourceId: 'UCabcdefghijklmnopqrstuv', name: 'Tom & Jerry', url: '', folder: 'YouTube/Tom & Jerry',
  mode: 'manual', downloadType: 'video', format: 'any', quality: 'best', titleInclude: '', titleExclude: '',
  skipShorts: false, jellyfin: true, enabled: true, createdAt: '', lastCheckedAt: null, lastError: null,
};

const video: Video = {
  id: 'AAAAAAAAAAA', subscriptionId: 'sub', title: 'T', channel: 'C', url: 'https://www.youtube.com/watch?v=AAAAAAAAAAA',
  thumbnail: '', publishedAt: null, isShort: false, status: 'queued', note: null, progress: null, filename: null,
  sentAt: null, foundAt: '', updatedAt: '',
};

const meta: VideoMetadata = {
  id: 'AAAAAAAAAAA',
  title: 'Cats <vs> "Dogs" & more',
  description: 'Line one\nLine two',
  upload_date: '20261117',
  duration: 754,
  channel: 'Tom & Jerry',
  tags: ['cats', 'dogs'],
};

test('episodeNfo escapes text and carries season, episode and air date', () => {
  const xml = episodeNfo(meta, 'Tom & Jerry', 2026, 111701);
  assert.match(xml, /<title>Cats &lt;vs&gt; &quot;Dogs&quot; &amp; more<\/title>/);
  assert.match(xml, /<season>2026<\/season>/);
  assert.match(xml, /<episode>111701<\/episode>/);
  assert.match(xml, /<aired>2026-11-17<\/aired>/);
  assert.match(xml, /<runtime>13<\/runtime>/);
  assert.match(xml, /<uniqueid type="youtube" default="true">AAAAAAAAAAA<\/uniqueid>/);
  assert.match(xml, /<plot>Line one\nLine two<\/plot>/);
  assert.equal(airDate({ id: 'x', upload_date: null }), null);
  assert.equal(episodeNumber('2026-01-05', 3), 10503);
});

test('showNfo locks the show so Jellyfin does not match it against TV databases', () => {
  const xml = showNfo(subscription);
  assert.match(xml, /<title>Tom &amp; Jerry<\/title>/);
  assert.match(xml, /<lockdata>true<\/lockdata>/);
});

test('writeEpisodeMetadata numbers episodes within a day and keeps a number on rewrite', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'youtubaar-jf-'));
  const first = path.join(dir, '2026-11-17 - First [AAAAAAAAAAA].mp4');
  const second = path.join(dir, '2026-11-17 - Second [BBBBBBBBBBB].mp4');
  fs.writeFileSync(first, '');
  fs.writeFileSync(second, '');
  await writeEpisodeMetadata(first, meta, subscription);
  await writeEpisodeMetadata(second, { ...meta, id: 'BBBBBBBBBBB' }, subscription);
  await writeEpisodeMetadata(first, meta, subscription);
  assert.match(fs.readFileSync(first.replace('.mp4', '.nfo'), 'utf8'), /<episode>111701<\/episode>/);
  assert.match(fs.readFileSync(second.replace('.mp4', '.nfo'), 'utf8'), /<episode>111702<\/episode>/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('buildYtdlpArgs puts Jellyfin downloads in year seasons with a thumbnail sidecar', () => {
  const args = buildYtdlpArgs({ video, subscription }, '/downloads', []);
  const outputs = args.flatMap((arg, index) => (args[index - 1] === '-o' ? [arg] : []));
  assert.equal(outputs[0], '/downloads/YouTube/Tom & Jerry/Season %(upload_date>%Y)s/%(upload_date>%Y-%m-%d)s - %(title)s [%(id)s].%(ext)s');
  assert.equal(outputs[1], 'thumbnail:/downloads/YouTube/Tom & Jerry/Season %(upload_date>%Y)s/%(upload_date>%Y-%m-%d)s - %(title)s [%(id)s]-thumb.%(ext)s');
  assert.ok(args.includes('--write-thumbnail'));

  const plain = buildYtdlpArgs({ video, subscription: { ...subscription, jellyfin: false } }, '/downloads', []);
  assert.ok(!plain.includes('--write-thumbnail'));
});
