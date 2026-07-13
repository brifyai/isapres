import crypto from 'node:crypto'

export interface KapsoButtonOption {
  id: string
  title: string
}

export interface KapsoListRow {
  id: string
  title: string
  description?: string
}

export interface KapsoListSection {
  title: string
  rows: KapsoListRow[]
}

const KAPSO_API_BASE_URL = process.env.KAPSO_API_BASE_URL?.trim() || 'https://api.kapso.ai/meta/whatsapp/v24.0'
const KAPSO_API_KEY = process.env.KAPSO_API_KEY?.trim()
const KAPSO_PHONE_NUMBER_ID = process.env.KAPSO_PHONE_NUMBER_ID?.trim()
const KAPSO_WEBHOOK_SECRET = process.env.KAPSO_WEBHOOK_SECRET?.trim()

function getKapsoConfig() {
  if (!KAPSO_API_KEY) {
    throw new Error('Falta configurar KAPSO_API_KEY')
  }
  if (!KAPSO_PHONE_NUMBER_ID) {
    throw new Error('Falta configurar KAPSO_PHONE_NUMBER_ID')
  }

  return {
    apiKey: KAPSO_API_KEY,
    phoneNumberId: KAPSO_PHONE_NUMBER_ID,
    baseUrl: KAPSO_API_BASE_URL,
  }
}

async function sendMessage(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const config = getKapsoConfig()
  const response = await fetch(`${config.baseUrl}/${config.phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': config.apiKey,
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      ...body,
    }),
  })

  const text = await response.text()
  const parsed = text ? JSON.parse(text) as Record<string, unknown> : {}
  if (!response.ok) {
    throw new Error(parsed.error ? JSON.stringify(parsed.error) : `Kapso respondió ${response.status}`)
  }
  return parsed
}

export function hasKapsoSendConfig(): boolean {
  return Boolean(KAPSO_API_KEY && KAPSO_PHONE_NUMBER_ID)
}

export function verifyKapsoSignature(rawBody: string, signature: string | undefined): boolean {
  if (!KAPSO_WEBHOOK_SECRET) {
    return true
  }
  if (!signature) {
    return false
  }

  const expected = crypto.createHmac('sha256', KAPSO_WEBHOOK_SECRET).update(rawBody).digest('hex')
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  } catch {
    return false
  }
}

export async function sendKapsoText(input: {
  to: string
  body: string
  trackingData?: string
}): Promise<Record<string, unknown>> {
  return sendMessage({
    to: input.to,
    type: 'text',
    biz_opaque_callback_data: input.trackingData,
    text: {
      body: input.body,
    },
  })
}

export async function sendKapsoButtons(input: {
  to: string
  bodyText: string
  buttons: KapsoButtonOption[]
  trackingData?: string
}): Promise<Record<string, unknown>> {
  return sendMessage({
    to: input.to,
    type: 'interactive',
    biz_opaque_callback_data: input.trackingData,
    interactive: {
      type: 'button',
      body: {
        text: input.bodyText,
      },
      action: {
        buttons: input.buttons.map((button) => ({
          type: 'reply',
          reply: button,
        })),
      },
    },
  })
}

export async function sendKapsoList(input: {
  to: string
  bodyText: string
  buttonText: string
  sections: KapsoListSection[]
  trackingData?: string
}): Promise<Record<string, unknown>> {
  return sendMessage({
    to: input.to,
    type: 'interactive',
    biz_opaque_callback_data: input.trackingData,
    interactive: {
      type: 'list',
      body: {
        text: input.bodyText,
      },
      action: {
        button: input.buttonText,
        sections: input.sections,
      },
    },
  })
}
