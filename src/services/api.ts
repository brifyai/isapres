import axios, { type AxiosInstance } from 'axios'
import type {
  ApiResponse,
  Usuario,
  RegistroUsuarioPayload,
  Reembolso,
  DashboardKPIs,
  PortalMonitor,
  ReembolsoConError,
} from '@/types'

/**
 * Cliente HTTP configurado para el backend de WSP-ISAP.
 * La URL base se lee desde variables de entorno (Vite).
 */
const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api'

export const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
})

// ──────────────────────── Interceptors ────────────────────────

/** Adjunta el token JWT (si existe) a cada request. */
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('wsp-isap-token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

/** Normaliza errores de red para un manejo consistente. */
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const normalizedError = new Error(
      error.response?.data?.message ??
        error.response?.data?.error ??
        'Error de conexión. Intenta nuevamente.',
    )
    return Promise.reject(normalizedError)
  },
)

// ──────────────────────── Auth & Onboarding ────────────────────────

/**
 * Registra un nuevo usuario desde el onboarding de WhatsApp.
 * POST /api/auth/register
 */
export async function registerUser(
  payload: RegistroUsuarioPayload,
): Promise<ApiResponse<{ usuario: Usuario; token: string }>> {
  const { data } = await apiClient.post<ApiResponse<{ usuario: Usuario; token: string }>>(
    '/auth/register',
    payload,
  )
  return data
}

/**
 * Inicia sesión con teléfono + OTP.
 * POST /api/auth/login
 */
export async function login(
  telefono: string,
  otp: string,
): Promise<ApiResponse<{ usuario: Usuario; token: string }>> {
  const { data } = await apiClient.post<ApiResponse<{ usuario: Usuario; token: string }>>(
    '/auth/login',
    { telefono, otp },
  )
  return data
}

/**
 * Obtiene el perfil del usuario autenticado.
 * GET /api/auth/me
 */
export async function getCurrentUser(): Promise<ApiResponse<Usuario>> {
  const { data } = await apiClient.get<ApiResponse<Usuario>>('/auth/me')
  return data
}

// ──────────────────────── Reembolsos ────────────────────────

/**
 * Lista los reembolsos del usuario autenticado.
 * GET /api/reembolsos
 */
export async function getReembolsos(): Promise<ApiResponse<Reembolso[]>> {
  const { data } = await apiClient.get<ApiResponse<Reembolso[]>>('/reembolsos')
  return data
}

/**
 * Obtiene un reembolso específico por ID.
 * GET /api/reembolsos/:id
 */
export async function getReembolsoById(id: string): Promise<ApiResponse<Reembolso>> {
  const { data } = await apiClient.get<ApiResponse<Reembolso>>(`/reembolsos/${id}`)
  return data
}

/**
 * Crea una nueva solicitud de reembolso.
 * POST /api/reembolsos
 */
export async function createReembolso(
  payload: Pick<Reembolso, 'isapre' | 'monto' | 'urlDocumento'>,
): Promise<ApiResponse<Reembolso>> {
  const { data } = await apiClient.post<ApiResponse<Reembolso>>('/reembolsos', payload)
  return data
}

/**
 * Obtiene los KPIs del dashboard del usuario.
 * GET /api/reembolsos/kpis
 */
export async function getDashboardKPIs(): Promise<ApiResponse<DashboardKPIs>> {
  const { data } = await apiClient.get<ApiResponse<DashboardKPIs>>('/reembolsos/kpis')
  return data
}

// ──────────────────────── Panel Admin ────────────────────────

/**
 * Obtiene el estado de los portales de Isapres.
 * GET /api/portales/status
 */
export async function getPortalesStatus(): Promise<ApiResponse<PortalMonitor[]>> {
  const { data } = await apiClient.get<ApiResponse<PortalMonitor[]>>('/portales/status')
  return data
}

/**
 * Obtiene la cola de reembolsos con errores.
 * GET /api/admin/errores
 */
export async function getColaErrores(): Promise<ApiResponse<ReembolsoConError[]>> {
  const { data } = await apiClient.get<ApiResponse<ReembolsoConError[]>>('/admin/errores')
  return data
}

/**
 * Reintenta el procesamiento RPA de un reembolso rechazado.
 * POST /api/admin/errores/:id/reintentar
 */
export async function reintentarReembolso(
  id: string,
): Promise<ApiResponse<Reembolso>> {
  const { data } = await apiClient.post<ApiResponse<Reembolso>>(
    `/admin/errores/${id}/reintentar`,
  )
  return data
}

/**
 * Edita manualmente un reembolso (intervención del admin).
 * PATCH /api/admin/errores/:id
 */
export async function editarReembolsoManual(
  id: string,
  payload: Partial<Pick<Reembolso, 'monto' | 'folioIsapre' | 'estado'>>,
): Promise<ApiResponse<Reembolso>> {
  const { data } = await apiClient.patch<ApiResponse<Reembolso>>(
    `/admin/errores/${id}`,
    payload,
  )
  return data
}