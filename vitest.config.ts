import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
    exclude: ['node_modules', '.next', 'dist', 'out'],
    restoreMocks: true,
    clearMocks: true,
    testTimeout: 10000,
    reporters: (process.env.GITHUB_ACTIONS || process.env.TF_BUILD)
      ? ['default', ...(process.env.GITHUB_ACTIONS ? ['github-actions'] : []), 'junit']
      : ['default'],
    outputFile: {
      junit: './test-results/junit.xml',
    },
    coverage: {
      provider: 'v8',
      include: ['src/lib/**/*.ts', 'src/cli/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/__tests__/**',
        'src/lib/types/**',
        'src/app/**',
        'src/components/**',
        'src/lib/report/templates/**',
        'src/cli/bin/**',
      ],
      reporter: ['text', 'json-summary', 'json', 'lcov', 'cobertura'],
      reportOnFailure: true,
      reportsDirectory: './coverage',
      thresholds: {
        statements: 80,
        branches: 65,
        functions: 80,
        lines: 80,
      },
    },
  },
});
