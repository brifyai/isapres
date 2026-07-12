# Despliegue de Produccion

## Resumen de Arquitectura

- `frontend`: Vercel
- `backend`: Easy Panel
- `rpa`: Easy Panel
- `database`: Supabase Postgres
- `storage`: Supabase Storage
- `cloudflare`: opcional para proxy, DNS, WAF y webhooks edge

## 1. Supabase

### Crear base de datos

- Crea un proyecto en Supabase.
- Entra al SQL Editor.
- Ejecuta completo `supabase/schema.sql`.

### Storage recomendado

- Crea un bucket llamado `reembolsos`.
- Déjalo privado si luego vas a firmar URLs desde backend.
- Déjalo público solo para pruebas si quieres avanzar más rápido.

### Variables que debes copiar

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `DATABASE_URL`

Usa preferentemente la cadena `Session pooler` para `DATABASE_URL`.

## 2. Backend en Easy Panel

### Crear servicio

- Tipo: App desde Dockerfile
- Directorio: `backend`
- Dockerfile: `backend/Dockerfile`
- Puerto interno: `3000`

### Variables requeridas

- `PORT=3000`
- `CORS_ORIGIN=https://tu-frontend.vercel.app`
- `PUBLIC_APP_URL=https://tu-frontend.vercel.app`
- `DATABASE_URL=...`
- `JWT_SECRET=...`
- `ENCRYPTION_KEY=...`
- `ADMIN_KEY=...`
- `SUPABASE_URL=...`
- `SUPABASE_SERVICE_ROLE_KEY=...`
- `SUPABASE_STORAGE_BUCKET_REEMBOLSOS=reembolsos`

### Healthcheck

- Ruta: `/api/health`
- Puerto: `3000`

### Dominio sugerido

- `api.tudominio.com`

## 3. Worker RPA en Easy Panel

### Crear servicio

- Tipo: App desde Dockerfile
- Directorio: `rpa`
- Dockerfile: `rpa/Dockerfile`
- Puerto interno: `3210`

### Variables requeridas

- `DATABASE_URL=...`
- `ENCRYPTION_KEY=...`
- `HEADLESS=true`
- `RPA_WORKER_ID=rpa-prod-01`
- `RPA_HEALTH_PORT=3210`
- `SUPABASE_URL=...`
- `SUPABASE_SERVICE_ROLE_KEY=...`
- `SUPABASE_STORAGE_BUCKET_REEMBOLSOS=reembolsos`

### Healthcheck

- Ruta: `/healthz`
- Puerto: `3210`

### Escalado

- Inicia con una sola réplica.
- Si luego escalas a varias réplicas, el lock de `reembolsos.locked_at` y `worker_id` ya ayuda a repartir trabajo.

## 4. Frontend en Vercel

### Crear proyecto

- Root directory: repositorio raíz
- Framework: Vite
- Build command: `npm run build`
- Output directory: `dist`

### Variable requerida

- `VITE_API_URL=https://api.tudominio.com/api`
- `VITE_PUBLIC_APP_URL=https://app.tudominio.com`

### Dominio sugerido

- `app.tudominio.com`

## 5. Cloudflare

### Uso recomendado

- DNS de `app.tudominio.com` y `api.tudominio.com`
- Proxy y WAF
- Reglas básicas de seguridad
- Rate limiting para webhooks públicos

### Uso opcional más adelante

- Cloudflare Worker para recibir webhooks de WhatsApp y reenviarlos al backend
- Validación de firma y filtros antes de llegar al backend

## 6. Checklist de salida

- SQL ejecutado en Supabase
- Bucket `reembolsos` creado
- Backend levantado y respondiendo `/api/health`
- Worker levantado y respondiendo `/healthz`
- Frontend desplegado con `VITE_API_URL` apuntando al backend real
- `CORS_ORIGIN` del backend configurado con el dominio real del frontend
- `ENCRYPTION_KEY` idéntica en backend y rpa

## 7. Variables por plataforma

### Vercel

- `VITE_API_URL`
- `VITE_PUBLIC_APP_URL`

### Easy Panel Backend

- `PORT`
- `CORS_ORIGIN`
- `PUBLIC_APP_URL`
- `DATABASE_URL`
- `JWT_SECRET`
- `ENCRYPTION_KEY`
- `ADMIN_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_STORAGE_BUCKET_REEMBOLSOS`

### Easy Panel RPA

- `DATABASE_URL`
- `ENCRYPTION_KEY`
- `HEADLESS`
- `RPA_WORKER_ID`
- `RPA_HEALTH_PORT`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_STORAGE_BUCKET_REEMBOLSOS`
