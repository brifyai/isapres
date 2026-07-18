/**
 * Tipos compartidos del backend — WSP-ISAPsss
 */

export type IsapreId =
  | 'colmena'
  | 'banmedica'
  | 'consalud'
  | 'cruzblanca'
  | 'nueva_masvida'
  | 'vida_tres'
  | 'esencial'

export type EstadoSolicitud =
  | 'en_cola'
  | 'procesando_ocr'
  | 'iniciando_sesion'
  | 'subiendo_boleta'
  | 'exitoso'
  | 'rechazado'

export type PortalStatus = 'operativo' | 'caido' | 'html_cambiado' | 'mantenimiento'
export type EstadoProcesoDemo = 'pendiente' | 'en_progreso' | 'completado' | 'fallido'
export type DireccionMensaje = 'entrante' | 'saliente' | 'sistema'
export type TipoMensajeWhatsapp = 'text' | 'image' | 'interactive' | 'document' | 'audio' | 'system'
export type EtapaConversacion = 'idle' | 'awaiting_prestacion' | 'awaiting_field' | 'processing' | 'completed'
export type CanalConversacion = 'whatsapp' | 'web'

export interface Usuario {
  id: number
  nombre: string
  telefono: string
  rut: string
  created_at: string
  updated_at: string
}

export interface CredencialesIsapre {
  id: number
  usuario_id: number
  isapre_id: IsapreId
  rut: string
  password_encrypted: string
  created_at: string
  updated_at: string
}

export interface Reembolso {
  id: number
  usuario_id: number
  rut_usuario: string
  isapre: IsapreId
  monto: number
  fecha: string
  estado: EstadoSolicitud
  url_documento: string
  folio_isapre: string | null
  error: string | null
  intentos: number
  created_at: string
  updated_at: string
}

export interface PortalMonitor {
  isapre_id: IsapreId
  isapre_nombre: string
  status: PortalStatus
  ultima_ejecucion_exitosa: string
  latencia_ms: number | null
  mensaje_error: string | null
}

export interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
  message?: string
}

export interface AuthPayload {
  usuario: Usuario
  token: string
}

export interface DashboardKPIs {
  totalReembolsado: number
  solicitudesPendientes: number
  solicitudesExitosas: number
}

export interface ConversacionWhatsapp {
  id: number
  usuario_id: number | null
  telefono: string
  canal: CanalConversacion
  created_at: string
  updated_at: string
}

export interface MensajeWhatsapp {
  id: number
  conversacion_id: number
  direccion: DireccionMensaje
  tipo: TipoMensajeWhatsapp
  contenido: string | null
  metadata: Record<string, unknown>
  created_at: string
}

export interface ArchivoConversacion {
  id: number
  conversacion_id: number
  usuario_id: number | null
  proceso_demo_id: number | null
  nombre_archivo: string
  mime_type: string
  tamano_bytes: number | null
  contenido_base64: string
  extracted_data: Record<string, unknown>
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface PrestacionCatalogo {
  id: number
  isapre_id: IsapreId
  codigo: string
  nombre: string
  descripcion: string | null
  requiere_formulario: boolean
  requiere_adjuntos: boolean
  activa: boolean
  orden: number
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface PrestacionCampoCatalogo {
  id: number
  prestacion_id: number
  campo_key: string
  label: string
  tipo: string
  placeholder: string | null
  ayuda: string | null
  requerido: boolean
  orden: number
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface EstadoConversacion {
  id: number
  conversacion_id: number
  usuario_id: number | null
  isapre_id: IsapreId | null
  etapa: EtapaConversacion
  prestacion_id: number | null
  campo_actual_id: number | null
  proceso_demo_id: number | null
  payload: Record<string, unknown>
  metadata: Record<string, unknown>
  last_message_id: string | null
  created_at: string
  updated_at: string
}

export interface WebhookEventLog {
  id: number
  idempotency_key: string
  event_name: string
  payload: Record<string, unknown>
  processed_at: string
}

export interface ProcesoDemo {
  id: number
  usuario_id: number
  telefono: string
  isapre_id: IsapreId
  flujo: string
  origen: string
  estado: EstadoProcesoDemo
  resumen: string | null
  error: string | null
  metadata: Record<string, unknown>
  intentos: number
  locked_at: string | null
  worker_id: string | null
  started_at: string | null
  finished_at: string | null
  created_at: string
  updated_at: string
}

export interface ProcesoPaso {
  id: number
  proceso_id: number
  orden: number
  etapa: string
  accion: string
  detalle: string | null
  url: string | null
  selector: string | null
  status: string
  payload: Record<string, unknown>
  created_at: string
}

export interface ProcesoCampo {
  id: number
  proceso_id: number
  campo_key: string
  label: string
  tipo: string
  selector: string | null
  requerido: boolean
  valor_ingresado: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface KapsoConversationPayload {
  id?: string
  phone_number?: string
  business_scoped_user_id?: string
  username?: string
  phone_number_id?: string
  status?: string
  metadata?: Record<string, unknown>
  kapso?: Record<string, unknown>
}

export interface KapsoMessagePayload {
  id?: string
  timestamp?: string
  type?: string
  from?: string
  to?: string
  text?: { body?: string }
  interactive?: {
    type?: string
    button_reply?: { id?: string; title?: string }
    list_reply?: { id?: string; title?: string; description?: string }
  }
  image?: { id?: string; caption?: string }
  document?: { id?: string; filename?: string; caption?: string }
  audio?: { id?: string }
  kapso?: {
    direction?: string
    status?: string
    processing_status?: string
    origin?: string
    has_media?: boolean
    content?: string
    transcript?: { text?: string }
    media_url?: string
    media_data?: Record<string, unknown>
    statuses?: Array<Record<string, unknown>>
  }
}

export interface KapsoWebhookPayload {
  phone_number_id?: string
  is_new_conversation?: boolean
  message?: KapsoMessagePayload
  conversation?: KapsoConversationPayload
}

export const ISAPRES: { id: IsapreId; nombre: string }[] = [
  { id: 'colmena', nombre: 'Colmena' },
  { id: 'banmedica', nombre: 'Banmédica' },
  { id: 'consalud', nombre: 'Consalud' },
  { id: 'cruzblanca', nombre: 'CruzBlanca' },
  { id: 'nueva_masvida', nombre: 'Nueva Masvida' },
  { id: 'vida_tres', nombre: 'Vida Tres' },
  { id: 'esencial', nombre: 'Esencial' },
]
