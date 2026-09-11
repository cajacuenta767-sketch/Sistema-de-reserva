import { describe, expect, it } from 'vitest';
import { detectDelimiter, parseCsv, toObjects } from '../../src/modules/imports/domain/csv.js';
import {
  applyMapping,
  describeIssues,
  inferMapping,
  missingRequired,
  detectDecimalSeparator,
  normalizeHeader,
  parseBoolean,
  parseDate,
  parseNumber,
} from '../../src/modules/imports/domain/mapping.js';
import type { ImportField } from '../../src/platform/imports/ImportRegistry.js';

describe('lectura de CSV', () => {
  it('lee un fichero sencillo', () => {
    const table = parseCsv('nombre,nit\nAcme,900123456\nBeta,890903938');
    expect(table.headers).toEqual(['nombre', 'nit']);
    expect(table.rows).toEqual([
      ['Acme', '900123456'],
      ['Beta', '890903938'],
    ]);
  });

  it('detecta el punto y coma de Excel en español', () => {
    // La coma es el separador decimal aquí, así que Excel usa `;`. Asumir `,`
    // deja cada fila en una sola columna gigante.
    const table = parseCsv('nombre;precio\nCamisa;89.900,50\nPantalón;120.000,00');
    expect(table.delimiter).toBe(';');
    expect(table.headers).toEqual(['nombre', 'precio']);
    expect(table.rows[0]).toEqual(['Camisa', '89.900,50']);
  });

  it('detecta tabuladores', () => {
    expect(detectDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t');
  });

  it('quita el BOM que escribe Excel', () => {
    // Sin quitarlo, la primera cabecera es "\ufeffnombre" y no casa con nada.
    const table = parseCsv('\ufeffnombre,nit\nAcme,900123456');
    expect(table.headers[0]).toBe('nombre');
  });

  it('respeta el separador dentro de comillas', () => {
    const table = parseCsv('nombre,direccion\nAcme,"Calle 10 # 5-20, Bogotá"');
    expect(table.rows[0]).toEqual(['Acme', 'Calle 10 # 5-20, Bogotá']);
  });

  it('admite saltos de línea dentro de un campo entrecomillado', () => {
    const table = parseCsv('nombre,notas\nAcme,"Primera línea\nSegunda línea"');
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0]?.[1]).toBe('Primera línea\nSegunda línea');
  });

  it('interpreta las comillas dobladas como una comilla', () => {
    const table = parseCsv('nombre\n"Empresa ""La Grande"" S.A."');
    expect(table.rows[0]?.[0]).toBe('Empresa "La Grande" S.A.');
  });

  it('quita el retorno de carro de los ficheros de Windows', () => {
    // Un `\r` invisible al final de cada fila rompe las comparaciones sin que se
    // vea nada raro en pantalla.
    const table = parseCsv('nombre,nit\r\nAcme,900123456\r\n');
    expect(table.rows[0]).toEqual(['Acme', '900123456']);
  });

  it('descarta las filas vacías del final', () => {
    const table = parseCsv('nombre\nAcme\n\n\n');
    expect(table.rows).toHaveLength(1);
  });

  it('desambigua dos cabeceras con el mismo nombre', () => {
    // "Teléfono" dos veces (fijo y móvil) es normal; sin desambiguar, el mapeo
    // apuntaría a una de las dos al azar.
    const table = parseCsv('nombre,telefono,telefono\nAcme,601,300');
    expect(table.headers).toEqual(['nombre', 'telefono', 'telefono (2)']);
  });

  it('rechaza un fichero vacío', () => {
    expect(() => parseCsv('   ')).toThrow(/vacío/);
  });

  it('convierte la tabla en objetos por cabecera', () => {
    const objects = toObjects(parseCsv('nombre,nit\nAcme, 900123456 '));
    expect(objects).toEqual([{ nombre: 'Acme', nit: '900123456' }]);
  });
});

describe('convenio numérico del fichero', () => {
  it('dos separadores: el último es el decimal', () => {
    expect(detectDecimalSeparator(['1.234.567,89'])).toBe(',');
    expect(detectDecimalSeparator(['1,234,567.89'])).toBe('.');
  });

  it('un separador repetido solo puede ser el de miles', () => {
    expect(detectDecimalSeparator(['1.234.567'])).toBe(',');
    expect(detectDecimalSeparator(['1,234,567'])).toBe('.');
  });

  it('uno o dos dígitos detrás son decimales; tres, miles', () => {
    expect(detectDecimalSeparator(['4500,5'])).toBe(',');
    expect(detectDecimalSeparator(['4500.5'])).toBe('.');
    // "89.900" solo no decide nada: sigue buscando en el resto de la columna.
    expect(detectDecimalSeparator(['89.900', '1.234,50'])).toBe(',');
    expect(detectDecimalSeparator(['89.900', '1,234.50'])).toBe('.');
  });

  it('basta una celda inequívoca para fijar toda la columna', () => {
    // Esto es lo que hace que la decisión sea de la columna y no de la celda:
    // `89.900` aislado es indescifrable, pero acompañado ya no.
    expect(detectDecimalSeparator(['89.900', '120.000', '4.500'])).toBe(',');
  });

  it('sin pista alguna asume el español', () => {
    // Es lo que exporta Excel en Colombia, y un fichero con decimales de verdad
    // siempre trae alguna pista.
    expect(detectDecimalSeparator(['4500', '1200', ''])).toBe(',');
  });
});

describe('números escritos por personas', () => {
  it('lee el formato español', () => {
    expect(parseNumber('1.234.567,89', ',')).toBe('1234567.89');
    expect(parseNumber('89.900', ',')).toBe('89900');
  });

  it('lee el formato inglés', () => {
    expect(parseNumber('1,234,567.89', '.')).toBe('1234567.89');
    expect(parseNumber('89.900', '.')).toBe('89.900');
  });

  it('lee un número sin separadores', () => {
    expect(parseNumber('4500')).toBe('4500');
    expect(parseNumber('-1200,5', ',')).toBe('-1200.5');
  });

  it('quita símbolos de moneda y espacios', () => {
    expect(parseNumber(' $ 89.900 ', ',')).toBe('89900');
  });

  it('el error que justifica todo esto', () => {
    // `Number('89.900')` da 89,9: un precio dividido por mil que no lanza
    // ninguna excepción y solo se descubre al cobrar.
    expect(Number('89.900')).toBe(89.9);
    expect(parseNumber('89.900', ',')).toBe('89900');
  });

  it('rechaza lo que no es un número', () => {
    expect(() => parseNumber('mil pesos')).toThrow(/no es un número/);
    expect(() => parseNumber('1.234.', '.')).toThrow(/no es un número/);
  });
});

describe('sí/no y fechas', () => {
  it('acepta las formas habituales de sí y no', () => {
    for (const value of ['1', 'Sí', 'SI', 'true', 'X', 'verdadero']) {
      expect(parseBoolean(value), value).toBe(true);
    }
    for (const value of ['0', 'No', 'false', '']) {
      expect(parseBoolean(value), value).toBe(false);
    }
    expect(() => parseBoolean('quizá')).toThrow(/sí\/no/);
  });

  it('lee las fechas como día/mes/año', () => {
    // 03/04/2026 es el 3 de abril, no el 4 de marzo: leerlo al revés cambia el
    // trimestre de una factura.
    expect(parseDate('03/04/2026')).toBe('2026-04-03');
    expect(parseDate('3-4-26')).toBe('2026-04-03');
    expect(parseDate('2026-04-03')).toBe('2026-04-03');
  });

  it('rechaza una fecha imposible', () => {
    expect(() => parseDate('03/13/2026')).toThrow(/día\/mes\/año/);
    expect(() => parseDate('el martes')).toThrow(/no es una fecha/);
  });
});

describe('mapeo de columnas', () => {
  const FIELDS: ImportField[] = [
    { key: 'displayName', label: 'Nombre', required: true, aliases: ['razon social', 'cliente'] },
    { key: 'taxId', label: 'NIT', aliases: ['documento', 'identificacion'] },
    { key: 'email', label: 'Correo', aliases: ['email', 'correo electronico'] },
    { key: 'salePrice', label: 'Precio', type: 'number' },
    { key: 'isActive', label: 'Activo', type: 'boolean' },
  ];

  it('normaliza las cabeceras para comparar', () => {
    expect(normalizeHeader('Razón Social')).toBe('razon social');
    expect(normalizeHeader('  N.I.T.  ')).toBe('n i t');
  });

  it('empareja por nombre, etiqueta y alias, sin tildes', () => {
    const mapping = inferMapping(['Razón social', 'Documento', 'Correo electrónico'], FIELDS);
    expect(mapping).toEqual({
      displayName: 'Razón social',
      taxId: 'Documento',
      email: 'Correo electrónico',
    });
  });

  it('no inventa emparejamientos', () => {
    // Un mapeo adivinado es peor que ninguno: el usuario lo da por bueno y
    // descubre el error cuando los datos ya están dentro.
    const mapping = inferMapping(['Columna A', 'Columna B'], FIELDS);
    expect(mapping).toEqual({});
  });

  it('no asigna la misma columna a dos campos', () => {
    const mapping = inferMapping(['Nombre'], FIELDS);
    expect(Object.values(mapping)).toEqual(['Nombre']);
  });

  it('señala los campos obligatorios sin asignar', () => {
    expect(missingRequired({}, FIELDS).map((f) => f.key)).toEqual(['displayName']);
    expect(missingRequired({ displayName: 'Nombre' }, FIELDS)).toEqual([]);
  });

  it('convierte los valores según el tipo del campo', () => {
    const row = { Nombre: 'Acme', Precio: '89.900,50', Activo: 'Sí' };
    const mapped = applyMapping(row, { displayName: 'Nombre', salePrice: 'Precio', isActive: 'Activo' }, FIELDS, ',');
    expect(mapped).toEqual({ displayName: 'Acme', salePrice: '89900.50', isActive: 'true' });
  });

  it('omite las celdas vacías en vez de mandar cadenas vacías', () => {
    // Así el caso de uso aplica sus valores por defecto, en lugar de guardar un
    // hueco que nadie sabe si es un dato o un olvido.
    const mapped = applyMapping(
      { Nombre: 'Acme', NIT: '' },
      { displayName: 'Nombre', taxId: 'NIT' },
      FIELDS,
    );
    expect(mapped).toEqual({ displayName: 'Acme' });
    expect('taxId' in mapped).toBe(false);
  });

  it('el error nombra la columna culpable', () => {
    // "no es un número" a secas obliga a mirar las ocho celdas de la fila.
    expect(() =>
      applyMapping({ Nombre: 'Acme', Precio: 'carísimo' }, { displayName: 'Nombre', salePrice: 'Precio' }, FIELDS),
    ).toThrow(/Columna "Precio".*no es un número/);
  });

  it('exige los campos obligatorios', () => {
    expect(() => applyMapping({ NIT: '900123456' }, { taxId: 'NIT' }, FIELDS)).toThrow(/Sin asignar: Nombre/);
    expect(() =>
      applyMapping({ Nombre: '' }, { displayName: 'Nombre' }, FIELDS),
    ).toThrow(/Falta "Nombre"/);
  });
});

describe('motivos legibles en el informe', () => {
  const FIELDS: ImportField[] = [
    { key: 'email', label: 'Correo' },
    { key: 'displayName', label: 'Nombre', required: true },
    { key: 'kind', label: 'Tipo' },
  ];

  it('nombra el campo en español y explica qué pasa', () => {
    // Sin esto, la celda de motivo muestra el JSON crudo del validador: una
    // expresión regular de cincuenta caracteres donde debería decir qué corregir.
    expect(describeIssues([{ path: ['email'], code: 'invalid_format' }], FIELDS)).toBe(
      'Correo: no tiene un formato válido',
    );
    expect(describeIssues([{ path: ['kind'], code: 'invalid_value' }], FIELDS)).toBe(
      'Tipo: no es uno de los valores admitidos',
    );
    expect(describeIssues([{ path: ['displayName'], code: 'too_big' }], FIELDS)).toBe(
      'Nombre: es demasiado largo',
    );
  });

  it('junta varios problemas de la misma fila', () => {
    const text = describeIssues(
      [
        { path: ['email'], code: 'invalid_format' },
        { path: ['displayName'], code: 'too_small' },
      ],
      FIELDS,
    );
    expect(text).toBe('Correo: no tiene un formato válido; Nombre: está vacío o es demasiado corto');
  });

  it('usa la clave cuando el campo no está declarado', () => {
    expect(describeIssues([{ path: ['loQueSea'], code: 'invalid_type' }], FIELDS)).toBe(
      'loQueSea: falta o no es del tipo esperado',
    );
  });
});
