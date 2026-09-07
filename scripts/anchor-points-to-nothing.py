#!/usr/bin/env python3
"""碼裡把一件事【交給】一個板上不存在的錨 ⇒ 叫。

🔬 **來源(實例先於工具)**:`⟦mail-DEADMAILREQUEUE⟧` 2026-09-07 ——
   `supabase/migrations/20260907060000_m4b_pending_views_rearm_own_skips.sql:11-12` 逐字
   「死信怎麼救是**另一件事** … ⇒ 板列 `⟦mail-DEADMAILREQUEUE⟧`。**本支不碰 `failed`。**」
   而那個錨**在板上錨欄 0 列**(同一支檔引用它 **6 次**)。
   🛑 **那句話的作用是【把一件事交出去】, 而它交給了一個不存在的地方**
   ⇒ 📌 **比「少一列」嚴重的地方在:它同時讓下一個人【停止追問】。**

🔵 **本支是【守門】不是【盤點】**(主視窗 `-f8` 2026-09-07 點頭時用的判準, 而那判準是同日立的):
   **守門容得下誤報(有人被叫住 30 秒), 盤點容不下(它的數字會變成別人的分母)。**
   ⇒ 本支的輸出是「**這幾個指標指向空氣, 去接上**」, **不是一個會被別人當分母的數**。

🛑 **輸出一律寫「我這把尺找到 N 個」, 不寫「總共有 N 個」**(主視窗指定)——
   本支看不到的:`docs/` 底下的引用(範圍刻意不含)· 別窗**未推**的樹上的板列
   (2026-09-07 實測:`-tidy` / `-6f` 未推的樹上各有板列, 而本樹撈不到 ⇒
    **一個「指向空氣」可能只是【那一列還沒被收割】**)。

🔬 **板上錨集合怎麼取**(2026-09-07 當場量, 不是假設):
   有態的板列 **836** ⇒ 錨欄恰好 1 個錨 **651** · **>1 個錨 1 列**(3 個)· 0 個錨 **184**。
   ⇒ 本支取錨欄裡**全部** `⟦…⟧` ⇒ 比「只取第一個」多收 **2** 個 ⇒ 📌 **那是【漏報】方向**,
     而量到的量級是 2 ⇒ 可接受, 而**寫在這裡而不是藏著**。

退出碼:0 = 沒找到 · 1 = selftest 失敗 · 2 = 分母是 0(尺沒接上)· 3 = 找到(擋)
"""
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BOARD = 'docs/launch-todo.md'
SCAN_DIRS = ['supabase', 'scripts', 'apps']
ANCHOR = re.compile(r'⟦([^⟦⟧]+)⟧')
# 🔴 **錨的形狀是【從真實資料學的】, 不是我猜的**(2026-09-07 當場量):
#    板上 **654** 個真錨 ⇒ 本樣式命中 **654(100%)** ⇒ **零漏報**。
#    ⛔ 我第一版猜 `{1,6}` 當前綴上限 ⇒ `account-…`(7 字元)整族會被漏掉;
#    而名字本身也可能含 `-`(`c7-COR-IDENTITY-ASSERT` / `15-SHIPGATE-F2`)。
#    ⇒ 📌 **一個猜出來的形狀, 漏掉的那一族在畫面上看不出來。**
# 🛑 **為什麼要這道形狀閘**:第一版不篩 ⇒ 報 **209** 個, 而裡面大量是
#    腳本自己的樣式與模板字(`⟦%s⟧` · `⟦$A⟧` · `⟦([A-Za-z0-9]…)⟧` · `⟦ X ⟧`)
#    ⇒ 🎯 **「守門容得下誤報」有一個上限:多到沒有人會讀, 就等於沒有。**
SHAPE = re.compile(r'^[A-Za-z0-9]{1,10}-[A-Za-z0-9][A-Za-z0-9-]{1,60}$')
# 🔴🔴 **上下文閘:只認【同一行寫著「板列」】的引用** —— 而這是一個【刻意的漏報】。
#    🔬 2026-09-07 當場量三段:
#        不加任何閘            ⇒ 報 **209**(大量是腳本自己的樣式 `⟦%s⟧` / `⟦$A⟧`)
#        只加形狀閘            ⇒ 報 **116**(形狀對, 而 `SUPERSEDE-BLOCK-BEGIN`(碼裡的區塊標記)
#                                 · `QB-10`(端 Sean 的題號)· `B-2b`(片名)都不是「引用一個板列」)
#        再加本閘              ⇒ 報 **9**;🟢 正對照 **112** 個仍對得上板 ⇒ **閘沒把全部殺光**
#    ✅ **抽驗 6/6 全部確認錨欄 0** ⇒ 那 9 個是真的。
#    ⚠️ **代價寫明:收窄漏掉 107 個** —— 有人寫「見 ⟦X⟧」而沒寫「板列」就抓不到。
#      🛑 **而那個代價是刻意付的**:本支是守門, 而**守門容得下誤報 —— 但有一個上限:
#      多到沒有人會讀, 就等於沒有。**209 行沒有人會讀完。
#    🔵 要看寬版(自己承擔雜訊):把下面那個 `CTX.search(line)` 改成 `True` 跑一次。
CTX = re.compile(r'板列|板上那一列|見板')
STATES = ('open', 'doing', 'parked', 'standing', 'done')


def split_row(line):
    """切欄位 —— 🔴 認 `\\|` 跳脫(板上 138 列這樣寫, 那是【正確】的寫法)。"""
    return re.split(r'(?<!\\)\|', line)


def board_anchors(text):
    """板上【錨欄】裡的錨。純函式。

    🔴 只看**有態的列**的**第 2 欄** —— 不掃整行:
       整行會撈到「只是提到那個錨」的列, 而那正是 `board-row-by-anchor.sh` 記過的假陽性
       (實量 `b4-SHIPGATE1` 整行 10 列 / 錨欄 2 列 ⇒ 8 個假陽性)。
    """
    out = set()
    for line in text.split('\n'):
        f = split_row(line)
        if len(f) < 6 or f[1].strip() not in STATES:
            continue
        out.update(ANCHOR.findall(f[2]))
    return out


def code_refs(root, dirs):
    """碼裡引用的錨 ⇒ {錨: [檔:行, …]}。"""
    ok, out = _git(['ls-files'] + dirs, root)
    if not ok:
        return None
    refs = {}
    for p in out.split('\n'):
        if not p.strip():
            continue
        try:
            t = open(os.path.join(root, p), encoding='utf-8', errors='ignore').read()
        except OSError:
            continue
        if '⟦' not in t:
            continue
        for n, line in enumerate(t.split('\n'), 1):
            for a in ANCHOR.findall(line):
                if not SHAPE.match(a) or not CTX.search(line):
                    continue
                refs.setdefault(a, []).append(f'{p}:{n}')
    return refs


def _git(args, cwd):
    try:
        r = subprocess.run(['git'] + args, cwd=cwd, capture_output=True, text=True, timeout=60)
        return (True, r.stdout) if r.returncode == 0 else (False, '')
    except Exception:
        return (False, '')


def selftest():
    bad = 0

    def ck(name, got, want):
        nonlocal bad
        if got != want:
            bad += 1
        print(('  ✅ ' if got == want else '  🔴 ') + name
              + ('' if got == want else f'  得 {got!r} 期望 {want!r}'))

    B = ('| open | ⟦x-REAL⟧ | 事 | 誰 | ⟨不擋⟩ 內文提到 ⟦x-MENTIONED⟧ |\n'
         '| done | `⟦x-TICKED⟧` | 事 | 誰 | ⟨擋⟩ 內文 |\n'
         '| 表頭 | 錨 | 事 | 誰 | 事實 |\n')
    got = board_anchors(B)
    ck('① 錨欄的錨收得到(含帶反引號的)', got == {'x-REAL', 'x-TICKED'}, True)
    # 🔴 ② 是本支最重要的一格:內文提到的**不算**在板上 ——
    #    少了它, 一個「整行掃」的實作會把「只是提到」讀成「這一列存在」⇒ 本支永遠報 0。
    ck('② 內文提到的錨【不算】板上有(否則本支恆報 0)', 'x-MENTIONED' in got, False)
    ck('③ 非板列(表頭/沒有態的行)不進分母', '錨' in got, False)
    ck('④ 空板 ⇒ 空集合(呼叫端要當【尺沒接上】)', board_anchors(''), set())
    # 🔴 ⑤⑥ 釘住形狀閘 —— 少了它本支報 209 個, 而那個數字沒有人會讀。
    ck('⑤ 真錨的形狀命中(含名字裡有 - 的)',
       all(SHAPE.match(x) for x in ('mail-DEADMAILREQUEUE', 'account-B2PRICEDBNOTTS',
                                    'c7-COR-IDENTITY-ASSERT', '15-SHIPGATE-F2')), True)
    ck('⑥ 腳本自己的樣式/模板字不算引用',
       any(SHAPE.match(x) for x in ('%s', '$A', ' X ', '02-GITFREE-*', '#450',
                                    '([A-Za-z0-9][A-Za-z0-9\\-_]{2,40})')), False)
    # 🔴 ⑦⑧ 釘住上下文閘 —— 少了它本支報 116 個, 而 107 個不是「引用板列」。
    ck('⑦ 同一行寫「板列」⇒ 算引用', bool(CTX.search('⇒ 板列 `⟦x-A⟧`。本支不碰。')), True)
    ck('⑧ 沒有交付語的裸錨 ⇒ 不算(碼裡的區塊標記/題號/片名都長這樣)',
       bool(CTX.search('-- ⟦SUPERSEDE-BLOCK-BEGIN⟧')), False)
    print(f'  ⇒ {8 - bad} PASS / {bad} FAIL')
    return 1 if bad else 0


def main():
    if '--selftest' in sys.argv:
        sys.exit(selftest())
    try:
        board = open(os.path.join(ROOT, BOARD), encoding='utf-8').read()
    except OSError:
        print(f'🔴 讀不到 {BOARD} ⇒ 沒有掃, 不是乾淨', file=sys.stderr)
        sys.exit(2)
    have = board_anchors(board)
    refs = code_refs(ROOT, SCAN_DIRS)
    if refs is None or not have:
        print(f'🔴 分母是 0(板上錨 {len(have)} 個 · 碼裡引用 {0 if refs is None else len(refs)} 個)'
              f' ⇒ 尺沒接上, 不是乾淨', file=sys.stderr)
        sys.exit(2)
    missing = {a: v for a, v in refs.items() if a not in have}
    # 🟢 正對照:碼裡引用而板上【有】的 —— 它 >0 才證明這把尺會配對成功。
    matched = len(refs) - len(missing)
    print(f'[anchor-points-to-nothing] 板上錨欄 {len(have)} 個 · 碼裡引用 {len(refs)} 個'
          f' · 其中對得上 {matched} 個(正對照)')
    if not missing:
        print('  ✅ 我這把尺沒找到指向空氣的錨'
              ' —— ⚠️ 而它看不到 `docs/` 的引用, 也看不到別窗【未推】的板列')
        sys.exit(0)
    print(f'\n🔴 我這把尺找到 {len(missing)} 個指向空氣的錨'
          f'(**不是「總共有 {len(missing)} 個」**):', file=sys.stderr)
    for a, where in sorted(missing.items()):
        print(f'   ⟦{a}⟧  被引用 {len(where)} 次,例:{where[0]}', file=sys.stderr)
    print('\n🛑 一句「⇒ 板列 ⟦X⟧」的作用是【把一件事交出去】——'
          '\n   而交給一個不存在的地方, 會【讓下一個人停止追問】。'
          '\n✅ 兩條路:①開那一列(名字已被引用就別換名 —— 換名要同時改兩邊, 漏一邊就是這個病)'
          '\n          ②那件事已被別列涵蓋 ⇒ 改指標'
          '\n⚠️ 而**先開檔核「是不是真的已被涵蓋」** —— 2026-09-07 那次核出來是【一半】:'
          '\n   缺口有列了, 而「救法夠不夠」那一半沒有。', file=sys.stderr)
    sys.exit(3)


if __name__ == '__main__':
    main()
