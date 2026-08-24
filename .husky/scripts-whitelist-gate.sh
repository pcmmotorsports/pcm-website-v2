#!/bin/sh
# scripts/ 白名單涵蓋守門(2026-08-20 W5 立;#798 洞⑤ 修法①)
#
# 🔴 為什麼這道閘不能做在 lint-staged 裡:
#   lint-staged =「staged 檔 → 比對 pattern → 跑命令」,而【漏加白名單】的定義
#   就是「這支檔比不到任何 pattern」⇒ 比不到 ⇒ 不跑 ⇒ 它結構上永遠看不見自己漏了什麼。
#   物證 = 2026-08-20 commit d7341281 時 husky 自己印的那一行:
#       → lint-staged could not find any staged files matching configured tasks.
#   兩支新檔進版控、零 pattern 命中、它照樣放行。
#   ⇒ 那不是錯誤訊息,那是它正常運作的樣子。
#   ⇒ 所以本閘【無條件跑】,不看這次 staged 了什麼。
#
# 🔴🔴 **2026-08-25 更正,上面那句的【後半】作廢**(前半仍然成立):
#   ~~所以本閘【無條件跑】,不看這次 staged 了什麼~~
#   ⇒ 現在**只擋【這顆 commit 要收的那些】**(`git diff --cached --name-only -- scripts`),
#     工作樹上未進版控的孤兒改成**印一行提醒、不擋**。
#
#   **成因(出生事故, 2026-08-25 夜)**:一支剛放進 `scripts/` 而還沒登記的新腳本,
#   讓**全隊八個窗的 commit 一起鎖死**。放檔是 A 的動作, 而被擋的是**下一個碰 pre-commit 的人**
#   ⇒ 造成它的人不會撞到它 ⇒ **對造成它的人, 這個錯是零回饋的。**
#   而本閘的訊息寫著「這是你要處理的東西」——**對造成它的窗為真, 對被擋的窗為假**
#   ⇒ 兩個窗都以為那支檔是自己的。
#
#   🔴 **而換掃描來源之前, 承重的那一題先量過了**(主視窗指定的硬條件):
#     Q:改成看 staged 之後, 上面那個 `d7341281` 物證的情境**還擋不擋得住**?
#     A:**擋得住。** 拋棄式 repo 實測(四個世界 / 7 格全 PASS,harness 見下):
#        兩支新 `.py` 已 staged 而 lint-staged 零 pattern 命中 ⇒ 新版 **rc=1**。
#     理由是**機制不同**:lint-staged 靠 **pattern 比對**(比不到就不跑 ⇒ 結構上看不見自己漏了什麼),
#     而 `git diff --cached --name-only` 是**枚舉**(不比對, 所以不會漏)。
#     ⇒ **原設計的理由沒有被丟掉, 它換了一個不會漏的載體。**
#
#   ⚠️ **而換形狀買來的洞要自己講**:未進版控的孤兒**現在沒有守門**(只有一行提醒)。
#     那正是舊設計要防的那一族 —— 我把它從【擋】降成【講】, 這是取捨不是修好。
#
#   🔴🔴 **而第一版寫的那個洞【比實際小一個】**(code-reviewer R1 抓到, 2026-08-25):
#     只看 staged 腳本 ⇒ **「白名單條目被刪掉」也變成零守門** ——
#     刪 `package.json` 的 entry、腳本一個字不動 ⇒ 舊版擋、第一版放行。**那是回歸不是取捨。**
#     ⇒ 已修:**這顆 commit 動到 `package.json` 時, 擋人的分母放大回整棵樹**(格15 釘著)。
#     ⚠️ 而那個修法**自己也有代價**:收 `package.json` 的那顆 commit 會被全樹檢查
#       ⇒ 樹上任何一支沒歸屬的腳本都會擋你。這是刻意的(改白名單的射程本來就是全樹),
#       但**它是一個新的誤擋面**, 寫在這裡讓它可被推翻。
#
#   📌 形狀:**「我買了什麼洞」這句話, 第一次寫的時候通常比實際小。**
#     ⇒ 換形狀時不要只問「舊守門搬過來了嗎」, 還要問「**舊守門守的東西有幾種形狀**」。
#
#   🔴 **而舊形狀的每一道守門都要逐條問「它搬過來了嗎」, 而其中一道【意思反過來】**:
#     舊版「掃到 0 支 ⇒ 本閘壞了」在 index 這一側變成 **「這顆 commit 沒動腳本」= 最常見的正常狀態**。
#     原樣搬 ⇒ **每一顆不動腳本的 commit 都會被判 exit 2**(2026-08-25 實測撞到)。
#     ⇒ 分母自檢已改成量**整棵樹**(它不參與擋人, 只證明枚舉機制還活著)。
#
# 🔴 本閘擋的是【漏加】,不是【沒守門】:豁免看得見,漏加看不見。
#
# ─────────────────────────────────────────────────────────────────────────────
# 🔴 這一段是【還沒有證人的宣稱】,寫在這裡免得被讀成已驗(2026-08-20 W4 指出,W5 記):
#
#   下面四道自檢宣稱「失敗時回 exit 2」。到 2026-08-20T14:xxZ 為止:
#     · 「分母是 0」            —— 沒有表演過(只表演過上游的「scripts/ 不存在 ⇒ exit 2」)
#     · 「檔名含換行」          —— 沒有表演過
#     · 「抽不出 lint-staged 區塊」—— 沒有表演過
#     · 「豁免理由空白」        —— 沒有表演過
#   ⇒ 已表演過的只有 exit 0(現況)與 exit 1(憑空多一支未列管檔,W4 與 W5 各獨立跑過)。
#   ⇒ **「它壞掉會回 2」目前是【讀 code 得到的】,不是量到的。** 誰要依賴那個 2,先去餵它一發。
#
#   ✅ **2026-08-21 已補餵,上面那段留著不改寫**(它還在證明「宣稱曾經只是註解」)。
#      證人 = `scripts/scripts-whitelist-gate.harness.sh`(拋棄式 git repo,不碰本 repo)。
#      ~~**10 格全 PASS**~~ ⇒ 🔴 **這句話本身就寫錯過兩次**:寫下時是 10, 而 harness 的
#      `EXPECT` 在 2026-08-25 之前**已經是 14**(當場 `git show HEAD:scripts/scripts-whitelist-gate.harness.sh
#      | grep EXPECT` 可重跑)⇒ **劃掉舊值時要順便訂正基線, 不是只把它劃掉。**
#      **現值:2026-08-25 起 EXPECT=47**(index-aware +7 / code-reviewer R1 +8 / 互相遮蔽 +2 / codex R1 +15 / codex R2 +1)。
#      🔴 **數法(當場重跑, 不要引用這一行)**:`grep -n '^EXPECT=' scripts/scripts-whitelist-gate.harness.sh`
#      📌 而這一行是「檔頭會對它自己說謊」的第三次 —— 格數寫死在註解裡而沒有東西在對。
#      原 10 格那一版:0×2 / 1×2 / 2×6(分母0、檔名含換行、無 lint-staged 區塊、兩個區塊、
#      豁免理由空白〔用閘的突變副本〕、不在 git repo;另兩格走 staged-index 那條讀取路徑)。
#      🔴 格數釘死在 harness 的 `EXPECT`,改格數要同時改這一行 —— 這句字面 2026-08-21
#      被 codex R2 抓到過一次(寫「八格」而實際已是 10)。
#      ⇒ 那支 harness 已掛進 package.json 的 lint-staged ⇒ 它被 staged 時會自己跑一次。
#
# 🔴 【已知擋不住】的缺口,同樣先寫出來(2026-08-20 codex R2 指出;2026-08-25 codex R2 補 ⑤⑥):
#    ~~三個~~ ⇒ **六個**(數法:數下面 ①-⑥ 的編號。這一行 2026-08-25 之前寫「三個」而底下有四條
#    —— 檔頭對它自己說謊的第 N 次, 而**沒有東西在對**)。
#   ① 白名單只驗「這一行存在」,不驗那行命令有沒有判別力 —— 寫 "true" 一樣過得了。
#   ② 豁免清單住在本檔裡,而本檔由工作樹執行 ⇒ 未 staged 的改動也會生效(package.json 已改讀 staged)。
#   ③ scan 用的枚舉若整個子目錄不可讀,可能被直接略過而不計入「讀不到」⇒ 子樹消失而自檢仍綠。
#   ④ 🔴 **它只認【逐字的路徑 key】,不懂 lint-staged 的 brace glob**(2026-08-21 W5 自己撞到):
#      在 package.json 寫 `"{a.py,b.sh}": "…"` 時,`grep -qF '"a.py":'` 找不到 ⇒ 判成「沒歸屬」而擋下。
#      ⇒ 想用 glob 去掉重複執行的人會被它擋,而**擋的理由訊息不會提到 glob** ⇒ 看起來像漏加。
#      現況處置:**進得了本閘分母的檔(.py/.js/.mjs/…)一律寫逐字 key**;glob 只用在它看不到的副檔名。
#   ⑤ 🔴 **`package.json` 不在 index 時, 它會 fallback 去讀【工作樹】那份**(見下方 `PKG_SRC`)。
#      ⇒ `git rm --cached package.json` 之後, 本閘讀的是**不會進 commit 的白名單** ⇒ 可能放行。
#      (2026-08-25 codex R2 F1 指出。**這是舊有行為, 不是 index-aware 那一片帶進來的** ——
#       `git show HEAD:.husky/scripts-whitelist-gate.sh | grep -c 'PKG_SRC="工作樹'` ⇒ 1。)
#      **未修**:改成「失敗即 exit 2」會擋掉 repo 初始化那類情境, 要先量誤擋率 ⇒ 交主視窗裁。
#   ⑥ 🔴 **「只認頂層那一個 lint-staged 區塊」這句話是假的** —— `n_blocks` 用的是
#      `grep -cE '"lint-staged"…{'`, 它**不認得 JSON 層級**;巢狀物件裡若只有一個, 它照樣算 1。
#      抽區塊的 `sed` 也可能在第一個看起來像結尾的右大括號提前停。
#      (2026-08-25 codex R2 F3。**同樣是舊有行為**:`git show HEAD:… | grep -n 'n_blocks='`
#       與現版逐字相同。)**未修**:要真的解析 JSON, 那是另一片。
# ─────────────────────────────────────────────────────────────────────────────
#
# exit 0 = 每支都有歸屬   1 = 有漏列   2 = 本閘自己壞了(輸出作廢)

LIST_ORPHANS=no
for _a in "$@"; do
  [ "$_a" = "--list-orphans" ] && LIST_ORPHANS=yes
done

set -u
ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || {
  printf '%s\n' "🔴 scripts-whitelist-gate:git rev-parse 失敗 ⇒ 本閘無法判斷,exit 2(不放行)" >&2
  exit 2
}
cd "$ROOT" || {
  printf '%s\n' "🔴 scripts-whitelist-gate:cd 失敗 ⇒ exit 2" >&2
  exit 2
}
if [ ! -d scripts ]; then
  printf '%s\n' "🔴 scripts-whitelist-gate:scripts/ 不存在 ⇒ 分母是空的,exit 2" >&2
  exit 2
fi

TMP=$(mktemp -d) || exit 2
trap 'rm -rf "$TMP"' EXIT

# 🔴 讀【staged 的】package.json,不讀工作樹那份(codex R2 must-fix):
#    否則可以先 stage 一支新 script、再用【未 staged】的 package.json 把它遮掉 ⇒ 推上去的版本沒有白名單。
if git show :package.json > "$TMP/pkg.json" 2>/dev/null; then
  PKG_SRC="staged"
elif [ -f "$ROOT/package.json" ]; then
  cp "$ROOT/package.json" "$TMP/pkg.json"
  PKG_SRC="工作樹(package.json 未進 index)"
else
  printf '%s\n' "🔴 scripts-whitelist-gate:找不到 package.json ⇒ 本閘無法判斷,exit 2(不放行)" >&2
  exit 2
fi

# ── 豁免清單:路徑<TAB>理由。🔴 理由欄不可空,而且【下面真的會驗】。
cat > "$TMP/exempt.tsv" <<'XEOF'
scripts/scan-unbounded-queries.py	本 repo 恆 1(2026-08-20 實測 79 筆命中)⇒ 恆紅與恆綠一樣沒判別力;要進白名單得先有基線
scripts/quantifier-hook.harness.js	被驗物 ~/.claude/hooks/ 在 repo 外 ⇒ 掛上去會在別人機器/CI/重灌後誤擋,而每次都不是在講這次 commit 的事
scripts/backlog-duplicate-scan.py	🔴 正確性關鍵:零命中被讀成「沒有重號」;未接自檢
scripts/guard-coverage-map.py	🔴 正確性關鍵:「哪支檔被哪些守門看著」的答案來源;未接自檢
scripts/n3b-verbatim-check.py	🔴 正確性關鍵:逐字核對層;未接自檢
scripts/tappay-sandbox-3ds-prime-page.py	金流探針:不放行任何東西,但吐的數字會進拍板;未接自檢
scripts/tappay-sandbox-3ds-stale-url-probe.py	金流探針:同上;未接自檢
scripts/tappay-sandbox-refund-probe.py	金流探針:同上;未接自檢
scripts/tappay-sandbox-refund-probe2.py	金流探針:同上;未接自檢
scripts/regen-types-merge.py	會寫檔(產生型別);未評估
scripts/admin-probe/proxy.py	本機探針,用完即拆;非守門
scripts/storefront-probe/proxy.py	本機探針,用完即拆;非守門
scripts/storefront-probe/cors-server.py	本機探針,用完即拆;非守門
scripts/storefront-probe/overflow-ruler.mjs	量版面用;它自帶三條自檢,但不是 commit 期守門
scripts/containment-probe.mjs	一次性探針;非守門
scripts/design-mirror.mjs	design 同步用;非守門
scripts/tool-final-css.py	自檢 fixture 需要 OD 產物, 而它在 repo 外(~/Library/…/pcm-524f/)⇒ 接 lint-staged 會在別人機器與 CI 誤擋;手動跑 python3 scripts/tool-final-css.py 仍會自檢六組世界 A-F
XEOF

# 🔴 副檔名分母(codex R2 must-fix:原版只認 py/js/mjs,.cjs/.jsx/.mts/.cts 會完全隱形)。
# 🔴 -iname:大寫也算。 -type l:符號連結也算(原版 -type f 讓 symlink script 從分母消失)。
# 🔴 important(code-reviewer R1):副檔名集原本有【兩份互不相關的抄本】(這裡一份、find 的
#    -iname 一份)⇒ 飄了零訊號。改成單一來源, find 那邊改用 grep 濾同一個 regex。
EXTS='py js mjs cjs jsx mts cts'
EXTRE='\.([pP][yY]|[jJ][sS]|[mM][jJ][sS]|[cC][jJ][sS]|[jJ][sS][xX]|[mM][tT][sS]|[cC][tT][sS])$'

# ── (a) 【擋人的分母】= 這顆 commit 要收的那些(index), 不是工作樹 ──────────────
#    🔴 2026-08-25 改。成因寫在檔頭「出生事故」那段:掃工作樹 ⇒ 一支【誰都還沒收】的
#       未追蹤腳本會擋住【所有人】, 而造成它的人不會撞到它。
#    🔴 而【承重的那一題已經量過了】:改成看 index 之後, `d7341281` 那個情境**仍然擋得住**。
#       理由是機制不同 —— lint-staged 靠 pattern 比對(比不到就不跑, 結構上看不見自己漏了什麼),
#       而 `git diff --cached --name-only` 是**枚舉**(不比對, 所以不會漏)。
#       實驗:拋棄式 repo, 兩支新 .py 已 staged 而 lint-staged 零 pattern 命中 ⇒ 新版 rc=1。
# 🔴 must-fix(code-reviewer R1, 2026-08-25):**只看 staged 腳本會漏掉「白名單條目被刪」**。
#    實測:刪掉 package.json 裡某支腳本的 entry、腳本本身一個字不動
#    ⇒ 舊版 rc=1(擋)、只看 staged 的版本 rc=0(放行)⇒ **那是真的回歸, 不是取捨。**
#    ⇒ 修法:**這顆 commit 動到 package.json 時, 擋人的分母放大回【整棵樹】**。
#      理由:改白名單這個動作的射程本來就是全樹, 不是某幾支檔。
#      而它不會回到今夜那個事故 —— 那次 package.json 沒有被 staged。
# 🔴 codex:`/bin/sh` 沒有 pipefail ⇒ `git … | tr | grep` 裡 git 失敗會被吞掉,
#    而結果長得像「package.json 沒被動到」⇒ 恆綠風險。先落檔、驗 rc, 再判。
git diff --cached --name-only --diff-filter=ACMRD -z -- package.json > "$TMP/pkgchg.z" 2>"$TMP/pkgchg.err" || {
  printf '%s\n' "🔴 scripts-whitelist-gate:git diff --cached -- package.json 失敗 ⇒ exit 2" >&2
  sed 's/^/   /' "$TMP/pkgchg.err" >&2
  exit 2
}
if [ "$(tr -cd '\0' < "$TMP/pkgchg.z" | wc -c | tr -d ' ')" -gt 0 ]; then
  PKG_STAGED=yes
else
  PKG_STAGED=no
fi
git diff --cached --name-only --diff-filter=ACMR -z -- scripts > "$TMP/staged.z" 2>"$TMP/staged.err" || {
  printf '%s\n' "🔴 scripts-whitelist-gate:git diff --cached 失敗 ⇒ 本閘無法判斷,exit 2" >&2
  sed 's/^/   /' "$TMP/staged.err" >&2
  exit 2
}
n_staged_nul=$(tr -cd '\0' < "$TMP/staged.z" | wc -c | tr -d ' ')
# 🔴 codex R2 F4:grep 的 rc = 0 有命中 / 1 零命中 / **>1 它自己壞了**。
#    不分的話「grep 壞了」會長得像「這顆 commit 沒動腳本」⇒ 恆綠。
# ⚠️ **這一道【還沒有證人】**(照本檔既有慣例明寫, 不假裝驗過):
#    harness 裡**沒有**任何一格會讓這裡的 grep 回 rc>1 —— 我構造不出一個
#    「不改本檔的碼、只靠 fixture」就能讓它壞掉的世界(它讀的是 pipe, 不是檔)。
#    2026-08-25 突變實測:拿掉這個 if ⇒ **47 格一格都不紅**。
#    ⇒ 「它壞掉會 exit 2」目前是**讀 code 得到的, 不是量到的**。誰要依賴它, 先去餵它一發。
tr '\0' '\n' < "$TMP/staged.z" | grep -E "$EXTRE" > "$TMP/all.txt"
_g=$?
if [ "$_g" -gt 1 ]; then
  printf '%s\n' "🔴 scripts-whitelist-gate:副檔名篩選的 grep 回 rc=$_g ⇒ 本閘無法判斷,exit 2" >&2
  exit 2
fi
n_total_lines=$(tr '\0' '\n' < "$TMP/staged.z" | grep -cE '.' )

# ── (b) 【量具自檢用的分母】= 整棵樹。它**不參與擋人**, 只證明枚舉機制還活著 ─────
#    🔴 舊版把「整棵樹掃到 0 支」當成「本閘壞了」。那條**不能原樣搬過來** ——
#       在 index 這一側, 「0 支」= 這顆 commit 沒動腳本 = **最常見的正常狀態**。
#       (2026-08-25 實測:原樣搬 ⇒ 每一顆不動腳本的 commit 都被判 exit 2。)
# 🔴 must-fix(code-reviewer R1):原本用 `-print`(非 `-print0`)且**沒有計數交叉檢查**
#    ⇒ 工作樹有含換行的檔名時, 它會把一支檔印成兩行假檔名、n_tree 多算, 而**不會出聲**。
#    (舊版對這個形狀是 exit 2 的 ⇒ 這一道守門搬運時漏了, 現在補回來。)
find scripts \( -type f -o -type l \) -print0 > "$TMP/tree.z" || {
  printf '%s\n' "🔴 scripts-whitelist-gate:find 失敗 ⇒ exit 2" >&2
  exit 2
}
n_tree_nul=$(tr -cd '\0' < "$TMP/tree.z" | wc -c | tr -d ' ')
n_tree_lines=$(tr '\0' '\n' < "$TMP/tree.z" | grep -cE '.')
tr '\0' '\n' < "$TMP/tree.z" | grep -E "$EXTRE" > "$TMP/tree.txt"
n_tree=$(wc -l < "$TMP/tree.txt" | tr -d ' ')

# 🔴 codex must-fix 1+2(2026-08-25):第一版放大到【工作樹】—— **方向錯了**。
#    漏擋:stage 刪白名單 + 工作樹刪掉那支腳本但【不 stage 刪檔】
#      ⇒ find 看不到它 ⇒ 放行, 而這顆 commit 實際上保留了那支腳本、只刪了它的白名單。
#    誤擋:任何 package.json 改動(升版 / 依賴 / 無關 script)都會讓**未追蹤孤兒**重新擋住別人
#      ⇒ 那是部分重演八窗事故。
#    ⇒ 放大的對象是【index 的全樹】(這顆 commit 最後會長什麼樣), 不是工作樹。
#      `git ls-files` 讀的就是 index ⇒ staged 刪除的檔不在裡面、未追蹤孤兒也不在裡面。
if [ "$PKG_STAGED" = yes ]; then
  git ls-files -z -- scripts > "$TMP/idx.z" 2>"$TMP/idx.err" || {
    printf '%s\n' "🔴 scripts-whitelist-gate:git ls-files -- scripts 失敗 ⇒ exit 2" >&2
    sed 's/^/   /' "$TMP/idx.err" >&2
    exit 2
  }
  # 🔴 codex R2 F2:`git ls-files -z` 選對了, 而**後面 `tr` 又把安全性破壞掉**。
  #    含換行的路徑會被拆成兩個假檔名, 而現有兩道換行自檢量的是【工作樹】與【staged diff】,
  #    **不是這一份 idx.z** —— 而它才是全樹模式下真正拿來擋人的那份。
  n_idx_nul=$(tr -cd '\0' < "$TMP/idx.z" | wc -c | tr -d ' ')
  n_idx_lines=$(tr '\0' '\n' < "$TMP/idx.z" | grep -cE '.')
  if [ "$n_idx_nul" != "$n_idx_lines" ]; then
    printf '%s\n' "🔴 自檢 FAIL:index 檔數 $n_idx_nul 與展開行數 $n_idx_lines 不等 ⇒ 有檔名含換行,逐行比對會漏擋" >&2
    exit 2
  fi
  tr '\0' '\n' < "$TMP/idx.z" | grep -E "$EXTRE" > "$TMP/all.txt"
  SCOPE="index 全樹(這顆 commit 動了 package.json ⇒ 白名單的射程是全樹)"
else
  SCOPE="這顆 commit 收的腳本"
fi
# 🔴 codex R2 F5:~~`n_files` / `n_lines`~~ 兩個賦值**沒有任何後續用途**(拿掉行為不變)
#    ⇒ 已刪。留著會讓讀的人以為換行自檢還在用它們。

# 🔴 只認【頂層那一個】lint-staged 區塊(codex R2 must-fix:巢狀同名區塊可以偽造白名單)。
n_blocks=$(grep -cE '"lint-staged"[[:space:]]*:[[:space:]]*\{' "$TMP/pkg.json")
sed -n '/"lint-staged"[[:space:]]*:[[:space:]]*{/,/^[[:space:]]*}/p' "$TMP/pkg.json" > "$TMP/ls.txt"
n_ls=$(wc -l < "$TMP/ls.txt" | tr -d ' ')

n_total=0
n_white=0
n_exempt=0
: > "$TMP/missing.txt"
while IFS= read -r f; do
  [ -n "$f" ] || continue
  n_total=$((n_total + 1))
  if grep -qF "\"$f\":" "$TMP/ls.txt"; then
    n_white=$((n_white + 1))
  elif cut -f1 "$TMP/exempt.tsv" | grep -qxF "$f"; then
    n_exempt=$((n_exempt + 1))
  else
    printf '%s\n' "$f" >> "$TMP/missing.txt"
  fi
done < "$TMP/all.txt"

# ── 焊死的自檢:任一 FAIL ⇒ exit 2(與「乾淨」分得開) ────────────
bad=0
# 🔴 分母自檢改量【整棵樹】—— staged 那一側是 0 是正常的, 樹上是 0 才是量具壞了。
if [ "$n_tree_nul" != "$n_tree_lines" ]; then
  printf '%s\n' "🔴 自檢 FAIL:工作樹檔數 $n_tree_nul 與展開行數 $n_tree_lines 不等 ⇒ 有檔名含換行,逐行比對會漏擋" >&2
  bad=1
fi
if [ "$n_tree" -lt 1 ]; then
  printf '%s\n' "🔴 自檢 FAIL:分母是 0(整棵 scripts/ 掃不到任何腳本)⇒ 枚舉機制壞了,不是 repo 乾淨" >&2
  bad=1
fi
# 🔴 檔名含換行:`-z` 之下 NUL 的個數才是真檔數;換成 \n 之後的行數會多出來。
#    (舊版比的是 find 的兩種數法;搬過來時**比對對象換了**, 所以這一條要重寫不是照抄。)
if [ "$n_staged_nul" != "$n_total_lines" ]; then
  printf '%s\n' "🔴 自檢 FAIL:staged 檔數 $n_staged_nul 與展開行數 $n_total_lines 不等 ⇒ 有檔名含換行,逐行比對會漏擋" >&2
  bad=1
fi
if [ "$n_blocks" != "1" ]; then
  printf '%s\n' "🔴 自檢 FAIL:package.json 裡開了 $n_blocks 個 lint-staged 區塊(該 1)⇒ 比對範圍不明確" >&2
  bad=1
fi
if [ "$n_ls" -lt 2 ]; then
  printf '%s\n' "🔴 自檢 FAIL:抽不出 lint-staged 區塊 ⇒ 白名單比對沒有判別力" >&2
  bad=1
fi
# 理由欄:空字串、全空白、只有 tab 都算沒寫(codex R2 must-fix:原版只擋 "")
n_bad_reason=$(awk -F'\t' '{r=$2; gsub(/[ \t]/,"",r); if (NF<2 || r=="") c++} END{print c+0}' "$TMP/exempt.tsv")
if [ "$n_bad_reason" != "0" ]; then
  printf '%s\n' "🔴 自檢 FAIL:豁免清單有 $n_bad_reason 列沒寫理由 ⇒ 只列檔名的豁免三週後沒人知道為什麼在裡面" >&2
  bad=1
fi
if [ "$bad" != "0" ]; then
  exit 2
fi

# ── 輸出(2026-08-21 W5 重寫;成因:它擋住全隊 commit 那次,主視窗花三發還不知道是哪一支)──
# 🔴 病不是「沒印出是哪一支」——**它有印** `✗ <檔名>`,而它被埋在【16 行豁免清單】後面,
#    而且豁免清單走 stdout、`✗` 走 stderr ⇒ 在 hook 裡兩個串流混在一起。
# 🔴 修法三條,判準是「**收到紅的人下一步做什麼**」:
#    ① 綠的時候【不印】那份逐條豁免清單 —— 它是給人定期審視的,不是給每次 commit 看的
#    ② 紅的時候把 `✗` 清單印在【最後】,緊貼擋下訊息 —— 終端機是往下捲的,最後一行最顯眼
#    ③ 擋下訊息原本寫「上列檔」,而讀的人上面看到的是豁免清單 ⇒ 改成指名道姓
if [ -s "$TMP/missing.txt" ]; then
  n_missing=$(wc -l < "$TMP/missing.txt" | tr -d ' ')
  {
    printf '%s\n' ""
    printf '%s\n' "🔴 scripts-whitelist-gate 擋下:$n_total 支裡有 $n_missing 支【沒有歸屬】"
    printf '%s\n' "   (白名單 $n_white / 豁免 $n_exempt / 沒歸屬 $n_missing;package.json 讀自 $PKG_SRC)"
    printf '%s\n' ""
    # 🔴 codex must-fix 3:訊息要**依 scope 分兩套**。全樹模式下 missing 不一定是這次新增的,
    #    而固定講「就在你這顆 commit 要收的東西裡」會把本片最想消掉的 ownership 誤判帶回來。
    if [ "$PKG_STAGED" = yes ]; then
      printf '%s\n' "🔴 這顆 commit 動了 package.json(白名單的射程是全樹)⇒ 本閘檢查了 **index 裡所有腳本**。"
      printf '%s\n' "   ⚠️ 下面這幾支【不一定是你這次新增的】—— 它們可能本來就在 index 裡而一直沒歸屬。"
    else
      printf '%s\n' "🔴 這幾支就在【你這顆 commit 要收的東西】裡(2026-08-25 起本閘只看 index)。"
      printf '%s\n' "   ~~本閘掃的是工作樹~~ 已作廢 —— 那個設計會讓一支誰都還沒收的檔擋住所有人。"
    fi
    printf '%s\n' "⚠️ 而白名單那一半讀的是【staged 的 package.json】——"
    printf '%s\n' "   條目只寫進工作樹而還沒 stage 時,本閘看不到它(2026-08-21 就是這樣擋住全隊的)。"
    printf '%s\n' ""
    printf '%s\n' "   兩條路(本閘不裁定該走哪一條):"
    printf '%s\n' "   ① 接上自檢:在 package.json 的 lint-staged 加一行【逐字路徑】白名單,命令要能在它壞掉時回非 0"
    printf '%s\n' "      🔴 本閘【驗不出】那行命令有沒有判別力 —— 寫 \"true\" 一樣過得了。那一格靠人。"
    printf '%s\n' "      🔴 而它**不懂 brace glob** —— 寫 \"{a.py,b.sh}\" 會被判成沒歸屬(見檔頭已知缺口 ④)。"
    printf '%s\n' "   ② 先不接:加進本檔的豁免清單,並寫理由(理由欄空白,本閘會直接判自己壞掉)"
    printf '%s\n' ""
    printf '%s\n' "🔴 沒有歸屬的是這幾支(這是你要處理的東西,印在最後一行是刻意的):"
    # 🔴 主視窗 2026-08-25 裁准(下手窗提案):「沒有歸屬」有【四種世界而訊息一模一樣】——
    #    ①真的沒登記 ②登記了但沒進 index ③用了 brace glob ④那支檔剛好被作者移走。
    #    ④ 與「別人幫你修好了」在畫面上是同一個綠 ⇒ 逐支印三個【兩個世界會印不同東西】的值。
    while IFS= read -r _m; do
      [ -n "$_m" ] || continue
      if [ -f "$ROOT/package.json" ] && grep -qF "\"$_m\":" "$ROOT/package.json"; then _w=有; else _w=沒有; fi
      if grep -qF "\"$_m\":" "$TMP/pkg.json"; then _s=有; else _s=沒有; fi
      if [ -e "$ROOT/$_m" ] || [ -L "$ROOT/$_m" ]; then _e=在; else _e=不在了; fi
      # 🔴 順序刻意:診斷在上、檔名在下 —— harness 格8 釘著「檔名在最後一行」,
      #    而那一格的理由是「終端機往下捲, 最後一行最顯眼」。診斷不得把檔名擠走。
      printf '%s\n' "          工作樹 package.json:$_w  ·  staged package.json:$_s  ·  檔案現在:$_e"
      if [ "$_w" = 有 ] && [ "$_s" = 沒有 ]; then
        printf '%s\n' "          ⇒ 你已經寫了但【沒有 git add package.json】。"
      elif [ "$_w" = 沒有 ] && [ "$_e" = 不在了 ]; then
        printf '%s\n' "          ⇒ 檔案已經不在工作樹了, 而它還在 index 裡 ⇒ 可能要 git rm --cached。"
      elif [ "$_w" = 沒有 ]; then
        printf '%s\n' "          ⇒ 真的沒登記(或用了 brace glob —— 本閘只認逐字路徑 key, 見檔頭缺口 ④)。"
      fi
      printf '%s\n' "      ✗ $_m"
    done < "$TMP/missing.txt"
  } >&2
  exit 1
fi

# ── 工作樹孤兒:**只提醒, 不擋**(2026-08-25 新增)────────────────────────────
#    🔴 為什麼不擋:擋它就回到今晚那個事故 —— 一支誰都還沒收的檔擋住所有人。
#    🔴 為什麼要印:不印的話, 改成 index-aware 就等於**把那一族靜靜地放掉**。
#       ⇒ 這一段是那個取捨的可見形態, 不是裝飾。
: > "$TMP/orphan.txt"
git ls-files -z -- scripts > "$TMP/tracked.z" 2>"$TMP/tracked.err" || {
  printf '%s\n' "🔴 scripts-whitelist-gate:git ls-files(孤兒比對用)失敗 ⇒ exit 2" >&2
  sed 's/^/   /' "$TMP/tracked.err" >&2
  exit 2
}
tr '\0' '\n' < "$TMP/tracked.z" > "$TMP/tracked.txt"
while IFS= read -r f; do
  [ -n "$f" ] || continue
  grep -qF "\"$f\":" "$TMP/ls.txt" && continue
  cut -f1 "$TMP/exempt.tsv" | grep -qxF "$f" && continue
  # 🔴 已追蹤而沒歸屬的**也要講**(code-reviewer R1:原本只講未追蹤的
  #    ⇒「白名單條目被刪掉」那一族在這裡也是隱形的)。標記兩種形狀, 因為處置不同。
  if grep -qxF "$f" "$TMP/tracked.txt"; then
    printf '%s\t已在版控\n' "$f" >> "$TMP/orphan.txt"
  else
    printf '%s\t未進版控\n' "$f" >> "$TMP/orphan.txt"
  fi
done < "$TMP/tree.txt"
# 🔴 綠的時候【最多兩行】—— harness 格9 釘著。孤兒提醒因此:
#    ① 印在【摘要之後】(不是之前)② 有上限 ③ 走 stderr ④ 只在真的有孤兒時印。
#    (code-reviewer R1:原本無上限又印在摘要上方 ⇒ 它會變成淹掉別人的那個。)
emit_orphans() {
  [ -s "$TMP/orphan.txt" ] || return 0
  n_orphan=$(wc -l < "$TMP/orphan.txt" | tr -d ' ')
  _cap=5
  [ "$LIST_ORPHANS" = yes ] && _cap=$n_orphan
  {
    printf '%s\n' "⚠️ 工作樹另有 $n_orphan 支腳本【沒有歸屬】(**只提醒, 沒有擋你**;列 $_cap 支):"
    head -"$_cap" "$TMP/orphan.txt" | awk -F'\t' '{printf "      · %s(%s)\n", $1, $2}'
    # 🔴 codex:原本寫「全部:sh 本閘 | grep …」是**錯的操作指示** —— 重跑一樣只列 5 支。
    #    改成一條真的列得全的命令(不經過本閘)。
    [ "$n_orphan" -gt "$_cap" ] && printf '%s\n' "      …還有 $((n_orphan - 5)) 支。要列全:sh .husky/scripts-whitelist-gate.sh --list-orphans"
    printf '%s\n' "   收它的人要在【同一個動作裡】登記進 package.json 的 lint-staged(逐字路徑 key)。"
  } >&2
  return 0
}

if [ "$n_total" -lt 1 ]; then
  printf '%s\n' "── scripts-whitelist-gate:這顆 commit 沒有動到【本閘管的副檔名】($EXTS)⇒ 不適用(整棵樹共 $n_tree 支)"
  emit_orphans
  exit 0
fi
# 🔴 綠的【摘要】最多兩行 —— harness 格9 釘著它。理由:綠的輸出每次 commit 都會印,
#    多一行就是每個人每次都要略過一行。要講的話寫進這兩行裡, 不要另起一行。
# ⚠️ **而「綠的時候最多兩行」整句是假的**(codex 抓到):有孤兒時 `emit_orphans` 另外印
#    標題 1 行 + 最多 5 支 + 可能 1 行省略提示 + 收尾 1 行 = **最多再 8 行**。
#    ⇒ 準確說法:**摘要兩行;有孤兒時額外最多 8 行, 且印在摘要之後、走 stderr。**
#    而格9 量的是【沒有孤兒】的世界 ⇒ 它證明不了有孤兒時的行數(格24 補這一格)。
printf '%s\n' "── scripts/ 白名單涵蓋:本次分母 = $SCOPE,共 $n_total 支(白名單 $n_white / 豁免 $n_exempt)—— 全部有歸屬;package.json 讀自 $PKG_SRC;整棵樹共 $n_tree 支"
printf '%s\n' "   🔴 豁免 =【沒有守門】不是【檢查過沒問題】。要看那 $n_exempt 支是誰:sed -n '/^scripts\\//p' .husky/scripts-whitelist-gate.sh"
emit_orphans
exit 0
