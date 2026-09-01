-- 出貨箱【作廢 ⇒ 復原 ⇒ 下一次掃描】生命週期實跑 probe(拋棄式 PG 專用, 全程 ROLLBACK)
--
-- 🎯 它答的那一格:箱被作廢又被復原之後, 那封出貨信【還會不會被排進來】?
--    ⇒ 板上 ⟦b4-SHIPUNVOID1⟧ 原本記「永久漏信」, 而那個結論是【讀碼推的】, ~~沒有人跑過~~。
--
-- 🛑🛑 **就地訂正(2026-09-02 01:3x, 本檔 commit 之後 12 分鐘, 由寫它的人自己抓到)**:
--    ~~「沒有人跑過」~~ **是假的。舊字面留著不刪, 讓搜舊句的人同一發撞到這裡。**
--    🔴 `scripts/shipunvoid1-apply-probe.sh` **早就存在**(2026-08-31 那一片自帶的),
--       而我當場實跑它 ⇒ `PASS=14 FAIL=0`。
--    🔴 而它涵蓋的世界【比本檔多】:
--       W3 必死正對照(不套本片 ⇒ W1 那一格必須變 0)· W4/W4b codex 那個並發順序 ·
--       W5 作廢→復原→再作廢→再復原兩輪。**本檔只有 A/D/B/C 四格 + 一發突變。**
--    ⇒ ⇒ 📌 **那個缺陷不只被修過, 它還被【證明修好了】—— 而我花了一小時重做一遍。**
--
-- 🔵 **那本檔還剩什麼價值?一格, 而它是真的**:
--    那支既有 probe 的射程自陳「schema 是**最小 stub**(orders/shipments 只有本片用得到的欄)」;
--    而本檔跑在 `d1t2-rehearsal.sh` **replay 全部 migration** 的庫上
--    ⇒ 真的 CHECK 約束、真的 trigger、真的 oiqs 摘要重算都在(本檔造世界時被它們擋了六次)。
--    ⇒ **兩支答的是同一個問題的兩個保真度, 不是同一支的兩份。**
--    🛑 而那不是我當初寫它的理由 —— 我當初以為沒有人跑過。**這一格是事後才成立的, 照實寫。**
--
-- 🔴 **而我為什麼沒發現**:我從【板上那一列】出發, 而它是 open 的。
--    我沒有跑 `scripts/is-this-still-true.sh SHIPUNVOID` —— 而那支工具一發就印出
--    `7d2be3be fix(adapters): 箱作廢後復原 ⇒ 出貨信永遠不寄 —— 退休那把鍵, 與 status 同一發`
--    加上 12 個碼裡的落點, 含那支既有 probe。
--    📌 **⇒ 修正的機制【全部都在】, 而缺的是【我沒跑那一發】。**
--    🛑 **⇒ ⇒ 所以這一件的解法不是再寫一份文件, 是那一列的態該從 open 改掉。**
--
-- 🔴 兩端都要驗, 而這正是這一件的病:
--    · view 那一端 `20260822010000:260` 的 anti-join **不分 status** ⇒ 一列存在就永久擋住
--    · 而【寫那一列的那一端】`SupabaseEmailOutboxAdapter.ts:597` 把 dedup_key 改成
--      `${key}:voided:${id}` ⇒ 🔴 **那把正規鍵被退休了** ⇒ anti-join 比不到 ⇒ 會重新排
--    📌 只讀 view 那一端會得到「缺陷存在」, 而那一端【完全正確】—— 沒有東西會說你只讀了一半。
--
-- 🔴 而那支 migration 自己的 COMMENT(20260830060000:177)逐字寫著「這一列會永久擋住重新 enqueue
--    ⇒ 那位客人永遠收不到出貨信而零訊號」—— **而同一片的 TS 那一半退休了鍵。**
--    ⇒ ⇒ 同一片的兩半在檔案裡互相矛盾, 而 SQL 那一半是被引用的那一半。
--
-- 四個世界(A/D 是負對照, B 是 -0a 加的第二個負對照, C 是要答的那一格):
--   A 從未作廢 · 無 outbox      ⇒ 應被排    ⇒ 證明這把尺【不恆空】
--   D 從未作廢 · outbox 正規鍵  ⇒ 不該被排  ⇒ 證明 anti-join 真的在擋 =【不恆滿】
--   B 作廢而【沒有】復原        ⇒ 不該被排  ⇒ 證明退休鍵不是「該擋的時候不擋」
--   C 作廢 ⇒ 復原               ⇒ 🎯 答案
--
-- 🟢 突變 M1(另存 /tmp/sv-mut.sql 跑過, 已殺死):把 C 的鍵【不退休】⇒ C 就不被排
--    ⇒ 證明主發的「C 被排」確實是退休鍵造成的, 不是復原刪掉了 outbox 列。
--
-- ⚠️ 效度限制(照實寫):
--   · 作廢與復原【有】走真正的 admin_void_shipment / admin_unvoid_shipment
--   · 而【出貨】那一步是直接 UPDATE shipped_at, 不是走出貨 RPC ——
--     本發要驗的是 anti-join 與退休鍵, 而 view 只讀 shipped_at / deleted_at
--   · 退休鍵那一列是照 TS 的形狀【手寫】的, 不是真的跑那支 TS ⇒
--     🔴 「TS 真的會寫出那個形狀」這一格仍然是【讀碼】, 要關掉它得跑真的 adapter
--
\set ON_ERROR_STOP on
BEGIN;

-- 四個世界。每一個 = 一位客人 + 一張訂單 + 一個品項 + 一個箱。
-- A 從未作廢 · 無 outbox            ⇒ 應被排(負對照①:尺不恆空)
-- D 從未作廢 · outbox【正規鍵】      ⇒ 不該被排(負對照②:anti-join 真的在擋 = 尺不恆滿)
-- B 作廢而【沒有】復原 · 退休鍵      ⇒ 不該被排(-0a 指定的 ③)
-- C 作廢 ⇒ 復原 · 退休鍵            ⇒ 🎯 要答的那一格

CREATE TEMP TABLE w(tag text, uid uuid, oid uuid, iid uuid, sid uuid) ON COMMIT DROP;
INSERT INTO w(tag, uid, oid, iid, sid) VALUES
 ('A','00000000-0000-4000-8000-00000000aa01','00000000-0000-4000-8000-00000000aa11','00000000-0000-4000-8000-00000000aa21','00000000-0000-4000-8000-00000000aa31'),
 ('D','00000000-0000-4000-8000-00000000dd01','00000000-0000-4000-8000-00000000dd11','00000000-0000-4000-8000-00000000dd21','00000000-0000-4000-8000-00000000dd31'),
 ('B','00000000-0000-4000-8000-00000000bb01','00000000-0000-4000-8000-00000000bb11','00000000-0000-4000-8000-00000000bb21','00000000-0000-4000-8000-00000000bb31'),
 ('C','00000000-0000-4000-8000-00000000cc01','00000000-0000-4000-8000-00000000cc11','00000000-0000-4000-8000-00000000cc21','00000000-0000-4000-8000-00000000cc31');

INSERT INTO auth.users(id,email,created_at) SELECT uid, 'sv-'||tag||'@example.invalid', now() FROM w;
INSERT INTO public.customers(user_id,email,name) SELECT uid,'sv-'||tag||'@example.invalid','sv '||tag FROM w
  ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.orders(id,display_id,customer_user_id,notification_email,shipping_address_snapshot,
                          tier_at_checkout,subtotal,shipping_fee,discount_total,total,
                          shipping_method,shipping_method_at_checkout,invoice)
SELECT oid,'PCM-2026-91'||CASE tag WHEN 'A' THEN '01' WHEN 'D' THEN '02' WHEN 'B' THEN '03' ELSE '04' END,uid,'sv-'||tag||'@example.invalid',
       '{"name":"sv","phone":"0900000000","line":"probe"}'::jsonb,
       'general'::public.member_tier,100,0,0,100,'home','home','{"type":"personal"}'::jsonb FROM w;

INSERT INTO public.order_items(id,order_id,variant_sku,product_snapshot,quantity,unit_price,line_total)
SELECT iid,oid,'SV-SKU','{"title":"sv","sku":"SV-SKU","spec":{}}'::jsonb,1,100,100 FROM w;

INSERT INTO public.shipments(id,shipment_reference,customer_user_id,recipient_snapshot,carrier_code,carrier_note,hct_status,shipped_at,created_at,updated_at)
SELECT sid,'SV222'||CASE tag WHEN 'A' THEN '2' WHEN 'D' THEN '3' WHEN 'B' THEN '4' ELSE '5' END,uid,
       '{"name":"sv","phone":"0900000000","line":"probe"}'::jsonb,
       'other','probe 用','draft',NULL,now(),now() FROM w;

INSERT INTO public.shipment_items(shipment_id,order_item_id,shipped_quantity)
SELECT sid,iid,1 FROM w;

-- 入庫:instock 軸走 procurement + receipts(oiqs_shipped_le_instock 要 instock >= shipped)
INSERT INTO public.order_item_procurement(id, order_item_id, allocated_quantity, supplier_id)
SELECT ('00000000-0000-4000-8000-00000000ff0'||CASE tag WHEN 'A' THEN '1' WHEN 'D' THEN '2' WHEN 'B' THEN '3' ELSE '4' END)::uuid,
       iid, 1, (SELECT id FROM public.suppliers LIMIT 1) FROM w;

INSERT INTO public.order_item_procurement_receipts(procurement_id, quantity, received_at, received_by)
SELECT ('00000000-0000-4000-8000-00000000ff0'||CASE tag WHEN 'A' THEN '1' WHEN 'D' THEN '2' WHEN 'B' THEN '3' ELSE '4' END)::uuid,
       1, now(), 'probe' FROM w;

-- ⚠️ 效度限制:出貨這一步是直接 UPDATE, 不是走出貨 RPC ——
--    本發要驗的是 anti-join 與退休鍵, 而 view 只讀 shipped_at / deleted_at。
--    作廢與復原【有】走真正的函式。
-- 🔴 逐列 UPDATE:pcm_b2_shipments_no_batch_update 擋一句改多列(而它是對的)
DO $ship$
DECLARE r record;
BEGIN
  FOR r IN SELECT sid FROM w LOOP
    UPDATE public.shipments SET shipped_at = now() - interval '1 hour' WHERE id = r.sid;
  END LOOP;
END
$ship$;

-- ── outbox 列 ────────────────────────────────────────────────
-- D:正規鍵(未退休)⇒ anti-join 應該擋住它
INSERT INTO public.email_outbox(event_type,order_id,dedup_key,recipient_email,subject,payload,status,attempts,max_attempts,next_retry_at)
SELECT 'order_shipped',oid,public.pcm_shipped_email_dedup_key(sid,oid),'sv-D@example.invalid','出貨通知','{}'::jsonb,'sent',1,5,now()
  FROM w WHERE tag='D';

-- B / C:退休鍵(逐字複製 SupabaseEmailOutboxAdapter.ts:597 的形狀 `${key}:voided:${id}`)
INSERT INTO public.email_outbox(id,event_type,order_id,dedup_key,recipient_email,subject,payload,status,attempts,max_attempts,last_error_code,next_retry_at)
SELECT eid, 'order_shipped', oid,
       public.pcm_shipped_email_dedup_key(sid,oid)||':voided:'||eid::text,
       'sv@example.invalid','出貨通知','{}'::jsonb,'skipped_shipment_voided',1,5,'shipment_voided',now()
  FROM (SELECT w.*, ('00000000-0000-4000-8000-00000000ee0'||CASE tag WHEN 'B' THEN '1' ELSE '2' END)::uuid AS eid
          FROM w WHERE tag IN ('B','C')) x;

-- ── 真的呼叫那兩支函式(不是我自己 UPDATE deleted_at)──────────
SELECT public.admin_void_shipment('sv-void-B',(SELECT sid FROM w WHERE tag='B'),'probe 作廢');
SELECT public.admin_void_shipment('sv-void-C',(SELECT sid FROM w WHERE tag='C'),'probe 作廢');
SELECT public.admin_unvoid_shipment('sv-unvoid-C',(SELECT sid FROM w WHERE tag='C'));

-- ── 世界狀態(先印出來,免得下面那張表被讀成憑空的)────────────
\echo ''
\echo '=== 世界狀態:deleted_at 與 outbox 鍵 ==='
SELECT w.tag,
       (s.deleted_at IS NOT NULL) AS 已作廢,
       coalesce((SELECT string_agg(CASE WHEN e.dedup_key = public.pcm_shipped_email_dedup_key(w.sid,w.oid)
                                        THEN '正規鍵' ELSE '退休鍵' END, ',')
                   FROM public.email_outbox e WHERE e.order_id = w.oid), '(無 outbox 列)') AS outbox
  FROM w JOIN public.shipments s ON s.id = w.sid ORDER BY w.tag;

-- ── 🎯 真的查那支 view(不是我自己重寫一份像它的查詢)────────
\echo ''
\echo '=== pcm_shipped_email_pending 排出來的 ==='
SELECT w.tag,
       CASE WHEN p.shipment_id IS NOT NULL THEN '✅ 被排進來(會寄信)' ELSE '— 不在清單裡' END AS 結果
  FROM w LEFT JOIN public.pcm_shipped_email_pending p
    ON p.shipment_id = w.sid AND p.order_id = w.oid
 ORDER BY w.tag;

-- ── 判定:四格全部要對,任一不對就 RAISE ──────────────────────
DO $chk$
DECLARE
  f_a bool; f_d bool; f_b bool; f_c bool;
BEGIN
  SELECT EXISTS(SELECT 1 FROM public.pcm_shipped_email_pending p JOIN w ON p.shipment_id=w.sid WHERE w.tag='A') INTO f_a;
  SELECT EXISTS(SELECT 1 FROM public.pcm_shipped_email_pending p JOIN w ON p.shipment_id=w.sid WHERE w.tag='D') INTO f_d;
  SELECT EXISTS(SELECT 1 FROM public.pcm_shipped_email_pending p JOIN w ON p.shipment_id=w.sid WHERE w.tag='B') INTO f_b;
  SELECT EXISTS(SELECT 1 FROM public.pcm_shipped_email_pending p JOIN w ON p.shipment_id=w.sid WHERE w.tag='C') INTO f_c;

  IF NOT f_a THEN RAISE EXCEPTION '🟢負對照① A(正常單)沒有被排 ⇒ 這把尺是恆空的 ⇒ 本發全部作廢'; END IF;
  IF f_d     THEN RAISE EXCEPTION '🟢負對照② D(正規鍵已存在)竟然被排 ⇒ anti-join 沒在擋 ⇒ 本發全部作廢'; END IF;
  IF f_b     THEN RAISE EXCEPTION '③ B(作廢而未復原)竟然被排 ⇒ 作廢的箱會寄信 = 另一個缺陷'; END IF;

  RAISE NOTICE '';
  RAISE NOTICE '🟢 負對照① A 被排           = %', f_a;
  RAISE NOTICE '🟢 負對照② D 未被排         = %', NOT f_d;
  RAISE NOTICE '🟢 ③  B 未被排(作廢未復原) = %', NOT f_b;
  RAISE NOTICE '🎯 ①  C 被排(作廢⇒復原)   = %  ← 這一格就是答案', f_c;
  RAISE NOTICE '';
  IF f_c THEN
    RAISE NOTICE '⇒ 復原之後那一列【會】被重新排進來 ⇒ 出貨信會寄 ⇒ ⟦b4-SHIPUNVOID1⟧ 的缺陷【不存在】';
  ELSE
    RAISE NOTICE '⇒ 復原之後仍然排不進來 ⇒ 缺陷【存在】⇒ 對帳程式那一件要做';
  END IF;
END
$chk$;

ROLLBACK;
