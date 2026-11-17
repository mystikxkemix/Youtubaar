'use strict';

/* =========================================================================
   Youtubaar UI: hash-routed pages (library, channel, inbox, activity,
   system, search) rendered from the JSON API, refreshed every few seconds.
   ========================================================================= */

const REFRESH_MS = 5000;
const PAGE_SIZE = 200;
/** The interface is in English, so dates follow it rather than the browser locale. */
const LOCALE = 'en-GB';

const ICONS = {
  library: 'M12 3 2 8l10 5 10-5zM2 16l10 5 10-5M2 12l10 5 10-5',
  inbox: 'M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z',
  activity: 'M22 12h-4l-3 9L9 3l-3 9H2',
  system: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3',
  refresh: 'M21 12a9 9 0 1 1-2.6-6.4L21 8M21 3v5h-5',
  download: 'M12 3v12M7 10l5 5 5-5M5 21h14',
  ignore: 'M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.1M6.6 6.6C3.9 8.4 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6',
  restore: 'M3 7v6h6M3 13a9 9 0 1 0 3-7.7L3 8',
  trash: 'M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  external: 'M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  rings: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  chevron: 'm6 9 6 6 6-6',
  pause: 'M8 5v14M16 5v14',
  play: 'M7 4v16l13-8z',
  folder: 'M3 6a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  archive: 'M3 4h18v4H3zM5 8v12h14V8M10 12h4',
  x: 'M18 6 6 18M6 6l12 12',
  film: 'M4 4h16v16H4zM8 4v16M16 4v16M4 9h4M4 15h4M16 9h4M16 15h4',
  music: 'M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  filter: 'M3 5h18l-7 8v6l-4 2v-8z',
  bolt: 'M13 2 3 14h9l-1 8 10-12h-9z',
  pick: 'M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
  playlist: 'M3 6h12M3 12h12M3 18h8M17 14v7l5-3.5z',
  channel: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM10 9v6l5-3z',
};

const STATUS_TEXT = { available: 'New', ignored: 'Ignored', queued: 'Queued', downloading: 'Downloading', done: 'Downloaded', failed: 'Failed' };

const CHANNEL_TABS = [
  { key: 'all', label: 'All', statuses: [] },
  { key: 'available', label: 'New', statuses: ['available'] },
  { key: 'active', label: 'Downloading', statuses: ['queued', 'downloading'] },
  { key: 'done', label: 'Downloaded', statuses: ['done'] },
  { key: 'failed', label: 'Failed', statuses: ['failed'] },
  { key: 'ignored', label: 'Ignored', statuses: ['ignored'] },
];

const FORMATS = {
  video: { formats: [['any', 'Best available'], ['mp4', 'MP4']], qualities: [['best', 'Best'], ['2160', '2160p'], ['1440', '1440p'], ['1080', '1080p'], ['720', '720p'], ['480', '480p'], ['360', '360p']] },
  audio: { formats: [['m4a', 'M4A'], ['mp3', 'MP3'], ['opus', 'Opus']], qualities: [['best', 'Best']] },
};

/* ---------- Preferences (per browser) ---------- */

const prefs = (() => {
  const defaults = { libraryView: 'rings', librarySort: 'name', libraryFilter: 'all', channelView: 'list' };
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem('youtubaar.prefs') ?? '{}'); } catch { /* private mode */ }
  const values = { ...defaults, ...stored };
  return {
    get: (key) => values[key],
    set: (key, value) => {
      values[key] = value;
      try { localStorage.setItem('youtubaar.prefs', JSON.stringify(values)); } catch { /* ignore */ }
    },
  };
})();

const state = {
  subscriptions: [],
  status: null,
  ytdlp: null,
  selected: new Set(),
  collapsed: new Map(),
  channelTab: 'all',
  inboxChannel: '',
  limit: PAGE_SIZE,
  route: null,
};

/* ---------- DOM helpers ---------- */

const $ = (selector) => document.querySelector(selector);

function el(tag, attributes = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of [].concat(children)) {
    if (child !== null && child !== undefined && child !== false) node.append(child);
  }
  return node;
}

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', ICONS[name]);
  svg.append(path);
  return svg;
}

function button(label, options = {}) {
  const node = el('button', {
    type: options.type ?? 'button',
    class: `button${options.variant ? ` ${options.variant}` : ''}${options.small ? ' small' : ''}`,
    onclick: options.onclick,
    title: options.title,
    disabled: options.disabled,
  }, [options.icon ? icon(options.icon) : null, label ? el('span', { text: label }) : null]);
  if (options.busy) {
    node.addEventListener('click', () => withBusy(node, options.busy));
  }
  return node;
}

function iconButton(name, label, onclick, extraClass = '') {
  return el('button', { type: 'button', class: `icon-button ${extraClass}`.trim(), title: label, 'aria-label': label, onclick }, icon(name));
}

function segmented(options, value, onchange) {
  return el('div', { class: 'segmented', role: 'group' }, options.map((option) => el('button', {
    type: 'button',
    'aria-pressed': String(option.value === value),
    title: option.title,
    onclick: () => onchange(option.value),
  }, [option.icon ? icon(option.icon) : null, option.label ? el('span', { text: option.label }) : null, option.count ? el('span', { class: 'n', text: String(option.count) }) : null])));
}

function selectInput(options, value, onchange, label) {
  const node = el('select', { class: 'select', 'aria-label': label, onchange: (event) => onchange(event.target.value) },
    options.map(([optionValue, text]) => el('option', { value: optionValue, text })));
  node.value = value;
  return node;
}

/* ---------- Formatting ---------- */

function relativeTime(iso) {
  if (!iso) return '';
  const seconds = (Date.parse(iso) - Date.now()) / 1000;
  const units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
  const format = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' });
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return seconds < 0 ? 'just now' : 'in a moment';
}

function longDate(iso) {
  return new Date(iso).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' });
}

function qualityText(subscription) {
  if (subscription.downloadType === 'audio') return `Audio ${subscription.format.toUpperCase()}`;
  const quality = subscription.quality === 'best' ? 'Best quality' : `${subscription.quality}p`;
  return subscription.format === 'mp4' ? `${quality} MP4` : quality;
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/* ---------- API ---------- */

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method ?? 'GET',
    headers: options.body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? `Request failed with HTTP ${response.status}`);
  return payload;
}

function toast(message, isError = false) {
  const node = el('div', { class: `toast${isError ? ' error' : ''}`, text: message });
  $('#toasts').append(node);
  setTimeout(() => node.remove(), isError ? 7000 : 3500);
}

async function withBusy(node, task) {
  node.disabled = true;
  try {
    await task();
  } catch (error) {
    toast(error.message, true);
  } finally {
    node.disabled = false;
  }
}

async function videoAction(ids, action) {
  const { changed } = await api('/api/videos/actions', { method: 'POST', body: { ids, action } });
  const verb = { download: 'Queued for download', ignore: 'Ignored', restore: 'Moved back to new' }[action];
  toast(`${verb}: ${plural(changed, 'video')}`);
  for (const id of ids) state.selected.delete(id);
  await refresh();
}

function subscriptionById(id) {
  return state.subscriptions.find((subscription) => subscription.id === id) ?? null;
}

/* ---------- Ring avatar: the progress of a subscription around its face ---------- */

function avatarColor(name) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `hsl(${hash % 360} 45% 42%)`;
}

function face(subscription) {
  const name = subscription?.name ?? '?';
  if (subscription?.avatar) {
    return el('span', { class: 'face' }, el('img', { src: subscription.avatar, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }));
  }
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join('').toUpperCase();
  return el('span', { class: 'face', style: { background: avatarColor(name) }, text: initials || '?' });
}

/** Avatar wrapped in a ring split into downloaded / in progress / new, over the videos found. */
function ring(subscription, size, options = {}) {
  const wrapper = el('span', {
    class: `ring${options.plain ? ' plain' : ''}${subscription && !subscription.enabled ? ' paused' : ''}`,
    style: { '--size': `${size}px` },
  });
  if (!options.plain && subscription) {
    const svgNs = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNs, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('aria-hidden', 'true');
    const radius = 47;
    const circumference = 2 * Math.PI * radius;
    const circle = (cls, length, offset) => {
      const node = document.createElementNS(svgNs, 'circle');
      node.setAttribute('cx', '50');
      node.setAttribute('cy', '50');
      node.setAttribute('r', String(radius));
      node.setAttribute('class', cls);
      if (length !== undefined) {
        node.setAttribute('stroke-dasharray', `${length} ${circumference}`);
        node.setAttribute('stroke-dashoffset', String(-offset));
      }
      return node;
    };
    svg.append(circle('track'));
    const counts = subscription.counts ?? {};
    const total = subscription.total ?? 0;
    let offset = 0;
    for (const [cls, value] of [['seg-done', counts.done ?? 0], ['seg-active', (counts.queued ?? 0) + (counts.downloading ?? 0)], ['seg-new', counts.available ?? 0]]) {
      if (total === 0 || value === 0) continue;
      const length = (value / total) * circumference;
      svg.append(circle(cls, length, offset));
      offset += length;
    }
    wrapper.append(svg);
  }
  wrapper.append(face(subscription));
  if (!options.plain && subscription?.lastError) {
    wrapper.append(el('span', { class: 'alert', title: subscription.lastError }));
  }
  return wrapper;
}

/* ---------- Shared pieces ---------- */

function statusLabel(video) {
  const text = video.status === 'downloading' && video.progress ? `${video.progress}%` : STATUS_TEXT[video.status];
  return el('span', { class: `status ${video.status}`, text });
}

/** Per-status actions, as icon buttons (rows) or labelled buttons (cards). */
function videoActions(video, compact) {
  const make = (iconName, label, action, extra) => compact
    ? iconButton(iconName, label, () => videoAction([video.id], action).catch((error) => toast(error.message, true)), extra)
    : button(label, { icon: iconName, small: true, variant: action === 'download' ? 'primary' : 'ghost', busy: () => videoAction([video.id], action) });
  switch (video.status) {
    case 'available': return [make('download', 'Download', 'download', 'go'), make('ignore', 'Ignore', 'ignore')];
    case 'ignored': return [make('restore', 'Move back to new', 'restore'), make('download', 'Download', 'download', 'go')];
    case 'failed': return [make('refresh', 'Retry', 'download', 'go'), make('ignore', 'Ignore', 'ignore')];
    case 'queued': return [make('x', 'Cancel', 'ignore')];
    default: return [];
  }
}

function isSelectable(video) {
  return video.status !== 'downloading' && video.status !== 'done';
}

function toggleSelected(id) {
  if (state.selected.has(id)) state.selected.delete(id);
  else state.selected.add(id);
  render();
}

function selectionBar(videos) {
  const selected = videos.filter((video) => state.selected.has(video.id));
  if (selected.length === 0) return null;
  const ids = selected.map((video) => video.id);
  const has = (...statuses) => selected.some((video) => statuses.includes(video.status));
  return el('div', { class: 'selection-bar', role: 'toolbar', 'aria-label': 'Selected videos' }, [
    el('span', { class: 'count', text: `${selected.length} selected` }),
    has('available', 'ignored', 'failed') ? button('Download', { icon: 'download', small: true, variant: 'primary', busy: () => videoAction(ids, 'download') }) : null,
    has('available', 'failed', 'queued') ? button('Ignore', { icon: 'ignore', small: true, busy: () => videoAction(ids, 'ignore') }) : null,
    has('ignored') ? button('Move back to new', { icon: 'restore', small: true, busy: () => videoAction(ids, 'restore') }) : null,
    button('Clear', { small: true, onclick: () => { state.selected.clear(); render(); } }),
  ]);
}

function emptyState(title, text, action) {
  return el('div', { class: 'empty-state' }, [el('h2', { text: title }), el('p', { text }), action ?? null]);
}

function loadMore(shown, total) {
  if (shown >= total) return null;
  return el('div', { class: 'load-more' }, button(`Show more (${total - shown} left)`, { onclick: () => { state.limit += PAGE_SIZE; render(); } }));
}

/* ---------- Pages ---------- */

const pages = {};

pages.library = async () => {
  const view = prefs.get('libraryView');
  const sort = prefs.get('librarySort');
  const filter = prefs.get('libraryFilter');
  let subscriptions = [...state.subscriptions];

  if (filter === 'auto') subscriptions = subscriptions.filter((s) => s.mode === 'auto');
  if (filter === 'manual') subscriptions = subscriptions.filter((s) => s.mode === 'manual');
  if (filter === 'paused') subscriptions = subscriptions.filter((s) => !s.enabled);
  if (filter === 'errors') subscriptions = subscriptions.filter((s) => s.lastError);

  const byName = (a, b) => a.name.localeCompare(b.name);
  if (sort === 'name') subscriptions.sort(byName);
  if (sort === 'latest') subscriptions.sort((a, b) => (b.latestAt ?? '').localeCompare(a.latestAt ?? '') || byName(a, b));
  if (sort === 'new') subscriptions.sort((a, b) => (b.counts?.available ?? 0) - (a.counts?.available ?? 0) || byName(a, b));

  const toolbar = el('div', { class: 'toolbar' }, [
    button('Check all', { icon: 'refresh', busy: checkAll }),
    el('span', { class: 'spacer' }),
    selectInput([['all', 'All'], ['auto', 'Auto-download'], ['manual', 'Pick manually'], ['paused', 'Paused'], ['errors', 'With errors']], filter, (value) => { prefs.set('libraryFilter', value); render(); }, 'Filter'),
    selectInput([['name', 'Name'], ['latest', 'Latest upload'], ['new', 'Most new videos']], sort, (value) => { prefs.set('librarySort', value); render(); }, 'Sort'),
    segmented([{ value: 'rings', icon: 'rings', title: 'Rings' }, { value: 'table', icon: 'list', title: 'Table' }], view, (value) => { prefs.set('libraryView', value); render(); }),
  ]);

  const head = el('div', { class: 'page-head' }, [
    el('h1', { text: 'Library' }),
    el('div', { class: 'legend', 'aria-label': 'Ring colors' }, [
      el('span', {}, [el('i', { style: { background: 'var(--done)' } }), 'Downloaded']),
      el('span', {}, [el('i', { style: { background: 'var(--active)' } }), 'Downloading']),
      el('span', {}, [el('i', { style: { background: 'var(--new)' } }), 'New']),
    ]),
  ]);

  if (state.subscriptions.length === 0) {
    return [head, emptyState('Add your first channel', 'Paste a channel or playlist link. New uploads show up here and in your inbox.', button('Add channel', { icon: 'plus', variant: 'primary', onclick: openAddDialog }))];
  }
  if (subscriptions.length === 0) {
    return [head, toolbar, emptyState('Nothing matches this filter', 'Pick another filter to see your channels.')];
  }

  if (view === 'table') {
    return [head, toolbar, el('div', { class: 'table-wrap' }, el('table', {}, [
      el('thead', {}, el('tr', {}, ['Channel', 'New videos', 'Format', 'Folder', 'New', 'Downloaded', 'Latest upload', 'Checked'].map((text) => el('th', { text })))),
      el('tbody', {}, subscriptions.map((s) => el('tr', {}, [
        el('td', {}, el('div', { class: 'cell-title' }, [ring(s, 40, { plain: true }), el('div', {}, [
          el('a', { href: `#/channel/${s.id}`, text: s.name }),
          s.lastError ? el('small', { class: 'error', text: s.lastError }) : el('small', { text: s.kind === 'playlist' ? 'Playlist' : 'Channel' }),
        ])])),
        el('td', { text: !s.enabled ? 'Paused' : s.mode === 'auto' ? 'Auto-download' : 'Pick manually' }),
        el('td', { text: qualityText(s) }),
        el('td', { class: 'muted', text: s.folder || 'Download root' }),
        el('td', { class: 'num', text: String(s.counts?.available ?? 0) }),
        el('td', { class: 'num', text: `${s.counts?.done ?? 0} of ${s.total ?? 0}` }),
        el('td', { class: 'num', text: s.latestAt ? relativeTime(s.latestAt) : '' }),
        el('td', { class: 'num muted', text: s.lastCheckedAt ? relativeTime(s.lastCheckedAt) : 'Never' }),
      ]))),
    ]))];
  }

  return [head, toolbar, el('div', { class: 'library-grid' }, subscriptions.map((s) => {
    const fresh = s.counts?.available ?? 0;
    return el('a', { class: 'channel', href: `#/channel/${s.id}`, title: s.lastError ? `Last check failed: ${s.lastError}` : s.name }, [
      ring(s, 132),
      el('span', { class: 'name', text: s.name }),
      el('span', { class: 'stats' }, [
        fresh > 0 ? el('span', { class: 'new', text: `${fresh} new` }) : null,
        el('span', { text: `${s.counts?.done ?? 0} downloaded` }),
        !s.enabled ? el('span', { class: 'paused', text: 'Paused' }) : null,
      ]),
    ]);
  }))];
};

pages.channel = async (id) => {
  const subscription = subscriptionById(id);
  if (subscription === null) {
    return emptyState('This subscription no longer exists', 'It may have been deleted.', button('Back to library', { onclick: () => { location.hash = '#/library'; } }));
  }
  const tab = CHANNEL_TABS.find((candidate) => candidate.key === state.channelTab) ?? CHANNEL_TABS[0];
  const params = new URLSearchParams({ subscription: id, limit: '5000' });
  if (tab.statuses.length > 0) params.set('status', tab.statuses.join(','));
  const { items: videos } = await api(`/api/videos?${params}`);

  const counts = subscription.counts ?? {};
  const actions = el('div', { class: 'hero-actions' }, [
    button('Check now', { icon: 'refresh', small: true, busy: async () => {
      const { added } = await api(`/api/subscriptions/${id}/check`, { method: 'POST' });
      toast(added > 0 ? `Found ${plural(added, 'new video')}` : 'No new videos');
      await refresh();
    } }),
    button('Find older videos', { icon: 'archive', small: true, title: 'List the whole history of this channel or playlist', busy: async () => {
      toast('Listing older videos. This can take a minute.');
      const { added } = await api(`/api/subscriptions/${id}/backlog`, { method: 'POST' });
      toast(added > 0 ? `Added ${plural(added, 'older video')} as new` : 'No older videos found');
      await refresh();
    } }),
    button(subscription.enabled ? 'Pause' : 'Resume', { icon: subscription.enabled ? 'pause' : 'play', small: true, busy: async () => {
      await api(`/api/subscriptions/${id}`, { method: 'PATCH', body: { enabled: !subscription.enabled } });
      toast(subscription.enabled ? 'Paused: no more checks until you resume' : 'Resumed');
      await refresh();
    } }),
    button('Edit', { icon: 'edit', small: true, onclick: () => openEditDialog(subscription) }),
    button('Delete', { icon: 'trash', small: true, variant: 'danger', onclick: () => confirmDelete(subscription) }),
  ]);
  const hero = el('section', { class: 'hero' }, [
    subscription.cover ? el('div', { class: 'hero-backdrop', style: { backgroundImage: `url("${subscription.cover}")` } }) : null,
    el('div', { class: 'hero-body' }, [
      ring(subscription, 148),
      el('div', { class: 'hero-text' }, [
        el('h1', {}, el('a', { href: subscription.url, target: '_blank', rel: 'noopener', text: subscription.name, title: 'Open on YouTube' })),
        el('div', { class: 'facts' }, [
          el('span', { class: 'fact' }, [icon(subscription.kind === 'playlist' ? 'playlist' : 'channel'), subscription.kind === 'playlist' ? 'Playlist' : 'Channel']),
          el('span', { class: 'fact' }, [icon(subscription.mode === 'auto' ? 'bolt' : 'pick'), subscription.mode === 'auto' ? 'Downloads new videos' : 'You pick new videos']),
          el('span', { class: 'fact' }, [icon(subscription.downloadType === 'audio' ? 'music' : 'film'), qualityText(subscription)]),
          el('span', { class: 'fact' }, [icon('folder'), subscription.folder || 'Download root']),
          subscription.titleInclude || subscription.titleExclude || subscription.skipShorts
            ? el('span', { class: 'fact' }, [icon('filter'), [subscription.titleInclude && `Only "${subscription.titleInclude}"`, subscription.titleExclude && `Not "${subscription.titleExclude}"`, subscription.skipShorts && 'No Shorts'].filter(Boolean).join(', ')])
            : null,
          !subscription.enabled ? el('span', { class: 'fact' }, [icon('pause'), 'Paused']) : null,
          subscription.lastError ? el('span', { class: 'fact alert', title: subscription.lastError }, `Last check failed: ${subscription.lastError}`) : null,
        ]),
        actions,
      ]),
      el('div', { class: 'hero-tally' }, [
        el('div', { class: 'tally new' }, [el('b', { text: String(counts.available ?? 0) }), el('span', { text: 'New' })]),
        el('div', { class: 'tally done' }, [el('b', { text: String(counts.done ?? 0) }), el('span', { text: 'Downloaded' })]),
        el('div', { class: 'tally' }, [el('b', { text: String(subscription.total ?? 0) }), el('span', { text: 'Found' })]),
      ]),
    ]),
  ]);

  const toolbar = el('div', { class: 'toolbar' }, [
    segmented(CHANNEL_TABS.map((candidate) => ({
      value: candidate.key,
      label: candidate.label,
      count: candidate.statuses.length === 0 ? subscription.total : candidate.statuses.reduce((sum, status) => sum + (counts[status] ?? 0), 0),
    })), tab.key, (value) => { state.channelTab = value; state.selected.clear(); render(); }),
    el('span', { class: 'spacer' }),
    segmented([{ value: 'list', icon: 'list', title: 'List' }, { value: 'grid', icon: 'grid', title: 'Grid' }], prefs.get('channelView'), (value) => { prefs.set('channelView', value); render(); }),
  ]);

  if (videos.length === 0) {
    return [hero, toolbar, emptyState(tab.key === 'all' ? 'No videos found yet' : `No ${tab.label.toLowerCase()} videos`, tab.key === 'all' ? 'Check now, or find older videos to list the channel history.' : 'Pick another tab to see the rest.')];
  }
  const body = prefs.get('channelView') === 'grid' ? cardGrid(videos, false) : monthGroups(subscription, videos);
  return [hero, toolbar, body, selectionBar(videos)];
};

/** Videos grouped by upload month, like seasons in Sonarr. Undated backlog entries go last. */
function monthGroups(subscription, videos) {
  const groups = new Map();
  for (const video of videos) {
    const key = video.publishedAt ? video.publishedAt.slice(0, 7) : 'undated';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(video);
  }
  let index = 0;
  return el('div', {}, [...groups.entries()].map(([key, items]) => {
    const collapseKey = `${subscription.id}:${key}`;
    const collapsed = state.collapsed.has(collapseKey) ? state.collapsed.get(collapseKey) : index >= 3;
    index++;
    const label = key === 'undated'
      ? 'From the channel history'
      : new Date(`${key}-01T00:00:00`).toLocaleDateString(LOCALE, { month: 'long', year: 'numeric' });
    const count = (status) => items.filter((video) => video.status === status).length;
    const fresh = items.filter((video) => video.status === 'available');
    const header = el('header', {
      onclick: (event) => {
        if (event.target.closest('button')) return;
        state.collapsed.set(collapseKey, !collapsed);
        render();
      },
    }, [
      el('span', { class: 'chev' }, icon('chevron')),
      el('h3', { text: label }),
      el('span', { class: 'summary' }, [
        el('span', { text: plural(items.length, 'video') }),
        count('available') ? el('span', { class: 'available', text: `${count('available')} new` }) : null,
        count('done') ? el('span', { class: 'done', text: `${count('done')} downloaded` }) : null,
        count('failed') ? el('span', { class: 'failed', text: `${count('failed')} failed` }) : null,
      ]),
      fresh.length > 0 ? button(`Download ${fresh.length} new`, { icon: 'download', small: true, busy: () => videoAction(fresh.map((video) => video.id), 'download') }) : null,
    ]);
    return el('section', { class: `group${collapsed ? ' collapsed' : ''}` }, [header, el('div', { class: 'rows' }, items.map(videoRow))]);
  }));
}

function videoRow(video) {
  const selectable = isSelectable(video);
  const note = video.status === 'done' && video.filename ? video.filename : video.note;
  return el('div', { class: `row ${video.status}${state.selected.has(video.id) ? ' selected' : ''}` }, [
    selectable
      ? el('input', { type: 'checkbox', class: 'check', checked: state.selected.has(video.id), 'aria-label': `Select ${video.title}`, onchange: () => toggleSelected(video.id) })
      : el('span'),
    el('img', { class: 'mini-thumb', src: video.thumbnail, alt: '', loading: 'lazy' }),
    el('div', { class: 'title' }, [
      el('a', { href: video.url, target: '_blank', rel: 'noopener', text: video.title, title: video.title }),
      el('small', { class: video.status === 'failed' ? 'error' : '', text: note || [video.publishedAt ? longDate(video.publishedAt) : null, video.isShort ? 'Short' : null].filter(Boolean).join(', ') }),
    ]),
    statusLabel(video),
    el('div', { class: 'actions' }, videoActions(video, true)),
  ]);
}

function videoCard(video, showChannel) {
  const subscription = subscriptionById(video.subscriptionId);
  const selectable = isSelectable(video);
  return el('article', { class: `card ${video.status}${state.selected.has(video.id) ? ' selected' : ''}` }, [
    el('div', { class: 'thumb', onclick: () => selectable && toggleSelected(video.id) }, [
      el('img', { src: video.thumbnail, alt: '', loading: 'lazy' }),
      selectable ? el('input', { type: 'checkbox', class: 'check', checked: state.selected.has(video.id), 'aria-label': `Select ${video.title}`, onclick: (event) => event.stopPropagation(), onchange: () => toggleSelected(video.id) }) : null,
      video.isShort ? el('span', { class: 'short', text: 'Short' }) : null,
    ]),
    el('div', { class: 'meta' }, [
      showChannel ? el('a', { href: `#/channel/${video.subscriptionId}`, title: subscription?.name }, ring(subscription, 34, { plain: true })) : null,
      el('div', { class: 'text' }, [
        el('a', { class: 't', href: video.url, target: '_blank', rel: 'noopener', text: video.title, title: video.title }),
        el('small', {}, [
          showChannel ? el('a', { href: `#/channel/${video.subscriptionId}`, text: video.channel }) : null,
          showChannel && video.publishedAt ? ', ' : null,
          video.publishedAt ? relativeTime(video.publishedAt) : null,
        ]),
        video.status !== 'available' ? statusLabel(video) : null,
      ]),
    ]),
    el('div', { class: 'card-actions', style: showChannel ? {} : { paddingLeft: '0' } }, videoActions(video, false)),
  ]);
}

function cardGrid(videos, showChannel) {
  return el('div', { class: `cards${state.selected.size > 0 ? ' selecting' : ''}` }, videos.map((video) => videoCard(video, showChannel)));
}

/** Inbox sections: recent days by name, then weeks, then months, so each section holds a useful batch. */
function periodLabel(iso) {
  if (!iso) return 'From channel histories';
  const date = new Date(iso);
  const today = new Date();
  const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(today) - startOf(date)) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return 'This week';
  if (days < 14) return 'Last week';
  return date.toLocaleDateString(LOCALE, { month: 'long', year: 'numeric' });
}

pages.inbox = async () => {
  const params = new URLSearchParams({ status: 'available', limit: String(state.limit) });
  if (state.inboxChannel) params.set('subscription', state.inboxChannel);
  const { items, total } = await api(`/api/videos?${params}`);

  const channels = state.subscriptions.filter((s) => (s.counts?.available ?? 0) > 0).sort((a, b) => a.name.localeCompare(b.name));
  const head = el('div', { class: 'page-head' }, [
    el('h1', { text: 'Inbox' }),
    el('p', { text: total > 0 ? `${plural(total, 'new video')} waiting for you to pick` : '' }),
  ]);
  const toolbar = el('div', { class: 'toolbar' }, [
    total > 0 ? button(`Select all ${items.length}`, { onclick: () => { for (const video of items) state.selected.add(video.id); render(); } }) : null,
    el('span', { class: 'spacer' }),
    selectInput([['', 'All channels'], ...channels.map((s) => [s.id, `${s.name} (${s.counts.available})`])], state.inboxChannel, (value) => { state.inboxChannel = value; state.limit = PAGE_SIZE; render(); }, 'Channel'),
  ]);
  if (items.length === 0) {
    return [head, emptyState('You are all caught up', 'New uploads from channels set to "You pick" land here.', button('Go to library', { icon: 'library', onclick: () => { location.hash = '#/library'; } }))];
  }

  const days = new Map();
  for (const video of items) {
    const label = periodLabel(video.publishedAt);
    if (!days.has(label)) days.set(label, []);
    days.get(label).push(video);
  }
  return [head, toolbar, ...[...days.entries()].map(([label, videos]) => el('section', { class: 'day' }, [
    el('header', {}, [
      el('h2', {}, [label, el('span', { text: plural(videos.length, 'video') })]),
      button(`Download all ${videos.length}`, { icon: 'download', small: true, variant: 'ghost', busy: () => videoAction(videos.map((video) => video.id), 'download') }),
    ]),
    cardGrid(videos, true),
  ])), loadMore(items.length, total), selectionBar(items)];
};

function activityTable(videos, columns) {
  return el('div', { class: 'table-wrap' }, el('table', {}, [
    el('thead', {}, el('tr', {}, columns.map((column) => el('th', { text: column.label })))),
    el('tbody', {}, videos.map((video) => el('tr', {}, columns.map((column) => el('td', { class: column.class ?? '' }, column.render(video)))))),
  ]));
}

function titleCell(video, detail, isError) {
  return el('div', { class: 'cell-title' }, [
    el('img', { class: 'mini-thumb', src: video.thumbnail, alt: '', loading: 'lazy' }),
    el('div', {}, [
      el('a', { href: video.url, target: '_blank', rel: 'noopener', text: video.title }),
      el('small', { class: isError ? 'error' : '' }, detail ?? el('a', { href: `#/channel/${video.subscriptionId}`, text: video.channel })),
    ]),
  ]);
}

pages.activity = async (tab) => {
  const isHistory = tab === 'history';
  const statuses = isHistory ? 'done,failed' : 'queued,downloading';
  const { items, total } = await api(`/api/videos?status=${statuses}&sort=updated&limit=${isHistory ? state.limit : 1000}`);
  const totals = state.status?.counts ?? {};

  const head = el('div', { class: 'page-head' }, [el('h1', { text: 'Activity' })]);
  const toolbar = el('div', { class: 'toolbar' }, [
    segmented([
      { value: 'queue', label: 'Queue', icon: 'download', count: (totals.queued ?? 0) + (totals.downloading ?? 0) },
      { value: 'history', label: 'History', icon: 'history', count: (totals.done ?? 0) + (totals.failed ?? 0) },
    ], isHistory ? 'history' : 'queue', (value) => { location.hash = `#/activity/${value}`; }),
  ]);

  if (items.length === 0) {
    return [head, toolbar, isHistory
      ? emptyState('No downloads yet', 'Finished and failed downloads are listed here.')
      : emptyState('Nothing is downloading', 'Pick videos in the inbox, or set a channel to download new videos for you.', button('Open inbox', { icon: 'inbox', onclick: () => { location.hash = '#/inbox'; } }))];
  }

  if (!isHistory) {
    return [head, toolbar, activityTable(items, [
      { label: 'Video', render: (video) => titleCell(video) },
      { label: 'Progress', render: (video) => video.status === 'downloading'
        ? el('div', { class: 'progress-cell' }, [el('div', { class: 'bar' }, el('span', { style: { width: `${video.progress ?? 0}%` } })), `${video.progress ?? 0}%`])
        : statusLabel(video) },
      { label: 'Requested', class: 'num muted', render: (video) => relativeTime(video.sentAt ?? video.updatedAt) },
      { label: '', render: (video) => el('div', { class: 'actions' }, videoActions(video, true)) },
    ])];
  }
  return [head, toolbar, activityTable(items, [
    { label: 'Video', render: (video) => titleCell(video, video.status === 'failed' ? video.note : video.filename, video.status === 'failed') },
    { label: 'Result', render: (video) => statusLabel(video) },
    { label: 'When', class: 'num muted', render: (video) => relativeTime(video.updatedAt) },
    { label: '', render: (video) => el('div', { class: 'actions' }, videoActions(video, true)) },
  ]), loadMore(items.length, total)];
};

pages.system = async () => {
  const ytdlp = state.ytdlp ?? {};
  const status = state.status ?? {};
  const counts = status.counts ?? {};
  let ytdlpNote;
  if (ytdlp.version === null) ytdlpNote = el('p', { class: 'note bad', text: 'yt-dlp is not installed. Install it to download videos.' });
  else if (ytdlp.updateAvailable) ytdlpNote = el('p', { class: 'note warn', text: `Version ${ytdlp.latest} is available.` });
  else if (ytdlp.latest) ytdlpNote = el('p', { class: 'note good', text: 'Up to date.' });
  else ytdlpNote = el('p', { class: 'note', text: ytdlp.channel === 'nightly' ? 'Follows nightly builds.' : 'Could not check the latest version.' });

  return [
    el('div', { class: 'page-head' }, [el('h1', { text: 'System' })]),
    el('div', { class: 'panels' }, [
      el('section', { class: 'panel' }, [
        el('h2', { text: 'yt-dlp' }),
        el('div', { class: 'version', text: ytdlp.version ?? 'Not installed' }),
        ytdlpNote,
        ytdlp.lastError ? el('p', { class: 'note bad', text: ytdlp.lastError }) : null,
        el('dl', {}, [
          el('dt', { text: 'Release channel' }), el('dd', { text: ytdlp.channel === 'nightly' ? 'Nightly builds' : 'Stable releases' }),
          el('dt', { text: 'Last update' }), el('dd', { text: ytdlp.lastUpdateAt ? relativeTime(ytdlp.lastUpdateAt) : 'Not since this start' }),
          el('dt', { text: 'Installed in' }), el('dd', { class: 'muted', text: ytdlp.managed ? 'Data folder (kept across restarts)' : 'Built-in copy, until the first update' }),
        ]),
        el('div', { class: 'actions' }, [button(ytdlp.version === null ? 'Install yt-dlp' : 'Update yt-dlp', { icon: 'download', variant: ytdlp.updateAvailable || ytdlp.version === null ? 'primary' : '', busy: updateYtdlp })]),
      ]),
      el('section', { class: 'panel' }, [
        el('h2', { text: 'Checking for new videos' }),
        el('dl', {}, [
          el('dt', { text: 'Every' }), el('dd', { text: plural(status.pollIntervalMinutes ?? 0, 'minute') }),
          el('dt', { text: 'Last check' }), el('dd', { text: status.checking ? 'Running now' : status.lastPollAt ? relativeTime(status.lastPollAt) : 'Not yet' }),
          el('dt', { text: 'Next check' }), el('dd', { text: status.nextPollAt ? relativeTime(status.nextPollAt) : '' }),
          el('dt', { text: 'Downloads with' }), el('dd', { text: status.downloader ?? '' }),
        ]),
        el('div', { class: 'actions' }, [button('Check all now', { icon: 'refresh', busy: checkAll })]),
      ]),
      el('section', { class: 'panel' }, [
        el('h2', { text: 'Library' }),
        el('dl', {}, [
          el('dt', { text: 'Subscriptions' }), el('dd', { text: String(state.subscriptions.length) }),
          el('dt', { text: 'New' }), el('dd', { text: String(counts.available ?? 0) }),
          el('dt', { text: 'Downloading' }), el('dd', { text: String((counts.queued ?? 0) + (counts.downloading ?? 0)) }),
          el('dt', { text: 'Downloaded' }), el('dd', { text: String(counts.done ?? 0) }),
          el('dt', { text: 'Failed' }), el('dd', { text: String(counts.failed ?? 0) }),
          el('dt', { text: 'Ignored' }), el('dd', { text: String(counts.ignored ?? 0) }),
        ]),
      ]),
    ]),
  ];
};

pages.search = async (query) => {
  const { items, total } = await api(`/api/videos?q=${encodeURIComponent(query)}&limit=${state.limit}`);
  const channels = state.subscriptions.filter((s) => s.name.toLowerCase().includes(query.toLowerCase()));
  return [
    el('div', { class: 'page-head' }, [el('h1', { text: `Results for "${query}"` }), el('p', { text: `${plural(channels.length, 'channel')}, ${plural(total, 'video')}` })]),
    channels.length > 0 ? el('div', { class: 'library-grid', style: { marginBottom: '32px' } }, channels.map((s) => el('a', { class: 'channel', href: `#/channel/${s.id}` }, [ring(s, 96), el('span', { class: 'name', text: s.name })]))) : null,
    items.length > 0 ? cardGrid(items, true) : emptyState('No videos match', 'Search looks at video titles and channel names.'),
    loadMore(items.length, total),
    selectionBar(items),
  ];
};

/* ---------- Actions ---------- */

async function checkAll() {
  const { added } = await api('/api/check', { method: 'POST' });
  toast(added > 0 ? `Found ${plural(added, 'new video')}` : 'No new videos');
  await refresh();
}

async function updateYtdlp() {
  toast('Updating yt-dlp. This takes a few seconds.');
  const { before, after } = await api('/api/ytdlp/update', { method: 'POST' });
  toast(before === after ? `yt-dlp ${after} is already the latest` : `yt-dlp updated from ${before ?? 'nothing'} to ${after}`);
  await refresh();
}

/* ---------- Dialogs ---------- */

function closeDialog() {
  const dialog = $('#dialog');
  if (dialog.open) dialog.close();
}

function showDialog(content) {
  const dialog = $('#dialog');
  dialog.replaceChildren(content);
  if (!dialog.open) dialog.showModal();
}

/** Shared subscription settings; returns the form section and a reader for its values. */
function settingsFields(initial, options = {}) {
  const mode = initial.mode ?? 'manual';
  const choice = el('div', { class: 'choice', role: 'radiogroup', 'aria-label': 'New videos' }, [
    el('label', {}, [el('input', { type: 'radio', name: 'mode', value: 'manual', checked: mode === 'manual' }), el('span', {}, [el('b', { text: 'Let me pick' }), el('small', { text: 'New videos wait in your inbox' })])]),
    el('label', {}, [el('input', { type: 'radio', name: 'mode', value: 'auto', checked: mode === 'auto' }), el('span', {}, [el('b', { text: 'Download automatically' }), el('small', { text: 'Every new video is downloaded' })])]),
  ]);
  const folder = el('input', { name: 'folder', value: initial.folder ?? '', placeholder: 'Channel name', autocomplete: 'off' });
  const type = selectInput([['video', 'Video'], ['audio', 'Audio only']], initial.downloadType ?? 'video', () => syncFormats(), 'Type');
  const format = el('select', { 'aria-label': 'Format' });
  const quality = el('select', { 'aria-label': 'Quality' });
  for (const node of [type, format, quality]) node.classList.remove('select');
  const fill = (select, list, value) => {
    select.replaceChildren(...list.map(([v, text]) => el('option', { value: v, text })));
    select.value = list.some(([v]) => v === value) ? value : list[0][0];
  };
  const syncFormats = (formatValue, qualityValue) => {
    const catalog = FORMATS[type.value];
    fill(format, catalog.formats, formatValue ?? format.value);
    fill(quality, catalog.qualities, qualityValue ?? quality.value);
  };
  syncFormats(initial.format, initial.quality);

  const include = el('input', { name: 'titleInclude', value: initial.titleInclude ?? '', placeholder: 'e.g. tutorial|review', autocomplete: 'off' });
  const exclude = el('input', { name: 'titleExclude', value: initial.titleExclude ?? '', placeholder: 'e.g. live|trailer', autocomplete: 'off' });
  const skipShorts = el('input', { type: 'checkbox', checked: initial.skipShorts ?? false });
  const initialSelect = options.withInitial
    ? selectInput([['available', 'Show them as new'], ['ignore', 'Ignore them'], ['download', 'Download them']], 'available', () => {}, 'Existing videos')
    : null;
  if (initialSelect) initialSelect.classList.remove('select');
  const hasFilters = Boolean(initial.titleInclude || initial.titleExclude || initial.skipShorts);

  const section = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '18px' } }, [
    choice,
    el('div', { class: 'fields' }, [
      el('label', { class: 'field', style: { flexBasis: '100%' } }, [el('span', { text: 'Folder' }), folder, el('small', { text: 'Inside the download folder. Leave empty to use the channel name.' })]),
      el('label', { class: 'field' }, [el('span', { text: 'Type' }), type]),
      el('label', { class: 'field' }, [el('span', { text: 'Format' }), format]),
      el('label', { class: 'field' }, [el('span', { text: 'Quality' }), quality]),
    ]),
    initialSelect ? el('label', { class: 'field' }, [el('span', { text: 'Videos already on the channel (latest 15)' }), initialSelect]) : null,
    el('details', { class: 'more', open: hasFilters }, [
      el('summary', { text: 'Filters' }),
      el('div', {}, [
        el('div', { class: 'fields' }, [
          el('label', { class: 'field' }, [el('span', { text: 'Title must match' }), include, el('small', { text: 'Regular expression, case-insensitive' })]),
          el('label', { class: 'field' }, [el('span', { text: 'Title must not match' }), exclude]),
        ]),
        el('label', { class: 'toggle' }, [skipShorts, 'Skip Shorts']),
      ]),
    ]),
  ]);

  const read = () => ({
    mode: section.querySelector('input[name="mode"]:checked').value,
    folder: folder.value,
    downloadType: type.value,
    format: format.value,
    quality: quality.value,
    titleInclude: include.value,
    titleExclude: exclude.value,
    skipShorts: skipShorts.checked,
    ...(initialSelect ? { initial: initialSelect.value } : {}),
  });
  return { section, read, folder };
}

function formError() {
  return el('p', { class: 'form-error', hidden: true });
}

function openAddDialog() {
  const input = el('input', { name: 'url', placeholder: 'youtube.com/@channel or a playlist link', autocomplete: 'off', 'aria-label': 'Channel or playlist link', required: true });
  const error = formError();
  const submit = button('Look up', { type: 'submit', variant: 'primary', icon: 'search' });
  const form = el('form', {
    onsubmit: async (event) => {
      event.preventDefault();
      error.hidden = true;
      submit.disabled = true;
      submit.querySelector('span').textContent = 'Looking up';
      try {
        const preview = await api('/api/lookup', { method: 'POST', body: { url: input.value } });
        showAddStep(input.value, preview);
      } catch (lookupError) {
        error.textContent = lookupError.message;
        error.hidden = false;
      } finally {
        submit.disabled = false;
        submit.querySelector('span').textContent = 'Look up';
      }
    },
  }, [
    el('h2', { text: 'Add a channel or playlist' }),
    el('div', { class: 'lookup' }, [input, submit]),
    el('p', { class: 'hint', text: 'Works with channel links, @handles, /channel/ links and playlist links.' }),
    error,
    el('div', { class: 'foot' }, [button('Cancel', { onclick: closeDialog })]),
  ]);
  showDialog(form);
  input.focus();
}

function showAddStep(url, preview) {
  const fields = settingsFields({ folder: preview.suggestedFolder }, { withInitial: true });
  const error = formError();
  const submit = button(`Add ${preview.kind}`, { type: 'submit', variant: 'primary', icon: 'plus', disabled: preview.alreadySubscribed });
  const pseudo = { name: preview.name, avatar: preview.avatar, enabled: true };
  const form = el('form', {
    onsubmit: async (event) => {
      event.preventDefault();
      error.hidden = true;
      submit.disabled = true;
      try {
        const { subscription, added } = await api('/api/subscriptions', { method: 'POST', body: { url, ...fields.read() } });
        closeDialog();
        toast(`Added ${subscription.name} with ${plural(added, 'video')}`);
        await refresh();
        location.hash = `#/channel/${subscription.id}`;
      } catch (addError) {
        error.textContent = addError.message;
        error.hidden = false;
        submit.disabled = false;
      }
    },
  }, [
    el('div', { class: 'head' }, [
      ring(pseudo, 64, { plain: true }),
      el('div', {}, [
        el('h2', { text: preview.name }),
        el('p', {}, [`${preview.kind === 'playlist' ? 'Playlist' : 'Channel'}, `, el('a', { href: preview.url, target: '_blank', rel: 'noopener', text: 'open on YouTube' })]),
      ]),
    ]),
    preview.recent.length > 0 ? el('div', { class: 'preview-strip' }, preview.recent.slice(0, 4).map((entry) => el('img', { src: entry.thumbnail, alt: entry.title, title: entry.title, loading: 'lazy' }))) : null,
    preview.alreadySubscribed ? el('p', { class: 'form-error', text: `You already follow this ${preview.kind}.` }) : null,
    fields.section,
    error,
    el('div', { class: 'foot' }, [
      button('Back', { variant: 'ghost', onclick: openAddDialog }),
      button('Cancel', { onclick: closeDialog }),
      submit,
    ]),
  ]);
  showDialog(form);
}

function openEditDialog(subscription) {
  const fields = settingsFields(subscription);
  const name = el('input', { value: subscription.name, autocomplete: 'off' });
  const error = formError();
  const form = el('form', {
    onsubmit: async (event) => {
      event.preventDefault();
      error.hidden = true;
      try {
        await api(`/api/subscriptions/${subscription.id}`, { method: 'PATCH', body: { name: name.value, ...fields.read() } });
        closeDialog();
        toast('Changes saved');
        await refresh();
      } catch (saveError) {
        error.textContent = saveError.message;
        error.hidden = false;
      }
    },
  }, [
    el('div', { class: 'head' }, [ring(subscription, 64, { plain: true }), el('div', {}, [el('h2', { text: `Edit ${subscription.name}` }), el('p', { text: 'Changes apply to the next downloads.' })])]),
    el('label', { class: 'field' }, [el('span', { text: 'Name' }), name]),
    fields.section,
    error,
    el('div', { class: 'foot' }, [button('Cancel', { onclick: closeDialog }), button('Save changes', { type: 'submit', variant: 'primary' })]),
  ]);
  showDialog(form);
}

function confirmDelete(subscription) {
  const form = el('form', {
    onsubmit: async (event) => {
      event.preventDefault();
      try {
        await api(`/api/subscriptions/${subscription.id}`, { method: 'DELETE' });
        closeDialog();
        toast(`Deleted ${subscription.name}`);
        location.hash = '#/library';
        await refresh();
      } catch (deleteError) {
        toast(deleteError.message, true);
      }
    },
  }, [
    el('div', { class: 'head' }, [ring(subscription, 64, { plain: true }), el('div', {}, [el('h2', { text: `Delete ${subscription.name}?` })])]),
    el('p', { style: { margin: 0, color: 'var(--text-2)' }, text: 'Youtubaar stops checking it and forgets its video list. Files you already downloaded stay on disk.' }),
    el('div', { class: 'foot' }, [button('Cancel', { onclick: closeDialog }), button('Delete', { type: 'submit', variant: 'primary', icon: 'trash' })]),
  ]);
  showDialog(form);
}

/* ---------- Chrome: nav, footer, poll status ---------- */

function renderNav() {
  const counts = state.status?.counts ?? {};
  const route = state.route;
  const active = (name) => (route.page === name ? 'page' : undefined);
  const item = (href, iconName, label, current, count, countClass) => el('a', { href, 'aria-current': current }, [
    icon(iconName), el('span', { text: label }), count ? el('span', { class: `count ${countClass ?? ''}`.trim(), text: String(count) }) : null,
  ]);
  const queued = (counts.queued ?? 0) + (counts.downloading ?? 0);
  $('#nav').replaceChildren(...[
    item('#/library', 'library', 'Library', active('library') ?? (route.page === 'channel' ? 'page' : undefined)),
    item('#/inbox', 'inbox', 'Inbox', active('inbox'), counts.available),
    item('#/activity/queue', 'activity', 'Activity', active('activity'), counts.failed, 'failed'),
    route.page === 'activity' ? el('a', { class: 'sub', href: '#/activity/queue', 'aria-current': route.arg !== 'history' ? 'page' : undefined, text: queued ? `Queue (${queued})` : 'Queue' }) : null,
    route.page === 'activity' ? el('a', { class: 'sub', href: '#/activity/history', 'aria-current': route.arg === 'history' ? 'page' : undefined, text: 'History' }) : null,
    item('#/system', 'system', 'System', active('system')),
  ].filter(Boolean));

  const ytdlp = state.ytdlp;
  const status = state.status;
  $('#sidebar-foot').replaceChildren(...[
    ytdlp ? el('a', { href: '#/system', class: ytdlp.version === null ? 'bad' : ytdlp.updateAvailable ? 'warn' : '' },
      ytdlp.version === null ? 'yt-dlp is not installed' : ytdlp.updateAvailable ? `yt-dlp ${ytdlp.version}, update available` : `yt-dlp ${ytdlp.version}`) : null,
    status?.nextPollAt ? el('span', { text: `Next check ${relativeTime(status.nextPollAt)}` }) : null,
  ].filter(Boolean));

  $('#poll-status').textContent = status?.checking ? 'Checking for new videos' : status?.lastPollAt ? `Checked ${relativeTime(status.lastPollAt)}` : '';
}

/* ---------- Router + render loop ---------- */

function parseRoute() {
  const [page, ...rest] = location.hash.replace(/^#\/?/, '').split('/');
  const arg = rest.length > 0 ? decodeURIComponent(rest.join('/')) : '';
  return pages[page] ? { page, arg } : { page: 'library', arg: '' };
}

let renderToken = 0;
async function render() {
  const token = ++renderToken;
  const route = state.route;
  renderNav();
  try {
    const content = await pages[route.page](route.arg);
    if (token !== renderToken) return;
    const page = $('#page');
    const scroll = window.scrollY;
    page.replaceChildren(...[].concat(content).filter(Boolean));
    window.scrollTo(0, scroll);
  } catch (error) {
    if (token === renderToken) toast(error.message, true);
  }
}

async function loadShared() {
  const [subscriptions, status, ytdlp] = await Promise.all([api('/api/subscriptions'), api('/api/status'), api('/api/ytdlp')]);
  state.subscriptions = subscriptions;
  state.status = status;
  state.ytdlp = ytdlp;
}

async function refresh() {
  try {
    await loadShared();
  } catch (error) {
    toast(error.message, true);
  }
  await render();
}

function onRouteChange() {
  const next = parseRoute();
  const changed = state.route === null || next.page !== state.route.page || next.arg !== state.route.arg;
  state.route = next;
  if (changed) {
    state.selected.clear();
    state.limit = PAGE_SIZE;
    if (next.page === 'channel') state.channelTab = 'all';
    if (next.page !== 'search') $('#search').value = '';
    window.scrollTo(0, 0);
  }
  render();
}

function init() {
  for (const slot of document.querySelectorAll('[data-icon]')) slot.replaceWith(icon(slot.dataset.icon));
  $('#add-button').addEventListener('click', openAddDialog);
  $('#dialog').addEventListener('click', (event) => { if (event.target === event.currentTarget) closeDialog(); });

  let searchTimer = null;
  $('#search').addEventListener('input', (event) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      const query = event.target.value.trim();
      if (query) location.hash = `#/search/${encodeURIComponent(query)}`;
      else if (state.route.page === 'search') location.hash = '#/library';
    }, 250);
  });

  window.addEventListener('hashchange', onRouteChange);
  state.route = parseRoute();
  refresh();

  setInterval(() => {
    const busy = document.hidden || $('#dialog').open || document.activeElement?.tagName === 'SELECT';
    if (!busy) refresh();
  }, REFRESH_MS);
}

init();
