import { decryptCredential } from '../_lib/crypto.js'
import { syncBanmedicaBeneficiarios } from '../_lib/banmedica.js'
import { getAdminSupabase } from '../_lib/supabase.js'

function sendJson(res, status, payload) {
  res.status(status).setHeader('Content-Type', 'application/json')
  res.send(JSON.stringify(payload))
}

function normalizeBody(req) {
  if (!req.body) {
    return {}
  }

  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body)
    } catch {
      return {}
    }
  }

  return req.body
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return sendJson(res, 405, { success: false, error: 'Método no permitido.' })
  }

  try {
    const body = normalizeBody(req)
    const userId = Number.parseInt(String(body.userId ?? ''), 10)
    const telefono = String(body.telefono ?? '').replace(/\D/g, '')
    const rut = String(body.rut ?? '').trim()
    const verificationCode = String(body.verificationCode ?? '').trim()
    const verificationSessionId = String(body.verificationSessionId ?? '').trim()
    const resendVerification = body.resendVerification === true

    if (!Number.isInteger(userId) || !telefono || !rut) {
      return sendJson(res, 400, {
        success: false,
        error: 'Faltan datos del usuario para sincronizar beneficiarios.',
      })
    }

    const supabase = getAdminSupabase()
    const { data, error } = await supabase
      .from('usuarios')
      .select(`
        id,
        nombre,
        telefono,
        rut,
        beneficiarios,
        beneficiarios_updated_at,
        created_at,
        updated_at,
        credenciales_isapre (
          isapre_id,
          rut,
          password_encrypted
        )
      `)
      .eq('id', userId)
      .eq('telefono', telefono)
      .eq('rut', rut)
      .single()

    if (error || !data) {
      return sendJson(res, 404, {
        success: false,
        error: 'No se encontró el usuario enrolado para sincronizar.',
      })
    }

    const credencial = Array.isArray(data.credenciales_isapre)
      ? data.credenciales_isapre[0]
      : null

    if (!credencial) {
      return sendJson(res, 400, {
        success: false,
        error: 'El usuario no tiene credenciales de Isapre configuradas.',
      })
    }

    if (credencial.isapre_id !== 'banmedica') {
      return sendJson(res, 400, {
        success: false,
        error: 'Por ahora la sincronización de beneficiarios solo está habilitada para Banmédica.',
      })
    }

    const password = decryptCredential(credencial.password_encrypted)
    const syncResult = await syncBanmedicaBeneficiarios({
      userId: data.id,
      rut: credencial.rut,
      password,
      verificationCode,
      verificationSessionId,
      resendVerification,
    })

    if (syncResult.requiresVerification) {
      return sendJson(res, 200, {
        success: true,
        data: {
          requiresVerification: true,
          verificationSessionId: syncResult.verificationSessionId,
          verificationMessage: syncResult.verificationMessage,
          usuario: {
            id: String(data.id),
            nombre: data.nombre,
            telefono: data.telefono,
            rut: data.rut,
            credenciales: [
              {
                isapreId: credencial.isapre_id,
                rut: credencial.rut,
                password: '',
              },
            ],
            beneficiarios: Array.isArray(data.beneficiarios) ? data.beneficiarios : [],
            beneficiariosUpdatedAt: data.beneficiarios_updated_at,
            createdAt: data.created_at,
            updatedAt: data.updated_at,
          },
        },
      })
    }

    const updatedAt = new Date().toISOString()

    const { error: updateError } = await supabase
      .from('usuarios')
      .update({
        beneficiarios: syncResult.beneficiarios,
        beneficiarios_updated_at: updatedAt,
      })
      .eq('id', data.id)

    if (updateError) {
      throw updateError
    }

    return sendJson(res, 200, {
      success: true,
      data: {
        beneficiarios: syncResult.beneficiarios,
        updatedAt,
        usuario: {
          id: String(data.id),
          nombre: data.nombre,
          telefono: data.telefono,
          rut: data.rut,
          credenciales: [
            {
              isapreId: credencial.isapre_id,
              rut: credencial.rut,
              password: '',
            },
          ],
          beneficiarios: syncResult.beneficiarios,
          beneficiariosUpdatedAt: updatedAt,
          createdAt: data.created_at,
          updatedAt: data.updated_at,
        },
      },
    })
  } catch (error) {
    console.error('Error sincronizando beneficiarios', error)
    return sendJson(res, 500, {
      success: false,
      error: error instanceof Error
        ? error.message
        : 'No se pudieron sincronizar los beneficiarios.',
    })
  }
}
