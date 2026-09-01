#!/usr/bin/env python3
"""strikethrough-guard —— 一個字面的命中,是【活的】還是【被劃掉的】?

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
   · 只認 GitHub 風格的 `~~…~~`,**同一行內成對**。跨行的劃線它看不到。
   · 它答「在不在刪除線裡」,**不答「這個字面是不是最新的」** ——
     一個沒被劃掉的舊值,它會說「活的」。那要靠別的東西。
   · 巢狀 / 未閉合的 `~~` 一律當**沒有劃線**處理(fail-open)——
     ⚠️ 這個方向是刻意的:誤放行會讓你回到今天的處境,誤攔會讓人拆掉這道閘。
     ⇒ 而那代表**它的 0 比它的 1 弱**:印 1 一定有東西,印 0 只是「我沒看到」。
"""
import re
import sys

SPAN = re.compile(r"~~(.+?)~~")


def spans(line):
    return [(m.start(), m.end()) for m in SPAN.finditer(line)]


def scan(text, literal):
    """回傳 [(行號, 是否在刪除線裡, 那一行), ...] —— 每個命中一筆。"""
    out = []
    for n, line in enumerate(text.splitlines(), 1):
        sp = spans(line)
        start = 0
        while True:
            i = line.find(literal, start)
            if i < 0:
                break
            struck = any(a <= i and i + len(literal) <= b for a, b in sp)
            out.append((n, struck, line))
            start = i + 1
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
    ]
    bad = 0
    for name, text, lit, want_n, want_struck in cases:
        hits = scan(text, lit)
        got_n, got_s = len(hits), sum(1 for _, s, _ in hits if s)
        ok = (got_n, got_s) == (want_n, want_struck)
        bad += 0 if ok else 1
        print(f"  {'✅' if ok else '🔴'} {name}: 命中 {got_n}/期望 {want_n} · "
              f"劃掉的 {got_s}/期望 {want_struck}")
    print(f"\n{'✅ selftest 全過' if bad == 0 else f'🔴 selftest 失敗 {bad} 格'}"
          f" —— 共 {len(cases)} 格(含 3 格負對照 + 2 格判別力)")
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
    print("\n✅ 全部命中都是活的。")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
