import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildYtdlpArgs, tidyStem } from '../src/downloaders/ytdlp';
import { airDate, episodeNfo, episodeNumber, kodiBaseName, placeEpisode, showNfo, type VideoMetadata } from '../src/jellyfin';
import { fileSlug } from '../src/rules';
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

test('placeEpisode gives Kodi names, numbers episodes within a day, and is stable on rerun', async () => {
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
  assert.equal(path.basename(placedFirst), 'Tom_Jerry_S2026E111701_Cats_vs_Dogs_more.mp4');
  assert.equal(path.basename(placedSecond), 'Tom_Jerry_S2026E111702_Other_one.mp4');
  assert.deepEqual(fs.readdirSync(season).sort(), [
    'Tom_Jerry_S2026E111701_Cats_vs_Dogs_more-thumb.jpg',
    'Tom_Jerry_S2026E111701_Cats_vs_Dogs_more.mp4',
    'Tom_Jerry_S2026E111701_Cats_vs_Dogs_more.nfo',
    'Tom_Jerry_S2026E111702_Other_one.mp4',
    'Tom_Jerry_S2026E111702_Other_one.nfo',
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
  assert.equal(path.relative(show, placed), path.join('Season_2025', 'mistermv_S2025E112401_LE_MYSTERE_DE_LA_PARTIE_DE_BRIDGE_The_Seance_03.mp4'));
  assert.ok(!fs.existsSync(old));
  fs.rmSync(show, { recursive: true, force: true });
});

test('kodiBaseName and fileSlug keep names short and plain', () => {
  assert.equal(kodiBaseName('Zelda OoT', 1, 2, 'Bides & musiques (02)'), 'Zelda_OoT_S01E02_Bides_musiques_02');
  assert.equal(fileSlug('Cool Down Your Room... With a FRIDGE?', 100), 'Cool_Down_Your_Room_With_a_FRIDGE');
  assert.equal(fileSlug('one two three four five', 12), 'one_two');
});

test('buildYtdlpArgs puts Jellyfin downloads in year seasons with a thumbnail sidecar', () => {
  const args = buildYtdlpArgs({ video, subscription }, '/downloads', []);
  const outputs = args.flatMap((arg, index) => (args[index - 1] === '-o' ? [arg] : []));
  assert.equal(outputs[0], '/downloads/YouTube/Tom_Jerry/Season_%(upload_date>%Y)s/%(upload_date>%Y-%m-%d)s_%(title)s_%(id)s.%(ext)s');
  assert.equal(outputs[1], 'thumbnail:/downloads/YouTube/Tom_Jerry/Season_%(upload_date>%Y)s/%(upload_date>%Y-%m-%d)s_%(title)s_%(id)s-thumb.%(ext)s');
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
  const args = buildYtdlpArgs({ video: { ...video, position: 3 }, subscription: playlist }, '/downloads', []);
  assert.ok(args.includes('/downloads/mistermv_Zelda_OoT/Season_01/%(upload_date>%Y-%m-%d)s_%(title)s_%(id)s.%(ext)s'));

  const show = fs.mkdtempSync(path.join(os.tmpdir(), 'youtubaar-pl-'));
  fs.mkdirSync(path.join(show, 'Season_01'));
  const media = path.join(show, 'Season_01', '2026-11-13_Part_3_AAAAAAAAAAA.mp4');
  fs.writeFileSync(media, '');
  const placed = await placeEpisode(media, show, meta, playlist, 3);
  assert.equal(path.basename(placed), 'Zelda_OoT_S01E03_Cats_vs_Dogs_more.mp4');
  const xml = fs.readFileSync(placed.replace('.mp4', '.nfo'), 'utf8');
  assert.match(xml, /<season>1<\/season>/);
  assert.match(xml, /<episode>3<\/episode>/);
  assert.match(xml, /<showtitle>Zelda OoT<\/showtitle>/);
  fs.rmSync(show, { recursive: true, force: true });
});
