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


# 🔴🔴 只取【那支 invoker view 自己的 body】—— 2026-09-05 誤擋修正。
#    ⛔ 第一版拿【整支檔】去找 `public.<fn>(` ⇒ 同一支 migration 裡別段的函式、
#       甚至 `INSERT INTO public.admin_audit_log (` 這種【表名後面接括號】的寫法,
#       全被算成「這支 view 呼叫的函式」。
#    🔬 實錘:`20260904220000` 那支 view 的 body 只呼叫 **1** 支函式,
#       而第一版報 **10** 支 —— 其中 `admin_audit_log` 根本不是函式, 是 INSERT 的目標表。
#    📌 ⇒ 一把尺太寬產出的不是漏報, 是**假指控** —— 而假指控會讓人去補一堆不需要的斷言,
#       或者(更常見)**直接把閘關掉**。
VIEW_START_RE = re.compile(
    r'CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+[^\s(]+\s*'      # CREATE VIEW <名>
    r'WITH\s*\([^)]*security_invoker\s*=\s*true[^)]*\)\s*'  # WITH (security_invoker = true)
    r'AS\b', re.I)


def _invoker_view_bodies(body: str):
    """回 body 裡每一支 invoker view 的定義段(從 AS 之後到該敘述的 `;`)。

    🔴 找結尾的 `;` 要跳過【括號內】與【字串常值內】的分號 ——
       否則一個 `WHERE x IN (…;…)` 或 `'a;b'` 會讓段落提早結束, 而**提早結束是漏報方向**。
    """
    out = []
    for m in VIEW_START_RE.finditer(body):
        i = m.end()
        depth, in_str, j = 0, False, i
        while j < len(body):
            ch = body[j]
            if in_str:
                if ch == "'":
                    in_str = False
            elif ch == "'":
                in_str = True
            elif ch == '(':
                depth += 1
            elif ch == ')':
                depth -= 1
            elif ch == ';' and depth <= 0:
                break
            j += 1
        out.append(body[i:j])
    return out


def analyse(sql: str):
    """回 (invoker_view?, view body 裡呼叫的函式, 已被事後斷言涵蓋的函式)。"""
    body = strip_comments(sql)
    if not INVOKER_RE.search(body):
        return False, set(), set()
    bodies = _invoker_view_bodies(body)
    if not bodies:
        # 🛑 檔裡有 `security_invoker = true` 這串字, 而抽不出任何 view 定義段
        #    ⇒ **不是放行**:那代表我的 regex 沒認得那種寫法, 而那正是要有人看一眼的時候。
        #    (放行=安靜地失效;報出來=有人會來修這把尺。)
        print('🔴 檔裡有 `security_invoker = true` 而抽不出 view 定義段 ⇒ 本閘的抽取式沒認得這種寫法。')
        return True, {'<抽取失敗:請看這支檔的 CREATE VIEW 寫法>'}, set()
    called = set()
    for b in bodies:
        called |= {m.group(1).lower() for m in FN_RE.finditer(b)}
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


LEDGER = 'supabase/APPLIED.tsv'


def applied_versions():
    """回帳本上記著「已 apply 到正式庫」的版本號集合。

    🔴🔴 **只用它的【命中】, 絕不用它的【0】** —— `APPLIED.tsv` 檔頭逐字寫著
       「不在本表上**什麼都不代表**」(它自己就列著兩支已 apply 而不在表上的)。
       ⇒ 命中 ⇒ 那支是歷史, 跳過(它已經在正式庫上了, 擋它沒有任何人能行動)。
       ⇒ 沒命中 ⇒ **照常檢查**。這個方向讓帳本過期時本閘偏【嚴】不偏【鬆】。
    🛑 而這道跳過**不是**本次誤擋的解藥 —— 解藥是上面那個抽取範圍。
       實測 2026-09-05:-ship 那六支在帳本上**一支都沒有**(帳本更新還沒推),
       ⇒ 若只做這一半, 六支照樣被擋。
    """
    out = set()
    try:
        for ln in io.open(LEDGER, encoding='utf-8'):
            if ln.startswith('#') or not ln.strip():
                continue
            v = ln.split('\t', 1)[0].strip()
            if v:
                out.add(v)
    except OSError:
        pass
    return out


def version_of(path: str) -> str:
    base = os.path.basename(path)
    m = re.match(r'(\d{8,})_', base)
    return m.group(1) if m else ''


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


    # ═══ ⑦ 抽取範圍(2026-09-05 誤擋的那一格)═══════════════════════════
    #    🔴 這一格證明「同檔別段的東西不會被算進 view 的帳」。
    #       突變方向刻意選【把別段搬進 view body】—— 那樣它【必須】被算到。
    same_file = (
        "CREATE FUNCTION public.helper_a() RETURNS int AS $$ SELECT 1 $$ LANGUAGE sql;\n"
        "INSERT INTO public.admin_audit_log (actor, note) VALUES ('x','y');\n"
        "CREATE VIEW public.v WITH (security_invoker = true) AS\n"
        "  SELECT public.in_body_fn(t.c) FROM public.t;\n"
        "SELECT public.after_the_view_fn();\n")
    _, called, _ = analyse(same_file)
    ck('⑦a view 段外的函式/表名不得入帳(只該有 in_body_fn)', called == {'in_body_fn'}, True)
    moved = same_file.replace("SELECT public.in_body_fn(t.c) FROM public.t;",
                              "SELECT public.in_body_fn(t.c), public.helper_a() FROM public.t;")
    _, called2, _ = analyse(moved)
    ck('⑦b 把別段那支【搬進 view body】⇒ 必須被算到(突變要殺得死)', 'helper_a' in called2, True)

    # ═══ ⑧ 抽不出 view 段要【出聲】, 不得靜靜放行 ═══════════════════════
    weird = "CREATE VIEW public.v /* security_invoker = true 寫在別處 */ AS SELECT 1;\n" \
            "-- security_invoker = true\n"
    ck('⑧ 有 invoker 字面而抽不出 view 段 ⇒ 擋(不是放行)', check('weird.sql', weird), False)

    # ═══ ⑨ 帳本跳過:只認命中, 不認 0 ═══════════════════════════════════
    ck('⑨a 版本號解析', version_of('supabase/migrations/20260904220000_x.sql') == '20260904220000', True)
    ck('⑨b 沒有版本號前綴 ⇒ 空字串(不會誤中帳本)', version_of('a/b/notaversion.sql') == '', True)

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
    ledger = applied_versions()
    for p in files:
        v = version_of(p)
        if v and v in ledger:
            print(f'  🔵 {os.path.basename(p)}:已 apply, 歷史(帳本 {LEDGER} 有這一列)⇒ 跳過')
            print( '     🛑 那不是「它沒問題」—— 是【擋它沒有任何人能行動】, 它已經在正式庫上了。')
            continue
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
