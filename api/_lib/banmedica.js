import { randomInt } from 'node:crypto'
import { load } from 'cheerio'

const BANMEDICA_LOGIN_URL = 'https://login.isaprebanmedica.cl/login'
const BANMEDICA_REEMBOLSO_URL = 'https://afiliados.isaprebanmedica.cl/view/reembolso'
const VERIFICATION_SESSION_TTL_MS = 5 * 60 * 1000
const VERIFICATION_INPUT_SELECTOR = [
  'input[name*="code" i]',
  'input[id*="code" i]',
  'input[name*="otp" i]',
  'input[id*="otp" i]',
  'input[name*="token" i]',
  'input[id*="token" i]',
  'input[name*="verif" i]',
  'input[id*="verif" i]',
  'input[inputmode="numeric"]',
  'input[autocomplete="one-time-code"]',
].join(', ')
const VERIFICATION_RESEND_SELECTOR = [
  'button[id*="reenviar" i]',
  'button[name*="reenviar" i]',
  'button[id*="resend" i]',
  'button[name*="resend" i]',
  'a[id*="reenviar" i]',
  'a[name*="reenviar" i]',
  'a[id*="resend" i]',
  'a[name*="resend" i]',
].join(', ')
const VERIFICATION_SUBMIT_SELECTOR = [
  'button[type="submit"]',
  'button[id*="valid" i]',
  'button[name*="valid" i]',
  'button[id*="confirm" i]',
  'button[name*="confirm" i]',
  'button[id*="continuar" i]',
  'button[name*="continuar" i]',
  'button[id*="verify" i]',
  'button[name*="verify" i]',
].join(', ')

const verificationSessions = new Map()

function getScrapingBeeApiKey() {
  const key = process.env.SCRAPINGBEE_API_KEY?.trim()
  if (!key) {
    throw new Error('Falta SCRAPINGBEE_API_KEY en Vercel.')
  }
  return key
}

function normalizeRut(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function normalizeName(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function dedupeBeneficiarios(items) {
  const seen = new Set()
  return items.filter((item) => {
    const key = `${item.rut}|${item.nombre}`.toLowerCase()
    if (!item.nombre || !item.rut || seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

function parseBeneficiariosFromHtml(html) {
  const $ = load(html)
  const items = []

  $('.id-carrusel .card').each((_, element) => {
    const nombre = normalizeName($(element).find('.card-title').first().text())
    const rut = normalizeRut($(element).find('.card-subtitle').first().text())
    if (nombre && rut) {
      items.push({ nombre, rut })
    }
  })

  return dedupeBeneficiarios(items)
}

function cleanupVerificationSessions() {
  const now = Date.now()
  for (const [sessionId, session] of verificationSessions.entries()) {
    if (now - session.createdAt > VERIFICATION_SESSION_TTL_MS) {
      verificationSessions.delete(sessionId)
    }
  }
}

function buildSessionKey({ userId, rut }) {
  return `${String(userId)}:${String(rut).replace(/\D/g, '')}`
}

function createVerificationSession({ sessionKey }) {
  cleanupVerificationSessions()

  const sessionId = `bm-${randomInt(100000, 999999)}`
  const scrapingBeeSessionId = randomInt(10000000, 99999999)

  verificationSessions.set(sessionId, {
    createdAt: Date.now(),
    sessionKey,
    scrapingBeeSessionId,
  })

  return {
    sessionId,
    scrapingBeeSessionId,
  }
}

function getVerificationSession({ sessionId, sessionKey }) {
  cleanupVerificationSessions()

  if (!sessionId) {
    return null
  }

  const session = verificationSessions.get(sessionId)
  if (!session) {
    return null
  }

  if (session.sessionKey !== sessionKey) {
    return null
  }

  session.createdAt = Date.now()
  return {
    sessionId,
    scrapingBeeSessionId: session.scrapingBeeSessionId,
  }
}

function clearVerificationSession(sessionId) {
  if (sessionId) {
    verificationSessions.delete(sessionId)
  }
}

function escapeForJs(value) {
  return JSON.stringify(String(value ?? ''))
}

function buildFillVerificationCodeInstruction(code) {
  return {
    evaluate: `
      (() => {
        const selectors = ${JSON.stringify(VERIFICATION_INPUT_SELECTOR.split(', '))}
        const input = document.querySelector(selectors.join(', '))
        if (!input) {
          return false
        }
        input.focus()
        input.value = ${escapeForJs(code)}
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      })()
    `,
  }
}

function buildClickInstruction(selector, fallbackPatterns) {
  return {
    evaluate: `
      (() => {
        const direct = document.querySelector(${JSON.stringify(selector)})
        if (direct) {
          direct.click()
          return true
        }

        const patterns = ${JSON.stringify(fallbackPatterns)}
        const nodes = Array.from(document.querySelectorAll('button, a, [role="button"], input[type="submit"]'))
        const target = nodes.find((node) => {
          const text = [node.innerText, node.textContent, node.value].filter(Boolean).join(' ').trim().toLowerCase()
          return patterns.some((pattern) => text.includes(pattern))
        })

        if (target) {
          target.click()
          return true
        }

        return false
      })()
    `,
  }
}

function buildInitialScenario({ rut, password }) {
  return {
    instructions: [
      { wait_for: '#rut' },
      { fill: ['#rut', rut] },
      { fill: ['#current-password', password] },
      { click: 'button[type="submit"]' },
      { wait: 4000 },
      { evaluate: `window.location.href = '${BANMEDICA_REEMBOLSO_URL}'` },
      { wait: 5000 },
      {
        wait_for: [
          '.id-carrusel .card',
          '.option-box',
          VERIFICATION_INPUT_SELECTOR,
          '#rut',
        ].join(', '),
      },
    ],
  }
}

function buildVerificationScenario({ verificationCode, resendVerification }) {
  const instructions = [
    {
      wait_for: [
        VERIFICATION_INPUT_SELECTOR,
        VERIFICATION_RESEND_SELECTOR,
        VERIFICATION_SUBMIT_SELECTOR,
      ].join(', '),
    },
  ]

  if (resendVerification && !verificationCode) {
    instructions.push(
      buildClickInstruction(VERIFICATION_RESEND_SELECTOR, [
        'reenviar',
        'resend',
        'nuevo codigo',
        'nuevo código',
        'enviar codigo',
        'enviar código',
      ]),
      { wait: 3000 },
      { wait_for: VERIFICATION_INPUT_SELECTOR },
    )

    return { instructions }
  }

  instructions.push(
    buildFillVerificationCodeInstruction(verificationCode),
    buildClickInstruction(VERIFICATION_SUBMIT_SELECTOR, [
      'validar',
      'verificar',
      'confirmar',
      'continuar',
      'ingresar',
    ]),
    { wait: 4000 },
    { evaluate: `window.location.href = '${BANMEDICA_REEMBOLSO_URL}'` },
    { wait: 5000 },
    {
      wait_for: [
        '.id-carrusel .card',
        '.option-box',
        VERIFICATION_INPUT_SELECTOR,
      ].join(', '),
    },
  )

  return { instructions }
}

async function executeScrapingBeeRequest({ jsScenario, scrapingBeeSessionId }) {
  const params = new URLSearchParams({
    url: BANMEDICA_LOGIN_URL,
    render_js: 'true',
    json_response: 'true',
    block_resources: 'false',
    wait: '0',
    js_scenario: JSON.stringify(jsScenario),
  })

  if (scrapingBeeSessionId) {
    params.set('session_id', String(scrapingBeeSessionId))
  }

  if (process.env.SCRAPINGBEE_COUNTRY_CODE?.trim()) {
    params.set('country_code', process.env.SCRAPINGBEE_COUNTRY_CODE.trim())
  }

  if (process.env.SCRAPINGBEE_PREMIUM_PROXY?.trim() === 'true') {
    params.set('premium_proxy', 'true')
  }

  const response = await fetch(`https://app.scrapingbee.com/api/v1?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${getScrapingBeeApiKey()}`,
    },
  })

  const responseText = await response.text()
  let payload

  try {
    payload = JSON.parse(responseText)
  } catch {
    throw new Error(`ScrapingBee devolvió una respuesta no JSON (${response.status}).`)
  }

  return {
    payload,
    html: typeof payload?.body === 'string' ? payload.body : '',
  }
}

function extractVerificationMessage($) {
  const candidates = [
    'h1',
    'h2',
    'h3',
    '.alert',
    '.alert-warning',
    '.alert-danger',
    '.message',
    '.message-box',
    '.option-box',
    '.mat-mdc-card',
    'label',
    'p',
    'span',
  ]

  for (const selector of candidates) {
    const matches = $(selector).toArray()
    for (const element of matches) {
      const text = normalizeName($(element).text())
      if (
        text &&
        /codigo|código|verificacion|verificación|autenticacion|autenticación|te enviamos|ingresa el codigo|ingresa el código|confirma tu identidad|clave dinamica|clave dinámica/i.test(text)
      ) {
        return text
      }
    }
  }

  return 'Banmédica pidió un código de verificación. Ingresa el código recibido para continuar.'
}

function detectVerificationChallenge(html) {
  const $ = load(html)
  const bodyText = normalizeName($('body').text())
  const hasVerificationInput = $(VERIFICATION_INPUT_SELECTOR).length > 0
  const hasVerificationText = /codigo|código|verificacion|verificación|autenticacion|autenticación|otp|token/i.test(bodyText)

  if (!hasVerificationInput && !hasVerificationText) {
    return null
  }

  return {
    message: extractVerificationMessage($),
  }
}

function detectLoginError(html) {
  const bodyText = normalizeName(load(html)('body').text())
  if (
    /incorrect|inválid|invalido|inválido|credenciales|clave incorrecta|ingresa tu rut|usuario o contraseña/i.test(bodyText)
  ) {
    return 'Banmédica rechazó las credenciales del usuario.'
  }

  if (/codigo incorrecto|código incorrecto|codigo invalido|código inválido|codigo expirado|código expirado/i.test(bodyText)) {
    return 'El código de verificación no fue aceptado por Banmédica.'
  }

  return null
}

export async function syncBanmedicaBeneficiarios({
  userId,
  rut,
  password,
  verificationCode,
  verificationSessionId,
  resendVerification = false,
}) {
  const sessionKey = buildSessionKey({ userId, rut })
  const activeSession = getVerificationSession({
    sessionId: verificationSessionId,
    sessionKey,
  })

  if ((verificationCode || resendVerification) && !activeSession) {
    throw new Error('La sesión de verificación expiró. Vuelve a iniciar la sincronización.')
  }

  const currentSession =
    activeSession ??
    (verificationCode || resendVerification ? null : createVerificationSession({ sessionKey }))

  const jsScenario = activeSession
    ? buildVerificationScenario({ verificationCode, resendVerification })
    : buildInitialScenario({ rut, password })

  const { payload, html } = await executeScrapingBeeRequest({
    jsScenario,
    scrapingBeeSessionId: currentSession?.scrapingBeeSessionId,
  })

  const beneficiarios = parseBeneficiariosFromHtml(html)
  if (beneficiarios.length > 0) {
    clearVerificationSession(currentSession?.sessionId)
    return {
      beneficiarios,
      debug: payload?.js_scenario_report ?? null,
    }
  }

  const challenge = detectVerificationChallenge(html)
  if (challenge && currentSession?.sessionId) {
    return {
      requiresVerification: true,
      verificationSessionId: currentSession.sessionId,
      verificationMessage: challenge.message,
      debug: payload?.js_scenario_report ?? null,
    }
  }

  const loginError = detectLoginError(html)
  if (loginError) {
    clearVerificationSession(currentSession?.sessionId)
    throw new Error(loginError)
  }

  if (html.includes('option-box')) {
    throw new Error('Banmédica abrió la pantalla de prestaciones, pero no expuso beneficiarios para extraer.')
  }

  throw new Error('No se pudieron detectar beneficiarios en la vista de reembolsos de Banmédica.')
}
