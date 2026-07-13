# Sistema de Automatización de Reembolsos Isapres vía WhatsApp

## Descripción General

El objetivo es desarrollar un sistema automatizado que permita a un usuario gestionar el proceso de solicitud de reembolso de su Isapre directamente desde WhatsApp.

El usuario se comunicará mediante WhatsApp (integrado con Kapso) y el sistema será capaz de:

- Identificar al usuario.
- Registrar sus datos.
- Solicitar consentimiento.
- Obtener sus credenciales de acceso.
- Ingresar automáticamente al portal de su Isapre utilizando Playwright.
- Detectar autenticaciones adicionales (OTP, SMS, correo, etc.).
- Navegar hasta la sección de Solicitud de Reembolso.
- Identificar las distintas prestaciones disponibles.
- Detectar cuál requiere completar un formulario.
- Solicitar al usuario los datos necesarios para completar dicho formulario.
- Completar el formulario (sin enviarlo).
- Registrar absolutamente todo el proceso.
- Cerrar la sesión de forma segura.
- Informar al usuario que el proceso fue completado correctamente.

---

# Objetivo del Demo (MVP)

El objetivo inicial **NO** es enviar reembolsos reales.

El objetivo es demostrar que el sistema es capaz de:

- Ingresar correctamente a distintas Isapres.
- Navegar automáticamente.
- Detectar los distintos módulos.
- Identificar formularios.
- Completar formularios.
- Registrar el flujo completo.

Todo esto servirá como base para posteriormente automatizar el envío real del reembolso.

---

# Tecnologías

## WhatsApp

- Kapso

Será el canal principal de comunicación con el usuario.

---

## IA

OpenAI API

Será utilizada para:

- Gestión de estados conversacionales.
- Interpretación de respuestas.
- Clasificación de mensajes.
- Extracción de información.
- Asistencia durante la navegación.
- Automatización inteligente del flujo.

---

## Automatización Web

Playwright

Responsable de:

- Login.
- Navegación.
- Scraping.
- Detección de elementos.
- Capturas.
- Formularios.
- Subida de archivos (en futuras versiones).

---

## Base de Datos

Supabase

Será utilizada para almacenar:

- Usuarios
- Conversaciones
- Credenciales cifradas
- Estados
- Isapres
- OTP
- Logs
- Procesos
- Navegación
- Capturas
- Formularios
- Campos
- Errores
- Auditoría

---

# Flujo General

```
Usuario

↓

WhatsApp (Kapso)

↓

IA

↓

Supabase

↓

Playwright

↓

Portal Isapre

↓

Registro completo del proceso

↓

Respuesta al usuario
```

---

# Flujo Conversacional

## 1. Inicio

El usuario escribe por WhatsApp.

Ejemplo:

> Hola

El sistema verifica si el teléfono existe.

Si no existe:

Comienza proceso de enrolamiento.

---

# Etapa 1 - Identificación

Solicitar:

- Nombre
- Teléfono (ya disponible desde WhatsApp)
- Isapre

Guardar inmediatamente en la base de datos.

---

# Etapa 2 - Consentimiento

Antes de ingresar a la Isapre el sistema debe informar:

- Que accederá a su cuenta.
- Que podría solicitarse un código de verificación.
- Que deberá estar atento a WhatsApp.
- Que sus datos serán tratados de forma segura.

El usuario debe aceptar.

Si rechaza:

Finalizar conversación.

---

# Etapa 3 - Solicitud de Credenciales

Solicitar:

Usuario

Contraseña

Guardar ambos datos cifrados.

Nunca almacenar contraseñas en texto plano.

---

# Etapa 4 - Login

Playwright abre el sitio correspondiente según la Isapre.

Ejemplo:

Banmédica

El sistema deberá:

- Abrir portal
- Completar usuario
- Completar contraseña
- Iniciar sesión

---

# Detección de OTP

Muchas Isapres solicitan:

- SMS
- Email
- Aplicación
- Código temporal

El sistema deberá detectar automáticamente esta situación.

Cuando ocurra:

Enviar inmediatamente un mensaje por WhatsApp.

Ejemplo:

> Hemos detectado que tu Isapre solicita un código de verificación. Por favor escríbelo aquí para continuar.

El usuario responde.

Playwright continúa el proceso.

---

# Navegación

Una vez autenticado.

Buscar automáticamente el módulo:

Reembolsos

Luego buscar:

Solicitar Reembolso

Cada clic deberá registrarse.

---

# Registro de Navegación

Guardar:

- Botón presionado
- URL
- Tiempo
- Captura
- Paso actual
- Resultado

Todo el recorrido debe quedar almacenado.

---

# Selección de Beneficiario

Detectar:

Beneficiario.

Registrar:

- Opciones disponibles.
- Beneficiario seleccionado.

---

# Prestaciones

Ejemplo Banmédica.

Prestaciones detectadas:

- Consultas Médicas y Atenciones Psicológicas
- Exámenes
- Imagenología
- Procedimientos y Otros
- Urgencias Médicas
- Óptica
- Kinesiología
- Fonoaudiología

El sistema debe ser capaz de recorrer todas.

---

# Caso 1

La prestación solicita únicamente subir voucher.

En el demo:

Responder al usuario:

> Próximamente podrás subir automáticamente el voucher desde WhatsApp.

Luego continuar explorando otra prestación.

---

# Caso 2

La prestación requiere formulario.

Ejemplo:

Urgencias Médicas

Solicita:

## Centro Médico

Solicitar al usuario.

Guardar.

Completar.

---

## Información de Pago

Solicitar.

Guardar.

Completar.

---

## Adjuntos

Solicita:

- Boleta
- Voucher
- Detalle

En esta etapa del demo no se subirán archivos.

Solo registrar que fueron detectados.

---

# Formularios Dinámicos

No asumir que todas las Isapres poseen el mismo formulario.

Playwright deberá detectar:

- Inputs
- Selects
- Radios
- Checkboxes
- Textareas

Por cada campo encontrado deberá guardar:

- Nombre
- Label
- Tipo
- Obligatorio
- Valor ingresado

Posteriormente la IA preguntará al usuario cada dato.

Ejemplo:

Sistema:

¿Cuál fue el centro médico?

Usuario:

Clínica Santa María

Sistema:

¿Cuánto pagaste?

Usuario:

35.000

Etc.

---

# Finalización

Cuando todos los campos estén completos.

NO enviar el formulario.

Simplemente:

- Registrar éxito.
- Cerrar sesión.
- Finalizar navegador.

Responder:

> Tu proceso fue registrado correctamente. Un administrador podrá revisar toda la información posteriormente.

---

# Registro Completo

Cada proceso deberá generar un historial completo.

Ejemplo:

```
Usuario

↓

Login

↓

OTP

↓

Ingreso exitoso

↓

Menú encontrado

↓

Reembolsos

↓

Solicitar Reembolso

↓

Prestaciones detectadas

↓

Formulario encontrado

↓

Campos completados

↓

Proceso finalizado
```

---

# Capturas

Guardar capturas durante:

- Login
- OTP
- Menú
- Reembolsos
- Formularios
- Resultado

---

# Logs

Registrar:

- Hora
- Usuario
- Acción
- Resultado
- Error
- Captura
- Tiempo

---

# Base de Datos (Supabase)

Se espera que el sistema diseñe toda la estructura SQL necesaria.

Como mínimo considerar tablas para:

## Usuarios

Información básica del usuario.

---

## Conversaciones

Historial completo de WhatsApp.

---

## Isapres

Listado de Isapres soportadas.

---

## Credenciales

Credenciales cifradas.

---

## Procesos

Cada ejecución completa.

---

## Estados

Estado actual del flujo.

---

## OTP

Códigos de verificación.

---

## Navegación

Todos los clics realizados.

---

## Capturas

Screenshots.

---

## Formularios

Formularios detectados.

---

## CamposFormulario

Cada campo encontrado automáticamente.

---

## RespuestasFormulario

Valores entregados por el usuario.

---

## Logs

Registro técnico.

---

## Auditoría

Eventos importantes.

---

# Arquitectura Esperada

```
WhatsApp (Kapso)

↓

Webhook

↓

API Backend

↓

OpenAI

↓

Supabase

↓

Playwright

↓

Portal Isapre
```

---

# Consideraciones Futuras

El sistema debe diseñarse pensando en futuras funcionalidades como:

- Subida automática de vouchers.
- Procesamiento OCR.
- Extracción de datos desde boletas.
- Clasificación automática de prestaciones.
- Envío real del formulario.
- Compatibilidad con múltiples Isapres.
- Manejo de múltiples cuentas por usuario.
- Panel administrativo.
- Reintentos automáticos.
- Monitoreo en tiempo real.
- Dashboard de procesos.
- Notificaciones automáticas.

---

# Objetivo para ChatGPT

Se espera que ChatGPT genere una solución completa que incluya:

- Arquitectura del sistema.
- Diseño modular.
- Backend.
- Base de datos (SQL para Supabase).
- Modelado de tablas y relaciones.
- Flujo conversacional.
- Gestión de estados.
- Integración con Kapso.
- Integración con OpenAI.
- Integración con Playwright.
- Manejo de errores.
- Registro de auditoría.
- Sistema de logs.
- Seguridad para credenciales.
- Estructura del proyecto.
- Buenas prácticas.
- Escalabilidad.
- Código limpio y desacoplado.

El resultado debe ser una base sólida para evolucionar posteriormente hacia un sistema completamente automatizado de gestión de reembolsos para distintas Isapres desde WhatsApp.