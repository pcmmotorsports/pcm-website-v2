# A4a 回滾 runbook:`order_item_quantity_summary` 已有真實資料時的撤除程序

> 依據:master plan `:373-377`(A4a DoD 硬前置)+ A1 plan §9(:383-389,「A4a 之後不得照抄 §9」的接棒者)。
> 片級 plan = `docs/specs/2026-08-03-e10-a4a-summary-recompute-plan.md` §6;演練 = `scripts/a4a-rollback-rehearsal.sh`(健康 + drift 雙變體,A4a 收工前必綠)。
> 執行者 = owner(postgres;Sean 經 dashboard SQL editor)。每一步 = 可直接複製的 SQL。
> 🔴 原則:**依賴未清零前不得 DROP 表**;對帳分歧**不是 abort 是分流**(災難日的正典輸入就是「摘要壞了」);abort 只留給「真相表自身讀不到」。

---

## 🚨 災難日執行卡(先讀這一頁,再往下)

> 2026-08-08 W7c R3 補。本檔 830+ 行、`🔴` 超過 120 個 ⇒ **當每段都紅,紅就不再是排序**。
> 這一節是**唯一**「不照做就會出事」的清單;其餘所有 🔴 都是背景與理由,慢慢讀沒關係。

**開工前的 30 秒探針(不做這個,下面整套在 dashboard 上是賭的)**

②→⑤ 的 `BEGIN…COMMIT` **跨四個步驟、跨多次 Run**。
Supabase dashboard SQL editor **會不會跨 Run 保住同一個交易,本 repo 從未實測**。
不成立的話下場是:② 的 CTAS 在該 Run 結束時**靜默回滾**,而④ 的 `DROP` 自己提交落地
⇒ **拆完了、快照沒了**,⑤ 才紅 `42P01`,那時已經回不去。⇒ **先跑這個探針**:

```sql
-- Run 1(貼這一塊、按一次 Run)
BEGIN;
CREATE TABLE public.a4a_txn_probe(x int);
```

```sql
-- Run 2(另外按一次 Run)
SELECT * FROM public.a4a_txn_probe;
```

- Run 2 **看得到表** ⇒ 交易有跨 Run 保住,可以在 dashboard 做。跑 `ROLLBACK;` 清掉再開始。
- Run 2 紅 **`42P01`** ⇒ 🔴 **編輯器不保交易,本檔 ②-⑤ 在 dashboard 上不可執行** ——
  改用 `psql` 單一連線跑,或停下來找工程 session。**不要硬做。**

**五條會死人的**

| # | 規則 | 不照做的下場 |
| --- | --- | --- |
| 1 | **②-⑤ 必須是真的一個交易**(先跑上面的探針) | 拆完了但快照沒了,無法回頭 |
| 2 | **每個動作與它的驗證,分兩次 Run 跑** | 驗證跑在同一個未提交交易內 ⇒ 一定看到自己剛做的效果、對「沒提交」零判別力 |
| 3 | **凡是沒走完⑦ 就離場(停在④、中止、放棄),都要把權還回去** | 採購存不了 + 貨出不了,而系統看起來一切正常 |
| 4 | **⑦ 先 `ENABLE TRIGGER`、再 `GRANT` 出貨 writer**,順序不可換,且都不可跳過 | 反過來會開出一個「真相在動、摘要沒動」的窗;跳過則出貨側永久停寫、三軸對帳仍全綠、零告警 |
| 5 | **`DROP` 摘要表前,先把 PostgREST 那兩條 select 字串的內嵌拿掉**(步驟③(b)) | admin 訂單**列表 + 明細兩頁一起壞**;🔴 這步要改 TS 並部署,**Sean 一個人做不到,要工程 session** |

🔴 **回滾途中撞到紅燈,不要去附錄 A 找鑰匙把守門關掉硬推** —— 附錄 A 是平常日用的,理由見該節開頭。

---

## 步驟 ①:停寫停守門

🔀 **2026-08-03 已回寫**(A5a migration 已寫成;**2026-08-03 已 apply 正式站**——本行 2026-08-04 A8a1 片更新,來源=`docs/handoff/CURRENT.md:5-6`(ledger 尾=`20260803160000`)與 `:12-13`(「三片皆已 apply,read-back 全符」);⚠️ STATUS.md 08-03 晚段寫的 ledger 尾=`20260803150000` 是 A5a apply **前**的快照、不含 A5a,勿引;本節寫的是 A5a 落地之後的程序),
契約(A4a plan §11 債⑦)結案。A5a 上線後採購側就有一支 writer RPC;
到貨明細(`order_item_procurement_receipts`)仍為零寫 GRANT、無 writer。
🔴 **2026-08-08 W7c 更正**:本行原本還寫「取消側(`order_cancellation_items`)仍為零寫 GRANT、無 writer」,
**那句已經是假的** —— A8a2(`20260805100000:433,438`)的 `admin_cancel_order` 就是取消側的 writer,
它 `INSERT INTO public.order_cancellation_items`、且對 `service_role` 有 EXECUTE(實查)。
⇒ 取消側**有 writer**,細節見下方**債⑤**。照舊字面讀的人會直接略過「要不要停取消」這個判斷。

🔴 **(1) / (1a) / (1b) / (2) 必須是<u>四次</u>獨立執行、中間確定已提交**(2026-08-08 W7c:原為三次,出貨側五支 writer 的 REVOKE = 新增的 (1a);2026-08-06 R2:(1b) 若與 (2) 併一次跑,`revoke_at` 會在 DISABLE 對他人生效前記下 ⇒ drain 濾不到窗內的出貨寫入) —— 若整段被包在同一個交易裡(Dashboard SQL editor
把多句當一個交易送出時就會這樣),REVOKE 在提交前對其他連線不生效:那段期間新的 RPC 呼叫照樣進得來,
而它們的 `xact_start` 會**晚於** `revoke_at` ⇒ 正好被 (3) 的條件漏掉。
⇒ **照順序、一次一塊、每塊跑完都確認回到非交易狀態**:`(1)` → `(1a)` → `(1b)` → `(2)`。
(2026-08-08 W7c:本句原本只寫「先跑 (1) 再跑 (2)」,漏了中間兩塊。)
(Dashboard 是否把多句包成單一交易,repo 內未實測 ⇒ 一律當成會包。)

🔴🔴 **契約債①(2026-08-06 B2-S2b-3a 前段更新:上一版說「本步暫時完整」,那句<u>已經不成立</u>)**:
本步現在 REVOKE **採購側 1 支(A5a)+ 出貨側 5 支 writer**(2026-08-08 W7c;在那之前只有採購側那一支)。
**出貨側的第二條寫入路徑已經存在** ——
B2-S2b-1(commit `4ef591b`)建的 `shipments_summary_recompute_ac` 重算 trigger,
只要有人 `UPDATE shipments SET shipped_at / deleted_at`,摘要表的 `shipped_quantity` 就會被改。
✅ **停寫動作已補**(2026-08-06 B2-S2b-3b:見下方 **(1b)**;對稱的 `ENABLE` 在**步驟⑦**)。
✅ **真相側停寫也已補**(2026-08-08 W7c:見下方 **(1a)** 五支 writer;對稱的 `GRANT` 在**步驟⑦**)。
🔴 **仍未涵蓋的**:債⑤(下一段)。
🔴 另有**債⑤**(plan §9 交棒 9):`admin_cancel_order` 對 `service_role` 有 EXECUTE,
它經 A4a trigger 也寫得到摘要表 ⇒ 「A5a 是唯一 service_role 寫入口」這句本來就不精確。
🔴 **2026-08-08 W7c 記帳(簽章已實查,災難日要停它時直接抄)**:
`admin_cancel_order(uuid, uuid, text, text, text, jsonb)` —— 全 migration 重放至 `20260808000000`
後查 `pg_proc`:**恰一個 overload**、`has_function_privilege('service_role',…,'EXECUTE') = true`。
停它的寫法與 (1a) 同形:`REVOKE EXECUTE ON FUNCTION public.admin_cancel_order(uuid, uuid, text, text, text, jsonb) FROM service_role;`
🔴 **本片<u>沒有</u>把它加進 (1a) 的停寫序列**,理由要講明:取消線(A8)的災難日行為不屬本片權限,
而「回滾期間要不要一併停掉取消」是**業務決定**(停了 = 客服當天無法取消訂單)。
⇒ 已列為**待 Sean 裁**的決策題(見本檔最後的〈附錄 B〉),**不是忘了**。
🔴 但風險要寫在這裡而不是只寫在附錄:它與 (1a) 是**同一個失敗形狀** ——
取消側在 ②→⑤ 視窗內寫 `order_cancellation_items`,真相動而摘要凍住 ⇒ 步驟⑤ 一樣會
紅在「不在②留檔集合內」、一樣會把人指向錯的方向(或**綠著滑過**,見步驟⑤ 誠實界)。
🔴🔴 **災難日的預設動作 = <u>不停它</u>,照本檔跑下去(2026-08-08 W7c R3 定案)**:
上一版這裡寫「災難日若時間允許,先停它再往下走」= **把一個未拍板的選項丟給半夜的執行者**,
而本檔自己在附錄 B-2 說「runbook 裡的可選項 = 半夜最容易做錯的東西」—— 自相矛盾,已刪。
⇒ 現在的口徑:**預設不停**;它的存在只影響「步驟⑤ 紅了要往哪查」(答案=殘餘寫入面第四面)。
要不要改成「預設停」是**待 Sean 拍板**的題(附錄 B-2),**不是災難日當場決定的事**。

```sql
-- (1) 停掉 service_role 應用路徑的**採購側**寫入口(A5a)。**單獨執行、確認已提交後再做下一步。**
-- 🔴 2026-08-08 W7c:本行原寫「唯一寫入口」,那已不成立 —— 出貨側五支 writer 見 (1a)、
--    取消側見本步驟下方的**債⑤**。本句只負責採購側這一支。
-- 🔴 簽章 = 12 參(A9h-M 20260806200000 起;末參 p_preserve_optional_fields boolean)。
--    型別清單少一個 boolean ⇒ 本句當場 undefined function、回滾在唯一需要它的那天卡死。
REVOKE EXECUTE ON FUNCTION public.admin_upsert_item_procurement(
  uuid, uuid, integer, text, text, timestamptz, text, text, date, text, text, boolean) FROM service_role;
-- 🔴 驗:應回 f(2026-08-08 W7c R3 補 —— (1a)(1b) 都有驗證查詢,只有本塊沒有,
--    而「確認已提交」在 dashboard 上沒有任何指示器可看 ⇒ A5a 到底停沒停乾淨,災難日無從得知)。
-- ⚠️ **這一句要在<u>下一次 Run</u> 跑**(執行卡第 2 條):跟 REVOKE 同一塊送出時,
--    它會在同一個未提交交易內看到自己的效果 ⇒ 對「有沒有提交」這件唯一擔心的事零判別力。
SELECT has_function_privilege('service_role',
  'public.admin_upsert_item_procurement(uuid,uuid,integer,text,text,timestamptz,text,text,date,text,text,boolean)',
  'EXECUTE') AS still_granted;
```

```sql
-- (1a) 🔴 **停掉出貨側五支 writer RPC**(2026-08-08 W7c 新增)。**單獨執行、確認已提交後再做下一步。**
--
-- 🔴🔴 **為什麼 (1b) 的 DISABLE 不能取代這一步 —— 兩者停的是不同的東西**:
--   (1b) 停的是**摘要側**(重算 trigger 不再改 order_item_quantity_summary);
--   本步停的是**真相側**(不再有新的 shipment_items / shipped_at / deleted_at 落地)。
--   只做 (1b) 的話:摘要凍住了,但**真相在 ②→⑤ 視窗內繼續動** ⇒ 步驟⑤ 拿摘要對真相時就會分歧。
--   兩種下場**都不好**,而且第二種更糟:
--     ⓐ 那個品項**不在**②留檔集合內 ⇒ 步驟⑤ `RAISE` ⇒ **②→⑤ 整段回滾、白做**;
--        🔴 而且那個紅的**訊息會騙人**:它寫「④期間有新寫入?」,災難日的人會去查誰寫了摘要,
--        但真正動的是出貨真值。
--     ⓑ 那個品項**已經在**②留檔集合內 ⇒ 🔴 **⑤ 綠著滑過**(它按品項**成員**判定、不比形狀,
--        見步驟⑤ 下方的誠實界)⇒ 連紅都不會紅,漂移直接被帶過收工。
--   ⇒ 本步不是防禦縱深,是讓步驟⑤ 那條斷言**能夠成立**的前提。
--
-- 🔴 **排在 (1b) 之前是刻意的**:先斷掉新的出貨 RPC,(1b) 的 `DISABLE`(取 AccessExclusive)
--    才不會一邊等鎖一邊有新出貨交易插進來;此時 (1b) 若仍卡 `55P03`,至少可以**排除**
--    「新的出貨 RPC 還在進來」這個雜訊。
--    ⚠️ 但**別把它讀成「一定是舊出貨交易」**:`AccessExclusive` 也會排在任何長時間的**讀**交易之後
--    (dashboard 開著沒關的查詢、`pg_dump`、owner 的手動 SELECT —— 它們持 `ACCESS SHARE`)。
--    ⇒ 卡住時查 `pg_locks` / `pg_blocking_pids()` 看**實際擋你的是誰**,不要憑猜。
--
-- 🔴 **簽章 = 實查值**(2026-08-08 W7c:全 migration 重放至 `20260808000000` 後查 `pg_proc`;
--    五支**各恰一個 overload**、皆 SECURITY DEFINER、皆 `has_function_privilege('service_role',…)=true`)。
--    型別清單打錯一個字 ⇒ 當場 `42883` undefined function,回滾在唯一需要它的那天卡死。
REVOKE EXECUTE ON FUNCTION public.admin_create_shipment(text, uuid, jsonb, text, text) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.admin_add_shipment_items(text, uuid, jsonb)          FROM service_role;
REVOKE EXECUTE ON FUNCTION public.admin_mark_shipment_shipped(text, uuid, text)        FROM service_role;
REVOKE EXECUTE ON FUNCTION public.admin_void_shipment(text, uuid, text)                FROM service_role;
REVOKE EXECUTE ON FUNCTION public.admin_unvoid_shipment(text, uuid)                    FROM service_role;
-- 驗:五列應全回 f;任一回 t 代表那一支沒停到,停下不要往下走
SELECT p.proname, has_function_privilege('service_role', p.oid, 'EXECUTE') AS still_granted
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('admin_create_shipment','admin_add_shipment_items',
                     'admin_mark_shipment_shipped','admin_void_shipment','admin_unvoid_shipment')
 ORDER BY p.proname;
-- 🔴 **這五個名字的單一字面來源** = `scripts/w6c-idem-replay.sh` 的 `SHIP_FN_SET`;
--    未來新增第六支出貨 writer 時,那裡與這裡要同批改(沒有機制保證同步)。
-- 🔴 **對稱的 GRANT 在步驟⑦**。漏了那一步的症狀與 (1b) 不同:出貨 RPC 會回權限錯誤 =
--    **員工當場出不了貨(loud)**,不是靜默漂移 ⇒ 它不是本檔最陰的那個形狀,但一樣會停業。
```

```sql
-- (1b) 🔴 **停掉出貨側那條寫入路徑**(2026-08-06 B2-S2b-3b:債① 結清)。
--     REVOKE 對它沒用 —— 它不是 RPC,是掛在 shipments 上的重算 trigger;
--     `service_role` 對 shipments 只有 SELECT,**沒有可以 REVOKE 的 actor**。
--     停寫的正確對象就是 trigger 本身。
-- 🔴🔴 **2026-08-08 W7c 補一段(上面那三行<u>不刪</u>,它們對「這一支 trigger」仍然是對的)**:
--     上面說的是**重算 trigger 這個物件**——它確實不是 RPC、確實沒有 EXECUTE 可 REVOKE,
--     而且 `service_role` 對 `shipments` / `shipment_items` 兩表**至今仍只有 SELECT**
--     (2026-08-08 實查 `pg_class.relacl` = `{postgres=arwdDxtm/postgres,service_role=r/postgres}`,
--      欄級 `pg_attribute.attacl` 全空)⇒ **那三行今天仍為真,不要劃掉。**
--     🔴 **變成假的是它的言外之意**:「出貨側沒有 REVOKE 得到的東西」。
--     五支出貨 writer RPC 上線後,出貨側**有**可 REVOKE 的 actor 了 —— 它們是 SECURITY DEFINER,
--     停的是**函式的 EXECUTE**、不是表的 DML 權限,兩件事不衝突。⇒ 那一半在 **(1a)**。
--     ⇒ 債① 現在是**兩半**:摘要側 = 本 (1b),真相側 = (1a)。**只做其中一半都不算停乾淨。**
-- 🔴 少了這一步:②→⑤ 之間任何一次 `UPDATE shipments SET shipped_at / deleted_at`
--     都會改到摘要表的 shipped_quantity ⇒ 快照與拆除期間數字仍會動,而步驟⑤ 會紅在
--     「分歧不在②留檔集合內」——看起來像④期間有人亂寫,實際上是本步沒停乾淨。
-- 🔴 **步驟⑦ 有對稱的 ENABLE,不做那步會讓出貨側永久停寫、而三軸對帳仍可能全綠。**
-- 🔴 `ALTER TABLE … DISABLE TRIGGER` 對 `public.shipments` 取 **AccessExclusive**(PG 語義;
--    **本 repo 未實測量過鎖等級**,口徑與步驟④ 那段一致)⇒ 會排在既有寫交易之後。
--    這一句是**獨立小交易**,逾時重跑無代價 ⇒ 設等鎖上限;
--    卡住(`55P03`)= 「**有東西還持著 `shipments` 上的鎖**」的訊號,等它結束再跑,不要硬等也不要跳過。
-- 🔴 2026-08-08 W7c 更正:本行原寫「就是還有**出貨交易**沒結束」= 過窄。`AccessExclusive` 也會排在
--    任何長時間的**讀**交易之後(dashboard 沒關的查詢、`pg_dump`、owner 手動 SELECT,它們持 `ACCESS SHARE`)。
--    ⇒ 卡住時查 `pg_blocking_pids()` 看**實際擋你的是誰**,不要憑猜就去追出貨作業。
SET lock_timeout = '5s';
ALTER TABLE public.shipments DISABLE TRIGGER shipments_summary_recompute_ac;
RESET lock_timeout;
-- 驗:應回 D(disabled);回 O 代表沒生效,停下不要往下走
SELECT tgenabled FROM pg_trigger
 WHERE tgrelid = 'public.shipments'::regclass
   AND tgname = 'shipments_summary_recompute_ac' AND NOT tgisinternal;
```

```sql
-- (2) 另一次執行:記下停寫時點(下一步 drain 的錨;此刻 (1)(1a) 已對所有連線生效)
-- 🔴 **2026-08-08 W7c R3:改成「存進表」,不要人工抄時戳。**
--    原本是 `SELECT now() AS revoke_at;` 再叫人把回傳值抄進 (3) 的 `<填…>`。
--    `timestamptz` 帶微秒,dashboard 顯示可能截斷、本地格式也可能不同 ⇒ **抄短一位 = 邊界往前**
--    ⇒ drain 少算幾筆 ⇒ 給出「已淨空」的假象,而那正是 (3) 存在的唯一理由。零抄寫就零抄錯。
CREATE TABLE public.a4a_rollback_revoke_at AS SELECT now() AS revoke_at;
SELECT revoke_at FROM public.a4a_rollback_revoke_at;   -- 看一眼,不用抄

-- (3) 🔴 drain:REVOKE 只擋「新的」呼叫,已經通過 EXECUTE 檢查、正在跑或還沒 COMMIT 的交易
--     照樣會寫進去。反覆跑到**回 0 列**為止。
--     ⚠️ 不可改用 `query ILIKE '%admin_upsert_item_procurement%'`:①會命中這句自己
--        ②呼叫完 RPC 後改跑別的 SQL、尚未 COMMIT 的交易查不到 —— 兩種都會給出「已淨空」的假象。
-- 🔴 **2026-08-08 W7c R3:改成列出來,不要只回一個數字。**
--    這個條件會撈到「所有比 revoke_at 早開始的交易」—— 包含**你自己另一個 dashboard 分頁**
--    (idle in transaction)、pg_dump、長讀查詢。只回 count 的話,半夜很可能**永遠回不到 0**
--    而你不知道那是誰、也不知道能不能動它 ⇒ 卡死在這一步。
SELECT a.pid, a.usename, a.state, a.xact_start,
       left(a.query, 60) AS 這條交易在跑什麼
  FROM pg_stat_activity a, public.a4a_rollback_revoke_at r
 WHERE a.pid <> pg_backend_pid()
   AND a.xact_start IS NOT NULL
   AND a.xact_start <= r.revoke_at
 ORDER BY a.xact_start;
-- v3(A8a1 關卡2 折入):<= 不是 <——xact_start 恰等於 revoke_at 的交易(同一時戳精度)
-- 是「REVOKE 生效前已通過檢查」的可能成員,安全邊界必須含等號。
-- 🔴 判讀:`state = 'idle in transaction'` 且 query 認得出是你自己開的分頁 ⇒ **把那個分頁關掉**。
--    認不出來、或是別的服務 ⇒ 等它自己結束;**不要 pg_terminate_backend 硬砍**,
--    那可能砍掉正在寫的業務交易。真的等不到就停下來問人,不要跳過本步。
-- 🔴 `a4a_rollback_revoke_at` 這張表在步驟⑥ 的三表清理時一起 `DROP TABLE` 掉。
```

⚠️ **停寫後的殘餘寫入面(誠實列全,口徑對齊 S2 `20260801160000:303-306`)**:owner 手動 SQL、pg_cron job、
任何持 owner 憑證的服務 —— 三者都不受 REVOKE 影響。
🔴 **2026-08-08 W7c 補第四面(原本只列三面,那份清單不完整)**:**`admin_cancel_order`**(債⑤)——
它是**活的 `service_role` 路徑**、本步驟**預設沒有停它**,②→⑤ 視窗內照樣能開新交易經 A4a trigger 寫摘要。
⇒ 本步驟保證的是「**採購側 + 出貨側的 service_role 應用路徑**已停」,**不是**「service_role 全停」,
更不是「沒有任何東西能寫」。災難日若對帳持續飄移,**先查這四個面**(取消側排第一,因為它最容易被當成已停),
不要假設停寫失敗。

## 步驟 ②:保存快照 + 對帳(分流,不 abort;🔀 codex K2-R2-2:三形狀 —— 值分歧/缺列/received drift)

> 🔴 **v3(A8a1 關卡2 折入):②→⑤ 的 BEGIN…COMMIT 跨四個步驟,必須同一連線同一 SQL editor
> 分頁依序貼入執行、中途不換頁不斷線**;換連線=快照靜默回滾、④⑤ 的「同一交易」宣稱失效。
> 中途斷線就從 ② 重來(CTAS 未 COMMIT 會自動消失、無殘留)。

```sql
BEGIN;
CREATE TABLE public.a4a_rollback_snapshot AS
  SELECT s.*, pg_catalog.now() AS snapshotted_at
    FROM public.order_item_quantity_summary s;

-- divergence 以「活動 ∪ 摘要」全集驅動:有活動但摘要列缺失(snap_* 為 NULL)也是災難形狀
-- ⚠️ 契約債②(2026-08-06 B2-S2b-3a 前段:**只落地一半**):本表原本只對帳 ordered / instock / cancelled
--    **三軸**,大線讓 shipped 成為被維護的第四軸之後,shipped 漂移會在這裡全綠而漏掉。
--    ⇒ 已補 `snap_shipped` / `truth_shipped` 兩欄 + WHERE 的第四軸判斷,候選全集也補了 `shipment_items`
--    (**shipment-only 品項**:有出貨但從沒進過採購/取消/摘要 —— 不補就永遠不會被對帳掃到)。
-- ✅ **驗收 fixture 已落地**(2026-08-06 B2-S2b-3b):`scripts/b2s2b-verify.sh` 的 `B27-divergence-4th` 格
--    **從本檔抽出下面這段 SQL 實跑**,造「只有 shipped 漂移、前三軸正確」的資料 ⇒
--    舊三軸述詞回 0 列、本段回 1 列且指名該品項。⇒ 契約債② 兩半都結清。
--    🔴 那一格是從**本檔**抽 SQL 去跑的 —— 改壞下面這段,它會紅。
-- 🔴 **前置**:本步驟現在硬相依 **S2a**(`s.shipped_quantity` 欄)與 **B2-S1**(`shipments` / `shipment_items` 兩表)。
--    對還沒套 S2a 的站,這句 `CREATE TABLE` 會 `42703` ⇒ 照下方「abort 僅限…停下找人」處理,不要自行改寫本段。
-- 🔴 `-- SHIPPED-TRUTH-BEGIN/END` 之間是**真相式的受守護區塊**:全 repo 共 **6 塊**
--    (helper 1 / 本檔 3 —— 對帳段的欄位與 WHERE 各一、收尾段一 / `a4a-verify.sh` 的 ORACLE_SQL 1
--     / migration 的 backfill oracle 1)。
-- ✅ **守門已落地**(2026-08-06 S2b-3a 後段,commit `b3340ac`):`scripts/b2s2b-truth-sync.py`
--    逐塊比對**整塊 6 行的序列**(含順序)⇒ **改這幾行會轉紅**,那是設計、不是故障;
--    合法變更時要同批改該檔的凍結表。
--    區塊內**刻意零縮排**:縮排差異會讓逐字比對永遠不等,**不要順手重排這幾行**。
CREATE TABLE public.a4a_rollback_divergence AS
  SELECT u.order_item_id,
         s.ordered_quantity AS snap_ordered, s.instock_quantity AS snap_instock, s.cancelled_quantity AS snap_cancelled,
         s.shipped_quantity AS snap_shipped,
         COALESCE((SELECT sum(p.allocated_quantity) FROM public.order_item_procurement p WHERE p.order_item_id=u.order_item_id),0) AS truth_ordered,
         COALESCE((SELECT sum(r.quantity) FROM public.order_item_procurement_receipts r
                    WHERE r.procurement_id IN (SELECT p2.id FROM public.order_item_procurement p2 WHERE p2.order_item_id=u.order_item_id)),0) AS truth_instock,
         COALESCE((SELECT sum(c.cancelled_quantity) FROM public.order_cancellation_items c WHERE c.order_item_id=u.order_item_id),0) AS truth_cancelled,
-- SHIPPED-TRUTH-BEGIN
COALESCE((SELECT sum(si.shipped_quantity)
FROM public.shipment_items si
JOIN public.shipments sh ON sh.id = si.shipment_id
WHERE si.order_item_id = u.order_item_id
AND sh.deleted_at IS NULL
AND sh.shipped_at IS NOT NULL), 0)
-- SHIPPED-TRUTH-END
           AS truth_shipped
    FROM (SELECT p.order_item_id FROM public.order_item_procurement p
          UNION SELECT c.order_item_id FROM public.order_cancellation_items c
          UNION SELECT s2.order_item_id FROM public.order_item_quantity_summary s2
          UNION SELECT si2.order_item_id FROM public.shipment_items si2) u
    LEFT JOIN public.order_item_quantity_summary s ON s.order_item_id = u.order_item_id
   WHERE s.order_item_id IS NULL
      OR s.ordered_quantity   IS DISTINCT FROM COALESCE((SELECT sum(p.allocated_quantity) FROM public.order_item_procurement p WHERE p.order_item_id=u.order_item_id),0)
      OR s.instock_quantity   IS DISTINCT FROM COALESCE((SELECT sum(r.quantity) FROM public.order_item_procurement_receipts r
                    WHERE r.procurement_id IN (SELECT p2.id FROM public.order_item_procurement p2 WHERE p2.order_item_id=u.order_item_id)),0)
      OR s.cancelled_quantity IS DISTINCT FROM COALESCE((SELECT sum(c.cancelled_quantity) FROM public.order_cancellation_items c WHERE c.order_item_id=u.order_item_id),0)
      OR s.shipped_quantity   IS DISTINCT FROM
-- SHIPPED-TRUTH-BEGIN
COALESCE((SELECT sum(si.shipped_quantity)
FROM public.shipment_items si
JOIN public.shipments sh ON sh.id = si.shipment_id
WHERE si.order_item_id = u.order_item_id
AND sh.deleted_at IS NULL
AND sh.shipped_at IS NOT NULL), 0)
-- SHIPPED-TRUTH-END
      ;

-- received_quantity drift 另立留檔表(第二形狀來源:累計欄 vs receipts 明細)
CREATE TABLE public.a4a_rollback_received_drift AS
  SELECT p.id AS procurement_id, p.order_item_id, p.received_quantity AS snap_received,
         COALESCE((SELECT sum(r.quantity) FROM public.order_item_procurement_receipts r WHERE r.procurement_id=p.id),0) AS truth_received
    FROM public.order_item_procurement p
   WHERE p.received_quantity IS DISTINCT FROM COALESCE((SELECT sum(r.quantity) FROM public.order_item_procurement_receipts r WHERE r.procurement_id=p.id),0);

-- v3(A8a1 關卡2 折入):三張證據表 escape 兩件套(ENABLE RLS+REVOKE;owner 直讀,故不 GRANT
-- ——與 a7-rollback 的「三件套」(含 GRANT SELECT 供 ACL 斷言形狀)刻意不同,勿照字面找第三件)
-- —— CTAS 預設繼承 default privileges,
-- 內部採購/取消數字不得進 PostgREST 曝露面;owner(postgres)直讀不受影響。
ALTER TABLE public.a4a_rollback_snapshot        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.a4a_rollback_divergence      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.a4a_rollback_received_drift  ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.a4a_rollback_snapshot, public.a4a_rollback_divergence,
  public.a4a_rollback_received_drift FROM PUBLIC, anon, authenticated, service_role;

SELECT (SELECT count(*) FROM public.a4a_rollback_divergence) AS divergence_rows,
       (SELECT count(*) FROM public.a4a_rollback_received_drift) AS received_drift_rows;
```

- 兩數皆 0 → 健康,直行 ③。
- 任一 > 0 → **分流**:三形狀差異已留檔,**以真相重算為準**續行(這正是回滾的理由);列數與樣本記入當日 handoff。
- **abort 僅限**:查詢對真相表本身報錯(表不存在/讀取失敗)→ `ROLLBACK;` 停下找人(本步只讀不改,無 re-enable 需求)。

## 步驟 ③:依賴清零檢查(不可用 pg_depend —— plpgsql body 依賴不入 catalog)

```sql
-- (a) 依賴 trigger 枚舉(此刻應 = 5;步驟④後重跑應 = 0,歸零才准走⑥)
-- 🔴 2026-08-06 B2-S2b-3b(plan 項21b):**從四支改成五支** —— 第五支是出貨側的重算 trigger,
--    它經自己的函式 → helper → 摘要表,是**同一條依賴鏈**;漏掉它就等於宣告「依賴已清零」
--    卻還有一支活著指向 helper。
SELECT count(*) FROM pg_catalog.pg_trigger
 WHERE tgname IN ('order_item_procurement_received_quantity_guard_bt',
                  'order_item_procurement_summary_recompute_zc',
                  'order_item_procurement_receipts_received_sync_ac',
                  'order_cancellation_items_summary_recompute_ac',
                  'shipments_summary_recompute_ac')
   AND NOT tgisinternal;
```

- 🔴 **(a2) 出貨側那支的處置**(2026-08-06 B2-S2b-3b):`shipments_summary_recompute_ac`
  掛在 `shipments` 上、由 **B2-S2b** 建。步驟①(1b) 先 **DISABLE**(擋住②→⑤ 視窗的寫入),
  步驟④ 再連同它的函式一起 **DROP** ⇒ 上面 (a) 的枚舉**已含它**、歸零才是真的歸零。
  🔴 **兩者不可互相取代**:只 DISABLE 不 DROP ⇒ 依賴沒清零、⑥ 不該放行;
  只 DROP 不先 DISABLE ⇒ ②→⑤ 視窗仍會被寫。
- (b)**消費端清單(授權時 repo-grep,2026-08-03;2026-08-06 B2-S2b-3b 更新為 <u>五 trigger + 六函式</u>;🔴 2026-08-06 由 A9c 回寫 PostgREST 側)**
  🔴 **本條 2026-08-07 由 B2-S2b 與 A9c <u>兩線 union 合併</u>**(merge 衝突,主視窗 `B-167-A` 裁 Q1=A):
  兩側改的是同一份清單但**不同的東西**,少任何一半災難當天都會做錯事 —— DB 側少了會不停出貨側的寫入,
  PostgREST 側少了會在 DROP 表之後把 admin 兩頁弄壞,而且 **catalog 查不到、沒有任何守門會紅**。
  - **DB 側**:A4a 四 trigger + 五函式,加 **B2-S2b 的 `shipments_summary_recompute_ac` +
    `pcm_a4a_shipments_summary_recompute()`** ⇒ 合計 **五 trigger + 六函式**。
  - **PostgREST 讀模型**:~~A9c 未建~~ ⇒ **A9c 已建,現有兩個消費端,回滾前都要先拆**:
    - `ADMIN_ORDER_DETAIL_SELECT`(`packages/adapters/src/supabase/SupabaseOrderAdapter.ts`;A9g-1 起)
    - **`ADMIN_ORDER_LIST_SELECT`(同檔;A9c 2026-08-06 新增)** —— 內嵌 `order_item_quantity_summary(quantity, ordered_quantity, instock_quantity, cancelled_quantity)`
    - TS 側連帶:`mappers/order.ts` 的 `mapQuantitySummary`(明細,fail-closed 回 `null`)與 `mapListQuantitySummary`(列表,補 0)、`AdminOrderLine.quantitySummary`(**非 nullable**)。
  🔴 **步驟③「逆序撤消費端」要先把這兩條 select 字串的內嵌拿掉再 DROP 表** —— 漏掉會讓 admin 訂單**列表**與**明細**兩頁一起壞(PostgREST 對不存在的關聯是回錯誤、不是靜默略過)。
  🔴🔴 **這一步<u>不是 SQL</u>,本檔 `:5` 指定的執行者(Sean)一個人做不到**(2026-08-08 W7c R3 抓):
  它要改 `SupabaseOrderAdapter.ts` 的兩條 select 字串**並且部署**上去,才算真的撤掉。
  ⇒ **災難日走到這裡必須有工程 session 在線**;沒有的話**停在步驟④**(那是合法終點,摘要表凍結保留、
  但**記得照④ 終點那段把權還回去**),**不要**因為「這步做不了」就跳過它直接進⑥ DROP 表。
  🔴 **未來消費端上線片必須回寫本清單**(PostgREST select 字串對 DB 完全不可見,catalog 查不到)。
- (c)反例(僅演練環境;證明「DROP 不會被 DB 自己擋、順序是人的責任」):trigger 在位時 DROP 表 → 下一筆來源 DML 紅 `42P01`。演練腳本自動跑。

## 步驟 ④:撤 trigger + 函式、標記 stale(與 ②⑤ 同一交易)

🔴 **DROP 序(2026-08-06 B2-S2b-3b,plan 項21b)**:**先出貨側、再採購/取消側、最後 helper**。
- **catalog 真正強制的只有一條**:`DROP FUNCTION` 在它的 trigger 還在時會被 `2BP01` 擋
  ⇒ 每支 trigger 必須排在**它自己的函式**之前。下面的順序滿足它。
- **helper 排最後是防禦性的、不是硬依賴**(2026-08-06 R1 更正:上一版寫得像硬依賴):
  ②④⑤ 在同一交易裡,交易結束時狀態相同。它真正保護的是**有人半途停手**的情況 ——
  helper 先沒了、而出貨側 trigger 還在,那支會在下一筆 `UPDATE shipments` 才炸 `42883`。
🔴 `DROP TRIGGER` **不會**帶走函式,兩者都要各自列出來。
🔴🔴 **鎖的代價要先知道(2026-08-06 R1 抓)**:`DROP TRIGGER … ON public.shipments` 取
**AccessExclusive**(PG 語義;**本 repo 未實測量過**),而本步驟在 **②→⑤ 的同一個交易裡** ⇒ 這把鎖**一路持到 COMMIT**,
期間 `shipments` 全表不可讀寫(出貨作業會整個卡住)。
- 🔴 **開始②之前就該讓出貨作業停下**;步驟①(1b) 卡住(`55P03`)本身就是「**還有東西持著 `shipments` 的鎖**」
  的訊號(2026-08-08 W7c 更正:原寫「還有出貨交易沒結束」過窄,長時間的**讀**交易也會擋 ——
  查 `pg_blocking_pids()` 確認是誰),那時就不要往下走,不要等到④ 才發現。
- 🔴 **本步驟不另設 `lock_timeout`**:①(1b) 是獨立小交易、逾時重跑無代價;④ 在大交易中途逾時
  會讓②→⑤ 整段回滾重來 —— 而**設在 session 層也一樣會整段回滾**(2026-08-06 R2 更正:
  上一版建議「設在進入②之前」,那沒有達成它自己宣稱的目的)。
  ⇒ **真正的保護是上面那條**:進②之前先讓出貨作業停下,並拿①(1b) 有沒有卡在 `55P03` 當訊號。

```sql
-- 出貨側(B2-S2b)先撤:trigger → 它自己的函式
DROP TRIGGER shipments_summary_recompute_ac ON public.shipments;
DROP FUNCTION public.pcm_a4a_shipments_summary_recompute();
-- 採購 / 取消側(A4a)
DROP TRIGGER order_item_procurement_received_quantity_guard_bt ON public.order_item_procurement;
DROP TRIGGER order_item_procurement_summary_recompute_zc       ON public.order_item_procurement;
DROP TRIGGER order_item_procurement_receipts_received_sync_ac  ON public.order_item_procurement_receipts;
DROP TRIGGER order_cancellation_items_summary_recompute_ac     ON public.order_cancellation_items;
DROP FUNCTION public.pcm_a4a_received_quantity_guard();
DROP FUNCTION public.pcm_a4a_procurement_summary_recompute();
DROP FUNCTION public.pcm_a4a_receipts_received_sync();
DROP FUNCTION public.pcm_a4a_cancellation_summary_recompute();
DROP FUNCTION public.pcm_a4a_recompute_order_item_summary(uuid);
COMMENT ON TABLE public.order_item_quantity_summary IS
  '🛑 STALE:A4a 已回滾撤除,本表值凍結於撤除時點、不得信任(顯示層請視為不可用)。重建 = 重放 A4a migration(backfill 會由真相重算)。';
```

= **A4a 單獨回滾的終點**(摘要表凍結保留)。`received_quantity` 同步凍結、直寫守門已除。

🔴 **走到這裡就停的人請讀這段(2026-08-06 B2-S2b-3b)**:
出貨側那支 trigger 與它的函式**已經在上面被 DROP 了**(不是留在 disabled)——
所以**沒有「忘記回權」這回事**:它根本不存在,要它回來只能重放 S2b(步驟⑥ 的 Forward 清單)。
- 🔴 **不要**在這個狀態下手動 `CREATE` 回去:helper 也被 DROP 了,建回去下一筆出貨會紅 `42883`。
- 🔴 **這段期間出貨側對摘要表零寫入** —— 摘要表本來就已標 `🛑 STALE`、不得信任,兩者一致;
  但**別把「三軸對帳全綠」讀成「可以信任了」**,那正是本檔最陰的那個形狀。
- 🔴🔴 **但「寫入權」一定要還回去(2026-08-08 W7c R3 抓;上一版這條路完全沒提回權)**:
  trigger 被 DROP 了確實沒有「回權」問題,**但步驟① 的三塊 REVOKE 沒有被 DROP 掉、也沒有隨任何東西消失** ——
  `(1)` A5a、`(1a)` 出貨五支(以及你若照債⑤ 停過的 `admin_cancel_order`)**現在全都還是 revoked 狀態**。
  ⇒ **停在這裡的人必須跑步驟⑦ 的那些 `GRANT`**(A5a 那句 + (⑦-c) 五句;**`ENABLE TRIGGER` 那句跳過**,
  因為 trigger 已經不存在,跑了會紅 `42704`)。
  🔴 **步驟⑦ 抬頭那組前提(⑥ 重建完成、S2a/S2b 已重放、對帳綠)<u>不適用這條路</u>** ——
  走到這裡就停的人**永遠滿足不了**它們,照字面等下去 = **採購存不了 + 貨出不了、而系統看起來一切正常**。
  ⇒ 這與下面「中止路徑」那段是**同一個類**(權限是單獨提交的、不隨任何回滾消失),
  只是終點不同:**凡是沒走完⑦ 就離場的路,都要把權還回去。**

🔴🔴 **中止 / 放棄回滾的人請讀這段(2026-08-06 R2 抓;上一版完全沒涵蓋這條路)**:
①(1b) 的 `DISABLE` 是**單獨提交**的,**不會隨②→⑤ 的回滾一起消失**。
所以只要你是在 **④ COMMIT 之前**中止(② abort、⑤ RAISE 整段回滾、或單純決定不做了):
- **trigger 與 helper 都還在**(④ 沒提交 ⇒ 沒被 DROP,trigger 只是 disabled)
  ⇒ **回權是安全的、而且是必要的**。
- 🔴 **立刻跑步驟⑦ 的那一句 `ENABLE TRIGGER`**(⑦ 的**前提**不適用中止路徑,見下方那段)。
- 不跑的話:出貨側**永久停寫**、三軸對帳仍全綠、零告警 —— 同一個最陰形狀,只是從另一條路進來。

🔴🔴 **中止時要回權的是<u>四件</u>,不是一件(2026-08-08 W7c 補;(1a) 上線後這條路本來會漏)**:
步驟① 的每一塊(`(1)` A5a REVOKE、`(1a)` 五支出貨 writer REVOKE、`(1b)` DISABLE)**都是單獨提交的**,
**都不會**隨②→⑤ 的回滾一起消失。⇒ 中止的人**照這個順序全部跑完**:

1. 步驟⑦ 的那一句 `ENABLE TRIGGER`(**先做**,理由見步驟⑦ (⑦-c) 那段的順序說明);
2. 步驟⑦ 的 **(⑦-c) 那五句 `GRANT`**(出貨側五支 writer);
3. 步驟⑦ 的 **A5a `GRANT`**(採購側那一句);
4. **若你當初照債⑤ 也停了 `admin_cancel_order`** ⇒ 連它那一句 `GRANT` 一起跑(字面見步驟⑦ (⑦-c) 末尾)。

🔴 **步驟⑦ 抬頭寫的前提(「⑥ 重建完成+對帳綠」「S2a/S2b 已重放」)<u>整組都不適用於中止路徑</u>**
—— 中止的人**永遠滿足不了**那些前提,照字面等下去的後果是:出貨 RPC 與**採購 RPC 一起永久 revoked**,
員工當天既出不了貨也存不了採購,**而系統看起來一切正常**(只有按下去的人收到權限錯誤)。
那組前提是給「走完⑥ 才回權」用的;**中止路徑什麼都沒拆**(④ 沒提交)⇒ 這些函式從頭到尾完好,
**直接還權就是對的**,不需要任何 migration 重放。
(2026-08-08 W7c R2:上一版只列了前兩件、`:333` 還寫「A5a 回權另計」而「另計」指向一個中止路徑
永不可滿足的前提 —— 與本段要修的是**同一個錯,只是換一支函式**。)

## 步驟 ⑤:凍結值驗證(可直接複製;codex K2-9/K2-R2-2 —— 三形狀、災難日不得未驗證就 COMMIT)

```sql
DO $s5$
DECLARE v_bad integer;
BEGIN
  -- 三形狀分歧(值/缺列/received drift)必須 ⊆ ② 已留檔集合(= ①停寫成立、④期間零新寫入)
  -- 🔴 2026-08-06 B2-S2b-3a 前段:值分歧補**第四軸 shipped**、候選全集補 `shipment_items`,
  --    與步驟②的 divergence 表同一組判準(兩處不同步 = 收尾驗證會漏掉出貨側的分歧)。
  -- 🔴 **災難日看到本步紅在 shipped 時**:先確認步驟①(1b) 的停寫**真的跑過且回 `D`**
  --    (2026-08-06 起①(1b) 已補上 `DISABLE TRIGGER shipments_summary_recompute_ac`)。
  --    跑過還紅 ⇒ 才是「④期間真的有人寫」;沒跑過 ⇒ 回頭補①(1b) 再從②重來。
  --    🔴 仍未涵蓋的寫入面見步驟① 的**債⑤**(`admin_cancel_order` 對 service_role 有 EXECUTE)。
  SELECT count(*) INTO v_bad
    FROM (SELECT p.order_item_id FROM public.order_item_procurement p
          UNION SELECT c.order_item_id FROM public.order_cancellation_items c
          UNION SELECT s2.order_item_id FROM public.order_item_quantity_summary s2
          UNION SELECT si2.order_item_id FROM public.shipment_items si2) u
    LEFT JOIN public.order_item_quantity_summary s ON s.order_item_id = u.order_item_id
   WHERE (s.order_item_id IS NULL
       OR s.ordered_quantity   IS DISTINCT FROM COALESCE((SELECT sum(p.allocated_quantity) FROM public.order_item_procurement p WHERE p.order_item_id=u.order_item_id),0)
       OR s.instock_quantity   IS DISTINCT FROM COALESCE((SELECT sum(r.quantity) FROM public.order_item_procurement_receipts r
                    WHERE r.procurement_id IN (SELECT p2.id FROM public.order_item_procurement p2 WHERE p2.order_item_id=u.order_item_id)),0)
       OR s.cancelled_quantity IS DISTINCT FROM COALESCE((SELECT sum(c.cancelled_quantity) FROM public.order_cancellation_items c WHERE c.order_item_id=u.order_item_id),0)
       OR s.shipped_quantity   IS DISTINCT FROM
-- SHIPPED-TRUTH-BEGIN
COALESCE((SELECT sum(si.shipped_quantity)
FROM public.shipment_items si
JOIN public.shipments sh ON sh.id = si.shipment_id
WHERE si.order_item_id = u.order_item_id
AND sh.deleted_at IS NULL
AND sh.shipped_at IS NOT NULL), 0)
-- SHIPPED-TRUTH-END
       )
     AND NOT EXISTS (SELECT 1 FROM public.a4a_rollback_divergence d WHERE d.order_item_id = u.order_item_id);
  IF v_bad <> 0 THEN
    RAISE EXCEPTION '步驟⑤失敗:% 列摘要分歧不在②留檔集合內(④期間有新寫入?)—— 整段回滾、停下清查', v_bad;
  END IF;
  SELECT count(*) INTO v_bad
    FROM public.order_item_procurement p
   WHERE p.received_quantity IS DISTINCT FROM COALESCE((SELECT sum(r.quantity) FROM public.order_item_procurement_receipts r WHERE r.procurement_id=p.id),0)
     AND NOT EXISTS (SELECT 1 FROM public.a4a_rollback_received_drift d WHERE d.procurement_id = p.id);
  IF v_bad <> 0 THEN
    RAISE EXCEPTION '步驟⑤失敗:% 列 received drift 不在②留檔集合內 —— 整段回滾、停下清查', v_bad;
  END IF;
END $s5$;
COMMIT;  -- ②④⑤ 同一交易至此收尾;上面 DO 若 RAISE 則整段回滾、trigger 不會停在半路
```

⚠️ 誠實界(R3 nit;🔀 2026-08-03 A5a 回寫時重看):⑤ 的子集檢查按品項/採購列**成員**判定、不比形狀
—— 已留檔品項若在 ④ 窗口內新增**另一形狀**分歧會滑過。承重原本是「三表零寫 GRANT ⇒ 窗口內不可能有新寫入」;
A5a 上線後那句**不再成立**,承重改為 ①的 **REVOKE + drain 已跑完**。
🔴 **2026-08-08 W7c 更正(原句寫「drain 回 0 之後 service_role 路徑<u>確實沒有新交易能寫</u>」= 過寬)**:
那只在①**把該停的都停了**時才成立。①(1a) 之後出貨側已停,但**取消側(債⑤)預設沒停** ⇒
`admin_cancel_order` 仍是能寫的 service_role 路徑。⇒ 承重的精確說法是:
**①實際 REVOKE 掉的那些函式**、drain 回 0 之後沒有新交易能經**它們**寫;
其餘寫入面(取消側 + owner / pg_cron / 持 owner 憑證的服務)仍在能力範圍內(見 ① 的殘餘寫入面**四面**)。
⇒ 災難日若 ④ 窗口內對帳結果與 ② 留檔對不上,先查那四個面,不要當成 ⑤ 的邏輯錯。

## 步驟 ⑥(選擇性):續走 A1 全回滾(依賴已清零才合法)

🔴 **重建之後必須把 A5a 的寫入權還回去**(關卡2 MF2):步驟① 的 REVOKE 不會被 forward 重放
A1/A4a 的動作抵銷 —— 重建完成、對帳綠之後若忘了這一句,採購寫入會**永久停擺**而系統看起來一切正常
(員工按儲存只會收到權限錯誤,沒有任何告警)。
⚠️ **v3 時點釘死;v3b(codex R2)連版面也釘:GRANT 的 SQL 不放本步、實體移到最後的步驟 ⑦**
——照文件順序操作的人不會在防線已拆/摘要表已 DROP 時提早恢復 writer。

```sql
-- 前置:步驟③(a) 重跑 = 0;③(b) 清單無其他消費端。
BEGIN;
DROP TABLE public.order_item_quantity_summary;   -- 連帶**十條** CHECK 與複合 FK(A1 七 + B2-S2a 三;A1 §9 原文寫「七條」已過期)
ALTER TABLE public.order_items DROP CONSTRAINT order_items_id_quantity_key;
COMMIT;
```

### 🔴 B2-S2a apply 前置步驟(**必跑,不是建議**;2026-08-06 補)

重放或首次 apply `20260806100000`(B2-S2a)**之前**,先對目標站跑唯讀前置閘:

```bash
PGHOST=<host> PGPORT=<port> PGDATABASE=<db> PGUSER=<user> scripts/b2s2a-verify.sh gate
```

🔴 **密碼放 `~/.pgpass`(權限 600),連線字串一個字都不要出現在命令列上**(codex 關卡2 R1+R2)。
理由:含密碼的 URI 若寫成參數,①會留在 shell history ②執行期間同機的 `ps` 看得到 argv。
`export B2S2A_GATE_URL=…` **不是解法** —— 那行本身仍進 history,而且值最後還是被展開成 psql 的參數。
本模式零參數時完全靠 libpq 原生的 `PGHOST`/`PGPORT`/`PGDATABASE`/`PGUSER`/`~/.pgpass` 取得連線,
psql 命令列上不帶任何憑證。
(仍支援 `scripts/b2s2a-verify.sh gate "<連線字串>"`,但**只用於本機無密碼的拋棄庫**。)

🔴 **migration 檔內的 `S2A-APPLY-NOTE` 那段已過期,以本節為準**(Fable R3 nit):
它寫於 harness 尚未交付時,字面說「該檔目前尚未存在 ⇒ 執行者是 apply 當下的人」。
harness 已交付(`scripts/b2s2a-verify.sh gate`),但那段話在 sha 凍結的檔案裡、**不能改**
(改了會讓整支 harness 的凍結值全部失效)。**首次 apply 的人請以本節的指令為準。**

🔴 **先讀懂「紅」在哪個情境代表什麼(2026-08-06 Fable R3 補;沒有這段會卡死在半夜)**:

| 情境 | gate 預期結果 | 紅了怎麼辦 |
| --- | --- | --- |
| **①首次 apply / 出貨線尚未上線** | 綠(exit 0) | **紅 = 真的有事**。停,問 Sean。不得硬繞。 |
| **②災難重建、出貨線已上線**(本節下方 Forward 重建的**主情境**) | **紅(exit 3)= 預期,不是故障** | **接下方替代路徑 A**,不要試圖讓 gate 變綠。 |

情境②為什麼必紅:出貨線上線後 `shipments`/`shipment_items` 一定非 0,而 gate 用的是裸列數。
這時 gate 的作用不是放行,是**逼你停下來走對的那條路**——它擋掉的正是「整檔重放 → `DEFAULT 0`
把已出貨品項寫成 0」那個真正會毀資料的動作。

- 通過(exit 0)= 兩張出貨表皆 0 列 → 可以往下走。
- **不通過(exit 3)= 停。** 情境①→**問 Sean**(有真實資料時 S2a 的 `DEFAULT 0` 語意要重新確認,
  這不是技術問題、是決定);情境②→照下面的路徑 A 做。連不上目標時也算不通過(fail-closed)。
  🔴 **等待期間的系統狀態**:若已執行本文件上方的 rollback 區塊,`order_item_quantity_summary`
  **已被 DROP**,後台所有依賴它的畫面與統計都是斷的 —— 這段時間不是「安全等待」,要當成停機處理。
  ✅ **Sean 2026-08-06 拍板 A(`B-139-A`):不設時限** —— 情境①紅了就**停到 Sean 回覆為止**,
  沒有「等多久就可以自己決定」這回事,期間當停機處理,**不得自行往下走**(fail-closed)。
  決策題原文與來由見 `docs/reviews/2026-08-06-b2-s2a2-reviews.md` §8.6。
  🔴 **給未來**:本板成立的前提是「現實 operator = Sean 本人或其授權 session」。
  出現**第三方操作員**(外包/新同事/值班輪班)時,**本板必須重拍** ——
  對非 Sean 的人而言「無限期等一個人」不是可執行的指示。
- 🔴 **執行前必看那行 `🎯 連線目標:`**:gate 零參數時吃的是當下 shell 的 `PG*` 變數,
  殘留設定會讓你對**錯的庫**拿到綠燈。目標不是你要 apply 的那個庫就立刻停。
- 該模式**唯讀**:只跑兩個 `count(*)`,零 DDL、零寫入,對正式站安全。
- 🔴 **S2b 契約債**:gate 把「無出貨真值」定義成**恰好這兩張表**的列數。S2b 或後續片若新增任何
  出貨資料面(歸檔表、其他來源表),**必須同批把 gate 的查詢一起擴** —— 否則它會綠著放行。
- DB 層另有一道更精確的 fail-closed 閘寫在 migration §1(有效已寄出的**品項列數**必須為 0);
  兩者刻意不同:草稿箱有品項但未寄出時真值仍為 0,不該被裸列數擋下來,但那種狀態值得一個人看一眼。

🔴 動手前先跑上一節的 **B2-S2a apply 前置閘**,並先讀懂該節的情境表 ——
**出貨線已上線時 gate 必紅,那是預期,直接接下方路徑 A**。

**Forward 重建**(任一時點):依序重放 A1(`20260730150000`)、A4a(`20260803140000`)、**B2-S2a(`20260806100000`)**、**B2-S2b(`20260806180000`)**四支 migration 檔(**照時間戳序;S2a 負責把 A1 重放蓋掉的註解再覆寫回來,S2b 排最後**) → A4a backfill 由真相重算 → 快照/divergence/received_drift 三表**加上步驟①(2) 建的 `a4a_rollback_revoke_at`
(2026-08-08 W7c 新增,共<u>四</u>張)**事後 `DROP TABLE` 歸檔或清除。
🔴 **S2a 不能漏(2026-08-06 補;漏了零告警)**:A1 只把摘要表重建成**五欄**,而 `db push` **不會重跑已登記在 ledger 的 S2a** ⇒ 摘要表永久少 `shipped_quantity` 一欄與三條 CHECK,沒有任何東西會紅。重建後必須實查 **6 欄 / 10 條 CHECK**。
🔴🔴 **S2b 也不能漏(2026-08-06 B2-S2b-3b 補;plan 項31 = 契約債④)**:漏了它,
helper 會停在**三軸**(A4a 版)、出貨側 trigger 不存在 ⇒ **`shipped` 軸永遠不再更新,而三軸對帳全綠、零告警**。
重建後必須實查:**helper 是四軸**(`pg_get_functiondef` 內含 `shipped_quantity`)且
**`shipments_summary_recompute_ac` 存在**。
🔴 **S2b 的重放方式(它不是「整檔貼上去」就好)**:
①它的 §1 前置閘會 pin **A4a helper 的三軸指紋** ⇒ 必須在 A4a 重放**之後**跑,順序不可倒。
②**沒做過步驟④ 就整檔重放它 = 一定失敗,而且第一個紅不是你以為的那個**
(2026-08-06 R1 更正:上一版說會撞 `42710`,實際順序不是那樣):
helper 此刻是**四軸** ⇒ **最先紅的是它自己的 §1 前置閘(`P2B10`,三軸指紋不符)**;
就算閘過了,`CREATE FUNCTION pcm_a4a_shipments_summary_recompute()`(**無** `OR REPLACE`)
排在 trigger 之前 ⇒ 下一個紅是 `42723`,`42710` 根本輪不到。
⇒ **正確做法**:先照步驟④ 拆除(五 trigger / 六函式)再重放整檔;或照 §6 替代路徑手動挑段跑。
🔴 **本行是契約:未來任何動到 `order_item_quantity_summary` 的 migration,同一片必須把自己加進本行。**
🔴 **S2a 重放會被自己的閘擋下(必讀)**:S2a 檔內 §1 是 fail-closed 閘 ——
「有效已寄出量 <> 0 就 RAISE」。災難重建通常發生在出貨線已上線之後 ⇒ **直接重放該檔必然 abort**。
那不是故障,是它在說「DEFAULT 0 會寫下錯的真值」。替代路徑(擇一,不得硬繞閘):
  · **A**(預設):跳過整檔重放,手動在**一個交易內**依序跑該檔的 §2 → §3 → §4:
    🔴 **必須自己補 `BEGIN;` … `COMMIT;`**(codex 關卡2 R2)—— psql 逐句 autocommit,
    少了交易邊界時 §4 驗收紅掉,前面的 `ALTER` 與 COMMENT **已經分段提交下去了**,
    會留下一個「加了欄但沒驗過」的半套狀態。內容 = §2 那**一個 `ALTER TABLE`(四個 ADD:加欄 + C8 + C9 + C6′)**、§3 的七句 COMMENT,
    🔴 **並且必須把該檔 §4 的結構驗收 DO block 一起跑**(少了它,這條手動路徑**一條驗證都沒有**
    —— 打錯一個約束名或漏一句 COMMENT 都零告警)。跑完應看到
    `S2A 結構驗收全數通過(6 欄 / 10 CHECK / 7 註解物件)`;沒看到就是沒過,不得往下走。
    (§1 的閘刻意**不**跑 —— 走這條路徑的前提就是它會紅。)

    再由大線 B2-S2b 的真值 backfill 從 `shipment_items JOIN shipments` 重算填值。
  · **B**:先確認出貨表確實無有效已寄出量(例如尚未上線),再整檔重放。
🔴 **契約債**:此清單是手寫的、沒有機制保證同步 —— **未來任何動到 `order_item_quantity_summary` 的 migration,同一片必須把自己加進本行**,並更新上面那個「幾欄幾條 CHECK」的數字。
🔴 **A1 重放的已知蓋寫(2026-08-03 家族序跑實錘)**:A1 `:170` 會 `COMMENT ON TABLE order_item_procurement`,把 **S1b 之後修訂的表註解蓋回 A1 版** ⇒ forward 前先快照 `obj_description`、重放後還原(演練腳本已內建);未來任何晚於 A1 且動過相同物件註解/屬性的 migration 同受此約束。

## 步驟 ⑦(最後一步;前提=⑥ 的 forward 重建完成+對帳綠):A5a 回權 + 出貨側回權(五支 writer + 重算 trigger)

前提逐條 yes 才跑:☐ A1+A4a+**S2a** 已重放(實查 6 欄 / 10 CHECK)☐ backfill 對帳綠 ☐ 三張證據表已處置
☐ 🔴 **S2b(`20260806180000`)已重放**(實查 helper 是**四軸**、`shipments_summary_recompute_ac` 在)。
🔴🔴 **最後那一格為什麼要獨立列**(2026-08-06 B2-S2b-3b;第二段依步驟④ 改動重寫):
步驟④ 現在會把出貨側 trigger **連同它的函式一起 DROP** ⇒ 這條路上 trigger 的存在與否,
完全取決於**你有沒有重放 S2b**:
- **只重放 A1+A4a+S2a**(漏了 S2b)⇒ trigger 不存在、helper 停在**三軸**。
  此時跑下面的 ENABLE 會**直接紅在 `42704`(trigger 不存在)** —— 那是**好事**,它擋住你。
  🔴 真正危險的是**不跑 ENABLE 就收工**:`shipped` 軸永遠不再更新,而三軸對帳全綠、零告警。
- **四支都重放**⇒ trigger 由 S2b **重新建出來、預設就是 enabled**,helper 是四軸。
  下面那句 ENABLE 在這條路上**是 no-op**(驗證查詢回 `O`),留著是保險與可讀性。
⇒ **這一格要實查的是「helper 是四軸 + trigger 在」,不是去猜 ENABLE 會不會報錯。**
🔴 **S2b 的重放方式見步驟⑥ 的 Forward 重建那一節**(2026-08-06 B2-S2b-3b 已補):
重點兩條 —— ①必須排在 A4a **之後**(它的前置閘 pin A4a helper 的三軸指紋)
②**沒做過步驟④ 就整檔重放它必失敗,而且第一個紅是前置閘 `P2B10`(三軸指紋不符),
不是 `42710`**(2026-08-06 R2 更正:我在⑥ 把這個碼改對了,卻在這裡又寫回舊的;
`CREATE FUNCTION` 無 `OR REPLACE`、排在 trigger 之前 ⇒ 就算閘過也是 `42723` 先撞,
`42710` **不可達**)。詳見⑥。
(⚠️ v4 互指:若走的是 **a7 全回滾**(取消表已 DROP)⇒ A4a 永無法重放、本步前提**永不可滿足**
——回權改走 `2026-07-30-a7-rollback.md` 步 8 的 a7 專屬前提,勿在此卡死。)

```sql
-- 🔴 簽章 = 12 參(A9h-M 20260806200000 起;末參 p_preserve_optional_fields boolean)。
GRANT EXECUTE ON FUNCTION public.admin_upsert_item_procurement(
  uuid, uuid, integer, text, text, timestamptz, text, text, date, text, text, boolean) TO service_role;
-- 驗:應回 t
SELECT has_function_privilege('service_role',
  'public.admin_upsert_item_procurement(uuid,uuid,integer,text,text,timestamptz,text,text,date,text,text,boolean)', 'EXECUTE');
```

```sql
-- 🔴 **出貨側回權**(2026-08-06 B2-S2b-3b:與步驟①(1b) 對稱;債① 的另一半)。
-- 🔴 **少了這一步的後果最陰**:出貨側**永久停寫** —— 之後每一次出貨/作廢都不再更新
--     `shipped_quantity`,而**三軸對帳仍然全綠**(前三軸都對),沒有任何東西會提醒你。
--     ⇒ 這一步不是收尾整潔,是不變式本身。
-- ⚠️ 前提:**A4a + S2b 都已重放**(見上方前提清單最後一格)。
-- 🔴 **本句在兩條路上的意義不同(2026-08-06 3b 第二段重寫;步驟④ 現在會 DROP 那支 trigger)**:
--   ①**走完⑥ 四支全重放**:trigger 由 S2b 重建、**預設已是 enabled** ⇒ 這句是 **no-op**,
--     驗證查詢回 `O`。留著是保險與可讀性,不是因為它有事要做。
--   ②**④ COMMIT 之前中止、後來決定不回滾了**:trigger 還在但被①(1b) DISABLE ⇒ **這句才是實質動作**,
--     而且**非做不可**(見步驟④ 終點下方那段)。
-- 🔴 **漏了 S2b 重放就跑這句** ⇒ 紅在 `42704`(trigger 不存在)。那是它在擋你,不要用 IF EXISTS 吞掉。
ALTER TABLE public.shipments ENABLE TRIGGER shipments_summary_recompute_ac;
-- 驗:應回 O(enabled);回 D 代表沒生效,停下 —— 出貨側還是停寫狀態
SELECT tgenabled FROM pg_trigger
 WHERE tgrelid = 'public.shipments'::regclass
   AND tgname = 'shipments_summary_recompute_ac' AND NOT tgisinternal;
```

```sql
-- (⑦-c) 🔴 **出貨側五支 writer 回權**(2026-08-08 W7c:與步驟①(1a) 對稱)。
--
-- 🔴🔴 **順序是硬的:這一塊必須排在上面那句 ENABLE <u>之後</u>**,而且上面那句要先驗到 `O`。
--     反過來做(先還 writer、trigger 還停著)會開出一個**最陰的視窗**:
--     員工照常出貨 ⇒ `shipment_items` / `shipped_at` 真的落地(真相動了),
--     但重算 trigger 還是 disabled ⇒ `shipped_quantity` **不跟動**,
--     而前三軸都對 ⇒ **三軸對帳全綠、零告警**,漂移要等到下一次有人肉眼對數字才會發現。
--     ⇒ 這與步驟①(1a) 排在 (1b) 之前是**同一條理由的鏡像**:
--       停寫時先停真相側、再停摘要側;回權時先開摘要側、再開真相側。
--       兩次都讓「真相在動而摘要沒在動」這個狀態**不存在**。
--
-- ⚠️ 前提與 A5a 那一句**不同,不要照抄**:這五支 writer **從頭到尾沒有被拆過**
--    (步驟④ 只 DROP 五 trigger / 六函式,不含它們)⇒ 本塊是**純還權**,
--    不相依於任何一支 migration 有沒有重放。漏了 S2b 也不會讓本塊紅。
-- 🔴 **簽章 = 實查值**(來源同 (1a);打錯 ⇒ `42883`)。
GRANT EXECUTE ON FUNCTION public.admin_create_shipment(text, uuid, jsonb, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_add_shipment_items(text, uuid, jsonb)          TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_mark_shipment_shipped(text, uuid, text)        TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_void_shipment(text, uuid, text)                TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_unvoid_shipment(text, uuid)                    TO service_role;
-- 驗:五列應全回 t;任一回 f 代表那一支沒還到 —— 員工當天會出不了貨(loud,但一樣是停業)
SELECT p.proname, has_function_privilege('service_role', p.oid, 'EXECUTE') AS granted
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('admin_create_shipment','admin_add_shipment_items',
                     'admin_mark_shipment_shipped','admin_void_shipment','admin_unvoid_shipment')
 ORDER BY p.proname;
-- 🔴 若步驟①(1a) 當時**也停了** `admin_cancel_order`(那是本檔債⑤、預設沒停,見步驟①),
--    這裡要一併還:`GRANT EXECUTE ON FUNCTION public.admin_cancel_order(uuid, uuid, text, text, text, jsonb) TO service_role;`
```

```sql
-- (⑦-d) 🔴🔴 **離場前的 catch-all:有沒有<u>任何</u>trigger 還停在 disabled?**
--     (2026-08-08 W7c R3 補;它一次關掉一整類錯,不是只關「忘了 (1b) 回權」那一個。)
-- 🔴 為什麼需要它:災難日為了繞鎖 / 繞守門,人**很可能臨時多關了幾支 trigger**
--    (附錄 A-6 就教了逐支 `DISABLE TRIGGER` 的寫法)。本檔前面每一句 ENABLE 都是**指名**那一支,
--    指名的東西只救得了你想得到的那一支。**臨時關掉的那些沒有任何地方記錄** ⇒
--    回滾走完、三軸對帳全綠、零告警,而某支守門或重算永久失效 —— 本檔最陰的那個形狀,又一個入口。
-- ⇒ **應回 0 列。** 回了幾列就是那幾支還停著:逐支 ENABLE 回去,再重跑本查詢直到 0 列。
SELECT c.relname AS 表, t.tgname AS 還停著的_trigger
  FROM pg_catalog.pg_trigger t
  JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
 WHERE NOT t.tgisinternal
   AND t.tgenabled = 'D'
   AND n.nspname = 'public'
 ORDER BY 1, 2;
```

---

## 附錄 A:B2 出貨線的災難日修資料配方(哪扇門配哪把鑰匙)

> **為什麼有這一節**:`B-288-STOP` 實錘「**完整的災難日配方全 repo 零文件記載**」——
> 「哪扇門配哪把鑰匙」當時**只寫在 trigger 的 `COMMENT` 裡**,而逐字說「**但那不是 runbook**」。
> 本節把它搬進 runbook,並且**每一格都實測過**(2026-08-08 W7c;裸 PG、全 migration 重放至
> `20260808000000` 的拋棄式叢集,非正式站 —— 誠實界見本節最後)。
> 🔴🔴 **停 —— 你是不是在跑步驟①-⑦ 的途中撞到紅燈,搜錯誤碼搜到這裡的?**
> (`P2B30` / `P0001` / `23514` / `40P01` 這些碼**全檔只出現在本附錄**,所以 Ctrl-F 會把你直接送進來。
>  2026-08-08 W7c R3 抓到這條誤用路徑。)
> **如果是:回去,本節不是給你的。** 回滾程序中撞到守門,正確反應是**照步驟①-⑦ 各自的紅燈處置**
> (那些步驟自己寫了每個紅代表什麼),**不是**用本節的鑰匙把守門關掉硬推 ——
> 那會在你已經停寫、快照已留檔的狀態下再動真相,**步驟⑤ 的整套判準當場失效**。
> 🔴 本節講的是**「回滾程序以外」的手動修資料**(平常日、沒有在跑回滾的時候)。
> 步驟①-⑦ 有自己的停寫/回權序,不要拿本節的鑰匙去繞它們。

### A-1 門有幾扇、分幾型

`shipments` + `shipment_items` 上共 **13 支**非 internal trigger(實查 `pg_trigger`),依 `tgenabled` 分**兩型**:

| `tgenabled` | 支數 | 代表 | 有沒有 GUC 鑰匙 | `session_replication_role='replica'` 關得掉嗎 |
| --- | --- | --- | --- | --- |
| **`A`(ALWAYS)** | **1** | `shipments_no_batch_update_as`(STATEMENT 級批次閘) | **有**:`pcm_b2.batch_shipments='1'` | 🔴 **關不掉** |
| **`O`(ORIGIN)** | **12** | `shipments_write_once_bu` / `shipments_frozen_after_ship_bu` / `shipments_immutable_guard_bu` / **`shipments_summary_recompute_ac`** / `shipment_items` append-only 三支 … | **沒有** | ✅ 關得掉 |

🔴 **這就是 O/A 不對稱的實體**:**唯一**有 GUC 鑰匙的那扇門,正好是**唯一** replica 開不了的那扇;
其餘 12 扇沒有 GUC 鑰匙、只能靠 replica(或逐支 `DISABLE TRIGGER`)。
⇒ **沒有任何一把鑰匙開得了全部**,也**沒有一扇門是零鑰匙的**。要開哪扇,就得挑對哪把。

### A-2 實測矩陣(全部 2026-08-08 W7c 實跑,不是 PG 語義推論)

| # | 動作 | 鑰匙 | 實測結果 |
| --- | --- | --- | --- |
| 1 | 一句 `UPDATE` 改 **2 列** `shipments` | 無 | 擋下 `P2B30`(批次閘) |
| 2 | 同上 | `session_replication_role='replica'` | 🔴 **仍擋下 `P2B30`** —— ALWAYS 不受 replica 影響 |
| 3 | 同上 | `pcm_b2.batch_shipments='1'` | ✅ 放行 |
| 4 | 改**已出貨列**的 `shipped_at` | 無 | 擋下 `P0001`(出貨時間 write-once) |
| 5 | 同上 | `pcm_b2.batch_shipments='1'` | 🔴 **仍擋下 `P0001`** —— 那不是這扇門的鑰匙 |
| 6 | 同上 | `session_replication_role='replica'` | ✅ 放行 |

### A-3 🔴🔴 用 replica 那把鑰匙的**三個副作用**(全部實測,災難日最容易踩)

1. **摘要會靜默過期。** 重算 trigger 是 `O` ⇒ replica 期間它**不發火**。
   實測:兩箱各 3 件(摘要 `shipped_quantity`=6)→ 在 replica 下作廢其中一箱 →
   真值變 **3**、**摘要仍停在 6**,且**沒有任何東西會紅**。⇒ 見 A-4 步驟 ④,**必須手動重算**。
2. **`CHECK` 不會被關掉。** 它不是 trigger。實測:replica 下只設 `deleted_at` 不設 `void_reason`
   仍紅在 `23514 shipments_void_pair`。⇒ 別把「replica 開了」讀成「什麼都寫得進去」。
3. **🔴 FK 會被繞過,而且髒資料真的落地。** FK 是 internal trigger,replica 一起關。
   實測(**單例**:`shipments.customer_user_id` 這一條 FK;**其餘 FK 欄是依同一 PG 機制推廣、未逐條實測**):
   replica 下把它寫成一個**不存在的 uuid** —— **成功寫入**,
   事後查該列確實是那個孤兒值。⇒ **這是本節最危險的一條**:它不報錯、不留痕,
   而你以為自己只是關掉了幾支業務守門。**用 replica 改任何帶 FK 的欄之前,自己先確認目標值真的存在。**

### A-4 配方(照這個順序做)

```sql
-- ① 決定要開哪扇門,照 A-1 選鑰匙。**兩把鑰匙不互通,不要亂試。**
-- ② 一律用**顯式交易**。🔴 `SET LOCAL` 在顯式交易之外是 no-op、只發 WARNING
--    (互動式 psql 逐句、Supabase SQL Editor 逐句都中)—— 逐字來自
--    `pcm_b2_shipments_no_batch_update()` 的 COMMENT;它會讓你以為鑰匙轉了、其實沒轉。
BEGIN;
  -- 門①(一句改多列)用這把:
  SET LOCAL pcm_b2.batch_shipments = '1';
  -- 門②(改已出貨列的 recipient 三欄 / shipped_at)用這把(owner 專用):
  -- SET LOCAL session_replication_role = 'replica';
  UPDATE public.shipments SET /* … */ WHERE /* … */;
  -- ③ COMMIT 前先自己驗:有沒有踩到 A-3 第 3 條(FK 已被關掉,沒人幫你擋)
COMMIT;
```

```sql
-- ④ 🔴🔴 **只要你是用 replica 改過 `shipments` / `shipment_items`,這一步不是選配。**
--    重算 trigger 在那段期間沒發火 ⇒ 摘要現在是舊的、而且三軸對帳可能全綠。
--    逐品項直呼 helper 重算(實測:6 → 3,與真值一致)。
-- 🔴 **升冪取鎖不是裝飾**:helper 會對 parent 取 `FOR NO KEY UPDATE`,與出貨側重算 trigger
--    的迴圈是**同一條取鎖序**。手動重算若不照 `order_item_id` 升冪跑,碰上同時在跑的
--    出貨 / 取消交易就是反序取鎖 ⇒ 真 `40P01` 死結。
--    (同一條不變量的實證見 `scripts/w6a-unvoid-race.sh` 與 `scripts/w7b-cancel-vs-ship-lockorder.sh`。)
-- 🔴 **用 `FOR … ORDER BY` 迴圈,不要寫成 `SELECT f(x) FROM (… ORDER BY …) t`**:
--    子查詢的 `ORDER BY` **不保證**傳遞成外層的求值順序(PG 沒有這個保證),
--    那種寫法會讓「升冪」變成碰運氣 —— 而它失敗的樣子就是偶發死結。
DO $fix$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT si.order_item_id AS oid
      FROM public.shipment_items si
     WHERE si.shipment_id IN ( /* 你剛才動過的 shipment id 清單 */ )
     ORDER BY 1
  LOOP
    PERFORM public.pcm_a4a_recompute_order_item_summary(r.oid);
  END LOOP;
END $fix$;
-- 🔴 **這份清單只是「便宜的第一發」,不是完備的**:它從 `shipment_items` 的**現存列**回推品項,
--    而 replica 期間 append-only 三支(`shipment_items_block_delete_bd` 等)也是 `O` = **刪得掉列**
--    ⇒ 被刪掉的品項在這裡查不回來。**真正的完備出口在下面的 ⑤**(吃對帳結果的 id),⑤ 是必跑的。

```

**⑤ 收尾對帳 —— 🔴 不要在這裡另寫一份查詢,跑<u>步驟②</u> 的 `a4a_rollback_divergence` 區塊。**

理由有兩條,都不是潔癖:

1. **本檔的 shipped 真相式是<u>受守門的</u>**:全檔 `-- SHIPPED-TRUTH-BEGIN/END` 之間共 **6 塊**,
   由 `scripts/b2s2b-truth-sync.py` 逐塊比對整塊序列。**在附錄裡手抄第 7、8 份 = 守門看不到的複本**,
   未來真相式改動時它們會靜默漂移,而災難日的人剛好就是拿它們在對帳。(2026-08-08 W7c R1 抓,已改掉。)
2. **步驟② 那段掃得比較寬**:它用 `order_item_procurement ∪ order_cancellation_items ∪
   order_item_quantity_summary ∪ shipment_items` 的**全集**驅動 ⇒ 抓得到「有真值、**摘要根本沒有那一列**」
   的 shipment-only 形狀。只從 `order_item_quantity_summary` 出發的寫法對那個形狀**恆綠**——
   而 replica 期間新插 `shipment_items` 正好會造出它。

🔴🔴 **但<u>不要</u>「把步驟② 整段貼過來」,那有兩個坑(2026-08-08 W7c R2 抓)**:

- **整塊貼** ⇒ 你會帶到步驟② 的 `BEGIN;` 而**它的 `COMMIT` 在步驟⑤ 的尾巴**(不在②裡)
  ⇒ 連線一還,CTAS **靜默消失**,下次查 count 紅 `42P01`,而你以為自己對過帳了。
- **只貼 CTAS 那一句** ⇒ autocommit 會落地,但**沒帶步驟② 的 RLS + REVOKE 兩件套**
  ⇒ CTAS 繼承 default privileges,**內部採購/取消數字曝露到 PostgREST 面**直到你 DROP 為止。
  (而且步驟② 那句 `REVOKE` 是**一句涵蓋三張表**的,單抄過來會因另兩張不存在紅 `42P01`。)

⇒ **用下面這份自足配方**(只建一張表、自己帶交易邊界、自己帶硬化):

```sql
-- ⑤-1 對帳:自足版(只建 divergence 一張,含交易邊界與 escape 兩件套)
BEGIN;
  -- 🔴 這裡貼**步驟② 的 `CREATE TABLE public.a4a_rollback_divergence AS …` 那一段**
  --    (從 `CREATE TABLE` 到該段結尾的 `;`,不要帶步驟② 的 BEGIN、不要帶另外兩張表)。
  ALTER TABLE public.a4a_rollback_divergence ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON TABLE public.a4a_rollback_divergence FROM PUBLIC, anon, authenticated, service_role;
COMMIT;

-- ⑤-2 看結果
SELECT count(*) AS divergence_rows FROM public.a4a_rollback_divergence;
```

- **回 0** ⇒ 對帳綠。`DROP TABLE public.a4a_rollback_divergence;` 收工。
- **非 0** ⇒ **先不要 DROP**(下面的出口要讀它),照下一塊做。

```sql
-- 🔴 回不了 0 時的**出口**(2026-08-08 W7c R1 補;沒有這段會在災難日繞死圈):
--    **不要**拿 ④ 的同一份 shipment 清單重跑 —— 若 ④ 漏了某個 shipment(例如 replica 期間
--    `shipment_items` 的 append-only 三支也是 `O`、被刪過列 ⇒ 那些 order_item_id 已經查不回來),
--    重跑幾次都會漏同一批。**改成直接吃對帳結果的 id**:
--
-- 🔴🔴 **先把「孤兒品項」挑掉再跑,否則整包一起炸(2026-08-08 W7c R2 抓)**:
--    A-3 第 3 條自己證了 replica 下 FK 繞得過 ⇒ `shipment_items` 裡**可能有指向不存在
--    `order_items` 的列**;divergence 的候選全集含 `shipment_items` ⇒ 那個孤兒 id 會被撈進來。
--    而 helper 對「parent 不存在」是**直接 RAISE**(`20260806180000:199-204` 防衛枝,
--    逐字「此枝理論不可達」—— 但 replica 讓它可達了)⇒ **DO block 是單一交易、整段回滾,
--    連本來修得好的品項也一筆都沒修到**,而錯誤訊息只說「理論不可達」、不指路。
--    ⇒ 下面的 `JOIN public.order_items` 不是裝飾,是讓好的品項修得動。
-- ⑤-3a 先看有沒有孤兒(有的話它們**不是重算問題**,是資料修復問題,另案處理)
SELECT d.order_item_id AS 孤兒品項
  FROM public.a4a_rollback_divergence d
  LEFT JOIN public.order_items oi ON oi.id = d.order_item_id
 WHERE oi.id IS NULL;

-- ⑤-3b 只重算 parent 還在的那些
DO $fix2$
DECLARE r record;
BEGIN
  FOR r IN SELECT d.order_item_id AS oid
             FROM public.a4a_rollback_divergence d
             JOIN public.order_items oi ON oi.id = d.order_item_id   -- 🔴 濾孤兒,見上
            ORDER BY 1                      -- 🔴 升冪,理由同 ④
  LOOP
    PERFORM public.pcm_a4a_recompute_order_item_summary(r.oid);
  END LOOP;
END $fix2$;
```

**⑤-4 收尾:重驗一次 —— 🔴 順序寫死,不要自己排**

1. `DROP TABLE public.a4a_rollback_divergence;`(**先 DROP**,不然 ⑤-1 重建會紅 `42P07`)
2. 重跑 **⑤-1** 那整塊(含 `BEGIN`/`COMMIT` 與兩件套)
3. 再跑 **⑤-2** 看 count

判讀:

- **回 0** ⇒ 修好了,`DROP TABLE public.a4a_rollback_divergence;` 收工。
- **仍非 0,而 ⑤-3a 有列** ⇒ 差額就是那些孤兒:**停下來,不要再重算** —— 那是資料修復問題
  (replica 下寫進來的孤兒 `shipment_items`),重算一百次也不會變。
- **仍非 0,而 ⑤-3a 是空的** ⇒ 真值本身在動或壞了(例如 replica 期間誤刪過 `shipment_items`)
  ⇒ 一樣停下來查,不要再重算。

🔴 **不要在 ⑤-3b 之前就 DROP 掉 divergence 表** —— 它是 ⑤-3a/⑤-3b 的輸入,先 DROP 會讓兩者紅 `42P01`。

### A-5 全 repo 的 GUC 鑰匙**就這兩把**(2026-08-08 實查)

`grep -rhoE "current_setting\('[a-z_0-9.]+'" supabase/migrations/*.sql | sort -u` 扣掉
`transaction_isolation`(PG 內建、非鑰匙)後,自訂 break-glass 旗標**恰兩把**:

| 鑰匙 | 開哪扇門 | 那扇門的型 |
| --- | --- | --- |
| `pcm_b2.batch_shipments = '1'` | `shipments_no_batch_update_as`(一句改多列) | `A`(ALWAYS) |
| `pcm_a4a.received_sync = '1'` | `order_item_procurement_received_quantity_guard_bt`(直寫 `received_quantity`,`P4A01`) | `O`(ORIGIN) |

🔴 第二把是**冗餘的**:它開的那扇門是 `O`,owner 用 replica 一樣開得了。
它存在的理由是給**同權能的 SECDEF 路徑**用(A4a 的 sync/backfill 自己設清旗標),不是給災難日的人用。

### A-6 誠實界(這一節**沒有**證明什麼)

- 🔴 **量的是裸 PG 的拋棄式叢集,不是 Supabase 正式站。** 兩者在 trigger / CHECK / FK 語義上應一致,
  但 **`session_replication_role` 需要 owner**,正式站上誰有那個身分**本節沒查**。
- 🔴 **`PostgREST` 路徑下不了 `SET LOCAL`**(逐字來自批次閘的 COMMENT)⇒ 本節的鑰匙**只有直連 SQL 能用**,
  應用層繞不到這裡。未來的批次 writer 要在 RPC 內用 `set_config(...)`,不是把守門放寬。
- 🔴 **`DISABLE TRIGGER` / `DROP TRIGGER` / owner 本身擋不住** —— 與本線一路的誠實邊界同一條。
  逐支關的寫法是 `ALTER TABLE public.shipments DISABLE TRIGGER <trigger 名>;`,
  它兩型都關得掉(`A` 也關得掉)、但**不會**自己幫你補回摘要,A-3 第 1 條照樣適用。
- 本節**沒有**演練「災難日全流程」,只演練了「開門 → 改 → 補重算」這一段。

---

## 附錄 B:待 Sean 裁的決策題(W7c 產出,2026-08-08)

**B-1 · O/A 對稱(承 `B-195-A`「災難日 O/A trigger 不對稱、無 break-glass → W7c runbook 認領」)**
現況(A-1 實測):13 支裡 **1 支 ALWAYS 有 GUC 鑰匙、12 支 ORIGIN 沒有鑰匙**。
問題不是「有沒有鑰匙」,是**災難日的人得記住兩把鑰匙開不同的門**,而記錯的代價是 A-3 那三個副作用
(尤其第 3 條:為了開 row 級守門而用 replica,**連 FK 一起關掉**)。選項:

| 選項 | 做什麼 | 代價 |
| --- | --- | --- |
| **A(本片預設,已完成)** | 不動 schema,只把配方寫進本附錄 | 風險從「不知道」降成「知道了但可能手滑」;FK 那顆地雷**還在** |
| **B** | 把重算 trigger 改成 `ALWAYS` | replica 期間摘要仍跟動 ⇒ 消滅 A-3 第 1 條;要動 migration + apply |
| **C** | 給 row 級守門(`write_once` / `frozen_after_ship`)加 GUC 鑰匙 | 災難日**不必再用 replica** ⇒ 連 A-3 第 3 條(FK)一起消滅;但等於給已出貨列開了一道 break-glass |
| **D** | B + C 都做 | 兩顆地雷都拆掉;兩片 migration |

🔴 本片**只做了 A**(純文件、零 schema 變更)。B/C/D 都要動 migration ⇒ 撞 apply 停點,不在本片範圍。

**B-2 · 債⑤:`admin_cancel_order` 要不要納入步驟①(1a) 的停寫序列**
現況:它對 `service_role` 有 EXECUTE(已實查),在 ②→⑤ 視窗內寫得到摘要,
與 (1a) 是**同一個失敗形狀**;但停掉 = 回滾期間客服無法取消訂單,**那是業務決定不是技術決定**。
⇒ 本片只記帳、未自行納入(理由見步驟①)。選項:

| 選項 | 做什麼 | 代價 |
| --- | --- | --- |
| **A** | 加進 (1a) 的停寫序列,回滾期間一併停取消 | 對帳最乾淨;回滾那幾小時客服**不能取消訂單** |
| **B(現況)** | 不停,只在步驟① 記帳 + 列進殘餘寫入面第四面 | 取消照常;但步驟⑤ 可能紅(白做一輪)或**綠著滑過**(漂移被帶過) |
| **C** | 寫成「可選」,由災難日當下的人依「還在不在營業時間」決定 | 保留彈性;但 runbook 裡的可選項 = 半夜最容易做錯的東西 |
