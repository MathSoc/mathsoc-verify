import { defineConfig } from 'oxlint';

export default defineConfig({
  plugins: ['typescript', 'unicorn', 'oxc'],
  options: {
    typeAware: true,
    typeCheck: true,
  },
  categories: {
    correctness: 'error',
  },
  rules: {
    'typescript/no-explicit-any': 'error',
    'typescript/require-await': 'warn',
  },
  env: {
    builtin: true,
  },
});
