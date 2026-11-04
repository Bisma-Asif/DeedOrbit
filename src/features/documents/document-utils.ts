/**
 * Shared helpers for the embedded documents surface.
 *
 * The file reader and byte formatter are used by the list, the upload dialog, and
 * (via the list) the portal, so they live in one place rather than being copied
 * into each component. Both mirror what the server enforces so an obvious miss is
 * caught in the browser before any bytes travel.
 */

/** Read a picked file into a base64 data URL without dragging in a dependency. */

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => resolve(String(reader.result ?? ""))

    reader.onerror = () => reject(new Error("The file could not be read."))

    reader.readAsDataURL(file)
  })
}

/** Compact human-readable bytes for tile captions and error copy. */

export function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`

  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`

  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}
