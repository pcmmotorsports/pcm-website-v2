#!/bin/sh
# authz-failure-visibility.sh — 授權被擋時,員工看不看得見自己被擋?
#
#   sh scripts/authz-failure-visibility.sh              量 apps/admin/src
#   sh scripts/authz-failure-visibility.sh <目錄>       量指定樹(自檢用)
#   sh scripts/authz-failure-visibility.sh --selftest   兩個世界各表演一次
#
# ── 規則 ────────────────────────────────────────────────────────────────
#   `authorizeAdminMutation()` 被擋時要給員工一個**看得見的結果**(結果碼 / failure state),
#   不是裸 `redirect('/xxx')` —— 裸 redirect 會讓畫面看起來像「什麼都沒發生」。
#
# ── 🔴🔴 期望值 2 是【刻意寫死】的,這段不是註解,是這支能不能用的前提 ──────
#   **缺口被補掉時這支會紅 —— 那是【提醒你回來改期望值】,不是迴歸。**
#     回 >2 ⇒ 有新缺口
#     回 <2 ⇒ 有人補好了 ⇒ **改這裡的數字**,並在 commit body 說是誰補的
#   為什麼不寫成「>0 就紅」:那樣它在缺口還沒補完的期間會**天天紅**
#   ⇒ 三天內被調鬆。寫死期望值反而**逼人在改動的時候回來改這一行**。
#   ⚠️ 副作用是真的:任何人補好其中一支,這支就會紅,**而那時看到紅的人不知道那是設計**
#      —— 所以上面那幾行必須跟著這支腳本走。
#
# ── 母體與已知缺口(2026-08-18 G6 量、G1 複量,兩支 grep 都跑過)────────────
#   呼叫點 28 個 / 18 支檔(apps/admin/src,排除 .test.)
#   🔴 裸 redirect **1**:lib/customers/keyword-search-action.ts
#      (~~orders 那支~~ 已由 G2 `fb1d1f9f` 修掉 —— #534 訂單域最後一個靜默出口)
#   ✅ ~~未驗 1:lib/orders/receipt-actions.ts~~ —— **G2 量完了,不是本病**:
#      呼叫端 `receipt-panel.tsx:30-32` 接住 null、`:95-98` 顯示 `role='alert'`
#      (逐字「讀不到這個品項的採購紀錄…這批貨先不要出」)。
#      ⚠️ 依據是 `29b70490`,而**那顆落筆當下還沒進 dev**(`merge-base --is-ancestor` ⇒ rc≠0)
#      ⇒ **已量完待收割**,不是已入庫。收割之後這一行的 ⚠️ 可以拿掉。
#
#   🔴 **這個數字的語意會在 0 那天改變(G6 提,寫在這裡免得下一個人用錯方式處置)**:
#      `>=1` 時它在【數缺口】—— 紅 = 有新缺口,或有人補好了
#      `0`  時它在【守住 0】—— 紅 = **有人新增了一個裸 redirect**
#      ⇒ 同一個數字、兩種意思。
#   📌 下一個變化已經在路上:G2 的 `81051b7c` 補掉 customers 那支 ⇒ 進 dev 之後這裡改 **0**。
#      判別:`git merge-base --is-ancestor 81051b7c dev` ⇒ rc=0 才是真的進去了。**不要提早改。**
#
#   ⚠️ **待判(不是已豁免)**:customers 那支自陳「只寫呼叫者自己的 cookie,實害有限」。
#      🔴 那句講的是**資料面**(沒寫壞東西),而 `#534` 的病是**可用性面**:
#         **擋得對,而失敗看不見** —— 員工搜尋被擋、畫面完全正常,他以為搜過了。
#      ⇒ 自陳擋不住那半 ⇒ **降級成待判,由 customers 域的窗判。**(G6 2026-08-18 提,採用)
#      📎 佐證:orders 那支**也有一模一樣的自陳**,而 G2 仍然把它修掉了。
#
#   🔴 **一句更正(我自己量到的反例)**:~~orders 那支沒有同樣的自陳~~ —— **有**。
#      量法 `git show dev:apps/admin/src/lib/orders/keyword-search-action.ts | grep -n 實害` ⇒ `:60` 命中
#      逐字「實害有限(它只寫呼叫者自己的 cookie)」。
#      ⇒ 我先前照抄了那句未量的宣稱進本檔頭。**兩支在這一點上是對稱的,不是一有一沒有。**
set -eu
CDPATH= cd "$(dirname "$0")/.." || exit 1
EXPECT_BARE=1
# 🔴 正向對照:同一支 pattern 對這支 fixture 【恆為 1】—— 它不隨 EXPECT_BARE 走。
#    理由:真實樹數到 0 的那天,「pattern 打錯」與「真的沒缺口」在輸出上不可分辨。
#    (G6 2026-08-18 提並實測;我今晚才自曝過「自檢抄一份 production 的魔術數字會壞掉」
#     ⇒ 這個 1 是【它自己的性質】不是那個常數的複本,所以它該寫死,而且要寫明為什麼。)
FIXTURE_DIR="scripts/fixtures"
FIXTURE_EXPECT=1

count_bare() {  # $1=要掃的樹
  grep -rn -A2 "await authorizeAdminMutation()" "$1" --include='*.ts' --include='*.tsx' 2>/dev/null \
    | grep -v '\.test\.' | grep -cE "redirect\('/[a-z]+'\);" || true
}
count_all() {
  grep -rn "await authorizeAdminMutation()" "$1" --include='*.ts' --include='*.tsx' 2>/dev/null \
    | grep -vc '\.test\.' || true
}

if [ "${1:-}" = "--selftest" ]; then
  T=$(mktemp -d) || exit 1
  trap 'rm -rf "$T"' EXIT
  mk() {  # $1=目錄 $2=幾個裸 redirect
    mkdir -p "$1"
    i=0
    while [ "$i" -lt "$2" ]; do
      printf 'const x = await authorizeAdminMutation();\nif (!x) {\n  redirect("/orders");\n}\n' \
        | sed "s/\"/'/g" > "$1/bare$i.ts"
      i=$((i+1))
    done
    printf 'const y = await authorizeAdminMutation();\nif (!y) {\n  return { ok: false, code: 403 };\n}\n' > "$1/good.ts"
  }
  # 🔴 自檢的樹【跟著 EXPECT_BARE 走】,不可以另外寫死一個數字 ——
  #    2026-08-18 實錘:期望值 2→1 那次,自檢因為自己寫死 2 而當場壞掉。
  #    **一支把 production 的魔術數字抄一份的自檢,會在那個數字改動時壞掉(或更糟:安靜地過)。**
  mk "$T/wok" "$EXPECT_BARE"; mk "$T/wmore" "$((EXPECT_BARE + 1))"
  A=$(count_bare "$T/wok"); B=$(count_bare "$T/wmore")
  echo "== 世界一:樹裡恰有 $EXPECT_BARE 個裸 redirect ⇒ 應該綠 =="
  echo "   量到 $A   期望 $EXPECT_BARE"
  echo "== 世界二:樹裡有 $((EXPECT_BARE + 1)) 個 ⇒ 應該紅(這一格證明它抓得到【新缺口】)=="
  echo "   量到 $B   期望不等於 $EXPECT_BARE"
  echo "   (跑的是 $(command -v grep))"
  echo "== 世界三(G6 提的正向對照):fixture 用同一支 pattern 必須數到 $FIXTURE_EXPECT =="
  C=$(count_bare "$FIXTURE_DIR")
  echo "   量到 $C   期望 $FIXTURE_EXPECT"
  echo "== 世界四:把 pattern 弄壞 ⇒ fixture 必須【跟著變 0】(這格證明它抓得到尺壞掉)=="
  D=$(grep -rn -A2 "await authorizeAdminMutation()" "$FIXTURE_DIR" --include='*.ts' 2>/dev/null \
      | grep -v '\.test\.' | grep -cE "這個字串保證不會出現xyzzy" || true)
  echo "   量到 $D   期望 0(而世界三是 $FIXTURE_EXPECT ⇒ 兩者不同才代表 fixture 有判別力)"
  if [ "$A" = "$EXPECT_BARE" ] && [ "$B" != "$EXPECT_BARE" ] \
     && [ "$C" = "$FIXTURE_EXPECT" ] && [ "$D" = "0" ]; then
    echo "✅ 四個世界都對:數字對=綠;多一個缺口=抓得到;fixture 校準住尺;pattern 壞掉 fixture 會跟著掉"
    exit 0
  fi
  echo "🔴 這支自己壞了 —— 它的綠不能當證據"
  exit 1
fi

ROOT="${1:-apps/admin/src}"
# 🔴 先量尺,再量世界 —— 尺壞掉的話,底下那個數字沒有意義
FIX=$(count_bare "$FIXTURE_DIR")
if [ "$FIX" != "$FIXTURE_EXPECT" ]; then
  printf '🔴 正向對照壞了:fixture 量到 %s(恆應為 %s)\n' "$FIX" "$FIXTURE_EXPECT"
  printf '   ⇒ **pattern 或掃描範圍壞了,不是缺口沒了。** 底下的數字不要採信。\n'
  exit 1
fi
BARE=$(count_bare "$ROOT"); ALL=$(count_all "$ROOT")
printf '正向對照        fixture %s(恆應 %s)✅\n呼叫點總數      %s\n裸 redirect 數  %s(期望 %s)\n(量的是 %s,跑的是 %s)\n' \
  "$FIX" "$FIXTURE_EXPECT" "$ALL" "$BARE" "$EXPECT_BARE" "$ROOT" "$(command -v grep)"
if [ "$BARE" = "$EXPECT_BARE" ]; then
  printf '✅ 與已知缺口數相同 —— **這不代表沒問題,代表【沒有變化】。**\n'
  exit 0
fi
if [ "$BARE" -gt "$EXPECT_BARE" ]; then
  printf '🔴 比已知的多 ⇒ **有新缺口**,去看是誰加的\n'
else
  printf '🔶 比已知的少 ⇒ **有人補好了** ⇒ 回來把本檔的 EXPECT_BARE 改成 %s,並在 commit body 說是誰補的\n' "$BARE"
fi
exit 1
