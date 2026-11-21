import { defineConfig } from 'vitest/config'

// SQL tests: each file boots an in-process Postgres (PGlite) with every migration. They run one file at a
// time because this machine has little free RAM. `npm run test:db`
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/db/**/*.test.js'],
    pool: 'forks',
    // V8's optimising wasm compiler runs out of memory on PGlite's Postgres build; the baseline compiler is enough
    poolOptions: { forks: { execArgv: ['--liftoff-only'] } },
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 120000,
  },
})
