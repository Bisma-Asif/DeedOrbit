import assert from "node:assert/strict"

import { once } from "node:events"

import { existsSync } from "node:fs"

import { mkdtemp, rm, writeFile } from "node:fs/promises"

import sharp from "sharp"

import { tmpdir } from "node:os"

import { join } from "node:path"

import { after, before, test } from "node:test"

import { createApp } from "./index.ts"
import { storeCandidate } from "./media.ts"

const originalMediaDirectory = process.env.MEDIA_DIR

const mediaDirectory = await mkdtemp(join(tmpdir(), "deedorbit-media-test-"))

const server = createApp()

before(async () => {
  process.env.MEDIA_DIR = mediaDirectory

  await writeFile(join(mediaDirectory, "clip.mp4"), Buffer.from("0123456789"))

  server.listen(0, "127.0.0.1")

  await once(server, "listening")
})

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })

  await rm(mediaDirectory, { recursive: true, force: true })

  if (originalMediaDirectory === undefined) delete process.env.MEDIA_DIR
  else process.env.MEDIA_DIR = originalMediaDirectory
})

test("serves local media with the correct content type", async () => {
  const address = server.address()

  assert(address && typeof address !== "string")

  const response = await fetch(
    `http://127.0.0.1:${address.port}/api/media/assets/clip.mp4`,
  )

  assert.equal(response.status, 200)

  assert.equal(response.headers.get("content-type"), "video/mp4")

  assert.equal(await response.text(), "0123456789")
})

test("supports byte ranges for local video playback", async () => {
  const address = server.address()

  assert(address && typeof address !== "string")

  const response = await fetch(
    `http://127.0.0.1:${address.port}/api/media/assets/clip.mp4`,

    { headers: { Range: "bytes=3-6" } },
  )

  assert.equal(response.status, 206)

  assert.equal(response.headers.get("content-range"), "bytes 3-6/10")

  assert.equal(await response.text(), "3456")
})

test("supports common open-ended and suffix range requests", async () => {
  const address = server.address()

  assert(address && typeof address !== "string")

  const openEnded = await fetch(
    `http://127.0.0.1:${address.port}/api/media/assets/clip.mp4`,

    { headers: { Range: "bytes=3-" } },
  )

  assert.equal(openEnded.status, 206)

  assert.equal(openEnded.headers.get("content-range"), "bytes 3-9/10")

  assert.equal(await openEnded.text(), "3456789")

  const suffix = await fetch(
    `http://127.0.0.1:${address.port}/api/media/assets/clip.mp4`,

    { headers: { Range: "bytes=-3" } },
  )

  assert.equal(suffix.status, 206)

  assert.equal(suffix.headers.get("content-range"), "bytes 7-9/10")

  assert.equal(await suffix.text(), "789")
})

test("does not serve unsupported or missing media files", async () => {
  const address = server.address()

  assert(address && typeof address !== "string")

  const unsupported = await fetch(
    `http://127.0.0.1:${address.port}/api/media/assets/CREDITS.md`,
  )

  const missing = await fetch(
    `http://127.0.0.1:${address.port}/api/media/assets/not-found.jpg`,
  )

  assert.equal(unsupported.status, 404)

  assert.equal(missing.status, 404)
})

test("keeps the media review endpoint behind authentication", async () => {
  const address = server.address()

  assert(address && typeof address !== "string")

  const response = await fetch(
    `http://127.0.0.1:${address.port}/api/platform/media/review`,
  )

  assert.equal(response.status, 401)
})

test("stores media credits in the target directory when a custom media directory is used", async () => {
  const customDirectory = await mkdtemp(
    join(tmpdir(), "deedorbit-media-custom-"),
  )

  const validPhoto = await sharp({
    create: {
      width: 1600,
      height: 900,
      channels: 3,
      background: { r: 64, g: 128, b: 255 },
    },
  })
    .jpeg()
    .toBuffer()

  const originalFetch = globalThis.fetch

  globalThis.fetch = async (input: string | URL | Request) => {
    const url = input.toString()

    if (url === "https://images.pexels.com/test-photo.jpg") {
      return new Response(new Uint8Array(validPhoto), {
        status: 200,
        headers: { "Content-Type": "image/jpeg" },
      })
    }

    throw new Error(`Unexpected fetch request: ${url}`)
  }

  try {
    await storeCandidate(
      "auth",
      {
        id: "custom-auth-candidate",
        slot: "auth",
        type: "photo",
        provider: "Pexels",
        sourceUrl: "https://www.pexels.com/photo/test-photo",
        contributor: "Demo photographer",
        description: "Modern building exterior",
        width: 1600,
        height: 900,
        duration: null,
        licenseNote:
          "Pexels License — free for personal and commercial use; attribution is not required. Source credit retained.",
        downloadUrl: "https://images.pexels.com/test-photo.jpg",
        previewUrl: "https://images.pexels.com/test-photo.jpg",
        previewType: "image/jpeg",
        score: 1,
      },
      customDirectory,
      "/media",
    )

    assert.equal(
      existsSync(join(customDirectory, "CREDITS.md")),
      true,
      "Credits should be written to the custom media directory.",
    )
  } finally {
    globalThis.fetch = originalFetch
    await rm(customDirectory, { recursive: true, force: true })
  }
})
