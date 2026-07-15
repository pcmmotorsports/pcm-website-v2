# V-1d「愛車車庫源頭字典化」slug 落庫 plan(v1、2026-07-15)

> 依值班台 07-15 開單 `m4a-v1d-garage-dictionary-directive.md`;UI 先行片(表單字典雙下拉)已於 `21f575f` 落地並 PASS,本 plan 只涵蓋其餘三件:**migration slug 欄 / server fail-closed 驗證 / chips 分流**+值班台記錄項「字面構造收斂單一來源」。鐵則 8(動 schema)=plan 先審,值班台裁定後才動工;migration 恆不 apply、Sean db push。

## 0. 相關既有紀錄與連動面

- 拍板:Sean 07-15 午後「愛車沿用車款字典篩選、沒有再自行輸入」=本單母拍板;Q3=B(搜尋情境不自動回存車庫)不衝突。
- 既有件:`21f575f`(表單 UI)、`dc811d3`(V-1c chips REQUIRED-2 比對流)、vehicle-context `pcm.vehicle.v1`、`customer_vehicles` 表(name/year 自由文字、RLS own-only)、`fetchVehicleTaxonomy()`(product_fitments 衍生、unstable_cache 900s)。
- 連動檔:InlineVehicleForm/VehiclesTab/AccountView/account/page.tsx、app/account/vehicle/actions.ts、packages/schemas VehicleInput、packages/adapters SupabaseVehicleAdapter、VehicleFinder(chips)、lib/vehicle-match.ts。
- 下游:V-2 購物車車款欄(讀 vehicle-context)、V-3 order_items.vehicle_snapshot(硬閘、不在本單)。

> **🔴 裁定註記(2026-07-15 值班台硬審 verdict)**:語意改 **A=字典名稱字面** `dict_brand_name`/`dict_model_name`(taxonomy brand.name/model.name 逐字),**非**合成 slug id——查證 vehicle-taxonomy.ts:37-51 撞名序號隨掃描先後換位、持久化 id 有靜默指錯車向量。本檔以下「slug」語彙同構替換為名稱字面讀之;migration=`20260716150000_m4a_v1d_customer_vehicles_dict_columns.sql`(硬審 PASS、含成對 CHECK;可 commit 可推、不 apply 等 Sean db push)。

## 1. Q1(migration 形狀):**A=兩欄** `moto_brand_slug` / `model_slug`(推薦)

| | A. 兩欄 text NULL(推薦) | B. 單欄 `vehicle_slug` 三段式 `brandId:modelId[:year]` |
|---|---|---|
| 年份 | 沿用既有 `year` 自由文字欄(實車年份可不在字典=UI 片已拍原則),**slug 不含年、無雙真相** | year 進 slug 與自由 year 欄兩處記年 → 漂移面 |
| 驗證 | server 逐欄驗(brand 存在+model 屬該 brand),fail-closed 直觀 | 需 parse 字串再驗、格式錯誤多一類 |
| 診斷 | 可單獨 NULL(理論上恆成對寫入,見 §3 不變式) | 一欄全有全無 |
| 對齊 | taxonomy 結構(brand.id/model.id)與 URL `?vehicle=` 語彙同源 | 同 |

**選 A。**migration(additive、零 DROP、零新 GRANT 面):

```sql
ALTER TABLE public.customer_vehicles
  ADD COLUMN IF NOT EXISTS moto_brand_slug text NULL,
  ADD COLUMN IF NOT EXISTS model_slug text NULL;
COMMENT ON COLUMN ... =(兩欄:NULL=自由輸入/舊資料;值恆成對、= taxonomy brand.id/model.id 字面)
```

- RLS:既有 own-only policy 是 row 級、新欄自動涵蓋;不動 policy、不動 GRANT(authenticated 既有 column 級?→ 動工前 grep migration 史核實 GRANT 形狀,若是逐欄 GRANT 則本支補同權限兩欄=照 sibling)。
- 不回填既有列(值班台單第 4 點;硬轉=替客人認錯車)。
- 驗證:交易模擬(BEGIN→ALTER→INSERT/UPDATE 模擬 anon/authenticated/own row→ROLLBACK)+零留痕;**不 apply、等 Sean db push**。

## 2. Server fail-closed 驗證(app/account/vehicle/actions.ts + schemas)

- `VehicleInput` 加 optional `brandSlug`/`modelSlug`(兩者 all-or-nothing:只給一個=400 欄位錯)。
- server 端(add/update action):slug 有值 → `fetchVehicleTaxonomy()` 查 brand.id 命中且 model.id 屬該 brand,**查無=fieldErrors 拒寫**(client 選單只是便利、不可信=值班台 REQUIRED);slug 缺省=自由輸入路徑、行為不變。
- name 仍自由(dict 選車時表單預設帶標準字面、客人可改顯示名、slug 不變=值班台單第 2 點)。
- taxonomy fetch 失敗(cache 失敗回 [])時:**fail-closed=slug 寫入拒絕**(回「稍後再試」formError)、自由輸入不受影響。

## 3. 表單串線(InlineVehicleForm 小改)

- dict 模式 onPick 已握 taxonomy 物件 → 送出加 `brandSlug/modelSlug`(id 字面);free 模式恆不送 slug。
- 編輯回填:slug 有值 → 由 taxonomy 直接回填雙下拉(取代現行 parseDictName 字面解析;slug 查無=字典演化 → 降級 parseDictName → 再無 → free);slug NULL → 現行路徑不變。
- 不變式:**slug 恆成對出現或成對 NULL**(server 驗證+表單只會成對送)。

## 4. Chips 分流(VehicleFinder)

- garage 讀取投影加兩 slug 欄(page.tsx server 端 narrowed serialization 加欄;無敏感面、公開字典字面)。
- chip 點擊:`slug 有值 → taxonomy lookup(brandId+modelId)直接套用`(零字面比對;year 沿既有閘=合法才帶);`lookup 查無(字典演化)或 slug NULL → 既有 REQUIRED-2 字面比對流`(唯一精確命中/建議清單/零猜)。零行為刪除、只加快路徑。

## 5. 字面構造收斂(值班台記錄項折入)

- `lib/vehicle-match.ts` 新 `vehicleLabel(brandName, modelName)`=唯一「品牌 車型」構造點;現 4 處(VehicleFinder 1+InlineVehicleForm 3)全改呼叫之。slug 化後比對走 slug、字面只剩顯示。

## 6. 切片與順序(各 15-45 分)

1. **V-1d-1**:migration+交易模擬+GRANT 形狀核實(不 apply)→ 值班台審 migration(硬性)。
2. **V-1d-2**:schemas+server 驗證+表單串線+單測(slug 成對/fail-closed/taxonomy 失敗拒寫/自由輸入不變)。
3. **V-1d-3**:chips 分流+字面收斂+單測(slug 快路徑/字典演化 fallback/NULL 走舊流)。
- 2/3 的 UI 生效不依賴 migration 已 apply?**依賴**(欄不存在寫入即错)→ V-1d-2/3 code 完成後 gate 在 Sean db push,與 D-2 部署順序教訓同款:**先 db push 才 git push**;期間 flag 天然=slug 欄缺省寫入會炸 → 因此 V-1d-2 的 adapter 寫入**必須容忍欄位不存在?否**——直接排程:migration 先 apply 再部署 code(硬順序寫進 STATUS)。

## 7. 影響面與 rollback

- 影響面:customer_vehicles(加欄)、會員側 actions/schemas/adapter、VehicleFinder chips、account 頁投影。**零觸碰**:金流/order/經銷價/tier、create_order(V-3 事)、admin。
- rollback:code revert 即回自由文字行為(欄留著無害);migration 不可逆面=零(additive、無資料轉換)。

## 8. 驗收(每條 yes/no)

1. 交易模擬 PASS+零留痕紀錄附 plan 回報。
2. server:非法 slug(brand 不存在/model 不屬 brand/單邊送)全被拒,合法寫入 slug 成對落庫。
3. chips:slug 車一鍵直套(零比對)、舊資料/自由輸入車行為與 dc811d3 現況 byte 級一致。
4. `品牌 車型` 字面構造全 repo 只剩 vehicleLabel 一處定義。
5. 三綠+full vitest+code-reviewer;migration 部分值班台硬審。
