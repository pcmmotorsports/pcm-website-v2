# view apply 順序守門 —— 薄殼。真正的判斷在 scripts/view-apply-before-wire-gate.py
#
# 🔴 為什麼要多這一層殼(2026-08-25 三個世界量到, 不是設計偏好):
#    scripts/husky-hook-wiring-check.sh 的 check_precommit 只看【非註解行裡符合 grep 'sh \.husky/' 的那幾行】。
#    把 python3 那一行直接寫進 .husky/pre-commit:
#        世界1 基線                        ⇒ 綠, 「共 7 道閘」
#        世界2 加了那一行                  ⇒ 綠, 「共 7 道閘」  ← 我不在它的分母裡
#        世界3 拿掉我那行的 `|| exit $?`   ⇒ 🔴 **仍然綠**       ← 真缺陷, 而它看不到
#        對照 拿掉【別人那行】的 `|| exit $?` ⇒ 紅              ← 尺是活的, 只是我不在量程內
#    ⇒ 直接寫在 pre-commit 裡的閘, 接線守門【永遠不會替它把關】。
#      走 `sh .husky/*.sh` 這個形狀才進得了分母。這層殼就是進分母的最省做法。
if [ -f scripts/view-apply-before-wire-gate.py ]; then
  if command -v python3 > /dev/null 2>&1; then
    python3 scripts/view-apply-before-wire-gate.py || exit $?
  else
    printf '%s\n' '🔴 找不到 python3 ⇒ 開閘順序守門【沒有跑】⇒ 擋下(不放行)' >&2
    printf '%s\n' '   本閘與 scripts-whitelist / state-gates 同款 fail-closed:' >&2
    printf '%s\n' '   「沒跑」與「跑了而乾淨」不得印同一個結果。' >&2
    exit 1
  fi
else
  printf '%s\n' '🔴 scripts/view-apply-before-wire-gate.py 不見了 ⇒ 擋下(不放行)' >&2
  printf '%s\n' '   理由與 scripts-whitelist-gate 同款:刪掉這支 .py 正是關掉它最省事的方法,' >&2
  printf '%s\n' '   fail-open 會讓這道閘【被它自己要防的那個動作關掉】。' >&2
  printf '%s\n' '   復原:git checkout -- scripts/view-apply-before-wire-gate.py' >&2
  exit 1
fi
