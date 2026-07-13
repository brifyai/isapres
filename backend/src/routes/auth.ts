import { Router, type Request } from 'express'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { queryOne, withTransaction } from '../db.js'
import { encrypt } from '../crypto.js'
import { generateToken, requireAuth } from '../middleware/auth.js'
import type { ApiResponse, Usuario, AuthPayload, IsapreId } from '../types.js'
import { asyncHandler } from '../utils/async-handler.js'

const router = Router()

// Schema de validación con Zod
const registerSchema = z.object({
  nombre: z.string().min(3, 'El nombre debe tener al menos 3 caracteres'),
  telefono: z.string().min(9, 'Teléfono inválido'),
  rut: z.string().min(8, 'RUT inválido'),
  acceptedPrivacyPolicy: z.literal(true, {
    errorMap: () => ({ message: 'Debes aceptar la política de privacidad' }),
  }),
  acceptedTerms: z.literal(true, {
    errorMap: () => ({ message: 'Debes aceptar los términos y condiciones' }),
  }),
  credenciales: z.object({
    isapreId: z.enum([
      'colmena', 'banmedica', 'consalud', 'cruzblanca',
      'nueva_masvida', 'vida_tres', 'esencial',
    ]),
    rut: z.string().min(8, 'RUT de Isapre inválido'),
    password: z.string().min(4, 'Contraseña muy corta'),
  }),
})

const loginSchema = z.object({
  telefono: z.string().min(9, 'Teléfono inválido'),
  otp: z.string().min(4, 'OTP inválido').optional(),
})

// POST /api/auth/register
router.post('/register', asyncHandler(async (req, res) => {
  try {
    const body = registerSchema.parse(req.body)

    // Verificar si el usuario ya existe
    const existing = await queryOne<{ id: number }>(
      'SELECT id FROM usuarios WHERE telefono = $1',
      [body.telefono],
    )

    if (existing) {
      const response: ApiResponse<null> = { success: false, error: 'Ya existe una cuenta con este teléfono' }
      res.status(409).json(response)
      return
    }

    // Hash de la contraseña (para login futuro del usuario)
    const passwordHash = bcrypt.hashSync(body.telefono + body.rut, 10)
    const encryptedPassword = encrypt(body.credenciales.password)

    const usuario = await withTransaction(async (client) => {
      const insertUser = await client.query<Usuario>(
        `
          INSERT INTO usuarios (
            nombre,
            telefono,
            rut,
            password_hash,
            accepted_privacy_policy_at,
            accepted_terms_at,
            consent_ip,
            consent_user_agent
          )
          VALUES ($1, $2, $3, $4, timezone('utc', now()), timezone('utc', now()), $5, $6)
          RETURNING id, nombre, telefono, rut, created_at, updated_at
        `,
        [
          body.nombre,
          body.telefono,
          body.rut,
          passwordHash,
          req.ip ?? null,
          req.get('user-agent') ?? null,
        ],
      )

      const createdUser = insertUser.rows[0]
      if (!createdUser) {
        throw new Error('No se pudo crear el usuario')
      }

      await client.query(
        `
          INSERT INTO credenciales_isapre (usuario_id, isapre_id, rut, password_encrypted)
          VALUES ($1, $2::isapre_id, $3, $4)
        `,
        [createdUser.id, body.credenciales.isapreId, body.credenciales.rut, encryptedPassword],
      )

      return createdUser
    })

    // Generar token
    const token = generateToken({ userId: usuario.id, telefono: usuario.telefono })

    const response: ApiResponse<AuthPayload> = {
      success: true,
      data: { usuario, token },
      message: 'Usuario registrado exitosamente',
    }
    res.status(201).json(response)
  } catch (err) {
    if (err instanceof z.ZodError) {
      const response: ApiResponse<null> = {
        success: false,
        error: err.errors[0]?.message ?? 'Datos inválidos',
      }
      res.status(400).json(response)
      return
    }
    console.error('Error registrando usuario:', err)
    const response: ApiResponse<null> = { success: false, error: 'Error interno del servidor' }
    res.status(500).json(response)
  }
}))

// POST /api/auth/login
router.post('/login', asyncHandler(async (req, res) => {
  try {
    const body = loginSchema.parse(req.body)

    const usuario = await queryOne<Usuario>(
      'SELECT id, nombre, telefono, rut, created_at, updated_at FROM usuarios WHERE telefono = $1',
      [body.telefono],
    )

    if (!usuario) {
      const response: ApiResponse<null> = { success: false, error: 'Usuario no encontrado' }
      res.status(404).json(response)
      return
    }

    // En producción: verificar OTP via WhatsApp
    // Por ahora: login directo
    const token = generateToken({ userId: usuario.id, telefono: usuario.telefono })

    const response: ApiResponse<AuthPayload> = {
      success: true,
      data: { usuario, token },
    }
    res.json(response)
  } catch (err) {
    if (err instanceof z.ZodError) {
      const response: ApiResponse<null> = {
        success: false,
        error: err.errors[0]?.message ?? 'Datos inválidos',
      }
      res.status(400).json(response)
      return
    }
    console.error('Error iniciando sesión:', err)
    const response: ApiResponse<null> = { success: false, error: 'Error interno del servidor' }
    res.status(500).json(response)
  }
}))

// GET /api/auth/me
router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const userId = (req as Request & { userId?: number }).userId

  const usuario = await queryOne<Usuario>(
    'SELECT id, nombre, telefono, rut, created_at, updated_at FROM usuarios WHERE id = $1',
    [userId],
  )

  if (!usuario) {
    const response: ApiResponse<null> = { success: false, error: 'Usuario no encontrado' }
    res.status(404).json(response)
    return
  }

  const response: ApiResponse<Usuario> = { success: true, data: usuario }
  res.json(response)
}))

export default router
