import { prepareTemplate } from './pgTemplate.js';

/**
 * Se ejecuta UNA vez antes de todos los ficheros de test: aplica las migraciones
 * sobre la base plantilla que luego cada fichero clona.
 */
export default async function setup(): Promise<void> {
  await prepareTemplate();
}
