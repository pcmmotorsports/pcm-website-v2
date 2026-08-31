#!/usr/bin/env bash
# ============================================================
# 部署時序 gate — 「應用層不得先於它依賴的 migration apply 上線」
# ============================================================
# plan = docs/specs/2026-08-11-deploy-order-gate-plan.md(v3;Sean 2026-08-11 拍 Q1=A / **Q2=B** / Q3=A)
# 掛點 = .husky/pre-push(git 由 stdin 餵 `<local-ref> <local-sha> <remote-ref> <remote-sha>`,一行一 ref)
#
# ── 這道閘擋什麼 ─────────────────────────────────────────────
# 事故本體=2026-08-07 A9h:app 層先上線、`a9h_m` 未 apply ⇒ 正式站 `PGRST202`、壞約 8 小時,
# 而那一夜的審查鏈/三綠/harness **沒有任何一道看得見它**(memory
# `feedback_app-layer-must-not-ship-before-migration-apply`)。
#
# 判準(**零宣告**,plan §3):
#   1. PENDING = `supabase/migrations/*.sql` 的版本號 − `supabase/APPLIED.tsv` 已記錄且 sha 相符的版本號
#   2. 對每支 pending migration,抽出它 `CREATE [OR REPLACE] FUNCTION` 的**函式名**
#      **以及**(2026-08-24 放寬)`CREATE [OR REPLACE] [MATERIALIZED] VIEW` 的**view 名**。
#
#      ~~🔴 **只抽函式名**是 Sean 的拍板(Q2=B「寧可漏擋、只比對 RPC 函式名」)——~~
#      ~~   table / column / view / index 名一律**不比**,因為它們(如 `orders`)撞常見字的機率高、誤擋體感差。~~
#      ~~   ⇒ 這是**刻意的漏擋**,不是漏寫;代價寫在 plan §6。~~
#      🔴 **上面那段【劃掉不刪】** —— 下一個人要看得到「當初為什麼只抽函式」,
#         否則他會把 view 造成的誤擋當成 bug 去修,而那是 2026-08-11 深思過的取捨。
#
#      🔴 **2026-08-24 Sean 逐字答「放寬」**(memory `project_0824-sean-widens-deploy-order-gate`)。
#      **放寬的是 view,不是 table / column / index** —— 後三者維持 Q2=B 的不比,理由沒變(撞常見字)。
#      放寬的證據(2026-08-24 全量乾跑,量測時點寫在數字旁邊):
#        分母 `supabase/migrations/*.sql` = 209 支  ← ⚠️ **量測時點的值, 2026-08-24 夜已是 214**
#        (🔴 分母不要引用這一行, 當場跑 `ls supabase/migrations/*.sql | wc -l`。
#          留著 209 是因為底下那幾個數字是**在 209 那個分母上量的**, 換掉會讓它們失去出處。)
#          有 CREATE FUNCTION(放寬前看得到)  = 123
#          **只有 VIEW 沒有 FUNCTION ⇒ 放寬前【完全看不到】= 13**
#          兩者皆無(加欄 / 建表 / RLS…)= 73  ← 仍然不管,Q2=B 的射程未變
#        當天真的 PENDING = 2 支 ⇒ 放寬之後【新增】擋下 1 支、**誤擋 0 支**
#          擋下的那支 = `20260823030000_m4b_841_order_paid_total_view.sql`(零函式、建 `admin_order_list_v`)
#          而它**應該**被擋:`#841` 的紀錄逐字「推之前必須先套 SQL,否則後台訂單列表整個 400」。
#
#   🔴 **射程限定(它第一次吵起來的那天,先讀這段再決定要不要改這道閘)**:
#      上面「誤擋 0」是建立在**當天 PENDING 只有 2 支**上。
#      **若哪天有人一次帶進十幾支未記帳的 migration(例如整批補記之前),誤擋會逼近上界** ——
#      ~~同一發乾跑量到的上界是 **16 組 (migration, view)**(把每一支都當成 pending 去算)。~~
#      🔴 **2026-08-24 codex 對抗審查:16 不是上界, 劃掉不刪。** 兩個理由:
#        ① 實作的 BLOCKED 單位是 **(應用檔, view)** —— 一支 pending view 若被 N 支改動的 app 檔提到,
#           就產生 N 筆提示 ⇒ N 可以超過 16。
#        ② `(migration, view)` 這個分母還被 `VIEW_LIST` 的 `sort -u` 壓平過 ⇒ 與實際提示數不同尺。
#      📏 **線3 2026-08-24 重量(分母 214, 把每一支都當 pending 的最壞情況;量具自檢 214==ls)**:
#        抽得到 view 名的 migration **20 支** · `(migration, view)` 組數 **25** · **會被擋的 migration 14 支**
#        ⇒ 最壞情況是 **14/214**, 而它只在「帳本整個沒跟上」時才成立。
#        ⚠️ 這仍**不是**提示筆數的上界(理由同 ①)—— 提示筆數要乘上「有幾支 app 檔提到它」。
#      ⇒ 🔴 **那時它會很吵,而吵的原因是【帳本沒跟上】,不是這道閘壞了。**
#        先去補 `APPLIED.tsv`,不要先來改這裡。
#   3. 若這次要推的範圍內,`apps/**` 或 `packages/**` 的非測試檔 diff **出現那些函式名的完整識別字** ⇒ 擋
#
# ── 為什麼不留「宣告」欄位 ───────────────────────────────────
# plan v1 用 commit body 宣告 ⇒ 關卡1 走了一遍 A9h 序列:寫一行就放行、事故一字不差重演。
# plan v2 改成宣告 + flag registry ⇒ 關卡1 R2:隨便指一支無關的預設 off flag 就過。
# ⇒ **靠人打字的例外一定會變成儀式**。要繞請用 `git push --no-verify`,並在 commit body 寫明理由 ——
#   讓「繞過」留在人的動作裡、看得見。
#
# ── 誠實邊界(plan §6;不假裝覆蓋)───────────────────────────
#   · 只看得到**本機 git push**:GitHub 網頁 merge / Vercel Redeploy / Vercel CLI / 別台機器,全部看不到。
#   · `APPLIED.tsv` 是自陳帳:更新了卻沒真 apply、或正式庫被 restore ⇒ 攔不到。
#   · 反向事故(migration 先上、舊 app 撞 `PGRST201`)不在射程。
#   · `--no-verify` / `HUSKY=0` 可繞(與 `.husky/reviewer-gate.sh` 同一個天花板)。
#   · **只比 RPC 函式名**(Sean Q2=B):純加欄位 / 建表 / 改 RLS 的 migration **零覆蓋** —— 刻意的。
#   · 呼叫端若**不是逐字寫函式名**(字串拼接、樣板字串、動態 key),抓不到;這是文字比對的天花板。
#     ⚠️ **「常數表」已不在這一行的射程裡了**(2026-08-21 A-bc):`.rpc(SOME_FN, …)` 現在會回頭
#        解析 `SOME_FN = 'fn'`,而**解析不到就擋**。詳見下方比對段的行內註解。
#   · 窗口只開到 `.rpc(` 之後**兩行** —— 函式名在第三行以後的呼叫,抓不到。
#   · `supabase/functions/**` 不在分母裡(本閘只掃 `apps/**` 與 `packages/**`)。
#   · 「整串字面」那條只認**單引號 / 雙引號**;反引號樣板字串 `` `fn` `` 不算。
#
# ── 🔴 寫這道閘(或任何用 grep 當量具的閘)之前必讀的一個坑 ─────────────
#   **`git grep -E` 不支援 `\b`,而且它【靜默不匹配】而不是報語法錯。**
#   實測(2026-08-21 A-bc,拋棄式 repo):
#     git grep -hoE "\bPROBE_FN[[:space:]]*=[^;]*" <sha> -- apps  ⇒ **零行**
#     git grep -hoE   "PROBE_FN[[:space:]]*=[^;]*" <sha> -- apps  ⇒ 命中
#   ⇒ **一個不支援的語法回的是「沒找到」** ⇒ 一道閘會安靜地變成恆綠,而它的正常狀態
#     本來就是綠的 ⇒ **沒有人會發現。**
#   ⇒ 本檔一律用 `(^|[^A-Za-z0-9_])…([^A-Za-z0-9_]|$)` 字元類邊界,不用 `\b`。
#
# ── 🔴🔴 改本檔的人先讀這一格:**它的生效時刻是【存檔】,不是【commit】** ──────
#   `.husky/pre-push:39` 執行的是 `"$_R/scripts/deploy-order-gate.sh"` ——
#   **`$_R` 是工作樹根,不是 HEAD** ⇒ 你一存檔,全隊每一次 push 就開始跑你這一版。
#   2026-08-21 實錘:A-bc 改完本檔、以為自己在「等審查、還沒上線」,而
#   **Sean 當晚推的兩發(`5c660c98..67816357` 24 顆、`67816357..ca4a7085` 5 顆)都經過這一版**。
#   ⇒ 好消息:那不是紙上驗證,它在正式流程裡跑過兩次而沒有誤擋。
#   ⇒ 壞消息:**「等審完再上線」在技術上不成立** —— 主視窗與施工窗兩邊都以為它還沒生效。
#   ⚠️ **同一件事對 `.husky` 指到的每一支腳本都成立**,不只本檔。
#   ⇒ 改到一半就離開座位 ⇒ 全隊在跑你的半成品。要真的「還沒上線」,只能不存檔或先搬走。
#
# 用法(pre-push 之外可單獨跑,方便測):
#   printf '%s\n' "refs/heads/dev <local-sha> refs/heads/dev <remote-sha>" | bash scripts/deploy-order-gate.sh
#   DOG_DEBUG=1 …  額外印出 PENDING 與抽到的函式名
# ============================================================
set -uo pipefail
export LC_ALL=C

# ── 摘要行(2026-08-18;V 窗提、主視窗立案)───────────────────────────────
# 🔴 為什麼要有:本閘通過時原本是**完全靜默**的 ⇒ 在 Sean 的螢幕上,
#    「跑了而沒東西該擋」與「根本沒跑」長得一模一樣,而他是唯一會看到那個畫面的人。
# 🔴 那一行的內容由【結果】決定,不是無條件印同一句 —— 常載規矩:
#    `cmd; echo "(空 = 零命中)"` 在有命中時照樣印,而它就印在命中的正下方。
# 🔴 「0 blocked / 0 pending」與「一個 ref 都沒檢查」是**兩件事**,所以 REF_N 要單獨報:
#    推 feature branch / 推 tag 時本閘刻意不看(只看 dev 與 main),
#    此時若印「0 blocked」會被讀成「檢查過、乾淨」——那正是本閘要避免的那種沉默。
REF_N=0; PENDING_N=0
# 🔵 2026-09-01 加(主視窗批):REF_N=0 時把【收到的原始 stdin】原封留一份。
#    成因:第十三批一發 non-ff 被拒的 push, 閘印「未檢查任何 ref」而沒有留下它到底收到什麼
#    ⇒ 只能事後推。本機四個世界重現不出那個空 stdin(non-ff / --force 都給 114 bytes;
#      只有 Everything up-to-date 給 0)⇒ 差異可能在 SSH 傳輸層, 而那一格【未量】。
#    🔴 這一段不下判斷、不改行為 —— 它只讓【下一次】自己留下證據。
GATE_STDIN="$(mktemp -t dogstdin 2>/dev/null || echo /tmp/dogstdin.$$)"
trap 'rm -f "$GATE_STDIN"' EXIT
summary() {  # $1 = 結論標籤
  if [ "$1" = "skipped" ]; then
    echo "gate: 跳過($2)—— 本閘沒有判準,不是「檢查過而乾淨」" >&2
  elif [ "$REF_N" = "0" ]; then
    # 🔴 原始 stdin 留一份, 帶時間戳、不覆蓋 ⇒ 兩次發生時兩份都在。
    # 🔵 印在摘要行【之前】是刻意的:驗證器取 `tail -1`,
    #    把摘要行擠掉會讓「有沒有印對摘要」變成假紅。
    if [ -f "${GATE_STDIN:-}" ]; then
      _gd="$(git rev-parse --git-dir 2>/dev/null || echo .git)"
      _gf="$_gd/deploy-order-gate-empty-$(date +%Y%m%d-%H%M%S)-$$.txt"
      if cp "$GATE_STDIN" "$_gf" 2>/dev/null; then
        echo "gate: 原始 stdin 已留存 ⇒ $_gf($(wc -c < "$_gf" | tr -d ' ') bytes)" >&2
      else
        echo "gate: 想留存原始 stdin 但寫不進去($_gf)—— 這一發沒有證據" >&2
      fi
    fi
    echo "gate: 未檢查任何 ref(這次推的不是 refs/heads/dev 或 refs/heads/main)" >&2
  else
    echo "gate: $1 blocked / $PENDING_N pending(檢查了 $REF_N 個 ref)" >&2
  fi
}

REPO="$(git rev-parse --show-toplevel 2>/dev/null || echo .)"
cd "$REPO" || { summary skipped "進不去 repo 根"; exit 0; }
LEDGER="supabase/APPLIED.tsv"
ZERO="0000000000000000000000000000000000000000"

# 沒有 migrations 目錄的 repo 狀態(例如淺 clone)⇒ 這道閘沒有判準,放行而不是假裝有守
[ -d supabase/migrations ] || { summary skipped "無 supabase/migrations"; exit 0; }

# ── 0. ledger 自身合法性(關卡2 must-fix #10):重複版本號會讓「取第一列」靜默取錯,
#      欄數壞掉會讓 sha 欄變空 ⇒ 兩種都是**靜默算錯**,而不是報錯。fail-closed。
# 🔴 吃的是 `$1=rev` 那棵樹的 ledger,不是工作樹(code-reviewer must-fix):
#    工作樹裡一行寫到一半的 ledger(apply 停點正在寫)不該讓**別條 ref 的 push** 紅,
#    而且讀工作樹與本檔 :69 自己寫的「一律讀 local_sha 那棵樹」直接矛盾。
ledger_sanity() { # $1=rev
  local blob bad
  blob="$(git show "$1:$LEDGER" 2>/dev/null || true)"
  [ -n "$blob" ] || return 0
  bad="$(printf '%s\n' "$blob" | grep -v '^#' | awk -F'\t' 'NF>0 && NF!=4 {print "欄數="NF" 行:"$0}')"
  if [ -n "$bad" ]; then
    echo "🔴 部署時序 gate:$LEDGER 有格式壞掉的行(必須 TAB 分隔四欄):" >&2
    printf '%s\n' "$bad" | head -3 >&2; return 1
  fi
  bad="$(printf '%s\n' "$blob" | grep -v '^#' | cut -f1 | sort | uniq -d)"
  if [ -n "$bad" ]; then
    echo "🔴 部署時序 gate:$LEDGER 有重複的版本號 ⇒ 取哪一列會決定結果,拒絕猜:" >&2
    printf '%s\n' "$bad" | head -3 >&2; return 1
  fi
  return 0
}
# ── 1. PENDING:本地有、但帳上沒有(或 sha 對不上)────────────────────────
#    🔴 sha 也要比:同版本號的檔案內容事後被改動 ⇒ 帳上那行證明的是**另一份**內容(關卡1 R2 #2)。
# 🔴 **一律讀 `local_sha` 那棵樹,不讀工作樹**(關卡2 must-fix #4):
#    推別的 branch、在 worktree 裡、rebase 中途 —— 工作樹的 migrations 與 ledger 都可能不是要推的那份。
pending_versions() { # $1=local_sha;讀不到樹/blob 一律 fail-closed(關卡2 R2 #2)
  local rev="$1" f base ver sha rec ledger_blob tree
  ledger_blob="$(git show "$rev:$LEDGER" 2>/dev/null || true)"   # ledger 可以不存在(第一次建檔前)
  if ! tree="$(git ls-tree --name-only "$rev" supabase/migrations/ 2>/dev/null)"; then
    echo "🔴 部署時序 gate:讀不到 $rev 的 supabase/migrations 樹(partial clone?)⇒ fail-closed。" >&2
    echo "   確認過安全就用 git push --no-verify。" >&2
    return 2
  fi
  printf '%s\n' "$tree" | grep -E '\.sql$' | while read -r f; do
    base="${f##*/}"; ver="${base%%_*}"
    # 🔴 存在性與內容分兩步:把 blob 收進變數再算 sha 會**吃掉尾端換行**,
    #    而 ledger 的 sha 是對檔案原始位元組算的 ⇒ 每一支都會變成 sha 不符 = 全部誤判成 pending
    #    (第一版就是這樣寫的,格④ 當場翻紅抓到)。存在性用 `cat-file -e`,內容一律走 pipe。
    if ! git cat-file -e "$rev:$f" 2>/dev/null; then
      echo "🔴 部署時序 gate:讀不到 $rev:$f 的內容 ⇒ fail-closed。" >&2; exit 2
    fi
    sha="$(git show "$rev:$f" 2>/dev/null | shasum -a 256 | cut -d' ' -f1)"
    rec="$(printf '%s\n' "$ledger_blob" | grep -v '^#' | awk -F'\t' -v v="$ver" '$1==v {print $2; exit}')"
    [ "$rec" = "$sha" ] || printf '%s\t%s\n' "$ver" "$f"
  done
}

# ── 2. 從 pending migration 抽 RPC 函式名(Q2=B:只抽這個)──────────────
#    `CREATE FUNCTION public.foo(` / `CREATE OR REPLACE FUNCTION foo (` 都要抓得到;
#    schema 前綴去掉(app 端呼叫 RPC 時寫的是不帶 schema 的名字)。
fn_names_of() { # $1=rev:path
  # 🔴 關卡2 must-fix #8:第一版只認「同一行、全大寫」。這裡改成
  #    ①大小寫不敏感 ②允許 `IF NOT EXISTS` ③允許 `FUNCTION` 之後換行才寫名字(先把換行壓成空白)。
  git show "$1" 2>/dev/null \
    | tr '\n' ' ' \
    | sed -E 's/[Cc][Rr][Ee][Aa][Tt][Ee]([[:space:]]+[Oo][Rr][[:space:]]+[Rr][Ee][Pp][Ll][Aa][Cc][Ee])?[[:space:]]+[Ff][Uu][Nn][Cc][Tt][Ii][Oo][Nn]([[:space:]]+[Ii][Ff][[:space:]]+[Nn][Oo][Tt][[:space:]]+[Ee][Xx][Ii][Ss][Tt][Ss])?[[:space:]]+/\n@@FN@@/g' \
    | sed -nE 's/^@@FN@@([a-zA-Z0-9_."]+).*/\1/p' \
    | tr -d '"' | sed 's/.*\.//' | sort -u
}

# ── 2b. 從 pending migration 抽 VIEW 名(2026-08-24 放寬新增)──────────────
#    `CREATE VIEW x` / `CREATE OR REPLACE VIEW public.x` / `CREATE MATERIALIZED VIEW x` 都要抓到。
#    形狀與 `fn_names_of` 刻意一致(同一個坑只踩一次):壓換行、大小寫不敏感、容 IF NOT EXISTS、去 schema 前綴。
# 🔴 **2026-08-24 線3:先剝 SQL 註解, 再抽名字(codex 對抗審查 ③, 實測誤擋)。**
#    構造:一支 migration 的**行註解**裡寫著 `-- CREATE VIEW public.ghost_v AS …`,
#    而 app 這次新增讀的是**早就存在**的 `ghost_v` ⇒ 舊版把註解抽成一支 pending view ⇒ **rc=1 誤擋**。
#    (實測:拋棄式 repo, 正對照=正常 view+讀 ⇒ 擋、負對照=無關改動 ⇒ 放行, 兩發都活。)
#    🔴 而它擋的理由對讀的人完全不成立 —— 那支 view 早就在庫裡, 訊息卻叫他「先 apply」。
# ⚠️ **射程**:只剝 `--` 行註解與 `/* … */` 區塊註解。
#    **字串字面裡的 `--` 會被誤剝**(例:`'a--b'`)—— 那會讓後面的字消失 ⇒ 可能造成【漏擋】。
#    🔴 ~~今天全 repo 的 migration 零這種寫法~~ **這句是假的(2026-08-24 codex R2 點名, 我複量成立)**:
#      `grep -hE "'[^']*--[^']*'" supabase/migrations/*.sql | grep -v '^\s*--' | wc -l` ⇒ **40 行**
#      (例:`position('-- items 筆數守…')`、regexp pattern);含 dollar-quote 的 migration ⇒ **175 支**
#      (負對照 `$ZZZ$` ⇒ 0 ⇒ 尺是活的)。
#    ⇒ 正確的說法是:**構造已經存在, 只是還沒有一支同時滿足「字串裡有 `--`」+「後面才是真的 CREATE VIEW」**。
#      📏 而那一點是量到的:214 支逐支比對「剝註解前 vs 後抽出來的 view 名集合」⇒ **不同 0 支**。
#    ⚠️ 兩句話差很多:「零這種寫法」讓人以為不會發生;「已有構造、尚未撞到」讓人知道**它會**。
#    要根治得真的 parse SQL;`fn_names_of` 有**同一個**既有缺口(codex 點名)⇒ 兩支要一起改, 不在本片。
# 🔴 **2026-08-24 codex R2 must-fix:第一版的區塊註解剝除器對兩種輸入完全失效。**
#    ~~`sed -e ':a' -e 's;/\*[^*]*\*/;;g' -e 'ta'`~~ ——
#      · `/* a * b */`(內含單獨星號)⇒ `[^*]*` 吃不過那個 `*` ⇒ **剝不掉**
#      · 跨行 `/* a\nb */` ⇒ 那時還沒 flatten ⇒ **剝不掉**
#    ⇒ 現在分兩步, 而**順序是有理由的**:
#      ① 行註解 `--` 必須在【還是多行】的時候剝(flatten 之後就分不出行尾在哪)
#      ② 區塊註解在【flatten 之後】剝(這樣跨行的那些也變成同一行), 且用
#         `[^*]*(\*[^/][^*]*)*` 這個形狀 —— 它容得下內含的單獨星號。
strip_sql_line_comments() { sed -e 's;--.*$;;'; }
strip_sql_block_comments() { sed -E -e ':a' -e 's;/\*[^*]*(\*[^/][^*]*)*\*+/;;g' -e 'ta'; }
view_names_of() { # $1=rev:path
  git show "$1" 2>/dev/null \
    | strip_sql_line_comments \
    | tr '\n' ' ' \
    | strip_sql_block_comments \
    | sed -E 's/[Cc][Rr][Ee][Aa][Tt][Ee]([[:space:]]+[Oo][Rr][[:space:]]+[Rr][Ee][Pp][Ll][Aa][Cc][Ee])?([[:space:]]+[Mm][Aa][Tt][Ee][Rr][Ii][Aa][Ll][Ii][Zz][Ee][Dd])?[[:space:]]+[Vv][Ii][Ee][Ww]([[:space:]]+[Ii][Ff][[:space:]]+[Nn][Oo][Tt][[:space:]]+[Ee][Xx][Ii][Ss][Tt][Ss])?[[:space:]]+/\n@@VW@@/g' \
    | sed -nE 's/^@@VW@@([a-zA-Z0-9_."]+).*/\1/p' \
    | tr -d '"' | sed 's/.*\.//' | sort -u
}

# 🔴 **view 比對時要排除的檔**(2026-08-24;理由是【機制】不是「差很小」):
#    `packages/adapters/src/supabase/database.types.ts` 是 Supabase **自動產生**的型別檔
#    (該檔第一行逐字「生成型別;勿手改」),而它**含每一個 view 名**
#    (實測 `admin_order_list_v` 14 次 / `products_public` 8 次 / `admin_customer_list_v` 10 次)。
#    ⇒ 重 gen 通常與 migration 同一顆 push ⇒ **任何 view migration 都會自己命中它**。
#    🔴 而那是**誤擋**:型別檔只是型別,**執行期不會發任何 PostgREST 請求** ⇒ 它造不出 `PGRST202`。
#    ⚠️ 「今天差很小(17→16)」不是排除它的理由 —— **它是會長大的那種雜訊**,而理由是上面那個機制。
#    ⚠️ **只排除 view 那條路**:函式那條路維持原樣,不因本次放寬被順手放鬆
#       (今天它實際上也不會命中該檔 —— 函式名在那裡是物件鍵、沒有引號、也沒有 `.rpc(`)。
GENERATED_TYPES='packages/adapters/src/supabase/database.types.ts'

EMPTY_TREE="$(git hash-object -t tree /dev/null)"

# ── 3. 逐 ref 判斷 ────────────────────────────────────────────────────
# 🔴 只看**真的會觸發 production 部署的 ref**(關卡2 must-fix #5):
#    storefront=`refs/heads/main`、admin=`refs/heads/dev`。推 tag、推 feature branch、`--all` 帶到的
#    歷史 ref 都不會部署,擋它們只會製造誤擋。
# 🔴 判準用**這次要推的那顆的樹**,不是工作樹(#4);比對的是**新增行**,不是整個檔的現況(#3)——
#    只改同一個檔的無關一行,不該因為檔內早就有那個 RPC 字樣而被擋。
BLOCKED=""
# 🔵 先把 stdin 整個收下來, 迴圈改讀那份 ⇒ 這樣 REF_N=0 時才留得住它。
cat > "$GATE_STDIN"
while read -r local_ref local_sha remote_ref remote_sha; do
  [ -n "${local_sha:-}" ] || continue
  [ "$local_sha" = "$ZERO" ] && continue                       # 刪除 ref
  case "${remote_ref:-}" in refs/heads/dev|refs/heads/main) REF_N=$((REF_N + 1)) ;; *) continue ;; esac
  ledger_sanity "$local_sha" || exit 1

  if ! PENDING="$(pending_versions "$local_sha")"; then exit 1; fi
  PENDING_N=$((PENDING_N + $(printf '%s' "$PENDING" | grep -c . || true)))
  [ "${DOG_DEBUG:-0}" = "1" ] && echo "deploy-order-gate[$remote_ref]: PENDING = $(printf '%s' "$PENDING" | cut -f1 | tr '\n' ' ')" >&2
  [ -n "$PENDING" ] || continue

  FN_LIST="$(printf '%s\n' "$PENDING" | cut -f2 | while read -r f; do
               [ -n "$f" ] && fn_names_of "$local_sha:$f"; done | sort -u)"
  VIEW_LIST="$(printf '%s\n' "$PENDING" | cut -f2 | while read -r f; do
               [ -n "$f" ] && view_names_of "$local_sha:$f"; done | sort -u)"
  [ "${DOG_DEBUG:-0}" = "1" ] && echo "deploy-order-gate[$remote_ref]: 函式名 = $(printf '%s' "$FN_LIST" | tr '\n' ' ')" >&2
  [ "${DOG_DEBUG:-0}" = "1" ] && echo "deploy-order-gate[$remote_ref]: view 名 = $(printf '%s' "$VIEW_LIST" | tr '\n' ' ')" >&2
  # pending 但**函式與 view 都零**(例如純加欄位 / 建表 / 改 RLS)⇒ 仍在 Q2=B 的射程外,本閘不管
  [ -n "$FN_LIST" ] || [ -n "$VIEW_LIST" ] || continue

  if [ "${remote_sha:-$ZERO}" = "$ZERO" ]; then
    BASE="$EMPTY_TREE"                                          # 遠端還沒有這條 ref ⇒ 對空樹比(#6:不能只看 tip 一顆)
  else
    BASE="$remote_sha"
  fi
  # 🔴 git 失敗要 fail-closed(#9):shallow clone / 物件不在時,`2>/dev/null` 會把錯誤吞成空集合
  #    ⇒ 危險的 push 靜默放行。這裡分開看退出碼,拿不到就擋下來要人自己判斷。
  if ! FILES="$(git diff --name-only "$BASE" "$local_sha" -- apps packages 2>/dev/null)"; then
    echo "🔴 部署時序 gate:算不出 $BASE..$local_sha 的 diff(物件不在?shallow clone?)⇒ fail-closed。" >&2
    echo "   確認過安全就用 git push --no-verify。" >&2
    exit 1
  fi
  APP_FILES="$(printf '%s\n' "$FILES" | grep -vE '\.(test|spec)\.[jt]sx?$|/__tests__/' || true)"
  [ -n "$APP_FILES" ] || continue

  # 🔴 100% rename(例如把 `*.test.ts` 改名成正式檔)在 `-U0` 下**沒有 `+` hunk**
  #    ⇒ 新上線的呼叫會漏擋(關卡2 R2 #1)。這些檔改成掃**整檔內容**,不只新增行。
  RENAMED="$(git diff --name-only --diff-filter=R "$BASE" "$local_sha" -- apps packages 2>/dev/null || true)"
  while IFS= read -r af; do
    [ -n "$af" ] || continue
    if ! RAW="$(git diff -U0 "$BASE" "$local_sha" -- "$af" 2>/dev/null)"; then
      echo "🔴 部署時序 gate:算不出 $af 的新增行 ⇒ fail-closed(與外層同一條紀律)。" >&2; exit 1
    fi
    ADDED="$(printf '%s\n' "$RAW" | grep '^+' | grep -v '^+++' || true)"
    if printf '%s\n' "$RENAMED" | grep -qxF "$af"; then
      ADDED="$ADDED
$(git show "$local_sha:$af" 2>/dev/null || true)"      # rename 進來的檔:整檔都算「這次新上線的」
    fi
    [ -n "$ADDED" ] || continue

    # ── 呼叫上下文(2026-08-21 A-bc;審查線 -04 量出兩個方向都壞)──────────────
    # 🔴 舊判準 = 「新增行裡出現函式名的完整識別字」⇒ **不管那一行是不是在呼叫**。實量:
    #      誤擋  817 個提及裡只有 30 個真的是呼叫 ⇒ **每 27 次命中只對 1 次**
    #      漏擋  7/35 的既有呼叫是識別字風格(`.rpc(SOME_FN, …)`)⇒ **20% 對這道閘隱形**
    #    後者是真的洞:常數若定義在【這次不需要改的檔】,新增行就只剩呼叫那一行 ⇒ 完全放行
    #    ⇒ 正式站呼叫資料庫裡還不存在的函式 ⇒ PGRST202(2026-08-07 壞約 8 小時)。
    #
    # 🔴 **窗口為什麼是「`.rpc(` 那行 + 後兩行」而不是「只看含 `.rpc(` 的行」**:
    #    主視窗原本裁「只看含 rpc( 的行」,而 `-04` 擋下了 —— 本 repo 實測有 **6 處跨行呼叫**
    #    (`grep -cE '\.rpc\($'` ⇒ 6),只看單行會讓它們變隱形 ⇒ **把錯誤從安全那邊搬到危險那邊**。
    #
    # ⚠️ **本段的限度(寫出來,不假裝覆蓋)**:
    #      · 樣板字串 / 字串拼接 / 動態 key 的呼叫,抓不到(文字比對的天花板)
    #      · 窗口只開到後兩行 —— 函式名在第三行以後的呼叫抓不到
    #      · `supabase/functions/**` 不在分母裡(本閘只掃 `apps/**` 與 `packages/**`)
    #      · 剝的是**註解行**;函式名寫在**字串字面**裡而不是呼叫的話,靠的是「那行沒有 `.rpc(`」

    # 1. 剝 `+` 前綴 → 丟掉純註解行(`//` / `*` / `/*` 開頭)
    CODE="$(printf '%s\n' "$ADDED" | sed 's/^+//' | grep -vE '^[[:space:]]*(//|\*|/\*)' || true)"
    # 2. 行尾以 `.rpc(` 結束的,把下一行接上來(跨行呼叫壓成一行)
    CODE="$(printf '%s\n' "$CODE" | sed -e ':a' -e '/\.rpc([[:space:]]*$/{N;s/\n[[:space:]]*/ /;ta' -e '}')"
    # 3. 呼叫窗口 = 含 `.rpc(` 的行 + 其後兩行
    CALLS="$(printf '%s\n' "$CODE" | grep -A2 -E '\.rpc\(' || true)"

    # 4. 識別字風格的第一參數(`.rpc(SOME_FN, …`)⇒ 回頭解析它的字面值
    #    🔴 解析對象是**要推的那顆 sha**,不是工作樹 —— 常數可能就在這次的 commit 裡。
    IDENT_FNS=""
    UNRESOLVED=""
    IDENTS="$(printf '%s\n' "$CALLS" | grep -oE '\.rpc\([[:space:]]*[A-Za-z_][A-Za-z0-9_]*' \
              | sed 's/.*\.rpc([[:space:]]*//' | sort -u || true)"
    while IFS= read -r id; do
      [ -n "$id" ] || continue
      # 🔴 **不能用 `\b`** —— git grep 的 `-E` 不吃它,而且是**靜默不匹配**(實測:帶 \b ⇒ 零行,
      #    不帶 ⇒ 命中)。用本檔他處同一套的字元類邊界。`-o` 會把前綴字元一起印出來,
      #    下一行的 sed 取兩個單引號之間的內容,不受影響。
      VALS="$(git grep -hoE "(^|[^A-Za-z0-9_])$id[[:space:]]*=[[:space:]]*'[^']*'" "$local_sha" -- apps packages 2>/dev/null \
              | sed "s/.*'\(.*\)'/\1/" | sort -u || true)"
      if [ -n "$VALS" ]; then
        IDENT_FNS="$IDENT_FNS
$VALS"
      else
        # 🔴 **解析不到 ⇒ 擋,不是放行。**
        #    誤擋成本 = 一次 push 重來;漏擋成本 = 正式站壞 8 小時。往安全那邊倒。
        UNRESOLVED="$UNRESOLVED $id"
      fi
    done <<< "$IDENTS"

    if [ -n "$UNRESOLVED" ]; then
      BLOCKED="$BLOCKED\n  · 🔴 `.rpc()` 的函式名是識別字而我認不出它:$UNRESOLVED(在 $af)  [ref $remote_ref]\n    └ 這次有未 apply 的 migration,而我無法確定這支呼叫指到哪裡 ⇒ fail-closed。"
    fi

    while IFS= read -r fn; do
      [ -n "$fn" ] || continue
      HIT=""
      # 4a. 函式名逐字出現在呼叫窗口裡
      printf '%s\n' "$CALLS" | grep -qE "(^|[^A-Za-z0-9_])$fn([^A-Za-z0-9_]|\$)" && HIT="呼叫窗口"
      # 4b. 或者:一個**整串等於函式名**的字串字面(`'fn'` / `"fn"`)。
      #     🔴 **這一條是我加的,超出主視窗原本的裁法,理由是量出來的**:
      #     只看 `.rpc(` 窗口會讓 `export const CALL = 'pcm_a9h_probe';` 這種**常數表**變隱形,
      #     而那正是識別字風格呼叫的【定義那一半】—— 擋掉呼叫卻放行定義,等於只擋了一半。
      #     既有 harness 的 ⑲ / ㉒ / M2 / M3 / M5 五格用的都是這個形狀,我第一版把它們全打紅了。
      #     🔴 **它與「誤擋面」分得開,而判準是量出來的不是感覺**:
      #       `export const call = 'pcm_a9h_probe';`      整串 == 函式名  ⇒ 擋
      #       `msg: '請洽管理員 pcm_a9h_probe'`            函式名嵌在句子裡 ⇒ 放行
      #       差別就是**函式名前後緊鄰的是不是引號**,不是「看起來像不像呼叫」。
      [ -z "$HIT" ] && printf '%s\n' "$CODE" | grep -qE "['\"]$fn['\"]" && HIT="整串字面"
      # 4b. 或者:呼叫用的識別字解析出來就是它
      [ -z "$HIT" ] && printf '%s\n' "$IDENT_FNS" | grep -qxF "$fn" && HIT="識別字解析"
      [ -n "$HIT" ] \
        && BLOCKED="$BLOCKED\n  · 函式 [$fn](在未 apply 的 migration 裡)出現在新增的 .rpc() 呼叫:$af($HIT)  [ref $remote_ref]\n    └ 那支 migration:$(printf '%s\n' "$PENDING" | cut -f2 | tr '\n' ' ')"
    done <<< "$FN_LIST"

    # ── view 那條路(2026-08-24 放寬)────────────────────
    # 🔴 **view 走 `.from(` 不走 `.rpc(`** —— 兩邊的比對窗口不同,不能共用上面那個。
    #    窗口規則刻意與 `.rpc(` 那邊一致(含跨行接續與後兩行),理由同上:同一個坑只踩一次。
    # ⚠️ 產生型別檔整支跳過(見 `GENERATED_TYPES` 的理由;**只跳 view 這條路**)。
    if [ -n "$VIEW_LIST" ] && [ "$af" != "$GENERATED_TYPES" ]; then
      FROMS="$(printf '%s\n' "$CODE" | sed -e ':a' -e '/\.from([[:space:]]*$/{N;s/\n[[:space:]]*/ /;ta' -e '}' \
               | grep -A2 -E '\.from\(' || true)"
      while IFS= read -r vw; do
        [ -n "$vw" ] || continue
        VHIT=""
        printf '%s\n' "$FROMS" | grep -qE "(^|[^A-Za-z0-9_])$vw([^A-Za-z0-9_]|\$)" && VHIT="from 窗口"
        # 與函式那邊同一條:**整串**等於 view 名的字串字面(常數表那一半),句子裡嵌著的不算。
        # 🔴🔴 **2026-08-24 線3:誤擋 ⑤ 的修法【已撤回】—— 而撤回的理由要留著。**
        #    ⑤ 是真的:app 只新增 `const LABEL = "pcm_probe_v"`(整支檔零 `.from(`)⇒ 本行擋下 ⇒ 誤擋。
        #    我的修法是「同一支檔裡真的有 `.from(` 才算命中」。**它製造了一個更貴的漏擋:**
        #    📏 實測(拋棄式 repo,兩個方向):
        #      `table.ts` 把 `const TABLE='old_v'` 改成 `'new_v'`,而 `.from(TABLE)` 在**未改動的**
        #      `reader.ts` 裡 ⇒ 這次部署**真的**依賴一支 pending view
        #        修【前】⇒ 🔴 擋(訊息點名 `view [new_v] … table.ts(整串字面)`)
        #        修【後】⇒ 🟢 **放行** ← 漏的正是這道閘存在的理由(PGRST202 / 42P01)
        #    ⇒ **誤擋 > 漏擋 這條原則在這裡不適用** —— 因為換來的漏擋落在**核心失敗情境**上,
        #      而不是落在別的地方。⇒ 撤回,`⑤` 維持為**已知誤擋**,處置交回主視窗。
        #    ⚠️ 下一個想修它的人:便宜的條件都會撞到「常數住在沒改動的檔裡」這個形狀。
        #       先構造上面那一發, 再決定。
        [ -z "$VHIT" ] && printf '%s\n' "$CODE" | grep -qE "['\"]$vw['\"]" && VHIT="整串字面"
        [ -n "$VHIT" ] \
          && BLOCKED="$BLOCKED\n  · view [$vw](在未 apply 的 migration 裡)出現在新增的 .from() 讀取:$af($VHIT)  [ref $remote_ref]\n    └ 那支 migration:$(printf '%s\n' "$PENDING" | cut -f2 | tr '\n' ' ')"
      done <<< "$VIEW_LIST"
    fi
  done <<< "$APP_FILES"
done < "$GATE_STDIN"

[ -z "$BLOCKED" ] && { summary 0; exit 0; }

{
  echo ""
  echo "🔴 部署時序 gate:**這次要推的應用層新增程式碼,用到了還沒 apply 的 migration 建的函式或 view**。"
  echo "   推上去 = 正式站去問一個資料庫裡還不存在的東西 ⇒ PGRST202(2026-08-07 A9h:壞約 8 小時)。"
  printf '%b\n' "$BLOCKED"
  echo ""
  echo "   兩條出路(擇一):"
  echo "     ① 先 apply,再把該版本連同 sha256 追加進 supabase/APPLIED.tsv 並 commit,然後重推。"
  echo "     ② 應用層那半先不要推(或整段掛預設 off 的 flag)。"
  echo "   真的要現在推:git push --no-verify,並在 commit body 寫明為什麼 ——"
  echo "   本閘刻意不提供「打一行宣告就過」的欄位(那種例外兩次被對抗審查證明是儀式,見 plan §3)。"
  echo ""
} >&2
# 🔴 摘要行放在【擋下訊息之後】—— 它是最後一行,而 Sean 的終端機是往下捲的。
summary "$(printf '%b' "$BLOCKED" | grep -cE '· (函式|view) ' || true)"
exit 1
