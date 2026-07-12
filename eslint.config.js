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
const reactHooks = require('eslint-plugin-react-hooks');

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
      // Import resolver(typescript-aware、對齊 backlog #23 完成 + #54 storefront 部分解開):
      // - boundaries plugin 透過 eslint-module-utils 解析 import target
      // - typescript resolver 認 .ts / .tsx + tsconfig path mapping + workspace alias
      // - project glob:packages/*/tsconfig.json + apps/storefront/tsconfig.json
      //   (M-1-03-main-d-pre 補 storefront 進 glob;M-4a M0-S1 補 apps/admin 進 glob〔骨架首次寫 .tsx〕;
      //   apps/api / apps/sync-engine 仍純殼、待 M-5-01 真寫 .ts 時各自補、對齊 backlog #54 Supersede 精神)
      'import/resolver': {
        typescript: {
          project: [
            'packages/*/tsconfig.json',
            'apps/storefront/tsconfig.json',
            'apps/admin/tsconfig.json',
          ],
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
  // ===== #182:禁動態 computed process.env 存取(防 client bundle env inlining bug 復發)=====
  // Next.js 只 inline 靜態字面 process.env.NEXT_PUBLIC_*;動態 process.env[name](name 為變數)
  // 不會被 inline → client 端取到 undefined → 執行期 throw(M-1-14e-f1-c 已踩、browser.ts/server.ts 已改靜態)。
  // 危險點:build 綠 + 單元測試綠(Node env 動態查有值)、只在瀏覽器炸 → 極難追、故加機械守門。
  // - selector 抓 process.env[...](computed bracket)、放行 process.env.STATIC(非 computed member access)。
  // - server-only 檔確需動態 requireEnv(adapters/supabase/client.ts、storefront lib/payment/composition.ts)
  //   以受控 inline eslint-disable + 意圖註解放行(server 不進 client bundle、無 inlining 風險;
  //   #179 item 4 requireEnv dedup 追蹤)。
  // - test / spec 已在全域 ignores(L41-44)豁免(測試需動態存取 env 做 setup/teardown)。
  {
    files: ['packages/**/*.ts', 'packages/**/*.tsx', 'apps/**/*.ts', 'apps/**/*.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "MemberExpression[computed=true][object.type='MemberExpression'][object.object.name='process'][object.property.name='env']",
          message:
            '禁動態 process.env[變數] 存取:Next.js 不 inline → client bundle 取 undefined → runtime throw。改靜態 process.env.NEXT_PUBLIC_X;server-only 檔確需動態查 env 才用受控 eslint-disable + 意圖註解(backlog #182)。',
        },
      ],
    },
  },
  // ===== sub-slice B-3:storefront server-only API import 紀律(對齊 backlog #120 議題 2)=====
  // ESLint 9 flat config 無 directive-aware files filter('use client' 字面只在檔頭、parser 不暴露 directive 給 ESLint rules)、
  // 用 storefront-wide files glob 替代精準篩 'use client' 檔。覆蓋面更廣、保護更嚴:
  // - storefront 任何檔(含 server file 如 lib/products.ts)都不該直接 import @pcm/adapters/server
  // - 對齊 ADR-0005 §6 storefront 公開讀走 RLS public、storefront 不該繞 RLS 拿 service_role
  // - 真需 service factory 的場合(如後台 admin / apps/api 寫操作)從各自 app context import
  {
    files: ['apps/storefront/**/*.ts', 'apps/storefront/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@pcm/adapters/server', '@pcm/adapters/server/**'],
              message:
                "storefront 不可 import @pcm/adapters/server(對齊 sub-slice B-1/B-2/B-3 三層防、ADR-0005 §7 service_role key 紀律)。如需 anon factory、改 import '@pcm/adapters'。",
            },
          ],
        },
      ],
    },
  },
  // ===== React Hooks 紀律(對齊 docs/patterns/slice-checkpoint.md §2「Three-Green 定義」+ Sean 2026-05-22 Q1/Q2 + 2026-05-23 重拍)=====
  // 裝 eslint-plugin-react-hooks v7.1.1 stable:只開 rules-of-hooks(防 hooks 跳出 React 函式 / 條件呼叫)+
  // exhaustive-deps(防 useEffect / useMemo / useCallback deps 漏列)兩條 v5 老規則。
  // v7 內其他新規則(purity / set-state-in-effect / no-deriving-state-in-effects / immutability 等)不開、
  // 未來 follow-up slice 評估開啟(對齊 backlog #168 + CLAUDE.md「v7 內未開的新規則演進路徑」)。
  //
  // files glob 限縮 .tsx(.ts 無 React hooks):
  // - apps/storefront/**/*.tsx(Phase 1 唯一 React app)
  // - packages/ui/**/*.tsx(共用 React UI 元件)
  // 其他 packages(domain / ports / use-cases / adapters / schemas)+ apps/api / admin / sync-engine
  // 屬 server / pure logic、不需 React hooks 規則。
  {
    files: ['apps/storefront/**/*.tsx', 'packages/ui/**/*.tsx'],
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  // ===== M-1-16b Q-D=A:scripts/ root 層一次性 ETL / 維護腳本納 lint(鐵則 11 真守)=====
  // scripts/*.ts(root 層、不含 scripts/spikes/ 子目錄):node 環境、非 boundaries element
  // (boundaries/include 只含 packages/apps、不檢查 scripts);只給 parser 讓 eslint 認得 +
  // 跑核心規則(語法 / 明顯錯)。root package.json lint 串 `eslint scripts/*.ts --max-warnings 0`
  // (turbo per-package 掃不到 scripts/);typecheck 由 tsconfig.scripts.json + tsc 守(主把關)。
  {
    files: ['scripts/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
  },
];
