#!/usr/bin/env python3
"""片1 行為測試的突變產生器 —— 🛑 草稿的測試,不是 migration 的一部分。

🔴🔴 這支檔為什麼是【重建】的:
   2026-08-28 我做完 24 發突變、證明了那 34 格行為測試有判別力 ——
   **而那支 harness 我放在 `/tmp`,然後在收攤時自己 `rm` 掉了。**
   ⇒ 那一刻 repo 裡的狀態變成:34 格全綠, 而**沒有任何東西證明它們紅得起來**。
   📌 而我當天替【並發】那組突變寫過同一句話並照做了(收進 repo, 不留 /tmp)——
      **同一條規則, 我套在了其中一組上, 而另一組我沒有。今晚第五次。**

用法  python3 docs/specs/2026-08-25-saved-views-mutants.py [輸出目錄]
      每發產生一支改壞的 migration ⇒ 逐支餵給拋棄式 PG, 對照下表逐格檢查
🔴 而檢查的方式是【期望紅在哪一格】, 不是「有沒有紅」——
   2026-08-28 靠這一條抓到兩件:一發打錯支(改到 update 而宣稱打 delete)、
   一發紅在語法錯(我的突變寫壞了, 不是守門抓到)。
   **只記「紅了沒」, 那兩發都會被算成通過。**
"""
import io, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC  = os.path.join(HERE, '..', '..', 'supabase/migrations/20260828080000_m4b_b4views1_saved_order_views.sql')
OUT  = sys.argv[1] if len(sys.argv) > 1 else '/tmp'
FIX  = os.path.join(HERE, '..', '..',
                    'supabase/migrations/20260828090000_m4b_b4views1a_request_id_gate.sql')
base = io.open(SRC, encoding='utf-8').read()
basefix = io.open(FIX, encoding='utf-8').read()

# 🔴🔴 **突變要打在【現行定義所在的那支檔】上**(2026-08-28 實測 22 發被廢掉才發現):
#    片1a 用 `CREATE OR REPLACE` 重建了 create/update/delete 三支
#    ⇒ 打在片1(20260828080000)上的函式體突變, **會被片1a 蓋掉**
#    ⇒ 那 22 發全部安靜地變成 no-op, 而 runner 看到的是「apply 成功、測試全綠」
#    📌 **一支後來的 migration, 會讓所有針對前一支的突變同時失效 —— 而它們仍然「跑過了」。**
#    ✅ 規則:錨在片1a 裡找得到 ⇒ 打片1a;否則打片1。
#    🔴🔴 **而這條規則不是一次性的** —— 2026-08-28 折 codex F3 時, 片1a 多接管了 `list`,
#       ⇒ M8 / M13 兩發**當場變成恆綠**(它們還打在片1 那支已經被蓋掉的 list 上)。
#       📌 **每多一支被 CREATE OR REPLACE 接管的函式, 就有一批舊突變安靜地失效** ——
#          而它們不會消失、不會報錯, 它們會【全綠】, 與「這個修法很穩」長得一模一樣。
#       ⇒ 加任何一支 REPLACE 之後, 必須重跑突變並看「恆綠」那一欄, 不是只看總數。

CG = """IF NOT (COALESCE(v_before.staff_id = p_actor, false)
          OR (v_before.is_shared AND v_is_manager)) THEN
    RETURN 'NOT_FOUND';
  END IF;"""
# 🔴 這幾個字面在 2026-08-28 的 R2 修法後變了(加了 FOR SHARE / 換成 DO 區塊 / 換成回頭查)。
#    八個錨一起對不上, 而【產生器安靜地少產八支】—— 現在它會叫了(見檔尾 EXPECTED)。
GATE = """  SELECT s.is_manager INTO v_is_manager
    FROM public.staff s WHERE s.id = p_actor AND s.is_active
     FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '無權執行此操作';
  END IF;
"""
LOCK = """  SELECT * INTO v_before
    FROM public.admin_saved_order_views
   WHERE id = p_view_id
     FOR UPDATE;"""

def seg(s, a, b):
    i, j = s.index(a), s.index(b)
    return i, j, s[i:j]

def in_fn(a, b, old, new, n=1):
    """只在某一支函式的範圍內取代 —— 🔴 少了這個, replace 會打到【第一支】而不是你想的那支
       (2026-08-28 M9 第一版就是這樣打錯支的:update 與 delete 的閘字面一模一樣)。"""
    def f(s):
        i, j, sg = seg(s, a, b)
        assert sg.count(old) >= n, "區段內命中 %d 次" % sg.count(old)
        return s[:i] + sg.replace(old, new, n) + s[j:]
    return f

def sub(old, new, n=1):
    def f(s):
        assert s.count(old) >= n, "突變點找不到"
        return s.replace(old, new, n)
    return f

U = ("admin_update_saved_order_view(\n  p_actor", "-- ── 5d.")
# 🔴 D 的段尾原本寫 `-- ── 6.`, 而 **5e(list)夾在 delete 與 6 之間**
#    ⇒ `in_fn(*D, …)` 的段落其實**含 list** ⇒ 一發宣稱打 delete 的突變可能安靜地打到 list。
#    (今天沒出事只因為兩支沒有共同字面 —— 那是運氣, 不是段界。)
D = ("admin_delete_saved_order_view(\n  p_actor", "-- ── 5e.")
C = ("admin_create_saved_order_view(\n  p_actor", "-- ── 5c.")
L = ("admin_list_saved_order_views(p_actor", "-- ── 5b.")

def m5(s):
    """create 的身分閘真的搬到 INSERT 之後 ⇒ 碼錨 順序 要紅。"""
    i, j, sg = seg(s, *C)
    assert sg.count(GATE) == 1
    sg = sg.replace(GATE, "", 1)
    tail = "  END;\n\n  INSERT INTO public.admin_audit_log"
    assert sg.count(tail) == 1
    return s[:i] + sg.replace(tail, "  END;\n\n" + GATE + "\n  INSERT INTO public.admin_audit_log", 1) + s[j:]

SHARED_GATE = """  IF COALESCE(p_is_shared, false) AND NOT v_is_manager THEN
    RAISE EXCEPTION '無權執行此操作';
  END IF;
"""

def mh10(s):
    """create 的【共用檢視】閘搬到 INSERT 之後。
    🔴 這一發與 M5 的差別就是本組存在的理由:`碼錨 順序` 錨的是【身分閘】那句 WHERE,
       **不是這一句** ⇒ apply 照樣過 ⇒ 只有 T16(量 sequence 前後差)看得到它。
    """
    i, j, sg = seg(s, *C)
    assert sg.count(SHARED_GATE) == 1
    sg = sg.replace(SHARED_GATE, "", 1)
    tail = "  END;\n\n  INSERT INTO public.admin_audit_log"
    assert sg.count(tail) == 1
    return s[:i] + sg.replace(tail, "  END;\n\n" + SHARED_GATE + "\n  INSERT INTO public.admin_audit_log", 1) + s[j:]

MUT = [
 ("M1  create 共用閘拿掉",            sub("IF COALESCE(p_is_shared, false) AND NOT v_is_manager THEN", "IF false THEN"), "T2"),
 ("M2  create 身分閘不看 is_active",  in_fn(*C, "WHERE s.id = p_actor AND s.is_active\n     FOR SHARE;", "WHERE s.id = p_actor AND s.is_active IS NOT NULL\n     FOR SHARE;"), "T14b"),
 ("M13 list 身分閘不看 is_active",    sub("  PERFORM 1 FROM public.staff s WHERE s.id = p_actor AND s.is_active;",
                                          "  PERFORM 1 FROM public.staff s WHERE s.id = p_actor AND s.is_active IS NOT NULL;"), "T14"),
 ("M14 update 身分閘不看 is_active",  in_fn(*U, "WHERE s.id = p_actor AND s.is_active\n     FOR SHARE;", "WHERE s.id = p_actor AND s.is_active IS NOT NULL\n     FOR SHARE;"), "T20"),
 ("M15 delete 身分閘不看 is_active",  in_fn(*D, "WHERE s.id = p_actor AND s.is_active\n     FOR SHARE;", "WHERE s.id = p_actor AND s.is_active IS NOT NULL\n     FOR SHARE;"), "T21"),
 ("MN  拿掉 COALESCE(NULL 三值洞)",   in_fn(*U, "COALESCE(v_before.staff_id = p_actor, false)", "v_before.staff_id = p_actor"), "T7"),
 ("M7  update 內容閘恆真",            in_fn(*U, CG, "IF false THEN\n    RETURN 'NOT_FOUND';\n  END IF;"), "T6"),
 ("M9  delete 內容閘恆真",            in_fn(*D, CG, "IF false THEN\n    RETURN 'NOT_FOUND';\n  END IF;"), "T17"),
 ("M8  list 內容閘恆真(錨字面仍在)",  sub("WHERE (v.staff_id = p_actor OR v.is_shared)", "WHERE (v.staff_id = p_actor OR v.is_shared OR true)"), "T4"),
 ("M10 拿掉 touch trigger",           sub("CREATE TRIGGER admin_saved_order_views_set_updated_at\n  BEFORE UPDATE ON public.admin_saved_order_views\n  FOR EACH ROW EXECUTE FUNCTION public.admin_saved_order_views_touch_updated_at();", ""), "T9-②"),
 ("M10b trigger 改回 now()",          sub("NEW.updated_at := pg_catalog.clock_timestamp();", "NEW.updated_at := now();"), "T9-②"),
 ("M16 update 拿掉 NO_CHANGE",        sub("  THEN\n    RETURN 'NO_CHANGE';\n  END IF;", "  THEN\n    NULL;\n  END IF;"), "T10"),
 ("M17 overwrite 比較恆假",           sub("IF p_expected_updated_at IS NOT NULL\n     AND v_before.updated_at IS DISTINCT FROM p_expected_updated_at THEN", "IF false THEN"), "T9-②"),
 ("M18 create 的 idem 判定拿掉",      sub("""    IF p_idempotency_key IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.admin_saved_order_views
       WHERE idempotency_key = p_idempotency_key
    ) THEN
      RETURN 'DUPLICATE_REQUEST';
    END IF;\n""", ""), "T12b"),
 ("M11 拿掉 NAME_TAKEN",              in_fn(*C, """    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    IF v_constraint IN ('admin_saved_order_views_private_label_idx',
                        'admin_saved_order_views_shared_label_idx') THEN
      RETURN 'NAME_TAKEN';
    END IF;\n""", ""), "T13b"),
 ("M12 兩個部分唯一索引併成一個",     sub("CREATE UNIQUE INDEX admin_saved_order_views_private_label_idx\n  ON public.admin_saved_order_views (staff_id, pg_catalog.btrim(label))\n  WHERE staff_id IS NOT NULL;",
                                          "CREATE UNIQUE INDEX admin_saved_order_views_private_label_idx\n  ON public.admin_saved_order_views (pg_catalog.btrim(label));"), "T13d"),
 ("M20 is_shared 改成普通 boolean",   sub("is_shared     boolean     GENERATED ALWAYS AS (staff_id IS NULL) STORED,", "is_shared     boolean     NOT NULL DEFAULT false,"), "T4"),
 ("M5  create 身分閘搬到 INSERT 之後", m5, "碼錨 順序"),
 ("M21 update 拿掉 FOR UPDATE",       in_fn(*U, LOCK, LOCK.replace("\n     FOR UPDATE;", ";")), "碼錨 鎖列"),
 ("MA1 加一句 GRANT SELECT TO service_role", sub("GRANT EXECUTE ON FUNCTION public.admin_list_saved_order_views(text) TO service_role;",
                                          "GRANT SELECT ON TABLE public.admin_saved_order_views TO service_role;\nGRANT EXECUTE ON FUNCTION public.admin_list_saved_order_views(text) TO service_role;"), "7c"),
 ("MA2 拿掉 delete 的 SET search_path", sub("  p_request_id text\n)\nRETURNS text\nLANGUAGE plpgsql\nSECURITY DEFINER\nSET search_path = public, pg_temp",
                                          "  p_request_id text\n)\nRETURNS text\nLANGUAGE plpgsql\nSECURITY DEFINER"), "7a"),
 ("MA3 create 的 INSERT 拆成兩句",    sub("  RETURN 'CREATED';", "  IF false THEN INSERT INTO public.admin_saved_order_views (staff_id,label,query) VALUES (NULL,'x','y'); END IF;\n  RETURN 'CREATED';"), "唯一性"),
 ("MA4 給 anon CREATE ON SCHEMA public", sub("BEGIN;\n", "BEGIN;\nGRANT CREATE ON SCHEMA public TO anon;\n"), "7b"),
 ("M19 拿掉 update 的 GRANT EXECUTE", sub("GRANT EXECUTE ON FUNCTION public.admin_update_saved_order_view(text, bigint, text, text, text, timestamptz, text) TO service_role;\n", ""), "7e-2"),
 # ── codex 關卡2 那四條的突變(2026-08-28)——
 #    🔴 四條修法落地時, 測試格數【一格都沒動】(34 ⇒ 34)⇒ 那一刻它們是零覆蓋。
 #       📌 **一個修法可以是對的, 而沒有任何東西會在它被改回去時說話。**
 ("MF1 拿掉 sequence 的 REVOKE",
   sub("""  EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated, service_role', v_seq);""", "  NULL;"), "7c-3"),
 ("MF2 create 的重播判定改回比錯誤訊息字面",
   sub("""    IF p_idempotency_key IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.admin_saved_order_views
       WHERE idempotency_key = p_idempotency_key
    ) THEN
      RETURN 'DUPLICATE_REQUEST';
    END IF;""",
       """    IF SQLERRM LIKE '%admin_saved_order_views_idem_idx%' THEN
      RETURN 'DUPLICATE_REQUEST';
    END IF;"""), "T23b"),
 ("MF3 拿掉 update 的 NAME_TAKEN",
   in_fn(*U, """  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    IF v_constraint IN ('admin_saved_order_views_private_label_idx',
                        'admin_saved_order_views_shared_label_idx') THEN
      RETURN 'NAME_TAKEN';
    END IF;
    RAISE;   -- 其餘唯一違規 = 真故障, 不吞
  END;""", "  END;"), "T22b"),
 ("MF4 sequence 改回【寫死名字】",
   sub("""DO $seq$
DECLARE v_seq text;
BEGIN
  v_seq := pg_get_serial_sequence('public.admin_saved_order_views', 'id');
  IF v_seq IS NULL THEN
    RAISE EXCEPTION 'identity sequence 找不到 —— id 欄可能不是 identity;拒繼續';
  END IF;
  EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated, service_role', v_seq);
END;
$seq$;""",
       "REVOKE ALL ON SEQUENCE public.admin_saved_order_views_id_seq\n  FROM PUBLIC, anon, authenticated, service_role;"), "孤兒"),
 # 🔴 R3 指出的測試缺口:MF1 證的是「動態斷言抓得到未撤權」,
 #    而要複現舊版那個【安靜全綠】, 得把 REVOKE 與斷言【兩邊都】改回寫死名字。
 #    📌 **只改一半的突變, 打的是「兩者不一致」, 不是「兩者一起錯」。**
 #       而真正會出事的世界是後者 —— 兩邊一起指向孤兒, 誰都不會叫。
 ("MF5 REVOKE 與斷言【一起】改回寫死名字",
   lambda s: sub("""  EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated, service_role', v_seq);""",
                 """  EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated, service_role',
                 'public.admin_saved_order_views_id_seq');""")(
        sub("""  v_seq := pg_get_serial_sequence('public.admin_saved_order_views', 'id');
  IF v_seq IS NULL THEN
    RAISE EXCEPTION '斷言 7c-3:找不到 identity sequence(id 欄不是 identity?)';
  END IF;""",
            "  v_seq := 'public.admin_saved_order_views_id_seq';")(s)), "孤兒"),
 # ── codex 關卡2(2026-08-28)的四道修法, 各配一發能殺死它的突變 ──────────────
 #    🔴 **一道修法沒有配突變 = 它從來沒被量過** —— 三綠與 52 格全綠在
 #       「修法有效」與「修法被刪掉而剛好沒有測試碰到它」兩個世界印同一個字。
 ("MG1 稽核改回寫正規化後的值(F5 回退)",
   in_fn(*U, "v_code, p_request_id, 'admin'", "v_code, v_req, 'admin'"), "稽核原值"),
 ("MG2 update 拿掉 request_id 的 NULL 閘(F2 回退)",
   in_fn(*U, """  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'admin_update_saved_order_view: p_request_id 不可為 NULL(稽核 correlation 需要)';
  END IF;""", ""), "NULL閘"),
 ("MG3 delete 拿掉 request_id 的 NULL 閘(F2 回退)",
   in_fn(*D, """  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'admin_delete_saved_order_view: p_request_id 不可為 NULL(稽核 correlation 需要)';
  END IF;""", ""), "NULL閘"),
 ("MG4 list 把 FOR SHARE 加回去(F3 回退)",
   sub("""  PERFORM 1 FROM public.staff s WHERE s.id = p_actor AND s.is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION '無權執行此操作';
  END IF;""",
       """  PERFORM 1 FROM public.staff s WHERE s.id = p_actor AND s.is_active
     FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '無權執行此操作';
  END IF;"""), "list無鎖"),
 # 🔴🔴 **MG5 原本打偏了**(R5 must-fix, 2026-08-28)——
 #    ~~原寫法 `|| 'x'`~~ 是**附加一個字元** ⇒ `v_ws` 由 31 變 32
 #    ⇒ `char_length(v_ws) <> 31` **那半自己就會紅** ⇒ md5 那半永遠輪不到。
 #    ⇒ 📌 **codex nit-C 的整個修法(把長度換成雜湊)沒有任何突變殺得到它。**
 #       而這一發【紅了】, 所以它看起來是好的 ——
 #       **一發突變殺掉的是比它想殺的那半更早的那一格, 而畫面上只有一個紅。**
 #    ✅ 改成**等長換碼位**(U+180E ⇒ U+180F):長度仍是 31 / 7, 只有 md5 會不同
 #       ⇒ 那一半**第一次**被量到。判別句寫進 want:訊息裡要看得到 `v_ws 長 31`。
 ("MG5 字元集【等長】換掉一個碼位(nit-C 回退;長度不變, 只有 md5 抓得到)",
   in_fn(*C, "|| U&'\\1680' || U&'\\180E'", "|| U&'\\1680' || U&'\\180F'"), "字元集"),
 # ── F6 的偵測尺, 自己配兩發突變(主視窗 2026-08-28 裁決要求)────────────────
 #    🔴 一道斷言沒有一發突變製造它宣稱要擋的東西 ⇒ **它宣稱擋 X, 而沒有人看過它擋 X。**
 ("MG6 對 sequence 補回一個 anon 授權",
   sub("-- \u2500\u2500 6.", """GRANT USAGE ON SEQUENCE public.admin_saved_order_views_id_seq TO anon;

-- \u2500\u2500 6."""), "seqACL"),
 #    而第二發打的是【另一個世界】:ACL 整格沒被設定過(NULL)。
 #    📌 兩發都紅在 seqACL, 而它們證的是**兩件不同的事**:
 #       MG6 = 「有壞東西時會叫」· MG7 = 「這一格根本沒被設定過時也會叫」。
 ("MG7 讓 sequence 的 ACL 回到 NULL(從來沒被設定過)",
   sub("-- \u2500\u2500 6.", """DO $reset$
DECLARE s text;
BEGIN
  s := pg_get_serial_sequence('public.admin_saved_order_views', 'id');
  EXECUTE format('UPDATE pg_class SET relacl = NULL WHERE oid = %L::regclass', s);
END;
$reset$;

-- \u2500\u2500 6."""), "seqACL"),
 # ── MH 組:R3(Fable, 2026-08-28)MF1/MF2 ────────────────────────────────────
 #    🔴🔴 **apply 期的碼錨, 會在行為測試【開始之前】就殺掉突變。**
 #       verify-all 的 ① 段 apply 一紅就 `exit 2` ⇒ ③ 段的 52 格根本沒跑
 #       ⇒ T16 / T24a-b / T25-0,a-d / T26a-f 這 **13 格從來沒有在任何世界紅過**
 #         (那是 MH 組補上之前的數;補完之後這 13 格裡有 10 格紅過,
 #          **現存未紅的是 T25-0 與 T26c 兩格** —— R5 2026-08-28 重算)。
 #    📌 **一道裝在更前面的尺, 會讓後面那把尺永遠沒有機會表演 —— 而它每次都印綠。**
 #       而本檔自己寫著「沒殺過突變的測試不算裝上」⇒ 按這片自己的法, 那 13 格不算裝上。
 #    ⇒ 下面每一發都**保留錨的字面**(塞死分支 / 改值 / 只搬沒被錨到的那一句),
 #      讓 apply 綠, 逼行為格自己紅。
 #    ⚠️ 而 MF2 那半是另一件事:request_id 的閘突變原本**只打 update 與 delete**,
 #       **create 那支零突變** —— 而 T24a/T24b 宣稱守的正是 create 的閘。
 ("MH1  create 的 NULL 閘塞進死分支(錨字面留著)",
   in_fn(*C, "  IF p_request_id IS NULL THEN\n", "  IF false AND p_request_id IS NULL THEN\n"), "T24a"),
 ("MH2  create 的判空閘塞進死分支",
   in_fn(*C, "  IF v_req = '' THEN\n", "  IF false AND v_req = '' THEN\n"), "T24b"),
 ("MH3  update 的 NULL 閘塞進死分支",
   in_fn(*U, "  IF p_request_id IS NULL THEN\n", "  IF false AND p_request_id IS NULL THEN\n"), "T25a"),
 ("MH4  update 的判空閘塞進死分支",
   in_fn(*U, "  IF v_req = '' THEN\n", "  IF false AND v_req = '' THEN\n"), "T25b"),
 ("MH5  delete 的 NULL 閘塞進死分支",
   in_fn(*D, "  IF p_request_id IS NULL THEN\n", "  IF false AND p_request_id IS NULL THEN\n"), "T25c"),
 ("MH6  delete 的判空閘塞進死分支",
   in_fn(*D, "  IF v_req = '' THEN\n", "  IF false AND v_req = '' THEN\n"), "T25d"),
 # 🔴 稽核原值那三發:**不動字面, 改的是【值】** —— 碼錨要的是 `p_request_id, 'admin'`
 #    這串字還在;而在它前面補一句指派, 存進去的就變成被 btrim 過的那個。
 #    📌 **一道字面錨證明的是「這段字還在」, 不是「這件事還成立」** —— 這三發就是那句話的證明。
 ("MH7  create 稽核改存正規化後的值(字面不動)",
   in_fn(*C, "\n  INSERT INTO public.admin_audit_log\n",
             "\n  p_request_id := v_req;\n  INSERT INTO public.admin_audit_log\n"), "T26a"),
 ("MH8  update 稽核改存正規化後的值(字面不動)",
   in_fn(*U, "\n  INSERT INTO public.admin_audit_log\n",
             "\n  p_request_id := v_req;\n  INSERT INTO public.admin_audit_log\n"), "T26d"),
 ("MH9  delete 稽核改存正規化後的值(字面不動)",
   in_fn(*D, "\n  INSERT INTO public.admin_audit_log\n",
             "\n  p_request_id := v_req;\n  INSERT INTO public.admin_audit_log\n"), "T26f"),
 ("MH10 create 的共用閘搬到 INSERT 之後(碼錨 順序 錨不到它)", mh10, "T16"),
 # 🔴 R3 格3:verify-all ② 段那三格 end-state seqACL 檢查**在本 harness 裡紅不可達** ——
 #    任何 seqACL 腐化都先被片1a 的斷言 E 在 apply 時抓掉、rc=2 退場
 #    ⇒ 跑得到 ② 的世界裡它們必綠, 而 MG6/MG7 的紅**全記在斷言 E 頭上**。
 #    ⇒ 這一發把 GRANT 塞在 `COMMIT;` **之後**:斷言 E 已經跑完了, 只有那三格看得到。
 #    📌 **它們的存在理由是【時間射程】, 而在此之前沒有任何世界考過那個射程。**
 ("MH11 GRANT 塞在 COMMIT 之後(打斷言 E 的時間射程)",
   sub("\nCOMMIT;\n", """
COMMIT;

DO $post$
DECLARE s text;
BEGIN
  s := pg_get_serial_sequence('public.admin_saved_order_views', 'id');
  EXECUTE format('GRANT USAGE ON SEQUENCE %s TO anon', s);
END;
$post$;
"""), "end-state seqACL"),
 # ── MJ 組:R5(code-reviewer)2026-08-28 抓到的三個零突變面 ─────────────────
 #    共通形狀:**那一格有守門、有測試, 而沒有任何一發突變製造過它要擋的世界。**
 ("MJ1 delete 的內容閘拿掉 COALESCE(NULL 三值洞;MN 只打了 update)",
   in_fn(*D, "COALESCE(v_before.staff_id = p_actor, false)", "v_before.staff_id = p_actor"), "T18"),
 # 🔴 T15 那一格為什麼要另外造一發:唯一動 `is_shared` 的 M20 把它改成普通欄,
 #    **值就跟著錯** ⇒ T4 先紅(runner 自己登記 `^FAIL T4 `)⇒ T15 永遠輪不到。
 #    ⇒ 這一發把值補回來(trigger),讓前面每一格都仍然綠, **只有 T15 看得到差別**。
 #    📌 **要量一道守門, 得先讓其他每一道都閉嘴。**
 ("MJ2 is_shared 改普通欄【而值用 trigger 補回來】(前面全綠, 只有 T15 看得到)",
   lambda s: sub("CREATE TRIGGER admin_saved_order_views_set_updated_at",
                 """CREATE FUNCTION public.zzz_mut_shared() RETURNS trigger LANGUAGE plpgsql AS $z$
BEGIN NEW.is_shared := (NEW.staff_id IS NULL); RETURN NEW; END; $z$;
CREATE TRIGGER zzz_mut_shared_trg BEFORE INSERT OR UPDATE ON public.admin_saved_order_views
  FOR EACH ROW EXECUTE FUNCTION public.zzz_mut_shared();

CREATE TRIGGER admin_saved_order_views_set_updated_at""")(
        sub("is_shared     boolean     GENERATED ALWAYS AS (staff_id IS NULL) STORED,",
            "is_shared     boolean     NOT NULL DEFAULT false,")(s)), "T15"),
 ("MJ3 create 的名稱必填閘拿掉",
   in_fn(*C, """  IF v_label = '' THEN
    RAISE EXCEPTION 'admin_create_saved_order_view: 名稱必填';
  END IF;
""", ""), "T27a"),
 ("MJ4 update 的名稱必填閘拿掉",
   in_fn(*U, """  IF v_label = '' THEN
    RAISE EXCEPTION 'admin_update_saved_order_view: 名稱必填';
  END IF;
""", ""), "T27b"),
 ("負對照 完全不改",                  lambda s: s, "__期望全綠__"),
]

# 🔴 少一發要【叫】, 不要安靜地少產一支。
#    2026-08-28 實測:我改了幾個字面之後【八發】的錨對不上 ⇒ 產生器印了八個 ⚠️,
#    而 runner 只走「目錄裡有幾支」⇒ 它印「有問題 0」。
#    📌 **產生器說少了八發, 而跑的人說一切正常 —— 兩個都在同一次執行裡。**
#    ⇒ 判別句(線B 2026-08-28 給的):**「我餵幾條」與「它跑幾支」是兩個數,而總計行只印後者。**
missing = []
for name, fn, want in MUT:
    try:
        # 先試片1a(它是三支寫入 RPC 的現行定義);錨不在那裡才打片1
        try:
            out = fn(basefix); target, orig = 'fix', basefix
        except (AssertionError, ValueError):
            out = fn(base);    target, orig = 'base', base
    except AssertionError as e:
        print("%-40s ⚠️ 突變點找不到(%s)—— 這一發【沒有跑到】" % (name, e)); missing.append(name); continue
    if out == orig and want != "__期望全綠__":
        print("%-40s ⚠️ no-op —— 它會恆綠而看起來像跑過了" % name); missing.append(name); continue
    tag = name.split()[0].lower()
    path = os.path.join(OUT, "mut-%s.sql" % tag)
    io.open(path, 'w', encoding='utf-8').write(out)
    # 🔴 另外寫一支【沒被突變的】對手檔, runner 要兩支一起餵
    other = os.path.join(OUT, "oth-%s.sql" % tag)
    io.open(other, 'w', encoding='utf-8').write(base if target == 'fix' else basefix)
    io.open(os.path.join(OUT, "tgt-%s.txt" % tag), 'w').write(target)
    print("%-40s ⇒ %-24s 打在%-4s 期望紅在 %s" % (name, os.path.basename(path), target, want))

print("EXPECTED=%d" % len(MUT))
if missing:
    print("🔴 %d 發沒有產生出來(錨對不上或 no-op):%s" % (len(missing), ', '.join(missing)))
    sys.exit(1)
