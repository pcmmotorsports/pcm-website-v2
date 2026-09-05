#!/usr/bin/env python3
"""`pg_catalog.` 前綴接【SQL 特殊語法】⇒ 紅(只擋 staged 新 migration)。

══ 🔴 為什麼(2026-09-04 一晚三次)══════════════════════════════════════════════

`SET search_path = ''` 之後 body 裡的物件要全名, 而**有一族名字加了前綴會【語法錯誤】** ——
它們不是普通函式, 是 SQL 標準的**保留語法**(`COALESCE` / `NULLIF` / `CURRENT_USER` …)。
```
線 -mail  撞 pg_catalog.current_user · pg_catalog.coalesce
線 -ship  撞 pg_catalog.nullif
線 -db    (我自己)寫 240000 時逐個改全名, 而剛好沒碰到這一族
```
🎯 **⇒ 而它在 apply 的當下才炸** —— 靜態檢查看不到, 三綠看不到, 只有真的貼下去才知道。

══ 🔴 名單是【psql 實測】出來的, 不是憑腦列 ════════════════════════════════════

2026-09-04 在拋棄式 PG 上逐個餵 `SELECT <x>` 與 `SELECT pg_catalog.<x>`, 比兩個 rc:
```
裸 OK 而帶前綴 FAIL ⇒ 20 個(而第二輪把它們分成兩堆, 見下)
兩個都 OK          ⇒ now() · current_database() · count(*) over ()  ← 它們是【普通函式】
```
🔵 **⇒ 那三個就是本閘的負對照** —— 一把把 `pg_catalog.now()` 也判紅的尺是錯的。
🛑 **而「兩個都 OK」這件事本身要留著**:它證明本閘**不是**「看到 `pg_catalog.` 就叫」。

══ 天花板 ═══════════════════════════════════════════════════════════════════
  ① 名單是**實測那一天的 PG 版本**(本機 17.10)—— 新版加了新語法, 這份名單不會自己長。
     ⇒ 重測的方法寫在下面 `KEYWORD_PROBE` 那段註解裡。
  ② 只擋 staged 的新增/改名 `.sql`;先剝行註解與 dollar-quote 之外的字串不剝
     —— 🔴 **dollar-quote 裡面要照掃**, 因為函式體正是最常寫全名的地方。
  ③ 它比對的是**字面**, 不 parse SQL ⇒ 一個叫 `pg_catalog_coalesce` 的識別字不會誤中
     (有邊界檢查), 而一個字串裡的 `pg_catalog.coalesce(` 會誤中 —— 而那一側是誤報, 看得見。
"""

import os
import re
import subprocess
import sys

MIG_DIR = 'supabase/migrations'

#: 🔴🔴 **兩堆, 而分堆是【第二輪實測】才分出來的**(2026-09-04, PG 17.10)。
#:
#: ⛔ **我第一版只有一堆** ⇒ `--audit` 對真樹抓到 **5 處**, 而那些 migration **早就 apply 成功了**
#:    ⇒ 📌 **那是誤報, 而抓到它的是「拿真樹跑一發」不是重讀。**
#: 🔬 第二輪實測:同一個名字有**兩種寫法**, 而它們的答案**相反**:
#: ```
#:                  特殊語法帶前綴            函式呼叫式帶前綴
#:   substring      FAIL  (… FROM 2)          🟢 OK   (…, 2)   ← 真樹那 5 處全是這種
#:   trim           FAIL                      FAIL             ← 兩種都不行
#:   coalesce 等    —                         FAIL             ← 只有一種寫法
#: ```
#: ⇒ ✅ 所以分兩堆:**永遠不能加**(ALWAYS)· **只有特殊語法不能加**(SYNTAX_ONLY)。
#: 🛑 而 SYNTAX_ONLY 那堆**只有帶關鍵字時才叫** —— 逗號式是合法的, 不得誤擋。

#: 這一堆加了前綴一定錯(它們沒有「函式呼叫式」這個選項)。
ALWAYS = [
    'coalesce', 'nullif', 'greatest', 'least',
    'current_user', 'session_user', 'user',
    'current_date', 'current_time', 'current_timestamp',
    'localtime', 'localtimestamp',
    'current_schema', 'current_catalog',
    'trim',
]
#: 這一堆**只有寫成特殊語法時**才錯:`pg_catalog.substring(x FROM y)` ✗ · `pg_catalog.substring(x, y)` ✓
#: 值 = 那個寫法裡的關鍵字(不分大小寫), 出現在同一組括號內就算特殊語法。
SYNTAX_ONLY = {
    'substring': ('from', 'for', 'similar'),
    'position': ('in',),
    'overlay': ('placing', 'from', 'for'),
    'extract': ('from',),
    'cast': ('as',),
}
#: 🔵 這幾個【可以】加前綴 —— 它們是普通函式。留在這裡當本閘的負對照, 不是裝飾。
NOT_SPECIAL = ['now', 'current_database', 'count']

ALWAYS_PAT = re.compile(r'\bpg_catalog\.(' + '|'.join(ALWAYS) + r')\b', re.I)
SYNTAX_PAT = re.compile(r'\bpg_catalog\.(' + '|'.join(SYNTAX_ONLY) + r')\s*\(', re.I)


def strip_line_comments(sql):
    """先剝行註解 —— 註解裡引用一個錯例(例:本檔自己)不該被判成違規。

    🔴🔴 **codex 2026-09-05 must-fix**:原本是 `re.sub(r'--.*$', '', line)`,
    而 **`--` 出現在【字串常值裡】時它照樣剝** ⇒
      `SELECT '--', pg_catalog.coalesce(a,b);` ⇒ 整行從第一個 `-` 之後被砍掉
      ⇒ 📌 **真的違規被自己的剝註解動作藏起來, 而閘印綠。**
    ⇒ ✅ 改成逐字元走一遍, 只有【不在單引號內】的 `--` 才算註解起點。
    ⚠️ 射程:它處理單引號與 SQL 的 `''` 逃脫;**不處理 dollar-quote 內的引號**
      —— 那是刻意的, 因為函式體正是重災區, 本閘要照掃(見 offenders 的 docstring)。
    """
    out = []
    for line in sql.split('\n'):
        in_str = False
        i = 0
        while i < len(line):
            c = line[i]
            if in_str:
                if c == "'":
                    if i + 1 < len(line) and line[i + 1] == "'":
                        i += 1          # SQL 的 '' = 一個逃脫的單引號, 不結束字串
                    else:
                        in_str = False
            else:
                if c == "'":
                    in_str = True
                elif c == '-' and i + 1 < len(line) and line[i + 1] == '-':
                    break               # 真的註解起點
            i += 1
        out.append(line[:i])
    return '\n'.join(out)


def _paren_body(line, open_idx):
    """從 `(` 起抓到配對的 `)`。

    🔴 **codex 2026-09-05 must-fix**:原本只在**同一行內**找 ——
      `pg_catalog.substring(x` 換行後才出現 `FROM y` ⇒ 括號內容抓不到那個關鍵字
      ⇒ 📌 **把特殊語法拆成兩行就能繞過整道閘。**
    ⇒ ✅ 呼叫端改成餵【從這一行到檔尾】的文字, 本函式的邏輯不變(它本來就是走字元)。
    """
    d, j = 0, open_idx
    while j < len(line):
        if line[j] == '(':
            d += 1
        elif line[j] == ')':
            d -= 1
            if d == 0:
                return line[open_idx + 1:j]
        j += 1
    return line[open_idx + 1:]


def offenders(sql):
    """回 [(行號, 那個名字, 該行片段)]。**dollar-quote 裡面照掃** —— 函式體正是重災區。"""
    out = []
    lines = strip_line_comments(sql).split('\n')
    for i, line in enumerate(lines, 1):
        for m in ALWAYS_PAT.finditer(line):
            out.append((i, m.group(1).lower(), line.strip()[:70]))
        for m in SYNTAX_PAT.finditer(line):
            name = m.group(1).lower()
            # 🔴 餵【這一行到檔尾】, 讓跨行的括號也抓得到(codex must-fix⑤)。
            #    第一行就是 `line` 本身 ⇒ open_idx 不用換算。
            body = _paren_body('\n'.join(lines[i - 1:]), m.end() - 1)
            # 🔴 只有【括號裡出現那個關鍵字】才算特殊語法;逗號式是合法的。
            if any(re.search(r'\b' + kw + r'\b', body, re.I) for kw in SYNTAX_ONLY[name]):
                out.append((i, name, line.strip()[:70]))
    return out


def read_for_gate(path, root, audit):
    """`--audit` 讀工作樹(它掃的是全樹現況);否則讀 **index 裡那一版**。

    🔴 `git show :<相對路徑>` 拿的是 staged 的內容 —— 那才是 commit 進去的東西。
    🛑 它失敗時**不得靜靜退回工作樹** —— 那會讓「讀不到 index」與「index 與工作樹相同」
      印同一個綠。⇒ 讀不到就當場 rc=2。
    """
    if audit:
        return open(path, encoding='utf-8').read()
    rel = os.path.relpath(path, root)
    r = subprocess.run(['git', '-C', root, 'show', ':' + rel],
                       capture_output=True, text=True)
    if r.returncode != 0:
        print(f'🔴 量具失效:git show :{rel} 回 rc={r.returncode} ⇒ 這【不是】「沒有違規」')
        sys.exit(2)
    return r.stdout


def staged():
    r = subprocess.run(['git', 'diff', '--cached', '--name-only', '--diff-filter=ACMR'],
                       capture_output=True, text=True)
    if r.returncode != 0:
        print(f'🔴 量具失效:git diff --cached 回 rc={r.returncode} ⇒ 這【不是】「沒有違規」')
        sys.exit(2)
    # 🔴🔴 **2026-09-05 把分母從「只有 supabase/migrations/」放寬成【任何 staged 的 .sql】。**
    #    成因是量到的:`scripts/view-behaviour-fixtures.sql` 裡寫了 `pg_catalog.nullif(...)`,
    #    而這道閘**印綠** —— 它不是沒抓到, 是**那支檔結構上不在它的分母裡**。
    #    ⇒ 📌 **一道列白名單目錄的掃描型守門, 對目錄外的同一個錯【零判別力】,**
    #      **而它印的綠與「掃過了而且乾淨」逐字相同。**
    #    ⚠️ 同一個 `nullif` 坑在 2026-09-04 / 09-05 共踩三次, 前兩次都在 migrations 裡被人工發現,
    #      而那兩次留下的提醒**寫在 migration 的註解裡** ⇒ 對寫 `scripts/*.sql` 的人等於不存在。
    # 🔴🔴 **而放寬目錄還不夠 —— `--diff-filter=ACR` 只看【新增/改名】, 不看【被改】。**
    #    ⇒ 那支 fixture 是 `M` ⇒ 放寬目錄之後它**仍然**不在分母裡, 而閘**仍然印綠**。
    #    ⇒ 📌 **同一道閘上有兩個獨立的「結構上看不到」, 而修掉第一個之後它照樣印綠**
    #      —— 綠沒有變, 所以沒有任何訊號說我只修了一半。改成 `ACMR`。
    #    ⚠️ 對 `supabase/migrations/` 而言 M 幾乎不會出現(貼過的不改), 所以這一改不增噪音。
    return [l for l in r.stdout.split('\n') if l.endswith('.sql')]


def main(argv):
    root = subprocess.run(['git', 'rev-parse', '--show-toplevel'],
                          capture_output=True, text=True).stdout.strip() or '.'
    if '--audit' in argv:
        import glob
        # 🔴🔴 **分母對齊 lint-staged 那條路**(2026-09-05,主視窗量到)——
        #    ⛔ ~~glob 只吃 `supabase/migrations/*.sql` + `scripts/*.sql`~~ ⇒ **336 / 380**,
        #       漏掉 `docs/specs`(17)· `docs/probes`(10)· `supabase/after-checks`(9)·
        #       `scripts/admin-probe`(3)· 其餘子目錄(5)—— **共 44 支結構上看不到**。
        #    🔬 實錘:`docs/specs/2026-09-01-…-migration-draft.sql:493` 有一個 `pg_catalog.coalesce`,
        #       **lint-staged 那條路會紅,而 `--audit` 印綠** ⇒ 有人想用 `--audit` 全樹掃就掃不到它。
        #    📌 **兩條路問的不是同一組檔, 而它們印的是同一種綠。**
        #    ✅ 改用 `git ls-files '*.sql'` —— 它與 lint-staged 的分母同源(都是版控裡的檔)。
        #    ⚠️ 而它答不出【沒進版控的 .sql】—— 那一類本閘結構上看不到, 兩條路都一樣。
        r = subprocess.run(['git', 'ls-files', '*.sql'],
                           cwd=root, capture_output=True, text=True)
        if r.returncode != 0:
            print(f'🔴 量具失效:git ls-files 回 rc={r.returncode} ⇒ 這【不是】「沒有違規」')
            sys.exit(2)
        files = sorted(os.path.join(root, f) for f in r.stdout.split('\n') if f.strip())
    else:
        files = [os.path.join(root, f) for f in staged()]
    # 🔴🔴 **codex 2026-09-05 must-fix:讀的必須是【index 裡那一版】, 不是工作樹那一版。**
    #    staged 版含違規而工作樹已經改掉 ⇒ 閘讀工作樹 ⇒ **印綠, 而 commit 進去的是壞的那版**;
    #    反過來則是誤報。⇒ 📌 **這是本 repo 記過三次以上的同一族**(「閘讀 index 而我改的是工作樹」)。
    hits = []
    for f in files:
        try:
            for ln, name, frag in offenders(read_for_gate(f, root, '--audit' in argv)):
                hits.append((os.path.basename(f), ln, name, frag))
        except OSError:
            continue
    if not hits:
        print(f'  ✅ pg_catalog. 前綴:本次 {len(files)} 支 .sql 沒有接到特殊語法上'
              f'(⚠️ 名單是 2026-09-04 在 PG 17.10 實測的 {len(ALWAYS)}+{len(SYNTAX_ONLY)} 個, 不會自己長)')
        return 0
    print(f'🔴 `pg_catalog.` 前綴接到【SQL 特殊語法】上:{len(hits)} 處')
    for name, ln, kw, frag in hits:
        print(f'   {name}:{ln}  pg_catalog.{kw}  ⇒  {frag}')
    print('   ── 為什麼:那一族不是普通函式, 是 SQL 標準的保留語法 ⇒ 加前綴【語法錯誤】')
    print('   ── 而它在【apply 的當下】才炸:靜態檢查看不到, 三綠看不到')
    print('   ── 修法:拿掉前綴(它們本來就不受 search_path 影響, 不需要全名)')
    print(f'   🔵 而 pg_catalog.now() / current_database() 是【可以】的 ——'
          f' 本閘只認實測出來的那 {len(ALWAYS)}+{len(SYNTAX_ONLY)} 個')
    return 1


def selftest():
    ok = True

    def chk(name, sql, want_bad):
        nonlocal ok
        bad = len(offenders(sql)) > 0
        good = bad == want_bad
        print(('  ✅ ' if good else '  🔴 ')
              + f'{name}  期望{"紅" if want_bad else "綠"} 實得{"紅" if bad else "綠"}')
        if not good:
            ok = False

    chk('①該紅 · pg_catalog.coalesce(mail 今晚撞的那個)',
        'SELECT pg_catalog.coalesce(a, b) FROM t;', True)
    chk('②該紅 · pg_catalog.current_user(mail 撞的第二個)',
        "IF pg_catalog.current_user <> 'postgres' THEN", True)
    chk('③該紅 · pg_catalog.nullif(ship 撞的那個)',
        "SELECT pg_catalog.nullif(x, '')::numeric;", True)
    # 🔵 負對照 —— 這三格證明本閘不是「看到 pg_catalog. 就叫」
    chk('④該綠 · pg_catalog.now() 【可以】(實測兩個都 OK)',
        'SELECT pg_catalog.now();', False)
    chk('⑤該綠 · pg_catalog.current_database() 【可以】',
        'SELECT pg_catalog.current_database();', False)
    chk('⑥該綠 · pg_catalog.max / array_to_string 這類普通函式',
        'SELECT pg_catalog.max(x), pg_catalog.array_to_string(a, %s);' % "','", False)
    # 🔴🔴 codex 2026-09-05 的兩個反例 —— **每一條 finding 都做成一格會紅的東西**,
    #    否則「我修好了」與「我以為我修好了」在下一次改動時沒有分別。
    chk('⑭該紅 · `--` 在【字串常值】裡, 後面才是違規(codex must-fix④)',
        "SELECT '--', pg_catalog.coalesce(a, b);", True)
    chk('⑮該綠 · 真的行註解裡提到違規 ⇒ 仍然不得誤中(④ 的負對照)',
        "SELECT 1; -- pg_catalog.coalesce(a, b)", False)
    chk('⑯該紅 · 特殊語法【跨行】:substring( 換行後才 FROM(codex must-fix⑤)',
        "SELECT pg_catalog.substring(x\n  FROM 1 FOR 2);", True)
    chk('⑰該綠 · 跨行但用逗號式 ⇒ 合法(⑤ 的負對照)',
        "SELECT pg_catalog.substring(x,\n  1, 2);", False)
    # 🔴 邊界
    chk('⑦該綠 · 裸的 coalesce(沒有前綴)⇒ 本閘不管',
        'SELECT coalesce(a, b);', False)
    chk('⑧該綠 · 識別字裡剛好有那個字 ⇒ 不得誤中(邊界檢查)',
        'SELECT pg_catalog.coalesce_helper(a);', False)
    chk('⑨該綠 · 註解裡引用一個錯例 ⇒ 不得誤中(本檔自己就是這樣寫的)',
        '-- ⛔ 不要寫 pg_catalog.coalesce(a,b)\nSELECT coalesce(a,b);', False)
    chk('⑩該紅 · dollar-quote【裡面】也要掃 —— 函式體正是重災區',
        "CREATE FUNCTION f() RETURNS int LANGUAGE plpgsql AS $x$\n"
        "BEGIN RETURN pg_catalog.greatest(1,2); END $x$;", True)

    # 🔴🔴 這兩格是【第二輪分堆】的證人 —— 而它們是真樹那 5 處誤報逼出來的
    chk('⑪該綠 · pg_catalog.substring(x, y) 逗號式【合法】(真樹 5 處全是這種)',
        "AND coalesce(pg_catalog.substring(pg_catalog.pg_get_triggerdef(oid), 1, 40), '') = ''", False)
    chk('⑫該紅 · pg_catalog.substring(x FROM y) 特殊語法 ⇒ 仍然錯(⑪ 的負對照)',
        "SELECT pg_catalog.substring('abc' FROM 2);", True)
    chk('⑬該紅 · pg_catalog.trim 兩種寫法都不行(實測)—— 它在 ALWAYS 那一堆',
        "SELECT pg_catalog.trim(' a ');", True)

    print('全部通過。' if ok else '🔴 有格沒過。')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(selftest() if '--selftest' in sys.argv else main(sys.argv[1:]))
