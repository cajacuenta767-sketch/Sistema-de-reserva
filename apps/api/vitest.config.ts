import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Los tests de integración comparten un clúster de PostgreSQL: cada archivo
    // clona su propia base desde una plantilla, así que pueden ir en paralelo,
    // pero no conviene saturar el pool de conexiones.
    pool: 'forks',
    poolOptions: { forks: { singleFork: false, maxForks: 4 } },
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
