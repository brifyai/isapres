import axios, { type AxiosInstance } from 'axios'
import type {
  ApiResponse,
  ConversationAttachment,
  ConversationMessage,
  ConversationSnapshot,
  ConversationState,
  DemoBanmedicaPayload,
  DemoOverview,
  DemoProcess,
  DemoProcessField,
  DemoProcessStep,
  PrestacionDisponible,
  Usuario,
  RegistroUsuarioPayload,
  Reembolso,
  DashboardKPIs,
  PortalMonitor,
  ReembolsoConError,
  WebConversationMessagePayload,
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

interface RawUsuario {
  id: number | string
  nombre: string
  telefono: string
  rut: string
  created_at?: string
  updated_at?: string
  createdAt?: string
  updatedAt?: string
}

interface RawReembolso {
  id: number | string
  rut_usuario: string
  rutUsuario?: string
  isapre: Reembolso['isapre']
  monto: number
  fecha: string
  estado: Reembolso['estado']
  url_documento?: string
  urlDocumento?: string
  folio_isapre?: string | null
  folioIsapre?: string | null
  error?: string | null
  created_at?: string
  updated_at?: string
  createdAt?: string
  updatedAt?: string
}

interface RawDemoProcessStep {
  id: number | string
  orden: number
  etapa: string
  accion: string
  detalle?: string | null
  url?: string | null
  selector?: string | null
  status: DemoProcessStep['status']
  payload?: Record<string, unknown> | null
  created_at?: string
}

interface RawDemoProcessField {
  id: number | string
  campo_key?: string
  campoKey?: string
  label: string
  tipo: string
  selector?: string | null
  requerido: boolean
  valor_ingresado?: string | null
  valorIngresado?: string | null
  metadata?: Record<string, unknown> | null
  created_at?: string
  updated_at?: string
}

interface RawDemoProcess {
  id: number | string
  telefono: string
  isapre_id?: DemoProcess['isapreId']
  isapreId?: DemoProcess['isapreId']
  flujo: string
  origen: string
  estado: DemoProcess['estado']
  resumen?: string | null
  error?: string | null
  metadata?: Record<string, unknown> | null
  intentos: number
  started_at?: string | null
  finished_at?: string | null
  created_at?: string
  updated_at?: string
  pasos?: RawDemoProcessStep[]
  campos?: RawDemoProcessField[]
}

interface RawConversationState {
  id: number | string
  etapa: ConversationState['etapa']
  isapre_id?: ConversationState['isapreId'] | null
  prestacion_id?: number | string | null
  campo_actual_id?: number | string | null
  proceso_demo_id?: number | string | null
  payload?: Record<string, unknown> | null
  metadata?: Record<string, unknown> | null
  updated_at?: string
}

interface RawConversationMessage {
  id: number | string
  direccion: ConversationMessage['direccion']
  tipo: ConversationMessage['tipo']
  contenido?: string | null
  metadata?: Record<string, unknown> | null
  created_at?: string
}

interface RawConversationAttachment {
  id: number | string
  nombre_archivo?: string
  nombreArchivo?: string
  mime_type?: string
  mimeType?: string
  tamano_bytes?: number | null
  tamanoBytes?: number | null
  extracted_data?: Record<string, unknown> | null
  extractedData?: Record<string, unknown> | null
  metadata?: Record<string, unknown> | null
  created_at?: string
  updated_at?: string
}

interface RawPrestacionDisponible {
  id: number | string
  isapre_id?: PrestacionDisponible['isapreId']
  codigo: string
  nombre: string
  descripcion?: string | null
  requiere_formulario: boolean
  requiere_adjuntos: boolean
  activa: boolean
  orden: number
  metadata?: Record<string, unknown> | null
}

function mapUsuario(raw: RawUsuario): Usuario {
  return {
    id: String(raw.id),
    nombre: raw.nombre,
    telefono: raw.telefono,
    rut: raw.rut,
    credenciales: [],
    createdAt: raw.created_at ?? raw.createdAt ?? new Date().toISOString(),
    updatedAt: raw.updated_at ?? raw.updatedAt ?? new Date().toISOString(),
  }
}

function mapReembolso(raw: RawReembolso): Reembolso {
  return {
    id: String(raw.id),
    rutUsuario: raw.rutUsuario ?? raw.rut_usuario,
    isapre: raw.isapre,
    monto: raw.monto,
    fecha: raw.fecha,
    estado: raw.estado,
    urlDocumento: raw.urlDocumento ?? raw.url_documento ?? '',
    folioIsapre: raw.folioIsapre ?? raw.folio_isapre ?? undefined,
    error: raw.error ?? undefined,
    createdAt: raw.created_at ?? raw.createdAt ?? raw.fecha,
    updatedAt: raw.updated_at ?? raw.updatedAt ?? raw.fecha,
  }
}

function mapDemoProcessStep(raw: RawDemoProcessStep): DemoProcessStep {
  return {
    id: String(raw.id),
    orden: raw.orden,
    etapa: raw.etapa,
    accion: raw.accion,
    detalle: raw.detalle ?? undefined,
    url: raw.url ?? undefined,
    selector: raw.selector ?? undefined,
    status: raw.status,
    payload: raw.payload ?? undefined,
    createdAt: raw.created_at ?? new Date().toISOString(),
  }
}

function mapDemoProcessField(raw: RawDemoProcessField): DemoProcessField {
  return {
    id: String(raw.id),
    campoKey: raw.campoKey ?? raw.campo_key ?? '',
    label: raw.label,
    tipo: raw.tipo,
    selector: raw.selector ?? undefined,
    requerido: raw.requerido,
    valorIngresado: raw.valorIngresado ?? raw.valor_ingresado ?? undefined,
    metadata: raw.metadata ?? undefined,
    createdAt: raw.created_at ?? new Date().toISOString(),
    updatedAt: raw.updated_at ?? new Date().toISOString(),
  }
}

function mapDemoProcess(raw: RawDemoProcess): DemoProcess {
  return {
    id: String(raw.id),
    telefono: raw.telefono,
    isapreId: raw.isapreId ?? raw.isapre_id ?? 'banmedica',
    flujo: raw.flujo,
    origen: raw.origen,
    estado: raw.estado,
    resumen: raw.resumen ?? undefined,
    error: raw.error ?? undefined,
    metadata: raw.metadata ?? undefined,
    intentos: raw.intentos,
    startedAt: raw.started_at ?? undefined,
    finishedAt: raw.finished_at ?? undefined,
    createdAt: raw.created_at ?? new Date().toISOString(),
    updatedAt: raw.updated_at ?? new Date().toISOString(),
    pasos: raw.pasos?.map(mapDemoProcessStep),
    campos: raw.campos?.map(mapDemoProcessField),
  }
}

function mapConversationState(raw: RawConversationState): ConversationState {
  return {
    id: String(raw.id),
    etapa: raw.etapa,
    isapreId: raw.isapre_id ?? undefined,
    prestacionId: raw.prestacion_id ? String(raw.prestacion_id) : undefined,
    campoActualId: raw.campo_actual_id ? String(raw.campo_actual_id) : undefined,
    procesoDemoId: raw.proceso_demo_id ? String(raw.proceso_demo_id) : undefined,
    payload: raw.payload ?? undefined,
    metadata: raw.metadata ?? undefined,
    updatedAt: raw.updated_at ?? new Date().toISOString(),
  }
}

function mapConversationMessage(raw: RawConversationMessage): ConversationMessage {
  return {
    id: String(raw.id),
    direccion: raw.direccion,
    tipo: raw.tipo,
    contenido: raw.contenido ?? undefined,
    metadata: raw.metadata ?? undefined,
    createdAt: raw.created_at ?? new Date().toISOString(),
  }
}

function mapConversationAttachment(raw: RawConversationAttachment): ConversationAttachment {
  return {
    id: String(raw.id),
    nombreArchivo: raw.nombreArchivo ?? raw.nombre_archivo ?? 'adjunto',
    mimeType: raw.mimeType ?? raw.mime_type ?? 'application/octet-stream',
    tamanoBytes: raw.tamanoBytes ?? raw.tamano_bytes ?? undefined,
    extractedData: raw.extractedData ?? raw.extracted_data ?? undefined,
    metadata: raw.metadata ?? undefined,
    createdAt: raw.created_at ?? new Date().toISOString(),
    updatedAt: raw.updated_at ?? new Date().toISOString(),
  }
}

function mapPrestacionDisponible(raw: RawPrestacionDisponible): PrestacionDisponible {
  return {
    id: String(raw.id),
    isapreId: raw.isapre_id ?? 'banmedica',
    codigo: raw.codigo,
    nombre: raw.nombre,
    descripcion: raw.descripcion ?? undefined,
    requiereFormulario: raw.requiere_formulario,
    requiereAdjuntos: raw.requiere_adjuntos,
    activa: raw.activa,
    orden: raw.orden,
    // El catálogo sólo marca las bloqueadas; ausencia del flag = disponible.
    disponible: raw.metadata?.disponible !== false,
  }
}

// ──────────────────────── Auth & Onboarding ────────────────────────

/**
 * Registra un nuevo usuario desde el onboarding de WhatsApp.
 * POST /api/auth/register
 */
export async function registerUser(
  payload: RegistroUsuarioPayload,
): Promise<ApiResponse<{ usuario: Usuario; token: string }>> {
  const { data } = await apiClient.post<ApiResponse<{ usuario: RawUsuario; token: string }>>(
    '/auth/register',
    payload,
  )
  return {
    ...data,
    data: data.data
      ? {
          usuario: mapUsuario(data.data.usuario),
          token: data.data.token,
        }
      : undefined,
  }
}

/**
 * Inicia sesión con teléfono + OTP.
 * POST /api/auth/login
 */
export async function login(
  telefono: string,
  otp: string,
): Promise<ApiResponse<{ usuario: Usuario; token: string }>> {
  const { data } = await apiClient.post<ApiResponse<{ usuario: RawUsuario; token: string }>>(
    '/auth/login',
    { telefono, otp },
  )
  return {
    ...data,
    data: data.data
      ? {
          usuario: mapUsuario(data.data.usuario),
          token: data.data.token,
        }
      : undefined,
  }
}

/**
 * Obtiene el perfil del usuario autenticado.
 * GET /api/auth/me
 */
export async function getCurrentUser(): Promise<ApiResponse<Usuario>> {
  const { data } = await apiClient.get<ApiResponse<RawUsuario>>('/auth/me')
  return {
    ...data,
    data: data.data ? mapUsuario(data.data) : undefined,
  }
}

// ──────────────────────── Reembolsos ────────────────────────

/**
 * Lista los reembolsos del usuario autenticado.
 * GET /api/reembolsos
 */
export async function getReembolsos(): Promise<ApiResponse<Reembolso[]>> {
  const { data } = await apiClient.get<ApiResponse<RawReembolso[]>>('/reembolsos')
  return {
    ...data,
    data: data.data?.map(mapReembolso),
  }
}

/**
 * Obtiene un reembolso específico por ID.
 * GET /api/reembolsos/:id
 */
export async function getReembolsoById(id: string): Promise<ApiResponse<Reembolso>> {
  const { data } = await apiClient.get<ApiResponse<RawReembolso>>(`/reembolsos/${id}`)
  return {
    ...data,
    data: data.data ? mapReembolso(data.data) : undefined,
  }
}

/**
 * Crea una nueva solicitud de reembolso.
 * POST /api/reembolsos
 */
export async function createReembolso(
  payload: Pick<Reembolso, 'isapre' | 'monto' | 'urlDocumento'>,
): Promise<ApiResponse<Reembolso>> {
  const { data } = await apiClient.post<ApiResponse<RawReembolso>>('/reembolsos', payload)
  return {
    ...data,
    data: data.data ? mapReembolso(data.data) : undefined,
  }
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
  const { data } = await apiClient.post<ApiResponse<RawReembolso>>(
    `/admin/errores/${id}/reintentar`,
  )
  return {
    ...data,
    data: data.data ? mapReembolso(data.data) : undefined,
  }
}

/**
 * Edita manualmente un reembolso (intervención del admin).
 * PATCH /api/admin/errores/:id
 */
export async function editarReembolsoManual(
  id: string,
  payload: Partial<Pick<Reembolso, 'monto' | 'folioIsapre' | 'estado'>>,
): Promise<ApiResponse<Reembolso>> {
  const { data } = await apiClient.patch<ApiResponse<RawReembolso>>(
    `/admin/errores/${id}`,
    payload,
  )
  return {
    ...data,
    data: data.data ? mapReembolso(data.data) : undefined,
  }
}

export async function getDemoOverview(): Promise<ApiResponse<DemoOverview>> {
  const { data } = await apiClient.get<
    ApiResponse<{
      whatsappEntryUrl: string | null
      primaryIsapre: DemoOverview['primaryIsapre']
      activeProcesses: number
      latestProcess: RawDemoProcess | null
    }>
  >('/demo/overview')

  return {
    ...data,
    data: data.data
      ? {
          whatsappEntryUrl: data.data.whatsappEntryUrl,
          primaryIsapre: data.data.primaryIsapre,
          activeProcesses: data.data.activeProcesses,
          latestProcess: data.data.latestProcess ? mapDemoProcess(data.data.latestProcess) : null,
        }
      : undefined,
  }
}

export async function getDemoProcesos(): Promise<ApiResponse<DemoProcess[]>> {
  const { data } = await apiClient.get<ApiResponse<RawDemoProcess[]>>('/demo/procesos')
  return {
    ...data,
    data: data.data?.map(mapDemoProcess),
  }
}

export async function getDemoProcesoById(id: string): Promise<ApiResponse<DemoProcess>> {
  const { data } = await apiClient.get<ApiResponse<RawDemoProcess>>(`/demo/procesos/${id}`)
  return {
    ...data,
    data: data.data ? mapDemoProcess(data.data) : undefined,
  }
}

export async function createBanmedicaDemo(
  payload: DemoBanmedicaPayload,
): Promise<ApiResponse<DemoProcess>> {
  const { data } = await apiClient.post<ApiResponse<RawDemoProcess>>(
    '/demo/banmedica/urgencia',
    payload,
  )
  return {
    ...data,
    data: data.data ? mapDemoProcess(data.data) : undefined,
  }
}

export async function getConversationSnapshot(
  channel: 'web' | 'whatsapp' = 'web',
): Promise<ApiResponse<ConversationSnapshot>> {
  const { data } = await apiClient.get<
    ApiResponse<{
      channel: 'web' | 'whatsapp'
      state: RawConversationState | null
      messages: RawConversationMessage[]
      prestaciones: RawPrestacionDisponible[]
      attachments: RawConversationAttachment[]
    }>
  >('/demo/conversacion', {
    params: { canal: channel },
  })

  return {
    ...data,
    data: data.data
      ? {
          channel: data.data.channel,
          state: data.data.state ? mapConversationState(data.data.state) : null,
          messages: data.data.messages.map(mapConversationMessage),
          prestaciones: data.data.prestaciones.map(mapPrestacionDisponible),
          attachments: data.data.attachments.map(mapConversationAttachment),
        }
      : undefined,
  }
}

export async function sendWebConversationMessage(
  payload: WebConversationMessagePayload,
): Promise<ApiResponse<ConversationSnapshot>> {
  const { data } = await apiClient.post<
    ApiResponse<{
      channel: 'web'
      state: RawConversationState | null
      messages: RawConversationMessage[]
      prestaciones: RawPrestacionDisponible[]
      attachments: RawConversationAttachment[]
    }>
  >('/demo/conversacion/web/message', payload)

  return {
    ...data,
    data: data.data
      ? {
          channel: data.data.channel,
          state: data.data.state ? mapConversationState(data.data.state) : null,
          messages: data.data.messages.map(mapConversationMessage),
          prestaciones: data.data.prestaciones.map(mapPrestacionDisponible),
          attachments: data.data.attachments.map(mapConversationAttachment),
        }
      : undefined,
  }
}
