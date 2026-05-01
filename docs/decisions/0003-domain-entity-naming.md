# 0003 — Domain Entity 與 Medusa Wire 對齊方向

> **狀態:** Accepted / 2026-05-01
> **拍板人:** Sean(C3 拍板選 A2:Domain 獨立命名)
> **影響範圍:** Phase 1 全 9 個 bounded contexts(尤其 Catalog / Identity / Order / Pricing 4 個跟 Medusa 有交集者)
> **本檔角色:** 重大決策記錄、不可改、後續若推翻必開新 decision 檔指向本檔
> **層級:** docs/decisions/、衝突仲裁僅次 STATUS.md / NORTHSTAR
>
> 配合閱讀:
> - `docs/decisions/0001-rewrite-decision.md`(整個重做拍板)
> - `docs/decisions/0002-architecture-pivot.md`(Medusa-as-API + 9 bounded contexts、本檔承接)
> - `docs/recon/design-reference-recon-2026-04-30.md` §7(9 個 design vs Medusa 衝突清單、本檔處置依據)
> - `docs/PHASE-1-NORTHSTAR.md` §2(視覺真權威、字面對齊鐵則)
> - `docs/PHASE-1-MILESTONES.md` M-0(本決策落地排程)

---

## 1. Context(背景)

### 1.1 為什麼現在拍 C3

0002 ADR 已拍「Medusa 是 adapter、不是 framework」、9 大 bounded contexts 各自獨立。但 0002 ADR 沒拍另一個更深的問題:**domain entity 的命名與資料形狀、要對齊 Medusa wire format、還是用 PCM 業務 ubiquitous language 自己命名?**

這個決策直接影響 M-0-04 ports 抽象介面定義。介面簽名一旦寫下、後續 use-cases 與 adapters 全部依賴介面字面。若先寫介面再決定命名、命名一改、ports 簽名要回頭翻。

### 1.2 衝突證據:design vs Medusa 9 條

`docs/recon/design-reference-recon-2026-04-30.md` §7 列出 design 字面與 Medusa wire format 的不對齊:

- design `product.brand` 是字串 `'CNC RACING'`、Medusa 期待 brand collection FK
- design `product.category` 是字串 `「引擎部品 · 排氣管」`、Medusa 期待 category 樹
- design `product.fits` 是自由字串 `'CBR600RR'`、Medusa 期待 metadata.vehicle_ids[]
- design 客戶持有車輛存 `localStorage('pcm-vehicles')`、Medusa 沒有對應 entity
- design 只一個 price、Medusa 有 Price List 多 tier
- 訂單狀態:design 沒有狀態 UI、Medusa payment_status / fulfillment_status 雙欄、PCM 真實業務是 8 狀態雙維度(brainstorming Q9-10 拍板)

這些不是「實作問題」、是「命名問題」:domain entity 用哪邊的字面?

### 1.3 候選方案

C3 拍板有 3 候選:

- **A1 對齊 Medusa wire**:domain 命名與 Medusa wire 同(snake_case + Medusa enum)
- **A2 獨立命名**:domain 用 PCM 業務語言(camelCase + 業務 enum)、adapter 邊界做雙向 mapping
- **A3 分 context 對齊**:Catalog / Order / Pricing 對 Medusa wire、Identity / Vehicle / Booking 等獨立

Sean 拍板 **A2(獨立命名)**。

---

## 2. Decision(決策)

### 2.1 拍板字面

採 **A2 — Domain 獨立命名**。

- domain entity 用 PCM 業務 ubiquitous language 命名(camelCase、業務語意 enum)
- Medusa adapter 在 packages/adapters/medusa/* 邊界做 wire ↔ domain 雙向 mapping
- ports 介面只出現 domain 命名、不允許 Medusa wire 字串 leak 進介面簽名
- storefront 直接搬 design 字面進 component;component 內部 mapper 把 design 字面 → domain entity(component 不直接吃 Medusa wire)

### 2.2 一句話心智模型

> domain 是 PCM 自己的家、Medusa 是租來的家具(只用 cart / payment / Price List 三件)、家具在玄關(adapter)就脫衣換鞋、進客廳一律穿 PCM 制服。

---

## 3. 命名規則(strict)

### 3.1 命名風格分區

| 區 | 風格 | 範例 |
|---|---|---|
| `packages/domain/*` | camelCase | `product.priceByTier`、`order.fulfillmentStatus` |
| `packages/ports/*` | camelCase(domain) | `IProductRepository.findByBrand(brand: Brand)` |
| `packages/use-cases/*` | camelCase(domain) | `placeOrder(input: PlaceOrderInput)` |
| `packages/adapters/medusa/*` | 邊界:wire snake_case → domain camelCase | `mapMedusaProduct(wire: MedusaProductWire): Product` |
| `apps/storefront/*` | camelCase(domain) + design CSS class 字面 | UI 直接吃 domain entity |
| `apps/admin/*` | camelCase(domain) | UI 直接吃 domain entity |
| `apps/sync-engine/*` | camelCase(domain) | sync 用 domain 不用 Medusa wire |

不混用、不在 use-cases 寫 `payment_status`、不在 domain 寫 `metadata.fits`。

### 3.2 enum 業務語意

domain enum 用 PCM 業務動詞 / 名詞、不直接套用 Medusa wire 字串。

範例(訂單付款狀態):

| domain enum | wire enum(Medusa) | 業務語意 |
|---|---|---|
| `paid` | `captured` | 客人錢已收 |
| `unpaid` | `awaiting` | 客人錢未收 |
| `refunded` | `refunded` | 已退款 |
| `partiallyPaid` | `partially_captured` | 部分收款(月結) |

範例(訂單出貨狀態 — Medusa 蓋不到、PCM 自家):

| domain enum | wire enum(Medusa) | 業務語意 |
|---|---|---|
| `notOrdered` | (Medusa 無) | 未跟廠商訂貨 |
| `ordered` | (Medusa 無) | 跟廠商訂貨中 |
| `inStock` | (Medusa 無) | 已現貨 |
| `shipped` | `shipped` | 已出貨給客人 |

### 3.3 ports 介面字面

ports 介面簽名只出現 domain 命名、不允許 Medusa wire 字串 leak:

- ✅ `IProductRepository.listByCategory(category: CategoryPath)`
- ❌ `IProductRepository.listByMetadataCategory(metadata_category: string)`
- ✅ `IOrderRepository.markPaid(orderId: OrderId)`
- ❌ `IOrderRepository.updatePaymentStatus(payment_status: 'captured')`

### 3.4 adapter 邊界:唯一可出現 wire 字面的位置

`packages/adapters/medusa/*` 是 Medusa wire 字串可出現的唯一位置:

- mapper 函數 `mapWireToDomain` / `mapDomainToWire`
- adapter class 內部 SDK 呼叫
- adapter 自身單元測試(mock Medusa response)

不允許 wire 字串 leak 出 adapter 邊界。ESLint 規則(M-0-03 已守門依賴方向、本決策追加字串 leak 檢查 — 列入 backlog #8 候選、Phase 1 本決策不馬上加 lint rule)。

### 3.5 不出現「metadata.fits」這種 Medusa wire 字面在 domain 與 ports

範例(fitment 處理):

```typescript
// ✅ 正確:domain
type FitmentSpec = {
  brand: Brand;
  modelCode: string;
  year?: number;
};

interface IProductRepository {
  findByFitment(spec: FitmentSpec): Promise<Product[]>;
}

// ✅ 正確:adapter 邊界
class MedusaProductAdapter implements IProductRepository {
  async findByFitment(spec: FitmentSpec): Promise<Product[]> {
    // 邊界:domain → wire
    const wireQuery = { metadata_filters: { fits: this.fitmentToString(spec) } };
    const wire = await this.sdk.products.list(wireQuery);
    // 邊界:wire → domain
    return wire.map(mapMedusaProductToDomain);
  }
}

// ❌ 錯誤:wire leak 進 ports
interface IProductRepositoryBad {
  findByMetadataFits(metadataFits: string): Promise<Product[]>;
}
```

---

## 4. 9 個衝突點處置表

對著 `docs/recon/design-reference-recon-2026-04-30.md` §7 字面填、不憑記憶。9 條按 design 字面複雜度排序、不按 §7 編號順序。

| # | recon §7 | design 字面 | Medusa wire | domain entity 命名 | adapter 處置 |
|---|---|---|---|---|---|
| 1 | §7.4 brand | 字串 `'CNC RACING'` | brand collection FK(brand_id) | `product.brand: Brand`(value-object: id + name + slug) | adapter 雙向 resolve FK ↔ name string;cache 名稱→ID |
| 2 | §7.5 category | 字串 `「引擎部品 · 排氣管」` | category 樹(parent_id 巢狀) | `product.category: CategoryPath`(value-object: 字串 path + 解析陣列) | adapter parse 字串 ↔ 樹節點;mapper 處理多語空格分隔 |
| 3 | §7.2 fits | 自由字串 `'CBR600RR'`、`string.includes` 比對 | metadata.vehicle_ids[](Medusa metadata 自由欄位) | `product.fitment: FitmentSpec[]`(value-object array) | adapter 雙向;mapper 將自由字串斷詞為品牌+車型;sync-engine 也用同 mapper |
| 4 | §7.6 stores | data/stores.json 36 筆靜態 | (Medusa 無 Store entity) | `Phase 1 ShopAdapter` 介面、StaticJsonShopAdapter 實作 | Phase 1 直讀 stores.json submodule;Phase 2 換 SupabaseShopAdapter |
| 5 | §7.3 vehicles | localStorage(`pcm-vehicles`)嵌 user、簡欄位 | (Medusa 無 Vehicle entity) | `customer.vehicles: VehicleSnapshot[]`(Phase 1 簡欄位、Phase 2 獨立 Vehicle entity) | Phase 1 用 customer metadata field;Phase 2 完整 SupabaseVehicleAdapter、保留同 ports 介面 |
| 6 | §7.8 三層價格 | design 只一個 `price` 欄位 | Medusa Price List(多 tier) | `product.priceByTier: Map<MemberTier, Money>` | adapter 取 customer.tier 對應 price;storefront server-side render 後傳 client |
| 7 | §7.7 TweaksPanel | design 字面有 TweaksPanel 元件 | (Medusa 無關) | (生產不上、Phase 1 storefront 跳過搬 — 對齊 HANDOFF-TWEAKS §1「生產不要保留」) | 無 adapter |
| 8 | §7.1 tier UI | design 無「會員等級」UI 標示 | customer_group(Medusa 內建) | `customer.tier: MemberTier`(enum: general / store / premiumStore) | adapter 雙向 customer_group ↔ MemberTier;storefront tier UI 是否顯示由業務決定、本 ADR 不管 UI |
| 9 | (新)order status | design 無狀態 UI | Medusa payment_status × fulfillment_status 雙欄 | `order.paymentStatus / order.fulfillmentStatus`(雙欄業務語意 enum、共 8 狀態) | adapter 雙向;Medusa fulfillment_status 不夠用、PCM 自家 4 階段 enum 寫進 domain;mapper 將 PCM enum 退化為 Medusa wire |

**共 9 條、全部用 A2 處置:domain 獨立命名、adapter 雙向 mapping。**

注:recon §7.9(VehicleFinder 篩選器 vs 客戶持有車輛 entity)是 §7.3 的子 case — 篩選器資料(motoBrands)屬 Catalog context、客戶持有車屬 Identity / Vehicle context、本 ADR 不另列、由 Catalog 與 Vehicle 兩 context 各自獨立 domain entity 自然分割。recon §7.10(HANDOFF docs 數量)是 meta-doc 議題、非技術衝突、不入本表。

---

## 5. Rationale(三視角)

### 5.1 擴充性

- 9 大藍圖中 5 個 context(Vehicle / Booking / Wallet / Shop / Sync)Medusa 蓋不到、A2 讓 5 個 context 各自獨立命名、不被 Medusa wire 綁死
- Phase 2 換 ERP 或 Medusa 退役、只動 adapters/、不動 domain / use-cases / ports
- 新 adapter(claude-api、image-processor、vendor-crawler)平等加入、不需 Medusa wire 對齊
- bounded context 邊界自然由 entity 命名表達(看 type 名就知道屬哪 context)

### 5.2 可維護性

- 看 packages/domain/* code 直接懂 PCM 業務、不看 Medusa 也能讀
- ubiquitous language 在 code、Sean 跟員工的口語跟程式同字面(例:「老闆要看月結未收」對應 `order.paymentStatus === 'partiallyPaid'`、不是 `payment_status === 'partially_captured'`)
- 升級 Medusa 主版本不衝擊 domain — adapter 重寫 mapping 即可
- ports 介面穩定、新進 dev 學介面不需學 Medusa SDK
- adapter 雙向 mapping 集中、改字串靠 grep 搜得到

### 5.3 bug 可追蹤性

- Medusa wire 異常困在 adapter 層、不 leak 到 use-case 與 storefront、bug 範圍可預測
- domain entity 出錯時、grep 業務語意找 use-case;adapter 出錯時、grep wire 字面找 mapper;兩層分明
- adapter 單元測試用 mock Medusa response、不需起 Medusa 服務跑單元測試、test 跑得快
- 三層分工:UI bug 找 storefront / admin、業務邏輯 bug 找 use-case、資料 bug 找 adapter — 故障定位不混淆

---

## 6. Consequences(後果)

### 6.1 正面

- domain framework-free、Phase 2 換 ERP / Medusa 退役只動 adapter
- in-memory adapter 測試友善、不需起 Medusa 跑單元測試
- 新進 dev 看 domain code 直接懂業務、不需先學 Medusa
- ubiquitous language 統一、Sean、員工、code 同字面
- 9 大 bounded context 邊界由命名自然表達、不需另寫 boundary doc

### 6.2 負面

- adapter 多寫 mapper、Phase 1 工作量初期 +20% (估 +1 ~ +1.5 工時 / context、4 contexts × 1.5 = +6 工時)
- mapper 字串 ↔ 業務值雙向轉換可能有 mapping bug、需單元測試覆蓋
- domain enum 與 Medusa wire enum 不同、新進 dev 易混淆 — 需在 adapter 邊界明確註解
- ESLint 規則檢查 wire 字串 leak 進 domain 是「未來才加」(本 ADR 不馬上加 lint、列 backlog 候選)、Phase 1 靠 review 防呆

### 6.3 中性

- adapter 內部 wire 字面與 Medusa SDK 升級綁死、SDK breaking change 時 adapter 改大、但這是 adapter 該擔的責任、不該外洩
- 命名遷移成本(若 Phase 1 中途想換):改 domain type 名 + grep 全 adapter mapper + 改 use-case 字面、估每名稱 30-60 min

---

## 7. Rollback 訊號

若 Phase 1 期間出現以下訊號、暫停當前 milestone、重新評估是否退回 A1 或 A3:

### 7.1 強訊號(任一觸發即重新評估)

- adapter mapper 寫到爆炸、單個 context 的 mapper 超過 500 行、且重複 case 多
- domain entity 設計頻繁回頭改(連續 3 個 slice 因 entity 命名修而回退)
- Medusa SDK 重大升級且 wire 結構大幅改變、adapter 全面重寫成本超過直接寫 in-house 邏輯

### 7.2 弱訊號(累計觀察)

- mapper 單元測試 mock 行數超過實際 production 行數
- 新進 dev 學 domain → wire mapping 學超過 1 天
- adapter 邊界字串 leak 進 use-case 出現超過 5 處(未被 review 攔截)

### 7.3 局部退回路徑

若觸發訊號、可考慮局部退回 A3(分 context 對齊):

- Catalog / Order 強對齊 Medusa wire(這 2 個 context Medusa 蓋面大)
- Identity / Pricing 維持 A2(這 2 個有業務複雜度、PCM 自家 enum 對得上)
- 其他 5 個 context(Vehicle / Booking / Wallet / Shop / Sync)維持 A2(Medusa 蓋不到)

退回成本估計:每 context 約 1-1.5 工時、影響面僅該 context 的 domain types + use-cases + adapter mapper。

---

## 8. 與其他文件交叉引用

| 檔案 | 角色 | 本檔關係 |
|---|---|---|
| `docs/decisions/0001-rewrite-decision.md` | 整個重做拍板 | 本檔承接、不推翻 |
| `docs/decisions/0002-architecture-pivot.md` | Medusa-as-API + 9 contexts | 本檔細化 0002 §4(命名規則層補強) |
| `docs/recon/design-reference-recon-2026-04-30.md` §7 | 9 條 design vs Medusa 衝突清單 | 本檔 §4 處置表依據 |
| `docs/PHASE-1-NORTHSTAR.md` §2 | 視覺真權威 | 本檔不衝突、storefront 仍直接搬 design 字面、mapper 在 component 內部 |
| `docs/architecture/medusa-schema-design.md` | M-0-05/06 待寫 | 本檔規範該檔 product / order schema mapping 用 A2 |
| `docs/architecture/bounded-contexts.md` | 待寫 | 本檔之命名規則由該檔展開 9 個 context 詳細邊界 |
| `docs/architecture/ports-and-adapters.md` | 待寫 | 本檔之介面字面要求由該檔展開所有 port / adapter 對應表 |
| `docs/PHASE-1-MILESTONES.md` M-0-04 | ports 抽象介面定義 slice | 本檔規範該 slice 介面字面只出現 domain 命名 |

---

## 9. 變更紀錄

| 日期 | 變更 | 變更者 |
|---|---|---|
| 2026-05-01 | 初始化 ADR-0003(C3 拍板 A2 Domain 獨立命名 + 9 衝突處置表 + 三視角 + Rollback 訊號) | Claude.ai + Sean / 由 Claude Code(M-0-07)落地 |

— END —
