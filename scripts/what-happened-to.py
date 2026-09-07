#!/usr/bin/env python3
"""
what-happened-to.py <錨> —— 把「這件事被做掉了嗎」拆成三格擺出來,**它不判斷**。

用法:  python3 scripts/what-happened-to.py b4-SHIPGATE1
       python3 scripts/what-happened-to.py --selftest

🔴 **它要解的是什麼**
   2026-09-02 逐列開檔驗 37 件清單時量到:`git log --grep=<錨>` 判給我 20 列「有人動過」,
   而開檔之後 **4 列的 commit 完全與那件事無關** —— 而那 4 個假陽性只來自 **2 顆 commit**
   (一顆 `401d8ba4` 就灌了 3 列)。
   📌 成因:`--grep` 讀的是 commit **訊息**,而它分不出【做它的】與【提到它的】。
   🛑 而那與我們今晚在推的「commit 訊息帶錨」是**同一條規矩** ——
      那條規矩讓「誰在做這件事」查得到,而同一條規矩讓「這件事被做掉了嗎」越查越不準。

🔴 **而它解不掉的三種載體**(2026-09-02 量到,寫在這裡免得下一個人以為這支工具蓋得住)
   ① 行號指到別的東西          —— 37 件清單的 160 個行號,0 個指對而 0 個會查無
   ② 路徑+數法指到一個空的地方 —— 白名單搬家 ⇒ 舊數法印 0,而那個 0 讀起來像「東西不見了」
   ③ 註解在別人做掉它的那一刻變假 —— `sweep-email-outbox.ts:803` 說「沒有在這一片修」,
      而修好它的碼就在它上面約 180 行
   🛑 共同點:**失效時都不會叫,只會印一個乾淨的東西**(一個數字 / 一句話 / 一個 0)。
   🎯 而 ②③ **甚至是有人做對事造成的**(一個正確的重構 / 一個正確的分工說明)。
   ⇒ **本支只把①那一族的『開檔』變便宜,②③ 它一格都看不到。**

🛑 **而有一個【很自然的判別法我試過,量到它是死的】—— 寫在這裡免得下一個人再發明一次**:
   想法:「錨如果**只出現在註解裡**,那就不是行為」⇒ 用「不在註解行的命中次數」當訊號。
   🔴 **2026-09-02 實測,兩個世界印同一個答案**:
     · 真的做它的 `b4-SHIPGATE1` ⇒ `sweep-email-outbox.ts` 共 4 次、**不在註解行 0 次**
       (`SupabaseEmailOutboxAdapter.ts` 1/0 · `IEmailOutbox.ts` 1/0)
     · 完全無關的 `b4-NEWAPI1` ⇒ `board-dispatch-triage.py` 共 1 次、**不在註解行 0 次**
   📌 **成因:錨【本來就都住在註解裡】** —— 它是給人看的標記,不是識別字。
   🎯 **⇒ 所以那個訊號對兩個世界印同一個東西 ⇒ 零判別力 ⇒ 已移除。**
   🔵 **而抓到它的是本支自己的 `--selftest`** —— 我為「真的做它」造的那個世界,
      **它的錨也在註解裡** ⇒ 那一格紅了 ⇒ 我才回去量真的案子。
"""
import subprocess, sys, os, re, tempfile, shutil, io

SINCE = "2026-08-20"

def sh(*a, cwd=None):
    return subprocess.run(a, capture_output=True, text=True, cwd=cwd).stdout

def report(anchor, cwd=None):
    """回 (commits, rows) —— rows = [(hash, subj, [(file, 該檔今天含該錨幾次)])]"""
    out = sh("git", "log", "--format=%h\t%s", f"--since={SINCE}", "--grep", anchor, cwd=cwd)
    rows = []
    for line in out.strip().split("\n"):
        if not line.strip():
            continue
        h, _, subj = line.partition("\t")
        names = [n for n in sh("git", "show", "--name-only", "--format=", h, cwd=cwd).split("\n") if n.strip()]
        nondocs = [n for n in names if not n.startswith("docs/") and not n.startswith('"docs/')]
        files = []
        for f in nondocs:
            base = cwd or "."
            path = os.path.join(base, f)
            cnt = 0
            incode = 0
            if os.path.isfile(path):
                try:
                    txt = open(path, encoding="utf-8", errors="replace").read()
                    cnt = txt.count(anchor)
                    # 🔴 分開【註解】與【碼】—— 2026-09-02 實測:一顆完全無關的 commit 動的那支檔
                    #    裡面也有這個錨(是一句註解)⇒ 只印「含 N 次」會替它背書。
                    for ln in txt.split("\n"):
                        if anchor not in ln:
                            continue
                        st = ln.lstrip()
                        if st.startswith(("//", "#", "*", "/*", "--", "<!--")):
                            continue
                        incode += ln.count(anchor)
                except OSError:
                    cnt = -1
            else:
                cnt = -2          # 檔案今天已經不在
            files.append((f, cnt, incode))
        rows.append((h, subj, files))
    return rows

FOOT = """
────────────────────────────────────────────────────────────
🛑 **這支工具把【開檔】變便宜,不是變成不必要。沒帶錨的 commit 它一樣看不到。**
   · 命中 ⇒ 那顆 commit 的訊息提到這個錨。**它不代表那顆 commit 在做這件事。**
   · 「該檔今天含幾次」= 0 ⇒ 那顆 commit 很可能只是**訊息裡提到它** ⇒ 假陽性的訊號
   · 「該檔今天含幾次」> 0 ⇒ 值得開檔 —— **而開檔還是要你自己去。**
   · 🔴 **而「含 N 次」不是背書** —— 2026-09-02 實測:一顆與那件事**完全無關**的 commit
     動的那支檔,裡面也有那個錨(`board-dispatch-triage.py` 含 `b4-NEWAPI1` 1 次)。
     ⇒ **本支原本印 `✅`,而那是在替它背書** ⇒ 已改成 `🟡`。
   · `(檔案今天不在)` ⇒ 它被刪了或搬走了 ⇒ **不要讀成「沒做」**
🔴 **而它答不出這四種的差別**(2026-09-02 量到,四種在 `git log` 上長得一模一樣):
   ①修好了 ②讓它看得見(而它還在發生)③把入口關掉(而它還在那裡)④決定改在別的地方解
   ⇒ ④的證據常常只有一句註解 ⇒ **本支會把它印成「0 次」,而那不是「沒做」。**
"""

BOARD_PATH = 'docs/launch-todo.md'
TAIL_CHARS = 700
_CELL = re.compile(r'(?<!\\)\|')
_ANC = re.compile(r'⟦[^⟦⟧]+⟧')


def print_board_tail(anchor, board=None, ncap=TAIL_CHARS):
    """先印那一列的【末格尾端】—— 因為那裡是最新的, 而它也最長 ⇒ 最容易只讀開頭。

    🔴 **成因是一次真的重工**(2026-09-07 tidy):為了做 `⟦f3-ALLOWLISTMANUAL1⟧` 那一列,
       **開了那一列而讀的是開頭** ⇒ 花 40 分鐘做了一支閘,
       **而答案寫在那一列末格的尾端**(逐字「從今天起會被擋在 commit 之前」),
       那道閘 40 分鐘前就有人做好並接進 `.husky/pre-commit`。
    🛑 **本段【不是】答案** —— 它答「板上那一列現在寫什麼」, 答不出「做完了沒」。
       回 True = 有印, False = 查無(而**查無要說出來**, 不能安靜跳過)。
    """
    path = board or BOARD_PATH
    tok = anchor if anchor.startswith('⟦') else '⟦%s⟧' % anchor
    try:
        lines = io.open(path, encoding='utf-8').read().split('\n')
    except OSError:
        print('  ⏸️  讀不到板檔 %s ⇒ 不印板列(**不是「板上沒有這一列」**)\n' % path)
        return False
    for n, line in enumerate(lines, 1):
        if not line.startswith('| '):
            continue
        c = _CELL.split(line)
        if len(c) < 3:
            continue
        m = _ANC.search(c[2])
        if not m or m.group(0) != tok:
            continue
        cells = [x for x in c if x.strip()]
        last = cells[-1].strip() if cells else ''
        if len(line) <= ncap:
            print('  ── 🟢 **板上那一列(最新;僅 %d 字元 ⇒ 不另印尾端)** :%d ──' % (len(line), n))
            print('     ' + line)
        else:
            print('  ── 🟢 **板上那一列的末格尾端(最新)** :%d —— 先讀這裡, 不要只讀開頭 ──' % n)
            print('     ' + last[-ncap:])
        print()
        return True
    print('  ⏸️  板上【錨欄】查無 %s ⇒ 不印板列(而這不是「這件事不存在」)\n' % tok)
    return False


def emit(anchor, rows):
    print(f"########## what-happened-to: {anchor}  (git log --since={SINCE}) ##########\n")
    # 🔴 板列的末格【先出場】—— 見 print_board_tail 那段成因
    print_board_tail(anchor)
    if not rows:
        print("  訊息裡提到這個錨的 commit:0 顆")
        print("  🛑 而【0】只代表『沒有人在 commit 訊息裡提到它』——")
        print("     它看不到:①還在讀碼沒動筆的 ②動了筆而沒帶錨的 ③在別的 repo 的")
        print("     ⚠️ 而如果這個錨是【最近才鑄的】,那個 0 是【結構上保證】的,不是證據。")
        print(FOOT); return
    print(f"  訊息裡提到這個錨的 commit:{len(rows)} 顆\n")
    for h, subj, files in rows:
        print(f"  ── {h}  {subj[:64]}")
        if not files:
            print("       (這顆只動 docs/ ⇒ 零非 docs 檔)")
            continue
        for f, c, ic in files:
            if c in (-2, -1):
                mark = {-2: "(檔案今天不在)", -1: "(讀不到)"}[c]
            elif c == 0:
                mark = "🔴 該檔今天含此錨 0 次 ⇒ 可能只是訊息提到"
            else:
                mark = f"🟡 該檔今天含此錨 {c} 次 ⇒ **值得開檔,而這不是背書**"
            print(f"       {f}   {mark}")
        print()
    print(FOOT)

# ───────── selftest ─────────
def selftest():
    # 🔴🔴 **第一件事:剝掉繼承來的 git 環境。**(2026-09-02 實測,不是預防)
    #   那道 `scripts/selftest-git-isolation-gate.sh` 跑本支時會設
    #   `GIT_DIR` / `GIT_INDEX_FILE` 指向一棵【受害者】的 repo,而 cwd 留在真的 repo。
    #   🛑 而 `GIT_DIR` / `GIT_INDEX_FILE` 的優先權【比 `git -C <路徑>` 高】
    #      ⇒ 本支 selftest 裡每一發 `git`(**包含帶 `-C` 的**)都會去讀寫受害者的 repo。
    #   **實測(修之前,`-f3` 自己重現)**:受害者 `ls-files|status` 從 `1|0` ⇒ `3|4`,而 `rc=1`。
    #   🔵 **一次剝乾淨,不要逐發包** —— `-15` 今晚逐點突變量到:
    #      只覆蓋 6 個呼叫點裡的 4 個時,那道閘底下**仍然全綠**(一個只修對一半的修法看不出來)。
    for _k in ("GIT_DIR", "GIT_INDEX_FILE", "GIT_WORK_TREE", "GIT_OBJECT_DIRECTORY",
               "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_COMMON_DIR", "GIT_NAMESPACE"):
        os.environ.pop(_k, None)
    tmp = tempfile.mkdtemp(prefix="wht-")
    ok = True
    def chk(name, got, want):
        nonlocal ok
        good = got == want
        ok = ok and good
        print(f"  {'✅' if good else '🔴'} {name}: got={got!r} want={want!r}")
    try:
        g = lambda *a: subprocess.run(a, cwd=tmp, capture_output=True, text=True)
        g("git", "init", "-q")
        g("git", "config", "user.email", "t@t"); g("git", "config", "user.name", "t")
        g("git", "config", "commit.gpgsign", "false")
        os.makedirs(os.path.join(tmp, "src"))
        # 世界 A:一顆【真的做它】的 commit —— 碼裡含那個錨
        open(os.path.join(tmp, "src/real.ts"), "w").write("// ⟦zz-REAL⟧ 這裡真的在做它\nexport const a = 1;\n")
        g("git", "add", "-A"); g("git", "commit", "-q", "-m", "feat: 做掉 zz-REAL")
        # 世界 B:一顆【只是提到】的 commit —— 碼裡不含那個錨
        open(os.path.join(tmp, "src/other.ts"), "w").write("export const b = 2;\n")
        g("git", "add", "-A"); g("git", "commit", "-q", "-m", "fix: 順手提到 zz-REAL 而沒做它")
        # 世界 C:只動 docs
        os.makedirs(os.path.join(tmp, "docs"))
        open(os.path.join(tmp, "docs/x.md"), "w").write("zz-REAL\n")
        g("git", "add", "-A"); g("git", "commit", "-q", "-m", "docs: 記 zz-REAL")

        rows = report("zz-REAL", cwd=tmp)
        chk("三顆都被 --grep 撈到", len(rows), 3)
        by = {h: files for h, s, files in rows}
        real = [f for h, s, f in rows if s.startswith("feat")][0]
        ment = [f for h, s, f in rows if s.startswith("fix")][0]
        docs = [f for h, s, f in rows if s.startswith("docs")][0]
        chk("🟢 真的做它的 ⇒ 該檔含錨 >0", real[0][1] > 0, True)
        # 🔴 刻意【不】斷言「真的做它的 ⇒ 不在註解的次數 >0」——
        #    2026-09-02 實測那個訊號零判別力(見檔頭)。這裡改成釘住【它是死的】,
        #    免得下一個人把它加回來:兩個世界都應該是 0。
        chk("🛑 死訊號 · 真的做它的 ⇒ 不在註解行 0 次", real[0][2], 0)
        chk("🔴 只是提到的 ⇒ 該檔含錨 == 0", ment[0][1], 0)
        chk("docs-only ⇒ 零非 docs 檔", len(docs), 0)
        # 負對照:一個從來不存在的錨
        chk("🔵 負對照(現造錨)⇒ 0 顆", len(report("zzq" + str(os.getpid()) + "nosuch", cwd=tmp)), 0)
        # 世界 D2:錨【只出現在註解裡】的檔(這正是 2026-09-02 那個假陽性的形狀)
        open(os.path.join(tmp, "src/onlycomment.ts"), "w").write("// ⟦zz-REAL⟧ 只是一句註解提到它\nexport const c = 3;\n")
        g("git", "add", "-A"); g("git", "commit", "-q", "-m", "chore: 註解裡提 zz-REAL")
        rows_c = report("zz-REAL", cwd=tmp)
        oc = [(c, ic) for h, s, f in rows_c for n, c, ic in f if n == "src/onlycomment.ts"]
        chk("🛑 死訊號 · 只在註解裡 ⇒ 也是 (1, 0) ⇒ 與上一格【同一個答案】", oc[0] if oc else None, (1, 0))

        # 世界 D:檔案被刪掉
        os.remove(os.path.join(tmp, "src/real.ts"))
        g("git", "add", "-A"); g("git", "commit", "-q", "-m", "chore: 刪掉 zz-REAL 那支檔")
        rows2 = report("zz-REAL", cwd=tmp)
        gone = [c for h, s, f in rows2 for n, c, _ in f if n == "src/real.ts"]
        chk("🟢 檔案今天不在 ⇒ 印 -2 而不是 0", -2 in gone, True)
        # ── 板列末格先出場(2026-09-07 主視窗令;成因見 print_board_tail 檔內那段)──
        #   🔴 這四格**走真的 `print_board_tail`**, 不在這裡重算判準。
        import contextlib
        _bd = os.path.join(tmp, 'board.md')
        _long = '長' * 900
        io.open(_bd, 'w', encoding='utf-8').write('\n'.join([
            '| 態 | 錨 | 事 | 誰 | x |', '|---|---|---|---|---|',
            '| open | ⟦zz-LONG⟧ | 甲 | 誰 | ⟨擋⟩ ' + _long + ' 尾巴那句話 |',
            '| open | ⟦zz-SHORT⟧ | 乙 | 誰 | ⟨擋⟩ 短 |']) + '\n')
        _b = io.StringIO()
        with contextlib.redirect_stdout(_b):
            _r1 = print_board_tail('zz-LONG', board=_bd)
        _o1 = _b.getvalue()
        chk("🟢 長列 ⇒ 印末格尾端", '末格尾端' in _o1, True)
        chk("🟢 而尾端要真的含【尾巴】那句(不是開頭)", '尾巴那句話' in _o1, True)
        chk("🔵 長列 ⇒ 不走短列那一支", '不另印尾端' in _o1, False)
        _b2 = io.StringIO()
        with contextlib.redirect_stdout(_b2):
            print_board_tail('zz-SHORT', board=_bd)
        chk("🔵 短列 ⇒ 只印整列, 明說不另印尾端", '不另印尾端' in _b2.getvalue(), True)
        _b3 = io.StringIO()
        with contextlib.redirect_stdout(_b3):
            _r3 = print_board_tail('zzq' + str(os.getpid()) + 'nosuch', board=_bd)
        chk("🛑 錨欄查無 ⇒ 要【說出來】而不是安靜跳過", '錨欄】查無' in _b3.getvalue(), True)
        chk("🛑 而它回 False(與有印的 True 分得開)", (_r1, _r3), (True, False))
        # 🔴🔴 **接線那一半要另外一格** —— 上面五格直接叫 `print_board_tail`,
        #    把 `emit()` 裡那一行呼叫拿掉之後**它們照樣全綠**(2026-09-07 突變實測)。
        #    📌 一道守門有兩個分母:**它答得對嗎 / 它會被叫嗎** —— 兩個要分別有格。
        _old_board = BOARD_PATH
        _b4 = io.StringIO()
        try:
            globals()['BOARD_PATH'] = _bd
            with contextlib.redirect_stdout(_b4):
                emit('zz-LONG', [])
        finally:
            globals()['BOARD_PATH'] = _old_board
        chk("🔴 端到端 emit() 真的有叫板列那一段(接線有守)",
            '末格尾端' in _b4.getvalue(), True)
        chk("🔵 而它排在 commit 那段【之前】",
            _b4.getvalue().index('末格尾端') < _b4.getvalue().index('訊息裡提到'), True)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    print("\n" + ("✅ selftest 全過" if ok else "🔴 selftest 有紅"))
    return 0 if ok else 1

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(2)
    if sys.argv[1] == "--selftest":
        sys.exit(selftest())
    a = sys.argv[1].strip("⟦⟧")
    emit(a, report(a))
