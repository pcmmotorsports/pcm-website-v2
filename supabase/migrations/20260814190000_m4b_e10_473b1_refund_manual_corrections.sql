-- ============================================================
-- M-4b `#473b-1`:人工退款判定的更正出口(`order_refunds` 的 `manual_failed`)
-- ============================================================
-- 規格權威 = `docs/specs/2026-08-14-473b-1-correction-table-plan.md` **v2**
--            (§1 表結構 / §2 判定式層 / §2a 反向盤點 / §2b 機制四件 / §5 apply 前置閘 / §6 誠實缺口)
-- 拍板:Sean 2026-08-14 `Q-473-1 = A`(最新一筆說了算)、`Q-473-2 = A`(新開小表)。
--       plan v2 的批准來源:Sean 逐字「懶得看,你處理」把裁量權交回主視窗,主視窗據此批准。
--
-- ── 這支做什麼 ─────────────────────────────────────────────────────────────
-- 員工面只有一個動作:「修改這筆退款的人工判定」。
-- `order_refunds` **一個字都不動**(不動狀態機、不動 CHECK、不動既有欄)——
-- 更正寫進一張 append-only 的小表,舊列原樣留著當「我們曾經判錯」的證據。
--
-- ── 🔴 本片的一級交付物不是那張表,是「**沒有任何路能繞過更正拿到未更正的數**」───────
-- Sean 同意 A 案的前提就是這一條(plan §2b)。兌現方式**不是**「規定大家走新入口」——
-- 那種文字條款本 repo 復發過 9+ 次(memory `feedback_claimed-sync-but-only-patched-touched-lines`)。
-- 兌現方式是 §4:**把既有的 `pcm_order_refundable_remaining` 就地改對**(同簽章 CREATE OR REPLACE)。
--   ⇒ 反向盤點列出的 5 個讀取點(`refund-read.ts:103` / `refund-ledger-section.tsx:94` /
--     `refund-entry-gate.ts` / `scripts/a7c-rw1b-verify.sh:344` / `database.types.ts:3280`)
--     **一個字都不用改**就拿到更正後的數,而且**沒有第二支函式可以繞去**。
--
-- ⚠️ **「沒有繞路」這句要精確,不要讀成全稱句**(codex R2 抓到我原句過強,屬實):
--   成立的範圍 = **凡是問「帳本未登記額」的地方**。**不成立的地方有兩類、都已知**:
--   ① `admin_finalize_order_refund` 步 7 自己 SUM(下一段的 `#497`)。
--   ② **app 層自己聚合**:`refund-recovery-read.ts:119` 在 TS 裡 `reduce` 加總 confirmed 列
--      (= plan `§2a` 的 R12/R13,`§6-4` 有延後理由與承接點)。DB 側的扣減對它**完全無效**。
--   ⇒ 守門測試對這三處都有 allowlist;**再多一處會紅**。
--
-- ── 🔴 已知會漏、而且本片刻意不修的一條(plan §6-3,已立案 `#497`)────────────────
-- `20260803150000:776-779`(`admin_finalize_order_refund` 步 7)**自己 SUM** `status='confirmed'`
-- 決定 `orders.payment_status`,不呼叫本函式。一筆 `money_moved` 更正不會讓該列變 `confirmed`
-- ⇒ **`payment_status` 可能停在 `paid` 而錢已全退**,而 storefront `order-display.ts:49-50`
--   直接吃它 ⇒ **客人看到的是「處理中」**。改它 = 改 `payment_status` 的翻轉語意 = 另一個方向題,
--   要 Sean 拍 ⇒ **不在本片修**。這是「已知會對客人顯示錯」,不是「未來優化」。
--
-- ── 回退 ───────────────────────────────────────────────────────────────────
-- `scripts/473b1-down.sql`(整檔可貼進 Supabase Dashboard → SQL Editor、單一交易、零 psql 變數)。
-- `order_refunds` 無任何改動 ⇒ **沒有資料要回填**,這是選 A 案的主要理由之一。
-- 🔴 但 `DROP TABLE` 會連同已寫入的更正紀錄一起消失 ⇒ 該腳本第一段要求先 SELECT 存檔。
-- ============================================================

BEGIN;

-- 取 ACCESS EXCLUSIVE 的只有 CREATE(新物件、無人持鎖),但 FK 反向參照 `order_refunds`
-- 會取該表的鎖 ⇒ 照本 repo 慣例上 timeout,不讓本片在有長交易時無限期等待
-- 並把後面所有退款寫入排在後面。
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ══ 1. 更正表(append-only)══════════════════════════════════════════════════
-- 每一欄都對應到員工的一個動作(plan §1);**刻意沒有** `is_active` / `superseded_by` ——
-- 「哪一筆有效」由 `seq` 最大值決定(§2 的 view),多存一份布林 = 兩個真相來源會不同步。
CREATE TABLE public.order_refund_manual_corrections (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 他在哪一列按「修改判定」。FK 到 order_refunds(不是 orders)—— 更正的對象是「那一筆退款」。
  refund_id    uuid        NOT NULL REFERENCES public.order_refunds(id),

  -- 「最新一筆說了算」的排序權威(Sean Q-473-1=A)。
  -- 🔴 **刻意不用 created_at 排序**:同交易內 now() 是同一個值,兩筆會平手而排不出先後。
  --    形狀沿用姊妹線 `20260812140000:682` 的 `(refund_id, seq)` 唯一序。
  seq          integer     NOT NULL CHECK (seq > 0),

  -- 他把判定改成什麼。
  -- 🔴 值域**刻意不是** failed_reason 的三碼(逐字列在 `20260803150000:181`,注意那是
  --    `failed_detail` 欄的 COMMENT、不是 `failed_reason` 自己的):那三碼答「系統為什麼失敗」,
  --    本欄答「**人判定錢有沒有動**」。共用值域會讓下游以為可以拿它去 SET failed_reason ——
  --    那正是被 Q-473-2 否掉的 C 案。
  corrected_to text        NOT NULL CHECK (corrected_to IN ('money_moved', 'no_money_moved')),

  -- 他為什麼改。稽核第一個問的就是這個 ⇒ 不接受空字串。
  -- 🔴 `btrim(x)` 單參數**只剝一般空格**(codex 關卡2 must-fix,開檔查證屬實)⇒ 只放換行或 Tab
  --    會通過而寫進金流稽核。必須明列字集。長度上限一併給:沒有上限,超長輸入會一路撞到
  --    底層索引才以看不懂的錯誤失敗(對齊 order_refunds.failed_detail 的 ≤500 慣例)。
  reason       text        NOT NULL
                           CHECK (btrim(reason, E' \t\r\n') <> '')
                           CHECK (char_length(reason) <= 500),

  -- 誰改的。值域逐字對齊本線 RW4(`20260803150000:454-455`),**刻意不抄**姊妹線的
  -- `public.staff` 查表 —— 同一個員工不該在同一條退款線的兩支 RPC 一支過一支不過。
  -- 🔁 **重估觸發點:E8-B 真認證線上線**(actor 語意從「自填字串」變成「登入身分」時本理由失效)。
  actor        text        NOT NULL CHECK (actor ~ '^[a-z0-9_]{1,64}$'),

  -- 他手滑連按兩次時的冪等鍵(對齊 order_refunds.request_id 既有慣例)。
  -- 🔴 同上:字集要明列,並給長度上限(冪等鍵是機器產的,64 綽綽有餘)。
  request_id   text        NOT NULL
                           CHECK (btrim(request_id, E' \t\r\n') <> '')
                           CHECK (char_length(request_id) <= 64),

  created_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT order_refund_manual_corrections_refund_seq_key UNIQUE (refund_id, seq),
  CONSTRAINT order_refund_manual_corrections_request_id_key UNIQUE (request_id)
);

COMMENT ON TABLE public.order_refund_manual_corrections IS
  '#473b-1:對 order_refunds 人工判定(failed/manual_failed)的更正,append-only、一次更正一列。'
  '🔴 本表**不改動 order_refunds 任何欄位**,包括 status —— 舊列原樣留著當「我們曾經判錯」的證據。'
  '🔴 語意 = Sean Q-473-1=A「最新一筆說了算」:有效更正 = 同一 refund_id 內 seq 最大的那筆,'
  '由 order_refund_effective_verdict view 認定;**讀取面一律消費該 view,不得自己問「有沒有更正」**。'
  '⚠️ corrected_to=money_moved **不會**讓該筆退款變成 confirmed(狀態機三終態轉出一律 RAISE)——'
  '它的實際效果只有兩個:pcm_order_refundable_remaining 會扣掉它、畫面看得出判錯過。帳上金額不變。';

COMMENT ON COLUMN public.order_refund_manual_corrections.seq IS
  '同一 refund_id 內的遞增序;最大值 = 現行有效更正。刻意不用 created_at 排序(同交易 now() 平手)。';
COMMENT ON COLUMN public.order_refund_manual_corrections.corrected_to IS
  'money_moved = 人重新判定「錢其實有動」;no_money_moved = 維持「錢沒有動」。'
  '🔴 與 order_refunds.failed_reason 的三碼是不同的值域,不得互相代換。';

-- ── ACL:表只開 service_role ────────────────────────────────────────────────
-- 🔴 逐角色收:本 repo 有 `pg_default_acl` 對具名角色預設授權的案底
--    (`20260814140000` 檔尾實查),`REVOKE … FROM PUBLIC` 收不掉那種。
REVOKE ALL ON public.order_refund_manual_corrections FROM PUBLIC;
REVOKE ALL ON public.order_refund_manual_corrections FROM anon, authenticated;
-- 🔴🔴 **`service_role` 也要先 REVOKE**,理由與**來源**分開講(換模型審查 must-fix 5 更正我的字面):
--    ⚠️ 我原本寫「pg_default_acl 給 service_role 全套八項(實測)」—— **那個「實測」量的是我們
--       自己手寫的 shim**(`scripts/d1-supabase-shim.sql:50` 逐字
--       `ALTER DEFAULT PRIVILEGES … GRANT ALL ON TABLES TO anon, authenticated, service_role`),
--       **不是正式庫**。本 repo 唯一一次正式庫實查在 `20260814140000:142`,逐字只列
--       `anon=arwdDxtm, authenticated=arwdDxtm` —— **`service_role` 沒出現、未確認**。
--    ⇒ 事實口徑:**正式庫的 defacl 至少給 anon/authenticated 全套;service_role 未確認。**
--       不論哪一種,**先收乾淨再給** 都是對的,而且不依賴我對 defacl 的假設。
--    🔴 **改成動態收權**:枚舉 relacl 裡所有非 owner 的 grantee 逐一 REVOKE ALL。
--       這樣**不管正式庫的 defacl 給了誰**(包括我沒預料到的第四個角色),結果都一樣;
--       原本寫死三個角色名的版本會在「正式庫多一個 grantee」時讓 5e 斷言當場 RAISE、整支退回,
--       而本機恆綠(= 只有上線那天才會發現)。
REVOKE ALL ON public.order_refund_manual_corrections FROM PUBLIC, anon, authenticated, service_role;
DO $revoke_all$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT a.grantee::regrole::text AS who, c.relname
      FROM pg_class c
      JOIN LATERAL aclexplode(c.relacl) a ON true
     WHERE c.oid = 'public.order_refund_manual_corrections'::regclass
       AND a.grantee <> c.relowner AND a.grantee <> 0
  LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM %I', r.relname, r.who);
  END LOOP;
END
$revoke_all$;
-- 🔴🔴 **只給 SELECT、不給 INSERT**(codex 關卡2 must-fix;我認同,而且這條是全部裡最重要的):
--    後台是拿 `service_role` 走 PostgREST 的。給了 INSERT 就等於**任何一條 server 路徑都能直接
--    塞一筆 seq 很大的更正進來** —— 繞過 G4 父列鎖、G5 目標檢查、G6b CAS、G8 稽核,
--    而它照樣會被 `pcm_order_refundable_remaining` 扣進「還能退多少」。
--    ⇒ 那正是 Sean 同意本案的**前提條件**(「沒有任何路能繞過更正」)被打穿的地方。
--    寫入的唯一入口 = 下面那支 SECURITY DEFINER RPC(它以 owner 身分寫,不吃本行的授權)。
GRANT SELECT ON public.order_refund_manual_corrections TO service_role;

-- 🔴 RLS:同族金流表一律開(`order_refunds` `20260725130100:318` / `admin_audit_log`
--    `20260712210000:82` / `payment_refunds` `20260810140000:150`)。**本片原本零命中**,
--    是換模型審查抓到的 —— 而且斷言區只查 `relacl` 不查 `relrowsecurity` ⇒ 這一層缺席**沒有一格會紅**。
--    不建 policy = 預設拒絕(`service_role` 走 BYPASSRLS,不受影響);ACL 是第一道、RLS 是縱深。
ALTER TABLE public.order_refund_manual_corrections ENABLE ROW LEVEL SECURITY;

-- ══ 2. 有效更正 view(判定式的唯一所在;plan §2)═════════════════════════════
-- 🔴 判定式放 DB 不放 TS 的理由(plan §2,三條都可查證):
--   ① 讀者已經有兩處(refund-read.ts / refund-ledger-section.tsx),
--      `refund-ledger-view.ts:1-2` 檔頭逐字「兩處各養一份 label 就是下一個漂移點」;
--   ② `#445b` 的佔額度判準在 DB 層 ⇒ TS 投影吃不到,只寫 TS 就保證要養兩份;
--   ③ PostgREST 可直接 select view ⇒ 讀取端零額外邏輯。
-- ⚠️ **RPC 內不做判定**:RPC 只 append + 守門,「哪一筆有效」全部交給本 view。
CREATE VIEW public.order_refund_effective_verdict
WITH (security_invoker = true) AS
SELECT DISTINCT ON (c.refund_id)
       c.refund_id,
       c.id           AS correction_id,
       c.seq,
       c.corrected_to,
       c.reason,
       c.actor,
       c.created_at
  FROM public.order_refund_manual_corrections c
 ORDER BY c.refund_id, c.seq DESC;

COMMENT ON VIEW public.order_refund_effective_verdict IS
  '#473b-1:每筆 refund 現行有效的人工判定更正(seq 最大者)。Sean Q-473-1=A「最新一筆說了算」。'
  '🔴 **所有讀取面一律消費本 view**,不得再自己對 order_refund_manual_corrections 取 max(seq)。'
  '🔴 沒有更正過的 refund **不會出現在本 view**(不是回一列 NULL)⇒ 消費端用 LEFT JOIN、不要用 INNER。';

REVOKE ALL ON public.order_refund_effective_verdict FROM PUBLIC;
REVOKE ALL ON public.order_refund_effective_verdict FROM anon, authenticated;
-- 🔴 同上:view 也吃 `pg_default_acl` 的全套預設授權,不先 REVOKE 的話 service_role
--    對 view 也會有 INSERT/UPDATE/DELETE(可更新 view 的寫入會穿透到底表)。
REVOKE ALL ON public.order_refund_effective_verdict FROM service_role;
GRANT SELECT ON public.order_refund_effective_verdict TO service_role;

-- ══ 3. 更正 RPC(員工面唯一動作「修改判定」)════════════════════════════════
-- 守門形制抄姊妹 `admin_correct_refund_manual_verdict`(`20260812140000:572-724`)的**形狀**,
-- **不是抄那支函式** —— 它動的是 payment_refund_events,與本線無關。
CREATE FUNCTION public.admin_correct_order_refund_verdict(
  p_refund_id              uuid,
  p_expected_correction_id uuid,
  p_actor                  text,
  p_reason                 text,
  p_corrected_to           text,
  p_request_id             text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $rmc$
DECLARE
  v_actor   text;
  v_reason  text;
  v_req     text;
  v_locked  uuid;
  v_status  text;
  v_freason text;
  v_order   uuid;
  v_cur_id  uuid;
  v_seq     integer;
  v_new_id  uuid;
  v_dup     uuid;
  v_dup_refund uuid;
  v_n       integer;
BEGIN
  -- ── G1 隔離閘(排最前)──────────────────────────────────────────────────
  -- 本支的「最新一筆說了算 + CAS」靠的是「父列鎖 + 鎖後重讀看得到兄弟已提交的列」。
  -- REPEATABLE READ 下取得鎖之後快照**仍看不到**兄弟剛提交的更正 ⇒ CAS 拿舊值比對而放行
  -- ⇒ 兩筆更正互相沖掉。本 repo 對這個形狀有實測案底(A2b1 的 P2B02)。
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'admin_correct_order_refund_verdict:必須在 read committed 下呼叫(實際=%)⇒ '
                    'RR 快照看不到兄弟已提交的更正,CAS 會失效',
                    pg_catalog.current_setting('transaction_isolation')
      USING ERRCODE = 'P8C01', CONSTRAINT = 'pcm_rmc_isolation';
  END IF;

  -- ── G2 actor:排在**任何資料讀取之前**(身分錯的呼叫拿不到任何帳本資訊)──────
  v_actor := pg_catalog.btrim(coalesce(p_actor, ''));
  IF v_actor !~ '^[a-z0-9_]{1,64}$' THEN
    RAISE EXCEPTION 'admin_correct_order_refund_verdict:經手人代號格式不符(需 ^[a-z0-9_]{1,64}$)'
      USING ERRCODE = 'P2B42', CONSTRAINT = 'pcm_rmc_actor_invalid';
  END IF;

  -- ── G3 輸入驗 ────────────────────────────────────────────────────────────
  IF p_refund_id IS NULL THEN
    RAISE EXCEPTION 'admin_correct_order_refund_verdict:退款識別碼必填'
      USING ERRCODE = 'P2B42', CONSTRAINT = 'pcm_rmc_identity_missing';
  END IF;
  -- 🔴 值域在這裡具名拒一次(CHECK 也會擋,但那是縱深;這裡才講得清楚是哪個參數錯)。
  IF p_corrected_to IS NULL OR p_corrected_to NOT IN ('money_moved', 'no_money_moved') THEN
    RAISE EXCEPTION 'admin_correct_order_refund_verdict:新判定必須是 money_moved 或 no_money_moved(收到 [%])',
                    coalesce(p_corrected_to, '(NULL)')
      USING ERRCODE = 'P2B42', CONSTRAINT = 'pcm_rmc_verdict_invalid';
  END IF;
  -- 🔴 字集必須明列(codex 關卡2):`btrim(x)` 只剝一般空格 ⇒ 只送換行/Tab 會被當成有效理由。
  v_reason := pg_catalog.btrim(coalesce(p_reason, ''), E' \t\r\n');
  IF v_reason = '' THEN
    RAISE EXCEPTION 'admin_correct_order_refund_verdict:修改理由必填'
                    '(錢帳上「為什麼把判定改掉」是稽核第一個問題)'
      USING ERRCODE = 'P2B42', CONSTRAINT = 'pcm_rmc_reason_required';
  END IF;
  v_req := pg_catalog.btrim(coalesce(p_request_id, ''), E' \t\r\n');
  IF v_req = '' THEN
    RAISE EXCEPTION 'admin_correct_order_refund_verdict:request_id 必填(手滑連按兩次的冪等鍵)'
      USING ERRCODE = 'P2B42', CONSTRAINT = 'pcm_rmc_request_id_required';
  END IF;

  -- ── G4 鎖父列(序列化點)──────────────────────────────────────────────────
  -- 🔴 **必須 FOR NO KEY UPDATE**:本表對 order_refunds 有 FK ⇒ 下面的 INSERT 會取父列
  --    KEY SHARE;FOR UPDATE 與 KEY SHARE 是 A2b1 已實測過的 40P01 死結形狀
  --    (memory `project_m4b-a2b1-guard-decisions`)。
  SELECT r.id, r.status, r.failed_reason, r.order_id
    INTO v_locked, v_status, v_freason, v_order
    FROM public.order_refunds r
   WHERE r.id = p_refund_id
     FOR NO KEY UPDATE;

  IF v_locked IS NULL THEN
    RAISE EXCEPTION 'admin_correct_order_refund_verdict:找不到退款(%)⇒ 取不到序列化點,拒絕寫入',
                    p_refund_id
      USING ERRCODE = 'P8C03', CONSTRAINT = 'pcm_rmc_parent_row_required';
  END IF;

  -- ── G5 鎖後重讀:只有「卡住的人工判定列」可以被更正 ─────────────────────────
  -- 值域權威 = `20260803150000:760`(RW4 出口 `SET status='failed', failed_reason='manual_failed'`)。
  IF v_status <> 'failed' OR v_freason IS DISTINCT FROM 'manual_failed' THEN
    RAISE EXCEPTION 'admin_correct_order_refund_verdict:退款 % 現況 status=% / failed_reason=% ⇒ '
                    '本支只更正人工判定(failed + manual_failed);其他狀態要改請走對帳流程',
                    p_refund_id, v_status, coalesce(v_freason, '(NULL)')
      USING ERRCODE = 'P2B44', CONSTRAINT = 'pcm_rmc_target_not_manual_failed';
  END IF;

  -- ── G6a 冪等:同一 request_id 已寫過 ⇒ 回 DUPLICATE,不當成錯誤 ──────────────
  -- 已持父列鎖 ⇒ 這個讀取看得到兄弟已提交的列(G1 保證 read committed)。
  -- UNIQUE(request_id) 是後盾;這裡先答是為了讓「手滑連按兩次」拿到人話而不是 23505。
  -- 🔴 **必須連 refund_id 一起核**(codex 關卡2 must-fix,我認同):`request_id` 是**全域唯一**,
  --    只比對 token 的話,同一個 token 被誤用在**另一筆退款**上時,本支會回一個
  --    「DUPLICATE_REQUEST + 別筆退款的 correction_id」—— 呼叫端會把它讀成「這筆已經更正成功了」,
  --    而事實是這筆**一個字都沒寫**。那是靜默的假成功,比報錯嚴重。
  SELECT c.id, c.refund_id INTO v_dup, v_dup_refund
    FROM public.order_refund_manual_corrections c
   WHERE c.request_id = v_req;

  IF v_dup IS NOT NULL AND v_dup_refund = p_refund_id THEN
    -- 真的是同一筆的重播 ⇒ 冪等回應
    RETURN pg_catalog.jsonb_build_object(
      'result', 'DUPLICATE_REQUEST', 'refund_id', p_refund_id, 'correction_id', v_dup);
  END IF;
  IF v_dup IS NOT NULL THEN
    -- token 撞到別筆退款 ⇒ **拒絕**,不假裝成功(fail-closed)
    RAISE EXCEPTION 'admin_correct_order_refund_verdict:request_id [%] 已被退款 % 用過,'
                    '不能再用於退款 % ⇒ 拒絕(冪等鍵全域唯一;請換一把新的)',
                    v_req, v_dup_refund, p_refund_id
      USING ERRCODE = 'P2B44', CONSTRAINT = 'pcm_rmc_request_id_reused';
  END IF;
  -- ⚠️ **誠實邊界**:本檢查在父列鎖之下,但 `request_id` 的唯一性是**全域**的、不受該鎖序列化。
  --    兩個交易對**不同** refund 同時用同一把 token 時,兩邊都查無重複 ⇒ 後到者撞 UNIQUE 得 23505。
  --    方向是 fail-closed(不會寫壞、不會假成功),呼叫端把 23505 +
  --    `order_refund_manual_corrections_request_id_key` 當成「換一把 token 重試」處理。

  -- ── G6b CAS:現行有效更正 ≠ 呼叫端看到的那筆 ⇒ 拒(併發正確性的本體)────────
  -- 🔴 `p_expected_correction_id` **可為 NULL**,語意 = 「我看到的是尚未被更正過」。
  --    ⇒ 必須用 IS DISTINCT FROM;用 <> 的話 NULL 比較回 NULL、整個 IF 不成立 = 這道閘失效。
  SELECT v.correction_id INTO v_cur_id
    FROM public.order_refund_effective_verdict v
   WHERE v.refund_id = p_refund_id;

  IF v_cur_id IS DISTINCT FROM p_expected_correction_id THEN
    RAISE EXCEPTION 'admin_correct_order_refund_verdict:你看到的更正(%)已經不是現行更正(%)⇒ '
                    '期間有人改過,請重新讀取後再送出',
                    coalesce(p_expected_correction_id::text, '(尚未更正)'),
                    coalesce(v_cur_id::text, '(尚未更正)')
      USING ERRCODE = 'P2B44', CONSTRAINT = 'pcm_rmc_cas_mismatch';
  END IF;

  -- ── G7 寫入一列 + row_count 守 ────────────────────────────────────────────
  -- 姊妹線寫兩列(沖銷 + 新判定)是因為它的舊列會擋唯一索引;本片舊列本來就不動,
  -- **一列就夠**,不為了對稱而多寫一列。
  SELECT coalesce(pg_catalog.max(c.seq), 0) INTO v_seq
    FROM public.order_refund_manual_corrections c
   WHERE c.refund_id = p_refund_id;

  INSERT INTO public.order_refund_manual_corrections
         (refund_id, seq, corrected_to, reason, actor, request_id)
  VALUES (p_refund_id, v_seq + 1, p_corrected_to, v_reason, v_actor, v_req)
  RETURNING id INTO v_new_id;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'admin_correct_order_refund_verdict:更正列落 % 列(期望恰 1)⇒ '
                    '可能有 BEFORE INSERT trigger 把它吃掉了', v_n
      USING ERRCODE = 'P2B43', CONSTRAINT = 'pcm_rmc_row_count';
  END IF;

  -- ── G8 同交易稽核(after 取自實際寫入值,不是參數)──────────────────────────
  INSERT INTO public.admin_audit_log
         (actor, action, target, before, after, reason, request_id, source_app)
  VALUES (v_actor, 'order_refund.correct_verdict', 'order:' || v_order::text,
          pg_catalog.jsonb_build_object('effective_correction_id', v_cur_id),
          pg_catalog.jsonb_build_object('refund_id', p_refund_id,
                                        'correction_id', v_new_id,
                                        'seq', v_seq + 1,
                                        'corrected_to', p_corrected_to),
          v_reason, v_req, 'admin');

  -- 🔴 稽核也要 row_count 守(codex 關卡2 must-fix;G7 有、G8 漏了就是不對稱):
  --    `admin_audit_log` 上若有 BEFORE INSERT trigger 把列吃掉,更正照樣提交而**稽核憑空消失** ——
  --    金流帳上「誰改的」不見了,而畫面完全正常。
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'admin_correct_order_refund_verdict:稽核列落 % 列(期望恰 1)⇒ '
                    '更正不得在沒有稽核的情況下成立,整筆回滾', v_n
      USING ERRCODE = 'P2B43', CONSTRAINT = 'pcm_rmc_row_count_audit';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'result',        'CORRECTED',
    'refund_id',     p_refund_id,
    'correction_id', v_new_id,
    'seq',           v_seq + 1,
    'corrected_to',  p_corrected_to);
END
$rmc$;

COMMENT ON FUNCTION public.admin_correct_order_refund_verdict(uuid, uuid, text, text, text, text) IS
  '#473b-1:更正 order_refunds 的人工判定(SECURITY DEFINER、search_path='''')。'
  'append 一列到 order_refund_manual_corrections;**order_refunds 舊列一個字都不動**。'
  '八道:G1 隔離閘 P8C01 → G2 actor regex(排在任何資料讀取前)P2B42 → G3 輸入驗 →'
  'G4 鎖父列 FOR NO KEY UPDATE(FOR UPDATE 與 FK KEY SHARE 死結,A2b1 實測 40P01)→'
  'G5 鎖後重讀(只有 failed+manual_failed 可更正)→ G6a 冪等 request_id 回 DUPLICATE_REQUEST →'
  'G6b **CAS** p_expected_correction_id(可為 NULL=「我看到的是尚未更正」,故用 IS DISTINCT FROM)→'
  'G7 寫入 + row_count 守 → G8 同交易稽核。'
  '🔴 回傳 result ∈ {CORRECTED, DUPLICATE_REQUEST};其餘一律 RAISE,呼叫端不得把未知碼當成功。'
  '⚠️ corrected_to=money_moved **不會**讓該筆變 confirmed —— 它的效果是'
  'pcm_order_refundable_remaining 會扣掉它、以及畫面看得出判錯過。orders.payment_status 不受影響(#497)。';

-- 🔴 連 `authenticator` 一起收(姊妹 `20260812140000:345` 的形狀);
--    表側已是全枚舉、函式側原本只收三個角色 = 不對稱,第四個角色拿到 EXECUTE 不會被任何一格擋。
REVOKE ALL ON FUNCTION public.admin_correct_order_refund_verdict(uuid, uuid, text, text, text, text)
  FROM PUBLIC, anon, authenticated, authenticator;
GRANT EXECUTE ON FUNCTION public.admin_correct_order_refund_verdict(uuid, uuid, text, text, text, text)
  TO service_role;

-- ══ 4. 🔴 機制本體:把既有那支就地改對(plan §2b-1)═══════════════════════════
-- **簽章一個字不動** ⇒ 反向盤點列出的 5 個讀取點零改動就拿到更正後的數,
-- 而且**沒有第二支函式可以繞去** —— 這不是「規定所有讀取走新入口」,是舊入口本身變正確。
-- 🔴 用 `CREATE OR REPLACE` 而非 DROP+CREATE:後者會把 ACL 洗回預設、COMMENT 消失
--    (本檔 §5-5d 對此有負向斷言;`20260803150000:105`/`:984` 對同一支有指紋斷言的舊傷即此)。
-- 🔴 兩段 SUM **值域互斥不會重複扣**:第一段只吃 processing/confirmed,第二段只吃 failed。
CREATE OR REPLACE FUNCTION public.pcm_order_refundable_remaining(p_order_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT o.total::bigint
       - COALESCE(
           (SELECT SUM(r.refund_amount)
              FROM public.order_refunds r
             WHERE r.order_id = o.id
               AND r.status IN ('processing', 'confirmed')), 0)
       - COALESCE(
           (SELECT SUM(r.refund_amount)
              FROM public.order_refunds r
              JOIN public.order_refund_effective_verdict v ON v.refund_id = r.id
             WHERE r.order_id = o.id
               AND r.status = 'failed'
               AND r.failed_reason = 'manual_failed'
               AND v.corrected_to = 'money_moved'), 0)
    FROM public.orders o
   WHERE o.id = p_order_id;
$$;

COMMENT ON FUNCTION public.pcm_order_refundable_remaining(uuid) IS
  'A7c 顯示用(RW1a 改版;#473b-1 再改版):orders.total 減去本帳本已登記(processing + confirmed)的退款金額,'
  '**再減去「人工判定為沒動錢、但事後被更正成 money_moved」的 failed 列**(#473b-1)。'
  'deferred 與未被更正的 failed 不佔額度。🔴 兩段 SUM 值域互斥(processing/confirmed vs failed)⇒ 不會重複扣。'
  '🔴 第一段仍為 allowlist:**未來新增任何 status 值預設不佔額度 —— 新增狀態時必須回訪本函式**。'
  '🔴 不是守門、沒有 trigger 讀它(拍板⑤);只反映本帳本,Portal 場外退款不在其中 ⇒ 真實剩餘額 ≤ 本值;'
  'UI 措辭必須是「帳本未登記額」不得寫「還能退多少」。查無訂單回 NULL。'
  '🔴 **本函式是「還能退多少」的唯一算式**(#473b-1 plan §2b-1)。'
  '⚠️ 繞過它自己聚合的地方**有兩類、都已知且都不在本片修**:'
  '① admin_finalize_order_refund 步 7 自己 SUM 決定 payment_status(已立案 #497);'
  '② **app 層**:refund-recovery-read.ts 在 TS 裡 reduce 加總 confirmed 列(plan §2a 的 R12/R13、§6-4 有承接點)。'
  '守門測試對這三處都有 allowlist,再多一處會紅。';

-- ══ 5. apply 當下的斷言(正負都要;plan §5)═════════════════════════════════
DO $assert$
DECLARE
  v_ok  boolean;
  v_cnt integer;
BEGIN
  -- 5a 表/view 都在
  SELECT to_regclass('public.order_refund_manual_corrections') IS NOT NULL
     AND to_regclass('public.order_refund_effective_verdict')  IS NOT NULL INTO v_ok;
  IF NOT v_ok THEN
    RAISE EXCEPTION '#473b-1 斷言失敗 — 表或 view 未建立;拒繼續';
  END IF;

  -- 5b ACL 正:service_role 可執行兩支函式
  SELECT has_function_privilege('service_role',
           'public.admin_correct_order_refund_verdict(uuid,uuid,text,text,text,text)', 'EXECUTE')
     AND has_function_privilege('service_role',
           'public.pcm_order_refundable_remaining(uuid)', 'EXECUTE') INTO v_ok;
  IF NOT v_ok THEN
    RAISE EXCEPTION '#473b-1 斷言失敗 — service_role 應可執行更正 RPC 與 remaining;拒繼續';
  END IF;

  -- 5c ACL 負:anon/authenticated/PUBLIC 都不可(**只跑正的 = 恆綠格**)
  SELECT count(*) INTO v_cnt
    FROM (VALUES ('anon'), ('authenticated'), ('public')) AS x(r)
   WHERE has_function_privilege(x.r,
           'public.admin_correct_order_refund_verdict(uuid,uuid,text,text,text,text)', 'EXECUTE');
  IF v_cnt > 0 THEN
    RAISE EXCEPTION '#473b-1 斷言失敗 — 更正 RPC 不應可被 PUBLIC/anon/authenticated 執行(% 個角色可);拒繼續', v_cnt;
  END IF;

  -- 5d 🔴 `CREATE OR REPLACE` 沒有把 remaining 的 ACL 洗掉(這正是「以為會保留」該被量一次的地方)
  SELECT count(*) INTO v_cnt
    FROM (VALUES ('anon'), ('authenticated'), ('public')) AS x(r)
   WHERE has_function_privilege(x.r, 'public.pcm_order_refundable_remaining(uuid)', 'EXECUTE');
  IF v_cnt > 0 THEN
    RAISE EXCEPTION '#473b-1 斷言失敗 — remaining 的 ACL 被 CREATE OR REPLACE 洗掉了(% 個角色可執行);拒繼續', v_cnt;
  END IF;

  -- 5e-0 🔴 **欄級授權也要看**(codex R2 must-fix,屬實):`relacl` 只記表級;
  --      `GRANT INSERT(col) ON tbl TO service_role` 落在 `pg_attribute.attacl`,
  --      表級枚舉**完全看不到它** ⇒ 欄級寫入權可以繞過 RPC 而本斷言維持綠。
  SELECT count(*) INTO v_cnt
    FROM pg_attribute a
    JOIN LATERAL aclexplode(a.attacl) x ON true
   WHERE a.attrelid IN ('public.order_refund_manual_corrections'::regclass,
                        'public.order_refund_effective_verdict'::regclass)
     AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_cnt > 0 THEN
    RAISE EXCEPTION '#473b-1 斷言失敗 — 更正表/view 有 % 筆**欄級**授權(attacl);'
                    '本片不使用欄級授權,出現即代表有人開了繞過 RPC 的寫入路徑;拒繼續', v_cnt;
  END IF;

  -- 5e 🔴 表/view 的 ACL:**逐權限 × 逐角色全枚舉**,不是只問 anon/authenticated 的 SELECT
  --    (codex 關卡2 must-fix,我認同:原版只問一個權限一種角色 ⇒ UPDATE / DELETE / TRUNCATE
  --     或第四個角色的殘留授權會整批溜過去,而那是**能改金流稽核**的權限)。
  --    判準:除了 owner 之外,`relacl` 裡**只准出現** service_role 的 SELECT,一筆都不能多。
  SELECT count(*) INTO v_cnt
    FROM pg_class c
    JOIN LATERAL aclexplode(c.relacl) a ON true
   WHERE c.oid IN ('public.order_refund_manual_corrections'::regclass,
                   'public.order_refund_effective_verdict'::regclass)
     AND a.grantee <> c.relowner
     AND NOT (a.grantee = 'service_role'::regrole::oid AND a.privilege_type = 'SELECT');
  IF v_cnt > 0 THEN
    RAISE EXCEPTION '#473b-1 斷言失敗 — 更正表/view 的 relacl 有 % 筆非「service_role 的 SELECT」的授權;'
                    '本片只准 service_role 讀,寫入唯一入口是 SECDEF RPC;拒繼續', v_cnt;
  END IF;

  -- 5f-1 🔴 正向對照(缺這格,上面那條在「relacl 全空」時也會過 = 空白假通過):
  --     service_role 必須**讀得到**。
  IF NOT has_table_privilege('service_role', 'public.order_refund_manual_corrections', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.order_refund_effective_verdict', 'SELECT') THEN
    RAISE EXCEPTION '#473b-1 斷言失敗 — service_role 讀不到更正表或 view(後台會整頁壞);拒繼續';
  END IF;

  -- 5g 🔴🔴 本片最重要的不變量:**service_role 不得有 INSERT/UPDATE/DELETE**。
  --     有了任一個,就有一條繞過 RPC 全部守門的寫入路徑,而 Sean 同意本案的前提正是「沒有繞路」。
  SELECT count(*) INTO v_cnt
    FROM (VALUES ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) AS p(t)
   WHERE has_table_privilege('service_role', 'public.order_refund_manual_corrections', p.t);
  IF v_cnt > 0 THEN
    RAISE EXCEPTION '#473b-1 斷言失敗 — service_role 對更正表有 % 種寫入權限 ⇒ '
                    '存在繞過 RPC 守門的直接寫入路徑;拒繼續', v_cnt;
  END IF;

  -- 5g-2 🔴 RLS 有開(換模型審查 must-fix 2:同族金流表都有,而本片原本零命中,
  --      且斷言只查 relacl ⇒ 這一層缺席沒有任何一格會紅)
  SELECT c.relrowsecurity INTO v_ok FROM pg_class c
   WHERE c.oid = 'public.order_refund_manual_corrections'::regclass;
  IF NOT v_ok THEN
    RAISE EXCEPTION '#473b-1 斷言失敗 — 更正表未開 RLS(同族金流表一律開);拒繼續';
  END IF;

  -- 5g-3 🔴 view 的 security_invoker = true(換模型審查 consider 10;姊妹 20260812140000:808-810
  --      逐字:沒有它 view 會以 owner 身分求值 = 在零 GRANT 的底表上開了一條旁路)
  SELECT EXISTS (SELECT 1 FROM pg_class c
                  WHERE c.oid = 'public.order_refund_effective_verdict'::regclass
                    AND c.reloptions @> ARRAY['security_invoker=true']) INTO v_ok;
  IF NOT v_ok THEN
    RAISE EXCEPTION '#473b-1 斷言失敗 — view 未設 security_invoker=true ⇒ 會以 owner 身分求值,'
                    '等於在零 GRANT 的底表上開旁路;拒繼續';
  END IF;

  -- 5g-4 🔴 函式側 ACL **全枚舉**(不是抽樣三個角色;姊妹 20260812140000:887-888 的形狀)。
  --      除 owner 外只准 service_role 的 EXECUTE,且**不得帶 grant option**。
  SELECT count(*) INTO v_cnt
    FROM pg_proc pr
    JOIN LATERAL aclexplode(pr.proacl) a ON true
   WHERE pr.oid = 'public.admin_correct_order_refund_verdict(uuid,uuid,text,text,text,text)'::regprocedure
     AND a.grantee <> pr.proowner
     AND NOT (a.grantee = 'service_role'::regrole::oid
              AND a.privilege_type = 'EXECUTE' AND NOT a.is_grantable);
  IF v_cnt > 0 THEN
    RAISE EXCEPTION '#473b-1 斷言失敗 — 更正 RPC 的 proacl 有 % 筆非「service_role 的無 grant-option EXECUTE」;拒繼續', v_cnt;
  END IF;

  -- 5g-5 🔴🔴 **真的呼叫一次**(換模型審查 must-fix 4:我自己在 plan §2b-3 寫下
  --      「動 plpgsql 的片,apply 斷言之外必須有一次真的呼叫」,卻沒套回自己的 migration)。
  --      理由就是本片親身踩過的:`pg_catalog.coalesce` 不存在,但 plpgsql 本體 CREATE 時不求值
  --      ⇒ 套用成功、上面每一格斷言全過,**第一個按下去的員工才爆**。
  PERFORM public.pcm_order_refundable_remaining(NULL);   -- 純 SQL 函式,查無訂單回 NULL

  -- 更正 RPC:用一個**不存在的 refund_id** 呼叫,期望走到 G4 的 P8C03(取不到父列)。
  -- 走到 P8C03 就代表 G1/G2/G3 三段本體都**真的執行過**了(它們排在 G4 之前)。
  BEGIN
    PERFORM public.admin_correct_order_refund_verdict(
      '00000000-0000-0000-0000-000000000000'::uuid, NULL,
      'apply_selftest', 'apply 自檢', 'no_money_moved', 'apply_selftest_probe');
    RAISE EXCEPTION '#473b-1 斷言失敗 — 對不存在的 refund 呼叫竟然成功了(期望 P8C03);拒繼續';
  EXCEPTION
    WHEN sqlstate 'P8C03' THEN NULL;  -- 預期:取不到序列化點
  END;

  -- 5h 🔴 簽章逐字未變(主視窗提醒:簽章一變就不是 replace 而是新函式,
  --     五個讀取點會靜默留在舊那支上、「沒有新入口可以不走」當場變假)
  SELECT pg_get_function_identity_arguments(
           'public.pcm_order_refundable_remaining(uuid)'::regprocedure) = 'p_order_id uuid' INTO v_ok;
  IF NOT v_ok THEN
    RAISE EXCEPTION '#473b-1 斷言失敗 — remaining 的簽章被改動了(實際=%);'
                    '既有讀取點會留在舊函式上,本片的機制論證失效;拒繼續',
                    pg_get_function_identity_arguments(
                      'public.pcm_order_refundable_remaining(uuid)'::regprocedure);
  END IF;
END
$assert$;

COMMIT;
