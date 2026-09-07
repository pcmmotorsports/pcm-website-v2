#!/usr/bin/env python3
r"""哪些**負對照字面**已經被寫進板子 ⇒ 它對板子**不再是負對照**。

用法:
    python3 scripts/negative-control-burned.py
    python3 scripts/negative-control-burned.py --selftest

🔴 **起因**(2026-09-07 `-ship` 回報, tidy 複驗成立):`zzq9never` 被寫進板列
   ⇒ **下一個拿它當負對照的人會拿到 1**, 而那個 1 讀起來像「尺壞了」或「這東西真的存在」。

🎯 **本尺答的問題**:
   **一個現在還在被腳本使用的負對照字面, 是不是已經出現在板子上了?**

🛑 **它答不出什麼(先講, 免得被當成背書)**:
  · 它**不主張那些字面該從板上拿掉** —— 板列寫「負對照 `zzz-bogus` ⇒ 0」是**誠實的量測紀錄**,
    那是對的。**壞掉的不是板子, 是【重複使用】那個字面的下一個人。**
  · 它只認 `zz` 開頭的形狀。別種現造字(`notathing2026` / `qqq…`)**不在射程**。
  · 它比的是**板檔**;同一個字面被寫進 `docs/` 別處或 memory, 本尺看不到。

📌 **⇒ 正確的用法是【每次現造】**:負對照字面帶當下時間戳(本 repo 已有先例:
   `zzz-not-on-board-20260828`)⇒ **寫死的假字面有一天會變成真的。**
"""
import io
import os
import re
import sys

BOARD = 'docs/launch-todo.md'
SCRIPT_DIRS = ('scripts', '.husky')
# 🔴 只認 `zz` 開頭 —— 窄是刻意的:寬了會把真識別字掃進來, 而誤報會讓人開始略過本尺。
SHAPE = re.compile(r'\bzz[A-Za-z0-9_-]{2,}')


def board_hits(path):
    """回 {字面: 出現次數}。檔不在 ⇒ None(**與「零命中」分得開**)。"""
    if not os.path.isfile(path):
        return None
    c = {}
    for m in SHAPE.finditer(io.open(path, encoding='utf-8').read()):
        c[m.group(0)] = c.get(m.group(0), 0) + 1
    return c


def in_use(dirs, exclude=None):
    """回 {字面: [用它的檔]} —— 腳本裡**現在還在用**的負對照字面。

    🔴 **本工具【自我排除】**:它的檔頭與 selftest 就在**解釋**那些字面
       (`zzq9never` / `zzz-bogus` / `zzz-not-on-board-20260828`)
       ⇒ 不排除的話它把**自己**報成「還在用」三次。
       📌 **一份【在解釋某些字面】的檔案, 對一把【找那些字面】的尺是最壞的輸入** ——
          本 repo 今天第四次同型(ship 的閘 · 板列說明文裡的真豎線 · 整行 grep 撈到正本)。
    """
    u = {}
    skip = os.path.realpath(exclude) if exclude else os.path.realpath(__file__)
    for d in dirs:
        if not os.path.isdir(d):
            continue
        for fn in sorted(os.listdir(d)):
            p = os.path.join(d, fn)
            if not os.path.isfile(p) or os.path.realpath(p) == skip:
                continue
            try:
                src = io.open(p, encoding='utf-8', errors='replace').read()
            except OSError:
                continue
            for m in set(SHAPE.findall(src)):
                u.setdefault(m, []).append(p)
    return u


def main():
    hits = board_hits(BOARD)
    used = in_use(SCRIPT_DIRS)
    if hits is None:
        print(f'⏸️  量不到:讀不到 {BOARD} ⇒ **不是「沒有被燒掉的負對照」**')
        return 2
    # 🔴 交集才是危險的那一組:板上有 + 腳本還在用
    burned = sorted((k, hits[k], used[k]) for k in used if k in hits)
    only_board = sorted(k for k in hits if k not in used)
    print(f'掃板 `{BOARD}` ⇒ `zz` 形狀字面 **{len(hits)}** 種 · '
          f'腳本裡在用的 **{len(used)}** 種')
    print()
    if burned:
        print(f'## 🔴 已燒掉 **{len(burned)}** 種 —— 腳本【還在用】而板上已經有它')
        print()
        print('| 字面 | 板上出現 | 誰在用 |')
        print('|---|---|---|')
        for k, n, fs in burned:
            print(f'| `{k}` | {n} 次 | {" · ".join("`%s`" % f for f in fs[:3])} |')
        print()
        print('🛑 **那些腳本對【板檔】跑負對照時會拿到非 0** —— 而那個非 0 讀起來像'
              '「尺壞了」或「這東西真的存在」。')
        print()
        print(f'## 🔴🔴 **N = {len(burned)}(尺篩出來的) → M = __(真的要改幾支, 由開檔的人填)**')
        print('　**`M` 不預先印 0** —— 印出來的 0 會被讀成「量到的 0」, 而它其實是「還沒有人開檔」。')
        print('　🔵 2026-09-07 首次實測:**`N=7` ⇒ 逐支開檔 ⇒ `M=0`。**')
        print('　🛑🛑 **而其中 2 支【改了會壞掉】** ⇒ 不開檔就照著改是【製造缺陷】, 不是修東西。')
        print()
        print('### 開檔時要分辨的五種形狀(2026-09-07 逐支量到, 五種各至少一例)')
        print('| 形狀 | 例 | 要不要改 |')
        print('|---|---|---|')
        print('| ① **註解裡的歷史量測**(「負對照 X ⇒ 404」) | `probe-schema-exposure.sh` | 🟢 **不改** |')
        print('| ② **已經換過字, 舊字面留在註解** | `cancel-reason-neutral-contract.test.ts` | 🟢 **不改** |')
        print('| ③ 🔴 **它是【髒字清單】—— 它正在【找】那些字面** | `board-token-normalize.py` | 🛑 **改了會拆掉功能** |')
        print('| ④ **selftest 自己造的 fixture 名 / 不存在的路徑** | `rpc-raw-sql-callers.py` ·'
              ' `money-paths-untested.py` · `migration-new-file-static-checks.sh` | 🟢 **不改**(它不對板檔跑) |')
        print('| ⑤ 🔴 **名字本身有語意**(`zzz_` 前綴是為了讓 trigger 排在最後發火) | `op3-verify.sh` |'
              ' 🛑 **改了會改掉行為** |')
        print()
        print('📌 **⇒ 本尺答的是「這個字面同時出現在兩邊」, 答不出「它在那裡當負對照用」。**')
    else:
        print('## 🟢 沒有交集 —— 腳本在用的負對照字面, 板上一個都沒有')
    print()
    print(f'## 🔵 只在板上、沒有腳本在用的:{len(only_board)} 種(**不必處理**)')
    print('　它們是**誠實的量測紀錄**(「負對照 X ⇒ 0」)⇒ 🛑 **壞掉的不是板子,'
          '是【重複使用】那個字面的下一個人。**')
    print()
    print('📌 **修法不是從板上刪字面, 是【每次現造】** —— 負對照帶當下時間戳'
          '(本 repo 先例 `zzz-not-on-board-20260828`)。**寫死的假字面有一天會變成真的。**')
    return 1 if burned else 0


def selftest():
    import shutil
    import tempfile
    d = tempfile.mkdtemp()
    fails = []

    def ck(name, got, want):
        ok = got == want
        print(f'  {"✅" if ok else "🔴"} {name}:{got}(期望 {want})')
        if not ok:
            fails.append(name)

    b = os.path.join(d, 'b.md')
    io.open(b, 'w', encoding='utf-8').write(
        '| open | ⟦x⟧ | 負對照 zzq-burned ⇒ 0 | 誰 | ⟨擋⟩ 又一次 zzq-burned |\n'
        '| open | ⟦y⟧ | 負對照 zzq-onlyboard ⇒ 0 | 誰 | ⟨擋⟩ x |\n')
    ck('① 板上字面數得出來', board_hits(b), {'zzq-burned': 2, 'zzq-onlyboard': 1})
    ck('② 🔵 檔不在 ⇒ None(與「零命中」分得開)',
       board_hits(os.path.join(d, 'nope.md')), None)
    sd = os.path.join(d, 'scripts')
    os.makedirs(sd)
    io.open(os.path.join(sd, 'a.py'), 'w', encoding='utf-8').write(
        "NEG = 'zzq-burned'\nOTHER = 'zzq-clean'\n")
    u = in_use((sd,))
    ck('③ 腳本裡在用的抓得到', sorted(u), ['zzq-burned', 'zzq-clean'])
    # 🔴 自我排除那一格 —— 造一支「假裝是本工具」的檔, 它必須被跳過
    _self = os.path.join(sd, 'me.py')
    io.open(_self, 'w', encoding='utf-8').write("DOC = 'zzq-selfonly'\n")
    ck('③b 🔴 被指名排除的那支 ⇒ 它的字面不進來',
       'zzq-selfonly' in in_use((sd,), exclude=_self), False)
    ck('③c 🔵 而不排除時它【會】進來(證明上一格不是恆缺)',
       'zzq-selfonly' in in_use((sd,), exclude=os.path.join(sd, 'nothere.py')), True)
    os.remove(_self)
    # 🔴 端到端:走 main() 那條真的路, 不在這裡重算交集
    import contextlib
    global BOARD, SCRIPT_DIRS
    _b, _s = BOARD, SCRIPT_DIRS
    try:
        BOARD, SCRIPT_DIRS = b, (sd,)
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = main()
        o = buf.getvalue()
        ck('④端到端 交集(板上有+腳本在用)⇒ 列出來', '`zzq-burned` | 2 次' in o, True)
        # 🔴 N→M 那一段(2026-09-07:N=7 而 M=0, 其中 2 支改了會壞)
        ck('④b 有交集 ⇒ 印 N→M 表頭, 且 M 不預先印 0',
           ('M = __' in o and 'M = 0' not in o), True)
        ck('④c 明說有些【改了會壞掉】', '改了會壞掉' in o, True)
        ck('④d 印出要分辨的五種形狀', o.count('| ①') == 1 and o.count('| ⑤') == 1, True)
        ck('⑤端到端 🔵 腳本在用而板上沒有的【不列】(不是恆列)', 'zzq-clean' in o, False)
        ck('⑥端到端 🔵 板上有而沒人用的歸「不必處理」', '沒有腳本在用的:1 種' in o, True)
        ck('⑦端到端 有交集 ⇒ rc=1', rc, 1)
        ck('⑧端到端 明說壞掉的不是板子', '壞掉的不是板子' in o, True)
        # 🔵 零交集那個世界:rc 要變 0(證明上一格不是恆 1)
        io.open(os.path.join(sd, 'a.py'), 'w', encoding='utf-8').write("NEG = 'zzq-clean'\n")
        buf2 = io.StringIO()
        with contextlib.redirect_stdout(buf2):
            rc2 = main()
        ck('⑨端到端 🔵 零交集 ⇒ rc=0 且印綠字(證明不是恆 1)',
           (rc2, '🟢 沒有交集' in buf2.getvalue()), (0, True))
    finally:
        BOARD, SCRIPT_DIRS = _b, _s
        shutil.rmtree(d, ignore_errors=True)
    print('SELFTEST ' + ('PASS' if not fails else 'FAIL:' + ','.join(fails)))
    return 0 if not fails else 1


if __name__ == '__main__':
    sys.exit(selftest() if '--selftest' in sys.argv[1:] else main())
