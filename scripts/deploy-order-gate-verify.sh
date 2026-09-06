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
# 🔴 **合線時這個數字【兩邊各加各的, 一定撞】** —— 解法不是挑一個看起來對的:
#    base `dafe35279` = **75** · `origin/dev` = **80**(+5) · 本線 = **103**(+28)⇒ 合起來 **108**。
#    🛑 **而算術只是預期值** —— 下面那個數字是【跑完之後照實際 PASS 填的】,
#      並且逐一確認過兩邊的格都真的在(dev 側 55 / 56 / 57 / 57b 那四格 · 本線 欄⓪a…欄⑰b)。
EXPECT_TOTAL=108

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
  # 🔴 **唯一 parser 也要進去** —— 閘 source 不到它會 fail-closed `exit 2` ⇒ 每一格都紅,
  #    而那個紅講的是「fixture 少了一支檔」不是「閘判錯」。🔵 它大聲擋住而不是靜默放行 = 正確。
  cp "$(dirname "$GATE_SRC")/lib-migration-header-marks.sh" "$R/scripts/lib-migration-header-marks.sh"
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

echo "── 欄位那一族(2026-09-06 Sean Q-閘看欄=甲)───────────────"

# 🔴 四格的分工:①要擋 ②③要放行(而 ② 就是「只比欄名」那個病的證人)④零 pending
#    📏 **那把尺的量級用【現值】**(2026-09-06 用實作那把尺重量, 分母 1,277 支候選 app 檔):
#      尺一 **1,116 檔次**(逐 94 組)⇒ 尺二 **405**。⛔ ~~舊字面 3254 / 59 欄~~ 不能引用 ——
#      它沒排除 test/產生型別檔, 不是閘在跑的那把尺(理由與兩組廢棄字面見 deploy-order-gate.sh 檔頭)。
add_pending_col() { # $1=repo  加一支 pending 的 ADD COLUMN
  cat > "$1/supabase/migrations/20260103000000_addcol.sql" <<'SQL'
ALTER TABLE public.things ADD COLUMN IF NOT EXISTS pcm_probe_col text;
SQL
}

RC1="$WORK/rc1"; setup_repo "$RC1"; add_pending_col "$RC1"
cat > "$RC1/apps/admin/src/reader.ts" <<'TS'
export async function readIt(sb: any) {
  return sb.from('things').select('id, pcm_probe_col');
}
TS
( cd "$RC1" && git add -A && git commit -qm "feat: 加欄 migration + 讀那一欄" )
B1="$(cd "$RC1" && git rev-parse HEAD~1)"; T1="$(cd "$RC1" && git rev-parse HEAD)"
expect_block "欄⓪a:未 apply 的加欄 + 同一支檔同時提到表名與欄名" \
  "$(run_gate "$RC1" "refs/heads/dev $T1 refs/heads/dev $B1")" "things.pcm_probe_col"

# 🔴🔴 ⑬ 是本族最重要的一格 —— **它就是「只比欄名」那把尺會誤擋的形狀**
#    ⛔ ~~實測那把尺:全史 59 個欄名命中 3254 檔次(`x` 一個字 1717 支檔)~~ —— **那組不能引用**。
#    📏 **現值(2026-09-06 用實作那把尺重量)**:87 個去重欄名 / 94 組, 尺一 **1,116 檔次**,
#      單欄 top `email` 153 · `kind` 143 · `actor` 89。
#    這一格的檔【只有欄名、沒有表名】⇒ 尺二必須放行。
RC2="$WORK/rc2"; setup_repo "$RC2"; add_pending_col "$RC2"
cat > "$RC2/apps/admin/src/unrelated2.ts" <<'TS'
export const label = 'pcm_probe_col';
TS
( cd "$RC2" && git add -A && git commit -qm "feat: 加欄 migration + 只提到欄名的無關檔" )
B2="$(cd "$RC2" && git rev-parse HEAD~1)"; T2="$(cd "$RC2" && git rev-parse HEAD)"
expect_pass "欄⓪b:同一支檔【只有欄名沒有表名】⇒ 不擋(尺一 1,116 檔次那個病的證人)" \
  "$(run_gate "$RC2" "refs/heads/dev $T2 refs/heads/dev $B2")"

# ⑭ 那一欄在【已 apply 的】migration 裡就出現過 ⇒ 不是這次新加的 ⇒ 放行
#    📌 少了這一格, 一支冪等重貼的 `ADD COLUMN IF NOT EXISTS` 會擋住整條線。
RC3="$WORK/rc3"; setup_repo "$RC3"
cat > "$RC3/supabase/migrations/20260101000001_oldcol.sql" <<'SQL'
ALTER TABLE public.things ADD COLUMN IF NOT EXISTS pcm_probe_col text;
SQL
_osha="$(shasum -a 256 "$RC3/supabase/migrations/20260101000001_oldcol.sql" | cut -d' ' -f1)"
printf '20260101000001\t%s\t2026-01-01\tfixture\n' "$_osha" >> "$RC3/supabase/APPLIED.tsv"
( cd "$RC3" && git add -A && git commit -qm "base: 舊的加欄已進帳" )
add_pending_col "$RC3"
cat > "$RC3/apps/admin/src/reader3.ts" <<'TS'
export async function readIt(sb: any) {
  return sb.from('things').select('id, pcm_probe_col');
}
TS
( cd "$RC3" && git add -A && git commit -qm "feat: 重貼同一支加欄 + 讀那一欄" )
B3="$(cd "$RC3" && git rev-parse HEAD~1)"; T3="$(cd "$RC3" && git rev-parse HEAD)"
expect_pass "欄⓪c:那一欄在已 apply 的 migration 出現過 ⇒ 不算新加, 放行" \
  "$(run_gate "$RC3" "refs/heads/dev $T3 refs/heads/dev $B3")"

# ⑮ pending 有 migration 而【一句 ADD COLUMN 都沒有】⇒ 欄位這一族不得叫
#    ⛔ ~~而這一格今天就是真實世界:PENDING 11 支, ADD COLUMN 0 支~~ —— **那句是錯的**(codex R1)。
#    ⛔ ~~所以「上線第一天靜音」不成立~~ —— 🔴 **那句訂正【過頭了】**(codex R2 MF7)。
#      📌 「有一支 pending 帶新欄」**推不出**「會出聲」:還要有一支 app 檔同時提到表名與欄名。
#      ⇒ 正確的話是:**那要看那一批推的東西裡有沒有那種檔。**
#
#    🔬 **實測(2026-09-06 · 樹 `~/pcm-wt-auth` · `HEAD 1c3c747c3` vs `origin/dev 1ee5cf064`
#       · 閘自己跑 `DOG_DEBUG=1` 的輸出, 不是我重寫一把尺)**:
#         PENDING = **20 支**(判準 = 版本在帳上**且 sha 相符**才算 applied)
#         抽到的新欄 = **1 組**:`order_refunds.rec_trade_id`(來自 `20260801120000`)
#         那一發的 `apps/`+`packages/` 差異檔 = **32 支**
#         而 blocked = **0**
#    🔬 **為什麼是 0 —— 帶正負對照, 免得讀成「欄位那一族沒生效」**:
#         那 32 支裡同時提到 `order_refunds` 與 `rec_trade_id` 的 = **0 支**
#         🔵 **正對照**:全樹候選 app 檔裡同時提到那兩個字的 = **10 支**
#            (`apps/admin/src/lib/payment/refund-read.ts` 等)⇒ **尺接得上, 只是這一批沒動到它們**
#         🔵 **負對照**:現造的 `pcm_zzq_neverwritten_col_0906` 全樹 = **0 支**
#    ⇒ 🎯 **結論**:今天這一發**確實靜音**, 而**不是**因為欄位那一族沒生效 ——
#      哪一天有人動到那 10 支的其中一支, 它就會出聲。
RC4="$WORK/rc4"; setup_repo "$RC4"; add_pending_migration "$RC4"
cat > "$RC4/apps/admin/src/reader4.ts" <<'TS'
export const things = 'things';
export const pcm_probe_col = 1;
TS
( cd "$RC4" && git add -A && git commit -qm "feat: pending 是純函式 + 檔裡剛好有那兩個字" )
B4="$(cd "$RC4" && git rev-parse HEAD~1)"; T4="$(cd "$RC4" && git rev-parse HEAD)"
expect_pass "欄⓪d:pending 裡零 ADD COLUMN ⇒ 欄位這一族不得叫(今天真實世界就是這一格)" \
  "$(run_gate "$RC4" "refs/heads/dev $T4 refs/heads/dev $B4")"


# ══ 欄位那一族 · codex R1 補的四格反例 ═════════════════════════════════════

# 🔴🔴 欄① 是 MF3 的證人:**既有的表名行【不動】, 這一發只新增欄名**
#    舊版兩個字面都只查【新增行】⇒ 兩者不同行 ⇒ 放行 ⇒ 那正是 view 那條路撤回過的形狀。
RC5="$WORK/rc5"; setup_repo "$RC5"
cat > "$RC5/apps/admin/src/reader5.ts" <<'TS'
export async function readIt(sb: any) {
  return sb.from('things').select('id');
}
TS
( cd "$RC5" && git add -A && git commit -qm "base: 既有的 from(things)" )
add_pending_col "$RC5"
cat > "$RC5/apps/admin/src/reader5.ts" <<'TS'
export async function readIt(sb: any) {
  return sb.from('things').select('id');
}
export const extra = 'pcm_probe_col';
TS
( cd "$RC5" && git add -A && git commit -qm "feat: 加欄 migration + 只新增欄名那一行" )
B5="$(cd "$RC5" && git rev-parse HEAD~1)"; T5="$(cd "$RC5" && git rev-parse HEAD)"
expect_block "欄①:既有表名行不動、只新增欄名 ⇒ 仍要擋(MF3;表名看整支檔)" \
  "$(run_gate "$RC5" "refs/heads/dev $T5 refs/heads/dev $B5")" "things.pcm_probe_col"

# 🔴 欄② 是 MF4/MF5 的證人:**已 apply 的檔被改過(sha 不符)而加了新欄**
#    舊版豁免只比版本號、欄位從當前 sha 抽 ⇒ 它會先被判 pending, 再用同一份新內容把自己豁免掉。
RC6="$WORK/rc6"; setup_repo "$RC6"
cat > "$RC6/supabase/migrations/20260101000002_will_drift.sql" <<'SQL'
CREATE TABLE public.drifty (id uuid PRIMARY KEY);
SQL
_dsha="$(shasum -a 256 "$RC6/supabase/migrations/20260101000002_will_drift.sql" | cut -d' ' -f1)"
printf '20260101000002\t%s\t2026-01-01\tfixture\n' "$_dsha" >> "$RC6/supabase/APPLIED.tsv"
( cd "$RC6" && git add -A && git commit -qm "base: 一支已進帳的 migration" )
# 改它(帳上 sha 從此不符)並加一欄
cat > "$RC6/supabase/migrations/20260101000002_will_drift.sql" <<'SQL'
CREATE TABLE public.drifty (id uuid PRIMARY KEY);
ALTER TABLE public.things ADD COLUMN pcm_drift_col text;
SQL
cat > "$RC6/apps/admin/src/reader6.ts" <<'TS'
export async function readIt(sb: any) {
  return sb.from('things').select('id, pcm_drift_col');
}
TS
( cd "$RC6" && git add -A && git commit -qm "feat: 改了一支已進帳的 migration 加欄 + 讀那一欄" )
B6="$(cd "$RC6" && git rev-parse HEAD~1)"; T6="$(cd "$RC6" && git rev-parse HEAD)"
expect_block "欄②:被改過的已 apply 檔(sha 不符)加欄 ⇒ 不得自己豁免自己" \
  "$(run_gate "$RC6" "refs/heads/dev $T6 refs/heads/dev $B6")" "things.pcm_drift_col"

# 🔴 欄③ 是 MF1 的證人:**一句 ALTER 加兩欄, 第二欄也要抽得到**
RC7="$WORK/rc7"; setup_repo "$RC7"
cat > "$RC7/supabase/migrations/20260104000000_twocol.sql" <<'SQL'
ALTER TABLE ONLY "public"."things" ADD COLUMN pcm_first_col text, ADD COLUMN IF NOT EXISTS pcm_second_col int;
SQL
cat > "$RC7/apps/admin/src/reader7.ts" <<'TS'
export async function readIt(sb: any) {
  return sb.from('things').select('id, pcm_second_col');
}
TS
( cd "$RC7" && git add -A && git commit -qm "feat: 一句 ALTER 加兩欄 + 只讀第二欄" )
B7="$(cd "$RC7" && git rev-parse HEAD~1)"; T7="$(cd "$RC7" && git rev-parse HEAD)"
expect_block "欄③:一句 ALTER 加兩欄(帶 ONLY 與 schema 引號)⇒ 第二欄也要擋" \
  "$(run_gate "$RC7" "refs/heads/dev $T7 refs/heads/dev $B7")" "things.pcm_second_col"

# ⚠️ 欄④ 是【已知漏擋】的活證據 —— 它期望【放行】, 而那不是「正確」, 是「今天擋不到」。
#    表名與欄名分在兩支檔 ⇒ 尺二(同檔共現)看不到。
#    📌 寫成一格是為了讓它【被看見】; 哪天有人修好了, 這一格會紅, 那時把它改成 expect_block。
RC8="$WORK/rc8"; setup_repo "$RC8"; add_pending_col "$RC8"
cat > "$RC8/apps/admin/src/tbl8.ts" <<'TS'
export const TABLE = 'things';
TS
cat > "$RC8/apps/admin/src/reader8.ts" <<'TS'
import { TABLE } from './tbl8';
export async function readIt(sb: any) {
  return sb.from(TABLE).select('id, pcm_probe_col');
}
TS
( cd "$RC8" && git add -A && git commit -qm "feat: 表名與欄名分在兩支檔" )
B8="$(cd "$RC8" && git rev-parse HEAD~1)"; T8="$(cd "$RC8" && git rev-parse HEAD)"
expect_pass "欄④:表名與欄名【分在兩支檔】⇒ 今天放行(**已知漏擋**, 不是正確行為)" \
  "$(run_gate "$RC8" "refs/heads/dev $T8 refs/heads/dev $B8")"

# ══ 欄位那一族 · codex R2 補的七格反例(2026-09-06)══════════════════════════

# 🔴🔴 欄⑤ 是 R2 MF1 的證人:**反向接線** —— 欄名常數早就在檔裡, 這一發才新增表名那一行。
#    R1 的修法只補了一個方向(欄名看新增行、表名看整支檔)⇒ 這個形狀照樣放行,
#    而它**真的**開始依賴一支 pending 的新欄。
RC9="$WORK/rc9"; setup_repo "$RC9"
cat > "$RC9/apps/admin/src/reader9.ts" <<'TS'
export const COLS = 'id, pcm_probe_col';
TS
( cd "$RC9" && git add -A && git commit -qm "base: 欄名常數早就在這支檔裡" )
add_pending_col "$RC9"
cat > "$RC9/apps/admin/src/reader9.ts" <<'TS'
export const COLS = 'id, pcm_probe_col';
export async function readIt(sb: any) {
  return sb.from('things').select(COLS);
}
TS
( cd "$RC9" && git add -A && git commit -qm "feat: 加欄 migration + 這一發才新增 from(things)" )
B9="$(cd "$RC9" && git rev-parse HEAD~1)"; T9="$(cd "$RC9" && git rev-parse HEAD)"
expect_block "欄⑤:欄名早就在、這一發只新增表名 ⇒ 仍要擋(R2 MF1 反向接線)" \
  "$(run_gate "$RC9" "refs/heads/dev $T9 refs/heads/dev $B9")" "things.pcm_probe_col"

# 🔴 欄⑥ 是 R2 MF2 的證人:PostgreSQL 的順序是 `ALTER TABLE [IF EXISTS] [ONLY] name`,
#    舊 regex 寫反 ⇒ 表名被抽成 `only` ⇒ 那一組永遠對不上任何 app 檔 ⇒ **靜默漏擋**。
RCA="$WORK/rca"; setup_repo "$RCA"
cat > "$RCA/supabase/migrations/20260105000000_ifexists.sql" <<'SQL'
ALTER TABLE IF EXISTS ONLY public.things ADD COLUMN pcm_ifex_col text;
SQL
cat > "$RCA/apps/admin/src/readerA.ts" <<'TS'
export async function readIt(sb: any) {
  return sb.from('things').select('id, pcm_ifex_col');
}
TS
( cd "$RCA" && git add -A && git commit -qm "feat: IF EXISTS ONLY 形狀的加欄 + 讀那一欄" )
BA="$(cd "$RCA" && git rev-parse HEAD~1)"; TA="$(cd "$RCA" && git rev-parse HEAD)"
expect_block "欄⑥:ALTER TABLE IF EXISTS ONLY ⇒ 表名不得被抽成 only(R2 MF2)" \
  "$(run_gate "$RCA" "refs/heads/dev $TA refs/heads/dev $BA")" "things.pcm_ifex_col"

# 🔴🔴 欄⑦ 是 R2 MF3 的證人:已 apply 的檔裡有一段**沒被執行**的字串 DDL
#    ⇒ 舊版把它抽進 `APPLIED_COLS` ⇒ **把後來真正 pending 的同一欄豁免掉**。
RCB="$WORK/rcb"; setup_repo "$RCB"
cat > "$RCB/supabase/migrations/20260101000003_ghost.sql" <<'SQL'
CREATE TABLE public.audit_log (stmt text);
INSERT INTO public.audit_log (stmt) VALUES ('ALTER TABLE things ADD COLUMN pcm_ghost_col text');
SQL
_bsha="$(shasum -a 256 "$RCB/supabase/migrations/20260101000003_ghost.sql" | cut -d' ' -f1)"
printf '20260101000003\t%s\t2026-01-01\tfixture\n' "$_bsha" >> "$RCB/supabase/APPLIED.tsv"
( cd "$RCB" && git add -A && git commit -qm "base: 已 apply 的檔裡有一段字串 DDL(沒被執行)" )
cat > "$RCB/supabase/migrations/20260106000000_realghost.sql" <<'SQL'
ALTER TABLE public.things ADD COLUMN pcm_ghost_col text;
SQL
cat > "$RCB/apps/admin/src/readerB.ts" <<'TS'
export async function readIt(sb: any) {
  return sb.from('things').select('id, pcm_ghost_col');
}
TS
( cd "$RCB" && git add -A && git commit -qm "feat: 真的加那一欄 + 讀它" )
BB="$(cd "$RCB" && git rev-parse HEAD~1)"; TB="$(cd "$RCB" && git rev-parse HEAD)"
expect_block "欄⑦:已 apply 檔裡沒被執行的字串 DDL 不得當豁免來源(R2 MF3)" \
  "$(run_gate "$RCB" "refs/heads/dev $TB refs/heads/dev $BB")" "things.pcm_ghost_col"

# 🔴🔴 欄⑧ 是 R2 MF4 的證人:**抽取器自己死掉**不得靜默變成「零新欄」。
#    做法 = 把 `python3` 換成一支必定 exit 9 的假的 ⇒ 閘要 fail-closed 並【說出來】。
#    📌 兩個世界會印不同的東西:壞掉 ⇒ 「欄位抽取器失敗」+ rc=1;好的 ⇒ 這一格照常被擋。
RCC="$WORK/rcc"; setup_repo "$RCC"; add_pending_col "$RCC"
cat > "$RCC/apps/admin/src/readerC.ts" <<'TS'
export async function readIt(sb: any) {
  return sb.from('things').select('id, pcm_probe_col');
}
TS
( cd "$RCC" && git add -A && git commit -qm "feat: 加欄 + 讀它" )
BC="$(cd "$RCC" && git rev-parse HEAD~1)"; TC="$(cd "$RCC" && git rev-parse HEAD)"
mkdir -p "$WORK/fakebin"
printf '%s\n' '#!/bin/sh' 'exit 9' > "$WORK/fakebin/python3"
chmod +x "$WORK/fakebin/python3"
_pf_out="$(cd "$RCC" && printf '%s\n' "refs/heads/dev $TC refs/heads/dev $BC" \
           | PATH="$WORK/fakebin:$PATH" bash scripts/deploy-order-gate.sh 2>&1)"; _pf_rc=$?
if [ "$_pf_rc" = "1" ] && printf '%s' "$_pf_out" | grep -qF '欄位抽取器失敗'; then
  ok "欄⑧:抽取器 exit≠0 ⇒ fail-closed 並說出來(R2 MF4)"
else
  bad "欄⑧:抽取器死掉被靜默吞成零新欄 ⇒ rc=$_pf_rc:$(printf '%s' "$_pf_out" | head -2 | tr '\n' ' ')"
fi
# 🔴 **正對照(同一把尺、好的世界)** —— 沒有這一發, 上面那格在「閘因為別的原因紅了」時也會綠。
expect_block "欄⑧b 正對照:同一份 fixture 用真的 python3 ⇒ 照常被擋(證明尺接上了)" \
  "$(run_gate "$RCC" "refs/heads/dev $TC refs/heads/dev $BC")" "things.pcm_probe_col"

# 🔴 欄⑨ 是 nit「quoted identifier 大小寫被抹平」的證人:
#    PostgreSQL 裡 `"CamelCase"` 與 camelcase 是**兩個不同的欄** ⇒ 小寫那支不得豁免引號那支。
RCD="$WORK/rcd"; setup_repo "$RCD"
cat > "$RCD/supabase/migrations/20260101000004_lower.sql" <<'SQL'
ALTER TABLE public.things ADD COLUMN camelcase text;
SQL
_dlsha="$(shasum -a 256 "$RCD/supabase/migrations/20260101000004_lower.sql" | cut -d' ' -f1)"
printf '20260101000004\t%s\t2026-01-01\tfixture\n' "$_dlsha" >> "$RCD/supabase/APPLIED.tsv"
( cd "$RCD" && git add -A && git commit -qm "base: 已 apply 的小寫欄" )
cat > "$RCD/supabase/migrations/20260107000000_camel.sql" <<'SQL'
ALTER TABLE public.things ADD COLUMN "CamelCase" text;
SQL
cat > "$RCD/apps/admin/src/readerD.ts" <<'TS'
export async function readIt(sb: any) {
  return sb.from('things').select('id, CamelCase');
}
TS
( cd "$RCD" && git add -A && git commit -qm "feat: 加引號大寫欄 + 讀它" )
BD="$(cd "$RCD" && git rev-parse HEAD~1)"; TD="$(cd "$RCD" && git rev-parse HEAD)"
expect_block "欄⑨:引號識別字 \"CamelCase\" 不得被小寫的 camelcase 豁免(nit)" \
  "$(run_gate "$RCD" "refs/heads/dev $TD refs/heads/dev $BD")" "things.CamelCase"

# 🔴 欄⑩ 是 nit「版本檔搜尋沒限定 _*.sql」的證人:同版本號旁邊有一支 `.md`, 它排在前面
#    ⇒ 舊版 `head -1` 拿到 `.md` 去算 sha ⇒ 永遠對不上帳 ⇒ 那一支**靜默失去豁免資格** ⇒ 誤擋。
RCE="$WORK/rce"; setup_repo "$RCE"
printf '%s\n' '# 這一支是同版本號旁邊的說明檔, 不是 migration' > "$RCE/supabase/migrations/20260101000005_aaa.md"
cat > "$RCE/supabase/migrations/20260101000005_addcol.sql" <<'SQL'
ALTER TABLE public.things ADD COLUMN pcm_glob_col text;
SQL
_esha="$(shasum -a 256 "$RCE/supabase/migrations/20260101000005_addcol.sql" | cut -d' ' -f1)"
printf '20260101000005\t%s\t2026-01-01\tfixture\n' "$_esha" >> "$RCE/supabase/APPLIED.tsv"
( cd "$RCE" && git add -A && git commit -qm "base: 已 apply 的加欄 + 同版本號的 .md" )
cat > "$RCE/supabase/migrations/20260108000000_recol.sql" <<'SQL'
ALTER TABLE public.things ADD COLUMN IF NOT EXISTS pcm_glob_col text;
SQL
cat > "$RCE/apps/admin/src/readerE.ts" <<'TS'
export async function readIt(sb: any) {
  return sb.from('things').select('id, pcm_glob_col');
}
TS
( cd "$RCE" && git add -A && git commit -qm "feat: 冪等重貼同一欄 + 讀它" )
BE="$(cd "$RCE" && git rev-parse HEAD~1)"; TE="$(cd "$RCE" && git rev-parse HEAD)"
expect_pass "欄⑩:同版本號旁邊的 .md 不得被當成那一支 migration(nit)" \
  "$(run_gate "$RCE" "refs/heads/dev $TE refs/heads/dev $BE")"

# 🔴 欄⑪ 是 nit「整檔 git show 失敗被 || true 吞掉」的證人 ——
#    改成 fail-closed 之後, **這一發刪掉一支 app 檔**不可以被當成失敗(它不可能依賴任何新欄)。
RCF="$WORK/rcf"; setup_repo "$RCF"
cat > "$RCF/apps/admin/src/goneF.ts" <<'TS'
export const gone = 1;
TS
( cd "$RCF" && git add -A && git commit -qm "base: 一支等一下會被刪的 app 檔" )
add_pending_col "$RCF"
rm "$RCF/apps/admin/src/goneF.ts"
( cd "$RCF" && git add -A && git commit -qm "feat: 加欄 migration + 刪掉一支 app 檔" )
BF="$(cd "$RCF" && git rev-parse HEAD~1)"; TF="$(cd "$RCF" && git rev-parse HEAD)"
expect_pass "欄⑪:這一發刪掉的 app 檔 ⇒ 讀不到整檔不是失敗, 不得 fail-closed(nit)" \
  "$(run_gate "$RCF" "refs/heads/dev $TF refs/heads/dev $BF")"

# ══ 欄位那一族 · codex R3 補的六格反例(2026-09-06;R3 換角度換模型 gpt-5.6-sol)══════

# 🔴🔴 欄⑫ 是 R3 A1 的證人:**兩個常數早就在檔裡, 這一發只新增【接線】那一行。**
#    R2 MF1 的修法(至少一個名稱要出現在新增行裡)對這個形狀是瞎的 —— 新增行裡
#    只有 `TABLE` 與 `COLS` 這兩個【識別字】, 一個實際名稱都沒有 ⇒ 舊修法放行。
RCG="$WORK/rcg"; setup_repo "$RCG"
cat > "$RCG/apps/admin/src/readerG.ts" <<'TS'
const TABLE = 'things';
const COLS = 'id, pcm_probe_col';
export { TABLE, COLS };
TS
( cd "$RCG" && git add -A && git commit -qm "base: 兩個常數都早就在, 而還沒接線" )
add_pending_col "$RCG"
cat > "$RCG/apps/admin/src/readerG.ts" <<'TS'
const TABLE = 'things';
const COLS = 'id, pcm_probe_col';
export { TABLE, COLS };
export async function readIt(sb: any) {
  return sb.from(TABLE).select(COLS);
}
TS
( cd "$RCG" && git add -A && git commit -qm "feat: 加欄 migration + 這一發才把兩個常數接起來" )
BG="$(cd "$RCG" && git rev-parse HEAD~1)"; TG="$(cd "$RCG" && git rev-parse HEAD)"
expect_block "欄⑫:常數早就在、這一發只新增接線那一行 ⇒ 仍要擋(R3 A1)" \
  "$(run_gate "$RCG" "refs/heads/dev $TG refs/heads/dev $BG")" "things.pcm_probe_col"

# 🔴🔴 欄⑬ 是 R3 A2 的證人:已 apply 的檔裡有一個 **E 開頭、內含反斜線跳脫**的字串字面。
#    天真的字串剝除會在那個跳脫處提早收尾 ⇒ **把後面那段假 DDL 暴露出來** ⇒ strict 模式
#    反而【多抽】一組 ⇒ 真正 pending 的同名欄被豁免。⇒ 這一格要求它照樣被擋。
RCH="$WORK/rch"; setup_repo "$RCH"
cat > "$RCH/supabase/migrations/20260101000006_estr.sql" <<'SQL'
CREATE TABLE public.audit_log2 (stmt text);
INSERT INTO public.audit_log2(stmt) VALUES (E'prefix \' ALTER TABLE things ADD COLUMN pcm_estr_col text; suffix');
SQL
_hsha="$(shasum -a 256 "$RCH/supabase/migrations/20260101000006_estr.sql" | cut -d' ' -f1)"
printf '20260101000006\t%s\t2026-01-01\tfixture\n' "$_hsha" >> "$RCH/supabase/APPLIED.tsv"
( cd "$RCH" && git add -A && git commit -qm "base: 已 apply 的檔裡有 E 開頭帶跳脫的假 DDL" )
cat > "$RCH/supabase/migrations/20260109000000_realestr.sql" <<'SQL'
ALTER TABLE public.things ADD COLUMN pcm_estr_col text;
SQL
cat > "$RCH/apps/admin/src/readerH.ts" <<'TS'
export async function readIt(sb: any) {
  return sb.from('things').select('id, pcm_estr_col');
}
TS
( cd "$RCH" && git add -A && git commit -qm "feat: 真的加那一欄 + 讀它" )
BH="$(cd "$RCH" && git rev-parse HEAD~1)"; TH="$(cd "$RCH" && git rev-parse HEAD)"
expect_block "欄⑬:E 開頭帶跳脫的字串不得反向暴露假 DDL 去豁免真欄(R3 A2)" \
  "$(run_gate "$RCH" "refs/heads/dev $TH refs/heads/dev $BH")" "things.pcm_estr_col"

# 🔴🔴 欄⑭ 是 R3 C1 的證人:**引號識別字含 regex metachar**。
#    抽取端修好抽得到 `Order-Items` / `gross-margin`, 而比對端用字元白名單把它整組丟掉
#    ⇒ 「修了抽取、比對端全部跳過」—— 而兩個世界的綠長得一樣。
RCI="$WORK/rci"; setup_repo "$RCI"
cat > "$RCI/supabase/migrations/20260110000000_dash.sql" <<'SQL'
ALTER TABLE public."Order-Items" ADD COLUMN "gross-margin" numeric;
SQL
cat > "$RCI/apps/admin/src/readerI.ts" <<'TS'
export async function readIt(sb: any) {
  return sb.from('Order-Items').select('id, gross-margin');
}
TS
( cd "$RCI" && git add -A && git commit -qm "feat: 引號識別字含連字號的加欄 + 讀它" )
BI="$(cd "$RCI" && git rev-parse HEAD~1)"; TI="$(cd "$RCI" && git rev-parse HEAD)"
expect_block "欄⑭:引號識別字含連字號 ⇒ 要逃逸再比, 不得整組跳過(R3 C1)" \
  "$(run_gate "$RCI" "refs/heads/dev $TI refs/heads/dev $BI")" "Order-Items.gross-margin"

# 🔴 欄⑧c 是 R3 D1 的證人:欄⑧ 只驗到【pending 側】第一次 python3 失敗就退出,
#    **豁免側(APPLIED_COLS)那條路一格都沒測到**。這裡用一支【第 N 次才失敗】的 stub 補上。
#    📌 呼叫序:pending 側 1 支 migration ⇒ 第 1 次;豁免側帳本 1 列 ⇒ 第 2 次。
RCJ="$WORK/rcj"; setup_repo "$RCJ"; add_pending_col "$RCJ"
cat > "$RCJ/apps/admin/src/readerJ.ts" <<'TS'
export async function readIt(sb: any) {
  return sb.from('things').select('id, pcm_probe_col');
}
TS
( cd "$RCJ" && git add -A && git commit -qm "feat: 加欄 + 讀它" )
BJ="$(cd "$RCJ" && git rev-parse HEAD~1)"; TJ="$(cd "$RCJ" && git rev-parse HEAD)"
mkdir -p "$WORK/fakebin2"
_REAL_PY="$(command -v python3)"
{
  printf '%s\n' '#!/bin/sh'
  printf '%s\n' 'C=$(cat "$PCM_PYCNT" 2>/dev/null || echo 0)'
  printf '%s\n' 'C=$((C+1)); printf "%s" "$C" > "$PCM_PYCNT"'
  printf '%s\n' '[ "$C" -ge 2 ] && exit 9'
  printf 'exec %s "$@"\n' "$_REAL_PY"
} > "$WORK/fakebin2/python3"
chmod +x "$WORK/fakebin2/python3"
: > "$WORK/pycnt"
_ap_out="$(cd "$RCJ" && printf '%s\n' "refs/heads/dev $TJ refs/heads/dev $BJ" \
           | PCM_PYCNT="$WORK/pycnt" PATH="$WORK/fakebin2:$PATH" bash scripts/deploy-order-gate.sh 2>&1)"; _ap_rc=$?
if [ "$_ap_rc" = "1" ] && printf '%s' "$_ap_out" | grep -qF '豁免來源'; then
  ok "欄⑧c:豁免側抽取器失敗 ⇒ fail-closed 並說是【豁免來源】那一半(R3 D1)"
else
  bad "欄⑧c:豁免側抽取器失敗沒有被抓到 ⇒ rc=$_ap_rc:$(printf '%s' "$_ap_out" | head -2 | tr '\n' ' ')"
fi

# 🔴 欄⑩b / 欄⑪b 是 R3 D3 的證人:⑩ 與 ⑪ 都是 expect_pass,
#    而**一個 expect_pass 在「這一族整個沒生效」時也會綠** ⇒ 它們自己證不了 fixture 走得到。
#    ⇒ 各配一個【只改一個條件】的擋對照:同一份 fixture 拿掉那個條件就必須紅。

# ⑩b:拿掉帳本那一列(其餘一字不改)⇒ 那一欄不再有豁免來源 ⇒ 必須擋
RCE2="$WORK/rce2"; setup_repo "$RCE2"
printf '%s\n' '# 這一支是同版本號旁邊的說明檔, 不是 migration' > "$RCE2/supabase/migrations/20260101000005_aaa.md"
cat > "$RCE2/supabase/migrations/20260101000005_addcol.sql" <<'SQL'
ALTER TABLE public.things ADD COLUMN pcm_glob_col text;
SQL
( cd "$RCE2" && git add -A && git commit -qm "base: 同一份 fixture, 而【沒有】記進帳本" )
cat > "$RCE2/supabase/migrations/20260108000000_recol.sql" <<'SQL'
ALTER TABLE public.things ADD COLUMN IF NOT EXISTS pcm_glob_col text;
SQL
cat > "$RCE2/apps/admin/src/readerE.ts" <<'TS'
export async function readIt(sb: any) {
  return sb.from('things').select('id, pcm_glob_col');
}
TS
( cd "$RCE2" && git add -A && git commit -qm "feat: 冪等重貼同一欄 + 讀它" )
BE2="$(cd "$RCE2" && git rev-parse HEAD~1)"; TE2="$(cd "$RCE2" && git rev-parse HEAD)"
expect_block "欄⑩b 可達性:同一份 fixture 拿掉帳本那一列 ⇒ 必須擋(證明 ⑩ 的綠是豁免給的)" \
  "$(run_gate "$RCE2" "refs/heads/dev $TE2 refs/heads/dev $BE2")" "things.pcm_glob_col"

# ⑪b:同一份 fixture 不刪那支檔、讓它同時提到兩個名字 ⇒ 必須擋
RCF2="$WORK/rcf2"; setup_repo "$RCF2"
cat > "$RCF2/apps/admin/src/goneF.ts" <<'TS'
export const gone = 1;
TS
( cd "$RCF2" && git add -A && git commit -qm "base: 一支 app 檔" )
add_pending_col "$RCF2"
cat > "$RCF2/apps/admin/src/goneF.ts" <<'TS'
export async function readIt(sb: any) {
  return sb.from('things').select('id, pcm_probe_col');
}
TS
( cd "$RCF2" && git add -A && git commit -qm "feat: 加欄 migration + 那支檔【留著】並讀那一欄" )
BF2="$(cd "$RCF2" && git rev-parse HEAD~1)"; TF2="$(cd "$RCF2" && git rev-parse HEAD)"
expect_block "欄⑪b 可達性:同一份 fixture 不刪那支檔 ⇒ 必須擋(證明 ⑪ 的綠是刪檔給的)" \
  "$(run_gate "$RCF2" "refs/heads/dev $TF2 refs/heads/dev $BF2")" "things.pcm_probe_col"

# ══ 欄位那一族 · R4 補的六格反例(2026-09-06;R4 = adversarial-reviewer / opus 換模型家族)══

# 🔴🔴 欄⑮ 是 R4 F1 的證人:**E-string 剝除器少了左邊界 ⇒ 它吞掉真 DDL。**
#    `[eE]'` 沒有左邊界 ⇒ 任何**以 e 結尾的字串內容**(`'manual_phone'`)後面若還有字串,
#    regex 就從那個 `e` 起跨過真正的收尾引號 ⇒ 中間的 `ALTER TABLE … ADD COLUMN` 被一起吃掉
#    ⇒ 🛑 strict 側**少抽** ⇒ **少豁免** ⇒ 一支冪等重貼被擋 = 誤擋。
#    🔬 R4 在真檔上量到:`20260712203000_m4a_orders_admin_columns.sql`
#      strict 3 組 / 不剝 E-string 6 組 ⇒ 少的是 `orders.cancelled_at` / `cancelled_reason` / `version`。
RCK="$WORK/rck"; setup_repo "$RCK"
cat > "$RCK/supabase/migrations/20260101000007_estr2.sql" <<'SQL'
CREATE TABLE public.audit_log3 (stmt text);
INSERT INTO public.audit_log3(stmt) VALUES ('manual_phone');
ALTER TABLE public.things ADD COLUMN pcm_estr2_col text DEFAULT 'x';
SQL
_ksha="$(shasum -a 256 "$RCK/supabase/migrations/20260101000007_estr2.sql" | cut -d' ' -f1)"
printf '20260101000007\t%s\t2026-01-01\tfixture\n' "$_ksha" >> "$RCK/supabase/APPLIED.tsv"
( cd "$RCK" && git add -A && git commit -qm "base: 已 apply 的加欄, 而它前面有一個以 e 結尾的字串" )
cat > "$RCK/supabase/migrations/20260111000000_recol2.sql" <<'SQL'
ALTER TABLE public.things ADD COLUMN IF NOT EXISTS pcm_estr2_col text;
SQL
cat > "$RCK/apps/admin/src/readerK.ts" <<'TS'
export async function readIt(sb: any) {
  return sb.from('things').select('id, pcm_estr2_col');
}
TS
( cd "$RCK" && git add -A && git commit -qm "feat: 冪等重貼同一欄 + 讀它" )
BK="$(cd "$RCK" && git rev-parse HEAD~1)"; TK="$(cd "$RCK" && git rev-parse HEAD)"
expect_pass "欄⑮:E-string 剝除不得吞掉它後面的真 DDL(R4 F1;吞了就少豁免 ⇒ 誤擋)" \
  "$(run_gate "$RCK" "refs/heads/dev $TK refs/heads/dev $BK")"

# ⑮b 可達性:同一份 fixture 拿掉帳本那一列 ⇒ 必須擋(證明 ⑮ 的綠是【豁免】給的, 不是整族靜音)
RCK2="$WORK/rck2"; setup_repo "$RCK2"
cat > "$RCK2/supabase/migrations/20260101000007_estr2.sql" <<'SQL'
CREATE TABLE public.audit_log3 (stmt text);
INSERT INTO public.audit_log3(stmt) VALUES ('manual_phone');
ALTER TABLE public.things ADD COLUMN pcm_estr2_col text DEFAULT 'x';
SQL
( cd "$RCK2" && git add -A && git commit -qm "base: 同一份 fixture, 而【沒有】記進帳本" )
cat > "$RCK2/supabase/migrations/20260111000000_recol2.sql" <<'SQL'
ALTER TABLE public.things ADD COLUMN IF NOT EXISTS pcm_estr2_col text;
SQL
cat > "$RCK2/apps/admin/src/readerK.ts" <<'TS'
export async function readIt(sb: any) {
  return sb.from('things').select('id, pcm_estr2_col');
}
TS
( cd "$RCK2" && git add -A && git commit -qm "feat: 冪等重貼同一欄 + 讀它" )
BK2="$(cd "$RCK2" && git rev-parse HEAD~1)"; TK2="$(cd "$RCK2" && git rev-parse HEAD)"
expect_block "欄⑮b 可達性:同一份 fixture 拿掉帳本那一列 ⇒ 必須擋" \
  "$(run_gate "$RCK2" "refs/heads/dev $TK2 refs/heads/dev $BK2")" "things.pcm_estr2_col"

# 🔴🔴 欄⑯ / ⑯b 是 R4 F2 的證人:**引號識別字含【真的】ERE metachar。**
#    ⛔ ~~欄⑭ 用的是 `Order-Items` / `gross-margin`~~ —— 連字號**既不在逃逸字元集裡、也不是 metachar**
#      ⇒ 📌 **它走的是「不需要逃逸」那條路** ⇒ 標籤說「含 metachar」而 oracle 驗的是別件事。
#    ✅ 這兩格用**真的會壞**的字元:`.`(⑯)與 `(` `)`(⑯b)。
RCL="$WORK/rcl"; setup_repo "$RCL"
cat > "$RCL/supabase/migrations/20260112000000_dot.sql" <<'SQL'
ALTER TABLE public."Order.Items" ADD COLUMN "gross.margin" numeric;
SQL
cat > "$RCL/apps/admin/src/readerL.ts" <<'TS'
export async function readIt(sb: any) {
  return sb.from('Order.Items').select('id, gross.margin');
}
TS
( cd "$RCL" && git add -A && git commit -qm "feat: 引號識別字含句點的加欄 + 讀它" )
BL="$(cd "$RCL" && git rev-parse HEAD~1)"; TL="$(cd "$RCL" && git rev-parse HEAD)"
expect_block "欄⑯:引號識別字含句點 ⇒ 逃逸後仍要比得到(R4 F2;多逃一層就變 no-op)" \
  "$(run_gate "$RCL" "refs/heads/dev $TL refs/heads/dev $BL")" "Order.Items.gross.margin"

# ⑯b 括號類 —— 🔴 **這一格順便釘死 R4 自己的一個量具錯誤, 寫下來免得下一個人重查**:
#    R4 回報「`(` `)` 修完仍不匹配, 原因未確認」。
#    🔬 我複量:**那是它的量具, 不是這道閘** —— 這台機器的互動式 `grep` 是 **ugrep**(shell function,
#      來自 `~/.claude/shell-snapshots/`), 而本閘是 `#!/usr/bin/env bash` ⇒ 它跑到的是 `/usr/bin/grep`。
#      同一個 pattern:`ugrep` ⇒ 不匹配 · `/usr/bin/grep` ⇒ **命中**(六類逐一測, 負對照全不中)。
#    ⇒ 📌 那正是 CLAUDE.md「人跟腳本跑的是不是同一支程式」那一條, 而這一格是它的第 N 個實例。
RCM="$WORK/rcm"; setup_repo "$RCM"
cat > "$RCM/supabase/migrations/20260113000000_paren.sql" <<'SQL'
ALTER TABLE public."tbl(1)" ADD COLUMN "col[2]" numeric;
SQL
cat > "$RCM/apps/admin/src/readerM.ts" <<'TS'
export async function readIt(sb: any) {
  return sb.from('tbl(1)').select('id, col[2]');
}
TS
( cd "$RCM" && git add -A && git commit -qm "feat: 引號識別字含括號與方括號 + 讀它" )
BM="$(cd "$RCM" && git rev-parse HEAD~1)"; TM="$(cd "$RCM" && git rev-parse HEAD)"
expect_block "欄⑯b:引號識別字含括號/方括號 ⇒ 一樣要比得到(R4 F2 的「未確認」其實是它的量具)" \
  "$(run_gate "$RCM" "refs/heads/dev $TM refs/heads/dev $BM")" "tbl(1).col[2]"

# 🔴🔴 欄⑰ / ⑰b 是 R4 F3 的證人:**`FULL` 是整支檔原文, 註解沒剝。**
#    🔬 R4 在**真的 dev** 上量到(`dev~40..dev`):前一顆 rc=0, 加了這一族之後 rc=1,
#      而擋的那支檔 `packages/domain/src/payment/anomaly-alert.ts` 對那兩個字的命中**全在註解裡**
#      ⇒ 🛑 **一句註解會擋住全隊的 push, 而那是這一族造成的。**
RCN="$WORK/rcn"; setup_repo "$RCN"; add_pending_col "$RCN"
cat > "$RCN/apps/admin/src/readerN.ts" <<'TS'
/**
 * 這支檔【只在註解裡】提到 things 與 pcm_probe_col ——
 * 它一行碼都沒有讀那一欄。
 */
// things.pcm_probe_col 也出現在這一行, 而它也是註解
export const unrelatedN = 1;
TS
( cd "$RCN" && git add -A && git commit -qm "feat: 加欄 migration + 一支只在註解提到那兩個字的檔" )
BN="$(cd "$RCN" && git rev-parse HEAD~1)"; TN="$(cd "$RCN" && git rev-parse HEAD)"
expect_pass "欄⑰:表名與欄名【只出現在註解裡】⇒ 不擋(R4 F3;註解不會發 PostgREST 請求)" \
  "$(run_gate "$RCN" "refs/heads/dev $TN refs/heads/dev $BN")"

# ⑰b 可達性:同一支檔把那兩個字從註解搬進碼 ⇒ 必須擋(證明 ⑰ 的綠是【剝註解】給的)
RCN2="$WORK/rcn2"; setup_repo "$RCN2"; add_pending_col "$RCN2"
cat > "$RCN2/apps/admin/src/readerN.ts" <<'TS'
export async function readIt(sb: any) {
  return sb.from('things').select('id, pcm_probe_col');
}
TS
( cd "$RCN2" && git add -A && git commit -qm "feat: 同一份 fixture, 而那兩個字在【碼】裡" )
BN2="$(cd "$RCN2" && git rev-parse HEAD~1)"; TN2="$(cd "$RCN2" && git rev-parse HEAD)"
expect_block "欄⑰b 可達性:同樣兩個字搬進碼 ⇒ 必須擋" \
  "$(run_gate "$RCN2" "refs/heads/dev $TN2 refs/heads/dev $BN2")" "things.pcm_probe_col"

# 🛑 **R3 B2 / D2 的【未驗】要寫在這裡, 不要假裝有格子**:
#    「路徑仍在 tree 裡, 而它的 blob 讀不到」這個世界 —— **我構造不出來**:
#    同一支檔的 `git diff -U0 BASE local_sha -- <af>`(本閘更早的一步)也要讀那顆 blob,
#    ⇒ 物件一缺, 它會先在**外層**那道 fail-closed 紅掉, 到不了 `FULL` 這一段。
#    ⇒ 📌 `ls-tree` 分類那個修法**照樣是對的**(它把分類與讀取分開), 而**它沒有證人**。
#      哪一天有人做得出 partial-clone / promisor 的 fixture, 這裡補一格。

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
echo "── 射程邊界(刻意漏擋,寫成格子才不會被誤讀成 bug)──"

R7="$WORK/r7"; setup_repo "$R7"
cat > "$R7/supabase/migrations/20260102000000_pending.sql" <<'SQL'
ALTER TABLE public.things ADD COLUMN pcm_new_column text;
SQL
cat > "$R7/apps/admin/src/consumer.ts" <<'TS'
export const col = 'pcm_new_column';
TS
( cd "$R7" && git add -A && git commit -qm "feat: pending migration 只加欄位、app 用了那個欄位名" )
B7="$(cd "$R7" && git rev-parse HEAD~1)"; T7="$(cd "$R7" && git rev-parse HEAD)"
# 🔴 **R2 MF6:這一格的標籤在 2026-09-06 之後【不再成立】** ——
#    ⛔ ~~「pending 只加欄位 ⇒ 放行(Sean 拍 Q2=B)」~~ **欄位已經納入了**(Sean `Q-閘看欄=甲`)。
#    ✅ 它今天仍然放行, 而**理由換了**:這支 app 檔**只有欄名、沒有表名** ⇒ 尺二不算命中。
#    📌 標籤改成講【真正的理由】—— 一個講錯理由的綠格, 會讓下一個人以為欄位那一族沒生效。
expect_pass "⑩:pending 只加欄位、而 app 檔只提到欄名沒提到表名 ⇒ 放行(尺二:要同檔共現)" \
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

# ── 格㊺:🔴🔴 **hook 的離場碼真的來自那條 `&&` 鏈嗎**(2026-09-04 實錘, 線 -db)──
#   病灶:`&&` 鏈後面被加了一個 `if [ -f …always-loaded-size-gate.sh ]` 區塊
#   ⇒ **hook 的離場碼變成【那個區塊的】** ⇒ typecheck 紅了照樣放行。
#   🔬 當場拿真的檔實跑(pnpm 換成必紅的樁):**rc=0** —— 那道保護從來沒有接上。
#   📌 而 `.husky/pre-push` 的**第 1 行註解逐字寫過這個病**(「第一版寫成兩行…離場碼是最後一行的」)
#      ⇒ 它被修好過, 而後來加的區塊把它裝回去了 ⇒ **一段講對了的註解擋不住同一個病復發。**
#   🔴 `sh -e` 只救得了【末段】(R1 訂正):AND-OR 串列裡非末段的失敗被 errexit 豁免,
#      末段的照樣觸發 ⇒ **fail-open 涵蓋第 1-4 支, 第 5 支本來就擋得住。**
#   ⇒ 修法 = 那一行尾巴 `|| exit $?`(不是 `|| exit 1` —— 鏈裡有三態閘, 壓成 1 會吃掉 2/9;
#      格⑱ 那三串字面一字未動)。
#   正對照:真的 hook + 必紅的 pnpm 樁 ⇒ 必須非 0(鏈在第一段就中止, 秒級)
#   🔴 負對照用**突變**不用綠樁:綠樁那一發會去跑真的閘(分鐘級), 而突變同樣證得出判別力 ——
#      把 `|| exit 1` 拿掉的副本 ⇒ 必須回 0。沒有它, 這一格會恆綠。
# 🔴 R1 must-fix:**不另開一個沒人管的目錄** —— 旁邊的 `$WORK` 已經有 EXIT trap(:85),
#    而裸 `mktemp -d` 失敗時本檔 `set -uo pipefail`(無 `-e`)不會停 ⇒ `_pp_stub=""`
#    ⇒ `PATH=":$PATH"` 會拿【真的 pnpm】跑整套 typecheck+lint+四支 gate(分鐘級),
#      而最後那句 `rm -rf ""` 正是本檔 :84 警告過的「看起來像它清乾淨了」。
_pp_stub="$WORK/pp45"
mkdir -p "$_pp_stub" || bad "㊺ 建不出工作目錄"
printf '#!/bin/sh\nexit 1\n' > "$_pp_stub/pnpm" && chmod +x "$_pp_stub/pnpm"
_pp_hook="$(cd "$(dirname "$0")/.." && pwd)/.husky/pre-push"
_pp_mut="$_pp_stub/pre-push-mutated"
# 🔴 R1 must-fix:突變**只打鏈尾那一行**, 不用 `s/ || exit \$?$//` 全檔剝 ——
#    `.husky/pre-push:42` 的 `_T="$(mktemp)" || exit 1` 也會被打到, 而突變不該是多點的。
sed 's/\(selftest-git-isolation-gate\.sh" < \/dev\/null\) || exit \$?/\1/' "$_pp_hook" > "$_pp_mut"
# 🔴 R1 must-fix:**先驗突變有沒有套上** —— 日後鏈尾字面一改, sed 零命中 ⇒ 突變 ≡ 原檔
#    ⇒ 本格會紅在「負對照無力」, 而真因是「突變沒落在目標上」。兩者要分得開。
if cmp -s "$_pp_hook" "$_pp_mut"; then
  bad "㊺ 突變沒套上(sed 零命中 ⇒ 副本與原檔逐位元組相同)⇒ 鏈尾字面變了, 去對 .husky/pre-push"
else
  # 🔵 R1 nit:負對照 `_pp_mutated=0` 的前提是 `always-loaded-size-gate.sh --at-head` 回 0。
  #    CLAUDE.md 逼近 HARD 上限時它會回非 0 ⇒ 本格會印「負對照無力」而真因是別的檔胖了。
  #    ⇒ 先量一發, 被汙染時說「無法判定」, 不要報成本格失效。
  sh "$(dirname "$_pp_hook")/always-loaded-size-gate.sh" --at-head > /dev/null 2>&1
  _pp_sizegate=$?
  PATH="$_pp_stub:$PATH" sh -e "$_pp_hook" < /dev/null > /dev/null 2>&1 ; _pp_real=$?
  PATH="$_pp_stub:$PATH" sh -e "$_pp_mut"  < /dev/null > /dev/null 2>&1 ; _pp_mutated=$?
  if [ "$_pp_sizegate" -ne 0 ]; then
    bad "㊺ 無法判定(被 size gate 汙染):always-loaded-size-gate --at-head rc=$_pp_sizegate ⇒ 突變那一發不論修法對錯都會非 0"
  elif [ "$_pp_real" -ne 0 ] && [ "$_pp_mutated" -eq 0 ]; then
    ok "㊺ pre-push 離場碼:三綠紅 ⇒ 擋(rc=$_pp_real);拿掉鏈尾 || exit \$? 的突變 ⇒ 放行(rc=$_pp_mutated)= 負對照有力"
  else
    bad "㊺ pre-push 離場碼失效或負對照無力:真檔=[$_pp_real](期望非 0)/ 突變=[$_pp_mutated](期望 0)"
  fi
fi

# ══ 🟠 補版控型標記在【擋人訊息】上的兩個世界(⟦0e-DDLINTOVC-MARK⟧;-f8 2026-09-06 裁甲)══
#
# 🛑 **這兩格量的是【訊息】不是【放行與否】—— 而那正是設計** :
#    本閘逐字寫著「刻意不提供【打一行宣告就過】的欄位(那種例外兩次被對抗審查證明是儀式)」
#    ⇒ `pcm:ddl-into-vc` 是一個檔頭註解 = 就是那種宣告 ⇒ **它不得改變 rc**。
#    🔵 那它為什麼還要印:補版控型的物件在正式庫上早就有了 ⇒ 這一擋很可能是誤擋,
#      而讀的人若沒看到這句, 會照出路①「先 apply」去做 —— 那是對補版控型最不該做的事。
echo "── 補版控型標記(只改訊息, 不改 rc)────────────────"

RVC="$WORK/rvc"; setup_repo "$RVC"
cat > "$RVC/supabase/migrations/20260102000000_pending.sql" <<'SQL'
-- pcm:ddl-into-vc: public.pcm_a9h_probe
CREATE OR REPLACE FUNCTION public.pcm_a9h_probe(p_order_id uuid, p_note text)
RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;
SQL
cat > "$RVC/apps/admin/src/consumer.ts" <<'TS'
export async function callIt(sb: any) {
  return sb.rpc('pcm_a9h_probe', { p_order_id: 'x', p_note: 'y' });
}
TS
( cd "$RVC" && git add -A && git commit -qm "feat: 補版控型 pending + 呼叫端" )
BVC="$(cd "$RVC" && git rev-parse HEAD~1)"; TVC="$(cd "$RVC" && git rev-parse HEAD)"
RESVC="$(run_gate "$RVC" "refs/heads/dev $TVC refs/heads/dev $BVC")"
expect_block "㊻ 世界一:pending 帶 pcm:ddl-into-vc ⇒ **仍然擋**(標記不是放行券)"   "$RESVC" "pcm_a9h_probe"
if printf '%s' "${RESVC#*|}" | grep -qF '補版控型'; then
  ok "㊼ 世界一:訊息點名它是補版控型(否則讀的人會去「先 apply」—— 對這一型最不該做的事)"
else
  bad "㊼ 世界一:rc 對而訊息【沒有】點名補版控型 ⇒ 那道提示等於不存在"
fi
if printf '%s' "${RESVC#*|}" | grep -qF 'public.pcm_a9h_probe'; then
  ok "㊽ 世界一:把標記裡的物件名【原樣】帶出來(不是只說「有標記」)"
else
  bad "㊽ 世界一:沒有把標記的物件名帶出來"
fi

# 🔴 世界二:**同一組 fixture 只差那一行** —— 換了 fixture 就不是在量那一行。
RVC2="$WORK/rvc2"; setup_repo "$RVC2"
add_pending_migration "$RVC2"
cat > "$RVC2/apps/admin/src/consumer.ts" <<'TS'
export async function callIt(sb: any) {
  return sb.rpc('pcm_a9h_probe', { p_order_id: 'x', p_note: 'y' });
}
TS
( cd "$RVC2" && git add -A && git commit -qm "feat: 一般 pending + 呼叫端" )
BV2="$(cd "$RVC2" && git rev-parse HEAD~1)"; TV2="$(cd "$RVC2" && git rev-parse HEAD)"
RESV2="$(run_gate "$RVC2" "refs/heads/dev $TV2 refs/heads/dev $BV2")"
expect_block "㊾ 世界二:同一支【拿掉標記】⇒ 照樣擋" "$RESV2" "pcm_a9h_probe"
if printf '%s' "${RESV2#*|}" | grep -qF '補版控型'; then
  bad "㊿ 世界二:沒有標記卻印了補版控型 ⇒ 那句話是恆印的, 對【有沒有標記】零判別力"
else
  ok "㊿ 世界二:沒有標記 ⇒ 補版控型那段不印(證明㊼ 的綠不是恆綠)"
fi

# ── 🔴 codex 2026-09-06 R1 的三格回歸(MF3 跨 ref / MF4 反斜線截斷 / MF8 空標記靜默)──
RVC3="$WORK/rvc3"; setup_repo "$RVC3"
# MF4:標記值裡塞一個 `\c` —— `printf '%b'` 會在那裡【停止輸出而 rc=0】
cat > "$RVC3/supabase/migrations/20260102000000_pending.sql" <<'SQL'
-- pcm:ddl-into-vc: public.zz\ctrap
CREATE OR REPLACE FUNCTION public.pcm_a9h_probe(p_order_id uuid, p_note text)
RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;
SQL
cat > "$RVC3/apps/admin/src/consumer.ts" <<'TS'
export async function callIt(sb: any) {
  return sb.rpc('pcm_a9h_probe', { p_order_id: 'x', p_note: 'y' });
}
TS
( cd "$RVC3" && git add -A && git commit -qm "feat: 標記值含反斜線" )
B3="$(cd "$RVC3" && git rev-parse HEAD~1)"; T3="$(cd "$RVC3" && git rev-parse HEAD)"
RES3="$(run_gate "$RVC3" "refs/heads/dev $T3 refs/heads/dev $B3")"
if printf '%s' "${RES3#*|}" | grep -qF '不要照下面的出路①去「先 apply」'; then
  ok "51 MF4:標記值含反斜線 ⇒ 後面的安全提示【沒有】被 printf %b 截斷"
else
  bad "51 MF4:標記值含反斜線 ⇒ 安全提示被截斷(printf %b 遇跳脫停止輸出而 rc=0)"
fi

# MF8:冒號後面是空的 ⇒ 要出聲, 不得靜默當成沒標記
RVC4="$WORK/rvc4"; setup_repo "$RVC4"
cat > "$RVC4/supabase/migrations/20260102000000_pending.sql" <<'SQL'
-- pcm:ddl-into-vc:
CREATE OR REPLACE FUNCTION public.pcm_a9h_probe(p_order_id uuid, p_note text)
RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;
SQL
cat > "$RVC4/apps/admin/src/consumer.ts" <<'TS'
export async function callIt(sb: any) {
  return sb.rpc('pcm_a9h_probe', { p_order_id: 'x', p_note: 'y' });
}
TS
( cd "$RVC4" && git add -A && git commit -qm "feat: 空標記" )
B4="$(cd "$RVC4" && git rev-parse HEAD~1)"; T4="$(cd "$RVC4" && git rev-parse HEAD)"
RES4="$(run_gate "$RVC4" "refs/heads/dev $T4 refs/heads/dev $B4")"
if printf '%s' "${RES4#*|}" | grep -qF '標記不完整'; then
  ok "52 MF8:冒號後空的 ⇒ 出聲說標記不完整(不是靜默當成沒標記)"
else
  bad "52 MF8:冒號後空的被靜默忽略 ⇒ 一個看起來有標記的檔會安靜地不算"
fi
if printf '%s' "${RES4#*|}" | grep -qF '補版控型'; then
  bad "53 MF8:空標記卻仍被當成補版控型"
else
  ok "53 MF8:空標記 ⇒ 不算補版控型(照一般 pending 處理)"
fi

# MF3:兩個 ref 一起推 ⇒ 每一項要帶自己的 ref, 不得串到別的 ref
RES5="$(run_gate "$RVC" "refs/heads/dev $TVC refs/heads/dev $BVC
refs/heads/main $TVC refs/heads/main $BVC")"
# 🔴 **codex 2026-09-06 R2**:第一版只驗「有沒有帶 `[ref `」⇒ **兩項都硬寫成 dev 照樣綠**,
#    而這一格的標籤說的是「各自的 ref」。⇒ 📌 標籤說 A 而斷言驗 B, 今晚第三次。
#    ✅ 改成驗【dev 那一項掛 dev、main 那一項掛 main】, 兩者都要有。
_n_ref=$(printf '%s' "${RES5#*|}" | grep -c '⇒ 標記說物件是')
_n_dev=$(printf '%s' "${RES5#*|}" | grep -c '⇒ 標記說物件是.*\[ref refs/heads/dev\]')
_n_main=$(printf '%s' "${RES5#*|}" | grep -c '⇒ 標記說物件是.*\[ref refs/heads/main\]')
if [ "$_n_ref" = "2" ] && [ "$_n_dev" = "1" ] && [ "$_n_main" = "1" ]; then
  ok "54 MF3:多 ref 時 dev 那項掛 dev、main 那項掛 main(各 1 項, 不是「有帶就算」)"
else
  bad "54 MF3:多 ref 標記歸屬錯 —— 總 $_n_ref 項 / dev $_n_dev / main $_n_main(期望 2/1/1)"
fi

# ── 🔴 `0 pending` 的兩個世界(⟦db-DOGBLINDBRANCH⟧;-f8 2026-09-06 裁甲修法 1)──────
#    量的是【訊息】不是 rc —— 本次修法刻意零 rc 改動。
BLIND='0 pending 的意思是'

# 世界一:0 pending ⇒ **必印**那句
RB1="$WORK/rb1"; setup_repo "$RB1"
cat > "$RB1/apps/admin/src/unrelated.ts" <<'TS'
export const unrelated = 2;
TS
( cd "$RB1" && git add apps/admin/src/unrelated.ts && git commit -qm "只有 app, 零 pending" )
BB1="$(cd "$RB1" && git rev-parse HEAD~1)"; TB1="$(cd "$RB1" && git rev-parse HEAD)"
RESB1="$(run_gate "$RB1" "refs/heads/dev $TB1 refs/heads/dev $BB1")"
if printf '%s' "${RESB1#*|}" | grep -qF "$BLIND"; then
  ok "55 0 pending ⇒ 印出「別條分支上的我看不到」(盲區與乾淨不再同一句)"
else
  bad "55 0 pending 沒有印那句 ⇒ 盲區與乾淨仍印同一行字"
fi
if [ "${RESB1%%|*}" = "0" ]; then ok "55b 而它零 rc 改動(仍然放行)"
else bad "55b rc 變了($RESB1)—— 本修法只該多印一句"; fi

# 世界二:有 pending ⇒ **不印**(否則那句是恆印的, 對「有沒有盲區」零判別力)
RB2="$WORK/rb2"; setup_repo "$RB2"
add_pending_migration "$RB2"
cat > "$RB2/apps/admin/src/unrelated.ts" <<'TS'
export const unrelated = 3;
TS
( cd "$RB2" && git add supabase/migrations/20260102000000_pending.sql apps/admin/src/unrelated.ts && git commit -qm "有 pending" )
BB2="$(cd "$RB2" && git rev-parse HEAD~1)"; TB2="$(cd "$RB2" && git rev-parse HEAD)"
RESB2="$(run_gate "$RB2" "refs/heads/dev $TB2 refs/heads/dev $BB2")"
if printf '%s' "${RESB2#*|}" | grep -qF "$BLIND"; then
  bad "56 有 pending 卻仍印那句 ⇒ 它是恆印的, 對「0 pending」零判別力"
else
  ok "56 有 pending ⇒ 不印那句(證明 55 的綠不是恆綠)"
fi

# 🔴 世界三:**真的盲區** —— migration 只活在別條分支上, 而 app 這邊照樣放行。
#    ⛔ 我第一版把這一格寫成【無條件 `ok`】+ 一串沒有斷言的 checkout ——
#      那是本 repo 記過最壞的形狀(判定標籤不由結果決定)。⇒ 真的造那個世界。
#    🛑 這一格記的是**危險本身**, 它今天仍然成立:修法 1 只多印一句, **不改 rc**。
RB3="$WORK/rb3"; setup_repo "$RB3"
( cd "$RB3" && git checkout -qb line-db )
add_pending_migration "$RB3"
( cd "$RB3" && git add supabase/migrations/20260102000000_pending.sql && git commit -qm "db 分支上的 migration" )
( cd "$RB3" && git checkout -q - )
DEVB3="$(cd "$RB3" && git rev-parse HEAD)"
cat > "$RB3/apps/admin/src/consumer.ts" <<'TS'
export async function callIt(sb: any) {
  return sb.rpc('pcm_a9h_probe', { p_order_id: 'x', p_note: 'y' });
}
TS
( cd "$RB3" && git add apps/admin/src/consumer.ts && git commit -qm "front: 只有呼叫端" )
TB3="$(cd "$RB3" && git rev-parse HEAD)"
RESB3="$(run_gate "$RB3" "refs/heads/dev $TB3 refs/heads/dev $DEVB3")"
if [ "${RESB3%%|*}" = "0" ]; then
  ok "57 盲區世界:migration 只在別條分支 ⇒ **仍然放行**(記錄危險本身, 修法 1 不改 rc)"
else
  bad "57 盲區世界的 rc 變了(${RESB3%%|*})—— 若這是刻意的, 三世界表與本格都要一起改"
fi
if printf '%s' "${RESB3#*|}" | grep -qF "$BLIND"; then
  ok "57b 而它**有印出那句警告** ⇒ 讀的人分得出自己在盲區而不是乾淨"
else
  bad "57b 盲區世界沒印警告 ⇒ 它與【真的乾淨】仍印同一行字"
fi

echo
echo "══ 結果:PASS=$PASS FAIL=$FAIL(期望 PASS=$EXPECT_TOTAL)══"
if [ "$FAIL" -eq 0 ] && [ "$PASS" -ne "$EXPECT_TOTAL" ]; then
  echo "🔴 零 FAIL 但格數不對(PASS=$PASS ≠ EXPECT_TOTAL=$EXPECT_TOTAL)⇒ 有格被刪/被跳過,判為未通過"; exit 1
fi
[ "$FAIL" -eq 0 ] || exit 1
