# #12 手動建單(非網站商品)— 片級 plan(A 窗夜跑,零行 code)

> **狀態:等 Sean 批(鐵則 8 + 12)+ 一題待答。** 事實親查於 worktree `pcm-void-readers` @ `0e8c086b`。
> 上位權威 = `docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md` §5.3 項 10;本檔是它的片級落地,**不改它的任何合約**。

## §1 決策面:通的(不是這片卡住的原因)

master plan v2 `:1131` 逐字:「**admin 建單六題 ✅ 2026-08-09 Sean 全拍**…**開批閘已解除**」:
①價格 = 員工手填一口價含稅 ②稅/折扣 = 逐品項折扣 + 稅額分列 ③客戶 = **必掛既有會員、無帳號先建**
④付款 = **建單一律未付款**、收款走收款帳本 ⑤庫存 = 自由品項不進庫存採購鏈、出貨用「現貨補記到貨」`#352`
⑥經銷價 = 不自動帶、價格全手填、經銷價體系零接觸。

⇒ **卡的不是決策,是「admin 專用建單 RPC 還不存在」。**
數法(本 worktree 實跑):`grep -rn "admin_create_manual_order\|admin_create_order" supabase/migrations packages apps | wc -l` ⇒ **0**(兩種命名變體都試過);`apps/admin/src` 內 grep `建單` 的 4 行全是**別的功能的註解**(`admin-form.tsx:12` 逐字「等 E10 手動建單/改單的頁面級大表單有真實消費端時再做」)⇒ 連 UI 都沒有。

## §2 現況實查(為什麼不能沿用 `create_order`)

現行 `create_order` 的最新定義在 `supabase/migrations/20260730120100_m4b_e10_n3b_create_order_new_display_id.sql`,四道門把後台擋在外面:

| 行 | 逐字 | 為何擋住後台 |
|---|---|---|
| `:243` | `create_order: 未登入(auth.uid NULL)` | 後台走 service_role,`auth.uid()` 是 NULL |
| `:315` | `line 缺 variant_id 或 (supplier_slug,sku)` | 自由品項兩者都給不出 |
| `:319` | `找不到 variant(...)` | 必須是既有 catalog 變體 |
| `:233` / `:238` | 缺 `cart_session_id` / 缺同意條款版本 | 後台建單沒有購物車、沒有客人同意動作 |

⚠️ master plan v2 `:205` 引的是 `:284` / `:356` / `:360` —— **那是舊版 migration 的行號**,結論(不可用)一樣、**行號已漂移**,引用請用本表。

**好消息(結構上做得到)**:`order_items.variant_id` 是 **nullable**
(`supabase/migrations/20260604120000_m3_s2a_orders_order_items.sql:143` 逐字 `variant_id uuid REFERENCES product_variants(id) ON DELETE SET NULL`)
⇒ **自由品項不需要動 schema**。產號器也現成:`pcm_generate_display_id()`(`20260730120100:60-66` 有前置閘驗它存在且符合 6 碼合約)。

## §3 拆片(單片一定超過 45 分鐘 ⇒ 鐵則 4 先拆)

| 片 | 內容 | 片型 | 前置 | 估時 |
|---|---|---|---|---|
| **M12-M** | migration:`admin_create_manual_order` owner RPC(SECDEF、`SET search_path=''`、service_role EXECUTE、產號走 `pcm_generate_display_id()` + 上限 5 重試 + 用盡 `RAISE` 帶 token `pcm_display_id_exhausted`)| 🔴 **高風險片** | 無 | 40-60 分 |
| **M12-A** | repository + server action + 表單形狀層;**含 `pcm_display_id_exhausted` 的 catch → `LineAlertNotifierAdapter` 告警**(master plan `:707` 明訂為本片 DoD)| 標準片 | M12-M **已 apply** | 35-45 分 |
| **M12-U** | `/orders/new` 建單頁 + 表單元件 | 標準片 | M12-A | 35-45 分 |

🔴 **M12-A 必須先於 M12-M 上線**(只多接受一種輸入、此刻無人產生 ⇒ 惰性),理由與 `20260814100000:20-26` 記的三種形狀判準逐字同源。

## §4 要改哪些檔(我自己數)

- **M12-M = 1 檔**:`supabase/migrations/<版本號>_m4b_e10_12_admin_create_manual_order.sql`。🔴 **版本號跟主視窗要,不自己編。**
- **M12-A = 5 檔**:新增 `manual-order-repository.ts` / `manual-order-actions.ts` / `manual-order-form.ts` 與各自測試(2 支),改 `packages/adapters/src/supabase/database.types.ts`(新 RPC 型別)。
- **M12-U = 3 檔**:新增 `apps/admin/src/app/orders/new/page.tsx`、`apps/admin/src/components/orders/manual-order-form.tsx`、一支 smoke test。

⇒ **三片各自命中鐵則 8。**

## §5 鐵則 12 逐條過六類

| 類 | M12-M | M12-A | M12-U |
|---|---|---|---|
| ①錢 | 🔴 **是**(建的是訂單、寫 `subtotal`/`total`/`shipping_fee`)| 🔴 **是** | 是(送金額) |
| ②權限 | 🔴 **是**(新 SECDEF + GRANT)| 否 | 否 |
| ③DB 結構 | 🔴 **是**(migration)| 否 | 否 |
| ④平台設定 | 否 | 否 | 否 |
| ⑤對外 | 否 | **是(弱)**:失敗會送 LINE 告警 | 否 |
| ⑥`packages/ui` | 否 | 否 | 否 |

⇒ **三片全命中鐵則 12,codex 關卡2 一律不降級;M12-M 的 apply = Sean 手動停點。**

## §6 驗收條件(逐條 yes/no)

1. 建出來的單:`order_source` ∈ 三個 manual 值、`payment_status='unpaid'`、`paid_at IS NULL`(釘拍板④)。
2. 自由品項列:`variant_id IS NULL` 且該單**不產生任何** `order_item_procurement` 列(釘拍板⑤)。
3. 掛既有會員:`customer_user_id` 必填且必須查得到 profile;查不到 ⇒ RPC `RAISE`,**不自動建人**(釘拍板③)。
4. 經銷價零接觸:RPC 全文 grep `tier`/`dealer`/`price_` 相關字面,只准出現 `tier_at_checkout`(欄位必填)且**其值來自呼叫端明示、不由 RPC 查表推導**(釘拍板⑥)。
5. 產號:單元測試預插衝突值證明會重試;用盡時 `SQLSTATE P0001` 且 message 含 `pcm_display_id_exhausted`。
6. 告警負向測試:模擬 RPC RAISE 該 token ⇒ 斷言 LINE 告警**確實送出**、且對操作者回一般錯誤(不洩內部細節)。
7. 交易模擬 `BEGIN → 建單 → 驗 → ROLLBACK`,零留痕。
8. 🔴 **判別自由品項只准讀 `product_snapshot->>'manual'`**(§7 約束 1):
   `grep -rn "MANUAL-" apps packages` 的每一處命中都要能指出行號與該行內容,**且不得出現在條件式裡**。
   負向對照 = 把某列的 `variant_sku` 改成不帶前綴、`manual` 旗標留著,判別仍必須成立。
9. 🔴 **`MANUAL-` 流水不與真實 SKU 撞的保證要寫出來**(§7 約束 2);寫不出來 ⇒ 標「未確認」並停,**不得假設**。
10. 三綠 + codex 關卡2(三片皆是)。

## §7 🏁 Q-M12-1 已裁 = A(2026-08-14 夜,流程題,主視窗直接裁)+ 兩條硬約束

**定案**:員工手填品名;RPC 同時寫進 `variant_sku`(`MANUAL-` 前綴 + 流水)與
`product_snapshot`(`{"name": 品名, "manual": true}`)。裁定理由:它不改任何生意規則、只決定資料形狀,
而 B 案的代價是 `order_items` 的既有讀者全要回訪。

🔴 **附帶兩條硬約束(不是建議,是驗收條件)**:

1. **判別自由品項一律讀 `product_snapshot->>'manual'`;禁止用 `variant_sku` 的 `MANUAL-` 前綴做字串判斷。**
   字串前綴是脆弱判準(同族 = memory `feedback_assertion-measures-the-wrong-thing`)。
   前綴的用途只是「讓那個 NOT NULL 欄有一個人看得懂的值」,**不是判準**。
   ⇒ 全樹掃描守門:`grep -rn "MANUAL-" apps packages` 的命中**不得出現在任何條件式裡**。
2. **`MANUAL-` 流水必須保證不與真實 SKU 撞,而且要寫出「怎麼保證」** —— 是撈全表比對,還是靠命名空間
   (例:真實 SKU 的字元集/格式本身就排除 `MANUAL-` 開頭)。
   🔴 **現況=未確認**:我沒有查過 `product_variants.sku` 的格式約束,也沒有數過現有 SKU 裡有幾筆以 `MANUAL` 開頭。
   **M12-M 開工前必須先答這題,答不出來就不准假設不會撞。**

<details><summary>原題與選項(存查)</summary>

**Q-M12-1:自由品項的 `variant_sku` 與 `product_snapshot` 塞什麼?**
兩欄在 schema 上都是 **NOT NULL**(`database.types.ts:906-921` 的 `Insert` 皆無 `?`),而自由品項**沒有** SKU、也沒有商品快照。

| 選項 | 內容 | 擋不擋後續片 |
|---|---|---|
| **A(我推薦)** | 員工手填一個「品名」;RPC 把它同時寫進 `variant_sku`(前綴 `MANUAL-` + 流水)與 `product_snapshot`(`{"name": 品名, "manual": true}`)| 不擋。`manual: true` 讓所有讀者一眼分得出自由品項 |
| B | 另加欄位 / 另開表存自由品項 | **擋**:變成動 schema 的大片,且 `order_items` 的既有讀者(明細頁、取消、退款、出貨)全要回訪 |

推薦 A 的理由:`order_items` 的既有讀者有一整排,B 會逼它們全部改;A 讓自由品項在型別上與一般品項同形,只多一個可判別旗標。

</details>

## §8 誠實缺口

1. **我沒有對正式庫查任何東西。** §2 的四道門、`variant_id` nullable、`pcm_generate_display_id()` 存在 —— **全部來自 repo 內的 migration 檔**。照今天第 4 條教訓,這只算「repo 這樣寫」,**正式庫實況=未確認**。M12-M 開工前要對 DB 查 `pg_proc` 與 `information_schema.columns`。
2. **`#352` 現貨補記到貨我沒有查它現在的狀態。** 拍板⑤說自由品項出貨靠它,若它沒到位,這片建的單會卡在出不了貨 —— **這是我沒驗的下游依賴**,不是我判它沒問題。
3. **`shipping_address_snapshot`(NOT NULL Json)與 `address_id`(nullable)的來源我沒定。** 拍板③說必掛既有會員 ⇒ 直覺是取會員地址,但**「會員沒有地址時怎麼辦」沒有拍板、我也沒查有幾個這種會員**。這會在 M12-M 寫簽章時再撞一次,屆時要獨立問。
4. **稅/折扣分列(拍板②)我沒有設計欄位落點。** `orders` 有 `discount_total`,但「逐品項折扣 + 稅額分列」要落在 `order_items` 的哪裡,我**沒有查到現成欄位**(`database.types.ts:906-921` 的 `order_items` 欄位裡沒有 discount / tax 字樣)⇒ **這可能讓 M12-M 從「只加 RPC」變成「要加欄位」**,是本片最大的未爆點。
