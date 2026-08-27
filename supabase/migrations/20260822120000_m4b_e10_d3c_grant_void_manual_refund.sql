-- ════════════════════════════════════════════════════════════════════════════
-- M-4b E10 片 D3-c:把 admin_void_manual_refund 的 EXECUTE 開給 service_role
-- ════════════════════════════════════════════════════════════════════════════
-- 🔴 **這支是 D3-b 那道「分期開權」封印的解除鍵。** D3-b(20260820100000)自己寫了四次
--    「零 GRANT」,逐字:「本檔只建函式,EXECUTE 由『登記畫面那一片』開」。
--    ⇒ **那一片就是這一片(D3-c 作廢入口)。** 開權與呼叫端在同一片落地,是刻意的:
--       先開權、後做入口 ⇒ 中間那段時間有一條沒有任何呼叫端在守的錢路徑。
--
-- 🔴 **開的是【作廢】不是【退款】。** 作廢 = 「這筆登記本身記錯了」,它不動錢。
--    錢有沒有真的交回客人,看 actor 與稽核 —— 見 D3-b 的 COMMENT ON FUNCTION。
--
-- ── 為什麼需要它(#787 的解除條件③,2026-08-22 線 C 補進 manual-refund-entry-gate.ts)──
--    #787 封印的是【登記入口】,理由是「登記錯了改不掉」。而改得掉的前提有三件:
--      ① 沖銷 RPC 已 apply           ⇒ 2026-08-22 APPLIED.tsv 命中 20260820100000  ✅
--      ② 呼叫端登記進 CALLER_ALLOWLIST                                              (本片做)
--      ③ service_role 對沖銷 RPC 有 EXECUTE                                          (本檔做)
--    🔴 而 ③ 在本檔 apply 之前是 **false**(2026-08-22 唯讀實測:
--       proacl = {postgres=X/postgres};has_function_privilege('service_role',…) = false;
--       對照組 admin_record_manual_refund = true ⇒ 那把尺是活的)。
--
-- ⚠️ **本檔不建立、不修改任何函式或表** —— 純授權。⇒ rollback = 一行 REVOKE(見檔尾)。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ══ 前置閘 P1:那支函式要存在,而且簽章要逐字相符 ══════════════════════════════
-- 🔴 用 to_regprocedure 而不是 proname:**同名不同簽章的函式會各自有各自的 ACL**,
--    GRANT 打錯簽章 ⇒ 開到另一支上去,而這支照樣沒權限、`has_function_privilege` 照樣 false。
DO $$
BEGIN
  IF to_regprocedure('public.admin_void_manual_refund(uuid,text,text)') IS NULL THEN
    RAISE EXCEPTION 'D3-c 前置 P1:找不到 public.admin_void_manual_refund(uuid,text,text)。'
                    '⇒ 先確認 20260820100000 已 apply(supabase/APPLIED.tsv),再跑本檔';
  END IF;
END $$;

-- ══ 前置閘 P2:開之前先確認它現在【真的沒有】被開過 ════════════════════════════
-- 🔴 這一格不是形式:若已經有人開過,那代表有一條我不知道的路徑動過這支函式的權限
--    ⇒ 那要先查清楚,不是再蓋一次 GRANT 上去(D3-b 前置閘 P7b3 的原話:
--       「不要直接重新 GRANT —— 若是②,那會重開一條被緊急關閉的錢路徑」)。
-- ⚠️ **它同時是本檔的「該紅的那一發」**:重跑本檔第二次時這一格會紅,而那是對的 ——
--    本檔不是冪等的,它是一次性的狀態轉移。
DO $$
DECLARE v_src text;
BEGIN
  SELECT p.proacl::text INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_void_manual_refund';
  IF v_src IS DISTINCT FROM '{postgres=X/postgres}' THEN
    RAISE EXCEPTION 'D3-c 前置 P2:開權前的 ACL 不是預期的「只有 owner」,實得 %。'
                    '⇒ 有人動過這支函式的權限,或本檔已經跑過一次。'
                    '🔴 先查清楚是誰、為什麼,再決定要不要繼續 —— 不要直接重跑本檔', v_src;
  END IF;
END $$;

-- ══ 開權 ═════════════════════════════════════════════════════════════════════
-- 🔴 只給 service_role。**不給 authenticated、不給 anon、不給 PUBLIC。**
--    呼叫端是 admin server action 用的 service client(createSupabaseServiceClient),
--    它走的就是 service_role。
GRANT EXECUTE ON FUNCTION public.admin_void_manual_refund(uuid, text, text) TO service_role;

-- ══ 後置 A1:service_role 真的拿到了 ═══════════════════════════════════════════
DO $$
BEGIN
  IF NOT has_function_privilege(
       'service_role', 'public.admin_void_manual_refund(uuid,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'D3-c 後置 A1:GRANT 跑完了而 service_role 仍然沒有 EXECUTE ⇒ 拒絕提交';
  END IF;
END $$;

-- ══ 後置 A2:PUBLIC 與 anon 一格都不能有 ═══════════════════════════════════════
-- 🔴 **新函式出生就自帶 PUBLIC EXECUTE**,D3-b 已用兩道 REVOKE 收掉;
--    本檔的 GRANT 不會把它加回來,但**要驗**——因為「service_role 有」與「只有 service_role 有」
--    是兩個宣稱,而 has_function_privilege 只答得出前面那一個。
-- ⚠️ ACL 欄是 NULL 時 PUBLIC 是看不見的(memory `revoking-function-execute-in-supabase`)
--    ⇒ 這裡直接查 aclexplode,不靠 has_function_privilege 反推。
DO $$
DECLARE v_cnt integer; v_src text;
BEGIN
  SELECT count(*) INTO v_cnt
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL aclexplode(p.proacl) a
   WHERE n.nspname = 'public' AND p.proname = 'admin_void_manual_refund'
     AND a.privilege_type = 'EXECUTE'
     AND (a.grantee = 0 OR a.grantee = 'anon'::regrole::oid);   -- grantee 0 = PUBLIC
  IF v_cnt <> 0 THEN
    SELECT p.proacl::text INTO v_src
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'admin_void_manual_refund';
    RAISE EXCEPTION 'D3-c 後置 A2:PUBLIC 或 anon 對沖銷 RPC 有 EXECUTE(% 筆),ACL=% ⇒ 拒絕提交',
                    v_cnt, v_src;
  END IF;
END $$;

-- ══ 後置 A3:ACL 的最終形狀逐字釘住 ════════════════════════════════════════════
-- 🔴 A1+A2 各自為真,仍可能有第三個角色被開到(它既不是 PUBLIC 也不是 anon)。
--    ⇒ 這一格直接比對整串 ACL,不留「還有誰」的空間。
DO $$
DECLARE v_src text;
BEGIN
  SELECT p.proacl::text INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_void_manual_refund';
  IF v_src IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}' THEN
    RAISE EXCEPTION 'D3-c 後置 A3:ACL 最終形狀不符,實得 %。'
                    '預期 {postgres=X/postgres,service_role=X/postgres}(= D1 那支開完之後的形狀)', v_src;
  END IF;
END $$;

-- ══ 後置 A4:對照組 —— 這把尺在「沒開」的那一邊要回 false ═════════════════════
-- 🔴 沒有這一格,上面三格全綠只證明「查得到東西」,證不了「查得出差別」。
--    拿一個【確定沒有被開過】的角色來問同一支函式:authenticated。
DO $$
BEGIN
  IF has_function_privilege(
       'authenticated', 'public.admin_void_manual_refund(uuid,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'D3-c 後置 A4:對照組 authenticated 也有 EXECUTE ⇒ 要嘛真的開錯了,'
                    '要嘛這把尺對任何角色都回 true(量具壞了)。兩種都拒絕提交';
  END IF;
END $$;

COMMIT;

-- ════════════════════════════════════════════════════════════════════════════
-- rollback(一行,可逆;本檔沒有 DDL)
--   REVOKE EXECUTE ON FUNCTION public.admin_void_manual_refund(uuid, text, text) FROM service_role;
-- 🔴 收回之後 UI 的作廢按鈕會【渲染得出來但按下去失敗】(42501)——
--    ⇒ 要一起把 manual-refund-entry-gate.ts 的封印改回 true,否則員工登記得了、改不掉。
-- ════════════════════════════════════════════════════════════════════════════
