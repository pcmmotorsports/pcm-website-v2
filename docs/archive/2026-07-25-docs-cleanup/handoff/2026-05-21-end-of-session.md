# 2026-05-21 End-of-Session Handoff

> Cowork session 收工交接文。下個 session(Cowork + Code 各一)進來第一件事讀這份對齊。

---

## 1. Session metadata

| 欄位 | 值 |
|---|---|
| 日期 | 2026-05-21 |
| Branch | `dev` |
| HEAD | `f21581c` (origin/dev 已對齊、push 完成) |
| design-reference submodule | `637dafc` (heads/main、已 push 到 pcm-website-design GitHub) |
| dev server | 已關(或請 Sean 確認) |
| 工作樹 | clean(除 `apps/storefront/next-env.d.ts` Next 自動產出 + 既有 untracked 不在本 slice scope) |

---

## 2. 今日 4 個 commit(時序)

| # | hash | 內容 |
|---|---|---|
| 1 | `c6c8b27` | refactor(storefront): ProductServices 從 ProductInfo 拆出 [M-1-13f-1] |
| 2 | `88ca807` | feat(storefront): ProductTabs 4 分頁對齊 design 真權威 + ARIA + CSS [M-1-13f-2] |
| 3 | `637dafc` | (design repo) feat(product-page): 加入 VariantCFull demo + handoff 文件 |
| 4 | `f21581c` | chore: sync design-reference 至 637dafc + STATUS.md (商品頁全改版接續) |

---

## 3. 當前 milestone 全貌

```
M-1-13a ✅  ProductImageGallery
M-1-13b ✅  ProductInfo 基底
M-1-13c ✅  Breadcrumb + 路徑記憶
M-1-13d ✅  Variants(推延 #81)
M-1-13e ✅  Pricing tier + Mobile buybar(e-pre-1/2/3 + e-a + e-b + e-b-2)
M-1-13f ✅  ProductInfo 拆 + ProductTabs(f-1 + f-2)
M-1-13g ⏸  Related + Toast + Responsive(暫停、卡片改完評估)
M-1-13H ⏭  商品頁全面改版(Apple/Aritzia、下次 session 起)
M-1-14   ⏭  Customer schema
M-1-15   ⏭  LoginPage·RegisterPage
M-1-16   ⏭  200 SKU 種子
```

---

## 4. 下次 session 任務:M-1-13H 商品頁全面改版

### 4.1 真權威字面(必先 grep)

| 檔案路徑 | 大小 | 用途 |
|---|---|---|
| `design-reference/components/explorations/VariantCFull.jsx` | 13KB | Apple/Aritzia 現代派完整參考頁 |
| `design-reference/styles/explorations.css` | 32KB | `.vcf-*` / `.vc-*` class 字面 |
| `design-reference/design-handoff/PRODUCT-PAGE-HANDOFF.md` | 14KB | 商品頁改版逐項交接(視覺細節都在裡面) |
| `design-reference/design-handoff/SUPABASE-PRODUCT-PAGE.md` | 10KB | Phase 2 後台串接 plan(先 LOG 不動) |

### 4.2 改版業務脈絡(Sean 2026-05-21 拍板)

- 客人反映滑頁累、視覺重點散 → 圖縮小、字緊、配色克制
- 缺少賣點突顯區 → 新增「3 大亮點 Highlights」section
- 旗艦商品需要故事感 → 新增「Engineering Spotlight」section(先 `product.id % 3` 假判斷、Phase 2 supabase `product_spotlights` 表上線後改真資料)
- 適用車款資訊太佔版面 → 移除厚 banner、併進副標
- Tabs 底線單調 → 改 pill tabs

### 4.3 保留清單(HANDOFF.md 明示、不可拆)

- breadcrumb 路徑記憶(source / sourceId / sourceLabel)
- vehiclePill 顯示與清除
- lightbox(ESC / ← → / 手機滑動)
- 主圖 hero swipe
- 加入購物車 toast
- `getPriceForTier` 會員等級價格
- 行動版 buybar 與返回邏輯

### 4.4 工作流(回歸 Code、Sean 2026-05-21 拍板)

```
Cowork (我)        Code               Sean
   |                 |                  |
   1. 寫 slice-0 偵察指令 ─────────→ 貼進 Code
                     |                  |
                     2. grep VariantCFull + HANDOFF
                     3. 回報範圍 + 估時 ───→ Sean 看 + 貼回 Cowork
   |                                    |
   4. 看 Code 偵察報告
   5. 寫實作 plan + multi-select 拍板 ───→ Sean 拍板
   |                                    |
   6. 寫實作 slice 指令 ────────────→ 貼進 Code
                     7. 開工(slice-1 / 2 / ...)
                     8. 每 slice commit + 三綠 + 不 push
                                        9. Sean 視察 + push
```

### 4.5 範圍預估

- 4-6 個 slice 跨多 session
- 總時長 3-5 小時
- 主要重寫:`apps/storefront/src/components/ProductPage.tsx` + `product-page.css`
- 同檔新增 2 個 section:Highlights + Spotlight(不拆獨立元件、對齊 HANDOFF)
- `ProductCard.tsx` 不動
- 完成驗收後刪除 `design-reference/components/explorations/` 整包(對照畫布、正式版不需)

---

## 5. 今日教訓 — Cowork 工作流邊界(下次必遵)

**事故:** 2026-05-21 design-reference sync slice、我(Cowork)直接 cp 檔案 + Edit STATUS.md + 給 Sean Terminal 命令補 git、整個跳過 Code session。Sean 質疑「不是要 code 執行嗎?」、同日進一步明示「不用 Claude.ai 了」、Cowork = 規劃層唯一介面、Code = 實作層。

**規則(對齊 memory `feedback-cowork-no-direct-execution`):**

| 動作 | Cowork 可不可 |
|---|---|
| Read / Grep / 讀檔(只讀) | ✓ 可以 |
| 寫 / 編輯 `.md` docs(STATUS / docs/) | ✓ 可以、但 commit 仍交 Code |
| 寫 / 編輯 `.ts·.tsx·.css·.sql` 字面 | ✗ 絕對不可、寫 slice 指令給 Code |
| `git add / commit / push` | ✗ 絕對不可、Code 跑 |
| `cp` 大量檔案(design 資產等) | ⚠ 事前明確跟 Sean 確認、不擅自動 |

**違反 = Sean 質疑、要重對齊工作流、可能要重做 slice。**

---

## 6. Sean 待決策(沿用、無新項)

#1 發票自動化 / #3 TapPay sandbox / #4 部署(Vercel+Railway)— premortem 應對 step-2 將為這 3 項設「最晚拍板日」。詳見 STATUS.md「Sean 待決策」欄。

---

## 7. 下個 session 開場 prompt 範本

### 7.1 Cowork(新對話)

```
請讀 docs/handoff/2026-05-21-end-of-session.md 對齊上下文、
再讀 STATUS.md + docs/PHASE-1-NORTHSTAR.md。

今天目標:M-1-13H 商品頁全面改版 plan 階段。

第一步:寫 slice-0 偵察指令給 Code、grep design-reference/components/explorations/VariantCFull.jsx + design-handoff/PRODUCT-PAGE-HANDOFF.md 真權威字面、回報範圍。

(回歸 Code 工作流、Cowork 不直接動 code / 不跑 git。)
```

### 7.2 Code(新 Claude Code session)

```
[貼 busboy-start.js pcm 輸出]
```

第一則訊息純粹貼 busboy-start template。Code 跑完起手 5 綠檢查 + 讀 STATUS、回報「我已讀完套件、可以開工」、然後等 Cowork 傳第一個 slice 指令(slice-0 偵察)。

---

## 8. 5 綠起手檢查預期(新 Code session)

```bash
cd /Users/sean_1/pcm-website-v2
git branch --show-current     # 預期: dev
git status                     # 預期: clean(除 next-env.d.ts + 既有 untracked)
git log --oneline -5           # 預期最上面: f21581c
git submodule status design-reference  # 預期: 637dafc...
```

任一不綠 → 停下回報 Sean、不自行修復。

STATUS.md 欄位 3 第一筆 `b0c6821` vs 實際 HEAD `f21581c` 差 1 步 = CLAUDE.md「1 步 amend drift 屬慣例範圍」、允許。

---

— END —
