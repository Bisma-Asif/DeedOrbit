/** Read quoted CSV, semicolon-separated, or tab-separated text into a grid. */

export function parseDelimitedText(text: string): string[][] {
  const source = text.replace(/\r\n?/g, "\n")

  const firstLine = source.split("\n")[0] ?? ""

  const delimiters = [",", "\t", ";"]

  let delimiter = delimiters[0]

  let highestCount = -1

  for (const candidate of delimiters) {
    const count = firstLine.split(candidate).length - 1

    if (count > highestCount) {
      delimiter = candidate

      highestCount = count
    }
  }

  const rows: string[][] = []

  let row: string[] = []

  let cell = ""

  let quoted = false

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]

    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          cell += '"'

          index += 1
        } else {
          quoted = false
        }
      } else {
        cell += char
      }

      continue
    }

    if (char === '"') {
      quoted = true

      continue
    }

    if (char === delimiter) {
      row.push(cell)

      cell = ""

      continue
    }

    if (char === "\n") {
      row.push(cell)

      rows.push(row)

      row = []

      cell = ""

      continue
    }

    cell += char
  }

  row.push(cell)

  rows.push(row)

  return rows
}
