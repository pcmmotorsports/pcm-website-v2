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


# ── 逐句合併(2026-09-05 加;-front `d910c6afd` 的整段被較長版蓋掉)────────────
# 🔴 病灶:同錨兩版只取【較長那份】⇒ 短的那份裡【對方沒有的句子】整段消失,
#    而 commit 還在(git log 找得到)、內容不在(板上讀不到)。
#    📌 「commit 在而內容不在」是最難查的一種:作者去查 git 會看到自己做了,
#       去讀板子會看到沒有 —— 而兩邊都不會叫。
SENT_RE = re.compile(r'[^。;]*?(?:。|;)|[^。;]+$')


def sentences(text):
    """把一格內容切成句。以「。」「;」結尾切, 並把 ` · ` 當成句界。

    ⚠️ 這是【啟發式】不是文法:它切不出括號裡的分號, 也切不開沒有標點的長句。
       ⇒ 切太粗的後果是【追加得比需要的多】(冗餘), 不是漏掉 —— 那個方向是安全的。
    """
    out = []
    for chunk in text.split(' · '):
        for m in SENT_RE.finditer(chunk):
            t = m.group(0).strip()
            if t:
                out.append(t)
    return out


def merge_sentences(base, other):
    """以 base 為底, 把 other 有而 base 沒有的句子追加到【最後一格】。

    回 (合併後的行, 追加了幾句)。
    🔴 追加到最後一格 = 欄數不變 ⇒ 表格不會壞。
    🔴 比對用【整行】而不是逐格 —— 同一句話搬到別格也算已經有了, 不重複追加。
    """
    # 🔴🔴 只吃【欄位內容】, 絕不吃整行 —— 整行含 `|`,
    #    把它當一句追加回去會【多出格線】⇒ 欄數變了 ⇒ 表格壞掉。
    #    (第一版就是這樣壞的, 而 selftest 世界④⑥ 當場抓到。)
    # 🔴🔴 逐【格】切句, 不把整列黏成一條 —— 黏起來之後那條字串在 base 裡永遠找不到
    #    (base 的格之間隔著 `|`)⇒ 每一次都會誤判成「對方獨有」而整列追加回去。
    #    (第一版黏了整列, selftest 世界④⑥ 當場抓到。)
    base_text = ' '.join(c for c in split_cells(base) if c.strip())
    extra = []
    for cell in split_cells(other):
        for t in sentences(cell):
            if len(t) >= 4 and t not in base and t not in base_text:
                extra.append(t.replace('|', '/'))
    if not extra:
        return base, 0
    cells = base.rstrip().rstrip('|').split('|')
    if len(cells) < 2:
        return base, 0
    cells[-1] = cells[-1].rstrip() + '<br> 🔀 **[合併自同錨的另一版]** ' + ' '.join(extra) + ' '
    return '|'.join(cells) + '|', len(extra)


def state_of(line):
    """態欄(第 2 格)。回不到就回空字串。"""
    f = split_cells(line)
    return f[1].strip() if len(f) > 1 else ''


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
                keep, drop = (other, l) if len(other) > len(l) else (l, other)
                merged, n_added = merge_sentences(keep, drop)
                # 🔴 態欄取【較新那版】= 進來的那一側(theirs)。
                #    ⚠️ 而「較新」是【由 merge 的方向推的】, 不是從內容量到的 ——
                #       兩側態不同時本支會印出來, 讓人自己看一眼。
                st_ours, st_theirs = state_of(l), state_of(other)
                if st_ours != st_theirs:
                    notes.append(('state-differs:%s|%s' % (st_ours, st_theirs), k[1][:40]))
                notes.append((('longer:' + ('theirs' if keep is other else 'ours')
                               + ('+%d句' % n_added if n_added else '')), k[1][:40]))
                out.append(merged)
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
    # ═══ 逐句合併(2026-09-05 加;-front d910c6afd 整段被蓋掉那個病)═══════
    # 🟢 正對照:A 有一句 B 沒有 ⇒ 合併後【兩句都要在】
    long_side  = '| open | ⟦zzq-M⟧ | 這一列本來就很長很長很長很長很長很長。而它講的是甲那件事。 | 待派 | x |'
    short_side = '| open | ⟦zzq-M⟧ | 而 -front 今晚補了一句只有它有的話。 | 待派 | x |'
    got, _ = merge_block([long_side], [short_side])
    both = ('很長很長' in got[0]) and ('-front 今晚補了一句只有它有的話' in got[0])
    print(('  ✅ ' if both else '  🔴 ') + '世界⑦·A 有 B 沒有的一句 ⇒ 合併後兩句都在(這就是那個 bug)')
    if not both:
        print('     得到 ' + got[0]); ok = False
    # 🔴 而欄數不得變 —— 追加若帶進 `|` 就會多出格線
    same_cols = got[0].count('|') == long_side.count('|')
    print(('  ✅ ' if same_cols else '  🔴 ') + '世界⑦b·追加之後欄數不變(帶進 | 會弄壞表格)')
    if not same_cols:
        print('     格線數 %d vs %d' % (got[0].count('|'), long_side.count('|'))); ok = False

    # 🔵 負對照:逐字相同 ⇒ 一句都不該追加
    got2, _ = merge_block([long_side], [long_side])
    no_dup = '合併自同錨的另一版' not in got2[0]
    print(('  ✅ ' if no_dup else '  🔴 ') + '世界⑧·兩版逐字相同 ⇒ 不重複追加')
    if not no_dup:
        print('     得到 ' + got2[0]); ok = False

    # 🔵 負對照之二:短的那句【已經在】長版裡(只是被包在更長的句子中)⇒ 不追加
    contained = '| open | ⟦zzq-N⟧ | 而 -front 今晚補了一句只有它有的話。加上更多更多更多內容。 | 待派 | x |'
    part      = '| open | ⟦zzq-N⟧ | 而 -front 今晚補了一句只有它有的話。 | 待派 | x |'
    got3, _ = merge_block([contained], [part])
    no_dup2 = '合併自同錨的另一版' not in got3[0]
    print(('  ✅ ' if no_dup2 else '  🔴 ') + '世界⑧b·那句已經在長版裡 ⇒ 不重複追加')
    if not no_dup2:
        print('     得到 ' + got3[0]); ok = False

    print('全部通過。' if ok else '🔴 有格沒過。')
    return 0 if ok else 1


if __name__ == '__main__':
    if '--selftest' in sys.argv:
        sys.exit(selftest())
    sys.exit(main(sys.argv[1:]))
