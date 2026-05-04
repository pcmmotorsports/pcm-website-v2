# STATUS.md

> 用途:PCM Phase 1 重做的 single source of truth。Claude.ai 與 Claude Code 每次新對話必先讀此檔對齊狀態。每完成一個 slice 後由 busboy-end 自動更新。
>
> 衝突仲裁:STATUS.md > docs/PHASE-1-NORTHSTAR.md > 其他 md > 對話歷史。

---

## 當前狀態

**Phase:** Phase 1(整個重做、新 repo `pcm-website-v2`)
**Milestone:** M-1 進度 2/16(M-0 10/10 完成、M-1-01 + M-1-02 ✅、M-1-03 主實作 8 slice 進行中 pre1 完成 1/8 + 1 side product-import-spec 完成)
- **M-0 完成:** M-0-01a/01b/07/08/04/03/05/06/02/09/10(14 slice、10 milestone)+ 全專案 audit
- **M-1 進度:** M-1-01 ✅ / M-1-02 ✅(含 -prep / -audit follow-up)
- **下一步:** M-1-03 主實作(8 slice 拆法、pre1 完成 1/8、後 7 slice:prep / main-a / main-b / main-c / main-d-pre / main-d / audit)

**當前 slice:** M-1-03-side 完成(純 docs 2 檔:新建 docs/product-import-spec.md 19 欄 CSV 格式 v1.0 Sean 2026-05-04 拍板定案 93 行;phase-1-backlog.md 補 3 條:#88 規格照片切換 M-1 商品頁 slice 45-60 min / #89 庫存顯示 M-1 商品頁 slice 15 min / #90 CSV 匯入腳本 M-1-03 主實作完成後獨立 slice 90-120 min;適用車種/年份 Alt+Enter 換行垂直列、規格圖片多張分號隔開、庫存前台只顯示有貨/缺貨;此 slice 屬 M-1-03 期間 side task 獨立於 8 slice 拆法、插在 pre1 與 prep 之間、不阻擋接續 prep slice;字面 vs 事實揭示:1. 指令字面起手 4 綠第 4 條預期 HEAD = e234e0b 過時 Claude.ai 跨 session stale、Sean 拍板 A1 用實際 HEAD 4f064ac 為基準執行;2. 多處 markdown auto-link 失真按 A1 還原 backtick 包本地路徑;3. commit subject 改 docs(M-1-03-side): ... 對齊專案 type(scope) convention;L1 三綠可省 對齊 working-style §6.3 第 10 條 + backlog #15、不跑 skill audit)、待 Sean 手動推
**Branch:** dev(main 已同步至 9f609b0)

## 最後更新

**時間:** 2026-05-05
**更新者:** Claude Code(M-1-03-side 完成、busboy-end 收工)

## 最近 3 commit

| Hash | 訊息 | 時間 |
|---|---|---|
| cc5c475 | docs(M-1-03-side): product-import-spec v1.0 + backlog #88/#89/#90 | 2026-05-05 |
| 4f064ac | refactor(M-1-03-pre1): apps/medusa → apps/api rename + PaginationParams 預定義 + searchByKeyword 簽名落地 | 2026-05-04 |
| dc5611a | docs(M-1-03-pre0d): STATUS 補 C 切法 8 slice 拆法字面(純 docs) | 2026-05-04 |

## 下一步(第 1 條優先)

1. **M-1-03 主實作**(SupabaseProductAdapter + spike round-trip + storefront 連通、估 6-8 hr 跨多 slice)← 當前

> Sean 拍板 ADR-0005(M-1-03-pre0b 落地)+ #5=i apps/medusa/ → apps/api/(M-1-03-pre0c 落地);supabase-schema-design.md 完整(Part 1 / 2 / 3)
> **M-1-03 主實作必吸收:**
>   - backlog #86 thematic1 樣板 leak 防 + contract test + edge cases 三合一(60-90 min)
>   - backlog #83 matchFitment yearStart/yearEnd 範圍重疊邏輯(InMemory 同步補 + false-positive test case)
>   - backlog #20 PaginationParams + Paginated<Product>(對齊 IProductRepository.searchByKeyword JSDoc)
>   - SupabaseProductAdapter JSDoc 加樂觀鎖 / idempotency / audit trail TODO(對齊 ADR-0003 §3.3 規則 + #86 / #73 race + security-timeline §C7)
>   - SupabaseProductAdapter 寫 packages/adapters/src/supabase/(取代原 medusa/ 子目錄、對齊 ADR-0005 §8.1)
>   - 對齊 supabase-schema-design.md §2-§5 + §10 索引策略階段 1(M-1-16 種子 200 SKU 規模)
> **M-1-03 啟動前(本 slice 前) 順手:** apps/medusa/ → apps/api/ rename(對齊 ADR-0005 §2.4 Sean 拍板 i、本 slice 不真實 rename、實際 rename 進 M-1-03 主實作 slice 含)
> **C 切法 8 slice 拆法(2026-05-04 Claude.ai 拍板、Sean Q2=A1):**
> pre1(rename + 件 #2 #20/#51 PaginationParams + Paginated\<T\> 預定義) → prep(件 #3 #86 thematic1 BC + 件 #4 #83 matchFitment yearStart/yearEnd 真邏輯) → main-a(Supabase schema migration + RLS basic + env) → main-b(SupabaseProductAdapter 6 method + mappers + helpers + JSDoc TODO) → main-c(spike round-trip 驗 4 mapping + clean up) → main-d-pre(apps/storefront tsconfig + boundaries Rule 5 + import resolver glob、對齊 backlog #54/#23) → main-d(storefront 首頁從 Supabase 拉真資料) → audit(雙跑 skill audit follow-up: engineering:code-review + simplify)
> **M-1-13 啟動前必修:**
>   - backlog #81 Product variants schema spike + 落地(60-90 min spike + 90-120 min 落地)
>   - backlog #82 design `inStock: boolean` ↔ domain ProductAvailability mapper(30 min)
>   - backlog #43 image upload 落 Supabase Storage(對齊 ADR-0004 Q2=A2)
> **storefront wire-up slice 啟動前:** backlog #87 in-memory dev singleton lifecycle(Map.clear + HMR)
> **第 3 處撞才抽 trigger:** backlog #84 Timestamped utility(M-1-14 / M-2-05 / M-3-02 任一)、#85 createFakeProduct fixture(M-1-03 / M-1-13 / M-1-15 任一)
> M-1-01-true / M-4a-01 / M-5-01(apps 真寫 .ts)時補 boundaries dry-run Rule 5 + import resolver glob 加 apps/*/tsconfig.json(對齊 backlog #54 Supersede + #23 完成註)
> M-1-16 啟動前需處理 #44 種子 transition

2. (背景)Claude Design 補 3 頁 + 1 微調(M-2 / M-3 前完成)
3. (✅ 完成)4 件 setup:Supabase / Vercel / Railway / GCP — 細節見 `docs/architecture/2026-04-30-handoff-to-claude-ai.md` §10

## Sean 待決策

| # | 決策內容 | 阻塞什麼 |
|---|---|---|
| 1 | A3 Phase 1 階段 1 是否做發票自動化(綠界 / 藍新 / 國稅局)| M-3 訂單後段 |
| 2 | G2 測試覆蓋率目標 + E2E 範圍 | M-6 整合測試 |
| 3 | TapPay sandbox 是否沿用舊環境 / 需重申請 | M-3 結帳 |
| 4 | Vercel / Railway 部署是否新建 / 沿用 | M-6 部署 |
| 5 | ✅ apps/medusa/ 改用途(對齊 ADR-0005 §2.4)— Sean 2026-05-04 拍板 i:改名 apps/api/(實際 rename 在後續 slice、本 supabase-schema-design 已引用 apps/api/ 字面)| 已解 |

(其他項目:無、A1 / A2 / A4-A7 / B / C / D / E / F 已寫進 feedback 檔、進 writing-plans 自動納入)

---

## Phase 1 範圍速查

依 `docs/PHASE-1-NORTHSTAR.md` v2:

- **真權威:** Claude Design = `pcmmotorsports/pcm-website-design` repo(submodule 掛在 `design-reference/`)
- **方向:** design 直接搬進 `apps/storefront`、Medusa schema 對應 design 資料結構重建
- **執行單元:** slice(15-45 分鐘可中斷、單一 commit 體積小)
- **舊 repo:** `pcmmotorsports/pcm-website` 完全凍結、不動

## 技術棧速查

依 `docs/decisions/0001-rewrite-decision.md`:

- **Monorepo:** pnpm 9.15 + Turborepo
- **前台:** Next.js 16 + TypeScript + Tailwind v4
- **後台:** Medusa.js v2 + Prisma + Supabase PG(SG region)
- **共用:** packages/ui(@pcm/ui)+ packages/schemas
- **金流:** TapPay sandbox
- **部署:** Vercel(前台)+ Railway(後台)
- **Node:** v22 / pnpm 9.15
- **Git:** SSH only、新 repo `pcm-website-v2`

## 關鍵路徑速查

| 項目 | 路徑 |
|---|---|
| 主 repo | `/Users/sean_1/pcm-website-v2`(待 Sean clone) |
| design-reference submodule | `pcm-website-v2/design-reference/` |
| 舊 repo(凍結) | `/Users/sean_1/pcm-website` |
| 舊 design-reference clone | `/Users/sean_1/pcm-website/design-reference/` |
| Busboy 腳本 | `/Users/sean_1/pcm-tools/scripts/`(沿用) |
| Hermes Node | `/Users/sean_1/.hermes/node/bin/`(沿用) |

## 文件交叉引用

每次新對話依此順序對齊上下文:

1. **`STATUS.md`** ← 本檔(每次先讀)
2. `docs/PHASE-1-NORTHSTAR.md` v2 — Phase 1 真權威定義
3. `docs/lessons-learned.md` — 舊專案教訓彙整
4. `CLAUDE.md` — Claude Code 工作規則
5. `docs/PHASE-1-MILESTONES.md` — milestone 排程
6. `docs/decisions/` — 重大決策記錄
7. `docs/patterns/` — 通用 + PCM 專屬規矩
8. `docs/phase-1-backlog.md` — 未決事項
9. `docs/features/*.md` — PRD
10. `design-reference/` — 視覺真權威字面(submodule)
11. `PROGRESS.md` — 歷史紀錄

衝突仲裁順序:
- STATUS.md 與其他 md 衝突 → STATUS.md 為準
- 其他 md 與對話歷史衝突 → md 為準
- 視覺 / 結構 / 路由 / 元件命名衝突 → design-reference 為準
- 業務邏輯(訂單流程、權限、價格、Medusa schema)衝突 → docs/decisions/ 為準

## Busboy 機制(沿用第一輪)

- **busboy-start.js:** Sean 在 Terminal 跑、輸出貼新 Claude Code session 第一則訊息
- **busboy-end.js:** Claude Code 在 session 最後跑、自動更新本檔 6 個欄位(最後更新 / Phase Milestone slice Branch / 最近 3 commit / 下一步 / Sean 待決策 / 變更紀錄)、commit、不 push(Sean 手動推當 review checkpoint)
- repo 參數:`pcm`(本 repo)/ `tools`(pcm-tools)

第一次 busboy-end 跑之前、本檔欄位手動填(start template 用、由 Claude.ai 維護)。

busboy-end 跑完後 amend 進 slice 主 commit、不另開 commit。

---

## 變更紀錄

| 日期 | 變更 | 變更者 |
|---|---|---|
| 待 day-1 commit 後填 | 初始化 STATUS.md | Sean(手動) |
| 2026-04-30 | slice 5 完成 + busboy fix | Claude Code |
| 2026-04-30 | design-sync-finalize 完成 | Claude Code |
| 2026-04-30 | brainstorming + 後台+自動化 spec + Claude.ai feedback | Claude Code |
| 2026-04-30 | 4 件 setup 完成(Supabase / Vercel / Railway / GCP)+ handoff §10 進度紀錄 | Claude Code |
| 2026-05-01 | M-0-01a 完成(root TS 環境 + turbo typecheck pipeline)、busboy-end 收工 | Claude Code |
| 2026-05-01 | M-0-01b 補丁完整版完成(4 packages 空殼 + ui/schemas + pnpm catalog typescript)、backlog #6 字面 vs 事實事件、busboy-end 收工 | Claude Code |
| 2026-05-01 | M-0-07 完成(C3 ADR-0003 + C5 L1 規則層 + NORTHSTAR §1.1 補敘 + backlog #6.1 ✅ / #7 / #8 新增 + M-0 排程 patch)、busboy-end 收工 | Claude Code |
| 2026-05-01 | M-0-08 完成(C4 三權分立 — security-timeline.md Phase 1 安全時序統一表 30 條 + backlog #4/#7 加交叉引用)、busboy-end 收工 | Claude Code |
| 2026-05-01 | STATUS-fix 完成(字面校準 + backlog #3 解 + #9 新增 + M-0 §3.5.1 執行順序註記)、busboy-end 收工 | Claude Code |
| 2026-05-01 | M-0-04 完成(ports 5 介面 IProductRepository / ICustomerRepository / IOrderRepository / ISheetsAdapter / ITapPayAdapter + domain 6 context type stub shared/catalog/identity/order/sync/payment + @pcm/domain workspace dep + backlog #10/#11/#12/#13)、busboy-end 收工 | Claude Code |
| 2026-05-01 | M-0-04 audit amend 完成(MemberTier 移 shared / findByFitment → listByFitment / ports JSDoc TODO milestone-anchored M-1-03/M-4a-08/M-4a-10/M-4a-XX / FitmentSpec + CategoryPath @see anchor / backlog #11 擴 ITapPayAdapter 命名抽象化 + 加 #14 SheetRangeSpec 抽象化 + 加 #15 Sean skill audit 工作流)、busboy-end 收工 | Claude Code |
| 2026-05-01 | M-0-04 雙輪 skill audit follow-up 完成(第一輪 engineering:code-review 抓 5 / 第二輪 simplify 抓 12 / 處理 7 個命名+JSDoc:S1 listByBrand/S2 searchByKeyword/S4 SyncResult JSDoc/N5 ICustomerRepository import note/N6 OrderItem.quantity guard/N7 Product enumerate/N8 Cardholder PII expand;backlog 9 條更新:擴 #11/#14、新 #16-#21、更新 #15)、busboy-end 收工 | Claude Code |
| 2026-05-02 | M-0-03 完成(ESLint 邊界守門 7 條 boundaries/dependencies + 8 task lint script + 7 條 dry-run 全 CAUGHT + dependency-rules.md;字面 vs 事實偏離 4 條 commit body 揭示:eslint v10.3.0/v9 + --no-error-on-unmatched-pattern + .ts 副檔名 dry-run hack + ADR-0003 §3.4 backlog 條目錯置;engineering:code-review audit 抓 8、立即修 C1/C2/C3/S1、backlog 加 #22-#25 4 條、config-only slice 豁免 simplify)、busboy-end 收工 | Claude Code |
| 2026-05-02 | M-0-03 audit follow-up — deep round 處置完成(自跑第二輪 audit 抓 5 處立即修:D1+D2 slice-checkpoint.md §4.1→§2 字面錯置、G1 STATUS「共 5 slice」→6 slice/5 milestone、C3 dependency-rules.md §6.1 補 apps allow 同步提醒、tsPlugin 移除對齊第一輪 C3 unused 標準;catalog @typescript-eslint/eslint-plugin 清理連動;N1 ADR-0002 §4.2 ui/schemas 字面 vs 實作 disallow * 偏離 Sean Q2=A2 拍板不動 ADR、保持 dependency-rules.md §1 揭示)、busboy-end 收工 | Claude Code |
| 2026-05-02 | M-0-05 完成(docs/architecture/medusa-schema-design.md Part 1 落地 314 行;product / brand / category / tier price 四 entity 三節結構 domain camelCase / Medusa wire / mapping § 編號;tier 命名對照表 premiumStore ↔ premium_store ↔ pcm_premium_wholesale 字面對齊 packages/domain/shared/types.ts:43;Security Checks §C4 priceByTier 不洩漏鐵則 §6.2 集中記錄 + 後續 milestone 接力 M-1-02/M-1-03/M-2-08/M-2-09/M-6-08;Part 2 placeholder 預定 scope;不留 Part 3;L1 typecheck+lint 全綠 build §2.2 純 docs 可省)、busboy-end 收工 | Claude Code |
| 2026-05-02 | M-0-06 完成(medusa-schema-design.md Part 2 落地;§8 訂單狀態機 + 9 contexts 責任分割;§8.4 deep audit 4 修法:P0 file path drift / A1 取消黑洞 / B 跳階 / A1-A4 Phase 1 邊界 4 條;§8.5 Security Checks 規劃接力 #A4/#B4/#C7;phase-1-backlog.md 加 6 條 #26-#31:partiallyRefunded / B2B 月結 / split shipment / paymentMethod / fitment scale / 客服 schema;sneak peek 2 條進 backlog、全專案 audit 推遲到新對話獨立 slice;L1 typecheck+lint 全綠 build §2.2 純 docs 可省)、busboy-end 收工 | Claude Code |
| 2026-05-02 | 全專案 audit 完成(獨立 sanity-check slice、Sean 拍板 Q1=A3 / Q2=B3 / Q3=C1 主 session 跑 2 Skill;engineering:tech-debt 抓 25 + operations:risk-assessment 抓 19、過三視角 filter 留 43 條進 backlog #32-#74;T13 合併 R16;§4.2 既有條目引用 #4 / #16 / #20 / #27 / #29 / #30 / #31;STATUS Sean 待決策 #1-#4 對應 Audit-F12 / F15 / F22 / F27 / F36;優先級 🔴 Critical 1 / High 13 / 🟠 Medium 22 / 🟡 Low 6 / 🟢 觀察 2;`docs/audits/2026-05-02-full-audit.md` 落地;L1 typecheck 6/6 + lint 8/8 全綠 build §2.2 純 docs 可省)、busboy-end 收工 | Claude Code |
| 2026-05-02 | M-0-02 完成(apps/admin + apps/sync-engine 極簡空殼字面複製 storefront/medusa 純殼結構、無 tsconfig/src/README、對齊 dependency-rules.md §5.3;packages/{use-cases,adapters,schemas}/src/index.ts file-level JSDoc 處置 audit #65/T22;Code sanity-check 抓 Claude.ai 原指令 Step 5-7 違反 ADR-0002 §4.2 + Step 1 假設 storefront/medusa 有 tsconfig pattern 偏離 4 條、Sean Q1=A1/Q2=B1/Q4=D1 拍板;audit #54/T23 trigger 修正延後到 M-1-01/M-4a-01/M-5-01;L1 typecheck 6/6 + lint 10/10 全綠 build §2.2 純 stub 可省)、busboy-end 收工 | Claude Code |
| 2026-05-02 | M-0-02 audit follow-up 完成(雙輪 skill audit:engineering:code-review 抓 7 + simplify 抓 1 新 + 1 補強、互補 7/1/1;立即修 4 處 JSDoc 字面 CR-1/2/3/4 — adapters audit #60→#48 編號修正 + use-cases/schemas trigger 改抽象 + use-cases ADR-0002 §5→§5.3;backlog #54 加 supersede 註 + 新 #75/#76/#77 三條 CR-5/CR-7+S-C/S-A;Sean Q1=A1/Q2=A3/Q3=A1/Q4=A1 拍板;L1 typecheck 6/6 + lint 10/10 全綠 build §2.2 純字面修可省)、busboy-end 收工 | Claude Code |
| 2026-05-03 | M-0-09 完成(a + b 兩 sub-slice 跨 repo:M-0-09a busboy-end.js pre-flight 三綠提示段 pcm-tools commit f00f2a7;M-0-09b working-style.md §6.3「指令發送前自檢」新節從 backlog #12 / #15 / #76 integrate 第 8 / 第 10 / 第 11-13 條 + #76 節 1 節 2 supplementary、backlog 三條標 ✅、Sean Q1=A1/Q2=B1/Q3=C3/Q4=D2/Q5=E1 拍板;sanity-check 抓 9 處字面 vs 事實偏離 multi-select 回報、Sean 拍板修正版指令;M-0 收尾完整 9/9 進 M-1;L1 typecheck 6/6 + lint 10/10 全綠 build 純 docs / md 可省)、busboy-end 收工 | Claude Code |
| 2026-05-03 | M-0-10 完成(三 sub-slice a/b/c:M-0-10a 6e04c35 文件層 — ADR-0004 m1-pre-launch-decisions 6+4 題拍板 + testing-strategy / bounded-contexts / money-handling 三新 doc + ADR-0002 §7 4 條 stale 修(medusa-schema-design / dependency-rules / testing-strategy / bounded-contexts → ✅、ports-and-adapters / PRD-rewrite 維持 🟡)+ wrs.it IA 報告 git track;M-0-10b b9e43c9 .ts 25 min 嚴守 §11.5 規則 1 — Money brand type MoneyAmount + toMoneyAmount() helper、FitmentSpec.year → yearStart + yearEnd \| null;M-0-10c 8dbc241 規範字面 + backlog — medusa-schema-design §2.4 yearStart/yearEnd 4 種範例 + §2.5 search 兩階段(M-1-03 ILIKE / M-6 tsvector+pg_jieba)、ADR-0003 §4 第 3 條補、IProductRepository JSDoc 兩階段、security-timeline #F6 Supabase Pro 30→31 條、PHASE-1-MILESTONES §1 M-0 6→10 / §3.5 加 M-0-10 / §10.5 M-6-08 60→90 min / §11 加 Supabase Pro trigger、backlog #13/#45/#46/#57 ✅ + 新 #78 商品名硬規範 / #79 wrs IA 觀察;Sean 拍板 Q1=A2/Q2=A2/Q3=A1/Q4=A3/Q5=A3/Q6=A3 + wrs Q1=A1/Q3=A2/Q4=#78/Q5=撤銷/Q6=B2 + slice 結構 Q1=A1/Q2=A1/Q3=A3;sanity-check 抓 3 處 multi-select 回報、Sean 拍板修正版指令;L1 typecheck 6/6 + lint 10/10 三綠、build 純 type stub / docs 可省)、busboy-end 收工 | Claude Code |
| 2026-05-03 | M-1-01 完成(6b00b5d Vercel deploy fix — monorepo root vercel.json 含 framework: nextjs + installCommand corepack enable + pnpm install --frozen-lockfile;對齊 setup §10.3 字面解 Vercel pnpm 6.35.1 vs ≥9.15.0;字面 vs 事實 4 處 commit body 揭示:1. Vercel 官方建議 vercel.json 放 Root Directory(apps/storefront)Sean 拍板 monorepo root → 對齊字面、deploy fail 時評估;2. installCommand 含 corepack 冗餘但無害(明確意圖、deploy log 清楚);3. 不寫 buildCommand 預期 next 套件找不到 fail = M-1-04/05 起裝;4. STATUS hash drift 上輪 amend 後;ENABLE_EXPERIMENTAL_COREPACK=1 由 Sean 在 Vercel Dashboard 加;sanity-check 抓 buildCommand 字面與 storefront 純殼預期 fail 模式不一致 → Q1 拍板移除 buildCommand 解;L1 typecheck 6/6 + lint 10/10 全綠、build §2.2 純 config 可省、不跑 skill audit 對齊 working-style §6.3 第 10 條 + backlog #15)、busboy-end 收工 | Claude Code |
| 2026-05-03 | M-1-01-followup 完成(2e044cc 純 docs:backlog 加 #80 design-reference submodule Vercel deploy fetch warning;成因 SSH-only submodule + Vercel build 無 SSH key、現不阻 / M-1-05 起 Header.tsx 搬時必爆;預期解候選 A 推薦 = GitHub deploy key + Vercel 配對機制 30-45 min 獨立 slice、M-1-05 啟動前必修;Sean 拍板 A1 進 backlog 不馬上修;字面 vs 事實 2 處:1. backlog 編號 grep #79 +1 = #80;2. slice 指令字面假設「ahead 1 未 push」實際 Sean 已 push abf5089、本 slice 完成 ahead = 1 不是 Step 7 預期 2;順手修上輪 STATUS 最近 commit hash drift 6b00b5d → abf5089;L1 typecheck 6/6 + lint 10/10 全綠、build 純 docs 可省、不跑 skill audit)、busboy-end 收工 | Claude Code |
| 2026-05-04 | M-1-02-prep 完成(b3eebf5 純 config + docs:M-1-02 啟動前 3 trigger 處理 — #43 image CDN Supersede 推薦改 Supabase Storage 對齊 ADR-0004 Q2=A2 + trigger 精修 M-1-13 / M-1-16;#66 Medusa spike Supersede trigger 精修 M-1-03 啟動前;#23 import resolver 標 ✅ 完成 = 裝 eslint-import-resolver-typescript@4.4.4 + 配 settings packages/* glob + 6 條 dry-run 重跑全 CAUGHT 用相對路徑無副檔名 + dependency-rules.md §5.1 改「已落地」+ §7 變更紀錄;字面 vs 事實 5 處 commit body 揭示:1. apps/* glob 暫不加(apps 純殼、對齊 backlog #54 Supersede);2. dry-run Rule 5 跳過(apps 純殼、待 M-1-01-true 等補);3. Supersede 註多 sub-bullet vs 既有 #54 單行;4. pnpm install +12/-3 transitive deps;5. pnpm 9.15 不升 10.33;L1 typecheck 6/6 + lint 10/10 全綠、build 純 config + docs 可省、不跑 skill audit 對齊 working-style.md §6.3 第 10 條 + backlog #15)、busboy-end 收工 | Claude Code |
| 2026-05-04 | M-1-02 完成(d56c52d 主實作 12 檔:catalog/types.ts Product 擴 7 欄位 description / images / availability / handle / subtitle / createdAt / updatedAt + IProductRepository.save method JSDoc milestone-anchored TODO + InMemoryProductRepository.ts 真實作 6 method + InMemoryProductRepository.test.ts 7 test cases + vitest.config.ts root + ADR-0003 §3.1.1 跨 context 命名業務規則 + runtime helper 跨 package re-export 規則 + domain/src/index.ts 加 export toMoneyAmount runtime;Sean 拍板 Q1=A2 / Q2=A3 / Q3=A2 / Q4=A1 + slice 結構 Q1=A1 加 IProductRepository.save + Q1=A1 patch 修 domain/src/index.ts;backlog #17 ✅ / #19 ✅ / #33 Supersede 業務訊號推翻 audit-F17 / 新 #81 variants schema spike trigger M-1-13 啟動前;字面 vs 事實 5 處 commit body 揭示:1. IProductRepository 加 save 對齊 Q4 業務精神;2. toMoneyAmount runtime cross-package gap M-0-10b 遺漏 / Q1=A1 補 + ADR-0003 §3.1.1 補規則;3. vitest 套件裝 add list 擴 root package.json + pnpm-workspace.yaml + pnpm-lock.yaml;4. §6 → §9 變更紀錄位置修正;5. subject「6 欄位」實際 7 欄位 body 揭示;L1 typecheck 6/6 + lint 10/10 + test 7/7 + build 0 task 4 綠;Sean 主 session 跑雙輪 skill audit 建議)、busboy-end 收工 | Claude Code |
| 2026-05-04 | M-1-02-audit 完成(b089d79 skill audit 雙輪 findings 處置 9 檔:雙輪互補 100% 零重疊、engineering:code-review 0C/3M/3L correctness + simplify 17 議題 reuse/quality/efficiency = 23 議題扣合併 ≈ 18 unique;5 立即修:C1 save defensive copy structuredClone / M2 searchByKeyword empty query reject / L1 ProductAvailability type alias / E1 vitest glob 擴 .tsx+.spec+apps/** / Q8 domain/src/index.ts 5 行壓 1 行;4 規範類:Q3 ADR-0003 §3.2 string union type alias 規則 / Q6 ADR-0003 §3.3 ports JSDoc contract vs adapter TODO 規則(連動移 IProductRepository.save adapter TODO)/ Q2-E2-E5 testing-strategy.md §3.4 in-memory 樣板不搬到真實 adapter / E1 testing-strategy.md §1 同步擴字面;6 backlog:#82 design boolean↔domain enum mapper M-1-13 / #83 matchFitment yearStart/yearEnd M-1-03 / #84 Timestamped utility 第3處撞才抽 / #85 createFakeProduct 第3處撞才抽 / #86 thematic1 M-1-03 啟動前樣板leak+contract test+edge cases / #87 thematic2 in-memory dev singleton lifecycle;Sean 拍板 Q1=A1 / Q2=B1 / Q3=C2 / Q4=D1 + 處置精修 E1 跨類雙落地;字面 vs 事實 5 處揭示;L1 typecheck 6/6 + lint 10/10 + test 7/7 + build 0 task 4 綠;不再跑第三輪 skill audit 對齊 working-style §6.3 第 10 條雙跑紀律)、busboy-end 收工 | Claude Code |
| 2026-05-04 | M-1-03-prep 完成(15eda71 純 docs 2 檔:docs/architecture/medusa-spike-verification-checklist.md 落地 backlog #66;Sean 拍板 Q1=A1 / Q2=A2 / Q3=A1 / Q4=A2;§1 範圍 = Catalog 4 條核心 Product / Brand / Category / Tier Price + 排除項對齊 ADR-0004 Q2 / Q3 + backlog #81;§2 過判斷 = 真實 round-trip 5 步 + 通過條件 + 不在驗項;§3 decision tree 設計錯訊號 4 條(觸發 §4 rollback)+ 裝錯訊號 4 條(本 spike 內修)+ 模糊預設視為設計錯;§4 rollback 路徑重述 ADR-0002 §6.3 自包含 + 文件處置 + Sean 通知時機;#66 ✅ 完成;字面 vs 事實 4 處揭示:1. §4.1 表合 5 條對齊 ADR §6.3(ports 包進 monorepo 結構行);2. §3.1 第 1 條 Brand collection 訊號精修(Medusa v2 product_collection 必存在、改寫機制限制過嚴);3. §1 排除項補引用 ADR-0004 Q2/Q3 + #81;4. STATUS hash drift 上輪 amend 後修;L1 typecheck 6/6 + lint 10/10 全綠 build §2.2 純 docs 可省、不跑 skill audit 對齊 working-style §6.3 第 10 條 + backlog #15)、busboy-end 收工 | Claude Code |
| 2026-05-04 | M-1-03-pre0 完成(9e3c66b 純 docs 1 檔:docs/architecture/medusa-monorepo-integration-plan.md 研究產出 + Sean 拓寬「不用 medusa 用什麼」;WebFetch 5 URL 抓 Medusa v2 docs 官方 stance「pnpm only single-package、推薦 yarn/npm for monorepo」+ GitHub issues #14833 Zod v4 hoisting OPEN active blocker / #15280 OPEN + Vendure GPLv3 NestJS GraphQL 8.1k stars + Saleor Python 排除;PoC 跳過(核心問題已知);5 方案 A Medusa+hoist例外 / B 手動裝 minimal / C apps/medusa 排除 workspace / D Vendure / E Custom+Supabase 直寫;三視角評估表 E 全高;推薦 E 含 Phase 2 9 大藍圖視角理由 — Vehicle/Booking/Wallet/Shop/Sync 5 context 本來走 Supabase、剩 4 context 自寫 cart/order/payment/Price List 1-2 週;Sean multi-select 拍板範圍 A vs E + ADR-0005 落地時機;字面 vs 事實 4 處揭示;L1 typecheck 6/6 + lint 10/10 全綠 build 純 docs 可省)、busboy-end 收工 | Claude Code |
| 2026-05-04 | M-1-03-pre0b 完成(73bb63c 純 docs 5 檔架構級轉向:Sean 拍板 Q1=A1 廢 ADR-0002 §1.2 Pivot 2「Medusa-as-API」改 Custom + Supabase 直寫、9 contexts 統一架構;ADR-0005 docs/decisions/0005-custom-supabase-direct.md 落地含 §1 Context + §2 Decision + §3 5 候選方案決策摘要 + §4 沒有更優解確認(Medusa/Vendure/Saleor/Payload/SaaS/Bun 排除)+ §5 三視角 + §6 Rollback 訊號 4 強 3 弱 + §7 影響清單 + §8 後續 milestone 字面變更(M-1-03 estimate 75-90 min → 6-8 hr)+ §9 變更紀錄;medusa-schema-design.md / spike-verification-checklist.md 加 ⚠️ Superseded metadata 字面保留;backlog #66 補廢註;STATUS 待決策表加 #5 apps/medusa 改用途(候選 i/ii/iii、ADR-0005 §2.4 待 M-1-03-pre0c 拍);字面 vs 事實 4 處揭示:1. slice 字面誤指 ADR-0002 §3 Medusa-as-API、實際在 §1.2 Pivot 2、本 commit 對齊實際 ADR-0002 結構;2. slice §2.4 「待決策清單」語意偏離、SupabaseProductAdapter 等動作項寫進下一步段、apps/medusa 改用途加進待決策表;3. M-1-03 estimate 變更 75-90 min → 6-8 hr;4. ahead origin/dev = 2 跨 e9f97c5 + 73bb63c;L1 typecheck 6/6 + lint 10/10 全綠 build §2.2 純 docs 可省、不跑 skill audit;STATUS amend 補 hash + 變更紀錄行)、busboy-end 走例外規則「不再 amend」 | Claude Code |
| 2026-05-04 | M-1-03-pre0c 完成(純 docs 2 檔:docs/architecture/supabase-schema-design.md 落地取代廢的 medusa-schema-design.md、Sean 待決策 #5=i apps/medusa→apps/api 標 ✅;Part 1 §1-§6 Catalog 4 條核心(Product 7 欄位 SQL CHECK constraint availability + price_by_tier_keys + Brand value-object FK + Category 樹 parent_category_id + Tier Price jsonb 內聯三 tier + customer_groups 表 + Security Checks 對應 #C4 priceByTier 不洩漏 + 後續 milestone 接力);Part 2 §7-§10 Order 雙維度狀態機(SQL CHECK 5 enum payment 含 partiallyRefunded + 4 enum fulfillment + 3 enum fulfillment_method + 雙軸獨立 transitions + 取消 transitions reject + order_items snapshot)+ 9 contexts 全 Supabase 對應表清單(Catalog/Identity/Order/Pricing/Vehicle/Booking/Wallet/Shop/Sync)+ RLS policy 4 表(ADR-0005 後變化:無 Medusa service role bypass、改 anon key + RLS、products 全 SELECT public + service role 寫 / customers SELECT 限自己 / customer_groups SELECT 限 service role / orders SELECT 限 customer_id = auth.uid)+ service role key 紀律 + 索引策略 3 階段(M-1-16 基本 7 索引 / GIN on fitments jsonb_path_ops backlog #30 / tsvector + pg_jieba + websearch_to_tsquery 對齊 ADR-0004 Q3=A1 後段 backlog #35);Part 3 §11-§13 9 大藍圖預留 checklist(客人端 8 條對齊 PHASE-2-VISION §3 / 店家端 4 條 vehicle 獨立 entity + shops + bookings + order fulfillment 深化 / 員工後台 3 條 wallet_ledger / member_discount_overrides / discounts_applied jsonb 對齊 backlog #47);字面對齊 ADR-0003 §4 9 條 + ADR-0004 4 題 + security-timeline §3 7 條 + PHASE-2-VISION §3 9 條預留 + ADR-0005 §2 + §8;L1 typecheck 6/6 + lint 10/10 全綠 build §2.2 純 docs 可省、不跑 skill audit)、busboy-end 走例外規則「不再 amend」 | Claude Code |
| 2026-05-04 | M-1-03-pre0d 完成(5d17011 純 docs 1 檔:STATUS.md「下一步」段「M-1-03 主實作」blockquote 內補 1 段 C 切法 8 slice 拆法字面、對齊 2026-05-04 Claude.ai 拍板紀錄 Sean Q2=A1「先落 STATUS 再啟動 pre1」;8 slice = pre1(rename + #20/#51 PaginationParams + Paginated\<T\> 預定義) → prep(#86 thematic1 BC + #83 matchFitment yearStart/yearEnd) → main-a(Supabase schema migration + RLS basic + env) → main-b(SupabaseProductAdapter 6 method + mappers) → main-c(spike round-trip 驗 4 mapping) → main-d-pre(apps/storefront tsconfig + boundaries Rule 5 + import resolver glob) → main-d(storefront 首頁從 Supabase 拉真資料) → audit(雙跑 skill audit follow-up);為 M-1-03 後續 7 slice 提供進度錨點;字面 vs 事實揭示 2 處:1. 指令 §C old_str/new_str 字面缺 markdown blockquote 標記、實作對齊 STATUS L45-46 既有結構恢復;2. Paginated\<T\> 落實 backslash + 角括號避免 markdown render 失真;L1 typecheck 6/6 + lint 10/10 + test 7/7 全綠 build §2.2 純 docs 可省、不跑 skill audit;手動跑 busboy-end 6 步 procedure amend 補 6 欄位)、busboy-end 走例外規則「手動 amend 補 6 欄位」 | Claude Code |
| 2026-05-04 | M-1-03-pre1 完成(ccf40a5 refactor 9 檔 + 2 rename:apps/medusa→apps/api git mv 保留 history、apps/api/package.json name @pcm/medusa→@pcm/api + description 對齊 ADR-0005、5 處 active docs 字面同步 PROJECT-OVERVIEW/PHASE-1-NORTHSTAR/pcm-specific/dependency-rules;件 #2 PaginationParams + Paginated 泛型預定義對齊 backlog #20:domain shared/types.ts append + IProductRepository import 補 + searchByKeyword 簽名 (query, params) → Paginated of Product + JSDoc 重寫 contract + 性能兩階段 + list 三方法 @TODO M-1-09/10 對齊 backlog #51 + InMemoryProductRepository 改 + 補分頁 boundary test 7 product limit 3 offset 0;字面 vs 事實揭示 6 處:1. Markdown 失真備援 #1/#2/#3/#5 還原;2. STATUS L29 hash drift 留 busboy-end 自動覆蓋;3. InMemory contract gap 留 backlog #86 prep;4. IProductRepository header revert 對齊 §F scope;5. NORTHSTAR + pcm-specific stale 段未動推遲;6. package.json git rename 顯示 new+deleted 因 similarity threshold;L1 typecheck 6/6 + lint 10/10 含新 @pcm/api task + test 8/8 + build 0 task 4 綠;不跑 skill audit;手動跑 busboy-end 6 步 procedure amend 補 6 欄位)、busboy-end 走例外規則「手動 amend 補 6 欄位」 | Claude Code |
| 2026-05-05 | M-1-03-side 完成(cc5c475 純 docs 2 檔:新建 docs/product-import-spec.md 19 欄 CSV 格式 v1.0 Sean 2026-05-04 拍板定案 93 行 + phase-1-backlog.md 補 3 條 #88 規格照片切換 / #89 庫存顯示 / #90 CSV 匯入腳本;此 slice 屬 M-1-03 期間 side task 獨立於 8 slice 拆法、插在 pre1 與 prep 之間、不阻擋 prep;字面 vs 事實揭示 3 處:1. 指令字面起手 4 綠第 4 條預期 HEAD = e234e0b 過時、Sean 拍板 A1 用實際 HEAD 4f064ac 為基準執行;2. markdown auto-link 失真按 A1 還原 backtick 包本地路徑;3. commit subject docs(M-1-03-side) 對齊專案 convention;順手修 STATUS L29 pre1 hash drift ccf40a5 → 4f064ac;L1 三綠可省、不跑 skill audit;手動跑 busboy-end 6 步 procedure amend 補 6 欄位)、busboy-end 走例外規則「手動 amend 補 6 欄位」 | Claude Code |

— END —
