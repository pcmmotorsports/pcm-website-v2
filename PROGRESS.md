# PROGRESS.md — PCM Phase 1 重做歷史紀錄

> **角色:** 寫實質進度的歷史檔、不寫流水帳
> **不是 STATUS.md:** STATUS 是「當前狀態」、PROGRESS 是「歷史里程碑」
> **不是 git log:** git log 是 commit 流水、PROGRESS 是「這個 milestone 完成了什麼商業價值」
>
> 衝突仲裁:`STATUS.md` > 本檔 > 對話歷史

---

## 寫法規範

### 何時寫 PROGRESS

- 每個 milestone 結束(M-0 / M-1 / M-2 ...)
- 每個重大里程碑(第一個 slice 跑通 / 第一次 Vercel preview / 第一筆訂單跑通)
- 重大事故 + 修復(避免重複踩坑)
- 重大決策變更(Sean 改方向 → 對應到 docs/decisions/)

### 何時不寫

- 單一 slice 完成(那是 STATUS.md 的事)
- 小 bug 修復(commit message 即可)
- 流水帳(這個檔不是 git log)

### 格式

每筆紀錄含:
1. **日期**(YYYY-MM-DD)
2. **里程碑**(M-? / 重大事件名)
3. **完成了什麼**(商業價值層、不寫技術細節)
4. **技術產出**(slice / commit / PR 編號)
5. **教訓 / 學到的**(若有)

---

## 紀錄

### 2026-04-29 — Phase 1 重做拍板

**里程碑:** Phase 1 v2 啟動

**完成了什麼:**
- Sean 拍板整個重做、新 repo `pcm-website-v2` 從零、舊 repo `pcmmotorsports/pcm-website` 凍結保留
- .md onboarding 套件完成(15 份):STATUS / CLAUDE / lessons-learned / PROJECT-OVERVIEW / PHASE-1-NORTHSTAR / PHASE-2-VISION / working-style / tools-and-skills / decisions/0001 / patterns 三份 / vehicle-service-ecosystem v0.2 / README / PROGRESS / phase-1-backlog
- 規劃方向確定:design-reference 直接搬進 storefront + Medusa schema 對應 design 重建

**技術產出:**
- `docs/decisions/0001-rewrite-decision.md`(完整決策記錄)
- `.md` 套件(`/Users/sean_1/pcm-md-package/`)

**教訓:**
- 第一輪卡住根因 = 「翻譯 design 進 storefront」方向錯
- 「直接搬」與「翻譯」差別:翻譯 = 重新實作、踩 100 個小決策坑;直接搬 = 改插頭規格、不改家具本身
- Sean 04-29 第四次糾正後才完全立此原則(寫進 lessons-learned §0 一句話最重要的事)

**下一步:** 新 repo `pcm-website-v2` init、放 .md 套件、設 design-reference submodule、新 Claude Code 偵察 design + 寫 PRD-rewrite.md

---

### 2026-05-04 — M-1-03 規劃期累積 blockquote 歷史快照(M-1-07 STATUS-shrink 搬位)

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
> pre1 ✅(rename + 件 #2 #20/#51 PaginationParams + Paginated\<T\> 預定義) → prep ✅(件 #3 #86 thematic1 BC + 件 #4 #83 matchFitment yearStart/yearEnd 真邏輯) → prep-audit follow-up ✅(雙輪 audit findings 處置:S1 vitest subpath / S2 contract 命名 / backlog #92-#99 / lessons §12 / reviews 快照檔) → main-a ✅ 完工(a1 ✅ Supabase CLI setup + .env.local 樣板 + migrations 骨架 / a2-1 ✅ brands+categories schema + RLS + 索引 / a2-2 ✅ 完工:v3 5Q 共識 ✅ + Slice 0 PRD 落地 ✅ + Slice A1 products migration ✅ + Slice A2 RLS 4 policy 落地 ✅)→ main-b ✅ 完工(Slice 0 PRD ✅ 287 行 / sub-slice 1-5 ✅ 6 method 全實作 + 14 helper + 雙 audit + Drift D1+D2 修 + #106-#112 開 + #48/#105/#106 補強)→ main-c ✅ 完工(三刀:drift-fix 93ba36e 後台 brand_id+category_id NOT NULL / spike+SDK fix 9d8ef93 5 case 全 PASS + .contains JSON.stringify SDK 字面修 / fitment-fix 2e9abfb client filter cross-check 三條防 false positive / sub-slice 3 收工 雙 audit findings 三類分流 + #114/#115 開 + #108 補強 + 教訓 #6 + STATUS L29 修 + 累積教訓 #1-#6 全程紀錄;Vehicle Finder 資料管線根本驗通 16 sub-cases 雙 audit 過 13/13 InMemory test) → main-d-pre ✅ 完工(apps/storefront/tsconfig.json 對齊 packages/* 模板 + eslint.config.js import resolver glob 加 apps/storefront + dependency-rules.md §5.1 同步 + #54 Supersede 解開 storefront 部分 + #23 補強;為 main-d 真資料接入鋪路)→ main-d-d1 ✅ 完工(Next.js 16.2.6 + React 19.2.6 + design @ d5ea3aa 8 sections jsx → tsx 直接搬 + ProductCard mock 4 筆 + CSS 純引入 + 全 'use client' RSC trade-off + Q1=B1 catalog TS / Q2=A1 不裝 eslint-config-next + Q1=A1 視覺對齊驗收 + #116 開)→ **main-d-d2 ✅ 完工**(@pcm/adapters root export + lib/products.ts server-only fetcher + toUIProduct mapper + priceByTier server-side strip 取 general tier + page.tsx async server component force-dynamic + HomeSelect 三條 UI 分支(error/empty/正常)+ Sean 拍板 Q-empty=b 「目前沒有商品」/ Q-error=b 「載入失敗、請稍後再試」/ Q-category=a 操控部品 + force-dynamic SSR + id cast trade-off 揭示 + dev .env.local 揭示)→ **audit**(雙跑 skill audit follow-up: engineering:code-review + simplify Phase 2 三 agent on M-1-03 全部 commits)
> **M-1-13 啟動前必修:**
>   - backlog #81 Product variants schema spike + 落地(60-90 min spike + 90-120 min 落地)
>   - backlog #82 design `inStock: boolean` ↔ domain ProductAvailability mapper(30 min)
>   - backlog #43 image upload 落 Supabase Storage(對齊 ADR-0004 Q2=A2)
> **storefront wire-up slice 啟動前:** backlog #87 in-memory dev singleton lifecycle(Map.clear + HMR)
> **第 3 處撞才抽 trigger:** backlog #84 Timestamped utility(M-1-14 / M-2-05 / M-3-02 任一)、#85 createFakeProduct fixture(M-1-03 / M-1-13 / M-1-15 任一)
> M-1-01-true / M-4a-01 / M-5-01(apps 真寫 .ts)時補 boundaries dry-run Rule 5 + import resolver glob 加 apps/*/tsconfig.json(對齊 backlog #54 Supersede + #23 完成註)
> M-1-16 啟動前需處理 #44 種子 transition

---

<!--
紀錄模板(複製下面整段、填新紀錄):

### YYYY-MM-DD — 里程碑名稱

**里程碑:** M-? / 事件名

**完成了什麼:**
- (商業價值層、不寫技術細節)

**技術產出:**
- slice / commit / PR 編號

**教訓:**(若有)
- (學到的)

---
-->

— END —
