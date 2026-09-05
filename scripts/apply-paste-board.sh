#!/bin/bash
# ============================================================
# apply-paste-board.sh — 主視窗依 Sean「貼 <編號>」代貼正式庫
# ============================================================
# plan  docs/plans/2026-09-06-apply-paste-board-plan.md
# 說明  docs/runbooks/apply-paste-board.md
#
# 🛑🛑 **授權**(Sean 2026-09-06 02:4x 逐字, `~/pcm-mailbox/端Sean-0905早上佇列.md` §AK):
#    「甲 = 開:你每次回一個字『貼 <編號>』我才貼, 一次一支, 貼完回你結果」
#    ⇒ **一次一支** / **只在他點名那一支之後** / **貼完回結果**。三個限定一個都不能少。
#    🔴 同段逐字「工具沒做好前本授權【尚未生效】」⇒ **這支工具不是授權, 它是授權的前提。**
#    🔴 **跑它的是主視窗。** 施工窗逐字「唯讀與 apply 是兩個授權, 而 Sean 只給了前一個」。
#
# 🔴🔴 **本檔是 v3。** v1 被 codex R1 判 FAIL(約 30 條)⇒ v2 重寫;v2 被 R2 判 FAIL(約 20 條)
#    ⇒ **v3 換路**:整層啟發式刪掉, 改問平台帳本本身。R3 判 FAIL(13 條)⇒ 本版逐條修。
#    v1 最狠的六條(留在這裡, 因為它們是這一版每一道防線的理由):
#      ① `--db-url` / `--root` / `APB_*` 在正式模式一樣生效 ⇒ 可把任意 migration 貼到任意庫
#      ② psql 的 URL 與 `supabase --linked` 的專案沒綁 ⇒ 寫進 A 而帳記到 B, 最後 rc=0
#      ③ 假設 `-1` 保證原子 —— 而 **repo 335 支裡 213 支自帶 BEGIN…COMMIT**, 那些 `-1` 無效
#      ④ runbook 叫 Sean 加進 `.env.local`, 而 v1 從來沒有載入那支檔
#      ⑤ `APPLIED.tsv` 不存在 ⇒ 被當成「零命中」放行
#      ⑥ selftest 有六塊恆綠區(把 repair / 半套處理 / --dry-run 保護換成 no-op ⇒ 16 格全綠)
#    📌 而 ⑥ 的意思是:**我當時報的「突變四發各打紅不同的格」是真的, 而它只涵蓋四條路。**
#
# 🔬 **交易那一格的三分**(2026-09-06 當場掃 `supabase/migrations` 335 支, 剝註解/字串/`$tag$`):
#      ① 零交易控制(真的靠 psql -1)      **122** 支
#      ② 乾淨包一層 BEGIN…COMMIT          **213** 支  ⇒ **不帶 `-1`**, 檔案自己保證原子
#      ③ 其他形狀(中途 COMMIT / 只有一半)  **0** 支  ⇒ **停下印「要人判」**
#    🔴 ⛔ ~~「自帶 BEGIN/COMMIT 一律拒收」~~ —— **那會拒掉 213/335 = 64%**,
#      而那不是例外, 是這個 repo 的**常態寫法**。(`-f8` 2026-09-06 收回原句。)
#    🎯 codex 那條的正確結論不是「拒收」, 是 **「別假裝 `-1` 在每一支上都有效」**。
#
# 🛑 **它答不出什麼**
#    · 拋棄式 PG 與正式庫**不是同一個世界** ⇒ selftest 全綠證不了「對正式庫也會這樣」。
#    · ⛔ ~~前置⑦ 用 `pcm_readonly`, 讀不到 `supabase_migrations` ⇒ 它答「物件在不在」~~
#      **v3 起不成立**:前置⑦ 改問平台帳本本身, 走【寫入】那條連線。
#      🔵 而它答的是「**平台帳本有沒有記**」—— 不是「東西在不在」。那兩件事今晚分岔過。
#    · **沒有自動 rollback** —— 沒有 down 腳本的 migration 就沒有回頭路。
#      ⇒ 📌 **「一次一支 + Sean 逐支點名」不是流程繁瑣, 它是這片唯一的 rollback。**
# ============================================================
set -u

MAIN_TREE=/Users/sean_1/pcm-website-v2
PSQL_BIN=/opt/homebrew/bin/psql
SUPABASE_BIN=/opt/homebrew/bin/supabase

note() { printf '%s\n' "$@" >&2; }
die()  { note "$@"; exit 1; }

# 🔴 sha 要 pipefail, 而且要驗形狀 —— `shasum` 不在 / 失敗時, 兩邊都會拿到空字串而「相同」。
sha_of() {
  local out rc
  out=$(set -o pipefail; shasum -a 256 "$1" 2>/dev/null | cut -d' ' -f1) ; rc=$?
  if [ "$rc" != "0" ] || [ ${#out} != 64 ]; then
    note "🔴 算不出 $1 的 sha256(rc=$rc, 長度 ${#out})⇒ fail-closed。"
    note "   🛑 空的 sha 會讓「兩邊相同」這個判斷變成恆真。"
    return 1
  fi
  printf '%s' "$out"
}

# 🔴 TAB 與換行會把 TSV 切成別的欄, 也會讓 `cut -f` 取到另一個檔。
# 🔴 ⛔ ~~`case "$1" in *"$(printf '\n')"*`~~ —— **命令替換會吃掉結尾換行**
#    ⇒ `$(printf '\n')` 是**空字串** ⇒ 樣式變成 `*""*` ⇒ **命中每一條路徑**。
#    實測:v2 第一發 42 格裡 17 格紅, 全部紅在「路徑含 TAB 或換行」而路徑乾乾淨淨。
#    ⇒ 📌 一個代表【沒有】的值, 讓一道守門變成恆真。
has_bad_char() {
  case "$1" in *$'\t'*) return 0 ;; esac
  [ "$(printf '%s' "$1" | wc -l | tr -d ' ')" != "0" ] && return 0
  return 1
}

# ── 交易形狀:剝掉註解 / 單引號字串 / $tag$ 塊之後看頂層 ──────────
# 遮罩後的原文(剝 -- 註解 / 巢狀區塊註解 / 單引號字串 / $tag$ 塊), 行數與欄位不變。
# 🔵 與 txn_shape 共用同一套遮罩 —— 兩個地方用同一把尺, 而不是各寫各的。
mask_sql() {
  python3 - "$1" <<'MPYEOF'
import re,sys,io
src=io.open(sys.argv[1],encoding='utf-8',errors='replace').read()
out=list(src); i=0; n=len(src)
def blank(a,b):
    for k in range(a,min(b,n)):
        if out[k]!='\n': out[k]=' '
while i<n:
    c=src[i]
    if c=='-' and i+1<n and src[i+1]=='-':
        j=src.find('\n',i); j=n if j<0 else j; blank(i,j); i=j
    elif c=='/' and i+1<n and src[i+1]=='*':
        depth=1; j=i+2
        while j<n and depth>0:
            if src[j]=='/' and j+1<n and src[j+1]=='*': depth+=1; j+=2
            elif src[j]=='*' and j+1<n and src[j+1]=='/': depth-=1; j+=2
            else: j+=1
        blank(i,j); i=j
    elif c=="'":
        j=i+1
        while j<n:
            if src[j]=="'":
                if j+1<n and src[j+1]=="'": j+=2; continue
                break
            j+=1
        e=min(j+1,n); blank(i,e); i=e
    elif c=='$':
        m=re.match(r'\$[A-Za-z_0-9]*\$',src[i:])
        # 🔵 F10(opus R4):`$1$` 這種 **參數**會被當成 dollar-tag, 找不到收尾就遮到檔尾。
        #    ⇒ 找不到收尾時【只跳過這一個字元】, 不要吞掉整個檔。
        if not m: i+=1; continue
        tag=m.group(0); close=src.find(tag,i+len(tag))
        if close < 0: i+=1; continue
        e=close+len(tag); blank(i,e); i=e
    else: i+=1
sys.stdout.write(''.join(out))
MPYEOF
}

# 回傳 stdout:clean | none | messy
txn_shape() {
  python3 - "$1" <<'PYEOF'
import re,sys,io
src=io.open(sys.argv[1],encoding='utf-8',errors='replace').read()
out=list(src); i=0; n=len(src)
def blank(a,b):
    for k in range(a,min(b,n)):
        if out[k]!='\n': out[k]=' '
while i<n:
    c=src[i]
    if c=='-' and i+1<n and src[i+1]=='-':
        j=src.find('\n',i); j=n if j<0 else j; blank(i,j); i=j
    elif c=='/' and i+1<n and src[i+1]=='*':
        # 🔴 PostgreSQL 的區塊註解【可以巢狀】(codex R3 B)。找第一個 */ 會提早結束,
        #    而剩下那半的假 BEGIN/COMMIT 就被當成碼。這裡改成數深度。
        depth=1; j=i+2
        while j<n and depth>0:
            if src[j]=='/' and j+1<n and src[j+1]=='*': depth+=1; j+=2
            elif src[j]=='*' and j+1<n and src[j+1]=='/': depth-=1; j+=2
            else: j+=1
        blank(i,j); i=j
    elif c=="'":
        j=i+1
        while j<n:
            if src[j]=="'":
                if j+1<n and src[j+1]=="'": j+=2; continue
                break
            j+=1
        e=min(j+1,n); blank(i,e); i=e
    elif c=='$':
        m=re.match(r'\$[A-Za-z_0-9]*\$',src[i:])
        if not m: i+=1; continue
        tag=m.group(0); close=src.find(tag,i+len(tag))
        e=n if close<0 else close+len(tag); blank(i,e); i=e
    else: i+=1
masked=''.join(out)
# 🔴 **以【語句】切, 不是以【行】切**(codex R3 B):`COMMIT; CREATE …` 寫在同一行時,
#    行為判準會判成 clean, 而 COMMIT 之後那一句其實在交易外執行。
stmts=[t.strip() for t in masked.split(';')]
stmts=[t for t in stmts if t]
TXN=re.compile(r'^(BEGIN|START\s+TRANSACTION|COMMIT|END|ROLLBACK|ABORT)(\s+(WORK|TRANSACTION))?$', re.I)
kinds=[]
for idx,t in enumerate(stmts):
    m=TXN.match(' '.join(t.split()))
    if m: kinds.append((idx, m.group(1).upper()))
if not kinds: print('none'); raise SystemExit
seq=[k for _,k in kinds]
# 乾淨 = 第一個語句是 BEGIN(或 START TRANSACTION)、最後一個是 COMMIT(或 END), 中間零交易控制
first_ok = kinds[0][0]==0 and seq[0] in ('BEGIN','START')
last_ok  = kinds[-1][0]==len(stmts)-1 and seq[-1] in ('COMMIT','END')
if len(kinds)==2 and first_ok and last_ok:
    print('clean')
else:
    print('messy')
PYEOF
}

# ── 前置 ①-⑥ ────────────────────────────────────────────────
# 🔴🔴 **stdout 是回傳值, 不是講話** —— 所有資訊性輸出走 `note`(已 `>&2`)。
#    v1 兩者共用 stdout ⇒ 呼叫端 cut 出來的「路徑」夾著中文 ⇒ psql 回
#    `No such file or directory` 而那個檔明明存在。
#    ⇒ 📌 那句錯誤讀起來像【檔案系統的問題】, 而它是【管線的問題】。
#    (已投 traps:`docs/patterns/traps-inbox/db-20260906c-…`)
preflight() {
  local num root paste hits n ver mig s_paste s_mig led
  num="$1"; root="$2"

  # 🔴🔴 **F4(opus R4)**:⛔ ~~寫死 `貼板-0905`~~ —— **今天的板是 `貼板-0906`**
  #    (實測:`45a`~`45e` 五支)。而 fail-open 的變體更毒:**任何一天的板只要出現一個
  #    與別天重複的編號, 「貼 N」會靜靜解析到舊那一支**, sha 與兩本帳全過 ⇒ **貼錯支**。
  #    ⇒ 改成**掃全部 `貼板-*`**, 並要求**跨板唯一**;命中多支就把它們全印出來讓人挑。
  hits=$(find "$PASTE_ROOT" -maxdepth 2 -type f -path '*/貼板-*' -name "${num}_*.sql" 2>/dev/null | sort)
  n=$(printf '%s' "$hits" | grep -c . )
  if [ "$n" != "1" ]; then
    note "🔴 前置①:貼板編號 ${num} 在【全部貼板】裡命中 ${n} 支(要剛好 1 支)"
    note "   掃的是 $PASTE_ROOT/貼板-*"
    [ "$n" != "0" ] && printf '   %s\n' $hits >&2
    [ "$n" != "0" ] && note "   🛑 跨板同號 ⇒ 「貼 N」有兩個意思 ⇒ **請 Sean 講清楚是哪一板的 N**。"
    return 1
  fi
  note "  解析到的板:$(basename "$(dirname "$hits")")"
  paste="$hits"
  has_bad_char "$paste" && { note "🔴 前置①:貼板路徑含 TAB 或換行 ⇒ 拒。"; return 1; }

  s_paste=$(sha_of "$paste") || return 1
  note "  貼板檔 $(basename "$paste")"
  note "  貼板 sha256 $s_paste"

  ver=$(basename "$paste" | sed 's/^[0-9]*_//' | cut -c1-14)
  case "$ver" in
    [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]) : ;;
    *) note "🔴 前置③:檔名取不出 14 位版本號 ⇒ 取到 '$ver'"; return 1 ;;
  esac
  note "  版本號 $ver"

  hits=$(find "$root/supabase/migrations" -maxdepth 1 -type f -name "${ver}_*.sql" 2>/dev/null | sort)
  n=$(printf '%s' "$hits" | grep -c . )
  [ "$n" = "1" ] || { note "🔴 前置④:repo 裡 ${ver}_*.sql 命中 ${n} 支(要剛好 1 支)"; return 1; }
  mig="$hits"
  has_bad_char "$mig" && { note "🔴 前置④:migration 路徑含 TAB 或換行 ⇒ 拒。"; return 1; }

  s_mig=$(sha_of "$mig") || return 1
  if [ "$s_paste" != "$s_mig" ]; then
    note "🔴 前置⑤:貼板檔與 repo migration 檔【不是同一份內容】⇒ 停。"
    note "   貼板 $s_paste"
    note "   repo  $s_mig"
    note "   ── diff --stat(Sean/-f8 2026-09-06 Q3=乙:只印統計, 不印內容)──"
    diff "$mig" "$paste" 2>/dev/null | awk '/^</{a++} /^>/{b++} END{printf "   repo 獨有 %d 行 · 貼板獨有 %d 行\n", a+0, b+0}' >&2
    return 1
  fi
  note "  🟢 兩個 sha 相同 ⇒ 貼 repo 那一份(帳本第二欄記的就是它)"

  # ⑥ 帳本 —— 🔴 檔案【不存在】不是「零命中」, 是分母不見了。
  led="$root/supabase/APPLIED.tsv"
  [ -f "$led" ] || { note "🔴 前置⑥:找不到 $led ⇒ fail-closed。"; note "   🛑 帳本讀不到與帳本沒有這一列, 不是同一件事。"; return 1; }
  # 🔴 **讀得到與讀不到要分兩條路**(codex R3 B):`awk` 出錯與「查無版本」都回非 0
  #    ⇒ v3 之前兩者走同一條【放行】。先證它讀得動。
  if ! awk 'END{}' "$led" 2>/dev/null; then
    note "🔴 前置⑥:$led 存在而讀不動 ⇒ fail-closed。"; return 1
  fi
  if awk -F'\t' -v v="$ver" '!/^#/ && $1==v {found=1} END{exit !found}' "$led"; then
    note "🔴 前置⑥:$ver 已經在 APPLIED.tsv 第一欄 ⇒ 停(不重貼)。"
    awk -F'\t' -v v="$ver" '!/^#/ && $1==v {print "   帳上:" substr($0,1,160)}' "$led" >&2
    return 1
  fi

  printf '%s\t%s\t%s\t%s\n' "$ver" "$mig" "$paste" "$s_mig"
}

# ── 前置⑦:問【平台帳本】—— 而「還沒貼」要【兩本帳都說沒有】────────
# 🔴🔴 **v3 把整層啟發式刪掉了。** v1/v2 用「新物件在不在」與「函式 body md5」去
#    *推論* 一支 migration 貼了沒 —— codex 兩輪各打掉一層, 而**病灶是同一個**:
#    我在用一把量不到的尺。R2 逐字:「舊 migration 已套用、但函式被後片改版或 DROP 時,
#    舊 body 會全不符 ⇒ 程式因此**放行舊 migration, 覆蓋較新的函式**」。
#    ⇒ 🎯 **那個問題有一個權威答案, 而我一直沒去拿**:`supabase_migrations.schema_migrations`
#      就是平台帳本本身(`supabase migration list --linked` 讀的就是它)。
#    🔵 我當初繞路是因為唯讀身分 `pcm_readonly` 讀不到那個 schema ——
#      **而寫入那條連線不是 `pcm_readonly`。** 我把一個身分的限制帶進了設計。
#
# 🔴 **兩本帳都要說沒有**(`-f8` 2026-09-06 補):
#    · 平台帳本 `supabase_migrations.schema_migrations` 無此 version
#    · **且** `supabase/APPLIED.tsv` 第一欄無此版本(前置⑥ 已擋)
#    ⇒ 任一本有 ⇒ 停。🛑 **理由是量到的**:平台帳本今晚才補到還缺 65 支,
#      而**有些是在 SQL Editor 貼過卻沒 repair 的** ⇒ **只問平台帳本會重貼。**
#
# 🔵 同一條連線問、同一條連線寫 ⇒ 順帶解掉「寫進 A 而 repair B」那條。
platform_ledger_proof() {
  local ver url exists cnt rc
  ver="$1"; url="$2"
  # 🔴🔴 **拆成兩句, 不是一句** —— 第一版把「表在不在」與「有沒有這一列」寫在同一個
  #    query 裡:表不存在時**整句就錯**, 那個 `to_regclass` 的負對照**永遠不會被讀到**
  #    ⇒ 它是一道恆真的守門(我今晚剛投過同型的 traps)。
  exists=$("$PSQL_BIN" "$url" -X -q -A -t -v ON_ERROR_STOP=1 \
    -c "SELECT (to_regclass('supabase_migrations.schema_migrations') IS NOT NULL)::text" 2>&1) ; rc=$?
  if [ "$rc" != "0" ]; then
    note "🔴 前置⑦:連不上或查不動平台帳本 ⇒ fail-closed(**沒有查, 不是查無**)。"
    printf '%s\n' "$exists" | sed 's/^/   /' >&2
    return 1
  fi
  if [ "$exists" != "true" ]; then
    note "🔴 前置⑦:**supabase_migrations.schema_migrations 這張表不存在** ⇒ 停。"
    note "   🛑 表不存在時「查不到這一列」與「這一列不在」會印同一個 0 —— 那個 0 是尺的 0。"
    note "   (寫入身分要讀得到那個 schema;唯讀身分 pcm_readonly 讀不到, 那是已知的。)"
    return 1
  fi
  cnt=$("$PSQL_BIN" "$url" -X -q -A -t -v ON_ERROR_STOP=1 \
    -c "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '$ver'" 2>&1) ; rc=$?
  if [ "$rc" != "0" ]; then
    note "🔴 前置⑦:讀得到那張表而查不動它 ⇒ fail-closed。"
    printf '%s\n' "$cnt" | sed 's/^/   /' >&2
    return 1
  fi
  case "$cnt" in
    0) : ;;
    ''|*[!0-9]*) note "🔴 前置⑦:count 回了一個不是數字的東西('$cnt')⇒ fail-closed。"; return 1 ;;
    *) note "🔴 前置⑦:**平台帳本上已經有 $ver**(count=$cnt)⇒ 它貼過了 ⇒ 拒絕重貼。"; return 1 ;;
  esac
  note "  🟢 平台帳本無 $ver · 而前置⑥ 已證 APPLIED.tsv 也無 ⇒ **兩本帳都說沒有** ⇒ 還沒貼"
}

# ── 靜態檢查(meta-command + 交易形狀)——`--dry-run` 也要跑 ────────
# 🔴 F8(opus R4):v3 之前 `--dry-run` **不跑**這兩道 ⇒ 一支會被拒的檔在 dry-run 下印綠,
#    而 runbook 說 dry-run 跑完前置。⇒ 抽成一支, 兩條路都叫它。
static_checks() {
  local mig shape
  mig="$1"
  # 🔴🔴 **F1/F2/F3(opus R4)—— ⛔ ~~黑名單~~ 換成【遮罩後任何反斜線指令就停】。**
  #    舊版的 regex 要求反斜線**前面是行首或空白** ⇒ `SELECT 1;\set ON_ERROR_STOP off`
  #    **不匹配**。實測 psql 17.10:報錯後**繼續執行**、psql 離開 **rc=0** ⇒ repair 與記帳全跑完。
  #    🛑 那正是 v1 那條「migration 自己動 ON_ERROR_STOP」**沒有被修掉, 只是換了個寫法**。
  #    同一個洞還放過:`\!`(**真的執行 shell**, 實測檔案被建出來)· `;\c otherdb`
  #    (DDL 落在**別的資料庫**, 而 `:305` 的 A/B 驗證查的是 `$url` 的 schema_migrations
  #     ⇒ **它驗得過** ⇒ 帳本記成功而目標庫沒有那個變更)· `\g |sh` `\w` `\echo`
  #     `\crosstabview` `\getenv` `\prompt`。
  #    ✅ **改成白名單式全拒, 而它零誤殺**:opus 對 repo 全部 migration 實跑 ⇒ **0 支命中**。
  if meta_cmds=$(mask_sql "$mig" | grep -nE '\\[A-Za-z!]' | head -5) && [ -n "$meta_cmds" ]; then
    note "🔴 這支 migration 裡有 psql meta-command(反斜線指令)⇒ 停, 這支要人判。"
    note "   🛑 它們可以跑不在 SHA 裡的 SQL(\\include)、換資料庫(\\c —— 而我的 A/B 驗證看不到)、"
    note "     執行任意 shell(\\!)、提早成功離開(\\quit)、或關掉 ON_ERROR_STOP 讓錯誤後照跑而 rc=0。"
    printf '%s\n' "$meta_cmds" | sed 's/^/   /' >&2
    return 1
  fi

  shape=$(txn_shape "$mig")
  case "$shape" in
    clean) note "  交易形狀 clean(自帶 BEGIN…COMMIT)⇒ **不帶 -1**, 原子性由檔案自己保證" ;;
    none)  note "  交易形狀 none(零交易控制)⇒ **帶 -1**" ;;
    *)     note "🔴 交易形狀 messy(中途 COMMIT / 只有一半)⇒ 停, 這支要人判。"; return 1 ;;
  esac
}

# ── apply + 事後 ────────────────────────────────────────────
do_apply() {
  local num ver mig paste root url stamp log rc rrc shape one s_mig s_paste ledline led lock arc vcnt vrc s_mig2
  num="$1"; ver="$2"; mig="$3"; paste="$4"; root="$5"; url="$6"

  # 🔴 migration 自己 `\set ON_ERROR_STOP off` ⇒ 之後的 ERROR 不會讓 psql 非零離開。
  static_checks "$mig" || return 1
  shape=$(txn_shape "$mig")
  case "$shape" in
    clean) one=""   ;;
    none)  one="-1" ;;
  esac

  stamp=$(date +%Y%m%d-%H%M%S-$$)     # 🔴 v1 只到秒 ⇒ 同秒兩發會用 `>` 互蓋
  log="$LOG_DIR/貼結果-${num}-${stamp}.log"

  note "  ── apply(-X;ON_ERROR_STOP=1;${one:-無 -1})──"
  if [ -n "$one" ]; then
    "$PSQL_BIN" "$url" -X -v ON_ERROR_STOP=1 -1 -f "$mig" > "$log" 2>&1 ; rc=$?
  else
    "$PSQL_BIN" "$url" -X -v ON_ERROR_STOP=1 -f "$mig" > "$log" 2>&1 ; rc=$?
  fi
  printf 'rc=%s shape=%s one=%s\n' "$rc" "$shape" "${one:-NONE}" >> "$log"
  note "  psql 輸出存於 $log"

  if [ "$rc" != "0" ]; then
    note "🔴 apply 失敗(rc=$rc)。"
    case "$rc" in
      1) note "   psql rc=1 = 客戶端致命錯誤(連不上 / 參數錯)⇒ 幾乎確定 DB 未變。" ;;
      2) note "   🔴 psql rc=2 = 連線中斷。**這一種【不能】斷言 DB 未變** ——" ;
         note "      若在 COMMIT 的回應之前斷線, 資料庫可能已經提交了。⇒ 先唯讀查再決定。" ;;
      3) note "   psql rc=3 = SQL script 出錯 ⇒ 交易回滾, DB 未變。" ;;
    esac
    note "   ⇒ 🛑 **不記帳、不 repair。** 整段輸出:"
    sed 's/^/   /' "$log" >&2
    return 1
  fi
  note "  🟢 apply 成功"

  # 🔴 F5(opus R4):PRE_SHA 回核原本排在 repair 【之後】 ⇒ 檔被換掉時**平台帳本已經記了**。
  #    ⇒ 移到 repair 之前:先確定「我跑的就是我核過的那一份」, 再去動任何帳。
  s_mig2=$(sha_of "$mig")  || { note '🔴 apply 後重算 repo sha 失敗 ⇒ 不記帳(半套)。'; return 1; }
  # 🔴 **重算之後要比**(codex R2/R3):v2 只重算不比較 ⇒ 檔案在 SHA 通過與 apply 之間
  #    被別的窗換掉時, 我會拿【新內容的 SHA】去記一筆【舊內容已貼】的帳。
  if [ "$s_mig2" != "$PRE_SHA" ]; then
    note "🔴🔴 **檔案在前置與 apply 之間被改過了**:前置 $PRE_SHA ⇒ 現在 $s_mig2"
    note "   ⇒ 🛑 DB 已經變了, 而我不知道它跑的是哪一份 ⇒ **不記帳**, 交給人判。"
    return 1
  fi
  s_mig="$s_mig2"

  # 🔴 F7(opus R4):`supabase … --linked` 認的是 **cwd**, 不是 $ROOT ⇒ 在別的地方跑
  #    會 repair 到別的專案(或找不到 link)。⇒ 明確 cd 進 $root 再叫它。
  ( cd "$root" && "$SUPABASE_BIN" migration repair --linked --status applied "$ver" ) >> "$log" 2>&1 ; rrc=$?
  # 🔴🔴 **`repair --linked` 修的是【連結專案】, 不是我剛剛寫進去的那個庫**(codex R3 F)。
  #    ⛔ ~~「查、貼、記三件事同一條連線」~~ —— **那句宣稱是假的**, 我寫過它, 這裡訂正。
  #    ⇒ 改成【驗效果】:用**寫入那條連線**回頭查平台帳本, 它必須真的多了這一列。
  #      repair 若寫到另一個專案, 這一發就會是 0 ⇒ 那正是 A/B 分岔的訊號。
  if [ "$rrc" = "0" ]; then
    vcnt=$("$PSQL_BIN" "$url" -X -q -A -t -v ON_ERROR_STOP=1 \
      -c "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '$ver'" 2>&1) ; vrc=$?
    if [ "$vrc" != "0" ] || [ "$vcnt" != "1" ]; then
      note "🔴🔴 **repair 說成功, 而【我寫進去的那個庫】的平台帳本沒有多這一列**(count='$vcnt')。"
      note "   ⇒ 🛑 那表示 \`--linked\` 指的專案與 PCM_WRITE_DATABASE_URL **不是同一個** ⇒ A/B 分岔。"
      rrc=98
    fi
  fi
  s_paste=$(sha_of "$paste") || { note '🔴 apply 後重算貼板 sha 失敗 ⇒ 不記帳(半套)。'; return 1; }
  ledline=$(printf '%s\t%s\t%s\t@%s 貼板 sha=%s;主視窗依 Sean「貼 %s」代貼' \
            "$ver" "$s_mig" "$(date +%Y-%m-%d)" "$stamp" "$s_paste" "$num")

  if [ "$rrc" != "0" ]; then
    note "🔴🔴 **半套狀態**:psql 成功而 supabase migration repair 失敗。" "   rc=$rrc"
    note "   ⇒ 🛑 **DB 已經變了, 而平台帳本沒記** —— 這件事在 rc 上與【什麼都沒做】長得一樣,"
    note "     所以它不會靜靜結束。要手補兩件:"
    note "     ① supabase migration repair --linked --status applied $ver"
    note "     ② 把下面這一行追加進 supabase/APPLIED.tsv:"
    printf '        %s\n' "$ledline" >&2
    return 1
  fi
  note "  🟢 repair 成功"

  # ── 帳本追加:鎖 + 換行 + rc,三件缺一不可 ──
  led="$root/supabase/APPLIED.tsv"
  # 🔵 鎖在 main 已經拿了(從前置⑥ 之前就持有)⇒ 這裡不再拿, 否則會自己擋自己。
  # 🔴 最後一 byte 不是換行 ⇒ 新列會直接黏壞舊列。
  [ -s "$led" ] && [ "$(tail -c1 "$led" | od -An -c | tr -d ' ')" != '\n' ] && printf '\n' >> "$led"
  printf '%s\n' "$ledline" >> "$led" ; arc=$?
  if [ "$arc" != "0" ]; then
    note "🔴🔴 **半套**:DB 已改、repair 已做, 而帳本寫入失敗(rc=$arc)⇒ 手貼下面這行:"
    printf '        %s\n' "$ledline" >&2
    return 1
  fi
  grep -qF "$ver	$s_mig" "$led" || { note '🔴 帳本寫完回核失敗 ⇒ 那一行不在檔裡 ⇒ 手貼。'; printf '        %s\n' "$ledline" >&2; return 1; }
  note "  🟢 APPLIED.tsv 追加一行並回核過"
  note ""
  note "✅ 貼完了。回報 Sean:版本 $ver · log $log"
  note "   🔴 **下一支要等他再回一次「貼 <編號>」** —— 授權是一次一支。"
}

# ── selftest ───────────────────────────────────────────────
# 🔴 v1 的六塊恆綠區(codex R1 ⑥)這一版都補上了, 每一格旁邊標它擋的是哪一塊。
selftest() {
  unset GIT_DIR GIT_INDEX_FILE GIT_WORK_TREE GIT_OBJECT_DIRECTORY \
        GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_COMMON_DIR GIT_NAMESPACE
  export LC_ALL=C LANG=C
  local D PORT URL T pass fail
  pass=0; fail=0
  ck() {
    if [ "$2" = "$3" ]; then pass=$((pass+1)); else
      fail=$((fail+1)); printf '  🔴 FAIL %s (得 %s, 該是 %s)\n' "$1" "$2" "$3"
      [ -f "$D/out" ] && sed 's/^/      | /' "$D/out" | head -10
    fi
  }
  command -v initdb > /dev/null 2>&1 || { printf '🔴 沒有 initdb ⇒ **沒有跑, 不是通過**\n' >&2; return 2; }
  D=$(mktemp -d) || return 2
  PORT=$(( 15000 + RANDOM % 2000 ))
  initdb -U postgres -A trust --encoding=UTF8 --locale=C "$D/data" > "$D/initdb.log" 2>&1 \
    || { printf '🔴 initdb 失敗 ⇒ 沒有跑\n' >&2; rm -rf "$D"; return 2; }
  pg_ctl -D "$D/data" -l "$D/pg.log" -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" start > /dev/null 2>&1 \
    || { printf '🔴 pg_ctl start 失敗 ⇒ 沒有跑\n' >&2; cat "$D/pg.log" >&2; rm -rf "$D"; return 2; }
  URL="postgresql://postgres@127.0.0.1:$PORT/postgres"

  "$PSQL_BIN" "$URL" -X -q -c 'CREATE SCHEMA IF NOT EXISTS supabase_migrations' > /dev/null 2>&1
  "$PSQL_BIN" "$URL" -X -q -c 'CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations(version text primary key)' > /dev/null 2>&1
  T="$D/world"; mkdir -p "$T/貼板-9999" "$T/repo/supabase/migrations" "$T/repo/scripts" "$T/log"
  # 🔵 v3 起【不再相依】is-migration-applied.sh —— 那是舊啟發式層的東西, 已刪。
  printf '# 標頭\n' > "$T/repo/supabase/APPLIED.tsv"

  # 🔴 **樁要真的動平台帳本**(codex R3 D):v3 之前它只 echo 然後回 0
  #    ⇒ 「repair 指錯資料庫 / 實際 no-op」時成功路徑仍然全綠。
  #    ⇒ 現在它會 INSERT 進拋棄式 PG 的 schema_migrations —— 而 `STUB_REPAIR_NOOP=1`
  #      讓它【回 0 而什麼都不做】, 那就是 A/B 分岔的模擬。
  cat > "$D/stub-supabase" <<STUB
#!/bin/sh
echo "supabase \$*" >> "\$STUB_CALLS"
if [ "\${STUB_SUPABASE_RC:-0}" != "0" ]; then exit \${STUB_SUPABASE_RC}; fi
if [ "\${STUB_REPAIR_NOOP:-0}" != "1" ]; then
  for a in "\$@"; do case "\$a" in [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9])
    "$PSQL_BIN" "$URL" -X -q -c "INSERT INTO supabase_migrations.schema_migrations(version) VALUES ('\$a') ON CONFLICT DO NOTHING" > /dev/null 2>&1 ;; esac; done
fi
exit 0
STUB
  cat > "$D/stub-psql" <<'STUB'
#!/bin/sh
echo "psql $*" >> "$STUB_CALLS"
exit 0
STUB
  chmod +x "$D/stub-supabase" "$D/stub-psql"

  mk() { printf '%s' "$3" > "$T/repo/supabase/migrations/$2_selftest.sql"; printf '%s' "$3" > "$T/貼板-9999/$1_$2_selftest.sql"; }
  run() {
    # 🔴 ⛔ ~~`export STUB_REPAIR_NOOP=…`~~ —— 那一行會把【某一格用的旗標】留在
    #    selftest 自己的環境裡 ⇒ **後面每一格都繼承它**。實測:⑫a2 用 NOOP=1 之後,
    #    ⑪b 就一直紅在「A/B 分岔」而它根本沒有設那個旗標。
    #    ⇒ 📌 一格的世界【漏進】下一格的世界, 而症狀出現在很後面, 讀起來像另一個 bug。
    : > "$D/calls"
    APB_SELFTEST=1 APB_PASTE_ROOT="$T" APB_LOG_DIR="$T/log" \
    APB_PSQL="${USE_PSQL:-$PSQL_BIN}" APB_SUPABASE="$D/stub-supabase" \
    STUB_CALLS="$D/calls" STUB_SUPABASE_RC="${SUP_RC:-0}" STUB_REPAIR_NOOP="${STUB_REPAIR_NOOP:-0}" \
    bash "$SELF" "$@" --db-url "$URL" --root "$T/repo" > "$D/out" 2>&1
  }
  led_rows() { awk '!/^#/ && NF' "$T/repo/supabase/APPLIED.tsv" 2>/dev/null | wc -l | tr -d ' '; }
  calls_of() { grep -c "$1" "$D/calls" 2>/dev/null | head -1; }
  in_db() { "$PSQL_BIN" "$URL" -X -q -A -t -c "SELECT to_regclass('$1') IS NOT NULL" 2>/dev/null; }

  # ═ ① 該綠:零交易控制的檔(shape=none ⇒ 帶 -1)═
  mk 01 20990101000000 'CREATE TABLE public.zzq_one(id int);
'
  run 01 ; ck "① 合法(shape none)⇒ rc=0" "$?" "0"
  ck "① 帳本多一行" "$(led_rows)" "1"
  ck "① log 有【內容】不只有檔名" "$([ -s "$(find "$T/log" -name '貼結果-01-*.log' | head -1)" ] && echo y || echo n)" "y"
  ck "① 走的是 shape=none 那條" "$(grep -c 'shape=none' "$(find "$T/log" -name '貼結果-01-*.log' | head -1)")" "1"
  ck "① repair 【恰好】被呼叫一次" "$(calls_of 'migration repair')" "1"

  # ═ ② 該紅:同一支再跑 ⇒ 必須是【前置⑥ 帳本】擋 ═
  run 01 ; ck "② 再跑 ⇒ rc≠0" "$([ $? -ne 0 ] && echo ne0 || echo 0)" "ne0"
  grep -q '前置⑥' "$D/out" ; ck "② 是前置⑥ 擋的" "$?" "0"
  ck "② 帳本沒有第二行" "$(led_rows)" "1"

  # ═ ②b 該紅:APPLIED.tsv 那行拿掉、而【平台帳本】有 ⇒ 前置⑦ 擋 ═
  grep -v '^20990101000000' "$T/repo/supabase/APPLIED.tsv" > "$T/b" && mv "$T/b" "$T/repo/supabase/APPLIED.tsv"
  "$PSQL_BIN" "$URL" -X -q -c "INSERT INTO supabase_migrations.schema_migrations(version) VALUES ('20990101000000')" > /dev/null 2>&1
  run 01 ; ck "②b 平台帳本有而 APPLIED.tsv 沒有 ⇒ rc≠0" "$([ $? -ne 0 ] && echo ne0 || echo 0)" "ne0"
  grep -q '平台帳本上已經有' "$D/out" ; ck "②b 是前置⑦(平台帳本)擋的" "$?" "0"
  printf '20990101000000\tx\t2099-01-01\t還原\n' >> "$T/repo/supabase/APPLIED.tsv"

  # ═ ③ 該紅:兩個 sha 不同 ⇒ psql 一次都沒被呼叫 ═
  mk 03 20990303000000 'CREATE TABLE public.zzq_three(id int);
'
  printf '\n-- 多一行\n' >> "$T/貼板-9999/03_20990303000000_selftest.sql"
  USE_PSQL="$D/stub-psql" run 03 ; ck "③ sha 不同 ⇒ rc≠0" "$([ $? -ne 0 ] && echo ne0 || echo 0)" "ne0"
  ck "③ psql 一次都沒被呼叫" "$(calls_of '^psql ')" "0"
  unset USE_PSQL

  # ═ ④ 該紅:SQL 有 ERROR ⇒ 回滾 · 不記帳 · 不 repair ═
  mk 04 20990404000000 'CREATE TABLE public.zzq_four(id int);
SELECT this_fn_does_not_exist();
'
  run 04 ; ck "④ SQL ERROR ⇒ rc≠0" "$([ $? -ne 0 ] && echo ne0 || echo 0)" "ne0"
  ck "④ 帳本沒有那一行" "$(led_rows)" "1"
  ck "④ repair 沒被呼叫" "$(calls_of 'migration repair')" "0"
  ck "④ 交易回滾:表不存在" "$(in_db public.zzq_four)" "f"

  # ═ ④b 該紅【f8 指定實跑】:自帶交易的檔中途 ERROR ⇒ 停在交易內未 COMMIT ⇒ 連線關閉自動回滾 ═
  mk 07 20990707000000 'BEGIN;
CREATE TABLE public.zzq_seven(id int);
SELECT this_fn_does_not_exist();
COMMIT;
'
  run 07 ; ck "④b clean 檔中途 ERROR ⇒ rc≠0" "$([ $? -ne 0 ] && echo ne0 || echo 0)" "ne0"
  ck "④b 走的是 shape=clean(沒有帶 -1)" "$(grep -c 'shape=clean' "$(find "$T/log" -name '貼結果-07-*.log' | head -1)")" "1"
  ck "④b 表【不存在】⇒ 未 COMMIT, 連線關閉時回滾" "$(in_db public.zzq_seven)" "f"

  # ═ ⑤ 負對照:編號不存在 ⇒ 停在前置① ═
  run 99 ; ck "⑤ 編號不存在 ⇒ rc≠0" "$([ $? -ne 0 ] && echo ne0 || echo 0)" "ne0"
  grep -q '前置①' "$D/out" ; ck "⑤ 停在前置①" "$?" "0"

  # ═ ⑥ 半套【v1 從來沒跑過這條路】:repair 樁回非 0 ═
  mk 08 20990808000000 'CREATE TABLE public.zzq_eight(id int);
'
  SUP_RC=7 run 08 ; ck "⑥ repair 失敗 ⇒ rc≠0" "$([ $? -ne 0 ] && echo ne0 || echo 0)" "ne0"
  grep -q '半套狀態' "$D/out" ; ck "⑥ 印出【半套狀態】而不是靜靜結束" "$?" "0"
  ck "⑥ 半套時帳本【沒有】被寫" "$(led_rows)" "1"
  ck "⑥ 而 DB 確實已經變了(表在)" "$(in_db public.zzq_eight)" "t"
  unset SUP_RC

  # ═ ⑦ --dry-run【v1 從來沒傳過】⇒ 什麼都不貼 ═
  mk 09 20990909000000 'CREATE TABLE public.zzq_nine(id int);
'
  run 09 --dry-run ; ck "⑦ dry-run ⇒ rc=0" "$?" "0"
  ck "⑦ dry-run 沒有貼:表不存在" "$(in_db public.zzq_nine)" "f"
  ck "⑦ dry-run 沒有寫帳本" "$(led_rows)" "1"

  # ═ ⑧ 交易形狀三格 ═
  mk 10 20991010000000 'BEGIN;
CREATE TABLE public.zzq_ten(id int);
COMMIT;
'
  ck "⑧a clean" "$(txn_shape "$T/repo/supabase/migrations/20991010000000_selftest.sql")" "clean"
  ck "⑧b none"  "$(txn_shape "$T/repo/supabase/migrations/20990101000000_selftest.sql")" "none"
  mk 11 20991111000000 'BEGIN;
CREATE TABLE public.zzq_a(id int);
COMMIT;
CREATE TABLE public.zzq_b(id int);
'
  ck "⑧c messy" "$(txn_shape "$T/repo/supabase/migrations/20991111000000_selftest.sql")" "messy"
  run 11 ; ck "⑧d messy ⇒ 停下印要人判" "$([ $? -ne 0 ] && echo ne0 || echo 0)" "ne0"
  grep -q '要人判' "$D/out" ; ck "⑧e 訊息裡有【要人判】" "$?" "0"

  # ═ ⑧f/g/h 交易形狀的三個邊界(codex R3 B 逐條指名)═
  printf 'BEGIN;\nCREATE TABLE public.zzq_f(id int);\nCOMMIT; CREATE TABLE public.zzq_f2(id int);\n' > "$T/s1.sql"
  ck "⑧f 同一行 COMMIT; 後面還有語句 ⇒ messy" "$(txn_shape "$T/s1.sql")" "messy"
  printf 'BEGIN WORK;\nCREATE TABLE public.zzq_g(id int);\nCOMMIT WORK;\n' > "$T/s2.sql"
  ck "⑧g BEGIN WORK … COMMIT WORK ⇒ clean(不是 none)" "$(txn_shape "$T/s2.sql")" "clean"
  printf '/* 外層 /* 內層 BEGIN; COMMIT; */ 還在註解裡 */\nCREATE TABLE public.zzq_h(id int);\n' > "$T/s3.sql"
  ck "⑧h 巢狀區塊註解裡的假 BEGIN/COMMIT ⇒ none" "$(txn_shape "$T/s3.sql")" "none"

  # ═ ⑬ psql meta-command 一律拒 ═
  mk 30 20993030000000 'CREATE TABLE public.zzq_thirty(id int);
\include /etc/passwd
'
  run 30 ; ck "⑬a 含 \\include ⇒ 拒" "$([ $? -ne 0 ] && echo ne0 || echo 0)" "ne0"
  grep -q 'meta-command' "$D/out" ; ck "⑬a 訊息說 meta-command" "$?" "0"
  # 🔴 F2 那三種真的會出事的形狀, 各一格(它們在舊黑名單下【全部通過】)
  mk 32 20993232000000 'SELECT 1;\\c otherdb
CREATE TABLE public.zzq_32(id int);
'
  run 32 ; ck "⑬c 分號緊接 \\c(換庫)⇒ 拒" "$([ $? -ne 0 ] && echo ne0 || echo 0)" "ne0"
  grep -q 'meta-command' "$D/out" ; ck "⑬c 是 meta-command 閘擋的" "$?" "0"
  mk 33 20993333000000 'SELECT 1;
\\! echo zzq
CREATE TABLE public.zzq_33(id int);
'
  run 33 ; ck "⑬d \\!(執行 shell)⇒ 拒" "$([ $? -ne 0 ] && echo ne0 || echo 0)" "ne0"
  grep -q 'meta-command' "$D/out" ; ck "⑬d 是 meta-command 閘擋的" "$?" "0"
  # 🔵 負對照:反斜線出現在【註解 / 字串 / $tag$ 內】不算 —— 否則這道閘會誤殺
  mk 34 20993434000000 '-- 這行註解裡有 \\set ON_ERROR_STOP off
CREATE TABLE public.zzq_34(id int);
COMMENT ON TABLE public.zzq_34 IS $c$ 路徑 C:\\temp\\x 與 \\c 都在字串裡 $c$;
'
  run 34 ; ck "⑬e 反斜線只在註解/字串裡 ⇒ 放行(零誤殺)" "$?" "0"
  mk 31 20993131000000 'SET x = 1;
CREATE TABLE public.zzq_31(id int); \set ON_ERROR_STOP off
'
  run 31 ; ck "⑬b 行尾的 \\set ON_ERROR_STOP ⇒ 拒(不只行首)" "$([ $? -ne 0 ] && echo ne0 || echo 0)" "ne0"
  # 🔴 F13:⑬b 原本是完全恆綠格 —— fixture 首行 `SET x = 1;` 本來就會讓 psql 報錯,
  #    **有沒有那道閘都 rc≠0**。⇒ 補訊息斷言, 並把首行換成合法 SQL。
  grep -q 'meta-command' "$D/out" ; ck "⑬b 而且是 meta-command 閘擋的" "$?" "0"

  # ═ ⑭ localhost 不是子字串比對(codex 實測那個 URL 會過)═
  APB_SELFTEST=1 APB_PASTE_ROOT="$T" bash "$SELF" 01 --db-url 'postgresql://localhost@evil.example.com/p' --root "$T/repo" > "$D/out" 2>&1
  ck "⑭ postgresql://localhost@evil.example.com ⇒ 拒" "$([ $? -ne 0 ] && echo ne0 || echo 0)" "ne0"
  grep -q "抽到的 host 是 'evil.example.com'" "$D/out" ; ck "⑭ 而且它抽出的 host 逐字是 evil.example.com" "$?" "0"

  # ═ ⑮ ⛔ **這一格拿掉了, 而理由要留著** ═
  #    我原本用 `chmod 000` 造「帳本存在而讀不動」那個世界 —— **實測它擋不住**:
  #      printf 'a\n' > t; chmod 000 t; awk 'END{}' t  ⇒ **rc=0**(uid 502, 本機)
  #    ⇒ 那一發沒有被拒, 它**真的把 09 貼下去了**, 而症狀出現在**三格之後**的 ⑪b
  #      (「平台帳本上已經有 20990909000000」)⇒ 讀起來像 ⑪ 壞了。
  #    📌 **一個造不出自己那個世界的 fixture, 不會大聲失敗 —— 它會安靜地測另一個世界,
  #       而帳算在別人頭上。**
  #    🛑 **⇒ 「帳本存在而讀不動」這條路【本 selftest 未覆蓋】**, 不是它通過了。
  #       (`[ -f ]` 為假的那條路由 ⑪a 蓋到;真正的「可 stat 而不可讀」在這台機器上造不出來。)

  # ═ ⑯ has_bad_char 零覆蓋(F16)—— 貼板檔名塞一個 TAB ⇒ 停在前置① ═
  #    🔵 這正是 v2「42 格裡 17 格紅」那一族的守門, 修好之後**反而一格都不剩**。
  printf 'CREATE TABLE public.zzq_tab(id int);\n' > "$T/貼板-9999/$(printf '40_2099404000000\tx').sql"
  run 40 ; ck "⑯ 貼板檔名含 TAB ⇒ 停" "$([ $? -ne 0 ] && echo ne0 || echo 0)" "ne0"
  # 🔴 ⛔ ~~`rm -f "$dir/"*$(printf '\t')*.sql`~~ —— **TAB 在 IFS 裡**, 未加引號的命令替換
  #    被**斷詞成兩個字** ⇒ 樣式變成 `dir/*` 與 `*.sql` ⇒ **它把整個目錄清空了**,
  #    而症狀出現在後面的 ⑪(「編號 09 命中 0 支」)。⇒ 用 find 精確刪那一支。
  find "$T/貼板-9999" -maxdepth 1 -name '40_*' -delete 2>/dev/null

  # ═ ⑰ PRE_SHA 回核零覆蓋(F12)—— 檔在前置與 apply 之間被換掉 ═
  #    🔴 這道守門是為 codex R2/R3 那條寫的, 而**它一格都沒有** ⇒ 拔掉它 selftest 全綠。
  #    造法:psql 樁在被呼叫時【改掉那支 migration】再回 0。
  # 🔴 樁只能攔 `-f`(apply 那一發);`-c`(平台帳本查詢)要**轉給真的 psql**,
  #    否則它會停在前置⑦, 而那一格就【測不到 PRE_SHA 那道閘】—— 又一個「沒走到自己宣稱的閘」。
  cat > "$D/stub-psql-swap" <<SWAP
#!/bin/sh
echo "psql \$*" >> "\$STUB_CALLS"
for a in "\$@"; do case "\$a" in
  -c) exec "$PSQL_BIN" "\$@" ;;
esac; done
for a in "\$@"; do case "\$a" in *20994141000000_selftest.sql)
  printf '\n-- 被別的窗改過了\n' >> "\$a" ;; esac; done
exit 0
SWAP
  chmod +x "$D/stub-psql-swap"
  mk 41 20994141000000 'CREATE TABLE public.zzq_41(id int);
'
  _d=$(led_rows)
  USE_PSQL="$D/stub-psql-swap" run 41
  ck "⑰ 檔在前置與 apply 之間被換掉 ⇒ 停" "$([ $? -ne 0 ] && echo ne0 || echo 0)" "ne0"
  grep -q '被改過了' "$D/out" ; ck "⑰ 是 PRE_SHA 回核那道擋的" "$?" "0"
  ck "⑰ 不記帳" "$(led_rows)" "$_d"
  unset USE_PSQL

  # ═ ⑱ clean 不帶 -1 零覆蓋(F17)—— ④b 只 grep shape 字串, 證不到 argv ═
  ck "⑱ clean 那一發的 log 逐字記著 one=NONE" \
     "$(grep -c 'one=NONE' "$(find "$T/log" -name '貼結果-07-*.log' | head -1)")" "1"
  ck "⑱ none 那一發的 log 逐字記著 one=-1" \
     "$(grep -c 'one=-1' "$(find "$T/log" -name '貼結果-01-*.log' | head -1)")" "1"

  # ═ ⑨ 非 TABLE 物件也要走得通(v1 只測 TABLE)═
  mk 12 20991212000000 'CREATE VIEW public.zzq_v AS SELECT 1 AS a;
CREATE INDEX zzq_i ON public.zzq_one(id);
'
  # 🔵 ⛔ ~~寫死「該是 2」~~ —— 前面每加一格會貼的世界, 這個數字就漂一次(實測撞到)。
  #    ⇒ 改成**相對量**:跑之前先記, 跑完比 +1。
  _b=$(led_rows)
  run 12 ; ck "⑨ VIEW + INDEX 物件 ⇒ rc=0" "$?" "0"
  ck "⑨ 帳本剛好多一行" "$(led_rows)" "$((_b + 1))"

  # ═ ⑫ 兩本帳的四個世界(`-f8` 2026-09-06 指定)═
  #    🔴 **「還沒貼」要兩本都說沒有** —— 平台帳本今晚才補到還缺 65 支,
  #       而其中有 SQL Editor 貼過卻沒 repair 的 ⇒ **只問平台帳本會重貼。**
  mk 20 20992020000000 'CREATE TABLE public.zzq_twenty(id int);
'
  plat_add() { "$PSQL_BIN" "$URL" -X -q -c "INSERT INTO supabase_migrations.schema_migrations(version) VALUES ('$1')" > /dev/null 2>&1; }
  plat_del() { "$PSQL_BIN" "$URL" -X -q -c "DELETE FROM supabase_migrations.schema_migrations WHERE version='$1'" > /dev/null 2>&1; }
  led_add()  { printf '%s\tx\t2099-01-01\t世界\n' "$1" >> "$T/repo/supabase/APPLIED.tsv"; }
  led_del()  { grep -v "^$1" "$T/repo/supabase/APPLIED.tsv" > "$T/b" && mv "$T/b" "$T/repo/supabase/APPLIED.tsv"; }

  # ⑫a 兩本都沒有 ⇒ 放行
  run 20 ; ck "⑫a 兩本都沒有 ⇒ 放行" "$?" "0"
  # 🔴 只驗 rc=0 的話, 把整個 apply 換成成功 no-op 這格照樣綠(codex R3 D)⇒ 驗它的效果。
  ck "⑫a 表真的被建出來了" "$(in_db public.zzq_twenty)" "t"
  ck "⑫a 平台帳本真的多了那一列" \
     "$("$PSQL_BIN" "$URL" -X -q -A -t -c "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20992020000000'")" "1"
  led_del 20992020000000 ; plat_del 20992020000000
  "$PSQL_BIN" "$URL" -X -q -c 'DROP TABLE IF EXISTS public.zzq_twenty' > /dev/null 2>&1

  LED_BASE=$(led_rows)   # 🔵 就地量, 不要拿上一格的值 —— 中間 led_del 過
  # ⑫a2 🔴 repair 回 0 而【什麼都沒做】(= 它寫到別的專案去了)⇒ 必須紅
  #     這一格就是 codex R3 D 那條:樁只回 0 不動帳本時, 成功路徑照樣全綠。
  STUB_REPAIR_NOOP=1 run 20 ; ck "⑫a2 repair 回 0 而平台帳本沒動 ⇒ 停(A/B 分岔)" "$([ $? -ne 0 ] && echo ne0 || echo 0)" "ne0"
  grep -q 'A/B 分岔' "$D/out" ; ck "⑫a2 訊息說 A/B 分岔" "$?" "0"
  ck "⑫a2 這種半套不記帳" "$(led_rows)" "$LED_BASE"
  led_del 20992020000000 ; plat_del 20992020000000
  "$PSQL_BIN" "$URL" -X -q -c 'DROP TABLE IF EXISTS public.zzq_twenty' > /dev/null 2>&1

  # ⑫b 只有平台帳本有 ⇒ 停
  plat_add 20992020000000
  run 20 ; ck "⑫b 只有平台帳本有 ⇒ 停" "$([ $? -ne 0 ] && echo ne0 || echo 0)" "ne0"
  grep -q '平台帳本上已經有' "$D/out" ; ck "⑫b 是前置⑦ 擋的" "$?" "0"
  plat_del 20992020000000

  # ⑫c 只有 APPLIED.tsv 有 ⇒ 停(這一格就是 -f8 補那條的理由)
  led_add 20992020000000
  run 20 ; ck "⑫c 只有 APPLIED.tsv 有 ⇒ 停" "$([ $? -ne 0 ] && echo ne0 || echo 0)" "ne0"
  grep -q '前置⑥' "$D/out" ; ck "⑫c 是前置⑥ 擋的" "$?" "0"

  # ⑫d 兩本都有 ⇒ 停
  plat_add 20992020000000
  run 20 ; ck "⑫d 兩本都有 ⇒ 停" "$([ $? -ne 0 ] && echo ne0 || echo 0)" "ne0"
  # 🔵 ⑫d 一定先被 ⑥ 擋住 ⇒ 它【證不到】平台帳本那一半(codex R3 D)。
  #    那一半由 ⑫b 證(只有平台有 ⇒ 停);這裡把「誰擋的」釘住, 免得被讀成兩本都驗過了。
  grep -q '前置⑥' "$D/out" ; ck "⑫d 是⑥ 先擋的(⑦ 那一半由 ⑫b 證)" "$?" "0"
  led_del 20992020000000 ; plat_del 20992020000000

  # ⑫e 🔴 平台帳本那張表【不存在】⇒ count 會是 0, 而那個 0 是尺的 0 ⇒ 必須停
  "$PSQL_BIN" "$URL" -X -q -c 'ALTER TABLE supabase_migrations.schema_migrations RENAME TO tmp_hidden' > /dev/null 2>&1
  run 20 ; ck "⑫e 平台帳本表不存在 ⇒ 停(不是讀成沒貼)" "$([ $? -ne 0 ] && echo ne0 || echo 0)" "ne0"
  grep -q '這張表不存在' "$D/out" ; ck "⑫e 訊息逐字說【這張表不存在】" "$?" "0"
  "$PSQL_BIN" "$URL" -X -q -c 'ALTER TABLE supabase_migrations.tmp_hidden RENAME TO schema_migrations' > /dev/null 2>&1

  # ═ ⑩ 參數與覆寫的拒絕面 ═
  # 🔴 F14(opus R4):`rc≠0` 這個格型**結構性恆綠** —— 四次突變裡它都被【別的錯誤】救活。
  #    ⇒ 每一個「該紅」的格都要配一條【那道閘的專屬字串】。
  run 01 02 ; ck "⑩a 兩個編號 ⇒ 拒" "$([ $? -ne 0 ] && echo ne0 || echo 0)" "ne0"
  grep -q '只能給【一個】編號' "$D/out" ; ck "⑩a 而且是那道閘擋的" "$?" "0"
  run '0*' ; ck "⑩b 編號含 glob ⇒ 拒" "$([ $? -ne 0 ] && echo ne0 || echo 0)" "ne0"
  grep -q '編號只認' "$D/out" ; ck "⑩b 而且是那道閘擋的" "$?" "0"
  APB_SELFTEST=0 bash "$SELF" 01 --db-url "$URL" > "$D/out" 2>&1
  ck "⑩c 正式模式帶 --db-url ⇒ 拒" "$([ $? -ne 0 ] && echo ne0 || echo 0)" "ne0"
  # 🔴 F12:拔掉那道拒收之後這格【仍綠】—— 因為實際擋它的是「只能在主樹跑」,
  #    而那取決於跑 selftest 時的 cwd。⇒ **這格的綠曾經是 cwd 決定的, 不是碼決定的。**
  grep -q '正式模式不接受覆寫參數' "$D/out" ; ck "⑩c 而且是【拒收覆寫】那道擋的, 不是主樹檢查" "$?" "0"
  # 🔴 F12:這一格原本【沒有帶 APB_PASTE_ROOT】⇒ 前置① 先擋住它, 它**從來沒走到 host 那道閘**。
  APB_SELFTEST=1 APB_PASTE_ROOT="$T" bash "$SELF" 01 --db-url 'postgresql://x@evil.example.com/p' --root "$T/repo" > "$D/out" 2>&1
  ck "⑩d selftest 的 db-url 指向外部 ⇒ 拒" "$([ $? -ne 0 ] && echo ne0 || echo 0)" "ne0"
  grep -q '只能指向本機' "$D/out" ; ck "⑩d 而且是 host 那道擋的(不是前置①)" "$?" "0"

  # ═ ⑪ 帳本本身的兩種壞 ═
  mv "$T/repo/supabase/APPLIED.tsv" "$T/led.save"
  run 09 ; ck "⑪a 帳本檔不存在 ⇒ 拒(不是零命中)" "$([ $? -ne 0 ] && echo ne0 || echo 0)" "ne0"
  printf '%s' "$(cat "$T/led.save")" > "$T/repo/supabase/APPLIED.tsv"   # 故意去掉結尾換行
  _c=$(led_rows)
  run 09 ; ck "⑪b 帳本結尾無換行時仍能貼" "$?" "0"
  # 🔴 F15(opus R4):⛔ ~~只檢查第一欄是不是 14 位數字~~ —— **黏行之後合併列的第一欄
  #    仍然是【舊列】的版本號** ⇒ 判定照樣通過, 那道守門零覆蓋而這格看起來在守它。
  #    ⇒ 改成兩個都驗:列數真的 +1, 而且**末列的第一欄就是這次的版本**。
  ck "⑪c 帳本列數真的 +1(不是被黏進舊列)" "$(led_rows)" "$((_c + 1))"
  ck "⑪c 末列第一欄就是這次的版本" \
     "$(awk -F'\t' '!/^#/ && NF {v=$1} END{print v}' "$T/repo/supabase/APPLIED.tsv")" "20990909000000"

  pg_ctl -D "$D/data" stop -m fast > /dev/null 2>&1 ; local src=$?
  [ "$src" = "0" ] || printf '  🔵 pg_ctl stop rc=%s ⇒ 保留 %s(不刪可能還在跑的 data dir)\n' "$src" "$D"
  if [ "$fail" != "0" ] || [ "$src" != "0" ]; then
    printf '  🔵 保留現場:%s\n' "$D"
  else
    rm -rf "$D"
  fi
  printf '── selftest: %s PASS / %s FAIL\n' "$pass" "$fail"
  # 🔵 格數當場數 —— 這個數字每加一格就要跟著改, 而它的用途是「有沒有格被刪掉或沒跑到」。
  if [ "$((pass + fail))" != "81" ]; then
    printf '  🔴 【格數】不對:跑了 %s 格 ≠ 81 ⇒ 有格被刪掉或沒跑到\n' "$((pass + fail))" >&2
    return 1
  fi
  [ "$fail" = "0" ]
}

# ── main ───────────────────────────────────────────────────
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
NUM=""; DBURL=""; ROOT_OVERRIDE=""; DRY=0; SEEN_POS=0
while [ $# -gt 0 ]; do
  case "$1" in
    --selftest) selftest; exit $? ;;
    --dry-run)  DRY=1; shift ;;
    --db-url)   [ $# -ge 2 ] || die '🔴 --db-url 缺值';  DBURL="$2"; shift 2 ;;
    --root)     [ $# -ge 2 ] || die '🔴 --root 缺值';    ROOT_OVERRIDE="$2"; shift 2 ;;
    -*)         die "🔴 不認得的參數:$1" ;;
    *)
      # 🔴 v1 是「最後一個蓋掉前面」⇒ 批准「貼 01」而傳 `01 02` 會實際貼 02。
      SEEN_POS=$((SEEN_POS+1))
      [ "$SEEN_POS" = "1" ] || die "🔴 只能給【一個】編號, 你給了 $SEEN_POS 個 ⇒ 停。" \
                                   '   🛑 授權的單位是【那一個編號】, 不是這個晚上。'
      NUM="$1"; shift ;;
  esac
done
[ -n "$NUM" ] || die '用法:bash scripts/apply-paste-board.sh <貼板編號> [--dry-run]' \
                     '     bash scripts/apply-paste-board.sh --selftest'
# 🔴 v1 讓編號直接進 `find -name` ⇒ `*` `?` `[]` 都會被當 glob。
# 🔴 F4:貼板 0906 的編號是 `45a`~`45e` ⇒ 純數字檢查會把它們全拒。
#    放寬成【數字 + 最多一個小寫字母】, 而 glob 字元(`*` `?` `[` `]`)仍然拒 ——
#    那才是 v1 那條「編號直接進 find -name 被當 glob」要擋的東西。
case "$NUM" in
  [0-9]|[0-9][a-z]|[0-9][0-9]|[0-9][0-9][a-z]|[0-9][0-9][0-9]|[0-9][0-9][0-9][a-z]) : ;;
  *) die "🔴 編號只認【數字】或【數字+一個小寫字母】(例 01 / 45a), 你給的是 '$NUM' ⇒ 停。" ;;
esac

# ── 正式模式:拒收任何覆寫 ────────────────────────────────────
# 🔴🔴 codex R1 ①:v1 的 `--db-url` / `--root` / `APB_*` 在正式模式一樣生效
#    ⇒ 可以繞過「沒有 PCM_WRITE_DATABASE_URL 就停」, 把任意 repo 的 migration 貼到任意庫。
if [ "${APB_SELFTEST:-0}" = "1" ]; then
  # selftest 子行程:**必須**給 --db-url, 而且只能指向本機 —— 這條路碰不到正式庫。
  [ -n "$DBURL" ] || die '🔴 APB_SELFTEST=1 而沒有 --db-url ⇒ 拒。'
  # 🔴 ⛔ ~~子字串比對~~ —— codex 實測 `postgresql://localhost@evil.example.com/...` 會過。
  #    ⇒ 抽出 **host** 那一段再比,而不是「字串裡有沒有出現 localhost」。
  _h=$(printf '%s' "$DBURL" | sed -E 's#^[a-z+]+://##; s#^[^@/]*@##; s#[/?].*$##; s#:[0-9]+$##; s#^\[##; s#\]$##')
  case "$_h" in
    127.0.0.1|localhost|::1) : ;;
    *) die "🔴 selftest 的 --db-url 只能指向本機, 抽到的 host 是 '$_h' ⇒ 拒。" ;;
  esac
else
  for v in DBURL ROOT_OVERRIDE; do
    eval "val=\${$v}"
    [ -z "$val" ] || die "🔴 正式模式不接受覆寫參數(--${v%_OVERRIDE} 之類)⇒ 停。" \
                         '   🛑 那些只給 --selftest 用;在正式模式它們可以把任意 migration 貼到任意庫。'
  done
  for v in APB_PASTE_ROOT APB_LOG_DIR APB_PSQL APB_SUPABASE APB_ROOT; do
    eval "val=\${$v:-}"
    [ -z "$val" ] || die "🔴 正式模式偵測到環境變數 $v ⇒ 停(只印名不印值)。" \
                         '   🛑 它可以偽造前置⑦、改寫 migration 來源、或叫到別的 CLI。'
  done
fi

if [ -n "$ROOT_OVERRIDE" ]; then
  ROOT="$ROOT_OVERRIDE"
  PASTE_ROOT="${APB_PASTE_ROOT:-$ROOT}"
  LOG_DIR="${APB_LOG_DIR:-$ROOT/log}"
  PSQL_BIN="${APB_PSQL:-$PSQL_BIN}"
  SUPABASE_BIN="${APB_SUPABASE:-$SUPABASE_BIN}"
else
  # 🔴 v1 只驗「任何 git repo」⇒ 在 worktree 或錯的 repo 只要 URL 已匯出就能正式寫入。
  ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
  [ "$ROOT" = "$MAIN_TREE" ] || die "🔴 這支只能在主樹跑。現在在:${ROOT:-(不是 git repo)}" \
                                    "   ⇒ cd $MAIN_TREE 再跑。worktree 沒有 .env.local, 那是站錯地方不是缺設定。"
  # 🔴 ⛔ ~~用 $HOME~~ —— codex R3:改掉 HOME 就能讓「貼 01」指到另一個貼板目錄,
  #    挑中一支**內容剛好與 repo 相符**的別支 migration ⇒ 繞過編號所代表的授權。
  PASTE_ROOT=/Users/sean_1/pcm-mailbox
  LOG_DIR=/Users/sean_1/pcm-mailbox
fi

if [ -n "$DBURL" ]; then
  URL="$DBURL"
else
  # 🔴 v1 從來沒有載入 .env.local ⇒ Sean 照 runbook 加完變數, 它仍然讀不到。
  #    載法與 scripts/readonly-prod-sql.sh:21 同形。
  # 🔴 **先清掉繼承來的**(codex R3 C):不清的話, 外面匯出的舊 URL 會在
  #    `.env.local` 缺值或載入失敗時**沿用**, 而那是「寫進錯的庫」。
  unset PCM_WRITE_DATABASE_URL PCM_READONLY_DATABASE_URL
  [ -f "$MAIN_TREE/.env.local" ] || die '🔴 主樹沒有 .env.local ⇒ 停。'
  set -a ; . "$MAIN_TREE/.env.local" ; erc=$? ; set +a
  [ "$erc" = "0" ] || die "🔴 載入 .env.local 失敗(rc=$erc)⇒ fail-closed(只印名不印值)。"
  [ -n "${PCM_WRITE_DATABASE_URL:-}" ] || die \
    '🔴 載不到 PCM_WRITE_DATABASE_URL ⇒ 停(只印名, 不印值)。' \
    "   主樹有沒有 .env.local:$(test -f "$MAIN_TREE/.env.local" && echo 有 || echo 沒有)" \
    '   🛑 這是【設計上的停】, 不是壞掉 —— 由 Sean 在 Supabase Connect 取 direct 連線串,' \
    '     貼進主樹 .env.local 的 PCM_WRITE_DATABASE_URL 底下(不要貼進對話)。'
  URL="$PCM_WRITE_DATABASE_URL"
  # 🔵 v3 起【不再需要】PCM_READONLY_DATABASE_URL —— 前置⑦ 改問平台帳本, 走同一條寫入連線。
  #    ⇒ 順帶解掉 codex R2 那條「寫進 A 而 repair B」:查、貼、記三件事同一條連線。
fi

note "======== apply-paste-board 貼板編號 $NUM ========"

# 🔴🔴 **共同鎖**(codex R3 B):兩本帳查完到 apply 之間沒有鎖 ⇒ 兩個行程可以
#    同時讀到「兩本都沒有」然後**重複貼同一版本**。短路 AND 在單行程成立,
#    而它**不是同一個時間點的證明**。⇒ 鎖從前置之前一路持有到帳本寫完。
LOCK="$ROOT/supabase/APPLIED.tsv.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  die "🔴 拿不到鎖 $LOCK —— 另一發代貼正在進行, 或上一發被砍而鎖殘留。" \
      '   🛑 **殘留是 fail-closed 的**:它擋住所有人, 而那比兩個人同時貼安全。' \
      "   ⇒ 確認沒有別發在跑之後, rmdir '$LOCK'。"
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT INT TERM

PRE=$(preflight "$NUM" "$ROOT") || exit 1
VER=$(printf '%s' "$PRE" | cut -f1)
MIG=$(printf '%s' "$PRE" | cut -f2)
PASTE=$(printf '%s' "$PRE" | cut -f3)
PRE_SHA=$(printf '%s' "$PRE" | cut -f4)
export PRE_SHA

platform_ledger_proof "$VER" "$URL" || exit 1

if [ "$DRY" = "1" ]; then
  static_checks "$MIG" || exit 1
  note ""
  note "🔵 --dry-run:前置全過(含 meta-command 與交易形狀), **什麼都沒有貼**。"
  exit 0
fi
do_apply "$NUM" "$VER" "$MIG" "$PASTE" "$ROOT" "$URL"
