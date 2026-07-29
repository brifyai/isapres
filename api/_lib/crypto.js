import crypto from 'node:crypto'

const PBKDF2_ITERATIONS = 100_000
const KEY_LENGTH = 32
const LEGACY_ALGORITHM = 'aes-256-gcm'
const LEGACY_IV_LENGTH = 12
const LEGACY_SALT = 'wsp-isap-salt-fixed'

function getMasterKey() {
  const key = process.env.EMAIL_ENCRYPTION_KEY?.trim() || process.env.ENCRYPTION_KEY?.trim()
  if (!key) {
    throw new Error('Falta EMAIL_ENCRYPTION_KEY en Vercel.')
  }
  return key
}

function getLegacyKey() {
  return process.env.ENCRYPTION_KEY?.trim() || getMasterKey()
}

function deriveKey(masterKey, salt) {
  return crypto.pbkdf2Sync(masterKey, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256')
}

function decryptLegacyGcm(ivHex, authTagHex, payload) {
  const key = crypto.scryptSync(getLegacyKey(), Buffer.from(LEGACY_SALT, 'utf8'), KEY_LENGTH)
  const decipher = crypto.createDecipheriv(LEGACY_ALGORITHM, key, Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'))

  let decrypted = decipher.update(payload, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}

export function decryptCredential(encryptedText) {
  const parts = String(encryptedText ?? '').split(':')
  if (parts.length !== 3) {
    throw new Error('Formato de credencial cifrada inválido.')
  }

  const [first, second, payload] = parts
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
