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
#   🔴 裸 redirect 2:lib/customers/keyword-search-action.ts ／ lib/orders/keyword-search-action.ts
#   🔶 未驗 1:lib/orders/receipt-actions.ts(return null,docstring 把責任委託給呼叫端;
#             **委託不是靜默,而那些呼叫端沒有人驗過**)
#   刻意例外:customers 那支自陳「只寫呼叫者自己的 cookie,實害有限」
#            (orders 那支**沒有**同樣的自陳 —— 兩支不要一起當成已知例外)
set -eu
CDPATH= cd "$(dirname "$0")/.." || exit 1
EXPECT_BARE=2

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
  mk "$T/w2" 2; mk "$T/w3" 3
  A=$(count_bare "$T/w2"); B=$(count_bare "$T/w3")
  echo "== 世界一:樹裡恰有 2 個裸 redirect ⇒ 應該綠 =="
  echo "   量到 $A   期望 $EXPECT_BARE"
  echo "== 世界二:樹裡有 3 個 ⇒ 應該紅(這一格證明它抓得到【新缺口】)=="
  echo "   量到 $B   期望不等於 $EXPECT_BARE"
  echo "   (跑的是 $(command -v grep))"
  if [ "$A" = "$EXPECT_BARE" ] && [ "$B" != "$EXPECT_BARE" ]; then
    echo "✅ 兩個世界都對:數字對 ⇒ 綠;多一個缺口 ⇒ 抓得到"
    exit 0
  fi
  echo "🔴 這支自己壞了 —— 它的綠不能當證據"
  exit 1
fi

ROOT="${1:-apps/admin/src}"
BARE=$(count_bare "$ROOT"); ALL=$(count_all "$ROOT")
printf '呼叫點總數      %s\n裸 redirect 數  %s(期望 %s)\n(量的是 %s,跑的是 %s)\n' \
  "$ALL" "$BARE" "$EXPECT_BARE" "$ROOT" "$(command -v grep)"
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
