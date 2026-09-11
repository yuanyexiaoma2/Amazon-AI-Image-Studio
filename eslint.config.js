/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      'docs/specs/**',
      'pnpm-lock.yaml',
    ],
  },
];
