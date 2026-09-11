/**
 * Catálogo fiscal colombiano con el que arranca una organización nueva.
 *
 * Estos valores no se inventan: salen del Estatuto Tributario y de la lista de
 * códigos de la DIAN para factura electrónica (anexo técnico 1.9). Sembrarlos
 * evita el paso en el que alguien teclea "19" en una casilla y el sistema queda
 * atado a que lo haya hecho bien.
 *
 * Las tarifas cambian con cada reforma. Por eso son datos de una organización y
 * no constantes del código: se siembran al crear la empresa y desde ahí se
 * editan sin tocar el programa ni migrar nada.
 */

export type TaxKind = 'VAT' | 'INC' | 'WITHHOLDING_INCOME' | 'WITHHOLDING_VAT' | 'WITHHOLDING_ICA' | 'OTHER';

export interface TaxSeed {
  code: string;
  name: string;
  kind: TaxKind;
  /** Porcentaje: 19 para el 19 %. */
  rate: string;
  isWithholding: boolean;
  appliesTo: 'SALE' | 'PURCHASE' | 'BOTH';
  /** Base mínima en pesos a partir de la cual aplica la retención. */
  minBase: string | null;
  /** Código del tributo en el anexo técnico de la DIAN. */
  dianTaxCode: string | null;
  isDefault?: boolean;
}

/**
 * UVT 2026. La ley expresa las bases mínimas de retención en UVT, no en pesos,
 * así que el valor del año es el que convierte unas en otras. Vive aquí, en un
 * único sitio, en vez de repetido en cada base mínima: en enero cambia una línea.
 */
export const UVT_2026 = 51_000;

const uvt = (units: number): string => String(Math.round(units * UVT_2026));

export const COLOMBIAN_TAXES: readonly TaxSeed[] = [
  // ── IVA ───────────────────────────────────────────────────────────────────
  {
    code: 'IVA19',
    name: 'IVA 19 %',
    kind: 'VAT',
    rate: '19',
    isWithholding: false,
    appliesTo: 'BOTH',
    minBase: null,
    dianTaxCode: '01',
    isDefault: true,
  },
  {
    code: 'IVA5',
    name: 'IVA 5 %',
    kind: 'VAT',
    rate: '5',
    isWithholding: false,
    appliesTo: 'BOTH',
    minBase: null,
    dianTaxCode: '01',
  },
  // Excluido y exento NO son lo mismo, aunque los dos cobren cero: el exento da
  // derecho a descontar el IVA de las compras y el excluido no. Separarlos es lo
  // que permite que la declaración salga bien.
  {
    code: 'IVA0',
    name: 'IVA 0 % (exento)',
    kind: 'VAT',
    rate: '0',
    isWithholding: false,
    appliesTo: 'BOTH',
    minBase: null,
    dianTaxCode: '01',
  },
  {
    code: 'IVAEXC',
    name: 'Excluido de IVA',
    kind: 'VAT',
    rate: '0',
    isWithholding: false,
    appliesTo: 'BOTH',
    minBase: null,
    dianTaxCode: null,
  },

  // ── Impuesto nacional al consumo ──────────────────────────────────────────
  {
    code: 'INC8',
    name: 'INC 8 % (restaurantes y bares)',
    kind: 'INC',
    rate: '8',
    isWithholding: false,
    appliesTo: 'SALE',
    minBase: null,
    dianTaxCode: '04',
  },
  {
    code: 'INC4',
    name: 'INC 4 % (telefonía y datos)',
    kind: 'INC',
    rate: '4',
    isWithholding: false,
    appliesTo: 'SALE',
    minBase: null,
    dianTaxCode: '04',
  },

  // ── Retención en la fuente ────────────────────────────────────────────────
  // Las bases mínimas están en UVT porque así las fija la ley. En pesos habría
  // que reescribirlas cada enero y alguien lo olvidaría un año.
  {
    code: 'RTF-COMP',
    name: 'ReteFuente compras 2,5 %',
    kind: 'WITHHOLDING_INCOME',
    rate: '2.5',
    isWithholding: true,
    appliesTo: 'PURCHASE',
    minBase: uvt(27),
    dianTaxCode: '06',
  },
  {
    code: 'RTF-SERV',
    name: 'ReteFuente servicios 4 %',
    kind: 'WITHHOLDING_INCOME',
    rate: '4',
    isWithholding: true,
    appliesTo: 'PURCHASE',
    minBase: uvt(4),
    dianTaxCode: '06',
  },
  {
    code: 'RTF-SERV-NODEC',
    name: 'ReteFuente servicios no declarante 6 %',
    kind: 'WITHHOLDING_INCOME',
    rate: '6',
    isWithholding: true,
    appliesTo: 'PURCHASE',
    minBase: uvt(4),
    dianTaxCode: '06',
  },
  {
    code: 'RTF-HON',
    name: 'ReteFuente honorarios 11 %',
    kind: 'WITHHOLDING_INCOME',
    rate: '11',
    isWithholding: true,
    appliesTo: 'PURCHASE',
    minBase: null,
    dianTaxCode: '06',
  },
  {
    code: 'RTF-ARR',
    name: 'ReteFuente arrendamiento de inmuebles 3,5 %',
    kind: 'WITHHOLDING_INCOME',
    rate: '3.5',
    isWithholding: true,
    appliesTo: 'PURCHASE',
    minBase: uvt(27),
    dianTaxCode: '06',
  },

  // ── Retención de IVA e ICA ────────────────────────────────────────────────
  {
    code: 'RTIVA15',
    name: 'ReteIVA 15 %',
    kind: 'WITHHOLDING_VAT',
    rate: '15',
    isWithholding: true,
    appliesTo: 'PURCHASE',
    minBase: uvt(4),
    dianTaxCode: '05',
  },
  // El ICA se expresa por mil y la tarifa la fija cada municipio: ésta es la de
  // comercio al por menor en Bogotá. Se siembra como punto de partida editable,
  // no como verdad para todo el país.
  {
    code: 'RTICA-COM',
    name: 'ReteICA comercio 11,04 × 1000',
    kind: 'WITHHOLDING_ICA',
    rate: '1.104',
    isWithholding: true,
    appliesTo: 'PURCHASE',
    minBase: uvt(27),
    dianTaxCode: '07',
  },
  {
    code: 'RTICA-SERV',
    name: 'ReteICA servicios 9,66 × 1000',
    kind: 'WITHHOLDING_ICA',
    rate: '0.966',
    isWithholding: true,
    appliesTo: 'PURCHASE',
    minBase: uvt(4),
    dianTaxCode: '07',
  },
];

/** Categorías con las que arranca el catálogo, para no empezar con la nada. */
export const DEFAULT_CATEGORIES: readonly string[] = ['Productos', 'Servicios'];

/** Impuesto que se aplica por defecto a un producto nuevo. */
export const DEFAULT_SALE_TAX_CODE = 'IVA19';
