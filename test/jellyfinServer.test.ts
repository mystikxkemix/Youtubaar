import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { JellyfinRefresher } from '../src/jellyfinServer';

/** A fake Jellyfin that knows one locked series and records the requests it gets. */
async function fakeJellyfin(token: string): Promise<{ url: string; calls: string[]; locks: boolean[]; close: () => void }> {
  const calls: string[] = [];
  const locks: boolean[] = [];
  let locked = true;
  const json = (response: http.ServerResponse, payload: unknown): void => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(payload));
  };
  const server = http.createServer(async (request, response) => {
    calls.push(`${request.method} ${request.url}`);
    if (request.headers.authorization !== `MediaBrowser Token="${token}"`) {
      response.writeHead(401).end();
      return;
    }
    if (request.url?.startsWith('/Items?')) {
      json(response, { Items: [{ Id: 'other', Name: 'Blake Manor (fan cut)' }, { Id: 'abc123', Name: 'Blake Manor' }] });
    } else if (request.url === '/Users') {
      json(response, [{ Id: 'viewer', Policy: { IsAdministrator: false } }, { Id: 'admin', Policy: { IsAdministrator: true } }]);
    } else if (request.url === '/Users/admin/Items/abc123') {
      json(response, { Id: 'abc123', Name: 'Blake Manor', LockData: locked });
    } else if (request.method === 'POST' && request.url === '/Items/abc123') {
      let body = '';
      for await (const chunk of request) body += chunk;
      const item = JSON.parse(body) as { Name: string; LockData: boolean };
      assert.equal(item.Name, 'Blake Manor', 'the whole item is sent back');
      locked = item.LockData;
      locks.push(locked);
      response.writeHead(204).end();
    } else {
      response.writeHead(204).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, calls, locks, close: () => server.close() };
}

test('JellyfinRefresher unlocks the series with the exact show name, refreshes it keeping images, then locks it again', async () => {
  const jellyfin = await fakeJellyfin('key');
  const refresher = new JellyfinRefresher(jellyfin.url, 'key', 10, () => undefined, 20);
  await refresher.refreshShow('Blake Manor');
  const refresh = jellyfin.calls.findIndex((call) => call.includes('/Refresh?'));
  assert.match(jellyfin.calls[refresh], /^POST \/Items\/abc123\/Refresh\?Recursive=true&MetadataRefreshMode=FullRefresh&ImageRefreshMode=Default&ReplaceAllMetadata=true&ReplaceAllImages=false$/);
  assert.equal(jellyfin.calls.indexOf('POST /Items/abc123') < refresh, true, 'unlocked before the refresh');
  assert.deepEqual(jellyfin.locks, [false]);
  for (let i = 0; i < 50 && jellyfin.locks.length < 2; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.deepEqual(jellyfin.locks, [false, true]);
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
  const refresher = new JellyfinRefresher(jellyfin.url, 'key', 40, () => undefined, 10);
  refresher.episodesPlaced('Blake Manor');
  refresher.episodesPlaced('Blake Manor');
  refresher.episodesPlaced('Blake Manor');
  assert.equal(jellyfin.calls.length, 0);
  for (let i = 0; i < 100 && refresher.status().lastRefreshAt === null; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(jellyfin.calls.filter((call) => call.includes('/Refresh')).length, 1);
  await new Promise((resolve) => setTimeout(resolve, 50));
  jellyfin.close();
});
