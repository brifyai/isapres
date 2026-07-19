import { query, queryOne } from '../db.js'
import type {
  ArchivoConversacion,
  CanalConversacion,
  EstadoConversacion,
  EtapaConversacion,
  IsapreId,
  KapsoWebhookPayload,
  MensajeWhatsapp,
  OpcionCampo,
  OrigenCampo,
  PrestacionCampoCatalogo,
  PrestacionCatalogo,
  ProcesoDemo,
  RolAdjuntoConversacion,
  SlotAdjuntoPrestacion,
  Usuario,
  WebhookEventLog,
} from '../types.js'
import {
  buildWhatsappEntryUrl,
  createConversationAttachment,
  createPrestacionProcess,
  ensureConversation,
  getUserPrimaryIsapre,
  listConversationAttachments,
  logConversationMessage,
} from './demo-process.js'
import {
  hasKapsoSendConfig,
  sendKapsoButtons,
  sendKapsoList,
  sendKapsoText,
} from './kapso-client.js'
import {
  classifyPrestacionWithAI,
  extractBoletaDataWithAI,
  extractFieldValueWithAI,
  hasOpenAIConfig,
} from './openai-client.js'

const PUBLIC_APP_URL = process.env.PUBLIC_APP_URL ?? 'https://wsp-isap.cl'

interface NormalizedIncomingMessage {
  messageId: string | null
  telefono: string | null
  messageType: 'text' | 'interactive' | 'image' | 'document' | 'audio' | 'unknown'
  text: string
  selectionId: string | null
  selectionTitle: string | null
  mediaUrl: string | null
  raw: KapsoWebhookPayload
}

interface WebConversationAttachmentInput {
  fileName: string
  mimeType: string
  base64Data: string
  sizeBytes?: number | null
  role?: RolAdjuntoConversacion
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
}

function normalizePhone(value?: string | null): string | null {
  const normalized = value?.replace(/\D/g, '') ?? ''
  return normalized || null
}

function extractIncomingMessage(payload: KapsoWebhookPayload): NormalizedIncomingMessage {
  const message = payload.message
  const conversation = payload.conversation

  const interactive = message?.interactive
  const interactiveId = interactive?.button_reply?.id ?? interactive?.list_reply?.id ?? null
  const interactiveTitle = interactive?.button_reply?.title ?? interactive?.list_reply?.title ?? null
  const textBody = message?.text?.body
    ?? message?.kapso?.content
    ?? interactiveTitle
    ?? message?.document?.caption
    ?? message?.image?.caption
    ?? message?.kapso?.transcript?.text
    ?? ''

  const type = message?.type
  let messageType: NormalizedIncomingMessage['messageType'] = 'unknown'
  if (type === 'text') messageType = 'text'
  if (type === 'interactive') messageType = 'interactive'
  if (type === 'image') messageType = 'image'
  if (type === 'document') messageType = 'document'
  if (type === 'audio') messageType = 'audio'

  return {
    messageId: message?.id ?? null,
    telefono: normalizePhone(conversation?.phone_number ?? message?.from ?? null),
    messageType,
    text: textBody.trim(),
    selectionId: interactiveId,
    selectionTitle: interactiveTitle,
    mediaUrl: typeof message?.kapso?.media_url === 'string' ? message.kapso.media_url : null,
    raw: payload,
  }
}

function validateRut(rut: string): boolean {
  const clean = rut.replace(/[.\-]/g, '').toUpperCase()
  if (!/^\d{7,8}[0-9K]$/.test(clean)) {
    return false
  }
  const body = clean.slice(0, -1)
  const dv = clean.slice(-1)
  let sum = 0
  let multiplier = 2
  for (let i = body.length - 1; i >= 0; i -= 1) {
    sum += Number.parseInt(body[i] ?? '0', 10) * multiplier
    multiplier = multiplier === 7 ? 2 : multiplier + 1
  }
  const expected = 11 - (sum % 11)
  const expectedDv = expected === 11 ? '0' : expected === 10 ? 'K' : String(expected)
  return dv === expectedDv
}

function normalizeDate(input: string): string | null {
  const trimmed = input.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed
  }
  const match = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/)
  if (!match) {
    return null
  }
  const [, day, month, year] = match
  const normalized = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  return normalized
}

function normalizeNumber(input: string): string | null {
  const digits = input.replace(/[^\d]/g, '')
  return digits || null
}

async function registerWebhookEvent(
  idempotencyKey: string | null,
  eventName: string,
  payload: Record<string, unknown>,
): Promise<boolean> {
  if (!idempotencyKey) {
    return true
  }

  const existing = await queryOne<WebhookEventLog>(
    'SELECT * FROM webhook_events WHERE idempotency_key = $1',
    [idempotencyKey],
  )
  if (existing) {
    return false
  }

  await queryOne<WebhookEventLog>(
    `
      INSERT INTO webhook_events (idempotency_key, event_name, payload)
      VALUES ($1, $2, $3::jsonb)
      RETURNING *
    `,
    [idempotencyKey, eventName, JSON.stringify(payload)],
  )
  return true
}

async function getConversationState(conversationId: number): Promise<EstadoConversacion | null> {
  const state = await queryOne<EstadoConversacion>(
    'SELECT * FROM estado_conversaciones WHERE conversacion_id = $1',
    [conversationId],
  )
  return state ?? null
}

async function upsertConversationState(input: {
  conversacionId: number
  userId: number | null
  isapreId: IsapreId | null
  stage?: EtapaConversacion
  prestacionId?: number | null
  campoActualId?: number | null
  procesoDemoId?: number | null
  payload?: Record<string, unknown>
  metadata?: Record<string, unknown>
  lastMessageId?: string | null
}): Promise<EstadoConversacion> {
  const row = await queryOne<EstadoConversacion>(
    `
      INSERT INTO estado_conversaciones (
        conversacion_id,
        usuario_id,
        isapre_id,
        etapa,
        prestacion_id,
        campo_actual_id,
        proceso_demo_id,
        payload,
        metadata,
        last_message_id
      )
      VALUES ($1, $2, $3::isapre_id, $4::etapa_conversacion, $5, $6, $7, $8::jsonb, $9::jsonb, $10)
      ON CONFLICT (conversacion_id) DO UPDATE SET
        usuario_id = COALESCE(EXCLUDED.usuario_id, estado_conversaciones.usuario_id),
        isapre_id = COALESCE(EXCLUDED.isapre_id, estado_conversaciones.isapre_id),
        etapa = EXCLUDED.etapa,
        prestacion_id = EXCLUDED.prestacion_id,
        campo_actual_id = EXCLUDED.campo_actual_id,
        proceso_demo_id = EXCLUDED.proceso_demo_id,
        payload = EXCLUDED.payload,
        metadata = EXCLUDED.metadata,
        last_message_id = EXCLUDED.last_message_id,
        updated_at = timezone('utc', now())
      RETURNING *
    `,
    [
      input.conversacionId,
      input.userId,
      input.isapreId,
      input.stage ?? 'idle',
      input.prestacionId ?? null,
      input.campoActualId ?? null,
      input.procesoDemoId ?? null,
      JSON.stringify(input.payload ?? {}),
      JSON.stringify(input.metadata ?? {}),
      input.lastMessageId ?? null,
    ],
  )

  if (!row) {
    throw new Error('No se pudo persistir el estado conversacional')
  }
  return row
}

async function getPrestacionesByIsapre(isapreId: IsapreId): Promise<PrestacionCatalogo[]> {
  return query<PrestacionCatalogo>(
    `
      SELECT *
      FROM catalogo_prestaciones
      WHERE isapre_id = $1::isapre_id AND activa = true
      ORDER BY orden ASC, nombre ASC
    `,
    [isapreId],
  )
}

async function getFieldsByPrestacion(prestacionId: number): Promise<PrestacionCampoCatalogo[]> {
  return query<PrestacionCampoCatalogo>(
    `
      SELECT *
      FROM catalogo_campos_prestacion
      WHERE prestacion_id = $1
      ORDER BY orden ASC, id ASC
    `,
    [prestacionId],
  )
}

async function getPrestacionById(prestacionId: number): Promise<PrestacionCatalogo | null> {
  return (await queryOne<PrestacionCatalogo>('SELECT * FROM catalogo_prestaciones WHERE id = $1', [prestacionId])) ?? null
}

async function getLatestProcess(userId: number): Promise<ProcesoDemo | null> {
  return (await queryOne<ProcesoDemo>(
    `
      SELECT *
      FROM procesos_demo
      WHERE usuario_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [userId],
  )) ?? null
}

function sanitizeBase64Payload(base64Data: string): string {
  return base64Data.replace(/^data:[^;]+;base64,/, '').replace(/\s/g, '')
}

function isImageMimeType(mimeType: string): boolean {
  return /^image\/(png|jpe?g|webp)$/i.test(mimeType)
}

function buildAnswersFromExtraction(
  extraction: NonNullable<Awaited<ReturnType<typeof extractBoletaDataWithAI>>>,
): Record<string, string> {
  const answers: Record<string, string> = {}
  const { campos } = extraction

  if (campos.centroMedicoRut) answers.centro_medico_rut = campos.centroMedicoRut
  if (campos.centroMedicoNombre) answers.centro_medico_nombre = campos.centroMedicoNombre
  if (campos.fechaAtencion) answers.fecha_atencion = campos.fechaAtencion
  if (campos.montoPagado) answers.monto_pagado = campos.montoPagado
  if (campos.numeroBoleta) answers.numero_boleta = campos.numeroBoleta
  if (campos.numeroComercio) answers.numero_comercio = campos.numeroComercio
  if (campos.numeroOperacion) answers.numero_operacion = campos.numeroOperacion
  if (campos.rutProfesional) answers.rut_profesional = campos.rutProfesional
  if (campos.tipoPago) answers.tipo_pago = campos.tipoPago
  if (extraction.tipoDocumentoSugerido) answers.tipo_documento_pago = extraction.tipoDocumentoSugerido
  if (campos.observaciones) answers.observaciones = campos.observaciones

  return answers
}

function getAttachmentRole(input: WebConversationAttachmentInput): RolAdjuntoConversacion {
  return input.role ?? 'voucher'
}

function buildProcessAttachmentPayload(attachments: ArchivoConversacion[]): Array<Record<string, unknown>> {
  return attachments.map((attachment) => ({
    id: attachment.id,
    role: attachment.metadata?.role ?? 'voucher',
    fileName: attachment.nombre_archivo,
    mimeType: attachment.mime_type,
    sizeBytes: attachment.tamano_bytes,
    base64Data: attachment.contenido_base64,
    extractedData: attachment.extracted_data,
    createdAt: attachment.created_at,
  }))
}

function isConsultasPrestacion(prestacionCodigo: string): boolean {
  return prestacionCodigo === 'consultas_psicologia'
}

/**
 * Una prestacion esta disponible salvo que el catalogo la marque explicitamente
 * como no disponible. Las que aun no tienen flujo RPA implementado se declaran
 * con metadata.disponible = false.
 */
function isPrestacionDisponible(prestacion: PrestacionCatalogo): boolean {
  return prestacion.metadata?.disponible !== false
}

function getSlotsAdjuntos(prestacion: PrestacionCatalogo): SlotAdjuntoPrestacion[] {
  const slots = prestacion.metadata?.adjuntos
  if (!Array.isArray(slots)) {
    return [{ role: 'voucher', label: 'Boleta, factura o voucher', requerido: true }]
  }

  return slots.map((slot) => {
    const raw = slot as Record<string, unknown>
    return {
      role: (raw.role as RolAdjuntoConversacion) ?? 'voucher',
      label: String(raw.label ?? 'Documento'),
      requerido: raw.requerido !== false,
    }
  })
}

const ETIQUETA_TIPO_DOCUMENTO: Record<string, string> = {
  boleta_honorarios_electronica: 'boleta de honorarios electrónica',
  otras_boletas_facturas: 'boleta o factura',
  voucher_tarjeta: 'voucher o comprobante de pago con tarjeta',
}

/**
 * Texto con el que el agente pide el comprobante al entrar en awaiting_document.
 * Si ya se eligio el tipo de documento, lo nombra explicitamente en vez de
 * usar la etiqueta generica del slot.
 */
function buildDocumentRequest(prestacion: PrestacionCatalogo, tipoDocumento?: string): string {
  const slots = getSlotsAdjuntos(prestacion)
  const principal = slots.find((slot) => slot.requerido) ?? slots[0]
  const opcionales = slots.filter((slot) => slot !== principal)

  const documento = (tipoDocumento && ETIQUETA_TIPO_DOCUMENTO[tipoDocumento])
    ?? principal.label.toLowerCase()

  const base = `Ahora envíame una foto o PDF de tu ${documento} y la analizo para completar el formulario por ti.`
  if (opcionales.length === 0) {
    return base
  }

  return `${base} Si además tienes ${opcionales.map((slot) => slot.label.toLowerCase()).join(' o ')}, puedes adjuntarlo después.`
}

/**
 * Resume que se pudo extraer del comprobante y que queda por preguntar, para que
 * el usuario entienda por que se le pide un dato y no otro.
 */
function buildExtractionSummary(
  fields: PrestacionCampoCatalogo[],
  answers: Record<string, string>,
  extractedKeys: string[],
): string {
  const labelOf = (key: string): string =>
    fields.find((field) => field.campo_key === key)?.label ?? key

  const extraidos = extractedKeys
    .filter((key) => fields.some((field) => field.campo_key === key))
    .map(labelOf)

  const faltantes = fields
    .filter((field) => field.requerido)
    .filter((field) => {
      const value = answers[field.campo_key]
      return typeof value !== 'string' || value.trim().length === 0
    })
    .map((field) => field.label)

  const partes: string[] = []
  if (extraidos.length > 0) {
    partes.push(`Extraje del documento: ${extraidos.join(', ')}.`)
  } else {
    partes.push('No pude extraer datos utilizables del documento.')
  }

  if (faltantes.length > 0) {
    partes.push(`Me falta ${faltantes.length === 1 ? 'un dato' : `${faltantes.length} datos`}: ${faltantes.join(', ')}.`)
  } else {
    partes.push('Tengo todo lo necesario para continuar.')
  }

  return partes.join(' ')
}

/**
 * Un campo "previo al documento" no es un dato de la boleta sino una decision
 * de navegacion: define que sub-formulario abre el portal. Por eso se pregunta
 * antes de pedir el archivo, no despues.
 *
 * El fallback por campo_key mantiene el comportamiento en catalogos anteriores
 * a la migracion que introdujo el flag.
 */
export function isPreDocumentField(field: PrestacionCampoCatalogo): boolean {
  return field.metadata?.previo_documento === true || field.campo_key === 'tipo_documento_pago'
}

export function getNextPendingField(
  fields: PrestacionCampoCatalogo[],
  answers: Record<string, unknown>,
  filtro?: (field: PrestacionCampoCatalogo) => boolean,
): PrestacionCampoCatalogo | null {
  return fields.find((field) => {
    if (!field.requerido) {
      return false
    }
    if (filtro && !filtro(field)) {
      return false
    }
    const current = answers[field.campo_key]
    return typeof current !== 'string' || current.trim().length === 0
  }) ?? null
}

async function continueConversationWithAnswers(input: {
  conversationId: number
  telefono: string
  channel?: CanalConversacion
  state: EstadoConversacion
  user: Usuario
  prestacion: PrestacionCatalogo
  answers: Record<string, string>
  answerOrigins?: Record<string, OrigenCampo>
  metadata?: Record<string, unknown>
}): Promise<void> {
  const fields = await getFieldsByPrestacion(input.prestacion.id)
  const conversationAttachments = await listConversationAttachments(input.conversationId, 20)
  const currentPayload = (input.state.payload ?? {}) as Record<string, unknown>
  const answerOrigins = {
    ...((currentPayload.answerOrigins as Record<string, OrigenCampo> | undefined) ?? {}),
    ...(input.answerOrigins ?? {}),
  }

  // Tres fases, en este orden:
  //   1. Campos previos al documento (que sub-formulario abrir en el portal).
  //   2. El comprobante, del que el OCR saca la mayoria de los datos.
  //   3. Solo lo que el OCR no logro resolver.
  const campoPrevio = getNextPendingField(fields, input.answers, isPreDocumentField)
  const campoPosterior = getNextPendingField(
    fields,
    input.answers,
    (field) => !isPreDocumentField(field),
  )
  const nextField = campoPrevio ?? (conversationAttachments.length > 0 ? campoPosterior : null)

  // Si ya subio el documento antes de que le preguntaramos el tipo, el OCR pudo
  // haberlo deducido; solo se pregunta cuando sigue sin resolverse.
  if (!campoPrevio && conversationAttachments.length === 0) {
    await upsertConversationState({
      conversacionId: input.conversationId,
      userId: input.user.id,
      isapreId: input.state.isapre_id,
      stage: 'awaiting_document',
      prestacionId: input.prestacion.id,
      campoActualId: null,
      procesoDemoId: input.state.proceso_demo_id,
      payload: {
        ...currentPayload,
        selectedPrestacion: input.prestacion.codigo,
        answers: input.answers,
        answerOrigins,
      },
      metadata: {
        ...((input.state.metadata ?? {}) as Record<string, unknown>),
        ...(input.metadata ?? {}),
      },
      lastMessageId: input.state.last_message_id,
    })
    await sendReply({
      conversationId: input.conversationId,
      to: input.telefono,
      channel: input.channel,
      body: buildDocumentRequest(input.prestacion, input.answers.tipo_documento_pago),
      metadata: {
        stage: 'awaiting_document',
        prestacionCodigo: input.prestacion.codigo,
      },
    })
    return
  }

  if (nextField) {
    await upsertConversationState({
      conversacionId: input.conversationId,
      userId: input.user.id,
      isapreId: input.state.isapre_id,
      stage: 'awaiting_field',
      prestacionId: input.prestacion.id,
      campoActualId: nextField.id,
      procesoDemoId: input.state.proceso_demo_id,
      payload: {
        ...currentPayload,
        selectedPrestacion: input.prestacion.codigo,
        answers: input.answers,
        answerOrigins,
      },
      metadata: {
        ...((input.state.metadata ?? {}) as Record<string, unknown>),
        ...(input.metadata ?? {}),
      },
      lastMessageId: input.state.last_message_id,
    })
    await askField(input.conversationId, input.telefono, nextField, input.channel)
    return
  }

  const process = await createPrestacionProcess({
    userId: input.user.id,
    telefono: input.telefono,
    origen: input.channel === 'web' ? 'dashboard' : 'whatsapp',
    isapreId: input.state.isapre_id as IsapreId,
    prestacionCodigo: input.prestacion.codigo,
    prestacionNombre: input.prestacion.nombre,
    requiereAdjuntos: input.prestacion.requiere_adjuntos,
    requiereFormulario: input.prestacion.requiere_formulario,
    answers: input.answers,
    answerOrigins,
    fieldDefinitions: fields,
    extraMetadata: {
      attachments: buildProcessAttachmentPayload(conversationAttachments),
    },
  })

  await upsertConversationState({
    conversacionId: input.conversationId,
    userId: input.user.id,
    isapreId: input.state.isapre_id,
    stage: 'processing',
    prestacionId: input.prestacion.id,
    campoActualId: null,
    procesoDemoId: process.id,
    payload: {
      ...currentPayload,
      selectedPrestacion: input.prestacion.codigo,
      answers: input.answers,
      answerOrigins,
    },
    metadata: {
      ...((input.state.metadata ?? {}) as Record<string, unknown>),
      ...(input.metadata ?? {}),
    },
    lastMessageId: input.state.last_message_id,
  })

  await sendReply({
    conversationId: input.conversationId,
    to: input.telefono,
    channel: input.channel,
    body: `Perfecto. Ya reuní los datos para "${input.prestacion.nombre}". Ahora iniciaré el recorrido automatizado y dejaré todo registrado en tu historial.`,
    metadata: {
      processId: process.id,
      prestacionCodigo: input.prestacion.codigo,
    },
  })
}

async function processAttachmentForCurrentState(input: {
  conversationId: number
  telefono: string
  channel: CanalConversacion
  state: EstadoConversacion
  user: Usuario
  attachment: WebConversationAttachmentInput
  declaredPrestacionCodigo?: string | null
}): Promise<void> {
  const base64Data = sanitizeBase64Payload(input.attachment.base64Data)
  const attachmentRole = getAttachmentRole(input.attachment)

  let prestacion = input.state.prestacion_id
    ? await getPrestacionById(input.state.prestacion_id)
    : null

  if (!prestacion && input.declaredPrestacionCodigo && input.state.isapre_id) {
    const prestaciones = await getPrestacionesByIsapre(input.state.isapre_id)
    prestacion = await resolvePrestacion(input.declaredPrestacionCodigo, prestaciones)
  }

  let extraction: Awaited<ReturnType<typeof extractBoletaDataWithAI>> = null
  if (
    attachmentRole !== 'detalle'
    && attachmentRole !== 'orden_medica'
    && hasOpenAIConfig()
    && isImageMimeType(input.attachment.mimeType)
  ) {
    extraction = await extractBoletaDataWithAI({
      mimeType: input.attachment.mimeType,
      base64Data,
      prestacionHint: prestacion?.codigo ?? input.declaredPrestacionCodigo ?? null,
    })
  }

  const attachmentRecord = await createConversationAttachment({
    conversacionId: input.conversationId,
    userId: input.user.id,
    processId: input.state.proceso_demo_id,
    fileName: input.attachment.fileName,
    mimeType: input.attachment.mimeType,
    sizeBytes: input.attachment.sizeBytes ?? null,
    base64Data,
    extractedData: extraction ?? {},
    metadata: {
      channel: input.channel,
      role: attachmentRole,
    },
  })

  if (!extraction) {
    await sendReply({
      conversationId: input.conversationId,
      to: input.telefono,
      channel: input.channel,
      body: isImageMimeType(input.attachment.mimeType)
        ? `Recibí tu ${attachmentRole}, pero no pude extraer datos automáticamente desde la imagen. Te pediré los datos que falten.`
        : `Recibí tu ${attachmentRole}. La extracción automática solo funciona con imágenes (PNG, JPG o WEBP), así que te pediré los datos uno por uno.`,
      metadata: {
        attachmentId: attachmentRecord.id,
        attachmentName: attachmentRecord.nombre_archivo,
        attachmentRole,
      },
    })

    // El archivo ya quedó guardado: sin esto la conversación se quedaría
    // esperando un documento que el usuario ya envió.
    if (prestacion && isPrestacionDisponible(prestacion)) {
      await continueConversationWithAnswers({
        conversationId: input.conversationId,
        telefono: input.telefono,
        channel: input.channel,
        state: input.state,
        user: input.user,
        prestacion,
        answers: ((input.state.payload ?? {}) as Record<string, unknown>).answers as Record<string, string> ?? {},
        metadata: {
          attachmentId: attachmentRecord.id,
          attachmentRole,
        },
      })
    }
    return
  }

  if (!prestacion && input.state.isapre_id) {
    const prestaciones = await getPrestacionesByIsapre(input.state.isapre_id)
    const suggested = extraction.prestacionSugerida
      ? prestaciones.find((item) => item.codigo === extraction.prestacionSugerida) ?? null
      : null

    await sendReply({
      conversationId: input.conversationId,
      to: input.telefono,
      channel: input.channel,
      body: suggested
        ? `Analicé tu boleta. Prestación sugerida: "${suggested.nombre}". ${extraction.resumen}`
        : `Analicé tu boleta. ${extraction.resumen} Ahora confirma primero el tipo de prestación para continuar.`,
      metadata: {
        attachmentId: attachmentRecord.id,
        attachmentRole,
        extraction,
      },
    })
    return
  }

  if (!prestacion) {
    return
  }

  if (!isPrestacionDisponible(prestacion)) {
    await sendReply({
      conversationId: input.conversationId,
      to: input.telefono,
      channel: input.channel,
      body: `Analicé el documento para "${prestacion.nombre}", pero esa prestación todavía no está habilitada para tramitación automática. Dejé el archivo y los datos registrados.`,
      metadata: {
        attachmentId: attachmentRecord.id,
        attachmentRole,
        extraction,
        prestacionCodigo: prestacion.codigo,
        prestacionBloqueada: true,
      },
    })
    return
  }

  const extractedAnswers = buildAnswersFromExtraction(extraction)
  const currentPayload = (input.state.payload ?? {}) as Record<string, unknown>
  const mergedAnswers = {
    ...((currentPayload.answers as Record<string, string> | undefined) ?? {}),
    ...extractedAnswers,
  }
  const extractedOrigins = Object.fromEntries(
    Object.keys(extractedAnswers).map((key) => [key, 'ocr' as OrigenCampo]),
  )

  // Explicitamos que salio del documento y que queda pendiente antes de
  // empezar a preguntar, para que el usuario no sienta que repite datos.
  const fields = await getFieldsByPrestacion(prestacion.id)
  await sendReply({
    conversationId: input.conversationId,
    to: input.telefono,
    channel: input.channel,
    body: `Listo, analicé el documento. ${buildExtractionSummary(fields, mergedAnswers, Object.keys(extractedAnswers))}`,
    metadata: {
      attachmentId: attachmentRecord.id,
      attachmentRole,
      extraction,
      prestacionCodigo: prestacion.codigo,
      camposExtraidos: Object.keys(extractedAnswers),
    },
  })

  await continueConversationWithAnswers({
    conversationId: input.conversationId,
    telefono: input.telefono,
    channel: input.channel,
    state: input.state,
    user: input.user,
    prestacion,
    answers: mergedAnswers,
    answerOrigins: extractedOrigins,
    metadata: {
      attachmentId: attachmentRecord.id,
      attachmentRole,
      extractionSummary: extraction.resumen,
    },
  })
}

async function sendReply(input: {
  conversationId: number
  to: string
  channel?: CanalConversacion
  body: string
  type?: 'text' | 'buttons' | 'list'
  buttons?: Array<{ id: string; title: string }>
  sections?: Array<{ title: string; rows: Array<{ id: string; title: string; description?: string }> }>
  buttonText?: string
  metadata?: Record<string, unknown>
}): Promise<void> {
  try {
    let response: Record<string, unknown> | null = null
    if ((input.channel ?? 'whatsapp') === 'whatsapp' && hasKapsoSendConfig()) {
      if (input.type === 'buttons' && input.buttons?.length) {
        response = await sendKapsoButtons({
          to: input.to,
          bodyText: input.body,
          buttons: input.buttons,
        })
      } else if (input.type === 'list' && input.sections?.length) {
        response = await sendKapsoList({
          to: input.to,
          bodyText: input.body,
          buttonText: input.buttonText ?? 'Ver opciones',
          sections: input.sections,
        })
      } else {
        response = await sendKapsoText({
          to: input.to,
          body: input.body,
        })
      }
    }

    await logConversationMessage({
      conversacionId: input.conversationId,
      direccion: 'saliente',
      tipo: input.type === 'text' || !input.type ? 'text' : 'interactive',
      contenido: input.body,
      metadata: {
        ...(input.metadata ?? {}),
        kapsoResponse: response,
      },
    })
  } catch (error) {
    console.error('Error enviando mensaje por Kapso:', error)
    await logConversationMessage({
      conversacionId: input.conversationId,
      direccion: 'sistema',
      tipo: 'system',
      contenido: input.body,
      metadata: {
        ...(input.metadata ?? {}),
        kapsoError: error instanceof Error ? error.message : 'Kapso send failed',
      },
    })
  }
}

async function sendPrestacionesMenu(input: {
  conversationId: number
  telefono: string
  channel?: CanalConversacion
  user: Usuario
  isapreId: IsapreId
  prestaciones: PrestacionCatalogo[]
}): Promise<void> {
  const body = `Hola ${input.user.nombre.split(' ')[0]}. Detecté tu Isapre ${input.isapreId}. ¿Qué tipo de reembolso deseas gestionar?`
  if (input.prestaciones.length <= 3) {
    await sendReply({
      conversationId: input.conversationId,
      to: input.telefono,
      channel: input.channel,
      body,
      type: 'buttons',
      buttons: input.prestaciones.map((prestacion) => ({
        id: prestacion.codigo,
        title: prestacion.nombre.slice(0, 20),
      })),
      metadata: {
        stage: 'awaiting_prestacion',
      },
    })
    return
  }

  await sendReply({
    conversationId: input.conversationId,
    to: input.telefono,
    channel: input.channel,
    body,
    type: 'list',
    buttonText: 'Elegir prestación',
    sections: [
      {
        title: 'Prestaciones disponibles',
        rows: input.prestaciones.map((prestacion) => ({
          id: prestacion.codigo,
          title: prestacion.nombre,
          description: prestacion.descripcion ?? undefined,
        })),
      },
    ],
    metadata: {
      stage: 'awaiting_prestacion',
    },
  })
}

/**
 * El catalogo guarda las opciones en dos formatos historicos: lista de strings
 * o lista de {value,label}. Normalizamos ambos a {value,label}.
 */
function getFieldOptions(field: PrestacionCampoCatalogo): OpcionCampo[] {
  const opciones = field.metadata?.opciones
  if (!Array.isArray(opciones)) {
    return []
  }

  return opciones
    .map((opcion) => {
      if (typeof opcion === 'string') {
        return { value: opcion, label: opcion }
      }
      const raw = opcion as Record<string, unknown>
      const value = raw.value ?? raw.label
      if (value === undefined || value === null) {
        return null
      }
      return { value: String(value), label: String(raw.label ?? value) }
    })
    .filter((opcion): opcion is OpcionCampo => opcion !== null)
}

/**
 * Como normalizeText, pero ademas convierte la puntuacion en espacios: sin
 * esto "otras boletas/facturas" queda como un unico token y no empareja.
 */
function normalizeForMatch(value: string): string {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Empareja lo que escribio el usuario con una opcion del catalogo antes de
 * gastar una llamada al LLM. Devuelve null cuando la respuesta es
 * genuinamente ambigua (p. ej. "tengo una boleta", que calza con dos
 * opciones) para que el agente vuelva a preguntar mostrando los botones.
 */
export function matchFieldOption(input: string, opciones: OpcionCampo[]): OpcionCampo | null {
  const normalized = normalizeForMatch(input)
  if (!normalized || opciones.length === 0) {
    return null
  }

  const exacta = opciones.find(
    (opcion) => normalizeForMatch(opcion.value) === normalized
      || normalizeForMatch(opcion.label) === normalized,
  )
  if (exacta) {
    return exacta
  }

  // Contencion en cualquier direccion, siempre que sea inequivoca.
  const contenidas = opciones.filter((opcion) => {
    const label = normalizeForMatch(opcion.label)
    const value = normalizeForMatch(opcion.value)
    return normalized.includes(label) || label.includes(normalized) || normalized.includes(value)
  })
  if (contenidas.length === 1) {
    return contenidas[0]
  }

  // Como ultimo recurso, la opcion que comparta mas palabras significativas,
  // siempre que gane sin empate.
  const palabras = normalized.split(' ').filter((palabra) => palabra.length > 3)
  if (palabras.length === 0) {
    return null
  }

  const puntajes = opciones.map((opcion) => {
    const label = normalizeForMatch(opcion.label)
    return {
      opcion,
      puntaje: palabras.filter((palabra) => label.includes(palabra)).length,
    }
  })
  const mejor = puntajes.reduce((a, b) => (b.puntaje > a.puntaje ? b : a))
  const empatados = puntajes.filter((item) => item.puntaje === mejor.puntaje).length

  return mejor.puntaje > 0 && empatados === 1 ? mejor.opcion : null
}

function getHelpTextForField(field: PrestacionCampoCatalogo): string {
  const hint = field.ayuda ?? field.placeholder ?? 'Ingresa el dato solicitado.'
  return `${field.label}: ${hint}`
}

async function askField(
  conversationId: number,
  telefono: string,
  field: PrestacionCampoCatalogo,
  channel?: CanalConversacion,
): Promise<void> {
  const opciones = getFieldOptions(field)

  await sendReply({
    conversationId,
    to: telefono,
    channel,
    body: opciones.length > 0
      ? `${field.label}: elige una opción.`
      : getHelpTextForField(field),
    metadata: {
      stage: 'awaiting_field',
      campoKey: field.campo_key,
      // El chat las pinta como botones para no depender de que el usuario
      // escriba la etiqueta exacta.
      opciones,
    },
  })
}

/**
 * El usuario escribio texto cuando esperabamos el comprobante. Reiteramos la
 * peticion sin perder el contexto de la prestacion ya elegida.
 */
async function remindDocumentPending(input: {
  conversationId: number
  telefono: string
  channel?: CanalConversacion
  state: EstadoConversacion
}): Promise<void> {
  const prestacion = input.state.prestacion_id
    ? await getPrestacionById(input.state.prestacion_id)
    : null

  if (!prestacion) {
    await sendReply({
      conversationId: input.conversationId,
      to: input.telefono,
      channel: input.channel,
      body: 'Perdí el contexto de la prestación. Escribe "menú" para empezar de nuevo.',
    })
    return
  }

  await sendReply({
    conversationId: input.conversationId,
    to: input.telefono,
    channel: input.channel,
    body: `Sigo esperando el documento para "${prestacion.nombre}". Adjunta una foto o PDF del comprobante, o escribe "menú" para cambiar de prestación.`,
    metadata: {
      stage: 'awaiting_document',
      prestacionCodigo: prestacion.codigo,
    },
  })
}

function heuristicPrestacionMatch(
  rawInput: string,
  prestaciones: PrestacionCatalogo[],
): PrestacionCatalogo | null {
  const normalized = normalizeText(rawInput)
  if (!normalized) {
    return null
  }

  const direct = prestaciones.find((prestacion) => prestacion.codigo === rawInput)
  if (direct) {
    return direct
  }

  return prestaciones.find((prestacion) => {
    const nombre = normalizeText(prestacion.nombre)
    const codigo = normalizeText(prestacion.codigo)
    return normalized.includes(nombre) || nombre.includes(normalized) || normalized.includes(codigo)
  }) ?? null
}

async function resolvePrestacion(
  input: string,
  prestaciones: PrestacionCatalogo[],
): Promise<PrestacionCatalogo | null> {
  const heuristic = heuristicPrestacionMatch(input, prestaciones)
  if (heuristic) {
    return heuristic
  }

  if (hasOpenAIConfig()) {
    const result = await classifyPrestacionWithAI({
      userMessage: input,
      options: prestaciones.map((prestacion) => ({
        codigo: prestacion.codigo,
        nombre: prestacion.nombre,
        descripcion: prestacion.descripcion,
      })),
    })
    if (result?.codigo) {
      return prestaciones.find((prestacion) => prestacion.codigo === result.codigo) ?? null
    }
  }

  return null
}

async function parseFieldValue(
  field: PrestacionCampoCatalogo,
  text: string,
): Promise<{ valid: boolean; normalized: string | null; error?: string }> {
  const trimmed = text.trim()
  if (!trimmed) {
    return { valid: false, normalized: null, error: 'Necesito una respuesta para continuar.' }
  }

  // Los campos con opciones se resuelven contra el catalogo: es mas fiable y
  // mas barato que preguntarle al LLM si "tengo una boleta" es una opcion.
  const opciones = getFieldOptions(field)
  if (opciones.length > 0) {
    const match = matchFieldOption(trimmed, opciones)
    if (match) {
      return { valid: true, normalized: match.value }
    }
    return {
      valid: false,
      normalized: null,
      error: `No logré identificar la opción. Elige una de estas: ${opciones.map((opcion) => opcion.label).join(', ')}.`,
    }
  }

  switch (field.tipo) {
    case 'rut':
      return validateRut(trimmed)
        ? { valid: true, normalized: trimmed }
        : { valid: false, normalized: null, error: 'El RUT ingresado no es válido.' }
    case 'date': {
      const normalizedDate = normalizeDate(trimmed)
      return normalizedDate
        ? { valid: true, normalized: normalizedDate }
        : { valid: false, normalized: null, error: 'La fecha debe venir como DD/MM/AAAA o YYYY-MM-DD.' }
    }
    case 'number': {
      const normalizedNumber = normalizeNumber(trimmed)
      return normalizedNumber
        ? { valid: true, normalized: normalizedNumber }
        : { valid: false, normalized: null, error: 'El monto debe contener solo números.' }
    }
    default:
      break
  }

  if (hasOpenAIConfig()) {
    const ai = await extractFieldValueWithAI({
      field: {
        campoKey: field.campo_key,
        label: field.label,
        tipo: field.tipo,
        ayuda: field.ayuda,
        placeholder: field.placeholder,
      },
      userMessage: trimmed,
    })

    if (ai) {
      return {
        valid: ai.valid,
        normalized: ai.normalizedValue,
        error: ai.reason,
      }
    }
  }

  return { valid: true, normalized: trimmed }
}

async function handleUnknownUser(
  conversationId: number,
  telefono: string,
): Promise<void> {
  const onboardingUrl = `${PUBLIC_APP_URL}/?t=${telefono}`
  await sendReply({
    conversationId,
    to: telefono,
    body: `Hola. Aún no encuentro tu enrolamiento. Completa tu registro aquí: ${onboardingUrl}`,
    metadata: { onboardingUrl },
  })
}

async function handleStatusCommand(
  conversationId: number,
  telefono: string,
  userId: number,
  channel?: CanalConversacion,
): Promise<void> {
  const process = await getLatestProcess(userId)
  if (!process) {
    await sendReply({
      conversationId,
      to: telefono,
      channel,
      body: 'Aún no tengo procesos activos. Escríbeme cualquier mensaje y te mostraré las prestaciones disponibles.',
    })
    return
  }

  await sendReply({
    conversationId,
    to: telefono,
    channel,
    body: `Tu último proceso está en estado "${process.estado}". Resumen: ${process.resumen ?? 'sin resumen aún'}.`,
    metadata: {
      processId: process.id,
      estado: process.estado,
    },
  })
}

async function handleFieldFlow(input: {
  conversationId: number
  telefono: string
  channel?: CanalConversacion
  state: EstadoConversacion
  text: string
  user: Usuario
}): Promise<void> {
  if (!input.state.campo_actual_id || !input.state.prestacion_id || !input.state.isapre_id) {
    await upsertConversationState({
      conversacionId: input.conversationId,
      userId: input.user.id,
      isapreId: input.state.isapre_id ?? null,
      stage: 'idle',
      payload: input.state.payload,
      metadata: input.state.metadata,
    })
    await sendReply({
      conversationId: input.conversationId,
      to: input.telefono,
      channel: input.channel,
      body: 'Perdí el contexto de la conversación. Te volveré a mostrar el menú.',
    })
    return
  }

  const field = await queryOne<PrestacionCampoCatalogo>(
    'SELECT * FROM catalogo_campos_prestacion WHERE id = $1',
    [input.state.campo_actual_id],
  )
  const prestacion = await getPrestacionById(input.state.prestacion_id)

  if (!field || !prestacion) {
    throw new Error('No se encontró el campo o la prestación actual')
  }

  const parsed = await parseFieldValue(field, input.text)
  if (!parsed.valid || !parsed.normalized) {
    await sendReply({
      conversationId: input.conversationId,
      to: input.telefono,
      channel: input.channel,
      body: parsed.error ?? `No pude validar ${field.label}. ${getHelpTextForField(field)}`,
      metadata: {
        campoKey: field.campo_key,
        validationFailed: true,
        opciones: getFieldOptions(field),
      },
    })
    return
  }

  const currentPayload = (input.state.payload ?? {}) as Record<string, unknown>
  const answers = {
    ...((currentPayload.answers as Record<string, string> | undefined) ?? {}),
    [field.campo_key]: parsed.normalized,
  }

  await continueConversationWithAnswers({
    conversationId: input.conversationId,
    telefono: input.telefono,
    channel: input.channel,
    state: input.state,
    user: input.user,
    prestacion,
    answers,
    answerOrigins: { [field.campo_key]: 'usuario' },
  })
}

async function startConversationMenu(input: {
  conversationId: number
  telefono: string
  channel?: CanalConversacion
  user: Usuario
  isapreId: IsapreId
}): Promise<void> {
  const prestaciones = await getPrestacionesByIsapre(input.isapreId)
  if (prestaciones.length === 0) {
    await sendReply({
      conversationId: input.conversationId,
      to: input.telefono,
      channel: input.channel,
      body: `Tu Isapre enrolada es ${input.isapreId}, pero aún no tengo un catálogo conversacional cargado para ella.`,
    })
    await upsertConversationState({
      conversacionId: input.conversationId,
      userId: input.user.id,
      isapreId: input.isapreId,
      stage: 'idle',
      payload: {},
      metadata: {},
    })
    return
  }

  await upsertConversationState({
    conversacionId: input.conversationId,
    userId: input.user.id,
    isapreId: input.isapreId,
    stage: 'awaiting_prestacion',
    payload: {},
    metadata: {},
  })
  // El menu solo ofrece las prestaciones con flujo implementado, pero
  // resolvePrestacion sigue reconociendo las bloqueadas para poder explicarlas.
  await sendPrestacionesMenu({
    conversationId: input.conversationId,
    telefono: input.telefono,
    channel: input.channel,
    user: input.user,
    isapreId: input.isapreId,
    prestaciones: prestaciones.filter(isPrestacionDisponible),
  })
}

async function handlePrestacionSelection(input: {
  conversationId: number
  telefono: string
  channel?: CanalConversacion
  state: EstadoConversacion
  user: Usuario
  selectedRaw: string
}): Promise<void> {
  if (!input.state.isapre_id) {
    throw new Error('La conversación no tiene isapre asociada')
  }

  const prestaciones = await getPrestacionesByIsapre(input.state.isapre_id)
  const prestacion = await resolvePrestacion(input.selectedRaw, prestaciones)
  if (!prestacion) {
    await sendReply({
      conversationId: input.conversationId,
      to: input.telefono,
      channel: input.channel,
      body: 'No pude identificar la prestación. Elige una opción del menú o escríbela nuevamente.',
    })
    await sendPrestacionesMenu({
      conversationId: input.conversationId,
      telefono: input.telefono,
      channel: input.channel,
      user: input.user,
      isapreId: input.state.isapre_id,
      prestaciones,
    })
    return
  }

  if (!isPrestacionDisponible(prestacion)) {
    const disponibles = prestaciones.filter(isPrestacionDisponible)
    await upsertConversationState({
      conversacionId: input.conversationId,
      userId: input.user.id,
      isapreId: input.state.isapre_id,
      stage: 'awaiting_prestacion',
      prestacionId: null,
      payload: {},
      metadata: {},
    })
    await sendReply({
      conversationId: input.conversationId,
      to: input.telefono,
      channel: input.channel,
      body: `Identifiqué "${prestacion.nombre}", pero esa prestación todavía no está habilitada para tramitación automática. Por ahora puedo gestionar: ${disponibles.map((item) => item.nombre).join(' y ')}.`,
      metadata: {
        prestacionCodigo: prestacion.codigo,
        prestacionBloqueada: true,
      },
    })
    return
  }

  await sendReply({
    conversationId: input.conversationId,
    to: input.telefono,
    channel: input.channel,
    body: `Perfecto, vamos con "${prestacion.nombre}".`,
    metadata: {
      prestacionCodigo: prestacion.codigo,
    },
  })

  // El router decide si toca preguntar el tipo de comprobante, pedir el
  // documento o seguir con los campos: toda la secuencia vive en un solo lugar.
  await continueConversationWithAnswers({
    conversationId: input.conversationId,
    telefono: input.telefono,
    channel: input.channel,
    state: input.state,
    user: input.user,
    prestacion,
    answers: {},
  })
}

export async function getConversationSnapshotByChannel(
  userId: number,
  channel: CanalConversacion,
): Promise<{
  state: EstadoConversacion | null
  messages: Array<Awaited<ReturnType<typeof logConversationMessage>>>
  prestaciones: PrestacionCatalogo[]
  attachments: ArchivoConversacion[]
}> {
  const usuario = await queryOne<{ id: number }>(
    'SELECT id FROM usuarios WHERE id = $1',
    [userId],
  )

  if (!usuario) {
    throw new Error('Usuario no encontrado')
  }

  const conversacion = await queryOne<{ id: number }>(
    `
      SELECT id
      FROM conversaciones_whatsapp
      WHERE usuario_id = $1 AND canal = $2
      ORDER BY updated_at DESC
      LIMIT 1
    `,
    [userId, channel],
  )

  if (!conversacion) {
    return {
      state: null,
      messages: [],
      prestaciones: [],
      attachments: [],
    }
  }

  const state = await getConversationState(conversacion.id)
  const messages = await query<MensajeWhatsapp>(
    `
      SELECT *
      FROM mensajes_whatsapp
      WHERE conversacion_id = $1
      ORDER BY created_at DESC
      LIMIT 30
    `,
    [conversacion.id],
  )
  const prestaciones = state?.isapre_id
    ? await getPrestacionesByIsapre(state.isapre_id)
    : []
  const attachments = await listConversationAttachments(conversacion.id, 12)

  return {
    state,
    messages,
    prestaciones,
    attachments,
  }
}

export async function processWebConversationMessage(input: {
  userId: number
  text?: string
  prestacionCodigo?: string | null
  attachments?: WebConversationAttachmentInput[] | null
}): Promise<void> {
  const usuario = await queryOne<Usuario>(
    'SELECT * FROM usuarios WHERE id = $1',
    [input.userId],
  )

  if (!usuario) {
    throw new Error('Usuario no encontrado')
  }

  const conversacion = await ensureConversation(usuario.id, usuario.telefono, 'web')
  const isapreId = await getUserPrimaryIsapre(usuario.id)
  const previousState = await getConversationState(conversacion.id)
  const ensuredState = await upsertConversationState({
    conversacionId: conversacion.id,
    userId: usuario.id,
    isapreId,
    stage: previousState?.etapa ?? 'idle',
    prestacionId: previousState?.prestacion_id ?? null,
    campoActualId: previousState?.campo_actual_id ?? null,
    procesoDemoId: previousState?.proceso_demo_id ?? null,
    payload: previousState?.payload ?? {},
    metadata: previousState?.metadata ?? {},
  })

  const trimmedText = input.text?.trim() ?? ''
  const selectedPrestacion = input.prestacionCodigo?.trim() ?? ''
  const normalizedInput = selectedPrestacion || trimmedText
  const command = normalizeText(trimmedText || normalizedInput)
  const attachments = (input.attachments ?? [])
    .filter((attachment) => attachment?.base64Data)
    .sort((left, right) => {
      const leftRole = getAttachmentRole(left)
      const rightRole = getAttachmentRole(right)
      const leftWeight = leftRole === 'voucher' || leftRole === 'boleta' ? 1 : 0
      const rightWeight = rightRole === 'voucher' || rightRole === 'boleta' ? 1 : 0
      return leftWeight - rightWeight
    })
  const primaryAttachment = attachments[0] ?? null

  await logConversationMessage({
    conversacionId: conversacion.id,
    direccion: 'entrante',
    tipo: primaryAttachment
      ? (primaryAttachment.mimeType.startsWith('image/') ? 'image' : 'document')
      : 'text',
    contenido: normalizedInput || (primaryAttachment ? `[Adjunto] ${attachments.map((item) => item.fileName).join(', ')}` : null),
    metadata: {
      channel: 'web',
      prestacionCodigo: selectedPrestacion || null,
      attachments: attachments.map((attachment) => ({
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes ?? null,
        role: getAttachmentRole(attachment),
      })),
    },
  })

  if (!isapreId) {
    await sendReply({
      conversationId: conversacion.id,
      to: usuario.telefono,
      channel: 'web',
      body: `Encontré tu usuario, pero aún no veo una Isapre enrolada. Completa tu enrolamiento en ${buildWhatsappEntryUrl() ?? PUBLIC_APP_URL}.`,
    })
    return
  }

  if (!selectedPrestacion && (command === 'ayuda' || command === 'help')) {
    await sendReply({
      conversationId: conversacion.id,
      to: usuario.telefono,
      channel: 'web',
      body: 'Puedo simular la conversación de reembolso, pedir prestación, recibir una boleta y prellenar datos del formulario. Escribe "menú" para empezar o "estado" para revisar tu proceso.',
    })
    return
  }

  if (!selectedPrestacion && (command === 'estado' || command === 'mis reembolsos')) {
    await handleStatusCommand(conversacion.id, usuario.telefono, usuario.id, 'web')
  } else if (!selectedPrestacion && (command === 'menu' || command === 'menú' || command === 'reiniciar')) {
    await startConversationMenu({
      conversationId: conversacion.id,
      telefono: usuario.telefono,
      channel: 'web',
      user: usuario,
      isapreId,
    })
  } else if (selectedPrestacion) {
    await handlePrestacionSelection({
      conversationId: conversacion.id,
      telefono: usuario.telefono,
      channel: 'web',
      state: ensuredState,
      user: usuario,
      selectedRaw: selectedPrestacion,
    })
  } else if (attachments.length > 0) {
    // Si llega un documento, manda el documento: de ahi sale la mayoria del
    // formulario. El estado actual decide como se interpreta.
    for (const attachment of attachments) {
      const refreshedState = await getConversationState(conversacion.id) ?? ensuredState
      await processAttachmentForCurrentState({
        conversationId: conversacion.id,
        telefono: usuario.telefono,
        channel: 'web',
        state: refreshedState,
        user: usuario,
        attachment,
        declaredPrestacionCodigo: null,
      })
    }
  } else {
    switch (ensuredState.etapa) {
      case 'idle':
      case 'completed':
        await startConversationMenu({
          conversationId: conversacion.id,
          telefono: usuario.telefono,
          channel: 'web',
          user: usuario,
          isapreId,
        })
        break
      case 'awaiting_prestacion':
        if (normalizedInput) {
          await handlePrestacionSelection({
            conversationId: conversacion.id,
            telefono: usuario.telefono,
            channel: 'web',
            state: ensuredState,
            user: usuario,
            selectedRaw: normalizedInput,
          })
        }
        break
      case 'awaiting_document':
        await remindDocumentPending({
          conversationId: conversacion.id,
          telefono: usuario.telefono,
          channel: 'web',
          state: ensuredState,
        })
        break
      case 'awaiting_field':
        if (trimmedText) {
          await handleFieldFlow({
            conversationId: conversacion.id,
            telefono: usuario.telefono,
            channel: 'web',
            state: ensuredState,
            text: trimmedText,
            user: usuario,
          })
        }
        break
      case 'processing':
        await handleStatusCommand(conversacion.id, usuario.telefono, usuario.id, 'web')
        break
      default:
        break
    }
  }
}

export async function processKapsoInboundMessage(payload: KapsoWebhookPayload): Promise<void> {
  const normalized = extractIncomingMessage(payload)
  if (!normalized.telefono) {
    console.warn('Webhook Kapso sin teléfono utilizable. Payload omitido.')
    return
  }

  const usuario = await queryOne<Usuario>(
    'SELECT * FROM usuarios WHERE telefono = $1',
    [normalized.telefono],
  )
  const conversacion = await ensureConversation(usuario?.id ?? null, normalized.telefono, 'whatsapp')
  const isapreId = usuario ? await getUserPrimaryIsapre(usuario.id) : null

  await logConversationMessage({
    conversacionId: conversacion.id,
    direccion: 'entrante',
    tipo: normalized.messageType === 'unknown' ? 'text' : normalized.messageType,
    contenido: normalized.text || normalized.selectionTitle || normalized.mediaUrl,
    metadata: {
      kapsoPayload: normalized.raw,
      selectionId: normalized.selectionId,
      selectionTitle: normalized.selectionTitle,
      mediaUrl: normalized.mediaUrl,
    },
  })

  if (!usuario) {
    await handleUnknownUser(conversacion.id, normalized.telefono)
    return
  }

  const state = await getConversationState(conversacion.id)
  const ensuredState = await upsertConversationState({
    conversacionId: conversacion.id,
    userId: usuario.id,
    isapreId,
    stage: state?.etapa ?? 'idle',
    prestacionId: state?.prestacion_id ?? null,
    campoActualId: state?.campo_actual_id ?? null,
    procesoDemoId: state?.proceso_demo_id ?? null,
    payload: state?.payload ?? {},
    metadata: state?.metadata ?? {},
    lastMessageId: normalized.messageId,
  })

  const normalizedInput = normalized.selectionId ?? normalized.selectionTitle ?? normalized.text
  const command = normalizeText(normalizedInput)

  if (!isapreId) {
    await sendReply({
      conversationId: conversacion.id,
      to: normalized.telefono,
      body: `Encontré tu usuario, pero aún no veo una Isapre enrolada. Completa tu enrolamiento en ${buildWhatsappEntryUrl() ?? PUBLIC_APP_URL}.`,
    })
    return
  }

  if (command === 'ayuda' || command === 'help') {
    await sendReply({
      conversationId: conversacion.id,
      to: normalized.telefono,
      body: 'Puedo mostrarte prestaciones, pedir los datos de un formulario y luego registrar la navegación automatizada. Escribe "menú" para empezar o "estado" para revisar tu proceso.',
    })
    return
  }

  if (command === 'estado' || command === 'mis reembolsos') {
    await handleStatusCommand(conversacion.id, normalized.telefono, usuario.id)
    return
  }

  if (command === 'menu' || command === 'menú' || command === 'reiniciar') {
    await startConversationMenu({
      conversationId: conversacion.id,
      telefono: normalized.telefono,
      channel: 'whatsapp',
      user: usuario,
      isapreId,
    })
    return
  }

  switch (ensuredState.etapa) {
    case 'idle':
    case 'completed':
      await startConversationMenu({
        conversationId: conversacion.id,
        telefono: normalized.telefono,
        user: usuario,
        isapreId,
      })
      return
    case 'awaiting_prestacion':
      await handlePrestacionSelection({
        conversationId: conversacion.id,
        telefono: normalized.telefono,
        channel: 'whatsapp',
        state: ensuredState,
        user: usuario,
        selectedRaw: normalizedInput,
      })
      return
    case 'awaiting_document':
      await remindDocumentPending({
        conversationId: conversacion.id,
        telefono: normalized.telefono,
        channel: 'whatsapp',
        state: ensuredState,
      })
      return
    case 'awaiting_field':
      await handleFieldFlow({
        conversationId: conversacion.id,
        telefono: normalized.telefono,
        channel: 'whatsapp',
        state: ensuredState,
        text: normalizedInput,
        user: usuario,
      })
      return
    case 'processing':
      await handleStatusCommand(conversacion.id, normalized.telefono, usuario.id)
      return
    default:
      break
  }
}

export async function processKapsoOutboundEvent(eventName: string, payload: KapsoWebhookPayload): Promise<void> {
  const normalized = extractIncomingMessage(payload)
  const telefono = normalized.telefono
  if (!telefono) {
    return
  }

  const usuario = await queryOne<Usuario>(
    'SELECT * FROM usuarios WHERE telefono = $1',
    [telefono],
  )
  const conversacion = await ensureConversation(usuario?.id ?? null, telefono, 'whatsapp')
  await logConversationMessage({
    conversacionId: conversacion.id,
    direccion: 'sistema',
    tipo: 'system',
    contenido: eventName,
    metadata: {
      kapsoPayload: payload,
    },
  })
}

export async function processKapsoWebhookBatch(input: {
  eventName: string
  idempotencyKey: string | null
  payloads: Record<string, unknown>[]
}): Promise<void> {
  const shouldProcess = await registerWebhookEvent(
    input.idempotencyKey,
    input.eventName,
    {
      payloads: input.payloads,
    },
  )
  if (!shouldProcess) {
    return
  }

  for (const rawPayload of input.payloads) {
    const payload = rawPayload as KapsoWebhookPayload
    if (input.eventName === 'whatsapp.message.received') {
      await processKapsoInboundMessage(payload)
      continue
    }

    if (
      input.eventName === 'whatsapp.message.sent'
      || input.eventName === 'whatsapp.message.delivered'
      || input.eventName === 'whatsapp.message.read'
      || input.eventName === 'whatsapp.message.failed'
      || input.eventName === 'whatsapp.conversation.created'
      || input.eventName === 'whatsapp.conversation.ended'
      || input.eventName === 'whatsapp.conversation.inactive'
    ) {
      await processKapsoOutboundEvent(input.eventName, payload)
    }
  }
}
