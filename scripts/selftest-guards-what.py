#!/usr/bin/env python3
"""每一把尺瞎掉之後, selftest 會不會紅? —— **守門的守門**(只讀, 不改任何檔)。

用法:
    python3 scripts/selftest-guards-what.py                 # 掃預設那幾支板工具
    python3 scripts/selftest-guards-what.py <檔> [<檔> …]

🔴 **為什麼需要它**(2026-09-07 一夜兩次實錘, 都不是我看出來的):
  ① `board-token-normalize.py` 規則⑩ 我補了一格「本檔自己的註解不會被誤判」——
     拿掉 `+| ` 前綴過濾去突變 ⇒ **照樣全綠**。成因是我的斷言用錯關鍵字
     (那行沒有 `|` ⇒ 印出來的錨是 `(無錨)`, 內文根本不會出現我斷言的那個字)。
  ② `board-merge-rows.py` 我補了一格「本來在開頭 ⇒ 原樣不動」——
     拿掉那條 early-return ⇒ **輸出一模一樣**。成因是 fixture 太乾淨
     (`FIND.search` 找到的第一個就是開頭那個 ⇒ 搬回開頭 = 原地不動)。
  ⇒ 📌 **「我補了一格守它」與「那一格真的守得住」是兩件事** ——
     而它們在 selftest 的輸出上**印同一個綠**。

做法:對每個模組層 `NAME = re.compile(...)` 換成一個永不匹配的樣式, 再跑 `--selftest`。
  · rc 變非 0 ⇒ 🟢 有東西守著那把尺
  · rc 仍 0   ⇒ 🔴 **沒有東西守著** —— 那把尺壞掉時, 測試網不會叫

🛑 **它答不出什麼**:
  · 只突變**模組層的 regex**。函式裡的判斷、常數、比較運算子它碰不到。
  · 「有東西守著」不代表**守得對** —— 只代表 selftest 對這把尺的存在有反應。
  · rc 是唯一判準 ⇒ 一支 selftest 若本身 rc 恆 0(warn-only 的那種), 本工具對它零判別力。
    ⇒ 那種檔會被標出來, 不會被誤讀成「沒有東西守著」。
"""
import io, os, re, subprocess, sys

DEFAULT = [
    'scripts/board-token-normalize.py',
    'scripts/board-merge-rows.py',
    'scripts/paste-board-drycheck.py',
    'scripts/launch-dispatch-table.py',
]
PAT = re.compile(r'^([A-Z][A-Z0-9_]*) = re\.compile\(.*$', re.M)

# 第二種突變:**比較運算子**(`--ops`)。只挑最乾淨的四個 —— `in` / `not` 換掉
# 太容易產生語意上無意義的變體, 而那會讓報表被雜訊淹掉。
OPS = [('!=', '=='), ('>=', '>'), ('<=', '<')]
# 🔴 `==` ⇒ `!=` 另外處理:要避開 `==`/`!=`/`<=`/`>=` 的重疊比對。
EQ = re.compile(r'(?<![=!<>])==(?!=)')


def run(path):
    r = subprocess.run(['python3', path, '--selftest'], capture_output=True, text=True)
    return r.returncode


def run_kind(path):
    """回 (rc, kind)。kind ∈ {'assert','crash','pass'}。

    🔴 **rc 非 0 有兩種意思, 而它們印同一個數字**:
      · `assert` = selftest 的某一格紅了 ⇒ **那把尺有東西守著** ✅
      · `crash`  = 突變讓程式爆掉(SyntaxError / NameError / TypeError…)
                   ⇒ **那不算「有東西守著」** —— 它只證明程式不能跑。
    少了這個區分, 一輪運算子突變會把一堆「改壞語法」誤讀成「守得很好」。
    (2026-09-07 實錘:同一夜我兩次把 rc=1 讀成「守到了」, 而它紅在
     `FileNotFoundError` 與 `TypeError`。)
    """
    r = subprocess.run(['python3', path, '--selftest'], capture_output=True, text=True)
    if r.returncode == 0:
        return 0, 'pass'
    if 'Traceback' in r.stderr or 'Error' in r.stderr:
        return r.returncode, 'crash'
    return r.returncode, 'assert' 


def audit(path):
    src = io.open(path, encoding='utf-8').read()
    base = run(path)
    names = [m.group(1) for m in PAT.finditer(src)]
    print(f'\n══ {path} ══')
    print(f'  🟢 正世界 rc={base}' + ('' if base == 0 else '  ⚠️ **正世界就不是 0** ⇒ 下面的判別無效'))
    if base != 0:
        return [(path, '(正世界非 0)', 'SKIP')]
    if not names:
        print('  🔵 沒有模組層 regex ⇒ 本工具對它零判別力(不是「沒有東西守著」)')
        return []
    tmp = os.path.join(os.path.dirname(path) or '.', '_guardswhat_tmp.py')
    out = []
    try:
        for n in names:
            m = re.search(rf"^{n} = re\.compile\(.*$", src, re.M)
            io.open(tmp, 'w', encoding='utf-8').write(
                src[:m.start()] + f"{n} = re.compile(r'ZZQ_NEVER_MATCH_GUARDSWHAT')" + src[m.end():])
            rc = run(tmp)
            ok = rc != 0
            print(f'  {"🟢" if ok else "🔴🔴"} {n:12} 瞎掉 ⇒ rc={rc}  '
                  f'{"有東西守著" if ok else "**沒有東西守著**"}')
            out.append((path, n, 'OK' if ok else 'UNGUARDED'))
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)
    return out


def selftest():
    """🔴 **本工具自己的兩個世界** —— 造一支【故意沒守】的與一支【有守】的, 看它分不分得出來。

    少了這一對, 本工具在「全部有守」與「它根本沒在突變」兩個世界印同一個 🟢。
    """
    import tempfile, shutil
    d = tempfile.mkdtemp()
    fails = []
    try:
        un = os.path.join(d, 'unguarded.py')
        gd = os.path.join(d, 'guarded.py')
        io.open(un, 'w', encoding='utf-8').write(
            "import re, sys\n"
            "NEEDLE = re.compile(r'abc')\n"
            "def selftest():\n"
            "    print('  ok')\n"
            "    return 0\n"
            "if __name__ == '__main__':\n"
            "    sys.exit(selftest() if '--selftest' in sys.argv else 0)\n")
        io.open(gd, 'w', encoding='utf-8').write(
            "import re, sys\n"
            "NEEDLE = re.compile(r'abc')\n"
            "def selftest():\n"
            "    return 0 if NEEDLE.search('xxabcxx') else 1\n"
            "if __name__ == '__main__':\n"
            "    sys.exit(selftest() if '--selftest' in sys.argv else 0)\n")
        import contextlib
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rows_un = audit(un)
            rows_gd = audit(gd)

        def ck(name, got, want):
            ok = got == want
            print(f'  {"✅" if ok else "🔴"} {name}:{got}(期望 {want})')
            if not ok:
                fails.append(name)

        ck('🔴 故意沒守的 ⇒ 判 UNGUARDED', [r[2] for r in rows_un], ['UNGUARDED'])
        ck('🟢 有守的 ⇒ 判 OK', [r[2] for r in rows_gd], ['OK'])
        # 🔵 少了這一格, 上面兩格在「它真的分得出」與「它恰好各回一個值」印同一個綠
        ck('🔵 兩者判定必須不同(尺是活的)',
           rows_un[0][2] != rows_gd[0][2], True)
    finally:
        shutil.rmtree(d, ignore_errors=True)
    print('SELFTEST ' + ('PASS' if not fails else 'FAIL:' + ','.join(fails)))
    return 0 if not fails else 1


def audit_ops(path):
    """第二種突變:把比較運算子換掉, 看 selftest 叫不叫。

    🔴 只挑 `!=` `>=` `<=` `==` 四種 —— `in` / `not` 換掉太容易產生語意上無意義的變體,
       而那會讓報表被雜訊淹掉(那不是「更嚴格」, 是更難讀)。
    🔴 **只突變 `def selftest` 之前的那一段** —— 突變測試自己等於在測「測試會不會壞」, 沒有意義。
    """
    src = io.open(path, encoding='utf-8').read()
    lines = src.split('\n')
    cut = next((i for i, l in enumerate(lines) if l.startswith('def selftest')), len(lines))
    head_len = len('\n'.join(lines[:cut]))
    base, kind = run_kind(path)
    print(f'\n══ {path} (--ops) ══')
    if base != 0:
        print(f'  ⚠️ 正世界 rc={base} ⇒ 判別無效, 跳過')
        return []
    spots = []
    for old_op, new_op in OPS:
        for m in re.finditer(re.escape(old_op), src[:head_len]):
            spots.append((m.start(), old_op, new_op))
    for m in EQ.finditer(src[:head_len]):
        spots.append((m.start(), '==', '!='))
    tmp = os.path.join(os.path.dirname(path) or '.', '_guardswhat_ops.py')
    out = []
    try:
        for pos, o, n in spots:
            io.open(tmp, 'w', encoding='utf-8').write(src[:pos] + n + src[pos + len(o):])
            rc, kd = run_kind(tmp)
            ln = src[:pos].count('\n') + 1
            out.append((ln, o, n, kd))
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)
    surv = [r for r in out if r[3] == 'pass']
    crash = [r for r in out if r[3] == 'crash']
    caught = [r for r in out if r[3] == 'assert']
    print(f'  共 {len(out)} 個運算子突變點 ⇒ 🟢 被斷言抓到 {len(caught)} · '
          f'🔵 讓程式爆掉(不算守到){len(crash)} · 🔴 **活下來(沒有東西守著){len(surv)}**')
    for ln, o, n, _ in surv[:12]:
        print(f'     🔴 :{ln} `{o}` ⇒ `{n}` 存活')
    return [(path, f':{ln} {o}⇒{n}', 'UNGUARDED') for ln, o, n, _ in surv]


if __name__ == '__main__':
    if '--selftest' in sys.argv:
        sys.exit(selftest())
    targets = sys.argv[1:] or [p for p in DEFAULT if os.path.exists(p)]
    ops_mode = '--ops' in sys.argv
    targets = [x for x in targets if not x.startswith('--')]
    if not targets:
        targets = [p for p in DEFAULT if os.path.exists(p)]
    rows = []
    for p in targets:
        rows += audit_ops(p) if ops_mode else audit(p)
    bad = [r for r in rows if r[2] == 'UNGUARDED']
    skip = [r for r in rows if r[2] == 'SKIP']
    print(f'\n── 共掃 {len(rows)} 把尺 · 沒有東西守著的 {len(bad)} 把 · 判別不了的 {len(skip)} 支 ──')
    for p, n, _ in bad:
        print(f'  🔴 {p} :: {n}')
    print('🔵 而「有東西守著」不代表守得對 —— 見檔頭「它答不出什麼」。')
    sys.exit(1 if bad else 0)
