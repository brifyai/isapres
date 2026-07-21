# Instructivo Hermes — Agente de reembolsos de Isapre por WhatsApp

Documento de contexto funcional para implementar el agente en **Hermes + Evolution API**.
Describe **qué debe hacer el agente**, no cómo desplegarlo. Empieza en el momento
en que el usuario entra a WhatsApp y termina cuando el reembolso queda cargado en
el portal de la Isapre.

> Este comportamiento ya fue construido y probado en el canal web de este repo
> (`backend/src/utils/conversation-engine.ts` + `rpa/src/scrapers/banmedica.ts`).
> Lo que sigue es la especificación destilada de esa implementación, incluidas
> las reglas que sólo aparecieron al probar contra el portal real.

---

## 1. Qué hace el sistema

Un afiliado a una Isapre chilena quiere que le reembolsen una atención médica.
Normalmente tendría que entrar a la sucursal virtual, buscar el formulario,
transcribir los datos de su boleta y subir los archivos.

Aquí, en cambio, **conversa por WhatsApp**: dice qué tipo de atención fue, manda
una foto de la boleta, y el agente hace el resto. Un robot (Playwright) entra al
portal con las credenciales del usuario, navega hasta el formulario, lo llena con
los datos extraídos de la boleta y adjunta los archivos.

El objetivo es que el usuario escriba lo mínimo posible. **Cada dato que el agente
le pide es un dato que no supo extraer solo.**

---

## 2. Dónde empieza Hermes

El registro **no** ocurre en WhatsApp. Ya existe un frontend web donde el usuario:

1. Crea su cuenta (nombre, teléfono, RUT).
2. Elige su Isapre e ingresa las credenciales de la sucursal virtual.
3. Acepta términos y política de privacidad.

Esas credenciales quedan **cifradas** en Supabase (`credenciales_isapre.password_encrypted`).
Al terminar, el usuario ve un botón que lo lleva a `https://wa.me/<numero>?text=Hola...`.

**Hermes toma el control desde ese primer mensaje.** El frontend sigue existiendo
tal cual; sólo cambia dónde vive la conversación.

### Identificación del usuario

El teléfono es la llave. Al llegar un mensaje:

1. Normalizar el número (sólo dígitos, con código de país; el registro guarda `56912345678`).
2. Buscar en `usuarios` por `telefono`.
3. Si **no existe** → el usuario no está registrado. Responder con el enlace al
   frontend para que se enrole, y no avanzar.
4. Si existe pero **no tiene Isapre enrolada** (`credenciales_isapre` vacío) →
   mismo enlace, explicando que falta completar el enrolamiento.

> ⚠️ **Nunca pedir la contraseña de la Isapre por WhatsApp.** Ya está guardada y
> cifrada. Si el usuario la escribe espontáneamente, no la almacenes en el
> historial de mensajes y pídele que la cambie desde el portal de su Isapre.

---

## 3. La conversación, paso a paso

El agente es una **máquina de estados**, no una charla libre. El modelo se usa
para interpretar y extraer, pero **el orden lo manda la máquina**. Esto evita que
el agente invente pasos o pida datos fuera de tiempo.

| Etapa | El agente hace | Pasa a |
|---|---|---|
| `idle` | Saluda y ofrece las prestaciones disponibles | `awaiting_prestacion` |
| `awaiting_prestacion` | Interpreta qué prestación quiere | `awaiting_field`* o `awaiting_document` |
| `awaiting_field`* | Pregunta el **tipo de comprobante** (decisión de navegación) | `awaiting_document` |
| `awaiting_document` | **Pide la boleta / voucher / factura** | (al recibirla) |
| — | Extrae datos por OCR y calcula qué falta | `awaiting_field` o `processing` |
| `awaiting_field` | Pregunta **sólo** lo que el OCR no resolvió, de a uno | `processing` |
| `processing` | Encola el proceso y reporta avance | `completed` |

\* Sólo para prestaciones que requieren elegir tipo de comprobante (ver §5).

### 3.1 Menú de prestaciones

Se leen de `catalogo_prestaciones` filtrando por la Isapre del usuario.
**Ofrecer sólo las que tienen `metadata.disponible !== false`.**

Para Banmédica hoy:

| Código | Nombre | Estado |
|---|---|---|
| `consultas_psicologia` | Consultas Médicas y Atenciones Psicológicas | ✅ operativa |
| `urgencias_medicas` | Urgencias Médicas | ✅ operativa |
| `examenes_y_otros` | Exámenes, Imagenología, Procedimientos y Otros | 🚫 bloqueada |
| `optica_kine_fono` | Óptica, Kinesiología y Fonoaudiología | 🚫 bloqueada |

Si el usuario pide una bloqueada, **reconócela por nombre** y explica que aún no
está habilitada, ofreciendo las que sí lo están. No la trates como "no entendí".

En WhatsApp esto va como **lista interactiva** o botones — nunca como texto plano
que el usuario deba copiar.

### 3.2 El comprobante va antes que las preguntas

Ésta es la regla más importante del flujo:

> **Mientras no haya un documento cargado, el agente no pregunta ningún dato de
> la boleta.**

El motivo es simple: el OCR resuelve la mayoría de los campos. Preguntar primero
y extraer después le hace escribir al usuario cosas que el sistema ya iba a saber.

La única excepción son los campos marcados `metadata.previo_documento = true`
(hoy: `tipo_documento_pago`). **No son datos de la boleta, son decisiones de
navegación**: definen qué sub-formulario abre el portal. Por eso van antes.

### 3.3 Extracción del documento

Al recibir imagen o PDF:

1. Guardar en `archivos_conversacion` con `metadata.role` (`voucher`, `boleta`,
   `detalle`, `orden_medica`). El **primer** adjunto de la conversación es el
   comprobante; los siguientes son el detalle.
2. Si es **imagen** (PNG/JPG/WEBP), mandarla al modelo de visión y extraer:
   `centroMedicoRut`, `centroMedicoNombre`, `fechaAtencion`, `montoPagado`,
   `numeroBoleta`, `numeroComercio`, `numeroOperacion`, `rutProfesional`,
   `tipoPago`, más `prestacionSugerida` y `tipoDocumentoSugerido`.
3. Normalizar: fechas `YYYY-MM-DD`, montos sólo dígitos.
4. Guardar el resultado en `archivos_conversacion.extracted_data`.

Reglas de extracción:

- **Nunca inventar un campo.** Si no aparece en el documento, va `null` y se le
  pregunta al usuario.
- Si la IA deduce el `tipoDocumentoSugerido`, **no preguntar el tipo de comprobante**.
- Si el usuario manda la boleta **antes** de elegir prestación, usar
  `prestacionSugerida` para proponerla, pero **confirmar con el usuario** antes de
  seguir.
- **PDF u otros formatos**: el OCR no corre. Guardar igual el archivo, avisar que
  se pedirán los datos a mano y **continuar el flujo** — no dejar la conversación
  esperando un documento que ya llegó.

Tras extraer, decir explícitamente qué se obtuvo y qué falta:

> *"Listo, analicé el documento. Extraje: monto, fecha y RUT del centro médico.
> Me falta un dato: número de operación."*

### 3.4 Preguntar sólo lo faltante

Recorrer `catalogo_campos_prestacion` por `orden`, y preguntar **únicamente** los
campos con `requerido = true` que sigan vacíos. Uno por mensaje.

**Campos con opciones** (`metadata.opciones`) van siempre como **botones**. Antes
de gastar una llamada al modelo, intentar emparejar localmente lo que escribió el
usuario contra las etiquetas del catálogo:

- Coincidencia exacta, o contención en cualquier dirección → aceptar.
- Palabras significativas compartidas, si hay un ganador claro → aceptar.
- **Empate real → volver a preguntar mostrando los botones.**

Ejemplo del último caso: *"tengo una boleta"* calza igual de bien con "Boleta de
honorarios electrónica" y con "Otras boletas o facturas". Adivinar ahí produce un
formulario mal llenado; preguntar cuesta un toque.

**Validaciones**: RUT con dígito verificador, fecha a `YYYY-MM-DD` (aceptar
`DD/MM/AAAA`), monto sólo dígitos. Si falla, explicar por qué y repreguntar el
mismo campo sin avanzar.

### 3.5 Cierre

Con todo reunido, crear el proceso, confirmar al usuario y avisar que se le
informará el resultado. A partir de ahí manda el robot (§4).

---

## 4. Qué hace el robot en el portal

Cuando la conversación termina, se encola un registro en `procesos_demo` con
estado `pendiente`. Un worker lo toma, descifra las credenciales y navega.

### Recorrido en Banmédica

```
1. Login          https://login.isaprebanmedica.cl/login
                  #rut · #current-password · button[type=submit]
2. Home           https://afiliados.isaprebanmedica.cl/view/home
                  ⚠️ cerrar anuncios/modales antes de seguir
3. Reembolsos     Menú "Reembolsos" → "Solicitar Reembolso"
                  (respaldo: ir directo a /view/reembolso)
4. Beneficiario   Carrusel .id-carrusel → tarjeta .card
5. Prestación     Tarjetas .option-box (por texto visible)
6. Comprobante    Tarjetas .option (sólo algunas prestaciones)
7. Formulario     Llenar campos + adjuntar archivos
```

El formulario de Banmédica tiene **5 etapas**. Este flujo llega hasta la **3**
(Datos y documentos).

> 🛑 **Nunca avanzar a las etapas 4 (Cuenta) y 5 (Confirmación). Nunca enviar el
> formulario.** El proceso se detiene deliberadamente con todo cargado y listo
> para que una persona revise y confirme.

### Trampas conocidas del portal

Estas costaron horas de depuración. Documentadas para no repetirlas:

- **El carrusel de beneficiarios es `<swiper-container init="false">`.** Hasta que
  Swiper arranca por JS, los slides no tienen dimensiones y el navegador
  automatizado los considera **invisibles**. Hay que esperar a que estén
  *adjuntos* al DOM (no "visibles") y clickear con `force`, verificando después
  que aparecieron las tarjetas de prestación.
- **Un paso que falla en silencio arrastra el error.** Si la selección de
  beneficiario se marca como "opcional" y se omite, el fallo aparece dos pasos
  después, en un lugar que no tiene nada que ver. Cada paso que condiciona al
  siguiente debe ser **obligatorio** y fallar en su propio punto.
- **Modales post-login.** Además de cerrarlos, hay que eliminar el
  `.modal-backdrop` huérfano: intercepta clicks aunque el modal ya no se vea.
- Angular re-renderiza: preferir texto visible sobre clases generadas
  (`_ngcontent-*` cambia entre despliegues).

### Adjuntos por prestación

Cada prestación declara sus zonas de carga en `catalogo_prestaciones.metadata.adjuntos`.
Los slots se llenan **en el orden en que el portal los renderiza**:

| Prestación | Slot 1 | Slot 2 | Slot 3 |
|---|---|---|---|
| Consultas Médicas | Voucher/boleta ✱ | Detalle | — |
| Urgencias Médicas | Boleta/voucher ✱ | Detalle | — |
| Exámenes *(bloqueada)* | Boleta ✱ | Orden médica ✱ | Detalle ✱ |

✱ = requerido. Un `voucher` sirve donde se pide `boleta` y viceversa; `detalle` y
`orden_medica` también son intercambiables. **Un archivo no puede usarse en dos
slots.** Si falta uno requerido, registrarlo como error, no como advertencia.

---

## 5. Diferencias por prestación

**Consultas Médicas y Atenciones Psicológicas** — Tiene un paso intermedio: elegir
entre *Boleta de honorarios electrónica*, *Otras boletas o facturas* o *Voucher o
comprobante de pago con tarjeta*, y luego pulsar **"Nuevo Reembolso"**. Los campos
del formulario cambian según lo elegido: el voucher pide número de comercio y de
operación; la boleta pide número de boleta.

**Urgencias Médicas** — Sin paso intermedio. Va directo al formulario: RUT del
centro médico, fecha, tipo de pago, número de boleta y monto, más dos zonas de
carga.

---

## 6. Qué debe quedar registrado

La trazabilidad no es opcional: es lo que permite explicarle al usuario qué pasó y
depurar cuando el portal cambia.

| Tabla | Qué guarda |
|---|---|
| `conversaciones_whatsapp` | Una por teléfono + canal |
| `mensajes_whatsapp` | Cada mensaje, entrante y saliente |
| `archivos_conversacion` | Los adjuntos + lo que se extrajo de ellos |
| `estado_conversaciones` | Etapa actual, prestación, campo pendiente, respuestas |
| `procesos_demo` | Un proceso por solicitud, con su estado |
| `proceso_pasos` | Bitácora: cada click, cada campo, cada error |
| `proceso_campos` | Valor final de cada campo **y de dónde salió** |

### Origen de cada dato

En `proceso_campos.metadata.origen` guardar `ocr` | `usuario` | `default`. Esto
responde la pregunta que siempre aparece: *¿este dato lo sacó de la boleta o se lo
inventó?*

### Evidencia cuando algo falla

Cuando el robot no encuentra un elemento, el paso debe guardar en su `payload`:

- Los selectores que intentó.
- Los textos clickeables que **sí** había en pantalla.
- Los campos visibles con sus selectores.
- Una **captura de pantalla** del momento del fallo.

Sin esto, depurar exige reproducir el error con un navegador a la vista. Con esto,
se corrige el selector leyendo el historial.

### Estados del proceso

`pendiente` → `en_progreso` → `completado` | `fallido`

El usuario debe poder escribir **"estado"** en cualquier momento y recibir una
respuesta útil sobre su solicitud en curso.

---

## 7. Reglas de conversación

**Tono.** Directo y en español chileno neutro. Sin tecnicismos: el usuario no
sabe qué es un "selector" ni un "proceso RPA". Si algo falla, se le dice qué pasó
y qué puede hacer, no el stack trace.

**Un mensaje, una pregunta.** Nunca pedir tres datos juntos.

**Siempre botones cuando hay opciones cerradas.** Prestaciones, tipo de
comprobante, tipo de pago. Escribir a mano sólo para datos abiertos (montos,
números de boleta).

**Comandos que deben funcionar siempre:**

| El usuario escribe | El agente hace |
|---|---|
| `menú` / `reiniciar` | Vuelve al inicio, descarta el estado actual |
| `estado` | Informa el proceso en curso |
| `ayuda` | Explica qué puede hacer |

**Idempotencia.** Evolution API puede reenviar el mismo evento. Guardar un
identificador único por mensaje (equivalente a `webhook_events.idempotency_key`) y
descartar duplicados: procesar dos veces significa cobrar dos veces el OCR y, peor,
encolar dos reembolsos.

**Mensajes fuera de contexto.** Si el usuario escribe cualquier cosa mientras se
espera un documento, reiterar la petición **sin perder** la prestación ya elegida.

---

## 8. Límites — lo que el agente NO debe hacer

- ❌ **Enviar el formulario final.** El proceso se detiene en la etapa 3, siempre.
- ❌ **Pedir la contraseña de la Isapre** por chat.
- ❌ **Inventar datos** que no estén en el documento o que el usuario no dio.
- ❌ **Preguntar datos de la boleta antes de tener la boleta.**
- ❌ **Adivinar entre opciones ambiguas** — preguntar cuesta un toque, un
  formulario mal llenado cuesta un rechazo.
- ❌ **Tramitar prestaciones bloqueadas** aunque el usuario insista.
- ❌ Reintentar un login fallido en bucle: el portal bloquea la cuenta.

---

## 9. Conversación de referencia

```
Usuario  Hola
Agente   Hola Sebastián. Veo que tienes Banmédica enrolada.
         ¿Qué tipo de reembolso quieres gestionar?
         [Consultas Médicas y Atenciones Psicológicas]
         [Urgencias Médicas]

Usuario  [Consultas Médicas y Atenciones Psicológicas]
Agente   Perfecto, vamos con "Consultas Médicas y Atenciones Psicológicas".
         ¿Qué tipo de comprobante tienes?
         [Boleta de honorarios electrónica]
         [Otras boletas o facturas]
         [Voucher o comprobante de pago con tarjeta]

Usuario  Tengo una boleta
Agente   No logré identificar la opción. Elige una de estas:
         [Boleta de honorarios electrónica]
         [Otras boletas o facturas]
         [Voucher o comprobante de pago con tarjeta]

Usuario  [Voucher o comprobante de pago con tarjeta]
Agente   Ahora envíame una foto o PDF de tu voucher o comprobante de pago
         con tarjeta y la analizo para completar el formulario por ti.
         Si además tienes el detalle de prestación, puedes adjuntarlo después.

Usuario  📎 voucher.jpg
Agente   Listo, analicé el documento. Extraje: RUT del centro médico, fecha,
         monto y número de comercio. Me falta un dato: número de operación.

Usuario  1442467
Agente   Perfecto, ya reuní todo para "Consultas Médicas y Atenciones
         Psicológicas". Voy a cargar tu solicitud en el portal de Banmédica
         y te aviso apenas termine.

         ✅ Tu reembolso quedó cargado en Banmédica con todos los datos y
         el voucher adjunto, listo para revisión final.
```

---

## 10. Criterios de aceptación

La implementación está correcta cuando:

- [ ] Un usuario no registrado recibe el enlace al frontend y nada más.
- [ ] El menú muestra **sólo** prestaciones disponibles, como botones.
- [ ] Pedir una prestación bloqueada da una explicación clara, no un "no entendí".
- [ ] **Nunca** se pregunta un dato de la boleta antes de recibirla.
- [ ] Si el OCR extrae un campo, ese campo **no** se le pregunta al usuario.
- [ ] Si el OCR deduce el tipo de comprobante, no se pregunta.
- [ ] Una respuesta ambigua vuelve a mostrar los botones en vez de adivinar.
- [ ] Un PDF se acepta y el flujo continúa preguntando los datos a mano.
- [ ] `estado`, `menú` y `ayuda` funcionan en cualquier punto.
- [ ] Un evento duplicado de Evolution API no genera dos procesos.
- [ ] El proceso llega a la etapa 3 del portal y **no envía** el formulario.
- [ ] Cada campo queda con su `origen` (`ocr` / `usuario`).
- [ ] Un paso fallido guarda selectores intentados, textos en pantalla y captura.
- [ ] El usuario recibe un mensaje final que dice qué se cargó y qué faltó.
