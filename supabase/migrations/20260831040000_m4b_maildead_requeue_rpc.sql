-- ============================================================
-- M-4b ⟦b4-MAILDEAD⟧:把一封【已經放棄】的信重新排回佇列(受控、一次一列)
--
-- 🔴 **症狀**:某張單的通知信客人沒收到;`email_outbox` 裡**找得到那一列**,
--    而 `attempts >= max_attempts` ⇒ **它不會再被重試,也不會被重新排一次** ——
--    等多久、重跑幾次 cron 都不會。
--
-- **機制(兩個各自正確的東西接在一起)**:
--   ① 寄送側 due 述詞含 `attempts < max_attempts` ⇒ 燒完就不再重試(**那是對的**)
--   ② 排信側 scanner 的 anti-join **只看那一列存不存在**、不看 status
--      (`SupabasePaidOrderScannerAdapter.ts:29-31`)⇒ 一列死信還在 ⇒ 那張單再也不會被撈到
--      (**那也是對的, 它防的是重複寄信**)
--   ⇒ 📌 **交集:那封信永遠不會再寄, 而兩邊都沒有壞。**
--
-- ── 🔴🔴 為什麼是【原地 UPDATE】而不是刪掉重排 ──
--   `20260830060000…sql:178` 對**同族**的 `skipped_no_real_email` 逐字寫過:
--   「它佔住唯一鍵…須以**受控 UPDATE 原地翻回** `pending`、**不可新 INSERT**
--     (會撞唯一鍵 = 該 cohort 永久漏信);**且不得自動回灌**。」
--   🛑 而「不可新 INSERT」的理由是**機械的**,不是風格:
--      `email_outbox_event_uniq (event_type, dedup_key)`(`20260717020000…sql:377`)擋著。
--   ⇒ ✅ 那三件事(原地翻 / 不新增 / 不自動)本片逐條沿用。
--
-- ── 🔴🔴 **一次一列是【設計】,不是保守** ──
--   本函式**吃一個 id**,而**沒有**「全部重排」那一支。
--   ⇒ 📌 「把已經放棄很久的信一次全寄出去」那個災難,**需要一個批次入口才做得到**
--     ⇒ **不提供那個入口, 就是最便宜的防線。**
--   ⇒ 而那與「加一道守門擋住它」不同:**加守門要證明它擋的範圍不超出它守的**
--     (本線 2026-08-31 被 codex 打回過一次:一個新加的 fail-closed 擋掉了整支告警);
--     **不建入口則沒有範圍可以超出。**
--   🛑 **⇒ 日後若有人要加批次版, 請先回來讀這一段。**
--
-- ── 🔴🔴 **而上面那句「最便宜的防線」被 codex 2026-08-31 R1 擊破了一半, 原句留著** ──
--   codex 逐字:「service_role 腳本對多個 id **逐次呼叫** RPC, 甚至**直接 bulk UPDATE 全表**
--   ⇒ 一次一列**並未形成批次防線**, 仍可把全部歷史死信同時放回佇列。」
--   ✅ **它是對的, 而理由是機械的**:`service_role` 對 `email_outbox` **本來就有表級權限**
--      ⇒ 它繞得過這支函式, 根本不需要一個「批次版 RPC」。
--   🛑 **⇒ 所以那個災難【今天就做得到】, 本函式擋不住它。**
--   📌 **⇒ 正確的說法收窄成**:不建批次入口,擋掉的是「**有人【不小心】按到一顆全部重排的鈕**」,
--      **擋不掉**「有人**刻意**寫一段迴圈或一句 UPDATE」。
--      ⇒ **前者是意外, 後者是決定。而只有前者是這一格防得住的。**
--   🔴 **⇒ 而真正的邊界不在這支函式裡** —— 它在「誰拿得到 `service_role` 憑證」。
--      那不是本片能解的, 而**把它寫在這裡, 是為了不讓下一個人以為這裡已經擋住了。**
--
-- ── 現在做的時機(量到的,不是感覺)──
--   2026-08-31 14:3x 正式庫唯讀實查:`email_outbox` 全表 **2 列**、皆 `sent`;
--   死信(`attempts >= max_attempts` 且 `status <> 'sent'`)⇒ **0**。
--   ⇒ ✅ **這一片裝上去, 它一封都不會寄。**
--   🔴 而「今天 0」不是「不會發生」:`order_created` 那條線**已經接上排程在跑**
--      (`email-sweep/route.ts:291`)⇒ 死信隨時會長出來。
--   ⇒ 📌 **裝在 0 的時候, 與裝在 50 的時候, 是兩件不同的事。**
--
-- ⚠️ **它答不出什麼**(寫在這裡, 不是寫在交件檔):
--   · 🔴 它**不檢查那封信的【內容】還正不正確** —— `payload` 是當時組好的,
--     訂單後來若取消/退款/改地址, 重寄會寄出一封與事實不符的信。
--     **那一格另開一列, 而今天擋住它的是【一次一列 + 人在看】, 不是碼。**
--   · 它不寄信 —— 它只把那一列放回佇列, 真正寄出去的是 sweeper。
--   · 重排後再燒完 `max_attempts` 會再變成死信;**沒有機制上限**, 靠人工一次一列。
--   · 🔴🔴 **它不留任何稽核軌跡**(codex 2026-08-31 R1 must-fix, **本片未修**):
--     沒有 actor、沒有 reason,而且每次都把 `last_error_code` 清掉
--     ⇒ 📌 **同一列可以被反覆重排, 而【原始死因】與【是誰按的】兩樣都被抹掉。**
--     ⇒ 而 repo 裡已經有 `admin_audit_log`(`20260712210000…sql`)——
--       接上它是**另一片**(要多兩個參數與一次寫入, 且 actor 從哪來要拍板)。
--     🛑 **本片明知而不做, 這一行就是那個「明知」。** 板上另開一列追蹤。
-- ============================================================

BEGIN;

-- ── 1. 函式 ──
-- 🛑 刻意【不用】`CREATE OR REPLACE` —— 這是新物件。
CREATE FUNCTION public.admin_requeue_dead_email(
  p_outbox_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_status       text;
  v_attempts     integer;
  v_max_attempts integer;
BEGIN
  IF p_outbox_id IS NULL THEN
    RAISE EXCEPTION 'admin_requeue_dead_email:p_outbox_id 不得為 NULL';
  END IF;

  -- 🔴 **FOR UPDATE**:兩個人同時按同一列 ⇒ 第二個等第一個做完再讀
  --    ⇒ 它會看到 `attempts = 0` ⇒ 落下面那道「不是死信」的閘 ⇒ **不會重排兩次**。
  SELECT o.status, o.attempts, o.max_attempts
    INTO v_status, v_attempts, v_max_attempts
    FROM public.email_outbox o
   WHERE o.id = p_outbox_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_requeue_dead_email:找不到 outbox 列(%)', p_outbox_id;
  END IF;

  /**
   * 🔴🔴 **白名單, 不是黑名單**(codex 2026-08-31 R1 must-fix ×2)。
   *
   * ⛔ ~~我第一版只擋 `status = 'sent'`~~ —— 那是黑名單, 而這張表有 **7 態**
   *   (`20260717020000…sql:305` 的 CHECK, 2026-08-31 正式庫實查逐字確認)。
   *   ⇒ 它會把下面這三種**一起翻回 pending**, 而每一種都是錯的:
   *
   *   · `skipped_order_ineligible` ⇒ 🔴 **那是【終態】**(`:142` 逐字「故立獨立終態」)
   *     ⇒ 翻它 = 把一個「這張單不該收信」的裁決推翻。
   *   · `skipped_shipment_voided`  ⇒ 🔴 要**先確認箱子真的復原了**才該翻
   *     (板上 `⟦b4-SHIPUNVOID1⟧` 那一列在等的正是這個判斷)⇒ 本函式答不出那件事。
   *   · `sending`                  ⇒ 🔴🔴 **sweeper 正握著它**
   *     ⇒ codex 逐字:provider 已收信、人工同時重排 ⇒ attempts 歸零成 pending,
   *       舊持有者因世代柵欄無法標 sent ⇒ **逾 provider 冪等窗後再送會寄兩次。**
   *     ⇒ 📌 **而我的世界 4 測試把這一種當成【應成功】在驗** —— 那一格我測錯了方向。
   *
   * ✅ **只認兩態**:`pending` / `failed` —— 而 `failed` 是「可重試失敗態、非終態」
   *   (`:352` 逐字), `pending` 則是它被卡在那裡沒人撿。
   * 🛑 **新增第八態的人**:預設落在「不可重排」那一側, 要進來請在這裡具名。
   */
  IF v_status NOT IN ('pending', 'failed') THEN
    RAISE EXCEPTION
      'admin_requeue_dead_email:status=% 不在可重排白名單(只認 pending/failed)⇒ 拒絕。sent=會再寄一次給客人;sending=sweeper 正握著它, 翻它會寄兩次;skipped_* 各有自己的狀態契約, 不由本函式裁決',
      v_status;
  END IF;

  IF v_attempts < v_max_attempts THEN
    RAISE EXCEPTION
      'admin_requeue_dead_email:那一列還沒放棄(attempts=% < max_attempts=%)⇒ sweeper 本來就會再試;拒絕',
      v_attempts, v_max_attempts;
  END IF;

  -- ✅ 原地翻回。
  -- 🛑 `claimed_at` **必須一起清掉** —— 那張表有一條 CHECK:
  --    `(status = 'sending') = (claimed_at IS NOT NULL)`(2026-08-31 正式庫實查)
  --    ⇒ 只翻 status 而留著 claimed_at ⇒ **CHECK 直接擋下**, 整個交易回捲。
  UPDATE public.email_outbox o
     SET status          = 'pending',
         attempts        = 0,
         claimed_at      = NULL,
         next_retry_at   = pg_catalog.now(),
         last_error_code = NULL
   WHERE o.id = p_outbox_id;

  -- 🛑 **零 PII**:不回 `recipient_email`、不回 `payload`、不回 `subject`。
  --    回的是【那一列現在長什麼樣】的最小事實, 讓呼叫端能證明它真的動了。
  RETURN pg_catalog.jsonb_build_object(
    'outbox_id',            p_outbox_id,
    'previous_status',      v_status,
    'previous_attempts',    v_attempts,
    'max_attempts',         v_max_attempts,
    'requeued',             true
  );
END
$fn$;

ALTER FUNCTION public.admin_requeue_dead_email(uuid) OWNER TO postgres;

COMMENT ON FUNCTION public.admin_requeue_dead_email(uuid) IS
  'M-4b ⟦b4-MAILDEAD⟧:把一封已經放棄的信(attempts >= max_attempts)原地翻回 pending 重排。'
  '🔴 一次一列, 刻意沒有批次版 —— 「把歷史一次全寄出去」那個災難需要批次入口才做得到, 不建它就是最便宜的防線。'
  '原地 UPDATE 不新 INSERT:email_outbox_event_uniq (event_type, dedup_key) 擋著, 新增會讓該 cohort 永久漏信。'
  'claimed_at 必須一起清:那張表有 CHECK (status=sending) = (claimed_at IS NOT NULL)。'
  '擋兩種非死信:已 sent(重排=再寄一次給客人)/ attempts 還沒燒完(sweeper 本來就會再試)。'
  '零 PII:不回 recipient_email / payload / subject。'
  '🔴 已知缺口(另開一列):它不檢查那封信的 payload 內容是否已過期(訂單後來可能取消或改地址)。';

-- ── 2. ACL ──
-- 🔴 **授 `service_role`, 而那不是猜的**(2026-08-31 兩側各量一次, 同值):
--    repo 字面 `git grep -A1 'GRANT EXECUTE ON FUNCTION public.admin_' -- 'supabase/migrations/*.sql'`
--            | grep -oE 'TO [a-z_, ]+' ⇒ **42 次全部是 `TO service_role`**
--    正式庫   `select proname, array_to_string(proacl,',') from pg_proc … proname like 'admin\_%'`
--            ⇒ 抽樣 5 支全部是 `postgres=X/postgres,service_role=X/postgres`
--    🛑 **查法留在這裡是刻意的** —— 今天已經有兩個窗因為猜名字出事;
--       下一個人要確認這一行對不對, 上面那兩條指令可以直接重跑。
REVOKE ALL ON FUNCTION public.admin_requeue_dead_email(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_requeue_dead_email(uuid)
  FROM anon, authenticated, payment_confirmer;
GRANT EXECUTE ON FUNCTION public.admin_requeue_dead_email(uuid) TO service_role;

-- ── 3. 斷言(fail-closed;對不上就 RAISE, 整支回捲)──
-- 🛑 **不用 `has_function_privilege`** —— 2026-08-31 本線在正式庫上量到它會說謊
--    (它只答該物件自己的 ACL, 不看 body 裡呼叫的函式)。這裡攤開 `proacl` 比集合。
DO $assert$
DECLARE
  v_functions text[] := ARRAY['public.admin_requeue_dead_email(uuid)']::text[];
  r           text;
  v_oid       oid;
  v_acl       text;
  v_extra     text;
BEGIN
  FOREACH r IN ARRAY v_functions LOOP
    SELECT p.oid, pg_catalog.array_to_string(p.proacl, ',')
      INTO v_oid, v_acl
      FROM pg_catalog.pg_proc p
     WHERE p.oid = pg_catalog.to_regprocedure(r);

    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'MAILDEAD 收權斷言失敗:找不到函式 %(簽名打錯或沒建成)⇒ 拒繼續', r;
    END IF;

    IF v_acl IS NULL THEN
      RAISE EXCEPTION 'MAILDEAD 收權斷言失敗:% 的 proacl 是 NULL(= 套用預設 ⇒ PUBLIC 可執行)⇒ 拒繼續', r;
    END IF;

    -- 🔴 **白名單**:只要出現不在允許集合裡的就炸(黑名單在跟下一個沒想到的角色賽跑)。
    SELECT pg_catalog.string_agg(g.grantee, ', ')
      INTO v_extra
      FROM (
        SELECT pg_catalog.pg_get_userbyid((aclexplode(p.proacl)).grantee) AS grantee
          FROM pg_catalog.pg_proc p WHERE p.oid = v_oid
      ) g
     WHERE g.grantee NOT IN ('service_role', CURRENT_USER);

    IF v_extra IS NOT NULL THEN
      RAISE EXCEPTION 'MAILDEAD 收權斷言失敗:% 的 EXECUTE 清單多出非預期角色(%)—— 只應有 service_role;拒繼續', r, v_extra;
    END IF;

    IF v_acl NOT LIKE '%service_role=%' THEN
      RAISE EXCEPTION 'MAILDEAD 收權斷言失敗:% 對 service_role 沒有 EXECUTE ⇒ 後台按不動;拒繼續', r;
    END IF;

    -- 🔵 **`WITH GRANT OPTION` 也要擋**(codex 2026-08-31 R1 nit)。
    --    `aclexplode` 的 `is_grantable` 為 true = 那個角色**可以再把執行權轉授給別人**
    --    ⇒ 上面的白名單當下全過, 而【明天的清單】就不是我們寫的了。
    --    📌 **⇒ 白名單管的是「現在有誰」, 而 grant option 管的是「誰能再加人」。兩個都要問。**
    IF EXISTS (
      SELECT 1
        FROM pg_catalog.pg_proc p, aclexplode(p.proacl) a
       WHERE p.oid = v_oid AND a.is_grantable
    ) THEN
      RAISE EXCEPTION 'MAILDEAD 收權斷言失敗:% 有角色帶 WITH GRANT OPTION ⇒ 它能再轉授給別人;拒繼續', r;
    END IF;
  END LOOP;

  -- 🔵 **負對照:NULL 參數必須炸**(裸 NULL 會是 unknown 型別, 有 overload 時會 ambiguous ⇒ 加轉型)
  /**
   * 🔴🔴 **這個負對照原本是【恆真】的**(codex 2026-08-31 R1 must-fix)。
   * ⛔ ~~舊版只檢查「有沒有 RAISE」~~ —— 而**拿掉那道 NULL 守門之後, NULL 會落到
   *   下一格「找不到列」, 那**同樣是 `raise_exception`** ⇒ 這個 EXCEPTION 照樣吞掉
   *   ⇒ **負對照通過, 而那道閘已經不在了。**
   * 📌 **⇒ 一個只問「有沒有炸」的負對照, 分不出【是哪一道閘讓它炸的】。**
   *   (本線 2026-08-31 同族第三次:兩個訊號共用 reason / rc 非 0 不代表是我要的那道閘。)
   * ✅ 改成**認那道閘自己的訊息字面**。
   */
  BEGIN
    PERFORM public.admin_requeue_dead_email(NULL::uuid);
    RAISE EXCEPTION 'MAILDEAD 負對照失敗:p_outbox_id = NULL 竟然沒有 RAISE ⇒ 那道閘不在了';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM LIKE '%MAILDEAD 負對照失敗%' THEN
        RAISE;
      END IF;
      -- 🔴 炸了還不夠 —— 要是【那一道】炸的。
      IF SQLERRM NOT LIKE '%p_outbox_id 不得為 NULL%' THEN
        RAISE EXCEPTION
          'MAILDEAD 負對照失敗:NULL 確實炸了, 而訊息不是那道 NULL 守門的(收到 %)⇒ 可能是落到「找不到列」那一格', SQLERRM;
      END IF;
  END;
END
$assert$;

COMMIT;
