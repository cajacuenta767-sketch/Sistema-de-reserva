import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // La plantilla con las migraciones se prepara una sola vez; cada fichero la
    // clona en su propia base, así que pueden correr en paralelo.
    globalSetup: ['./tests/setup/globalSetup.ts'],
    pool: 'forks',
    poolOptions: { forks: { maxForks: 4 } },
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
