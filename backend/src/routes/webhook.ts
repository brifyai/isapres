import { Router, type Request } from 'express'
import { queryOne } from '../db.js'
import type { ApiResponse, Reembolso } from '../types.js'
import { asyncHandler } from '../utils/async-handler.js'
import { ensureWhatsappConversation, getUserPrimaryIsapre, logWhatsappMessage } from '../utils/demo-process.js'
import { processKapsoWebhookBatch } from '../utils/conversation-engine.js'
import { verifyKapsoSignature } from '../utils/kapso-client.js'

const router = Router()
const PUBLIC_APP_URL = process.env.PUBLIC_APP_URL ?? 'https://wsp-isap.cl'

async function handleLegacyWebhook(req: Request): Promise<{ status: number; body: ApiResponse<unknown> }> {
  const { from, messageType, mediaUrl, body } = req.body as {
    from?: string
    messageType?: string
    mediaUrl?: string
    body?: string
  }

  if (!from) {
    return {
      status: 400,
      body: { success: false, error: 'Falta el campo "from"' },
    }
  }

  const telefono = from.replace('whatsapp:', '').replace(/\D/g, '')
  const usuario = await queryOne<{ id: number; rut: string; telefono: string }>(
    'SELECT id, rut, telefono FROM usuarios WHERE telefono = $1',
    [telefono],
  )

  const conversacion = await ensureWhatsappConversation(usuario?.id ?? null, telefono)
  await logWhatsappMessage({
    conversacionId: conversacion.id,
    direccion: 'entrante',
    tipo: messageType === 'image' ? 'image' : 'text',
    contenido: body ?? mediaUrl ?? null,
    metadata: { from, mediaUrl: mediaUrl ?? null, legacy: true },
  })

  if (!usuario) {
    const onboardingUrl = `${PUBLIC_APP_URL}/?t=${telefono}`
    await logWhatsappMessage({
      conversacionId: conversacion.id,
      direccion: 'saliente',
      tipo: 'system',
      contenido: `Tu número no está registrado. Enrólate en: ${onboardingUrl}`,
      metadata: { onboardingUrl },
    })
    return {
      status: 404,
      body: {
        success: false,
        error: 'Usuario no registrado',
        message: `Tu número no está registrado. Enrólate en: ${onboardingUrl}`,
      },
    }
  }

  if (messageType === 'image' && mediaUrl) {
    const isapreId = await getUserPrimaryIsapre(usuario.id)
    if (!isapreId) {
      return {
        status: 400,
        body: {
          success: false,
          error: 'Usuario sin Isapre configurada',
        },
      }
    }

    const reembolso = await queryOne<Reembolso>(
      `
        INSERT INTO reembolsos (usuario_id, rut_usuario, isapre, monto, url_documento, estado)
        VALUES ($1, $2, $3::isapre_id, 0, $4, 'en_cola')
        RETURNING *
      `,
      [usuario.id, usuario.rut, isapreId, mediaUrl],
    )

    if (!reembolso) {
      throw new Error('No se pudo crear el reembolso desde el webhook legacy')
    }

    await logWhatsappMessage({
      conversacionId: conversacion.id,
      direccion: 'saliente',
      tipo: 'system',
      contenido: 'Boleta recibida. Procesando reembolso...',
      metadata: { reembolsoId: reembolso.id, legacy: true },
    })

    return {
      status: 201,
      body: {
        success: true,
        data: reembolso,
        message: 'Boleta recibida. Procesando reembolso...',
      },
    }
  }

  return {
    status: 200,
    body: {
      success: true,
      message: 'Webhook legacy recibido. Para el flujo conversacional usa Kapso con eventos v2.',
    },
  }
}

/**
 * POST /api/webhook/whatsapp
 *
 * Recibe webhooks de WhatsApp (Twilio, WhatsApp Business API, etc.).
 * Cuando un usuario envía una imagen de boleta, se crea un reembolso
 * con estado 'en_cola' para que el RPA lo procese.
 *
 * Body esperado (formato simplificado):
 * {
 *   "from": "56912345678",
 *   "messageType": "image" | "text",
 *   "mediaUrl": "https://...",
 *   "body": "texto del mensaje"
 * }
 */
router.post('/whatsapp', asyncHandler(async (req, res) => {
  try {
    const eventName = req.headers['x-webhook-event']
    if (typeof eventName === 'string') {
      const signature = req.headers['x-webhook-signature']
      const isValidSignature = verifyKapsoSignature(req.rawBody ?? JSON.stringify(req.body), typeof signature === 'string' ? signature : undefined)
      if (!isValidSignature) {
        res.status(401).send('Invalid signature')
        return
      }

      const isBatch = req.headers['x-webhook-batch'] === 'true' || req.body?.batch === true
      const payloads = isBatch ? req.body.data : [req.body]
      await processKapsoWebhookBatch({
        eventName,
        idempotencyKey: typeof req.headers['x-idempotency-key'] === 'string' ? req.headers['x-idempotency-key'] : null,
        payloads,
      })
      res.status(200).send('OK')
      return
    }

    const legacyResponse = await handleLegacyWebhook(req)
    res.status(legacyResponse.status).json(legacyResponse.body)
  } catch (error) {
    console.error('Error procesando webhook de WhatsApp:', error)
    const response: ApiResponse<null> = { success: false, error: 'Error interno del servidor' }
    res.status(500).json(response)
  }
}))

export default router
