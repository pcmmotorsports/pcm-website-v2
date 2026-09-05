#!/bin/bash
# 🟢 唯讀。掃【所有 agent/line-* 分支 + origin/dev】的 supabase/migrations/,
#    找【同一個 14 位版本號、而檔名不同】的 .sql —— 那是兩支不同的 migration 搶同一個號。
#
# 🔴 **為什麼一次檢查擋不住它**(2026-09-05 一天內兩組):
#    我挑版本號的時候核過「當時看得到的樹」, 而**別條線的那支是之後才長出來的**
#    ⇒ 📌 **「我核過版本號」與「版本號是唯一的」是兩個宣稱** ——
#       前者綁著一個時刻, 後者要到【合併那一刻】才成立。⇒ 這道閘要在合併前跑。
#
# 🔴 **而分母比人以為的大**(當場量到, 這是本支存在的第二個理由):
#    `agent/line-*` 不是六條, 2026-09-05 有 **11 條**(account 家族就 5 條)。
#    ⇒ 分支名單**當場從 git 抓**, 不寫死 —— 寫死的名單會安靜地漏掉新開的線。
#
# 🛑 **它證不到什麼**:
#    · 只看 `.sql`。同前綴的 `.md`(例 `20260820030000_ERRATUM.md` 是那支 migration 的勘誤)
#      **是合法配對, 不是撞號** ⇒ 刻意不算。
#    · 它比【檔名】不比【內容】—— 同名同號的同一支檔在多條分支上是正常的, 不叫。
#    · 它掃的是【本機看得到的 ref】。一條沒 fetch 進來的遠端分支, 它看不到。
set -u
ROOT="${PCM_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null)}"
if [ -z "$ROOT" ] || [ ! -d "$ROOT/supabase/migrations" ]; then
  printf '🔴 找不到 repo 根 ⇒ **沒有掃**, 不是「沒有撞號」\n' >&2; exit 2
fi

scan() {
  # $1 = 額外要掃的 ref(可空)。印出「版本號<TAB>檔名」每行一筆, 去重。
  python3 - "$ROOT" "${1:-}" <<'PYEOF'
import subprocess,sys,re
root,extra=sys.argv[1],sys.argv[2]
brs=subprocess.run(['git','-C',root,'branch','--list','agent/line-*','--format=%(refname:short)'],
                   capture_output=True,text=True).stdout.split()
for r in ('origin/dev', extra):
    if r and r not in brs: brs.append(r)
seen=set()
for b in brs:
    p=subprocess.run(['git','-C',root,'ls-tree','--name-only',b,'supabase/migrations/'],
                     capture_output=True,text=True)
    if p.returncode: continue
    for f in p.stdout.split('\n'):
        f=f.strip()
        if not f.endswith('.sql'): continue
        base=f.rsplit('/',1)[-1]
        m=re.match(r'^(\d{14})',base)
        if m: seen.add((m.group(1),base))
for v,b in sorted(seen): print(f"{v}\t{b}")
print(f"__REFS__\t{len(brs)}", file=sys.stderr)
PYEOF
}

if [ "${1:-}" = "--selftest" ]; then
  # 🔵 兩個世界都要表演。用【當場現造的假資料】跑同一段歸類邏輯,
  #    不碰真的 repo —— 真 repo 的內容會變, 而自檢不該跟著它變。
  python3 - <<'PYEOF'
import re,collections
def dups(names):
    s=collections.defaultdict(set)
    for n in names:
        if not n.endswith('.sql'): continue
        m=re.match(r'^(\d{14})',n)
        if m: s[m.group(1)].add(n)
    return {k:v for k,v in s.items() if len(v)>1}
w1=['20260905130000_a.sql','20260905130000_b.sql','20260905140000_c.sql']
w2=['20260905130000_a.sql','20260905140000_c.sql','20260820030000_x.sql','20260820030000_ERRATUM.md']
d1,d2=dups(w1),dups(w2)
ok1 = list(d1)==['20260905130000']
ok2 = d2=={}
print(f"  世界一 兩支不同檔名同號   ⇒ 抓到嗎? {'是' if ok1 else '否'}({list(d1)})")
print(f"  世界二 乾淨 + .md 同前綴  ⇒ 【不叫】嗎? {'是' if ok2 else '否'}({list(d2)})")
print(f"  ⇒ 自檢 {'PASS(兩個世界印不同答案)' if ok1 and ok2 else 'FAIL'}")
raise SystemExit(0 if (ok1 and ok2) else 1)
PYEOF
  exit $?
fi

# 🔴 **只擋【這一發碰到的版本號】, 不擋歷史**(2026-09-05 立本支時當場想清楚的):
#    現況有一組真撞號(`20260905130000`)而它由 `-ship` 那條線改號。
#    無條件擋的話 ⇒ **全隊每一個動 migration 的 commit 都被擋**,
#    而被擋的人【不是造成它的人、也不是修得動的人】⇒ 那道閘會在半小時內被繞過。
#    ⇒ ✅ 傳進來的檔名(lint-staged 會給)決定擋不擋:
#       這一發的 migration 落在撞號名單裡 ⇒ 紅;沒有 ⇒ **印出來給人看, 放行**。
#    ⚠️ 而【不帶檔名跑】(人手動跑)⇒ 有撞號就紅 —— 那時你是刻意來查的。
STAGED_VERS=""
for arg in "$@"; do
  case "$arg" in
    *supabase/migrations/*.sql)
      v=$(basename "$arg" | sed -n 's/^\([0-9]\{14\}\).*/\1/p')
      [ -n "$v" ] && STAGED_VERS="$STAGED_VERS $v"
      ;;
  esac
done

TMP=$(mktemp); trap 'rm -f "$TMP"' EXIT
scan "" > "$TMP" 2>"$TMP.err"
REFS=$(sed -n 's/^__REFS__\t//p' "$TMP.err")
N=$(grep -c . "$TMP")
DUP=$(cut -f1 "$TMP" | uniq -d)

printf '  🔵 分母:%s 個 ref · %s 支不同檔名(分支名單當場從 git 抓, 沒有寫死)\n' "${REFS:-?}" "$N"
if [ -z "$DUP" ]; then
  printf '  ✅ 沒有版本號被兩支不同的 .sql 用到\n'
  exit 0
fi
printf '  🔴 **這些版本號被【兩支不同的 .sql】用到**:\n' >&2
while IFS= read -r v; do
  [ -z "$v" ] && continue
  printf '     %s\n' "$v" >&2
  awk -F'\t' -v v="$v" '$1==v {print "        " $2}' "$TMP" >&2
done <<< "$DUP"
printf '  ⇒ 合併之後它們會在同一個資料夾裡搶同一個號。**改號要趁還沒有人貼**。\n' >&2
printf '  ⇒ 判別誰改:已經貼進正式庫的那支【不能改】(改了帳本對不上);改沒貼的那支。\n' >&2

# 這一發有沒有碰到撞號的那些版本?
if [ -n "$STAGED_VERS" ]; then
  for v in $STAGED_VERS; do
    if printf '%s\n' "$DUP" | grep -qx "$v"; then
      printf '  🛑 **而這一發改的 `%s` 正是撞號的那一個 ⇒ 擋下。**\n' "$v" >&2
      exit 1
    fi
  done
  printf '  ✅ **而這一發改的 migration 不在上面那些版本號裡 ⇒ 放行。**\n' >&2
  printf '     (上面那些是既有的, 由持有它的那條線改號 —— 不是這一發造成的。)\n' >&2
  exit 0
fi
exit 1
