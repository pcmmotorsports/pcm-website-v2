#!/usr/bin/env python3
"""板列衝突逐列合併 —— 而它存在的理由是【同一段 python 被貼了七次, 而 bug 在第一次就在】。

══ 為什麼要有這支檔(2026-09-04 主視窗 `-94` 自陳)════════════════════════════

主視窗做了七輪「收割」(把各線的板列合進 `docs/launch-todo.md`), 每一輪貼同一段
即興 python。而那段 python 有一個 bug:

    保留 HEAD 那列時, 【沒有把對方那列從待處理集合 pop 掉】
    ⇒ 它稍後被當成「對方獨有」再接回來 ⇒ 同一個錨佔兩列

🔴 **⇒ 那就是 2026-09-04 一整天 5 組重複列的成因** —— 而主視窗早上把成因歸給
   「錨寫在標題欄」, **那只是【讓 bug 顯形的資料】, 真正的 bug 在迴圈裡。**
📌 **⇒ 貼七次 = 複製 bug 七次。它在手上壞了七次, 在檔裡只能壞一次。**

══ 這支檔【不】做什麼 ═════════════════════════════════════════════════════

🛑 **它不碰 git。** 它讀一份【已經帶著衝突標記的檔】, 算出合併後的內容。
   ⇒ 所以「剝繼承來的 git 環境」那條紀律**今天不適用** —— 而這句要留著:
     下一個想給它加 `git` 呼叫的人, 要先回去讀 `.husky/selftest-git-isolation-gate.sh`。
🛑 **它不判斷「兩列講的是不是同一件事」** —— 它只認【錨】。錨不同的兩列, 就算內容
   幾乎一樣, 它兩邊都留。

══ 判準(與 `board-state-consistency.py` 的規則⑤【共用同一份定義】)══════════

身分 = 錨欄 `f[2]` 剝掉刪除線之後的第一個錨, key 做空白與大小寫正規化。
🔴 **`split_cells` 與 `ANCHOR_RE` 是 import 進來的, 不是重寫一份** ——
   兩支檔對「錨欄是哪一欄」若有分歧, 這支合出來的東西會被那支擋下,
   而**分歧本身不會有任何東西叫**。
"""

import importlib.util
import os
import re
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location(
    '_bs', os.path.join(_HERE, 'board-state-consistency.py'))
_bs = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_bs)

split_cells = _bs.split_cells
ANCHOR_RE = _bs.ANCHOR_RE

START, MID, END = '<<<<<<< ', '=======', '>>>>>>> '


def row_key(line):
    """回這一列的身分 key。

    帶錨的列 ⇒ 正規化過的錨(與規則⑤同一套)。
    不帶錨的列 ⇒ **整行字面**。
    🔴 後者是刻意的:沒有錨就沒有身分, 而拿別的東西當身分會把
       【兩列不同的事】合成一列 —— 那個損壞比重複列難查得多
       (重複列至少有規則⑤在叫;被合掉的那列沒有任何東西會叫)。
    """
    f = split_cells(line)
    if len(f) > 2:
        m = ANCHOR_RE.search(re.sub(r'~~.*?~~', '', f[2]))
        if m:
            return ('anchor', m.group(1).strip().lower())
    return ('literal', line.strip())


def merge_block(ours, theirs):
    """逐列合併一個衝突塊。回 (合併後的行, 說明清單)。

    規則:
      同 key 兩側都有 ⇒ 取【比較長】那一份(長 = 有人補過內容), 而**對方那份要 pop 掉**
      同 key 而逐字相同 ⇒ 只留一(取哪一份都一樣)
      只有一側有       ⇒ 留下
    順序:我側的順序優先, 對方獨有的接在後面(照它自己的順序)。
    """
    pending = {}
    for l in theirs:
        pending.setdefault(row_key(l), []).append(l)

    out, notes = [], []
    for l in ours:
        k = row_key(l)
        if k in pending and pending[k]:
            other = pending[k].pop(0)          # 🔴 **pop** —— 這一行就是那個 bug 的修法
            if not pending[k]:
                del pending[k]
            if other == l:
                notes.append(('identical', k[1][:40]))
                out.append(l)
            else:
                keep = other if len(other) > len(l) else l
                notes.append(('longer:' + ('theirs' if keep is other else 'ours'), k[1][:40]))
                out.append(keep)
        else:
            notes.append(('ours-only', k[1][:40]))
            out.append(l)

    for l in theirs:
        k = row_key(l)
        if k in pending and l in pending[k]:
            pending[k].remove(l)
            if not pending[k]:
                del pending[k]
            notes.append(('theirs-only', k[1][:40]))
            out.append(l)
    return out, notes


def resolve(text):
    """把整份檔裡每一個衝突塊解掉。回 (新內容, 每塊的說明)。"""
    lines = text.split('\n')
    out, blocks, i = [], [], 0
    while i < len(lines):
        if not lines[i].startswith(START):
            out.append(lines[i]); i += 1; continue
        j = i + 1
        ours = []
        while j < len(lines) and lines[j] != MID:
            ours.append(lines[j]); j += 1
        if j >= len(lines):
            raise SystemExit('🔴 衝突塊只有開頭沒有 =======, 檔壞了 ⇒ 不動它')
        k = j + 1
        theirs = []
        while k < len(lines) and not lines[k].startswith(END):
            theirs.append(lines[k]); k += 1
        if k >= len(lines):
            raise SystemExit('🔴 衝突塊沒有 >>>>>>> 收尾, 檔壞了 ⇒ 不動它')
        merged, notes = merge_block(ours, theirs)
        blocks.append((i + 1, len(ours), len(theirs), len(merged), notes))
        out.extend(merged)
        i = k + 1
    return '\n'.join(out), blocks


def main(argv):
    apply_it = '--apply' in argv
    paths = [a for a in argv if not a.startswith('-')]
    path = paths[0] if paths else 'docs/launch-todo.md'
    text = open(path, encoding='utf-8').read()
    if START not in text:
        print(f'✅ {path} 沒有衝突標記 ⇒ 不用做事')
        return 0
    new, blocks = resolve(text)
    for line, no, nt, nm, notes in blocks:
        print(f'  塊 :{line}  我側 {no} 列 · 對面 {nt} 列 ⇒ 合成 {nm} 列')
        for what, who in notes:
            print(f'     {what:<14} {who}')
        # 🔴 守恆:合出來的列數不得多於兩側之和, 也不得少於較長那側
        if nm > no + nt or nm < max(no, nt):
            print(f'  🔴 列數不合理({nm} 不在 [{max(no, nt)}, {no + nt}] 之內)⇒ 不寫檔')
            return 2
    if START in new:
        print('🔴 解完之後【還有衝突標記】⇒ 不寫檔')
        return 2
    if apply_it:
        open(path, 'w', encoding='utf-8').write(new)
        print(f'✅ 已寫回 {path}')
        print('🔴 下一步:跑 `python3 scripts/board-state-consistency.py` —— '
              '規則⑤ 是這支腳本的【事後閘】。它紅 ⇒ 這次合併把重複列放進去了。')
    else:
        print(f'🔵 這是【乾跑】—— 沒有動 {path}。要真的寫回請加 --apply')
    return 0


def selftest():
    """三個世界。🔴 而它們必須印【不同】的東西, 不是三次同一個綠。"""
    ok = True

    def chk(name, ours, theirs, want):
        nonlocal ok
        got, _ = merge_block(ours, theirs)
        good = got == want
        print(('  ✅ ' if good else '  🔴 ') + name)
        if not good:
            print(f'     得到 {got}')
            print(f'     期望 {want}')
            ok = False

    a_short = '| open | ⟦zzq-A⟧ | 甲 | 待派 | x |'
    a_long = '| open | ⟦zzq-A⟧ | 甲, 而有人補了一整段更長的內容 | 待派 | xxxxx |'
    b = '| open | ⟦zzq-B⟧ | 乙 | 待派 | x |'
    c = '| open | ⟦zzq-C⟧ | 丙 | 待派 | x |'

    chk('世界①·同錨不同長 ⇒ 取長的那一份, 只留一列',
        [a_short], [a_long], [a_long])
    chk('世界②·兩側【逐字相同, 只是順序不同】⇒ 只留一份(這裡聯集 = 複製)',
        [a_short, b, c], [b, c, a_short], [a_short, b, c])
    chk('世界③·一側獨有 ⇒ 兩邊都留', [a_short], [b], [a_short, b])
    # 🔴 這一格直接守著那個 bug:對方那列若沒被 pop, 它會在「對方獨有」那圈再進來一次
    chk('世界④·同錨保留我側之後, 對方那列【不得】再被當成獨有接回來(那就是原 bug)',
        [a_long], [a_short], [a_long])
    chk('世界⑤·不帶錨的列用整行當身分 ⇒ 逐字相同只留一, 不同則兩邊都留',
        ['| open | — | 甲 | 待派 | x |'],
        ['| open | — | 甲 | 待派 | x |', '| open | — | 乙 | 待派 | x |'],
        ['| open | — | 甲 | 待派 | x |', '| open | — | 乙 | 待派 | x |'])
    chk('世界⑥·錨只差【劃掉的舊字面】⇒ 視為同一個錨(與規則⑤同一套判準)',
        ['| open | ⟦zzq-A⟧ | 甲 | 待派 | x |'],
        ['| open | ~~⟦zzq-OLD⟧~~ ⟦zzq-A⟧ | 甲而更長更長更長更長 | 待派 | x |'],
        ['| open | ~~⟦zzq-OLD⟧~~ ⟦zzq-A⟧ | 甲而更長更長更長更長 | 待派 | x |'])
    print('全部通過。' if ok else '🔴 有格沒過。')
    return 0 if ok else 1


if __name__ == '__main__':
    if '--selftest' in sys.argv:
        sys.exit(selftest())
    sys.exit(main(sys.argv[1:]))
