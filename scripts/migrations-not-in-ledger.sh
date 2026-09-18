#!/bin/sh
# ============================================================
# migrations-not-in-ledger.sh — 「哪幾支【可能】沒貼」· 不連 DB, 不連網
# ============================================================
# 線 -db 2026-09-03 建。主視窗-87 派工。
#
# 🎯 **它答的問題**:`supabase/migrations/` 裡有, 而 `supabase/APPLIED.tsv` 沒記的, 是哪幾支?
#
# 🛑🛑 **它【不是】在答「哪幾支沒貼」** —— 那兩件事不一樣, 而今晚實測過:
#    2026-09-03 抽樣 10 支「帳本查無」的對正式庫實查 ⇒ **5 支其實已經貼了。**
#    ⇒ 📌 **帳本答的是「有沒有人【記】」, 不是「DB 裡有沒有」。**
#    ⇒ ⇒ 所以本支的輸出是【候選】不是【結論】。要判某一支, 用
#         `bash scripts/is-migration-applied.sh <檔名>` 產唯讀 SQL 給有存取權的人跑。
#
# 🔵 **而它為什麼還是有用**:
#    · 它**今天就跑得出數字**, 而不需要任何人有正式庫存取
#      (對照:`scripts/migration-ledger-divergence.sh` 比三本帳, 而第三本要 supabase CLI + link
#       ⇒ 2026-09-03 實測它在施工窗上 `exit 1`:找不到 `supabase/.temp/project-ref`
#       ⇒ 🎯 **那支在【沒有存取權的窗】手上是零判別力的, 而今晚每一個窗都沒有存取權。**)
#    · 它給的是一個**會縮小的分母**:記帳越勤, 這個數字越小。
#
# 🛑 **它答不出什麼**(與修法一樣顯眼):
#    · 帳本有記 ⇒ **不代表真的貼了**(沒有人回頭驗過那些記錄)
#    · 帳本沒記 ⇒ **不代表沒貼**(今晚 10 支裡 5 支反例)
#    · 它只比【版本號】。同一版本號底下檔案被改過, 它看不見。
#
# 用法  bash scripts/migrations-not-in-ledger.sh
#       bash scripts/migrations-not-in-ledger.sh --selftest
# ============================================================
set -u
# 🔴 檔頭標記的 parser 收攏在一支(⟦0e-DDLINTOVC-MARK⟧;Fable R3 F4 實錘:四份手寫 parser
#    有兩種文法, 同一個檔頭兩把尺說是、兩把尺說不是, 而畫面上沒有東西說兩邊不同)。
#    🛑 讀不到它 ⇒ **擋下**, 不要靜默退回本地判斷。
_MARKLIB="$(cd "$(dirname "$0")" && pwd)/lib-migration-header-marks.sh"
if [ -f "$_MARKLIB" ]; then . "$_MARKLIB"; else
  printf '🔴 找不到 %s ⇒ 檔頭標記無法判讀, 擋下(不放行)\n' "$_MARKLIB" >&2; exit 2
fi
# 🔴 `PCM_MNIL_ROOT` **只給 --selftest 用**:codex 2026-09-06 R1 MF7 指出, 第一版的
#    兩個世界是重跑一段孤立的 `head|sed`, **沒有執行真正的分類迴圈** ⇒ 迴圈裡的
#    「不是候選」「VCN」「M-VCN」三件事一件都沒被驗到。
#    ⇒ 要驗真的那條路, 就得讓本支能指到 fixture。⚠️ 正常使用不要設它。
# 🔴🔴 **codex 2026-09-06 R2**:第一版無條件吃這個環境變數 ⇒ **正常執行只要繼承到它,
#    就會靜默去讀另一棵 root** —— 而那正是它自己在別處記著的那個病(一個看起來正常的輸出,
#    量的是別的東西)。✅ 只在 `--selftest` 這一個參數下才認它, 而且要出聲。
# 🔵 `--selftest-child` = selftest 造出來的那一發:它要跑**正常輸出路徑**(才驗得到分類迴圈),
#    而又需要指到 fixture root ⇒ 與 `--selftest` 一樣認 `PCM_MNIL_ROOT`, 但不進 selftest 分支。
if { [ "${1:-}" = "--selftest" ] || [ "${1:-}" = "--selftest-child" ]; } && [ -n "${PCM_MNIL_ROOT:-}" ]; then
  ROOT=$PCM_MNIL_ROOT
  echo "🔵 selftest:改讀 PCM_MNIL_ROOT=$ROOT(這個環境變數只在 --selftest 下生效)" >&2
else
  if [ -n "${PCM_MNIL_ROOT:-}" ]; then
    echo "⚠️ 偵測到 PCM_MNIL_ROOT 而本次不是 --selftest ⇒ **忽略它**, 照常讀本 repo。" >&2
  fi
  ROOT=$(cd "$(dirname "$0")/.." && pwd)
fi
MIG="$ROOT/supabase/migrations"
LEDGER="$ROOT/supabase/APPLIED.tsv"

[ -d "$MIG" ]    || { echo "🔴 找不到 $MIG ⇒ 這是報錯不是「零支」" >&2; exit 2; }
[ -f "$LEDGER" ] || { echo "🔴 找不到 $LEDGER ⇒ 這是報錯不是「全部沒貼」" >&2; exit 2; }

TMP="${TMPDIR:-/tmp}/mnil-$$"
mkdir -p "$TMP" || exit 2
trap 'rm -rf "$TMP"' EXIT

# repo 側:每支 migration 的版本號
find "$MIG" -maxdepth 1 -name '*.sql' -print \
  | sed 's|.*/||; s|_.*||' | sort -u > "$TMP/repo.txt"
# 帳本側:每一行開頭的版本號(略過註解行)
grep -v '^#' "$LEDGER" 2>/dev/null | sed 's|[^0-9].*||' | grep -E '^[0-9]{8,}$' | sort -u > "$TMP/ledger.txt"

R=$(grep -c '' "$TMP/repo.txt")
H=$(grep -c '' "$TMP/ledger.txt")
comm -23 "$TMP/repo.txt" "$TMP/ledger.txt" > "$TMP/miss.txt"
M=$(grep -c '' "$TMP/miss.txt")

# ── 🔴 量具自檢:comm 真的照我以為的方式運作嗎 ──────────────────
#    (形狀抄 `migration-ledger-divergence.sh:139` 的同名段, 不自創)
printf 'a\nb\n' > "$TMP/t1"; printf 'b\n' > "$TMP/t2"
SELF=$(comm -23 "$TMP/t1" "$TMP/t2" | tr -d '\n')
[ "$SELF" = "a" ] || { echo "🔴 comm 自檢失敗(期望 a, 得到 [$SELF])⇒ 下面的數字不算數" >&2; exit 2; }

if [ "${1:-}" = "--selftest-child" ]; then set --; fi
if [ "${1:-}" = "--selftest" ]; then
  # 🟢 正對照:塞一個 repo 有而帳本沒有的版本 ⇒ 必須出現在差集
  echo '29999999999999' >> "$TMP/repo.txt"; sort -u -o "$TMP/repo.txt" "$TMP/repo.txt"
  comm -23 "$TMP/repo.txt" "$TMP/ledger.txt" | grep -q '^29999999999999$' \
    && echo "🟢 正對照:現造版本號有出現在差集裡" \
    || { echo "🔴 正對照失敗:現造的版本號沒出現在差集 ⇒ 這支尺沒接上" >&2; exit 2; }
  # 🔵 負對照:帳本裡真的有的那一個, 不得出現在差集
  ANY=$(head -1 "$TMP/ledger.txt")
  if comm -23 "$TMP/repo.txt" "$TMP/ledger.txt" | grep -q "^$ANY$"; then
    echo "🔴 負對照失敗:帳本有記的 $ANY 竟出現在差集 ⇒ 比對寫反了" >&2; exit 2
  fi
  echo "🔵 負對照:帳本有記的 $ANY 沒有出現在差集"
  # ══ 🟠 補版控型標記兩個世界 —— **跑真正的分類迴圈**(codex R1 MF7)═══════════
  #    🛑 同一支 fixture 只差那一行 —— 換了 fixture 就不是在量那一行。
  STV="$TMP/vc"; mkdir -p "$STV/supabase/migrations" "$STV/scripts"
  cp "$0" "$STV/scripts/$(basename "$0")"
  # 🔴 **唯一 parser 也要跟著複製** —— 不複製 ⇒ 那支 fail-closed `exit 2` ⇒ 世界一紅。
  #    🔵 而**那個紅是對的**:抓到它的正是我為了 codex R2 才補上的那個 rc 檢查
  #      (第一版把 child 的 rc 丟掉 ⇒ 這一發會靜靜地變成「輸出裡沒有補版控字樣」而全綠)。
  cp "$_MARKLIB" "$STV/scripts/$(basename "$_MARKLIB")"
  printf 'CREATE TABLE public.zz_a (a int);\n' > "$STV/supabase/migrations/29999999999997_a.sql"
  printf '# fixture ledger\n' > "$STV/supabase/APPLIED.tsv"
  # 🔴 **codex 2026-09-06 R2**:第一版把 child 的 rc 丟掉 ⇒ 那支跑失敗時, 輸出裡自然
  #    「沒有補版控字樣」⇒ 世界二照樣綠。⇒ rc 要收, 而且非 0 就當場停。
  # 🔴🔴 ⛔ ~~函式最後一句寫 `_WRC=$?`~~ —— **賦值成功 ⇒ 函式回 0** ⇒ 呼叫端那句
  #    `[ "$_r" = "0" ] || …` **永遠成立** ⇒ 📌 我為了修「rc 沒驗」而寫的守門, 本身是恆綠的。
  #    ✅ 收完 rc 要 `return` 它。實測:把 child 換成 `exit 3` ⇒ 舊寫法綠、新寫法紅。
  _run_world() {
    PCM_MNIL_ROOT="$STV" sh "$STV/scripts/$(basename "$0")" --selftest-child 2>&1
    return $?
  }

  # 世界一:帶標記 ⇒ 標成「不是候選」, 而且真正候選數要少一
  printf -- '-- pcm:ddl-into-vc: public.zz_b\nCREATE TABLE public.zz_b (a int);\n' > "$STV/supabase/migrations/29999999999998_b.sql"
  W1OUT=$(_run_world); _r=$?
  [ "$_r" = "0" ] || { echo "🔴 世界一失敗:本體 rc=$_r(不是 0)⇒ 下面的比對不算數" >&2; exit 2; }
  printf '%s' "$W1OUT" | grep -q '29999999999998.*補版控型(物件 public.zz_b).*不是候選' \
    && echo "🟠 世界一:帶標記 ⇒ 那一列標成【補版控型 · 不是候選】" \
    || { echo "🔴 世界一失敗:那一列沒標成補版控型 ⇒ $(printf '%s' "$W1OUT" | grep 29999999999998)" >&2; exit 2; }
  printf '%s' "$W1OUT" | grep -q '🟠 上面有 1 支是【補版控型】' \
    && echo "🟠 世界一:VCN 算成 1" \
    || { echo "🔴 世界一失敗:VCN 不是 1" >&2; exit 2; }
  printf '%s' "$W1OUT" | grep -q '真正的候選是 1 支' \
    && echo "🟠 世界一:真正候選 = 2 − 1 = 1(M−VCN 算對)" \
    || { echo "🔴 世界一失敗:M−VCN 不對 ⇒ $(printf '%s' "$W1OUT" | grep 真正的候選)" >&2; exit 2; }

  # 世界二:同一支【拿掉那一行】⇒ 三件事都要消失
  #    🛑 沒有這一格,「帶標記會這樣印」與「這支尺對誰都這樣印」印同一個東西。
  printf 'CREATE TABLE public.zz_b (a int);\n' > "$STV/supabase/migrations/29999999999998_b.sql"
  W2OUT=$(_run_world); _r=$?
  [ "$_r" = "0" ] || { echo "🔴 世界二失敗:本體 rc=$_r(不是 0)⇒ 下面的比對不算數" >&2; exit 2; }
  printf '%s' "$W2OUT" | grep -q '補版控型' \
    && { echo "🔴 世界二失敗:沒有標記卻印了補版控型 ⇒ 那段是恆真的" >&2; exit 2; } \
    || echo "🔵 世界二:拿掉那一行 ⇒ 補版控型那幾句都不印(證明世界一的綠不是恆綠)"
  # 🔴 **codex R2**:只驗「沒有補版控字樣」的話, **把一般候選那一列整個刪掉也會綠**
  #    ⇒ 那一格答的是「沒有 X」, 而它宣稱的是「照一般候選印」。⇒ 正面驗那一列在。
  printf '%s' "$W2OUT" | grep -qE '^  29999999999998$' \
    && echo "🔵 世界二:那一列【真的以一般候選的形狀印出來了】(不是整列消失)" \
    || { echo "🔴 世界二失敗:一般候選那一列不見了 ⇒ $(printf '%s' "$W2OUT" | grep 29999999999998)" >&2; exit 2; }
  printf '%s' "$W2OUT" | grep -q '真正的候選是' \
    && { echo "🔴 世界二失敗:VCN=0 卻仍印「真正的候選」那句" >&2; exit 2; } \
    || echo "🔵 世界二:VCN=0 ⇒ 那句摘要不印"

  # 🧬 邊界:冒號後面是空的 ⇒ 出聲, 而且照一般候選印
  printf -- '-- pcm:ddl-into-vc:\nCREATE TABLE public.zz_b (a int);\n' > "$STV/supabase/migrations/29999999999998_b.sql"
  W3OUT=$(_run_world); _r=$?
  [ "$_r" = "0" ] || { echo "🔴 邊界失敗:本體 rc=$_r(不是 0)⇒ 下面的比對不算數" >&2; exit 2; }
  printf '%s' "$W3OUT" | grep -q '標記不完整' \
    && echo "🧬 邊界:冒號後空的 ⇒ 出聲說標記不完整" \
    || { echo "🔴 邊界失敗:冒號後空的被靜默忽略" >&2; exit 2; }
  printf '%s' "$W3OUT" | grep -q '29999999999998.*補版控型' \
    && { echo "🔴 邊界失敗:空標記卻仍被當成補版控型" >&2; exit 2; } \
    || printf '%s' "$W3OUT" | grep -qE '^  29999999999998$' \
    && echo "🧬 邊界:空標記 ⇒ 那一列以一般候選的形狀印出來(正面驗, 不只是「沒有 X」)" \
    || { echo "🔴 邊界失敗:空標記那一列沒有以一般候選形狀印出來" >&2; exit 2; }

  # ══ ⛔ never-apply 那一族(a1 2026-09-18 加;主視窗指定的驗收)══════════════
  #
  # 🛑 **主視窗要的那一格逐字**:「拿一支【在 never-apply 裡、但其實已經貼了】的假情境跑一次
  #    ⇒ 它必須印出不一致, 不可以靜靜歸到『刻意不貼』那一段。」
  #    📌 沒有這一格, never-apply 就變成「寫上去就免查」的通行證。
  #
  # 世界四:帶 never-apply ⇒ 標成【刻意不貼 · 不是候選】, 而且真正候選數要少一
  printf -- '-- pcm:never-apply\nCREATE TABLE public.zz_b (a int);\n' > "$STV/supabase/migrations/29999999999998_b.sql"
  printf '# fixture ledger\n' > "$STV/supabase/APPLIED.tsv"
  W4OUT=$(_run_world); _r=$?
  [ "$_r" = "0" ] || { echo "🔴 世界四失敗:本體 rc=$_r(不是 0)⇒ 下面的比對不算數" >&2; exit 2; }
  printf '%s' "$W4OUT" | grep -q '29999999999998.*刻意不貼.*不是候選' \
    && echo "⛔ 世界四:帶 never-apply ⇒ 那一列標成【刻意不貼 · 不是候選】" \
    || { echo "🔴 世界四失敗:那一列沒標成刻意不貼 ⇒ $(printf '%s' "$W4OUT" | grep 29999999999998)" >&2; exit 2; }
  printf '%s' "$W4OUT" | grep -q '真正的候選是 1 支' \
    && echo "⛔ 世界四:真正候選 = 2 − 1 = 1(M−NAN 算對)" \
    || { echo "🔴 世界四失敗:M−NAN 不對 ⇒ $(printf '%s' "$W4OUT" | grep 真正的候選)" >&2; exit 2; }
  # 🔴 射程那句要真的印在輸出裡(不是只寫在註解 —— 讀輸出的人看不到註解)
  printf '%s' "$W4OUT" | grep -q '本支不連 DB' \
    && echo "⛔ 世界四:射程那句【印在輸出裡】" \
    || { echo "🔴 世界四失敗:射程那句沒印出來 ⇒ 讀輸出的人不會知道它證不到什麼" >&2; exit 2; }

  # 🔴 世界五:**標了 never-apply 而帳本【有它一列】⇒ 必須叫, 而且 rc 要 1**
  #    這就是主視窗要的那一格:「寫上去就免查」的通行證在這裡被擋掉。
  printf '# fixture ledger\n29999999999998\tdeadbeef\t2026-09-18\tfixture\n' > "$STV/supabase/APPLIED.tsv"
  W5OUT=$(_run_world); _r=$?
  printf '%s' "$W5OUT" | grep -q '標記矛盾.*29999999999998' \
    && echo "🔴 世界五:never-apply + 帳本有列 ⇒ **出聲說矛盾**(不是靜靜歸到「刻意不貼」)" \
    || { echo "🔴 世界五失敗:矛盾沒被叫出來 ⇒ never-apply 變成免查通行證" >&2; exit 2; }
  [ "$_r" = "1" ] \
    && echo "🔴 世界五:rc=1(而不是靜靜回 0)—— 呼叫它的人擋得住" \
    || { echo "🔴 世界五失敗:有矛盾而 rc=$_r(期望 1)⇒ 只有畫面在叫, 程式擋不住" >&2; exit 2; }

  # 🔵 世界六(負對照):**補版控型 + never-apply + 帳本有列 ⇒ 不可以叫**
  #    🛑 沒有這一格, 上面那道閘會對【被裁定過的正常狀態】叫 ——
  #       而 2026-09-18 第一版就是這樣:一上線噴 3 支, 三支全是假的。
  printf -- '-- pcm:ddl-into-vc: public.zz_b\n-- pcm:never-apply\nCREATE TABLE public.zz_b (a int);\n' > "$STV/supabase/migrations/29999999999998_b.sql"
  W6OUT=$(_run_world); _r=$?
  [ "$_r" = "0" ] || { echo "🔴 世界六失敗:本體 rc=$_r(期望 0)⇒ 它對正常狀態叫了" >&2; exit 2; }
  printf '%s' "$W6OUT" | grep -q '標記矛盾' \
    && { echo "🔴 世界六失敗:補版控型是被裁定過的正常狀態, 不該被判矛盾" >&2; exit 2; } \
    || echo "🔵 世界六(負對照):補版控型 + never-apply + 帳本有列 ⇒ **不叫**(它是正常狀態)"

  echo "✅ selftest 通過(而它證的是【這把尺會動】, 不證任何一支貼了沒)"
  exit 0
fi

echo "======== migrations 對帳本的差集 ========"
echo "repo 的 migration   $R 支"
echo "帳本有記的           $H 支"
echo "🔴 repo 有而帳本沒記  $M 支  ← 這是【候選】不是【沒貼】"
echo
# ── 🟠 補版控型逐支標出來(⟦0e-DDLINTOVC-MARK⟧;-f8 2026-09-06 裁甲)────────────
#
# 🛑 **病灶**:一支「把【已經在正式庫上的】東西補進版控」的 migration, 按定義**本來就不在帳本上**
#    ⇒ 它每一次都出現在這張差集裡, 而**它不是候選** —— 它永遠不會被貼。
#    📌 而讀這張表的人拿它去排「要 Sean 貼」的那一疊 ⇒ **補版控型每次都會被排進去。**
#    (2026-09-02 實錘:`20260901170000` 就是這樣被排進去的, 見它自己的檔頭 :12。)
# ⚠️ 只讀檔頭前 20 行(照 `migration-ledger-divergence.sh:247` 的先例):
#    一支檔【中段提到】這個字面不該把它自己變成補版控型。
# ── ⛔ 刻意不貼型也要標出來(a1 2026-09-18;主視窗批)────────────────────────
#
# 🛑 **病灶與補版控型【同一族】**:一支「刻意永遠不貼」的 migration 按定義也不在帳本上
#    ⇒ 它每次都出現在這張差集裡, 而它不是候選。
#    🔬 2026-09-18 實測:本支印 5 支候選, 其中 **4 支是刻意不貼的、真候選 0 支**
#       ⇒ 📌 **一份永遠全是雜訊的清單, 保證被整份跳過 —— 而下一支真的出現時它長得一模一樣。**
#    🔴 **而 `-- pcm:never-apply` 這個標記【早就存在】**, 只是本支沒讀它:
#       唯一讀它的是 `migration-ledger-divergence.sh`(第⑨格), 而那支要 supabase link
#       ⇒ 2026-09-18 在施工窗 worktree 實跑 **exit 1**(找不到 supabase/.temp/project-ref)
#       ⇒ 🎯 **標記有、讀者有, 而【跑得動的那支沒讀】** —— 這就是本次補上的那一格。
# 🔵 走同一個 parser(`mark_present`, 無值 key), 不新寫第二份 —— 本檔上面那條註解的理由。
VCN=0
NAN=0
if [ "$M" -gt 0 ]; then
  while IFS= read -r _v; do
    [ -n "$_v" ] || continue
    _f=$(find "$MIG" -maxdepth 1 -name "${_v}_*.sql" -print 2>/dev/null | head -1)
    # 🔴 抽值/出聲都走唯一 parser(Fable R3 F4:四份手寫 parser 兩種文法)。
    _o=""
    [ -n "$_f" ] && _o=$(mark_value_or_warn "$(head20_of_file "$_f")" ddl-into-vc "$_v")
    _na=0
    [ -n "$_f" ] && mark_present "$(head20_of_file "$_f")" never-apply && _na=1
    if [ "$_na" = "1" ]; then
      NAN=$((NAN + 1))
      printf '  %s  ⛔ 刻意不貼(檔頭 -- pcm:never-apply)—— **不是候選**\n' "$_v"
    elif [ -n "$_o" ]; then
      VCN=$((VCN + 1))
      printf '  %s  🟠 補版控型(物件 %s)—— **不是候選**, 它不會被貼\n' "$_v" "$_o"
    else
      printf '  %s\n' "$_v"
    fi
  done < "$TMP/miss.txt"
fi
echo
echo "🛑 判準:這 $M 支【不等於沒貼】—— 2026-09-03 抽樣 10 支實查, 其中 5 支已經貼了。"
echo "   要判某一支:bash scripts/is-migration-applied.sh <檔名>  ⇒ 產唯讀 SQL 交給有存取權的人跑"
if [ "$VCN" -gt 0 ]; then
  echo "🟠 上面有 $VCN 支是【補版控型】(檔頭 -- pcm:ddl-into-vc:)——"
  echo "   它們建的物件在正式庫上早就有了, **按定義永遠不在帳本上** ⇒ 把它們排進「要 Sean 貼」是錯的。"
fi
if [ "$NAN" -gt 0 ]; then
  echo "⛔ 上面有 $NAN 支是【刻意不貼】(檔頭 -- pcm:never-apply)——"
  echo "   它們永遠不會被貼 ⇒ 把它們排進「要 Sean 貼」是錯的。理由與出處寫在各自的檔頭那一行下面。"
  # 🔴 射程印在【輸出裡】, 不是只寫在註解 —— 讀輸出的人看不到註解(主視窗 2026-09-18 加的驗收)。
  echo "   🛑 而這個分類【證不到】那幾支在正式庫上真的不存在 —— **本支不連 DB**。"
  echo "      它抓得到「標了 never-apply 卻同時被記進帳本」那種矛盾(見下面);"
  echo "      抓不到「標了 never-apply 而正式庫上其實有」⇒ 那要 is-migration-applied.sh + 有存取權的人。"
fi
if [ "$VCN" -gt 0 ] || [ "$NAN" -gt 0 ]; then
  echo "   ⇒ 真正的候選是 $((M - VCN - NAN)) 支。"
fi

# ── 🔴 矛盾閘:標了 never-apply 卻在帳本上有一列 ──────────────────────────────
#
# 🎯 **它擋的是「寫上去就免查」那條路** —— 沒有這一格, `never-apply` 就變成一張通行證:
#    任何人在檔頭加一行就能讓一支【其實已經貼了】的 migration 從清單上消失, 而沒有東西會叫。
# 🔵 本支不連 DB, 所以它只能比【兩本可見的帳】:檔頭的宣告 vs APPLIED.tsv 的紀錄。
#    ⇒ 那已經擋得住最常見的那一種:貼完了才想起來標、或標了之後又貼了。
#
# 🔴🔴 **而【補版控型】要排除掉, 否則這道閘一上線就叫三次而三次都是假的。**
#    🔬 2026-09-18 實測:第一版寫成「never-apply + 帳本有列 ⇒ 矛盾」, 立刻噴 3 支
#       (`20260901170000` / `20260902200000` / `20260902210000`)—— 而那三支是【對的】:
#       它們同時帶 `ddl-into-vc`, 而帳本那一列逐字寫
#         「【補版控型】物件在正式庫 ≠ 本檔被 apply;**本檔從未以檔 apply**」
#         「主視窗 -f8 裁【**乙:補版控型記進帳本**】」
#       ⇒ 📌 **對補版控型而言「never-apply + 帳本有一列」是被裁定過的正常狀態, 不是矛盾。**
#    ⇒ 🛑 一道會對正常狀態叫的閘, 第三次之後就沒有人看了 —— 那比沒有閘更糟。
CONFLICT=0
for _naf in "$MIG"/*.sql; do
  [ -f "$_naf" ] || continue
  _nah=$(head20_of_file "$_naf")
  mark_present "$_nah" never-apply || continue
  # 🔵 補版控型:兩個標記一起出現是正常的(理由見上面)⇒ 不比帳本。
  mark_present "$_nah" ddl-into-vc && continue
  _nav=$(basename "$_naf" | sed 's/_.*//')
  if grep -q "^${_nav}	" "$LEDGER" 2>/dev/null; then
    CONFLICT=$((CONFLICT + 1))
    [ "$CONFLICT" = "1" ] && echo
    printf '🔴 標記矛盾:%s 的檔頭標了 -- pcm:never-apply, 而 APPLIED.tsv 有它的一列。\n' "$_nav"
    printf '   ⇒ 兩者只有一個是真的。要嘛它其實貼了(拿掉標記), 要嘛帳本那列是錯的。**不要兩個都留。**\n'
  fi
done
if [ "$CONFLICT" -gt 0 ]; then
  echo "🛑 上面 $CONFLICT 支矛盾 ⇒ 本支 exit 1(這不是「有候選」, 是【帳本自己互相打架】)。"
fi

echo "🔵 而這個數字會縮小 —— 每貼完一支就記一行, 見 supabase/APPLIED.tsv 檔頭。"

# 🔴🔴 **寫成 if, 不要寫成 `[ … ] && exit 1`** ——
#    後者在「沒有矛盾」時, `[ 0 -gt 0 ]` 自己回 false, 而它是最後一個命令
#    ⇒ **整支腳本的 rc 變成 1**, 而畫面上一個字都沒變。
#    🔬 2026-09-18 我就是這樣寫錯的, 而**抓到它的是本檔自己原有的 selftest**
#       (它斷言「本體 rc=0」⇒ 印出「🔴 世界一失敗:本體 rc=1」)。
#    📌 一個只改 rc 而不改畫面的 bug, 只有斷言抓得到 —— 肉眼看輸出是全對的。
if [ "$CONFLICT" -gt 0 ]; then
  exit 1
fi
exit 0
