#!/bin/sh
# ============================================================
# .husky/state-gates-freshness-gate.sh 的證人 — 把它的三態逐格【餵一發】(#854)
# ============================================================
# 為什麼要有這支(2026-08-23,b8;主視窗裁「不要同一天再造一個沒證人的閘」):
#   那道閘裝上當晚的九格驗收矩陣全跑在拋棄式 clone 裡,跑完即刪 ⇒ 證據只活在交件檔。
#   日後有人改壞它(改 pathspec、改回 --stdout、改回 fail-open)⇒ **零訊號**。
#   對照組 scripts/scripts-whitelist-gate.harness.sh 有證人且掛 lint-staged;本檔照它的形狀。
#
# 做法:暫存目錄造拋棄式 git repo,放進【閘 + 產生器 + 最小 migrations】,一次改一個條件餵一發。
#   ⇒ 完全不碰本 repo 的 .husky/ scripts/ docs/。
#   🔴 這裡沒有「還原」這一步 —— 每格各自一個世界、用完即丟(c4359d33 那條坑:套用要掛條件、
#      還原不准掛條件;本檔兩者都沒有,所以兩邊都踩不到)。
#
# 🔴 每一格驗【兩件事】(同 peer harness):① exit code ② stderr 裡為了【我要的那個理由】紅。
#
# exit 0 = 每一格都表演到位   1 = 有格沒過(閘的行為與宣稱不符)   2 = 本 harness 自己壞了
#
# 🔴 誠實邊界:
#   · 驗的是【閘的判別力】,不是「本 repo 現在的表新鮮」—— 後者要直接跑那道閘。
#   · 產生器用的是本 repo 現行的 scripts/state-gates.sh 副本 ⇒ 它的守門①②(UTF-8 / 三函式自測)
#     一併在路徑上;fixture 刻意含那三支函式名,否則產生器自己就紅、每格都變 2。
#   · pre-commit 那兩格用本 repo 現行的 .husky/pre-commit 副本 + 其他閘的 stub(exit 0)+ stub pnpm
#     ⇒ 證的是「接線塊會不會在缺檔時擋」,不證其他閘。
#   · 【這一層沒有守門】:本檔自己退化成恆 PASS 沒有外層在看(與 peer 同款,靠 code review)。
# ============================================================
set -u
export LC_ALL=C

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
GATE="$ROOT/.husky/state-gates-freshness-gate.sh"
GEN="$ROOT/scripts/state-gates.sh"
PRECOMMIT="$ROOT/.husky/pre-commit"
for f in "$GATE" "$GEN" "$PRECOMMIT"; do
  if [ ! -f "$f" ]; then echo "✗ 找不到 $f ⇒ 本 harness 沒有被驗物,exit 2" >&2; exit 2; fi
done

usage() { echo "用法: sh scripts/state-gates-freshness.harness.sh" >&2; }
# lint-staged 會把 staged 檔名附加在命令後面 ⇒ 收下位置參數並印出來;打錯的 option 仍要炸(同 peer)。
_extra_opts=""; _extra_pos=""
for _a in "$@"; do case "$_a" in -*) _extra_opts="$_extra_opts $_a" ;; *) _extra_pos="$_extra_pos $_a" ;; esac; done
if [ -n "$_extra_opts" ]; then echo "✗ 不認得的參數:$_extra_opts" >&2; usage; exit 2; fi
if [ -n "$_extra_pos" ]; then echo "(忽略位置參數:$_extra_pos —— 本工具不吃檔名;lint-staged 會附加它們)" >&2; fi

# 🔴 把繼承來的 git 環境變數清掉(mutation-harness-restore.md §4e):從 pre-commit 裡跑時,
#    繼承的 GIT_INDEX_FILE 會讓 fixture 的 git add 寫進【外層那次 commit 的 index】。
unset GIT_INDEX_FILE GIT_DIR GIT_WORK_TREE GIT_OBJECT_DIRECTORY GIT_COMMON_DIR GIT_PREFIX 2>/dev/null || true
pass=0; fail=0
BASE=$(mktemp -d) || exit 2
trap 'rm -rf "$BASE"' EXIT
trap 'rm -rf "$BASE"; exit 1' INT TERM
OUT="$BASE/out.txt"

ck() { # $1=標籤 $2=實得rc $3=該得rc $4=stderr/stdout 該出現的關鍵字(空=不驗)
  _why="ok"
  if [ "$2" != "$3" ]; then _why="rc=$2 但宣稱是 $3"
  elif [ -n "${4:-}" ] && ! grep -qF "$4" "$OUT"; then _why="rc 對了,但沒印出「$4」⇒ 它是為了別的理由紅的"
  fi
  if [ "$_why" = "ok" ]; then echo "  PASS $1 (rc=$2)"; pass=$((pass + 1))
  else echo "  🔴 FAIL $1 —— $_why"; fail=$((fail + 1)); fi
}
die() { echo "✗ fixture 建置失敗:$1 ⇒ 本 harness 自己壞了,exit 2" >&2; exit 2; }

DOC='docs/reference/order-state-gates.md'
# 三支函式名 = 產生器守門②的必測名單(state-gates.sh 自檢那行);寫法要命中它的 WRITE_PAT / GATE_PAT。
write_base_migrations() { # $1=world dir
  mkdir -p "$1/supabase/migrations" || die "mkdir migrations"
  cat > "$1/supabase/migrations/20200101000000_base.sql" <<'SQL' || die "寫 base.sql"
CREATE FUNCTION public.confirm_order_payment(p_order_id uuid) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF (SELECT payment_status <> 'unpaid' FROM public.orders WHERE id = p_order_id) THEN RAISE EXCEPTION 'x'; END IF;
  UPDATE public.orders SET payment_status = 'paid' WHERE id = p_order_id;
END $f$;
CREATE FUNCTION public.admin_cancel_order(p_order_id uuid) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF (SELECT cancelled_at IS NOT NULL FROM public.orders WHERE id = p_order_id) THEN RAISE EXCEPTION 'y'; END IF;
  UPDATE public.orders SET cancelled_at = now() WHERE id = p_order_id;
END $f$;
CREATE FUNCTION public.admin_initiate_order_refund(p_order_id uuid) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  INSERT INTO public.order_refunds(order_id) VALUES (p_order_id);
END $f$;
CREATE FUNCTION public.pcm_harness_very_long_function_name_marker_44(p uuid) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  UPDATE public.orders SET payment_status = 'paid' WHERE id = p;
END $f$;
SQL
  # 🔴 那支 44 字的長名函式是給格6 的「溫突變」用的:產生器退化成只認 ≥30 字的名字時,第一段仍有這一列
  #    ⇒ 產生器【活著、exit 0】、只是三支必測名消失 ⇒ 非 --stdout 模式由守門②抓到(2);
  #    若有人把 regen 改回 --stdout(守門不在路徑上)⇒ 退化的表被拿去比對 ⇒ 回 1 ⇒ 格6 紅。
  #    第一版 fixture 名字全 <30 字 ⇒ 突變讓產生器整個死掉(pipefail)⇒ --stdout 與否都回 2 ⇒ 那個突變活著(reviewer M5)。
  cat > "$1/supabase/migrations/20200102000000_gen2.sql" <<'SQL' || die "寫 gen2.sql"
CREATE OR REPLACE FUNCTION public.admin_cancel_order(p_order_id uuid) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  UPDATE public.orders SET cancelled_at = now() WHERE id = p_order_id;
END $f$;
CREATE OR REPLACE FUNCTION public.pcm_harness_very_long_function_name_marker_44(p uuid) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  UPDATE public.orders SET payment_status = 'paid' WHERE id = p;
END $f$;
SQL
}
GEN3_SQL='CREATE OR REPLACE FUNCTION public.admin_cancel_order(p_order_id uuid) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  UPDATE public.orders SET cancelled_at = now() WHERE id = p_order_id AND payment_status = '"'"'unpaid'"'"';
END $f$;'

# 造一個【該綠】的最小世界:閘 + 產生器 + 兩支 migrations + 用 --write 產好的表,全部 commit。
mkworld() { # $1=世界名 → 印出目錄
  d="$BASE/$1"
  mkdir -p "$d/scripts" "$d/.husky" || die "mkdir $1"
  ( cd "$d" && git init -q . && git config user.email b8@x && git config user.name b8 && git config commit.gpgsign false ) || die "git init $1"
  cp "$GATE" "$d/.husky/state-gates-freshness-gate.sh" || die "cp gate"
  cp "$GEN" "$d/scripts/state-gates.sh" || die "cp gen"
  write_base_migrations "$d"
  # 🔴 seed 的表用【產生器】直接產,不經被驗物的 --write(第一版經 --write:閘被閹成 exit 0 時
  #    seed 寫不出表 ⇒ harness 回 2「自己壞了」而不是 1「閘不合宣稱」—— 紅了,但診斷指錯方向)。
  ( cd "$d" && git add scripts/state-gates.sh .husky/state-gates-freshness-gate.sh supabase/migrations \
      && bash scripts/state-gates.sh >/dev/null 2>&1 \
      && git add "$DOC" && git commit -q -m seed ) || die "seed commit $1"
  echo "$d"
}
# 🔴 `W=$(world x)` 裡的 exit 2 只會結束 command substitution 的子殼,parent 若無其事往下跑
#    (第一版實測:seed 失敗後仍印出「PASS 格1」)⇒ 取世界的那一行後面【parent 自己】呼叫 need_world。
need_world() { # $1=目錄 $2=世界名
  if [ ! -d "${1:-}" ] || [ ! -f "${1:-}/$DOC" ]; then echo "✗ fixture 建置失敗:$2 ⇒ 本 harness 自己壞了,exit 2" >&2; exit 2; fi
}
run() { ( cd "$1" && sh .husky/state-gates-freshness-gate.sh > "$OUT" 2>&1 ); echo $?; }
stage_gen3() { printf '%s\n' "$GEN3_SQL" > "$1/supabase/migrations/20200103000000_gen3.sql" && ( cd "$1" && git add supabase/migrations/20200103000000_gen3.sql ) || die "stage gen3"; }

# ── 格1 [0] 乾淨世界、零 staged ⇒ 0 ────────────────────────────────
W=$(mkworld w1); need_world "$W" w1
ck "格1 [0] 零 staged ⇒ 0" "$(run "$W")" "0" ""

# ── 格2 [1] 加一代(staged)而表沒重產 ⇒ 1,理由=對不上 ───────────────
W=$(mkworld w2); need_world "$W" w2; stage_gen3 "$W"
ck "格2 [1] 加一代、表落後 ⇒ 1" "$(run "$W")" "1" "對不上"

# ── 格3 [0] --write 本身是被驗物的一條路 ⇒ 它壞了是「閘不合宣稱」(1),不是 harness 自壞(2)
#    🔴 第一版寫成 `|| die` ⇒ --write 一壞就 abort、後面 8 格沒跑、格數守門也沒跑到(reviewer M5 實測)。
#    ⇒ 用 ck 記它,失敗照樣往下跑。
( cd "$W" && sh .husky/state-gates-freshness-gate.sh --write > "$OUT" 2>&1 ); rc=$?
ck "格3w [0] --write 本身回 0 並說它寫了" "$rc" "0" "已用 index 視圖重產"
( cd "$W" && [ -f "$DOC" ] && git add "$DOC" ) 2>/dev/null || true
ck "格3 [0] --write 後 ⇒ 0" "$(run "$W")" "0" ""
( cd "$W" && [ -f "$DOC" ] && grep -q '20200103000000_gen3' "$DOC" ); rc=$?; : > "$OUT"
ck "格3b [0] 表含新代檔名(證明 --write 真的寫了)" "$rc" "0" ""

# ── 格3c [0] 目錄不在時 --write 也要能寫(閘 :64 那行 mkdir -p 的【唯一】證人;拿掉它 ⇒ 本格紅)──
#    🔴 第一版沒有這格,而閘的註解卻寫「harness 第一格抓到的」—— 在出貨版本上拿掉 mkdir 是全綠的,
#       因為 seed 用產生器產表時目錄已經被造出來(reviewer M6 實測)。
( cd "$W" && rm -rf "$(dirname "$DOC")" && sh .husky/state-gates-freshness-gate.sh --write > "$OUT" 2>&1 ); rc=$?
ck "格3c [0] docs/reference/ 不存在時 --write 仍回 0" "$rc" "0" "已用 index 視圖重產"
( cd "$W" && [ -f "$DOC" ] && git add "$DOC" ) 2>/dev/null || true
( cd "$W" && [ -f "$DOC" ] ); rc=$?; : > "$OUT"
ck "格3d [0] 而且表真的重新出現在磁碟上" "$rc" "0" ""

# ── 格4 [0] 磁碟上放 untracked 鄰檔(不 stage)⇒ 仍 0,且表不含它(index 視圖隔離)──
printf 'CREATE OR REPLACE FUNCTION public.admin_cancel_order(x int) RETURNS void LANGUAGE sql AS $f$ SELECT 1 $f$;\nUPDATE public.order_refunds SET status=1;\n' > "$W/supabase/migrations/20200104000000_untracked.sql" || die "untracked"
ck "格4 [0] untracked 鄰檔在場 ⇒ 仍 0" "$(run "$W")" "0" ""
# 表不在 ⇒ grep 回 2、`!` 反成 0 ⇒ 會假 PASS(reviewer nit)⇒ 先驗檔在。
( cd "$W" && [ -f "$DOC" ] && ! grep -q '20200104000000_untracked' "$DOC" ); rc=$?; : > "$OUT"
ck "格4b [0] 表不含 untracked 鄰檔(隔離)" "$rc" "0" ""

# ── 格5 [1] 手改表、單獨 stage ⇒ 1(MF3:表本身是觸發成員)────────────
W=$(mkworld w5); need_world "$W" w5
( cd "$W" && printf '\n-- hand edit\n' >> "$DOC" && git add "$DOC" ) || die "hand edit"
ck "格5 [1] 手改表單獨 stage ⇒ 1" "$(run "$W")" "1" "對不上"

# ── 格6 [2] 產生器退化(staged)⇒ 產生器自身守門紅 ⇒ 閘回 2 ───────────
W=$(mkworld w6); need_world "$W" w6
python3 - "$W/scripts/state-gates.sh" <<'PY' || die "mutate gen"
import sys
p=sys.argv[1]; s=open(p,encoding='utf-8').read()
a='public\\.[a-z_0-9]+'
assert s.count(a)>=2, "anchor"
open(p,'w',encoding='utf-8').write(s.replace(a,'public\\.[a-z_0-9]{30,}'))
PY
( cd "$W" && git add scripts/state-gates.sh ) || die "stage mutated gen"
# 🔴 關鍵字要指名【哪一道】守門(reviewer F1):「量具壞了」在閘裡命中兩處(產生器守門紅 / 產物缺席 belt),
#    把產生器那行改成 `|| true` 之後走 belt 照樣回 2 + 照樣印「量具壞了」⇒ 12/12 假綠。
ck "格6 [2] 產生器退化 ⇒ 2(且是產生器自身守門紅的)" "$(run "$W")" "2" "產生器自身守門未過"

# ── 格7 [2] 產生器從 index 移除 ⇒ 量具缺席 ⇒ 2 ────────────────────────
W=$(mkworld w7); need_world "$W" w7; stage_gen3 "$W"
( cd "$W" && git rm -q --cached scripts/state-gates.sh ) || die "rm gen"
ck "格7 [2] 產生器缺席 ⇒ 2" "$(run "$W")" "2" "量具缺席"

# ── 格8 [2] 閘自己 staged ≠ 工作樹 ⇒ 2(跑的不是要 commit 的那份)────────
W=$(mkworld w8); need_world "$W" w8
( cd "$W" && printf '\n# a\n' >> .husky/state-gates-freshness-gate.sh && git add .husky/state-gates-freshness-gate.sh && printf '\n# b\n' >> .husky/state-gates-freshness-gate.sh ) || die "diverge gate"
ck "格8 [2] 閘 staged/工作樹不一致 ⇒ 2" "$(run "$W")" "2" "不一致"

# ── 格9 pre-commit 接線塊:缺檔 ⇒ 擋;在 ⇒ 穿過(用本 repo 現行 pre-commit 副本 + stub)──
W=$(mkworld w9); need_world "$W" w9
cp "$PRECOMMIT" "$W/.husky/pre-commit" || die "cp pre-commit"
printf '#!/bin/sh\nexit 0\n' > "$W/.husky/scripts-whitelist-gate.sh" || die "stub whitelist"   # 它缺檔會 fail-closed,要 stub
# stub pnpm 印一個信標 ⇒ 格9a 能分出「穿過本段抵達 lint-staged」與「pre-commit 那段被整塊刪掉」(reviewer nit)。
mkdir -p "$BASE/bin" && printf '#!/bin/sh\necho PNPM_STUB_REACHED\nexit 0\n' > "$BASE/bin/pnpm" && chmod +x "$BASE/bin/pnpm" || die "stub pnpm"
( cd "$W" && PATH="$BASE/bin:$PATH" sh -e .husky/pre-commit > "$OUT" 2>&1 ); rc=$?
ck "格9a [0] 閘在 ⇒ pre-commit 穿過本段、抵達 lint-staged(其他閘 stub、pnpm stub)" "$rc" "0" "PNPM_STUB_REACHED"
rm "$W/.husky/state-gates-freshness-gate.sh" || die "rm gate"
( cd "$W" && PATH="$BASE/bin:$PATH" sh -e .husky/pre-commit > "$OUT" 2>&1 ); rc=$?
ck "格9b [1] 閘缺檔 ⇒ pre-commit 擋(fail-closed)" "$rc" "1" "擋下(不放行)"

echo "  ── harness: $pass PASS / $fail FAIL"
# 格數守門比的是【跑過幾格】(pass+fail)—— 「一格失敗」與「一格不見了」是兩個出口(同 peer)。
EXPECT=15
if [ "$((pass + fail))" != "$EXPECT" ]; then
  echo "  🔴 【格數】不對:跑了 $((pass + fail)) 格 ≠ $EXPECT ⇒ 有格被刪掉或沒跑到(這不是「有格失敗」)"
  exit 1
fi
if [ "$fail" != "0" ]; then exit 1; fi
exit 0
