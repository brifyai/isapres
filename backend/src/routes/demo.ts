import { Router, type Request } from 'express'
import { z } from 'zod'
import { query, queryOne } from '../db.js'
import { requireAuth } from '../middleware/auth.js'
import type {
  ApiResponse,
  EstadoConversacion,
  MensajeWhatsapp,
  PrestacionCatalogo,
  ProcesoDemo,
} from '../types.js'
import { asyncHandler } from '../utils/async-handler.js'
import {
  createBanmedicaDemoProcess,
  getDemoOverview,
  getProcesoDemoDetalle,
  listProcesosDemoByUser,
} from '../utils/demo-process.js'

const router = Router()

router.use(requireAuth)

const createBanmedicaSchema = z.object({
  centroMedicoRut: z.string().min(8, 'Debes indicar el RUT del centro medico'),
  centroMedicoNombre: z.string().min(3, 'Debes indicar el nombre del centro medico'),
  fechaAtencion: z.string().min(8, 'Debes indicar la fecha de atencion'),
  montoPagado: z.number().int().nonnegative('El monto pagado debe ser positivo'),
  observaciones: z.string().max(500).optional().default(''),
})

router.get('/overview', asyncHandler(async (req, res) => {
  const userId = (req as Request & { userId?: number }).userId
  const overview = await getDemoOverview(userId as number)

  const response: ApiResponse<typeof overview> = {
    success: true,
    data: overview,
  }
  res.json(response)
}))

router.get('/procesos', asyncHandler(async (req, res) => {
  const userId = (req as Request & { userId?: number }).userId
  const procesos = await listProcesosDemoByUser(userId as number)

  const response: ApiResponse<ProcesoDemo[]> = {
    success: true,
    data: procesos,
  }
  res.json(response)
}))

router.get('/procesos/:id', asyncHandler(async (req, res) => {
  const userId = (req as Request & { userId?: number }).userId
  const processId = Number.parseInt(req.params.id, 10)

  if (Number.isNaN(processId)) {
    const response: ApiResponse<null> = { success: false, error: 'ID de proceso invalido' }
    res.status(400).json(response)
    return
  }

  const detail = await getProcesoDemoDetalle(processId, userId as number)
  if (!detail) {
    const response: ApiResponse<null> = { success: false, error: 'Proceso demo no encontrado' }
    res.status(404).json(response)
    return
  }

  const response: ApiResponse<typeof detail> = {
    success: true,
    data: detail,
  }
  res.json(response)
}))

router.get('/conversacion', asyncHandler(async (req, res) => {
  const userId = (req as Request & { userId?: number }).userId
  const usuario = await queryOne<{ id: number; telefono: string }>(
    'SELECT id, telefono FROM usuarios WHERE id = $1',
    [userId],
  )

  if (!usuario) {
    const response: ApiResponse<null> = { success: false, error: 'Usuario no encontrado' }
    res.status(404).json(response)
    return
  }

  const conversacion = await queryOne<{ id: number }>(
    'SELECT id FROM conversaciones_whatsapp WHERE usuario_id = $1 ORDER BY updated_at DESC LIMIT 1',
    [usuario.id],
  )

  if (!conversacion) {
    const response: ApiResponse<{
      state: EstadoConversacion | null
      messages: MensajeWhatsapp[]
      prestaciones: PrestacionCatalogo[]
    }> = {
      success: true,
      data: {
        state: null,
        messages: [],
        prestaciones: [],
      },
    }
    res.json(response)
    return
  }

  const state = await queryOne<EstadoConversacion>(
    'SELECT * FROM estado_conversaciones WHERE conversacion_id = $1',
    [conversacion.id],
  )

  const messages = await query<MensajeWhatsapp>(
    `
      SELECT *
      FROM mensajes_whatsapp
      WHERE conversacion_id = $1
      ORDER BY created_at DESC
      LIMIT 30
    `,
    [conversacion.id],
  )

  const prestaciones = state?.isapre_id
    ? await query<PrestacionCatalogo>(
        `
          SELECT *
          FROM catalogo_prestaciones
          WHERE isapre_id = $1::isapre_id AND activa = true
          ORDER BY orden ASC
        `,
        [state.isapre_id],
      )
    : []

  const response: ApiResponse<{
    state: EstadoConversacion | null
    messages: MensajeWhatsapp[]
    prestaciones: PrestacionCatalogo[]
  }> = {
    success: true,
    data: {
      state: state ?? null,
      messages,
      prestaciones,
    },
  }
  res.json(response)
}))

router.post('/banmedica/urgencia', asyncHandler(async (req, res) => {
  const userId = (req as Request & { userId?: number }).userId
  const body = createBanmedicaSchema.safeParse(req.body)

  if (!body.success) {
    const response: ApiResponse<null> = {
      success: false,
      error: body.error.errors[0]?.message ?? 'Payload invalido',
    }
    res.status(400).json(response)
    return
  }

  const usuario = await queryOne<{ telefono: string }>(
    'SELECT telefono FROM usuarios WHERE id = $1',
    [userId],
  )
  if (!usuario) {
    const response: ApiResponse<null> = { success: false, error: 'Usuario no encontrado' }
    res.status(404).json(response)
    return
  }

  let proceso
  try {
    proceso = await createBanmedicaDemoProcess({
      userId: userId as number,
      telefono: usuario.telefono,
      origen: 'dashboard',
      payload: body.data,
    })
  } catch (error) {
    const response: ApiResponse<null> = {
      success: false,
      error: error instanceof Error ? error.message : 'No se pudo crear el proceso demo',
    }
    res.status(400).json(response)
    return
  }

  const response: ApiResponse<typeof proceso> = {
    success: true,
    data: proceso,
    message: 'Proceso demo Banmedica encolado correctamente',
  }
  res.status(201).json(response)
}))

export default router
