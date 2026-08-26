# RLS service_role 政策守門 —— 薄殼。真正的判斷在 scripts/rls-service-role-policy-gate.py
#
# 🔴 為什麼要多這一層殼(與 view-apply-gate.sh 同款,理由抄在那支 :3-13):
#    scripts/husky-hook-wiring-check.sh 只把符合 `sh .husky/*.sh` 那個形狀的行算進分母。
#    直接把 python3 那行寫進 .husky/pre-commit ⇒ 接線守門【永遠不會替它把關】,
#    連拿掉 `|| exit $?` 都不會紅。這層殼就是進分母的最省做法。
if [ -f scripts/rls-service-role-policy-gate.py ]; then
  if command -v python3 > /dev/null 2>&1; then
    python3 scripts/rls-service-role-policy-gate.py || exit $?
  else
    printf '%s\n' '🔴 找不到 python3 ⇒ RLS 政策守門【沒有跑】⇒ 擋下(不放行)' >&2
    printf '%s\n' '   fail-closed:「沒跑」與「跑了而乾淨」不得印同一個結果。' >&2
    exit 1
  fi
else
  printf '%s\n' '🔴 scripts/rls-service-role-policy-gate.py 不見了 ⇒ 擋下(不放行)' >&2
  printf '%s\n' '   與 scripts-whitelist / state-gates / view-apply 同款 fail-closed:' >&2
  printf '%s\n' '   刪掉那支 .py 正是關掉本閘最省事的方法 ⇒ fail-open 會讓這道閘' >&2
  printf '%s\n' '   【被它自己要防的那個動作關掉】。' >&2
  printf '%s\n' '   復原:git checkout -- scripts/rls-service-role-policy-gate.py' >&2
  exit 1
fi
