import type { LucideIcon } from 'lucide-react';
import type { RouteObject } from 'react-router-dom';
import type { ReactNode } from 'react';

/**
 * Contrato de un módulo del frontend.
 *
 * Cada módulo aporta a la vez su entrada de menú, sus rutas, sus widgets del
 * Escritorio y sus comandos de la paleta. Añadir un módulo al sistema es añadir
 * un archivo y una línea en `app/features.ts`: ni el shell ni el router crecen.
 */

export interface NavItem {
  label: string;
  /** Ruta absoluta. Los grupos con hijos no la necesitan. */
  to?: string;
  icon?: LucideIcon;
  /** Sin este permiso, la entrada NO se muestra. */
  permission?: string;
  children?: NavItem[];
  /** Contador (tareas pendientes, notificaciones sin leer). */
  badge?: () => number | undefined;
}

export interface Command {
  id: string;
  label: string;
  /** Palabras que también encuentran el comando ("factura" → "nueva venta"). */
  keywords?: string[];
  icon?: LucideIcon;
  permission?: string;
  group: string;
  run: (navigate: (to: string) => void) => void;
}

export interface DashboardWidget {
  id: string;
  title: string;
  permission?: string;
  /** Ancho en la rejilla de 4 columnas del Escritorio. */
  span?: 1 | 2 | 3 | 4;
  render: () => ReactNode;
}

export interface FeatureModule {
  id: string;
  nav?: NavItem[];
  routes?: RouteObject[];
  commands?: Command[];
  widgets?: DashboardWidget[];
}

export const defineFeature = (feature: FeatureModule): FeatureModule => feature;
