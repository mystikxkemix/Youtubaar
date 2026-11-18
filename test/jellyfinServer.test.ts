import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { JellyfinRefresher } from '../src/jellyfinServer';

/** A fake Jellyfin that knows one series and records the requests it gets. */
async function fakeJellyfin(token: string): Promise<{ url: string; calls: string[]; close: () => void }> {
  const calls: string[] = [];
  const server = http.createServer((request, response) => {
    calls.push(`${request.method} ${request.url}`);
    if (request.headers.authorization !== `MediaBrowser Token="${token}"`) {
      response.writeHead(401).end();
      return;
    }
    if (request.url?.startsWith('/Items?')) {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ Items: [{ Id: 'other', Name: 'Blake Manor (fan cut)' }, { Id: 'abc123', Name: 'Blake Manor' }] }));
      return;
    }
    response.writeHead(204).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, calls, close: () => server.close() };
}

test('JellyfinRefresher refreshes the series with the exact show name, keeping images', async () => {
  const jellyfin = await fakeJellyfin('key');
  const refresher = new JellyfinRefresher(jellyfin.url, 'key', 10, () => undefined);
  await refresher.refreshShow('Blake Manor');
  assert.equal(jellyfin.calls.length, 2);
  assert.match(jellyfin.calls[1], /^POST \/Items\/abc123\/Refresh\?Recursive=true&MetadataRefreshMode=FullRefresh&ImageRefreshMode=Default&ReplaceAllMetadata=true&ReplaceAllImages=false$/);
  assert.equal(refresher.status().lastRefreshed, 'Blake Manor');
  assert.equal(refresher.status().lastError, null);

  // A show Jellyfin does not know yet: a library scan adds it.
  await refresher.refreshShow('New show');
  assert.equal(jellyfin.calls[jellyfin.calls.length - 1], 'POST /Library/Refresh');
  jellyfin.close();
});

test('JellyfinRefresher reports a wrong key and does nothing when not configured', async () => {
  const jellyfin = await fakeJellyfin('key');
  const wrong = new JellyfinRefresher(jellyfin.url, 'bad', 10, () => undefined);
  await wrong.refreshShow('Blake Manor');
  assert.equal(wrong.status().lastError, 'Jellyfin refused the API key (HTTP 401)');

  const off = new JellyfinRefresher('', '', 10, () => undefined);
  off.episodesPlaced('Blake Manor');
  assert.equal(off.status().configured, false);
  jellyfin.close();
});

test('JellyfinRefresher waits for the last placed episode before refreshing once', async () => {
  const jellyfin = await fakeJellyfin('key');
  const refresher = new JellyfinRefresher(jellyfin.url, 'key', 40, () => undefined);
  refresher.episodesPlaced('Blake Manor');
  refresher.episodesPlaced('Blake Manor');
  refresher.episodesPlaced('Blake Manor');
  assert.equal(jellyfin.calls.length, 0);
  for (let i = 0; i < 100 && refresher.status().lastRefreshAt === null; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(jellyfin.calls.filter((call) => call.includes('/Refresh')).length, 1);
  jellyfin.close();
});
