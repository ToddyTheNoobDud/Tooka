/* RTP transport crypto. Pure functions, no state.
  Two modes (Discord always offers xchacha, AES-GCM depends on hardware):
  - aead_aes256_gcm_rtpsize via node:crypto (preferred when offered)
  - aead_xchacha20_poly1305_rtpsize via sodium-native (required fallback)
  Both seal to the same layout: 12B header + ciphertext + 16B tag + 4B nonce.
  Nonces are strictly monotonic per key (see connection.ts), so the shared
  nonce buffers below are safe: written and consumed synchronously. */

import { createCipheriv, createDecipheriv } from 'node:crypto'

type SodiumModule = typeof import('sodium-native')

let sodium: SodiumModule | null = null

function getSodium(): SodiumModule {
  if (!sodium) throw new Error('sodium-native used before ensureSodium().')
  return sodium
}

// Loads libsodium on first XChaCha use. AES-only connections never call
// this, so the common path skips the native lib entirely.
export async function ensureSodium(): Promise<void> {
  if (sodium) return
  const loaded = await import('sodium-native')
  sodium = (loaded.default ?? loaded) as SodiumModule
}

export const RTP_HEADER_SIZE = 12
export const GCM_TAG_SIZE = 16
export const XCHACHA_TAG_SIZE = 16
export const XCHACHA_NONCE_SIZE = 24
export const NONCE_SUFFIX_SIZE = 4
export const RTP_VERSION = 0x80
export const RTP_OPUS_PAYLOAD = 0x78

export const SUPPORTED_MODES = [
  'aead_aes256_gcm_rtpsize',
  'aead_xchacha20_poly1305_rtpsize'
] as const
export type TransportMode = (typeof SUPPORTED_MODES)[number]

export type EncryptionPreference = 'auto' | 'aes' | 'xchacha'

export function negotiateMode(
  modes: string[],
  preference: EncryptionPreference = 'auto'
): TransportMode {
  const offered = (mode: TransportMode): boolean => modes.includes(mode)
  switch (preference) {
    case 'aes':
      if (offered('aead_aes256_gcm_rtpsize')) return 'aead_aes256_gcm_rtpsize'
      break
    case 'xchacha':
      if (offered('aead_xchacha20_poly1305_rtpsize'))
        return 'aead_xchacha20_poly1305_rtpsize'
      break
    case 'auto':
      if (offered('aead_aes256_gcm_rtpsize')) return 'aead_aes256_gcm_rtpsize'
      if (offered('aead_xchacha20_poly1305_rtpsize'))
        return 'aead_xchacha20_poly1305_rtpsize'
      break
    default:
      throw new Error(
        `Unknown voice encryption preference: ${String(preference)}. Use "auto", "aes" or "xchacha".`
      )
  }
  throw new Error(
    `Voice encryption "${preference}" unavailable, server offered: ${modes.join(', ')}`
  )
}

export function writeRtpHeader(
  buffer: Uint8Array,
  sequence: number,
  timestamp: number,
  ssrc: number
): void {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  buffer[0] = RTP_VERSION
  buffer[1] = RTP_OPUS_PAYLOAD
  view.setUint16(2, sequence)
  view.setUint32(4, timestamp)
  view.setUint32(8, ssrc)
}

export function sealedSize(frameLength: number): number {
  return RTP_HEADER_SIZE + frameLength + GCM_TAG_SIZE + NONCE_SUFFIX_SIZE
}

// Counter lives in the first 4 bytes of the nonce; the same counter value
// is appended as the trailing 4-byte suffix. AES-GCM uses a 12-byte nonce,
// XChaCha a 24-byte one (remaining bytes stay zero).
const aesNonceBuffer = Buffer.alloc(12)
const xchachaNonceBuffer = Buffer.alloc(XCHACHA_NONCE_SIZE)

function toMessageBuffer(frame: Uint8Array): Buffer {
  return Buffer.isBuffer(frame)
    ? frame
    : Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength)
}

// Pins a session key in RAM so it never hits swap. Uses libsodium when
// loaded, plain fill otherwise - correctness never depends on it.
export function lockKey(key: Buffer): void {
  try {
    sodium?.sodium_mlock(key)
  } catch {
    // pageable fallback, still usable
  }
}

// Releases a session key: munlock also memzeros. Falls back to fill(0)
// when sodium isn't loaded or the key was never locked.
export function unlockKey(key: Buffer): void {
  try {
    if (sodium) sodium.sodium_munlock(key)
    else key.fill(0)
  } catch {
    key.fill(0)
  }
}
export function sealAesGcm(
  out: Buffer,
  key: Buffer,
  nonce: number,
  header: Uint8Array,
  frame: Uint8Array
): number {
  const nonceBuffer = aesNonceBuffer
  nonceBuffer.writeUInt32BE(nonce >>> 0, 0)
  const cipher = createCipheriv('aes-256-gcm', key, nonceBuffer)
  cipher.setAAD(header)
  const ciphertext = cipher.update(frame)
  cipher.final()
  const authTag = cipher.getAuthTag()
  Buffer.from(header).copy(out, 0)
  ciphertext.copy(out, RTP_HEADER_SIZE)
  authTag.copy(out, RTP_HEADER_SIZE + ciphertext.length)
  out.writeUInt32BE(nonce >>> 0, RTP_HEADER_SIZE + frame.length + GCM_TAG_SIZE)
  return sealedSize(frame.length)
}

export function unsealAesGcm(
  packet: Uint8Array,
  key: Buffer,
  nonce: number
): Buffer {
  const header = packet.subarray(0, RTP_HEADER_SIZE)
  const ciphertextEnd = packet.length - GCM_TAG_SIZE - NONCE_SUFFIX_SIZE
  const nonceBuffer = aesNonceBuffer
  nonceBuffer.writeUInt32BE(nonce >>> 0, 0)
  const decipher = createDecipheriv('aes-256-gcm', key, nonceBuffer)
  decipher.setAAD(header)
  decipher.setAuthTag(
    packet.subarray(ciphertextEnd, ciphertextEnd + GCM_TAG_SIZE)
  )
  return Buffer.concat([
    decipher.update(packet.subarray(RTP_HEADER_SIZE, ciphertextEnd)),
    decipher.final()
  ])
}

// XChaCha20-Poly1305 seal into `out` (must have sealedSize(frame.length)
// bytes). Counter goes in the first 4 nonce bytes and the trailing suffix,
// matching what Discord expects.
export function sealXchacha(
  out: Buffer,
  key: Buffer,
  nonce: number,
  header: Uint8Array,
  frame: Uint8Array
): number {
  xchachaNonceBuffer.writeUInt32BE(nonce >>> 0, 0)
  const ciphertext = out.subarray(
    RTP_HEADER_SIZE,
    RTP_HEADER_SIZE + frame.length + XCHACHA_TAG_SIZE
  )
  getSodium().crypto_aead_xchacha20poly1305_ietf_encrypt(
    ciphertext,
    toMessageBuffer(frame),
    toMessageBuffer(header),
    null,
    xchachaNonceBuffer,
    key
  )
  Buffer.from(header).copy(out, 0)
  out.writeUInt32BE(
    nonce >>> 0,
    RTP_HEADER_SIZE + frame.length + XCHACHA_TAG_SIZE
  )
  return sealedSize(frame.length)
}
