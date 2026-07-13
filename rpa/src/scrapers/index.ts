import { BaseScraper } from '../base-scraper.js'
import type { ScraperConfig, IsapreId } from '../types.js'
import { BanmedicaScraper } from './banmedica.js'

/**
 * Configuraciones de los 7 scrapers de Isapres.
 * Los selectores CSS deben actualizarse según el HTML real de cada portal.
 * Estas son configuraciones base que pueden requerir ajustes tras pruebas.
 */

const configs: Record<IsapreId, ScraperConfig> = {
  colmena: {
    isapreId: 'colmena',
    nombre: 'Colmena',
    urlLogin: 'https://www.colmena.cl/beneficiario/',
    urlReembolso: 'https://www.colmena.cl/beneficiario/reembolsos/solicitar',
    selectores: {
      inputRut: '#rut',
      inputPassword: '#password',
      btnLogin: '#btn-login',
      loginSuccessIndicator: '.dashboard-beneficiario',
      loginErrorIndicator: '.error-login',
      inputBoleta: 'input[type="file"][name="boleta"]',
      inputMonto: '#monto-reembolso',
      btnEnviar: '#btn-enviar-reembolso',
      folioResultado: '.folio-reembolso',
    },
  },

  banmedica: {
    isapreId: 'banmedica',
    nombre: 'Banmédica',
    urlLogin: 'https://login.isaprebanmedica.cl/login',
    urlReembolso: 'https://login.isaprebanmedica.cl/login',
    selectores: {
      inputRut: '#rut',
      inputPassword: '#current-password',
      btnLogin: 'button[type="submit"]',
      loginSuccessIndicator: 'ul.items',
      loginErrorIndicator: 'small',
    },
  },

  consalud: {
    isapreId: 'consalud',
    nombre: 'Consalud',
    urlLogin: 'https://www.consalud.cl/portal-beneficiario/',
    urlReembolso: 'https://www.consalud.cl/portal-beneficiario/reembolsos/nuevo',
    selectores: {
      inputRut: '#txtRut',
      inputPassword: '#txtClave',
      btnLogin: '#btnIngresar',
      loginSuccessIndicator: '.portal-beneficiario-home',
      loginErrorIndicator: '.alert-danger',
      inputBoleta: '#fileBoleta',
      inputMonto: '#txtMonto',
      btnEnviar: '#btnEnviarReembolso',
      folioResultado: '.folio-generado',
    },
  },

  cruzblanca: {
    isapreId: 'cruzblanca',
    nombre: 'CruzBlanca',
    urlLogin: 'https://www.cruzblanca.cl/sucursal-virtual/',
    urlReembolso: 'https://www.cruzblanca.cl/sucursal-virtual/reembolsos',
    selectores: {
      inputRut: '#rut',
      inputPassword: '#clave',
      btnLogin: '.btn-ingresar',
      loginSuccessIndicator: '.sucursal-virtual-home',
      loginErrorIndicator: '.error-message',
      inputBoleta: 'input[type="file"][accept=".pdf,.jpg,.png"]',
      inputMonto: '#monto-reembolso',
      btnEnviar: '.btn-solicitar-reembolso',
      folioResultado: '.folio-comprobante',
    },
  },

  nueva_masvida: {
    isapreId: 'nueva_masvida',
    nombre: 'Nueva Masvida',
    urlLogin: 'https://www.nuevamasvida.cl/sucursal/',
    urlReembolso: 'https://www.nuevamasvida.cl/sucursal/reembolsos/solicitar',
    selectores: {
      inputRut: '#form_rut',
      inputPassword: '#form_password',
      btnLogin: '#btn_submit',
      loginSuccessIndicator: '.sucursal-home',
      loginErrorIndicator: '.login-error',
      inputBoleta: '#boleta-file',
      inputMonto: '#monto-input',
      btnEnviar: '#submit-reembolso',
      folioResultado: '.resultado-folio',
    },
  },

  vida_tres: {
    isapreId: 'vida_tres',
    nombre: 'Vida Tres',
    urlLogin: 'https://www.vidatres.cl/sucursal-virtual/',
    urlReembolso: 'https://www.vidatres.cl/sucursal-virtual/reembolsos',
    selectores: {
      inputRut: '#rut-usuario',
      inputPassword: '#clave-usuario',
      btnLogin: '#btn-ingresar',
      loginSuccessIndicator: '.panel-beneficiario',
      loginErrorIndicator: '.alert-error',
      inputBoleta: 'input[type="file"][name="documento"]',
      inputMonto: '#monto-solicitud',
      btnEnviar: '#btn-solicitar',
      folioResultado: '.nro-folio',
    },
  },

  esencial: {
    isapreId: 'esencial',
    nombre: 'Esencial',
    urlLogin: 'https://www.esencial.cl/mi-cuenta/',
    urlReembolso: 'https://www.esencial.cl/mi-cuenta/reembolsos/nuevo',
    selectores: {
      inputRut: '#rut',
      inputPassword: '#password',
      btnLogin: '.login-button',
      loginSuccessIndicator: '.cuenta-home',
      loginErrorIndicator: '.login-error-msg',
      inputBoleta: '#documento-boleta',
      inputMonto: '#monto',
      btnEnviar: '.btn-reembolso',
      folioResultado: '.folio-respuesta',
    },
  },
}

/**
 * Factory que retorna el scraper correcto para una Isapre dada.
 */
export function getScraper(isapreId: IsapreId): BaseScraper {
  if (isapreId === 'banmedica') {
    return new BanmedicaScraper()
  }

  const config = configs[isapreId]
  if (!config) {
    throw new Error(`No hay scraper configurado para la Isapre: ${isapreId}`)
  }

  // Crear una instancia anónima que extiende BaseScraper
  // con la configuración específica de la Isapre
  return new (class extends BaseScraper {
    constructor() {
      super(config)
    }
  })()
}

/** Lista de todas las Isapres con su configuración. */
export const ALL_SCRAPERS = Object.values(configs)
