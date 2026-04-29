# 0001 — Phase 1 整個重做、新 repo 從零

> **狀態:** 已拍板 / 2026-04-29
> **拍板人:** Sean
> **影響範圍:** 全 Phase 1
> **本檔角色:** 重大決策記錄、不可改、後續若推翻必開新 decision 檔指向本檔

---

## 1. 決策摘要

**Phase 1 整個重做、新 repo `pcm-website-v2` 從零、舊 repo `pcmmotorsports/pcm-website` 凍結保留。**

- **方向:** design-reference 直接搬進新 storefront、Medusa 後台 schema 對應 design 資料結構重建
- **舊 repo:** 暫時保留可開發狀態(陸來有事可切回)、不主動凍結 GitHub archive
- **資料:** 既有 Medusa DB 全部清空(都是測試資料)
- **結構:** 完整 monorepo(apps/storefront + apps/medusa + packages/ui + packages/schemas)
- **凍結期:** 規劃完成前舊 repo 完全凍結、只修 critical bug

---

## 2. 為什麼這個決策

### 2.1 第一輪卡住的根因

第一輪 PCM 從 2025 年起持續堆疊功能、累積到 2026-04 出現:

1. **單一檔案過大** — `OrdersClient.tsx` 達 2269 行、TDZ 風險高
2. **品質關卡失效** — `next.config.ts` 設了 `typescript.ignoreBuildErrors`、build pass ≠ runtime
3. **設計與實作分裂** — design-reference 引入後、storefront 既有結構與 design 衝突、走「縫合」路線卡兩週
4. **方向性錯誤** — Claude.ai 一直在「翻譯 design 進 storefront」、本質方向錯

### 2.2 04-29 對話發展

Sean 提出三次方向性糾正、最後拍板整個重做:

| 對話節點 | Sean 表達 | 我的反應 |
|---|---|---|
| 第一次 | 「我們是要去把 design 拿來用、不是盡量合併」 | 還在想怎麼縫合、方向錯 |
| 第二次 | 「為何不能直接拿來用?」 | 開始懂、提「直接搬」做法 |
| 第三次 | 「乾脆整個重新做、直接拿 design 檔案、作為前台、去重新打造後台」 | 完全懂、拍板整個重做 |
| 第四次 | 「medusa 重新設計討論而已」 | 拍板含後台一起重做 |

### 2.3 三視角分析(整個重做 vs 縫合)

| 視角 | 整個重做(本決策) | 縫合(第一輪路線) |
|---|---|---|
| 擴充性 | 高(design 更新就再搬一次) | 低(每次都要兼容判斷) |
| 可維護性 | 高(storefront 與 design 同構) | 低(縫合處永遠是 bug 來源) |
| bug 可追蹤性 | 高(出問題就看 design) | 低(三層糾纏) |

**整個重做全勝。**

### 2.4 工時估算對比

| 路線 | 估時 |
|---|---|
| 縫合(第一輪) | 「6-10 週還走不完」(實質卡住) |
| 整個重做(本決策) | 約 5-9 週(前台 1-2 天 + 後台 3-5 天 + 串接驗證 1-2 天 + 測試 1-2 天)然 / 加上 Phase 2 全部約 12-14 個月 |

整個重做反而快、因為縫合根本走不完。

---

## 3. 已拍板的子決策

### 3.1 既有 Medusa 資料

- ✅ **A1:全部清空**(都是測試資料、最乾淨)

### 3.2 git 結構

- ✅ **B1:新 repo `pcm-website-v2` 從零做**

### 3.3 舊 repo 命運

- ✅ **E2:暫時保留可開發**(陸來有事可切回、不主動 archive)

### 3.4 新 repo 命名

- ✅ **F1:`pcm-website-v2`**

### 3.5 monorepo 結構

- ✅ **完整 monorepo**:apps/storefront + apps/medusa + packages/ui + packages/schemas

### 3.6 design-reference

- ✅ **A:用 git submodule 掛 `pcm-website-design` repo**
- ✅ **A:`uploads/` 不進新 repo**(submodule 仍排除)

### 3.7 Phase 1 schema 預留(對應 PHASE-2-VISION 9 點藍圖)

| 預留 | 影響 9 點 | 拍板 |
|---|---|---|
| product 圖片 / PDF 用 URL string | #2 | ✅ 預留 |
| product 多 price tier(Medusa Price List) | #6 | ✅ 預留 |
| customer.tier 欄位 | #6 | ✅ 預留 |
| customer.line_oa_id 欄位 | #3 | ✅ 預留 |
| customer_group 機制 | #6 | ✅ 預留 |
| order.fulfillment_method 三選一 | #4 | ✅ 預留 |
| order unique 識別碼可生 QR | #8 | ✅ 預留 |
| vehicle 為獨立 entity(不嵌 customer) | #5 | ✅ 預留 |
| 每頁 Metadata + structured data | #9 | ✅ Day 1 起 |
| **#1 大量上架 / 爬蟲同步 schema** | #1 | ❌ **不預設**(Sean 拍板:Phase 2 PRD 一起想) |

### 3.8 規劃文件先行

- ✅ **先寫 PRD-rewrite.md → 再寫 milestones → 再進 slice**
- 規劃期完全凍結舊 repo
- 新 Claude Code 第一個動作 = 偵察 design-reference + 寫 PRD

### 3.9 .md 庫存範圍

- ✅ **全部寫**(15 份)、給新 Claude Code onboarding 完整套件

---

## 4. 第一輪有但新 repo 不繼承的東西

| 項目 | 為什麼不繼承 |
|---|---|
| 第一輪 4 元件(CascadeFilterTop / ActiveChips / MobileFab / Breadcrumb) | 抽得對、但新 repo 從 design 重新搬、舊 repo 留作參考 |
| 第一輪 OrdersClient | 重做後用 Medusa Admin 內建、不寫客製 admin |
| 第一輪 Tailwind grid layout | 完全砍掉、用 design 的 plain CSS 結構 |
| 第一輪 PRODUCTS-README | 新 repo 從 Medusa schema 起、不再用 mock data 規範 |
| 第一輪所有 commit history | 新 repo 從 init commit 起、不 cherry-pick |
| 舊 backlog 編號 #1-#90 | 新 repo backlog 從 #1 重新編、舊編號僅供歷史參考 |

---

## 5. 第一輪有且新 repo 沿用的東西

| 項目 | 沿用方式 |
|---|---|
| design-reference 內容 | 用 submodule 掛 pcm-website-design repo、字面相同 |
| `vehicle-service-ecosystem.md` PRD | 1:1 搬、加 v0.2 header |
| Sean 工作風格 | 整理進 working-style.md |
| 工程教訓 | 整理進 lessons-learned.md |
| Busboy 腳本 | 沿用 `/Users/sean_1/pcm-tools/scripts/`、repo 參數 `pcm` |
| Hermes Node 環境 | 沿用 |
| SSH 認證設定 | 沿用 `~/.ssh/id_ed25519` |
| Vercel Pro 帳號 | 沿用、新建 project |
| Railway 帳號 | 沿用、新建 service |
| TapPay sandbox 帳號 | 沿用 |
| Supabase 帳號 | 沿用、新建 project |
| Chrome DevTools MCP 設定 | 沿用 user scope `~/.claude.json` |

---

## 6. rollback 方案

若新 repo 路上出大問題、可切回舊 repo:

1. 舊 repo 完整保留、可切回 dev branch 繼續工作
2. 但**舊 repo 縫合方向已驗證走不完**、回去意義不大
3. 真要 rollback、應該是「新 repo 內某個 slice 寫錯、git revert」、不是「回舊 repo」

---

## 7. 何時可以推翻本決策

只在以下情況考慮推翻:

1. **重做執行中發現 design-reference 結構嚴重不可實作**(極不可能、但若發生需重新評估方向)
2. **Sean 商業優先級重大改變**(例如要立刻上線、沒時間重做)
3. **技術棧出現重大不相容**(極不可能、但若 Next.js 16 或 Medusa v2 突然有 breaking change 影響全局)

推翻流程:
- 開新 decision 檔(0002 / 0003 等)
- 詳述新方向、為什麼推翻、新 vs 舊對照
- 本檔不刪除、加 header「⚠️ 已被 #00XX 推翻、僅供歷史參考」

---

## 8. 變更紀錄

| 日期 | 版本 | 變更 | 決策人 |
|---|---|---|---|
| 2026-04-29 | v1.0 | 初稿、完整拍板 | Sean |

— END —
