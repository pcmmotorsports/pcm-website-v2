#!/usr/bin/env python3
# backlog-duplicate-scan.py — 找「一事兩號」:同一件事拿到兩個 backlog 號,而兩邊都健康。
#
# 為什麼發號器擋不住(W1 2026-08-18 判別句,原文):
#   「發號前的撞號掃描只問【這個號有沒有人用】,沒問【這件事有沒有人登記過】。
#     CAS 發號器擋得住前者、擋不住後者。」
#   實錘 = `#632` 與 `#633` 都在講「出貨通知信收件人恆 null / B-4 未做」,
#   兩條都貼了 reserve-backlog.sh 的發號證據、號也真的沒重複 ⇒ 發號器完全正常。
#
# 判準:兩個【未收】條目共用 >=2 個【稀有識別字】(反引號括起來的字面,全庫出現 <=RARE 次)。
#   用稀有度而不是數量 —— `null` / `order` 到處都是,`notification_email` 不是。
#
# 🔴 已知案例測試(照 memory feedback_would-this-sweep-find-the-known-case):
#   2026-08-18 W8 實跑 @ dev 51333b9c(**在 W8 把兩條合併落檔【之前】**)
#   ⇒ 108 對候選,`#632`/`#633` 命中,共用稀有字 = `b-4` + `notification_email`(僅 2 個)。
#   ⚠️ 落檔【之後】同一對變成共用 6 個 —— **因為我把兩條的內容搬到一起了**。
#      ⇒ 這個數字會隨 backlog 被整理而變動,**它不是難度指標**;重跑時看的是「有沒有命中」。
#   ⚠️ 調參時務必重跑這一條:token 最小長度從 3 放寬到 4 就會【漏掉】它(`B-4` 只有 3 個字)。
#
# 🔴🔴 天花板(**排序不可信,清單才可信**):這把尺分不出「重複」與「相關」。
#   實測 @ 51333b9c(合併前):共用最多稀有字的前 8 對【全部是相關而非重複】(#423×#435 同族拆片…),
#   而真正的已知重複 `#632`/`#633` 只共用 2 個字、排在最後一級。
#   ⇒ **不要只看前幾名** —— 所以預設輸出【全部候選、每對一行】,排序不承載判斷。
#   ⇒ 也不要接成 hook / CI 閘(memory feedback_a-guard-on-a-safe-path-is-net-negative)。
#
#
# 🔴 錨定紀律(2026-08-18,兩個窗同日各撞一次,是同一個坑的兩面):
#    沒錨尾 ⇒ `^### #(\d{1,3})` 把 `#220b` / `#220c` 讀成 `#220`,報出假重複(W8)
#    沒錨頭 ⇒ `#6[3-9][0-9]` 撈到 `#64738a`(十六進位色碼)、`supabase/auth#6603`(GitHub issue)(W7)
#    ⇒ **backlog 號與色碼在字形上是同一個東西,差別只在前後那一個字元。**
#    ⇒ 不管用哪個 pattern,**命中都要開檔看一眼再採信**。
#
# 用法: python3 scripts/backlog-duplicate-scan.py [top_n]   (預設全部)
import collections
import io
import itertools
import re
import sys

BACKLOG = "docs/phase-1-backlog.md"
RARE = 3          # 一個字面在幾條【未收】條目內出現就算不稀有
MIN_SHARED = 2    # 共用幾個稀有字才報
TOP = int(sys.argv[1]) if len(sys.argv) > 1 else 10**9

lines = io.open(BACKLOG, encoding="utf-8").read().split("\n")
entries, cur = [], None
for i, line in enumerate(lines, 1):
    m = re.match(r"^### (#\d{1,3})\b", line)
    if m:
        cur = {"id": m.group(1), "line": i, "head": line, "body": []}
        entries.append(cur)
    elif line.startswith("### "):
        cur = None
    elif cur is not None:
        cur["body"].append(line)

open_entries = [e for e in entries if "✅" not in e["head"] and "已收" not in e["head"]]


def tokens(e):
    text = e["head"] + "\n" + "\n".join(e["body"])
    return {t.strip("`").lower() for t in re.findall(r"`[^`\n]{3,60}`", text)}


tok = {e["id"]: tokens(e) for e in open_entries}
df = collections.Counter()
for s in tok.values():
    for t in s:
        df[t] += 1

pairs = []
for a, b in itertools.combinations(open_entries, 2):
    shared = {t for t in tok[a["id"]] & tok[b["id"]] if df[t] <= RARE}
    if len(shared) >= MIN_SHARED:
        pairs.append((len(shared), a, b, sorted(shared)))
pairs.sort(key=lambda p: -p[0])

print(f"== 分母 ==")
print(f"backlog 條目          : {len(entries)}  (未收 {len(open_entries)})")
print(f"稀有字門檻            : 全庫出現 <= {RARE} 次")
print(f"候選對(共用 >= {MIN_SHARED} 個稀有字): {len(pairs)}   全部列出(排序不承載判斷,見檔頭)")
print()
for n, a, b, shared in pairs[:TOP]:
    print(f"{n:>2} | {a['id']:>5} :{a['line']:<6} x {b['id']:>5} :{b['line']:<6} | {', '.join(shared[:4])}")
