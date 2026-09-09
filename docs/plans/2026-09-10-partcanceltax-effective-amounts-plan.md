# Plan · `⟦b4-PARTCANCELTAX⟧` —— 未稅單的「多收」算出太大的數字

> **線【後台】窗 B · 2026-09-10** · Sean 2026-09-09 拍甲(**現在修**),經主視窗 `-b2` 轉達。
> 🔴 **鐵則 8**(動 view = schema)⇒ **寫 plan 等批,不自己開工。**
> 🔴 **鐵則 12①**(錢)⇒ **codex 對抗審查不降級。**
> 版本號 `20260909100000`(`09xxxx` 是窗 B 號段;`090000` 已用)。

---

## §0 一句話

`pcm_order_effective_amounts_v` 用**未稅小計**當「客人應付」,而客人付的是**含稅總額**
⇒ **一張剛好付完的未稅單,系統說我們多收了他一筆錢,而那筆錢的金額剛好等於稅。**

---

## §1 傷害是真的 —— 拋棄式 PG 實測,不是讀定義推的

🔬 三支 view(`pcm_order_effective_amounts_v` · `order_balance_base_v` · `pcm_bank_order_still_mailable`)
**逐字抄自正式庫 `pg_get_viewdef`**,一個字沒改;`order_paid_totals_v` 用 `SUM(order_payments.amount)` 補。
庫跑完即 `DROP`,殘留 0。

### 1-a 錯的量【剛好等於稅額】(四格)

| 單 | 稅制 | 稅 | 總計 | 客人付了 | view 算的餘額 | 判讀 | 多收 = 稅? |
|---|---|---|---|---|---|---|---|
| A | `exclusive` | 50 | 1050 | 1050(**剛好付完**) | **−50** | 🔴 多收 50 | **t** |
| B ⚪ | `inclusive` | 0 | 1050 | 1050(**同樣的錢**) | 0 | ✅ 剛好 | t |
| C 🟢 | `exclusive` | **100** | 1100 | 1100 | **−100** | 🔴 多收 100 | **t** |
| D ⚪ | `exclusive` | **0** | 1000 | 1000 | 0 | ✅ 剛好 | t |

· **B** 是負對照:同樣的錢做成含稅單 ⇒ 0。**兩個世界只差稅制。**
· **C** 是正對照:稅換成 100 ⇒ 錯跟著變 100 ⇒ **那 50 不是巧合,它就是稅。**
· **D** 是第二個負對照:把稅這個變因關掉 ⇒ 錯消失。

### 1-b 病灶逐字

```
effective_subtotal   = Σ((quantity − 已取消) × unit_price)      ← exclusive 單的 unit_price 是【未稅】
effective_total      = effective_subtotal + 運費                 ← 所以這是【未稅應付】
effective_balance_due = effective_total − (o.total − balance_due) ← 減掉的是【含稅實收】
```
⇒ 🎯 **兩邊不同幣別**:一邊未稅、一邊含稅,差一個稅。
📌 **而 `inclusive` 單上「小計」與「客人應付」剛好相等** ⇒ **這個 bug 到今天為止是隱形的。**

---

## §2 呼叫端不是 0 —— 而且在【寄信】那條路上

⛔ ~~我第一版量到「app 端 0 命中 ⇒ 沒有呼叫端」~~
🛑 **那把尺在錯的世界裡** —— 呼叫端在 **SQL 裡**,不在 app 裡(app 只 `select order_id`)。
✅ 主視窗 `-b2` 更正,我複核:`pcm_bank_order_still_mailable` **不只讀 `effective_balance_due`,
還拿它當三個過濾條件**:
```sql
AND eff.effective_balance_due IS NOT NULL
AND eff.effective_balance_due > 0
AND eff.effective_balance_due <= eff.effective_total
```
而那張 view 就是**匯款通知信**的來源(`20260907220000` 標題逐字 `bank_mailable_uses_effective_amounts`)。
⇒ 🔴 **傷害的落點是:信上告訴客人的應付金額少一個稅 ⇒ 客人照信匯 ⇒ 短匯。**

---

## §3 而它今天造不出來 —— 被三道【互相獨立】的閘擋住

🔬 同一份拋棄式世界,把寄信那張 view 也種進去跑:

| 世界 | 來源 | 稅制 | 稅 | 真的應付 | **信上會說** | 判讀 |
|---|---|---|---|---|---|---|
| **E** | `web` | `exclusive` | **0** | 1000 | 1000 | ✅ 金額對 |
| **F** | `web` | `exclusive` | **50** | 1050 | **1000** | 🔴 **少講 50** |
| **G** | `manual_phone` | `exclusive` | 50 | 1050 | *(不出現)* | ⛔ 不會寄 |
| **H** ⚪ | `web` | `inclusive` | 0 | 1050 | 1050 | ✅ 金額對 |

**F 就是傷害本體。而 F 今天造不出來:**

**閘一 —— 顧客站那條路,稅結構上就是 0。**
`create_order`(11 參那支)本體逐字:
```sql
IF v_price_tax_mode = 'exclusive' AND p_payment_channel <> 'bank_transfer' THEN
  v_tax := round(((v_subtotal + v_shipping_fee - v_discount_total)) * 0.05);
ELSE
  v_tax := 0;
```
⇒ 🎯 **那正是 Sean `Q24` 拍的「稅隨付款方式:刷卡 +5%、匯款不加」** ⇒ 顧客站的
**exclusive 匯款單 `tax_total` 恆為 0** ⇒ 就是世界 **E** ⇒ 金額對。

**閘二 —— 手動建單那條路,進不了那張 view。**
`admin_create_manual_order` **會**產生 `exclusive` + 稅 50 + 匯款(2026-09-09 我建的測試單 `MCGHHM` 就是),
而那張 view 有 `o.order_source = 'web'` 與 `o.manual_request_id IS NULL` ⇒ **手動單被擋兩次** ⇒ 世界 **G**。

**閘三 —— 顧客站今天根本產不出 `exclusive` 單。**
`create_order` 寫 `exclusive` 的觸發條件是 `v_tier = 'store'`(經銷會員),
而**今天 store tier = 0 人**。而 Sean 已拍:**經銷價整包排到上線後**(與 B2B 子網域一起)。

🔴🔴 **而三道閘沒有一道是為了防這件事而設的。**
📌 **哪一道被動到,F 就會出現,而沒有任何東西會叫。**

### 3-a 「那一天」清單(四個,任一個到來就爆)

1. **Sean 改 `Q24`**(匯款也要加稅)⇒ **閘一消失** ⇒ 顧客站直接產出 F。
2. **有人放寬那張 view 的 `order_source='web'`**(例如「手動單也要寄匯款通知」)⇒ **閘二消失**
   ⇒ `MCGHHM` 的形狀直接落進去。
3. **第一個經銷會員註冊**(經銷價上線)⇒ **閘三消失**。
4. **OP7 上線** ⇒ 那是**另一條路**(待退款,不是寄信)⇒ 同一個 `−50` 會變成**一筆真的待退款**
   ⇒ 🔴 **方向是錢往外走。**(`pcm_order_partial_cancel*` 今天**不在正式庫**,我量過 ⇒ 0 筆。)

---

## §4 正式庫今天的讀數(2026-09-10 唯讀)

| 問的 | 答 |
|---|---|
| `exclusive` + `bank_transfer` + `unpaid` | **1 張** |
| 🔴 而那 1 張是誰 | **`MCGHHM` —— 我 2026-09-09 建的測試單**,`manual_phone` · 有 `manual_request_id` · **已取消** ⇒ 被那張 view 的**三道門各擋一次** |
| 照 view 的**完整述詞**重量:真正會寄的 `exclusive` 單 | **0 張** |
| 🟢 正對照:同述詞**不限稅制** | **1 張** ⇒ 尺是活的 |
| 稅制 × 來源分佈 | `manual_phone\|exclusive` **1** · `manual_phone\|inclusive` **2** · `web\|inclusive` **3** ⇒ **今天沒有任何 `web\|exclusive`** |

⇒ 📌 **所以這件事今天【不是正在寄錯】,而是【四道門任一扇開了就會】。**

---

## §5 改什麼 —— 兩條路,而我推薦甲

### 甲(推薦):算不出來就**不要回一個數**,回 `NULL`

```sql
-- pcm_order_effective_amounts_v 的 effective_balance_due 改成:
CASE
  WHEN o.price_tax_mode = 'exclusive' AND o.tax_total <> 0 THEN NULL::bigint
  ELSE <現行算式>
END
```
🎯 **為什麼推薦**:
1. **這是 repo 已有的慣用法,不是新發明** —— `order_balance_base_v` 對「有退款的單」就是回 `NULL`,
   該 migration 的理由逐字:「退了款的單今天算不出『他還要付多少』,而在**印一個可能錯的數**與
   **不印**之間,對錢永遠選不印。」
2. **消費端已經接得住** —— `pcm_bank_order_still_mailable` 的述詞第一條就是
   `eff.effective_balance_due IS NOT NULL` ⇒ **那封信直接不寄**,而不是寄一個錯的金額。
   ⇒ 📌 **fail-closed,而且不用改消費端一個字。**
3. **不複製計價規則** —— 本列自己的建議逐字:「**算式不可信就不寫列、交給對帳報出來
   (不要自己把稅加回去算)**」,理由是稅率規則(`Q24` 稅隨付款方式)**還沒有落進那支 view**
   ⇒ 🛑 **猜出來的話,算出的每個數字都會很有說服力而且沒有人查得出來它從哪來。**

🔴 **代價(要寫出來)**:那種單**從此不寄匯款通知信**。
⚠️ 而今天那個代價是 **0 張**(§4)⇒ **今天零影響**;而 §3-a 任一扇門開了之後,
代價會從「寄一封金額錯的信」變成「**不寄**」⇒ **那是保守方向,但它是一個【新的沉默】**
⇒ ✅ **所以甲必須配一格告警**:`effective_balance_due IS NULL` 而 `payment_status='unpaid'` 的匯款單
要被數出來(掛進既有的 `check-anomaly-alerts` 家族),否則它會**安靜地不寄**。

### 乙:在 view 裡把稅算回去

```sql
effective_total = effective_subtotal + 運費 + <重算的稅>
```
🛑 **要複製 `Q24` 那條計價規則進 view**,而那條規則今天活在**兩支 RPC 裡**
(`create_order` 看 `p_payment_channel`;`admin_create_manual_order` 看發票勾選)
⇒ 📌 **第三份實作 = 第三種世界觀**,而它們哪天分岔沒有東西會叫。
🔴 **而部分取消讓它更難**:稅要按**未取消的品項**重算,而重算的基數是
`(折後小計 + 運費)`,那又要 view 知道折扣怎麼算。
⇒ **我不推薦,而若 Sean 選乙,那條計價規則必須先抽成【一個】共用函式,兩支 RPC 一起改。**

---

## §6 驗收(yes/no)—— 🔴 最重要的是最後那一格

1. §1 那四格(A/B/C/D)在拋棄式 PG 重跑 ⇒ 甲之後 A 與 C 回 **`NULL`**,B 與 D 仍 **0** ⇒ yes/no
2. §3 那四格(E/F/G/H)重跑 ⇒ **E 仍寄且金額對** · **F 不再寄**(而不是寄錯) · G 仍不寄 · H 仍寄 ⇒ yes/no
3. 🔴🔴 **突變:把三道閘各拿掉一道,必須各紅一格**
   · 拿掉閘一(讓 `create_order` 對匯款也算稅)⇒ 世界 F 出現 ⇒ **必須紅**
   · 拿掉閘二(view 的 `order_source='web'`)⇒ 世界 G 落進來 ⇒ **必須紅**
   · 拿掉甲那個 `NULL` 分支 ⇒ **必須紅**
   📌 **這一格比修 view 本身重要** —— 那三道閘都可能因為**完全無關的理由**被改,
   而改的人不會知道自己拆掉了一道別人的安全網。
4. 甲的那格告警:`effective_balance_due IS NULL` 的未付款匯款單數得出來 ⇒ yes/no
5. 三綠 rc=0 ⇒ yes/no
6. 🔴 **codex 對抗審查一輪**(碰錢 + schema + 寄信 ⇒ 鐵則 12①③⑤)⇒ must-fix 修完才 commit

---

## §7 rollback

`supabase/rollbacks/20260909100000_down.sql` —— 把 view 定義換回現行那一份(**可執行**,
帶 `pg_get_viewdef` 的前置閘:現行定義不是我抄的那一版 ⇒ 停)。
🔵 **零資料改動**:view 沒有列。
⚠️ **回滾之後那個 `−50` 會回來** —— 而那正是本支在修的事,不是副作用。

---

## §8 這份 plan 證不到什麼

1. **我沒有真的呼叫 `create_order` / `admin_create_manual_order`** —— 三道閘我證的是**本體逐字**,
   不是「餵一發真的進去看它寫什麼」。
2. **部分取消那條路沒跑** —— §1 四格都是**沒有取消**的單。而本列的主詞是「部分取消之後算多收」
   ⇒ 🛑 **那是這份 plan 最大的缺口**,實作時第一件事就要補這一格。
3. **運費固定用 `store`(0)** —— `home` 那條(0 或 100)沒試,而運費也在 `effective_total` 裡。
4. **`order_paid_totals_v` 是我用 `SUM(amount)` 補的**,不是正式庫那一份 —— 若它另有沖銷/退款邏輯,
   §1 §3 的讀數要重驗。
5. **§4 是 2026-09-10 的快照**,而全庫只有 6 張單 ⇒ 每一個 0 都極短命。
6. **甲那條路我沒有量「不寄」的下游** —— 客人收不到匯款通知信會怎樣(有沒有別的地方也在通知他),
   我沒查。
