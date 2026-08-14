# #13 前置片 0:訂單「可改矩陣」(零 code、零 DB)

> **用途**:Sean 明天靠這張表決定 `#13` 先做哪一塊。**「不能改」那格的價值在理由,不在叉。**
> 事實親查於 `pcm-void-readers` @ `3cd4c6e4`;每格附 `檔案:行號`。**全部來自 repo 檔案,未對正式庫查詢。**

## §0 三個結構事實(整張表都建在這上面)

1. **後台唯一的改單寫入路徑 = `admin_update_order_workflow`(patch + 樂觀鎖),而它的 key allowlist 只有 4 個**:
   `supabase/migrations/20260716130000_m4a_admin_update_order_item_workflow_rpc.sql:231-232` 逐字
   `ARRAY['shipping_method', 'invoice_number', 'invoice_amount', 'invoice_status']`;
   `:258-259` 送任何其他 key = **`RAISE`(不是靜默忽略)**。
2. 🔴 **`service_role` 對 `order_items` 零直寫權,而且是被斷言守著的**:同上 `20260807120000_m4b_e10_a9v_nine_code_writer_revoke.sql:151` 逐字
   「`service_role` 對 `order_items` 有直寫權(繞過 RPC 就能寫九碼,停寫不真);拒繼續」
   ⇒ **任何改品項/數量/金額都必須新開 owner RPC,應用層沒有捷徑。**
3. 🔴 **`quantity` 被複合鍵物理釘死**:`20260730150000:75` `ADD CONSTRAINT order_items_id_quantity_key UNIQUE (id, quantity)`;
   摘要表 `:91-94` 複合 FK `(order_item_id, quantity) REFERENCES order_items(id, quantity) ON DELETE CASCADE`;
   `:82-83` 註解逐字「去正規化欄…**值的正確性由複合 FK 物理保證,不靠任何程式自律**」。

## §1 `orders` 欄位矩陣

| 欄 | 能改? | 擋它的是什麼(檔:行) | 連動 |
|---|---|---|---|
| `shipping_method` | ✅ 現在就能 | allowlist 內(`20260716130000:232`) | 無 |
| `invoice_status` / `invoice_number` / `invoice_amount` | ✅ 現在就能 | 同上 | 無 |
| `subtotal` / `total` / `shipping_fee` / `discount_total` | ❌ | **不在 allowlist ⇒ 送了會 RAISE**(`:258-259`);全樹無其他 writer | 改它要同時改 `order_items.line_total`,而後者無寫入路徑(§0-2) |
| `payment_status` / `paid_at` / `tappay_rec_trade_id` | ⛔ **不該由改單碰** | 專屬寫入路徑 = 付款/退款線;`#497` 還卡在 Sean 桌上 | 動它 = 動錢 |
| `fulfillment_status` | ⛔ 同上 | 出貨線 RPC 專屬(`admin_mark_shipment_shipped` 等) | 出貨狀態 |
| `cancelled_at` / `cancelled_reason` | ⛔ | `admin_cancel_order` 專屬 | 取消線 |
| `customer_user_id` | ❌ | 無 writer;等於「把單換一個客人」 | 會員、經銷價、稽核全斷 |
| `display_id` / `legacy_display_id` | ❌ **永不** | 產號合約(6 碼、`orders_display_id_key`) | 客人手上的單號 |
| `shipping_address_snapshot` / `invoice`(Json) / `tier_at_checkout` / `shipping_method_at_checkout` | ❌ | **快照欄** —— 存在的意義就是「當時長這樣」 | 改它 = 竄改歷史 |
| `cart_session_id` / `order_source` / `payment_channel` / `created_at` | ❌ | 建單當下決定,無 writer | 無 |

⚠️ **U2「改地址」怎麼辦**:地址在 `shipping_address_snapshot`(快照)與 `address_id` 兩處,
**我沒有查它們誰是出貨時真正被讀的那個** ⇒ 這格標**未確認**,不是「不能改」。

## §2 `order_items` 欄位矩陣(全表 13 欄,`database.types.ts:906-921`)

| 欄 | 能改? | 擋它的是什麼 | 連動 |
|---|---|---|---|
| `quantity` | 🔴 **最難的一格** | §0-3 複合 FK + 摘要表 10 條 CHECK 中的四條地板(`oiqs_ordered_le_quantity` / `oiqs_cancelled_le_quantity` / `oiqs_instock_cancelled_le_quantity` / `oiqs_cancelled_shipped_le_quantity`)| 同交易必須改**兩張表**;改小的下限 = 已訂貨 / 已到貨+已取消 / 已取消+已出貨 三者取大 |
| `unit_price` / `line_total` | ❌(但**最容易解**)| 只有 §0-2 一條(無 RPC),**零 CHECK、零 FK 牽扯** | 要重算 `orders.subtotal`/`total` |
| `variant_id` / `variant_sku` / `product_snapshot` | ❌ | 快照與歸屬;`variant_id` 可為 NULL 是給自由品項用的(`20260604120000:143`)| 改它 = 換一個商品,應該走「刪一列 + 加一列」 |
| `workflow_status` | ⛔ **已停寫** | A9v 撤權,欄凍結不 DROP(`20260807120000:154-160`)| 九碼線已退場 |
| `availability_at_checkout` / `vehicle_snapshot` | ❌ | 快照欄 | 無 |
| `version` / `id` / `order_id` / `updated_at` | ❌ | 結構欄 | 無 |

## §3 「加一列 / 刪一列」

- **加一列**:不撞任何 CHECK(新列的 `ordered/instock/cancelled/shipped` 全為 0)⇒ **結構上最單純**,只需新 RPC + 摘要表同交易插一列。
- **刪一列**:🔴 **不該做**。複合 FK 是 `ON DELETE CASCADE`(`20260730150000:94`)⇒ 刪品項會**連同摘要一起消失**,
  已訂貨/已到貨/已出貨的紀錄變成沒有母體。**正解走取消線**(`admin_cancel_order` 的部分取消),不是刪列。
  ⚠️ 這是我的判斷,**沒有拍板背書**,列給 Sean 裁。

## §4 為什麼施工序是「金額 → 品項 → 數量」

| 序 | 片 | 為什麼排這裡(用上面矩陣的格說話) |
|---|---|---|
| 1 | **改金額** | §2 顯示它**只被一條東西擋**(沒有 RPC),零 CHECK、零 FK。⇒ 用最小的片證明「新開一支 order_items owner RPC + 樂觀鎖 + 稽核」這條路走得通 |
| 2 | **加品項** | 同樣不撞 CHECK,但多一層「摘要表要同交易插列」⇒ 在第 1 片的路上多走一步 |
| 3 | **改數量** | 唯一需要**改不變式本身**的一格。`20260730150000:110-112` 逐字「正解是**連同 A2 的來源模型一起改不變式,不是繞過它、也不是手填欄位**」⇒ 它必須排在有人已經走熟前兩片之後 |

🔴 **順序不是偏好,是「每片各自撞到幾層東西」**:第 1 片撞 1 層(無 writer)、第 2 片撞 2 層(+ 摘要插列)、第 3 片撞 3 層(+ 複合 FK + 四條地板)。

## §5 誠實缺口

1. **全部未對正式庫查詢。** allowlist 4 鍵、`service_role` 零直寫、複合 FK、10 條 CHECK ——
   **全部來自 repo 內 migration 檔**,只算「repo 這樣寫」。開工前要對 `pg_proc` / `pg_constraint` / `information_schema.column_privileges` 各查一次。
2. **`orders` 的 `Insert` 實際有 35 個鍵**,數法:`sed -n '1549,1700p' database.types.ts | sed -n '/^        Insert: {/,/^        }/p' | grep -c "^          [a-z_]*?\?:"` ⇒ **35**。
   §1 的表只有 11 列、其中多列是合併同性質欄(快照類、結構欄)⇒ **我沒有逐欄列完**。
   🔴 **沒列到的欄不等於檢查過了**(08-14 一天四次的形狀)。
3. **`admin_*` RPC 我數到 23 支**,但這是**下限不是總數**:
   數法 `grep -c "^      admin_[a-z_]*: {" database.types.ts` ⇒ **25**,其中 `admin_audit_log`(表,`:221`)
   與 `admin_order_list_v`(view,`:2703`)**不是函式**,扣掉 = 23。
   而 08-14 夜剛 apply 的 `admin_void_item_procurement` **不在這 23 支裡** —— `database.types.ts` 尚未重 gen
   (交接檔已記此事)⇒ **真實 RPC 數 > 23**。
   我只逐支確認了改單、取消、出貨、付款四條線的歸屬,**其餘沒有逐支開檔**
   ⇒ §1「無 writer」那幾格是**基於 allowlist 推論,不是逐支排除**。
4. **地址那格未確認**(§1 末)。
5. **「刪一列走取消線」是我的判斷,無拍板背書。**
