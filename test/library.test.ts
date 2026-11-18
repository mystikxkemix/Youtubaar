import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { deleteDownloadFiles } from '../src/library';

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
