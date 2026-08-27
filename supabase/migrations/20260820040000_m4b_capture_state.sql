-- ============================================================
-- M-4b · capture_state:讓系統分得出「已授權 / 已請款」
--
-- 真權威:plan `~/pcm-mailbox/W4-003-capture-state-plan-R2-折完R1-20260820.md`
--         (Sean 2026-08-20 逐字批「Q2「看得出請款了沒」那片,開工嗎? 批」)
--
-- ── 缺口 ────────────────────────────────────────────────────────────────────
-- TapPay 的 Record API 一直有回 `is_captured`,而我們 parse 完就扔掉
-- (`packages/adapters/src/tappay/wire.ts:215` 有值、`packages/use-cases/src/settle-charge.ts:457`
--  逐字「is_captured 欄位仍 parse/型別保留…裁決不再讀」)。
--
-- ── 🔴🔴 本片【做到什麼】—— 而原本這一段寫得比實際做的多,更正保留 ──────────────
-- ~~⇒ 後果不是理論的:2026-08-19 有一筆單 TapPay 22:09 就請款成功,而後台永遠顯示「已授權」。~~
--   ↑ 這句**描述的缺口是真的,而本片【沒有關掉它】**。W5 對抗審查 R1 MF-1 抓到,W4 2026-08-20 實跑證實:
--
--   **本片做到的是:把【授權當下】那一刻的請款狀態存下來。**
--   而授權當下 `is_captured` 幾乎必然是 false ⇒ 存下的是 `'authorized'`。
--   🔴 21 小時後銀行真的請款了,**沒有任何路徑會再寫它** ——
--      成因:`settle-charge.ts:70` 的 `payment_status = 'paid'` 短路在 Record 查詢**之前** return,
--      而 `settleCharge` 的生產 caller **恰 4 條**(sweep×2 / reconfirm-orphans / reconcile-actions /
--      charge-actions)**全部走同一支函式** ⇒ 沒有現存入口繞得過。
--   ⇒ ⇒ **那筆 `D20260819P8ZewM` 在本片上線後,畫面仍然是「已授權」。**
--
--   ✅ **而本片仍然要做**:它建立了欄位、值域、成對約束與唯一的寫入路徑(RPC)——
--      重讀那一片**直接用這支 RPC 寫入,不必再建**。本片是它的地基,不是它的替代。
--   📌 **誰來重讀 ⇒ backlog `#785`**(掃描式:述詞 `capture_state = 'authorized'`、
--      掛既有 pg_cron;`pcm-settle-sweep */2` 與 `pcm-email-sweep */5` 都已在跑)。
--      ⚠️ 那一片動工前要 Sean 先答一題:**多久重讀一次 / 重讀多久以內的單** = 「錢什麼時候算收到」。
--
-- ── 🔴 本片【不做】什麼 ─────────────────────────────────────────────────────
--   · 不做「送出請款」——不需要:自動請款本來就在運作(Sean 2026-08-20 的 TapPay 截圖)。
--   · 不做「請款失敗標記」——它是 unknown 的子集,不是第四個事實值。另一片。
--   · 🔴 **不動 `mark_charge_attempt_charged` 與它的 fallback**(雙扣防護的心臟)。
--     capture_state 不是任何裁決的輸入 ⇒ 它的寫入是 best-effort;而 markCharged 的寫入是 fail-closed。
--     把 best-effort 的值塞進 fail-closed 的函式 = 把兩種失敗語意綁在一起。主視窗 2026-08-20 裁「乙」。
--   · 不碰 `status` 欄:那是**授權**的生命週期,請款是正交的另一軸。塞進去會改變
--     `payment_charge_attempts_order_lock_idx` 的語意 ⇒ **動到防雙扣鎖**。
--     🔴 **更正(2026-08-20 W4 自查,原句引的是【過期的】定義)**:本檔原本寫
--     「`20260612150000:101-102` `WHERE status IN ('pending','charged')`」——
--     那是**建表當天**的樣子,而它在 12 天後被加寬了:
--       `20260624120000:61-64` DROP 再 CREATE ⇒ 現行述詞是
--       `WHERE status IN ('pending', 'charged', 'released')`
--     (量法:掃過**所有**提到這個索引名的 migration 共 4 支,逐支開檔看它長什麼樣;
--      負向對照 `payment_charge_attempts_zzz_idx` ⇒ 零命中)
--     ⇒ 結論不變(仍然不碰 `status`),而**引錯的字面會讓下一個人以為 released 不在鎖裡**。
--     📌 這正是本 repo 反覆記過的那一格:**引一個【建表當天】的行號,答的是那一天的事實。**
--
-- ── 🔴 三態,而第三態刻意不是 NULL ──────────────────────────────────────────
--   authorized = Record 讀到 is_captured = false
--   captured   = Record 讀到 is_captured = true
--   unknown    = **還沒有任何一條路查過它**(DEFAULT;RPC 拒絕寫入這個值)
--   刻意不用 `is_captured boolean NULL` —— NULL 會同時代表「TapPay 說不知道」與「我們沒去讀」,
--   而那兩者對值班的意思完全不同。`NOT NULL DEFAULT` 的用意是**每一列都必須表態**,
--   而預設值要是**最保守的那一個**,不是最可能的那一個。
--
-- ── ⚠️ 兩件我們【沒有量到】的事(Sean 是在知道這兩件的情況下批的)────────────
--   ① 「怎麼分辨直刷單」那格是**推導**不是宣告:`bank_transaction_id` 現在只有一個寫入者
--      (`record_charge_bank_txn`,而它只寫**仍 pending** 的 attempt)⇒ 進 charged 之後寫不進去。
--      🔴 **多一個寫入者,這個分辨會靜靜失效,不會有任何東西紅。**
--   ② 建表(`20260612150000`)與加 `bank_transaction_id`(`20260613140000:65`)**差一天**
--      ⇒ 那個窗口內建立的列恆 NULL、會被誤判成直刷。**有幾筆,沒有人量到**(要正式庫連線)。
--      ⇒ 兩題的查詢已寫成可貼的紙:`~/pcm-mailbox/W4-007-要Sean在場的兩發查詢-20260820.md`
--   ⚠️ 上面兩件都**不影響本檔的正確性** —— 它們決定的是**顯示層**那一片(backlog `#781`)。
--
-- ⛔ apply 停點:本檔 commit 後**不 apply**。apply 要 Sean 在場。
-- ============================================================

BEGIN;

-- ══ 1. 兩欄 ═════════════════════════════════════════════════════════════════
-- 🔴 不用 `IF NOT EXISTS`:它把「撞到不一致」從 error 變成 silent skip。
--    migration 本來就一次性,照 precedent `20260809230000:107` 用裸 ADD COLUMN,撞到就炸。
-- PG17(`20260624120000:34` 逐字「project bmpnplmnldofgaohnaok PG17」)⇒ 非 volatile DEFAULT 不重寫表。
ALTER TABLE public.payment_charge_attempts
  ADD COLUMN capture_state         text NOT NULL DEFAULT 'unknown',
  ADD COLUMN capture_state_read_at timestamptz;

-- ══ 2. 兩條 CHECK(同一個 ALTER ⇒ 合併成一次 scan)═══════════════════════════
ALTER TABLE public.payment_charge_attempts
  ADD CONSTRAINT payment_charge_attempts_capture_state_chk
    CHECK (capture_state IN ('authorized', 'captured', 'unknown')),
  -- 成對(形狀照 `20260809230000` §2②):擋「標了值卻沒有時點」與「有時點卻是 unknown」兩種半套。
  -- 🔴 而它同時是 §3 那支 RPC 的第二道證人:RPC 值域只收兩值,這條擋的是繞過 RPC 的路。
  ADD CONSTRAINT payment_charge_attempts_capture_read_pair_chk
    CHECK (
      (capture_state =  'unknown' AND capture_state_read_at IS NULL)
      OR
      (capture_state <> 'unknown' AND capture_state_read_at IS NOT NULL)
    );

COMMENT ON COLUMN public.payment_charge_attempts.capture_state IS
  '請款狀態 authorized|captured|unknown。'
  '🔴 **不是任何裁決的輸入** —— 「授權即成立」(Sean 2026-06-20 拍;設計包 '
  'docs/specs/2026-06-20-m3-3ds-auth-settlement-redesign.md §3-4)不讀此欄;它是 audit/顯示值,'
  '寫入為 best-effort(失敗只 log、絕不影響 paid 收斂)。'
  '🔴 unknown 有**三種**命運,而表上分不出來(前兩種是設計,第三種是缺陷):'
  '(a) 3DS/對帳路尚未 settle ⇒ **暫時的**,之後會變;'
  '(b) 非 3DS 直刷(confirmPayment)⇒ **永久的** —— payByPrime 回應沒有 is_captured 這個欄,'
  '而本片規格不為它多打一次 Record API ⇒ 那條路上沒有任何東西會寫它;'
  '(c) 🔴 **查過了,而寫入失敗**(RPC throw 或回 false)⇒ 呼叫端只 log ⇒ 訂單已 paid ⇒ '
  '下次 settleCharge 在 settle-charge.ts:70 短路 return ⇒ **永久 unknown,而它其實被查過了**'
  '(W5 對抗審查 R1 MF-2;2026-08-20 實跑證實。~~原 COMMENT 只列 (a)(b)~~)。'
  '⇒ 顯示層必須把 (b) 顯示成「此付款方式無請款狀態」,**不得**顯示「查詢中」(backlog #781)。'
  '⚠️ 「unknown 只有一個意思」這句話的效期,到**出現第二個寫入者**為止。';

COMMENT ON COLUMN public.payment_charge_attempts.capture_state_read_at IS
  '`capture_state` 被寫入的時刻(RPC 內與值同一個 UPDATE 寫,由 pair CHECK 保證不半套)。'
  '沒有它,`authorized` 答不出「這是三秒前讀的還是三天前讀的」——而請款狀態會變。'
  'NULL ⟺ capture_state = ''unknown''(pair CHECK 強制)。';

-- ══ 3. 登記用 RPC:唯一用途、best-effort、零狀態機轉移 ═══════════════════════
-- 🔴 值域**恰兩值**:`unknown` 是 DEFAULT 寫進去的,**RPC 拒絕它**。
--    若讓 RPC 收三值 + 無條件寫 read_at ⇒ 以 'unknown' 呼叫必撞 pair CHECK ⇒ 而那個 throw
--    會被呼叫端的 best-effort catch **吞掉、只留一行 log,不會有任何東西紅**
--    (W5 對抗審查 R1 MF-4;2026-08-20 已在拋棄式 PG 實測復現)。
-- 🔴 雙鍵不符**回 false、不 RAISE**(同族慣例:`20260619120000:158` 逐字「非 pending / 查無 ⇒ 回 false」)。
--    這不只是風格 —— 它把「P0001 只由值域守衛產生」變成一個**結構事實**,而不是測試紀律:
--    若雙鍵不符也 RAISE,兩個世界都印 P0001 ⇒ 只斷言 SQLSTATE 的測試會恆綠
--    (2026-08-20 拋棄式 PG 五發實測:A3「雙鍵不符 + 值域合法」⇒ P0001 MSG=付款處理失敗)。
CREATE OR REPLACE FUNCTION public.record_charge_capture_state(
  p_attempt_id    uuid,
  p_order_id      uuid,
  p_capture_state text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_cur  text;
  v_rows integer;
BEGIN
  IF p_capture_state IS NULL OR p_capture_state NOT IN ('authorized', 'captured') THEN
    RAISE EXCEPTION 'capture_state 值域只收 authorized|captured(got %)', COALESCE(p_capture_state, '<null>');
  END IF;

  -- 🔴 單調性(W5 R1 n-1):請款是**不可逆**的 —— 一旦讀到 captured,就不接受被 authorized 蓋回去。
  --    今天幾乎不可達(唯一寫入點在 settlePaid、而它一張單只到得了一次),而**不可達性靠的是別處那個
  --    短路,不是這支 RPC 自己的約束** ⇒ `#785` 那片加了重讀路徑之後,這個洞立刻變可達。現在就關。
  -- 🔴 **刻意先 SELECT、不寫進 UPDATE 的 WHERE**:寫進 WHERE 的話 `ROW_COUNT = 0` 會同時代表
  --    「雙鍵不符」與「單調性拒絕」⇒ 兩個意思又合流,而那正是本片剛把碰撞從源頭拔掉的理由。
  SELECT capture_state INTO v_cur
    FROM public.payment_charge_attempts
   WHERE id = p_attempt_id AND order_id = p_order_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;                      -- 雙鍵不符 / 查無 —— 唯一會回 false 的情況
  END IF;

  IF v_cur = 'captured' AND p_capture_state = 'authorized' THEN
    RETURN true;                       -- 冪等 no-op:不是失敗,不得回 false(否則呼叫端會誤 log 成對不上)
  END IF;

  UPDATE public.payment_charge_attempts
     SET capture_state         = p_capture_state,
         capture_state_read_at = pg_catalog.now()   -- n-4:同檔其他地方都帶 pg_catalog. 前綴,一致
   WHERE id       = p_attempt_id
     AND order_id = p_order_id;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$$;

COMMENT ON FUNCTION public.record_charge_capture_state(uuid, uuid, text) IS
  'M-4b capture_state 登記(SECURITY DEFINER、search_path='''')。把 TapPay Record API 的 is_captured '
  '存下來,讓系統分得出「已授權」與「已請款」。'
  '🔴 **唯一用途、零狀態機轉移**:不改 status、不碰 rec_trade_id、不碰 per-order 鎖。'
  '🔴 值域**恰兩值** authorized|captured;`unknown` 是 DEFAULT 寫進去的,本函式拒絕它'
  '(收三值 + 無條件寫 read_at 會撞 pair CHECK,而那個 throw 會被呼叫端的 best-effort catch 吞掉)。'
  '🔴 雙鍵(attempt_id + order_id)不符 **回 false、不 RAISE** —— 這讓 P0001 恰好只由值域守衛產生,'
  '是結構事實而不是測試紀律。呼叫端 best-effort:回 false 或 throw 皆只 log、不影響 paid 收斂。'
  '只 payment_confirmer 可呼。';

-- ══ 4. 兩道 REVOKE(新 SECDEF 物件出生自帶 PUBLIC EXECUTE)═══════════════════
-- `docs/patterns/revoking-function-execute-in-supabase.md:24-25`;清單照同族 `20260619120000:233-236`。
-- ⚠️ 誠實邊界(照抄 `20260810210000:431-432` 自標的那一格,不擴張):REVOKE 的是**列舉的 role 名**
--    ⇒ 若有人手動 GRANT 給自訂 role,那個 grant 會原封活過本檔。**本檔不宣稱「已封死」。**
REVOKE ALL ON FUNCTION public.record_charge_capture_state(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_charge_capture_state(uuid, uuid, text) TO payment_confirmer;

-- ══ 5. 結構斷言(不符即 RAISE 炸整段交易;零錯跑完 = 全過)═══════════════════
DO $$
DECLARE
  v_acl aclitem[];
BEGIN
  -- ① 兩欄在、型別對、NOT NULL / DEFAULT 對
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.payment_charge_attempts'::regclass
       AND attname = 'capture_state' AND NOT attisdropped
       AND atttypid = 'text'::regtype AND attnotnull
  ) THEN
    RAISE EXCEPTION 'capture_state 欄不存在 / 型別非 text / 非 NOT NULL;拒繼續';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.payment_charge_attempts'::regclass
       AND attname = 'capture_state_read_at' AND NOT attisdropped
       AND atttypid = 'timestamptz'::regtype AND NOT attnotnull
  ) THEN
    RAISE EXCEPTION 'capture_state_read_at 欄不存在 / 型別非 timestamptz / 不該是 NOT NULL;拒繼續';
  END IF;

  -- ② 兩條 CHECK 在
  IF (SELECT count(*) FROM pg_constraint
       WHERE conrelid = 'public.payment_charge_attempts'::regclass
         AND conname IN ('payment_charge_attempts_capture_state_chk',
                         'payment_charge_attempts_capture_read_pair_chk')) <> 2 THEN
    RAISE EXCEPTION '兩條 capture CHECK 不是恰好兩條;拒繼續';
  END IF;

  -- ③ 函式是 SECURITY DEFINER 且 search_path 被釘住
  -- 🔴 期望字面是**實跑量出來的**:空 search_path 在 proconfig 裡渲染成 `search_path=""`(帶兩個雙引號),
  --    **不是** `search_path=`。我第一版寫後者,2026-08-20 在拋棄式 PG 上 apply 當場紅在這裡。
  --    而這個坑 repo 已經記過兩次(`20260612150000:49-50` / `20260810200000:477-478` 逐字)——
  --    我沒有理由打開那兩支檔,所以我照樣踩了一次。⇒ 期望值一律實跑量,不從記憶寫。
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc
     WHERE oid = 'public.record_charge_capture_state(uuid,uuid,text)'::regprocedure
       AND prosecdef
       AND pg_catalog.array_to_string(proconfig, ', ') = 'search_path=""'
  ) THEN
    RAISE EXCEPTION 'record_charge_capture_state 不是 SECURITY DEFINER 或 search_path 非 ""(實測字面);拒繼續';
  END IF;

  -- ④ 🔴 proacl 非 NULL:NULL 代表**沒有任何 GRANT/REVOKE 紀錄** ⇒ PG 對函式的預設是 EXECUTE TO PUBLIC
  --    (照 `20260810200000:513` 的做法。這一格擋的是「REVOKE 那兩行沒生效」而畫面上看不出來。)
  SELECT proacl INTO v_acl FROM pg_catalog.pg_proc
   WHERE oid = 'public.record_charge_capture_state(uuid,uuid,text)'::regprocedure;
  IF v_acl IS NULL THEN
    RAISE EXCEPTION 'record_charge_capture_state 的 proacl 是 NULL(REVOKE/GRANT 沒生效)⇒ 對 PUBLIC 開著;拒繼續';
  END IF;

  -- ④-b 🔴 W5 R1 n-2:上一格的射程比它看起來窄 —— 它擋得住「REVOKE 沒跑」,
  --      **擋不住「事後有人 GRANT EXECUTE 給 anon」**(那時 proacl 仍然非 NULL)。
  --      ⇒ 補一道**全稱**斷言:把 proacl 攤平,任何非 owner、非 payment_confirmer 的 grantee 一律紅。
  --      形狀取自 `scripts/l5am-verify.sh:338-363`(同日 W4 才把那支的枚舉閘改成全稱)。
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a
     WHERE p.oid = 'public.record_charge_capture_state(uuid,uuid,text)'::regprocedure
       AND a.grantee <> p.proowner
       AND a.grantee <> 'payment_confirmer'::regrole
  ) THEN
    RAISE EXCEPTION 'record_charge_capture_state 的 proacl 出現非 payment_confirmer 的 grantee;拒繼續';
  END IF;

  -- ⑤ 逐 role 的**有效權限**(has_function_privilege 看得到 role 繼承,proacl 看不到)
  IF has_function_privilege('anon',          'public.record_charge_capture_state(uuid,uuid,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.record_charge_capture_state(uuid,uuid,text)', 'EXECUTE')
     OR has_function_privilege('service_role',  'public.record_charge_capture_state(uuid,uuid,text)', 'EXECUTE')
     OR NOT has_function_privilege('payment_confirmer', 'public.record_charge_capture_state(uuid,uuid,text)', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'record_charge_capture_state EXECUTE 權限異常 — 應唯 payment_confirmer;拒繼續';
  END IF;

  -- ⑥ 🔴 payment_confirmer 的 role-hygiene 回歸:它**只透 SECDEF RPC 寫 attempts**,
  --    直接的表層/欄層權限必須恆零 —— 本片新增一支 SECDEF 函式,不得順手放開任何表權限。
  --    同族先例 `20260619120000` 尾段也有這一格,而它用 `information_schema.role_*_grants`。
  --    🔴 **本檔刻意改走 `pg_catalog`**:`information_schema` 只列出「當前使用者看得見的」授權,
  --    對稽核用途會**系統性少報** ⇒ 那個 `0` 同時相容於「真的零」與「我看不到」。
  --    `aclexplode(relacl)` + `pg_attribute.attacl` 是全集,不受可見性影響。
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class c, pg_catalog.aclexplode(c.relacl) a
     WHERE c.oid = 'public.payment_charge_attempts'::regclass
       AND a.grantee = 'payment_confirmer'::regrole
     UNION ALL
    SELECT 1
      FROM pg_catalog.pg_attribute att, pg_catalog.aclexplode(att.attacl) a
     WHERE att.attrelid = 'public.payment_charge_attempts'::regclass
       AND a.grantee = 'payment_confirmer'::regrole
  ) THEN
    RAISE EXCEPTION 'payment_confirmer 對 payment_charge_attempts 有直接表/欄層權限(role-hygiene 破);拒繼續';
  END IF;

  -- ⑥ 🔴 既有列全部落在 DEFAULT:回填**刻意不做**(plan §5)——
  --    我們真的不知道那些單有沒有被請款,標成 authorized 是編造一個沒量過的值。
  IF EXISTS (SELECT 1 FROM public.payment_charge_attempts WHERE capture_state <> 'unknown') THEN
    RAISE EXCEPTION '既有列出現非 unknown 的 capture_state(本檔不做回填);拒繼續';
  END IF;
END
$$;

COMMIT;

-- ── Rollback(Supabase forward-only;逆序手動執行,僅供參考)──────────────────
--   DROP FUNCTION IF EXISTS public.record_charge_capture_state(uuid, uuid, text);
--   ALTER TABLE public.payment_charge_attempts
--     DROP CONSTRAINT IF EXISTS payment_charge_attempts_capture_read_pair_chk,
--     DROP CONSTRAINT IF EXISTS payment_charge_attempts_capture_state_chk;
--   ALTER TABLE public.payment_charge_attempts
--     DROP COLUMN IF EXISTS capture_state_read_at,
--     DROP COLUMN IF EXISTS capture_state;
