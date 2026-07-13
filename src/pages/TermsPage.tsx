import { LegalDocumentLayout } from '@/components/legal/LegalDocumentLayout'

const sections = [
  {
    title: '1. Objeto del servicio',
    body: (
      <>
        <p>
          Reembolsos Isapres ofrece una plataforma de automatización asistida para apoyar la gestión de
          reembolsos ante Isapres mediante WhatsApp, panel web y procesos RPA controlados.
        </p>
        <p>
          En la etapa actual del proyecto, determinadas funcionalidades pueden operar en modalidad demo o
          asistida, lo que implica que el sistema puede identificar formularios, completar campos y
          registrar el historial sin necesariamente enviar la solicitud final al portal de la Isapre.
        </p>
      </>
    ),
  },
  {
    title: '2. Requisitos de uso',
    body: (
      <>
        <p>Para utilizar el servicio, el usuario debe:</p>
        <p>- proporcionar datos reales y actualizados de identificación y contacto;</p>
        <p>- enrolar una Isapre válida y mantener vigentes sus credenciales de sucursal virtual;</p>
        <p>- aceptar expresamente estos términos y la política de privacidad;</p>
        <p>- utilizar el servicio únicamente respecto de cuentas y datos sobre los cuales tenga autorización.</p>
      </>
    ),
  },
  {
    title: '3. Autorización del usuario',
    body: (
      <>
        <p>
          Al enrolarse, el usuario autoriza a la plataforma a utilizar sus credenciales de la sucursal
          virtual exclusivamente para ejecutar las acciones necesarias para el proceso de reembolso,
          recopilación de antecedentes, llenado asistido de formularios y trazabilidad del flujo.
        </p>
        <p>
          El usuario declara que comprende que el servicio puede requerir interacción conversacional,
          validaciones adicionales y revisión de información antes de cualquier envío final.
        </p>
      </>
    ),
  },
  {
    title: '4. Alcance y limitaciones',
    body: (
      <>
        <p>
          El servicio depende de la disponibilidad de portales de Isapres, proveedores de mensajería,
          infraestructura tecnológica, servicios de terceros y cambios en las interfaces de los sitios
          externos.
        </p>
        <p>
          Reembolsos Isapres no garantiza que todos los portales, prestaciones o formularios estén
          disponibles en todo momento ni que un flujo automatizado pueda completarse exitosamente en todos
          los casos.
        </p>
      </>
    ),
  },
  {
    title: '5. Responsabilidad del usuario',
    body: (
      <>
        <p>El usuario es responsable de:</p>
        <p>- la veracidad de la información entregada por WhatsApp o dashboard;</p>
        <p>- la legitimidad de los documentos, boletas, formularios y datos ingresados;</p>
        <p>- custodiar su acceso al dispositivo y a su número de WhatsApp;</p>
        <p>- revisar el resultado del proceso cuando el servicio indique que existe una etapa demo o de validación previa.</p>
      </>
    ),
  },
  {
    title: '6. Seguridad y credenciales',
    body: (
      <>
        <p>
          Las credenciales de Isapre son tratadas como información sensible y se almacenan mediante
          mecanismos de cifrado. Aun así, el usuario reconoce que ningún sistema tecnológico es
          absolutamente inmune a incidentes y que la plataforma adopta medidas razonables de resguardo
          acordes a su arquitectura y finalidad.
        </p>
      </>
    ),
  },
  {
    title: '7. Suspensión o terminación',
    body: (
      <>
        <p>
          La plataforma puede suspender, limitar o terminar el acceso cuando detecte uso indebido,
          inconsistencias graves, intentos de fraude, riesgo operacional o incumplimiento de estos términos.
        </p>
      </>
    ),
  },
  {
    title: '8. Propiedad intelectual y uso del sistema',
    body: (
      <>
        <p>
          El software, flujos, automatizaciones, interfaces, documentación y elementos visuales del
          servicio pertenecen a sus respectivos titulares y no pueden ser copiados, revendidos o explotados
          sin autorización.
        </p>
      </>
    ),
  },
  {
    title: '9. Modificaciones',
    body: (
      <>
        <p>
          Estos términos pueden actualizarse conforme evolucione el proyecto, cambie la regulación o se
          incorporen nuevas funcionalidades. La versión publicada en esta URL corresponde a la versión
          vigente.
        </p>
      </>
    ),
  },
]

export function TermsPage() {
  return (
    <LegalDocumentLayout
      eyebrow="Documento público"
      title="Términos y Condiciones"
      summary="Estos términos regulan el uso del servicio Reembolsos Isapres, su flujo de automatización asistida por WhatsApp y las responsabilidades asociadas al enrolamiento, uso de credenciales y ejecución del proceso."
      effectiveDate="13 de julio de 2026"
      sections={sections}
    />
  )
}
