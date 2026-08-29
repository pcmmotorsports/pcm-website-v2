-- M-4b E4 片3a · `email_outbox.status` 加第七態 `skipped_shipment_voided`
--
-- 🔴 **為什麼需要它 —— 而這一格是量到的,不是設計偏好**:
--    出貨通知信在寄送當下要去主表撈這一箱的脈絡(`IShippedEmailContext`),而那支 port 的
--    讀取結果是**三態**:`ok` / `voided`(箱被作廢)/ `unavailable`(讀不到)。
--    `voided` = **正常業務動作**(裝箱數量打錯的唯一補救就是整箱作廢重開;
--    `20260805170200:87` 逐字、Sean `Q-a`=C)。
--    ⚠️ **原本這裡寫「⇒ 不罕見」,那是推出來的不是量到的**(R3 抓;正式庫的 voided 箱數無人量過)。
--    ⇒ 正確的說法:**頻率未量,而【這一片的必要性與頻率無關】** —— 三態讀取結果是碼的事實
--      (`IShippedEmailContext`),就算一年只發生一次也需要落點,因為另兩條路都被既有契約明文禁止。
--    📌 **不要讓一個沒量過的量級替這一片背書 —— 它不需要。**
--    而它今天**沒有地方可以落**:
--      `20260717020000:317` 的 CHECK 只認六個值,沒有一個對應「箱被作廢」。
--
--    ⇒ 只有三條路,而**兩條是有害的**:
--      甲 ❌ 塞進 `markFailed` ⇒ 它的 runtime allowlist 會把碼改寫成 `provider_error`
--            ⇒ 稽核碼被靜默吃掉,而「這封為什麼沒寄」日後查不到
--            (那正是 `markSkippedOrderIneligible` 當初被獨立出來的理由,`IEmailOutbox.ts:308-313`)
--      乙 ❌ 靜默丟掉 ⇒ port 檔頭明文禁止:「**不是靜默丟掉**…少了痕跡的話,
--            『這封信為什麼沒寄』日後查不到任何東西」
--      丙 ✅ 開第七態(本片)
--
-- 🔴 **而這件事有前例,一模一樣**:`skipped_order_ineligible` 自己就是這樣被加出來的 ——
--    `20260717020000:132` 逐字「**codex 關卡2 R4 must-fix:原 5 態白名單沒有這一格,
--    等於逼 E2a 從四個爛選項裡挑,全部有害**」。
--
-- ── 🔴 第七態會不會落在所有告警的射程之外?**量過了,不會** ────────────────────
--    擔心的來源:`20260717020000:127-129` 那段「以 UNCOVERED probe 窮舉六態 × 生死 attempts,
--    證明三訊號 ∪ {sent, skipped_no_real_email, skipped_order_ineligible} 覆蓋全狀態空間」。
--    ⇒ 加第七態 = 那個證明的分母變了。
--
--    ✅ 實量(2026-08-30,對**今天的五訊號實作**):
--      `grep -n "status" supabase/migrations/20260829010000_m4a_email_deadman_alert_counts.sql`
--      ⇒ 六處,**全部是正向列舉**(`IN ('pending','failed')` / `= 'sending'` / `= 'failed'`)
--      ⇒ **沒有任何一處是 `NOT IN` / 排除式**
--      負對照(尺是活的):同把 grep 掃 `order_cancellations` 的 scripts ⇒ 20 支檔
--    ⇒ 📌 **第七態是【終態】,它加入的是「刻意不告警」的補集**(與 `sent` /
--      `skipped_no_real_email` / `skipped_order_ineligible` 同一類),**不是掉進某個排除式的縫裡**
--      ⇒ **本片不動任何訊號述詞。**
--
--    ⚠️ **而有一格未確認,不得被讀成「那份證明重新成立了」**:我量的是**今天的五訊號實作**,
--      而 `20260717020000` 那段證明講的是**三訊號時代** ⇒ **證明本體與今天的實作不是同一份東西。**
--      🔴 而那段話指的「UNCOVERED probe」**沒有留下可重跑的產物**
--      (`grep -rn UNCOVERED supabase/migrations/*.sql scripts/*.sh` ⇒ 只有那句註解本身,
--       與 `b2s2b-verify.sh` 裡無關的 `UNCOVERED_CELLS`)。
--      ⇒ 📌 **一年後沒有人分得出「那個證明還成立」與「沒有人再驗過」。**
--      ⇒ ✅ 本片一併新增 `scripts/email-outbox-state-coverage.sh`:七態 × 生死 attempts = 14 格,
--        對**今天的五訊號**逐格實跑。**它取代不了那份舊證明(分母不同),它是一個新的、可重跑的宣稱。**

BEGIN;

-- 🔴 codex R1 must-fix(1/8):`ALTER TABLE ... ADD CONSTRAINT` 取 **ACCESS EXCLUSIVE** 且全表掃描,
--    而**在單一交易內,那個鎖會一直持有到 COMMIT** ⇒ 期間擋掉這張表的 SELECT/INSERT。
--    ⚠️ **而「改成 NOT VALID → VALIDATE → RENAME」在【本 repo 的形狀下】救不了它** ——
--      那個做法要 VALIDATE **跑在自己的交易裡**才拿得到較弱的 SHARE UPDATE EXCLUSIVE;
--      而本 repo 的 migration 靜態閘要求**恰好一個 COMMIT、且在最後一行**
--      (`scripts/migration-static-checks.sh` 第②道)⇒ 單一交易 ⇒ 拆交易的好處拿不到。
--    ⇒ **所以本檔做的是【縮短並封頂】,不是【消除】**:
--      · `SET LOCAL lock_timeout` ⇒ 拿不到鎖就**快速失敗**,不會無限期擋住別人
--      · 仍用 NOT VALID + VALIDATE 兩步 —— ⚠️ **而 codex R2 更正了我的說法,原句留著**:
--        ~~「它讓失敗點更早」~~ **在同一交易內,NOT VALID 拆兩步【一點好處都沒有】**
--        (ACCESS EXCLUSIVE 一樣持有到 COMMIT、掃描一樣要做)。留兩步的唯一理由是
--        **它讓「約束定義」與「驗證既有資料」在錯誤訊息上分得開**,而那只是可讀性。
--      · ⚠️ **`lock_timeout` 只封鎖【等鎖】那一段,`statement_timeout` 只封【單一句】**
--        (codex R2)⇒ **兩者都不是整筆交易的總上限**。⇒ 這一片對「總時長」**沒有上界**,
--        只有「不會卡在等鎖」與「單句不會跑太久」。**不得寫成「時間有封頂」。**
--      · 🔴 而這一次的掃描**保證會過**:本片是**放寬**(七個值 ⊃ 原六個值)
--        ⇒ 每一列本來就滿足舊的較嚴約束 ⇒ 必然滿足新的較鬆約束
--    ⚠️ **我沒有量到的一格**:`email_outbox` 今天有幾列(要 DB access)⇒ **掃描要多久,未知**。
--      ⇒ **不得寫成「表很小所以沒關係」** —— 那是一個沒量過的量級。
--      ⇒ 這也是為什麼要 `lock_timeout`:它讓「未知」的後果**有上界**。
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- 🔴 codex R2 must-fix:**先拿鎖,再檢查** ——
--    前一版是「前置閘讀 catalog → 然後 ALTER TABLE 才取表鎖」⇒ 兩者之間有一個窗口,
--    並行的 DDL 可以在那裡把同名約束換掉,而本 migration 會**無聲覆蓋它**。
--    ⇒ 明確先 `LOCK TABLE ... IN ACCESS EXCLUSIVE MODE`,讓檢查與改動在同一把鎖底下。
--    ⚠️ 而它**不會**讓交易更早放鎖(單一交易本來就持有到 COMMIT)⇒ 這一行**不增加**擋人的時間,
--      它只是把原本就要拿的鎖**提早到檢查之前**。
LOCK TABLE public.email_outbox IN ACCESS EXCLUSIVE MODE;

-- ── 0. 前置閘(forward-only;已在鎖底下)────────────────────────────────
-- 🔴 codex R1 must-fix(2/8):前一版只驗「六個字串**有出現**」⇒
--    `CHECK ((TRUE OR status IN (...)))` 這種**恆真**的壞世界照樣過,
--    未 validated 的約束也照樣過。⇒ 改成**釘整段正規化後的定義**。
--    📌 PostgreSQL 會把 `IN (...)` 正規化成 `= ANY (ARRAY[...])`
--       (2026-08-30 於 PG 17.10 拋棄式庫實測),所以整段是**可以逐字釘住**的;
--       而 `TRUE OR` 那個壞世界的 def 逐字是 `CHECK ((true OR (status = ANY ...))))` ⇒ **對不上** ⇒ 紅。
--    ⚠️ **代價(codex R2 nit,寫出來)**:`pg_get_constraintdef()` 回的是**重建後的文字**,
--       而那個格式**跨 PG 大版本可能改變** ⇒ 在別的版本上會**假紅**。
--       ⇒ 取捨是 fail-closed(假紅比假綠好),而**貼上去之前先在目標庫跑一次**:
--         `SELECT pg_get_constraintdef(oid) FROM pg_constraint
--           WHERE conrelid='public.email_outbox'::regclass AND conname='email_outbox_status_check';`
--         把回值與本檔的 `v_expect_old` 逐字比一次 —— 不同就是版本格式差異,不是資料壞了。
--       📌 本檔的兩個期望字面是在 **PG 17.10** 上取的(2026-08-30 拋棄式庫實測)。
DO $$
DECLARE
  v_def text;
  v_expect_old constant text :=
    'CHECK ((status = ANY (ARRAY[''pending''::text, ''sending''::text, ''sent''::text, ''failed''::text, ''skipped_no_real_email''::text, ''skipped_order_ineligible''::text])))';
BEGIN
  SELECT pg_catalog.pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.email_outbox'::regclass
     AND c.conname = 'email_outbox_status_check';
  IF v_def IS NULL THEN
    RAISE EXCEPTION '前置閘①:找不到 email_outbox_status_check ⇒ 部署態與預期不符,停下';
  END IF;
  IF pg_catalog.strpos(v_def, 'skipped_shipment_voided') > 0 THEN
    RAISE EXCEPTION '前置閘②:第七態已經在 CHECK 裡了 ⇒ forward-only,拒重跑';
  END IF;
  -- 🔴 整段逐字比對(不是「六個字串有出現」)
  IF v_def <> v_expect_old THEN
    -- 🔴 R3 抓:原訊息只給一個假說(「你的版本不對」),而檔內 :86-92 自己承認**同一個紅也可能只是
    --    PG 版本的 pg_get_constraintdef 格式差異**。Sean 看到的只有錯誤訊息、不會讀註解
    --    ⇒ 那句自信的話會把下一個人派去追一個不存在的 schema drift。⇒ 兩個假說都寫進訊息。
    RAISE EXCEPTION '前置閘③:現行 CHECK 與預期【不是同一段】。兩個可能:①這個庫上的版本與我預期的不同 ②PG 版本的 pg_get_constraintdef 格式差異(本檔期望字面取自 PG 17.10)。判別法:把下面兩段逐字比一次 —— 只差空白/括號排版=②,值不一樣=①。實際:% / 預期:%', v_def, v_expect_old;
  END IF;
  -- 🔴 未 validated 的約束不算數(它可能放行了不該存在的列)
  IF NOT (SELECT c.convalidated FROM pg_catalog.pg_constraint c
           WHERE c.conrelid = 'public.email_outbox'::regclass
             AND c.conname = 'email_outbox_status_check') THEN
    RAISE EXCEPTION '前置閘④:現行 CHECK 是 NOT VALID ⇒ 它沒有驗過既有資料,停下人工對齊';
  END IF;
END
$$;

-- ── 1. 換 CHECK(ADD NOT VALID → VALIDATE → DROP 舊 → RENAME)──────────────
ALTER TABLE public.email_outbox
  ADD CONSTRAINT email_outbox_status_check_v2
  CHECK (status IN ('pending', 'sending', 'sent', 'failed',
                    'skipped_no_real_email', 'skipped_order_ineligible',
                    'skipped_shipment_voided')) NOT VALID;
ALTER TABLE public.email_outbox VALIDATE CONSTRAINT email_outbox_status_check_v2;
ALTER TABLE public.email_outbox DROP CONSTRAINT email_outbox_status_check;
ALTER TABLE public.email_outbox
  RENAME CONSTRAINT email_outbox_status_check_v2 TO email_outbox_status_check;

-- ── 2. 更新 status 的 COMMENT(契約住在這裡;改碼而不改契約 = 埋一顆回捲)──────
COMMENT ON COLUMN public.email_outbox.status IS
  '7 態:pending(待送)/ sending(CAS 已認領、在途)/ sent(終態)/ failed(🔴 **可重試失敗態、非終態**;見下)/ skipped_no_real_email(合成假信箱、不呼 Resend、不進 due 索引;**可翻轉態**)/ 🔴 skipped_order_ineligible(S3=A 落點:寄前 gate 重查發現訂單已退款/取消 → 抑制;**不可翻轉終態**、Q1 線絕不可碰它,否則等於把已退款訂單的付款成功信寄出去;不進 due、不被任何 dead-man 訊號命中 = 預期內的正確靜默)/ 🔴 **skipped_shipment_voided(2026-08-30 M-4b E4 片3a 新增)**:出貨通知信在寄送當下去主表撈脈絡,發現**這一箱已被作廢**(裝箱數量打錯的唯一補救就是整箱作廢重開 = **正常業務動作**,`20260805170200` COMMENT、Sean `Q-a`=C)⇒ 不寄、**落這一態當痕跡**、**不計 error**。🔴 **可翻轉態(與 skipped_no_real_email 同類), 不是不可翻轉終態** —— 箱可以被 admin_unvoid_shipment 用**同一個 id** 復原(20260807210000:151-152), 而出貨信掃描 view 的 anti-join **不分 status**(20260822010000:260 逐字)⇒ 這一列會**永久擋住重新 enqueue** ⇒ 那位客人永遠收不到出貨信而零訊號。⇒ 正解同 skipped_no_real_email:**受控 UPDATE 原地翻回 pending、不可新 INSERT**。🛑 **而【誰去翻它】今天沒有人做 ⇒ 這是一個已知的漏信面, 單獨開一列追蹤, 不在本片**。不進 due、不被任何 dead-man 訊號命中 = 預期內的正確靜默。⚠️ **它與 `unavailable`(讀不到)不可合併** —— 合併之後「系統壞了」與「這批本來就作廢了」在呼叫端變成同一件事,而後者會讓有人半夜起來查一個正常的業務動作(`IShippedEmailContext` 檔頭全文)。⚠️ **它不影響同一張訂單的其他箱**:`order_shipped` 的 dedup_key = `{shipment_id}:{order_id}` ⇒ 重開的新箱是新的 shipment_id = 新的一列。
🔴 **failed 是雙義的、終態界線不在 status 而在 attempts**:每次送失敗即標 failed + 進退避(next_retry_at 推遠)→ 仍會被 sweeper 重新認領(CAS 述詞含 failed);只有 attempts >= max_attempts 才是「不再重試」的終態。故**任何掃描 due 列的述詞都必須含 `attempts < max_attempts`**(REQUIRED-E2a),否則達上限的死列 next_retry_at 恆已過期 → 無限重試、突破 max_attempts。同理 dead-man check(plan §3.6)的「最老 pending/failed age」述詞亦須排除 attempts >= max_attempts 的死列,否則終態列 age 永增 → 永久告警噪音淹掉真正的靜默死亡(= liveness 唯一來源被廢)。DB 層以 due 索引述詞把此約束機械化(見 email_outbox_due_idx)。🔴 skipped_no_real_email 是「可翻轉態」非不可逆終態:它佔住唯一鍵,Q1(LINE 補資料獨立線)補到真實 email 時須以受控 UPDATE 原地翻回 pending、不可新 INSERT(會撞唯一鍵 = 該 cohort 永久漏信);且不得自動回灌。DB 層刻意不鎖狀態機,轉移正確性由 app 層 CAS 負責。';

-- ── 3. 事後閘 ───────────────────────────────────────────────────────────
-- 🔴 同 codex R1 must-fix(2/8):**釘整段,不釘「字串有出現」**。
DO $$
DECLARE
  v_def text;
  v_valid boolean;
  v_com text;
  v_expect constant text :=
    'CHECK ((status = ANY (ARRAY[''pending''::text, ''sending''::text, ''sent''::text, ''failed''::text, ''skipped_no_real_email''::text, ''skipped_order_ineligible''::text, ''skipped_shipment_voided''::text])))';
  v_n_con int;
BEGIN
  SELECT pg_catalog.pg_get_constraintdef(c.oid), c.convalidated INTO v_def, v_valid
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.email_outbox'::regclass
     AND c.conname = 'email_outbox_status_check';
  IF v_def IS NULL THEN
    RAISE EXCEPTION '事後閘①:改名之後找不到 email_outbox_status_check';
  END IF;
  -- 🔴 整段逐字:它同時擋掉「漏抄一個舊值」「多一個沒人要的值」「TRUE OR 恆真」三種壞世界
  IF v_def <> v_expect THEN
    RAISE EXCEPTION '事後閘②:CHECK 與預期【不是同一段】。實際:% / 預期:%', v_def, v_expect;
  END IF;
  IF NOT v_valid THEN
    RAISE EXCEPTION '事後閘③:新 CHECK 仍是 NOT VALID ⇒ VALIDATE 沒跑到';
  END IF;
  -- 🔴 codex R2 must-fix:前一版只數**名稱前綴**符合的 ⇒ 一個【不同名字】的六態 CHECK 可以殘留,
  --    而事後閘照樣綠 —— 然後寫入第七態時被那個殘留的約束擋掉。
  --    ⇒ 改成數【所有提到 status 這個欄的 CHECK 約束】,不看名字。
  SELECT pg_catalog.count(*) INTO v_n_con
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.email_outbox'::regclass
     AND c.contype = 'c'
     AND pg_catalog.strpos(pg_catalog.pg_get_constraintdef(c.oid), 'status') > 0;
  IF v_n_con <> 1 THEN
    RAISE EXCEPTION '事後閘④:這張表上提到 status 的 CHECK 有 % 個(預期恰 1)⇒ 有殘留的舊約束會擋住第七態', v_n_con;
  END IF;

  v_com := pg_catalog.col_description('public.email_outbox'::regclass,
             (SELECT attnum FROM pg_catalog.pg_attribute
               WHERE attrelid = 'public.email_outbox'::regclass AND attname = 'status'));
  IF v_com IS NULL OR pg_catalog.strpos(v_com, 'skipped_shipment_voided') = 0 THEN
    RAISE EXCEPTION '事後閘⑤:status 的 COMMENT 沒有提到第七態 ⇒ 契約與碼分岔了';
  END IF;
  IF pg_catalog.strpos(v_com, '7 態') = 0 THEN
    RAISE EXCEPTION '事後閘⑥:status 的 COMMENT 開頭還寫著舊的態數';
  END IF;

  RAISE NOTICE '事後閘通過:CHECK 逐字相符且已 validated、只有一個約束、COMMENT 已更新為 7 態';
END
$$;

-- ── 4. 行為那一層【本片沒有驗】,而理由與落點要寫出來 ─────────────────────────
-- 🔴 上面三道閘驗的是【定義】(CHECK 的字面、COMMENT 的字面)。
--    **一個 CHECK 的字面對了,與它到底擋不擋得住東西,是兩個宣稱。**
-- 🛑 我原本在這裡寫了一段「行為驗證」,而它是這樣的:
--      PERFORM 1 WHERE 'skipped_shipment_voided' IN ('pending', ..., 'skipped_shipment_voided')
--    ⇒ **那是恆真的** —— 它拿一個字串去比對一份我自己剛打進去的清單,
--      與資料庫裡真正的 CHECK **一點關係都沒有**。它會永遠印綠。
--    ⇒ 📌 **已刪除。留這段註解是因為刪掉之後,下一個人看不出這裡曾經有過一道假的閘** ——
--      而那種閘最危險的時刻,正是它讓人以為「行為也驗過了」的時候。
-- ✅ 真正的行為驗證落點:`scripts/email-outbox-state-coverage.sh`
--    七態 × {attempts<max, attempts>=max} = 14 格,在**拋棄式 PG** 上逐格實寫,
--    並對**今天的五訊號述詞**各跑一次 ⇒ 每一格要嘛被訊號命中、要嘛在「刻意不告警的終態補集」裡。
--    ⚠️ 為什麼不在本檔做:`email_outbox` 有多個 NOT NULL 與唯一鍵,造一列合法測試資料需要一張真訂單
--      ⇒ 那會在正式庫留下一次寫入嘗試。**不在正式庫上做寫入模擬。**

COMMIT;
