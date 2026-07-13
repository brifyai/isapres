const OPENAI_API_KEY = process.env.OPENAI_API_KEY?.trim()
const OPENAI_MODEL = process.env.OPENAI_MODEL?.trim() || 'gpt-4.1-mini'
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1'

interface OpenAIMessage {
  role: 'system' | 'user'
  content: string
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

export function hasOpenAIConfig(): boolean {
  return Boolean(OPENAI_API_KEY)
}
