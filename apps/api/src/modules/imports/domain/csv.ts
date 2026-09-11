import { AppError } from '@erp/core';

/**
 * Lector de CSV.
 *
 * Se escribe a mano en lugar de usar una librería porque el problema real no es
 * partir por comas, sino todo lo que traen los ficheros que la gente exporta de
 * verdad, y eso hay que decidirlo explícitamente:
 *
 *  · **Punto y coma.** Excel en español usa `;` como separador, porque la coma
 *    es el separador decimal. Un lector que asuma `,` deja cada fila en una sola
 *    columna gigante, y el usuario no entiende por qué "el archivo está mal".
 *  · **BOM.** Excel antepone U+FEFF en UTF-8, un carácter invisible que se pega
 *    a la primera cabecera: "Nombre" deja de casar con nada y no se ve por qué.
 *  · **Comillas.** Un campo entrecomillado puede contener el separador, saltos de
 *    línea y comillas dobladas (`""`). Es lo que trae cualquier dirección.
 *  · **CRLF.** Los ficheros de Windows terminan en `\r\n`; sin quitarlo, el
 *    último valor de cada fila arrastra un `\r` invisible que rompe las
 *    comparaciones y no se ve en pantalla.
 */

export interface CsvTable {
  headers: string[];
  rows: string[][];
  delimiter: string;
}

const DELIMITERS = [',', ';', '\t', '|'] as const;

/**
 * Detecta el separador contando cuál produce el mismo número de columnas en las
 * primeras líneas.
 *
 * Contar apariciones a secas se equivoca con datos que contienen comas dentro de
 * comillas ("Bogotá, Colombia"): el candidato correcto no es el más frecuente,
 * sino el que reparte las filas de forma consistente.
 */
export const detectDelimiter = (text: string): string => {
  const sample = text.slice(0, 64 * 1024);
  let best = ',';
  let bestScore = -1;

  for (const delimiter of DELIMITERS) {
    const rows = parseRows(sample, delimiter).slice(0, 20);
    if (rows.length === 0) continue;
    const columns = rows[0]?.length ?? 0;
    if (columns < 2) continue;
    const consistent = rows.filter((r) => r.length === columns).length;
    // Más columnas es mejor, pero solo si todas las filas coinciden: un
    // separador equivocado da recuentos erráticos.
    const score = consistent === rows.length ? columns : 0;
    if (score > bestScore) {
      bestScore = score;
      best = delimiter;
    }
  }
  return best;
};

/** Analiza el texto completo. Con `delimiter` se salta la detección. */
export const parseCsv = (input: string, delimiter?: string): CsvTable => {
  const text = stripBom(input);
  if (text.trim().length === 0) throw AppError.validation('El fichero está vacío');

  const sep = delimiter ?? detectDelimiter(text);
  const rows = parseRows(text, sep);
  const headers = rows.shift();
  if (!headers) throw AppError.validation('El fichero no tiene cabecera');

  const named = dedupeHeaders(headers.map((h) => h.trim()));
  if (named.every((h) => h.length === 0)) {
    throw AppError.validation('La primera fila no parece una cabecera: todas sus celdas están vacías');
  }

  // Se descartan las filas totalmente vacías: casi todo fichero exportado
  // termina con una, y contarla daría un error por cada importación.
  const body = rows.filter((r) => r.some((cell) => cell.trim().length > 0));

  return { headers: named, rows: body, delimiter: sep };
};

const stripBom = (text: string): string => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

/**
 * Dos columnas con el mismo nombre harían que el mapeo apuntara a una de ellas
 * al azar. Se desambiguan en vez de rechazar el fichero: "Teléfono" dos veces es
 * normal (fijo y móvil) y no es culpa de quien lo exporta.
 */
const dedupeHeaders = (headers: string[]): string[] => {
  const seen = new Map<string, number>();
  return headers.map((header) => {
    const count = seen.get(header) ?? 0;
    seen.set(header, count + 1);
    return count === 0 ? header : `${header} (${count + 1})`;
  });
};

/** Máquina de estados carácter a carácter: es lo que permite comillas con saltos dentro. */
const parseRows = (text: string, delimiter: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (quoted) {
      if (char === '"') {
        // `""` dentro de comillas es una comilla literal, no el final del campo.
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field.length === 0) {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field.endsWith('\r') ? field.slice(0, -1) : field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  // Última fila sin salto de línea final.
  if (field.length > 0 || row.length > 0) {
    row.push(field.endsWith('\r') ? field.slice(0, -1) : field);
    rows.push(row);
  }
  return rows;
};

/** Convierte la tabla en objetos `cabecera → valor`, que es como viaja cada fila. */
export const toObjects = (table: CsvTable): Array<Record<string, string>> =>
  table.rows.map((row) => {
    const object: Record<string, string> = {};
    table.headers.forEach((header, index) => {
      object[header] = (row[index] ?? '').trim();
    });
    return object;
  });
