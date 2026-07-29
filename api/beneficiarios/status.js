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

    if (!Number.isInteger(userId) || !telefono || !rut) {
      return sendJson(res, 400, {
        success: false,
        error: 'Faltan datos del usuario para revisar beneficiarios.',
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
          rut
        )
      `)
      .eq('id', userId)
      .eq('telefono', telefono)
      .eq('rut', rut)
      .single()

    if (error || !data) {
      return sendJson(res, 404, {
        success: false,
        error: 'No se encontró el usuario enrolado.',
      })
    }

    const credencial = Array.isArray(data.credenciales_isapre)
      ? data.credenciales_isapre[0]
      : null
    const beneficiarios = Array.isArray(data.beneficiarios) ? data.beneficiarios : []

    return sendJson(res, 200, {
      success: true,
      data: {
        hasBeneficiarios: beneficiarios.length > 0,
        beneficiarios,
        updatedAt: data.beneficiarios_updated_at,
        usuario: {
          id: String(data.id),
          nombre: data.nombre,
          telefono: data.telefono,
          rut: data.rut,
          credenciales: credencial
            ? [
                {
                  isapreId: credencial.isapre_id,
                  rut: credencial.rut,
                  password: '',
                },
              ]
            : [],
          beneficiarios,
          beneficiariosUpdatedAt: data.beneficiarios_updated_at,
          createdAt: data.created_at,
          updatedAt: data.updated_at,
        },
      },
    })
  } catch (error) {
    console.error('Error revisando beneficiarios', error)
    return sendJson(res, 500, {
      success: false,
      error: error instanceof Error
        ? error.message
        : 'No se pudo revisar el estado de beneficiarios.',
    })
  }
}
