#!/usr/bin/env bash
# 🔴 shebang 從 `#!/bin/sh` 改成 bash(codex R3 must-fix,2026-08-29):
#    本檔是 executable。`.husky/pre-commit` 已改成用 `bash` 呼叫它,但那只管【那一條路】——
#    有人直接執行它(`./.husky/admin-dev-bypass-gate.sh`)時走的是 shebang,
#    而在 /bin/sh 是 dash 的機器上,`read -r -d ''` 會 `Illegal option -d` ⇒ 迴圈跑 0 次 ⇒ rc=0
#    ⇒ 危險行【靜默放行】。⇒ 兩條路都要指向 bash,少一條就留一個洞。
#    ⚠️ 不違反 zsh-shebang-gate:那道擋的是 `zsh`,而 `migration-post-commit-gate.sh` 早就是 env bash。
# 免登入後台指令守門(2026-08-20 立;機制優先律)
#
# 背景:`next dev` 預設綁【所有網路介面】,不是 localhost;疊上 ADMIN_DEV_BYPASS=1(免登入)
#   + 這棵樹的 .env.local 指著正式站 ⇒ 一個免登入的正式站後台對整個區網開著
#   (2026-08-19 admin-design-system.md:6-20 實測:區網 IP curl 回 200、負對照 000、開了 5 小時)。
#   修法是指令加 -H 127.0.0.1。三份文件各自抄過這串指令,只有一份記得加旗標
#   (grep -rn --include='*.md' 'next dev' docs/ 2026-08-20 實測命中 6 處,3 處是危險組合缺旗標)。
#   ⇒ 抄指令這件事會一直重演,做成機制擋新增,不再靠人記得。
#
# 判準(刻意窄,只咬危險組合,不咬所有 next dev):
#   這次 commit【新增的一行】同時含 ADMIN_DEV_BYPASS=1 與 next dev,且不含 -H 127.0.0.1 ⇒ 擋。
#   ⚠️ 不擋單獨出現 next dev(docs 裡大量在講別的事,例如拋棄式 PG 版本、pgrep 找程序名)。
#
# 🔴 2026-08-25 擴射程(Sean 拍乙;b4 量的三個洞。**這不是修壞掉的東西,原本的行為是對的**):
#   ① dev 指令族:`pnpm dev` / `npm run dev` / `yarn dev` 都會走到 `next dev`
#      (apps/admin/package.json 的 "dev" 逐字就是 "next dev")⇒ 危險完全相同,而舊字面看不見。
#   ② 值可以帶引號:shell 會把引號吃掉 —— `ADMIN_DEV_BYPASS="1"` 傳進去就是 `1`
#      (實測 `sh -c 'ADMIN_DEV_BYPASS="1" printenv ADMIN_DEV_BYPASS'` ⇒ 1),
#      而 apps/admin/src/lib/session/authorize.ts:18 比的是 `=== '1'` ⇒ bypass 真的會開。
#   ③ 順手修掉一個【既有的誤擋】:`ADMIN_DEV_BYPASS=10` 的值是 "10" ≠ '1' ⇒ bypass 不會開,
#      而舊字面 `ADMIN_DEV_BYPASS=1` 會命中它。新版加了 `([^0-9]|$)` ⇒ 不再誤擋。
#   ⚠️ 同理 `ADMIN_DEV_BYPASS=true` 也不觸發 bypass ⇒ 本閘刻意不擋它。**不是漏,是不危險。**
#
# 🔴🔴 本閘【只咬單行】—— 這是宣告過的限制,不是還沒想到:
#   `export ADMIN_DEV_BYPASS=1` 與 `next dev` 分兩行寫 ⇒ 環境變數照樣設起來,而本閘不擋。
#   要擋它需要跨行狀態,那會把這道閘變複雜;**代價與收益還沒有人量過**。
#   ⚠️ 而讀到這一行的人請注意:**一個宣告過的限制,會讓人以為沒宣告的部分也被想過了。**
#      這一句只涵蓋「分兩行」這一種,不涵蓋任何其他變形。
#
# 🔴 判定與【寫 log 那一段】用的是同一組判準,改一處必須同時改另一處(兩處都在本檔)。
#   ⚠️ 不擋「拋棄式 PG」那個安全變體(接本機拋棄式庫,不指正式站)—— 這道閘只看單行字面,
#      分不出後面接的是正式站還是拋棄式庫;若要收窄到那個粒度,拋棄式 PG 那幾處請保留
#      現有寫法(不要加 -H 也不算錯,那條路本來就低風險一級)。
#
# 🔴 分母只看【新增行】,不看整支檔(2026-08-20 修;第一版掃整支 staged 檔案內容,
#   結果 W4 只在 docs/phase-1-backlog.md 檔尾新增 52 行、零碰 :24879,卻被那行【既有的散文】
#   (「那份 runbook 走 next dev + ADMIN_DEV_BYPASS=1…」,一句解釋、不是可執行指令)擋下 ——
#   本檔自己的註解就寫著「做成機制擋新增」,而實作掃了全檔,分母比意圖寬。
#   改法:只掃 `git diff --cached -U0` 的 `+` 行,用 @@ hunk header 換算出真實行號
#   (不是 diff 位移),回報命中時印的行號要對得上檔案裡的行。
#
# 逃生門:PCM_ALLOW_ADMIN_BYPASS_LINE=1 git commit ...(commit body 寫明理由)

# ═══ 🔴 這道閘【管不到什麼】(2026-08-25 codex 兩輪實測;Sean 拍「就此收工」)═══
# 🔴🔴 **以下不是窮舉。** 這一節列的是【已經被量到】的五種, 不是【全部】——
#    而本檔自己記過那個病:**一個宣告過的限制, 會讓人以為沒宣告的部分也被想過了。**
#    ⇒ 讀到這一節請當成「已知的下界」, 不是「安全範圍的上界」。
#
# ═══ 🔴🔴 【今天可利用嗎】欄位(2026-08-29 線A 加;主視窗裁「乙 + 這一格」)═══
#    為什麼加:上面那八條全部住在同一個「已知限制」抽屜裡, 而
#    🔴 **「已知限制」與「待修」在檔頭長得一樣 —— 而只有其中一個會產生動作。**
#    ⇒ 這一欄不清空抽屜, 它讓抽屜**讀得出來**。成本八行。
#    **判準(逐條同一把)**:**有人【現在】就能寫出一行繞過它、而本閘不會叫嗎?**
#    🔴 **判不出來就寫「未查」, 不為了讓表好看填「否」** ——
#       **「未查」現在與「否」長得一樣, 而那正是這一欄要拆開的東西。**
#
#    📊 **現況分佈(2026-08-29 06:2x 更新)**:**是 5 · 否 3 · 未查 0**
#       ⛔ ~~初版是 4 / 3 / 1~~ —— 而那個【未查 1】(⑧)在 06:2x 被實跑掉了, 答案是【是】。
#       🔴 **⇒ 這一欄的價值在這裡被證實了一次**:
#          那一格在加欄位【之前】與三個「否」長得一樣, 而它其實是「是」。
#          **⇒ 八行註解, 把一個【被誤讀成安全】的洞變成看得見的。**
#       ⚠️ 而**現在未查是 0, 不代表沒有未查的東西** —— 這一節開頭逐字寫著「以下不是窮舉」。
#          **這一欄只回答【列出來的這八條】, 不回答【還有幾條沒列】。**
#
#      ①【是】分兩行寫      —— 兩行合法 shell, 誰都寫得出來, 而本閘只咬單行
#      ②【是】指令尾接符號  —— `pnpm … dev;` 是日常寫法, 不需要任何技巧
#      ③【是】賦值後接重導向 —— 執行期值確實是 1(原文實測 printenv ⇒ [1])
#      ④【否】散文誤擋      —— 誤擋方向, 不是繞過;真語料 0 行
#      ⑤【否】值帶尾空白誤擋 —— 同上, 且執行期值 `1␣` ≠ `1` 本來就不危險
#      ⑥【否】註解裡的 -H   —— 誤擋方向;真語料 0 行
#      ⑦【是】檔名含空白    —— 🔴 整支檔靜默跳過, 不用刪任何 gate 檔
#                              成因 `for f in $(git diff …)` 未加引號(:93 與 :133 兩處)
#                              修法先例現成 `migration-post-commit-gate.sh:227` 的 `-z`
#      ⑧【是】rename 被排除 —— 🔴 2026-08-29 已實跑, 而【比上面 ⑧ 那一行寫的嚴重】。
#         ⛔ ~~【未查】我沒有造出那個世界~~ 作廢 —— 拋棄式 repo 實測(gate 副本, 非真 husky 鏈):
#            R100 純 rename(已含 bypass 行的檔)        ⇒ rc=0 放行
#            🔴 R070 rename【並繼續改內容】             ⇒ rc=0 放行  ← 上面那行沒寫到的
#            ✅ 負對照 A 同內容【新增】                 ⇒ rc=1 擋下(尺是活的)
#            ⚠️ 而「改名 + 大幅改內容」git 判成 A+D 不是 R ⇒ 那一種【擋得到】
#         🔴🔴 ⇒ 擋不擋得到, 由【git 的相似度演算法】決定, 不由這道閘決定 ——
#            而那個門檻(預設 50%)不在任何人的視野裡。**那才是這一格真正的產出。**
#         📌 而上面 ⑧ 原句只寫「rename 被排除」—— 它讓人以為問題只在【純搬家】,
#            而**會真的發生的是【改名之後繼續編輯】**。
#         修法方向(未拍板, 動 .husky/ 要 Sean 批):`--diff-filter=ACMR` 並處理 R 的雙欄輸出。
#         ⚠️ 修法版**我沒跑** —— 本註解只證明洞在。
#         實跑報告 ~/pcm-mailbox/線A-實跑-免登入閘rename洞-20260829.md
#
#    ⇒ 【是】的四條(①②③⑦)照主視窗裁決進板子;【否】的三條留在本抽屜;
#      🔴 【未查】的 ⑧ **既不進板子也不算安全** —— 它等一發實跑。
#    ⚠️ 而 ①②③ 的共同根因原文自己寫了:**用【字面近似】shell 的剖析語意,
#      而同一個指令有無限多種拼法** ⇒ **它們不是三個 bug, 是同一個天花板的三個樣本。**
#      ⇒ 進板子時要寫成【一列】, 不是三列 —— 否則板子會多兩列而缺口沒有多兩個。
#
# 根因(五條共用一個):**本閘用【字面近似】shell 的剖析語意, 而同一個指令有無限多種拼法。**
#    第一輪修 3 條 ⇒ 第二輪生出 6 條, 其中 5 條是修法本身帶進來的 ⇒ 已停手, 不再加碼。
#
# ① 分兩行寫    `export ADMIN_DEV_BYPASS=1` 與 dev 指令各一行 ⇒ 環境變數照樣設起來, 本閘只咬單行
# ② 指令尾接符號 `pnpm --filter @pcm/admin dev;` / `dev>/dev/null`
#                成因:判準要求 dev 後面是空白或行尾 ⇒ `;` `>` 都不算
# ③ 賦值後接重導向 `ADMIN_DEV_BYPASS=1>/dev/null pnpm … dev`
#                成因同②(執行期值【確實是 1】, 實測 printenv 導 stderr ⇒ [1])
# ④ 散文誤擋    `ADMIN_DEV_BYPASS=1 … pnpm does not run admin dev`
#                成因:dev 指令族允許中間夾任意 token ⇒ 散文可能被讀成指令
#                ⚠️ 真語料實測命中 **0 行**(2026-08-25;分母 = 全部 git 追蹤檔)
# ⑤ 值帶尾空白誤擋 `ADMIN_DEV_BYPASS='1 ' pnpm dev`(執行期值是 `1␣` ≠ `1`, 不危險而被擋)
#                ⚠️ 真語料實測命中 **0 行**
# ⑥ 註解裡的 -H  `ADMIN_DEV_BYPASS=1 pnpm dev # -H 127.0.0.1` ⇒ shell 不把註解當參數, 而本閘被那串字騙過
#                ⚠️ 真語料裡【# 之前那段本身是可執行指令】的 ⇒ **0 行**;已開 backlog
# ⑦ 檔名含空白 / 非 ASCII ⇒ 整支檔不被掃(成因:`for f in $(git diff --cached --name-only)` 未加引號)
# ⑧ rename(`Rxxx`)被 `--diff-filter=ACM` 排除
# ⚠️ ⑦⑧ 與 ①-⑥ 不同:**它們在 2026-08-25 改動之前就存在**, 不是這次擴射程帶進來的。
# ⚠️ ⑦⑧ 與 ② ③ 之中, 有四條是**照 codex 原句轉錄、我未獨立實測**(見交件檔), 引用前請自己跑。
#
# 📌 而【已知誤擋】現況:真語料 2 行(docs/runbooks/…:708 的反例示範、docs/specs/…:69 的散文),
#    兩行在改動前的原版也擋 ⇒ 本次改動對真語料是【純減少誤擋】(原版 10 → 現行 6 → 只算版控裡的 2)。


set -e

# 🔴 dev 指令族的【單一定義】—— 判定與寫 log 兩處共用同一個變數。
#    2026-08-25 codex 對抗審查 must-fix:原本兩處各寫一份字面, 實測會分岔
#    (`ADMIN_DEV_BYPASS=""1 pnpm dev` grep 漏而 awk 命中;`="1"0` 反過來)。
#    ⇒ 不是「兩處要記得同步」, 是【根本不要有第二份】。
#    涵蓋 pnpm/npm/yarn 帶中間參數的寫法:`pnpm --filter admin dev`、`npm --prefix … run dev`。
DEV_CMD_RE='(next[[:space:]]+dev|(pnpm|npm|yarn)([[:space:]]+(-{1,2}[^[:space:]]+|[a-zA-Z0-9@/._-]+))*[[:space:]]+dev([[:space:]]|$))'
# 🔴 空字串在 awk 的 `~` 裡是【恆真】(實測:awk -v devre="" '{if($0~devre)…}' ⇒ 匹配一切)
#    ⇒ 若有人刪掉上面那行, 寫 log 那段會記下每一個新增行, 而【判定那段會一行都不擋】。
#    兩個方向都錯, 而都不會報錯 ⇒ 這裡 fail-closed。
[ -n "$DEV_CMD_RE" ] || { echo "🔴 admin-dev-bypass-gate: DEV_CMD_RE 是空的 ⇒ 擋下(不放行)" >&2; exit 1; }

[ "${PCM_ALLOW_ADMIN_BYPASS_LINE:-}" = "1" ] && {
  echo "⚠ 免登入後台指令守門被 PCM_ALLOW_ADMIN_BYPASS_LINE=1 略過 —— 請在 commit body 寫明理由" >&2
  exit 0
}

HITS=""
# 🔴 兩處修正(Sean 2026-08-29 拍 Q-ACMR=甲；線A 實測、線G 複驗五個世界)：
#   ① ACM ⇒ ACMR：rename 原本整個被排除 ⇒「把檔案改個名字」就繞過本閘
#      ⚠️ 本閘用 --name-only ⇒ 輸出【不含狀態欄】⇒ 舊註解顧慮的「R 的雙欄輸出」不會發生
#   ② for f in $(…) ⇒ -z + while read：未加引號會詞分割 ⇒ 含空白的檔名被切成兩段而漏掉
#      成因與 ① 無關，ACMR 解不掉它，兩個要分開修
#   🔴 導檔而不是管線：HITS 要留在本 shell，管線會讓 while 跑在子 shell ⇒ HITS 出不來 ⇒ 恆放行
#   🔴 而【用 NUL 分隔 + bash】——不是 POSIX 的 tr(codex R1/R2 兩輪 must-fix,2026-08-29):
#      R1:`read -d ''` 是 bashism,而本檔原本由 `sh` 執行 ⇒ dash 實測 `read: Illegal option -d`
#         ⇒ 迴圈跑 0 次 ⇒ rc=0 ⇒ 危險行【靜默放行】。
#      R2:改成 POSIX 的 `tr` 之後,【檔名含換行】會被切成兩個不存在的路徑
#         ⇒ 兩次 cat-file 都跳過 ⇒ 【一樣靜默放行】。⇒ 換一個洞,不是修好。
#      ⇒ 結論:改【呼叫殼】不改判準 —— `.husky/pre-commit` 已改成 `bash` 執行本檔
#         (與 `migration-post-commit-gate` 同款)。NUL 分隔是唯一精確的形狀。
#   🔴 暫存檔用 mktemp(codex R2 nit:可預測路徑的 `>` 會跟隨預先建立的 symlink)
#   🔴 trap 要【自己 exit 1】—— 只清檔不 exit,收到 TERM 後 shell 會繼續往下跑而 rc=0
#      (codex R2 must-fix)。本閘的預設方向永遠是【擋】。
_LIST1="$(mktemp "${TMPDIR:-/tmp}/adbg-XXXXXX")" || {
  echo "🔴 admin-dev-bypass-gate:mktemp 失敗 ⇒ 擋下(不放行)" >&2; exit 1; }
trap 'rm -f "$_LIST1"' EXIT
trap 'rm -f "$_LIST1"; echo "🔴 admin-dev-bypass-gate:被中斷 ⇒ 擋下(不放行)" >&2; exit 1' HUP INT TERM
git diff --cached --name-only --diff-filter=ACMR -z > "$_LIST1" || {
  echo "🔴 admin-dev-bypass-gate:git diff --cached 失敗 ⇒ 擋下(不放行)" >&2
  exit 1; }
while IFS= read -r -d '' f; do
  # 本檔自己會在註解/程式碼裡字面提到這兩個字串(它就是在檢查它們)⇒ 排除自己,不然會擋自己
  [ "$f" = ".husky/admin-dev-bypass-gate.sh" ] && continue
  # 只看仍存在於 index 的文字檔;二進位/已刪檔跳過
  git cat-file -e ":$f" 2>/dev/null || continue
  ADDED=$(git diff --cached -U0 --no-ext-diff --no-textconv -- "$f" | awk '
    /^@@/  { match($0, /\+[0-9]+/); line = substr($0, RSTART+1, RLENGTH-1) + 0; next }
    /^\+\+\+/ { next }
    /^\+/  { print line ":" substr($0, 2); line++; next }
  ')
  # 🔴 判準三段(順序有意義):① 去引號後【值精確等於 1】② 會跑到 admin 的 dev script
  #    ③ 沒有 -H —— 🔴 **三段全部對【去引號後】的字串判**
#       ⚠️ 這一句在 2026-08-25 較早的版本裡寫的是「第③段刻意用【原始行】而非去引號後的」——
#          **那句話後來變成假的, 而讓它變假的是同一天稍晚的一次修正。** 保留這行說明, 是因為
#          光看現在的碼看不出來它曾經是另一個樣子, 而讀舊 commit 的人會撞到那句舊註解。
#       成因(codex R2 must-fix, 已折):awk 那側原本用【原始行】檢查 -H ⇒
#          餵 `ADMIN_DEV_BYPASS=1 pnpm dev -H 127'.0.0.1'`(執行期【真的有綁】127.0.0.1, 是安全指令)
#          ⇒ 判定鏈去引號後看到 -H ⇒ 放行;awk 用原始行看不到 ⇒ 記進 .gate-blocks.log
#          ⇒ **一條安全指令被記成擋案。兩處分岔。**
#       判哪一邊對, 用的是【執行期行為】不是「哪個看起來合理」:
#          sh -c 'printf "args: %s\n" "$*"' _ -H 127'.0.0.1'  ⇒  args: -H 127.0.0.1
#          ⇒ 引號被 shell 吃掉 ⇒ 正解是兩處都對【去引號後】的字串判。
  LINES=$(printf '%s\n' "$ADDED" \
    | sed "s/[\"']//g" \
    | grep -E 'ADMIN_DEV_BYPASS=1([[:space:]]|$)' \
    | grep -E "$DEV_CMD_RE" \
    | grep -v -- '-H 127\.0\.0\.1' || true)
  [ -n "$LINES" ] && HITS="$HITS
$f:
$LINES"
done < "$_LIST1"

[ -z "$HITS" ] && exit 0

# 擋案簿(2026-08-20 立):每次真的擋下時,append 一行到 .husky/.gate-blocks.log
#   (.gitignore、不進 repo)。只記【發生了】,不判【是不是誤擋】——閘判不出這件事,
#   自評欄位沒有意義;分母機器記,分子留給後來的人查。寫失敗不得讓 commit 失敗。
LOG_HEAD=$(git rev-parse --short HEAD 2>/dev/null || echo unknown)
LOG_TS=$(date -u +%FT%TZ 2>/dev/null || echo unknown)
{
  # 同上兩處修正；本迴圈只寫 log、不設外層變數 ⇒ 子 shell 無妨
  git diff --cached --name-only --diff-filter=ACMR -z 2>/dev/null | while IFS= read -r -d '' f; do
    [ "$f" = ".husky/admin-dev-bypass-gate.sh" ] && continue
    git cat-file -e ":$f" 2>/dev/null || continue
    git diff --cached -U0 --no-ext-diff --no-textconv -- "$f" | awk -v ts="$LOG_TS" -v gate="admin-dev-bypass-gate" -v file="$f" -v head="$LOG_HEAD" -v devre="$DEV_CMD_RE" '
      /^@@/  { match($0, /\+[0-9]+/); line = substr($0, RSTART+1, RLENGTH-1) + 0; next }
      /^\+\+\+/ { next }
      /^\+/  {
        content = substr($0, 2)
        c2 = content; gsub(/["\047]/, "", c2)
        if (c2 ~ /ADMIN_DEV_BYPASS=1([[:space:]]|$)/ \
            && c2 ~ devre \
            && c2 !~ /-H 127\.0\.0\.1/)   # 🔴 R2:這裡必須用【去引號後】的 c2, 與判定鏈同一份輸入
                                          #    原本用 content ⇒ `-H 127'.0.0.1'`(執行期真的有綁)
                                          #    判定放行而 log 記下 ⇒ 兩處分岔。實測已修。
          print ts "\t" gate "\t" file ":" line "\t" head
        line++
        next
      }
    '
  done
} >> .husky/.gate-blocks.log 2>/dev/null || true

cat >&2 <<MSG

🔴 擋下:免登入後台指令缺 -H 127.0.0.1

  下面幾行同時有 ADMIN_DEV_BYPASS=1 與 next dev,卻沒有 -H 127.0.0.1 ——
  next dev 預設綁所有網路介面,這個組合會讓免登入的後台對整個區網開著。
  改成加上 -H 127.0.0.1,或若確定該行接的是拋棄式本機庫(非正式站)可忽略此擋。
$HITS

  真的必要(例如確定安全、要保留原字面示範一個反面案例):
    PCM_ALLOW_ADMIN_BYPASS_LINE=1 git commit ...
    並在 commit body 寫明理由

MSG
exit 1
