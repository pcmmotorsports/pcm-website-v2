# 商品目錄選車 UX(ADR-0007)Slice A-D 交接

> Updated: 2026-07-31 · Asia/Taipei(原 2026-07-30 晚;commit 與 Sean 驗收後更正)
> Repo: `/Users/sean_1/pcm-website-v2` · Branch: `dev`
> 🔴 **本線 commit = `2864e69`(27 檔)· 未 push**;其後 A7-t 線另有 commit 疊在上面,
> push 時會一起上去 —— 推之前先看 `git log --oneline origin/dev..HEAD`,不看寫死數字。
> 執行 agent: Claude(opus-5)· 工作模式: 執行 → **已 commit,未經 Codex 審查(見 §5)**
> 前一份(開工指令)= `docs/handoff/2026-07-30-catalog-ux-claude-execution-handoff.md`
> 長期決策 = `docs/decisions/0007-catalog-vehicle-selection-ux.md`
> 拍板白話全集 = memory `project_catalog-ux-0730-decisions`

---

## 1. 一句話現況

桌機與手機的選車 UX 已全部落地、**三綠全過、已 commit(`2864e69`)、未 push、零 DB 變更**;
Sean 真機驗收六輪回饋全部折入,**Q3「我的愛車」已於 2026-07-31 由 Sean 登入驗收通過**。
**下一手 = backlog #306(選車後即時計數),Sean 指定另開新視窗做 —— 本線已 commit,可直接開始。**

---

## 2. 這批做了什麼(對照 ADR-0007)

### 桌機
- 搜尋式三欄 + 年份新到舊由 `?vehicle-ui=preview` **提升為正式預設**,query gate 整條移除
  (`CascadeFilterTop` 現在零 local state,不再靠 `useEffect` 讀 `window.location` 判斷自己是哪一版)。
- 🆕 **車型欄可直接輸入車款**(Sean 指定):未選廠牌時在「品牌 車型」攤平字面空間跨層搜尋,
  選定同時補上廠牌。打錯字顯示「查無符合的車款,請調整關鍵字」。
- 「我的愛車」維持 `.cft-right` 原位 + 中性 `variant="top"`;版面/左側欄/商品卡/排序/分頁未動。

### 手機(全部新增)
- `MobileVehicleSheet` — 草稿制選車面板:真愛車卡片一點套用、三欄可搜尋可展開、
  **清草稿 ≠ 清車輛**、無 autoFocus、聚焦捲回可視區、跨層直搜與「不限年份」出口都在。
  **選了廠牌就能送出**(逐層送出:brand / brand+model / brand+model+year)。
- `ProductsMobileControls` — 車輛列 + **類別 / 品牌價格 / 排序**三個獨立入口 + 排序面板。
  大塊車輛資訊捲走、`.pmc-sticky`(精簡車輛列 + 三入口)黏頂。
- `FilterDrawer` 新增 `scope`(`'all'` 預設不變 → `dev-preview/filter-drawer` 零影響;
  `'category'` / `'product'`;商品篩選不再含選車)。
- 🔴 **手機不再顯示被壓縮的桌機三欄**(整條 `.cft-bar` 在 ≤1024px 關閉)——
  順帶修好「手機一直看不到我的愛車」(舊 `.cft-right { display: none }`)。單顆「篩選」FAB 退場。

### 共用 / 收斂
- `lib/vehicle-options.ts` — 年份排序 + 車型欄跨層選項與解析(桌機手機**同一顆**,不建立第二套比對)。
- `lib/sort-options.ts` — 排序選項單一定義點(桌機 select 與手機面板共用;value 同時是 `?sort=` 契約)。
- `VehicleCombo` 新增 `emptyHint`(附加式;不傳=既有三個掛載點行為零變動)。
- `GarageChips` 新增 `variant="sheet"` + `onApplied`(附加式;`top`/`drawer` 路徑不變)。
- `ProductsPage` 410 → 389 行(回到鐵則 6 的 400 以內)。

---

## 3. Sean 拍板全集(接手不得重問)

| # | 題目 | 拍板 |
|---|---|---|
| Q1 | 桌機「內容不滿版」驗收項與現況衝突 | **B 維持現況滿版**;`--shell-max: none` 是接手前設定、不動 ⇒ **該驗收項作廢** |
| Q2 | 1025-1079px 帶狀區無篩選入口 | **A 順手修掉**(已完成) |
| Q3 | 「我的愛車」我無法登入驗證 | **A Sean 自己登入肉眼驗** ⇒ ✅ **2026-07-31 Sean 已驗收通過**(逐字「我的愛車ok」) |
| Q4 | 分類數字要跟著車款走 | **A lazy 查 + 等本片 commit 後另開一片** ⇒ backlog **#306** |
| Q5 | 手機頁面標題區 79px | **B 藏大標題、留麵包屑**(用 clip 視覺隱藏,`<h1>` 語意保留) |
| Q6 | 篩選膠囊列 27px | **A 不動**(唯一能單獨拿掉年份的地方) |

**逐字指示(已全部折入)**:①「選擇廠牌後應該就要可以搜尋」②「電腦版也要可以直接輸入車款」
③「篩選→品牌/價格、推薦排序→排序、分類→類別」④「品牌右側不要出現該品牌數量」
⑤「如果無法跟該選擇車款即時算出來數量,那都不要」⑥「包含桌機也是」
⑦「我最希望還是可以即刻算出來」= #306 的終態。

---

## 4. 🔴 真機驗收抓到的三個 bug(全部是本片改出來的、已修)

| # | 症狀(Sean 真機截圖) | 根因 | 修法 |
|---|---|---|---|
| 1 | 只能三欄全填才送得出 | 照 dev-preview mock 的 `canApplyVehicle` 抄,**比正式站能力更嚴**(`products/page.tsx:57-59` 逐字記載品牌-only 早就支援) | 改逐層送出 |
| 2 | 工具列「沒有固定成功」 | sticky 掛在 `.pmc-bar`,父層 `.pmc-root` 高度**剛好等於它自己**(163px)⇒ 移動空間 0(實測捲 900px 後在 `top:-835`) | `.pmc-root` 手機改 `display: contents` + sticky 搬到 `.pmc-sticky` |
| 3 | 車款標題卡畫面中間 + 上方空一條 | `products-page.css:302` 的 `top:120px` 註解逐字寫 `64 mobile header + 56 cascade bar`,**而本片把手機 cascade bar 關掉了** ⇒ 幽靈偏移 | 手機覆蓋 `position: static` |

🔴 **教訓(已寫 memory)**:#2 #3 在 jsdom **永遠綠**(不做 layout、不算 sticky),3400+ 條元件測試全過
也抓不到 —— 只有真機/真瀏覽器捲動量測抓得到。守門只能落在 CSS 文字層 + 捲動實測兩處。

另有兩個**我自己驗證流程**的假綠(已修,memory 有):CSS 守門的 `@media` 切片跑出區塊、
`pkill` 沒殺掉舊 server 導致重建後 CSS 回 500 而「量的是沒有樣式的頁面」。

---

## 5. 驗證(實跑過的,不是宣稱)

```bash
pnpm --filter @pcm/storefront typecheck   # exit 0
pnpm --filter @pcm/storefront lint        # exit 0
pnpm --filter @pcm/storefront build       # Compiled successfully
pnpm test                                 # 278 檔 3428 passed + 1 todo,0 failed
```

- **突變測試 22 條全部轉紅**(M1-M19 + M20/M21/M22 件數閘雙向),還原一律 shasum 逐檔驗。
- **真瀏覽器實測**(production build、真 Supabase 資料):390 / 1024 / 1025 / 1026 / 1060 / 1079 / 1365 七個寬度;
  捲動 0/400/600/900/1800/2000 六點驗黏頂;觸控命中 68×44 / 68×40 / 150×50 / 120×50 全部 true。
- **端到端真資料**:`?vehicle=yamaha` 2349 件 → `:mt-09` 396 件 → `:mt-09:2021` 198 件;
  `?vehicle=kawasaki:ninja-zx-10r:2024` 236 件;`&category=…` 43→21 件;`?sort=price-asc` 生效;
  清除車輛回 19037 件並清掉分類;跨層直搜打 `r1` 命中 29 筆真字典車款。
- **件數閘實測**(桌機 1365):未選車 分類 15 / 品牌 16 個數字;選車後 **0 / 0**,可選項仍 15 列。

🔴 **誠實邊界(未做,不得代為宣稱)**:
- ~~**「我的愛車」未驗**~~ ✅ **2026-07-31 Sean 登入後肉眼驗收通過**(逐字「我的愛車ok」)。
  🔴 紀錄口徑:這是 **Sean 背書**、不是 AI 驗的 —— 我無登入憑證且不讀 `.env*`,當時未宣稱通過。
- **未跑 axe / 無障礙自動掃描**。
- 真機鍵盤遮擋:`scrollIntoView` 機制已驗會呼叫,但 headless 無軟鍵盤 ⇒ **實際遮不遮只有真手機知道**。
- 🔴 **本 commit 未經 Codex 審查** —— 開工交接檔要求「Codex PASS 後才 commit」,
  Sean 於 2026-07-30 晚直接指示「先 commit 你的部分」⇒ 依指示提交,**審查閘未走**。
  接手者若要補審,對象 = `git show 2864e69`。
- 未 push、未 deploy、零 DB 變更、未動 `.env*`。

---

## 6. 🔴 工作樹 ownership(接手第一件事看這裡)

同一個工作樹裡有**兩條線**。E10/A7 線在本 session 期間 commit + push 兩次(`93ef491`、`20df2fb`),
之後又留下新的未提交檔案。**本線 commit 時必須精準 `git add`,不得掃進他線。**

### 本線 —— ✅ **已於 `2864e69` 提交(27 檔,含 ADR 與兩份交接檔)**
下列清單是當時的 staged 內容,保留供追溯;現在要看實際內容用 `git show --stat 2864e69`。
```
M  STATUS.md
M  docs/handoff/CURRENT.md
M  docs/phase-1-backlog.md                       # 只有 #306 這 84 行是本線的
M  apps/storefront/src/app/layout.tsx
M  apps/storefront/src/components/CascadeFilterTop.tsx
M  apps/storefront/src/components/CascadeFilterTop.test.tsx
M  apps/storefront/src/components/FilterDrawer.tsx
M  apps/storefront/src/components/FilterDrawer.test.tsx
M  apps/storefront/src/components/FilterSide.tsx        # ⚠️ 見下方「授權擴張」
M  apps/storefront/src/components/FilterSide.test.tsx
M  apps/storefront/src/components/GarageChips.tsx
M  apps/storefront/src/components/ProductsPage.tsx
M  apps/storefront/src/components/ProductsPage.test.tsx
M  apps/storefront/src/components/VehicleSelect.tsx
M  apps/storefront/src/styles/filter-cascade.css
M  apps/storefront/src/styles/filter-responsive.css
?? apps/storefront/src/components/MobileVehicleSheet.tsx
?? apps/storefront/src/components/MobileVehicleSheet.test.tsx
?? apps/storefront/src/components/ProductsMobileControls.tsx
?? apps/storefront/src/components/ProductsMobileControls.test.tsx
?? apps/storefront/src/lib/sort-options.ts
?? apps/storefront/src/lib/vehicle-options.ts
?? apps/storefront/src/styles/products-mobile.css
?? apps/storefront/src/styles/products-mobile.test.ts
```

### 仍未提交、由 Sean 決定(本線不自行刪)
```
?? apps/storefront/src/app/dev-preview/mobile-catalog-ux/   # 已核准的視覺預覽(交接檔明令保留)
?? docs/superpowers/                                        # 預覽的 spec/plan
```
(ADR-0007 與開工交接檔已一併收進 `2864e69` —— 否則 repo 會有「實作了一份不存在的 ADR」的懸空引用。)

### 🔴 他線(E10/A7-t)—— 絕對不要 add
```
M  docs/handoff/2026-07-30-a7-cancellations-handoff.md
M  docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md
M  supabase/migrations/20260730130000_m4b_e10_a7_order_cancellations.sql
?? docs/specs/2026-07-30-e10-a7t-cancellation-consistency-trigger-plan.md
?? scripts/a7t-behavior-probe.sql / a7t-concurrency-probe.sh / a7t-verify.sh
?? supabase/migrations/20260730140000_m4b_e10_a7t_cancellation_consistency_triggers.sql
```

⚠️ **`docs/phase-1-backlog.md` 是共用檔**:本線只加了 #306(84 行)。commit 前
`git diff docs/phase-1-backlog.md | grep '^+### #'` 應**只有 #306**;若出現別的編號 = 他線也動了,
需先與對方協調再分開 commit。

### ⚠️ 授權擴張(要向 Codex 明講)
`FilterSide.tsx`(桌機左側欄)在開工交接檔裡是**明文凍結**的。本線動它,依據 = Sean 逐字
「**包含桌機也是**」。改動僅一項:`showCounts = cascade.vehicle === null`(選車後不顯示件數),
零版面、零資料查詢變更。

---

## 7. 下一手 = backlog #306(Sean 指定另開新視窗)

**目標(Sean 逐字)**:「我最希望還是可以即刻算出來,當有選擇車款時候,分類或者品牌即時更新適用商品數字」。

已查證、可直接用的事實(**不用重查**):
- 分類件數來源 `fetchCategories()` → `listCategories()`(`products_public` head:true exact count)= 全域。
- 品牌件數來源 `catalog_brand_counts()` RPC(`lib/products.ts:410-431`)= 全域、**不吃車輛參數**。
- 🔑 **既有 RPC `search_catalog_by_vehicle` 已接受 `p_category` 並回 `total`**
  (`packages/adapters/src/supabase/database.types.ts`)⇒ **不需要新 migration**。
- 分類數 = 15(實測);某分類 0 件時該 RPC 回**零列** ⇒ 讀不到 total,直接當 0(正好是要灰掉的)。
- 現況過渡措施 = 選車後**隱藏**件數(`FilterDrawer` + `FilterSide` 兩處 `showCounts`)。
  🔴 **#306 完成後要把隱藏改回顯示真實件數,不是繼續隱藏**。

開工前置(不可省):
1. 動「正式資料查詢」= 開工交接檔明文凍結的邊界 ⇒ **需 Sean 重新授權**。
2. 跨 3+ 檔 ⇒ **鐵則 8:先提 plan 等批准**。
3. client 取數需要 server action / route handler(現在件數是 server props 一次帶下來的)。

✅ **順序風險已解除**:本線已於 `2864e69` 提交 ⇒ 新視窗可直接開始 #306,不會與本線混在同一批。
🔴 但工作樹仍有 **A7-t 線**在動(見 §6)⇒ #306 的 commit 一樣要精準 `git add`,不得掃進他線。

---

## 8. 停在哪 / 下一個最小動作

1. ~~Codex 唯讀審查 → 修 findings → commit~~ 🔴 **已跳過審查直接 commit**(`2864e69`,Sean 指示)。
   要補審的話對象 = `git show 2864e69`;審出問題就開新 commit 修,不要 amend
   (後面已疊了 A7-t 線的 commit)。
2. **不 push** —— 等 Sean 手動推;推之前先確認 A7-t 那條線也可推(會一起上去)。
4. ~~Sean 登入肉眼驗「我的愛車」(Q3=A)~~ ✅ **2026-07-31 已完成**。
5. 之後另開視窗做 #306。

**地圖(graphify)未刷**:PCM 2026-07-10 拍板「`/graphify --update` 不隨每 slice 跑,milestone 收尾
或每日收工跑一次即可」,且本片尚未 commit ⇒ 刷了會把未定案的結構寫進圖。留給 milestone 收尾。
