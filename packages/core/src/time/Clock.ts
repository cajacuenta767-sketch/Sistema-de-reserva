/**
 * Reloj inyectable. Ninguna capa de dominio o aplicación debe llamar a `new Date()`
 * directamente: eso hace los tests no deterministas.
 */
export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    // El único lugar del sistema autorizado a leer el reloj del sistema.
    // eslint-disable-next-line no-restricted-syntax
    return new Date();
  }
}

export class FixedClock implements Clock {
  constructor(private current: Date) {}
  now(): Date {
    return new Date(this.current);
  }
  set(d: Date): void {
    this.current = d;
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}
