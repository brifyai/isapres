import { getSupabaseClient } from './supabase'
import type { ApiResponse, RegistroUsuarioPayload, Usuario } from '@/types'

interface RegistrationRow {
  id: number
  nombre: string
  telefono: string
  rut: string
  isapre_id: Usuario['credenciales'][number]['isapreId']
  isapre_rut: string
  created_at: string
  updated_at: string
}

function mapRegistrationRow(row: RegistrationRow): Usuario {
  return {
    id: String(row.id),
    nombre: row.nombre,
    telefono: row.telefono,
    rut: row.rut,
    credenciales: [
      {
        isapreId: row.isapre_id,
        rut: row.isapre_rut,
        password: '',
      },
    ],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function normalizeDatabaseError(message: string): string {
  if (/ya existe una cuenta con este teléfono/i.test(message)) {
    return 'Ya existe una cuenta registrada con este teléfono.'
  }

  if (/politica de privacidad|términos y condiciones/i.test(message)) {
    return message
  }

  if (/email_encryption_key/i.test(message)) {
    return 'Falta la clave de cifrado en Supabase. Debes cargar la configuración privada antes de publicar.'
  }

  return 'No se pudo completar el registro. Revisa la configuración de Supabase.'
}

export async function registerUserDirect(
  payload: RegistroUsuarioPayload,
): Promise<ApiResponse<{ usuario: Usuario }>> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase.rpc('register_public_user', {
    p_nombre: payload.nombre.trim(),
    p_telefono: payload.telefono.replace(/\D/g, ''),
    p_rut: payload.rut.trim(),
    p_isapre_id: payload.credenciales.isapreId,
    p_isapre_rut: payload.credenciales.rut.trim(),
    p_isapre_password: payload.credenciales.password,
    p_accepted_privacy_policy: payload.acceptedPrivacyPolicy,
    p_accepted_terms: payload.acceptedTerms,
    p_consent_user_agent: navigator.userAgent,
  })

  if (error) {
    return {
      success: false,
      error: normalizeDatabaseError(error.message),
    }
  }

  const row = Array.isArray(data) ? data[0] : data
  if (!row) {
    return {
      success: false,
      error: 'Supabase no devolvió el usuario registrado.',
    }
  }

  return {
    success: true,
    data: {
      usuario: mapRegistrationRow(row as RegistrationRow),
    },
    message: 'Usuario registrado correctamente.',
  }
}
