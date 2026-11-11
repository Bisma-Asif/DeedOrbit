import { mkdir, writeFile } from "node:fs/promises"

import { join } from "node:path"

import { MEDIA_SLOTS } from "../shared/media.ts"

import { fetchAndStoreBestCandidate } from "../server/media.ts"

const outputDirectory =
  process.env.MEDIA_DIR ?? join(process.cwd(), "public", "media")

async function main() {
  if (!process.env.PEXELS_API_KEY && !process.env.PIXABAY_API_KEY) {
    throw new Error(
      "Configure PEXELS_API_KEY in the server environment before fetching media.",
    )
  }

  await mkdir(outputDirectory, { recursive: true })

  const missing: string[] = []

  for (const slot of MEDIA_SLOTS) {
    try {
      const result = await fetchAndStoreBestCandidate(
        slot.key,

        outputDirectory,

        "/media",
      )

      if (!result) {
        if (!slot.optional) missing.push(slot.label)

        console.log(`${slot.label}: no suitable candidate found`)

        continue
      }

      console.log(
        `${slot.label}: saved ${result.candidate.provider} media by ${result.candidate.contributor}`,
      )
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Media fetch failed."

      console.error(`${slot.label}: ${message}`)

      if (!slot.optional) missing.push(slot.label)
    }
  }

  const creditsPath = join(outputDirectory, "CREDITS.md")

  try {
    await writeFile(
      creditsPath,

      "# Media credits\n\nNo media has been selected yet.\n",

      { flag: "wx" },
    )
  } catch (error) {
    if (
      !(error instanceof Error && "code" in error && error.code === "EEXIST")
    ) {
      throw error
    }
  }

  if (missing.length > 0) {
    console.error(`Missing required media slots: ${missing.join(", ")}`)

    process.exitCode = 1
  } else {
    console.log(
      "Required media slots fetched. Review images and clips in /admin/media-review.",
    )
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Media fetch failed."

  console.error(message)

  process.exitCode = 1
})
