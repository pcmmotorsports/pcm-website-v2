#!/usr/bin/env python3
"""`security_invoker = true` 的 view 呼叫了函式, 而那支函式的 EXECUTE 沒給查它的角色。

═══ 病例(-ship `15b9c1761`, 2026-09-05)══════════════════════════════════════
  `20260901070000:64-65` 把 `pcm_js_trim_whitespace()` 的 EXECUTE 從所有人收掉 ——
  **當時呼叫端全是 SECURITY DEFINER, 所以那是對的。**
  四天後 `20260905020000` 建了一支 `security_invoker = true` 的 view, body 裡呼叫它
  ⇒ 🔴 **invoker view 用【呼叫者】的權限跑裡面的函式** ⇒ service_role 查一次錯一次。
  🛑 而 **view 建得起來、靜態檢查全綠** —— 錯要等到有人【真的去查那支 view】才出現。
  📌 `20260901070000:69` 逐字寫著「將來有非 DEFINER 呼叫端要補 GRANT」—— **四天後就被踩。**
     ⇒ 一句寫對了的警告, 擋不住四天後另一支檔裡的人。**那句話需要一道閘, 不是需要更大的字。**

═══ 本閘做什麼 ═══════════════════════════════════════════════════════════════
  只看【staged 的新增 migration】。找 `security_invoker = true` 的 view,
  抽它 body 裡 `public.<fn>(` 的字面, 然後要求同一支檔裡有一條事後斷言
  用 `has_function_privilege(<角色>, '<fn>…', 'EXECUTE')` 檢查它 ——
  🔴 **要的是【事後斷言】不是 `GRANT`** ——
     `GRANT` 是「我寫的動作」, 斷言是「量到的結果」。GRANT 打錯簽名一樣是綠的。

用法:python3 scripts/invoker-view-execute-gate.py [--selftest] [檔…]
出口:0 過 / 1 有檔沒過 / 2 工具自壞
"""
import io
import os
import re
import subprocess
import sys

# 🔴 剝掉 SQL 行註解 —— 註解裡最會出現 `security_invoker` 與函式名(本病例的檔頭就有)。
def strip_comments(sql: str) -> str:
    return '\n'.join(re.sub(r'--.*$', '', ln) for ln in sql.split('\n'))


INVOKER_RE = re.compile(r'security_invoker\s*=\s*true', re.I)
FN_RE = re.compile(r'\bpublic\.([a-z_][a-z0-9_]*)\s*\(', re.I)
# 事後斷言:has_function_privilege( … '<fn>' … 'EXECUTE' )
ASSERT_RE = re.compile(r'has_function_privilege\s*\([^)]*', re.I)


def analyse(sql: str):
    """回 (invoker_view?, body 裡呼叫的函式, 已被事後斷言涵蓋的函式)。"""
    body = strip_comments(sql)
    if not INVOKER_RE.search(body):
        return False, set(), set()
    called = {m.group(1).lower() for m in FN_RE.finditer(body)}
    asserted = set()
    for m in ASSERT_RE.finditer(body):
        seg = m.group(0)
        if 'execute' not in seg.lower():
            # has_function_privilege(role, oid, 'EXECUTE') 可能跨行 ⇒ 往後多看 200 字
            seg = body[m.start():m.start() + 200]
        if 'execute' not in seg.lower():
            continue
        for f in FN_RE.finditer(seg):
            asserted.add(f.group(1).lower())
        for f in re.finditer(r"'([a-z_][a-z0-9_]*)\s*\(", seg, re.I):
            asserted.add(f.group(1).lower())
    return True, called, asserted


def check(path: str, sql: str) -> bool:
    is_inv, called, asserted = analyse(sql)
    if not is_inv:
        return True
    missing = sorted(called - asserted)
    if not missing:
        print(f'✅ {os.path.basename(path)}:invoker view 呼叫的 {len(called)} 支函式都有 EXECUTE 事後斷言')
        return True
    print(f'🔴 {os.path.basename(path)}:這是 `security_invoker = true` 的 view,')
    print( '   而它 body 裡呼叫的這幾支函式, 本檔【沒有一條事後斷言】檢查誰叫得動:')
    for f in missing:
        print(f'      ✗ public.{f}()')
    print( '   ⇒ invoker view 用【呼叫者】的權限跑裡面的函式。若那支函式的 EXECUTE 被收掉過,')
    print( '     view 建得起來、靜態全綠, 而【查它的人一次錯一次】。')
    print( '   ⇒ 補一條事後斷言(不是只補 GRANT —— GRANT 是我寫的動作, 斷言是量到的結果):')
    print(f"        IF NOT pg_catalog.has_function_privilege('service_role',")
    print(f"             'public.{missing[0]}()'::regprocedure, 'EXECUTE') THEN RAISE EXCEPTION …")
    return False


def staged_new_sql():
    try:
        out = subprocess.run(['git', 'diff', '--cached', '--name-only', '--diff-filter=A'],
                             capture_output=True, text=True, check=True).stdout
    except Exception:
        return []
    return [p for p in out.split('\n') if p.startswith('supabase/migrations/') and p.endswith('.sql')]


def selftest() -> int:
    ok = 0
    def ck(name, got, want):
        nonlocal ok
        if got == want:
            print(f'  PASS {name}')
        else:
            print(f'  🔴 FAIL {name}(得 {got}, 該 {want})'); ok = 1

    # ① 該綠:不是 invoker view ⇒ 不管
    ck('① 非 invoker view ⇒ 放行', check('a.sql', 'CREATE VIEW v AS SELECT public.f();'), True)
    # ② 該紅:invoker view 呼叫函式而沒有斷言
    ck('② invoker view + 呼叫 public.f() + 零斷言 ⇒ 擋',
       check('b.sql', "CREATE VIEW v WITH (security_invoker = true) AS SELECT public.f() FROM t;"), False)
    # ③ 該綠:有事後斷言
    ck('③ 同上 + has_function_privilege(…,\'EXECUTE\') 斷言 ⇒ 放行',
       check('c.sql', "CREATE VIEW v WITH (security_invoker = true) AS SELECT public.f() FROM t;\n"
                      "DO $$ BEGIN IF NOT has_function_privilege('service_role', 'public.f()'::regprocedure, 'EXECUTE') THEN RAISE EXCEPTION 'x'; END IF; END $$;"),
       True)
    # ④ 🔴 註解裡的 security_invoker 不算(剝註解那一步真的有在做事)
    ck('④ 只有【註解】提到 security_invoker ⇒ 不當成 invoker view',
       check('d.sql', "-- 這支不是 security_invoker = true 的 view\nCREATE VIEW v AS SELECT public.f();"), True)
    # ⑤ 🔴 註解裡的函式名不算
    ck('⑤ 函式名只出現在註解裡 ⇒ 不算被呼叫',
       check('e.sql', "CREATE VIEW v WITH (security_invoker = true) AS SELECT 1;\n-- 它以前呼叫 public.old_fn()"), True)

    # ⑥ 🔴🔴 真檔正對照:-ship 那支【剝掉 GRANT 與斷言】必須紅、原檔必須綠
    rel = 'supabase/migrations/20260905020000_m4b_e4_order_created_pending_view.sql'
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
    real = os.path.join(root, rel)
    src = None
    if os.path.exists(real):
        src = io.open(real, encoding='utf-8').read()
    else:
        # 🔴 它在【別的窗的分支】上(-ship, 還沒合過來)⇒ 從 git 取, 不要因此 SKIP。
        #    主視窗指定的就是這個正對照 ——「SKIP」等於它沒跑, 而那正是本閘最重要的一格。
        try:
            sha = subprocess.run(['git', '-C', root, 'log', '--all', '--format=%H', '-1', '--', rel],
                                 capture_output=True, text=True, check=True).stdout.strip()
            if sha:
                src = subprocess.run(['git', '-C', root, 'show', f'{sha}:{rel}'],
                                     capture_output=True, text=True, check=True).stdout
        except Exception:
            src = None
    if src:
        ck('⑥a 真檔(已補斷言)⇒ 放行', check(real, src), True)
        stripped = '\n'.join(l for l in src.split('\n')
                             if 'has_function_privilege' not in l and 'GRANT EXECUTE' not in l)
        if stripped == src:
            print('  🔴 FAIL ⑥b 突變沒套上(檔裡抓不到 has_function_privilege / GRANT EXECUTE)'); ok = 1
        else:
            ck('⑥b 真檔剝掉 EXECUTE 斷言 ⇒ 必須擋(病例的原始世界)', check('mutant', stripped), False)
    else:
        # 🔴 檔不在 ⇒ 明說「這一格【沒驗】」, 不靜靜跳過
        print('  🟡 SKIP ⑥ 真檔正對照:-ship 那支 20260905020000 不在本樹')
        print('       ⇒ 這【不是通過】, 是沒驗。它合併進來之後要重跑本 selftest。')

    print('全部通過。' if ok == 0 else '🔴 有格沒過。')
    return ok


def main(argv) -> int:
    if argv[:1] == ['--selftest']:
        return selftest()
    files = argv or staged_new_sql()
    if not files:
        print('  🔵 invoker-view 閘:本次沒有新增的 migration ⇒ 不適用(這不是「檢查過沒問題」)')
        return 0
    bad = 0
    for p in files:
        try:
            sql = io.open(p, encoding='utf-8').read()
        except OSError as e:
            print(f'🔴 讀不到 {p}:{e} ⇒ 工具自壞'); return 2
        if not check(p, sql):
            bad = 1
    # 🔴 「證不到什麼」印在【輸出】裡, 不寫在註解 —— 讀輸出的人才是要知道的那個人。
    print('🛑 本閘證不到的:')
    print('   · view body 裡若用 `<schema>.<fn>()` 以外的寫法(別名 `a.b()`、函式名放在字串/變數裡),')
    print('     字面尺【撈不到它】⇒ 那是已知缺口, 不是「掃過了」。')
    print('   · 它只驗「有沒有一條 EXECUTE 事後斷言」, **不驗那條斷言問對了角色** ——')
    print('     斷言問 anon 而查它的是 service_role, 本閘一樣放行。')
    print('   · 它只看 staged 的【新增】migration ⇒ 既有的 invoker view 一支都不在分母裡。')
    return bad


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
