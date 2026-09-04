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
    """先剝行註解 —— 註解裡引用一個錯例(例:本檔自己)不該被判成違規。"""
    return '\n'.join(re.sub(r'--.*$', '', line) for line in sql.split('\n'))


def _paren_body(line, open_idx):
    """從 `(` 起抓到配對的 `)`(同一行內);沒收尾就回到行尾。"""
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
    for i, line in enumerate(strip_line_comments(sql).split('\n'), 1):
        for m in ALWAYS_PAT.finditer(line):
            out.append((i, m.group(1).lower(), line.strip()[:70]))
        for m in SYNTAX_PAT.finditer(line):
            name = m.group(1).lower()
            body = _paren_body(line, m.end() - 1)
            # 🔴 只有【括號裡出現那個關鍵字】才算特殊語法;逗號式是合法的。
            if any(re.search(r'\b' + kw + r'\b', body, re.I) for kw in SYNTAX_ONLY[name]):
                out.append((i, name, line.strip()[:70]))
    return out


def staged():
    r = subprocess.run(['git', 'diff', '--cached', '--name-only', '--diff-filter=ACR'],
                       capture_output=True, text=True)
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
            for ln, name, frag in offenders(open(f, encoding='utf-8').read()):
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
