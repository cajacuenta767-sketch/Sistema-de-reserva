import { AppError, newId, type Clock } from '@erp/core';
import type { ListQuery } from '@erp/contracts';
import type { Tx } from '../../../../platform/db/unitOfWork.js';
import type { RequestContext } from '../../../../platform/authz/RequestContext.js';
import type { AuditRecorder } from '../../../../platform/audit/AuditRecorder.js';
import { assertCan } from '../../../../platform/authz/scope.js';
import type { ListResult } from '../../../../platform/http/list.js';
import {
  assertValidPucCode,
  defaultNatureFor,
  parentCodeOf,
  typeForCode,
  type AccountNature,
} from '../../domain/Account.js';
import { ACCOUNT_ROLES, accountRole, type AccountRole } from '../../domain/AccountRoles.js';
import { COLOMBIAN_PUC, resolvePucAccount } from '../../domain/Puc.js';
import type {
  AccountRecord,
  AccountRepository,
  JournalRecord,
  JournalRepository,
  MappingRepository,
} from '../ports/AccountingRepositories.js';

export interface AccountInput {
  code: string;
  name: string;
  nature?: AccountNature;
  isPostable?: boolean;
  isActive?: boolean;
  requiresParty?: boolean;
  requiresCostCenter?: boolean;
  isCash?: boolean;
  description?: string | null;
}

export interface AccountNode extends AccountRecord {
  children: AccountNode[];
}

export class ChartUseCases {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly mappings: MappingRepository,
    private readonly audit: AuditRecorder,
    private readonly clock: Clock,
  ) {}

  async list(ctx: RequestContext, tx: Tx, query: ListQuery): Promise<ListResult<Record<string, unknown>>> {
    assertCan(ctx, 'accounting:account:read');
    return this.accounts.list(tx, query);
  }

  /**
   * El plan de cuentas como árbol.
   *
   * Se arma en Node a partir de una sola consulta ordenada por código. La
   * alternativa —una consulta recursiva por nivel— haría cuatro viajes para
   * devolver lo mismo, y el plan entero de una empresa cabe holgadamente en
   * memoria: son cientos de filas, no millones.
   */
  async tree(ctx: RequestContext, tx: Tx, onlyActive = false): Promise<AccountNode[]> {
    assertCan(ctx, 'accounting:account:read');
    const flat = await this.accounts.tree(tx, onlyActive);
    const nodes = new Map<string, AccountNode>(
      flat.map((a) => [a.id, { ...a, children: [] as AccountNode[] }]),
    );
    const roots: AccountNode[] = [];
    for (const account of flat) {
      const node = nodes.get(account.id);
      if (!node) continue;
      const parent = account.parentId ? nodes.get(account.parentId) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    return roots;
  }

  async get(ctx: RequestContext, tx: Tx, id: string): Promise<AccountRecord> {
    assertCan(ctx, 'accounting:account:read');
    const account = await this.accounts.byId(tx, id);
    if (!account) throw AppError.notFound('Cuenta contable');
    return account;
  }

  /**
   * Crea una cuenta.
   *
   * El padre sale del código, no de quien la crea: en el PUC la jerarquía ES el
   * código, y dejar elegir un padre distinto permitiría colgar `413595` de
   * `1105`, con lo que el ingreso sumaría dentro del activo y el balance
   * cuadraría estando mal.
   */
  async create(ctx: RequestContext, tx: Tx, input: AccountInput): Promise<AccountRecord> {
    assertCan(ctx, 'accounting:account:create');
    const code = input.code.trim();
    assertValidPucCode(code);

    const existing = await this.accounts.byCode(tx, code);
    if (existing) throw AppError.conflict(`Ya existe la cuenta ${code} (${existing.name})`);

    const type = typeForCode(code);
    if (!type) throw AppError.validation(`El código ${code} no pertenece a ninguna clase del PUC`);

    const parentCode = parentCodeOf(code);
    let parentId: string | null = null;
    if (parentCode !== null) {
      const parent = await this.accounts.byCode(tx, parentCode);
      if (!parent) {
        throw AppError.rule(
          `No se puede crear ${code} sin que exista antes su cuenta madre ${parentCode}`,
        );
      }
      if (await this.accounts.hasMovements(tx, parent.id)) {
        throw AppError.rule(
          `La cuenta ${parentCode} ya tiene movimientos: colgarle subcuentas duplicaría su saldo`,
        );
      }
      parentId = parent.id;
    }

    const account: AccountRecord = {
      id: newId(),
      organizationId: ctx.organizationId,
      code,
      name: input.name.trim(),
      parentId,
      level: code.length,
      type,
      nature: input.nature ?? defaultNatureFor(type),
      // Una cuenta nueva recibe movimiento salvo que se diga lo contrario: si
      // luego le cuelgan hijas, deja de hacerlo y el disparador lo garantiza.
      isPostable: input.isPostable ?? true,
      isActive: input.isActive ?? true,
      requiresParty: input.requiresParty ?? false,
      requiresCostCenter: input.requiresCostCenter ?? false,
      isCash: input.isCash ?? false,
      description: input.description ?? null,
    };

    await this.accounts.create(tx, account);
    // La madre deja de recibir movimiento en cuanto tiene una hija.
    if (parentId) {
      const parent = await this.accounts.byId(tx, parentId);
      if (parent?.isPostable) await this.accounts.update(tx, { ...parent, isPostable: false });
    }

    await this.audit.record(tx, ctx, {
      action: 'CREATE',
      entityType: 'account',
      entityId: account.id,
      entityLabel: `${account.code} · ${account.name}`,
      after: { codigo: account.code, nombre: account.name, naturaleza: account.nature },
    });
    return account;
  }

  /**
   * Modifica una cuenta.
   *
   * El CÓDIGO no se cambia. Renumerar una cuenta con movimientos reescribiría
   * la historia: los asientos ya contabilizados apuntan a ella, y el balance
   * del año pasado pasaría a decir otra cosa. Para renumerar se crea la nueva y
   * se traslada el saldo con un asiento, que es lo que un contador espera ver.
   */
  async update(
    ctx: RequestContext,
    tx: Tx,
    id: string,
    input: Partial<AccountInput>,
  ): Promise<AccountRecord> {
    assertCan(ctx, 'accounting:account:update');
    const before = await this.get(ctx, tx, id);

    if (input.code !== undefined && input.code.trim() !== before.code) {
      throw AppError.rule(
        `El código de una cuenta no se cambia (${before.code}). ` +
          'Crea la cuenta nueva y traslada el saldo con un asiento.',
      );
    }

    const hasChildren = await this.accounts.hasChildren(tx, id);
    if (input.isPostable === true && hasChildren) {
      throw AppError.rule(
        `${before.code} tiene subcuentas: si recibiera movimiento, su saldo se contaría dos veces`,
      );
    }

    const hasMovements = await this.accounts.hasMovements(tx, id);
    if (input.nature !== undefined && input.nature !== before.nature && hasMovements) {
      throw AppError.rule(
        `No se puede cambiar la naturaleza de ${before.code}: ya tiene movimientos y ` +
          'su saldo cambiaría de signo en informes ya emitidos',
      );
    }

    const updated: AccountRecord = {
      ...before,
      name: input.name?.trim() ?? before.name,
      nature: input.nature ?? before.nature,
      isActive: input.isActive ?? before.isActive,
      isPostable: hasChildren ? false : (input.isPostable ?? before.isPostable),
      requiresParty: input.requiresParty ?? before.requiresParty,
      requiresCostCenter: input.requiresCostCenter ?? before.requiresCostCenter,
      isCash: input.isCash ?? before.isCash,
      description: input.description !== undefined ? input.description : before.description,
    };

    await this.accounts.update(tx, updated);
    await this.audit.record(tx, ctx, {
      action: 'UPDATE',
      entityType: 'account',
      entityId: id,
      entityLabel: `${updated.code} · ${updated.name}`,
      before: { nombre: before.name, naturaleza: before.nature, activa: before.isActive },
      after: { nombre: updated.name, naturaleza: updated.nature, activa: updated.isActive },
    });
    return updated;
  }

  /** Una cuenta con movimientos no se borra: se desactiva y deja de ofrecerse. */
  async remove(ctx: RequestContext, tx: Tx, id: string): Promise<void> {
    assertCan(ctx, 'accounting:account:delete');
    const account = await this.get(ctx, tx, id);

    if (await this.accounts.hasMovements(tx, id)) {
      throw AppError.rule(
        `${account.code} tiene movimientos contabilizados y no se puede borrar. ` +
          'Desactívala: dejará de aparecer al contabilizar y su historia seguirá intacta.',
      );
    }
    if (await this.accounts.hasChildren(tx, id)) {
      throw AppError.rule(`${account.code} tiene subcuentas: bórralas o desactívalas primero`);
    }

    await this.accounts.softDelete(tx, id);
    await this.audit.record(tx, ctx, {
      action: 'DELETE',
      entityType: 'account',
      entityId: id,
      entityLabel: `${account.code} · ${account.name}`,
      before: { codigo: account.code, nombre: account.name },
    });
  }

  // ── Cuentas por operación ─────────────────────────────────────────────────

  async roles(
    ctx: RequestContext,
    tx: Tx,
  ): Promise<
    Array<{
      role: string;
      label: string;
      usedFor: string;
      required: boolean;
      accountId: string | null;
      accountCode: string | null;
      accountName: string | null;
    }>
  > {
    assertCan(ctx, 'accounting:account:read');
    const configured = await this.mappings.all(tx);
    const accounts = await this.accounts.tree(tx, false);
    const byId = new Map(accounts.map((a) => [a.id, a]));

    return ACCOUNT_ROLES.map((def) => {
      const accountId = configured.get(def.role) ?? null;
      const account = accountId ? byId.get(accountId) : undefined;
      return {
        role: def.role,
        label: def.label,
        usedFor: def.usedFor,
        required: def.required,
        accountId,
        accountCode: account?.code ?? null,
        accountName: account?.name ?? null,
      };
    });
  }

  async setRole(
    ctx: RequestContext,
    tx: Tx,
    role: AccountRole,
    accountId: string,
  ): Promise<void> {
    assertCan(ctx, 'accounting:account:update');
    const def = accountRole(role);
    const account = await this.accounts.byId(tx, accountId);
    if (!account) throw AppError.notFound('Cuenta contable');

    // Un rol apuntando a una cuenta de agrupación haría fallar cada asiento que
    // lo usara, y el error aparecería al emitir una factura, no al configurarlo.
    if (!account.isPostable) {
      throw AppError.rule(
        `${account.code} es una cuenta de agrupación y no recibe movimiento: ` +
          `no puede ser "${def.label}"`,
      );
    }
    if (!account.isActive) {
      throw AppError.rule(`${account.code} está inactiva y no puede usarse para "${def.label}"`);
    }

    const before = (await this.mappings.all(tx)).get(role) ?? null;
    await this.mappings.set(tx, ctx.organizationId, role, accountId);
    await this.audit.record(tx, ctx, {
      action: 'UPDATE',
      entityType: 'account_mapping',
      entityId: role,
      entityLabel: def.label,
      before: { cuenta: before },
      after: { cuenta: `${account.code} · ${account.name}` },
    });
  }

  // ── Diarios ───────────────────────────────────────────────────────────────

  async journals(ctx: RequestContext, tx: Tx, repo: JournalRepository): Promise<JournalRecord[]> {
    assertCan(ctx, 'accounting:journal:read');
    return repo.all(tx);
  }

  /** Siembra el PUC y las cuentas por operación de una empresa nueva. */
  async seedChart(tx: Tx, organizationId: string): Promise<{ accounts: number; mappings: number }> {
    const accounts = await this.accounts.seed(
      tx,
      organizationId,
      COLOMBIAN_PUC.map((a) => {
        const { type, nature } = resolvePucAccount(a);
        return {
          code: a.code,
          name: a.name,
          level: a.code.length,
          type,
          nature,
          isPostable: a.postable ?? false,
          isActive: true,
          requiresParty: a.requiresParty ?? false,
          requiresCostCenter: false,
          isCash: a.isCash ?? false,
          description: a.description ?? null,
        };
      }),
    );
    const mappings = await this.mappings.seedDefaults(tx, organizationId);
    return { accounts, mappings };
  }

  /** Fecha del reloj inyectado, no del sistema: los tests necesitan fijarla. */
  today(): string {
    return this.clock.now().toISOString().slice(0, 10);
  }
}
