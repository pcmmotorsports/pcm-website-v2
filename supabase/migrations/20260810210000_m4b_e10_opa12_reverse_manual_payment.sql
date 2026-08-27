-- ══════════════════════════════════════════════════════════════════════════
-- OP-A12 · 人工軌沖銷入口 `admin_reverse_manual_payment` + **OP5/A12 兩支開權**
-- ══════════════════════════════════════════════════════════════════════════
-- 規格權威 = backlog **#372**(逐字:沖銷 RPC + GRANT 兩支 + 翻 op5-verify ACL 極性
--   + `has_function_privilege` 斷言;**沖銷不受 `payment_status` allowlist 限制**)。
-- plan = `B-403`(主視窗批)→ `B-404`(v2,關卡1 R1 FAIL 9:8 折 + 1 片界題)。
--
-- ── 本片是 OP5 的**開權解鎖點** ────────────────────────────────────────────
-- OP5(`20260810200000`)刻意零 GRANT,理由是「Q3=A 的更正路徑在 A12 之前物理上不存在」
-- ⇒ 不可能出現「能登錄、不能更正」的窗口。本片同時開兩支,那個窗口從頭到尾沒存在過。
-- 🔴 **OP5 那支 migration 一個字不動**(關卡1 R1 #6):它檔尾斷言的是「**它自己 apply 當下**
--    零 EXECUTE」——那句在它自己的時點仍為真;去翻它會讓「全新重放全部 migration」在 OP5
--    階段就紅(那時本片還沒跑)。⇒ 最終 ACL 斷言**只放本片**,runtime 那面只翻 `op5-verify.sh` 的 S1。
--
-- ── 沖銷的語意(與退款分清楚)────────────────────────────────────────────
-- 沖銷 = **登錄錯誤的更正**(同單同軌、指向被沖那一列、金額為其反號),不是把錢還給客人。
-- 退款走別的機制(卡=order_refunds/TapPay、匯款=匯款退款線、現金=現金退還登記)。
-- 鏈式沖銷合法(OP1 檔頭 A10 拍板):P(+500) → R1(−500) → R2(+500),`SUM` 仍 = 500。
-- 🔴 本片**不自己驗反號**:那是 OP2b 的 A9 trigger(`P2B33`)。本片只負責送出形狀正確的列,
--    並在 harness 留一格證 A9 仍在守(手工塞非反號 ⇒ 必須紅在 A9,不是靜默寫進去)。
--
-- ── 🔴 沒有冪等(關卡1 R1 #2:撤掉一個證不到的宣稱)────────────────────────
-- 沖銷列**不能帶 `request_id`**(OP1 `rail_fields` 明文:沖銷列三個識別欄一律 NULL),
-- 而「同 actor + 同 reason」分不出「網路重送」與「隔週又按了一次」⇒ 原 plan 的 `idempotent:true`
-- 是**證不到的性質**。⇒ 已存在沖銷列時**一律**具名拒(`pcm_opa12_already_reversed`,訊息帶既有 id),
-- 不回冪等成功。真正的重送保護 = `order_payments_one_reversal_uniq`(一列最多被沖一次)。
--
-- ── 🔴 鎖:parent 一律 `FOR NO KEY UPDATE`(repo 既有契約,不是本片的判斷)─────
-- `…a2b1_procurement_allocation_guard.sql:20-24` 逐字:FK RI 檢查會先對 parent 取 `KEY SHARE`;
-- 兩筆併發 INSERT 各持 `KEY SHARE` 再升 `FOR UPDATE` = **鎖升級死結(40P01 重現)**;
-- 「A4a / A8a2 之後鎖同一 parent 一律同用 NKU」。本片的 target 收款列正是新沖銷列的 FK parent
-- ⇒ 用 NKU(與 KEY SHARE 相容)。
-- 🔴 **鎖序 = `orders` → `order_payments`,與 OP5 同向**。
--    `orders` 那道沿用 OP5 的 `FOR UPDATE`(兩支因此互相序列化;鎖在 INSERT **之前**取,
--    沒有「先 KEY SHARE 再升級」那個形狀,不觸發 a2b1 的死結)。
--    ⚠️ **這一句的證據等級要講清楚(雙線審後補;原句寫成「反向寫兩支併發就是死結」是宣稱大於事實)**:
--    「同向」是照 a2b1 契約的**預防性**規定,不是本片觀察到的事實 —— 實測(harness M8c 突變)
--    把本片鎖序整個反過來,`opa12-verify.sh` 的 C2 併發格**仍然全綠、零 40P01**:
--    OP5 插的是 `reverses_payment_id IS NULL` 的新列、不要既有收款列的鎖,兩支鎖集合只在
--    orders 那一列重疊 ⇒ 今天這兩個 writer 之間**構造不出**循環等待。
--    ⇒ 真正在守鎖序的是 harness S2 的**順序錨**(同一個突變下它紅);死結那半屬「未來多一個
--      writer 時的預防」,不是已觀察事實。第三個 writer 進場時要重估(OP6 / A13 都可能是)。
-- 🔴 G4 的不鎖讀**只用來取 `order_id`**;鎖住 orders 之後**必須回頭鎖 target 並重讀**
--    (主視窗批准時給的錨)——不鎖那次讀到的值可能已被另一支沖掉。
--
-- ── 🔴 本片刻意**沒有** OP5 的狀態 allowlist、也不擋已取消單 ──────────────────
-- #372 逐字:「沖銷不受 `payment_status` allowlist 限制(沖銷是更正不是收錢)」。
-- 誤登在一張後來被取消/退款的單上,仍然必須改得掉,否則 Q3=A 的更正路徑對那些單是死的。
-- ⚠️ **已知代價(關卡1 R1 #9,片界題已上呈主視窗)**:開權之後這條路才真的可達 ——
--    「OP5 落款 → A8a2 仍可取消該單(A14 缺口:它的允許集合不查 `order_payments`)→
--     有人把那筆**正確收款**沖成淨零」在帳面上會平、而錢實際還在我方也沒退客人。
--    這需要**人主動誤用**(三步:落款 → 取消 → 沖銷)、不會自動發生;真正的修法是 A14
--    (A8a2 允許集合加查本帳本)。
-- 🏁 **Sean 已拍 C(2026-08-10)**:照現狀開權、**本片不加 A14 守門**,這條壞態當**已知風險**
--    登記在 backlog #372 的 A14 條目(字面含「**開權後可達**」),等 OP6 / A8 線收。
--    🔴 否決 A 案的理由要記下來,免得下一個人以為是漏掉的:A 案(「該單淨額 > 0 ⇒ 拒取消」)
--       會**直接推翻 Sean 2026-07-26 拍板的「已付款可取消」**(memory `project_m4b-admin-preview-decisions`)
--       ⇒ 那不是本片的範圍問題,是舊拍板要不要翻案的題。
--
-- ── 錯誤碼(全 repo 實查未用)──────────────────────────────────────────────
-- `P2B42` actor 無效 / `P2B43` 落帳 row_count / `P2B44` **一碼兩義,按 CONSTRAINT 分**:
--   `pcm_opa12_card_rail`(卡軌不由本支沖)與 `pcm_opa12_already_reversed`。
-- 🔴 一碼兩義是 OP5 被抓過的形狀 ⇒ **立案當下就寫進 backlog #371**,不留給下一輪審查抓。
--
-- ── apply 前置 ─────────────────────────────────────────────────────────────
-- ① OP2b 已 apply(A9/不可變/擋刪三支 trigger 在)—— 下方 GRANT **之前**會重驗一次。
-- ② `transaction_timeout` = PG17-only ⇒ apply 前 `SHOW server_version`。
-- ③ 🔴 本片 apply = **OP5 的正式路徑第一次可呼叫**。⚠️ OP-A15(待認領款暫存帳)仍不存在
--    ⇒ OP5 的每一道 fail-closed 拒絕在正式站仍是「錢收到了但記不進去」,只是現在**登錯了能改**。
-- ══════════════════════════════════════════════════════════════════════════

BEGIN;

-- 🔴 關卡1 R1 #5:整片單一交易 —— 函式 + 兩組 REVOKE/GRANT + 結構斷言全在裡面。
--    少了它,GRANT 完才紅的斷言會留下「只開一支」的半套 ACL。
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL transaction_timeout = '90s';

CREATE FUNCTION public.admin_reverse_manual_payment(
  p_payment_id uuid,
  p_actor      text,
  p_reason     text
)
RETURNS jsonb                 -- {reversed, reversal_id};無 idempotent 欄(見檔頭)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_target      record;
  v_order_id    uuid;
  v_reason      text;
  v_existing    uuid;
  v_reversal_id uuid;
  v_n           integer;
  v_generic_msg constant text := 'admin_reverse_manual_payment: 沖銷失敗';
BEGIN
  -- G1 隔離閘(OP5/A8c2 同款)
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'admin_reverse_manual_payment: isolation guard' USING ERRCODE = 'P8C01';
  END IF;

  -- G2 actor —— 排在任何資料讀取之前(OP5 同款:身分錯的呼叫拿不到任何帳本資訊)
  IF p_actor IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.staff s WHERE s.id = p_actor AND s.is_active) THEN
    RAISE EXCEPTION 'admin_reverse_manual_payment: 經手人 [%] 不存在或已停用 ⇒ 拒絕沖銷',
                    coalesce(p_actor, '(NULL)')
      USING ERRCODE = 'P2B42', CONSTRAINT = 'pcm_opa12_actor_invalid';
  END IF;

  -- G3 輸入驗。🔴 reason 一開始就正規化成單一變數,守門與寫入只用它(關卡1 R1 #3)。
  IF p_payment_id IS NULL THEN
    RAISE EXCEPTION 'admin_reverse_manual_payment: 收款列識別碼缺失';
  END IF;
  v_reason := pg_catalog.btrim(coalesce(p_reason, ''));
  IF v_reason = '' THEN
    RAISE EXCEPTION 'admin_reverse_manual_payment: 沖銷理由必填(錢帳上「為什麼把這筆沖掉」是稽核第一個問題)';
  END IF;

  -- G4 不鎖讀,**只取 order_id**(拿它去鎖正確的 orders 列);其餘欄位一律不沿用
  SELECT op.order_id INTO v_order_id FROM public.order_payments op WHERE op.id = p_payment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '%', v_generic_msg;   -- 不洩「這一列存不存在」
  END IF;

  -- G5 鎖序 orders → order_payments(與 OP5 同向)
  PERFORM 1 FROM public.orders o WHERE o.id = v_order_id FOR UPDATE;

  -- G6 鎖後**重讀** target(主視窗的錨):不鎖那次讀到的值可能已被另一支動過
  SELECT op.id, op.order_id, op.rail, op.amount, op.received_at
    INTO v_target
    FROM public.order_payments op
   WHERE op.id = p_payment_id
   FOR NO KEY UPDATE;                      -- 🔴 NKU 不是 FOR UPDATE,見檔頭的 a2b1 契約
  IF NOT FOUND THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- G7 卡軌具名拒:卡片的錢走 refund adapter,不在本帳本沖
  IF v_target.rail = 'card' THEN
    RAISE EXCEPTION 'admin_reverse_manual_payment: 卡軌收款不由本支沖銷(卡片退款走 TapPay refund,不是帳本沖銷)'
      USING ERRCODE = 'P2B44', CONSTRAINT = 'pcm_opa12_card_rail';
  END IF;

  -- 🔴 這裡**刻意沒有** OP5 的狀態 allowlist、也不擋已取消單(#372 逐字)。見檔頭的已知代價。

  -- G8 已被沖銷 ⇒ 具名拒(不回冪等;沒有 request identity 就不宣稱那個性質)
  SELECT op.id INTO v_existing
    FROM public.order_payments op
   WHERE op.reverses_payment_id = p_payment_id;
  IF FOUND THEN
    RAISE EXCEPTION 'admin_reverse_manual_payment: 該列已被沖銷(沖銷列 id=%)⇒ 一列最多沖一次;'
                    '要再更正請沖銷那一列(沖銷之沖銷)', v_existing
      USING ERRCODE = 'P2B44', CONSTRAINT = 'pcm_opa12_already_reversed';
  END IF;

  -- G9 寫沖銷列:三個識別欄與 reviewed_* 全 NULL(OP1 rail_fields 對沖銷列的要求);
  --    金額 = 反號(A9 會再驗一次);received_at 跟著被沖那筆走(沖的是「那一筆錢」的更正)。
  INSERT INTO public.order_payments
    (order_id, rail, amount, received_at, reverses_payment_id, reversal_reason, actor)
  VALUES
    (v_target.order_id, v_target.rail, -v_target.amount, v_target.received_at,
     v_target.id, v_reason, p_actor)
  RETURNING id INTO v_reversal_id;

  -- G10 row_count 守(位置必須在 INSERT 之後:排前面讀到的是上一句的 ROW_COUNT、恆真)
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'admin_reverse_manual_payment: 沖銷列落 % 列(期望恰 1)⇒ 可能有 BEFORE INSERT '
                    'trigger 回了 NULL(靜默吞列)。本交易整筆回滾', v_n
      USING ERRCODE = 'P2B43', CONSTRAINT = 'pcm_opa12_row_count';
  END IF;

  RETURN pg_catalog.jsonb_build_object('reversed', true, 'reversal_id', v_reversal_id);

EXCEPTION
  -- 旁路 writer 的 backstop:兩支本 RPC 之間由 G5 的 orders 鎖序列化、G8 會先擋,
  -- 走到這裡代表有人不經本 RPC 直接寫(或未來多一個 writer)。收成通用訊息,不洩約束名。
  WHEN unique_violation THEN
    RAISE EXCEPTION '%', v_generic_msg;
END;
$fn$;

COMMENT ON FUNCTION public.admin_reverse_manual_payment(uuid, text, text) IS
  'M-4b E10-OP-A12 人工軌沖銷(SECURITY DEFINER、search_path='''')。沖銷=登錄錯誤的更正(同單同軌、金額為被沖列反號),**不是退款**。'
  '十道:G1 隔離閘 P8C01 → G2 actor(排在任何資料讀取前)P2B42 → G3 輸入驗(reason 正規化成單一變數、必填)→ G4 不鎖讀只取 order_id'
  ' → G5 鎖 orders FOR UPDATE(鎖序 orders→order_payments,與 OP5 同向)→ G6 **鎖後重讀** target(FOR NO KEY UPDATE;NKU 而非 FOR UPDATE 見 a2b1:20-24 的 40P01 契約)'
  ' → G7 卡軌具名拒 P2B44/pcm_opa12_card_rail → G8 已被沖銷具名拒 P2B44/pcm_opa12_already_reversed(**無冪等**:沖銷列不得帶 request_id,同 actor+同 reason 分不出重送與誤按)'
  ' → G9 append 沖銷列(識別欄與 reviewed_* 全 NULL、received_at 跟著被沖那筆)→ G10 row_count 守 P2B43。'
  '🔴 **刻意無 payment_status allowlist、不擋已取消單**(#372:沖銷是更正不是收錢);已知代價=A14 缺口下可把正確收款沖成淨零,見本片檔頭與 #372。'
  '🔴 反號由 OP2b 的 A9 保證(P2B33),本支不自己驗。零經銷價 / 零 cost。'
  '🔴 **不碰 orders.payment_status**(與 OP5 對稱:帳本只記事實,狀態判定歸 OP6)——'
  '沖銷把該單淨額打到 0 時,payment_status 仍停在原值,那是 OP6 的職責不是本支的漏做。';

-- ══ 開權(#372 三件套之二):GRANT **兩支** ═══════════════════════════════
-- 🔴 順序:先重驗上游不變式(下方 DO 區塊在 GRANT 之前),確認漂移了就整片回滾、**不開權**。
DO $opa12_upstream$
DECLARE v_bad text;
BEGIN
  -- ① OP2b 三支 trigger + OP2a 的 A8 閘:在場 + 啟用 + **綁對函式** + **WHEN 逐字**。
  -- 🔴🔴 雙線審 must-fix #5(opus#7=Fable F3①):上一版只比 `tgname` + `tgenabled`
  --    = **在場性斷言**,對「名字還在、守門已被換掉」全盲 —— 把
  --    `order_payments_reversal_amount_bi` 改綁到一支 `RETURN NEW` 的空函式,
  --    或把 A9 的 WHEN 縮成 `… AND NEW.amount < 0`(正額的沖銷之沖銷就整批繞過 A9),
  --    這一關**照樣綠**,而我下一行就要開權。本片退回了 OP2b 關卡2 #4 已經修過的舊形狀。
  -- ⇒ 樣板逐字沿用 `20260810130000_…_op2b_reversal_invariants.sql:509-544`;
  --    期望值取自本片 provision 後的 catalog 實查(不是我寫出來的):
  --    A9 = `(new.reverses_payment_id IS NOT NULL)`,另三支**必須無** WHEN。
  -- 🔴 codex 關卡2 R1 #1:上一版凍了 tgfoid 與 WHEN,**漏了 `tgtype`**(樣板有)。
  --    tgtype 是事件與時機的位元遮罩:把 A9 從 `BEFORE INSERT` 改成 `AFTER INSERT`、或改成
  --    只在 UPDATE 觸發,名字/函式/WHEN/啟用狀態**全部不變** ⇒ 舊版照樣開權。
  --    凍結值 catalog 實查(PG17.10 同日取樣):bi=7 / bu=19 / bd=11 / biu=23。
  -- 🔴🔴 R3(Fable 折面線)F1:tgfoid/tgtype/WHEN/tgenabled 四樣凍了,**漏 `tgattr`**(欄位清單)。
  --    Fable 標的是 likely、未實跑;**我實跑證實了**:把 immutable_bu 同名重建成
  --    `BEFORE UPDATE OF reversal_reason`,`tgtype` **仍然是 19**、函式/WHEN/啟用全同
  --    ⇒ 補 tgattr 之前那一版**是綠的**,而 immutable_bu 對 amount / order_id 的 UPDATE
  --    已經完全不再觸發(改金額不再被擋)。實測 tgattr 由空變成 [14]。
  --    ⇒ 四支都不帶欄位清單(catalog 實查 tgattr 皆空)⇒ 一律要求空 vector。
  SELECT pg_catalog.string_agg(e.t, ', ' ORDER BY e.t) INTO v_bad
    FROM (VALUES
      ('order_payments_reversal_amount_bi',        'public.pcm_op2b_reversal_amount()',     '(new.reverses_payment_id IS NOT NULL)',  7::smallint),
      ('order_payments_immutable_bu',              'public.pcm_op2b_immutable_columns()',   '',                                      19::smallint),
      ('order_payments_no_delete_bd',              'public.pcm_op2b_no_delete()',           '',                                      11::smallint),
      ('order_payments_received_at_not_future_biu','public.pcm_op2_received_at_not_future()','',                                      23::smallint)
    ) e(t, fn, wh, ty)
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_catalog.pg_trigger g
      WHERE g.tgrelid = 'public.order_payments'::regclass
        AND g.tgname = e.t
        AND g.tgenabled = 'O'
        AND g.tgfoid = e.fn::regprocedure
        AND g.tgtype = e.ty
        AND pg_catalog.cardinality(g.tgattr::int2[]) = 0
        AND coalesce(pg_catalog.substring(pg_catalog.pg_get_triggerdef(g.oid),
                                          'WHEN \((.*)\) EXECUTE FUNCTION'), '') = e.wh);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '上游守門 trigger 缺席 / 被停用 / 綁到別支函式 / 事件時機(tgtype)被改 / 被縮成只看某幾欄(tgattr)/ WHEN 被改:% '
                    '⇒ **拒絕開權**(開了就是讓沒人守的錢帳上線)', v_bad
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_opa12_upstream_triggers';
  END IF;

  -- ② 四道 unique index:存在 + 生效 + **鍵欄逐字** + **partial predicate 逐字**。
  -- 🔴🔴 must-fix #6(opus#8=Fable F3②):上一版只問名字與四個 `indis*` 旗標
  --    ⇒ **同名重建到別的欄**(或把 WHERE 換成別的條件、疊上恆假條件)照樣全綠。
  --    `one_reversal_uniq` 是「一列只沖一次」的承重:它若被重建到別欄,G8 之外的最後一道
  --    backstop 就沒了,而這一關會說沒事。
  -- ⇒ 樣板沿用 `20260810100000_…_op1_order_payments_m.sql:570-606`;期望值 catalog 實查。
  SELECT pg_catalog.string_agg(e.idx, ', ' ORDER BY e.idx) INTO v_bad
    FROM (VALUES
      ('order_payments_card_idem_uniq',        'order_id,rec_trade_id', '((rail = ''card''::text) AND (reverses_payment_id IS NULL))'),
      ('order_payments_rec_trade_global_uniq', 'rec_trade_id',          '((rail = ''card''::text) AND (reverses_payment_id IS NULL))'),
      ('order_payments_request_id_uniq',       'order_id,request_id',   '(request_id IS NOT NULL)'),
      ('order_payments_one_reversal_uniq',     'reverses_payment_id',   '(reverses_payment_id IS NOT NULL)')
    ) e(idx, cols, pred)
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_catalog.pg_index i
       JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid
      WHERE i.indrelid = 'public.order_payments'::regclass AND c.relname = e.idx
        AND i.indisvalid AND i.indisready AND i.indislive AND i.indisunique
        -- 🔴🔴 codex 關卡2 R2 #1:**表達式索引**會讓鍵欄比對靜默失守 —— 實測把
        --    rec_trade_global_uniq 換成 UNIQUE (lower(actor), rec_trade_id),表達式那欄的
        --    attnum=0、被 JOIN pg_attribute 丟掉,聚合結果**仍然等於 rec_trade_id** ⇒ 閘全綠,
        --    而「rec_trade_id 全域唯一」已經沒了(變成 lower(actor) 才唯一)。
        --    ⇒ 直接要求本族索引一律無表達式欄。
        AND i.indexprs IS NULL
        -- ⚠️ 誠實邊界(R3 F4;主視窗裁「記邊界、不加閘」):**沒凍 `indclass`**(opclass)。
        --    換成非預設 opclass 理論上能改變唯一性語意,但構造成本高、且 G8 在應用層先兜底;
        --    加閘就要再配一發突變,收益不值。⇒ 這是**知情缺口**,不是漏掉。
        -- 🔴 codex 關卡2 R1 nit-1:`indkey` 會把 **INCLUDE 欄**一起展開(實測:對
        --    `(order_id, request_id) INCLUDE (rail)` 展開成 order_id,request_id,rail 而
        --    indnkeyatts=2)⇒ 合法加一個 INCLUDE 欄會被誤紅,而唯一鍵語意根本沒變。
        --    誤紅比漏抓更難處理(以後沒人敢 apply)⇒ 只取前 indnkeyatts 個鍵欄。
        AND (SELECT pg_catalog.string_agg(a.attname, ',' ORDER BY k.ord)
               FROM unnest(i.indkey::smallint[]) WITH ORDINALITY k(attnum, ord)
               JOIN pg_catalog.pg_attribute a
                 ON a.attrelid = i.indrelid AND a.attnum = k.attnum
              WHERE k.ord <= i.indnkeyatts) = e.cols
        AND pg_catalog.pg_get_expr(i.indpred, i.indrelid) = e.pred);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'unique index 不存在 / 沒生效 / 鍵欄或 WHERE 被改:% ⇒ 拒絕開權'
                    '(one_reversal_uniq 是「一列只沖一次」的承重)', v_bad
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_opa12_upstream_indexes';
  END IF;

  -- ③ composite 自我 FK:**三欄逐字 + 被參照端逐字 + MATCH 型別**(它保證沖銷只能指向同單同軌的列)
  -- 🔴🔴 must-fix #7(opus#9=Fable F3③):上一版只問 conname + contype='f' ⇒ 同名但
  --    **本地端第三欄換成 `rec_trade_id`** 照樣綠,而該欄對非卡軌恆為 NULL、MATCH SIMPLE
  --    讓整條 FK **無聲跳過**(OP1 codex R2-R2 #4 逐字記過的形狀);改 MATCH FULL 則反過來
  --    讓收款列全部寫不進(OP1 R3 F2)。兩種壞法都要紅。
  -- 🔴 `convalidated` 也凍:這條**不是審查線給的**,是我跑 M7 突變時發現的 —— MATCH FULL 在
  --    有資料的表上連 ALTER 都過不了,得加 `NOT VALID` 才構造得出來,而 NOT VALID 的 FK
  --    對**既有列**永遠不檢查、我原本的字面看不出差別(健康庫實查 convalidated = t)。
  -- ⇒ 期望字面 catalog 實查,與 OP1:640 凍結值逐字相同。
  SELECT coalesce(
           (SELECT string_agg(a.attname, ',' ORDER BY k.ord)
              FROM unnest(c.conkey) WITH ORDINALITY k(n, ord)
              JOIN pg_catalog.pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.n), '(查無)')
         || ' -> ' || c.confrelid::regclass::text || '('
         || coalesce(
              (SELECT string_agg(a.attname, ',' ORDER BY k.ord)
                 FROM unnest(c.confkey) WITH ORDINALITY k(n, ord)
                 JOIN pg_catalog.pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.n), '(查無)')
         || ') MATCH ' || c.confmatchtype::text
         || CASE WHEN c.convalidated THEN '' ELSE ' NOT VALID' END
    INTO v_bad
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.order_payments'::regclass
     AND c.contype = 'f' AND c.conname = 'order_payments_reverses_same_order_rail';
  IF v_bad IS DISTINCT FROM
     'reverses_payment_id,order_id,rail -> order_payments(id,order_id,rail) MATCH s' THEN
    RAISE EXCEPTION 'composite 自我 FK 是 [%],期望逐字 '
                    '[reverses_payment_id,order_id,rail -> order_payments(id,order_id,rail) MATCH s]'
                    ' ⇒ 不在 / 換欄 / 指錯表 / 改 MATCH FULL 都紅在這裡;拒絕開權',
                    coalesce(v_bad, '(整條 FK 不在)')
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_opa12_upstream_selffk';
  END IF;

  -- ④ dormant gate 早已移除(OP2b 做的);還在就代表發布序錯了
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
              WHERE conname = 'order_payments_dormant_until_triggers'
                AND conrelid = 'public.order_payments'::regclass) THEN
    RAISE EXCEPTION 'dormant gate 還在 ⇒ OP2b 沒 apply,兩支 writer 都寫不進去;拒絕開權'
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_opa12_dormant_gate_present';
  END IF;
END
$opa12_upstream$;

REVOKE ALL ON FUNCTION public.admin_reverse_manual_payment(uuid, text, text)
  FROM PUBLIC, anon, authenticated, authenticator;
GRANT EXECUTE ON FUNCTION public.admin_reverse_manual_payment(uuid, text, text) TO service_role;

-- 🔴 OP5 的開權在這裡(它自己那片刻意零 GRANT)。兩支同一交易開,不存在「只開一支」的中間態。
REVOKE ALL ON FUNCTION public.admin_record_manual_payment(uuid, uuid, text, text, integer, timestamptz, text, text)
  FROM PUBLIC, anon, authenticated, authenticator;
GRANT EXECUTE ON FUNCTION public.admin_record_manual_payment(uuid, uuid, text, text, integer, timestamptz, text, text) TO service_role;

-- ══ 檔尾 fail-closed 結構驗收 ═══════════════════════════════════════════════
DO $opa12_asserts$
DECLARE
  v_code text; v_body text; v_bad text; v_fn oid;
BEGIN
  SELECT p.oid, p.prosrc INTO v_fn, v_code FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.admin_reverse_manual_payment(uuid,text,text)'::regprocedure;
  -- 錨一律對**剝掉行內註解**的函式體比(OP5 那輪雙線審的教訓:strpos 首命中會落在註解)
  v_body := pg_catalog.regexp_replace(v_code, '--[^' || pg_catalog.chr(10) || ']*', '', 'g');

  -- 🔴🔴 雙線審 must-fix #3(Fable F1 = opus#5):**順序錨 fail-open**。
  --    下面三條順序錨都是 `strpos(A) > strpos(B)` ⇒ 任一運算元**整條消失**時它是 0,
  --    而 `0 > N` 恆為**假** ⇒ 守門不紅。實證(兩線各自突變):把 G5 整行
  --    `PERFORM 1 FROM public.orders o … FOR UPDATE` 刪掉 ⇒ 順序錨靜靜放行。
  -- ⇒ 修法 = 把**順序錨用到的每一個運算元**都放進下面這份「存在性」清單。
  --    本檢查 RAISE 在比序之前 ⇒ 運算元缺席一律先紅在這裡,比序那三行永遠拿不到 0。
  --    (等價於「先斷言 strpos>0 再比序」,但不必把三條 IF 各拆成兩條。)
  SELECT pg_catalog.string_agg(x.frag, ' | ' ORDER BY x.frag) INTO v_bad
    FROM unnest(ARRAY['USING ERRCODE = ''P8C01''','USING ERRCODE = ''P2B42''',
                      'USING ERRCODE = ''P2B43''','USING ERRCODE = ''P2B44''',
                      'FOR NO KEY UPDATE','FOR UPDATE',
                      'GET DIAGNOSTICS v_n = ROW_COUNT;','AND s.is_active',
                      'FROM public.orders o',
                      'FROM public.order_payments op',
                      'INSERT INTO public.order_payments']) x(frag)
   WHERE pg_catalog.strpos(v_body, x.frag) = 0;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'A12 碼錨缺失:%', v_bad USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_opa12_code_anchor';
  END IF;

  -- 順序錨三條:actor 在任何讀取之前 / 鎖 orders 在鎖 target 之前 / row_count 在 INSERT 之後
  IF pg_catalog.strpos(v_body, 'AND s.is_active') > pg_catalog.strpos(v_body, 'FROM public.order_payments op') THEN
    RAISE EXCEPTION 'A12 順序錨:actor 守門排在讀帳本之後 ⇒ 無效身分可探測列是否存在'
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_opa12_order_actor_first';
  END IF;
  IF pg_catalog.strpos(v_body, 'FROM public.orders o') > pg_catalog.strpos(v_body, 'FOR NO KEY UPDATE') THEN
    RAISE EXCEPTION 'A12 順序錨:鎖 orders 不在鎖 target 之前 ⇒ 違反 orders 到 order_payments 鎖序契約'
                    '(a2b1 預防性規定;死結本身在今天這兩個 writer 之間構造不出,見檔頭)'
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_opa12_order_lock_order';
  END IF;
  IF pg_catalog.strpos(v_body, 'GET DIAGNOSTICS v_n = ROW_COUNT;')
     < pg_catalog.strpos(v_body, 'INSERT INTO public.order_payments') THEN
    RAISE EXCEPTION 'A12 順序錨:row_count 守不在 INSERT 之後 ⇒ 恆真'
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_opa12_order_rowcount';
  END IF;

  -- 函式屬性
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid = v_fn AND p.prosecdef) THEN
    RAISE EXCEPTION 'A12 不是 SECURITY DEFINER' USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_opa12_not_secdef';
  END IF;
  SELECT pg_catalog.array_to_string(p.proconfig, ', ') INTO v_bad FROM pg_catalog.pg_proc p WHERE p.oid = v_fn;
  IF v_bad IS DISTINCT FROM 'search_path=""' THEN
    RAISE EXCEPTION 'A12 proconfig 是 [%],期望逐字 [%]', coalesce(v_bad,'(NULL)'), 'search_path=""'
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_opa12_proconfig';
  END IF;

  -- SECDEF fail-open 面(owner 對齊 + 非 FORCE RLS)
  SELECT pg_catalog.string_agg(c.relname, ', ' ORDER BY c.relname) INTO v_bad
    FROM pg_catalog.pg_class c
   WHERE c.oid IN ('public.orders'::regclass, 'public.order_payments'::regclass, 'public.staff'::regclass)
     AND (c.relowner <> (SELECT p.proowner FROM pg_catalog.pg_proc p WHERE p.oid = v_fn)
          OR c.relforcerowsecurity);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'A12 SECDEF fail-open 面 — [%] owner 不對齊或開了 FORCE RLS', v_bad
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_opa12_secdef_fail_open';
  END IF;

  -- 🔴 ACL 終態(**兩支一起驗**;關卡1 R1 #7 補 authenticator):
  --    service_role 有效 EXECUTE = 真;anon / authenticated / authenticator = 假。
  --    ⚠️ 誠實邊界照抄 OP2a:`has_function_privilege` 涵蓋這些角色(含繼承),
  --       **不涵蓋**清單外的角色、owner 身分與 superuser;它證的是 ACL,**不證**正式身分
  --       真的能完成 SECDEF 寫入 —— 那一半在 `opa12-verify.sh` 用 SET LOCAL ROLE 跑正向流程。
  --       「清單外角色」那半由下方的**閉世界**斷言補上(must-fix #8)。
  SELECT pg_catalog.string_agg(s.sig || ':' || x.r, ', ' ORDER BY s.sig, x.r) INTO v_bad
    FROM unnest(ARRAY['public.admin_reverse_manual_payment(uuid,text,text)',
                      'public.admin_record_manual_payment(uuid,uuid,text,text,integer,timestamptz,text,text)']) s(sig),
         unnest(ARRAY['anon','authenticated','authenticator']) x(r)
   WHERE pg_catalog.has_function_privilege(x.r, s.sig, 'EXECUTE');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '這些角色**有效**拿得到 EXECUTE(%)⇒ 開權開太寬', v_bad
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_opa12_execute_too_wide';
  END IF;
  SELECT pg_catalog.string_agg(s.sig, ', ' ORDER BY s.sig) INTO v_bad
    FROM unnest(ARRAY['public.admin_reverse_manual_payment(uuid,text,text)',
                      'public.admin_record_manual_payment(uuid,uuid,text,text,integer,timestamptz,text,text)']) s(sig)
   WHERE NOT pg_catalog.has_function_privilege('service_role', s.sig, 'EXECUTE');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'service_role 對這些函式拿不到 EXECUTE(%)⇒ 開權沒生效,正式站會噴 42501 而 app 層會歸「可重試」', v_bad
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_opa12_execute_missing';
  END IF;

  -- 🔴🔴 must-fix #8(Fable F2):**閉世界**。上面兩道都是具名清單(三個角色 + service_role)
  --    ⇒ 對「清單外的角色」完全盲。這不是理論:`admin_record_manual_payment` 是 OP5 那片建的,
  --    本片只 REVOKE `PUBLIC, anon, authenticated, authenticator` —— 若有人在 OP5 apply 之後、
  --    本片之前手動 `GRANT EXECUTE … TO <自訂 role>`,那個 grant 會**原封不動活過本片**,
  --    而具名清單的三份斷言(本檔 + op5-verify + opa12-verify)全部照樣綠。
  -- ⇒ 改問「grantee 集合是誰」而不是「這幾個是不是假」:只准 {owner, service_role},多一個就紅。
  --    `proacl IS NULL` 另外擋:函式的**預設**權限是 PUBLIC 可 EXECUTE,NULL 代表 REVOKE 沒執行過
  --    (照抄 OP5:509-522 的理由),而 aclexplode(NULL) 回零列 ⇒ 不擋的話它是個恆綠的洞。
  SELECT pg_catalog.string_agg(s.sig, ', ' ORDER BY s.sig) INTO v_bad
    FROM unnest(ARRAY['public.admin_reverse_manual_payment(uuid,text,text)',
                      'public.admin_record_manual_payment(uuid,uuid,text,text,integer,timestamptz,text,text)']) s(sig)
   WHERE (SELECT p.proacl FROM pg_catalog.pg_proc p WHERE p.oid = s.sig::regprocedure) IS NULL;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '這些函式 proacl 是 NULL(%)⇒ REVOKE 沒執行過,函式預設 PUBLIC 可 EXECUTE', v_bad
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_opa12_proacl_null';
  END IF;
  SELECT pg_catalog.string_agg(x.sig || ':' || x.grantee, ', ' ORDER BY x.sig, x.grantee) INTO v_bad
    FROM (
      SELECT p.oid::regprocedure::text AS sig,
             CASE WHEN g.grantee = 0 THEN 'PUBLIC'
                  ELSE pg_catalog.pg_get_userbyid(g.grantee) END AS grantee
        FROM pg_catalog.pg_proc p
        CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) g
       WHERE p.oid IN ('public.admin_reverse_manual_payment(uuid,text,text)'::regprocedure,
                       'public.admin_record_manual_payment(uuid,uuid,text,text,integer,timestamptz,text,text)'::regprocedure)
         AND g.privilege_type = 'EXECUTE'
         AND (g.grantee = 0
              OR pg_catalog.pg_get_userbyid(g.grantee)
                 NOT IN ('service_role', pg_catalog.pg_get_userbyid(p.proowner))
              -- 🔴 codex 關卡2 R1 #2:grantee 對了還不夠,**WITH GRANT OPTION 也要擋**。
              --    實測:先 `GRANT … WITH GRANT OPTION`、再下一道普通 GRANT,`is_grantable`
              --    **仍然是 true**(普通 GRANT 不會拔掉 grant option),而本片對 service_role
              --    只 GRANT、沒 REVOKE ⇒ 既有的轉授權原封活過本片,閉世界照樣綠。
              --    有 grant option = service_role 可以自己再轉授給任何人 ⇒ 閉世界名存實亡。
              OR g.is_grantable)
    ) x;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'EXECUTE 閉世界被打破(%)⇒ 拒絕開權。兩種可能:①出現 {owner, service_role} '
                    '以外的 grantee ②允許集合內的角色帶了 WITH GRANT OPTION(它可以自己再轉授)', v_bad
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_opa12_execute_closed_world';
  END IF;

  RAISE NOTICE 'OP-A12 結構驗收通過:上游四支 trigger 啟用中且綁對函式與 WHEN + 四道 unique 鍵欄與 predicate 逐字 + '
               '自我 FK 三欄與 MATCH 逐字 + gate 已移除(GRANT 前重驗)、'
               '十一個碼錨在(剝註解後比;含三條順序錨的每一個運算元)、三條順序錨(actor 最前 / orders 先於 target / row_count 在 INSERT 後)、'
               'SECDEF + search_path 空 + owner 對齊三表且非 FORCE RLS、'
               '兩支的 ACL 終態 = service_role 有效 EXECUTE 為真、anon/authenticated/authenticator 皆為假、'
               '且 grantee 閉世界 = {owner, service_role}';
END
$opa12_asserts$;

COMMIT;
