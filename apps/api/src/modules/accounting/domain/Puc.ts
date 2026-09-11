import type { AccountNature, AccountType } from './Account.js';
import { defaultNatureFor, typeForCode } from './Account.js';

/**
 * Plan Único de Cuentas colombiano (Decreto 2650 de 1993).
 *
 * Se siembra POR EMPRESA, no una vez para todas. El PUC es el mismo para todo
 * el país, pero cada empresa le cuelga sus propias subcuentas —un banco nuevo,
 * una línea de ingreso— y necesita poder desactivar lo que no usa sin afectar a
 * las demás. Compartir una única tabla haría que abrir una cuenta en Bancolombia
 * apareciera en el plan de cuentas de todos los clientes del sistema.
 *
 * Esta es la parte del PUC que una pyme de comercio o servicios usa de verdad,
 * no el decreto entero: sembrar 700 cuentas que nadie va a tocar convierte el
 * selector de cuentas en un listado inútil. Las que falten se crean desde la
 * pantalla, que para eso existe.
 */

export interface PucAccount {
  code: string;
  name: string;
  /** Solo las hojas. Las de agrupación se calculan sumando sus hijas. */
  postable?: boolean;
  /** Contradice la naturaleza de su clase: cuentas de valuación y devoluciones. */
  nature?: AccountNature;
  requiresParty?: boolean;
  isCash?: boolean;
  description?: string;
}

export const COLOMBIAN_PUC: readonly PucAccount[] = [
  // ── 1 · ACTIVO ────────────────────────────────────────────────────────────
  { code: '1', name: 'Activo' },
  { code: '11', name: 'Disponible' },
  { code: '1105', name: 'Caja' },
  { code: '110505', name: 'Caja general', postable: true, isCash: true },
  { code: '110510', name: 'Caja menor', postable: true, isCash: true },
  { code: '1110', name: 'Bancos' },
  { code: '111005', name: 'Moneda nacional', postable: true, isCash: true },
  { code: '111010', name: 'Moneda extranjera', postable: true, isCash: true },
  { code: '1120', name: 'Cuentas de ahorro' },
  { code: '112005', name: 'Bancos', postable: true, isCash: true },

  { code: '12', name: 'Inversiones' },
  { code: '1205', name: 'Acciones' },
  { code: '120505', name: 'Acciones', postable: true },

  { code: '13', name: 'Deudores' },
  { code: '1305', name: 'Clientes' },
  {
    code: '130505',
    name: 'Clientes nacionales',
    postable: true,
    requiresParty: true,
    description: 'La cartera. Cada movimiento exige tercero: sin él no hay a quién cobrarle.',
  },
  { code: '130510', name: 'Clientes del exterior', postable: true, requiresParty: true },
  { code: '1330', name: 'Anticipos y avances' },
  { code: '133005', name: 'A proveedores', postable: true, requiresParty: true },
  { code: '133015', name: 'A trabajadores', postable: true, requiresParty: true },
  { code: '1355', name: 'Anticipo de impuestos y contribuciones' },
  { code: '135505', name: 'Anticipo de impuesto de renta', postable: true },
  {
    code: '135515',
    name: 'Retención en la fuente',
    postable: true,
    description: 'La que nos practican los clientes. Es un activo: se descuenta de la renta del año.',
  },
  { code: '135517', name: 'Impuesto a las ventas retenido', postable: true },
  { code: '135518', name: 'Impuesto de industria y comercio retenido', postable: true },
  { code: '1365', name: 'Cuentas por cobrar a trabajadores' },
  { code: '136505', name: 'Préstamos a trabajadores', postable: true, requiresParty: true },
  { code: '1380', name: 'Deudores varios' },
  { code: '138095', name: 'Otros deudores', postable: true, requiresParty: true },
  { code: '1399', name: 'Provisiones' },
  {
    code: '139905',
    name: 'Provisión de cartera',
    postable: true,
    nature: 'CREDIT',
    description: 'Cuenta de valuación: es un activo que resta. Por eso su naturaleza es crédito.',
  },

  { code: '14', name: 'Inventarios' },
  { code: '1405', name: 'Materias primas' },
  { code: '140505', name: 'Materias primas', postable: true },
  { code: '1430', name: 'Productos terminados' },
  { code: '143005', name: 'Productos terminados', postable: true },
  { code: '1435', name: 'Mercancías no fabricadas por la empresa' },
  { code: '143501', name: 'Mercancías para la venta', postable: true },

  { code: '15', name: 'Propiedades, planta y equipo' },
  { code: '1504', name: 'Terrenos' },
  { code: '150405', name: 'Terrenos', postable: true },
  { code: '1516', name: 'Construcciones y edificaciones' },
  { code: '151605', name: 'Edificios', postable: true },
  { code: '1524', name: 'Equipo de oficina' },
  { code: '152405', name: 'Muebles y enseres', postable: true },
  { code: '1528', name: 'Equipo de computación y comunicación' },
  { code: '152805', name: 'Equipo de procesamiento de datos', postable: true },
  { code: '1540', name: 'Flota y equipo de transporte' },
  { code: '154005', name: 'Vehículos', postable: true },
  { code: '1592', name: 'Depreciación acumulada', nature: 'CREDIT' },
  { code: '159205', name: 'Construcciones y edificaciones', postable: true, nature: 'CREDIT' },
  { code: '159215', name: 'Equipo de oficina', postable: true, nature: 'CREDIT' },
  { code: '159220', name: 'Equipo de computación y comunicación', postable: true, nature: 'CREDIT' },
  { code: '159235', name: 'Flota y equipo de transporte', postable: true, nature: 'CREDIT' },

  { code: '17', name: 'Diferidos' },
  { code: '1705', name: 'Gastos pagados por anticipado' },
  { code: '170520', name: 'Seguros y fianzas', postable: true },

  // ── 2 · PASIVO ────────────────────────────────────────────────────────────
  { code: '2', name: 'Pasivo' },
  { code: '21', name: 'Obligaciones financieras' },
  { code: '2105', name: 'Bancos nacionales' },
  { code: '210505', name: 'Sobregiros', postable: true },
  { code: '210510', name: 'Pagarés', postable: true },

  { code: '22', name: 'Proveedores' },
  { code: '2205', name: 'Nacionales' },
  { code: '220505', name: 'Proveedores nacionales', postable: true, requiresParty: true },
  { code: '2210', name: 'Del exterior' },
  { code: '221005', name: 'Proveedores del exterior', postable: true, requiresParty: true },

  { code: '23', name: 'Cuentas por pagar' },
  { code: '2335', name: 'Costos y gastos por pagar' },
  { code: '233525', name: 'Honorarios', postable: true, requiresParty: true },
  { code: '233595', name: 'Otros costos y gastos por pagar', postable: true, requiresParty: true },
  {
    code: '2365',
    name: 'Retención en la fuente',
    description: 'La que NOSOTROS practicamos a terceros. Es un pasivo: hay que consignarla a la DIAN.',
  },
  { code: '236505', name: 'Salarios y pagos laborales', postable: true },
  { code: '236515', name: 'Honorarios', postable: true },
  { code: '236520', name: 'Comisiones', postable: true },
  { code: '236525', name: 'Servicios', postable: true },
  { code: '236530', name: 'Arrendamientos', postable: true },
  { code: '236540', name: 'Compras', postable: true },
  { code: '236570', name: 'Pagos al exterior', postable: true },
  { code: '236595', name: 'Otras retenciones', postable: true },
  { code: '2367', name: 'Impuesto a las ventas retenido' },
  { code: '236701', name: 'Retención de IVA', postable: true },
  { code: '2368', name: 'Impuesto de industria y comercio retenido' },
  { code: '236801', name: 'Retención de ICA', postable: true },
  { code: '2370', name: 'Retenciones y aportes de nómina' },
  { code: '237005', name: 'Aportes a EPS', postable: true },
  { code: '237006', name: 'Aportes a fondos de pensiones', postable: true },
  { code: '237010', name: 'Aportes a ARL', postable: true },
  { code: '237025', name: 'Embargos judiciales', postable: true },
  { code: '237030', name: 'Libranzas', postable: true },

  { code: '24', name: 'Impuestos, gravámenes y tasas' },
  { code: '2404', name: 'De renta y complementarios' },
  { code: '240405', name: 'Impuesto de renta por pagar', postable: true },
  { code: '2408', name: 'Impuesto sobre las ventas por pagar' },
  {
    code: '240805',
    name: 'IVA generado',
    postable: true,
    description: 'El IVA que se cobra al cliente. No es ingreso: se recauda para la DIAN.',
  },
  {
    code: '240810',
    name: 'IVA descontable',
    postable: true,
    nature: 'DEBIT',
    description: 'El IVA pagado a proveedores, que resta del generado. Por eso es débito dentro de un pasivo.',
  },
  { code: '2412', name: 'De industria y comercio' },
  { code: '241205', name: 'Impuesto de industria y comercio por pagar', postable: true },
  { code: '2495', name: 'Otros impuestos' },
  { code: '249505', name: 'Impuesto nacional al consumo por pagar', postable: true },

  { code: '25', name: 'Obligaciones laborales' },
  { code: '2505', name: 'Salarios por pagar' },
  { code: '250505', name: 'Salarios por pagar', postable: true, requiresParty: true },
  { code: '2510', name: 'Cesantías consolidadas' },
  { code: '251005', name: 'Cesantías consolidadas', postable: true },
  { code: '2515', name: 'Intereses sobre cesantías' },
  { code: '251505', name: 'Intereses sobre cesantías', postable: true },
  { code: '2520', name: 'Prima de servicios' },
  { code: '252005', name: 'Prima de servicios', postable: true },
  { code: '2525', name: 'Vacaciones consolidadas' },
  { code: '252505', name: 'Vacaciones consolidadas', postable: true },

  { code: '28', name: 'Otros pasivos' },
  { code: '2805', name: 'Anticipos y avances recibidos' },
  {
    code: '280505',
    name: 'Anticipos de clientes',
    postable: true,
    requiresParty: true,
    description: 'Dinero cobrado sin factura que lo respalde. Es una deuda con el cliente, no un ingreso.',
  },
  { code: '2815', name: 'Ingresos recibidos para terceros' },
  { code: '281505', name: 'Ingresos recibidos para terceros', postable: true, requiresParty: true },

  // ── 3 · PATRIMONIO ────────────────────────────────────────────────────────
  { code: '3', name: 'Patrimonio' },
  { code: '31', name: 'Capital social' },
  { code: '3105', name: 'Capital suscrito y pagado' },
  { code: '310505', name: 'Capital autorizado', postable: true },
  { code: '3115', name: 'Aportes sociales' },
  { code: '311505', name: 'Cuotas o partes de interés social', postable: true },
  { code: '33', name: 'Reservas' },
  { code: '3305', name: 'Reservas obligatorias' },
  { code: '330505', name: 'Reserva legal', postable: true },
  { code: '36', name: 'Resultados del ejercicio' },
  { code: '3605', name: 'Utilidad del ejercicio' },
  { code: '360505', name: 'Utilidad del ejercicio', postable: true },
  { code: '3610', name: 'Pérdida del ejercicio', nature: 'DEBIT' },
  { code: '361005', name: 'Pérdida del ejercicio', postable: true, nature: 'DEBIT' },
  { code: '37', name: 'Resultados de ejercicios anteriores' },
  { code: '3705', name: 'Utilidades acumuladas' },
  { code: '370505', name: 'Utilidades acumuladas', postable: true },
  { code: '3710', name: 'Pérdidas acumuladas', nature: 'DEBIT' },
  { code: '371005', name: 'Pérdidas acumuladas', postable: true, nature: 'DEBIT' },

  // ── 4 · INGRESOS ──────────────────────────────────────────────────────────
  { code: '4', name: 'Ingresos' },
  { code: '41', name: 'Operacionales' },
  { code: '4135', name: 'Comercio al por mayor y al por menor' },
  { code: '413595', name: 'Venta de mercancías', postable: true },
  { code: '4155', name: 'Actividades inmobiliarias, empresariales y de alquiler' },
  { code: '415505', name: 'Arrendamientos', postable: true },
  { code: '4170', name: 'Otras actividades de servicios' },
  { code: '417005', name: 'Servicios prestados', postable: true },
  {
    code: '4175',
    name: 'Devoluciones en ventas',
    nature: 'DEBIT',
    description: 'Resta de los ingresos. Naturaleza débito para que el estado de resultados la reste sola.',
  },
  { code: '417505', name: 'Devoluciones en ventas', postable: true, nature: 'DEBIT' },

  { code: '42', name: 'No operacionales' },
  { code: '4210', name: 'Financieros' },
  { code: '421005', name: 'Intereses recibidos', postable: true },
  { code: '421040', name: 'Diferencia en cambio', postable: true },
  { code: '4250', name: 'Recuperaciones' },
  { code: '425035', name: 'Descuentos concedidos', postable: true },
  { code: '4295', name: 'Diversos' },
  { code: '429595', name: 'Otros ingresos no operacionales', postable: true },

  // ── 5 · GASTOS ────────────────────────────────────────────────────────────
  { code: '5', name: 'Gastos' },
  { code: '51', name: 'Operacionales de administración' },
  { code: '5105', name: 'Gastos de personal' },
  { code: '510506', name: 'Sueldos', postable: true },
  { code: '510527', name: 'Auxilio de transporte', postable: true },
  { code: '510530', name: 'Cesantías', postable: true },
  { code: '510533', name: 'Intereses sobre cesantías', postable: true },
  { code: '510536', name: 'Prima de servicios', postable: true },
  { code: '510539', name: 'Vacaciones', postable: true },
  { code: '510568', name: 'Aportes a ARL', postable: true },
  { code: '510569', name: 'Aportes a EPS', postable: true },
  { code: '510570', name: 'Aportes a fondos de pensiones', postable: true },
  { code: '510572', name: 'Aportes a cajas de compensación familiar', postable: true },
  { code: '510575', name: 'Aportes al SENA', postable: true },
  { code: '510578', name: 'Aportes al ICBF', postable: true },
  { code: '5110', name: 'Honorarios' },
  { code: '511010', name: 'Revisoría fiscal', postable: true },
  { code: '511095', name: 'Otros honorarios', postable: true },
  { code: '5115', name: 'Impuestos' },
  { code: '511505', name: 'Industria y comercio', postable: true },
  { code: '511540', name: 'Gravamen a los movimientos financieros', postable: true },
  { code: '5120', name: 'Arrendamientos' },
  { code: '512010', name: 'Construcciones y edificaciones', postable: true },
  { code: '5125', name: 'Contribuciones y afiliaciones' },
  { code: '512505', name: 'Contribuciones y afiliaciones', postable: true },
  { code: '5130', name: 'Seguros' },
  { code: '513005', name: 'Seguros', postable: true },
  { code: '5135', name: 'Servicios' },
  { code: '513525', name: 'Acueducto y alcantarillado', postable: true },
  { code: '513530', name: 'Energía eléctrica', postable: true },
  { code: '513535', name: 'Teléfono e internet', postable: true },
  { code: '513540', name: 'Correo, portes y telegramas', postable: true },
  { code: '513550', name: 'Transporte, fletes y acarreos', postable: true },
  { code: '513595', name: 'Otros servicios', postable: true },
  { code: '5140', name: 'Gastos legales' },
  { code: '514005', name: 'Notariales y de registro', postable: true },
  { code: '5145', name: 'Mantenimiento y reparaciones' },
  { code: '514505', name: 'Mantenimiento y reparaciones', postable: true },
  { code: '5155', name: 'Gastos de viaje' },
  { code: '515505', name: 'Alojamiento y manutención', postable: true },
  { code: '5160', name: 'Depreciaciones' },
  { code: '516005', name: 'Construcciones y edificaciones', postable: true },
  { code: '516015', name: 'Equipo de oficina', postable: true },
  { code: '516020', name: 'Equipo de computación y comunicación', postable: true },
  { code: '516035', name: 'Flota y equipo de transporte', postable: true },
  { code: '5195', name: 'Diversos' },
  { code: '519530', name: 'Elementos de aseo y cafetería', postable: true },
  { code: '519535', name: 'Útiles, papelería y fotocopias', postable: true },
  { code: '519595', name: 'Otros gastos diversos', postable: true },

  { code: '52', name: 'Operacionales de ventas' },
  { code: '5205', name: 'Gastos de personal' },
  { code: '520506', name: 'Sueldos', postable: true },
  { code: '520527', name: 'Comisiones', postable: true },
  { code: '5235', name: 'Servicios' },
  { code: '523540', name: 'Publicidad, propaganda y promoción', postable: true },
  { code: '523595', name: 'Otros servicios', postable: true },
  { code: '5295', name: 'Diversos' },
  { code: '529595', name: 'Otros gastos de ventas', postable: true },

  { code: '53', name: 'No operacionales' },
  { code: '5305', name: 'Financieros' },
  { code: '530505', name: 'Gastos bancarios', postable: true },
  { code: '530510', name: 'Comisiones', postable: true },
  { code: '530515', name: 'Intereses', postable: true },
  { code: '530520', name: 'Descuentos comerciales condicionados', postable: true },
  { code: '530525', name: 'Diferencia en cambio', postable: true },
  { code: '5310', name: 'Pérdida en venta y retiro de bienes' },
  { code: '531005', name: 'Pérdida en venta y retiro de bienes', postable: true },
  { code: '5395', name: 'Diversos' },
  {
    code: '539595',
    name: 'Ajuste al peso',
    postable: true,
    description:
      'Recoge el residuo del redondeo al convertir a pesos. Es la única cuenta que puede ' +
      'recibir un descuadre, y por diseño solo de centavos.',
  },

  { code: '54', name: 'Impuesto de renta y complementarios' },
  { code: '5405', name: 'Impuesto de renta y complementarios' },
  { code: '540505', name: 'Impuesto de renta y complementarios', postable: true },

  // ── 6 · COSTOS DE VENTAS ──────────────────────────────────────────────────
  { code: '6', name: 'Costos de ventas' },
  { code: '61', name: 'Costo de ventas y de prestación de servicios' },
  { code: '6135', name: 'Comercio al por mayor y al por menor' },
  { code: '613595', name: 'Costo de mercancía vendida', postable: true },
  { code: '6170', name: 'Otras actividades de servicios' },
  { code: '617005', name: 'Costo de servicios prestados', postable: true },
  { code: '62', name: 'Compras' },
  { code: '6205', name: 'De mercancías' },
  { code: '620505', name: 'Compra de mercancías', postable: true },
  { code: '6225', name: 'Devoluciones en compras', nature: 'CREDIT' },
  { code: '622505', name: 'Devoluciones en compras', postable: true, nature: 'CREDIT' },

  // ── 7 · COSTOS DE PRODUCCIÓN ──────────────────────────────────────────────
  { code: '7', name: 'Costos de producción o de operación' },
  { code: '71', name: 'Materia prima' },
  { code: '7105', name: 'Materia prima' },
  { code: '710505', name: 'Materia prima consumida', postable: true },
  { code: '72', name: 'Mano de obra directa' },
  { code: '7205', name: 'Mano de obra directa' },
  { code: '720505', name: 'Mano de obra directa', postable: true },
  { code: '73', name: 'Costos indirectos' },
  { code: '7305', name: 'Costos indirectos' },
  { code: '730505', name: 'Costos indirectos de fabricación', postable: true },

  // ── 8 y 9 · CUENTAS DE ORDEN ──────────────────────────────────────────────
  //
  // No entran ni en el balance ni en resultados: registran compromisos que
  // existen pero todavía no son un derecho ni una obligación exigible.
  { code: '8', name: 'Cuentas de orden deudoras' },
  { code: '81', name: 'Derechos contingentes' },
  { code: '8105', name: 'Bienes y valores entregados en custodia' },
  { code: '810505', name: 'Bienes y valores entregados en custodia', postable: true },
  { code: '9', name: 'Cuentas de orden acreedoras' },
  { code: '91', name: 'Responsabilidades contingentes' },
  { code: '9105', name: 'Bienes y valores recibidos en custodia' },
  { code: '910505', name: 'Bienes y valores recibidos en custodia', postable: true },
];

/** Tipo y naturaleza resueltos de una cuenta del PUC. */
export const resolvePucAccount = (
  account: PucAccount,
): { type: AccountType; nature: AccountNature } => {
  const type = typeForCode(account.code);
  if (!type) throw new Error(`El código "${account.code}" no pertenece a ninguna clase del PUC`);
  return { type, nature: account.nature ?? defaultNatureFor(type) };
};
