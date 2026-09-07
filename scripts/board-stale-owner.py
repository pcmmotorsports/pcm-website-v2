#!/usr/bin/env python3
"""board-stale-owner.py — 誰欄還寫著「等 Sean」, 而內文已經記著他答了。

🔴 為什麼有這一支(板列 ⟦b9-TITLESTALE⟧ 逐字):
   「**寫訂正的人把它加在列尾, 而讀的人靠標題與誰欄決定要不要展開那一列**
     ⇒ **訂正在檔裡, 而在讀者的路徑上不存在。**」
   🎯 而它比「沒寫」危險 —— 沒寫的人知道自己不知道, **讀到舊誰欄的人以為自己知道了**。
   那一列自己最後一句是本支的來由:「本列只記形狀與三個實例,
   **沒有量過全板還有幾列同病** —— 那個數字沒有人數過。」

🟡 **只報不擋(rc 恆 0)**:它把「值得回頭看一眼」的列指出來, **不判斷那一列對不對**。

⚠️ **它只涵蓋三個實例裡的【一種】** —— 誰欄 vs 內文的「等 Sean」那一種。
   另外兩種(標題的座標過期 · 標題說「沒有人查過」而內文已有量值)**本支答不出**,
   因為它們沒有一個可機械比對的欄。

⚠️ **已知會少報 / 誤報**:
  · 誰欄自己已經帶了訂正記號(`~~` / `✅` / `⛔` / 「不是等 Sean」)⇒ **本支刻意跳過**
    (讀的人在欄上就看得到了, 那不是本病)。
  · 內文只認幾個固定講法(見 ANSWERED);Sean 用別的說法答的, 撈不到。
  · 它**不看時間** —— 內文若記的是「更早的一次拍板、而現在又在等新的一題」,
    本支照樣會報。🔴 2026-09-07 抽驗兩列:一列是乾淨的真陽性(誰欄「等 Sean:Q16」
    而內文逐字「Sean 拍板 · ⛔ ~~等 Sean~~ ⇒ 甲」), 一列是**軟的**
    (仍在等 Sean, 而**等的題目換了** —— 誰欄沒說是哪一題)。⇒ **報出來的列要自己開檔看。**

用法:`python3 scripts/board-stale-owner.py [--selftest]`
退出碼:0 = 掃完(不論幾列)· 1 = selftest 失敗 · 2 = 分母是 0(尺沒接上)
"""
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BOARD = os.path.join(ROOT, 'docs/launch-todo.md')
CLOSED = ('open', 'done', 'doing', 'parked', 'standing')
WAITING = re.compile(r'等 Sean')
ANSWERED = re.compile(r'Sean (?:已答|答了|拍)|已拍板|他答了')
# 🔴 誰欄自己已經帶了訂正 ⇒ 讀的人在欄上就看得到 ⇒ 不是本病。
#    而【Sean … 答 …】也算 —— 2026-09-07 逐列開檔時抓到一個假陽性:
#    誰欄寫「線【帳號】account(Sean 09-06 答 q4 甲)」, 而它同時含「等 Sean」
#    只是因為那三個字出現在別的片語裡。⇒ 一把只認符號的尺會把它讀成沒訂正。
# 🔴 只認【結論性】的講法, 不認任何一個「答」字(R1 nit):
#    `Sean[^|]{0,12}答` 太寬 —— 「等 Sean 之後再答覆」「等 Sean 有空時回答」
#    那些【仍在等】的自然寫法都會被吃掉 ⇒ 方向是少報, 而少報沒有人會抱怨。
# 🔴 窗口 6 ⇒ 12(2026-09-07 逐列開檔量到):實際寫法是「Sean 09-06 答 **q10 甲**」——
#     到  之間隔著  六個字元, 6 的窗口【剛好差一點】。
#    📌 而那個「剛好」不是設計, 是我第一版隨手挑的數字。
OWNER_FIXED = re.compile(r'~~|✅|⛔|不是等 Sean|Sean[^|]{0,14}(?:已答|答了|答[^|]{0,12}[甲乙丙丁])')


def fields(line):
    """切欄 —— 🔴 **不可以用裸 `split('|')`**(code-reviewer R1 must-fix)。

    本 repo 已有同型病史與定案修法:`scripts/board-dispatch-triage.py` 的 `_split_row`
    逐字記著「naive split cuts at escaped pipes」。實測:現有板 **154 / 820** 列
    在兩種切法下欄數不同 ⇒ 裸切會把 who / title / body **整排錯位**,
    而錯位造成的是【靜默漏報】—— 那與檔頭自陳的「已知會少報」不是同一件事:
    前者是判別式的限度, 後者是我把欄位讀錯了。
    """
    f = re.split(r'(?<!\\)\|', line)
    return [x.strip() for x in f[1:]] if len(f) > 1 else []


def stale(lines):
    """回 [(態, 誰欄, 標題)] —— 誰欄還在等而內文已答, 且誰欄自己沒有訂正記號。"""
    out = []
    for t in lines:
        if not t.startswith('| '):
            continue
        f = fields(t)
        if not f or f[0] not in CLOSED or len(f) < 5:
            continue
        who, title, body = f[3], f[2], '|'.join(f[4:])
        if not WAITING.search(who) or not ANSWERED.search(body):
            continue
        if OWNER_FIXED.search(who):        # 欄上已經看得到 ⇒ 不是本病
            continue
        out.append((f[0], who, title))
    return out


def selftest():
    bad = 0
    ran = 0

    def ck(name, got, want):
        nonlocal bad, ran
        ran += 1
        ok = got == want
        print(f"  {'✅' if ok else '🔴'} {name}(得 {got} 期望 {want})")
        bad += 0 if ok else 1

    W = '| open | A1 | 題 | 等 Sean:Q9 | 內文 %s |'
    ck('① 誰欄在等而內文說他答了 ⇒ 報', len(stale([W % 'Sean 已答 甲'])), 1)
    ck('② 內文沒說他答 ⇒ 不報(正對照)', len(stale([W % '什麼都沒說'])), 0)
    ck('③ 誰欄自己已訂正(~~)⇒ 不報',
       len(stale(['| open | A1 | 題 | ~~等 Sean~~ ⇒ 甲 | 內文 Sean 已答 甲 |'])), 0)
    ck('④ 態不在封閉集 ⇒ 整列不算(表頭那種)',
       len(stale(['| 態 | 編號 | 題 | 等 Sean | 內文 Sean 已答 |'])), 0)
    # 🔴 ⑤b 釘住 2026-09-07 逐列開檔抓到的那個【真實】假陽性形狀:
    #    誰欄寫「線【帳號】account(Sean 09-06 答 q4 甲)」——
    #    它含「等 Sean」只是因為那三個字出現在別的片語裡, 而欄上其實已經有答案。
    #    ⇒ 少了這一格, 把 OWNER_FIXED 改回只認符號 ⇒ 命中會從 4 變回 5, 而沒有東西會叫。
    ck('⑤b 誰欄自己寫著 Sean 答了 ⇒ 不報(真實假陽性形狀)',
       len(stale(['| open | A1 | 題 | 線【帳號】account(Sean 09-06 答 q4 甲)等 Sean | 內文 Sean 拍板 |'])), 0)
    # 🔴 ⑥ 跳脫豎線(R1 must-fix):裸 split 會把 who 切成別的東西 ⇒ 這一列被靜默漏報。
    ck('⑥ 標題含跳脫豎線 ⇒ 欄位不得錯位, 仍要報',
       len(stale(['| open | A1 | 題含 a\\|b 其他字 | 等 Sean:Q9 | 內文 Sean 已答 甲 |'])), 1)
    # 🔴 ⑦ 誰欄寫「等 Sean 之後再答覆」= 仍在等 ⇒ 不得被 OWNER_FIXED 吃掉(R1 nit)。
    ck('⑦ 誰欄「等 Sean 之後再答覆」= 仍在等 ⇒ 照報',
       len(stale(['| open | A1 | 題 | 等 Sean 之後再答覆 | 內文 Sean 已答 甲 |'])), 1)
    ck('⑤ 負對照:現造字面不得憑空命中',
       len(stale(['| open | A1 | 題 | 等 qvx7719 | 內文 qvx7719 已答 |'])), 0)
    # 🔴 總數要【數出來】不要手維護 —— 我加 ⑤b 之後這裡還印「5 PASS」而實際跑了 6 格。
    #    (今晚在 board-row-by-anchor 與 harvest-chain 各修過一次同型。)
    print(f'  ⇒ {ran - bad} PASS / {bad} FAIL(共 {ran} 格)')
    return 1 if bad else 0


if '--selftest' in sys.argv[1:]:
    sys.exit(selftest())

lines = io.open(BOARD, encoding='utf-8').read().split('\n')
data = [t for t in lines if t.startswith('| ') and fields(t) and fields(t)[0] in CLOSED]
# 🔴 分母是 0 【不是乾淨】—— 那與「板路徑錯了」印同一個東西
if not data:
    print(f'🔴 分母是 0(讀 {BOARD})⇒ 尺沒接上, 不是板子乾淨', file=sys.stderr)
    sys.exit(2)

hits = stale(lines)
print(f'board-stale-owner:分母 {len(data)} 列(態在封閉集)· 命中 {len(hits)} 列')
for st, who, title in hits:
    print(f'  🟡 [{st}] 誰:{who[:38]}')
    print(f'          題:{title[:58]}')
if hits:
    print('  ⇒ 誰欄還寫著在等, 而內文已經記著他答了 ——')
    print('     🔴 而讀的人是靠【誰欄】決定要不要展開那一列。')
    print('  🛑 只報不擋:報出來的列要自己開檔看(見檔頭「已知會少報 / 誤報」)。')
sys.exit(0)
