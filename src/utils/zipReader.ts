/**
 * Minimal ZIP reader using the browser's DecompressionStream API.
 * Supports STORE (0) and DEFLATE (8) methods — covers all normal .zip files.
 * No external dependencies.
 */

type ZipEntry = {
  name: string
  compressionMethod: number
  compressedSize: number
  uncompressedSize: number
  localHeaderOffset: number
}

function findEocd(buffer: ArrayBuffer): number {
  const view = new DataView(buffer)
  // EOCD signature 0x06054b50 — search backwards from the end
  for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 66000); i--) {
    if (view.getUint32(i, true) === 0x06054b50) return i
  }
  return -1
}

function readUint16(view: DataView, offset: number): number {
  return view.getUint16(offset, true)
}

function readUint32(view: DataView, offset: number): number {
  return view.getUint32(offset, true)
}

function decodeName(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes)
}

export async function readZipEntries(file: File): Promise<Map<string, string>> {
  const buffer = await file.arrayBuffer()
  const view = new DataView(buffer)
  const result = new Map<string, string>()

  const eocdOffset = findEocd(buffer)
  if (eocdOffset < 0) throw new Error('Not a valid ZIP file')

  const centralDirOffset = readUint32(view, eocdOffset + 16)
  const centralDirEntries = readUint16(view, eocdOffset + 10)

  let offset = centralDirOffset

  for (let i = 0; i < centralDirEntries; i++) {
    if (readUint32(view, offset) !== 0x02014b50) break // central directory signature

    const compressionMethod = readUint16(view, offset + 10)
    const compressedSize = readUint32(view, offset + 20)
    const uncompressedSize = readUint32(view, offset + 24)
    const nameLength = readUint16(view, offset + 28)
    const extraLength = readUint16(view, offset + 30)
    const commentLength = readUint16(view, offset + 32)
    const localHeaderOffset = readUint32(view, offset + 42)

    const nameBytes = new Uint8Array(buffer, offset + 46, nameLength)
    const name = decodeName(nameBytes)

    // Only extract text package files, skip directories.
    if (
      !name.endsWith('/') &&
      (name.endsWith('.md') || name.endsWith('.txt') || name.endsWith('.json'))
    ) {
      const entry: ZipEntry = {
        name,
        compressionMethod,
        compressedSize,
        uncompressedSize,
        localHeaderOffset,
      }

      // Read local file header to get actual data offset
      const localNameLen = readUint16(view, localHeaderOffset + 26)
      const localExtraLen = readUint16(view, localHeaderOffset + 28)
      const dataOffset = localHeaderOffset + 30 + localNameLen + localExtraLen
      const compressedData = buffer.slice(dataOffset, dataOffset + entry.compressedSize)

      let text: string

      if (entry.compressionMethod === 0) {
        // STORE — no compression
        text = new TextDecoder().decode(new Uint8Array(compressedData))
      } else if (entry.compressionMethod === 8) {
        // DEFLATE
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
        // Unsupported compression method — skip
        offset += 46 + nameLength + extraLength + commentLength
        continue
      }

      result.set(name, text)
    }

    offset += 46 + nameLength + extraLength + commentLength
  }

  return result
}
