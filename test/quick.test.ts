import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildQuickArgs, parseQuickInput, QuickDownloads } from '../src/quick';
import { attachmentHeader } from '../src/server';

/** A stand-in for yt-dlp: prints the lines Youtubaar reads and writes the file it names. */
function fakeYtdlp(dir: string, exitCode = 0): string {
  const script = path.join(dir, 'fake-yt-dlp');
  fs.writeFileSync(script, `#!/usr/bin/env node
const args = process.argv.slice(2);
const output = args[args.indexOf('-o') + 1].replace('%(id)s', 'abc').replace('%(ext)s', 'mp4');
console.log('YOUTUBAAR_QUICK_INFO:' + JSON.stringify({ title: 'Été: "best" of/2026', thumbnail: 'https://i.ytimg.com/x.jpg', channel: 'Chan', duration: 61 }));
if (${exitCode} !== 0) { console.error('ERROR: Video unavailable'); process.exit(${exitCode}); }
require('fs').writeFileSync(output, 'video');
console.log('YOUTUBAAR_FILE:' + output);
`, { mode: 0o755 });
  return script;
}

async function waitFor(check: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !check(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test('parseQuickInput accepts links and rejects anything else', () => {
  assert.deepEqual(parseQuickInput({ url: ' https://youtu.be/abc ' }), { url: 'https://youtu.be/abc', kind: 'video', quality: '1080' });
  assert.equal(parseQuickInput({ url: 'https://youtu.be/abc', kind: 'audio' }).kind, 'audio');
  assert.throws(() => parseQuickInput({ url: 'not a link' }), /Paste the link/);
  assert.throws(() => parseQuickInput({ url: 'file:///etc/passwd' }), /Paste the link/);
  assert.throws(() => parseQuickInput({ url: 'https://youtu.be/abc', quality: '999' }), /quality/);
});

test('buildQuickArgs prefers MP4 that plays everywhere, or extracts M4A audio', () => {
  const video = buildQuickArgs({ url: 'https://youtu.be/abc', kind: 'video', quality: '720' }, '/dl/.quick/1', []);
  assert.ok(video.includes('res:720,vcodec:h264,acodec:aac'));
  assert.ok(video.includes('/dl/.quick/1/%(id)s.%(ext)s'));
  assert.equal(video[video.length - 1], 'https://youtu.be/abc');
  const audio = buildQuickArgs({ url: 'https://youtu.be/abc', kind: 'audio', quality: '1080' }, '/dl/.quick/1', ['--cookies', 'c.txt']);
  assert.ok(audio.includes('-x') && audio.includes('m4a') && audio.includes('--cookies'));
});

test('attachmentHeader keeps the readable name and gives an ASCII fallback', () => {
  assert.equal(attachmentHeader('Été "live".mp4'), `attachment; filename="Ete _live_.mp4"; filename*=UTF-8''%C3%89t%C3%A9%20%22live%22.mp4`);
});

test('a quick download is named after its title, then deleted when it expires', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'youtubaar-quick-'));
  const quick = new QuickDownloads(path.join(root, 'data'), path.join(root, 'downloads'), () => fakeYtdlp(root), [], 48, () => undefined);
  fs.mkdirSync(path.join(root, 'data'));
  await quick.start();
  assert.ok(fs.existsSync(path.join(quick.root, '.ignore')));

  const item = quick.add({ url: 'https://youtu.be/abc' });
  await waitFor(() => item.status !== 'downloading');
  assert.equal(item.status, 'ready');
  assert.equal(item.file, 'Été best of 2026.mp4');
  assert.equal(item.size, 5);
  assert.equal(item.title, 'Été: "best" of/2026');
  assert.ok(fs.existsSync(quick.filePath(item) ?? ''));
  const hoursLeft = (Date.parse(item.expiresAt) - Date.now()) / 3_600_000;
  assert.ok(hoursLeft > 47.9 && hoursLeft <= 48);

  // A folder no entry owns (e.g. left by a crash) goes too.
  fs.mkdirSync(path.join(quick.root, 'stray'));
  await quick.cleanup(new Date(Date.now() + 49 * 3_600_000));
  assert.equal(quick.list().length, 0);
  assert.deepEqual(fs.readdirSync(quick.root), ['.ignore']);
  quick.flush();
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'data', 'quick.json'), 'utf8')), []);
  fs.rmSync(root, { recursive: true, force: true });
});

test('a failed quick download keeps yt-dlp error for the page', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'youtubaar-quick-'));
  fs.mkdirSync(path.join(root, 'data'));
  const quick = new QuickDownloads(path.join(root, 'data'), path.join(root, 'downloads'), () => fakeYtdlp(root, 1), [], 48, () => undefined);
  const item = quick.add({ url: 'https://youtu.be/gone' });
  await waitFor(() => item.status !== 'downloading');
  assert.equal(item.status, 'failed');
  assert.equal(item.error, 'Video unavailable');
  assert.equal(quick.filePath(item), null);
  assert.equal(await quick.remove(item.id), true);
  assert.equal(await quick.remove(item.id), false);
  quick.flush();
  fs.rmSync(root, { recursive: true, force: true });
});
