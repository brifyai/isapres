/**
 * Entry point del RPA Worker — WSP-ISAP CAPA 3
 *
 * Este worker corre como un proceso separado que:
 * 1. Sondea la BD buscando reembolsos encolados (estado 'en_cola')
 * 2. Descifra las credenciales del usuario
 * 3. Usa Playwright para automatizar la sucursal virtual de la Isapre
 * 4. Sube la boleta y obtiene el folio de reembolso
 * 5. Actualiza el estado del reembolso en la BD
 * 6. Verifica periódicamente la salud de los portales
 *
 * Uso:
 *   npm run dev    # Modo desarrollo con hot reload
 *   npm start      # Modo producción
 */

// El worker se inicia desde worker.ts
import './worker.js'