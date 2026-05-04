# ADR-0005: Custom + Supabase 直寫架構(廢 Medusa-as-API)

> **Status:** 🟢 拍板 / 2026-05-04
> **拍板人:** Sean(2026-05-04 Q1=A1 拍板:Custom + Supabase 直寫、廢 Medusa-as-API)
> **影響範圍:** Phase 1 全 9 個 bounded contexts(尤其 Catalog / Identity / Order / Pricing 4 個原本走 Medusa-as-API、本 ADR 改走 Supabase)
> **本檔角色:** 重大架構轉向、廢 ADR-0002 §1.2 Pivot 2「Medusa-as-API」、9 contexts 統一架構走 Supabase
> **層級:** docs/decisions/、衝突仲裁僅次 STATUS.md / NORTHSTAR / ADR-0001
>
> 配合閱讀:
> - `docs/decisions/0001-rewrite-decision.md`(整個重做拍板、本 ADR 不推翻)
> - `docs/decisions/0002-architecture-pivot.md` §1.2 Pivot 2(本 ADR 廢)+ §4.3 9 contexts 範圍(本 ADR 修)+ §6.1 / §6.3 Rollback(本 ADR 主動觸發)
> - `docs/decisions/0003-domain-entity-naming.md` §4 9 衝突處置(本 ADR 仍適用、wire 端從 Medusa schema 改 Supabase 表 schema)
> - `docs/decisions/0004-m1-pre-launch-decisions.md` Q1-Q4(全部仍適用、強化)
> - `docs/architecture/medusa-monorepo-integration-plan.md`(M-1-03-pre0 5 候選方案研究、本 ADR 採方案 E)
> - `docs/architecture/medusa-schema-design.md`(M-0-05 / M-0-06 落地、本 slice 加 Superseded metadata、字面保留)
> - `docs/architecture/medusa-spike-verification-checklist.md`(M-1-03-prep 落地、本 slice 加 Superseded metadata、字面保留)
> - `docs/PHASE-2-VISION.md` §3 Phase 1 schema 預留檢查清單(本 ADR 不影響)
> - `docs/phase-1-backlog.md` #66(本 slice 補廢註)

---

## 1. Context(背景)

### 1.1 為什麼現在拍

M-1-03-pre0 研究 slice(commit `e9f97c5`)跑 5 候選方案 + WebFetch Medusa v2 / Vendure / Saleor / Supabase 官方文件 + GitHub issues、發現:

1. **Medusa v2 在 pnpm monorepo 是 active blocker:**
   - 官方明說「pnpm only supported in single-package projects、推薦 yarn / npm for monorepo」(2026-05 字面、無 fix roadmap)
   - GitHub issue #14833 Zod v4 hoisting bug OPEN(2026-03-01 開、Stale label、無 maintainer fix)
   - GitHub issue #15280 MedusaService digit entity name bug OPEN active blocker

2. **Medusa Admin 已被 ADR-0002 §3 推翻:**
   - PCM 自寫 `apps/admin/`(`@pcm/ui` design tokens 統一風格)
   - Medusa「省工」假設(ADR-0001 §4 字面)實際不成立(對齊 ADR-0002 §2.1 7 條「Medusa Admin 蓋不到 PCM 業務」)
   - 留 Medusa 只用 cart / order / payment / Price List 4 件能力、Medusa Admin SDK 還要維護

3. **PCM 9 大藍圖 5 個 context 本來就走 Supabase 自寫:**
   - Vehicle / Booking / Wallet / Shop / Sync 5 contexts 對齊 ADR-0002 §4.3「Medusa 蓋 0%」字面
   - 剩 Catalog / Identity / Order / Pricing 4 個 context 跟 Medusa 有交集、但只用 cart / order / payment / Price List 能力
   - 自寫 4 件(估 1-2 週、對齊 ADR-0002 §6.3 rollback 1 週估)、換來 9 contexts 統一 Supabase 架構

4. **5w SKU 規模強化(Sean 2026-05-04 業務訊號):**
   - Medusa metadata.fits[] 在 5w 規模是 blocker(不能加 GIN index、查詢 O(n))
   - PCM 自家 Supabase 表 + tsvector + GIN + pg_jieba(對齊 ADR-0004 Q3=A1 兩階段)更可控

### 1.2 觸發 ADR-0002 §6.1 強訊號 #1 主動採用

ADR-0002 §6.1 強訊號 #1 字面:「M-1 spike 出現 Medusa schema 完全無法對應 PCM 業務的 case(連 metadata 都套不上)」→ 解讀:「Medusa-as-API 假設破產、需考慮全 Supabase 自寫」。

本 ADR 屬「**主動採用 rollback 路徑**」(不是 spike 失敗被動 rollback):
- M-1-03 主實作 spike 還沒跑(checklist 落地但未驗證)
- 但研究階段已確認 Medusa monorepo active blocker + 5w 規模 blocker、不需 spike 驗證才知失敗
- 提早避免 1-2 週 spike + 撞坑成本

### 1.3 候選方案

M-1-03-pre0 研究 5 候選(`docs/architecture/medusa-monorepo-integration-plan.md` §2):

| # | 方案 | 三視角(擴/維/追) | 結論 |
|---|---|---|---|
| A | Medusa + .npmrc hoist 例外 + Zod v3 lock | 中/低/低 | ❌ active blocker + Medusa Admin 廢但 SDK 維護累贅 |
| B | 手動裝 Medusa minimal(不用 create-medusa-app) | 中/低-中/低 | ❌ 同 A 風險 + 自 maintain deps 列表更脆 |
| C | apps/medusa 排除 pnpm workspace 獨立 yarn/npm | 中/中/中 | ❌ cross-import @pcm/* 撞牆 |
| D | Vendure(替代 Medusa、NestJS + GraphQL) | 高/中/中 | ❌ GPLv3 license 商業風險(後續修正:對 PCM 不觸發義務、但仍需學費 1.5-2 週 + 推翻 ADR-0002 釘子) |
| **E** | **Custom + Supabase 直寫(不用 commerce framework)** | **高/高/高** | ✅ **本 ADR 採用** |

Sean 拍板 E。

---

## 2. Decision(決策)

### 2.1 拍板字面

廢 **ADR-0002 §1.2 Pivot 2「Medusa-as-API + Next.js 自家倉庫」** 假設、改採:

- **Catalog / Identity / Order / Pricing 4 contexts:** 改走 Supabase 自家表 + 自寫 use-cases、不接 Medusa
- **Vehicle / Booking / Wallet / Shop / Sync 5 contexts:** 維持原 Supabase 自家表規劃(對齊 ADR-0002 §4.3)
- **9 contexts 統一架構:** 全走 Supabase + Ports & Adapters(對齊 ADR-0002 §4 monorepo 結構、保留 packages/ports / use-cases / adapters)

### 2.2 一句話心智模型

> **PCM 自己的家 + 自己的家具。** 9 個 context 全住 Supabase Postgres、沒有外面租來的家具(Medusa)、沒有跨系統雙寫、沒有 framework 升級綁手腳。

### 2.3 不廢的部分

ADR-0002 其他條目仍維持:

- **§3 推翻 0001 §4「Phase 1 不寫客製 admin」:** 維持(PCM 自寫 `apps/admin/`)
- **§4 monorepo 結構(4 packages + 2 apps):** 維持(packages/domain / use-cases / ports / adapters / ui / schemas + apps/storefront / admin / sync-engine);**`apps/medusa/` 改用途**(下面 §2.4)
- **§4.2 依賴規則 ESLint 守門:** 維持(domain ← ports ← use-cases ← adapters / apps)
- **§4.3 9 contexts 範圍:** 修(原「Medusa-as-API」context 改走 Supabase、語意不變)

### 2.4 apps/medusa/ 改用途

apps/medusa/ 不裝 Medusa(目前純殼狀態保留)。改用途候選(M-1-03-pre0c 落地時 Sean 拍板):

- **候選 i:** 改名 `apps/api/`(Supabase 包裝層、暴露 Edge Functions / Next.js API routes 給 storefront / admin / sync-engine 共用)
- **候選 ii:** 完全廢、storefront / admin / sync-engine 各自直接 import `packages/adapters/supabase/*`(無中間 API 層)
- **候選 iii:** 維持 `apps/medusa/` 名稱 + 純殼、視為 Phase 2 vendor crawler 預留

本 ADR 不替 Sean 拍此選擇、留 M-1-03-pre0c / Sean 拍板。

---

## 3. 5 候選方案決策摘要(對應 medusa-monorepo-integration-plan.md)

對齊 `docs/architecture/medusa-monorepo-integration-plan.md` §2-§4 字面、本 ADR §1.3 已列表;以下為三視角詳細、避免 grep 兩檔:

### 3.1 為何選 E

- **擴充性最高:** 9 contexts 統一 Supabase、Phase 2 加 vehicle / booking / wallet / sync 直接加 Supabase 表 + 自家 use-case、零 framework 鎖
- **可維護性最高:** 純 TypeScript + Supabase client、Sean 業務邏輯熟、無 framework 升級風險、無 active blocker 追 GitHub
- **bug 可追蹤性最高:** 出 bug 看自家代碼、無 framework 黑盒、L1 三綠 + skill audit 直接覆蓋

### 3.2 為何不選 A / B(留 Medusa)

- Medusa 官方 stance 「pnpm monorepo may not work as expected」 + 兩個 active blocker GitHub issue OPEN
- Medusa Admin 已廢、剩 SDK 維護累贅
- 9 大藍圖只 1/9 跟 Medusa 有交集、Medusa 是「異物」

### 3.3 為何不選 C(apps/medusa 排除 workspace)

- cross-import `@pcm/domain` / `@pcm/ports` 機制斷裂、boundaries plugin 失效
- 雙 lockfile 維護、turbo 不抓 apps/medusa

### 3.4 為何不選 D(Vendure)

- GPLv3 對 PCM 不觸發義務(closed-source frontend 透過 GraphQL API 通訊不算 derived work)、license 風險低
- 但仍需學費 1.5-2 週(NestJS + TypeORM + GraphQL)+ 翻盤 ADR-0002 釘子(Medusa schema design 全廢、ports 介面可能要重設計)
- 跟方案 E 比、E 不需新 framework 學費、對 Sean 一人運維更友善

---

## 4. 沒有更優解確認(2026-05 web search)

Claude.ai 跑 2026-05 web search 確認沒有更適合 PCM 的 commerce framework:

| 候選 | 排除原因 |
|---|---|
| **Medusa v2** | 撞 pnpm monorepo + Zod v4 hoisting bug + MedusaService digit name bug active blocker(對齊 §1.1 #1) |
| **Vendure** | GPLv3 license 對 PCM 不觸發義務但仍需 1.5-2 週學費 + 推翻 ADR-0002 釘子(對齊 §3.4) |
| **Saleor** | Python (Django)、跟 PCM Node + TypeScript 生態不對齊 |
| **Payload CMS** | tax / shipping / inventory 弱、不夠 PCM 規模(5w SKU + 三 tier + 8 狀態雙維度訂單) |
| **SaaS(Shopify Hydrogen / Vendure Cloud)** | 鎖架構、Phase 2 9 大藍圖無法整合 PCM 自家 schema |
| **Medusa + Bun** | GitHub #5036 實測同樣撞 monorepo 牆、且推翻整個工具鏈(ADR-0001 + 0002 + M-1-01 vercel.json corepack 全動) |

**結論:** 沒有現成 commerce framework 適合「PCM 訂貨型業務 + 9 大藍圖跨 context + 一人運維 + 5w SKU 規模」這四個條件交集。Custom + Supabase 是當前最優解。

---

## 5. Rationale(三視角)

### 5.1 擴充性

- **9 contexts 統一架構**(無雙系統並行、無 Medusa schema vs Supabase schema 雙軌維護)
- **Phase 2 9 大藍圖自然延伸**:加 vehicle entity / booking / wallet ledger / shop entity / sync-engine schema 直接加 Supabase 表 + 自家 use-case、零 framework 鎖
- **5w SKU 規模直接控制 PG schema + index + tsvector + pg_jieba**(對齊 ADR-0004 Q1=A2 + Q3=A1 兩階段、不被 Medusa metadata.fits[] 限制)
- **經銷三 tier + priceByTier 不洩漏鐵則**(對齊 medusa-schema-design §6.2)自寫更可控、不靠 Medusa Price List × customer_group 機制

### 5.2 可維護性

- **純 TypeScript + Supabase client**、Sean 業務邏輯熟悉、Code 寫起來直覺
- **無 framework 升級風險**:不需要監控 Medusa changelog / Zod 升級 / GitHub issues
- **每個 use-case 字面短**(估 100-200 行)、Code 可拆 slice 維護(對齊 CLAUDE.md 鐵則 4 / 鐵則 6 檔案大小上限)
- **bug debug 路徑單層**(自家代碼)、Sean 看不懂代碼但 Code 可追;Medusa debug 路徑跨 framework 黑盒 + 自家 mapper 兩層
- **lockfile 簡單**:純 pnpm 嚴格隔離(`shamefully-hoist=false`)、無 hoist 例外、無 packageExtensions 補丁

### 5.3 bug 可追蹤性

- **出 bug 看自家代碼**、無 framework 黑盒
- **distributed tracing** 直接接 Supabase log + Vercel Analytics + Sentry(M-6-08 落地)、單 source 追
- **L1 三綠 + skill audit** 直接覆蓋自家代碼、無外部依賴干擾
- **medusa-spike-verification-checklist.md decision tree §3** 不再需要(廢於本 ADR、Medusa-as-API spike 不再進行)

---

## 6. Rollback 訊號(若採 ADR-0005 後遇致命問題)

若以下任一訊號觸發、暫停當前 milestone、評估是否寫 ADR-0006 重新評估:

### 6.1 強訊號(任一觸發即重新評估)

| # | 訊號 | 解讀 |
|---|---|---|
| 1 | 自寫 cart / order / payment / Price List 4 件估時嚴重偏離(超過 4 週仍未動工核心) | Custom 假設「1-2 週可寫」破產、需考慮回 Medusa A 方案或 Vendure D 方案 |
| 2 | Phase 2 第一個 context 落地(Vehicle)發現 5w SKU + vehicle 跨表 query 性能崩盤(p99 > 5s 且 PG 索引 / tsvector / 連 join 都解不了) | Supabase Pro 規模假設破產、需考慮專用 search service(Algolia / Meilisearch / Typesense) |
| 3 | 三 tier 自動升級(累積儲值 ≥ NT$ 100,000)+ priceByTier server-side 驗證撞 race condition 無法解(對齊 medusa-schema-design §6.2 priceByTier 不洩漏鐵則) | 自寫 use-case 邏輯不夠 robust、需考慮事件驅動或 workflow engine |
| 4 | 200 SKU 種子(M-1-16)上線後 fitment query p99 > 5s 且 GIN index 無法解 | tsvector + GIN 假設破產、需考慮專用 search service 或 fitment 改正規化(雙表) |

### 6.2 弱訊號(累計觀察)

| # | 訊號 | 解讀 |
|---|---|---|
| 5 | Sean 業務拍板事項超出可承受範圍(每 slice 3+ multi-select 拍板項) | 自寫架構需 Sean 過多細節決策、應該找 framework 收斂預設值 |
| 6 | 連續 3 個 slice 因 use-case 介面定義不夠補修改 | 9 contexts 邊界切錯、需重劃 |
| 7 | sync-engine + Supabase 雙寫導致 race condition 超過 1 週無解 | 同步策略錯、需事件驅動(對齊 ADR-0002 §6.1 #4 強訊號精神) |

### 6.3 Rollback 路徑(若觸發 §6.1)

對齊 ADR-0002 §6.3 精神、視訊號決定:

- **訊號 #1(自寫超時):** 部分 rollback 到方案 A(留 Medusa cart / order / payment、繼續自寫 5 個 context),不全廢自寫
- **訊號 #2 / #4(性能崩盤):** 加專用 search service(Algolia / Meilisearch),不全廢架構,只補 search 層
- **訊號 #3(race condition):** 加 workflow engine(Temporal / Inngest / 等),不全廢
- **訊號 #5(拍板過載):** 引入 framework convention(可能 Medusa workflow 部分採用),不全廢

ADR-0006 才寫具體 rollback 路徑、本 ADR 只列訊號。

---

## 7. 影響的既有文件 / ADR

| 檔 / ADR | 處置 | 落地 slice |
|---|---|---|
| `docs/decisions/0001-rewrite-decision.md` | 不影響(整個重做拍板) | — |
| `docs/decisions/0002-architecture-pivot.md` §1.2 Pivot 2「Medusa-as-API」 | **廢**、本 ADR 取代;字面保留作歷史紀錄、不刪 | 本 slice 不動 ADR-0002 字面、只在本 ADR §7 紀錄影響 |
| `docs/decisions/0002-architecture-pivot.md` §3 推翻 0001 §4 | **不廢**(PCM 自寫 admin 仍維持) | — |
| `docs/decisions/0002-architecture-pivot.md` §4 monorepo 結構 | **修**:`apps/medusa/` 改用途(M-1-03-pre0c 拍板)、其他不變 | M-1-03-pre0c |
| `docs/decisions/0002-architecture-pivot.md` §4.3 9 contexts 範圍 | **修**:Medusa-as-API 4 contexts 改走 Supabase、語意不變 | 本 slice 不動 ADR-0002 字面、本 ADR §2.1 紀錄 |
| `docs/decisions/0002-architecture-pivot.md` §6.1 / §6.3 | **觸發 #1**:本 ADR 主動採用 rollback 路徑;ADR-0002 §6.3「rollback 路徑」字面對齊本 ADR 採用方向 | 本 slice |
| `docs/decisions/0003-domain-entity-naming.md` §4 9 衝突處置 | **仍適用**:9 條 wire ↔ domain mapping 字面保留、wire 端從 Medusa schema 改 Supabase 表 schema | M-1-03-pre0c(supabase-schema-design 落地時對應) |
| `docs/decisions/0004-m1-pre-launch-decisions.md` Q1 / Q2 / Q3 / Q4 | **全部仍適用、強化**:Q1 Supabase Pro 升級時機 / Q2 Image Storage / Q3 PG tsvector 兩階段 / Q4 Money brand type 全對齊 Custom + Supabase 方向 | — |
| `docs/architecture/medusa-schema-design.md`(Part 1 + Part 2) | **加 Superseded metadata**、字面保留作歷史紀錄(ADR-0003 §4 9 條 wire ↔ domain mapping 仍可參考、wire 端從 Medusa schema 換 Supabase 表 schema) | 本 slice §3 |
| `docs/architecture/medusa-spike-verification-checklist.md` | **加 Superseded metadata**、字面保留;Medusa-as-API spike 不再進行(本 ADR 主動採用 rollback、非 spike 失敗) | 本 slice §3 |
| `docs/phase-1-backlog.md` #66 | **補廢註**(已 ✅ 完成、加廢於行) | 本 slice §4 |
| `docs/PHASE-2-VISION.md` §3 Phase 1 schema 預留 checklist | **不影響**(schema 預留邏輯仍適用、只是預留在 Supabase 表不在 Medusa metadata) | — |
| `docs/architecture/medusa-monorepo-integration-plan.md` | **不影響**(M-1-03-pre0 研究產出、本 ADR 採方案 E 為依據) | — |

---

## 8. 後續 milestone 影響

### 8.1 Phase 1 階段 1 milestone 字面變更

| Milestone | 原字面 | 新字面(本 ADR 後) |
|---|---|---|
| **M-1-03 主實作** | adapters/MedusaProductAdapter + storefront 連通(45 min) | adapters/SupabaseProductAdapter + storefront 連通 + spike 驗 round-trip(估 6-8 hr、跨多 slice、含寫 supabase-schema-design + 自寫 Product CRUD) |
| **M-1-14 Customer adapter** | Medusa Customer Adapter | SupabaseCustomerAdapter + 自寫 customer 表 schema |
| **M-2-01 / M-2-02 三 tier** | Medusa customer_group + price_list × customer_group | Supabase customer.tier 欄位 + customer_tier_history 表(自動升級邏輯) |
| **M-2-08 / M-2-09 Pricing** | Medusa Price List 多 tier | Supabase product_price_tier 表(自寫 priceByTier 邏輯) |
| **M-3-02 Order entity** | Medusa Order 模組 | Supabase orders + order_items 表(自寫 8 狀態雙維度 state machine) |
| **M-3-04 Order adapter** | Medusa Order Adapter | SupabaseOrderAdapter |
| **M-3-08 TapPay** | Medusa Payment Plugin + TapPay | TapPayChargeAdapter(直接接 TapPay sandbox SDK、不走 Medusa plugin) |
| **M-4a admin** | apps/admin + adapters/Medusa* | apps/admin + adapters/Supabase*(無實質差異、原本就自寫 admin) |
| **M-5-03 sync-engine 上架** | sync-engine 寫 Medusa metadata + Sheet | sync-engine 寫 Supabase 表 + Sheet(對齊 medusa-monorepo-integration-plan §5.3) |
| **M-6-08 上線前 checklist** | Medusa production env vars + production build | Supabase production schema migrate + RLS policy 全項勾(對齊 security-timeline §3 #F6 已落 Supabase Pro 升級 trigger) |

### 8.2 待寫文件清單(M-1-03-pre0c 起)

- `docs/architecture/supabase-schema-design.md`(取代 medusa-schema-design.md、寫 9 contexts 完整 Supabase 表 schema + RLS policy 規劃 + 索引策略)— M-1-03-pre0c
- ADR-0002 §7 待寫文件清單同步補(本 slice 不動、M-1-03-pre0c 一併處理)

### 8.3 estimate 變更

- **M-1-03 估時:** 75-90 min → 6-8 hr(跨多 slice、自寫 Product CRUD + spike 驗 + storefront 連通)
- **Phase 1 整體:** 估時不變(自寫 cart / order / payment 1-2 週對應 ADR-0002 §6.3 rollback 1 週估、跟原 Medusa 學習曲線 + 撞坑時間相當)

---

## 9. 變更紀錄

| 日期 | 變更 | 變更者 |
|---|---|---|
| 2026-05-04 | 初版落地、Sean 拍板 Q1=A1 廢 ADR-0002 §1.2 Pivot 2「Medusa-as-API」、改 Custom + Supabase 直寫(9 contexts 統一架構)、5 候選方案 + 三視角 + Rollback 訊號 + 影響清單 + 後續 milestone 字面變更 | Sean 拍板 / Claude Code(M-1-03-pre0b)落地 |

— END —
