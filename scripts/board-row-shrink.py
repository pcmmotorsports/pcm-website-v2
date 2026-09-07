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


def _rows(text):
    """一列 = 一個錨。同錨多列時取【最長】那列 —— 縮水偵測要跟最飽的那份比。"""
    out = {}
    for ln in text.splitlines():
        if not ln.startswith('|'):
            continue
        m = ANCHOR.search(ln)
        if m and len(ln) > len(out.get(m.group(1), '')):
            out[m.group(1)] = ln
    return out


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


def filter_acked(hits, gone, acked):
    """把已確認的錨濾掉。🔴 放行【A】絕不可以順便放行【B】—— 這是本出口的安全性質。"""
    return ([h for h in hits if h[0] not in acked],
            [k for k in gone if k not in acked])


def compare(old_text, new_text):
    """回傳 [(錨, br舊, br新, len舊, len新)] —— 只收【下降】的。

    🛑 `<br>` 下降【一段就報】(實測 40 顆 commit 誤報 0);
       字元下降要 >= CHAR_DROP_FLOOR 才報(否則排版正規化會吵)。
    """
    old, new = _rows(old_text), _rows(new_text)
    hits = []
    for k in sorted(set(old) & set(new)):
        b0, b1 = old[k].count('<br>'), new[k].count('<br>')
        l0, l1 = len(old[k]), len(new[k])
        if b1 < b0 or (l0 - l1) >= CHAR_DROP_FLOOR:
            hits.append((k, b0, b1, l0, l1))
    return hits


def vanished(old_text, new_text):
    """整列不見了的錨 —— 🔴 那【不是變短, 是消失】, `compare()` 看不到它(它只走交集)。

    2026-09-08 B 問「整列被刪掉時你的尺印什麼」⇒ 當時的答案是【印沒事】⇒ 補這一格。
    ⚠️ 實測最近 40 顆碰板 commit **一列都沒消失過** ⇒ 這格**沒有真實正對照**, 只有自檢造的。
       📌 所以它報的是「停下看一眼」不是「出事了」—— 合併重複列本來就會讓一個錨消失。
    """
    return sorted(set(_rows(old_text)) - set(_rows(new_text)))


def selftest():
    # 🔴 剝掉繼承來的 git 環境 —— 否則 selftest 會在【呼叫者的 index】上跑
    for v in ('GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE', 'GIT_OBJECT_DIRECTORY',
              'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_NAMESPACE'):
        os.environ.pop(v, None)
    base = '| | open | ⟦A⟧ | 甲<br>乙<br>丙 | 誰 | 末 |\n| | open | ⟦B⟧ | 丁 | 誰 | 末 |\n'
    ok = True

    # 負對照:一字未改 ⇒ 必須 0
    n = len(compare(base, base))
    print(f'  負對照 一字未改 ⇒ {n} (期望 0) {"✅" if n == 0 else "❌"}'); ok &= n == 0

    # 正對照①:掉 <br> ⇒ 必須抓到, 且抓到的是 A
    h = compare(base, base.replace('甲<br>乙<br>丙', '甲<br>乙'))
    good = len(h) == 1 and h[0][0] == 'A' and h[0][1] == 2 and h[0][2] == 1
    print(f'  正對照① 掉一段 <br> ⇒ {h} {"✅" if good else "❌"}'); ok &= good

    # 正對照②:<br> 沒變而【字元變少】 ⇒ 也要抓到(這是第二個維度, 不能被第一個蓋掉)
    # 🔴 這格的 fixture 我改壞過兩次, 兩次都是自檢當場印 ❌ 抓到:
    #    ① `丙`→`X` 都是 1 個字元 ⇒ 根本沒變短
    #    ② 加了 44 字元門檻之後, 只掉 1 字元的 fixture 低於門檻 ⇒ 該不報
    #    📌 fixture 沒有真的把待測情境做出來, 也是一種假綠。
    long_base = '| | open | ⟦A⟧ | ' + '甲<br>乙<br>' + '丙' * 80 + ' | 誰 | 末 |\n'
    h = compare(long_base, long_base.replace('丙' * 80, '丙' * 20))
    good = len(h) == 1 and h[0][0] == 'A' and h[0][1] == h[0][2] == 2
    print(f'  正對照② <br>同數而掉 60 字元 ⇒ {h} {"✅" if good else "❌"}'); ok &= good

    # 邊界:變長 ⇒ 不報(否則每次補內容都會叫, 這支就會被無視)
    n = len(compare(base, base.replace('丁', '丁<br>戊')))
    print(f'  邊界 變長不報 ⇒ {n} (期望 0) {"✅" if n == 0 else "❌"}'); ok &= n == 0

    # 邊界:新錨沒有對照 ⇒ 不報
    n = len(compare(base, base + '| | open | ⟦C⟧ | 新 | 誰 | 末 |\n'))
    print(f'  邊界 新錨不報 ⇒ {n} (期望 0) {"✅" if n == 0 else "❌"}'); ok &= n == 0

    # 🔴 門檻:掉【一點點】字元不報(排版正規化), 掉【一段的量】要報
    tiny = base.replace('丁', '')                       # 掉 1 字元
    n = len(compare(base, tiny))
    print(f'  門檻 掉 1 字元不報 ⇒ {n} (期望 0) {"✅" if n == 0 else "❌"}'); ok &= n == 0
    long_row = '| | open | ⟦D⟧ | ' + 'X' * 200 + ' | 誰 | 末 |\n'
    n = len(compare(base + long_row, base + long_row.replace('X' * 200, 'X' * 100)))
    print(f'  門檻 掉 100 字元要報 ⇒ {n} (期望 1) {"✅" if n == 1 else "❌"}'); ok &= n == 1

    # 🔴 整列消失:compare 看不到(走交集), vanished 才看得到
    n = len(compare(base, '| | open | ⟦B⟧ | 丁 | 誰 | 末 |\n'))
    v = vanished(base, '| | open | ⟦B⟧ | 丁 | 誰 | 末 |\n')
    good = n == 0 and v == ['A']
    print(f'  整列消失 compare 看不到 ⇒ {n} · vanished 撈到 {v} {"✅" if good else "❌"}'); ok &= good

    # ───── 出口 BOARD_SHRINK_ACK ─────
    hs = [('A', 5, 2, 900, 400), ('B', 4, 1, 800, 300)]
    gs = ['C']

    def ack(v):
        os.environ[ACK_ENV] = v
        return _acked()

    a, w = ack('A')
    lh, lg = filter_acked(hs, gs, a)
    good = [x[0] for x in lh] == ['B'] and lg == ['C'] and not w
    print(f'  出口 放行 A ⇒ 剩 {[x[0] for x in lh] + lg} (期望 [B, C]) {"✅" if good else "❌"}'); ok &= good

    a, w = ack('A, C')
    lh, lg = filter_acked(hs, gs, a)
    good = [x[0] for x in lh] == ['B'] and lg == []
    print(f'  出口 逗號多錨 ⇒ 剩 {[x[0] for x in lh] + lg} (期望 [B]) {"✅" if good else "❌"}'); ok &= good

    # 🔴 這一格是本出口的安全性質:放行【不存在的錨】不可以放行任何真的
    a, w = ack('ZZ-NOSUCH')
    lh, lg = filter_acked(hs, gs, a)
    good = len(lh) == 2 and len(lg) == 1
    print(f'  出口 錨打錯 ⇒ 仍叫 {len(lh) + len(lg)} 列 (期望 3) {"✅" if good else "❌"}'); ok &= good

    # 🔴🔴 萬用字元必須被拒 —— 一個放行全部的開關與 --no-verify 只差一個名字
    for v in ('*', 'all', 'ANY', 'b4-*', '1'):
        a, w = ack(v)
        lh, lg = filter_acked(hs, gs, a)
        bad = bool(w) and len(lh) + len(lg) == 3
        print(f'  出口 萬用字元 {v!r} ⇒ 拒絕 {w} · 仍叫 {len(lh) + len(lg)} 列 {"✅" if bad else "❌"}')
        ok &= bad

    os.environ.pop(ACK_ENV, None)
    a, w = ack('') if False else (_acked())
    print(f'  出口 沒設變數 ⇒ 放行 {sorted(a)} (期望 []) {"✅" if not a and not w else "❌"}')
    ok &= not a and not w

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
    src = 'index(--staged)' if staged else '工作樹'
    acked, wildcards = _acked()

    if wildcards:
        print(f'🛑 {ACK_ENV} 收到「放行全部」的值 {wildcards} ⇒ 拒絕。', file=sys.stderr)
        print(f'   這道閘的出口是【逐個錨】—— 一個放行全部的開關與 --no-verify 只差一個名字。',
              file=sys.stderr)

    all_names = [k for k, *_ in hits] + list(gone)
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
        print(f'  變短  ⟦{k}⟧  <br> {b0}→{b1}   字元 {l0}→{l1}')
    for k in left_gone:
        print(f'  消失  ⟦{k}⟧  ← 整列不見了(合併重複列是正當的, 而請說一句是哪一種)')
    names = [k for k, *_ in left_hits] + left_gone
    print('\n📌 這是【停】不是【擋】:收窄末格、刪過期字面、合併重複列都是正當的。')
    print('   要答的是:少掉的那些字, 是我有意刪的, 還是我重寫整列時【沒抄回來】的?')
    print('\n✅ 看過了、確認是有意的 ⇒ 照抄這一行(它只放行下面這幾個錨, 不會關掉這道閘):')
    print(f"\n   {ACK_ENV}='{','.join(names)}' git commit -F <你的訊息檔> -- <你的檔>\n")
    print('   🔴 而 commit body 要寫一句【為什麼少】—— 那句話是給下一個人的,'
          ' 不是給這道閘的。')
    print(f'   🛑 不要用 git commit --no-verify:那會把【所有】hook 一起關掉。')
    return 3


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
