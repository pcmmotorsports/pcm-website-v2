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
SRC  = os.path.join(HERE, '2026-08-25-saved-views-migration-draft.sql')
OUT  = sys.argv[1] if len(sys.argv) > 1 else '/tmp'
base = io.open(SRC, encoding='utf-8').read()

CG = """IF NOT (COALESCE(v_before.staff_id = p_actor, false)
          OR (v_before.is_shared AND v_is_manager)) THEN
    RETURN 'NOT_FOUND';
  END IF;"""
GATE = """  SELECT s.is_manager INTO v_is_manager
    FROM public.staff s WHERE s.id = p_actor AND s.is_active;
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
D = ("admin_delete_saved_order_view(\n  p_actor", "-- ── 6.")
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

MUT = [
 ("M1  create 共用閘拿掉",            sub("IF COALESCE(p_is_shared, false) AND NOT v_is_manager THEN", "IF false THEN"), "T2"),
 ("M2  create 身分閘不看 is_active",  in_fn(*C, "WHERE s.id = p_actor AND s.is_active;", "WHERE s.id = p_actor AND s.is_active IS NOT NULL;"), "T14b"),
 ("M13 list 身分閘不看 is_active",    sub("SELECT 1 FROM public.staff s WHERE s.id = p_actor AND s.is_active\n  ) THEN",
                                          "SELECT 1 FROM public.staff s WHERE s.id = p_actor AND s.is_active IS NOT NULL\n  ) THEN"), "T14"),
 ("M14 update 身分閘不看 is_active",  in_fn(*U, "WHERE s.id = p_actor AND s.is_active;", "WHERE s.id = p_actor AND s.is_active IS NOT NULL;"), "T20"),
 ("M15 delete 身分閘不看 is_active",  in_fn(*D, "WHERE s.id = p_actor AND s.is_active;", "WHERE s.id = p_actor AND s.is_active IS NOT NULL;"), "T21"),
 ("MN  拿掉 COALESCE(NULL 三值洞)",   in_fn(*U, "COALESCE(v_before.staff_id = p_actor, false)", "v_before.staff_id = p_actor"), "T7"),
 ("M7  update 內容閘恆真",            in_fn(*U, CG, "IF false THEN\n    RETURN 'NOT_FOUND';\n  END IF;"), "T6"),
 ("M9  delete 內容閘恆真",            in_fn(*D, CG, "IF false THEN\n    RETURN 'NOT_FOUND';\n  END IF;"), "T17"),
 ("M8  list 內容閘恆真(錨字面仍在)",  sub("WHERE v.staff_id = p_actor OR v.is_shared\n     ORDER BY", "WHERE v.staff_id = p_actor OR v.is_shared OR true\n     ORDER BY"), "T4"),
 ("M10 拿掉 touch trigger",           sub("CREATE TRIGGER admin_saved_order_views_set_updated_at\n  BEFORE UPDATE ON public.admin_saved_order_views\n  FOR EACH ROW EXECUTE FUNCTION public.admin_saved_order_views_touch_updated_at();", ""), "T9"),
 ("M10b trigger 改回 now()",          sub("NEW.updated_at := pg_catalog.clock_timestamp();", "NEW.updated_at := now();"), "T9"),
 ("M16 update 拿掉 NO_CHANGE",        sub("  THEN\n    RETURN 'NO_CHANGE';\n  END IF;", "  THEN\n    NULL;\n  END IF;"), "T10"),
 ("M17 overwrite 比較恆假",           sub("IF p_expected_updated_at IS NOT NULL\n     AND v_before.updated_at IS DISTINCT FROM p_expected_updated_at THEN", "IF false THEN"), "T9-②"),
 ("M18 create 的 idem 判定拿掉",      sub("    IF SQLERRM LIKE '%admin_saved_order_views_idem_idx%' THEN\n      RETURN 'DUPLICATE_REQUEST';\n    END IF;\n", ""), "T12b"),
 ("M11 拿掉 NAME_TAKEN",              sub("    IF SQLERRM LIKE '%admin_saved_order_views_private_label_idx%'\n       OR SQLERRM LIKE '%admin_saved_order_views_shared_label_idx%' THEN\n      RETURN 'NAME_TAKEN';\n    END IF;\n", ""), "T13b"),
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
 ("負對照 完全不改",                  lambda s: s, "__期望全綠__"),
]

for name, fn, want in MUT:
    try:
        out = fn(base)
    except AssertionError as e:
        print("%-40s ⚠️ 突變點找不到(%s)—— 這一發【沒有跑到】" % (name, e)); continue
    if out == base and want != "__期望全綠__":
        print("%-40s ⚠️ no-op —— 它會恆綠而看起來像跑過了" % name); continue
    tag = name.split()[0].lower()
    path = os.path.join(OUT, "mut-%s.sql" % tag)
    io.open(path, 'w', encoding='utf-8').write(out)
    print("%-40s ⇒ %-28s 期望紅在 %s" % (name, os.path.basename(path), want))
