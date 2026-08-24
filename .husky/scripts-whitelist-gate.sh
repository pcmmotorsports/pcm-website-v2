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
#      **10 格全 PASS**:0×2 / 1×2 / 2×6(分母0、檔名含換行、無 lint-staged 區塊、兩個區塊、
#      豁免理由空白〔用閘的突變副本〕、不在 git repo;另兩格走 staged-index 那條讀取路徑)。
#      🔴 格數釘死在 harness 的 `EXPECT`,改格數要同時改這一行 —— 這句字面 2026-08-21
#      被 codex R2 抓到過一次(寫「八格」而實際已是 10)。
#      ⇒ 那支 harness 已掛進 package.json 的 lint-staged ⇒ 它被 staged 時會自己跑一次。
#
# 🔴 三個【已知擋不住】的缺口,同樣先寫出來(2026-08-20 codex 對抗審查 R2 指出):
#   ① 白名單只驗「這一行存在」,不驗那行命令有沒有判別力 —— 寫 "true" 一樣過得了。
#   ② 豁免清單住在本檔裡,而本檔由工作樹執行 ⇒ 未 staged 的改動也會生效(package.json 已改讀 staged)。
#   ③ scan 用的枚舉若整個子目錄不可讀,可能被直接略過而不計入「讀不到」⇒ 子樹消失而自檢仍綠。
#   ④ 🔴 **它只認【逐字的路徑 key】,不懂 lint-staged 的 brace glob**(2026-08-21 W5 自己撞到):
#      在 package.json 寫 `"{a.py,b.sh}": "…"` 時,`grep -qF '"a.py":'` 找不到 ⇒ 判成「沒歸屬」而擋下。
#      ⇒ 想用 glob 去掉重複執行的人會被它擋,而**擋的理由訊息不會提到 glob** ⇒ 看起來像漏加。
#      現況處置:**進得了本閘分母的檔(.py/.js/.mjs/…)一律寫逐字 key**;glob 只用在它看不到的副檔名。
# ─────────────────────────────────────────────────────────────────────────────
#
# exit 0 = 每支都有歸屬   1 = 有漏列   2 = 本閘自己壞了(輸出作廢)

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
find scripts \( -type f -o -type l \) \
     \( -iname '*.py' -o -iname '*.js' -o -iname '*.mjs' \
        -o -iname '*.cjs' -o -iname '*.jsx' -o -iname '*.mts' -o -iname '*.cts' \) \
     -print > "$TMP/all.txt" || {
  printf '%s\n' "🔴 scripts-whitelist-gate:find 失敗 ⇒ exit 2" >&2
  exit 2
}
n_files=$(find scripts \( -type f -o -type l \) \
     \( -iname '*.py' -o -iname '*.js' -o -iname '*.mjs' \
        -o -iname '*.cjs' -o -iname '*.jsx' -o -iname '*.mts' -o -iname '*.cts' \) \
     -exec printf 'x\n' \; | wc -l | tr -d ' ')
n_lines=$(wc -l < "$TMP/all.txt" | tr -d ' ')

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
if [ "$n_total" -lt 1 ]; then
  printf '%s\n' "🔴 自檢 FAIL:分母是 0(掃不到任何腳本)⇒ 本閘壞了,不是 repo 乾淨" >&2
  bad=1
fi
if [ "$n_files" != "$n_lines" ]; then
  printf '%s\n' "🔴 自檢 FAIL:檔數 $n_files 與行數 $n_lines 不等 ⇒ 有檔名含換行,逐行比對會漏擋" >&2
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
    printf '%s\n' "⚠️ 這支檔【不一定是你加的】—— 七窗共用同一棵工作樹,先跑 \`git status\` 看它是誰的。"
    printf '%s\n' "   本閘掃的是【工作樹】不是【你這次 staged 的東西】(那是刻意的:未追蹤檔一樣沒守門)。"
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
    sed 's/^/      ✗ /' "$TMP/missing.txt"
  } >&2
  exit 1
fi

printf '%s\n' "── scripts/ 白名單涵蓋:共 $n_total 支(白名單 $n_white / 豁免 $n_exempt)—— 全部有歸屬;package.json 讀自 $PKG_SRC"
printf '%s\n' "   🔴 豁免 =【沒有守門】不是【檢查過沒問題】。要看那 $n_exempt 支是誰:sed -n '/^scripts\\//p' .husky/scripts-whitelist-gate.sh"
exit 0
