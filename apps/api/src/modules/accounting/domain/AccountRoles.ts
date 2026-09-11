/**
 * Los ROLES que el motor de contabilización sabe pedir.
 *
 * El motor nunca nombra un código del PUC. Pide "la cuenta de clientes" y una
 * tabla de configuración responde cuál es en esta empresa. La diferencia
 * importa el día que una empresa adopte NIIF plenas o cambie de plan: con
 * códigos incrustados en el código fuente habría que reescribir el motor; con
 * roles, se cambia una fila.
 *
 * Cada rol es también una PREGUNTA que el sistema tiene que poder responder
 * antes de emitir la primera factura. Por eso la siembra los deja todos
 * resueltos con los valores del PUC colombiano, y la pantalla de configuración
 * permite cambiarlos.
 */

export interface AccountRoleDef {
  role: string;
  label: string;
  /** Cuenta del PUC colombiano con la que se siembra. */
  defaultCode: string;
  /** Si falta, no se puede contabilizar lo que dice `usedFor`. */
  required: boolean;
  usedFor: string;
}

export const ACCOUNT_ROLES = [
  {
    role: 'RECEIVABLES',
    label: 'Cartera de clientes',
    defaultCode: '130505',
    required: true,
    usedFor: 'Lo que los clientes deben al emitir una factura',
  },
  {
    role: 'PAYABLES',
    label: 'Cuentas por pagar a proveedores',
    defaultCode: '220505',
    required: true,
    usedFor: 'Lo que se debe a proveedores al registrar una factura de compra',
  },
  {
    role: 'SALES_GOODS',
    label: 'Ingresos por venta de mercancías',
    defaultCode: '413595',
    required: true,
    usedFor: 'El ingreso de las líneas de producto',
  },
  {
    role: 'SALES_SERVICES',
    label: 'Ingresos por servicios',
    defaultCode: '417005',
    required: true,
    usedFor: 'El ingreso de las líneas de servicio',
  },
  {
    role: 'SALES_RETURNS',
    label: 'Devoluciones en ventas',
    defaultCode: '417505',
    required: true,
    usedFor: 'El menor ingreso que produce una nota de crédito',
  },
  {
    role: 'VAT_OUTPUT',
    label: 'IVA generado',
    defaultCode: '240805',
    required: true,
    usedFor: 'El IVA cobrado al cliente, que se le debe a la DIAN',
  },
  {
    role: 'VAT_INPUT',
    label: 'IVA descontable',
    defaultCode: '240810',
    required: true,
    usedFor: 'El IVA pagado a proveedores, que resta del generado',
  },
  {
    role: 'CONSUMPTION_TAX',
    label: 'Impuesto nacional al consumo por pagar',
    defaultCode: '249505',
    required: false,
    usedFor: 'El INC de bares, restaurantes y algunos bienes',
  },
  {
    role: 'WITHHOLDING_INCOME_ASSET',
    label: 'Retención en la fuente que nos practican',
    defaultCode: '135515',
    required: true,
    usedFor: 'La ReteFuente que el cliente descuenta al pagarnos',
  },
  {
    role: 'WITHHOLDING_VAT_ASSET',
    label: 'ReteIVA que nos practican',
    defaultCode: '135517',
    required: true,
    usedFor: 'El ReteIVA que el cliente descuenta al pagarnos',
  },
  {
    role: 'WITHHOLDING_ICA_ASSET',
    label: 'ReteICA que nos practican',
    defaultCode: '135518',
    required: true,
    usedFor: 'El ReteICA que el cliente descuenta al pagarnos',
  },
  {
    role: 'WITHHOLDING_INCOME_LIABILITY',
    label: 'Retención en la fuente que practicamos',
    defaultCode: '236540',
    required: true,
    usedFor: 'La ReteFuente que se descuenta al proveedor y se consigna a la DIAN',
  },
  {
    role: 'WITHHOLDING_VAT_LIABILITY',
    label: 'ReteIVA que practicamos',
    defaultCode: '236701',
    required: true,
    usedFor: 'El ReteIVA que se descuenta al proveedor',
  },
  {
    role: 'WITHHOLDING_ICA_LIABILITY',
    label: 'ReteICA que practicamos',
    defaultCode: '236801',
    required: true,
    usedFor: 'El ReteICA que se descuenta al proveedor',
  },
  {
    role: 'BANK',
    label: 'Banco por defecto',
    defaultCode: '111005',
    required: true,
    usedFor: 'Cobros y pagos por transferencia mientras no se elija otra cuenta',
  },
  {
    role: 'CASH',
    label: 'Caja',
    defaultCode: '110505',
    required: true,
    usedFor: 'Cobros y pagos en efectivo',
  },
  {
    role: 'CUSTOMER_ADVANCES',
    label: 'Anticipos de clientes',
    defaultCode: '280505',
    required: true,
    usedFor: 'El dinero cobrado que todavía no imputa a ninguna factura',
  },
  {
    role: 'SUPPLIER_ADVANCES',
    label: 'Anticipos a proveedores',
    defaultCode: '133005',
    required: false,
    usedFor: 'El dinero pagado por adelantado a un proveedor',
  },
  {
    role: 'INVENTORY',
    label: 'Inventario de mercancías',
    defaultCode: '143501',
    required: false,
    usedFor: 'El valor de la mercancía en bodega',
  },
  {
    role: 'COST_OF_GOODS',
    label: 'Costo de mercancía vendida',
    defaultCode: '613595',
    required: false,
    usedFor: 'El costo que se reconoce al vender',
  },
  {
    role: 'PURCHASES',
    label: 'Compras de mercancía',
    defaultCode: '620505',
    required: false,
    usedFor: 'La compra de mercancía cuando no se lleva inventario permanente',
  },
  {
    role: 'FX_GAIN',
    label: 'Ingreso por diferencia en cambio',
    defaultCode: '421040',
    required: false,
    usedFor: 'La ganancia al cobrar en otra moneda a una tasa distinta',
  },
  {
    role: 'FX_LOSS',
    label: 'Gasto por diferencia en cambio',
    defaultCode: '530525',
    required: false,
    usedFor: 'La pérdida al cobrar en otra moneda a una tasa distinta',
  },
  {
    role: 'ROUNDING',
    label: 'Ajuste al peso',
    defaultCode: '539595',
    required: true,
    usedFor: 'El residuo de centavos al convertir a la moneda funcional',
  },
  {
    role: 'YEAR_PROFIT',
    label: 'Utilidad del ejercicio',
    defaultCode: '360505',
    required: true,
    usedFor: 'El resultado contra el que se cierran ingresos y gastos',
  },
  {
    role: 'YEAR_LOSS',
    label: 'Pérdida del ejercicio',
    defaultCode: '361005',
    required: true,
    usedFor: 'El resultado negativo del cierre anual',
  },
  {
    role: 'RETAINED_EARNINGS',
    label: 'Utilidades acumuladas',
    defaultCode: '370505',
    required: true,
    usedFor: 'A donde va el resultado al abrir el año siguiente',
  },
] as const satisfies readonly AccountRoleDef[];

export type AccountRole = (typeof ACCOUNT_ROLES)[number]['role'];

export const accountRole = (role: AccountRole): AccountRoleDef => {
  const def = ACCOUNT_ROLES.find((r) => r.role === role);
  if (!def) throw new Error(`Rol contable desconocido: ${role}`);
  return def;
};

export const REQUIRED_ROLES: readonly AccountRole[] = ACCOUNT_ROLES.filter((r) => r.required).map(
  (r) => r.role,
);
