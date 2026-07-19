import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { BaseScraper } from '../base-scraper.js'
import type {
  CredencialesDescifradas,
  DemoExecutionContext,
  ProcesoDemoTask,
  ResultadoReembolso,
  ScraperConfig,
} from '../types.js'

const banmedicaConfig: ScraperConfig = {
  isapreId: 'banmedica',
  nombre: 'Banmedica',
  urlLogin: 'https://login.isaprebanmedica.cl/login',
  urlReembolso: 'https://afiliados.isaprebanmedica.cl/view/reembolso',
  selectores: {
    inputRut: '#rut',
    inputPassword: '#current-password',
    btnLogin: 'button[type="submit"]',
    loginSuccessIndicator: 'ul.items',
    loginErrorIndicator: 'small',
  },
}

interface BanmedicaDemoForm {
  centroMedicoRut: string
  centroMedicoNombre: string
  fechaAtencion: string
  tipoPago: string
  numeroBoleta: string
  rutProfesional: string
  montoPagado: number
  observaciones: string
}

interface BanmedicaConsultasAttachment {
  role: 'voucher' | 'detalle' | 'orden_medica' | 'boleta' | 'otro'
  fileName: string
  mimeType: string
  base64Data: string
}

interface BanmedicaConsultasForm {
  tipoDocumentoPago: 'boleta_honorarios_electronica' | 'otras_boletas_facturas' | 'voucher_tarjeta'
  rutProfesional: string
  centroMedicoRut: string
  numeroComercio: string
  numeroOperacion: string
  numeroBoleta: string
  montoPagado: string
  fechaAtencion: string
  tipoPago: string
  observaciones: string
  attachments: BanmedicaConsultasAttachment[]
}

export class BanmedicaScraper extends BaseScraper {
  constructor() {
    super(banmedicaConfig)
  }

  async procesarDemoPrestacion(
    task: ProcesoDemoTask,
    credenciales: CredencialesDescifradas,
    ctx: DemoExecutionContext,
  ): Promise<ResultadoReembolso> {
    const prestacionCodigo = String(task.metadata?.prestacionCodigo ?? '')

    // Despacho explicito: una prestacion sin flujo propio debe fallar de forma
    // visible, no caer silenciosamente en el formulario de otra.
    switch (prestacionCodigo) {
      case 'consultas_psicologia':
        return this.procesarDemoConsultas(task, credenciales, ctx)
      case 'urgencias_medicas':
        return this.procesarDemoUrgencia(task, credenciales, ctx)
      default:
        await ctx.recordStep({
          etapa: 'error',
          accion: 'prestacion_no_implementada',
          detalle: `La prestación "${prestacionCodigo || '(sin código)'}" no tiene un flujo RPA implementado en Banmédica.`,
          status: 'error',
          payload: { prestacionCodigo },
        }).catch(() => undefined)

        return {
          success: false,
          error: `Prestación no implementada en el scraper de Banmédica: ${prestacionCodigo || '(sin código)'}`,
        }
    }
  }

  /**
   * Banmedica muestra anuncios y modales promocionales tras el login que
   * bloquean los clicks posteriores. Los cerramos antes de navegar.
   */
  private async dismissAnnouncements(ctx: DemoExecutionContext): Promise<void> {
    if (!this.page) {
      return
    }

    const closeSelectors = [
      '.modal.show button.close',
      '.modal.show .close',
      '.modal.show button[aria-label="Close"]',
      '.modal.show button:has-text("Cerrar")',
      '.modal.show button:has-text("Entendido")',
      '.modal.show button:has-text("Acepto")',
      'button[aria-label="Close"]',
    ]

    let cerrados = 0
    // Puede haber mas de un anuncio encadenado.
    for (let intento = 0; intento < 3; intento += 1) {
      const modalVisible = await this.page.locator('.modal.show').first().isVisible().catch(() => false)
      if (!modalVisible) {
        break
      }

      let cerroEnEstaVuelta = false
      for (const selector of closeSelectors) {
        const locator = this.page.locator(selector).first()
        const visible = await locator.isVisible().catch(() => false)
        if (!visible) {
          continue
        }

        await locator.click({ timeout: 5000 }).catch(async () => {
          await locator.click({ force: true, timeout: 5000 }).catch(() => undefined)
        })
        await this.page.waitForTimeout(800)
        cerrados += 1
        cerroEnEstaVuelta = true
        break
      }

      if (!cerroEnEstaVuelta) {
        await this.page.keyboard.press('Escape').catch(() => undefined)
        await this.page.waitForTimeout(600)
      }
    }

    // Un backdrop huerfano intercepta los clicks aunque el modal ya no se vea.
    await this.page.evaluate(() => {
      const doc = ((globalThis as unknown) as {
        document: {
          querySelectorAll: (selector: string) => ArrayLike<{ remove: () => void }>
          body: { classList: { remove: (token: string) => void } }
        }
      }).document
      Array.from(doc.querySelectorAll('.modal-backdrop')).forEach((element) => element.remove())
      doc.body.classList.remove('modal-open')
    }).catch(() => undefined)

    await ctx.recordStep({
      etapa: 'navegacion',
      accion: 'cerrar_anuncios',
      detalle: cerrados > 0
        ? `Se cerraron ${cerrados} anuncio(s) o modal(es) post-login`
        : 'No se detectaron anuncios que cerrar',
      url: this.page.url(),
      status: 'info',
      payload: { cerrados },
    })
  }

  override async login(credenciales: CredencialesDescifradas): Promise<boolean> {
    if (!this.page) {
      throw new Error('Navegador no inicializado')
    }

    try {
      await this.page.goto(this.config.urlLogin, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await this.page.waitForSelector('#rut', { timeout: 15000 })
      await this.page.fill('#rut', credenciales.rut)
      await this.page.fill('#current-password', credenciales.password)
      await this.page.locator('button[type="submit"]').first().click()

      await this.page.waitForURL(/\/view\/(home|reembolso)/, { timeout: 20000 }).catch(() => undefined)
      await this.page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => undefined)
      await this.page.waitForTimeout(3000)

      const loginError = await this.page.locator('small').filter({ hasText: /ingresa tu rut|incorrect|error/i }).count()
      if (loginError > 0 && this.page.url().includes('/login')) {
        return false
      }

      return true
    } catch (error) {
      console.error('[Banmedica] Error en login:', error)
      return false
    }
  }

  async procesarDemoUrgencia(
    task: ProcesoDemoTask,
    credenciales: CredencialesDescifradas,
    ctx: DemoExecutionContext,
  ): Promise<ResultadoReembolso> {
    const form = this.normalizeForm(task)

    try {
      await this.launchBrowser()
      await ctx.recordStep({
        etapa: 'login',
        accion: 'abrir_login',
        detalle: 'Ingreso a la sucursal virtual Banmedica',
        url: this.config.urlLogin,
        status: 'info',
      })

      const loginOk = await this.login(credenciales)
      await ctx.recordStep({
        etapa: 'login',
        accion: 'resultado_login',
        detalle: loginOk ? 'Login exitoso en Banmedica' : 'Login fallido en Banmedica',
        url: this.page?.url(),
        status: loginOk ? 'success' : 'error',
      })

      if (!loginOk || !this.page) {
        await this.closeBrowser()
        return {
          success: false,
          error: 'No se pudo iniciar sesion en Banmedica.',
        }
      }

      await this.dismissAnnouncements(ctx)
      await this.navigateToUrgencias(ctx)
      await this.discoverVisibleFields(ctx)
      await this.fillUrgenciaForm(form, ctx)
      await this.uploadAttachments(
        this.normalizeAttachments(task),
        [
          { role: 'boleta', detalle: 'Adjuntar boleta o voucher de la urgencia', requerido: true },
          { role: 'detalle', detalle: 'Adjuntar detalle de prestación', requerido: false },
        ],
        ctx,
      )

      await ctx.recordStep({
        etapa: 'finalizacion',
        accion: 'formulario_listo',
        detalle: 'Formulario identificado y completado sin envio final',
        url: this.page.url(),
        status: 'success',
      })

      await this.closeBrowser()

      return {
        success: true,
        folioIsapre: 'DEMO-SIN-ENVIO',
      }
    } catch (error) {
      await ctx.recordStep({
        etapa: 'error',
        accion: 'proceso_fallido',
        detalle: error instanceof Error ? error.message : 'Fallo inesperado en Banmedica',
        url: this.page?.url(),
        status: 'error',
      }).catch(() => undefined)

      await this.closeBrowser()
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Error inesperado en el demo de Banmedica',
      }
    }
  }

  async procesarDemoConsultas(
    task: ProcesoDemoTask,
    credenciales: CredencialesDescifradas,
    ctx: DemoExecutionContext,
  ): Promise<ResultadoReembolso> {
    const form = this.normalizeConsultasForm(task)

    try {
      await this.launchBrowser()
      await ctx.recordStep({
        etapa: 'login',
        accion: 'abrir_login',
        detalle: 'Ingreso a la sucursal virtual Banmedica para Consultas Médicas',
        url: this.config.urlLogin,
        status: 'info',
      })

      const loginOk = await this.login(credenciales)
      await ctx.recordStep({
        etapa: 'login',
        accion: 'resultado_login',
        detalle: loginOk ? 'Login exitoso en Banmedica' : 'Login fallido en Banmedica',
        url: this.page?.url(),
        status: loginOk ? 'success' : 'error',
      })

      if (!loginOk || !this.page) {
        await this.closeBrowser()
        return {
          success: false,
          error: 'No se pudo iniciar sesion en Banmedica.',
        }
      }

      await this.dismissAnnouncements(ctx)
      await this.navigateToPrestacion('Consultas Médicas y Atenciones Psicológicas', ctx)
      await this.selectDocumentTypeAndStartNewClaim(form, ctx)
      await this.discoverVisibleFields(ctx)
      await this.fillConsultasForm(form, ctx)
      await this.uploadAttachments(
        form.attachments,
        [
          { role: 'voucher', detalle: 'Adjuntar voucher/boleta principal', requerido: true },
          { role: 'detalle', detalle: 'Adjuntar detalle u orden médica', requerido: false },
        ],
        ctx,
      )

      await ctx.recordStep({
        etapa: 'finalizacion',
        accion: 'datos_documentos_listos',
        detalle: 'Paso 3 de Datos y documentos alcanzado y completado sin continuar al envío final',
        url: this.page.url(),
        status: 'success',
      })

      await this.closeBrowser()

      return {
        success: true,
        folioIsapre: 'DEMO-CONSULTAS-SIN-ENVIO',
      }
    } catch (error) {
      await ctx.recordStep({
        etapa: 'error',
        accion: 'proceso_fallido',
        detalle: error instanceof Error ? error.message : 'Fallo inesperado en Consultas Banmedica',
        url: this.page?.url(),
        status: 'error',
      }).catch(() => undefined)

      await this.closeBrowser()
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Error inesperado en el demo de Consultas Banmedica',
      }
    }
  }

  private normalizeForm(task: ProcesoDemoTask): BanmedicaDemoForm {
    const formulario = task.metadata?.formulario ?? {}

    return {
      centroMedicoRut: String(formulario.centroMedicoRut ?? '76.123.456-7'),
      centroMedicoNombre: String(formulario.centroMedicoNombre ?? 'Clinica Demo Banmedica'),
      fechaAtencion: String(formulario.fechaAtencion ?? new Date().toISOString().slice(0, 10)),
      tipoPago: String(formulario.tipoPago ?? 'boleta'),
      numeroBoleta: String(formulario.numeroBoleta ?? '7340991'),
      rutProfesional: String(formulario.rutProfesional ?? '18.466.194-2'),
      montoPagado: Number(formulario.montoPagado ?? 35000),
      observaciones: String(formulario.observaciones ?? 'Demo Banmedica Urgencias sin envio final.'),
    }
  }

  /** Los adjuntos llegan igual para toda prestacion; el formato no depende del flujo. */
  private normalizeAttachments(task: ProcesoDemoTask): BanmedicaConsultasAttachment[] {
    const attachments = Array.isArray(task.metadata?.attachments)
      ? task.metadata.attachments as Array<Record<string, unknown>>
      : []

    return attachments
      .map((attachment) => ({
        role: this.normalizeAttachmentRole(String(attachment.role ?? 'voucher')),
        fileName: String(attachment.fileName ?? `archivo-${attachment.id ?? 'demo'}`),
        mimeType: String(attachment.mimeType ?? 'application/octet-stream'),
        base64Data: String(attachment.base64Data ?? ''),
      }))
      .filter((attachment) => attachment.base64Data.length > 0)
  }

  private normalizeConsultasForm(task: ProcesoDemoTask): BanmedicaConsultasForm {
    const formulario = task.metadata?.formulario ?? {}

    return {
      tipoDocumentoPago: this.normalizeDocumentType(String(formulario.tipo_documento_pago ?? 'otras_boletas_facturas')),
      rutProfesional: String(formulario.rut_profesional ?? ''),
      centroMedicoRut: String(formulario.centro_medico_rut ?? ''),
      numeroComercio: String(formulario.numero_comercio ?? ''),
      numeroOperacion: String(formulario.numero_operacion ?? ''),
      numeroBoleta: String(formulario.numero_boleta ?? ''),
      montoPagado: String(formulario.monto_pagado ?? ''),
      fechaAtencion: String(formulario.fecha_atencion ?? ''),
      tipoPago: String(formulario.tipo_pago ?? 'tarjeta'),
      observaciones: String(formulario.observaciones ?? ''),
      attachments: this.normalizeAttachments(task),
    }
  }

  private async navigateToUrgencias(ctx: DemoExecutionContext): Promise<void> {
    await this.navigateToPrestacion('Urgencias Médicas', ctx)
  }

  private async navigateToPrestacion(prestacionLabel: string, ctx: DemoExecutionContext): Promise<void> {
    if (!this.page) {
      throw new Error('Pagina no inicializada')
    }

    await this.page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => undefined)
    await this.page.waitForTimeout(2000)

    if (!this.page.url().includes('/view/reembolso')) {
      const menuOpened = await this.openReembolsosMenu(ctx)
      if (menuOpened) {
        const navigatedFromMenu = await this.safeClick([
          'ul.list-link a:has-text("Solicitar Reembolso")',
          'li.link-item a:has-text("Solicitar Reembolso")',
          'a:has-text("Solicitar Reembolso")',
          'text=Solicitar Reembolso',
        ], 'Ingresar a Solicitar Reembolso', ctx, true)

        if (navigatedFromMenu) {
          await this.page.waitForURL(/\/view\/reembolso/, { timeout: 15000 }).catch(() => undefined)
        }
      }
    }

    if (!this.page.url().includes('/view/reembolso')) {
      await this.page.goto(this.config.urlReembolso, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined)
      await ctx.recordStep({
        etapa: 'navegacion',
        accion: 'goto',
        detalle: 'Ingreso directo a Solicitar Reembolso por URL autenticada',
        url: this.page.url(),
        status: 'warning',
        payload: {
          fallback: true,
        },
      })
    }

    await this.page.waitForURL(/\/view\/reembolso/, { timeout: 15000 })
    await this.page.waitForTimeout(2000)

    await this.safeClick([
      '.id-carrusel .card.shadow-sm',
      '.id-carrusel .card',
      '.id-carrusel swiper-slide',
      '.id-carrusel [role="group"]',
    ], 'Seleccionar primer beneficiario disponible', ctx, true)

    await this.page.waitForTimeout(2000)
    await this.page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => undefined)
    await this.selectPrestacionCard([prestacionLabel, prestacionLabel.replace('é', 'e').replace('á', 'a')], ctx)
  }

  private async selectPrestacionCard(labels: string[], ctx: DemoExecutionContext): Promise<void> {
    if (!this.page) {
      throw new Error('Pagina no inicializada')
    }

    const cards = this.page.locator('.option-box')
    const totalCards = await cards.count()

    for (let index = 0; index < totalCards; index += 1) {
      const card = cards.nth(index)
      const text = (await card.textContent())?.replace(/\s+/g, ' ').trim() ?? ''
      const matches = labels.some((label) => text.includes(label))
      if (!matches) {
        continue
      }

      await card.scrollIntoViewIfNeeded().catch(() => undefined)
      await card.click({ timeout: 10000 }).catch(async () => {
        await card.click({ force: true, timeout: 10000 })
      })
      await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => undefined)
      await this.page.waitForTimeout(1500)
      await ctx.recordStep({
        etapa: 'navegacion',
        accion: 'click',
        detalle: `Elegir prestación ${labels[0]}`,
        selector: '.option-box',
        url: this.page.url(),
        status: 'success',
        payload: {
          matchedText: text,
        },
      })
      return
    }

    await ctx.recordStep({
      etapa: 'navegacion',
      accion: 'prestacion_no_encontrada',
      detalle: `No se encontró la tarjeta de prestación "${labels[0]}"`,
      selector: '.option-box',
      url: this.page.url(),
      status: 'error',
      payload: await this.buildSelectorFailureEvidence(['.option-box']),
    })

    throw new Error(`No se encontro el elemento requerido: Elegir prestación ${labels[0]}`)
  }

  private async openReembolsosMenu(ctx: DemoExecutionContext): Promise<boolean> {
    if (!this.page) {
      return false
    }

    const selectors = [
      'ul.items a.item-link.drop:has-text("Reembolsos")',
      'a.item-link.drop:has-text("Reembolsos")',
      'a.item-link:has-text("Reembolsos")',
      'a:has-text("Reembolsos")',
      'text=Reembolsos',
    ]

    for (const selector of selectors) {
      const locator = this.page.locator(selector).first()

      try {
        await locator.waitFor({ state: 'visible', timeout: 3000 })
      } catch {
        continue
      }

      await locator.scrollIntoViewIfNeeded().catch(() => undefined)
      await locator.hover({ timeout: 5000 }).catch(() => undefined)
      await this.page.waitForTimeout(800)

      const submenuVisible = await this.page.locator('ul.list-link a:has-text("Solicitar Reembolso")').first().isVisible().catch(() => false)
      if (!submenuVisible) {
        await locator.click({ timeout: 5000 }).catch(async () => {
          await locator.click({ force: true, timeout: 5000 })
        })
        await this.page.waitForTimeout(1200)
      }

      const submenuReady = await this.page.locator('ul.list-link a:has-text("Solicitar Reembolso")').first().isVisible().catch(() => false)
      if (submenuReady) {
        await ctx.recordStep({
          etapa: 'navegacion',
          accion: 'click',
          detalle: 'Abrir menu Reembolsos',
          selector,
          url: this.page.url(),
          status: 'success',
        })
        return true
      }
    }

    return false
  }

  private async safeClick(
    selectors: string[],
    detail: string,
    ctx: DemoExecutionContext,
    optional = false,
  ): Promise<boolean> {
    if (!this.page) {
      throw new Error('Pagina no inicializada')
    }

    for (const selector of selectors) {
      const locator = this.page.locator(selector).first()
      try {
        await locator.waitFor({ state: 'visible', timeout: 3000 })
      } catch {
        continue
      }

      await locator.scrollIntoViewIfNeeded().catch(() => undefined)
      await locator.click({ timeout: 10000 }).catch(async () => {
        await locator.click({ force: true, timeout: 10000 })
      })
      await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => undefined)
      await this.page.waitForTimeout(1500)
      await ctx.recordStep({
        etapa: 'navegacion',
        accion: 'click',
        detalle: detail,
        selector,
        url: this.page.url(),
        status: 'success',
      })
      return true
    }

    const evidencia = await this.buildSelectorFailureEvidence(selectors)

    if (optional) {
      await ctx.recordStep({
        etapa: 'navegacion',
        accion: 'click_opcional_omitido',
        detalle: detail,
        url: this.page.url(),
        status: 'warning',
        payload: evidencia,
      })
      return false
    }

    await ctx.recordStep({
      etapa: 'navegacion',
      accion: 'click_fallido',
      detalle: `No se encontró el elemento requerido: ${detail}`,
      url: this.page.url(),
      status: 'error',
      payload: evidencia,
    })

    throw new Error(`No se encontro el elemento requerido: ${detail}`)
  }

  /**
   * Inventario de los inputs visibles en la pantalla actual. Se usa tanto para
   * registrar los campos detectados como para dejar evidencia cuando un
   * selector falla y hay que corregirlo desde el historial.
   */
  private async captureVisibleFields(): Promise<Array<Record<string, unknown> | null>> {
    if (!this.page) {
      return []
    }

    return this.page.evaluate(() => {
      const doc = ((globalThis as unknown) as {
        document: { querySelectorAll: (selector: string) => ArrayLike<unknown> }
      }).document
      const elements = Array.from(doc.querySelectorAll('input, textarea, select')) as Array<Record<string, unknown>>
      return elements
        .map((element) => {
          const htmlElement = element as Record<string, unknown> & {
            getBoundingClientRect: () => { width: number; height: number }
            getAttribute: (name: string) => string | null
            hasAttribute: (name: string) => boolean
            classList: { contains: (token: string) => boolean }
            closest: (selector: string) => { textContent?: string | null } | null
            tagName: string
            id: string
          }
          const rect = htmlElement.getBoundingClientRect()
          const visible = rect.width > 0 && rect.height > 0
          if (!visible) {
            return null
          }

          const parentText = htmlElement.closest('.form-group, .option, .col-12')?.textContent ?? ''
          return {
            key: htmlElement.getAttribute('formcontrolname')
              ?? htmlElement.getAttribute('name')
              ?? htmlElement.id
              ?? htmlElement.getAttribute('placeholder')
              ?? 'campo',
            label: parentText.trim().replace(/\s+/g, ' ').slice(0, 120)
              || htmlElement.getAttribute('placeholder')
              || htmlElement.id
              || 'Campo detectado',
            tipo: htmlElement.tagName.toLowerCase() === 'select'
              ? 'select'
              : htmlElement.getAttribute('type') || htmlElement.tagName.toLowerCase(),
            selector: htmlElement.id
              ? `#${htmlElement.id}`
              : htmlElement.getAttribute('formcontrolname')
                ? `${htmlElement.tagName.toLowerCase()}[formcontrolname="${htmlElement.getAttribute('formcontrolname')}"]`
                : htmlElement.getAttribute('name')
                  ? `${htmlElement.tagName.toLowerCase()}[name="${htmlElement.getAttribute('name')}"]`
                  : htmlElement.tagName.toLowerCase(),
            requerido: htmlElement.hasAttribute('required') || htmlElement.classList.contains('ng-invalid'),
          }
        })
        .filter(Boolean)
    })
  }

  /** Textos de botones y enlaces visibles, para depurar un click fallido. */
  private async captureClickableTexts(): Promise<string[]> {
    if (!this.page) {
      return []
    }

    return this.page.evaluate(() => {
      const doc = ((globalThis as unknown) as {
        document: { querySelectorAll: (selector: string) => ArrayLike<unknown> }
      }).document
      const elements = Array.from(
        doc.querySelectorAll('button, a, .option, .option-box, [role="button"]'),
      ) as Array<{
        getBoundingClientRect: () => { width: number; height: number }
        textContent?: string | null
      }>

      return elements
        .filter((element) => {
          const rect = element.getBoundingClientRect()
          return rect.width > 0 && rect.height > 0
        })
        .map((element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim())
        .filter((text) => text.length > 0 && text.length < 120)
        .slice(0, 40)
    }).catch(() => [])
  }

  /** Evidencia compacta para depurar un selector que no encontro su elemento. */
  private async buildSelectorFailureEvidence(
    selectoresIntentados: string[],
  ): Promise<Record<string, unknown>> {
    const campos = await this.captureVisibleFields().catch(() => [])
    return {
      selectoresIntentados,
      camposVisibles: campos
        .filter(Boolean)
        .map((campo) => ({
          label: campo?.label,
          selector: campo?.selector,
          tipo: campo?.tipo,
        }))
        .slice(0, 25),
      textosClickeables: await this.captureClickableTexts(),
    }
  }

  private async discoverVisibleFields(ctx: DemoExecutionContext): Promise<void> {
    if (!this.page) {
      return
    }

    const fields = await this.captureVisibleFields()

    for (const field of fields) {
      await ctx.upsertField({
        campoKey: String(field?.key ?? 'campo_detectado'),
        label: String(field?.label ?? 'Campo detectado'),
        tipo: String(field?.tipo ?? 'text'),
        selector: String(field?.selector ?? ''),
        requerido: Boolean(field?.requerido),
      })
    }
  }

  private async fillUrgenciaForm(form: BanmedicaDemoForm, ctx: DemoExecutionContext): Promise<void> {
    if (!this.page) {
      throw new Error('Pagina no inicializada')
    }

    await this.tryFill(
      [
        'input[formcontrolname="medicHolding"]',
        'input[placeholder*="RUT del centro médico"]',
        'input[placeholder*="RUT del centro medico"]',
      ],
      form.centroMedicoRut,
      {
        campoKey: 'centro_medico_rut',
        label: 'RUT del centro medico',
        tipo: 'text',
        requerido: true,
      },
      ctx,
    )

    await this.tryFill(
      [
        'input[placeholder="Fecha"]',
        'input[placeholder*="Fecha"]',
      ],
      form.fechaAtencion,
      {
        campoKey: 'fecha_atencion',
        label: 'Fecha',
        tipo: 'date',
        requerido: true,
      },
      ctx,
    )

    await this.trySelect(
      [
        'select[formcontrolname*="payment"]',
        'select[formcontrolname*="type"]',
        'select',
      ],
      form.tipoPago,
      {
        campoKey: 'tipo_pago',
        label: 'Tipo de pago',
        tipo: 'select',
      },
      ctx,
    )

    await this.tryFill(
      [
        'input[placeholder*="Número de boleta"]',
        'input[placeholder*="Numero de boleta"]',
        'input[placeholder*="boleta"]',
      ],
      form.numeroBoleta,
      {
        campoKey: 'numero_boleta',
        label: 'Numero de boleta',
        tipo: 'text',
      },
      ctx,
    )

    await this.tryFill(
      [
        'input[placeholder*="RUT del profesional"]',
        'input[placeholder*="RUT del medico"]',
        'input[placeholder*="RUT del médico"]',
      ],
      form.rutProfesional,
      {
        campoKey: 'rut_profesional',
        label: 'RUT del profesional',
        tipo: 'text',
      },
      ctx,
    )

    await this.tryFill(
      [
        'input[placeholder*="Monto"]',
        'input[formcontrolname*="amount"]',
      ],
      String(form.montoPagado),
      {
        campoKey: 'monto_pagado',
        label: 'Monto pagado',
        tipo: 'number',
      },
      ctx,
    )

    await this.tryFill(
      [
        'textarea',
        'input[placeholder*="Observ"]',
        'input[placeholder*="Detalle"]',
      ],
      form.observaciones,
      {
        campoKey: 'observaciones',
        label: 'Observaciones',
        tipo: 'textarea',
      },
      ctx,
    )
  }

  private normalizeDocumentType(value: string): BanmedicaConsultasForm['tipoDocumentoPago'] {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'boleta_honorarios_electronica') return normalized
    if (normalized === 'voucher_tarjeta') return normalized
    return 'otras_boletas_facturas'
  }

  private normalizeAttachmentRole(value: string): BanmedicaConsultasAttachment['role'] {
    if (value === 'detalle' || value === 'orden_medica' || value === 'boleta' || value === 'otro') {
      return value
    }
    return 'voucher'
  }

  private getDocumentTypeLabel(value: BanmedicaConsultasForm['tipoDocumentoPago']): string {
    switch (value) {
      case 'boleta_honorarios_electronica':
        return 'Boleta de honorarios electrónica'
      case 'voucher_tarjeta':
        return 'Voucher o comprobante de pago con tarjeta'
      default:
        return 'Otras boletas o facturas'
    }
  }

  private async selectDocumentTypeAndStartNewClaim(form: BanmedicaConsultasForm, ctx: DemoExecutionContext): Promise<void> {
    if (!this.page) {
      throw new Error('Pagina no inicializada')
    }

    const documentLabel = this.getDocumentTypeLabel(form.tipoDocumentoPago)
    const optionCards = this.page.locator('.option')
    const totalCards = await optionCards.count()

    for (let index = 0; index < totalCards; index += 1) {
      const card = optionCards.nth(index)
      const text = (await card.textContent())?.replace(/\s+/g, ' ').trim() ?? ''
      if (!text.includes(documentLabel)) {
        continue
      }

      await card.scrollIntoViewIfNeeded().catch(() => undefined)
      await card.click({ timeout: 10000 }).catch(async () => {
        await card.click({ force: true, timeout: 10000 })
      })
      await this.page.waitForTimeout(1200)
      await ctx.recordStep({
        etapa: 'navegacion',
        accion: 'click',
        detalle: `Seleccionar tipo de comprobante: ${documentLabel}`,
        selector: '.option',
        url: this.page.url(),
        status: 'success',
        payload: {
          matchedText: text,
        },
      })
      break
    }

    await this.safeClick([
      'button:has-text("Nuevo Reembolso")',
      'text=Nuevo Reembolso',
    ], 'Iniciar Nuevo Reembolso', ctx)

    await this.page.waitForTimeout(1800)
  }

  private async fillConsultasForm(form: BanmedicaConsultasForm, ctx: DemoExecutionContext): Promise<void> {
    if (!this.page) {
      throw new Error('Pagina no inicializada')
    }

    await this.tryFill(
      [
        'input[placeholder*="RUT del médico"]',
        'input[placeholder*="RUT del medico"]',
        'input[formcontrolname*="medic"]',
      ],
      form.rutProfesional,
      {
        campoKey: 'rut_profesional',
        label: 'RUT del médico',
        tipo: 'text',
      },
      ctx,
    )

    await this.tryFill(
      [
        'input[placeholder*="RUT del centro médico"]',
        'input[placeholder*="RUT del centro medico"]',
        '#rutMedicalCenter',
      ],
      form.centroMedicoRut,
      {
        campoKey: 'centro_medico_rut',
        label: 'RUT del centro médico',
        tipo: 'text',
      },
      ctx,
    )

    await this.tryFill(
      [
        'input[placeholder*="Número de comercio"]',
        'input[placeholder*="Numero de comercio"]',
      ],
      form.numeroComercio,
      {
        campoKey: 'numero_comercio',
        label: 'Número de comercio',
        tipo: 'text',
      },
      ctx,
    )

    await this.tryFill(
      [
        'input[placeholder*="Número de operación"]',
        'input[placeholder*="Numero de operación"]',
        'input[placeholder*="Numero de operacion"]',
      ],
      form.numeroOperacion,
      {
        campoKey: 'numero_operacion',
        label: 'Número de operación',
        tipo: 'text',
      },
      ctx,
    )

    await this.tryFill(
      [
        'input[placeholder*="Número de boleta"]',
        'input[placeholder*="Numero de boleta"]',
      ],
      form.numeroBoleta,
      {
        campoKey: 'numero_boleta',
        label: 'Número de boleta',
        tipo: 'text',
      },
      ctx,
    )

    await this.tryFill(
      [
        'input[placeholder*="Monto"]',
        '#monto',
      ],
      form.montoPagado,
      {
        campoKey: 'monto_pagado',
        label: 'Monto',
        tipo: 'number',
      },
      ctx,
    )

    await this.tryFill(
      [
        'input[placeholder="Fecha"]',
        'input[placeholder*="Fecha"]',
      ],
      form.fechaAtencion,
      {
        campoKey: 'fecha_atencion',
        label: 'Fecha',
        tipo: 'date',
      },
      ctx,
    )

    await this.trySelectNg(
      [
        'ng-select',
        '.ng-select',
      ],
      form.tipoPago,
      {
        campoKey: 'tipo_pago',
        label: 'Tipo de pago',
        tipo: 'select',
      },
      ctx,
    )
  }

  /** Roles intercambiables: un voucher sirve donde se pide boleta, y viceversa. */
  private static readonly ROLES_EQUIVALENTES: Record<string, BanmedicaConsultasAttachment['role'][]> = {
    voucher: ['voucher', 'boleta'],
    boleta: ['boleta', 'voucher'],
    detalle: ['detalle', 'orden_medica'],
    orden_medica: ['orden_medica', 'detalle'],
    otro: ['otro'],
  }

  /**
   * Sube los adjuntos disponibles a las zonas de carga de la pantalla actual.
   * Los slots van en el mismo orden en que Banmedica los renderiza.
   */
  private async uploadAttachments(
    attachments: BanmedicaConsultasAttachment[],
    slots: Array<{ role: BanmedicaConsultasAttachment['role']; detalle: string; requerido: boolean }>,
    ctx: DemoExecutionContext,
  ): Promise<void> {
    if (!this.page) {
      throw new Error('Pagina no inicializada')
    }

    const disponibles = [...attachments]

    for (const [index, slot] of slots.entries()) {
      const preferencias = BanmedicaScraper.ROLES_EQUIVALENTES[slot.role] ?? [slot.role]
      const encontradoIndex = disponibles.findIndex((attachment) => preferencias.includes(attachment.role))

      if (encontradoIndex === -1) {
        await ctx.recordStep({
          etapa: 'adjuntos',
          accion: slot.requerido ? 'adjunto_requerido_faltante' : 'adjunto_opcional_omitido',
          detalle: `${slot.detalle}: no se recibió un archivo con rol "${slot.role}"`,
          url: this.page.url(),
          status: slot.requerido ? 'error' : 'warning',
          payload: { slotRole: slot.role, requerido: slot.requerido },
        })
        continue
      }

      // Consumimos el archivo para no subir el mismo en dos slots.
      const [attachment] = disponibles.splice(encontradoIndex, 1)
      await this.uploadAttachmentToInput('input[type="file"]', index, attachment, slot.detalle, ctx)
    }
  }

  private async uploadAttachmentToInput(
    selector: string,
    index: number,
    attachment: BanmedicaConsultasAttachment,
    detail: string,
    ctx: DemoExecutionContext,
  ): Promise<void> {
    if (!this.page) {
      return
    }

    const input = this.page.locator(selector).nth(index)
    if (await input.count() === 0) {
      await ctx.recordStep({
        etapa: 'adjuntos',
        accion: 'upload_skip',
        detalle: `${detail}: input file no encontrado`,
        url: this.page.url(),
        status: 'warning',
      })
      return
    }

    const extension = this.getFileExtension(attachment.fileName, attachment.mimeType)
    const tempFilePath = path.join(os.tmpdir(), `wsp-isap-${Date.now()}-${index}${extension}`)
    await fs.writeFile(tempFilePath, Buffer.from(attachment.base64Data, 'base64'))

    try {
      await input.setInputFiles(tempFilePath)
      await this.page.waitForTimeout(1200)
      await ctx.recordStep({
        etapa: 'adjuntos',
        accion: 'upload',
        detalle: detail,
        selector: `${selector}:nth(${index})`,
        url: this.page.url(),
        status: 'success',
        payload: {
          fileName: attachment.fileName,
          role: attachment.role,
        },
      })
    } finally {
      await fs.unlink(tempFilePath).catch(() => undefined)
    }
  }

  private getFileExtension(fileName: string, mimeType: string): string {
    const currentExtension = path.extname(fileName)
    if (currentExtension) {
      return currentExtension
    }

    if (mimeType.includes('png')) return '.png'
    if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return '.jpg'
    if (mimeType.includes('webp')) return '.webp'
    if (mimeType.includes('pdf')) return '.pdf'
    return '.bin'
  }

  private async tryFill(
    selectors: string[],
    value: string,
    field: {
      campoKey: string
      label: string
      tipo: string
      requerido?: boolean
    },
    ctx: DemoExecutionContext,
  ): Promise<boolean> {
    if (!this.page) {
      return false
    }

    if (!value.trim()) {
      await ctx.recordStep({
        etapa: 'formulario',
        accion: 'fill_omitido',
        detalle: `Campo sin valor disponible: ${field.label}`,
        url: this.page?.url(),
        status: 'warning',
      })
      return false
    }

    for (const selector of selectors) {
      const locator = this.page.locator(selector).first()
      if (await locator.count()) {
        await locator.fill(value, { timeout: 10000 }).catch(async () => {
          await locator.click({ force: true })
          await locator.fill(value)
        })
        await ctx.upsertField({
          campoKey: field.campoKey,
          label: field.label,
          tipo: field.tipo,
          selector,
          requerido: field.requerido,
          valorIngresado: value,
        })
        await ctx.recordStep({
          etapa: 'formulario',
          accion: 'fill',
          detalle: `Campo completado: ${field.label}`,
          selector,
          url: this.page.url(),
          status: 'success',
          payload: {
            value,
          },
        })
        return true
      }
    }

    await ctx.recordStep({
      etapa: 'formulario',
      accion: 'fill_skip',
      detalle: `Campo no encontrado: ${field.label}`,
      url: this.page?.url(),
      status: 'warning',
      payload: await this.buildSelectorFailureEvidence(selectors),
    })
    return false
  }

  private async trySelect(
    selectors: string[],
    value: string,
    field: {
      campoKey: string
      label: string
      tipo: string
      requerido?: boolean
    },
    ctx: DemoExecutionContext,
  ): Promise<boolean> {
    if (!this.page) {
      return false
    }

    if (!value.trim()) {
      await ctx.recordStep({
        etapa: 'formulario',
        accion: 'select_omitido',
        detalle: `Campo sin valor disponible: ${field.label}`,
        url: this.page?.url(),
        status: 'warning',
      })
      return false
    }

    for (const selector of selectors) {
      const locator = this.page.locator(selector).first()
      if (await locator.count()) {
        const options = await locator.locator('option').allTextContents().catch(() => [])
        const matchedOption = options.find((option) => option.toLowerCase().includes(value.toLowerCase()))
          ?? options[1]
          ?? options[0]

        if (!matchedOption) {
          continue
        }

        await locator.selectOption({ label: matchedOption }).catch(async () => {
          await locator.selectOption({ index: 1 }).catch(() => undefined)
        })
        await ctx.upsertField({
          campoKey: field.campoKey,
          label: field.label,
          tipo: field.tipo,
          selector,
          requerido: field.requerido,
          valorIngresado: matchedOption,
        })
        await ctx.recordStep({
          etapa: 'formulario',
          accion: 'select',
          detalle: `Campo seleccionado: ${field.label}`,
          selector,
          url: this.page.url(),
          status: 'success',
          payload: {
            value: matchedOption,
          },
        })
        return true
      }
    }

    await ctx.recordStep({
      etapa: 'formulario',
      accion: 'select_skip',
      detalle: `Campo no encontrado: ${field.label}`,
      url: this.page?.url(),
      status: 'warning',
      payload: await this.buildSelectorFailureEvidence(selectors),
    })
    return false
  }

  private async trySelectNg(
    selectors: string[],
    value: string,
    field: {
      campoKey: string
      label: string
      tipo: string
      requerido?: boolean
    },
    ctx: DemoExecutionContext,
  ): Promise<boolean> {
    if (!this.page) {
      return false
    }

    if (!value.trim()) {
      await ctx.recordStep({
        etapa: 'formulario',
        accion: 'select_omitido',
        detalle: `Campo sin valor disponible: ${field.label}`,
        url: this.page?.url(),
        status: 'warning',
      })
      return false
    }

    for (const selector of selectors) {
      const locator = this.page.locator(selector).first()
      if (await locator.count()) {
        await locator.click({ timeout: 10000 }).catch(async () => {
          await locator.click({ force: true, timeout: 10000 })
        })

        const option = this.page.locator('.ng-dropdown-panel .ng-option').filter({ hasText: new RegExp(value, 'i') }).first()
        const hasOption = await option.count().catch(() => 0)
        if (hasOption) {
          await option.click({ timeout: 10000 }).catch(async () => {
            await option.click({ force: true, timeout: 10000 })
          })
          await ctx.upsertField({
            campoKey: field.campoKey,
            label: field.label,
            tipo: field.tipo,
            selector,
            requerido: field.requerido,
            valorIngresado: value,
          })
          await ctx.recordStep({
            etapa: 'formulario',
            accion: 'select',
            detalle: `Campo seleccionado: ${field.label}`,
            selector,
            url: this.page.url(),
            status: 'success',
            payload: {
              value,
            },
          })
          return true
        }
      }
    }

    await ctx.recordStep({
      etapa: 'formulario',
      accion: 'select_skip',
      detalle: `Campo no encontrado: ${field.label}`,
      url: this.page?.url(),
      status: 'warning',
      payload: await this.buildSelectorFailureEvidence(selectors),
    })
    return false
  }
}
