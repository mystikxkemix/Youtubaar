# Youtubaar

Sonarr for YouTube: subscribe to channels and playlists, see their new videos in an
inbox, and pick the ones to download, or let a subscription download everything new.
Downloads go to a per-subscription folder with the **yt-dlp** bundled in the image, or
optionally through an existing **MeTube** used as the download client.

```
YouTube RSS feeds ──poll──▶ Youtubaar ──"download this"──▶ yt-dlp  ──▶ /downloads/<folder>/
   (latest 15/source)       inbox, filters,                 (or MeTube)
                            queue, history
```

## Features

- **Channels and playlists**: paste a channel URL, an `@handle`, a `/channel/UC…` URL,
  a playlist URL (`…/playlist?list=PL…`) or a raw channel/playlist id.
- **Playlists come first**: a video listed by both a channel and one of its followed
  playlists belongs to the playlist (its folder, its Jellyfin show) as long as you have
  not acted on it yet. Playlists are listed whole with yt-dlp, because YouTube's
  playlist feed only shows the first 15 videos and new episodes are usually appended.
- **A channel's playlists**: when adding a channel (or later, from its page with
  *Playlists*), list its public playlists and follow any of them, each with its own
  *Auto-download* switch. Playlists save into `<channel folder>_<playlist name>`, next to the channel.
  If you pick from the channel but a playlist auto-downloads, a new video in that
  playlist is downloaded even when the channel found it first.
- **Pick or auto per subscription**: *Let me pick* puts new videos in the Inbox,
  *Download automatically* queues them straight away.
- **Interface** organized like Sonarr / Radarr:
  - *Library*: each channel is its avatar wrapped in a ring showing downloaded,
    downloading and new videos (or a table view), with sort and filters.
  - *Channel page*: backdrop header, settings at a glance, actions, and videos grouped
    by month with "Download N new" per month, as a list or a grid.
  - *Inbox*: new videos to pick, grouped by period, multi-select.
  - *Activity*: download queue with progress, and history with failures to retry.
  - *System*: yt-dlp version and update, polling schedule, library totals.
  - *Add channel*: paste a link, preview the channel and its latest videos, then set
    it up. Works on phones (bottom tab bar) and in light or dark mode.
- **Existing videos**: when subscribing, the 15 latest videos can go to the inbox,
  be ignored, or be downloaded. *Load older videos* lists the whole history
  (up to `BACKLOG_LIMIT`) into the inbox, never auto-downloaded.
- **Per-subscription settings, all editable later**: folder, video/audio, format,
  quality, title include/exclude regex (case-insensitive), skip Shorts, pause.
- **Jellyfin**: optional per-subscription show layout with `.nfo` metadata, thumbnails
  and posters, ready for a Jellyfin *Shows* library (see below).
- **Download tracking**: progress, final file name, failure reason, retry.
- **Delete downloads**: remove a downloaded video's file (and its Jellyfin .nfo and
  thumbnail) from its row or from a selection. It moves to *Ignored*, so it is not
  downloaded again. Needs the built-in yt-dlp downloader.

## Run with Docker

```sh
docker compose up -d --build
```

Then open `http://<host>:8085`. Videos land in `./downloads/<subscription folder>/`.

## Install on ZimaOS

CI publishes the public image `ghcr.io/mystikxkemix/youtubaar` (linux/amd64) after the
tests pass on `master`, tagged `latest`, `1.<number of commits on master>` (e.g. `1.10`)
and `sha-<commit>`. Pin a `1.N` tag: updating is then just changing the number.

1. ZimaOS App Store → **+** (custom install) → **Import**, paste:
   ```yaml
   name: youtubaar
   services:
     youtubaar:
       image: ghcr.io/mystikxkemix/youtubaar:1.10
       container_name: youtubaar
       restart: unless-stopped
       ports:
         - "8085:8085"
       environment:
         DOWNLOADER: ytdlp
         POLL_INTERVAL_MINUTES: "30"
         AUTH_PASSWORD: change-me      # basic auth, user "admin"
       volumes:
         - /DATA/AppData/youtubaar:/data     # subscriptions, video list, yt-dlp (back up)
         - /DATA/Media/YouTube:/downloads    # one folder per subscription (Jellyfin: same folder)
   ```
2. Open `http://<zima-ip>:8085`.
3. Update later: in ZimaOS, open the app's settings, set the new `1.N` tag on the image
   and save. ZimaOS pulls it and restarts the app. yt-dlp itself updates without this
   (see below).

For age-restricted or members-only videos, put a `cookies.txt` export in
`/DATA/AppData/youtubaar` and set `YTDLP_EXTRA_ARGS: --cookies /data/cookies.txt`.

## Jellyfin

Turn on **Jellyfin metadata** on a subscription (when adding it, or with *Edit*) to
save it the way a Jellyfin *Shows* library reads it: the subscription is a show, each
upload year a season, each video an episode.

```
<download folder>/<subscription folder>/
  tvshow.nfo, poster.jpg                                  show title, channel avatar
  Season_2026/
    mistermv_S2026E111701_Episode_title.mp4               Kodi name: Show_SxxEyy_Title
    mistermv_S2026E111701_Episode_title.nfo               title, description, air date, tags
    mistermv_S2026E111701_Episode_title-thumb.jpg         episode image
```

Files use Kodi's episode naming (`Show_SxxEyy_Title`, no spaces or special characters),
so Jellyfin and Kodi both recognize them even without the `.nfo` files. Videos
downloaded before you turned the option on: open the subscription and click
**Organize for Jellyfin** to move them into their season with Kodi names, `.nfo`
files and thumbnails (metadata is read again from YouTube, nothing is re-downloaded).

1. Mount the folder Jellyfin reads as Youtubaar's `/downloads`, e.g. on ZimaOS
   `- /DATA/Media/YouTube:/downloads`, with the same folder in Jellyfin's container.
2. In Jellyfin, add a library of type **Shows** on that folder. Keep the **Nfo**
   metadata reader on, and untick the online metadata downloaders (TheTVDB, TheMovieDb)
   so Jellyfin does not try to match YouTube channels against TV databases.
3. New downloads appear after Jellyfin's next scan (or *Scan library*).

**Playlists are separate shows.** A followed playlist gets its own folder next to the
channel's (`mistermv` and `mistermv_ZELDA_OCARINA_OF_TIME`), a single `Season_01`, and
episodes numbered by their place in the playlist, so a let's play reads 1, 2, 3...
Some creators add each new part at the top of the playlist. Youtubaar sees this from the
upload dates and then counts from the bottom, so part 1 is still episode 1. If the dates
guess wrong, set **Playlist order** on the subscription (*Edit*), then run **Organize for
Jellyfin** to renumber the episodes already downloaded.
A Jellyfin show folder cannot sit inside another subscription's folder (it would read
as a season), and Youtubaar refuses that setup.

For channels, episodes are numbered by date (`111701` = 17 Nov, first video that day), so they sort
in upload order. Videos downloaded before turning the option on move in with **Organize for Jellyfin**.
It needs the built-in yt-dlp downloader (MeTube saves files its own way) and applies
to video downloads only.

## Keeping yt-dlp up to date

YouTube regularly breaks older yt-dlp versions ("Sign in to confirm…", missing formats),
so Youtubaar updates yt-dlp itself, without rebuilding the image:

- **One click**: the bottom of the sidebar shows the yt-dlp version, flags a newer
  release, and has an **Update** button (`POST /api/ytdlp/update` does the same).
- **Automatic**: on startup and then every `YTDLP_AUTO_UPDATE_HOURS` (24 by default),
  Youtubaar installs the latest release if it is newer. `0` turns this off.
- **Where it goes**: a Python venv in `/data/yt-dlp`, so the updated version survives
  restarts and container recreation. The copy baked into the image is only used until
  then.
- **Nightly builds**: `YTDLP_CHANNEL=nightly` installs pre-releases, which usually carry
  YouTube fixes a few days before the next stable release.
- Updates wait for running downloads to finish, and new downloads wait for the update.

## Using MeTube instead

Set `DOWNLOADER=metube` and `METUBE_URL=http://<metube-host>:8081` (including its
`URL_PREFIX` if set). MeTube then downloads into its own download directory;
`CUSTOM_DIRS` and `CREATE_CUSTOM_DIRS` must stay `true` (MeTube's default) for the
per-subscription folders.

## Run locally

Needs Node 22+, Python 3 and `ffmpeg`. yt-dlp can be on the `PATH`, or installed by
the UI's **Update** button into `./data/yt-dlp`.

```sh
npm install --include=dev
npm run build
npm start            # downloads into ./downloads with yt-dlp
npm test
```

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `DOWNLOADER` | `ytdlp` | `ytdlp` downloads with the bundled yt-dlp, `metube` sends downloads to MeTube |
| `METUBE_URL` | (only for `metube`) | MeTube base URL, including its `URL_PREFIX` if set |
| `DOWNLOAD_DIR` | `./downloads` (`/downloads` in Docker) | Download root for the `ytdlp` downloader |
| `POLL_INTERVAL_MINUTES` | `30` | How often every subscription's feed is checked |
| `BACKLOG_LIMIT` | `500` | Max videos listed by *Load older videos* |
| `YTDLP_PATH` | `yt-dlp` (`/opt/yt-dlp/bin/yt-dlp` in Docker) | yt-dlp used until Youtubaar installs its own copy in `DATA_DIR/yt-dlp` |
| `YTDLP_AUTO_UPDATE_HOURS` | `24` | Hours between automatic yt-dlp updates, `0` to disable |
| `YTDLP_CHANNEL` | `stable` | `stable` releases or `nightly` pre-releases |
| `PYTHON_PATH` | `python3` | Python used to create the yt-dlp venv |
| `YTDLP_CONCURRENCY` | `1` | Parallel downloads with the `ytdlp` downloader |
| `YTDLP_EXTRA_ARGS` | | Appended to every yt-dlp download, e.g. `--cookies /data/cookies.txt` |
| `DATA_DIR` | `./data` (`/data` in Docker) | Where `youtubaar.json` (subscriptions + videos) lives |
| `PORT` | `8085` | HTTP port |
| `AUTH_PASSWORD` | | Turns on basic auth; user is `AUTH_USER` (default `admin`) |

## How it works

- **Detection** reads each source's public RSS feed
  (`youtube.com/feeds/videos.xml?channel_id=…` / `?playlist_id=…`): no API key, cheap,
  but it only shows the **15 latest** videos. With a 30-minute poll that is plenty;
  a channel posting more than 15 videos between two polls would lose some.
- **@handles** are resolved to a channel id once, at subscription time (yt-dlp, then
  the channel page as a fallback).
- **Shorts** are recognized because the feed links them as `/shorts/<id>`. This is
  best effort, YouTube offers no explicit flag.
- **A video belongs to one subscription.** If a channel and one of its playlists are
  both subscribed, a shared video is filed under whichever found it first.
- **MeTube** receives `POST /add` with `download_type`, `quality`, `format`, `folder`
  and `auto_start: true`. Youtubaar then polls `GET /history` every 15 s to mark the
  video downloaded or failed. The same body works on older MeTube versions.
- **Names** have no spaces or special characters: folders become slugs
  (`Kurzgesagt – In a Nutshell` -> `Kurzgesagt_In_a_Nutshell`) and yt-dlp writes
  `<DOWNLOAD_DIR>/<folder>/<upload date>_<title>_<id>.<ext>` with `--restrict-filenames`,
  then dots left inside the title are turned into `_`. Display names (UI, Jellyfin)
  keep the real titles.
- **yt-dlp** downloads one video at a time by default.
  It is given the Node runtime (`--js-runtimes node`) to solve YouTube's JavaScript
  challenges. Downloads cut off by a restart are queued again.
- **State** is one JSON file in `DATA_DIR`, written atomically. Back it up to keep
  your subscriptions.

## API

Everything the UI does is available over JSON:

| Method | Path | Body / query |
|---|---|---|
| GET | `/api/status` | |
| GET | `/api/subscriptions` | |
| POST | `/api/subscriptions` | `url`, `folder`, `mode` (`manual`/`auto`), `downloadType`, `format`, `quality`, `titleInclude`, `titleExclude`, `skipShorts`, `initial` (`available`/`ignore`/`download`) |
| PATCH | `/api/subscriptions/:id` | same fields as POST (except `url`, `initial`), plus `name`, `enabled` |
| DELETE | `/api/subscriptions/:id` | |
| POST | `/api/subscriptions/:id/check` | |
| POST | `/api/subscriptions/:id/backlog` | |
| POST | `/api/check` | checks every subscription |
| GET | `/api/videos` | `status` (comma list), `subscription`, `q`, `limit`, `offset` |
| POST | `/api/videos/actions` | `ids`, `action` (`download`/`ignore`/`restore`) |
| POST | `/api/videos/delete` | `ids`: delete downloaded files, videos move to ignored |
| GET | `/api/channels/:channelId/playlists` | a channel's playlists, with the ones followed |
| GET | `/api/ytdlp` | installed and latest version |
| POST | `/api/ytdlp/update` | installs the latest yt-dlp |
