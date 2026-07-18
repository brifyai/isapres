import { Router, type Request } from 'express'
import { z } from 'zod'
import { query, queryOne } from '../db.js'
import { requireAuth } from '../middleware/auth.js'
import type {
  ApiResponse,
  ArchivoConversacion,
  EstadoConversacion,
  MensajeWhatsapp,
  PrestacionCatalogo,
  ProcesoDemo,
} from '../types.js'
import { asyncHandler } from '../utils/async-handler.js'
import {
  getConversationSnapshotByChannel,
  processWebConversationMessage,
} from '../utils/conversation-engine.js'
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

const conversationQuerySchema = z.object({
  canal: z.enum(['web', 'whatsapp']).optional().default('web'),
})

const webMessageSchema = z.object({
  text: z.string().max(2000).optional().default(''),
  prestacionCodigo: z.string().max(120).optional().nullable(),
  attachments: z.array(z.object({
    fileName: z.string().min(1).max(255),
    mimeType: z.string().min(3).max(120),
    base64Data: z.string().min(20),
    sizeBytes: z.number().int().nonnegative().optional().nullable(),
    role: z.enum(['voucher', 'detalle', 'orden_medica', 'boleta', 'otro']).optional(),
  })).max(4).optional().default([]),
}).refine(
  (value) => Boolean(value.text.trim() || value.prestacionCodigo || value.attachments.length),
  { message: 'Debes enviar un mensaje, una prestación o al menos un adjunto.' },
)

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
  const parsedQuery = conversationQuerySchema.safeParse(req.query)
  if (!parsedQuery.success) {
    const response: ApiResponse<null> = { success: false, error: 'Canal de conversación inválido' }
    res.status(400).json(response)
    return
  }

  const snapshot = await getConversationSnapshotByChannel(userId as number, parsedQuery.data.canal)

  const response: ApiResponse<{
    channel: 'web' | 'whatsapp'
    state: EstadoConversacion | null
    messages: MensajeWhatsapp[]
    prestaciones: PrestacionCatalogo[]
    attachments: ArchivoConversacion[]
  }> = {
    success: true,
    data: {
      channel: parsedQuery.data.canal,
      state: snapshot.state,
      messages: snapshot.messages,
      prestaciones: snapshot.prestaciones,
      attachments: snapshot.attachments,
    },
  }
  res.json(response)
}))

router.post('/conversacion/web/message', asyncHandler(async (req, res) => {
  const userId = (req as Request & { userId?: number }).userId
  const body = webMessageSchema.safeParse(req.body)

  if (!body.success) {
    const response: ApiResponse<null> = {
      success: false,
      error: body.error.errors[0]?.message ?? 'Payload inválido',
    }
    res.status(400).json(response)
    return
  }

  await processWebConversationMessage({
    userId: userId as number,
    text: body.data.text,
    prestacionCodigo: body.data.prestacionCodigo,
    attachments: body.data.attachments,
  })

  const snapshot = await getConversationSnapshotByChannel(userId as number, 'web')
  const response: ApiResponse<{
    channel: 'web'
    state: EstadoConversacion | null
    messages: MensajeWhatsapp[]
    prestaciones: PrestacionCatalogo[]
    attachments: ArchivoConversacion[]
  }> = {
    success: true,
    data: {
      channel: 'web',
      state: snapshot.state,
      messages: snapshot.messages,
      prestaciones: snapshot.prestaciones,
      attachments: snapshot.attachments,
    },
    message: 'Mensaje web procesado correctamente',
  }

  res.status(201).json(response)
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
