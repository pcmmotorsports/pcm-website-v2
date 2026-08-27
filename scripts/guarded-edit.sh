#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# guarded-edit —— 範圍切片改檔的「預期 Δ 對帳」守門
# ═══════════════════════════════════════════════════════════════════════════
# 用法:guarded-edit.sh <檔案> <+N> <-M> <編輯器腳本>
#   例:scripts/guarded-edit.sh docs/specs/x.md 1 1 /tmp/edit.py
#   宣告值 = **本次編輯**預期的增行/刪行數。實得與宣告不符 → 還原 + 非零退出。
#   ⚠️ `<檔案>` 與編輯腳本內的路徑都**相依於呼叫端的 cwd**(本腳本不 cd)。
#
# 🔴 它擋的是什麼:用起訖索引切片改檔時,**吃掉鄰居是靜默的** ——
#    三綠全過、零紅、事後看 diff 也像「本來就沒有」,只有「預期 Δ vs 實際 Δ」對得上帳才抓得到。
#    實錘:2026-08-06 A9w2 區間刪除吃鄰居、2026-08-07 B 線 4c(試跑時當場擋下)。
#    memory `feedback_range-delete-silently-eats-neighbors`。
#
# 🔴 它擋不了什麼(誠實邊界,同一句也印在成功與失敗訊息裡 —— 不能只留在註解):
#    **行數對得上但改錯內容,它一律放行。Δ 是數量不是語意。**
#
# 🔴 設計紀律:這支守門的每一步失敗都必須是**吵的**。
#    它自己是為了「靜默吃掉鄰居」而存在,若它自己靜默失效就毫無意義 ⇒
#    備份失敗=拒絕執行、量不到=不敢判定、還原失敗=大聲說還原失敗並保留備份路徑。
#    (2026-08-07 進 repo 時 code-reviewer 抓到 6 條 must-fix,全是這條紀律的破口。)
set -uo pipefail

FILE="${1:?用法: guarded-edit.sh <檔案> <+N> <-M> <編輯器腳本>}"
EXP_ADD="${2:?缺 +N}"
EXP_DEL="${3:?缺 -M}"
EDITOR_SCRIPT="${4:?缺 editor 腳本}"

case "$EXP_ADD" in ''|*[!0-9]*) echo "🔴 +N 必須是非負整數,收到「$EXP_ADD」" >&2; exit 2 ;; esac
case "$EXP_DEL" in ''|*[!0-9]*) echo "🔴 -M 必須是非負整數,收到「$EXP_DEL」" >&2; exit 2 ;; esac
[ -f "$EDITOR_SCRIPT" ] || { echo "🔴 編輯腳本不存在:$EDITOR_SCRIPT" >&2; exit 2; }
[ -L "$FILE" ] && { echo "🔴 不支援 symlink:$FILE(git diff 會比到 link target 字串而非內容)" >&2; exit 2; }
[ -d "$FILE" ] && { echo "🔴 $FILE 是目錄,不是檔案" >&2; exit 2; }

FILE_EXISTED=0
[ -e "$FILE" ] && FILE_EXISTED=1

BACKUP="$(mktemp)" || { echo "🔴 mktemp 失敗,拒絕執行" >&2; exit 2; }
if [ "$FILE_EXISTED" = 1 ]; then
  # 🔴 備份失敗 = 拒絕執行。不能冒「改壞了卻還原不回來」的險。
  cp "$FILE" "$BACKUP" || {
    echo "🔴 備份 $FILE 失敗 ⇒ 拒絕執行(沒有備份就不能保證還原得回來)" >&2
    rm -f "$BACKUP"; exit 2
  }
fi
echo "  ℹ️  備份:$BACKUP(中途異常時可從這裡手動復原)"

cleanup() { rm -f "$BACKUP"; }

# 還原:原本存在→從備份複製回去;原本不存在→刪掉(不能留 0 byte 幽靈檔)。
# 🔴 一律回報**實際結果**,不是「打算做什麼」。失敗時保留備份、印出路徑。
restore() {
  if [ "$FILE_EXISTED" = 1 ]; then
    if cp "$BACKUP" "$FILE" 2>/dev/null; then
      echo "  ↩️  已用備份還原 $FILE" >&2
    else
      echo "🔴🔴 還原失敗!$FILE 目前是**改壞的狀態**;原始內容仍在 $BACKUP,請手動複製回去。" >&2
      return 1
    fi
  else
    if rm -f "$FILE" 2>/dev/null; then
      echo "  ↩️  已刪除本次新建的 $FILE(還原成「不存在」)" >&2
    else
      echo "🔴🔴 無法刪除新建的 $FILE,請手動處理。" >&2
      return 1
    fi
  fi
  return 0
}

# 還原 → 決定退出碼 → 只有在還原成功時才刪備份。
# 🔴 還原失敗時**絕不能刪備份** —— 訊息剛說「原始內容仍在 $BACKUP」,刪掉就是說謊。
finish() {
  local want_rc="$1"
  if restore; then
    cleanup; exit "$want_rc"
  fi
  echo "   ⚠️  備份**保留未刪**:$BACKUP" >&2
  exit 2
}

trap 'echo "" >&2; echo "🔴 收到中斷訊號 ⇒ 還原後退出" >&2; finish 130' INT TERM

case "$EDITOR_SCRIPT" in
  *.py) python3 "$EDITOR_SCRIPT" ;;
  *)    bash   "$EDITOR_SCRIPT" ;;
esac
EDIT_RC=$?
if [ "$EDIT_RC" -ne 0 ]; then
  echo "🔴 編輯腳本非零退出(rc=$EDIT_RC)" >&2
  finish 1
fi

if [ "$FILE_EXISTED" = 1 ] && [ ! -f "$FILE" ]; then
  echo "🔴 編輯後 $FILE 不見了(被刪掉了?)" >&2
  finish 1
fi
if [ "$FILE_EXISTED" = 0 ] && [ ! -f "$FILE" ]; then
  echo "🔴 編輯腳本沒有建立 $FILE" >&2
  cleanup; exit 1
fi

# 對帳基準 = 備份 vs 現檔。`--no-index` 讓它與 git 追蹤狀態無關(untracked 也量得到)。
# git diff 兩檔相同 → rc 0 且無輸出;不同 → rc 1 有輸出。**rc >1 = 出事,不是「沒變更」**。
NUM="$(git diff --numstat --no-index -- "$BACKUP" "$FILE" 2>&1)"
GIT_RC=$?
if [ "$GIT_RC" -gt 1 ]; then
  echo "🔴 量測失敗(git rc=$GIT_RC):$NUM" >&2
  echo "   量不到 = **不敢判定**,一律當失敗處理、不當作「沒有變更」。" >&2
  finish 1
fi

LINE1="$(printf '%s\n' "$NUM" | head -1)"
if [ -z "$LINE1" ]; then
  GOT_ADD=0; GOT_DEL=0   # 無輸出 = 兩檔完全相同,這是合法的 0/0
else
  GOT_ADD="$(printf '%s\n' "$LINE1" | awk '{print $1}')"
  GOT_DEL="$(printf '%s\n' "$LINE1" | awk '{print $2}')"
  # 🔴 binary 或不可比時 numstat 回 `-`,絕不可映成 0 ——
  #    那會把「量不到」寫成「沒變」,守門就恆真了。
  case "$GOT_ADD$GOT_DEL" in
    ''|*[!0-9]*)
      echo "🔴 量不到行數變化(numstat 回「$LINE1」;binary 檔或不可比)" >&2
      echo "   量不到 = **不敢判定**,一律當失敗處理、不當作「沒有變更」。" >&2
      finish 1
      ;;
  esac
fi

SEMANTIC_CAVEAT="⚠️  提醒:Δ 對帳只比**行數**,不比內容。行數對得上但改錯內容,本守門一律放行。"

if [ "$GOT_ADD" = "$EXP_ADD" ] && [ "$GOT_DEL" = "$EXP_DEL" ]; then
  echo "  ✅ Δ 對帳相符:$FILE 實得 +$GOT_ADD/-$GOT_DEL = 宣告 +$EXP_ADD/-$EXP_DEL"
  echo "  $SEMANTIC_CAVEAT"
  cleanup; exit 0
fi

echo "🔴 Δ 對帳不符:$FILE 實得 **+$GOT_ADD/-$GOT_DEL**,宣告的是 +$EXP_ADD/-$EXP_DEL" >&2
echo "   多刪的那幾行極可能是**被起訖索引吃掉的鄰居** —— 請改用唯一錨的字串取代。" >&2
echo "   $SEMANTIC_CAVEAT" >&2
finish 1
