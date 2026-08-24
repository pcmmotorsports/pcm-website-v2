#!/usr/bin/env python3
# board-state-consistency.py — 兩張「態欄板」的內部一致性掃描。
#
# ══ 為什麼要有它(2026-08-25 線 3 · 幽靈清查線乙)═══════════════════════════
# 兩份檔各自被抓到同一個病,而**兩邊都不會叫**:
#   `docs/launch-todo.md`     態欄 `open` 而該列內文寫著「✅ 已結掉」(2 列)
#   spec `§1-A`               列坐在「✅ 現在做得到」那張表裡, 而態欄寫 `🔴 …做不到`(3/11)
# 🔴 而 launch-todo 自己附的數法**少數 3 列** —— 因為那 3 列的態欄不在封閉集裡:
#   `grep -oE '\| (open|doing|parked|done) \|'` ⇒ 96,而實際資料列 ⇒ 99。
#   **「板子有 96 件」與「板子有 99 件而我漏了 3 件」印同一個東西。**
#
# ⇒ 這兩條**機器答得出來**:它們比對的是同一份檔【內部】的兩個值,
#   不需要跨檔呼叫圖、不需要 DB、不需要真瀏覽器。(CLAUDE.md「機制優先律」)
#
# ══ 🔴 天花板(先讀這段,不要把它讀得比它大)══════════════════════════════
#  ① **它只看得到【寫在態欄與同一列文字裡】的矛盾。** 一列若安靜地過期
#     (沒有人回來寫「已結掉」),它**完全看不見,而且會一直是綠的**。
#     ⇒ 它防的是「有人回來寫了一半」,不是「沒有人回來」。
#  ② 規則 ② 的字集是**人列的四個詞**(`已結掉/已做完/已關掉/已完成`),不是窮舉。
#     🔴 已知漏的形狀:`#904` 那一列寫「**已補 2 格**」⇒ 本工具**抓不到**。
#     (那是刻意的:「補了幾格」是子項完成,與「整列結案」在文字上分不開。)
#  ③ 規則 ② 只在【事】欄、或【✅ 開頭的判決句】裡認那四個詞。
#     🔴 理由是量到的(2026-08-25 誤擋率乾跑,分母 = launch-todo 99 列):
#        含裸 `✅`         ⇒ 25 列命中,人工判 **多數是誤擋**(進度句裡的 ✅)
#        四詞不限位置       ⇒  3 列, 其中 1 列誤擋(`#858` 的「F1 … 已做完」是**子項**)
#        本規則(限位置)    ⇒  2 列, **誤擋 0**
#     ⇒ 收窄買到的是「它紅的時候值得看」;代價是 ② 那個已知漏。
#  ④ **它不是守門,除非有人把它掛上去。** 掛 `.husky/` = 平台設定 = 鐵則 12④
#     ⇒ 那一步不在本檔的權限裡, 由主視窗或平台設定的負責人做。
#
# ══ 用法 ════════════════════════════════════════════════════════════════
#    python3 scripts/board-state-consistency.py            掃兩份檔
#    python3 scripts/board-state-consistency.py --selftest 兩個方向各餵一發
#
#    rc=0 兩條都過 / rc=1 有 finding / rc=2 **工具自己壞掉**(與 finding 分得開)
import io, os, re, sys, tempfile

CLOSED = ('open', 'doing', 'parked', 'done')
DONE_WORDS = ('已結掉', '已做完', '已關掉', '已完成')
LOOKBACK = 24   # ✅ 與那四個詞之間容許幾個字。24 是量出來的:20 起結果就穩定到 40。

BOARD = 'docs/launch-todo.md'
SPEC = 'docs/specs/2026-07-25-admin-backend-rebuild-spec.md'


def _rows(path, sec_pat, head_pat):
    """撈資料列。sec_pat 命中 => 進入一個區段;head_pat 命中 => 離開。"""
    try:
        lines = io.open(path, encoding='utf-8').read().split('\n')
    except OSError as e:
        raise RuntimeError(f'讀不到 {path}:{e}')
    rows, sec = [], None
    for i, l in enumerate(lines):
        m = re.match(sec_pat, l)
        if m:
            sec = m.group(1)
        elif re.match(head_pat, l):
            sec = None
        if sec is None or not l.startswith('| ') or l.startswith('|---'):
            continue
        f = [x.strip() for x in l.split('|')]
        if len(f) < 3 or f[1] in ('態', '', '#', '編號', '標記'):
            continue
        rows.append({'sec': sec, 'line': i + 1, 'state': f[1], 'f': f})
    return rows


def rule1_closed_set(rows):
    """① 態欄必須落在封閉集裡 —— 不然板子自己的數法數不到那一列。"""
    return [r for r in rows if r['state'] not in CLOSED]


def rule2_self_contradiction(rows):
    """② 態=open/doing 而該列自稱做完了。"""
    out = []
    for r in rows:
        if r['state'] not in ('open', 'doing'):
            continue
        f = r['f']
        hit = len(f) > 3 and any(w in f[3] for w in DONE_WORDS)
        if not hit:
            for cell in f[4:]:
                for w in DONE_WORDS:
                    for m in re.finditer(re.escape(w), cell):
                        if '✅' in cell[max(0, m.start() - LOOKBACK):m.start()]:
                            hit = True
        if hit:
            out.append(r)
    return out


def rule3_marker_vs_table(rows):
    """③ spec 專用:列坐在「✅ 現在做得到」那張表裡, 而它的標記欄不是純 ✅。"""
    out = []
    for r in rows:
        if r['sec'] != 'GREEN' or len(r['f']) < 4:
            continue
        # 🔴 先把【劃掉的舊值】拿掉再判 —— 本 repo 的更正慣例是「劃掉不刪」(`~~❌~~ → **✅**`),
        #    不剝的話那個作廢的 ❌ 會被讀成現值。
        #    📏 誤擋率是量到的(2026-08-25,分母 = §1-A-1 的 11 列):
        #       不剝 ⇒ 5 列命中, 其中 **2 列是誤擋**(`#10` / `#16` 的 `~~❌~~ → **✅**`)
        #       剝了 ⇒ 3 列命中, 誤擋 **0**
        mark = re.sub(r'~~.*?~~', '', r['f'][3])
        if '🔴' in mark or mark.strip().startswith('🟡') or '❌' in mark:
            out.append(r)
    return out


def scan(board=BOARD, spec=SPEC, quiet=False):
    def say(*a):
        if not quiet:
            print(*a)

    bad = 0

    # ── launch-todo ────────────────────────────────────────────────
    rows = _rows(board, r'^## ([A-Z]) · ', r'^#{2,3} ')
    if not rows:
        raise RuntimeError(f'{board} 一列都沒撈到 —— 這是量具失效, 不是板子空了')
    say(f'══ {board}(資料列 {len(rows)})══')

    strays = rule1_closed_set(rows)
    if strays:
        bad = 1
        say(f'  🔴 ① 態欄不在封閉集的有 {len(strays)} 列 ⇒ 板子自己的數法【數不到它們】')
        say(f'     那條數法會印 {len(rows) - len(strays)},而實際是 {len(rows)}')
        for r in strays:
            say(f'     {r["sec"]} 節 :{r["line"]}  態=[{r["state"]}]')
    else:
        say(f'  ✅ ① 封閉集加總 {len(rows)} = 資料列 {len(rows)}')

    contra = rule2_self_contradiction(rows)
    if contra:
        bad = 1
        say(f'  🔴 ② 態=open/doing 而自稱做完的有 {len(contra)} 列')
        for r in contra:
            say(f'     {r["sec"]} 節 :{r["line"]}  態=[{r["state"]}]  {r["f"][3][:52]}')
    else:
        say('  ✅ ② 零命中')

    # ── spec §1-A-1 ────────────────────────────────────────────────
    grows = _rows(spec, r'^### .*(§1-A-1) ✅ 現在做得到', r'^#{3,4} ')
    for r in grows:
        r['sec'] = 'GREEN'
    say(f'══ {spec} §1-A-1(資料列 {len(grows)})══')
    if not grows:
        raise RuntimeError(f'{spec} §1-A-1 一列都沒撈到 —— 量具失效, 不是那張表空了')
    odd = rule3_marker_vs_table(grows)
    if odd:
        bad = 1
        say(f'  🔴 ③ 坐在「✅ 現在做得到」表裡而標記欄不是純 ✅ 的有 {len(odd)} 列')
        say(f'     ⇒ 數「我們能做幾件」會數到 {len(grows)},而其中 {len(odd)} 件它自己說做不完整')
        for r in odd:
            say(f'     :{r["line"]}  #{r["f"][1]} {r["f"][2][:20]}  標記=[{r["f"][3][:40]}]')
    else:
        say(f'  ✅ ③ {len(grows)} 列標記欄全是純 ✅')
    return bad


# ══ selftest:兩個方向各餵一發 ═════════════════════════════════════════
GREEN_BOARD = """## A · 測試節
| 態 | # | 事 | 誰 | 卡什麼 |
|---|---|---|---|---|
| open | — | 一件還沒做的事 | 待派 | 沒有結案字樣 |
| done | — | 一件做完的事 | — | 收工了 |
"""
RED_BOARD_1 = GREEN_BOARD + "| ~~open~~ **半關** | — | 錯填的態欄 | — | 這一列封閉集數不到 |\n"
RED_BOARD_2 = GREEN_BOARD + "| open | — | ✅ **這件已做完** | — | 標題自稱做完而態是 open |\n"
GREEN_SPEC = """### §1-A-1 ✅ 現在做得到
| # | 能力 | 標記 | 量法 |
|---|---|---|---|
| 2 | 看訂單明細 | ✅ | 量過 |
"""
RED_SPEC = GREEN_SPEC + "| 9 | 一個坐錯表的 | 🟡 | 量過 |\n"
# 🔴 這一格是【剝劃線】那個修法的證人:`~~❌~~ → **✅**` 是本 repo 的更正慣例,
#    不剝的話它會被誤擋。修法拿掉 ⇒ 本格必紅。(2026-08-25 實測:不剝 ⇒ 5 命中含 2 誤擋)
GREEN_SPEC_STRUCK = GREEN_SPEC + "| 10 | 更正過的 | ~~❌~~ → **✅** | 量過 |\n"


def selftest():
    d = tempfile.mkdtemp()
    def w(name, text):
        p = os.path.join(d, name)
        io.open(p, 'w', encoding='utf-8').write(text)
        return p

    cases = [
        ('①該綠必綠 · 乾淨板 + 乾淨 spec', GREEN_BOARD, GREEN_SPEC, 0),
        ('②該紅必紅 · 態欄不在封閉集', RED_BOARD_1, GREEN_SPEC, 1),
        ('③該紅必紅 · 態=open 而自稱做完', RED_BOARD_2, GREEN_SPEC, 1),
        ('④該紅必紅 · 🟡 坐在 ✅ 表裡', GREEN_BOARD, RED_SPEC, 1),
        ('⑦該綠必綠 · ~~❌~~ → ✅ 是更正慣例, 不得誤擋', GREEN_BOARD, GREEN_SPEC_STRUCK, 0),
    ]
    ok = True
    for name, b, s, want in cases:
        got = scan(w('b.md', b), w('s.md', s), quiet=True)
        mark = '✅' if got == want else '🔴'
        if got != want:
            ok = False
        print(f'  {mark} {name}  期望 rc={want} 實得 rc={got}')

    # ⑤ 分母自檢:一份【沒有資料列】的板子必須判【量具作廢】, 不得判通過
    try:
        scan(w('b.md', '## A · 空節\n'), w('s.md', GREEN_SPEC), quiet=True)
        print('  🔴 ⑤分母自檢 · 零資料列時它印了通過 ⇒ 那正是 #912 那族')
        ok = False
    except RuntimeError:
        print('  ✅ ⑤分母自檢 · 零資料列 ⇒ 判量具作廢(不判通過)')

    # ⑥ 工具自壞與查無分得開
    try:
        scan(os.path.join(d, 'no-such.md'), w('s.md', GREEN_SPEC), quiet=True)
        print('  🔴 ⑥檔不存在時沒有出聲')
        ok = False
    except RuntimeError:
        print('  ✅ ⑥檔不存在 ⇒ RuntimeError(呼叫端會轉成 rc=2, 與 finding 的 rc=1 分得開)')

    print('\n全部通過。' if ok else '\n🔴 有格沒過。')
    return 0 if ok else 1


if __name__ == '__main__':
    try:
        if '--selftest' in sys.argv:
            sys.exit(selftest())
        sys.exit(scan())
    except RuntimeError as e:
        print(f'🔴 工具壞了:{e}', file=sys.stderr)
        sys.exit(2)
