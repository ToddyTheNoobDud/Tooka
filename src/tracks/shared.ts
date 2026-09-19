import type { PreparedString } from '../types/utils'

export const trackFlags = 1
const utf8Decoder = new TextDecoder('utf-8', { fatal: true })

function usesStandardUtf8(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code === 0 || (code >= 55296 && code <= 57343)) return false
  }
  return true
}

function modifiedUtf8Bytes(value: string): number[] {
  const bytes: number[] = []
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code >= 1 && code <= 127) {
      bytes.push(code)
    } else if (code === 0 || (code >= 128 && code <= 2047)) {
      bytes.push(192 | ((code >> 6) & 31), 128 | (code & 63))
    } else {
      bytes.push(
        224 | ((code >> 12) & 15),
        128 | ((code >> 6) & 63),
        128 | (code & 63)
      )
    }
  }
  return bytes
}

export function prepareString(value: string): PreparedString {
  if (usesStandardUtf8(value)) {
    const byteLength = Buffer.byteLength(value, 'utf8')
    if (byteLength > 65535) throw new Error('Encode Error: string too long')
    return { standard: true, byteLength }
  }
  const bytes = modifiedUtf8Bytes(value)
  if (bytes.length > 65535) throw new Error('Encode Error: string too long')
  return { standard: false, byteLength: bytes.length, bytes }
}

export function prepareNullable(
  value: string | null | undefined
): PreparedString | null {
  if (value === undefined || value === null) return null
  return prepareString(String(value))
}

export function fieldSize(prepared: PreparedString): number {
  return 2 + prepared.byteLength
}

export function nullableSize(prepared: PreparedString | null): number {
  return prepared ? 1 + fieldSize(prepared) : 1
}

export function writePrepared(
  buffer: Buffer,
  offset: number,
  prepared: PreparedString,
  original: string
): number {
  buffer.writeUInt16BE(prepared.byteLength, offset)
  offset += 2
  if (prepared.standard) {
    buffer.write(original, offset, 'utf8')
  } else {
    buffer.set(prepared.bytes as number[], offset)
  }
  return offset + prepared.byteLength
}

export function writeNullable(
  buffer: Buffer,
  offset: number,
  prepared: PreparedString | null,
  original: string | null | undefined
): number {
  if (!prepared) {
    buffer[offset++] = 0
    return offset
  }
  buffer[offset++] = 1
  return writePrepared(buffer, offset, prepared, original as string)
}

export function writeLong(buffer: Buffer, offset: number, value: number): number {
  buffer.writeBigInt64BE(BigInt(Math.trunc(value)), offset)
  return offset + 8
}

function hasModifiedSequences(
  message: Buffer,
  start: number,
  end: number
): boolean {
  for (let index = start; index < end; index++) {
    const byte = message[index] as number
    if (byte < 128) continue
    if (byte === 192 || byte === 193) return true
    if (byte === 237) {
      const next = message[index + 1]
      if (next !== undefined && next >= 160 && next <= 175) return true
    }
  }
  return false
}

export function readByte(message: Buffer, cursor: { offset: number }): number {
  if (cursor.offset + 1 > message.length) {
    throw new Error('Decode Error: unexpected end of message')
  }
  const value = message[cursor.offset]
  cursor.offset += 1
  return value as number
}

export function readUtf8(message: Buffer, cursor: { offset: number }): string {
  if (cursor.offset + 2 > message.length) {
    throw new Error('Decode Error: unexpected end of message')
  }
  const utfLength = message.readUInt16BE(cursor.offset)
  cursor.offset += 2
  if (cursor.offset + utfLength > message.length) {
    throw new Error('Decode Error: truncated string')
  }
  const end = cursor.offset + utfLength
  if (!hasModifiedSequences(message, cursor.offset, end)) {
    try {
      const text = utf8Decoder.decode(message.subarray(cursor.offset, end))
      cursor.offset = end
      return text
    } catch {
      throw new Error('Decode Error: malformed utf')
    }
  }
  const chars: string[] = []
  let index = cursor.offset
  while (index < end) {
    const first = message[index] as number
    if (first < 128) {
      index += 1
      chars.push(String.fromCharCode(first))
    } else if ((first & 224) === 192) {
      const second = message[index + 1] as number
      if ((second & 192) !== 128) throw new Error('Decode Error: malformed utf')
      chars.push(String.fromCharCode(((first & 31) << 6) | (second & 63)))
      index += 2
    } else if ((first & 240) === 224) {
      const second = message[index + 1] as number
      const third = message[index + 2] as number
      if ((second & 192) !== 128 || (third & 192) !== 128) {
        throw new Error('Decode Error: malformed utf')
      }
      chars.push(
        String.fromCharCode(
          ((first & 15) << 12) | ((second & 63) << 6) | (third & 63)
        )
      )
      index += 3
    } else {
      throw new Error('Decode Error: malformed utf')
    }
  }
  cursor.offset = end
  return chars.join('')
}

export function readNullableText(
  message: Buffer,
  cursor: { offset: number }
): string | null {
  return readByte(message, cursor) !== 0 ? readUtf8(message, cursor) : null
}
