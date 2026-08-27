#!/usr/bin/env python3
# ============================================================================
# ceiling-header-inventory.py — 數守門檔有沒有那兩個【逐字固定標題】天花板段
#
# 天花板/範圍: 這片【不做】什麼
#   · 只做一件事:吃一份【傳入的檔案清單】(argv 檔 / stdin,一行一支),
#     數每支有沒有 `天花板/範圍:` 與 `天花板/量具:`、各在第幾行,並給總計。
#   · 🔴 它【不自己算分母】—— 分母定義(wired 是哪些)今天吵過三輪,不是這把尺該決定的事,清單由呼叫者傳。
#   · 它【不 retrofit、不改】任何檔;純唯讀盤點。
#   · §12-45 的 retrofit【本身】、判斷某支該不該有天花板 ⇒ 都不在本片。
#
# 天花板/量具: 這把尺【量不到】什麼(即使在範圍內)
#   · 🔴 它【只認逐字固定標題】那兩個字串。用【別的話】寫的同一件事
#     (「誠實邊界」/「這把尺量不到」/「已知盲區」… 今天全 repo 的 ~25 支正是那樣)⇒ 它一律判【沒有】。
#     ⚠️ **這不是自謙,是它真正的射程**:拿它去判「這支【沒寫】天花板」會錯 ——
#        它判的是「這支【沒用固定標題】寫」。§12-45 立法前的既有檔幾乎都會被判「沒有」,那是預期。
#   · 🔴 它撞得到【談論這兩個標題的文件】(docs/lessons-learned.md §12-45 / #952 逐字有那兩字串)——
#     它們不是守門。只要你傳的是【守門清單】(範圍那條)就天然不會撞到;--self-check 用隔離 fixture、不掃 repo。
#   · 它只看【字串在不在】,不看那段【寫得對不對】(範圍那半是不是真範圍、量具那半是不是真限制)—— 那要人看。
#
# 用法:
#   python3 scripts/ceiling-header-inventory.py <清單檔>     # 清單:一行一個路徑
#   printf '%s\n' a.sh b.py | python3 scripts/ceiling-header-inventory.py   # 或走 stdin
#   python3 scripts/ceiling-header-inventory.py --self-check  # 正負對照(隔離 fixture)
# ============================================================================
import io, os, sys, tempfile, shutil

SCOPE_TITLE = '天花板/範圍:'   # 這片不做什麼
RULER_TITLE = '天花板/量具:'   # 這把尺量不到什麼


def _first_line(text, needle):
    for i, ln in enumerate(text.split('\n')):
        if needle in ln:
            return i + 1
    return None


def inventory(paths):
    """回傳 list[(path, scope_ln, ruler_ln, note)];scope_ln/ruler_ln = 命中行號或 None。掃【全檔】。"""
    rows = []
    for p in paths:
        try:
            text = io.open(p, encoding='utf-8', errors='replace').read()
        except OSError as e:
            rows.append((p, None, None, f'讀不到:{e}'))
            continue
        rows.append((p, _first_line(text, SCOPE_TITLE), _first_line(text, RULER_TITLE), ''))
    return rows


def _bucket(scope_ln, ruler_ln):
    if scope_ln and ruler_ln:
        return 'both'
    if scope_ln or ruler_ln:
        return 'one'
    return 'none'


def report(paths):
    rows = inventory(paths)
    both = one = none = unreadable = 0
    for p, s, r, note in rows:
        # 🔴 讀不到(路徑打錯/不存在)【不】算「兩段都無」——那是【另一種】狀態(code-reviewer 補審 nit)。
        #    否則一個 typo 的路徑會被讀成「這支守門沒寫天花板」,兩件事印同一個桶。
        if note:
            print(f'  ⚠️ 讀不到 {p}: {note}')
            unreadable += 1
            continue
        b = _bucket(s, r)
        both += b == 'both'; one += b == 'one'; none += b == 'none'
        tag = {'both': '✅ 兩段都有', 'one': '🟡 只一段', 'none': '⬜ 兩段都無'}[b]
        print(f'  {tag}  範圍:{("L"+str(s)) if s else "無":>6}  量具:{("L"+str(r)) if r else "無":>6}  {p}')
    # 🔴 零命中要能自我否證:印 0 的同時,印【掃了幾支、認得幾種形狀】——
    #    否則「兩段都有=0」會被讀成「沒有守門寫天花板」,而它其實是「沒有守門用【固定標題】寫」。
    scanned = len(rows) - unreadable
    print(f'\n掃了 {scanned} 支(讀得到)· 認得 2 種【逐字固定標題】({SCOPE_TITLE} · {RULER_TITLE})'
          f' · 用別的話寫的同一件事【不算】(見檔頭「天花板/量具」)')
    print(f'兩段都有 {both} · 只一段 {one} · 兩段都無 {none}'
          + (f' · ⚠️ 讀不到 {unreadable}(不計入上三堆)' if unreadable else ''))
    return 0


def self_check():
    """正負對照:用隔離 fixture(不掃 repo ⇒ 不撞到談論本標題的 docs)。"""
    d = tempfile.mkdtemp(prefix='ceiling-selftest-')
    ok = True
    try:
        # 造三支假檔
        f_one = os.path.join(d, 'only_scope.sh')
        io.open(f_one, 'w', encoding='utf-8').write(f'#!/bin/sh\n# {SCOPE_TITLE} 這片不做 X\necho hi\n')
        f_words = os.path.join(d, 'both_other_words.sh')   # 兩段內容都有,但【用別的話】寫
        io.open(f_words, 'w', encoding='utf-8').write(
            '#!/bin/sh\n# 誠實邊界:不驗 X\n# 這把尺量不到 Y(盲區)\necho hi\n')
        f_both = os.path.join(d, 'both_verbatim.py')
        io.open(f_both, 'w', encoding='utf-8').write(
            f'# {SCOPE_TITLE} 不做 X\n# {RULER_TITLE} 量不到 Y\nprint(1)\n')

        cases = [
            (f_one,   'one',  '只有【範圍】固定標題 ⇒ 只一段'),
            (f_words, 'none', '🔴 兩段【內容】都有但【用別的話】寫 ⇒ 必須落「兩段都無」'
                              '(這【不是 bug】= 證明它只認固定標題,是【正對照】)'),
            (f_both,  'both', '兩段固定標題都有 ⇒ 兩段都有'),
        ]
        for path, want, desc in cases:
            _, s, r, _ = inventory([path])[0]
            got = _bucket(s, r)
            mark = '✅' if got == want else '🔴'
            print(f'  {mark} {os.path.basename(path)}: 判「{got}」(期望「{want}」) — {desc}')
            ok = ok and got == want
    finally:
        shutil.rmtree(d, ignore_errors=True)
    # 🔴 尺自己也要有那兩段(它是量具,§12-45 對它同樣生效)
    self_path = os.path.abspath(__file__)
    _, s, r, _ = inventory([self_path])[0]
    self_ok = bool(s and r)
    print(f'  {"✅" if self_ok else "🔴"} 本工具自己:範圍 {("L"+str(s)) if s else "無"} / 量具 {("L"+str(r)) if r else "無"}'
          f' ⇒ 它是量具、自己也帶那兩段(自我合規)')
    ok = ok and self_ok
    # 🔴 標題常數是 §12-45 契約字面,而【上面兩道檢查對「改它的值」都免疫】(2026-08-27 mutation 實測):
    #    ① fixtures 是用 SCOPE_TITLE/RULER_TITLE 常數【生】的 ⇒ 改常數 fixture 跟著改 ⇒ 還是吻合;
    #    ② 自我合規那格掃 __file__ 找常數值 ⇒ 而 `SCOPE_TITLE = '<值>'` 定義行自己就含那個值 ⇒ 永遠命中。
    #    後果:typo 標題 ⇒ 拿錯標題掃真守門 ⇒ 真檔全漏報 ⇒ 而 self-check 照綠、回報「0 支寫了天花板」。
    #    釘死期望字面補住:改一個字元 ⇒ 這裡紅。(§12-45 定義的就是這兩個字串;要改標題連這行一起改。)
    title_ok = SCOPE_TITLE == '天花板/範圍:' and RULER_TITLE == '天花板/量具:'
    print(f'  {"✅" if title_ok else "🔴"} 標題常數 == §12-45 契約字面(補住「fixture 從被驗常數生」的盲區)')
    ok = ok and title_ok
    print('  ⇒', 'self-check PASS' if ok else '🔴 self-check FAIL')
    return 0 if ok else 1


def _read_paths():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if args:
        return [ln.strip() for ln in io.open(args[0], encoding='utf-8') if ln.strip()]
    if not sys.stdin.isatty():
        return [ln.strip() for ln in sys.stdin if ln.strip()]
    print('用法:傳一份清單檔路徑,或用 stdin 餵路徑(一行一支);--self-check 跑對照。', file=sys.stderr)
    return None


if __name__ == '__main__':
    if '--self-check' in sys.argv[1:]:
        sys.exit(self_check())
    paths = _read_paths()
    sys.exit(2 if paths is None else report(paths))
