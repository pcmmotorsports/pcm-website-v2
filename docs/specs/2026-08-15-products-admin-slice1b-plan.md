# `#20` 片1b — 後台商品詳情頁(唯讀) · slice plan

> 撰:B 窗(商品線),2026-08-15。上游 = `docs/specs/2026-08-14-products-admin-slice1a-plan.md`(片1a,已完工 `c41fb6c5`)
> 與 `docs/specs/2026-08-14-products-admin-line-recon.md`(整條線的偵察)。
> **本檔是 plan,不是完工報告。主視窗批准前不動 code。**

---

## 0. 三條承重前提(漏寫其中一條,這片的設計就會錯)

1. 🔴 **`products` 是報價單專案每日同步的「目標表」,後台不是商品主檔。**
   ⇒ 詳情頁上看到的幾乎每一個欄位,**明天早上都可能被同步覆蓋**。
   ⇒ 這片**唯讀**不是偷懶,是「還沒決定權威歸誰之前,不要開一個會被蓋掉的編輯框」。
   依據:`docs/specs/2026-08-14-products-admin-line-recon.md`(該檔為本窗 08-14 所寫,內含逐條 `檔案:行號`)。

2. 🔴 **「已知七套保護」≠ 盤完了。** 自標缺口連續三次補掃都翻出新的(第五→第六→第七套)。
   本 plan 一律寫「**已知 N 套**」,並附「還沒盤哪些面」。**不得寫成「共 N 套」。**
   還沒盤的面(逐字沿用 `B-HANDOFF.md` §2-2):其他表的欄級授權以外的面、DB 端有無第八套。

3. 🔴 **保護有兩種形狀,強度不同:**
   - **旗標鎖**(如 `manually_corrected` / `translation_locked`):連「來源那天有給值」也不覆寫。
   - **防洗網**:只擋「來源那天沒給值」⇒ **擋不住供應商改了名字/換了圖。**
   ⇒ **圖片今天只有防洗網。** 詳情頁會把圖片放大展示,員工看到的圖**沒有旗標鎖保護** ——
     這件事要寫在頁面上(見 §3 驗收 6),不能讓員工以為「後台看到的就是最終定案」。

---

## 1. 這片做什麼

`/products/[id]` — 點列表任一列進來,**只能看,不能改**。

### 1.1 要顯示的欄位(逐欄對應 DB;來源 = 各 migration,見 §6)

| 區塊 | 欄位 | 來源欄 |
|---|---|---|
| 標題列 | 商品名稱 / 副標 | `title` / `subtitle` |
| 識別 | 料號 / 供應商 / 網址代稱 | `external_id` / `supplier_slug` / `handle` |
| 分類 | 品牌 / 分類 | `brand_id` → `brands`、`category_id` → `categories`(需 join,見 §4 風險 R2) |
| 狀態 | 上架狀態 / 庫存狀態 | `delisted_at`(走 `resolveListingState`)/ `availability` |
| 售價 | 售價 | `price_general`(走 `resolvePrice`) |
| 內容 | 商品說明 / 賣點 | `description` / `highlights` |
| 適用 | 適用車型 | `fitments` |
| 媒體 | 圖片 / 影片 / 安裝手冊 / 聲浪 | `images` / `video_url` / `manuals` / `sound_clips` |
| 時間 | 建立 / 最後更新 | `created_at` / `updated_at` |

### 1.2 **不顯示**(硬清單,由測試釘死)
`price_store`(經銷價)、`price_by_tier`(內含 `store` / `premiumStore` 兩個經銷價 key)、`cost`、`metadata`。

片1a 的守門實際釘的是 **4 個 token**:
`price_store` / `price_by_tier` / `cost` / **`supplier_slug`** —— **`metadata` 不在裡面。**
⇒ 本片對這份清單做兩件事:**移出 `supplier_slug`**(§5-N2)、**補進 `metadata`**
。淨結果:禁字仍是 4 個。

**`metadata` 為什麼要禁,理由寫準一點**(`20260602135934:80-82` 洗值 / `:88-90` 加 CHECK;
🔴 R1 N-f:第一版寫 `:84-90` 橫跨了兩張表,`:84-86` 是 `product_variants` 不是 `products`):
那支 migration 先 `SET metadata = metadata - 'shopee' - 'cost' - 'source_amount' - 'source_currency'`
洗掉四個敏感 key,再加 `products_metadata_no_sensitive` CHECK 擋它們回來。
⇒ **那條約束只擋這 4 個具名 key,不擋其他任何 key。**
⇒ 「整包印出來安全嗎」等同於「metadata 現在還裝著什麼」—— **沒有人盤過,我也沒盤**。
   在盤完之前,唯讀頁**不整包印**;真要顯示就逐 key 指名(同 `select` 逐欄指名的紀律)。

🔴 **`supplier_slug` 要從禁字清單移出**(片1a nit N2,本片處理) —— 見 §5-N2。

---

## 2. 片型與規則判定(動手前先標)

| 項目 | 判定 | 依據 |
|---|---|---|
| **內容分級** | **L1** | 詳情頁的版面/欄位順序年 0-1 次改;商品內容本身不是後台維護的(前提 1) |
| **片型** | **標準片** | 不碰 `packages/ui` / 金流 / schema / auth,但跨 3+ 檔 ⇒ 不算輕量片 |
| **鐵則 8** | **命中(跨 3+ 檔)** | 故本檔存在;**主視窗批准才動手** |
| **鐵則 12** | **不命中** | ①錢=唯讀不寫、不碰 order/payment/pricing 寫入 ②權限=不動 RLS/GRANT,沿用既有 service_role 讀 ③schema=**零 migration** ④平台設定=不動 ⑤對外=不寄信不發布 ⑥`packages/ui`=不動,只用 admin 本地元件 |
| **主視窗授權** | **在範圍內** | 不碰錢/權限/schema·migration/平台設定(逐字 `project_0814-night-scope-delegation-and-two-slices-approved.md:23-29`,本窗已自行開檔核對,非轉述) |

🔴 **一旦這片需要動 schema 或任何寫入路徑 ⇒ 立刻停,那不在主視窗授權內,要 Sean 本人。**
目前的設計**刻意不需要**,靠的是「唯讀 + 零 migration」。設計一旦被改成要存檔,這條就失效。

---

## 3. 驗收條件(每條可 yes/no,不可寫「應該會過」)

1. `/products/[id]` 用列表上任一列的 id 進得去,§1.1 **九個區塊**的欄位都看得到。
   🔴 **這條在 1b-1 只達成六個區塊,不是九個**(R2 MF3):內容 / 適用 / 媒體三個區塊、
   共七欄(`description`/`highlights`/`fitments`/`images`/`video_url`/`manuals`/`sound_clips`)
   **在 1b-2 才做**。⇒ **驗收 1 = 部分達成,1b-2 完成前不得宣稱它過了。**
2. **已下架的商品也進得去**,而且狀態欄顯示「已下架」(不是 404 —— 後台存在的理由之一就是把它撈回來)。
3. 非 UUID 的 id → **404,且不打 DB**(鏡像 `app/customers/[id]/page.tsx:22-25`)。
4. 查無此商品 → 404;**讀取失敗 → 錯誤態 200**,DB error 字面不外洩到畫面(鏡像 `customers/[id]` 的兩路分流)。
5. 🔴 **經銷價守門 —— 本片必須把經銷價字集加進遞迴那道守門。**

   ⚠️ **本條第一版寫錯了,而且錯在「會漏經銷價」的方向。** 原句寫「四個 token 零命中、遞迴掃兩個目錄樹
   ⇒ 本片新檔一落地就自動被納入,**不需要改守門清單**」——**那是把兩道守門併成一道在講。** 實際:

   ⚠️ **下表寫的是「片1a 當時」的狀態,不是現況** —— 現況見其下的「折完之後」。
   🔴 **本表刻意不再寫 `檔案:行號`**(R2 nit-c):第一版寫的六個行號,在同一片後續往那支測試檔
   插了 44 行之後**整組過期**。plan 引用**同一片正在改的檔**的行號 = 保證會過期的字面。
   要看實況請直接開 `apps/admin/src/lib/products/product-repository.test.ts`
   (數法:`grep -n "驗收 4\|驗收 5\|^const .*_TOKENS\|^const .*_ROOTS\|^const REPO_FILE"`)。

   | 片1a 當時的守門 | 掃描範圍 | 禁的 token |
   |---|---|---|
   | 驗收 4 | **只有 `REPO_FILE` 一支檔** | `price_store`/`price_by_tier`/`cost`/`supplier_slug` |
   | 驗收 5 | ✅ 遞迴掃 `CONSUMER_ROOTS` | **只有 `price_general`/`delisted_at`** |

   **折完之後(片1b-1 + R1 + R2 + R3)**:
   · **經銷價三 token = 掃 `apps/admin/src` 全樹**(R3 F1;`cost` 用字界比對)——
     🔴 **這條把「每片手工擴目錄清單」這個病類整個移除**,不是再補一個枚舉項。
   · `metadata` = 只掃 `lib/products`(不能全樹:Next 頁面有官方的 `export const metadata`)。
   · 設計約束(`price_general`/`delisted_at`)+ `createSupabaseServiceClient` 零命中 = 掃消費面兩根。

   🔴 **本 plan 原本有一句假的「構造不出來」,作廢**:R1 我寫過「沒有機制保證未來所有
   商品相關目錄都被涵蓋 —— 這句是限制不是保證」。**那是假的**:機制存在、成本一次目錄走訪、
   實測零誤報(全樹 196 支非測試檔,三 token 原始命中 4 行**全在註解裡**)。
   我甚至在同一段自己舉了 `components/product-media/` 當例子,還是沒去做。
   **假的「構造不出來」比假的「已驗證」更毒 —— 它披謙虛外衣把工作從待辦裡拿掉。**

   ⇒ **遞迴的那道根本沒在掃經銷價** ⇒ 詳情頁印了 `price_store` **現行沒有任何一格會紅**。

   🔴 **這是片1a MF5 那個病的另一個作用域**:那次修的是**掃描範圍**,這次漏的是**掃描字集**
   (memory `feedback_claim-scope-exceeds-fact-three-shapes`「細緻度被誤讀成覆蓋度」)。

   **本片實際做的**(與本條第一版的字面**不同**,差異寫在這裡而不是默默改掉):
   · 遞迴那道補的是 `price_store`/`price_by_tier`/`cost` **三個,不含 `metadata`** ——
     Next.js 有官方的 `export const metadata`,裸 token 進消費面會在正當寫法上誤報;
     `metadata` 真正的入口是 `select` 欄位清單,進不了 row 型別就是 TS2339。**主視窗已裁定採納此偏離。**
   · 消費面改釘 **`createSupabaseServiceClient` 零命中**(R1 N-a)⇒ 補上「消費面自己開 client
     繞過 row 型別」那個殘缺口,而且零誤報。
   · 讀取層 `lib/products` **也改成遞迴掃**(R1 MF3),只掃經銷價字集、不掃設計約束字集。
   **驗證方式 = 同一個突變跑兩次**:在詳情頁寫一次 `price_store` ——
   **加字集之前必須是綠**(那個綠就是缺口的正向證據)、**加完必須是紅**。兩個結果都要寫進交件信。
6. 🔴 **圖片區要有一句「這裡的圖片來自供應商每日同步,改了會被蓋回去」**(前提 3)。
   驗收方式 = 測試斷言該字串存在;**不得寫成「即將可編輯」這類對未來的承諾**(片1a 已有同型守門)。
7. 列表頁每一列可點進詳情;詳情頁有「← 返回商品列表」。
8. 三綠分開收 exit + **整套** `pnpm exec vitest run apps/admin`(不是只跑改動路徑 —— 片1a MF1 的病根)。

---

## 4. 風險與未確認(誠實申報,不假裝已驗)

- **R1 片體積可能超過 45 分鐘(鐵則 4)。** 九個區塊裡有四個是 jsonb 陣列渲染(`images`/`fitments`/`manuals`/`sound_clips`)。
  ⇒ **見 §7 片界建議,我建議拆兩片。**
- **R2 品牌/分類要 join。** `brand_id` / `category_id` 是 FK(`20260507004826:34-35`);
  🔴 **`NOT NULL` 不在那兩行**(R1 N-e:照這個引用去核的人會判我型別寫錯)——
  真正的來源是 `20260507222633_products_brand_category_not_null.sql:5-6`。
  **PostgREST 內嵌關聯的實際回傳形狀我沒實跑驗過**(本機無正式庫連線)。
  🔴 **✅ 已處置,但處置方式是「消掉」不是「驗過」**:片1b-1 改成對 `brands` / `categories`
  **各查一次 `id, name`**,完全不用內嵌關聯 ⇒ **未知數消失,不是賭它會過**。
  代價 = 詳情頁多兩趟往返(單筆頁面可接受);內嵌關聯的形狀**至今仍未驗**,
  哪天真要用它,這條風險原封不動地回來。
- **R3 商品總筆數未查。** 本機沒有正式庫連線,**我沒數過,也不打算用估的填。**
  目前唯一有的量級線索 = `20260811040000:133` 的「`products` seq scan 各 **4,389 buffers**」(08-11 實測)。
  **buffers 不是筆數**,我沒有把它換算成筆數,也不建議別人換算。
- **R4 jsonb 欄位的實際內容形狀未驗。** `images` / `fitments` / `highlights` / `manuals` / `sound_clips`
  在 DB 是 `jsonb NOT NULL DEFAULT '[]'`,但**元素長什麼樣**我只從 storefront 端推,沒有實跑樣本。
  ⇒ 落地第一動 = 先撈一筆真實列印出形狀,**再寫渲染**,不要照猜的寫。
- **R5 已知七套保護的覆蓋面**:見前提 2,**還沒盤完**。本片不依賴「保護是完整的」這個假設。

---

## 5. 片1a 留下的 6 條 nit — 本片一併處理

| # | 內容 | 本片怎麼辦 |
|---|---|---|
| **N1** | 列表排序用 `id` 升冪 = UUID 亂序,建議 `created_at DESC` | ✅ **本片改,而且不需要加索引** —— 見下方「N1 更正」。排序改 `created_at DESC, id ASC`(**必須帶 `id` 當第二鍵**:`created_at` 同值時單靠它分頁會漂,同一筆可能出現在兩頁或都不出現)。 |
| **N2** | `supplier_slug` 列禁字的理由不成立 | ✅ **本片修**:公開 view 本來就投射它、唯一鍵是 `(supplier_slug, external_id)`(`20260602192455:53`)⇒ **料號本身不是全域唯一**,詳情頁不顯示供應商員工會分不清同料號的兩筆。**從禁字清單移除、改成必顯欄位**;`price_store`/`price_by_tier`/`cost` 三個維持禁。 |
| **N3** | `lib/test-support/strip-comments.ts` 已存在 | ✅ **本片改用共用版**。共用版嚴格較強:剝區塊註解(片1a 版不剝 ⇒ **把違規那行用 `/* */` 包起來就能繞過守門**)、且用 `(?<!:)` 避免吃掉 `https://`(`strip-comments.ts:13`)。**這是修一個真漏洞,不是整理。** |
| **N4** | `buildListHref` 可取代手寫 `buildHref` | ⏸ **本片不動**:既有的是 `buildCustomerListHref` / `buildOrderListHref` **各自的**,沒有通用版;詳情頁沒有篩選要組。**硬抽通用版屬於範圍擴張。** |
| **N5** | 超界頁碼回空陣列、超大頁碼 →(原文寫「400」,🔴 **來源查無**,見下)| ⚠️ **只折了一半**(R1 N-c):補了頁碼**算術**兩格,但整支 mock 掉 repository ⇒「PostgREST 對爛 range 回 **400**」那半**仍零覆蓋**(要打真 DB)。原本這格打 ✅ 是宣稱超過事實。<br>🔴 **「400」這個數字我把它拿掉了**(R3 判「未能裁定」、主視窗裁「沒人找得到來源的數字不准留在檔案裡」):它來自片1a 的 nit 原文,**我從頭到尾沒查過出處**。實查全樹唯一相關記載是 `SupabaseOrderAdapter.ts:239`「PostgREST 投影不支援子查詢,實測回 400 `PGRST100`」——**那是另一種情境(投影),不是 `.range()` 超界**。⇒ 正確表述:**PostgREST 對超界 `.range()` 的實際行為,本片未驗、也沒有 repo 內來源**。 |
| **N6** | storefront 有 5 處直讀 base `products` | ⏸ **不動,只記錄**:與本片零重疊(本片只新增 admin 檔)。**「5 處」是片1a 當時數的,引用前重數。** |

### 🔴 N1 更正(我第一版寫錯了,而且錯的方向是「把代價講大」)

第一版我寫「不改,因為 `products` 沒有 `created_at` 索引 ⇒ 等於無索引排序 ⇒ 加索引要 Sean」。
**「沒有索引」這句是對的,但拿它推出「所以不能改」是錯的** —— 我當時沒去查代價實際是多少,
直接用「未知筆數」把代價講成不可承受。這正是「折 finding 時順手寫的新理由最沒被驗過」那條。

實際查到的(**不是我推的,是 repo 裡的正式庫實測紀錄**):
`supabase/migrations/20260811040000_m4b_storefront_269b_catalog_new_arrivals.sql:130-136` 逐字寫著
—— 正式庫 `EXPLAIN(ANALYZE)` **48.053 ms**、`products` 兩趟 seq scan **各 4,389 buffers**、
`products.created_at` **無索引(實查 `pg_indexes` = 0 支)**、當時的結論是「**目前不加索引**」。

⇒ 全表掃一趟的量級是 **十位數毫秒**,而 admin 走的是 service_role(不吃 anon 的 3s 門)。
⇒ **排序改 `created_at DESC` 不需要 migration,本片可以自己做,不用驚動 Sean。**

⚠️ 這條依據的兩個限制我明寫,不當成保證:
1. **那是 2026-08-11 的量測(4 天前)**,不是今天的值,也不是本片這條查詢 —— 是**等價形狀**。
2. 它量的是型錄那支 RPC,**不是 `listProductsForAdmin`**。⇒ 落地後仍要看一次真實反應,
   慢了就退回 `id` 排序並開決策題,**不得默默加索引**(那才是 migration、才要 Sean)。

**既有索引 = 4 支**(不是我第一版寫的 3 支):`20260507004826:58-60` 三支 + `20260602135934:37` 的
`idx_products_supplier_slug`。數法:`grep -rn "CREATE INDEX" supabase/migrations/ | grep -i "on products"`。

---

## 6. 相關既有紀錄與連動面

- **上游 plan**:`docs/specs/2026-08-14-products-admin-slice1a-plan.md`(驗收 4/5 的設計約束由本片延續)。
- **偵察**:`docs/specs/2026-08-14-products-admin-line-recon.md`(同步權威衝突的原始盤點)。
- **Sean 已拍、本片受其約束**:
  - **Q-B2 = 乙案** — 鎖留報價單側,我們 admin 當介面 ⇒ **本片不在 admin 端造任何鎖。**
  - **Q-B3 = B** — 上下架權威歸我們後台。🔴 **附帶未解風險**:停產品仍顯示上架 ⇒ 客人買得到不存在的東西。
    **本片不碰這個風險,也不得在 plan 或 code 裡寫成已解決、更不得自己加保險。** 它是 Sean 桌上的題。
  - **Q-B4 內文範圍未定** ⇒ 本片按 §1.1 的欄位做,**不預先為未定的範圍做抽象**。
- **DB 依據(逐支 migration)**:
  `20260507004826_init_products.sql`(建表 + 三條索引)/ `20260516064013:10-11`(`price_general`/`price_store`)/
  `20260602135934:34,47`(`supplier_slug`/`delisted_at`)/ `20260602192455:53`(唯一鍵改複合)/
  `20260708120000:30`(`highlights`)/ `20260709120000:35-36`(`manuals`/`video_url`)/ `20260808000000:47`(`sound_clips`)。
- **鏡像先例**:`app/customers/[id]/page.tsx`(id 形狀守門 / 404 vs 錯誤態分流 / 單區塊容錯)。
- **Sean 桌上四條待查**(本片不依賴,但同一條線):`docs/specs/2026-08-14-sean-pending-lookups.md`。

---

## 7. 片界 — **已裁定:拆兩片(Q-B5 = 甲)**

> 2026-08-15 主視窗裁。**採納的理由是 R4(jsonb 形狀未實測),不是體積。**
> 先做 **片1b-1(骨架)**,落信看過再做 1b-2。



- **片1b-1 ✅ 已完工**(commit `d7ea56a2` + R1/R2 folds):路由 + id 守門 + 404/錯誤態分流 +
  標題/識別/分類/狀態/售價/時間**六個區塊** + 列表可點進來。
  → 驗收 **2、3、4、5、7、8 全達成;驗收 1 只達成六/九個區塊**(R2 MF3:上一次折把「建議先做」
  升格成「已完工 → 驗收 1-5」,而驗收 1 的字面是九個區塊 ⇒ **同一份檔內自相矛盾**,已改)。
- **片1b-2 ✅ 已完工**:內容與賣點 / 適用車型 / 圖片與影音**三個區塊**(不是四個 —— commit subject
  寫對、上一版 plan 寫成「四個區塊」是錯的,R1 N1)+ **圖片同步警語**。→ **驗收 6 達成**。

  🔴 **驗收 1 仍未完全達成,上一版把它升成「達成」是過度宣稱**(R1 MF9):
  plan `§0` 前提 3 逐字寫「詳情頁會把**圖片放大展示**」—— 那是「圖片只有防洗網」這條前提
  之所以適用於這一頁的**理由**。實作**一張圖都沒有渲染**(只顯示有沒有代表圖)、
  影片只顯示「有」、手冊不可點。
  ⇒ **驗收 1 = 欄位層達成、視覺呈現層未達成。** 這是刻意的縮範圍(見下),但上一次沒申報就升格,
  **那是字面 vs 事實**。

  🔴 **兩件與原 plan 字面不同的,寫出來不默默改:**
  1. **R4「先撈一筆真實列印形狀再寫渲染」那一步做不到**(本機無正式庫連線)。
     **我沒有用猜的替代它** —— 改去讀契約:`mappers/product.ts` 把 **jsonb 那三欄**
     (`:57` highlights / `:59` manuals / `:68` sound_clips)標成 `unknown[] | null`,
     理由是「**jsonb 來源 shape 不保證**」。
     🔴 **同段的 `:55 description` 與 `:60 video_url` 是 `string | null`,不是陣列**(R3 F2)。
     ⚠️ 這句 R1 N4 已經折過一次,但**只折了 `product-media.ts` 那個載體,這份 plan 沒掃到**
     ⇒ 失敗情境:有人照 plan 把 `video_url` 當陣列寫 guard。
     **這是「同一宣稱寫進多載體、只折被指名那份」的實例(R3 Q1 生成器 B)。**
     ⇒ **撈一筆本來也證明不了通則**(一筆乾淨 ≠ 全部乾淨);正解是照同一套 runtime guard 收斂,
     而不是先看形狀再假設形狀。`lib/products/product-media.ts` 的 guard 鏡像該檔 `:234-263`,
     **但有兩處刻意不同**(R1 MF6):`images` 比 mapper 嚴(mapper `:265` 零 guard 直透);
     `fitments` 鏡像的是**前台** `storefront/src/lib/products.ts:127-130`,不是 mapper。
     ⚠️ **但 R4 本身仍未驗** —— 我驗的是「契約長怎樣」,不是「今天資料長怎樣」。
  2. **適用車型只顯示 direct 筆數,不顯示清單**(刻意縮範圍)。`products.fitments` 只是 direct 那一半,
     繼承件在 `product_fitments_effective`(`SupabaseProductAdapter.ts:327-328`)
     ⇒ 印成完整清單會少算、**等於對員工說謊**。畫面上逐字寫明「不含繼承、完整清單還沒做」。

> 🔴 **N-i 清理**(R1):本節原本在「已裁定」的標題底下還留著「**推薦:拆**…若主視窗判不用拆,
> 我照一片做」這段建議文字,**下一個人會以為還沒裁**。裁定理由已寫在上方引言,建議段落刪除。
> 原始的判斷過程(理由是 R4 不是體積)保留在裁定引言裡,沒有被抹掉。

---

## 8. 我還沒做的事(申報)

- **沒有寫任何 code。** 本檔是 plan。
- **沒有連過正式庫**,故 R3(筆數)、R4(jsonb 形狀)、R2(join 回傳形狀)三條都標「未驗」。
- **沒有重數 N6 的「5 處」**,沿用片1a 當時的數字並標了「引用前重數」。
