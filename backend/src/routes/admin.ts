import { Router } from 'express'
import { z } from 'zod'
import { execute, query, queryOne } from '../db.js'
import { requireAdmin } from '../middleware/auth.js'
import type { ApiResponse, PortalMonitor, Reembolso } from '../types.js'
import { ISAPRES as ISAPRES_LIST } from '../types.js'
import { asyncHandler } from '../utils/async-handler.js'

const router = Router()

// Todas las rutas requieren admin
router.use(requireAdmin)

const updateReembolsoSchema = z.object({
  monto: z.number().int().nonnegative().optional(),
  folio_isapre: z.string().min(1).optional(),
  estado: z.enum([
    'en_cola',
    'procesando_ocr',
    'iniciando_sesion',
    'subiendo_boleta',
    'exitoso',
    'rechazado',
  ]).optional(),
})

// GET /api/portales/status — Estado de los 7 portales de Isapres
router.get('/status', asyncHandler(async (_req, res) => {
  const rows = await query<{
    isapre_id: string
    status: string
    ultima_ejecucion_exitosa: Date | string
    latencia_ms: number | null
    mensaje_error: string | null
  }>('SELECT * FROM portales_status')

  const portales: PortalMonitor[] = ISAPRES_LIST.map((isapre) => {
    const row = rows.find((r) => r.isapre_id === isapre.id)
    return {
      isapre_id: isapre.id as PortalMonitor['isapre_id'],
      isapre_nombre: isapre.nombre,
      status: (row?.status ?? 'operativo') as PortalMonitor['status'],
      ultima_ejecucion_exitosa:
        row?.ultima_ejecucion_exitosa instanceof Date
          ? row.ultima_ejecucion_exitosa.toISOString()
          : row?.ultima_ejecucion_exitosa ?? new Date().toISOString(),
      latencia_ms: row?.latencia_ms ?? null,
      mensaje_error: row?.mensaje_error ?? null,
    }
  })

  const response: ApiResponse<PortalMonitor[]> = { success: true, data: portales }
  res.json(response)
}))

// GET /api/admin/errores — Cola de reembolsos rechazados/estancados
router.get('/errores', asyncHandler(async (_req, res) => {
  const errores = await query<Reembolso>(
    `
      SELECT * FROM reembolsos
      WHERE estado = 'rechazado' OR (estado NOT IN ('exitoso') AND intentos >= 3)
      ORDER BY updated_at DESC
    `,
  )

  const response: ApiResponse<Reembolso[]> = { success: true, data: errores }
  res.json(response)
}))

// POST /api/admin/errores/:id/reintentar — Reintenta un reembolso
router.post('/errores/:id/reintentar', asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10)
  if (isNaN(id)) {
    const response: ApiResponse<null> = { success: false, error: 'ID inválido' }
    res.status(400).json(response)
    return
  }

  const reembolso = await queryOne<Reembolso>('SELECT * FROM reembolsos WHERE id = $1', [id])
  if (!reembolso) {
    const response: ApiResponse<null> = { success: false, error: 'Reembolso no encontrado' }
    res.status(404).json(response)
    return
  }

  // Resetear estado a en_cola e incrementar intentos
  await execute(
    `
      UPDATE reembolsos
      SET estado = 'en_cola',
          error = NULL,
          intentos = intentos + 1,
          locked_at = NULL,
          worker_id = NULL,
          updated_at = timezone('utc', now())
      WHERE id = $1
    `,
    [id],
  )

  const actualizado = await queryOne<Reembolso>('SELECT * FROM reembolsos WHERE id = $1', [id])
  if (!actualizado) {
    const response: ApiResponse<null> = { success: false, error: 'No se pudo reencolar el reembolso' }
    res.status(500).json(response)
    return
  }
  const response: ApiResponse<Reembolso> = {
    success: true,
    data: actualizado,
    message: 'Reembolso reencolado para procesamiento',
  }
  res.json(response)
}))

// PATCH /api/admin/errores/:id — Edita manualmente un reembolso
router.patch('/errores/:id', asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10)
  if (isNaN(id)) {
    const response: ApiResponse<null> = { success: false, error: 'ID inválido' }
    res.status(400).json(response)
    return
  }

  const body = updateReembolsoSchema.safeParse(req.body)
  if (!body.success) {
    const response: ApiResponse<null> = {
      success: false,
      error: body.error.errors[0]?.message ?? 'Datos inválidos',
    }
    res.status(400).json(response)
    return
  }

  const { monto, folio_isapre, estado } = body.data

  const reembolso = await queryOne<Reembolso>('SELECT * FROM reembolsos WHERE id = $1', [id])
  if (!reembolso) {
    const response: ApiResponse<null> = { success: false, error: 'Reembolso no encontrado' }
    res.status(404).json(response)
    return
  }

  const updates: string[] = []
  const values: (string | number)[] = []

  if (monto !== undefined) {
    updates.push(`monto = $${values.length + 1}`)
    values.push(monto)
  }
  if (folio_isapre !== undefined) {
    updates.push(`folio_isapre = $${values.length + 1}`)
    values.push(folio_isapre)
  }
  if (estado !== undefined) {
    updates.push(`estado = $${values.length + 1}::estado_solicitud`)
    values.push(estado)
  }

  if (updates.length === 0) {
    const response: ApiResponse<null> = { success: false, error: 'No hay campos para actualizar' }
    res.status(400).json(response)
    return
  }

  updates.push("updated_at = timezone('utc', now())")
  if (estado === 'en_cola') {
    updates.push('locked_at = NULL')
    updates.push('worker_id = NULL')
  }
  values.push(id)

  await execute(`UPDATE reembolsos SET ${updates.join(', ')} WHERE id = $${values.length}`, values)

  const actualizado = await queryOne<Reembolso>('SELECT * FROM reembolsos WHERE id = $1', [id])
  if (!actualizado) {
    const response: ApiResponse<null> = { success: false, error: 'No se pudo actualizar el reembolso' }
    res.status(500).json(response)
    return
  }
  const response: ApiResponse<Reembolso> = {
    success: true,
    data: actualizado,
    message: 'Reembolso actualizado manualmente',
  }
  res.json(response)
}))

export default router
