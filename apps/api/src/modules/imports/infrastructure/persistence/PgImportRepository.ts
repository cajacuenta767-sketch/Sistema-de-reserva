import type { ListQuery } from '@erp/contracts';
import type { Tx } from '../../../../platform/db/unitOfWork.js';
import { runList, type ListResult, type ListSpec } from '../../../../platform/http/list.js';
import type { ColumnMapping } from '../../domain/mapping.js';
import type {
  ImportJob,
  ImportRepository,
  ImportRowListRow,
  ImportRowRecord,
  RowStatus,
} from '../../application/ports/ImportRepositories.js';

interface ImportDbRow {
  id: string;
  organization_id: string;
  entity_type: string;
  filename: string;
  mapping: ColumnMapping;
  status: string;
  total_rows: number;
  ok_rows: number;
  error_rows: number;
  created_by: string | null;
  created_at: Date;
  finished_at: Date | null;
}

const fromRow = (r: ImportDbRow): ImportJob => ({
  id: r.id,
  organizationId: r.organization_id,
  entityType: r.entity_type,
  filename: r.filename,
  mapping: r.mapping,
  status: r.status as ImportJob['status'],
  totalRows: r.total_rows,
  okRows: r.ok_rows,
  errorRows: r.error_rows,
  createdBy: r.created_by,
  createdAt: r.created_at,
  finishedAt: r.finished_at,
});

const COLUMNS = `id, organization_id, entity_type, filename, mapping, status,
  total_rows, ok_rows, error_rows, created_by, created_at, finished_at`;

const listSpec = (): ListSpec => ({
  from: `FROM imports i
         LEFT JOIN memberships m ON m.id = i.created_by
         LEFT JOIN users u ON u.id = m.user_id`,
  select: `i.id, i.entity_type, i.filename, i.status, i.total_rows, i.ok_rows, i.error_rows,
           i.created_at, i.finished_at, (u.first_name || ' ' || u.last_name) AS created_by_name`,
  fields: {
    entity_type: { column: 'i.entity_type', type: 'text', sortable: true, filterable: true },
    filename: { column: 'i.filename', type: 'text', sortable: true, filterable: true, searchable: true },
    status: { column: 'i.status', type: 'text', sortable: true, filterable: true },
    created_at: { column: 'i.created_at', type: 'timestamp', sortable: true, filterable: true },
  },
  defaultSort: [{ field: 'created_at', dir: 'desc' }],
});

/**
 * Listado de filas de una importación.
 *
 * Acotado con `baseParams` y no interpolando el id: el identificador viene de la
 * URL, y meterlo en el SQL sería la única inyección que quedaría abierta.
 */
const rowsSpec = (importId: string): ListSpec => ({
  from: 'FROM import_rows r',
  select: 'r.row_no, r.status, r.error, r.created_entity_id, r.raw',
  fields: {
    row_no: { column: 'r.row_no', type: 'number', sortable: true, filterable: true },
    status: { column: 'r.status', type: 'text', sortable: true, filterable: true },
    error: { column: 'r.error', type: 'text', sortable: false, filterable: true, searchable: true },
  },
  baseWhere: ['r.import_id = $1::uuid'],
  baseParams: [importId],
  defaultSort: [{ field: 'row_no', dir: 'asc' }],
  aggregates: {
    ok: `count(*) FILTER (WHERE r.status = 'OK')::int`,
    errors: `count(*) FILTER (WHERE r.status = 'ERROR')::int`,
  },
});

export class PgImportRepository implements ImportRepository {
  async save(tx: Tx, j: ImportJob): Promise<void> {
    await tx.client.query(
      `INSERT INTO imports (id, organization_id, entity_type, filename, mapping, status,
         total_rows, ok_rows, error_rows, created_by, created_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11)`,
      [
        j.id, j.organizationId, j.entityType, j.filename, JSON.stringify(j.mapping), j.status,
        j.totalRows, j.okRows, j.errorRows, j.createdBy, j.createdAt,
      ],
    );
  }

  async update(tx: Tx, j: ImportJob): Promise<void> {
    await tx.client.query(
      `UPDATE imports SET mapping = $2::jsonb, status = $3, total_rows = $4, ok_rows = $5,
         error_rows = $6, finished_at = $7 WHERE id = $1`,
      [j.id, JSON.stringify(j.mapping), j.status, j.totalRows, j.okRows, j.errorRows, j.finishedAt],
    );
  }

  async findById(tx: Tx, id: string): Promise<ImportJob | null> {
    const { rows } = await tx.client.query<ImportDbRow>(
      `SELECT ${COLUMNS} FROM imports WHERE id = $1`,
      [id],
    );
    return rows[0] ? fromRow(rows[0]) : null;
  }

  async list(tx: Tx, query: ListQuery): Promise<ListResult<Record<string, unknown>>> {
    return runList(tx, listSpec(), query, {});
  }

  /**
   * Guarda todas las filas en UNA sentencia.
   *
   * Un INSERT por fila haría 5.000 viajes a la base para un fichero mediano y
   * tardaría más que la propia importación. Se trocea porque PostgreSQL admite
   * como máximo 65.535 parámetros por sentencia, y a cinco por fila el límite
   * llega antes de lo que parece.
   */
  async saveRows(
    tx: Tx,
    importId: string,
    organizationId: string,
    rows: readonly ImportRowRecord[],
  ): Promise<void> {
    const CHUNK = 500;
    for (let start = 0; start < rows.length; start += CHUNK) {
      const chunk = rows.slice(start, start + CHUNK);
      const values: unknown[] = [];
      const placeholders = chunk.map((row, index) => {
        const base = index * 4;
        values.push(organizationId, importId, row.rowNo, JSON.stringify(row.raw));
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}::jsonb)`;
      });
      await tx.client.query(
        `INSERT INTO import_rows (organization_id, import_id, row_no, raw)
         VALUES ${placeholders.join(', ')}`,
        values,
      );
    }
  }

  async listRows(tx: Tx, query: ListQuery, importId: string): Promise<ListResult<ImportRowListRow>> {
    return runList<ImportRowListRow>(tx, rowsSpec(importId), query, {});
  }

  async pendingRows(tx: Tx, importId: string, limit: number): Promise<ImportRowRecord[]> {
    const { rows } = await tx.client.query<{
      row_no: number;
      raw: Record<string, string>;
      status: string;
      error: string | null;
      created_entity_id: string | null;
    }>(
      `SELECT row_no, raw, status, error, created_entity_id FROM import_rows
        WHERE import_id = $1 AND status = 'PENDING' ORDER BY row_no LIMIT $2`,
      [importId, limit],
    );
    return rows.map((r) => ({
      rowNo: r.row_no,
      raw: r.raw,
      status: r.status as RowStatus,
      error: r.error,
      createdEntityId: r.created_entity_id,
    }));
  }

  async markRow(
    tx: Tx,
    importId: string,
    rowNo: number,
    status: RowStatus,
    error: string | null,
    entityId: string | null,
  ): Promise<void> {
    await tx.client.query(
      `UPDATE import_rows SET status = $3, error = $4, created_entity_id = $5
        WHERE import_id = $1 AND row_no = $2`,
      [importId, rowNo, status, error, entityId],
    );
  }

  async counts(
    tx: Tx,
    importId: string,
  ): Promise<{ total: number; ok: number; error: number; pending: number }> {
    const { rows } = await tx.client.query<{ total: string; ok: string; error: string; pending: string }>(
      `SELECT count(*)::text AS total,
              count(*) FILTER (WHERE status = 'OK')::text AS ok,
              count(*) FILTER (WHERE status = 'ERROR')::text AS error,
              count(*) FILTER (WHERE status = 'PENDING')::text AS pending
         FROM import_rows WHERE import_id = $1`,
      [importId],
    );
    const r = rows[0];
    return {
      total: Number(r?.total ?? 0),
      ok: Number(r?.ok ?? 0),
      error: Number(r?.error ?? 0),
      pending: Number(r?.pending ?? 0),
    };
  }

  async delete(tx: Tx, id: string): Promise<void> {
    await tx.client.query('DELETE FROM imports WHERE id = $1', [id]);
  }
}
