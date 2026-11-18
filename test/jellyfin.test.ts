import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildYtdlpArgs, tidyStem } from '../src/downloaders/ytdlp';
import { airDate, episodeNfo, episodeNumber, isNewestFirst, episodeBaseName, placeEpisode, playlistEpisode, prepareIncoming, showNfo, type VideoMetadata } from '../src/jellyfin';
import { fileTitle } from '../src/rules';
import type { Subscription, Video } from '../src/types';

const subscription: Subscription = {
  id: 'sub', kind: 'channel', sourceId: 'UCabcdefghijklmnopqrstuv', name: 'Tom & Jerry', url: '', folder: 'YouTube/Tom_Jerry',
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

test('placeEpisode names files "SxxEyy - Title", numbers episodes within a day, and is stable on rerun', async () => {
  const show = fs.mkdtempSync(path.join(os.tmpdir(), 'youtubaar-jf-'));
  const season = path.join(show, 'Season_2026');
  fs.mkdirSync(season);
  const first = path.join(season, '2026-11-17_Cats_AAAAAAAAAAA.mp4');
  const second = path.join(season, '2026-11-17_Other_BBBBBBBBBBB.mp4');
  fs.writeFileSync(first, '');
  fs.writeFileSync(first.replace('.mp4', '-thumb.jpg'), '');
  fs.writeFileSync(second, '');

  const placedFirst = await placeEpisode(first, show, meta, subscription);
  const placedSecond = await placeEpisode(second, show, { ...meta, id: 'BBBBBBBBBBB', title: 'Other one' }, subscription);
  assert.equal(path.basename(placedFirst), 'S2026E111701 - Cats vs Dogs & more.mp4');
  assert.equal(path.basename(placedSecond), 'S2026E111702 - Other one.mp4');
  assert.deepEqual(fs.readdirSync(season).sort(), [
    'S2026E111701 - Cats vs Dogs & more-thumb.jpg',
    'S2026E111701 - Cats vs Dogs & more.mp4',
    'S2026E111701 - Cats vs Dogs & more.nfo',
    'S2026E111702 - Other one.mp4',
    'S2026E111702 - Other one.nfo',
  ]);
  // Placing again (e.g. "Organize for Jellyfin" twice) changes nothing.
  assert.equal(await placeEpisode(placedFirst, show, meta, subscription), placedFirst);
  assert.match(fs.readFileSync(placedFirst.replace('.mp4', '.nfo'), 'utf8'), /<episode>111701<\/episode>/);
  fs.rmSync(show, { recursive: true, force: true });
});

test('placeEpisode moves an older download from the show root into its season', async () => {
  const show = fs.mkdtempSync(path.join(os.tmpdir(), 'youtubaar-jf-'));
  const old = path.join(show, '2025-11-24_LE_MYSTERE_Y-QW67F2_Do.mp4');
  fs.writeFileSync(old, '');
  const placed = await placeEpisode(old, show, { id: 'Y-QW67F2_Do', title: 'LE MYSTÈRE DE LA PARTIE DE BRIDGE | The Séance (03)', upload_date: '20251124' }, { ...subscription, name: 'mistermv' });
  assert.equal(path.relative(show, placed), path.join('Season_2025', 'S2025E112401 - LE MYSTÈRE DE LA PARTIE DE BRIDGE The Séance (03).mp4'));
  assert.ok(!fs.existsSync(old));
  fs.rmSync(show, { recursive: true, force: true });
});

test('episodeBaseName and fileTitle keep titles readable and safe for any file system', () => {
  assert.equal(episodeBaseName(1, 2, 'Bides & musiques (02)'), 'S01E02 - Bides & musiques (02)');
  assert.equal(episodeBaseName(1, 2, ''), 'S01E02');
  assert.equal(fileTitle('Cool Down Your Room... With a FRIDGE?', 100), 'Cool Down Your Room... With a FRIDGE');
  assert.equal(fileTitle('AC/DC: "Live"  |  Paris', 100), 'AC DC Live Paris');
  assert.equal(fileTitle('one two three four five', 12), 'one two');
});

test('buildYtdlpArgs puts Jellyfin downloads in the hidden incoming folder with a thumbnail sidecar', () => {
  const args = buildYtdlpArgs({ video, subscription }, '/downloads', []);
  const outputs = args.flatMap((arg, index) => (args[index - 1] === '-o' ? [arg] : []));
  assert.equal(outputs[0], '/downloads/YouTube/Tom_Jerry/.incoming/%(upload_date>%Y-%m-%d)s_%(title)s_%(id)s.%(ext)s');
  assert.equal(outputs[1], 'thumbnail:/downloads/YouTube/Tom_Jerry/.incoming/%(upload_date>%Y-%m-%d)s_%(title)s_%(id)s-thumb.%(ext)s');
  assert.ok(args.includes('--restrict-filenames'));
  assert.ok(args.includes('--write-thumbnail'));

  const plain = buildYtdlpArgs({ video, subscription: { ...subscription, jellyfin: false } }, '/downloads', []);
  assert.ok(!plain.includes('--write-thumbnail'));
});

test('tidyStem leaves only letters, digits, underscores and dashes', () => {
  assert.equal(tidyStem('2026-11-14_Cool_Down_Your_Room..._With_a_FRIDGE_NKeZ_HRk_O8'), '2026-11-14_Cool_Down_Your_Room_With_a_FRIDGE_NKeZ_HRk_O8');
  assert.equal(tidyStem('2026-11-12_What_Is_Food_Fortification_Y1vEGsnNYek'), '2026-11-12_What_Is_Food_Fortification_Y1vEGsnNYek');
});

test('a playlist is one season in playlist order', async () => {
  const playlist: Subscription = { ...subscription, kind: 'playlist', sourceId: 'PLxyz1234567890abcd', name: 'Zelda OoT', folder: 'mistermv_Zelda_OoT' };
  const args = buildYtdlpArgs({ video: { ...video, position: 3 }, subscription: playlist, episode: 3 }, '/downloads', []);
  assert.ok(args.includes('/downloads/mistermv_Zelda_OoT/.incoming/%(upload_date>%Y-%m-%d)s_%(title)s_%(id)s.%(ext)s'));

  const show = fs.mkdtempSync(path.join(os.tmpdir(), 'youtubaar-pl-'));
  const incoming = await prepareIncoming(show);
  assert.ok(fs.existsSync(path.join(incoming, '.ignore')));
  const media = path.join(incoming, '2026-11-13_Part_3_AAAAAAAAAAA.mp4');
  fs.writeFileSync(media, '');
  fs.writeFileSync(path.join(incoming, '2026-11-13_Part_3_AAAAAAAAAAA-thumb.jpg'), '');
  const placed = await placeEpisode(media, show, meta, playlist, 3);
  assert.equal(path.relative(show, placed), path.join('Season_01', 'S01E03 - Cats vs Dogs & more.mp4'));
  assert.deepEqual(fs.readdirSync(incoming), ['.ignore']);
  const xml = fs.readFileSync(placed.replace('.mp4', '.nfo'), 'utf8');
  assert.match(xml, /<season>1<\/season>/);
  assert.match(xml, /<episode>3<\/episode>/);
  assert.match(xml, /<showtitle>Zelda OoT<\/showtitle>/);
  fs.rmSync(show, { recursive: true, force: true });
});

/** Playlist items in playlist order: place 1 has the first date. */
function items(dates: (string | null)[]): { position: number; publishedAt: string | null }[] {
  return dates.map((publishedAt, index) => ({ position: index + 1, publishedAt }));
}

test('isNewestFirst reads the playlist order from the upload dates', () => {
  assert.equal(isNewestFirst(items(['2025-11-01', '2025-11-02', '2025-11-03'])), false);
  assert.equal(isNewestFirst(items(['2025-12-10', '2025-12-05', '2025-11-29', '2025-11-20'])), true);
  // Undated videos (past the feed's latest 15) are skipped; a mostly-down order still counts.
  assert.equal(isNewestFirst(items(['2025-12-10', null, '2025-12-01', '2025-12-03', '2025-11-20'])), true);
  // No dates or a tie: keep the playlist order.
  assert.equal(isNewestFirst(items([null, null])), false);
  assert.equal(isNewestFirst(items(['2025-11-01', '2025-11-03', '2025-11-02'])), false);
});

test('playlistEpisode counts from the oldest end, and stays put when a part is added', () => {
  // The Blake Manor case: 15 parts, newest first, part (05) sits in place 11.
  const newestFirst = items(Array.from({ length: 15 }, (_, index) => `2025-12-${String(30 - index).padStart(2, '0')}`));
  assert.equal(playlistEpisode(11, newestFirst), 5);
  assert.equal(playlistEpisode(1, newestFirst), 15);
  assert.equal(playlistEpisode(15, newestFirst), 1);
  // A 16th part is added at the top: every place moves down by one, the numbers do not change.
  const withNewPart = items(['2025-12-31', ...newestFirst.map((item) => item.publishedAt)]);
  assert.equal(playlistEpisode(12, withNewPart), 5);

  const oldestFirst = items(['2025-11-01', '2025-11-02', '2025-11-03']);
  assert.equal(playlistEpisode(2, oldestFirst), 2);
  // The manual setting wins over the dates.
  assert.equal(playlistEpisode(1, oldestFirst, 'newest-first'), 3);
  assert.equal(playlistEpisode(11, newestFirst, 'oldest-first'), 11);
  assert.equal(playlistEpisode(null, oldestFirst), null);
});

test('placeEpisode renumbers an episode that was placed with the wrong number', async () => {
  const playlist: Subscription = { ...subscription, kind: 'playlist', sourceId: 'PLxyz1234567890abcd', name: 'Blake Manor', folder: 'Blake_Manor' };
  const show = fs.mkdtempSync(path.join(os.tmpdir(), 'youtubaar-renum-'));
  const season = path.join(show, 'Season_01');
  fs.mkdirSync(season);
  const media = path.join(season, 'Blake_Manor_S01E11_Cats_vs_Dogs_more.webm');
  fs.writeFileSync(media, '');
  fs.writeFileSync(path.join(season, 'Blake_Manor_S01E11_Cats_vs_Dogs_more.nfo'), '<episode>11</episode>');
  fs.writeFileSync(path.join(season, 'Blake_Manor_S01E11_Cats_vs_Dogs_more-thumb.jpg'), '');
  const placed = await placeEpisode(media, show, meta, playlist, 5);
  assert.equal(path.basename(placed), 'S01E05 - Cats vs Dogs & more.webm');
  assert.deepEqual(fs.readdirSync(season).sort(), [
    'S01E05 - Cats vs Dogs & more-thumb.jpg',
    'S01E05 - Cats vs Dogs & more.nfo',
    'S01E05 - Cats vs Dogs & more.webm',
  ]);
  assert.match(fs.readFileSync(placed.replace('.webm', '.nfo'), 'utf8'), /<episode>5<\/episode>/);
  fs.rmSync(show, { recursive: true, force: true });
});
