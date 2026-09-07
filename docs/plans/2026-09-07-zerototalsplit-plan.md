# `⟦db-ZEROTOTALSPLIT⟧` 拆分 plan(鐵則 8;**只 plan, 本次零改動**)

> 出:線【資料】`-db` 2026-09-07 · 主視窗 A 派 · **等批准才動**
> 🔴 **本檔的每一個數字與座標都是當場量的**, 不是回想;量法都寫在旁邊, 可重跑。

---

## 0. 一句話

**76(`20260901030000_m4b_zero_total_settle.sql`)裡有【一支與券完全無關】的函式被券的閘擋在門外, 而它今天在正式庫上跑的是舊一代 —— 把那一支、也只把那一支抽出來單獨貼。**

---

## 1. 現況(量到的)

| 事實 | 讀數 | 量法 |
|---|---|---|
| 76 總行數 | **1321** | `wc -l` |
| 76 裡的函式 | **3 支** | `grep -n '^CREATE '`:`coupon_redeem_on_paid`(`:375`)· `settle_zero_total_order`(`:792`)· `admin_compute_order_settlement`(`:1051`) |
| `admin_compute_order_settlement` repo 最新一代 | **20260901030000**(= 76) | `bash scripts/latest-definition-of.sh admin_compute_order_settlement` |
| 同一支帳本上最後已記 | **20260812140000** | 同上 |
| **正式庫實際在跑哪一代** | **20260812140000**(舊的) | `python3 scripts/prod-vs-vc-functions.py` ⇒ 該支落在 🟡, 逐字「正式庫跑著較舊一代 20260812140000」 |

🟢 **兩把獨立的尺指向同一件事**(一把讀 repo + 帳本, 一把讀正式庫)⇒ 這不是單一檢查的結論。

---

## 2. 🔴 拆法與板上原本的假設【相反】—— 而這是本 plan 最重要的一段

板列原本寫的是「把 trigger 從 76 移走」。**量過之後那個方向會讓事情更糟**:

- 76 **自己就會建**券的那一套:`:375` `CREATE OR REPLACE FUNCTION coupon_redeem_on_paid()` ·
  `:637-638` 建 trigger · `:677` `ENABLE ALWAYS` · `:705-735` 三道 fail-closed 斷言。
- 76 `:285` **自己逐字寫過**:「本片自己就會建 `coupon_redeem_on_paid` + trigger ⇒ **不貼 75 也能把扣券打開**」。
- 75(`20260901021000`)用的是**裸 `CREATE FUNCTION`**(`:429`), 76 用 `CREATE OR REPLACE`
  ⇒ 📌 **這正是「順序是死的」的來源**:75 必須在 76 之前, 反過來會撞已存在。

⇒ **把 trigger 從 76 移走 ⇒ 76 再也建不出它 ⇒ 75 變成唯一建立者 ⇒ 順序依賴不減反增。**

---

## 3. 要抽的是哪一支 —— **只有一支**

### ✅ 抽:`admin_compute_order_settlement(uuid)`(76 `:1051-1298`)
**與券零關係, 這是量到的**:該段 `grep -in 'coupon'` ⇒ **0 命中**;
它讀的 12 張表(`order_payments` 5 · `payment_refund_effective_terminal` 2 · `payment_charge_attempts` 2 ·
`payment_refunds` · `payment_double_charge_anomalies` · `orders` · `order_refunds` · `order_refund_jobs` ·
`order_items` · `order_cancellations` · `order_cancellation_items`)**沒有一張是券的表**。

### ⛔ 不抽:`settle_zero_total_order(uuid)`(76 `:792-953`)
🔴 **它【語意上】依賴券, 抽出去買不到任何東西**:
該函式 `:869` 逐字 `IF v_order.coupon_id IS NULL THEN` ⇒ `RAISE EXCEPTION`
「這張 0 元單沒有帶券 —— **只有全額折抵券的單走本函式**」。
⇒ 📌 **券沒上線之前, 這支函式對每一個輸入都是拋錯。**先貼它 = 貼一個必定失敗的入口。

### ⛔ 不抽:`coupon_redeem_on_paid()` + trigger — 它就是券本身。

---

## 4. 為什麼**現在**要抽(不是整理癖)

抽出來的那一代對 live 一代有 **42 行 body diff**(`difflib`, `unified_diff n=0`;
live md5 `087a886d…` len 9719 ⇒ 最新 md5 `f134e95d…` len 11669), 而**其中一處是今天就成立的正確性修**:

- 🔴 **`voided` 排除**(⟦b4-TAPPAYDIRECT⟧ A2, 2026-09-07, codex R2 抓到):
  `WHERE orf.status <> 'failed'` ⇒ `WHERE orf.status NOT IN ('failed', 'voided')`。
  **一筆補登錯了、已作廢、錢其實沒退的訂單**, 在舊一代裡 `old_n` 仍會是 1
  ⇒ P6 判 false ⇒ **結清變 `needs_human / R_REFUND_TRACE_PRESENT`、金額輸出變 NULL**。
  ⚠️ 而 `voided` 那個值**已經存在了**(貼板 70 = `20260907030000` 已貼)⇒ **這一格今天就會踩到。**
- 🔵 另一處是 0 元單的 P5 分支 —— 它只在 `payment_method = 'zero_total'` 時成立,
  而**寫那個值的是 `settle_zero_total_order`**(還沒貼)⇒ **今天不會被觸發, 貼下去是惰性的。**

⇒ 📌 **一句話**:抽出來會**修好一件今天正在錯的事**, 而它帶進來的另一半**今天不會動**。

---

## 5. 新 migration 要帶哪些閘(而**不要**帶券的閘)

- **帶**:`admin_compute_order_settlement` 的 ACL 三 REVOKE + `GRANT … TO service_role`
  (76 `:1295-1298` 逐字)+ `has_function_privilege` fail-closed 釘。
- **帶**:前後 `md5(prosrc)` 釘死(照 `20260907140000` 的形狀 —— 那支已被 codex R1/R2 + opus R3 打過三輪)。
  前置釘 live 一代 `087a886d…`, 事後釘 `f134e95d…`。
- **帶**:單一多載釘 `(uuid)` · `prosecdef` · `proconfig` · `proowner`。
- ⛔ **不帶**:`redeem_coupon` 存在性、owner-EXECUTE、`orders.coupon_id` 這三道**券的相依閘** —— 本支不碰券。

### 版本號
🔴 **這一格要有人明說, 不要讓下一個人自己猜**:本支不碰券 ⇒ **它與 75/76 沒有順序關係**,
版本號排在 75 之前或之後都成立。**而「沒有順序關係」必須寫在檔頭**, 否則下一個人會照舊假設 75→76 的死順序。

---

## 6. 影響面

- **改的是誰**:`admin_compute_order_settlement(uuid)` 一支函式的 body(`CREATE OR REPLACE`)。
- **誰會受影響**:呼叫端只有 `service_role`(唯一 `GRANT EXECUTE` 對象, 76 `:1298`)。
- **行為變化**:上面第 4 節那兩處。**已作廢的補登不再被算成退款痕跡** ⇒ 本來被錯判 `needs_human` 的單會回到正常結清。
- **不影響**:券、`settle_zero_total_order`、75、76 本身(76 仍留著它自己那一份 `CREATE OR REPLACE`,
  ⚠️ **而這代表 76 之後若真的貼, 會把本支再蓋一次** —— 兩邊 body 相同 ⇒ 無害, 但**要在兩個檔頭都寫明**)。

## 7. Rollback
**forward-only**(照全 repo 慣例)。而 🟢 **可貼回的前一代【在版控裡】**:
`20260812140000_m4b_lifecycle_refund_manual_reversal.sql:356`, body md5 `087a886d…`
⇒ 事故當下不必憑空重建, 再出一支把它 `CREATE OR REPLACE` 回去即可。

## 8. 🛑 本 plan 證不到什麼
- 我**沒有**跑過任何寫入;正式庫那一代的判定來自 `prod-vs-vc-functions.py` 的唯讀讀數。
- 我**沒有**驗證「`voided` 那一格今天真的有訂單踩到」—— 我證的是**構造得到**(`voided` 值已存在),
  不是**已經發生**。要答後者需要讀 `order_refunds`, 而我的唯讀角色沒試過那張表。
- 我**沒有**判「76 剩下那兩支什麼時候貼」—— 那是券上線的排程, 不在本 plan。
