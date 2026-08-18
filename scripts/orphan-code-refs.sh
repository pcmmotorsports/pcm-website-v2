#!/usr/bin/env bash
# orphan-code-refs.sh — 「有人指望 × 沒人在追」掃描
#
# 找兩種【寫下來了、但沒人看得到】的缺口:
#   ① 無號 : code 註解還在指望某個工作代號,而 backlog 沒有任何標題認領它
#   ② 錯號 : code 註解引用一個【已收(✅)】的 backlog 號
#            (限【帶期待語】的引用行:必須/要先/之前/尚未/留給/TODO…)
#            ⇒ 照號去查的人會看到一個綠勾就走人 —— 找到的是錯的答案,而它讀起來像好消息
#
# 判準來源:memory feedback_would-this-sweep-find-the-known-case(2026-08-18 E 窗實跑歸納)
#   ① code 註解裡還在被引用、且該行帶【延後語】 ⇒ 它還活著、還有人指望它
#     backlog 沒有標題認領                        ⇒ 沒有人在追
#     交集 = 有人指望而沒人在追
#
# 🔴 ② 區用【比延後語更寬的期待語】(EXPECT),而這一條是被已知案例測試逼出來的:
#    第一版對 ② 也套 DEFER,結果撈不到已知案例 `#26` —— 因為那行寫的是
#    「員工真正上工之前,`#26` 真認證必須先落地」,一個延後語都沒有。
#    ⇒ **期待未來工作的句子不一定用延後語寫。**
#    改回不過濾則噪音爆掉(46 條,多數是「這件事在 #NNN 做過了」的史料引用)
#    ⇒ 折衷 = 加一組「義務/前置」詞(必須/要先/之前/未接…)。實測 2026-08-18 @HEAD 見報告。
#
# 🔴 輸出是【候選】不是待辦清單。多數命中是已完成的工作(spec 代號是墓碑田),
#    每一條都要人工判:做完了?別名?還是真的沒人在追?
#
# 🔴 已知案例測試(負向對照;照 memory feedback_negative-control-must-use-state-at-failure-time
#    —— 要拿【病發當下的狀態】當測資,不是修好的現在)。2026-08-18 W8 實跑:
#      git worktree add --detach /tmp/negctl 2e4afeda   (= #633 落檔【前】)
#      bash scripts/orphan-code-refs.sh /tmp/negctl     ⇒ ① 區含 `B-4`   ✅ 實測命中
#      git worktree add --detach /tmp/negctl2 90a7e183^ (= #26 錯號修【前】)
#      bash scripts/orphan-code-refs.sh /tmp/negctl2    ⇒ ② 區含 `#26`   ✅ 實測命中
#    對照組(今天的樹 @ 3c48e938):
#      B-4  ⇒ 消失 ✅(#633 的標題認領了它)      ⇒ 兩個世界印不同的東西,① 區有判別力。
#      #26  ⇒ 🔴 **還在**,而這【不是量具失敗】:`90a7e183` 只修了被指名的
#             `apps/admin/src/app/settings/audit/page.tsx`,而同一個錯號在
#             `supabase/migrations/20260815020000_…audit_log_grant_select.sql:15/17/19`
#             原封不動 —— 也就是說 ② 區第一次跑就撈到一條【真的、還活著的】殘留。
#             (那正是 memory feedback_folding-a-finding-defaults-to-the-named-spot-only 的形狀。)
#
# 用法: bash scripts/orphan-code-refs.sh [repo 根目錄]   (預設 = 當前目錄)
#
# 🔴 2026-08-18 撤掉一個排除規則(留痕):第一版排除了 `Q-*`,理由寫「那是 Sean 的拍板題號」。
#    同日實查推翻:`Q-EMBED-1` 是**工作代號**,code 內 23 處引用、backlog 零提及、零標題認領
#    —— 而它正是 `#636` 的原始標記。⇒ **`Q-` 底下兩種東西混住**(Sean 的題號 `Q-C9` / 工作碼 `Q-EMBED-1`),
#    用前綴分不開 ⇒ **不排除,交人工判**。教訓:一個「看起來很合理的排除規則」造出的是假分母。
#
# ponytail: 只掃【連字號】代號(B-4 / E8-B / DS-0b)。OP5 / A9g2 這種無連字號的形式不掃
#           —— 用字形和一般英數詞分不開。要涵蓋它們得換判準,不是放寬 pattern。
#           ② 區只認【兩位數以上】的 backlog 號:單位數命中的全是信件內的 findings 編號
#              (例「codex 關卡1 #2」),不是 backlog 號。已知案例 #26 是兩位數,不受影響。
set -uo pipefail

ROOT="${1:-.}"
BACKLOG="$ROOT/docs/phase-1-backlog.md"
[ -f "$BACKLOG" ] || { echo "找不到 $BACKLOG" >&2; exit 2; }

SRC_DIRS=()
for d in apps packages supabase; do [ -d "$ROOT/$d" ] && SRC_DIRS+=("$ROOT/$d"); done
[ ${#SRC_DIRS[@]} -gt 0 ] || { echo "在 $ROOT 找不到 apps/ packages/ supabase/" >&2; exit 2; }

DEFER='刻意留|保留|留給|留待|待 |才擴|才接|才做|尚未|未做|TODO|FIXME|defer|延後|後續|日後'
# ② 區用的是【更寬的「期待」集】,不是延後語 —— 見檔頭「被已知案例逼出來的」那一段。
EXPECT="${DEFER}|必須|要先|前置|之前|再做|未落|沒落|沒做|未接|未修|未補|未驗"
CODE='[A-Z]{1,3}[0-9]{0,2}-[0-9A-Za-z]{1,3}[a-z]?'

TMP=$(mktemp -d) || exit 1
trap 'rm -rf "$TMP"' EXIT

grep -rnE '(//|--|\*|#)' --include='*.ts' --include='*.tsx' --include='*.sql' "${SRC_DIRS[@]}" 2>/dev/null \
  | grep -vE '\.(test|spec)\.|__tests__|/test/' > "$TMP/comments" || true
grep -E "$DEFER" "$TMP/comments" > "$TMP/defer" || true
grep -E "$EXPECT" "$TMP/comments" > "$TMP/expect" || true

DEFER_N=$(wc -l < "$TMP/defer" | tr -d ' ')
grep -ohE "$CODE" "$TMP/defer" | sort -u > "$TMP/codes" || true

# 🔴 形狀六(W7 2026-08-18):條目有號、有內容,而住在一個【沒被收割的分支】上
#    ⇒ 對只看 checkout 的掃描是隱形的,會被誤報成「無號」。
#    這裡不自動掃 refs(那會讓上面那兩個歷史負向對照不可重跑),改成【把盲區印出來】。
AHEAD=$(git -C "$ROOT" for-each-ref --format='%(refname:short)' refs/heads 2>/dev/null \
  | while read -r b; do
      n=$(git -C "$ROOT" rev-list --count "dev..$b" 2>/dev/null || echo 0)
      [ "${n:-0}" -gt 0 ] && echo "  $b(+$n)"
    done)

echo "== 分母(掃描根目錄 $ROOT)=="
echo "帶延後語的非測試註解行 : $DEFER_N"
echo "從中抽出的連字號代號   : $(wc -l < "$TMP/codes" | tr -d ' ')  (不排除 Q-*,理由見檔頭)"
echo

echo "== ① 無號:有人指望 × 沒人在追 =="
N1=0
while read -r code; do
  [ -z "$code" ] && continue
  # 必須是專案真的在用的代號:docs/ 內查得到(濾掉 JSON-LD / OWNER-COMPANY 這類詞片段)
  grep -rqE "(^|[^A-Za-z0-9-])${code}([^A-Za-z0-9-]|\$)" "$ROOT/docs" 2>/dev/null || continue
  grep -qE "^### #.*(^|[^A-Za-z0-9-])${code}([^A-Za-z0-9-]|\$)" "$BACKLOG" && continue
  N1=$((N1+1))
  echo "--- ${code}  (backlog 內文提及 $(grep -cE "(^|[^A-Za-z0-9-])${code}([^A-Za-z0-9-]|\$)" "$BACKLOG") 次、無標題認領)"
  grep -E "(^|[^A-Za-z0-9-])${code}([^A-Za-z0-9-]|\$)" "$TMP/defer" | cut -d: -f1,2 | sed "s|^${ROOT}/||;s|^|      |" | head -5
done < "$TMP/codes"
[ "$N1" = 0 ] && echo "(無候選)"

echo
echo "== ② 錯號:帶期待語的 code 註解引用一個【已收】的 backlog 號 =="
N2=0
for n in $(grep -ohE '#[0-9]{2,3}' "$TMP/expect" | sort -u); do
  h=$(grep -m1 -E "^### ${n}[^0-9]" "$BACKLOG") || true
  [ -z "$h" ] && continue
  case "$h" in *✅*|*已收*) ;; *) continue;; esac
  N2=$((N2+1))
  echo "--- ${n} ⇒ ${h:0:80}"
  grep -E "(^|[^0-9])${n}([^0-9]|\$)" "$TMP/expect" | cut -d: -f1,2 | sed "s|^${ROOT}/||;s|^|      |" | head -3
done
[ "$N2" = 0 ] && echo "(無候選)"

echo
echo "候選數: 無號 $N1 / 錯號 $N2"
echo
echo "== ⚠️ 盲區(形狀六):本掃描只看【當前 checkout】 =="
if [ -n "$AHEAD" ]; then
  echo "下列分支領先 dev,它們上面的 backlog 條目在本次掃描裡是隱形的:"
  echo "$AHEAD"
  echo "要涵蓋:git grep -l '^### #' <branch> -- docs/phase-1-backlog.md"
else
  echo "沒有分支領先 dev ⇒ 這一輪沒有這個盲區。"
fi
