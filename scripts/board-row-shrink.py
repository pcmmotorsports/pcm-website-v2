#!/usr/bin/env python3
r"""board-row-shrink.py —— 同一個錨的板列, 改完之後【變短了】就報。

══ 為什麼有它(2026-09-07 `-auth` 自陳事故)════════════════════════════════════
我改寫 `docs/launch-todo.md` 的一列(commit `e7f9d0df2`), **弄丟了別人 21 段
`<br>` 的歷史**。而我當下跑的兩道自檢:
    ① 欄數 == 7      ✅ 過
    ② 沒有裸 `|`      ✅ 過
🔴 **兩道都不看「內容有沒有變少」** —— 一列被改短與被改對, 在它們眼裡一模一樣。
📌 母題:欄數與格式檢查守的是【形狀】, 而丟失的是【體積】。

══ 它答什麼 / 答不出什麼 ═════════════════════════════════════════════════════
✅ 答:HEAD 與新版**同時存在**的錨, 那一列的 `<br>` 段數或字元長度**下降**了沒有。
🛑 答不出:① 整列被刪掉(那是「錨消失」, 歸 board-state-consistency 的錨檢)
          ② 長度沒變而內容被換掉(等量替換)
          ③ 新增的列(HEAD 沒有 ⇒ 沒有對照)

══ 為什麼是【停】不是【擋】(門檻是量出來的, 不是我發明的)═══════════════════
2026-09-07 對最近 40 顆碰板的 commit 實測:**30,251 對同錨列, 只有 43 對縮水**
(0.14%;掉的量最小 4 段 / 中位 1302 字元)⇒ **合法縮水是存在的而極罕見**。
⇒ 所以:**任何下降都報**(不需要調門檻, 它本身就有鑑別力), 而 **rc=3 = 停下看一眼**,
   不是 rc=1 擋死 —— 因為「收窄末格」「刪過期字面」是真的會發生的正當動作。

rc: 0 沒有列縮水 · 3 有列縮水(停下看) · 2 用法錯 · 1 工具自己壞了
"""
import subprocess, re, sys, os

BOARD = 'docs/launch-todo.md'

# 🔴🔴 出口:hook 裡沒有「停」這個狀態(2026-09-08 主視窗 B 指出;而它是對的)
#    `lint-staged` / `pre-commit` **只認 rc** —— 非 0 = commit 被擋下,
#    沒有「停下來確認然後繼續」。⇒ 第一個遇到【正當縮減】的人面對的是一個他過不去的門,
#    而他手上唯一的工具是 `git commit --no-verify` ⇒ 🛑 **那會把所有 hook 一起關掉, 比沒有這道閘糟。**
#    ✅ 所以出口必須:① 比 `--no-verify` 容易 ② **只放行他打出來的那個錨**
#      ③ **打出錨這個動作本身, 就是「我看過了」的證據**。
#    🛑 而它【不是】關掉整道閘的開關 —— 萬用字元一律拒絕(見 `_acked()`),
#      因為「設一個變數關掉整道閘」與 `--no-verify` 只差一個名字。
ACK_ENV = 'BOARD_SHRINK_ACK'
# 拒絕清單:任何「放行全部」的意思。🔴 這是白名單思維的反面, 而這裡刻意用黑名單 ——
# 因為合法的值是【板上的錨】, 那是一個開放集合, 列不完;而「放行全部」的寫法是有限的。
_ACK_WILDCARDS = {'*', 'all', 'ALL', 'any', 'ANY', '.*', 'true', '1', 'yes'}
# 🔴 字元類要把【開括號】一起排除 —— 否則遇到沒閉合的 `⟦` 會一路吞到下一個 `⟧`,
#    把鄰居的錨吃進來(板列 ⟦b9-UNCLOSEDANCHOR⟧;本檔出生當天被 greedy-anchor 閘擋下)。
ANCHOR = re.compile(r'⟦([^⟦⟧]+)⟧')
# 🔴 豎線要排除跳脫過的 —— 與 `scripts/board-row-shrink-check.py` 同一個式子(不各寫一份)。
SPLIT = re.compile(r'(?<!\\)\|')
# 板上的資料列:`| 態 | 錨 | 內文 | 誰 | 末格 |` ⇒ 切開後【第 2 格】是錨欄。
ANCHOR_COL = 2
MIN_FIELDS = 5


def _rows(text):
    """回 `(資料, 三桶分母)`。**key = `(錨, 同錨之內的第幾列)`** —— 按出現序配對。

    ⛔ ~~同錨多列時取【最長】那列~~(2026-09-08 `-auth` 第一版)⇒ 🛑 **那是【碰巧對】不是【設計對】**:
       真列本來就比「正本在下面」那種指標列長, 所以剛好選對 —— 而**指標列會變長**
       (同夜實例:有人把同一段複製進六列, 一列 2505⇒3685)⇒ **它會在某一天安靜地翻掉**。

    🛑 **而【不是】改成「用反引號判指標列」** —— 主視窗 B 提了那個, 而我量完推翻它:
       ① 那個判準來自 `board-row-shrink-check.py` 的 **docstring**, 而**它的碼沒有實作**;
       ② 那段 docstring 指的規則 **2026-09-07 已被主視窗拍甲訂正**
          (`scripts/board-row-by-anchor.sh:12-30`:**整欄只有一個反引號錨 ⇒ 那是它自己的**);
       ③ 🔬 今天實測:錨欄【整欄只有一個反引號錨】的列 = **84** ⇒ 照舊版做, **那 84 列的縮水沒有人守**;
          而 17 個一錨多列的錨裡, 訂正後判準**只解得掉 1 個**(其餘 16 個是真的有兩列)。
       ⇒ 🎯 **反引號不是這件事的鑑別式。**

    ✅ **改成按出現序配對**:第 1 列對第 1 列、第 2 列對第 2 列 ⇒ **17 個錨全部進分母**
       (舊做法它們全部出局), 而「一列縮一列長」**不會互相抵銷**。
    🔴 **風險寫死, 不藏**:有人**插一列或調換順序** ⇒ 序號位移 ⇒ 可能誤報。
       🎯 而它量得出來 —— 見 `CHAR_DROP_FLOOR` 上面那段的誤報率紀錄。

    🔵 **三桶分母一起回**(取自 `board-row-shrink-check.py` 的做法):只印一個 0 的話,
       「尺壞了」與「真的沒有」是同一個畫面。
    """
    out, seen = {}, {}
    buckets = {'無錨': 0, '欄少於5': 0}
    for ln in text.splitlines():
        if not ln.startswith('| '):
            continue
        f = SPLIT.split(ln)
        if len(f) < MIN_FIELDS:
            buckets['欄少於5'] += 1
            continue
        m = ANCHOR.search(f[ANCHOR_COL])
        if not m:
            buckets['無錨'] += 1
            continue
        k = m.group(1)
        seen[k] = seen.get(k, 0) + 1
        out[(k, seen[k])] = ln
    buckets['一錨多列'] = sum(1 for c in seen.values() if c > 1)
    return out, buckets


def _git_show(ref_path, cwd=None):
    r = subprocess.run(['git', 'show', ref_path], capture_output=True, text=True, cwd=cwd)
    if r.returncode:
        raise RuntimeError(f'git show {ref_path} rc={r.returncode}: {r.stderr.strip()[:200]}')
    return r.stdout


# 🔴 字元下降的門檻 = 板上 `<br>` 分段長度的 10 百分位(2026-09-08 當場量:44 字元)。
#    ⛔ ~~任何字元下降都報~~ ⇒ 實測 40 顆 commit 會誤報 3 顆, 而那 3 顆掉的都是 **4 字元**
#      (同一列 `⟦b9-REFUNDNUM1⟧` 的一次排版正規化, 被三個窗各 merge 一次 = 同一件事數三遍;
#       而那三顆的 `<br>` 其實是【變多】的 48→49)。
#    📌 分布 `[4, 4, 4, 1687, 2916]` —— 中間的空隙不是我挑的, 是量出來的。
#    ✅ 44 的意思是「**至少掉了一小段的量**」, 比 4 大得多、比真事故的 1687 小得多。
CHAR_DROP_FLOOR = 44


def _acked():
    """讀 BOARD_SHRINK_ACK ⇒ (放行的錨集合, 被拒絕的萬用字元)。"""
    raw = os.environ.get(ACK_ENV, '')
    toks = [t.strip() for t in re.split(r'[,\s]+', raw) if t.strip()]
    bad = [t for t in toks if t in _ACK_WILDCARDS or '*' in t]
    return set(toks) - set(bad), bad


def ack_names(hits, gone):
    """出口那一行要放的錨字串。

    🔴🔴 **這裡出過一次真的 bug(2026-09-08, 序號配對改完當天)**:key 從 `錨` 變成
       `(錨, 第幾列)` 之後, 這裡還在 `','.join(keys)` ⇒ **TypeError** ⇒ 🛑 **rc 變成 1
       (我的合約裡那是「工具自壞」)** —— 而它印在【已經印完 finding 之後】,
       📌 **所以畫面上看起來完全正常, 只有最後一行是 traceback。**
    🔴 **而自檢沒抓到它** —— 自檢只測 `filter_acked()` / `_acked()` 兩個函式,
       **從來沒有走過 `main()` 這條輸出路**。⇒ ✅ 所以本函式被抽出來, 並加了一格自檢。
    🔵 去重且保序:同一個錨的兩列同時縮水時, 出口只需要打一次那個錨。
    """
    out = []
    for k, *_ in hits:
        if k[0] not in out:
            out.append(k[0])
    for k in gone:
        if k[0] not in out:
            out.append(k[0])
    return ','.join(out)


def _show(k):
    """`(錨, 第幾列)` ⇒ 給人看的字。同錨只有一列時不印序號(免得每一列都多一個 #1)。"""
    return f'⟦{k[0]}⟧' if k[1] == 1 else f'⟦{k[0]}⟧#{k[1]}'


def filter_acked(hits, gone, acked):
    """把已確認的錨濾掉。🔴 放行【A】絕不可以順便放行【B】—— 這是本出口的安全性質。

    🔵 放行的單位是【錨】不是【第幾列】—— 一個錨的兩列同時縮水時, 打一次錨就都放行。
       那是刻意的:要人分別放行 `⟦X⟧#1` 與 `⟦X⟧#2`, 打錯的機會比它擋掉的風險大。
    """
    return ([h for h in hits if h[0][0] not in acked],
            [k for k in gone if k[0] not in acked])


def compare(old_text, new_text):
    """回傳 [(錨, br舊, br新, len舊, len新)] —— 只收【下降】的。

    🛑 `<br>` 下降【一段就報】(實測 40 顆 commit 誤報 0);
       字元下降要 >= CHAR_DROP_FLOOR 才報(否則排版正規化會吵)。
    """
    old, _ = _rows(old_text)
    new, _ = _rows(new_text)
    hits = []
    for k in sorted(set(old) & set(new)):
        b0, b1 = old[k].count('<br>'), new[k].count('<br>')
        l0, l1 = len(old[k]), len(new[k])
        if b1 < b0 or (l0 - l1) >= CHAR_DROP_FLOOR:
            # k = (錨, 第幾列);同錨只有一列時第幾列恆為 1, 顯示時不印它
            hits.append((k, b0, b1, l0, l1))
    return hits


def vanished(old_text, new_text):
    """整列不見了的錨 —— 🔴 那【不是變短, 是消失】, `compare()` 看不到它(它只走交集)。

    2026-09-08 B 問「整列被刪掉時你的尺印什麼」⇒ 當時的答案是【印沒事】⇒ 補這一格。
    ⚠️ 實測最近 40 顆碰板 commit **一列都沒消失過** ⇒ 這格**沒有真實正對照**, 只有自檢造的。
       📌 所以它報的是「停下看一眼」不是「出事了」—— 合併重複列本來就會讓一個錨消失。
    """
    return sorted(set(_rows(old_text)[0]) - set(_rows(new_text)[0]))


def selftest():
    # 🔴 剝掉繼承來的 git 環境 —— 否則 selftest 會在【呼叫者的 index】上跑
    for v in ('GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE', 'GIT_OBJECT_DIRECTORY',
              'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_NAMESPACE'):
        os.environ.pop(v, None)

    # 🔴🔴 **欄形照【真板】**(2026-09-08 訂正):`| 態 | 錨 | 內文 | 誰 | 末 |` ⇒ 切開後第 2 格是錨欄。
    #    ⛔ ~~第一版 fixture 是 `| | open | ⟦A⟧ | … |`~~(多一個前導空格欄)⇒ 那裡的 `f[2]` 是 `open`,
    #    📌 **不是錨欄** —— 而舊 `_rows` 只找「整行第一個錨」所以照樣綠。
    #    🛑 **⇒ 那些綠一直建在一種【板上不存在的列】上。**
    def row(anchor, body, tail='末'):
        return f'| open | ⟦{anchor}⟧ | {body} | 誰 | {tail} |'

    base = row('A', '甲<br>乙<br>丙') + '\n' + row('B', '丁') + '\n'
    ok = True

    def cell(name, got, want):
        nonlocal ok
        good = got == want
        print(f'  {name} ⇒ {got} (期望 {want}) {"✅" if good else "❌"}')
        ok &= good
        return good

    # ── 先確認 fixture 真的被讀成資料列(不然下面每一格都不算數)──
    d, b = _rows(base)
    cell('尺有接上 資料列數', len(d), 2)
    cell('尺有接上 無錨桶', b['無錨'], 0)

    cell('負對照 一字未改', len(compare(base, base)), 0)
    cell('正對照① 掉一段 <br>',
         len(compare(base, base.replace('甲<br>乙<br>丙', '甲<br>乙'))), 1)

    # 🔴 第二格的 fixture 我改壞過兩次(`丙`→`X` 沒變短 / 加門檻後只掉 1 字元)—— 註解留著。
    long_base = row('A', '甲<br>乙<br>' + '丙' * 80) + '\n'
    cell('正對照② <br>同數而掉 60 字元',
         len(compare(long_base, long_base.replace('丙' * 80, '丙' * 20))), 1)

    cell('邊界 變長不報', len(compare(base, base.replace('丁', '丁<br>戊'))), 0)
    cell('邊界 新錨不報', len(compare(base, base + row('C', '新') + '\n')), 0)
    cell('門檻 掉 1 字元不報', len(compare(base, base.replace('丁', ''))), 0)
    long_row = row('D', 'X' * 200) + '\n'
    cell('門檻 掉 100 字元要報',
         len(compare(base + long_row, base + long_row.replace('X' * 200, 'X' * 100))), 1)

    # 🔴 整列消失:compare 走交集看不到, vanished 才看得到
    gone_new = row('B', '丁') + '\n'
    cell('整列消失 compare 看不到', len(compare(base, gone_new)), 0)
    cell('整列消失 vanished 撈到', [k[0] for k in vanished(base, gone_new)] == ['A'], True)

    # ══ 序號配對:2026-09-08 主視窗 B 批「甲」的那四格 ══════════════════════
    # ① 指標列【比真列長】⇒ 舊「取最長」會選錯那一列 ⇒ 砍真列必須紅
    # 🔴 這格的 fixture 我也寫錯過(第三次同型):真列只掉 25 字元 ⇒ **低於 44 門檻** ⇒ 不該紅也沒紅,
    #    而我讀成「序號配對沒生效」。📌 **fixture 沒把待測情境做到門檻之上, 那一格什麼都沒測。**
    真列 = row('E', '真' * 100)
    指標列 = row('E', '`⟦E⟧` 的正本在上面 ' + '註' * 200)
    兩列 = 真列 + '\n' + 指標列 + '\n'
    砍真列 = row('E', '真' * 5) + '\n' + 指標列 + '\n'
    cell('序號① 指標列比真列長, 砍真列要紅', len(compare(兩列, 砍真列)), 1)
    cell('序號① 舊做法(取最長)會漏 —— 它選到的是指標列',
         len(指標列) > len(真列), True)

    # ② 錨欄【整欄只有一個反引號錨】⇒ 必須當成真列(守住那 84 列)
    反引號列 = '| open | `⟦F⟧` | ' + '文' * 100 + ' | 誰 | 末 |\n'
    砍它 = '| open | `⟦F⟧` | ' + '文' * 10 + ' | 誰 | 末 |\n'
    cell('序號② 錨欄整欄只有反引號錨 ⇒ 仍受保護', len(compare(反引號列, 砍它)), 1)

    # ③ 同錨兩個真列, 一縮一長 ⇒ 不可以互相抵銷
    前 = row('G', '甲' * 100) + '\n' + row('G', '乙' * 100) + '\n'
    後 = row('G', '甲' * 10) + '\n' + row('G', '乙' * 300) + '\n'
    cell('序號③ 一縮一長不抵銷', len(compare(前, 後)), 1)

    # ④ 三桶分母有數字(不是恆 0)
    髒 = base + '| 沒有錨的一列 | 內文 | 誰 | 末 | 加一格 |\n' + '| 三欄 | 小表 |\n'
    _, bk = _rows(髒)
    cell('序號④ 無錨桶會動', bk['無錨'], 1)
    cell('序號④ 欄少於5 桶會動', bk['欄少於5'], 1)

    # ───── 出口 BOARD_SHRINK_ACK ─────
    hs = [(('A', 1), 5, 2, 900, 400), (('B', 1), 4, 1, 800, 300)]
    gs = [('C', 1)]

    def ack(v):
        os.environ[ACK_ENV] = v
        return _acked()

    a, w = ack('A')
    lh, lg = filter_acked(hs, gs, a)
    cell('出口 放行 A ⇒ 剩', [x[0][0] for x in lh] + [k[0] for k in lg], ['B', 'C'])

    a, w = ack('A, C')
    lh, lg = filter_acked(hs, gs, a)
    cell('出口 逗號多錨 ⇒ 剩', [x[0][0] for x in lh] + [k[0] for k in lg], ['B'])

    a, w = ack('ZZ-NOSUCH')
    lh, lg = filter_acked(hs, gs, a)
    cell('出口 錨打錯 ⇒ 仍叫幾列', len(lh) + len(lg), 3)

    for v in ('*', 'all', 'ANY', 'b4-*', '1'):
        a, w = ack(v)
        lh, lg = filter_acked(hs, gs, a)
        cell(f'出口 萬用字元 {v!r} 被拒且仍叫 3', bool(w) and len(lh) + len(lg) == 3, True)

    os.environ.pop(ACK_ENV, None)
    a, w = _acked()
    cell('出口 沒設變數 ⇒ 放行', sorted(a), [])

    # 🔴 這一格是為了那個【自檢跑不到 main() 輸出路】的洞加的(2026-09-08 真 bug)
    cell('出口 那一行的錨字串', ack_names(hs, gs), 'A,B,C')
    cell('出口 同錨兩列只打一次錨',
         ack_names([(('X', 1), 0, 0, 0, 0), (('X', 2), 0, 0, 0, 0)], []), 'X')

    print('selftest', 'PASS' if ok else 'FAIL')
    return 0 if ok else 1


def main(argv):
    if '--selftest' in argv:
        return selftest()
    staged = '--staged' in argv
    try:
        old = _git_show(f'HEAD:{BOARD}')
        new = _git_show(f':{BOARD}') if staged else open(BOARD, encoding='utf-8').read()
    except (RuntimeError, OSError) as e:
        print(f'⚠️ 工具自己壞了(不是「沒有縮水」): {e}', file=sys.stderr)
        return 1

    hits = compare(old, new)
    gone = vanished(old, new)
    _, nb = _rows(new)
    src = 'index(--staged)' if staged else '工作樹'
    acked, wildcards = _acked()

    if wildcards:
        print(f'🛑 {ACK_ENV} 收到「放行全部」的值 {wildcards} ⇒ 拒絕。', file=sys.stderr)
        print(f'   這道閘的出口是【逐個錨】—— 一個放行全部的開關與 --no-verify 只差一個名字。',
              file=sys.stderr)

    all_names = [k[0] for k, *_ in hits] + [k[0] for k in gone]
    left_hits, left_gone = filter_acked(hits, gone, acked)
    used = sorted(acked & set(all_names))
    unused = sorted(acked - set(all_names))

    if used:
        print(f'🔵 已確認放行:{", ".join("⟦%s⟧" % k for k in used)}')
    if unused:
        print(f'⚠️ {ACK_ENV} 裡有 {len(unused)} 個錨【本次根本沒被叫到】:'
              f'{", ".join("⟦%s⟧" % k for k in unused)}', file=sys.stderr)
        print('   ⇒ 錨打錯了, 或那一列這次沒縮水。放行不會生效在你以為的那一列上。', file=sys.stderr)

    if not left_hits and not left_gone and not wildcards:
        print(f'✅ {BOARD} ({src}) 對 HEAD:沒有未確認的縮水。')
        return 0

    print(f'🛑 停下看一眼({src} vs HEAD)—— 變短 {len(left_hits)} 列 · 整列消失 {len(left_gone)} 列:')
    for k, b0, b1, l0, l1 in left_hits:
        print(f'  變短  {_show(k)}  <br> {b0}→{b1}   字元 {l0}→{l1}')
    for k in left_gone:
        print(f'  消失  {_show(k)}  ← 整列不見了(合併重複列是正當的, 而請說一句是哪一種)')
    print(f'\n⚪ 比不了的三桶(印出來, 那個數字才有分母):'
          f'無錨 {nb["無錨"]} 列 · 一錨多列 {nb["一錨多列"]} 個錨(**已按出現序全部納入**)'
          f' · 欄少於 5 {nb["欄少於5"]} 列')
    names = ack_names(left_hits, left_gone)
    print('\n📌 這是【停】不是【擋】:收窄末格、刪過期字面、合併重複列都是正當的。')
    print('   要答的是:少掉的那些字, 是我有意刪的, 還是我重寫整列時【沒抄回來】的?')
    print('\n✅ 看過了、確認是有意的 ⇒ 照抄這一行(它只放行下面這幾個錨, 不會關掉這道閘):')
    print(f"\n   {ACK_ENV}='{names}' git commit -F <你的訊息檔> -- <你的檔>\n")
    print('   🔴 而 commit body 要寫一句【為什麼少】—— 那句話是給下一個人的,'
          ' 不是給這道閘的。')
    print(f'   🛑 不要用 git commit --no-verify:那會把【所有】hook 一起關掉。')
    return 3


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
