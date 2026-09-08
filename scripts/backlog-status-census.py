#!/usr/bin/env python3
"""數 backlog 的條目數與狀態欄寫法 —— 而【數法寫在這裡】, 不是寫在結論旁邊。

板列(總帳狀態欄加封閉集欄位)逐字:
  「這一列的第一件事不是做事, 是【補數法】—— 五種數法量到 593 / 764 / 2 / 772,
    **沒有一個是 713**, 而本列沒附數法。」
  「601 + 112 = 713 ⇒ 那三個數字是【同一次量測的內部一致三格】⇒ 整組一起無法重現。
    **內部一致不是效度。**」

🛑 所以本支【不給一個數字】—— 它給【三個各自寫明問法的數字】, 並印出它們的差在哪。
"""
import io
import re
import sys

import os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = os.path.join(ROOT, 'docs/phase-1-backlog.md')
lines = io.open(P, encoding='utf-8').read().split('\n')

# ── 數法一:條目 = 行首 `### #<數字>.`(帶編號的那種才算一條)
# 🔴 只認【句點】格式是錯的(code-reviewer R1 must-fix, 2026-09-07)——
#    板上實際有四種:句點 633 · 中點 `### #N ·` 166 · 無標點 13 · 括號 1 ⇒ 合計 814。
#    ⇒ 我第一版報 633, **低估 22%**;而它印的那句「差 236 = 沒編號的小節」也跟著是錯的
#      —— 那 236 裡有 181 條其實是【已編號】的條目, 真正無編號的只有 55 條。
#    📌 一把只認一種標點的尺, 會把【同一種東西的另一種寫法】報成【別的東西】。
ENTRY = re.compile(r'^### #(\d+)([a-z]?)')
entries = [(i, m.group(1) + m.group(2)) for i, t in enumerate(lines)
           for m in [ENTRY.match(t)] if m]

# ── 數法二:板子 08-27 用的那把 `grep -cE '^### '`(它數的是【標題】不是條目)
heads = [t for t in lines if t.startswith('### ')]

# ── 數法三:狀態欄 = 條目底下第一個 `- **狀態:**`(在下一個 `### ` 之前)
STATUS = re.compile(r'^\s*-\s*\*\*狀態[::]\*\*\s*(.*?)\s*$')
starts = [i for i, _ in entries]
bounds = starts[1:] + [len(lines)]
with_status, without = [], []
values = {}
for (i, num), end in zip(entries, bounds):
    hit = None
    for j in range(i + 1, end):
        if lines[j].startswith('### '):
            break
        m = STATUS.match(lines[j])
        if m:
            hit = m.group(1)
            break
    if hit is None:
        without.append(num)
    else:
        with_status.append(num)
        values[hit] = values.get(hit, 0) + 1

# 🔴 「相異寫法」這個數字【被自由文字尾巴灌水】(code-reviewer R1 must-fix):
#    多數不是獨立狀態, 是同一個狀態加一段說明 —— 例
#      「⏳ 待執行」與「⏳ 待執行。(本行 2026-08-18 由 G6 補)依據:…」是同一格。
#    ⇒ 直接拿 468 去建封閉集, 會把大量自由文字誤判成需要各自收錄的狀態值。
#    ✅ 所以這裡印【兩個數】, 而不是一個:原樣 · 與【砍掉尾巴之後】。
#    🛑 而正規化本身是一個【判斷】—— 下面這條規則(取第一個標點之前)是我挑的,
#       它會把「⏳ Phase 2/3」這種本來就含標點的也砍短。⇒ 它是【下界】不是答案。
NORM = re.compile(r'^([^。,,(()\[]*)')

if '--selftest' in sys.argv[1:]:
    # 🔴 三格:條目認得出 / 沒編號的 ### 不算條目 / 狀態欄抓得到
    L = ['### #1. 甲', '- **狀態:** ⏳ 待執行', '### 沒有編號的小節', '### #2b. 乙']
    e = [m.group(1)+m.group(2) for t in L for m in [ENTRY.match(t)] if m]
    h = [t for t in L if t.startswith('### ')]
    # 🔴 ④ NORM 那一格(2026-09-08 補;`selftest-guards-what.py` 量到它【瞎掉也不會紅】)
    #    成因是位置:NORM 原本定義在 selftest `sys.exit()` 【之後】⇒ 突變過的 NORM 從來沒被跑到。
    #    ⇒ 修法是把它連同解釋它的註解一起搬上來, 不是加一個新旗標。
    #    🛑 而這一格【刻意不寫成 `NORM.match(...).group(1)`】—— 瞎掉時 match 回 None,
    #       那樣會 AttributeError【爆掉】; 而鑽機主路徑的 run() 只看 rc 非 0
    #       ⇒ 爆掉會被讀成「有東西守著」= 一個假綠。先 bool(m) 才是【紅在斷言】。
    _m = NORM.match('⏳ 待執行。(本行 2026-08-18 由 G6 補)依據:…')
    ok_norm = bool(_m) and _m.group(1).strip() == '⏳ 待執行'
    ok = (e == ['1', '2b'], len(h) == 3, bool(STATUS.match(L[1])), ok_norm)
    for i, (name, v) in enumerate(zip(
            ['① 條目認得出(含 2b 這種尾碼)', '② 沒編號的 ### 也算標題(所以兩個數不同)',
             '③ 狀態欄抓得到',
             '④ NORM 砍得掉尾巴(弄瞎它 ⇒ 這一格紅, 而不是爆掉)'], ok), 1):
        print(f"  {'✅' if v else '🔴'} {name}")
    print(f'  ⇒ {sum(ok)} PASS / {len(ok) - sum(ok)} FAIL')
    sys.exit(0 if all(ok) else 1)

# 🔴 分母是 0 【不是乾淨】—— 那與「檔路徑錯了」印同一個東西
if not entries:
    print(f'🔴 條目數是 0(讀 {P})⇒ 尺沒接上, 不是 backlog 空的', file=sys.stderr)
    sys.exit(2)
print(f'檔:{P}')
print()
print(f'① 條目數(行首 `### #<數字>.`)              = {len(entries)}')
print(f'② 標題數(行首 `### `, 板子 08-27 用的那把)  = {len(heads)}')
print(f'   ⇒ 差 {len(heads) - len(entries)} —— 那些是【沒有編號的 ### 小節】, 不是條目')
print()
print(f'③ 有狀態欄 = {len(with_status)} · 無狀態欄 = {len(without)}'
      f' · 相加 = {len(with_status) + len(without)}(應等於 ①)')
print(f'④ 狀態欄的相異寫法 = {len(values)} 種')
print()
print('   最常見前 8 種:')
for v, n in sorted(values.items(), key=lambda kv: -kv[1])[:8]:
    print(f'     {n:4d}  {v[:60]}')
print()
norm = {}
for v, c in values.items():
    k = NORM.match(v).group(1).strip()
    norm[k] = norm.get(k, 0) + c
print(f'   ⑤ 砍掉尾巴之後的相異寫法 = {len(norm)} 種(原樣 {len(values)} 種)')
print('      最常見前 6 種(正規化後):')
for v, n2 in sorted(norm.items(), key=lambda kv: -kv[1])[:6]:
    print(f'        {n2:4d}  {v[:44]}')
print()

uniq = sorted(x for x, c in values.items() if c == 1)
print(f'   只出現一次的寫法 = {len(uniq)} 種(封閉集要收的就是這一批)')
print()
print(f'🔴 負對照:現造狀態字面 zzqvx7719 出現 = '
      f'{sum(1 for v in values if "zzqvx7719" in v)} 次')
print(f'⚪ 正對照:編號重複的條目 = '
      f'{len(entries) - len(set(n for _, n in entries))} 個(板子自己記過撞號)')
