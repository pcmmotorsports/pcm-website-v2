# plan ·「錢已經真的退出去多少」收成一份 · 2026-09-11 · 窗 B

> 來源:`docs/handoff/CURRENT.md`「沒做完而沒有人接手」第 2 條(主視窗派)。
> 🛑 **只寫 plan,一行 SQL 都沒寫。** 碰錢 + 改活的金流函式(匯流點,七個呼叫端)⇒ 鐵則 8 等 Sean 批、鐵則 12 審。
> 🔵 讀數:repo 靜態 + 帳本 `supabase/APPLIED.tsv`(origin/dev);**零寫入**。

---

## 0. 一句話

同一條算式 ——「這張單的錢**已經真的出去**多少」—— 今天在**兩支函式各寫一份**:
退券函式 `coupon_revert_on_full_refund`,與退款狀態匯流點 `pcm_sync_order_refund_payment_status`。
**改了其中一份,另一份不會跟,也沒有東西會叫。**
客人今天不會有感覺(券 0 張、兩份逐字相同);**有人改其中一份的那天,券會退錯、或該退沒退。**

---

## 1. 兩份逐字對照

**① 匯流點**(最新一代 `supabase/migrations/20260910210000_m4b_coupon_revert_wiring.sql:140-158`,
與 `20260907140000` 同段逐字;正式庫 body md5 `5cd27b504015eb27ba3e8615a13bb149`,5,436 字元 ——
⟦R1 後⟧ 窗 B 09-11 下午 `scripts/readonly-prod-sql.sh` 親查;`210000` 已貼(Sean 貼板 126,origin/dev `APPLIED.tsv:616`、commit `8a77c44bd`))

```sql
SELECT COALESCE(pg_catalog.sum(refund_amount), 0) INTO v_moved
  FROM public.order_refunds
 WHERE order_id = p_order_id AND status = 'confirmed';

SELECT v_moved + COALESCE(pg_catalog.sum(refund_amount), 0) INTO v_moved
  FROM public.order_manual_refunds
 WHERE order_id = p_order_id AND voided_at IS NULL;

SELECT v_moved + COALESCE(pg_catalog.sum(r.refund_amount), 0) INTO v_moved
  FROM public.order_refunds r
  JOIN public.order_refund_effective_verdict v ON v.refund_id = r.id
 WHERE r.order_id = p_order_id
   AND r.status = 'failed'
   AND r.failed_reason = 'manual_failed'
   AND v.corrected_to = 'money_moved';
```

**② 退券函式**(唯一一代 `supabase/migrations/20260901020500_m4b_coupon_revert_on_full_refund.sql:174-188`;
repo 抽 body md5 `2b235b489870a10c4108b11080d84460`,6,649 字元 —— ⛔ ~~正式庫是否同值未親驗~~
⟦R1 後⟧ **正式庫同值,窗 B 09-11 下午親查**)

```sql
SELECT COALESCE(pg_catalog.sum(refund_amount), 0) INTO v_moved
  FROM public.order_refunds
 WHERE order_id = p_order_id AND status = 'confirmed';

SELECT v_moved + COALESCE(pg_catalog.sum(refund_amount), 0) INTO v_moved
  FROM public.order_manual_refunds
 WHERE order_id = p_order_id AND voided_at IS NULL;

SELECT v_moved + COALESCE(pg_catalog.sum(r.refund_amount), 0) INTO v_moved
  FROM public.order_refunds r
  JOIN public.order_refund_effective_verdict v ON v.refund_id = r.id
 WHERE r.order_id = p_order_id
   AND r.status = 'failed'
   AND r.failed_reason = 'manual_failed'
   AND v.corrected_to = 'money_moved';
```

⇒ **今天兩份逐字相同**(三段、表、述詞、`COALESCE` 位置都一樣)。
🔴 **判準也相同**:兩邊都是 `v_moved > 0 AND v_moved >= v_total`(匯流點 `:172`、退券 `:212`)。
退券函式自己在 `020500:141-146` 寫了:「這是第二份同口徑的碼,而沒有東西在守它 …… 對方改了,本支不會叫」。

🔵 **不在本 plan 範圍的同族**(寫下來免得有人以為收完了):
`pcm_order_refundable_remaining`(`20260820100000:230-246`)答的是「**還能退多少**」,第一段含 `processing`
⇒ 族群不同,**不併進來**(退券刻意不用它的理由在 `020500:119-139`)。

---

## 2. 今天守它的是什麼 —— 而它守不到「兩份一不一樣」

```
① refund-remaining-single-source.test.ts 的 SQL_ALLOWLIST(窗 B 09-11 登記, da42b5039)
   020500 count 3 · 210000 count 3
   它會紅的時候:有【新的】migration 碰 refund_amount 而沒登記 / 那兩支檔的出現次數變了
   🔴 它不會紅的時候:有人在新 migration 裡改了匯流點的三段、而沒動退券函式
      ⇒ 新 migration 被攔下要求登記 ⇒ 登記的人答了那一題就放行 ⇒ 兩份從此不同, 零訊號
   ⇒ 📌 它逼人【回答一題】, 不逼兩份【一樣】
② apply 期那道釘子 —— 已被裁掉(020500:147-163, 主視窗 -59 09-11 裁甲)
   理由:020500 的版本號在匯流點之前 ⇒ 釘一個未來才出現的東西 ⇒ 從零重建必失敗
```

---

## 3. 做法

### 甲 · 抽一支共用函式,兩邊都改叫它 ✅ 推薦(完整版)

```
新增  public.pcm_order_money_moved(p_order_id uuid) RETURNS bigint
      LANGUAGE sql · SECURITY INVOKER · SET search_path = ''
      本體 = §1 那三段的述詞逐字搬過去,寫成【三個純量子查詢相加】
             SELECT (SELECT COALESCE(sum…),0 …) + (SELECT …) + (SELECT …)
             (LANGUAGE sql 不能三句 INTO;⛔ ~~「一次 SELECT 三個 COALESCE 相加」~~ 字面不準)
      🔵 VOLATILE(預設)—— 理由是「不值得賭」,不是「STABLE 會錯」:
         呼叫端是 plpgsql 的一句 assignment,在鎖單之後才開始、READ COMMITTED 下自帶新快照,
         STABLE 也讀得到並行提交(R1 nit)。
      🔴 權限:REVOKE ALL FROM PUBLIC / anon / authenticated / service_role
         ⇒ 只有 owner(postgres)的兩支 SECURITY DEFINER 叫得到;不開成 RPC
CREATE OR REPLACE 匯流點   三段換成 v_moved := public.pcm_order_money_moved(p_order_id);
                          其餘 body 逐位元組照抄 20260910210000(含接線那一行)
CREATE OR REPLACE 退券函式 同上;其餘照抄 020500;:141-173 那段「第二份碼」註解改寫成「已收成一份」
🔴 header 也要逐字保留(⟦R1 must-fix 2⟧:CREATE OR REPLACE 會把 SET 子句整組換掉 ——
   memory `reference_create-or-replace-resets-set-clause`;「body 照抄」不含 header):
   匯流點   SECURITY DEFINER + SET search_path = ''                       (210000:105-106)
   退券函式 SECURITY DEFINER + SET search_path = '' + SET lock_timeout = '3s'(020500:83-93)
   ⚠️ 退券函式那顆 lock_timeout 原 plan 沒寫 —— 正式庫 proconfig 親查是
      {search_path="", lock_timeout=3s};漏抄 ⇒ 靜默變成無限等鎖,沒有任何東西會叫
簽章   兩支都不變 ⇒ 七個呼叫端一個都不用改;021000 / 030000 的前置閘問「存在、是 function、
      剝註解後 body 含 reverted_at」(021000:311-315、030000:375-379)⇒ 改寫後 body 仍有
      SET reverted_at(020500:231)⇒ 不受影響(⟦R2 nit⟧ 原字面少了第三格)
版本號 > 20260910210000(兩支最後一次被重新定義的地方)
```

**前置閘(fail-closed,apply 當下)**
```
① pcm_order_money_moved 不存在(存在 ⇒ 貼過了, 拒重跑)
② 匯流點 md5(prosrc) = 5cd27b504015eb27ba3e8615a13bb149
③ 退券函式 md5(prosrc) = 2b235b489870a10c4108b11080d84460
   ⇒ 任一不符 = 有人在我之後改過它 ⇒ 我的 CREATE OR REPLACE 會蓋掉那個改動 ⇒ 停
④ 兩支 proconfig 含 search_path=""、owner = postgres
⑤ ⟦R1 後⟧ 版本號 > 20260910210000 只在 repo 內有意義;正式庫照貼板順序 ⇒ 真正的約束是
   「貼在 210000 之後」—— 已滿足(210000 = 貼板 126)。閘② 釘 5cd27b50 就是在證這一格
```
**事後斷言**(⟦R1 must-fix 2⟧ 補齊 —— 原版只數字面,不查 header;兩支今天的呼叫端全是 definer,
掉了 SECURITY DEFINER 也不會當場叫,**正因為靜默才要斷言**):
```
兩支剝行註解後各含一次 pcm_order_money_moved、refund_amount 零次
兩支 prosecdef = true
匯流點   proconfig = {search_path=""}                    (正式庫親查現值)
退券函式 proconfig = {search_path="", lock_timeout=3s}   (正式庫親查現值)
匯流點   proacl = {postgres=X/postgres}                  (正式庫親查現值)
退券函式 proacl = {postgres=X/postgres,service_role=X/postgres}(親查;對齊 020500:256-264)
helper   proacl 只剩 owner;prosecdef = false
兩支 provolatile='v' · proleakproof=false · proparallel='u'(正式庫現值皆預設;⟦R2 nit⟧ 釘住,不靠「剛好是預設」)
⚠️ 寫 migration 時 proconfig 用 ARRAY['search_path=""'] 比對,不拿 psql 印出來的字串比(那是 {"search_path=\"\""})
```

**等價證明(拋棄式 PG,貼之前)**
```
種一張單 × 以下組合, 新舊兩條算式逐張比 ⇒ 必須全等:
  confirmed 卡退 · processing 卡退(不算)· 已作廢卡退 · 人工退款 / 已作廢人工退款 ·
  manual_failed 未判定(不算)/ 判 money_moved(算)/ 判 not_moved(不算)· 超退 · 零元單
+ 接線那道驗收照跑(落點① 全額退 ⇒ 券退、部分退 ⇒ 不退;落點② 取消 ⇒ 券退)
+ 突變:helper 少一段 ⇒ 等價表必紅;helper 多算(第三段 JOIN 改成會重複列)⇒ 必紅
⟦R1 nit⟧ 組合補三格:
  同一筆 manual_failed 多筆更正、最後一筆 not_moved(view 取 seq 最大 ⇒ 不算)
  backfilled 的 confirmed(兩邊都算 —— 寫下來免得有人以為漏)
  failed 但 failed_reason ≠ manual_failed 卻被判 money_moved(兩邊都不算)
```

**rollback**:一支檔, **內含兩支函式【收成一份之前】的完整 body**(§1 那兩版,不寫「去某檔複製」)。
先驗兩支 md5 = 收成一份之後那兩個值(不是 ⇒ 有人又改過 ⇒ 停,改手寫);換回 → 再 `DROP FUNCTION pcm_order_money_moved`。
🔴 ⟦R2 must-fix⟧ 回捲的 CREATE OR REPLACE 一樣會重設 SET 子句 ⇒ **header 逐字同上面「header 也要逐字保留」那段**
(退券函式含 `SET lock_timeout = '3s'`);換回之後跑**同一組**事後斷言(prosecdef / proconfig / proacl,期望值 = 正式庫今天現值)。
🔵 單向的那一格:無 —— 本片不寫任何資料, 回捲後行為與今天逐位元相同。
🔴 **回捲鏈**(⟦R1 must-fix 1⟧ 裡成立的那一半):本支貼了之後,匯流點 md5 不再是 `5cd27b50…`
⇒ `supabase/rollbacks/20260910210000_down.sql:37` 的 md5 前置閘會紅
⇒ **要回捲接線,得先回捲本支**。rollback 檔頭與接線那支 down 檔都要寫這一句。

**守門跟著改**:`SQL_ALLOWLIST` 新增這支 migration(helper 內 3 處 refund_amount —— 前提是 RAISE 訊息字串裡不含這個字;
寫的時候以測試當場印的實數為準,⟦R2 nit⟧),why 寫「這是『已真的出去多少』的唯一來源」;
020500 / 210000 兩筆的 why 補一句「已由 <版本號> 收成一份」。

**碰什麼**:一支 migration + 一支 rollback + 一支測試檔(allowlist)。**不碰 app 碼。**
**動到活的東西**:匯流點(退款狀態同步, 7 支退款函式呼它)。等價證明就是為這一格。

### 乙 · 維持兩份,加一道「兩份必須逐字相同」的守門測試

```
新增  一支 vitest:從 repo 找兩支函式【最新一代】的 body, 剝註解後抽出那三段, 比對逐字相同
      不同 ⇒ 紅, 訊息寫「改了一邊要改另一邊」
碰什麼  一支測試檔。不動正式庫、不寫 migration、不碰金流函式
代價  🔴 仍然是兩份 ⇒ 守的是 repo 字面, 不是正式庫;有人在 SQL Editor 手改一邊, 它看不到
      而它與已被裁掉的那道 apply 期釘子不同:它只讀 repo, 不在 apply 當下擋 ⇒ 不會讓從零重建失敗
```

### 為什麼推甲
Sean 2026-09-11 對碰客人錢的兩題都推翻「最小版」(Q2 逐字「那就補完整版不就好了? 何必又做一半」)。
乙 是「加一道守門」—— 它讓漂移**會叫**,但**兩份還在**;甲 讓漂移**不可能發生**。
甲 的代價是再動一次匯流點,而那正是等價證明與 md5 前置閘要付的錢。

---

## 4. 我證不到什麼

1. ⛔ ~~**退券函式在正式庫上的 md5** 我沒親驗~~ ⟦R1 後⟧ **已親驗 = `2b235b48…`**(09-11 下午唯讀查)。前置閘 ③ 照留,守的是「我查完之後到貼之前」那段。
2. **七個呼叫端**沿用接線 plan 的量測(`docs/plans/2026-09-11-coupon-revert-wiring-plan.md:15-16`),本次沒重數;簽章不變 ⇒ 它們不受影響是推的。
3. `STABLE` vs `VOLATILE` 的快照差異是依 PG 文件推論,**沒在拋棄式 PG 量過** ⇒ 甲 選 VOLATILE 就是為了不必依賴這一格。

---

## 5. 給 Sean 的題(白話)

> 背景一句:「這張單的錢已經退出去多少」這個算法,系統裡寫了兩份 ——
> 一份決定訂單的付款狀態,一份決定要不要把優惠券還給客人。今天兩份一模一樣。
> 問題是:以後有人改了其中一份、忘了改另一份,**不會有任何警告**,券就可能退錯。

```
Q:這兩份算法要怎麼處理?
A:  甲 合成一份, 兩邊都去用同一個(推薦)
       ⇒ 這兩支以後只有一個地方可以改
          (有人硬要寫第三份還是寫得出來 —— 擋那個的是既有的登記檢查, 不是這一刀)
       ⇒ 要改一次正在跑的退款程式(不改它算出來的結果), 要你授權貼一次資料庫;
          貼之前會先在測試資料庫證明新舊兩種算法每種情況都算出一樣的數字
       ⇒ 代價:之後如果要撤掉「券退回」那一刀, 得先撤這一刀(順序綁住)
  | 乙 維持兩份, 加一道檢查:兩份不一樣就會亮紅燈
       ⇒ 不動正式資料庫、不動退款程式
       ⇒ 但還是兩份;而且只檢查程式碼, 有人直接在資料庫手改它看不到
```

---

## 6. 審查結論(2026-09-11 窗 B)

```
R1  Fable 5.1 唯讀  VERDICT: FAIL · 2 條 must-fix · 6 條 nit
```

| # | R1 說什麼 | 查了之後 | 怎麼收 |
|---|---|---|---|
| MF1 | 「`5cd27b50` 正式庫核過」不是事實 —— `210000` 沒貼(依 `APPLIED.tsv` 查無) | 🔴 **R1 的前提過期**:它讀的是本樹 `agent/ops` 的帳本(分叉,沒有那一列);origin/dev `APPLIED.tsv:616` 有 `20260910210000`(貼板 126,`8a77c44bd`),而窗 B 09-11 下午唯讀親查正式庫匯流點 md5 = `5cd27b50…` · 5,436 字元 | 事實那半**不改結論**,§1 改成附親查出處;**成立的那半收進來**:回捲鏈(本支貼了之後,接線的 down 檔 md5 閘會紅 ⇒ 先回捲本支)寫進 §3 rollback 與 §5 白話代價;版本號約束改寫成「貼在 210000 之後」(前置閘 ⑤) |
| MF2 | CREATE OR REPLACE 會重設 SET 子句;事後斷言沒查 `prosecdef` / `proconfig` | ✅ 成立,**而且比 R1 講的多一格**:退券函式還有 `SET lock_timeout = '3s'`(`020500:93`,正式庫 proconfig 親查 `{search_path="", lock_timeout=3s}`),原 plan 與 R1 都沒提 | §3 header 逐字保留兩支的 SECURITY DEFINER + SET 子句;事後斷言補 prosecdef / proconfig / proacl 三格,期望值全部取自正式庫親查 |

**nit 全收**:helper 寫成三個純量子查詢相加 · VOLATILE 理由改成「不值得賭」· 退券函式正式庫 md5 已親驗(§4-1)· 等價組合補三格 + 「多算」突變 · 白話補「順序綁住」與「第三份仍寫得出來」· 版本號約束。

**R2**:MF1 的事實前提不成立而另一半已收、MF2 已收 ⇒ 依鐵則 12 跑 R2(R1 FAIL)。

```
R2  Fable 5.1 唯讀  VERDICT: FAIL · 1 條 must-fix · 4 條 nit
```
- ✅ **MF1 反駁成立**:R2 自己查 origin/dev `APPLIED.tsv:616` 與正式庫 pg_proc,md5 / 長度 / proconfig / proacl 與 plan 全部一致
- ✅ **MF2 正向那半成立**
- 🔴 **R2 must-fix**:rollback 段只寫「完整 body」,沒寫 header ⇒ 回捲時一樣會掉 `lock_timeout` / DEFINER
  ⇒ **已改**:§3 rollback 補「header 逐字同正向、回捲後跑同一組事後斷言」
- nit 全收:前置閘第三格(`reverted_at`)· 釘 provolatile / leakproof / parallel · proconfig 用陣列比對 · allowlist 實數以測試為準

🛑 **R2 仍有 must-fix ⇒ 修完就停,不跑 R3**(主視窗 09-11 指示)。這一條是純文字補一句,不改做法、不改給 Sean 的題。
