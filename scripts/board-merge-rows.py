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
# 🔵 「這一句有沒有字」—— 中日韓 / 拉丁字母 / 數字。純符號(例:板上當佔位用的 `—`)不算內容。
WORDY_RE = re.compile(r'[0-9A-Za-z\u3400-\u9fff\uf900-\ufaff]')


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


def missing_from(merged, side):
    """`side` 這一列裡, **合出來那一列讀不到**的句子。回 [(句子, 是不是短句)]。

    🔴🔴 **這一格是本支最重要的一格, 而它在 2026-09-05 之前【不存在】。**
      `merge_sentences` 是啟發式的:切句靠標點、而且**刻意跳過 `len < 4` 的短句**
      ⇒ 它可能追不回某些句子, 而**那時候它什麼都不會說**。
      📌 病史(板列 `⟦01-BOARDMERGETAKESLONGER⟧`):`d910c6afd` 整段內容消失, 而
        **commit 還在、`git log` 找得到、`--is-ancestor` 說「在」**
        ⇒ 🎯 **「commit 在而內容不在」對當時全隊在用的自查【結構上失明】。**
      ✅ 修法不是把切句寫得更聰明(那是跟下一種標點賽跑), 是**回頭問一次**:
        兩側的每一句, 在合出來那一列裡讀得到嗎?讀不到 ⇒ **叫**。
    ⚠️ 它答不出什麼:它用的是**同一把切句尺** ⇒ 切不出來的東西它也看不到
      (例:同一句被兩邊各改一個字 ⇒ 兩句都會在, 而人要的是「哪個版本對」)。
      ⇒ 它防的是【整段消失】, 不是【語意合併】。
    """
    # 🔴 **比對前要套上與追加時【同一個】正規化** —— `merge_sentences` 追加時把 `|` 換成 `/`
    #   (帶 `|` 進去會多出格線 ⇒ 欄數變了 ⇒ 表格壞掉)。少了這一步, 含 `|` 的那些句子會被
    #   判成「不見了」, 而它們其實在、只是那一個字元換了。
    #   🔬 量到的:拿真板子 40 列造「夠長的獨有句」⇒ **3 列誤報**(7.5%), 三列的丟失句都含 `|`。
    #   📌 **一把尺與它要驗的那個動作, 必須用同一套正規化 —— 否則它量到的是自己的差異。**
    def norm(x):
        return x.replace('|', '/')

    merged_text = norm(' '.join(c for c in split_cells(merged) if c.strip()))
    merged_n = norm(merged)
    out = []
    for cell in split_cells(side):
        for t in sentences(cell):
            if not t:
                continue
            tn = norm(t)
            if tn in merged_n or tn in merged_text:
                continue
            # 🔵 **只有符號的「句子」不算內容** —— 板上用 `—` 當「這一格空著」的佔位,
            #   而它是 1 個字元 ⇒ 追不回去 ⇒ 會被算成遺漏。
            #   🔬 量到的:真板 510 帶錨列造獨有句 ⇒ **12 列誤報, 12 列丟的都是那個 `—`**
            #   ⇒ 📌 **一道對常態叫的閘會被關掉**, 而它擋的東西一起消失。
            #   ⇒ 判準寫成「有沒有字」(中日韓 / 字母 / 數字), 不是「長不長」。
            if not WORDY_RE.search(t):
                continue
            out.append((t, len(t) < 4))
    return out


def merge_block(ours, theirs):
    """逐列合併一個衝突塊。回 (合併後的行, 說明清單, 遺漏清單)。

    規則:
      同 key 兩側都有 ⇒ 取【比較長】那一份(長 = 有人補過內容), 而**對方那份要 pop 掉**
      同 key 而逐字相同 ⇒ 只留一(取哪一份都一樣)
      只有一側有       ⇒ 留下
    順序:我側的順序優先, 對方獨有的接在後面(照它自己的順序)。
    """
    pending = {}
    for l in theirs:
        pending.setdefault(row_key(l), []).append(l)

    out, notes, losses = [], [], []
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
                # 🔴 **合完【回頭問一次】** —— 兩側都要問, 不是只問被丟掉的那一側:
                #    追加的動作本身也可能把某一句改到讀不出來。
                for src, lbl in ((l, 'ours'), (other, 'theirs')):
                    for t, short in missing_from(merged, src):
                        losses.append((k[1][:40], lbl, t, short))
                # 🔴 **欄位數也要守一次**(code-reviewer 2026-09-05 nit, 實測構造得出來):
                #   最後一格是空的而寫成 `||` 時, `merge_sentences` 的 `.rstrip('|')` 會把它
                #   連同前面的空白一起吃掉 ⇒ **7 欄變 6 欄, 而 `missing_from` 看不到**
                #   (它比的是句子, 不是格子)⇒ 那一欄整格消失而 rc 仍是 0。
                #   🔬 真板今天 0 處命中(`grep -c '||[[:space:]]*$'` ⇒ 0)⇒ **潛伏, 不是現行**;
                #   而潛伏的洞正是這支檔存在的理由。
                want_cells = max(len(split_cells(l)), len(split_cells(other)))
                got_cells = len(split_cells(merged))
                if got_cells < want_cells:
                    losses.append(
                        (k[1][:40], 'cells', f'欄數 {want_cells} ⇒ {got_cells}(整格消失)', False)
                    )
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
    return out, notes, losses


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
        merged, notes, losses = merge_block(ours, theirs)
        blocks.append((i + 1, len(ours), len(theirs), len(merged), notes, losses))
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
    all_losses = []
    for line, no, nt, nm, notes, losses in blocks:
        all_losses.extend((line, *x) for x in losses)
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
    # 🔴🔴 **丟東西時要【叫】, 而且要叫在 stderr、rc 非 0**(主視窗 `-f8` 2026-09-05 指定的形狀:
    #   他的收割 helper 讀 stdout 的「塊 :N …」那一行, 而**綠底下多一行字它不會停**)。
    #   ⇒ 🛑 **有遺漏就【不寫檔】** —— 這一支的整個存在理由是「不要靜靜弄丟東西」,
    #      而「寫了檔再說有東西不見」與「沒寫」對下一個人是兩件完全不同的事。
    #   ⇒ 那一批要**手解**(照板列:段落聯集, 不是取長), 而下面把丟掉的句子逐句印出來給他貼回去。
    if all_losses:
        w = sys.stderr.write
        w(f'🔴 合併會弄丟東西 ⇒ 【沒有寫回 {path}】, 這一批請手解。\n')
        w(f'   共 {len(all_losses)} 句在合出來的列裡讀不到(short = 短到被切句規則跳過的):\n')
        for line, who, side, t, short in all_losses[:40]:
            w(f'   塊 :{line}  {side:<6} {"short " if short else "      "}{who}  「{t[:70]}」\n')
        if len(all_losses) > 40:
            w(f'   …還有 {len(all_losses) - 40} 句(只印前 40 句)\n')
        w('   🔵 它答不出【同一句被兩邊各改一個字】那種 —— 那兩句都會在, 而要哪一版是人的事。\n')
        return 3
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

    def chk2(name, cond):
        nonlocal ok
        print(('  ✅ ' if cond else '  🔴 ') + name)
        if not cond:
            ok = False

    def chk(name, ours, theirs, want):
        nonlocal ok
        got, _, _ = merge_block(ours, theirs)
        good = got == want
        print(('  ✅ ' if good else '  🔴 ') + name)
        if not good:
            print(f'     得到 {got}')
            print(f'     期望 {want}')
            ok = False

    a_short = '| open | ⟦zzq-A⟧ | 甲 | 待派 | x |'
    a_short2 = '| open | ⟦zzq-A2⟧ | 甲 | 待派 | 一句夠長而且對方沒有的內容。 |'
    a_long = '| open | ⟦zzq-A⟧ | 甲, 而有人補了一整段更長的內容 | 待派 | xxxxx |'
    a_long2 = '| open | ⟦zzq-A2⟧ | 甲, 而有人補了一整段更長的內容 | 待派 | 另一段夠長的內容在這裡。 |'
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
    got, _, _ = merge_block([long_side], [short_side])
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
    got2, _, _ = merge_block([long_side], [long_side])
    no_dup = '合併自同錨的另一版' not in got2[0]
    print(('  ✅ ' if no_dup else '  🔴 ') + '世界⑧·兩版逐字相同 ⇒ 不重複追加')
    if not no_dup:
        print('     得到 ' + got2[0]); ok = False

    # 🔵 負對照之二:短的那句【已經在】長版裡(只是被包在更長的句子中)⇒ 不追加
    contained = '| open | ⟦zzq-N⟧ | 而 -front 今晚補了一句只有它有的話。加上更多更多更多內容。 | 待派 | x |'
    part      = '| open | ⟦zzq-N⟧ | 而 -front 今晚補了一句只有它有的話。 | 待派 | x |'
    got3, _, _ = merge_block([contained], [part])
    no_dup2 = '合併自同錨的另一版' not in got3[0]
    print(('  ✅ ' if no_dup2 else '  🔴 ') + '世界⑧b·那句已經在長版裡 ⇒ 不重複追加')
    if not no_dup2:
        print('     得到 ' + got3[0]); ok = False
    # ══ 遺漏偵測(2026-09-05 加;主視窗 `-f8` 指定「丟東西時要叫」的形狀)══
    #   🔴 正對照要**造得出一個真的丟失**, 不然這幾格只是在演。
    #   `merge_sentences` 刻意跳過 `len < 4` 的句子 ⇒ 短句就是那個真實的丟失向量。
    lost_side = '| open | ⟦zzq-L⟧ | 甲 | 待派 | zz。 |'
    keep_side = '| open | ⟦zzq-L⟧ | 甲, 而這一份長很多所以會被留下來當底 | 待派 | 一段完全不同而且夠長的內容。 |'
    _got, _notes, losses = merge_block([lost_side], [keep_side])
    lost_texts = [t for _a, _side, t, _short in losses]
    chk2('🔴 正對照·短句被切句規則跳過 ⇒ 遺漏偵測要抓到它', 'zz。' in lost_texts)
    chk2('   而它要被標成 short(那是【已知會被跳過】那一類, 不是新病)',
         any(short for _a, _side, t, short in losses if t == 'zz。'))
    # ⛔ ~~負對照:兩側【逐字相同】⇒ losses 為空~~ —— **那是恆真格**(code-reviewer 2026-09-05 量到:
    #   兩側逐字相同時 `merge_block` 在 `other == l` 就短路, `missing_from` **一次都沒被叫到**
    #   ⇒ 把偵測器改成「每句都算丟失」它照樣綠)。
    #   ✅ 換成【差一點點】的兩側:它們會真的走進合併分支, 而合完不該丟任何東西。
    near_a = keep_side.replace('。 |', '。 |')  # 與 keep_side 逐字相同的那一份不能用
    near_b = keep_side.replace('一段完全不同而且夠長的內容。', '一段完全不同而且夠長的內容。 補一句夠長的話在後面。')
    _g2, _n2, losses2 = merge_block([near_a], [near_b])
    chk2('🔵 負對照·兩側【差一句】而那句夠長 ⇒ 追得回去, 一句都不得算成遺漏', losses2 == [])
    chk2('   而它真的走進了合併分支(不是被 identical 短路掉)', _n2 and _n2[0][0] != 'identical')
    # 🔵 `|` 正規化那一格的對照組:追加時 `|` 會被換成 `/`(帶它進去會多一條格線),
    #   ⇒ 比對若不套同一套正規化, 含 `|` 的句子會被判成「不見了」而其實在。
    #   🔴 **逃脫的豎線 `\\|` 才是唯一到得了 cell 裡面的那一種** —— 裸 `|` 會被 `split_cells`
    #      當成欄位分隔(code-reviewer 2026-09-05:我第一版用裸 `|` 造 fixture,
    #      四種拿掉正規化的放法**四次都 0 格紅** ⇒ 那格 fixture 造不出它要守的現象)。
    pipe_side = '| open | ⟦zzq-P⟧ | 甲 | 待派 | 這一句夠長而且帶了一個 \\| 在中間。 |'
    pipe_long = '| open | ⟦zzq-P⟧ | 甲, 而這一份長很多會被當成底 | 待派 | 完全不同的一段夠長內容。 |'
    _gp, _np, lossp = merge_block([pipe_side], [pipe_long])
    chk2('🔵 負對照·含 `|` 的句子被追加成 `/` ⇒ 不得算成遺漏', lossp == [])
    chk2('   而它真的被追回去了(不是靠比對變寬混過去)', '在中間' in _gp[0])

    # 🔴 欄數守恆那一格的對照組。**造這個世界失敗過一次** —— 第一版短側沒有任何獨有句
    #   ⇒ 根本沒走進 `merge_sentences` ⇒ 欄數當然沒變, 而那一發印的是「沒叫」。
    #   ⇒ 📌 **正對照要走到被驗的那一段碼, 不只是長得像那個情境。**
    cell_base = '| open | ⟦zzq-C2⟧ | 甲, 而這一份長很多所以會被當成底喔喔喔喔喔 | 待派 ||'
    cell_short = '| open | ⟦zzq-C2⟧ | 甲 | 待派 | 這是一句夠長的獨有內容要被追加回去。 |'
    _gc, _nc, lossc = merge_block([cell_short], [cell_base])
    chk2('🔴 正對照·最後一格是空的且寫成 `||` ⇒ 合完少一欄, 欄數守恆要叫',
         any(side == 'cells' for _a, side, _t, _s in lossc))
    chk2('   而它真的少了一欄(7 ⇒ 6), 不是只有訊息在叫',
         len(split_cells(_gc[0])) < len(split_cells(cell_base)))
    _gc2, _nc2, lossc2 = merge_block([a_short2], [a_long2])
    chk2('🔵 負對照·正常兩版 ⇒ 欄數那一格不得叫',
         not any(side == 'cells' for _a, side, _t, _s in lossc2))

    # 🔵 符號句那一格的對照組:板上用 `—` 當佔位, 它 1 個字元 ⇒ 追不回去 ⇒ 會被算成遺漏。
    #   🔬 真板 510 帶錨列量到:修前 **12 列誤報, 12 列丟的都是那個 `—`**;修後 **0**。
    dash_side = '| open | ⟦zzq-D⟧ | 甲 | 待派 | — |'
    dash_long = '| open | ⟦zzq-D⟧ | 甲, 而這一份長很多會被當成底 | 待派 | 一段完全不同而且夠長的內容。 |'
    _gd, _nd, lossd = merge_block([dash_side], [dash_long])
    chk2('🔵 負對照·只有符號的格(板上的 `—` 佔位)⇒ 不得算成遺漏',
         not any(t.strip() == '—' for _a, _s, t, _x in lossd))
    chk2('   🔴 而【有字】的短句仍然要叫(這一刀不得把正對照一起關掉)',
         any(t == 'zz。' for _a, _s, t, _x in merge_block([lost_side], [keep_side])[2]))

    a_plus = '| open | ⟦zzq-A⟧ | 甲 | 待派 | 這一句夠長, 追得回去。 |'
    _g3, _n3, losses3 = merge_block([a_plus], [a_long])
    chk2('🔵 負對照·夠長的獨有句被追加回去 ⇒ 也不算遺漏', losses3 == [])

    # ══ 端到端:有遺漏時【不寫檔】、訊息走 stderr、rc = 3 ══
    import io as _io
    import subprocess
    import tempfile
    conflict = (
        '| 態 | 編號 | 事 | 誰 | 內文 |\n|---|---|---|---|---|\n'
        '<<<<<<< HEAD\n' + lost_side + '\n=======\n' + keep_side + '\n>>>>>>> other\n'
    )
    fd, tmp = tempfile.mkstemp(suffix='.md')
    os.close(fd)
    _io.open(tmp, 'w', encoding='utf-8').write(conflict)
    before = _io.open(tmp, encoding='utf-8').read()
    r = subprocess.run(
        [sys.executable, os.path.abspath(__file__), '--apply', tmp],
        capture_output=True, text=True,
    )
    chk2('🔴 有遺漏 ⇒ rc = 3(主視窗的 helper 靠它 STOP)', r.returncode == 3)
    chk2('   訊息走 stderr, 不是躲在 stdout 的綠底下', '會弄丟東西' in r.stderr)
    chk2('   而 stdout 那一行「塊 :N …」的格式沒有變(他的 helper 在讀它)',
         '我側 1 列 · 對面 1 列 ⇒ 合成 1 列' in r.stdout)
    chk2('   🛑 而且【沒有寫回檔案】—— 寫了再說有東西不見, 對下一個人是兩件事',
         _io.open(tmp, encoding='utf-8').read() == before)
    os.unlink(tmp)



    print('全部通過。' if ok else '🔴 有格沒過。')
    return 0 if ok else 1


if __name__ == '__main__':
    if '--selftest' in sys.argv:
        sys.exit(selftest())
    sys.exit(main(sys.argv[1:]))
