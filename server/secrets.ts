/**
 * Thin server-side wrapper over the at-rest encryption primitives in
 * `crypto.ts`, so a route that needs to guard a secret never imports the whole
 * crypto surface and a settings screen can ask *how* the key is held without
 * ever touching the key itself.
 *
 * There is deliberately no logic here: it re-exports the crypto helpers under
 * the names this module thinks in, and adds the one read-only answer the
 * settings UI is allowed to see — whether the deployment is running on the
 * `ENCRYPTION_KEY` environment or on the generated on-disk fallback.
 */

import {
  decryptSecret as decryptSecretRaw,
  encryptSecret as encryptSecretRaw,
  fingerprintValue as fingerprintRaw,
  getSecretEnvInfo as secretEnvInfoRaw,
  type SecretEnvInfo,
} from "./crypto.ts"

export type { SecretEnvInfo } from "./crypto.ts"

/** Encrypts a sensitive string for storage; null in, null out. */

export function encryptSecret(plain: string | null | undefined): string | null {
  return encryptSecretRaw(plain)
}

/** Decrypts a stored value; a legacy plaintext value reads back unchanged. */

export function decryptSecret(blob: string | null | undefined): string | null {
  return decryptSecretRaw(blob)
}

/** A keyed, non-reversible fingerprint — the duplicate-detector's comparison key. */

export function fingerprint(value: string): string {
  return fingerprintRaw(value)
}

/** Which key source is live. Never returns the key, only where it came from. */

export function getSecretEnvInfo(): SecretEnvInfo {
  return secretEnvInfoRaw()
}
