# Phase 0 P0-C kickoff handoff(前台去碳 + 品牌切換骨架)

> 給接手 **P0-C** 的新 session。真權威 = `docs/specs/2026-07-03-phase0-multibrand-foundation-plan.md`(§2.5 / §2.6 / §4 P0-C / §5 C1 / §6-3)。本檔只補「進度到哪 + 開工第一件事 + 最高約束 + 怎麼拆」,**不重述 plan**。
> 上一輪 session(2026-07-03~04):完成 P0-A 全線去碳(A-1~A-4c)+ P0-B 16 分類 seed migration db push live 驗過。

## 進度快照

- **P0-A ✅ 管線去碳全線收工**(已 push origin/dev):A-1 設定檔 `4612fb4` / A-2 scope `b5993e3` / A-3 transform 去碳 `790ddb5` / A-4a 寫入前安全閘 `b825d31` / A-4b 乾跑報告+GB/Bonamici 實際乾跑驗通 `89c9198` / A-4c handle 底線放寬 `c23bf43`。
- **P0-B ✅ db push live 驗過**(`8a52512` + 校正 `8a1d64f`):categories 從 1 → 17 列(16 大類 + 碳纖維部品 sort 0 未動),`20260703120000` 已套用、唯讀 read-back ALL PASS。
- **Sean 拍板記錄**:副標「碳纖維」→「碳纖維部品」(A-3、隨分類名 rawPath)/ handle 允底線(A-4c)/ P0-B 鐵則 12 waive codex(A、data-only 低風險)。
- 全程零 DB 寫入(除 P0-B seed)、`TAPPAY_3DS_ENABLED`/`ANOMALY_ALERT_ENABLED`/`CRON_SWEEPER_ENABLED` 全 false。
- **Phase 0 剩**:P0-C(本片、前台去碳)→ P0-D(試點乾跑報告交 Sean)。

## 🔴 開工第一件事(硬 gate、鐵則 1)

**動前台元件前先 grep design-reference / 現況元件字面,不憑記憶 / 不憑 plan 行號**:plan §2.6 列的 11 個碳纖維寫死點(`ProductServices:33` / `ProductHighlights:16` / `ProductSwatchWall:44` / `ProductTabs:121,130,161,165,169,174,192` / `ProductSpotlight` / `data/rpm-policies:46`)是 2026-07-03 快照,**接手先 grep 驗當前行號**(元件可能已位移)。

## 🔴 最高約束(前台版不變式 3)

**RPM 商品頁 byte 不變**:去碳守門一律用 `brandSlug==='rpm-carbon'`,RPM 頁維持**原文案原樣**(Sean 肉眼驗 RPM 頁無任何視覺變化)。這是 P0-C 的最高約束,等同 P0-A 的 rpm byte 等價。

### 🔴 F1 陷阱(plan §2.6、務必先讀)

UI 的 `product.brand` = **顯示名**(`products.ts:107` `brand: product.brand.name` → 值 `'RPM CARBON'`),**不是** slug。守門若寫 `brand==='rpm-carbon'` 會**恆 false → RPM 頁碳纖維段全消失 = live 回歸**。**正解**:`toUIProduct` 加 `brandSlug ← product.brand.slug` 傳 UI、守門一律用 `brandSlug==='rpm-carbon'`。

## P0-C 範圍(plan §2.6 / §4 P0-C、Q2=B)

1. **`toUIProduct` 加 `brandSlug`**(← `product.brand.slug`)傳到 UI 層。
2. **碳纖維段守門**:`ProductServices` / `ProductHighlights` / `ProductSwatchWall` / `ProductTabs` 碳纖維文案段 + `ProductSpotlight`(第二道守門)→ `brandSlug==='rpm-carbon'` 才渲染;**非 RPM = 空白**(Q2=B、不猜產地/材質、不做品牌中性 generic)。
3. **prop-less 元件傳 brand prop**:`ProductServices` / `ProductHighlights` / `ProductSwatchWall`(`ProductPage.tsx:287,296-297` 附近無條件渲染)→ 由 `ProductPage` 傳 brand/brandSlug prop 下去守門。
4. **規格表資料驅動**:`ProductInfo` DIM_LABEL / `ProductTabs` 規格表寫死 weave/finish → 改依 variant spec **實際 key**(weave/finish/color/material…、plan §2.5 三家三形狀)配 label map 渲染、**無值該列不渲染**(bonamici {color,material} / gbracing null 不 crash、不吐空列)。

## 🔴 流程 / 審查(動共用元件)

- **動共用元件 → 跑完整 `pnpm test`**(不只單檔、抓 cross-effect);RPM 頁 byte 不變;補/更新 smoke test(`*.test.tsx`)。
- **manifest sync**(動 `apps/storefront/src/components/*`):`docs/design-storefront-manifest.yaml` 對應元件 `last_modified_commit` 要更(案 A 可達祖先、非 PENDING、`design-mirror --validate` gate)。
- 三綠 `/slice-checkpoint` + **code-reviewer subagent 必跑** + 精準 `git add` + STATUS 7 欄同 commit + **不 push**。
- **Sean 肉眼驗收**(RPM 頁無變化 + 非 RPM 段空白)= 驗收關卡;Claude 只能 curl/Playwright 程式驗、不可標「肉眼驗✅」。

## 檔案

- 改:`apps/storefront/src/**`(ProductPage / ProductServices / ProductHighlights / ProductSwatchWall / ProductTabs / ProductInfo / ProductSpotlight / lib products.ts `toUIProduct`)+ `data/rpm-policies.ts`(:46 保固「紋路」低優先)。
- 讀:plan §2.5(spec 形狀)/ §2.6(11 寫死點 + F1)/ §4 P0-C / §5 C1(前台 featured/目錄仍釘死「碳纖維部品」= Phase 1 才接真、P0-C **不動目錄接線**)/ §6-3(RPM 前台 byte 不變)。
- 不動:同步腳本(P0-A 已完)、schema、前台目錄/featured 接線(#205/#220c = Phase 1)。

## P0-D(之後、非本片)

gbracing/bonamici 實際乾跑報告交 Sean。**本 session 已跑過一次可參考**(唯讀零寫入):去碳全鏈正確(副標=分類名無碳纖維、brand 對照、中文描述、price_store null)、#261 未對上分類彙整(P0-B seed 後應全對上、可重跑驗)、spec 碰撞 PU_001(bonamici 3 群、C3 Phase 1 處置)。

## 地雷(Phase 1 試點寫入前、非 P0-C)

- **#260**:試點 description 混批 upsert 省欄列被寫 NULL(postgrest-js `?columns` 聯集 + defaultToNull;rpm 全批省欄不受影響)→ 試點 `--confirm-write` 前 must-fix。
- **#261**:試點 category null 進 upsert 撞 NOT NULL 硬 gate(P0-B seed 後 16 大類已 live、但空/未登記 major_category_zh 仍 null)→ 試點寫入前補 gate。
