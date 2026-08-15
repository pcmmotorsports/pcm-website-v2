# `#13` 改單「可改矩陣」— **片 0b:品項層**(這一列的哪個欄位能不能改)

> **片型**:輕量片(純 docs、零 code、零 DB、不命中鐵則 8/12)。主視窗 2026-08-15 授權。
> **上游**:片 0a `docs/specs/2026-08-15-e10-13-order-edit-matrix-order-level.md`(訂單層,能不能進編輯)。
> **作者**:A 窗 `void-readers`。**每個 `檔案:行號` 都是我開檔查的。**
> 🔴 **本檔才是真正回答「哪個欄位能不能改」的那一份。** 0a 只答「這張單能不能進編輯」,
> 而 0a §7-4 自己寫著:**只讀 0a 會以為「反正都能改」—— 那是錯的。**

---

## §0 🔴 本檔什麼時候會過期

| 觸發事件 | 為什麼會讓本檔變假 | 怎麼發現 |
|---|---|---|
| **`oiqs_*` 約束增減或述詞改** | 本檔整張表建立在它們的字面上 | `grep -rhoE 'oiqs_[a-z_]+' supabase/migrations/*.sql \| sort -u \| wc -l`(2026-08-15 = **10**) |
| **開放直送**(`shipped ⊄ instock`) | `20260806100000:179` COMMENT 逐字:C6′ 屆時「**升級成承重約束**」⇒ §2 的「三條獨立」變四條 | 同上 COMMENT |
| **`quantity` 變成可編** | 本檔現在是「盤點誰擋著」;那一刻起它變成「實作要滿足什麼」 | `grep -cE "name=\{[A-Z_]+_FIELD\}" apps/admin/src/components/orders/order-edit-form.tsx`(現 **4**) |
| **稽核白名單加欄** | §4 的 must 會多一格要驗 | `grep -n "jsonb_build_object" supabase/migrations/20260714130000_*.sql` |

⚠️ **與 0a 同**:上面每條都是**世界的狀態**,改了不會有任何 diff 提醒你。

---

## §1 資料模型:為什麼「改數量」不是改一個欄位

```
order_items(id, quantity, …)
   ▲ 複合唯一鍵  20260730150000:75  ADD CONSTRAINT order_items_id_quantity_key UNIQUE (id, quantity)
   │
   └── order_item_quantity_summary(order_item_id, quantity, ordered/instock/cancelled/shipped)
       複合外鍵  20260730150000:91  (order_item_id, quantity) → order_items(id, quantity)
```
⇒ **改 `order_items.quantity` 這一個動作,同一交易內必須同時改摘要表那一列的 `quantity`,否則 FK 直接擋。**
🔴 **這不是「順便要更新一下」,是資料庫層的硬綁定** —— 兩邊的 `quantity` **物理上不可能不一致**。

---

## §2 🔴 四條地板 —— **其中一條物理上不會單獨觸發,實為三條**

**舊 plan §2 與我自己在 `A-054` 都寫「四條地板」。複驗後要更正。**

| # | 約束 | 述詞(逐字) | 改小 `quantity` 時的意義 | 獨立性 |
|---|---|---|---|---|
| **F1** | `oiqs_ordered_le_quantity` | `CHECK ((ordered_quantity <= quantity))` | 已向供應商訂了 3 個 ⇒ **不能把客人的數量改成 2** | ✅ 獨立 |
| **F2** | `oiqs_cancelled_le_quantity` | `CHECK ((cancelled_quantity <= quantity))` | 已取消的數量還在 ⇒ **不能把總量改到它以下** | ✅ 獨立 |
| **F3** | `oiqs_instock_cancelled_le_quantity` | `CHECK (instock + cancelled <= quantity)` | 已到貨 + 已取消的總和是地板 | ✅ 獨立 |
| **F4** | `oiqs_cancelled_shipped_le_quantity` | `CHECK ((cancelled + shipped) <= quantity)` | 已取消 + 已出貨 | 🟡 **冗餘** |

🔴 **F4 的 COMMENT `20260806100000:179` 逐字**:
> **「🟡 代數冗餘:C9(`shipped <= instock`)∧ C7(`instock + cancelled <= quantity`)在非負整數上逐點蘊含本條
> ⇒ 本條**物理上無法單獨觸發**,不宣稱行為獨立性、不要求獨立負測。」**

⇒ **實際會擋住你的是 F1 / F2 / F3 三條。**
⚠️ **F4 不是可以刪** —— 同 COMMENT 逐字:「**若日後開放直送(`shipped ⊄ instock`),本條會升級成承重約束**」。
⇒ **F4 是一條「現在睡著、開放直送那天會醒」的約束。**
🔴 **這正是「負測構造不出來 = 先懷疑那條守門是 no-op」的反例** ——
它構造不出獨立負測**不是因為它是 no-op**,是因為**它被更嚴的兩條蘊含**。差別要講清楚,否則下一個人會想刪掉它。

### 2-1 另外三條非負約束(F5-F7)

`oiqs_ordered_nonneg` / `oiqs_instock_nonneg` / `oiqs_cancelled_nonneg` / `oiqs_shipped_nonneg`
—— 這四條擋的是**摘要表自己被寫壞**,不是擋改單。**與本片無關,列出來只為說明「10 條」的組成**:
`F1-F4` + 四條 nonneg + `oiqs_instock_le_ordered` + `oiqs_shipped_le_instock` = **10**(去重實測)。

---

## §3 品項層可改矩陣

**列 = 這一品項走到哪(由摘要表四個量決定)· 欄 = 想改什麼。**
🔴 **注意:三個目標欄位目前一個都不存在**(spec `2026-07-25-admin-backend-rebuild-spec.md:153`)⇒
本表寫的是**「做出來之後會被什麼擋」**,不是現況能不能按。

| 這一品項的狀態 | 改**單價/金額** | 改**數量**(改小) | 改**數量**(改大) | 刪**整列品項** |
|---|---|---|---|---|
| `ordered = instock = cancelled = shipped = 0`(還沒訂) | ✅ 無 DB 阻擋 | ✅ 無 DB 阻擋(地板都是 0) | ✅ 無 DB 阻擋 | ✅ 無 DB 阻擋 |
| `ordered > 0`(已跟供應商下單) | ✅ 無 DB 阻擋 | 🔴 **F1 擋**:不得低於 `ordered_quantity` | ✅ | ⚠️ 見 §3-2 |
| `instock > 0`(已到貨) | ✅ 無 DB 阻擋 | 🔴 **F3 擋**:不得低於 `instock + cancelled` | ✅ | ⚠️ 見 §3-2 |
| `cancelled > 0`(已取消部分) | ✅ 無 DB 阻擋 | 🔴 **F2 + F3 擋** | ✅ | ⚠️ 見 §3-2 |
| `shipped > 0`(已出貨) | ✅ 無 DB 阻擋 | 🔴 **F3 擋**(經 `shipped <= instock` ⇒ `instock > 0`) | ✅ | ⚠️ 見 §3-2 |

### 3-1 🔴🔴 **本節於 2026-08-15 16:5x 更正 —— 原文是錯的,而且錯在我宣稱掃過的範圍**

⚠️ ~~**「改金額」整欄沒有任何 DB 阻擋。四個 `oiqs_*` 地板全部只管「數量」。對 `order_items.unit_price` /
`line_total` / `orders.total` **沒有任何一條 CHECK、沒有任何 FK**。⇒ 改金額目前是全裸的。**~~
**← 作廢。觸發 = 寫片 1 plan 時去查金額欄結構,當場撞到兩條我漏掉的 CHECK。**

🔴 **錯在哪(不是「沒查」,是「宣稱查了但沒查到」)**:
本檔 §6-1 逐字寫著「**我掃的是 `oiqs_*` 與 `order_items` 的 CHECK/FK**」——
**而 `order_items` 上就有一條金額 CHECK,我沒掃到。**
⇒ **這是「宣稱的作用域 > 實際查過的範圍」,發生在我自己那份已 commit 的盤點檔裡。**

### 3-1a ✅ 更正後的事實:**有兩條「列內平衡」CHECK,但跨列那條不存在**

```
20260604120000:149  CONSTRAINT order_items_line_balances
                      CHECK (line_total = unit_price * quantity)
20260604120000:112  CONSTRAINT orders_total_balances
                      CHECK (total = subtotal + shipping_fee - discount_total)
```
⇒ **改單價不能只改單價** —— `line_total` 必須同交易跟著改,否則 CHECK 直接擋。
⇒ **改 `subtotal` 不能只改 subtotal** —— `total` 必須同時滿足那條等式。

### 3-1b 🔴🔴 **而真正的洞在跨列,那條 migration 自己寫得很清楚**

`20260604120000:172-174` 逐字:
> **「codex k2 WARN-3:跨表不變式 `orders.subtotal = Σ(order_items.line_total)` 為 DB CHECK 無法表達(跨 row);
> 由 `create_order` RPC **單一寫入者**保證(RPC 自算 subtotal、authenticated 無直接 INSERT)
> + S2-b 交易測試覆蓋 subtotal/items 不一致情境。**不加 deferrable trigger**(RPC 權威已足、避免複雜度)。」**

🔴🔴 **這句話是片 1 的核心風險,而且是寫在 DDL 裡的原文,不是我的推論**:
**「`orders.subtotal` 等於各列 `line_total` 的總和」這件事,DB 擋不住,靠的是「只有一個寫入者」。**
⇒ **片 1 要做的事,定義上就是加入第二個寫入者。**
⇒ **那個保證在片 1 落地的那一刻消失,而 DB 不會有任何反應** ——
   兩條列內 CHECK 照樣過(它們只看同一列),而 `subtotal` 與各列的和可以差任意金額。

**⇒ 片 1 的第一驗收條件不是「改得動」,是「改完之後那條跨列不變式仍然成立,而且有東西會在它不成立時紅」。**
⚠️ 原 migration 明寫「**不加 deferrable trigger**(RPC 權威已足)」——
**那個「已足」的前提正是單一寫入者。前提在片 1 消失,所以那個決定要重新評估,不能照抄。**

### 3-1c 更正後,0a 那句還成不成立?

**0a §3 的結論(訂單層兩層都沒擋)不受影響** —— 那講的是「這張單能不能進編輯」,與金額 CHECK 無關。
🔴 **但我在 `A-055` 對你講的「兩層加起來 ⇒ 改金額目前是全裸的」要收回**:
**列內有守、跨列沒守。「全裸」是錯的措辭,而「有守」也是錯的措辭。**
**準確講法**:**擋得住「一列自己算錯」,擋不住「各列加起來與訂單總額對不上」。**

### 3-2 「刪整列品項」我答不出來 —— **而答不出來本身是結論**

舊 plan §3 片 2 逐字寫著:「**刪列要先答『已採購 / 已出貨的列能不能刪』(答案應該是不能,走取消線)**」。
🔴 **我查不到任何 DB 層的阻擋**:`order_items` 沒有「不得刪除已出貨列」的約束,
而摘要表對 `order_items` 的 FK 只綁 `(id, quantity)`,**刪掉父列的行為取決於 FK 的 `ON DELETE` 子句,我沒查**。
⇒ **列為 §6 誠實缺口,不填一個猜的答案進表。**

---

## §4 稽核覆蓋(與 0a §4 同一條,**不重寫全文**)

**主載體 = 0a §4。** 這裡只放本片相關的一句:
🔴 **`before`/`after` 是欄位級白名單(`20260714130000:222` 逐字「僅本片 5 欄」)。**
**`quantity` / `unit_price` 都不在那五欄裡** ⇒ **做出來之後若沒同時改 `jsonb_build_object`,
改價改量不會進操作紀錄,而且不會有任何東西紅。**

**must(主視窗升級)**:每加一個可編欄位,必須有一格測試證明它出現在 `after` 裡(突變:拿掉該欄 ⇒ 紅)。

---

## §5 🔴 一條順手抓到的過期字面 —— **而它住在已 apply 的 migration 裡,不能改**

`20260806100000_m4b_e10_b2_s2a_summary_shipped_quantity.sql` 兩處逐字:
```
:21   🔴 **本片只挖格子、不接線**:欄加完一律是欄預設 0
      —— A4a 重算不算第四軸、repo 內沒有任何路徑會寫它。
:189  🔴 **強制鏈要 S2b 上線才閉合** … 在 S2b 把本欄聚合進第四軸之前，
      **沒有任何 writer 會把真實出貨量搬過去**
```
**兩句在寫的當下為真,現在為假**:
```
S2b 已上線 → 20260806180000_m4b_e10_b2_s2b_shipped_recompute_wire.sql
             （同日稍晚；含 2 處 shipped_quantity 的寫入）
```
⚠️ **這對 0a 有連帶**:若 `shipped_quantity` 真的永遠是 0,貨品軸就永遠到不了 `shipped`
⇒ **0a 矩陣的 #4 / #8 兩格會是不可達的死格。** ✅ **實查結果是「可達」,那兩格有效。**

🔴 **這兩句我不能改** —— 已 apply 的 migration 連註解都不能動
(`APPLIED.tsv` 釘 sha256;`docs/runbooks/night-run-command-playbook.md:85`,今天早上我親自撞過一次)。
⇒ **正確處置就是寫在這裡**,並在下次有人引用 `:21`/`:189` 時擋住他。
**這是「更正要寫進下一個人會讀的載體」,而那個載體不一定是原檔。**

---

## §6 誠實缺口

1. 🔴🔴 ~~「改金額零阻擋」…我掃的是 `oiqs_*` 與 `order_items` 的 CHECK/FK~~
   **← 這條本身就是實例:我寫「掃了 `order_items` 的 CHECK」,而 `order_items_line_balances` 就在那裡,我沒掃到。**
   **⇒ 一條誠實缺口寫得再誠實,也擋不住它宣稱的範圍大於實際做過的事。** 更正見 §3-1。
   **仍然成立的部分**:**沒查 trigger、沒查 RLS、沒查 `orders.total` 有沒有重算 trigger** ——
   ⇒ 措辭仍是「**我查過的那幾層**」,而現在那個「幾層」比我原本寫的還小。

   🔴 **修法(機械,不是「更小心」)**:**寫「我掃的是 X」時,把跑過的那條命令原樣貼上,不要貼範圍的描述** ——
   **描述可以跟命令不一致,而沒有人看得出來。** 照辦,本檔這一輪實際跑的是:
   ```bash
   # 金額欄的具名 CHECK（這條就是上面漏掉那兩條的來源）
   grep -rhoE 'CONSTRAINT [a-z_]+ CHECK' supabase/migrations/20260604120000_m3_s2a_orders_order_items.sql | sort -u
   #   → order_items_line_balances / order_items_snapshot_whitelist / orders_display_id_format
   #     orders_invoice_whitelist / orders_ship_addr_whitelist / orders_total_balances   （6 條）

   # 摘要表的地板（§2 那張表的來源）
   grep -rhoE 'oiqs_[a-z_]+' supabase/migrations/*.sql | sort -u | wc -l      # → 10
   ```
   ⚠️ **仍未跑的、因此仍未知**:`pg_trigger` / RLS policy / 對正式庫的 `pg_constraint` 核對。
   **這三項沒有對應命令貼在這裡,所以它們就是沒查。**
2. **§3-2「刪整列」我沒查 FK 的 `ON DELETE` 子句** ⇒ 那一欄整欄是空的,**而空白不是通過**。
3. **四條地板的述詞來自 migration 檔字面,不是對 `pg_constraint` 查的**(承 0a、承舊 plan,三份都掛同一條)。
   🔴 **主視窗有正式庫唯讀授權** ⇒ §7 附了要它跑的 SQL。
4. **本檔沒有處理「改數量時摘要表那一列怎麼同步改」的實作**(§1 只講了必須同步)。
   那是片 3 的事,**而片 3 的大小取決於這件怎麼做**。
5. **`partiallyPaid` 那條(0a `Q-13-1`)在本層沒有對應** —— 品項層看不到收款狀態。
   ⇒ **兩層要一起看才完整,單看任一層都會漏。**

---

## §7 要主視窗代跑的正式庫查詢(**我沒有授權,不自己跑**)

**目的**:把上面三份文件共同掛著的「repo 這樣寫 vs DB 這樣答」那條缺口關掉。

```sql
-- ① 十條 oiqs_* 約束在正式庫真的存在嗎、述詞一樣嗎（對應 §2 / §6-3）
select conname, pg_get_constraintdef(oid) as def
  from pg_constraint
 where conrelid = 'public.order_item_quantity_summary'::regclass
 order by conname;

-- ② 複合外鍵與複合唯一鍵還在嗎（對應 §1）
select conname, pg_get_constraintdef(oid)
  from pg_constraint
 where conrelid in ('public.order_items'::regclass,
                    'public.order_item_quantity_summary'::regclass)
   and contype in ('f','u')
 order by conname;

-- ③ 0a Q-13-1 的急迫度：正式庫真的零筆嗎（order-status-axes.ts:183 那句繼承來的宣稱）
select payment_status, count(*)
  from public.orders
 group by payment_status
 order by 2 desc;
```
**預期**:① 十條、述詞與 §2 逐字相同 ② 兩條都在 ③ `partiallyPaid` / `partiallyRefunded` 是否真的為 0。

### ✅ ③ 已跑(2026-08-15 13:1x · 主視窗 · 正式庫唯讀)
```
unpaid 6 / paid 4 / refunded 3 / partiallyPaid 0 / partiallyRefunded 0   （總計 13 筆）
```
⇒ **零筆屬實** ⇒ `Q-13-1` 維持「片 1 開工前要答」,**不升級**。
🔴 **但那是快照不是保證,而且 13 筆是測試資料**(Sean 自述「訂單都是假的」)⇒ **不得據以推論營運分布。**

### ⏳ ①② 刻意不代跑(主視窗裁定)
**理由逐字**:「**它們是驗你 0b 寫的內容對不對,而那屬於審查該做的事,不是我代跑。**」
⇒ **這兩條留給審查本片的人**(E 或 codex),**本檔的 §2/§6-3 那條缺口在他跑完之前仍然掛著。**
⚠️ **不要因為 ③ 跑了就以為整節關掉了** —— **③ 關的是 `Q-13-1` 的急迫度,不是「repo 字面 vs DB 實況」那條。**
