import { query, queryOne, withTransaction } from '../db.js'
import type {
  ArchivoConversacion,
  CanalConversacion,
  ConversacionWhatsapp,
  DireccionMensaje,
  IsapreId,
  MensajeWhatsapp,
  PrestacionCampoCatalogo,
  ProcesoCampo,
  ProcesoDemo,
  ProcesoPaso,
  TipoMensajeWhatsapp,
} from '../types.js'

export interface DemoBanmedicaPayload {
  centroMedicoRut: string
  centroMedicoNombre: string
  fechaAtencion: string
  montoPagado: number
  observaciones: string
}

export interface ProcesoDemoDetalle extends ProcesoDemo {
  pasos: ProcesoPaso[]
  campos: ProcesoCampo[]
}

export interface CreatePrestacionProcessInput {
  userId: number
  telefono: string
  origen: 'dashboard' | 'whatsapp'
  isapreId: IsapreId
  prestacionCodigo: string
  prestacionNombre: string
  requiereAdjuntos: boolean
  requiereFormulario: boolean
  answers: Record<string, string>
  fieldDefinitions: Array<Pick<PrestacionCampoCatalogo, 'campo_key' | 'label' | 'tipo' | 'requerido'>>
  extraMetadata?: Record<string, unknown>
}

const DEFAULT_DEMO_BANMEDICA: DemoBanmedicaPayload = {
  centroMedicoRut: '76.123.456-7',
  centroMedicoNombre: 'Clinica Demo Banmedica',
  fechaAtencion: new Date().toISOString().slice(0, 10),
  montoPagado: 35000,
  observaciones: 'Demo controlado desde dashboard para Urgencias Medicas.',
}

function normalizePhone(telefono: string): string {
  return telefono.replace(/\D/g, '')
}

export function buildWhatsappEntryUrl(message?: string): string | null {
  const directUrl = process.env.WHATSAPP_ENTRY_URL?.trim()
  if (directUrl) {
    return directUrl
  }

  const phone = normalizePhone(process.env.WHATSAPP_PHONE ?? '')
  if (!phone) {
    return null
  }

  const text = encodeURIComponent(message ?? 'Hola, quiero iniciar la demo de Banmedica.')
  return `https://wa.me/${phone}?text=${text}`
}

export async function getUserPrimaryIsapre(userId: number): Promise<IsapreId | null> {
  const row = await queryOne<{ isapre_id: IsapreId }>(
    `
      SELECT isapre_id
      FROM credenciales_isapre
      WHERE usuario_id = $1
      ORDER BY created_at ASC
      LIMIT 1
    `,
    [userId],
  )

  return row?.isapre_id ?? null
}

export async function ensureWhatsappConversation(
  userId: number | null,
  telefono: string,
): Promise<ConversacionWhatsapp> {
  return ensureConversation(userId, telefono, 'whatsapp')
}

export async function ensureWebConversation(
  userId: number,
  telefono: string,
): Promise<ConversacionWhatsapp> {
  return ensureConversation(userId, telefono, 'web')
}

export async function ensureConversation(
  userId: number | null,
  telefono: string,
  channel: CanalConversacion,
): Promise<ConversacionWhatsapp> {
  const normalizedPhone = normalizePhone(telefono)

  const existing = await queryOne<ConversacionWhatsapp>(
    `
      SELECT *
      FROM conversaciones_whatsapp
      WHERE telefono = $1 AND canal = $2
    `,
    [normalizedPhone, channel],
  )

  if (existing) {
    if (userId && existing.usuario_id !== userId) {
      const updated = await queryOne<ConversacionWhatsapp>(
        `
          UPDATE conversaciones_whatsapp
          SET usuario_id = $1,
              updated_at = timezone('utc', now())
          WHERE id = $2
          RETURNING *
        `,
        [userId, existing.id],
      )
      return updated ?? existing
    }
    return existing
  }

  const inserted = await queryOne<ConversacionWhatsapp>(
    `
      INSERT INTO conversaciones_whatsapp (usuario_id, telefono, canal)
      VALUES ($1, $2, $3)
      RETURNING *
    `,
    [userId, normalizedPhone, channel],
  )

  if (!inserted) {
    throw new Error(`No se pudo crear la conversacion del canal ${channel}`)
  }

  return inserted
}

export async function logWhatsappMessage(input: {
  conversacionId: number
  direccion: DireccionMensaje
  tipo: TipoMensajeWhatsapp
  contenido?: string | null
  metadata?: Record<string, unknown>
}): Promise<MensajeWhatsapp> {
  return logConversationMessage(input)
}

export async function logConversationMessage(input: {
  conversacionId: number
  direccion: DireccionMensaje
  tipo: TipoMensajeWhatsapp
  contenido?: string | null
  metadata?: Record<string, unknown>
}): Promise<MensajeWhatsapp> {
  const row = await queryOne<MensajeWhatsapp>(
    `
      INSERT INTO mensajes_whatsapp (conversacion_id, direccion, tipo, contenido, metadata)
      VALUES ($1, $2::direccion_mensaje, $3::tipo_mensaje_whatsapp, $4, $5::jsonb)
      RETURNING *
    `,
    [
      input.conversacionId,
      input.direccion,
      input.tipo,
      input.contenido ?? null,
      JSON.stringify(input.metadata ?? {}),
    ],
  )

  if (!row) {
    throw new Error('No se pudo registrar el mensaje de WhatsApp')
  }

  return row
}

export async function createConversationAttachment(input: {
  conversacionId: number
  userId: number | null
  processId?: number | null
  fileName: string
  mimeType: string
  sizeBytes?: number | null
  base64Data: string
  extractedData?: Record<string, unknown>
  metadata?: Record<string, unknown>
}): Promise<ArchivoConversacion> {
  const row = await queryOne<ArchivoConversacion>(
    `
      INSERT INTO archivos_conversacion (
        conversacion_id,
        usuario_id,
        proceso_demo_id,
        nombre_archivo,
        mime_type,
        tamano_bytes,
        contenido_base64,
        extracted_data,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)
      RETURNING *
    `,
    [
      input.conversacionId,
      input.userId,
      input.processId ?? null,
      input.fileName,
      input.mimeType,
      input.sizeBytes ?? null,
      input.base64Data,
      JSON.stringify(input.extractedData ?? {}),
      JSON.stringify(input.metadata ?? {}),
    ],
  )

  if (!row) {
    throw new Error('No se pudo guardar el adjunto de la conversación')
  }

  return row
}

export async function listConversationAttachments(conversationId: number, limit = 10): Promise<ArchivoConversacion[]> {
  return query<ArchivoConversacion>(
    `
      SELECT *
      FROM archivos_conversacion
      WHERE conversacion_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `,
    [conversationId, limit],
  )
}

export async function createBanmedicaDemoProcess(input: {
  userId: number
  telefono: string
  origen: 'dashboard' | 'whatsapp'
  payload?: Partial<DemoBanmedicaPayload>
}): Promise<ProcesoDemoDetalle> {
  const credencial = await queryOne<{ id: number }>(
    `
      SELECT id
      FROM credenciales_isapre
      WHERE usuario_id = $1 AND isapre_id = 'banmedica'
      LIMIT 1
    `,
    [input.userId],
  )

  if (!credencial) {
    throw new Error('El usuario no tiene credenciales de Banmedica configuradas')
  }

  const mergedPayload: DemoBanmedicaPayload = {
    ...DEFAULT_DEMO_BANMEDICA,
    ...input.payload,
  }

  const existing = await queryOne<{ id: number }>(
    `
      SELECT id
      FROM procesos_demo
      WHERE usuario_id = $1
        AND flujo = 'banmedica_urgencia_demo'
        AND estado IN ('pendiente', 'en_progreso')
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [input.userId],
  )

  if (existing) {
    throw new Error('Ya existe un proceso demo activo para este usuario')
  }

  const processId = await withTransaction(async (client) => {
    const inserted = await client.query<{ id: number }>(
      `
        INSERT INTO procesos_demo (
          usuario_id,
          telefono,
          isapre_id,
          flujo,
          origen,
          estado,
          resumen,
          metadata
        )
        VALUES (
          $1,
          $2,
          'banmedica',
          'banmedica_urgencia_demo',
          $3,
          'pendiente',
          'Proceso demo Banmedica - Urgencias Medicas en cola',
          $4::jsonb
        )
        RETURNING id
      `,
      [
        input.userId,
        normalizePhone(input.telefono),
        input.origen,
        JSON.stringify({
          formulario: mergedPayload,
          prestacion: 'Urgencias Medicas',
          prestacionCodigo: 'urgencias_medicas',
          prestacionNombre: 'Urgencias Médicas',
          requiereAdjuntos: true,
          requiereFormulario: true,
          enviarFormulario: false,
        }),
      ],
    )

    const procesoId = inserted.rows[0]?.id
    if (!procesoId) {
      throw new Error('No se pudo crear el proceso demo')
    }

    const campos: Array<Pick<ProcesoCampo, 'campo_key' | 'label' | 'tipo' | 'requerido' | 'valor_ingresado'>> = [
      {
        campo_key: 'centro_medico_rut',
        label: 'RUT del centro medico',
        tipo: 'text',
        requerido: true,
        valor_ingresado: mergedPayload.centroMedicoRut,
      },
      {
        campo_key: 'centro_medico_nombre',
        label: 'Centro medico',
        tipo: 'text',
        requerido: false,
        valor_ingresado: mergedPayload.centroMedicoNombre,
      },
      {
        campo_key: 'fecha_atencion',
        label: 'Fecha',
        tipo: 'date',
        requerido: true,
        valor_ingresado: mergedPayload.fechaAtencion,
      },
      {
        campo_key: 'monto_pagado',
        label: 'Monto pagado',
        tipo: 'number',
        requerido: false,
        valor_ingresado: mergedPayload.montoPagado.toString(),
      },
      {
        campo_key: 'observaciones',
        label: 'Observaciones',
        tipo: 'textarea',
        requerido: false,
        valor_ingresado: mergedPayload.observaciones,
      },
    ]

    for (const campo of campos) {
      await client.query(
        `
          INSERT INTO proceso_campos (
            proceso_id,
            campo_key,
            label,
            tipo,
            requerido,
            valor_ingresado,
            metadata
          )
          VALUES ($1, $2, $3, $4, $5, $6, '{}'::jsonb)
        `,
        [
          procesoId,
          campo.campo_key,
          campo.label,
          campo.tipo,
          campo.requerido,
          campo.valor_ingresado,
        ],
      )
    }

    await client.query(
      `
        INSERT INTO proceso_pasos (proceso_id, orden, etapa, accion, detalle, status, payload)
        VALUES
          ($1, 1, 'dashboard', 'demo_creado', 'Proceso demo generado y encolado para el worker', 'success', '{}'::jsonb),
          ($1, 2, 'rpa', 'esperando_worker', 'A la espera de procesamiento automatizado Banmedica', 'info', '{}'::jsonb)
      `,
      [procesoId],
    )

    return procesoId
  })

  const detail = await getProcesoDemoDetalle(processId, input.userId)
  if (!detail) {
    throw new Error('No se pudo recuperar el proceso demo recien creado')
  }
  return detail
}

export async function createPrestacionProcess(
  input: CreatePrestacionProcessInput,
): Promise<ProcesoDemoDetalle> {
  const existing = await queryOne<{ id: number }>(
    `
      SELECT id
      FROM procesos_demo
      WHERE usuario_id = $1
        AND flujo = $2
        AND estado IN ('pendiente', 'en_progreso')
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [input.userId, `${input.isapreId}_${input.prestacionCodigo}_demo`],
  )

  if (existing) {
    throw new Error('Ya existe un proceso activo para esta prestación')
  }

  const processId = await withTransaction(async (client) => {
    const inserted = await client.query<{ id: number }>(
      `
        INSERT INTO procesos_demo (
          usuario_id,
          telefono,
          isapre_id,
          flujo,
          origen,
          estado,
          resumen,
          metadata
        )
        VALUES ($1, $2, $3::isapre_id, $4, $5, 'pendiente', $6, $7::jsonb)
        RETURNING id
      `,
      [
        input.userId,
        normalizePhone(input.telefono),
        input.isapreId,
        `${input.isapreId}_${input.prestacionCodigo}_demo`,
        input.origen,
        `Proceso ${input.prestacionNombre} en cola para ejecución automatizada`,
        JSON.stringify({
          prestacionCodigo: input.prestacionCodigo,
          prestacionNombre: input.prestacionNombre,
          formulario: input.answers,
          requiereAdjuntos: input.requiereAdjuntos,
          requiereFormulario: input.requiereFormulario,
          enviarFormulario: false,
          ...(input.extraMetadata ?? {}),
        }),
      ],
    )

    const procesoId = inserted.rows[0]?.id
    if (!procesoId) {
      throw new Error('No se pudo crear el proceso conversacional')
    }

    for (const field of input.fieldDefinitions) {
      await client.query(
        `
          INSERT INTO proceso_campos (
            proceso_id,
            campo_key,
            label,
            tipo,
            requerido,
            valor_ingresado,
            metadata
          )
          VALUES ($1, $2, $3, $4, $5, $6, '{}'::jsonb)
        `,
        [
          procesoId,
          field.campo_key,
          field.label,
          field.tipo,
          field.requerido,
          input.answers[field.campo_key] ?? null,
        ],
      )
    }

    await client.query(
      `
        INSERT INTO proceso_pasos (proceso_id, orden, etapa, accion, detalle, status, payload)
        VALUES
          ($1, 1, 'whatsapp', 'datos_recolectados', 'Datos obtenidos por el orquestador conversacional', 'success', $2::jsonb),
          ($1, 2, 'rpa', 'esperando_worker', 'Proceso en cola para navegación automatizada', 'info', '{}'::jsonb)
      `,
      [procesoId, JSON.stringify(input.answers)],
    )

    return procesoId
  })

  const detail = await getProcesoDemoDetalle(processId, input.userId)
  if (!detail) {
    throw new Error('No se pudo recuperar el proceso conversacional creado')
  }
  return detail
}

export async function listProcesosDemoByUser(userId: number): Promise<ProcesoDemo[]> {
  return query<ProcesoDemo>(
    `
      SELECT *
      FROM procesos_demo
      WHERE usuario_id = $1
      ORDER BY created_at DESC
    `,
    [userId],
  )
}

export async function getProcesoDemoDetalle(
  processId: number,
  userId: number,
): Promise<ProcesoDemoDetalle | null> {
  const proceso = await queryOne<ProcesoDemo>(
    `
      SELECT *
      FROM procesos_demo
      WHERE id = $1 AND usuario_id = $2
    `,
    [processId, userId],
  )

  if (!proceso) {
    return null
  }

  const pasos = await query<ProcesoPaso>(
    `
      SELECT *
      FROM proceso_pasos
      WHERE proceso_id = $1
      ORDER BY orden ASC, created_at ASC
    `,
    [processId],
  )

  const campos = await query<ProcesoCampo>(
    `
      SELECT *
      FROM proceso_campos
      WHERE proceso_id = $1
      ORDER BY id ASC
    `,
    [processId],
  )

  return {
    ...proceso,
    pasos,
    campos,
  }
}

export async function getDemoOverview(userId: number): Promise<{
  whatsappEntryUrl: string | null
  primaryIsapre: IsapreId | null
  activeProcesses: number
  latestProcess: ProcesoDemo | null
}> {
  const [primaryIsapre, activeRow, latestProcess] = await Promise.all([
    getUserPrimaryIsapre(userId),
    queryOne<{ total: number }>(
      `
        SELECT COUNT(*)::int AS total
        FROM procesos_demo
        WHERE usuario_id = $1 AND estado IN ('pendiente', 'en_progreso')
      `,
      [userId],
    ),
    queryOne<ProcesoDemo>(
      `
        SELECT *
        FROM procesos_demo
        WHERE usuario_id = $1
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [userId],
    ),
  ])

  return {
    whatsappEntryUrl: buildWhatsappEntryUrl('Hola, quiero iniciar la demo de Banmedica.'),
    primaryIsapre,
    activeProcesses: Number(activeRow?.total ?? 0),
    latestProcess: latestProcess ?? null,
  }
}
