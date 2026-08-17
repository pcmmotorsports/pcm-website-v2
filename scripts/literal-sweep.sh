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

# ══════════════════════════════════════════════════════════════════════════
# 🔴 --selftest:這支【全陣天天在用的尺】自己的守門者(2026-08-18 補)。
#   為什麼要有:它此前 selftest=0 —— 行為只被【手驗】過,而手驗隨 session 消失;
#   且它剛被改過(限度那段),而改過的東西最容易被當成「已經沒問題」。
#   兩個世界(缺一則一支恆抓/恆漏的尺也會全綠):
#     ① 該命中的必須落在【它自己那一類】(七類各一個合成標記檔,驗路由不串類)
#     ② 不該命中的必須讓七類【全部印出 0 命中】(raison d'être:掃了沒有 ≠ 忘了掃)
#     ③ 限度那幾行【必須全印】——刪掉一條就紅(射程被靜默刪掉唯一擋得住的方式)
#   🔴 零判定改動:本區只【呼叫】主流程 "$0" <needle> 抓 stdout 斷言,不碰 categorizer。
# ══════════════════════════════════════════════════════════════════════════
if [ "${1:-}" = "--selftest" ]; then
  # 🔴 標記字串【組出來、不寫成連續字面】—— 因為本工具會掃自己這支檔(⑦類),
  #    寫成連續字面的話,它會在自己的原始碼裡找到自己的標記 ⇒ 「絕對缺席」那格假失敗。
  #    (2026-08-18 第一版就這樣栽了:ABSENT 是連續字面 ⇒ 世界②ㆍ得 6/7 而非 7/7。)
  MK="LITSWEEP_SELFTEST_""MARKER_""ZQX9animal"
  ABSENT="LITSWEEP_ABSENT_""NEVER_""ZZQQ77never"
  # 七類各一個合成檔(路徑決定歸類;內容含標記)。名字帶 _litsweep_selftest 好認、好清。
  declare -a ST_FILES=(
    "supabase/migrations/_litsweep_selftest_ZQX9.sql"    # ①
    "scripts/_litsweep_selftest_ZQX9-down.sql"           # ②
    "docs/runbooks/_litsweep_selftest_ZQX9.md"           # ③
    "docs/specs/_litsweep_selftest_ZQX9.md"              # ④
    "apps/_litsweep_selftest_ZQX9.test.ts"               # ⑤
    "docs/handoff/_litsweep_selftest_ZQX9.md"            # ⑥
    "scripts/_litsweep_selftest_ZQX9.txt"                # ⑦
  )
  declare -a ST_CAT=("①" "②" "③" "④" "⑤" "⑥" "⑦")
  st_cleanup() {
    for f in "${ST_FILES[@]}"; do rm -f "$f"; done
    local leftover; leftover=$(git status --porcelain 2>/dev/null | grep -F "_litsweep_selftest_ZQX9" || true)
    if [ -n "$leftover" ]; then
      echo "🔴🔴 selftest 清理失敗,這些合成檔還在(不要 commit):" >&2
      echo "$leftover" >&2
    fi
  }
  trap st_cleanup EXIT INT TERM HUP
  # 🔴 開跑先清【上一次被 SIGKILL 殺掉沒清乾淨】的合成檔(trap 對 kill -9 無效,reviewer 抓)——
  #    否則一支 _litsweep_selftest_*.sql 會留在 supabase/migrations,被 glob *.sql 的 migration 工具撿走。
  stale=$(find supabase/migrations scripts docs apps -name '_litsweep_selftest_ZQX9*' 2>/dev/null || true)
  if [ -n "$stale" ]; then
    echo "⚠ 清掉上一次被殺掉沒清乾淨的合成檔:" >&2; echo "$stale" >&2
    echo "$stale" | while IFS= read -r sf; do [ -n "$sf" ] && rm -f "$sf"; done
  fi
  for f in "${ST_FILES[@]}"; do
    mkdir -p "$(dirname "$f")"
    # 🔴 內容用註解形(-- / //)⇒ 就算 SIGKILL 窗內被 migration 工具撿走也是【惰性】、不會執行出東西。
    case "$f" in
      *.sql) printf -- '-- %s\n' "$MK" > "$f" ;;
      *.ts)  printf -- '// %s\n' "$MK" > "$f" ;;
      *)     printf '%s\n' "$MK" > "$f" ;;
    esac
  done

  FAIL=0
  pass() { echo "PASS  $1"; }
  fail() { echo "FAIL  $1"; FAIL=1; }

  # ── 世界①:命中該落在自己那一類。抓每一類 header 之後、下一個 header 之前的區塊,
  #    驗那一類的合成檔【在】、且不在別類(路由不串)。
  OUT_HIT="$("$0" "$MK")"
  i=0
  for f in "${ST_FILES[@]}"; do
    cat="${ST_CAT[$i]}"
    # 該檔應出現在輸出裡(某一行含它的路徑)
    if printf '%s' "$OUT_HIT" | grep -qF "$f"; then
      # 且它出現的那一段的類別標題應是自己的 cat:抓「$f」那行往上最近的「── 類別」行
      seg_cat="$(printf '%s' "$OUT_HIT" | awk -v needle="$f" '
        /^── / { curcat=$0 }
        index($0, needle) { print curcat; exit }')"
      if printf '%s' "$seg_cat" | grep -qF "$cat"; then
        pass "世界①-$cat 合成檔落在自己那一類($f)"
      else
        fail "世界①-$cat 合成檔跑到別類了(期望 $cat,實得段落標題:$seg_cat)"
      fi
    else
      fail "世界①-$cat 合成檔根本沒被命中($f)—— 該類路由或 walk 壞了"
    fi
    i=$((i + 1))
  done

  # ── 世界②:不該命中的 → 七類【全部】印 0 命中(raison d'être)。
  OUT_MISS="$("$0" "$ABSENT")"
  zero_lines=$(printf '%s' "$OUT_MISS" | grep -cE "0 命中\(這一類掃了 [0-9]+ 個檔\)" || true)
  if [ "$zero_lines" -eq 7 ]; then
    pass "世界②ㆍ0 命中時七類全印(raison d'être;實得 $zero_lines/7)"
  else
    fail "世界②ㆍ0 命中時【沒有】七類全印(實得 $zero_lines/7)—— 這正是本工具要防的病"
  fi

  # ── 限度那幾行必須全印(刪一條就紅)。
  for probe in \
    "1. 只掃**檔案裡的字面**" \
    "2. 跳過的目錄" \
    "3. 一個檔只歸一類" \
    "4. 它告訴你"; do
    if printf '%s' "$OUT_MISS" | grep -qF "$probe"; then
      pass "限度行仍在:$probe"
    else
      fail "🔴 限度行被靜默刪掉了:$probe"
    fi
  done

  st_cleanup
  trap - EXIT INT TERM HUP
  if [ "$FAIL" -eq 0 ]; then echo "selftest: 全過"; exit 0; else echo "selftest: 有 FAIL"; exit 1; fi
fi

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
