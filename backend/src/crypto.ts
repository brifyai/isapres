import crypto from 'node:crypto'

/**
 * Cifrado AES-256-GCM para credenciales de Isapre.
 * Las credenciales se cifran antes de almacenarse en la BD
 * y se descifran solo cuando el RPA las necesita.
 */

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12 // GCM recomienda 12 bytes
const SALT_LENGTH = 16

// Clave de cifrado desde variable de entorno o fallback para desarrollo
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? 'wsp-isap-dev-key-change-in-production-32b!'

// Derivar clave de 32 bytes (256 bits) usando scryptSync
function deriveKey(): Buffer {
  const salt = Buffer.from('wsp-isap-salt-fixed', 'utf8')
  return crypto.scryptSync(ENCRYPTION_KEY, salt, 32)
}

const KEY = deriveKey()

/**
 * Cifra un texto usando AES-256-GCM.
 * Retorna un string base64 con formato: iv:authTag:encryptedData
 */
export function encrypt(text: string): string {
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv)

  let encrypted = cipher.update(text, 'utf8', 'hex')
  encrypted += cipher.final('hex')

  const authTag = cipher.getAuthTag()

  // Formato: iv:authTag:encrypted
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`
}

/**
 * Descifra un texto cifrado con AES-256-GCM.
 * Acepta el formato retornado por encrypt(): iv:authTag:encryptedData
 */
export function decrypt(encryptedText: string): string {
  const parts = encryptedText.split(':')
  if (parts.length !== 3) {
    throw new Error('Formato de texto cifrado inválido')
  }

  const iv = Buffer.from(parts[0]!, 'hex')
  const authTag = Buffer.from(parts[1]!, 'hex')
  const encrypted = parts[2]!

  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv)
  decipher.setAuthTag(authTag)

  let decrypted = decipher.update(encrypted, 'hex', 'utf8')
  decrypted += decipher.final('utf8')

  return decrypted
}