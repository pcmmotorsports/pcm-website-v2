#!/usr/bin/env python3
"""anchor-crossrepo-guard.py — 你要拿【本 repo 的錨】去掃別的 repo 嗎?那把尺對它結構上失明。

🔴 為什麼有這一支(板列 ⟦7d-XREPOANCHOR⟧):
   `-7d` 2026-09-02 拿我們的錨去掃 `~/API大量上架` 與 `~/老闆腦`:
   `b9-Q15GAP` 0 · `b4-PFEDDL2` 0 · `b4-ENVREDEPLOY1` 0 · `f3-HALFWRITE1` 0。
   🔴 **而它拿【已知有牆的】`f3-EDITOVERWRITE1` 當正對照 ⇒ 也是 0。**
   ⇒ 🎯 **別的 repo 不使用我們的錨 ⇒ 那把尺對跨 repo 【結構上失明】。**
   ✅ 而 `-7d` 做對的是:**它停了、換字面、沒有繼續掃** ——
      📌 **那正是正對照該有的用法:它掛掉時你要停, 不是把它當雜訊。**

🎯 **本支就是把那個「停」變成機械的**:餵它一個錨與一個目標路徑,
   它先問「這個錨在【本 repo】撈得到嗎」, 再問「在【那邊】撈得到嗎」——
   **本 repo 有而那邊 0 ⇒ 那不是「那邊沒有這件事」, 是你的尺跨不過去。**

🛑 **它與板頭那條「引用一律用錨」不衝突, 它是那條規矩的【邊界】**:
   錨在**本 repo 內**是最好的定址;**跨出這個 repo 它退化成一個必然為 0 的字串**
   ⇒ **跨 repo 要用【內容字面】不是錨。**

🟡 只報不擋(rc 恆 0);它不會替你想出該用哪個內容字面。

⚠️ 已知盲區:
  · 它只比「檔數」—— 一個錨若在那邊真的有(例如被整段複製過去), 它會說沒問題, 而那也是對的。
  · `--selftest` 用自造目錄, 不碰真的別的 repo。
  · 它不認 `git grep` 的忽略規則, 用的是逐檔走訪(會看到 .gitignore 掉的東西)。

用法:`python3 scripts/anchor-crossrepo-guard.py <錨> <目標路徑> [--selftest]`
退出碼:0 = 問完了 · 1 = selftest 失敗 · 2 = 參數不對 / 路徑不存在
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# 🔵 `__pycache__` 是 R1 量到的:`~/API大量上架` 有 2,918 支 `.pyc`(佔掃描數約 10%)
#    ⇒ 灌水分母、拖慢執行, 而 `.pyc` 幾乎不可能誤命中我們的錨 ⇒ 跳掉。
SKIP_DIR = {'.git', 'node_modules', '.next', 'dist', 'build', '.turbo', '.venv',
            '__pycache__', 'vendor', 'target', '.mypy_cache', '.pytest_cache'}
# 🔴 大檔門檻:R1 實測掃 `~/API大量上架`(含 32MB xlsx / 52MB json)要 21 秒。
#    ⇒ 超過這個大小就跳過, 而**跳過的檔數要印出來** —— 不然那是一個看不見的分母縮水。
MAX_BYTES = 5 * 1024 * 1024


def count_files_with(needle, root, max_bytes=MAX_BYTES):
    """回 (命中檔數, 掃過的檔數) —— 🔴 兩個數一起回, 因為一個 0 要有分母才讀得懂。"""
    hit = seen = skipped = 0
    for dp, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in SKIP_DIR]
        for fn in files:
            p = os.path.join(dp, fn)
            try:
                if max_bytes and os.path.getsize(p) > max_bytes:
                    skipped += 1
                    continue
                s = open(p, encoding='utf-8', errors='ignore').read()
            except OSError:
                continue
            seen += 1
            if needle in s:
                hit += 1
    count_files_with.skipped = skipped   # 🔴 跳過幾支要說得出來, 不能靜靜縮小分母
    return hit, seen


def verdict(here, there):
    """here/there = 命中檔數。回 blind | ok | absent。"""
    if here == 0:
        return 'absent'      # 本 repo 自己就沒有 ⇒ 那個錨可能打錯了, 不是跨 repo 的問題
    return 'blind' if there == 0 else 'ok'


def selftest():
    import tempfile
    bad = 0

    def ck(name, got, want):
        nonlocal bad
        ok = got == want
        print(f"  {'✅' if ok else '🔴'} {name}(得 {got} 期望 {want})")
        bad += 0 if ok else 1

    ck('① 本 repo 有而那邊 0 ⇒ blind(這就是本支存在的理由)', verdict(3, 0), 'blind')
    ck('② 兩邊都有 ⇒ ok(正對照)', verdict(3, 1), 'ok')
    ck('③ 本 repo 自己就 0 ⇒ absent, 不得說成 blind', verdict(0, 0), 'absent')
    with tempfile.TemporaryDirectory() as d:
        open(os.path.join(d, 'a.md'), 'w', encoding='utf-8').write('有 zz-ANCHOR-1 在這裡')
        open(os.path.join(d, 'b.md'), 'w', encoding='utf-8').write('沒有那個字')
        h, s = count_files_with('zz-ANCHOR-1', d)
        ck('④ 走訪真的有在數(命中/分母)', (h, s), (1, 2))
        # 🔴 ⑥ 門檻不得把本 repo 那一側的大檔排除掉(2026-09-07 實際踩過:
        #    板子 5.26MB 被跳過 ⇒ 1 支變 0 支 ⇒ blind 翻成 absent)。
        big = os.path.join(d, 'big.md')
        open(big, 'w', encoding='utf-8').write('x' * (6 * 1024 * 1024) + ' zz-BIG-1')
        ck('⑥ max_bytes=0 ⇒ 大檔照掃(本 repo 那一側就是這樣叫的)',
           count_files_with('zz-BIG-1', d, max_bytes=0)[0], 1)
        ck('⑦ 有門檻時大檔被跳過 ⇒ 撈不到(所以門檻只能套在對面)',
           count_files_with('zz-BIG-1', d)[0], 0)
        h2, _ = count_files_with('zzqvx7719NEVER', d)
        ck('⑤ 負對照:現造字面 ⇒ 0', h2, 0)
    print(f'  ⇒ {7 - bad} PASS / {bad} FAIL')
    return 1 if bad else 0


args = [a for a in sys.argv[1:] if not a.startswith('-')]
if '--selftest' in sys.argv[1:]:
    sys.exit(selftest())
if len(args) != 2:
    print('用法:python3 scripts/anchor-crossrepo-guard.py <錨> <目標路徑>', file=sys.stderr)
    sys.exit(2)

anchor, target = args
if not os.path.isdir(target):
    print(f'🔴 目標路徑不存在:{target} ⇒ 這不是「那邊沒有」, 是路徑錯了', file=sys.stderr)
    sys.exit(2)

# 🔴🔴 本 repo 這一側【不設大小門檻】—— 2026-09-07 當場踩到:
#    我加了 5MB 門檻之後, 本 repo 從 1 支變 0 支 ⇒ 判定從 blind 變成 absent
#    (= 「你的錨可能打錯了」)。而被跳過的那一支正是 `docs/launch-todo.md` 本身,
#    **5.26MB, 而它就是錨的家**。
#    📌 一個為了效能設的門檻, 把【唯一會命中的那支檔】排除掉 ⇒ 判定翻面而沒有東西會叫。
#    ⇒ 門檻只套在【別人的 repo】那一側(那裡才有 32MB 的 xlsx)。
here, here_n = count_files_with(anchor, os.path.join(ROOT, 'docs'), max_bytes=0)
there, there_n = count_files_with(anchor, target)
v = verdict(here, there)
print(f'錨 `{anchor}`:本 repo docs/ {here} 支(掃 {here_n})· {target} {there} 支(掃 {there_n}, 因過大跳過 {count_files_with.skipped} 支)')
if v == 'blind':
    print('🔴 **本 repo 有而那邊 0 ⇒ 那【不是】「那邊沒有這件事」, 是你的尺跨不過去。**')
    print('   別的 repo 不使用我們的錨 ⇒ 錨對跨 repo 結構上失明(板列 ⟦7d-XREPOANCHOR⟧)。')
    print('   ✅ 改用【內容字面】—— 那件事在那邊會被講成什麼話, 拿那句去掃。')
elif v == 'absent':
    print('🟡 **本 repo 自己就 0** ⇒ 先確認這個錨有沒有打錯;這一發答不出跨 repo 的問題。')
else:
    print('✅ 兩邊都撈得到 ⇒ 這個錨在那邊是通的(而它是特例, 不是常態)。')
sys.exit(0)
