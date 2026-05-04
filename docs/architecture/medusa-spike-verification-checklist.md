# Medusa-as-API Spike Verification Checklist

> ⚠️ **Status: SUPERSEDED**
> 廢於:2026-05-04 / M-1-03-pre0b / ADR-0005「Custom + Supabase 直寫架構」採用
> 取代於:`docs/decisions/0005-custom-supabase-direct.md`
> Medusa-as-API spike 不再進行(本 ADR-0005 主動採用 ADR-0002 §6.3 rollback 路徑、非 spike 失敗被動 rollback)
> 字面內容**保留**作歷史紀錄(decision tree 設計錯 vs 裝錯邏輯仍可參考、適用於未來其他 framework spike)
> 不刪除、不改本檔字面、只加本標記
>
> ---
>
> **Status(原):** 🟢 拍板 / 2026-05-04 / backlog #66 落地
> **拍板人(原):** Sean(2026-05-04 4 題拍板:Q1=A1 / Q2=A2 / Q3=A1 / Q4=A2)
> **層級:** docs/architecture/、衝突仲裁僅次 STATUS.md / NORTHSTAR / 0002-0004 ADR
> **本檔角色:** M-1-03 啟動前驗證 ADR-0002 Medusa-as-API 假設、避免 schema mapping 套不上整體翻盤
>
> 配合閱讀:
> - `docs/decisions/0002-architecture-pivot.md` §6.1 強訊號 #1 + §6.3 rollback 路徑(本檔 §4 重述)
> - `docs/architecture/medusa-schema-design.md` Part 1 §2-§5(本檔 §1 驗證範圍)
> - `docs/decisions/0003-domain-entity-naming.md` §4 9 衝突處置(本檔 §2 round-trip 還原項)
> - `docs/decisions/0004-m1-pre-launch-decisions.md` Q2 / Q3(本檔 §1 排除項依據)
> - `docs/phase-1-backlog.md` #66(本檔落地解)

---

## §1 驗證範圍(Q1=A1 拍板)

本 spike 驗 **Catalog 4 條核心 mapping**、對應 medusa-schema-design Part 1:

| 驗證項 | medusa-schema-design § | ADR-0003 §4 # | mapping 規則來源 | 備註 |
|---|---|---|---|---|
| Product | §2 / §2.3 | (整體) | `mapMedusaProductToDomain` / `mapDomainProductToWire` | 7 欄位含 fitments / priceByTier;variants 推延非本 spike 範圍(對齊 backlog #81) |
| Brand | §3 / §3.3 | #1 | adapter 雙向 resolve `product_collection` FK ↔ Brand value-object | collection.title ↔ Brand.name 字面對齊 |
| Category | §4 / §4.3 | #2 | adapter parse `product_category` 樹 ↔ CategoryPath 字串 + segments | 「·」與全形空格分隔解析 |
| Tier Price | §5 / §5.3 | #6 + #8 | Price List × customer_group ↔ priceByTier(general / store / premiumStore) | 必滿足 §6.2 priceByTier 不洩漏鐵則(server-side render 解 + client 看不到全 record) |

### 1.1 不在本 spike 範圍

對應 ADR-0004 拍板字面 + 既有推延條目:

- **Order 雙維度狀態機:** M-3-02 spike(8 狀態 × payment / fulfillment)、不在 Catalog 範圍
- **Vehicle / Booking / Wallet:** Phase 2、Medusa 蓋 0%、本來就不走 Medusa(對齊 ADR-0002 §4.3)
- **Search engine:** ADR-0004 Q3=A1 拍板兩階段(M-1-03 dev 期 PG ILIKE / M-6 切 tsvector + pg_jieba)、search 機制不在 spike 驗、性能字面已知
- **Image storage:** ADR-0004 Q2=A2 拍板 Supabase Storage(跟 Q1 同生態、上線時同步升 Pro)、上傳機制 M-1-13 / M-1-16 啟動、不在 spike 驗
- **variants schema:** backlog #81 trigger M-1-13、本 spike 不覆蓋

---

## §2 過 / 不過判斷標準(Q2=A2 拍板)

每條 mapping 必須通過**真實 round-trip**、不接受純 docs 字面驗證。

### 2.1 通用流程(5 步)

1. **建:** 在 Medusa Admin 手動建一筆 fake entity(對應 mapping 字面、最小欄位集)
2. **查:** 用 Medusa SDK 對應 method 查回來(adapter 呼叫順序按 IProductRepository / 等 ports 簽名)
3. **map:** 對應 mapper(`mapMedusaXxxToDomain`)將 wire 還原 domain entity
4. **比對:** domain entity 欄位 vs 建的字面對得上(所有 7 條核心欄位、不容字面差;包含 nested objects:Brand id/name/slug、CategoryPath raw/segments、PriceByTier 三 tier amount)
5. **clean up:** 刪除 fake entity(避免污染 dev DB)

### 2.2 通過條件

- **4 條 mapping 全部 round-trip 過 = ✅** ADR-0002 §6.1 強訊號 #1 不觸發、M-1-03 主實作啟動
- **任一條 round-trip 失敗 = 進 §3 decision tree** 判斷「設計錯」vs「裝錯」

### 2.3 不在 spike 驗的項目(已知 / 接受)

- **性能:** 對齊 ADR-0004 Q3=A1 拍板 dev 期 PG ILIKE p99 1-3s @ 200 SKU、M-6 切 tsvector p99 < 100ms @ 5w SKU;200 SKU 規模性能字面已知、不在本 spike 驗
- **邊界 case:** 空商品 / 多語 / 特殊字元 / unicode、本 spike 只驗 happy path、邊界 case 進 M-1-03 主實作 test(對齊 backlog #86 thematic1 edge cases 補)
- **security-timeline §3 #C4 priceByTier 不洩漏:** M-2-08 / M-2-09 / M-6-08 三點接力驗、不在本 spike(對齊 medusa-schema-design §6.2 接力字面)
- **idempotency / 樂觀鎖 / audit trail:** M-1-03 真實 adapter 落地時補(對齊 backlog #86 contract test 條 + ADR-0003 §3.3 ports JSDoc 規則)

---

## §3 Decision Tree:設計錯 vs 裝錯(Q3=A1 拍板)

round-trip 失敗時、依下列 decision tree 自判:

### 3.1 「設計錯」訊號(觸發 §4 rollback)

對齊 ADR-0002 §6.1 強訊號 #1:「M-1 spike 出現 Medusa schema 完全無法對應 PCM 業務的 case(連 metadata 都套不上)」。

| 訊號 | 解讀 | 對齊 ADR-0003 §4 # |
|---|---|---|
| `product_collection` 機制本身缺位或限制過嚴(例:無法跨 collection 多對多 brand) | 設計錯 — Medusa schema 連 metadata 都套不上 | #1 |
| `product_category` 樹深度限制 < ADR-0003 §4 #2 字面要求 / 不支援多語 path | 設計錯 — Medusa 結構性不夠 | #2 |
| Price List × customer_group 機制無法蓋三 tier(general / store / premiumStore)關聯 | 設計錯 — Medusa pricing 機制不適用 PCM 業務 | #6 + #8 |
| `product.metadata` 不接受 jsonb 自由字串(fitment 落不下 / 全形字元 reject / 大小限制) | 設計錯 — metadata 機制破產 | #3(fitments) |

### 3.2 「裝錯」訊號(本 spike 內修、不觸發 rollback)

| 訊號 | 解讀 | 處置 |
|---|---|---|
| Medusa SDK 字面用錯(method name typo / 參數順序錯 / 過時 API) | 裝錯 — 改 adapter code | 改 packages/adapters/medusa/* mapper / SDK call |
| Medusa Admin 設定漏(price_list 沒建 / customer_group 沒掛 / category 父子關係沒設) | 裝錯 — 補 Admin 設定 | Sean 在 Medusa Admin 補設定、Code 不操作 Admin |
| mapper 函數寫錯(snake_case → camelCase 漏 case / 邊界欄位漏 map) | 裝錯 — 改 mapper | 改 packages/adapters/medusa/* mapper、補 unit test |
| 環境變數漏(`MEDUSA_BACKEND_URL` / `MEDUSA_API_KEY` / Supabase connection string) | 裝錯 — 補 env | Sean 在 .env / Vercel / Railway dashboard 補、Code 不寫 secret |

### 3.3 模糊地帶處置

若 round-trip 失敗、無法明確判斷「設計錯」vs「裝錯」(例如:Medusa SDK 行為不符文件、無法確認是 SDK bug 還是 schema 設計限制):

- **預設視為「設計錯」**、停下回報 Sean 拍板
- **不在模糊狀態下繼續 spike**、避免誤判
- Sean 跟 Claude.ai 用 multi-select 拍板「再試 / 升高為 §3.1 設計錯 / 視為 §3.2 裝錯」

---

## §4 Rollback 路徑(Q4=A2 拍板、重述 ADR-0002 §6.3 自包含)

若 §3.1 觸發、進 ADR-0002 §6.1 強訊號 #1 重新評估、§6.3 rollback 路徑落地:

### 4.1 程式碼處置(對齊 ADR-0002 §6.3 字面 5 條)

| package / 結構 | 處置 | 估時 |
|---|---|---|
| `packages/domain` | **保留**(domain 邏輯本身正確、與架構無關;type stub 不需動) | 0 |
| `packages/adapters` | 改回**直接 Medusa SDK 呼叫**(廢 ports 抽象層) | 1-2 day |
| `packages/use-cases` | **降級**為純 helper functions(不再走 ports 介面注入) | 0.5 day |
| monorepo 結構 | **回到 ADR-0001 §3.5 原版**(廢 packages/ports + packages/use-cases、只剩 ui + schemas + domain + adapters) | 0.5 day |
| `apps/admin` | **是否保留**視 ADR-0001 §4 是否再次推翻(ADR-0002 §3 推翻過、若 rollback 需重新拍板) | TBD |

**預期回退成本:約 1 週**(ADR-0002 §6.3 字面)、樂觀估、實際可能 1-1.5 週。

### 4.2 文件處置

- ADR-0002 §6.3 加新行紀錄 spike 結果 + rollback 觸發時機
- 寫新 ADR-0005「Medusa-as-API rollback 紀錄」、紀錄失敗 mapping + 重新規劃方向(全 Supabase 自寫 / 部分 Medusa / 其他選項)
- 影響 milestone:M-1-03 / M-1-14 / M-3-04 / M-4a-XX 全 adapter slice 暫停、重新規劃
- 通知文件:STATUS.md「下一步」段加 BLOCKED 狀態、列 rollback 進度

### 4.3 Sean 通知時機

- §3.1 訊號觸發時、Code **立即停下回報 Sean、不自行繼續 spike**
- Claude.ai 跟 Sean 用 multi-select 拍板「rollback vs 重試 vs 部分 rollback(只廢部分 mapping)」、決定後寫進 ADR-0005
- 不在 spike 失敗第一時間就 rollback、給「裝錯」訊號至少一輪修補機會(對齊 §3.2)

---

## §5 變更紀錄

| 日期 | 變更 | 變更者 |
|---|---|---|
| 2026-05-04 | 初始化 checklist(Sean 拍板 Q1=A1 / Q2=A2 / Q3=A1 / Q4=A2;§1 範圍 Catalog 4 條 / §2 round-trip 5 步 / §3 decision tree 設計錯 vs 裝錯 / §4 rollback 路徑重述自包含 / §5 變更紀錄) | backlog #66 落地、由 Claude Code(M-1-03-prep)寫 |

— END —
