# Bounded Contexts(minimum 版 / Phase 1 階段 1)

> **Status:** 🟢 落地 / 2026-05-03 / ADR-0004 Q6=A3 minimum 版
> **層級:** docs/architecture/、衝突仲裁在 ADR 之下
> **本檔角色:** ADR-0002 §7 列「bounded-contexts.md 待寫」之 minimum 版前置落地、9 contexts 一句話定義 + Medusa 蓋面對照
> **不寫:** ubiquitous language 完整字典(Phase 2 啟動前擴)、context 間 message contract(Phase 2 加 Booking / Wallet 補)
> **寫:** 9 contexts 一句話定義、Medusa 蓋面對照表、Phase 1 / Phase 2 範圍對應
>
> 配合閱讀:
> - `docs/decisions/0004-m1-pre-launch-decisions.md` Q6=A3(本檔落地依據)
> - `docs/decisions/0002-architecture-pivot.md` §4.3(9 contexts 範圍表、本檔擴)
> - `docs/decisions/0003-domain-entity-naming.md` §3.1(命名規則分區、本檔不重述、引用)
> - `docs/PHASE-2-VISION.md`(Phase 2 9 點藍圖)
> - `docs/architecture/medusa-schema-design.md`(具體 entity 對應)
> - `docs/phase-1-backlog.md` #46(本檔落地解)

---

## §1 9 Contexts 速查表

對齊 ADR-0002 §4.3 字面、本表逐 context 加一句話定義 + Medusa 蓋面狀況:

| Context | 一句話定義 | Medusa 蓋面 | Phase 1 範圍 | Phase 2 範圍 |
|---|---|---|---|---|
| **Catalog** | 商品 / 品牌 / 分類 / 車型(篩選用) | ✅ Medusa product / collection / category 蓋 | 商品 / 品牌 / 分類 / fitment metadata | (擴) |
| **Identity** | 會員 / 三級 tier / 經銷申請 / 個人資料 | 部分(Medusa customer / customer_group 蓋 tier、PCM 自家蓋經銷申請) | 三級 tier + 個人資料 | 多店員工 / 角色細分 |
| **Order** | 訂單 / 8 狀態 / 結帳 | 部分(Medusa cart / order / payment_status 蓋金流、PCM 自家蓋 fulfillment 4 階段) | 8 狀態 + 結帳 | 詢價單 / 退換 |
| **Pricing** | 雙 tier(retail / wholesale) | ✅ Medusa price_list 蓋 | 雙 tier | 三層折扣疊加(廠牌 / VIP) |
| **Vehicle** | 客戶持有車輛(Phase 2 entity) | (Medusa 無)、Phase 1 customer.metadata.vehicles | schema 預留 | 獨立 entity / 履歷 / 移轉 |
| **Booking** | 預約 | (Medusa 無) | schema 預留 | 預約 / 店家行事曆 |
| **Wallet** | 儲值金 | (Medusa 無) | schema 預留 | 儲值金 ledger |
| **Shop** | 店家 | (Medusa 無)、Phase 1 stores.json 靜態 | schema 預留(stores.json 靜態) | 店家 entity / 員工 entity |
| **Sync** | sync-engine + 資料來源 | (Medusa 無)、Phase 1 sync-engine 本機 | sync-engine + Sheets | AI 寫內文 / 廠商爬蟲 / 訂單分流 |

---

## §2 命名 / 擴張紀律

對齊 ADR-0003 §3.1 命名分區、本檔不重述、引用 ADR。

要點:

- domain entity 用 PCM 業務 ubiquitous language(camelCase)、Medusa adapter 邊界做 mapping(對齊 ADR-0003 §3.4)
- 跨 context 共用 type 住 `packages/domain/src/shared/`(例:`Money` / `MemberTier`)、避免 catalog ↔ identity 雙向依賴
- 9 contexts 各自獨立 `packages/domain/src/{catalog,identity,order,pricing,vehicle,booking,wallet,shop,sync}/`(Phase 1 視需求創、不必一次全建)

---

## §3 Phase 1 / Phase 2 邊界(對齊 PHASE-2-VISION §1)

本檔不重述 Phase 2 9 點藍圖、引用 PHASE-2-VISION。本檔焦點:**Phase 1 schema 預留 vs 不預留**。

### 3.1 預留(schema 留位、Phase 1 不啟用業務邏輯)

- Vehicle:`customer.metadata.vehicles[]`(簡欄位、Phase 2 升獨立 entity)
- Booking / Wallet / Shop entity:**不**在 Phase 1 schema 預留、Phase 2 啟動時加(Sean 04-29 拍板「不為 Phase 2 大量上架預設」、其他關鍵預留見 PHASE-2-VISION §3)

### 3.2 不預留(Phase 2 啟動時新加)

- Booking / Wallet / Shop entity 本體
- 三層折扣疊加(廠牌 / VIP)— Order.discountsApplied(backlog #47 預留候選)

---

## §4 待 Phase 2 啟動前擴

本 minimum 版不寫的、留 Phase 2 啟動前補:

- **Ubiquitous language 完整字典:** Catalog 字典 / Identity 字典 / Order 字典 ...(每個 context 列術語 + 中英對照 + 業務含義)
- **Context 間 message contract:** Order 觸發 Wallet 加儲值、Booking 觸發 Vehicle 寫保養紀錄、SyncEngine 觸發 Catalog 加候選等
- **Anti-corruption layer 規範:** Phase 2 加 vendor crawler、wire 字面如何在 adapter 邊界轉 PCM 業務語意

---

## §5 變更紀錄

| 日期 | 變更 | 變更者 |
|---|---|---|
| 2026-05-03 | 初始化 minimum 版(9 contexts 一句話定義 + Medusa 蓋面對照表 + Phase 1/2 範圍邊界) | ADR-0004 Q6=A3 落地、由 Claude Code(M-0-10a)寫 |

— END —
