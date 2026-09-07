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
# 🔴 **貼板檔的紀律(2026-09-06 主視窗裁, 全文 `~/pcm-mailbox/貼板-0906/README-貼板紀律.md`)**:
#    貼板上那支 `.sql` 與 `supabase/migrations/` 那支**逐位元組相同**, 一個字都不加 ——
#    給人讀的東西全部寫進同組的 `NNb_..._對帳_唯讀.sql` 檔頭。
#    📌 **理由是量到的**:帳本第二欄記的是【貼下去那份】的 sha, 而部署順序閘拿它比 **repo 檔**的 sha
#    ⇒ 貼板檔多一行, 閘就會把一支**已經貼過的** migration 報成 `PENDING`
#    (`scripts/ledger-col2-census.py` 2026-09-06 實測:344 列裡有 **5** 列記的是貼板那份的 sha)。
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

# 🔴🔴 **MF3(opus R3)—— psql 在 URI 解析錯誤時會把【整條含密碼的連線字串】逐字回吐。**
#    實測:`psql 'postgresql://user:SUPERSECRETPW@[bad-bracket'` ⇒ 錯誤訊息含整串。
#    而本支把 psql 的 stderr **原封轉進對話與 `~/pcm-mailbox/貼結果-*.log`**
#    ⇒ 📌 **一段「為了讓人看懂錯在哪」而寫的轉印, 變成憑證的出口。**
#    🛑 它**只在出錯那一發洩漏** ⇒ 平常跑一百次都不會有事 ⇒ **日常使用發現不了它。**
#    ⇒ 任何 psql 的輸出進 log 或對話之前, 一律先過這一道。
redact() { sed -E 's#(://)[^@ ]*@#\1***@#g'; }

# ── 載入 .env.local ──────────────────────────────────────────
# stdout 兩行:寫入 URL / 唯讀 URL。**只有這兩個值出得了子行程。**
# 🔴 **MF1(opus R3)**:子行程**繼承父環境** ⇒ `.env.local` 沒有那個名稱時
#    (輪替 / 改名 / 打錯 / 被註解掉 / dotenv 早期 `return`),外面 export 的 URL 會**沿用**
#    ⇒ **寫進錯的庫**。opus 實測 `URL=[postgresql://ATTACKER-INHERITED/db]`。
#    ⇒ **先 unset 再載** —— 那樣「沒設到」就是空的,而空的會被呼叫端 die 擋掉。
# 🔵 抽成函式的第二個理由:**這一整塊原本零測試覆蓋**(MF4;整塊換成 `die` 仍 110/0)——
#    抽出來之後 selftest 餵得進假的 env 檔,那個 `if` 分支才真的被走過。
load_env() {
  ( unset PCM_WRITE_DATABASE_URL PCM_READONLY_DATABASE_URL
    set -a; . "$1" > /dev/null 2>&1 || exit 9
    set +a
    printf '%s\n%s\n' "${PCM_WRITE_DATABASE_URL:-}" "${PCM_READONLY_DATABASE_URL:-}" )
}
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
src=io.open(sys.argv[1],encoding='utf-8-sig',errors='replace').read()   # 🔴 MF2:BOM
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
src=io.open(sys.argv[1],encoding='utf-8-sig',errors='replace').read()   # 🔴 MF2:BOM
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
    printf '%s\n' "$exists" | redact | sed 's/^/   /' >&2
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
    printf '%s\n' "$cnt" | redact | sed 's/^/   /' >&2
    return 1
  fi
  case "$cnt" in
    0) : ;;
    ''|*[!0-9]*) note "🔴 前置⑦:count 回了一個不是數字的東西('$cnt')⇒ fail-closed。"; return 1 ;;
    *) note "🔴 前置⑦:**平台帳本上已經有 $ver**(count=$cnt)⇒ 它貼過了 ⇒ 拒絕重貼。"; return 1 ;;
  esac
  note "  🟢 平台帳本無 $ver · 而前置⑥ 已證 APPLIED.tsv 也無 ⇒ **兩本帳都說沒有** ⇒ 還沒貼"
}

# ── 冪等宣告閘(⟦db-APPLYIDEMPOTENT⟧ · `-f8` 2026-09-06)────────────
# 🔴 **為什麼要有它**:兩本帳證的是「**沒有人記過**」, 不是「**跑第二次是安全的**」。
#    DDL 大多冪等(`CREATE OR REPLACE` / `IF NOT EXISTS`), 而 **DML 不是** ——
#    一支純 `INSERT` 的資料片重貼會**加倍**, 而兩本帳在它第一次貼完沒被記到時都說「沒有」。
#
# 🔬 **射程是量出來的**(當場掃 `supabase/migrations` 335 支):
#      頂層 DML **26** 支 · `DO` 區塊內 DML **26** 支(其中頂層沒有的 24)
#      · 函式體內 DML **125** 支 ⇒ 🔵 **函式體在 apply 當下【不執行】, 排除**
#    ⇒ **會在 apply 當下真的動資料的 = 頂層 ∪ DO = 50 支(15%)**
#    📌 把函式體也算進來的話這道閘會對 **42%** 的 migration 叫, 而那些**幾乎全是誤報**。
dml_check() {
  local mig hits rc
  mig="$1"
  # 🔴 **宣告只認【檔頭】**(codex must-fix):raw grep 掃全檔 ⇒ 區塊註解裡、函式 `$tag$` 裡、
  #    甚至檔案中段的一行都能冒充宣告而放行。⇒ 只讀「第一個非空非 `--` 行之前」那一段。
  if python3 - "$mig" <<'HPYEOF'
import io,sys,re
# 🔴 MF2(opus R3):BOM 留在 index 0 ⇒ `startswith('--')` 為假、`\A\s*` 也過不去
#    ⇒ 宣告檢查與 DML 偵測【同時】被打穿。實測 BOM+TRUNCATE ⇒ 閘 rc=0 而 DB 真的變了。
for line in io.open(sys.argv[1],encoding='utf-8-sig',errors='replace'):
    t=line.rstrip('\n')
    if not t.strip(): continue
    if not t.startswith('--'): break          # 檔頭結束
    if re.fullmatch(r'--\s*pcm:idempotent:\s*yes\s*', t): sys.exit(0)
sys.exit(1)
HPYEOF
  then
    note "  🔵 **檔頭**宣告 \`-- pcm:idempotent: yes\` ⇒ 放行(**責任在宣告者**, 本閘只證明有人看過)"
    return 0
  fi
  hits=$(python3 - "$mig" <<'DPYEOF'
import re,sys,io
src=io.open(sys.argv[1],encoding='utf-8-sig',errors='replace').read()   # 🔴 MF2:BOM
out=list(src); i=0; n=len(src); do_bodies=[]
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
        e=min(j+1,n)
        # 🔴 `EXECUTE 'INSERT …'` 的 DML 住在字串裡(codex must-fix)⇒ 抹掉之前先看一眼。
        if re.search(r"\b(INSERT\s+INTO|UPDATE\s+[a-zA-Z_\"]|DELETE\s+FROM|MERGE\s+INTO|TRUNCATE\s+)", src[i:e], re.I):
            do_bodies.append(src[i:e])
        blank(i,e); i=e
    elif c=='$':
        m=re.match(r'\$[A-Za-z_0-9]*\$',src[i:])
        if not m: i+=1; continue
        tag=m.group(0); close=src.find(tag,i+len(tag))
        if close<0: i+=1; continue
        body=src[i+len(tag):close]
        # 🔴 DO 的形狀不只裸 `DO $$`(codex must-fix):`DO LANGUAGE plpgsql $x$`、
        #    `DO /*註解*/ $x$` 都合法。⇒ 把前面那一段的註解與 LANGUAGE 子句剝掉再看。
        before=src[max(0,i-400):i]
        before=re.sub(r'/\*.*?\*/',' ',before,flags=re.S)
        before=re.sub(r'--[^\n]*',' ',before)
        before=re.sub(r'\bLANGUAGE\s+[A-Za-z_][A-Za-z_0-9]*\s*$',' ',before,flags=re.I)
        if re.search(r'\bDO\s*$', before, re.I): do_bodies.append(body)
        blank(i,close+len(tag)); i=close+len(tag)
    else: i+=1
top=''.join(out)
# 🔴 ⛔ ~~re.M~~(codex must-fix):`^` 變成【每一行】行首 ⇒ 換行的 `ON\nUPDATE CASCADE`、
#    `FOR\nUPDATE OF t` 會被誤認成 UPDATE。拿掉 re.M ⇒ `^` 只是檔首, 語句靠 `;` 分。
DML=re.compile(r'(\A|;)\s*(WITH\b[^;]*?)?(INSERT\s+INTO|UPDATE\s+[a-zA-Z_\"]|DELETE\s+FROM|MERGE\s+INTO|COPY\s+|TRUNCATE\s+|SELECT\b[^;]*?\bINTO\s+|CALL\s+)', re.I)
# 🔴 CTAS / materialized view 也會在 apply 當下寫資料(codex must-fix)
# 🔴🔴 而中間那一段**不可以用 `[\s\S]`** —— 它會**跨過分號** ⇒
#    「`CREATE TABLE foo(...);` 後面某處有 `AS SELECT`」也會命中。
#    實測:那一版對 repo 標出 13 支 CTAS, 而 repo 裡**一支真的 CTAS 都沒有**
#    (`grep -c 'CREATE …TABLE…AS SELECT'` ⇒ 0)⇒ 全部是誤擋。⇒ 改用 `[^;]`。
# 🔴 **TEMP / TEMPORARY 排除** —— `CREATE TEMP TABLE … ON COMMIT DROP AS SELECT` 是
#    交易結束就消失的東西, **重跑完全安全**;repo 裡的 CTAS 幾乎全是這一種(拿來做前後對照的快照)。
#    ⛔ 不排除的話這道閘會對它們叫, 而那是誤擋。
CTAS=re.compile(r'(\A|;)\s*CREATE\s+(OR\s+REPLACE\s+)?(GLOBAL\s+|LOCAL\s+)?(TEMP\w*\s+|UNLOGGED\s+)?TABLE\b[^;]*?\bAS\s+(SELECT|WITH|VALUES)\b', re.I)
# 🔴 只有【TEMP 且 ON COMMIT DROP】才排除(codex R2):
#    ⛔ ~~排除所有 TEMP CTAS~~ —— repo 實際有 TEMP CTAS **沒寫** ON COMMIT DROP
#      (`20260730120000:198`;codex 數到 11 檔 / 13 處)⇒ 「全是 ON COMMIT DROP」不成立。
#    🛑 而即使會 DROP, 查詢裡的 `nextval()` 或寫入型函式仍留永久副作用 ⇒ 這條排除是**已知的放寬**。
CTAS_SAFE=re.compile(r'(\A|;)\s*CREATE\s+(GLOBAL\s+|LOCAL\s+)?TEMP\w*\s+TABLE\b[^;]*?\bON\s+COMMIT\s+DROP\b[^;]*?\bAS\s+(SELECT|WITH|VALUES)\b', re.I)
# 🔴 plpgsql body 裡, CTAS 前面常是 `BEGIN` / `THEN` 而不是 `;`(實測 ㉑f)
CTAS_BODY=re.compile(r'(\A|;|\bBEGIN\b|\bTHEN\b|\bELSE\b|\bLOOP\b)\s*CREATE\s+(OR\s+REPLACE\s+)?(GLOBAL\s+|LOCAL\s+)?(TEMP\w*\s+|UNLOGGED\s+)?TABLE\b[^;]*?\bAS\s+(SELECT|WITH|VALUES)\b', re.I)
CTAS_BODY_SAFE=re.compile(r'(\A|;|\bBEGIN\b|\bTHEN\b|\bELSE\b|\bLOOP\b)\s*CREATE\s+(GLOBAL\s+|LOCAL\s+)?TEMP\w*\s+TABLE\b[^;]*?\bON\s+COMMIT\s+DROP\b[^;]*?\bAS\s+(SELECT|WITH|VALUES)\b', re.I)
MATV=re.compile(r'(\A|;)\s*(CREATE\s+MATERIALIZED\s+VIEW|REFRESH\s+MATERIALIZED\s+VIEW)\b', re.I)
# 🔴 `EXECUTE $q$INSERT …$q$` —— 動態 SQL 用 dollar-tag 包時, `\W{0,3}` 吃不到
#    (tag 裡的 `q` 是 word 字元)⇒ 明確允許一個 dollar-tag。
DML_BODY=re.compile(r'(\A|;|\bBEGIN\b|\bTHEN\b|\bELSE\b|\bLOOP\b|\bEXECUTE\b)\s*(?:\$[A-Za-z_0-9]*\$)?\s*\W{0,3}\s*(INSERT\s+INTO|UPDATE\s+[a-zA-Z_\"]|DELETE\s+FROM|MERGE\s+INTO|COPY\s+|TRUNCATE\s+|CALL\s+)', re.I)
found=[]
for m in DML.finditer(top):
    found.append('頂層 :%d %s' % (top[:m.start()].count('\n')+1, m.group(3).strip()[:18]))
safe=set(m.start() for m in CTAS_SAFE.finditer(top))
for m in CTAS.finditer(top):
    if m.start() in safe: continue          # TEMP + ON COMMIT DROP ⇒ 重跑安全
    found.append('頂層 :%d CREATE TABLE … AS SELECT' % (top[:m.start()].count('\n')+1))
for m in MATV.finditer(top):
    found.append('頂層 :%d %s' % (top[:m.start()].count('\n')+1, m.group(2).strip()))
def _nocmt(x):
    # 🔴 DO 的 body 是從【原文】切下來的 ⇒ 裡面的註解還在。
    #    而 `(\A|;)\s*CREATE` 這種錨要求 `;` 與關鍵字之間只有空白 ——
    #    夾著一行 `-- …` 就對不上。實錘:`20260730120000:198` 的 CTAS 因此漏擋。
    x=re.sub(r'/\*[\s\S]*?\*/',' ',x)
    return re.sub(r'--[^\n]*',' ',x)
for b0 in do_bodies:
    b=_nocmt(b0)
    for m in DML_BODY.finditer(b):
        found.append('DO 區塊或動態 SQL 內 %s' % m.group(2).strip()[:18])
    # 🔴 CTAS / matview 原本【只掃頂層】(codex R2)⇒ 放進 DO 就漏擋。
    #    實錘:`20260730120000:198` 的 `CREATE TEMP TABLE n3a_probe AS SELECT pcm_generate_display_id()`
    #    ——**沒有 ON COMMIT DROP**, 而那支函式會 `nextval()` ⇒ 重跑留下永久副作用。
    bsafe=set(m.start() for m in CTAS_BODY_SAFE.finditer(b))
    for m in CTAS_BODY.finditer(b):
        if m.start() in bsafe: continue
        found.append('DO 區塊內 CREATE TABLE … AS SELECT')
    for m in MATV.finditer(b):
        found.append('DO 區塊內 %s' % m.group(2).strip())
print('\n'.join(sorted(set(found))[:8]))
DPYEOF
) ; rc=$?
  # 🔴 **收 rc**(codex must-fix):本輪實測環境出現 `cannot create temp file` 而
  #    `--check-dml` 仍回 **rc=0** ⇒ **一道安全閘 fail-open**。
  #    ⇒ python 沒有正常結束 ⇒ 停, 不要把「跑不動」讀成「沒有 DML」。
  if [ "$rc" != "0" ]; then
    note "🔴 冪等閘:掃描器沒有正常結束(rc=$rc)⇒ fail-closed。"
    # 🔵 rc 分級(codex R2):**2 = 掃描器壞掉**, 1 = 真的擋下 ——
    #    文件裡那條計數指令原本把「任何非 0」都算成有 DML ⇒ 在掃不動的環境會假報全部。
    note "   🛑 「跑不動」與「沒有資料寫入」會印同一個空結果。"
    printf '%s\n' "$hits" | sed 's/^/   /' >&2
    return 2
  fi
  [ -z "$hits" ] && return 0
  note "🔴 這支 migration **會在 apply 當下寫資料**, 而檔頭沒有宣告冪等 ⇒ 停, 請人判。"
  note "   🛑 兩本帳證的是「沒有人記過」, **不是「跑第二次是安全的」** ——"
  note "     一支純 INSERT 的片子重貼會加倍, 而兩本帳都會說「沒有」。"
  printf '%s\n' "$hits" | sed 's/^/   /' >&2
  note "   ⇒ 確認它重跑安全之後, 在**檔頭**加一行:  -- pcm:idempotent: yes"
  note "     (🔵 **函式體內的 DML 不算** —— 那在 apply 當下不執行。)"
  return 1
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

  dml_check "$mig" || return 1
  shape=$(txn_shape "$mig")
  case "$shape" in
    clean) note "  交易形狀 clean(自帶 BEGIN…COMMIT)⇒ **不帶 -1**, 原子性由檔案自己保證" ;;
    none)  note "  交易形狀 none(零交易控制)⇒ **帶 -1**" ;;
    *)     note "🔴 交易形狀 messy(中途 COMMIT / 只有一半)⇒ 停, 這支要人判。"; return 1 ;;
  esac
}

# ── 貼前擷取:前一代定義【就是】還原腳本 ────────────────────────
# 🔴🔴 **為什麼這一步不能事前寫成一份檔案**(⟦db-NOROLLBACKARTIFACT⟧ 量到的):
#    `CREATE OR REPLACE FUNCTION / VIEW` **沒有「刪掉就回去了」這種還原** —— 前一代是被
#    **覆蓋**掉, 不是被推到旁邊。全樹 373 支 migration 裡 **162 支(43%)含 `CREATE OR REPLACE`**
#    ⇒ 📌 **它們的回退產物只在【貼之前】拿得到** ⇒ 那不是 repo 裡的一份檔案, 是**貼之前的一個動作**。
#
# 🛑🛑 **這份產物【不是】一鍵還原**(codex gpt-6-astra R1 打掉我原本那句):
#    `CREATE OR REPLACE` 本身有一組**單向**限制 —— 新版替 view 尾端加欄 / 替函式參數加 DEFAULT
#    之後, 舊定義**貼不回去**(`cannot drop columns from view` / 不能移除參數預設值);
#    新增的 **overload**(`f(text)` 而舊的是 `f(int)`)不會因為貼回舊版而消失;
#    同片若另改 **OWNER / GRANT / REVOKE**, 貼回本體**不會**把權限帶回去。
#    ⇒ 📌 **它是「前一代長什麼樣」的權威快照 + 大多數情況可直接貼回, 不是保證能還原。**
#      這些限制**逐條寫進產出檔的檔頭**, 因為讀那份檔的人不會回來讀這裡。

# 只剝註解(`--` 與 `/* */`), **保留**字串與 $tag$ 塊。
# 🔴 ⛔ ~~天真地掃 `--`~~ —— codex R1 #7 重現過:`PERFORM '--';` 之後**同一列**的動態 DDL
#    會被當成註解剝掉 ⇒ **兩把尺一起變成 0** ⇒ 下面那道「藏在 body 裡」的守門也失明。
#    ⇒ 必須**跟 mask_sql 走同一套字串/dollar 掃描**, 只是最後只把註解塗白。
strip_comments_only() {
  python3 - "$1" <<'SPYEOF'
import re,sys,io
src=io.open(sys.argv[1],encoding='utf-8-sig',errors='replace').read()
out=list(src); i=0; n=len(src)
def blank(a,b):
    for k in range(a,min(b,n)):
        if out[k]!='\n': out[k]=' '
while i<n:
    c=src[i]
    if c=='-' and i+1<n and src[i+1]=='-':
        j=src.find('\n',i); j=n if j<0 else j; blank(i,j); i=j
    elif c=='/' and i+1<n and src[i+1]=='*':
        d=1; j=i+2
        while j<n and d>0:
            if src[j]=='/' and j+1<n and src[j+1]=='*': d+=1; j+=2
            elif src[j]=='*' and j+1<n and src[j+1]=='/': d-=1; j+=2
            else: j+=1
        blank(i,j); i=j
    elif c=="'":
        j=i+1
        while j<n:
            if src[j]=="'":
                if j+1<n and src[j+1]=="'": j+=2; continue
                break
            j+=1
        i=min(j+1,n)                      # 跳過, 不塗白 —— 字串要留著
    elif c=='$':
        m=re.match(r'\$[A-Za-z_0-9]*\$',src[i:])
        if not m: i+=1; continue
        tag=m.group(0); close=src.find(tag,i+len(tag))
        if close < 0: i+=1; continue
        i=close+len(tag)                  # 同上:$tag$ 塊跳過不塗白
    else: i+=1
sys.stdout.write(''.join(out))
SPYEOF
}

# 🔴🔴 ⛔ ~~`python3 - <<'PY'`~~ —— **那個 heredoc 【就是】 stdin** ⇒ python 讀到的是它
#    自己的原始碼, `sys.stdin.read()` 拿到**空字串** ⇒ 掃出 0 支, 然後每一支貼板都印
#    「不需要前一代」**而照樣貼下去**。🛑 rc=0、有輸出、一格紅都沒有 = 看起來跑過了。
#    ✅ 程式碼走 argv(`-c`), stdin 留給管線。
# 輸出每行四欄:kind <TAB> schema(SQL 字面, 已跳脫;未限定 = 空) <TAB> name(同上) <TAB> 顯示名
COR_PY=$(cat <<'NPYEOF'
import sys,re
s=sys.stdin.read()
# RECURSIVE 是合法的(codex R1 #5:漏了它 ⇒ 既有 view 被覆蓋而零擷取)。
# 帶引號的識別字大小寫照原樣, 不帶引號的 PostgreSQL 會折成小寫
# (codex R1 #4:PUBLIC.Foo 若不折 ⇒ 查 proname='Foo' 零命中 ⇒ 誤報新物件)。
ID = u'(?:"(?:[^"]|"")+"|[A-Za-z_-￿][A-Za-z0-9_$-￿]*)'
# 🔴🔴 **[2026-09-07] 第二種形狀:`DROP FUNCTION x` + `CREATE FUNCTION x`**
#    (主視窗 `-f1` 派;來源 = 貼板 71 實際踩到 —— 它就是這個形狀, 而擷取步印
#     「這支沒有 CREATE OR REPLACE ⇒ 不需要前一代」, 然後它**真的換掉了 `create_order`
#     兩個 overload**。前一代是主視窗事後手動撈回來的, 不是這支工具存的。)
#    🎯 **判準改成「這支貼板會不會讓一個【既有物件】消失或被換掉」** ——
#      `CREATE OR REPLACE` 是**覆蓋**, `DROP` 是**拿走**, 兩者都讓前一代拿不回來。
#    🛑 **只要有 `DROP` 就算, 不必等它配一個 CREATE** —— 一支純 `DROP` 的片
#      **更**需要前一代(它的回頭路只能是「把定義貼回去」)。
#    🔵 而 `CREATE FUNCTION`(沒有 OR REPLACE)**單獨不算** —— 那是新物件, 沒有前一代;
#      它若同時有 `DROP`, 上面那一條已經涵蓋。⇒ 這樣不會把「純新增的片」誤判成要擷取。
pat = re.compile(
    u'(?:create\\s+or\\s+replace\\s+(?:recursive\\s+)?|drop\\s+(?:if\\s+exists\\s+)?)'
    u'(function|view)\\s+(?:if\\s+exists\\s+)?('
    + ID + u')(?:\\s*\\.\\s*(' + ID + u'))?', re.I)
def norm(t):
    if t.startswith('"'): return t[1:-1].replace('""','"')
    return t.lower()
def lit(t):
    return t.replace("'", "''")
seen=[]
for m in pat.finditer(s):
    kind=m.group(1).lower(); a=norm(m.group(2)); b=m.group(3)
    # 未限定 schema 不猜 public(codex R1 #6:貼板先 SET search_path=app 就猜錯)
    # ⇒ 留空, 下面的查詢改成不限 schema, 由資料庫自己回答它在哪。
    # TAB 是 IFS whitespace ⇒ shell 的 read 會把【相鄰的兩個 TAB 收成一個】
    # ⇒ 空欄位會消失、後面每一欄往左移一格。所以未限定用哨兵字, 不用空字串。
    sch, nm = (a, norm(b)) if b else ('NOSCHEMA', a)
    disp = (sch + '.' if sch != 'NOSCHEMA' else '(未限定).') + nm
    t=(kind, lit(sch), lit(nm), disp)
    if t not in seen: seen.append(t)
for row in seen: sys.stdout.write('\t'.join(row) + '\n')
NPYEOF
)
cor_names() { python3 -c "$COR_PY"; }

# 用法:capture_prev_gen <num> <paste 檔> <url>  ⇒ rc 0 = 擷取完成(含「全部都是新物件」)
# 🛑 **fail-closed**:任何一步失敗(掃描器非零 / psql 非零 / 撈到空的 / 寫不出檔)⇒ 回非 0 ⇒ **不貼**。
capture_prev_gen() {
  local num paste url outdir stamp out kind sch nm disp cnt rc wrote miss
  local list_mask list_raw rc_mask rc_raw n_mask n_raw sz_before sz_after
  num="$1"; paste="$2"; url="$3"
  outdir=$(dirname "$paste")

  # 🔴 ⛔ ~~`… | grep -c . ) || true`~~(codex R1 #2/#3)—— 那個 `|| true` 把**掃描器炸掉**
  #    與**真的零命中**折成同一個值, 而後者會印「不需要前一代」然後放行。
  #    ⇒ ✅ 掃**一次**存進變數(第三次重掃是 #3 那條:迴圈那一發失敗時整段不跑而摘要照印),
  #      並且**分開驗 rc**。
  list_mask=$(mask_sql "$paste" | cor_names) ; rc_mask=$?
  list_raw=$(strip_comments_only "$paste" | cor_names) ; rc_raw=$?
  if [ "$rc_mask" != "0" ] || [ "$rc_raw" != "0" ]; then
    note "🔴 貼前擷取:掃描器沒有正常結束(遮罩 rc=$rc_mask · 未遮罩 rc=$rc_raw)⇒ **不貼**(fail-closed)。"
    note "   🛑 「掃不動」與「這支沒有 CREATE OR REPLACE」會印同一個空結果。"
    return 1
  fi
  n_mask=$(printf '%s' "$list_mask" | grep -c . )
  n_raw=$(printf '%s' "$list_raw"  | grep -c . )

  # 🔴 mask_sql 會把 `$tag$ … $tag$` 整塊遮掉 ⇒ 一句寫在函式 body / `EXECUTE` 裡的
  #    `CREATE OR REPLACE` 對它是**看不見的**。⇒ 兩把尺不同 = 有東西藏在 body 裡。
  if [ "$n_raw" -gt "$n_mask" ]; then
    note "🔴 貼前擷取:有 CREATE OR REPLACE 藏在 \$tag\$ 塊 / 字串裡(遮罩後 $n_mask 支, 未遮罩 $n_raw 支)"
    note "   🛑 我對它的掃描**不可靠**, 而它一樣會覆蓋掉前一代 ⇒ **停**, 這支要人手動擷取前一代。"
    return 1
  fi

  if [ "$n_mask" = "0" ]; then
    note "  🔵 貼前擷取:這支沒有 CREATE OR REPLACE FUNCTION/VIEW ⇒ **不需要前一代**(不產檔)。"
    note "     🛑 而這【不等於】它可以退 —— 只表示它的退法不是「貼前擷取」這一種。"
    note "     🛑 也**不涵蓋**用字串組出來的 DDL('CREATE OR ' || 'REPLACE …')—— 那種掃不到, 而它存在。"
    return 0
  fi

  # 🔴 ⛔ ~~只到秒~~(codex R1 #14):同秒重試會用 `>` 把**唯一那份舊版**蓋掉。
  #    ⇒ 帶 PID, 而且**已存在就拒**(不覆蓋任何既有的還原腳本)。
  stamp=$(date +%Y%m%d-%H%M%S)-$$
  out="$outdir/${num}-前一代-${stamp}.sql"
  [ -e "$out" ] && { note "🔴 貼前擷取:$out 已存在 ⇒ **不覆蓋、不貼**。"; return 1; }
  {
    printf -- '-- 這是 %s 貼前的正式庫定義 = 還原腳本\n' "$num"
    printf -- '-- 產生時刻 %s   來源貼板 %s\n' "$stamp" "$(basename "$paste")"
    printf -- '--\n-- 🔴 這份檔是【前一代長什麼樣】的權威快照。大多數情況直接貼回去就退掉了,\n'
    printf -- '--    而 CREATE OR REPLACE 有一組【單向】限制 ⇒ 以下四種【貼回去會失敗或退不乾淨】:\n'
    printf -- '--    ① 新版替 view 在尾端加了欄 ⇒ 舊 SELECT 貼回報 cannot drop columns from view\n'
    printf -- '--    ② 新版替函式參數加了 DEFAULT ⇒ 舊定義貼回報「不能移除參數預設值」\n'
    printf -- '--    ③ 新版新增了 overload(舊 f(int) 而新 f(text))⇒ 貼回舊版【不會】讓新的那支消失, 要另外 DROP\n'
    printf -- '--    ④ 同片若另改 OWNER / GRANT / REVOKE ⇒ 貼回本體【不會】把權限帶回去\n'
    printf -- '--    ⇒ 撞到 ①②③④ 任一種 ⇒ 停下來人判, 不要硬貼。\n'
    printf -- '-- 🛑 「無前一代」的那幾支不在這裡面 —— 它們的退法是 DROP, 不是貼回。\n'
  } > "$out" 2>/dev/null || { note "🔴 貼前擷取:寫不出 $out ⇒ **不貼**(fail-closed)。"; return 1; }

  wrote=0; miss=0
  # 🔴🔴 **TAB 是 IFS whitespace** ⇒ `read` 會把相鄰的兩個 TAB **收成一個**
  #    ⇒ 空欄位**整格消失**, 後面每一欄往左移一格, 而**每一格都還讀得通**:
  #    實測 `function<TAB><TAB>zzq_unq<TAB>(未限定).zzq_unq` ⇒ `nm` 拿到顯示名、`disp` 空,
  #    然後 count 用空字串去查 ⇒ 回 0 ⇒ **誤報「新物件, 無前一代」而照樣貼**。
  #    ⇒ ✅ 未限定 schema 用哨兵字 `NOSCHEMA`, **永遠不送空欄位進 read**。
  while IFS="$(printf '\t')" read -r kind sch nm disp; do
    [ -n "$kind" ] || continue
    # 名字已在 python 端把 ' 折成 '' ⇒ 內插進單引號字面是安全的。
    # sch 空 ⇒ 條件退化成 n.nspname = n.nspname(不限 schema, 由 DB 回答它在哪)。
    if [ "$kind" = "function" ]; then
      cnt=$("$PSQL_BIN" "$url" -X -q -A -t -v ON_ERROR_STOP=1 -c \
        "SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname = coalesce(nullif('$sch','NOSCHEMA'), n.nspname)
            AND n.nspname NOT IN ('pg_catalog','information_schema') AND p.proname='$nm'" 2>&1) ; rc=$?
    else
      cnt=$("$PSQL_BIN" "$url" -X -q -A -t -v ON_ERROR_STOP=1 -c \
        "SELECT count(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname = coalesce(nullif('$sch','NOSCHEMA'), n.nspname)
            AND n.nspname NOT IN ('pg_catalog','information_schema') AND c.relname='$nm' AND c.relkind='v'" 2>&1) ; rc=$?
    fi
    if [ "$rc" != "0" ] || ! printf '%s' "$cnt" | grep -qE '^[0-9]+$'; then
      note "🔴 貼前擷取:問 $disp 存不存在就失敗了(rc=$rc)⇒ **不貼**(fail-closed)。"
      printf '%s\n' "$cnt" | redact | sed 's/^/   /' >&2
      return 1
    fi
    if [ "$cnt" = "0" ]; then
      note "  🔵 $kind $disp ⇒ **新物件, 無前一代**"
      printf -- '\n-- %s %s ⇒ 新物件, 無前一代(要退就是 DROP %s %s)\n' "$kind" "$disp" "$kind" "$disp" >> "$out"
      miss=$((miss+1))
      continue
    fi
    # 🔴 codex R1 #8:只驗 rc **證不到有東西被寫下來** —— 量產出檔【變大了多少】。
    sz_before=$(wc -c < "$out" | tr -d ' ')
    if [ "$kind" = "function" ]; then
      # 🔴 codex R1 #13:proconfig 的值可能含**真的換行** ⇒ 只有第一行被 `--` 註解掉,
      #    後面那幾行會**裸露成 SQL**。⇒ 把換行折成字面上的 \n 再印。
      "$PSQL_BIN" "$url" -X -q -A -t -v ON_ERROR_STOP=1 -c \
        "SELECT E'\n-- OBJ ' || p.oid::regprocedure::text || E'\n'
             || '-- proconfig(SET 子句;CREATE OR REPLACE 會把它整組換掉)= '
             || pg_catalog.translate(
                  coalesce(pg_catalog.array_to_string(p.proconfig, ' | '), '(無)'),
                  pg_catalog.chr(13) || pg_catalog.chr(10), '  ') || E'\n'
             || pg_catalog.pg_get_functiondef(p.oid) || E';\n'
           FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = coalesce(nullif('$sch','NOSCHEMA'), n.nspname)
            AND n.nspname NOT IN ('pg_catalog','information_schema') AND p.proname = '$nm'
          ORDER BY p.oid" >> "$out" 2>>"$out" ; rc=$?
    else
      # 🔴 codex R1 #1:`pg_get_viewdef` **不含** security_invoker / security_barrier /
      #    CHECK OPTION —— 貼回去會把它們清掉(那是**權限**回歸)。⇒ 從 reloptions 補回 WITH(...)。
      "$PSQL_BIN" "$url" -X -q -A -t -v ON_ERROR_STOP=1 -c \
        "SELECT E'\n-- OBJ view ' || n.nspname || '.' || c.relname || E'\n'
             || 'CREATE OR REPLACE VIEW ' || pg_catalog.quote_ident(n.nspname) || '.'
             || pg_catalog.quote_ident(c.relname)
             || coalesce(' WITH (' || pg_catalog.array_to_string(c.reloptions, ', ') || ')', '')
             || E' AS\n' || pg_catalog.pg_get_viewdef(c.oid, true) || E'\n'
           FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = coalesce(nullif('$sch','NOSCHEMA'), n.nspname)
            AND n.nspname NOT IN ('pg_catalog','information_schema')
            AND c.relname = '$nm' AND c.relkind = 'v'" >> "$out" 2>>"$out" ; rc=$?
    fi
    sz_after=$(wc -c < "$out" | tr -d ' ')
    if [ "$rc" != "0" ]; then
      note "🔴 貼前擷取:撈 $disp 的定義失敗(rc=$rc)⇒ **不貼**(fail-closed)。"
      return 1
    fi
    # 🛑 rc=0 而**一個 byte 都沒多** = 撈到空的(mock / 期間被 DROP / 權限看不到)。
    if [ "$sz_after" -le "$sz_before" ]; then
      note "🔴 貼前擷取:$disp 的 count 說有, 而撈定義**回了空的**(檔案沒有變大)⇒ **不貼**(fail-closed)。"
      note "   🛑 count 與撈定義是**兩次往返** —— 中間被 DROP / 換掉, 本機的鎖擋不到。"
      return 1
    fi
    note "  🟢 $kind $disp ⇒ 前一代已存檔"
    wrote=$((wrote+1))
  done <<COREOF
$list_mask
COREOF

  note "  ── 貼前擷取:存檔 $wrote 支 · 新物件 $miss 支 ⇒ $out"
  return 0
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
    "$PSQL_BIN" "$url" -X -v ON_ERROR_STOP=1 -1 -f "$mig" 2>&1 | redact > "$log" ; rc=${PIPESTATUS[0]}
  else
    "$PSQL_BIN" "$url" -X -v ON_ERROR_STOP=1 -f "$mig" 2>&1 | redact > "$log" ; rc=${PIPESTATUS[0]}
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
    redact < "$log" | sed 's/^/   /' >&2
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
  # 🔵 主視窗 -f1 2026-09-07 裁:cron 今晚不開(平台設定)⇒ 改成**最便宜的**:
  #    貼完在這裡提醒一句。⚠️ 這是 `echo` 文字, **不改任何邏輯、不影響 rc**。
  #    🛑 而「提醒」與「機制」不是同一個東西 —— 它會被忽略, 而 cron 不會。
  #      ⇒ 板列 ⟦db-PRODVSVC1⟧ 的關閉條件④ **仍然開著**, 這一行不算關掉它。
  note "   🔵 接著跑一次:python3 scripts/prod-vs-vc-functions.py"
  note "      (唯讀;它答「正式庫有沒有跑跟版控不同的邏輯」—— 剛貼完是唯一問得準的時刻)"
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

  # ═ ⑲ 冪等宣告閘(⟦db-APPLYIDEMPOTENT⟧)四個世界 ═
  mk 50 20995050000000 'CREATE TABLE public.zzq_50(id int);
INSERT INTO public.zzq_50(id) VALUES (1);
'
  run 50 ; ck "⑲a 頂層 INSERT 而無宣告 ⇒ 停" "$([ $? -ne 0 ] && echo ne0 || echo 0)" "ne0"
  grep -q '會在 apply 當下寫資料' "$D/out" ; ck "⑲a 是冪等閘擋的" "$?" "0"
  grep -q '頂層' "$D/out" ; ck "⑲a 印出它是頂層那一種" "$?" "0"

  # ⑲b 同一支加宣告 ⇒ 過, 而且要印那一行(責任在宣告者)
  mk 51 20995151000000 '-- pcm:idempotent: yes
CREATE TABLE public.zzq_51(id int);
INSERT INTO public.zzq_51(id) VALUES (1);
'
  run 51 ; ck "⑲b 宣告 yes ⇒ 放行" "$?" "0"
  grep -q '責任在宣告者' "$D/out" ; ck "⑲b 而且印了那一行" "$?" "0"

  # ⑲c DO 區塊內的 DML【會在 apply 當下執行】⇒ 也要擋
  mk 52 20995252000000 'CREATE TABLE public.zzq_52(id int);
DO $d$ BEGIN INSERT INTO public.zzq_52(id) VALUES (1); END $d$;
'
  run 52 ; ck "⑲c DO 區塊內 INSERT 無宣告 ⇒ 停" "$([ $? -ne 0 ] && echo ne0 || echo 0)" "ne0"
  grep -q 'DO 區塊或動態 SQL 內' "$D/out" ; ck "⑲c 印出它是 DO 那一種" "$?" "0"

  # ⑲d 🔵 **負對照**:函式體內的 DML 在 apply 當下【不執行】⇒ 必須放行。
  #    少了這一格, 把函式體也算進去的版本會通過 ⑲a/⑲c —— 而它會對 42% 的 migration 誤報。
  mk 53 20995353000000 'CREATE FUNCTION public.zzq_53() RETURNS void LANGUAGE plpgsql AS $f$
BEGIN INSERT INTO public.zzq_50(id) VALUES (2); END $f$;
'
  run 53 ; ck "⑲d 函式體內 INSERT ⇒ 放行(它在 apply 當下不執行)" "$?" "0"

  # ═ ⑳ 冪等閘的漏擋與誤擋(codex 2026-09-06 R1 逐條指名)═
  # ⑳a 假宣告:寫在【區塊註解裡】不算檔頭宣告
  mk 60 20996060000000 '/* 這裡有一行
-- pcm:idempotent: yes
*/
CREATE TABLE public.zzq_60(id int);
INSERT INTO public.zzq_60(id) VALUES (1);
'
  run 60 ; ck "⑳a 宣告藏在區塊註解裡 ⇒ 仍然擋" "$([ $? -ne 0 ] && echo ne0 || echo 0)" "ne0"
  grep -q '會在 apply 當下寫資料' "$D/out" ; ck "⑳a 是冪等閘擋的(不是別的錯)" "$?" "0"
  # ⑳b 假宣告:寫在【檔案中段】(第一個非註解行之後)不算
  mk 61 20996161000000 'CREATE TABLE public.zzq_61(id int);
-- pcm:idempotent: yes
INSERT INTO public.zzq_61(id) VALUES (1);
'
  run 61 ; ck "⑳b 宣告寫在檔案中段 ⇒ 仍然擋" "$([ $? -ne 0 ] && echo ne0 || echo 0)" "ne0"
  grep -q '會在 apply 當下寫資料' "$D/out" ; ck "⑳b 是冪等閘擋的" "$?" "0"

  # ⑳c CTAS(非 TEMP)⇒ 擋
  mk 62 20996262000000 'CREATE TABLE public.zzq_62 AS SELECT 1 AS a;
'
  run 62 ; ck "⑳c CREATE TABLE … AS SELECT ⇒ 擋" "$([ $? -ne 0 ] && echo ne0 || echo 0)" "ne0"
  grep -q 'AS SELECT' "$D/out" ; ck "⑳c 印出它是 CTAS" "$?" "0"

  # ⑳d 🔵 **負對照**:TEMP + ON COMMIT DROP 的 CTAS ⇒ 放行(重跑安全)
  #    repo 裡的 CTAS 幾乎全是這一種;不排除的話這道閘會對它們誤擋。
  mk 63 20996363000000 'CREATE TEMP TABLE _zzq_snap ON COMMIT DROP AS SELECT 1 AS a;
CREATE TABLE public.zzq_63(id int);
'
  run 63 ; ck "⑳d TEMP … ON COMMIT DROP AS SELECT ⇒ 放行" "$?" "0"

  # ⑳e DO 的其他合法形狀:LANGUAGE 子句 / 中間夾註解
  mk 64 20996464000000 'CREATE TABLE public.zzq_64(id int);
DO LANGUAGE plpgsql $x$ BEGIN INSERT INTO public.zzq_64(id) VALUES (1); END $x$;
'
  run 64 ; ck "⑳e DO LANGUAGE plpgsql \$x\$ ⇒ 擋" "$([ $? -ne 0 ] && echo ne0 || echo 0)" "ne0"
  grep -q 'DO 區塊或動態 SQL 內' "$D/out" ; ck "⑳e 是 DO 那一路認出來的" "$?" "0"
  mk 65 20996565000000 'CREATE TABLE public.zzq_65(id int);
DO /* 註解 */ $y$ BEGIN INSERT INTO public.zzq_65(id) VALUES (1); END $y$;
'
  run 65 ; ck "⑳f DO 與 tag 之間夾註解 ⇒ 擋" "$([ $? -ne 0 ] && echo ne0 || echo 0)" "ne0"
  grep -q 'DO 區塊或動態 SQL 內' "$D/out" ; ck "⑳f 是 DO 那一路認出來的" "$?" "0"

  # ⑳g 動態 SQL:EXECUTE 'INSERT …' 的 DML 住在字串裡
  mk 66 20996666000000 'CREATE TABLE public.zzq_66(id int);
DO $z$ BEGIN EXECUTE $q$INSERT INTO public.zzq_66(id) VALUES (1)$q$; END $z$;
'
  run 66 ; ck "⑳g EXECUTE 裡的 INSERT ⇒ 擋" "$([ $? -ne 0 ] && echo ne0 || echo 0)" "ne0"
  grep -q 'DO 區塊或動態 SQL 內' "$D/out" ; ck "⑳g 是動態 SQL 那一路認出來的" "$?" "0"

  # ⑳h 🔴 掃描器跑不動 ⇒ fail-closed(codex 實測環境出現 cannot create temp file 而它回 rc=0)
  #    造法:把 TMPDIR 指到一個不存在的地方 ⇒ python 的 heredoc 建不出暫存檔。
  mk 67 20996767000000 'CREATE TABLE public.zzq_67(id int);
'
  # 🔵 造法:餵它一個【目錄】⇒ python 的 open() 失敗 ⇒ 掃描器非 0 結束。
  #    (原本想用 TMPDIR 指到不存在的地方, 實測 heredoc 照樣跑得動 ⇒ 那個 fixture 造不出世界。)
  bash "$SELF" --check-dml "$T/repo/supabase" > "$D/out" 2>&1
  ck "⑳h 掃描器跑不動 ⇒ 非 0(不是讀成沒有 DML)" "$([ $? -ne 0 ] && echo ne0 || echo 0)" "ne0"

  # ═ ㉑ 新樣式各自一格(codex R2 D:它們原本零測試格 ⇒ 拿掉也全綠)═
  mk 70 20997070000000 'CREATE TABLE public.zzq_70(id int);
SELECT 1 AS a INTO public.zzq_70b;
'
  run 70 ; ck "㉑a SELECT … INTO ⇒ 擋" "$([ $? -ne 0 ] && echo ne0 || echo 0)" "ne0"
  mk 71 20997171000000 'CREATE TABLE public.zzq_71(id int);
CALL public.zzq_no_such_proc();
'
  run 71 ; ck "㉑b CALL ⇒ 擋" "$([ $? -ne 0 ] && echo ne0 || echo 0)" "ne0"
  # 🔵 C2(opus R3):這一格原本沒有判別力 —— 拿掉 CALL 樣式它照樣紅(psql 那支 proc 不存在)。
  grep -q '會在 apply 當下寫資料' "$D/out" ; ck "㉑b 是冪等閘擋的(不是 psql 說 proc 不存在)" "$?" "0"
  mk 72 20997272000000 'CREATE MATERIALIZED VIEW public.zzq_72 AS SELECT 1 AS a;
'
  run 72 ; ck "㉑c CREATE MATERIALIZED VIEW ⇒ 擋" "$([ $? -ne 0 ] && echo ne0 || echo 0)" "ne0"
  mk 73 20997373000000 'WITH x AS (SELECT 1 AS a) INSERT INTO public.zzq_70 SELECT a FROM x;
'
  run 73 ; ck "㉑d WITH … INSERT ⇒ 擋" "$([ $? -ne 0 ] && echo ne0 || echo 0)" "ne0"
  # ㉑e 🔵 **負對照(re.M 那一條的)**:換行的 ON UPDATE CASCADE / FOR UPDATE 不可誤擋
  mk 74 20997474000000 'CREATE TABLE public.zzq_74a(id int PRIMARY KEY);
CREATE TABLE public.zzq_74(
  id int REFERENCES public.zzq_74a(id) ON
  UPDATE CASCADE
);
'
  run 74 ; ck "㉑e 換行的 ON\\nUPDATE CASCADE ⇒ 放行(不是 UPDATE)" "$?" "0"
  # ㉑f DO 內的 CTAS(codex R2 實錘 20260730120000:198)
  mk 75 20997575000000 'CREATE TABLE public.zzq_75(id int);
DO $w$ BEGIN CREATE TEMP TABLE zzq_probe AS SELECT 1 AS a; END $w$;
'
  run 75 ; ck "㉑f DO 內 CTAS(無 ON COMMIT DROP)⇒ 擋" "$([ $? -ne 0 ] && echo ne0 || echo 0)" "ne0"
  grep -q 'DO 區塊內 CREATE TABLE' "$D/out" ; ck "㉑f 印出它是 DO 內的 CTAS" "$?" "0"

  # ═ ㉒ opus R3 的四條 must-fix,每條一格會紅的 ═
  # ㉒a MF1:env 檔【沒有】那個名稱 + 父行程 export 了一個 ⇒ 不可以沿用
  printf 'FOO=bar\n' > "$T/env-noname"
  _got=$(PCM_WRITE_DATABASE_URL='postgresql://INHERITED/db' load_env "$T/env-noname" | sed -n '1p')
  ck "㉒a MF1 父環境的 URL 不可以被沿用" "${_got:-EMPTY}" "EMPTY"
  # ㉒b 正對照:env 檔【有】那個名稱 ⇒ 要帶得出來(否則上面那個 EMPTY 沒有判別力)
  printf 'PCM_WRITE_DATABASE_URL=postgresql://from-file/db\n' > "$T/env-ok"
  ck "㉒b MF1 正對照:檔裡有就帶得出來" \
     "$(PCM_WRITE_DATABASE_URL='postgresql://INHERITED/db' load_env "$T/env-ok" | sed -n '1p')" "postgresql://from-file/db"
  # ㉒c env 檔自己壞掉 ⇒ rc=9(不是靜靜回空)
  printf 'if [ ; then\n' > "$T/env-bad"
  load_env "$T/env-bad" > /dev/null 2>&1
  ck "㉒c env 檔語法壞掉 ⇒ rc=9" "$?" "9"

  # ㉒d MF2:UTF-8 BOM 打穿檔頭判定與 \A 錨 ⇒ 一支 TRUNCATE 靜靜過閘
  printf '\357\273\277TRUNCATE public.zzq_one;\n' > "$T/repo/supabase/migrations/20998080000000_selftest.sql"
  cp "$T/repo/supabase/migrations/20998080000000_selftest.sql" "$T/貼板-9999/80_20998080000000_selftest.sql"
  run 80 ; ck "㉒d BOM + TRUNCATE ⇒ 仍然擋" "$([ $? -ne 0 ] && echo ne0 || echo 0)" "ne0"
  grep -q '會在 apply 當下寫資料' "$D/out" ; ck "㉒d 是冪等閘擋的" "$?" "0"
  # ㉒e MF2 另一半:BOM + 宣告 ⇒ 要認得那個宣告(否則變成漏擋)
  printf '\357\273\277-- pcm:idempotent: yes\nTRUNCATE public.zzq_one;\n' > "$T/repo/supabase/migrations/20998181000000_selftest.sql"
  cp "$T/repo/supabase/migrations/20998181000000_selftest.sql" "$T/貼板-9999/81_20998181000000_selftest.sql"
  run 81 ; ck "㉒e BOM + 檔頭宣告 ⇒ 認得它, 放行" "$?" "0"
  grep -q '責任在宣告者' "$D/out" ; ck "㉒e 而且走的是宣告那條路" "$?" "0"

  # ㉒f MF3:psql 在【URI 解析錯誤】時會逐字回吐整條連線字串(含密碼)
  #    🔴 **第一版的 fixture 沒有到達這個世界**:我餵 `…@127.0.0.1:1/x[bad`,
  #      psql 把它解析成功、只是連不上 ⇒ **沒有吐密碼** ⇒ 拔掉 `redact` 那兩格照樣綠。
  #      ⇒ 📌 又一次「格沒走到自己宣稱的地方」。真正會觸發的是**未閉合的 `[`**。
  #    🛑 而工具的前門在 selftest 模式會先擋掉這個 URI(host 抽出來是 `bad-bracket` 不是本機)
  #      ⇒ 這一格**直接測那條轉印**,而不是繞前門。正式模式的 URL 來自 `.env.local`、
  #      **不經 host 檢查** ⇒ 那條洩漏路徑是真的。
  _badurl='postgresql://usr:SUPERSECRETPW@[bad-bracket'
  _raw=$( "$PSQL_BIN" "$_badurl" -X -c 'SELECT 1' 2>&1 )
  ck "㉒f 正對照:psql 不經遮罩時【真的】吐出密碼" "$(printf '%s' "$_raw" | grep -c 'SUPERSECRETPW')" "1"
  ck "㉒f 經過 redact 之後沒有密碼" "$(printf '%s' "$_raw" | redact | grep -c 'SUPERSECRETPW')" "0"
  ck "㉒f 而它遮的是憑證那一段, 不是整行都不見" "$(printf '%s' "$_raw" | redact | grep -c '\*\*\*@')" "1"

  # ═ ⛔ **未覆蓋(明寫)**:「`.env.local` 設 `APB_SELFTEST=1`」那個世界 ═
  #    🔴 codex 2026-09-06 R1 抓到的最嚴重那條 —— dotenv 被 `source`, 它可以改掉模式,
  #      讓正式呼叫走 selftest 分支而跳過覆寫拒收與主樹檢查。
  #    ✅ 碼裡兩道都上了:`_MODE_LOCKED` 在載入前定死並在載入後強制寫回;
  #      而載入本身排在覆寫拒收【之後】。
  #    🛑 **而這一格造不出來** —— 要有一份真的主樹 `.env.local`, 而 selftest 不碰那支檔。
  #    ⇒ 📌 **未覆蓋不是通過。** 這條路今天靠的是【讀碼】, 不是【跑過】。

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


  # ═══ ⑭ 貼前擷取(前一代 = 還原腳本)═══════════════════════════
  # 🔴 這一族的核心斷言不是「有沒有產檔」, 是 **檔裡是【舊】那一版, 不是我正要貼的那一版**。
  #    ⇒ 每一格都配一個現造的負對照(新 body 的字面必須 **0** 次)。
  cap_file() { find "$T/貼板-9999" -name "$1-前一代-*.sql" 2>/dev/null | sort | tail -1; }

  # ── ⑭a 函式已存在 ⇒ 前一代要被逐字存下來(連 SET 子句)
  "$PSQL_BIN" "$URL" -X -q -c "CREATE OR REPLACE FUNCTION public.zzq_prev(a int) RETURNS int
     LANGUAGE sql SET search_path = '' AS \$\$ SELECT a + 1 \$\$" > /dev/null 2>&1
  mk 14 20991014000000 'CREATE OR REPLACE FUNCTION public.zzq_prev(a int) RETURNS int
  LANGUAGE sql SET search_path = '"''"''"''"' AS $fn$ SELECT a + 2 $fn$;
'
  run 14 ; ck "⑭a 有前一代 ⇒ rc=0" "$?" "0"
  _cap=$(cap_file 14)
  ck "⑭a 產出了前一代檔" "$([ -s "$_cap" ] && echo y || echo n)" "y"
  ck "⑭a 檔裡是【舊】body(a + 1)" "$(grep -c 'a + 1' "$_cap" 2>/dev/null | head -1)" "1"
  # 🔴 負對照:我正要貼的那一版**不可以**出現在還原腳本裡 —— 否則「還原」會把新版貼回去。
  ck "⑭a 檔裡沒有【新】body(a + 2)" "$(grep -c 'a + 2' "$_cap" 2>/dev/null | head -1)" "0"
  ck "⑭a 檔裡帶著 proconfig(SET 子句)那一行" "$(grep -c 'proconfig' "$_cap" 2>/dev/null | head -1)" "1"

  # ── ⑭b 物件不存在 ⇒ 印「新物件, 無前一代」而**照樣可以貼**
  mk 15 20991015000000 'CREATE OR REPLACE FUNCTION public.zzq_brandnew() RETURNS int
  LANGUAGE sql AS $fn$ SELECT 7 $fn$;
'
  run 15 ; ck "⑭b 新物件 ⇒ rc=0(不擋)" "$?" "0"
  grep -q '新物件, 無前一代' "$D/out" ; ck "⑭b 印了「新物件, 無前一代」" "$?" "0"

  # ── ⑭c view 走的是 pg_get_viewdef 那條
  # 🔵 欄【名】不能換(`CREATE OR REPLACE VIEW` 會直接報錯)⇒ 兩代只差字面值。
  # 🔴 ⛔ ~~`zzq_v`~~ —— 那個名字**前面的格已經建過了**(欄名 `a`)⇒ 我這句
  #    `CREATE OR REPLACE` 因為「不能改欄名」而**靜靜失敗**(rc 被 >/dev/null 吃掉),
  #    然後我拿別人的 view 當我的前一代在比。⇒ 📌 **佈置失敗與佈置成功印同一個東西。**
  #    ⇒ 換獨立名字, **並且把佈置本身也當成一格來驗**。
  "$PSQL_BIN" "$URL" -X -q -c "CREATE OR REPLACE VIEW public.zzq_v16 AS SELECT 1101 AS c" > /dev/null 2>&1
  ck "⑭c 佈置自證:舊 view 真的在 DB 裡且是 1101" \
     "$("$PSQL_BIN" "$URL" -X -q -A -t -c "SELECT c::text FROM public.zzq_v16" 2>/dev/null)" "1101"
  mk 16 20991016000000 'CREATE OR REPLACE VIEW public.zzq_v16 AS SELECT 2202 AS c;
'
  run 16 ; ck "⑭c view 有前一代 ⇒ rc=0" "$?" "0"
  _cap=$(cap_file 16)
  ck "⑭c 檔裡是【舊】view 定義(1101)" "$(grep -c '1101' "$_cap" 2>/dev/null | head -1)" "1"
  ck "⑭c 檔裡沒有【新】view 定義(2202)" "$(grep -c '2202' "$_cap" 2>/dev/null | head -1)" "0"
  ck "⑭c 檔裡有可以直接貼回去的 CREATE OR REPLACE VIEW 標頭" \
     "$(grep -c 'CREATE OR REPLACE VIEW public.zzq_v16' "$_cap" 2>/dev/null | head -1)" "1"

  # ── ⑭d 擷取失敗(寫不出檔)⇒ **不貼**
  mk 17 20991017000000 'CREATE OR REPLACE FUNCTION public.zzq_mustnot() RETURNS int
  LANGUAGE sql AS $fn$ SELECT 1 $fn$;
'
  _led_before=$(led_rows)
  chmod 500 "$T/貼板-9999"
  # 🔴 量具自證:先證這個世界**真的**寫不進去 —— 不然下面那個 rc≠0 可能是別的原因造成的。
  ck "⑭d 量具自證:貼板目錄真的寫不進去" \
     "$(touch "$T/貼板-9999/zzq_probe" 2>/dev/null && echo y || echo n)" "n"
  run 17 ; ck "⑭d 擷取失敗 ⇒ rc≠0" "$([ $? -ne 0 ] && echo ne0 || echo 0)" "ne0"
  grep -q '貼前擷取:寫不出' "$D/out" ; ck "⑭d 是【貼前擷取】那道擋的" "$?" "0"
  chmod 700 "$T/貼板-9999"
  ck "⑭d 帳本沒有多一行" "$(led_rows)" "$_led_before"
  # 🔴 fail-closed 的真正意思是【DB 沒有變】, 不是【印了紅字】。
  ck "⑭d 那支函式沒有進 DB" \
     "$("$PSQL_BIN" "$URL" -X -q -A -t -c "SELECT to_regprocedure('public.zzq_mustnot()') IS NULL" 2>/dev/null)" "t"

  # ── ⑭e CREATE OR REPLACE 藏在 $tag$ body 裡 ⇒ 掃不可靠 ⇒ 停
  mk 18 20991018000000 'CREATE OR REPLACE FUNCTION public.zzq_wrap() RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  EXECUTE $inner$ CREATE OR REPLACE FUNCTION public.zzq_hidden() RETURNS int LANGUAGE sql AS $h$ SELECT 1 $h$ $inner$;
END
$fn$;
'
  run 18 ; ck "⑭e 藏在 body 裡 ⇒ rc≠0" "$([ $? -ne 0 ] && echo ne0 || echo 0)" "ne0"
  grep -q '藏在' "$D/out" ; ck "⑭e 是【藏在 body 裡】那道擋的" "$?" "0"

  # ── ⑭f 同一列先出現字串 '--' ⇒ 天真的剝註解會把**同列後面**的動態 DDL 一起吃掉
  #    (codex R1 #7)。兩把尺一起變 0 ⇒ ⑭e 那道守門會跟著失明。
  # 🔵 用**單引號函式體**(舊式寫法, 合法):mask_sql 會把它整段遮掉 ⇒ n_mask=1;
  #    而剝註解那把尺**必須跳過字串而不塗白** ⇒ 看得到裡面那支 ⇒ n_raw=2 ⇒ 停。
  #    天真版(把字串也塗白)⇒ n_raw=1 ⇒ **兩把尺一樣 ⇒ 放行**。實測 1/2 vs 1/1。
  cat > "$T/repo/supabase/migrations/20991019000000_selftest.sql" <<'FDASH'
CREATE OR REPLACE FUNCTION public.zzq_dash() RETURNS void LANGUAGE plpgsql AS '
BEGIN EXECUTE ''CREATE OR REPLACE FUNCTION public.zzq_hid2() RETURNS int LANGUAGE sql AS ''''SELECT 1'''''';
END';
FDASH
  cp "$T/repo/supabase/migrations/20991019000000_selftest.sql" "$T/貼板-9999/19_20991019000000_selftest.sql"
  run 19 ; ck "⑭f 單引號函式體裡藏的 CREATE OR REPLACE ⇒ 仍然要擋" "$([ $? -ne 0 ] && echo ne0 || echo 0)" "ne0"
  grep -q '藏在' "$D/out" ; ck "⑭f 而且是【藏在 body 裡】那道擋的(不是別的錯救活它)" "$?" "0"

  # ── ⑭g 大小寫:`PUBLIC.ZZQ_Case` 不折成小寫 ⇒ 查 proname='ZZQ_Case' 零命中
  #    ⇒ **誤報新物件而照樣覆蓋**(codex R1 #4)。
  "$PSQL_BIN" "$URL" -X -q -c "CREATE OR REPLACE FUNCTION public.zzq_case(a int) RETURNS int
     LANGUAGE sql AS \$\$ SELECT a + 3301 \$\$" > /dev/null 2>&1
  ck "⑭g 佈置自證:舊函式真的在(回 3302)" \
     "$("$PSQL_BIN" "$URL" -X -q -A -t -c "SELECT public.zzq_case(1)" 2>/dev/null)" "3302"
  mk 21 20991021000000 'CREATE OR REPLACE FUNCTION PUBLIC.ZZQ_Case(a int) RETURNS int
  LANGUAGE sql AS $fn$ SELECT a + 4400 $fn$;
'
  run 21 ; ck "⑭g 大寫寫法 ⇒ rc=0" "$?" "0"
  _cap=$(cap_file 21)
  ck "⑭g 抓到了前一代(3301), 沒有誤報新物件" "$(grep -c '3301' "$_cap" 2>/dev/null | head -1)" "1"

  # ── ⑭h 未限定 schema:不猜 public, 讓 DB 自己回答它在哪(codex R1 #6)
  "$PSQL_BIN" "$URL" -X -q -c "CREATE OR REPLACE FUNCTION public.zzq_unq() RETURNS int
     LANGUAGE sql AS \$\$ SELECT 5501 \$\$" > /dev/null 2>&1
  mk 22 20991022000000 'CREATE OR REPLACE FUNCTION zzq_unq() RETURNS int
  LANGUAGE sql AS $fn$ SELECT 6600 $fn$;
'
  run 22 ; ck "⑭h 未限定 schema ⇒ rc=0" "$?" "0"
  _cap=$(cap_file 22)
  ck "⑭h 未限定也抓到前一代(5501)" "$(grep -c '5501' "$_cap" 2>/dev/null | head -1)" "1"

  # ── ⑭i view 的 security_invoker 要跟著進還原腳本(codex R1 #1)——
  #    `pg_get_viewdef` **不含**它, 貼回去會把它清掉, 而那是**權限**回歸。
  "$PSQL_BIN" "$URL" -X -q -c "CREATE OR REPLACE VIEW public.zzq_si WITH (security_invoker=true) AS SELECT 7701 AS c" > /dev/null 2>&1
  ck "⑭i 佈置自證:舊 view 真的帶 security_invoker" \
     "$("$PSQL_BIN" "$URL" -X -q -A -t -c "SELECT (reloptions::text LIKE '%security_invoker%')::text FROM pg_class WHERE oid='public.zzq_si'::regclass" 2>/dev/null)" "true"
  mk 23 20991023000000 'CREATE OR REPLACE VIEW public.zzq_si AS SELECT 8800 AS c;
'
  run 23 ; ck "⑭i view 有 reloptions ⇒ rc=0" "$?" "0"
  _cap=$(cap_file 23)
  ck "⑭i 還原腳本帶著 WITH (security_invoker=...)" \
     "$(grep -c 'WITH (security_invoker' "$_cap" 2>/dev/null | head -1)" "1"

  # ── ⑮ 🔴 **[2026-09-07] `DROP FUNCTION x` + `CREATE FUNCTION x`** —— 貼板 71 就是這個形狀,
  #    而舊版的掃描器對它印「不需要前一代」, 然後它真的換掉了 create_order 兩個 overload。
  "$PSQL_BIN" "$URL" -X -q -c "CREATE OR REPLACE FUNCTION public.zzq_dropcreate() RETURNS int
     LANGUAGE sql AS \$\$ SELECT 9901 \$\$" > /dev/null 2>&1
  ck "⑮ 佈置自證:舊函式真的在(回 9901)" \
     "$("$PSQL_BIN" "$URL" -X -q -A -t -c "SELECT public.zzq_dropcreate()" 2>/dev/null)" "9901"
  mk 24 20991024000000 'DROP FUNCTION public.zzq_dropcreate();
CREATE FUNCTION public.zzq_dropcreate() RETURNS int
  LANGUAGE sql AS $fn$ SELECT 9902 $fn$;
'
  run 24 ; ck "⑮a DROP+CREATE ⇒ rc=0" "$?" "0"
  _cap=$(cap_file 24)
  ck "⑮a 前一代存下來了(舊 body 9901)" "$(grep -c '9901' "$_cap" 2>/dev/null | head -1)" "1"
  # 🔴 負對照:純 CREATE(沒有 DROP)的【新物件】⇒ 不該擷取, 否則等於「什麼都抓」
  mk 25 20991025000000 'CREATE FUNCTION public.zzq_pure_new() RETURNS int
  LANGUAGE sql AS $fn$ SELECT 7 $fn$;
'
  run 25 ; ck "⑮b 純 CREATE 新物件 ⇒ rc=0" "$?" "0"
  grep -q '不需要前一代' "$D/out" ; ck "⑮b 而且【不】擷取(印不需要前一代)" "$?" "0"

  # ⛔ **未覆蓋(明寫)**:「count 說有、而撈定義回空」那道守門(sz_after <= sz_before)——
  #    要造出它, 需要在**兩次往返之間**把物件 DROP 掉(真的競賽), selftest 造不出來。
  #    ⇒ 它由**突變**驗過(把撈定義那句換成 `SELECT ''` ⇒ 該格轉紅), 不由這裡的格驗。

  pg_ctl -D "$D/data" stop -m fast > /dev/null 2>&1 ; local src=$?
  [ "$src" = "0" ] || printf '  🔵 pg_ctl stop rc=%s ⇒ 保留 %s(不刪可能還在跑的 data dir)\n' "$src" "$D"
  if [ "$fail" != "0" ] || [ "$src" != "0" ]; then
    printf '  🔵 保留現場:%s\n' "$D"
  else
    rm -rf "$D"
  fi
  printf '── selftest: %s PASS / %s FAIL\n' "$pass" "$fail"
  # 🔵 格數當場數 —— 這個數字每加一格就要跟著改, 而它的用途是「有沒有格被刪掉或沒跑到」。
  if [ "$((pass + fail))" != "155" ]; then
    printf '  🔴 【格數】不對:跑了 %s 格 ≠ 155 ⇒ 有格被刪掉或沒跑到\n' "$((pass + fail))" >&2
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
    # 🔵 讓「有幾支會被冪等閘擋」這個數字**用同一支碼數得出來** ——
    #    另寫一支腳本去數 = 兩把尺, 而它們遲早會分岔。
    --check-dml) [ $# -ge 2 ] || die '🔴 --check-dml 缺檔案'; dml_check "$2"; exit $? ;;
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

# ── F6(opus R4)+ codex 本輪 must-fix:`.env.local` 的載入時機 ──────
# 🔴 F6 要它**早於路徑與 URL 的決定**;
# 🔴🔴 **而 codex 本輪抓到我那個修法自己開的洞**:`.env.local` 是被 `source` 的,
#    **它可以設 `APB_SELFTEST=1`** ⇒ 正式呼叫改走 selftest 分支 ⇒ **跳過覆寫拒收與主樹檢查**。
#    ⇒ 兩道一起上:①**模式在載入之前就定死**, 載完強制寫回 ②載入**排在覆寫拒收之後**
#      (那一道本來就不需要 `.env.local`)⇒ dotenv 影響不到任何一個決定。
#    📌 **一個「把載入提早」的正確修法, 製造了一條它自己沒有的路。**
_MODE_LOCKED="${APB_SELFTEST:-0}"

# ── 正式模式:拒收任何覆寫 ────────────────────────────────────
# 🔴🔴 codex R1 ①:v1 的 `--db-url` / `--root` / `APB_*` 在正式模式一樣生效
#    ⇒ 可以繞過「沒有 PCM_WRITE_DATABASE_URL 就停」, 把任意 repo 的 migration 貼到任意庫。
if [ "$_MODE_LOCKED" = "1" ]; then
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

if [ "$_MODE_LOCKED" != "1" ]; then
  # 🔴🔴 ⛔ ~~在本行程 `source` 再把 `_MODE_LOCKED` 寫回去~~ —— **那擋不住**(codex R2):
  #    `.env.local` 是被 source 的, 它可以覆寫**任何**變數 —— `_MODE_LOCKED` 自己、
  #    `NUM`、`DBURL`、`ROOT_OVERRIDE`、`MAIN_TREE`、`PSQL_BIN` 全部。
  #    📌 **一個「載完再寫回去」的鎖, 鎖不住能改寫那把鎖的東西。**
  #    ✅ 改成【在子行程裡載入, 只把兩個 URL 帶回來】⇒ 其他變數**出不了那個子行程**。
  [ -f "$MAIN_TREE/.env.local" ] || die '🔴 主樹沒有 .env.local ⇒ 停(只印名不印值)。'
  _envpair=$(load_env "$MAIN_TREE/.env.local") ; erc=$?
  PCM_WRITE_DATABASE_URL=$(printf '%s' "$_envpair" | sed -n '1p')
  PCM_READONLY_DATABASE_URL=$(printf '%s' "$_envpair" | sed -n '2p')
  unset _envpair
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

# 🔴 **貼前擷取排在 apply 之前, 而 `--dry-run` 也跑** —— 它是唯讀的, 而它的產物
#    (前一代定義)**只有在這個時間點拿得到**。⇒ fail-closed:擷取不出來就不貼。
capture_prev_gen "$NUM" "$PASTE" "$URL" || exit 1

if [ "$DRY" = "1" ]; then
  static_checks "$MIG" || exit 1
  note ""
  note "🔵 --dry-run:前置全過(含 meta-command 與交易形狀), **什麼都沒有貼**。"
  exit 0
fi
do_apply "$NUM" "$VER" "$MIG" "$PASTE" "$ROOT" "$URL"
