/** Vocabulario compartido por las pantallas de CRM. */

export const TAX_ID_TYPES = [
  { value: 'NIT', label: 'NIT' },
  { value: 'CC', label: 'Cédula de ciudadanía' },
  { value: 'CE', label: 'Cédula de extranjería' },
  { value: 'TI', label: 'Tarjeta de identidad' },
  { value: 'PP', label: 'Pasaporte' },
  { value: 'NIT_EXT', label: 'NIT del exterior' },
  { value: 'PEP', label: 'PEP' },
  { value: 'NUIP', label: 'NUIP' },
  { value: 'SIN_IDENTIFICAR', label: 'Sin identificar' },
] as const;

export const TAX_REGIMES = [
  { value: 'COMUN', label: 'Régimen común' },
  { value: 'SIMPLIFICADO', label: 'Régimen simplificado' },
  { value: 'GRAN_CONTRIBUYENTE', label: 'Gran contribuyente' },
  { value: 'NO_RESIDENTE', label: 'No residente' },
] as const;

export const ADDRESS_KINDS = [
  { value: 'MAIN', label: 'Principal' },
  { value: 'BILLING', label: 'Facturación' },
  { value: 'SHIPPING', label: 'Envío' },
  { value: 'OTHER', label: 'Otra' },
] as const;

export const ACTIVITY_KINDS = [
  { value: 'CALL', label: 'Llamada' },
  { value: 'EMAIL', label: 'Correo' },
  { value: 'MEETING', label: 'Reunión' },
  { value: 'NOTE', label: 'Nota' },
  { value: 'WHATSAPP', label: 'WhatsApp' },
  { value: 'TASK', label: 'Tarea' },
  { value: 'VISIT', label: 'Visita' },
] as const;

const label = (list: ReadonlyArray<{ value: string; label: string }>, value: string): string =>
  list.find((i) => i.value === value)?.label ?? value;

export const taxIdTypeLabel = (value: string): string => label(TAX_ID_TYPES, value);
export const taxRegimeLabel = (value: string): string => label(TAX_REGIMES, value);
export const addressKindLabel = (value: string): string => label(ADDRESS_KINDS, value);
export const activityKindLabel = (value: string): string => label(ACTIVITY_KINDS, value);

/**
 * Documento tal como se escribe en Colombia: "NIT 890.903.938-8".
 *
 * Los puntos se ponen aquí, al mostrar, y nunca al guardar: en la base el NIT va
 * normalizado para que buscar "890903938" encuentre la ficha aunque quien la dio
 * de alta escribiera los puntos.
 */
export const documentLabel = (
  type: string,
  taxId: string | null,
  dv?: string | null,
): string => {
  if (!taxId) return '—';
  const grouped = /^\d+$/.test(taxId) ? taxId.replace(/\B(?=(\d{3})+(?!\d))/g, '.') : taxId;
  const suffix = dv ? `-${dv}` : '';
  return `${taxIdTypeLabel(type)} ${grouped}${suffix}`;
};

/**
 * Responsabilidades fiscales de la DIAN que se imprimen en la factura.
 *
 * La factura electrónica exige declararlas; sin ellas el documento se rechaza.
 */
export const FISCAL_RESPONSIBILITIES = [
  { code: 'O-13', label: 'Gran contribuyente' },
  { code: 'O-15', label: 'Autorretenedor' },
  { code: 'O-23', label: 'Agente de retención de IVA' },
  { code: 'O-47', label: 'Régimen simple de tributación' },
  { code: 'R-99-PN', label: 'No aplica · Otros' },
] as const;
