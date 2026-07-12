# Infraestructura Sugerida

## Objetivo

Dejar el proyecto listo para una base productiva estable, manteniendo el menor cambio posible respecto de la implementación actual.

## Arquitectura Recomendada

- Frontend: Vercel
- Base de datos: Supabase Postgres
- Storage de documentos: Supabase Storage
- API backend: servicio Node persistente en Railway, Render, Fly.io o contenedor propio
- Worker RPA: servicio separado con Playwright en Railway, Render, Fly.io o VM
- Edge/Webhooks ligeros: Cloudflare Workers opcional

## Uso de Easy Panel

Easy Panel puede servir muy bien para esta arquitectura.

- Backend API: sí, recomendado
- Worker RPA: sí, recomendado
- Frontend Vite: opcional, aunque Vercel sigue siendo una muy buena opción
- Base de datos: no, usar Supabase

Configuración sugerida con Easy Panel:

- Un servicio para `backend`
- Un servicio para `rpa`
- Variables de entorno separadas por servicio
- Healthcheck HTTP para backend
- Reinicio automático para worker RPA
- Volúmenes persistentes solo si luego agregas cachés o artefactos; la base no debe vivir ahí

## Qué Sí Puede Hacer Cloudflare

Cloudflare puede servir muy bien para:

- Recibir webhooks públicos
- Validar firmas y rate limiting
- Encolar eventos
- Ejecutar cron livianos
- Exponer endpoints edge de baja latencia

## Qué No Conviene Mover a Cloudflare Workers

No conviene mover el worker RPA actual a Cloudflare Workers porque:

- El flujo usa Playwright con navegador real
- El proceso actual es persistente y sondea cola continuamente
- Requiere sesiones largas y control de navegador

Cloudflare puede ser la capa de entrada, pero el procesamiento RPA debería quedar en un worker dedicado.

## Fase 1 Recomendada

1. Migrar SQLite a Supabase Postgres.
2. Mantener frontend, backend y RPA separados.
3. Cambiar backend y RPA para usar `DATABASE_URL`.
4. Mover documentos a Supabase Storage.
5. Desplegar frontend en Vercel.
6. Desplegar backend y RPA en un runtime persistente.

## Variables de Entorno Base

### Frontend

- `VITE_API_URL`
- `VITE_PUBLIC_APP_URL`
- `VITE_SUPABASE_URL` opcional para futuras integraciones cliente
- `VITE_SUPABASE_ANON_KEY` opcional para futuras integraciones cliente

### Backend

- `PORT`
- `CORS_ORIGIN`
- `DATABASE_URL`
- `JWT_SECRET`
- `ENCRYPTION_KEY`
- `ADMIN_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_STORAGE_BUCKET_REEMBOLSOS`

### Worker RPA

- `DATABASE_URL`
- `ENCRYPTION_KEY`
- `HEADLESS`
- `RPA_WORKER_ID`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_STORAGE_BUCKET_REEMBOLSOS`

## SQL Inicial

El esquema inicial sugerido quedó en `supabase/schema.sql`.

## Nota de Compatibilidad

El SQL fue diseñado para preservar los nombres de tablas y columnas ya usados por el proyecto:

- `usuarios`
- `credenciales_isapre`
- `reembolsos`
- `portales_status`

Eso permite migrar con menos cambios de código en backend y worker.
