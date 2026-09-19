-- 20260919140000_m4b_manual_no_email_excluded_to_latest.sql
-- M-4b · 板 217(板號與版本號皆由主視窗指定)· 窗B(worktree pcm-ops)
-- plan:docs/plans/2026-09-19-20260905210000-view-drift-from-prod-plan.md
--   🛑 **敘事在 plan,不在這裡**(docs/patterns/where-migration-narrative-goes.md)——
--      為什麼這樣決定 / 量過什麼 / 審查抓到什麼,全部在那份 plan。
--
-- ══ 做什麼 ═══════════════════════════════════════════════════════════════
-- 把 `public.pcm_manual_no_email_excluded` 從**舊定義**帶到 repo 最新版
-- (`20260905210000` 那一版;那支已貼,而它的後續七輪修改從來沒上線)。
-- 🔴 **這是正確性修正,不是整理**:舊版只判「手動 + 信箱留白」,
--    把**未付款 / 兩信箱皆空 / 已有 outbox** 的單也算進去 ⇒ **統計虛高**。
--
-- ══ 🛑 為什麼是 DROP + CREATE,不是 CREATE OR REPLACE ═════════════════════
-- 新版**欄位變了**(6 欄 ⇒ 6 欄但名稱與語意都換:多 `surface` / `shipment_id` /
-- `corrected_at_key`,少 `created_at` / `cancelled_at` / `payment_status`)
-- ⇒ `CREATE OR REPLACE VIEW` 不允許改欄名/型別/順序 ⇒ 只能 DROP 再 CREATE。
--
-- ══ 🔴 而 DROP VIEW 會把授權一起帶走 —— 本片最容易出錯的一格 ════════════
-- 🔬 貼前實查:`{postgres=arwdDxtm/postgres,service_role=rDxtm/postgres}`
--
-- ⛔ ~~而 `20260905210000` 的 ACL 段只寫 `GRANT SELECT … TO service_role`~~
-- ⛔ ~~⇒ 照抄它 = 把 service_role 從 `rDxtm` 安靜收窄成 `r`,而那是**沒有人要求的改動**。~~
-- ⛔ ~~📌 今天收權限是因為 Sean 裁了,不是順手。⇒ 本片還原成【貼前那一組】。~~
--
-- 🔴🔴 **上面那三句【方向是反的】(R1 F1 抓到, 舊字面留著不刪)。**
-- 🔬 **`rDxtm` 不是一個決定, 是兩件事相加**:
--      `r`    ← `20260905210000:461` 明寫的 `GRANT SELECT … TO service_role`
--      `Dxtm` ← **出生自帶的預設權限殘留**, repo 裡**一行 `GRANT` 都沒有**
--    逐字出處 `20260905350000_m4b_adp_revoke_service_role_residual_on_tables.sql`:
--      檔頭 `:4-6`「**Sean 2026-09-05 拍板逐字:「Q-ADP殘留 … 甲」**
--        甲 = 改預設(**以後新建的不再自帶**;現有的先記板上不動)」
--      段一 `:12-14`「每一個由 `postgres` 在 `public` 新建的表或 view, **出生就自帶它們**,
--        而 repo 裡一行 `GRANT` 都沒有 ⇒ **grep 不到、三綠不紅、審查看不到。**」
--
-- 🎯 **而本片 `DROP` + `CREATE` 之後,那支 view 在 catalog 裡【就是新建的】**
--    ⇒ 依 09-05 之後的預設,它**乾淨出生** ⇒ **只給 SELECT 才是【照拍板】, 不是「收窄」。**
--    🛑 把 `Dxtm` 手寫回去, 等於把「板上記著的殘留」**升格成版控裡的明文授權** ——
--      **那才是需要 Sean 重新拍的那一個。**
-- ✅ **⇒ 本片只 `GRANT SELECT`。**(主視窗 2026-09-19 裁甲:這不是新決定, 是把他 09-05 那句套用到這一支。)
--
-- 📌 **而錯的形狀值得記**:我量到 `rDxtm` 就把它當成「現況 = 有人決定的樣子」,
--    **而沒有去問那五個字母【是怎麼來的】。**
--    🛑 那與本檔 `:29` 自己命名的是同一族:**我量了現況, 而沒有問那個現況的出處。**
-- ✅ 後置比的是 `aclexplode` 展開後的**集合**,不是 `relacl::text` ——
--    收掉再給回來會讓那一項排到尾端,**比字串會假紅**(2026-09-18 實測)。
--
-- ══ 🔴 新版會讀 `order_cancellations` —— 而那是今天剛收掉的五張之一 ═══════
-- ⛔ ~~2026-09-19 早我回報過「那支 view 與今天收掉的五張【無交集】」~~
-- 🔴 **那句只對【舊版】。** 舊版只依賴 `orders`;**新版依賴七張,其中一張就是它。**
-- 🎯 **而錯的形狀值得記**:**我量了現況,回答了一個關於未來的問題。**
-- ✅ **而影響是零 —— 實查不是推**:
--      `service_role` 讀得到 `order_cancellations` ⇒ t   (view 的讀者之一)
--      `postgres`(owner)                          ⇒ t
--      ⚪ `pcm_readonly`                            ⇒ f   (今天收掉的,對照組成立)
--      而 `pcm_readonly` **本來就讀不到這支 view**   ⇒ f
--    ⇒ view 是 `security_invoker` ⇒ **兩個讀者都還讀得到底表 ⇒ 不會壞。**
--
-- ══ ⚪ 這支 view 是誰的、為誰服務 ═══════════════════════════════════════════
-- 讀者**只有 `postgres` 與 `service_role`**(2026-09-19 實查)——
-- 唯讀查帳帳號 `pcm_readonly` 進不來。⇒ 📌 **要看這張稽核面,得拿一把更大的鑰匙。**
-- (那件事本身是 plan §3-2 / §5 的待決題,**本片不處理**。)
--
-- ══ 🛑 本片刻意【不做】的 ═══════════════════════════════════════════════════
-- · **不加守「執行者不是 postgres」的閘** —— 貼法是 SQL Editor = `postgres` = owner,
--   那種閘的邊際安全是 0(2026-09-19 板 216 四輪的結論)。
--   ✅ **本片的風險在【view 的定義對不對】,閘就對準那個。**
-- · 不碰那四支 pending view、不碰 `20260905210000`(已貼檔是凍結的歷史)。
--
-- 還原:`supabase/rollbacks/20260919140000-rollback.sql`
--   (DROP + 建回舊定義 + 建回**舊版註解** + 給回 `SELECT`)
--   ⛔ ~~+ 還原 ACL~~ 🔴 **那半句與還原檔的立場相反(R2 N5)**:
--     還原檔**刻意不把 `Dxtm` 殘留給回去**。📌 「還原」= 撤銷這一片做的事;
--     **而那四種不是這一片做的。**

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ── 1. 前置閘 ───────────────────────────────────────────────────────────────
DO $pre$
-- 🔴 **這份清單是本片的收權斷言清單(靜態閘規則③ 會數它)。**
--   為什麼需要它:本片是**裸 `CREATE VIEW`**(不是 `OR REPLACE`)⇒ **`DROP` 會把 ACL 帶走**
--   ⇒ 建完必須重新確立權限, 而這份清單就是「哪幾個物件的 ACL 我負責還原」的宣告。
--   ⚪ 它**不是裝飾**:前置用它撈基準、後置用它逐一比對(見下面 ⑤ 與後置④)。
DECLARE
  -- 🔵 變數名用 `v_relations` 是 **repo 的慣例**, 不是隨手取的 ——
  --    `scripts/migration-static-checks.sh:714` 的規則③ 就是抓這個名字 + `]::text[]` 收尾。
  --    📌 取別的名字 ⇒ 那道閘數到 0 ⇒ 它會說「有漏列」, 而清單其實在那裡。
  v_relations text[] := ARRAY['public.pcm_manual_no_email_excluded']::text[];
  v_missing text;
BEGIN
  -- ① view 在, 而且【是舊定義】—— 貼過一次也會走到這裡
  IF pg_catalog.to_regclass('public.pcm_manual_no_email_excluded') IS NULL THEN
    RAISE EXCEPTION '前置閘①:public.pcm_manual_no_email_excluded 不存在 ⇒ 停下(本片是換定義, 不是新建)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
              WHERE a.attrelid='public.pcm_manual_no_email_excluded'::pg_catalog.regclass
                AND a.attname='surface' AND a.attnum>0 AND NOT a.attisdropped) THEN
    RAISE EXCEPTION '前置閘①:那支 view 已經有 surface 欄 ⇒ 它已經是新定義了 ⇒ 本片貼過一次 ⇒ 停下來看';
  END IF;

  -- ② 🔴 新定義要用的【四支函式】都在, 而且簽章相符
  --    少一支 ⇒ CREATE VIEW 會炸在中途, 而錯誤訊息只會說某個函式不存在。
  SELECT pg_catalog.string_agg(x.f, ', ') INTO v_missing FROM (VALUES
    ('public.pcm_js_trim_whitespace()'),
    ('public.pcm_shipped_email_dedup_key(uuid, uuid)'),
    ('public.pcm_tracking_corrected_at_key(timestamptz)'),
    ('public.pcm_tracking_corrected_dedup_key(uuid, uuid, timestamptz)')
  ) x(f) WHERE pg_catalog.to_regprocedure(x.f) IS NULL;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '前置閘②:新定義要用的函式不存在(或簽章不同)⇒ %', v_missing;
  END IF;

  -- ③ 🔴 新定義要用的【七張表】都在
  --    其中 public.order_cancellations 是 2026-09-19 收掉 pcm_readonly SELECT 的五張之一,
  --    而本片的讀者(postgres / service_role)仍讀得到它 ⇒ 見檔頭。
  SELECT pg_catalog.string_agg(x.t, ', ') INTO v_missing FROM (VALUES
    ('public.customers'),('public.email_outbox'),('public.order_cancellations'),
    ('public.order_items'),('public.orders'),('public.shipment_items'),('public.shipments')
  ) x(t) WHERE pg_catalog.to_regclass(x.t) IS NULL;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '前置閘③:新定義要用的表不存在 ⇒ %', v_missing;
  END IF;

  -- ⛔ ~~④ 沒有別的物件依賴這支 view —— 用 `pg_depend` 數依賴者~~
  -- 🔴🔴 **那道閘【刪掉了】(R1 nit5)—— 而刪比留好, 理由寫在這裡:**
  --   🔬 它 join `pg_rewrite` ⇒ **只看得見 view / matview**。
  --     審查實跑:同時掛 1 view + 1 matview + 1 支函式 + 1 條 RLS policy ⇒ 它印 **2**;
  --     把兩支 view 拿掉之後它印 **0** —— 而 `DROP VIEW` 當場擋下來, **逐字列出**
  --     `function dependent_f()` 與 `policy p_dep`。
  --   ⇒ 🛑 **它會在【有依賴者】的世界印 0 —— 那比沒有它更糟。**
  --   ✅ **而 `DROP VIEW`(預設 RESTRICT)擋得比它多**, 訊息還會**逐一列出是誰**
  --     ⇒ **交給 PG 自己那句, 不要自己數一個數不全的數。**
  --   ⛔ ~~而它是一道【更完整】的閘~~ 🔴 **那三個字講太滿(R2 N4)**:
  --     🔬 審查實跑:plpgsql / 舊式 `LANGUAGE sql` / `BEGIN ATOMIC` 函式 / RLS policy 各掛一個
  --       ⇒ `DROP VIEW` **只列出後兩者** ⇒ **前兩種的 body 不在 `pg_depend` 裡, PG 一聲不吭。**
  --     🛑 而本 repo 的 RPC **幾乎全是 plpgsql** ⇒ 這個缺口不是理論。
  --     ⚪ 今天不可達(全 repo 沒有函式讀這支 view)—— **而那句話會被下一個人當規則搬走。**
  --   📌 這是板 216 那個教訓的正面用法:**能用一句更清楚的失敗訊息解決的, 不要加閘** ——
  --     而這一次連「加」都不用, 是**把一道假的拿掉**。
  --   🔵 順帶:它上一版還有「1 個依賴者被印成 6 個」那個病(我加 `DISTINCT` 修過)
  --     ⇒ **一道我修過兩次的閘, 第三次看才發現它本來就不該在。**

  -- ⛔ ~~⑤ 把【貼前的 ACL】存起來 —— 後置要還原成這一組~~
  -- 🔴🔴 **那段撈取【刪掉了】(R2 N3)—— 它已經是【死量測】:**
  --    後置④ 這一輪改成問「恰好只有 SELECT」⇒ **它不再與這個基準比任何東西**;
  --    而後面還把那個變數**覆蓋掉** ⇒ 基準在被用到之前就沒了。
  --    ⚠️ 它殘存的唯一輸出還是一串**裸 OID**(`10:DELETE,…,16423:SELECT`)
  --      —— 正是 R1 nit4 在別處修掉的那個病。
  -- ✅ **只留那個「有沒有跑在同一個 transaction」的旗標**(後置⓪ 讀它)。
  IF pg_catalog.array_length(v_relations, 1) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION '前置閘⑤:收權斷言清單不是 1 個 ⇒ 本片的範圍被改過而清單沒跟著改 ⇒ 停下';
  END IF;
  PERFORM pg_catalog.set_config('pcm.v217_acl_pre', '1', true);

  -- 🔴🔴 **R2 N1:這一句原本說「零物件依賴它 · ACL 已存」—— 兩個都不做了。**
  --    📌 **一道被刪掉的閘, 它的成功訊息會活下來, 而那句話從此是假的。**
  --    🛑 **而成功訊息是貼板的人【唯一看得到的輸出】** ⇒ 它比閘本身更該對。
  --    ⚠️ 判別句:**刪一道閘的時候, 順手 grep 一次它的名字** —— 訊息裡那一份不會自己跟著走。
  RAISE NOTICE '✅ 前置閘全過:view 在且是舊定義 · 4 支函式在(簽章相符) · 7 張表在';
END $pre$;

-- ── 2. 動作 ─────────────────────────────────────────────────────────────────
DROP VIEW public.pcm_manual_no_email_excluded;

CREATE VIEW public.pcm_manual_no_email_excluded
  WITH (security_invoker = true) AS
WITH manual_blank AS (
  -- ⛔ ~~這是本檔第五份、也是最後一份值域 —— parity 測試把它與 TS 那份綁在一起~~
  -- 🔴 **那兩句是從來源檔【逐字複製】過來的, 而在本檔是假的(R1 nit7)**:
  --    本檔 `manual_phone` 只出現 **1** 次(來源檔 9 次)⇒ 它是**第一份也是唯一一份**;
  --    而 `notification-fallback-sql-parity.test.ts` 讀的路徑**寫死是 `20260905210000`**
  --    ⇒ 🛑 **本檔這一份值域沒有任何測試綁著它。**
  --    ✅ 今天兩檔逐字相同所以無實害 —— 而那句話讀起來像「有機械守著」, 實際沒有。
  SELECT o.id AS order_id
    FROM public.orders o
   WHERE o.order_source IN ('manual_phone', 'manual_line', 'manual_other')
     AND nullif(pg_catalog.btrim(o.notification_email, public.pcm_js_trim_whitespace()), '') IS NULL
)
-- ① 本來會進 pcm_order_created_email_pending 的
SELECT
  'order_created'::text AS surface,
  o.id                  AS order_id,
  o.display_id          AS display_id,
  o.order_source        AS order_source,
  NULL::text            AS shipment_id,
  NULL::text            AS corrected_at_key
FROM public.orders o
JOIN manual_blank mb ON mb.order_id = o.id
LEFT JOIN public.customers c ON c.user_id = o.customer_user_id
WHERE o.payment_status = 'paid'
  AND o.cancelled_at IS NULL
  AND NOT EXISTS (
        SELECT 1 FROM public.email_outbox e
         WHERE e.order_id = o.id
           AND e.event_type = 'order_created')
  AND nullif(pg_catalog.btrim(c.email, public.pcm_js_trim_whitespace()), '') IS NOT NULL

UNION ALL

-- ② 本來會進 pcm_shipped_email_pending 的(一批出貨一列, 不是一張單一列)
SELECT DISTINCT
  'order_shipped'::text,
  o.id,
  o.display_id,
  o.order_source,
  s.id::text,
  NULL::text
FROM public.shipments s
JOIN public.shipment_items si ON si.shipment_id = s.id
JOIN public.order_items oi ON oi.id = si.order_item_id
JOIN public.orders o ON o.id = oi.order_id
JOIN manual_blank mb ON mb.order_id = o.id
LEFT JOIN public.customers c ON c.user_id = o.customer_user_id
WHERE s.shipped_at IS NOT NULL
  AND s.deleted_at IS NULL
  AND nullif(pg_catalog.btrim(c.email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
  AND NOT EXISTS (
        SELECT 1 FROM public.email_outbox e
         WHERE e.event_type = 'order_shipped'
           AND e.dedup_key = public.pcm_shipped_email_dedup_key(s.id, o.id))

UNION ALL

-- ③ 本來會進 pcm_tracking_corrected_email_pending 的
SELECT DISTINCT
  'shipment_tracking_corrected'::text,
  o.id,
  o.display_id,
  o.order_source,
  s.id::text,
  public.pcm_tracking_corrected_at_key(s.tracking_corrected_at)::text
FROM public.shipments s
JOIN public.shipment_items si ON si.shipment_id = s.id
JOIN public.order_items oi ON oi.id = si.order_item_id
JOIN public.orders o ON o.id = oi.order_id
JOIN manual_blank mb ON mb.order_id = o.id
LEFT JOIN public.customers c ON c.user_id = o.customer_user_id
WHERE s.shipped_at IS NOT NULL
  AND s.deleted_at IS NULL
  AND s.tracking_corrected_at IS NOT NULL
  AND nullif(pg_catalog.btrim(s.tracking_number, public.pcm_js_trim_whitespace()), '') IS NOT NULL
  AND nullif(pg_catalog.btrim(c.email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
  AND EXISTS (
        SELECT 1 FROM public.email_outbox e0
         WHERE e0.event_type = 'order_shipped'
           AND e0.dedup_key = public.pcm_shipped_email_dedup_key(s.id, o.id)
           AND e0.status = 'sent'
           AND e0.sent_at IS NOT NULL
           AND e0.sent_at < s.tracking_corrected_at)
  AND NOT EXISTS (
        SELECT 1 FROM public.email_outbox e
         WHERE e.event_type = 'shipment_tracking_corrected'
           AND e.dedup_key = public.pcm_tracking_corrected_dedup_key(s.id, o.id, s.tracking_corrected_at))

UNION ALL

-- ④ 本來會進 pcm_unpaid_cancelled_email_pending 的
SELECT
  'order_unpaid_cancelled'::text,
  o.id,
  o.display_id,
  o.order_source,
  NULL::text,
  NULL::text
FROM public.orders o
JOIN manual_blank mb ON mb.order_id = o.id
LEFT JOIN public.customers c ON c.user_id = o.customer_user_id
WHERE o.payment_status = 'unpaid'
  AND o.cancelled_at IS NOT NULL
  AND EXISTS (
        SELECT 1 FROM public.order_cancellations oc
         WHERE oc.order_id = o.id)
  AND NOT EXISTS (
        SELECT 1 FROM public.email_outbox e
         WHERE e.order_id = o.id
           AND e.event_type = 'order_unpaid_cancelled')
  AND nullif(pg_catalog.btrim(c.email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
;

-- ── 3. 還原 ACL ─────────────────────────────────────────────────────────────
-- ✅ **只給 SELECT** —— 見檔頭〈DROP VIEW 會把授權一起帶走〉那一整節。
--    貼前是 `service_role=rDxtm`, 而 `Dxtm` 是 **09-05 之前的「出生自帶」殘留**,
--    Sean 09-05 拍甲之後**新建的不再有** ⇒ 本片重建即是新建 ⇒ **乾淨出生才是照拍板。**
--    · `postgres` 是 owner ⇒ 它那一組 `CREATE VIEW` 時自動就有, 不用寫。
-- 🛑 `anon` / `authenticated` / `PUBLIC` 本片**一個都不給**。
--    ⚠️ **而「它們本來就是空的」這個【理由】要講對**(R1 順帶指出):
--    它們會空**不是**因為舊 view 的 relacl 裡沒有 —— 是因為已貼的 `20260817060000`
--    把 `postgres` 在 `public` 的 TABLES 預設授權從 `anon`/`authenticated` 收掉了。
--    ⇒ 📌 **同一個結論, 兩個理由;而錯的那個會讓下一個人以為「照抄舊的就好」。**
--    ✅ 而下面後置閘④ 不靠那個理由 —— 它**直接問**這三者有沒有。
GRANT SELECT ON public.pcm_manual_no_email_excluded TO service_role;

-- ══ 🔴🔴 `DROP VIEW` 把【註解】也帶走了 —— R2 must-fix ══════════════
-- 🔬 **2026-09-19 正式庫實查:那支 view 今天【有】註解**, 而其中逐字寫著:
--      「🛑 而它今天**沒有人在讀**(接進 gap_counts / 儀表是下一片)—— **這一句不要拿掉。**」
--    ⚪ 判別力對照:同一把尺問 `public.orders` ⇒ **沒有註解** ⇒ 尺會動。
-- 🔴 **而本片第一版把它刪掉了, 還原檔也拿不回來。**
--    📌 **那段註解自己寫著「這一句不要拿掉」, 而我寫的板會【靜靜】拿掉它。**
-- 🛑 **而沒有任何機械會叫**:`migration-static-checks.sh` 沒有一條要求 `COMMENT`,
--    ACL 那套帳本也不看註解。⇒ **它與 ACL 是同一格的隔壁一列, 而我只想到了 ACL 那一列。**
-- ✅ 修法是**把 `DROP` 刪掉的東西放回去**, 不是加一道「檢查註解還在不在」的閘 ——
--    R2 剛證明這一片**刪比加有用**。
-- 🔵 正片放【新版】那一段(與新定義同一支檔), 還原檔放【舊版】那一段(它們不一樣, 我 diff 過)。
COMMENT ON VIEW public.pcm_manual_no_email_excluded IS
$c$「後台手動建的單 + 通知信箱留白」——**依 Sean 拍板不寄, 而被本片從四支 pending view 拿掉**的那些單。
🔴 它存在的理由是【看得見】:那些單既沒有 outbox 紀錄、也不進 no_recipient_count
⇒ 沒有這一支的話, 大量手動留白時心跳與 gap 全綠, 而沒有任何數字說得出這件事在發生。
🔴 **一列 = 一個【本來會發生的通知】**, 不是一張單:`surface` 說是哪一支掃描面,
出貨與追蹤更正那兩塊是**一批出貨一列**(`shipment_id` / `corrected_at_key` 才是它們的鍵)。
📌 ⛔ ~~上一版只判「手動 + 留白」~~(codex R2 ①)—— 那會把**本來就不在掃描面上**的單
(未付款 / 兩個信箱皆空 / 已有 outbox)一起算進來 ⇒ **統計虛高**。現在四塊各自對齊那支 view 的述詞。
🛑 而它今天**沒有人在讀**(接進 gap_counts / 儀表是下一片)—— 這一句不要拿掉。
🛑 述詞是**抄**四支 pending view 的 ⇒ **它們會各自漂**, 而今天沒有機械守門綁住。
漂掉時它只會讓**數字說錯話**, 不會讓信寄錯 —— 已知缺口, 不是漏掉。
⚠️ 它不含 `notification_email`(那一欄留白才會進來)也不含 `customers.email` ⇒ 零 PII;
而它仍然只給 service_role —— 訂單編號本身也是資訊。$c$;

-- ── 4. 後置斷言 ─────────────────────────────────────────────────────────────
DO $post$
-- 🛑 **與前置同一份清單** —— 兩邊不一致就不是在比同一組東西。
DECLARE
  v_relations text[] := ARRAY['public.pcm_manual_no_email_excluded']::text[];
  v_acl_pre text; v_acl_now text; v_cols text; n_src int;
BEGIN
  -- ⓪ 讀得到前置存的值 —— 讀不到 = 沒跑在同一個 transaction 裡
  v_acl_pre := NULLIF(pg_catalog.current_setting('pcm.v217_acl_pre', true), '');
  IF v_acl_pre IS NULL THEN
    RAISE EXCEPTION '後置閘⓪:讀不到前置存的 ACL 基準 ⇒ 本檔沒跑在同一個 transaction 裡 ⇒ 拒 COMMIT';
  END IF;

  -- ① 🎯 **定義真的換了** —— 本片唯一要做的事。欄位逐字比對。
  SELECT pg_catalog.string_agg(a.attname, ',' ORDER BY a.attnum) INTO v_cols
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.pcm_manual_no_email_excluded'::pg_catalog.regclass
     AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_cols IS DISTINCT FROM 'surface,order_id,display_id,order_source,shipment_id,corrected_at_key' THEN
    RAISE EXCEPTION '後置閘①:欄位不是新定義那一組 ⇒ 實得【%】⇒ 拒 COMMIT', v_cols;
  END IF;

  -- ② 🔴 **四塊 surface 都在** —— 欄名對不保證內容對(少一塊 UNION 欄名一樣)。
  --    這一格問的是【定義本文】, 與 ① 是兩把不同的尺。
  --
  -- 🔴🔴 **而它第一版是【假的】(R1 F2, 我自己複現過)**:原本比 `LIKE '%'<值>'%'`,
  --    而 `'order_shipped'` 在定義裡**出現 3 次**(surface 值 1 次 + 述詞 2 次)。
  --    🔬 我跑的:砍掉整塊分支②(3 個 UNION ALL 變 2)
  --      ⇒ 舊寫法**照樣數到 4**, 而閘① 的欄位也一字不差 ⇒ **兩格全綠放行**
  --      ⇒ 新寫法(比 `'<值>'::text AS surface`)⇒ **3, 紅了**
  --      ⚪ 對照:完整版兩種寫法都是 4 ⇒ 新寫法不是「一律少算」
  --    📌 **PG 對 UNION 的每一塊都會 render `AS surface`** ⇒ 那個後綴才分得出「值」與「述詞」。
  --    🛑 **一個只比字串在不在的尺, 分不出那個字串【站在哪個位置】。**
  SELECT (SELECT pg_catalog.count(*)::int FROM (VALUES
            ('order_created'),('order_shipped'),('shipment_tracking_corrected'),('order_unpaid_cancelled')
          ) s(k)
          WHERE pg_catalog.pg_get_viewdef('public.pcm_manual_no_email_excluded'::pg_catalog.regclass, true)
                LIKE '%''' || s.k || '''::text AS surface%')
    INTO n_src;
  IF n_src <> 4 THEN
    RAISE EXCEPTION '後置閘②:定義本文裡只找到 % 塊 surface(應為 4)⇒ 貼進去的不是完整那一版 ⇒ 拒 COMMIT', n_src;
  END IF;

  -- ③ 🔴 **它是 security_invoker** —— 少了這個, 讀者會用 owner 的身分讀, 射程整個變了。
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
     WHERE c.oid='public.pcm_manual_no_email_excluded'::pg_catalog.regclass
       AND c.reloptions @> ARRAY['security_invoker=true']) THEN
    RAISE EXCEPTION '後置閘③:那支 view 不是 security_invoker ⇒ 讀者會用 owner 的身分讀 ⇒ 拒 COMMIT';
  END IF;

  -- ④ 🔴 **ACL 是【09-05 拍甲之後新物件該有的樣子】, 不是「與貼前一樣」。**
  --    ⛔ ~~原本斷言「與貼前的集合一字不差」~~ ⇒ 那會把 `Dxtm` 那四種殘留鎖死在版控裡(R1 F1)。
  --    ✅ 改成直接問兩件事, 而**兩件都是 09-05 那句拍板的直接推論**:
  --      ① `service_role` 的權限**恰好只有 SELECT**(多一種少一種都紅)
  --      ② `anon` / `authenticated` / `PUBLIC` **一個都沒有**
  --    🔵 `postgres`(owner)那一組不問 —— 它是 `CREATE VIEW` 自動給的, 不是本片的動作。
  --    ⚠️ **射程(R1 nit2/nit3)**:這裡問的是 `relacl`。
  --      **欄級授權(`pg_attribute.attacl`)與 `WITH GRANT OPTION` 都不在射程內** ——
  --      那支 view 今天兩者皆無(貼前實查), 而**本閘證不到它們**。照實寫, 不寫成「ACL 一字不差」。
  SELECT COALESCE(pg_catalog.string_agg(g.privilege_type, ',' ORDER BY g.privilege_type), '<無>')
    INTO v_acl_now
    FROM pg_catalog.pg_class c, LATERAL pg_catalog.aclexplode(c.relacl) g
   WHERE c.oid = 'public.pcm_manual_no_email_excluded'::pg_catalog.regclass
     AND g.grantee = pg_catalog.to_regrole('service_role');
  IF v_acl_now IS DISTINCT FROM 'SELECT' THEN
    RAISE EXCEPTION '後置閘④:service_role 的權限應該【恰好只有 SELECT】(09-05 拍甲之後新物件的樣子), 而實得【%】⇒ 拒 COMMIT', v_acl_now;
  END IF;

  -- 🔴🔴 **R2 N2:這一段原本【只問三個具名角色】⇒ 對沒被列到的角色 fail-open。**
  --    🔬 審查實跑:用 `ALTER DEFAULT PRIVILEGES` 給 `payment_confirmer` 一份
  --      ⇒ 新 view 出生自帶 `payment_confirmer=rd`(**帶 DELETE**)⇒ **後置照樣印 ✅ 並 COMMIT。**
  --    ⚠️ 而 `to_regrole('anon')` 在角色不存在時回 NULL ⇒ `g.grantee = NULL` 恆為 unknown
  --      ⇒ **那一臂靜靜失效** —— 同一個形狀:守不到的閘。
  -- ✅ **修法是【把名單刪掉】, 不是把名單補長**:改問補集 ——
  --    「除了 owner 與 `service_role`, 不該有任何人」。
  --    📌 它**不用維護名單、PUBLIC / 未來角色一次全包、也沒有 `to_regrole` NULL 那個洞**。
  --    🔵 `::regrole::text`(R1 nit4):這一格最可能紅, 紅的時候人要看得懂是誰, 不是一串 OID。
  SELECT COALESCE(pg_catalog.string_agg(
           COALESCE(g.grantee::pg_catalog.regrole::text, 'PUBLIC')||':'||g.privilege_type, ', '
           ORDER BY COALESCE(g.grantee::pg_catalog.regrole::text,'PUBLIC'), g.privilege_type), '')
    INTO v_acl_pre
    FROM pg_catalog.pg_class c, LATERAL pg_catalog.aclexplode(c.relacl) g
   WHERE c.oid = 'public.pcm_manual_no_email_excluded'::pg_catalog.regclass
     AND g.grantee IS DISTINCT FROM c.relowner
     AND g.grantee IS DISTINCT FROM pg_catalog.to_regrole('service_role');
  IF v_acl_pre <> '' THEN
    RAISE EXCEPTION '後置閘④:除了 owner 與 service_role, 不該有任何人有權限, 而實得【%】⇒ 拒 COMMIT', v_acl_pre;
  END IF;

  -- ⑤ 🔴 **`security_invoker` ⇒ body 裡那四支函式用【呼叫者】的權限跑。**
  --    ⇒ 若某個讀者的 EXECUTE 被收掉過, **view 建得起來、靜態全綠, 而查它的人一次錯一次。**
  --    🛑 這道斷言是 `scripts/invoker-view-execute-gate.py` 叫出來的, 而它叫得對。
  --    🔬 2026-09-19 正式庫實查:四支對 `service_role` 與 `postgres` 皆 **t**
  --       ⚪ 判別力對照:同一把尺問 `anon` ⇒ **f**(所以不是對誰都回 t)
  --    🔵 而 `pcm_js_trim_whitespace` **舊定義就在用**(實查)⇒ 那條路今天已經在跑。
  --    ⚠️ **那道閘自己說它不驗「斷言問對了角色」** ⇒ 這裡問的是**這支 view 真正的兩個讀者**
  --       (`postgres` 與 `service_role`, 2026-09-19 實查的 ACL)—— 不是隨便挑一個角色來湊。
  -- 🛑 **寫成【字面】不是迴圈 —— 這不是囉嗦, 是刻意的。**
  --    `scripts/invoker-view-execute-gate.py` 是**字面尺**, 而它自己列的盲區逐字:
  --      「函式名放在字串/變數裡, 字面尺【撈不到它】」
  --    🔬 我第一版用 `FOREACH v_o IN ARRAY ARRAY[…]` ⇒ **那道閘照樣說「沒有一條事後斷言」**
  --    ⇒ 📌 **一個更聰明的寫法, 讓一道守門看不見它要守的東西。**
  --    ⚪ 而人也一樣:字面寫出來, `grep` 得到「這支 view 斷言了哪四支函式」。
  -- ⛔ ~~原本每支函式問兩個角色(service_role 與 postgres), 共 8 個 IF。~~
  -- 🔴 **`postgres` 那四塊刪掉了(R1 nit6)** —— 四支函式的 owner 都是 `postgres`,
  --    **owner 永遠有 EXECUTE**(除非有人明文對 owner REVOKE, 而 repo 裡沒有)⇒ **那四塊不承重**。
  --    📌 而板 216 的教訓是「不要再加閘」;**這一次是反過來用:把不承重的那一半【刪掉】。**
  IF NOT pg_catalog.has_function_privilege('service_role', 'public.pcm_js_trim_whitespace()'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '後置閘⑤:service_role 叫不動 public.pcm_js_trim_whitespace() ⇒ 這支 view 是 security_invoker, 它會【建得起來而查不動】⇒ 拒 COMMIT';
  END IF;
  IF NOT pg_catalog.has_function_privilege('service_role', 'public.pcm_shipped_email_dedup_key(uuid,uuid)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '後置閘⑤:service_role 叫不動 public.pcm_shipped_email_dedup_key(uuid,uuid) ⇒ 這支 view 是 security_invoker, 它會【建得起來而查不動】⇒ 拒 COMMIT';
  END IF;
  IF NOT pg_catalog.has_function_privilege('service_role', 'public.pcm_tracking_corrected_at_key(timestamptz)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '後置閘⑤:service_role 叫不動 public.pcm_tracking_corrected_at_key(timestamptz) ⇒ 這支 view 是 security_invoker, 它會【建得起來而查不動】⇒ 拒 COMMIT';
  END IF;
  IF NOT pg_catalog.has_function_privilege('service_role', 'public.pcm_tracking_corrected_dedup_key(uuid,uuid,timestamptz)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '後置閘⑤:service_role 叫不動 public.pcm_tracking_corrected_dedup_key(uuid,uuid,timestamptz) ⇒ 這支 view 是 security_invoker, 它會【建得起來而查不動】⇒ 拒 COMMIT';
  END IF;

  -- ⑥ ⚪ 它讀得出來 —— 定義語法對 ≠ 跑得動(欄型別不合、函式簽章不合都在這裡才炸)。
  PERFORM 1 FROM public.pcm_manual_no_email_excluded LIMIT 1;

  -- 🔴 R2 N1:原本寫「ACL 與貼前一字不差 · **兩個**讀者都叫得動」—— **兩句都已經是假的**。
  RAISE NOTICE '✅ 後置閘:欄位 = 新定義那六個 · 四塊 surface 都在 · security_invoker · service_role 恰好只有 SELECT · 其餘角色皆無 · service_role 叫得動那四支函式 · 查得動 · 註解已放回';
  RAISE NOTICE '⏳ 貼完請跑:SELECT public.pcm_acl_digest_record(); 再 pcm_acl_approve_latest(理由帶版本號); 再 pcm_acl_drift_status —— 順序不能反。';
END $post$;

COMMIT;
