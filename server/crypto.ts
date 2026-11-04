/**
 * Password hashing, opaque tokens, TOTP, and at-rest encryption of sensitive
 * fields (CNIC numbers, extracted identity data, provider credentials).
 *
 * Passwords use scrypt from `node:crypto` with a per-password salt and a
 * constant-time comparison. There is no native bcrypt/argon2 dependency to
 * compile, which matters for a product that ships as a single installable
 * service. scrypt is memory-hard, so a stolen database resists offline
 * cracking.
 *
 * At-rest encryption is AES-256-GCM, authenticated so a tampered ciphertext is
 * refused rather than silently mis-decrypted. It is built from `node:crypto`
 * only — no dependency — and the data key comes from the environment (see
 * `resolveEncryptionKey`).
 */

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  randomInt,
  scryptSync,
  timingSafeEqual,
} from "node:crypto"

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"

import { dirname, join } from "node:path"

import { fileURLToPath } from "node:url"

const SCRYPT_KEYLEN = 64
const SCRYPT_COST = 16_384 // ~16 MiB
const SCRYPT_BLOCK = 8
const SCRYPT_PARALLEL = 1

/** `scrypt$<cost>$<salt-b64>$<hash-b64>` */
export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK,
    p: SCRYPT_PARALLEL,
    maxmem: 128 * SCRYPT_COST * SCRYPT_BLOCK * 2,
  })
  return [
    "scrypt",
    String(SCRYPT_COST),
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$")
}

export function verifyPassword(
  password: string,
  stored: string | null,
): boolean {
  if (!stored) return false
  const parts = stored.split("$")
  if (parts.length !== 4 || parts[0] !== "scrypt") return false

  const cost = Number(parts[1])
  const salt = Buffer.from(parts[2], "base64")
  const expected = Buffer.from(parts[3], "base64")
  if (!Number.isFinite(cost) || salt.length === 0 || expected.length === 0) {
    return false
  }

  const actual = scryptSync(password, salt, expected.length, {
    N: cost,
    r: SCRYPT_BLOCK,
    p: SCRYPT_PARALLEL,
    maxmem: 128 * cost * SCRYPT_BLOCK * 2,
  })

  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

// --- Opaque tokens ---------------------------------------------------------

/** URL-safe random token. 32 bytes of entropy. */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url")
}

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("base64url")}`
}

/** Tokens are stored as digests so a database leak cannot be replayed. */
export function hashToken(token: string): string {
  return createHmac("sha256", "deedorbit.token.v1").update(token).digest("hex")
}

export function sha256Hex(value: string): string {
  return createHmac("sha256", "deedorbit.digest.v1").update(value).digest("hex")
}

// --- Password policy -------------------------------------------------------

export type PasswordCheck = {
  ok: boolean
  problems: string[]
}

const COMMON_PASSWORDS = new Set([
  "password",
  "password1",
  "passw0rd",
  "deedorbit",
  "admin",
  "admin123",
  "welcome",
  "welcome1",
  "letmein",
  "12345678",
  "123456789",
  "qwerty123",
  "iloveyou",
  "changeme",
])

export function checkPassword(password: string): PasswordCheck {
  const problems: string[] = []

  if (password.length < 10) problems.push("Use at least 10 characters")
  if (password.length > 200) problems.push("Use at most 200 characters")
  if (!/[a-z]/.test(password)) problems.push("Add a lowercase letter")
  if (!/[A-Z]/.test(password)) problems.push("Add an uppercase letter")
  if (!/\d/.test(password)) problems.push("Add a number")
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    problems.push("This password is too common")
  }

  return { ok: problems.length === 0, problems }
}

export function generatePassword(): string {
  // Avoid characters that are easy to confuse when read off a printed sheet.
  const lower = "abcdefghijkmnopqrstuvwxyz"
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ"
  const digits = "23456789"
  const symbols = "!@#$%^&*?-_"
  const alphabet = lower + upper + digits + symbols

  const pick = (set: string) => set[randomInt(set.length)]
  const chars = [
    pick(lower),
    pick(upper),
    pick(digits),
    pick(symbols),
    ...Array.from({ length: 12 }, () => pick(alphabet)),
  ]

  // Fisher-Yates so the guaranteed character classes are not positional.
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join("")
}

// --- TOTP (RFC 6238) — used only when 2FA is switched on -------------------

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

export function generateTwofaSecret(): string {
  const bytes = randomBytes(20)
  let bits = 0
  let value = 0
  let output = ""

  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  return output
}

export function base32ToBuffer(base32: string): Buffer {
  const clean = base32.toUpperCase().replace(/=+$/, "").replace(/\s/g, "")
  let bits = 0
  let value = 0
  const output: number[] = []

  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char)
    if (index === -1) throw new Error("Invalid base32 character in 2FA secret")
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(output)
}

export function generateRecoveryCodes(count = 8): string[] {
  return Array.from({ length: count }, () => {
    const raw = randomBytes(5).toString("hex").toUpperCase() // 10 chars
    return `${raw.slice(0, 5)}-${raw.slice(5)}`
  })
}

export function totpCode(secret: string, at = Date.now(), step = 30): string {
  const counter = Math.floor(at / 1000 / step)
  const buffer = Buffer.alloc(8)
  buffer.writeBigUInt64BE(BigInt(counter))

  const digest = createHmac("sha1", base32ToBuffer(secret))
    .update(buffer)
    .digest()
  const offset = digest[digest.length - 1] & 0x0f
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff)

  return String(binary % 1_000_000).padStart(6, "0")
}

/** Accepts a small window (±1 step) to tolerate clock drift. */
export function verifyTotp(
  secret: string,
  token: string,
  at = Date.now(),
): boolean {
  const candidate = token.replace(/\D/g, "")
  if (candidate.length !== 6) return false

  for (const drift of [-1, 0, 1]) {
    const expected = totpCode(secret, at + drift * 30_000)
    if (
      candidate.length === expected.length &&
      timingSafeEqual(Buffer.from(candidate), Buffer.from(expected))
    ) {
      return true
    }
  }
  return false
}

export function otpauthUrl(
  secret: string,
  account: string,
  issuer: string,
): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: "6",
    period: "30",
  })
  return `otpauth://totp/${label}?${params.toString()}`
}

// --- At-rest encryption (AES-256-GCM) --------------------------------------

/**
 * Prefix on every ciphertext, so a value written before this feature (or a value
 * a provider hands back already as plaintext) can be told apart from real
 * ciphertext at read time and returned unchanged rather than garbled.
 */
const CIPHER_PREFIX = "aes256gcm"

const KEY_BYTES = 32

/** The data directory, matching `db.ts` so the key file sits beside the database. */
function dataDir(): string {
  const env = process.env.DEEDORBIT_DB
  if (env) return dirname(env)
  const here = dirname(fileURLToPath(import.meta.url))
  return join(here, "..", "data")
}

interface ResolvedKey {
  key: Buffer
  source: "env" | "file"
}

let cachedKey: ResolvedKey | null = null

/**
 * The data key, resolved once per process.
 *
 * `ENCRYPTION_KEY` (base64, 32 bytes) is the correct source for a real
 * deployment: the key lives outside the database file, so a stolen backup is not
 * a stolen identity. When it is unset — development, and the test harness — a
 * random key is generated on first use and persisted to `data/.encryption-key`
 * with owner-only (0600) permissions, so ciphertext stays decryptable across
 * restarts. That fallback weakens the guarantee (the key sits on the same host as
 * the database) and is documented, not hidden; `getSecretEnvInfo` surfaces which
 * source is live so an operator can see they are on the convenience key.
 */
export function resolveEncryptionKey(): ResolvedKey {
  if (cachedKey) return cachedKey

  const fromEnv = process.env.ENCRYPTION_KEY
  if (fromEnv && fromEnv.trim() !== "") {
    const decoded = Buffer.from(fromEnv.trim(), "base64")
    if (decoded.length === KEY_BYTES) {
      cachedKey = { key: decoded, source: "env" }
      return cachedKey
    }
  }

  const dir = dataDir()
  const keyPath = join(dir, ".encryption-key")

  if (existsSync(keyPath)) {
    const stored = readFileSync(keyPath, "utf8").trim()
    const decoded = Buffer.from(stored, "base64")
    if (decoded.length === KEY_BYTES) {
      cachedKey = { key: decoded, source: "file" }
      return cachedKey
    }
  }

  mkdirSync(dir, { recursive: true })
  const fresh = randomBytes(KEY_BYTES)
  writeFileSync(keyPath, fresh.toString("base64"), { mode: 0o600 })
  cachedKey = { key: fresh, source: "file" }
  return cachedKey
}

/** Which key source is live — for the settings screen, never the key itself. */
export interface SecretEnvInfo {
  source: "env" | "file"
  envConfigured: boolean
}

export function getSecretEnvInfo(): SecretEnvInfo {
  const fromEnv = process.env.ENCRYPTION_KEY
  return {
    source: resolveEncryptionKey().source,
    envConfigured: Boolean(fromEnv && fromEnv.trim() !== ""),
  }
}

/**
 * Encrypts a sensitive string for storage. Returns null for empty input so a
 * blank field stays a readable null rather than an encrypted empty string. A
 * fresh random IV per call means two identical CNICs never share a ciphertext.
 */
export function encryptSecret(plain: string | null | undefined): string | null {
  if (plain === null || plain === undefined || plain === "") return null

  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", resolveEncryptionKey().key, iv)
  const ciphertext = Buffer.concat([
    cipher.update(String(plain), "utf8"),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()

  return [
    CIPHER_PREFIX,
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join("$")
}

/**
 * Decrypts a stored value. A null/empty input is null. Anything without the
 * `aes256gcm$` prefix is treated as legacy plaintext and returned untouched, so
 * a row written before encryption existed still reads. A tag mismatch (tampering
 * or a wrong key) throws rather than returning garbage.
 */
export function decryptSecret(blob: string | null | undefined): string | null {
  if (blob === null || blob === undefined || blob === "") return null

  if (!blob.startsWith(`${CIPHER_PREFIX}$`)) return blob

  const parts = blob.split("$")
  if (parts.length !== 4) throw new Error("Malformed ciphertext")

  const iv = Buffer.from(parts[1]!, "base64")
  const tag = Buffer.from(parts[2]!, "base64")
  const ciphertext = Buffer.from(parts[3]!, "base64")

  const decipher = createDecipheriv(
    "aes-256-gcm",
    resolveEncryptionKey().key,
    iv,
  )
  decipher.setAuthTag(tag)
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8")
}

/**
 * A keyed, one-way fingerprint of a normalised value — used for the duplicate-
 * CNIC detector, which must be able to say "these two files carry the same
 * number" without either being able to recover the number from the stored hash.
 * Domain-separated by a fixed info string so a CNIC hash never collides with
 * some other fingerprint's meaning.
 */
export function fingerprintValue(value: string): string {
  return createHmac("sha256", resolveEncryptionKey().key)
    .update(`deedorbit.fingerprint.v1\n${value}`)
    .digest("hex")
}
