#!/usr/bin/env python3
# ============================================================
# 掃共用暫存目錄裡還躺著的 commit 訊息檔(唯讀,不刪任何東西)
# ============================================================
# 用法:python3 scripts/stale-commit-msgs.py [--dir D] [--mine 前綴] [--min-age 小時]
#   → exit code:四道自檢全過 0、任一自檢 FAIL 1(輸出作廢)
# 維護:W5(守門與工具)。壞了先跑一次看自檢哪一道紅,再找 W5。
# 🔴 它量不到的:非 feat|fix|docs|... 開頭的訊息、空檔與 >20000 bytes 的檔、子目錄。
# 🔴 進了版控【不代表】有守門:三綠不掃 .py(package.json lint-staged 只認 ts/tsx/sh/yaml/sql)。
# ============================================================
"""W5-064 · 掃共用暫存目錄裡還躺著的 commit 訊息檔(唯讀,只印檔名/年齡/大小)。

誰寫的 : W5(2026-08-20)。主視窗當日全隊令「commit 暫存檔一律走 session scratchpad」的配套量具。
為什麼 : 那道令要各窗清自己的,而**沒有人記得自己昨天叫過什麼名字** ——
         回想的分母是 session,掃的分母是磁碟,而事故活在兩者的差集裡。

🔴 這支工具【不刪任何東西】,也【不印任何一支檔的內容】。
   它只讀每支檔的**第一行**來判斷形狀,報告裡只有檔名 / 年齡 / 大小。
   ⇒ 那 145 支裡有真的 commit body,可能含別人尚未發布的東西。

🔴 每次執行自帶【四道】自檢。**self-check 任一 FAIL ⇒ 本次輸出作廢(exit 1),不是警告。**
   來由:同一件事上,尺在 2026-08-20 死過四次,每次都印出乾淨的「0」——
     ① find /tmp -maxdepth 1  ⇒ /tmp 是 symlink,find 預設不跟,它根本沒進去
     ② cd <dir> && ls          ⇒ cd 沒生效,在別的目錄量
     ③ 只掃「我這個 session 造過的名字」⇒ 更早 session 留下的看不到
     ④ 檔案讀不到(權限)⇒ 命中 0,而那個 0 與「這裡真的沒有」在輸出上一模一樣
        🔴 ④ 是本工具【自己】的假綠,由主視窗 2026-08-20 設計對照組時的失手暴露出來

用法:
    python3 W5-064-stale-commit-msgs.py                  # 掃 /private/tmp
    python3 W5-064-stale-commit-msgs.py --dir <目錄>
    python3 W5-064-stale-commit-msgs.py --mine w5        # 只列檔名以 w5 開頭的(自清用)
    python3 W5-064-stale-commit-msgs.py --min-age 6      # 只列超過 6 小時的
"""
import argparse
import os
import re
import sys
import time

# `type(scope): subject` —— PCM commit 訊息的第一行形狀(CLAUDE.md「Commit 訊息」那節)
SHAPE = re.compile(r"^(feat|fix|docs|refactor|chore|test|perf)\([^)]+\):\s")
# 無窗別前綴的通用名 = 撞名風險最高的那一批
GENERIC = re.compile(r"^(cm|msg|commit|m)[a-z0-9_-]{0,10}\.txt$", re.I)
MAX_BYTES = 20000  # 超過這個大小的幾乎不會是 commit 訊息;也避免讀進大檔


def first_line(path):
    """只讀第一行。回不了就回 None —— **不吞掉,呼叫端要看得出是讀不到還是不符形狀**。"""
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as fh:
            return fh.readline()
    except OSError:
        return None


def scan(directory):
    """回 (rows, total_files, unreadable)。rows = [(age_hours, name, size, is_generic)]。"""
    rows, total, unreadable = [], 0, 0
    now = time.time()
    try:
        names = os.listdir(directory)
    except OSError as exc:
        sys.exit(f"✗ 讀不到目錄 {directory}:{exc}")
    for name in names:
        path = os.path.join(directory, name)
        if not os.path.isfile(path):
            continue
        total += 1
        try:
            size = os.path.getsize(path)
        except OSError:
            unreadable += 1
            continue
        if size == 0 or size > MAX_BYTES:
            continue
        head = first_line(path)
        if head is None:
            unreadable += 1
            continue
        if SHAPE.match(head):
            age = (now - os.path.getmtime(path)) / 3600
            rows.append((age, name, size, bool(GENERIC.match(name))))
    rows.sort(reverse=True)
    return rows, total, unreadable


def self_check(directory, total, unreadable, found):
    """四道自檢。任一 FAIL ⇒ 輸出作廢(不是警告,是作廢)。"""
    checks = []

    # ① 正向對照:這個目錄裡確實看得見東西。1 個項目 = 幾乎一定是 symlink 沒跟進去。
    checks.append(("正向對照 · 目錄裡看得見檔案", total > 1, f"總檔數={total}"))

    # ② 形狀判別式雙向表演:該收的收得到、該擋的擋得掉。
    good = SHAPE.match("docs(docs): 一句話") is not None
    bad = SHAPE.match("這不是 commit 訊息") is None
    checks.append(("形狀判別式雙向", good and bad, f"正例={good} 負例={bad}"))

    # ③ 通用名判別式雙向:cmsg.txt 要收,有前綴的 w4-commit-msg.txt 不要收。
    g_good = GENERIC.match("cmsg.txt") is not None
    g_bad = GENERIC.match("w4-commit-msg.txt") is None
    checks.append(("通用名判別式雙向", g_good and g_bad, f"正例={g_good} 負例={g_bad}"))

    # ④ 🔴 讀不到 + 零命中 = 兩個世界長得一樣。
    #    「這裡沒有 commit body」與「我讀不進去」在輸出上都是 0 ——
    #    2026-08-20 主視窗設計對照組時就是把後者當成前者(而他正是提醒別人這件事的那個人)。
    checks.append((
        "讀不到 vs 零命中 分得開",
        not (unreadable > 0 and found == 0),
        f"讀不到={unreadable} 命中={found}",
    ))

    return checks


def main():
    ap = argparse.ArgumentParser(
        description="掃共用暫存目錄裡還躺著的 commit 訊息檔(唯讀)",
        # 🔴 關掉縮寫(2026-08-20 codex R2 must-fix:預設 --di 會被當成 --dir,不進 ignored ⇒ 打錯照樣綠)
        allow_abbrev=False,
    )
    ap.add_argument("--dir", default="/private/tmp", help="要掃的目錄(預設 /private/tmp)")
    ap.add_argument("--mine", default=None, help="只列檔名以此字串開頭的(自清用,例:w5)")
    ap.add_argument("--min-age", type=float, default=0.0, help="只列超過幾小時的")
    # 🔴 lint-staged 會把 staged 的檔名【附加在命令後面】,而本工具沒有位置參數
    #    ⇒ 用 parse_known_args 收下並**印出來**,不要靜靜吃掉(靜靜吃掉 = 打錯字也不會有人知道)。
    args, ignored = ap.parse_known_args()
    # 🔴 只放行【位置參數】(lint-staged 附加的檔名);打錯的 option 仍要炸
    #    (2026-08-20 codex must-fix:原版連 --dri 這種拼錯也吞掉,錯設定照樣綠)。
    bad_opts = [a for a in ignored if a.startswith("-")]
    if bad_opts:
        sys.exit(f"✗ 不認得的參數:{' '.join(bad_opts)} —— 打錯的 option 不會被當成檔名放行")
    if ignored:
        print(f"(忽略 {len(ignored)} 個位置參數:{' '.join(ignored)} —— 本工具不吃檔名,掃的是 --dir)")

    # 🔴 /tmp 在 macOS 是 symlink ⇒ 直接用它會讓某些工具量到空氣。這裡明說改用哪一個。
    directory = os.path.realpath(args.dir)
    if directory != args.dir:
        print(f"📌 {args.dir} 是 symlink ⇒ 實際掃 {directory}")

    rows, total, unreadable = scan(directory)

    print(f"\n=== 自檢(任一 FAIL ⇒ 本次輸出作廢)===")
    ok = True
    for label, passed, detail in self_check(directory, total, unreadable, len(rows)):
        print(f"  {'PASS' if passed else '🔴 FAIL'}  {label}  ({detail})")
        ok = ok and passed
    if not ok:
        sys.exit("\n🔴 self-check FAIL ⇒ 本次輸出作廢,不要引用上面的數字。")

    shown = [r for r in rows if r[0] >= args.min_age and (args.mine is None or r[1].startswith(args.mine))]
    generic = [r for r in shown if r[3]]

    print(f"\n=== 結果 · {directory} ===")
    print(f"  普通檔總數                     {total}")
    if unreadable:
        print(f"  讀不到(權限/競態)             {unreadable}   ← 這些【沒有被判斷過】,不是「不符形狀」")
    print(f"  首行像 commit body             {len(rows)}")
    if args.mine or args.min_age:
        print(f"  套用篩選後                     {len(shown)}   (--mine={args.mine} --min-age={args.min_age})")
    print(f"  其中【無窗別前綴】的通用名      {len(generic)}   ← 撞名風險最高")

    print("\n--- 逐支(只有檔名/年齡/大小;內容一個字都不印)---")
    for age, name, size, is_generic in shown:
        print(f"  {age:6.1f} 小時前   {'🔴通用名 ' if is_generic else '         '}{name}   ({size} bytes)")

    # 🔴 數字要離開量測現場時帶著座標(表會被複製走,前後文不會)。
    #    W1 2026-08-20 的判別句:「這個查詢在【它會回 0】的所有世界裡,只有一個是安全的嗎?」
    #    ① 沒有東西  ② 我看不到  ③ 我沒查那一種  ④ 我查完它才進來
    #    ⇒ ② 由第四道自檢擋掉;③④ 擋不掉,只能把它們寫在數字旁邊。
    print("\n--- 這個數字的分母(③我沒查那一種 / ④我查完它才進來)---")
    print(f"  量測時刻    {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}"
          "   ← ④ 之後才產生的檔不在裡面")
    print(f"  只認這 7 種 type 開頭    feat|fix|docs|refactor|chore|test|perf")
    print( "  ⇒ ③ 不是這個形狀的 commit 訊息(中文開頭 / Merge / 縮排開頭)**不在分母裡**")
    print(f"  只看 0 < size <= {MAX_BYTES} bytes    ⇒ ③ 空檔與大檔不在分母裡")
    print( "  只掃這一層,不遞迴子目錄            ⇒ ③ 子目錄裡的不在分母裡")

    print("\n📌 前綴不等於署名:`w2-` 讓【你】猜得出來,不讓【撿到的人】知道那是誰的、可不可以刪。")
    print("📌 本工具不刪任何東西。要清,清你自己的 —— 而『你自己的』請用 --mine 掃,不要憑回想。")


if __name__ == "__main__":
    main()
