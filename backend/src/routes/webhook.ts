import { Router } from 'express'
import { query, queryOne } from '../db.js'
import type { ApiResponse, Reembolso } from '../types.js'
import { asyncHandler } from '../utils/async-handler.js'

const router = Router()
const PUBLIC_APP_URL = process.env.PUBLIC_APP_URL ?? 'https://wsp-isap.cl'

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
    const { from, messageType, mediaUrl, body } = req.body as {
      from?: string
      messageType?: string
      mediaUrl?: string
      body?: string
    }

    if (!from) {
      const response: ApiResponse<null> = { success: false, error: 'Falta el campo "from"' }
      res.status(400).json(response)
      return
    }

    // Limpiar teléfono (remover whatsapp: prefix si existe)
    const telefono = from.replace('whatsapp:', '').replace(/\D/g, '')

    // Buscar usuario por teléfono
    const usuario = await queryOne<{ id: number; rut: string }>(
      'SELECT id, rut FROM usuarios WHERE telefono = $1',
      [telefono],
    )

    if (!usuario) {
      // Usuario no registrado — responder con link de onboarding
      const response: ApiResponse<null> = {
        success: false,
        error: 'Usuario no registrado',
        message: `Tu número no está registrado. Enrólate en: ${PUBLIC_APP_URL}/onboarding?t=${telefono}`,
      }
      res.status(404).json(response)
      return
    }

    // Si es una imagen, crear reembolso
    if (messageType === 'image' && mediaUrl) {
      // Obtener la isapre del usuario (la primera registrada)
      const cred = await queryOne<{ isapre_id: string }>(
        'SELECT isapre_id FROM credenciales_isapre WHERE usuario_id = $1 ORDER BY created_at ASC LIMIT 1',
        [usuario.id],
      )

      if (!cred) {
        const response: ApiResponse<null> = {
          success: false,
          error: 'Usuario sin credenciales de Isapre configuradas',
        }
        res.status(400).json(response)
        return
      }

      // Crear reembolso con monto 0 (se actualizará tras OCR)
      const reembolso = await queryOne<Reembolso>(
        `
          INSERT INTO reembolsos (usuario_id, rut_usuario, isapre, monto, url_documento, estado)
          VALUES ($1, $2, $3::isapre_id, 0, $4, 'en_cola')
          RETURNING *
        `,
        [usuario.id, usuario.rut, cred.isapre_id, mediaUrl],
      )

      if (!reembolso) {
        throw new Error('No se pudo crear el reembolso desde el webhook')
      }

      const response: ApiResponse<Reembolso> = {
        success: true,
        data: reembolso,
        message: 'Boleta recibida. Procesando reembolso...',
      }
      res.status(201).json(response)
      return
    }

    // Si es texto, procesar comando
    if (messageType === 'text' && body) {
      const texto = body.toLowerCase().trim()

      if (texto === 'estado' || texto === 'mis reembolsos') {
        const reembolsos = await query<Reembolso>(
          'SELECT * FROM reembolsos WHERE usuario_id = $1 ORDER BY created_at DESC LIMIT 5',
          [usuario.id],
        )

        const response: ApiResponse<Reembolso[]> = {
          success: true,
          data: reembolsos,
          message: 'Tus últimos reembolsos',
        }
        res.json(response)
        return
      }

      if (texto === 'ayuda' || texto === 'help') {
        const response: ApiResponse<null> = {
          success: true,
          message: 'Comandos: "estado" para ver tus reembolsos, o envía una foto de tu boleta para solicitar uno nuevo.',
        }
        res.json(response)
        return
      }
    }

    // Respuesta por defecto
    const response: ApiResponse<null> = {
      success: true,
      message: 'Mensaje recibido. Envía una foto de tu boleta para solicitar un reembolso.',
    }
    res.json(response)
  } catch (error) {
    console.error('Error procesando webhook de WhatsApp:', error)
    const response: ApiResponse<null> = { success: false, error: 'Error interno del servidor' }
    res.status(500).json(response)
  }
}))

export default router
