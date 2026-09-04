# 手動建單「開發票」勾選 +5% —— 施工 spec 與 Q3 plan

> **狀態**:Q1/Q2 已拍可動工;**Q3 是鐵則 8, 本檔下半就是要送 Sean 批的 plan, 未批不得動 schema。**
> **本檔取代**:`docs/launch-todo.md` 的 `⟦b4-INVOICE5PCT⟧` 散在列上的內容(那一列保留為索引, 指到本檔)。
> **鐵則**:12①(錢)⇒ 全 9 步、codex 對抗審查不降級、上限 2 輪。8(schema + RPC 簽章)⇒ Q3 先批。

---

## 1. 拍板逐字(抄 `~/pcm-mailbox/Sean拍板-20260904-七題.md` 檔尾, 不抄轉述)

**規格來源(Sean 2026-09-04 自己提的)**:
> 我們傾向於我輸入單價,然後勾選開發票自己幫我+5 %上去,那如果我沒有勾選開發票價錢都不加

**他的答案(逐字)**:`乙、甲、甲`

**他看到的題目字面(第三版)**:
```
Q1-稅怎麼記:
甲 = 你打的單價直接乘 1.05 存起來。 最省事。
     🔴 而你原本打的那個數字永久消失, 之後沒有任何方法還原。
乙 = 稅額單獨記一欄, 你打的單價原樣保留。 帳做對, 改得回來。
     ⇒ 要改 9 個地方 + 你要再貼一支 SQL。
Q2-運費:
甲 = 勾了開發票, 運費也 +5%
乙 = 只有商品加, 運費不加
Q3-不開發票怎麼記:
甲 = 加一個狀態「決定不開」。 要改資料庫, 我先給你 plan。
乙 = 不記。 不勾就只是價錢不加。
```

🔵 **要記的一格**:Q1 甲那個**單向門**(`ROUND` 不可逆 ⇒ 原始單價永久消失)**寫在他看到的字面裡** ⇒ **他是知道那個代價而選乙的**, 不是沒看到。

🛑 **明確不做**(主視窗 `-94` 轉述的三條):
1. **不動顧客站那條經銷價的路** —— 他說「顧客站買就是經銷價」是**描述現況**, 不是叫我們改它。
2. **不把 `tax_total` 的計算放進 TS** —— 算在 RPC(理由見 §4)。
3. **不把「決定不開」與「還沒開」合成一個值** —— 那正是 Q3 甲要解的東西。

---

## 2. 今天的事實(全部當場量過, 附座標)

| 事實 | 座標 / 讀數 |
|---|---|
| 全 repo **沒有任何一支碼在算稅** | 掃 `tax_total` 與 `taxTotal` ⇒ **4 支**, 四支全是消費者或註解(🟢 正對照 `subtotal` ⇒ **20 支**) |
| 唯一用 `×1.05` 的是**偵測器**不是計算器 | `apps/admin/src/components/orders/manual-order-line-price-check.tsx:102` |
| `tax_total` 今天是**顯式的 0**, 而那是一個**假設** | `supabase/migrations/20260831180000_...spec.sql:444-457`(逐字:「有人送未稅價進來時, `tax_total = 0` 會少收稅」) |
| RPC **沒有任何參數**說得出「要不要開發票」⇒ `CREATE OR REPLACE` 加不了參數 ⇒ **`DROP + CREATE`** | 同檔 `:478-480` |
| `orders.invoice->>'type'` 的 CHECK 只有**三值** | `20260604120000_m3_s2a_orders_order_items.sql:118-124`(正式庫實查 `orders_invoice_whitelist` 逐字相同) |
| `orders.invoice_status` 三值, 而 `not_issued` 是「**還沒開**」不是「**不開**」 | `20260714120000:108` `ADD COLUMN invoice_status text NOT NULL DEFAULT 'not_issued'` |
| 手動建單 RPC **零接觸** `invoice_status` ⇒ 新單走 DEFAULT | `20260831180000` 掃 `invoice_status` ⇒ **0 命中** |
| `orderAmountsBalance` 的判準**不含稅** ⇒ `tax_total > 0` 時必然 false | `packages/use-cases/src/order-email-copy.ts:137` |
| **純文字**信有那道閘, **排版**信**零** | `sweep-email-outbox.ts:432` 有;`paid-email-html.ts` `grep -c` ⇒ **0**(🟢 正對照 sweep = **2**) |
| domain 不變式 `total = subtotal + shippingFee − discountTotal` 有 `throw`, 而**零生產呼叫端** | `packages/domain/src/order/order.ts:340-346`;`createOrder(` 非測試命中 **2 = 1 定義 + 1 註解** ⇒ 呼叫端 **0** |
| 正式庫分母 | 訂單 **1** · 品項 **1** · 採購 **1** · 到貨 **3** · 出貨 **2**(唯讀實查) |

---

## 3. Q2 甲 ⇒ 稅基

**稅基 = 折後小計 + 運費**, 稅 = `ROUND(稅基 × 0.05)`, `total = 稅基 + 稅`。

⚠️ **而【折扣怎麼分攤】Sean 沒答** —— 本片照**最簡單的**做:先算折後小計, 再加運費, 整體 ×5%。
🔴 **這一格要寫進板列當作未拍事項** —— 逐項分攤(每一列各自帶稅)與整單分攤在**有折扣時會差幾塊錢**, 而那個差在開立發票時是真的。
📌 **本片不處理**:免稅品項、代購品項的稅制(`20260831180000:473` 列的那四項, 本片只解掉「應稅運費」那一項)。

---

## 4. 施工順序(九步;**前 4 步與甲案共用, 而甲案已出局**)

```
1  Q3 的落點(migration #1)        ← 要 Sean 先批 plan(本檔 §5), 再由他貼
2  RPC 加參數(DROP + CREATE)      ← 表單要送得出去, 契約得先收得下(migration #2, 他貼)
3  產生型別手動校正 + repository    ← 跟著 RPC 走, 不跟著表單走
4  表單那顆勾選(UI)               ← 前三步沒好, 勾了也送不出去
─────────────── 以下五步的順序由「誰是誰的先決條件」決定 ───────────────
5  paid-email-html.ts 補平衡閘      ← 🔴 必須在 tax_total 有值之前
6  ports + adapter 帶 taxTotal      ← 閘用舊四個數就判得出來, 要【印】才需要這個值
7  🔴 **三份**印稅額 + orderAmountsBalance 加 taxTotal  ← 必須【同一次】
   ⛔ ~~兩份信~~ ⇒ **三份**(主視窗 `-94` 2026-09-04 擴):
     ① `sweep-email-outbox.ts` 純文字信 ② `paid-email-html.ts` 排版信
     ③ `apps/storefront/src/components/print/statement-doc.tsx` **顧客站的列印/PDF**
   🎯 **⇒ 那是【第三份】會兜不攏的東西, 而它不是信** —— 只想「兩份信」會漏掉它,
      而漏掉的那一份**客人是主動去點開的**(會員中心 ⇒ 明細 ⇒ 列印)。

   ### 🔵 2026-09-04 進度:**第 7 步拆成兩顆, 而【拆的理由是避碰不是範圍】**
   · **兩封信那半** —— 判準加 `taxTotal` + 兩份各加一列「稅額」(有稅才印, 位置在折扣之後、訂單金額之前)。
   · 🛑 **`statement-doc` 那半【延後】** —— 主視窗 `-94` 量到 `-mail` 段 3 **正在動同一組五個落點**
     (`MEMBER_ORDER_DETAIL_SELECT` / `SupabaseMemberOrderDetailRow` / `mappers/order.ts` / `MemberOrderDetail`),
     它加 `payment_channel`, 我加 `tax_total` ⇒ 🔴 **同一支 byte-equal 白名單, 兩個窗各加一欄 ⇒ 收割時衝突,**
     **而那支白名單的衝突不是逐列挑能解的。**
     ⇒ ✅ 順序:`-mail` 先落地, 我再**疊上去**(那時 `payment_channel` 已經在, 我只動「加一欄」)。
   ⚠️ **⇒ 所以「三份同一次」這個約束【仍然成立】, 只是它的落點從 commit 移到【第 9 步之前】** ——
     🔴 **第 9 步(RPC 真的算稅)之前, 三份都必須已經在。** 那才是那個約束真正管的東西。

   ### 🔬 而第 7 步查到一件事, 它改變了整片的框架
   **正式庫有 `orders_total_balances`** ⇒ `CHECK (total = subtotal + shipping_fee - discount_total + tax_total)`
   ⇒ 🎯 **一列不平衡的訂單【在 DB 上寫不進去】** ⇒ 📌 **那道平衡閘從來不是在防髒資料。**
   ⇒ 🛑 **而它也【攔不到 renderer 少印一項】**(資料四數照樣平衡)—— 攔那個的是**測試**。
     ⇒ **兩個機制不可互相冒充**:閘守【資料的一致】, 測試守【印出來的東西】。
8  domain 三處不變式字面            ← 可以晚(零生產呼叫端), 而不得省
9  RPC 真的算稅                     ← 🔴 最後一步, 沒有例外
   🔴🔴 **而第 9 步多一道【硬前置】**(codex 對抗審查 R2 指出, 2026-09-04):
      `apps/storefront/src/components/print/statement-doc.tsx` **也只列 小計/運費/折扣/總額**
      (`grep -c orderAmountsBalance` ⇒ **0**)⇒ 稅一開始有值, **會員明細頁與 PDF 會立刻兜不攏**。
      ⇒ **它與第 5 步同一族, 而受詞是【顧客站的列印文件】** —— 第 9 步之前必須補, 不可留到之後。
```

🔴 **5→9 不可分兩次上線。** 理由:第 9 步是**唯一**讓 `tax_total > 0` 的動作, 而在第 5 步之前它一上線 ⇒ **排版那份信照印一張加不起來的帳**, 而客人收到哪一份**由他的收信軟體決定**(`sweep-email-outbox.ts:423` 逐字)。

🔵 **為什麼第 9 步算在 RPC 不算在 TS**:那支 RPC **今天接受任意合法單價**, 算在 TS 的話**下一個呼叫端會走一條沒有乘法的路**, 而**那條路不會紅**。它今天只有一個呼叫端(`procurement-repository.ts` 之外的 `manual-order-repository.ts:291`)⇒ **正是最好加的時機。**

⚠️ **第 6 步那個 `select` 是承重白名單** —— `SupabasePaidEmailContextAdapter.ts:9-10` 逐字:它是白名單**不是**「撈回來再挑」, 因為 `select('*')` 會讓**經銷價到過這個 process**。⇒ **只准加 `tax_total` 一欄, 不准改成 `*`。**

### 驗收(每一步都要, 而這幾格是整片的)
- **四個世界各餵一發**, 印**小計 / 稅 / 總額**三個數:`勾+單價 3800` · `不勾+單價 3800` · `勾+有運費` · `不勾+有運費`
- **兩向突變**:`+5% → +0%` **必須紅**;`沒勾也加` **必須紅**
- 🟢 **而每一道新守門先跑負對照** —— **一個一裝上去就紅的守門, 你分不出是它抓到東西還是它寫錯了**
- **codex 對抗審查不降級**(鐵則 12①), 上限 2 輪

---

## 5. 🔴 Q3 的 plan(**鐵則 8 —— 這一段要 Sean 批, 未批不動**)

**要解的事**:今天「**決定不開發票**」與「**還沒去開**」在 DB 裡**印同一個值**(`invoice_status = 'not_issued'`)
⇒ 值班的人三個月後**答不出來**「這張單當時到底有沒有要開發票」。

### 案 A ── `invoice_status` 加第四個值 `not_required` 🔵 **推薦**
```
ALTER TABLE public.orders DROP CONSTRAINT orders_invoice_status_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_invoice_status_check
  CHECK (invoice_status IN ('not_issued','issued','voided','not_required'));
```
- ✅ **它在【對的軸】上**:`invoice_status` 的語意就是「開票**紀錄**狀態」, 而「決定不開」正是一種紀錄狀態。
- ✅ **舊資料零遷移**:欄位已存在、`NOT NULL DEFAULT 'not_issued'`, 既有列一個都不用動 ⇒ `ADD CONSTRAINT` **不會被既有資料擋住**(正式庫 1 列, 值為 DEFAULT)。
- ✅ **不動 `invoice` jsonb** ⇒ 顧客站結帳那條路**一個字都不用改**(68 處消費端零影響)。
- ⚠️ **代價**:`invoice_status` 有 **43 處**非測試消費端 / 8+ 支檔 ⇒ **每一處顯示標籤要決定第四個值印什麼**(`order-detail-view.ts:15` / `order-list-view.ts:279` 是兩個標籤來源)。
- 🔴 **要一起解的風險**:`invoice_status` 是**可以後改的**, 而 `tax_total` 是**建單當下算的** ⇒ **有人事後把 `not_required` 改成 `issued`, 稅額不會跟著變。** ⇒ **本案必須同片加一道守門或至少一行 `COMMENT`, 說明兩者不同步。**

### 案 B ── `orders.invoice->>'type'` 放寬到四值(加 `none`)
- ✅ 一道 CHECK 改完, 而讀的地方都已經在讀 `type`。
- 🔴 **它在【錯的軸】上**:`invoice` jsonb 的語意是「**客人結帳時的開票需求**」(抬頭/統編/載具), 而手動建單**沒有客人的需求** ⇒ 塞 `none` 進去是**把兩件事混成一欄**。
- 🔴 **爆炸半徑最大**:`invoice.type` 有 **68 處**消費端, **含顧客站**(`CheckoutStep2.tsx` / `validate-checkout-payment.ts`)⇒ 而**明確不做**第 1 條說了不動顧客站。
- ⇒ ⛔ **不建議。**

### 案 C ── 新增一欄 `orders.invoice_required boolean`
- ✅ 語意最乾淨:需求 / 紀錄 / **決定** 三個軸各自獨立。
- 🔴 **多一個要同步的地方**, 而它與 `invoice_status` 的關係**沒有任何約束在管** ⇒ 可以出現 `invoice_required = false` 而 `invoice_status = 'issued'` 的矛盾列。
- ⚠️ 新欄要 `DEFAULT`, 而**任何 DEFAULT 都在替既有 1 列做一個沒有人拍過的決定**。
- ⇒ 🔵 **比案 B 好, 比案 A 貴。**

### ⇒ 推薦:**案 A**
理由三句:①**在對的軸上** ②**零資料遷移、顧客站零影響** ③**代價是可數的**(43 處消費端, 而其中只有 2 處是標籤來源)。
🛑 **而推薦不是拍板** —— **要 Sean 批了才動。**

### ⚠️ 兩件本檔答不出來的(**不要替它們編答案**)
1. **第四個值在畫面上印什麼字** —— 那是文案, Sean 拍。(建議「不開發票」, 而**那是建議**。)
2. **`ADD CONSTRAINT` 在正式庫的鎖時間** —— 1 列, 應可忽略, 而**未實測**。
