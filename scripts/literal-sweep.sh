#!/usr/bin/env bash
# literal-sweep.sh — 一段字面在全樹的**分類**命中(backlog #490)
#
# 🔴 存在理由(2026-08-14,同一天咬三次):
#    「改了 A、讓 B 的文案變成謊話」這個病,規則已經寫過、教訓已經記過,還是復發。
#    第三次復發時我**明明列了五類載體**(元件/文案常數/測試/backlog/plan)、
#    **執行時只掃了兩類**(code 掃了、docs 沒掃)⇒ 漏掉的那一處是審查抓的,不是我掃到的。
#    ⇒ 依 `~/.claude/rules/00-work-rules.md` §4 機制優先律:**規則寫了會再犯,機制不會。**
#
# 🔴 本工具的核心不是「找得到」,是「**每一類都印出來,即使 0 命中**」——
#    **「這一類我掃了、沒有」與「這一類我忘了掃」長得必須不一樣。**
#    那個差別就是上面那次漏掃的全部病因。
#
# 用法:  bash scripts/literal-sweep.sh '會從異常清單消失'
#         bash scripts/literal-sweep.sh 'refund-read\.ts:1[0-9][0-9]' --regex
#
# 收工檢查表用法(一行):改了任何對外字面/守門述詞後,拿**舊字面**跑一次,逐類看完再 commit。

set -euo pipefail
cd "$(dirname "$0")/.."

NEEDLE="${1-}"
MODE="${2-}"
if [ -z "$NEEDLE" ]; then
  echo "用法:bash scripts/literal-sweep.sh <字面> [--regex]" >&2
  echo "  預設把 <字面> 當**純字串**比對(括號、點號不會被當正規式)。" >&2
  echo "  加 --regex 才當正規式。" >&2
  exit 2
fi
case "$MODE" in
  '' | --regex) : ;;
  *) echo "只認一個可選旗標 --regex(實得:$MODE)" >&2; exit 2 ;;
esac

command -v python3 >/dev/null 2>&1 || { echo "找不到 python3" >&2; exit 1; }

# 🔴 比對本體走 python3、不走 grep:本機的 `grep` 實為 ugrep 7.5.0(`grep --version` 自證),
#    而本 repo 已記過多次 BSD/GNU/ugrep 方言互咬(`\|`、`$x$`、`sort -t` 等)。
#    大小寫無關 + 全形半形標點等價(NFKC)在 python 是兩行,在 shell 是一個雷區。
NEEDLE="$NEEDLE" MODE="$MODE" python3 - <<'PY'
import os, re, sys, unicodedata
from pathlib import Path

needle = os.environ["NEEDLE"]
as_regex = os.environ["MODE"] == "--regex"

# NFKC:全形（）：ＡＢ 與半形 ():AB 視為同一個東西。
# ⚠️ 只用於**比對**;印出來的一律是原始那一行,行號也是原始行號。
def norm(s: str) -> str:
    return unicodedata.normalize("NFKC", s)

pattern = re.compile(
    norm(needle) if as_regex else re.escape(norm(needle)),
    re.IGNORECASE,
)

# ── 七類載體。**由上而下第一個命中就歸該類**(一個檔只會出現在一類裡)。
#    最後一類刻意是「其餘一切」—— 沒有任何檔會被靜默丟掉,那正是本工具存在的理由。
BUCKETS = [
    ("① DB 契約", "supabase/migrations/**(含 COMMENT ON —— 契約債寫在那裡)",
     lambda p: p.parts[:2] == ("supabase", "migrations")),
    ("② 回退腳本", "scripts/*-down.sql(apply 出事時照著跑的那份)",
     lambda p: p.parts[:1] == ("scripts",) and p.name.endswith("-down.sql")),
    ("③ runbook", "docs/runbooks/**(人照著操作的步驟)",
     lambda p: p.parts[:2] == ("docs", "runbooks")),
    ("④ plan / spec", "docs/specs/**(下一個人拿來當規格的東西)",
     lambda p: p.parts[:2] == ("docs", "specs")),
    ("⑤ 測試與探針", "**/*.test.* / **/*.spec.* / docs/probes/**(守門與證據)",
     lambda p: (".test." in p.name or ".spec." in p.name
                or p.parts[:2] == ("docs", "probes"))),
    ("⑥ 待辦與現況", "docs/phase-1-backlog.md + STATUS.md + docs/handoff/**",
     lambda p: (p.as_posix() in ("docs/phase-1-backlog.md", "STATUS.md")
                or p.parts[:2] == ("docs", "handoff"))),
    ("⑦ 其餘一切", "上面六類沒收走的每一個文字檔(原始碼、其他 docs、設定…)",
     lambda p: True),
]

SKIP_DIRS = {
    ".git", "node_modules", ".next", "dist", ".turbo", "coverage",
    "design-reference", ".vercel", "graphify-out", "__pycache__",
}

hits = [[] for _ in BUCKETS]
scanned = [0 for _ in BUCKETS]
skipped = {}  # 副檔名 -> 幾個(讀不出 utf-8 的都記帳,不讓它們靜默消失)

root = Path(".")
for dirpath, dirnames, filenames in os.walk(root):
    dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
    for fn in filenames:
        path = Path(dirpath, fn)
        rel = path.relative_to(root)
        idx = next(i for i, b in enumerate(BUCKETS) if b[2](rel))
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            key = rel.suffix or rel.name
            skipped[key] = skipped.get(key, 0) + 1
            continue
        scanned[idx] += 1
        for lineno, line in enumerate(text.splitlines(), 1):
            if pattern.search(norm(line)):
                hits[idx].append((rel.as_posix(), lineno, line.strip()))

print(f'字面:{needle}{"  (當正規式)" if as_regex else "  (當純字串)"}')
print("比對:大小寫無關 + 全形/半形標點等價(NFKC)")
print("=" * 72)

total = 0
for (name, scope, _), rows, n in zip(BUCKETS, hits, scanned):
    total += len(rows)
    print()
    print(f"── {name} · {scope}")
    if not rows:
        # 🔴 這一行就是本工具的全部價值:0 命中也要說「我掃了幾個檔」。
        print(f"   0 命中(這一類掃了 {n} 個檔)")
        continue
    print(f"   {len(rows)} 命中 / 掃了 {n} 個檔")
    for f, ln, excerpt in rows:
        if len(excerpt) > 110:
            excerpt = excerpt[:110] + "…"
        print(f"   {f}:{ln}: {excerpt}")

print()
print("=" * 72)
skipped_total = sum(skipped.values())
brief = ", ".join(f"{k}×{v}" for k, v in sorted(skipped.items(), key=lambda kv: -kv[1])[:6])
print(f"總計 {total} 命中,掃了 {sum(scanned)} 個文字檔,跳過 {skipped_total} 個讀不出 UTF-8 的檔。")
if skipped_total:
    # 🔴 跳過幾個 + **跳過的是什麼**都要印:只印數字的話,
    #    「跳過的全是圖片」與「跳過了一份壞掉編碼的 .md」長得一樣。
    print(f"       跳過的副檔名:{brief}")

# 🔴 自我守門:某一類掃到 0 個**檔**(不是 0 個命中)= 這一類的路徑判準壞了
#    (例:有人把 docs/runbooks 改名)。那正是本工具要防的病發生在本工具自己身上。
blind = [name for (name, _, _), n in zip(BUCKETS, scanned) if n == 0]
if blind:
    print()
    print(f"🔴🔴 這幾類**一個檔都沒掃到**,判準可能已失效,先修工具再信結果:{', '.join(blind)}")
print()
print("🔴 掃描限度(不要只當它掃過了):")
print("  1. 只掃**檔案裡的字面**。組出來的字串(`'異常' + '清單'`)、i18n key、")
print("     DB 裡的資料列、已 apply 但檔案已改的 migration ⇒ 一律掃不到。")
print(f"  2. 跳過的目錄:{', '.join(sorted(SKIP_DIRS))} ⇒ 建置產物裡的舊字面不會被看到。")
print("  3. 一個檔只歸一類(由上而下第一個命中)⇒ `apps/**/x.test.ts` 會落在 ⑤ 不是 ⑦。")
print("  4. 它告訴你**哪裡還有這個字面**,不告訴你**那句話現在是真是假** —— 那要人開檔判斷。")
print("  5. 🔴🔴 **它分不出「還沒改」與「已改但留痕」。** 本 repo 的更正慣例是**劃掉不刪**")
print("     (`~~舊字面~~ ⇒ 新的說法`)⇒ **訃聞裡面也含那個字面** ⇒ 兩者在上面的輸出裡是同一筆。")
print("     ⇒ 要拆開,**分開數兩種形狀**(可重跑):")
print("       `git grep -l '<字面>' <ref>` → 逐檔逐行判斷該行含不含 `~~<字面>~~`")
print("       實例 2026-08-18:`production 實測 1000` 在 dev 上 12 行 ⇒ **待辦 10 / 訃聞 2**。")
print("  6. 🔴 **這個數字是【某個 checkout 在某個時點】的性質,不是 repo 的性質。**")
print("     同一時刻:某分支上已改、你的基底上還沒改 —— **兩邊都是真的**。")
print("     ⇒ 要分辨「沒改」與「改了但沒進 dev」,**只能掃所有 worktree 與所有分支**:")
print("       `for w in $(git worktree list --porcelain | grep ^worktree | cut -d' ' -f2); do …`")
print("       `for b in $(git branch --format='%(refname:short)'); do git show \"$b:<path>\" | grep -c …`")
print("     ⇒ **把數字寫進報告時,連【哪個 checkout、什麼時點】一起寫**,否則它下一小時就不成立。")
PY
