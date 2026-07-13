/**
 * Tipos del RPA — WSP-ISAP CAPA 3
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

/** Datos que el RPA necesita para procesar un reembolso. */
export interface ReembolsoTask {
  id: number
  usuario_id: number
  rut_usuario: string
  isapre: IsapreId
  monto: number
  url_documento: string
  estado: EstadoSolicitud
  intentos: number
}

/** Credenciales descifradas para el login en la sucursal virtual. */
export interface CredencialesDescifradas {
  isapre_id: IsapreId
  rut: string
  password: string
}

/** Resultado del procesamiento RPA de un reembolso. */
export interface ResultadoReembolso {
  success: boolean
  folioIsapre?: string
  error?: string
  portalStatus?: PortalStatus
}

export interface ProcesoDemoTask {
  id: number
  usuario_id: number
  telefono: string
  isapre_id: IsapreId
  flujo: string
  estado: EstadoProcesoDemo
  metadata: {
    formulario?: Record<string, unknown>
    [key: string]: unknown
  }
  intentos: number
}

export interface ProcesoCampoRegistro {
  campoKey: string
  label: string
  tipo: string
  selector?: string
  requerido?: boolean
  valorIngresado?: string
  metadata?: Record<string, unknown>
}

export interface ProcesoPasoRegistro {
  etapa: string
  accion: string
  detalle?: string
  url?: string
  selector?: string
  status?: 'info' | 'success' | 'warning' | 'error'
  payload?: Record<string, unknown>
}

export interface DemoExecutionContext {
  recordStep: (step: ProcesoPasoRegistro) => Promise<void>
  upsertField: (field: ProcesoCampoRegistro) => Promise<void>
}

/** Configuración de un scraper de Isapre. */
export interface ScraperConfig {
  isapreId: IsapreId
  nombre: string
  urlLogin: string
  urlReembolso: string
  /** Selectores CSS para los campos del formulario de login. */
  selectores: {
    inputRut?: string
    inputPassword?: string
    btnLogin?: string
    /** Selector para detectar login exitoso. */
    loginSuccessIndicator?: string
    /** Selector para detectar login fallido. */
    loginErrorIndicator?: string
    /** Input para subir archivo de boleta. */
    inputBoleta?: string
    /** Input para monto del reembolso. */
    inputMonto?: string
    /** Botón para enviar el formulario de reembolso. */
    btnEnviar?: string
    /** Selector que contiene el folio tras éxito. */
    folioResultado?: string
  }
}
