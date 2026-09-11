import { describe, expect, it } from 'vitest';
import { amount, money } from '../src/lib/format';

/**
 * Este test existe por un fallo real.
 *
 * El pie de totales de la tabla imprimía lo que llegaba del servidor tal cual:
 * «Valor al costo: 128000.0000000000» y «Unidades: 40.000000», justo debajo de
 * una columna donde la misma cifra salía como «$ 128.000». Del servidor llegan
 * cadenas de `NUMERIC` con toda su escala, y ninguna pantalla debe enseñarlas
 * en crudo.
 */
/*
 * `Intl` separa el símbolo con un espacio DURO, no con uno normal. Comparar
 * contra un espacio corriente hace que el test falle por un carácter invisible
 * y que la salida del error se vea idéntica a lo esperado, que es de lo más
 * desconcertante. Se normaliza para comparar lo que de verdad importa.
 */
const plano = (value: string): string => value.replace(/\u00a0/g, ' ');

describe('formato de los totales de una tabla', () => {
  it('el dinero lleva símbolo y separadores, sin la escala de la columna', () => {
    expect(plano(money('128000.0000000000'))).toBe('$ 128.000');
    expect(plano(money('2231250.0000'))).toBe('$ 2.231.250');
  });

  it('las cantidades van sin símbolo y sin ceros de relleno', () => {
    expect(amount('40.000000', 0)).toBe('40');
    expect(amount('1250', 0)).toBe('1.250');
  });

  it('un contador entero se presenta igual de limpio', () => {
    expect(amount('3', 0)).toBe('3');
    expect(amount(0, 0)).toBe('0');
  });
});
