#!/usr/bin/env bash
#
# `#13` 片1a 驗證 harness — 丟棄式 PostgreSQL 叢集上的行為證據。
#
#   bash scripts/e13-slice1a-verify.sh            # 全跑(provision → 步驟0 → 28 格 → 8 發突變 → 回退)
#   PORT=54372 bash scripts/e13-slice1a-verify.sh # 換 port(多視窗同時跑時)
#   KEEP=1 bash scripts/e13-slice1a-verify.sh     # 跑完不拆叢集(要進去手動查時用)
#   WIDE=1 bash scripts/e13-slice1a-verify.sh     # 🔴 送審必用:訊息逐字不截斷(預設會 cut -c1-130)
#
# ══ 為什麼要有這支(不是為了好看)══════════════════════════════════════════════
# `20260815040000_…_admin_update_order_item_amount.sql` 是 `.sql`
# ⇒ **對三綠(typecheck / lint / build)恆綠、零判別力**。
# 2026-08-15 首次實跑抓到兩個缺陷,**兩個都會讓該片在正式庫 apply 當場失敗**,
# 而 codex 兩輪散文審查 + 該檔自己的六道結構閘 + 三綠,**四道全部沒看到**:
#   ① 檔尾閘 ④ 自己的 SQL 型別錯:`|| p.provolatile` 未轉型 ⇒ `operator is not unique: text || "char"`。
#   ② trigger 函式寫 `CASE WHEN TG_TABLE_NAME='orders' THEN OLD.id ELSE OLD.order_id END`
#      ⇒ plpgsql 準備一條運算式時會把**裡面所有** record 欄位一起解析(不是只解析走得到的分支)
#      ⇒ 掛在 `orders` 上那支一觸發就 `record "old" has no field "order_id"`
#      ⇒ 而 `orders.subtotal` 是該 RPC 每次都改的欄 ⇒ **整個功能一次都跑不起來。**
# ⇒ 兩者都屬「**跑起來才發生**」。審散文答不了、驗結構也答不了。**只有實跑答得了。**
#
# ══ 這支證什麼、不證什麼 ═════════════════════════════════════════════════════
# ✅ 證:vanilla PG 上的**行為** —— RPC 各閘、跨列不變式 trigger、回退腳本、突變判別力。
# 🔴 不證:正式庫的 owner / 既有 ACL / 大量既有資料 / 併發 / 效能。**本機是 superuser=postgres 的乾淨叢集。**
# 🔴 不證:Supabase 平台差異(`pg_cron` / `vault` 兩支 migration 在此被跳過,同 d1t2-rehearsal.sh)。
#
# 🔴 突變還原一律 `cp` 基準檔 + sha256 逐字比對 ——
#    該 migration 目前 **untracked**,`git checkout` 對 untracked 檔是 **no-op**
#    ⇒ 用 git 還原會把突變留在成品裡,而後續發次的「紅」會被讀成突變有效(假紅)。
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
export LC_ALL=C   # macOS + zh_TW locale 會讓 postmaster 啟動即死

PORT="${PORT:-54371}"
KEEP="${KEEP:-0}"
WORK="${WORK:-/tmp/pge13}"   # 🔴 短路徑:unix socket 路徑上限 103 bytes,scratchpad 那種長路徑起不來
PGBIN="$(dirname "$(command -v initdb)")"
MIG=supabase/migrations/20260815040000_m4b_e10_13_slice1_admin_update_order_item_amount.sql
DOWN=scripts/20260815040000-down.sql

P="postgresql://postgres@127.0.0.1:${PORT}/postgres"
die() { echo "🔴 $*" >&2; exit 1; }
hdr() { echo ""; echo "════ $* ════"; }

# 🔴 `WORK` 底下會跑 `rm -rf`,而它可由外部覆寫(codex 關卡2 must-fix)。
#    誤設成 repo 路徑 = **刪掉工作樹**。這道閘在任何 rm 之前先跑。
# 🔴🔴 **先正規化再判**(codex 關卡2 R2 finding 12,E 機器重現):
#    舊版寫 `case "$WORK" in /tmp/?*)` —— **`?` 吃掉第二個斜線、`*` 匹配空字串**
#    ⇒ `WORK=/tmp//` **過閘**,而 `rm -rf "/tmp//"` 刪的是**整個 /tmp**。
#    ⚠️ 那不是判別力問題,是**會刪掉別人東西**、代價不可回復 ⇒ 與隔離同級優先。
# 🔴 判別句:**我拿去比對的字串,跟作業系統最後拿去動手的那個,是不是同一個?**
WORK="$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$WORK" 2>/dev/null || echo "$WORK")"
case "$WORK" in
  /tmp/?*|/private/tmp/?*) ;;
  *) die "WORK 正規化後必須是 /tmp 或 /private/tmp 底下的**子目錄**(正規化後:${WORK})。
     這支腳本會對 WORK 跑 rm -rf —— 指到別處等於刪那裡。" ;;
esac
case "$WORK" in *..*) die "WORK 不得含 '..'(收到:${WORK})" ;; esac
# 再一道:正規化後仍不得等於暫存根本身
case "$WORK" in /tmp|/private/tmp) die "WORK 不得是暫存根本身(${WORK})" ;; esac

TOTAL_FAIL=0
FAILED_CELLS=""   # 🔴 最近一次 cells 的失敗格名(換行分隔)。突變判定靠它,不靠肉眼。

# ───────────────────────────────────────────────────────── provision
provision() {
  hdr "provision:丟棄式 PG(port ${PORT})"
  # 🔴 起庫前先確認這個 port 沒有**別的** cluster 在聽(2026-08-09 P 窗實錘):
  #    否則後續 psql 會靜默連到別人的庫,症狀是「查詢有回值、看起來很正常」。
  if psql "$P" -qtA -c 'SELECT 1' >/dev/null 2>&1; then
    die "port ${PORT} 已經有別的 PostgreSQL 在聽(很可能是另一個視窗的 harness)。
     這是硬停:繼續下去查詢會打到**別人的庫**而毫無症狀。改用 PORT=54372 重跑。"
  fi
  rm -rf "$WORK"; mkdir -p "$WORK"
  "$PGBIN/initdb" --version
  "$PGBIN/initdb" -U postgres --auth=trust --locale=C --encoding=UTF8 -D "$WORK/pgdata" >/dev/null
  "$PGBIN/pg_ctl" -D "$WORK/pgdata" -l "$WORK/pg.log" \
    -o "-p ${PORT} -c unix_socket_directories='${WORK}'" start >/dev/null \
    || { cat "$WORK/pg.log" >&2; die "pg_ctl 啟動失敗(log 如上)"; }

  # 身分閘:data_directory 是唯一不會說謊的識別。
  local DD; DD="$(psql "$P" -qtA -c "SELECT current_setting('data_directory')")"
  [ "$DD" = "$WORK/pgdata" ] || die "身分閘:連到的 data_directory=${DD:-<查不到>},期望 ${WORK}/pgdata"
  echo "  身分閘 OK:$DD"

  psql "$P" -qtA -c 'CREATE DATABASE base' >/dev/null
  local B="postgresql://postgres@127.0.0.1:${PORT}/base"
  psql "$B" -v ON_ERROR_STOP=1 -q -f scripts/d1-supabase-shim.sql

  local FIRST_FITMENTS N=0
  FIRST_FITMENTS="$(grep -l 'product_fitments_effective' supabase/migrations/*.sql | sort | head -1)"
  for f in supabase/migrations/*.sql; do
    case "$f" in *20260723120000*|*20260809170000*) continue ;; esac   # pg_cron / vault
    [ "$f" = "$MIG" ] && continue                                      # 本片留給後面單獨 apply
    [ "$f" = "$FIRST_FITMENTS" ] && psql "$B" -v ON_ERROR_STOP=1 -q -f scripts/d1-fitments-bootstrap.sql
    psql "$B" -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null 2>&1 || die "migration 失敗:$f"
    N=$((N+1))
  done
  psql "$B" -v ON_ERROR_STOP=1 -q -f scripts/d1-fake-cron.sql >/dev/null
  echo "  套用 ${N} 支既有 migration(不含本片)"
  seed "$B"
}

# 四張測試單:O1 一般 / O2 一般(跨單調撥的對手)/ O3 已收款 / O4 有折扣
seed() {
  psql "$1" -v ON_ERROR_STOP=1 -q <<'EOF'
BEGIN;
INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-0000000000c1','e13@example.test');
-- 🔴 ON CONFLICT 是必要的,不是保險:`20260523034911` 的 `handle_new_auth_user` trigger
--    會在上面那筆 auth.users INSERT 時**自動建好** customers 列 ⇒ 這裡一定撞主鍵。
INSERT INTO public.customers (user_id, email, tier)
  VALUES ('00000000-0000-0000-0000-0000000000c1','e13@example.test','general')
  ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email, tier = EXCLUDED.tier;
INSERT INTO public.staff (id, label) VALUES ('e13staff','E13 測試員');
INSERT INTO public.orders
  (id, display_id, customer_user_id, shipping_address_snapshot, tier_at_checkout,
   subtotal, shipping_fee, discount_total, total, shipping_method, invoice,
   shipping_method_at_checkout, version)
VALUES
  ('00000000-0000-0000-0000-000000000001','B23456','00000000-0000-0000-0000-0000000000c1',
   '{"name":"甲","phone":"0900000000","line":"台北市"}','general',1000,0,0,1000,'home',
   '{"type":"donate","donateCode":"001"}','home',1),
  ('00000000-0000-0000-0000-000000000002','C23456','00000000-0000-0000-0000-0000000000c1',
   '{"name":"甲","phone":"0900000000","line":"台北市"}','general',500,0,0,500,'home',
   '{"type":"donate","donateCode":"001"}','home',1),
  ('00000000-0000-0000-0000-000000000003','D23456','00000000-0000-0000-0000-0000000000c1',
   '{"name":"甲","phone":"0900000000","line":"台北市"}','general',800,0,0,800,'home',
   '{"type":"donate","donateCode":"001"}','home',1),
  ('00000000-0000-0000-0000-000000000004','F23456','00000000-0000-0000-0000-0000000000c1',
   '{"name":"甲","phone":"0900000000","line":"台北市"}','general',900,0,100,800,'home',
   '{"type":"donate","donateCode":"001"}','home',1);
INSERT INTO public.order_items
  (id, order_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
VALUES
  ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000001',
   'SKU-1','{"title":"品項一","sku":"SKU-1","spec":{}}',2,500,1000),
  ('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-000000000002',
   'SKU-2','{"title":"品項二","sku":"SKU-2","spec":{}}',1,500,500),
  ('00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-000000000003',
   'SKU-3','{"title":"品項三","sku":"SKU-3","spec":{}}',2,400,800),
  ('00000000-0000-0000-0000-0000000000a4','00000000-0000-0000-0000-000000000004',
   'SKU-4','{"title":"品項四","sku":"SKU-4","spec":{}}',3,300,900);
INSERT INTO public.order_payments (order_id, rail, amount, received_at, actor, request_id)
VALUES ('00000000-0000-0000-0000-000000000003','cash',800, now(), 'e13staff',
        '00000000-0000-0000-0000-0000000000f1');
COMMIT;
EOF
  [ $? -eq 0 ] || die "seed 失敗"
  echo "  seed OK(4 張單:一般 / 一般 / 已收款 / 有折扣)"
}

# 🔴 每一輪先建 <TAG>_seed(從 base 複製 + 套本片),cells 再從它逐組複製。
#    這樣「套一次 migration、複製很多次」,而不是每格都重套(重套會慢十倍,也會讓檔尾閘跑 19 遍)。
prepare_run() { # prepare_run <TAG> ; 回傳 apply 的 exit code
  clone "${1}_seed"
  apply_to "${1}_seed"
}

clone() { # clone <dbname>
  psql "$P" -qtA -c "DROP DATABASE IF EXISTS $1" >/dev/null 2>&1
  psql "$P" -qtA -c "CREATE DATABASE $1 TEMPLATE base" >/dev/null || die "clone $1 失敗"
}

# ───────────────────────────────────────────────────────── 步驟 0:負向對照
step0() {
  hdr "步驟 0:環境健檢 + 負向對照(【不】套本片)"
  echo "   沒有這一步,「環境壞掉」會被讀成「突變有效」;而最後一行證明【病確實存在】。"
  clone t_pre
  local Z="postgresql://postgres@127.0.0.1:${PORT}/t_pre"
  local v
  v=$(psql "$Z" -qtA -c "SELECT public.admin_update_order_item_amount('00000000-0000-0000-0000-000000000001'::uuid,'00000000-0000-0000-0000-0000000000a1'::uuid,600,1,'e13staff','x',NULL)" 2>&1 | grep -c 'does not exist')
  chk "RPC 尚不存在" "1" "$v"
  chk "#13 trigger 尚不存在" "0" "$(psql "$Z" -qtA -c "SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'pcm_e13%'")"
  chk "seed 資料本來就一致(失衡列數)" "0" \
    "$(psql "$Z" -qtA -c "SELECT count(*) FROM orders o WHERE o.subtotal <> COALESCE((SELECT SUM(i.line_total) FROM order_items i WHERE i.order_id=o.id),0)")"
  # 🔴 這格證的是**跨列不變式那一件事**的判別力:本片不在時,失衡【靜靜 commit 成功】。
  # ⚠️ **它不是整套功能的負向對照**(codex 關卡2):它沒證 orders.subtotal / INSERT / DELETE /
  #    order_id 調撥也缺保護,更沒證 RPC 各閘、ACL、稽核、延遲觸發、rollback、正式庫或 Supabase。
  #    那些各自有自己的格(N1-N8 / G1-G9 / S1-S3),**不要拿這一格當它們的對照**。
  chk "🔴 負向對照:本片不在時失衡寫得進去" "1000 vs 2" \
    "$(psql "$Z" -qtA -c "BEGIN; UPDATE order_items SET unit_price=1,line_total=2 WHERE id='00000000-0000-0000-0000-0000000000a1'; COMMIT; SELECT o.subtotal||' vs '||(SELECT SUM(i.line_total) FROM order_items i WHERE i.order_id=o.id) FROM orders o WHERE o.id='00000000-0000-0000-0000-000000000001'" 2>&1)"
}

chk() { # chk <名稱> <期望> <實得>
  if [ "$3" = "$2" ]; then printf '  ✅ %-40s %s\n' "$1" "$3"
  else printf '  ❌ %-40s 期望[%s] 實得[%s]\n' "$1" "$2" "$3"; TOTAL_FAIL=$((TOTAL_FAIL+1)); fi
}

# ───────────────────────────────────────────────────────── 28 格
cells() { # cells <dbname>
  local DB="$1"
  local U=""   # 🔴 由 grp() 指向當前那一組的專屬 database
  local O1=00000000-0000-0000-0000-000000000001 O2=00000000-0000-0000-0000-000000000002
  local O3=00000000-0000-0000-0000-000000000003 O4=00000000-0000-0000-0000-000000000004
  local A1=00000000-0000-0000-0000-0000000000a1 A2=00000000-0000-0000-0000-0000000000a2
  local A3=00000000-0000-0000-0000-0000000000a3 A4=00000000-0000-0000-0000-0000000000a4
  local RPC="SELECT public.admin_update_order_item_amount"
  local PASS=0 FAIL=0
  FAILED_CELLS=""   # 🔴 全域(不加 local)—— 突變判定要在父 shell 讀得到它
  ALL_CELLS=""      # 🔴 全域:跑過的格名全集,給 assert_mut 抓拼錯用

  # ══ 🔴🔴 逐格隔離(codex 關卡2 R2 finding 1-7,最重的一條)═══════════════════════
  # **舊版 28 格共用同一個 clone,而每一格都是 `BEGIN…COMMIT`。**
  #   · 守門在的時候看不出來 —— 所有負測格都被擋下、零留痕。
  #   · **守門被突變拿掉的時候**,每個「應紅而未紅」的格都會**成功提交**
  #     ⇒ 後面每一格都跑在非預期的前提上 ⇒ **flip/hold 的觀測全部可疑。**
  # 🔴 實例(這條打到我上一輪的自我更正):M3 那發 N3 沒紅,**不是**因為 NEW 那側守住了,
  #    是因為 N1/N2 在突變下成功提交、把 O2 改掉了,N3 因此在非預期狀態上跑。
  #    ⇒ **我那次「發現自己模型過期」的再推導,建立在被污染的觀測上。**
  #      判別句本身仍對,**錯的是支持它的那次觀測。**
  #
  # ⚠️ **為什麼不用「每格 BEGIN…ROLLBACK」**:本片守門是 `DEFERRABLE INITIALLY DEFERRED`
  #    ⇒ **它在 COMMIT 那一刻才觸發**。ROLLBACK 等於把要測的東西測掉。
  # ⇒ 作法:**每一組一個全新的 database**(從已套用本片的 `<TAG>_seed` 用 TEMPLATE 複製,
  #    實測 124 ms/次)。**COMMIT 語意原封不動,而組與組之間物理隔離。**
  local SEED="${DB}_seed" CURDB=""
  grp() {  # grp <組名> —— 開一個乾淨的庫,後續 cell 都在它上面跑
    local prev="$CURDB"
    CURDB="${DB}_$1"
    psql "$P" -qtA -c "DROP DATABASE IF EXISTS ${CURDB}" >/dev/null 2>&1
    psql "$P" -qtA -c "CREATE DATABASE ${CURDB} TEMPLATE ${SEED}" >/dev/null || die "grp $1 clone 失敗"
    U="postgresql://postgres@127.0.0.1:${PORT}/${CURDB}"
    [ -n "$prev" ] && psql "$P" -qtA -c "DROP DATABASE IF EXISTS ${prev}" >/dev/null 2>&1
    return 0
  }
  # cell <名稱> <期望:字串;或 ERR:片語> <sql>
  # 🔴 VERBOSITY=verbose:不開的話 psql 不印 SQLSTATE 與 CONSTRAINT 名
  #    ⇒ 「有錯」與「錯在我期望的那道閘」會被混為一談。
  cell() {
    local name="$1" expect="$2" sql="$3" out rc ok=0
    out="$(psql "$U" -qtA -v VERBOSITY=verbose -c "$sql" 2>&1)"; rc=$?
    case "$expect" in
      ERR:*) [ $rc -ne 0 ] && echo "$out" | grep -q -- "${expect#ERR:}" && ok=1 ;;
      *)     [ $rc -eq 0 ] && [ "$(echo "$out" | tr -d '\n')" = "$expect" ] && ok=1 ;;
    esac
    ALL_CELLS="${ALL_CELLS}${ALL_CELLS:+
}${name}"
    # 🔴 失敗格名累積到全域,給突變的機器裁判用(不靠人看 grep 出來的幾行)
    [ $ok = 1 ] || FAILED_CELLS="${FAILED_CELLS}${FAILED_CELLS:+
}${name}"
    # 🔴 `WIDE=1` = 完全不截斷。預設截斷是為了讀得下,但**送審時必須用 WIDE=1** ——
    #    審查者要拿「紅在哪一格 + 訊息逐字」去比對「修了哪幾處」,
    #    而截掉的那一段不留痕跡(今天已經被 `head -N` 切掉結論行騙過一次)。
    if [ "${WIDE:-0}" = "1" ]; then
      if [ $ok = 1 ]; then PASS=$((PASS+1)); printf '  ✅ %s\n' "$name"
      else FAIL=$((FAIL+1)); printf '  ❌ %s\n       期望│%s\n' "$name" "$expect"; fi
      echo "$out" | sed 's/^/       │/'
    # 🔴🔴 `cut -c` 在 `LC_ALL=C` 下是**按 byte 切**,會把中文字切成半個
    #    ⇒ 整份 log 變成**非法 UTF-8** ⇒ **BSD grep 判定它是二進位檔、直接不輸出任何東西**
    #    ⇒ 而 `grep -c` 連 `0` 都不印、exit 1 ⇒ **「grep 什麼都沒印」會被讀成「沒有這個東西」**。
    #    ⚠️ 2026-08-15 我自己在這份 log 上栽了至少三次(每次都當成「沒命中」跳過)。
    #    ⇒ `iconv -c` 把切壞的尾巴丟掉,保證輸出是合法 UTF-8。**下游的量具才量得到。**
    elif [ $ok = 1 ]; then PASS=$((PASS+1)); printf '  ✅ %-36s %s\n' "$name" "$(echo "$out"|head -1|cut -c1-80|iconv -c -f UTF-8 -t UTF-8)"
    else FAIL=$((FAIL+1)); printf '  ❌ %-36s 期望[%s] 實得[%s]\n' "$name" "$expect" "$(echo "$out"|head -2|tr '\n' ' '|cut -c1-130|iconv -c -f UTF-8 -t UTF-8)"; fi
  }

  # 🔴 P 系列是【刻意鏈接】的一組:P1 改價 → P1b/P1c 驗結果 → P2/P3/P4 吃被 P1 bump 的 version
  #    → P4b 驗零元結果 → G8/G8b 吃 P4 bump 到的 version 3。
  #    ⇒ 它們共用一個庫是**設計**,不是污染。**其餘每一格各自一個乾淨庫。**
  #    ⚠️ 因此突變判定時,P 系列只對【鏈頭 P1】下斷言,其餘視為連鎖。
  grp p
  echo "── 正向(P 系列 = 刻意鏈接,共用一個乾淨庫)──"
  cell "P1 正常改價 500→600" "OK"                    "$RPC('$O1','$A1',600,1,'e13staff','r-p1',NULL)"
  cell "P1b 改後 subtotal/total/line/ver" "1200|1200|1200|2" \
    "SELECT o.subtotal||'|'||o.total||'|'||i.line_total||'|'||o.version FROM orders o JOIN order_items i ON i.id='$A1' WHERE o.id='$O1'"
  cell "P1c 稽核逐欄 before/after" "500|1000|600|1200" \
    "SELECT (before->>'unit_price')||'|'||(before->>'subtotal')||'|'||(after->>'unit_price')||'|'||(after->>'subtotal') FROM admin_audit_log WHERE action='order.item.amount.update'"
  cell "P2 NOOP(同價)" "NOOP"                        "$RPC('$O1','$A1',600,2,'e13staff','r-p2',NULL)"
  cell "P3 樂觀鎖不符" "CONFLICT"                     "$RPC('$O1','$A1',700,999,'e13staff','r-p3',NULL)"
  cell "P4 零元帶原因" "OK"                           "$RPC('$O1','$A1',0,2,'e13staff','r-p4','贈品')"
  cell "P4b 零元後 subtotal=0" "0|0"                  "SELECT subtotal||'|'||total FROM orders WHERE id='$O1'"

  echo "── RPC 閘(負向;每格各自一個乾淨庫)──"
  grp g1
  cell "G1 零元未帶原因" "ERR:pcm_e13_zero_price_needs_reason"   "$RPC('$O2','$A2',0,1,'e13staff','r-g1',NULL)"
  grp g2
  cell "G2 非零卻帶原因" "ERR:pcm_e13_reason_only_for_zero"      "$RPC('$O2','$A2',600,1,'e13staff','r-g2','贈品')"
  grp g3
  cell "G3 已收款單拒改" "ERR:pcm_e13_no_edit_after_payment"     "$RPC('$O3','$A3',500,1,'e13staff','r-g3',NULL)"
  grp g4
  cell "G4 折扣單拒改" "ERR:pcm_e13_discount_not_supported"      "$RPC('$O4','$A4',400,1,'e13staff','r-g4',NULL)"
  grp g5
  cell "G5 品項不屬於這張單" "ERR:不屬於這張訂單"                "$RPC('$O2','$A3',600,1,'e13staff','r-g5',NULL)"
  grp g6
  cell "G6 缺 actor" "ERR:缺 actor"                              "$RPC('$O2','$A2',600,1,'','r-g6',NULL)"
  grp g7
  cell "G7 負價" "ERR:必須是非負整數"                            "$RPC('$O2','$A2',-1,1,'e13staff','r-g7',NULL)"
  # 🔴 用 A1(數量 2)不是 A2(數量 1)—— 數量 1 時乘出來剛好【等於】上限、不會溢位,那格會恆綠。
  # 🔴 逐格隔離之後 G8 不再吃 P 系列 bump 過的 version ——
  #    它自己一個乾淨庫 ⇒ version 回到 seed 的 1,而 A1 數量 2 ⇒ 2147483647×2 仍溢位。
  #    ⚠️ 改成獨立比「想辦法讓它留在 P 鏈裡」乾淨:**這格本來就不需要前面任何一格。**
  grp g8
  cell "G8 line_total 溢位(數量 2)" "ERR:pcm_e13_line_total_overflow" \
    "$RPC('$O1','$A1',2147483647,1,'e13staff','r-g8',NULL)"
  cell "G8b 溢位後零留痕(仍是 seed 值)" "1000|1000|1" \
    "SELECT o.subtotal||'|'||i.line_total||'|'||o.version FROM orders o JOIN order_items i ON i.id='$A1' WHERE o.id='$O1'"
  grp g9
  cell "G9 anon 不得 EXECUTE" "ERR:42501"            "SET ROLE anon; $RPC('$O2','$A2',600,1,'e13staff','r-g9',NULL)"

  echo "── constraint trigger(跨列不變式;每格各自一個乾淨庫)──"
  grp n1
  cell "N1 只改 line_total 不改 subtotal" "ERR:pcm_e13_subtotal_matches_lines" \
    "BEGIN; UPDATE order_items SET unit_price=700,line_total=700 WHERE id='$A2'; COMMIT"
  grp n2
  cell "N2 只改 orders.subtotal" "ERR:pcm_e13_subtotal_matches_lines" \
    "BEGIN; UPDATE orders SET subtotal=999,total=999 WHERE id='$O2'; COMMIT"
  # 🔴 只補【新單】那側 ⇒ 唯一失衡的是舊單 ⇒ 這格專驗 OLD 那半(codex R2 #1 修的東西)。
  grp n3
  cell "N3 跨單調撥(只補新單=驗 OLD 那側)" "ERR:pcm_e13_subtotal_matches_lines" \
    "BEGIN; UPDATE order_items SET order_id='$O3' WHERE id='$A2'; UPDATE orders SET subtotal=1300,total=1300 WHERE id='$O3'; COMMIT"
  grp n4
  cell "N4 刪品項不動 subtotal" "ERR:pcm_e13_subtotal_matches_lines" \
    "BEGIN; DELETE FROM order_items WHERE id='$A2'; COMMIT"
  grp n5
  cell "N5 新增品項不動 subtotal" "ERR:pcm_e13_subtotal_matches_lines" \
    "BEGIN; INSERT INTO order_items (order_id,variant_sku,product_snapshot,quantity,unit_price,line_total) VALUES ('$O2','SKU-X','{\"title\":\"x\",\"sku\":\"SKU-X\",\"spec\":{}}',1,50,50); COMMIT"
  grp n6
  cell "N6 正向對照:兩邊都補 ⇒ 過" "500" \
    "BEGIN; UPDATE order_items SET unit_price=250,line_total=250 WHERE id='$A2'; UPDATE orders SET subtotal=250,total=250 WHERE id='$O2'; COMMIT; SELECT 500"
  grp n7
  cell "N7 交易【中途】允許不一致" "t" \
    "BEGIN; UPDATE order_items SET unit_price=999,line_total=999 WHERE id='$A2'; SELECT true; ROLLBACK"
  grp n8
  cell "N8 整單刪除(CASCADE)不算違規" "t" \
    "BEGIN; DELETE FROM order_items WHERE order_id='$O2'; DELETE FROM orders WHERE id='$O2'; COMMIT; SELECT true"

  echo "── 結構(唯讀,共用一個乾淨庫)──"
  grp s
  cell "S1 兩支 trigger 皆 DEFERRABLE+DEFERRED" "2" \
    "SELECT count(*) FROM pg_trigger WHERE tgname IN ('pcm_e13_items_subtotal_guard','pcm_e13_orders_subtotal_guard') AND tgdeferrable AND tginitdeferred AND NOT tgisinternal"
  cell "S2 RPC 屬性" "true|plpgsql|v|search_path=\"\"" \
    "SELECT p.prosecdef::text||'|'||l.lanname::text||'|'||p.provolatile::text||'|'||array_to_string(p.proconfig,',') FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.oid='public.admin_update_order_item_amount(uuid,uuid,integer,integer,text,text,text)'::regprocedure"
  cell "S3 EXECUTE 只有 owner+service_role" "postgres, service_role" \
    "SELECT string_agg(pg_get_userbyid(g.grantee),', ' ORDER BY pg_get_userbyid(g.grantee)) FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) g WHERE p.oid='public.admin_update_order_item_amount(uuid,uuid,integer,integer,text,text,text)'::regprocedure AND g.privilege_type='EXECUTE'"

  [ -n "$CURDB" ] && psql "$P" -qtA -c "DROP DATABASE IF EXISTS ${CURDB}" >/dev/null 2>&1
  echo "  ⇒ ${DB}: PASS=${PASS} FAIL=${FAIL}(逐格隔離:19 個乾淨庫)"
  LAST_PASS=$PASS; LAST_FAIL=$FAIL
}

# 🔴🔴 **這裡本來有一個 `filt()`,而它是本腳本最嚴重的缺陷**(codex 關卡2 must-fix,E 機器重現):
#    `cells t_mN | filt …` —— **管線左側在子程序執行** ⇒ `cells` 對 `TOTAL_FAIL` / `FAILED_CELLS`
#    的所有增量**收不回父 shell**(bash 3.2.57 實測:有管線父看到 0、無管線父看到 7)。
#    ⇒ 三發突變裡每一個失敗格的貢獻**恆為 0**,而收尾照樣印「✅ 全數通過(… + 4 發突變 + 回退)」。
#    ⚠️ **那行字把突變寫進通過宣告,而 exit 邏輯結構上接不到它們。**
# 🔴 **⇒ 教訓不是「別用管線」,是【落成腳本本身不是保證,腳本的裁判也要被驗】。**
#    我當天才寫過「只寫在信裡的數字沒有東西會攔、落成腳本之後腳本自己會抓」——
#    而那支腳本在最關鍵的三格上,結構上抓不到。
# ⇒ 現在:**完全不用管線**,並且突變改由 `assert_mut` 逐格機器判定(見下)。

apply_to() { # apply_to <dbname> ; 回傳 psql 的 exit code,完整輸出留在 $WORK/apply-<db>.log
  # 🔴 VERBOSITY=verbose:不開的話 psql 不印 SQLSTATE 與 CONSTRAINT NAME
  #    ⇒ assert_apply_fails_with 拿約束名去比對會恆不命中(2026-08-15 第一次跑就撞到)。
  psql "postgresql://postgres@127.0.0.1:${PORT}/$1" -v ON_ERROR_STOP=1 -v VERBOSITY=verbose \
    -q -f "$MIG" > "$WORK/apply-$1.log" 2>&1
  local rc=$?
  grep -E 'ERROR|FATAL' "$WORK/apply-$1.log" | sed 's/^/     /'
  return $rc
}

# 突變裡 cells 的輸出:WIDE=1 整份印(送審要逐字),平時只印統計行。
mut_cells_out() {
  if [ "${WIDE:-0}" = "1" ]; then sed 's/^/     /' "$WORK/cells-$1.log"
  else grep -E '⇒ ' "$WORK/cells-$1.log" | sed 's/^/     /'; fi
}

# 🔴 突變判定的機器裁判 —— 取代原本「肉眼看 grep 出來的幾行」。
#    flip = 這發突變**必須讓它由綠轉紅**的格(少一個 ⇒ 突變沒打中)
#    hold = 這發突變**必須保持綠**的格(紅了 ⇒ 突變打錯地方)
#    ⚠️ 不用「失敗格全集相等」當判準,因為突變會產生**連鎖紅**(P1 紅 ⇒ version 沒 bump ⇒ 後面跟著 CONFLICT)
#       ⇒ 全集相等會把連鎖也綁進判準、變得脆弱。**判別力的證據是【哪一格】,不是【幾格】。**
assert_mut() { # assert_mut <突變名> <flip 清單> <允許的連鎖清單>
  # 🔴🔴 **hold 改成窮舉,不再手列**(codex 關卡2 R2 finding 6:M7 只 hold 了 N1
  #    ⇒ 「orders fail-closed 命中」與「其他一大片功能被炸壞」分不出來)。
  #    現在的判準:
  #      flip    = 這發突變**必須**讓它由綠轉紅(少一個 ⇒ 突變沒打中)
  #      cascade = **已知會跟著紅的下游格**(例:P 系列鏈頭 P1 紅 ⇒ 後面吃 version 的格必紅)
  #      hold    = **其餘【全部】格**,由 ALL_CELLS 減出來 —— **不用人維護,漏不掉**
  #    ⇒ 任何落在 flip ∪ cascade 之外卻紅了的格 = 突變打到了不該打的地方。
  # ⚠️ cascade 要逐發寫理由;**把不想處理的格丟進 cascade = 自己把判別力關掉**,審查時盯這裡。
  local name="$1" flip="$2" cascade="$3" bad=0 c
  if [ -z "$flip" ]; then
    TOTAL_FAIL=$((TOTAL_FAIL+1)); printf '     🔴 %s:flip 清單是空的 ⇒ 這發什麼都沒斷言,拒絕記成通過\n' "$name"; return
  fi
  # 名字打錯的兩個方向都要抓(finding 8:hold 拼錯會靜默通過)
  while IFS= read -r c; do
    [ -z "$c" ] && continue
    printf '%s\n' "$ALL_CELLS" | grep -qxF "$c" || {
      printf '     🔴 %s:清單裡的【%s】不是本輪跑過的格名(拼錯?格改名了?)\n' "$name" "$c"; bad=1; }
  done <<EOF
$flip
$cascade
EOF
  printf '     觀測到的失敗格(全集):\n'
  if [ -z "$FAILED_CELLS" ]; then printf '       (無)\n'; else printf '%s\n' "$FAILED_CELLS" | sed 's/^/       · /'; fi
  # ① flip 必須全部命中
  while IFS= read -r c; do
    [ -z "$c" ] && continue
    if printf '%s\n' "$FAILED_CELLS" | grep -qxF "$c"; then printf '     ✅ flip 命中:%s\n' "$c"
    else printf '     🔴 %s:期望轉紅的【%s】沒有紅 ⇒ 突變沒打中\n' "$name" "$c"; bad=1; fi
  done <<EOF
$flip
EOF
  # ② 其餘全部必須維持綠(窮舉,不手列)
  local nhold=0
  while IFS= read -r c; do
    [ -z "$c" ] && continue
    printf '%s\n' "$flip"    | grep -qxF "$c" && continue
    printf '%s\n' "$cascade" | grep -qxF "$c" && continue
    nhold=$((nhold+1))
    if printf '%s\n' "$FAILED_CELLS" | grep -qxF "$c"; then
      printf '     🔴 %s:應維持綠的【%s】卻紅了 ⇒ 突變打到不該打的地方(或 cascade 沒宣告)\n' "$name" "$c"; bad=1
    fi
  done <<EOF
$ALL_CELLS
EOF
  printf '     ℹ️  窮舉 hold 了 %s 格(= 全部 %s 格 − flip − 已宣告的連鎖)\n' "$nhold" "$(printf '%s\n' "$ALL_CELLS" | grep -c .)"
  if [ "$bad" = 0 ]; then printf '     ✅ %s 判定通過\n' "$name"
  else TOTAL_FAIL=$((TOTAL_FAIL+1)); printf '     🔴 %s 判定失敗\n' "$name"; fi
}

# 🔴 apply 必須失敗、而且要失敗在指定的錯誤上(codex 關卡2:原版只判「有沒有失敗」
#    ⇒ 任何無關的 apply error 都會被標成「如期失敗」)。
assert_apply_fails_with() { # <突變名> <dbname> <期望出現在 apply log 的字串>
  local name="$1" db="$2" want="$3"
  # 🔴 空字串會讓 `grep -qF ""` 恆真 ⇒ **任何**無關的 apply 錯誤都被判成「如期失敗」
  #    (codex 關卡2 R2 finding 9;E 實跑 `echo x | grep -qF ""` ⇒ exit 0)。
  #    ⚠️ 這與上一輪 M1「只判有沒有失敗、不判失敗在哪」是同一個病換了位置。
  if [ -z "$want" ]; then
    TOTAL_FAIL=$((TOTAL_FAIL+1)); printf '     🔴 %s:期望字串是空的 ⇒ 裁判會恆真,拒絕執行\n' "$name"; return
  fi
  if apply_to "$db" >/dev/null 2>&1; then
    TOTAL_FAIL=$((TOTAL_FAIL+1)); printf '     🔴 %s:apply 竟然成功 ⇒ 該道閘是 no-op\n' "$name"; return
  fi
  if grep -qF "$want" "$WORK/apply-$db.log"; then
    printf '     ✅ %s:apply 如期失敗,且訊息含【%s】\n' "$name" "$want"
    grep -E 'ERROR' "$WORK/apply-$db.log" | head -2 | sed 's/^/       │/'
  else
    TOTAL_FAIL=$((TOTAL_FAIL+1))
    printf '     🔴 %s:apply 失敗了,但訊息【不含】期望的 %s ⇒ 可能死在別的地方\n' "$name" "$want"
    grep -E 'ERROR' "$WORK/apply-$db.log" | head -3 | sed 's/^/       │/'
  fi
}

# ───────────────────────────────────────────────────────── 突變
BASE=""
mut() { # mut <old> <new> <期望命中次數>
  python3 - "$MIG" "$1" "$2" "$3" <<'PY'
import sys, pathlib
p = pathlib.Path(sys.argv[1]); s = p.read_text()
old, new, n = sys.argv[2], sys.argv[3], int(sys.argv[4])
got = s.count(old)
assert got == n, f'🔴 突變 anchor 命中 {got} 次,期望 {n} —— 檔案已改過?突變沒套用就跑等於假綠'
p.write_text(s.replace(old, new))
PY
  [ $? -eq 0 ] || die "突變 anchor 對不上,停"
}
restore() {
  cp "$BASE" "$MIG"
  local now want
  now="$(shasum -a 256 "$MIG" | cut -d' ' -f1)"
  want="$(shasum -a 256 "$BASE" | cut -d' ' -f1)"
  [ "$now" = "$want" ] || die "還原失敗:$now != $want —— **停下來,成品裡可能還留著突變**"
  echo "     ♻️  還原 OK sha=${now:0:16}…"
}

teardown() {
  [ "$KEEP" = "1" ] && { echo ""; echo "KEEP=1 ⇒ 叢集保留在 ${WORK}(port ${PORT});用完請自行 pg_ctl stop"; return; }
  "$PGBIN/pg_ctl" -D "$WORK/pgdata" stop -m immediate >/dev/null 2>&1
  rm -rf "$WORK"
  echo ""
  echo "叢集已拆(${WORK} 已刪)"
}

# ═════════════════════════════════════════════════════════ main
[ -f "$MIG" ]  || die "找不到 $MIG"
[ -f "$DOWN" ] || die "找不到 $DOWN"
BASE="$(mktemp -t e13base)"
cp "$MIG" "$BASE"
# 🔴 中途 Ctrl-C 或 die 都要做兩件事,少做任何一件下一次跑都會壞:
#    ① 還原 migration —— 否則突變留在成品裡(`git checkout` 對 untracked 是 no-op,救不回來)。
#    ② 停掉叢集 —— 否則下一次跑會撞自己的 port 閘。2026-08-15 首次落檔當天就踩到。
cleanup() {
  cp "$BASE" "$MIG"; rm -f "$BASE"
  [ "$KEEP" = "1" ] || "$PGBIN/pg_ctl" -D "$WORK/pgdata" stop -m immediate >/dev/null 2>&1
}
trap cleanup EXIT

provision
step0

hdr "步驟 1-3:apply 本片 → 28 格"
prepare_run t_base || die "apply 失敗(見上)—— 不跑 cells"
echo "  apply exit=0"
cells t_base
[ "$LAST_FAIL" = 0 ] || { TOTAL_FAIL=$((TOTAL_FAIL+LAST_FAIL)); echo "  🔴 baseline 不綠 ⇒ 突變結果無意義,停"; teardown; exit 1; }
BASELINE_PASS=$LAST_PASS

hdr "步驟 4:突變 8 發(每發都由 assert_mut / assert_apply_fails_with 機器判定)"
echo "  🔴 判準:flip = 必須由綠轉紅的格;hold = 必須維持綠的格。"
echo "     hold 紅了 = 突變打錯地方;flip 沒紅 = 突變沒打中。兩者都會讓本步驟失敗。"

# 格名常數 —— 與 cells() 裡的字面必須逐字相同(打錯 ⇒ flip 永遠對不上 ⇒ 會紅,不會靜默通過)
C_P1="P1 正常改價 500→600"
C_N1="N1 只改 line_total 不改 subtotal"
C_N2="N2 只改 orders.subtotal"
C_N3="N3 跨單調撥(只補新單=驗 OLD 那側)"
C_N4="N4 刪品項不動 subtotal"
C_N5="N5 新增品項不動 subtotal"
C_S1="S1 兩支 trigger 皆 DEFERRABLE+DEFERRED"
C_N6="N6 正向對照:兩邊都補 ⇒ 過"
C_N7="N7 交易【中途】允許不一致"
C_N8="N8 整單刪除(CASCADE)不算違規"
# 🔴 P 系列的連鎖:鏈頭 P1 紅 ⇒ 這五格必然跟著紅(它們吃 P1 bump 的 version / 驗 P1 的結果)。
#    **宣告連鎖 = 承認它們這一發沒有判別力**,不是把它們藏起來。
P_CASCADE="P1b 改後 subtotal/total/line/ver
P1c 稽核逐欄 before/after
P2 NOOP(同價)
P4 零元帶原因
P4b 零元後 subtotal=0"

echo ""
echo "  ── M1:DEFERRABLE INITIALLY DEFERRED → NOT DEFERRABLE(檔尾閘 ⑥ 原樣)"
mut "  DEFERRABLE INITIALLY DEFERRED" "  NOT DEFERRABLE" 2
clone t_m1_seed
assert_apply_fails_with "M1" t_m1_seed "pcm_e13_triggers_deferred"
restore

echo ""
echo "  ── M2:M1 + 拿掉閘 ⑥ 的 DEFERRABLE 斷言 ⇒ 證明 DEFERRED 是功能跑得起來的必要條件"
mut "  DEFERRABLE INITIALLY DEFERRED" "  NOT DEFERRABLE" 2
mut "     AND t.tgdeferrable AND t.tginitdeferred AND NOT t.tgisinternal" "     AND NOT t.tgisinternal" 1
if prepare_run t_m2; then
  cells t_m2 > "$WORK/cells-t_m2.log"; mut_cells_out t_m2
  # 🔴 hold 放 N1:負測本來就該紅。**它若也「轉紅」就分不出突變打到哪** —— 但它在 baseline 已經是紅(=✅ 格),
  #    所以正確的 hold 語意是「這格不得【失敗】」,而它本來就不失敗 ⇒ 突變打錯地方時才會失敗。
  # 乾淨隔離實測:NOT DEFERRABLE ⇒ 檢查提早到每個 statement
  #   flip = P1(RPC 中途必然不一致)/ S1(屬性直接被驗)/ N6 N7 N8(交易中途一致性正是 DEFERRED 買來的)
  assert_mut "M2" "$C_P1
$C_S1
$C_N6
$C_N7
$C_N8" "$P_CASCADE"
else
  TOTAL_FAIL=$((TOTAL_FAIL+1)); echo "     🔴 M2:apply 失敗 ⇒ 這發沒測到任何東西(原版會靜靜跳過)"
fi
restore

echo ""
echo "  ── M3:拿掉 OLD 那側的檢查"
echo "     期望 flip=N1/N2/N4(去重之後,同單 UPDATE 全靠 OLD 那側),hold=N3(跨單走 NEW 那側)"
mut "  IF v_old IS NOT NULL THEN
    PERFORM public.pcm_e13_assert_order_subtotal_matches(v_old);
  END IF;
" "" 1
if prepare_run t_m3; then
  cells t_m3 > "$WORK/cells-t_m3.log"; mut_cells_out t_m3
  # 🔴🔴 **這組期望值我第一次寫錯了,而錯法本身是本輪最值得記的一件事**:
  #    我按「拿掉 OLD ⇒ 跨單調撥與刪品項失去保護」寫,那是**加入去重之前**的模型。
  #    加了「同 row-event 去重」之後:同一張單的 UPDATE 會走 v_old 那側(v_new 與 v_old 相同 ⇒ 跳過)
  #    ⇒ **拿掉 OLD,連 N1/N2 這種最普通的改動都完全沒人守了**;
  #    而 N3 跨單調撥反而**還活著**,因為 v_new ≠ v_old ⇒ NEW 那側照樣檢查到新單。
  #    ⇒ 判別句:**我改的是去重,而「哪一格在守什麼」是它的下游,不會自己跟著更新。**
  # 🔴 乾淨隔離實測推翻我上一輪的期望值:**N3 確實 flip**(codex R2 finding 1 是對的)。
  #    上一輪 N3 沒紅,是因為 N1/N2 在突變下成功提交、把 O2 改掉了 ⇒ N3 跑在非預期狀態上。
  #    ⇒ 乾淨狀態下:拿掉 OLD ⇒ 舊單失衡無人守 ⇒ N1/N2/N3/N4 全 flip。
  assert_mut "M3" "$C_N1
$C_N2
$C_N3
$C_N4" ""
else
  TOTAL_FAIL=$((TOTAL_FAIL+1)); echo "     🔴 M3:apply 失敗 ⇒ 這發沒測到任何東西"
fi
restore

echo ""
echo "  ── M4:trigger 監看欄漏掉 order_id(= 三個人都寫過的那版)"
mut "AFTER INSERT OR DELETE OR UPDATE OF line_total, order_id ON public.order_items" \
    "AFTER INSERT OR DELETE OR UPDATE OF line_total ON public.order_items" 1
if prepare_run t_m4; then
  cells t_m4 > "$WORK/cells-t_m4.log"; mut_cells_out t_m4
  # 乾淨隔離實測:只有 N3 flip(N6 與 order_id 無關 ⇒ 由窮舉 hold 蓋住,不必手列)
  assert_mut "M4" "$C_N3" ""
else
  TOTAL_FAIL=$((TOTAL_FAIL+1)); echo "     🔴 M4:apply 失敗 ⇒ 這發沒測到任何東西"
fi
restore

echo ""
echo "  ── M5:把檔尾閘 ④ 的兩個 ::text 拿掉(= 實跑抓到的缺陷 ① 回歸)"
echo "     🔴 存在理由(codex 關卡2):缺陷 ① 的修法原本【沒有任何一發突變打得到】"
echo "        ⇒ 只有 baseline apply 證明現版可跑,沒有證明測試抓得回它。"
mut "l.lanname::text || '/' || p.provolatile::text" "l.lanname || '/' || p.provolatile" 1
clone t_m5_seed
assert_apply_fails_with "M5" t_m5_seed "operator is not unique"
restore

echo ""
echo "  ── M6:order_items 分支讀錯欄(OLD.order_id → OLD.id)"
echo "     🔴 存在理由(codex 關卡2):【取值方式本身】原本零突變覆蓋;M3 刪的是整段,隔離不了它。"
mut "    IF TG_OP IN ('UPDATE', 'DELETE') THEN v_old := OLD.order_id; END IF;" \
    "    IF TG_OP IN ('UPDATE', 'DELETE') THEN v_old := OLD.id;       END IF;" 1
if prepare_run t_m6; then
  cells t_m6 > "$WORK/cells-t_m6.log"; mut_cells_out t_m6
  # 讀成品項自己的 id ⇒ 查無該訂單 ⇒ assert 靜默 RETURN ⇒ OLD 那側整個失效
  # 乾淨隔離實測:讀成品項自己的 id ⇒ 查無該訂單 ⇒ OLD 那側整個失效 ⇒ N3/N4 flip
  assert_mut "M6" "$C_N3
$C_N4" ""
else
  TOTAL_FAIL=$((TOTAL_FAIL+1)); echo "     🔴 M6:apply 失敗 ⇒ 這發沒測到任何東西"
fi
restore

echo ""
echo "  ── M7:把 IF 的表名打錯 ⇒ orders 的 trigger 落到 ELSE"
echo "     🔴 存在理由:證明 ELSE 的 fail-closed 是活的(那道是 to_jsonb fail-open 的直接對策)"
mut "  IF TG_TABLE_NAME = 'orders' THEN" "  IF TG_TABLE_NAME = 'orders_typo' THEN" 1
if prepare_run t_m7; then
  cells t_m7 > "$WORK/cells-t_m7.log"; mut_cells_out t_m7
  # 🔴 乾淨隔離實測:**N6 也 flip**(codex R2 finding 5 是對的)——
  #    N6 那格自己就會 UPDATE orders ⇒ 直接踩到落入 ELSE 的 orders trigger。
  assert_mut "M7" "$C_P1
$C_N2
$C_N6" "$P_CASCADE"
else
  TOTAL_FAIL=$((TOTAL_FAIL+1)); echo "     🔴 M7:apply 失敗 ⇒ 這發沒測到任何東西"
fi
restore

echo ""
echo "  ── M8:拿掉 NEW 那側的檢查"
echo "     🔴 存在理由(codex 關卡2 nit):NEW 半邊原本完全沒被四發碰到。"
mut "  IF v_new IS NOT NULL AND v_new IS DISTINCT FROM v_old THEN
    PERFORM public.pcm_e13_assert_order_subtotal_matches(v_new);
  END IF;
" "" 1
if prepare_run t_m8; then
  cells t_m8 > "$WORK/cells-t_m8.log"; mut_cells_out t_m8
  # 去重之後,一般 UPDATE 走的是 OLD 那側 ⇒ 只有 INSERT(v_old 為 NULL)會失去保護
  # 乾淨隔離實測:去重之後只有 INSERT(v_old 為 NULL)靠 NEW 那側 ⇒ 只有 N5 flip
  assert_mut "M8" "$C_N5" ""
else
  TOTAL_FAIL=$((TOTAL_FAIL+1)); echo "     🔴 M8:apply 失敗 ⇒ 這發沒測到任何東西"
fi
restore

hdr "步驟 5:還原後複跑 baseline(數字要與突變前一模一樣)"
prepare_run t_base2 || die "還原後 apply 失敗 ⇒ 成品被突變污染了"
cells t_base2 >/dev/null
chk "還原後 PASS 數與突變前相同" "$BASELINE_PASS" "$LAST_PASS"
chk "還原後 FAIL 數" "0" "$LAST_FAIL"

hdr "步驟 6:回退腳本 ${DOWN} 實跑"
# 🔴 down.sql 現在有一道硬 checkpoint(codex 關卡2 must-fix):
#    不帶 `-v pcm_app_layer_retracted=1` 就拒絕執行。
#    ⇒ **這支 harness 必須先真的做那道檢查,才有資格帶那個變數。**
#    (帶變數 = 聲明「我查過應用層零命中」。無條件帶 = 把閘變成裝飾。)
# 🔴 codex 關卡2 R2 finding 10:原本只掃 `.ts/.tsx` 的**完整字面**
#    ⇒ 動態拼字、共用 wrapper、生成檔、`.js/.mjs` 呼叫**都掃不到**,而 grep 回 0 就授權 DROP。
#    ⇒ 擴到六種副檔名 + 同時掃「函式全名」與「較短的特徵片段」。
# ⚠️ **而這仍然不是判決**:動態拼字(`'admin_update_' + name`)本質上 grep 不到。
#    ⇒ 下面那行 echo 要把**限度**印出來,不能只印一個 0(0 命中被讀成不存在 = 今天已經栽過的坑)。
LINKED=$(grep -rn -e "admin_update_order_item_amount" -e "update_order_item_amount" apps packages \
  --include='*.ts' --include='*.tsx' --include='*.js' --include='*.mjs' --include='*.cjs' --include='*.json' \
  2>/dev/null | grep -vc node_modules)
echo "  應用層命中數=${LINKED}(pattern 兩個 / 副檔名六種 / 已排除 node_modules)"
echo "  ⚠️ 掃不到的:動態拼字組出來的函式名、生成檔、DB 裡的資料列 ⇒ **0 命中不等於沒人在用**"
DOWNVAR=""
if [ "$LINKED" = "0" ]; then
  DOWNVAR="-v pcm_app_layer_retracted=1"
  echo "  ⇒ 零命中 ⇒ 有資格帶 pcm_app_layer_retracted=1 跑 down"
else
  echo "  🔴 應用層已接線(${LINKED} 處)⇒ **不帶變數**,預期 down 會被它自己的閘擋下"
  echo "     (那是正確行為:正式環境必須先退應用層 —— 見 memory feedback_app-layer-must-not-ship-before-migration-apply)"
fi
clone t_down
D="postgresql://postgres@127.0.0.1:${PORT}/t_down"
apply_to t_down || die "t_down apply 失敗"
psql "$D" -v ON_ERROR_STOP=1 $DOWNVAR -q -f "$DOWN" >/dev/null 2>&1; chk "down exit" "0" "$?"
# 🔴 先證那道閘不是裝飾:同一支 down、不帶變數 ⇒ 必須什麼都沒退
clone t_gate
apply_to t_gate >/dev/null 2>&1
psql "postgresql://postgres@127.0.0.1:${PORT}/t_gate" -q -f "$DOWN" >/dev/null 2>&1
chk "🔴 不帶變數時 down 的硬 checkpoint 擋下(物件應全留)" "3 / 2" \
  "$(psql "postgresql://postgres@127.0.0.1:${PORT}/t_gate" -qtA -c "SELECT (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('admin_update_order_item_amount','pcm_e13_subtotal_guard','pcm_e13_assert_order_subtotal_matches'))||' / '||(SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'pcm_e13%')")"

chk "退後殘留(函式/trigger)" "0 / 0" \
  "$(psql "$D" -qtA -c "SELECT (SELECT count(*) FROM pg_proc WHERE proname IN ('admin_update_order_item_amount','pcm_e13_subtotal_guard','pcm_e13_assert_order_subtotal_matches'))||' / '||(SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'pcm_e13%')")"
# 🔴 「物件不在了」只是結構;這格驗的是**行為**真的回到「沒有這功能」。
chk "🔴 退後失衡又寫得進去(行為真的退了)" "subtotal=800 vs Σlines=14" \
  "$(psql "$D" -qtA -c "BEGIN; UPDATE order_items SET unit_price=7,line_total=14 WHERE id='00000000-0000-0000-0000-0000000000a3'; COMMIT; SELECT 'subtotal='||o.subtotal||' vs Σlines='||(SELECT SUM(i.line_total) FROM order_items i WHERE i.order_id=o.id) FROM orders o WHERE o.id='00000000-0000-0000-0000-000000000003'" 2>&1)"
psql "$D" -v ON_ERROR_STOP=1 $DOWNVAR -q -f "$DOWN" >/dev/null 2>&1; chk "down 二次跑(冪等)" "0" "$?"
psql "$D" -v ON_ERROR_STOP=1 -q -f "$MIG" >/dev/null 2>&1; chk "down 之後可再 apply" "0" "$?"

teardown
echo ""
if [ "$TOTAL_FAIL" = 0 ]; then
  echo "✅ 全數通過(baseline ${BASELINE_PASS} 格 + 8 發突變逐格機器判定 + 回退)"
  echo "🔴 但這只證了 vanilla PG 上的行為 —— 正式庫的 owner / ACL / 既有資料 / 併發 / 效能,一律未證。"
else
  echo "🔴 有 ${TOTAL_FAIL} 項不符 —— 不要當成通過"
  exit 1
fi
