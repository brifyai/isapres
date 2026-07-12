import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import type { ScraperConfig, CredencialesDescifradas, ResultadoReembolso, ReembolsoTask } from './types.js'

/**
 * Clase base para todos los scrapers de Isapres.
 * Implementa el flujo común: login → navegar a reembolso → subir boleta → obtener folio.
 *
 * Cada Isapre hereda de esta clase y sobrescribe los métodos necesarios
 * si su portal tiene particularidades.
 */
export abstract class BaseScraper {
  protected browser: Browser | null = null
  protected page: Page | null = null
  protected config: ScraperConfig
  private tempResources: string[] = []

  constructor(config: ScraperConfig) {
    this.config = config
  }

  /**
   * Inicia el navegador Playwright (headless por defecto).
   */
  protected async launchBrowser(): Promise<void> {
    this.browser = await chromium.launch({
      headless: process.env.HEADLESS !== 'false',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    })
    this.page = await this.browser.newPage({
      viewport: { width: 1280, height: 720 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    })
  }

  /**
   * Cierra el navegador y libera recursos.
   */
  protected async closeBrowser(): Promise<void> {
    if (this.browser) {
      await this.browser.close()
      this.browser = null
      this.page = null
    }

    await this.cleanupTempResources()
  }

  private async cleanupTempResources(): Promise<void> {
    const resources = [...this.tempResources].reverse()
    this.tempResources = []

    for (const resource of resources) {
      try {
        await fs.rm(resource, { recursive: true, force: true })
      } catch {
        // Ignorar limpieza fallida de temporales
      }
    }
  }

  private inferExtension(sourceUrl: string, contentType: string | null): string {
    const pathname = new URL(sourceUrl).pathname
    const currentExt = path.extname(pathname)
    if (currentExt) {
      return currentExt
    }

    switch (contentType) {
      case 'application/pdf':
        return '.pdf'
      case 'image/jpeg':
        return '.jpg'
      case 'image/png':
        return '.png'
      default:
        return '.bin'
    }
  }

  private async resolveDocumentoInput(source: string): Promise<string> {
    if (!/^https?:\/\//i.test(source)) {
      return source
    }

    const response = await fetch(source)
    if (!response.ok) {
      throw new Error(`No se pudo descargar el documento remoto (${response.status})`)
    }

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wsp-isap-'))
    const extension = this.inferExtension(source, response.headers.get('content-type'))
    const tempFile = path.join(tempDir, `documento${extension}`)
    const arrayBuffer = await response.arrayBuffer()

    await fs.writeFile(tempFile, Buffer.from(arrayBuffer))
    this.tempResources.push(tempDir)

    return tempFile
  }

  /**
   * Realiza el login en la sucursal virtual de la Isapre.
   * Usa los selectores definidos en la configuración.
   *
   * @returns true si el login fue exitoso, false en caso contrario.
   */
  protected async login(credenciales: CredencialesDescifradas): Promise<boolean> {
    if (!this.page) throw new Error('Navegador no inicializado')

    const { selectores } = this.config

    try {
      // Navegar a la página de login
      await this.page.goto(this.config.urlLogin, { waitUntil: 'networkidle', timeout: 30000 })

      // Esperar a que cargue el formulario
      if (selectores.inputRut) {
        await this.page.waitForSelector(selectores.inputRut, { timeout: 15000 })
        await this.page.fill(selectores.inputRut, credenciales.rut)
      }

      if (selectores.inputPassword) {
        await this.page.fill(selectores.inputPassword, credenciales.password)
      }

      // Click en botón de login
      if (selectores.btnLogin) {
        await this.page.click(selectores.btnLogin)
      }

      // Esperar a que se complete el login
      await this.page.waitForTimeout(3000)

      // Verificar si hay indicador de error de login
      if (selectores.loginErrorIndicator) {
        const errorElement = await this.page.$(selectores.loginErrorIndicator)
        if (errorElement) {
          console.error(`[${this.config.nombre}] Login fallido: credenciales incorrectas`)
          return false
        }
      }

      // Verificar indicador de login exitoso
      if (selectores.loginSuccessIndicator) {
        await this.page.waitForSelector(selectores.loginSuccessIndicator, { timeout: 10000 })
        console.log(`[${this.config.nombre}] Login exitoso`)
        return true
      }

      // Si no hay indicadores, asumir éxito si no hubo errores
      console.log(`[${this.config.nombre}] Login completado (sin verificación específica)`)
      return true
    } catch (error) {
      console.error(`[${this.config.nombre}] Error en login:`, error)
      return false
    }
  }

  /**
   * Navega a la página de reembolso y sube la boleta.
   * Sobrescribir en cada scraper si el flujo es diferente.
   */
  protected async subirBoleta(task: ReembolsoTask): Promise<ResultadoReembolso> {
    if (!this.page) throw new Error('Navegador no inicializado')

    const { selectores } = this.config

    try {
      // Navegar a la página de reembolso
      await this.page.goto(this.config.urlReembolso, { waitUntil: 'networkidle', timeout: 30000 })

      // Subir archivo de boleta
      if (selectores.inputBoleta) {
        const fileInput = await this.page.$(selectores.inputBoleta)
        if (fileInput) {
          const documentoInput = await this.resolveDocumentoInput(task.url_documento)
          await fileInput.setInputFiles(documentoInput)
        }
      }

      // Ingresar monto
      if (selectores.inputMonto && task.monto > 0) {
        await this.page.fill(selectores.inputMonto, task.monto.toString())
      }

      // Enviar formulario
      if (selectores.btnEnviar) {
        await this.page.click(selectores.btnEnviar)
      }

      // Esperar respuesta
      await this.page.waitForTimeout(5000)

      // Obtener folio de resultado
      let folio: string | undefined
      if (selectores.folioResultado) {
        const folioElement = await this.page.$(selectores.folioResultado)
        if (folioElement) {
          folio = (await folioElement.textContent()) ?? undefined
          folio = folio?.trim()
        }
      }

      return {
        success: true,
        folioIsapre: folio,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Error al subir boleta',
      }
    }
  }

  /**
   * Verifica si el portal de la Isapre está operativo.
   * Navega a la página de login y verifica que cargue correctamente.
   */
  async checkPortalStatus(): Promise<{ status: 'operativo' | 'caido' | 'html_cambiado'; latenciaMs: number }> {
    const startTime = Date.now()

    try {
      await this.launchBrowser()
      if (!this.page) throw new Error('Navegador no inicializado')

      await this.page.goto(this.config.urlLogin, { waitUntil: 'networkidle', timeout: 20000 })
      const latenciaMs = Date.now() - startTime

      // Verificar que el formulario de login exista
      if (this.config.selectores.inputRut) {
        const inputExists = await this.page.$(this.config.selectores.inputRut)
        if (!inputExists) {
          await this.closeBrowser()
          return { status: 'html_cambiado', latenciaMs }
        }
      }

      await this.closeBrowser()
      return { status: 'operativo', latenciaMs }
    } catch {
      const latenciaMs = Date.now() - startTime
      await this.closeBrowser()
      return { status: 'caido', latenciaMs }
    }
  }

  /**
   * Procesa un reembolso completo: login → subir boleta → obtener folio.
   *
   * @param task Datos del reembolso a procesar.
   * @param credenciales Credenciales descifradas de la Isapre.
   */
  async procesarReembolso(
    task: ReembolsoTask,
    credenciales: CredencialesDescifradas,
  ): Promise<ResultadoReembolso> {
    try {
      await this.launchBrowser()

      // Paso 1: Login
      const loginOk = await this.login(credenciales)
      if (!loginOk) {
        await this.closeBrowser()
        return {
          success: false,
          error: 'No se pudo iniciar sesión en la sucursal virtual. Verifica tus credenciales.',
        }
      }

      // Paso 2: Subir boleta
      const resultado = await this.subirBoleta(task)

      await this.closeBrowser()
      return resultado
    } catch (error) {
      await this.closeBrowser()
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Error inesperado en el RPA',
      }
    }
  }
}
