-- ============================================================
-- M-4b E10 片 D3-b(乙):沖銷 RPC + 讓可退餘額排除已作廢的列
-- ============================================================
-- 甲片 = 20260820090000(已 commit 68bff88a,加三欄 + 配對 CHECK)。
-- plan = ~/pcm-mailbox/W1-086;範圍盤點 = W1-085;函式代價 = W4-025(八道)+ W1-085 §1③(第九、十道)。
--
-- ── 本片做兩件,而第二件才是會改變錢的那一件 ────────────────
--   ① admin_void_manual_refund(uuid, text, text) —— 把一筆登記錯的非卡退款標成作廢。**零 GRANT。**
--   ② pcm_order_refundable_remaining 第三段加 `AND m.voided_at IS NULL`
--      ⇒ 🔴 **作廢一筆會讓可退餘額變大**,而那個數字被後台退款發起入口的閘吃
--        (`apps/admin/src/components/orders/order-detail.tsx:165-167`)⇒ 不是純顯示。
--
-- ── 🔴 為什麼沒有 request_id(刻意的,不是漏了)────────────────
--   D1 的登記是**新增一筆** ⇒「這是重送、還是另一筆新的?」沒有鍵答不出來 ⇒ 它需要 request_id。
--   而沖銷是**對一列特定的列做狀態轉移** ⇒「它作廢了沒」**那一列自己就答得出來**。
--   ⇒ **冪等鍵是為了辨識【意圖】,而狀態轉移的意圖已經寫在被轉移的那個狀態裡了。**
--   ⇒ 冪等由 (voided_at, void_reason, voided_by) 三欄承擔。
--   ⚠️ 誠實缺口:分不出「同一人同理由按兩次」—— 而那在任何意義下就是同一個操作。
--      不同的人 = 不同的 voided_by = 不同 payload ⇒ 會 RAISE,不會被吃掉。
--   🔴 **下一個人若覺得這裡少了一個鍵,先讀這一段再動手。**(主視窗 2026-08-20 裁定「乙」。)
--
-- ── 併發前提(量到的,不是推的)────────────────────────────
--   拋棄式 PG 17.10 四世界實測(W1-085 附錄有可重跑的原文):
--     RC + `AND voided_at IS NULL` ⇒ 第二發 `UPDATE 0`,最終原因 = 先到的那個
--     🔴 **對照組**:拿掉那個 AND ⇒ 第二發 `UPDATE 1` ⇒ **後到的蓋掉先到的** ⇒ 那個 AND 在承重
--     RR ⇒ 序列化失敗(安全,但呼叫端拿到的是錯誤不是 idempotent)⇒ 見 RPC COMMENT
--   ⚠️ 效度限制:那是**合成表**上的 Postgres 鎖語意 ⇒ 證的是前提成立,不是本 RPC 實作對。
--
-- ── 這一片會讓兩道守門變紅,而**兩道都紅得對** ──────────────
--   ① `packages/domain/src/order/refund-remaining-single-source.test.ts` —— 本檔提到 refund_amount
--      ⇒ 同片補一行 allowlist + why。**why 要答的是「gate 為什麼對正確的東西報紅」,不是「這筆無害」。**
--   ② `apps/admin/.../manual-refund-787-trigger.test.ts`(W2 的)—— 本檔一落地它會自動變紅,
--      逼人回來解 `#787` 硬閘。**那是設計好的,不是本片撞壞的。** 落地當下通知 W2。
BEGIN;

-- ══ 0. 前置閘(fail-closed;每一道旁邊寫「它擋的是哪個世界」)═══════════════════
DO $pre$
DECLARE
  v_src     text;
  v_cnt     integer;
  v_control integer;
  v_seg     integer;
  v_isnull  boolean;
BEGIN
  -- P1. 甲片已落地。🔴 **不只數欄名 —— 型別、nullable 都要對**(codex R1 must-fix:
  --    「只數三個欄名」證不了那三欄是我要的那三欄;一個 `voided_at text NOT NULL` 也會通過舊版)。
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.order_manual_refunds'::regclass AND NOT a.attisdropped
     AND NOT a.attnotnull                                    -- 三欄必須都是 nullable
     AND ( (a.attname = 'voided_at'   AND a.atttypid = 'timestamptz'::regtype)
        OR (a.attname = 'void_reason' AND a.atttypid = 'text'::regtype)
        OR (a.attname = 'voided_by'   AND a.atttypid = 'text'::regtype) );
  IF v_cnt <> 3 THEN
    RAISE EXCEPTION 'D3-b 前置閘 P1【觀察】:符合「三欄 + 指定型別 + nullable」的只有 % 個(要 3)。'
                    '**成因不只一種,本閘分不出來**:①甲片(20260820090000)沒套 ②有人改了型別 '
                    '③有人加了 NOT NULL ④欄被改名。'
                    '⇒ 先跑這句看是哪一欄:SELECT attname, atttypid::regtype, attnotnull FROM pg_attribute '
                    'WHERE attrelid=''public.order_manual_refunds''::regclass AND NOT attisdropped '
                    'AND attname IN (''voided_at'',''void_reason'',''voided_by'');'
                    '⚠️ **不要先重套甲片** —— 若是③④,重套只會撞重複欄位', v_cnt;
  END IF;
  -- P1b. 🔴 **不只認名字 —— 比對約束的【定義字面】**(codex R1 must-fix:同名而內容被換掉會通過)。
  SELECT pg_catalog.pg_get_constraintdef(oid) INTO v_src
    FROM pg_catalog.pg_constraint
   WHERE conrelid = 'public.order_manual_refunds'::regclass
     AND conname  = 'order_manual_refunds_void_trio';
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'D3-b 前置閘 P1b【觀察】:找不到名為 order_manual_refunds_void_trio 的約束。'
                    '**成因不只一種**:①甲片只上了一半 ②約束被改名 ③被新版取代。'
                    '⇒ 先看現有約束:SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint '
                    'WHERE conrelid=''public.order_manual_refunds''::regclass;'
                    '⚠️ **不要手動補回舊 CHECK** —— 若是③,那會覆蓋掉新版規則';
  END IF;
  IF position('num_nonnulls' in v_src) = 0
     OR position('pcm_b2_is_blank' in v_src) = 0
     OR position('0, 3' in replace(v_src, ' ', ' ')) + position('(0,3)' in replace(v_src, ' ', '')) = 0 THEN
    RAISE EXCEPTION 'D3-b 前置閘 P1b2【觀察】:配對 CHECK 的**定義字面**裡找不到三個承重零件之一'
                    '(num_nonnulls / pcm_b2_is_blank / IN (0,3))。現行定義:%。'
                    '🔴 **這是字面比對,不是行為比對** —— 一個語意相同但寫法不同的重寫也會停在這裡。'
                    '⇒ 先判斷那個定義**做的事**對不對;對的話,要改的是本閘的期望字面,不是那個約束。'
                    '⚠️ **不要為了過關把約束改回舊字面**',
                    v_src;
  END IF;

  -- 🔴 P2. **正向對照** —— 沒有它,P1 的 3 同時相容於「三欄在」與「我這個查詢對任何欄名都回數字」。
  SELECT count(*) INTO v_control
    FROM pg_catalog.pg_attribute
   WHERE attrelid = 'public.order_manual_refunds'::regclass AND NOT attisdropped
     AND attname IN ('zzz_not_a_real_column', 'zzz_also_not_real');
  IF v_control <> 0 THEN
    RAISE EXCEPTION 'D3-b 前置閘 P2(對照組)【觀察】:兩個【本該不存在】的欄名竟命中 % 個。'
                    '**兩種成因,而本閘分不出來**:①我這個查詢寫壞了 ⇒ P1 的 3 不可信 '
                    '②**真的有人建了那兩個欄** ⇒ 那是 schema 汙染,而它比本片重要。'
                    '⇒ 先查它們哪來的(pg_attribute + git log),**不要直接刪欄**', v_control;
  END IF;

  -- ── 指紋:本檔要在【20260820010000 留下的那一版】上改第三段,不是別的版本 ──
  SELECT p.prosrc INTO v_src
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'pcm_order_refundable_remaining'
     AND pg_catalog.pg_get_function_identity_arguments(p.oid) = 'p_order_id uuid';
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'D3-b 前置閘 P3【觀察】:取不到 public.pcm_order_refundable_remaining(uuid) 的定義。'
                    '**成因不只一種**:①舊 migration 漏套 ②函式被改簽章 ③被改名 ④被刻意下架。'
                    '⇒ 先看有沒有同名不同簽章的:SELECT oid::regprocedure FROM pg_proc '
                    'WHERE proname=''pcm_order_refundable_remaining'';'
                    '⚠️ **不要直接重套舊 migration** —— 若是②③④,那會把新版設計拉回舊版';
  END IF;
  -- 剝行註解 + 空白正規化(形狀照 20260820010000:133,同一套規則才比得起來)。
  v_src := regexp_replace(regexp_replace(v_src, '--[^\n]*', '', 'g'), '\s+', ' ', 'g');

  -- 🔴🔴 **P4-P6b 這一組整組換過**(codex R1 must-fix ×3)。原版的問題與現版證明的東西:
  --    舊 P4/P5 比對的是**片段**(`r.status IN (...)`)⇒ 它只證明「那幾個字還在某處」,
  --      而一個把整段改寫、只留那幾個字的版本會通過。
  --    舊 P6 只數 `COALESCE(` ⇒ 一個把第四段寫成 `- (SELECT ...)`(不用 COALESCE)的版本會通過。
  --    舊 P6b 在**整支 prosrc** 搜 `m.voided_at IS NULL` ⇒ 它不證明那個條件**位於第三段**。
  -- ⇒ 現版一律比對**整段字面**(與本檔 §4 A1 同一套、與 20260820010000:349-370 §5e 同一套),
  --    而三段全部釘死之後,「只有三個扣減段」由 `- COALESCE(` 計數 = 3 一起成立。
  -- 🔴 **為什麼不用 prosrc 的 md5 當指紋**(想過,不做):建表那支是**逐段轉錄**送出去的
  --    (`supabase/APPLIED.tsv:264` 逐字)⇒ 正式庫的 prosrc **未必逐位元等於檔案**
  --    ⇒ md5 會誤擋。而**整段字面 + 空白正規化在正式庫已被實證過**:同一列記著
  --    「已在 apply 之後以唯讀查詢逐條補跑,全過:seg1_ok/seg2_ok/seg3_ok 皆 true」。
  --    ⇒ **選擇比對什麼,要看那個東西在正式庫被驗過沒有。**
  IF v_src NOT LIKE '%- COALESCE( (SELECT SUM(r.refund_amount) FROM public.order_refunds r WHERE r.order_id = o.id AND r.status IN (''processing'', ''confirmed'')), 0)%' THEN
    RAISE EXCEPTION 'D3-b 前置閘 P4:現行定義的第①段(allowlist)不是預期的**整段字面** ⇒ '
                    '現況不是本檔預期的那一版;停下來重讀最後一支改過 pcm_order_refundable_remaining 的 migration';
  END IF;
  IF v_src NOT LIKE '%- COALESCE( (SELECT SUM(r.refund_amount) FROM public.order_refunds r JOIN public.order_refund_effective_verdict v ON v.refund_id = r.id WHERE r.order_id = o.id AND r.status = ''failed'' AND r.failed_reason = ''manual_failed'' AND v.corrected_to = ''money_moved''), 0)%' THEN
    RAISE EXCEPTION 'D3-b 前置閘 P5:現行定義的第②段(#473b-1 更正鏈)不是預期的整段字面;理由同 P4';
  END IF;
  -- 🔴 P6b(位置):第三段必須是**還沒有作廢分流的那個整段字面**。
  --    它同時證兩件事:①第三段確實長那樣(位置)②那個條件確實不在裡面(未 apply)。
  IF v_src NOT LIKE '%- COALESCE( (SELECT SUM(m.refund_amount) FROM public.order_manual_refunds m WHERE m.order_id = o.id), 0)%' THEN
    IF v_src LIKE '%AND m.voided_at IS NULL), 0)%' THEN
      RAISE EXCEPTION 'D3-b 前置閘 P6b:第三段已含作廢分流 ⇒ 本支已 apply 過;拒繼續。'
                      '🔴 這【不是】「有人破壞了什麼」—— 本支不冪等,重跑本來就會停在這裡';
    END IF;
    RAISE EXCEPTION 'D3-b 前置閘 P6b2:第三段不是預期的整段字面,而且也不是「已套過」的樣子 ⇒ '
                    '有人以本檔沒預期的方式改過它;拒繼續';
  END IF;
  -- 🔴 P6(段數):三段字面都釘死之後,這一格擋的是**多出來的第四段**。
  --    改數 `- COALESCE(`(帶減號)而不是 `COALESCE(` —— 前者才是「扣減段」的標記。
  v_seg := (length(v_src) - length(replace(v_src, '- COALESCE(', ''))) / length('- COALESCE(');
  IF v_seg <> 3 THEN
    RAISE EXCEPTION 'D3-b 前置閘 P6【觀察】:`- COALESCE(` 的出現次數是 % 而不是 3。'
                    '**成因不只一種**:①有人加了第四個扣減段 ②有人拿掉了一段 ③只是換了空白寫法。'
                    '⇒ 先把現行定義印出來看:SELECT prosrc FROM pg_proc '
                    'WHERE oid=''public.pcm_order_refundable_remaining(uuid)''::regprocedure;'
                    '⚠️ **不要為了過關放寬或刪掉本閘。**'
                    '🔴🔴 **而本閘有一個【已知擋不住】的形狀,寫在這裡免得你以為它守得住**:'
                    '一個【不用 COALESCE】寫法的第四段(例 `- (SELECT ...)`)**不會**改變本計數,'
                    '**也不會**讓 P4/P5/P6b 的三段字面比對失敗(那三道各自比對自己那一段,'
                    '中間插進去的東西不影響它們)⇒ **那種版本會穿過整組前置閘,然後被本檔靜默覆蓋。**'
                    '(本註解的前一版宣稱「那種版本會被前後文對不上擋下」—— **那句話是錯的**,'
                    ' 2026-08-20 codex R3 構造反例證偽。)', v_seg;
  END IF;

  -- 🔴🔴 P7. **封印** —— 一道斷言同時蓋住 D1(RPC 存在)與 D2(service_role 呼得到)。
  --    形狀照片 A 閘二(20260820030000:236):**先判存在,再驗能不能用**。
  --    少了「先判存在」,「函式不存在」與「存在但沒開權」會回同一種錯,查的人會查錯方向。
  IF to_regprocedure('public.admin_record_manual_refund(uuid,uuid,text,text,integer,text,timestamptz)') IS NULL THEN
    RAISE EXCEPTION 'D3-b 前置閘 P7【觀察】:找不到那個精確簽章的 admin_record_manual_refund。'
                    '**成因不只一種**:①D1(20260820021000)未 apply ②被下架 ③被改簽章。'
                    '⇒ 先查同名的有哪些:SELECT oid::regprocedure FROM pg_proc WHERE proname=''admin_record_manual_refund'';'
                    '⚠️ **D1 不冪等** —— 直接重套很可能只是產生另一個錯,先查 migration ledger';
  END IF;
  -- 🔴🔴 P7b **改過**(codex R1 must-fix):舊版只問 `has_function_privilege('service_role', …)`,
  --    而那個 true **證不了 D2 套過** —— 新函式出生就自帶 **PUBLIC EXECUTE**,
  --    service_role 會從 PUBLIC 繼承到 ⇒ 一個「D1 建了、誰都沒 REVOKE、D2 沒跑」的庫**也會通過**。
  --    ⇒ 🔴 而這一格我自己的探針**踩過**:世界③「D2 沒開權」第一版根本建不出來,
  --       因為替身沒 REVOKE ⇒ 自檢欄印出「D2開權=t」才抓到。**同一個成因。**
  -- ⇒ 現版改問 ACL 的**形狀**:PUBLIC 不得有 EXECUTE,而 service_role 必須有**直接**授權。
  --    那正是 D2 做完之後的樣子,而 PUBLIC 繼承來的不會出現在 `aclexplode` 的 grantee 裡。
  -- ⚠️ `proacl` 是 NULL 時 `aclexplode` 回零列 ⇒ 顯式先擋 NULL(否則「預設 ACL」會靜默通過)。
  SELECT p.proacl IS NULL INTO v_isnull
    FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.admin_record_manual_refund(uuid,uuid,text,text,integer,text,timestamptz)'::regprocedure;
  IF v_isnull THEN
    RAISE EXCEPTION 'D3-b 前置閘 P7b【觀察】:admin_record_manual_refund 的 proacl 是 NULL,'
                    '也就是它現在是**出廠預設(PUBLIC 可執行)**。'
                    '**成因不只一種**:①D1 的兩道 REVOKE 與 D2 的 GRANT 從來沒跑過 '
                    '②**跑過了,而後來有人把 ACL 重設回預設**(那是一個權限事件,比「沒套」嚴重)。'
                    '⇒ **先查是哪一種再動作** —— 直接重套 D1/D2 會把②那個事件蓋掉';
  END IF;
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_proc p, aclexplode(p.proacl) a
   WHERE p.oid = 'public.admin_record_manual_refund(uuid,uuid,text,text,integer,text,timestamptz)'::regprocedure
     AND a.grantee = 0 AND a.privilege_type = 'EXECUTE';        -- grantee 0 = PUBLIC
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'D3-b 前置閘 P7b2【觀察】:admin_record_manual_refund 現在對 **PUBLIC** 開放 EXECUTE(% 筆)。'
                    '⇒ 任何角色都呼得到那支登記 RPC,而「service_role 呼得到」**不能歸功給 D2**。'
                    '**成因不只一種**:①D1 的 REVOKE 沒生效 ②**後來有人重新 GRANT 給 PUBLIC**。'
                    '⇒ 撤掉 PUBLIC 可以立刻降低曝險,**而若只重套 D1,你會錯過②那個權限事件**', v_cnt;
  END IF;
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_proc p, aclexplode(p.proacl) a
   WHERE p.oid = 'public.admin_record_manual_refund(uuid,uuid,text,text,integer,text,timestamptz)'::regprocedure
     AND a.grantee = 'service_role'::regrole::oid AND a.privilege_type = 'EXECUTE';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'D3-b 前置閘 P7b3【觀察】:service_role 對 admin_record_manual_refund 沒有【直接】'
                    'EXECUTE 授權(命中 % 筆)。'
                    '⚠️ **這【不等於】它呼不到** —— 它仍可能透過角色繼承或 SET ROLE 執行得了。'
                    '**成因不只一種**:①D2(20260820022000)未 apply '
                    '②**事故處理時有人刻意撤權**。'
                    '⇒ 🔴 **不要直接重新 GRANT** —— 若是②,那會重開一條被緊急關閉的錢路徑', v_cnt;
  END IF;

  -- 🔴 P8. **反向那道:我明說【不需要】,不是沒想到。**
  --    #787 描述的危險狀態是「登記 RPC 可呼叫、而沖銷不存在」——
  --    而本片落地的那一刻就【建立了沖銷】⇒ 那個狀態在本檔 COMMIT 之後不成立。
  --    ⇒ 在這裡設一道「沖銷必須不存在」的閘,只會讓本支永遠不能重跑,而 P6b 已經擋住重跑。
  --    ⇒ **所以這一格刻意留空。** 真正要驗封印的是【登記畫面那一片】,它要驗的是本片的 RPC 可呼叫。

  RAISE NOTICE 'D3-b 前置閘 P1-P7 全過(P2 正向對照 = %,段數 = %)。', v_control, v_seg;
END
$pre$;

-- ══ 1. 可退餘額:第三段加作廢分流 ═══════════════════════════════════════════════
-- 🔴 **維持三段、不加第四段** —— 那讓 §0 指紋③ 只換一個數字(2→3 是上一支做的,本支期望 3)。
-- 🔴 第①②段**逐字取自 20260820010000 的現行定義,一個字都沒改**(程式抽取,非手抄;diff 只有一行變兩行)。
-- ⚠️ 本函式體內**刻意不寫出**任何解釋作廢語意的長註解 —— `prosrc` 含註解,而 §0/A1 都比對它的字面
--    ⇒ 在本體裡寫說明會讓那些斷言對「把分流刪掉」恆真(20260820010000 §5e 註解記過同一個坑)。
CREATE OR REPLACE FUNCTION public.pcm_order_refundable_remaining(p_order_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT o.total::bigint
       -- ↓↓ 前兩段【逐字取自 20260814190000 的現行定義,一個字都沒改】↓↓
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
       -- ↑↑ 以上為現行機制(#473b-1),本檔【只加不改】↑↑
       -- 第三段:非卡退款(本檔新表)。刻意【不】join 上面那張更正判定 view ——
       -- 那張 view 是【卡片退款的人工判定被更正】的產物,而本表沒有判定 ⇒ join 會是零列、純裝飾。
       -- 🔴🔴 **刻意不寫出那張 view 的名字** —— 下一個維護者會想「為什麼這裡不寫清楚?」,答案在這:
       --    本檔 §0 的前置斷言與 §5e 都比對 `prosrc` 的**字面**,而 **`prosrc` 含註解**
       --    ⇒ 在函式本體裡寫出那個名字,會讓那兩道斷言對「把 JOIN 整段刪掉」**恆真**。
       --    (2026-08-20 突變 N2 實測抓到:刪掉 JOIN 之後 5e **沒紅** —— 因為這行註解替它答了。)
       --    📌 通則:`prosrc` / 檔案內容 / diff 這類「整包字串」當比對對象時,
       --       **註解與 code 在裡面是同一種東西**。要寫說明,寫在函式本體【外面】。
       -- 🔴 本表【沒有 status】⇒ 沒有值域可篩 ⇒ 全部列一律計入。
       --    這不是疏忽:它記的是既成事實,不存在「還沒生效的那種列」。
       - COALESCE(
           (SELECT SUM(m.refund_amount)
              FROM public.order_manual_refunds m
             WHERE m.order_id = o.id
               AND m.voided_at IS NULL), 0)
    FROM public.orders o
   WHERE o.id = p_order_id;
$$;

-- ══ 1b. 🔴 **同步改 COMMENT —— 這一段不是文件工作,是這一片的一部分** ═══════════════
-- `CREATE OR REPLACE` **保留既有的 COMMENT** ⇒ 不動它的話,catalog 會一直說第三段計入
-- 「order_manual_refunds **全部列**」(`20260820010000:258` 逐字),而本檔剛把它改成「未作廢的列」。
-- 🔴 **下游是錢的方向**:值班的人、或下一支 migration 依 DB COMMENT 判斷
--    ⇒ 以為已作廢的列仍被計入 ⇒ 重新引入它們 ⇒ **可退餘額變小 ⇒ 客人少拿到錢**。
-- 📌 而這一格是本片作者(我)在**甲片**親手寫過的道理:
--    「COMMENT 是**唯一會跟著 schema 走的載體**;交接檔會不見,COMMENT 不會。」
--    ⇒ 我用那個理由把回退因果寫進甲片的 COMMENT,**然後在乙片讓一句 COMMENT 變成假的**。
--    ⇒ **知道一條道理,擋不住你在下一片違反它。**
-- ⚠️ ①②兩段與其餘各行**逐字取自 20260820010000:253-263,程式抽取非手抄**;本檔只改第③段那一行。
COMMENT ON FUNCTION public.pcm_order_refundable_remaining(uuid) IS
  'A7c 顯示用(RW1a → #473b-1 → 20260820010000 → 本檔 第四次改版):orders.total 減去【三段】—— '
  '① order_refunds 的 processing + confirmed;'
  '② 人工判定沒動錢、事後被更正成 money_moved 的 failed 列(#473b-1);'
  '③ order_manual_refunds **中 voided_at 為 NULL 的列**(非卡退款;'
  '🔴 **已作廢的列不計入** —— 作廢 = 「這筆登記本身是錯的」,不是「又退了一筆負的錢」;'
  '該表沒有 status,「作廢」是它唯一的失效途徑,由片 D3-b 的三欄與 admin_void_manual_refund 承擔)。'
  '🔴 ①②③ 三段值域互斥 ⇒ 不會重複扣。'
  '🔴 ① 仍為 allowlist:**未來新增任何 order_refunds.status 值預設不佔額度 —— 新增狀態時必須回訪本函式**。'
  '🔴 **不是守門、沒有 trigger 讀它**(拍板⑤)—— 而後台退款發起入口的閘吃它的輸出,'
  '⇒ 「顯示用」這個標籤不代表它不承重。'
  '🔴 只反映本帳本;Portal 場外退款不在其中 ⇒ 真實剩餘額 ≤ 本值,要真相請打 TapPay Record API。查無訂單回 NULL。';

-- ══ 2. 沖銷 RPC ═══════════════════════════════════════════════════════════════
-- 🔴 **零 GRANT**(照 D1/D2 的分期開權):本檔只建函式,EXECUTE 由「登記畫面那一片」開。
--    ⇒ 那不是紀律,是**物理封印**:本 repo 的 apply 路徑逐檔自動提交,順序不是機制。
CREATE OR REPLACE FUNCTION public.admin_void_manual_refund(
  p_refund_id   uuid,
  p_void_reason text,
  p_actor       text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_ws     CONSTANT text := E' \t\r\n';
  v_reason text;
  v_actor  text;
  v_row    public.order_manual_refunds%ROWTYPE;
  v_hit    integer;
BEGIN
  -- 步 1. 參數形狀。btrim 顯式給字集(理由同建表 20260820010000:170:預設字集只有一般空格)。
  IF p_refund_id IS NULL THEN
    RAISE EXCEPTION 'admin_void_manual_refund: 缺 refund_id ⇒ 不知道要作廢哪一筆';
  END IF;
  v_reason := pg_catalog.btrim(coalesce(p_void_reason, ''), v_ws);
  v_actor  := pg_catalog.btrim(coalesce(p_actor,  ''), v_ws);
  -- 🔴 用 pcm_b2_is_blank 不用 `<> ''`:它多擋 NBSP 與全形空格(20260805170000:56-68)。
  --    而配對 CHECK 也用它 ⇒ 這裡先擋,是為了給人話,不是為了防漏(DB 那道才是防漏)。
  IF public.pcm_b2_is_blank(v_reason) THEN
    RAISE EXCEPTION 'admin_void_manual_refund: 作廢理由不能是空白。'
                    '🔴 這一欄是「為什麼當初記錯了」的唯一紀錄 —— 沒有它,作廢與誤刪事後看起來一模一樣';
  END IF;
  IF public.pcm_b2_is_blank(v_actor) THEN
    RAISE EXCEPTION 'admin_void_manual_refund: 缺經手人 ⇒ 現金退款的失敗模式是【人】,這一欄不是裝飾';
  END IF;
  -- 🔴🔴 **比照 D1 驗 active staff**(codex R1 must-fix:舊版只擋空白 ⇒ actor 可由呼叫端隨便填)。
  --    形狀逐字同 D1(`20260820021000:199`)。
  -- ⇒ **而這一道是本 RPC「不需要 request_id」那個裁定的【前提】**:
  --    主視窗 2026-08-20 裁定拿掉 request_id,理由是「不同的人 = 不同的 payload ⇒ 會 RAISE」——
  --    🔴 **而那個推論只有在 actor 不能被冒填時才成立。** 沒有這一道,那句話只是呼叫端的自律。
  --    ⇒ **拿掉這一道 = 推翻那個裁定的前提,不是省一道檢查。**
  IF NOT EXISTS (SELECT 1 FROM public.staff s WHERE s.id = v_actor AND s.is_active) THEN
    RAISE EXCEPTION 'admin_void_manual_refund: 經手人「%」不是啟用中的 staff ⇒ 拒絕。'
                    '🔴 這一道同時是「本 RPC 不需要冪等鍵」那個設計的前提', v_actor;
  END IF;

  -- 步 2. 鎖住那一列再讀。**那一列自己就是鎖** —— 這也是本 RPC 不需要冪等鍵的原因。
  SELECT * INTO v_row FROM public.order_manual_refunds WHERE id = p_refund_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_void_manual_refund: 找不到退款登記 % ⇒ 它不存在,或已被實體刪除', p_refund_id;
  END IF;

  -- 步 3. 已經作廢過了?
  IF v_row.voided_at IS NOT NULL THEN
    IF v_row.void_reason IS NOT DISTINCT FROM v_reason
       AND v_row.voided_by IS NOT DISTINCT FROM v_actor THEN
      -- 同一人、同一理由 ⇒ 就是同一個操作。
      RETURN pg_catalog.jsonb_build_object(
        'voided', true, 'idempotent', true, 'refund_id', v_row.id);
    END IF;
    -- 🔴 訊息要寫出**現況**,不是只寫「衝突」——
    --    看到這句話的是員工,他要的是「已經有人做過了、是誰、什麼時候、理由是什麼」,不是錯誤碼。
    RAISE EXCEPTION 'admin_void_manual_refund: 這筆退款已於 % 由「%」以理由「%」作廢。'
                    '你這次送的是經手人「%」、理由「%」⇒ 兩者不同,本 RPC 不覆蓋既有的作廢紀錄。'
                    '⇒ 若你認為既有那筆記錯了,那是另一件事(要改作廢紀錄本身),本 RPC 做不到',
                    v_row.voided_at, v_row.voided_by, v_row.void_reason, v_actor, v_reason;
  END IF;

  -- 步 4. 寫入。`AND voided_at IS NULL` 是防 TOCTOU 的那一半 ——
  --   🔴 **對照組實測**:拿掉它,兩個併發 session 的第二發會 `UPDATE 1` 蓋掉第一發(W1-085 附錄世界③)。
  UPDATE public.order_manual_refunds
     SET voided_at   = now(),
         void_reason = v_reason,
         voided_by   = v_actor
   WHERE id = p_refund_id
     AND voided_at IS NULL;
  GET DIAGNOSTICS v_hit = ROW_COUNT;

  IF v_hit <> 1 THEN
    -- ⚠️ **誠實邊界:這一格我構造不出來。**
    --   步 2 的 `FOR UPDATE` 在 READ COMMITTED 之下會在鎖釋放後**重讀**那一列
    --   ⇒ 併發的第二發會在步 3 就看到 `voided_at` 非 NULL,走不到這裡。
    --   ⇒ 依本 repo 紀律,我**不宣稱它是縱深** —— 它是 fail-closed 的兜底,而**沒有測試證得了它**。
    --   ⇒ 什麼會讓它變成活的:有人把步 2 的 `FOR UPDATE` 拿掉、或把隔離等級調成 REPEATABLE READ
    --      (RR 之下第二發拿到的是序列化失敗,整筆交易中止 —— 也走不到這裡)。
    RAISE EXCEPTION 'admin_void_manual_refund: 寫入影響 % 列(預期 1)⇒ 在讀到它與寫入它之間有人動了那一列;'
                    'fail-closed 拒絕。請重新讀取那筆退款的現況再決定', v_hit;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'voided', true, 'idempotent', false, 'refund_id', p_refund_id);
END
$fn$;

COMMENT ON FUNCTION public.admin_void_manual_refund(uuid, text, text) IS
  '把一筆登記錯的非卡退款標成作廢(M-4b E10 片 D3-b)。'
  '🔴 **作廢不是「又退了一筆負的錢」,是「這筆登記本身是錯的」** —— 錢有沒有真的交回去看 actor 與稽核。'
  '🔴 **刻意沒有 request_id**:沖銷是對一列特定的列做狀態轉移,而「它作廢了沒」那一列自己就答得出來;'
  'D1 的登記需要鍵是因為它是【新增一筆】。⇒ 冪等由 (voided_at, void_reason, voided_by) 三欄承擔。'
  '⚠️ 分不出「同一人同理由按兩次」—— 而那在任何意義下就是同一個操作;不同的人 = 不同 payload ⇒ 會 RAISE。'
  '🔴 **併發下呼叫端會拿到兩種不同的東西**(拋棄式 PG 17.10 實測,W1-085 附錄):'
  'READ COMMITTED(Supabase 預設)⇒ 走冪等分支,回 idempotent:true;'
  'REPEATABLE READ ⇒ **拿到 `could not serialize access due to concurrent update`,冪等分支走不到**。'
  '兩者都安全(都沒有遺失更新),但**呼叫端該說的話不一樣** ⇒ 顯示面要吃得下兩種。'
  '🔴🔴 **本函式的【行為】驗證住在 `scripts/d3b-void-probe.sh`** —— 冪等、換人必拒、'
  '作廢後可退餘額差額必須正好等於那一筆。**那支腳本不在 CI,不會自己紅** ⇒ 動本函式的人請跑它。'
  '(為什麼不放 migration:借正式資料 ⇒ 空庫失敗 / 活庫受真流量影響;而交易內自造資料會踩 '
  'subtotal-writers-allowlist 與片1a 的兩支 trigger ⇒ 雙重不通。2026-08-20 codex R2 + 主視窗裁定。)'
  '🔴 本函式**零 GRANT** —— 開權是「退款登記畫面」那一片的事,而那一片要自帶一道驗本函式可呼叫的前置閘。'
  '⚠️ 本函式**不做**權限判斷:誰能叫它由 GRANT 與呼叫端決定。'
  '🔴🔴 **而 `p_actor` / `voided_by` 記的是「操作者自己挑的身分」,不是登入身分。**'
  '本函式會驗那個 id 是**存在且啟用中**的 staff(比照 D1)—— 而那只證明「填的是一個有效的名字」,'
  '**不證明「按下去的人就是那個人」**:actor 來自使用者可自行選擇的 cookie'
  '(`apps/admin/src/lib/session/actor.ts:6`),任何已登入者都能挑另一位啟用中的 staff。'
  '⇒ **所以 voided_by 看起來像身分,而它不具身分證明力。** 這是 E8-B(真登入)那條線的洞,'
  '在一條動錢的路上現形 —— 2026-08-20 codex R3 指出,已上報 Sean。'
  '⚠️ **不要拿它當稽核的唯一依據**,也不要因為它存在就以為「誰做的」已經記錄下來了。'
  '🔴 **連帶:本函式「不需要冪等鍵」那個設計的理由,要照下面這句讀,不要照舊的那句**'
  '(2026-08-20 主視窗裁定,codex R3 之後改寫;裁定本身不撤,改的是它的理由):'
  '❌ 舊:「不同的人會被擋下」 ——— 那句把 payload 不同讀成了操作者不同。'
  '✅ 新:「**同一列 + 同一組(reason, 被挑的身分)視為同一次操作;而【誰真的按了】本函式答不出來。**」'
  '⇒ 冪等仍然成立(狀態轉移的語意沒變),而**它分辨的是 payload,不是人**。'
  '⇒ 🔴 **所以不要拿 voided_by 去做責任歸屬** —— 同一個人挑兩個名字會被擋,'
  '而兩個人挑同一個名字不會。';

-- ══ 3. EXECUTE 收斂:新函式出生就自帶 PUBLIC EXECUTE,兩道 REVOKE 缺一不可 ═══════
REVOKE ALL ON FUNCTION public.admin_void_manual_refund(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_void_manual_refund(uuid, text, text) FROM anon, authenticated, service_role;
-- 🔴 **這裡刻意沒有 GRANT。** 見上方 COMMENT 最後兩行。

-- ══ 4. 後置驗收 ═══════════════════════════════════════════════════════════════
-- 🔴🔴 **本節【只回答一個問題】:「我剛才那一發 DDL,做出了我要的東西嗎?」**
--    它**不回答**「這支函式永遠是對的」—— 那是持續性的問題,而 apply 期的斷言**一輩子只跑一次**。
--    ⇒ 持續性那一半住在 `packages/domain/src/order/refund-remaining-single-source.test.ts`
--      (每次 CI 都跑),而**它才是那個性質的守門**。
--    ⇒ 而行為(這支 RPC 做對事沒有)住在 `scripts/d3b-void-probe.sh`。
-- 📌 **三類斷言,三個載體,壽命不同**:
--    前狀態(§0 P4/P5/P6b)= 只有 apply 期問得到 ⇒ 留這裡
--    後狀態(本節)        = 只有 apply 期問得到 ⇒ 留這裡
--    持續性 / 行為         = 每次都該問 ⇒ **不在這裡**
DO $post$
DECLARE
  v_src text;   -- A1 用它裝 prosrc、A2b 用它裝「多出來的 grantee」
  -- ⚠️ 原本還宣告了 v_cnt / v_control / v_order / v_rid / v_res / v_ok / v_before /
  --    v_staff / v_staff2 / v_amt / v_rem_before / v_rem_after —— **隨 A3 整段一起移除**。
  --    留著不會報錯,而一堆沒人用的變數會讓下一個人以為這裡曾經有那些檢查。
BEGIN
  -- ── A1. 三段字面(形狀照 20260820010000:349-370)────────────────────────────
  SELECT p.prosrc INTO v_src
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'pcm_order_refundable_remaining'
     AND pg_catalog.pg_get_function_identity_arguments(p.oid) = 'p_order_id uuid';
  v_src := regexp_replace(regexp_replace(v_src, '--[^\n]*', '', 'g'), '\s+', ' ', 'g');

  IF v_src NOT LIKE '%- COALESCE( (SELECT SUM(r.refund_amount) FROM public.order_refunds r WHERE r.order_id = o.id AND r.status IN (''processing'', ''confirmed'')), 0)%' THEN
    RAISE EXCEPTION 'D3-b 後置 A1-①:第①段(order_refunds allowlist)不是預期字面 ⇒ 本檔把它改掉或弄丟了;拒繼續';
  END IF;
  IF v_src NOT LIKE '%- COALESCE( (SELECT SUM(r.refund_amount) FROM public.order_refunds r JOIN public.order_refund_effective_verdict v ON v.refund_id = r.id WHERE r.order_id = o.id AND r.status = ''failed'' AND r.failed_reason = ''manual_failed'' AND v.corrected_to = ''money_moved''), 0)%' THEN
    RAISE EXCEPTION 'D3-b 後置 A1-②:第②段(#473b-1 更正鏈)不是預期字面 ⇒ 同上;拒繼續';
  END IF;
  -- 🔴 第三段:本檔唯一改動的那一段。
  IF v_src NOT LIKE '%- COALESCE( (SELECT SUM(m.refund_amount) FROM public.order_manual_refunds m WHERE m.order_id = o.id AND m.voided_at IS NULL), 0)%' THEN
    RAISE EXCEPTION 'D3-b 後置 A1-③【觀察】:第③段(非卡退款)不是預期的整段字面。'
                    '⚠️ 本檔剛剛才 CREATE OR REPLACE 過它 ⇒ 若這裡不符,**多半不是「有人改了它」**,'
                    '而是本檔寫出來的東西與 catalog 的輸出對不上(正規化規則、或 DDL event trigger)。'
                    '🔴 **先讀 prosrc 的實際差異,不要放寬本斷言** —— 放寬會讓一個錯的算式提交。'
                    '**而若真的是內容錯,成因至少有四種**:'
                    '①減號被改成加號 ②多了 AND false ③表名不對 '
                    '④🔴 **作廢分流(AND m.voided_at IS NULL)不見了** —— 那會讓已作廢的列重新被扣,'
                    '⇒ 可退餘額變小 ⇒ **客人少拿到錢,而畫面上一切正常**;拒繼續';
  END IF;

  -- ── A2. RPC 存在,而且 service_role **呼不到**(零 GRANT 的證明)─────────────
  IF to_regprocedure('public.admin_void_manual_refund(uuid,text,text)') IS NULL THEN
    RAISE EXCEPTION 'D3-b 後置 A2【觀察】:找不到 admin_void_manual_refund(uuid,text,text)。'
                    '🔴 **而這一格本身就是異常** —— 本檔上面的 CREATE OR REPLACE 明明已經成功走過,'
                    '同一筆交易裡它卻不在 ⇒ 這通常不是「沒建起來」,是**有東西在改寫 DDL**'
                    '(event trigger / schema 改寫 / search_path)。'
                    '⇒ **重跑通常無效**,先查那個';
  END IF;
  SELECT string_agg(x.who, ', ' ORDER BY x.who) INTO v_src
    FROM (SELECT a.grantee::regrole::text AS who
            FROM pg_catalog.pg_proc p, aclexplode(p.proacl) a
           WHERE p.oid = 'public.admin_void_manual_refund(uuid,text,text)'::regprocedure
             AND a.grantee <> p.proowner) x;
  IF v_src IS NOT NULL THEN
    RAISE EXCEPTION 'D3-b 後置 A2b:本檔應零 GRANT,而 owner 之外還有:% ⇒ 封印破了;拒繼續', v_src;
  END IF;
  IF has_function_privilege('service_role', 'public.admin_void_manual_refund(uuid,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'D3-b 後置 A2c【觀察】:service_role 對剛建好的沖銷 RPC 有**有效** EXECUTE ⇒ 封印破了。'
                    '⚠️ 而本閘**不告訴你它是怎麼拿到的**:可能是直接授權、角色繼承、或 SET ROLE 路徑。'
                    '⇒ 先查角色關係(pg_auth_members)再撤掉**實際那條路徑** —— '
                    '**只再跑一次 REVOKE 很可能沒用**';
  END IF;
  -- 🔴 A2d **正向對照** —— 沒有它,A2c 的 false 同時相容於「封印成立」與
  --    「has_function_privilege 在這個環境對什麼都回 false」。
  -- ⚠️ **而它控的是【量具】,不是【D2 套過沒】**(codex R1 指出舊註解沿用了同一個假設):
  --    這一發回 true 只證明「這支函式在這個環境會回 true 給某個東西」——
  --    它**證不了** service_role 是從 D2 拿到權限的(PUBLIC 繼承也會讓它回 true)。
  --    ⇒ **證明 D2 套過的是 §0 的 P7b2/P7b3(ACL 形狀),不是這一格。** 兩件事別混。
  IF NOT has_function_privilege('service_role',
        'public.admin_record_manual_refund(uuid,uuid,text,text,integer,text,timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'D3-b 後置 A2d(對照組)【觀察】:service_role 對【本該開權的】登記 RPC 也回 false。'
                    '🔴🔴 **這一句最容易被誤讀,所以把成因排序寫出來**:'
                    '**最可能的是①登記 RPC 的 EXECUTE 真的被撤掉了**(那是既有退款入口的權限事件,'
                    '比本片重要,先去查它)②那支函式漂移了 ③service_role 的角色關係變了 '
                    '④最後才是「has_function_privilege 這個量法在這個環境壞了」。'
                    '⚠️ **不要因為這一格就不信 A2c、去放寬檢查** —— 那個方向會讓封印靜靜失效';
  END IF;

  -- 🔴 **本檔【不驗這支 RPC 的行為】** —— 冪等、換人必拒、作廢後可退餘額差額,
  --    全部在 `scripts/d3b-void-probe.sh`(零參數、拋棄式 PG、跑完自己收攤)。**那支不在 CI。**
  --    ⇒ 動這支 RPC 或那支算式之後,請跑它。為什麼搬出去,寫在那支腳本的檔頭。

  -- 🔴 這則 NOTICE 會在 COMMIT 【之前】就印出來 ⇒ 若交易在 COMMIT 當下才失敗
  --    (延遲約束 / event trigger),值班的人會先看到「全過」再看到 ERROR,而**整筆是回滾的**。
  --    ⇒ 所以訊息裡自己講這件事。
  RAISE NOTICE 'D3-b 後置 A1(三段字面)+ A2(零 GRANT,含 A2d 對照)全過。'
               '⚠️ **這行印出來不等於本片已經套上去** —— 它在 COMMIT 之前。'
               '若你接著看到 ERROR,**整筆回滾,正式庫完全沒有本片**;不要當成「大部分成功」。'
               '⚠️ **本檔【沒有】驗過這支 RPC 的行為** —— 冪等、換人必拒、可退餘額差額'
               '都在 scripts/d3b-void-probe.sh,而那支不在 CI,要人去跑。';
END
$post$;

COMMIT;
