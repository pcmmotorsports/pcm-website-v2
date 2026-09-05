#!/bin/sh
# ============================================================
# migration 帳本分岔守門 — 「三把尺對得上嗎」
# ============================================================
# backlog #795(兩把尺會分岔且分岔時零訊號)/ #800(db push 會重跑已套的)
#
# ── 三把尺(缺一不可,少一把就答不出「該不該重跑」)────────────────
#   R = repo      supabase/migrations/*.sql        「我們寫了什麼」
#   H = 人帳本    supabase/APPLIED.tsv             「有人記下他 apply 了」
#   P = 平台帳本  supabase_migrations.schema_migrations
#                 (經 `supabase migration list --linked` 的 Remote 欄;唯讀 SELECT)
#                                                  「supabase db push 會怎麼想」
#
# 🔴 為什麼 H 和 P 會分岔,而且分岔時【零訊號】:
#   · Dashboard SQL Editor 貼上去 ⇒ **完全不寫** schema_migrations(P 不動、H 要人手記)
#   · MCP apply_migration        ⇒ 寫 schema_migrations,但**自派版本號**
#       (實例:repo 檔名 20260820120000,平台記成 20260820130021 ⇒ 對不起來)
#   · supabase db push           ⇒ 讀 P。P 沒有的它就當沒套過 ⇒ **重跑**
#   ⇒ 而 `20260820040000` 這類**不冪等**的重跑會 ERROR 42701。
#     SQL Editor 那次沒炸是因為整段一個交易會回滾;db push 逐支送,**沒有那個保護**
#     ⇒ 前面成功的不回滾 ⇒「有些炸、有些部分生效」= 最難收拾的狀態。
#
# ── 八種組合(R/H/P 各有無)與判定 ───────────────────────────
#   ① R H P  正常已套                    ok
#   ② R H P̄  🔴 危險:人帳說套了、平台不知道 ⇒ db push 會重跑    ← 擋
#   ③ R H̄ P  做了沒記(帳本失準,但 db push 不會重跑)          warn
#   ④ R H̄ P̄  待套 PENDING(正常,還沒 apply)                  ok
#   ⑤ R̄ H P  檔不見了而兩帳都有(歷史被刪)                     warn
#   ⑥ R̄ H P̄  幽靈:只有人帳有                                  warn
#   ⑦ R̄ H̄ P  🔴 平台孤兒版本號(MCP 自派號的殘骸)             ← 擋
#   ⑧ R̄ H̄ P̄  不存在(構造不出來)
#   ⑨ ④ 的子集:檔頭帶 `-- pcm:never-apply` ⇒ **刻意不套用**(不是「還沒」)      ok
#      🔴 為什麼要有它(2026-09-02,而它有一個真的受害者):
#         `20260901170000` 那支自己第 4 行逐字寫著「本支【不 apply 到正式庫】」,
#         而它在本表上落在 ④「待套 PENDING(正常,還沒 apply)」
#         ⇒ **一個【永遠不會被套】的東西,掛在一個寫著「還沒」的態底下**
#         ⇒ ⇒ 而主視窗當晚把它排進了「要 Sean 手貼」的清單(已撈回;它包在 BEGIN…COMMIT
#            ⇒ 貼下去會 ERROR + 回捲、零改動 —— 而成本是 Sean 一次不必要的緊張)。
#      📌 **而真正的病不是「它被歸錯類」**:當晚 ④ 裡 24 支有 23 支是真的還沒套
#         ⇒ **那個分類對 23/24 是對的** —— 而正因為它幾乎總是對,沒有人會為它建立查證習慣。
#         ⇒ ⇒ 🔴 **一個 96% 準確的訊號,不會有人去驗;而剩下那 4% 就是會送到 Sean 桌上的東西。**
#      🛑 **⇒ 所以第九格不是「多一個態」,它是【把那 4% 從那 96% 裡拉出來】。**
#      🔵 而**編號刻意不重排**:①-⑧ 在別處被引用,重排會讓那些引用悄悄指到另一格。
#
# ── exit code(對齊 scripts/where-is.sh 的 1/2/3 慣例)──────────
#   0 = 三把尺對得上(可能有 warn,但沒有危險組合)
#   3 = 有危險組合(②或⑦)—— 這是本閘的 finding
#   2 = 用法錯
#   1 = 本閘自己壞了 / **量不到平台帳本**
#       🔴 量不到就回 1,不回 0 —— 「查不到」被讀成「沒問題」正是 #795 的病本身。
#
# ── 用法 ────────────────────────────────────────────────
#   sh scripts/migration-ledger-divergence.sh              對正式庫實查(需 supabase CLI 已 link)
#   sh scripts/migration-ledger-divergence.sh --selftest   雙向表演(該紅/該綠各餵一發),不連網
#
# ── ⚠️ 本片只改「失敗長什麼樣子」, 沒有改「它停不停」(2026-08-27, 主視窗裁乙)───────
#   🔴 codex R1 nit 訂正:上一版寫「沒有讓它停下來」是**錯的字面** ——
#     mktemp 失敗本來就會讓 compare 回非 0、讓 pre-push 的 `&&` 串停住, 修前修後都一樣。
#     ⇒ 正確的宣稱是【停不停沒變】, 不是【不會停】。
#   建不出暫存目錄現在回 **9**(而不是與「量具壞了」共用的 1)⇒ 自檢那五格會亮紅並說出原因。
#   🔴 而主流程沒動:pre-push 走的是 `&&` 串, 9 與 1 一樣是非 0 ⇒ **擋不擋 push 完全沒變。**
#   要讓它【當場停下來】(把 return 換成 exit)= 動控制流 = 動 `.husky/pre-push:66` 這條全隊的路
#   ⇒ 那是**另一片**, 不在本片範圍。理由:selftest 可能本來就依賴那個 return 跑完後面的格,
#     而我們還沒量過那件事 —— **不拿全隊的 push 去換一個還沒完全理解的控制流。**
#   sh scripts/migration-ledger-divergence.sh --fixture D  用假帳本跑(D/migrations, D/applied.tsv, D/platform.txt)
#   … --if-pushing-main   由 .husky/pre-push 呼叫:讀 git 餵的 ref,只在推 refs/heads/main 時實查
#
# ── 誠實邊界(不假裝覆蓋;2026-08-21 codex 對抗審查 R1 逐條)──────
#   · 只比對**版本號**。同一版本號底下檔案內容被改過,本閘看不見
#     (那是 `APPLIED.tsv` 的 sha 欄 + `scripts/deploy-order-gate.sh` 的工作)。
#   · **只擋 `refs/heads/main` 的 push。** `git push origin HEAD:main` 會被擋(remote_ref 一樣),
#     但 **GitHub 網頁 merge、別台機器、`--no-verify`、直接跑 `supabase db push` 都繞得過**。
#     ⇒ `supabase db push` 本身沒有 hook 點,這是本閘的天花板,不是漏寫。
#   · 推 `dev` 刻意不擋。dev 會上 admin production,但那是**應用層部署**、不會跑 db push
#     ⇒ 不在本閘射程(部署時序由 `scripts/deploy-order-gate.sh` 管)。
#   · 平台側是唯讀 SELECT;本閘**不會**寫任何東西、不會 apply、不會補帳。
#   · **H 是自陳帳**:它說 apply 過不代表真的 apply 過。⇒ 本閘印的修法明說要先確認,不要盲補。
#   · **平台輸出的形狀是 CLI 決定的,不是我決定的**(codex R2):目前認 ASCII `|` 分欄 + 表頭字
#     `Remote`。Supabase CLI 若改成框線字元(`│`)或改欄名,本閘會**找不到表頭 ⇒ exit 1**。
#     ⇒ 失效方向是**誤擋**(擋住一個沒問題的 push),不是漏擋 —— 這是刻意選的方向。
#   · **回到一個還沒有 `supabase/migrations` 的舊 commit** ⇒ R 側 0 支 ⇒ exit 1(誤擋)。
#     緊急回退到那種版本時要用 `git push --no-verify`,並在 commit body 寫明。
#   · 檔名含換行的 migration:兩條讀取路徑都會拆錯。**未處理**(構造得出來,但沒發生過)。
#
# 🔴 【這一層沒有守門】(2026-08-21 codex R4 MF-5,老實寫出來,不要留一個看起來被守著的東西):
#    下面的自檢證明的是「**被驗物**還對不對」;而「**這些自檢自己有沒有退化成恆真**」
#    沒有任何外層在看。把判定改成永遠 PASS、或把核心函式換成 `return 0` ——
#    白名單仍看到精準 entry、shell 語法仍綠、本檔自己那條 lint-staged task 也綠 ⇒ **零訊號**。
#    ⇒ 現況只靠 code review 看那個 diff。停在這一層的理由與可能的外層:
#      `~/pcm-mailbox/W5-070-帳本分岔守門-20260821.md` §14。
# ============================================================
set -u
export LC_ALL=C

# 正式庫 project ref(公開字面;釘在 apps/admin/src/lib/payment/composition.test.ts:84,
# 也是 supabase/APPLIED.tsv 檔頭記載首次建檔時查的那一個)
PROD_REF="bmpnplmnldofgaohnaok"

usage() {
  echo "用法: sh scripts/migration-ledger-divergence.sh [--selftest | --fixture <目錄> | --if-pushing-main]" >&2
}

# 🔵 **② 在【推 main】那條路上降成警告**(2026-09-05 主視窗 `-f8` 裁, 線【DB】`-db` 做)
#   ⚠️ **主視窗那則把它叫成「⑤」, 而那是講錯的** —— 本檔的 ⑤ 是「檔不見了」, 它本來就是 warn。
#      要降的是 **②(`R H P̄` 人帳說套了而平台不知道)**。舊字面留在這裡, 讓照那則去找的人撞到訂正。
#   🎯 **為什麼可以降**:2026-09-05 唯讀實測 —— 那 88 支【全部】是 ②,
#      而其中 37 支可用存在性證明的 **37/37 都在正式庫**;⑦(真孤兒)**0 支**。
#      ⇒ 它今天擋人的**全部**是一種「東西其實在,只是平台那本沒寫」的差集。
#   🛑 **射程刻意只到 `--if-pushing-main`** —— `live` 與 `--fixture` 是【人主動來查】的路,
#      那裡的 ② 維持擋。📌 **降的是「自動擋住別人」, 不是「不再認為它危險」。**
#   🔴 **而 ⑦ 一格都沒動** —— 它的成因(MCP `apply_migration` 自派版本號)還活著,
#      隨時會再產生一支。今天 0 支不是「以後不會有」。
#   🔵 `PCM_LEDGER_SOFT_C2` 是給 `--selftest` 用的:讓那兩個新世界跑得到這條路。
#      ⚠️ 它同時也是一個**後門** —— 誰設了它就能讓 ② 不擋。而 ② 現在只在 pushmain 擋,
#         ⇒ 那個後門今天打得開的東西, 與 `--if-pushing-main` 打得開的是同一個。
SOFT_C2="${PCM_LEDGER_SOFT_C2:-0}"
FIXTURE=""; MODE="live"
case "${1:-}" in
  '')                MODE="live" ;;
  --selftest)        MODE="selftest" ;;
  --if-pushing-main) MODE="pushmain"; SOFT_C2=1 ;;
  --fixture)         MODE="fixture"; FIXTURE="${2:-}"
                     [ -n "$FIXTURE" ] || { echo "✗ --fixture 要接一個目錄" >&2; usage; exit 2; }
                     shift ;;
  -h|--help)         if [ "$#" -gt 1 ]; then
                       echo "✗ 多餘的參數:$(shift; echo "$*")" >&2; usage; exit 2
                     fi
                     usage; exit 0 ;;
  *)                 echo "✗ 不認得的參數:$1" >&2; usage; exit 2 ;;
esac
# 🔴 多餘的 option 也要炸(codex R1:`--if-pushing-main --bogus` 原本靜靜 exit 0)
shift 2>/dev/null || true
# 🔴 lint-staged 會把 staged 的檔名【附加在命令後面】(2026-08-21 codex R4 must-fix):
#    `sh 本檔 --selftest` 實際會變成 `sh 本檔 --selftest <檔名>`
#    ⇒ 舊寫法把它判成「多餘的參數」回 2 ⇒ **本批 commit 必紅**。
#    ⇒ 收下位置參數並印出來(不靜靜吃掉),但**打錯的 option 仍要炸**。
#    📌 這個坑我今天才在 `scripts/stale-commit-msgs.py:126-133` 處理過一次,然後在
#       三支新的 shell 腳本上又踩一次 —— 知道一個坑,擋不住你在下一段掉進去。
_extra_opts=""; _extra_pos=""
for _a in "$@"; do
  case "$_a" in
    -*) _extra_opts="$_extra_opts $_a" ;;
    *)  _extra_pos="$_extra_pos $_a" ;;
  esac
done
if [ -n "$_extra_opts" ]; then
  echo "✗ 不認得的參數:$_extra_opts —— 打錯的 option 不會被當成檔名放行" >&2; usage; exit 2
fi
if [ -n "$_extra_pos" ]; then
  echo "(忽略位置參數:$_extra_pos —— 本工具不吃檔名;lint-staged 會附加它們)" >&2
fi

# ── 量具自檢:comm 真的照我以為的方式運作嗎 ────────────────────
# 🔴 codex R1:comm 不在或行為不同時,空的差集檔照樣被建立
#    ⇒「沒有危險」與「工具壞了」是同一個畫面。這裡餵一組已知答案,答錯就當量具壞掉。
probe_tools() {
  # 🔴 9 =【建不出暫存目錄】, 刻意與下面 comm 答錯的 1 分開(2026-08-27 本窗實測)——
  #    29 次 mktemp 逐個失敗掃過去, 其中 **10 次**(D/E/H/L/M 五格各兩次)輸出與乾淨那發
  #    【逐字相同、rc 也相同】⇒ 那五格宣稱的是「量具壞了 ⇒ 1」, 而 mktemp 失敗**也**回 1
  #    ⇒ **格子通過了, 而理由是錯的。**
  #    📌 病不是「少了 `||`」—— 這四個 mktemp 全都有守。是【守門的回答與另一種失敗共用同一個數字】
  #       ⇒ 打開檔案看得到 `|| return 1`, 而看到它的人會結論「這支有處理」。
  _p=$(mktemp -d) || return 9
  printf 'a\nb\n' > "$_p/x"; printf 'b\nc\n' > "$_p/y"
  _both=$(comm -12 "$_p/x" "$_p/y" 2>/dev/null | tr -d '\n')
  _only=$(comm -23 "$_p/x" "$_p/y" 2>/dev/null | tr -d '\n')
  rm -rf "$_p"
  [ "$_both" = "b" ] && [ "$_only" = "a" ]
}

# ── 讀 R / H:給了 rev 就讀那棵樹,沒給才讀工作樹 ────────────────
# 🔴 codex R1 must-fix:pre-push 要判的是【要推上去的那棵樹】,不是我現在的工作樹。
#    工作樹裡別人寫到一半的 APPLIED.tsv,不該決定這次 push 的判定。
#    (與 `scripts/deploy-order-gate.sh` 的「一律讀 local_sha 那棵樹」同一條紀律。)
# 🔴 `blob` / `-type f`:只認真正的檔。否則造一個名叫 `<版本>_x.sql/` 的**目錄**就能偽造 R。
read_R() { # $1=rev(空=工作樹) $2=migrations 目錄(工作樹用)
  if [ -n "$1" ]; then
    # 🔴 兩條路的分母要一樣:工作樹那條 `find -name '*.sql'` 已經濾掉非 .sql,
    #    git 這條若不濾,`README.md` / `.impeccable` 這種伴生檔會被算成「檔名形狀不對」
    #    ⇒ **一支說明檔就能讓推 main 誤紅**(2026-08-21 自查:`supabase/migrations/.impeccable`
    #    現在就在工作樹裡,只是未追蹤;哪天有人 commit 它,這道閘就會無故擋人)。
    # 🔴 三個坑一起處理(2026-08-21 codex R1/R2):
    #  ① `--format=%(objecttype)` 要 git ≥2.36,舊 git 上會**整個失敗 ⇒ 空輸出**;改用古老就有的欄位格式。
    #  ② **不加 `-z` 的話,非 ASCII 檔名會被 git C-quote**(`"20260101_\344\270\255.sql"`)
    #     ⇒ 那一列在後面的形狀比對整個消失,而 `n_odd_R` 也看不到它 ⇒ **漏擋且零訊號**。
    #  ③ **symlink 的 objecttype 也是 `blob`** ⇒ 只看 type 擋不住「用一支 symlink 冒充 migration」。
    #     這裡改看 **mode**:`100644`/`100755` 才是一般檔,`120000`(symlink)與 `160000`(submodule)排除。
    #  ⚠️ 已知限制:檔名若含換行,`tr '\0' '\n'` 會把它拆成兩列(工作樹那條走 find 也一樣)。
    git ls-tree -r -z "$1" -- supabase/migrations 2>/dev/null \
      | tr '\0' '\n' \
      | awk -F'\t' 'NF>=2 { split($1, m, " "); if (m[1] ~ /^100[0-9][0-9][0-9]$/ && m[2] == "blob") print $2 }' \
      | sed 's|^supabase/migrations/||' | grep '\.sql$'
  else
    find "$2" -maxdepth 1 -type f -name '*.sql' -exec basename {} \; 2>/dev/null
  fi
}
read_H() { # $1=rev(空=工作樹) $2=tsv 路徑
  if [ -n "$1" ]; then git show "$1:supabase/APPLIED.tsv" 2>/dev/null
  else cat "$2" 2>/dev/null; fi
}

# ── 核心:三方比對 ────────────────────────────────────────
# $1=migrations 目錄  $2=APPLIED.tsv  $3=平台輸出檔  $4=rev(可空)
compare() {
  MIGDIR="$1"; TSV="$2"; PLATF="$3"; REV="${4:-}"
  probe_tools; _pt=$?
  if [ "$_pt" = "9" ]; then
    echo "🔴 建不出暫存目錄(mktemp)⇒ 這不是量測結果, exit 9" >&2; return 9
  elif [ "$_pt" != "0" ]; then
    echo "🔴 量具自檢 FAIL:comm 的行為與預期不符 ⇒ 差集不可信,exit 1" >&2; return 1
  fi
  W=$(mktemp -d) || { echo "🔴 建不出暫存目錄(mktemp)⇒ 這不是量測結果, exit 9" >&2; return 9; }

  if [ -z "$REV" ]; then
    if [ ! -d "$MIGDIR" ]; then
      echo "🔴 找不到 migrations 目錄:$MIGDIR ⇒ 本閘無法判斷,exit 1" >&2; rm -rf "$W"; return 1
    fi
    if [ ! -f "$TSV" ]; then
      echo "🔴 找不到人帳本:$TSV ⇒ 本閘無法判斷,exit 1" >&2; rm -rf "$W"; return 1
    fi
  fi
  if [ ! -f "$PLATF" ]; then
    echo "🔴 拿不到平台帳本 ⇒ 本閘無法判斷,exit 1" >&2; rm -rf "$W"; return 1
  fi

  # 🔴 BOM:第一列帶 BOM 會讓那一列【安靜消失】,而 nH 仍 >0 ⇒ 自檢不會紅。
  #    危險方向 = 少掉的那列若「repo 有、平台沒有」,會從②危險掉成④待套 = 漏擋。
  # 🔴 BSD sed 不吃 `\357` 這種八進位跳脫(會報 invalid backreference)⇒ 用 printf 造出那三個 byte
  #    再交給 sed。不要用 `tr -d`:那三個 byte 也出現在中日文的 UTF-8 序列裡,會誤刪。
  BOM=$(printf '\357\273\277')
  read_R "$REV" "$MIGDIR" | sed "1s/^${BOM}//" > "$W/R.raw"
  read_H "$REV" "$TSV" | sed "1s/^${BOM}//" | grep -v '^#' | grep -v '^[[:space:]]*$' > "$W/H.raw"

  sed -n 's/^\([0-9]\{14\}\)_.*\.sql$/\1/p' "$W/R.raw" | sort -u > "$W/R"

  # 🔴 第九格的來源:檔頭前 20 行帶 `-- pcm:never-apply` 的那幾支。
  #    ⚠️ **限定前 20 行是刻意的** —— 一支檔中段的註解提到這個字面(例如在解釋這個機制)
  #      不該把它自己變成 never-apply。⇒ 標記是【宣告】,不是【提及】。
  #    ⚠️ 而 rev 那條路要從 rev 讀, 不能讀工作樹 —— 否則 `--rev` 會拿今天的檔去判昨天的樹。
  : > "$W/NEVER"; : > "$W/NOTNEED"; : > "$W/BADMARK"; : > "$W/BOTHMARK"; : > "$W/NOTNEED.why"; : > "$W/DEADPATH"
  while IFS= read -r _f; do
    case "$_f" in
      [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]_*.sql) ;;
      *) continue ;;
    esac
    if [ -n "$REV" ]; then
      _head=$(git show "$REV:supabase/migrations/$_f" 2>/dev/null | head -20)
    else
      _head=$(head -20 "$MIGDIR/$_f" 2>/dev/null)
    fi
    _has_never=0; _has_notneed=0
    case "$_head" in *"-- pcm:never-apply"*) _has_never=1 ;; esac
    case "$_head" in *"-- pcm:not-needed-now:"*) _has_notneed=1 ;; esac
    # 🔴 **兩個標記同時出現 ⇒ 報錯, 不要挑一個**(-15 規格 ③-3)——
    #    一個宣告矛盾要吵出來, 不要被靜靜解決成其中一種。
    if [ "$_has_never" -eq 1 ] && [ "$_has_notneed" -eq 1 ]; then
      printf '%s\n' "${_f%%_*}" >> "$W/BOTHMARK"
    elif [ "$_has_never" -eq 1 ]; then
      printf '%s\n' "${_f%%_*}" >> "$W/NEVER"
    elif [ "$_has_notneed" -eq 1 ]; then
      # 🔴 **冒號後面是空的 ⇒ 不算合法標記**(-15 規格 ③-1)——
      #    而它**要出聲**, 不要安靜地當它不存在:否則一個打錯的標記
      #    與一支【真的待套】的檔印同一個結果。
      _why=$(printf '%s\n' "$_head" | sed -n 's/^--[[:space:]]*pcm:not-needed-now:[[:space:]]*//p' | head -1)
      if [ -z "$_why" ]; then
        printf '%s\n' "${_f%%_*}" >> "$W/BADMARK"
      elif { printf '%s' "$_why" | grep -qE '(^| )[A-Za-z0-9_./-]+\.(sql|sh|py|ts|tsx|js|mjs)( |$)'; } \
           && ! { printf '%s' "$_why" | tr ' ' '\n' \
                  | grep -E '^[A-Za-z0-9_./-]+\.(sql|sh|py|ts|tsx|js|mjs)$' \
                  | while IFS= read -r _pp; do git cat-file -e "HEAD:$_pp" 2>/dev/null || { echo miss; break; }; done \
                  | grep -q miss; }; then
        # 🟢 理由裡提到的每一支檔都在【版控裡】⇒ 合法
        printf '%s\n' "${_f%%_*}" >> "$W/NOTNEED"
        printf '%s\t%s\n' "${_f%%_*}" "$_why" >> "$W/NOTNEED.why"
      elif printf '%s' "$_why" | grep -qE '(^| )[A-Za-z0-9_./-]+\.(sql|sh|py|ts|tsx|js|mjs)( |$)'; then
        # 🔴 **理由裡有【看起來是檔案路徑】的東西, 而它不在版控裡** ⇒ 不算合法
        #    ⇒ 🎯 而判準是 `git cat-file -e HEAD:<path>` **不是 `test -e`**(`-15` 收窄):
        #      `test -e` 問的是「**我這棵樹**上有沒有」⇒ 一支檔在 dev 上有、而在某個施工窗的
        #      工作樹上沒有(或反過來)⇒ **那會變成一道在某些人機器上紅、在別人機器上綠的閘,
        #      而它每次紅都是誤報。**
        #    ✅ `git cat-file -e HEAD:<path>` 問的是「**這支檔進版控了嗎**」——
        #      而那才是「別人照著跑得動」的真正前提。
        printf '%s\n' "${_f%%_*}" >> "$W/DEADPATH"
      else
        # 🔵 **理由裡沒有任何看起來像檔案路徑的東西 ⇒ 不驗路徑, 而【不是】判紅。**
        #    🎯 規格要的是【可執行的複查方法】, 不是【一定要是一支檔】——
        #      一句「唯讀查 aclexplode(relacl) 看 anon 在不在」也是可執行的。
        #    ⇒ 📌 少了這一格, 這道閘會逼所有人都寫成一支檔。
        printf '%s\n' "${_f%%_*}" >> "$W/NOTNEED"
        printf '%s\t%s\n' "${_f%%_*}" "$_why" >> "$W/NOTNEED.why"
      fi
    fi
  done < "$W/R.raw"
  sort -u -o "$W/NEVER" "$W/NEVER"
  for _x in NOTNEED BADMARK BOTHMARK DEADPATH; do
    [ -f "$W/$_x" ] || : > "$W/$_x"
    sort -u -o "$W/$_x" "$W/$_x"
  done
  [ -f "$W/NOTNEED.why" ] || : > "$W/NOTNEED.why"
  sed -n 's/^\([0-9]\{14\}\)	.*/\1/p'      "$W/H.raw" | sort -u > "$W/H"

  # 🔴 codex R1:形狀對不上的列會【靜默消失】而不觸發任何自檢
  #    ⇒ 單獨數出來,有就當量具壞掉(不是「那些不算」)。
  n_odd_R=$(grep -vc '^[0-9]\{14\}_.*\.sql$' "$W/R.raw" || true)
  n_odd_H=$(grep -vc '^[0-9]\{14\}	' "$W/H.raw" || true)

  # ── 平台側:由【表頭】決定 Remote 是第幾欄,不寫死第 2 欄 ──────
  # 🔴 codex R1 must-fix:欄位一換位(例如多一個 Status 欄),寫死第 2 欄會把 Local 讀成 Remote
  #    ⇒ 每一支都變成「平台有」⇒ ② 全部消失、回 0。那是最壞的失效方向。
  PCOL=$(awk -F'|' '/Remote/ { for (i=1;i<=NF;i++) { c=$i; gsub(/[ \t\r]/,"",c); if (c=="Remote") { print i; exit } } }' "$PLATF")
  if [ -z "${PCOL:-}" ]; then
    echo "🔴 平台輸出裡找不到 Remote 欄的表頭 ⇒ 量不到(不是「平台是空的」),exit 1" >&2
    rm -rf "$W"; return 1
  fi
  awk -F'|' -v c="$PCOL" 'NF>=c { v=$c; gsub(/[ \t\r]/,"",v); if (v ~ /^[0-9]{14}$/) print v }' "$PLATF" | sort -u > "$W/P"
  # 🔴 codex R2 must-fix:P 側原本【沒有】形狀錯誤的計數 —— 只有 R 和 H 有。
  #    後果:一列 15 位數的孤兒號會靜默消失 ⇒ ⑦ 少報而 exit 0。
  #    這裡數「Remote 欄非空、但不是 14 位數字」的資料列(表頭與分隔線不算)。
  n_odd_P=$(awk -F'|' -v c="$PCOL" '
    /Remote/ { next }
    /^[ \t-]*$/ { next }
    { line=$0; gsub(/[ \t|\r-]/,"",line); if (line == "") next }
    NF>=c { v=$c; gsub(/[ \t\r]/,"",v); if (v != "" && v !~ /^[0-9]{14}$/) n++ }
    END { print n+0 }' "$PLATF")

  nR=$(wc -l < "$W/R" | tr -d ' '); nH=$(wc -l < "$W/H" | tr -d ' '); nP=$(wc -l < "$W/P" | tr -d ' ')

  bad=0
  if [ "$nR" -lt 1 ]; then
    echo "🔴 自檢 FAIL:repo 側 0 支 —— 掃錯樹或格式變了,不是 repo 乾淨" >&2; bad=1
  fi
  if [ "$nH" -lt 1 ]; then
    echo "🔴 自檢 FAIL:人帳本 0 列 —— 解析壞了(欄位不是 TAB 分隔?),不是帳本空的" >&2; bad=1
  fi
  if [ "$n_odd_R" != "0" ]; then
    echo "🔴 自檢 FAIL:migrations 有 $n_odd_R 支檔名不是「14 位數字_描述.sql」⇒ 它們會靜默消失在分母外" >&2; bad=1
  fi
  if [ "$n_odd_H" != "0" ]; then
    echo "🔴 自檢 FAIL:人帳本有 $n_odd_H 列不是「14 位數字 + TAB」⇒ 同上,會靜默消失" >&2; bad=1
  fi
  if [ "$n_odd_P" != "0" ]; then
    echo "🔴 自檢 FAIL:平台輸出有 $n_odd_P 列的 Remote 欄不是 14 位數字 ⇒ 孤兒號會靜默消失、⑦ 少報" >&2; bad=1
  fi
  if [ "$bad" != "0" ]; then rm -rf "$W"; return 1; fi
  # 🔴 nP=0 而表頭在 ⇒ 平台【真的】是空的。那不是「量不到」,是最嚴重的分岔 ⇒ 往下判,不回 1。
  if [ "$nP" -lt 1 ]; then
    echo "⚠️ 平台帳本 0 列(表頭在 ⇒ 查得到、真的是空的)。這不是量不到,是全部都對不上。" >&2
  fi

  comm -12 "$W/R" "$W/H" > "$W/RH"
  comm -23 "$W/RH" "$W/P" > "$W/c2"       # ② R H P̄  危險
  comm -12 "$W/RH" "$W/P" > "$W/c1"       # ① 正常
  comm -23 "$W/R"  "$W/H" > "$W/RnoH"
  comm -23 "$W/RnoH" "$W/P" > "$W/c4.all" # ④ 待套(拆之前)
  # 🔴 ④ 拆兩半:帶標記的進 ⑨, 其餘留 ④。**兩半都要印** ——
  #    只印 ⑨ 會讓「真的還沒套」那 23 支消失, 而那是這道閘本來的用途。
  comm -12 "$W/c4.all" "$W/NEVER" > "$W/c9"
  comm -23 "$W/c4.all" "$W/NEVER" > "$W/c4.rest"
  # 🔴 ⑩「目標已達成 ⇒ 目前不需要貼」= ④ 的子集(-15 規格)——
  #    而它與 ⑨ 的差別**不是分類, 是【它有一個還活著的問題】**:
  #    ⑨ 那幾支在複製正式庫現況 ⇒ 結構上永遠不會變成「要貼」;
  #    ⑩ 是一支【真的要 apply】的片, 被現況擋下 ⇒ **有人把狀態改回去, 它會重新變成要貼。**
  #    ⇒ 🎯 所以它必須帶一句【可執行的複查方法】, 而下面那段會把原文印出來。
  comm -12 "$W/c4.rest" "$W/NOTNEED" > "$W/c10"
  comm -23 "$W/c4.rest" "$W/NOTNEED" > "$W/c4"
  comm -12 "$W/RnoH" "$W/P" > "$W/c3"     # ③ 做了沒記
  comm -13 "$W/R"  "$W/H" > "$W/HnoR"
  comm -12 "$W/HnoR" "$W/P" > "$W/c5"     # ⑤ 檔不見了
  comm -23 "$W/HnoR" "$W/P" > "$W/c6"     # ⑥ 幽靈
  comm -13 "$W/R"  "$W/P" > "$W/PnoR"
  comm -23 "$W/PnoR" "$W/H" > "$W/c7"     # ⑦ 平台孤兒

  n1=$(wc -l < "$W/c1"|tr -d ' '); n2=$(wc -l < "$W/c2"|tr -d ' '); n3=$(wc -l < "$W/c3"|tr -d ' ')
  n4=$(wc -l < "$W/c4"|tr -d ' '); n5=$(wc -l < "$W/c5"|tr -d ' '); n6=$(wc -l < "$W/c6"|tr -d ' ')
  n7=$(wc -l < "$W/c7"|tr -d ' '); n9=$(wc -l < "$W/c9"|tr -d ' ')
  n10=$(wc -l < "$W/c10"|tr -d ' ')

  # 🔴 分母對帳:八格加總必須等於三把尺的聯集。對不上 ⇒ 有版本掉在格子外面,結論作廢。
  cat "$W/R" "$W/H" "$W/P" | sort -u > "$W/U"
  # 🔴 ⑨ 是從 ④ 拆出來的 ⇒ 加總要含它, 否則拆完之後這道自檢會【自己紅】
  nU=$(wc -l < "$W/U"|tr -d ' '); nSum=$((n1+n2+n3+n4+n5+n6+n7+n9+n10))
  if [ "$nSum" != "$nU" ]; then
    echo "🔴 自檢 FAIL:九格加總 $nSum ≠ 版本號聯集 $nU ⇒ 有版本掉在格子外,本次輸出作廢" >&2
    rm -rf "$W"; return 1
  fi

  echo "── migration 帳本三方比對:repo $nR / 人帳本 $nH / 平台 $nP  (聯集 $nU,九格加總 $nSum ✓)"
  if [ -n "$REV" ]; then
    echo "   讀的是 rev $REV 那棵樹(不是工作樹)"
  fi
  echo "   ① 正常已套 $n1   ④ 待套 PENDING $n4"
  if [ "$n9" -gt 0 ]; then
    echo "   🔵 ⑨ 刻意不套用(檔頭 -- pcm:never-apply)$n9 —— **這幾支不要放進「要 Sean 貼」的那一疊**"
    sed 's/^/      · /' "$W/c9"
  fi
  # 🔴 ⑩ **分開印, 而且把【複查方法】原文印出來**(-15 規格 ③-2)——
  #    理由:⑩ 是一份**站著的待複查清單**;併進 ⑨ 就沒有人會再看它。
  if [ "$n10" -gt 0 ]; then
    echo "   🟡 ⑩ 目標已達成 ⇒ 目前不需要貼(檔頭 -- pcm:not-needed-now:)$n10"
    echo "      🛑 **這一格與 ⑨ 不同:⑨ 結構上永遠不會變成「要貼」, 而 ⑩【會】** ——"
    echo "         有人把狀態改回去, 它就重新需要 ⇒ 所以它必須帶一句可執行的複查方法:"
    while IFS="$(printf '\t')" read -r _v _w; do
      printf '      · %s\n        ⇒ 怎麼知道它重新變成要貼:%s\n' "$_v" "$_w"
    done < "$W/NOTNEED.why"
  fi
  markbad=0
  # 🔴 標記不完整 ⇒ **出聲**, 而那支留在 ④(-15 規格 ③-1)。
  #    📌 不出聲的話, 一個打錯的標記與一支【真的待套】的檔印同一個結果。
  if [ -s "$W/BADMARK" ]; then
    echo "🔴 標記不完整:這幾支帶了 -- pcm:not-needed-now: 而【冒號後面是空的】⇒ 不算合法標記, 它們仍在 ④ 待套裡" >&2
    sed 's/^/      · /' "$W/BADMARK" >&2
    markbad=1
  fi
  # 🔴 理由裡的路徑不在版控裡 ⇒ 不算合法(而它比空白難發現:那道閘只檢查非空 ⇒ 它會通過)。
  if [ -s "$W/DEADPATH" ]; then
    echo "🔴 複查方法指到【不在版控裡的檔】:這幾支的 not-needed-now 理由裡提到一支路徑, 而 git cat-file -e HEAD:<path> 找不到它" >&2
    echo "   ⇒ 🎯 判準是【進版控了嗎】不是【我這棵樹上有嗎】—— 後者會變成在某些人機器上紅的閘, 而每次紅都是誤報" >&2
    sed 's/^/      · /' "$W/DEADPATH" >&2
    markbad=1
  fi
  # 🔴 兩個標記同時出現 ⇒ 報錯, 不要挑一個(規格 ③-3):宣告矛盾要吵。
  if [ -s "$W/BOTHMARK" ]; then
    echo "🔴 標記矛盾:這幾支同時帶 -- pcm:never-apply 與 -- pcm:not-needed-now: ⇒ 兩者的意思不同, 請只留一個" >&2
    sed 's/^/      · /' "$W/BOTHMARK" >&2
    markbad=1
  fi
  # 🔴 帶 not-needed-now 而【同時出現在人帳本】⇒ 報錯(規格 ③-4):
  #    那代表它後來被貼了而標記沒拿掉 ⇒ **一個過期的標記會讓下一個人以為它還沒貼。**
  comm -12 "$W/NOTNEED" "$W/H" > "$W/NOTNEED.applied"
  if [ -s "$W/NOTNEED.applied" ]; then
    echo "🔴 標記過期:這幾支帶 -- pcm:not-needed-now: 而【帳本上已經有它】⇒ 它被貼了而標記沒拿掉" >&2
    sed 's/^/      · /' "$W/NOTNEED.applied" >&2
    markbad=1
  fi
  for k in 3 5 6; do
    eval "n=\$n$k"
    if [ "$n" -gt 0 ]; then
      case $k in
        3) t="③ 做了沒記(帳本失準,不會重跑)" ;;
        5) t="⑤ 檔不見了(repo 沒有而兩帳都有)" ;;
        6) t="⑥ 幽靈(只有人帳有)" ;;
      esac
      echo "   ⚠️ $t $n"
      sed 's/^/      · /' "$W/c$k"
    fi
  done

  rc=0
  # ── 🔬 **本支輸出的消費者清單**(2026-09-02 實查;而**寫數法不只寫結論, 因為它會過期**)──
  #   數法:`git grep -ln 'migration-ledger-divergence' -- . ':!*.md'` ⇒ **13 支**
  #   ⇒ 而逐支開檔之後, **沒有任何一支【讀特定的 rc 值】**:
  #     · `.husky/pre-push:66`  ⇒ 真的執行它, **而是用 `&&` 串** ⇒ 它只分【0 / 非 0】
  #     · `package.json:36`     ⇒ lint-staged 跑 `--selftest` ⇒ 同樣只分 0 / 非 0
  #     · `scripts/husky-hook-wiring-check.sh:115,177,187` ⇒ 只檢查**這個檔名有沒有出現在 pre-push 裡**, 不執行它
  #     · `scripts/unreported-work-scan.sh:65,85` ⇒ 🔵 註解說它「對齊本支的 1/2/3」——
  #        那是**約定**不是消費 ⇒ 加第四個碼不會弄壞它, 而那句話值得知道
  #     · `b2s2b-tsync-cells.sh` / `pagecount.sh` / `selftest-git-isolation-gate.sh` ⇒ 註解引用
  #     · 其餘 5 支是 `supabase/` 底下的 migration 與 `APPLIED.tsv` ⇒ 文字提及
  #   🟢 正對照(同把尺):`git grep -ln 'greenlight.sh' -- . ':!*.md'` ⇒ **5 支** ⇒ 尺會動
  #
  # 🛑 **⇒ 所以 rc 的優先序改不改, 對機器沒有差別 —— 而那也表示【改它不會讓人看得更清楚】。**
  #   🔴 而下面那個 rc=4 有一個【今天就失效】的射程:②⑦ 現在就在紅 ⇒ rc 被 3 蓋過去
  #     ⇒ **rc 分不出是哪一種。**
  #   ✅ 而唯一分得開的是上面那三行訊息 ⇒ **紅了要去讀那三行, 不要讀 rc。**
  #   📌 ⇒ 一個為了【讓人分得出兩種紅】而設計的碼, 在另一種紅同時存在時就失效了 ——
  #      而它失效時沒有任何訊號, 因為 rc 仍然是一個合法的非零。
  # 🔴 標記類問題(不完整 / 矛盾 / 過期)⇒ 非零。
  #    而它與 ②⑦ 的 rc=3 分開:那兩格是【帳本三方對不上】, 這一格是【標記本身壞了】。
  #    ⇒ 📌 兩種都要擋, 而讀的人要分得出是哪一種 ⇒ 所以用不同的碼。
  if [ "${markbad:-0}" != "0" ]; then rc=4; fi
  if [ "$n2" -gt 0 ]; then
    if [ "${SOFT_C2:-0}" = "1" ]; then
      {
        echo ""
        echo "⚠️ ② 警告 $n2 支:人帳本說已 apply,而【平台帳本沒有】—— **本路徑不擋**"
        sed 's/^/      · /' "$W/c2"
        echo "   ⇒ 這個狀態下跑 supabase db push,它會把上面每一支【當成沒套過而重跑】。"
        echo "   ⇒ 其中不冪等的那幾支會 ERROR;db push 逐支送,前面已成功的不會回滾。"
        echo "   🔵 為什麼這條路不擋(2026-09-05 -f8 裁):Dashboard SQL Editor 貼 SQL"
        echo "      **完全不寫平台帳本** ⇒ 這個差集是那條路的常態, 不是事故。"
        echo "      當天實測 88 支全是這一種, 而可證的 37 支 **37/37 都在正式庫**。"
        echo "   🛑 **而它仍然是一個要處理的東西, 只是不由這道閘擋** ——"
        echo "      處理方式與那 88 支的清單見 ~/pcm-mailbox/給Sean-平台帳本補記-20260905.md"
        echo "   🔴 **這句不擋只在【推 main】那條路上成立**:`live` 與 `--fixture` 仍然擋。"
      } >&2
    else
      rc=3
      {
        echo ""
        echo "🔴 ② 危險 $n2 支:人帳本說已 apply,而【平台帳本沒有】"
        sed 's/^/      · /' "$W/c2"
        echo "   ⇒ 這個狀態下跑 supabase db push,它會把上面每一支【當成沒套過而重跑】。"
        echo "   ⇒ 其中不冪等的那幾支會 ERROR;db push 逐支送,前面已成功的不會回滾。"
      } >&2
    fi
  fi
  if [ "$n7" -gt 0 ]; then
    rc=3
    {
      echo ""
      echo "🔴 ⑦ 平台孤兒 $n7 支:平台帳本有這個版本號,而 repo 與人帳本【都沒有】"
      sed 's/^/      · /' "$W/c7"
      echo "   ⇒ 典型成因:MCP apply_migration 自派版本號 ⇒ 平台記的號碼追不回任何一支檔。"
      echo "   ⇒ 後果:那支 migration 的內容在 repo 裡查不到出處,重建環境時會缺。"
    } >&2
  fi
  if [ "$rc" = "3" ]; then
    {
      echo ""
      echo "   🔴 本閘不裁定怎麼修,也不要盲目照抄下面的指令 ——"
      echo "      APPLIED.tsv 是【自陳帳】:它說 apply 過,不代表真的 apply 過。"
      echo "      補平台帳本前要先確認那支真的已經在正式庫生效(查它建的物件在不在)。"
      echo "   ② 的官方修法(確認過才做,要 Sean 在場):"
      echo "        supabase migration repair --linked --status applied <版本號>"
      echo "   ⑦ 的官方修法(孤兒號要拿掉,不是再補一個):"
      echo "        supabase migration repair --linked --status reverted <版本號>"
      echo "   都不想現在動 ⇒ 就不要跑 supabase db push,繼續走 SQL Editor / MCP 逐支套。"
    } >&2
  fi
  rm -rf "$W"
  return $rc
}

# ── selftest:雙向表演 ────────────────────────────────────
if [ "$MODE" = "selftest" ]; then
  # 🔴🔴 **把繼承來的 git 環境變數清掉**(2026-08-21 實測,codex R4 的接線題挖出來的):
  #    本段會在暫存目錄裡 `git init` / `git add` / `git commit` 造 fixture。
  #    而 lint-staged 是被 **`git commit` 的 pre-commit hook** 叫起來的 ⇒ 我們繼承了
  #    `GIT_INDEX_FILE`(指向外層那次 commit 的**暫存 index**)。
  #    ⇒ fixture 裡的 `git add` 會把路徑寫進【外層那次 commit 的 index】,
  #      外層隨即報 `error: invalid object … for 'supabase/migrations/20260101000000_x.sql'`
  #      ⇒ **整批 commit 失敗,而錯誤訊息指著一個那個 repo 裡根本不存在的檔。**
  #    ⇒ 這不是 fixture 的問題,是「自檢從 hook 裡跑」時的真實副作用。
  # 🔵 2026-09-02 補兩顆(-15 規格 ④-5 的清單):GIT_ALTERNATE_OBJECT_DIRECTORIES / GIT_NAMESPACE
  #    ⇒ 一次剝乾淨, 不要逐發包 —— 而那條的實錘是「只覆蓋 6 個呼叫點裡的 4 個時, 底下仍然全綠」。
  unset GIT_INDEX_FILE GIT_DIR GIT_WORK_TREE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_COMMON_DIR GIT_NAMESPACE GIT_PREFIX 2>/dev/null || true
  T=$(mktemp -d) || { echo "🔴 建不出暫存目錄(mktemp)⇒ 這不是量測結果, 也不是「乾淨」 ⇒ exit 9" >&2; exit 9; }
  trap 'rm -rf "$T"' EXIT
  pass=0; fail=0
  ck() {
    if [ "$2" = "$3" ]; then echo "  PASS $1 (=$2)"; pass=$((pass+1))
    else
      echo "  🔴 FAIL $1 (=$2, 該是 $3)"; fail=$((fail+1))
      # 🔴 只印「=9」不夠 —— 數字變了而沒說為什麼, 下一個人會去查一個不存在的邏輯錯。
      #    compare 的 stderr 被 run() 收進 $T/out 了 ⇒ 那句話讀的人看不到 ⇒ 在這裡補回。
      # 🔴 code-reviewer nit:`[ … ] && echo` 是 else 的尾命令 ⇒ 非 9 的 FAIL 會讓 ck() 回 1
      #    (舊版尾命令是 `fail=$((fail+1))` 恆 0)。今天無害(本檔只有 set -u), 而哪天有人
      #    加 `set -e` 就會在第一個 FAIL 當場斷 ⇒ 補 `|| true` 把尾命令釘回 0。
      [ "$2" = "9" ] && echo "     ↳ 9 =【這一格的暫存目錄建不出來(mktemp 失敗)】,不是判定邏輯錯 ⇒ 查磁碟空間 / TMPDIR 權限,別查測試" || true
    fi
  }
  mk() {
    d="$T/$1"; mkdir -p "$d/migrations"
    for v in 20260101000000 20260102000000; do : > "$d/migrations/${v}_x.sql"; done
    printf '# c\n20260101000000\tsha\t2026-01-01\tme\n' > "$d/applied.tsv"
    printf '   Local          | Remote         | Time\n  ---|---|---\n' > "$d/platform.txt"
    echo "$d"
  }
  run() { compare "$1/migrations" "$1/applied.tsv" "$1/platform.txt" "" > "$T/out" 2>&1; echo $?; }
  has() { if grep -q "$2" "$T/out"; then echo yes; else echo no; fi }

  # A【該綠】20260101 三方都有;20260102 只在 repo(④待套,正常)
  A=$(mk green)
  printf '   20260101000000 | 20260101000000 | t \n   20260102000000 |                | t \n' >> "$A/platform.txt"
  ck "A 該綠:①+④ ⇒ 0" "$(run "$A")" "0"

  # B【該紅·只有②】人帳有而平台沒有。
  # 🔴 codex R1 nit:上一版為了讓 nP>0 加了一個 P-only 版本,**同時觸發了⑦** ⇒ 那格有兩個紅因。
  #    這版改成讓平台認得 20260102(它在 repo、不在人帳 ⇒ ③,不是⑦)⇒ ② 被單獨隔離。
  B=$(mk red2)
  printf '   20260101000000 |                | t \n   20260102000000 | 20260102000000 | t \n' >> "$B/platform.txt"
  ck "B 該紅②(隔離:無⑦)⇒ 3" "$(run "$B")" "3"
  ck "B 有印出【具體是哪一支】" "$(has x '20260101000000')" "yes"
  ck "B 沒有混進⑦(單一紅因)" "$(has x '平台孤兒')" "no"
  # 🔴 R3(W3)M3 撈到:**沒有任何一格釘住使用者看到的那句訊息** ——
  #    把「🔴 ⑦ 平台孤兒」改成任何字,18 格照樣全過。而那是這條路上唯一給人看的東西
  #    (`docs/runbooks/hook-exit-codes-what-you-see.md` 的整個前提就是「人讀訊息、不讀 code」)。
  #    ⇒ 只釘**承載動作的那幾個字**,不釘整句 —— 措辭還要能改,而「叫他別做什麼」不能消失。
  #    ⚠️ 第一版我釘的是 `db push` / `孤兒` 這種**在輸出裡出現不只一次**的字 ——
  #       改掉其中一處,另一處還在 ⇒ 那一格照樣綠(當場用 M3 的突變試出來的)。
  #       ⇒ 釘的字必須在輸出裡**只出現一次**,否則它量的是「還有沒有別處提到」。
  ck "B 標題列【🔴 ② 危險】在(輸出裡唯一)" "$(has x '🔴 ② 危險')" "yes"
  #    (不寫 `--status applied`:那個前導 `--` 會被我的 has 助手當成 grep 的選項終止符,
  #     第一版就是這樣白紅了一格。改釘不帶 dash 的等價字串。)
  ck "B 修法列【status applied】在" "$(has x 'status applied')" "yes"

  # C【該紅·只有⑦】平台多一個孤兒號,其餘三方一致
  C=$(mk red7)
  printf '20260102000000\tsha\t2026-01-02\tme\n' >> "$C/applied.tsv"
  printf '   20260101000000 | 20260101000000 | t \n   20260102000000 | 20260102000000 | t \n                  | 20269999999999 | t \n' >> "$C/platform.txt"
  ck "C 該紅⑦ ⇒ 3" "$(run "$C")" "3"

  # ══ 🔵 P/Q【2026-09-05 -f8 裁:② 在推 main 那條路上降成警告】兩個世界 ══
  #   🔴 這兩格要證的**不是**「rc 變了」, 而是【降的只有 ②, ⑦ 一格都沒動】。
  #      ⇒ 📌 只驗「只有② ⇒ 0」的話, 一個把 rc 無條件寫成 0 的改動也會通過。
  # 🔴 **不能寫成 `PCM_LEDGER_SOFT_C2=1 compare …`** —— `SOFT_C2` 在檔頭就從環境讀完了,
  #    之後再改那個環境變數對它沒有作用。⇒ 直接設 `SOFT_C2` 本身, 而**用完要還原** ——
  #    📌 POSIX sh 裡「函式呼叫前的賦值」會【留下來】, 不還原的話下面每一格都變成軟化的,
  #      而那會讓 P 的負對照與 B/C 那幾格靜靜地測到另一個世界。
  runsoft() {
    _prev="$SOFT_C2"; SOFT_C2=1
    compare "$1/migrations" "$1/applied.tsv" "$1/platform.txt" "" > "$T/out" 2>&1
    _r=$?; SOFT_C2="$_prev"; echo "$_r"
  }

  # P【只有② + 軟化】⇒ 期望 rc 0, 而且要印得出「本路徑不擋」
  P=$(mk soft2)
  printf '   20260101000000 |                | t \n   20260102000000 | 20260102000000 | t \n' >> "$P/platform.txt"
  ck "P 軟化:只有② ⇒ 0(不擋)" "$(runsoft "$P")" "0"
  ck "P 印得出【本路徑不擋】" "$(has x '本路徑不擋')" "yes"
  # 🔴 而它不可以把 ② 從輸出裡藏掉 —— 不擋 ≠ 不說
  ck "P 仍然印得出 ② 那幾支" "$(has x '② 警告')" "yes"
  ck "P 不可以印成 🔴 ② 危險(那是擋的那一版)" "$(has x '🔴 ② 危險')" "no"
  # 🔵 同一份 fixture 不軟化 ⇒ 必須回到 3 ⇒ 這一格證明上面那個 0 是【軟化造成的】
  ck "P 負對照:同一份不軟化 ⇒ 3" "$(run "$P")" "3"

  # Q【有⑦ + 軟化】⇒ ⑦ 一格都沒動, 仍然要擋
  Q=$(mk soft7)
  printf '   20260101000000 | 20260101000000 | t \n   20260102000000 | 20260102000000 | t \n   20990909090909 | 20990909090909 | t \n' >> "$Q/platform.txt"
  ck "Q 軟化:有⑦ ⇒ 仍然 3" "$(runsoft "$Q")" "3"
  ck "Q 印得出【🔴 ⑦ 平台孤兒】" "$(has x '🔴 ⑦ 平台孤兒')" "yes"
  ck "C 沒有混進②(單一紅因)" "$(has x '② 危險')" "no"
  ck "C 標題列【🔴 ⑦ 平台孤兒】在(輸出裡唯一)" "$(has x '🔴 ⑦ 平台孤兒')" "yes"

  # D【量具壞了】平台檔在但沒有表頭 ⇒ 量不到(**覆寫**而不是追加:mk() 已經寫了表頭)
  D=$(mk broken); printf '   (連不上)\n' > "$D/platform.txt"
  ck "D 找不到 Remote 表頭 ⇒ 量不到=1,不是乾淨=0" "$(run "$D")" "1"

  # D2【分得開的另一半】表頭在、資料 0 列 ⇒ 這是「平台真的是空的」= 全部對不上 = 3,不是 1
  # 🔴 D 與 D2 的輸入只差一行表頭,而結論相反 —— 這一對就是「量不到 vs 真的沒有」的判別式。
  D2=$(mk emptyplat)
  ck "D2 表頭在但 0 列 ⇒ 真的全對不上=3,不是量不到=1" "$(run "$D2")" "3"

  # E【量具壞了】拿不到平台帳本
  compare "$A/migrations" "$A/applied.tsv" "$T/nope.txt" "" >/dev/null 2>&1
  ck "E 拿不到平台帳本 ⇒ 1" "$?" "1"

  # F【最壞的失效方向】平台欄位換位(多一個 Status 欄)⇒ 不可把 Local 當 Remote
  F=$(mk shifted)
  printf '   Status | Local | Remote | Time\n  ---|---|---|---\n   applied | 20260101000000 |                | t \n' > "$F/platform.txt"
  ck "F 欄位換位:不可誤把 Local 當 Remote ⇒ 仍判②=3" "$(run "$F")" "3"

  # G【BOM】人帳本第一列帶 BOM,那一列不可以消失
  G=$(mk bom)
  printf '\357\273\27720260101000000\tsha\t2026-01-01\tme\n' > "$G/applied.tsv"
  printf '   20260101000000 |                | t \n   20260102000000 | 20260102000000 | t \n' >> "$G/platform.txt"
  ck "G 第一列帶 BOM 仍要判②=3(不可漏擋)" "$(run "$G")" "3"

  # H【檔名形狀不對】混一支不是 14 位數字的 ⇒ 量具壞了,不可靜默略過
  Hd=$(mk oddname); : > "$Hd/migrations/999_bad.sql"
  printf '   20260101000000 | 20260101000000 | t \n   20260102000000 | 20260102000000 | t \n' >> "$Hd/platform.txt"
  ck "H 檔名不是 14 位數字 ⇒ 1(不靜默消失)" "$(run "$Hd")" "1"

  # I【偽造 R】造一個名叫 <版本>_x.sql 的【目錄】,不可被算成 repo 有那支檔
  I=$(mk fakedir); mkdir -p "$I/migrations/20269999999999_x.sql"
  printf '20260102000000\tsha\td\tme\n' >> "$I/applied.tsv"
  printf '   20260101000000 | 20260101000000 | t \n   20260102000000 | 20260102000000 | t \n                  | 20269999999999 | t \n' >> "$I/platform.txt"
  ck "I 目錄不可冒充 .sql 檔 ⇒ 仍判⑦=3" "$(run "$I")" "3"

  # J【用法錯】多餘參數
  sh "$0" --selftest --bogus >/dev/null 2>&1
  ck "J 多餘參數 ⇒ 2" "$?" "2"

  # L【該紅·人帳本形狀】人帳本混一列不是「14 位數字 + TAB」⇒ 量具壞了,不可靜默略過
  #    🔴 codex R2:上一版只造了 malformed R ⇒ 把 n_odd_H 那道判定整條刪掉,selftest 照樣全過。
  L=$(mk oddh); printf 'B1-a\t這一列沒有版本號\n' >> "$L/applied.tsv"
  printf '   20260101000000 | 20260101000000 | t \n   20260102000000 | 20260102000000 | t \n' >> "$L/platform.txt"
  ck "L 人帳本有非 14 位數字的列 ⇒ 1(不靜默消失)" "$(run "$L")" "1"

  # M【該紅·平台形狀】平台的 Remote 欄混一列 15 位數 ⇒ 孤兒號會靜默消失、⑦ 少報
  M=$(mk oddp)
  printf '20260102000000\tsha\td\tme\n' >> "$M/applied.tsv"
  printf '   20260101000000 | 20260101000000 | t \n   20260102000000 | 20260102000000 | t \n                  | 202699999999999 | t \n' >> "$M/platform.txt"
  ck "M 平台 Remote 欄非 14 位數字 ⇒ 1(不靜默消失)" "$(run "$M")" "1"

  # K【誤紅防線】pushmain 模式讀的是 git 樹,而 migrations/ 裡常有伴生檔(README / .impeccable)。
  # 🔴 那些檔不該被算成「檔名形狀不對」⇒ 否則**一支說明檔就能讓推 main 無故被擋**。
  #    這一格造一個真的 git repo 來走 read_R 的 git 那條路,與工作樹那條分母必須一致。
  K="$T/gitworld"; mkdir -p "$K/supabase/migrations"
  : > "$K/supabase/migrations/20260101000000_x.sql"
  printf 'readme\n' > "$K/supabase/migrations/README.md"
  printf '# c\n20260101000000\tsha\t2026-01-01\tme\n' > "$K/supabase/APPLIED.tsv"
  printf '   Local | Remote | Time\n   20260101000000 | 20260101000000 | t \n' > "$K/platform.txt"
  k_rc=$(
    cd "$K" \
      && git init -q . >/dev/null 2>&1 \
      && git config user.email w5@x && git config user.name w5 \
      && git add -A >/dev/null 2>&1 \
      && git commit -qm k >/dev/null 2>&1 \
      && { compare "" "" "$K/platform.txt" "$(git rev-parse HEAD)" >/dev/null 2>&1; echo $?; }
  )
  ck "K 讀 git 樹時,伴生檔(README.md)不可造成誤紅 ⇒ 0" "$k_rc" "0"

  # N【該紅·symlink 冒充】🔴 codex R2 must-fix:**symlink 的 objecttype 也是 blob**
  #    ⇒ 在 git 樹裡放一支名叫 `<孤兒版本>_x.sql` 的 symlink,就能把 ⑦ 降成 ③ 而 exit 0。
  #    這一格造那個 symlink,結果必須仍然是 ⑦=3。
  N="$T/symworld"; mkdir -p "$N/supabase/migrations"
  : > "$N/supabase/migrations/20260101000000_x.sql"
  ( cd "$N/supabase/migrations" && ln -s 20260101000000_x.sql 20269999999999_x.sql )
  printf '# c\n20260101000000\tsha\t2026-01-01\tme\n' > "$N/supabase/APPLIED.tsv"
  printf '   Local | Remote | Time\n   20260101000000 | 20260101000000 | t \n                  | 20269999999999 | t \n' > "$N/platform.txt"
  n_rc=$(
    cd "$N" \
      && git init -q . >/dev/null 2>&1 \
      && git config user.email w5@x && git config user.name w5 \
      && git add -A >/dev/null 2>&1 \
      && git commit -qm n >/dev/null 2>&1 \
      && { compare "" "" "$N/platform.txt" "$(git rev-parse HEAD)" >/dev/null 2>&1; echo $?; }
  )
  ck "N symlink 不可冒充 migration ⇒ 仍判⑦=3" "$n_rc" "3"

  # ── ⑨【刻意不套用】那一格:兩個世界 + 兩發突變 ────────────────────────
  # 🔴 為什麼要兩個世界:只驗「有標記的變 ⑨」會讓另外那 23 支消失而沒有人發現。
  #    ⇒ ⑨ 是從 ④ 裡【拉出來】的, 所以 ④ 剩下什麼也要被釘住。
  O1=$(mk never1)
  printf '   20260101000000 | 20260101000000 | t \n   20260102000000 |                | t \n' >> "$O1/platform.txt"
  # 20260102 在 repo、不在人帳、不在平台 ⇒ 本來是 ④;給它標記 ⇒ 應該變 ⑨
  printf -- '-- pcm:never-apply\nSELECT 1;\n' > "$O1/migrations/20260102000000_x.sql"
  # 🔴 `$(run X; has …)` 會把 run 的 rc 與 has 的答案**串起來**(拿到 "0\nyes")
  #    ⇒ 分兩步:先 run(它把輸出寫進 $T/out), 再 has。第一版就是這樣白紅四格的。
  o1rc=$(run "$O1")
  ck "O1 仍然該綠(⑨ 不是紅)⇒ 0" "$o1rc" "0"
  ck "O1 帶標記那支 ⇒ 印⑨" "$(has x '⑨ 刻意不套用')" "yes"
  ck "O1 有印出【具體是哪一支】" "$(has x '20260102000000')" "yes"

  # 🧬 突變一:把標記拿掉 ⇒ 它必須掉回 ④(⑨ 那一行整個不見)
  printf 'SELECT 1;\n' > "$O1/migrations/20260102000000_x.sql"
  run "$O1" > /dev/null
  ck "🧬 拿掉標記 ⇒ ⑨ 消失" "$(has x '⑨ 刻意不套用')" "no"

  # ── ⑩【目標已達成 ⇒ 目前不需要貼】那一格:四個世界(-15 規格 ④-2)──────────
  # 🔴 而它與 ⑨ 的差別不是分類:⑨ 結構上永遠不會變成「要貼」, 而 ⑩【會】
  #    ⇒ 所以它必須帶一句可執行的複查方法, 而**沒帶就不算合法標記**。
  P1=$(mk notneed1)
  printf '   20260101000000 | 20260101000000 | t \n   20260102000000 |                | t \n' >> "$P1/platform.txt"
  printf -- '-- pcm:not-needed-now: 跑 scripts/zzq-check.sh, 綠就仍不需要\nSELECT 1;\n' > "$P1/migrations/20260102000000_x.sql"
  p1rc=$(run "$P1")
  ck "P1 合法標記 ⇒ 不紅" "$p1rc" "0"
  ck "P1 ⇒ 印⑩" "$(has x '⑩ 目標已達成')" "yes"
  ck "P1 ⇒ **把複查方法原文印出來**(否則它就只是另一個分類)" "$(has x 'zzq-check.sh')" "yes"
  ck "P1 ⇒ 不該印⑨(兩格要分得開)" "$(has x '⑨ 刻意不套用')" "no"

  # 🧬 (a) 冒號後面清空 ⇒ **必須出聲**且那支回到 ④ —— 不可以安靜地當它不存在
  #    📌 少了這一格, 一個打錯的標記與一支【真的待套】的檔印同一個結果。
  printf -- '-- pcm:not-needed-now:\nSELECT 1;\n' > "$P1/migrations/20260102000000_x.sql"
  pa=$(run "$P1")
  ck "🧬 a 理由空 ⇒ 出聲說標記不完整" "$(has x '標記不完整')" "yes"
  ck "🧬 a 理由空 ⇒ 不算⑩" "$(has x '⑩ 目標已達成')" "no"
  ck "🧬 a 理由空 ⇒ rc 非 0" "$([ "$pa" != "0" ] && echo yes || echo no)" "yes"

  # 🔴 (a2) 理由裡的路徑【不在版控裡】⇒ 不算合法(-15 收窄:判準是 git cat-file 不是 test -e)
  #   📌 而它比空白難發現:空白會被「非空」那一格擋下, 而**一個指到空氣的路徑會通過那一格**。
  printf -- '-- pcm:not-needed-now: 唯讀跑 docs/probes/zzq-no-such-probe.sql\nSELECT 1;\n' > "$P1/migrations/20260102000000_x.sql"
  pa2=$(run "$P1")
  ck "🧬 a2 路徑不在版控 ⇒ 報【複查方法指到】" "$(has x '複查方法指到')" "yes"
  ck "🧬 a2 路徑不在版控 ⇒ 不算⑩" "$(has x '⑩ 目標已達成')" "no"

  # 🔵 (a3) **理由裡沒有路徑 ⇒ 不驗路徑, 而【不是】判紅** —— 這一格最容易漏。
  #   🎯 規格要的是【可執行的複查方法】, 不是【一定要是一支檔】
  #     ⇒ 少了這一格, 這道閘會逼所有人都把複查方法寫成一支檔。
  printf -- '-- pcm:not-needed-now: 唯讀查 aclexplode(relacl) 看 anon 在不在, 不在就仍不需要\nSELECT 1;\n' > "$P1/migrations/20260102000000_x.sql"
  pa3=$(run "$P1")
  ck "🔵 a3 純文字複查方法 ⇒ 仍是⑩" "$(has x '⑩ 目標已達成')" "yes"
  ck "🔵 a3 純文字複查方法 ⇒ 不報路徑錯" "$(has x '複查方法指到')" "no"
  ck "🔵 a3 純文字複查方法 ⇒ 不紅" "$pa3" "0"

  # 🧬 (b) 兩個標記同時 ⇒ 報錯, 不要挑一個(宣告矛盾要吵)
  printf -- '-- pcm:never-apply\n-- pcm:not-needed-now: 有理由\nSELECT 1;\n' > "$P1/migrations/20260102000000_x.sql"
  pb=$(run "$P1")
  ck "🧬 b 兩個標記 ⇒ 報標記矛盾" "$(has x '標記矛盾')" "yes"
  ck "🧬 b 兩個標記 ⇒ 兩格都不印(沒有被靜靜解決成其中一種)" \
     "$([ "$(has x '⑩ 目標已達成')" = no ] && [ "$(has x '⑨ 刻意不套用')" = no ] && echo yes || echo no)" "yes"

  # 🧬 (c) 帶標記而【帳本上已經有它】⇒ 報錯(標記過期 ⇒ 下一個人會以為它還沒貼)
  printf -- '-- pcm:not-needed-now: 有理由\nSELECT 1;\n' > "$P1/migrations/20260102000000_x.sql"
  printf '20260102000000\tzzqhash\t2026-01-02\tselftest\n' >> "$P1/APPLIED.tsv"
  pc=$(run "$P1")
  ck "🧬 c 標記 + 帳本有它 ⇒ 報標記過期" "$(has x '標記過期')" "yes"

  # 🔵 (d) 負對照:一支【沒有任何標記】的檔 ⇒ ④ 那格的數字不變(這一格證明上面不是恆紅)
  P2=$(mk notneed2)
  printf '   20260101000000 | 20260101000000 | t \n   20260102000000 |                | t \n' >> "$P2/platform.txt"
  printf 'SELECT 1;\n' > "$P2/migrations/20260102000000_x.sql"
  p2rc=$(run "$P2")
  ck "🔵 d 無標記 ⇒ 不紅" "$p2rc" "0"
  ck "🔵 d 無標記 ⇒ 三種標記錯誤一個都不印" \
     "$([ "$(has x '標記不完整')" = no ] && [ "$(has x '標記矛盾')" = no ] && [ "$(has x '標記過期')" = no ] && echo yes || echo no)" "yes"

  # 🧬 突變二(反向):標記放在第 25 行(超過檔頭 20 行)⇒ **不算**
  #    🔴 這一格守的是「標記是【宣告】不是【提及】」—— 少了它, 任何在中段解釋這個機制的檔
  #      都會把自己變成 never-apply。
  { i=1; while [ $i -le 24 ]; do printf -- '-- filler\n'; i=$((i+1)); done
    printf -- '-- pcm:never-apply\nSELECT 1;\n'; } > "$O1/migrations/20260102000000_x.sql"
  run "$O1" > /dev/null
  ck "🧬 標記在第 25 行 ⇒ 不算(仍不是⑨)" "$(has x '⑨ 刻意不套用')" "no"

  # 🔵 而 ④ 那一半要自己被釘住:沒有任何標記時, 待套數不可以掉
  O2=$(mk never2)
  printf '   20260101000000 | 20260101000000 | t \n   20260102000000 |                | t \n' >> "$O2/platform.txt"
  run "$O2" > /dev/null
  ck "O2 零標記 ⇒ ④ 待套 PENDING 1 還在" "$(has x '④ 待套 PENDING 1')" "yes"

  echo "  ── selftest: $pass PASS / $fail FAIL"
  # 🔴 codex R1:只驗 fail=0 ⇒ 刪掉任何一格照樣 exit 0。格數要釘死。
  # 🔴 格數守門比的是【跑過幾格】(pass+fail),不是【過了幾格】(pass)——
  #    2026-08-21 R3(W3)實測:讓某一格正確翻紅 ⇒ 17 PASS / 1 FAIL,而**格數其實還是 18**,
  #    舊寫法卻印「格數不對:有格被刪掉或沒跑到」⇒ **診斷指錯方向**,
  #    而它印在「17 PASS / 1 FAIL」之後 ⇒ 讀的人最後看到的是錯的那一句。
  #    「一格失敗」與「一格不見了」修法完全不同,不能共用同一個出口。
  # 2026-09-02:21 ⇒ **27**(⑨【刻意不套用】那一格新增 6 格:O1×3 + 兩發突變 + O2)
  #   🔵 而這道閘【自己叫了】—— 我加完格數沒改它, 它當場印「跑了 27 格 ≠ 21」。
  #      ⇒ 📌 那正是它存在的理由:**改動格數的人一定會撞到它, 而那個人正是剛動過那段碼的人。**
  # 🔴 **27 ⇒ 39**:⑩ 那一格加了 12 格(2026-09-02 `-c7` 依 `-15` 規格)——
  #    4 格正世界 + 3 格(a 理由空)+ 2 格(b 兩標記)+ 1 格(c 帳本衝突)+ 2 格(d 負對照)。
  #    🔵 **39 ⇒ 42**(同日稍晚, `-15` 收窄那一格):+2(a2 路徑不在版控)+3(a3 純文字不驗路徑)
  #       —— 而 a3 那三格守的是【這道閘不逼人把複查方法寫成一支檔】。
  #    📌 **把「為什麼從 N 變成 M」寫在數字旁邊**(規格 ④-3)—— 而它今晚已經抓到 `-15` 兩次算錯格數。
  # 🔵 44 ⇒ **51**(2026-09-05:② 在 pushmain 降警那一改, 新增 P/Q 兩個世界共 7 格)。
  #   🔴 **而這道閘【自己叫了】** —— 我改完 ② 那一段、加完 P/Q, 沒有回來改這個數字,
  #     它當場印「跑了 51 格 ≠ 44」而讓 pre-commit 紅。
  #   📌 那正是它存在的理由:**「一格失敗」與「一格不見了」修法完全不同**,
  #     而後者在「PASS 全綠」的畫面下**沒有任何其他訊號**。
  #   ⚠️ 改這個數字之前要問的是「**多的那幾格是我加的嗎**」——
  #     我這次是 44 + 7 = 51, 而那 7 格逐格列在上面 P/Q 那兩段。
  EXPECT=51
  if [ "$((pass + fail))" != "$EXPECT" ]; then
    echo "  🔴 【格數】不對:跑了 $((pass + fail)) 格 ≠ $EXPECT ⇒ 有格被刪掉或沒跑到(這不是「有格失敗」)"; exit 1
  fi
  if [ "$fail" != "0" ]; then exit 1; fi
  exit 0
fi

if [ "$MODE" = "fixture" ]; then
  echo "⚠️ FIXTURE 模式 —— 下面的數字不是正式庫的答案,不可引用" >&2
  compare "$FIXTURE/migrations" "$FIXTURE/applied.tsv" "$FIXTURE/platform.txt" ""
  exit $?
fi

# ── pre-push 掛點:只在推 refs/heads/main 時才實查 ──────────────
# 🔴 為什麼只挑 main:2026-08-21 實測 ② 有 13 支 ⇒ 若對每次 push 都擋,七個窗一步都動不了,
#    而那種閘的下場是 --no-verify 被常態化(連真的紅也一起關掉)。
#    main = 正式站,也是「會在上面跑 db push」的那條 ref ⇒ 擋在那裡是真報不是誤報。
#    量法(可重跑):sh scripts/migration-ledger-divergence.sh
# 🔴 「沒有要推 main」與「檢查過而乾淨」是兩件事 ⇒ 一定要印出是哪一種,不能靜默放行。
REV=""
if [ "$MODE" = "pushmain" ]; then
  ZERO="0000000000000000000000000000000000000000"
  hit=0
  while read -r _lref lsha rref _rsha; do
    case "${rref:-}" in refs/heads/main) ;; *) continue ;; esac
    # 刪除 main(local_sha 全 0)不會部署也不會 db push ⇒ 不擋(codex R1 nit)
    case "${lsha:-}" in "$ZERO"|"") continue ;; esac
    hit=1; REV="$lsha"
  done
  if [ "$hit" = "0" ]; then
    echo "ledger-gate: 跳過(這次推的不是 refs/heads/main,或是刪除 ref)—— 本閘沒有判準,不是「檢查過而乾淨」" >&2
    exit 0
  fi
  echo "ledger-gate: 這次推 refs/heads/main($REV)⇒ 實查平台帳本" >&2
fi

ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "🔴 不在 git repo 裡 ⇒ exit 1" >&2; exit 1; }
cd "$ROOT" || exit 1
if [ -n "$REV" ] && ! git rev-parse --verify --quiet "$REV^{commit}" > /dev/null; then
  echo "🔴 讀不到要推的那個 commit($REV)⇒ 本閘無法判斷,exit 1" >&2; exit 1
fi
if ! command -v supabase > /dev/null 2>&1; then
  echo "🔴 找不到 supabase CLI ⇒ 量不到平台帳本,exit 1(這不是「沒問題」)" >&2
  echo "   裝法:brew install supabase/tap/supabase,然後 supabase link" >&2
  exit 1
fi

# 🔴 codex R1 must-fix:只信「目前 link 到哪」= 只要有人 link 到另一個乾淨的庫,本閘就會對錯的
#    平台帳本回 0,而正式庫仍然分岔。⇒ 先驗身分,對不上就拒絕判斷。
LINKED=$(tr -d ' \n\r' < "$ROOT/supabase/.temp/project-ref" 2>/dev/null || true)
if [ "$LINKED" != "$PROD_REF" ]; then
  echo "🔴 目前 supabase link 指向 [$LINKED],不是正式庫 [$PROD_REF]" >&2
  echo "   ⇒ 對別的庫查到的「乾淨」不能拿來放行正式庫的 push,exit 1" >&2
  exit 1
fi
echo "ledger-gate: 平台帳本來源 project=$LINKED" >&2

PL=$(mktemp) || { echo "🔴 建不出暫存目錄(mktemp)⇒ 這不是量測結果, 也不是「乾淨」 ⇒ exit 9" >&2; exit 9; }
trap 'rm -f "$PL"' EXIT
if ! supabase migration list --linked < /dev/null > "$PL" 2>/dev/null; then
  echo "🔴 supabase migration list --linked 失敗(未 link / 未登入 / 連不上)" >&2
  echo "   ⇒ 量不到平台帳本,exit 1。查不到不等於沒問題 —— 那正是 #795 的病。" >&2
  exit 1
fi
compare "$ROOT/supabase/migrations" "$ROOT/supabase/APPLIED.tsv" "$PL" "$REV"
exit $?
