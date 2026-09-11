import type { ListQuery } from '@erp/contracts';
import type { Tx } from '../../../../platform/db/unitOfWork.js';
import type { ListResult } from '../../../../platform/http/list.js';
import type { ColumnMapping } from '../../domain/mapping.js';

export type ImportStatus = 'PENDING' | 'VALIDATING' | 'READY' | 'RUNNING' | 'DONE' | 'FAILED';
export type RowStatus = 'PENDING' | 'OK' | 'ERROR' | 'SKIPPED';

export interface ImportJob {
  id: string;
  organizationId: string;
  entityType: string;
  filename: string;
  mapping: ColumnMapping;
  status: ImportStatus;
  totalRows: number;
  okRows: number;
  errorRows: number;
  createdBy: string | null;
  createdAt: Date;
  finishedAt: Date | null;
}

export interface ImportRowRecord {
  rowNo: number;
  raw: Record<string, string>;
  status: RowStatus;
  error: string | null;
  createdEntityId: string | null;
}

export interface ImportRowListRow extends Record<string, unknown> {
  row_no: number;
  status: string;
  error: string | null;
  created_entity_id: string | null;
  raw: Record<string, string>;
}

export interface ImportRepository {
  save(tx: Tx, job: ImportJob): Promise<void>;
  update(tx: Tx, job: ImportJob): Promise<void>;
  findById(tx: Tx, id: string): Promise<ImportJob | null>;
  list(tx: Tx, query: ListQuery): Promise<ListResult<Record<string, unknown>>>;
  saveRows(tx: Tx, importId: string, organizationId: string, rows: readonly ImportRowRecord[]): Promise<void>;
  listRows(tx: Tx, query: ListQuery, importId: string): Promise<ListResult<ImportRowListRow>>;
  pendingRows(tx: Tx, importId: string, limit: number): Promise<ImportRowRecord[]>;
  markRow(
    tx: Tx,
    importId: string,
    rowNo: number,
    status: RowStatus,
    error: string | null,
    entityId: string | null,
  ): Promise<void>;
  /** Recuento por estado, para no llevar la cuenta en memoria. */
  counts(tx: Tx, importId: string): Promise<{ total: number; ok: number; error: number; pending: number }>;
  delete(tx: Tx, id: string): Promise<void>;
}
