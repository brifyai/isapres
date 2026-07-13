import { query, queryOne } from '../db.js'
import type {
  EstadoConversacion,
  EtapaConversacion,
  IsapreId,
  KapsoWebhookPayload,
  PrestacionCampoCatalogo,
  PrestacionCatalogo,
  ProcesoDemo,
  Usuario,
  WebhookEventLog,
} from '../types.js'
import {
  buildWhatsappEntryUrl,
  createPrestacionProcess,
  ensureWhatsappConversation,
  getUserPrimaryIsapre,
  logWhatsappMessage,
} from './demo-process.js'
import {
  hasKapsoSendConfig,
  sendKapsoButtons,
  sendKapsoList,
  sendKapsoText,
} from './kapso-client.js'
import {
  classifyPrestacionWithAI,
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

async function sendReply(input: {
  conversationId: number
  to: string
  body: string
  type?: 'text' | 'buttons' | 'list'
  buttons?: Array<{ id: string; title: string }>
  sections?: Array<{ title: string; rows: Array<{ id: string; title: string; description?: string }> }>
  buttonText?: string
  metadata?: Record<string, unknown>
}): Promise<void> {
  try {
    let response: Record<string, unknown> | null = null
    if (hasKapsoSendConfig()) {
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

    await logWhatsappMessage({
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
    await logWhatsappMessage({
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
  user: Usuario
  isapreId: IsapreId
  prestaciones: PrestacionCatalogo[]
}): Promise<void> {
  const body = `Hola ${input.user.nombre.split(' ')[0]}. Detecté tu Isapre ${input.isapreId}. ¿Qué tipo de reembolso deseas gestionar?`
  if (input.prestaciones.length <= 3) {
    await sendReply({
      conversationId: input.conversationId,
      to: input.telefono,
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

function getHelpTextForField(field: PrestacionCampoCatalogo): string {
  const hint = field.ayuda ?? field.placeholder ?? 'Ingresa el dato solicitado.'
  return `${field.label}: ${hint}`
}

async function askField(
  conversationId: number,
  telefono: string,
  field: PrestacionCampoCatalogo,
): Promise<void> {
  await sendReply({
    conversationId,
    to: telefono,
    body: getHelpTextForField(field),
    metadata: {
      stage: 'awaiting_field',
      campoKey: field.campo_key,
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
): Promise<void> {
  const process = await getLatestProcess(userId)
  if (!process) {
    await sendReply({
      conversationId,
      to: telefono,
      body: 'Aún no tengo procesos activos. Escríbeme cualquier mensaje y te mostraré las prestaciones disponibles.',
    })
    return
  }

  await sendReply({
    conversationId,
    to: telefono,
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
      body: parsed.error ?? `No pude validar ${field.label}. ${getHelpTextForField(field)}`,
      metadata: {
        campoKey: field.campo_key,
        validationFailed: true,
      },
    })
    return
  }

  const currentPayload = (input.state.payload ?? {}) as Record<string, unknown>
  const answers = {
    ...((currentPayload.answers as Record<string, string> | undefined) ?? {}),
    [field.campo_key]: parsed.normalized,
  }

  const fields = await getFieldsByPrestacion(prestacion.id)
  const currentIndex = fields.findIndex((item) => item.id === field.id)
  const nextField = currentIndex >= 0 ? fields[currentIndex + 1] ?? null : null

  if (nextField) {
    await upsertConversationState({
      conversacionId: input.conversationId,
      userId: input.user.id,
      isapreId: input.state.isapre_id,
      stage: 'awaiting_field',
      prestacionId: prestacion.id,
      campoActualId: nextField.id,
      procesoDemoId: input.state.proceso_demo_id,
      payload: {
        ...currentPayload,
        answers,
      },
      metadata: input.state.metadata,
      lastMessageId: input.state.last_message_id,
    })
    await askField(input.conversationId, input.telefono, nextField)
    return
  }

  const process = await createPrestacionProcess({
    userId: input.user.id,
    telefono: input.telefono,
    origen: 'whatsapp',
    isapreId: input.state.isapre_id,
    prestacionCodigo: prestacion.codigo,
    prestacionNombre: prestacion.nombre,
    requiereAdjuntos: prestacion.requiere_adjuntos,
    requiereFormulario: prestacion.requiere_formulario,
    answers,
    fieldDefinitions: fields,
  })

  await upsertConversationState({
    conversacionId: input.conversationId,
    userId: input.user.id,
    isapreId: input.state.isapre_id,
    stage: 'processing',
    prestacionId: prestacion.id,
    campoActualId: null,
    procesoDemoId: process.id,
    payload: {
      ...currentPayload,
      answers,
    },
    metadata: input.state.metadata,
    lastMessageId: input.state.last_message_id,
  })

  await sendReply({
    conversationId: input.conversationId,
    to: input.telefono,
    body: `Perfecto. Ya reuní los datos para "${prestacion.nombre}". Ahora iniciaré el recorrido automatizado y dejaré todo registrado en tu historial.`,
    metadata: {
      processId: process.id,
      prestacionCodigo: prestacion.codigo,
    },
  })
}

async function startConversationMenu(input: {
  conversationId: number
  telefono: string
  user: Usuario
  isapreId: IsapreId
}): Promise<void> {
  const prestaciones = await getPrestacionesByIsapre(input.isapreId)
  if (prestaciones.length === 0) {
    await sendReply({
      conversationId: input.conversationId,
      to: input.telefono,
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
  await sendPrestacionesMenu({
    conversationId: input.conversationId,
    telefono: input.telefono,
    user: input.user,
    isapreId: input.isapreId,
    prestaciones,
  })
}

async function handlePrestacionSelection(input: {
  conversationId: number
  telefono: string
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
      body: 'No pude identificar la prestación. Elige una opción del menú o escríbela nuevamente.',
    })
    await sendPrestacionesMenu({
      conversationId: input.conversationId,
      telefono: input.telefono,
      user: input.user,
      isapreId: input.state.isapre_id,
      prestaciones,
    })
    return
  }

  if (!prestacion.requiere_formulario) {
    await upsertConversationState({
      conversacionId: input.conversationId,
      userId: input.user.id,
      isapreId: input.state.isapre_id,
      stage: 'awaiting_prestacion',
      prestacionId: prestacion.id,
      payload: {
        selectedPrestacion: prestacion.codigo,
      },
      metadata: {},
    })
    await sendReply({
      conversationId: input.conversationId,
      to: input.telefono,
      body: `La prestación "${prestacion.nombre}" fue detectada correctamente, pero en esta fase demo aún queda preparada para adjuntos y no para ejecución completa. Puedes escoger otra prestación o esperar la siguiente iteración.`,
      metadata: {
        prestacionCodigo: prestacion.codigo,
      },
    })
    return
  }

  const fields = await getFieldsByPrestacion(prestacion.id)
  const firstField = fields[0]
  if (!firstField) {
    throw new Error('La prestación seleccionada no tiene campos configurados')
  }

  await upsertConversationState({
    conversacionId: input.conversationId,
    userId: input.user.id,
    isapreId: input.state.isapre_id,
    stage: 'awaiting_field',
    prestacionId: prestacion.id,
    campoActualId: firstField.id,
    payload: {
      selectedPrestacion: prestacion.codigo,
      answers: {},
    },
    metadata: {},
  })

  await sendReply({
    conversationId: input.conversationId,
    to: input.telefono,
    body: `Perfecto, comenzaremos con "${prestacion.nombre}". Te pediré los datos uno por uno.`,
    metadata: { prestacionCodigo: prestacion.codigo },
  })
  await askField(input.conversationId, input.telefono, firstField)
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
  const conversacion = await ensureWhatsappConversation(usuario?.id ?? null, normalized.telefono)
  const isapreId = usuario ? await getUserPrimaryIsapre(usuario.id) : null

  await logWhatsappMessage({
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
        state: ensuredState,
        user: usuario,
        selectedRaw: normalizedInput,
      })
      return
    case 'awaiting_field':
      await handleFieldFlow({
        conversationId: conversacion.id,
        telefono: normalized.telefono,
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
  const conversacion = await ensureWhatsappConversation(usuario?.id ?? null, telefono)
  await logWhatsappMessage({
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
