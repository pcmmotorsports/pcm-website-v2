#!/usr/bin/env python3
"""supabase/APPLIED.tsv 同一個版本號出現兩列 ⇒ 擋下, 並印出【兩列差在哪】。

    python3 scripts/applied-ledger-dup-gate.py             量工作樹那份
    python3 scripts/applied-ledger-dup-gate.py --staged    量 git index 那份(pre-commit 用)
    python3 scripts/applied-ledger-dup-gate.py --selftest   四個世界各表演一次

── 🔴 為什麼要這一道(2026-09-05 實錘, 一天兩次)──────────────────────────
  帳本的規矩是「**驗的人記**」。而一支 migration 常常【兩條線都碰到】——
  寫的一條、驗的一條 ⇒ **兩邊都覺得自己是驗的人時, 就各記一列**。
  🛑 而 merge 的 union 段【不會叫】:兩列各自在自己那邊是新增的 ⇒ 連 git 衝突都不算。
  🔬 主視窗 `-f8` 2026-09-05 兩次撞到(`4b8eda273` 與 `4568488ae`), 兩次都是**肉眼在看 diff 時發現的**。

── 🔴🔴 而「重複」有兩種, 它們在【版本號重複】這個訊號上長得一模一樣 ────────
  甲 一列是另一列的**嚴格子集** ⇒ 刪掉短的那列, 什麼都不會掉
  乙 **兩列互有對方沒有的東西** ⇒ 刪掉任何一列都會【掉東西】, 必須接起來
  📌 2026-09-05 那四對:三對是甲, **一對是乙**(`20260905130000`:一邊有結清內容、
     一邊有訂正段)⇒ 🛑 **機械去重會靜靜地弄丟一半。**
  ⇒ ✅ **所以本閘不替人決定留哪一列 —— 它印出 difflib 的差異, 確保有人被叫來做那個決定。**

── ⚠️ 它證不到什麼 ─────────────────────────────────────────────────────
  · 只看**版本號欄**重複。兩列版本號不同而內容矛盾, 它看不到。
  · 只看 `APPLIED.tsv`。帳本【漏記】它一個字都答不出來(那是 `migrations-not-in-ledger.sh`)。
  · 🔴 它擋下的是**第二個記帳的人**, 而那個人會覺得莫名其妙
    ⇒ 訊息一定要指名【另一列在第幾行、是誰記的】, 否則他只會把自己那列刪掉了事。

── 🛑 一個【截斷式比對】的坑(本閘刻意不用它)──────────────────────────
  帳本這一族的列**開頭都長得一樣**(版本號 + sha + 日期 + 「Sean(SQL Editor 本人貼」),
  **差異全在尾巴**。⇒ 📌 對這一族, 任何「比前 N 個字元」的做法都會**系統性地印「相同」**。
  🔬 2026-09-05 實錘:主視窗第一發只看了截斷的前 260 字元 ⇒ 判「四對逐字相同」, 而 difflib 逐對比之後是三對子集 + 一對互有獨有。
"""
import subprocess
import sys
from collections import defaultdict
from difflib import unified_diff

LEDGER = "supabase/APPLIED.tsv"


def read_rows(text):
    """回 [(1-based 行號, 版本號, 整列)];# 開頭與空行不算資料列。"""
    out = []
    for i, line in enumerate(text.split("\n"), start=1):
        if not line.strip() or line.startswith("#"):
            continue
        out.append((i, line.split("\t")[0], line))
    return out


def who(row):
    """第四欄開頭那一小段 = 誰記的(整欄太長, 只取到第一個句號前)。"""
    parts = row.split("\t")
    if len(parts) < 4:
        return "(欄數不足)"
    return parts[3][:60].split("。")[0]


def check(text, label):
    rows = read_rows(text)
    by_ver = defaultdict(list)
    for lineno, ver, row in rows:
        by_ver[ver].append((lineno, row))
    dups = {v: rs for v, rs in by_ver.items() if len(rs) > 1}
    print(f"  {label}:資料列 {len(rows)} · 版本號重複 {len(dups)}")
    for ver, rs in sorted(dups.items()):
        print(f"\n  🔴 版本號 {ver} 出現 {len(rs)} 次:")
        for lineno, row in rs:
            print(f"     · 第 {lineno} 行 —— 誰記的:{who(row)}")
        a, b = rs[0][1], rs[1][1]
        if a == b:
            print("     🔵 兩列【逐字相同】⇒ 刪掉任何一列都不會掉東西。")
        else:
            sa, sb = set(a.split("。")), set(b.split("。"))
            only_a, only_b = sa - sb, sb - sa
            if not only_a:
                print(f"     🔵 第 {rs[0][0]} 行是第 {rs[1][0]} 行的【子集】⇒ 刪掉前者。")
            elif not only_b:
                print(f"     🔵 第 {rs[1][0]} 行是第 {rs[0][0]} 行的【子集】⇒ 刪掉後者。")
            else:
                print("     🔴🔴 **兩列互有對方沒有的東西 ⇒ 刪掉任何一列都會掉東西, 必須【接起來】。**")
            print("     ── 差異(前 12 行)──")
            for d in list(unified_diff(a.split("。"), b.split("。"), lineterm="", n=0))[:12]:
                print(f"       {d[:150]}")
    return len(dups)


def selftest():
    base = "# c\n20260101000000\tAAA\t2026-01-01\tSean 貼。線甲記。\n20260102000000\tBBB\t2026-01-02\tSean 貼。線乙記。\n"
    same = base + "20260101000000\tAAA\t2026-01-01\tSean 貼。線甲記。\n"
    subset = base + "20260101000000\tAAA\t2026-01-01\tSean 貼。\n"
    both = base + "20260101000000\tAAA\t2026-01-01\tSean 貼。線丙記。獨有這句。\n"
    ok = True
    for name, text, want in [
        ("世界一 沒有重複 ⇒ 0", base, 0),
        ("世界二 逐字相同的重複 ⇒ 1", same, 1),
        ("世界三 子集型重複 ⇒ 1", subset, 1),
        ("世界四 互有獨有 ⇒ 1", both, 1),
    ]:
        got = check(text, name)
        mark = "✅" if got == want else "🔴"
        if got != want:
            ok = False
        print(f"  {mark} {name}(實得 {got})\n")
    # 🔵 尺會不會分辨那三種重複:世界二/三/四都回 1, 而它們印的【訊息不同】才是本閘的價值
    print("  🔵 二/三/四都回 1 —— 而它們印的訊息不同(逐字相同 / 子集 / 互有獨有)。")
    print("     📌 那正是本閘存在的理由:**版本號重複這個數字分不出這三種, 而處置完全不同。**")
    return 0 if ok else 1


def main():
    args = sys.argv[1:]
    if "--selftest" in args:
        sys.exit(selftest())
    if "--staged" in args:
        # 🔴 **[2026-09-05 自抓]** 舊版用 `git show :<path>` 的 rc 當「有沒有 staged」——
        #    而那對【已追蹤】的檔一律成功(它讀的是 index 那份, 不管這次有沒有把它加進來)
        #    ⇒ 📌 檔頭寫「只在帳本 staged 時跑」而它【每次 commit 都跑】。
        #    ✅ 要問「這次有沒有 staged 它」, 就得問 `git diff --cached --name-only`。
        staged = subprocess.run(
            ["git", "diff", "--cached", "--name-only"], capture_output=True, text=True
        ).stdout.split("\n")
        if LEDGER not in staged:
            print(f"  🔵 這次沒有 staged {LEDGER} ⇒ 本閘跳過")
            sys.exit(0)
        r = subprocess.run(["git", "show", f":{LEDGER}"], capture_output=True, text=True)
        if r.returncode != 0:
            print(f"  🔴 {LEDGER} staged 了而讀不出來 ⇒ 擋下(不放行)")
            sys.exit(2)
        text = r.stdout
        label = "index 那份"
    else:
        try:
            with open(LEDGER, encoding="utf-8") as f:
                text = f.read()
        except FileNotFoundError:
            print(f"  🔴 找不到 {LEDGER} ⇒ 擋下(不放行)")
            sys.exit(2)
        label = "工作樹那份"
    n = check(text, label)
    if n == 0:
        print("  ✅ 沒有版本號被兩列用到 —— **這不代表帳本是對的, 代表沒有【這一種】錯。**")
        sys.exit(0)
    print("\n  🛑 處置:**不要機械刪掉一列。** 先看上面的差異屬於哪一種:")
    print("     · 逐字相同 / 子集 ⇒ 刪掉短的那一列")
    print("     · 互有獨有       ⇒ **接成一列**, 兩邊的內容都要留")
    sys.exit(1)


if __name__ == "__main__":
    main()
