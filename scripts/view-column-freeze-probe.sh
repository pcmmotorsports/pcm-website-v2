#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
# `CREATE OR REPLACE VIEW` + `別名.*` ⇒ 底表加欄之後重跑會炸 —— 可重跑的證據
#
# 🛑 **這支存在的理由**:`docs/launch-todo.md` 的 `⟦b4-VIEWCOL1⟧` 那一列逐字寫著
#    「**沒有人實際重現那一支會炸** ⇒ 正確字面是『它具備同樣的三個條件』不是『它會炸』」。
#    ⇒ 📌 **這支就是把那句話從【三個條件】變成【量到的行為】的東西。**
#
# ── 機制(一句)────────────────────────────────────────────────────────────
#   `別名.*` 在**建 view 的那一刻就展開凍結**成一串具名欄。底表之後加了欄,
#   重跑同一句 `CREATE OR REPLACE VIEW` 時新欄會插在**原本某一欄的位置上**
#   ⇒ PG 認為你在改既有欄的名字 ⇒ `cannot change name of view column`。
#   ⇒ 而 `CREATE OR REPLACE VIEW` **不准改欄名**,`DROP VIEW` + `CREATE VIEW` 可以。
#
# ── 🔴 為什麼要有負對照(這支最重要的一格)──────────────────────────────
#   只跑「加欄之後重跑 ⇒ 紅」一發,證不出紅是**加欄**造成的 ——
#   它同樣符合「這支 migration 本來就不能重跑」。
#   ⇒ 世界② **不加欄、直接重跑一次** ⇒ 必須**綠**。
#   📌 **一組全紅的世界證明不了任何事。**
#   🔴 **而【沒有任何單一世界】自己有判別力**(codex 2026-08-30 點名,寫出來):
#     ①②④ 就算欄序凍結這個機制根本不存在,也會照樣 `rc=0`。
#     ⇒ 📌 **判別力住在【②綠 而 ③紅】這個對照裡,不住在任何一格。**
#       引用這支的結果時,不要只引一格。
#
# ── 🔴 射程(有分母才叫射程)────────────────────────────────────────────
#   · fixture 的 `orders` 是**最小重建**(id / display_id + 探針加的欄),**不是正式庫那張**。
#     這支證的是【欄序凍結這個機制】,**不是**「正式庫上那支 view 現在長什麼樣」。
#   · 沒有正式庫存取 ⇒ **沒有人看過線上那支 view 的真實欄序**。
#   · 它不回答「今天有沒有人真的重跑過」—— 那要正式庫的 migration 紀錄。
#
# 用法: bash scripts/view-column-freeze-probe.sh
# ══════════════════════════════════════════════════════════════════════════════
set -u
export LC_ALL=C LANG=C
REPO="$(cd "$(dirname "$0")/.." && pwd)"
M="$REPO/supabase/migrations/20260814140000_m4b_e10_484a_order_goods_axis_view.sql"
# 🔴 codex 抓:`mktemp` 失敗時 `D` 會是**空字串** ⇒ 後面每一個 "$D/xxx" 都變成 "/xxx"
#    ⇒ 有權限的環境會在**根目錄**留下殘骸,而 cleanup 也清不到它。
#    ⇒ 這不是量測結果、也不是「乾淨」⇒ 當場 ENV-FAIL(對齊 migration-static-checks.sh 的 exit 9)。
D=$(mktemp -d "${TMPDIR:-/tmp}/vcf.XXXXXXXX") || { echo "🔴 建不出暫存目錄(mktemp)⇒ 這不是量測結果, 也不是乾淨 ⇒ ENV-FAIL"; exit 9; }
PG=54371
KEEP=0
cleanup(){ pg_ctl -D "$D/pg" stop -m immediate >/dev/null 2>&1
  if [ "$KEEP" = 1 ]; then printf '🛑 非綠 ⇒ log 保留在 %s\n' "$D"; else rm -rf "$D"; fi; }
trap cleanup EXIT
[ -f "$M" ] || { echo "🔴 找不到 $M ⇒ ENV-FAIL"; KEEP=1; exit 2; }
for c in initdb pg_ctl psql; do command -v "$c" >/dev/null || { echo "🔴 缺 $c ⇒ ENV-FAIL"; KEEP=1; exit 2; }; done
initdb -D "$D/pg" -U postgres --auth=trust --encoding=UTF8 --locale=C >"$D/i.log" 2>&1 || { echo "🔴 initdb ⇒ ENV-FAIL"; KEEP=1; exit 2; }
pg_ctl -D "$D/pg" -o "-p $PG -k /tmp" -l "$D/pg.log" start >/dev/null 2>&1 || { echo "🔴 pg_ctl ⇒ ENV-FAIL"; KEEP=1; exit 2; }
q(){ psql -h /tmp -p "$PG" -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }
PASS=0; FAIL=0

# fixture:那支 migration 真正需要的最小集合。
# 🔴 `service_role` 這個角色是【量出來的,不是想出來的】—— 第一版漏了它,
#    結果**四個世界全部 rc=3**,而那四個紅長得跟「機制成立」一模一樣。
#    📌 一把壞掉的尺,會讓每一個世界印同一個答案 —— 而那個答案剛好是我想要的那個。
q -q -f /dev/stdin >"$D/seed.log" 2>&1 <<'SQL'
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE public.orders (id uuid primary key default gen_random_uuid(), display_id text);
CREATE TABLE public.order_items (id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id), quantity int not null default 1);
CREATE TABLE public.order_item_quantity_summary (order_item_id uuid primary key,
  shipped_quantity int, instock_quantity int, ordered_quantity int);
SQL
[ $? -eq 0 ] || { echo "🔴 fixture 建不起來 ⇒ ENV-FAIL"; cat "$D/seed.log"; KEEP=1; exit 2; }

w(){ # $1=名 $2=期望 ok|err $3=期望錯誤字面(僅 err 時比對)
  q -f "$M" > "$D/o.log" 2>&1; rc=$?
  err=$(grep -m1 -E '^psql.*ERROR' "$D/o.log" | sed 's/.*ERROR:  */ERROR: /')
  if [ $rc -eq 0 ]; then got=ok; else got=err; fi
  m=✅
  if [ "$got" != "$2" ]; then m=🔴; FAIL=$((FAIL+1)); KEEP=1
  elif [ "$2" = err ] && ! printf '%s' "$err" | grep -qF "$3"; then
    # 🔴 紅了不等於【為了我要的理由】紅 —— 錯誤字面對不上就是另一個病在冒充命中
    m=🔴; FAIL=$((FAIL+1)); KEEP=1; err="$err  ← 期望含:$3"
  else PASS=$((PASS+1)); fi
  printf '  %-44s ⇒ rc=%-2s %-4s (期望 %-4s) %s\n' "$1" "$rc" "$got" "$2" "$m"
  [ -n "$err" ] && printf '      %s\n' "$err"
  return 0
}

# 🔴 codex nit(2026-08-30):三個「改世界」的語句原本 `>/dev/null 2>&1` 把 rc 與 stderr 全丟掉
#    ⇒ 改世界失敗時,下一個世界會拿到**上一輪的狀態**,而它印出來的紅會被讀成
#      「機制不成立」。⇒ 改世界失敗 = 本輪作廢,當場停,不要往下判。
mut(){ # $1=說明 $2=SQL
  q -q -c "$2" > "$D/mut.log" 2>&1 || {
    printf '  🔴 改世界失敗(%s)⇒ 後面每一格作廢, 不是機制不成立
' "$1"
    sed 's/^/      /' "$D/mut.log"; KEEP=1; exit 1; }
}
# 🔴 codex nit:輸出沒有記錄 PG 版本 ⇒ 同一個 5/5 日後分不出是不是在同一個版本上複現的。
printf 'PG 版本: %s\n' "$(q -tAc 'SHOW server_version' 2>/dev/null | tr -d '[:space:]')"
echo "══ 別名.* 欄序凍結 · 五個世界"
w "① 第一次建 view" ok
w "② 負對照:不加欄, 直接重跑" ok
mut "orders 加欄" "ALTER TABLE public.orders ADD COLUMN manual_request_id uuid;"
w "③ orders 加欄後重跑 ⇒ 必須炸" err 'cannot change name of view column "goods_axis" to "manual_request_id"'
mut "DROP VIEW" "DROP VIEW public.admin_order_list_v;"
w "④ 修法:先 DROP VIEW 再跑 ⇒ 綠" ok
mut "orders 再加一欄" "ALTER TABLE public.orders ADD COLUMN zz_probe2 text;"
w "⑤ 再加一欄再重跑 ⇒ 同樣炸(可重現)" err 'cannot change name of view column "goods_axis" to "zz_probe2"'

echo
echo "── 結果: PASS=$PASS FAIL=$FAIL（世界數 5；PASS+FAIL 不等於 5 ⇒ 有格沒跑到）"
echo "🛑 射程: 見檔頭 —— fixture 的 orders 是最小重建, 這支證的是【機制】不是正式庫現況。"
[ $((PASS+FAIL)) -eq 5 ] || { echo "🔴 只跑了 $((PASS+FAIL)) 格 ⇒ 判紅"; exit 1; }
[ "$FAIL" -eq 0 ] || exit 1
exit 0
