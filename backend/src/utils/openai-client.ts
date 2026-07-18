const OPENAI_API_KEY = process.env.OPENAI_API_KEY?.trim()
const OPENAI_MODEL = process.env.OPENAI_MODEL?.trim() || 'gpt-4.1-mini'
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1'

interface OpenAITextMessage {
  role: 'system' | 'user'
  content: string
}

type OpenAIMessage = OpenAITextMessage | {
  role: 'system' | 'user'
  content: Array<
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  >
}

async function callOpenAI(messages: OpenAIMessage[]): Promise<string | null> {
  if (!OPENAI_API_KEY) {
    return null
  }

  const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages,
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`OpenAI respondió ${response.status}: ${text}`)
  }

  const data = await response.json() as {
    choices?: Array<{
      message?: { content?: string }
    }>
  }

  return data.choices?.[0]?.message?.content ?? null
}

function safeParseJson<T>(input: string | null): T | null {
  if (!input) {
    return null
  }

  try {
    return JSON.parse(input) as T
  } catch {
    return null
  }
}

export async function classifyPrestacionWithAI(input: {
  userMessage: string
  options: Array<{ codigo: string; nombre: string; descripcion?: string | null }>
}): Promise<{ codigo: string | null; razon?: string } | null> {
  const message = await callOpenAI([
    {
      role: 'system',
      content: [
        'Eres un clasificador estricto.',
        'Debes elegir la prestación más probable entre las opciones disponibles.',
        'Responde JSON con {"codigo": string|null, "razon": string}.',
        'Si no hay coincidencia clara, usa codigo = null.',
      ].join(' '),
    },
    {
      role: 'user',
      content: JSON.stringify(input),
    },
  ])

  return safeParseJson<{ codigo: string | null; razon?: string }>(message)
}

export async function extractFieldValueWithAI(input: {
  field: {
    campoKey: string
    label: string
    tipo: string
    ayuda?: string | null
    placeholder?: string | null
  }
  userMessage: string
}): Promise<{ valid: boolean; normalizedValue: string | null; reason?: string } | null> {
  const message = await callOpenAI([
    {
      role: 'system',
      content: [
        'Eres un extractor de datos para formularios de salud.',
        'Debes validar y normalizar la respuesta del usuario.',
        'Responde JSON con {"valid": boolean, "normalizedValue": string|null, "reason": string}.',
        'Para fechas usa YYYY-MM-DD. Para montos usa solo dígitos. Si no es válido, valid=false.',
      ].join(' '),
    },
    {
      role: 'user',
      content: JSON.stringify(input),
    },
  ])

  return safeParseJson<{ valid: boolean; normalizedValue: string | null; reason?: string }>(message)
}

export async function extractBoletaDataWithAI(input: {
  mimeType: string
  base64Data: string
  prestacionHint?: string | null
}): Promise<{
  prestacionSugerida: string | null
  tipoDocumentoSugerido: string | null
  resumen: string
  campos: {
    centroMedicoRut?: string | null
    centroMedicoNombre?: string | null
    fechaAtencion?: string | null
    montoPagado?: string | null
    numeroBoleta?: string | null
    numeroComercio?: string | null
    numeroOperacion?: string | null
    rutProfesional?: string | null
    tipoPago?: string | null
    observaciones?: string | null
  }
  confianza?: string
  faltantes?: string[]
} | null> {
  const dataUrl = `data:${input.mimeType};base64,${input.base64Data}`
  const message = await callOpenAI([
    {
      role: 'system',
      content: [
        { type: 'text', text: [
          'Eres un extractor estricto de datos de boletas/vouchers médicos chilenos para reembolsos de Isapre.',
          'Debes responder JSON con esta forma exacta:',
          '{"prestacionSugerida": string|null, "tipoDocumentoSugerido": string|null, "resumen": string, "campos": {"centroMedicoRut": string|null, "centroMedicoNombre": string|null, "fechaAtencion": string|null, "montoPagado": string|null, "numeroBoleta": string|null, "numeroComercio": string|null, "numeroOperacion": string|null, "rutProfesional": string|null, "tipoPago": string|null, "observaciones": string|null}, "confianza": string, "faltantes": string[]}.',
          'Usa YYYY-MM-DD para fechaAtencion y solo digitos para montoPagado.',
          'Si el documento parece una boleta ambulatoria o voucher de atención, sugiere una prestación probable entre: urgencias_medicas, consultas_psicologia, examenes_y_otros, optica_kine_fono.',
          'Si puedes inferir el tipo de documento de Banmédica para consultas, usa uno de estos códigos exactos: boleta_honorarios_electronica, otras_boletas_facturas, voucher_tarjeta.',
          'Usa tipoDocumentoSugerido = voucher_tarjeta cuando el documento sea claramente un voucher, comprobante POS o pago con tarjeta.',
          'Usa tipoDocumentoSugerido = boleta_honorarios_electronica cuando el documento sea una boleta de honorarios electrónica de un profesional.',
          'Usa tipoDocumentoSugerido = otras_boletas_facturas cuando sea una boleta/factura clínica o prestador institucional y no una boleta de honorarios.',
          'Si no puedes inferir con claridad, usa prestacionSugerida = null.',
          'No inventes campos; cuando no existan, usa null.',
          input.prestacionHint ? `Pista de prestación declarada por el usuario: ${input.prestacionHint}.` : '',
        ].filter(Boolean).join(' ') },
        { type: 'image_url', image_url: { url: dataUrl } },
      ],
    },
  ])

  return safeParseJson<{
    prestacionSugerida: string | null
    tipoDocumentoSugerido: string | null
    resumen: string
    campos: {
      centroMedicoRut?: string | null
      centroMedicoNombre?: string | null
      fechaAtencion?: string | null
      montoPagado?: string | null
      numeroBoleta?: string | null
      numeroComercio?: string | null
      numeroOperacion?: string | null
      rutProfesional?: string | null
      tipoPago?: string | null
      observaciones?: string | null
    }
    confianza?: string
    faltantes?: string[]
  }>(message)
}

export function hasOpenAIConfig(): boolean {
  return Boolean(OPENAI_API_KEY)
}
