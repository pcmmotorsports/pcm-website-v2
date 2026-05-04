/**
 * PCM monorepo 邊界守門 — flat config(ESLint v10)
 *
 * 7 條 boundaries 規則對應 docs/decisions/0002-architecture-pivot.md §4.2:
 *   1. domain    → 不可 import 任何其他 element
 *   2. ports     → 只可 import domain
 *   3. use-cases → 只可 import domain + ports
 *   4. adapters  → 只可 import domain + ports(外部 SDK 不在 boundaries 範圍、不擋)
 *   5. apps      → 可 import 任何 packages
 *   6. ui        → 不可 import 任何其他 element
 *   7. schemas   → 不可 import 任何其他 element
 *
 * 字串 leak 檢查(ADR-0003 §3.4)— 本 config 不守、見 docs/architecture/dependency-rules.md §4。
 *
 * 交叉引用:
 *   - docs/architecture/dependency-rules.md(本 config 配套說明)
 *   - docs/decisions/0002-architecture-pivot.md §4.2(規則來源)
 *   - docs/patterns/slice-checkpoint.md §2(Three-Green 定義、--max-warnings 0)
 */

const boundaries = require('eslint-plugin-boundaries');
const tsParser = require('@typescript-eslint/parser');

const MONOREPO_ROOT = __dirname;

module.exports = [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/build/**',
      '**/coverage/**',
      '**/.turbo/**',
      'design-reference/**',
      '**/*.config.js',
      '**/*.config.mjs',
      '**/*.config.cjs',
      '**/*.config.ts',
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/*.spec.ts',
      '**/*.spec.tsx',
    ],
  },
  {
    files: ['packages/**/*.ts', 'packages/**/*.tsx', 'apps/**/*.ts', 'apps/**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    plugins: {
      boundaries,
    },
    settings: {
      'boundaries/elements': [
        { type: 'domain', pattern: 'packages/domain/**/*' },
        { type: 'ports', pattern: 'packages/ports/**/*' },
        { type: 'use-cases', pattern: 'packages/use-cases/**/*' },
        { type: 'adapters', pattern: 'packages/adapters/**/*' },
        { type: 'ui', pattern: 'packages/ui/**/*' },
        { type: 'schemas', pattern: 'packages/schemas/**/*' },
        { type: 'apps', pattern: 'apps/*/**', capture: ['app'] },
      ],
      'boundaries/include': ['packages/**/*', 'apps/**/*'],
      'boundaries/root-path': MONOREPO_ROOT,
      // Import resolver(typescript-aware、對齊 backlog #23 完成):
      // - boundaries plugin 透過 eslint-module-utils 解析 import target
      // - typescript resolver 認 .ts / .tsx + tsconfig path mapping + workspace alias
      // - project glob 只放 packages/*/tsconfig.json(apps/* 純殼無 tsconfig、
      //   待 apps 真寫 .ts 時補、對齊 backlog #54 Supersede 精神)
      'import/resolver': {
        typescript: {
          project: ['packages/*/tsconfig.json'],
        },
      },
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          rules: [
            { from: { type: 'domain' }, disallow: { to: { type: '*' } } },
            { from: { type: 'ports' }, allow: { to: { type: 'domain' } } },
            { from: { type: 'use-cases' }, allow: { to: { type: ['domain', 'ports'] } } },
            { from: { type: 'adapters' }, allow: { to: { type: ['domain', 'ports'] } } },
            {
              from: { type: 'apps' },
              allow: { to: { type: ['domain', 'ports', 'use-cases', 'adapters', 'ui', 'schemas'] } },
            },
            { from: { type: 'ui' }, disallow: { to: { type: '*' } } },
            { from: { type: 'schemas' }, disallow: { to: { type: '*' } } },
          ],
        },
      ],
    },
  },
];
