import http from 'node:http'
import { getScraper } from './scrapers/index.js'
import { execute, query, queryOne } from './db.js'
import { decrypt } from './crypto.js'
import type {
  CredencialesDescifradas,
  IsapreId,
  ProcesoCampoRegistro,
  ProcesoDemoTask,
  ProcesoPasoRegistro,
  ReembolsoTask,
} from './types.js'
import { BanmedicaScraper } from './scrapers/banmedica.js'

const POLL_INTERVAL_MS = 10000 // 10 segundos
const MAX_INTENTOS = 5
const LOCK_TIMEOUT_MINUTES = 15
const WORKER_ID = process.env.RPA_WORKER_ID ?? `rpa-${process.pid}`
const RPA_HEALTH_PORT = Number.parseInt(process.env.RPA_HEALTH_PORT ?? '3210', 10)

let lastLoopAt = new Date().toISOString()
let lastSuccessfulLoopAt: string | null = null
let lastErrorMessage: string | null = null

function startHealthServer(): void {
  const server = http.createServer((req, res) => {
    if (req.url !== '/healthz' && req.url !== '/readyz') {
      res.statusCode = 404
      res.end('Not Found')
      return
    }

    const payload = {
      status: 'ok',
      service: 'wsp-isap-rpa',
      workerId: WORKER_ID,
      lastLoopAt,
      lastSuccessfulLoopAt,
      lastErrorMessage,
    }

    res.setHeader('Content-Type', 'application/json')
    res.statusCode = 200
    res.end(JSON.stringify(payload))
  })

  server.listen(RPA_HEALTH_PORT, '0.0.0.0', () => {
    console.log(`  ❤️  Health: http://0.0.0.0:${RPA_HEALTH_PORT}/healthz`)
  })
}

/**
 * Obtiene y bloquea reembolsos encolados para este worker.
 */
async function getReembolsosPendientes(): Promise<ReembolsoTask[]> {
  return query<ReembolsoTask>(
    `
      WITH picked AS (
        SELECT id
        FROM reembolsos
        WHERE estado = 'en_cola'
          AND intentos < $1
          AND (
            locked_at IS NULL
            OR locked_at < timezone('utc', now()) - make_interval(mins => $2)
          )
        ORDER BY created_at ASC
        LIMIT 5
      )
      UPDATE reembolsos AS r
      SET locked_at = timezone('utc', now()),
          worker_id = $3,
          updated_at = timezone('utc', now())
      FROM picked
      WHERE r.id = picked.id
      RETURNING r.id, r.usuario_id, r.rut_usuario, r.isapre, r.monto, r.url_documento, r.estado, r.intentos
    `,
    [MAX_INTENTOS, LOCK_TIMEOUT_MINUTES, WORKER_ID],
  )
}

async function getProcesosDemoPendientes(): Promise<ProcesoDemoTask[]> {
  return query<ProcesoDemoTask>(
    `
      WITH picked AS (
        SELECT id
        FROM procesos_demo
        WHERE estado = 'pendiente'
          AND intentos < $1
          AND (
            locked_at IS NULL
            OR locked_at < timezone('utc', now()) - make_interval(mins => $2)
          )
        ORDER BY created_at ASC
        LIMIT 3
      )
      UPDATE procesos_demo AS p
      SET estado = 'en_progreso',
          intentos = intentos + 1,
          locked_at = timezone('utc', now()),
          worker_id = $3,
          started_at = COALESCE(started_at, timezone('utc', now())),
          updated_at = timezone('utc', now())
      FROM picked
      WHERE p.id = picked.id
      RETURNING p.id, p.usuario_id, p.telefono, p.isapre_id, p.flujo, p.estado, p.metadata, p.intentos
    `,
    [MAX_INTENTOS, LOCK_TIMEOUT_MINUTES, WORKER_ID],
  )
}

/**
 * Obtiene las credenciales descifradas del usuario para una Isapre dada.
 */
async function getCredenciales(usuarioId: number, isapreId: IsapreId): Promise<CredencialesDescifradas | null> {
  const row = await queryOne<{ isapre_id: string; rut: string; password_encrypted: string }>(
    `
      SELECT isapre_id, rut, password_encrypted
      FROM credenciales_isapre
      WHERE usuario_id = $1 AND isapre_id = $2::isapre_id
    `,
    [usuarioId, isapreId],
  )

  if (!row) {
    console.error(`No se encontraron credenciales para usuario ${usuarioId}, isapre ${isapreId}`)
    return null
  }

  try {
    const password = decrypt(row.password_encrypted)
    return {
      isapre_id: isapreId,
      rut: row.rut,
      password,
    }
  } catch (error) {
    console.error('Error al descifrar credenciales:', error)
    return null
  }
}

/**
 * Actualiza el estado de un reembolso en la BD.
 */
async function updateReembolsoEstado(
  id: number,
  estado: string,
  opts: { folioIsapre?: string; error?: string },
): Promise<void> {
  const releaseLock = estado === 'exitoso' || estado === 'rechazado'

  await execute(
    `
      UPDATE reembolsos
      SET estado = $1::estado_solicitud,
          folio_isapre = $2,
          error = $3,
          intentos = CASE
            WHEN estado <> $1::estado_solicitud THEN intentos + 1
            ELSE intentos
          END,
          locked_at = CASE WHEN $4 THEN NULL ELSE timezone('utc', now()) END,
          worker_id = CASE WHEN $4 THEN NULL ELSE $5 END,
          updated_at = timezone('utc', now())
      WHERE id = $6
    `,
    [estado, opts.folioIsapre ?? null, opts.error ?? null, releaseLock, WORKER_ID, id],
  )
}

async function updateProcesoDemoEstado(
  id: number,
  estado: 'en_progreso' | 'completado' | 'fallido',
  opts: { resumen?: string; error?: string },
): Promise<void> {
  const releaseLock = estado === 'completado' || estado === 'fallido'

  await execute(
    `
      UPDATE procesos_demo
      SET estado = $1::estado_proceso_demo,
          resumen = COALESCE($2, resumen),
          error = $3,
          locked_at = CASE WHEN $4 THEN NULL ELSE timezone('utc', now()) END,
          worker_id = CASE WHEN $4 THEN NULL ELSE $5 END,
          finished_at = CASE WHEN $4 THEN timezone('utc', now()) ELSE finished_at END,
          updated_at = timezone('utc', now())
      WHERE id = $6
    `,
    [estado, opts.resumen ?? null, opts.error ?? null, releaseLock, WORKER_ID, id],
  )
}

async function recordProcesoStep(
  procesoId: number,
  step: ProcesoPasoRegistro,
): Promise<void> {
  await execute(
    `
      INSERT INTO proceso_pasos (
        proceso_id,
        orden,
        etapa,
        accion,
        detalle,
        url,
        selector,
        status,
        payload
      )
      SELECT
        $1,
        COALESCE(MAX(orden), 0) + 1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8::jsonb
      FROM proceso_pasos
      WHERE proceso_id = $1
    `,
    [
      procesoId,
      step.etapa,
      step.accion,
      step.detalle ?? null,
      step.url ?? null,
      step.selector ?? null,
      step.status ?? 'info',
      JSON.stringify(step.payload ?? {}),
    ],
  )
}

async function upsertProcesoField(
  procesoId: number,
  field: ProcesoCampoRegistro,
): Promise<void> {
  await execute(
    `
      INSERT INTO proceso_campos (
        proceso_id,
        campo_key,
        label,
        tipo,
        selector,
        requerido,
        valor_ingresado,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
      ON CONFLICT (proceso_id, campo_key) DO UPDATE SET
        label = EXCLUDED.label,
        tipo = EXCLUDED.tipo,
        selector = COALESCE(EXCLUDED.selector, proceso_campos.selector),
        requerido = EXCLUDED.requerido,
        valor_ingresado = COALESCE(EXCLUDED.valor_ingresado, proceso_campos.valor_ingresado),
        metadata = EXCLUDED.metadata,
        updated_at = timezone('utc', now())
    `,
    [
      procesoId,
      field.campoKey,
      field.label,
      field.tipo,
      field.selector ?? null,
      field.requerido ?? false,
      field.valorIngresado ?? null,
      JSON.stringify(field.metadata ?? {}),
    ],
  )
}

/**
 * Procesa un reembolso individual.
 */
async function procesarReembolso(task: ReembolsoTask): Promise<void> {
  console.log(`\n━━━ Procesando reembolso #${task.id} (${task.isapre}) ━━━`)

  await updateReembolsoEstado(task.id, 'procesando_ocr', {})

  const credenciales = await getCredenciales(task.usuario_id, task.isapre)
  if (!credenciales) {
    await updateReembolsoEstado(task.id, 'rechazado', {
      error: 'No se encontraron credenciales de Isapre configuradas',
    })
    console.log(`❌ Reembolso #${task.id}: Sin credenciales`)
    return
  }

  await updateReembolsoEstado(task.id, 'iniciando_sesion', {})

  try {
    const scraper = getScraper(task.isapre)

    await updateReembolsoEstado(task.id, 'subiendo_boleta', {})

    const resultado = await scraper.procesarReembolso(task, credenciales)

    if (resultado.success) {
      await updateReembolsoEstado(task.id, 'exitoso', {
        folioIsapre: resultado.folioIsapre,
      })
      console.log(`✅ Reembolso #${task.id}: Exitoso${resultado.folioIsapre ? ` (Folio: ${resultado.folioIsapre})` : ''}`)
    } else {
      await updateReembolsoEstado(task.id, 'rechazado', {
        error: resultado.error ?? 'Error desconocido',
      })
      console.log(`❌ Reembolso #${task.id}: ${resultado.error}`)
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Error inesperado'
    await updateReembolsoEstado(task.id, 'rechazado', { error: errorMsg })
    console.log(`❌ Reembolso #${task.id}: ${errorMsg}`)
  }
}

async function procesarProcesoDemo(task: ProcesoDemoTask): Promise<void> {
  console.log(`\n━━━ Procesando demo #${task.id} (${task.isapre_id}) ━━━`)

  await recordProcesoStep(task.id, {
    etapa: 'worker',
    accion: 'worker_toma_proceso',
    detalle: `Worker ${WORKER_ID} toma el proceso demo`,
    status: 'info',
  })

  const credenciales = await getCredenciales(task.usuario_id, task.isapre_id)
  if (!credenciales) {
    await recordProcesoStep(task.id, {
      etapa: 'worker',
      accion: 'credenciales_no_encontradas',
      detalle: 'No se encontraron credenciales para ejecutar el demo',
      status: 'error',
    })
    await updateProcesoDemoEstado(task.id, 'fallido', {
      error: 'No se encontraron credenciales para ejecutar el demo',
      resumen: 'Proceso demo fallido por falta de credenciales',
    })
    return
  }

  try {
    const scraper = getScraper(task.isapre_id)
    const prestacionCodigo = String(task.metadata?.prestacionCodigo ?? '')
    const isBanmedicaDemo =
      task.isapre_id === 'banmedica'
      && ['urgencias_medicas', 'consultas_psicologia'].includes(prestacionCodigo)

    if (!(scraper instanceof BanmedicaScraper) || !isBanmedicaDemo) {
      throw new Error('No existe un scraper demo configurado para este flujo')
    }

    const result = await scraper.procesarDemoPrestacion(task, credenciales, {
      recordStep: async (step) => recordProcesoStep(task.id, step),
      upsertField: async (field) => upsertProcesoField(task.id, field),
    })

    if (result.success) {
      await updateProcesoDemoEstado(task.id, 'completado', {
        resumen: `Proceso ${task.metadata?.prestacionNombre ?? 'demo'} completado. Navegación Banmédica registrada sin envío final.`,
      })
      console.log(`✅ Demo #${task.id}: completado`)
    } else {
      await updateProcesoDemoEstado(task.id, 'fallido', {
        error: result.error ?? 'Error desconocido en el proceso demo',
        resumen: 'Demo Banmedica fallido durante la navegacion automatizada',
      })
      console.log(`❌ Demo #${task.id}: ${result.error}`)
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Error inesperado'
    await recordProcesoStep(task.id, {
      etapa: 'worker',
      accion: 'error_worker',
      detalle: errorMsg,
      status: 'error',
    })
    await updateProcesoDemoEstado(task.id, 'fallido', {
      error: errorMsg,
      resumen: 'Demo Banmedica fallido por error no controlado',
    })
    console.log(`❌ Demo #${task.id}: ${errorMsg}`)
  }
}

/**
 * Verifica el estado de todos los portales y actualiza la BD.
 */
async function checkPortales(): Promise<void> {
  console.log('\n━━━ Verificando estado de portales ━━━')

  const isapres: IsapreId[] = ['colmena', 'banmedica', 'consalud', 'cruzblanca', 'nueva_masvida', 'vida_tres', 'esencial']

  for (const isapreId of isapres) {
    try {
      const scraper = getScraper(isapreId)
      const { status, latenciaMs } = await scraper.checkPortalStatus()

      await execute(
        `
          UPDATE portales_status
          SET status = $1::portal_status,
              latencia_ms = $2,
              ultima_ejecucion_exitosa = CASE
                WHEN $1 = 'operativo' THEN timezone('utc', now())
                ELSE ultima_ejecucion_exitosa
              END,
              mensaje_error = CASE
                WHEN $1 = 'operativo' THEN NULL
                ELSE $3
              END,
              updated_at = timezone('utc', now())
          WHERE isapre_id = $4::isapre_id
        `,
        [status, latenciaMs, status === 'operativo' ? null : `Portal ${status}`, isapreId],
      )

      const icon = status === 'operativo' ? '🟢' : '🔴'
      console.log(`${icon} ${isapreId}: ${status} (${latenciaMs}ms)`)
    } catch (error) {
      console.error(`Error verificando ${isapreId}:`, error)
    }
  }
}

/**
 * Bucle principal del worker.
 * Sondea la BD cada POLL_INTERVAL_MS buscando reembolsos encolados.
 */
async function startWorker(): Promise<void> {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('  🤖 RPA Worker WSP-ISAP iniciado')
  console.log(`  🆔 Worker ID: ${WORKER_ID}`)
  console.log(`  ⏱️  Poll interval: ${POLL_INTERVAL_MS}ms`)
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  startHealthServer()

  let checkPortalesCounter = 0
  const CHECK_PORTALES_EVERY = 6 // Verificar portales cada 6 ciclos (~1 min)

  while (true) {
    try {
      lastLoopAt = new Date().toISOString()
      if (checkPortalesCounter % CHECK_PORTALES_EVERY === 0) {
        await checkPortales()
      }
      checkPortalesCounter++

      const demoTasks = await getProcesosDemoPendientes()
      if (demoTasks.length > 0) {
        console.log(`\n🧪 ${demoTasks.length} proceso(s) demo pendiente(s)`)
        for (const task of demoTasks) {
          await procesarProcesoDemo(task)
        }
      }

      const tasks = await getReembolsosPendientes()

      if (tasks.length > 0) {
        console.log(`\n📋 ${tasks.length} reembolso(s) pendiente(s) en cola`)

        for (const task of tasks) {
          await procesarReembolso(task)
        }
      }

      lastSuccessfulLoopAt = new Date().toISOString()
      lastErrorMessage = null
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
    } catch (error) {
      console.error('Error en bucle del worker:', error)
      lastErrorMessage = error instanceof Error ? error.message : 'Error desconocido'
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
    }
  }
}

startWorker().catch((error) => {
  console.error('Error fatal en worker:', error)
  process.exit(1)
})
