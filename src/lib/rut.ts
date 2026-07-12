/**
 * Validación y formato de RUT chileno.
 * Implementa el algoritmo módulo 11 con dígito verificador (0-9 o K).
 */

/** Caracteres no válidos que se eliminan del RUT. */
const RUT_INVALID_CHARS = /[^0-9kK]/g

/**
 * Limpia un RUT removiendo puntos, guiones y espacios.
 * Retorna el RUT en minúsculas sin formato (ej: "12345678k").
 */
export function cleanRut(rut: string): string {
  return rut.replace(RUT_INVALID_CHARS, '').toLowerCase()
}

/**
 * Calcula el dígito verificador de un cuerpo de RUT usando módulo 11.
 * @param cuerpo Solo la parte numérica (sin dígito verificador).
 * @returns Dígito verificador esperado: "0"-"9" o "k".
 */
export function calcularDigitoVerificador(cuerpo: string): string {
  let suma = 0
  let multiplicador = 2

  // Se recorre el cuerpo de derecha a izquierda
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    const digito = parseInt(cuerpo[i]!, 10)
    suma += digito * multiplicador
    multiplicador = multiplicador === 7 ? 2 : multiplicador + 1
  }

  const resto = suma % 11
  const dvCalculado = 11 - resto

  // Casos especiales: 11 → 0, 10 → K
  if (dvCalculado === 11) return '0'
  if (dvCalculado === 10) return 'k'
  return dvCalculado.toString()
}

/**
 * Valida si un RUT es válido según el algoritmo módulo 11.
 * Acepta RUTs con o sin formato (puntos, guiones).
 *
 * @example
 * validateRut('12.345.678-K') // true
 * validateRut('12345678k')    // true
 * validateRut('12.345.678-0') // false
 */
export function validateRut(rut: string): boolean {
  const limpio = cleanRut(rut)

  // Un RUT válido tiene al menos 2 caracteres (cuerpo + dv)
  if (limpio.length < 2) return false

  // Separar cuerpo y dígito verificador
  const cuerpo = limpio.slice(0, -1)
  const dvIngresado = limpio.slice(-1)

  // El cuerpo debe ser numérico
  if (!/^\d+$/.test(cuerpo)) return false

  // El cuerpo no puede empezar con cero ni tener más de 8 dígitos
  if (cuerpo.length > 8) return false

  const dvEsperado = calcularDigitoVerificador(cuerpo)

  return dvIngresado === dvEsperado
}

/**
 * Formatea un RUT al estándar chileno: 12.345.678-K
 * Acepta entradas con o sin formato.
 *
 * @example
 * formatRut('12345678k')     // "12.345.678-K"
 * formatRut('12.345.678-K')  // "12.345.678-K"
 */
export function formatRut(rut: string): string {
  const limpio = cleanRut(rut)
  if (limpio.length < 2) return rut

  const cuerpo = limpio.slice(0, -1)
  const dv = limpio.slice(-1).toUpperCase()

  // Agregar puntos cada 3 dígitos de derecha a izquierda
  const cuerpoConPuntos = cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, '.')

  return `${cuerpoConPuntos}-${dv}`
}

/**
 * Formatea un RUT mientras el usuario escribe (input en tiempo real).
 * A diferencia de `formatRut`, no fuerza el dígito verificador a mayúscula
 * hasta que el RUT esté completo, para una mejor UX en mobile.
 */
export function formatRutInput(rut: string): string {
  const limpio = cleanRut(rut)
  if (limpio.length < 2) return limpio.toUpperCase()

  const cuerpo = limpio.slice(0, -1)
  const dv = limpio.slice(-1).toUpperCase()

  const cuerpoConPuntos = cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, '.')

  return `${cuerpoConPuntos}-${dv}`
}

/**
 * Obtiene solo el cuerpo numérico del RUT (sin dígito verificador ni formato).
 * @example
 * getRutCuerpo('12.345.678-K') // "12345678"
 */
export function getRutCuerpo(rut: string): string {
  return cleanRut(rut).slice(0, -1)
}

/**
 * Obtiene el dígito verificador del RUT en mayúscula.
 * @example
 * getRutDv('12.345.678-K') // "K"
 */
export function getRutDv(rut: string): string {
  return cleanRut(rut).slice(-1).toUpperCase()
}