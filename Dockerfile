# syntax=docker/dockerfile:1
# DeedOrbit API image.
#
# The backend runs on Node 24's built-in SQLite (`node:sqlite`) and executes the
# TypeScript sources directly via Node's type-stripping. There is no transpile
# step and no runtime npm dependency, so the image ships the source and simply
# runs `node server/index.ts`.

FROM node:24-bookworm-slim

WORKDIR /app

# The server resolves shared modules relative to the repo root and reads
# "type":"module" from the manifest, so package.json must sit beside the sources.
COPY package.json ./
COPY server ./server
COPY shared ./shared

# Bind the host's injected port (PORT) on all interfaces, and store the SQLite
# file on a writable path that can be backed by a persistent disk.
ENV NODE_ENV=production
ENV API_HOST=0.0.0.0
ENV DEEDORBIT_DB=/data/deedorbit.db

RUN mkdir -p /data

EXPOSE 8444

# On boot the server opens the database, runs every idempotent migration, and
# seeds demo data only if the database is empty.
CMD ["node", "server/index.ts"]
