#!/usr/bin/env bash
# 452b-harness.sh — #452 片 2a-2 乙(採購作廢 RPC)的**拋棄式 PG 實跑 harness**
#
# 為什麼要有它:.sql 對三綠(typecheck/lint/build)是**恆綠**、零判別力
# (scripts/check-syntax-nonts.ts 只做括號配對,它自己的檔頭逐字說明「.sql 沒有真正的語法檢查」)。
# ⇒ 這支在**本機拋棄式 PG 17.10** 上真的跑一遍:前置閘 → 建表建函式 → 後置斷言 → 16 格行為 → 回退 → 再前推 → 再回退。
#
# 🔴 誠實邊界(不要把本 harness 的綠讀成「正式庫沒問題」):
#   · 前置 schema 是**最小樁**,不是正式庫的複製品(見 §1)。A4a 的 trigger、A2b1 的守門、
#     RLS policy、真實資料量**都不在**。⇒ 本 harness 證明的是「這支 SQL 能被 PG 解析與執行、
#     每條守門的分支都真的走得到」,**不證明它與正式庫其他物件的互動**。
#   · 那一層的驗證點在 migration 自己的前置閘 P1-P5 與後置 A1-A11,由 Sean apply 當天實跑。
#   · 🔴 **明列本 harness【證不到】的東西**(codex 關卡2 F13 要求寫死,免得「沒提到」被讀成「涵蓋了」):
#       ① A4a 的重算 trigger 完全不在樁裡 ⇒ **作廢之後三軸有沒有正確重算,這支證不了**。
#       ② 沒有 DEFERRED / IMMEDIATE 雙模式 ⇒ plan 的 B-DEFER 那一格 **不可能**由本 harness 證明。
#       ③ A2b1 跨列總量守門、RLS policy、真實併發、真實資料量:全部不在。
#     ⇒ 這三項要嘛在正式庫 apply 當天驗,要嘛需要另一支帶完整 schema 的 harness。**現在兩者都沒有。**
#
# 用法:bash scripts/452b-harness.sh    (需要 /opt/homebrew/opt/postgresql@17)
# 結束會自己收掉 cluster;失敗會保留 /tmp/pcm452b 供查。
set -euo pipefail

PGBIN=/opt/homebrew/opt/postgresql@17/bin
DATADIR=/tmp/pcm452b/data
SOCK=/tmp/pcm452b
PORT=55452
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MIG="$ROOT/supabase/migrations/20260814180000_m4b_e10_452_2a2b_admin_void_item_procurement.sql"
DOWN="$ROOT/scripts/452b-down.sql"

# 🔴 LC_ALL=C 不是裝飾:沒有它 PG 17 在本機會 FATAL「postmaster became multithreaded during startup」
#    (2026-08-14 實際撞到,錯誤訊息完全指不到 locale)。
export LC_ALL=C PGHOST="$SOCK" PGPORT="$PORT" PGUSER=postgres PGDATABASE=postgres

command -v "$PGBIN/initdb" > /dev/null || { echo "找不到 $PGBIN/initdb"; exit 1; }
test -f "$MIG" || { echo "找不到 migration:$MIG"; exit 1; }
test -f "$DOWN" || { echo "找不到 down:$DOWN"; exit 1; }

rm -rf /tmp/pcm452b
"$PGBIN/initdb" -D "$DATADIR" -U postgres --no-locale --encoding=UTF8 > /tmp/pcm452b-initdb.log 2>&1
"$PGBIN/pg_ctl" -D "$DATADIR" -o "-p $PORT -k $SOCK -c listen_addresses=" -l /tmp/pcm452b/log start > /dev/null
trap '"$PGBIN/pg_ctl" -D "$DATADIR" stop -m immediate > /dev/null 2>&1 || true' EXIT
sleep 2

psql_run() { "$PGBIN/psql" -v ON_ERROR_STOP=1 -q "$@"; }

echo "── §1 最小前置 schema(不是正式庫複製品)──"
psql_run <<'PREREQ'
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE FUNCTION public.pcm_b2_is_blank(t text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT t IS NULL OR btrim(t, E' \t\r\n' || U&'\3000' || U&'\00A0' || U&'\200B') = '' $$;
CREATE TABLE public.order_item_procurement (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_item_id uuid NOT NULL, supplier_id uuid NOT NULL,
  allocated_quantity integer NOT NULL DEFAULT 1, received_quantity integer NOT NULL DEFAULT 0,
  voided_at timestamptz, void_reason text,
  CONSTRAINT order_item_procurement_void_pair
    CHECK ((voided_at IS NULL) = (void_reason IS NULL)
           AND (void_reason IS NULL OR NOT public.pcm_b2_is_blank(void_reason))));
CREATE UNIQUE INDEX order_item_procurement_business_key
  ON public.order_item_procurement (order_item_id, supplier_id) WHERE voided_at IS NULL;
CREATE TABLE public.order_item_procurement_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  procurement_id uuid NOT NULL REFERENCES public.order_item_procurement(id), quantity integer NOT NULL);
CREATE TABLE public.admin_audit_log (
  id bigserial PRIMARY KEY, actor text NOT NULL, action text NOT NULL, target text NOT NULL,
  before jsonb, after jsonb, reason text, request_id text, source_app text);
-- 🔴 codex 關卡2 F11:~~原本樁把 `PROCUREMENT_VOIDED` 藏在 `IF false` 死枝~~ ——
--    那等於用一個**永遠走不到的字面**去餵 migration 的前置閘 P2,harness 在替它背書。
--    改成真的可達的分流(讀 voided_at 再回碼),與甲片的實際形狀同構。
CREATE FUNCTION public.admin_record_item_receipt(
  p_procurement_id uuid, p_quantity integer, p_surplus_quantity integer,
  p_received_at timestamptz, p_note text, p_actor text, p_request_id text
) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_voided timestamptz;
BEGIN
  SELECT voided_at INTO v_voided FROM public.order_item_procurement WHERE id = p_procurement_id;
  IF v_voided IS NOT NULL THEN RETURN 'PROCUREMENT_VOIDED'; END IF;
  RETURN 'RECORDED';
END $$;
-- 🔴 樁的查詢形狀必須與甲片**可執行的那一行**同構(`20260814100000:406` 逐字 `AND voided_at IS NULL`),
--    否則 migration 的 P3 會誤判「甲只上了一半」。這一格 2026-08-14 實際紅過一次,是 P3 收緊之後抓到的。
CREATE FUNCTION public.admin_upsert_item_procurement(
  p_order_id uuid, p_order_item_id uuid, p_allocated integer, p_reply text, p_channel text,
  p_submitted_at timestamptz, p_supplier_order_no text, p_exception text, p_expected date,
  p_actor text, p_request_id text, p_preserve boolean
) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.order_item_procurement
   WHERE order_item_id = p_order_item_id
     AND voided_at IS NULL
   LIMIT 1;
  RETURN CASE WHEN v_id IS NULL THEN 'CREATED' ELSE 'UPDATED' END;
END $$;
PREREQ

echo "── §2 apply migration(前置閘 P1-P5 + 後置 A1-A8 都會自己 RAISE)──"
psql_run -f "$MIG"

echo "── §3 行為格(每格印出回傳碼;RAISE 型的用 NOTICE 收)──"
psql_run <<'CASES'
INSERT INTO public.order_item_procurement (id, order_item_id, supplier_id, allocated_quantity, received_quantity) VALUES
 ('11111111-1111-4111-8111-111111111111','aaaaaaaa-0000-4000-8000-000000000001','bbbbbbbb-0000-4000-8000-000000000001',3,0),
 ('22222222-2222-4222-8222-222222222222','aaaaaaaa-0000-4000-8000-000000000002','bbbbbbbb-0000-4000-8000-000000000002',5,2),
 ('33333333-3333-4333-8333-333333333333','aaaaaaaa-0000-4000-8000-000000000003','bbbbbbbb-0000-4000-8000-000000000003',4,0),
 ('44444444-4444-4444-8444-444444444444','aaaaaaaa-0000-4000-8000-000000000004','bbbbbbbb-0000-4000-8000-000000000004',9,5);
INSERT INTO public.order_item_procurement_receipts (procurement_id, quantity) VALUES
 ('22222222-2222-4222-8222-222222222222', 2), ('44444444-4444-4444-8444-444444444444', 2);

DO $h$
DECLARE r text; n bigint;
  PROC1 constant uuid := '11111111-1111-4111-8111-111111111111';
  PROC2 constant uuid := '22222222-2222-4222-8222-222222222222';
  PROC3 constant uuid := '33333333-3333-4333-8333-333333333333';
  PROC4 constant uuid := '44444444-4444-4444-8444-444444444444';
  fails int := 0;
BEGIN
  -- 回傳碼型(每格斷言逐字相符,不是「有回東西就好」)
  r := public.admin_void_item_procurement(PROC1, NULL, 'sean', 'req-c1');
  IF r <> 'REASON_REQUIRED' THEN fails := fails + 1; RAISE WARNING 'C1 期望 REASON_REQUIRED 實 %', r; END IF;
  r := public.admin_void_item_procurement(PROC1, U&'\3000' || U&'\200B', 'sean', 'req-c2');
  IF r <> 'REASON_REQUIRED' THEN fails := fails + 1; RAISE WARNING 'C2(全形空白+零寬)期望 REASON_REQUIRED 實 %', r; END IF;
  r := public.admin_void_item_procurement('99999999-9999-4999-8999-999999999999', 'x', 'sean', 'req-c3');
  IF r <> 'PROCUREMENT_NOT_FOUND' THEN fails := fails + 1; RAISE WARNING 'C3 期望 PROCUREMENT_NOT_FOUND 實 %', r; END IF;
  r := public.admin_void_item_procurement(PROC2, '不要了', 'sean', 'req-c4');
  IF r <> 'HAS_RECEIPTS_UNDO_FIRST' THEN fails := fails + 1; RAISE WARNING 'C4 期望 HAS_RECEIPTS_UNDO_FIRST 實 %', r; END IF;
  r := public.admin_void_item_procurement(PROC1, '供應商缺料改下別家', 'sean', 'req-c5');
  IF r <> 'VOIDED' THEN fails := fails + 1; RAISE WARNING 'C5 期望 VOIDED 實 %', r; END IF;
  r := public.admin_void_item_procurement(PROC1, '供應商缺料改下別家', 'sean', 'req-c5');
  IF r <> 'DUPLICATE_REQUEST' THEN fails := fails + 1; RAISE WARNING 'C6 期望 DUPLICATE_REQUEST 實 %', r; END IF;
  r := public.admin_void_item_procurement(PROC1, '再作廢一次', 'sean', 'req-c7');
  IF r <> 'ALREADY_VOIDED' THEN fails := fails + 1; RAISE WARNING 'C7 期望 ALREADY_VOIDED 實 %', r; END IF;

  -- 落地:兩欄同時寫、原因逐字
  SELECT count(*) INTO n FROM public.order_item_procurement
   WHERE id = PROC1 AND voided_at IS NOT NULL AND void_reason = '供應商缺料改下別家';
  IF n <> 1 THEN fails := fails + 1; RAISE WARNING 'C8 兩欄未同時寫或原因不逐字'; END IF;
  -- 帳本恰一列(C6 的重放沒有寫第二列)
  SELECT count(*) INTO n FROM public.order_item_procurement_void_requests;
  IF n <> 1 THEN fails := fails + 1; RAISE WARNING 'C9 帳本期望 1 列實 %', n; END IF;
  -- 稽核恰一列、action 逐字
  SELECT count(*) INTO n FROM public.admin_audit_log WHERE action = 'procurement.void' AND request_id = 'req-c5';
  IF n <> 1 THEN fails := fails + 1; RAISE WARNING 'C10 稽核期望 1 列實 %', n; END IF;
  -- 🔴 codex 關卡2 F14:~~原本只數 action/request_id~~ ⇒ `before`/`after` 整包寫錯也全綠。
  --    改成逐面驗:before 記錄「作廢前」(voided_at 為 null)、after 記錄「作廢後」的實值六欄。
  SELECT count(*) INTO n FROM public.admin_audit_log
   WHERE request_id = 'req-c5'
     AND actor = 'sean' AND source_app = 'admin'
     AND target = 'procurement:' || PROC1::text
     AND reason = '供應商缺料改下別家'
     AND before ->> 'voided_at' IS NULL
     AND before ? 'allocated_quantity' AND before ? 'supplier_id' AND before ? 'order_item_id'
     AND after  ->> 'voided_at' IS NOT NULL
     AND after  ->> 'void_reason' = '供應商缺料改下別家'
     AND (after ->> 'allocated_quantity')::int = 3;
  IF n <> 1 THEN fails := fails + 1; RAISE WARNING 'C10b 稽核 before/after 形狀不符(期望 1 列實 %)', n; END IF;
  -- Q-S1=A:作廢之後同鍵可重新下單(partial unique 不撞)
  INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity)
  VALUES ('aaaaaaaa-0000-4000-8000-000000000001','bbbbbbbb-0000-4000-8000-000000000001',2);
  SELECT count(*) INTO n FROM public.order_item_procurement
   WHERE order_item_id='aaaaaaaa-0000-4000-8000-000000000001' AND supplier_id='bbbbbbbb-0000-4000-8000-000000000001';
  IF n <> 2 THEN fails := fails + 1; RAISE WARNING 'C11 同鍵應可共存 2 列實 %', n; END IF;

  IF fails <> 0 THEN RAISE EXCEPTION '§3 回傳碼型有 % 格不符', fails; END IF;
  RAISE NOTICE '§3 回傳碼型 C1-C11 全過';
END $h$;

-- RAISE 型:每格都必須真的丟出來,沒丟 = 守門失效。
-- 🔴🔴 codex 關卡2 F12:~~原本每格只 catch `WHEN others` 就當過~~ ⇒ **任何**例外都算綠 ——
--    拿掉 V2 的 actor 守門之後,改由帳本的 `actor_shape` CHECK 丟 23514,這幾格照樣全綠,
--    而它們宣稱驗的是「V2 有擋」。⇒ 每格改成**同時比對錯誤訊息的特徵字**,錯的來源不算過。
DO $h$
DECLARE r text;
BEGIN
  BEGIN r := public.admin_void_item_procurement('33333333-3333-4333-8333-333333333333','別的原因','sean','req-c5');
        RAISE EXCEPTION 'C12 沒 RAISE(request_id 重用於不同內容)實回 %', r;
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'C12 沒 RAISE%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%被重用於不同內容%' THEN
      RAISE EXCEPTION 'C12 RAISE 了但來源不對(期望 V5 的重用守門)實訊息 [%] SQLSTATE=%', left(SQLERRM,80), SQLSTATE;
    END IF;
  END;

  BEGIN r := public.admin_void_item_procurement('33333333-3333-4333-8333-333333333333','原因','Sean 大寫','req-c14');
        RAISE EXCEPTION 'C14 沒 RAISE(actor 非法)實回 %', r;
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'C14 沒 RAISE%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%p_actor 缺失或非法%' THEN
      RAISE EXCEPTION 'C14 RAISE 了但來源不對(期望 V2,不是帳本 CHECK)實訊息 [%] SQLSTATE=%', left(SQLERRM,80), SQLSTATE;
    END IF;
  END;

  BEGIN r := public.admin_void_item_procurement('33333333-3333-4333-8333-333333333333','原因','sean','REQ-C15');
        RAISE EXCEPTION 'C15 沒 RAISE(request_id 非全小寫)實回 %', r;
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'C15 沒 RAISE%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%p_request_id 形狀非法%' THEN
      RAISE EXCEPTION 'C15 RAISE 了但來源不對(期望 V2,不是帳本 CHECK)實訊息 [%] SQLSTATE=%', left(SQLERRM,80), SQLSTATE;
    END IF;
  END;

  -- 🔴🔴 C17 = **唯一能分辨 V7 順序的那一格**。
  --   PROC4:receipts SUM = 2(非零)且 received_quantity = 5(不一致)。
  --   · 正確順序(先驗一致)⇒ RAISE
  --   · 錯誤順序(先驗非零)⇒ 回 HAS_RECEIPTS_UNDO_FIRST、RAISE 分支變死枝
  --   ⚠️ 只用「received=7 / receipts=0」那種測資是**分辨不出來的**(兩種順序都會 RAISE)——
  --      2026-08-14 施工當場先寫錯一版,突變驗證時才發現。
  BEGIN r := public.admin_void_item_procurement('44444444-4444-4444-8444-444444444444','原因','sean','req-c17');
        RAISE EXCEPTION 'C17 沒 RAISE ⇒ 順序是【先驗非零】= 一致性 RAISE 是死枝;實回 %', r;
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'C17 沒 RAISE%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%到貨兩來源不一致%' THEN
      RAISE EXCEPTION 'C17 RAISE 了但來源不對(期望 V7 的一致性檢查)實訊息 [%] SQLSTATE=%', left(SQLERRM,80), SQLSTATE;
    END IF;
  END;

  RAISE NOTICE '§3 RAISE 型 C12/C14/C15/C17 全過(每格都比對過錯誤來源,不是「有 RAISE 就算」)';
END $h$;
CASES

echo "── §4 隔離閘(P2B02;必須在真的 repeatable read 交易裡量)──"
"$PGBIN/psql" -v ON_ERROR_STOP=1 -q <<'ISO'
BEGIN ISOLATION LEVEL REPEATABLE READ;
DO $$ DECLARE r text; BEGIN
  BEGIN r := public.admin_void_item_procurement('33333333-3333-4333-8333-333333333333','原因','sean','req-c16');
        RAISE EXCEPTION 'C16 沒 RAISE(隔離閘失效)實回 %', r;
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'C16 沒 RAISE%' THEN RAISE; END IF;
    IF SQLSTATE <> 'P2B02' THEN RAISE EXCEPTION 'C16 SQLSTATE 期望 P2B02 實 %', SQLSTATE; END IF;
    RAISE NOTICE 'C16 過(SQLSTATE=P2B02)';
  END;
END $$;
ROLLBACK;
ISO

echo "── §5 回退(帶著一筆【真實作廢】的列跑,證明它不是 fail-DANGEROUS)──"
BEFORE=$("$PGBIN/psql" -tAc "SELECT count(*) FROM public.order_item_procurement WHERE voided_at IS NOT NULL;")
test "$BEFORE" -ge 1 || { echo "§5 前提不成立:應至少有 1 筆作廢列,實 $BEFORE"; exit 1; }
psql_run -f "$DOWN"
AFTER=$("$PGBIN/psql" -tAc "SELECT count(*) FROM public.order_item_procurement WHERE voided_at IS NOT NULL;")
test "$BEFORE" = "$AFTER" || { echo "§5 回退動到了業務資料:before=$BEFORE after=$AFTER"; exit 1; }
echo "   回退前後作廢列數皆 $BEFORE(零業務資料損失)"

echo "── §6 再前推 → 再回退(證明可重複,不是一次性)──"
psql_run -f "$MIG"
psql_run -f "$DOWN"

echo "✅ 452b harness 全過(§1-§6)。誠實邊界見本檔檔頭:最小樁 ≠ 正式庫。"
