-- ═══════════════════════════════════════════════════════════════════════════
-- 「開待退款失敗」今天是沉默的 —— 讓它出聲(`pcm_incident` 一張小表)
--   plan = docs/plans/2026-09-05-pending-refund-open-failure-visible-plan.md(甲案)
--   Sean 2026-09-05 拍板逐字:「Q-待退款開失敗 … A: 甲」(小事故表 + 告警信多一列)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ■ 段一 · 這一片在解什麼
--   `pcm_noncard_settle_recompute`(正式庫現行版)在補開待退款時**自己吞掉例外**,
--   handler 裡只有 `RAISE LOG` ⇒ 🔴 **而沒有任何人在看 Postgres log。**
--   ⇒ 📌 **「開待退款失敗」與「開成功」在今天的訊號上是同一個:什麼都沒有。**
--   🔵 而**吞掉是對的, 本片不碰它** —— 不吞就會把客人那筆收款一起回滾。
--      理由逐字在 `20260905070000_m4b_pending_refund_on_late_payment.sql:357`
--      (⚠️ **那是【那一支】的行號, 不是本檔的** —— codex 2026-09-05 就是照本檔行號去找而找錯了段落,
--       所以這裡把檔名寫出來)。本片只加「吞掉之後留下痕跡」, 那段註解逐字保留。
--
-- ■ 段二 · 為什麼是新開一張表, 不是塞進既有的
--   ⛔ ~~重用 `pcm_settle_retry_attempts`(20260905220000)~~ —— codex 2026-09-05 否決, 我接受:
--      那張表【一列 = 付款狀態重算的重試生命週期】(attempts / gave_up_at / last_error)。
--      塞退款開列失敗進去 ⇒ 不是永遠不告警(它不在 retry sweep 的候選裡, 撈不到),
--      就是要**偽造 `gave_up_at`** 才看得見;而 `get_settle_retry_gaveup_health()`
--      會把退款故障報成「settle retry 放棄」⇒ `tracked_total` 與抽樣單號一起失真。
--   ⛔ ~~寫進 `sweeper_heartbeat`~~ —— **同一個病換一張表**:它一列 = 一支排程的健康, 不是一個事件。
--      (plan §3 乙 自己標了「其實不成立」, 留著是為了讓下一個人不用再想一次。)
--   ⇒ 📌 **我當時把「有一張看得見的表」讀成「那張表裝得下這個語意」。**
--   ✅ `kind` 是**封閉集**(CHECK)—— 這張表會吸引下一個人把所有東西丟進來,
--      而封閉集是唯一擋得住的東西:新的一種失敗**要明文加一格**。
--
-- ■ 段三 · 貼進正式庫會發生什麼 · 以及它證不到什麼
--   貼之前(2026-09-05 唯讀實測):`pcm_incident` 這張表 **不存在**(負對照 f);
--   `pcm_noncard_settle_recompute` 的 `prosrc` md5 = `8353cf70f0121ea3d361ee2d5031dba5`
--   (9368 字元)—— 與 repo `20260905070000` 那一代**逐字相同** ⇒ 我改的就是正在跑的那一版。
--   ⇒ 本片有**前置閘⓪** 當場再驗一次那個 md5, 不符就拒絕(不是憑我剛才量過)。
--
--   🛑🛑 **它證不到 / 修不到什麼(不要讀成「這件事解決了」)**
--   ① 🔴 **它沒有接上告警端** —— 表寫進去了而**沒有人會來讀**。
--      `check-anomaly-alerts` 那一側是 TypeScript, 不在本片射程。
--      ⇒ 📌 **在那一半做完之前, 這張表與 `RAISE LOG` 的差別只是「查得到」, 不是「會叫」。**
--   ② 🔴 **incident 那一列與被吞的例外在【同一個交易】裡** ——
--      外層交易若整個回滾(既有的 ⟦b4-NCPCANCELROLLBACK⟧:statement_timeout 穿透),
--      **那一列會跟著消失**。⇒ 本片對那條路**零覆蓋**。
--   ③ 🔴 **「這件事發生過幾次」我量不到** —— `RAISE LOG` 只在 Postgres log 裡, 唯讀角色讀不到。
--      ⇒ 所以本片是**預防**, 而預防片的驗收**不能**是「補到幾筆」。
--      ⇒ 📌 **「沒有訊號」與「沒有發生」在今天是同一個畫面**, 貼完之後才開始有分別。
--   ④ 它**不修**那個競態本身(`⟦b4-NCPCRONRACE⟧` 剩三要 Sean 拍終態)。
--
--   ✅ 而 ② 那一半(取消後入款 ⇒ 自動開待退款)**已經在正式庫跑著** ——
--      2026-09-05 唯讀複驗 `pcm_noncard_settle_recompute` 有呼叫 `pcm_pending_refund_open_for` = **t**。
--      ⇒ Sean 拍的那個行為**被確認了**, 而它失敗時零訊號 ⇒ 那一半就是本片。
--
-- ↩️ Rollback:`supabase/rollbacks/20260905290000-rollback.sql`
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL idle_in_transaction_session_timeout = '60s';

-- ── 前置閘⓪:我要改的那支, 現在真的是我讀的那一版嗎 ──────────────────────
DO $gate$
DECLARE
  v_oid   oid;
  v_md5   text;
  v_owner text;
  v_acl   text;
  v_n     int;
BEGIN
  -- 🔴 codex must-fix M1:原版用 `proname` 找 ⇒ 有同名 overload 時可能驗到別支,
  --    然後把【已被改過的 (uuid) 版】蓋掉。改用完整簽章鎖定。
  --    (2026-09-05 唯讀實測:同名支數 = 1 ⇒ 今天沒有 overload。而「今天沒有」不是守門。)
  v_oid := to_regprocedure('public.pcm_noncard_settle_recompute(uuid)');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION '前置閘⓪:public.pcm_noncard_settle_recompute(uuid) 不存在 ⇒ 先貼 20260904230000 與 20260905070000';
  END IF;

  SELECT count(*) INTO v_n FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'pcm_noncard_settle_recompute';
  IF v_n <> 1 THEN
    RAISE EXCEPTION '前置閘⓪a:同名函式有 % 支(我抽取時是 1)⇒ 出現了 overload, 停下人工確認要蓋哪一支', v_n;
  END IF;

  SELECT pg_catalog.md5(p.prosrc),
         pg_catalog.pg_get_userbyid(p.proowner),
         COALESCE(pg_catalog.array_to_string(p.proacl, ' | '), '(NULL)')
    INTO v_md5, v_owner, v_acl
    FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;

  -- 🔴 這一格是本片最重要的一道:`CREATE OR REPLACE` 會【整支蓋掉】。
  IF v_md5 <> '8353cf70f0121ea3d361ee2d5031dba5' THEN
    RAISE EXCEPTION '前置閘⓪:庫上那支的 prosrc md5 是 %, 而我抽取時是 8353cf70f0121ea3d361ee2d5031dba5 ⇒ 中間有人改過, 拒絕整支覆蓋', v_md5;
  END IF;

  -- 🔴 codex must-fix M2:`CREATE OR REPLACE` **保留既有 owner**。
  --    owner 若不是 postgres, 它就拿不到本片新建函式的 EXECUTE
  --    ⇒ handler 裡那一行留痕會丟例外 ⇒ 被內層 handler 吞掉 ⇒ 📌 **事故仍然完全沉默**,
  --      而本片會印綠。⇒ 這一格必須在覆蓋【之前】擋住。
  --    (2026-09-05 唯讀實測:owner = postgres。)
  IF v_owner <> 'postgres' THEN
    RAISE EXCEPTION '前置閘⓪b:那支函式的 owner 是 %(我抽取時是 postgres)⇒ CREATE OR REPLACE 會保留它, 而它可能呼叫不動本片新建的 pcm_incident_log ⇒ 拒絕', v_owner;
  END IF;

  -- 🔴 codex must-fix M5:md5 只看本體, **看不到 ACL**。
  --    有人在我量測之後把 EXECUTE 授給外部角色 ⇒ md5 一樣, 而 replacement 保留 ACL
  --    ⇒ 那個角色繼續叫得動這支 SECURITY DEFINER 的付款重算。
  --    (2026-09-05 唯讀實測:proacl = `postgres=X/postgres`, 沒有外部授權。)
  IF v_acl NOT IN ('(NULL)', 'postgres=X/postgres') THEN
    RAISE EXCEPTION '前置閘⓪c:那支函式的 ACL 是 %(我抽取時是 postgres=X/postgres)⇒ 有人授權給別的角色, 而覆蓋會原樣保留它 ⇒ 停下人工確認', v_acl;
  END IF;
END $gate$;

-- ── ① 事故表 ────────────────────────────────────────────────────────────
-- 🔴 裸 `CREATE`(不是 `IF NOT EXISTS`)—— pre-commit 規則①:撞名要【當場紅】。
--    跳過之後, 下面的 REVOKE 與斷言會對著那個既有物件跑而且很可能通過
--    ⇒ 📌 拿到綠燈, 而這支 migration 什麼都沒建。
CREATE TABLE public.pcm_incident (
  id          bigserial PRIMARY KEY,
  -- 🔴 封閉集:新的一種失敗要**明文加一格**。這是唯一擋得住「什麼都往這裡丟」的東西。
  kind        text        NOT NULL CHECK (kind IN ('pending_refund_open_failed')),
  subject_id  uuid,
  detail      text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

COMMENT ON TABLE public.pcm_incident IS
  '小事故表:被刻意吞掉的失敗留痕。kind 是封閉集(CHECK), 新增一種要改 CHECK。'
  ' 🔴 它不是稽核表, 也不是佇列 —— 沒有人重試它, 只有人【看】它。'
  ' ⚠️ 與被吞的例外在同一個交易裡 ⇒ 外層整個回滾時這一列會跟著消失(⟦b4-NCPCANCELROLLBACK⟧)。';

-- 未解決的事故要撈得快;已解決的不進索引(部分索引)。
CREATE INDEX pcm_incident_open_idx
  ON public.pcm_incident (kind, created_at DESC)
  WHERE resolved_at IS NULL;

-- 🔴 四道 REVOKE(房規:新物件出生就自帶 anon 權限, repo 內零 GRANT 字面可掃)
REVOKE ALL ON TABLE public.pcm_incident FROM PUBLIC;
REVOKE ALL ON TABLE public.pcm_incident FROM anon;
REVOKE ALL ON TABLE public.pcm_incident FROM authenticated;
REVOKE ALL ON TABLE public.pcm_incident FROM service_role, payment_confirmer;
REVOKE ALL ON SEQUENCE public.pcm_incident_id_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.pcm_incident_id_seq FROM anon;
REVOKE ALL ON SEQUENCE public.pcm_incident_id_seq FROM authenticated;
REVOKE ALL ON SEQUENCE public.pcm_incident_id_seq FROM service_role, payment_confirmer;

-- static-checks:no-grant-needed public.pcm_incident -- 本表刻意對每一個角色都隱形。
--   讀只走 `get_pcm_incident_health()`(definer, 已 GRANT EXECUTE 給 service_role);
--   寫只走 `pcm_incident_log()`(definer, 一個 GRANT 都不給)。
--   ⇒ 📌 明寫一行 GRANT 給任何角色 = 開一條本設計不要的直讀路, 而 `detail` 是 SQLERRM。
--   ⚠️ 這道規則的原話留著:E683-1 之後新表不再自動帶授權 ⇒ 沒明寫 GRANT 的症狀是
--      【上線後某個頁面讀不到東西】。本表沒有任何頁面讀它 ⇒ 那個症狀在這裡不成立。
-- 🛑 RLS 開而**不建任何 policy** ⇒ 沒有一般角色讀得到;只有 definer 函式進得去。
-- RLS-GATE-EXEMPT: public.pcm_incident -- 沒有任何角色【直接】讀它。唯一的讀路是 `get_pcm_incident_health()`(SECURITY DEFINER, OWNER=postgres), 而 definer 以 owner 身分執行 · 表的 owner 預設不受自己表的 RLS 管 ⇒ 補一條 service_role 的 SELECT 政策等於開一條本設計不要的直讀路。寫入同理:只走 `pcm_incident_log()`(definer)。(20260905290000, 2026-09-05 -db 判, 理由見下)
--   🔴 **而這個豁免有一個【會讓它失效】的動作, 寫出來讓下一個人撞得到**:
--      誰若對本表下 `ALTER TABLE … FORCE ROW LEVEL SECURITY`, **owner 也會被 RLS 管**
--      ⇒ 兩支 definer 函式當場讀不到 / 寫不進去, 而 📌 **讀不到會回 0 列、寫不進去被內層 handler 吞掉**
--      ⇒ 🛑 **兩邊都是安靜的** —— 那正是本片存在的理由被反過來實現一次。
--      ⇒ 要 FORCE ⇒ 同一發必須補 policy, 不可以只加那一行。
--   ⚠️ 本閘的原話也留著:今天 service_role 讀得到是因為它帶 `BYPASSRLS`(平台角色屬性, 不是政策)
--      —— 而本表**不靠那條路**, 所以拿掉 BYPASSRLS 的那一天本表不受影響。
ALTER TABLE public.pcm_incident ENABLE ROW LEVEL SECURITY;

-- ── ② 寫入口(唯一)────────────────────────────────────────────────────
-- 🔴 新物件 ⇒ 裸 `CREATE`(規則①):`OR REPLACE` 會把撞名靜靜蓋掉, 而斷言照樣綠。
CREATE FUNCTION public.pcm_incident_log(
  p_kind       text,
  p_subject_id uuid,
  p_detail     text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $inc$
BEGIN
  -- 🔴 `detail` 截斷:SQLERRM 可能很長, 而這張表是給人看的不是存 log 的。
  --    ⚠️ 截斷會**丟掉尾巴**, 而錯誤訊息的關鍵字常在尾巴 ⇒ 2000 是妥協不是安全值。
  INSERT INTO public.pcm_incident (kind, subject_id, detail)
  VALUES (p_kind, p_subject_id, pg_catalog.left(COALESCE(p_detail, '(無)'), 2000));
END;
$inc$;

ALTER FUNCTION public.pcm_incident_log(text, uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.pcm_incident_log(text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pcm_incident_log(text, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.pcm_incident_log(text, uuid, text) FROM authenticated;
REVOKE ALL ON FUNCTION public.pcm_incident_log(text, uuid, text) FROM service_role, payment_confirmer;
-- 🛑 **一個 GRANT EXECUTE 都不給** —— 它只被同為 definer 的 `pcm_noncard_settle_recompute` 呼叫,
--    而 definer 以 owner(postgres)身分執行 ⇒ 不需要任何外部角色拿得到它。

-- ── ③ 讀出口(給告警端;本片只建, 接線是另一片)────────────────────────
-- 🔴 新物件 ⇒ 裸 `CREATE`(規則①)。
CREATE FUNCTION public.get_pcm_incident_health()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $h$
  SELECT jsonb_build_object(
    'open_total',   (SELECT count(*) FROM public.pcm_incident WHERE resolved_at IS NULL),
    'open_by_kind', (SELECT COALESCE(jsonb_object_agg(kind, c), '{}'::jsonb)
                       FROM (SELECT kind, count(*) AS c FROM public.pcm_incident
                              WHERE resolved_at IS NULL GROUP BY kind) s),
    'oldest_open_at', (SELECT min(created_at) FROM public.pcm_incident WHERE resolved_at IS NULL)
  );
$h$;
-- 🔵 **零 PII**:只回 count 與時間, 不回 `detail` 也不回 `subject_id`
--    —— 告警信會把回傳值印出去, 而 `detail` 是 SQLERRM(可能含單號與內部訊息)。
ALTER FUNCTION public.get_pcm_incident_health() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_pcm_incident_health() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_pcm_incident_health() FROM anon;
REVOKE ALL ON FUNCTION public.get_pcm_incident_health() FROM authenticated;
REVOKE ALL ON FUNCTION public.get_pcm_incident_health() FROM service_role, payment_confirmer;
GRANT EXECUTE ON FUNCTION public.get_pcm_incident_health() TO service_role;

-- ── ④ 把留痕接進那個被吞的 handler ──────────────────────────────────────
-- 🔴🔴 **下面這份本體【不是手抄的】** —— 它是用程式從
--    `20260905070000_m4b_pending_refund_on_late_payment.sql` 那一代複製出來,
--    只對一個唯一命中的區塊做字串取代, 而且做過**零漂移自證**:
--      把新本體裡那一段換回舊那一段 ⇒ **逐位元組等於**原本體(9368 字元 / md5 8353cf70…)。
--    ⇒ 📌 那正是「抄回來時靜默漂移」這個病的解法:不要用眼睛比, 要讓機器換回去。
-- 🛑 **而這代表下面那份本體裡的【每一個字】都是 20260905070000 那一代的, 包含它的註解與數字。**
--    codex 2026-09-05 指出其中一句註解的計數(`paid_at = pg_catalog.now()` 說「6 處」)與現況不符。
--    ⇒ 🔴 **我刻意不改它** —— 改了就會讓上面那個「逐位元組相同」的自證失效,
--      而那個自證是本片唯一能證明「我沒有靜默漂移」的東西。
--    ⇒ 📌 那句話要修, 是 `20260905070000` 那條線的事;在這裡修等於**在複本上改原件**。
CREATE OR REPLACE FUNCTION public.pcm_noncard_settle_recompute(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  v_status   public.payment_status;
  v_res      jsonb;
  v_verdict  text;
  v_received bigint;
  v_new      public.payment_status;
  v_hit      integer;
BEGIN
  -- 🔴🔴 例外區塊【整段包住】, 不是只包 OP6a 那一發(v4 §4 對 v2 的更正)。
  --    Sean 拍的那一條:計算器跑不動**不得**讓收款那一列跟著回滾。
  --    而 v2 只包了 OP6a ⇒ 兩個 SUM、UPDATE、以及 UPDATE 觸發的下游 trigger
  --    全在保護之外 ⇒ 它們任何一個拋錯, 客人那筆收款就消失了。
  --    plpgsql 的 BEGIN…EXCEPTION 自帶 savepoint ⇒ 這裡吞掉的只有重算, 不含外面那筆 INSERT。
  -- ⚠️ 誠實邊界:`EXCEPTION WHEN OTHERS` 依 PostgreSQL 定義**不接** query cancel
  --    (SQLSTATE 57014)⇒ statement_timeout 或人工 cancel 仍會冒出去、連帶回滾那筆收款。
  --    本片**沒有修掉這條路**, 它是已知殘留風險(與 20260903080000 心跳那段同一種)。
  BEGIN
    -- 🔴🔴 **每張單一把 advisory lock**(codex R1 must-fix, :203)。
    --    沒有它:兩筆【各自不足、合計付清】的收款同時進來 ⇒ READ COMMITTED 下
    --    兩邊的 SUM 都看不到對方【尚未提交】的那一筆 ⇒ 兩邊都算出 underpaid
    --    ⇒ 兩邊都寫 partiallyPaid ⇒ 🛑 **訂單永久停在「部分付款」, 而錢已經收齊了。**
    --    ⚠️ 而樂觀鎖擋不住這個 —— 它擋的是「別人改過我就不覆蓋」, 而這裡**兩邊算的都是舊世界**。
    -- ✅ 用 advisory 而不是 `SELECT … FOR UPDATE`:後者是鎖升級(那筆 INSERT 的 FK
    --    已對同一列持有 KEY SHARE)⇒ 會死結。advisory 不碰 orders 那一列的鎖。
    -- 🔵 xact 版 ⇒ 交易結束自動釋放, 不需要(也不可能忘記)解鎖。
    PERFORM pg_catalog.pg_advisory_xact_lock(
              pg_catalog.hashtextextended(p_order_id::text, 0));

    -- 🔴🔴 **⟦b4-NCPCRONRACE⟧(20260905070000 新增的唯一一段)**:
    --    錢比取消【晚】到時, `orders` 的 AFTER UPDATE 那道網已經跑完了(當時 order_payments 零列)
    --    ⇒ **一列待退款都不會開**。這一行是那個世界唯一的補救。
    -- 🔵 **沒取消 ⇒ 它自己 RETURN**(判斷在 `pcm_pending_refund_open_for` 裡, 只有一份)
    --    ⇒ 正常路徑的成本 = 一次 by-id 的 SELECT。
    -- 🛑 **位置刻意在【所有 RETURN 之前】** —— 下面每一條 early-return(狀態值域 / 有人工退款 /
    --    verdict 不翻)在【已取消】那個世界裡都會被走到, 而錢已經在庫裡了。
    --    ⇒ 📌 放在任何一條 RETURN 後面, 就會有一條路漏掉它。
    -- ⚠️ **而它在這個 BEGIN…EXCEPTION 區塊【之內】** —— 它丟例外時吞在這裡,
    --    **不得回滾客人那筆收款**(那正是 20260904230000 檔頭那段誠實邊界在講的事)。
    -- 🔴 `false` = **不覆寫既有列的金額**(見該函式上方那段合約:那一欄是快照, 不會自己更新)。
    -- 🔴🔴 **自己包一層 nested BEGIN…EXCEPTION**(adversarial-reviewer R3 must-fix ⑤)——
    --   ⛔ ~~我第一版讓這一行與【狀態重算】共用外面那個 `EXCEPTION WHEN OTHERS`~~
    --   ⇒ 🛑 **open_for 丟例外 ⇒ 整段被吞 ⇒ 錢入帳而 payment_status 不翻、付款信永遠不寄。**
    --     📌 **我為了補一個洞而加的一行, 會讓主線靜靜地不執行。**
    --   ✅ 現在:它自己吞自己的例外, **不影響下面的狀態重算**。
    --   🔵 而 plpgsql 的 BEGIN…EXCEPTION 自帶 savepoint ⇒ 這裡吞掉的只有這一行, 不含外面那筆 INSERT。
    BEGIN
      PERFORM public.pcm_pending_refund_open_for(p_order_id, false);
    -- 🛑 **`WHEN OTHERS` 吞的是什麼, 寫清楚**(R4 nit ①):它涵蓋一般錯誤
    --    (`deadlock_detected` / `lock_timeout` / 約束違反 / 權限),
    --    **而依 PostgreSQL 定義【不接】`query_canceled`(57014)與 `assert_failure`**
    --    ⇒ statement_timeout 或人工 cancel 仍會穿透這裡、連帶回滾外面那筆收款
    --      (那是既有的 ⟦b4-NCPCANCELROLLBACK⟧, 本片沒有修掉它)。
    EXCEPTION WHEN OTHERS THEN
      RAISE LOG '[pcm_noncard_settle] order=% 補開待退款失敗(%), 狀態重算照常進行',
                p_order_id, SQLERRM;
      -- 🔴🔴 **20260905290000 加的唯一一段** —— 讓上面那個吞掉【留下一個看得見的痕跡】。
      --   🛑 吞掉本身不動:不吞就會回滾客人那筆收款(理由在本區塊上方 :356-364)。
      --   🔴 **自己包一層 BEGIN…EXCEPTION** —— 我為了補一個洞而加的一行,
      --      若它自己丟例外, 會傳到【外面那個 handler】⇒ 主線的狀態重算靜靜地不執行。
      --      (那正是 adversarial-reviewer 對前一片打出來的 must-fix ⑤, 同一個形狀。)
      --   🔴 `v_err := SQLERRM` 要**先抓** —— 進到內層 handler 之後 `SQLERRM` 會變成
      --      【留痕自己的錯】, 原始錯誤就沒了。
      DECLARE
        v_err text := SQLERRM;
      BEGIN
        PERFORM public.pcm_incident_log('pending_refund_open_failed', p_order_id, v_err);
      EXCEPTION WHEN OTHERS THEN
        RAISE LOG '[pcm_incident] 連留痕都失敗 order=% 原錯=% 留痕錯=%',
                  p_order_id, v_err, SQLERRM;
      END;
    END;

    SELECT o.payment_status INTO v_status
      FROM public.orders o
     WHERE o.id = p_order_id;

    -- 🔵 單不見了(理論上不會 —— order_payments.order_id 是 FK)⇒ 不讓收款回滾。
    IF v_status IS NULL THEN
      RETURN;
    END IF;

    -- 🔴 可判定集:只有這三個值本片才動。
    --    (這三個值與 OP6a 的前提 P1 逐字相同 ⇒ 兩邊本來就對齊, 不是我另外挑的。)
    IF v_status NOT IN ('unpaid'::public.payment_status,
                        'paid'::public.payment_status,
                        'partiallyPaid'::public.payment_status) THEN
      RETURN;
    END IF;

    -- 🔴🔴 v4 的形狀:**有任何退款活動 ⇒ 交還退款管線, 本片一個字都不寫。**
    --    ⛔ ~~v2 在這裡自己算 refunded / partiallyRefunded~~ —— 那會是**第二個寫入端**。
    --    退款那半自 2026-08-23 起有人管:`admin_record_manual_refund` 會呼叫
    --    `pcm_sync_order_refund_payment_status`
    --    (`20260823020000_m4b_refund_notify_p2a_record_calls_sync.sql`, 檔名逐字
    --     `record_calls_sync`;該檔 :17 逐字「只加這一行, 其餘一字未改」)。
    -- 🔴🔴 **[2026-09-04 訂正]** 上面那句「退款那半自 2026-08-23 起有人管」**疑似不成立** ——
    --    完整因果與複量見檔頭那段訂正。
    --    ⛔ ~~「該支同步器只讀 `order_refunds`, 不讀 `order_manual_refunds`」~~
    --      ⚠️ **只在 `20260905010000` 【貼進正式庫之後】才不成立**(⟦b4-MANREFUNDNOOWNER2⟧)——
    --      🔴 **本句刻意不寫成「已經不成立」**(codex R2 must-fix):較早的 migration 不能替
    --        較晚那一支背書 —— **後片若失敗, 正式庫就留下一句假註解, 而沒有東西會叫。**
    --      ✅ 判法(不要問帳本):`SELECT position('order_manual_refunds' in prosrc) > 0
    --        FROM pg_proc WHERE proname = 'pcm_sync_order_refund_payment_status'`
    --    🔵 ⇒ **本片檔頭最早那句「退款那半有人管」現在【又成立了】** —— 而它繞了一圈:
    --      09-04 我寫它為真 ⇒ 同夜證實為假 ⇒ 09-05 把它做成真的。
    --      📌 三句都留著不刪, 因為**中間那句假的時候, 有人可能已經照它做過決定**。
    --    🛑 **本片的動作不變**(一律 RETURN, 那是安全的);**變假的是理由。**
    --    ⇒ 板列 `⟦b4-MANREFUNDNOOWNER2⟧`。舊字面留著不刪。
    -- 🎯 codex 演出的後果:total=1000, 先人工退 400(v2 寫 partiallyRefunded), 之後卡片再退 600
    --    ⇒ 兩本退款帳合計已達 1000, 而卡片 helper 只看自己的 600
    --    ⇒ **狀態永久停在 partiallyRefunded, 不會成為 refunded。而它不報錯。**
    -- 🔵 voided_at 非空 = 那筆退款被作廢 ⇒ 錢沒有真的離開 ⇒ 不算退款活動。
    -- 🔴🔴 **[2026-09-05 改成 EXISTS, 不再加總金額]**
    --    ⛔ ~~原本 `SELECT coalesce(sum(m.refund_amount), 0) INTO v_manual`~~ **作廢**。
    --    🔬 成因:`packages/domain/src/order/refund-remaining-single-source.test.ts`
    --      (⟦#473b-1⟧「已退/還能退」單一來源守門)判本檔紅 —— 逐字
    --      「如果它自己算『已退 / 還能退』, 那就是要防的繞路」。
    --    ✅ **而它抓對了一半:我確實在 SUM 退款金額** —— 🔵 **而那個和從來沒有被當成金額用**:
    --      剝註解後全檔 `v_manual` 只出現在 ①宣告 ②這一句 ③`> 0` ④一行 log。
    --    🎯 **⇒ 我要的一直是「有沒有」, 而我寫成了「多少」** ——
    --      ⇒ 📌 **多算出來的那個數字沒有用途, 而它讓一道正確的守門對我叫。**
    --      ⇒ ⇒ 🔴 **正確的修法不是去 allowlist 開一個例外, 是【不要算那個和】。**
    --        (開例外要寫 why 且要有人審 ⇒ 那是把一個我造出來的問題轉成別人的閱讀成本。)
    --    🔵 語意零改變:`sum(...) > 0` 與 `EXISTS` 在 `refund_amount > 0` 這個 CHECK 下等價
    --      —— 🔬 `20260820010000` 建表逐字 `refund_amount integer NOT NULL CHECK (refund_amount > 0)`
    --      ⇒ 不可能有 0 或負數列讓兩者分岔。
    IF EXISTS (
      SELECT 1 FROM public.order_manual_refunds m
       WHERE m.order_id = p_order_id
         AND m.voided_at IS NULL
    ) THEN
      RAISE LOG '[pcm_noncard_settle] order=% 有未作廢的人工退款 ⇒ 交還退款管線, 本片不寫',
                p_order_id;
      RETURN;
    END IF;

    v_res     := public.admin_compute_order_settlement(p_order_id);
    v_verdict := v_res ->> 'verdict';

    SELECT coalesce(pg_catalog.sum(p.amount), 0) INTO v_received
      FROM public.order_payments p
     WHERE p.order_id = p_order_id;

    -- 🔬 verdict 四個值域逐字取自 20260901030000_m4b_zero_total_settle.sql
    --    (該檔 OP6a 段 grep ⇒ settled 1 / underpaid 1 / overpaid 1 / needs_human 2;
    --     負對照一個不存在的 verdict ⇒ 0)。
    IF v_verdict = 'settled' THEN
      v_new := 'paid'::public.payment_status;

    ELSIF v_verdict = 'underpaid' THEN
      -- 收了一部分 ⇒ partiallyPaid;一毛都沒收(或被沖銷光)⇒ 回到 unpaid
      IF v_received > 0 THEN
        v_new := 'partiallyPaid'::public.payment_status;
      ELSE
        v_new := 'unpaid'::public.payment_status;
      END IF;

    ELSE
      -- 🔴 `overpaid` 與 `needs_human` 一律【不翻】。
      --    overpaid:payment_status 的值域裡**沒有**對應的值(unpaid / paid / partiallyPaid /
      --      refunded / partiallyRefunded 共 5 個)⇒ 開一列給人看, 不猜一個最接近的。
      --    needs_human:它自己宣告算不清 ⇒ 不該由它決定終態。
      -- 🛑 而「不翻是安全的」這句話**依賴 `20260904230000` 第 4 節那條 cron 腿**(R3 nit ②:
      --    這段是從那支檔【逐字搬過來】的, 而「本檔」兩個字跟著搬 ⇒ 在這裡指到了錯的檔。
      --    📌 **自指座標會在搬家的那一刻靜靜地指錯, 而它讀起來完全正常。**)—— 沒有它, 這兩種單
      --    仍然是 unpaid ⇒ 隔天照樣被取消 ⇒ 缺陷的形狀與今天一模一樣, 只是變窄。
      --    ⇒ 📌 **兩段必須同一支 migration**, 不可以拆開先上一半。
      RAISE LOG '[pcm_noncard_settle] order=% verdict=% ⇒ 不翻狀態(值域無對應值或算不清)',
                p_order_id, v_verdict;
      RETURN;
    END IF;

    -- 🔴🔴 條件式 UPDATE 取代 `SELECT … FOR UPDATE`(v4 §4 對 v2 的更正)。
    --    v2 一開頭就 `FOR UPDATE` 那一列, 而本函式是**在 order_payments 的 INSERT 之後**跑的
    --    ⇒ 那筆 INSERT 的 FK 已經在同一列上拿了 KEY SHARE ⇒ FOR UPDATE 是**鎖升級**
    --    ⇒ 兩筆收款同時進來時互等 ⇒ 死結。
    -- ✅ 改法:把「我讀到的狀態」寫進 WHERE ⇒ 別人先改過就 0 列, 我不覆蓋他。
    --    這是樂觀鎖, 不是少了一道保護 —— 而它會少寫的那一次, 正是該少寫的那一次。
    IF v_new IS DISTINCT FROM v_status THEN
      UPDATE public.orders o
         SET payment_status = v_new,
             -- 🔴🔴 **翻成 paid 必須同時填 `paid_at`**(codex R1 must-fix, :204)。
             --    🔬 全 repo 6 處 `paid_at = pg_catalog.now()` —— **全在卡片那條路**
             --      (最早 `20260611120000_m3_s2c_confirm_payment_rpc.sql:180`)。
             --    🔬 而 `20260831030000_m4b_e4_order_created_gap_counts.sql:134` 逐字:
             --      「述詞與 SupabasePaidOrderScannerAdapter 對齊:paid + cancelled_at IS NULL
             --       + **paid_at/created_at 皆 >= cutoff**」
             --    ⇒ 🎯 **只翻 payment_status 不填 paid_at ⇒ 匯款單結清成功, 而付款信永遠不寄**
             --       —— 它在掃描器眼裡不存在。而**沒有任何東西會叫**。
             --    🔵 `coalesce` 而非直接覆寫:同一張單若已經有付款時刻, 不得被後到的重算改掉
             --      (雙扣偵測 `20260701130000:98` 用 `paid_at IS NOT NULL` 配對, 時刻被動會誤判)。
             --    🔵 非 paid 的分支一個字都不碰它 —— 本片不負責把 paid_at 清掉。
             paid_at        = CASE WHEN v_new = 'paid'::public.payment_status
                                   THEN coalesce(o.paid_at, pg_catalog.now())
                                   ELSE o.paid_at END,
             updated_at     = pg_catalog.now()
       WHERE o.id             = p_order_id
         AND o.payment_status = v_status;   -- 🔴 樂觀鎖:狀態被別人改過就不寫
      GET DIAGNOSTICS v_hit = ROW_COUNT;

      IF v_hit = 0 THEN
        RAISE LOG '[pcm_noncard_settle] order=% 狀態在重算期間被別人改掉 ⇒ 本次不寫(讀到 %)',
                  p_order_id, v_status;
      ELSE
        RAISE LOG '[pcm_noncard_settle] order=% % -> % (verdict=% received=%)',
                  p_order_id, v_status, v_new, v_verdict, v_received;
      END IF;
    END IF;

  EXCEPTION WHEN OTHERS THEN
    RAISE LOG '[pcm_noncard_settle] order=% 重算失敗(%), 收款事實保留、狀態不動',
              p_order_id, SQLERRM;
  END;
END
$fn$;

-- ── ⑤ 事後閘 ────────────────────────────────────────────────────────────
DO $after$
DECLARE
  v_ok  boolean;
  v_src text;
  v_acl text;
  v_i   int;
  -- 🔴 收權斷言清單(pre-commit 規則③ 數的就是這兩個陣列裡的元素個數)
  v_relations text[] := ARRAY[
    'public.pcm_incident',
    'public.pcm_incident_id_seq'
  ]::text[];
  v_functions text[] := ARRAY[
    'public.pcm_incident_log(text, uuid, text)',
    'public.get_pcm_incident_health()'
  ]::text[];
BEGIN
  IF to_regclass('public.pcm_incident') IS NULL THEN
    RAISE EXCEPTION '事後閘①:public.pcm_incident 沒建出來';
  END IF;

  -- 封閉集真的擋得住嗎(兩個世界:不合法的要被擋, 合法的要進得去)
  BEGIN
    INSERT INTO public.pcm_incident (kind, subject_id, detail)
    VALUES ('__不在封閉集裡的種類__', NULL, 'after-check 負對照');
    RAISE EXCEPTION '事後閘②(負對照):CHECK 沒擋住不在封閉集裡的 kind ⇒ 這張表擋不住「什麼都往裡面丟」';
  EXCEPTION WHEN check_violation THEN
    NULL;  -- ✅ 這才是對的
  END;

  INSERT INTO public.pcm_incident (kind, subject_id, detail)
  VALUES ('pending_refund_open_failed', NULL, 'after-check 正對照, 本列會在同一個 DO 裡刪掉');
  DELETE FROM public.pcm_incident WHERE detail = 'after-check 正對照, 本列會在同一個 DO 裡刪掉';
  -- ⚠️ **這不是零副作用**(codex nit):上面兩次 INSERT 各取走一個 `bigserial`
  --    ⇒ `pcm_incident_id_seq` **至少前進兩格**, 而 `nextval()` 不隨交易回滾。
  --    ⇒ 📌 貼完之後第一列事故的 id 不會是 1。**寫出來, 因為下一個人會拿 id 當計數。**

  IF to_regprocedure('public.pcm_incident_log(text, uuid, text)') IS NULL THEN
    RAISE EXCEPTION '事後閘③:pcm_incident_log 沒建出來 ⇒ handler 那一行會在執行期才炸';
  END IF;
  IF to_regprocedure('public.get_pcm_incident_health()') IS NULL THEN
    RAISE EXCEPTION '事後閘④:get_pcm_incident_health 沒建出來';
  END IF;

  -- ══ 🔴 codex must-fix M6:原版用 `strpos(prosrc, …)` ⇒ **註解裡的字也算命中** ══
  --    ⇒ 把那一行 `PERFORM` 刪掉、只留註解裡的函式名, ⑤⑥ 照樣過。
  --    📌 這正是我今天在別的片上記過的同一個病(「註解被 grep 當成碼」)——
  --       而我在自己的守門裡又犯了一次。⇒ 先剝註解再找。
  SELECT pg_catalog.regexp_replace(
           pg_catalog.regexp_replace(p.prosrc, '/\*.*?\*/', '', 'gs'),
           '--[^' || chr(10) || ']*', '', 'g')
    INTO v_src
    FROM pg_catalog.pg_proc p WHERE p.oid = to_regprocedure('public.pcm_noncard_settle_recompute(uuid)');

  IF pg_catalog.strpos(v_src, 'public.pcm_incident_log(') = 0 THEN
    RAISE EXCEPTION '事後閘⑤:剝掉註解之後, pcm_noncard_settle_recompute 裡沒有 pcm_incident_log 的呼叫 ⇒ 表建了而沒人寫它';
  END IF;
  IF pg_catalog.strpos(v_src, 'public.pcm_pending_refund_open_for(') = 0 THEN
    RAISE EXCEPTION '事後閘⑥(負對照):剝掉註解之後主線那一行不見了 ⇒ 我蓋掉了不該蓋的東西';
  END IF;

  -- 覆蓋之後 owner 與 ACL 不可以變(前置閘⓪b/⓪c 的另一半)
  SELECT pg_catalog.pg_get_userbyid(p.proowner) || ' :: ' ||
         COALESCE(pg_catalog.array_to_string(p.proacl, ' | '), '(NULL)')
    INTO v_acl FROM pg_catalog.pg_proc p
   WHERE p.oid = to_regprocedure('public.pcm_noncard_settle_recompute(uuid)');
  IF v_acl NOT IN ('postgres :: (NULL)', 'postgres :: postgres=X/postgres') THEN
    RAISE EXCEPTION '事後閘⑦:覆蓋之後 owner/ACL 變成 % ⇒ 停下人工確認', v_acl;
  END IF;

  -- ══ 🔴 codex must-fix M3/M4:四道 REVOKE **不是封閉白名單** ══
  --    2026-09-05 唯讀實測 `pg_default_acl`:`supabase_admin` 在 public 設的預設是
  --      表 ⇒ anon/authenticated/service_role 各 `arwdDxtm`
  --      函式 ⇒ 上述三個角色各 `X`
  --      序列 ⇒ 上述三個角色各 `rwU`
  --    ⇒ 📌 **新物件出生就自帶權限, 而預設權限的受益者【是一份會變的名單】。**
  --      列舉式 REVOKE 只收掉我想得到的那幾個 ⇒ 下一個被加進預設的角色我看不見。
  --    ✅ 所以這裡不列舉「誰不該有」, 改成斷言【誰有】—— 那是封閉的。
  --
  -- 🔵 清單寫成陣列, 是 pre-commit 規則③ 認的形狀:
  --    「收權斷言【只檢查你列出來的物件】:它防『忘記收權』, 不防『忘記列』」
  --    ⇒ 物件數與清單長度要對得上, 少列一個就等於那個物件沒被檢查。
  FOR v_i IN 1 .. array_length(v_relations, 1) LOOP
    SELECT COALESCE(string_agg(DISTINCT g, ','), '(空)') INTO v_acl FROM (
      SELECT COALESCE(pg_catalog.pg_get_userbyid(a.grantee)::text, 'PUBLIC') AS g
        FROM pg_catalog.pg_class c,
             LATERAL pg_catalog.aclexplode(
               COALESCE(c.relacl,
                        -- 🔴 `acldefault` 的第一個參數型別是 `"char"` 不是 `text`
                        --    ⇒ `CASE … END` 產出的是 text ⇒ `function pg_catalog.acldefault(text, oid) does not exist`。
                        --    📌 而**靜態檢查五道全綠、只有實跑會紅** —— 那正是那支腳本自己寫的
                        --      「靜態檢查不驗行為」。這一行是那句話的實例。
                        pg_catalog.acldefault(
                          (CASE WHEN c.relkind = 'S' THEN 'S' ELSE 'r' END)::"char",
                          c.relowner))) a
       WHERE c.oid = to_regclass(v_relations[v_i])
    ) t;
    IF v_acl <> 'postgres' THEN
      RAISE EXCEPTION '事後閘⑧:% 的授權對象是 %(期望只有 postgres)⇒ 有人從預設權限拿到了東西',
        v_relations[v_i], v_acl;
    END IF;
  END LOOP;

  FOR v_i IN 1 .. array_length(v_functions, 1) LOOP
    SELECT COALESCE(string_agg(DISTINCT g, ','), '(空)') INTO v_acl FROM (
      SELECT COALESCE(pg_catalog.pg_get_userbyid(a.grantee)::text, 'PUBLIC') AS g
        FROM pg_catalog.pg_proc p,
             LATERAL pg_catalog.aclexplode(
               COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
       WHERE p.oid = to_regprocedure(v_functions[v_i])
    ) t;
    -- 🔵 `get_pcm_incident_health()` 是唯一一支刻意 GRANT 出去的(告警端要叫它)。
    IF v_functions[v_i] = 'public.get_pcm_incident_health()' THEN
      IF v_acl <> 'postgres,service_role' THEN
        RAISE EXCEPTION '事後閘⑨:% 的可執行對象是 %(期望 postgres,service_role)', v_functions[v_i], v_acl;
      END IF;
    ELSIF v_acl <> 'postgres' THEN
      RAISE EXCEPTION '事後閘⑨:% 的可執行對象是 %(期望只有 postgres —— 它一個 GRANT 都不該有)',
        v_functions[v_i], v_acl;
    END IF;
  END LOOP;

  RAISE NOTICE '事後閘全過:表在 · 封閉集擋得住 · 寫入口與讀出口都在 · handler 接上了(剝註解後) · 主線沒掉 · owner/ACL 沒變 · 四個物件的授權對象都是封閉的。';
  RAISE NOTICE '⚠️ 而【告警端還沒接】—— 這張表現在只是「查得到」, 不是「會叫」。那一半是另一片。';
  RAISE NOTICE '⚠️ 本閘讓 pcm_incident_id_seq 前進了兩格(nextval 不隨交易回滾)⇒ 第一列事故的 id 不會是 1。';
END $after$;

COMMIT;
