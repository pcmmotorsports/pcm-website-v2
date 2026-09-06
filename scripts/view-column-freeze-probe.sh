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
# ── ⑥⑦ 是後補的【另一半】(2026-09-07 `-ship`)────────────────────────────
#   ①-⑤ 證「重跑會炸」;⑥⑦ 證「**不重跑會安靜少一欄**」。
#   🛑 **兩半不要一起引用成一句** —— 它們是同一個 `o.*` 的**兩個相反症狀**:
#      一個吵到有人會撞到, 一個安靜到沒有任何守門看得到。
#   🔴 **⑥ 單獨沒有判別力**(一個永遠回 0 的查詢也會讓它綠)⇒ 引用它必須連 ⑦ 一起引。
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
# 🔴 **埠不再寫死**(⟦f3-PGPORTCOLLISION⟧ 修法③;2026-09-07 `-ship`)——
#    原本逐字 `PG=54371` 是**手工分配**, 而七個窗共用一台機器 ⇒ 遲早撞,
#    而撞到的外觀是 `pg_ctl ⇒ ENV-FAIL` ⇒ **讀起來像「這台機器不能跑 PG」**。
#    🛑 而 `free-port.sh` 只是把【必然相撞】換成【很少相撞】(它自己的檔頭這樣寫)
#       ⇒ 所以下面那段「起不來的時候分得出是哪一種」**照樣要有**, 不是可以省掉的。
FP="$REPO/scripts/free-port.sh"
[ -f "$FP" ] || { echo "🔴 找不到 $FP ⇒ ENV-FAIL"; exit 2; }
PG=$(bash "$FP") || { echo "🔴 取不到沒人聽的 port ⇒ ENV-FAIL"; exit 2; }
case "$PG" in ''|*[!0-9]*) echo "🔴 free-port.sh 回的不是一個號:[$PG] ⇒ ENV-FAIL"; exit 2 ;; esac
KEEP=0
cleanup(){ pg_ctl -D "$D/pg" stop -m immediate >/dev/null 2>&1
  if [ "$KEEP" = 1 ]; then printf '🛑 非綠 ⇒ log 保留在 %s\n' "$D"; else rm -rf "$D"; fi; }
trap cleanup EXIT
[ -f "$M" ] || { echo "🔴 找不到 $M ⇒ ENV-FAIL"; KEEP=1; exit 2; }
for c in initdb pg_ctl psql; do command -v "$c" >/dev/null || { echo "🔴 缺 $c ⇒ ENV-FAIL"; KEEP=1; exit 2; }; done
initdb -D "$D/pg" -U postgres --auth=trust --encoding=UTF8 --locale=C >"$D/i.log" 2>&1 || { echo "🔴 initdb ⇒ ENV-FAIL"; KEEP=1; exit 2; }
# ══ ⟦f3-PGPORTCOLLISION⟧ ④:失敗訊息要分得出【埠被佔】與【PG 真的起不來】═══════
# 🛑 **那一列逐字**:「改 port 只讓【我】不撞;**改訊息才讓【下一個撞到的人】不去查錯的東西**。」
# 🔬 三個世界當場量過(2026-09-07 `-ship`, PG 17.10 Homebrew), 而它們**印不同的東西**:
#    A 埠被佔        ⇒ 伺服器 log 有 `could not create any TCP/IP sockets` / `Address already in use`
#    B 資料目錄不存在 ⇒ 🔴 **伺服器 log 根本沒被建出來**, 話在 `pg_ctl` **自己的 stderr** 裡
#      (`pg_ctl: directory "…" does not exist`)⇒ 📌 **而原本那一行把它 `2>&1` 丟進 /dev/null 了。**
#    C locale 沒設    ⇒ log 有 `postmaster became multithreaded` + `HINT: Set the LC_ALL…`, 而 A 的特徵字 = **0**
# 🔴 **⇒ 所以要看【兩個地方】**:log 不在 ⇒ 看 pg_ctl 自己說;log 在 ⇒ 才輪到特徵字。
#    只 grep log 的話, B 會落進「不是埠問題」而**理由是檔案不存在**, 那是碰巧對, 不是量到。
pg_ctl -D "$D/pg" -o "-p $PG -k /tmp" -l "$D/pg.log" start >"$D/pgctl.err" 2>&1 || {
  echo "🔴 PG 起不來 ⇒ ENV-FAIL(這一發用的 port = $PG)"
  if [ ! -f "$D/pg.log" ]; then
    echo "   ⇒ 【伺服器 log 沒被建出來】= pg_ctl 在啟動之前就停了。它自己說:"
    sed 's/^/      /' "$D/pgctl.err"
  elif grep -qE 'could not create any TCP/IP sockets|Address already in use' "$D/pg.log"; then
    echo "   ⇒ 🎯 【port $PG 被別人佔住】—— 這【不是】「這台機器不能跑 PG」, 是【隔壁有人】。"
    echo "      重跑一次就會換一個號(本支每次用 scripts/free-port.sh 當場取)。"
  else
    echo "   ⇒ 【PG 真的起不來】, 而它與 port 無關。伺服器 log 的 FATAL/HINT:"
    grep -E 'FATAL|HINT' "$D/pg.log" | head -3 | sed 's/^/      /'
  fi
  KEEP=1; exit 2; }
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
# ══ (a) 那一半:【不重跑】的時候, 那支 view 安靜地少一欄 ═════════════════════
# 🛑 **這是與 ①-⑤ 相反的症狀, 不是同一件事的另一種說法**:
#    ③⑤ = 「重跑會炸」(吵, 有人會撞到);本格 = 「**不重跑**會少一欄」(安靜, 沒有人會撞到)。
#    ⇒ 板列 `⟦b4-VIEWCOL1⟧` 逐字:「**(a) 與 (b) 是同一個 `o.*` 的兩個相反症狀**」,
#      而它同一句自陳「`-f3` **沒有實跑** (a) —— 沒有在拋棄式庫上加一欄再去讀那支 view 看它少不少」。
#      ⇒ 📌 **這兩格就是把那句話從【開檔讀 `o.*` 推出來的】變成【量到的】。**
#
# 🔴 **這一把尺【單獨沒有判別力】** —— 一個永遠回 0 的查詢也會讓 ⑥ 印綠。
#    ⇒ 判別力住在【⑥ 沒有 **而** ⑦ 有】這個對照裡:⑦ 用的是**同一把尺、同一支 view、同一個欄名**,
#      只差中間做了 `DROP VIEW` + 重建 ⇒ **它必須翻面。**
# 🔴 **而每一發還帶兩個同時量的鄰居**:
#    · `底表有沒有這一欄`(=1)⇒ 沒有的話是**改世界沒成功**, 不是 view 凍結
#    · `view 一共幾欄`(>0)  ⇒ 是 0 的話是**尺瞎了 / view 不在**, 而它會讓 ⑥ 假綠
vcol(){ # $1=說明 $2=欄名 $3=期望 in|out
  vc_n=$(q -tAc "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='admin_order_list_v' AND column_name='$2'" 2>"$D/vcol.err" | tr -d '[:space:]')
  vc_b=$(q -tAc "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='$2'" 2>>"$D/vcol.err" | tr -d '[:space:]')
  vc_t=$(q -tAc "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='admin_order_list_v'" 2>>"$D/vcol.err" | tr -d '[:space:]')
  vc_m=✅; vc_why=
  case "$vc_n$vc_b$vc_t" in *[!0-9]*|'') vc_m=🔴; vc_why='讀數不是數字 ⇒ 尺壞了, 不是量到' ;; esac
  if [ "$vc_m" = ✅ ]; then
    if [ "$vc_t" -eq 0 ]; then vc_m=🔴; vc_why='view 一共 0 欄 ⇒ 尺瞎了或 view 不在 ⇒ 這一格的綠沒有意義'
    elif [ "$vc_b" -ne 1 ]; then vc_m=🔴; vc_why="底表 orders 沒有 $2 ⇒ 改世界沒成功, 不是 view 凍結"
    elif [ "$3" = out ] && [ "$vc_n" -ne 0 ]; then vc_m=🔴; vc_why='期望 view 沒有這一欄, 而它有'
    elif [ "$3" = in  ] && [ "$vc_n" -ne 1 ]; then vc_m=🔴; vc_why='期望 view 有這一欄, 而它沒有'
    fi
  fi
  if [ "$vc_m" = ✅ ]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); KEEP=1; fi
  printf '  %-44s ⇒ view含%s=%s 底表=%s view共%s欄 (期望 %-3s) %s\n' "$1" "$2" "$vc_n" "$vc_b" "$vc_t" "$3" "$vc_m"
  [ -n "$vc_why" ] && printf '      %s\n' "$vc_why"
  return 0
}

# 🔴 codex nit:輸出沒有記錄 PG 版本 ⇒ 同一個 5/5 日後分不出是不是在同一個版本上複現的。
printf 'PG 版本: %s\n' "$(q -tAc 'SHOW server_version' 2>/dev/null | tr -d '[:space:]')"
echo "══ 別名.* 欄序凍結 · 七個世界(①-⑤ = 重跑會炸〔吵〕· ⑥⑦ = 不重跑會少一欄〔安靜〕)"
w "① 第一次建 view" ok
w "② 負對照:不加欄, 直接重跑" ok
mut "orders 加欄" "ALTER TABLE public.orders ADD COLUMN manual_request_id uuid;"
vcol "⑥ (a) 加欄後【不重跑】⇒ view 安靜少一欄" manual_request_id out
w "③ orders 加欄後重跑 ⇒ 必須炸" err 'cannot change name of view column "goods_axis" to "manual_request_id"'
mut "DROP VIEW" "DROP VIEW public.admin_order_list_v;"
w "④ 修法:先 DROP VIEW 再跑 ⇒ 綠" ok
vcol "⑦ 正對照:DROP+重建後同一把尺必須翻面" manual_request_id in
mut "orders 再加一欄" "ALTER TABLE public.orders ADD COLUMN zz_probe2 text;"
w "⑤ 再加一欄再重跑 ⇒ 同樣炸(可重現)" err 'cannot change name of view column "goods_axis" to "zz_probe2"'

echo
echo "── 結果: PASS=$PASS FAIL=$FAIL（世界數 7；PASS+FAIL 不等於 7 ⇒ 有格沒跑到）"
echo "🛑 射程: 見檔頭 —— fixture 的 orders 是最小重建, 這支證的是【機制】不是正式庫現況。"
[ $((PASS+FAIL)) -eq 7 ] || { echo "🔴 只跑了 $((PASS+FAIL)) 格 ⇒ 判紅"; exit 1; }
[ "$FAIL" -eq 0 ] || exit 1
exit 0
