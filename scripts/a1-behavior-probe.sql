-- ============================================================
-- A1 行為探針 — order_item_quantity_summary 的七條 CHECK 與複合 FK
-- ============================================================
-- 對應 = docs/specs/2026-07-30-e10-a1-order-item-summary-columns-plan.md §6.3
-- 用法(只對拋棄式隔離庫):psql "$URL" -v ON_ERROR_STOP=1 -f scripts/a1-behavior-probe.sql
--
-- 🔴 判定紀律(A7 / A7-t 教訓,逐條寫下為什麼)
--  ① **負向案例一律同時斷言 SQLSTATE 與 CONSTRAINT_NAME**。
--     只斷言「有 RAISE」會把三種假通過全部收下:紅在別條 CHECK / 紅在既有約束 /
--     整數溢位(22003)在到達具名 CHECK 之前就炸掉。
--  ② **前提不足一律 fail-closed**(RAISE),不得 NOTICE 後 exit 0 —— 那是 fail-open 假綠。
--  ③ **正向案例存在的理由**:證明合法值不會被「多塞的、過度限制的」約束誤拒。
--     沒有正向案例,任何人偷加一條 `cancelled <= ordered` 都不會被發現。
--  ④ 本檔自建自清:自己插一列 quantity = 3 的合成 order_item,全程包在交易裡、結尾 ROLLBACK。
--     不依賴既有 seed 資料的 quantity 剛好夠大(q = 1 會讓 N4 同時撞兩條、第一失敗不確定)。
--
-- 🔴 本檔只能對隔離庫跑:它會 INSERT 一列合成 order_item(雖然結尾 ROLLBACK)。
--    環境閘在下方第一個 DO block,缺 marker 就拒跑。
-- ============================================================

BEGIN;

DO $$
DECLARE
  v_order uuid;
  v_item  uuid;
  v_item_max uuid;
  v_con   text;
  v_ok    integer := 0;
BEGIN
  -- ── 環境閘:只准對拋棄式隔離庫跑 ──
  IF to_regclass('public.pcm_a7_probe_allowed') IS NULL THEN
    RAISE EXCEPTION 'A1-PROBE-ENV:缺拋棄式標記 public.pcm_a7_probe_allowed;拒絕在非隔離庫執行';
  END IF;

  -- ── 前提:必須有 order 可掛(fail-closed,不略過)──
  SELECT id INTO v_order FROM public.orders ORDER BY created_at LIMIT 1;
  IF v_order IS NULL THEN
    RAISE EXCEPTION 'A1-PROBE-PRECONDITION:orders 零列,探針無法建立合成品項';
  END IF;

  -- 合成品項:quantity = 3(讓 N4 / N5 各自有唯一的第一失敗)
  INSERT INTO public.order_items
    (order_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
  VALUES
    (v_order, 'A1-PROBE-SKU',
     '{"title":"a1 probe","sku":"A1-PROBE-SKU","spec":{}}'::jsonb, 3, 100, 300)
  RETURNING id INTO v_item;

  -- ══ 負向:五條「可獨立觸發」的 CHECK ═══════════════════════════════════════
  -- 🔴 C1(oiqs_ordered_nonneg)與 C6(oiqs_cancelled_le_quantity)**不在此列** ——
  --    它們在數學上被其他條蘊含(C1 ⊂ C2+C5、C6 ⊂ C2+C7),物理上無法單獨觸發。
  --    plan §4.1 已明確放棄對它們的行為獨立性宣稱,改以結構層逐字比對把關。

  -- N1:instock = -1
  BEGIN
    INSERT INTO public.order_item_quantity_summary
      (order_item_id, quantity, ordered_quantity, instock_quantity, cancelled_quantity)
    VALUES (v_item, 3, 0, -1, 0);
    RAISE EXCEPTION 'A1-PROBE-FAIL:N1(instock=-1)應被拒,卻成功寫入';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
    IF v_con <> 'oiqs_instock_nonneg' THEN
      RAISE EXCEPTION 'A1-PROBE-WRONG-CONSTRAINT:N1 期望 oiqs_instock_nonneg,實為 %', v_con;
    END IF;
    v_ok := v_ok + 1;
  END;

  -- N2:cancelled = -1
  BEGIN
    INSERT INTO public.order_item_quantity_summary
      (order_item_id, quantity, ordered_quantity, instock_quantity, cancelled_quantity)
    VALUES (v_item, 3, 0, 0, -1);
    RAISE EXCEPTION 'A1-PROBE-FAIL:N2(cancelled=-1)應被拒,卻成功寫入';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
    IF v_con <> 'oiqs_cancelled_nonneg' THEN
      RAISE EXCEPTION 'A1-PROBE-WRONG-CONSTRAINT:N2 期望 oiqs_cancelled_nonneg,實為 %', v_con;
    END IF;
    v_ok := v_ok + 1;
  END;

  -- N3:ordered = quantity + 1
  BEGIN
    INSERT INTO public.order_item_quantity_summary
      (order_item_id, quantity, ordered_quantity, instock_quantity, cancelled_quantity)
    VALUES (v_item, 3, 4, 0, 0);
    RAISE EXCEPTION 'A1-PROBE-FAIL:N3(ordered=4 > quantity=3)應被拒,卻成功寫入';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
    IF v_con <> 'oiqs_ordered_le_quantity' THEN
      RAISE EXCEPTION 'A1-PROBE-WRONG-CONSTRAINT:N3 期望 oiqs_ordered_le_quantity,實為 %', v_con;
    END IF;
    v_ok := v_ok + 1;
  END;

  -- N4:到貨多於訂購(ordered=1, instock=2)—— 兩值各自 <= quantity,只違反 C5
  BEGIN
    INSERT INTO public.order_item_quantity_summary
      (order_item_id, quantity, ordered_quantity, instock_quantity, cancelled_quantity)
    VALUES (v_item, 3, 1, 2, 0);
    RAISE EXCEPTION 'A1-PROBE-FAIL:N4(instock=2 > ordered=1)應被拒,卻成功寫入';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
    IF v_con <> 'oiqs_instock_le_ordered' THEN
      RAISE EXCEPTION 'A1-PROBE-WRONG-CONSTRAINT:N4 期望 oiqs_instock_le_ordered,實為 %', v_con;
    END IF;
    v_ok := v_ok + 1;
  END;

  -- N5 🔴 本探針的核心:三個值**各自都合法**,只有相加違規。
  --     ordered=3<=3 / instock=2<=3 且 <=ordered / cancelled=2<=3
  --     ⇒ 若 C7 不存在或被別條遮蔽,這筆會寫進去。
  BEGIN
    INSERT INTO public.order_item_quantity_summary
      (order_item_id, quantity, ordered_quantity, instock_quantity, cancelled_quantity)
    VALUES (v_item, 3, 3, 2, 2);
    RAISE EXCEPTION 'A1-PROBE-FAIL:N5(instock=2 + cancelled=2 > quantity=3)應被拒,卻成功寫入';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
    IF v_con <> 'oiqs_instock_cancelled_le_quantity' THEN
      RAISE EXCEPTION 'A1-PROBE-WRONG-CONSTRAINT:N5 期望 oiqs_instock_cancelled_le_quantity,實為 %', v_con;
    END IF;
    v_ok := v_ok + 1;
  END;

  -- N6 🔴 溢位:證明 C7 的 ::bigint 不是裝飾品。
  --     `quantity` 在 order_items 只有 `> 0`、**沒有上限** ⇒ 三個值同時取 int 上限是合法輸入:
  --     ordered=max <= quantity=max ✓ / instock=max <= ordered ✓ / cancelled=max <= quantity ✓
  --     ⇒ 只有 C7 該擋。實測(2026-07-31 本機 PG17.10):
  --       有 cast → SQLSTATE 23514 命中 oiqs_instock_cancelled_le_quantity
  --       無 cast → SQLSTATE **22003 integer out of range**,根本到不了那條 CHECK
  --     ⇒ 若哪天有人把 cast 拿掉,本案例會因為 exception 型別不是 check_violation 而整支炸開。
  INSERT INTO public.order_items
    (order_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
  VALUES
    (v_order, 'A1-PROBE-SKU-MAX',
     '{"title":"a1 probe max","sku":"A1-PROBE-SKU-MAX","spec":{}}'::jsonb, 2147483647, 1, 2147483647)
  RETURNING id INTO v_item_max;

  BEGIN
    INSERT INTO public.order_item_quantity_summary
      (order_item_id, quantity, ordered_quantity, instock_quantity, cancelled_quantity)
    VALUES (v_item_max, 2147483647, 2147483647, 2147483647, 2147483647);
    RAISE EXCEPTION 'A1-PROBE-FAIL:N6(instock+cancelled 溢位)應被 C7 拒,卻成功寫入';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
    IF v_con <> 'oiqs_instock_cancelled_le_quantity' THEN
      RAISE EXCEPTION 'A1-PROBE-WRONG-CONSTRAINT:N6 期望 oiqs_instock_cancelled_le_quantity,實為 %', v_con;
    END IF;
    v_ok := v_ok + 1;
  END;

  -- ══ 負向:複合 FK ═══════════════════════════════════════════════════════════
  -- F1 🔴 證明去正規化的 quantity 真的被釘死:品項存在,但 quantity 報一個假的。
  BEGIN
    INSERT INTO public.order_item_quantity_summary
      (order_item_id, quantity, ordered_quantity, instock_quantity, cancelled_quantity)
    VALUES (v_item, 99, 0, 0, 0);
    RAISE EXCEPTION 'A1-PROBE-FAIL:F1(quantity=99 與 order_items 不符)應被 FK 拒,卻成功寫入';
  EXCEPTION WHEN foreign_key_violation THEN
    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
    IF v_con <> 'order_item_quantity_summary_item_fk' THEN
      RAISE EXCEPTION 'A1-PROBE-WRONG-CONSTRAINT:F1 期望 order_item_quantity_summary_item_fk,實為 %', v_con;
    END IF;
    v_ok := v_ok + 1;
  END;

  -- F2:不存在的品項
  BEGIN
    INSERT INTO public.order_item_quantity_summary
      (order_item_id, quantity, ordered_quantity, instock_quantity, cancelled_quantity)
    VALUES ('00000000-0000-0000-0000-000000000000'::uuid, 3, 0, 0, 0);
    RAISE EXCEPTION 'A1-PROBE-FAIL:F2(不存在的 order_item_id)應被 FK 拒,卻成功寫入';
  EXCEPTION WHEN foreign_key_violation THEN
    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
    IF v_con <> 'order_item_quantity_summary_item_fk' THEN
      RAISE EXCEPTION 'A1-PROBE-WRONG-CONSTRAINT:F2 期望 order_item_quantity_summary_item_fk,實為 %', v_con;
    END IF;
    v_ok := v_ok + 1;
  END;

  -- ══ 負向:主鍵(一個品項最多一列)═══════════════════════════════════════════
  -- 🔴 R2 must-fix:原本完全沒有這條 —— 把 PRIMARY KEY 拿掉,結構驗收與所有行為案例
  --    都不會轉紅,而「同一品項出現兩列互相矛盾的摘要」這件事當場變成可能。
  BEGIN
    INSERT INTO public.order_item_quantity_summary
      (order_item_id, quantity, ordered_quantity, instock_quantity, cancelled_quantity)
    VALUES (v_item, 3, 0, 0, 0);
    BEGIN
      INSERT INTO public.order_item_quantity_summary
        (order_item_id, quantity, ordered_quantity, instock_quantity, cancelled_quantity)
      VALUES (v_item, 3, 1, 0, 0);
      RAISE EXCEPTION 'A1-PROBE-FAIL:D1(同一品項第二列)應被主鍵拒,卻成功寫入';
    EXCEPTION WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
      IF v_con <> 'order_item_quantity_summary_pkey' THEN
        RAISE EXCEPTION 'A1-PROBE-WRONG-CONSTRAINT:D1 期望 order_item_quantity_summary_pkey,實為 %', v_con;
      END IF;
      v_ok := v_ok + 1;
    END;
    DELETE FROM public.order_item_quantity_summary WHERE order_item_id = v_item;
  END;

  -- ══ 正向邊界:合法值不得被誤拒 ═════════════════════════════════════════════
  -- 🔴 每條寫成獨立 block 並在成功後刪除(PK = order_item_id,不刪會撞主鍵、
  --    把「被過度限制拒絕」誤判成「主鍵衝突」)。

  -- P1:全 0
  BEGIN
    INSERT INTO public.order_item_quantity_summary
      (order_item_id, quantity, ordered_quantity, instock_quantity, cancelled_quantity)
    VALUES (v_item, 3, 0, 0, 0);
    DELETE FROM public.order_item_quantity_summary WHERE order_item_id = v_item;
    v_ok := v_ok + 1;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'A1-PROBE-OVER-RESTRICT:P1(全 0)被拒 — % / %', SQLSTATE, SQLERRM;
  END;

  -- P2:ordered = quantity(等號邊界)
  BEGIN
    INSERT INTO public.order_item_quantity_summary
      (order_item_id, quantity, ordered_quantity, instock_quantity, cancelled_quantity)
    VALUES (v_item, 3, 3, 0, 0);
    DELETE FROM public.order_item_quantity_summary WHERE order_item_id = v_item;
    v_ok := v_ok + 1;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'A1-PROBE-OVER-RESTRICT:P2(ordered=quantity)被拒 — % / %', SQLSTATE, SQLERRM;
  END;

  -- P3:全部訂到也全部到貨
  BEGIN
    INSERT INTO public.order_item_quantity_summary
      (order_item_id, quantity, ordered_quantity, instock_quantity, cancelled_quantity)
    VALUES (v_item, 3, 3, 3, 0);
    DELETE FROM public.order_item_quantity_summary WHERE order_item_id = v_item;
    v_ok := v_ok + 1;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'A1-PROBE-OVER-RESTRICT:P3(instock=ordered=quantity)被拒 — % / %', SQLSTATE, SQLERRM;
  END;

  -- P4 🔴 關鍵正向:**還沒跟上游下單就被客人全部取消**(cancelled > ordered)。
  --     master plan 明確允許此情形 ⇒ 任何人偷加 `cancelled <= ordered` 會在此轉紅。
  BEGIN
    INSERT INTO public.order_item_quantity_summary
      (order_item_id, quantity, ordered_quantity, instock_quantity, cancelled_quantity)
    VALUES (v_item, 3, 0, 0, 3);
    DELETE FROM public.order_item_quantity_summary WHERE order_item_id = v_item;
    v_ok := v_ok + 1;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'A1-PROBE-OVER-RESTRICT:P4(cancelled=3 > ordered=0)被拒 — % / %', SQLSTATE, SQLERRM;
  END;

  -- P5:instock + cancelled 恰等於 quantity(等號邊界,C7 的邊界)
  BEGIN
    INSERT INTO public.order_item_quantity_summary
      (order_item_id, quantity, ordered_quantity, instock_quantity, cancelled_quantity)
    VALUES (v_item, 3, 2, 2, 1);
    DELETE FROM public.order_item_quantity_summary WHERE order_item_id = v_item;
    v_ok := v_ok + 1;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'A1-PROBE-OVER-RESTRICT:P5(instock+cancelled=quantity)被拒 — % / %', SQLSTATE, SQLERRM;
  END;

  -- P6:訂滿、到貨 1、取消 2(混合合法態)
  BEGIN
    INSERT INTO public.order_item_quantity_summary
      (order_item_id, quantity, ordered_quantity, instock_quantity, cancelled_quantity)
    VALUES (v_item, 3, 3, 1, 2);
    DELETE FROM public.order_item_quantity_summary WHERE order_item_id = v_item;
    v_ok := v_ok + 1;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'A1-PROBE-OVER-RESTRICT:P6(ordered=3 instock=1 cancelled=2)被拒 — % / %', SQLSTATE, SQLERRM;
  END;

  -- ══ 收尾:案例數必須恰好 14,少一條都算探針自己壞掉 ═══════════════════════
  IF v_ok <> 15 THEN
    RAISE EXCEPTION 'A1-PROBE-COUNT:通過案例數 = %,期望 15(探針自身異常)', v_ok;
  END IF;

  RAISE NOTICE 'A1 行為探針 15/15 通過(負向 6 CHECK〔含溢位〕+ 2 FK + 1 主鍵 / 正向 6 邊界)';
END
$$;

ROLLBACK;

-- ── 零殘留複驗(獨立於上面那個交易)──
DO $$
DECLARE v_cnt integer;
BEGIN
  SELECT count(*) INTO v_cnt FROM public.order_item_quantity_summary;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'A1-PROBE-RESIDUE:摘要表應為 0 列,實查 %', v_cnt;
  END IF;
  SELECT count(*) INTO v_cnt FROM public.order_items WHERE variant_sku LIKE 'A1-PROBE-SKU%';
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'A1-PROBE-RESIDUE:合成品項未回滾,殘留 % 列', v_cnt;
  END IF;
  RAISE NOTICE 'A1 探針零殘留複驗通過';
END
$$;
