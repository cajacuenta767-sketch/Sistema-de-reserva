import { describe, expect, it } from 'vitest';
import { mergeNav } from '../src/app/nav';
import type { NavItem } from '../src/app/types';

const group = (label: string, children: Array<{ label: string; to: string }>): NavItem => ({
  label,
  children,
});

describe('mergeNav', () => {
  it('une los grupos que se llaman igual', () => {
    // El caso real: `imports` y `settings` aportan los dos a "Configuración".
    // Sin unirlos, la barra lateral muestra dos menús con el mismo nombre y el
    // usuario abre el que no es.
    const merged = mergeNav([
      group('Comercial', [{ label: 'Clientes', to: '/clientes' }]),
      group('Configuración', [{ label: 'Importaciones', to: '/importaciones' }]),
      group('Configuración', [{ label: 'Empresa', to: '/empresa' }]),
    ]);

    expect(merged.map((g) => g.label)).toEqual(['Comercial', 'Configuración']);
    expect(merged[1]?.children?.map((c) => c.label)).toEqual(['Importaciones', 'Empresa']);
  });

  it('conserva el orden de la primera aparición', () => {
    // Añadir un módulo no debe reordenar el menú de quien ya lo conocía.
    const merged = mergeNav([
      group('Catálogo', [{ label: 'Productos', to: '/productos' }]),
      group('Comercial', [{ label: 'Clientes', to: '/clientes' }]),
      group('Catálogo', [{ label: 'Impuestos', to: '/impuestos' }]),
    ]);
    expect(merged.map((g) => g.label)).toEqual(['Catálogo', 'Comercial']);
  });

  it('no duplica una entrada que dos módulos declaran igual', () => {
    const merged = mergeNav([
      group('Comercial', [{ label: 'Clientes', to: '/clientes' }]),
      group('Comercial', [{ label: 'Clientes', to: '/clientes' }]),
    ]);
    expect(merged[0]?.children).toHaveLength(1);
  });

  it('distingue dos entradas con el mismo nombre y destino distinto', () => {
    const merged = mergeNav([
      group('Comercial', [{ label: 'Informes', to: '/ventas/informes' }]),
      group('Comercial', [{ label: 'Informes', to: '/compras/informes' }]),
    ]);
    expect(merged[0]?.children).toHaveLength(2);
  });

  it('no funde dos enlaces sueltos homónimos: eso es un error de nombres', () => {
    // Hacer desaparecer uno en silencio ocultaría el problema en vez de mostrarlo.
    const merged = mergeNav([
      { label: 'Escritorio', to: '/' },
      { label: 'Escritorio', to: '/otro' },
    ]);
    expect(merged).toHaveLength(2);
  });

  it('no modifica los objetos que recibe', () => {
    // Los `nav` vienen de módulos definidos a nivel de módulo ES: mutarlos haría
    // que el menú creciera en cada render.
    const settings = group('Configuración', [{ label: 'Empresa', to: '/empresa' }]);
    mergeNav([settings, group('Configuración', [{ label: 'Importaciones', to: '/importaciones' }])]);
    expect(settings.children).toHaveLength(1);
  });
});
