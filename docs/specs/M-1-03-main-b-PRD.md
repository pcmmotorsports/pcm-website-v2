# M-1-03 main-b PRD: SupabaseProductAdapter

> **Status:** 🟢 拍板 / 2026-05-07 / Sean 拍 Q1=A 5 sub-slice / Q2=A D1+D2 main-b 內順手 / Q3=A D3 推遲 #105
> **拍板人:** Sean
> **層級:** docs/specs/、衝突仲裁次於 STATUS.md / NORTHSTAR / 0001-0005 ADR / supabase-schema-design.md
> **本檔角色:** M-1-03 main-b SupabaseProductAdapter 完整實作規格、5 sub-slice 拆法、字面 vs 事實揭示預留

**配合閱讀:**

- `packages/ports/src/IProductRepository.ts`(IProductRepository 6 method 簽名 + JSDoc)
- `docs/decisions/0003-domain-entity-naming.md` §3.3 / §3.4 / §3.5(adapter 邊界規則)
- `docs/decisions/0005-custom-supabase-direct.md` §2 / §8.1(M-1-03 milestone 字面變更)
- `docs/architecture/supabase-schema-design.md` §2-§5 / §6 / §9(Supabase schema 真權威 + RLS)
- `packages/adapters/src/supabase/README.md`(結構樹 + migration 工作流 + env)
- `packages/adapters/src/in-memory/InMemoryProductRepository.ts`(慣例參考)
- `packages/domain/src/catalog/types.ts` + `shared/types.ts`(domain types)
- `docs/specs/M-1-03-products-schema-prd-v3.md`(a2-2 v3 / Slice A1 / A2 落地產物)
- `docs/phase-1-backlog.md` #20 / #51 / #76 / #86 / #92 / #93 / #94 / #100 / #105

---

## §1 範圍與目標

### 1.1 包含

- SupabaseProductAdapter class(`packages/adapters/src/supabase/SupabaseProductAdapter.ts`)
- mappers(mapSupabaseProductToDomain / mapDomainProductToSupabase)
- helpers(parseCategoryPath / fitmentToWireString / parseWireFitment / resolveEnd / matchFitmentYear)
- 6 method 完整實作對齊 IProductRepository contract(對齊 supabase-schema-design.md §2.3)
- JSDoc TODO 對齊 ADR-0003 §3.3(adapter-specific TODO 寫 class、不寫 ports)
- main-b 落地過程順手修 Drift D1(IProductRepository.ts:14 Medusa 字面)+ Drift D2(packages/adapters/src/index.ts:1 註解去 Medusa)
- 吸收 backlog #92 trigger(resolveEnd helper 抽至 packages/domain/src/catalog/year-range.ts、main-b sub-slice 3 落地、+30 min)

### 1.2 不包含

- M-1-03-main-c spike round-trip 驗(獨立 milestone、main-b 完工後)
- M-1-03-main-d storefront 連通(獨立 milestone)
- M-6 tsvector + GIN + pg_jieba 切換(對齊 supabase-schema-design.md §2.5、本 milestone dev 期用 ILIKE)
- backlog #93 matchFitment 8 boundary tests(獨立 slice 60-90 min、main-b 後)
- Drift D3(ADR-0003 §3.3-§3.5+§4 字面 Medusa→Supabase)推遲、併 backlog #105 後續 docs slice
- variants(backlog #81 Phase 2 PRD 一起想)
- audit trail / 樂觀鎖具體實作(JSDoc TODO 預留、M-1-13 / M-3-04 落地)

### 1.3 估時

5 sub-slice、各 ~45 min、合計 ~3.5-4 hr。對齊 ADR-0005 §8.1「6-8 hr 跨多 slice」上限。

---

## §2 路徑 + 命名 + 結構

### 2.1 結構(對齊 packages/adapters/src/supabase/README.md 字面)

```
packages/adapters/src/supabase/
├── SupabaseProductAdapter.ts   ← main-b sub-slice 1 起骨架
├── client.ts                    ← Supabase client init(DI 注入)
├── mappers/
│   └── product.ts               ← mapSupabaseProductToDomain + mapDomainProductToSupabase
├── helpers/
│   ├── category-path.ts         ← parseCategoryPath
│   └── fitment.ts               ← fitmentToWireString + parseWireFitment + matchFitmentYear
└── README.md                    ← 已存在(2026-05-07 落地、不動)

packages/domain/src/catalog/
└── year-range.ts                ← resolveEnd helper(吸收 backlog #92、跨 adapter 共用)
```

### 2.2 命名

| Item | 字面 | 字面源 |
|---|---|---|
| Class | SupabaseProductAdapter | ADR-0005 §8.1 + supabase/README.md |
| Mappers | mapSupabaseProductToDomain / mapDomainProductToSupabase | supabase-schema-design.md §2.3 |
| Helpers | parseCategoryPath / fitmentToWireString / parseWireFitment / resolveEnd / matchFitmentYear | supabase-schema-design.md §2.4 / §4.3 + InMemoryProductRepository.matchFitment + backlog #92 |

不命名為 SupabaseProductRepository(對齊 ADR-0005 §8.1 字面「SupabaseProductAdapter」)。

---

## §3 6 method 規格(對齊 supabase-schema-design.md §2.3 + IProductRepository contract)

### 3.1 findById(id: ProductId): Promise<Product | null>

- SQL pattern: `.from('products').select('*, brands(*), categories(*)').eq('id', id).single()` + map
- Error: PGRST116(`.single()` 找不到 row)→ return null;其他 throw

### 3.2 listByCategory(category: CategoryPath): Promise<Product[]>

- Adapter resolve: raw_path UNIQUE 查 categories 表取 id(內部 helper resolveCategoryId)
- 找不到 categoryId → return [](不 throw)
- SQL: `.eq('category_id', categoryId)` + map

### 3.3 listByBrand(brandId: string): Promise<Product[]>

- SQL: `.eq('brand_id', brandId)` + map

### 3.4 listByFitment(spec: FitmentSpec): Promise<Product[]>

- Server-side filter: `.contains('fitments', [{motoBrand, modelCode}])`(jsonb @> operator)
- Client-side filter(年份範圍):matchFitmentYear helper(對齊 InMemoryProductRepository.matchFitment 規則 3 + resolveEnd helper)
- Phase 1 階段 1 不建 GIN index(對齊 supabase-schema-design.md §10.2 backlog #30 階段 2 trigger)

### 3.5 searchByKeyword(query: string, params: PaginationParams): Promise<Paginated<Product>>

- Phase 1 dev: ILIKE on title / subtitle / description(對齊 ports/IProductRepository.ts contract JSDoc + supabase-schema-design.md §2.5 dev 階段)
- Empty query: `query.trim() === ''` → return `{ items: [], total: 0 }`(對齊 IProductRepository contract)
- Pattern: `.or('title.ilike.%q%,subtitle.ilike.%q%,description.ilike.%q%').range(offset, offset+limit-1)` + `count: 'exact'`
- M-6 tsvector 切換:JSDoc TODO 預留、本 main-b 不實作

### 3.6 save(product: Product): Promise<Product>

- Adapter resolve: brand / category 名稱→ID 快取(內部 LRU cache、避免重複 round-trip)
- Pattern: `.upsert(row).select('*, brands(*), categories(*)').single()` + map
- 樂觀鎖(updated_at 比對):JSDoc TODO 預留(對齊 §8 + #86)、本 main-b 不實作

---

## §4 Mapper 規格(對齊 ADR-0003 §3.4 + supabase-schema-design.md §2.2)

### 4.1 mapSupabaseProductToDomain(row): Product

- 路徑:`packages/adapters/src/supabase/mappers/product.ts`
- Input: SupabaseProductRow(含 brands JOIN / categories JOIN 物件)
- Output: Product(對齊 packages/domain/src/catalog/types.ts:Product 13 主欄+2 timestamp)
- 還原規則:
  - title → name(wire title、domain name、對齊 supabase-schema-design.md §2.2)
  - brands JOIN → Brand value-object(id + name + slug)
  - categories JOIN → CategoryPath value-object(raw_path → raw、segments 直送)
  - subtitle / description nullable → empty string fall-back
  - created_at / updated_at ISO string → Date object
- Error: brands / categories JOIN 為 null → throw(資料完整性違反、不 silent ignore)

### 4.2 mapDomainProductToSupabase(domain, brandId, categoryId): SupabaseProductRow(寫部分)

- 路徑:同上
- Input: Product domain + 已 resolve 的 brandId / categoryId
- Output: `Omit<SupabaseProductRow, 'brands' | 'categories'>`(寫不需要 JOIN object;upsert 後 SELECT 重 JOIN 還原)
- 對應規則:name → title、subtitle empty string → null、Date → ISO string

---

## §5 Helpers 規格

### 5.1 parseCategoryPath(raw): { name, segments }

- 路徑:`packages/adapters/src/supabase/helpers/category-path.ts`
- Spec: 處理「·」與全形空格分隔(對齊 supabase-schema-design.md §4.3 + design 字面「引擎部品 · 排氣管」)
- Phase 1: name + segments;parent_id_chain 解析在 main-b sub-slice 2 內部 helper resolveCategoryIdChain 實作(query categories 表)

### 5.2 fitmentToWireString(spec): string

- 路徑:`packages/adapters/src/supabase/helpers/fitment.ts`
- Spec: domain → wire string(對齊 supabase-schema-design.md §2.4 範例「Yamaha CBR600RR 2018-2024」)
- yearStart undefined → 省略年份;yearEnd null → YYYY+;yearEnd undefined 或 === yearStart → YYYY;else → YYYY-YYYY

### 5.3 parseWireFitment(str): FitmentSpec

- 路徑:同上
- Spec: wire string → domain(M-5 sync-engine 廠商輸入解析時擴展)
- Phase 1 簡版:正則 `/(\d{4})(?:-(\d{4})|(\+))?/` 取年份、剩前 2 段為 motoBrand + modelCode

### 5.4 resolveEnd(yearStart, yearEnd?: number | null): number(吸收 backlog #92)

- 路徑:`packages/domain/src/catalog/year-range.ts`(跨 adapter 共用、避免雙寫)
- Spec: yearEnd null → Infinity(開放式範圍);yearEnd undefined → yearStart(單年);else → yearEnd
- main-b sub-slice 3 落地時 InMemoryProductRepository.matchFitment 同步重構為 import resolveEnd(對齊 #92 預期解法、InMemory + Supabase 兩端同步)

### 5.5 matchFitmentYear(actual, spec): boolean

- 路徑:`packages/adapters/src/supabase/helpers/fitment.ts`
- Spec: 規則 3 年份範圍重疊判定(對齊 InMemoryProductRepository.matchFitment 重構後版本、用 resolveEnd helper)
- 注:motoBrand / modelCode 比對(規則 1+2)在 listByFitment SQL `.contains` 階段已 server-side filter

---

## §6 Security Checks(priceByTier 不洩漏鐵則)

對齊 supabase-schema-design.md §6.1 / §6.2 + security-timeline §3 #C4。

### 6.1 三層責任

| 層 | 責任 |
|---|---|
| adapter(本 main-b) | mapSupabaseProductToDomain return Product 含完整 priceByTier(domain entity 完整、含 3 tier) |
| use-case | 取 customer.tier、從 product.priceByTier[tier] 解單一 Money、傳 storefront(不傳整 jsonb) |
| storefront server-side render | server-side 解、傳 client 單一 price 字面;client bundle 永遠看不到 store / premiumStore 經銷價 |

### 6.2 main-b 必驗

- adapter 跑在 apps/api/ server runtime、storefront 不直接 import adapter(對齊 §7.3 service_role 紀律)
- M-1-03-main-c spike round-trip 驗:client wire response 不含 priceByTier 全 jsonb(對齊 supabase-schema-design.md §6.2)

---

## §7 env / DI / Supabase client init

對齊 packages/adapters/src/supabase/README.md env 字面 + supabase-schema-design.md §9.3。

### 7.1 env vars(三條)

| Var | 用途 | 進 client bundle? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | ✅ public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key、RLS-protected | ✅ public |
| `SUPABASE_SERVICE_ROLE_KEY` | service role key、繞 RLS、寫操作用 | ❌ server-only、絕不入 client / git |

### 7.2 DI pattern

- `packages/adapters/src/supabase/client.ts` export createSupabaseAnonClient / createSupabaseServiceClient 兩 factory
- SupabaseProductAdapter constructor 接受 SupabaseClient instance 注入(避免 singleton 散、利於 test 替換)

### 7.3 service_role 紀律(對齊 supabase-schema-design.md §9.3)

- service role key 只在 `apps/api/` server runtime
- storefront(`apps/storefront/`)不可 import service role key、只用 anon key + RLS
- env 不入 git、`.env.local` only、Vercel / Railway dashboard 設定

---

## §8 JSDoc TODO 對齊(ADR-0003 §3.3)

adapter-specific TODO 寫進 SupabaseProductAdapter class JSDoc(不寫 IProductRepository ports JSDoc):

- @TODO 樂觀鎖(updated_at 比對):save 時驗 wire updated_at(M-1-03 main-b sub-slice 4 後、M-1-13 落地完整)
- @TODO idempotency:save 重複呼叫同 entity 應冪等(對齊 backlog #86 contract test、M-1-13 落地)
- @TODO audit trail:寫操作記錄 customer_id + timestamp 進 audit log(M-3-04 落地)
- @TODO brand / category resolve cache:LRU cache 名稱→ID(原規劃 sub-slice 4 落地;**實際未在 sub-slice 4 落地、改依 lessons #84/#85 Defer 模式、待第 3 處撞才抽**〔Phase 1 dev 200 SKU round-trip 開銷可接受〕,見 SupabaseProductAdapter class JSDoc L97、#112)

對齊 ADR-0003 §3.3「ports JSDoc contract vs adapter implementation TODO」規則(M-1-02-audit Q6 落地)。

---

## §9 Sub-slice 拆法(5 sub-slice、各 ~45 min)

| Sub-slice | 範圍 | 估時 | 主要落地檔 |
|---|---|---|---|
| main-b-1 | adapter 骨架 + Supabase client init + mappers(map both)+ findById | ~45 min | SupabaseProductAdapter.ts(骨架 + findById)+ mappers/product.ts + client.ts |
| main-b-2 | listByCategory + listByBrand + parseCategoryPath helper + resolveCategoryId/BrandId 內部 helper | ~45 min | adapter +2 method + helpers/category-path.ts |
| main-b-3 | listByFitment + fitment helpers + resolveEnd helper(吸收 #92)+ InMemoryProductRepository 重構 | ~45 min | adapter +1 method + helpers/fitment.ts + packages/domain/src/catalog/year-range.ts + InMemory 重構 |
| main-b-4 | searchByKeyword(ILIKE)+ save + brand/category resolve cache | ~45 min | adapter +2 method + cache 內部實作 |
| main-b-5 | JSDoc TODO 整合 + Drift D1(IProductRepository.ts:14)+ Drift D2(packages/adapters/src/index.ts:1)順手修 + 雙跑 skill audit + 處置 audit findings | ~45 min | adapter JSDoc + 2 docs 字面修正 + audit |

### 9.1 跨 sub-slice 紀律

- 每 sub-slice 起手 5 綠檢查
- 每 sub-slice 收工:L1 三綠 + 該 sub-slice contract test(若有)+ commit + busboy-end + 不 push、Sean 手動推
- STATUS L29 hash drift 滾動修正模式持續(每 sub-slice 結尾順手修上輪 drift)
- 子 worktree #104 維持不動

---

## §10 字面 vs 事實揭示預留(對齊鐵則 11)

### 10.1 已知 Drift 處置

| ID | 位置 | 字面 | 處置 |
|---|---|---|---|
| D1 | `packages/ports/src/IProductRepository.ts:14` | 「M-1-03 MedusaProductAdapter(real)」應改「SupabaseProductAdapter(real)」 | main-b sub-slice 5 順手修 |
| D2 | `packages/adapters/src/index.ts:1` | 「Medusa / Supabase / Google Sheets / TapPay」應改去 Medusa | main-b sub-slice 5 順手修 |
| D3 | `docs/decisions/0003-domain-entity-naming.md` §3.3-§3.5+§4 多處 Medusa 字面 | 對齊 ADR-0005 §7「9 衝突仍適用、wire 端改 Supabase」 | 推遲、併 backlog #105 後續 docs slice |

### 10.2 預期偏離

- §3 SQL 字面實際跑 supabase-js 可能調整(`.contains` 對 jsonb array 行為、序列化等)、Code 落地時實測為準、PRD 為規格藍圖
- §5 helpers 簽名與 in-memory 重構交互可能調整(#92 helper 抽法)
- §9 sub-slice 估時 ±10 min 浮動

每 sub-slice commit body 揭示字面 vs 事實偏離。

### 10.3 不偏離項

- 命名:SupabaseProductAdapter / mapSupabaseProductToDomain / mapDomainProductToSupabase 字面不變
- 路徑:`packages/adapters/src/supabase/SupabaseProductAdapter.ts` 字面不變
- env vars:三 var 字面不變
- ADR-0003 §3.4 wire 字串紀律:不 leak adapter 邊界外
- supabase-schema-design.md §6.1 priceByTier 不洩漏鐵則

---

## §11 變更紀錄

| 日期 | 變更 | 變更者 |
|---|---|---|
| 2026-05-07 | 初版落地、Sean 拍 Q1=A 5 sub-slice / Q2=A D1+D2 main-b 內順手修 / Q3=A D3 推遲 #105;§1-§10 完整字面、9 個真權威字面源 GitHub MCP query 確認(IProductRepository.ts / ADR-0003 / ADR-0005 / supabase-schema-design.md / supabase/README.md / InMemoryProductRepository.ts / packages/adapters/src/index.ts / catalog/types.ts / shared/types.ts) | Claude.ai 規劃 + Sean 拍板 / 由 Claude Code(M-1-03-main-b Slice 0)落地 |

— END —
