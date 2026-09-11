import { AppError } from '@erp/core';
import type { ImportField } from '../../../platform/imports/ImportRegistry.js';

/**
 * Emparejar columnas del fichero con campos de la entidad, y convertir sus
 * valores a lo que el caso de uso espera.
 *
 * La conversión es la mitad del trabajo y la que produce los errores más
 * difíciles de ver: un fichero exportado de Excel en español escribe
 * `1.234.567,89`, y leerlo con `Number()` da `NaN` o, peor, `1.234`. Un precio
 * dividido por mil no lanza ningún error: simplemente queda mal.
 */

/** Mapeo: campo de la entidad → cabecera del fichero. */
export type ColumnMapping = Record<string, string>;

/** Normaliza una cabecera para comparar: minúsculas, sin tildes ni signos. */
export const normalizeHeader = (header: string): string =>
  header
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * Propone un mapeo a partir de las cabeceras.
 *
 * No adivina de más: solo empareja lo que reconoce sin ambigüedad. Un mapeo
 * inventado es peor que ninguno, porque el usuario lo da por bueno y descubre el
 * error cuando los datos ya están dentro.
 */
export const inferMapping = (
  headers: readonly string[],
  fields: readonly ImportField[],
): ColumnMapping => {
  const mapping: ColumnMapping = {};
  const used = new Set<string>();

  const candidates = headers.map((header) => ({ header, normalized: normalizeHeader(header) }));

  for (const field of fields) {
    const names = [field.key, field.label, ...(field.aliases ?? [])].map(normalizeHeader);
    const match = candidates.find((c) => !used.has(c.header) && names.includes(c.normalized));
    if (match) {
      mapping[field.key] = match.header;
      used.add(match.header);
    }
  }
  return mapping;
};

/** Campos obligatorios que el mapeo no cubre. */
export const missingRequired = (
  mapping: ColumnMapping,
  fields: readonly ImportField[],
): ImportField[] => fields.filter((f) => f.required && !mapping[f.key]);

/** Qué carácter separa los decimales en este fichero. */
export type DecimalSeparator = ',' | '.';

/**
 * Deduce el convenio numérico mirando TODA la columna, no cada celda.
 *
 * Una celda suelta puede ser indescifrable: `89.900` son 89 900 pesos en un
 * fichero español y 89,9 en uno inglés, y las dos lecturas son plausibles.
 * Adivinar celda a celda es justo la clase de error que no avisa: un precio
 * dividido por mil no lanza ninguna excepción, solo queda mal.
 *
 * La columna entera sí lo dice. Basta con que una celda sea inequívoca —dos
 * separadores (`1.234.567,89`), un separador repetido (`1.234.567`), o uno o dos
 * decimales al final (`4500,5`)— para fijar el convenio de todas las demás.
 * Sin ninguna pista se asume el español, que es lo que exporta Excel en
 * Colombia; cualquier fichero con decimales de verdad trae alguna pista.
 */
export const detectDecimalSeparator = (values: readonly string[]): DecimalSeparator => {
  for (const raw of values) {
    const text = raw.trim();
    const dots = (text.match(/\./g) ?? []).length;
    const commas = (text.match(/,/g) ?? []).length;

    // Los dos separadores presentes: el último es el decimal.
    if (dots > 0 && commas > 0) return text.lastIndexOf(',') > text.lastIndexOf('.') ? ',' : '.';
    // Repetido: solo el de miles se repite.
    if (dots > 1) return ',';
    if (commas > 1) return '.';
    // Uno o dos dígitos detrás: son decimales; el de miles siempre lleva tres.
    if (/[.]\d{1,2}$/.test(text)) return '.';
    if (/[,]\d{1,2}$/.test(text)) return ',';
  }
  return ',';
};

/**
 * Número escrito por una persona.
 *
 * El separador decimal se pasa desde fuera porque se decide una vez por columna
 * (ver `detectDecimalSeparator`): con él, lo que queda aquí es mecánico y sin
 * conjeturas.
 */
export const parseNumber = (raw: string, decimal: DecimalSeparator = ','): string => {
  const text = raw.trim().replace(/\s/g, '').replace(/[$€]/g, '');
  if (text.length === 0) return '';

  const thousands = decimal === ',' ? '.' : ',';
  const normalized = text.split(thousands).join('').replace(decimal, '.');

  // Un separador de miles final ("1.234.") o texto suelto no son números:
  // aceptarlos convertiría un dato ilegible en una cifra plausible.
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) {
    throw AppError.validation(`"${raw}" no es un número`);
  }
  return normalized;
};

const TRUE_VALUES = new Set(['1', 'si', 'sí', 'true', 'verdadero', 'x', 'y', 'yes']);
const FALSE_VALUES = new Set(['0', 'no', 'false', 'falso', 'n', '']);

export const parseBoolean = (raw: string): boolean => {
  const text = raw.trim().toLowerCase();
  if (TRUE_VALUES.has(text)) return true;
  if (FALSE_VALUES.has(text)) return false;
  throw AppError.validation(`"${raw}" no es un sí/no reconocible`);
};

/**
 * Fecha en los formatos que la gente escribe.
 *
 * En Colombia se escribe día/mes/año. Interpretar `03/04/2026` como el 3 de
 * abril o el 4 de marzo cambia el trimestre de una factura, así que el formato
 * con barras se lee SIEMPRE como día primero, y el ISO (`2026-04-03`) se
 * reconoce por su forma.
 */
export const parseDate = (raw: string): string => {
  const text = raw.trim();
  if (text.length === 0) return '';

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const parts = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/.exec(text);
  if (parts) {
    const [, day, month, year] = parts;
    const fullYear = year!.length === 2 ? `20${year}` : year!;
    const date = `${fullYear}-${month!.padStart(2, '0')}-${day!.padStart(2, '0')}`;
    if (Number(month) > 12) {
      throw AppError.validation(`"${raw}" no es una fecha válida (se espera día/mes/año)`);
    }
    return date;
  }
  throw AppError.validation(`"${raw}" no es una fecha reconocible (usa AAAA-MM-DD o DD/MM/AAAA)`);
};

/**
 * Aplica el mapeo a una fila cruda y convierte cada valor según su tipo.
 *
 * Las celdas vacías se omiten en lugar de enviarse como cadena vacía: así el
 * caso de uso aplica sus valores por defecto, en vez de guardar un `''` que
 * luego se muestra como un hueco que nadie sabe si es un dato o un olvido.
 */
export const applyMapping = (
  raw: Record<string, string>,
  mapping: ColumnMapping,
  fields: readonly ImportField[],
  decimal: DecimalSeparator = ',',
): Record<string, string> => {
  const result: Record<string, string> = {};

  for (const field of fields) {
    const column = mapping[field.key];
    if (!column) continue;
    const value = (raw[column] ?? '').trim();

    if (value.length === 0) {
      if (field.required) {
        throw AppError.validation(`Falta "${field.label}" (columna "${column}")`);
      }
      continue;
    }

    try {
      switch (field.type) {
        case 'number':
          result[field.key] = parseNumber(value, decimal);
          break;
        case 'boolean':
          result[field.key] = parseBoolean(value) ? 'true' : 'false';
          break;
        case 'date':
          result[field.key] = parseDate(value);
          break;
        default:
          result[field.key] = value;
      }
    } catch (error) {
      // El mensaje nombra la columna: "no es un número" a secas obliga a mirar
      // la fila entera para saber cuál de las ocho celdas es.
      const reason = error instanceof Error ? error.message : String(error);
      throw AppError.validation(`Columna "${column}": ${reason}`);
    }
  }

  const missing = missingRequired(mapping, fields);
  if (missing.length > 0) {
    throw AppError.validation(`Sin asignar: ${missing.map((f) => f.label).join(', ')}`);
  }
  return result;
};

/**
 * Traduce el error de un esquema a una línea legible para el informe.
 *
 * Sin esto, la celda de "motivo" muestra el JSON crudo de la librería de
 * validación: cincuenta caracteres de expresión regular donde debería poner
 * "Correo: no tiene un formato válido". Un informe de errores que no se entiende
 * no sirve para corregir el fichero, que es su único propósito.
 */
export interface ValidationIssue {
  path: readonly PropertyKey[];
  code?: string;
  message?: string;
}

export const describeIssues = (
  issues: readonly ValidationIssue[],
  fields: readonly ImportField[],
): string =>
  issues
    .map((issue) => {
      const key = String(issue.path[0] ?? '');
      const label = fields.find((f) => f.key === key)?.label ?? key;
      return label ? `${label}: ${describeIssue(issue)}` : describeIssue(issue);
    })
    .join('; ');

const describeIssue = (issue: ValidationIssue): string => {
  switch (issue.code) {
    case 'invalid_format':
      return 'no tiene un formato válido';
    case 'too_big':
      return 'es demasiado largo';
    case 'too_small':
      return 'está vacío o es demasiado corto';
    case 'invalid_value':
      return 'no es uno de los valores admitidos';
    case 'invalid_type':
      return 'falta o no es del tipo esperado';
    default:
      return issue.message ?? 'no es válido';
  }
};
