FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY tsconfig.json ./
COPY src ./src
COPY test ./test
RUN npm run build

FROM node:22-alpine
# Version shown in the UI, e.g. 2.13 (set by CI; "dev" for local builds).
ARG VERSION=dev
# yt-dlp: resolves @handles, lists channel history, and downloads.
# The copy baked in here is only a starting point: Youtubaar installs and updates its
# own copy in /data/yt-dlp (UI button + daily auto-update), so no rebuild is needed
# when YouTube breaks an old version.
RUN apk add --no-cache python3 ffmpeg \
 && python3 -m venv /opt/yt-dlp \
 && /opt/yt-dlp/bin/pip install --no-cache-dir --disable-pip-version-check "yt-dlp[default]"
WORKDIR /app
ENV APP_VERSION=$VERSION \
    NODE_ENV=production \
    PORT=8085 \
    DATA_DIR=/data \
    DOWNLOAD_DIR=/downloads \
    YTDLP_PATH=/opt/yt-dlp/bin/yt-dlp
COPY --from=build /app/dist ./dist
COPY public ./public
COPY package.json ./
VOLUME ["/data", "/downloads"]
EXPOSE 8085
CMD ["node", "dist/src/index.js"]
