#!/usr/bin/env bash
#
# ⟦0a-CANCELGATEASKSWRONG⟧ —— 「不准取消已付款的單」那道閘,在五個世界各自怎麼判。
#
# 🔴 它答的是【行為】不是【碼長什麼樣】:每一格都真的呼叫 `admin_cancel_order`,
#    然後看那張單有沒有被取消。全部包在交易裡、跑完 ROLLBACK。
#
# 用法:PORT=<port> bash scripts/cancel-gate-probe.sh <已 provision 好的 workdir>
#   (要一個拋棄式 PG:PORT=<port> bash scripts/d1t2-rehearsal.sh provision <workdir>)
#
# 🛑 效度限制:
#   · 拋棄式庫套了【所有】migration 含還沒貼的 ⇒ 它的世界 ≠ 正式站的世界
#     ⚠️ 而【這一支函式】兩邊同代:2026-09-02 07:0x 實量, 正式庫與本庫的 prosrc
#        `order_payments` 皆 5 次 / `payment_status` 皆 19 次
#   · 它不驗「員工在後台按下去會怎樣」—— app 層可能另有前置(那是另一個宣稱)
#   · 五個世界是【我挑的】—— 一個沒被列進來的世界, 它一個字都不會說
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
WORK="${1:?用法: cancel-gate-probe.sh <workdir>}"
PORT="${PORT:-54425}"
URL="postgresql://postgres@127.0.0.1:${PORT}/postgres"
export LC_ALL=C

dd="$(psql "$URL" -qtA -c "SELECT current_setting('data_directory')" 2>/dev/null || true)"
[ "$dd" = "$WORK/pgdata" ] || { echo "🔴 身分閘:連到的是 ${dd:-<查不到>},期望 ${WORK}/pgdata,拒繼續"; exit 2; }

echo "== 這個庫裡的那支函式是哪一代 =="
psql "$URL" -qtA -c "SELECT 'order_payments '||(SELECT count(*) FROM regexp_matches(prosrc,'order_payments','g'))||' 次 / payment_status '||(SELECT count(*) FROM regexp_matches(prosrc,'payment_status','g'))||' 次' FROM pg_proc WHERE proname='admin_cancel_order';"

echo
echo "== 五個世界(每一格都真的呼叫那支 RPC)=="
psql "$URL" -v ON_ERROR_STOP=1 -qtA -f - <<'SQL' 2>&1 | sed 's/^psql:<stdin>:[0-9]*: NOTICE:  //' | grep -vE '^$|^BEGIN|^DO|^ROLLBACK'
BEGIN;
DO $p$
DECLARE v_o uuid; v_u uuid; v_v uuid; v_err text; v_did text;
BEGIN
  SELECT user_id INTO v_u FROM public.customers ORDER BY user_id LIMIT 1;
  SELECT id INTO v_v FROM public.product_variants ORDER BY id LIMIT 1;
  IF v_u IS NULL OR v_v IS NULL THEN
    RAISE EXCEPTION 'fixture 前提不成立:customers 或 product_variants 是空的 ⇒ 五格都會用別的理由紅';
  END IF;

  FOR v_did, v_o IN
    SELECT * FROM (VALUES ('CTZZ23', gen_random_uuid()), ('CTZZ24', gen_random_uuid()),
                          ('CTZZ25', gen_random_uuid()), ('CTZZ26', gen_random_uuid()),
                          ('CTZZ27', gen_random_uuid())) t(a,b)
  LOOP
    INSERT INTO public.orders (id, display_id, customer_user_id, shipping_address_snapshot, tier_at_checkout,
                               subtotal, shipping_fee, discount_total, total, shipping_method,
                               shipping_method_at_checkout, invoice, payment_status, created_at)
    VALUES (v_o, v_did, v_u, '{"name":"p","phone":"0900000000","line":"p"}'::jsonb, 'general',
            1000, 0, 0, 1000, 'home', 'home', '{"type":"personal"}'::jsonb, 'unpaid'::public.payment_status, now() - interval '1 day');
    INSERT INTO public.order_items (order_id, variant_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
    SELECT v_o, v.id, v.sku, '{"title":"p","sku":"p","spec":{}}'::jsonb, 1, 1000, 1000 FROM public.product_variants v WHERE v.id = v_v;

    IF v_did = 'CTZZ24' THEN
      INSERT INTO public.order_payments (order_id, rail, amount, received_at, actor, bank_reference, request_id)
      VALUES (v_o, 'bank_transfer', 1000, now() - interval '2 hours', 'staff_1', 'REF-B', gen_random_uuid());
    ELSIF v_did = 'CTZZ25' THEN
      INSERT INTO public.order_payments (order_id, rail, amount, received_at, actor, bank_reference, request_id)
      VALUES (v_o, 'bank_transfer', 1000, now() - interval '2 hours', 'staff_1', 'REF-C', gen_random_uuid());
      UPDATE public.orders SET payment_status = 'paid'::public.payment_status WHERE id = v_o;
    ELSIF v_did = 'CTZZ27' THEN
      INSERT INTO public.order_payments (order_id, rail, amount, received_at, actor, bank_reference, request_id)
      VALUES (v_o, 'bank_transfer', 400, now() - interval '2 hours', 'staff_1', 'REF-P', gen_random_uuid());
      UPDATE public.orders SET payment_status = 'partiallyPaid'::public.payment_status WHERE id = v_o;
    ELSIF v_did = 'CTZZ26' THEN
      UPDATE public.orders SET payment_status = 'paid'::public.payment_status,
             tappay_rec_trade_id = 'REC-' || substr(v_o::text,1,8) WHERE id = v_o;
      INSERT INTO public.order_payments (order_id, rail, amount, received_at, actor, rec_trade_id)
      VALUES (v_o, 'card', 1000, now() - interval '2 hours', 'staff_1', 'REC-' || substr(v_o::text,1,8));
    END IF;

    v_err := NULL;
    BEGIN
      PERFORM public.admin_cancel_order(v_o, gen_random_uuid(), 'staff_1', 'customer_request', NULL);
    EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;

    -- 🔴 plpgsql 的 RAISE 【不吃】`%-13s` 這種寬度指定 —— 那個 `-13s` 會被當字面印出來
    --    (2026-09-02 實跑撞到:輸出變成 `status=unpaid-13s`)⇒ 一律用裸的 %。
    RAISE NOTICE '% | status=% | 收款 % 筆 | rail=% | => %',
      v_did,
      (SELECT payment_status::text FROM public.orders WHERE id = v_o),
      (SELECT count(*) FROM public.order_payments WHERE order_id = v_o),
      coalesce((SELECT string_agg(DISTINCT rail, ',') FROM public.order_payments WHERE order_id = v_o), '(無)'),
      CASE WHEN v_err IS NULL THEN '放行' ELSE '擋下' END;
  END LOOP;

  -- 🟢 正對照就在矩陣裡:CTZZ26(卡片)必須被擋 —— 它證明這把尺會動。
  --    而如果連它都放行 ⇒ 這一發的每一個「放行」都沒有判別力。
END $p$;
ROLLBACK;
SQL

cat <<'NOTE'

== 怎麼讀這張表 ==
  CTZZ23 放行 ← 本來就該:一毛都沒收到
  CTZZ24 放行 ← 🔴 缺陷本體:匯款【已實收 1000】而狀態仍 unpaid ⇒ 閘連帳本都沒問就放行
  CTZZ25 放行 ← A8a3 刻意放寬的那個(非卡已付款可取消)
  CTZZ26 擋下 ← 🟢 正對照:尺會動。卡片已付款照樣被擋
  CTZZ27 擋下 ← 🔴 前瞻性回歸:partiallyPaid 落在「不是 unpaid 也不是 paid」那一支

述詞(正式庫 prosrc 逐字, 步7):
  IF (payment_status <> 'unpaid'
       AND NOT (payment_status = 'paid' AND 有收款列 AND 沒有 card 收款列))
     OR 有非終態 attempt
  THEN 拒絕

🔴 它【只在 paid 那一支】去問帳本。unpaid 那一支完全不看。
🛑 ⇒ 所以形狀不是「閘問了錯的欄位」, 是【閘只在其中一支去問帳本】。
🔴 而 CTZZ24 與 CTZZ25 是【同一個財務事實】(匯款 1000 已收), 只差 payment_status 有沒有被翻
   ⇒ 而它們走的是兩條不同的分類路徑。
🛑 ⇒ 而 b4-NONCARDPAID1 一上線, 那些單會變成 paid 或 partiallyPaid
   ⇒ partiallyPaid 會被擋 ⇒ 【收了訂金的匯款單會變成不能取消】, 而今天它可以。
NOTE
