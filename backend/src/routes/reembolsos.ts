import { Router, type Request } from 'express'
import { z } from 'zod'
import { query, queryOne } from '../db.js'
import { requireAuth } from '../middleware/auth.js'
import type { ApiResponse, Reembolso, DashboardKPIs } from '../types.js'
import { asyncHandler } from '../utils/async-handler.js'

const router = Router()

// Todas las rutas requieren autenticación
router.use(requireAuth)

// Schema para crear reembolso
const createSchema = z.object({
  isapre: z.enum([
    'colmena', 'banmedica', 'consalud', 'cruzblanca',
    'nueva_masvida', 'vida_tres', 'esencial',
  ]),
  monto: z.number().int().positive('El monto debe ser positivo'),
  urlDocumento: z.string().url('URL de documento inválida'),
})

// GET /api/reembolsos — Lista los reembolsos del usuario
router.get('/', asyncHandler(async (req, res) => {
  const userId = (req as Request & { userId?: number }).userId

  const reembolsos = await query<Reembolso>(
    'SELECT * FROM reembolsos WHERE usuario_id = $1 ORDER BY created_at DESC',
    [userId],
  )

  const response: ApiResponse<Reembolso[]> = { success: true, data: reembolsos }
  res.json(response)
}))

// GET /api/reembolsos/kpis — KPIs del dashboard
router.get('/kpis', asyncHandler(async (req, res) => {
  const userId = (req as Request & { userId?: number }).userId

  const totalReembolsado = await queryOne<{ total: number }>(
    `
      SELECT COALESCE(SUM(monto), 0) as total FROM reembolsos
      WHERE usuario_id = $1 AND estado = 'exitoso'
    `,
    [userId],
  )

  const pendientes = await queryOne<{ count: string }>(
    `
      SELECT COUNT(*) as count FROM reembolsos
      WHERE usuario_id = $1 AND estado NOT IN ('exitoso', 'rechazado')
    `,
    [userId],
  )

  const exitosas = await queryOne<{ count: string }>(
    `
      SELECT COUNT(*) as count FROM reembolsos
      WHERE usuario_id = $1 AND estado = 'exitoso'
    `,
    [userId],
  )

  const kpis: DashboardKPIs = {
    totalReembolsado: Number(totalReembolsado?.total ?? 0),
    solicitudesPendientes: Number(pendientes?.count ?? 0),
    solicitudesExitosas: Number(exitosas?.count ?? 0),
  }

  const response: ApiResponse<DashboardKPIs> = { success: true, data: kpis }
  res.json(response)
}))

// GET /api/reembolsos/:id — Obtiene un reembolso específico
router.get('/:id', asyncHandler(async (req, res) => {
  const userId = (req as Request & { userId?: number }).userId
  const reembolsoId = parseInt(req.params.id, 10)

  if (isNaN(reembolsoId)) {
    const response: ApiResponse<null> = { success: false, error: 'ID inválido' }
    res.status(400).json(response)
    return
  }

  const reembolso = await queryOne<Reembolso>(
    'SELECT * FROM reembolsos WHERE id = $1 AND usuario_id = $2',
    [reembolsoId, userId],
  )

  if (!reembolso) {
    const response: ApiResponse<null> = { success: false, error: 'Reembolso no encontrado' }
    res.status(404).json(response)
    return
  }

  const response: ApiResponse<Reembolso> = { success: true, data: reembolso }
  res.json(response)
}))

// POST /api/reembolsos — Crea una nueva solicitud de reembolso
router.post('/', asyncHandler(async (req, res) => {
  try {
    const userId = (req as Request & { userId?: number }).userId
    const body = createSchema.parse(req.body)

    // Obtener RUT del usuario
    const usuario = await queryOne<{ rut: string }>('SELECT rut FROM usuarios WHERE id = $1', [userId])
    if (!usuario) {
      const response: ApiResponse<null> = { success: false, error: 'Usuario no encontrado' }
      res.status(404).json(response)
      return
    }

    // Insertar reembolso con estado inicial 'en_cola'
    const reembolso = await queryOne<Reembolso>(
      `
        INSERT INTO reembolsos (usuario_id, rut_usuario, isapre, monto, url_documento, estado)
        VALUES ($1, $2, $3::isapre_id, $4, $5, 'en_cola')
        RETURNING *
      `,
      [userId, usuario.rut, body.isapre, body.monto, body.urlDocumento],
    )

    if (!reembolso) {
      throw new Error('No se pudo crear el reembolso')
    }

    const response: ApiResponse<Reembolso> = {
      success: true,
      data: reembolso,
      message: 'Reembolso creado y encolado para procesamiento',
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
    console.error('Error creando reembolso:', err)
    const response: ApiResponse<null> = { success: false, error: 'Error interno del servidor' }
    res.status(500).json(response)
  }
}))

export default router
