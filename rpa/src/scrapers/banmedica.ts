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

    if (prestacionCodigo === 'consultas_psicologia') {
      return this.procesarDemoConsultas(task, credenciales, ctx)
    }

    return this.procesarDemoUrgencia(task, credenciales, ctx)
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

      await this.navigateToUrgencias(ctx)
      await this.discoverVisibleFields(ctx)
      await this.fillUrgenciaForm(form, ctx)

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

      await this.navigateToPrestacion('Consultas Médicas y Atenciones Psicológicas', ctx)
      await this.selectDocumentTypeAndStartNewClaim(form, ctx)
      await this.discoverVisibleFields(ctx)
      await this.fillConsultasForm(form, ctx)
      await this.uploadConsultasAttachments(form, ctx)

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

  private normalizeConsultasForm(task: ProcesoDemoTask): BanmedicaConsultasForm {
    const formulario = task.metadata?.formulario ?? {}
    const attachments = Array.isArray(task.metadata?.attachments)
      ? task.metadata.attachments as Array<Record<string, unknown>>
      : []

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
      attachments: attachments
        .map((attachment) => ({
          role: this.normalizeAttachmentRole(String(attachment.role ?? 'voucher')),
          fileName: String(attachment.fileName ?? `archivo-${attachment.id ?? 'demo'}`),
          mimeType: String(attachment.mimeType ?? 'application/octet-stream'),
          base64Data: String(attachment.base64Data ?? ''),
        }))
        .filter((attachment) => attachment.base64Data.length > 0),
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

    if (optional) {
      await ctx.recordStep({
        etapa: 'navegacion',
        accion: 'click_opcional_omitido',
        detalle: detail,
        url: this.page.url(),
        status: 'warning',
      })
      return false
    }

    throw new Error(`No se encontro el elemento requerido: ${detail}`)
  }

  private async discoverVisibleFields(ctx: DemoExecutionContext): Promise<void> {
    if (!this.page) {
      return
    }

    const fields = await this.page.evaluate(() => {
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

  private async uploadConsultasAttachments(form: BanmedicaConsultasForm, ctx: DemoExecutionContext): Promise<void> {
    if (!this.page) {
      throw new Error('Pagina no inicializada')
    }

    const voucher = form.attachments.find((attachment) => attachment.role === 'voucher' || attachment.role === 'boleta')
    const detail = form.attachments.find((attachment) => attachment.role === 'detalle' || attachment.role === 'orden_medica')

    if (voucher) {
      await this.uploadAttachmentToInput(
        'input[type="file"]',
        0,
        voucher,
        'Adjuntar voucher/boleta principal',
        ctx,
      )
    }

    if (detail) {
      await this.uploadAttachmentToInput(
        'input[type="file"]',
        1,
        detail,
        'Adjuntar detalle u orden médica',
        ctx,
      )
    } else {
      await ctx.recordStep({
        etapa: 'adjuntos',
        accion: 'adjunto_opcional_omitido',
        detalle: 'No se recibió archivo de detalle u orden médica para esta ejecución demo',
        url: this.page.url(),
        status: 'warning',
      })
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
    })
    return false
  }
}
