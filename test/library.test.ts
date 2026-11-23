import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { deleteDownloadFiles, refreshVideoInfo } from '../src/library';
import type { Video } from '../src/types';
import { isMissingTitle, type FeedEntry } from '../src/youtube';

test('deleteDownloadFiles removes the video and its Jellyfin files, nothing else', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'youtubaar-del-'));
  const season = path.join(root, 'Show', 'Season_01');
  fs.mkdirSync(season, { recursive: true });
  for (const name of ['Show_S01E05_Title.webm', 'Show_S01E05_Title.nfo', 'Show_S01E05_Title-thumb.jpg', 'Show_S01E06_Other.webm']) {
    fs.writeFileSync(path.join(season, name), '');
  }
  assert.equal(await deleteDownloadFiles(root, 'Show/Season_01/Show_S01E05_Title.webm'), 3);
  assert.deepEqual(fs.readdirSync(season), ['Show_S01E06_Other.webm']);
  // Already gone: not an error.
  assert.equal(await deleteDownloadFiles(root, 'Show/Season_01/Show_S01E05_Title.webm'), 0);
  fs.rmSync(root, { recursive: true, force: true });
});

test('deleteDownloadFiles refuses paths outside the download folder', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'youtubaar-del-'));
  await assert.rejects(deleteDownloadFiles(root, '../outside.mp4'), /outside the download folder/);
  await assert.rejects(deleteDownloadFiles(root, '/etc/passwd'), /outside the download folder/);
  fs.rmSync(root, { recursive: true, force: true });
});

function privateVideo(): Video {
  return {
    id: 'abcdefghijk', subscriptionId: 'sub', title: 'abcdefghijk', channel: 'Chan',
    url: 'https://www.youtube.com/watch?v=abcdefghijk', thumbnail: '', publishedAt: null, isShort: false,
    status: 'failed', note: 'Private video', progress: null, filename: null, sentAt: null, position: 3,
    foundAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function listed(title: string, publishedAt: string | null = null): FeedEntry {
  return { videoId: 'abcdefghijk', title, channel: 'Chan', url: '', thumbnail: '', publishedAt, isShort: false, position: 3 };
}

test('isMissingTitle spots the id and the yt-dlp placeholders, not real titles', () => {
  assert.equal(isMissingTitle('abcdefghijk', 'abcdefghijk'), true);
  assert.equal(isMissingTitle('[Private video]', 'abcdefghijk'), true);
  assert.equal(isMissingTitle('  ', 'abcdefghijk'), true);
  assert.equal(isMissingTitle('Episode 3', 'abcdefghijk'), false);
});

test('refreshVideoInfo fills a title and date missing when the video was private', () => {
  const video = privateVideo();
  assert.equal(refreshVideoInfo(video, listed('Episode 3', '2026-11-20T18:00:00+00:00')), true);
  assert.equal(video.title, 'Episode 3');
  assert.equal(video.publishedAt, '2026-11-20T18:00:00+00:00');
  assert.notEqual(video.updatedAt, '2026-01-01T00:00:00.000Z');
});

test('refreshVideoInfo keeps waiting while the listing has no title yet', () => {
  const video = privateVideo();
  assert.equal(refreshVideoInfo(video, listed('abcdefghijk')), false);
  assert.equal(refreshVideoInfo(video, listed('[Private video]')), false);
  assert.equal(video.title, 'abcdefghijk');
  assert.equal(video.updatedAt, '2026-01-01T00:00:00.000Z');
});

test('refreshVideoInfo never replaces a real title or date', () => {
  const video = { ...privateVideo(), title: 'Episode 3', publishedAt: '2026-11-20T18:00:00+00:00' };
  assert.equal(refreshVideoInfo(video, listed('Episode 3 (renamed)', '2026-11-21T18:00:00+00:00')), false);
  assert.equal(video.title, 'Episode 3');
  assert.equal(video.publishedAt, '2026-11-20T18:00:00+00:00');
});
