#!/usr/bin/env python3
"""`SECURITY DEFINER` 而 `search_path` 不是空字串 ⇒ 紅(只擋本次 staged 的新 migration)。

══ 🔴 為什麼(2026-09-04)══════════════════════════════════════════════════════

`SET search_path = public, pg_catalog` 把**可寫的 schema** 排在 `pg_catalog` 前面
(顯式列出之後 `pg_catalog` 不再隱式優先), 而本 repo **零處** `REVOKE CREATE ON SCHEMA public`
⇒ 任何人在 `public` 建一支同名函式, 就能讓 DEFINER 用 owner 的身分去跑它
⇒ 📌 **那是 SECURITY DEFINER 提權的標準路徑。**

而**這不是假設**:`20260904200000:399-403` 的 codex must-fix 逐字判過同一個形狀 ——
「有人改成 `SET search_path = public` 或任何可寫的 schema, 這道閘照樣綠」。
🛑 而**線 `-db` 自己在 2026-09-04 就寫了一支犯這個錯的 migration**, 是 code-reviewer 抓到的
⇒ 一個「已經被判過的形狀」在同一天又被寫出來一次 ⇒ **那不是紀律問題。**

══ 🔴 為什麼【只擋 staged 的新檔】而不是全樹 ══════════════════════════════════

主視窗原本要「全樹 0 紅才掛」。**實測全樹 67 支不符**(2026-09-04):
```
public, pg_temp        62      'public', 'pg_temp'   2
(完全沒有 SET)          3      'pg_catalog'          1
pg_catalog, public      1      pg_catalog, pg_temp   1
合格(search_path='')  155
```
🛑 **而那 67 支是【已經 apply 的不可變歷史】** —— 改它們不會改變正式庫, 只會讓 diff 說謊。
⇒ ✅ 所以擋的是**下一個人**, 不是歷史。歷史那 67 支另有板列記著。

══ 🔴 規格裡承重的一條:【先剝行註解再比對】═══════════════════════════════════

量那 67 支的第一發, 我量到 **72** —— 而多的 5 支裡包含**我自己那支已經改好的檔**。
成因:那支檔的 `⛔ 舊字面` 註解裡逐字寫著 `SET search_path = public, pg_catalog`
⇒ **regex 抓到了註解裡那一行。**
📌 **⇒ 而它只會往【誤報】那一側錯**(真的 `SET` 不可能寫在 `--` 後面)
   ⇒ 而誤報那一側今天就命中了 5 支 ⇒ **不剝註解的話, 這道閘裝上去當天就會冤枉人。**

══ 天花板 ═══════════════════════════════════════════════════════════════════
  ① 只看 `.sql` 檔面, 不連 DB —— 有人在 dashboard 手改函式定義, 它一句話都不會說。
  ② 只擋 staged 的**新增/改名**檔(`--diff-filter=ACR`)⇒ 改一支既有 migration 不會被擋。
  ③ 它認的是 `SET search_path` 這個字面在 `AS $...$` 之前 —— 寫在 body 裡的 `SET` 不算
     (那本來就不是函式屬性), 而**把整段 header 寫成一行**它照樣讀得到。
"""

import os
import re
import subprocess
import sys

MIG_DIR = 'supabase/migrations'
CREATE_FN = re.compile(r'CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([\w."]+)\s*\(', re.I)
DEFINER = re.compile(r'SECURITY\s+DEFINER', re.I)
SEARCH_PATH = re.compile(r'SET\s+search_path\s*(?:=|TO)\s*([^\n]*)', re.I)
OK_VALUES = ("''", '""')


def strip_line_comments(sql):
    """🔴 先剝行註解 —— 見檔頭那一節。**這一步是承重的, 不是整潔。**

    ⚠️ 它只剝 `--` 行註解, **不剝 `/* */` 區塊註解**(本 repo 的 migration 零處用它;
       用了的話這道閘會誤報, 而誤報那一側會被人看見)。
    """
    return '\n'.join(re.sub(r'--.*$', '', line) for line in sql.split('\n'))


def offenders(sql, name):
    """回 [(函式名, 那個值)], 只含不合格的。"""
    t = strip_line_comments(sql)
    out = []
    for m in CREATE_FN.finditer(t):
        seg = t[m.start():m.start() + 6000]
        head = seg.split('AS $')[0] if 'AS $' in seg else seg[:2000]
        if not DEFINER.search(head):
            continue
        sp = SEARCH_PATH.search(head)
        if sp is None:
            out.append((m.group(1), '(完全沒有 SET search_path)'))
            continue
        v = sp.group(1).strip().rstrip(';').strip()
        if v not in OK_VALUES:
            out.append((m.group(1), v[:60]))
    return [(name, fn, v) for fn, v in out]


def staged_sql(cwd=None, env=None):
    r = subprocess.run(['git', 'diff', '--cached', '--name-only', '--diff-filter=ACR'],
                       cwd=cwd, capture_output=True, text=True, env=env)
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
        files = [os.path.join(root, f) for f in staged_sql()]
    hits = []
    for f in files:
        try:
            hits += offenders(open(f, encoding='utf-8').read(), os.path.basename(f))
        except OSError:
            continue
    if not hits:
        print(f'  ✅ SECURITY DEFINER 的 search_path:本次 {len(files)} 支 .sql 全部是空字串'
              f'(⚠️ 只看檔面, 不連 DB)')
        return 0
    print(f'🔴 SECURITY DEFINER 而 search_path 不是空字串:{len(hits)} 支')
    for name, fn, v in hits:
        print(f'   {name}  {fn}  ⇒  {v}')
    print('   ── 為什麼:把可寫的 schema 排在 pg_catalog 前面 = SECURITY DEFINER 提權的標準路徑')
    print('      (repo 零處 REVOKE CREATE ON SCHEMA public ⇒ 任何人都建得出同名函式)')
    print("   ── 修法:SET search_path = ''  + body 裡的物件一律全名(pg_catalog.x / public.y)")
    print('   ── 樣板:supabase/migrations/20260904200000_m4b_search_queries_log.sql 的 ⑤a/⑤b')
    print('   ⚠️ 本閘只看【檔面】—— dashboard 手改的函式定義它看不到')
    return 1


def selftest():
    import tempfile
    ok = True

    def chk(name, sql, want):
        nonlocal ok
        got = len(offenders(sql, 'x'))
        good = (got > 0) == want
        print(('  ✅ ' if good else '  🔴 ') + f'{name}  期望{"有" if want else "無"}違規 實得 {got}')
        if not good:
            ok = False

    chk('①該紅 · DEFINER + public, pg_temp',
        "CREATE FUNCTION public.f() RETURNS void LANGUAGE plpgsql SECURITY DEFINER\n"
        "SET search_path = public, pg_temp\nAS $x$ BEGIN END $x$;", True)
    chk("②該綠 · DEFINER + ''",
        "CREATE FUNCTION public.f() RETURNS void LANGUAGE plpgsql SECURITY DEFINER\n"
        "SET search_path = ''\nAS $x$ BEGIN END $x$;", False)
    chk('③該紅 · DEFINER 而完全沒有 SET',
        "CREATE FUNCTION public.f() RETURNS void LANGUAGE plpgsql SECURITY DEFINER\n"
        "AS $x$ BEGIN END $x$;", True)
    chk('④該綠 · INVOKER(預設)⇒ 不歸本閘管',
        "CREATE FUNCTION public.f() RETURNS void LANGUAGE plpgsql\n"
        "AS $x$ BEGIN END $x$;", False)
    # 🔴🔴 這兩格是本閘規格裡承重的那一條的證人
    # 🔴🔴 **註解要放在 header【裡面】** —— 放在 `CREATE FUNCTION` 之前是【假證人】:
    #    掃描從 `CREATE FUNCTION` 的位置起算 ⇒ 前面那行根本沒被掃到
    #    ⇒ 拿掉剝註解的突變【殺不掉它】。2026-09-04 實測:我第一版就是那樣寫的。
    #    而真實那一支(`20260904240000`)的舊字面註解正是在 header 裡面。
    chk('⑤該綠 · header【裡】的註解有舊字面而本體是空字串(2026-09-04 實際發生, 誤報 5 支)',
        "CREATE FUNCTION public.f() RETURNS void LANGUAGE plpgsql SECURITY DEFINER\n"
        "-- ⛔ ~~原本寫 SET search_path = public, pg_catalog~~ 那是提權路徑\n"
        "SET search_path = ''\nAS $x$ BEGIN END $x$;", False)
    chk('⑥該紅 · header 裡的註解有正確字面而【本體是錯的】(⑤ 的負對照:剝註解沒放走真違規)',
        "CREATE FUNCTION public.f() RETURNS void LANGUAGE plpgsql SECURITY DEFINER\n"
        "-- 正確寫法是 SET search_path = ''\n"
        "SET search_path = public, pg_temp\nAS $x$ BEGIN END $x$;", True)
    chk('⑦該綠 · body 裡有 SET search_path 而 header 是空字串(body 的不算函式屬性)',
        "CREATE FUNCTION public.f() RETURNS void LANGUAGE plpgsql SECURITY DEFINER\n"
        "SET search_path = ''\nAS $x$ BEGIN PERFORM 1; END $x$;", False)

    print('全部通過。' if ok else '🔴 有格沒過。')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(selftest() if '--selftest' in sys.argv else main(sys.argv[1:]))
