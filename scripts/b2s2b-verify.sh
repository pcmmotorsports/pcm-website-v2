#!/usr/bin/env bash
# ============================================================
# B2-S2b 可重現驗證 harness ── 行為段(S2b-2a 建檔)+ 行為突變矩陣(S2b-2b 第一段)
# ============================================================
# 標的 = supabase/migrations/20260806180000_m4b_e10_b2_s2b_shipped_recompute_wire.sql
# 片級 plan = docs/specs/2026-08-06-e10-b2-s2b-recompute-wire-plan.md(v2、已凍結)
#
# 本檔由兩片累積而成,**兩片的範圍分開寫,不要混成一句**:
#   · **S2b-2a**(commit `14daef0`)= 建檔 + plan §4.99 的驗收項 10 / 10b / 11 / 12 / 12b / 12c / 14 / 15 / 18 / 20。
#   · **S2b-2b 第一段**(本輪)= ①pre-S2b 基準庫(突變環境的 TEMPLATE 來源;plan §2.2 W2 的逐字定義)
#     ②**環境 B(行為)突變矩陣**:MUT0 對照 + 五發靶 ③**S2b-1 消融重證**(主視窗 `B-147-A` ③)。
#     🔴 2b 依鐵則 4(片 15-45 分)切成兩段;**第二段**做:環境 A(結構)突變矩陣、項19 barrier、
#     項29 stale-high。切法已報 STOP 由主視窗裁定。
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
# 🔴 **本檔不證明**(逐條寫死,不留給下一棒推測):
#   ⓐ **突變覆蓋是 14 格中的 7 格,不是全部**。逐格清單也印在跑完的結語裡。
#     **有靶的 7 格**:B10 / B10b / B11 / B11b / B12 / B14 / B20。
#     🔴 **其中 B14 只紅在它自己的「前提斷言」那一段**(靶①⑤ 都讓 shipped 根本沒被寫上去)——
#     也就是說 B14 的 C9 判別 oracle **從未被任何一發突變證明有判別力**;它的對照是 B15(消融),
#     不是突變。B12 在靶②④ 下紅在本輪新加的「作廢後必須是 0」中途斷言(那是它自己的內容),
#     但它宣稱的另一半「**unvoid 真的回升**」仍**沒有**任何一發靶殺得到 —— 本線的靶動不到
#     「只壞 unvoid、不壞 void」那條路。兩者都逐字寫在這裡,不要在報告裡簡化成「7 格已證」。
#     **沒靶的 7 格**:B12b-x3 / B12b-x1 / B12c-blocks(驗的是 **S1b** 守門,本檔的突變全在 S2b
#     那支 migration 上、**結構上動不到它們**;那三發靶是 plan 項25b = S2b-4c 的範圍)、
#     B12c-append-only(結構面)/ B15 / B18 / **ABLATION**(消融格本身無靶,它是 B10 的負向對照)。
#   ⓑ **plan §5 環境B 九列只做了五列**(逐列交代,不含糊):
#     做了列 1-4(拿掉 trigger / 漏 `deleted_at IS NULL` / 漏 `shipped_at IS NOT NULL` / 漏 `deleted_at` 事件面)
#     與增補靶末列(`ON CONFLICT` 漏 `shipped_quantity`)。
#     **沒做**:列 5/6(oracle = 項19 barrier,見 ⓒ)、**列 7「backfill 漏候選品項」**
#     (oracle = 項17 差集段,在 migration 檔內;要在 pre 庫上先造出貨資料才構造得出來)、
#     **列 8/9(五份真相式本體 / 第 5 處述詞改恆等式)** —— 那兩列的 oracle 是項21,認領給 **S2b-3a**。
#   ⓒ **環境 A(結構)突變矩陣、項19 barrier、項29 stale-high 都不在本輪**。
#     環境A 的七個靶需要一組**外部結構 oracle**(本檔沒有;S2b-1 的結構驗收在 migration 檔內、
#     突變時會被剝掉)⇒ 連同項19、項29 留給 **S2b-2b 第二段**。
#     (memory `feedback_guard-checks-existence-not-effect`:存在性斷言對「還在但失效」全盲。)
#   ⓓ **正式站行為**:本機 PG17,不是 Supabase;RLS / ACL 的實際行為未驗。
#   ⓔ **W2 的落點**(對凍結 plan 的偏離,已同批改 plan §2.2 的 W2 適用列,不留活字):
#     **S2b-2a** 判 `W2: N/A` —— 它那 13 格逐格檢查後沒有一格需要 pre-S2b 庫。
#     **S2b-2b(本輪)判 W2 適用**,並且真的建了 `b2s2b_pre`(`all` 模式,只重放時間戳早於本檔
#     的前綴)—— 因為突變的對象是 migration 檔本身,必須有一座「還沒套它」的庫才套得上突變版。
#     ⇒ plan `:322` 把 2a 與 2b 並列在 W2 適用範圍**只有 2a 那半不成立**,2b 這半是對的。
#
# 🔴🔴 **永久警語 ①:期望值一律正向寫死,不得由受測 DB 自算** 🔴🔴
#   小線 R1 實錘:「對照組自己算出來再跟自己比」= 恆綠。本檔每一格的 `exp` 都是常數字面。
#
# 🔴🔴 **永久警語 ②:0 值格必須先證明 fixture 真的建起來了** 🔴🔴
#   期望值含 0 的有**五格**:項10b(`1/0/3`)、項11(`0/3`)、項11b(`0/3`)、項18(`0/0/0/3`)、
#   **ABLATION(`0/3`)**(2b R2 nit 1:枚舉寫下即過期,這一條就是實例)。
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
EXPECT_CELL=14     # 行為/結構格(項 10 / 10b / 11 ×2 / 12 / 12b ×2 / 12c ×2 / 14 / 15 / 18 / 20 + 消融重證)
EXPECT_MUT=6       # 突變靶:MUT0 對照 + 靶①②③④⑤(環境 B = 行為;環境 A 結構靶不在本輪,見檔頭 ⓒ)
EXPECT_TOTAL=25    # 上列 14 + ID-GATE + BASE-POST + PRE-BASE + 6 發突變 + MUT-COUNT + COPIES-DROPPED
EXPECT_PASS_KEYS="ID-GATE BASE-POST PRE-BASE \
B10-shipped-lands B10b-draft-not-counted B11-void-returns B11b-void-submitted B12-unvoid-restores \
B12b-x3-blocks B12b-x1-blocks B12c-append-only B12c-blocks B14-c9-neg B15-c9-loadbearing \
B18-x1-commit-rollback B20-helper-live ABLATION \
MUT-0 MUT-1 MUT-2 MUT-3 MUT-4 MUT-5 MUT-COUNT COPIES-DROPPED"

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

# 🔴 「post-S2b」= **本檔就是 migration 目錄的時間序尾端**。
#    provision 迴圈套的是 `*.sql` 全部、沒有時間戳上界 ⇒ 日後新增更晚的 migration 會被**靜默**
#    納入「post-S2b 基準庫」,定義就漂了(plan §2.2 W2 對 pre 側的同一個警告,對稱適用)。
# 🔴 **兩個模式都要驗**(2b R1 nit 4):原本只寫在 `all` 分支內 ⇒ `run` 會在已漂移的
#    base + pre 上全綠零告警,而這道 die 訊息正是為那個情境寫的。
NEWEST_TS="$(ls supabase/migrations/*.sql | sed 's|.*/||; s|_.*||' | sort | tail -1)"
[ "$NEWEST_TS" = "20260806180000" ] \
  || die "migration 目錄的時間序尾端是 $NEWEST_TS,不是本片的 20260806180000 ——
   本檔的「post-S2b 基準庫」與「pre-S2b 前綴」兩個定義都已經漂了。
   處置 = 決定基準要不要含那些新片,並同批更新本行與 MD5_HELPER_4AXIS,**不是把這道閘拿掉**。"

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
  log "0a/8 provision post-S2b 基準庫(port ${PORT};**全前綴、含 ${MIG##*/}**)"
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
  # fixture 的上游來源 = d1t2 seed(customers / orders / order_items / suppliers / staff)。
  pnpm exec tsx scripts/d1t2-seed.ts > "$WORK/seed.sql" 2>"$WORK/seed.err" \
    || die "seed 產生失敗(見 $WORK/seed.err)"
  test -s "$WORK/seed.sql" || die "seed.sql 為空"
  psql -X "$BASE_URL" -v ON_ERROR_STOP=1 -q -f "$WORK/seed.sql" >/dev/null || die "seed 套用失敗"
  # ── 🔴 S2b-2b:pre-S2b 基準庫(突變環境的 TEMPLATE 來源)────────────────────
  # 為什麼一定要它:突變的對象是**本片 migration 檔本身** ⇒ 必須有一座「還沒套它」的庫
  #   才套得上突變版。post 庫上做不到(套第二次會撞既有物件)。
  # 🔴 定義逐字照 `scripts/b2s2a-verify.sh:274-280` 的永久警語①:
  #   **只重放時間戳早於本檔的 migration 前綴**,不是「全部減本檔」——
  #   後者在日後新增更晚的 migration 之後會把它們一起套進「pre」,定義靜默漂移。
  #   (上面那道「時間序尾端必須是本檔」的閘擋的是 post 側的同一種漂移,兩邊都要。)
  log "0b/8 provision pre-S2b 基準庫 b2s2b_pre(只重放時間戳 < 20260806180000 的前綴)"
  psql -X "$ADMIN_URL" -q -c "DROP DATABASE IF EXISTS b2s2b_pre" >/dev/null 2>&1
  psql -X "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE b2s2b_pre" >/dev/null \
    || die "建 b2s2b_pre 失敗"
  PRE_URL="postgresql://postgres@127.0.0.1:${PORT}/b2s2b_pre"
  psql -X "$PRE_URL" -v ON_ERROR_STOP=1 -q -f scripts/d1-supabase-shim.sql || die "pre:shim 失敗"
  for f in supabase/migrations/*.sql; do
    case "$f" in *20260723120000*) continue ;; esac
    # 🔴 檔名必須時間戳開頭(2b R1 nit 7:post 迴圈有這道、pre 漏抄):
    #    非時間戳檔名在 LC_ALL=C 下 `\<` 會比成 false ⇒ **靜默 continue**,那一支就沒進 pre 庫。
    case "$(basename "$f")" in
      [0-9]*) : ;;
      *) die "pre:migration 檔名不是時間戳開頭:$f" ;;
    esac
    TS="${f##*/}"; TS="${TS%%_*}"
    [ "$TS" \< "20260806180000" ] || continue
    if [ "$f" = "$FIRST_FITMENTS" ]; then
      psql -X "$PRE_URL" -v ON_ERROR_STOP=1 -q -f scripts/d1-fitments-bootstrap.sql || die "pre:fitments bootstrap 失敗"
    fi
    psql -X "$PRE_URL" -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null || die "pre:migration 失敗:$f"
  done
  psql -X "$PRE_URL" -v ON_ERROR_STOP=1 -q -f "$WORK/seed.sql" >/dev/null || die "pre:seed 套用失敗"
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

# ══ 0e. pre-S2b 基準庫真的是 pre(突變環境的前提)═══════════════════════════
# 🔴 `run` 模式重用舊 cluster 時,這座庫可能根本不存在或是舊版 ⇒ 在這裡就擋掉,
#    不要等到突變段才紅在「套不上去」。
PRE_URL="postgresql://postgres@127.0.0.1:${PORT}/b2s2b_pre"
psql -X "$PRE_URL" -qtA -c 'SELECT 1' >/dev/null 2>&1 \
  || die "連不上 pre-S2b 基準庫 b2s2b_pre —— 先跑 all(run 模式不會建它)"
# 🔴 兩向都要驗:**S2a 在**(否則本片 migration 的前置閘會擋、突變全部紅在閘而不是紅在 oracle)
#                **S2b 不在**(否則它根本不是 pre,突變版套不上去)。
[ "$(q "$PRE_URL" "SELECT count(*) FROM pg_attribute WHERE attrelid='${SUMMARY}'::regclass AND attname='shipped_quantity' AND NOT attisdropped")" = "1" ] \
  || die "pre 基準庫沒有 shipped_quantity 欄 —— 它連 S2a 都沒套,不是 pre-S2b"
[ "$(q "$PRE_URL" "SELECT count(*) FROM pg_trigger WHERE tgname='${TG_SS}' AND NOT tgisinternal")" = "0" ] \
  || die "pre 基準庫已經有 ${TG_SS} —— 它不是 pre-S2b,整段突變矩陣的判別力歸零"
[ "$(q "$PRE_URL" 'SELECT count(*) FROM public.order_items')" -gt 0 ] 2>/dev/null \
  || die "pre 基準庫沒有 seed(order_items 0 列)—— 突變環境跑不出 fixture"
# 🔴 pre 是**六發突變副本的 TEMPLATE**(2b R1 nit 6):它一髒,整個矩陣一次被污染,
#    而症狀會長得像「某幾發突變沒抓到」。與 base 側同一道起跑閘,不能只有 base 有。
[ "$(q "$PRE_URL" 'SELECT count(*) FROM public.shipments')" = "0" ] \
  && [ "$(q "$PRE_URL" 'SELECT count(*) FROM public.shipment_items')" = "0" ] \
  || die "pre 基準庫的出貨表非 0 列 —— 它被污染過,整個突變矩陣的判別力歸零;重跑 all"
ok PRE-BASE "pre-S2b 基準庫確認(S2a 的 shipped_quantity 欄**在** + ${TG_SS} **不在** + seed 齊 + 出貨表 0 列)"

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
trap 'drop_db b2s2b_c9; drop_db b2s2b_x1; drop_db b2s2b_mut; drop_db b2s2b_abl' EXIT

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
# ── 🔴 S2b-2b:同一組格要跑在**兩種庫**上 ────────────────────────────────────
#   ①`report` 模式 = 對照組(post-S2b 基準庫):逐格 ok/bad,計入 PASS/CELL。
#   ②`collect` 模式 = 突變環境(pre-S2b 副本 + 突變版 migration):**不計入 PASS/CELL**,
#     只把紅掉的格 key 收進 `REDS_IDS`,由突變 runner 與**指定的紅點集合**逐字比對。
#   🔴 只比「紅了幾格」會被「指定格失效 + 另一格意外轉紅」騙過(小線 codex 關卡2 實錘)
#     ⇒ 一律比**集合**。
ORACLE_URL=""; ORACLE_MODE="report"; REDS_IDS=""
cell_result() {   # $1 = key、$2 = 是否通過(0/1)、$3 = 成功訊息、$4 = 失敗訊息
  RUN_KEYS="$RUN_KEYS $1"
  if [ "$ORACLE_MODE" = "collect" ]; then
    [ "$2" -eq 0 ] || REDS_IDS="$REDS_IDS $1"
    return 0
  fi
  CELL=$((CELL+1))
  if [ "$2" -eq 0 ]; then ok "$1" "$3"; else bad "$4"; fi
}

cell_land() {   # $1 = key、$2 = body、$3 = oracle SQL、$4 = 期望值、$5 = 標籤
  local key="$1" body="$2" oracle="$3" want="$4" label="$5" got
  got="$(psql -X "$ORACLE_URL" -v ON_ERROR_STOP=0 -qtA 2>&1 <<SQL | sed -n 's/^NOTICE:  GOT:\(.*\)$/\1/p' | head -1
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
  # 🔴 **空觀察值必須排在相等比對之前**(2b R2 nit 2):放在後面時,未來若有人傳一個空的 `want`,
  #    「空 == 空」會走進通過那一支 = 潛伏的 fail-open。順序本身就是斷言的一部分。
  if [ -z "$got" ]; then
    cell_result "$key" 1 "" "$label —— 🔴 拿不到觀察值(測試自身異常;fail-closed 判紅)"
  elif [ "$got" = "$want" ]; then
    cell_result "$key" 0 "$label(oracle=$want)" ""
  else
    cell_result "$key" 1 "" "$label —— 期望 oracle=「$want」,實得「$got」"
  fi
}

cell_err() {   # $1 = key、$2 = 期望 SQLSTATE、$3 = 期望 conname、$4 = body、$5 = 標籤
  local key="$1" want_state="$2" want_con="$3" body="$4" label="$5" got
  got="$(psql -X "$ORACLE_URL" -v ON_ERROR_STOP=0 -qtA 2>&1 <<SQL | sed -n 's/^NOTICE:  GOT:\(.*\)$/\1/p' | head -1
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
  # 🔴 同上:空觀察值排最前(2b R2 nit 2)。
  if [ -z "$got" ]; then
    cell_result "$key" 1 "" "$label —— 🔴 拿不到觀察值(測試自身異常;fail-closed 判紅)"
  elif [ "$got" = "${want_state}|${want_con}" ]; then
    cell_result "$key" 0 "$label(${want_state} / CONSTRAINT=${want_con})" ""
  else
    cell_result "$key" 1 "" "$label —— 期望「${want_state}|${want_con}」,實得「$got」"
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

# ══ 行為 oracle:同一組格,跑在對照組庫與每一個突變庫上 ═══════════════════════
# 🔴 每格各自包成一支函式**放在它原本的位置**(不搬動),由下方 `beh_oracle` 依序呼叫。
#    這樣「格的定義」只有一份 —— plan §2 不拆 2b 的理由正是「拆開會讓 fixture 定義出現兩份」。
CELL_B10() {
# ── 項10:建箱掛品項 → UPDATE shipped_at → shipped = 該量 ──────────────────
cell_land B10-shipped-lands \
"$STOCK_I4
$MK_DRAFT
  INSERT INTO public.shipment_items (shipment_id, order_item_id, shipped_quantity) VALUES (v_ship, v_i4, 2);
$SHIP_NOW" \
  "$SHIPPED_OF_I4" "2/3" \
  "項10 正測:進貨 3 → 建箱掛品項(2)→ 設 shipped_at ⇒ 摘要 shipped/instock 落庫 = 2/3"
}

CELL_B10b() {
# ── 項10b:草稿箱(有品項、未設 shipped_at)⇒ shipped 仍 0 ────────────────
# 🔴 這一格的 0 **不能單獨當觀察值**(永久警語②):沒建成 fixture 時同樣是 0/沒有列。
#    ⇒ oracle 回「品項列數 / shipped / instock」三維,期望 `1/0/3` —— 前後兩維非 0,
#      證明箱子真的有貨、摘要列真的被重算過。
# 🔴🔴 **`PERFORM` 那一行(下方)為什麼不可以刪**(R1 must-fix 1 更正我原本寫錯的理由):
#    摘要列**不是**它建的 —— `STOCK_I4` 的 `INSERT order_item_procurement` 就已觸發
#    `order_item_procurement_summary_recompute_zc`(`20260803140000:409-413`)建好了列
#    (instock=3、shipped=0)。`PERFORM` 的真正作用是**把最後一次重算挪到掛品項之後**。
#    少了它,「真相式漏掉 `shipped_at IS NOT NULL`」那個突變(2b 靶③,唯一 oracle = 本格)
#    會存活而本格照樣綠 —— 因為最後一次重算發生在品項還不存在的時候。**它是本格的判別力本身。**
# 🔴 這一格也要進貨 3:草稿箱裡放的量刻意也是 **3**,讓「真相式漏掉 shipped_at IS NOT NULL」
#    這個突變(2b 的靶③)算出來的是**合法的 3**、只在值上翻面 —— 沒有庫存的話它會紅在 C9,
#    那是紅對了但**紅在別的理由**,靶就殺不到這一格(memory `feedback_negative-test-...`)。
cell_land B10b-draft-not-counted \
"$STOCK_I4
$MK_DRAFT
  INSERT INTO public.shipment_items (shipment_id, order_item_id, shipped_quantity) VALUES (v_ship, v_i4, 3);
  PERFORM public.pcm_a4a_recompute_order_item_summary(v_i4);" \
  "(SELECT count(*) FROM public.shipment_items WHERE order_item_id = v_i4)::text || '/' ||
   ($SHIPPED_OF_I4)" "1/0/3" \
  "項10b 草稿箱格:掛了品項(1 列、量 3、庫存 3)但沒設 shipped_at ⇒ 真相式的 shipped_at IS NOT NULL 把它排除,shipped = 0"
}

# 🔴 三格共用的前提斷言(R1 nit 6):作廢/unvoid **之前** shipped 必須真的是 2。
#    少了它,期望值 0 的那兩格會與「這條路徑從頭到尾沒把 shipped 寫上去」共用同一個觀察值;
#    非 0 的 instock 維是 **receipts 軸**寫的(`20260803140000:415-418`),證不到「作廢事件觸發了重算」。
#    形狀與 B14 的前提斷言(下方)同構,不另立一種寫法。
PRE_SHIPPED_2="  SELECT shipped_quantity INTO v_n FROM ${SUMMARY} WHERE order_item_id = v_i4;
  IF v_n IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION '前提破了:作廢/unvoid 之前 shipped 應為 2,實為 %(這條路徑沒把 shipped 寫上去,不是作廢的事)', COALESCE(v_n::text, '<無列>');
  END IF;"

CELL_B11() {
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
}

CELL_B11b() {
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
}

CELL_B12() {
# ── 項12:由「已出貨作廢態」unvoid ⇒ 回升 ────────────────────────────────
# 🔴 X7 是雙向配對((deleted_at IS NULL) = (void_reason IS NULL))⇒ unvoid 必須兩欄一起清。
# 🔴 plan 項12 的字面是「unvoid 回升(**含**由已出貨作廢態 unvoid)」—— 本格做的就是括號內那個。
#    另一個可能的讀法(從未出貨的作廢箱 unvoid)**刻意不做**:那條路徑的觀察值是 0 → 0,
#    真相式怎麼寫都成立 = 恆真格,加了只是把格數變好看。理由寫在這裡,不是省略。
# 🔴🔴 **中途斷言不可省**(2b R1 must-fix 4:本格原本是恆綠格):
#    只斷言「最後是 2」時,任何讓 void 與 unvoid **都不發火**的突變(例如靶④ 拿掉
#    `deleted_at` 事件面)會讓值全程凍在 2 ⇒ 本格照樣綠,而它宣稱在證的「unvoid 回升」
#    根本沒被觀察到。⇒ 中間插一道「作廢後必須是 0」,讓 2 → 0 → 2 三個點都被釘住。
cell_land B12-unvoid-restores \
"$STOCK_I4
$MK_DRAFT
  INSERT INTO public.shipment_items (shipment_id, order_item_id, shipped_quantity) VALUES (v_ship, v_i4, 2);
$SHIP_NOW
$PRE_SHIPPED_2
  UPDATE public.shipments SET deleted_at = now(), void_reason = '誤作廢' WHERE id = v_ship;
  SELECT shipped_quantity INTO v_n FROM ${SUMMARY} WHERE order_item_id = v_i4;
  IF v_n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '項12 中途斷言破了:作廢後 shipped 應為 0,實為 %(value 全程凍住 ⇒ 本格量不到 unvoid 回升)', COALESCE(v_n::text, '<無列>');
  END IF;
  UPDATE public.shipments SET deleted_at = NULL, void_reason = NULL WHERE id = v_ship;" \
  "$SHIPPED_OF_I4" "2/3" \
  "項12 unvoid 回升:由已出貨作廢態 unvoid ⇒ shipped 回到 2(deleted_at 事件面真的掛上了)"
}

CELL_B12b_x3() {
# ── 項12b 第一格:INSERT 帶 shipped_at + 加品項 ⇒ 必被 X3 擋 ────────────────
cell_err B12b-x3-blocks P0001 shipment_items_parent_open \
"  INSERT INTO public.shipments (shipment_reference, customer_user_id, recipient_snapshot, carrier_code, tracking_number, shipped_at)
  VALUES ('BCDFGJ', v_cust, '{\"name\":\"王小明\",\"phone\":\"0900000000\",\"line\":\"lineid\"}'::jsonb, 'hct', 'S2BT2', now())
  RETURNING id INTO v_ship;
  INSERT INTO public.shipment_items (shipment_id, order_item_id, shipped_quantity) VALUES (v_ship, v_i4, 2);" \
  "🔴 項12b-①:INSERT 一筆帶 shipped_at 的包裹再加品項 ⇒ 被 X3 擋(這條倒了,shipped 會有 UPDATE 以外的來源)"
}

CELL_B12b_x1() {
# ── 項12b 第二格:INSERT 帶 shipped_at 但不加品項 ⇒ COMMIT 時必被 X1 擋 ────
cell_err B12b-x1-blocks P0001 shipments_items_presence \
"  INSERT INTO public.shipments (shipment_reference, customer_user_id, recipient_snapshot, carrier_code, tracking_number, shipped_at)
  VALUES ('BCDFGK', v_cust, '{\"name\":\"王小明\",\"phone\":\"0900000000\",\"line\":\"lineid\"}'::jsonb, 'hct', 'S2BT3', now())
  RETURNING id INTO v_ship;" \
  "🔴 項12b-②:同一筆 INSERT 但不加品項 ⇒ 延遲檢查 X1 擋下(兩條路都不通 = §0.3 前提成立)"
}

CELL_B12c_blocks() {
# ── 項12c 行為面:三支真的會擋 ────────────────────────────────────────────
# 🔴 結構面(上一格)證不到「它真的會擋」—— 只有把一筆已入箱的品項拿去 UPDATE 才證得到。
#    這一格是「守門畫在不變量成立的面」的行為那半:改壞 body 而保留外殼時,上一格靠 md5 紅、
#    本格靠 `NOT-BLOCKED` 紅,兩層各自獨立。
cell_err B12c-blocks P0001 shipment_items_append_only \
"$MK_DRAFT
  INSERT INTO public.shipment_items (shipment_id, order_item_id, shipped_quantity) VALUES (v_ship, v_i4, 2);
  UPDATE public.shipment_items SET shipped_quantity = 9 WHERE shipment_id = v_ship;" \
  "🔴 項12c 行為面:改一筆已入箱品項的數量 ⇒ append-only 擋下(P0001 + conname)——「改箱」這條路真的不通"
}

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
CELL_B14() {
cell_err B14-c9-neg 23514 oiqs_shipped_le_instock "$C9_BODY" \
  "🔴 項14 C9 負測:instock 3→2(刪掉 quantity=1 那筆到貨)而 shipped 已是 3 ⇒ 重算被 C9 擋(23514 + conname)"
}

CELL_B15() {
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
}

CELL_B18() {
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
}

CELL_B20() {
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
}

# ── 項12c 結構面:三支 append-only 的外殼 + 函式本體 md5 ────────────────────
# 🔴 為什麼要這一格(plan §4 項12c / Fable 翻案條件③):X3 / X1 只擋「加品項」與「零品項出貨」,
#    **改/刪已寄出箱的品項**是這三支在擋。它們被放寬時,shipped 真值變動不經 UPDATE shipments
#    ⇒ 本線 trigger 不發火、摘要靜默漂移,而項 10-12 全綠。
# 🔴 `tgenabled` 是 "char" 不是 text,不 cast 會 42725 operator is not unique(2026-08-06 實錘)。
# 🔴🔴 **必須連函式本體一起 pin**(2a 的 R1 must-fix 2):三支 trigger 指的是同一支函式,
#    把 body 換成 `RETURN NEW`,`tgname / tgenabled / pg_get_triggerdef` **逐字都不會變**
#    ⇒ 只比外殼的話本格全綠,而「改/刪已寄出箱品項」已經全面放行
#    (memory `feedback_guard-checks-existence-not-effect`)。
# 🔴 本格**只跑在對照組庫**:它驗的是 **S1b** 的產物,S2b 的突變動不到它 ⇒ 放進突變 oracle
#    只會製造一格恆綠的雜訊。理由寫在這裡,不是漏掉。
APPEND_ONLY_FN="public.pcm_b2_shipment_items_append_only()"
APPEND_ONLY_EXPECT="shipment_items_block_delete_bd|O|CREATE TRIGGER shipment_items_block_delete_bd BEFORE DELETE ON public.shipment_items FOR EACH ROW EXECUTE FUNCTION pcm_b2_shipment_items_append_only()
shipment_items_block_truncate_bt|O|CREATE TRIGGER shipment_items_block_truncate_bt BEFORE TRUNCATE ON public.shipment_items FOR EACH STATEMENT EXECUTE FUNCTION pcm_b2_shipment_items_append_only()
shipment_items_block_update_bu|O|CREATE TRIGGER shipment_items_block_update_bu BEFORE UPDATE ON public.shipment_items FOR EACH ROW EXECUTE FUNCTION pcm_b2_shipment_items_append_only()
FN|cf589a111f46fd9ce9f2fc960b21c5ad"
CELL_B12c_struct() {
CELL=$((CELL+1))
# 🔴 兩段**分開查再在 shell 併**:`ORDER BY` 之後接 `UNION ALL` 在 PG 是語法錯(2a 實測),
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
}

# ══ 行為 oracle 的呼叫序(**唯一一份**,對照組與每個突變靶共用)════════════════
# 🔴 這 10 格是「S2b 的行為面」⇒ 每個突變都要拿它們當 oracle。
#    B12c 結構面 / B15 / B18 **不在**這裡:前者驗的是 S1b 產物,後兩者自己開副本庫
#    (`fresh_db` 從 `postgres` 複製),在突變環境下複製到的會是**未突變**的基準庫 ⇒
#    放進來會是三格恆綠的雜訊。誠實列出,不是漏掉。
# 🔴 `BEH_KEYS` **必須被比對**,不能只是長得像凍結值(2b R1 nit 1;與 `EXPECT_TOTAL` 同型)——
#    少呼叫一格時 `collect` 模式不計 CELL、上游的 CELL 斷言看不見它 ⇒ 那一格靜默消失,
#    而「紅點集合相符」在少了一格的情況下**還是可能成立**。⇒ 每輪逐字對 key 集合。
BEH_KEYS="B10-shipped-lands B10b-draft-not-counted B11-void-returns B11b-void-submitted B12-unvoid-restores B12b-x3-blocks B12b-x1-blocks B12c-blocks B14-c9-neg B20-helper-live"
RUN_KEYS=""
beh_oracle() {   # $1 = URL、$2 = 模式(report|collect)
  ORACLE_URL="$1"; ORACLE_MODE="$2"; REDS_IDS=""; RUN_KEYS=""
  CELL_B10; CELL_B10b; CELL_B11; CELL_B11b; CELL_B12
  CELL_B12b_x3; CELL_B12b_x1; CELL_B12c_blocks; CELL_B14; CELL_B20
  REDS_IDS="$(printf '%s' "$REDS_IDS" | tr ' ' '\n' | grep -v '^$' | sort | tr '\n' ' ' | sed 's/ *$//')"
  local rgot rexp
  rgot="$(printf '%s' "$RUN_KEYS" | tr ' ' '\n' | grep -v '^$' | sort | tr '\n' ' ' | sed 's/ *$//')"
  rexp="$(printf '%s' "$BEH_KEYS" | tr ' ' '\n' | grep -v '^$' | sort | tr '\n' ' ' | sed 's/ *$//')"
  [ "$rgot" = "$rexp" ] || bad "🔴 beh_oracle 實際跑過的格集合不符(URL=$1):
     實際 [$rgot]
     期望 [$rexp]"
}

log "1/8 行為對照組(post-S2b 基準庫;10 格)"
beh_oracle "$BASE_URL" report

log "2/8 只跑在對照組的三格(項12c 結構面 / 項15 C9 承重性 / 項18 真 COMMIT 回滾)"
CELL_B12c_struct
CELL_B15
CELL_B18

# ══ 3/8-6/8:突變矩陣(環境 B = 行為)═══════════════════════════════════════
# 🔴🔴 **永久警語 ③:突變必須先剝掉 migration 自己的 §5 結構驗收 DO block** 🔴🔴
#   否則突變會先被 migration 的自我檢查擋下、apply 直接 abort ⇒ 你證明的是
#   「migration 會自我檢查」(S2b-1 已證),**不是**「本 harness 的 oracle 有判別力」。
#   剝除本身要有對照組:**MUT0 = 只剝不改,10 格必須全綠**。
# 🔴 比對象 = **mut0**,不是原檔(plan §2.2 W5 ①):比原檔恆為不同(因為一律先剝 §5)
#   ⇒ 那道「真的改到東西」的守門會恆真、從來不可能觸發(小線 code-reviewer R1 實錘)。
# 🔴 `cmp` 的 **rc=2 是讀不到檔、判紅**,不得用 `&&…||…` 把它歸進「有差異」那一支(W5 ③)。
MUT=0
STRIP_BEGIN='-- ══ 5. 檔內結構驗收'
STRIP_END='-- ══ 6. 註解'
make_mutant() {   # $1 = 輸出檔、$2 = 取代來源(空 = 只剝)、$3 = 取代目標
  MIG="$MIG" OUT="$1" SRC="$2" DST="$3" SB="$STRIP_BEGIN" SE="$STRIP_END" python3 - <<'PY'
import io, os
s = io.open(os.environ['MIG'], encoding='utf-8').read()
sb, se = os.environ['SB'], os.environ['SE']
i, j = s.find(sb), s.find(se)
if i < 0 or j < 0 or j <= i:
    raise SystemExit('🔴 剝除錨找不到或順序反了 —— migration 的 §5 段落標題被改過了')
s = s[:i] + s[j:]
src, dst = os.environ['SRC'], os.environ['DST']
if src:
    n = s.count(src)
    if n != 1:
        raise SystemExit('🔴 突變錨在剝除後的檔內命中 %d 次(必須恰 1 次):%r' % (n, src[:60]))
    s = s.replace(src, dst)
io.open(os.environ['OUT'], 'w', encoding='utf-8').write(s)
PY
}
# 🔴 `make_mutant` 的 rc 一定要接(2b R1 nit 3):python 的 SystemExit 若被吞掉,
#    後面會拿殘留的舊檔繼續跑。所有靶一律走這支 wrapper。
make_mutant_or_die() { make_mutant "$@" || die "make_mutant 失敗(輸出檔 $1)—— 突變錨可能已隨 migration 改動而失效"; }
# 🔴 逐發突變:期望紅點集合**寫死**,不是「反正紅了就算抓到」(判定紀律①)。
run_mutant() {   # $1 = 靶名、$2 = 突變檔、$3 = 期望紅格集合(空 = 應全綠)、$4 = key、$5 = 比對基準檔
  # 🔴 `$6` 是選用參數 —— `set -u` 下直接引用未給的 `$6` 會整支炸掉,先收進 local 帶預設。
  local name="$1" file="$2" want="$3" key="$4" basefile="$5" structflag="${6:-}" db="b2s2b_mut" rc
  MUT=$((MUT+1))
  # 🔴 產物存在且非空(2b R1 nit 3):`make_mutant` 的 python 若 SystemExit,`run` 模式會拿
  #    `$WORK` 裡**上一輪殘留的**同名檔去跑而仍可能判過。這道是它的直接守門。
  [ -s "$file" ] || { bad "$name:突變檔 $file 不存在或為空 —— make_mutant 失敗,這一發沒有跑"; return; }
  # ①先證「真的改到東西」——rc=0 相同 / rc=1 有差異 / rc=2 讀不到檔(判紅,不歸進「有差異」)
  if [ -n "$basefile" ]; then
    cmp -s "$basefile" "$file"; rc=$?
    case "$rc" in
      1) : ;;
      0) bad "$name:突變檔與基準檔**逐字相同** —— sed/replace 沒改到東西,這一發等於沒跑"; return ;;
      *) bad "$name:cmp 讀不到檔(rc=$rc)—— 判紅,不當成「有差異」"; return ;;
    esac
  fi
  psql -X "$ADMIN_URL" -q -c "DROP DATABASE IF EXISTS $db" >/dev/null 2>&1
  psql -X "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE $db TEMPLATE b2s2b_pre" >/dev/null 2>&1 \
    || { sleep 1; psql -X "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE $db TEMPLATE b2s2b_pre" >/dev/null 2>&1 \
         || { bad "$name:從 b2s2b_pre 複製副本失敗"; return; }; }
  local U="postgresql://postgres@127.0.0.1:${PORT}/$db"
  if ! psql -X "$U" -v ON_ERROR_STOP=1 -q -f "$file" > "$WORK/mut-$key.log" 2>&1; then
    bad "$name:突變版 migration 套不上去($(grep -m1 ERROR "$WORK/mut-$key.log" | cut -c1-90))
     🔴 套不上去 ≠ 抓到 —— 這一發沒有量到任何 oracle,不得算過"
    drop_db "$db"; return
  fi
  # 🔴 **MUT0 專用的結構對照**(2b R1 nit 8):行為 10 格看不見「剝多了」——
  #    若剝除區間不小心吃掉 REVOKE / COMMENT / §5 以外的結構,10 格仍會全綠。
  #    ⇒ 對照組另外在**突變庫上**驗三件事:helper 四軸指紋、trigger 在、新函式 proacl 非 NULL。
  #    只對 MUT0 做 —— 靶①-⑤ 本來就會改動這些,對它們做等於要求突變不生效。
  if [ "$structflag" = "struct" ]; then
    local smd5 stg sacl
    smd5="$(q "$U" "SELECT md5(pg_get_functiondef('${HELPER}'::regprocedure))")"
    stg="$(q "$U" "SELECT count(*) FROM pg_trigger WHERE tgname='${TG_SS}' AND NOT tgisinternal")"
    sacl="$(q "$U" "SELECT proacl IS NOT NULL FROM pg_proc WHERE oid='public.pcm_a4a_shipments_summary_recompute()'::regprocedure")"
    if [ "$smd5" != "$MD5_HELPER_4AXIS" ] || [ "$stg" != "1" ] || [ "$sacl" != "t" ]; then
      bad "$name:**剝多了** —— 剝除 §5 之後的結構與 post 基準不一致
     helper md5=[$smd5](期望 $MD5_HELPER_4AXIS)/ trigger 數=[$stg](期望 1)/ 新函式 proacl 非 NULL=[$sacl](期望 t)
     🔴 行為 10 格對這種偏差全盲,所以這道只在 MUT0 上跑"
      drop_db "$db"; return
    fi
  fi
  beh_oracle "$U" collect
  drop_db "$db"
  if [ "$REDS_IDS" = "$want" ]; then
    if [ -z "$want" ]; then ok "$key" "$name:10 格全綠(對照組成立 —— 剝除 §5 本身不改變任何行為)"
    else ok "$key" "$name ⇒ 紅點集合逐字相符:[$want]"; fi
  else
    bad "$name:紅點集合不符
     實際 [$REDS_IDS]
     期望 [$want]"
  fi
}

log "3/8 突變對照組 MUT0(只剝 §5、零改動)"
make_mutant "$WORK/mut0.sql" "" "" || die "mut0 產生失敗(make_mutant 非零退出)"
test -s "$WORK/mut0.sql" || die "mut0.sql 為空"
# 🔴 `cmp` 的 rc=2(讀不到檔)不得被 `&&` 歸進「相同/不同」任何一支(本檔 W5 ③ 自己立的規矩;
#    2b R1 nit 2:run_mutant 三分支寫對了,唯獨這裡沒有)。
cmp -s "$MIG" "$WORK/mut0.sql"; MUT0_RC=$?
case "$MUT0_RC" in
  1) : ;;
  0) die "mut0 與原檔逐字相同 —— §5 根本沒被剝掉,整段突變在證明 migration 自我檢查而不是本檔 oracle" ;;
  *) die "mut0 的 cmp 讀不到檔(rc=$MUT0_RC)—— 判紅,不當成「有差異」" ;;
esac
run_mutant "MUT0-只剝不改" "$WORK/mut0.sql" "" MUT-0 "" struct

log "4/8 靶① 拿掉 shipments 那支重算 trigger"
# plan §5 環境B 第一列:唯一 oracle = 項10(shipped 恆 0 且**零錯誤**)。
make_mutant_or_die "$WORK/mut1.sql" \
'CREATE CONSTRAINT TRIGGER shipments_summary_recompute_ac
  AFTER UPDATE OF shipped_at, deleted_at ON public.shipments
  NOT DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW
  EXECUTE FUNCTION public.pcm_a4a_shipments_summary_recompute();' \
'SELECT 1;'
run_mutant "靶①-拿掉重算 trigger" "$WORK/mut1.sql" \
  "B10-shipped-lands B11-void-returns B11b-void-submitted B12-unvoid-restores B14-c9-neg" \
  MUT-1 "$WORK/mut0.sql"

log "5/8 靶②③ 真相式各漏一條述詞"
# 🔴 兩發都動 helper 的第四軸真相式(§1),各漏一個過濾條件。
make_mutant_or_die "$WORK/mut2.sql" \
'     AND s.deleted_at IS NULL          -- Q3=A:作廢即退量
     AND s.shipped_at IS NOT NULL;     -- 未寄出的草稿箱不算' \
'     AND s.shipped_at IS NOT NULL;'
run_mutant "靶②-真相式漏 deleted_at IS NULL" "$WORK/mut2.sql" \
  "B11-void-returns B11b-void-submitted B12-unvoid-restores" MUT-2 "$WORK/mut0.sql"

make_mutant_or_die "$WORK/mut3.sql" \
'     AND s.deleted_at IS NULL          -- Q3=A:作廢即退量
     AND s.shipped_at IS NOT NULL;     -- 未寄出的草稿箱不算' \
'     AND s.deleted_at IS NULL;'
run_mutant "靶③-真相式漏 shipped_at IS NOT NULL" "$WORK/mut3.sql" \
  "B10b-draft-not-counted" MUT-3 "$WORK/mut0.sql"

log "6/8 靶④ 漏 deleted_at 事件面 / 靶⑤ ON CONFLICT 漏第四軸"
make_mutant_or_die "$WORK/mut4.sql" \
'  AFTER UPDATE OF shipped_at, deleted_at ON public.shipments' \
'  AFTER UPDATE OF shipped_at ON public.shipments'
run_mutant "靶④-trigger 漏 deleted_at 事件面" "$WORK/mut4.sql" \
  "B11-void-returns B11b-void-submitted B12-unvoid-restores" MUT-4 "$WORK/mut0.sql"
# 🔴 **靶②與靶④ 的紅點集合完全相同**(2b R1 nit 9)——「真相式漏述詞」與「trigger 漏事件面」
#    在本組 oracle 下**區分不了**。兩發都留是刻意的:它們壞的是不同層(函式體 vs trigger 綁定),
#    未來若有人以「重複靶」為由砍掉一發,另一層就沒有任何靶了。要區分它們需要一格
#    「作廢後**沒有任何重算被觸發**」的觀察(例如比對 xact 內的 trigger 執行痕跡),本輪沒做。

# plan §5 增補靶最後一列:「helper 的 ON CONFLICT 漏掉 shipped_quantity 欄」,唯一 oracle = 項20。
# 🔴 這一發專打 §0.6b 的病根(既有 shipped 值被原樣保留 ⇒ stale-high 殘留)。
make_mutant_or_die "$WORK/mut5.sql" \
'        cancelled_quantity = EXCLUDED.cancelled_quantity,
        shipped_quantity   = EXCLUDED.shipped_quantity;' \
'        cancelled_quantity = EXCLUDED.cancelled_quantity;'
run_mutant "靶⑤-ON CONFLICT 漏 shipped_quantity" "$WORK/mut5.sql" \
  "B10-shipped-lands B11-void-returns B11b-void-submitted B12-unvoid-restores B14-c9-neg B20-helper-live" \
  MUT-5 "$WORK/mut0.sql"

[ "$MUT" -eq "$EXPECT_MUT" ] && ok MUT-COUNT "突變靶跑了 $MUT 發,與凍結值相符" \
  || bad "突變靶只跑了 $MUT 發,期望 $EXPECT_MUT —— 有靶被刪掉或沒被呼叫"

# 🔴 突變段結束:把全域旗標重設回 report(2b R1 nit 12)——
#    停在 collect + 已 DROP 的 mut URL 時,日後在這之後加的任何 cell 會**靜默不計** CELL/PASS。
ORACLE_MODE="report"; ORACLE_URL="$BASE_URL"

log "7/8 S2b-1 消融重證(主視窗 B-147-A ③:推論轉觀察)"
# 🔴 為什麼要這一格:S2b-1 交付時的行為實證第⑤條(停用本 trigger 後 shipped 不再跟動)
#    是在**修關卡2 findings 之前**的那座拋棄庫上證的;修完的新庫上只重跑了 ①-④,
#    ⑤ 因「同一交易內有 pending trigger events 不能 ALTER TABLE」構造不出來。
#    S2b-1 當時的說法是「修的是閘不是函式本體,所以結論不變」——**那是推論,不是觀察**。
# 🔴 構造法(plan §4.99 逐字):獨立交易**開頭**先 DISABLE TRIGGER(此時無 pending events),
#    再跑完整出貨串,斷言 shipped 凍在 0。走 fresh copy,DDL 不碰基準庫。
CELL=$((CELL+1))
fresh_db b2s2b_abl; ABL_URL="$FRESH_URL"
ABL_GOT="$(psql -X "$ABL_URL" -v ON_ERROR_STOP=0 -qtA 2>&1 <<SQL | sed -n 's/^NOTICE:  GOT:\(.*\)$/\1/p' | head -1
BEGIN;
ALTER TABLE public.shipments DISABLE TRIGGER ${TG_SS};
DO \$abl\$
$DECLS
BEGIN
$FIXTURE
$STOCK_I4
$MK_DRAFT
  INSERT INTO public.shipment_items (shipment_id, order_item_id, shipped_quantity) VALUES (v_ship, v_i4, 2);
$SHIP_NOW
  SET CONSTRAINTS ALL IMMEDIATE;
  SELECT ($SHIPPED_OF_I4) INTO v_got;
  RAISE NOTICE 'GOT:%', COALESCE(v_got, '<NULL>');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'GOT:ERR:%:%', SQLSTATE, SQLERRM;
END
\$abl\$;
ROLLBACK;
SQL
)"
# 期望 `0/3`:shipped **凍在 0**(trigger 沒跑),instock 仍 3(receipts 軸照常 ⇒ 這一列是真的、
# 不是「整條路徑都沒跑」)。對照組同一條路徑是 `2/3`(項10),兩者只差在 trigger 有沒有停用。
if [ "$ABL_GOT" = "0/3" ]; then
  ok ABLATION "🔴 消融重證(**最終版的庫**):停用 ${TG_SS} 後跑完整出貨串 ⇒ shipped 凍在 0、instock 仍 3;對照組同路徑是 2/3 ⇒ 那 2 確實是這支 trigger 寫的"
elif [ -z "$ABL_GOT" ]; then
  bad "消融重證:拿不到觀察值(測試自身異常;fail-closed 判紅)"
else
  bad "消融重證:期望「0/3」(shipped 凍在 0),實得「$ABL_GOT」
     🔴 若得到 2/3,代表**停用這支 trigger 之後摘要仍然跟動** = 有第二條未知的寫入路徑,
     那會推翻 S2b-1「只掛一支」的整個論證(Fable 當時給的翻案條件,逐字)。"
fi
drop_db b2s2b_abl

# ══ 收尾:副本清除 + 格數與具名 key 集合自斷言(W1)═══════════════════════════
log "收尾"
# 🔴 `b2s2b_pre` **不是副本、是常駐的 pre-S2b 基準庫**(突變環境的 TEMPLATE 來源),
#    每輪重用 ⇒ 必須排除,否則這一格永遠紅(本輪實測)。排除的是**具名的那一個**,
#    不是把 pattern 放寬成「開頭是 b2s2b 的都算」—— 後者會把真的殘留副本一起放行。
LEFT="$(psql -X "$ADMIN_URL" -qtAc "SELECT coalesce(string_agg(datname, ',' ORDER BY datname), '') FROM pg_database WHERE datname LIKE 'b2s2b\\_%' AND datname <> 'b2s2b_pre'" 2>&1)"
if [ -z "$LEFT" ]; then
  ok COPIES-DROPPED "本輪建的副本庫已全數清除(b2s2b_% 零殘留;常駐的 b2s2b_pre 不計)"
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
echo "🔴 突變覆蓋(**逐格,不四捨五入**):$EXPECT_CELL 格裡 **7 格**被至少一發突變紅過 ——"
echo "   B10 / B10b / B11 / B11b / B12 / B14 / B20(靶①-⑤ 的紅點集合逐字寫死在上面)。"
echo "   🔴 但「被紅過」≠「它自己的判別 oracle 被證明有效」,兩格要降級敘述:"
echo "     · **B14** 在靶①⑤ 下紅的是**前提斷言**(shipped 根本沒被寫上去),它的 C9 判別 oracle 無靶;"
echo "       C9 的對照是 B15(消融),不是突變。"
echo "     · **B12** 在靶②④ 下紅的是「作廢後必須是 0」那道中途斷言;它宣稱的另一半"
echo "       「**unvoid 真的回升**」**沒有**任何一發靶殺得到(本線的靶動不到「只壞 unvoid」那條路)。"
echo "   **另外 7 格沒有對應突變靶**,只被對照組證明「可以滿足」:"
echo "   ①B12b-x3 / B12b-x1 / B12c-blocks —— 驗的是 **S1b** 的守門(X3 / X1 / append-only),"
echo "     本檔的突變全在 S2b 那支 migration 上、**結構上動不到它們**;那三發靶是 plan 項25b(S2b-4c)的範圍。"
echo "   ②B12c-append-only(結構面)/ B15 / B18 —— 各自開副本庫或只查 catalog,無對應靶。"
echo "   ③**ABLATION** —— 消融格本身無靶;它是 B10 的負向對照(同路徑 2/3 vs 0/3)。"
echo "   🔴 plan §5 環境B **九列只做了五列**、環境A 矩陣與項19 / 項29 都不在本輪(見檔頭 ⓑⓒ)。"
[ "$FAIL" -eq 0 ] || exit 1
