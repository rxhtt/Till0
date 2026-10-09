/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'core-no-react-or-dom',
      severity: 'error',
      comment: 'packages/core must remain pure TypeScript with no React, ReactDOM, or DOM dependencies.',
      from: {
        path: '^packages/core',
      },
      to: {
        path: '(react|react-dom|@testing-library|lucide-react)',
      },
    },
    {
      name: 'core-no-ui-packages',
      severity: 'error',
      comment: 'packages/core cannot depend on UI apps or hardware layer.',
      from: {
        path: '^packages/core',
      },
      to: {
        path: '(^packages/hardware|^apps/web)',
      },
    },
  ],
  options: {
    doNotFollow: {
      path: 'node_modules',
    },
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: './tsconfig.base.json',
    },
  },
};
