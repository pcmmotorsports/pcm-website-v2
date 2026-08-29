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


def rows(path):
    """回傳 (行號, 態, 事欄, 誰欄, 內文) —— 只認 6 欄以上的資料列, 跳過分隔列。"""
    L = io.open(path, encoding='utf-8').readlines()
    sep = lambda s: bool(re.match(r'^\|[\s:|-]+$', s))
    out = []
    for i, l in enumerate(L, 1):
        if not l.startswith('|') or sep(l):
            continue
        # 表頭 = 它的【下一列】是分隔列。不靠欄位內容猜, 靠位置。
        if i < len(L) and sep(L[i]):
            continue
        c = l.split('|')
        if len(c) < 6:
            continue
        out.append((i, c[1].strip(), c[3].strip(), c[4].strip(), '|'.join(c[5:])))
    return out


def triage(rs):
    """待派 x 有沒有標記 ⇒ 兩堆。判準是【逐字子字串】, 不是分類器。"""
    blocked, ready = [], []
    marked = 0
    for i, state, what, who, body in rs:
        has_mark = any(m in body for m in MARKERS)
        if has_mark:
            marked += 1
        if '待派' not in who:
            continue
        (blocked if has_mark else ready).append((i, who, what))
    return blocked, ready, marked


def main(path):
    rs = rows(path)
    blocked, ready, marked = triage(rs)

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
""")

    print(f'🛑 不要派 —— 第4欄說「待派」而內文說有人在做 ({len(blocked)} 列)')
    if not blocked:
        # 🔴 這一句貼在數字旁邊是刻意的:0 與「沒有派重」是兩個宣稱。
        print('   ⚠️ 0 列被抓【不等於】沒有派重 —— 上面第三格那種形狀它是盲的')
    if not blocked:
        print('   （無）')
    for i, who, what in blocked:
        print(f'   :{i}  第4欄=[{who[:70]}]')
        print(f'        {what[:78]}')

    print(f'\n✅ 拿了就能派 —— 第4欄說「待派」而內文乾淨 ({len(ready)} 列)')
    if not ready:
        print('   （無）')
    for i, who, what in ready:
        print(f'   :{i}  {what[:78]}')

    # ③ 只描述, 不分類 —— 逐字印第 4 欄長什麼樣, 不替它歸類。
    # 🔴 理由: 做這件事的第一版用 `"線" in w` 抓窗名, 把「上【線】前」算了進去。
    #    一份壞掉的分類與一份對的分類, 都會印出一張看起來很整齊的表。
    print(f'\n📌 第 4 欄逐字長相(只描述、不分類;出現最多的 12 種)')
    for v, n in collections.Counter(w for _, _, _, w, _ in rs if w).most_common(12):
        print(f'   {n:4d}  [{v[:72]}]')

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
    )
    fd, p = tempfile.mkstemp(suffix='.md'); os.close(fd)
    io.open(p, 'w', encoding='utf-8').write(board)
    try:
        b, r, marked = triage(rows(p))
        bl = sorted(x[2] for x in b)
        rl = sorted(x[2] for x in r)
        checks = [
            ('資料列數 = 5（表頭與分隔列不算）', len(rows(p)) == 5),
            ('負對照① 待派+有標記 ⇒ 被抓（甲丙兩列）', bl == ['丙事', '甲事']),
            ('負對照② 待派+乾淨 ⇒ 進可派名單（乙）', rl == ['乙事']),
            ('乙【沒有】被誤抓進不要派', '乙事' not in bl),
            ('丁(有主+乾淨) 兩堆都不進', '丁事' not in bl and '丁事' not in rl),
            ('戊(第4欄答非所問) 兩堆都不進', '戊事' not in bl and '戊事' not in rl),
            ('帶標記的列數 = 3（甲丙戊）', marked == 3),
        ]
    finally:
        os.unlink(p)
    bad = 0
    for name, ok in checks:
        print(f'   {"PASS" if ok else "FAIL"}  {name}')
        bad += 0 if ok else 1
    print(f'\n{"selftest 全過" if not bad else f"selftest 有 {bad} 格紅"}  共 {len(checks)} 格')
    return 1 if bad else 0


if __name__ == '__main__':
    a = sys.argv[1:]
    sys.exit(selftest() if a[:1] == ['--selftest'] else main(a[0] if a else BOARD))
