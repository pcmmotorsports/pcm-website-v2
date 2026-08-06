#!/usr/bin/env bash
# ============================================================
# B2-S2b 可重現驗證 harness ── 行為段(S2b-2a 建檔)
# ============================================================
# 標的 = supabase/migrations/20260806180000_m4b_e10_b2_s2b_shipped_recompute_wire.sql
# 片級 plan = docs/specs/2026-08-06-e10-b2-s2b-recompute-wire-plan.md(v2、已凍結)
# 本片 = S2b-2a,認領 plan §4.99 的驗收項 10 / 10b / 11 / 12 / 12b / 12c / 14 / 15 / 18 / 20。
#
# 用法:
#   PORT=54365 scripts/b2s2b-verify.sh all /tmp/b2s2bv   從零 provision post-S2b 基準庫,再跑全部
#   PORT=54365 scripts/b2s2b-verify.sh run /tmp/b2s2bv   重用既有基準庫
#   🔴 PORT **無預設、必須顯式帶**(plan §3.6:a1/a4a 共用 54329 的同埠地雷;建議值 54365)。
#      本家族已占用、不得重用:54329 / 54331 / 54342 / 54351 / 54353 / 54355 / 54357 / 54359。
#
# ── 這支腳本在證明什麼 ──────────────────────────────────────
# 證明:S2b-1 接上去的第四軸**在真的跑起來時**行為正確 —— 由**外部** oracle 回查落庫值,
#      不是靠 migration 自己那段 §5 結構驗收自我背書(那段只證得了 catalog 長相)。
#   ①出貨真的讓 `shipped_quantity` 跟動(項10)、草稿箱**不算**(項10b)、
#     作廢退量(項11,含 `submitted` 態)、unvoid 回升(項12);
#   ②§0.3 那個「shipped 只能經 UPDATE 升值」的**前提**被 X3 / X1 / append-only 三支釘住
#     (項12b / 12c)—— 前提倒了會讓 shipped 靜默算少,而**沒有任何一格會自己紅**;
#     🔴 12c 是**兩格**:結構面(外殼 triggerdef + **函式本體 md5**)與行為面(真的擋得住 UPDATE)。
#     只驗外殼時,把函式 body 換成 `RETURN NEW` 會讓 triggerdef 逐字不變 ⇒ 全綠而守門已失效。
#   ③C9 真的擋得住重算寫出來的超額 shipped(項14),而且它是**承重件**(項15:拿掉就過);
#   ④X1 在 **COMMIT** 失敗時,摘要與品項**兩邊都回滾**(項18)—— 這格用真 COMMIT,不是模擬;
#   ⑤helper 四軸活體:蓋掉摘要四軸 → 直呼 helper → 四軸新值全對(項20;輸出的 `quantity`
#     前綴是報表維,由 A1 複合 FK 釘死、不具判別力)。
#
# 🔴 **本片不證明**(逐條寫死,不留給下一棒推測):
#   ⓐ **零突變靶**。plan §4.99 把 §5 兩環境突變矩陣認領給 **S2b-2b** ⇒ 本片這 13 格
#     只被對照組證明「可以滿足」,**不是**被證明「壞了會紅」。判別力要等 2b 的矩陣。
#     (memory `feedback_guard-checks-existence-not-effect`:存在性斷言對「還在但失效」全盲。)
#   ⓑ **併發面**(項19 barrier)與 **stale-high**(項29)不在本片 —— 都在 2b。
#   ⓒ **正式站行為**:本機 PG17,不是 Supabase;RLS / ACL 的實際行為未驗。
#   ⓓ 本檔跑的是 `all` 模式從零 provision 的**全前綴**庫(含 S2b)。
#     plan §2.2 的 W2(pre 狀態基準庫)把本片列進適用範圍,**但本片逐格檢查後沒有一格需要
#     pre-S2b 庫**(項14/15 要 C9 = S2a 產物 + shipped writer = S2b 產物,兩者都在 post 側;
#     其餘各格同理)⇒ 本片 DoD 記 `W2: N/A(本片不建 pre 基準庫)`。
#     🔴 **這是對凍結 plan 的偏離,已同批改 plan §2.2 的 W2 適用列**(不留活字);
#     偏離與理由一起寫進 STOP,不是只寫在這裡。
#     🔴 **pre-S2b 基準庫仍然要有人建** —— plan §4 項29(a) 明文要跑在 pre-S2b 庫上,
#     那是 **S2b-2b** 的事;它要在本檔加 cutoff 前綴機制時,照 `b2s2a-verify.sh:274-280`
#     的字面(**只重放時間戳早於本檔的 migration 前綴**,不是「全部減本檔」)寫。
#
# 🔴🔴 **永久警語 ①:期望值一律正向寫死,不得由受測 DB 自算** 🔴🔴
#   小線 R1 實錘:「對照組自己算出來再跟自己比」= 恆綠。本檔每一格的 `exp` 都是常數字面。
#
# 🔴🔴 **永久警語 ②:0 值格必須先證明 fixture 真的建起來了** 🔴🔴
#   期望值含 0 的有**四格**:項10b(`1/0/3`)、項11(`0/3`)、項11b(`0/3`)、項18(`0/0/0/3`)。
#   這些 0 在「fixture 根本沒建成」時**同樣會出現** ⇒ 每一格的 oracle 都**併回非 0 的存在性維度**,
#   而且 11 / 11b / 12 另外在 body 內先斷言「作廢前 shipped 真的是 2」(`PRE_SHIPPED_2`)——
#   光靠 instock 那一維不夠:它是 **receipts 軸**寫的,證不到「作廢事件觸發了重算」。
#   memory `feedback_fixture-value-makes-guard-vacuous` / `feedback_negative-test-...` 同族。
#
# 🔴 判定紀律
#  ① 每格的觀察值是**回查落庫值**,不是「沒噴錯」(plan §4 通則)。
#  ② 負測比 **SQLSTATE + CONSTRAINT_NAME 兩者**,不只比 SQLSTATE(S1 消融 #20/#21 教訓)。
#  ③ 格數與**具名 key 集合**都由本腳本自斷言(W1),不靠人數輸出。
#  ④ 拿不到觀察值(空字串)一律判紅 —— fail-closed,不得掉進「等於期望值」的分支。
# ============================================================
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

MODE="${1:?用法: b2s2b-verify.sh all|run <workdir>}"
case "$MODE" in all|run) : ;; *) echo "🔴 MODE 只能是 all / run(收到:$MODE)" >&2; exit 2 ;; esac
WORK="${2:?缺 workdir(必須是 /tmp 直屬短路徑,例 /tmp/b2s2bv)}"
PORT="${PORT:?🔴 PORT 必須顯式帶(plan §3.6:本支無預設值;建議 54365)}"

MIG="supabase/migrations/20260806180000_m4b_e10_b2_s2b_shipped_recompute_wire.sql"
SUMMARY="public.order_item_quantity_summary"
HELPER="public.pcm_a4a_recompute_order_item_summary(uuid)"
TG_SS="shipments_summary_recompute_ac"
export LC_ALL=C
# 🔴 使用者 rc 可覆寫 ON_ERROR_STOP / 輸出格式 ⇒ 比對值會漂。每個 psql 呼叫點另外都帶 -X。
export PSQLRC=/dev/null

BASE_URL="postgresql://postgres@127.0.0.1:${PORT}/postgres"
ADMIN_URL="postgresql://postgres@127.0.0.1:${PORT}/template1"

# ══ 凍結的期望格數 + 具名 key 集合(W1)═══════════════════════════════════════
# 🔴 只凍結總數擋不住「刪一格 + 重複另一格」(小線同一支腳本上中過三次)⇒ 兩者都凍。
EXPECT_CELL=13     # 行為/結構格(項 10 / 10b / 11 ×2 / 12 / 12b ×2 / 12c ×2 / 14 / 15 / 18 / 20)
EXPECT_TOTAL=16    # 上列 + ID-GATE + BASE-POST + COPIES-DROPPED
EXPECT_PASS_KEYS="ID-GATE BASE-POST \
B10-shipped-lands B10b-draft-not-counted B11-void-returns B11b-void-submitted B12-unvoid-restores \
B12b-x3-blocks B12b-x1-blocks B12c-append-only B12c-blocks B14-c9-neg B15-c9-loadbearing \
B18-x1-commit-rollback B20-helper-live COPIES-DROPPED"

# 🔴 helper 四軸指紋:**測量值**,不是 migration 檔內的字面(migration 只在執行期
#    `RAISE NOTICE` 公告它,`20260806180000_…:462`;全 repo grep 這個字串只命中本行)。
#    ⇒ 它是**單一來源**,重新取得的方法寫在這裡:對已套完全前綴的庫跑
#      `SELECT md5(pg_get_functiondef('public.pcm_a4a_recompute_order_item_summary(uuid)'::regprocedure))`。
#    它一漂,代表 helper 被換過 ⇒ 本檔所有行為格驗的都不是它以為的那支函式(下方 BASE-POST 直接 die)。
MD5_HELPER_4AXIS="4ac2989a58985beae91a491a816086f7"

PASS=0; FAIL=0; CELL=0
PASS_KEYS=""
ok()  { PASS_KEYS="$PASS_KEYS $1"; printf '  ✅ %s\n' "$2"; PASS=$((PASS+1)); }
bad() { printf '  🔴 %s\n' "$1"; FAIL=$((FAIL+1)); }
log() { echo; echo "== $* =="; }
die() { echo "🔴 $*" >&2; exit 1; }

q() { psql -X "$1" -qtA -c "$2" 2>&1; }

# ══ 0a. workdir 與埠的硬閘(照 b2s2a-verify.sh:196-210 同型)══════════════════
case "$PORT" in
  ""|*[!0-9]*) die "PORT 必須是純數字(收到:[$PORT])" ;;
  0*) die "PORT 不得有前導零(收到:$PORT)—— 前導零可繞過下面的保留埠黑名單" ;;
esac
[ "$PORT" -ge 1024 ] && [ "$PORT" -le 65535 ] || die "PORT 必須介於 1024-65535(收到:$PORT)"
# 🔴 54361 / 54363 是 plan §3.6 指派給 a1-verify / a4a-verify 的**專屬埠**(S2b-4b 落地時生效);
#    現在兩支都還是 `${PORT:-54329}`,但黑名單先寫進去 —— 等 4b 落地才補的話,那一刻就過期了。
case "$PORT" in
  54329|54331|54342|54351|54353|54355|54357|54359|54361|54363)
    die "埠 $PORT 是既有 harness / 本夜跑在用的拋棄庫 / plan §3.6 已指派的專屬埠,換一個(建議 54365)" ;;
esac
while [ "${WORK%/}" != "$WORK" ]; do WORK="${WORK%/}"; done
[ -L "$WORK" ] && die "workdir 不得是 symlink(收到:$WORK)"
[ -L "$WORK/.b2s2b-throwaway" ] && die "ownership marker 不得是 symlink —— 預埋 symlink 可繞過 marker 閘"
case "$WORK" in /tmp/?*) : ;; *) die "workdir 必須在 /tmp 底下(本腳本會 rm -rf 它)" ;; esac
case "$WORK" in /tmp/*/*) die "workdir 必須是 /tmp 的直屬子目錄" ;; esac
case "$WORK" in *..*) die "workdir 不得含 .." ;; esac
[ ${#WORK} -le 40 ] || die "workdir 太長(${#WORK})—— unix socket 路徑上限 103 bytes"
test -f "$MIG" || die "找不到 $MIG"

# 🔴 把受測 migration 釘在已 commit 的那一版:本檔的期望值(四軸指紋、trigger 名、
#    conname、C9 語意)全部綁在那一版;改了 migration 就必須回頭一起更新,不是把閘拿掉。
MIG_SHA_FROZEN="dcc32d15058d47ee3b4a562bf25fd830b8a0a0edfa25428a3208c33f7ff4c659"
MIG_SHA_NOW="$(shasum -a 256 "$MIG" | awk '{print $1}')"
[ "$MIG_SHA_NOW" = "$MIG_SHA_FROZEN" ] || die "受測 migration 已被改動 —— 凍結 sha256 $MIG_SHA_FROZEN / 實測 $MIG_SHA_NOW。
   本 harness 的凍結值全部綁在那一版,逐項是:
     ①helper 四軸指紋 MD5_HELPER_4AXIS ②trigger 名 $TG_SS ③三個 conname
     (shipment_items_parent_open / shipments_items_presence / oiqs_shipped_le_instock)
     ④append-only 三支的 triggerdef 全等字面 ⑤EXPECT_CELL / EXPECT_TOTAL / EXPECT_PASS_KEYS
   改了 migration 就必須回頭把這些一起更新。"

MARK="$WORK/.b2s2b-throwaway"
MARK_SIG="b2s2b-verify.sh throwaway cluster — 本目錄可被本腳本 rm -rf"
CIDFILE="$WORK/cluster-id"
PGBIN="$(dirname "$(command -v initdb 2>/dev/null || echo /opt/homebrew/opt/postgresql@17/bin/initdb)")"

# ══ 0b. provision:post-S2b 基準庫(**全前綴**從零重放,含本線)═════════════════
if [ "$MODE" = "all" ]; then
  if [ -e "$WORK" ]; then
    [ -f "$MARK" ] || die "$WORK 已存在但缺 ownership marker($MARK)—— 不是本腳本建的,拒絕 rm -rf"
    [ "$(cat "$MARK" 2>/dev/null)" = "$MARK_SIG" ] \
      || die "$WORK 的 marker 內容不符(可能是預埋的空檔)—— 拒絕 rm -rf"
    if [ -e "$WORK/pgdata" ] && [ ! -f "$WORK/pgdata/PG_VERSION" ]; then
      die "$WORK/pgdata 存在但不是 PG 資料目錄(無 PG_VERSION)—— 拒絕 pg_ctl stop / rm -rf"
    fi
  fi
  [ -L "$WORK/pgdata" ] && die "pgdata 不得是 symlink —— 會讓 rm -rf 打到別人的資料目錄"
  # 🔴 停機前先確認埠上那台**是本 workdir 的**(先驗再停,順序不可反)。
  if psql -X "$BASE_URL" -qtA -c 'SELECT 1' >/dev/null 2>&1; then
    RUNNING_DD="$(psql -X "$BASE_URL" -qtAc 'SHOW data_directory' 2>/dev/null)"
    case "$RUNNING_DD" in
      "$WORK/pgdata"|"$(cd "$WORK" 2>/dev/null && pwd -P)/pgdata") : ;;
      *) die "埠 $PORT 上活著的 postmaster 的 data_directory 是 [$RUNNING_DD],不是 $WORK/pgdata —— 不停別人的" ;;
    esac
  fi
  if [ -d "$WORK/pgdata" ]; then
    "$PGBIN/pg_ctl" -D "$WORK/pgdata" stop -m fast >/dev/null 2>&1 || true
    sleep 1
  fi
  if psql -X "$BASE_URL" -qtA -c 'SELECT 1' >/dev/null 2>&1; then
    die "埠 $PORT 上仍有活著的 postmaster 且不是本 workdir 的 —— 不硬殺別人的,停下"
  fi
  log "0/6 provision post-S2b 基準庫(port ${PORT};**全前綴、含 ${MIG##*/}**)"
  rm -rf "$WORK"; mkdir -p "$WORK"; printf '%s\n' "$MARK_SIG" > "$MARK"
  "$PGBIN/initdb" --version | grep -q ' 17\.' || die "PATH 的 initdb 非 PG17"
  psql -X --version | grep -q ' 17\.' || die "PATH 的 psql 非 PG17(協定相容但錯誤字面可能漂)"
  "$PGBIN/initdb" -U postgres --auth=trust --locale=C --encoding=UTF8 -D "$WORK/pgdata" >/dev/null 2>&1 \
    || die "initdb 失敗"
  "$PGBIN/pg_ctl" -D "$WORK/pgdata" -l "$WORK/pg.log" \
    -o "-p ${PORT} -c unix_socket_directories='${WORK}'" start >/dev/null \
    || { cat "$WORK/pg.log" >&2; die "pg_ctl 啟動失敗"; }
  psql -X "$BASE_URL" -v ON_ERROR_STOP=1 -q -f scripts/d1-supabase-shim.sql || die "shim 失敗"
  # 🔴 fitments 相容 stub 的插序沿用 d1t2 家族(public.product_fitments_effective 在 repo 內
  #    沒有任何建立來源,backlog #299)⇒ 這裡的「全綠」不等於「repo 能從零重建正式站 schema」。
  FIRST_FITMENTS="$(grep -l 'product_fitments_effective' supabase/migrations/*.sql | sort | head -1)"
  for f in supabase/migrations/*.sql; do
    case "$f" in *20260723120000*) continue ;; esac
    case "$(basename "$f")" in
      [0-9]*) : ;;
      *) die "migration 檔名不是時間戳開頭:$f" ;;
    esac
    if [ "$f" = "$FIRST_FITMENTS" ]; then
      psql -X "$BASE_URL" -v ON_ERROR_STOP=1 -q -f scripts/d1-fitments-bootstrap.sql || die "fitments bootstrap 失敗"
    fi
    psql -X "$BASE_URL" -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null || die "migration 失敗:$f"
  done
  # 🔴 「post-S2b」= **本檔就是 migration 目錄的時間序尾端**(R1 nit 12):
  #    上面那個迴圈套的是 `*.sql` 全部、沒有時間戳上界 ⇒ 日後新增更晚的 migration 會被**靜默**
  #    納入「post-S2b 基準庫」,定義就漂了(plan §2.2 W2 對 pre 側的同一個警告,對稱適用)。
  #    ⇒ 在這裡把它變成 fail-visible:尾端不是本檔就停,由人決定要不要重新定義基準。
  NEWEST_TS="$(ls supabase/migrations/*.sql | sed 's|.*/||; s|_.*||' | sort | tail -1)"
  [ "$NEWEST_TS" = "20260806180000" ] \
    || die "migration 目錄的時間序尾端是 $NEWEST_TS,不是本片的 20260806180000 ——
   本檔的「post-S2b 基準庫」定義已經漂了(它會把更晚的 migration 一起套進來)。
   處置 = 決定基準要不要含那些新片,並同批更新本行與 MD5_HELPER_4AXIS,**不是把這道閘拿掉**。"
  # fixture 的上游來源 = d1t2 seed(customers / orders / order_items / suppliers / staff)。
  pnpm exec tsx scripts/d1t2-seed.ts > "$WORK/seed.sql" 2>"$WORK/seed.err" \
    || die "seed 產生失敗(見 $WORK/seed.err)"
  test -s "$WORK/seed.sql" || die "seed.sql 為空"
  psql -X "$BASE_URL" -v ON_ERROR_STOP=1 -q -f "$WORK/seed.sql" >/dev/null || die "seed 套用失敗"
  psql -X "$BASE_URL" -qtAc 'SELECT system_identifier FROM pg_control_system()' > "$CIDFILE"
else
  [ -f "$MARK" ] || die "run 模式需要既有基準庫($WORK 缺 marker);先跑 all"
  [ "$(cat "$MARK" 2>/dev/null)" = "$MARK_SIG" ] || die "$WORK 的 marker 內容不符;拒絕重用"
fi

# ══ 0c. 身分閘(marker / cluster-id / datadir / locale / server 版本)═════════
[ -f "$MARK" ] || die "$WORK 缺 ownership marker;拒絕動任何 DDL"
[ "$(cat "$MARK" 2>/dev/null)" = "$MARK_SIG" ] || die "$WORK 的 marker 內容不符;拒絕動任何 DDL"
psql -X "$BASE_URL" -qtA -c 'SELECT 1' >/dev/null 2>&1 || die "連不上 $BASE_URL(先跑 all)"
CID="$(psql -X "$BASE_URL" -qtAc 'SELECT system_identifier FROM pg_control_system()' 2>/dev/null)"
[ -n "$CID" ] || die "讀不到 cluster system_identifier"
[ -f "$CIDFILE" ] || die "缺 $CIDFILE —— 無法確認這是本腳本 provision 的拋棄式 cluster"
[ "$CID" = "$(cat "$CIDFILE")" ] || die "cluster 身分不符(實 $CID / 期望 $(cat "$CIDFILE"))—— 零寫入退出"
canon() { [ -d "$1" ] && (cd "$1" && pwd -P) || echo "$1"; }
[ "$(canon "$(q "$BASE_URL" 'SHOW data_directory')")" = "$(canon "$WORK")/pgdata" ] \
  || die "port ${PORT} 的 data_directory 不是 $WORK/pgdata;拒跑"
[ "$(q "$BASE_URL" 'SHOW lc_messages')" = "C" ] || die "lc_messages 非 C(錯誤字面比對會漂)"
case "$(q "$BASE_URL" 'SHOW server_version')" in 17.*) : ;; *) die "伺服器非 PG17(實為 $(q "$BASE_URL" 'SHOW server_version'))" ;; esac
ok ID-GATE "身分閘通過(marker 內容 + cluster-id + datadir + locale + server 版本)"

# ══ 0d. 基準庫真的是 post-S2b(不是「以為是」)═══════════════════════════════
BASE_MD5="$(q "$BASE_URL" "SELECT md5(pg_get_functiondef('${HELPER}'::regprocedure))")"
[ "$BASE_MD5" = "$MD5_HELPER_4AXIS" ] \
  || die "helper 指紋不符(實 $BASE_MD5 / 期望 $MD5_HELPER_4AXIS)—— 這座庫上的 helper 不是 S2b-1 那支四軸版,行為格全部無意義"
[ "$(q "$BASE_URL" "SELECT count(*) FROM pg_trigger WHERE tgname='${TG_SS}' AND NOT tgisinternal")" = "1" ] \
  || die "找不到 ${TG_SS} —— 基準庫沒套 S2b"
[ "$(q "$BASE_URL" "SELECT count(*) FROM pg_attribute WHERE attrelid='${SUMMARY}'::regclass AND attname='shipped_quantity' AND NOT attisdropped")" = "1" ] \
  || die "摘要表沒有 shipped_quantity 欄 —— 基準庫沒套 S2a"
[ "$(q "$BASE_URL" "SELECT count(*) FROM pg_constraint WHERE conrelid='${SUMMARY}'::regclass AND conname='oiqs_shipped_le_instock'")" = "1" ] \
  || die "找不到 C9(oiqs_shipped_le_instock)—— 項14/15 沒有受測對象"
# 🔴 fixture 上游存在性:缺了會讓每一格紅在「建不出 fixture」而不是「行為不對」,錯因指錯方向。
for t in customers suppliers staff order_items; do
  n="$(q "$BASE_URL" "SELECT count(*) FROM public.$t")"
  case "$n" in ""|*[!0-9]*) die "讀不到 public.$t 列數([$n])" ;; esac
  [ "$n" -gt 0 ] || die "public.$t 為 0 列 —— 這座 base 沒帶 seed,重跑 all"
done
# 🔴 起跑前出貨表必須是空的:非空代表上一輪留痕,本檔所有「回查落庫值」都會被污染。
[ "$(q "$BASE_URL" 'SELECT count(*) FROM public.shipments')" = "0" ] \
  && [ "$(q "$BASE_URL" 'SELECT count(*) FROM public.shipment_items')" = "0" ] \
  || die "基準庫的出貨表非 0 列 —— 上一輪留痕,重跑 all"
ok BASE-POST "基準庫確認為 post-S2b(helper 四軸指紋逐字相符 + ${TG_SS} 在 + C9 在 + seed 齊 + 出貨表 0 列)"

# ══ 共用:從基準庫複製一份乾淨副本(只給需要真 COMMIT / DDL 的格用)═════════════
FRESH_URL=""
fresh_db() {   # $1 = db 名 → 設 FRESH_URL
  psql -X "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS $1" >/dev/null 2>&1
  if ! psql -X "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE $1 TEMPLATE postgres" >/dev/null 2>&1; then
    sleep 1
    psql -X "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE $1 TEMPLATE postgres" >/dev/null 2>&1 \
      || die "CREATE DATABASE $1 TEMPLATE postgres 兩次都失敗(基準庫可能還有連線沒關)"
  fi
  FRESH_URL="postgresql://postgres@127.0.0.1:${PORT}/$1"
}
drop_db() { psql -X "$ADMIN_URL" -q -c "DROP DATABASE IF EXISTS $1" >/dev/null 2>&1; }
# 🔴 任何 `die` 都會跳過下方的 drop_db ⇒ 副本殘留,而下一輪 `CREATE DATABASE … TEMPLATE postgres`
#    會因為那些副本還連著而失敗、錯因指向「基準庫有連線沒關」= 指錯方向(R1 nit 13)。
trap 'drop_db b2s2b_c9; drop_db b2s2b_x1' EXIT

# ══ 共用:fixture 前奏(每格自己建、隨交易回滾)═══════════════════════════════
# 🔴 值全部寫死且**互異**:quantity P4=4 / P6=6、receipts 2+1、shipped 2 或 3、cancelled 1。
#    互異是刻意的 —— 值撞在一起時,「守門比錯欄位」與「守門正確」會產生同樣的觀察值
#    (memory `feedback_fixture-value-makes-guard-vacuous`)。
FIXTURE='
  SELECT user_id INTO v_cust FROM public.customers ORDER BY user_id LIMIT 1;
  IF v_cust IS NULL THEN RAISE EXCEPTION "S2b fixture:customers 為空"; END IF;
  SELECT id INTO v_sup FROM public.suppliers ORDER BY id LIMIT 1;
  SELECT id INTO v_staff FROM public.staff ORDER BY id LIMIT 1;
  INSERT INTO public.orders (display_id, customer_user_id, shipping_address_snapshot, tier_at_checkout,
                             subtotal, shipping_fee, total, shipping_method, invoice)
  VALUES ("PCM-9994-0001", v_cust,
          jsonb_build_object("name","S2b 探針","phone","0900000000","line","測試地址"),
          "general"::public.member_tier, 0, 0, 0, "store", jsonb_build_object("type","personal"))
  RETURNING id INTO v_order;
  INSERT INTO public.order_items (order_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
  VALUES (v_order, "S2BV-P4", jsonb_build_object("title","s2b p4","sku","S2BV-P4","spec",jsonb_build_object()), 4, 0, 0)
  RETURNING id INTO v_i4;
  INSERT INTO public.order_items (order_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
  VALUES (v_order, "S2BV-P6", jsonb_build_object("title","s2b p6","sku","S2BV-P6","spec",jsonb_build_object()), 6, 0, 0)
  RETURNING id INTO v_i6;'
# 🔴 上面用單引號寫 SQL 會與 shell 的單引號打架 ⇒ 一律寫成 " 再在這裡換回 '。
#    (直接寫 '' 逃逸在多層 heredoc 下曾經改出過錯字面,改用單一轉換點。)
FIXTURE="$(printf '%s' "$FIXTURE" | tr '"' "'")"

# 🔴 `v_staff` 是 **text** 不是 uuid:`public.staff.id` 是 text(實查 `format_type`,值形如 `sean`),
#    `order_cancellations.actor` 同樣是 text。宣告成 uuid 會讓**每一格**都紅在 22P02
#    —— 而且錯因指向 fixture、不指向受測行為(本輪第一跑實錘)。
DECLS='DECLARE v_cust uuid; v_order uuid; v_i4 uuid; v_i6 uuid; v_sup uuid; v_staff text;
       v_ship uuid; v_ship2 uuid; v_got text; v_n integer;'

# ══ 共用:格 runner ═══════════════════════════════════════════════════════════
# 🔴 兩種形狀共用同一條路徑:body 執行 → SET CONSTRAINTS ALL IMMEDIATE(強制跑掉 DEFERRED 的 X1)
#    → 由呼叫端給的 oracle 回查落庫值 → 與**寫死的期望常數**比對。
#    ⚠️ `SET CONSTRAINTS ALL IMMEDIATE` **不等於真 COMMIT**(b2s1b 檔頭同一句誠實邊界):
#       它證明「這個終態通得過所有延遲約束」,不證明正式站 commit 一定沒事。項18 才是真 COMMIT。
cell_land() {   # $1 = key、$2 = body、$3 = oracle SQL、$4 = 期望值、$5 = 標籤
  local key="$1" body="$2" oracle="$3" want="$4" label="$5" got
  CELL=$((CELL+1))
  got="$(psql -X "$BASE_URL" -v ON_ERROR_STOP=0 -qtA 2>&1 <<SQL | sed -n 's/^NOTICE:  GOT:\(.*\)$/\1/p' | head -1
BEGIN;
DO \$cell\$
$DECLS
BEGIN
$FIXTURE
$body
  SET CONSTRAINTS ALL IMMEDIATE;
  SELECT ($oracle)::text INTO v_got;
  RAISE NOTICE 'GOT:%', COALESCE(v_got, '<NULL>');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'GOT:ERR:%:%', SQLSTATE, SQLERRM;
END
\$cell\$;
ROLLBACK;
SQL
)"
  if [ -z "$got" ]; then
    bad "$label —— 🔴 拿不到觀察值(測試自身異常;fail-closed 判紅)"
  elif [ "$got" = "$want" ]; then
    ok "$key" "$label(oracle=$want)"
  else
    bad "$label —— 期望 oracle=「$want」,實得「$got」"
  fi
}

cell_err() {   # $1 = key、$2 = 期望 SQLSTATE、$3 = 期望 conname、$4 = body、$5 = 標籤
  local key="$1" want_state="$2" want_con="$3" body="$4" label="$5" got
  CELL=$((CELL+1))
  got="$(psql -X "$BASE_URL" -v ON_ERROR_STOP=0 -qtA 2>&1 <<SQL | sed -n 's/^NOTICE:  GOT:\(.*\)$/\1/p' | head -1
BEGIN;
DO \$cell\$
$DECLS
DECLARE v_con text;
BEGIN
$FIXTURE
$body
  SET CONSTRAINTS ALL IMMEDIATE;
  RAISE NOTICE 'GOT:NOT-BLOCKED|<無>';
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
  RAISE NOTICE 'GOT:%|%', SQLSTATE, COALESCE(NULLIF(v_con, ''), '<無>');
END
\$cell\$;
ROLLBACK;
SQL
)"
  if [ -z "$got" ]; then
    bad "$label —— 🔴 拿不到觀察值(測試自身異常;fail-closed 判紅)"
  elif [ "$got" = "${want_state}|${want_con}" ]; then
    ok "$key" "$label(${want_state} / CONSTRAINT=${want_con})"
  else
    bad "$label —— 期望「${want_state}|${want_con}」,實得「$got」"
  fi
}

# ── 共用 SQL 片段(shell 變數,插進 body)────────────────────────────────────
MK_DRAFT="  INSERT INTO public.shipments (shipment_reference, customer_user_id, recipient_snapshot, carrier_code)
  VALUES ('BCDFGH', v_cust, '{\"name\":\"王小明\",\"phone\":\"0900000000\",\"line\":\"lineid\"}'::jsonb, 'hct')
  RETURNING id INTO v_ship;"
SHIP_NOW="  UPDATE public.shipments SET shipped_at = now(), tracking_number = 'S2BT1' WHERE id = v_ship;"
# 🔴 **出貨前必須先有庫存**:C9 = `shipped <= instock`,而 instock 的真相是 receipts。
#    第一跑實錘:沒有這段時,項10/11/12/18「出貨 2」全部紅在 `23514 / oiqs_shipped_le_instock`
#    —— 紅得完全正確,是我的 fixture 少了上游。留這段註解,下一棒才不會以為 C9 有問題。
# 🔴 值選 ordered=3 / receipts 2+1 = instock **3**,出貨量刻意選 **2**:
#    兩者**不得相等** —— 相等時「真相式讀錯來源(讀成 instock)」與「讀對」會產生同樣的觀察值
#    (memory `feedback_fixture-value-makes-guard-vacuous`)。
STOCK_I4="  INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity)
  VALUES (v_i4, v_sup, 3);
  INSERT INTO public.order_item_procurement_receipts (procurement_id, quantity, received_at, received_by)
  SELECT p.id, 2, now(), 'b2s2b_verify' FROM public.order_item_procurement p WHERE p.order_item_id = v_i4;
  INSERT INTO public.order_item_procurement_receipts (procurement_id, quantity, received_at, received_by)
  SELECT p.id, 1, now(), 'b2s2b_verify' FROM public.order_item_procurement p WHERE p.order_item_id = v_i4;"
# 🔴 oracle 一律回**兩維**`shipped/instock`:單看 shipped 時,「摘要列根本沒被重算」與
#    「重算後正確」在期望值是 0 的那幾格會產生同樣的觀察值(永久警語②)。
#    instock 那一維恆為 3 且來自另一條軸 ⇒ 它非 0 就證明這一列真的被 helper 寫過。
SHIPPED_OF_I4="SELECT shipped_quantity::text || '/' || instock_quantity::text FROM ${SUMMARY} WHERE order_item_id = v_i4"

log "1/6 項 10 / 10b:出貨跟動 + 草稿箱不算"

# ── 項10:建箱掛品項 → UPDATE shipped_at → shipped = 該量 ──────────────────
cell_land B10-shipped-lands \
"$STOCK_I4
$MK_DRAFT
  INSERT INTO public.shipment_items (shipment_id, order_item_id, shipped_quantity) VALUES (v_ship, v_i4, 2);
$SHIP_NOW" \
  "$SHIPPED_OF_I4" "2/3" \
  "項10 正測:進貨 3 → 建箱掛品項(2)→ 設 shipped_at ⇒ 摘要 shipped/instock 落庫 = 2/3"

# ── 項10b:草稿箱(有品項、未設 shipped_at)⇒ shipped 仍 0 ────────────────
# 🔴 這一格的 0 **不能單獨當觀察值**(永久警語②):沒建成 fixture 時同樣是 0/沒有列。
#    ⇒ oracle 回「品項列數 / shipped / instock」三維,期望 `1/0/3` —— 前後兩維非 0,
#      證明箱子真的有貨、摘要列真的被重算過。
# 🔴🔴 **`PERFORM` 那一行(下方)為什麼不可以刪**(R1 must-fix 1 更正我原本寫錯的理由):
#    摘要列**不是**它建的 —— `STOCK_I4` 的 `INSERT order_item_procurement` 就已觸發
#    `order_item_procurement_summary_recompute_zc`(`20260803140000:409-413`)建好了列
#    (instock=3、shipped=0)。`PERFORM` 的真正作用是**把最後一次重算挪到掛品項之後**。
#    少了它,「真相式漏掉 `shipped_at IS NOT NULL`」那個突變(2b 靶⑥,唯一 oracle = 本格)
#    會存活而本格照樣綠 —— 因為最後一次重算發生在品項還不存在的時候。**它是本格的判別力本身。**
# 🔴 這一格也要進貨 3:草稿箱裡放的量刻意也是 **3**,讓「真相式漏掉 shipped_at IS NOT NULL」
#    這個突變(2b 的靶⑥)算出來的是**合法的 3**、只在值上翻面 —— 沒有庫存的話它會紅在 C9,
#    那是紅對了但**紅在別的理由**,靶就殺不到這一格(memory `feedback_negative-test-...`)。
cell_land B10b-draft-not-counted \
"$STOCK_I4
$MK_DRAFT
  INSERT INTO public.shipment_items (shipment_id, order_item_id, shipped_quantity) VALUES (v_ship, v_i4, 3);
  PERFORM public.pcm_a4a_recompute_order_item_summary(v_i4);" \
  "(SELECT count(*) FROM public.shipment_items WHERE order_item_id = v_i4)::text || '/' ||
   ($SHIPPED_OF_I4)" "1/0/3" \
  "項10b 草稿箱格:掛了品項(1 列、量 3、庫存 3)但沒設 shipped_at ⇒ 真相式的 shipped_at IS NOT NULL 把它排除,shipped = 0"

log "2/6 項 11 / 12:作廢退量(含 submitted 態)+ unvoid 回升"

# 🔴 三格共用的前提斷言(R1 nit 6):作廢/unvoid **之前** shipped 必須真的是 2。
#    少了它,期望值 0 的那兩格會與「這條路徑從頭到尾沒把 shipped 寫上去」共用同一個觀察值;
#    非 0 的 instock 維是 **receipts 軸**寫的(`20260803140000:415-418`),證不到「作廢事件觸發了重算」。
#    形狀與 B14 的前提斷言(下方)同構,不另立一種寫法。
PRE_SHIPPED_2="  SELECT shipped_quantity INTO v_n FROM ${SUMMARY} WHERE order_item_id = v_i4;
  IF v_n IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION '前提破了:作廢/unvoid 之前 shipped 應為 2,實為 %(這條路徑沒把 shipped 寫上去,不是作廢的事)', COALESCE(v_n::text, '<無列>');
  END IF;"

# ── 項11:已出貨 → 作廢 ⇒ 退量 ────────────────────────────────────────────
cell_land B11-void-returns \
"$STOCK_I4
$MK_DRAFT
  INSERT INTO public.shipment_items (shipment_id, order_item_id, shipped_quantity) VALUES (v_ship, v_i4, 2);
$SHIP_NOW
$PRE_SHIPPED_2
  UPDATE public.shipments SET deleted_at = now(), void_reason = '裝錯箱' WHERE id = v_ship;" \
  "$SHIPPED_OF_I4" "0/3" \
  "項11 Q3=A 退量:已出貨(2)後作廢 ⇒ 摘要 shipped 退回 0(instock 仍 3 ⇒ 這一列真的被重算過,不是沒建)"

# ── 項11b:submitted 態(已送新竹)+ 已出貨 → 作廢 ⇒ 一樣退量 ─────────────
# 🔴 X4 要求 submitted 必須有非空白的 hct_request_id;X1 要求離開草稿態時必有品項。
cell_land B11b-void-submitted \
"$STOCK_I4
$MK_DRAFT
  INSERT INTO public.shipment_items (shipment_id, order_item_id, shipped_quantity) VALUES (v_ship, v_i4, 2);
  UPDATE public.shipments SET hct_status = 'submitted', hct_request_id = 'HCTREQ-1' WHERE id = v_ship;
$SHIP_NOW
$PRE_SHIPPED_2
  UPDATE public.shipments SET deleted_at = now(), void_reason = '客戶取消' WHERE id = v_ship;" \
  "$SHIPPED_OF_I4" "0/3" \
  "項11 第二半:submitted(已送新竹)且已出貨的箱子作廢 ⇒ 一樣退回 0(狀態欄不影響真相式)"

# ── 項12:由「已出貨作廢態」unvoid ⇒ 回升 ────────────────────────────────
# 🔴 X7 是雙向配對((deleted_at IS NULL) = (void_reason IS NULL))⇒ unvoid 必須兩欄一起清。
# 🔴 plan 項12 的字面是「unvoid 回升(**含**由已出貨作廢態 unvoid)」—— 本格做的就是括號內那個。
#    另一個可能的讀法(從未出貨的作廢箱 unvoid)**刻意不做**:那條路徑的觀察值是 0 → 0,
#    真相式怎麼寫都成立 = 恆真格,加了只是把格數變好看。理由寫在這裡,不是省略。
cell_land B12-unvoid-restores \
"$STOCK_I4
$MK_DRAFT
  INSERT INTO public.shipment_items (shipment_id, order_item_id, shipped_quantity) VALUES (v_ship, v_i4, 2);
$SHIP_NOW
$PRE_SHIPPED_2
  UPDATE public.shipments SET deleted_at = now(), void_reason = '誤作廢' WHERE id = v_ship;
  UPDATE public.shipments SET deleted_at = NULL, void_reason = NULL WHERE id = v_ship;" \
  "$SHIPPED_OF_I4" "2/3" \
  "項12 unvoid 回升:由已出貨作廢態 unvoid ⇒ shipped 回到 2(deleted_at 事件面真的掛上了)"

log "3/6 項 12b / 12c:§0.3 前提(shipped 只能經 UPDATE 升值)的釘死"

# ── 項12b 第一格:INSERT 帶 shipped_at + 加品項 ⇒ 必被 X3 擋 ────────────────
cell_err B12b-x3-blocks P0001 shipment_items_parent_open \
"  INSERT INTO public.shipments (shipment_reference, customer_user_id, recipient_snapshot, carrier_code, tracking_number, shipped_at)
  VALUES ('BCDFGJ', v_cust, '{\"name\":\"王小明\",\"phone\":\"0900000000\",\"line\":\"lineid\"}'::jsonb, 'hct', 'S2BT2', now())
  RETURNING id INTO v_ship;
  INSERT INTO public.shipment_items (shipment_id, order_item_id, shipped_quantity) VALUES (v_ship, v_i4, 2);" \
  "🔴 項12b-①:INSERT 一筆帶 shipped_at 的包裹再加品項 ⇒ 被 X3 擋(這條倒了,shipped 會有 UPDATE 以外的來源)"

# ── 項12b 第二格:INSERT 帶 shipped_at 但不加品項 ⇒ COMMIT 時必被 X1 擋 ────
cell_err B12b-x1-blocks P0001 shipments_items_presence \
"  INSERT INTO public.shipments (shipment_reference, customer_user_id, recipient_snapshot, carrier_code, tracking_number, shipped_at)
  VALUES ('BCDFGK', v_cust, '{\"name\":\"王小明\",\"phone\":\"0900000000\",\"line\":\"lineid\"}'::jsonb, 'hct', 'S2BT3', now())
  RETURNING id INTO v_ship;" \
  "🔴 項12b-②:同一筆 INSERT 但不加品項 ⇒ 延遲檢查 X1 擋下(兩條路都不通 = §0.3 前提成立)"

# ── 項12c:append-only 三支存在且結構逐字 ─────────────────────────────────
# 🔴 為什麼要單獨一格(plan §4 項12c / Fable 翻案條件③):X3 / X1 只擋「加品項」與「零品項出貨」,
#    **改/刪已寄出箱的品項**是這三支在擋。它們被放寬時,shipped 真值變動不經 UPDATE shipments
#    ⇒ 本線 trigger 不發火、摘要靜默漂移,而項 10-12 全綠。
# 🔴 `tgenabled` 是 "char" 不是 text,不 cast 會 42725 operator is not unique(2026-08-06 實錘)。
# 🔴🔴 **必須連函式本體一起 pin**(R1 must-fix 2):三支 trigger 指的是同一支函式,
#    把 `pcm_b2_shipment_items_append_only()` 的 body 換成 `RETURN NEW`,
#    `tgname / tgenabled / pg_get_triggerdef` **逐字都不會變** ⇒ 只比外殼的話本格全綠,
#    而「改/刪已寄出箱品項」已經全面放行。這正是 memory
#    `feedback_guard-checks-existence-not-effect` 那一族(存在性斷言對「還在但失效」全盲)。
#    ⇒ 外殼 + 本體 md5 兩層,再配下方 B12c-blocks 一格**行為**證據(結構永遠證不到「真的會擋」)。
APPEND_ONLY_FN="public.pcm_b2_shipment_items_append_only()"
APPEND_ONLY_EXPECT="shipment_items_block_delete_bd|O|CREATE TRIGGER shipment_items_block_delete_bd BEFORE DELETE ON public.shipment_items FOR EACH ROW EXECUTE FUNCTION pcm_b2_shipment_items_append_only()
shipment_items_block_truncate_bt|O|CREATE TRIGGER shipment_items_block_truncate_bt BEFORE TRUNCATE ON public.shipment_items FOR EACH STATEMENT EXECUTE FUNCTION pcm_b2_shipment_items_append_only()
shipment_items_block_update_bu|O|CREATE TRIGGER shipment_items_block_update_bu BEFORE UPDATE ON public.shipment_items FOR EACH ROW EXECUTE FUNCTION pcm_b2_shipment_items_append_only()
FN|cf589a111f46fd9ce9f2fc960b21c5ad"
CELL=$((CELL+1))
# 🔴 兩段**分開查再在 shell 併**:`ORDER BY` 之後接 `UNION ALL` 在 PG 是語法錯(本輪實測),
#    而把 ORDER BY 塞進子查詢又是靠未保證的順序保留 —— 兩個都不做。
APPEND_ONLY_TG="$(psql -X "$BASE_URL" -qtA -c \
  "SELECT t.tgname || '|' || t.tgenabled::text || '|' || pg_get_triggerdef(t.oid)
     FROM pg_trigger t
    WHERE t.tgrelid = 'public.shipment_items'::regclass
      AND t.tgname LIKE 'shipment_items_block_%'
      AND NOT t.tgisinternal
    ORDER BY t.tgname" 2>&1)"
APPEND_ONLY_FP="$(psql -X "$BASE_URL" -qtA -c \
  "SELECT 'FN|' || md5(pg_get_functiondef('${APPEND_ONLY_FN}'::regprocedure))" 2>&1)"
APPEND_ONLY_NOW="$APPEND_ONLY_TG
$APPEND_ONLY_FP"
if [ "$APPEND_ONLY_NOW" = "$APPEND_ONLY_EXPECT" ]; then
  ok B12c-append-only "🔴 項12c 結構面:append-only 三支(delete/update/truncate)全在、全 enabled=O、triggerdef 逐字全等,**且函式本體 md5 逐字相符**(換 body 保留外殼那一發殺得死)"
else
  bad "項12c:append-only 的外殼或本體不符(**全等比對**,不是存在性)。實得:
$APPEND_ONLY_NOW"
fi

# ── 項12c 行為面:三支真的會擋 ────────────────────────────────────────────
# 🔴 結構面(上一格)證不到「它真的會擋」—— 只有把一筆已入箱的品項拿去 UPDATE 才證得到。
#    這一格是「守門畫在不變量成立的面」的行為那半:改壞 body 而保留外殼時,上一格靠 md5 紅、
#    本格靠 `NOT-BLOCKED` 紅,兩層各自獨立。
cell_err B12c-blocks P0001 shipment_items_append_only \
"$MK_DRAFT
  INSERT INTO public.shipment_items (shipment_id, order_item_id, shipped_quantity) VALUES (v_ship, v_i4, 2);
  UPDATE public.shipment_items SET shipped_quantity = 9 WHERE shipment_id = v_ship;" \
  "🔴 項12c 行為面:改一筆已入箱品項的數量 ⇒ append-only 擋下(P0001 + conname)——「改箱」這條路真的不通"

log "4/6 項 14 / 15:C9 負測 + C9 承重性"

# ── 項14:C9 擋得住重算寫出來的超額 shipped ────────────────────────────────
# fixture 四值互異 4 / 2 / 1 / 3(plan §4 項14 逐字):
#   quantity=4、receipts 2+1(instock 3 → 刪掉 quantity=1 那筆後 2)、shipped=3。
#   刪除前:C4 3≤4 ✓ C5 3≤3 ✓ C7 3+0≤4 ✓ C6′ 0+3≤4 ✓ C9 3≤3 ✓ ⇒ 全過。
#   刪除後:instock 2、shipped 3 ⇒ **只有 C9 被違反**(3>2);
#   四個值互異讓「比錯欄位」的錯式(shipped≤quantity=4、shipped≤ordered=3)照樣放行
#   ⇒ 紅在 C9 是可歸因的,不是碰巧。
C9_BODY="  INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity)
  VALUES (v_i4, v_sup, 3);
  INSERT INTO public.order_item_procurement_receipts (procurement_id, quantity, received_at, received_by)
  SELECT p.id, 2, now(), 'b2s2b_verify' FROM public.order_item_procurement p WHERE p.order_item_id = v_i4;
  INSERT INTO public.order_item_procurement_receipts (procurement_id, quantity, received_at, received_by)
  SELECT p.id, 1, now(), 'b2s2b_verify' FROM public.order_item_procurement p WHERE p.order_item_id = v_i4;
$MK_DRAFT
  INSERT INTO public.shipment_items (shipment_id, order_item_id, shipped_quantity) VALUES (v_ship, v_i4, 3);
$SHIP_NOW
  SELECT shipped_quantity INTO v_n FROM ${SUMMARY} WHERE order_item_id = v_i4;
  IF v_n IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION '項14 前提破了:出貨後 shipped 應為 3,實為 %(fixture 沒建成,不是 C9 的事)', COALESCE(v_n::text, '<無列>');
  END IF;
  DELETE FROM public.order_item_procurement_receipts r
   USING public.order_item_procurement p
   WHERE r.procurement_id = p.id AND p.order_item_id = v_i4 AND r.quantity = 1;"
cell_err B14-c9-neg 23514 oiqs_shipped_le_instock "$C9_BODY" \
  "🔴 項14 C9 負測:instock 3→2(刪掉 quantity=1 那筆到貨)而 shipped 已是 3 ⇒ 重算被 C9 擋(23514 + conname)"

# ── 項15:C9 承重性 —— DROP 掉之後同一條路徑必須**全綠** ────────────────────
# 🔴 仍被擋 = C9 不是承重件、§1 的蘊含圖錯了(plan §4 項15 逐字)。
#    走 fresh copy 而不是交易內 DDL:DROP CONSTRAINT 後要跑的是**同一段 body**,
#    留在同一個交易裡會讓「被誰擋下」多一層可能性。
CELL=$((CELL+1))
fresh_db b2s2b_c9; C9_URL="$FRESH_URL"
psql -X "$C9_URL" -v ON_ERROR_STOP=1 -q \
  -c "ALTER TABLE ${SUMMARY} DROP CONSTRAINT oiqs_shipped_le_instock" >/dev/null 2>&1 \
  || die "項15:DROP C9 失敗(這座副本不是 post-S2a?)"
C9_DROPPED="$(psql -X "$C9_URL" -qtA -c "SELECT count(*) FROM pg_constraint WHERE conrelid='${SUMMARY}'::regclass AND conname='oiqs_shipped_le_instock'" 2>&1)"
[ "$C9_DROPPED" = "0" ] || die "項15:C9 竟然還在(實得 [$C9_DROPPED])—— 承重性測試的前提沒成立"
C9_OFF_GOT="$(psql -X "$C9_URL" -v ON_ERROR_STOP=0 -qtA 2>&1 <<SQL | sed -n 's/^NOTICE:  GOT:\(.*\)$/\1/p' | head -1
BEGIN;
DO \$cell\$
$DECLS
BEGIN
$FIXTURE
$C9_BODY
  SET CONSTRAINTS ALL IMMEDIATE;
  SELECT (SELECT shipped_quantity FROM ${SUMMARY} WHERE order_item_id = v_i4)::text || '/' ||
         (SELECT instock_quantity FROM ${SUMMARY} WHERE order_item_id = v_i4)::text INTO v_got;
  RAISE NOTICE 'GOT:%', COALESCE(v_got, '<NULL>');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'GOT:ERR:%:%', SQLSTATE, SQLERRM;
END
\$cell\$;
ROLLBACK;
SQL
)"
if [ "$C9_OFF_GOT" = "3/2" ]; then
  ok B15-c9-loadbearing "🔴 項15 C9 承重性:DROP 掉 C9 之後同一條路徑**全綠**,終態 shipped=3 > instock=2 ⇒ C9 確實是唯一承重件"
elif [ -z "$C9_OFF_GOT" ]; then
  bad "項15:拿不到觀察值(測試自身異常;fail-closed 判紅)"
else
  bad "項15 C9 承重性:期望「3/2」(全綠且呈超額),實得「$C9_OFF_GOT」—— 仍被擋代表承重件不是 C9,§1 蘊含圖要重畫"
fi
drop_db b2s2b_c9

log "5/6 項 18:X1 在 COMMIT 失敗 ⇒ 摘要與品項兩邊都回滾(真 COMMIT)"

# ── 項18 ─────────────────────────────────────────────────────────────────
# 🔴 這是全檔唯一用**真 COMMIT** 的一格:X1 是 DEFERRED,它的失敗只在 COMMIT 當下發生。
#    `SET CONSTRAINTS ALL IMMEDIATE` 證不到「COMMIT 失敗後外面看到什麼」。
# 🔴 fixture 必須**先 commit** 才能在交易外回查(否則 0/0/0 是因為 fixture 也回滾了,
#    那是永久警語②那個恆真陷阱)⇒ 走 fresh copy,fixture 單獨 commit。
# 🔴 交易內另外 RAISE NOTICE 出「摘要當下確實被寫成 2」,證明回滾前真的有東西可回滾。
CELL=$((CELL+1))
fresh_db b2s2b_x1; X1_URL="$FRESH_URL"
psql -X "$X1_URL" -v ON_ERROR_STOP=1 -q >/dev/null 2>&1 <<SQL || die "項18:fixture commit 失敗(含庫存 —— 少了它出貨 2 會紅在 C9,錯因指錯方向)"
DO \$fx\$
$DECLS
BEGIN
$FIXTURE
$STOCK_I4
END
\$fx\$;
SQL
X1_ITEM="$(psql -X "$X1_URL" -qtAc "SELECT id FROM public.order_items WHERE variant_sku = 'S2BV-P4'" 2>&1)"
case "$X1_ITEM" in
  ????????-????-????-????-????????????) : ;;
  *) die "項18:取不到已 commit 的 fixture 品項([$X1_ITEM])" ;;
esac
X1_OUT="$(psql -X "$X1_URL" -v ON_ERROR_STOP=0 -v VERBOSITY=verbose -qtA 2>&1 <<SQL
BEGIN;
DO \$x1\$
DECLARE v_cust uuid; v_i4 uuid; v_ship uuid; v_ship2 uuid; v_n integer;
BEGIN
  SELECT customer_user_id INTO v_cust FROM public.orders WHERE display_id = 'PCM-9994-0001';
  SELECT id INTO v_i4 FROM public.order_items WHERE variant_sku = 'S2BV-P4';
  -- 第一箱:正常出貨 ⇒ 重算把摘要寫成 2
  INSERT INTO public.shipments (shipment_reference, customer_user_id, recipient_snapshot, carrier_code)
  VALUES ('BCDFGM', v_cust, '{"name":"王小明","phone":"0900000000","line":"lineid"}'::jsonb, 'hct')
  RETURNING id INTO v_ship;
  INSERT INTO public.shipment_items (shipment_id, order_item_id, shipped_quantity) VALUES (v_ship, v_i4, 2);
  UPDATE public.shipments SET shipped_at = now(), tracking_number = 'S2BT4' WHERE id = v_ship;
  SELECT shipped_quantity INTO v_n FROM public.order_item_quantity_summary WHERE order_item_id = v_i4;
  RAISE NOTICE 'INTXN:%', COALESCE(v_n::text, '<無列>');
  -- 第二箱:離開草稿態但零品項 ⇒ X1 會在 COMMIT 當下炸,整筆交易一起回滾
  INSERT INTO public.shipments (shipment_reference, customer_user_id, recipient_snapshot, carrier_code, hct_status, hct_request_id)
  VALUES ('BCDFGN', v_cust, '{"name":"王小明","phone":"0900000000","line":"lineid"}'::jsonb, 'hct', 'submitted', 'HCTREQ-9')
  RETURNING id INTO v_ship2;
END
\$x1\$;
COMMIT;
SQL
)"
# 🔴 `-v VERBOSITY=verbose` 會在 `NOTICE:  ` **之後插入 SQLSTATE** ——
#    實測(PG17,port 54365)拿到的是 `NOTICE:  00000: INTXN:2`,**不是**加位置前綴。
#    ⇒ 錨成 `^NOTICE:  INTXN:` 會抓不到、那一維靜默變空字串(本輪第一跑實錘)。改成不錨前段。
#    🔴 下面 `^ERROR:  ` 那條之所以還能用,是同一個機制:verbose 讓 ERROR 行變成
#    `ERROR:  P0001: …`,SQLSTATE 剛好落在被抓的位置。**兩條都依賴這件事,改一條要想到另一條。**
X1_INTXN="$(printf '%s' "$X1_OUT" | sed -n 's/.*INTXN:\(.*\)$/\1/p' | head -1)"
X1_ERR="$(printf '%s' "$X1_OUT" | grep -m1 '^ERROR:' | sed -n 's/^ERROR:  \([0-9A-Z]*\).*/\1/p')"
X1_CON="$(printf '%s' "$X1_OUT" | sed -n 's/^CONSTRAINT NAME:  *\(.*\)$/\1/p' | head -1)"
# 🔴 摘要那一維**不能數列數**:fixture 的進貨(STOCK_I4)在 commit 當下就經 A4a 建好了摘要列
#    ⇒ 那一列本來就在,期望 0 列是錯的期望(本輪實錘,實得 0/0/1)。
#    正確的觀察 = 那一列的 **shipped 回到 0**、而 instock 仍是 3(證明列是真的、不是讀不到)。
X1_AFTER="$(psql -X "$X1_URL" -qtAc \
  "SELECT (SELECT count(*) FROM public.shipments)::text || '/' ||
          (SELECT count(*) FROM public.shipment_items)::text || '/' ||
          (SELECT shipped_quantity::text || '/' || instock_quantity::text
             FROM public.order_item_quantity_summary WHERE order_item_id = '$X1_ITEM')" 2>&1)"
X1_OBS="${X1_INTXN}|${X1_ERR}|${X1_CON}|${X1_AFTER}"
if [ "$X1_OBS" = "2|P0001|shipments_items_presence|0/0/0/3" ]; then
  ok B18-x1-commit-rollback "🔴 項18:交易內摘要確實被寫成 shipped=2 → X1 在**真 COMMIT** 炸(P0001/shipments_items_presence)→ 交易外回查 shipments=0 / shipment_items=0 / 摘要 shipped=0(instock 仍 3)⇒ 兩邊都回滾"
else
  bad "項18:期望「2|P0001|shipments_items_presence|0/0/0/3」,實得「$X1_OBS」
     (六維依序 = 交易內觀察到的 shipped / COMMIT 的 SQLSTATE / conname / 交易外 shipments 列數 / shipment_items 列數 / 摘要 shipped/instock)"
fi
drop_db b2s2b_x1

log "6/6 項 20:A4a 鏈四軸活體(直呼 helper)"

# ── 項20 ─────────────────────────────────────────────────────────────────
# 五值互異 quantity=6 / ordered=5 / instock=4 / cancelled=1 / shipped=2:
#   C4 5≤6 ✓ C5 4≤5 ✓ C7 4+1≤6 ✓ C6′ 1+2≤6 ✓ C9 2≤4 ✓。
# 🔴 「rc=0」不是證據(plan §4 通則)⇒ 先把摘要**四軸**蓋成 0,再直呼 helper,回查新值。
#    四軸若有任一軸沒被 helper 寫回,這格就會停在 0。
# 🔴 oracle 的第一維 `quantity` **不具判別力,是報表維**(R1 nit 7):它由 A1 的複合 FK
#    物理釘在 `order_items.quantity` 上,蓋不動也不會被 helper 以外的東西改 ⇒ 恆為 6。
#    真正被證明的是後四維。留著只是讓輸出一眼看得出 fixture 是哪一組。
cell_land B20-helper-live \
"  INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity)
  VALUES (v_i6, v_sup, 5);
  INSERT INTO public.order_item_procurement_receipts (procurement_id, quantity, received_at, received_by)
  SELECT p.id, 3, now(), 'b2s2b_verify' FROM public.order_item_procurement p WHERE p.order_item_id = v_i6;
  INSERT INTO public.order_item_procurement_receipts (procurement_id, quantity, received_at, received_by)
  SELECT p.id, 1, now(), 'b2s2b_verify' FROM public.order_item_procurement p WHERE p.order_item_id = v_i6;
  INSERT INTO public.order_cancellations (order_id, reason_code, idempotency_key, payload_hash, actor)
  VALUES (v_order, 'customer_request', gen_random_uuid(), encode(sha256('b2s2b-c1'::bytea), 'hex'), v_staff);
  INSERT INTO public.order_cancellation_items (cancellation_id, order_id, order_item_id, cancelled_quantity)
  SELECT c.id, v_order, v_i6, 1 FROM public.order_cancellations c WHERE c.order_id = v_order;
$MK_DRAFT
  INSERT INTO public.shipment_items (shipment_id, order_item_id, shipped_quantity) VALUES (v_ship, v_i6, 2);
$SHIP_NOW
  UPDATE ${SUMMARY}
     SET ordered_quantity = 0, instock_quantity = 0, cancelled_quantity = 0, shipped_quantity = 0
   WHERE order_item_id = v_i6;
  PERFORM public.pcm_a4a_recompute_order_item_summary(v_i6);" \
  "(SELECT quantity::text || '/' || ordered_quantity::text || '/' || instock_quantity::text || '/' ||
           cancelled_quantity::text || '/' || shipped_quantity::text
      FROM ${SUMMARY} WHERE order_item_id = v_i6)" "6/5/4/1/2" \
  "🔴 項20 四軸活體:摘要四軸先被蓋成 0 → 直呼 helper → ordered/instock/cancelled/shipped 回到 5/4/1/2(前綴的 quantity=6 是報表維、由複合 FK 釘死,不具判別力)"

# ══ 收尾:副本清除 + 格數與具名 key 集合自斷言(W1)═══════════════════════════
log "收尾"
LEFT="$(psql -X "$ADMIN_URL" -qtAc "SELECT coalesce(string_agg(datname, ',' ORDER BY datname), '') FROM pg_database WHERE datname LIKE 'b2s2b\\_%'" 2>&1)"
if [ -z "$LEFT" ]; then
  ok COPIES-DROPPED "本輪建的副本庫已全數清除(b2s2b_% 零殘留)"
else
  bad "副本庫殘留:[$LEFT] —— 下一輪的 TEMPLATE 複製會踩到它"
fi
# 🔴 起跑前是 0/0,收尾也必須是 0/0:BEGIN…ROLLBACK 的格若有哪一格漏了 ROLLBACK,這裡會抓到。
END_SHIP="$(q "$BASE_URL" 'SELECT count(*) FROM public.shipments')"
END_ITEM="$(q "$BASE_URL" 'SELECT count(*) FROM public.shipment_items')"
END_ORD="$(q "$BASE_URL" "SELECT count(*) FROM public.orders WHERE display_id = 'PCM-9994-0001'")"
[ "$END_SHIP" = "0" ] && [ "$END_ITEM" = "0" ] && [ "$END_ORD" = "0" ] \
  || bad "🔴 基準庫留痕:shipments=$END_SHIP / shipment_items=$END_ITEM / 探針訂單=$END_ORD(應全為 0)"

[ "$CELL" -eq "$EXPECT_CELL" ] || bad "只跑了 $CELL 格行為/結構格,期望 $EXPECT_CELL —— 有格被刪掉或沒被呼叫"
# 🔴 `EXPECT_TOTAL` 原本只出現在下方的 echo、**從未被斷言**,卻被檔頭列進「凍結值」(R1 nit 8)。
#    key 集合等式已經蘊含它,但一個從不比對的凍結值本身就是誤導 ⇒ 補上。
[ "$PASS" -eq "$EXPECT_TOTAL" ] || bad "PASS=$PASS,期望 $EXPECT_TOTAL —— 總格數與凍結值不符"
GOT_KEYS="$(printf '%s' "$PASS_KEYS" | tr ' ' '\n' | grep -v '^$' | sort | tr '\n' ' ' | sed 's/ *$//')"
EXP_KEYS="$(printf '%s' "$EXPECT_PASS_KEYS" | tr ' ' '\n' | grep -v '^$' | sort | tr '\n' ' ' | sed 's/ *$//')"
if [ "$GOT_KEYS" = "$EXP_KEYS" ]; then
  echo "  ✅ 具名 key 集合逐字相符(W1;只凍總數會被「刪一格 + 重複另一格」湊過去)"
else
  bad "🔴 具名 key 集合不符(W1):
     實際 [$GOT_KEYS]
     期望 [$EXP_KEYS]"
fi

echo
echo "PASS=$PASS FAIL=$FAIL (CELL=$CELL / 期望 $EXPECT_CELL、總格 $EXPECT_TOTAL)"
echo "🔴 本輪**零突變靶** —— 這 $EXPECT_CELL 格只被證明「可以滿足」,判別力由 S2b-2b 的兩環境突變矩陣接手。"
[ "$FAIL" -eq 0 ] || exit 1
