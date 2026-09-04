# plan · 翻開匯款開關之前的兩個競態

> 線【信】`-mail` 2026-09-05 · **只寫 plan, 一行碼都沒動**(鐵則 8 等批)· 兩列 `⟦b4-NCPCRONRACE⟧` / `⟦b4-NCPCANCELROLLBACK⟧`。

## 🔴🔴 先講一件會改變優先序的事 —— **板上那句「有安全網接住」是假的**

`⟦b4-NCPCRONRACE⟧` 那一列逐字寫著「有既有安全網接住 ⇒ 那筆錢會落到 `order_pending_refunds` 上, 不是消失」。
🔬 **我開檔看了那支 trigger 的【最新那一版】**(`20260902030000:237` —— 不是板上引的 `20260901080000` 那版):
它掛 `orders` 的 **AFTER UPDATE**(`cancelled_at` 由 NULL 變非 NULL 那一刻), 而它 INSERT 的資料
來自 `pcm_pending_refund_amounts(NEW.id)` —— **那支【當下】算 `order_payments`。**
🎯 **而本競態的時序恰好是:取消先提交, 收款【之後】才落帳。**
⇒ 取消那一刻 `order_payments` 上**一列都沒有** ⇒ 那支函式回 0 列 ⇒ **一列待退款都不會開。**
⇒ 🛑 連那句「收過錢而算出來不欠 ⇒ 出聲」的 `RAISE WARNING` **也不會響** ——
　 它的條件是 `EXISTS (SELECT 1 FROM order_payments …)`, 而那一刻也是假。
⇒ 🔴🔴 **安全網【結構上】接不到這一族。錢落在一張已取消的單上, 而沒有任何一列、任何一句話。**
🔵 那一列自己標了「此判斷未經 Sean 也未經 codex 覆核」—— 📌 **它標對了, 而標記保護下游, 不保護結論。**

---

## 1. `⟦b4-NCPCRONRACE⟧` —— 具體時序
```
T0  客人按下匯款/員工登記收款 ⇒ 交易開始, INSERT order_payments
      ⇒ FK 對 orders 那一列要 KEY SHARE
T1  逾期 cron 醒來, SELECT … FOR UPDATE OF o SKIP LOCKED 先拿到那一列
      (FOR UPDATE 與 KEY SHARE 衝突 ⇒ 🔴 T0 那筆 INSERT 開始【等】)
T2  cron UPDATE orders SET cancelled_at = now() ⇒ AFTER UPDATE 觸發安全網
      ⇒ 此刻 order_payments 零列 ⇒ 🔴 不開待退款、不出聲
T3  cron 提交 ⇒ T0 那筆 INSERT 拿到鎖、落帳
T4  order_payments 的 AFTER INSERT 觸發重算 ⇒ 它對已取消的單 RETURN(那是對的)
⇒ 🛑 結果:一張【已取消】而【淨收款 > 0】的單, 帳本上零痕跡。
```
🔵 **客人那一端**:訂單顯示已取消而錢出去了 ⇒ 他會打電話來, 而客服查不到待退款列。

## 2. `⟦b4-NCPCANCELROLLBACK⟧` —— 具體時序
```
T0  收款 INSERT ⇒ AFTER INSERT ⇒ pcm_noncard_settle_recompute
T1  重算在等某把鎖(advisory / OP6a 內部)
T2  撞到 statement_timeout(或有人 pg_cancel_backend)⇒ SQLSTATE 57014
T3  🔴 `EXCEPTION WHEN OTHERS` 依 PostgreSQL 定義【不接】query_canceled
      ⇒ 例外冒出整個交易 ⇒ **客人那筆收款一起回滾**
⇒ 🛑 結果:錢從系統裡消失(那筆 INSERT 從來沒發生過)。
```
🔴 **它在事後【量不到】** —— 回滾之後 DB 上什麼都沒有 ⇒ 📌 **這一條沒有「發生過幾次」的答案**, 只有應用層錯誤紀錄可能看得到。

---

## 3. 今天發生機率的量法(唯讀 SQL, 給線【資料】`-db` 跑)
```sql
-- 🔴 競態一的煙硝:已取消 + 淨收款>0 + 一列待退款都沒有
SELECT count(*) AS smoking_gun
  FROM public.orders o
 WHERE o.cancelled_at IS NOT NULL
   AND (SELECT coalesce(sum(p.amount),0) FROM public.order_payments p
         WHERE p.order_id = o.id) > 0
   AND NOT EXISTS (SELECT 1 FROM public.order_pending_refunds r WHERE r.order_id = o.id);
-- 🟢 正對照(尺會動, 且【同類】):已取消 + 淨收款>0 + 【有】待退款列 ⇒ 期待 > 0
-- ⚪ 負對照:把 cancelled_at IS NOT NULL 換成 IS NULL 再跑一次 ⇒ 兩者不該相等
```
⚠️ **三個誠實邊界(缺一就不要引用那個數字)**:
1. 🔴 正式庫今天 `orders` **只有 1 張單**(`-db` 2026-09-04 18:07 UTC 逐層實查)⇒ 📌 **這三格今天全印 0, 而那答的是「庫是空的」。**
2. 競態二**沒有對應的 SQL**(回滾不留痕)。3. 兩者只在匯款結帳開著時才可能發生, 而它今天關著 ⇒ **歷史樣本必然是 0。**

## 4. 修法各兩案
### `⟦b4-NCPCRONRACE⟧`
| | 做法 | 代價 |
|---|---|---|
| 甲 | **在錢落帳那一刻補網**:`order_payments` 的 AFTER INSERT 發現單已取消 ⇒ 開一筆待退款 | 動的是 `20260904230000` 那支重算(**錢**, 鐵則 12①);要確保新邏輯**不會**讓客人那筆 INSERT 回滾(同 §2 的陷阱) |
| 乙 | **事後掃描器**:一支排程找「已取消 + 淨額>0 + 無待退款列」並補開 | 不預防只修補;新增 pg_cron 排程(鐵則 12③ + 平台設定);而**它與 `⟦b4-SETTLERETRYNEVER⟧` 的甲案是同一支掃描器** ⇒ 可以合成一件 |
🔵 **推薦甲** —— 它在**資訊存在的那一刻**關洞(同時知道「錢到了」與「單已取消」), 乙的視窗是掃描間隔。
🛑 **而甲要先解決 §2**, 否則補網那個動作自己會變成回滾的來源。

### `⟦b4-NCPCANCELROLLBACK⟧`
| | 做法 | 代價 |
|---|---|---|
| 甲 | 明寫 `EXCEPTION WHEN query_canceled THEN …` 把它也吞掉 | 🔴 **吞掉 cancel = 讓 `statement_timeout` 與人工 `pg_cancel_backend` 失效**;而那兩個是保護 DB 的東西 ⇒ 用一個安全問題換另一個 |
| 乙 | **把重算移出收款那個交易**(改成排隊/非同步:INSERT 只寫一列待重算, 由排程跑) | 動 trigger 形狀 + 新表 + 新排程(鐵則 12③);而「重算延遲」會讓客人的狀態晚幾分鐘才對 |
🔵 **推薦乙** —— 它讓**收款不再依賴重算成功**;甲只是把一種失敗換成另一種。
🛑 板列逐字記著同款 `EXCEPTION WHEN OTHERS` 全 repo 還有別處(`20260903080000` 心跳段)
　 ⇒ 📌 **單獨為這一片解會變成只有這一片特別。乙 的粒度才對。**

## 5. 要不要新 DB 物件
一甲/二甲 = 不新增物件(改既有函式);一乙 = 新函式 + 新排程;二乙 = 新表 + 新排程 + 改 trigger。
⇒ **推薦組合(一甲 + 二乙)= 改一支既有函式 + 一張新表 + 一支新排程。**
⇒ 🔴 全部命中鐵則 12①③ ⇒ codex 不降級;**排程屬平台設定 ⇒ Sean 批 plan 才能動。**

## 6. 翻開關的先後 —— **各要接受什麼**
```
🔴 修前翻(先開匯款, 邊跑邊修)
   要接受:①競態一發生時, 錢落在已取消的單上而【帳本零痕跡】 —— 客人打來時查不到
           ②競態二發生時, 客人的收款【消失】, 而事後 DB 上量不到
   🔵 而兩者都要求「逾期 cron 剛好與收款同時」或「重算剛好撞 timeout」⇒ 機率低
   🛑 **而「機率低」這句話沒有來源** —— 沒有人量過, 而 §3 說明了今天量不到。

🔵 修後翻(先修完兩條再開)
   要接受:匯款結帳晚一段時間才上線(工期 = 一甲 + 二乙, 都要過 codex + Sean 批 plan)
```
🎯 **本線的建議**:**競態一先修(甲), 競態二可以帶著上線** ——
　 理由是**可見性不是機率**:競態一**沒有任何訊號**(這正是本檔 §開頭訂正的那件事),
　 而競態二至少會在應用層丟一個錯誤 ⇒ 有人會看到。
　 🛑 **⇒ 而這是判斷不是量測。兩者的頻率我都沒有數字, 誰都沒有。**

---

# 附錄 · 競態一「甲」的 SQL 草稿(**草稿, 不是 migration**)

> 🛑 **本節【刻意不放進 `supabase/migrations/`】** —— 放進去它就會被當成一支待貼的 migration,
> 而**它還沒有被 Sean 批**(排程/schema 屬平台設定 + 鐵則 8)。Sean 答甲之後才搬。
> ⚠️ **而搬的時候是【重寫成 migration】不是複製** —— 版本號、`BEGIN;/COMMIT;`、前置閘都要重來。

## A0 🔴 先訂正一個範圍:**競態一甲【不需要新表, 也不需要新排程】**
```
本檔 §5 逐字:一甲/二甲 = 不新增物件(改既有函式);二乙 = 新表 + 新排程 + 改 trigger
⇒ 「改既有函式 + 新表 + 排程」是【一甲 + 二乙 合起來】的物件清單, 不是一甲自己的。
```
⇒ 📌 **一甲 = 改一支既有函式(`pcm_noncard_settle_recompute`), 零新物件。**

## A1 要達成的不變式
> **錢落在一張【已取消】的單上時, `order_pending_refunds` 上必須有對應的一列。**

今天做不到的原因(§開頭已證):安全網掛 `orders` 的 AFTER UPDATE, 而**錢是取消【之後】才到的**。

## A2 修法形狀 —— 🔵 **推薦抽共用函式, 不要複製第二份**
```
現況  pcm_pending_refund_on_cancel()  ← 內含「算金額 + 解 cancellation_id + INSERT…ON CONFLICT」
推薦  抽出 pcm_pending_refund_open_for(p_order_id uuid) RETURNS void
      · 取消 trigger 呼叫它
      · pcm_noncard_settle_recompute 在【單已取消】那條路上也呼叫它
```
🛑 **為什麼不直接複製那段 INSERT**:今晚實測過同型的病 —— **複製一份檢查, 兩份會各自漂,
　 而漂掉的那一半在 diff 上與「本來就這樣」長得一樣。** 這一段裡有三個容易漂的東西:
　 `ON CONFLICT` 的部分索引條件 · `DO UPDATE` 的欄位集 · `cancellation_id` 那個「v_n <> 1 就留 NULL」的判斷。

## A3 草稿(**未在任何 PG 上跑過**)
```sql
-- ① 抽共用(把現行 pcm_pending_refund_on_cancel 的 DECLARE/BODY 原封搬進來, 主詞由 NEW.id 換成 p_order_id)
CREATE OR REPLACE FUNCTION public.pcm_pending_refund_open_for(p_order_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_cid uuid; v_n int; v_cancelled_at timestamptz;
BEGIN
  SELECT o.cancelled_at INTO v_cancelled_at FROM public.orders o WHERE o.id = p_order_id;
  IF v_cancelled_at IS NULL THEN RETURN; END IF;          -- 沒取消 ⇒ 不開
  SELECT count(*) INTO v_n FROM public.order_cancellations c
   WHERE c.order_id = p_order_id AND c.created_at = v_cancelled_at;
  IF v_n = 1 THEN
    SELECT c.id INTO v_cid FROM public.order_cancellations c
     WHERE c.order_id = p_order_id AND c.created_at = v_cancelled_at;
  ELSE
    IF v_n > 1 THEN RAISE WARNING '待退款歸屬留白 — 訂單 % 有 % 筆取消單(期望 1)⇒ cancellation_id 留 NULL 不猜。', p_order_id, v_n; END IF;
    v_cid := NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM public.order_payments p
              WHERE p.order_id = p_order_id AND p.rail IN ('bank_transfer','cash'))
     AND NOT EXISTS (SELECT 1 FROM public.pcm_pending_refund_amounts(p_order_id)) THEN
    RAISE WARNING '取消單 %:這張單收過非卡的錢, 而算出來一列待退款都不用開。', p_order_id;
  END IF;
  INSERT INTO public.order_pending_refunds (order_id, cancellation_id, rail, amount_at_cancel)
  SELECT p_order_id, v_cid, a.rail, a.amount FROM public.pcm_pending_refund_amounts(p_order_id) AS a
  ON CONFLICT (order_id, rail) WHERE voided_at IS NULL AND settled_at IS NULL
  DO UPDATE SET amount_at_cancel = EXCLUDED.amount_at_cancel, cancellation_id = EXCLUDED.cancellation_id;
END $fn$;

-- ② 取消 trigger 改成呼叫它(本體換成一行, 前面那兩個 early-return 的判斷留在 trigger 裡)
-- ③ pcm_noncard_settle_recompute:原本「單已取消 ⇒ RETURN」那條路, 改成先呼叫再 RETURN
--    🔴 位置要在【那個 BEGIN…EXCEPTION 區塊之內】—— 它丟例外時不得回滾客人那筆收款。
```

## A4 事後閘(貼上去那一發要驗的)
```
① 兩支函式都存在, 且 pcm_pending_refund_on_cancel 的 prosrc 含 'pcm_pending_refund_open_for'
   ⇒ 證明它【真的改成呼叫共用的那支】, 不是留了一份複製
② ACL:新函式對 PUBLIC/anon/authenticated 全 REVOKE(照 20260901080000 那四行的形狀)
③ 🟢 正對照:pcm_pending_refund_amounts 仍存在且可呼叫(共用函式依賴它)
④ ⚪ 負對照:對一張【未取消】的單呼叫 open_for ⇒ order_pending_refunds 不增一列
```
## A5 rollback
```
DROP FUNCTION public.pcm_pending_refund_open_for(uuid);
並把 pcm_pending_refund_on_cancel 與 pcm_noncard_settle_recompute
用【它們各自上一版的 CREATE OR REPLACE 全文】貼回去
🛑 而「上一版全文」要用 scripts/latest-definition-of.sh 當場撈, 不要憑記憶
```
## A6 🔴 已知代價(不要在 review 時才發現)
```
① 它把工作放進【客人那筆付款的交易裡】⇒ 加大 ⟦b4-NCPCANCELROLLBACK⟧(競態二)的窗口
   ⇒ 📌 修競態一的動作, 讓競態二更容易發生。兩者要一起排, 不要只做一個。
② DO UPDATE 會把既有那一列的 amount 覆寫成【現在算出來的】——
   那是對的(金額本來就該反映最新事實), 而**它會蓋掉一個已經被人看過的數字** ⇒ 稽核上要能追。
③ 本草稿【未在任何 PG 上跑過】—— 它是形狀不是驗證。搬成 migration 時要在拋棄式 PG 實跑。
```
