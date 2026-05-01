# 依賴規則(Dependency Rules)— ESLint 邊界守門

> **Status:** 🟢 落地 / 2026-05-02 / M-0-03 / 邊界守門 v1
> **拍板人:** Sean(slice 指令拍板執行)
> **層級:** docs/architecture/、衝突仲裁僅次 STATUS.md / NORTHSTAR / 0002-0003 ADR、本檔在 ADR 之下、執行細節說明
> **本檔角色:** ADR-0002 §4.2「依賴規則由 ESLint 守門」的落地說明 + 違規 case lint error 字面範例 + 維運須知
>
> 配合閱讀:
> - `docs/decisions/0002-architecture-pivot.md` §4.2(規則來源、本檔字面引用)
> - `docs/decisions/0003-domain-entity-naming.md` §3.4(字串 leak 檢查、本 config 不守、見 §4)
> - `docs/patterns/slice-checkpoint.md` §4.1(三綠定義、`--max-warnings 0` 對應)
> - `docs/architecture/security-timeline.md` §3.B1(M-0-03 在安全時序的位置)
> - `eslint.config.js`(本檔的實作對應)
> - `docs/phase-1-backlog.md`(字串 leak 對應條目見 §4)

---

## §1 7 條依賴規則(字面引用 ADR-0002 §4.2)

```
domain      ← 不可 import 任何其他 package
ports       ← 只可 import domain
use-cases   ← 只可 import domain + ports
adapters    ← 可 import domain + ports + 外部 SDK(Medusa / Supabase / Sheets / TapPay)
apps/*      ← 可 import 任何 packages/*
ui          ← 不可 import domain / use-cases / adapters / ports
schemas     ← 不可 import domain / use-cases / adapters / ports
```

實作映射:
- 規則 1-7 對應 `eslint.config.js` 中 `boundaries/dependencies` rule 的 `rules[0]` ~ `rules[6]`
- 外部 SDK(Medusa / Supabase / Sheets / TapPay)不在 `boundaries/elements` 範圍、boundaries plugin 不擋
- ui / schemas 用 `disallow: { to: { type: '*' } }` 嚴於 ADR §4.2 字面(ADR 字面只列 4 個禁、實作禁所有非外部 element 包括彼此、原因:ui 與 schemas 都是「無下游」的終端元素、彼此互相 import 無業務語意)

## §2 ESLint plugin boundaries 配置(關鍵欄位字面)

### 2.1 Elements 設定

```js
'boundaries/elements': [
  { type: 'domain', pattern: 'packages/domain/**/*' },
  { type: 'ports', pattern: 'packages/ports/**/*' },
  { type: 'use-cases', pattern: 'packages/use-cases/**/*' },
  { type: 'adapters', pattern: 'packages/adapters/**/*' },
  { type: 'ui', pattern: 'packages/ui/**/*' },
  { type: 'schemas', pattern: 'packages/schemas/**/*' },
  { type: 'apps', pattern: 'apps/*/**', capture: ['app'] },
],
```

說明:
- 6 packages 各為獨立 element type、pattern 用 file mode、`**/*` 匹配 src/ 內所有檔
- apps 用 capture pattern、storefront 與 medusa 是同 type `'apps'` 的不同 instance、capture `app` 為 instance name
- pattern `'apps/*/**'` 接受 2 段以上路徑(包含 `apps/storefront/file.ts` 與 `apps/storefront/src/file.ts`)
- 文件:https://www.jsboundaries.dev/docs/setup/elements/

### 2.2 Root path / include / ignores

```js
'boundaries/include': ['packages/**/*', 'apps/**/*'],
'boundaries/root-path': MONOREPO_ROOT,  // __dirname of eslint.config.js
```

`boundaries/root-path` 必要、否則 `pnpm --filter` 從 workspace 跑 lint 時、ESLint cwd 是 workspace、boundaries 解析的相對路徑會錯。

ignores(flat config 第一個 block):
- `**/node_modules/**` / `**/dist/**` / `**/.next/**` / `**/build/**` / `**/coverage/**` / `**/.turbo/**`
- `design-reference/**`(submodule、視覺真權威、非 monorepo lint 範圍)
- `**/*.config.{js,mjs,cjs,ts}`(豁免、config 檔常需要跨 element)
- `**/*.test.{ts,tsx}` / `**/*.spec.{ts,tsx}`(豁免、測試檔可跨 element)

### 2.3 Dependencies rule 寫法

```js
'boundaries/dependencies': [
  'error',
  {
    default: 'disallow',
    rules: [
      // 規則 1: domain → 不可 import 任何
      { from: { type: 'domain' }, disallow: { to: { type: '*' } } },
      // 規則 2: ports → 只可 import domain
      { from: { type: 'ports' }, allow: { to: { type: 'domain' } } },
      // 規則 3: use-cases → 只可 import domain + ports
      { from: { type: 'use-cases' }, allow: { to: { type: ['domain', 'ports'] } } },
      // 規則 4: adapters → 只可 import domain + ports
      { from: { type: 'adapters' }, allow: { to: { type: ['domain', 'ports'] } } },
      // 規則 5: apps → 可 import 6 packages
      { from: { type: 'apps' }, allow: { to: { type: ['domain', 'ports', 'use-cases', 'adapters', 'ui', 'schemas'] } } },
      // 規則 6: ui → 不可 import 任何
      { from: { type: 'ui' }, disallow: { to: { type: '*' } } },
      // 規則 7: schemas → 不可 import 任何
      { from: { type: 'schemas' }, disallow: { to: { type: '*' } } },
    ],
  },
],
```

`default: 'disallow'` 表示「沒明文 allow 的 from-to 對都禁」、嚴格白名單模式。

## §3 違規 case 對應 lint error 字面範例(M-0-03 dry-run 結果)

| Rule | from → to | error message |
|------|-----------|---------------|
| 1 | domain → ports | `Dependencies to elements of type "ports" are not allowed in elements of type "domain". Denied by rule at index 0` |
| 2 | ports → use-cases | `There is no rule allowing dependencies from elements of type "ports" to elements of type "use-cases"` |
| 3 | use-cases → adapters | `There is no rule allowing dependencies from elements of type "use-cases" to elements of type "adapters"` |
| 4 | adapters → use-cases | `There is no rule allowing dependencies from elements of type "adapters" to elements of type "use-cases"` |
| 5 | apps storefront → apps medusa | `There is no rule allowing dependencies from elements of type "apps" and app "storefront" to elements of type "apps" and app "medusa"` |
| 6 | ui → domain | `Dependencies to elements of type "domain" are not allowed in elements of type "ui". Denied by rule at index 5` |
| 7 | schemas → domain | `Dependencies to elements of type "domain" are not allowed in elements of type "schemas". Denied by rule at index 6` |

兩種錯誤格式:
- **明文 disallow**(rule 1, 6, 7):用 `disallow: { to: { type: '*' } }`、跳「Denied by rule at index N」
- **default disallow + allow 列表外**(rule 2, 3, 4, 5):rule 用 allow 列表、target 不在 allow 內、跳「There is no rule allowing」

⚠️ **覆蓋範圍邊界**:本表 7 條 dry-run 對齊 ADR-0002 §4.2 字面 7 條規則、每條只測一個違規方向(例 ui→domain)。實作 `disallow: { to: { type: '*' } }` 比 ADR §4.2 字面更嚴(全擋、含 ui→ports / ui→schemas / schemas→ui 等),這些「ADR 字面外的擴展禁向」未做 dry-run 直接驗證、靠 `default: 'disallow'` 邏輯保證。M-1+ 若有反面案例(實際 import 被誤擋),回頭補 dry-run。

## §4 字串 leak 檢查未守(ADR-0003 §3.4)

ADR-0003 §3.4 字面:「不允許 wire 字串 leak 出 adapter 邊界。ESLint 規則(M-0-03 已守門依賴方向、本決策追加字串 leak 檢查 — 列入 backlog #8 候選、Phase 1 本決策不馬上加 lint rule)」

本 ESLint config **不守**字串 leak 檢查、原因:
- 字串 leak 檢查需要 custom ESLint rule 或 regex pattern matcher、超出 plugin-boundaries 範圍
- ADR-0003 §3.4 字面註明「Phase 1 本決策不馬上加 lint rule」、本 slice 對齊
- Phase 1 靠 review 流程攔(adapter PR 必走 audit)、Phase 2 視需要補

⚠️ **backlog 條目錯置**:ADR-0003 §3.4 寫「列入 backlog #8 候選」、但 `docs/phase-1-backlog.md` 實際 #8 是「ADR-0003 衝突處置表 7.9 / 7.10 補入」(無關事項)。字串 leak ESLint rule 對應的 backlog 條目於 M-0-03 收尾新增(對應條目編號見本檔變更紀錄 §7)。

未來若加 lint rule:
- 自定義 rule 名建議 `pcm/no-wire-leak-in-ports`、檢查 ports/* 與 domain/* 中 string literal 不含 Medusa wire 命名(如 `metadata.fits`、`region_id`、`shipping_options.metadata.*` 等)
- 或用既有 `no-restricted-syntax` rule 配 AST selector 攔截

## §5 Known limitations(本實作邊界)

### 5.1 Import resolver 未配置 typescript 解析

當前 boundaries 用 node 預設 resolver、不認 `.ts` 副檔名、無法解析:
- workspace alias `@pcm/ports`(走 package.json `main: './src/index.ts'`、node 不認 `.ts`)
- 無副檔名相對路徑 `'../../ports/src/index'`(node resolver 找不到 `.ts`)

M-0-03 dry-run 用 `.ts` 副檔名繞過(`'../../ports/src/index.ts'`)是 transient hack、production code 不會這樣寫。

**影響**:當 M-1+ 開始用 `import { X } from '@pcm/ports'` 寫跨 package import 時、boundaries 可能無法解析 target、不擋違規。

**對策**:M-1 第一次跨 package import 前、加 `eslint-import-resolver-typescript` + 配 `settings['import/resolver'].typescript`、讓 boundaries 認 alias。本 slice 範圍外、進 backlog 追蹤(對應條目編號見本檔變更紀錄 §7)。

### 5.2 跑 lint 必須走 `pnpm lint` 或 `pnpm --filter`

`boundaries/root-path` 設為 monorepo root(`__dirname` of `eslint.config.js`)、無論 cwd 在哪、boundaries 都從 root 解析路徑。但 ESLint 本身的 cwd 仍是當下 workspace、`eslint . --max-warnings 0` 的 `.` 範圍是 workspace 內。

正確跑法:
- `pnpm lint`(從 root、turbo 並行 8 task)← 推薦
- `pnpm --filter @pcm/<name> lint`(單 workspace)← debug 用

### 5.3 apps 純殼用 `--no-error-on-unmatched-pattern`

`apps/storefront` 與 `apps/medusa` 目前是純殼、無 .ts/.tsx 檔。`eslint .` 預設行為是 unmatched pattern → exit 2。為讓 8 個 task 都跑通、lint script 加 `--no-error-on-unmatched-pattern`:

```json
"lint": "eslint . --max-warnings 0 --no-error-on-unmatched-pattern"
```

M-1 / M-2 裝 Next.js / Medusa 後、apps 會有 .tsx 檔、flag 仍可保留(無副作用、保險用)。

## §6 維運須知

### 6.1 加新 package(packages/X/)

1. `eslint.config.js` `boundaries/elements` 加 `{ type: 'X', pattern: 'packages/X/**/*' }`
2. `boundaries/dependencies.rules` 加對應 from='X' 的允許列表
3. `packages/X/package.json` 加 `"lint": "eslint . --max-warnings 0 --no-error-on-unmatched-pattern"`
4. 跑 `pnpm lint` 確認新 task 跑通
5. 本檔 §1 / §3 表格更新

### 6.2 加新 app(apps/X/)

1. 不需動 `boundaries/elements`(apps pattern 已涵蓋 `apps/*/**`)
2. `apps/X/package.json` 加 `"lint": "eslint . --max-warnings 0 --no-error-on-unmatched-pattern"`
3. 跑 `pnpm lint` 確認新 task 跑通

### 6.3 規則改動(改 ADR-0002 §4.2)

1. 先改 ADR-0002 §4.2(真權威)
2. 同 commit 改 `eslint.config.js`(實作)
3. 同 commit 改本檔 §1 / §3(說明)
4. 同 commit 跑新規則對應的 dry-run 驗證
5. 三檔同步、不分 commit

## §7 變更紀錄

| 日期 | 變更 | 變更者 |
|---|---|---|
| 2026-05-02 | 初版落地(M-0-03)、7 條規則 dry-run 全部 CAUGHT、字串 leak 列 backlog(條目編號於本 slice 收尾新增)、limitations §5.1 import resolver 列 backlog(同) | Claude Code(M-0-03 slice) |

— END —
