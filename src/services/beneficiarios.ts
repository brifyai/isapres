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

    const data = await response.json() as ApiResponse<SyncBeneficiariosResponse>
    return data
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error
        ? error.message
        : 'No se pudo sincronizar beneficiarios.',
    }
  }
}
