/** API pública del módulo de importación. */
export { importsModule, type ImportsApi } from './module.js';
export { parseCsv, toObjects, detectDelimiter, type CsvTable } from './domain/csv.js';
export {
  applyMapping,
  describeIssues,
  detectDecimalSeparator,
  inferMapping,
  missingRequired,
  normalizeHeader,
  parseBoolean,
  parseDate,
  parseNumber,
  type ColumnMapping,
  type DecimalSeparator,
} from './domain/mapping.js';
