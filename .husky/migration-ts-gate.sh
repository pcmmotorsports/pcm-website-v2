#!/bin/sh
# migration 時間戳撞號守門(2026-08-20 立;機制優先律)
#
# 背景:2026-08-20 兩個窗各自挑了 `20260820060000`,兩支都 commit 進去了。
#   `supabase/APPLIED.tsv` **以 14 碼前綴為鍵** ⇒ `grep -c "^20260820060000"` 同時命中兩支
#   ⇒ 套了一支,那張「套了沒」的查詢會說**兩支都套了** ⇒ 對兩支都失去判別力。
#   而擋下那一次的是人去跑 `ls | grep -oE '^[0-9]{14}' | sort | uniq -d`,不是任何一道閘。
#   ⇒ 那條命令一行、零依賴、不到一秒 ⇒ 做成機制。
#
# 🔴 分母只看【這次新增的檔】(--diff-filter=A),不掃整個目錄:
#   掃整個目錄找重複的話,一旦真的存在一組重複,**每個人的每一顆 commit 都被擋死** ——
#   那正是 `admin-dev-bypass-gate` 第一版幹過的事(掃整支 staged 檔 ⇒ 632 條的 backlog 沒人 commit 得動)。
#   ⇒ 既有的重複(如果哪天有)**不擋任何人**:它是歷史,不是這次的錯。
#   ⇒ 改動一支既有的 migration(改註解、改內容)**也不擋** —— 那不是撞號。
#
# 🔴🔴 **射程:本閘的分母是【我這棵樹的這一次 commit】,而撞號的分母是【所有樹的聯集】。**
#   (2026-08-31 線DB 補;**只寫射程,不改行為** —— 改行為要另外提案。)
#   實錘:`20260831160000` 被兩支 migration 用掉,而**本閘一次都沒有出聲**:
#     · 15:28 `bb3618b3`(線DB)為了解**上一個**撞號,把 spec1 從 140000 改到 160000
#     · 18:0x `2cd00b4b`(線帳戶區)新增 coupon 那支,**也**挑了 160000
#   兩支各自 commit 時,`--diff-filter=A` 各自只看得到**自己那一支** ⇒ 兩次都合法 ⇒ 兩次都放行。
#   🔴 **⇒ 這不是本閘壞了,是它從設計上就看不到「別的樹上正在誕生什麼」。**
#   📌 **⇒ 而更該記的是:【修撞號的那一顆,自己撞了下一個號】** ——
#      `bb3618b3` 挑 160000 的當下它是空的,它賭贏了 2.5 小時。
#      ⇒ **「挑一個當下看起來空的號」在單人時是安全的,在八窗並行時是一次賭。**
#   ⚠️ 所以本閘印的「下一個可用的戳」**同樣只是那一刻的快照**,不是預約 ——
#      拿去用之前,再看一眼有沒有別的窗剛好也在用它(而這一句正是本閘目前答不出來的那半)。
#
# 🔴 本閘**不自動改檔名**:時間戳的發號權在主視窗(2026-08-20 立,與 backlog 編號同一條規矩)。
#   本閘只做兩件:指出撞到誰、算出下一個可用的戳供參考。
#
# 🔴🔴 **而本閘的訊息刻意【不裁定該誰改】**(2026-08-20 主視窗指正,我原本寫了「先來後到」):
#   一道閘的訊息會被讀成規則 —— 因為它出現在人被擋住、**最需要一個答案**的那一刻。
#   而「先來後到」是那一次裁定的**結論**,它的理由(其中一支已 commit ⇒ 改號要動已落地的東西)
#   **不是每次都成立**。
#   ⇒ 判別句:**一道閘可以說「你撞到了」,不該說「所以你要怎麼做」** ——
#     前者是它量到的,後者是別人的判斷。
#
# 逃生門:PCM_ALLOW_MIGRATION_TS_DUP=1 git commit ...(commit body 寫明理由)

set -e

[ "${PCM_ALLOW_MIGRATION_TS_DUP:-}" = "1" ] && {
  echo "⚠ migration 時間戳守門被 PCM_ALLOW_MIGRATION_TS_DUP=1 略過 —— 請在 commit body 寫明理由" >&2
  exit 0
}

MIGDIR="supabase/migrations"
[ -d "$MIGDIR" ] || exit 0

# 這次【新增】的 migration(只有 A;M/R 不算撞號)
NEW=$(git diff --cached --name-only --diff-filter=A -- "$MIGDIR/*.sql" || true)
[ -z "$NEW" ] && exit 0

HITS=""
for f in $NEW; do
  base=$(basename "$f")
  ts=$(printf '%s' "$base" | grep -oE '^[0-9]{14}' || true)
  # 檔名不是 14 碼戳開頭 ⇒ 不是這道閘管的事(命名規則由別處管)
  [ -z "$ts" ] && continue
  # 與【目錄裡現有的每一支】比對(排除自己)
  for other in "$MIGDIR"/"$ts"*.sql; do
    [ -e "$other" ] || continue
    [ "$other" = "$f" ] && continue
    HITS="$HITS
  新增 $base
  撞到 $(basename "$other")"
  done
done

[ -z "$HITS" ] && exit 0

# 下一個可用的戳(只供參考,不自動改)
LAST=$(ls "$MIGDIR" | grep -oE '^[0-9]{14}' | sort | tail -1)
NEXT=$(printf '%s' "$LAST" | awk '{ print substr($0,1,8) sprintf("%06d", substr($0,9,6) + 10000) }')

# 擋案簿:只記【發生了】,不判【是不是誤擋】——閘判不出那件事,自評欄位沒有意義。
# 分母機器記,分子留給後來的人查。寫失敗不得讓 commit 失敗。
LOG_HEAD=$(git rev-parse --short HEAD 2>/dev/null || echo unknown)
LOG_TS=$(date -u +%FT%TZ 2>/dev/null || echo unknown)
{
  for f in $NEW; do
    base=$(basename "$f")
    ts=$(printf '%s' "$base" | grep -oE '^[0-9]{14}' || true)
    [ -z "$ts" ] && continue
    for other in "$MIGDIR"/"$ts"*.sql; do
      [ -e "$other" ] || continue
      [ "$other" = "$f" ] && continue
      printf '%s\tmigration-ts-dup\t%s\t%s\n' "$LOG_TS" "$base" "$LOG_HEAD"
    done
  done
} >> .husky/.gate-blocks.log 2>/dev/null || true

cat >&2 <<MSG

🔴 擋下:migration 時間戳撞號
$HITS

  為什麼這不是美觀問題:supabase/APPLIED.tsv 以 14 碼前綴為鍵
  ⇒ grep -c "^<戳>" 會同時命中兩支 ⇒ 套了一支,查詢會說兩支都套了
  ⇒ 對兩支都失去判別力,而且 apply 先後未定義。

  處置:其中一支要改時間戳。
  常見的做法是【後 commit 的那支改】,因為先落地的改起來比較貴。
  🔴 **而這不是規則** —— 哪一支該改要看情況(例如另一支尚未 commit、或它的戳有語意)。
  🔴 **拿不準就問主視窗,發號權在它**(與 backlog 編號同一條規矩)。
  目前目錄最大的戳是 $LAST,下一個常見寫法是 $NEXT(僅供參考,不是發號)。
  改法:git mv $MIGDIR/<舊檔名> $MIGDIR/<新戳>_<同樣的後綴>.sql
       然後 grep 舊字面確認零殘留,並重跑那支的斷言。

  真的必要(例如兩支刻意同戳、而你知道 APPLIED.tsv 會怎樣):
    PCM_ALLOW_MIGRATION_TS_DUP=1 git commit ...
    並在 commit body 寫明理由

MSG
exit 1
