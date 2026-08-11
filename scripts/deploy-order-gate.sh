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
#      🔴 **只抽函式名**是 Sean 的拍板(Q2=B「寧可漏擋、只比對 RPC 函式名」)——
#         table / column / view / index 名一律**不比**,因為它們(如 `orders`)撞常見字的機率高、誤擋體感差。
#         ⇒ 這是**刻意的漏擋**,不是漏寫;代價寫在 plan §6。
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
#   · 呼叫端若**不是逐字寫函式名**(字串拼接、常數表、動態 key),抓不到;這是文字比對的天花板。
#
# 用法(pre-push 之外可單獨跑,方便測):
#   printf '%s\n' "refs/heads/dev <local-sha> refs/heads/dev <remote-sha>" | bash scripts/deploy-order-gate.sh
#   DOG_DEBUG=1 …  額外印出 PENDING 與抽到的函式名
# ============================================================
set -uo pipefail
export LC_ALL=C

REPO="$(git rev-parse --show-toplevel 2>/dev/null || echo .)"
cd "$REPO" || exit 0
LEDGER="supabase/APPLIED.tsv"
ZERO="0000000000000000000000000000000000000000"

# 沒有 migrations 目錄的 repo 狀態(例如淺 clone)⇒ 這道閘沒有判準,放行而不是假裝有守
[ -d supabase/migrations ] || exit 0

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

EMPTY_TREE="$(git hash-object -t tree /dev/null)"

# ── 3. 逐 ref 判斷 ────────────────────────────────────────────────────
# 🔴 只看**真的會觸發 production 部署的 ref**(關卡2 must-fix #5):
#    storefront=`refs/heads/main`、admin=`refs/heads/dev`。推 tag、推 feature branch、`--all` 帶到的
#    歷史 ref 都不會部署,擋它們只會製造誤擋。
# 🔴 判準用**這次要推的那顆的樹**,不是工作樹(#4);比對的是**新增行**,不是整個檔的現況(#3)——
#    只改同一個檔的無關一行,不該因為檔內早就有那個 RPC 字樣而被擋。
BLOCKED=""
while read -r local_ref local_sha remote_ref remote_sha; do
  [ -n "${local_sha:-}" ] || continue
  [ "$local_sha" = "$ZERO" ] && continue                       # 刪除 ref
  case "${remote_ref:-}" in refs/heads/dev|refs/heads/main) : ;; *) continue ;; esac
  ledger_sanity "$local_sha" || exit 1

  if ! PENDING="$(pending_versions "$local_sha")"; then exit 1; fi
  [ "${DOG_DEBUG:-0}" = "1" ] && echo "deploy-order-gate[$remote_ref]: PENDING = $(printf '%s' "$PENDING" | cut -f1 | tr '\n' ' ')" >&2
  [ -n "$PENDING" ] || continue

  FN_LIST="$(printf '%s\n' "$PENDING" | cut -f2 | while read -r f; do
               [ -n "$f" ] && fn_names_of "$local_sha:$f"; done | sort -u)"
  [ "${DOG_DEBUG:-0}" = "1" ] && echo "deploy-order-gate[$remote_ref]: 函式名 = $(printf '%s' "$FN_LIST" | tr '\n' ' ')" >&2
  # pending 但零 CREATE FUNCTION(例如純加欄位)⇒ 依 Q2=B 的射程,本閘不管它
  [ -n "$FN_LIST" ] || continue

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
    while IFS= read -r fn; do
      [ -n "$fn" ] || continue
      printf '%s\n' "$ADDED" | grep -qE "(^|[^A-Za-z0-9_])$fn([^A-Za-z0-9_]|\$)" \
        && BLOCKED="$BLOCKED\n  · 函式 [$fn](在未 apply 的 migration 裡)出現在新增行:$af  [ref $remote_ref]\n    └ 那支 migration:$(printf '%s\n' "$PENDING" | cut -f2 | tr '\n' ' ')"
    done <<< "$FN_LIST"
  done <<< "$APP_FILES"
done

[ -z "$BLOCKED" ] && exit 0

{
  echo ""
  echo "🔴 部署時序 gate:**這次要推的應用層新增程式碼,用到了還沒 apply 的 migration 建的函式**。"
  echo "   推上去 = 正式站呼叫一支資料庫裡還不存在的函式 ⇒ PGRST202(2026-08-07 A9h:壞約 8 小時)。"
  printf '%b\n' "$BLOCKED"
  echo ""
  echo "   兩條出路(擇一):"
  echo "     ① 先 apply,再把該版本連同 sha256 追加進 supabase/APPLIED.tsv 並 commit,然後重推。"
  echo "     ② 應用層那半先不要推(或整段掛預設 off 的 flag)。"
  echo "   真的要現在推:git push --no-verify,並在 commit body 寫明為什麼 ——"
  echo "   本閘刻意不提供「打一行宣告就過」的欄位(那種例外兩次被對抗審查證明是儀式,見 plan §3)。"
  echo ""
} >&2
exit 1
