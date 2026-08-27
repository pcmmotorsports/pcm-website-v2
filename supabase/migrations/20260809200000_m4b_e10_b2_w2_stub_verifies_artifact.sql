-- ══════════════════════════════════════════════════════════════════════════
-- W2 半成品閘:從「鍵在不在」升級成「**產物在不在**」+ 凍結誰碰得到冪等帳
-- ══════════════════════════════════════════════════════════════════════════
-- 來源:codex 補審 `docs/reviews/2026-08-08-codex-backfill-findings.md` §#4 MF-2。
-- B 窗 triage = `B-333-STOP`(判 P2:應用層構造不出來,但守門確實沒驗產物)。
-- 主視窗 `B-334-A` 裁:**D + A 併一片現在做**;B 案(內容指紋)= #355 併 W8;C(FORCE RLS)不做。
--
-- ── A:deferred 半成品閘現在會驗產物 ────────────────────────────────────
-- 原本只問「`shipment_id` 是不是 NULL」。一筆「正確 hash + 既存 shipment_id + 空快照」的
-- 假收據**兩道守門都放行**(INSERT 守門只驗快照欄位、deferred 閘只驗非 NULL)⇒ 之後任何
-- 用同一把鍵的重試都拿到「成功」信封,而 ship / unvoid 從來沒發生過。
-- = memory `feedback_idempotency-key-must-be-verified-not-just-present` 的形狀:
--   **看到鍵在,不等於查驗過產物。**
--
-- 🔴 為什麼畫在 trigger 上而不是 `record()` 裡:`record()` 其實**已經**驗了包裹存在
--    (`…w2…:371-374` 的 `pcm_b2_w2_record_no_such_shipment`),但那條只擋走 `record()` 的路。
--    本 finding 講的正是**繞過 `record()` 直寫**的那條路。W2 檔內 `:376-378` 自己寫過同一句
--    道理:「五支是 SECURITY DEFINER、以 owner 執行,body 裡直接寫一句 UPDATE 就完全繞過本函式」
--    ⇒ 守門要畫在**不變量成立的那個面**,也就是表上的 trigger。
--
-- 🔴🔴 **本檔用 CREATE OR REPLACE 重寫這支函式,`SECURITY DEFINER` 一個字都不能少。**
--    它在 `20260809190000`(正式站 42501 修復)才從 INVOKER 改過來;`CREATE OR REPLACE` 不寫
--    就會退回 INVOKER = 把那個事故原樣放回去。檔尾有一道斷言專門釘這件事。
--
-- ── D:凍結「誰碰得到冪等帳」 ───────────────────────────────────────────
-- triage 挖到的、比原 finding 更值得記的一條:MF-2 判成 P2 的前提是五條到期條件,
-- 其中前三條(GRANT 表 / 加 policy / GRANT record 的 EXECUTE)有 `w0b-verify.sh:407` 盯著,
-- 但第 4、5 條 —— **新的 SECDEF 函式把呼叫端可控的值餵進 `record()`、或出現能寫該表的動態 SQL**
-- —— 原本**完全沒有任何自動化盯著**。
--
-- 🔴🔴 **這裡的斷言不是「凍結」,是 apply 當下的一次性檢查**(codex 關卡2 must-fix,他對):
--    migration 的 DO block 只在自己被套用的那一刻跑。明天有片新增了 `record()` 的呼叫者,
--    全量重放時本檔**排在它前面先跑** ⇒ 斷言當下還是乾淨的、攔不到。
--    **持續守門在 `scripts/w5-line-verify.sh` 的 `LINE-LEDGER-WRITE-SURFACE`** ——
--    那支重放整個目錄到尖端之後才量,看到的是最終狀態。兩份清單要同批改。
--    本檔這份留著的價值:**apply 到正式庫的那一刻**驗一次(harness 跑在裸 PG,證不了 A 庫)。
-- 🔴 兩份的**形狀也刻意不同**(codex 關卡2 nit):本檔這份只擋「多出來的」(禁止擴張),
--    harness 那份是**逐字全等**(改名、被刪也會紅)。理由:本檔在重放序裡跑在自己的時點上,
--    逐字全等對它沒有額外資訊;而 harness 看的是尖端,漏掉一支才是真的有人會踩的洞。
--
-- 🔴 凍結清單全部是 **catalog 實測**得來的,不是數原始碼(memory
--    `reference_count-objects-from-catalog-not-create-statements`:建立敘述只講歷史)。
--    實測當下推翻了我兩個假設:
--      ① 呼叫 `record()` 的是**六支不是五支** —— `admin_add_shipment_items` 已被 W4-2 換成
--         薄封裝,真正呼叫的是 `pcm_b2_add_items_impl`。
--      ② `pcm_b2_shipping_idem_require_complete` 也在名單裡,但它**不是呼叫者** ——
--         它只是在錯誤訊息的字串裡提到那個函式名。字面比對分不出這件事,寫下來免得被當成洞。
-- ══════════════════════════════════════════════════════════════════════════

-- ── A ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pcm_b2_shipping_idem_require_complete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER          -- 🔴 見檔頭:少這一行 = 把 42501 原樣放回去
SET search_path = ''
AS $$
DECLARE
  v_sid  uuid;
  v_snap jsonb;
BEGIN
  -- 🔴 必須**重讀表**、不得用 `NEW`:deferred AFTER trigger 的 `NEW` 是觸發當下那個列版本
  --    (shipment_id 仍是 NULL),用它會把每一筆正常流程都判死。這條 W2 已實測過。
  SELECT shipment_id, result_snapshot INTO v_sid, v_snap
    FROM public.pcm_b2_shipping_idempotency
   WHERE action = NEW.action AND idempotency_key = NEW.idempotency_key;

  IF v_sid IS NULL THEN
    -- 🔴 訊息**不得下斷語說「業務層漏了呼叫 record()」** —— 同樣的觀察還有兩個成因:
    --    ① `record()` 被 SAVEPOINT 包住而該 savepoint 被 rollback ② 該列在本交易外被移除。
    RAISE EXCEPTION '出貨冪等:交易結束時這把單號的存根仍未回填包裹(action=% key=%)⇒ 整筆擋下,單號不會被燒掉。'
                    '可能成因:業務層沒有呼叫 pcm_b2_shipping_idem_record()、或那次呼叫被 SAVEPOINT 回捲、或該存根列被移除。',
                    NEW.action, NEW.idempotency_key
      USING ERRCODE = 'P2B25', CONSTRAINT = 'pcm_b2_w2_stub_incomplete_at_commit';
  END IF;

  -- 🔴 新增①:**產物真的存在**。擋的是「填了一個不存在的 shipment_id」——
  --    `record()` 有同名檢查,但那條只在走 `record()` 時成立;直寫繞過它。
  --    🔴 **刻意不濾 `deleted_at IS NULL`**:void / unvoid 的收據本來就指向 soft-deleted 的列。
  --       後人「順手加嚴」會把整條作廢線打死 —— 這裡量的是「這張包裹存在過嗎」,不是「它現在活著嗎」。
  --    🔴 代價寫明:commit 當下多讀一張表 ⇒ 失敗面(含 40P01)落在 COMMIT,
  --       而 W7d-1 的有界重試只包住函式體內那段 LOOP、包不住 commit 期的錯誤 ⇒ 整筆 rollback,
  --       要重試得由交易外層做。
  --    🔴 鎖:不新增**列鎖**順序(純 AccessShare,且 writer 交易此時早已持有 shipments 的
  --       RowExclusive)⇒ 一般 DML 之間構造不出新的環。**但不敢說「無新死結環」** ——
  --       與 AccessExclusive 的 DDL(如 ALTER TABLE shipments)仍可能組成等待(codex 關卡2 nit)。
  IF NOT EXISTS (SELECT 1 FROM public.shipments s WHERE s.id = v_sid) THEN
    RAISE EXCEPTION '出貨冪等:存根指向的包裹不存在(action=% key=% shipment_id=%)⇒ 整筆擋下。'
                    '這代表存根不是任何一次真實動作的產物 —— 若放行,往後的重試會拿到「成功」信封而事情從沒發生。',
                    NEW.action, NEW.idempotency_key, v_sid
      USING ERRCODE = 'P2B25', CONSTRAINT = 'pcm_b2_w2_stub_shipment_missing';
  END IF;

  -- 🔴 新增②:**快照不是空的**。擋的正是 codex 描述的那筆「空快照假收據」。
  --    值域實測(2026-08-09,跑完整 E2E 後查鍵表):五支 action 的 result_snapshot
  --    全部是 3 鍵的非空 jsonb object ⇒ 這道對正常流程零誤擋,對 `{}` 有判別力。
  --    🔴 誠實邊界:非空**不等於內容正確** —— 塞一份「別次動作的快照」照樣過。
  --      那要靠內容指紋(#355,併 W8 鍵契約)。本片只關掉「空的」那一種。
  IF v_snap IS NULL OR pg_catalog.jsonb_typeof(v_snap) <> 'object' OR v_snap = '{}'::jsonb THEN
    RAISE EXCEPTION '出貨冪等:存根的快照是空的或形狀不對(action=% key=% typeof=%)⇒ 整筆擋下。'
                    '正常流程一定會回填非空的信封;空快照代表這筆存根不是真實動作留下的。',
                    NEW.action, NEW.idempotency_key, coalesce(pg_catalog.jsonb_typeof(v_snap), 'NULL')
      USING ERRCODE = 'P2B25', CONSTRAINT = 'pcm_b2_w2_stub_snapshot_empty';
  END IF;

  RETURN NULL;
END
$$;

COMMENT ON FUNCTION public.pcm_b2_shipping_idem_require_complete() IS
  'W2 半成品閘(對抗審查 R1-F2)。DEFERRED ⇒ 在 commit 當下才看,讓同交易的回填來得及。'
  '🔴 重讀表而非用 NEW:deferred trigger 的 NEW 是觸發當下的列版本(shipment_id 仍 NULL),用它會誤殺正常流程。'
  '🔴 三道:存根已回填 / 產物真的存在 / 快照非空。後兩道是 codex #4 MF-2 的落地 —— '
  '守門畫在**表**上而不是 record() 裡,因為那個 finding 講的就是繞過 record() 直寫的路。'
  '🔴 SECURITY DEFINER 不可退回 INVOKER:DEFERRED 在 commit 當下以 session 角色執行,'
  '而本表對 service_role REVOKE ALL ⇒ 退回去就是 2026-08-09 的正式站 42501 事故。'
  '🔴 快照只驗「非空」,不驗「內容對不對」—— 內容指紋是 #355(併 W8 鍵契約)。';

-- ── 檔尾 fail-closed 斷言 ─────────────────────────────────────────────────
-- 🔴 `DEF` 那個 CASE 是**求值順序屏障**,不是美觀:直接寫
--      WHERE n.nspname = 'public' AND pg_get_functiondef(p.oid) LIKE ...
--    會被規劃器先套函式再過濾 schema ⇒ 打到 `pg_catalog` 的聚合、當場拋
--    「array_agg is an aggregate function」(首跑實錘)。**謂詞求值順序沒有保證**,
--    要靠 CASE 把「不是普通函式/程序就不要叫 pg_get_functiondef」寫成語意上的先後。
--    (R1 一度說我「repo 有自訂聚合」那句是假的 —— 他對:repo 零 `CREATE AGGREGATE`。
--     真因是求值順序,不是有聚合。字面已照事實改。)
DO $stub_artifact_asserts$
DECLARE
  v_n   integer;
  v_bad text;
  -- 🔴 catalog 實測值(2026-08-09),**全簽章**、掃所有非系統 schema。
  --    只比 proname 會被**同名 overload** 繞過(a9h 事故形狀:正式站壞 8 小時)⇒ 比 regprocedure。
  --    只掃 public 也不夠:repo 已有第二個帶函式的 schema `pcm_cron`(L3a 今天還在用)。
  c_record_callers CONSTANT text[] := ARRAY[
    'public.admin_create_shipment(text,uuid,jsonb,text,text)',
    'public.admin_mark_shipment_shipped(text,uuid,text)',
    'public.admin_unvoid_shipment(text,uuid)',
    'public.admin_void_shipment(text,uuid,text)',
    'public.pcm_b2_add_items_impl(text,uuid,jsonb)',
    -- 🔴 這支**不是呼叫者** —— 它只在錯誤訊息的字串裡提到那個函式名。字面比對分不出來,
    --    留在清單裡是因為清單比的就是字面;寫下來免得後人把它當成一條洞。
    'public.pcm_b2_shipping_idem_require_complete()'];
  c_table_touchers CONSTANT text[] := ARRAY[
    'public.pcm_b2_shipping_idem_claim(text,text,text)',
    'public.pcm_b2_shipping_idem_record(text,text,uuid,jsonb)',
    'public.pcm_b2_shipping_idem_require_complete()'];
BEGIN
  -- ① A 的自我釘:這支必須是 SECDEF。本檔自己就是最可能弄丟它的人
  --    (`CREATE OR REPLACE` 漏寫一行就退回 INVOKER)。實測:把那行刪掉 ⇒ 本斷言當場拒絕。
  SELECT p.prosecdef::int INTO v_n
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'pcm_b2_shipping_idem_require_complete';
  IF coalesce(v_n, 0) <> 1 THEN
    RAISE EXCEPTION 'pcm_b2_shipping_idem_require_complete 不是 SECURITY DEFINER ⇒ 這正是 20260809190000 修掉的 42501 事故,拒絕通過'
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_b2_w2_stub_trigger_must_be_secdef';
  END IF;

  -- ②🔴 SECDEF 讀表的**致命前提**:那兩張表不能開 FORCE ROW LEVEL SECURITY。
  --    FORCE 之下連 owner(= definer)都受 policy 管,而兩張表都是零 policy ⇒
  --    `EXISTS (SELECT 1 FROM shipments …)` 會恆假 ⇒ **每一筆正常出貨在 commit 當下
  --    死於 stub_shipment_missing**。這不是理論:本片 triage(B-333)自己把「C = FORCE RLS」
  --    列成待議選項,哪天有人採納就會踩到。repo 有先例補這道(a5a / a2b1 / a4a / 347-1)。
  --    🔴 精確講(codex 關卡2 nit):FORCE RLS **不必然**讓 SECDEF 失效 —— 加了合適的 policy、
  --      或 definer 帶 BYPASSRLS,照樣讀得到。所以這道是**架構層的禁令**(本 repo 現在不用 FORCE),
  --      不是能力判定。真要開 FORCE,配套是替這支配 policy,然後回來改這道。
  SELECT pg_catalog.count(*)::integer,
         pg_catalog.string_agg(c.relname, ', ' ORDER BY c.relname)
    INTO v_n, v_bad
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname IN ('shipments', 'pcm_b2_shipping_idempotency')
     AND c.relforcerowsecurity;
  IF v_n > 0 THEN
    RAISE EXCEPTION '(%) 開了 FORCE ROW LEVEL SECURITY ⇒ 半成品閘這支 SECDEF 會被自己的 policy 擋死、'
                    'EXISTS 恆假 ⇒ 每一筆正常出貨都會在 commit 當下被誤擋。要開 FORCE 得先給這支配 policy。', v_bad
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_b2_w2_stub_tables_must_not_force_rls';
  END IF;

  -- ③ D-1:誰呼叫得到 record()。新的 SECDEF 函式/程序把可控值餵進去 = MF-2 的到期條件之一。
  --    🔴 正規式帶 `[[:space:]]*` —— 函式名與 `(` 之間可以有空白/換行,**不需要惡意,格式化就會發生**。
  SELECT pg_catalog.count(*)::integer,
         pg_catalog.string_agg(n.nspname || '.' || p.oid::regprocedure::text, ', ' ORDER BY n.nspname || '.' || p.oid::regprocedure::text)
    INTO v_n, v_bad
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND n.nspname NOT LIKE 'pg\_%'
     AND CASE WHEN p.prokind IN ('f','p') THEN pg_catalog.pg_get_functiondef(p.oid) ELSE NULL END
         ~* 'pcm_b2_shipping_idem_record[[:space:]]*\('
     AND p.proname <> 'pcm_b2_shipping_idem_record'
     AND NOT (n.nspname || '.' || p.oid::regprocedure::text = ANY (c_record_callers));
  IF v_n > 0 THEN
    RAISE EXCEPTION '出現新的函式/程序引用 pcm_b2_shipping_idem_record()(%):冪等帳的寫入面變大了。'
                    '請確認它傳進去的 action/key/shipment_id/snapshot **不是呼叫端可控的**,'
                    '確認後把**完整簽章**加進本檔的 c_record_callers。', v_bad
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_b2_w2_new_record_caller';
  END IF;

  -- ④ D-2:誰的 body 碰得到鍵表本身。
  SELECT pg_catalog.count(*)::integer,
         pg_catalog.string_agg(n.nspname || '.' || p.oid::regprocedure::text, ', ' ORDER BY n.nspname || '.' || p.oid::regprocedure::text)
    INTO v_n, v_bad
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND n.nspname NOT LIKE 'pg\_%'
     AND CASE WHEN p.prokind IN ('f','p') THEN pg_catalog.pg_get_functiondef(p.oid) ELSE NULL END
         ILIKE '%pcm_b2_shipping_idempotency%'
     AND NOT (n.nspname || '.' || p.oid::regprocedure::text = ANY (c_table_touchers));
  IF v_n > 0 THEN
    RAISE EXCEPTION '出現新的函式/程序碰到 pcm_b2_shipping_idempotency(%):它繞得過 claim/record 這兩個唯一入口。'
                    '確認後把完整簽章加進本檔的 c_table_touchers。', v_bad
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_b2_w2_new_table_toucher';
  END IF;

  -- ⑤ D-3:動態 SQL 寫入面必須維持零。
  --    🔴🔴 **這道的上限要講清楚**(codex 關卡2):文字掃描擋得到的只有「body 裡看得到完整表名」。
  --      ①`EXECUTE format('…%s…', 拼出來的表名)` —— 組字之後字面上沒有表名,三道全放行;
  --      ②經 view / rule 間接寫鍵表(比的是表名字面,view 名不會命中);
  --      ③`quote_ident`/串接組出來的函式名同理。
  --      這三種**用靜態文字掃描關不掉**,不是我漏寫。真要關得換機制(event trigger 監看 DDL,
  --      或靠 owner-only + 逐支人工核可)。寫下來,不假裝關完。
  SELECT pg_catalog.count(*)::integer,
         pg_catalog.string_agg(n.nspname || '.' || p.oid::regprocedure::text, ', ' ORDER BY n.nspname || '.' || p.oid::regprocedure::text)
    INTO v_n, v_bad
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND n.nspname NOT LIKE 'pg\_%'
     AND CASE WHEN p.prokind IN ('f','p') THEN pg_catalog.pg_get_functiondef(p.oid) ELSE NULL END
         ILIKE '%pcm_b2_shipping_idempotency%'
     AND CASE WHEN p.prokind IN ('f','p') THEN pg_catalog.pg_get_functiondef(p.oid) ELSE NULL END
         ~* 'EXECUTE[[:space:]]';
  IF v_n > 0 THEN
    RAISE EXCEPTION '有函式/程序在 body 裡同時出現動態 EXECUTE 與冪等帳表名(%)⇒ 靜態清單守不住它,人要看一眼', v_bad
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_b2_w2_dynamic_sql_touches_ledger';
  END IF;

  -- ⑥ 前置自證:上面三道若因為「一支都沒撈到」而恆真,這裡會擋下。
  SELECT pg_catalog.count(*)::integer INTO v_n
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND n.nspname NOT LIKE 'pg\_%'
     AND CASE WHEN p.prokind IN ('f','p') THEN pg_catalog.pg_get_functiondef(p.oid) ELSE NULL END
         ILIKE '%pcm_b2_shipping_idempotency%';
  IF v_n <> 3 THEN
    RAISE EXCEPTION '掃描前置沒成立:碰到鍵表的函式實得 % 支、凍結值 3 ⇒ 上面三道的判定基礎已經變了,拒絕通過', v_n
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_b2_w2_ledger_toucher_count';
  END IF;

  RAISE NOTICE 'W2 存根產物斷言通過:trigger 是 SECDEF、兩張表未開 FORCE RLS、record 呼叫者 % 筆簽章、碰表函式 3 支、動態 SQL 0 支',
               pg_catalog.array_length(c_record_callers, 1);
END
$stub_artifact_asserts$;
