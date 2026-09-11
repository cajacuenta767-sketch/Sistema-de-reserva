import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Une clases y resuelve conflictos de Tailwind.
 *
 * `twMerge` no es opcional: en Tailwind, entre `w-full` y `w-auto` gana la que
 * aparezca más tarde en el CSS generado, NO la que se escriba después en el
 * atributo. Sin esto, pasar `className="w-auto"` a un componente que ya trae
 * `w-full` no hace nada, y el fallo se manifiesta como un control que ocupa toda
 * la fila sin motivo aparente.
 */
export const cx = (...values: ClassValue[]): string => twMerge(clsx(values));
