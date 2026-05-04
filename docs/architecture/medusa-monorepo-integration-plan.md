# Medusa Monorepo Integration Plan(M-1-03-pre0 研究)

> **Status:** 🟡 待 Sean 拍板 / 2026-05-04 / M-1-03-pre0 研究產出
> **作者:** Claude Code(M-1-03-pre0 研究 slice)
> **層級:** docs/architecture/、待 Sean 拍板選方案後升級為已拍板狀態
> **本檔角色:** M-1-03 主實作前、研究 Medusa-as-API + PCM pnpm monorepo 整合方案、含「不用 Medusa」alternative 維度
> **Sean 拍板範圍:** §4 推薦方案需 Sean multi-select 拍板、不在本檔逕行決定
>
> 配合閱讀:
> - `docs/decisions/0002-architecture-pivot.md` §3 + §4(Medusa-as-API + 9 contexts、§6.3 rollback 路徑)
> - `docs/architecture/medusa-spike-verification-checklist.md`(M-1-03-prep 落地、本檔結論影響 spike 是否跑)
> - `docs/architecture/medusa-schema-design.md`(若選 Medusa 方案、本檔 mapping 適用)
> - `docs/phase-1-backlog.md` #66(spike checklist)、#86(M-1-03 啟動前 trigger)
> - `.npmrc` / `pnpm-workspace.yaml` / `eslint.config.js`(本檔現況盤點對象)

---

## §1 現況盤點(grep 結果)

### 1.1 apps/medusa 純殼狀態

`apps/medusa/` 目錄結構:

```
apps/medusa/
├── .gitkeep         (空檔、保留目錄)
├── .turbo/          (turbo cache)
└── package.json     (260 bytes)
```

`apps/medusa/package.json`:
```json
{
  "name": "@pcm/medusa",
  "version": "0.0.0",
  "private": true,
  "description": "PCM 後台(Medusa v2 + Prisma + Supabase PG)— 殼、待後續 slice 裝框架",
  "scripts": {
    "lint": "eslint . --max-warnings 0 --no-error-on-unmatched-pattern"
  }
}
```

**無 src/、無 dependencies、無 medusa-config.js、無 tsconfig.json。**(對齊 dependency-rules.md §5.3 純殼設計)

### 1.2 PCM 既有 .npmrc 字面

```
auto-install-peers=true
strict-peer-dependencies=false
shamefully-hoist=false
engine-strict=true
```

關鍵:`shamefully-hoist=false`(M-1-02-prep 落地、嚴格隔離模式、跨 package import 必走 workspace deps)。

### 1.3 pnpm-workspace.yaml

```yaml
packages:
  - 'apps/*'
  - 'packages/*'

catalog:
  typescript: ^5.7.0
  eslint: ^10.3.0
  eslint-plugin-boundaries: ^6.0.2
  eslint-import-resolver-typescript: ^4.4.4
  '@typescript-eslint/parser': ^8.59.1
  vitest: ^4.1.5
```

`apps/*` glob 涵蓋 `apps/medusa`,Medusa 整合後屬 PCM workspace 一員。

### 1.4 ESLint boundaries 守門

`eslint.config.js` `files: ['packages/**/*.ts', 'packages/**/*.tsx', 'apps/**/*.ts', 'apps/**/*.tsx']` — 涵蓋 `apps/medusa/**` `.ts`。boundaries 規則 5 字面:「`apps` → 可 import 任何 `packages/*`」,Medusa app import `@pcm/domain` / `@pcm/ports` 是允許方向。

但 Medusa 自己的內部結構(api / modules / workflows)是否仍守 boundaries elements 規則(7 種:domain / ports / use-cases / adapters / ui / schemas / apps),未驗證。

---

## §2 方案詳列(5 候選)

### 2.1 方案 A:Medusa + create-medusa-app + .npmrc 加 hoist 例外

**做法:**
- PCM 根目錄 `.npmrc` 加 `public-hoist-pattern[]=` 4 條(對齊 Medusa 官方 single-package 規範):
  ```
  public-hoist-pattern[]=*@medusajs/*
  public-hoist-pattern[]=*@tanstack/react-query
  public-hoist-pattern[]=*react-i18next
  public-hoist-pattern[]=*react-router-dom
  ```
- 加 `pnpm.packageExtensions` 強制 Zod v3.23.8 給 `@medusajs/medusa`(對齊 GitHub issue #14833 workaround):
  ```json
  "pnpm": {
    "packageExtensions": {
      "@medusajs/medusa": {
        "dependencies": { "zod": "3.23.8" }
      }
    }
  }
  ```
- 跑 `pnpm dlx create-medusa-app@latest medusa-tmp --skip-db --no-boilerplate --use-pnpm` 進 /tmp
- 把產出整合進 `apps/medusa`(保留 `@pcm/medusa` scope + 加 src + tsconfig + medusa-config.js + 必要 deps)
- 跑 `pnpm install` 驗 lockfile 解析、跑 medusa CLI 驗啟動

**優點:**
- 用 Medusa 官方支援的整合路徑、生態完整(內建 cart / order / payment / customer / Admin UI)
- 撞坑時 GitHub issues 有大量先行者經驗

**缺點:**
- Medusa 官方明說「pnpm only supported in single-package projects、推薦 yarn / npm for monorepo」(2026-05 文件字面)
- GitHub issue #14833 Zod v4 hoisting bug 仍 OPEN(2026-03-01 開、Stale label、無 maintainer fix);workaround 是 pin Zod v3.23.8、未來 Medusa 升級到 Zod v4 native 時會撞回來
- 部分 hoist 撞 PCM 嚴格隔離精神(`shamefully-hoist=false` 設計初衷被局部繞過)
- 加新 Medusa 升級時 `.npmrc` hoist patterns 可能需擴(維運盲點)

**真實風險:** 即使加完 hoist + Zod 鎖、Medusa monorepo 仍有 unknown bugs(GitHub #15280 MedusaService digit entity 名 OPEN);officially "may not work as expected"。

---

### 2.2 方案 B:手動裝 Medusa minimal app(不用 create-medusa-app)

**做法:**
- 不用 create-medusa-app、Code 自己寫 `apps/medusa/package.json` deps 列表
- 從 Medusa 官方 docs 抓必要 deps(`@medusajs/medusa`、`@medusajs/framework`、`@medusajs/admin-sdk`、Prisma、Express、tsx 等)
- 自己寫 `apps/medusa/medusa-config.js` + `apps/medusa/src/{api,modules,workflows}` 最小結構
- 同 .npmrc / Zod 鎖(同方案 A)
- pnpm install 裝 deps

**優點:**
- 不依賴 create-medusa-app 對 monorepo 的不完整支援、控制更精準
- 可以 cherry-pick 必要 deps、避免 dtc-starter template 內的不需要部分

**缺點:**
- 可能漏關鍵 deps(Medusa 內部 plugin auto-discovery 邏輯)、debug 困難
- 沒有「先行者反饋」、撞坑時無 google 答案
- Medusa 升級時自己 maintain deps 列表、跟官方 starter 偏離越來越遠

**真實風險:** 比方案 A 更脆,但對 PCM 而言、若 only 用 cart/order/payment/Price List 4 件,自寫 deps 列表可控。

---

### 2.3 方案 C:apps/medusa 排除 pnpm workspace、獨立 yarn / npm

**做法:**
- `pnpm-workspace.yaml` 把 `apps/medusa` 從 `apps/*` 排除(改 negative glob 或具名列出其他 apps)
- `apps/medusa` 自己跑 `yarn install` 或 `npm install`、有獨立 `yarn.lock` / `package-lock.json`
- 不跟 PCM 主 monorepo workspace 共享 lockfile

**優點:**
- 完全對齊 Medusa 官方推薦「monorepo 用 yarn / npm」
- PCM 主 repo `.npmrc` 不需動(嚴格隔離保留)
- Medusa 撞坑跟 PCM 主 repo 解耦

**缺點:**
- `packages/adapters/medusa` 跨 package import `@pcm/domain` / `@pcm/ports` 字面對齊複雜(medusa workspace 跟 PCM workspace 不同、symlink 不在 pnpm 統一管理下)
- 跟 PCM CI / lint / typecheck 工具鏈分離(turbo 不抓 apps/medusa)
- 兩個 lockfile 維護、deps 升級流程跨工具

**真實風險:** 跨 package import 機制斷裂、boundaries plugin 對 apps/medusa 失效。

---

### 2.4 方案 D:Vendure 替代 Medusa

**做法:**
- 廢 Medusa、改用 Vendure
- Vendure: NestJS + TypeScript + GraphQL + 內建 Admin UI
- 用 Vendure CLI(`@vendure/create`)裝 minimal app
- TapPay 走 Vendure plugin 機制(NestJS module)

**優點:**
- TypeScript native、生態跟 PCM 對齊更好(NestJS / Apollo GraphQL)
- Vendure 用 `lerna.json` monorepo(不是 pnpm 原生但跟 pnpm workspace 相容性更好)
- 8.1k stars、v3.6.2(2026-04)、社群成熟
- 內建 Admin UI、可能讓 PCM 不需自寫 apps/admin(影響 ADR-0002 §3 推翻 0001 §4 的決策、需重評)

**缺點:**
- **License: GPLv3** ← 嚴重議題:
  - GPLv3 通常允許 closed-source frontend 透過 API 通訊(network use)、但仍有風險
  - PCM 商業電商、若有 derived work 概念延伸、需法律諮詢
  - Vendure Enterprise Edition 是 commercial license、付費才能避免 GPL 限制
- 跟 ADR-0002 已落地的 Medusa schema 設計衝突(medusa-schema-design.md 廢、需重寫)
- 翻盤成本:M-0-04 ports 字面 ↔ Vendure GraphQL schema 對齊度低、ports 介面可能要重設計
- Phase 1 進度延宕 4-6 週(對齊 ADR-0002 §6.3 rollback 估)

**真實風險:** GPLv3 license 對 PCM 商業電商不確定性 + ADR-0002 推翻成本高。

---

### 2.5 方案 E:Custom + Supabase 直寫(不用任何 commerce framework)

**做法:**
- 廢 Medusa、廢 commerce framework、PCM 自寫 cart / order / payment / Price List 4 件
- `packages/adapters/supabase/`:直接 Supabase SDK + Postgres 跑 cart / order / customer table CRUD
- `packages/adapters/tappay/`:TapPay sandbox SDK 接 payment(本來就要寫、Medusa 也是 plugin)
- `apps/medusa/` 改名 `apps/api/`(或廢、改寫進 storefront API routes Next.js)
- 廢 packages/ports 抽象層(對齊 ADR-0002 §6.3 rollback「降級為純 helper functions」)
- 廢 packages/use-cases 抽象層(對齊 §6.3「降級」)
- 對齊 ADR-0002 §6.3 rollback 路徑(但這是「主動選擇 rollback」、不是「spike 失敗被動 rollback」)

**優點:**
- 完全 native pnpm monorepo、零 hoist 例外、零 license 不確定性
- PCM 9 大藍圖中 5 個 context(Vehicle / Booking / Wallet / Shop / Sync)本來就走 Supabase 自寫、不走 Medusa;統一 Supabase 後架構一致
- 不被 commerce framework 升級節奏綁住、PCM 自掌握 schema
- 沒有 Medusa monorepo bug、沒有 GitHub issue 等修
- domain 邏輯保留(對齊 ADR-0002 §6.3「domain 程式碼保留」)
- Medusa Admin 已被 0002 §3 推翻 PCM 自寫 apps/admin、本來就不靠 Medusa Admin

**缺點:**
- cart / order / payment 4 件自寫成本估 1-2 週(對齊 ADR-0002 §6.3 「預期回退成本約 1 週」、實際 1-1.5 週)
- 沒有 commerce framework 給的 cart abstraction(checkout flow / discount / tax / shipping 等都要自寫)
- 跟 ADR-0002 推翻 0001 §4 「Phase 1 不寫客製 admin」+ 推翻拍板「Medusa-as-API」雙重推翻、需新 ADR-0005 紀錄
- 寫新 ADR 成本(1-2 hr)+ 重新規劃 milestone schedule(2-3 hr)

**真實風險:** ADR-0005 需要 Sean 跟 Claude.ai 重新拍板 9 大 context boundary、影響 M-1-03 ~ M-6 全 milestone schedule。但這個風險「可預期、可規劃」、不是 spike 失敗中途翻盤、有條不紊推進。

---

### 2.6 排除候選:Saleor

**為什麼排除:**
- Saleor: Python (Django) backend、TypeScript SDK 用於 frontend 整合
- 跟 PCM Node + TypeScript 生態不對齊、需運維 Python + Node 雙語言
- 部署複雜度高、Sean 一人運維雙語言不可行
- 不再深入研究

---

## §3 三視角評估表

| 方案 | 擴充性 | 可維護性 | bug 可追蹤性 |
|---|---|---|---|
| **A Medusa + hoist 例外** | 中(Medusa plugin 生態完整、但 monorepo 升級風險高) | 低(Zod 鎖 + hoist 維運盲點 + Medusa 官方 stance「may not work」) | 低(撞坑分不清是 Medusa bug 還是 hoist 配置錯) |
| **B 手動裝 Medusa minimal** | 中(同 A、但 deps 自掌控) | 低-中(自 maintain deps、漏關鍵 deps 風險) | 低(無 google 先行者答案) |
| **C apps/medusa 獨立 yarn/npm** | 中(workspace 解耦、但 cross-import 複雜) | 中(雙 lockfile 維護、CI 雙工具鏈) | 中(撞坑邊界明確、但跨工具鏈) |
| **D Vendure** | 高(NestJS + GraphQL TypeScript 原生) | 中(GPLv3 license 不確定 + lerna monorepo + 翻盤 ADR-0002) | 中(社群成熟、但翻盤期間 schema 重設計) |
| **E Custom + Supabase** | **高**(零 framework 鎖、PCM 自掌握 schema、9 大 context 統一架構) | **高**(原生 pnpm monorepo、無 hoist、無 license 風險、純 PCM stack) | **高**(撞坑單一 source、無外部 framework 干擾) |

---

## §4 推薦方案 + 理由(Sean multi-select 拍板)

### 4.1 推薦排序

**第一推薦:方案 E(Custom + Supabase 直寫)。**

**理由(三視角、以 Phase 2 9 大藍圖視角):**

1. **擴充性:** PCM 9 大藍圖中 Vehicle / Booking / Wallet / Shop / Sync 5 個 context **本來就走 Supabase 自寫**(對齊 ADR-0002 §4.3 字面)、Medusa 蓋 0%。只剩 Catalog / Identity / Order / Pricing 4 個 context 跟 Medusa 有交集、但只用 cart / order / payment / Price List 4 件能力(對齊 ADR-0002 §1.2 字面);自寫 4 件成本 1-2 週、換來 Phase 2 全 context 統一 Supabase、不被 Medusa 升級綁手腳

2. **可維護性:** Medusa 官方「pnpm monorepo may not work as expected」+ Zod v4 hoisting bug active blocker(GitHub #14833 stale 無 fix)+ #15280 MedusaService digit entity 名 bug OPEN — 三個 active blocker 在 PCM 還沒寫 code 就確定會撞;Medusa Admin 已被 ADR-0002 §3 推翻、Medusa「省工」假設(0001 §4 字面)實際上不成立(對齊 ADR-0002 §2.1 7 條「Medusa Admin 蓋不到 PCM 業務」)

3. **bug 可追蹤性:** 撞坑單一 source、無 framework 黑箱、PCM 自寫程式自己 debug;對比 Medusa 撞 hoisting / type / Zod bug 時、需要先判斷是 Medusa 內部問題還是 hoist 配置問題、繞路偵察成本高

**第二推薦:方案 A(Medusa + hoist 例外)** — 如果 Sean 認為 Phase 1 短期 cart / order / payment 自寫 1-2 週不可接受、選 A 並明知撞坑風險。

**不推薦:方案 B(deps 控制更脆)、方案 C(workspace 解耦撞 cross-import)、方案 D(GPLv3 license 不確定)。**

### 4.2 三視角輔助說明

PCM 真實業務場景:
- Phase 1 階段 1 MVP 200 SKU + 簡單 cart / Tier Price / TapPay sandbox + admin 商品管理 + 8 狀態雙維度訂單
- Phase 2 9 大藍圖:車輛履歷 / 預約 / 儲值金 / 多店 / sync-engine — 全自寫
- Sean 一人運維、低運維成本第一原則

方案 E 對 Sean 視角:
- 短期成本 1-2 週(寫 cart / order / payment / Price List)
- 長期省:不被 Medusa 升級綁、PCM schema 自掌握、跟 9 大藍圖統一 Supabase 架構
- 9 大藍圖每個 context 都是 Supabase + Postgres + 自家 schema、Medusa 是「異物」

方案 A 對 Sean 視角:
- 短期省:Medusa 內建 cart / order / payment、PCM 不寫
- 長期累:Medusa monorepo 撞坑風險高、升級綁手腳、Medusa Admin 廢但 SDK 還要維護、9 大藍圖只 1/9 跟 Medusa 有交集

**結論傾向 E。但這是大決定、需 Sean 拍板。**

---

## §5 方案 E 推薦實作步驟(若 Sean 拍板選 E)

> **本節假設 Sean 拍板選方案 E、給 pre0b / M-1-03 主實作 slice 用。**
> **若 Sean 選方案 A、本節不適用、需另寫 A 方案實作步驟。**

### 5.1 ADR 落地(M-1-03-pre0b 純 docs)

- 寫 ADR-0005「Medusa-as-API rollback、改 Custom + Supabase 直寫」
  - 紀錄推翻 ADR-0002 §3 / §4 字面(Medusa-as-API → Custom + Supabase)
  - 重述 ADR-0002 §6.3 rollback 路徑作為實作 baseline
  - 影響面:廢 packages/ports 抽象層 / packages/use-cases 降級 / apps/medusa 改名 apps/api 或廢
  - 三視角理由:擴充性 / 可維護性 / bug 可追蹤性

- 修 ADR-0002 §3 / §4 加 「2026-05-XX 推翻、見 ADR-0005」 標記、不刪原字面(歷史保留)
- 修 docs/architecture/medusa-schema-design.md 加 「廢、見 ADR-0005」 標記
- 修 docs/architecture/medusa-spike-verification-checklist.md 加 「廢、ADR-0005 後不需 spike」 標記

### 5.2 monorepo 結構調整(M-1-03 主實作)

- `apps/medusa/` 改名 `apps/api/`(或視 Sean 決定、保留純殼 placeholder)
- `packages/adapters/` 加子目錄:`supabase/` + `tappay/`(廢 `medusa/` 子目錄、本來也沒寫)
- `packages/ports/` 維持(對齊 Q3=A2 拍板「各 port 自定義」)、但只剩 IProductRepository / ICustomerRepository / IOrderRepository / ITapPayAdapter / ISheetsAdapter
- `packages/use-cases/` 維持(對齊 ADR-0002 §4.1)、不降級為 helper functions(超越 §6.3 rollback 「降級」字面、保留更完整架構)

### 5.3 cart / order / payment 自寫(M-1-03 ~ M-3 跨 milestone)

- M-1-03:`packages/adapters/supabase/SupabaseProductAdapter`(替代 MedusaProductAdapter)
- M-2-08 / M-2-09:`packages/adapters/supabase/SupabasePriceTierAdapter`(替代 Medusa Price List)
- M-3-02:`packages/domain/order/types.ts` 完整 8 狀態雙維度 entity + `packages/use-cases/place-order/`
- M-3-04:`packages/adapters/supabase/SupabaseOrderAdapter`
- M-3-08:`packages/adapters/tappay/TapPayChargeAdapter`(本來就要寫)

### 5.4 Phase 2 影響

- Vehicle / Booking / Wallet / Shop entity 加進來時、走同一 Supabase + 自家 schema 模式、零 framework 鎖
- sync-engine 寫 Supabase / 寫 storefront 商品 metadata 都同生態

---

## §6 撞坑風險清單

### 6.1 方案 E 撞坑風險

1. **Sean 對「自寫 cart / order」估時不足**(預估 1-2 週、實際可能 2-3 週)
   - 緩解:M-1-03 / M-3 milestone 排程加 buffer、estimate 取上限

2. **TapPay 文件不完整**(Medusa plugin 已封裝、自寫需直接讀 TapPay API docs)
   - 緩解:M-3-08 啟動前 Sean 讀 TapPay sandbox docs 確認所有 endpoint、寫進 ADR-0005 或 backlog

3. **Supabase Auth vs PCM 三級會員 tier 機制整合複雜度**
   - Supabase Auth 內建 user table、PCM customer.tier 欄位走 customer_metadata
   - 緩解:M-1-14 Customer adapter 落地時補

### 6.2 方案 A 撞坑風險(若 Sean 選 A、不選 E)

1. **Zod v4 hoisting bug 復發**(workaround pin Zod 3.23.8、Medusa 升 Zod 4 native 時撞)
   - 緩解:Medusa 升級 changelog 監控、必要時延後升級 1-2 個版本等社群驗

2. **`.npmrc` hoist patterns 撞 PCM 嚴格隔離精神**
   - 緩解:hoist 限定 Medusa 必需的 4 條(對齊官方文件)、不擴張

3. **Medusa monorepo 不完整支援、可能未知 bug**
   - 緩解:M-1-03 主實作前跑 medusa-spike-verification-checklist §1-§4 round-trip 4 條 mapping

### 6.3 共通風險(任一方案)

1. **TapPay sandbox vs production 切換**(對齊 STATUS Sean 待決策 #3、ADR-0004 未拍)
2. **Phase 2 vendor crawler 寫商品候選 + sync-engine 流程整合**(對齊 backlog #44 / #78)
3. **設計 / 後台 schema 對齊**(若選 E、design-reference 仍是真權威、storefront 字面不變)

---

## §7 變更紀錄

| 日期 | 變更 | 變更者 |
|---|---|---|
| 2026-05-04 | 初始化 plan、5 候選方案研究 + 三視角評估 + 推薦 E 待 Sean 拍板 | Claude Code(M-1-03-pre0 研究) |

— END —
