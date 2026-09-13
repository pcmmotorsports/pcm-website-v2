# Plan · 發票金額月統計 —— `orders.invoice_issued_at` 與那一欄的填寫時機

> **狀態**:🟡 **等 Sean 批。零實作** —— 本檔不含 migration 檔、不含任何 .ts 改動。
> **他自己要的**:Sean 2026-09-13 逐字 **「Q3: 乙 = 按【發票開立】的月份 ⇒ 要加一個欄位(碰資料庫、要先寫計畫)/ 我改成這個」**
> ⇒ 📌 **「要先寫計畫」是他說的**,本檔就是那份計畫(鐵則 8)。
> **規格(設計窗,定案)**:`~/pcm-mailbox/0912-後台UX/規格-發票金額月統計-v3.md` —— 六題他都答了,本檔不重開那六題。
>
> 🛑 **前提,先讀**:發票是**手寫紙本**(二聯 / 三聯),**不串任何外部系統**。
> Sean 2026-09-13 逐字「我們目前是手開發票」。號碼與金額是**開完之後回到後台登記**。
> ⇒ 本檔談的自始至終都是**那個登記動作**,不是任何外部流程。

---

## 0. 一句話

Sean 要看「**我這個月開了多少發票金額**」,而**系統今天記不到發票是哪一天開的**
⇒ 要加一欄。而**這份 plan 的內容是那一欄什麼時候被寫、被誰寫、作廢重開時怎麼動** ——
`ADD COLUMN` 那一行只是結果。

---

## 1. 為什麼(以及兩個數為什麼不能混成一個)

Sean 同一則裡逐字說了:
> **「我的營業額跟我開發票的金額是覺得不一樣的,因為我不會每一筆都開發票」**

⇒ 📌 **這功能的價值就是看得出差多少** ⇒ **兩個數並排 + 印出差額**,不是一個數。

| | 定義 | 出處 |
|---|---|---|
| **這個月開了多少發票** | Σ `orders.invoice_amount`,條件 `invoice_status = 'issued'` **且開立日在該月** | `invoice_amount` 是**員工手打**的(他可能整筆開、也可能只開一部分)⇒ **不是** `orders.total` |
| **這個月的營業額** | Σ (`subtotal` − `discount_total`),扣掉已取消 / 已退款 | Sean Q3 乙:**不含運費**;而**不含稅** ⇒ 不能用 `total` |

### 1-a 為什麼營業額不能用 `total`(帶出處)

```
orders_total_balances 現行定義(20260828100000:278-281 逐字):
  CHECK (total = subtotal + shipping_fee - discount_total + tax_total)
```
⇒ `total` 含**運費**與**稅** ⇒ 兩樣 Sean 都不要 ⇒ 用 `subtotal − discount_total`。

> 🔴 **規格 §1 把這條等式寫對了而【沒有給出處】**,我補上:
> 它**不是**建表時那一版(`20260604120000:112` 是 `total = subtotal + shipping_fee - discount_total`,**沒有 tax_total**),
> 是 `20260828100000` **DROP 之後重加**的那一版。
> ⇒ 📌 **兩個版本的字面只差一個加項,而引錯的人會算錯稅。**

### 1-b 🔴 `subtotal` 含不含稅 —— 一條算式為什麼通吃(而它是**假設不是保證**)

`price_tax_mode` 的 COLUMN COMMENT 逐字(`20260905360000:96-99`):
> 「這張單的 unit_price / subtotal **是含稅還是未稅**。inclusive = 含稅…exclusive = 未稅、稅另計」

規格 §1-a 已用正式庫唯讀實測過:**`inclusive` 的 8 張單 `tax_total` 全為 0**
⇒ 稅為 0 時「含稅 = 未稅」⇒ `subtotal − discount_total` 對兩種單都成立。

🛑 **而那是一個【今天成立的不變式,不是 DB 保證的】** —— 沒有任何 CHECK 擋「inclusive 而 tax_total > 0」。
⇒ **前置閘(見 §5)**:上線前重跑一次;若出現 `inclusive AND tax_total <> 0` 的單,
算式要改成 `subtotal − discount_total − tax_total`,**並回頭問 Sean 那種單是怎麼來的**。

---

## 2. 🔴 主角:那一欄什麼時候被寫、被誰寫

### 2-a 今天的寫入路徑只有一條(我開檔核過)

```
畫面  apps/admin/src/components/orders/order-edit-form.tsx:15-17(import)· :165(渲染)
欄名  apps/admin/src/lib/orders/workflow-form.ts:25-27
      INVOICE_NUMBER_FIELD / INVOICE_AMOUNT_FIELD / INVOICE_STATUS_FIELD
RPC   admin_update_order_workflow(20260714130000)
      · 白名單五欄, 含那三欄(`:73` 逐字)
      · invoice_status **不可 null**、三值(`:38` 逐字)
欄     20260714120000:106-108  invoice_number text NULL / invoice_amount integer NULL
                              / invoice_status text NOT NULL DEFAULT 'not_issued'
CHECK  20260714120000:116  orders_invoice_status_check(三值)
```

🟢 **規格 §5 留的那個問號我答掉了**:**顧客站沒有任何一條路寫 `orders.invoice_status`**。
```
🔬 grep apps/storefront 對 invoice_status ⇒ 1 處命中, 而它是【註解】
   (invoice-visibility.ts:36 一句 2026-08-21 的實查紀錄), 零寫入。
🔬 對 invoiceStatus / invoice_amount ⇒ 0 處。
🔵 正對照:同一把尺掃 apps/admin ⇒ 命中 **6 支檔**
   ⇒ 尺是活的, 上面那個「只有一處而且是註解」不是尺瞎了。
```
⚠️ **而 `record_pending_invoice()` 不是反例** —— 它在刷卡成交點寫的是 **`pending_invoices` 那張表**
(`PaymentConfirmerAdapter.ts:168`),**不碰 `orders.invoice_status`**。
⇒ 📌 **兩件事同名不同表**,不要合起來讀。

### 2-b 🟢 開立日期【員工手填】(Sean Q1 乙),而理由要跟著走

他是**事後補登記**的(逐字「開完之後回來登記」)
⇒ 自動蓋時間戳記的是**按鍵那天**不是**開票那天**
⇒ 一張 9/28 開、10/2 才登記的發票,自動蓋會算進 10 月。
🛑 **所以這一欄不可以用 `DEFAULT now()`,也不可以由 trigger 蓋。** 它是**員工打的一個事實**。

### 2-c 必填,而必填擋在三層(各做各的)

| 層 | 做什麼 | 為什麼要在這一層 |
|---|---|---|
| **表單** | 按確認之前就不讓他過 | 最快的回饋,不用等一趟來回 |
| **RPC** | `invoice_status → 'issued'` 而日期是 NULL ⇒ RAISE | 表單擋不住直接打 API 的路 |
| **DB CHECK** | `CHECK (invoice_status <> 'issued' OR invoice_issued_at IS NOT NULL)` | 最後一道,**擋任何 writer** |

🔴 **三層不是重複** —— 少了 DB 那層,一個未來新增的 writer(或一次手動 SQL)就能造出
「已開立而沒有日期」的列,**而統計會安靜地少算它**。

#### 2-c-i 🔴 「必填」≠「不能改」
Sean Q6 答**每次覆蓋** ⇒ **他改得了**。兩件不衝突:
**必填** = 按「已開立」時不能留空;**可改** = 之後還能換成新的。
📌 **寫在這裡是因為下一個人會把「必填」讀成「寫死不准動」** —— 那會讓他去加一道不該有的鎖。

### 2-d 🟢 作廢重開:每次覆蓋成新的(Sean Q6 甲),而它的後果要印在畫面上

```
一張 9/28 開的發票, 10 月被作廢又重開、日期填 10/5
⇒ 9 月的統計【少一筆】、10 月【多一筆】
```
⇒ 📌 **那是對的**(Q2 甲:作廢的不算、重開才算),
**而它意味著他上個月看過的數字,這個月再看會不一樣。**

🟢 **Sean 2026-09-13 答甲定案:那一句要印。** 統計頁**常駐一行灰字**:
> **發票作廢重開會讓過去月份的數字跟著變**

🛑 **常駐** —— 不是彈窗、不是滑過去才出現。

**舊值不消失**:覆蓋走既有 `admin_audit_log`,`before` 存完整值(含舊的 `invoice_issued_at`)
⇒ **舊日期留在稽核裡,不為它加第二欄。**

### 2-e 🛑 紙本作廢的實務,與系統記得到的範圍(照實寫,不設計假的追蹤)

紙本作廢的實務是**把整份(存根 + 收執)收回來、蓋作廢章**。
而系統這一側**只有一個狀態值** `voided` ⇒ 📌 **系統記不到那張紙有沒有真的收回來。**

⇒ 🔴 **這是紀錄範圍的限制,不是文案問題,也不要用一個勾選框假裝解決它。**
一個「已收回」的勾,只證明有人勾了它。
⇒ ✅ 本 plan 的處置:**不做**。把這句寫進 plan 與欄位 COMMENT,讓下一個人知道那個邊界在哪。

---

## 3. 改什麼

### P1 · schema(碰 DB ⇒ 本 plan 要批的就是這一段)
```
ALTER TABLE public.orders
  ADD COLUMN invoice_issued_at timestamptz;          -- NULL, 無 DEFAULT

ALTER TABLE public.orders
  ADD CONSTRAINT orders_invoice_issued_at_required
  CHECK (invoice_status <> 'issued' OR invoice_issued_at IS NOT NULL);
```
**COLUMN COMMENT 要寫的三件**:① 它是**員工手填的開票日**,不是登記時間;
② 作廢重開會覆蓋,舊值在 `admin_audit_log`;③ §2-e 那個邊界。

### P2 · 登記那一格
`order-edit-form.tsx` 多一格「開立日期」(預設今天)+ RPC 白名單加一欄 + RPC 範圍檢查。
**範圍檢查兩條**:不得是**未來**、不得**早於** `orders.created_at`。

### P3 · 統計
兩個數並排 + 差額 + 常駐灰字(§2-d)+ **「另有 X 張已開立而沒填開立日期,不計入」**。
🔴 **那一行不是裝飾**:它把「員工忘了填」從一個看不見的漏,變成畫面上的一個數。
⚠️ 而 §3 那道 DB CHECK 落地之後,這個 X **理論上恆為 0**
⇒ 📌 **它仍然要印** —— 一個恆為 0 的計數,是那道 CHECK 還活著的**唯一可見證據**;
它哪天不是 0,就是有人把 CHECK 拿掉了。

### P4 · 權限那片 **取消**
Sean Q4 逐字「**都看得到**」⇒ 不分權限、不拆兩個數。
⚠️ **照逐字,不擴大解釋** —— 「都看得到」指**兩個數對兩種人都可見**,
**不代表**這一頁不用登入、或可以對外公開。

### 放哪
建議側欄「總覽」那一頁多一塊(它已經是「今日對帳三卡」那種形狀),不另開一頁。
⚠️ 他要獨立一頁的話,拍(§7 有題)。

### 三句擋下來的訊息
規格 §2-a-iii 已經按 Sean 的四條原則寫好並經他拍板(兩段,不升三段),本 plan **照抄不重寫**。

> 🔴 **而規格引的行號要更正**:四條原則的原文在
> `~/pcm-ops/docs/specs/2026-09-13-mixed-rail-cancel-block-copy.md`
> **`:10`(標題)+ `:18-33`(內文)** —— ⛔ ~~規格寫的 `:16-33`~~ 差兩行
> (`:16` 是 `② 三段式結構` 那一行,不是開頭)。**我逐行數過。**
> ⚠️ 那支檔**還在未推的 commit 裡** ⇒ `origin/dev` 找不到,要看在本機 `~/pcm-ops`。

---

## 4. 影響

| | |
|---|---|
| **既有資料** | 🟢 **零回填**。規格 §0 正式庫唯讀實測:`issued` **0 張**、`voided` **0 張**、`not_issued` 9 張(全庫共 9 張單)⇒ 那道 CHECK 加下去驗不到任何一列 |
| **`ADD CONSTRAINT` 會鎖表全表驗證** | 屬鐵則 12③ 那一類。今天 9 列 ⇒ 瞬間。⚠️ 仍要帶 `SET LOCAL lock_timeout`(同 `20260828100000:277` 的警語) |
| **既有寫入路徑** | 只有一條(§2-a)⇒ 改動面收斂。顧客站**零寫入**,不必動 |
| **`invoice_requested = false` 那道閘** | `20260904224500` 已經擋「不開發票的單不得改 issued」⇒ **本 plan 與它不衝突**,新 CHECK 是另一個維度(有 issued ⇒ 要有日期) |
| **統計的數** | 🔴 **它會隨作廢重開而改變過去月份** —— 那是設計,而畫面上那行灰字是它唯一的告知 |
| **PII** | 一個日期,零 PII |

---

## 5. 🔴 前置閘(apply 前**當天**重跑,不可引用本檔的舊讀數)

```sql
-- ① CHECK 加得下去嗎(不為 0 就【不要 apply】, 那道 CHECK 會擋死 migration)
SELECT count(*) FROM public.orders
 WHERE invoice_status = 'issued' AND invoice_issued_at IS NULL;   -- 期望 0

-- ② 營業額那條算式還成立嗎(§1-b 那個假設)
SELECT count(*) FROM public.orders
 WHERE price_tax_mode = 'inclusive' AND tax_total <> 0;           -- 期望 0
```
🔬 **兩發都要配一個會動的負對照**(例如把 `= 0` 改成 `<> 0` 看它回非零)——
**沒有正向對照的 0,與「這條查詢恆回 0」在觀察上不可分辨。**
🛑 而 §0 那些數字**是 2026-09-13 的**:實作落地前若已經有人開始登記發票,**那些 0 就過期了**。

---

## 6. Rollback

```
P3 統計頁     ⇒ 拿掉那一塊。零資料影響。
P2 那一格     ⇒ 表單與 RPC 白名單退掉那一欄。零資料影響。
P1 CHECK      ⇒ ALTER TABLE public.orders DROP CONSTRAINT orders_invoice_issued_at_required;
                🟢 可逆、不丟資料。
P1 欄位       ⇒ ⛔ DROP COLUMN invoice_issued_at  ← **會丟資料**(員工填過的開票日就沒了)
                ✅ 正確的回退單位是【碼】:讓畫面與 RPC 不再碰它, 欄留著。
🔴 順序:退 CHECK 要在退欄之前;而**退碼之前不要先退 CHECK** ——
   CHECK 先走 ⇒ 表單還在寫 ⇒ 中間那段可以造出「已開立而沒日期」的列。
```

---

## 7. 要 Sean 拍的

```
Q-批: 照本檔做嗎(加一欄 invoice_issued_at + 一道 CHECK + 登記多一格 + 統計頁)?
A: 甲 = 批, 照 P1→P2→P3 做
   乙 = 先只做 P1 + P2(把日期記起來), P3 統計頁晚一點
   🔵 推薦甲 —— P1+P2 沒有 P3 的話, 他要的那個數字還是看不到, 而那正是他開口要的東西。

Q-位置: 統計放哪?
A: 甲 = 側欄「總覽」那一頁多一塊(與「今日對帳三卡」同一頁)
   乙 = 獨立一頁
   🔵 推薦甲 —— 它是每個月看一次的東西, 不值得一個入口。

Q-時序: 什麼時候做?
A: 甲 = 排在訂單列表改版之後(不搶同一批檔)
   乙 = 現在
   🔵 推薦甲 —— P2 要動 `order-edit-form.tsx`, 而訂單列表改版正在改同一區。
      兩條線同時改同一支檔會互相蓋掉。
```

---

## 8. 🛑 這支 plan 證不到什麼

- **`invoice_amount` 的實際填法沒有樣本** —— 今天 **0 張**有值
  ⇒ 「他會整筆開還是部分開」我不知道,而那會影響「開票金額 vs 營業額」那個差額怎麼被解讀。
  ⇒ 📌 **上線後第一個月要回來看一次真實資料**,不要現在替他決定。
- **§0 與 §1-b 的所有數字都是 2026-09-13 的正式庫唯讀讀數**,由設計窗跑
  ⇒ 本檔**沒有自己重跑**(標【他窗實查】)⇒ §5 那兩發前置閘就是補這一格的動作。
- **它不處理紙本作廢的實體流程**(§2-e)—— 系統記不到那張紙收回來了沒,而本 plan 不假裝記得到。
- **它不改任何既有的稅或金額算式**;§1-b 若前置閘紅了,那是**另一題要端 Sean**,不是在這片改。
