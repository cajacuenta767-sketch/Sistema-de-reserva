import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import boundaries from 'eslint-plugin-boundaries';
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

  // ── Arquitectura hexagonal: las dependencias apuntan hacia dentro ───────────
  // Sin esto, 30 módulos se degradan a un monolito enredado en seis meses.
  {
    files: ['apps/api/src/**/*.ts'],
    plugins: { boundaries },
    settings: {
      'boundaries/include': ['apps/api/src/**/*.ts'],
      'boundaries/elements': [
        { type: 'platform', pattern: 'apps/api/src/platform/**' },
        { type: 'module-domain', pattern: 'apps/api/src/modules/*/domain/**', capture: ['module'] },
        {
          type: 'module-application',
          pattern: 'apps/api/src/modules/*/application/**',
          capture: ['module'],
        },
        {
          type: 'module-infrastructure',
          pattern: 'apps/api/src/modules/*/infrastructure/**',
          capture: ['module'],
        },
        { type: 'module-public', pattern: 'apps/api/src/modules/*/index.ts', capture: ['module'] },
        { type: 'module-def', pattern: 'apps/api/src/modules/*/module.ts', capture: ['module'] },
        { type: 'modules-index', pattern: 'apps/api/src/modules/index.ts' },
        { type: 'seed', pattern: 'apps/api/src/seed/**' },
        { type: 'root', pattern: 'apps/api/src/*.ts' },
      ],
    },
    rules: {
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          rules: [
            // El dominio es puro: no conoce ni la aplicación ni la infraestructura.
            { from: ['module-domain'], allow: [['module-domain', { module: '${from.module}' }]] },

            // La aplicación conoce su dominio, pero nunca la infraestructura.
            {
              from: ['module-application'],
              allow: [
                ['module-domain', { module: '${from.module}' }],
                ['module-application', { module: '${from.module}' }],
                'platform',
                // Otro módulo SOLO por su API pública.
                'module-public',
              ],
            },

            // La infraestructura puede verlo todo dentro de su propio módulo.
            {
              from: ['module-infrastructure'],
              allow: [
                ['module-domain', { module: '${from.module}' }],
                ['module-application', { module: '${from.module}' }],
                ['module-infrastructure', { module: '${from.module}' }],
                'platform',
                'module-public',
              ],
            },

            {
              from: ['module-public', 'module-def'],
              allow: [
                ['module-domain', { module: '${from.module}' }],
                ['module-application', { module: '${from.module}' }],
                ['module-infrastructure', { module: '${from.module}' }],
                'platform',
                'module-public',
              ],
            },

            // La plataforma es transversal: NUNCA depende de un módulo concreto.
            { from: ['platform'], allow: ['platform'] },

            { from: ['modules-index'], allow: ['module-def', 'platform'] },
            { from: ['root', 'seed'], allow: ['platform', 'modules-index', 'module-public', 'module-def'] },
          ],
        },
      ],
      'boundaries/no-private': ['error', { allowUncles: false }],
    },
  },

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
            "Literal[value=/\\\\b(bg|text|border|ring|divide|from|to|via)-(white|black|slate|gray|zinc|neutral|stone)-?\\\\d*\\\\b/]",
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
