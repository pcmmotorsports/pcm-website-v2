#!/bin/bash
# 我現在指到哪一個 Supabase?—— 只印【是/不是正式站】,不印任何值。
#
# 為什麼需要這支:apps/storefront **沒有** env↔DB 配對守門
#   (數法:git grep -c PROD_SUPABASE_HOST -- apps/storefront ⇒ 0 個檔命中;admin 有)
#   ⇒ 在本機拿沙盒 TapPay 刷卡,訂單會【安靜地】寫進正式站,沒有紅可以看。
#   在守門補上之前,這支是「開刷前先看一眼」的那一眼。
#
# 🔴 它回答的是「這個檔指著哪一側」,**不回答**「裡面的 TapPay 憑證是哪一組」——
#    TapPay partner key 沒有 sandbox/production 的形狀標記,機械判別不了
#    (admin composition.ts 檔頭的誠實邊界①逐字寫了這件)。
set -u

# 正式站 project ref:公開字面,釘在 apps/admin/src/lib/payment/composition.test.ts:84
PROD_REF="bmpnplmnldofgaohnaok"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
rc=0
found_any=0

for f in "$ROOT/apps/storefront/.env.local" "$ROOT/apps/admin/.env.local" "$ROOT/.env.local"; do
  rel="${f#"$ROOT"/}"
  if [ ! -e "$f" ]; then
    printf '   %-32s (檔不存在)\n' "$rel"
    continue
  fi
  found_any=1
  n=$(/usr/bin/grep -c "$PROD_REF" "$f" || true)
  if [ "$n" -gt 0 ]; then
    printf '🔴 %-32s 指著【正式站】(含正式 project ref 的行數=%s)\n' "$rel" "$n"
    rc=1
  else
    printf '✅ %-32s 不含正式站 project ref\n' "$rel"
  fi
done

if [ "$found_any" -eq 0 ]; then
  echo "⚠️ 一個 .env.local 都沒有 —— 這【不代表安全】,只代表這支腳本沒有東西可看。"
  exit 2
fi

if [ "$rc" -ne 0 ]; then
  echo
  echo "🔴 上面有紅 ⇒ 在本機刷卡/送表單前先停下:寫進去的是正式站的資料,不可逆。"
  echo "   (錢可能是假的〔沙盒〕,但資料是真的 —— 這兩件常被混成一件。)"
fi
exit "$rc"
