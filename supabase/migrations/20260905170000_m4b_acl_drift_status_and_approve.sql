-- ⟦b9-ACLDRIFT5⟧ 片二(SQL 那半):把「今天與昨天不一樣」變成一個【讀得到的訊號】
-- 前置:20260905140000(片一 —— 表 / 兩支函式 / 每日 cron)。**它沒貼, 這支貼下去會被閘⓪擋。**
-- rollback:supabase/rollbacks/20260905170000-rollback.sql(整支貼一次)
-- after-check:supabase/after-checks/16-170000-after.sql
--
-- 🔴 **這支【不會寄任何信】** —— 它只讓訊號讀得到。
--    信裡那一列住在 TypeScript(`packages/use-cases/src/check-anomaly-alerts.ts`),另一顆 commit。
--    📌 兩半【刻意分開】:這一半靠 Sean 貼、那一半靠部署 —— **兩個不同的生效時刻**,
--       綁成一顆的話, 先到的那一半會讀不到後到的那一半, 而畫面上什麼都不會說。
--
-- 🛑 **它證不到什麼**(先寫, 免得下一個人以為它涵蓋更多):
--    · 🔴 ④b 那幾道 REVOKE 擋的是【直接呼叫】, **擋不住 `SET ROLE`**(codex R1):
--      一個應用角色若是某個持權角色的成員(即使 `INHERIT FALSE`), 它仍可 `SET ROLE` 過去。
--      本片**不打算擋那條路** —— 能那樣做的人已經動得了比這扇窗大得多的東西。
--      **寫在這裡是為了不讓下一個人以為它擋住了。**
--    · 它比的是【兩個取樣時點】—— 10:00 改、11:00 改回來, 兩天的快照相同 ⇒ 它不會叫。
--    · 它只認 `public` + `storage` 與四個應用角色(與 `scripts/acl-snapshot.sh` 同一個分母)。
--    · 🔴 「與昨天不同」**不等於「有人偷改」** —— 貼板當天一定不同。
--      ⇒ 所以有 ② 那一步:貼完板的人把今天這列標成【已批准】, 而**那是一個決定, 不是一個步驟**。

BEGIN;

-- ── 前置閘⓪:片一沒貼 ⇒ 整支停 ──────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.pcm_acl_snapshot_digest') IS NULL THEN
    RAISE EXCEPTION '前置閘⓪:public.pcm_acl_snapshot_digest 不存在 ⇒ 片一(20260905140000)還沒貼, 先貼它';
  END IF;
  IF to_regprocedure('public.pcm_acl_digest_record()') IS NULL THEN
    RAISE EXCEPTION '前置閘⓪:pcm_acl_digest_record() 不存在 ⇒ 片一貼了一半?';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
              WHERE attrelid = 'public.pcm_acl_snapshot_digest'::regclass
                AND attname = 'approved_at' AND NOT attisdropped) THEN
    RAISE EXCEPTION '前置閘⓪:approved_at 欄已存在 ⇒ 這支貼過了, 不要重貼';
  END IF;
END $$;

-- ── ① 「已批准」那一格 ────────────────────────────────────────
-- 🔵 為什麼是欄不是另一張表:一列快照與「它被批准了沒」是同一件事的兩面,
--    分兩張表會多一個「對不起來」的地方, 而這裡沒有任何東西需要多對一。
ALTER TABLE public.pcm_acl_snapshot_digest
  ADD COLUMN approved_at timestamptz,
  ADD COLUMN approved_note text;

COMMENT ON COLUMN public.pcm_acl_snapshot_digest.approved_at IS
  '這一列被人【明確宣告為對的】的時刻。NULL = 還沒有人看過。'
  '🔴 它不是「這列是新的」的意思 —— 它是一個人做的決定, 而 approved_note 是他的理由。';

-- ── ② 比較:最新一列 vs 上一列 ────────────────────────────────
-- 🔴🔴 **`security_invoker = false`(= 預設)而這是【刻意】的**(codex 2026-09-05 R1 must-fix):
--    第一版寫 `true`, 而實測 `SET ROLE service_role; SELECT … FROM pcm_acl_drift_status;`
--    ⇒ `ERROR: permission denied for table pcm_acl_snapshot_digest`
--    成因:invoker view 用【讀的人】的權限去讀底表, 而底表對四個應用角色四道 REVOKE 全收
--    ⇒ 📌 **告警端拿不到訊號, 而 migration 一路全綠、`has_table_privilege(view)` 也印 t。**
--    ✅ 改成 definer view —— **那正是「開一扇受控的窗」該用的機制**:
--       service_role 看得到這一列摘要, 而**看不到底表**(它連 SELECT 都沒有)。
-- 🛑 **代價要明寫**:definer view 以擁有者(postgres)的身分讀底表 ⇒ 底表的 RLS 不適用。
--    這裡可接受, 因為底表**零 policy**、而它存在的唯一目的就是被這扇窗投影出來。
--    ⚠️ 而下一個人若把底表改成「靠 RLS 分租戶」, 這扇窗會**繞過那道 RLS** ⇒ 那時要回來改這裡。
CREATE VIEW public.pcm_acl_drift_status AS
WITH ranked AS (
  SELECT d.*, row_number() OVER (ORDER BY d.taken_at DESC) AS rn
    FROM public.pcm_acl_snapshot_digest d
)
SELECT
  cur.taken_at                                   AS 最新時刻,
  prev.taken_at                                  AS 前一次時刻,
  (prev.digest IS NOT NULL AND cur.digest IS DISTINCT FROM prev.digest) AS 有漂移,
  (cur.approved_at IS NOT NULL)                  AS 最新這列已被批准,
  cur.row_count                                  AS 最新列數,
  prev.row_count                                 AS 前一次列數,
  -- 🔴 「哪一族變了」直接算出來 —— 收信的人第一個問題一定是這個
  -- 🔴 **沒有前一列時要印【沒有基線】, 不是印「全部都變了」**(codex R1):
  --    第一版在 prev IS NULL 時把八族全列出來, 而同一列的「有漂移」是 f
  --    ⇒ 同一列同時說「沒變」與「全變了」。**那不是保守, 那是自相矛盾。**
  -- 🔴 而 key 要走【兩邊的聯集】:只走 cur 的話, 一族【消失】了它不會出現在這裡
  --    (而消失正是最該叫的那一種)。
  CASE WHEN prev.digest IS NULL THEN '(沒有前一列可比)'
       ELSE (SELECT COALESCE(string_agg(k, ',' ORDER BY k), '')
               FROM (SELECT jsonb_object_keys(cur.families) AS k
                     UNION
                     SELECT jsonb_object_keys(prev.families)) u
              WHERE (cur.families -> u.k) IS DISTINCT FROM (prev.families -> u.k))
  END AS 變了的族,
  -- 🔴 太舊也是一種壞掉 —— 而它與「沒有漂移」印同一個 false, 所以要單獨一欄
  -- 🔴 門檻 **26 小時**不是 36(codex R1):每天 00:00 跑一次 ⇒ 正常最大年齡接近 24 小時。
  --    36 小時會讓【第一次漏跑】完全不出聲(01:00 時那列才 25 小時)。
  --    26 = 24 + 2 小時緩衝(與 `pcm-anomaly-alert` 的 26*60 同一個數, 同一個理由)。
  --    ⚠️ 而它與心跳那條路【各答一半】:心跳答「這支排程有沒有在跑」,
  --       這一格答「我手上這列夠不夠新到可以拿來比」。兩者可以一個綠一個紅。
  (cur.taken_at < now() - interval '26 hours') AS 最新這列太舊
FROM       (SELECT * FROM ranked WHERE rn = 1) cur
LEFT JOIN  (SELECT * FROM ranked WHERE rn = 2) prev ON true;

COMMENT ON VIEW public.pcm_acl_drift_status IS
  '⟦b9-ACLDRIFT5⟧ 片二:一列就答完「權限快照與上一次一不一樣」。'
  '🔴 security_invoker = true —— 讀它的人用【自己的權限】讀底表, 不是用 view 擁有者的。'
  '🛑 它答不出「有沒有人偷改」:兩個取樣時點之間改掉又改回來, 它印 false。'
  '🔵 有漂移 = true 而貼板當天 ⇒ 那是我們自己做的 ⇒ 標 approved_at, 不是關掉這道尺。';

REVOKE ALL ON public.pcm_acl_drift_status FROM PUBLIC;
REVOKE ALL ON public.pcm_acl_drift_status FROM anon;
REVOKE ALL ON public.pcm_acl_drift_status FROM authenticated;
REVOKE ALL ON public.pcm_acl_drift_status FROM payment_confirmer;
-- 🔵 只給 service_role SELECT —— 告警端要讀它。**不給整包。**
GRANT SELECT ON public.pcm_acl_drift_status TO service_role;

-- ── ③ 「更新基線」那一步(= 宣告「現在這樣是對的」)────────────
CREATE FUNCTION public.pcm_acl_approve_latest(p_note text)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $ap$
DECLARE
  v_t timestamptz;
BEGIN
  -- 🔴 理由是必填 —— 一個沒有理由的批准, 與「有人手滑按了」在事後長得一樣。
  -- 🔴 `btrim(text)` 預設只去【半形空白】(codex R1):tab / 換行 / NBSP(U+00A0)/
  --    零寬空白(U+200B)都會被當成「有寫理由」。⇒ 用正規式把所有空白類字元剝掉再判。
  IF p_note IS NULL OR regexp_replace(p_note, '[[:space:]\u00a0\u200b\u3000]', '', 'g') = '' THEN
    RAISE EXCEPTION 'pcm_acl_approve_latest:要寫理由(例:貼了 20260905130000, 那些差是它造成的)';
  END IF;
  UPDATE public.pcm_acl_snapshot_digest
     SET approved_at = now(), approved_note = btrim(p_note)
   WHERE taken_at = (SELECT max(taken_at) FROM public.pcm_acl_snapshot_digest)
  RETURNING taken_at INTO v_t;
  IF v_t IS NULL THEN
    RAISE EXCEPTION 'pcm_acl_approve_latest:一列快照都沒有 ⇒ 先讓 cron 跑一次, 或手動 SELECT public.pcm_acl_digest_record()';
  END IF;
  RETURN v_t;
END;
$ap$;

REVOKE ALL ON FUNCTION public.pcm_acl_approve_latest(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pcm_acl_approve_latest(text) FROM anon;
REVOKE ALL ON FUNCTION public.pcm_acl_approve_latest(text) FROM authenticated;
REVOKE ALL ON FUNCTION public.pcm_acl_approve_latest(text) FROM service_role, payment_confirmer;

COMMENT ON FUNCTION public.pcm_acl_approve_latest(text) IS
  '把最新那一列快照標成【已批准】。🔴 只有能連 DB 的人叫得動(四個應用角色四道 REVOKE 全收)。'
  '🛑 這是一個【決定】:你在宣告「現在這個權限樣子是對的」。理由必填。';

-- static-checks:no-grant-needed 本片新增的兩支物件裡, view 明寫了 GRANT SELECT TO service_role;
--   函式 pcm_acl_approve_latest 【刻意不給任何應用角色】—— 它是人在 SQL Editor 叫的,
--   不該有任何一條對外路徑碰得到它。

-- ── ④ 事後斷言 ────────────────────────────────────────────────
DO $$
DECLARE
  v_relations text[] := ARRAY[
    'public.pcm_acl_drift_status',
    'public.pcm_acl_approve_latest(text)'
  ]::text[];
  v_r    text;
  v_leak text[] := ARRAY[]::text[];
  v_t    timestamptz;
  v_n    integer;
BEGIN
  -- ④a 物件在
  IF to_regclass('public.pcm_acl_drift_status') IS NULL THEN
    RAISE EXCEPTION '斷言④a:view 沒建出來';
  END IF;
  IF to_regprocedure('public.pcm_acl_approve_latest(text)') IS NULL THEN
    RAISE EXCEPTION '斷言④a:approve 函式沒建出來';
  END IF;

  -- ④b 收權:四個角色對函式一格都不該有;view 只有 service_role 讀得到
  FOREACH v_r IN ARRAY ARRAY['anon','authenticated','service_role','payment_confirmer'] LOOP
    IF has_function_privilege(v_r, 'public.pcm_acl_approve_latest(text)', 'EXECUTE') THEN
      v_leak := v_leak || (v_r || '(approve)');
    END IF;
  END LOOP;
  FOREACH v_r IN ARRAY ARRAY['anon','authenticated','payment_confirmer'] LOOP
    IF has_table_privilege(v_r, 'public.pcm_acl_drift_status', 'SELECT') THEN
      v_leak := v_leak || (v_r || '(view)');
    END IF;
  END LOOP;
  IF array_length(v_leak, 1) IS NOT NULL THEN
    RAISE EXCEPTION '斷言④b:這些還有權限 ⇒ %', array_to_string(v_leak, ', ');
  END IF;

  -- ④c 🟢 負對照:service_role 【必須】讀得到 view。
  --     少了這一格, 一支恆回 false 的 has_table_privilege 會讓 ④b 永遠通過。
  IF NOT has_table_privilege('service_role', 'public.pcm_acl_drift_status', 'SELECT') THEN
    RAISE EXCEPTION '斷言④c:service_role 讀不到 view ⇒ 告警端拿不到訊號, 而 ④b 的綠沒有意義';
  END IF;

  -- ④d view 真的查得動, 而且恰好一列
  SELECT count(*) INTO v_n FROM public.pcm_acl_drift_status;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '斷言④d:view 回 % 列 —— 它的形狀是【永遠恰好一列】(沒有快照時也要有一列, 欄位為 NULL)', v_n;
  END IF;

  -- ④e approve 的「理由必填」真的擋得住(負對照:空字串要炸)
  BEGIN
    PERFORM public.pcm_acl_approve_latest('   ');
    RAISE EXCEPTION '斷言④e:空理由竟然通過了 ⇒ 那道檢查沒有判別力';
  EXCEPTION WHEN others THEN
    IF position('要寫理由' in SQLERRM) = 0 THEN
      RAISE EXCEPTION '斷言④e:炸了而不是因為理由必填 ⇒ %', SQLERRM;
    END IF;
  END;

  -- ④f approve 真的寫得進去(正對照), 而且回傳的是最新那一列的時刻
  -- 🔴🔴 **先重錄一次快照再批准**(codex 2026-09-05 R1 must-fix):
  --    本片自己【剛剛改了 ACL】(新增 view 與函式)⇒ 表上那一列是【改之前】的快照。
  --    直接批准它 = 替一份【不含本片改動】的內容蓋章, 而那個章會留在那裡。
  --    ⇒ 先 record 一次(upsert 會覆蓋今天那列), 批准的才是【現在這個世界】。
  PERFORM public.pcm_acl_digest_record();
  SELECT public.pcm_acl_approve_latest(
    '20260905170000 貼板後的第一次批准:這一列含本片新增的 view 與函式(事後斷言寫的)') INTO v_t;
  IF v_t IS NULL THEN
    RAISE EXCEPTION '斷言④f:approve 回 NULL';
  END IF;
  IF NOT (SELECT 最新這列已被批准 FROM public.pcm_acl_drift_status) THEN
    RAISE EXCEPTION '斷言④f:approve 寫了而 view 讀不到 ⇒ 兩邊看的不是同一列';
  END IF;
END $$;

COMMIT;
