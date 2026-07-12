/**
 * Tipos compartidos del backend — WSP-ISAP
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

export const ISAPRES: { id: IsapreId; nombre: string }[] = [
  { id: 'colmena', nombre: 'Colmena' },
  { id: 'banmedica', nombre: 'Banmédica' },
  { id: 'consalud', nombre: 'Consalud' },
  { id: 'cruzblanca', nombre: 'CruzBlanca' },
  { id: 'nueva_masvida', nombre: 'Nueva Masvida' },
  { id: 'vida_tres', nombre: 'Vida Tres' },
  { id: 'esencial', nombre: 'Esencial' },
]