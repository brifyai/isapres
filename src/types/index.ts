/**
 * Tipos del dominio — WSP-ISAP
 * Modela usuarios, reembolsos, isapres y estados del proceso RPA.
 */

/* ───────────────────────── Isapres ───────────────────────── */

/** Identificadores de las Isapres abiertas soportadas por el RPA. */
export type IsapreId =
  | 'colmena'
  | 'banmedica'
  | 'consalud'
  | 'cruzblanca'
  | 'nueva_masvida'
  | 'vida_tres'
  | 'esencial';

/** Metadata de una Isapre para selectores y visualización. */
export interface Isapre {
  id: IsapreId;
  nombre: string;
  nombreSucursalVirtual: string;
  urlSucursalVirtual: string;
  color: string;
  activa: boolean;
}

/** Catálogo estático de Isapres soportadas. */
export const ISAPRES: Isapre[] = [
  {
    id: 'colmena',
    nombre: 'Colmena',
    nombreSucursalVirtual: 'Sucursal Virtual Colmena',
    urlSucursalVirtual: 'https://www.colmena.cl',
    color: '#0066B3',
    activa: true,
  },
  {
    id: 'banmedica',
    nombre: 'Banmédica',
    nombreSucursalVirtual: 'Sucursal Virtual Banmédica',
    urlSucursalVirtual: 'https://www.banmedica.cl',
    color: '#00833E',
    activa: true,
  },
  {
    id: 'consalud',
    nombre: 'Consalud',
    nombreSucursalVirtual: 'Sucursal Virtual Consalud',
    urlSucursalVirtual: 'https://www.consalud.cl',
    color: '#E30613',
    activa: true,
  },
  {
    id: 'cruzblanca',
    nombre: 'CruzBlanca',
    nombreSucursalVirtual: 'Sucursal Virtual CruzBlanca',
    urlSucursalVirtual: 'https://www.cruzblanca.cl',
    color: '#00529B',
    activa: true,
  },
  {
    id: 'nueva_masvida',
    nombre: 'Nueva Masvida',
    nombreSucursalVirtual: 'Sucursal Virtual Nueva Masvida',
    urlSucursalVirtual: 'https://www.nuevamasvida.cl',
    color: '#ED1C24',
    activa: true,
  },
  {
    id: 'vida_tres',
    nombre: 'Vida Tres',
    nombreSucursalVirtual: 'Sucursal Virtual Vida Tres',
    urlSucursalVirtual: 'https://www.vidatres.cl',
    color: '#6B2C8F',
    activa: true,
  },
  {
    id: 'esencial',
    nombre: 'Esencial',
    nombreSucursalVirtual: 'Sucursal Virtual Esencial',
    urlSucursalVirtual: 'https://www.esencial.cl',
    color: '#F58220',
    activa: true,
  },
];

/* ──────────────────────── Estados ───────────────────────── */

/**
 * Estado del ciclo de vida de una solicitud de reembolso.
 * Refleja las etapas del RPA (Playwright) en la sucursal virtual.
 */
export type EstadoSolicitud =
  | 'en_cola'
  | 'procesando_ocr'
  | 'iniciando_sesion'
  | 'subiendo_boleta'
  | 'exitoso'
  | 'rechazado';

/** Metadata de visualización para cada estado. */
export interface EstadoSolicitudMeta {
  label: string;
  color: 'muted' | 'warning' | 'primary' | 'success' | 'destructive';
  icon: 'clock' | 'scan' | 'log-in' | 'upload' | 'check' | 'x';
}

/** Mapeo de estado → metadata de UI. */
export const ESTADO_SOLICITUD_META: Record<EstadoSolicitud, EstadoSolicitudMeta> = {
  en_cola: { label: 'En cola', color: 'muted', icon: 'clock' },
  procesando_ocr: { label: 'Procesando OCR', color: 'warning', icon: 'scan' },
  iniciando_sesion: { label: 'Iniciando sesión', color: 'primary', icon: 'log-in' },
  subiendo_boleta: { label: 'Subiendo boleta', color: 'primary', icon: 'upload' },
  exitoso: { label: 'Exitoso', color: 'success', icon: 'check' },
  rechazado: { label: 'Rechazado', color: 'destructive', icon: 'x' },
};

/* ──────────────────────── Usuario ───────────────────────── */

/** Credenciales encriptadas de la sucursal virtual de la Isapre. */
export interface CredencialesIsapre {
  isapreId: IsapreId;
  rut: string;
  /** Contraseña cifrada (AES-256) — el frontend solo la transporta, no la persiste. */
  password: string;
}

/** Usuario enrolado desde WhatsApp. */
export interface Usuario {
  id: string;
  nombre: string;
  /** Teléfono en formato internacional sin "+", ej: 56912345678. */
  telefono: string;
  /** RUT con formato 12.345.678-K. */
  rut: string;
  credenciales: CredencialesIsapre[];
  createdAt: string;
  updatedAt: string;
}

/** Payload para registrar un usuario desde el onboarding. */
export interface RegistroUsuarioPayload {
  nombre: string;
  telefono: string;
  rut: string;
  credenciales: CredencialesIsapre;
}

/* ────────────────────── Reembolso ───────────────────────── */

/** Solicitud de reembolso procesada por el sistema. */
export interface Reembolso {
  id: string;
  /** RUT del usuario (formato 12.345.678-K). */
  rutUsuario: string;
  isapre: IsapreId;
  /** Monto en CLP. */
  monto: number;
  /** Fecha ISO 8601 de la solicitud. */
  fecha: string;
  estado: EstadoSolicitud;
  /** URL del documento (boleta/factura) almacenado. */
  urlDocumento: string;
  /** Folio/comprobante devuelto por la Isapre tras el reembolso exitoso. */
  folioIsapre?: string;
  /** Mensaje de error si el estado es `rechazado`. */
  error?: string;
  createdAt: string;
  updatedAt: string;
}

/** KPIs del dashboard de usuario. */
export interface DashboardKPIs {
  totalReembolsado: number;
  solicitudesPendientes: number;
  solicitudesExitosas: number;
}

/* ─────────────────── Panel de Admin ─────────────────────── */

/** Estado de salud del script RPA para un portal de Isapre. */
export type PortalStatus = 'operativo' | 'caido' | 'html_cambiado' | 'mantenimiento';
export type EstadoProcesoDemo = 'pendiente' | 'en_progreso' | 'completado' | 'fallido';

/** Resultado del monitoreo de un portal de Isapre. */
export interface PortalMonitor {
  isapreId: IsapreId;
  isapreNombre: string;
  status: PortalStatus;
  /** Última vez que el RPA se ejecutó correctamente (ISO 8601). */
  ultimaEjecucionExitosa: string;
  /** Latencia promedio del portal en ms. */
  latenciaMs?: number;
  mensajeError?: string;
}

/** Reembolso estancado o rechazado para la cola de errores del admin. */
export interface ReembolsoConError extends Reembolso {
  estado: 'rechazado';
  error: string;
  /** Número de intentos del RPA. */
  intentos: number;
  /** Si requiere intervención manual. */
  requiereManual: boolean;
}

export interface DemoOverview {
  whatsappEntryUrl: string | null;
  primaryIsapre: IsapreId | null;
  activeProcesses: number;
  latestProcess: DemoProcess | null;
}

export interface DemoBanmedicaPayload {
  centroMedicoRut: string;
  centroMedicoNombre: string;
  fechaAtencion: string;
  montoPagado: number;
  observaciones: string;
}

export interface DemoProcessStep {
  id: string;
  orden: number;
  etapa: string;
  accion: string;
  detalle?: string;
  url?: string;
  selector?: string;
  status: 'info' | 'success' | 'warning' | 'error';
  payload?: Record<string, unknown>;
  createdAt: string;
}

export interface DemoProcessField {
  id: string;
  campoKey: string;
  label: string;
  tipo: string;
  selector?: string;
  requerido: boolean;
  valorIngresado?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface DemoProcess {
  id: string;
  telefono: string;
  isapreId: IsapreId;
  flujo: string;
  origen: string;
  estado: EstadoProcesoDemo;
  resumen?: string;
  error?: string;
  metadata?: Record<string, unknown>;
  intentos: number;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
  updatedAt: string;
  pasos?: DemoProcessStep[];
  campos?: DemoProcessField[];
}

export interface ConversationState {
  id: string;
  etapa: 'idle' | 'awaiting_prestacion' | 'awaiting_field' | 'processing' | 'completed';
  isapreId?: IsapreId;
  prestacionId?: string;
  campoActualId?: string;
  procesoDemoId?: string;
  payload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  updatedAt: string;
}

export interface ConversationMessage {
  id: string;
  direccion: 'entrante' | 'saliente' | 'sistema';
  tipo: 'text' | 'image' | 'interactive' | 'document' | 'audio' | 'system';
  contenido?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface PrestacionDisponible {
  id: string;
  isapreId: IsapreId;
  codigo: string;
  nombre: string;
  descripcion?: string;
  requiereFormulario: boolean;
  requiereAdjuntos: boolean;
  activa: boolean;
  orden: number;
}

export interface ConversationSnapshot {
  state: ConversationState | null;
  messages: ConversationMessage[];
  prestaciones: PrestacionDisponible[];
}

export const ESTADO_PROCESO_DEMO_META: Record<
  EstadoProcesoDemo,
  { label: string; color: 'muted' | 'warning' | 'primary' | 'success' | 'destructive' }
> = {
  pendiente: { label: 'Pendiente', color: 'muted' },
  en_progreso: { label: 'En progreso', color: 'primary' },
  completado: { label: 'Completado', color: 'success' },
  fallido: { label: 'Fallido', color: 'destructive' },
};

/* ──────────────────────── API ───────────────────────────── */

/** Respuesta estándar de la API. */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}
