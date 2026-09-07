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


SELF_FLAGS = ('--selftest', '--self-check')


# 🔴 一個旗標字面要算「入口」, 它那一行必須也長得像在【收參數】。
#    少了這個, `SELFTEST = re.compile(r'--selftest')` 這種【測資】會被選成入口。
FLAG_CTX = re.compile(r'sys\.argv|add_argument|==|\bin\s*[\(\[]')


def flag_of(path):
    """那支腳本自己收的是哪一個自檢旗標;查無 ⇒ None(= 沒有自檢入口)。

    🔴 **2026-09-07 db 實測回報的假陽性**:`git-isolation-denominator.py` 收的是
       `--self-check`, 而本工具**寫死** `--selftest` ⇒ 它**根本沒進自檢**、印說明文回 rc=0
       ⇒ 每一發突變 rc 都不變 ⇒ 本工具報「**3 把沒守**」。實際 2 把、而且守著。
       📌 **「我餵錯旗標」與「那把尺沒守」在 rc 上是同一個 0。**

    🛑 **而我的第一版修法【得了它自己要抓的病】**(code-reviewer 2026-09-07 抓到, 我複驗成立):
       第一版用 `src.rfind('__name__')` 切尾段, 兩種形狀各漏一半 ——
       ① 入口行【之後】還有 `type(e).__name__`(9 支檔有)⇒ `rfind` 選中它、把入口切掉;
       ② argparse 型把 `ap.add_argument('--selftest', …)` 寫在入口行【之前】(實測
          `stale-commit-msgs.py:180` · `suite-reproducibility.py:249`)⇒ 尾段裡本來就沒有。
       兩者都回 None ⇒ 那兩支從分母裡**安靜消失**。
       📌 **⇒ 位置不是入口的特徵, 【上下文】才是。**

    ✅ 現行判準:旗標字面**那一行**還要命中 `FLAG_CTX`(`sys.argv` / `add_argument` /
       `==` / `in (`)。三種慣用寫法全涵蓋, 而 `re.compile(r'--selftest')` 那行
       (只有單一個 `=`)不命中。兩個都合格 ⇒ 取 `SELF_FLAGS` 的順序(`--selftest` 優先)。
    """
    src = io.open(path, encoding='utf-8').read()
    for f in SELF_FLAGS:
        for line in src.split('\n'):
            if (f"'{f}'" in line or f'"{f}"' in line) and FLAG_CTX.search(line):
                return f
    return None


def run(path, flag=None):
    # 🔴 **不留 `or '--selftest'` 那個回退** —— 它會把「查無入口」又靜靜變回一次猜測,
    #    而那正是本次要修的病(code-reviewer 標的活地雷)。查無 ⇒ 讓它炸, 不要猜。
    flag = flag or flag_of(path)
    assert flag, f'{path}:查無自檢入口 ⇒ 呼叫端要先擋 None, 不可以由這裡猜'
    r = subprocess.run(['python3', path, flag], capture_output=True, text=True)
    return r.returncode


def run_kind(path, flag=None):
    """回 (rc, kind)。kind ∈ {'assert','crash','pass'}。

    🔴 **rc 非 0 有兩種意思, 而它們印同一個數字**:
      · `assert` = selftest 的某一格紅了 ⇒ **那把尺有東西守著** ✅
      · `crash`  = 突變讓程式爆掉(SyntaxError / NameError / TypeError…)
                   ⇒ **那不算「有東西守著」** —— 它只證明程式不能跑。
    少了這個區分, 一輪運算子突變會把一堆「改壞語法」誤讀成「守得很好」。
    (2026-09-07 實錘:同一夜我兩次把 rc=1 讀成「守到了」, 而它紅在
     `FileNotFoundError` 與 `TypeError`。)
    """
    flag = flag or flag_of(path)
    assert flag, f'{path}:查無自檢入口 ⇒ 呼叫端要先擋 None'
    r = subprocess.run(['python3', path, flag], capture_output=True, text=True)
    if r.returncode == 0:
        return 0, 'pass'
    if 'Traceback' in r.stderr or 'Error' in r.stderr:
        return r.returncode, 'crash'
    return r.returncode, 'assert' 


def audit(path):
    src = io.open(path, encoding='utf-8').read()
    fl = flag_of(path)
    print(f'\n══ {path} ══')
    # 🔴 第三格的第二種形狀:**它連自檢入口都沒有** ⇒ 我不是量到「沒守」, 是【量不到】。
    #    (2026-09-07 db 回報:我對 `--self-check` 那支報了 3 把假陽性。)
    if fl is None:
        print('  ⏸️  **我量不到這一支** —— 找不到自檢入口'
              f'(試過 {" / ".join(SELF_FLAGS)})⇒ **不是「沒有東西守著」**')
        return [(path, '(無自檢入口)', 'SKIP')]
    if fl != '--selftest':
        print(f'  🔵 它的自檢旗標是 `{fl}`(不是 `--selftest`)⇒ 本工具改餵它')
    base = run(path, fl)
    names = [m.group(1) for m in PAT.finditer(src)]
    # 🔴 **「我量不到」不可以配一個綠勾** —— 2026-09-07 我寫完「第三格要印得跟前兩格
    #    一樣大聲」那句通則, 二十分鐘後拿本工具去掃一支 `.sh`, 它印的正是
    #    `🟢 正世界 rc=1  ⚠️ 判別無效` —— **綠勾配警告**, 而總結那行的 rc 還是 0。
    #    ⇒ 📌 **我剛寫下的那條規則, 我自己的工具違反它。**
    if base == 0:
        print(f'  🟢 正世界 rc={base}')
    else:
        print(f'  ⏸️  **我量不到這一支** —— 它自己的 `{fl}` 正世界就 rc={base}'
              f'(可能是它拒絕在這個環境跑, 或它本來就紅)⇒ **下面的判別無效**')
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
            rc = run(tmp, fl)
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
        # 🔵 貪吃錨那一格的兩個世界
        _gd = os.path.join(d, 'greedy.py')
        io.open(_gd, 'w', encoding='utf-8').write("A = r'⟦[^" + "⟧]+⟧'\n")  # 貪吃樣式用串接組出, 免得本檔自己被貪吃錨閘擋
        _ok = os.path.join(d, 'okpat.py')
        io.open(_ok, 'w', encoding='utf-8').write("A = r'⟦[^⟦⟧]+⟧'\n")
        with contextlib.redirect_stdout(io.StringIO()):
            _g1 = audit_greedy([_gd])
            _g2 = audit_greedy([_ok])
        # 🔴 **「我量不到」的三個世界**(2026-09-07;我寫完那句通則二十分鐘後被自己的工具打臉)
        #    它當時印的是 `🟢 正世界 rc=1 ⚠️ 判別無效` —— **綠勾配警告**, 而總結那行 rc 還是 0。
        #    ⇒ 三格守它:①不印綠勾 ②總結行單獨列出來 ③**rc = 2**(不與「通過」的 0 同形)
        _un = os.path.join(d, 'cannot.py')
        io.open(_un, 'w', encoding='utf-8').write(
            "import re, sys\n"
            "NEEDLE = re.compile(r'abc')\n"
            "def selftest():\n"
            "    return 3\n"          # 🔴 正世界就非 0 ⇒ 判別無效
            "if __name__ == '__main__':\n"
            "    sys.exit(selftest() if '--selftest' in sys.argv else 0)\n")
        _b = io.StringIO()
        with contextlib.redirect_stdout(_b):
            _rows_un2 = audit(_un)
        _o = _b.getvalue()
        ck('⏸️a 正世界非 0 ⇒ 不印綠勾', '🟢 正世界' in _o, False)
        ck('⏸️b 而要明說我量不到', '我量不到這一支' in _o, True)
        ck('⏸️c 判定是 SKIP 不是 OK', [r[2] for r in _rows_un2], ['SKIP'])
        # 🔴 **而 rc 分三格那一半, 第一版沒有東西守**(突變它 ⇒ 上面三格照樣綠)
        #    ⇒ 這一格走【真的跑一次整支】, 比 rc 本身。
        _r_skip = subprocess.run(['python3', __file__, _un], capture_output=True, text=True)
        ck('⏸️d 掃到「量不到」的檔 ⇒ rc = 2(不與「通過」的 0 同形)', _r_skip.returncode, 2)
        _r_ok = subprocess.run(['python3', __file__, gd], capture_output=True, text=True)
        ck('⏸️e 🔵 而全部有守的 ⇒ rc = 0(證明上一格不是恆 2)', _r_ok.returncode, 0)
        ck('🔴 貪吃樣式 ⇒ 抓到', len(_g1), 1)
        ck('🟢 正確樣式 ⇒ 不叫', len(_g2), 0)
        # 🔵 `EQ` 的兩個世界(2026-09-07 全掃自己抓到自己:它當時沒有東西守)
        #    它要抓 `==`, 而**避開** `!=` `<=` `>=` `===` —— 那個避開才是它的全部價值,
        #    因為 OPS 已經各自處理那三個, 重複命中會讓同一處被突變兩次。
        ck('🟢 EQ 抓得到單純的 ==', len(EQ.findall('a == b')), 1)
        ck('🔵 EQ 不咬 != <= >=(否則與 OPS 重複命中)',
           len(EQ.findall('a != b and c <= d and e >= f')), 0)
        ck('🔵 EQ 不咬 ===(那是別的語言的, 不該被當兩個 ==)',
           len(EQ.findall('a === b')), 0)
        ck('🔵 兩者判定必須不同(尺是活的)',
           rows_un[0][2] != rows_gd[0][2], True)
        # 🚩 **自檢旗標那四格(2026-09-07 db 回報的假陽性)**
        #    我寫死 `--selftest` ⇒ 對收 `--self-check` 的那支根本沒進自檢
        #    ⇒ 每發突變 rc 都不變 ⇒ 報「3 把沒守」而實際是 2 把、且守著。
        _sc = os.path.join(d, 'selfcheck.py')
        io.open(_sc, 'w', encoding='utf-8').write(
            "import re, sys\n"
            "NEEDLE = re.compile(r'abc')\n"
            # 🔴 這一行是【測資】不是入口 —— 只查字面的尺會在這裡選錯旗標
            "DECOY = re.compile(r'--selftest')\n"
            "def sc():\n"
            "    return 0 if NEEDLE.search('xxabcxx') else 1\n"
            "if __name__ == '__main__':\n"
            "    sys.exit(sc() if '--self-check' in sys.argv[1:] else 0)\n")
        _nf = os.path.join(d, 'noflag.py')
        io.open(_nf, 'w', encoding='utf-8').write(
            "import re\nNEEDLE = re.compile(r'abc')\n")
        ck('🚩a 收 --self-check 的檔 ⇒ 認得出來', flag_of(_sc), '--self-check')
        # 🔴 原 🚩b 與 🚩a 是【同一個斷言寫兩次】(code-reviewer 抓到)⇒ 換成真正不同的世界:
        #    argparse 型把旗標宣告在 `if __name__` 【之前】, 而入口行之後另有 `type(e).__name__`
        #    —— 那正是舊 `rfind` 版兩種漏法的合體(實測 stale-commit-msgs / suite-reproducibility)。
        _ap = os.path.join(d, 'argparsey.py')
        io.open(_ap, 'w', encoding='utf-8').write(
            "import re, sys, argparse\n"
            "NEEDLE = re.compile(r'abc')\n"
            "def main():\n"
            "    ap = argparse.ArgumentParser()\n"
            "    ap.add_argument('--selftest', action='store_true')\n"
            "    if ap.parse_args().selftest:\n"
            "        return 0 if NEEDLE.search('xxabcxx') else 1\n"
            "    return 0\n"
            "if __name__ == '__main__':\n"
            "    try:\n"
            "        sys.exit(main())\n"
            "    except Exception as e:\n"
            "        print(type(e).__name__)\n"      # 🔴 入口行【之後】的第二個 __name__
            "        sys.exit(9)\n")
        ck('🚩b argparse 型 + 入口後另有 __name__ ⇒ 仍認得 --selftest'
           '(舊 rfind 版對這支回 None)', flag_of(_ap), '--selftest')
        ck('🚩c 沒有自檢入口 ⇒ None(第三格, 不是「沒守」)', flag_of(_nf), None)
        with contextlib.redirect_stdout(io.StringIO()):
            _rows_sc = audit(_sc)
            _rows_nf = audit(_nf)
        # 🔴 這一格我第一版期望寫 `['OK']` 而它回 `['OK','UNGUARDED']` —— **紅的是我的期望值**:
        #    fixture 裡有【兩】把尺, `DECOY` 本來就沒有人守 ⇒ 它判 UNGUARDED 是對的。
        #    🔵 而那一格順便成了正對照:同一支檔裡**一把 OK 一把 UNGUARDED** ⇒ 尺沒有恆回同一答案。
        ck('🚩d 端到端:守著的那把判 OK(這正是 db 撞到的那個假陽性 —— 修前它會是 UNGUARDED)',
           dict((r[1], r[2]) for r in _rows_sc).get('NEEDLE'), 'OK')
        ck('🚩d′ 🔵 而同檔沒人守的那把仍判 UNGUARDED(證明不是恆 OK)',
           dict((r[1], r[2]) for r in _rows_sc).get('DECOY'), 'UNGUARDED')
        ck('🚩e 無入口 ⇒ 判 SKIP 不是 UNGUARDED', [r[2] for r in _rows_nf], ['SKIP'])
        # 🔴 `--ops` 那條路第一版【沒有東西守】(code-reviewer 抓到:它 `return []`
        #    ⇒ 那支檔連「量不到」都不會被列出, **從報表上直接消失**)。
        with contextlib.redirect_stdout(io.StringIO()):
            _ops_nf = audit_ops(_nf)
            _ops_sc = audit_ops(_sc)
        ck('🚩f --ops 對無入口的檔也判 SKIP(不是安靜回空清單)',
           [r[2] for r in _ops_nf], ['SKIP'])
        ck('🚩g 🔵 而 --ops 對有入口的檔【不是】恆 SKIP(尺是活的)',
           'SKIP' in [r[2] for r in _ops_sc], False)
    finally:
        shutil.rmtree(d, ignore_errors=True)
    print('SELFTEST ' + ('PASS' if not fails else 'FAIL:' + ','.join(fails)))
    return 0 if not fails else 1


ANCHOR_CLS = re.compile(r'⟦\[\^([^\]]*)\]')


def audit_greedy(paths):
    """掃 `⟦[^…]+⟧` 這種錨樣式:字元類裡**沒有 `⟦`** 就是貪吃的。

    🔴 病史(2026-09-07;`ship` 的 greedy-anchor 閘在收割鏈側擋下, 主視窗一字元修在 main):
       我在 `board-token-normalize.py:420` 寫了只排閉括號的貪吃字元類, 而**同檔其他 6 處都是 `[^⟦⟧]`**。
       差別:錨欄若有一個【孤兒 `⟦`】, 貪吃版會從那個孤兒一路吃到後面真錨的 `⟧`,
       **回傳一整段當「錨」**。
    🛑 **而真板上今天 0 列有孤兒 ⇒ 它是潛伏的** —— 兩種樣式在正常輸入上**輸出完全相同**,
       所以 selftest 全綠、肉眼看也一樣。**只有構造出孤兒才問得出差別。**
    ⇒ 📌 這一格與 `--ops` 是兩種病:那邊是「沒有東西守著」, 這邊是
       「**寫錯了而今天剛好看不出來**」。
    """
    out = []
    print('\n══ 貪吃錨樣式 ══')
    for p in paths:
        try:
            src = io.open(p, encoding='utf-8').read()
        except OSError:
            continue
        for m in ANCHOR_CLS.finditer(src):
            cls = m.group(1)
            ln = src[:m.start()].count('\n') + 1
            # 🔴 **本檔自己會命中兩次, 而兩次都是對的** —— 2026-09-07 全掃當場印出來:
            #    `:141` 是**故意造的負對照**(用串接組出來, 要有一個貪吃樣式才驗得出它抓不抓得到)
            #    `:161` 是 **docstring 在描述那個樣式**
            #    ⇒ 那正是本 repo traps 記過的「**禁某字面的閘, 自己不准含那字面**」。
            #    🛑 而我**不用「跳過本檔」來解決** —— 那樣以後這支檔真的寫錯就沒人抓。
            #    ✅ 判別:字元類裡含 `"` 或 `…`(串接的痕跡 / 省略號)⇒ 那是**在講**不是**在用**。
            if '⟦' not in cls and '"' not in cls and '…' not in cls:
                print(f'  🔴 {p}:{ln}  `[^{cls}]` ⇒ 應為 `[^⟦⟧]`')
                out.append((p, f':{ln} [^{cls}]', 'UNGUARDED'))
    if not out:
        print('  🟢 掃過的檔裡沒有貪吃錨樣式')
    return out


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
    print(f'\n══ {path} (--ops) ══')
    # 🔴 **這一段 `audit()` 有而本函式沒有**(code-reviewer 2026-09-07 抓到, 我複驗成立):
    #    少了它, `run_kind` 會對「查無自檢入口」的檔硬猜 `--selftest` 去跑
    #    ⇒ **重演本次要修的那個假陽性**;而 `return []`(不是 SKIP)讓那支檔
    #    連「量不到」都不會被列出來 —— **它從報表上直接消失**, 比誤報更難發現。
    fl = flag_of(path)
    if fl is None:
        print('  ⏸️  **我量不到這一支** —— 找不到自檢入口'
              f'(試過 {" / ".join(SELF_FLAGS)})⇒ **不是「沒有東西守著」**')
        return [(path, '(無自檢入口)', 'SKIP')]
    if fl != '--selftest':
        print(f'  🔵 它的自檢旗標是 `{fl}` ⇒ 本工具改餵它')
    base, kind = run_kind(path, fl)
    if base != 0:
        print(f'  ⏸️  **我量不到這一支** —— 它自己的 `{fl}` 正世界就 rc={base}'
              ' ⇒ **下面的判別無效**(而這不是「沒問題」)')
        return [(path, '(正世界非 0)', 'SKIP')]
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
            rc, kd = run_kind(tmp, fl)
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
    if not ops_mode:
        rows += audit_greedy(targets)
    bad = [r for r in rows if r[2] == 'UNGUARDED']
    skip = [r for r in rows if r[2] == 'SKIP']
    print(f'\n── 共掃 {len(rows)} 把尺 · 🔴 沒有東西守著 {len(bad)} 把 · '
          f'⏸️  我量不到 {len(skip)} 支 ──')
    if skip:
        print('   ⏸️  **「我量不到」不是「沒問題」** —— 那幾支我沒有驗過, 它們的狀態【未知】。')
        for p, n, _ in skip:
            print(f'      ⏸️  {p} {n}')
    for p, n, _ in bad:
        print(f'  🔴 {p} :: {n}')
    print('🔵 而「有東西守著」不代表守得對 —— 見檔頭「它答不出什麼」。')
    # 🔴 **rc 也要分三格**:0 = 掃過都有守 · 1 = 有沒守的 · **2 = 有我量不到的**
    #    少了 2, 「我量不到」與「全部通過」對任何讀 rc 的人是同一件事。
    sys.exit(1 if bad else (2 if skip else 0))
