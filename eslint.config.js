import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.turbo/**',
      '**/coverage/**',
      'legacy/**',
      '**/*.config.js',
      '**/*.config.ts',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // ── Reglas generales ────────────────────────────────────────────────────────
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'no-restricted-syntax': [
        'error',
        {
          // El reloj es inyectable: `new Date()` hace los tests no deterministas.
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: 'Usa clock.now() en lugar de new Date(): el reloj es inyectable.',
        },
      ],
    },
  },

  // NOTA: la regla de arquitectura NO vive aquí.
  // `eslint-plugin-boundaries` v7 no clasificaba nuestros elementos y dejaba
  // pasar violaciones evidentes (se comprobó con ficheros que importaban
  // infraestructura desde el dominio: no las detectaba). Una regla que no falla
  // cuando debe es peor que no tenerla, porque da falsa confianza. La garantía
  // está en `apps/api/tests/architecture.test.ts`, que analiza los imports
  // reales y sí demuestra que detecta las violaciones.

  // ── Frontend ────────────────────────────────────────────────────────────────
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      // El modo oscuro solo funciona si NADIE escribe un color crudo.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'Literal[value=/\\\\b(bg|text|border|ring|divide|from|to|via)-(white|black|slate|gray|zinc|neutral|stone)-?\\\\d*\\\\b/]',
          message:
            'Usa los tokens semánticos (bg-surface, text-fg-muted, border-border, bg-accent…). Un color crudo rompe el modo oscuro.',
        },
      ],
    },
  },

  // ── Tests ───────────────────────────────────────────────────────────────────
  {
    files: ['**/tests/**/*.ts', '**/*.test.ts', '**/*.test.tsx', '**/seed/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
      'no-restricted-syntax': 'off',
    },
  },
);
