# #13 改訂單內容(品項 / 數量 / 金額)— 片級 plan(A 窗夜跑,零行 code)

> **狀態:🔴 我判定這片「還不能拆片開工」,先交一份「開工前要先解決什麼」。** 事實親查於 `pcm-void-readers` @ `0e8c086b`。
> CP 值我排最後,理由不是它不重要,是**它的地基有一條 DB 級的硬約束,不先處理就會在實作到一半才撞上**。

## §1 現況(親查)

- 現行改單表單只有三件事:出貨方式 + 開票狀態 + 發票號碼/金額。
  `apps/admin/src/components/orders/order-edit-form.tsx`(**全檔 102 行**,`wc -l` 實跑),
  `:20-21` 註解逐字「本表單只剩出貨方式+發票紀錄三欄」。走 `admin_update_order_workflow` RPC(`SupabaseOrderAdapter.ts:817`)。
- **樂觀鎖已在**:表單帶 `VERSION_FIELD`(`order-edit-form.tsx:44`),`orders.version` 現成。
- **時間軸載體已在**:`order_notes` 表(`database.types.ts:1032-1042`)有 `note_type` / `occurred_at` / `corrects_note_id`
  ⇒ master plan v2 `:504` 說的「差異寫時間軸」**不一定要新開 event log 表**,這是既有可用的形狀(需確認 `note_type` 值域是否允許新增)。
- **包裹已在**(`shipment_items`)、**收款帳本已在**(`order_payments`)⇒ U2 的兩個硬依賴都到位了。

## §2 🔴 真正的地基問題:改數量會撞 DB

`supabase/migrations/20260730150000_m4b_e10_a1_order_item_summary_columns.sql:75` 逐字:
`ADD CONSTRAINT order_items_id_quantity_key UNIQUE (id, quantity);`
而 `:91` 的 `order_item_quantity_summary_item_fk` 是**複合外鍵 `(order_item_id, quantity)` → `order_items(id, quantity)`**。

⇒ **改 `order_items.quantity` 這一個動作,同一交易內必須同時改摘要表那一列的 `quantity`,否則 FK 直接擋。**
而摘要表上有 **10 條具名 CHECK**(7 條在 `20260730150000:103-124`,3 條在 `20260806100000:134-149`),其中四條會把「改小」擋掉:

| CHECK | 述詞 | 改小數量時的意義 |
|---|---|---|
| `oiqs_ordered_le_quantity` | `ordered_quantity <= quantity` | 已向供應商訂了 3 個,不能把客人的數量改成 2 |
| `oiqs_cancelled_le_quantity` | `cancelled_quantity <= quantity` | 已取消的數量還在,不能把總量改到它以下 |
| `oiqs_instock_cancelled_le_quantity` | `instock + cancelled <= quantity` | 已到貨 + 已取消的總和是地板 |
| `oiqs_cancelled_shipped_le_quantity` | `cancelled + shipped <= quantity` | 已出貨的部分是另一道地板 |

⇒ **「改數量」不是 UI 片,是「這筆單走到哪一步了」的狀態機問題。**
`20260730150000:110-112` 自己寫著逐字警告:「若日後出現…這條會擋住。**正解是連同 A2 的來源模型一起改不變式,不是繞過它、也不是手填欄位。**」

## §3 所以我建議的施工序(不是我拍板,是提案)

| 序 | 片 | 為什麼排這裡 |
|---|---|---|
| **0**(先做) | **docs 片:改單的「可改矩陣」** —— 逐格寫死「單走到 X 狀態時,哪些欄可改 / 哪些鎖死 / 鎖死時畫面顯示什麼原因」。零 code、零 DB | 沒有這張表,後面每一片都會在實作時各自發明規則 |
| **1** | 改**金額**(不動數量):逐品項單價 + 折扣 | 不碰 `quantity` ⇒ **完全避開 §2 的 FK 與 10 條 CHECK**;但仍動錢 |
| **2** | 改**品項**(整列刪 / 加一列) | 加列不撞 CHECK;刪列要先答「已採購 / 已出貨的列能不能刪」(答案應該是不能,走取消線) |
| **3** | 改**數量** | 必須先有 §2 的不變式修法;**這片一定含 migration** |

🔴 **我沒有把 1/2/3 寫成可開工的片級 plan** —— 因為片 0 的可改矩陣還不存在,寫了也是憑空發明規則。

## §4 檔數與鐵則判定

- **片 0(可改矩陣 docs)= 1 檔**(新增一份 spec)。零 code ⇒ **不命中鐵則 8 也不命中 12**,可直接做。估時 30-40 分。
- **片 1(改金額)= 我估 6-7 檔**(migration 1 + repository/action/form 3 + 表單元件 1 + 測試 2)。
  🔴 **命中鐵則 12①錢 + ③schema**(要改 `order_items.unit_price` / `line_total`,而 `orders.subtotal`/`total` 要跟著重算)⇒ 高風險片、關卡2 不降級。
- **片 3(改數量)= 未估**。它的大小取決於 §2 的不變式怎麼改,**現在估任何數字都是編的**。

## §5 驗收條件(只寫片 0,因為只有它現在可開工)

1. 矩陣覆蓋**每一個 `payment_status` × `fulfillment_status` 組合**,不留空格。
   🔴 **空白格不算通過** —— 「什麼都沒寫」會被讀成「檢查過了、沒問題」,這是 08-14 一天出現四次的形狀。
2. 每一格必須寫出三件事:①可改哪些欄 ②鎖死哪些欄 ③鎖死時畫面給員工看什麼原因(不得寫「不可編輯」了事)。
3. 每一條「鎖死」都要附**它是被哪個具名 CHECK / 哪個業務規則擋的**(附 `檔案:行號`);
   找不到擋它的東西 ⇒ 那格其實是**業務約定而非系統保證**,必須明寫成「靠人守」。
4. 矩陣與 §2 的四條 CHECK 逐條對得上(反向盤點:從 CHECK 出發找矩陣格,不是從矩陣找 CHECK)。

## §6 誠實缺口

1. **我沒有對正式庫查任何東西。** §2 的複合 FK 與 10 條 CHECK **全部來自 repo 內的 migration 檔**;
   照今天第 4 條教訓,這只算「repo 這樣寫」,**正式庫實況=未確認**。
2. **「10 條 CHECK」是我數 migration 檔文字數出來的**(`20260730150000` 7 條 + `20260806100000` 3 條),
   **不是對 `pg_constraint` 查的**。若正式庫多一條或少一條,§2 的結論會變。
3. **`order_notes` 能不能當改單時間軸的載體,我沒驗。** 我只看到它有 `note_type` 欄,
   **沒有查它的值域 CHECK 允不允許新增型別** —— 若是寫死的 allowlist,那就要 migration。
4. **U2 的「已裝箱部分鎖定」我沒有查怎麼判「已裝箱」。** `shipment_items` 表在,但我沒讀它與 `order_items` 的關聯與狀態欄。
5. **片 1 的「6-7 檔」是估的,不是數的。** 我沒有把 `orders.subtotal`/`total` 的所有重算路徑找出來
   —— 那會決定它是 6 檔還是 12 檔。**這個數字不可以拿去排工時。**
6. **本檔沒有回答 Medusa `OrderChange` 那條**(master plan v2 `:504` 說「抄逐動作 event log + 版本號」)。
   我看到 `order_notes` 可能夠用,但**沒有比較過兩者**,不宣稱哪個對。
