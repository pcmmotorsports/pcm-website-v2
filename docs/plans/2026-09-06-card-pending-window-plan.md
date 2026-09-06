# Plan · 3DS pending 窗口 ⟦b4-CARDPENDINGWINDOW⟧ —— 線【帳號】`account` 2026-09-06

> **狀態:等主視窗批。批了才動。本檔零碼改動。**
> 觸發:板列 `docs/launch-todo.md:341` `⟦b4-CARDPENDINGWINDOW⟧`(`-f8` 2026-09-06 裁【甲】把它從 `20260906500000` 分出來)。

## 0. 🔴 接單第一動:重數範圍 —— **條目的數字對不上,要先更正**

板列逐字寫「修法方向 …**要動 `confirm_order_payment` / `mark_charge_attempt_charged`**」= **兩支**。

當場重數(`bash scripts/latest-definition-of.sh <名>`,2026-09-06):

| 函式 | repo 最新一代 | 它做什麼(檔案:行號 + 逐字) |
|---|---|---|
| `mark_charge_attempt_charged` | `20260810170000` | `:180` `SET status       = 'charged',` |
| `mark_charge_attempt_charged_fallback` | `20260810170000` | `:306` `SET status       = 'charged',` |
| `confirm_order_payment` | `20260810170000` | `:436` `SET payment_status      = 'paid'::public.payment_status,` |

⇒ 🔴 **是三支不是兩支** —— 板列漏了 `mark_charge_attempt_charged_fallback`。
📌 **而漏掉它的後果正好是本片要修的那個病的翻版**:只補兩支 ⇒ 走 fallback 那條路的刷卡成功
**仍然不會 supersede** ⇒ 兩張單照樣同時活著,而三綠全綠、鑽機也不會叫(沒人餵 fallback 那條路)。

## 0-b. 🟢 **第 1 步做完了(2026-09-06,`-f8` 裁 Q-pending3=甲)—— 分母是量到的**

做法:**對正式庫唯讀查 `pg_proc.prosrc`**(`bash scripts/readonly-prod-sql.sh`),不是 grep 檔案。
剝掉 `--` 註解 + 壓空白之後再比對;掃描範圍 = 全庫 **187** 支 `plpgsql` 函式(`pg_catalog` / `information_schema` 除外)。

| 問題 | 答案 | 逐字 |
|---|---|---|
| 寫 `payment_charge_attempts.status='charged'` | **2 支** | `mark_charge_attempt_charged(p_attempt_id uuid, p_order_id uuid, p_rec_trade_id text)` · `mark_charge_attempt_charged_fallback(…, p_fallback_token uuid)` |
| 寫 `orders.payment_status='paid'`(寫死字面) | **1 支** | `confirm_order_payment(p_order_id uuid, p_amount integer, p_rec_trade_id text)` |
| ⇒ **刷卡成功入口** | **3 支** | 與 §0 重數的結果一致 |

**對照(三把,同一發裡量的)**
- 🟢 正對照:掃到 **187** 支 plpgsql 函式(不是 0 ⇒ 尺接上了)
- 🔵 負對照:現造字面 `SETstatus='QXZZNOSUCH7731'` ⇒ **0 列**
- 🔢 第二個數:**寬版**比對(不要求緊接 `SET`)抓到 **10 支**含該字面 ⇒ 逐支取字面前後 90 字元看
  ⇒ 其餘 **7 支全是【讀】**(`WHERE` / `AND` / `ORDER BY` / `IF` / `SELECT`),含 `begin_charge_attempt`(5 處)與 `admin_cancel_order`(2 處)。
  📌 **窄版與寬版差 7 支,而那 7 支全部是假陽性** —— 兩個數不一致時,是**寬版把讀也算進來了**,不是窄版漏掉寫。

**🔴 而補洞那一發找到了窄版真正漏掉的東西**(用**變數**寫、不是寫死字面):
```
pcm_noncard_settle_recompute          SET payment_status = v_new
pcm_sync_order_refund_payment_status  SET payment_status = v_target::public.payment_status
```
兩支的檔內**都有 `'paid'` 字面** ⇒ 它們**可能**把 `payment_status` 寫成 `paid`。
- 🔵 它們是**非刷卡路徑**(匯款/現金重算 · 退款狀態同步)⇒ **不在本片(刷卡成功)的射程裡**。
- 🔴 **而它們讓 `20260810170000:32` 那句失效條件看起來【已經成立】** —— 該行逐字:
  「失效條件:出現第四支會寫 `payment_charge_attempts.status='charged'` 或 `orders.payment_status='paid'` 的物件。」
- ⚠️ **未確認**:我**沒有**證到「`v_new` / `v_target` 真的會是 `'paid'`」。
  **缺的那一道檢查** = 逐條看那兩支裡對 `v_new` / `v_target` 的指派分支。
  ⇒ 📌 **在補上那一道之前,上面那句只能寫成「看起來成立」,不能寫成「已經失效」。**

**Trigger 那一半**:`orders` / `payment_charge_attempts` / `order_payments` 上共 **9** 個非內部 trigger,
逐個看 `pg_get_triggerdef` ⇒ 沒有一個的函式出現在上面兩張寫入清單裡。

## 0-c. 🔴🔴 **第 1b 步(`-f8` 加問的呼叫端)—— 它把 §0-b 的結論改窄了**

`-f8` 要我證「刷卡成功那條路**不會**經過那兩支變數寫入端」。**量下去的答案是【會】。**

**證據鏈(每一段都是對正式庫唯讀量到的逐字,不是推的)**
```
① confirm_order_payment 會寫 order_payments —— 逐字:
   INSERTINTOpublic.order_payments(order_id,rail,amount,received_at,rec_trade_id,actor)
   VALUES(p_order_id,'card',v_…                      ← rail='card' ⇒ 這就是刷卡那一腿
② order_payments 上有 AFTER INSERT trigger(pg_get_triggerdef 逐字):
   CREATE TRIGGER pcm_noncard_settle_after_payment_ai AFTER INSERT ON public.order_payments
   FOR EACH ROW EXECUTE FUNCTION pcm_noncard_settle_after_payment()
③ pcm_noncard_settle_after_payment 的 prosrc 含 pcm_noncard_settle_recompute ⇒ 它叫它
④ pcm_noncard_settle_recompute 逐字:
   IFv_verdict='settled'THENv_new:='paid'::public.payment_status;
   …THENUPDATEpublic.ordersoSETpayment_status=v_new,paid_at=CASEWHENv_new='paid'…
   ⇒ 🔴 **v_new 真的可以是 'paid'** —— §0-b 標「未確認」的那一格, 現在確認了。
```
⇒ 📌 **刷卡成功 → `confirm_order_payment` → 寫 `order_payments`(card 腿)→ trigger → recompute → 可寫 `paid`。**

**其他呼叫端(同一發量到,帶正負對照)**
| 被叫的 | 呼叫端 |
|---|---|
| `pcm_noncard_settle_recompute` | `pcm_noncard_settle_after_payment`(trigger)· `pcm_settle_retry_sweep`(cron 掃) |
| `pcm_sync_order_refund_payment_status` | `admin_correct_order_refund_verdict` · `admin_finalize_order_refund` · `admin_record_manual_refund` · `admin_void_manual_refund`(四支都是**員工退款**路徑) |
🟢 正對照:同一把尺找 `payment_charge_attempts` ⇒ **20** 支(不是 0);🔵 負對照:現造函式名 ⇒ **0**。

### 🔴 而這帶出一個【定義題】,不是我可以自己決定的
「入口」有兩種讀法,而它們給出不同的數:
```
讀法甲「誰把訂單變成已付款」          ⇒ 5 支(3 支 + recompute + sync_refund_status)
讀法乙「刷卡成功這個事件從哪裡進系統」⇒ 3 支(recompute 在 confirm_order_payment 的【下游】,
                                        不是另一條到達刷卡成功的路)
```
- 🛑 **若照甲把 supersede 也放進 recompute** ⇒ 它會在**匯款/現金收款**時也觸發
  (那條路同樣走 `order_payments` INSERT)⇒ 📌 **那是在改另一件事的行為, 而沒有人拍過。**
- 🔵 若照乙 ⇒ 覆蓋那 3 支就涵蓋了刷卡那條路(`confirm_order_payment` 本來就在裡面)。
- ⇒ **我推薦乙**,理由是**射程**:本片的題目是「刷卡 pending 那段窗口」,不是「所有讓訂單變成已付款的路」。
  而甲那一半正好是 `-f8` 已經裁去另一片的 **Q-pending2(M2)**。

### 🔵 順帶:`20260810170000:32` 那句失效條件 —— **現在證實成立**
該行逐字:「失效條件:出現第四支會寫 `payment_charge_attempts.status='charged'` 或 `orders.payment_status='paid'` 的物件。」
⇒ `pcm_noncard_settle_recompute` 就是那個第四支(④ 那段逐字是證據)。
⇒ `-f8` 提的訂正方向(把該句改成「寫死 `charged`/`paid` 的函式」)**不成立** —— recompute 不是寫死字面,
   而它**真的會寫 `paid`** ⇒ 訂正要改的是**別的地方**:那句話本身沒錯,是**它已經被觸發了**。

---

⛔ ~~**結論:刷卡成功入口 = 3 支,`-f8` 可以據此批動碼那一步。**~~ **改寫(見 §0-c)**:
✅ **照讀法乙 ⇒ 3 支;照讀法甲 ⇒ 5 支。這一題等 `-f8` 裁,裁完才動碼。**

---

⛔ ~~**而「三支就是全部」這件事我【還沒有證明】**~~(**2026-09-06 已補,見上面 §0-b**):
- `20260810170000:32` 檔頭自己寫了失效條件,逐字:「出現第四支會寫 `payment_charge_attempts.status='charged'` 或 `orders.payment_status='paid'` 的物件。」
- 我今天跑的 `grep -rln "status *= *'charged'" supabase/migrations/` 回 **20 支檔**、`payment_status *= *'paid'` 回 **20+ 支** —— 🛑 **那是「檔案裡出現這個字面」,不是「這支函式會寫它」**(註解、`WHERE` 條件、舊世代都在裡面)⇒ **這個數不能拿來下結論。**
- ⇒ ✅ **建立那個分母是本片的第 1 步**(見 §3 步驟 1),不是前提。

## 1. 病灶(照抄板列與 codex,不是我重述)

`docs/launch-todo.md:341` 的 codex R1 逐字:
> 「真正破口是正式庫的 `mark_charge_attempt_charged*` / `confirm_order_payment` **不拿此鎖**:pending → 建匯款單 → charged/paid, 兩單仍同時活著。」

時序:
```
① begin_charge_attempt  ⇒ supersede 掉【當下已存在】的同 cart 匯款單(20260904050000:202-215)
② 3DS pending           ⇒ 客人另開分頁按「匯款結帳」
③ create_order          ⇒ 守門(20260906500000:279-296)問的是
                           「payment_status='paid' 或 有 status='charged' 的 attempt」
                           而此刻是 pending ⇒ 🔴 兩個條件都不成立 ⇒ 放行, 匯款單建起來
④ 刷卡完成              ⇒ 沒有任何人回頭看 ③ 建的那張 ⇒ 🔴 兩張單同時活著
```
🛑 **不能靠「把 pending 也擋掉」修** —— 板列逐字:`ClearCartOnSuccess.tsx:18`「callback page 僅在 **paid 分支** 傳 regenerate」⇒ 刷卡失敗後 `cart_session_id` 不換 ⇒ **擋 pending 會讓刷卡失敗想再試的客人結不了帳。**

## 2. 修法方向(未定案,要主視窗選)

**共同核心**:把 `20260904050000:202-215` 那段 supersede,**在刷卡成功那一刻再跑一次**。
那段的條件是 `payment_channel='bank_transfer' AND payment_status='unpaid' AND NOT EXISTS(非終態 attempt)`
—— ③ 建出來的那張**逐條符合**(它剛建、沒有任何 attempt)。

```
甲(推薦)= 抽一支 SECURITY DEFINER 的內部函式 `pcm_supersede_sibling_bank_orders(uid, cart_session_id, keep_order_id)`,
         三支刷卡成功入口各呼叫一次;begin_charge_attempt 那一處【不動】(它已經是對的)
乙       = 三支各自就地複製那段 UPDATE(與現況同構:20260904050000:200 逐字說那三處
         「刻意不共用 … 抽成共用點會變成一個【會一起被改壞】的東西」)
```
🔴 **甲乙的取捨是【已經有拍板紀錄的】,不是我新發明的**:`20260904050000:200` 那一段明文選了「不共用」。
⇒ 📌 **所以這一題不是我可以自己決定的** —— 選甲等於推翻那一段的理由。**端主視窗裁。**

⚠️ **兩案共同的未解點(不論選哪個都要答)**:
- **鎖**:`create_order` 與 `begin_charge_attempt` 都先 `pg_advisory_xact_lock(hashtextextended(uid))`。刷卡成功那三支**現在沒拿**。不拿 ⇒ ③ 與 ④ 仍可交錯;拿 ⇒ 要確認不會與既有鎖順序死結。**這一格要在拋棄式 PG 上真的跑並發測試, 不是用想的。**
- **codex 同輪的第二半(M2)**,板列逐字:同 cart 的匯款單若「已收款但仍 `partiallyPaid`」或「overpaid / needs_human 而 `payment_status` 仍 `unpaid`」且**沒有 attempt** ⇒ **守門完全看不到**。
  ⇒ 那是 `create_order` **守門本身**要放寬的一格(問淨額,不只問狀態),**與本片的 supersede 是兩件事**。
  ⇒ 🔴 **建議拆成另一片**,不要混進來 —— 混進來會讓一片同時動守門與三支寫入端。

## 3. 步驟(每一步都可以中斷)

1. **建立分母**:證出「會把 attempt 寫成 charged / 把 order 寫成 paid 的物件」到底有幾支。
   做法:拋棄式 PG 貼完整 migration 鏈之後查 `pg_proc.prosrc`(不是 grep 檔案),配正負對照。
   ⇒ **對不上 §0 那三支就停下來回報**,不照三支開工。
2. 讀那三支的早退路徑,決定 supersede 放在**哪一行之後** —— `20260904050000:187-194` 逐字記著:第一版放錯位置 ⇒ 「**客人兩張單都沒了**」。**這一格照抄它的教訓, 不重新發明。**
3. 決定鎖(見 §2),在拋棄式 PG 上跑並發測試。
4. 寫 migration(前置閘 md5 錨 + 簽章語意 + COMMENT 錨,照 `20260906600000` 那一套)。
5. 鑽機:**三支入口各一條路** + 一條「不該被 supersede」的負例。
6. rollback(含災難止血步驟,照 `docs/specs/2026-09-06-expire-day-boundary-ROLLBACK.sql` 那個形狀)。

## 4. 體積與風險

- 🔴 **超過 45 分鐘,一定要拆。** 建議切三片:①分母 + 位置決定(唯讀,可先做)②supersede 本體 ③守門放寬(M2)。
- 🔴 **鐵則 12 命中**(①錢 ②權限 SECURITY DEFINER ③DB 結構):三片都要 codex 對抗審查不降級。
- ⚠️ **今天沒有材料**(板列逐字):正式庫 `orders` 全表 **2 列** ⇒ 這個窗口有沒有真的害過人,**量不到**。
  ⇒ 📌 **那不是「不用修」的理由,是「修完也驗不到真實影響」的誠實申報。**

## 5. 要主視窗裁的

```
Q-pending1(流程):supersede 要抽共用函式還是三處各寫一份?
  甲 = 抽共用 pcm_supersede_sibling_bank_orders(三支呼叫)
  乙 = 三處各寫一份(與 20260904050000:200 那段「刻意不共用」的拍板一致)(推薦, 理由=不推翻既有拍板)
  A: 甲|乙

Q-pending2(流程):M2 那半(守門看不到「已收款而狀態沒翻」的匯款單)要不要併進本片?
  甲 = 拆另一片(推薦;本片已經要動三支寫入端)
  乙 = 併進來
  A: 甲|乙

Q-pending3(流程):第 1 步「建立分母」要不要先單獨做完再回報?
  甲 = 先做完唯讀那一步再回報(推薦;它可能推翻 §0 的三支)
  乙 = 一次做到底
  A: 甲|乙
```
