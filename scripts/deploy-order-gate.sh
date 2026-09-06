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
#      ⛔ ~~**放寬的是 view,不是 table / column / index** —— 後三者維持 Q2=B 的不比~~
#      🔴 **2026-09-06 起 column 也納入了**(Sean `Q-閘看欄=甲`, 見下方欄位那一段);
#         **table / index 仍然不比**, 理由沒變(撞常見字)。舊字面留刪除線。
#      放寬的證據(2026-08-24 全量乾跑,量測時點寫在數字旁邊):
#        分母 `supabase/migrations/*.sql` = 209 支  ← ⚠️ **量測時點的值, 2026-08-24 夜已是 214**
#        (🔴 分母不要引用這一行, 當場跑 `ls supabase/migrations/*.sql | wc -l`。
#          留著 209 是因為底下那幾個數字是**在 209 那個分母上量的**, 換掉會讓它們失去出處。)
#          有 CREATE FUNCTION(放寬前看得到)  = 123
#          **只有 VIEW 沒有 FUNCTION ⇒ 放寬前【完全看不到】= 13**
#          兩者皆無(加欄 / 建表 / RLS…)= 73  ← ⛔ ~~仍然不管~~ 🔴 **其中「加欄」2026-09-06 起會管**
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
#   3. 若這次要推的範圍內,`apps/**` 或 `packages/**` 的非測試檔 diff **出現那些名字的完整識別字** ⇒ 擋
#      (函式 ⇒ `.rpc(` 窗口 / 整串字面 / 識別字解析;view ⇒ `.from(` 窗口 / 整串字面;
#       新欄 ⇒ **這一發動過的 app 檔裡, 表名與欄名同檔共現**
#            —— ⛔ ~~「且至少一個出現在新增行裡」~~ 那一半 R3 拿掉了, 理由見下方比對段 `R3 A1`)
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
#   · ⛔ ~~**只比 RPC 函式名**(Sean Q2=B):純加欄位 / 建表 / 改 RLS 的 migration **零覆蓋** —— 刻意的。~~
#     🔴 **2026-09-06 起這句只剩一半成立**(Sean 答 `Q-閘看欄=甲`):**加欄位已經納入**;
#     而**純建表 / 改 RLS 仍然零覆蓋**。⛔ 舊字面留著, 讓引用「零覆蓋」的人同一發撞到這裡。
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
# 🔴 檔頭標記的 parser 收攏在一支(⟦0e-DDLINTOVC-MARK⟧;Fable R3 F4 實錘:四份手寫 parser
#    有兩種文法, 同一個檔頭兩把尺說是、兩把尺說不是, 而畫面上沒有東西說兩邊不同)。
#    🛑 讀不到它 ⇒ **擋下**, 不要靜默退回本地判斷 —— 那會把「沒有 parser」變成「沒有標記」。
_MARKLIB="$(cd "$(dirname "$0")" && pwd)/lib-migration-header-marks.sh"
if [ -f "$_MARKLIB" ]; then . "$_MARKLIB"; else
  printf '🔴 找不到 %s ⇒ 檔頭標記無法判讀, 擋下(不放行)\n' "$_MARKLIB" >&2; exit 2
fi

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
    echo "   rev=$rev  path=supabase/migrations/" >&2
    echo "   ⇒ 停下來:這是【物件讀不到】不是【檢查過而乾淨】—— 先修 repo" >&2
    echo "     (shallow clone 請 git fetch --unshallow / 完整 fetch;物件損壞跑 git fsck), 再重推。" >&2
    echo "   真的要繞:先自己確認那幾支 migration 都已 apply, 再 git push --no-verify 並在 commit body 寫明。" >&2
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

# ── 2. 從 pending migration 抽 RPC 函式名 ⛔ ~~(Q2=B:只抽這個)~~ ────────────
#    🔴 **現在抽三種**:函式名(本段)· view 名(下一段, 2026-08-24)· 新欄 (表,欄)(再下一段, 2026-09-06)。
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

# ══ 🔴 第三次拍板:2026-09-06 Sean 答 `Q-閘看欄 = 甲` ⇒ **欄位納進來** ═══════
#   ⚠️ **上面那兩段刪除線【留著】** —— 它們記著 Q2=B 當初「column 不比」的理由(撞常見字),
#     而 2026-08-24 放寬 view 時還特地寫過「**放寬的是 view, 不是 column**」。
#   ⇒ 📌 **這是【知情的】推翻, 不是有人忘了那兩段**:Sean 答甲時題目逐字寫著
#     「只認得表跟函式, 認不出欄位」(起因 = `mail C5`:表加一欄沒貼就推 ⇒ 信寄了、DB 記 failed、**沒有東西叫**)。
#
# 🔴🔴 **而當初那個理由是【對的】—— 我量了才敢動。**
# 📏 **量測時點 2026-09-06 · 樹 `~/pcm-wt-auth` · 分母當場跑出來的(不是抄的)**:
#   · migrations `.sql` **346 支** · 候選 app 檔 **1,277 支**
#     (候選 = `git ls-files apps packages` 減去 `*.test.*` / `*.spec.*` / `__tests__/` / 產生型別檔
#      —— 逐字就是本閘 `APP_FILES` 與 `GENERATED_TYPES` 那兩道)
#   · 全史 `ALTER TABLE … ADD COLUMN` ⇒ **94 組 (表,欄) 配對 · 87 個去重欄名**
#   · 🛑 **尺一(只比欄名)** —— 🔴 **它有【兩種數法, 兩個數】, 引用前先看你在問哪一個**:
#       逐 **(表,欄) 組**(94 組, 同名欄跨表數兩次)⇒ **1,116 檔次**  ← 與尺二同分母, 比例要用這個
#       逐 **去重欄名**(87 個)             ⇒ **997 檔次**
#     單欄 top:`email` 153 · `kind` 143 · `actor` 89 · `request_id` 54 · `version` 33
#     ⇒ **13/94 組的欄名命中 ≥20 支檔** ⇒ **那把尺不能用。**
#   · ✅ **尺二(欄名 AND 表名出現在【同一支檔】)⇒ 405 檔次(逐組)** ⇒ 1,116 ⇒ 405 = **36.3%**
#     單組 top:`orders.cancelled_at` 27 · `products.price_store` 19 · `products.price_general` 17
#   · 🔬 **量具的鄰居(照鐵律, 一個數字不單獨出門)**:
#       正對照 `email` = **153**(非 0 ⇒ 尺接上了);第二把尺 `/usr/bin/grep -rilE` 同一形狀
#         在同一批候選檔上 **也是 153** ⇒ 兩把尺同意
#       負對照 現造的 `pcm_zzq_neverwritten_col_0906` = **0**
#   ⇒ 🔵 **採尺二, 而它仍然不乾淨** —— 代價寫在這裡, 不藏。
#
# 🔴 **⛔ ~~更早的兩組字面都【不能引用】~~**:
#    ~~① 64 組 / 59 欄 / 尺一 3254 / 尺二 731 / 22% / `x` 1717 支檔~~
#      🔬 上一版抽取器的輸出, 而那一版對 `ADD COLUMN a, ADD COLUMN b` **只抽第一欄**
#      ⇒ 📌 母體本身就漏了約 30 組 ⇒ 那些比例是【偏斜樣本】。
#    ~~② 尺一 2221 / 尺二 806 / `email` 294 / `kind` 271 / `actor` 259 / 28 組~~
#      🔬 **codex R2 抓到:那一組【不是實作那把尺】** —— 它沒有排除 test/spec/`__tests__`/產生型別檔,
#        也沒有用本閘的字元類邊界 ⇒ 分母與比對形狀都不是閘在跑的那一套。
#    ⇒ 🎯 **同一個結論被三組數字支持過, 而前兩組都是壞尺量的** ——
#      壞掉的量具會**同時**給出「結論」與「支持那個結論的數字」, 而結論恰好還是對的,
#      那讓它更難被發現。**舊字面留刪除線, 讓引用 22% / 36%(806/2221)的人同一發撞到這裡。**
#
# ⚠️⚠️ **射程(它答不出的兩件事)**:
#   ① **同檔含兩個字串 ≠ 那支檔用了那個欄** ⇒ 會誤擋(上面那些數字就是它的量級)。
#   ② **用了那個欄而兩個字串【不在同一支檔】**(mapper 分層 / 常數住別處)⇒ **漏擋** ——
#      📌 而那正是 view 那條路 2026-08-24 撤回過的同一個形狀, 見下面 `⑤` 那段。
col_pairs_of() { # $1=rev:path  $2="strict"(可省)⇒ 一行一組 "表<TAB>欄"
  # 🔴 **R2 MF4:parser 或 git show 掛掉不得靜默變空。**
  #    ⛔ ~~舊版整條 pipeline 沒有任何人看 rc~~ ⇒ 📌 `python3` 自己 crash ⇒ `COL_RAW` 變空
  #      ⇒ **欄位那一族整族靜音, 而閘照樣 exit 0** —— 「零新欄」與「抽取器死了」同形。
  #    ⇒ ✅ 失敗時吐一行哨兵 `@@COLPARSE_FAIL@@`, 呼叫端 grep 到就 fail-closed。
  #    📌 **為什麼用哨兵不是 return code**:抽取跑在 `$( … | while … )` 的子殼裡, rc 回不到外面。
  # 🔴 **R2 MF3:`strict` 模式(只給【豁免來源】用)另外剝掉字串字面與 dollar body。**
  #    ⛔ ~~舊版對 pending 側與豁免側用同一把尺~~ ⇒ 📌 一段**沒被執行**的
  #      `'ALTER TABLE things ADD COLUMN x'` 寫在已 apply 的檔裡 ⇒ 它進 `APPLIED_COLS`
  #      ⇒ **把後來真正 pending 的 `things.x` 豁免掉。**
  #    ⇒ ✅ 兩邊【刻意不對稱, 而兩邊都倒向擋】:
  #        pending 側(不 strict)= 寧可多抽 ⇒ 誤擋
  #        豁免側(strict)      = 寧可少抽 ⇒ 少豁免 ⇒ 還是擋
  #    ⚠️ **代價寫出來**:`DO $$ … ALTER TABLE t ADD COLUMN c … $$` 這種真的會加欄的 dollar body,
  #      在 strict 側被剝掉 ⇒ 它**不會**成為豁免來源 ⇒ 那一欄之後每次都擋。往安全那邊倒。
  local sql rc out
  sql="$(git show "$1" 2>/dev/null)"; rc=$?
  if [ "$rc" -ne 0 ]; then printf '%s\n' "@@COLPARSE_FAIL@@ git-show $1"; return 1; fi
  out="$(printf '%s\n' "$sql" \
    | strip_sql_line_comments \
    | tr '\n' ' ' \
    | strip_sql_block_comments \
    | PCM_COL_STRICT="${2:-}" python3 -c '
import sys,os,re
t=sys.stdin.read()
Q=chr(39)
STRICT=os.environ.get("PCM_COL_STRICT")=="strict"
if STRICT:
    t=re.sub(r"\$([A-Za-z0-9_]*)\$.*?\$\1\$", " ", t, flags=re.S)          # dollar body
    # R3-A2: E-string(E 開頭的字串字面)的反斜線跳脫會讓天真的剝除【提早收尾】。
    #   舊版只有一條「一般字串」規則 ⇒ 餵 E 開頭且內含反斜線加引號的字面時, 它在那個跳脫處
    #   就收掉 ⇒ 後面那段【假 DDL】反而被暴露出來 ⇒ strict 模式【多抽】一組
    #   ⇒ 真正 pending 的同名欄被豁免 —— 與這一格想擋的事情剛好相反。
    #   修法: E-string 先剝(它認反斜線跳脫), 再剝一般字串。
    # R4-F1: 那個 [eE] 少了【左邊界】 ⇒ 任何以 e 結尾的字串內容(例 manual_phone / none)
    #   後面若還有字串, 這條 regex 會從那個 e 起跳過真正的收尾引號 ⇒ 一口吞掉中間的【真 DDL】。
    #   實測 supabase/migrations/20260712203000_m4a_orders_admin_columns.sql:
    #     strict 抽到 3 組 / 不剝 E-string 抽到 6 組 ⇒ 少的是 orders.cancelled_at / cancelled_reason / version
    #   ⇒ 那三組永遠拿不到豁免 ⇒ 冪等重貼會被擋(cancelled_at 全樹共現 27 支檔)。
    t=re.sub("(?<![A-Za-z0-9_$])[eE]"+Q+"(?:[^"+Q+chr(92)*2+"]|"+chr(92)*2+"."+"|"+Q+Q+")*"+Q, " ", t, flags=re.S)
    t=re.sub(Q+"(?:[^"+Q+"]|"+Q+Q+")*"+Q, " ", t, flags=re.S)
    # 剝不乾淨就整支不當豁免來源: 還留著引號 = 我沒把它 lex 對,
    # 而「我沒把握」在豁免側只有一個安全答案 —— 不豁免。
    if t.count(Q) > 0:
        print("")
        sys.exit(0)
def norm(raw):
    # 🔴 nit:`"CamelCase"` 與 camelcase 在 PostgreSQL 是【兩個不同的欄】——
    #    有雙引號 ⇒ 原樣保留;沒有 ⇒ 折小寫(PG 自己就是這樣 fold 的)。
    return raw[1:-1] if raw.startswith(chr(34)) else raw.lower()
out=[]
# 🔴 **R2 MF2:PostgreSQL 的順序是 `ALTER TABLE [IF EXISTS] [ONLY] name`。**
#    ⛔ ~~舊版寫成 `(?:ONLY\s+)?(?:IF\s+EXISTS\s+)?`~~ ⇒ 📌 餵 `ALTER TABLE IF EXISTS ONLY things …`
#      抽到的表名是 **only** ⇒ 那一組永遠對不上任何 app 檔 ⇒ 靜默漏擋。兩個順序都吃。
for m in re.finditer(r"ALTER\s+TABLE\s+(?:(?:IF\s+EXISTS|ONLY)\s+){0,2}(?:(\"[^\"]+\"|[A-Za-z0-9_]+)\s*\.\s*)?(\"[^\"]+\"|[A-Za-z0-9_]+)(.*?);", t, re.I|re.S):
    tbl=norm(m.group(2)); body=m.group(3)
    for c in re.finditer(r"ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?(\"[^\"]+\"|[A-Za-z0-9_]+)", body, re.I):
        out.append(tbl+chr(9)+norm(c.group(1)))
print("\n".join(sorted(set(out))))
')"; rc=$?
  if [ "$rc" -ne 0 ]; then printf '%s\n' "@@COLPARSE_FAIL@@ parser $1"; return 1; fi
  printf '%s\n' "$out" | sed '/^$/d'
}

# 🔵 **具名豁免**(像 `KNOWN` 那樣, 每一行要寫理由;空的時候本閘一格都不豁免)
#    格式:`表<TAB>欄`。⚠️ 加一行 = 放掉一格守備 ⇒ 理由寫在旁邊, 不要只加名字。
KNOWN_COL_SKIP=""

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
VC_LIST=""
# 🔵 先把 stdin 整個收下來, 迴圈改讀那份 ⇒ 這樣 REF_N=0 時才留得住它。
cat > "$GATE_STDIN"
while read -r local_ref local_sha remote_ref remote_sha; do
  [ -n "${local_sha:-}" ] || continue
  [ "$local_sha" = "$ZERO" ] && continue                       # 刪除 ref
  case "${remote_ref:-}" in refs/heads/dev|refs/heads/main) REF_N=$((REF_N + 1)) ;; *) continue ;; esac
  ledger_sanity "$local_sha" || exit 1

  if ! PENDING="$(pending_versions "$local_sha")"; then exit 1; fi
  PENDING_N=$((PENDING_N + $(printf '%s' "$PENDING" | grep -c . || true)))
  # 🟠 補版控型的 pending 收在這裡, 而【一定要在這裡】——
  #    本檔的規矩是「一律讀 local_sha 那棵樹, 不讀工作樹」(推別的 branch / worktree / rebase 中途,
  #    工作樹那份可能不是要推的那份)。⇒ 檔頭也要從那棵樹讀, 不可以 head -20 工作樹的檔。
  for _pv in $(printf '%s\n' "$PENDING" | cut -f2); do
    [ -n "$_pv" ] || continue
    # 🔴 `cut -f2` 拿到的是 `git ls-tree --name-only` 給的**完整路徑**(`supabase/migrations/….sql`),
    #    不是檔名 ⇒ 再前綴一次目錄會撈空, 而 `git show` 撈空是**靜默的** ⇒ 那段提示等於不存在。
    #    📌 抓到它的是 verify 的 ㊼/㊽ 兩格 —— 而 ㊻(仍然擋)是綠的 ⇒ 只看 rc 會以為做完了。
    _ph=$(head20_of_rev "$local_sha" "$_pv")
    if mark_present "$_ph" ddl-into-vc; then
      # 🔴 抽值與白名單過濾都在 `lib-migration-header-marks.sh`(唯一 parser)——
      #    它剝掉白名單外的每一個字元。**這裡不再自己寫一份**:codex R1 說反斜線(`\c` 會讓
      #    下面的 `printf %b` 停止輸出而 rc=0)、R2 說 ESC/CR(重畫終端蓋掉安全提示),
      #    而 Fable R3 說**四份 parser 兩種文法** —— 三輪都在同一個地方, 那是形狀不是紀律。
      _po=$(mark_value_or_warn "$_ph" ddl-into-vc "$_pv")
      if [ -n "$_po" ]; then
        # 🔴 **codex R1 MF3**:`VC_LIST` 跨 ref 累積而項目不帶 ref ⇒ 推 dev 與 main 兩個 ref 時,
        #    main 的補版控項會串進「只有 dev 被擋」的那段訊息, 而同一支也會被列兩次。
        #    ⇒ 每一項帶上它自己的 ref(照 BLOCKED 既有的 `[ref …]` 形狀)。
        VC_LIST="$VC_LIST\n     · ${_pv##*/}  ⇒ 標記說物件是 [$_po]  [ref $remote_ref]"
      fi
    fi
  done
  [ "${DOG_DEBUG:-0}" = "1" ] && echo "deploy-order-gate[$remote_ref]: PENDING = $(printf '%s' "$PENDING" | cut -f1 | tr '\n' ' ')" >&2
  [ -n "$PENDING" ] || continue

  FN_LIST="$(printf '%s\n' "$PENDING" | cut -f2 | while read -r f; do
               [ -n "$f" ] && fn_names_of "$local_sha:$f"; done | sort -u)"
  VIEW_LIST="$(printf '%s\n' "$PENDING" | cut -f2 | while read -r f; do
               [ -n "$f" ] && view_names_of "$local_sha:$f"; done | sort -u)"
  [ "${DOG_DEBUG:-0}" = "1" ] && echo "deploy-order-gate[$remote_ref]: 函式名 = $(printf '%s' "$FN_LIST" | tr '\n' ' ')" >&2
  # ── 欄位那一族(2026-09-06 Sean `Q-閘看欄=甲`)──────────────────────────
  COL_RAW="$(printf '%s\n' "$PENDING" | cut -f2 | while read -r f; do
               [ -n "$f" ] && col_pairs_of "$local_sha:$f"; done | sort -u)"
  # 🔴 **R2 MF4:抽取器死掉不得靜默變空** —— 哨兵在 ⇒ fail-closed。
  # 🔴 **R3 B1:訊息要讓災難當天的人做【對】的事** —— ⛔ ~~舊版只印哨兵那一行 + 「用 --no-verify」~~
  #    ⇒ 📌 fail-closed 最容易被讀成「工具故障」⇒ 他就繞過去了, 而那正好把這道閘要擋的事故打開。
  #    ⇒ ✅ 印出 ref / sha / 是哪一階段失敗 / 該做什麼;`--no-verify` 降到最後一行並附前提。
  case "$COL_RAW" in *@@COLPARSE_FAIL@@*)
    echo "🔴 部署時序 gate:pending 側的欄位抽取器失敗 ⇒ fail-closed(這不是「零新欄」)。" >&2
    echo "   local_ref=$local_ref → remote_ref=$remote_ref   local_sha=$local_sha" >&2
    echo "   失敗的項目(哨兵原文):" >&2
    printf '%s\n' "$COL_RAW" | grep '@@COLPARSE_FAIL@@' | sed 's/^/     /' >&2
    echo "     └ 哨兵尾字是 git-show ⇒ git 物件讀不到(shallow clone?物件損壞?)" >&2
    echo "     └ 哨兵尾字是 parser  ⇒ python3 掛了(command -v python3 先看一眼)" >&2
    echo "   ⇒ 停下來:先把上面那一項修好再重推。**不要**先用 --no-verify —— " >&2
    echo "     它會連【真的有 pending 新欄】那一半一起跳過, 而那一半沒有人在看。" >&2
    echo "     真的要繞:先自己確認那幾支 migration 都已 apply, 再 git push --no-verify 並在 commit body 寫明。" >&2
    exit 1 ;;
  esac
  # 🔴 **豁免一:那一欄在【已 apply 的】migration 裡就出現過 ⇒ 不是這次新加的**
  #    📌 `ADD COLUMN IF NOT EXISTS` 常被重貼;少了這一格, 一支冪等的重貼會擋住整條線。
  #    ⚠️ 它比的是**歷史上有沒有加過同一組 (表,欄)**, 不是「線上有沒有那一欄」——
  #      後者要連線, 而本閘是**零對外**的靜態閘。**這兩件事不一樣, 寫出來。**
  COL_LIST=""
  if [ -n "$COL_RAW" ]; then
    # 🔴🔴 **豁免只能引用【sha 相符】的那幾支**(codex R1 must-fix)——
    #    ⛔ ~~舊版只比版本號, 而欄位是從【當前 sha】的那支檔抽的~~
    #    ⇒ 📌 **一支已 apply 的檔被改過、加了新欄 ⇒ 它先被判 pending, 然後用【同一份新內容】把自己豁免掉。**
    #    🔬 **而那不是假想**:`20260801120000` 就是那一支 —— 它的 ledger sha 不符,
    #      而當前內容加了 `order_refunds.rec_trade_id`。
    #    ⇒ ✅ 只有「版本在帳上 **且** blob sha 與帳上相符」的那幾支, 才拿來當豁免來源。
    # ⏱️ **nit(成本寫出來, 不藏)**:這一圈對帳本上【每一列】各跑一次 `git show` + python。
    #    📏 **我量到的是【整發閘】不是【這一圈】**(2026-09-06 · `~/pcm-wt-auth` ·
    #      `HEAD 1c3c747c3` vs `origin/dev 1ee5cf064`;帳本有效列 **336** · PENDING **20** ·
    #      差異檔 **32**)⇒ **46 秒**。
    #      ⚠️ **codex R2 那句「逐筆重跑約 18 秒」我沒有復現到那個數** —— 它量的是哪一段未確認,
    #        而我沒有把這一圈單獨掐錶(要掐得插樁, 那會動到受審的碼)。**兩個數都留著, 標明各自的射程。**
    #    ⚠️ 它**只在 `COL_RAW` 非空時才跑**(= 這一發真的有 pending 的新欄),
    #      而 `pre-push` 本來就會重跑一整套三綠 ⇒ 這幾十秒在那個分母裡是雜訊。
    #    📌 **不預先最佳化**:要快就得快取, 而快取的失效條件會變成下一個「安靜地用舊值」的坑。
    APPLIED_COLS="$(git show "$local_sha:supabase/APPLIED.tsv" 2>/dev/null \
      | grep -E '^[0-9]{14}\t[0-9a-f]{64}\t' \
      | while IFS=$'\t' read -r v led_sha _rest; do
          # 🔴 **nit:版本號後面要接 `_` 且副檔名是 `.sql`** —— ⛔ ~~舊版裸 `grep "^…/$v"`~~
          #    ⇒ 📌 同一個版本號旁邊的 `20260820030000_ERRATUM.md` 會**排在前面先被 head -1 取到**
          #      ⇒ 拿一支 `.md` 去算 sha ⇒ 永遠對不上帳 ⇒ 那一支靜默失去豁免資格。
          af="$(git ls-tree --name-only "$local_sha" supabase/migrations/ | grep -E "^supabase/migrations/${v}_.*\.sql$" | head -1)"
          [ -n "$af" ] || continue
          cur_sha="$(git show "$local_sha:$af" 2>/dev/null | shasum -a 256 | cut -d' ' -f1)"
          [ "$cur_sha" = "$led_sha" ] || continue      # sha 不符 ⇒ 它自己就是 pending, 不能當豁免來源
          col_pairs_of "$local_sha:$af" strict
        done | sort -u)"
    # 🔴 **R2 MF4(豁免側同一條)**:豁免來源抽壞了 ⇒ 少豁免只是誤擋, 而**抽取器死掉**是另一件事
    #    ⇒ 一樣 fail-closed, 不讓「零豁免」與「抽取器死了」同形。
    case "$APPLIED_COLS" in *@@COLPARSE_FAIL@@*)
      echo "🔴 部署時序 gate:豁免來源(已 apply 的 migration)的欄位抽取器失敗 ⇒ fail-closed。" >&2
      echo "   local_ref=$local_ref → remote_ref=$remote_ref   local_sha=$local_sha" >&2
      echo "   失敗的項目(哨兵原文):" >&2
      printf '%s\n' "$APPLIED_COLS" | grep '@@COLPARSE_FAIL@@' | sed 's/^/     /' >&2
      echo "   ⇒ 停下來:抽不出豁免來源 ≠ 沒有豁免 —— 兩者在結果上同形, 所以這裡不猜。" >&2
      echo "     修好 python3 / git 物件再重推;不要先用 --no-verify。" >&2
      exit 1 ;;
    esac
    while IFS= read -r pair; do
      [ -n "$pair" ] || continue
      printf '%s\n' "$APPLIED_COLS" | grep -qxF "$pair" && continue          # 豁免一
      printf '%s\n' "$KNOWN_COL_SKIP" | grep -qxF "$pair" && continue        # 豁免二(具名)
      COL_LIST="$COL_LIST$pair
"
    done <<< "$COL_RAW"
  fi
  COL_LIST="$(printf '%s' "$COL_LIST" | sed '/^$/d')"
  [ "${DOG_DEBUG:-0}" = "1" ] && echo "deploy-order-gate[$remote_ref]: view 名 = $(printf '%s' "$VIEW_LIST" | tr '\n' ' ')" >&2
  [ "${DOG_DEBUG:-0}" = "1" ] && echo "deploy-order-gate[$remote_ref]: 新欄 = $(printf '%s' "$COL_LIST" | tr '\n' ' ')" >&2
  # pending 但**函式 / view / 新欄都零**(例如純建表 / 改 RLS)⇒ 本閘不管
  [ -n "$FN_LIST" ] || [ -n "$VIEW_LIST" ] || [ -n "$COL_LIST" ] || continue

  if [ "${remote_sha:-$ZERO}" = "$ZERO" ]; then
    BASE="$EMPTY_TREE"                                          # 遠端還沒有這條 ref ⇒ 對空樹比(#6:不能只看 tip 一顆)
  else
    BASE="$remote_sha"
  fi
  # 🔴 git 失敗要 fail-closed(#9):shallow clone / 物件不在時,`2>/dev/null` 會把錯誤吞成空集合
  #    ⇒ 危險的 push 靜默放行。這裡分開看退出碼,拿不到就擋下來要人自己判斷。
  if ! FILES="$(git diff --name-only "$BASE" "$local_sha" -- apps packages 2>/dev/null)"; then
    echo "🔴 部署時序 gate:算不出 $BASE..$local_sha 的 diff(物件不在?shallow clone?)⇒ fail-closed。" >&2
    echo "   local_ref=$local_ref → remote_ref=$remote_ref   base=$BASE  local_sha=$local_sha" >&2
    echo "   ⇒ 停下來:這是【物件讀不到】不是【檢查過而乾淨】—— 先修 repo" >&2
    echo "     (shallow clone 請 git fetch --unshallow / 完整 fetch;物件損壞跑 git fsck), 再重推。" >&2
    echo "   真的要繞:先自己確認那幾支 migration 都已 apply, 再 git push --no-verify 並在 commit body 寫明。" >&2
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
      echo "🔴 部署時序 gate:算不出 $af 的新增行 ⇒ fail-closed(與外層同一條紀律)。" >&2
      echo "   local_ref=$local_ref → remote_ref=$remote_ref   base=$BASE  local_sha=$local_sha  path=$af" >&2
      echo "   ⇒ 停下來:先修 repo(fetch / fsck)再重推;不要先用 --no-verify。" >&2
      exit 1
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

    # ── 欄位:**欄名 AND 表名要出現在同一支檔**(尺二;理由與數字見檔頭)──────
    # ⚠️ 產生型別檔整支跳過 —— 理由與 view 那條同一個機制(它含每一張表與每一個欄名,
    #    而它是自動產生的、執行期不發任何請求)。
    if [ -n "$COL_LIST" ] && [ "$af" != "$GENERATED_TYPES" ]; then
      # 🔴🔴 **表名要在【整支檔】裡找, 不是在新增行裡找**(codex R1 must-fix)——
      #    ⛔ ~~舊版兩個字面都只查 `$CODE`(= 這一發【新增的行】)~~
      #    ⇒ 📌 **既有的 `.from('things')` 不動、這一發只新增欄名 ⇒ 兩者不同行 ⇒ 放行。**
      #    🛑 **那正是 view 那條路 2026-08-24 撤回過的形狀** —— 我在檔頭寫「不要重蹈」然後重蹈了。
      #    ⛔ ~~⇒ ✅ **欄名**仍然只認**新增行**;**表名**改看**整支檔**。~~
      #    🔴 **上面那一行【已被下面的 `R3 A1` 推翻】(R4 F4 點名:相鄰兩段講相反的事)** ——
      #      現在**兩個名字都看整支檔**, 而整支檔已經剝掉註解行(見 `R4 F3`)。
      #      🛑 讀到誤擋而想「照這一行修回去」的人:那等於把 `R3 A1` 撤掉, 而 A1 是量出來的。
      # 🔴🔴 **R3 B2:`cat-file -e` 失敗【不等於】那支檔被刪了。**
      #    ⛔ ~~舊版用 `cat-file -e` 分「刪掉」與「讀得到」~~ ⇒ 📌 partial / shallow clone、
      #      promisor remote 暫時不可用、物件損壞 —— **全部被歸成「安全刪檔」而放行**,
      #      🛑 而 stderr 一個字都不會提。
      #    ⇒ ✅ 分類要用 **tree listing**(它答的是「這支路徑在不在那棵樹裡」),
      #      讀不讀得到 blob 是**另一個問題** ⇒ 在 tree 裡而讀不到 ⇒ fail-closed 並印出 ref/sha/path。
      if ! _AF_IN_TREE="$(git ls-tree --name-only "$local_sha" -- "$af" 2>/dev/null)"; then
        echo "🔴 部署時序 gate:列不出 $local_sha 的 tree($af)⇒ fail-closed。" >&2
        echo "   ref=$remote_ref  local_sha=$local_sha  path=$af" >&2
        echo "   ⇒ 停下來:先補齊 git object(shallow clone 請 unshallow / fetch 完整), 再重推。" >&2
        exit 1
      fi
      # 🔴🔴 **R4 F3:`FULL` 是【整支檔原文】—— 註解沒剝, 而函式/view 那條路的 `$CODE` 剝了。**
      #    📌 **量到的, 不是想的**(同一份輸入 `dev~40..dev`, 樹 /Users/sean_1/pcm-website-v2):
      #      前一顆 `1c3c747c3` ⇒ rc=0 `0 blocked / 16 pending`
      #      本族修法後      ⇒ rc=1, 擋在 `packages/domain/src/payment/anomaly-alert.ts`
      #      而那支檔對 `order_refunds` 與 `rec_trade_id` 的命中**全部在註解裡**
      #      (`:14` 逐字「仍然不得引入的:**金額 / 使用者 id / rec_trade_id / 姓名電話地址**」·
      #       `:60` 逐字「**F-004:退款卡住計數,分母是 `order_refunds`**」)
      #      ⇒ 剝掉註解行之後命中 **0**(正對照:同一把尺找 `export` ⇒ **2** ⇒ 尺是活的)。
      #    🛑 **⇒ 這是【這一族】造成的, 不是本來就在** ⇒ 一句註解會擋住全隊的 push。
      #    ✅ 修法:`FULL` 進比對前套【`$CODE` 那邊已經在用的同一道】註解剝除, 不新寫一份 pattern。
      _strip_comment_lines() { grep -vE '^[[:space:]]*(//|\*|/\*)' || true; }
      if [ -z "$_AF_IN_TREE" ]; then
        FULL=""      # 🔵 這支路徑【不在那棵樹裡】= 這一發把它刪了 ⇒ 跳過, 不是失敗
      elif ! FULL="$(git show "$local_sha:$af" 2>/dev/null | _strip_comment_lines)"; then
        echo "🔴 部署時序 gate:路徑在 tree 裡而 blob 讀不到 ⇒ fail-closed(不是刪檔)。" >&2
        echo "   ref=$remote_ref  local_sha=$local_sha  path=$af" >&2
        echo "   ⇒ 停下來:物件缺失或損壞, 先修 repo(fetch / fsck), 不要用 --no-verify 繞過。" >&2
        exit 1
      fi
      while IFS= read -r pair; do
        [ -n "$pair" ] || continue
        ctbl="${pair%%	*}"; ccol="${pair##*	}"
        [ -n "$ctbl" ] && [ -n "$ccol" ] || continue
        # 🔴🔴 **R3 C1:引號識別字含 regex metachar 時, 要【逃逸】不是【跳過】。**
        #    ⛔ ~~舊版 `case … *[!A-Za-z0-9_]*) continue`~~ ⇒ 📌 `"Order-Items"."gross-margin"`
        #      **抽取端剛修好抽得到, 比對端卻整組丟掉** ⇒ 修了一半, 而綠的看起來一樣。
        #    ⇒ ✅ 逃逸 ERE metachar 之後再塞進 pattern。⚠️ 名字裡含**換行**的仍然跳過
        #      (本檔的抽取 regex 產不出那種, 而 `grep` 的 pattern 也吃不下)。
        # 🔴 `$(printf ...)` 會把結尾換行吃掉 ⇒ 那個 pattern 會退化成 `**`(命中【每一組】)
        #    ⇒ 這一族整族靜音, 而它看起來只是一行防呆。用 bash 的 `$'\n'`, 它是真的換行。
        case "$ctbl$ccol" in *$'\n'*) continue ;; esac
        # 🔴🔴 **R4 F2:替換端【多逃一層】⇒ 這一整條修法是 no-op, 而它是【漏擋】方向。**
        #    ⛔ ~~`sed 's/…/\\\\&/g'`~~(四個反斜線)⇒ sed 產出的是**兩個**反斜線
        #      ⇒ 📌 `gross.margin` 變成 `gross\\.margin` ⇒ `grep -E` 拿它比 `gross.margin` ⇒ **不匹配**
        #      ⇒ 🛑 與舊版「整組 continue」**同結果**, 而字面看起來已經修好了。
        #    ✅ 兩個反斜線就對:實測 `gross.margin` ⇒ `gross\\.margin` ⇒ 命中;
        #      負對照 `grossXmargin` ⇒ 不中 ⇒ 那把尺會動。
        _etbl="$(printf '%s' "$ctbl" | sed 's/[][\\.^$*+?(){}|]/\\&/g')"
        _ecol="$(printf '%s' "$ccol" | sed 's/[][\\.^$*+?(){}|]/\\&/g')"
        # 🔴🔴 **R3 A1:「這一發開始依賴它」那一半【拿掉了】—— 而那是往【擋】的方向走。**
        #    ⛔ ~~R2 MF1 的修法:兩名都在整檔 AND 至少一個在新增行~~
        #    ⇒ 📌 **兩個常數早就在檔裡**(`const TABLE='things'` / `const COLS='id, pcm_x'`),
        #      這一發只新增 `sb.from(TABLE).select(COLS)` ⇒ **新增行裡一個實際名稱都沒有** ⇒ 放行,
        #      🛑 而它真的在這一發開始依賴一支 pending 的新欄。
        #    ⇒ ✅ 判準收斂成一句:**這一發動過的 app 檔裡, 同檔同時提到表名與欄名 ⇒ 擋。**
        #      「新增行」那一半只要還在, 就一定有「常數早就在」的構造繞得過去
        #      (`.rpc()` 那條路 2026-08-21、view 那條路 2026-08-24 都是同一個形狀撤回的)。
        #    📏 **代價量出來了, 不藏**(2026-09-06, 分母 1,277 支候選 app 檔 / 94 組):
        #      這一族的誤擋上界 = **尺二 405 檔次**(= 同檔共現的總量);
        #      而它只在**那一組 (表,欄) 真的 pending** 時才會發生。
        #      今天實測:唯一 pending 的 `order_refunds.rec_trade_id` 全樹共現 **10 支檔**
        #      ⇒ 動到那 10 支的任何一支就會被擋。⇒ **誤擋的出路寫在訊息裡(KNOWN_COL_SKIP)。**
        # ⚠️ **R4 F6(nit, 刻意不改)**:`norm()` 對引號識別字**保留大小寫**, 而這兩道 `grep` 帶 `-i`
        #    ⇒ 抽取端分得出 `"CamelCase"` 與 `camelcase`, **比對端把它們看成同一個**。
        #    🔵 方向是【多擋】不是漏擋(誤擋成本 = 一次 push 重來)⇒ 往安全那邊倒, 本片不動它。
        #    📌 要改的那天:比對端也要分大小寫, 而那會讓「SQL 折小寫、TS 寫駝峰」那一大類漏掉 ——
        #      先造一發那種 fixture 再決定, 不要只把 `-i` 拿掉。
        printf '%s\n' "$FULL" | grep -qiE "(^|[^A-Za-z0-9_])$_ecol([^A-Za-z0-9_]|\$)" || continue
        printf '%s\n' "$FULL" | grep -qiE "(^|[^A-Za-z0-9_])$_etbl([^A-Za-z0-9_]|\$)" || continue
        BLOCKED="$BLOCKED\n  · 新欄 [$ctbl.$ccol](在未 apply 的 migration 裡)⇒ 這支檔同時提到表名與欄名:$af  [ref $remote_ref]\n    └ 那支 migration:$(printf '%s\n' "$PENDING" | cut -f2 | tr '\n' ' ')\n    └ ⚠️ 判準是【同檔共現】不是【真的讀了那一欄】—— 誤擋的話用 KNOWN_COL_SKIP 具名豁免並寫理由"
      done <<< "$COL_LIST"
    fi
  done <<< "$APP_FILES"
done < "$GATE_STDIN"

# 🔴 **`blocked` 那個數字要含欄位那一族**(codex R1 must-fix)——
#    ⛔ 舊版只數函式/view ⇒ 📌 **一發【純欄位】的擋會印 `0 blocked`, 而它同時 `exit 1`**
#    ⇒ 🛑 **「擋了」與「零命中」在摘要那一行上同形。**
BLOCKED_N="$(printf '%b' "$BLOCKED" | grep -c '^  · ' || true)"
[ -z "$BLOCKED" ] && { summary 0; exit 0; }

{
  echo ""
  # 🔴 **訊息不可以只講函式或 view**(codex R1 must-fix)——
  #    2026-09-06 加了欄位那一族之後, 一發**純欄位**的擋會印一句與事實不符的話。
  echo "🔴 部署時序 gate:**這次要推的應用層新增程式碼,用到了還沒 apply 的 migration 帶進來的東西**(函式 / view / 新欄)。"
  echo "   推上去 = 正式站去問一個資料庫裡還不存在的東西 ⇒ PGRST202 / 42703(2026-08-07 A9h:壞約 8 小時)。"
  printf '%b\n' "$BLOCKED"
  # ══ 🟠 補版控型的 pending 要點名(⟦0e-DDLINTOVC-MARK⟧;-f8 2026-09-06 裁甲)══════
  #
  # 🛑🛑 **這一段【只印, 不放行】—— 而那是刻意的, 不是還沒做完。**
  #    本檔下面十行逐字寫著「本閘刻意不提供【打一行宣告就過】的欄位(那種例外兩次被對抗審查
  #    證明是儀式)」⇒ 📌 **一個檔頭註解就是那種宣告。** 拿 `pcm:ddl-into-vc` 去豁免 PENDING,
  #    等於把那條被推翻過兩次的設計換個名字裝回來。
  # 🔵 那它為什麼還要印:一支補版控型的 migration, 它建的物件**在正式庫上早就有了**
  #    ⇒ 這一擋**很可能是誤擋**, 而擋人的訊息若不說這句, 讀的人會照 ①「先 apply」去做,
  #    而那正是對補版控型**最不該做**的事(它是空庫重放用的, 不該貼進正式庫)。
  # ⚠️ 只讀檔頭前 20 行(照 `migration-ledger-divergence.sh:247` 的先例)。
  if [ -n "$VC_LIST" ]; then
    echo ""
    echo "   🟠 **上面的 pending 裡有【補版控型】(檔頭帶 -- pcm:ddl-into-vc:)**:"
    printf '%b\n' "$VC_LIST"
    echo "     ⇒ 這幾支建的物件**在正式庫上很可能早就有了** ⇒ 這一擋**可能是誤擋**。"
    echo "     🛑 而本閘【不會】因為那一行就放行 —— 一個檔頭註解是【自己說的】,"
    echo "        而本閘擋的那件事(正式站問一個不存在的東西)代價是壞約 8 小時。"
    echo "     ✅ 要證它在:bash scripts/is-migration-applied.sh <那支檔>(它會告訴你【物件在】"
    echo "        對補版控型是零判別力, 並給你該問的那幾題), 或問平台帳本"
    echo "        bash scripts/migration-ledger-divergence.sh。"
    echo "     ⛔ **不要照下面的出路①去「先 apply」** —— 補版控型是空庫重放用的, 貼它進正式庫"
    echo "        是另一件事, 要 Sean 在場。"
  fi
  echo ""
  echo "   兩條出路(擇一):"
  echo "     ① 先 apply,再把該版本連同 sha256 追加進 supabase/APPLIED.tsv 並 commit,然後重推。"
  echo "     ② 應用層那半先不要推(或整段掛預設 off 的 flag)。"
  echo "   真的要現在推:git push --no-verify,並在 commit body 寫明為什麼 ——"
  echo "   本閘刻意不提供「打一行宣告就過」的欄位(那種例外兩次被對抗審查證明是儀式,見 plan §3)。"
  echo ""
} >&2
# 🔴 摘要行放在【擋下訊息之後】—— 它是最後一行,而 Sean 的終端機是往下捲的。
# 🔴 **數的是【所有】被擋的項目, 不是只數函式/view**(codex R1 must-fix)——
#    ⛔ 舊版 pattern 逐字 `· (函式|view) ` ⇒ 📌 **一發純欄位的擋會印 `0 blocked` 而同時 exit 1**
#    ⇒ 🛑 「擋了」與「零命中」在摘要那一行上同形。
summary "$BLOCKED_N"
exit 1
