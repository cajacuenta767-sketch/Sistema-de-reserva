import { describe, expect, it } from 'vitest';
import { sessionIsResolving } from '../src/store/auth';

/**
 * Este test existe por un fallo real.
 *
 * `/auth/session` estaba bajo el límite contra la prueba de contraseñas, y como
 * la web la pide en cada carga de página, trabajar una mañana recargando
 * pantallas agotaba la cuota. La consulta fallaba con 429, la sesión quedaba en
 * `undefined` y el router lo leía como "no autenticado": el usuario aparecía en
 * el login con la sesión intacta, viendo algo idéntico a una sesión caducada.
 *
 * El límite ya no cubre ese endpoint, pero la confusión de fondo —"falló la
 * consulta" contra "no hay sesión"— seguiría mandando al login ante cualquier
 * corte de red pasajero.
 */
describe('saber si todavía no se sabe si hay sesión', () => {
  it('mientras carga, no se sabe', () => {
    expect(sessionIsResolving({ hasTokens: true, isLoading: true, isError: false })).toBe(true);
  });

  it('con tokens y la consulta fallando, tampoco: NO es una sesión ausente', () => {
    expect(sessionIsResolving({ hasTokens: true, isLoading: false, isError: true })).toBe(true);
  });

  it('sin tokens no hay nada que averiguar: al login', () => {
    expect(sessionIsResolving({ hasTokens: false, isLoading: false, isError: true })).toBe(false);
    expect(sessionIsResolving({ hasTokens: false, isLoading: false, isError: false })).toBe(false);
  });

  it('con la sesión resuelta, se sabe', () => {
    expect(sessionIsResolving({ hasTokens: true, isLoading: false, isError: false })).toBe(false);
  });
});
