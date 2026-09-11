import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export type ThemeChoice = 'light' | 'dark' | 'system';

interface ThemeState {
  choice: ThemeChoice;
  resolved: 'light' | 'dark';
  setChoice(choice: ThemeChoice): void;
}

const ThemeContext = createContext<ThemeState | null>(null);
const STORAGE_KEY = 'erp.theme';

const readChoice = (): ThemeChoice => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system';
  }
};

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>(readChoice);
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  );

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const resolved = choice === 'system' ? (systemDark ? 'dark' : 'light') : choice;

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark');
  }, [resolved]);

  const setChoice = useCallback((next: ThemeChoice) => {
    setChoiceState(next);
    try {
      if (next === 'system') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* almacenamiento bloqueado */
    }
  }, []);

  return <ThemeContext.Provider value={{ choice, resolved, setChoice }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme debe usarse dentro de <ThemeProvider>');
  return ctx;
}

/**
 * Aplica el matiz de marca de la organización activa. Es lo que convierte el
 * sistema en marca blanca sin recompilar: un número en la base de datos.
 */
export function useBrandHue(hue: number | null | undefined): void {
  useEffect(() => {
    const root = document.documentElement;
    if (hue === null || hue === undefined) root.style.removeProperty('--brand-h');
    else root.style.setProperty('--brand-h', String(hue));
  }, [hue]);
}
