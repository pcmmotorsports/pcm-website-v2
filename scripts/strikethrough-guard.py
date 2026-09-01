#!/usr/bin/env python3
r"""strikethrough-guard —— 一個字面的命中,是【活的】還是【被劃掉的】?

🔴 存在理由(2026-09-01 08:5x,線DB `-2d` 差一步就跑下去、主視窗開檔才接住):
   本 repo 的慣例是**訂正時把舊字面加刪除線留著**(`~~舊值~~ ⇒ 新值`),
   免得照舊句搜的人撲空。而那個慣例的**全部作用**就是:
   **讓一個死掉的字面【仍然 grep 得到】。**

   ⇒ 於是一個機械取代的守門問 `count(舊字面) == 1`,它**答對了**——
     「我會不會改到別的地方」。而它需要的答案是「這一處**還該不該改**」。
   🛑 **而一個被劃掉的字面同時滿足【唯一】與【不該碰】。**
   📌 那不是一道弱的守門,是一道**正確運作**的守門正確地回答了**另一個問題**。

   實害:那次的取代會把 `~~A server actions **57**~~` 變成 `~~…**60**~~`
   —— 一個**被劃掉的正確值** ⇒ 修正紀錄整個毀掉,而 diff 正常、三綠不紅。
   接住它的是「開檔看一眼」,而那是運氣;本工具把那一眼變成一道檢查。

用法:
    python3 scripts/strikethrough-guard.py <檔> <字面>     取代前先問
    python3 scripts/strikethrough-guard.py --selftest

rc:  0 = 全部命中都是活的(可以改)
     1 = 🔴 有命中住在刪除線裡 ⇒ **停**
     2 = 零命中(那是另一個問題:字面不對、或檔不對)
     3 = 用法錯 / 檔讀不到

🛑 它擋不住什麼(先讀這段):
   🔴🔴 **本節由【撞到它的人】增補, 不是由作者維護** —— 因為作者只寫得出他想得到的那幾種。
        ⇒ 所以這一節**不是完整清單, 是第一版的猜測 + 後來每個打中它的人補的那幾行**。
        ⚠️ **最貴的誤讀**:以為沒列到的方向【已經被想過而排除了】。
        📌 形狀(2026-09-01 `-7a`):**一個人標得出自己盲區的【方向】, 標不出自己盲區的【分母】。**
        ⇒ 打中它的人請直接在下面加一行, 署自己的名 —— **守住與記住是兩件事**:
          守住防的是這一種, 記住防的是【同族的下一種】。
   · 🔴 **[線DB `-2d` 2026-09-01 補]跨行的刪除線**:作者第一版用逐行配對 ⇒ **看不到** ⇒ 假綠。
     實物 `docs/phase-1-backlog.md:8735-8736`。已改成整檔配對, 並釘成自檢一格。
     ⇒ **這一種作者連【標】都沒標** —— 它不在第一版的 fail-open 說明裡。
   · 只認 GitHub 風格的 `~~…~~`。**配對是【整檔】掃一次, 跨行的劃線看得到** ——
     ⛔ ~~同一行內成對。跨行的劃線它看不到。~~ 那是 2026-09-01 09:0x 之前的行為,
     線 `-2d` 拿 `docs/phase-1-backlog.md:8735-8736` 的實物打出假綠 ⇒ 已修並釘成自檢一格。
   · ⚠️ **而整檔配對買來的洞**:一個【落單】的 `~~` 會跟後面某個 `~~` 亂配。
     ⇒ 用 `MAX_SPAN_CHARS` 封頂(超過就當它不是刪除線)⇒ 損害有界, 不會毒到檔尾。
     🛑 而那是**取捨不是修好**:上限之內的亂配它仍然看不到。
   · 它答「在不在刪除線裡」,**不答「這個字面是不是最新的」** ——
     一個沒被劃掉的舊值,它會說「活的」。那要靠別的東西。
   · 🔴 **它只在【你這個 repo 實際用的那幾種形狀】上被測過, 而那不是全部。**
     2026-09-01 哨兵 `-26` 獨立測六格全對(含 `~~**粗體**~~` 與「同一行一死一活」),
     並量到 `docs/launch-todo.md` 的 `~~` 對數裡, **它測過的兩種只佔約九成** ——
     🛑 **而那個比例會變, 所以這裡寫【怎麼數】不寫數字**(數字會過期而過期時零訊號):
         `grep -o '~~' <檔> | wc -l` ⇒ 除以 2 = 總對數(**這一行跨不跨行都算得到**)
         `grep -o '~~[^~*][^~]*~~' <檔> | wc -l` ⇒ 純文字那種
         `grep -o '~~\*\*[^~]*\*\*~~' <檔> | wc -l` ⇒ 粗體那種
     🔴🔴 **[哨兵 `-26` 2026-09-01 補]而下面兩行是【逐行】的 ⇒ 它們結構上看不到跨行的那些**
         ⇒ 所以「總對數 − 那兩行」這個差, **必然包含全部的跨行案例**, 不是隨機餘數。
         實量 `docs/phase-1-backlog.md`:逐行 227 對 / 總 483 個 `~~` ≈ 241 對 ⇒ **差 14 對**。
         🛑 **⇒ `-26` 原本用這個差去量本工具的覆蓋率 —— 而那把尺與本工具的舊 bug 同一個盲區。**
         📌 **⇒ 量覆蓋率的方法, 也可能與被量的東西共用同一個假設。**
         ✅ **副產品:483 是【奇數】⇒ repo 裡真的有一根落單的 `~~`**
            ⇒ 那正是 `MAX_SPAN_CHARS` 在防的東西, 而它不是假想的。
   · ⚠️ **`~~**粗體**~~` 不是巢狀**(裡面是 `**` 不是 `~~`)⇒ 它不 fail-open, 實測確認。
   · 巢狀 / 未閉合的 `~~` 一律當**沒有劃線**處理(fail-open)——
     ⚠️ 這個方向是刻意的:誤放行會讓你回到今天的處境,誤攔會讓人拆掉這道閘。
     ⇒ 而那代表**它的 0 比它的 1 弱**:印 1 一定有東西,印 0 只是「我沒看到」。
"""
import bisect
import re
import sys

# 🔴 一個刪除線區段最多能有多長(字元)。超過就當它【不是】刪除線 ——
#    那幾乎一定是兩個不相干的 `~~` 被配到一起(例如檔裡有一個落單的 `~~`)。
#    沒有這個上限的話,一個落單的 `~~` 會把它【之後的所有東西】判成死的
#    ⇒ 那是 cry wolf,而 cry wolf 的下場是整支工具被刪掉。
MAX_SPAN_CHARS = 2000


def struck_spans(text):
    """整檔掃一次,把 `~~` 依序配對。回傳 [(起, 迄), ...] 的字元區間。

    🔴 【整檔】不是【逐行】—— 因為本 repo 真的有跨行的刪除線:
       `docs/phase-1-backlog.md:8735-8736` 就是一個 live 的實物
       (`- ~~storefront 沒有 …` 換行 `… placeholder~~ → 已建 route`)。
       逐行配對會把第 8736 行那段【死的】字面判成活的 ⇒ 假綠。
       (2026-09-01 線DB `-2d` 去打這支工具時找到的,不是理論。)
    """
    marks = [m.start() for m in re.finditer(r"~~", text)]
    out, dropped = [], []
    for a, b in zip(marks[0::2], marks[1::2]):
        (out if b + 2 - a <= MAX_SPAN_CHARS else dropped).append((a, b + 2))
    return out, dropped, len(marks) % 2


def scan(text, literal):
    """回傳 [(行號, 是否在刪除線裡, 那一行), ...] —— 每個命中一筆。"""
    sp, _, _ = struck_spans(text)
    starts = [0]
    for line in text.split("\n"):
        starts.append(starts[-1] + len(line) + 1)
    out = []
    pos = 0
    while True:
        i = text.find(literal, pos)
        if i < 0:
            break
        struck = any(a <= i and i + len(literal) <= b for a, b in sp)
        n = bisect.bisect_right(starts, i)
        line = text.split("\n")[n - 1]
        out.append((n, struck, line))
        pos = i + 1
    return out


def selftest():
    cases = [
        # (名稱, 內容, 字面, 期望有幾個命中, 期望幾個是被劃掉的)
        ("正:命中在刪除線裡",        "前面 ~~A 是 **57**~~ 後面",           "A 是 **57**", 1, 1),
        ("正:命中在刪除線外",        "A 是 **60** 而 ~~別的舊值~~ 在旁邊",  "A 是 **60**", 1, 0),
        ("🔴 判別力:同一行既有劃線也有活的",
         "~~舊 X~~ ⇒ 新 X",                                                  "新 X",        1, 0),
        ("🔴 判別力:同一行的劃線裡與外各一個",
         "~~值 9~~ 與 值 9 並排",                                            "值 9",        2, 1),
        ("負:字面不存在",            "什麼都沒有",                            "值 9",        0, 0),
        ("負:未閉合的 ~~ 當沒劃線",  "~~ 沒有收尾 值 9",                      "值 9",        1, 0),
        ("負:多段劃線只算包住它的那段",
         "~~甲~~ 值 9 ~~乙~~",                                              "值 9",        1, 0),
        # 🔴 下面兩格是 2026-09-01 線 `-2d` 去打這支工具時打出來的
        ("🔴 跨行劃線, 目標在中間(舊版假綠, 真實案例見檔頭)",
         "- ~~上半段沒寫完\n下半段 值 9~~ → 2026 已修",                     "值 9",        1, 1),
        ("🔴 落單的 ~~ 不得毒到它之後的全部(否則 cry wolf ⇒ 工具被刪掉)",
         "~~ 落單\n" + "x" * 2500 + "\n值 9 ~~ 尾",                         "值 9",        1, 0),
    ]
    bad = 0
    for name, text, lit, want_n, want_struck in cases:
        hits = scan(text, lit)
        got_n, got_s = len(hits), sum(1 for _, s, _ in hits if s)
        ok = (got_n, got_s) == (want_n, want_struck)
        bad += 0 if ok else 1
        print(f"  {'✅' if ok else '🔴'} {name}: 命中 {got_n}/期望 {want_n} · "
              f"劃掉的 {got_s}/期望 {want_struck}")
    # 🔴 分堆【當場算】,不寫死 —— 一個手寫的「含 N 格負對照」會在有人加格時安靜地過期,
    #    而過期時零訊號。(這正是本工具檔頭那條「寫指令不寫數字」套在自己身上。)
    flag = sum(1 for _, _, _, _, w in cases if w > 0)
    print(f"\n{'✅ selftest 全過' if bad == 0 else f'🔴 selftest 失敗 {bad} 格'}"
          f" —— 共 {len(cases)} 格:該停而停 {flag} · 該放行而放行 {len(cases) - flag}")
    return 0 if bad == 0 else 1


def main(argv):
    # 🔴 `--selftest` 認【出現在任何位置】,不是「argv 剛好 2 個」——
    #    lint-staged 會把 staged 檔路徑**接在命令後面** ⇒ 實際跑的是
    #    `… --selftest scripts/strikethrough-guard.py` ⇒ 舊寫法會把 `--selftest`
    #    當成檔案路徑去開,印「讀不到檔」。這一格是那道白名單閘在本工具第一顆
    #    commit 上當場抓到的 —— 它擋的正是它要擋的東西。
    if "--selftest" in argv[1:]:
        return selftest()
    if len(argv) != 3:
        print(__doc__)
        return 3
    path, literal = argv[1], argv[2]
    try:
        with open(path, encoding="utf-8") as f:
            text = f.read()
    except OSError as e:
        print(f"🔴 讀不到檔:{e} ⇒ 這是【路徑錯】不是【零命中】,兩者下一步不同。")
        return 3

    # 🔴🔴 [主視窗 2026-09-01 09:1x 補;起點是 `-2d` 量到 483 是奇數]
    #    `~~` 個數為【奇數】⇒ 有一根落單 ⇒ **它之後的配對整個錯開一格**
    #    ⇒ 真的刪除線變成看不見(假綠), 而段落之間的空隙變成假的「刪除線」。
    #    實量 `docs/phase-1-backlog.md`:483 個(奇數), 錯開區從第 33832 行起、
    #    佔全檔 7% —— 而那 7% 裡本工具的【0 是不可信的】。
    #    ⇒ 所以在那個區域一律回 1(停), 理由印清楚:不是「它被劃掉」, 是【我分不出來】。
    _, dropped, odd = struck_spans(text)
    danger = min([a for a, _ in dropped], default=None) if odd else None
    if odd:
        ln = text[:danger].count("\n") + 1 if danger is not None else "?"
        print(f"⚠️ {path} 的 `~~` 個數是【奇數】⇒ 有一根落單 ⇒ 它之後的配對會整個錯開。")
        print(f"   可疑區起點約在第 {ln} 行 —— 那之後本工具的【可以改】不可信。")

    hits = scan(text, literal)
    if not hits:
        print(f"⚠️ 零命中:{literal!r} 不在 {path} ——")
        print("   而【字面不對】與【它真的不在】印同一個東西 ⇒ 先確認你的字面。")
        return 2

    struck = [h for h in hits if h[1]]
    live = [h for h in hits if not h[1]]
    print(f"命中 {len(hits)} 處 —— 活的 {len(live)} · 🔴 被劃掉的 {len(struck)}")
    for n, s, line in hits:
        i = line.find(literal)
        print(f"  {path}:{n}  {'🔴 在刪除線裡' if s else '✅ 活的'}"
              f"  …{line[max(0, i - 40):i + len(literal) + 40]}…")
    if struck:
        print("\n🛑 停。被劃掉的字面是【刻意留著的訂正紀錄】——")
        print("   取代它會產生「一個被劃掉的正確值」,而 diff 正常、三綠不紅。")
        return 1
    if danger is not None:
        # 命中落在錯開區 ⇒ 我分不出來 ⇒ 寧可停(fail-closed, **只在這一區**)
        offs, pos = [], 0
        while True:
            i = text.find(literal, pos)
            if i < 0:
                break
            offs.append(i)
            pos = i + 1
        if any(i >= danger for i in offs):
            print("\n🛑 停 —— 而理由【不是】它被劃掉, 是【我分不出來】。")
            print("   這個命中落在上面那個配對錯開區裡 ⇒ 本工具在這裡的「活的」沒有效力。")
            print("   ⇒ 自己開檔看那一段, 或先把那根落單的 `~~` 修掉。")
            return 1
    print("\n✅ 全部命中都是活的。")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
