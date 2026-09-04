#!/usr/bin/env python3
"""板子派工分診 —— 把「不要派的」與「拿了就能派的」分開印。

為什麼存在(2026-08-30 線G 量到, -48 裁乙):
  板上有【兩個地方】在講「誰在做」 —— 第 4 欄, 與內文的重驗標記 ——
  而沒有東西讓它們同步。量到 14/35 (40%) 互相矛盾:
  第 4 欄印「待派」, 而同一列的內文印「有人在做」。
  ⇒ 主視窗讀第 4 欄 ⇒ 一夜派重三次, 沒有一次是有人疏忽。

🔴 而它【不是一道警告閘】: 一道只會說「不要派這個」的閘,
   派工的人下一次仍然要自己挑 ⇒ 所以它同時輸出【可派名單】。
   ⇒ 機制優先律: 不要在人身上加一道檢查, 要把錯的輸入拿掉。

用法:
  python3 scripts/board-dispatch-triage.py [板子路徑]
  python3 scripts/board-dispatch-triage.py --selftest
"""
import io, re, sys, collections

BOARD = 'docs/launch-todo.md'
MARKERS = ('重驗中', '平行重驗請跳過')


# 🔴 2026-09-02 修(線 -7d 端到主視窗):本函式原本【硬取 c[4] 當誰欄】。
#    而板子在同一支檔裡有不只一種表 —— :729 那張是【4 欄】(| 態 | # | 事 | 卡什麼 |)
#    ⇒ 在那九列上 c[4] 是「卡什麼」不是「誰」
#    ⇒ ⇒ 問它「這件誰在做」⇒ 它回一段【散文】而不是一個名字, 而它很有信心。
#    🛑 而那正是本工具 docstring 說它要防的那件事的鏡像:
#       「主視窗讀第 4 欄 ⇒ 一夜派重三次」—— 而工具自己在讀第 4 欄。
#    ✅ 改成【讀那張表自己的表頭】找誰欄; 找不到 ⇒ 誰欄回 None,
#       而 None 與「待派」是兩件事 —— 答不出來要長得像答不出來, 不能長得像一個答案。
# 🔴 2026-09-02 第二發真正的成因(線 -7d 複驗抓到):
#    那 37 件的表頭是 | 行 | 錨 | 誰受什麼傷 | 派給 | 大概多大 | 前置 |
#    ⇒ 而「誰受什麼傷」也含「誰」⇒ 原本的 any(k in h) 先命中它, 取到【傷害描述】當誰欄
#    ⇒ ⇒ 而它回的那句「客人的資料 · 新開的 API 出生就是不用登入可打」
#       【讀起來很像一個誰欄】⇒ 比回一整段散文更難發現。
#    ✅ 修法:①明確的欄名優先(派給/owner/負責/誰在做)②「誰」只在【不是「誰受」】時才算
#    📌 一般化:關鍵字比對要問「還有誰會含這個字」—— 而表頭是最容易撞的地方。
# 2026-09-02 (line -f3 scanned 1040 files; it also measured row-evidence.sh printing a wrong column):
#   this file used l.split('|') -- a naive split. Board content contains escaped pipes
#   (markdown uses backslash-pipe to render a literal bar); a naive split still cuts there.
#   Same row: 10 cols naive vs 4 cols correct.
#   The escape is for RENDERING, not for FIELD SPLITTING -- so escaping bare pipes helps the
#   display and does nothing for the programs that read it. The fix belongs at the read end.
#   Positive control from -f3: board-state-consistency.py:228 already uses the correct split.
def _split_row(line):
    """Split one markdown table row without cutting at escaped pipes."""
    return re.split(r'(?<!\\)\|', line)


_WHO_STRONG = ('派給', 'owner', '負責', '誰在做')


def _who_idx(header_cells):
    """從表頭找【誰欄】的索引; 找不到回 None。明確欄名優先, 裸「誰」最後且排除「誰受」。"""
    for j, h in enumerate(header_cells):
        if any(k in h for k in _WHO_STRONG):
            return j
    for j, h in enumerate(header_cells):
        if '誰' in h and '誰受' not in h:
            return j
    return None


def rows(path):
    """回傳 (行號, 態, 事欄, 誰欄, 內文, #欄) —— 誰欄依【該表自己的表頭】取; 找不到回 None。"""
    L = io.open(path, encoding='utf-8').readlines()
    sep = lambda s: bool(re.match(r'^\|[\s:|-]+$', s))
    out = []
    cur_who = 4   # 沒遇到表頭之前的預設 = 舊行為(5 欄表)
    cur_ncol = None  # 該表表頭的欄數 —— 用來擋「內容裡有裸 | 而多切了幾刀」的列
    is_board = True  # 目前這張表是不是【板子】(= 表頭有誰欄);見下方表頭那段
    for i, l in enumerate(L, 1):
        if not l.startswith('|') or sep(l):
            continue
        # 表頭 = 它的【下一列】是分隔列。不靠欄位內容猜, 靠位置。
        if i < len(L) and sep(L[i]):
            hc = [x.strip() for x in _split_row(l)]
            cur_who = _who_idx(hc)
            cur_ncol = len(hc)
            # 🔴🔴 2026-09-05:這支檔裡**不只一張表**。實查 `docs/launch-todo.md` ——
            #   who 取不到的 32 列裡, **31 列根本不在板子那張表上**(表頭 :906 `態/#/事/卡什麼`、
            #   :1482 引用稽核表、:1508 推批對照表、:1697 清單對照表), 只有 **1 列**
            #   (`⟦ship-HCTAPI⟧`)是**真的板列而少一欄**。
            #   ⛔ 先前把它們混成一個數字 ⇒ 「32」讀起來像「板子上有 32 列壞掉」, 而那是假的。
            #   ✅ 判準:**表頭裡找不到誰欄的那張表, 整張不是板子** ⇒ 它的列一律不吐出來。
            #   🔵 這比「數欄數」穩:別的表將來加欄減欄都不會誤入, 而**板子那張表一定有誰欄**
            #      (沒有誰欄就不是派工用的板)。
            is_board = cur_who is not None
            continue
        # 🔴 不是板子那張表 ⇒ 整列跳過。**它們不是「壞掉的板列」, 它們根本不是板列。**
        if not is_board:
            continue
        c = _split_row(l)
        if len(c) < 6:
            continue
        # 🔴 2026-09-02 第二發(線 -7d 複驗 3/4 時抓到):表頭對欄只解了【欄數與表頭一致】的列。
        #    而 ⟦b4-NEWAPI1⟧ 那一列的【內容裡有裸 `|`】(一段 git 指令)⇒ 它被多切了幾刀
        #    ⇒ 索引全部右移 ⇒ 誰欄取到「客人的資料 · 新開的 API 出生就是不用登入可打」
        #    🛑 而那句話【讀起來很像一個誰欄】⇒ 比回一整段散文更難發現。
        #    ✅ 所以欄數與表頭不符 ⇒ 一律 None。理由同上一發:
        #       答不出來要長得像答不出來, 而【猜一個看起來合理的】是這一族最貴的失敗。
        # 🔵 只擋【比表頭短】的列(那種一定對不齊);比表頭長多半是內文裡有裸 `|`,
        #    而那些 `|` 幾乎都在誰欄【之後】⇒ 誰欄仍然取得到。
        #    (第一版寫成 len(c)==cur_ncol ⇒ 132 列變 None, 連正對照 ⟦b4-PARTCANCEL1⟧ 都中 ⇒ 太嚴, 收回。)
        shape_ok = (cur_ncol is None) or (len(c) >= cur_ncol)
        who = (c[cur_who].strip()
               if (shape_ok and cur_who is not None and cur_who < len(c))
               else None)
        out.append((i, c[1].strip(), c[3].strip(), who, '|'.join(c[5:]), c[2].strip()))
    return out


ANCHOR = re.compile(r'⟦([^⟧]{2,40})⟧')


def anchors(rs):
    """回 {行號: 顯示用座標}。id 只認【第 2 欄(編號欄)】。

    🔴 為什麼不掃整列(2026-08-30 線G 實測, 這把尺我先做錯了一次):
       一列裡的 ⟦…⟧ 有兩種, 而【它們語法完全相同】——
       ① 這一列自己的編號  ② 這一列提到的別的列
       實例:⟦b4-M1b⟧ 那一列裡有 10 個錨, 依序
       b4-M1 ×5 / b4-M1b ×2 / b4-BOARD1 ×2 / b9-2DOCS1 / b9-STATBLIND
       ⇒ 【列尾】那個是 b9-STATBLIND —— 那是它【提到】的別的列, 不是它自己。
       📌 ⇒ 「取列尾」與「取第一個」都會拿到別人的門牌, 而輸出看起來完全正常。

    ⇒ 所以只認編號欄。實量:225 列裡 75 列有、150 列沒有。
    ⇒ 沒有的那些用【標題前 12 字 + 行號】當座標(兩個座標, 有一個穩就救得回)。
    """
    cnt = collections.Counter(
        ANCHOR.search(idc).group(1) for _i, _s, _w, _o, _b, idc in rs if ANCHOR.search(idc))
    out = {}
    for i, _st, w, _who, _b, idc in rs:
        m = ANCHOR.search(idc)
        if not m:
            t = re.sub(r'[`*~🔴🔵🛑⚠️📌✅⇒—\s]+', '', w)[:12]
            out[i] = f'⛔無錨「{t}」:{i}'
        elif cnt[m.group(1)] > 1:
            out[i] = f'⟦{m.group(1)}⟧⚠️編號欄撞名 :{i}'
        else:
            out[i] = f'⟦{m.group(1)}⟧ :{i}'
    return out


def triage(rs):
    """待派 x 有沒有標記 ⇒ 兩堆, 外加「連誰欄都沒有」自成一堆。判準是【逐字子字串】, 不是分類器。"""
    blocked, ready, notopen, nowho = [], [], [], []
    marked = 0
    for i, state, what, who, body, _idcol in rs:
        has_mark = any(m in body for m in MARKERS)
        if has_mark:
            marked += 1
        # 🔴🔴 2026-09-05:板上有一批列**只有 4 欄、根本沒有「誰」那一欄**, 而本函式原本
        #   直接對 `None` 做 `'待派' not in who` ⇒ **整支當掉**(TypeError)。
        #   ⛔ **修法【不是】`who or ''`** —— 那會讓這些列安靜地掉進「不是待派」而被 `continue`
        #      吃掉 ⇒ 📌 **它們會從兩堆裡一起消失, 而讀的人以為分母是全部。**
        #   ✅ 讓它們**自成一堆並且帶數字印出來** —— 主視窗-94 2026-09-05 裁示逐字。
        #   🔵 而**當掉其實比安靜吞掉好**:當掉會叫, 吞掉不會。這一格是把「會叫」換成
        #      「會叫【而且說得出是什麼】」, 不是把它換成「不叫」。
        if who is None:
            nowho.append((i, state, what))
            continue
        if '待派' not in who:
            continue
        if has_mark:
            blocked.append((i, who, what))
        elif state != 'open':
            # 🔴 態 != open 的不進可派名單(-b4 2026-08-30 量到「可派」裡混著
            #    done 21 / parked 4 / doing 3)。配套規矩是 -b9 落的(ba7111ca):
            #    態 = done 的列, 誰欄【不是權威】 ⇒ 判「還要不要做」看態、不看誰欄。
            notopen.append((i, state, what))
        else:
            ready.append((i, who, what))
    return blocked, ready, notopen, nowho, marked


def main(path):
    rs = rows(path)
    blocked, ready, notopen, nowho, marked = triage(rs)
    AK = anchors(rs)

    print(f'掃過的資料列 = {len(rs)}   內文帶標記的列 = {marked}')
    print(f'字集 = {" / ".join(MARKERS)}   板子 = {path}')
    # 🔴 射程印在【結論之前】, 不印在最後(2026-08-30 線D -e4 的觀察, 線G 就地套用):
    #    人拿到結論的那一刻, 問題已經在他腦裡答完了
    #    ⇒ 印在最後那段不是「沒被讀到」, 是【讀的時候已經不需要它了】。
    print("""
🛑 先讀這段, 它決定下面兩堆能不能當結論 —— 這把尺看不到的:
   · 別的 session 的對話（標記還沒寫上板的那段時間差）
   · 內文用了別的字說「我在做」（字集只有上面那兩個）
   · 第 4 欄根本不在寫「誰」的那些列（例 `要面板 + 要 code`）
     ⇒ 那種列【兩堆都不會收】—— 它連矛盾都構不成
🔴 座標讀法:⟦錨⟧ 只認【第 2 欄】, :行號 是輔助
   ⚠️ 內文裡的 ⟦…⟧ 有一半是【提到別的列】, 與自己的編號語法相同
   板子一天漂 287 行 ⇒ 【引用時只寫行號, 隔天指到別人那一列】
   ⛔無錨 = 那一列沒有穩定座標，引用它要連標題前 12 字一起寫
""")

    print(f'🛑 不要派 —— 第4欄說「待派」而內文說有人在做 ({len(blocked)} 列)')
    if not blocked:
        # 🔴 這一句貼在數字旁邊是刻意的:0 與「沒有派重」是兩個宣稱。
        print('   ⚠️ 0 列被抓【不等於】沒有派重 —— 上面第三格那種形狀它是盲的')
    if not blocked:
        print('   （無）')
    for i, who, what in blocked:
        print(f'   {AK[i]}  第4欄=[{who[:70]}]')
        print(f'        {what[:78]}')

    print(f'\n✅ 拿了就能派 —— 第4欄說「待派」而內文乾淨 ({len(ready)} 列)')
    if not ready:
        print('   （無）')
    for i, who, what in ready:
        print(f'   {AK[i]}  {what[:78]}')

    # ③ 只描述, 不分類 —— 逐字印第 4 欄長什麼樣, 不替它歸類。
    # 🔴 理由: 做這件事的第一版用 `"線" in w` 抓窗名, 把「上【線】前」算了進去。
    #    一份壞掉的分類與一份對的分類, 都會印出一張看起來很整齊的表。
    print(f'\n📌 第 4 欄逐字長相(只描述、不分類;出現最多的 12 種)')
    for v, n in collections.Counter(w for _, _, _, w, _, _ in rs if w).most_common(12):
        print(f'   {n:4d}  [{v[:72]}]')

    print(f'\n⛔ 誰欄寫「待派」而態【不是 open】({len(notopen)} 列) —— 不進可派名單')
    print('   （態 = done 的列，誰欄不是權威；判「還要不要做」看態、不看誰欄）')
    for i2, st, what in notopen:
        print(f'   {AK[i2]}  態={st:8s} {what[:60]}')

    # 🔴 這一堆印在射程那句之前 —— 它是【分母的一部分】, 不是附註。
    print(f'\n⚠️ 只有 4 欄、沒有「誰」那一欄的資料列 ({len(nowho)} 列) —— 兩堆都不會收它們')
    if not nowho:
        print('   （無）—— ⚠️ 0 只代表【這塊板子上沒有】, 不代表這個形狀不會再出現')
    else:
        print('   🛑 它們不是「沒人認領」, 是【這支尺問不出來】⇒ 要派它們得先有人補那一欄')
    for i3, st, what in nowho:
        print(f'   {AK[i3]}  態={st:8s} {what[:60]}')

    print('\n📎 射程在最上面那段（刻意不放這裡 —— 放這裡等於沒放）')
    return 0


def selftest():
    import tempfile, os
    board = (
        '| 態 | 編號 | 事 | 誰 | 內文 |\n'
        '|---|---|---|---|---|\n'
        '| open | A1 | 甲事 | 待派 | 內文帶標記 [重驗中 -b9] 所以不該派 |\n'
        '| open | A2 | 乙事 | 待派 | 內文乾淨, 這一列應該進可派名單 |\n'
        '| open | A3 | 丙事 | 待派 | 平行重驗請跳過本列並回報 |\n'
        '| open | A4 | 丁事 | -b9 | 內文乾淨而已經有人拿著, 不該進任何一堆 |\n'
        '| open | A5 | 戊事 | 要面板 + 要 code | 重驗中 -b9 —— 第4欄答非所問 |\n'
        '| done | A6 | 己事 | 待派 | 內文乾淨而態是 done ⇒ 不該進可派名單 |\n'
        # 🔴 只有 4 欄 —— 這一列是 2026-09-05 那支 TypeError 的形狀本身。
        '| open | A7 | 庚事 | 這一列只有四欄所以沒有誰 |\n'
        # 🔴🔴 板子裡【還有別的表】。實查:當時 who 取不到的 32 列, 31 列來自這種表。
        #   它們不是壞掉的板列 —— 它們根本不是板列, 而先前把兩者混成同一個數字。
        '\n## 另一張表(不是板子, 表頭沒有誰欄)\n\n'
        '| 態 | # | 事 | 卡什麼 |\n'
        '|---|---|---|---|\n'
        '| open | B1 | 辛事 | 這張表沒有誰欄, 整張都不該被當成板列 |\n'
        '| open | B2 | 壬事 | 同上 |\n'
    )
    fd, p = tempfile.mkstemp(suffix='.md'); os.close(fd)
    io.open(p, 'w', encoding='utf-8').write(board)
    try:
        b, r, no, nw, marked = triage(rows(p))
        bl = sorted(x[2] for x in b)
        rl = sorted(x[2] for x in r)
        checks = [
            # 🔴 期望值 7 而不是 9:另一張表那兩列(辛/壬)**不該進來**。
            #   ⚠️ 這個數字同時守兩件事 —— 少了會漏、多了代表別的表被吃進來。
            ('資料列數 = 7(另一張表的 2 列不得混進來;2026-09-05 由 6 改 7)', len(rows(p)) == 7),
            ('負對照⑤ 別的表的列不得出現在任何一堆', not any(x[2] in ('辛事', '壬事') for x in b + r + no + nw)),
            ('負對照① 待派+有標記 ⇒ 被抓（甲丙兩列）', bl == ['丙事', '甲事']),
            ('負對照② 待派+乾淨 ⇒ 進可派名單（乙）', rl == ['乙事']),
            ('乙【沒有】被誤抓進不要派', '乙事' not in bl),
            ('丁(有主+乾淨) 兩堆都不進', '丁事' not in bl and '丁事' not in rl),
            ('戊(第4欄答非所問) 兩堆都不進', '戊事' not in bl and '戊事' not in rl),
            ('帶標記的列數 = 3（甲丙戊）', marked == 3),
            ('負對照③ 待派+乾淨但態=done ⇒ 不進可派名單', '己事' not in rl),
            ('而它要進「態不是 open」那一堆，不得靜靜消失', '己事' in [x[2] for x in no]),
            # 🔴 這三格是 2026-09-05 那支 TypeError 的回歸鎖。
            ('負對照④ 只有 4 欄的列 ⇒ 不再當掉, 而且自成一堆', '庚事' in [x[2] for x in nw]),
            ('而它【不得】被吞進可派名單（`who or \'\'` 那種修法會)', '庚事' not in rl),
            ('也不得被吞進不要派那一堆', '庚事' not in bl),
        ]
        # 🔴🔴 這一格是【突變逼出來的】:把「算出來但不印」餵進去 ⇒ 上面那三格**全綠**。
        #   成因:它們只驗 `triage()` 的回傳值, 而**沒有一格走過 `main()` 的輸出那一端**。
        #   ⇒ 📌 **修的是計算, 漏的是讀它的那一端** —— 而使用者拿到的是後者。
        #   ⚠️ 本格刻意比對【那一行字面 + 數字】, 不只是「有沒有 nowho 這個字」。
        import io as _io, contextlib
        buf = _io.StringIO()
        with contextlib.redirect_stdout(buf):
            main(p)
        printed = buf.getvalue()
        checks_print = [
            ('main() 真的把那一堆印出來了(帶數字)', '沒有「誰」那一欄的資料列 (1 列)' in printed),
            ('而別的表的列連在輸出裡都不該出現', '辛事' not in printed and '壬事' not in printed),
            ('而那一列的標題也印出來了, 不只是一個數字', '庚事' in printed),
        ]
    finally:
        os.unlink(p)
    checks += checks_print
    bad = 0
    for name, ok in checks:
        print(f'   {"PASS" if ok else "FAIL"}  {name}')
        bad += 0 if ok else 1
    print(f'\n{"selftest 全過" if not bad else f"selftest 有 {bad} 格紅"}  共 {len(checks)} 格')
    return 1 if bad else 0


if __name__ == '__main__':
    a = sys.argv[1:]
    sys.exit(selftest() if a[:1] == ['--selftest'] else main(a[0] if a else BOARD))
