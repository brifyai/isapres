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
  urlReembolso: 'https://login.isaprebanmedica.cl/login',
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
  montoPagado: number
  observaciones: string
}

export class BanmedicaScraper extends BaseScraper {
  constructor() {
    super(banmedicaConfig)
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

  private normalizeForm(task: ProcesoDemoTask): BanmedicaDemoForm {
    const formulario = task.metadata?.formulario ?? {}

    return {
      centroMedicoRut: String(formulario.centroMedicoRut ?? '76.123.456-7'),
      centroMedicoNombre: String(formulario.centroMedicoNombre ?? 'Clinica Demo Banmedica'),
      fechaAtencion: String(formulario.fechaAtencion ?? new Date().toISOString().slice(0, 10)),
      montoPagado: Number(formulario.montoPagado ?? 35000),
      observaciones: String(formulario.observaciones ?? 'Demo Banmedica Urgencias sin envio final.'),
    }
  }

  private async navigateToUrgencias(ctx: DemoExecutionContext): Promise<void> {
    if (!this.page) {
      throw new Error('Pagina no inicializada')
    }

    await this.page.waitForTimeout(2000)
    await this.safeClick([
      'a.item-link:has-text("Reembolsos")',
      'text=Reembolsos',
    ], 'Abrir menu Reembolsos', ctx)

    await this.safeClick([
      'a:has-text("Solicitar Reembolso")',
      'text=Solicitar Reembolso',
    ], 'Ingresar a Solicitar Reembolso', ctx)

    await this.page.waitForTimeout(2000)

    await this.safeClick([
      '.id-carrusel .card',
      '.id-carrusel swiper-slide',
      '.id-carrusel [role="group"]',
    ], 'Seleccionar primer beneficiario disponible', ctx, true)

    await this.safeClick([
      'text=Urgencias Médicas',
      'text=Urgencias Medicas',
      '.option-box:has-text("Urgencias Médicas")',
    ], 'Elegir prestacion Urgencias Medicas', ctx)
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
      if (await locator.count()) {
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
}
