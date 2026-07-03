# Phase 0 P0-A-3 kickoff handoff(transform/import 去碳 + config 全量驅動)

> 給接手 **P0-A-3** 的新 session。真權威 = `docs/specs/2026-07-03-phase0-multibrand-foundation-plan.md`(本檔只補「進度到哪 + 我怎麼拆片 + 開工第一件事 + 最高約束」,**不重述 plan**)。
> 上一輪 session:2026-07-03,完成 P0-A-1/A-2 + Fable 跨模型對抗審 F1-F4 收尾。

## 進度快照

- Phase 0 plan 已批(Q1=A 嚴格 N°02 到位才可見 / Q2=A RPM 分類不動 / Q3=A 只 16 大類 / Q4=B RPM 描述切繁中=Phase 1 一次性 re-sync)。
- P0-A 我拆成 4 子片(此拆法是我的決定、不在 plan 內):
  - **P0-A-1 ✅ `4612fb4`** — `scripts/supplier-config.ts` = 每家一組參數 SSoT `{supplierSlug, brandSlug, handlePrefix, syncDescription, categoryStrategy(fixed|per-group)}` + `getSupplierConfig`(fail-closed `Object.hasOwn`)。已登記 rpm / gbracing / bonamici;其餘 8-9 家 Phase 3 放量再登。vitest include 擴 `{packages,apps,scripts}`、lint glob 加引號 → scripts 測試進 CI。
  - **P0-A-2 ✅ `b5993e3`** — 4 支 helper(rpm-fetch / rpm-delta / rpm-reconcile / rpm-preflight)寫死的 `SUPPLIER='rpm'` + `.eq('supplier_slug','rpm')` 外提為呼叫端傳入的 `supplierSlug`;orchestrator `rpm-import.ts` 仍固定 `SUPPLIER_SLUG='rpm'`、brand/category 常數未動 → **rpm 路徑 byte 等價**。`scripts/rpm-pipeline-scope.test.ts` 鎖 scope 隔離(fetch / active-read / delist-write / computeDelta / preflightSpecUnique)。
  - **nit 收尾 ✅ `03416b5`** — Fable 5 跨模型對抗審 F1-F4 全修 CLOSED(getSupplierConfig 原型鏈氣密 / delta·preflight scope 補測 / 註解去殘留 'rpm' / anchor 去行號 / log 硬字面→變數)。
  - **P0-A-3 = 本片(下述)**;**P0-A-4 = 之後一片**。
- 全程零 DB 寫入、`TAPPAY_3DS_ENABLED` / `ANOMALY_ALERT_ENABLED` / `CRON_SWEEPER_ENABLED` 全 false。
- 起手 `git status`:Sean push 後應 clean + up-to-date;HEAD = 本 handoff docs commit(對齊 STATUS「最近 3 commit」)。

## 🔴 開工第一件事(硬 gate、不可跳)

**唯讀 MCP 先查證來源 view 欄名,再動 `VIEW_COLS`**(字面值三來源律,別憑 plan 字面直接寫進 SELECT、plan §4 的欄名只是規劃名):
- 庫 = **報價單 B 庫 `dllwkkfanaebrsuyuedy`**(不是商城庫 `bmpnplmnldofgaohnaok`);view = `storefront_catalog_v`。
- 要確認的三欄:`description` / `category_zh` / `major_category_zh` 的**實際欄名與型別**。
- 查不到某欄 → 標「未確認」回報 Sean、不硬塞;`major_category_zh` 是 per-group 分類的來源(plan §2.7 已列 16 大類與群數,但欄名仍要親查)。

## P0-A-3 範圍(純函式 / 乾跑、零 DB 寫入)

1. **`rpm-import.ts` 加 `--supplier` CLI arg**(default `'rpm'`)→ `getSupplierConfig(supplier)` 驅動;移除寫死的 `SUPPLIER_SLUG` / `BRAND_SLUG` / `CATEGORY_RAW_PATH`,改由 config 供給。
2. **`VIEW_COLS` + `SourceProductRow`(rpm-fetch.ts)補三欄**(MCP 查證欄名後):description / category_zh / major_category_zh。
3. **`rpm-transform.ts` 去碳**,逐點對 plan **§2.1 的寫死點 #3/#4/#5/#6/#13** + §2.9:
   - **brand**:由 `config.brandSlug` 經 `resolveId`(rpm→rpm-carbon)。
   - **category**:依 `config.categoryStrategy` — `fixed`(rpm→碳纖維部品,resolveId 一次)vs `per-group`(試點→逐群依 `major_category_zh` 對 16 大類 resolve;`transformGroup` 已收 `categoryId` 參數、caller 逐群解析)。
   - **handle**:`` `${config.handlePrefix}-${mainSku.toLowerCase()}` ``(rpm→`rpm-` 前綴)。
   - **subtitle**:由 category 衍生、不寫死「碳纖維」(§2.1 #3)。🔴 但 rpm(fixed 碳纖維部品)**必須仍吐「{vehicle} · 碳纖維」/「碳纖維」**——設計衍生規則時 rpm byte 等價是最高約束。
   - **description**:依 `config.syncDescription`(rpm=false 省欄不寫;試點=true 寫 `view.description`,來源 null→省欄、不寫 null,§2.9 F2)。
   - **variantSortKey**:通用 fallback(bonamici spec 無 weave/finish → 退化 sku-only、不 crash;plan §2.5 spec 三家三形狀)。
4. **測試**:transform 去碳加 unit 測 + **rpm byte 等價回歸鎖**(見下)。

## 🔴 最高約束(每步對照)

> 🔴 **2026-07-03 執行時 Sean 拍 A supersede(副標)**:本節原寫「subtitle 含『碳纖維』逐字相同」。執行 session 就「rpm 副標『碳纖維』要不要跟分類名走」揭露線上 ~1,117 頁可見改動後問 Sean,Sean 拍 A =「就讓它變『碳纖維部品』」。故 P0-A-3 實際的 RPM 零回歸 = **除副標外逐字相同、副標由「碳纖維」→「碳纖維部品」**(plan §6-3 / §4 / §2.1#3 已同步 supersede)。下述「subtitle 含碳纖維」為原始 kickoff 字面、已被此拍板取代。

- **RPM 零回歸(不變式 3,plan §6-3)**:`--supplier=rpm` 的 transform 輸出必須與現況**逐字相同**(brand `rpm-carbon` / handle `rpm-{sku}` / subtitle 含「碳纖維」〔↑已 supersede 為「碳纖維部品」〕/ **無 description 欄** / category 碳纖維部品)。**建議動 transform 前先建一支「rpm 樣本 transform 輸出快照」回歸測**,改完比對零 diff。
- **不變式 1(軟下架隔離)**:P0-A-2 已鎖(`rpm-pipeline-scope.test.ts`),P0-A-3 別破壞。
- 經銷價零外洩:全走 public view、`price_store` 恆 null;金額整數(禁 float,已 `roundTwd`)。

## P0-A-4(之後、非本片、供定序)

F3 bypass 護欄(禁同帶 `--allow-fetch-shrink` + `--allow-large-delist`)+ F4 handle preflight(charset 白名單 + 全域唯一)+ spec 碰撞偵測(bonamici 3 群、dry-run 列報告不 throw、plan §2.10 C3)+ 負測(錯配 supplier scope → 報告 ~100% missing)+ gbracing/bonamici 實際 dry-run 報告交 Sean(plan §4 P0-D 亦在此線)。

## 流程 / 審查

- PCM SOP:三綠 `/slice-checkpoint`(scripts 動 → typecheck 走 `tsconfig.scripts.json`、lint 走 `eslint 'scripts/*.ts'`)+ **code-reviewer subagent 必跑** + 精準 `git add` + STATUS 7 欄同 commit + **不 push**。
- 跨模型:P0-A-3 動 RPM byte 等價 transform(delicate),**收尾建議補一次 Fable 5 adversarial(`model:fable` 真跨模型)**;codex 正牌背書留 **Phase 1 真寫入片**(火力留刀口)。
- forward nit:A-2 已全清,A-3 無殘留阻礙項。

## 檔案

- 改:`scripts/rpm-import.ts`、`scripts/rpm-transform.ts`、`scripts/rpm-fetch.ts`;測:`scripts/*.test.ts`。
- 讀:`scripts/supplier-config.ts`(消費 config)、plan **§2.1 / §2.5 / §2.7 / §2.9 / §4 / §6**。
- 不動:前台元件(去碳的前台部分 = P0-C、plan §2.6)、schema、每日排程 `rpm-sync.yml`。
