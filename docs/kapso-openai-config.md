# Configuración Kapso + OpenAI

Este proyecto ya queda preparado para un flujo conversacional real por WhatsApp usando Kapso como proveedor de canal y OpenAI como capa de interpretación.

## Variables backend

Configura estas variables en el servicio `backend`:

```env
PORT=3000
CORS_ORIGIN=https://tu-frontend.vercel.app
PUBLIC_APP_URL=https://tu-frontend.vercel.app
DATABASE_URL=postgresql://...
JWT_SECRET=...
ENCRYPTION_KEY=...
ADMIN_KEY=...

KAPSO_API_BASE_URL=https://api.kapso.ai/meta/whatsapp/v24.0
KAPSO_API_KEY=...
KAPSO_PHONE_NUMBER_ID=...
KAPSO_WEBHOOK_SECRET=...

WHATSAPP_ENTRY_URL=https://wa.me/569XXXXXXXX?text=Hola
WHATSAPP_PHONE=569XXXXXXXX

OPENAI_API_KEY=...
OPENAI_MODEL=gpt-4.1-mini
```

## Webhook Kapso

Configura el webhook de Kapso apuntando a:

```text
POST https://tu-backend-publico/api/webhook/whatsapp
```

El backend ya soporta:

- Verificación por firma `X-Webhook-Signature`
- Idempotencia por `X-Idempotency-Key`
- Lectura de `X-Webhook-Event`
- Eventos de mensajes entrantes y estados de conversación/mensajes

## Eventos esperados

Habilita al menos estos eventos de Kapso:

- `whatsapp.message.received`
- `whatsapp.message.sent`
- `whatsapp.message.delivered`
- `whatsapp.message.read`
- `whatsapp.message.failed`
- `whatsapp.conversation.created`
- `whatsapp.conversation.ended`
- `whatsapp.conversation.inactive`

## Flujo actual

1. El usuario escribe por WhatsApp.
2. Kapso entrega el webhook al backend.
3. El backend identifica al usuario enrolado por teléfono.
4. Consulta la Isapre enrolada y el catálogo de prestaciones.
5. Responde por WhatsApp con menú interactivo.
6. Si la prestación requiere formulario, pregunta los campos uno a uno.
7. OpenAI ayuda a interpretar respuestas ambiguas o libres.
8. Al completar los datos, se crea un `proceso_demo`.
9. El worker RPA toma el proceso, entra a la Isapre y completa el formulario sin enviarlo.
10. Todo queda registrado en mensajes, estado conversacional, pasos y campos.

## Estado del demo actual

- Banmédica:
  - Catálogo conversacional cargado.
  - Prestación `Urgencias Médicas` implementada con formulario guiado.
  - Otras prestaciones cargadas como capa preparada para adjuntos.
- Otras Isapres:
  - Arquitectura lista para catálogo y scraper por isapre.
  - Faltan catálogos y scrapers especializados.

## Despliegue

Después de subir cambios:

1. Ejecuta `supabase/schema.sql` en tu proyecto Supabase.
2. Redeploy de `backend`.
3. Redeploy de `rpa`.
4. Redeploy de `frontend`.
5. Configura webhook y credenciales en Kapso.
6. Prueba escribiendo desde un número enrolado.

## Validación rápida

- `GET https://tu-backend/api/health`
- `POST https://tu-backend/api/webhook/whatsapp`
- Dashboard autenticado mostrando:
  - estado conversacional,
  - mensajes WhatsApp,
  - procesos demo,
  - pasos y campos del worker.
