import { LegalDocumentLayout } from '@/components/legal/LegalDocumentLayout'

const sections = [
  {
    title: '1. Responsable del tratamiento',
    body: (
      <>
        <p>
          Reembolsos Isapres es una plataforma de automatización asistida que permite a los usuarios
          enrolados gestionar solicitudes de reembolso ante su Isapre mediante WhatsApp, dashboard web
          y procesos automatizados controlados.
        </p>
        <p>
          Esta política aplica al tratamiento de datos realizado en el frontend, backend, base de datos,
          integraciones de mensajería, servicios de inteligencia artificial y procesos RPA necesarios
          para operar el servicio.
        </p>
      </>
    ),
  },
  {
    title: '2. Datos que recopilamos',
    body: (
      <>
        <p>Durante el enrolamiento, operación y soporte del servicio podemos tratar las siguientes categorías de datos:</p>
        <p>- Datos de identificación: nombre, teléfono, RUT y registro de Isapre enrolada.</p>
        <p>- Credenciales operativas: RUT y contraseña de sucursal virtual de la Isapre, almacenadas cifradas.</p>
        <p>- Datos conversacionales: mensajes enviados o recibidos por WhatsApp, selecciones, respuestas y contexto de conversación.</p>
        <p>- Datos operativos: historial de navegación, formularios detectados, campos completados, estados de proceso, timestamps y errores.</p>
        <p>- Datos técnicos: IP de consentimiento, agente de usuario, logs del sistema y eventos de auditoría.</p>
      </>
    ),
  },
  {
    title: '3. Finalidades del tratamiento',
    body: (
      <>
        <p>Tratamos la información para las siguientes finalidades:</p>
        <p>- Registrar y autenticar al usuario dentro del servicio.</p>
        <p>- Automatizar el ingreso a la sucursal virtual de la Isapre enrolada.</p>
        <p>- Guiar conversaciones por WhatsApp y recopilar antecedentes del reembolso.</p>
        <p>- Identificar prestaciones, detectar formularios y completar campos sin enviar el formulario final cuando el flujo se encuentra en modo demo.</p>
        <p>- Mantener historial verificable del recorrido, botones utilizados, campos llenados y resultados obtenidos.</p>
        <p>- Resolver errores operativos, auditar uso indebido y mejorar la calidad del servicio.</p>
      </>
    ),
  },
  {
    title: '4. Base de legitimación',
    body: (
      <>
        <p>
          El tratamiento se sustenta principalmente en el consentimiento expreso del usuario otorgado
          durante el enrolamiento y en la necesidad operativa de ejecutar el servicio solicitado.
        </p>
        <p>
          El consentimiento queda registrado junto con trazas mínimas de fecha, IP y agente de usuario
          para fines de control y cumplimiento.
        </p>
      </>
    ),
  },
  {
    title: '5. Seguridad de la información',
    body: (
      <>
        <p>
          Las credenciales sensibles se almacenan cifradas y solo se utilizan para ejecutar las acciones
          estrictamente necesarias para el proceso automatizado del usuario.
        </p>
        <p>
          El servicio incorpora controles de autenticación, separación de componentes, almacenamiento en
          base de datos protegida, registros de auditoría y validaciones orientadas a reducir exposición,
          acceso no autorizado y manipulación indebida.
        </p>
      </>
    ),
  },
  {
    title: '6. Integraciones y terceros',
    body: (
      <>
        <p>Para prestar el servicio podemos apoyarnos en proveedores tecnológicos tales como:</p>
        <p>- Plataforma de mensajería WhatsApp y su capa de integración.</p>
        <p>- Infraestructura de base de datos y almacenamiento.</p>
        <p>- Servicios de inteligencia artificial para interpretar respuestas y estructurar datos.</p>
        <p>- Herramientas de automatización web utilizadas para interactuar con los portales de Isapres.</p>
        <p>
          Estos terceros solo procesan información en la medida necesaria para ejecutar la funcionalidad
          del servicio o mantener su operación técnica.
        </p>
      </>
    ),
  },
  {
    title: '7. Conservación de datos',
    body: (
      <>
        <p>
          Conservamos la información durante el tiempo necesario para operar el servicio, mantener el
          historial de procesos, atender requerimientos de soporte, auditoría y cumplimiento, o hasta que
          el usuario solicite su eliminación cuando ello sea técnicamente y legalmente procedente.
        </p>
      </>
    ),
  },
  {
    title: '8. Derechos del usuario',
    body: (
      <>
        <p>El usuario puede solicitar, según corresponda, acceso, rectificación, actualización o eliminación de sus datos.</p>
        <p>
          También puede solicitar la revocación del consentimiento para futuras ejecuciones automatizadas,
          entendiendo que ello puede impedir la continuidad operativa del servicio.
        </p>
      </>
    ),
  },
  {
    title: '9. Contacto y actualizaciones',
    body: (
      <>
        <p>
          Esta política puede actualizarse para reflejar cambios regulatorios, operativos o técnicos del
          proyecto. La versión publicada en esta URL se considera la versión vigente y pública para fines
          de cumplimiento e integración con proveedores como Meta y WhatsApp.
        </p>
      </>
    ),
  },
]

export function PrivacyPolicyPage() {
  return (
    <LegalDocumentLayout
      eyebrow="Documento público"
      title="Política de Privacidad"
      summary="Esta política describe cómo Reembolsos Isapres recopila, utiliza, resguarda y conserva la información necesaria para operar el servicio de automatización de reembolsos vía WhatsApp e Isapres."
      effectiveDate="13 de julio de 2026"
      sections={sections}
    />
  )
}
