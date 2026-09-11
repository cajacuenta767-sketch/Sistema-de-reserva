import type { NavItem } from './types';

/**
 * Une las entradas de menú que aportan los módulos.
 *
 * Varios módulos alimentan el MISMO grupo: "Comercial" recibirá clientes de
 * `crm` y facturas de `sales`, y "Configuración" recibe importaciones y datos de
 * la empresa. Concatenando sin más, la barra lateral acaba con dos grupos
 * llamados igual, uno debajo del otro: parecen dos secciones distintas y el
 * usuario abre la equivocada.
 *
 * Se unen por etiqueta conservando el orden de la primera aparición, que es el
 * de `app/features.tsx`, para que el menú no cambie de orden al añadir un módulo.
 */
export const mergeNav = (groups: readonly NavItem[]): NavItem[] => {
  const merged: NavItem[] = [];
  const byLabel = new Map<string, NavItem>();

  for (const item of groups) {
    const existing = byLabel.get(item.label);

    // Solo se funden los grupos. Dos entradas con enlace propio y el mismo
    // nombre son un error de nombres, no algo que fundir: se dejan las dos para
    // que se note, en vez de hacer desaparecer una en silencio.
    if (!existing || !existing.children || !item.children) {
      const copy = item.children ? { ...item, children: [...item.children] } : item;
      merged.push(copy);
      if (!existing) byLabel.set(item.label, copy);
      continue;
    }

    for (const child of item.children) {
      if (!existing.children.some((c) => c.label === child.label && c.to === child.to)) {
        existing.children.push(child);
      }
    }
  }

  return merged;
};
