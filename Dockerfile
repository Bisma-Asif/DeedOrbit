# syntax=docker/dockerfile:1
# DeedOrbit API image.
#
# The backend runs on Node 24's built-in SQLite (`node:sqlite`) and executes the
# TypeScript sources directly via Node's type-stripping. Sharp optimizes selected
# media; ffmpeg strips audio and encodes the local video files.

FROM node:24-bookworm-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*

# The server resolves shared modules relative to the repo root and reads
# "type":"module" from the manifest, so package.json must sit beside the sources.
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --prod --frozen-lockfile
COPY server ./server
COPY shared ./shared
COPY public ./public

# The Render disk is mounted at /data. Keep a read-only copy of bundled media
# for first boot and link /public/media to the persistent media directory.
RUN mkdir -p /data/media /app/static-media && \
    cp -a /app/public/media/. /app/static-media/ && \
    rm -rf /app/public/media && \
    ln -s /data/media /app/public/media

ENV NODE_ENV=production
ENV API_HOST=0.0.0.0
ENV DEEDORBIT_DB=/data/deedorbit.db
ENV MEDIA_DIR=/app/public/media
ENV MEDIA_FALLBACK_DIR=/app/static-media

EXPOSE 8444

# On boot the server opens the database, runs every idempotent migration, and
# seeds demo data only if the database is empty.
CMD ["node", "server/index.ts"]
