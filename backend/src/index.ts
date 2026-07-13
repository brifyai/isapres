import express, { type NextFunction, type Request, type Response } from 'express'
import cors from 'cors'
import { initDatabase } from './db.js'
import authRoutes from './routes/auth.js'
import reembolsoRoutes from './routes/reembolsos.js'
import adminRoutes from './routes/admin.js'
import webhookRoutes from './routes/webhook.js'
import demoRoutes from './routes/demo.js'

const PORT = process.env.PORT ?? 3000
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? '*'

function buildCorsOrigin() {
  if (CORS_ORIGIN === '*') {
    return '*'
  }

  const allowedOrigins = CORS_ORIGIN
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)

  return (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true)
      return
    }

    callback(new Error(`Origen no permitido por CORS: ${origin}`))
  }
}

// Inicializar base de datos
await initDatabase()

const app = express()

declare global {
  namespace Express {
    interface Request {
      rawBody?: string
    }
  }
}

// Middleware
app.use(cors({
  origin: buildCorsOrigin(),
  credentials: true,
}))
app.use(express.json({
  limit: '10mb',
  verify: (req, _res, buffer) => {
    ;(req as Request).rawBody = buffer.toString('utf8')
  },
}))
app.use(express.urlencoded({ extended: true }))

// Logging simple
app.use((req, _res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`)
  next()
})

// Rutas
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'wsp-isap-backend',
    version: '0.1.0',
    timestamp: new Date().toISOString(),
  })
})

app.use('/api/auth', authRoutes)
app.use('/api/reembolsos', reembolsoRoutes)
app.use('/api/portales', adminRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/webhook', webhookRoutes)
app.use('/api/demo', demoRoutes)

// Manejo de rutas no encontradas
app.use('/api', (_req, res) => {
  res.status(404).json({ success: false, error: 'Endpoint no encontrado' })
})

// Manejo de errores global
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Error no manejado:', err)
  res.status(500).json({ success: false, error: 'Error interno del servidor' })
})

// Iniciar servidor
app.listen(PORT, () => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`  🚀 Backend WSP-ISAP corriendo en puerto ${PORT}`)
  console.log(`  📡 API: http://localhost:${PORT}/api`)
  console.log(`  ❤️  Health: http://localhost:${PORT}/api/health`)
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
})

export default app
