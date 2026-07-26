import crypto from 'node:crypto'

/**
 * Copia exacta de backend/src/crypto.ts. Ambos módulos deben mantenerse
 * idénticos: el backend cifra al enrolar y este worker descifra antes del login.
 *
 * Formato interoperable con el worker RPA en Python (isapres-bridge):
 *
 *   salt_hex : iv_hex : ciphertext_hex
 *
 *   salt   16 bytes aleatorios, distinto en cada cifrado
 *   iv     16 bytes aleatorios
 *   clave  PBKDF2-HMAC-SHA256, 100.000 iteraciones, 32 bytes
 *   cifra  AES-256-CBC con padding PKCS7
 *
 * ⚠️ No aplicar padding a mano: createCipheriv ya aplica PKCS7 en modo CBC.
 */

const PBKDF2_ITERATIONS = 100_000
const KEY_LENGTH = 32
const SALT_LENGTH = 16
const IV_LENGTH = 16

/** Formato antiguo (AES-256-GCM), aún presente en credenciales ya enroladas. */
const LEGACY_ALGORITHM = 'aes-256-gcm'
const LEGACY_IV_LENGTH = 12
const LEGACY_SALT = 'wsp-isap-salt-fixed'

function getMasterKey(): string {
  const key = process.env.EMAIL_ENCRYPTION_KEY?.trim() || process.env.ENCRYPTION_KEY?.trim()
  if (!key) {
    throw new Error(
      'Falta EMAIL_ENCRYPTION_KEY. Debe tener el mismo valor que el backend y el bridge RPA, '
      + 'o las credenciales de Isapre no se podrán descifrar.',
    )
  }
  return key
}

function getLegacyKey(): string {
  return process.env.ENCRYPTION_KEY?.trim() || getMasterKey()
}

function deriveKey(masterKey: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(masterKey, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256')
}

export function encrypt(text: string): string {
  const salt = crypto.randomBytes(SALT_LENGTH)
  const iv = crypto.randomBytes(IV_LENGTH)
  const key = deriveKey(getMasterKey(), salt)

  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv)
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])

  return `${salt.toString('hex')}:${iv.toString('hex')}:${encrypted.toString('hex')}`
}

/**
 * Descifra credenciales en el formato actual (CBC) y en el anterior (GCM),
 * distinguiéndolos por el largo del primer campo.
 */
export function decrypt(encryptedText: string): string {
  const parts = encryptedText.split(':')
  if (parts.length !== 3) {
    throw new Error('Formato de texto cifrado inválido')
  }

  const [first, second, payload] = parts as [string, string, string]

  if (first.length === LEGACY_IV_LENGTH * 2) {
    return decryptLegacyGcm(first, second, payload)
  }

  const key = deriveKey(getMasterKey(), Buffer.from(first, 'hex'))
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, Buffer.from(second, 'hex'))

  return Buffer.concat([
    decipher.update(Buffer.from(payload, 'hex')),
    decipher.final(),
  ]).toString('utf8')
}

function decryptLegacyGcm(ivHex: string, authTagHex: string, payload: string): string {
  const key = crypto.scryptSync(getLegacyKey(), Buffer.from(LEGACY_SALT, 'utf8'), KEY_LENGTH)
  const decipher = crypto.createDecipheriv(LEGACY_ALGORITHM, key, Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'))

  let decrypted = decipher.update(payload, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}

/** true si el valor está en el formato antiguo y conviene recifrarlo. */
export function needsReencryption(encryptedText: string): boolean {
  const parts = encryptedText.split(':')
  return parts.length === 3 && parts[0]!.length === LEGACY_IV_LENGTH * 2
}
