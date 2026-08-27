# ACL 漂移守門 —— 薄殼。真正的判斷在 scripts/acl-drift-gate.py
#
# 🔴 為什麼要多這一層殼(與 rls-service-role-policy-gate.sh 同款,理由抄在那支 :3-7):
#    scripts/husky-hook-wiring-check.sh 只把符合 `sh .husky/*.sh` 那個形狀的行算進分母。
#    直接把 python3 那行寫進 .husky/pre-commit ⇒ 接線守門【永遠不會替它把關】。
#
# 🔴 離場碼三態, 本殼【原樣傳出】、不壓成 1:
#    0 沒漂移 / 1 有漂移 / 2 工具層壞了(git 讀不到 index、找不到 rls gate 模組)
#    未知 rc(python 自己炸 / 127)也原樣傳出 ⇒ 不會被讀成「有漂移」去找一個不存在的缺口。
#
# 🔴 天花板(寫在殼上, 因為殼是下一個人最先開的檔):
#    本閘只看【這顆 commit 要收的 supabase/migrations/*.sql】。
#    Supabase dashboard / SQL Editor / MCP apply_migration 手動下的 GRANT【永遠不經過這裡】——
#    product_fitments_effective 三張表就是走那條路進線上的。做完本閘 ≠ 那條路關了。
if [ -f scripts/acl-drift-gate.py ]; then
  if command -v python3 > /dev/null 2>&1; then
    python3 scripts/acl-drift-gate.py || exit $?
  else
    printf '%s\n' '🔴 找不到 python3 ⇒ ACL 漂移守門【沒有跑】⇒ 擋下(不放行)' >&2
    printf '%s\n' '   fail-closed:「沒跑」與「跑了而乾淨」不得印同一個結果。' >&2
    exit 2
  fi
else
  printf '%s\n' '🔴 scripts/acl-drift-gate.py 不見了 ⇒ 擋下(不放行)' >&2
  printf '%s\n' '   與 rls-service-role-policy-gate 同款 fail-closed:刪掉那支 .py 正是關掉本閘最省事的方法。' >&2
  printf '%s\n' '   復原:git checkout -- scripts/acl-drift-gate.py' >&2
  exit 2
fi
