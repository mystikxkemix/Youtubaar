import { timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { Config } from './config';
import { NotFoundError, type Library, type SubscriptionInput, type VideoAction } from './library';
import { VIDEO_STATUSES, type VideoStatus } from './types';
import type { YtdlpStatus } from './ytdlpManager';

/** What the API needs to show and trigger yt-dlp updates. */
export interface YtdlpControl {
  status(): Promise<YtdlpStatus>;
  update(): Promise<{ before: string | null; after: string | null }>;
}

const MAX_BODY_BYTES = 1024 * 1024;
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

type Handler = (context: { params: string[]; query: URLSearchParams; body: unknown }) => Promise<unknown> | unknown;

interface Route {
  method: string;
  pattern: RegExp;
  handler: Handler;
}

function sendJson(response: http.ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(body);
}

async function readJson(request: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) {
      throw new HttpError(413, 'Request body too large');
    }
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) {
    return {};
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
}

function isAuthorized(request: http.IncomingMessage, config: Config): boolean {
  if (config.authPassword === '') {
    return true;
  }
  const header = request.headers.authorization ?? '';
  if (!header.startsWith('Basic ')) {
    return false;
  }
  const expected = Buffer.from(`${config.authUser}:${config.authPassword}`);
  const given = Buffer.from(Buffer.from(header.slice(6), 'base64').toString('utf8'));
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function parseStatuses(raw: string | null): VideoStatus[] | undefined {
  if (raw === null || raw === '' || raw === 'all') {
    return undefined;
  }
  const statuses = raw.split(',') as VideoStatus[];
  for (const status of statuses) {
    if (!VIDEO_STATUSES.includes(status)) {
      throw new HttpError(400, `Unknown status "${status}"`);
    }
  }
  return statuses;
}

function serveStatic(config: Config, pathname: string, response: http.ServerResponse): void {
  const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = path.resolve(config.publicDir, relative);
  if (!file.startsWith(config.publicDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    sendJson(response, 404, { error: 'Not found' });
    return;
  }
  response.writeHead(200, {
    'Content-Type': CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream',
    'Cache-Control': 'no-cache',
  });
  fs.createReadStream(file).pipe(response);
}

export function createServer(config: Config, library: Library, downloaderName: string, ytdlp: YtdlpControl): http.Server {
  const routes: Route[] = [];
  const route = (method: string, pattern: string, handler: Handler): void => {
    routes.push({ method, pattern: new RegExp(`^${pattern}$`), handler });
  };

  route('GET', '/api/status', () => ({
    downloader: downloaderName,
    pollIntervalMinutes: config.pollIntervalMinutes,
    lastPollAt: library.lastPoll,
    nextPollAt: library.nextPollAt,
    checking: library.isChecking,
    counts: library.counts().total,
  }));

  route('GET', '/api/ytdlp', () => ytdlp.status());

  route('POST', '/api/ytdlp/update', async () => {
    try {
      return await ytdlp.update();
    } catch (error) {
      throw new HttpError(409, (error as Error).message);
    }
  });

  route('GET', '/api/subscriptions', () => {
    const stats = library.subscriptionStats();
    return library.subscriptions.map((subscription) => ({ ...subscription, ...stats[subscription.id] }));
  });

  route('GET', '/api/channels/(UC[\\w-]{22})/playlists', ({ params }) => library.channelPlaylists(params[0]));

  route('POST', '/api/lookup', async ({ body }) => library.lookup(String((body as { url?: unknown }).url ?? '')));

  route('POST', '/api/subscriptions', async ({ body }) => library.addSubscription(body as SubscriptionInput));

  route('PATCH', '/api/subscriptions/([\\w-]+)', ({ params, body }) => library.updateSubscription(params[0], body as SubscriptionInput));

  route('DELETE', '/api/subscriptions/([\\w-]+)', ({ params }) => {
    library.deleteSubscription(params[0]);
    return { ok: true };
  });

  route('POST', '/api/subscriptions/([\\w-]+)/check', async ({ params }) => {
    const subscription = library.getSubscription(params[0]);
    const added = await library.checkSubscription(subscription);
    if (subscription.lastError !== null) {
      throw new HttpError(502, subscription.lastError);
    }
    return { added };
  });

  route('POST', '/api/subscriptions/([\\w-]+)/backlog', async ({ params }) => ({ added: await library.loadBacklog(params[0]) }));

  route('POST', '/api/subscriptions/([\\w-]+)/organize', async ({ params }) => library.organizeForJellyfin(params[0]));

  route('POST', '/api/check', async () => ({ added: await library.checkAll() }));

  route('GET', '/api/videos', ({ query }) =>
    library.listVideos({
      statuses: parseStatuses(query.get('status')),
      subscriptionId: query.get('subscription') ?? undefined,
      search: query.get('q') ?? undefined,
      sortBy: query.get('sort') === 'updated' ? 'updated' : 'published',
      limit: Math.min(Number.parseInt(query.get('limit') ?? '120', 10) || 120, 1000),
      offset: Math.max(Number.parseInt(query.get('offset') ?? '0', 10) || 0, 0),
    }),
  );

  route('POST', '/api/videos/actions', ({ body }) => {
    const { ids, action } = body as { ids?: unknown; action?: VideoAction };
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
      throw new HttpError(400, '"ids" must be a list of video ids');
    }
    return { changed: library.applyAction(ids as string[], action as VideoAction) };
  });

  return http.createServer(async (request, response) => {
    try {
      if (!isAuthorized(request, config)) {
        response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Youtubaar"' });
        response.end();
        return;
      }
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (!url.pathname.startsWith('/api/')) {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          throw new HttpError(405, 'Method not allowed');
        }
        serveStatic(config, url.pathname, response);
        return;
      }
      for (const candidate of routes) {
        const match = candidate.method === request.method ? url.pathname.match(candidate.pattern) : null;
        if (match !== null) {
          const body = request.method === 'GET' || request.method === 'DELETE' ? {} : await readJson(request);
          const result = await candidate.handler({ params: match.slice(1), query: url.searchParams, body });
          sendJson(response, 200, result);
          return;
        }
      }
      throw new HttpError(404, 'Unknown API route');
    } catch (error) {
      const status = error instanceof HttpError ? error.status : error instanceof NotFoundError ? 404 : 400;
      sendJson(response, status, { error: (error as Error).message });
    }
  });
}
