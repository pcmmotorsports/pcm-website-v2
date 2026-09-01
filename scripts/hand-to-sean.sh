#!/usr/bin/env bash
# hand-to-sean.sh — 把一支 migration 交到 Sean 的桌面, 而【交出去這件事本身留下可查的證據】。
#
# ══ 🔴🔴 **它為什麼存在(而它不是為了方便)** ═══════════════════════════════════
#    2026-09-01 線DB `-c7` 對正式庫實查(唯讀)量到:
#      142 支函式裡有 7 支的 `pg_proc.prosrc` 與【帳本說已 apply 的那支 repo 檔】不同。
#      而其中四支的 `APPLIED.tsv` sha256 **今天仍然相符** ⇒ 檔案沒被改過,
#      而正式庫裡的文字少了一整段註解 ⇒ ⇒ **當初貼進去的是另一份文字。**
#    📌 **⇒ 結論(板子 `⟦c7-SHAPROVESFILE⟧`)**:
#      **`APPLIED.tsv` 的 sha256 證明的是【這支檔案沒有被改過】,**
#      **它【不】證明【貼進正式庫的就是這支檔】。**
#    🔵 而那四支【行為完全相同】(剝掉註解後逐字一致)⇒ 今天沒有正式庫風險。
#    🛑 **而那是運氣不是保證** —— 同一個機制擋不住「貼了一份少一行 `WHERE` 的版本」。
#
# ══ 🛑🛑 **它【擋不住】什麼 —— 先讀這一段, 它比它能做的重要** ═══════════════════
#    🔴 **它證不到「Sean 貼進去的就是桌面那一份」。**
#       他可能只貼了一半、編輯器可能吃掉什麼、可能貼到別的地方去。
#    ⇒ ⇒ **那一格只有【貼完之後回頭比正式庫】才答得出來**
#       (`pg_proc.prosrc` / `pg_class` / `pg_default_acl` —— 唯讀連線)。
#    🎯 **⇒ 所以本支的下游是那一發,而不是本支自己。**
#    📌 **⇒ 而把這個限制寫清楚,比多做一道假檢查有用** ——
#       一道永遠會過的檢查不是弱的保護,它是**假的**保護。
#
# ══ 用法 ═══════════════════════════════════════════════════════════════════════
#   bash scripts/hand-to-sean.sh <版本號> <序號> <白話名> <說明檔路徑>
#   bash scripts/hand-to-sean.sh --selftest
#
#   <序號>      貼的順序(1, 2, 3…)。🔴 順序有意義時它是唯一的載體 —— 檔名會帶它。
#   <說明檔路徑> 給 Sean 讀的白話:**它會改什麼 / 貼了會看到什麼 / 貼錯了怎麼還原**。
#   🔴 **不給就 rc=2** —— 那一段【不能自動產生】,而自動產生的說明等於沒有說明。
#
# ══ 它做什麼 ═══════════════════════════════════════════════════════════════════
#   ① 用 `cp` 把 migration 複製出來(🔴 **不重寫**:2026-09-01 一夜三次「重打就會潤稿」)
#   ② 把白話說明【前置】成 SQL 註解, 而 **repo 那份的位元組必須原封不動地在檔尾**
#      ⇒ 用 `endswith` 逐位元驗, 不是比長度也不是比行數
#   ③ 記進 `~/pcm-mailbox/交件-桌面-<日期>.tsv`:版本號 / 桌面檔名 / repo sha256 / 交件時刻 / 貼了沒
#      🔴 **「貼了沒」那一欄一開始是空的 —— 那正是它存在的理由。**
#   ⚠️ **本支不掛 pre-commit** —— 它是【交件工具】不是守門。
set -u

MIG_DIR="supabase/migrations"
DESK="$HOME/Desktop"
LEDGER="$HOME/pcm-mailbox/交件-桌面-$(date +%Y%m%d).tsv"

die() { echo "🔴 $*" >&2; exit 2; }

hand_one() {
  local ver="$1" seq="$2" nice="$3" notefile="$4" desk_dir="${5:-$DESK}" ledger="${6:-$LEDGER}"
  [ -f "$notefile" ] || die "說明檔不存在:$notefile ——【不給就不交件】,自動產生的說明等於沒有說明。"
  [ -s "$notefile" ] || die "說明檔是空的:$notefile"
  local src; src="$(ls "$MIG_DIR/${ver}"_*.sql 2>/dev/null | head -1)"
  [ -n "$src" ] || die "找不到 migration:${MIG_DIR}/${ver}_*.sql"

  local out="$desk_dir/貼這個-${seq}-${nice}-${ver}.sql"
  mkdir -p "$desk_dir"
  {
    echo "-- ============================================================================"
    echo "-- 📋 貼這個之前先讀這一段(白話)"
    echo "-- ============================================================================"
    sed 's/^/-- /' "$notefile"
    echo "-- ============================================================================"
    echo "-- 🔵 以下【逐位元等於】 $src ——"
    echo "--    由 scripts/hand-to-sean.sh 用 cp 產生, 不是重打的。"
    echo "-- ============================================================================"
  } > "$out"
  cat "$src" >> "$out"

  # 🔴 逐位元驗:repo 那份必須原封不動地是桌面檔的【結尾】。
  #    比長度或比行數都會被「少一個字元」騙過去。
  python3 - "$src" "$out" <<'PY' || die "逐位元驗證失敗:桌面檔的結尾不等於 repo 那份"
import sys
a=open(sys.argv[1],'rb').read(); b=open(sys.argv[2],'rb').read()
sys.exit(0 if b.endswith(a) else 1)
PY

  local sha; sha="$(shasum -a 256 "$src" | awk '{print $1}')"
  mkdir -p "$(dirname "$ledger")"
  [ -s "$ledger" ] || printf '# 版本號\t桌面檔名\trepo_sha256\t交件時刻\t貼了沒(貼完回填 apply 日期)\n' > "$ledger"
  printf '%s\t%s\t%s\t%s\t\n' "$ver" "$(basename "$out")" "$sha" "$(date '+%Y-%m-%d %H:%M')" >> "$ledger"

  echo "✅ 交件:$out"
  echo "   repo   $src"
  echo "   sha256 $sha"
  echo "   帳本   $ledger(「貼了沒」欄留空 —— 貼完要回填)"
  echo "🛑 而本支【證不到】他貼進去的就是這一份 —— 那要貼完之後比正式庫(見檔頭)。"
}

selftest() {
  local tmp; tmp="$(mktemp -d)"; local rc=0
  local ver; ver="$(ls "$MIG_DIR" | head -1 | grep -oE '^[0-9]+')"
  [ -n "$ver" ] || { echo "🔴 自檢:抓不到任何 migration 版本號"; exit 1; }
  printf '這是自檢用的說明。\n' > "$tmp/note.txt"

  echo "── ① 正常路徑應該成功 ──"
  # 🔴 一定要包在【子 shell】裡 —— `die` 會 `exit 2`, 而在同一個 shell 裡跑會把自檢整支殺掉
  #    (第一版就是這樣:③ 那一格印到一半就結束, 而它看起來像「自檢跑完了」)
  ( hand_one "$ver" 9 "自檢" "$tmp/note.txt" "$tmp/desk" "$tmp/led.tsv" ) > /dev/null 2>&1 \
    && echo "  ✅ rc=0" || { echo "  🔴 正常路徑失敗"; rc=1; }

  echo "── ② 桌面檔的結尾被改一個字元 ⇒ 逐位元驗證必須紅 ──"
  local f; f="$(ls "$tmp/desk"/*.sql | head -1)"
  printf 'X' >> "$f"
  python3 - "$(ls "$MIG_DIR/${ver}"_*.sql | head -1)" "$f" <<'PY'
import sys
a=open(sys.argv[1],'rb').read(); b=open(sys.argv[2],'rb').read()
sys.exit(0 if b.endswith(a) else 1)
PY
  if [ $? -ne 0 ]; then echo "  ✅ 它紅了(該紅的世界會紅)"; else echo "  🔴 它沒紅 —— 這道驗證是假的"; rc=1; fi

  echo "── ③ 不給說明檔 ⇒ 必須拒絕交件 ──"
  ( hand_one "$ver" 9 "自檢" "$tmp/沒有這個檔.txt" "$tmp/desk2" "$tmp/led2.tsv" ) > /dev/null 2>&1
  if [ $? -ne 0 ]; then echo "  ✅ 拒絕了"; else echo "  🔴 它交了 —— 而說明是這支工具的一半"; rc=1; fi

  echo "── ④ 帳本那一列的「貼了沒」欄必須是空的 ──"
  if awk -F'\t' '/^[0-9]/{ if ($5=="") ok=1 } END{ exit ok?0:1 }' "$tmp/led.tsv"; then
    echo "  ✅ 是空的(那正是它存在的理由)"
  else echo "  🔴 它被填了東西"; rc=1; fi

  rm -rf "$tmp"
  [ $rc -eq 0 ] && echo "⇒ selftest PASS(該綠的綠、該紅的紅)" || echo "⇒ 🔴 selftest FAIL"
  return $rc
}

case "${1:-}" in
  --selftest) selftest; exit $? ;;
  "") die "用法:bash scripts/hand-to-sean.sh <版本號> <序號> <白話名> <說明檔路徑>" ;;
esac
[ $# -eq 4 ] || die "要四個參數:<版本號> <序號> <白話名> <說明檔路徑>(說明檔不給就不交件)"
hand_one "$1" "$2" "$3" "$4"
