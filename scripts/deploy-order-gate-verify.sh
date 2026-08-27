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

# ══════════════════════════════════════════════════════════════════════════════
# 🔴🔴 剝掉繼承來的 `GIT_*` —— **這一段是事故的修補,不是防禦性想像。**
#
# 2026-08-27:本檔在主樹上造出一顆 commit `4dc32874`(subject `base`),
#   **刪掉 502 個檔、加進 3 個**,而第三個正是本檔 `setup_repo` 造的 fixture
#   `supabase/migrations/20260101000000_base.sql` —— 那是指紋,不是巧合。
#
# 機制:git hook(pre-commit / pre-push)執行時會**匯出 `GIT_DIR` 與 `GIT_INDEX_FILE`**
#   (在 linked worktree 下是絕對路徑),而**不匯出 `GIT_WORK_TREE`**
#   ⇒ 本檔在拋棄式 repo 裡跑的 `git add -A` 會**寫進真 repo 的 index**,
#     而 `cwd` 是那個暫存 fixture 目錄 ⇒ **真 index 裡其他檔在那裡找不到 ⇒ 全部 stage 成刪除。**
#   ⇒ 而本檔照樣印「PASS=64」。**兩個世界印同一句話。**
#
# 🔴 **`git -C "$X"` 擋不住這個** —— `GIT_DIR` 是環境變數,它蓋過 cwd 與 `-C`。
#   唯一擋得住的是**把那些變數拿掉**。
# 🔴 **不要只 unset `GIT_DIR`** —— `GIT_WORK_TREE` 也會、而且更狠。
#   ⚠️ **而下面這兩個數字量的【不是本檔】**(code-reviewer 抓到我漏寫主詞):
#     `scripts/acl-drift-gate.py` 的自檢(總格 82)逐一注入 ⇒
#       `GIT_DIR` ⇒ 1 FAIL / `GIT_WORK_TREE` ⇒ **12 FAIL**(該檔 `:718` / `:722-723`)
#     **本檔沒有逐一注入量過**(本檔的驗收是「受害者 repo 的 index 有沒有被動」,見下)。
#   ⇒ 引用那兩個數字時要帶主詞,否則下一個人會讀成「在本檔量的」。
#
# 形狀取自 `scripts/board-state-consistency.py:565` 的 `_GIT_FREE_ENV`
#   (`not k.startswith('GIT_')`)—— **刻意取這個而不是 `acl-drift-gate.py:725` 那份 11 個變數的清單**:
#   前者涵蓋**所有** `GIT_*`(含還沒有人列出來的),後者的分母是「列表的人想得到的那些」。
#   ⚠️ **差異寫出來**:那份 11 個的清單會**留下** `GIT_AUTHOR_*` / `GIT_COMMITTER_*`(它另外補回去),
#   本檔全剝 —— 而本檔的拋棄式 repo 各自 `git config user.email/name`,不靠那兩個變數。
# ══════════════════════════════════════════════════════════════════════════════
_pcm_git_env_isolate() {
  local _v
  for _v in $(env | sed -n 's/^\(GIT_[A-Za-z0-9_]*\)=.*/\1/p'); do unset "$_v"; done
}
_pcm_git_env_isolate

GATE_SRC="$(cd "$(dirname "$0")" && pwd)/deploy-order-gate.sh"
test -f "$GATE_SRC" || { echo "🔴 找不到 $GATE_SRC"; exit 1; }

# 🔴 量出來的,不是估的(每加/刪一格必同步改;數法=腳本尾端印的 PASS=)
EXPECT_TOTAL=65

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }

# 🔴 `|| exit` 少不得(2026-08-27,`b4` 點名 + 本窗實測):`set -uo pipefail` **沒有 `-e`**
#   ⇒ `mktemp` 失敗時這一行【不會停】, `WORK` 變空字串, 而 `set -u` 也擋不住它(它有值, 只是空的)。
#   ⚠️ **而它接下來會怎樣, 取決於一件與設計無關的事** ——
#     本檔所有路徑都是 `"$WORK/rN"` 形式 ⇒ `WORK=""` 時它是 `/r1` **不是空字串**
#     ⇒ `cd "/r1"` 在 macOS 上失敗(唯讀根)⇒ `&&` 真的擋住了。**實測:受害者 repo 2 → 2 檔、零新 commit。**
#     🔴 **那是後綴救的, 不是任何人寫的守門救的** —— 而下一個人只要寫一次 `cd "$WORK"`(沒有後綴),
#       那條路就開了:`cd ""` 在 bash 是【成功且原地不動】。
#   ⇒ 所以這裡 fail-closed:**不靠後綴, 靠停下來。**
#   📌 而它現在的症狀也是壞的:80 幾格全部在 `/r1` 上失敗、印一大堆 `Read-only file system`,
#     最後 `PASS=` 是一個【沒有意義的數字】—— 而那個數字看起來像「有幾格沒過」。
if ! WORK="$(mktemp -d "${TMPDIR:-/tmp}/dog-verify.XXXXXX")" || [ -z "$WORK" ] || [ ! -d "$WORK" ]; then
  printf '%s\n' "🔴 mktemp -d 失敗(或回了空值)⇒ 不往下跑。本檔的每一格都要一個拋棄式目錄。" >&2
  exit 2
fi
# 🔴🔴 **這裡【刻意不做】一件看起來該做的事,寫下來免得下一個人再試一次:**
#   code-reviewer 建議加第二層防線 `cd "$WORK"` —— 理由是對的(剝掉 `GIT_DIR` 之後
#   git 改成**從 cwd 往上找 repo**,而本檔被 hook 叫起來時 cwd 就是主樹頂)。
#   ⚠️ **而我加了之後實跑:PASS 64→63、FAIL 0→2** ——
#     紅的是格 ⑱ 與 ㉓,它們查的是 `.husky/pre-push` 與 `core.hooksPath`,
#     **那兩格【需要】cwd 在 repo 裡**。⇒ 那不是「把原本被遮住的紅露出來」,是我弄壞的。
#   ⇒ 這條路要走的話,得先讓那兩格改用絕對路徑,而那是另一片。
#   📌 **一個看起來明顯正確的加固,和它會弄壞什麼,是兩個問題。**
# 🔴 trap 也守一下:`WORK` 空的時候 `rm -rf ""` 雖然無害, 而【看起來像它清乾淨了】。
trap '[ -n "${WORK:-}" ] && rm -rf "$WORK"' EXIT

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
const FN = 'pcm_a9h_probe';   // 🔴 整串字面 —— 新判準看得見的形狀(見上方 A-bc 說明)
it('calls it', () => {});
TS
( cd "$R8" && git add -A && git commit -qm "test: 只有測試檔提到那個函式名" )
B8="$(cd "$R8" && git rev-parse HEAD~1)"; T8="$(cd "$R8" && git rev-parse HEAD)"
# 🔴 M3 的「有保護那一側」由本格承擔;動本格前先看 M3(關聯住在這一行,不住在 code 裡)。
expect_pass "⑪測試檔不算 app 面:只有 *.test.ts 提到函式名 ⇒ 放行" \
  "$(run_gate "$R8" "refs/heads/dev $T8 refs/heads/dev $B8")"

R9="$WORK/r9"; setup_repo "$R9"; add_pending_migration "$R9"
cat > "$R9/apps/admin/src/consumer.ts" <<'TS'
export const x = 'pcm_a9h_probe_v2';
TS
( cd "$R9" && git add -A && git commit -qm "feat: app 用的是更長的相似名字" )
B9="$(cd "$R9" && git rev-parse HEAD~1)"; T9="$(cd "$R9" && git rev-parse HEAD)"
# 🔴 M2 的「有保護那一側」由本格承擔;動本格前先看 M2。
expect_pass "⑫識別字邊界:pcm_a9h_probe_v2 不是 pcm_a9h_probe ⇒ 不誤擋" \
  "$(run_gate "$R9" "refs/heads/dev $T9 refs/heads/dev $B9")"

# 🔴 ⑫b(2026-08-21 線D `-4a` 補):**⑫ 走的是 4b(引號邊界),4a(`.rpc(` 呼叫窗口的識別字邊界)零覆蓋。**
#    實測證據(補格子之前先構造一發它現在漏得掉的):
#      原始閘 + 本 fixture ⇒ rc=0    4a 邊界拿掉 + 本 fixture ⇒ rc=1(開始誤擋)
#      原始閘 + ⑫ fixture ⇒ rc=0    4a 邊界拿掉 + ⑫ fixture ⇒ rc=0(**沒變**)
#    ⇒ 🔴 最後那一格才是本格存在的理由:**⑫ 對 4a 的突變是啞的** ——
#      少了本格,4a 那條邊界在整份 harness 裡沒有任何一發證明過它有判別力。
#    差別在哪:⑫ 的 fixture 沒有 `.rpc(`,它走 4b;本 fixture 有 `.rpc(`,它走 4a。
R9B="$WORK/r9b"; setup_repo "$R9B"; add_pending_migration "$R9B"
cat > "$R9B/apps/admin/src/consumer.ts" <<'TS'
export async function callIt(sb: any) {
  return await sb.rpc('pcm_a9h_probe_v2', { p_order_id: 'x' });
}
TS
( cd "$R9B" && git add -A && git commit -qm "feat: 呼叫的是更長的相似名字(走 .rpc 窗口)" )
B9B="$(cd "$R9B" && git rev-parse HEAD~1)"; T9B="$(cd "$R9B" && git rev-parse HEAD)"
# 🔴 M2b 的「有保護那一側」由本格承擔;動本格前先看 M2b。
expect_pass "⑫b 4a 呼叫窗口的識別字邊界:.rpc('pcm_a9h_probe_v2') 不是 pcm_a9h_probe ⇒ 不誤擋" \
  "$(run_gate "$R9B" "refs/heads/dev $T9B refs/heads/dev $B9B")"

# 🔴 ⑫c(2026-08-21 線D `-4a` 補):第三條路 **4b-ii(識別字解析出來的名字)** 的整行邊界(`grep -qxF` 的 `-x`)零覆蓋。
#    實測(補格子之前先構造一發它現在漏得掉的):
#      原始閘 + 本 fixture ⇒ rc=0    拿掉 `-x` + 本 fixture ⇒ rc=1(開始誤擋)
#      原始閘 + ⑫ fixture ⇒ rc=0    拿掉 `-x` + ⑫ fixture ⇒ rc=0(**沒變**)
#    🔴 三條路各走各的,而它們的邊界寫法**都不一樣**:
#      4a  字元類邊界 `(^|[^A-Za-z0-9_])…`   ⇒ ⑫b / M2b
#      4b-i 引號邊界  `['\"]…['\"]`           ⇒ ⑫  / M2
#      4b-ii 整行相等 `grep -qxF`             ⇒ 本格 / M2c
#    ⇒ **一條路的突變證不到另外兩條** —— 這正是 M2 當初被從 4a 改錨到 4b 時漏掉的那件事。
#    本 fixture 走 4b-ii 的機械理由:常數定義在【這次沒被改動的檔】⇒ 新增行裡沒有任何函式名字面
#    ⇒ 4a(呼叫窗口無字面)與 4b-i(無引號包住的整串)都不會命中,只剩識別字解析那條。
R9C="$WORK/r9c"; setup_repo "$R9C"
cat > "$R9C/apps/admin/src/fn-names.ts" <<'TS'
export const PROBE_FN = 'pcm_a9h_probe_v2';
TS
( cd "$R9C" && git add -A && git commit -qm "base: 常數表(這次不會被改)" )
add_pending_migration "$R9C"
cat > "$R9C/apps/admin/src/consumer.ts" <<'TS'
import { PROBE_FN } from './fn-names';
export async function callIt(sb: any) {
  return await sb.rpc(PROBE_FN, { p_order_id: 'x' });
}
TS
( cd "$R9C" && git add -A && git commit -qm "feat: 識別字風格呼叫,解析出的是更長的相似名字" )
B9C="$(cd "$R9C" && git rev-parse HEAD~1)"; T9C="$(cd "$R9C" && git rev-parse HEAD)"
# 🔴 M2c 的「有保護那一側」由本格承擔;動本格前先看 M2c。
expect_pass "⑫c 4b-ii 識別字解析的整行邊界:解析出 pcm_a9h_probe_v2 不是 pcm_a9h_probe ⇒ 不誤擋" \
  "$(run_gate "$R9C" "refs/heads/dev $T9C refs/heads/dev $B9C")"

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

# 🔴 ⑭b / ⑭c(2026-08-21 線D `-4a` 補):**第三條 fail-closed 路 —— 識別字解析不出來**。
#    ⑭ 守的是「算不出 diff」、㉑ 守的是「local_sha 讀不到」,而
#    `.rpc(SOME_IDENT, …)` 而常數解析不出來時的「**擋,不放行**」那一格**整份 harness 零覆蓋**。
#    🔴 為什麼它值得一格:把「認不出的識別字」改成靜靜跳過,**讀起來像在降噪**
#      (「解析不到就別亂報」),而它會讓整道閘對識別字風格的呼叫**安靜地失效**。
#      那個改動不會讓任何一格紅 —— 除非有這一格。
#    ⑭c 是 ⑭b 的對照:**同一份 code、只差有沒有 pending migration** ⇒ 證明它不是無條件擋。
R19="$WORK/r19"; setup_repo "$R19"
cat > "$R19/apps/admin/src/fn-names.ts" <<'TS'
export const FN_FROM_CONFIG = process.env.PCM_FN ?? 'pcm_fallback_name';
TS
( cd "$R19" && git add -A && git commit -qm "base: 常數不是單純的字串字面(解析器認不出)" )
add_pending_migration "$R19"
cat > "$R19/apps/admin/src/consumer.ts" <<'TS'
import { FN_FROM_CONFIG } from './fn-names';
export async function callIt(sb: any) {
  return await sb.rpc(FN_FROM_CONFIG, { p_order_id: 'x' });
}
TS
( cd "$R19" && git add -A && git commit -qm "feat: 識別字風格呼叫,而常數解析不出來" )
B19="$(cd "$R19" && git rev-parse HEAD~1)"; T19="$(cd "$R19" && git rev-parse HEAD)"
# 🔴 M6 的「有保護那一側」由本格承擔;動本格前先看 M6。
expect_block "⑭b fail-closed:.rpc(識別字) 而常數解析不出來 + 有 pending ⇒ 擋,不靜默放行" \
  "$(run_gate "$R19" "refs/heads/dev $T19 refs/heads/dev $B19")" "FN_FROM_CONFIG"

# ⑭c 對照世界:一模一樣的 code,只差【沒有 pending migration】⇒ 必須放行
R19C="$WORK/r19c"; setup_repo "$R19C"
cp "$R19/apps/admin/src/fn-names.ts" "$R19C/apps/admin/src/fn-names.ts"
( cd "$R19C" && git add -A && git commit -qm "base: 同一份常數" )
cp "$R19/apps/admin/src/consumer.ts" "$R19C/apps/admin/src/consumer.ts"
( cd "$R19C" && git add -A && git commit -qm "feat: 同一份呼叫,但這次沒有 pending migration" )
B19C="$(cd "$R19C" && git rev-parse HEAD~1)"; T19C="$(cd "$R19C" && git rev-parse HEAD)"
expect_pass "⑭c 對照:同一份 code、無 pending migration ⇒ 放行(證明 ⑭b 不是無條件擋)" \
  "$(run_gate "$R19C" "refs/heads/dev $T19C refs/heads/dev $B19C")"

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
# 🔴 2026-08-21 修(W5;codex R2 順手抓到本格是紅的):`git config core.hooksPath` 回的是
#    **相對或絕對,取決於 husky 是哪一版寫進去的** —— 當下實測回的是
#    `/Users/sean_1/pcm-website-v2/.husky/_`,而本格寫死相對字面 `.husky/_` ⇒ 恆紅。
#    ⇒ 那是**判準字面過期,不是 wiring 壞掉**(同一個病的第二次:第一版是 grep 錯字面)。
#    修法**兩種都吃**,不是改成寫死絕對 —— 那只是把過期換一個方向。
HP_REL="${HP#"$HK_DIR"/}"
if { [ "$HP_REL" = ".husky/_" ] || [ "$HP" = ".husky/_" ]; } \
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

# ══════════════════════════════════════════════════════════════════════════
# 🔴🔴 2026-08-21 A-bc:**下面 M2 / M3 / M5 三格的 fixture 被作者本人改過。**
#     主視窗 `-72` 拍板批准,並主動向 Sean 報備「今晚有一次【動到驗證本身】由它拍板」。
#
# **為什麼會需要改**:同一批把閘的判準從「新增行裡出現函式名」收緊成
#   「在 `.rpc(` 呼叫窗口裡」+「整串等於函式名的字串字面」。
#   那三格原本餵的是**裸提及**的形狀(`it('calls fn', …)` / `runbook: 記得跑 fn`),
#   新判準看不見它們 ⇒ **拿掉保護也不會紅** ⇒ 三格失去判別力。
#   ⇒ 保護本身(測試檔過濾 / 路徑限定 / 識別字邊界)**一段都沒動**。
#
# **改了什麼、沒改什麼**:
#   改了 fixture 的【形狀】與 M2 的【突變錨點】;**期望值一個字都沒改**(仍是 block / pass)。
#
# 🔴 **殘餘風險(作者逐字自陳,刻意留在檔案裡而不是只留在訊息裡)**:
#   「改完之後,那三格證明的是【新形狀下】保護有效,不再證明【舊形狀下】保護有效 ——
#     而舊形狀(裸提及)現在本來就不該擋。**這個轉變是刻意的,不是被我藏掉的。**」
#
# 📌 主視窗拍板時給的判準,寫在這裡當下次的參照:
#   **不是「有沒有動測試」,是「動完之後它還分不分得開兩個世界」。**
#   三格改完各自實測:有保護 ⇒ rc=0 / 拿掉保護 ⇒ rc=1(輸出見交件 `A-bc-007`)。
# ══════════════════════════════════════════════════════════════════════════
mutate_and_check "M1 sha 比對改成「帳上有這一行就算數」" \
  '[ "$rec" = "$sha" ]@@@[ -n "$rec" ]' pass "$R5" "refs/heads/dev $T5 refs/heads/dev $B5"
# 🔴 A-bc:突變錨點從 4a(呼叫窗口的識別字邊界)改指 **4b 的引號邊界** ——
#    R9 的 fixture(`export const x = 'pcm_a9h_probe_v2';`)沒有 `.rpc(`,它走的是 4b 那條路。
#    錨在 4a 的話,拿掉它對這個 fixture 沒有任何可觀察的差別 ⇒ 那一發什麼都證明不了。
# 🔴 本發的「有保護那一側」是 ⑫;動 ⑫ 會讓本發失去對照(它就不再是一對兩個世界)。
mutate_and_check "M2 識別字邊界改成裸子字串比對" \
  $'grep -qE "[\'\\"]$fn[\'\\"]"@@@grep -qF "$fn"' block "$R9" "refs/heads/dev $T9 refs/heads/dev $B9"
# 🔴 M2b(2026-08-21 線D `-4a` 補):M2 打的是 **4b 的引號邊界**,4a 那條零突變。
#    ⚠️ 兩發**不是重複**:同一發突變對兩個 fixture 的結果不同(⑫ rc 不變 / ⑫b rc 0→1),
#      而那個「不同」就是它們各自量到不同東西的機械證據。
# 🔴 本發的「有保護那一側」是 ⑫b;動 ⑫b 會讓本發失去對照。
mutate_and_check "M2b 4a 呼叫窗口的識別字邊界改成裸子字串比對" \
  'grep -qE "(^|[^A-Za-z0-9_])$fn([^A-Za-z0-9_]|\$)"@@@grep -qF "$fn"' block "$R9B" "refs/heads/dev $T9B refs/heads/dev $B9B"
# 🔴 M2c(2026-08-21 線D `-4a` 補):打 4b-ii 的整行邊界(`-x`)。
#    ⚠️ **3x3 實測矩陣(2026-08-21,列=fixture、欄=突變;rc)**:
#             原始  M2   M2b  M2c
#      ⑫       0    1    0    0
#      ⑫b      0    1    1    0        ← 🔴 M2 **也**翻得動 ⑫b
#      ⑫c      0    0    0    1
#    🔴 **所以「三發互不重複」是假的,不要那樣寫**(我第一版就是那樣寫的,量完才發現):
#       M2 同時翻 ⑫ 與 ⑫b —— 因為拿掉引號邊界之後它退化成裸子字串,對兩個 fixture 都命中。
#    ✅ **而真正成立、也真正是加這兩格的理由的,是【欄】方向**:
#       M2b 那一欄只有 ⑫b 是 1、M2c 那一欄只有 ⑫c 是 1
#       ⇒ **這兩發突變,除了它們自己那一格以外沒有任何格抓得到** ⇒ 少了它們就是零覆蓋。
#    📌 判別句:證明一格「有必要」要看**它是不是某個突變的唯一捕手**,不是看「它跟別人不重複」。
# 🔴 本發的「有保護那一側」是 ⑫c;動 ⑫c 會讓本發失去對照。
#    📌 錨點刻意縮短成不含單引號的那一段(`grep -qxF "$fn"`)——
#       第一版把整條 printf 抄進來,而它含單引號 ⇒ **整支 harness 當場 syntax error**(實跑抓到)。
#       縮短是安全的,理由是量過的:`grep -cF 'grep -qxF "$fn"' scripts/deploy-order-gate.sh` ⇒ 1(唯一)。
mutate_and_check "M2c 4b-ii 識別字解析改成裸子字串比對(拿掉整行相等)" \
  'grep -qxF "$fn"@@@grep -qF "$fn"' block "$R9C" "refs/heads/dev $T9C refs/heads/dev $B9C"
# 🔴 本發的「有保護那一側」是 ⑪;動 ⑪ 會讓本發失去對照。
mutate_and_check "M3 拿掉 app 面的測試檔過濾" \
  "| grep -vE '\\.(test|spec)\\.[jt]sx?\$|/__tests__/'@@@" block "$R8" "refs/heads/dev $T8 refs/heads/dev $B8"
# 🔴 code-reviewer nit:抽函式名與 app 面路徑範圍兩段承重邏輯原本零突變 ⇒ 補兩發。
mutate_and_check "M4 抽取器退回第一版(只認全大寫、同一行)" \
  "| tr '\\n' ' ' \\@@@| grep -v @@NEVER@@ \\" pass "$R14" "refs/heads/dev $T14 refs/heads/dev $B14"
R17="$WORK/r17"; setup_repo "$R17"; add_pending_migration "$R17"
mkdir -p "$R17/docs"
# 🔴 帶引號的整串字面 —— 新判準看得見的形狀(見上方 A-bc 說明);㉔ 仍靠「docs 不在掃描路徑裡」放行
printf "runbook: 呼叫 'pcm_a9h_probe'\n" > "$R17/docs/note.md"
( cd "$R17" && git add -A && git commit -qm "docs: 只有文件提到那個函式名" )
B17="$(cd "$R17" && git rev-parse HEAD~1)"; T17="$(cd "$R17" && git rev-parse HEAD)"
# 🔴 M5 的「有保護那一側」由本格承擔;動本格前先看 M5。
expect_pass "㉔只有 docs 提到函式名(零 app 變更)⇒ 放行" \
  "$(run_gate "$R17" "refs/heads/dev $T17 refs/heads/dev $B17")"
# 🔴 本發的「有保護那一側」是 ㉔;動 ㉔ 會讓本發失去對照。
mutate_and_check "M5 拿掉 app 面路徑限定(-- apps packages)" \
  '-- apps packages@@@--' block "$R17" "refs/heads/dev $T17 refs/heads/dev $B17"
# 🔴 M6(2026-08-21 線D `-4a` 補):把「認不出的識別字」改成**靜靜跳過**——
#    也就是那個「看起來像降噪」的改法。期望 pass = 拿掉之後**不再擋** ⇒ 證明那一格是承重的。
# 🔴 本發的「有保護那一側」是 ⑭b;動 ⑭b 會讓本發失去對照。
mutate_and_check "M6 解析不到的識別字改成靜靜跳過(拿掉 fail-closed)" \
  'UNRESOLVED="$UNRESOLVED $id"@@@:' pass "$R19" "refs/heads/dev $T19 refs/heads/dev $B19"
echo
echo "── 呼叫上下文(2026-08-21 A-bc;審查線 -04 量的兩個方向)────────────────"
# 🔴 2026-08-21 線D `-4a`:下面三格的標籤原本帶反引號(`` .rpc(IDENT, …) `` 等)。
#    **雙引號內的反引號會被 shell 當命令替換執行** ⇒ 實跑時噴 `syntax error`,
#    而印出來的標籤**掉了那一段、句子還讀得通**(「②漏擋面· 識別字風格 ⇒ 必須擋」)。
#    ⇒ 那是 CLAUDE.md 明文的 zsh/bash 禁忌,而它在這裡讓**守門自己的標籤說謊**。
#    ⇒ 改成不帶反引號的寫法。**期望值與 fixture 一個字都沒動,只動標籤字面。**
# 🔴 這一組的來源:原本的比對是「新增行裡出現函式名的完整識別字」⇒ **不管那一行是不是在呼叫**。
#    -04 量到兩個方向都壞:
#      誤擋 817 個提及裡只有 30 個真的是呼叫 ⇒ 每 27 次命中只對 1 次
#      漏擋 7/35 的既有呼叫是識別字風格(`.rpc(SOME_FN, …)`)⇒ 20% 對這道閘隱形
#    ⇒ 判準改成「**在 `.rpc(` 的呼叫窗口裡**」,而識別字要回頭解析。

# ①a/①b/①c 誤擋面:三種「提到但不是呼叫」的形狀,都必須放行
R30="$WORK/r30"; setup_repo "$R30"; add_pending_migration "$R30"
cat > "$R30/apps/admin/src/consumer.ts" <<'TS'
// 見 pcm_a9h_probe 的說明
export const a = 1;
TS
( cd "$R30" && git add -A && git commit -qm "docs: 行註解提到函式名" )
B30="$(cd "$R30" && git rev-parse HEAD~1)"; T30="$(cd "$R30" && git rev-parse HEAD)"
expect_pass "①a 誤擋面·行註解提到函式名 ⇒ 放行" \
  "$(run_gate "$R30" "refs/heads/dev $T30 refs/heads/dev $B30")"

R31="$WORK/r31"; setup_repo "$R31"; add_pending_migration "$R31"
cat > "$R31/apps/admin/src/consumer.ts" <<'TS'
/**
 *    pcm_a9h_probe: 品項數量超出範圍
 */
export const b = 1;
TS
( cd "$R31" && git add -A && git commit -qm "docs: JSDoc 提到函式名" )
B31="$(cd "$R31" && git rev-parse HEAD~1)"; T31="$(cd "$R31" && git rev-parse HEAD)"
expect_pass "①b 誤擋面·JSDoc 星號行提到函式名 ⇒ 放行" \
  "$(run_gate "$R31" "refs/heads/dev $T31 refs/heads/dev $B31")"

# 🔴 ①c 是三發裡最不能漏的:**剝註解救不了它,它在字串裡。**
R32="$WORK/r32"; setup_repo "$R32"; add_pending_migration "$R32"
cat > "$R32/apps/admin/src/consumer.ts" <<'TS'
export const err = { msg: '請洽管理員 pcm_a9h_probe' };
TS
( cd "$R32" && git add -A && git commit -qm "feat: 錯誤訊息字串裡有函式名" )
B32="$(cd "$R32" && git rev-parse HEAD~1)"; T32="$(cd "$R32" && git rev-parse HEAD)"
expect_pass "①c 誤擋面·**字串字面**裡有函式名(剝註解救不了)⇒ 放行" \
  "$(run_gate "$R32" "refs/heads/dev $T32 refs/heads/dev $B32")"

# ② 漏擋面:識別字風格的呼叫。常數住在【這次沒被改動的檔】⇒ 新增行只有呼叫那一行
R33="$WORK/r33"; setup_repo "$R33"
cat > "$R33/apps/admin/src/fn-names.ts" <<'TS'
export const PROBE_FN = 'pcm_a9h_probe';
TS
( cd "$R33" && git add -A && git commit -qm "base: 常數表(這次不會被改)" )
add_pending_migration "$R33"
cat > "$R33/apps/admin/src/consumer.ts" <<'TS'
import { PROBE_FN } from './fn-names';
export async function callIt(sb: any) {
  return await sb.rpc(PROBE_FN, { p_order_id: 'x', p_note: 'y' });
}
TS
( cd "$R33" && git add -A && git commit -qm "feat: 識別字風格呼叫" )
B33="$(cd "$R33" && git rev-parse HEAD~1)"; T33="$(cd "$R33" && git rev-parse HEAD)"
expect_block "②漏擋面·rpc(IDENT, …) 識別字風格 ⇒ 必須擋(常數定義在未改動的檔)" \
  "$(run_gate "$R33" "refs/heads/dev $T33 refs/heads/dev $B33")" "pcm_a9h_probe"

# ③ 回歸:最普通的字串字面呼叫,改完必須維持擋
R34="$WORK/r34"; setup_repo "$R34"; add_pending_migration "$R34"
cat > "$R34/apps/admin/src/consumer.ts" <<'TS'
export async function callIt(sb: any) {
  return await sb.rpc('pcm_a9h_probe', { p_order_id: 'x' });
}
TS
( cd "$R34" && git add -A && git commit -qm "feat: 字面呼叫" )
B34="$(cd "$R34" && git rev-parse HEAD~1)"; T34="$(cd "$R34" && git rev-parse HEAD)"
expect_block "③回歸·rpc(fn, …) 字面呼叫 ⇒ 維持擋" \
  "$(run_gate "$R34" "refs/heads/dev $T34 refs/heads/dev $B34")" "pcm_a9h_probe"

# ⑤ 跨行呼叫:函式名在 `.rpc(` 的【下一行】
R35="$WORK/r35"; setup_repo "$R35"; add_pending_migration "$R35"
cat > "$R35/apps/admin/src/consumer.ts" <<'TS'
export async function callIt(sb: any) {
  const { data, error } = await sb.rpc(
    'pcm_a9h_probe',
    { p_order_id: 'x' }
  );
  return { data, error };
}
TS
( cd "$R35" && git add -A && git commit -qm "feat: 跨行呼叫" )
B35="$(cd "$R35" && git rev-parse HEAD~1)"; T35="$(cd "$R35" && git rev-parse HEAD)"
expect_block "⑤跨行呼叫·函式名在 rpc( 的下一行 ⇒ 維持擋" \
  "$(run_gate "$R35" "refs/heads/dev $T35 refs/heads/dev $B35")" "pcm_a9h_probe"

# 🔴🔴 ④ 不可省的負對照:餵一個【不在 FN_LIST 裡】的函式名,上面三種形狀都必須放行。
#    **為什麼修的人會想砍掉它**:它看起來像在測一個不會發生的情況。
#    而它擋的是最貴的失敗:比對整條壞掉 ⇒ 全部變綠 ⇒ **這道閘從此不存在,而沒有人會發現**,
#    因為它的正常狀態本來就是綠的。
for shape in literal ident multiline; do
  RN="$WORK/r36-$shape"; setup_repo "$RN"
  cat > "$RN/apps/admin/src/fn-names.ts" <<'TS'
export const OTHER_FN = 'some_other_function';
TS
  ( cd "$RN" && git add -A && git commit -qm "base" )
  add_pending_migration "$RN"
  case "$shape" in
    literal)   printf 'export async function c(sb: any) {\n  return await sb.rpc("some_other_function", {});\n}\n' > "$RN/apps/admin/src/consumer.ts" ;;
    ident)     printf "import { OTHER_FN } from './fn-names';\nexport async function c(sb: any) {\n  return await sb.rpc(OTHER_FN, {});\n}\n" > "$RN/apps/admin/src/consumer.ts" ;;
    multiline) printf 'export async function c(sb: any) {\n  return await sb.rpc(\n    "some_other_function",\n    {}\n  );\n}\n' > "$RN/apps/admin/src/consumer.ts" ;;
  esac
  ( cd "$RN" && git add -A && git commit -qm "feat: 呼叫一支不在 pending 清單裡的函式" )
  BN="$(cd "$RN" && git rev-parse HEAD~1)"; TN="$(cd "$RN" && git rev-parse HEAD)"
  expect_pass "④不在 FN_LIST 的名字·$shape ⇒ 放行(比對整條壞掉時這格會紅)" \
    "$(run_gate "$RN" "refs/heads/dev $TN refs/heads/dev $BN")"
done

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

# ════════════════════════════════════════════════════════════════════════
# view 那條路(2026-08-24 放寬新增;2026-08-24 線3 補格)
# ════════════════════════════════════════════════════════════════════════
# 🔴 **為什麼補這六格**:放寬那筆改動加了 `view_names_of` / `VIEW_LIST` / `.from(` 那整條路,
#    而本 harness 對它**零覆蓋**且照樣回報 52/52 PASS。當場量到的分母:
#      本檔 `view_names_of|VIEW_LIST|\.from\(` ⇒ **0 命中**
#      正對照 `fn_names_of|FN_LIST|\.rpc\(` ⇒ **23 命中**(尺是活的)
#      本檔字串 `view` 出現 4 次、`reviewer` 也 4 次 ⇒ **差 0 ⇒ 每一個 view 都在 reviewer 裡面**
#    ⇒ 那是「守門存在 ≠ 守門被測到」的標準形狀:**新路徑上線而 harness 的綠色一個字都沒變。**
#
# 🔴 **這六格自己有判別力嗎 —— 量過**(2026-08-24,拿 `git show HEAD:` 的【未放寬】舊閘當對照組):
#      放寬後的閘  ⇒ 6/6 PASS
#      未放寬的舊閘 ⇒ **恰好 ①⑤⑥(三格該紅)全部 rc=0 漏擋**,②③④(該綠)仍綠
#    ⇒ **極性正確**:紅的來源就是這次放寬,不是別的。
# ⚠️ 三格該紅一律**加驗訊息點名 `view [<名>]`** —— rc=1 有很多來源,
#    而「擋下來了」與「紅錯地方」的 rc 是同一個。
setup_view_repo() { # $1=repo
  setup_repo "$1"
  mkdir -p "$1/packages/adapters/src/supabase"
}
# 🔴 **2026-08-24 codex must-fix:`CREATE OR REPLACE MATERIALIZED VIEW` 不是合法 PostgreSQL。**
#    第一版把 `MATERIALIZED ` 塞進 `OR REPLACE` 那個模板 ⇒ 測資本身是壞 SQL,
#    閘因為**文字命中**而紅 ⇒ 那一格證明的是「它會 grep」,**不是「合法 materialized view 抽得到名字」**。
#    ⇒ 兩種形狀分開產:一般 view 走 `CREATE OR REPLACE VIEW`,materialized 走 `CREATE MATERIALIZED VIEW`。
add_view_migration() { # $1=repo
  printf 'CREATE OR REPLACE VIEW public.pcm_probe_v AS SELECT 1 AS x;\n' \
    > "$1/supabase/migrations/20260102000000_pending.sql"
}
add_matview_migration() { # $1=repo
  printf 'CREATE MATERIALIZED VIEW public.pcm_probe_v AS SELECT 1 AS x;\n' \
    > "$1/supabase/migrations/20260102000000_pending.sql"
}
# 造一次推送:$1=repo → 印 "rc|輸出"
view_push() { # $1=repo
  local base tip
  base="$(cd "$1" && git rev-parse HEAD)"
  ( cd "$1" && git add -A && git commit -qm w >/dev/null )
  tip="$(cd "$1" && git rev-parse HEAD)"
  run_gate "$1" "refs/heads/dev $tip refs/heads/dev $base"
}

# ════════════════════════════════════════════════════════════════════════
# 🔴🔴 **已【實測確認】而本 harness 沒有格在守的四個洞(2026-08-24 codex 對抗審查)**
#    寫在這裡是因為:**它們是真的,而下面六格全綠** —— 不寫,下一個人會把 58/58 讀成「這條路是安全的」。
#    每一條都附可複跑的測資(拋棄式 repo,正對照=正常 view+讀 ⇒ 擋、負對照=無關改動 ⇒ 放行,兩發都活)。
#    ✅ **2026-08-24 主視窗裁「③⑤ 誤擋最急,你修;①② 漏擋先掛著」⇒ 已修,並各補一格看著:**
#      ✅誤擋 ③ migration 的【行註解裡】有 `-- CREATE VIEW public.ghost_v …`
#               而 app 新增讀既有的 `ghost_v` ⇒ 舊版抽成假 DDL、rc=1  ⇒ **修法=先剝 SQL 註解** ⇒ 見 `V⑦`
#      🔴誤擋 ⑤ app 只新增 `const LABEL = "pcm_probe_v"`(**整支檔零 `.from(`**)⇒ rc=1
#               🔴🔴 **修法已撤回, ⑤ 仍是已知誤擋。** 我試過「同檔要有 `.from(` 才算命中」,
#               而 codex R2 構造出它換來的漏擋、我複驗成立:常數住在**沒改動的檔**裡時整發放行
#               ⇒ 漏的正是這道閘存在的理由。**誤擋 > 漏擋 在這裡不適用。** ⇒ 見 `V⑧`(現在守那個漏擋)
#      ✅漏擋 ② `CREATE /*註解*/ VIEW public.v AS …` ⇒ 舊版抽不到名字、rc=0
#               🔴 **這一條是【剝註解順便修好的】,不在裁決範圍內** —— 剝掉 `/* */` 之後
#               `CREATE` 與 `VIEW` 接在一起 ⇒ 抽得到。⇒ 見 `V⑨`
#      🔴漏擋 ① `CREATE RECURSIVE VIEW public.v(x) AS …` ⇒ **仍然抽不到名字,rc=0(刻意留著)**
#               理由(主視窗裁):它只是**退回放寬前**的狀態,而放寬前那 13 支本來就完全看不到;
#               修它是「更嚴」,而更嚴要另配一次誤擋率乾跑 ⇒ 另一片。
#    📌 codex 另外點的「④被註解掉的呼叫會誤擋」**實測不成立**(rc=0,剝註解有效)⇒ 已改成 V④ 在守它。
#
#    📏 **③ 那個修法對【今天的存量】零影響 —— 這句話要寫出來,否則它讀起來像修好了一批東西**:
#       全部 214 支 migration 逐支比對「剝註解前 vs 剝註解後抽出來的 view 名集合」
#       ⇒ **不同的有 0 支**(而註解裡真的有 `CREATE VIEW` 的有 12 支 —— 它們的註解名與真名相同)。
#       ⇒ 它治的是**第一次有人這樣寫的那一刻**,與 `migration-post-commit-guard.sh` 檔頭
#         「現在無人踩到,而踩到不會有任何東西叫」是同一句話。
# ════════════════════════════════════════════════════════════════════════

echo "── view 那條路(2026-08-24 放寬;線3 補) ──────────────"

RV1="$WORK/v1"; setup_view_repo "$RV1"; add_view_migration "$RV1"
printf 'export const q = (c:any)=> c.from("pcm_probe_v").select("*");\n' > "$RV1/apps/admin/src/reader.ts"
expect_block "V①漏擋面·建 view 且 app 新增 .from() 讀它 ⇒ 擋(放寬前這格 rc=0)" \
  "$(view_push "$RV1")" "view [pcm_probe_v]"

RV2="$WORK/v2"; setup_view_repo "$RV2"; add_view_migration "$RV2"
printf 'export const x = 2;\n' > "$RV2/apps/admin/src/other.ts"
expect_pass "V②該綠必綠·建 view 但沒有人讀 ⇒ 放行(否則每支 view migration 都被擋)" \
  "$(view_push "$RV2")"

RV3="$WORK/v3"; setup_view_repo "$RV3"; add_view_migration "$RV3"
printf 'export type DB = { pcm_probe_v: { Row: { x: number } } };\n' \
  > "$RV3/packages/adapters/src/supabase/database.types.ts"
expect_pass "V③誤擋面·view 名只出現在【自動產生】的型別檔 ⇒ 放行(GENERATED_TYPES 刻意排除;型別檔發不出 PostgREST 請求)" \
  "$(view_push "$RV3")"

# 🔴 **2026-08-24 codex must-fix:V④ 第一版是【恆綠】的。**
#    原測資是裸的 `// TODO 以後改讀 pcm_probe_v` —— 那個字面**本來就不符合**兩個 matcher
#    (`.from(` 窗口 / 引號整串字面)⇒ 就算把剝註解整段拿掉它照樣綠 ⇒ 對「剝註解有沒有裝上」零判別力。
#    ⇒ 改成**被註解掉的呼叫**:剝註解若失效,這一行會落進 `.from(` 窗口 ⇒ 紅。
RV4="$WORK/v4"; setup_view_repo "$RV4"; add_view_migration "$RV4"
printf '// c.from("pcm_probe_v")\nexport const y = 3;\n' > "$RV4/apps/admin/src/note.ts"
expect_pass "V④誤擋面·**被註解掉的** .from() 呼叫 ⇒ 放行(剝註解若失效這格會紅)" \
  "$(view_push "$RV4")"

RV5="$WORK/v5"; setup_view_repo "$RV5"; add_view_migration "$RV5"
printf 'export const q = (c:any)=> c.from(\n  "pcm_probe_v"\n).select("*");\n' > "$RV5/apps/admin/src/multi.ts"
expect_block "V⑤漏擋面·跨行 .from( —— view 名在下一行 ⇒ 仍要擋(與 .rpc( 那邊同一條窗口規則)" \
  "$(view_push "$RV5")" "view [pcm_probe_v]"

RV6="$WORK/v6"; setup_view_repo "$RV6"; add_matview_migration "$RV6"
printf 'export const q = (c:any)=> c.from("pcm_probe_v").select("*");\n' > "$RV6/apps/admin/src/reader.ts"
expect_block "V⑥漏擋面·CREATE MATERIALIZED VIEW 也要抽得到名字 ⇒ 擋" \
  "$(view_push "$RV6")" "view [pcm_probe_v]"

# ── 2026-08-24 線3:codex 對抗審查點名的兩個【誤擋】修完之後補的格 ────────────
# 🔴 這三格在**修之前全部是紅的**(實測), 而修之後全綠 ⇒ 極性正確、不是恆綠。

RV7="$WORK/v7"; setup_view_repo "$RV7"
# 這支 migration 的【行註解裡】有一句假的 CREATE VIEW, 而它真正建的是一張表。
printf -- '-- CREATE VIEW public.ghost_v AS SELECT 1;\nCREATE TABLE public.z(i int);\n' \
  > "$RV7/supabase/migrations/20260102000000_pending.sql"
# app 這次新增讀的是【早就存在】的 ghost_v。
printf 'export const q = (c:any)=> c.from("ghost_v").select("*");\n' > "$RV7/apps/admin/src/reader.ts"
expect_pass "V⑦誤擋面·migration 的【註解裡】有假 DDL ⇒ 不得抽成 pending view(修前 rc=1)" \
  "$(view_push "$RV7")"

# 🔴🔴 **V⑧【已撤回】—— 而撤回本身要留一格看著, 不是刪掉就算。**
#    原本這格驗「view 名只當字串常數而整支檔零 `.from(` ⇒ 放行」。修法是「同檔要有 `.from(` 才算命中」。
#    📏 codex R2 構造出它換來的漏擋, 我複驗成立(兩個方向):
#      `table.ts` 把 `const TABLE='old_v'` → `'new_v'`, 而 `.from(TABLE)` 在**未改動的** `reader.ts`
#        修前 ⇒ 🔴 擋   修後 ⇒ 🟢 放行 ← **漏的正是這道閘存在的理由**
#    ⇒ 撤回。`⑤` 維持為**已知誤擋**(app 新增純標籤字串 ⇒ 被擋), 處置交回主視窗。
#    ⇒ 下面這一格改成**釘住那個漏擋不會再回來**:常數住在沒改動的檔裡時, 仍然要擋。
RV8="$WORK/v8"; setup_view_repo "$RV8"
printf 'CREATE VIEW public.new_v AS SELECT 1 AS x;\n' > "$RV8/supabase/migrations/20260102000000_pending.sql"
printf "export const TABLE = 'old_v';\n" > "$RV8/apps/admin/src/table.ts"
printf "import {TABLE} from './table';\nexport const q=(c:any)=>c.from(TABLE).select('*');\n" > "$RV8/apps/admin/src/reader.ts"
( cd "$RV8" && git add -A && git commit -qm seed >/dev/null )
printf "export const TABLE = 'new_v';\n" > "$RV8/apps/admin/src/table.ts"
expect_block "V⑧漏擋面·常數表改名而 .from(常數) 在【未改動的檔】⇒ 仍要擋(⑤ 的修法撤回就是為了它)" \
  "$(view_push "$RV8")" "view [new_v]"

RV9="$WORK/v9"; setup_view_repo "$RV9"
# `CREATE /*註解*/ VIEW` —— 註解夾在關鍵字中間。剝註解之後 CREATE 與 VIEW 接在一起 ⇒ 抽得到。
printf 'CREATE /*x*/ VIEW public.pcm_probe_v AS SELECT 1 AS x;\n' \
  > "$RV9/supabase/migrations/20260102000000_pending.sql"
printf 'export const q = (c:any)=> c.from("pcm_probe_v").select("*");\n' > "$RV9/apps/admin/src/reader.ts"
expect_block "V⑨漏擋面·CREATE /*註解*/ VIEW ⇒ 擋(修前 rc=0 漏擋;剝註解順便修好的)" \
  "$(view_push "$RV9")" "view [pcm_probe_v]"

# 🔴 **codex R2 must-fix:V⑨ 只餵了最簡單的 `/*x*/`,而第一版剝除器對另外兩種【完全失效】。**
#    ⇒ 三格分開餵:內含單獨星號 / 跨行 / 跨行註解裡的假 DDL(誤擋面)。
RVa="$WORK/va"; setup_view_repo "$RVa"
printf 'CREATE /* a * b */ VIEW public.pcm_probe_v AS SELECT 1 AS x;\n' \
  > "$RVa/supabase/migrations/20260102000000_pending.sql"
printf 'export const q = (c:any)=> c.from("pcm_probe_v").select("*");\n' > "$RVa/apps/admin/src/reader.ts"
expect_block "V⑩漏擋面·區塊註解【內含單獨星號】 /* a * b */ ⇒ 擋(第一版剝除器剝不掉)" \
  "$(view_push "$RVa")" "view [pcm_probe_v]"

RVb="$WORK/vb"; setup_view_repo "$RVb"
printf 'CREATE /* a\nb */ VIEW public.pcm_probe_v AS SELECT 1 AS x;\n' \
  > "$RVb/supabase/migrations/20260102000000_pending.sql"
printf 'export const q = (c:any)=> c.from("pcm_probe_v").select("*");\n' > "$RVb/apps/admin/src/reader.ts"
expect_block "V⑪漏擋面·【跨行】區塊註解 ⇒ 擋(剝除器要在 flatten 之後才剝得到)" \
  "$(view_push "$RVb")" "view [pcm_probe_v]"

RVc="$WORK/vc"; setup_view_repo "$RVc"
printf '/* 舊版:\nCREATE VIEW public.ghost_v AS SELECT 1;\n*/\nCREATE TABLE public.z(i int);\n' \
  > "$RVc/supabase/migrations/20260102000000_pending.sql"
printf 'export const q = (c:any)=> c.from("ghost_v").select("*");\n' > "$RVc/apps/admin/src/reader.ts"
expect_pass "V⑫誤擋面·【跨行】區塊註解裡的假 DDL ⇒ 不得抽成 pending view" \
  "$(view_push "$RVc")"

# ── 格㊹:🔴 **守著這道修補自己**(code-reviewer Important;而它是這次事故的同一個形狀)──
#   未來有人把 `_pcm_git_env_isolate` 刪掉或搬走,上面 64 格**照樣全綠** ——
#   **兩個世界印同一句話**,正是這次出事的機制。⇒ 這一格讓那個世界紅。
#   正對照:有 isolate ⇒ 汙染的 GIT_* 被剝光(0)
#   負對照:不呼叫 isolate ⇒ 那兩個變數還在(2)—— 沒有它,這一格會恆綠。
_iso_after=$(GIT_DIR=/nonexistent GIT_WORK_TREE=/nonexistent bash -c \
  '_pcm_git_env_isolate() { local _v; for _v in $(env | sed -n "s/^\(GIT_[A-Za-z0-9_]*\)=.*/\1/p"); do unset "$_v"; done; }; _pcm_git_env_isolate; env | grep -c "^GIT_" || true')
_iso_none=$(GIT_DIR=/nonexistent GIT_WORK_TREE=/nonexistent bash -c 'env | grep -c "^GIT_" || true')
if [ "$_iso_after" = "0" ] && [ "$_iso_none" = "2" ]; then
  ok "㊹ GIT_* 隔離:有剝 ⇒ 0 個殘留;不剝 ⇒ 2 個(負對照有力)"
else
  bad "㊹ GIT_* 隔離失效或負對照無力:有剝=[$_iso_after](期望 0)/ 不剝=[$_iso_none](期望 2)"
fi

echo
echo "══ 結果:PASS=$PASS FAIL=$FAIL(期望 PASS=$EXPECT_TOTAL)══"
if [ "$FAIL" -eq 0 ] && [ "$PASS" -ne "$EXPECT_TOTAL" ]; then
  echo "🔴 零 FAIL 但格數不對(PASS=$PASS ≠ EXPECT_TOTAL=$EXPECT_TOTAL)⇒ 有格被刪/被跳過,判為未通過"; exit 1
fi
[ "$FAIL" -eq 0 ] || exit 1
