/* Discord voice wire constants and pure packet helpers.
  Extracted from connection.ts so the handshake/UDP flow stays readable.
  Everything here is stateless and independently testable. */

export const GATEWAY_VERSION = 8
export const DISCOVERY_SIZE = 74
export const MAX_NONCE = 0xffffffff
export const PENDING_QUEUE_MAX = 5
// Silence frames sent after the audio stops, per the Discord docs, before
// going radio-silent.
export const IDLE_SILENCE_FRAMES = 5

export function splitHostPort(endpoint: string): {
  host: string
  port: number
} {
  const cleaned = endpoint.replace(/^wss?:\/\//, '')
  const separator = cleaned.lastIndexOf(':')
  if (separator === -1) return { host: cleaned, port: 443 }
  return {
    host: cleaned.slice(0, separator),
    port: Number(cleaned.slice(separator + 1)) || 443
  }
}

export async function toBytes(data: unknown): Promise<Uint8Array | null> {
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    return new Uint8Array(await data.arrayBuffer())
  }
  return null
}

export function buildDiscoveryPacket(ssrc: number): Buffer {
  const request = Buffer.alloc(DISCOVERY_SIZE)
  request.writeUInt16BE(1, 0)
  request.writeUInt16BE(70, 2)
  request.writeUInt32BE(ssrc >>> 0, 4)
  return request
}

export function parseDiscoveryResponse(response: Buffer): {
  address: string
  port: number
} | null {
  if (response.length < DISCOVERY_SIZE) return null
  const view = new DataView(
    response.buffer,
    response.byteOffset,
    response.byteLength
  )
  const address = Buffer.from(response.subarray(8, 8 + 64))
    .toString('utf8')
    .split('\0')[0] as string
  return { address, port: view.getUint16(response.length - 2) }
}
