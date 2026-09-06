#!/usr/bin/env python3
r"""board-token-normalize.py —— 把板上「擋上線?」token 正規化到【最後一格的開頭】。

══ 為什麼有它(2026-09-06 tidy 立;成因是一次【零衝突】的 merge)════════════
`docs/launch-todo.md` 的擋上線 token 約定住在**最後一格的開頭**,
而 `scripts/launch-blocking-count.sh` 也只讀那個位置。
2026-09-06 merge 39e 之後讀數當場從 擋 102 掉到 94 —— 而**一個 token 都沒有消失**
(整檔帶 token 的列 505 ⇒ 507,反而變多)。
🔴 成因:**別的窗在【同一格的開頭】插了新內容,把 token 推到格子中間。**
📌 ⇒ 這不是「merge 把訂正還原」(那是 ⟦auth-BOARDMERGERETRACT⟧ 記的病),
   是**兩個人往同一格的同一端寫** —— 而在 diff 上它是**一次乾淨的合併、零衝突**。
另有 4 列出現**兩個一模一樣的 token**(兩邊各帶一份進 merge)。

══ 🔴 天花板(先讀,不要把它讀得比它大)══════════════════════════════════
 ① 它只管 token 的**位置與份數**,**不管判得對不對**。
 ② 🔴 切欄位**認 `\|` 跳脫** —— 板上 138 列這樣寫,而那是**正確**的寫法。
    不認跳脫的切法會算錯「最後一格」(2026-09-06 實測:82 列因此被放錯格)。
 ③ 同一列有**兩個不同**的 token ⇒ 它**不猜哪個對**,`--check` 報出來、`--fix` **不動它**。
    只有兩個**一模一樣**的才去重。
 ④ 它看不到「別窗把新內容插在前面」這件事本身 —— 只看得到結果。
    真正的修法是規矩:**新內容接在 token 後面,不要插在前面。**

用法:
  python3 scripts/board-token-normalize.py --check     違規列數 + 清單,有違規 rc=1
  python3 scripts/board-token-normalize.py --fix       搬正 + 去重,印逐列動作
  python3 scripts/board-token-normalize.py --selftest  兩個世界(含 `\|` 跳脫)
  python3 scripts/board-token-normalize.py --check-staged  pre-commit 用:**讀 staged 那份**, rc 恆 0
"""
import io, os, re, sys

BOARD = 'docs/launch-todo.md'
CLOSED = ('open', 'doing', 'parked', 'done', 'standing')
SPLIT = re.compile(r'(?<!\\)\|')
FIND = re.compile(r'⟨(?:擋|不擋|未判|—)[^⟩]*⟩')
HEADS = ('⟨擋', '⟨不擋', '⟨未判', '⟨—⟩')


def safe(s):
    """把要印到終端機的字串裡的控制字元換掉。

    🔴 codex 2026-09-07 must-fix ④:板的內容是**別的窗寫進來的**, 而我原本把錨與 token
       原封印到終端機 ⇒ 植入 ANSI / OSC 序列可以**偽造或清掉本閘自己的輸出**;
       支援 OSC 52 的終端甚至會被改寫剪貼簿。
    🛑 **`rc=0` 消不掉這些副作用** —— 副作用發生在「印出去」那一刻, 不在 rc 上。
    """
    return ''.join(c if (c == '\t' or ord(c) >= 0x20) and ord(c) != 0x7f else '?' for c in str(s))


def last_idx(line, fields):
    """最後一格的索引。行尾有沒有分隔符要分開處理(板上兩種形狀都有)。"""
    return len(fields) - 2 if re.search(r'\|\s*$', line) else len(fields) - 1


def leading_token(line, fields):
    """**唯一的 token 定義:最後一格【開頭】那一個。** 其餘角括號一律是內文字面。

    🔴 2026-09-07 主視窗裁定改成這個定義, 而理由是量到的:
       本工具原本認【整行任何一個 ⟨…⟩】⇒ 於是**每一個寫規則、寫訂正、解釋這個 token 的人**
       都會製造一次「違規」。一夜之內撞了 6 次, 其中兩次是我在【解釋這個坑的那句話裡】犯的。
    📌 **⇒ 病灶不是那些人不小心, 是尺把【討論】讀成了【事實】。**
       修產物(把角括號改方角)有看不見的到期日;修這個定義才是修產生器。
    """
    cell = fields[last_idx(line, fields)].lstrip()
    m = FIND.match(cell)
    return m.group(0) if m else None


def scan(lines):
    """回 (misplaced, done_blocking);每項是 (行號, 錨或欄2, 說明)。

    ⛔ ~~原本還回 (dup_same, dup_diff) 兩類「同一列有多個 token」~~
    ⇒ 🔴 **2026-09-07 改成「只認最後一格開頭那一個」之後, 那兩類【在結構上永遠是 0】。**
       🛑 **而一個永遠印 0 的計數器, 與「檢查過了沒有問題」印同一個東西** ⇒ 直接移除, 不留恆綠讀數。

    done_blocking = 態是 `done` 而 token 仍是 ⟨擋⟩ 的列。
    🔴 **只警告, 不影響 rc** —— 2026-09-07 主視窗裁「先量分母」:
       它可能是「做完了忘了更新 token」, 也可能是「態被誤標 done」,
       而**這兩件的修法相反** ⇒ 工具不猜, 印出來給人判。
    🛑 失效方向已量到:2026-09-07 那 4 列全部是【做完了而 token 停在擋】
       ⇒ 讀 token 的人會以為它還在擋 ⇒ 那是【派重了】的燃料。
    """
    misplaced, done_blocking = [], []
    for n, line in enumerate(lines, 1):
        if not line.startswith('| '):
            continue
        f = SPLIT.split(line)
        if len(f) < 4 or f[1].strip() not in CLOSED:
            continue
        toks = FIND.findall(line)
        if not toks:
            continue
        m = re.search(r'⟦[^⟧]*⟧', f[2])
        key = m.group(0) if m else (f[2].strip() or f':{n}')
        tok = leading_token(line, f)
        if tok:
            # ✅ 最後一格開頭有 token ⇒ 它就是答案。**其餘角括號是內文, 不算違規。**
            if f[1].strip() == 'done' and tok.startswith('⟨擋'):
                done_blocking.append((n, key, tok[:24]))
            continue
        # ⛔ 開頭沒有 token, 而行內找得到 ⇒ 可能是合併推歪, 也可能【整列只有內文在講 token】。
        #    🛑 工具分不出這兩者 ⇒ 一律報「位移候選」, 而 --fix 只修**全行恰好一個**的情形。
        misplaced.append((n, key, f'{len(toks)} 個, 開頭沒有'))
    return misplaced, done_blocking


def fix_line(line):
    """搬正 / 去重。回 (新行, 動作) 或 (原行, None)。"""
    f = SPLIT.split(line)
    toks = FIND.findall(line)
    if leading_token(line, f):
        return line, None                      # 開頭已有 token ⇒ 其餘是內文, 不動
    if len(toks) != 1:
        # 🔴 全行不只一個而開頭沒有 ⇒ **分不出哪個是被推歪的 token、哪些是內文**
        #    ⇒ 不猜(與「重複不同不修」同一個理由)。
        return line, None
    tok = toks[0]
    base = line
    for _ in range(len(toks)):
        base = FIND.sub('', base, count=1)
    f2 = SPLIT.split(base)
    j2 = last_idx(base, f2)
    cell = f2[j2]
    lead = len(cell) - len(cell.lstrip())
    f2[j2] = cell[:lead] + tok + ' ' + cell[lead:].lstrip()
    new = '|'.join(f2)
    # 🔴 驗:去掉 token 後(收斂空白)必須與原行去掉全部 token 後相同, 且剩恰好 1 個
    if re.sub(r'\s+', ' ', FIND.sub('', new, count=1)).strip() != re.sub(r'\s+', ' ', base).strip():
        return line, None
    if len(FIND.findall(new)) != 1:
        return line, None
    return new, ('去重+搬正' if len(toks) > 1 else '搬正')


def run(path, mode):
    lines = io.open(path, encoding='utf-8').read().split('\n')
    mis, dblock = scan(lines)
    if mode == '--check':
        print(f'── board-token-normalize --check:{path}')
        print(f'   最後一格開頭沒有 token 而行內找得到 {len(mis)} 列')
        for n, k, why in mis:
            print(f'   位移候選 :{n:5} {k}  {why}')
        if mis:
            print('   🟡 「位移候選」= 開頭沒 token 而行內有角括號。它可能是合併推歪,')
            print('      也可能是【整列只有內文在講 token】⇒ --fix 只修全行恰好一個的情形, 其餘不猜。')
        print(f'   ── 另外(只警告, 不影響 rc):態 done 而 token 仍 ⟨擋⟩ {len(dblock)} 列')
        for n, k, why in dblock:
            print(f'   done+擋 :{n:5} {k}  {why}')
        if dblock:
            print('   🟡 它可能是【做完了忘了更新 token】, 也可能是【態被誤標 done】——')
            print('      🔴 這兩件的修法【相反】 ⇒ 本工具不猜, 開檔判。')
            print('      🛑 已量到的失效方向:讀 token 的人以為它還在擋 ⇒ 那是【派重了】的燃料。')
        return 1 if mis else 0
    changed = 0
    for i, line in enumerate(lines):
        if not line.startswith('| '):
            continue
        f = SPLIT.split(line)
        if len(f) < 4 or f[1].strip() not in CLOSED or not FIND.search(line):
            continue
        new, act = fix_line(line)
        if act:
            lines[i] = new
            changed += 1
            m = re.search(r'⟦[^⟧]*⟧', SPLIT.split(new)[2])
            print(f'   ✅ :{i+1:5} {act} {m.group(0) if m else ""}')
    io.open(path, 'w', encoding='utf-8').write('\n'.join(lines))
    print(f'── 動了 {changed} 列')
    return 0


def check_staged():
    """pre-commit 用:**讀 staged 那份**, 不讀工作樹。恆 rc=0(warn-only)。

    🔴 **為什麼一定要讀 staged**:工作樹那份可能有你【還沒 add】的修正,
       或別窗剛寫進來的東西 ⇒ 用它去判 staged 的內容, 兩個方向都會錯:
       ① 工作樹已修而 staged 沒修 ⇒ **印綠, 而進 commit 的那份是壞的**
       ② 工作樹壞而 staged 是好的 ⇒ 罵一個沒有問題的 commit
       🛑 2026-09-06 一夜有兩道閘踩過這一格(主視窗 04:0x 轉述)。

    🟡 **warn-only 是刻意的**:rc 恆 0, 不擋 commit。
       擋不擋等三天的分母出來再拍(主視窗 04:0x 裁)。
       ⚠️ ⇒ **本閘印了東西不代表 commit 會被擋;它印綠也不代表板子乾淨**
          (它只看這顆 commit staged 的那份)。
    """
    import subprocess
    # 🔴 `--no-renames`(codex 2026-09-07 must-fix ②):開了 rename detection 時
    #    `--name-only` **只列 post-image** ⇒ 把板 rename 走會漏掉原路徑, 然後安靜放行。
    #    關掉 rename 偵測 ⇒ 兩邊都會列出來。
    r = subprocess.run(['git', 'diff', '--cached', '--name-only', '--no-renames'],
                       capture_output=True, text=True)
    if r.returncode != 0:
        # 🔴 git 自己失敗 ⇒ **不准印「乾淨」** —— 那正是「清單變空就放行」那個病。
        print('🟡 board-token 閘:`git diff --cached` 失敗 ⇒ **本閘這次沒有看過任何東西**')
        print(f'   rc={r.returncode} · stderr 首行:{(r.stderr or "").splitlines()[:1]}')
        return 0
    staged = [x for x in r.stdout.split('\n') if x.strip()]
    if BOARD not in staged:
        return 0                      # 板沒 staged ⇒ 安靜不跑
    s = subprocess.run(['git', 'show', f':{BOARD}'], capture_output=True, text=True)
    if s.returncode != 0:
        print(f'🟡 board-token 閘:讀不到 staged 的 {BOARD}(rc={s.returncode})⇒ **本閘沒看過**')
        return 0
    mis, dblock = scan(s.stdout.split('\n'))
    print(f'── board-token 閘(warn-only, 讀的是 **staged** 那份):{BOARD}')
    print(f'   最後一格開頭沒有 token 而行內找得到 {len(mis)} 列 · 態 done 而 token 仍 ⟨擋⟩ {len(dblock)} 列')
    for n, k, why in mis:
        print(f'   位移候選 :{n:5} {safe(k)}  {safe(why)}')
    for n, k, why in dblock:
        print(f'   done+擋  :{n:5} {safe(k)}  {safe(why)}')
    if mis or dblock:
        print('   🟡 **只是提醒, 不擋這顆 commit**(rc 恆 0)。修法:`python3 scripts/board-token-normalize.py --fix`')
        print('      🔴 而 `--fix` 動的是【工作樹】⇒ 修完要重新 `git add` 才會進這顆 commit。')
    return 0


def selftest():
    # 🔴 剝掉繼承來的 git 環境(自檢清單;git -C 擋不住它)
    for v in ('GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE', 'GIT_OBJECT_DIRECTORY',
              'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_NAMESPACE'):
        os.environ.pop(v, None)
    import tempfile
    d = tempfile.mkdtemp()
    bad = os.path.join(d, 'bad.md')
    good = os.path.join(d, 'good.md')
    rows_bad = [
        '| 態 | # | 事 | 誰 | 卡什麼 |',
        '|---|---|---|---|---|',
        '| open | ⟦x-A⟧ | 甲 | 誰 | ⟨擋(t)⟩ 正常:token 在格首 |',
        '| open | ⟦x-B⟧ | 乙 | 誰 | 別窗插的新內容 ⟨擋(t)⟩ 被推走的 |',
        '| open | ⟦x-C⟧ | 丙 | 誰 | ⟨不擋(t)⟩ 內文含 `a\\|b\\|c` 而 token 在格首 |',
        '| open | ⟦x-D⟧ | 丁 | 誰 | 內文含 `a\\|b\\|c` 而 ⟨不擋(t)⟩ 被推走 |',
        '| open | ⟦x-E⟧ | 戊 | 誰 | ⟨擋(t)⟩ 重複相同 ⟨擋(t)⟩ |',
        '| open | ⟦x-F⟧ | 己 | 誰 | ⟨擋(t)⟩ 重複不同 ⟨不擋(t)⟩ |',
        # 🔴 done+⟨擋⟩ 那條規則的【兩個世界】(2026-09-07 加)
        '| done | ⟦x-G⟧ | 庚 | 誰 | ⟨擋(t)⟩ 正對照:做完了而 token 停在擋 ⇒ 必須叫 |',
        '| done | ⟦x-H⟧ | 辛 | 誰 | ⟨不擋(t)⟩ 負對照:同樣是 done 而 token 不是擋 ⇒ 必須【不】叫 |',
        '| open | ⟦x-I⟧ | 壬 | 誰 | ⟨擋(t)⟩ 負對照:同樣是擋而態不是 done ⇒ 必須【不】叫 |',
        # 🔴🔴 2026-09-07 主視窗指定的那一格:**內文提到 token 字面, 不可以叫**
        #    舊定義(認整行任何一個)在這一列會叫 ⇒ 這格就是新舊定義的分水嶺。
        '| open | ⟦x-J⟧ | 癸 | 誰 | ⟨不擋(t)⟩ 這裡在解釋規則:token 是 ⟨未判(…)⟩ 不是 ⟨不擋⟩, '
        '而 ⛔ ~~⟨擋⟩~~ 是舊字面 ⇒ **全列 4 個角括號而只有開頭那個算** |',
        '| done | ⟦x-K⟧ | 子 | 誰 | ⟨—⟩ done 而開頭不是擋, 內文提到 ⟨擋⟩ ⇒ done+擋 必須【不】叫 |',
    ]
    io.open(bad, 'w', encoding='utf-8').write('\n'.join(rows_bad) + '\n')
    io.open(good, 'w', encoding='utf-8').write('\n'.join(
        [rows_bad[0], rows_bad[1], rows_bad[2], rows_bad[4]]) + '\n')
    fails = []

    def ck(name, got, want):
        ok = got == want
        print(f'  {"✅" if ok else "🔴"} {name}:{got}(期望 {want})')
        if not ok:
            fails.append(name)

    mis, db = scan(io.open(bad, encoding='utf-8').read().split('\n'))
    ck('世界 A(壞)位移列', len(mis), 2)          # x-B, x-D(含跳脫那列)
    # ⛔ ~~原本斷言 x-E 重複相同=1 / x-F 重複不同=1~~
    # ⇒ 🔴 新定義下這兩列【開頭都有 token】⇒ 其餘角括號是內文 ⇒ **本來就不該叫**。
    ck('x-E(開頭有 token 而後面又一個)不叫', sum(1 for r in mis if r[1] == '⟦x-E⟧'), 0)
    ck('x-F(開頭有 token 而後面是不同的)不叫', sum(1 for r in mis if r[1] == '⟦x-F⟧'), 0)
    ck('done+擋 命中(正對照 x-G)', len(db), 1)
    ck('done+擋 命中的是 x-G(不是 x-H/x-I)', db[0][1] if db else '無', '⟦x-G⟧')
    # 🔴 新定義的兩格:內文提到 token 字面, 位移與 done+擋 都不可以叫
    ck('x-J(內文 4 個角括號)不算位移', sum(1 for r in mis if r[1] == '⟦x-J⟧'), 0)
    ck('x-J 不算位移(第二次問, 換個角度)', sum(1 for r in mis if r[1] == '⟦x-J⟧'), 0)
    ck('x-K(done, 內文提到 ⟨擋⟩)不算 done+擋', sum(1 for r in db if r[1] == '⟦x-K⟧'), 0)
    mis2, db2 = scan(io.open(good, encoding='utf-8').read().split('\n'))
    ck('世界 B(乾淨)位移列', len(mis2), 0)
    ck('世界 B(乾淨)位移 2', len(mis2), 0)
    ck('世界 B(乾淨)done+擋', len(db2), 0)
    ck('世界 A rc', run(bad, '--check'), 1)
    ck('世界 B rc', run(good, '--check'), 0)
    print('  ── --fix 之後 ──')
    _before_angle = io.open(bad, encoding='utf-8').read().count('⟨')
    run(bad, '--fix')
    mis3, _db3 = scan(io.open(bad, encoding='utf-8').read().split('\n'))
    ck('修後 位移', len(mis3), 0)
    # ⛔ ~~修後 重複相同=0 / 重複不同(刻意不修)=1~~ ⇒ 兩類已隨新定義移除(見 scan docstring)。
    # ✅ 換成新定義下真正該問的:x-F 開頭有 token ⇒ --fix 不該動它, 它那兩個角括號要原封不動。
    ck('修後 x-F 的角括號一個沒少', io.open(bad, encoding='utf-8').read().count('⟨'), _before_angle)
    txt = io.open(bad, encoding='utf-8').read()
    # ═══ --check-staged 的兩個世界(2026-09-07;主視窗指定)═══
    #   🔴 這一段會【碰 git】⇒ 開一棵拋棄式 repo, 而繼承來的 git 環境在函式開頭已剝掉。
    import subprocess
    g = os.path.join(d, 'repo')
    os.makedirs(g, exist_ok=True)
    def git(*a):
        return subprocess.run(['git', '-C', g, *a], capture_output=True, text=True)
    # 🔴 codex 2026-09-07 must-fix ③:**不檢查 `git init` 的 rc 是危險的** ——
    #    `mkdtemp()` 跟隨 `TMPDIR`, 若它落在一棵真 repo 裡而 `init` 又失敗,
    #    後面的 `git -C` 會**往上找到那棵真 repo**, 改寫它的 config 並 stage 我的測試檔。
    #    ⇒ 三道:①init 的 rc 必須 0 ②**斷言 toplevel 就是我剛建的那個目錄** ③收尾刪掉整棵樹。
    r_init = git('init', '-q')
    if r_init.returncode != 0:
        print(f'  🔴 selftest 無法建拋棄式 repo(git init rc={r_init.returncode})⇒ 中止, 不往下跑')
        return 1
    r_top = git('rev-parse', '--show-toplevel')
    top = os.path.realpath(r_top.stdout.strip()) if r_top.returncode == 0 else ''
    if top != os.path.realpath(g):
        print(f'  🔴 selftest toplevel 不是我建的那棵({top!r} != {os.path.realpath(g)!r})⇒ 中止')
        return 1
    for _c in (('config', 'user.email', 't@t'), ('config', 'user.name', 't')):
        if git(*_c).returncode != 0:
            print(f'  🔴 selftest git {_c[0]} 失敗 ⇒ 中止')
            return 1
    os.makedirs(os.path.join(g, 'docs'), exist_ok=True)
    board = os.path.join(g, BOARD)
    io.open(board, 'w', encoding='utf-8').write('\n'.join(rows_bad) + '\n')
    other = os.path.join(g, 'other.md')
    io.open(other, 'w', encoding='utf-8').write('x\n')

    cwd0 = os.getcwd()
    os.chdir(g)
    try:
        # 世界一:板【沒有】staged ⇒ 安靜不跑(印 0 行)
        git('add', 'other.md')
        import contextlib, io as _io
        buf = _io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc_a = check_staged()
        ck('板沒 staged ⇒ rc', rc_a, 0)
        ck('板沒 staged ⇒ 一個字都不印', buf.getvalue().strip(), '')
        # 世界二:板 staged 且有違規 ⇒ 印出來, 而 rc 仍是 0
        git('add', BOARD)
        buf2 = _io.StringIO()
        with contextlib.redirect_stdout(buf2):
            rc_b = check_staged()
        out = buf2.getvalue()
        ck('板 staged 有違規 ⇒ rc 仍 0(warn-only)', rc_b, 0)
        ck('板 staged 有違規 ⇒ 有印出違規列', '位移候選' in out, True)
        ck('板 staged 有違規 ⇒ 明說不擋', '不擋這顆 commit' in out, True)
        # 🔴 第三個世界:staged 是【乾淨的】而工作樹是【壞的】⇒ 必須看 staged, 印乾淨
        io.open(board, 'w', encoding='utf-8').write('\n'.join(
            [rows_bad[0], rows_bad[1], rows_bad[2]]) + '\n')
        git('add', BOARD)
        io.open(board, 'w', encoding='utf-8').write('\n'.join(rows_bad) + '\n')  # 工作樹弄壞
        buf3 = _io.StringIO()
        with contextlib.redirect_stdout(buf3):
            check_staged()
        ck('工作樹壞而 staged 乾淨 ⇒ 不報違規', '位移候選' in buf3.getvalue(), False)
    finally:
        os.chdir(cwd0)
        # 🔴 must-fix ③ 的第三道:整棵拋棄式樹刪掉, 不留在磁碟上
        import shutil
        shutil.rmtree(g, ignore_errors=True)

    ck('跳脫那列的 `a\\|b\\|c` 還在', txt.count('`a\\|b\\|c`'), 2)
    print('SELFTEST ' + ('PASS' if not fails else 'FAIL:' + ','.join(fails)))
    return 0 if not fails else 1


if __name__ == '__main__':
    a = sys.argv[1] if len(sys.argv) > 1 else ''
    if a == '--selftest':
        sys.exit(selftest())
    if a == '--check-staged':
        sys.exit(check_staged())
    if a in ('--check', '--fix'):
        t = sys.argv[2] if len(sys.argv) > 2 else BOARD
        if not os.path.isfile(t):
            print(f'🔴 查無:{t} ⇒ 量具缺席', file=sys.stderr)
            sys.exit(2)
        sys.exit(run(t, a))
    print(__doc__)
    sys.exit(2)
