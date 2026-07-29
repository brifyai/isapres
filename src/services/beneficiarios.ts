import type { ApiResponse, Beneficiario, Usuario } from '@/types'

interface SyncBeneficiariosResponse {
  usuario?: Usuario
  beneficiarios?: Beneficiario[]
  updatedAt?: string
  requiresVerification?: boolean
  verificationSessionId?: string
  verificationMessage?: string
}

interface SyncBeneficiariosOptions {
  verificationCode?: string
  verificationSessionId?: string
  resendVerification?: boolean
}

interface BeneficiariosStatusResponse {
  usuario?: Usuario
  beneficiarios?: Beneficiario[]
  updatedAt?: string
  hasBeneficiarios?: boolean
}

async function parseApiResponse<T>(response: Response, fallbackMessage: string): Promise<ApiResponse<T>> {
  const rawBody = await response.text()
  let data: ApiResponse<T> | null = null

  if (rawBody) {
    try {
      data = JSON.parse(rawBody) as ApiResponse<T>
    } catch {
      data = null
    }
  }

  if (!response.ok) {
    return {
      success: false,
      error:
        data?.error
        ?? data?.message
        ?? (rawBody.trim() ? `Error ${response.status}: ${rawBody.trim()}` : fallbackMessage),
    }
  }

  if (data) {
    return data
  }

  return {
    success: false,
    error: 'La API respondió sin un payload JSON válido.',
  }
}

export async function syncBeneficiarios(
  input: Pick<Usuario, 'id' | 'telefono' | 'rut'>,
  options?: SyncBeneficiariosOptions,
): Promise<ApiResponse<SyncBeneficiariosResponse>> {
  try {
    const response = await fetch('/api/beneficiarios/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userId: input.id,
        telefono: input.telefono,
        rut: input.rut,
        verificationCode: options?.verificationCode,
        verificationSessionId: options?.verificationSessionId,
        resendVerification: options?.resendVerification,
      }),
    })

    return parseApiResponse<SyncBeneficiariosResponse>(
      response,
      `Error ${response.status} al sincronizar beneficiarios.`,
    )
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error
        ? error.message
        : 'No se pudo sincronizar beneficiarios.',
    }
  }
}

export async function getBeneficiariosStatus(
  input: Pick<Usuario, 'id' | 'telefono' | 'rut'>,
): Promise<ApiResponse<BeneficiariosStatusResponse>> {
  try {
    const response = await fetch('/api/beneficiarios/status', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userId: input.id,
        telefono: input.telefono,
        rut: input.rut,
      }),
    })

    return parseApiResponse<BeneficiariosStatusResponse>(
      response,
      `Error ${response.status} al revisar beneficiarios.`,
    )
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error
        ? error.message
        : 'No se pudo revisar el estado de beneficiarios.',
    }
  }
}
