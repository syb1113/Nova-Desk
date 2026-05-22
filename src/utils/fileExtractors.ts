/**
 * Extract text from DOCX and XLSX files using native browser APIs.
 * Both formats are ZIP archives containing XML files.
 */

// ── DOCX ─────────────────────────────────────────────────────────────────────

export async function extractDocxText(file: File): Promise<string> {
  const zip = await readZipAsMap(file)

  const docXml = zip['word/document.xml']
  if (!docXml) {
    throw new Error('Invalid DOCX: missing word/document.xml')
  }

  return extractXmlText(docXml)
}

// ── XLSX ─────────────────────────────────────────────────────────────────────

export async function extractXlsxText(file: File): Promise<string> {
  const zip = await readZipAsMap(file)

  const sharedStringsXml = zip['xl/sharedStrings.xml']
  const sharedStrings = sharedStringsXml
    ? parseSharedStrings(sharedStringsXml)
    : []

  const sheetParts: string[] = []

  // Read all sheet files
  for (const [path, content] of Object.entries(zip)) {
    if (path.match(/^xl\/worksheets\/sheet\d+\.xml$/)) {
      const sheetText = parseSheet(content, sharedStrings)
      if (sheetText.trim()) {
        sheetParts.push(sheetText)
      }
    }
  }

  if (sheetParts.length === 0) {
    throw new Error('No readable sheet data found in XLSX')
  }

  return sheetParts.join('\n\n')
}

function parseSharedStrings(xml: string): string[] {
  const strings: string[] = []
  const siMatches = xml.matchAll(/<si[^>]*>([\s\S]*?)<\/si>/g)

  for (const match of siMatches) {
    const inner = match[1]
    // Handle rich text (<r><t>...</t></r>) and plain text (<t>...</t>)
    const tMatches = inner.matchAll(/<t[^>]*>([^<]*)<\/t>/g)
    const parts: string[] = []
    for (const tMatch of tMatches) {
      parts.push(decodeXmlEntities(tMatch[1]))
    }
    strings.push(parts.join(''))
  }

  return strings
}

function parseSheet(xml: string, sharedStrings: string[]): string {
  const rows: string[] = []
  const rowMatches = xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)

  for (const rowMatch of rowMatches) {
    const cells: string[] = []
    const cellMatches = rowMatch[1].matchAll(/<c[^>]*(?:\s+t="([^"]*)")?[^>]*>(?:<v>([^<]*)<\/v>)?<\/c>/g)

    for (const cellMatch of cellMatches) {
      const type = cellMatch[1]
      const value = cellMatch[2]

      if (value === undefined) {
        cells.push('')
        continue
      }

      if (type === 's') {
        // Shared string reference
        const idx = parseInt(value, 10)
        cells.push(sharedStrings[idx] ?? value)
      } else {
        cells.push(decodeXmlEntities(value))
      }
    }

    if (cells.some((c) => c.trim())) {
      rows.push(cells.join('\t'))
    }
  }

  return rows.join('\n')
}

// ── ZIP helper (uses DecompressionStream) ────────────────────────────────────

type ZipEntryInfo = {
  compressionMethod: number
  compressedSize: number
  uncompressedSize: number
  localHeaderOffset: number
  nameLength: number
  extraLength: number
  commentLength: number
}

async function readZipAsMap(file: File): Promise<Record<string, string>> {
  const buffer = await file.arrayBuffer()
  const view = new DataView(buffer)

  const eocdOffset = findEocd(buffer)
  if (eocdOffset < 0) throw new Error('Not a valid ZIP file')

  const centralDirOffset = view.getUint32(eocdOffset + 16, true)
  const centralDirEntries = view.getUint16(eocdOffset + 10, true)
  const result: Record<string, string> = {}

  let offset = centralDirOffset

  for (let i = 0; i < centralDirEntries; i++) {
    if (view.getUint32(offset, true) !== 0x02014b50) break

    const compressionMethod = view.getUint16(offset + 10, true)
    const compressedSize = view.getUint32(offset + 20, true)
    const uncompressedSize = view.getUint32(offset + 24, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const localHeaderOffset = view.getUint32(offset + 42, true)

    const nameBytes = new Uint8Array(buffer, offset + 46, nameLength)
    const name = new TextDecoder().decode(nameBytes)

    if (!name.endsWith('/')) {
      const localNameLen = view.getUint16(localHeaderOffset + 26, true)
      const localExtraLen = view.getUint16(localHeaderOffset + 28, true)
      const dataOffset = localHeaderOffset + 30 + localNameLen + localExtraLen
      const compressedData = buffer.slice(dataOffset, dataOffset + compressedSize)

      let text: string

      if (compressionMethod === 0) {
        text = new TextDecoder().decode(new Uint8Array(compressedData))
      } else if (compressionMethod === 8) {
        const ds = new DecompressionStream('deflate-raw')
        const writer = ds.writable.getWriter()
        const reader = ds.readable.getReader()

        writer.write(new Uint8Array(compressedData))
        writer.close()

        const chunks: Uint8Array[] = []
        let total = 0
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          chunks.push(value)
          total += value.byteLength
        }

        const out = new Uint8Array(total)
        let pos = 0
        for (const chunk of chunks) {
          out.set(chunk, pos)
          pos += chunk.byteLength
        }
        text = new TextDecoder().decode(out)
      } else {
        offset += 46 + nameLength + extraLength + commentLength
        continue
      }

      result[name] = text
    }

    offset += 46 + nameLength + extraLength + commentLength
  }

  return result
}

function findEocd(buffer: ArrayBuffer): number {
  const view = new DataView(buffer)
  for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 66000); i--) {
    if (view.getUint32(i, true) === 0x06054b50) return i
  }
  return -1
}

// ── XML helpers ──────────────────────────────────────────────────────────────

function extractXmlText(xml: string): string {
  const paragraphs: string[] = []
  const pMatches = xml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)

  for (const pMatch of pMatches) {
    const tMatches = pMatch[1].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)
    const parts: string[] = []
    for (const tMatch of tMatches) {
      parts.push(decodeXmlEntities(tMatch[1]))
    }
    const text = parts.join('')
    if (text.trim()) {
      paragraphs.push(text)
    }
  }

  return paragraphs.join('\n')
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
}
