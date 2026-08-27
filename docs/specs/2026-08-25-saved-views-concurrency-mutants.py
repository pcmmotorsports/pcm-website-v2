#!/usr/bin/env python3
"""片1 並發測試的突變產生器 —— 🛑 草稿的測試,不是 migration 的一部分。

🔴 為什麼它要進 repo 而不是留在暫存檔:
   2026-08-28 這四發突變是【證明那五個並發世界有判別力】的唯一依據。
   一個沒有突變殺過的世界, 與一個真的在守著的世界, **都印一個 ok**。
   ⇒ 突變留在 /tmp ⇒ 下一個人只看得到 5 個 ok, 看不到它們憑什麼算數。

用法  python3 docs/specs/2026-08-25-saved-views-concurrency-mutants.py [輸出目錄]
      然後逐支餵給 2026-08-25-saved-views-concurrency-test.sh, 對照下表:

  NC1  update 的 FOR UPDATE 加 SKIP LOCKED(字面在、錨全綠、而它不擋)  ⇒ W1 必須紅
  NC2  update 的判斷整段用無鎖預讀, 鎖挪到 UPDATE 正上方                ⇒ W2 必須紅
  NC3  delete 的 FOR UPDATE 加 SKIP LOCKED                             ⇒ W4 必須紅
  NC4  delete 的判斷整段用無鎖預讀, 鎖挪到 DELETE 正上方                ⇒ W5 必須紅
  而每一發的 W3(負對照)都必須維持綠 —— 否則那是 harness 壞了, 不是抓到東西。

🔴 NC2 / NC4 是這四發裡最重要的:它們**通過全部 22 道碼錨、全部斷言、全部 34 格單一 session 測試**
   (2026-08-28 實跑 NC2: apply rc=0 · 測試 rc=0 · ok 34 格)
   ⇒ 📌 **碼錨看得到「FOR UPDATE 在寫入之前」, 看不到「判斷在鎖外面」。**
"""
import io, os, sys

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                   '2026-08-25-saved-views-migration-draft.sql')
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp'
LOCK = """  SELECT * INTO v_before
    FROM public.admin_saved_order_views
   WHERE id = p_view_id
     FOR UPDATE;"""

def seg_of(s, start, end):
    i, j = s.index(start), s.index(end)
    return i, j, s[i:j]

def skip_locked(s, start, end):
    i, j, seg = seg_of(s, start, end)
    assert seg.count(LOCK) == 1, "鎖列區段命中 %d 次" % seg.count(LOCK)
    return s[:i] + seg.replace(LOCK, LOCK.replace("     FOR UPDATE;",
                                                  "     FOR UPDATE SKIP LOCKED;"), 1) + s[j:]

def unlocked_read(s, start, end, write_stmt):
    i, j, seg = seg_of(s, start, end)
    assert seg.count(LOCK) == 1 and seg.count(write_stmt) == 1
    seg = seg.replace(LOCK, "  -- 突變:無鎖預讀 ⇒ 底下整段判斷用的都是還沒鎖的那一份\n"
                            "  SELECT * INTO v_before\n"
                            "    FROM public.admin_saved_order_views\n"
                            "   WHERE id = p_view_id;", 1)
    seg = seg.replace(write_stmt,
                      "  PERFORM 1 FROM public.admin_saved_order_views WHERE id = p_view_id\n"
                      "     FOR UPDATE;\n" + write_stmt, 1)
    return s[:i] + seg + s[j:]

U = ("admin_update_saved_order_view(\n  p_actor", "-- ── 5d.")
D = ("admin_delete_saved_order_view(\n  p_actor", "-- ── 6.")
UW = "  UPDATE public.admin_saved_order_views\n     SET label       = v_label,"
DW = "  DELETE FROM public.admin_saved_order_views\n   WHERE id = p_view_id;"

base = io.open(SRC, encoding='utf-8').read()
plan = [("NC1", lambda s: skip_locked(s, *U),          "W1"),
        ("NC2", lambda s: unlocked_read(s, *U, UW),    "W2"),
        ("NC3", lambda s: skip_locked(s, *D),          "W4"),
        ("NC4", lambda s: unlocked_read(s, *D, DW),    "W5")]
for name, fn, want in plan:
    out = fn(base)
    assert out != base, "%s 是 no-op —— 那會恆綠而看起來像跑過了" % name
    path = os.path.join(OUT, "%s.sql" % name.lower())
    io.open(path, 'w', encoding='utf-8').write(out)
    print("%s ⇒ %s   期望紅在 %s" % (name, path, want))
