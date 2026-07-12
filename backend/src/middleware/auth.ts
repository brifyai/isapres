import type { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import type { ApiResponse } from '../types.js'

const JWT_SECRET = process.env.JWT_SECRET ?? 'wsp-isap-dev-secret-change-in-production'
const JWT_EXPIRES_IN = '7d'

export interface JwtPayload {
  userId: number
  telefono: string
}

/**
 * Genera un token JWT para un usuario.
 */
export function generateToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN })
}

/**
 * Verifica un token JWT y extrae el payload.
 */
export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload
  } catch {
    return null
  }
}

/**
 * Middleware que requiere autenticación (JWT válido).
 */
export function requireAuth(req: Request, res: Response<ApiResponse<null>>, next: NextFunction): void {
  const authHeader = req.headers.authorization

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Token no proporcionado' })
    return
  }

  const token = authHeader.substring(7)
  const payload = verifyToken(token)

  if (!payload) {
    res.status(401).json({ success: false, error: 'Token inválido o expirado' })
    return
  }

  ;(req as Request & { userId?: number }).userId = payload.userId
  next()
}

/**
 * Middleware que requiere autenticación de admin.
 */
export function requireAdmin(req: Request, res: Response<ApiResponse<null>>, next: NextFunction): void {
  const adminKey = req.headers['x-admin-key'] as string | undefined
  const expectedKey = process.env.ADMIN_KEY ?? 'wsp-isap-admin-dev-key'

  if (!adminKey || adminKey !== expectedKey) {
    res.status(403).json({ success: false, error: 'Acceso denegado. Se requiere clave de administrador.' })
    return
  }

  next()
}