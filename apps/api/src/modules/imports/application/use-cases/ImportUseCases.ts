import { AppError, newId, type Clock } from '@erp/core';
import type { ListQuery } from '@erp/contracts';
import type { Tx } from '../../../../platform/db/unitOfWork.js';
import type { RequestContext } from '../../../../platform/authz/RequestContext.js';
import type { AuditRecorder } from '../../../../platform/audit/AuditRecorder.js';
import type {
  ImportDefinition,
  ImportField,
  ImportRegistry,
} from '../../../../platform/imports/ImportRegistry.js';
import { assertCan } from '../../../../platform/authz/scope.js';
import type { ListResult } from '../../../../platform/http/list.js';
import { parseCsv, toObjects } from '../../domain/csv.js';
import {
  applyMapping,
  describeIssues,
  detectDecimalSeparator,
  inferMapping,
  missingRequired,
  type ColumnMapping,
  type DecimalSeparator,
  type ValidationIssue,
} from '../../domain/mapping.js';
import type {
  ImportJob,
  ImportRepository,
  ImportRowListRow,
} from '../ports/ImportRepositories.js';

/** Vista previa que devuelve la subida: es lo que la pantalla de mapeo necesita. */
export interface ImportPreview {
  job: ImportJob;
  headers: string[];
  /** Primeras filas tal cual, para que el usuario vea lo que va a importar. */
  sample: Array<Record<string, string>>;
  fields: ImportDefinition['fields'];
  /** Campos obligatorios que el mapeo propuesto no cubre. */
  missing: string[];
  delimiter: string;
}

export interface ImportRunResult {
  job: ImportJob;
  imported: number;
  failed: number;
  /** Quedan filas por procesar: hay que volver a llamar. */
  remaining: number;
}

/** Filas por lote. Suficiente para que un fichero mediano acabe de una vez, y
 *  poco para que una petición no se eternice sin dar señales de vida. */
const BATCH_SIZE = 500;

/** Consulta de listado para uso interno, sin filtros ni orden del usuario. */
const firstRows = (pageSize: number): ListQuery => ({
  page: 1,
  pageSize,
  offset: 0,
  sort: [],
  filters: [],
  all: false,
});

export class ImportUseCases {
  constructor(
    private readonly imports: ImportRepository,
    private readonly registry: ImportRegistry,
    private readonly audit: AuditRecorder,
    private readonly clock: Clock,
  ) {}

  /** Qué se puede importar, con sus campos: alimenta el selector de la pantalla. */
  catalog(ctx: RequestContext): Array<{ entityType: string; label: string; fields: ImportDefinition['fields'] }> {
    return this.registry
      .availableFor(ctx)
      .map((d) => ({ entityType: d.entityType, label: d.label, fields: d.fields }));
  }

  async list(ctx: RequestContext, tx: Tx, query: ListQuery): Promise<ListResult<Record<string, unknown>>> {
    assertCan(ctx, 'platform:import:read');
    return this.imports.list(tx, query);
  }

  /**
   * Sube el fichero: lo analiza, guarda sus filas crudas y propone un mapeo.
   *
   * No crea nada todavía. Separar la subida de la ejecución es lo que permite
   * corregir el mapeo antes de meter 500 registros mal, que es exactamente lo
   * que pasa cuando importar es un solo botón.
   */
  async upload(
    ctx: RequestContext,
    tx: Tx,
    input: { entityType: string; filename: string; content: string; delimiter?: string },
  ): Promise<ImportPreview> {
    const definition = this.requireDefinition(ctx, input.entityType);

    const table = parseCsv(input.content, input.delimiter);
    if (table.rows.length === 0) {
      throw AppError.validation('El fichero tiene cabecera pero ninguna fila de datos');
    }

    const mapping = inferMapping(table.headers, definition.fields);
    const objects = toObjects(table);

    const job: ImportJob = {
      id: newId(),
      organizationId: ctx.organizationId,
      entityType: input.entityType,
      filename: input.filename,
      mapping,
      status: 'READY',
      totalRows: objects.length,
      okRows: 0,
      errorRows: 0,
      createdBy: ctx.membershipId,
      createdAt: this.clock.now(),
      finishedAt: null,
    };

    await this.imports.save(tx, job);
    await this.imports.saveRows(
      tx,
      job.id,
      ctx.organizationId,
      // La numeración empieza en 2 porque la fila 1 del fichero es la cabecera:
      // el número del error tiene que coincidir con el que se ve en Excel.
      objects.map((raw, index) => ({
        rowNo: index + 2,
        raw,
        status: 'PENDING' as const,
        error: null,
        createdEntityId: null,
      })),
    );

    await this.audit.record(tx, ctx, {
      action: 'CREATE',
      entityType: 'import',
      entityId: job.id,
      entityLabel: `${input.filename} (${objects.length} filas)`,
      after: { entityType: input.entityType, filas: objects.length, mapeo: mapping },
    });

    return {
      job,
      headers: table.headers,
      sample: objects.slice(0, 10),
      fields: definition.fields,
      missing: missingRequired(mapping, definition.fields).map((f) => f.label),
      delimiter: table.delimiter,
    };
  }

  async get(ctx: RequestContext, tx: Tx, id: string): Promise<ImportPreview> {
    assertCan(ctx, 'platform:import:read');
    const job = await this.requireJob(tx, id);
    const definition = this.requireDefinition(ctx, job.entityType);

    const rows = await this.imports.listRows(tx, firstRows(10), id);
    const sample = rows.items.map((r) => r.raw);
    const headers = Object.keys(sample[0] ?? {});

    return {
      job,
      headers,
      sample,
      fields: definition.fields,
      missing: missingRequired(job.mapping, definition.fields).map((f) => f.label),
      delimiter: ',',
    };
  }

  async rows(
    ctx: RequestContext,
    tx: Tx,
    id: string,
    query: ListQuery,
  ): Promise<ListResult<ImportRowListRow>> {
    assertCan(ctx, 'platform:import:read');
    await this.requireJob(tx, id);
    return this.imports.listRows(tx, query, id);
  }

  /** Corrige el mapeo antes de ejecutar. */
  async setMapping(ctx: RequestContext, tx: Tx, id: string, mapping: ColumnMapping): Promise<ImportPreview> {
    assertCan(ctx, 'platform:import:create');
    const job = await this.requireJob(tx, id);
    if (job.status === 'DONE' || job.status === 'RUNNING') {
      throw AppError.rule('Esta importación ya se ejecutó: el mapeo no se puede cambiar');
    }
    const definition = this.requireDefinition(ctx, job.entityType);

    const updated: ImportJob = { ...job, mapping, status: 'READY' };
    await this.imports.update(tx, updated);
    return this.get(ctx, tx, id).then((preview) => ({ ...preview, job: updated, fields: definition.fields }));
  }

  /**
   * Ejecuta la importación.
   *
   * Dos decisiones que definen el comportamiento:
   *
   * 1. **Cada fila pasa por el caso de uso real** del módulo, con sus
   *    validaciones, su auditoría y sus eventos. Un camino rápido de inserción
   *    masiva metería datos que la aplicación nunca habría aceptado.
   *
   * 2. **Una fila mala no tumba el lote.** En PostgreSQL, un error dentro de una
   *    transacción la aborta entera: a partir de ahí toda sentencia falla con
   *    "current transaction is aborted". Sin aislar cada fila, el primer NIT
   *    inválido del fichero haría fracasar las 499 correctas que van detrás. Un
   *    SAVEPOINT por fila permite deshacer solo la que falló y seguir.
   */
  async run(ctx: RequestContext, tx: Tx, id: string): Promise<ImportRunResult> {
    assertCan(ctx, 'platform:import:create');
    const job = await this.requireJob(tx, id);
    const definition = this.requireDefinition(ctx, job.entityType);

    const missing = missingRequired(job.mapping, definition.fields);
    if (missing.length > 0) {
      throw AppError.validation(
        `Faltan columnas obligatorias por asignar: ${missing.map((f) => f.label).join(', ')}`,
      );
    }

    const pending = await this.imports.pendingRows(tx, id, BATCH_SIZE);
    const decimal = this.decimalOf(pending.map((r) => r.raw), job.mapping, definition);

    let imported = 0;
    let failed = 0;

    for (const row of pending) {
      const savepoint = `fila_${row.rowNo}`;
      await tx.client.query(`SAVEPOINT ${savepoint}`);
      try {
        const mapped = applyMapping(row.raw, job.mapping, definition.fields, decimal);
        const created = await definition.createOne(tx, ctx, mapped);
        await tx.client.query(`RELEASE SAVEPOINT ${savepoint}`);
        await this.imports.markRow(tx, id, row.rowNo, 'OK', null, created.id);
        imported += 1;
      } catch (error) {
        // Se deshace SOLO esta fila: la transacción vuelve a estar utilizable y
        // las siguientes se procesan con normalidad.
        await tx.client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        await tx.client.query(`RELEASE SAVEPOINT ${savepoint}`);
        await this.imports.markRow(tx, id, row.rowNo, 'ERROR', messageOf(error, definition.fields), null);
        failed += 1;
      }
    }

    const counts = await this.imports.counts(tx, id);
    const finished = counts.pending === 0;
    const updated: ImportJob = {
      ...job,
      status: finished ? 'DONE' : 'RUNNING',
      totalRows: counts.total,
      okRows: counts.ok,
      errorRows: counts.error,
      finishedAt: finished ? this.clock.now() : null,
    };
    await this.imports.update(tx, updated);

    if (finished) {
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entityType: 'import',
        entityId: id,
        entityLabel: job.filename,
        after: { importadas: counts.ok, conError: counts.error, total: counts.total },
      });
    }

    return { job: updated, imported, failed, remaining: counts.pending };
  }

  async remove(ctx: RequestContext, tx: Tx, id: string): Promise<void> {
    assertCan(ctx, 'platform:import:create');
    const job = await this.requireJob(tx, id);
    // Borra el registro de la importación, NO lo que creó: los clientes
    // importados son datos reales desde el momento en que existen.
    await this.imports.delete(tx, id);
    await this.audit.record(tx, ctx, {
      action: 'DELETE',
      entityType: 'import',
      entityId: id,
      entityLabel: job.filename,
      before: { filename: job.filename, filas: job.totalRows },
    });
  }

  // ── Apoyo ─────────────────────────────────────────────────────────────────

  /**
   * Convenio numérico del fichero, deducido de las columnas numéricas.
   *
   * Se decide una sola vez para todo el lote y con todos los valores a la vista:
   * celda a celda, `89.900` es indescifrable.
   */
  private decimalOf(
    rows: ReadonlyArray<Record<string, string>>,
    mapping: ColumnMapping,
    definition: ImportDefinition,
  ): DecimalSeparator {
    const numericColumns = definition.fields
      .filter((f) => f.type === 'number')
      .map((f) => mapping[f.key])
      .filter((c): c is string => Boolean(c));

    const values = rows.flatMap((row) => numericColumns.map((c) => row[c] ?? ''));
    return detectDecimalSeparator(values.filter((v) => v.length > 0));
  }

  private requireDefinition(ctx: RequestContext, entityType: string): ImportDefinition {
    const definition = this.registry.get(entityType);
    if (!definition) {
      const available = this.registry.availableFor(ctx).map((d) => d.entityType);
      throw AppError.validation(`No se puede importar "${entityType}"`, { disponibles: available });
    }
    // El permiso de importar es el MISMO que el de crear a mano: importar no
    // puede ser un atajo para saltarse quién puede crear qué.
    assertCan(ctx, definition.permission);
    return definition;
  }

  private async requireJob(tx: Tx, id: string): Promise<ImportJob> {
    const job = await this.imports.findById(tx, id);
    if (!job) throw AppError.notFound('Importación');
    return job;
  }
}

/** Motivo del fallo de una fila, en una línea que se pueda leer en el informe. */
const messageOf = (error: unknown, fields: readonly ImportField[]): string => {
  // Los errores de esquema llegan con sus `issues`: sin traducirlos, la columna
  // de motivo muestra el JSON crudo de la librería.
  const issues = (error as { issues?: ValidationIssue[] } | null)?.issues;
  if (Array.isArray(issues) && issues.length > 0) return describeIssues(issues, fields);
  if (AppError.is(error)) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
};
