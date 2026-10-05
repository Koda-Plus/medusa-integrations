/**
 * TOKEN ENCRYPTION AT REST. Only `node:crypto`.
 *
 * Why tokens live in the database and not in an env variable: the OLX refresh
 * token ROTATES on every refresh, so the plugin has to store it by itself.
 * Why encrypted: databases have dumps and backups, and a refresh token gives
 * 30 days of access to the seller account. The key lives in the plugin
 * options (`encryptionKey`, 32 bytes in base64), so a database dump alone is
 * useless. AES-256-GCM, random IV per write, the auth tag detects tampering.
 *
 * Stored form: `v1:<iv b64>:<tag b64>:<ciphertext b64>`.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

const ALGORITHM = "aes-256-gcm"
const VERSION = "v1"

export class OlxCryptoError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "OlxCryptoError"
  }
}

/** Key from base64. Must be exactly 32 bytes. */
export function keyFromBase64(text: string): Buffer {
  const key = Buffer.from(String(text ?? "").trim(), "base64")
  if (key.length !== 32) {
    throw new OlxCryptoError(
      `The encryption key has ${key.length} bytes, AES-256 needs 32. Generate one with: openssl rand -base64 32`,
    )
  }
  return key
}

export function isValidKey(text: string | null | undefined): boolean {
  try {
    keyFromBase64(String(text ?? ""))
    return true
  } catch {
    return false
  }
}

export function encrypt(plain: string, key: Buffer): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return [VERSION, iv.toString("base64"), tag.toString("base64"), body.toString("base64")].join(":")
}

export function decrypt(stored: string, key: Buffer): string {
  const parts = stored.split(":")
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new OlxCryptoError("Stored value is not in the v1:iv:tag:ciphertext form.")
  }
  const [, iv, tag, body] = parts
  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, "base64"))
    decipher.setAuthTag(Buffer.from(tag, "base64"))
    return Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]).toString("utf8")
  } catch {
    /* A wrong key and a changed byte look the same to GCM. The caller has one
     * way out either way: connect the account again. */
    throw new OlxCryptoError("Cannot decrypt the stored token: different key or damaged value.")
  }
}
