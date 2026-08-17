#!/usr/bin/env bash
# ============================================================
# 部署時序 gate 的驗證 harness(對應 plan §4;拋棄式 git repo,零 DB、零網路)
# ============================================================
# 標的 = scripts/deploy-order-gate.sh
# 用法 = bash scripts/deploy-order-gate-verify.sh
#
# 🔴 為什麼要另建一個拋棄式 repo:這道閘吃的是**真的 git 物件**(ref、sha、diff)。
#    在本樹上造測資等於在工作中的 branch 上亂 commit;而只用「假 sha」測,測到的是 git 的錯誤處理、
#    不是閘的判斷。⇒ 每格都在自己的乾淨 repo 裡造真 commit、餵真 sha。
#
# 🔴 每一格的 oracle 是**退出碼 + 訊息字面**兩件:只看 exit code 的話,
#    「因為別的原因紅了」會被算成「這道閘生效了」(本 repo 的常見假綠形狀)。
# ============================================================
set -uo pipefail
export LC_ALL=C

GATE_SRC="$(cd "$(dirname "$0")" && pwd)/deploy-order-gate.sh"
test -f "$GATE_SRC" || { echo "🔴 找不到 $GATE_SRC"; exit 1; }

# 🔴 量出來的,不是估的(每加/刪一格必同步改;數法=腳本尾端印的 PASS=)
EXPECT_TOTAL=36

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }

WORK="$(mktemp -d "${TMPDIR:-/tmp}/dog-verify.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

# ── 造一個拋棄式 repo:一支已 apply 的 migration + 一支 pending 的(內含 CREATE FUNCTION)──
setup_repo() { # $1=repo 路徑
  local R="$1"
  mkdir -p "$R/supabase/migrations" "$R/apps/admin/src" "$R/scripts"
  cp "$GATE_SRC" "$R/scripts/deploy-order-gate.sh"
  ( cd "$R" && git init -q && git config user.email t@t && git config user.name t && git config commit.gpgsign false )
  cat > "$R/supabase/migrations/20260101000000_base.sql" <<'SQL'
CREATE TABLE public.things (id uuid PRIMARY KEY);
SQL
  cat > "$R/apps/admin/src/unrelated.ts" <<'TS'
export const unrelated = 1;
TS
  # 已 apply 的那支進帳
  local sha
  sha="$(shasum -a 256 "$R/supabase/migrations/20260101000000_base.sql" | cut -d' ' -f1)"
  printf '# fixture ledger\n20260101000000\t%s\t2026-01-01\tfixture\n' "$sha" > "$R/supabase/APPLIED.tsv"
  ( cd "$R" && git add -A && git commit -qm base )
}

# 加一支 **pending** 的 migration(新建 RPC 函式 pcm_a9h_probe)
add_pending_migration() { # $1=repo
  cat > "$1/supabase/migrations/20260102000000_pending.sql" <<'SQL'
CREATE OR REPLACE FUNCTION public.pcm_a9h_probe(p_order_id uuid, p_note text)
RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;
SQL
}

# 跑閘:$1=repo $2=stdin 內容 → 印 "rc|輸出"
run_gate() { # $1=repo $2=stdin
  local out rc
  out="$(cd "$1" && printf '%s\n' "$2" | bash scripts/deploy-order-gate.sh 2>&1)"; rc=$?
  printf '%s|%s' "$rc" "$out"
}

# 期望被擋:rc=1 且訊息點名該函式
expect_block() { # $1=名 $2=結果 $3=應出現的字面
  local rc="${2%%|*}" out="${2#*|}"
  if [ "$rc" != "1" ]; then bad "$1 → 期望被擋(rc=1)實際 rc=$rc:$(printf '%s' "$out" | head -2 | tr '\n' ' ')"; return; fi
  if printf '%s' "$out" | grep -qF "$3"; then ok "$1 → 被擋且訊息點名 [$3]"; else
    bad "$1 → rc=1 但訊息沒點名 [$3]:$(printf '%s' "$out" | grep '·' | head -1)"; fi
}
expect_pass() { # $1=名 $2=結果
  local rc="${2%%|*}" out="${2#*|}"
  [ "$rc" = "0" ] && ok "$1 → 放行" || bad "$1 → 期望放行實際 rc=$rc:$(printf '%s' "$out" | grep -E '·|🔴' | head -1)"
}

echo "── 核心:A9h 回歸與不誤擋 ──────────────────────────"

R="$WORK/r1"; setup_repo "$R"
add_pending_migration "$R"
cat > "$R/apps/admin/src/consumer.ts" <<'TS'
export async function callIt(sb: any) {
  return sb.rpc('pcm_a9h_probe', { p_order_id: 'x', p_note: 'y' });
}
TS
( cd "$R" && git add -A && git commit -qm "feat: migration + 呼叫端(A9h 形狀)" )
BASE="$(cd "$R" && git rev-parse HEAD~1)"; TIP="$(cd "$R" && git rev-parse HEAD)"
expect_block "①A9h 回歸:未 apply 的 migration 新建 RPC + app 層呼叫同名" \
  "$(run_gate "$R" "refs/heads/dev $TIP refs/heads/dev $BASE")" "pcm_a9h_probe"

R2="$WORK/r2"; setup_repo "$R2"
add_pending_migration "$R2"
cat > "$R2/apps/admin/src/unrelated.ts" <<'TS'
export const unrelated = 2;
TS
( cd "$R2" && git add -A && git commit -qm "feat: migration + 無關 app 變更" )
B2="$(cd "$R2" && git rev-parse HEAD~1)"; T2="$(cd "$R2" && git rev-parse HEAD)"
expect_pass "②不誤擋:同批有 pending migration,但 app 變更不含那個函式名" \
  "$(run_gate "$R2" "refs/heads/dev $T2 refs/heads/dev $B2")"

R3="$WORK/r3"; setup_repo "$R3"
cat > "$R3/apps/admin/src/consumer.ts" <<'TS'
export const x = 'pcm_a9h_probe';
TS
( cd "$R3" && git add -A && git commit -qm "feat: 只有 app 變更、零 pending migration" )
B3="$(cd "$R3" && git rev-parse HEAD~1)"; T3="$(cd "$R3" && git rev-parse HEAD)"
expect_pass "③不誤擋:PENDING 為空時,就算 app 檔裡有那個名字也放行" \
  "$(run_gate "$R3" "refs/heads/dev $T3 refs/heads/dev $B3")"

echo
echo "── APPLIED.tsv 的兩個面 ────────────────────────────"

R4="$WORK/r4"; setup_repo "$R4"; add_pending_migration "$R4"
cp "$R/apps/admin/src/consumer.ts" "$R4/apps/admin/src/consumer.ts"
SHA4="$(shasum -a 256 "$R4/supabase/migrations/20260102000000_pending.sql" | cut -d' ' -f1)"
printf '20260102000000\t%s\t2026-01-02\tfixture\n' "$SHA4" >> "$R4/supabase/APPLIED.tsv"
( cd "$R4" && git add -A && git commit -qm "feat: 同樣的組合,但 migration 已進帳" )
B4="$(cd "$R4" && git rev-parse HEAD~1)"; T4="$(cd "$R4" && git rev-parse HEAD)"
expect_pass "④翻面:同一組合,把該版本連同正確 sha 寫進 APPLIED.tsv ⇒ 放行" \
  "$(run_gate "$R4" "refs/heads/dev $T4 refs/heads/dev $B4")"

R5="$WORK/r5"; setup_repo "$R5"; add_pending_migration "$R5"
cp "$R/apps/admin/src/consumer.ts" "$R5/apps/admin/src/consumer.ts"
printf '20260102000000\t%s\t2026-01-02\tfixture\n' "$(printf 'deadbeef%.0s' 1 2 3 4 5 6 7 8)" >> "$R5/supabase/APPLIED.tsv"
( cd "$R5" && git add -A && git commit -qm "feat: 帳上有那一行,但 sha 對不上" )
B5="$(cd "$R5" && git rev-parse HEAD~1)"; T5="$(cd "$R5" && git rev-parse HEAD)"
expect_block "⑤sha 漂移:帳上有該版本、但檔案內容與帳上的 sha 不符 ⇒ 仍算 pending" \
  "$(run_gate "$R5" "refs/heads/dev $T5 refs/heads/dev $B5")" "pcm_a9h_probe"

echo
echo "── ref 範圍(關卡1 R2 #1:不能用工作樹/HEAD 當判準)──"

# ⑥ 非 HEAD ref(`push origin dev:main` 形狀):**危險那顆留在 HEAD、要推的是它前面那顆乾淨的**。
#    🔴 code-reviewer 抓到第一版這格零判別力:當時把危險放在 local_sha、安全那顆放 HEAD,
#    而 HEAD 是危險那顆的後代 ⇒ 用 HEAD 當判準也照樣紅。這版反過來:用 HEAD 就會**誤擋**,
#    所以「放行」這個結果本身在證明「判準真的是 stdin 的 local_sha」。
R6="$WORK/r6"; setup_repo "$R6"
( cd "$R6" && echo "// clean" >> apps/admin/src/unrelated.ts && git add -A && git commit -qm "chore: 乾淨那顆(main 要推到這裡)" )
CLEAN="$(cd "$R6" && git rev-parse HEAD)"
add_pending_migration "$R6"
cp "$R/apps/admin/src/consumer.ts" "$R6/apps/admin/src/consumer.ts"
( cd "$R6" && git add -A && git commit -qm "feat: 危險那顆(留在 dev 的 HEAD)" )
DANGER="$(cd "$R6" && git rev-parse HEAD)"
B6="$(cd "$R6" && git rev-parse HEAD~2)"
expect_pass "⑥非 HEAD ref(dev:main 形狀):要推的是乾淨那顆 ⇒ 放行(拿 HEAD 當判準就會誤擋)" \
  "$(run_gate "$R6" "refs/heads/dev $CLEAN refs/heads/main $B6")"

# ⑥-b 同一個 repo,這次真的要推危險那顆 ⇒ 必須擋(證明上面那格不是因為整支壞掉才綠)
expect_block "⑥-b 同一 repo 推危險那顆 ⇒ 擋(上面那格不是因為 gate 整支失能才綠)" \
  "$(run_gate "$R6" "refs/heads/dev $DANGER refs/heads/dev $B6")" "pcm_a9h_probe"

# ⑦ 多 ref 一次推:一條乾淨、一條危險 ⇒ 仍要擋
expect_block "⑦多 ref:一次推兩條,只要有一條命中就擋" \
  "$(run_gate "$R6" "refs/heads/safe $B6 refs/heads/safe $B6
refs/heads/dev $DANGER refs/heads/main $B6")" "pcm_a9h_probe"

# ⑧ 刪除 ref(local_sha 全 0)⇒ 沒有新內容,放行
expect_pass "⑧刪除 ref(local_sha 全 0)⇒ 放行(⚠️ 這格只證「不會炸」,證不到那道全 0 守門——拿掉它也綠,理由見 code-reviewer nit)" \
  "$(run_gate "$R6" "(delete) 0000000000000000000000000000000000000000 refs/heads/dev $B6")"

# ⑨ 遠端還沒有這條 ref(remote_sha 全 0)⇒ 必須對**空樹**比,不能只看 tip 那一顆:
#    危險內容放在**前一顆**、tip 是無關的 —— 關卡2 must-fix #6/#7 指出第一版剛好把危險放在 tip,
#    所以「只看單顆」的錯誤實作也會綠。
T6="$(cd "$R6" && git rev-parse HEAD)"
expect_block "⑨新 ref(remote_sha 全 0):危險在前一顆、tip 無關 ⇒ 對空樹比才抓得到" \
  "$(run_gate "$R6" "refs/heads/dev $T6 refs/heads/dev 0000000000000000000000000000000000000000")" "pcm_a9h_probe"

# ⑨-b 只有會部署的 ref 才判(關卡2 must-fix #5):推 tag / feature branch 一律不管
expect_pass "⑨-b 非部署 ref(feature branch)⇒ 不判(避免 --all/tag 誤擋整批)" \
  "$(run_gate "$R6" "refs/heads/feat $DANGER refs/heads/feat 0000000000000000000000000000000000000000")"
expect_pass "⑨-c 推 tag ⇒ 不判" \
  "$(run_gate "$R6" "refs/tags/v1 $DANGER refs/tags/v1 0000000000000000000000000000000000000000")"

echo
echo "── 射程邊界(Q2=B 的刻意漏擋,寫成格子才不會被誤讀成 bug)──"

R7="$WORK/r7"; setup_repo "$R7"
cat > "$R7/supabase/migrations/20260102000000_pending.sql" <<'SQL'
ALTER TABLE public.things ADD COLUMN pcm_new_column text;
SQL
cat > "$R7/apps/admin/src/consumer.ts" <<'TS'
export const col = 'pcm_new_column';
TS
( cd "$R7" && git add -A && git commit -qm "feat: pending migration 只加欄位、app 用了那個欄位名" )
B7="$(cd "$R7" && git rev-parse HEAD~1)"; T7="$(cd "$R7" && git rev-parse HEAD)"
expect_pass "⑩**刻意漏擋**:pending migration 只加欄位(零 CREATE FUNCTION)⇒ 放行(Sean 拍 Q2=B)" \
  "$(run_gate "$R7" "refs/heads/dev $T7 refs/heads/dev $B7")"

R8="$WORK/r8"; setup_repo "$R8"; add_pending_migration "$R8"
mkdir -p "$R8/apps/admin/src/__tests__"
cat > "$R8/apps/admin/src/consumer.test.ts" <<'TS'
it('calls pcm_a9h_probe', () => {});
TS
( cd "$R8" && git add -A && git commit -qm "test: 只有測試檔提到那個函式名" )
B8="$(cd "$R8" && git rev-parse HEAD~1)"; T8="$(cd "$R8" && git rev-parse HEAD)"
expect_pass "⑪測試檔不算 app 面:只有 *.test.ts 提到函式名 ⇒ 放行" \
  "$(run_gate "$R8" "refs/heads/dev $T8 refs/heads/dev $B8")"

R9="$WORK/r9"; setup_repo "$R9"; add_pending_migration "$R9"
cat > "$R9/apps/admin/src/consumer.ts" <<'TS'
export const x = 'pcm_a9h_probe_v2';
TS
( cd "$R9" && git add -A && git commit -qm "feat: app 用的是更長的相似名字" )
B9="$(cd "$R9" && git rev-parse HEAD~1)"; T9="$(cd "$R9" && git rev-parse HEAD)"
expect_pass "⑫識別字邊界:pcm_a9h_probe_v2 不是 pcm_a9h_probe ⇒ 不誤擋" \
  "$(run_gate "$R9" "refs/heads/dev $T9 refs/heads/dev $B9")"

echo
echo "── 關卡2 折面:新增行 / fail-closed / ledger 合法性 / hook 真的被 git 叫到 ──"

# ⑬ 只看**新增行**(關卡2 #3):base 那顆的 app 檔裡早就有那個函式名,這次只改無關的一行 ⇒ 不該擋
R10="$WORK/r10"; setup_repo "$R10"
cat > "$R10/apps/admin/src/consumer.ts" <<'TS'
export const legacy = 'pcm_a9h_probe';
export const other = 1;
TS
( cd "$R10" && git add -A && git commit -qm "base: 檔內早就有那個名字" )
add_pending_migration "$R10"
( cd "$R10" && sed -i '' 's/export const other = 1;/export const other = 2;/' apps/admin/src/consumer.ts && git add -A && git commit -qm "feat: 只改無關的一行" )
B10="$(cd "$R10" && git rev-parse HEAD~1)"; T10="$(cd "$R10" && git rev-parse HEAD)"
expect_pass "⑬只比新增行:檔內早有那個名字、這次只改無關一行 ⇒ 不誤擋" \
  "$(run_gate "$R10" "refs/heads/dev $T10 refs/heads/dev $B10")"

# ⑭ fail-closed(關卡2 #9):remote_sha 是個這個 repo 沒有的物件 ⇒ 不得靜默放行
FAKE="1111111111111111111111111111111111111111"
RES14="$(run_gate "$R" "refs/heads/dev $TIP refs/heads/dev $FAKE")"
case "${RES14%%|*}" in
  1) printf '%s' "${RES14#*|}" | grep -qF "fail-closed" \
       && ok "⑭fail-closed:算不出 diff(物件不在)⇒ 擋下並說明,不靜默放行" \
       || bad "⑭紅了但訊息不是 fail-closed 那條:$(printf '%s' "${RES14#*|}" | head -1)" ;;
  *) bad "⑭算不出 diff 卻 rc=${RES14%%|*} ⇒ 靜默放行(這正是關卡2 #9 講的洞)" ;;
esac

# ⑮ ledger 重複版本號(關卡2 #10):取第一列會讓結果取決於順序 ⇒ 拒絕猜
R11="$WORK/r11"; setup_repo "$R11"; add_pending_migration "$R11"
cp "$R/apps/admin/src/consumer.ts" "$R11/apps/admin/src/consumer.ts"
SHA11="$(shasum -a 256 "$R11/supabase/migrations/20260102000000_pending.sql" | cut -d' ' -f1)"
printf '20260102000000\t%s\t2026-01-02\tfixture\n20260102000000\tdeadbeef\t2026-01-02\tfixture\n' "$SHA11" >> "$R11/supabase/APPLIED.tsv"
( cd "$R11" && git add -A && git commit -qm "feat: ledger 有重複版本號" )
B11="$(cd "$R11" && git rev-parse HEAD~1)"; T11="$(cd "$R11" && git rev-parse HEAD)"
RES15="$(run_gate "$R11" "refs/heads/dev $T11 refs/heads/dev $B11")"
[ "${RES15%%|*}" = "1" ] && printf '%s' "${RES15#*|}" | grep -qF "重複的版本號" \
  && ok "⑮ledger 重複版本號 ⇒ 擋下並點名(不靠「取第一列」猜)" \
  || bad "⑮重複版本號沒被擋:rc=${RES15%%|*} $(printf '%s' "${RES15#*|}" | head -1)"

# ⑯ ledger 欄數壞掉 ⇒ sha 欄會變空、比對靜默失真
R12="$WORK/r12"; setup_repo "$R12"; add_pending_migration "$R12"
cp "$R/apps/admin/src/consumer.ts" "$R12/apps/admin/src/consumer.ts"
printf '20260102000000 只有一欄用空白分隔\n' >> "$R12/supabase/APPLIED.tsv"
( cd "$R12" && git add -A && git commit -qm "feat: ledger 欄數壞掉" )
B12="$(cd "$R12" && git rev-parse HEAD~1)"; T12="$(cd "$R12" && git rev-parse HEAD)"
RES16="$(run_gate "$R12" "refs/heads/dev $T12 refs/heads/dev $B12")"
[ "${RES16%%|*}" = "1" ] && printf '%s' "${RES16#*|}" | grep -qF "格式壞掉" \
  && ok "⑯ledger 欄數壞掉 ⇒ 擋下並點名(不讓 sha 欄靜默變空)" \
  || bad "⑯欄數壞掉沒被擋:rc=${RES16%%|*}"

# ⑰ **git 真的會叫 pre-push,而且非零退出真的擋得住 push**(關卡2 #11):
#    這一格不測本 repo 的 pnpm 那兩段(拋棄式 repo 沒有 node_modules),測的是「wiring 本身成立」——
#    hook 檔可執行 + git 真的執行它 + 它回非零時 push 真的被拒。
R13="$WORK/r13"; setup_repo "$R13"; add_pending_migration "$R13"
cp "$R/apps/admin/src/consumer.ts" "$R13/apps/admin/src/consumer.ts"
( cd "$R13" && git add -A && git commit -qm "feat: A9h 形狀" )
git init -q --bare "$WORK/remote.git"
printf '#!/bin/sh\nexec bash "$(git rev-parse --show-toplevel)/scripts/deploy-order-gate.sh"\n' > "$R13/.git/hooks/pre-push"
chmod +x "$R13/.git/hooks/pre-push"
PUSH_OUT="$(cd "$R13" && git remote add origin "$WORK/remote.git" 2>/dev/null; git push origin HEAD:refs/heads/dev 2>&1)"; PUSH_RC=$?
if [ "$PUSH_RC" != "0" ] && printf '%s' "$PUSH_OUT" | grep -qF "pcm_a9h_probe"; then
  ok "⑰真 push 被 pre-push 擋下(git 確實執行 hook、非零退出確實中止 push)"
else
  bad "⑰真 push 沒被擋:rc=$PUSH_RC $(printf '%s' "$PUSH_OUT" | tail -2 | tr '\n' ' ')"
fi

# ⑱ 本 repo 的 .husky/pre-push 形狀:可執行 + 三段以 && 串接 + 前兩段帶 TURBO_FORCE=1
#    🔴 #621(2026-08-17,codex 關卡2 must-fix):原本這一格 grep 的是
#    `pnpm typecheck && pnpm lint && bash` 那一整串字面,而 #621 在前兩段各加了 `TURBO_FORCE=1`
#    前綴 ⇒ 舊字面必然落空 ⇒ 這一格會變成【假紅】(它紅的是自己的判準過期,不是 hook 壞了)。
#    ⇒ 拆成三個各自說得出自己在守什麼的判準:typecheck 帶前綴 / lint 帶前綴 / 串得到 gate。
#    🔴 只看【非註解行】—— `.husky/pre-push` 的說明註解裡**就有** `TURBO_FORCE=1 pnpm typecheck`
#    這串字。若直接 grep 全檔,把最後那一行真命令整條刪掉,這一格照樣會綠 = 恆真的守門。
#    負向對照(2026-08-17 當場跑,兩個世界):拿掉前綴 ⇒ 本格 bad;裝回去 ⇒ 本格 ok。
HK="$(cd "$(dirname "$0")/.." && pwd)/.husky/pre-push"
HK_CMD="$(grep -v '^[[:space:]]*#' "$HK" 2>/dev/null | grep -v '^[[:space:]]*$')"
if [ -x "$HK" ] \
  && printf '%s\n' "$HK_CMD" | grep -q 'TURBO_FORCE=1 pnpm typecheck &&' \
  && printf '%s\n' "$HK_CMD" | grep -q 'TURBO_FORCE=1 pnpm lint &&' \
  && printf '%s\n' "$HK_CMD" | grep -q '&& bash'; then
  ok "⑱.husky/pre-push:可執行,三段 && 串接,前兩段帶 TURBO_FORCE=1(#621:少了它 turbo 會 replay 上一次的綠)"
else
  bad "⑱.husky/pre-push 形狀不對:可執行=$([ -x "$HK" ] && echo yes || echo no);非註解行=[$HK_CMD]"
fi

# ⑲ 抽取器的三種寫法(小寫 / `FUNCTION` 後換行才寫名字 / `IF NOT EXISTS`)——
#    真 migration 目前 0 次用到這三種(code-reviewer 對 160 支實查),但它們都是合法 SQL,
#    而抽不到 = 整道閘對那支 migration 靜默失效。⇒ 釘成格子,並由 M4 證明它有判別力。
R14="$WORK/r14"; setup_repo "$R14"
cat > "$R14/supabase/migrations/20260102000000_pending.sql" <<'SQL'
create or replace function if not exists
  public.pcm_lowercase_probe(p_x uuid) returns void language sql as $$ select 1 $$;
SQL
cat > "$R14/apps/admin/src/consumer.ts" <<'TS'
export const call = 'pcm_lowercase_probe';
TS
( cd "$R14" && git add -A && git commit -qm "feat: 小寫 + 換行 + IF NOT EXISTS 的 CREATE FUNCTION" )
B14="$(cd "$R14" && git rev-parse HEAD~1)"; T14="$(cd "$R14" && git rev-parse HEAD)"
expect_block "⑲抽取器覆蓋:小寫 create function + 名字在下一行 + IF NOT EXISTS ⇒ 仍抓得到" \
  "$(run_gate "$R14" "refs/heads/dev $T14 refs/heads/dev $B14")" "pcm_lowercase_probe"

# ⑳ ledger 也必須讀「要推的那顆」的樹(關卡2 R2 #4):HEAD 的 ledger 有那一行、要推的那顆沒有
#    ⇒ 讀 HEAD 會放行、讀 local_sha 會擋。這格是**唯一**能分辨這兩種實作的形狀。
R15="$WORK/r15"; setup_repo "$R15"; add_pending_migration "$R15"
cp "$R/apps/admin/src/consumer.ts" "$R15/apps/admin/src/consumer.ts"
( cd "$R15" && git add -A && git commit -qm "feat: 危險那顆(ledger 還沒有那一行)" )
DANGER15="$(cd "$R15" && git rev-parse HEAD)"
SHA15="$(shasum -a 256 "$R15/supabase/migrations/20260102000000_pending.sql" | cut -d' ' -f1)"
printf '20260102000000\t%s\t2026-01-02\tfixture\n' "$SHA15" >> "$R15/supabase/APPLIED.tsv"
( cd "$R15" && git add -A && git commit -qm "chore: 之後才補進 ledger(HEAD 有、要推那顆沒有)" )
B15="$(cd "$R15" && git rev-parse HEAD~2)"
expect_block "⑳ledger 來源:要推的那顆還沒進帳、HEAD 已進帳 ⇒ 必須擋(讀 HEAD 的實作會放行)" \
  "$(run_gate "$R15" "refs/heads/dev $DANGER15 refs/heads/dev $B15")" "pcm_a9h_probe"

# ㉑ local_sha 本身讀不到(關卡2 R2 #5:⑭ 只測了 remote base 讀不到)
RES21="$(run_gate "$R" "refs/heads/dev 2222222222222222222222222222222222222222 refs/heads/dev $BASE")"
[ "${RES21%%|*}" = "1" ] && printf '%s' "${RES21#*|}" | grep -qF "fail-closed" \
  && ok "㉑local_sha 讀不到 ⇒ fail-closed(不是靜默放行)" \
  || bad "㉑local_sha 讀不到卻 rc=${RES21%%|*}:$(printf '%s' "${RES21#*|}" | head -1)"

# ㉒ rename:把 *.test.ts 100% 改名成正式檔(-U0 下沒有 + hunk)⇒ 仍要擋
R16="$WORK/r16"; setup_repo "$R16"
cat > "$R16/apps/admin/src/consumer.test.ts" <<'TS'
export const call = 'pcm_a9h_probe';
TS
( cd "$R16" && git add -A && git commit -qm "base: 呼叫還在測試檔裡" )
add_pending_migration "$R16"
( cd "$R16" && git mv apps/admin/src/consumer.test.ts apps/admin/src/consumer.ts && git add -A && git commit -qm "feat: 把它改名成正式檔(100% rename)" )
B16="$(cd "$R16" && git rev-parse HEAD~1)"; T16="$(cd "$R16" && git rev-parse HEAD)"
expect_block "㉒100% rename(測試檔→正式檔)沒有 + hunk ⇒ 整檔掃才抓得到" \
  "$(run_gate "$R16" "refs/heads/dev $T16 refs/heads/dev $B16")" "pcm_a9h_probe"

# ㉓ husky wiring 的靜態事實(關卡2 R2 #6:⑰ 掛的是自製 hook,證不到本 repo 的 husky 接線)
HK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
HP="$(cd "$HK_DIR" && git config core.hooksPath 2>/dev/null || true)"
# 🔴 第一版這格用 `grep -q 'husky' .husky/_/pre-push` 當判準,而那支 shim 全文只有兩行、
#    根本沒有 `husky` 這個字 ⇒ 它紅的是**我的判準寫錯**,不是 wiring 壞掉(實跑當場抓到)。
#    真正的鏈是:core.hooksPath=.husky/_ → `_/pre-push` source `_/h` → `h` 算出上一層的同名檔並執行。
if [ "$HP" = ".husky/_" ] \
   && [ -f "$HK_DIR/.husky/_/pre-push" ] \
   && grep -q 'dirname "\$0"' "$HK_DIR/.husky/_/pre-push" \
   && grep -q 'dirname "\$(dirname "\$0")"' "$HK_DIR/.husky/_/h"; then
  ok "㉓husky wiring:core.hooksPath=.husky/_,shim 會回頭執行 .husky/pre-push(整條鏈逐檔實查)"
else
  bad "㉓husky wiring 不成立:core.hooksPath=[$HP];_/pre-push 存在=$([ -f "$HK_DIR/.husky/_/pre-push" ] && echo yes || echo no);_/h 存在=$([ -f "$HK_DIR/.husky/_/h" ] && echo yes || echo no)"
fi

echo
echo "── 突變(每發只讓對應那格翻紅;預期由實跑決定、不由推測填)──"

mutate_and_check() { # $1=名 $2=python 替換(old@@@new)$3=期望 block/pass $4=repo $5=stdin
  local R="$WORK/mut-$(printf '%s' "$1" | tr -cd 'A-Za-z0-9')"
  rm -rf "$R"; cp -R "$4" "$R"
  # 🔴 **突變沒套上就要當場紅**:第一版用 `sed -i ''`,pattern 不匹配時它照樣 exit 0
  #    ⇒ 那一格會印「拿掉之後仍擋」,而其實什麼都沒拿掉(本 harness 第一次實跑就中了這個)。
  if ! MUT="$2" python3 - "$R/scripts/deploy-order-gate.sh" <<'PYMUT'
import os,sys
spec=os.environ['MUT']; old,new=spec.split('@@@',1)
p=sys.argv[1]; s=open(p,encoding='utf-8').read()
if old not in s: sys.exit('突變錨點對不上')
open(p,'w',encoding='utf-8').write(s.replace(old,new,1))
PYMUT
  then bad "$1(突變沒套上 ⇒ 這格什麼都沒證明)"; return; fi
  local res; res="$(run_gate "$R" "$5")"; local rc="${res%%|*}"
  if [ "$3" = "pass" ]; then
    [ "$rc" = "0" ] && ok "$1 → 拿掉之後**不再擋**(證明那段是承重的)" || bad "$1 → 拿掉之後仍 rc=$rc ⇒ 那段不是唯一在守的東西"
  else
    [ "$rc" = "1" ] && ok "$1 → 拿掉之後**開始誤擋**(證明那段在防誤擋)" || bad "$1 → rc=$rc,拿掉它沒有任何可觀察的差別 ⇒ 那段沒有判別力"
  fi
}

mutate_and_check "M1 sha 比對改成「帳上有這一行就算數」" \
  '[ "$rec" = "$sha" ]@@@[ -n "$rec" ]' pass "$R5" "refs/heads/dev $T5 refs/heads/dev $B5"
mutate_and_check "M2 識別字邊界改成裸子字串比對" \
  'grep -qE "(^|[^A-Za-z0-9_])$fn([^A-Za-z0-9_]|\$)"@@@grep -qF "$fn"' block "$R9" "refs/heads/dev $T9 refs/heads/dev $B9"
mutate_and_check "M3 拿掉 app 面的測試檔過濾" \
  "| grep -vE '\\.(test|spec)\\.[jt]sx?\$|/__tests__/'@@@" block "$R8" "refs/heads/dev $T8 refs/heads/dev $B8"
# 🔴 code-reviewer nit:抽函式名與 app 面路徑範圍兩段承重邏輯原本零突變 ⇒ 補兩發。
mutate_and_check "M4 抽取器退回第一版(只認全大寫、同一行)" \
  "| tr '\\n' ' ' \\@@@| grep -v @@NEVER@@ \\" pass "$R14" "refs/heads/dev $T14 refs/heads/dev $B14"
R17="$WORK/r17"; setup_repo "$R17"; add_pending_migration "$R17"
mkdir -p "$R17/docs"
printf 'runbook: 記得跑 pcm_a9h_probe\n' > "$R17/docs/note.md"
( cd "$R17" && git add -A && git commit -qm "docs: 只有文件提到那個函式名" )
B17="$(cd "$R17" && git rev-parse HEAD~1)"; T17="$(cd "$R17" && git rev-parse HEAD)"
expect_pass "㉔只有 docs 提到函式名(零 app 變更)⇒ 放行" \
  "$(run_gate "$R17" "refs/heads/dev $T17 refs/heads/dev $B17")"
mutate_and_check "M5 拿掉 app 面路徑限定(-- apps packages)" \
  '-- apps packages@@@--' block "$R17" "refs/heads/dev $T17 refs/heads/dev $B17"
# ── 摘要行三世界(2026-08-18;V 窗提、主視窗立案)──────────────────────────
# 🔴 為什麼要【三個】世界而不是一個:只驗「通過時有印一行」的話,
#    一支**恆印同一句**的實作也會過 —— 那就是一道零判別力的守門。
#    三世界要求那一行的**內容由結果決定**:
#      A 通過(有 pending、沒東西該擋)  ⇒ 0 blocked
#      B 擋下(應用層用到未 apply 的函式) ⇒ 1 blocked（數字不同)
#      C 推的不是 dev/main              ⇒ 「未檢查任何 ref」（🔴 與 0 blocked 是兩件事:
#                                          印 0 blocked 會被讀成「檢查過而乾淨」)
R18="$WORK/r18"; setup_repo "$R18"; add_pending_migration "$R18"
( cd "$R18" && git add -A && git commit -qm "只有 pending migration" )
B18="$(cd "$R18" && git rev-parse HEAD~1)"; PASS18="$(cd "$R18" && git rev-parse HEAD)"
cp "$R/apps/admin/src/consumer.ts" "$R18/apps/admin/src/consumer.ts"
( cd "$R18" && git add -A && git commit -qm "應用層用到那支函式" )
BLOCK18="$(cd "$R18" && git rev-parse HEAD)"

sum_line() { printf '%s' "${1#*|}" | grep '^gate:' | tail -1; }
S_PASS="$(sum_line "$(run_gate "$R18" "refs/heads/dev $PASS18 refs/heads/dev $B18")")"
S_BLOCK="$(sum_line "$(run_gate "$R18" "refs/heads/dev $BLOCK18 refs/heads/dev $B18")")"
S_OTHER="$(sum_line "$(run_gate "$R18" "refs/heads/feature-x $BLOCK18 refs/heads/feature-x $B18")")"

case "$S_PASS" in
  *"0 blocked"*) ok "㉕摘要行·通過世界 ⇒ 印 0 blocked [$S_PASS]" ;;
  *) bad "㉕摘要行·通過世界 ⇒ 期望含 0 blocked,實際 [$S_PASS]" ;;
esac
case "$S_BLOCK" in
  *"1 blocked"*) ok "㉖摘要行·擋下世界 ⇒ 印 1 blocked [$S_BLOCK]" ;;
  *) bad "㉖摘要行·擋下世界 ⇒ 期望含 1 blocked,實際 [$S_BLOCK]" ;;
esac
case "$S_OTHER" in
  *"未檢查任何 ref"*) ok "㉗摘要行·非 dev/main ⇒ 印「未檢查任何 ref」而不是 0 blocked [$S_OTHER]" ;;
  *) bad "㉗摘要行·非 dev/main ⇒ 期望「未檢查任何 ref」,實際 [$S_OTHER]" ;;
esac
# 🔴 這一格才是真正在守「有判別力」:三句話必須互不相同。
#    少了它,上面三格可以被一支恆印 "gate: 0 blocked / 1 blocked / 未檢查任何 ref" 的實作同時滿足。
if [ "$S_PASS" != "$S_BLOCK" ] && [ "$S_BLOCK" != "$S_OTHER" ] && [ "$S_PASS" != "$S_OTHER" ]; then
  ok "㉘摘要行·三個世界三句話互不相同(內容由結果決定,不是恆印同一句)"
else
  bad "㉘摘要行·三世界有重複 ⇒ 那一行零判別力:A=[$S_PASS] B=[$S_BLOCK] C=[$S_OTHER]"
fi

echo
echo "══ 結果:PASS=$PASS FAIL=$FAIL(期望 PASS=$EXPECT_TOTAL)══"
if [ "$FAIL" -eq 0 ] && [ "$PASS" -ne "$EXPECT_TOTAL" ]; then
  echo "🔴 零 FAIL 但格數不對(PASS=$PASS ≠ EXPECT_TOTAL=$EXPECT_TOTAL)⇒ 有格被刪/被跳過,判為未通過"; exit 1
fi
[ "$FAIL" -eq 0 ] || exit 1
