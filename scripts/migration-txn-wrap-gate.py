#!/usr/bin/env python3
"""新 migration 有兩個以上頂層陳述式而沒包在 `BEGIN;`…`COMMIT;` 裡 ⇒ 紅(只擋 staged 新檔)。

══ 🔴 為什麼(2026-09-04 一晚兩次)══════════════════════════════════════════════

沒包交易時, 一支 migration 跑到一半失敗 ⇒ **前面那幾句留在庫裡**。
```
線 -ship 190000  codex R1 第一條逐字:「migration 沒包 BEGIN/COMMIT
                (DROP 後失敗留下無 CHECK 空窗)」
線 -mail 230000  驗證 agent 的突變撞出「斷言紅了, 而【壞版本留在庫裡】」
```
🎯 **⇒ 兩次都是同一個形狀:那支 migration 自己的斷言【叫了】, 而它叫的時候東西已經寫進去了。**
📌 **一道「會叫」的斷言, 在沒有交易包著的時候, 擋不住它自己前面那幾句。**

══ 🔴 為什麼【只擋 staged 新檔】════════════════════════════════════════════════

實測全樹(2026-09-04):**成對 173 · 單一陳述式(不適用)13 · 🔴 不成對 109**。
最早的是 `20260505130758_init_brands_categories.sql`(13 個陳述式、零 `BEGIN`)。
🛑 而那 109 支**今天已經沒有意義** —— 它們早就 apply 完了, 而「apply 到一半失敗」
   是**貼的當下**才存在的風險。改檔**不會改變正式庫**, 只會動帳本雜湊。
⇒ 擋的是**下一支**, 不是歷史。歷史那 109 支另有板列(`parked`, 等有人要重跑其中一支)。

══ 判準 ═════════════════════════════════════════════════════════════════════
  ① 先剝【行註解】與【dollar-quote 區塊】—— 後者裡面的 `;` 與 `BEGIN`/`END`
     是 plpgsql 的, **不是頂層陳述式**。不剝的話, 每一支帶 DO 區塊的檔都會被誤判。
  ② 剝完之後頂層 `;` 分出來的非空段落 < 2 ⇒ **不適用**(單一陳述式本來就是原子的)。
  ③ 要同時有行首的 `BEGIN;`(或 `BEGIN` 獨佔一行)與行首的 `COMMIT;` ⇒ 綠。

══ 天花板 ═══════════════════════════════════════════════════════════════════
  ① 它只看**有沒有包**, 不看**包得對不對** —— 中途 `COMMIT;` 再 `BEGIN;` 它看不出來
     (那一格由 `migration-static-checks.sh` 規則②守著)。
  ② 只擋 staged 的新增/改名檔 ⇒ 改一支既有 migration 不會被擋。
  ③ `CREATE INDEX CONCURRENTLY` 之類**不能在交易裡跑**的語句, 本閘會誤擋 ——
     今天全 repo 零命中(`grep -c CONCURRENTLY` ⇒ 0), 而**真的要用時它會叫**,
     那時的修法是**在那支檔加一行具名豁免**, 不是把這道閘拿掉。
"""

import os
import re
import subprocess
import sys

MIG_DIR = 'supabase/migrations'
EXEMPT = re.compile(r'--\s*txn-wrap-gate:exempt\s+(.+)$', re.M)


def strip_noise(sql):
    """剝行註解 + dollar-quote 區塊。**這一步是承重的, 不是整潔。**"""
    s = '\n'.join(re.sub(r'--.*$', '', line) for line in sql.split('\n'))
    return re.sub(r'\$([A-Za-z_]*)\$.*?\$\1\$', ' ', s, flags=re.S)


def verdict(sql):
    """回 (是否違規, 頂層陳述式數, 有沒有 BEGIN, 有沒有 COMMIT)。"""
    if EXEMPT.search(sql):
        return (False, -1, True, True)   # 具名豁免:理由寫在那一行裡
    t = strip_noise(sql)
    stmts = [x for x in t.split(';') if x.strip()]
    has_b = bool(re.search(r'^\s*BEGIN\s*(;|$)', t, re.M | re.I))
    has_c = bool(re.search(r'^\s*COMMIT\s*;', t, re.M | re.I))
    if len(stmts) < 2:
        return (False, len(stmts), has_b, has_c)
    return (not (has_b and has_c), len(stmts), has_b, has_c)


def staged(env=None):
    r = subprocess.run(['git', 'diff', '--cached', '--name-only', '--diff-filter=ACR'],
                       capture_output=True, text=True, env=env)
    if r.returncode != 0:
        print(f'🔴 量具失效:git diff --cached 回 rc={r.returncode} ⇒ 這【不是】「沒有違規」')
        sys.exit(2)
    return [l for l in r.stdout.split('\n')
            if l.startswith(MIG_DIR + '/') and l.endswith('.sql')]


def main(argv):
    root = subprocess.run(['git', 'rev-parse', '--show-toplevel'],
                          capture_output=True, text=True).stdout.strip() or '.'
    if '--audit' in argv:
        import glob
        files = sorted(glob.glob(os.path.join(root, MIG_DIR, '*.sql')))
    else:
        files = [os.path.join(root, f) for f in staged()]
    hits = []
    for f in files:
        try:
            bad, n, b, c = verdict(open(f, encoding='utf-8').read())
        except OSError:
            continue
        if bad:
            hits.append((os.path.basename(f), n, b, c))
    if not hits:
        print(f'  ✅ migration 交易包裹:本次 {len(files)} 支 .sql 都包好了'
              f'(⚠️ 只看有沒有包, 不看包得對不對 —— 那一格是 static-checks 規則②)')
        return 0
    print(f'🔴 有 {len(hits)} 支 migration 沒有包在 BEGIN;…COMMIT; 裡')
    for name, n, b, c in hits:
        print(f'   {name}  頂層陳述式 {n}  BEGIN={b} COMMIT={c}')
    print('   ── 為什麼:跑到一半失敗 ⇒ 前面那幾句【留在庫裡】')
    print('      2026-09-04 一晚兩次:190000(DROP 後失敗留下無 CHECK 空窗)')
    print('      · 230000(斷言紅了, 而壞版本已經寫進去)')
    print('      📌 一道會叫的斷言, 在沒有交易包著時, 擋不住它自己前面那幾句。')
    print('   ── 修法:檔頭 BEGIN;  檔尾 COMMIT;(而 COMMIT 之後不得有真 SQL)')
    print('   ── 真的不能包(例:CREATE INDEX CONCURRENTLY)⇒ 在該檔加一行:')
    print('      -- txn-wrap-gate:exempt <理由>')
    return 1


def selftest():
    ok = True

    def chk(name, sql, want_bad):
        nonlocal ok
        bad = verdict(sql)[0]
        good = bad == want_bad
        print(('  ✅ ' if good else '  🔴 ') + f'{name}  期望{"紅" if want_bad else "綠"} 實得{"紅" if bad else "綠"}')
        if not good:
            ok = False

    chk('①該紅 · 兩句而沒包', 'CREATE TABLE a(i int);\nCREATE TABLE b(i int);\n', True)
    chk('②該綠 · 兩句而包好了',
        'BEGIN;\nCREATE TABLE a(i int);\nCREATE TABLE b(i int);\nCOMMIT;\n', False)
    chk('③該綠 · 只有一句 ⇒ 不適用(本來就原子)', 'CREATE TABLE a(i int);\n', False)
    chk('④該紅 · 有 BEGIN 而沒有 COMMIT(跑完不會 commit ⇒ 更糟)',
        'BEGIN;\nCREATE TABLE a(i int);\nCREATE TABLE b(i int);\n', True)
    # 🔴🔴 ⑤⑦ 是本閘兩條「剝」的規格的證人。
    #    ⛔ **我第一版那兩格是【假證人】** —— 它們在剝與不剝之下判準【都不會翻面】,
    #       所以兩發突變(不剝 dollar-quote / 不剝行註解)**一發都沒殺掉**。
    #    ✅ 真的會翻面的形狀是:**剝掉之後陳述式數從 ≥2 掉到 1**(⇒ 從「適用」變「不適用」)。
    chk('⑤該綠 · 【單一】DO 區塊, 而它裡面有好幾個分號 —— 不剝的話會被數成多句而誤紅',
        "DO $g$ BEGIN IF true THEN RAISE NOTICE 'x'; RAISE NOTICE 'y'; END IF; END $g$;\n",
        False),
    chk('⑥該紅 · ⑤ 的負對照:真的有兩句(一句 DDL + 一個 DO)而沒包 ⇒ 剝完仍是兩句',
        "CREATE TABLE a(i int);\n"
        "DO $g$ BEGIN RAISE NOTICE 'x'; END $g$;\n", True)
    # 🔴 我第一版把這一格的標題寫成「該綠」而期望值是紅 —— 而它【照樣印 ✅】,
    #    因為判準看的是 `want_bad`, 不是標題。⇒ 標題與判準是兩個東西, 而只有判準會叫。
    chk('⑦該綠 · 【一句】而註解裡有分號 —— 不剝行註解的話會被數成兩句而誤紅',
        'CREATE TABLE a(i int);\n-- 這句註解裡有個分號 ; 它不是一個陳述式\n', False)
    chk('⑧該紅 · ⑦ 的負對照:註解裡有 BEGIN;/COMMIT; 而【本體沒有】⇒ 照樣紅',
        '-- BEGIN;\nCREATE TABLE a(i int);\nCREATE TABLE b(i int);\n-- COMMIT;\n', True)
    chk('⑨該綠 · 具名豁免 ⇒ 放行(理由寫在那一行裡)',
        '-- txn-wrap-gate:exempt CREATE INDEX CONCURRENTLY 不能在交易裡跑\n'
        'CREATE INDEX CONCURRENTLY i ON a(i);\nANALYZE a;\n', False)

    print('全部通過。' if ok else '🔴 有格沒過。')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(selftest() if '--selftest' in sys.argv else main(sys.argv[1:]))
