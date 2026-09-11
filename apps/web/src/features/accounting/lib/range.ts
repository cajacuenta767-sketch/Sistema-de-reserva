/**
 * Rango por defecto de los informes: el año en curso hasta hoy.
 *
 * No los últimos 30 días: un informe contable se lee por ejercicio, y arrancar
 * con un rango a caballo entre dos años daría cifras que no coinciden con nada
 * de lo que el contador tiene sobre la mesa.
 */
export const defaultRange = (): { from: string; to: string } => {
  const today = new Date().toISOString().slice(0, 10);
  return { from: `${today.slice(0, 4)}-01-01`, to: today };
};
