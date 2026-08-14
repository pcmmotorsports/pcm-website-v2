# #13 前置片 0:訂單「可改矩陣」(零 code、零 DB)

> 🔴 **2026-08-14 第二版**:C 窗 fresh-context 對抗複驗給了 3 must-fix / 3 nit,**六條全部成立**
> (我逐條自己重跑 grep 驗過,不是照抄)。改動集中在:§0-2 引證換掉、§2 `unit_price` 那列、
> §3「刪一列」的**理由整條重寫(舊理由方向講反了)**、§4 層數重算、§1 補齊全部欄位。
>
> ✅ **`orders` 的 35 個鍵現在逐鍵都在 §1 有位置了**(第一版只涵蓋 25 個)。
> 數法:`sed -n '1549,1700p' database.types.ts | sed -n '/^        Insert: {/,/^        }/p' | grep -o "^          [a-z_]*"`
> 取出 35 鍵,再逐鍵 `grep` 本檔 ⇒ **未涵蓋清單為空**。
> ⚠️ 仍要注意:**「有位置」不等於「查得深」** —— 結構欄那一列是整批帶過的,只確認無 writer,沒有逐欄追。
>
> **用途**:Sean 明天靠這張表決定 `#13` 先做哪一塊。**「不能改」那格的價值在理由,不在叉。**
> 事實親查於 `pcm-void-readers` @ `3cd4c6e4`;每格附 `檔案:行號`。**全部來自 repo 檔案,未對正式庫查詢。**

## §0 三個結構事實(整張表都建在這上面)

1. **後台唯一的改單寫入路徑 = `admin_update_order_workflow`(patch + 樂觀鎖),而它的 key allowlist 只有 4 個**:
   `supabase/migrations/20260716130000_m4a_admin_update_order_item_workflow_rpc.sql:231-232` 逐字
   `ARRAY['shipping_method', 'invoice_number', 'invoice_amount', 'invoice_status']`;
   `:258-259` 送任何其他 key = **`RAISE`(不是靜默忽略)**。
2. 🔴 **`service_role` 對 `order_items` 四個寫動詞全斷(INSERT/UPDATE/DELETE/TRUNCATE)**:
   權源 = `20260611120000_m3_s2c_confirm_payment_rpc.sql:240` 逐字
   `REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.order_items FROM service_role;`
   四動詞全驗的斷言在 `20260716120000:100-105`。
   ⚠️ **2026-08-14 修正(C 窗 N1,我開檔複驗成立)**:本段原本只引 `20260807120000:151`,
   而那條斷言**只查 `UPDATE` 與 `INSERT`**(`:150-151` 逐字兩個 `has_table_privilege`),
   **不含 `DELETE`** —— 偏偏 §3「刪一列」整段的前提就是 DELETE 被擋。**引證與結論沒對上,已換成上面兩處。**
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
| 🔴 `notification_email` | ❌ **但這格可能是 `#13` 最該先做的** | 不在 allowlist ⇒ 送了 RAISE;全樹無其他 writer | **客人 Email 打錯就收不到任何通知**,而這是員工最常要改的東西之一。`20260718120000:137-138` 逐字「訂單通知信箱**快照**…客人結帳當下填寫、**凍結於訂單層**,不隨會員檔變動」⇒ 改它**不會**動到會員檔;同段另記 254 octet 上限、只收可列印 ASCII、禁 LINE 合成域 |
| `payment_method` | ❌ | 無 writer | ⚠️ **不是** 上面那個 `payment_channel`,兩者並存(`20260712203000:46`) |
| `orders.workflow_status` | ⛔ 已停寫 | `20260716120000:75-76` | ⚠️ **不是** §2 那個 `order_items.workflow_status`,是另一欄、另一支 migration 停的 |
| `shipping_free_threshold` / `shipping_home_fee` / `display_position` / `address_id` / `id` / `updated_at` / `version` | ❌ | 結構欄或建單當下決定,無 writer(`display_position` 實查:`grep -rln "display_position" supabase/migrations/` = **1 檔**,只有加欄那支、零 writer) | 無 |

⚠️ **U2「改地址」怎麼辦**:地址在 `shipping_address_snapshot`(快照)與 `address_id` 兩處,
**我沒有查它們誰是出貨時真正被讀的那個** ⇒ 這格標**未確認**,不是「不能改」。

## §2 `order_items` 欄位矩陣(全表 13 欄,`database.types.ts:906-921`)

| 欄 | 能改? | 擋它的是什麼 | 連動 |
|---|---|---|---|
| `quantity` | 🔴 **最難的一格** | §0-3 複合 FK + 摘要表 10 條 CHECK 中的四條地板(`oiqs_ordered_le_quantity` / `oiqs_cancelled_le_quantity` / `oiqs_instock_cancelled_le_quantity` / `oiqs_cancelled_shipped_le_quantity`)| 同交易必須改**兩張表**;改小的下限 = 已訂貨 / 已到貨+已取消 / 已取消+已出貨 三者取大 |
| `unit_price` / `line_total` | ❌ | 🔴 **兩層**:§0-2(無 RPC)**+ 跨欄 CHECK** `20260604120000:149` 逐字 `CONSTRAINT order_items_line_balances CHECK (line_total = unit_price * quantity)`(數法 `grep -rn "line_balances" supabase/migrations/*.sql` = 3 命中、**無 DROP**,另兩條是退款兩表自己的同名約束)。零 FK 牽扯這半仍成立 | ①同交易改 `line_total`,**不能單改單價** ②重算 `orders.subtotal`/`total` ③🔴 **已部分退款的單另有一份快照**:`order_refund_items` 自存 `unit_price`/`quantity`/`line_amount` 且有同型 CHECK(`20260725130100:150-155`)⇒ 改單價會讓退款帳與品項對不上 |
| `variant_id` / `variant_sku` / `product_snapshot` | ❌ | 快照與歸屬;`variant_id` 可為 NULL 是給自由品項用的(`20260604120000:143`)| 改它 = 換一個商品,應該走「刪一列 + 加一列」 |
| `workflow_status` | ⛔ **已停寫** | A9v 撤權,欄凍結不 DROP(`20260807120000:154-160`)| 九碼線已退場 |
| `availability_at_checkout` / `vehicle_snapshot` | ❌ | 快照欄 | 無 |
| `version` / `id` / `order_id` / `updated_at` | ❌ | 結構欄 | 無 |

## §3 「加一列 / 刪一列」

- **加一列**:不撞任何 CHECK(新列的 `ordered/instock/cancelled/shipped` 全為 0)⇒ **結構上最單純**,只需新 RPC + 摘要表同交易插一列。
- **刪一列**:🔴 **不該做 —— 但 2026-08-14 這格的理由整條重寫過,舊理由是錯的。**

  ~~舊理由:「`ON DELETE CASCADE` ⇒ 刪品項會連摘要一起消失,四個數量記錄靜默不見、帳對不起來」~~
  ❌ **那個災難場景走不到。**(C 窗 M1 抓,我自己重跑 grep 逐條複驗成立。)

  **正確的事實**:`REFERENCES order_items` 的 FK 共 **6 條**,數法
  `grep -rn "REFERENCES public.order_items\|REFERENCES order_items" supabase/migrations/*.sql`
  (扣掉 3 行是斷言字串比對、不是 FK 定義)。**其中 5 條是 `ON DELETE RESTRICT`**:

  | FK 所在表 | 檔:行 |
  |---|---|
  | 退款帳 `order_refund_items` | `20260725130100:165` |
  | 採購 `order_item_procurement` | `20260729020000:43` |
  | 取消 `order_cancellation_items` | `20260730130000:238` |
  | 退款 job `order_refund_job_items` | `20260731120000:484` |
  | 出貨 `shipment_items` | `20260805170200:73` |

  **只有摘要那一條是 `CASCADE`**(`20260730150000:93-94`)。
  ⇒ **「已訂貨 / 已到貨 / 已出貨 / 已取消 / 已退款」正是會讓 DELETE 被 RESTRICT 擋死的狀態
  —— DB 大聲報錯,不是靜默。** CASCADE 只在「乾淨品項」時才走得到,而那時摘要四欄全是 0、刪掉本來就對。

  **所以「不該做」的新理由是別的**:①有歷史的品項**根本刪不掉**(5 條 RESTRICT),UI 提供刪除鈕
  = 提供一個必定失敗的操作;②沒歷史的品項刪得掉,但那等於**把客人買過什麼這件事從訂單上抹掉**,
  而取消線是**留著紀錄再加一筆**。⇒ 走 `admin_cancel_order` 的部分取消。
  ⚠️ 「不該做」這個結論**沒有 Sean 拍板背書**,列給他裁。
  🔴 **教訓留在這裡**:舊理由寫的是「靜默壞資料」,而事實是「大聲報錯」——**方向剛好相反**。
  下一個人是照理由決定要不要重看這格的。

## §4 為什麼施工序是「金額 → 品項 → 數量」

🔴 **2026-08-14 重數(C 窗 M2 抓,我複驗成立)**:原本寫「第 1 片撞 1 層」是錯的 ——
`order_items_line_balances` 這條跨欄 CHECK 我上一版漏了,而它**同時影響三片**(改單價、加列、改數量都要維持
`line_total = unit_price * quantity`)。**排序結論不變,但依據的數字全部重算過:**

| 序 | 片 | 撞幾層 | 是哪幾層 |
|---|---|---|---|
| 1 | **改金額** | **2** | ①無 writer(§0-2)②`line_balances` 跨欄 CHECK |
| 2 | **加品項** | **3** | ①無 writer ②`line_balances`(新列也要滿足)③摘要表要同交易插一列 |
| 3 | **改數量** | **4** | ①無 writer ②`line_balances`(改 quantity ⇒ `line_total` 必須跟著改)③複合 FK(§0-3)④四條「改小」地板 CHECK |

⇒ **2 < 3 < 4,排序照舊**,而且改金額仍是**唯一不碰摘要表**的一片
⇒ 它仍是「證明新開一支 `order_items` owner RPC + 樂觀鎖 + 稽核這條路走得通」的最小片。
第 3 片仍是唯一需要**改不變式本身**的:`20260730150000:110-112` 逐字
「正解是**連同 A2 的來源模型一起改不變式,不是繞過它、也不是手填欄位**」。

⚠️ **三片共同的下游**(不算進「層數」,但都要處理):重算 `orders.subtotal`/`total`;
且**已部分退款的單**還有 `order_refund_items` 那份獨立快照會對不上(§2 `unit_price` 那列)。

## §5 誠實缺口

1. **全部未對正式庫查詢。** allowlist 4 鍵、`service_role` 零直寫、複合 FK、10 條 CHECK ——
   **全部來自 repo 內 migration 檔**,只算「repo 這樣寫」。開工前要對 `pg_proc` / `pg_constraint` / `information_schema.column_privileges` 各查一次。
2. ~~§1 只有 11 列、沒逐欄列完~~ 🏁 **已補齊**:35 鍵逐鍵都在 §1 有位置(數法見檔頭,未涵蓋清單為空)。
   ⚠️ **殘餘**:結構欄那一列是**整批帶過**的(`id`/`updated_at`/`version`/`display_position` 等),
   只確認「無 writer」、沒有逐欄追它們各自的約束 ⇒ **有位置 ≠ 查得深。**
3. **`admin_*` RPC 我數到 23 支**,但這是**下限不是總數**:
   數法 `grep -c "^      admin_[a-z_]*: {" database.types.ts` ⇒ **25**,其中 `admin_audit_log`(表,`:221`)
   與 `admin_order_list_v`(view,`:2703`)**不是函式**,扣掉 = 23。
   而 08-14 夜剛 apply 的 `admin_void_item_procurement` **不在這 23 支裡** —— `database.types.ts` 尚未重 gen
   (交接檔已記此事)⇒ **真實 RPC 數 > 23**。
   我只逐支確認了改單、取消、出貨、付款四條線的歸屬,**其餘沒有逐支開檔**
   ⇒ §1「無 writer」那幾格是**基於 allowlist 推論,不是逐支排除**。
4. **地址那格未確認**(§1 末)。
5. **「刪一列走取消線」是我的判斷,無拍板背書。**
6. 🔴 **§4「加一列不撞任何 CHECK」我仍然沒有逐條核摘要表那 10 條 CHECK** —— 我用的是「新列四欄全 0」的直覺。
   C 窗也明說這格它沒背書過。**這是本檔目前最大的未驗格。**
7. **本輪六條 finding 我逐條自己重跑驗過**(M1 的 6 條 FK / M2 的 `line_balances` 3 命中無 DROP /
   M3 的 `20260718120000:137-138` / N1 的 `20260807120000:150-151` 只查 UPDATE+INSERT /
   N3 的 `20260725130100:150-155`),**沒有轉抄 C 窗的理由當背書**。
   但**我沒有再去找 C 窗漏掉的第七條** —— 這一版只保證「它抓到的都修了」,不保證「沒有別的」。
