# 應付餘額 `balanceDue` — 會員訂單明細(⟦b4-PARTIALPAIDNOWHERE⟧)

> 線 `-f3` · 2026-09-05 · **plan 階段, 一行碼都沒動**
> 觸發:Sean 拍「匯款結帳上線前做完」⇒ 這一列從 backlog 變成**上線前置**。
> 片型:**高風險片**(鐵則 12 ①錢 · ②權限)⇒ codex 關卡 1 一輪。
> 鐵則 8:跨 3+ 檔 + 動 DB 物件 ⇒ **本檔就是那份要批准的 plan**。

---

## 0 · 一句白話(給 Sean 批用)

> **現在只收了訂金的客人,打開訂單看不到「還要匯多少」——**
> **我們要在那一頁補一個「應付餘額」,而它要算對:訂單金額減掉已經收到的錢。**

---

## 1 · 要改什麼

| # | 檔 | 改什麼 |
|---|---|---|
| ① | **新 migration**(版本號 `330000`,主視窗今晚配給 front) | 開一支**窄 view**,讓「客人自己」讀得到自己那張單的已收金額 |
| ② | `packages/domain/src/order/types.ts` | `MemberOrderDetail` 加 `balanceDue: Money`  ⚠️ 型別叫 **`Money`** 不是 `MoneyAmount`(`MoneyAmount` 全檔 **0** 命中;`total: Money` 在 `:1914`) |
| ③ | `packages/adapters/src/supabase/SupabaseOrderAdapter.ts` + `mappers/order.ts` | 查詢帶上新 view、mapper 映射 |
| ④ | `apps/storefront/src/components/account/OrderDetailView.tsx` | 匯款區塊的顯示條件與金額改用 `balanceDue` |
| ⑤ | 對應四支 test | 補格 |

---

## 2 · 為什麼 —— 而**這一節有一個會讓修法自己變成 bug 的發現**

### 2.1 今天的洞(板列原文)
匯款區塊的顯示條件是**精確** `paymentStatus === 'unpaid'`,而 `partiallyPaid`(已收訂金)被**刻意擋在外面** ——
理由寫在 `OrderDetailView.tsx:575-579` 逐字:印 `order.total` 會**叫客人再匯一次全額**。
⇒ 代價(該檔 `:601-602` 自己寫著):**那個客人看不到尾款要匯去哪**。

### 2.2 🔴🔴 **最重要的發現:天真的做法會【安靜地】把全額印給已付訂金的人**

```
order_payments        零 GRANT                (20260810100000)
order_paid_totals_v   只 GRANT SELECT 給 service_role
                                              (20260823030000 的 COMMENT 逐字)
會員明細那條路        跑的是 authenticated
                      (apps/storefront/src/lib/auth/composition.ts:83 逐字
                       「本檔永不注入 service_role」)
```
🛑 **⇒ 客人的身分讀 `order_paid_totals_v` 讀不到東西, 而 PostgREST 回的是【空】不是【錯】。**
⇒ `paid_total` 變成 `0` ⇒ `balanceDue = total − 0 = total`
⇒ 🎯 **我們會對一個已經付了訂金的人印出全額** —— **正是這一列存在要修的那個 bug。**
⇒ 📌 **而它三綠全綠、型別全對、畫面看起來完全正常。**

### 2.3 🔴 公式要訂正兩處(交辦時的口徑與 schema 對不上)

| 交辦寫的 | 實際 | 依據 |
|---|---|---|
| 「order_payments **confirmed** 之和」 | `order_payments` **沒有 status/confirmed 欄** | 建表 `20260810100000:180-260` |
| 「再減**已退款**」 | `paid_total` **不含退款** —— 退款在**另一張表** `order_refunds` | `20260820010000:41-50` 逐字「為什麼【不是】記進 order_payments」 |

🔵 而 `order_payments` 裡確實有負數列 —— 那是**沖銷**(登錄錯了的更正),**不是退款**。
`paid_total = SUM(amount)` 已經把沖銷抵掉(`20260810100000:196` 逐字「P(+500)+R1(-500)+R2(+500) = 500」)。
⇒ **✅ 訂正後的公式**:
```
balanceDue = total − ( paid_total − 已 confirmed 的退款 )
                       └ order_payments ┘  └ order_refunds.status='confirmed' ┘
                                              (值域 processing|confirmed|failed,
                                               20260725130100:96)
```
⚠️ **`processing` 的退款算不算,是一題** —— 見 §5 決策題 Q2。

---

## 3 · 怎麼做(推薦案)

### 甲案(推薦)· 開一支**窄 view**,照 `order_paid_totals_v` 已經驗過的三明治打法
```sql
CREATE VIEW public.member_order_balance_v
  WITH (security_invoker = false) AS      -- 用 view 擁有者的身分讀底下兩本帳
SELECT o.id AS order_id,
       o.total - (COALESCE(p.paid_total,0) - COALESCE(r.refunded,0)) AS balance_due
FROM public.orders o
LEFT JOIN public.order_paid_totals_v p ON p.order_id = o.id
LEFT JOIN (…order_refunds where status='confirmed'…) r ON r.order_id = o.id
WHERE o.customer_user_id = auth.uid();     -- 🔴 own-only 寫死在 view 裡
```
- 🟢 **為什麼是它**:`security_invoker=false` + own-only 述詞這個組合,`order_paid_totals_v` 那支 migration **已經打過一次並通過 codex**(20260823030000)⇒ 抄的是一個驗過的形狀,不是發明。
- 🔴 **兩道 REVOKE 一道都不能少**(`docs/patterns/revoking-function-execute-in-supabase.md`):新物件出生就自帶 anon 權限,而 repo 內**零 `GRANT` 字面可掃、三綠不紅**。
- 🔴 只 `GRANT SELECT` 給 **authenticated**,**不給 anon**。
- 🔴 **只曝兩欄 `(order_id, balance_due)`** —— 對齊 `order_paid_totals_v` 那句「不要為了方便多帶一欄」。

### 乙案(不推薦)· 在 `orders` 上加一個 `balance_due` 欄,靠 trigger 維護
- ⛔ 多一份會漂的真相;而**漂掉的症狀是金額印錯**,不是紅。

---

## 4 · 前台那一塊怎麼改(⟦b4⟧ 的另一半)

```
今天  !cancelled && paymentChannel==='bank_transfer' && paymentStatus==='unpaid'
       金額印 order.total

改後  !cancelled && paymentChannel==='bank_transfer'
       && (paymentStatus==='unpaid' || paymentStatus==='partiallyPaid')
       && balanceDue.amount > 0            ← 🔴 codex 那條「溢付」世界
       金額印 balanceDue
```
🔴 **`balanceDue <= 0` 就整塊不印** —— 那涵蓋**溢付**(客人多匯了)與**剛好付完但狀態沒翻**兩個世界。
⇒ 📌 **對不可回收的東西,在「印一個可能錯的數」與「不印」之間永遠選不印**(該檔 `:579` 既有的原則,照抄不新創)。

🛑 **本片修不掉、要明寫的一格(既有,不是新增)**:⟦b4-NONCARDPAID1⟧ ——
登記匯款/現金收款**不會**把 `payment_status` 翻成 `paid`。
🔵 **而本片會讓它變好一點**:那種客人的 `balanceDue` 會是 **0** ⇒ **匯款區塊會消失**
⇒ 他不會再看到「帳號 + 全額 + 逾期警告」。⚠️ **但狀態徽章仍會寫錯**,那一格仍在 ⟦b4-NONCARDPAID1⟧。

---

## 4.5 · 🔴 codex 關卡 1 R1 = **FAIL**,四條 must-fix 已折進本檔(2026-09-05)

> 逐條寫在這裡而不是改完就算 —— **一份沒有病史的 plan,下一個人會把同樣的洞再挖一次。**

### MF① 🔴 **讀不到的時候【不准補零】** —— 這是本片最容易安靜出錯的一格
`SupabaseOrderAdapter.ts:853` 附近。新 view 的 LEFT JOIN 整列回 `NULL`(權限錯 / view 沒貼 / 資料異常)時,
mapper 若 `?? 0` ⇒ `balanceDue = total` ⇒ **對已付訂金的人印全額**。
✅ **訂死**:`balanceDue` 型別為 **`Money | null`**;
   **`null` ⇒ 匯款區塊【整塊不印】**,不是印 0、也不是印 total、也不是 throw 掉整頁
   (throw 會讓客人連訂單都看不到 —— 那是拿一個大故障換一個小故障)。
📌 這與 §2.2 是同一個病的兩端:那裡講「權限讀不到」,這裡講「讀不到之後那個值變成什麼」。

### MF② 🔴 `partiallyRefunded` 也要進顯示條件
`OrderDetailView.tsx:611`。部分退款之後客人又匯了一筆 ⇒ 狀態可能停在 `partiallyRefunded`,
而他**確實還欠錢** ⇒ 只納入 `unpaid|partiallyPaid` 會讓他看不到尾款要匯去哪。
✅ **訂死**:條件改成 **`balanceDue !== null && balanceDue.amount > 0`** 為主,
   `paymentStatus` 只保留 **`!== 'paid'`** 這一道弱過濾。
🛑 **而這推翻了原檔 `:578` 那句「否定式條件的射程是剩下全部」的用法** —— 那句話仍然對,
   但它擋的是「拿否定式去決定**印哪個數**」;這裡決定印不印的是**金額本身**,
   金額為 0 或讀不到就不印 ⇒ **射程由值決定,不由 enum 決定。** 這一段要寫進碼的註解。

### MF③ 🔴 型別名是 `Money`,不是 `MoneyAmount`(已改上表)
`MoneyAmount` 在 `types.ts` **0 命中** ⇒ 照原字面實作會編不過。
📌 我寫 plan 時**憑印象打了一個型別名** —— 而三綠會抓到它, 所以它不危險;
   危險的是同一個習慣用在**不會編譯的東西**上(SQL 字面 / 欄位名)。

### MF④ 🔴🔴 **退貨造成的退款,公式會把它變成「客人欠我們錢」**
`types.ts:1913-1914`。情境:客人付清 → 退了一件商品 → 我們退他 500。
- `order_refunds` 多一筆 confirmed 500
- 而 **`orders.total` 有沒有跟著降,本 plan 沒有證明**
⇒ 若 `total` 不變 ⇒ `balanceDue = total − (paid − 500) = +500` ⇒ **畫面叫他再匯 500。**
✅ **本片的處置 = 縮範圍,不是硬解**:
   **只有 `paymentChannel === 'bank_transfer'` 的單會顯示匯款區塊**(既有條件, 不放寬),
   而**退貨退款主要走卡軌**;再加上 MF② 的 `balanceDue > 0` 由**值**決定。
🛑 **而這不等於解決** —— 一張匯款單被部分退貨時,這個洞仍然在。
   ⇒ **本 plan 明列為未解, 並在 §5 端一題給 Sean(Q3)**, 不假裝縮範圍就沒事了。

### nit⑤ 行號引用打錯(已改)
`:585` 實際是取消單那一段;`partiallyPaid` 的理由在 `:575-579`。

---

## 4.6 · 🔴🔴 codex 關卡 1 **R2 也是 FAIL** —— 三條已折進,而**這份 plan 從沒拿到過一輪 PASS**

> 🛑 **這一句必須留著**:「findings 折完」**不等於**「通過」。
>    (同一句話今天已經在 `20260905190000` 那支 HOLD 的 migration 上用過一次 ——
>     它 codex 三輪全 FAIL、findings 全折完、而主視窗仍然裁「不貼」。**同一個判準,同一天,兩次。**)
> ⇒ 📌 **本 plan 的狀態 = 「已改到我改不動了」,不是「可以動工了」。動工前要 Sean 或主視窗點頭。**

### MF⑥ 🔴 `!== 'paid'` 把 `refunded` 也放進來了 —— 而那是**我上一輪自己引進的**
`OrderDetailView.tsx:611`。全額退款的單:`orders.total` 沒降、`paid_total − refunded = 0`
⇒ `balanceDue = total > 0` ⇒ **叫一個已經全額退款的客人再匯一次全額。**
📌 **我修 MF② 的時候把判準從 enum 換成金額,而那個換法【自己開了一個新的世界】** ——
   R1 修好的是「該印而沒印」,R2 抓到的是同一個改動造成的「不該印而印」。
✅ **訂死**:`paymentStatus` 這道弱過濾改成**白名單** ——
   只有 `unpaid | partiallyPaid | partiallyRefunded` 三個值才可能印;
   `paid` 與 `refunded` **一律不印**。⇒ 白名單會隨 enum 增值而**變保守**,否定式會變寬。

### MF⑦ 🔴🔴 「退貨退款主要走卡軌」是**我編的一句沒有證據的話**,而我拿它當安全論證
`OrderDetailView.tsx:611`。codex 逐字:「在 plan 內無證據;既有 bank-transfer 限制無法保護
**實際發生退款的匯款單**,不能當安全論證。」
✅ **我不替它辯護,直接撤掉那句。** 安全論證改成**只靠 MF⑥ 的白名單 + `balanceDue > 0` 兩道**,
   而 Q3 照舊端給 Sean。
📌 **這正是「頻率副詞讓沒量過的量級過關」那一族** —— 「主要」兩個字沒有分母,
   而它在句子裡的功能是**讓讀者停止追問**。

### MF⑧ 🔴 新 view 要 `security_barrier = true`
`security_invoker = false` 的 own-only view,外層若塞一個**會報錯或會洩漏的述詞**
(例如 `WHERE 1/(balance_due - 12345) > 0`),規劃器可能把它推到 own-only 過濾**之前**執行
⇒ 從錯誤訊息**探測到別人的列**。
✅ **訂死**:`CREATE VIEW ... WITH (security_invoker = false, security_barrier = true)`。
⚠️ 代價要寫:`security_barrier` 會**擋掉部分述詞下推** ⇒ 可能變慢。本片是**單張單的點查**,
   量級上應該是零 —— **而「應該」不是量到的**,貼之前在拋棄式 PG 上量一發 `EXPLAIN`。

---

## 5 · 要 Sean 拍的三題(**一個字回得完**)

```
Q1-應付餘額顯示: 只收了訂金的客人打開訂單, 匯款那一塊要印哪個數?
A: 甲 只印「還要匯 X 元」  |  乙 印「訂單 A 元 / 已收 B 元 / 還要匯 X 元」三行
   (甲較短; 乙讓客人自己對得起來, 而多兩行字)
推薦: 乙

Q2-處理中的退款: 我們按了退款但錢還沒真的出去(processing), 這筆算不算「已收」?
A: 甲 算已收(錢還在我們這) | 乙 當作已經退掉(客人少欠一點)
   (甲: 客人這時看到的餘額比較小, 退款失敗時不用改口
    乙: 退款成功後餘額才對, 而失敗時我們得回頭跟他要)
推薦: 甲

Q3-退貨之後的匯款單: 一張匯款單客人付清了, 後來退了一件商品退他 500。
   而訂單金額沒有跟著降 ⇒ 我們的算法會說他【還欠 500】。
A: 甲 這種單一律不顯示匯款區塊(保守, 他要打電話問)
   |  乙 先做到「退款後不再顯示」, 精確金額另開一片
推薦: 甲
```

⚠️ **Q3 是 codex 關卡 1 抓出來的**, 不是我自己想到的。

---

## 6 · 預期影響面

| 面 | 影響 |
|---|---|
| **會員訂單明細頁** | 匯款區塊多涵蓋 `partiallyPaid`;金額改用 `balanceDue` |
| **對帳單 PDF / statement** | `statement-pdf.ts` 與 `statement/page.tsx` 也吃 `MemberOrderDetail` ⇒ **型別加欄會編譯到它們**;本片**不改它們的畫面**,但要跑到它們的測試 |
| **後台** | 🟢 **零影響** —— 後台走 `admin_order_list_v` 的 `paid_total`,不碰新 view |
| **權限面** | 新增一支對 `authenticated` 開放的 view ⇒ **鐵則 12 ② 權限** ⇒ codex 必審 |
| **不碰** | `order_payments` / `order_refunds` / `order_paid_totals_v` 三者**一個字都不動** |

---

## 7 · Rollback

| 層 | 怎麼退 |
|---|---|
| 碼 | `git revert` 那顆 commit ⇒ 前台退回今天的行為(`partiallyPaid` 不印匯款區塊) |
| DB | 🔴 **view 不會跟著退** ⇒ 要退得另寫一支 `DROP VIEW public.member_order_balance_v;` |
| 🟢 安全性 | 新 view 是**唯讀且 own-only** ⇒ 留著不退**不會多曝任何東西**;但留著會讓下一個人以為它在用 ⇒ **要退就一起退** |

---

## 8 · 這份 plan 沒有回答什麼

- **`total` 欄在 `/api/search` 回 `null`** —— 無關,那是搜尋那條線的。
- **狀態徽章對「已匯款未登記」的客人仍是錯的** —— ⟦b4-NONCARDPAID1⟧,不在本片。
- **`processing` 退款的金額口徑** —— 等 Q2。
- **新 view 在正式庫的效能** —— 沒量。它是單張單的點查,量級上應該是零,**而「應該」不是量到的**。

---

## 附 · 順手查到的一個錯名(已與主視窗對過:不動已貼的 migration)

`20260901050000:43` 與 `20260904230000:612` 的 `COMMENT ON COLUMN` 裡寫著 **`v_order_paid_total`** ——
🔴 **repo 裡沒有這個東西**,真名是 **`order_paid_totals_v`**(字面數 20 vs 2)。
🔬 **而它已經寫進正式庫了**(2026-09-05 唯讀實查,帶正負對照:
本支建的 trigger 1 · 函式 1 · 正對照 1 · 負對照 0 ⇒ 兩支都已貼;
且 `orders.payment_status` 的欄註解**當場讀回來就是錯名**)。
⇒ 📌 **照那句註解去找的人會查無,而查無讀起來像「那個 view 不存在」。**
⇒ 處置:**兩支 migration 內文不動**(已貼 = ⟦01-LEDGERHASH1⟧ 乙類);錯名記在板列,
   哪天有人動那一欄的註解時**順手改對**,不為它單開一支 migration。
