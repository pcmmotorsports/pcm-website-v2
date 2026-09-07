#!/usr/bin/env python3
r"""擋列 × 「碼已在 `origin/dev` 而列仍 open」的**篩選**表(不是判定)。

用法:
    python3 scripts/board-code-landed-screen.py            # 印表
    python3 scripts/board-code-landed-screen.py --selftest # 內建對照

🛑🛑 **本表印的是 `N`(尺篩出來的), 而【可派的是 M, 只有開檔才知道】。**
   2026-09-07 實測:`N=8` ⇒ 逐列開檔 ⇒ **`M=1`**。
   ⇒ 📌 **只報 N 會派出去 7 件白工**, 而白工最貴的形狀是
      **每個接到的人要花 20-40 分鐘證明它不該做**。
   ✅ 主視窗 2026-09-07 裁:**表頭兩個數並列, 而 `M` 由人填、印 `M=__` 不印 `0`**
      —— 🎯 **一個印出來的 `0` 會被讀成「量到的 0」, 而它其實是「還沒有人開檔」。**

🔴 **這把尺漏很多, 而我量過**:正對照 = 板上**態已 `done`** 的有錨擋列餵同一把尺
   ⇒ 2026-09-07 量到 **23 / 218 = 11%**。⇒ **N 是下界。**
   🛑 而**不要拿 11% 去乘出「大約幾件」** —— 那個比例是對 `done` 母體量的,
      拿去推 `open` 母體是**換了母體**;乘出來的數字看起來像估算, 而它是編的。
   🔵 成因已知:板列 `⟦0e-ANCHORNOTINCOMMIT⟧` 逐字「commit 沒帶錨 ⇒ 盤點拿到乾淨的 0」。

🛑 **本表不用、也不可以用「這個錨被幾顆 commit 提到」排序或當判準** ——
   `⟦acct-ANCHORCOUNTBLIND⟧` 用 ground truth 複跑過:**三個顆數同為 6 的錨,
   真實狀態是「做完了」/「做了 3/4」/「完全沒做」**, 而顆數最高的那個最沒開始做。
   ⇒ **本表按板行號排。**

分層:
  **甲** 錨出現在某顆 commit 的**標題**, 且那顆動到 `docs/` 與 `.md` 以外的檔 ⇒ 值得開檔
  **乙** 錨只出現在 **body** ⇒ 訊號弱(body 常是順帶提到別列)⇒ **不要照乙層派工**
"""
import io
import re
import subprocess
import sys

BOARD = 'docs/launch-todo.md'
SPLIT = re.compile(r'(?<!\\)\|')
STATES = ('open', 'doing', 'parked', 'done', 'standing')
ANCHOR = re.compile(r'⟦[^⟦⟧]+⟧')
SINCE = '2026-08-01'


LIVE_WINDOWS = ('account', 'auth', '-db', 'mail', 'ship', 'front', 'tidy')
WAITING = re.compile(r'待派|等人|等時機|等 Sean|等一支|前置|封存|決策題不是工程題|不收|不要派|已裁|不做')


def dispatchable_denominator(path):
    """「還剩多少可派」的分母 —— 回 (擋列總數, 有現役窗名, 寫著在等, 兩者皆無)。

    🔴 **2026-09-07 第一次有人把這個分母量出來**(在那之前只有「還在擋 N」,
       而那個 N 把【有人在做】【在等前置】【真的沒人碰】混成一個數)。
    🎯 **量到的那一發**:擋列 **65** ⇒ 現役窗名 **37** · 寫著在等 **15**
       ⇒ **兩者皆無只有 13**, 而當時 tidy 已開過其中 **6** ⇒ **實際剩 7 列**。
       (基準 `origin/dev = 41443a6c2`;**而本函式每次當場算, 不寫死** ——
        寫死的數字在下一個人讀到時就過期了。)
    🛑 **它答不出什麼**:「寫著在等」是**字面比對**, 而
       ①有人在等而沒寫 ⇒ 會被算進「兩者皆無」(**高估可派**)
       ②寫著待派而其實已有人做 ⇒ 也會(**同方向**)
       ⇒ 📌 **這個分母的偏誤是【單向的:偏高】** —— 它是上界不是實數。
    """
    tot = own = wait = free = 0
    for line in io.open(path, encoding='utf-8'):
        if not line.startswith('| '):
            continue
        c = SPLIT.split(line)
        if len(c) < 5 or c[1].strip() != 'open':
            continue
        last = [x for x in c if x.strip()][-1].strip()
        if not last.startswith('⟨擋'):
            continue
        tot += 1
        if any(w in c[4] for w in LIVE_WINDOWS):
            own += 1
        elif WAITING.search(c[4]) or WAITING.search(last[:600]):
            wait += 1
        else:
            free += 1
    return tot, own, wait, free


def board_rows(path):
    """回 [(行號, 態, 錨)] —— 只收末格開頭是 ⟨擋 的、且錨欄有錨的。"""
    out = []
    for n, line in enumerate(io.open(path, encoding='utf-8'), 1):
        if not line.startswith('| '):
            continue
        c = SPLIT.split(line)
        if len(c) < 5 or c[1].strip() not in STATES:
            continue
        last = [x for x in c if x.strip()][-1].strip()
        if not last.startswith('⟨擋'):
            continue
        m = ANCHOR.search(c[2])
        if m:
            out.append((n, c[1].strip(), m.group(0)))
    return out


def dev_commits(since=SINCE, ref='origin/dev'):
    """回 [(sha9, subject, body, [非 docs 檔])]。查無 ⇒ None(**與空清單分得開**)。"""
    r = subprocess.run(
        ['git', 'log', ref, '--since=' + since,
         '--format=%x00%H%x01%s%x01%b%x01', '--name-only'],
        capture_output=True, text=True)
    if r.returncode != 0:
        return None
    out = []
    for blk in r.stdout.split('\x00'):
        p = blk.split('\x01')
        if len(p) < 4 or not blk.strip():
            continue
        fs = [f for f in p[3].split('\n') if f.strip()]
        code = [f for f in fs if not f.startswith('docs/') and not f.endswith('.md')]
        out.append((p[0][:9], p[1], p[2], code))
    return out


def screen(rows, commits):
    """回 (甲, 乙)。甲乙都按板行號排 —— **刻意不按任何顆數排**。"""
    a, b = [], []
    for ln, st, tok in rows:
        if st not in ('open', 'doing'):
            continue
        subj = [c for c in commits if tok in c[1] and c[3]]
        body = [c for c in commits if tok in c[2] and tok not in c[1] and c[3]]
        if subj:
            a.append((ln, st, tok, subj[0][0], subj[0][1]))
        elif body:
            b.append((ln, st, tok, body[0][0], body[0][1]))
    return sorted(a), sorted(b)


def done_anchors(path):
    """態已 `done` 的**所有**有錨列(不限 token)—— 正對照的母體。

    🔴 **第一版拿 `board_rows()` 的結果去濾 `done`, 而那支只收 `⟨擋⟩` 的列**
       ⇒ 分母從 **218 掉到 1** ⇒ 召回率印 `0%`。
       🛑 **一個分母 1 的正對照, 印出來的百分比不是讀數。**
       📌 **與本板記過的同族**:「**一個正對照如果【由構造上就不可能成功】,
          它印的紅不是發現**」—— 這一次是反過來:**它印的那個 0 不是發現。**
       🔬 抓到它的**不是 selftest**(fixture 裡剛好只有 1 列 done, 兩版都印 1)——
          是**跑真 repo 看到分母變成 1**。
    """
    out = []
    for line in io.open(path, encoding='utf-8'):
        if not line.startswith('| done '):
            continue
        c = SPLIT.split(line)
        if len(c) < 3:
            continue
        m = ANCHOR.search(c[2])
        if m:
            out.append(m.group(0))
    return out


def recall(path, commits):
    """正對照:態已 done 的有錨列, 這把尺命中幾個。回 (命中, 分母)。"""
    d = done_anchors(path)
    return sum(1 for t in d if any(t in c[1] and c[3] for c in commits)), len(d)


def main():
    rows = board_rows(BOARD)
    commits = dev_commits()
    if not rows or commits is None:
        print(f'⏸️  量不到:板列撈到 {len(rows)} 列 · git log '
              f'{"失敗" if commits is None else "OK"} ⇒ **不是「沒有候選」**')
        return 2
    a, b = screen(rows, commits)
    hit, den = recall(BOARD, commits)
    neg = sum(1 for c in commits if '⟦zzq8842-NOSUCH⟧' in c[1])
    print(f'# 擋列 × 碼已落而仍 open —— **篩選**表(不是判定)')
    print()
    print(f'## 🛑 **N = {len(a)}(甲層, 尺篩出來的) → M = __(可派, 由開檔的人填)**')
    print('　**`M` 不預先印 0** —— 一個印出來的 0 會被讀成「量到的 0」,'
          '而它其實是「還沒有人開檔」。')
    print(f'　🔵 2026-09-07 首次實測:`N=8` ⇒ 開檔後 **`M=1`** ⇒ **只報 N 會派出 7 件白工。**')
    print('　🔴 **而 `N -> M` 在【過濾器那一層】也成立** —— 2026-09-07 同日另一發:'
          '拿 `audit|稽核|actor|role|admin` 過濾 graphify 的 14 個節點 ⇒ **filter N=8**,'
          ' 而**逐個開來看 ⇒ M=0**(8 個全是工具自己的 `audit()` 函式, 命中的是英文字)。')
    print('　　📌 **機械過濾比肉眼強, 而它一樣不是判定 —— 那 N 個還是要打開。**')
    print('　　🔬 2026-09-07 第三發:過濾 `ALTER DEFAULT PRIVILEGES` 那題 ⇒ **filter N=3 而 M=0**,'
          ' **誤報率 100%**(3 個全是 `package.json` 的 `default` 匯出欄位)。')
    print('　🟢 **而 graphify 有用的那一發長什麼樣(2026-09-07 唯一一發)**:`Start` 中的是'
          ' **真受詞**(「顯示端要顯示成什麼」/ `refund-manual-reversal-verify.sh` /'
          ' `RefundQuoteRejection`)⇒ 41 節點裡 33 個同族, 抽看前 10 個全中。')
    print('　　📌 **用法:餵【這個 repo 裡真的存在的名字】, 不要餵形容詞。**'
          ' 同日對照:「退款畫面」中了, 而「射程」「根治」「範圍」「default」全是形容詞或泛詞 ⇒ 相關 0。')
    print()
    _t, _o, _w, _f = dispatchable_denominator(BOARD)
    print(f'## 🔴 **「還剩多少可派」的分母(當場算, 不寫死)**')
    print(f'　`open` + ⟨擋⟩ **{_t}** ⇒ 誰欄有現役窗名 **{_o}** · 誰欄或末格寫著在等 **{_w}**'
          f' ⇒ **兩者皆無 {_f}**')
    print('　🛑 **偏誤是單向的:偏高** —— 「寫著在等」是字面比對, 有人在等而沒寫的會被算進'
          '「兩者皆無」⇒ **這是上界不是實數。**')
    print('　🔵 2026-09-07 首量:65 / 37 / 15 / **13**, 而當時已開過其中 6 ⇒ **實際剩 7**。')
    print()
    print(f'掃 `origin/dev` since {SINCE} 共 **{len(commits)}** 顆 · 擋列有錨 **{len(rows)}** 列')
    print(f'· 🔵 負對照 現造錨 ⇒ **{neg}** 顆'
          f'· 🔴 正對照(態已 done 的 {den} 列)⇒ 命中 **{hit}** '
          f'⇒ **召回率 {100*hit/max(1,den):.0f}%** ⇒ **N 是下界**')
    print('　🛑 **不要拿這個百分比去乘出「大約幾件」** —— 它是對 `done` 母體量的。')
    print()
    for name, grp, note in (('甲', a, '值得開檔'), ('乙', b, '🛑 訊號弱, **不要照這層派工**')):
        print(f'## {name}層({len(grp)} 列){note}')
        print()
        print('| 板行 | 態 | 錨 | 一顆例子 | 標題 |')
        print('|---|---|---|---|---|')
        for ln, st, tok, sha, subj in grp:
            print(f'| `:{ln}` | {st} | `{tok}` | `{sha}` | {subj[:52].replace("|", chr(92) + "|")} |')
        print()
    return 0


def selftest():
    import os
    import shutil
    import tempfile
    d = tempfile.mkdtemp()
    fails = []

    def ck(name, got, want):
        ok = got == want
        print(f'  {"✅" if ok else "🔴"} {name}:{got}(期望 {want})')
        if not ok:
            fails.append(name)

    p = os.path.join(d, 'b.md')
    io.open(p, 'w', encoding='utf-8').write('\n'.join([
        '| 態 | 錨 | 事 | 誰 | x |', '|---|---|---|---|---|',
        '| open | ⟦t-A⟧ | 甲 | `mail` | ⟨擋(t)⟩ x |',
        '| open | ⟦t-B⟧ | 乙 | `mail` | ⟨擋(t)⟩ x |',
        '| done | ⟦t-D⟧ | 丁 | `mail` | ⟨擋(t)⟩ x |',
        '| open | ⟦t-C⟧ | 丙 | `mail` | ⟨不擋(t)⟩ x |']) + '\n')
    rows = board_rows(p)
    ck('① 只收 ⟨擋⟩ 的列', len(rows), 3)
    ck('② 🔵 ⟨不擋⟩ 不進來(尺不是恆收)', any(r[2] == '⟦t-C⟧' for r in rows), False)
    cm = [('aaa111aaa', '做了 ⟦t-A⟧', '', ['src/x.ts']),
          ('bbb222bbb', '只動文件 ⟦t-B⟧', '', []),
          ('ccc333ccc', '別的事', '順帶提 ⟦t-B⟧', ['src/y.ts']),
          ('ddd444ddd', '做了 ⟦t-D⟧', '', ['src/z.ts'])]
    a, b = screen(rows, cm)
    ck('③ 標題點名 + 動到碼 ⇒ 甲層', [r[2] for r in a], ['⟦t-A⟧'])
    ck('④ 🔴 標題點名【但零非 docs 檔】⇒ 不進甲層', any(r[2] == '⟦t-B⟧' for r in a), False)
    ck('⑤ 只在 body ⇒ 乙層', [r[2] for r in b], ['⟦t-B⟧'])
    ck('⑥ 🔵 態 done 的不進甲乙(它不是候選)',
       any(r[2] == '⟦t-D⟧' for r in a + b), False)
    ck('⑦ 而 done 那列【要進正對照分母】', recall(p, cm), (1, 1))
    # 🔴 這一格是【跑真 repo】才逼出來的:第一版拿只收 ⟨擋⟩ 的 board_rows 去濾 done
    #    ⇒ 真 repo 分母 218 掉到 1。fixture 兩版都印 1 ⇒ **selftest 分不出來。**
    _p2 = os.path.join(d, 'b2.md')
    io.open(_p2, 'w', encoding='utf-8').write('\n'.join([
        '| 態 | 錨 | 事 | 誰 | x |', '|---|---|---|---|---|',
        '| done | ⟦t-D⟧ | 丁 | `mail` | ⟨擋(t)⟩ x |',
        '| done | ⟦t-E⟧ | 戊 | `mail` | ⟨不擋(t)⟩ x |',
        '| done | ⟦t-F⟧ | 己 | `mail` | ⟨未判(t)⟩ x |']) + '\n')
    ck('⑦b 🔴 正對照母體【不限 token】—— done 列全收(不是只收 ⟨擋⟩)',
       len(done_anchors(_p2)), 3)
    ck('⑦c 🔵 而 board_rows 對同一個檔只收 1 列(證明兩者【真的不同】)',
       len(board_rows(_p2)), 1)
    ck('⑧ 🔵 git log 失敗 ⇒ None(與空清單分得開)',
       dev_commits(ref='zzq8842-no-such-ref'), None)
    # 🔴 **分母的【算法】要單獨有格** —— ⑬⑭ 守的是「有沒有印那段字」,
    #    而 2026-09-07 突變實測:把「排除現役窗名」那一行拿掉 ⇒ **rc=0、零格紅**
    #    ⇒ 📌 **那兩格守的是印字, 不是算術。**
    _dp = os.path.join(d, 'denom.md')
    io.open(_dp, 'w', encoding='utf-8').write('\n'.join([
        '| 態 | 錨 | 事 | 誰 | x |', '|---|---|---|---|---|',
        '| open | ⟦d-1⟧ | 甲 | 線【信】`mail` | ⟨擋(t)⟩ x |',
        '| open | ⟦d-2⟧ | 乙 | 待派 | ⟨擋(t)⟩ x |',
        '| open | ⟦d-3⟧ | 丙 | 沒有人接手 | ⟨擋(t)⟩ x |',
        '| open | ⟦d-4⟧ | 丁 | 沒有人接手 | ⟨不擋(t)⟩ x |',
        '| done | ⟦d-5⟧ | 戊 | 沒有人接手 | ⟨擋(t)⟩ x |']) + '\n')
    ck('⑮ 分母算術:總 3(⟨不擋⟩ 與 done 不進)· 現役窗 1 · 在等 1 · 皆無 1',
       dispatchable_denominator(_dp), (3, 1, 1, 1))
    # 🔵 端到端:走 main() 那條真的路, 不在這裡重算判準
    import contextlib
    global BOARD
    _b = BOARD
    try:
        BOARD = p
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            main()
        o = buf.getvalue()
        ck('⑨端到端 表頭印 N 與 M=__(而不是 M=0)', 'M = __' in o and 'M = 0' not in o, True)
        ck('⑩端到端 印得出召回率那一行', '召回率' in o, True)
        ck('⑪端到端 明說不要拿百分比去乘', '不要拿這個百分比' in o, True)
        # 🔴 `N → M` 在【過濾器那一層】也成立 —— 2026-09-07 同日另一發實測
        ck('⑫端到端 明說過濾器那一層也要開檔(那 N 個還是要打開)',
           ('過濾器那一層' in o and '還是要打開' in o), True)
        ck('⑬端到端 印出【還剩多少可派】的四個數', '兩者皆無' in o, True)
        ck('⑭端到端 明說那個分母是【上界不是實數】', '上界不是實數' in o, True)
        ck('⑯端到端 印出 graphify 用法提示(餵真名字不要餵形容詞)',
           ('真的存在的名字' in o and '不要餵形容詞' in o), True)
    finally:
        BOARD = _b
        shutil.rmtree(d, ignore_errors=True)
    print('SELFTEST ' + ('PASS' if not fails else 'FAIL:' + ','.join(fails)))
    return 0 if not fails else 1


if __name__ == '__main__':
    sys.exit(selftest() if '--selftest' in sys.argv[1:] else main())
