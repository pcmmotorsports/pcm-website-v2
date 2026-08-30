#!/usr/bin/env python3
"""md-table-overflow — 找出 Markdown 表格裡【會在渲染時被丟掉】的內容。

🔴 存在的理由(2026-08-30 線【出貨】量到,不是假想):
   `docs/launch-todo.md` 有 **48 列**的內容落在表頭欄數之外 ⇒ GFM 規格逐字「多出來的格被忽略」
   ⇒ **62,636 字在渲染時看不到**,而其中 **14 列**被丟掉的是【更正 / 撤回 / Sean 的拍板 / 態變更】
   —— 也就是最不能丟的那一種。
   📌 而檔案裡那些字**一個都沒少** ⇒ `grep` / `cat` 讀得到 ⇒ **這個病對純文字讀法完全隱形。**

exit code(四態分得開,不共用):
  0 = 沒有溢出
  1 = 有溢出(逐列印出來,含【被丟掉的是哪一段】)
  2 = **這把尺沒有量到**(用法錯 / 檔不存在 / `--changed-only` 底下 git 答不出來)
  3 = --selftest 失敗(這把尺自己壞了)⇒ 🔴 這時候的 0 不算數
🔴 **2 不是「有問題」,是「我沒量」** —— 照 `scripts/greenlight.sh:203` 的 ENV-FAIL 成例。
   ⇒ 📌 **把它與 0 撞在一起才是那個病**:一把跑不起來的尺印綠, 比沒有尺糟 ——
     沒有尺的時候人還知道自己沒量。

🔴 **它印【被丟掉的內容】不只是「這一列壞了」** —— 因為承重的正是那一段:
   一列只是「有問題」的話,沒有人會知道該不該急;而看到被丟掉的是一句拍板,判斷就變了。

🛑 **兩種形狀分開報,因為【修法不同】,合成一種會讓人改錯**:
   形狀A 追記寫在收尾 `|` 的【後面】  ⇒ 修法 = 把它搬到那根 `|` 【前面】
   形狀B 裸豎線長在【反引號裡面】     ⇒ 修法 = 寫成 `\\|` 或拆成兩個 code span
   ⚠️ **反引號【不保護】豎線** —— 這是 GFM 的表格規則,與行內程式碼的直覺相反。

⚠️ 它【不做】什麼(射程,印在輸出末尾,不躺在檔頭):
   · 不改任何檔(唯讀)
   · 只認「以 `|` 開頭」的行 —— 表格用其他寫法(縮排 / HTML table)它看不到
   · 不判內容重不重要 —— 它只把被丟掉的那段印出來,判斷是人的事
"""
import io
import re
import subprocess
import sys
import os

PIPE = re.compile(r'(?<!\\)\|')
SEP = re.compile(r'^\|[\s:\-\|]+\|\s*$')


def cells(line: str) -> list[str]:
    """照 GFM 切格:未被 `\\` 跳脫的 `|` 才分格(反引號不保護)。"""
    parts = PIPE.split(line)
    if parts and parts[0].strip() == '':
        parts = parts[1:]
    if parts and parts[-1].strip() == '':
        parts = parts[:-1]
    return parts


def in_code_span(line: str, pos: int) -> bool:
    """那個位置在不在反引號裡 —— 用它前面的反引號數是不是奇數判。"""
    return line[:pos].count('`') % 2 == 1


# 🔵 **這兩句是【判別式】不是措辭** —— 世界⑥⑧ 用它們分辨「是哪一道守門擋的」。
#    抽成常數的理由:斷言釘常數 ⇒ **換句話說不會紅, 而換一道守門會紅。**
#    🛑 改字面可以;**改到讓兩句變得分不出來就不行**(那會讓⑥⑧ 兩格同時失去判別力)。
MSG_NO_INDEX = '讀不到 index 裡的這一份'
MSG_NO_DIFF = 'git 答不出'


def _git(args: list[str]):
    """跑一發 git, **任何失敗都回 `None`**(不是空字串, 不是空集合)。

    🔴🔴 **為什麼兩道守門要併成一道**(2026-08-31 實測逼出來的, 不是為了漂亮):
       原本 `staged_content()` 與 `staged_new_lines()` **各有一套** rc / except 守門。
       而修完 R3 那條 must-fix 之後, `staged_content()` **排在前面** ⇒
       ⇒ 世界⑥⑦⑧ 全部在第一道就 fail-closed 了, **第二道再也走不到**
       ⇒ 📌 **六個原本被殺掉的突變(F4 / M1 / M18 / M7 / M19 / M24)同時活過來, 而 selftest 全綠。**
       ⇒ ⇒ 🔴 **也就是說:我修好一個真的缺陷, 而那個修法讓六個既有的偵測器一起失明** ——
         **兩件事都是真的, 而只有跑突變盤才看得到第二件。**
       ✅ 併成一道之後, 那六個突變塌成兩個(rc / except), 而⑥⑧ 各殺一個。
    🛑 而 `'Unmerged path'` 那道守門**已刪**:merge 衝突時 `git show :path` 本身就失敗
       (stage 0 不存在)⇒ 這一支根本走不到 `git diff` ⇒ 那行是**死碼**。
       📌 **一道走不到的守門, 它寫對寫錯印同一個綠** —— 世界⑦ 仍然紅在 `_git` 這一道。
    """
    try:
        p = subprocess.run(['git'] + args, capture_output=True, timeout=30)
    except Exception:
        return None
    if p.returncode != 0:
        return None
    return p.stdout.decode('utf-8', 'replace')


def staged_content(path: str):
    """讀【index 那一份】, 不是工作樹那一份。讀不到回 `None`。

    🔴🔴 **為什麼 `--changed-only` 不能用 `open(path)`**(2026-08-31 R3 抓的 must-fix;
       而 R1、R2 兩輪都沒站到這個角度):
       `staged_new_lines()` 讀的是 **index 的 diff**, 而 `scan()` 讀的是**工作樹**
       ⇒ **兩個資料源不是同一份**。
       實跑構造(拋棄式 repo):stage 一列新寫壞的 ⇒ 工作樹再插兩行未 stage ⇒ 行號漂
       ⇒ 那一列被歸類成「存量」⇒ 印
         `ℹ️ 另有 1 列溢出【不是這次改的】` + `✅ 這次改的那幾行沒有把內容弄丟` + **rc=0**
       ⇒ 📌 **旗標的全部目的被反轉, 而輸出不但綠, 還主動把它歸類成存量。**
    🔵 **這不是新發明** —— `scripts/rls-service-role-policy-gate.py:322` 與
       `scripts/acl-drift-gate.py:441` 兩支兄弟閘 2026-08-26 就把這一對寫下來了,
       逐字:「**守門要判的東西, 必須跟 commit 要收的東西是同一份**」。
       ⚠️ 而我當時**只抄了 `added_lines` 那一半, 沒抄 `staged_content` 那一半。**
       📌 ⇒ 抄一半的錯法, 在 diff 上與抄完整長得一樣。
    """
    # 🔴🔴 **`':' + path` 有【兩個】不同的坑, 而它們都印綠**(2026-08-31 R4 實跑複現):
    #   ① **絕對路徑** ⇒ `:/text` 被 git 解析成「**commit message 符合這個 regex 的最新一顆**」
    #      ⇒ **rc=0**、回一坨 commit dump ⇒ 掃不到表 ⇒ 印 `✅ 沒有被丟掉的內容` rc=0
    #      ⇒ 📌 **fail-closed 從頭到尾沒開火, 因為 git【成功】了。**
    #      🛑 而 `lint-staged` 預設就餵**絕對路徑**(本 repo 無 `--relative`)⇒ **下一顆掛上去就會踩到。**
    #   ② **`git show :path` 是 repo-root 相對, 而 `git diff -- path` 是 cwd 相對**
    #      ⇒ 在子目錄跑 ⇒ 兩支函式指的是**兩支不同的檔** ⇒ 一發之內同時假紅與假綠
    #      ⇒ 📌 **R3 那個「兩個資料源不同份」的病, 換一個機制回來了。**
    # ✅ `:./` 前綴 = 明確要求「**cwd 相對**」, 兩個坑一起關掉。
    # 🔴 **`os.path.relpath(path)` 單獨用會壞在 symlink 上**(2026-08-31 世界⑩ 當場抓到,
    #    而它是 R4 建議的修法字面):macOS 的 `/var` 是 `/private/var` 的 symlink
    #    ⇒ `os.getcwd()` 回 `/private/var/...` 而參數是 `/var/...`
    #    ⇒ relpath 算出一串 `../../../../../..` ⇒ git 讀不到 ⇒ **fail-closed(不是假綠, 但是假紅)**。
    #    ✅ 兩端都先 `realpath` 再相減。
    #    📌 **⇒ 而抓到它的是【新加的那一格世界】, 不是我讀那行修法讀出來的** ——
    #      一個看起來明顯正確的修法, 帶著一個只在某個平台上顯形的洞。
    rel = os.path.relpath(os.path.realpath(path), os.path.realpath(os.getcwd()))
    return _git(['show', ':./' + rel])


def scan(path: str, content: str | None = None) -> list[dict]:
    """回傳每一列溢出的細節。

    `content` 給了就用它(`--changed-only` 會餵 index 那一份), 沒給才讀工作樹。
    """
    if content is not None:
        lines = content.split('\n')
        return _scan_lines(path, lines)
    try:
        lines = io.open(path, encoding='utf-8').read().split('\n')
    except OSError as e:
        # 🔴 「沒量到」要回 2,不可以與「有溢出」的 1 或「乾淨」的 0 撞號 —— 撞了就分不出
        #    「這個檔沒問題」「這個檔有問題」「我根本沒量到這個檔」三件事。
        print(f'md-table-overflow: 讀不到 {path}({e})', file=sys.stderr)
        sys.exit(2)
    return _scan_lines(path, lines)


def _scan_lines(path: str, lines: list[str]) -> list[dict]:
    heads = []
    for i, l in enumerate(lines[:-1]):
        if l.startswith('|') and SEP.match(lines[i + 1] or ''):
            heads.append((i, len(cells(l))))
    out = []
    for idx, (h, ncol) in enumerate(heads):
        end = heads[idx + 1][0] if idx + 1 < len(heads) else len(lines)
        for j in range(h + 2, end):
            l = lines[j]
            if not l.startswith('|') or SEP.match(l):
                continue
            c = cells(l)
            if len(c) <= ncol:
                continue  # 少格 ⇒ GFM 補空,內容不掉
            # 找出切出第 ncol+1 格的那根豎線在哪
            pos = None
            for n, m in enumerate(PIPE.finditer(l), start=1):
                if n == ncol + 1:
                    pos = m.start()
                    break
            shape = 'B' if (pos is not None and in_code_span(l, pos)) else 'A'
            lost = '|'.join(c[ncol:])
            out.append({
                'line': j + 1, 'header_line': h + 1, 'ncol': ncol,
                'got': len(c), 'shape': shape, 'lost': lost, 'lost_chars': len(lost),
            })
    return out


SELFTEST = [
    # (名稱, 內容, 期望溢出列數, 期望形狀)
    ('乾淨的表(正對照:不得誤報)',
     '| a | b |\n|---|---|\n| 1 | 2 |\n', 0, None),
    ('形狀A:追記寫在收尾豎線後面',
     '| a | b |\n|---|---|\n| 1 | 2 | 這一段會被丟掉 |\n', 1, 'A'),
    ('形狀B:裸豎線長在反引號裡',
     '| a | b |\n|---|---|\n| 1 | `x|y` 後面這段會被丟掉 |\n', 1, 'B'),
    ('跳脫過的豎線(正對照:不得誤報)',
     '| a | b |\n|---|---|\n| 1 | x \\| y |\n', 0, None),
    ('少格(GFM 補空,內容不掉 ⇒ 不得報)',
     '| a | b | c |\n|---|---|---|\n| 1 | 2 |\n', 0, None),
]


def selftest() -> int:
    import tempfile, os
    bad = 0
    for name, body, want_n, want_shape in SELFTEST:
        fd, p = tempfile.mkstemp(suffix='.md')
        os.write(fd, body.encode('utf-8'))
        os.close(fd)
        try:
            got = scan(p)
        finally:
            os.unlink(p)
        ok = len(got) == want_n and (want_shape is None or (got and got[0]['shape'] == want_shape))
        print(f"  {'PASS' if ok else '🔴 FAIL'}  {name}"
              f"(期望 {want_n} 列{'/形狀' + want_shape if want_shape else ''},得 {len(got)} 列"
              f"{'/形狀' + got[0]['shape'] if got else ''})")
        if not ok:
            bad += 1
    # ══ 🔵 `--changed-only` 的十四個世界(2026-08-31 加;③④⑤⑥ 由 R1、⑦⑧ 由 R2、⑨ 由 R3、⑩⑪⑫⑬ 由 R4、⑭ 由 pre-commit 閘逼出來)══
    #   🛑 **在【真的 git repo】裡造, 不是 fixture 字串** —— 抄 `board-state-consistency.py`
    #      那支的成例:它的 partial-staging 那幾格也是真的建 repo。
    #      理由:這個旗標的整個內容是「git 怎麼看這次的 diff」⇒ **假的 repo 驗不到它。**
    #   🔴 **①與②【方向相反】, 缺一個就有一半沒被量**:
    #      「什麼都不過濾」的實作 ⇒ ①過、**②紅**;「永遠回空集合」的實作 ⇒ **①紅**、②過。
    #   🔴 而③④⑤⑥ 每一格都對應一個【實跑殺掉的突變】, 不是想像出來的世界 ——
    #      每一格的註解裡寫著它殺的是哪一個。
    bad += _selftest_changed_only()
    if bad:
        print(f'\n🔴 selftest 失敗 {bad} 格 ⇒ **這把尺壞了,它現在印的 0 不算數**')
        return 3
    print('\nselftest 全過(含兩個正對照:乾淨的表與跳脫過的豎線都不得誤報;'
          '另含 --changed-only 的十四個世界, 每一格都有一個實跑殺掉的突變)')
    return 0


def _run_changed_only(d: str, *paths: str):
    """在 `d` 底下**真的跑一發 `main(['x','--changed-only', ...])`**, 回 `(rc, stdout)`。

    🔴🔴 **為什麼每一格都要走 `main()` 而不是自己重寫一次過濾器**
       (2026-08-31 R2 抓到, 而 R1 沒抓到):
       第一版的六個世界各自寫 `[r for r in scan(f) if r['line'] in staged_new_lines(f)]`
       ⇒ 那是**把 production 那一行抄進測試裡再驗那份抄本**
       ⇒ 把 `main()` 裡真正的過濾器整段拿掉(`rows = list(rows)`)⇒ **selftest 全綠**,
         而實跑 rc 由 0 翻成 1、存量列被報成「這次改的」。
       📌 **⇒ 這支旗標的【全部目的】可以被反轉而零訊號。**
       ⇒ ✅ 判別句:**一個測試如果自己重打了一遍被測的邏輯, 它量的是那份抄本, 不是那支程式。**
    """
    import contextlib
    cwd = os.getcwd()
    # 🔴🔴 **必須把 `GIT_*` 環境變數剝掉**(2026-08-31 被 pre-commit 閘當場抓到):
    #    git 幫 hook 設 `GIT_DIR` / `GIT_INDEX_FILE` ⇒ 而 `_git()` 走的是**環境裡的 git**
    #    ⇒ 在 hook 底下跑 selftest 時, 這些世界的**拋棄式 repo 全部被外面那個真 repo 蓋掉**
    #    ⇒ 實測:①②③④⑤⑨⑩⑪⑬ 全紅(rc=2)。
    #    📌 **⇒ 「拋棄式 repo」在 hook 底下【不拋棄】** —— 而它平常跑(手動)完全正常,
    #      **只有裝上 pre-commit 的那一刻才會顯形。**
    #    ⚠️ **只有 selftest 要剝** —— production 走 hook 時**就該**用環境裡那個真 repo。
    #    ✅ 保留我自己設的 `GIT_CONFIG_GLOBAL/SYSTEM`(那是為了不吃使用者的 git 設定)。
    saved = {k: v for k, v in os.environ.items()
             if k.startswith('GIT_') and k not in ('GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM')}
    for k in saved:
        del os.environ[k]
    os.chdir(d)
    buf = io.StringIO()
    try:
        with contextlib.redirect_stdout(buf):
            rc = main(['x', '--changed-only'] + list(paths))
    finally:
        os.chdir(cwd)
        os.environ.update(saved)
    return rc, buf.getvalue()


def _selftest_changed_only() -> int:
    """`--changed-only` 的十四個世界。回傳失敗格數。

    ① 我改了一列而把它寫壞                      ⇒ **必須報**(rc=1)
    ② 壞的那列【先存在】, 而我在別的地方插一列  ⇒ **不准報**(rc=0)
    ③ 上面插一列 + 下面改壞一列                 ⇒ 只報那一列, **比內容不比個數**
    ④ 存量壞列的【正下方】純刪一列              ⇒ **不准報**(「正」字承重, 見那一格)
    ⑤ 兩支檔, 只 stage 其中一支                 ⇒ 另一支的存量**不准報**
    ⑥ 根本不在 git repo 裡                      ⇒ **不准印綠**(rc=2)
    ⑦ 那個檔正在 merge 衝突中                   ⇒ **不准印綠**(rc=2;而 git 這時 **rc=0**)
    ⑧ `git diff` 那一發拋逾時                    ⇒ **不准印綠**(唯一用替身的一格)
    ⑨ 壞的在 index 而工作樹行號漂了              ⇒ **必須報**(commit 收的是 index 那一份)
    ⑩ 餵【絕對路徑】                             ⇒ 必須照樣報(`:/text` 會被當 commit regex 而成功)
    ⑪ 從【子目錄】跑                             ⇒ 要指到同一支檔(兩支函式的相對基準不同)
    ⑫ 一支真紅 + 一支 env-fail                   ⇒ rc 必須是 **2**
    ⑬ index 那一份是【空的】                     ⇒ 不准掉回讀工作樹(判別式是 ℹ️ 那行不是 rc)
    ⑭ 環境裡有 `GIT_DIR`(= hook 的常態)         ⇒ 拋棄式 repo 仍要成立
    🔴 每一格底下的註解寫著它殺掉的是哪一個突變。**沒寫的那一格 = 我沒演過。**
    🛑 **十四格全部走 `_run_changed_only()` ⇒ 也就是走 `main()`**, 理由見它的 docstring。
       (⑧ 以外全部用真的 git repo;只有⑧ 換掉 `subprocess.run`。)
    """
    import tempfile, os as _os, shutil, subprocess as sp
    if not shutil.which('git'):
        print('  🟡 SKIP  --changed-only 十四個世界(找不到 git)⇒ **這不是通過, 是沒跑**')
        return 1
    d = tempfile.mkdtemp()
    bad = 0

    def rep(n, ok, msg):
        print(f"  {'PASS' if ok else '🔴 FAIL'}  --changed-only {n} {msg}")
        return 0 if ok else 1

    try:
        # 🔴 `GIT_DIR` **贏過 `git -C`** ⇒ 建拋棄式 repo 這一步也要剝乾淨, 理由同
        #    `_run_changed_only()` 那段。(2026-08-31 hook 底下實測:不剝 ⇒ 九格全紅。)
        env = {k: v for k, v in _os.environ.items() if not k.startswith('GIT_')}
        env['GIT_CONFIG_GLOBAL'] = '/dev/null'
        env['GIT_CONFIG_SYSTEM'] = '/dev/null'
        def g(*a):
            return sp.run(['git', '-C', d] + list(a), capture_output=True, text=True, env=env)
        g('init', '-q', '.')
        g('config', 'user.email', 't@t'); g('config', 'user.name', 't')
        base = '# t\n\n| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n| 5 | 6 |\n'
        p = _os.path.join(d, 't.md')
        io.open(p, 'w', encoding='utf-8').write(base)
        g('add', 't.md'); g('commit', '-qm', 'base')
        # 🔴 預設分支名**當場問它自己**, 不假設 master/main —— git 版本與設定都會改它。
        defbr = g('rev-parse', '--abbrev-ref', 'HEAD').stdout.strip()

        # ① 改壞【這一次動到的那一列】⇒ 必須報
        #    🔴 殺的突變:`staged_new_lines` 恆回空集合 ⇒ 什麼都不報 ⇒ 這一格紅。
        io.open(p, 'w', encoding='utf-8').write(base.replace('| 3 | 4 |', '| 3 | 4 | 多一格 |'))
        g('add', 't.md')
        rc1, out1 = _run_changed_only(d, 't.md')
        bad += rep('①', rc1 == 1 and '多一格' in out1,
                  f"改壞【這次動到的】那一列 ⇒ 要報(rc={rc1} ⇒ 期望 1;"
                  f"輸出含被丟掉的那段字 = {'是' if '多一格' in out1 else '否'} ⇒ 期望 是)")

        # ② 壞的先存在, 而這次只在別處插一列 ⇒ 不准報
        #    🔴 殺的突變:`staged_new_lines` 恆回全部行號(= 什麼都不過濾)⇒ 這一格紅。
        #    🔴🔴 **插入點一定要在【壞的那一列上面】** —— 2026-08-31 實測:
        #       插在【下面】⇒ 壞的那列行號沒動 ⇒ **一個用【舊檔】行號的實作也會過這一格**
        #       ⇒ 📌 一個純插入的 hunk, 舊檔那一側是 `-n,0`(零行)⇒ 它不貢獻任何舊行號
        #         ⇒ 插在下面時, 新舊兩種寫法【印同一個答案】。
        g('commit', '-qam', 'stock')
        cur = io.open(p, encoding='utf-8').read()
        io.open(p, 'w', encoding='utf-8').write(cur.replace('| 1 | 2 |', '| 0 | 0 |\n| 1 | 2 |'))
        g('add', 't.md')
        rc2, out2 = _run_changed_only(d, 't.md')
        # 🔴 第三個斷言是 R2 那條 nit 的守門:`--changed-only` 底下的成功句
        #    **不可以與「這個檔真的乾淨」共用字面** —— 上一行剛印完「另有 1 列」,
        #    再印「沒有被丟掉的內容」就是自相矛盾且假。
        #    ⇒ 📌 少了這一格, 把兩句合成一句的突變**零訊號**(2026-08-31 實測 ALIVE)。
        ok2 = (rc2 == 0 and '另有 1 列' in out2 and '存量還在' in out2)
        bad += rep('②', ok2,
                  f"存量壞而這次只在別處插一列 ⇒ 【不准報】(rc={rc2} ⇒ 期望 0;"
                  f"說出【自己略過了幾列】= {'是' if '另有 1 列' in out2 else '否'};"
                  f"成功句**沒有**謊稱這個檔乾淨 = {'是' if '存量還在' in out2 else '否'})")

        # ③ 🔴🔴 **行號漂的分水嶺** —— ①②都抓不到它, 這一格是實測逼出來的。
        #    🔴 殺的突變:讀【舊檔】那一側的 hunk 行號(`-a,b` 而非 `+c,d`)。
        #    2026-08-31 量到它在①②底下全過, 成因:
        #      · ① 是【單列改寫】⇒ hunk `-6,1 +6,1` ⇒ 新舊行號【相同】
        #      · ② 是【純插入】  ⇒ hunk `-5,0 +5,1` ⇒ 舊側 0 行 ⇒ 舊寫法回空集合, 剛好也不報
        #    ⇒ 📌 **兩格都不需要新舊行號不同, 所以它們分不出那個實作。**
        #    🔴 而這一格的第一版**只數個數**也全過 —— 因為這裡有【兩列】壞的:
        #       舊行號的實作報【存量那一列】、新行號的報【這次改壞的那一列】⇒ **兩者都回 1**。
        #       📌 **⇒ 一個數字相同, 不代表指的是同一個東西。** ⇒ 所以要比【內容】。
        g('commit', '-qam', 'w2')
        cur = io.open(p, encoding='utf-8').read()
        cur = cur.replace('| 0 | 0 |', '| 0 | 0 |\n| 01 | 01 |')
        cur = cur.replace('| 5 | 6 |', '| 5 | 6 | 這次改壞的 |')
        io.open(p, 'w', encoding='utf-8').write(cur)
        g('add', 't.md')
        rc3, out3 = _run_changed_only(d, 't.md')
        ok3 = rc3 == 1 and '這次改壞的' in out3 and '多一格' not in out3
        bad += rep('③', ok3,
                  f"【上面插一列 + 下面改壞一列】⇒ 只報【這次改壞的那一列】"
                  f"(rc={rc3} ⇒ 期望 1;報到這次改壞的 = {'是' if '這次改壞的' in out3 else '否'};"
                  f"**沒有**報到存量那列 = {'是' if '多一格' not in out3 else '否'})"
                  f" —— **這一格比內容不比個數**")

        # ④ 存量壞列的【正下方】純刪一列 ⇒ 不准報
        #    🔴 殺的突變:`count` 加地板 `max(1, ...)` ⇒ 純刪除 hunk `@@ -6 +5,0 @@` 的
        #       那個 `0` 被撐成 `1` ⇒ 集合變 {5} ⇒ 而 5 正好是那列存量壞的
        #       ⇒ **它被報成「這次改的」** ⇒ 📌 這個旗標存在的目的被反轉。
        #    ⚠️ **「正下方」的【正】字承重, 不是修辭**:純刪除 hunk 的 `+c` 指的是
        #       【刪除點的前一列】⇒ 要讓地板撞到壞的那列, 就得刪它**正下方**那一列;
        #       刪上面、刪更下面, 地板都撞不到它 ⇒ 這一格會恆綠。
        g('commit', '-qam', 'w3')
        base4 = '# t\n\n| a | b |\n|---|---|\n| 1 | 2 | 壞的 |\n| 3 | 4 |\n| 5 | 6 |\n'
        io.open(p, 'w', encoding='utf-8').write(base4)
        g('add', 't.md'); g('commit', '-qm', 'w4-base')
        io.open(p, 'w', encoding='utf-8').write(base4.replace('| 3 | 4 |\n', ''))
        g('add', 't.md')
        rc4, out4 = _run_changed_only(d, 't.md')
        bad += rep('④', rc4 == 0 and '壞的' not in out4.split('🛑')[0],
                  f"存量壞列【正下方】純刪一列 ⇒ 【不准報】(rc={rc4} ⇒ 期望 0)")

        # ⑤ 兩支檔, 只 stage 其中一支 ⇒ 另一支的存量不准報
        #    🔴 殺的突變:`git diff --cached -U0` 拿掉 `'--', path`
        #       ⇒ 它回的是【整個 index】的 hunk ⇒ 別的檔的行號漏進來。
        #    📌 **而 lint-staged 一次餵多檔 = 這個突變的常態環境** ——
        #       它在單檔世界裡是隱形的, 而上線第一天就會踩到。
        #    🔵 兩支檔的壞列與改動列都放在第 5 行, 讓漏進來的行號【剛好命中】——
        #       ⚠️ 而 2026-08-31 R2 實測:就算把它推到第 10 行(前提飄掉), 這一格**仍然紅**,
        #       因為斷言是「a.md 不准被報」而不是「數字剛好對上」。
        #       ⇒ 📌 對齊讓它**更快**紅, 不是讓它**才會**紅。
        g('reset', '-q', '--hard')
        pa = _os.path.join(d, 'a.md'); pb = _os.path.join(d, 'b.md')
        io.open(pa, 'w', encoding='utf-8').write('# a\n\n| a | b |\n|---|---|\n| 1 | 2 | 存量壞 |\n')
        io.open(pb, 'w', encoding='utf-8').write('# b\n\n| a | b |\n|---|---|\n| 9 | 9 |\n')
        g('add', 'a.md', 'b.md'); g('commit', '-qm', 'w5-base')
        io.open(pb, 'w', encoding='utf-8').write('# b\n\n| a | b |\n|---|---|\n| 8 | 8 |\n')
        g('add', 'b.md')
        rc5, out5 = _run_changed_only(d, 'a.md')
        bad += rep('⑤', rc5 == 0 and '存量壞' not in out5.split('🛑')[0],
                  f"兩支檔而只 stage 了另一支 ⇒ 【不准報】(rc={rc5} ⇒ 期望 0;"
                  f"報到 a.md 的存量列 = {'是' if '存量壞' in out5.split('🛑')[0] else '否'} ⇒ 期望 否)")

        # ⑦ 那個檔正在 **merge 衝突** 中 ⇒ 不准印綠
        #    🔴 殺的突變(2026-08-31 R4 更正):~~拿掉 `'Unmerged path'` 那道守門~~ **那道已刪**
        #       ⇒ **那個突變現在造不出來, 而這行註解曾經指著它**(鐵則 11 字面 vs 事實)。
        #       ✅ 它真正唯一殺得掉的是:**「index 讀不到就退回 `HEAD:`」那種善意 fallback**
        #       (有⑦ ⇒ DEAD / 無⑦ ⇒ ALIVE;R4 實跑)。⇒ **所以⑦不冗餘, 不要刪。**
        #    🔴🔴 **它與⑥【不是同一個病】**:⑥ 是 git 回 rc≠0;
        #       這一格 git **rc = 0** 而只在 stdout 印一行 `* Unmerged path t.md`
        #       ⇒ 📌 **一道只看 rc 的守門在這裡完全不會叫**, 而輸出與「這個檔真的乾淨」逐字相同。
        g('reset', '-q', '--hard'); g('checkout', '-q', '-b', 'br1')
        conf = _os.path.join(d, 'c.md')
        io.open(conf, 'w', encoding='utf-8').write('# c\n\n| a | b |\n|---|---|\n| 1 | 2 | 這邊壞 |\n')
        g('add', 'c.md'); g('commit', '-qm', 'br1')
        g('checkout', '-q', defbr)
        io.open(conf, 'w', encoding='utf-8').write('# c\n\n| a | b |\n|---|---|\n| 9 | 9 | 那邊壞 |\n')
        g('add', 'c.md'); g('commit', '-qm', 'other')
        g('merge', 'br1')
        rc7, out7 = _run_changed_only(d, 'c.md')
        ok7 = (rc7 == 2 and '✅' not in out7)
        bad += rep('⑦', ok7,
                  f"那個檔正在 merge 衝突中 ⇒ 【不准印綠】(rc={rc7} ⇒ 期望 2;"
                  f"印了 ✅ = {'是' if '✅' in out7 else '否'} ⇒ 期望 否)"
                  f" —— 🔴 **而 git 在這裡自己是 rc=0**, 只看 rc 的守門抓不到")

        # ⑨ 🔴🔴 **index 與工作樹【不是同一份】** —— R3 抓的 must-fix, R1/R2 兩輪都沒站到。
        #    做法:stage 一列新寫壞的 ⇒ **接著只改工作樹(不 add)**, 在它上面插兩行 ⇒ 行號漂。
        #    🔴 殺的突變:`scan()` 讀工作樹而不是 index(也就是修掉 `staged_content` 那一步)
        #       ⇒ 工作樹那一份裡, 壞的那列已經漂到別的行號
        #       ⇒ 它落在 `touched` 之外 ⇒ 被歸類成「存量」
        #       ⇒ 印 `ℹ️ 另有 1 列…不是這次改的` + `✅ 這次改的沒把內容弄丟` + **rc=0**
        #    📌 **⇒ 旗標的全部目的被反轉, 而輸出不但綠, 還主動把它歸類成存量。**
        #    ⚠️ **射程**:lint-staged 預設會 stash 未 staged 那半 ⇒ 掛上 hook 後這條大部分被遮住;
        #       **手動跑(檔頭唯一寫出來的用法)與 `--no-stash` 全中。**
        #       🔴 而「lint-staged 的 stash 在本 repo 實際怎麼跑」**未量** —— 那是讀預設行為推的。
        g('reset', '-q', '--hard')
        p9 = _os.path.join(d, 'i.md')
        io.open(p9, 'w', encoding='utf-8').write('# i\n\n| a | b |\n|---|---|\n| 1 | 2 |\n')
        g('add', 'i.md'); g('commit', '-qm', 'w9-base')
        io.open(p9, 'w', encoding='utf-8').write('# i\n\n| a | b |\n|---|---|\n| 1 | 2 | 這次stage的壞 |\n')
        g('add', 'i.md')                                    # ← 壞的那一列進了 index
        io.open(p9, 'w', encoding='utf-8').write(
            '# i\n\n甲\n乙\n| a | b |\n|---|---|\n| 1 | 2 | 這次stage的壞 |\n')  # ← 只改工作樹, 不 add
        rc9, out9 = _run_changed_only(d, 'i.md')
        ok9 = (rc9 == 1 and '這次stage的壞' in out9)
        bad += rep('⑨', ok9,
                  f"index 與工作樹不同份(壞的在 index, 工作樹行號漂了)⇒ **必須報**"
                  f"(rc={rc9} ⇒ 期望 1;報到 index 裡那一列 = {'是' if '這次stage的壞' in out9 else '否'})"
                  f" —— 🔴 **commit 收走的是 index 那一份**")

        # ⑩ **餵絕對路徑** ⇒ 不准印綠
        #    🔴 殺的突變:`_git(['show', ':./' + relpath])` 改回 `':' + path`。
        #    🔴🔴 成因:`:/text` 被 git 解析成「**commit message 符合這個 regex 的最新一顆**」
        #       ⇒ **rc=0**、回一坨 commit dump ⇒ 掃不到表 ⇒ 印 ✅ rc=0
        #       ⇒ 📌 **fail-closed 沒開火, 因為 git【成功】了 —— 它只是答了別的問題。**
        #    🛑 **而 lint-staged 預設就餵絕對路徑** ⇒ 這不是理論路徑, 是下一顆的常態路徑。
        #    ⚠️ commit message 要含那個路徑, 那個 regex 才命中 —— 這一格刻意造出那個條件。
        g('reset', '-q', '--hard')
        pabs = _os.path.join(d, 'abs.md')
        io.open(pabs, 'w', encoding='utf-8').write('# a\n\n| a | b |\n|---|---|\n| 1 | 2 |\n')
        g('add', 'abs.md'); g('commit', '-qm', f'fix: 修 {pabs} 這一支')
        io.open(pabs, 'w', encoding='utf-8').write('# a\n\n| a | b |\n|---|---|\n| 1 | 2 | 絕對路徑壞 |\n')
        g('add', 'abs.md')
        rc10, out10 = _run_changed_only(d, pabs)
        bad += rep('⑩', rc10 == 1 and '絕對路徑壞' in out10,
                  f"餵【絕對路徑】⇒ 必須照樣報(rc={rc10} ⇒ 期望 1;"
                  f"報到那一列 = {'是' if '絕對路徑壞' in out10 else '否'})"
                  f" —— 🔴 **`:/text` 會被 git 當成 commit message 的 regex 而【成功】**")

        # ⑪ **從子目錄跑** ⇒ 要指到同一支檔
        #    🔴 殺的突變:同上(`git show :path` 是 **repo-root** 相對, 而 `git diff -- path` 是 **cwd** 相對)。
        #    🔴🔴 一發之內同時是【假紅】與【假綠】:報的是 repo 根另一支同名檔的**存量**,
        #       而這次真的 staged 的那一列**完全沒被報**。
        #    📌 **⇒ R3 那個「兩個資料源不同份」的病, 換一個機制回來了。**
        g('reset', '-q', '--hard')
        io.open(_os.path.join(d, 'same.md'), 'w', encoding='utf-8').write(
            '# root\n\n| a | b |\n|---|---|\n| 1 | 2 | 根目錄的存量壞 |\n')
        _os.makedirs(_os.path.join(d, 'sub'), exist_ok=True)
        psub = _os.path.join(d, 'sub', 'same.md')
        io.open(psub, 'w', encoding='utf-8').write('# sub\n\n| a | b |\n|---|---|\n| 1 | 2 |\n')
        g('add', 'same.md', 'sub/same.md'); g('commit', '-qm', 'w11-base')
        io.open(psub, 'w', encoding='utf-8').write('# sub\n\n| a | b |\n|---|---|\n| 1 | 2 | 子目錄這次壞 |\n')
        g('add', 'sub/same.md')
        rc11, out11 = _run_changed_only(_os.path.join(d, 'sub'), 'same.md')
        ok11 = (rc11 == 1 and '子目錄這次壞' in out11 and '根目錄的存量壞' not in out11)
        bad += rep('⑪', ok11,
                  f"從【子目錄】跑 ⇒ 要指到同一支檔(rc={rc11} ⇒ 期望 1;"
                  f"報到子目錄那一列 = {'是' if '子目錄這次壞' in out11 else '否'};"
                  f"**沒有**誤報根目錄那一列 = {'是' if '根目錄的存量壞' not in out11 else '否'})"
                  f" —— 🔴 **一發之內同時是假紅與假綠**")

        # ⑫ **一支檔真紅 + 另一支 env-fail** ⇒ rc 必須是 2, 不是 1
        #    🔴 殺的突變:`if env_fail:` 改成 `if env_fail and not total:`(R4 量到它 ALIVE)。
        #    📌 **「我沒量到」比「我量到 0」更該先講** —— 而紅的那幾列**已經印在畫面上了**,
        #       只有「有一支檔我沒量到」這件事只能靠 rc 帶出去。
        g('reset', '-q', '--hard')
        io.open(_os.path.join(d, 'red.md'), 'w', encoding='utf-8').write(
            '# r\n\n| a | b |\n|---|---|\n| 1 | 2 |\n')
        g('add', 'red.md'); g('commit', '-qm', 'w12-base')
        io.open(_os.path.join(d, 'red.md'), 'w', encoding='utf-8').write(
            '# r\n\n| a | b |\n|---|---|\n| 1 | 2 | 這次真的壞 |\n')
        g('add', 'red.md')
        io.open(_os.path.join(d, 'never.md'), 'w', encoding='utf-8').write(
            '# n\n\n| a | b |\n|---|---|\n| 1 | 2 | 沒 add 過 |\n')   # ← 從沒 add ⇒ index 讀不到
        rc12, out12 = _run_changed_only(d, 'red.md', 'never.md')
        ok12 = (rc12 == 2 and '這次真的壞' in out12 and MSG_NO_INDEX in out12)
        bad += rep('⑫', ok12,
                  f"一支真紅 + 一支 env-fail ⇒ rc 必須是 **2**(rc={rc12} ⇒ 期望 2;"
                  f"紅的那列仍印出來 = {'是' if '這次真的壞' in out12 else '否'})"
                  f" —— 🔴 **「我沒量到」要蓋過「我量到了紅」**")

        # ⑭ **把 `GIT_DIR` 指向【外面那個 repo】, 而這一格仍必須成立**
        #    🔴 殺的突變:拿掉 `_run_changed_only()` / `g()` 裡剝 `GIT_*` 那幾行。
        #    🔴🔴 **這一格是 2026-08-31 被 pre-commit 閘擋下來才長出來的** ——
        #       手動跑 selftest 一路全綠, **裝上 hook 的那一刻九格同時紅**。
        #       📌 **⇒ 「它在我機器上是綠的」與「它在會跑它的那個環境裡是綠的」是兩個宣稱。**
        g('reset', '-q', '--hard')
        pg = _os.path.join(d, 'envdir.md')
        io.open(pg, 'w', encoding='utf-8').write('# g\n\n| a | b |\n|---|---|\n| 1 | 2 |\n')
        g('add', 'envdir.md'); g('commit', '-qm', 'w14-base')
        io.open(pg, 'w', encoding='utf-8').write('# g\n\n| a | b |\n|---|---|\n| 1 | 2 | 環境變數壞 |\n')
        g('add', 'envdir.md')
        outer = _os.getcwd()                                          # ← 本 repo(不是拋棄式那個)
        _os.environ['GIT_DIR'] = _os.path.join(outer, '.git')         # ← 故意污染
        _os.environ['GIT_INDEX_FILE'] = _os.path.join(outer, '.git', 'index')
        try:
            rc14, out14 = _run_changed_only(d, 'envdir.md')
        finally:
            _os.environ.pop('GIT_DIR', None)
            _os.environ.pop('GIT_INDEX_FILE', None)
        bad += rep('⑭', rc14 == 1 and '環境變數壞' in out14,
                  f"環境裡有 GIT_DIR 指向別的 repo(= hook 的常態)⇒ 拋棄式 repo 仍要成立"
                  f"(rc={rc14} ⇒ 期望 1;報到那一列 = {'是' if '環境變數壞' in out14 else '否'})"
                  f" —— 🔴 **手動跑全綠, 裝上 hook 才紅**")

        # ⑬ **index 裡那一份是空的** ⇒ 不准偷偷掉回讀工作樹
        #    🔴 殺的突變:`if content is not None:` 改成 `if content:`
        #       ⇒ 空字串是 falsy ⇒ **靜靜地掉回 `open(path)` 讀工作樹** ⇒ 兩個資料源又分岔。
        #    ⚠️ **這一格的判別式【不是 rc】** —— 兩種實作的 rc 都是 0。
        #       差在那行 `ℹ️ 另有 N 列`:讀 index(空)⇒ 0 列 ⇒ 不印;
        #       讀工作樹 ⇒ 1 列 ⇒ 被 `touched` 濾掉 ⇒ **印「另有 1 列」**。
        #    📌 **⇒ 又一次「rc 相同而它們在講不同的事」** —— 與世界③ 同一個形狀。
        g('reset', '-q', '--hard')
        pe = _os.path.join(d, 'empty.md')
        io.open(pe, 'w', encoding='utf-8').write('# e\n\n| a | b |\n|---|---|\n| 1 | 2 |\n')
        g('add', 'empty.md'); g('commit', '-qm', 'w13-base')
        io.open(pe, 'w', encoding='utf-8').write('')            # ← index 那份是空的
        g('add', 'empty.md')
        io.open(pe, 'w', encoding='utf-8').write(
            '# e\n\n| a | b |\n|---|---|\n| 1 | 2 | 只在工作樹壞 |\n')   # ← 工作樹那份有壞的
        rc13, out13 = _run_changed_only(d, 'empty.md')
        ok13 = (rc13 == 0 and '另有' not in out13 and '只在工作樹壞' not in out13)
        bad += rep('⑬', ok13,
                  f"index 那一份是**空的** ⇒ 不准掉回讀工作樹(rc={rc13} ⇒ 期望 0;"
                  f"印了「另有 N 列」= {'是' if '另有' in out13 else '否'} ⇒ 期望 否)"
                  f" —— 🔴 **兩種實作的 rc 都是 0, 判別式在那行 ℹ️ 上**")

        # ⑧ `git diff` 那一發自己拋例外(逾時)⇒ **不准印綠**
        #    🔴 殺的三個突變:`_git` 的 `except` 回空字串 / 收窄成 `except OSError` /
        #       `staged_new_lines` 拿掉 `if text is None`。
        #    🔴🔴 **這一格【必須在真的 repo 裡, 而且替身只炸 `diff` 不炸 `show`】** ——
        #       2026-08-31 實測兩個錯法, 兩個都讓它變成恆綠:
        #       · 在**非 repo** 的暫存目錄跑 ⇒ `git show` 自己就真的失敗了
        #         ⇒ 第一道就 fail-closed ⇒ **替身從頭到尾沒有參與**
        #       · 替身把**兩發都炸掉** ⇒ `staged_content()` 先死
        #         ⇒ `staged_new_lines()` 那道**永遠走不到**
        #    ⇒ 📌 **一個替身把【全部】都擋掉, 就分不出擋在第幾道。**
        #    ⚠️ 拋的是 `subprocess.TimeoutExpired` 不是 `OSError` —— 後者會讓
        #       「收窄成 `except OSError`」變成**等價突變、殺不掉**。
        real_run = subprocess.run
        def boom(*a, **k):
            if 'show' in a[0]:
                return real_run(*a, **k)
            raise subprocess.TimeoutExpired(cmd=['git'], timeout=30)
        subprocess.run = boom
        try:
            try:
                rc8, out8 = _run_changed_only(d, 'i.md')
            except BaseException as e:
                # 🛑 例外逃出來 = 沒被接住 = 這一格紅, 而**不是讓整支 selftest 爆掉**
                #    (爆掉的話上面那幾格的 PASS 就再也印不出來 ⇒ 讀的人看不到全貌)。
                rc8, out8 = -1, f'(例外逃出來了:{type(e).__name__})'
        finally:
            subprocess.run = real_run
        # 🔴🔴 **要釘住是【哪一道守門】擋的, 不能只看 rc** —— 2026-08-31 實測逼出來的:
        #    把替身改成連 `show` 也炸(= 這一格的前提被破壞)⇒ 第一道 `staged_content()` 先擋
        #    ⇒ **rc 一樣是 2、一樣不印 ✅ ⇒ 這一格照樣 PASS**
        #    ⇒ 📌 **它會用一個【對的結果】通過, 而擋它的是【錯的那道】** ——
        #      也就是說, 這一格宣稱自己在量 `staged_new_lines()` 那道, 而它其實沒有。
        #    ✅ 兩道印的字不同(`讀不到 index 裡的這一份` vs `git 答不出這次動了哪幾行`)
        #      ⇒ 釘那句字面。⚠️ **這裡刻意釘字面, 與世界⑥⑦ 刻意【不】釘不衝突** ——
        #      那邊字面只是措辭, 這裡字面**就是判別式**。
        ok8 = (rc8 == 2 and '✅' not in out8 and MSG_NO_DIFF in out8)
        bad += rep('⑧', ok8,
                  f"`git diff` 那一發拋逾時 ⇒ 【不准印綠】(rc={rc8} ⇒ 期望 2;"
                  f"印了 ✅ = {'是' if '✅' in out8 else '否'} ⇒ 期望 否;"
                  f"擋它的是 **staged_new_lines 那道** = {'是' if MSG_NO_DIFF in out8 else '否'})"
                  f" —— 🔴 **這條分支沒有真實世界走得到, 只有替身量得到**")
    finally:
        shutil.rmtree(d, ignore_errors=True)

    # ⑥ 根本不在 git repo 裡 ⇒ **不准印綠**
    #    🔴 殺的突變:不檢查 `out.returncode` ⇒ 失敗照樣往下解析 ⇒ 空集合 ⇒ 一列都不報
    #       ⇒ 印 `✅ 沒有被丟掉的內容`、rc=0
    #       ⇒ 📌 **與「這個檔真的乾淨」逐字同一句話、同一個 rc。**
    #    ⚠️ **射程**:它只殺 `returncode` 那條分支;`except` 那條由世界⑧ 殺。
    d6 = tempfile.mkdtemp(dir='/tmp')
    try:
        io.open(os.path.join(d6, 't.md'), 'w', encoding='utf-8').write(
            '# t\n\n| a | b |\n|---|---|\n| 1 | 2 | 壞的 |\n')
        rc6, out6 = _run_changed_only(d6, 't.md')
        # 🔴🔴 **這一格【有】釘字面, 而那顆釘子是唯一壓著「兩道守門對調」那個迴歸的東西**
        #    (2026-08-31 R4 量到:只把這顆釘子拿掉、其餘一字不動 ⇒ 對調的突變 **ALIVE 而全綠**)。
        #    ⚠️ **本處原本的註解寫著「不釘逐字」, 而程式碼釘著** ——
        #    📌 **⇒ 一段與程式碼相反的註解, 它在邀請下一個人拆掉唯一承重的那顆釘子。**
        #    ✅ 而釘的是**常數**不是手打字串 ⇒ 換句話說不會紅, 而【換一道守門】會紅。
        ok6 = (rc6 == 2 and '✅' not in out6 and MSG_NO_INDEX in out6)
        bad += 0 if ok6 else 1
        print(f"  {'PASS' if ok6 else '🔴 FAIL'}  --changed-only ⑥ 不在 git repo 裡 ⇒ "
              f"【不准印綠】(rc={rc6} ⇒ 期望 2;印了 ✅ = {'是' if '✅' in out6 else '否'} ⇒ 期望 否)"
              f" —— **這一格擋的是「跑不起來而印綠」**")
    finally:
        shutil.rmtree(d6, ignore_errors=True)

    return bad


def staged_new_lines(path: str):   # -> set | None(None = git 答不出來, 見 docstring)
    """這次 staged diff 在【新檔】裡動到的行號集合。

    🔴 **為什麼是「新檔的行號」而不是舊的**(2026-08-31 `-48` 先點出來的坑):
       一列被改動時它的行號會漂 —— 在它上面插一列, 下面每一列的舊行號都會變。
       ⇒ 用舊行號比對 ⇒ **在別處插一列, 會讓整份檔的下半全部算成「動過」**。
    ✅ `git diff --cached -U0` 的 hunk 標頭 `@@ -a,b +c,d @@` 裡, `+c,d` 就是
       **新檔那一側被加入/改寫的行號區間** ⇒ 純粹刪除的 hunk `d` 為 0 ⇒ 不貢獻任何行。
       ⇒ **在別處插一列, 只會讓那一列自己進集合, 不會碰到別列。**

    ⚠️ **它證不到什麼**:
    · 它只認 `git diff --cached` 看得到的 —— **沒 `git add` 的改動不在裡面**
    · 它只答得出「git 怎麼看」—— **git 答不出來時它回 `None`, 不是空集合**

    🔴🔴 **為什麼 `None` 而不是空集合**(2026-08-31 code-reviewer 抓的 Critical):
       空集合在 `--changed-only` 底下等於「這個檔一列都不報」⇒ **印一個 ✅**
       ⇒ 而那與「這個檔真的乾淨」**逐字印同一句話、rc 同樣是 0**。
       ⇒ 📌 **一把跑不起來時會印綠的尺, 比沒有尺糟** —— 沒有尺的時候人還知道自己沒量。
       ⚠️ **而它不只有「rc 非 0」一種形狀**:merge 衝突中的檔, git 印
          `* Unmerged path t.md` 而 **rc = 0** ⇒ 只看 rc 的守門完全不會叫。
    """
    text = _git(['diff', '--cached', '-U0', '--', path])
    if text is None:
        return None
    got = set()
    for ln in text.split('\n'):
        m = re.match(r'^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@', ln)
        if not m:
            continue
        start = int(m.group(1))
        count = 1 if m.group(2) is None else int(m.group(2))
        for k in range(start, start + count):
            got.add(k)
    return got


def main(argv: list[str]) -> int:
    args = argv[1:]
    if not args:
        print(__doc__)
        print('用法: python3 scripts/md-table-overflow.py <file.md> [...]')
        print('      python3 scripts/md-table-overflow.py --selftest')
        return 2
    if args[0] == '--selftest':
        return selftest()
    # 🔵 `--staged-md`:**自己去問 git 這次 staged 了哪幾支 `.md`**, 然後對每一支跑 `--changed-only`。
    #   🔴🔴 **為什麼這一步不能留在 shell 裡**(2026-08-31 codex 第二輪實跑抓的, 兩條都是我親手寫的):
    #     ① `git diff … | tr '\0' '\n'` ⇒ **整條管線的 rc 是 `tr` 的** ⇒ git 失敗(實測 rc=129)
    #        而 `FILES` 變空 ⇒ 我的殼 `[ -z "$FILES" ] && exit 0` ⇒ **rc=0 印綠放行**
    #        ⇒ 📌 **我花了一整夜寫「fail-open 印綠」的教訓, 然後把它寫進自己的閘。**
    #     ② `xargs` 會把子程序的 rc=1/2/3 **全部壓成 1**(BSD xargs 實測)
    #        ⇒ 那支尺的四態契約在殼裡消失, 而我的 `RC -eq 2` 那段提示**永遠走不到**
    #        ⇒ 🔴 而那正是我【為了避開 lint-staged 才搬過來】的同一個病 —— 換了個殼, 病跟著來。
    #   ✅ 兩條都只有「整段搬進同一個程序」解得掉:清單、rc、逐檔掃描在同一個 rc 的射程裡。
    if args[0] == '--staged-md':
        listing = _git(['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR', '--', '*.md'])
        if listing is None:
            print('🟡 **git 答不出這次 staged 了哪幾支 .md**(不在 repo?git 失敗?)'
                  ' ⇒ 本閘【不做任何宣稱】, 不放行。')
            return 2
        # 🔴 用 NUL 切, 從頭到尾沒有經過 shell 變數 ⇒ 換行檔名與中文檔名都安全。
        #    (本 repo 今天有 88 支中文檔名的 .md、0 支含換行 —— 而後者是「今天沒有」不是「不會有」。)
        paths = [p for p in listing.split('\0') if p]
        if not paths:
            return 0
        return main(['x', '--changed-only'] + paths)
    # 🔵 `--changed-only`:只報【這次 staged diff 動到的那些列】上的溢出。
    #   存量不紅, 而你今天新寫壞的那一列會紅。
    #   🛑 **它與 `board-state-consistency.py --staged` 的語意【不同】** ——
    #      那一支的 `--staged` 是「掃 index 那一份【內容】」, 而它仍然會報整份的問題;
    #      本旗標是「只報【這次動到的行】」。**兩個名字不一樣是刻意的, 不要對齊。**
    changed_only = False
    if args and args[0] == '--changed-only':
        changed_only = True
        args = args[1:]
        if not args:
            print('用法: python3 scripts/md-table-overflow.py --changed-only <file.md> [...]')
            return 2
    total = 0
    env_fail = 0   # 🛑 rc 四態:0=乾淨 / 1=有被丟掉的內容 / 2=**這把尺沒量到** / 3=selftest 壞
    for path in args:
        if changed_only:
            # 🔴 **兩個資料源必須是同一份** —— 見 `staged_content()` 的 docstring。
            idx = staged_content(path)
            if idx is None:
                print(f'🟡 {path}:**{MSG_NO_INDEX}**(沒 git add?不在 repo?)'
                      f' ⇒ 本模式【不做任何宣稱】。要看全部:拿掉 --changed-only')
                env_fail += 1
                continue
            rows = scan(path, content=idx)
        else:
            rows = scan(path)
        if changed_only:
            touched = staged_new_lines(path)
            if touched is None:
                # 🛑 **fail-closed** —— 照 `scripts/greenlight.sh` 的三態成例:
                #    工具自己跑不起來 ⇒ 那是 ENV-FAIL, 不是綠也不是紅。
                print(f'🟡 {path}:**{MSG_NO_DIFF}這次動了哪幾行**(不在 repo 裡 / 有 merge 衝突 / git 失敗)'
                      f' ⇒ 本模式【不做任何宣稱】。要看全部:拿掉 --changed-only')
                env_fail += 1
                continue
            before = len(rows)
            rows = [r for r in rows if r['line'] in touched]
            skipped = before - len(rows)
            if skipped:
                print(f'ℹ️  {path}:另有 {skipped} 列溢出【不是這次改的】⇒ 本模式不報'
                      f'(要看全部:拿掉 --changed-only)')
        total += len(rows)
        if not rows:
            # 🔴 **這兩句不能共用一個字面**(2026-08-31 R2 抓的 nit):
            #    `--changed-only` 底下「這次沒改壞」與「這個檔真的乾淨」是**兩個宣稱**,
            #    而上一行剛印完「另有 N 列溢出」⇒ 再印「沒有被丟掉的內容」是**自相矛盾且假**。
            #    📌 而本 repo 的常態就是後者(19 檔 / 45 列存量, 2026-08-31 當場量)。
            if changed_only and skipped:
                print(f'✅ {path}:**這次改的那幾行**沒有把內容弄丟(而那 {skipped} 列存量還在)')
            else:
                print(f'✅ {path}:沒有被丟掉的內容')
            continue
        lostc = sum(r['lost_chars'] for r in rows)
        a = sum(1 for r in rows if r['shape'] == 'A')
        b = sum(1 for r in rows if r['shape'] == 'B')
        print(f'🔴 {path}:{len(rows)} 列的內容會在渲染時被丟掉,共 {lostc} 字')
        print(f'   形狀A(追記寫在收尾豎線後面)= {a} 列 ⇒ 修法:把它搬到那根 `|` 前面')
        print(f'   形狀B(裸豎線長在反引號裡)  = {b} 列 ⇒ 修法:寫成 \\| 或拆成兩個 code span')
        for r in sorted(rows, key=lambda x: -x['lost_chars']):
            head = re.sub(r'\s+', ' ', r['lost']).strip()
            print(f"\n  第 {r['line']} 行(表頭在 :{r['header_line']},{r['ncol']} 欄;"
                  f"這一列 {r['got']} 格;形狀{r['shape']};丟 {r['lost_chars']} 字)")
            print(f"     被丟掉的:{head[:180]}")
    print('\n🛑 這一發【證不到】什麼:')
    print('   · 它只認以 `|` 開頭的行 —— 縮排表格 / HTML table 它看不到')
    print('   · 它不判內容重不重要 —— 上面印的那幾段要不要急,是人的判斷')
    print('   · 🔴 檔案裡那些字【一個都沒少】⇒ grep / cat 讀得到')
    print('     ⇒ 這個病只在【把它渲染成表格】的地方成立;沒有人那樣讀 ⇒ 今天損害為零')
    if env_fail:
        # 🛑 ENV-FAIL 排在紅前面:**「我沒量到」比「我量到 0」更該先講。**
        # ⚠️ **它也蓋掉已經量到的 1**(A 檔真紅 + B 檔 env-fail ⇒ 印了紅列而回 2)。
        #    刻意的:紅的那幾列**印在畫面上了**, 而「有一支檔我沒量到」只有 rc 帶得出去。
        return 2
    return 1 if total else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
