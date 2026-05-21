# M-1-03-audit-disposition slice-C 偵察報告

> **狀態:** 偵察報告、不寫推薦、只列事實 + 待決問題
>
> **產出於:** 2026-05-13
> **HEAD:** `86b776d`(sub 8e-2 amend 後)
> **目標:** 為 slice-C disposition 指令字面提供事實基準

---

## § 1 audit 報告來源清單

`docs/reviews/`:
| 檔 | 行數 | 編號慣例 | 階段 |
|---|---|---|---|
| `M-1-03-prep-audit-2026-05-05.md` | 409 | F1-F21(雙 round) | M-1-03-prep |
| `README.md` | — | — | reviews 索引 |

`docs/audits/`:
| 檔 | 行數 | 編號慣例 | 階段 |
|---|---|---|---|
| `2026-05-02-full-audit.md` | 808 | Audit-F1-F40+ / T1-TN / R1-RN | 全專案三維 audit |
| `M-1-03-main-a-刀-4-sub-8d-findings.md` | 359 | eng-1~13 / simp-1~19(雙 audit) | M-1-03-main-a 刀 4 sub 8d |

**重要事實:**
- 全 repo grep「議題 4」字面 **0 命中**(除了 STATUS L15/L35 + 本 recon)、無單一獨立的「M-1-03-audit 議題 1-N 完整清單檔」
- 「議題 N」編號分散在 audit-slice-A/B/C commit body 內,不在 docs/ 任一檔
- audit-slice-0 commit body 提「進入 8 條議題複核 slice」、暗示原始 audit findings 有 8 條議題、但完整字面定義缺
- audit findings 報告(prep + full + sub 8d)用 F-/Audit-F-/eng-/simp- 編號、未明示對應「議題 N」映射

---

## § 2 議題 4 NaN 字面 + 出處 + 現況交叉檢查

### § 2.1 議題 4 字面溯源

**直接「議題 4」字面 grep 結果:** 全 repo 0 命中(僅 STATUS L15/L35 文字描述)。

**間接溯源(commit body):**

`3f998c3 feat(M-1-03-audit): products_public view migration — 議題 1+6 修 [audit-slice-A]` commit body 揭示:
> Sean Q-fix-1=A1b 拍板:#118(adapter)+ #119(projection)、**留 #117 給 slice-C**

→ slice-C「議題 4」≈ #117 對應的 ProductCard.id 議題(commit body 字面「留 #117 給 slice-C ProductCard.id 議題」)。

**從 sub 8d findings 雙 audit 命中(id NaN 故障鏈):**

`docs/audits/M-1-03-main-a-刀-4-sub-8d-findings.md`:

| 議題 | 行 | 檔案位置 | 描述 |
|---|---|---|---|
| eng-1 | L34-40 | `apps/storefront/src/lib/products.ts:77` | `id: product.id as unknown as number` cast 結果非 number runtime NaN |
| eng-8 | L90-96 | `apps/storefront/src/components/ProductCard.tsx:34-42` | `PRODUCT_IMG_POOL[seed % n] ?? ''` seed === NaN → array index NaN → '' broken URL |
| simp-6 | L182-188 | `apps/storefront/src/components/ProductCard.tsx:34-42` | productGallery 推導公式 hardcode、NaN propagation |
| simp-12 | L230-236 | `apps/storefront/src/app/page.tsx:65` + `ProductCard.tsx:129` + `lib/products.ts:77` | 三處字面散落、debug 鏈未明示 |

雙 audit 命中重疊度:
- eng-1 ↔ simp-12(id cast trade-off)
- eng-8 ↔ simp-6(productGallery NaN)

### § 2.2 議題 4 NaN code 現況交叉檢查

`git log --oneline -5 -- apps/storefront/src/components/ProductCard.tsx apps/storefront/src/lib/products.ts apps/storefront/src/app/page.tsx`:

```
3d0b842 feat(M-1-03-main-a 刀 4 sub 8e-1): findings 立即修 4 條 + backlog #117 anchor + #129-#132 + #85 trigger 重評
3ce9776 feat(M-1-03-main-a 刀 4 sub 7): ProductCard 接 <Price> + dead CSS 清 + PRD §2 sub 7 字面修
723ae60 feat(M-1-03-main-a 刀 4 sub 4b): storefront 公式 dispatch + memberLabel 落地
e2cdecb feat(M-1-03-main-a 刀 4 sub 3): page.tsx tier 來源 cookie + env-guarded ?tier= 覆寫
1147fbe feat(M-1-03): main-d-d2 — N°04 真資料接入 + priceByTier strip + adapter export [main-d-d2]
```

**最新 commit `3d0b842` sub 8e-1 改了 4 處立即修(eng-7 / eng-9 / simp-3 / simp-7)、未動 id cast 邏輯。**

**NaN 議題現況判定:仍存在**(三處字面均存活)

具體驗證:
- `apps/storefront/src/lib/products.ts:77`(d2 commit body 字面引、sub 8e-1 未動)— `id: product.id as unknown as number` 仍存在
- `apps/storefront/src/components/ProductCard.tsx:34-42`(sub 8e-1 動了 PALETTES module-level、但 productGallery 邏輯未動)— `PRODUCT_IMG_POOL[seed % n] ?? ''` 仍存在
- `apps/storefront/src/components/ProductCard.tsx:129`(sub 8e-1 未動)— `seed={p.id}` 仍存在
- `apps/storefront/src/app/page.tsx:65`(sub 3 落地、sub 8e-1 未動)— `data-tier={tier}` 仍存在

### § 2.3 #117 anchor 字面(sub 8e-1 落地、L2946 起)

```markdown
### #117. ⏳ id NaN cast 故障鏈 anchor — string ProductId → number 串接(audit 雙命中)

- **狀態:** ⏳ 待執行
- **優先級:** 🟠 中(NaN 路徑只在 Supabase 0 row → mock fallback 落地時 hit、M-1-16 種子前需修;真資料模式下 mock fallback 路徑廢、視 ProductPage M-1-13 啟動再評)
- **問題:**
  - `apps/storefront/src/lib/products.ts:77` `id: product.id as unknown as number` 把 string ProductId cast 成 number
  - `apps/storefront/src/components/ProductCard.tsx:34-42` `PRODUCT_IMG_POOL[seed % n] ?? ''` seed === NaN → NaN propagation
  - `apps/storefront/src/components/ProductCard.tsx:129` `seed={p.id}` 三處字面互關
- **觸發事件:** M-1-13 ProductPage 啟動前 + M-1-16 種子前
- **預期解法:**
  - ProductCardProps.p.id 接 string(對齊 domain ProductId)
  - ProductImage seed 改 hash 函式(string → number 確定性映射、避免 NaN)
  - 三處字面 debug 鏈 JSDoc 連結
- **估時:** 30-45 min
- **依賴:** M-1-13 ProductPage 啟動前
- **發現於:** 2026-05-12 / M-1-03-main-a 刀 4 sub 8d 雙 audit 命中
```

**事實:slice-C 議題 4 NaN bug 與 sub 8e-1 #117 anchor 實質為同一議題;#117 已 anchor 化但未實作落地。**

---

## § 3 規範類議題清單 + 各檔現況交叉檢查

### § 3.1 規範類議題出處(commit body 揭示)

| 來源 commit | 規範類 finding 描述 | 推遲處 |
|---|---|---|
| `3f998c3 audit-slice-A` | Finding 4 (`supabase-schema-design.md` doc gap) | 留 Slice 2 規範類批量 |
| `8e31b0a audit-slice-B-2` | `supabase-schema-design.md` / ADR-0003 字面同步 | 留 Slice 2 規範類批量 |
| `133683e audit-slice-B-3` | 同上 | 留 Slice 2 規範類批量 |
| `85415b4 post-audit-design-bump` | 累積教訓 #9-#13 候選 | 留 Slice 2 規範類批量 |
| sub 8d findings simp-14 | TierLabel union type alias 達 ADR-0003 §3.2 規範類門檻 | sub 8e-1 已開 backlog #132 + sub 8e-2 已併入 working-style §6.3 第 22-26 條(部分覆蓋) |
| sub 8d findings simp-17 | premium_extra_pct 雙重 type+runtime 防護 pattern | sub 8e-2 已部分併入 lessons §12-12~16(覆蓋待逐條複核) |

### § 3.2 規範類議題涉及檔現況

**主要涉及檔:**
- `docs/architecture/supabase-schema-design.md`(§6.1 + §9.2 章節補留待)
- `docs/decisions/0003-domain-entity-naming.md`(§3.2 規範類門檻字面)
- `docs/decisions/0005-custom-supabase-direct.md`(§7 service_role key 紀律已落 Slice B、字面同步可能仍需)

**git log -5 各檔近期動向:**

```
docs/architecture/supabase-schema-design.md:
(本 recon 未跑、由 disposition slice 真進入時 git log 驗)

docs/decisions/0003-domain-entity-naming.md:
(本 recon 未跑、由 disposition slice 真進入時 git log 驗)

docs/decisions/0005-custom-supabase-direct.md:
(本 recon 未跑、由 disposition slice 真進入時 git log 驗)
```

**判定:可能已修 / 需逐條檢查**(本 recon 不深入逐條驗、留 disposition slice 進入時驗)

### § 3.3 sub 8e-2 教訓批次落地 vs 規範類批量 overlap 評估

sub 8e-2 已落地(`86b776d`):
- lessons §12-12 ~ §12-16(5 條、來源 backlog #124-#128)
- working-style §6.3 第 22-26 條(5 條、對應 lessons §12-12~16 簡潔版)
- PRD §6 append §6.4 sub 8e-2 落地映射

**overlap:** sub 8e-2 落地內容是「本對話累積教訓」、不是「audit 規範類 finding」;**規範類批量(Slice 2)的 schema-design / ADR-0003 字面同步、累積教訓 #9-#13 候選仍未落地**。

---

## § 4 NaN 跨層位置偵察

### § 4.1 NaN-prone code grep 結果

`grep -rn "isNaN|toFixed|Number(|parseInt|parseFloat" apps/storefront/ packages/adapters/ packages/use-cases/`:

| 位置 | 字面 | 性質 |
|---|---|---|
| `packages/adapters/src/supabase/helpers/fitment.ts:89` | `yearStart = parseInt(startStr, 10);` | 年份字串解析、無關 id NaN 議題 |
| `packages/adapters/src/supabase/helpers/fitment.ts:91` | `yearEnd = parseInt(endStr, 10);` | 同上 |
| `apps/storefront/src/lib/products.ts:56`(JSDoc 註解) | `runtime NaN、d2 happy path 不 hit` | 已揭示、註解描述 |
| (其他)| 0 命中 | — |

**價格 / 數字格式化 grep:** 0 命中(`toFixed` / `Number(` / `isNaN` 全 repo 0 命中)。

### § 4.2 NaN 故障鏈跨層分析

**id NaN 故障鏈三處字面(對齊 #117 anchor):**

| 層 | 位置 | 字面 |
|---|---|---|
| storefront(server-side mapper) | `apps/storefront/src/lib/products.ts:77` | `id: product.id as unknown as number`(d2 commit body 「id cast trade-off 揭示」) |
| storefront(client component prop) | `apps/storefront/src/components/ProductCard.tsx:129` | `seed={p.id}`(把 id 傳成 number、給 ProductImage seed) |
| storefront(client utility function) | `apps/storefront/src/components/ProductCard.tsx:34-42` | `PRODUCT_IMG_POOL[seed % n] ?? ''`(NaN propagation 源) |

**跨層判定:** 三處字面**全部在 `apps/storefront/` 內**、**不跨 layer 到 `packages/adapters/` / `packages/use-cases/` / `packages/domain/`**。

**事實:NaN 修法位置完全收斂在 `apps/storefront/`、不涉及跨層串接(原則 14 不適用)。**

### § 4.3 修法可選位置(僅列事實、不寫推薦)

對齊 #117 anchor 「預期解法」字面:
- A. `apps/storefront/src/components/ProductCard.tsx`:改 `ProductCardProps.p.id: string` + `ProductImage seed: string` + 加 hash 函式(string → number 確定性映射)
- B. `apps/storefront/src/lib/products.ts:77`:移除 `as unknown as number` cast、改傳 string
- C. `apps/storefront/src/data/mock-products.ts:9`:`MockProduct.id: number` → `string`(對齊 domain ProductId)
- D. `apps/storefront/src/app/page.tsx:65`:`data-tier={tier}` 與 NaN 無關、僅作為 debug 鏈 JSDoc 連結 anchor

**A + B + C 形成最小修補集**;D 為 anchor 對齊不需動。

---

## § 5 給 Claude.ai 的待決問題清單(不寫推薦、列問題)

### § 5.1 NaN 修法位置選擇

**Q-NaN-fix-location:**
- 議題 4 NaN bug 與 sub 8e-1 #117 anchor 實質為同一議題、處置選項:
  - 選項 A:slice-C 不開新條目、直接實作 #117 anchor(對應 ProductCardProps.p.id / ProductImage seed / mock-products.ts MockProduct.id 三處 + JSDoc debug 鏈)
  - 選項 B:slice-C 開 disposition slice 字面、引用 #117 anchor、實作 + #117 anchor 狀態 ⏳ → ✅(對齊 sub 8e-1 backlog #124-#128 落地模式)
  - 選項 C:slice-C 延後到 M-1-13 ProductPage 啟動前(對齊 #117 anchor 「依賴:M-1-13 啟動前」字面、不在 audit-disposition 階段落地)

**Q-NaN-fix-scope:**
- 修補範圍是否包含 mock-products.ts MockProduct.id?
  - 選項 A:全改(MockProduct.id: string、保留 mock fallback 路徑、但風險:design 字面 mock products.js 用 number id、字面 drift)
  - 選項 B:只改 ProductCardProps.p.id + ProductImage seed(留 MockProduct.id: number 對齊 design 字面、cast 移到 ProductCard 邊界)
  - 選項 C:整個 mock fallback 路徑廢(對齊 #117 anchor 「真資料模式下 mock fallback 路徑廢」、M-1-16 種子後可行)

### § 5.2 規範類議題分類處置

**Q-rule-batch-scope:**
- 「規範類批量(Slice 2)」涵蓋範圍如何拍?
  - 選項 A:純 docs 同步(schema-design.md §6.1+§9.2 補章節 + ADR-0003 字面同步)、不擴張到累積教訓
  - 選項 B:Slice 2 同時涵蓋 audit 規範類 + 累積教訓 #9-#13 候選(post-audit-design-bump 留待)
  - 選項 C:拆兩 slice、Slice 2a docs 同步 / Slice 2b 累積教訓批次(對齊 sub 8e-2 教訓批次落地模式)

**Q-rule-batch-overlap:**
- sub 8e-2 已落地 lessons §12-12~16 + working-style §6.3 第 22-26 條(來源 backlog #124-#128)、與 audit 規範類 finding overlap 如何處置?
  - 選項 A:複核 sub 8e-2 落地內容、補漏 audit 規範類獨有 finding(避免重複)
  - 選項 B:Slice 2 假設 sub 8e-2 已涵蓋部分、僅補 audit 獨有 schema-design / ADR-0003 字面同步
  - 選項 C:全跑、不擔心 overlap、Slice 2 commit body 明示「與 sub 8e-2 部分 overlap、僅補空缺」

**Q-rule-batch-trigger:**
- Slice 2 規範類批量何時觸發?
  - 選項 A:slice-C 完成後立即啟動(M-1-03-audit-disposition 完整收口)
  - 選項 B:M-1-04 / M-1-13 等下個 milestone 前必修
  - 選項 C:M-1-16 種子前統一處理(對齊 #118 view 切換 + #129 currency helper trigger)

### § 5.3 sub 8d findings 議題編號 vs 「議題 4」對應

**Q-issue-numbering:**
- sub 8d findings 用 eng-N / simp-N 編號、不直接對應 audit-disposition「議題 1-8」編號;議題對應如何拍?
  - 選項 A:slice-C disposition slice 開新「議題 4-8」清單檔(`docs/audits/M-1-03-audit-disposition-issues.md`)、明示映射 eng-/simp- → 議題 N
  - 選項 B:slice-C 不開清單檔、僅 commit body 引用 sub 8d findings eng-/simp- 編號(對齊既有 slice-A/B 模式)
  - 選項 C:廢「議題 N」字面、改用 eng-/simp- 編號(對齊 sub 8d findings 模式、更新 STATUS L15/L35 字面)

---

**Audit 結束、未修任何 source code、純偵察報告交付。**
