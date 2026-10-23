import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', 'dist/'] },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.webextensions }
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }]
    }
  },
  {
    files: ['extension/content.js'],
    languageOptions: { sourceType: 'script' }
  },
  {
    files: ['extension/lib/audio/pcm-worklet.js'],
    languageOptions: {
      globals: { ...globals.audioWorklet }
    }
  },
  {
    files: ['tests/**', 'scripts/**', 'eslint.config.js'],
    languageOptions: { globals: { ...globals.node } }
  }
];
