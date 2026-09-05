#!/bin/bash
# 🟢 唯讀。比對【兩個獨立實作】對同一個世界算出的 ACL 摘要:
#   ① scripts/acl-snapshot.sh 產的 supabase/acl-snapshot.tsv(bash + psql, 八族分開查)
#   ② supabase/migrations/20260905140000_*.sql 裡那支 public.pcm_acl_digest()(單支 SQL)
#
# 🔴 **為什麼需要這支**(codex 2026-09-05 R1 的 must-fix):那兩份是【會漂的兩個實作】——
#    有人改了腳本而沒改函式(或反過來)⇒ 每日偵測與事故診斷用不同的演算法
#    ⇒ 可能假陰性(偵測看不到腳本看得到的)也可能假陽性(天天紅)。
#    🛑 而【沒有任何東西會叫】—— 一句 COMMENT 提醒不是機制。這支是那個機制。
#
# 🔴 它證不到什麼:
#    · 它只比【總 digest】—— 兩邊同時錯成一樣它不會叫(而那需要有人同時改兩邊且改成同樣的錯)。
#    · 它比的是【此刻的正式庫】—— 它不保證未來還一致。
#    · 🛑 它【不】驗那八族查對了東西 —— 只驗兩份實作一致。查對不對是 acl-snapshot.sh 檔頭那些註解的事。
set -u
# 🔴 root 不寫死(codex R2)—— 原本寫死成一棵【暫時的】worktree,
#    那棵樹被移走 / 換主樹 / 進 CI 之後, 它會安靜地讀錯檔或找不到檔。
ROOT="${PCM_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null)}"
if [ -z "$ROOT" ] || [ ! -d "$ROOT/supabase" ]; then
  printf '🔴 找不到 repo 根(PCM_ROOT 未設且不在 git 樹裡)⇒ **沒有比**\n' >&2; exit 2
fi
MIG="$ROOT/supabase/migrations/20260905140000_m4b_acl_drift_digest_table.sql"
TSV="$ROOT/supabase/acl-snapshot.tsv"

if [ "${1:-}" = "--selftest" ]; then
  # 🔵 兩個世界都要表演:一致 ⇒ 綠;動一個位元 ⇒ 紅。
  T=$(mktemp -d)
  printf 'a\nb\nc\n' > "$T/x"
  A=$(LC_ALL=C sort "$T/x" | md5 -q 2>/dev/null || LC_ALL=C sort "$T/x" | md5sum | cut -d' ' -f1)
  printf 'a\nb\nd\n' > "$T/y"
  B=$(LC_ALL=C sort "$T/y" | md5 -q 2>/dev/null || LC_ALL=C sort "$T/y" | md5sum | cut -d' ' -f1)
  printf 'a\nb\nc\n' > "$T/x2"
  A2=$(LC_ALL=C sort "$T/x2" | md5 -q 2>/dev/null || LC_ALL=C sort "$T/x2" | md5sum | cut -d' ' -f1)
  # 🔴 原本這裡寫 `[ "$A" = "$A" ]` —— 那是恆真, 它沒有算第二次(codex R2 nit)。
  if [ "$A" = "$A2" ]; then printf '  世界一 同內容【各自算一次】⇒ 同 md5:是\n'
  else printf '  🔴 世界一 FAIL\n'; exit 1; fi
  if [ "$A" != "$B" ]; then printf '  世界二 差一個位元 ⇒ 不同 md5:是\n'; else printf '  🔴 世界二 FAIL\n'; exit 1; fi
  rm -rf "$T"
  printf '  ⇒ 自檢 PASS(這只驗雜湊法會動, 不驗那兩份實作)\n'
  exit 0
fi

test -f "$MIG" || { printf '🔴 找不到 migration:%s —— 這是【路徑錯】不是【不一致】\n' "$MIG" >&2; exit 2; }
test -f "$TSV" || { printf '🔴 找不到基線:%s\n' "$TSV" >&2; exit 2; }

# 🔴 **逃生口放在【最前面】**(2026-09-05 實測抓到):原本它放在「查不到」那個分支裡,
#    而連不到正式庫時 `acl-snapshot.sh --emit` 會【更早】失敗並 exit 3
#    ⇒ 那條路根本走不到 ⇒ 逃生口等於不存在, 而它看起來存在。
if [ "${PCM_ACL_PARITY_OFFLINE:-}" = "1" ]; then
  printf '⚠️ PCM_ACL_PARITY_OFFLINE=1 ⇒ 跳過比對。**這一發沒有比過**, 不是比過了。\n' >&2
  # 🔴 逃生口一定要留痕 —— 一個沒有人看得到的例外會變成預設。
  bash "$ROOT/scripts/heartbeat.sh" "acl-parity" \
    "PCM_ACL_PARITY_OFFLINE=1 跳過 ACL parity 比對" \
    "這一發【沒有比過】—— 連得上正式庫時要補跑 bash scripts/acl-digest-parity.sh" >/dev/null 2>&1 \
    || printf '   ⚠️ 而心跳也沒寫成 ⇒ 這次跳過【只存在於這兩行 stderr】。\n' >&2
  exit 0
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
python3 - "$MIG" "$TMP/body.sql" <<'PYEOF'
import io,sys
s=io.open(sys.argv[1],encoding='utf-8').read()
body=s.split("AS $fn$",1)[1].split("$fn$;",1)[0]
io.open(sys.argv[2],'w',encoding='utf-8').write(
  "\\pset pager off\n\\pset tuples_only on\n\\pset format unaligned\n\\set ON_ERROR_STOP on\n"+body.strip()+"\n")
PYEOF

# 🔴 **先重跑快照腳本**(codex R2):原本只雜湊【既存的 tsv】——
#    有人改了 acl-snapshot.sh 而沒重寫 tsv 時, 兩份實作已經漂了而這支照樣印 PASS。
#    ⇒ 現在比的是【腳本此刻的產出】對【函式此刻的產出】, 不是對一份可能過期的檔。
#    ⚠️ 而它【不】寫回基線 —— 更新基線是一個決定, 不是一個副作用。
if ! bash "$ROOT/scripts/acl-snapshot.sh" --emit "$TMP/snap" 2>"$TMP/snaperr"; then
  printf '🔴 acl-snapshot.sh --emit 失敗 ⇒ **沒有比**\n' >&2
  tail -3 "$TMP/snaperr" >&2
  exit 3
fi
bash "$ROOT/scripts/readonly-prod-sql.sh" "$TMP/body.sql" > "$TMP/out" 2>"$TMP/err"
RC=$?
if [ "$RC" -ne 0 ]; then
  # 🔴 **「沒有比」也擋**(codex R2:exit 1 與 exit 3 都沒有人接 ⇒ 兩者一樣無聲)。
  #    ⇒ 連不到正式庫時【不放行】, 而給一個要【自己打出來】的逃生口:
  #       PCM_ACL_PARITY_OFFLINE=1 —— 打它的人知道自己在跳過什麼。
  printf '🔴 查不到 ⇒ **沒有比, 不是不一致**(rc=%s)\n' "$RC" >&2
  printf '   連不到正式庫而你確定要先 commit ⇒ PCM_ACL_PARITY_OFFLINE=1 再跑一次。\n' >&2
  tail -3 "$TMP/err" >&2
  exit 3
fi
DB=$(grep -o '[0-9a-f]\{32\}' "$TMP/out" | head -1)
FILE=$(python3 -c "
import io,hashlib,sys
ls=sorted(l.rstrip('\n') for l in io.open(sys.argv[1],encoding='utf-8') if l.strip())
print(hashlib.md5('\n'.join(ls).encode()).hexdigest())" "$TMP/snap")   # 🔴 比【腳本此刻的產出】不是基線檔 —— 基線的年紀不該讓這道閘叫

printf '  函式(正式庫)= %s\n' "${DB:-（沒抓到）}"
printf '  基線 tsv     = %s\n' "$FILE"
if [ -z "$DB" ]; then
  printf '🔴 函式那邊沒抓到 32 位雜湊 ⇒ **沒有比**\n' >&2; exit 3
fi
if [ "$DB" = "$FILE" ]; then
  printf '✅ 兩個獨立實作一致(%s 列)\n' "$(wc -l < "$TMP/snap" | tr -d ' ')"
  exit 0
fi
printf '🔴 **不一致** —— 兩份實作對同一個世界算出不同的答案。\n' >&2
printf '   下一步:跑 `bash scripts/acl-snapshot.sh` 看基線是不是過期了(貼板當天會);\n' >&2
printf '   基線是新的而仍不一致 ⇒ 那兩份查詢真的漂了, 逐族比 md5 找出是哪一族。\n' >&2
exit 1
