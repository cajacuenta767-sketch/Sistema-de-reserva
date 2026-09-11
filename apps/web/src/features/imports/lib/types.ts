/** Formas que devuelve la API de importación. */

export interface ImportField {
  key: string;
  label: string;
  required?: boolean;
  type?: 'text' | 'number' | 'boolean' | 'date';
  hint?: string;
}

export interface ImportType {
  entityType: string;
  label: string;
  fields: ImportField[];
}

export interface ImportJob {
  id: string;
  entityType: string;
  filename: string;
  mapping: Record<string, string>;
  status: 'PENDING' | 'VALIDATING' | 'READY' | 'RUNNING' | 'DONE' | 'FAILED';
  totalRows: number;
  okRows: number;
  errorRows: number;
  createdAt: string;
  finishedAt: string | null;
}

export interface ImportPreview {
  job: ImportJob;
  headers: string[];
  sample: Array<Record<string, string>>;
  fields: ImportField[];
  /** Campos obligatorios que el mapeo no cubre. */
  missing: string[];
  delimiter: string;
}

export interface ImportRunResult {
  job: ImportJob;
  imported: number;
  failed: number;
  remaining: number;
}

export interface ImportJobRow {
  id: string;
  entity_type: string;
  filename: string;
  status: string;
  total_rows: number;
  ok_rows: number;
  error_rows: number;
  created_at: string;
  finished_at: string | null;
  created_by_name: string | null;
}

export interface ImportRowResult {
  row_no: number;
  status: 'PENDING' | 'OK' | 'ERROR' | 'SKIPPED';
  error: string | null;
  created_entity_id: string | null;
  raw: Record<string, string>;
}
