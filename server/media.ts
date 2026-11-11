import { createReadStream, existsSync } from "node:fs"

import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises"

import { basename, extname, join } from "node:path"

import { spawnSync } from "node:child_process"

import { tmpdir } from "node:os"

import { mkdtemp, rm } from "node:fs/promises"

import sharp from "sharp"

import { get } from "./db.ts"

import {
  badRequest,
  notFound,
  readJsonBody,
  type RequestContext,
} from "./http.ts"

import { requireAuth, writeAudit, type GuardedContext } from "./middleware.ts"

import {
  INITIAL_LANDING_MEDIA,
  MEDIA_SLOTS,
  type LandingMediaConfig,
  type MediaManifest,
  type MediaSlotDefinition,
  type StoredMediaAsset,
} from "../shared/media.ts"

interface Candidate {
  id: string

  slot: string

  type: "photo" | "video"

  provider: "Pexels" | "Pixabay"

  sourceUrl: string

  contributor: string

  description: string

  width: number

  height: number

  duration: number | null

  licenseNote: string

  downloadUrl: string

  previewUrl: string

  previewType: string

  score: number
}

interface PublicCandidate
  extends Omit<Candidate, "downloadUrl" | "previewUrl" | "score"> {
  previewUrl: string
}

interface PexelsPhoto {
  id: number

  url: string

  photographer: string

  width: number

  height: number

  alt: string | null

  src: {
    original: string

    large: string
  }
}

interface PexelsVideoFile {
  link: string

  width: number

  height: number

  file_type: string

  quality: string
}

interface PexelsUser {
  name: string

  url: string
}

interface PexelsVideo {
  id: number

  url: string

  user: PexelsUser

  width: number

  height: number

  duration: number

  video_files: PexelsVideoFile[]
}

interface PixabayPhoto {
  id: number

  pageURL: string

  user: string

  tags: string

  imageWidth: number

  imageHeight: number

  largeImageURL: string

  webformatURL: string
}

interface PixabayVideoFile {
  url: string

  width: number

  height: number

  size: number
}

interface PixabayVideo {
  id: number

  pageURL: string

  user: string

  tags: string

  duration: number

  videos: {
    large?: PixabayVideoFile

    medium?: PixabayVideoFile

    small?: PixabayVideoFile

    tiny?: PixabayVideoFile
  }
}

const candidates = new Map<string, Candidate>()

const LICENSE_NOTES = {
  Pexels:
    "Pexels License — free for personal and commercial use; attribution is not required. Source credit retained.",

  Pixabay:
    "Pixabay Content License — source and contributor retained; confirm the current license terms before publication.",
}

const UNSAFE_DESCRIPTION =
  /\b(person|people|face|faces|portrait|man|woman|child|children|brand|logo|watermark|signage|billboard|editorial)\b/i

function mediaDirectory(): string {
  return process.env.MEDIA_DIR ?? join(process.cwd(), "public", "media")
}

function fallbackMediaDirectory(): string {
  return (
    process.env.MEDIA_FALLBACK_DIR ?? join(process.cwd(), "public", "media")
  )
}

function manifestPath(directory = mediaDirectory()): string {
  return join(directory, "media-config.json")
}

function platformMediaGuard(ctx: RequestContext): GuardedContext {
  const guarded = requireAuth(ctx)

  const role = get<{ scope: string }>(
    "SELECT scope FROM roles WHERE role_id = ?",

    guarded.roleId,
  )

  if (role?.scope !== "platform") {
    writeAudit(
      guarded,

      "permission.denied.platform_only",

      "role",

      guarded.roleId,

      { path: guarded.pathname },

      guarded.ip,
    )

    throw notFound("That endpoint does not exist")
  }

  return guarded
}

function slotDefinition(key: string): MediaSlotDefinition {
  const slot = MEDIA_SLOTS.find((item) => item.key === key)

  if (!slot) throw badRequest("Choose a supported media slot")

  return slot
}

function isLandscape(width: number, height: number): boolean {
  return width >= 1000 && height >= 560 && width / height >= 1.2
}

function candidateScore(
  width: number,
  height: number,
  duration: number | null,
) {
  const megapixels = Math.min((width * height) / 1_000_000, 8)

  const ratio = width / height

  const aspectScore = Math.max(0, 1 - Math.abs(ratio - 16 / 9))

  const durationScore =
    duration === null ? 0 : Math.max(0, 1 - Math.abs(duration - 16) / 20)

  return megapixels * 0.8 + aspectScore * 3 + durationScore
}

function isSafeDescription(text: string): boolean {
  return !UNSAFE_DESCRIPTION.test(text)
}

function candidateKey(slot: string, candidateId: string): string {
  return `${slot}:${candidateId}`
}

function toPublicCandidate(candidate: Candidate): PublicCandidate {
  return {
    id: candidate.id,

    slot: candidate.slot,

    type: candidate.type,

    provider: candidate.provider,

    sourceUrl: candidate.sourceUrl,

    contributor: candidate.contributor,

    description: candidate.description,

    width: candidate.width,

    height: candidate.height,

    duration: candidate.duration,

    licenseNote: candidate.licenseNote,

    previewType: candidate.previewType,

    previewUrl: `/api/platform/media/candidates/${encodeURIComponent(candidate.id)}/preview?slot=${encodeURIComponent(candidate.slot)}`,
  }
}

async function pexelsJson<T>(url: URL): Promise<T> {
  const key = process.env.PEXELS_API_KEY

  if (!key)
    throw badRequest("PEXELS_API_KEY is not configured on the API server")

  let response: Response

  try {
    response = await fetch(url, {
      headers: { Authorization: key },

      signal: AbortSignal.timeout(20_000),
    })
  } catch {
    throw badRequest("Pexels could not be reached. Try the media search again.")
  }

  if (!response.ok) {
    throw badRequest(
      response.status === 401 || response.status === 403
        ? "The Pexels API credentials were rejected by Pexels."
        : `Pexels search failed with status ${response.status}.`,
    )
  }

  return (await response.json()) as T
}

async function pixabayJson<T>(url: URL): Promise<T> {
  let response: Response

  try {
    response = await fetch(url, { signal: AbortSignal.timeout(20_000) })
  } catch {
    throw badRequest(
      "Pixabay could not be reached. Try the media search again.",
    )
  }

  if (!response.ok) {
    throw badRequest(`Pixabay search failed with status ${response.status}.`)
  }

  return (await response.json()) as T
}

function normalizePexelsPhoto(
  slot: string,
  photo: PexelsPhoto,
): Candidate | null {
  const description = photo.alt ?? ""

  if (
    !isLandscape(photo.width, photo.height) ||
    !isSafeDescription(description)
  )
    return null

  return {
    id: `pexels-photo-${photo.id}`,

    slot,

    type: "photo",

    provider: "Pexels",

    sourceUrl: photo.url,

    contributor: photo.photographer,

    description,

    width: photo.width,

    height: photo.height,

    duration: null,

    licenseNote: LICENSE_NOTES.Pexels,

    downloadUrl: photo.src.original,

    previewUrl: photo.src.large,

    previewType: "image/jpeg",

    score: candidateScore(photo.width, photo.height, null),
  }
}

function normalizePexelsVideo(
  slot: string,

  definition: MediaSlotDefinition,

  video: PexelsVideo,
): Candidate | null {
  if (
    video.duration < (slot === "hero" ? 10 : 4) ||
    video.duration > (slot === "hero" ? 25 : 20)
  )
    return null

  const files = video.video_files

    .filter(
      (file) =>
        file.file_type === "video/mp4" &&
        isLandscape(file.width, file.height) &&
        file.width >= 1280 &&
        file.width <= 1920 &&
        file.height <= 1080,
    )

    .sort((a, b) => b.width * b.height - a.width * a.height)

  const download = files[0]

  if (!download) return null

  const preview = video.video_files

    .filter(
      (file) =>
        file.file_type === "video/mp4" &&
        file.width <= 640 &&
        file.width / file.height >= 1.2,
    )

    .sort((a, b) => b.width - a.width)[0]

  const description = `${definition.label} video`

  return {
    id: `pexels-video-${video.id}`,

    slot,

    type: "video",

    provider: "Pexels",

    sourceUrl: video.url,

    contributor: video.user.name,

    description,

    width: download.width,

    height: download.height,

    duration: video.duration,

    licenseNote: LICENSE_NOTES.Pexels,

    downloadUrl: download.link,

    previewUrl: preview?.link ?? download.link,

    previewType: "video/mp4",

    score: candidateScore(download.width, download.height, video.duration),
  }
}

function normalizePixabayPhoto(
  slot: string,
  photo: PixabayPhoto,
): Candidate | null {
  if (
    !isLandscape(photo.imageWidth, photo.imageHeight) ||
    !isSafeDescription(photo.tags)
  )
    return null

  return {
    id: `pixabay-photo-${photo.id}`,

    slot,

    type: "photo",

    provider: "Pixabay",

    sourceUrl: photo.pageURL,

    contributor: photo.user,

    description: photo.tags,

    width: photo.imageWidth,

    height: photo.imageHeight,

    duration: null,

    licenseNote: LICENSE_NOTES.Pixabay,

    downloadUrl: photo.largeImageURL,

    previewUrl: photo.webformatURL,

    previewType: "image/jpeg",

    score: candidateScore(photo.imageWidth, photo.imageHeight, null),
  }
}

function normalizePixabayVideo(
  slot: string,

  definition: MediaSlotDefinition,

  video: PixabayVideo,
): Candidate | null {
  if (
    video.duration < (slot === "hero" ? 10 : 4) ||
    video.duration > (slot === "hero" ? 25 : 20) ||
    !isSafeDescription(video.tags)
  )
    return null

  const files = [video.videos.large, video.videos.medium]

    .filter((file): file is PixabayVideoFile => Boolean(file))

    .filter(
      (file) =>
        file.width >= 1280 &&
        file.width <= 1920 &&
        file.height <= 1080 &&
        isLandscape(file.width, file.height),
    )

    .sort((a, b) => b.width * b.height - a.width * a.height)

  const download = files[0]

  if (!download) return null

  const preview =
    [video.videos.tiny, video.videos.small].find(
      (file) => file && file.width <= 640 && file.width / file.height >= 1.2,
    ) ?? download

  return {
    id: `pixabay-video-${video.id}`,

    slot,

    type: "video",

    provider: "Pixabay",

    sourceUrl: video.pageURL,

    contributor: video.user,

    description: video.tags || definition.label,

    width: download.width,

    height: download.height,

    duration: video.duration,

    licenseNote: LICENSE_NOTES.Pixabay,

    downloadUrl: download.url,

    previewUrl: preview.url,

    previewType: "video/mp4",

    score: candidateScore(download.width, download.height, video.duration),
  }
}

async function searchPexels(
  definition: MediaSlotDefinition,
): Promise<Candidate[]> {
  const results: Candidate[] = []

  for (const query of definition.queries) {
    const url = new URL(
      definition.type === "photo"
        ? "https://api.pexels.com/v1/search"
        : "https://api.pexels.com/videos/search",
    )

    url.searchParams.set("query", query)

    url.searchParams.set("orientation", "landscape")

    url.searchParams.set("per_page", "15")

    if (definition.type === "photo") {
      const payload = await pexelsJson<{ photos?: PexelsPhoto[] }>(url)

      for (const photo of payload.photos ?? []) {
        const candidate = normalizePexelsPhoto(definition.key, photo)

        if (candidate) results.push(candidate)
      }
    } else {
      const payload = await pexelsJson<{ videos?: PexelsVideo[] }>(url)

      for (const video of payload.videos ?? []) {
        const candidate = normalizePexelsVideo(
          definition.key,
          definition,
          video,
        )

        if (candidate) results.push(candidate)
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 120))
  }

  return results
}

async function searchPixabay(
  definition: MediaSlotDefinition,
): Promise<Candidate[]> {
  const key = process.env.PIXABAY_API_KEY

  if (!key) return []

  const results: Candidate[] = []

  for (const query of definition.queries) {
    const url = new URL(
      definition.type === "photo"
        ? "https://pixabay.com/api/"
        : "https://pixabay.com/api/videos/",
    )

    url.searchParams.set("key", key)

    url.searchParams.set("q", query)

    url.searchParams.set("safesearch", "true")

    url.searchParams.set("per_page", "15")

    if (definition.type === "photo") {
      url.searchParams.set("image_type", "photo")

      url.searchParams.set("orientation", "horizontal")

      const payload = await pixabayJson<{ hits?: PixabayPhoto[] }>(url)

      for (const photo of payload.hits ?? []) {
        const candidate = normalizePixabayPhoto(definition.key, photo)

        if (candidate) results.push(candidate)
      }
    } else {
      const payload = await pixabayJson<{ hits?: PixabayVideo[] }>(url)

      for (const video of payload.hits ?? []) {
        const candidate = normalizePixabayVideo(
          definition.key,
          definition,
          video,
        )

        if (candidate) results.push(candidate)
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 120))
  }

  return results
}

async function rankPhotoQuality(results: Candidate[]): Promise<void> {
  const photoCandidates = results

    .filter((candidate) => candidate.type === "photo")

    .sort((a, b) => b.score - a.score)

    .slice(0, 8)

  for (const candidate of photoCandidates) {
    const preview = await downloadRemote(candidate.previewUrl)

    const resized = sharp(preview).resize(96, 96, { fit: "inside" })

    const stats = await resized.stats()

    const colorChannels = stats.channels.slice(0, 3)

    const brightness =
      colorChannels.reduce((sum, channel) => sum + channel.mean, 0) /
      colorChannels.length

    const edgeStats = await sharp(preview)

      .resize(96, 96, { fit: "inside" })

      .greyscale()

      .convolve({
        width: 3,

        height: 3,

        kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0],
      })

      .stats()

    const brightnessScore = Math.max(0, 1 - Math.abs(brightness - 155) / 165)

    const sharpnessScore = Math.min(edgeStats.channels[0]!.stdev / 50, 1)

    candidate.score += brightnessScore * 0.8 + sharpnessScore * 1.2
  }
}

export async function searchMediaCandidates(
  slotKey: string,

  excludedIds: string[] = [],
): Promise<PublicCandidate[]> {
  const definition = slotDefinition(slotKey)

  if (!process.env.PEXELS_API_KEY && !process.env.PIXABAY_API_KEY) {
    throw badRequest(
      "Configure PEXELS_API_KEY on the API server before searching for media.",
    )
  }

  let results: Candidate[] = []

  if (process.env.PEXELS_API_KEY) {
    results = await searchPexels(definition)
  }

  if (results.length < 5 && process.env.PIXABAY_API_KEY) {
    results = results.concat(await searchPixabay(definition))
  }

  const excluded = new Set(excludedIds)

  const unique = new Map<string, Candidate>()

  for (const result of results) {
    if (excluded.has(result.id) || unique.has(result.id)) continue

    unique.set(result.id, result)
  }

  const allCandidates = [...unique.values()]

  await rankPhotoQuality(allCandidates)

  const ranked = allCandidates

    .sort((a, b) => b.score - a.score)

    .slice(0, 12)

  for (const candidate of ranked) {
    candidates.set(candidateKey(slotKey, candidate.id), candidate)
  }

  return ranked.map(toPublicCandidate)
}

export async function fetchAndStoreBestCandidate(
  slotKey: string,

  directory: string,

  pathPrefix = "/media",
): Promise<StoredCandidateResult | null> {
  const found = await searchMediaCandidates(slotKey)

  const candidate = found[0]

  if (!candidate) return null

  const stored = candidates.get(candidateKey(slotKey, candidate.id))

  if (!stored)
    throw notFound("The selected media candidate is no longer available.")

  const manifest = await storeCandidate(slotKey, stored, directory, pathPrefix)

  return { candidate, manifest }
}

function allowedMediaUrl(value: string): URL {
  const url = new URL(value)

  const allowedHosts = [
    "images.pexels.com",

    "videos.pexels.com",

    "cdn.pixabay.com",
  ]

  if (url.protocol !== "https:" || !allowedHosts.includes(url.hostname)) {
    throw badRequest(
      "The selected media source is not an approved provider URL.",
    )
  }

  return url
}

async function downloadRemote(urlValue: string): Promise<Buffer> {
  let response: Response

  try {
    response = await fetch(allowedMediaUrl(urlValue), {
      signal: AbortSignal.timeout(45_000),
    })
  } catch {
    throw badRequest(
      "The selected media could not be downloaded from its source.",
    )
  }

  if (!response.ok) {
    throw badRequest(
      `The selected media source returned status ${response.status}.`,
    )
  }

  const chunks: Uint8Array[] = []

  let size = 0

  const reader = response.body?.getReader()

  if (!reader) throw badRequest("The selected media source returned no file.")

  while (true) {
    const { done, value } = await reader.read()

    if (done) break

    size += value.byteLength

    if (size > 100 * 1024 * 1024) {
      await reader.cancel()

      throw badRequest("The selected media exceeds the 100 MB download limit.")
    }

    chunks.push(value)
  }

  return Buffer.concat(chunks)
}

function findFfmpeg(): boolean {
  const result = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" })

  return result.status === 0
}

function supportsFfmpegEncoder(encoder: string): boolean {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-encoders"], {
    encoding: "utf8",

    stdio: ["ignore", "pipe", "ignore"],
  })

  return result.status === 0 && result.stdout.includes(encoder)
}

function runFfmpeg(args: string[]): void {
  const result = spawnSync("ffmpeg", args, { stdio: "ignore" })

  if (result.status !== 0) {
    throw badRequest(
      "Video conversion failed. Check the API server ffmpeg build.",
    )
  }
}

async function convertVideo(
  inputPath: string,

  outputPath: string,

  maxBytes: number,

  duration: number,

  webmPath?: string,
): Promise<void> {
  if (!findFfmpeg()) {
    await copyFile(inputPath, outputPath)

    if (webmPath) await rm(webmPath, { force: true })

    return
  }

  const qualities = [25, 29, 33, 37]

  for (const quality of qualities) {
    runFfmpeg([
      "-y",

      "-i",

      inputPath,

      "-t",

      String(duration),

      "-vf",

      "scale=1280:-2:force_original_aspect_ratio=decrease",

      "-an",

      "-c:v",

      "libx264",

      "-preset",

      "slow",

      "-crf",

      String(quality),

      "-pix_fmt",

      "yuv420p",

      "-movflags",

      "+faststart",

      outputPath,
    ])

    if ((await stat(outputPath)).size <= maxBytes) break
  }

  if ((await stat(outputPath)).size > maxBytes) {
    throw badRequest(
      `The converted video exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB size limit.`,
    )
  }

  if (webmPath && supportsFfmpegEncoder("libvpx-vp9")) {
    for (const quality of [36, 40, 44]) {
      runFfmpeg([
        "-y",

        "-i",

        inputPath,

        "-t",

        String(duration),

        "-vf",

        "scale=1280:-2:force_original_aspect_ratio=decrease",

        "-an",

        "-c:v",

        "libvpx-vp9",

        "-crf",

        String(quality),

        "-b:v",

        "0",

        webmPath,
      ])

      if ((await stat(webmPath)).size <= maxBytes) break
    }

    if ((await stat(webmPath)).size > maxBytes) {
      throw badRequest(
        `The converted WebM exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB size limit.`,
      )
    }
  }
}

async function makeVideoPoster(
  inputPath: string,

  outputPath: string,

  fallbackPath: string,
): Promise<void> {
  if (findFfmpeg()) {
    runFfmpeg([
      "-y",

      "-ss",

      "1",

      "-i",

      inputPath,

      "-frames:v",

      "1",

      "-q:v",

      "2",

      outputPath,
    ])

    return
  }

  await copyFile(fallbackPath, outputPath)
}

async function makePhotoVariants(
  input: Buffer,

  directory: string,

  fileName: string,
): Promise<void> {
  const base = basename(fileName, extname(fileName))

  const image = sharp(input).rotate()

  await image

    .clone()

    .resize({ width: 800, withoutEnlargement: true })

    .jpeg({ quality: 84, mozjpeg: true })

    .toFile(join(directory, fileName))

  for (const width of [800, 1600]) {
    await image

      .clone()

      .resize({ width, withoutEnlargement: true })

      .webp({ quality: 82 })

      .toFile(join(directory, `${base}-${width}.webp`))

    await image

      .clone()

      .resize({ width, withoutEnlargement: true })

      .avif({ quality: 58 })

      .toFile(join(directory, `${base}-${width}.avif`))
  }
}

async function makeOpenGraphImage(
  directory: string,

  sourcePath: string,
): Promise<void> {
  const overlay = Buffer.from(
    '<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="455" width="1200" height="175" fill="#0f172a" fill-opacity=".72"/><rect x="72" y="500" width="7" height="64" rx="3" fill="#34d399"/><text x="102" y="548" fill="#fff" font-family="Inter,Arial,sans-serif" font-size="54" font-weight="700">DeedOrbit</text></svg>',
  )

  await sharp(sourcePath)

    .resize(1200, 630, { fit: "cover", position: "attention" })

    .composite([{ input: overlay }])

    .jpeg({ quality: 88, mozjpeg: true })

    .toFile(join(directory, "og-cover.jpg"))
}

function versionedPath(prefix: string, fileName: string): string {
  return `${prefix}/${fileName}?v=${Date.now()}`
}

function buildLandingMedia(
  assets: Record<string, StoredMediaAsset>,

  prefix: string,

  directory: string,
): LandingMediaConfig {
  const media: LandingMediaConfig = {
    ...INITIAL_LANDING_MEDIA,

    gallery: { ...INITIAL_LANDING_MEDIA.gallery },

    clips: { ...INITIAL_LANDING_MEDIA.clips },

    clipWebm: { ...INITIAL_LANDING_MEDIA.clipWebm },

    clipPosters: { ...INITIAL_LANDING_MEDIA.clipPosters },

    features: { ...INITIAL_LANDING_MEDIA.features },
  }

  const hasHeroWebm =
    fileExists(join(directory, "hero.webm")) ||
    fileExists(join(fallbackMediaDirectory(), "hero.webm"))

  for (const [slot, asset] of Object.entries(assets)) {
    const src = versionedPath(prefix, asset.fileName)

    if (slot === "og-base") {
      media.ogImage = versionedPath(prefix, "og-cover.jpg")
    } else if (slot === "hero") {
      media.heroVideo = src

      media.heroPoster = versionedPath(prefix, "hero-poster.jpg")

      media.heroVideoWebm = versionedPath(prefix, "hero.webm")

      if (!hasHeroWebm) media.heroVideoWebm = ""
    } else if (slot.startsWith("gallery:")) {
      const category = slot.slice("gallery:".length)

      media.gallery[category] = src

      if (category === "towers") media.gallery.towers = src
    } else if (slot.startsWith("clip:")) {
      const category = slot.slice("clip:".length)

      media.clips[category] = src

      const webmPath = join(
        directory,

        `${basename(asset.fileName, extname(asset.fileName))}.webm`,
      )

      const fallbackWebmPath = join(
        fallbackMediaDirectory(),

        `${basename(asset.fileName, extname(asset.fileName))}.webm`,
      )

      media.clipWebm[category] =
        fileExists(webmPath) || fileExists(fallbackWebmPath)
          ? versionedPath(
              prefix,

              `${basename(asset.fileName, extname(asset.fileName))}.webm`,
            )
          : ""

      media.clipPosters[category] = versionedPath(
        prefix,

        `${basename(asset.fileName, extname(asset.fileName))}-poster.jpg`,
      )
    } else if (slot === "auth") {
      media.loginSide = src
    } else if (slot.startsWith("feature:")) {
      media.features[slot.slice("feature:".length)] = src
    }
  }

  return media
}

function fileExists(path: string): boolean {
  return existsSync(path)
}

async function readManifest(
  directory = mediaDirectory(),
): Promise<MediaManifest> {
  const path = manifestPath(directory)

  try {
    return JSON.parse(await readFile(path, "utf8")) as MediaManifest
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      const fallbackPath = manifestPath(fallbackMediaDirectory())

      if (fallbackPath !== path && fileExists(fallbackPath)) {
        return JSON.parse(await readFile(fallbackPath, "utf8")) as MediaManifest
      }

      return {
        version: 1,

        updatedAt: new Date().toISOString(),

        assets: {},

        media: buildLandingMedia({}, "/media", directory),
      }
    }

    throw error
  }
}

function creditFiles(
  asset: StoredMediaAsset,

  directory = mediaDirectory(),
): string[] {
  const extension = extname(asset.fileName)

  const base = basename(asset.fileName, extension)

  if (asset.slot === "hero" || asset.slot.startsWith("clip:")) {
    return [
      asset.fileName,

      ...(existsSync(join(directory, `${base}.webm`)) ||
      existsSync(join(fallbackMediaDirectory(), `${base}.webm`))
        ? [`${base}.webm`]
        : []),

      asset.slot === "hero" ? "hero-poster.jpg" : `${base}-poster.jpg`,
    ]
  }

  const files = [asset.fileName]

  for (const width of [800, 1600]) {
    files.push(`${base}-${width}.webp`, `${base}-${width}.avif`)
  }

  if (asset.slot === "og-base") {
    files.push("hero-poster.jpg", "og-cover.jpg")
  }

  return files
}

async function writeCredits(
  directory: string,

  assets: Record<string, StoredMediaAsset>,
): Promise<void> {
  const rows = Object.values(assets).flatMap((asset) =>
    creditFiles(asset, directory).map(
      (fileName) =>
        `| [\`${fileName}\`](./${fileName}) | ${asset.provider} | [${escapeMarkdown(asset.sourceUrl)}](${escapeMarkdown(asset.sourceUrl)}) | ${escapeMarkdown(asset.contributor)} | ${escapeMarkdown(asset.licenseNote)} |`,
    ),
  )

  const contents = [
    "# Media credits",

    "",

    "Each listed file is a locally stored derivative of its credited source. No landing-page media is hotlinked.",

    "",

    "| Local file | Provider | Source page | Photographer / videographer | License note |",

    "| --- | --- | --- | --- | --- |",

    ...rows,

    "",
  ].join("\n")

  await writeFile(join(directory, "CREDITS.md"), contents, "utf8")
}

function escapeMarkdown(value: string): string {
  return value.replace(/[|\\[\]]/g, "\\$&")
}

async function writeManifest(
  directory: string,

  assets: Record<string, StoredMediaAsset>,

  pathPrefix: string,
): Promise<MediaManifest> {
  const media = buildLandingMedia(assets, pathPrefix, directory)

  const manifest: MediaManifest = {
    version: 1,

    updatedAt: new Date().toISOString(),

    assets,

    media,
  }

  await writeFile(
    manifestPath(directory),
    `${JSON.stringify(manifest, null, 2)}\n`,
  )

  await writeCredits(directory, assets)

  return manifest
}

export async function storeCandidate(
  slotKey: string,

  candidate: Candidate,

  directory = mediaDirectory(),

  pathPrefix = "/api/media/assets",
): Promise<MediaManifest> {
  const definition = slotDefinition(slotKey)

  if (candidate.slot !== slotKey || candidate.type !== definition.type) {
    throw badRequest("The selected candidate does not match this media slot.")
  }

  await mkdir(directory, { recursive: true })

  const tempDir = await mkdtemp(join(tmpdir(), "deedorbit-media-"))

  try {
    const downloaded = await downloadRemote(candidate.downloadUrl)

    if (definition.type === "photo") {
      await makePhotoVariants(downloaded, directory, definition.fileName)

      if (slotKey === "og-base") {
        await makeOpenGraphImage(
          directory,

          join(directory, definition.fileName),
        )

        await sharp(downloaded)

          .rotate()

          .resize({ width: 1600, withoutEnlargement: true })

          .jpeg({ quality: 84 })

          .toFile(join(directory, "hero-poster.jpg"))
      }
    } else {
      const source = join(tempDir, "source.mp4")

      await writeFile(source, downloaded)

      const base = basename(definition.fileName, extname(definition.fileName))

      const webmPath = join(directory, `${base}.webm`)

      await convertVideo(
        source,

        join(directory, definition.fileName),

        slotKey === "hero" ? 6 * 1024 * 1024 : 3 * 1024 * 1024,

        candidate.duration ?? 20,

        webmPath,
      )

      const posterName =
        slotKey === "hero" ? "hero-poster.jpg" : `${base}-poster.jpg`

      const localFallbackPoster = join(directory, "og-base.jpg")

      const fallbackPoster = fileExists(localFallbackPoster)
        ? localFallbackPoster
        : join(fallbackMediaDirectory(), "og-base.jpg")

      if (fileExists(fallbackPoster)) {
        await makeVideoPoster(
          source,

          join(directory, posterName),

          fallbackPoster,
        )
      } else if (findFfmpeg()) {
        runFfmpeg([
          "-y",

          "-ss",

          "1",

          "-i",

          source,

          "-frames:v",

          "1",

          "-q:v",

          "2",

          join(directory, posterName),
        ])
      } else {
        throw badRequest(
          "Select an OG / hero photo before this video so a local poster can be generated.",
        )
      }
    }

    const old = await readManifest(directory)

    const asset: StoredMediaAsset = {
      slot: slotKey,

      fileName: definition.fileName,

      sourceUrl: candidate.sourceUrl,

      contributor: candidate.contributor,

      licenseNote: candidate.licenseNote,

      provider: candidate.provider,

      candidateId: candidate.id,

      alt: candidate.description,

      selectedAt: new Date().toISOString(),
    }

    const assets = { ...old.assets, [slotKey]: asset }

    if (slotKey === "hero" || slotKey === "og-base") {
      const hero = assets.hero

      const og = assets["og-base"]

      if (hero && og) {
        const localOgBase = join(directory, "og-base.jpg")

        const fallbackOgBase = join(fallbackMediaDirectory(), "og-base.jpg")

        await makeOpenGraphImage(
          directory,

          fileExists(localOgBase) ? localOgBase : fallbackOgBase,
        )
      }
    }

    return await writeManifest(directory, assets, pathPrefix)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

export async function getPublicMediaConfig(): Promise<{
  media: LandingMediaConfig | null
}> {
  const manifest = await readManifest()

  const hasSelectedAssets = Object.keys(manifest.assets).length > 0

  return { media: hasSelectedAssets ? manifest.media : null }
}

interface CandidateSearchBody {
  slot?: unknown

  excludeIds?: unknown
}

interface CandidateSelectBody {
  slot?: unknown

  candidateId?: unknown

  visuallyReviewed?: unknown
}

interface StoredCandidateResult {
  candidate: PublicCandidate

  manifest: MediaManifest
}

export async function listMediaReview(ctx: RequestContext) {
  platformMediaGuard(ctx)

  const manifest = await readManifest()

  return {
    slots: MEDIA_SLOTS.map((definition) => ({
      key: definition.key,

      label: definition.label,

      type: definition.type,

      optional: Boolean(definition.optional),

      selected: manifest.assets[definition.key] ?? null,

      previewUrl: manifest.assets[definition.key]
        ? `/api/media/assets/${encodeURIComponent(manifest.assets[definition.key]!.fileName)}`
        : null,
    })),

    updatedAt: manifest.updatedAt,
  }
}

export async function findMediaCandidates(ctx: RequestContext) {
  platformMediaGuard(ctx)

  const body = await readJsonBody<CandidateSearchBody>(ctx.req)

  if (typeof body.slot !== "string")
    throw badRequest("A media slot is required.")

  const excluded = Array.isArray(body.excludeIds)
    ? body.excludeIds

        .filter((id): id is string => typeof id === "string")

        .slice(0, 100)
    : []

  const found = await searchMediaCandidates(body.slot, excluded)

  return { candidates: found }
}

export async function selectMediaCandidate(ctx: RequestContext) {
  const guarded = platformMediaGuard(ctx)

  const body = await readJsonBody<CandidateSelectBody>(ctx.req)

  if (
    typeof body.slot !== "string" ||
    typeof body.candidateId !== "string" ||
    body.visuallyReviewed !== true
  ) {
    throw badRequest(
      "Choose a candidate and confirm the visible content and license review.",
    )
  }

  const candidate = candidates.get(candidateKey(body.slot, body.candidateId))

  if (!candidate) {
    throw notFound(
      "That candidate expired. Fetch candidates for this slot again.",
    )
  }

  const manifest = await storeCandidate(body.slot, candidate)

  writeAudit(
    guarded,

    "platform.media.selected",

    "media",

    body.slot,

    { fileName: candidate.slot, provider: candidate.provider },

    guarded.ip,
  )

  return {
    slots: MEDIA_SLOTS.map((definition) => ({
      key: definition.key,

      label: definition.label,

      type: definition.type,

      optional: Boolean(definition.optional),

      selected: manifest.assets[definition.key] ?? null,

      previewUrl: manifest.assets[definition.key]
        ? `/api/media/assets/${encodeURIComponent(manifest.assets[definition.key]!.fileName)}`
        : null,
    })),

    updatedAt: manifest.updatedAt,
  }
}

export async function previewMediaCandidate(ctx: RequestContext) {
  platformMediaGuard(ctx)

  const slot = ctx.query.get("slot") ?? ""

  const candidateId = ctx.params.candidateId ?? ""

  if (!/^[a-z0-9-]{1,100}$/i.test(candidateId)) {
    throw badRequest("Invalid media candidate.")
  }

  const candidate = candidates.get(candidateKey(slot, candidateId))

  if (!candidate) throw notFound("That candidate expired. Search again.")

  const buffer = await downloadRemote(candidate.previewUrl)

  ctx.res.writeHead(200, {
    "Content-Type": candidate.previewType,

    "Content-Length": buffer.byteLength,

    "Cache-Control": "private, no-store",

    "X-Content-Type-Options": "nosniff",
  })

  ctx.res.end(buffer)
}

const MIME_TYPES: Record<string, string> = {
  ".avif": "image/avif",

  ".jpg": "image/jpeg",

  ".jpeg": "image/jpeg",

  ".mp4": "video/mp4",

  ".webm": "video/webm",

  ".webp": "image/webp",
}

interface ParsedRange {
  start: number

  end: number
}

function parseRangeHeader(
  range: string | undefined,
  fileSize: number,
): ParsedRange | null {
  if (!range) return null

  const match = /^bytes=(.+)$/.exec(range)

  if (!match) return null

  const item = match[1]

  if (item.includes(",")) return null

  const suffixMatch = /^-(\d+)$/.exec(item)

  if (suffixMatch) {
    const length = Number(suffixMatch[1])

    if (!Number.isFinite(length) || length <= 0) return null

    const start = Math.max(fileSize - length, 0)

    return { start, end: fileSize - 1 }
  }

  const rangeMatch = /^(\d*)-(\d*)$/.exec(item)

  if (!rangeMatch) return null

  const startValue = rangeMatch[1]
  const endValue = rangeMatch[2]

  const start = startValue === "" ? 0 : Number(startValue)

  if (!Number.isFinite(start) || start < 0 || start >= fileSize) return null

  if (endValue === "") {
    return { start, end: fileSize - 1 }
  }

  const end = Number(endValue)

  if (!Number.isFinite(end) || end < start || end >= fileSize) return null

  return { start, end }
}

export async function serveMediaAsset(ctx: RequestContext) {
  const fileName = basename(ctx.params.fileName ?? "")

  if (
    !fileName ||
    fileName !== ctx.params.fileName ||
    !/^[a-z0-9][a-z0-9._-]{0,100}$/i.test(fileName)
  ) {
    throw notFound("That media file does not exist.")
  }

  let path = join(mediaDirectory(), fileName)

  let file

  try {
    file = await stat(path)
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      path = join(fallbackMediaDirectory(), fileName)

      try {
        file = await stat(path)
      } catch (fallbackError) {
        if (
          fallbackError instanceof Error &&
          "code" in fallbackError &&
          fallbackError.code === "ENOENT"
        ) {
          throw notFound("That media file does not exist.")
        }

        throw fallbackError
      }
    } else {
      throw error
    }
  }

  if (!file.isFile()) throw notFound("That media file does not exist.")

  const type = MIME_TYPES[extname(fileName).toLowerCase()]

  if (!type) throw notFound("That media file type is not served.")

  const range = ctx.req.headers.range

  if (range) {
    const parsedRange = parseRangeHeader(range, file.size)

    if (!parsedRange) {
      ctx.res.writeHead(416, { "Content-Range": `bytes */${file.size}` })

      ctx.res.end()

      return
    }

    const { start, end } = parsedRange

    ctx.res.writeHead(206, {
      "Accept-Ranges": "bytes",

      "Cache-Control": "public, max-age=60",

      "Content-Length": end - start + 1,

      "Content-Range": `bytes ${start}-${end}/${file.size}`,

      "Content-Type": type,

      "X-Content-Type-Options": "nosniff",
    })

    createReadStream(path, { start, end }).pipe(ctx.res)

    return
  }

  ctx.res.writeHead(200, {
    "Accept-Ranges": "bytes",

    "Cache-Control": "public, max-age=60",

    "Content-Length": file.size,

    "Content-Type": type,

    "X-Content-Type-Options": "nosniff",
  })

  createReadStream(path).pipe(ctx.res)
}
