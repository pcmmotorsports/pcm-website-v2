#!/usr/bin/env bash
# ============================================================
# B2-S2a 可重現驗證 harness ── 結構段(S2a-2)
# ============================================================
# 標的 = supabase/migrations/20260806100000_m4b_e10_b2_s2a_summary_shipped_quantity.sql
# 片級 plan = docs/specs/2026-08-06-e10-b2-s2a-summary-columns-plan.md(v2、已凍結、只當意圖文件)
# 審查總帳 = docs/reviews/2026-08-06-b2-s2a1-reviews.md
#
# 用法:
#   PORT=54355 scripts/b2s2a-verify.sh all /tmp/b2s2av   從零 provision pre-S2a 基準庫,再跑全部
#   PORT=54355 scripts/b2s2a-verify.sh run /tmp/b2s2av   重用既有基準庫
#   🔴 PORT 一律顯式帶(a1/a4a 共用 54329 的同埠地雷)—— 沒帶會在參數閘直接退出,不會用預設值。
#
# ── 這支腳本在證明什麼 ──────────────────────────────────────
# 證明:①本片落地後的欄形狀 / 三條 CHECK 定義 / CHECK 具名集合 / 七個物件的 COMMENT
#        被**外部** oracle 鎖住(不是靠 migration 自己那段 DO block 自我背書);
#      ②靶①-⑤ 覆蓋 **4 個斷言族、17 格中的 7 格**(項1、項2 的兩條、項3、9a×1、9-excl×1、9c),
#        每發都紅在指定的那一格。
# 🔴 **不證明**:其餘 10 格**沒有**對應突變 —— 它們只被對照組證明「可以滿足」,不是被證明「壞了會紅」。
#   (其中 9 條是**註解錨**,經人工查證非恆真:A1 `20260730150000_…sql:141/144/162` 分別含
#    「三個 0」/「讓四條「跟 quantity 比」」/「三個數量」、S1b `20260805170200_…sql:94` 含
#    「強制點未定案」且**不含** `oiqs_shipped_le_instock` ⇒ 舊字面確實會讓它們紅。
#    第 10 格 `C2-oiqs_cancelled_shipped_le_quantity` **不是錨、是 constraintdef 逐字比對**
#    (Fable R3 F3:上面那段論證沒涵蓋它);它非恆真的理由是 pre-S2a 根本沒有這條約束
#    ⇒ 沒被建出來時會拿到「(缺漏或未 validated)」而轉紅。但同樣是**閱讀**,不是實跑證據。)
# 不證明:正式站行為(本機 PG17 非 Supabase);C8/C9 的行為負測與邊界正測(那是 S2a-3);
#        回滾與故障注入(S2a-4)。
# 🔴 **也不證明**(Fable R3 F4):migration §4 的三族斷言在本 harness **沒有外部對應格** ——
#   4b 欄名集合、4e A1 七條定義逐字、4g 摘要表零 trigger。突變環境剝掉 §4 之後那三族零守門。
#   ⇒ 檔頭「不是靠 DO block 自我背書」指的是**本檔驗的那 17 格**,不是 §4 的全部內容。
#
# 🔴🔴 **永久警語 ①:pre-S2a 狀態只能是「排除本檔的從零 provision」** 🔴🔴
#   絕對不可以用「在已套過本片的庫上 DROP 欄 + 三條約束」當捷徑。
#   實錘(2026-08-06,Fable R3 的翻案條件② 當場實測):DROP 欄**不會還原 COMMENT** ⇒
#   上一次成功套用留下的正確註解還留在 catalog ⇒ **把整句 COMMENT 語句刪掉的突變照樣全綠**。
#   症狀跟「這族斷言根本是裝飾」長得一模一樣,而且沒有任何東西會提醒你。
#   本腳本的做法:pre-S2a 基準庫 = **只重放時間戳早於本檔的 migration 前綴**(不是「全部減本檔」——
#   後者在日後新增更晚的 migration 之後會把它們一起套進「pre-S2a」,定義靜默漂移),
#   每個案例都用 `CREATE DATABASE … TEMPLATE` 從它複製一份乾淨副本。
#
# 🔴🔴 **永久警語 ②:突變必須先剝掉 migration 自己的 §4 結構驗收 DO block** 🔴🔴
#   否則突變會先被 migration 的自我檢查擋下、apply 直接 abort ⇒
#   你證明的是「migration 會自我檢查」(S2a-1 已證),**不是**「本 harness 的 oracle 有判別力」。
#   剝除本身也要有對照組:MUT0 = 只剝不改,所有 oracle 必須全綠。
#
# 🔴 判定紀律(A1 / A7-t 家族既有教訓,不重蹈)
#  ① 突變必須**紅在指定的那一格**,不是「反正紅了就算抓到」。
#  ② 每個突變都要驗「真的改到東西」:**比對象是 mut0(只剝不改的基準),不是原檔** ——
#     比原檔恆為不同(因為一律先剝 §4)⇒ 那道守門會恆真、從來不可能觸發(code-reviewer R1 實錘)。
#     另有一道真守門在 make_mutant 內:取代錨必須**恰命中一次**(assert n == 1)。
#  ③ 對照組必跑:沒有對照組,全紅毫無意義。
#  ④ 格數由本腳本**自斷言**(見 EXPECT_*),不靠人去數輸出 —— 少跑一格自己紅。
# ============================================================
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

MODE="${1:?用法: b2s2a-verify.sh all|run <workdir>}"
# 🔴 白名單:原本「非 all 一律當 run」⇒ 打成 alll 會靜默重用舊基準庫而不是重新 provision。
case "$MODE" in all|run|gate) : ;; *) echo "🔴 MODE 只能是 all / run / gate(收到:$MODE)" >&2; exit 2 ;; esac

# ══ gate 模式:apply 當下的唯讀前置閘(Fable R3 F1)══════════════════════════
# 🔴 為什麼要有這個模式:all/run 的前置閘只跑在**本腳本自己 provision 的拋棄庫**上
#    (身分閘保證了這件事)⇒ 它在正式站 apply 當下**結構上不可能被執行**,
#    等於一道永不觸發的死保險。判準要能在要緊的那一刻真的跑,才不是文件。
# 用法:scripts/b2s2a-verify.sh gate "<目標資料庫連線字串>"
# 🔴 唯讀:只跑兩個 count(*),不建庫、不建表、不下任何 DDL、不寫任何資料。
if [ "$MODE" = "gate" ]; then
  GATE_URL="${2:?gate 模式需要目標連線字串:b2s2a-verify.sh gate <URL>}"
  gn_ship="$(psql -X "$GATE_URL" -qtAc 'SELECT count(*) FROM public.shipments' 2>&1)"
  gn_item="$(psql -X "$GATE_URL" -qtAc 'SELECT count(*) FROM public.shipment_items' 2>&1)"
  case "$gn_ship$gn_item" in
    *[!0-9]*) echo "🔴 查不到出貨表列數(shipments=[$gn_ship] shipment_items=[$gn_item])—— 當成不通過" >&2; exit 3 ;;
  esac
  if [ "$gn_ship" != "0" ] || [ "$gn_item" != "0" ]; then
    echo "🛑 apply 前置閘不通過:shipments=$gn_ship / shipment_items=$gn_item"
    echo "   → **停,問人**。有真實資料時 B2-S2a 的 DEFAULT 0 語意要重新確認 —— 這不是技術問題,是決定。"
    echo "   (DB 層另有一道精確的 fail-closed 閘在 migration §1:有效已寄出的品項列數必須為 0。)"
    exit 3
  fi
  echo "✅ apply 前置閘通過:shipments=0 / shipment_items=0(唯讀查詢,未寫入任何資料)"
  exit 0
fi
WORK="${2:?缺 workdir(必須是 /tmp 直屬短路徑,例 /tmp/b2s2av)}"
PORT="${PORT:?🔴 PORT 必須顯式帶(a1/a4a 共用 54329 的同埠地雷;本家族用 543xx 未占用埠)}"
MIG="supabase/migrations/20260806100000_m4b_e10_b2_s2a_summary_shipped_quantity.sql"
SUMMARY="public.order_item_quantity_summary"
export LC_ALL=C
# 🔴 使用者的 ~/.psqlrc 可以覆寫 ON_ERROR_STOP / 輸出格式,甚至執行額外命令 ⇒ 整支的比對值都會漂。
#    一行擋掉,比逐處加 -X 不容易漏(codex 關卡2)。
# 🔴 每個 psql 呼叫點都帶 -X(codex 關卡2 R2:`PSQLRC=/dev/null` 只換掉使用者 rc,
#    **system-wide psqlrc 照樣載入**,仍可改輸出、覆寫變數、執行命令 ⇒ 比對值會漂)。
export PSQLRC=/dev/null   # 第二道,不是唯一那道

BASE_URL="postgresql://postgres@127.0.0.1:${PORT}/postgres"     # pre-S2a 基準(template 來源)
ADMIN_URL="postgresql://postgres@127.0.0.1:${PORT}/template1"   # 只用來 CREATE/DROP DATABASE

# ══ 凍結的期望格數(F2:harness 自斷言,不靠人寫死的結語)═══════════════════
EXPECT_STRUCT=17   # 一次結構驗收跑幾格(項1 ×1 + 項2 ×3 + 項3 ×1 + 項9 ×12)
EXPECT_SRC=3       # 項9b:原始碼註解錨 3 條
EXPECT_MUT=6       # 突變靶:MUT0 對照 + 靶①②③④⑤
# 🔴 全跑一輪**應該通過哪些格**(逐 key 凍結,不是只凍結總數;codex 關卡2 R2:
#    只凍結總數時「刪掉一個具名檢查 + 另一個 ok 重複一次」照樣得到 15 —— 與紅格那條同一個病)。
EXPECT_PASS_KEYS="ID-GATE PRE-S2A CTL-STRUCT SRC-ANCHOR-1 SRC-ANCHOR-2 SRC-ANCHOR-3 \
MUT-0 MUT-1 MUT-2 MUT-3 MUT-4 MUT-5 MUT-COUNT BASE-CLEAN COPIES-DROPPED"

PASS=0; FAIL=0; MUT=0; STRUCT_RUN=0; SRC_RUN=0
# 🔴 七物件註解的凍結指紋(**測量值**,2026-08-06 對照組實跑取得)。
#    Sean 2026-08-06 Q2=A:測量值寫在 harness 與報告、不回填 plan。
#    🔴 原版是「對照組自己算出來再跟自己比」⇒ 對照組那一格**恆綠、零判別力**(codex 關卡2 R1 同型病)。
#    改成凍結常數後:任何 COMMENT 合法改動都會讓對照組**大聲轉紅**,必須有人回來改這一行 —— 那是設計。
COMMENT_FP="f5798812892bb484b52083ad068a48a6"
PASS_KEYS=""
ok()  { PASS_KEYS="$PASS_KEYS $1"; printf '  ✅ %s\n' "$2"; PASS=$((PASS+1)); }
bad() { printf '  🔴 %s\n' "$1"; FAIL=$((FAIL+1)); }
log() { echo "== $* =="; }
die() { echo "🔴 $*" >&2; exit 1; }

q() { psql -X "$1" -qtA -c "$2" 2>&1; }

# ══ 0a. workdir 與埠的硬閘 ═══════════════════════════════════════════════════
# 🔴 先驗 canonical 整數再談黑名單(codex 關卡2 R2):
#    「054329」會繞過黑名單、含空白的值會被塞進 `pg_ctl -o` 當額外啟動選項。
case "$PORT" in
  ""|*[!0-9]*) die "PORT 必須是純數字(收到:[$PORT])" ;;
  0*) die "PORT 不得有前導零(收到:$PORT)—— 前導零可繞過下面的保留埠黑名單" ;;
esac
[ "$PORT" -ge 1024 ] && [ "$PORT" -le 65535 ] || die "PORT 必須介於 1024-65535(收到:$PORT)"
case "$PORT" in
  54329|54331|54342) die "埠 $PORT 是既有 harness 的地雷(a1/a4a/d1t2 共用),換一個" ;;
esac
while [ "${WORK%/}" != "$WORK" ]; do WORK="${WORK%/}"; done
[ -L "$WORK" ] && die "workdir 不得是 symlink(收到:$WORK)"
[ -L "$WORK/.b2s2a-throwaway" ] && die "ownership marker 不得是 symlink —— 預埋 symlink 可繞過 marker 閘"
case "$WORK" in /tmp/?*) : ;; *) die "workdir 必須在 /tmp 底下(本腳本會 rm -rf 它)" ;; esac
case "$WORK" in /tmp/*/*) die "workdir 必須是 /tmp 的直屬子目錄" ;; esac
case "$WORK" in *..*) die "workdir 不得含 .." ;; esac
[ ${#WORK} -le 40 ] || die "workdir 太長(${#WORK})—— unix socket 路徑上限 103 bytes"
test -f "$MIG" || die "找不到 $MIG"
# 🔴 把受測 migration 釘在已 commit 的那一版(code-reviewer R1 must-fix):
#    §2 定義與 §3 COMMENT 有凍結字面擋著,但 §1 gate、§4 DO block、檔尾 rollback 區塊
#    被改動時**沒有任何一格會紅** ⇒ 本 harness 會安靜地在驗一份不是它以為的檔案。
MIG_SHA_FROZEN="a93ff0a3d1e9277f53848b735bbb887ec164fd0712f7861f9f5edd0d979b7690"
MIG_SHA_NOW="$(shasum -a 256 "$MIG" | awk '{print $1}')"
[ "$MIG_SHA_NOW" = "$MIG_SHA_FROZEN" ] || die "受測 migration 已被改動 —— 凍結 sha256 $MIG_SHA_FROZEN / 實測 $MIG_SHA_NOW。
   本 harness 的凍結值**全部**綁在那一版,逐項是:
     ①三條新 CHECK 的 constraintdef 字面 ②CHECK 具名集合(項3)③七個必含註解錨
     ④四個排除舊字面 ⑤註解指紋 COMMENT_FP ⑥剝除行數 STRIP_LINES_FROZEN
     ⑦五個突變的取代錨 ⑧EXPECT_STRUCT / EXPECT_SRC / EXPECT_MUT / EXPECT_PASS_KEYS
     ⑨三條原始碼註解錨(項9b)⑩時間序前綴 cutoff
   改了 migration 就必須回頭把這些一起更新,**不是把這道閘拿掉**。"

MARK="$WORK/.b2s2a-throwaway"
# 🔴 marker 不只要存在、還要**內容相符**(codex 關卡2 R2:埠連不上時完全沒驗身分,
#    只憑一個空 marker 就 pg_ctl stop + rm -rf 整個 workdir)。
MARK_SIG="b2s2a-verify.sh throwaway cluster — 本目錄可被本腳本 rm -rf"
CIDFILE="$WORK/cluster-id"
PGBIN="$(dirname "$(command -v initdb 2>/dev/null || echo /opt/homebrew/opt/postgresql@17/bin/initdb)")"

# ══ 0b. provision:pre-S2a 基準庫(**排除本檔**的從零全套重放)════════════════
if [ "$MODE" = "all" ]; then
  if [ -e "$WORK" ]; then
    [ -f "$MARK" ] || die "$WORK 已存在但缺 ownership marker($MARK)—— 不是本腳本建的,拒絕 rm -rf"
    [ "$(cat "$MARK" 2>/dev/null)" = "$MARK_SIG" ] \
      || die "$WORK 的 marker 內容不符(可能是預埋的空檔)—— 拒絕 rm -rf"
    # 🔴 只有在 pgdata 真的是一個 PG 資料目錄時才動它;否則那個路徑不是我們以為的東西。
    if [ -e "$WORK/pgdata" ] && [ ! -f "$WORK/pgdata/PG_VERSION" ]; then
      die "$WORK/pgdata 存在但不是 PG 資料目錄(無 PG_VERSION)—— 拒絕 pg_ctl stop / rm -rf"
    fi
  fi
  [ -L "$WORK/pgdata" ] && die "pgdata 不得是 symlink —— 會讓 rm -rf 打到別人的資料目錄"
  # 🔴 停機前先確認埠上那台**是本 workdir 的**(codex 關卡2:原版先停再驗,順序反了)。
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
  log "0/6 provision pre-S2a 基準庫(port ${PORT};**排除 ${MIG##*/}**)"
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
    # 🔴 pre-S2a 的正確定義 = **時間戳早於本檔**的前綴,不是「全部減本檔」(codex 關卡2):
    #    後者在日後新增更晚的 migration 之後會把它們一起套進「pre-S2a」,定義靜默漂移。
    case "$(basename "$f")" in
      [0-9]*) TS="${f##*/}"; TS="${TS%%_*}" ;;
      *) die "migration 檔名不是時間戳開頭:$f" ;;
    esac
    [ "$TS" \< "20260806100000" ] || continue
    if [ "$f" = "$FIRST_FITMENTS" ]; then
      psql -X "$BASE_URL" -v ON_ERROR_STOP=1 -q -f scripts/d1-fitments-bootstrap.sql || die "fitments bootstrap 失敗"
    fi
    psql -X "$BASE_URL" -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null || die "migration 失敗:$f"
  done
  psql -X "$BASE_URL" -qtAc 'SELECT system_identifier FROM pg_control_system()' > "$CIDFILE"
else
  [ -f "$MARK" ] || die "run 模式需要既有基準庫($WORK 缺 marker);先跑 all"
  [ "$(cat "$MARK" 2>/dev/null)" = "$MARK_SIG" ] || die "$WORK 的 marker 內容不符;拒絕重用"
fi

# ══ 0c. 身分閘(marker / cluster-id / datadir / db / locale)═════════════════
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
# 🔴 伺服器版本要在**兩個模式**都驗(原本只在 all 驗 initdb 版本;run 可重用非 PG17 cluster)。
case "$(q "$BASE_URL" 'SHOW server_version')" in 17.*) : ;; *) die "伺服器非 PG17(實為 $(q "$BASE_URL" 'SHOW server_version'))" ;; esac
ok ID-GATE "身分閘通過(marker 內容 + cluster-id + datadir + locale + server 版本)"

# ══ 0d. 基準庫真的是 pre-S2a(不是「以為是」)═══════════════════════════════
[ "$(q "$BASE_URL" "SELECT count(*) FROM pg_attribute WHERE attrelid='${SUMMARY}'::regclass AND attname='shipped_quantity' AND NOT attisdropped")" = "0" ] \
  || die "基準庫已經有 shipped_quantity 欄 —— 它不是 pre-S2a,整支 harness 的判別力歸零(見檔頭警語①)"
[ "$(q "$BASE_URL" "SELECT position('強制點未定案' IN col_description('public.shipment_items'::regclass,(SELECT attnum FROM pg_attribute WHERE attrelid='public.shipment_items'::regclass AND attname='shipped_quantity')))>0")" = "t" ] \
  || die "基準庫的 shipment_items 註解已經不是 S1b 原文 —— pre-S2a 前提不成立(見檔頭警語①)"
ok PRE-S2A "基準庫確認為乾淨 pre-S2a(無 shipped_quantity 欄 + shipment_items 仍是 S1b 舊註解)"

# ══ 0e. 🔴 apply 前置閘(Fable R3 F1;本片唯一的「停下問人」判準)═════════════
# 判準逐字:**apply 當下任一出貨表非 0 → 停、問人。**
# 這條是保守面、交人決定;DB 層另有一道精確的 fail-closed 閘寫在 migration §1
#(有效已寄出的**品項列數**必須為 0)。
# 🔴 兩者刻意不同:草稿箱有品項但**未寄出**時真值仍為 0,不該被裸列數擋下來 ——
#    但那種狀態值得一個人看一眼,所以保守判準放這裡、精確判準放 DB。
# 🔴 **這裡這一份恆為 0、沒有守門價值**(Fable R3 F1):身分閘已保證只有本腳本 provision 的
#    拋棄庫走得到這裡 ⇒ 它在正式站 apply 當下**結構上不可能執行**。留著只是讓輸出完整。
#    **真正要在 apply 當下跑的是 `gate` 模式**(見檔案上方),對正式站唯讀查兩張表。
#    S2a-4 的 apply runbook 必須把那一行寫成實際步驟 —— 交棒項,本片未完成。
SHIPMENTS_N="$(q "$BASE_URL" 'SELECT count(*) FROM public.shipments')"
SHIPITEMS_N="$(q "$BASE_URL" 'SELECT count(*) FROM public.shipment_items')"
if [ "$SHIPMENTS_N" != "0" ] || [ "$SHIPITEMS_N" != "0" ]; then
  echo "🛑 apply 前置閘:出貨表非 0(shipments=$SHIPMENTS_N / shipment_items=$SHIPITEMS_N)"
  echo "   → **停,問人**。有真實資料時本片 DEFAULT 0 的語意要重新確認,不是技術問題、是決定。"
  exit 3
fi
echo "  ℹ️  apply 前置閘:兩張出貨表皆 0 列(shipments=$SHIPMENTS_N / shipment_items=$SHIPITEMS_N)"
echo "     🔴 這在從零 provision 的拋棄庫上**恆真**,所以不計入 PASS —— 真正的執行時機是正式站 apply 當下。"

# ══ 共用:從基準庫複製一份乾淨副本 ═══════════════════════════════════════════
# 🔴 不用命令替換回傳 URL:die 在子 shell 裡 exit 只殺得掉子 shell,父 shell 會帶著空字串繼續跑。
#    改成設全域 FRESH_URL。
FRESH_URL=""
fresh_db() {   # $1 = db 名 → 設 FRESH_URL
  psql -X "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS $1" >/dev/null 2>&1
  # 前一個 psql backend 偶爾還沒完全退出 ⇒ "source database is being accessed by other users"。
  # 重試一次(仍失敗才 die;不假綠,只是避免偶發紅在無關處)。
  if ! psql -X "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE $1 TEMPLATE postgres" >/dev/null 2>&1; then
    sleep 1
    psql -X "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE $1 TEMPLATE postgres" >/dev/null 2>&1 \
      || die "CREATE DATABASE $1 TEMPLATE postgres 兩次都失敗(基準庫可能還有連線沒關)"
  fi
  FRESH_URL="postgresql://postgres@127.0.0.1:${PORT}/$1"
}
drop_db() { psql -X "$ADMIN_URL" -q -c "DROP DATABASE IF EXISTS $1" >/dev/null 2>&1; }

# 🔴 七物件註解指紋的 SQL **只在這裡寫一次**(codex 關卡2:原本比對用與印給人看的抄了兩份,
#    改一處漏另一處就會「印出來的數字不是比對用的數字」)。
#    ORDER BY 放進 string_agg 內 —— 放在子查詢是靠未保證的順序保留。
fp_sql() {
  printf "SELECT md5(string_agg(t.c, E'\\n' ORDER BY t.i)) FROM (%s) t" \
    "SELECT 1 AS i, COALESCE($(comment_sql COL:summary.shipped_quantity),'-') AS c
     UNION ALL SELECT 2, COALESCE($(comment_sql TABLE:summary),'-')
     UNION ALL SELECT 3, COALESCE($(comment_sql COL:summary.quantity),'-')
     UNION ALL SELECT 4, COALESCE($(comment_sql FK:summary.item_fk),'-')
     UNION ALL SELECT 5, COALESCE($(comment_sql C:oiqs_instock_cancelled_le_quantity),'-')
     UNION ALL SELECT 6, COALESCE($(comment_sql C:oiqs_cancelled_shipped_le_quantity),'-')
     UNION ALL SELECT 7, COALESCE($(comment_sql COL:shipment_items.shipped_quantity),'-')"
}

# ══ 共用:結構 oracle(**外部**斷言,不看 migration 自己那段 DO block)═════════
# 回傳 0 = 全格通過;非 0 = 有格紅。紅的格會印出「哪一格 + 期望 vs 實際」。
comment_sql() {  # $1 = key → 產生取該物件註解的 SQL 片段
  case "$1" in
    COL:summary.shipped_quantity) echo "col_description('${SUMMARY}'::regclass,(SELECT attnum FROM pg_attribute WHERE attrelid='${SUMMARY}'::regclass AND attname='shipped_quantity'))" ;;
    TABLE:summary)                echo "obj_description('${SUMMARY}'::regclass,'pg_class')" ;;
    COL:summary.quantity)         echo "col_description('${SUMMARY}'::regclass,(SELECT attnum FROM pg_attribute WHERE attrelid='${SUMMARY}'::regclass AND attname='quantity'))" ;;
    FK:summary.item_fk)           echo "(SELECT obj_description(oid,'pg_constraint') FROM pg_constraint WHERE conrelid='${SUMMARY}'::regclass AND conname='order_item_quantity_summary_item_fk')" ;;
    C:oiqs_instock_cancelled_le_quantity) echo "(SELECT obj_description(oid,'pg_constraint') FROM pg_constraint WHERE conrelid='${SUMMARY}'::regclass AND conname='oiqs_instock_cancelled_le_quantity')" ;;
    C:oiqs_cancelled_shipped_le_quantity) echo "(SELECT obj_description(oid,'pg_constraint') FROM pg_constraint WHERE conrelid='${SUMMARY}'::regclass AND conname='oiqs_cancelled_shipped_le_quantity')" ;;
    COL:shipment_items.shipped_quantity)  echo "col_description('public.shipment_items'::regclass,(SELECT attnum FROM pg_attribute WHERE attrelid='public.shipment_items'::regclass AND attname='shipped_quantity'))" ;;
    *) die "comment_sql:未知 key $1(新增物件時忘了加分支)" ;;
  esac
}

# 🔴 回傳紅格數,並把**紅在哪一格**的機器可辨識 ID 寫進全域 REDS_IDS(codex 關卡2 must-fix:
#    原版只比紅格「數量」⇒ 指定格失效、另一格意外轉紅但總數相同時照樣 PASS,
#    等於檔頭判定紀律① 那句「必須紅在指定的那一格」從來沒有被機器檢查過)。
REDS_IDS=""
red() { printf '     ▸ [%s] %s\n' "$TAG" "$2"; REDS_IDS="$REDS_IDS $1"; reds=$((reds+1)); }
struct_oracle() {  # $1 = URL、$2 = 情境標籤;回傳紅格數,同時設 REDS_IDS
  local U="$1" TAG="$2" reds=0 got exp key sqlfrag
  STRUCT_RUN=0; REDS_IDS=""

  # ── 項 1:新欄形狀逐字 ──
  got="$(q "$U" "SELECT COALESCE(format_type(a.atttypid,a.atttypmod)||CASE WHEN a.attnotnull THEN '/NOT NULL' ELSE '/NULL' END||'/DEFAULT '||COALESCE(pg_get_expr(d.adbin,d.adrelid),'(none)'),'(欄不存在)') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid='${SUMMARY}'::regclass AND a.attname='shipped_quantity' AND a.attnum>0 AND NOT a.attisdropped")"
  STRUCT_RUN=$((STRUCT_RUN+1))
  if [ "$got" = "integer/NOT NULL/DEFAULT 0" ]; then :; else
    red "C1-col" "$(printf '項1 欄形狀:期望「integer/NOT NULL/DEFAULT 0」實為「%s」' "$got")"
  fi

  # ── 項 2:三條新 CHECK 的定義逐字 ──
  while IFS='|' read -r key exp; do
    [ -n "$key" ] || continue
    got="$(q "$U" "SELECT COALESCE((SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='${SUMMARY}'::regclass AND conname='$key' AND contype='c' AND convalidated),'(缺漏或未 validated)')")"
    STRUCT_RUN=$((STRUCT_RUN+1))
    if [ "$got" != "$exp" ]; then
      red "C2-$key" "$(printf '項2 %s:期望「%s」實為「%s」' "$key" "$exp" "$got")"
    fi
  done <<'EOF'
oiqs_shipped_nonneg|CHECK ((shipped_quantity >= 0))
oiqs_shipped_le_instock|CHECK ((shipped_quantity <= instock_quantity))
oiqs_cancelled_shipped_le_quantity|CHECK ((((cancelled_quantity)::bigint + (shipped_quantity)::bigint) <= (quantity)::bigint))
EOF

  # ── 項 3:CHECK 具名集合**雙向**恰等十條(偷加第十一條或砍一條都要紅)──
  got="$(q "$U" "SELECT string_agg(conname,',' ORDER BY conname) FROM pg_constraint WHERE conrelid='${SUMMARY}'::regclass AND contype='c'")"
  exp='oiqs_cancelled_le_quantity,oiqs_cancelled_nonneg,oiqs_cancelled_shipped_le_quantity,oiqs_instock_cancelled_le_quantity,oiqs_instock_le_ordered,oiqs_instock_nonneg,oiqs_ordered_le_quantity,oiqs_ordered_nonneg,oiqs_shipped_le_instock,oiqs_shipped_nonneg'
  STRUCT_RUN=$((STRUCT_RUN+1))
  if [ "$got" != "$exp" ]; then
    red "C3-set" "$(printf '項3 CHECK 具名集合不符:\n        期望 %s\n        實為 %s' "$exp" "$got")"
  fi

  # ── 項 9:七個物件的 COMMENT ──
  #   9a 逐物件「必含新錨」;**9-excl** 四個物件「不得含舊字面」;9c 全集指紋
  #   🔴 內部這組叫 9-excl,不叫 9b —— plan 的「項9b」是**原始碼**註解錨(見 §2),兩者不同東西。
  #   🔴 錨與 migration 檔內 DO block 用的是**同一組語意**但這裡是外部獨立查詢:
  #      migration 那段被整個刪掉時,這裡照樣會紅(MUT0 對照組就是在證這件事)。
  while IFS='|' read -r key exp; do
    [ -n "$key" ] || continue
    sqlfrag="$(comment_sql "$key")"
    got="$(q "$U" "SELECT CASE WHEN $sqlfrag IS NULL THEN '(無註解)' WHEN position('$exp' IN $sqlfrag)>0 THEN 'OK' ELSE '(缺錨)' END")"
    STRUCT_RUN=$((STRUCT_RUN+1))
    if [ "$got" != "OK" ]; then
      red "C9a-$key" "$(printf '項9a %s:%s —— 缺新錨「%s」' "$key" "$got" "$exp")"
    fi
  done <<'EOF'
COL:summary.shipped_quantity|大線 B2-S2b
TABLE:summary|四個 0
COL:summary.quantity|**四條直接跟 quantity 比**
FK:summary.item_fk|**四個數量**
C:oiqs_instock_cancelled_le_quantity|契約債 ① 已清償
C:oiqs_cancelled_shipped_le_quantity|代數冗餘
COL:shipment_items.shipped_quantity|oiqs_shipped_le_instock
EOF

  while IFS='|' read -r key exp; do
    [ -n "$key" ] || continue
    sqlfrag="$(comment_sql "$key")"
    got="$(q "$U" "SELECT CASE WHEN $sqlfrag IS NULL THEN '(無註解)' WHEN position('$exp' IN $sqlfrag)>0 THEN '(舊字面仍在)' ELSE 'OK' END")"
    STRUCT_RUN=$((STRUCT_RUN+1))
    if [ "$got" != "OK" ]; then
      red "C9x-$key" "$(printf '項9-excl %s:%s —— 舊字面「%s」' "$key" "$got" "$exp")"
    fi
  done <<'EOF'
TABLE:summary|三個 0
COL:summary.quantity|讓四條「跟 quantity 比」
FK:summary.item_fk|三個數量
COL:shipment_items.shipped_quantity|強制點未定案
EOF

  # 9-c 全集指紋:任何一個字改動都會轉紅(錨檢查抓不到「錨還在但別處被亂改」)。
  # 🔴 指紋是**測量值**,由對照組實跑取得後凍結在這裡(Sean 2026-08-06 Q2=A:
  #    測量值屬 harness 與報告,不回填 plan)。
  # 🔴 **它實際抓的是什麼(兩輪連續更正我的說法,最後以 Fable R3 F2 為準)**:
  #    ①改 migration 裡的 COMMENT 會先撞上 sha256 閘、走不到這裡;
  #    ②「日後某支 migration 覆寫同一物件的註解」在**本 harness 的拓樸內不可達** ——
  #    晚於本檔的 migration 被時間序前綴閘永久排除,而本檔 §3 對七物件全部下 COMMENT
  #    且恆為最後套用 ⇒ 任何先行者的蓋寫都會被覆回。
  # ⇒ **本格是突變 oracle 專用**(靶⑤ 的第三個紅點),不是常設的蓋寫守門。
  # 🔴 交棒:「註解被日後 migration 蓋寫」**目前沒有任何守門**,S2b 那片要自己建,
  #    不得因為看到這一格就以為已經有了(A1 重放蓋寫 A2 註解是既有前科)。
  got="$(q "$U" "$(fp_sql)")"
  STRUCT_RUN=$((STRUCT_RUN+1))
  if [ "$got" != "$COMMENT_FP" ]; then
    red "C9c-fp" "$(printf '項9c 七物件註解指紋不符:期望 %s 實為 %s' "$COMMENT_FP" "$got")"
  fi

  [ "$STRUCT_RUN" -eq "$EXPECT_STRUCT" ] || {
    red "C0-count" "$(printf '🔴 結構 oracle 只跑了 %s 格,期望 %s —— 清單被改短了' "$STRUCT_RUN" "$EXPECT_STRUCT")"; }
  return $reds
}

# ══ 共用:突變檔產生器 ═══════════════════════════════════════════════════════
# 🔴 一律先剝掉 migration 自己的 §4 DO block(見檔頭警語②),再套用該靶的字面改動。
# 🔴 這是**起訖索引區間刪除**,會靜默吃掉落在兩個錨之間的任何新內容
#    (memory feedback_range-delete-silently-eats-neighbors 的形狀:三綠全綠、零紅)。
#    ⇒ 唯一抓得到的方式 = 對帳「預期 Δ vs 實際 Δ」,所以下面把剝掉的行數凍結起來。
STRIP_AWK='/══ 4\. 結構驗收/{skip=1} /^COMMIT;$/{skip=0} !skip{print}'
STRIP_LINES_FROZEN=235   # §4 結構驗收整段的行數(516 → 281,2026-08-06 實測)
make_mutant() {  # $1 = 輸出檔、$2 = python 取代來源、$3 = 取代目標(空 = 只剝)
  awk "$STRIP_AWK" "$MIG" > "$1" || die "剝除 §4 失敗"
  cmp -s "$MIG" "$1"; local mrc=$?
  case "$mrc" in
    0) die "🔴 剝除 §4 沒有改到任何東西 —— STRIP_AWK 的錨失效了,整組突變作廢" ;;
    1) : ;;
    *) die "🔴 cmp 讀不到檔(rc=$mrc)—— 不當成「有差異」放行(codex 關卡2 R2)" ;;
  esac
  local removed=$(( $(wc -l < "$MIG") - $(wc -l < "$1") ))
  [ "$removed" -eq "$STRIP_LINES_FROZEN" ] || die "🔴 剝除了 $removed 行,期望 $STRIP_LINES_FROZEN 行 ——
   起訖區間之間多了或少了東西(例如有人在 §4 與 COMMIT; 之間插了新段,會被一起靜默刪掉)。
   確認之後更新 STRIP_LINES_FROZEN,不要把這道對帳拿掉。"
  # 🔴 行數對帳不夠:錨整體偏移但仍好死不死刪掉 235 行時它會通過(codex 關卡2)。
  #    再對帳「該消失的消失了、該留的都留著」——內容面,與行數面互相獨立。
  grep -q 'S2A-COMMENT-COUNT' "$1" && die "🔴 §4 沒被剝乾淨(仍看得到 S2A-COMMENT-COUNT)"
  # 🔴 只看**非註解行**(codex 關卡2 R2):檔尾的 rollback 範例把同樣的字面寫在 `--` 註解裡,
  #    直接 grep 全檔會讓「forward 那句被誤刪」照樣餵綠 —— 恆真的內容對帳比沒有還糟。
  grep -v '^[[:space:]]*--' "$1" > "$1.code" || die "抽非註解行失敗"
  for keep in 'S2A-GATE-SHIPPED-NONZERO' \
              'ADD CONSTRAINT oiqs_shipped_le_instock' \
              'COMMENT ON COLUMN public.shipment_items.shipped_quantity' \
              '^COMMIT;$'; do
    grep -q "$keep" "$1.code" || die "🔴 剝除把不該刪的東西一起吃掉了:非註解行裡找不到「$keep」"
  done
  rm -f "$1.code"
  if [ -n "${3-}" ] || [ -n "${2-}" ]; then
    SRC="$2" DST="$3" OUT="$1" python3 - <<'PY' || die "突變取代失敗"
import io, os
out = os.environ['OUT']; src = os.environ['SRC']; dst = os.environ['DST']
s = io.open(out, encoding='utf-8').read()
n = s.count(src)
assert n == 1, f'突變錨命中 {n} 次(必須恰 1):{src[:60]}'
io.open(out, 'w', encoding='utf-8').write(s.replace(src, dst))
PY
  fi
}

run_mutant() {  # $1 = 靶名、$2 = 突變檔、$3 = **期望紅的格 ID 集合**(空字串 = 應全綠)、$4 = 比對基準檔
  local name="$1" file="$2" expect="$3" baseline="$4" key="$5" db="s2a_mut" U reds got_ids exp_ids
  # 🔴 比對象是 baseline(靶①-⑤ 比 mut0;MUT0 自己比原檔)—— 比原檔對靶①-⑤ 而言恆為不同、零判別力。
  # 🔴 cmp 的 rc:0=相同 / 1=有差異 / **2=讀取失敗**。原版把 2 當成「有差異」放行 ⇒
  #    基準檔缺漏或不可讀時整道守門被繞過(codex 關卡2)。
  cmp -s "$baseline" "$file"; local crc=$?
  case "$crc" in
    0) bad "突變 $name:與基準檔 ${baseline##*/} 無差異(取代沒命中)"; MUT=$((MUT+1)); return ;;
    1) : ;;
    *) bad "突變 $name:cmp 讀不到檔(rc=$crc,基準 $baseline / 突變 $file)"; MUT=$((MUT+1)); return ;;
  esac
  fresh_db "$db"; U="$FRESH_URL"
  if ! psql -X "$U" -v ON_ERROR_STOP=1 -q -f "$file" > "$WORK/mut-$name.log" 2>&1; then
    bad "突變 $name:apply 就失敗了(期望能套進去、由 harness 的 oracle 抓)— $(tail -1 "$WORK/mut-$name.log")"
    MUT=$((MUT+1)); drop_db "$db"; return
  fi
  struct_oracle "$U" "$name"; reds=$?
  MUT=$((MUT+1))
  # 🔴 比的是**格 ID 集合**逐字相等,不是紅格數量 —— 「指定格沒紅、別格意外紅」總數相同也要被抓出來。
  got_ids="$(printf '%s\n' $REDS_IDS | sort | tr '\n' ' ' | sed 's/ *$//')"
  exp_ids="$(printf '%s\n' $expect | sort | tr '\n' ' ' | sed 's/ *$//')"
  if [ "$got_ids" = "$exp_ids" ]; then
    if [ -z "$exp_ids" ]; then ok "MUT-$key" "突變 $name(對照組):結構 oracle 全綠 ⇒ 剝除 §4 本身不會造成紅"
    else ok "MUT-$key" "突變 $name:紅在 [$got_ids](逐格相符)"; fi
  else
    bad "突變 $name:紅在 [$got_ids] 但期望 [$exp_ids] —— 判別力不符(見上方逐格輸出)"
  fi
  drop_db "$db"
}

# ══ 1. 對照組:套真檔,結構 oracle 必須全綠 ═══════════════════════════════════
log "1/6 對照組:pre-S2a 副本套**真檔**,外部結構 oracle 應全綠"
fresh_db s2a_ctl; CTL_URL="$FRESH_URL"
psql -X "$CTL_URL" -v ON_ERROR_STOP=1 -q -f "$MIG" > "$WORK/ctl.log" 2>&1 \
  || die "對照組套真檔就失敗了:$(tail -3 "$WORK/ctl.log")"
grep -q 'S2A 結構驗收全數通過' "$WORK/ctl.log" || die "對照組沒看到 migration 自己的驗收 NOTICE"

# 印出實測指紋供人核對(比對本身在 struct_oracle 的項9c,對的是上面那個凍結常數)。
CTL_FP="$(q "$CTL_URL" "$(fp_sql)")"
[ ${#CTL_FP} -eq 32 ] || die "取不到七物件註解指紋(實得「$CTL_FP」)"
echo "   ▸ 七物件註解指紋:凍結 $COMMENT_FP / 實測 $CTL_FP"

struct_oracle "$CTL_URL" "對照組"; CTL_REDS=$?
if [ "$CTL_REDS" -eq 0 ]; then ok CTL-STRUCT "對照組結構 oracle $STRUCT_RUN 格全綠"
else bad "對照組結構 oracle 紅 $CTL_REDS 格 —— 真檔就過不了,後面的突變全部沒有意義"; fi

# ══ 2. 項 9b:原始碼註解錨(catalog 查不到的那三項)═══════════════════════════
log '2/6 項9b:A1 契約債 ① 清償聲明三項(原始碼註解,obj_description 查不到)'
while IFS='|' read -r label anchor; do
  [ -n "$label" ] || continue
  SRC_RUN=$((SRC_RUN+1))
  # 🔴 grep -c 數的是**行數**:同一行出現兩次仍回 1 ⇒ 量錯東西(codex 關卡2)。改數實際命中次數。
  n="$(grep -oF -- "$anchor" "$MIG" | wc -l | tr -d ' ')"
  # 🔴 驗「恰一次」不是「存在」—— 只驗存在就是 migration §0.6-3 記的 presence oracle 恆綠病。
  if [ "$n" = "1" ]; then ok "SRC-ANCHOR-$SRC_RUN" "項9b $label(錨恰命中 1 次)"
  else bad "項9b $label:錨「$anchor」在 migration 內命中 $n 次(期望恰 1)"; fi
done <<'EOF'
①加欄|① 加 shipped_quantity 欄
②納入 C6′、C7 不動|② 納入 **C6'(C7 不動)**
③刻意不做|③ 🔴 **刻意不做**:不把 shipped 從 C6/C7 減去
EOF
[ "$SRC_RUN" -eq "$EXPECT_SRC" ] || bad "項9b 只跑了 $SRC_RUN 格,期望 $EXPECT_SRC —— 清單被改短了"

# ══ 3. 突變靶(環境 A;每靶 fresh DB from template)═══════════════════════════
log "3/6 突變靶:每靶一份乾淨 pre-S2a 副本 + 剝除 §4 + 單一字面改動"

make_mutant "$WORK/mut0.sql" "" ""
run_mutant "MUT0-只剝不改" "$WORK/mut0.sql" "" "$MIG" 0

make_mutant "$WORK/mut1.sql" \
  'ADD CONSTRAINT oiqs_shipped_le_instock CHECK (shipped_quantity <= instock_quantity)' \
  'ADD CONSTRAINT oiqs_shipped_le_instock CHECK (shipped_quantity < instock_quantity)'
run_mutant "靶①-C9改成嚴格小於" "$WORK/mut1.sql" "C2-oiqs_shipped_le_instock" "$WORK/mut0.sql" 1

make_mutant "$WORK/mut2.sql" \
  '  ADD CONSTRAINT oiqs_shipped_le_instock CHECK (shipped_quantity <= instock_quantity),
' ''
run_mutant "靶②-拿掉C9" "$WORK/mut2.sql" "C2-oiqs_shipped_le_instock C3-set" "$WORK/mut0.sql" 2

make_mutant "$WORK/mut3.sql" \
  '  ADD CONSTRAINT oiqs_shipped_nonneg CHECK (shipped_quantity >= 0),
' ''
run_mutant "靶③-拿掉C8" "$WORK/mut3.sql" "C2-oiqs_shipped_nonneg C3-set" "$WORK/mut0.sql" 3

make_mutant "$WORK/mut4.sql" \
  'ADD COLUMN shipped_quantity integer NOT NULL DEFAULT 0,' \
  'ADD COLUMN shipped_quantity integer NOT NULL DEFAULT 1,'
run_mutant "靶④-DEFAULT改1" "$WORK/mut4.sql" "C1-col" "$WORK/mut0.sql" 4

# 靶⑤ = Fable R3 F4 指名的那一發:同時走「必含錨」與「排除舊字面」兩條路徑,
#        還會動到指紋 ⇒ 期望紅 3 格(9a 缺錨 / 9b 舊字面仍在 / 9c 指紋不符)。
MUT5_SRC="$(MIG="$MIG" python3 - <<'PY'
import io, os
s=io.open(os.environ['MIG'],encoding='utf-8').read()
i=s.index("COMMENT ON COLUMN public.shipment_items.shipped_quantity IS")
print(s[i:s.index("';",i)+3], end='')
PY
)"
[ -n "$MUT5_SRC" ] || die "靶⑤ 取不到要刪的 COMMENT 語句 —— 否則會靜默退化成 MUT0"
make_mutant "$WORK/mut5.sql" "$MUT5_SRC" ""
run_mutant "靶⑤-刪掉forward-override那句COMMENT" "$WORK/mut5.sql" \
  "C9a-COL:shipment_items.shipped_quantity C9x-COL:shipment_items.shipped_quantity C9c-fp" "$WORK/mut0.sql" 5

# ══ 4. 收尾:格數自斷言 ═════════════════════════════════════════════════════
log "4/6 格數自斷言(F2:少跑一格自己紅,不靠人數輸出)"
[ "$MUT" -eq "$EXPECT_MUT" ] && ok MUT-COUNT "突變靶跑滿 $MUT 個(期望 $EXPECT_MUT)" \
  || bad "突變靶只跑了 $MUT 個,期望 $EXPECT_MUT —— 清單被改短了"

# ══ 5. 零殘留 ═══════════════════════════════════════════════════════════════
log "5/6 零殘留:基準庫必須仍是 pre-S2a(所有動作都在副本上)"
[ "$(q "$BASE_URL" "SELECT count(*) FROM pg_attribute WHERE attrelid='${SUMMARY}'::regclass AND attname='shipped_quantity' AND NOT attisdropped")" = "0" ] \
  && ok BASE-CLEAN "基準庫零殘留(仍無 shipped_quantity 欄)" \
  || bad "🔴 基準庫被污染了(長出 shipped_quantity 欄)—— 之後的 run 模式全部不可信"
LEFT="$(q "$ADMIN_URL" "SELECT COALESCE(string_agg(datname,','),'(無)') FROM pg_database WHERE datname LIKE 's2a\\_%' AND datname <> 's2a_ctl'")"
[ "$LEFT" = "(無)" ] && ok COPIES-DROPPED "突變用的副本資料庫已全數清除" || bad "殘留副本資料庫:$LEFT"

# ══ 6. 結語 ═════════════════════════════════════════════════════════════════
log "6/6 結果"
# 🔴 這道必須排在印摘要**之前**(codex 關卡2 R2:原本先印 FAIL=0 再檢查,
#    唯一那行計數摘要在失配時仍是假綠,雖然最終 RC=1)。
GOT_KEYS="$(printf '%s\n' $PASS_KEYS | sort | tr '\n' ' ' | sed 's/ *$//')"
EXP_KEYS="$(printf '%s\n' $EXPECT_PASS_KEYS | sort | tr '\n' ' ' | sed 's/ *$//')"
[ "$GOT_KEYS" = "$EXP_KEYS" ] || {
  echo "🔴 通過的格子集合不符 —— 有檢查被刪掉、重複、或改了名"
  echo "   實際 [$GOT_KEYS]"
  echo "   期望 [$EXP_KEYS]"
  FAIL=$((FAIL+1)); }
printf 'PASS=%s  FAIL=%s  MUT=%s\n' "$PASS" "$FAIL" "$MUT"
# 🔴 沒有這道:整段刪掉身分閘 / pre-S2a 確認 / 零殘留之後,會變成 PASS=14 FAIL=0 照樣 exit 0。

echo "對照組副本 s2a_ctl 保留不刪(可直接連上去看落地後的樣子):"
echo "  psql postgresql://postgres@127.0.0.1:${PORT}/s2a_ctl"
echo
echo "🔴 本支**不涵蓋**:C8/C9 的行為負測與邊界正測(S2a-3)、回滾與故障注入(S2a-4)、"
echo "   runbook rehearsal 的六欄十 CHECK 驗證(S2a-4)。"
[ "$FAIL" -eq 0 ] || exit 1
