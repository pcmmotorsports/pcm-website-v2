-- ============================================================
-- #452 片 2a-2「乙」:採購作廢 RPC admin_void_item_procurement
-- ============================================================
-- 上游 plan = docs/specs/2026-08-14-452-2a2-procurement-void-rpc-plan.md(C 案瘦身版 v3)
--   · 守門逐條 = plan §2.4 步表(V1-V8 + 三條尾列)
--   · 冪等帳本 = plan §2.4b(專屬表,不用稽核帳)
--   · 函式屬性 = plan §2.4d
--   · 人話出口 = plan §2.5
--   · 附錄 A(V 窗 2026-08-14 補)= DB 端反向盤點,本檔多處引用
-- 授權:Sean 2026-08-14 傍晚批准開工實作(鐵則 8 跨 3+ 檔 + 鐵則 12①③)。
--       🔴 **批准的是「寫」,不是「apply」。apply 仍是 Sean 本人的停點。**
--
-- 前一片(甲)= 20260814100000,**已 apply**(supabase/APPLIED.tsv,sha256 963aefc7…)。
--   甲把兩個相鄰 writer(A5a / admin_record_item_receipt)改成認得 voided;
--   **本支是這條線上第一個會【產生】voided 列的東西。**
--
-- 🔴 順序承重(plan §3.3):甲必須在乙之前 apply。
--   甲的前置閘 P4 用「偵測到本支已存在就 RAISE」擋反向;
--   本支的前置閘 P2 用「偵測不到甲的字面就 RAISE」擋正向。**兩道閘互為對方的證明。**
--
-- ── 🔴 本支與 plan §4.1 的一處【已知偏離】,不是漏做 ────────
--   plan 寫於甲乙尚未拆分之前,§4.1 的回退步 2 寫「還原 A5a 與 admin_record_item_receipt」。
--   **甲已經獨立 apply、且自己帶了 down 腳本 scripts/452a-down.sql**
--   (該檔 :80-82 的閘逐字:偵測到 admin_void_item_procurement 仍存在 ⇒ 必須先逆序退掉乙)。
--   ⇒ **本支的回退只負責自己那兩個物件(RPC + 帳本表),不碰相鄰 writer** ——
--     碰了會與 452a-down.sql 重疊、兩份腳本互相覆蓋。回退腳本 = scripts/452b-down.sql。
--
-- ── 🔴 一個 DB 閘【看不到】的硬前置,必須人工確認 ──────────
--   甲片 :150-160 自陳:它之所以能安全上線,唯一理由是「正式庫零 voided 列」——
--   因為當時 `hydrateFormValues` 用 `find(p => p.supplierId === …)` **取第一筆**
--   ⇒ 編輯表單可能 hydrate 出作廢列的舊值、儲存後把舊資料寫進生效列 = 靜默資料損壞。
--   🔴 **本支的存在意義就是產生 voided 列 ⇒ 那條路徑不能再靠「零筆」擋。**
--   它現在由 `#476` 片2(commit 8dfad824)關掉:挑列改走
--   `apps/admin/src/lib/orders/procurement-view.ts` 的 `findActiveProcurement`(只取 voided_at 為 null 的列)。
--   ⚠️ **但那是應用層,任何 DB 前置閘都觀察不到它有沒有部署上線。**
--   ⇒ apply 之前請人工確認:**正式站 admin 的現行部署已包含 `#476` 片2**。
--     這是 `feedback_app-layer-must-not-ship-before-migration-apply` 的**反向**形狀:
--     這次是 app 必須【先】上,migration 才可以上。
--
-- ── 誠實邊界 ────────────────────────────────────────────
--   · 本檔零正式庫連線寫成,所有「現況」= repo 字面(同 plan §7 G1)。
--   · 前置閘 P3 用 `to_regprocedure` 而**不**釘 A5a/receipt 的 md5 指紋:
--     甲片自己的 P3 已經在它 apply 當下釘過一次;在這裡再釘一次等於把「甲之後不准有人改過它們」
--     這個更強的條件偷渡進來,而那不是本支需要的前提。**擋的東西要剛好等於依賴的東西。**
-- ============================================================

DO $gate$
DECLARE
  v_cnt bigint;
  v_def text;
BEGIN
  -- P1. 本支尚未 apply 過(重跑保護)
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_void_item_procurement';
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '452-2a2乙 前置閘 P1:admin_void_item_procurement 已存在(% 支)⇒ 本支已 apply 過或有人手動建過;拒繼續', v_cnt;
  END IF;

  -- P2. 🔴 甲已 apply —— 用**甲加的那道分流的字面**判,不是用檔名或台帳判。
  --     偵測點選 receipt 那一側的新碼:它是甲唯一新增的**固定字面**,
  --     而 A5a 那一側只加了 `AND voided_at IS NULL`(子字串太弱、易誤中註解)。
  -- 🔴 codex 關卡2 F1:~~原本比對裸字串 `PROCUREMENT_VOIDED`~~ —— `pg_get_functiondef`
  --    **連註解一起回傳** ⇒ 有人把守門刪掉、只留一句提到該碼的註解,這道閘照樣放行。
  --    改比對**可執行形式** `RETURN 'PROCUREMENT_VOIDED'`:註解裡出現這一整串的機率遠低,
  --    而甲片的實作逐字就是這個形狀。⚠️ 誠實邊界:**仍非不可偽造**(有人刻意在註解裡寫這一整串就會過),
  --    真正不可偽造的是 md5 指紋,但那會把「甲之後不准有人改過它」這個更強的條件偷渡進來(見檔頭)。
  IF pg_catalog.pg_get_functiondef(
       'public.admin_record_item_receipt(uuid,integer,integer,timestamptz,text,text,text)'::regprocedure
     ) NOT LIKE '%RETURN ''PROCUREMENT_VOIDED''%' THEN
    RAISE EXCEPTION '452-2a2乙 前置閘 P2:admin_record_item_receipt 現行定義不含 PROCUREMENT_VOIDED ⇒ 甲(20260814100000)未 apply 或被覆蓋。乙先於甲上線會製造「已有 voided 列而相鄰 writer 不認得」的洞;拒繼續';
  END IF;

  -- P3. A5a 也帶了 voided 分流(甲的另一半;兩半各驗,不靠其中一半蘊含另一半)
  -- 🔴 同 F1:比對**可執行形式**(甲片加的是存在性查詢裡的 `AND voided_at IS NULL`),
  --    而不是裸的 `voided_at IS NULL`(那在註解裡到處都是)。
  IF pg_catalog.pg_get_functiondef(
       'public.admin_upsert_item_procurement(uuid,uuid,integer,text,text,timestamptz,text,text,date,text,text,boolean)'::regprocedure
     ) NOT LIKE '%AND voided_at IS NULL%' THEN
    RAISE EXCEPTION '452-2a2乙 前置閘 P3:A5a 現行定義不含 voided_at 分流 ⇒ 甲只上了一半;拒繼續';
  END IF;

  -- P4. partial unique index 逐字相符 —— 它是 Q-S1=A「作廢後可對同一家重下單」的承重物
  --     (甲片 P2 同一道,逐字比對而非子字串:恆假述詞會讓同鍵多筆 active 列共存)。
  SELECT pg_catalog.pg_get_indexdef(i.indexrelid) INTO v_def
    FROM pg_catalog.pg_index i
    JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid
   WHERE i.indrelid = 'public.order_item_procurement'::regclass
     AND c.relname  = 'order_item_procurement_business_key'
     AND i.indisunique;
  IF v_def IS DISTINCT FROM
     'CREATE UNIQUE INDEX order_item_procurement_business_key ON public.order_item_procurement USING btree (order_item_id, supplier_id) WHERE (voided_at IS NULL)' THEN
    RAISE EXCEPTION '452-2a2乙 前置閘 P4:業務鍵索引定義與預期不【逐字】相符,實 [%];拒繼續', coalesce(v_def, '<不存在>');
  END IF;

  -- P5. 配對 CHECK 在(voided_at 與 void_reason 同生同滅)——
  --     本支同時寫兩欄的正當性來自它;它不在的話「只寫一欄」不會被擋。
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_constraint
   WHERE conrelid = 'public.order_item_procurement'::regclass
     AND conname  = 'order_item_procurement_void_pair';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '452-2a2乙 前置閘 P5:找不到 order_item_procurement_void_pair 配對 CHECK(命中 % 個)⇒ 2a-1 未 apply 或被改過;拒繼續', v_cnt;
  END IF;

  -- 🔴 **刻意【不】設「正式庫零 voided 列」閘。**
  --    甲片的 P5 是那個形狀,但兩片的立場相反:甲是「還沒有人會產生 voided 列」的觀察,
  --    而**本支就是那個產生者** ⇒ 在這裡設同一道閘,等於第一次 apply 之後永遠不能重跑。
  --    (down 腳本同理不設,理由見 plan §4.2 的 fail-DANGEROUS 段。)

  RAISE NOTICE '452-2a2乙 前置閘 P1-P5 全過(P2/P3 = 甲兩半皆在、P4 = partial unique 逐字相符)。';
END
$gate$;

-- ── 1. 冪等帳本表(plan §2.4b)────────────────────────────
-- 🔴 **為什麼不用 admin_audit_log 當帳本**:`admin_audit_log_request_id_idx` 是**普通 INDEX、不是 UNIQUE**
--    (20260712210000:78)⇒ 同一個 request_id 併發打兩列時,兩邊的存在性查詢互相看不到對方未提交的列,
--    雙雙成功。⇒ 照同表既有樣板 `order_item_receipt_requests`(20260810230000:130-199)另開專屬表,
--    `request_id` 當 **PK**(跨全表唯一,不是「每個採購一組」)。
-- 🔴 表級四樣防護一樣都不能少(RLS + REVOKE + 只 GRANT SELECT + 形狀 CHECK):
--    少了就是新表帶 PostgREST 預設可達面 = 鐵則 12②。
CREATE TABLE public.order_item_procurement_void_requests (
  request_id     text        PRIMARY KEY,

  -- 🔴 **刻意無 FK**(樣板同款):它是歷史指標、不是活引用。
  --    採購列日後若被實體刪除,本表這一列仍要留著,否則舊請求重送會被當成新請求。
  procurement_id uuid        NOT NULL,

  -- 🔴 作廢原因存一份在帳本裡,是為了讓「同鍵重送」能比對 payload ——
  --    不是為了查帳(查帳看採購列本身與 admin_audit_log)。
  void_reason    text        NOT NULL,

  actor          text        NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),

  -- 形狀 = 可列印 ASCII、無空白、全小寫、≤200(樣板 20260810230000:163-166 逐字同款)。
  -- 🔴 白名單 `^[!-~]+$` 一次擋掉所有空白類與所有非 ASCII:黑名單會漏掉全形空白 / NBSP / 零寬字元,
  --    而本欄是 PK ⇒ 「肉眼看起來一樣」的兩個鍵會繞過重複門。
  CONSTRAINT order_item_procurement_void_requests_request_id_shape
    CHECK (request_id = pg_catalog.lower(request_id)
           AND request_id ~ '^[!-~]+$'
           AND pg_catalog.char_length(request_id) BETWEEN 1 AND 200),
  CONSTRAINT order_item_procurement_void_requests_actor_shape
    CHECK (actor ~ '^[a-z0-9_]{1,64}$'),
  -- 原因非空:與採購列上的配對 CHECK 同一條紀律,帳本這一份也不准是空白。
  CONSTRAINT order_item_procurement_void_requests_reason_nonempty
    CHECK (NOT public.pcm_b2_is_blank(void_reason))
);

COMMENT ON TABLE public.order_item_procurement_void_requests IS
  'M-4b E10 #452 片 2a-2 乙:採購作廢的冪等帳。**append-only —— 零 UPDATE、零 DELETE 路徑**。'
  '每一次成功的作廢留一列。重送同一個 request_id:**payload 相同**回 DUPLICATE_REQUEST(不再作廢第二次);'
  '**payload 不同**是 caller bug ⇒ RPC RAISE(鍵被重用)。'
  '🔴 procurement_id 刻意無 FK ⇒ 歷史指標、不是活引用,不得拿本表反推現況。'
  '🔴 service_role only:採購與供應商資訊是內部資料,絕不對客。'
  '⚠️ 本表會被 scripts/452b-down.sql 整張 DROP ⇒ **回退會丟掉冪等歷史**,'
  '回退後同一個 request_id 會被當成新請求(已寫進 runbook)。';

ALTER TABLE public.order_item_procurement_void_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.order_item_procurement_void_requests
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.order_item_procurement_void_requests TO service_role;

-- ── 2. RPC ───────────────────────────────────────────────
CREATE FUNCTION public.admin_void_item_procurement(
  p_procurement_id uuid,
  p_void_reason    text,
  p_actor          text,
  p_request_id     text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
-- 🔴 `lock_timeout` 的理由是**實測**、不是理論(plan §2.4d):
--    探針 452-2a2-void-lockprobe.sh 發④⑤ 各觀察到 1 個 session 卡在 wait_event_type='Lock'
--    ⇒ **採購列的 NKU 爭用是真的,只是不會成環**(C 案沒有 unvoid ⇒ 死結的那條邊不存在)。
--    沒有它,void 撞上一個長交易的 A5a 會無限等 ⇒ 員工那一按就是永遠轉圈。
SET lock_timeout = '5s'
AS $fn$
DECLARE
  -- Unicode 空白 + 零寬/格式字全集(逐字沿用 A5a :127-133 的 v_ws;31 字元自檢在下)
  v_ws constant text := E' \t\r\n\f\013'
    || U&'\0085' || U&'\00A0' || U&'\1680' || U&'\180E'
    || U&'\2000' || U&'\2001' || U&'\2002' || U&'\2003' || U&'\2004'
    || U&'\2005' || U&'\2006' || U&'\2007' || U&'\2008' || U&'\2009'
    || U&'\200A' || U&'\200B' || U&'\200C' || U&'\200D'
    || U&'\2028' || U&'\2029' || U&'\202F' || U&'\205F' || U&'\2060'
    || U&'\3000' || U&'\FEFF';
  -- 「肉眼全白但不屬 [[:space:]]」碼位(A5a :137-138 同一組;7 字元自檢在下)
  v_zw constant text := U&'\200B' || U&'\200C' || U&'\200D' || U&'\FEFF'
    || U&'\2800' || U&'\3164' || U&'\00AD';

  v_actor        text;
  v_req          text;
  v_reason       text;
  v_proc         public.order_item_procurement%ROWTYPE;
  v_receipt_sum  bigint;
  v_prior        public.order_item_procurement_void_requests%ROWTYPE;
  v_rows         integer;
BEGIN
  -- 步 0. 常數自檢(字面漂移 ⇒ 全函式拒用、fail-loud;樣板 20260811010000:60-66)
  IF pg_catalog.char_length(v_ws) <> 31 THEN
    RAISE EXCEPTION 'admin_void_item_procurement: v_ws 字元集長度異常(預期 31)';
  END IF;
  IF pg_catalog.char_length(v_zw) <> 7 THEN
    RAISE EXCEPTION 'admin_void_item_procurement: v_zw 字元集長度異常(預期 7)';
  END IF;

  -- 步 1(V1). 隔離閘(逐字沿用 A5a :170-174)
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'admin_void_item_procurement 隔離閘:本 RPC 僅在 read committed 下健全(目前 = %);拒收',
      pg_catalog.current_setting('transaction_isolation')
      USING ERRCODE = 'P2B02', CONSTRAINT = 'a452b_isolation_read_committed_only';
  END IF;

  -- 步 2(V2). actor / request_id —— **caller bug 面,RAISE 不給固定碼**(A5a :32 逐字慣例)
  IF p_actor IS NULL OR p_actor !~ '^[a-z0-9_]{1,64}$' THEN
    RAISE EXCEPTION 'admin_void_item_procurement: p_actor 缺失或非法(需 ^[a-z0-9_]{1,64}$)';
  END IF;
  v_actor := p_actor;

  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'admin_void_item_procurement: p_request_id 不可為 NULL';
  END IF;
  v_req := pg_catalog.btrim(p_request_id, v_ws || v_zw);
  IF v_req = '' THEN
    RAISE EXCEPTION 'admin_void_item_procurement: p_request_id 去空白後為空';
  END IF;
  -- 🔴 **不靜默 lower()**:本欄是 PK,大小寫兩形會繞過重複門;
  --    靜默正規化會讓「送出的鍵」與「表裡的鍵」不同字面、日後對不起帳。fail-loud 優於 fail-quiet。
  IF v_req !~ '^[!-~]+$' OR v_req <> pg_catalog.lower(v_req) OR pg_catalog.char_length(v_req) > 200 THEN
    RAISE EXCEPTION 'admin_void_item_procurement: p_request_id 形狀非法(需可列印 ASCII、無空白、全小寫、≤200)';
  END IF;

  -- 步 3(V3). 作廢原因 —— **業務/輸入面,回代碼字串**(配對 CHECK 的訊息層;樣板 20260807200000:96-99)
  IF p_void_reason IS NULL THEN
    RETURN 'REASON_REQUIRED';
  END IF;
  v_reason := pg_catalog.btrim(p_void_reason, v_ws || v_zw);
  IF v_reason = '' OR public.pcm_b2_is_blank(v_reason) THEN
    RETURN 'REASON_REQUIRED';
  END IF;

  -- 步 4(V4). 鎖採購列。🔴 `FOR NO KEY UPDATE` 而**不是** `FOR UPDATE`:
  --    FOR UPDATE 與 FK RI 取的 KEY SHARE 會死結(40P01,memory `project_m4b-a2b1-guard-decisions` 實測)。
  SELECT * INTO v_proc
    FROM public.order_item_procurement
   WHERE id = p_procurement_id
     FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RETURN 'PROCUREMENT_NOT_FOUND';
  END IF;

  -- 步 5(V5). 冪等**快篩**(只讀,不寫帳)——
  -- 🔴 帳的 INSERT 在步 8,**不在這裡**。plan §2.4b R2 折 ② 的失敗情境很具體:
  --    若把「寫帳」併進這一步,員工拿到 HAS_RECEIPTS_UNDO_FIRST、去撤了到貨、
  --    回來用**同一個 request_id** 重按 ⇒ 回 DUPLICATE_REQUEST ⇒ **作廢永遠做不成**。
  SELECT * INTO v_prior
    FROM public.order_item_procurement_void_requests
   WHERE request_id = v_req;
  IF FOUND THEN
    -- 🔴 `IS NOT DISTINCT FROM` 而不是 `=`:比對欄位理論上可為 NULL 時 `=` 會回 NULL(當成不符)。
    --    這裡三欄都 NOT NULL,仍照樣板寫法 —— 改成 `=` 是零收益的重新論證(plan §2.4b 末逐字)。
    -- 🔴 codex 關卡2 F2:~~原本漏比 `actor`~~ ⇒ 同一個 request_id 換一個操作者送出會回
    --    `DUPLICATE_REQUEST`,而 plan §2.4b 要求的是 **payload 全欄**比對。
    --    `actor` 是帳本存下來的欄位之一 ⇒ 它就在 payload 裡,不比它就是「宣稱全欄、實際比兩欄」。
    IF v_prior.procurement_id IS NOT DISTINCT FROM p_procurement_id
       AND v_prior.void_reason IS NOT DISTINCT FROM v_reason
       AND v_prior.actor IS NOT DISTINCT FROM v_actor THEN
      RETURN 'DUPLICATE_REQUEST';
    END IF;
    RAISE EXCEPTION 'admin_void_item_procurement: request_id 被重用於不同內容(caller bug);已存 procurement=% actor=% reason 長度=%,本次 procurement=% actor=% reason 長度=%',
      v_prior.procurement_id, v_prior.actor, pg_catalog.char_length(v_prior.void_reason),
      p_procurement_id, v_actor, pg_catalog.char_length(v_reason);
  END IF;

  -- 步 6(V6). 已作廢 ⇒ **不做 no-op**,明說(母 plan §6 Q4)。
  -- 🔴 回 ALREADY_VOIDED 而不是靜默成功:靜默成功會讓員工以為是自己這次按成功的,
  --    而實際上原因欄留著的是**別人上次寫的那句**。
  IF v_proc.voided_at IS NOT NULL THEN
    RETURN 'ALREADY_VOIDED';
  END IF;

  -- 步 7(V7). 🔴🔴 **已有到貨不准作廢** —— 本片最承重的一道。
  --
  -- 🔴 **順序釘死:①先驗兩來源【一致】②再驗【非零】。反過來寫 RAISE 分支會變成死枝。**
  --    (repo 紀律:負測構造不出來要先懷疑那條守門是 no-op。)
  --    兩來源 = `received_quantity`(A4a 維護的累計欄)與 receipts 明細的 SUM。
  --    `20260811010000:203-211` 立過「讀真相表、不讀衍生值」的紀律 ⇒ 這裡**兩個都讀**、
  --    不一致就 **fail-loud RAISE**(那是不變式破損,不是可以靜默選大的那種情況)。
  SELECT coalesce(sum(r.quantity)::bigint, 0) INTO v_receipt_sum
    FROM public.order_item_procurement_receipts r
   WHERE r.procurement_id = p_procurement_id;

  IF v_receipt_sum IS DISTINCT FROM v_proc.received_quantity::bigint THEN
    RAISE EXCEPTION 'admin_void_item_procurement: 到貨兩來源不一致(procurement.received_quantity=%,receipts SUM=%)⇒ A4a 不變式破損,不作任何處置;請通知系統維護',
      v_proc.received_quantity, v_receipt_sum;
  END IF;

  IF v_receipt_sum <> 0 THEN
    RETURN 'HAS_RECEIPTS_UNDO_FIRST';
  END IF;

  -- 🔴🔴 **放寬 V7 會怎麼壞(給下一個為了放寬而來讀這段的人)**
  --   `admin_cancel_order`(現行定義 20260805100000:80)算「還能取消幾件」時,
  --   用的是 `JOIN order_item_procurement p → order_item_procurement_receipts r` 的
  --   `sum(r.quantity)`(:380-381 / :400-401 / :412-413),而**它全檔沒有任何 voided 述詞**
  --   (`grep -c voided` = 0,2026-08-14 V 窗實查;盤點見 plan 附錄 A.2/A.3)。
  --   ⇒ 現在沒事的唯一理由,就是本道守門保證「作廢列不會有到貨」。
  --   ⇒ **一旦放寬 V7(或有人繞過本 RPC 直接 UPDATE 標作廢)**,
  --     掛在已作廢採購上的到貨會被算進已收量 ⇒ **可取消量被低估,
  --     員工取消不了本來可以取消的量,而畫面不會說為什麼。**
  --   同一條依賴也適用 `admin_delete_item_receipt`(20260810233000:280,同樣零 voided 分流)。
  --   ⚠️ 本片**不改**那兩支(超出範圍、各需自己的審查);已由主視窗立案 `#498` 追。

  -- 步 8(V8). 冪等**帳**的 INSERT —— 🔴 **必須排在所有 RETURN 型守門之後**
  --    (樣板 20260811010000:192 逐字「此時尚未寫入任何東西 ⇒ 可以用 RETURN」)。
  --    到這一行為止,上面每一條失敗路徑都還沒寫過任何東西 ⇒ 它們用 RETURN 是安全的。
  -- 🔴 codex 關卡2 F3:**步 5 的快篩擋不住併發** —— 兩個交易同時用同一個 request_id 打
  --    **兩個不同的採購**時,雙方在步 5 都看不到對方未提交的列 ⇒ 都通過,
  --    敗方會在這裡吃到**裸 23505**(PostgREST 轉出去是「系統狀態異常」,員工看不懂)。
  --    ⇒ 撞鍵時**重讀那一列、再比一次 payload**:相同 ⇒ 合法重放回 DUPLICATE_REQUEST;
  --      不同 ⇒ 才是 caller bug、RAISE 人話。(樣板 20260811010000:264-286 的「先寫帳、撞鍵則比對」)
  BEGIN
    INSERT INTO public.order_item_procurement_void_requests
      (request_id, procurement_id, void_reason, actor)
    VALUES (v_req, p_procurement_id, v_reason, v_actor);
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_prior
      FROM public.order_item_procurement_void_requests
     WHERE request_id = v_req;
    IF FOUND
       AND v_prior.procurement_id IS NOT DISTINCT FROM p_procurement_id
       AND v_prior.void_reason IS NOT DISTINCT FROM v_reason
       AND v_prior.actor IS NOT DISTINCT FROM v_actor THEN
      -- 🔴 回 DUPLICATE_REQUEST 而不是繼續作廢:對方那一筆已經(或即將)把同一件事做完。
      RETURN 'DUPLICATE_REQUEST';
    END IF;
    RAISE EXCEPTION 'admin_void_item_procurement: request_id 在併發下被重用於不同內容(caller bug);本次 procurement=% actor=%',
      p_procurement_id, v_actor;
  END;

  -- 步 9. 兩欄同時寫(配對 CHECK 要求)+ `AND voided_at IS NULL` 防 TOCTOU。
  -- 🔴 述詞不是多餘:步 6 到這裡之間本交易持著 NKU 列鎖,但**把述詞寫進 WHERE 才讓
  --    「這一列在我讀完之後被別人作廢了」變成 0 列受影響、被下面那道斷言接住**,
  --    而不是靠「我相信鎖」。(樣板 20260807200000:115-124)
  UPDATE public.order_item_procurement
     SET voided_at   = now(),
         void_reason = v_reason
   WHERE id = p_procurement_id
     AND voided_at IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'admin_void_item_procurement: 作廢 UPDATE 影響 % 列(預期 1)⇒ 該列在本交易讀取之後被改動;拒絕,不重試', v_rows;
  END IF;

  -- 步 10. 稽核 —— 🔴 **不包在 EXCEPTION handler 裡**(20260802150000:195-198 同款):
  --    包起來的話,稽核寫失敗會被吞掉,而那正是最需要知道的時刻。
  INSERT INTO public.admin_audit_log
    (actor, action, target, before, after, reason, request_id, source_app)
  VALUES (
    v_actor, 'procurement.void', 'procurement:' || p_procurement_id::text,
    pg_catalog.jsonb_build_object(
      'voided_at',         v_proc.voided_at,
      'void_reason',       v_proc.void_reason,
      'allocated_quantity', v_proc.allocated_quantity,
      'received_quantity',  v_proc.received_quantity,
      'supplier_id',        v_proc.supplier_id,
      'order_item_id',      v_proc.order_item_id),
    -- 🔴 codex 關卡2 F4:~~原本 `after` 只有一個布林 + 原因長度~~ ⇒ 事故後**重建不出作廢後的狀態**,
    --    而 plan 要的是 before/after **逐欄快照**。改成與 `before` 同一組欄位的實值。
    --    (`voided_at` 取剛寫進去的值,不重呼 `now()` —— 那會與列上的值差幾微秒、對帳時像是兩件事。)
    (SELECT pg_catalog.jsonb_build_object(
       'voided_at',          p.voided_at,
       'void_reason',        p.void_reason,
       'allocated_quantity', p.allocated_quantity,
       'received_quantity',  p.received_quantity,
       'supplier_id',        p.supplier_id,
       'order_item_id',      p.order_item_id)
       FROM public.order_item_procurement p WHERE p.id = p_procurement_id),
    v_reason, v_req, 'admin');

  RETURN 'VOIDED';
END
$fn$;

COMMENT ON FUNCTION public.admin_void_item_procurement(uuid,text,text,text) IS
  'M-4b E10 #452 片 2a-2 乙:把一筆採購標成已作廢(邏輯刪除,不實體刪)。'
  '回 VOIDED / DUPLICATE_REQUEST / PROCUREMENT_NOT_FOUND / REASON_REQUIRED / ALREADY_VOIDED / '
  'HAS_RECEIPTS_UNDO_FIRST(業務與輸入結果回代碼字串,對齊 A5a 慣例);'
  'actor / request_id 缺失或非法、request_id 被重用於不同內容、到貨兩來源不一致 = RAISE 不給固定碼。'
  '🔴 冪等:先查 order_item_procurement_void_requests(PK=request_id、跨全表)快篩,'
  '**帳的 INSERT 排在所有 RETURN 型守門之後** —— 否則「被 HAS_RECEIPTS_UNDO_FIRST 擋下、撤完到貨用同鍵重按」'
  '會回 DUPLICATE_REQUEST,作廢永遠做不成。'
  '🔴 V7(已有到貨不准作廢)是承重點,不只是 UX:admin_cancel_order 的可取消量計算沒有 voided 述詞,'
  '它沒出事的唯一理由是本守門保證作廢列零到貨。放寬前先讀函式體內該段註解與 backlog #498。'
  '🔴 Q-S1=A:作廢之後對同一家可以重新下單,靠 order_item_procurement_business_key 這個'
  'partial unique index(WHERE voided_at IS NULL)不撞鍵。'
  '⚠️ **冪等的單調性前提**(codex 關卡2 F5 補):C 案沒有 unvoid ⇒ 作廢是**單向**的,'
  '「帳本有這一列」與「那筆採購已作廢」永遠同真。**但人工 SQL 直接清掉 voided_at 會打破它** ——'
  '那之後拿舊 request_id 重放,會對一筆【未作廢】的列回 DUPLICATE_REQUEST(看起來成功、其實沒作廢)。'
  '⇒ 人工解除作廢時必須連本表那一列一起刪,否則帳本與事實脫鉤。';

-- ── 3. ACL(樣板:同表既有 RPC 一律 service_role only)──────
REVOKE ALL ON FUNCTION public.admin_void_item_procurement(uuid,text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_void_item_procurement(uuid,text,text,text) TO service_role;

-- ── 4. 後置斷言(apply 當下就證明,不留給下一個人去查)──────
DO $post$
DECLARE
  v_cnt bigint;
  v_cfg text[];
BEGIN
  -- 函式在、且**恰一支**(多載會讓 PostgREST 具名參數呼叫變成不確定)
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_void_item_procurement';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '452-2a2乙 後置 A1:admin_void_item_procurement 應恰 1 支,實 % 支', v_cnt;
  END IF;

  -- SECURITY DEFINER + proconfig 兩項都在
  -- 🔴 `lock_timeout` 要單獨斷言:ACL 矩陣只看 search_path,量不到它(plan §2.4d 末逐字)。
  SELECT p.proconfig INTO v_cfg
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_void_item_procurement';
  IF NOT (v_cfg @> ARRAY['search_path=public, pg_temp']) THEN
    RAISE EXCEPTION '452-2a2乙 後置 A2:proconfig 缺 search_path,實 [%]', array_to_string(coalesce(v_cfg, '{}'), ' | ');
  END IF;
  IF NOT (v_cfg @> ARRAY['lock_timeout=5s']) THEN
    RAISE EXCEPTION '452-2a2乙 後置 A3:proconfig 缺 lock_timeout=5s,實 [%]', array_to_string(coalesce(v_cfg, '{}'), ' | ');
  END IF;

  -- 帳本表的四樣防護:RLS 開、零 policy、PUBLIC/anon/authenticated 零權限、service_role 只有 SELECT
  IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c
           WHERE c.oid = 'public.order_item_procurement_void_requests'::regclass) THEN
    RAISE EXCEPTION '452-2a2乙 後置 A4:帳本表未啟用 RLS';
  END IF;
  SELECT count(*) INTO v_cnt FROM pg_catalog.pg_policies
   WHERE schemaname = 'public' AND tablename = 'order_item_procurement_void_requests';
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '452-2a2乙 後置 A5:帳本表應零 policy(RLS 開 + 零 policy = 除 owner/BYPASSRLS 外全擋),實 % 條', v_cnt;
  END IF;
  IF has_table_privilege('anon', 'public.order_item_procurement_void_requests', 'SELECT')
     OR has_table_privilege('authenticated', 'public.order_item_procurement_void_requests', 'SELECT') THEN
    RAISE EXCEPTION '452-2a2乙 後置 A6:帳本表對 anon/authenticated 仍可 SELECT ⇒ PostgREST 可達面';
  END IF;

  -- RPC 的 EXECUTE 只給 service_role
  IF has_function_privilege('anon', 'public.admin_void_item_procurement(uuid,text,text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.admin_void_item_procurement(uuid,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION '452-2a2乙 後置 A7:RPC 對 anon/authenticated 仍可 EXECUTE';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.admin_void_item_procurement(uuid,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION '452-2a2乙 後置 A8:service_role 反而不能 EXECUTE';
  END IF;

  -- 🔴 codex 關卡2 F6:~~A1-A8 沒有一格量 `prosecdef`~~ ⇒ 有人把它改成 SECURITY INVOKER,
  --    上面每一格照樣全綠,而**整支 RPC 會在 service_role 權限下跑不到需要 owner 的東西**、
  --    或反過來讓 RLS 生效路徑改變。屬性是本支的前提之一,要量。
  IF NOT (SELECT p.prosecdef FROM pg_catalog.pg_proc p
            JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = 'admin_void_item_procurement') THEN
    RAISE EXCEPTION '452-2a2乙 後置 A9:RPC 不是 SECURITY DEFINER';
  END IF;

  -- 🔴 codex 關卡2 F7:~~帳本 ACL 只查 anon/authenticated 的 SELECT~~ ⇒ service_role 若多出
  --    UPDATE/DELETE,上面那格照樣綠,而本表宣稱 **append-only**。逐權限量,不只量 SELECT。
  IF has_table_privilege('service_role', 'public.order_item_procurement_void_requests', 'INSERT')
     OR has_table_privilege('service_role', 'public.order_item_procurement_void_requests', 'UPDATE')
     OR has_table_privilege('service_role', 'public.order_item_procurement_void_requests', 'DELETE') THEN
    RAISE EXCEPTION '452-2a2乙 後置 A10:service_role 對 append-only 帳本表仍有 INSERT/UPDATE/DELETE ⇒ 與宣稱不符';
  END IF;
  -- anon/authenticated 四種權限一次掃完(只掃 SELECT 是「掃描字集比宣稱窄」)
  IF has_table_privilege('anon', 'public.order_item_procurement_void_requests', 'SELECT,INSERT,UPDATE,DELETE')
     OR has_table_privilege('authenticated', 'public.order_item_procurement_void_requests', 'SELECT,INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION '452-2a2乙 後置 A11:帳本表對 anon/authenticated 仍有任一權限 ⇒ PostgREST 可達面';
  END IF;

  RAISE NOTICE '452-2a2乙 後置 A1-A11 全過(恰一支 / search_path / lock_timeout / SECURITY DEFINER / RLS / 零 policy / 帳本四權限 / RPC ACL)。';
END
$post$;
