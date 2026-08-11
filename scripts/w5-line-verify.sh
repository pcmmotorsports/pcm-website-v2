#!/usr/bin/env bash
#
# W5 · **出貨線的線級 harness**(結構 oracle + 端到端行為;外部 oracle 形狀照 b2s2b-verify.sh)
#
# 用法:scripts/w5-line-verify.sh   (自建拋棄式 cluster、跑完自動 teardown)
# 真權威:plan v4.2 §2 W5 列 / §2a(`W5` 依賴 W1、且**排在 W6a 之前**——W6a 要用它跑探針)
#
# ══ 🔴 這支存在的理由(不是「再寫一次 w2/w3a/w3b2/w3c3」)═══════════
#   那四支各自**只重放 `TS <= 自己` 的前綴**(W3-1 落檔那天 w2 的尾端閘響了、處置就是改前綴重放)。
#   代價當時就寫明了:**每一支都證不了「被測物在更晚的片之上仍成立」**。
#   ⇒ 於是出現一個沒人守的面:**「五支 writer 在<u>全部片都在</u>的尖端一起跑」從來沒被測過。**
#   本檔就是補那一面:
#     · 重放**整個 migration 目錄**(無前綴),不留尾巴
#     · **結構 oracle**:出貨線的物件集合 + ACL + trigger 啟用態,凍成**一份**清單
#     · **端到端行為**:建箱 → 掛品項 → 出貨,**全程只走五支 RPC**(不直寫任何一張表)
#   🔴 **本檔不重複各片的守門格** —— 那些是各片自己的責任。本檔只問兩件:
#      ①「全部片疊起來之後,線還是完整的嗎」②「一個員工從頭做到尾,做得完嗎」。
#
# ══ 🔴 尾端閘:本檔**必須**釘在線的尖端 ═════════════════════════
#   前綴重放是各片的選擇;**本檔刻意相反** —— 它就是那個「必須跟著線一起長」的檔。
#   新片落檔 ⇒ 這道閘會 die ⇒ **處置是重釘 + 把新片的物件加進結構 oracle**,不是把閘拿掉。
#
# ══ 判準四句(承自 w0b/w1/w2/w3* )═══════════════════════════════
#   🔴 消融必須由紅轉綠,否則判別力歸屬錯。
#   🔴 全綠的消融也可能恆真,隔離守門自己要有靶。
#   🔴 「我的 SQL 寫壞了」不得與「被別的守門擋住」共用同一句結論。
#   🔴 家族格的靶不得只打一個成員。
#
# 🔴 本檔跑在**裸 PG,不是 Supabase** ⇒ ACL 格證不了正式站最終權限,只有 apply 後在 A 庫驗才消。
# 🔴 **格數全綠證的是「寫下的守門有判別力」,證不了「該有的守門都想到了」。**
set -u
export LC_ALL=C LANG=C
REPO="$(cd "$(dirname "$0")/.." && pwd)"
D="${W5DB:-/tmp/w5db}"; SOCK="${W5SOCK:-/tmp/w5sk}"; P="${W5PORT:-54399}"
PASS=0; FAIL=0; KEYS=""
EXPECT_TOTAL=39   # 🔴 量出來的。全綠時 PASS = 39 + CELL-ACCOUNT + CELL-KEYSET = 41。(跟片④ +4;42501 負測 +2;MF-2 存根產物 +3;寫入面凍結 +2)
ok()  { PASS=$((PASS+1)); KEYS="$KEYS $1"; printf '  PASS %-34s %s\n' "$1" "$2"; }
bad() { FAIL=$((FAIL+1)); KEYS="$KEYS $1"; printf '  FAIL %-34s %s\n' "$1" "$2"; }

# ══ 🔴 W7 跟片(2026-08-08):路徑閘 + trap teardown + fail-closed 殘留檢查 ══
#   參考實作 = scripts/w7d1-verify.sh(關卡2 兩輪審過);四件一起做,少任何一件都留破口。
#   🔴 **為什麼一定要 trap**(實測,不是推論):本檔 `set -u`,而**頂層**的 unbound variable
#      會讓 shell 當場中止 —— `die()` 不會跑、檔尾也到不了 ⇒ **留一支活叢集**。
#      B-301 的前置證據:在 w3c1 的 provision 之後注入一個頂層 unbound,
#      實測留下 `postgres -D /tmp/w3vdb -p 54401`(PID 69587)。Ctrl-C 同理。
#   🔴 trap 裝在 `pg_ctl start` **之前**:`-w start` 可能「postmaster 已起、只是等待逾時」
#      就走 START_FAIL 分支 ⇒ 那條路原本也漏。
#   🔴 `stop` 失敗時**不刪 datadir**,否則會變成「postmaster 還活著、資料目錄卻沒了」。
#   🔴 殘留用 `postmaster.pid` + `pgrep` 綁本 datadir,**不用 TCP 埠** ——
#      本檔的 server 是 `listen_addresses=`(只開 unix socket)⇒ TCP 恆為 0、零判別力。
# 🔴 `/private/tmp` 也要收:macOS 的 `/tmp` 是 `/private/tmp` 的 symlink,
#    而本線有 harness 的預設 datadir 就落在 scratchpad 的 `/private/tmp/...`(w0b:32)
#    ⇒ 只認字面 `/tmp/` 會把合法路徑擋掉。**這道閘是本次掃掠自己踩到的**,已修。
case "$D"    in /tmp/?*|/private/tmp/?*) : ;; *) echo "REFUSE: datadir 必須在 /tmp 或 /private/tmp 底下(現為 [$D])"; exit 1 ;; esac
case "$SOCK" in /tmp/?*|/private/tmp/?*) : ;; *) echo "REFUSE: socket 目錄必須在 /tmp 或 /private/tmp 底下(現為 [$SOCK])"; exit 1 ;; esac
case "$D"    in *..*) echo "REFUSE: datadir 不得含 .. (現為 [$D])"; exit 1 ;; esac
case "$SOCK" in *..*) echo "REFUSE: socket 目錄不得含 .. (現為 [$SOCK])"; exit 1 ;; esac
case "$D$SOCK" in *[!A-Za-z0-9/._-]*) echo "REFUSE: 路徑只允許 A-Za-z0-9/._- (pgrep -f 會把其餘字元當 regex ⇒ 殘留那道靜默失效)"; exit 1 ;; esac
# 🔴🔴 W7 跟片⑦(2026-08-09,R2 抓的):上面的 `/tmp/?*` **擋不住 `/tmp//`** ——
#    glob 的 `?` 吃得下 `/`,四道閘全過(前綴符合、無 `..`、字元集全合法),
#    而 `rm -rf "/tmp//"` 實測**會把整個 /tmp 刪掉**(含別窗還活著的 PG datadir),
#    且 `$D/postmaster.pid` = `/tmp//postmaster.pid` 不存在 ⇒ 併發護欄也不會響 = 靜默。
#    ⇒ 兩道一起補:①第一個字元必須是英數(順帶擋掉 `/tmp/.`、`/tmp/-x`)②路徑中不得有 `//`。
case "$D" in /tmp/[A-Za-z0-9]*|/private/tmp/[A-Za-z0-9]*) : ;; *) echo "REFUSE: 路徑第一段必須以英數開頭(現為 [$D])"; exit 1 ;; esac
case "$D" in *//*) echo "REFUSE: 路徑不得含連續斜線(現為 [$D])—— `/tmp//` 過得了前綴閘但 rm -rf 會刪掉整個 /tmp"; exit 1 ;; esac
case "$SOCK" in /tmp/[A-Za-z0-9]*|/private/tmp/[A-Za-z0-9]*) : ;; *) echo "REFUSE: 路徑第一段必須以英數開頭(現為 [$SOCK])"; exit 1 ;; esac
case "$SOCK" in *//*) echo "REFUSE: 路徑不得含連續斜線(現為 [$SOCK])—— `/tmp//` 過得了前綴閘但 rm -rf 會刪掉整個 /tmp"; exit 1 ;; esac
# 🔴 W7 跟片⑤(2026-08-09,codex #4 MF-4 的另一半):路徑閘只保證「刪的東西在 /tmp 底下」,
#    **擋不住「那個 /tmp 路徑正被別人的 live cluster 用著」** —— 本檔開場無條件 `rm -rf`,
#    兩個視窗用預設路徑並行跑就會互刪。夜跑多視窗是常態,這不是理論風險。
#    ⇒ 刪之前先問:那裡有沒有活著的 postmaster?有就 REFUSE,不猜、不等、不強刪。
# 🔴🔴 **本段必須排在 `trap teardown EXIT` 之前**:teardown 會 `pg_ctl -D "$D" stop`,
#    若這道 REFUSE 排在 trap 之後,`exit 1` 會觸發 teardown 去停掉**別人的** cluster
#    —— 那正是本段要防的事。(第一版我就寫在 trap 之後,自己抓到。)
# 🔴 R1 F2:`pgrep` 不存在/被 PATH 遮蔽時回非 0 ⇒ 連言 false ⇒ **靜默放行 rm -rf** = fail-open。
#    這道護欄的整個價值就在「不確定時不要刪」,所以工具缺席要當成不確定,不當成沒事。
command -v pgrep >/dev/null 2>&1 || { echo "REFUSE: 找不到 pgrep ⇒ 無法判斷 $D 是否正被別人使用,拒絕 rm -rf"; exit 1; }
# 🔴 R1 F3(誠實邊界,別把註解讀成全稱):本護欄只擋**穩態**。別的視窗正卡在 initdb / pg_ctl start
#    到 postmaster.pid 落地之間那個短窗口時,$D 有目錄但沒有 pid 檔 ⇒ 這裡仍會刪掉它。
#    要關那個窗口得改成 ownership marker 制(如 a1-verify / b2s2b 的作法),本片不做。
if [ -f "$D/postmaster.pid" ] && pgrep -f "postgres.*$D" >/dev/null 2>&1; then
  echo "REFUSE: $D 底下有活著的 postmaster(別的視窗正在用?)⇒ 拒絕 rm -rf,也不去停它。"
  echo "        處置:等它跑完,或改用別的 datadir —— 設定點在本檔頂端的 D= / SOCK= / P=(多數 harness 寫在同一行,w0b-verify.sh 是分三行)"
  echo "        (多數 harness 寫成 \${XXXDB:-預設},可用 env 覆寫;少數(如 w0b-verify.sh)是**寫死的**,要改檔)。"
  exit 1
fi
teardown() {
  TD_RC=$?   # 🔴 W7 跟片③:第一句就接住本來要離場的碼(EXIT trap 進來時的 $?)
  pg_ctl -D "$D" -w stop >/dev/null 2>&1
  LEFTOVER="$(pgrep -f "postgres.*$D" 2>/dev/null | wc -l | tr -d ' ')"
  if [ -f "$D/postmaster.pid" ] || [ "$LEFTOVER" != "0" ]; then
    echo "🔴 TEARDOWN_WARN:postmaster 沒停乾淨(殘留程序 $LEFTOVER 支)⇒ **保留 datadir 與 socket 目錄供診斷**:$D / $SOCK"
    # 🔴 W7 跟片③(2026-08-09,B-226 MF-3):原本這裡只 `return` —— 畫面上有紅字、**exit 仍是 0**
    #    ⇒ 跑過帳、CI、人眼掃 exit 全部看不到殘留。W5 那片修的是**主體**的 exit 守門,
    #    teardown 這條出口整條漏,含本支共 19 支同一個缺陷。⚠️ 在 EXIT trap 裡 `exit` 會覆寫
    #    離場碼且**不會遞迴觸發 trap**(bash 3.2.57 實測)。🔴 **限正常離場路徑** —— R1 F1 實測:
    #    由信號(INT/TERM/HUP/PIPE)觸發時 bash 會 re-raise,最終碼是 130/143/129/141,
    #    這個 `exit 9` 會被蓋掉(仍非 0,不是假綠,但別把這句讀成全稱)。本來就非 0 時保留原碼 —— 殘留不該把
    #    FAIL=1 洗成 9,那會弄丟「哪一格紅了」這個資訊。
    if [ "$TD_RC" -eq 0 ]; then exit 9; else exit "$TD_RC"; fi
  fi
  rm -rf "$D" "$SOCK"
  # 🔴 rm 之後**實測 -e**、不要只印「已收」——「宣稱」不是「檢查」(本 repo 記過的恆真格家族)。
  if [ -e "$D" ] || [ -e "$SOCK" ]; then
    echo "🔴 TEARDOWN_WARN:rm 之後仍看得到 資料目錄=$([ -e "$D" ] && echo 殘留 || echo 0) / socket 目錄=$([ -e "$SOCK" ] && echo 殘留 || echo 0)"
    # 🔴 W7 跟片③(2026-08-09,B-226 MF-3):原本這裡只 `return` —— 畫面上有紅字、**exit 仍是 0**
    #    ⇒ 跑過帳、CI、人眼掃 exit 全部看不到殘留。W5 那片修的是**主體**的 exit 守門,
    #    teardown 這條出口整條漏,含本支共 19 支同一個缺陷。⚠️ 在 EXIT trap 裡 `exit` 會覆寫
    #    離場碼且**不會遞迴觸發 trap**(bash 3.2.57 實測)。🔴 **限正常離場路徑** —— R1 F1 實測:
    #    由信號(INT/TERM/HUP/PIPE)觸發時 bash 會 re-raise,最終碼是 130/143/129/141,
    #    這個 `exit 9` 會被蓋掉(仍非 0,不是假綠,但別把這句讀成全稱)。本來就非 0 時保留原碼 —— 殘留不該把
    #    FAIL=1 洗成 9,那會弄丟「哪一格紅了」這個資訊。
    if [ "$TD_RC" -eq 0 ]; then exit 9; else exit "$TD_RC"; fi
  fi
  echo "  teardown:postmaster 已停、殘留程序 0、datadir 與 socket 目錄已收(-e 實測)"
}
trap teardown EXIT

rm -rf "$D" "$SOCK"; mkdir -p "$SOCK"
initdb -D "$D" -U postgres --no-sync -A trust -E UTF8 --locale=C >/dev/null 2>"$SOCK/initdb.err" \
  || { echo INITDB_FAIL; cat "$SOCK/initdb.err" 2>/dev/null; exit 1; }   # 🔴 R2 nit:原本 stderr 直接丟 /dev/null ⇒ 失敗只拿到六個字。隔壁 START_FAIL 有 cat log,這裡對齊。
pg_ctl -D "$D" -o "-p $P -k $SOCK -c listen_addresses=" -l "$D/log" -w start >/dev/null 2>&1 \
  || { echo START_FAIL; cat "$D/log" 2>/dev/null; exit 1; }
die() { echo "$1"; exit 1; }   # 🔴 收尾一律交給 EXIT 的 trap teardown(單一離場路徑)
Q()  { psql -X -h "$SOCK" -p $P -U postgres -d postgres -qtA -c "$1" 2>&1 | tr -d '\n'; }
QM() { psql -X -h "$SOCK" -p $P -U postgres -d postgres -qtA -c "$1" 2>&1; }
cap() {
  psql -X -h "$SOCK" -p $P -U postgres -d postgres -qtA -c \
    "DO \$cap\$ DECLARE c text; n text; BEGIN BEGIN PERFORM $1; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS c = RETURNED_SQLSTATE, n = CONSTRAINT_NAME; RAISE NOTICE 'CAP|%|%', c, coalesce(n,'(null)'); END; END \$cap\$;" 2>&1 \
    | sed -n 's/.*CAP|\(.*\)/\1/p' | tr -d '\n'
}

# 🔴 尾端閘(本檔的意義所在,見檔頭)
# 🔴🔴 **第一次重釘(W3c-1 落檔)—— 這道閘照設計 die 了,處置就是這裡寫的**:
#    重釘 + 把新片的物件加進 oracle。W3c-1 是 `CREATE OR REPLACE` 既有的 `admin_void_shipment`
#    ⇒ 物件集合不變(仍是五支),但**端到端多了一段作廢**(void 從「只有存在性」變成有行為)。
# 🔴 **第二次重釘(W3c-2 落檔)**:unvoid 也有行為了 ⇒ 端到端補「復原」那一步,
#    鍵表期望值四列 → **五列**、誠實邊界那句「unvoid 只有存在性」作廢。
# 🔴🔴 **第三次重釘(W4-1 落檔)**:W4-1 把 W0b 那兩支 trigger 函式的 REVOKE 補上了
#    ⇒ **下面的 `ACL_EXEMPT` 具名例外必須撤掉**。當初留例外時就寫了「修掉那天本格會紅、逼人回收例外」——
#    這次就是那一天。例外留著不撤 = 它會從「誠實的記帳」變成「永久的謊」。
# 🔴 重釘(2026-08-09 W7d-3 落檔 `20260809030000`):該片是 **assert-only** ——
#    逐條核過 `CREATE|ALTER|DROP|GRANT|REVOKE|INSERT|UPDATE|DELETE` **全部零命中**,
#    只有一個 DO block 與一個 `COMMENT ON FUNCTION`。⇒ **結構 oracle 無需增列**
#    (閘要求的第二步在本片是 no-op,但這是查出來的、不是跳過的)。
#    `COMMENT` 不進 `pg_get_functiondef` ⇒ 任何函式體 md5 釘值也不受影響。
# RE-PIN 2026-08-09 pm: lifecycle L2 20260809140000 = payment retry RPC CREATE OR REPLACE
#    (mark_attempt_settle_retry / mark_webhook_retry, allowlist + 'record_not_found' only).
#    Non-shipping functions; grep recompute|order_item_qty|oiqs = 0 hits => shipping oracles
#    unchanged, no md5 re-measure needed. Main-window re-pin + full re-record.
# RE-PIN 2026-08-09 evening: lifecycle L3 20260809160000/170000 = new fn pcm_cron.expire_unpaid_orders
#    (writes orders.cancelled_at only) + pg_cron schedule. No shipping tables/functions touched;
#    grep recompute|order_item_qty|oiqs|shipment = comment-only hit => shipping oracles unchanged.
#    Main-window re-pin + full re-record.
LINE_TIP="20260811100000"  # 2026-08-11 重釘 20260811030000->20260811060000(L5b-2 片 2a=P 窗;claim RPC DROP+重建、回傳三欄->四欄。**述詞一字未動**〔md5(split_part(prosrc,'RETURNING',1)) 兩版皆 f15644b5…〕⇒ 對 w5 各線被測面〔出貨/重算/摘要〕無交集;唯一連動是 l5b0-verify 的 claim 身分閘,已同批重釘);後續重釘 ->070000(D 翻種子收割)->080000(P 2c 收割;兩次皆主視窗收割時代釘,值已對、本註解 08-11 補齊)
NEWEST_TS="$(ls "$REPO"/supabase/migrations/*.sql | sed 's|.*/||; s|_.*||' | sort | tail -1)"
[ "$NEWEST_TS" = "$LINE_TIP" ] \
  || die "migration 目錄的尾端是 $NEWEST_TS,不是本檔釘住的 $LINE_TIP ——
   本檔是**線級** harness,它的職責就是跟著線一起長。
   處置 = 重釘本行 **並把新片的物件加進下面的結構 oracle**,**不是把這道閘拿掉**。"

cd "$REPO" || die "CD_FAIL"
psql -X -h "$SOCK" -p $P -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f scripts/d1-supabase-shim.sql >/dev/null || die "SHIM_FAIL"
FIRST_FITMENTS="$(grep -l 'product_fitments_effective' supabase/migrations/*.sql | sort | head -1)"
for f in supabase/migrations/*.sql; do
  case "$f" in *20260723120000*|*20260809170000*) continue ;; esac  # skip pg_cron-dependent: settle sweeper + L3b schedule (bare PG has no pg_cron; L3a fn still replayed)
  case "$(basename "$f")" in [0-9]*) : ;; *) die "MIG_NAME_NOT_TS: $f" ;; esac
  if [ "$f" = "$FIRST_FITMENTS" ]; then
    psql -X -h "$SOCK" -p $P -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f scripts/d1-fitments-bootstrap.sql >/dev/null || die "FITBOOT_FAIL"
  fi
  psql -X -h "$SOCK" -p $P -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null 2>"$D/err" || die "MIG_FAIL: $f :: $(cat "$D/err")"
done
ok LINE-REPLAY "**整個 migration 目錄**(無前綴、含尖端 $LINE_TIP)從零重放成功 ⇒ 五支 writer **存在且可疊**。🔴 五支 writer **全部**在端到端裡有行為(W3c-2 落檔後,unvoid 也有了)"

echo "══ 1. 結構 oracle:出貨線的物件集合凍結 ═══════════════════"
# 🔴 一份清單、一個權威。各片自己的凍結格守的是各片;本格守的是**線的完整性**
#    —— 任何一片被誰改掉/漏套/多長一支,這裡會紅。
FIVE="admin_add_shipment_items,admin_create_shipment,admin_mark_shipment_shipped,admin_unvoid_shipment,admin_void_shipment"
RPCS="$(Q "SELECT pg_catalog.string_agg(p.proname, ',' ORDER BY p.proname) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'admin\_%shipment%'")"
[ "$RPCS" = "$FIVE" ] && ok LINE-RPC-SET "出貨 RPC 集合**恰為五支**(多一支少一支都紅)✓" || bad LINE-RPC-SET "實得 [$RPCS]"
HELPERS_EXP="pcm_b2_shipping_human_error,pcm_b2_shipping_idem_bad_snapshot_cols,pcm_b2_shipping_idem_claim,pcm_b2_shipping_idem_freeze_identity,pcm_b2_shipping_idem_insert_guard,pcm_b2_shipping_idem_no_purge,pcm_b2_shipping_idem_payload_hash,pcm_b2_shipping_idem_record,pcm_b2_shipping_idem_require_complete,pcm_b2_shipping_idem_response"
HELPERS="$(Q "SELECT pg_catalog.string_agg(p.proname, ',' ORDER BY p.proname) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND (p.proname LIKE 'pcm\_b2\_shipping\_%')")"
[ "$HELPERS" = "$HELPERS_EXP" ] && ok LINE-HELPER-SET "出貨線 helper 集合逐字凍結(10 支:W2 七 + W0b 兩 + W3-3 轉譯層)✓" || bad LINE-HELPER-SET "實得 [$HELPERS]"
# 🔴 ACL:五支只有 service_role;十支 helper 零 GRANT(含 proacl IS NULL 那面)
ACLBAD=""
for fn in $(printf '%s' "$FIVE" | tr ',' ' '); do
  SIG="$(Q "SELECT p.oid::regprocedure::text FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='$fn'")"
  V="$(Q "SELECT has_function_privilege('anon','$SIG','EXECUTE')::text||has_function_privilege('authenticated','$SIG','EXECUTE')::text||has_function_privilege('authenticator','$SIG','EXECUTE')::text||has_function_privilege('service_role','$SIG','EXECUTE')::text")"
  [ "$V" = "falsefalsefalsetrue" ] || ACLBAD="$ACLBAD $fn($V)"
done
[ -z "$ACLBAD" ] && ok LINE-RPC-ACL "五支逐支:三個對外角色無 EXECUTE、service_role 有 ✓" || bad LINE-RPC-ACL "ACL 漂了:$ACLBAD"
# 🔴🔴 **線級 oracle 首跑就抓到一條上游缺口(實查證實)**:
#    `…w0b_shipping_idempotency.sql:210` **只 REVOKE 了表**,它自己建的兩支 trigger 函式
#    (`_no_purge` / `_freeze_identity`)**沒 REVOKE** ⇒ 它們留著 shim 的 default privileges,
#    非 owner grantee = 4(PUBLIC + anon/authenticated/service_role)。
#    🔴 **實害有限**:trigger 函式被直呼時 PG 會擋(「只能當 trigger 呼叫」)⇒ 不是可用的洞。
#    🔴 **但我的線級宣稱「十支零 GRANT」是假的** ⇒ 據實編碼成**具名例外**,不假裝它零 GRANT。
#    ⇒ 修法是一行 REVOKE,最省的落點是 W4 的 migration(順路)。STOP 列為欠款;
#      修掉的那天本格會紅(例外清單對不上)、逼人回來拿掉例外 —— 與 M3 窗口同一形狀。
ACL_EXEMPT=""   # 🔴 W4-1 已補 REVOKE ⇒ 例外清空(見上面第三次重釘的說明)
HBAD=""
for fn in $(printf '%s' "$HELPERS_EXP" | tr ',' ' '); do
  NULLACL="$(Q "SELECT (p.proacl IS NULL)::text FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='$fn'")"
  G="$(Q "SELECT pg_catalog.count(*)::text FROM pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a WHERE p.proname='$fn' AND a.grantee <> p.proowner")"
  case " $ACL_EXEMPT " in
    # 🔴 跨模型審查 F6:比**數**不比**名** ⇒ 有人 REVOKE PUBLIC 又 GRANT 另一個角色、數還是 4、本格照樣綠。
    #    ⇒ 逐字比 grantee 名單。
    *" $fn "*)
       GN="$(Q "SELECT pg_catalog.string_agg(DISTINCT coalesce(r.rolname,'PUBLIC'), ',' ORDER BY coalesce(r.rolname,'PUBLIC')) FROM pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a LEFT JOIN pg_catalog.pg_roles r ON r.oid = a.grantee WHERE p.proname='$fn' AND a.grantee <> p.proowner")"
       [ "$GN" = "PUBLIC,anon,authenticated,service_role" ] || HBAD="$HBAD $fn(已知缺口的 grantee 名單應為 PUBLIC,anon,authenticated,service_role,實得 [$GN])" ;;
    # 🔴 `aclexplode(NULL)` 回零列 ⇒ 只數 grantee 對「proacl IS NULL(=預設 EXECUTE to PUBLIC)」全盲
    *) { [ "$NULLACL" = "false" ] && [ "$G" = "0" ]; } || HBAD="$HBAD $fn(null=$NULLACL,g=$G)" ;;
  esac
done
[ -z "$HBAD" ] && ok LINE-HELPER-ACL "**十支 helper 全部**零 GRANT 且 proacl 非 NULL(W4-1 補完 W0b 那兩支之後,具名例外已撤)✓" \
                || bad LINE-HELPER-ACL "$HBAD"
# 🔴 鍵表的五發 trigger 全 ALWAYS
# 🔴🔴 **W4-2 落檔補的兩格(跨模型審查 F3 點名的尖端盲區)**:
#    上面的 helper 集合凍結用的 pattern 是 `pcm_b2_shipping_%`,而 W4-2 的兩支叫
#    `pcm_b2_add_items_impl` / `pcm_b2_shipments_no_batch_update` ⇒ **不在 pattern 內、整組全盲**。
#    失敗情境:下一片落檔那天起 w4b 的前綴 < 尖端,之後任何片 `CREATE OR REPLACE` 掉薄封裝、
#    或 `DROP`/降級禁批次 trigger ⇒ **零 harness 會紅**(w4b 在自己前綴永遠綠、w5 看不見)。
#    🔴 **殘餘**:再新增一支別的 `pcm_b2_*` helper 仍然逃得掉(逐名凍結不是 pattern 凍結)。寫下來,不假裝關完。
W4B_FN="pcm_b2_add_items_impl,pcm_b2_shipments_no_batch_update"
WBAD=""
for fn in $(printf '%s' "$W4B_FN" | tr ',' ' '); do
  V="$(Q "SELECT (p.proacl IS NOT NULL)::text || ':' || (SELECT pg_catalog.count(*)::text FROM pg_catalog.aclexplode(p.proacl) a WHERE a.grantee <> p.proowner) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='$fn'")"
  [ "$V" = "true:0" ] || WBAD="$WBAD $fn($V)"
done
[ -z "$WBAD" ] && ok LINE-W4B-HELPERS "W4-2 兩支新 helper 在尖端**存在且零 GRANT**(proacl 非 NULL)✓" || bad LINE-W4B-HELPERS "$WBAD"
nbstate() { Q "SELECT coalesce(pg_catalog.string_agg(t.tgenabled::text, ','),'(無)') FROM pg_catalog.pg_trigger t WHERE t.tgrelid='public.shipments'::pg_catalog.regclass AND t.tgname='shipments_no_batch_update_as' AND NOT t.tgisinternal"; }
NB="$(nbstate)"
[ "$NB" = "A" ] \
  && ok LINE-NOBATCH-TRIGGER "🔴 禁批次那發(shipments_no_batch_update_as)在尖端**存在且 ENABLE ALWAYS** ⇒ 被 DROP 或降級時本格會紅 ✓" \
  || bad LINE-NOBATCH-TRIGGER "實得 [$NB](期望 A)"
# 🔴 `tgenabled` 是 `"char"` 型別,`text || "char"` 的運算子**不唯一** ⇒ 要顯式 `::text`(首跑實錘)。
trgstate() { Q "SELECT pg_catalog.string_agg(t.tgname||':'||t.tgenabled::text, ',' ORDER BY t.tgname) FROM pg_catalog.pg_trigger t WHERE t.tgrelid='public.pcm_b2_shipping_idempotency'::pg_catalog.regclass AND NOT t.tgisinternal"; }
TRG="$(trgstate)"
TRG_EXP="pcm_b2_shipping_idem_block_bad_snapshot_insert:A,pcm_b2_shipping_idem_block_delete:A,pcm_b2_shipping_idem_block_identity_update:A,pcm_b2_shipping_idem_block_truncate:A,pcm_b2_shipping_idem_require_complete:A"
case "$TRG" in
  *ERROR*)     bad LINE-IDEM-TRIGGERS "🔴 本格的 SQL 自己寫壞了(非 trigger 問題):$TRG" ;;
  "$TRG_EXP")  ok  LINE-IDEM-TRIGGERS "鍵表五發 trigger 逐字 + 全部 ENABLE ALWAYS ✓" ;;
  *)           bad LINE-IDEM-TRIGGERS "實得 [$TRG]" ;;
esac

echo "══ 2. 端到端:一個員工從頭做到尾(全程只走 RPC)═══════════"
# 🔴 **不直寫任何一張業務表** —— 各片的 harness 為了構造負測會直寫,本檔刻意不;
#    它要回答的是「這條線串起來真的走得通嗎」。
CUST='11111111-1111-1111-1111-111111111111'
ORD='aaaaaaaa-0000-0000-0000-000000000001'
SNAP='{"name":"王大明","phone":"0900000000","line":"L1"}'
PSNAP='{"title":"零件","sku":"S1","spec":{"color":"black"}}'
Q "INSERT INTO auth.users(id,email) VALUES('$CUST','w5@test.local')" >/dev/null
Q "INSERT INTO public.customers(user_id,email) VALUES('$CUST','w5@test.local')" >/dev/null
Q "INSERT INTO public.orders(id,display_id,customer_user_id,shipping_address_snapshot,tier_at_checkout,subtotal,shipping_fee,total,shipping_method,invoice,shipping_method_at_checkout) VALUES('$ORD','4TFBFH','$CUST','$SNAP'::jsonb,(SELECT enumlabel::text::public.member_tier FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='member_tier' LIMIT 1),100,0,100,'home','{\"type\":\"personal\"}'::jsonb,'home')" >/dev/null
[ "$(Q "SELECT pg_catalog.count(*)::text FROM public.orders WHERE id='$ORD'")" = "1" ] || die "FIXTURE_FAIL(orders)"
SUPP="$(Q "INSERT INTO public.suppliers(label) VALUES('線級測試供應商') RETURNING id")"
case "$SUPP" in ????????-*) : ;; *) die "FIXTURE_FAIL(suppliers): $SUPP" ;; esac
OI1='bbbbbbbb-0000-0000-0000-000000000001'
OI2='bbbbbbbb-0000-0000-0000-000000000002'
for pair in "$OI1|SKU-1|4" "$OI2|SKU-2|3"; do
  OI="${pair%%|*}"; R="${pair#*|}"; SKU="${R%%|*}"; QTY="${R#*|}"
  Q "INSERT INTO public.order_items(id,order_id,variant_sku,product_snapshot,quantity,unit_price,line_total) VALUES('$OI','$ORD','$SKU','$PSNAP'::jsonb,10,10,100)" >/dev/null
  PID="$(Q "INSERT INTO public.order_item_procurement(order_item_id,allocated_quantity,supplier_id) VALUES('$OI',10,'$SUPP') RETURNING id")"
  case "$PID" in ????????-*) : ;; *) die "FIXTURE_FAIL(procurement $OI): $PID" ;; esac
  Q "INSERT INTO public.order_item_procurement_receipts(procurement_id,quantity,received_at,received_by) VALUES('$PID',$QTY,now(),'tester')" >/dev/null
  N="$(Q "SELECT coalesce(pg_catalog.max(instock_quantity)::text,'(無列)') FROM public.order_item_quantity_summary WHERE order_item_id='$OI'")"
  [ "$N" = "$QTY" ] || die "FIXTURE_FAIL(instock $OI): 實得 [$N] 期望 [$QTY]"
done

R="$(QM "SELECT public.admin_create_shipment('e2e-1','$CUST','$SNAP'::jsonb,'hct')" | tr '\n' ' ')"
case "$R" in *ERROR*) bad E2E-CREATE "建箱失敗:$R"; SHIP="" ;; *) SHIP="$(Q "SELECT ('$R'::jsonb ->> 'shipment_id')")"; ok E2E-CREATE "①建箱成功 ✓" ;; esac
if [ -z "$SHIP" ]; then
  bad E2E-ADD "🔴 前一步沒成立 ⇒ 這不是掛品項的結論"
  bad E2E-SHIP "🔴 前一步沒成立 ⇒ 這不是出貨的結論"
  bad E2E-SUMMARY "🔴 前一步沒成立 ⇒ 這不是摘要的結論"
  # 🔴 W7 跟片④(B-227 nit-4):下面兩格**現在真的**在 else 內了,前置分支要同步補上,
  #    否則沒有 SHIP 時它們整個不跑 ⇒ 紅的是 CELL-ACCOUNT,而不是「哪一步沒成立」。
  # 🔴 R1 F2:第一版我只補了 VOID/UNVOID 兩格,但 else 內其實有**六**格、這裡只有五格 ——
  #    `LINE-23505-TRANSLATED` 本來就漏(不是我這片新造的),而我的註解卻宣稱效果已達成。
  #    兩條路徑的格數必須逐格相同,否則沒有 SHIP 時 CELL-ACCOUNT/CELL-KEYSET 照樣紅。
  bad LINE-23505-TRANSLATED "🔴 前一步沒成立 ⇒ 這不是轉譯的結論"
  bad E2E-VOID "🔴 前一步沒成立 ⇒ 這不是作廢的結論"
  bad E2E-UNVOID "🔴 前一步沒成立 ⇒ 這不是復原的結論"
else
  # 🔴 跨模型審查 F3:原本兩個品項都**掛滿**(4=instock、3=instock)⇒ 下面的 `4/3` 分不出
  #    「重算讀的是 shipment_items」還是「誤讀 instock」。⇒ 改成**部分出貨**(OI1 掛 3、instock 4),
  #    讓 shipped(3)≠ instock(4)≠ 訂購量(10),三個數字互相分得開。
  R="$(QM "SELECT public.admin_add_shipment_items('e2e-2','$SHIP','[{\"order_item_id\":\"$OI1\",\"quantity\":3},{\"order_item_id\":\"$OI2\",\"quantity\":3}]'::jsonb)" | tr '\n' ' ')"
  case "$R" in *ERROR*) bad E2E-ADD "掛品項失敗:$R" ;; *) ok E2E-ADD "②掛兩個品項(一個部分、一個掛滿)成功 ✓" ;; esac
  # 🔴 F3/F4:W4-2 的 23505 轉譯在**尖端**是否還在。w4b 只證了「它自己的前綴」那一刻;
  #    下一片落檔後 w4b 的前綴就 < 尖端 ⇒ 沒有這一格的話,薄封裝被誰蓋掉不會有人紅。
  C="$(cap "public.admin_add_shipment_items('e2e-2b','$SHIP','[{\"order_item_id\":\"$OI1\",\"quantity\":1}]'::jsonb)")"
  [ "$C" = "P2B29|pcm_b2_w4b_translated" ] \
    && ok LINE-23505-TRANSLATED "🔴 同箱補掛在**尖端**仍被轉譯成 P2B29(W4-2 的薄封裝沒被後面的片蓋掉)✓" \
    || bad LINE-23505-TRANSLATED "實得 [$C](期望 P2B29|pcm_b2_w4b_translated)"
  R="$(QM "SELECT public.admin_mark_shipment_shipped('e2e-3','$SHIP','TRACK-E2E')" | tr '\n' ' ')"
  case "$R" in *ERROR*) bad E2E-SHIP "出貨失敗:$R" ;; *) ok E2E-SHIP "③出貨成功 ⇒ **一條線從頭到尾走得通**(全程只走 RPC、零直寫)✓" ;; esac
  V="$(Q "SELECT pg_catalog.string_agg(order_item_id::text||'x'||shipped_quantity::text, ',' ORDER BY order_item_id) FROM public.order_item_quantity_summary WHERE order_item_id IN ('$OI1','$OI2')")"
  # 🔴 W3c-1 落地後補的第五步:作廢 ⇒ 退量。放在 SUMMARY 之後,不影響前面那格量的東西。
  [ "$V" = "${OI1}x3,${OI2}x3" ] && ok E2E-SUMMARY "④摘要重算成 3 / 3:OI1 的 **shipped(3)≠ instock(4)≠ 訂購量(10)** ⇒ 重算讀的真的是 shipment_items,不是別的欄 ✓" || bad E2E-SUMMARY "摘要實得 [$V]"
  # 🔴 F5:本格原本落在 `fi` 之外 ⇒ 前一步失敗時它會紅在「uuid 語法錯」而不是作廢的結論。
  # 🔴 W7 跟片④(B-227 nit-4):上面那句從 F5 那天起就是**假的** —— `fi` 一直在本段之前,
  #    這兩格從來沒有真的被前置分支保護過(codex 在 #7 nit-4 與本片各點名一次,同一處)。
  #    這次真的把 `fi` 搬到 E2E-UNVOID 之後了。字面與事實現在才一致。
  R="$(QM "SELECT public.admin_void_shipment('e2e-4','$SHIP','線級測試:作廢')" | tr '\n' ' ')"
  V2="$(Q "SELECT pg_catalog.string_agg(order_item_id::text||'x'||shipped_quantity::text, ',' ORDER BY order_item_id) FROM public.order_item_quantity_summary WHERE order_item_id IN ('$OI1','$OI2')")"
  case "$R:$V2" in
    *ERROR*) bad E2E-VOID "作廢失敗:$R" ;;
    *":${OI1}x0,${OI2}x0") ok E2E-VOID "⑤作廢成功且**退量真的發生**(3/3 → 0/0)✓" ;;
    *) bad E2E-VOID "作廢後摘要實得 [$V2](期望全 0)" ;;
  esac
  R="$(QM "SELECT public.admin_unvoid_shipment('e2e-5','$SHIP')" | tr '\n' ' ')"
  V3="$(Q "SELECT pg_catalog.string_agg(order_item_id::text||'x'||shipped_quantity::text, ',' ORDER BY order_item_id) FROM public.order_item_quantity_summary WHERE order_item_id IN ('$OI1','$OI2')")"
  case "$R:$V3" in
    *ERROR*) bad E2E-UNVOID "復原失敗:$R" ;;
    *":${OI1}x3,${OI2}x3") ok E2E-UNVOID "⑥復原成功且**回加真的發生**(0/0 → 3/3)⇒ **五支 writer 串起來的一整條線走得通**(建箱→掛品項→出貨→作廢→復原)✓" ;;
    *) bad E2E-UNVOID "復原後摘要實得 [$V3](期望回到 3/3)" ;;
  esac
fi

echo "══ 3. 🔴 線級不變式(跨片,各片自己看不到的)═══════════════"
# 🔴 冪等鍵表:每個動作各一列、且**全部都有 shipment_id**(DEFERRED 閘的線級後果)
IDEM="$(Q "SELECT pg_catalog.string_agg(action||':'||(shipment_id IS NOT NULL)::text, ',' ORDER BY action) FROM public.pcm_b2_shipping_idempotency")"
[ "$IDEM" = "add_items:true,create_shipment:true,ship:true,unvoid:true,void:true" ] \
  && ok LINE-IDEM-COMPLETE "端到端跑完後,鍵表**五列**全部都有 shipment_id(零半成品)⇒ 五支的回填都真的發生了 ✓" \
  || bad LINE-IDEM-COMPLETE "鍵表實得 [$IDEM]"
# 🔴 三支的回傳信封形狀一致(W2 的 R1-F4 契約在**線級**成立)
SHAPES="$(Q "SELECT pg_catalog.count(DISTINCT k)::text FROM (SELECT pg_catalog.string_agg(key,',' ORDER BY key) AS k FROM public.pcm_b2_shipping_idempotency i, pg_catalog.jsonb_object_keys(i.result_snapshot) key GROUP BY i.action) t")"
[ "$SHAPES" = "1" ] && ok LINE-SNAPSHOT-SHAPE "五支寫下的快照**鍵集合完全相同** ⇒ to_jsonb 同源的形狀契約在線級成立(W3-2/W3-3/W3c-1/W3c-2 沒有各自漂)✓" \
                    || bad LINE-SNAPSHOT-SHAPE "快照鍵集合有 $SHAPES 種不同形狀 ⇒ 有片沒照 W3-1 的形狀抄"
# 🔴 重放:**五支**都再打一次同鍵,產物一律零增長
# 🔴 W7 跟片④(B-227 MF-1):原本這裡只重放三支(create/add/ship),而下面 `ok` 的字面寫
#    「五支(建箱/掛品項/出貨/作廢/復原)各再打一次」⇒ **void / unvoid 的冪等漂掉本格照樣綠**。
#    codex 在 #5 MF-2 / #6 MF-1 / #7 MF-3 點名三次同一個觀察 —— 宣稱大於事實,不是漏測而已。
#    這裡補上第四、五支。狀態:此刻 SHIP 已 unvoid(3/3),兩支重放都應走冪等分支、零副作用。
B4="$(Q "SELECT pg_catalog.count(*)::text FROM public.shipments")|$(Q "SELECT pg_catalog.count(*)::text FROM public.shipment_items")"
SUM_B4="$(Q "SELECT pg_catalog.string_agg(order_item_id::text||'x'||shipped_quantity::text, ',' ORDER BY order_item_id) FROM public.order_item_quantity_summary WHERE order_item_id IN ('$OI1','$OI2')")"
# 🔴🔴 R1 F4(比 MF-1 更深的一層):五發重放原本**回傳全丟進 /dev/null**
#    ⇒ 「走了冪等分支」與「整個拋例外」在觀察上不可分辨。而且實錘不是假設:
#    原呼叫用 `quantity:3`(見上面 E2E-ADD 那發),這裡卻寫 `quantity:4` ⇒ 同鍵不同 payload
#    ⇒ W2 的指紋守門直接 `P2B22`,**這一發從來就不是重放**,錯誤還被 `2>/dev/null` 吃掉。
#    ⇒ payload 改回一致,並逐發收回傳、斷言 `idempotent=true`(見下面 A1 那段)。
RPBAD=""
for one in "e2e-1|public.admin_create_shipment('e2e-1','$CUST','$SNAP'::jsonb,'hct')" \
           "e2e-2|public.admin_add_shipment_items('e2e-2','$SHIP','[{\"order_item_id\":\"$OI1\",\"quantity\":3},{\"order_item_id\":\"$OI2\",\"quantity\":3}]'::jsonb)" \
           "e2e-3|public.admin_mark_shipment_shipped('e2e-3','$SHIP','TRACK-E2E')" \
           "e2e-4|public.admin_void_shipment('e2e-4','$SHIP','線級測試:作廢')" \
           "e2e-5|public.admin_unvoid_shipment('e2e-5','$SHIP')"; do
  RPK="${one%%|*}"; RPC="${one#*|}"
  # 🔴 R2 A1:「非 ERROR」**不等於**走了冪等分支 —— `e2e-3`(ship)與 `e2e-5`(unvoid)
  #    若真的又執行一次,不新增列、摘要也不變、更不拋例外 ⇒ 三個觀察同時零判別力。
  #    W2 的回傳信封本來就帶 `idempotent` 旗標(重放 true / 首次 false)⇒ 直接問它,這才是正向觀察。
  RPR="$(Q "SELECT ($RPC) ->> 'idempotent'")"
  [ "$RPR" = "true" ] || RPBAD="$RPBAD $RPK(idempotent=[$RPR])"
done
AF="$(Q "SELECT pg_catalog.count(*)::text FROM public.shipments")|$(Q "SELECT pg_catalog.count(*)::text FROM public.shipment_items")"
# 🔴 只數列數對 void/unvoid 這兩支**零判別力** —— 它們本來就不新增列,動的是摘要的量。
#    ⇒ 重放前後的摘要也要逐字相同,否則「重放」等於偷偷再退一次量 / 再回加一次。
SUM_AF="$(Q "SELECT pg_catalog.string_agg(order_item_id::text||'x'||shipped_quantity::text, ',' ORDER BY order_item_id) FROM public.order_item_quantity_summary WHERE order_item_id IN ('$OI1','$OI2')")"
{ [ "$B4" = "$AF" ] && [ "$SUM_B4" = "$SUM_AF" ] && [ -z "$RPBAD" ]; } \
  && ok LINE-REPLAY-NO-GROWTH "🔴 五支(建箱/掛品項/出貨/作廢/復原)各再打一次同鍵:**五發回傳的 idempotent 旗標都是 true**(= 真的走了冪等分支,不只是「沒報錯」)、包裹數與品項數零增長($AF)、摘要逐字不變($SUM_AF)= 這條線的 at-most-once 在端到端成立 ✓" \
  || bad LINE-REPLAY-NO-GROWTH "🔴 重放不乾淨:列數 $B4 → $AF、摘要 [$SUM_B4] → [$SUM_AF]、沒走冪等分支的發次[${RPBAD:-無}]"

# ══ 🔴 正式站 42501 事故的負測(2026-08-09)══════════════════════
# 🔴 事故:Sean 在正式站按「建箱並標出貨」⇒ `permission denied for table
#    pcm_b2_shipping_idempotency`(42501)。根因=`pcm_b2_shipping_idem_require_complete()`
#    是 **SECURITY INVOKER 的 DEFERRED constraint trigger** ⇒ COMMIT 當下 SECDEF 的 RPC
#    早已退場,執行身分是 session 角色 `service_role`,而該表對它 REVOKE ALL。
# 🔴🔴 **為什麼全線 34 格沒有一格紅**:本檔(以及 w0b/w1/w2)全程以 **owner(postgres)**
#    身分跑 ⇒ deferred 那一刻的身分也是 owner ⇒ 讀表恆過。
#    這不是「斷言太鬆」,是**觀察點選錯** —— 量的身分不是正式站真正用的那個身分。
#    ⇒ 這一格改用**真的 service_role** 跑一次完整 create + commit。
# 🔴 必須是**獨立一次 psql 呼叫**、且 `SET ROLE` 與 RPC 在同一個交易裡:
#    deferred trigger 只在 COMMIT 當下執行,拆成兩次呼叫就永遠測不到那一刻。
NONOWNER="$(psql -X -h "$SOCK" -p $P -U postgres -d postgres -qtA \
  -c "SET ROLE service_role; SELECT (public.admin_create_shipment('nonowner-1','$CUST','$SNAP'::jsonb,'hct') ->> 'shipment_id');" 2>&1 | tr '\n' ' ')"
# 🔴🔴 codex must-fix:**錯誤分支必須排在 UUID 分支之前**。
#    `psql -c` 會先印 SELECT 的結果列、再印 implicit COMMIT 當下的錯誤 ⇒ 迴歸發生時
#    合併輸出**同時含 UUID 與 42501**。UUID 分支若排前面就先匹配 ⇒ **本負測自己假綠**,
#    而它存在的唯一理由就是抓這件事。(TMUT 那格的順序本來就對,所以 TMUT 綠證不了本格。)
case "$NONOWNER" in
  *42501*|*"permission denied"*) bad LINE-NONOWNER-COMMIT "🔴🔴 **正式站那個錯又回來了**:service_role 身分 commit 時 42501 ⇒ 某支可延遲的 constraint trigger 的函式不是 SECURITY DEFINER。實得:$NONOWNER" ;;
  *????????-????-*) ok LINE-NONOWNER-COMMIT "🔴 以**真的 service_role**(不是 owner)跑完整建箱 + commit ⇒ 過 = DEFERRED 半成品閘在 commit 當下讀得到鍵表(正式站 42501 事故的負測)✓" ;;
  *) bad LINE-NONOWNER-COMMIT "非預期結果(既不是 uuid 也不是權限錯):$NONOWNER" ;;
esac
# 🔴 靶:把那支函式改回 SECURITY INVOKER ⇒ 必須當場重現 42501。
#    這一發同時是**事故重現**與**判別力證明**:紅不出來就代表上面那格對事故全盲。
Q "ALTER FUNCTION public.pcm_b2_shipping_idem_require_complete() SECURITY INVOKER" >/dev/null
MNO="$(psql -X -h "$SOCK" -p $P -U postgres -d postgres -qtA \
  -c "SET ROLE service_role; SELECT (public.admin_create_shipment('nonowner-mut','$CUST','$SNAP'::jsonb,'hct') ->> 'shipment_id');" 2>&1 | tr '\n' ' ')"
Q "ALTER FUNCTION public.pcm_b2_shipping_idem_require_complete() SECURITY DEFINER" >/dev/null
MNO2="$(Q "SELECT p.prosecdef::text FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='pcm_b2_shipping_idem_require_complete'")"
case "$MNO:$MNO2" in
  *42501*:true|*"permission denied"*:true)
    ok TMUT-NONOWNER-COMMIT "🔴 改回 SECURITY INVOKER ⇒ **當場重現正式站的 42501**,還原後 prosecdef=true = 上面那格真的在量事故那條路,不是恆真" ;;
  *:true) bad TMUT-NONOWNER-COMMIT "改回 INVOKER 之後竟然沒炸(實得 $MNO)⇒ 上面那格對事故全盲 = 恆真" ;;
  *)      bad TMUT-NONOWNER-COMMIT "🔴 **靶沒還原**(prosecdef=[$MNO2],期望 true)⇒ 本靶留下壞掉的世界給後面的格,先修這個" ;;
esac
# ══ 🔴 冪等帳寫入面凍結(codex 關卡2 must-fix:migration 裡那份攔不到後來的片)══
# 🔴 **為什麼這道一定要在 harness 而不是 migration 裡**:migration 的 DO block 只在
#    apply 當下跑一次。若明天有片新增了 `record()` 的呼叫者,全量重放時我那支
#    `20260809200000` **排在它前面先跑** ⇒ 斷言當下還是乾淨的、根本攔不到。
#    「凍結」那個詞在 migration 那份上是誇大的(codex 關卡2 點名,他對)。
#    本檔重放**整個目錄到尖端**之後才跑,看到的是**最終狀態** ⇒ 這裡才守得住。
#    migration 那份保留,但它的角色是「apply 到正式庫當下的一次性檢查」,不是持續守門。
# 🔴 大小寫:SQL 識別字不區分大小寫,body 可以寫成大寫而躲過 LIKE ⇒ 一律用 ILIKE / `~*`。
LEDGER_NS="n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg\\_%'"
LEDGER_DEF="CASE WHEN p.prokind IN ('f','p') THEN pg_catalog.pg_get_functiondef(p.oid) ELSE NULL END"
LEDGER_SIG="n.nspname||'.'||p.oid::regprocedure::text"
ledger_callers() { Q "SELECT coalesce(pg_catalog.string_agg($LEDGER_SIG, ',' ORDER BY $LEDGER_SIG),'(無)') FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE $LEDGER_NS AND $LEDGER_DEF ~* 'pcm_b2_shipping_idem_record[[:space:]]*\\(' AND p.proname <> 'pcm_b2_shipping_idem_record'"; }
ledger_touchers() { Q "SELECT coalesce(pg_catalog.string_agg($LEDGER_SIG, ',' ORDER BY $LEDGER_SIG),'(無)') FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE $LEDGER_NS AND $LEDGER_DEF ILIKE '%pcm_b2_shipping_idempotency%'"; }
ledger_dyn()   { Q "SELECT pg_catalog.count(*)::text FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE $LEDGER_NS AND $LEDGER_DEF ILIKE '%pcm_b2_shipping_idempotency%' AND $LEDGER_DEF ~* 'EXECUTE[[:space:]]'"; }
ledger_force() { Q "SELECT coalesce(pg_catalog.string_agg(c.relname||'='||c.relforcerowsecurity::text, ',' ORDER BY c.relname),'(無)') FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('shipments','pcm_b2_shipping_idempotency')"; }
# 🔴 凍結值 = catalog 實測(2026-08-09)。**逐字全等**,不是「不准多」——
#    只擋擴張的話,某支被改名或刪掉不會有人紅(codex nit:那是「禁止擴張」不是凍結)。
LEDGER_CALLERS_EXP="public.admin_create_shipment(text,uuid,jsonb,text,text),public.admin_mark_shipment_shipped(text,uuid,text),public.admin_unvoid_shipment(text,uuid),public.admin_void_shipment(text,uuid,text),public.pcm_b2_add_items_impl(text,uuid,jsonb),public.pcm_b2_shipping_idem_require_complete()"
LEDGER_TOUCHERS_EXP="public.pcm_b2_shipping_idem_claim(text,text,text),public.pcm_b2_shipping_idem_record(text,text,uuid,jsonb),public.pcm_b2_shipping_idem_require_complete()"
LC="$(ledger_callers)"; LT="$(ledger_touchers)"; LD="$(ledger_dyn)"; LF="$(ledger_force)"
LBAD=""
[ "$LC" = "$LEDGER_CALLERS_EXP" ] || LBAD="$LBAD 呼叫 record() 的集合變了:[$LC];"
[ "$LT" = "$LEDGER_TOUCHERS_EXP" ] || LBAD="$LBAD 碰鍵表的集合變了:[$LT];"
[ "$LD" = "0" ]                    || LBAD="$LBAD 有 $LD 支在 body 裡同時出現動態 EXECUTE 與鍵表名;"
[ "$LF" = "pcm_b2_shipping_idempotency=false,shipments=false" ] || LBAD="$LBAD FORCE RLS 現況 [$LF](期望兩張都 false);"
[ -z "$LBAD" ] \
  && ok LINE-LEDGER-WRITE-SURFACE "🔴 冪等帳的寫入面在**尖端**逐字凍結:record() 呼叫者 6 筆簽章、碰表函式 3 筆、動態 SQL 0 支、兩張表未開 FORCE RLS ✓(這道在 migration 裡守不住 —— 那份只在自己 apply 那一刻跑)" \
  || bad LINE-LEDGER-WRITE-SURFACE "🔴 冪等帳寫入面變了:$LBAD ⇒ 新的寫入面要先確認它傳的值不是呼叫端可控的,再更新本檔與 20260809200000 的清單"
# 靶:新增一支呼叫 record() 的函式 ⇒ 上面那格必須紅(證它不是恆真)
Q "CREATE FUNCTION public.zz_ledger_probe() RETURNS void LANGUAGE plpgsql AS \$zz\$ BEGIN PERFORM public.pcm_b2_shipping_idem_record('x','y',NULL,'{}'::jsonb); END \$zz\$" >/dev/null
MLC="$(ledger_callers)"
Q "DROP FUNCTION public.zz_ledger_probe()" >/dev/null
MLC2="$(ledger_callers)"
case "$MLC:$MLC2" in
  *zz_ledger_probe*:"$LEDGER_CALLERS_EXP") ok TMUT-LEDGER-WRITE-SURFACE "🔴 多長一支呼叫 record() 的函式 ⇒ 集合真的變了(命中 zz_ledger_probe)、且**還原後逐字回到凍結值** = 上面那格對「寫入面擴張」有判別力" ;;
  *zz_ledger_probe*:*)                     bad TMUT-LEDGER-WRITE-SURFACE "🔴 靶沒還原乾淨(實得 [$MLC2])⇒ 留了一支給後面的格" ;;
  *)                                       bad TMUT-LEDGER-WRITE-SURFACE "多長一支之後集合沒變(實得 [$MLC])⇒ 上面那格恆真" ;;
esac

# ══ 🔴 MF-2 落地驗收(2026-08-09,codex #4 MF-2 / migration 20260809200000)══
# 🔴 被測的是**存根產物斷言**:deferred 半成品閘從「鍵在不在」升級成「產物在不在」。
#    偽造情境要以 **owner 直寫**構造(那正是 finding 的威脅模型 —— 繞過 record());
#    而 deferred trigger 只在 **COMMIT 那一刻**執行 ⇒ 必須用單一 psql 呼叫、讓它走到隱式 commit,
#    包在 `cap`/`capstmt` 的 DO block 裡永遠測不到(那個 exception handler 在 commit 之前就結束了)。
# 🔴 錯誤分支排在成功分支**之前**:psql 會先印 INSERT 的結果、再印 commit 當下的錯誤,
#    順序反了就會被前面的分支先匹配掉(跟片④ 的 LINE-NONOWNER-COMMIT 記過同一條)。
# 🔴 `payload_hash` 要餵**形狀合法**的值:表上有 CHECK `~ '^[0-9a-f]{64}$'`
#    (`…w0b…:63-64`)。首跑我隨手填 `deadbeef`,三格全紅在那道 CHECK ——
#    格子誠實印了「被擋了但不是那道」而不是假綠,那是設計對了;但也說明
#    **偽造存根本身還要跨一道形狀閘**,不是隨便一列都塞得進來。
forge() {   # $1=action $2=key $3=shipment_id 字面 $4=snapshot 字面 → 印出合併輸出
  # 🔴 `-v VERBOSITY=verbose` 不可省:psql **預設不印 CONSTRAINT 名**,只印訊息文字。
  #    首跑我把 case 錨在 conname 上,兩格全紅在「被擋了但不是那道」—— 斷言其實開火了,
  #    是我讀不到證據(memory `reference_exit-code-provenance-three-traps` 同族:先確認你在讀誰的輸出)。
  #    錨在 conname 而不是中文訊息,是因為訊息會被改、conname 是分派用的契約。
  psql -X -h "$SOCK" -p $P -U postgres -d postgres -qtA -v VERBOSITY=verbose \
    -c "INSERT INTO public.pcm_b2_shipping_idempotency(action,idempotency_key,payload_hash,shipment_id,result_snapshot)
        VALUES ('$1','$2',pg_catalog.encode(pg_catalog.sha256(('forge'||'$2')::bytea),'hex'),$3,'$4'::jsonb);" 2>&1 | tr '\n' ' '
}
# ① 空快照的假收據:shipment_id 指向**真的存在**的包裹,只有快照是空的
FG1="$(forge create_shipment forge-empty-snap "'$SHIP'" '{}')"
case "$FG1" in
  *pcm_b2_w2_stub_snapshot_empty*) ok LINE-STUB-EMPTY-SNAPSHOT "🔴 owner 直寫一筆「既存包裹 + 空快照」的假收據 ⇒ **commit 當下被擋**(pcm_b2_w2_stub_snapshot_empty)= 存根必須是真實動作的產物,不是有鍵就算 ✓" ;;
  *ERROR*)                         bad LINE-STUB-EMPTY-SNAPSHOT "被擋了但不是那道:$FG1" ;;
  *)                               bad LINE-STUB-EMPTY-SNAPSHOT "🔴🔴 **空快照的假收據 commit 成功了** ⇒ 之後同鍵重試會拿到「成功」信封而事情從沒發生。實得:[$FG1]" ;;
esac
# ② 指向不存在包裹的存根:快照非空,但 shipment_id 是憑空的
FG2="$(forge create_shipment forge-dangling "'99999999-9999-9999-9999-999999999999'" '{"a":1}')"
case "$FG2" in
  *pcm_b2_w2_stub_shipment_missing*) ok LINE-STUB-DANGLING "🔴 存根指向不存在的包裹 ⇒ **commit 當下被擋**(pcm_b2_w2_stub_shipment_missing)= 產物存在這件事畫在**表**上,不是只畫在 record() 裡 ✓" ;;
  *ERROR*)                           bad LINE-STUB-DANGLING "被擋了但不是那道:$FG2" ;;
  *)                                 bad LINE-STUB-DANGLING "🔴🔴 **指向不存在包裹的存根 commit 成功了**。實得:[$FG2]" ;;
esac
# ③ 靶:把 trigger 換回**只驗 shipment_id 非 NULL** 的舊版 ⇒ 上面兩格量的東西必須同時翻面。
#    不還原成舊版而只是「拿掉整支 trigger」的話,證的是「有沒有 trigger」而不是「那兩道斷言」。
Q "CREATE OR REPLACE FUNCTION public.pcm_b2_shipping_idem_require_complete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS \$old\$ DECLARE v_sid uuid; BEGIN SELECT shipment_id INTO v_sid FROM public.pcm_b2_shipping_idempotency WHERE action = NEW.action AND idempotency_key = NEW.idempotency_key; IF v_sid IS NULL THEN RAISE EXCEPTION 'old' USING ERRCODE='P2B25', CONSTRAINT='pcm_b2_w2_stub_incomplete_at_commit'; END IF; RETURN NULL; END \$old\$" >/dev/null
MG1="$(forge create_shipment forge-mut-snap "'$SHIP'" '{}')"
MG2="$(forge create_shipment forge-mut-dangling "'99999999-9999-9999-9999-999999999999'" '{"a":1}')"
# 🔴 還原:重跑被測物 migration,並自證換回來了(跟片⑤ 記過:突變不還原 ⇒ 後面的格量到 mutant)
psql -X -h "$SOCK" -p $P -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f "$REPO/supabase/migrations/20260809200000_m4b_e10_b2_w2_stub_verifies_artifact.sql" >/dev/null 2>"$SOCK/restore.err" \
  || die "RESTORE_FAIL(TMUT-STUB-ARTIFACT):被測物 migration 重跑失敗 :: $(cat "$SOCK/restore.err" 2>/dev/null | tr '\n' ' ')"
RST="$(Q "SELECT (pg_catalog.strpos(pg_catalog.pg_get_functiondef('public.pcm_b2_shipping_idem_require_complete()'::regprocedure), 'pcm_b2_w2_stub_snapshot_empty') > 0)::text")"
[ "$RST" = "true" ] || die "RESTORE_FAIL(TMUT-STUB-ARTIFACT):線上函式體不是本尊(錨查得 [$RST])"
# 🔴 R1 N4:`*) ok` 這種 catch-all 會把「forge 根本沒輸出」也讀成成功 = 本 session 一路在清的
#    「空值當成功」。我第一版改成比 `INSERT 0 1`,實跑當場紅 —— **`-qtA` 之下成功的 INSERT
#    什麼都不印**,那個正向訊號根本不存在。⇒ 用**寫入效果**當正向訊號:那兩列真的在表裡。
MGN="$(Q "SELECT pg_catalog.count(*)::text FROM public.pcm_b2_shipping_idempotency WHERE idempotency_key IN ('forge-mut-snap','forge-mut-dangling')")"
case "$MG1$MG2:$MGN" in
  *ERROR*:*) bad TMUT-STUB-ARTIFACT "換回舊版之後竟然還是被擋 ⇒ 上面兩格量到的不是那兩道斷言。空快照=[$MG1] 懸空=[$MG2]" ;;
  *:2)       ok TMUT-STUB-ARTIFACT "🔴 換回「只驗非 NULL」的舊版 ⇒ 兩筆假收據**都 commit 成功且真的躺在鍵表裡**(這就是修之前的世界)= 上面兩格量的真的是新增的那兩道斷言,不是恆真" ;;
  *)         bad TMUT-STUB-ARTIFACT "非預期:沒被擋、但鍵表裡只有 $MGN 筆(期望 2)⇒ 靶自己沒跑到。空快照=[$MG1] 懸空=[$MG2]" ;;
esac
# 🔴 靶那兩筆假收據是**真的 commit 進去了**(那正是它要證的),而且**刪不掉** ——
#    鍵表有 `pcm_b2_shipping_idem_no_purge` 的 BEFORE DELETE trigger,append-only 是刻意設計
#    (`…w0b…:121-139`)。首版我寫了 DELETE + 「清乾淨了嗎」斷言,當場 die ——
#    清理假設本身是錯的,不是清理失敗。
# 🔴 那兩筆對後面的格無害,理由要寫下來、不是「應該沒事」:
#    · 讀鍵表的**計分格**(LINE-IDEM-COMPLETE / LINE-SNAPSHOT-SHAPE)都在第 3 段,**跑在本段之前**;
#    · 第 4 段兩發讀鍵表的靶(TMUT-IDEM-COMPLETE / TMUT-SNAPSHOT-SHAPE)逐字濾 `idempotency_key LIKE 'e2e-%'`。
#    ⇒ 改成釘住「殘留的就是我預期的那兩筆」:多了或換了鍵,代表有人加了新的偽造而沒想到這件事。
FGLEFT="$(Q "SELECT coalesce(pg_catalog.string_agg(idempotency_key, ',' ORDER BY idempotency_key),'(無)') FROM public.pcm_b2_shipping_idempotency WHERE idempotency_key LIKE 'forge-%'")"
[ "$FGLEFT" = "forge-mut-dangling,forge-mut-snap" ] \
  || die "FORGE_RESIDUE_UNEXPECTED:鍵表裡的假收據不是預期的那兩筆(實得 [$FGLEFT])⇒ append-only 刪不掉,後面的格可能量到被污染的鍵表,停"

# ══ 🔴 W7 跟片④(2026-08-09,B-227 MF-2/MF-3)兩格 ══════════════
# 🔴 MF-2(oracle 缺口):作廢原本只驗「摘要 3→0」—— 那只證了**退量的數字**動了,
#    沒證**員工真的能重新裝箱**。W3-2 的可出量算式若忘了排除已作廢的箱,
#    整條線照樣全綠、而現場的人打不開新箱。這是各片自己看不到的跨片不變式。
# 🔴 **本格用自己的品項與自己的兩個箱子,完全不碰 E2E 那條線的 SHIP / OI1 / OI2。**
#    兩次踩過才寫下這條:①第一版拿 SHIP 來作廢 ⇒ 它留在作廢態,下游 `TMUT-23505-TRANSLATED`
#    的前提(箱還活著、同箱補掛會撞唯一鍵)被我毀掉、當場誤紅;②改排到突變靶之後也不行 ——
#    本檔突變靶段自己寫著兩支被換成殘廢版、**單向不還原**(見 `TMUT-23505-TRANSLATED` 那段對
#    `admin_create_shipment` 的說明、與 `TMUT-W4B-HELPERS` 那段對 `admin_add_shipment_items`
#    的說明;不寫行號,行號會被後續編輯推移。R2 A4:第一版我指到 `TMUT-RPC-SET`,那段查無)
#    ⇒ 行為格放那裡建不出箱子。
#    ⇒ 隔離自己的 fixture 才是對的落點,不是搬位置。
OI3='bbbbbbbb-0000-0000-0000-000000000003'
Q "INSERT INTO public.order_items(id,order_id,variant_sku,product_snapshot,quantity,unit_price,line_total) VALUES('$OI3','$ORD','SKU-3','$PSNAP'::jsonb,10,10,100)" >/dev/null
PID3="$(Q "INSERT INTO public.order_item_procurement(order_item_id,allocated_quantity,supplier_id) VALUES('$OI3',10,'$SUPP') RETURNING id")"
Q "INSERT INTO public.order_item_procurement_receipts(procurement_id,quantity,received_at,received_by) VALUES('$PID3',5,now(),'tester')" >/dev/null
IN3="$(Q "SELECT coalesce(pg_catalog.max(instock_quantity)::text,'(無列)') FROM public.order_item_quantity_summary WHERE order_item_id='$OI3'")"
BOXA="$(Q "SELECT ('$(Q "SELECT public.admin_create_shipment('vr-1','$CUST','$SNAP'::jsonb,'hct')")'::jsonb ->> 'shipment_id')")"
if [ "$IN3" != "5" ] || case "$BOXA" in ????????-*) false ;; *) true ;; esac; then
  bad LINE-VOID-REOPEN "🔴 本格的**前置**沒成立(OI3 instock=[$IN3] 期望 5 / 舊箱=[$BOXA])⇒ 這不是可用量的結論"
else
  # 🔴 數量刻意選 **5 = instock 全量**:舊箱那 5 件若還被算成 pending,可出量會是 0,
  #    下面那一發就會被 P2B27 擋下。🔴 要恆真得**兩邊都改小**(舊箱只裝 1、新箱只要 1)——
  #    只改新箱那一邊不會恆真(舊箱仍佔 5、可用量一樣是 0)。R1 nit:原句沒寫清楚是哪一邊。
  Q "SELECT public.admin_add_shipment_items('vr-2','$BOXA','[{\"order_item_id\":\"$OI3\",\"quantity\":5}]'::jsonb)" >/dev/null 2>&1
  # 🔴 R1 F1:這一發是**唯一製造「舊箱佔量」的動作**,原本零斷言 —— 它若失敗,BOXA 是空箱、
  #    作廢照樣成功、新箱自然裝得下 ⇒ 本格全綠而什麼都沒證(fixture 沒成立被讀成守門成立)。
  #    其餘四個前置我都寫了自證,唯獨漏掉最關鍵的這個。
  FILLED="$(Q "SELECT coalesce(pg_catalog.string_agg(shipped_quantity::text,','),'(無)') FROM public.shipment_items WHERE shipment_id='$BOXA' AND order_item_id='$OI3'")"
  Q "SELECT public.admin_void_shipment('vr-3','$BOXA','線級 oracle:作廢後要能重開')" >/dev/null 2>&1
  VOIDED="$(Q "SELECT (deleted_at IS NOT NULL)::text FROM public.shipments WHERE id='$BOXA'")"
  BOXB="$(Q "SELECT ('$(Q "SELECT public.admin_create_shipment('vr-4','$CUST','$SNAP'::jsonb,'hct')")'::jsonb ->> 'shipment_id')")"
  if [ "$FILLED" != "5" ] || [ "$VOIDED" != "true" ] || case "$BOXB" in ????????-*) false ;; *) true ;; esac; then
    bad LINE-VOID-REOPEN "🔴 本格的**前置**沒成立(舊箱裝入=[$FILLED] 期望 5 / 舊箱作廢=[$VOIDED] / 新箱=[$BOXB])⇒ 這不是可用量的結論"
  else
    CVR="$(cap "public.admin_add_shipment_items('vr-5','$BOXB','[{\"order_item_id\":\"$OI3\",\"quantity\":5}]'::jsonb)")"
    WVR="$(Q "SELECT coalesce(pg_catalog.string_agg(shipped_quantity::text,','),'(無)') FROM public.shipment_items WHERE shipment_id='$BOXB' AND order_item_id='$OI3'")"
    case "$CVR:$WVR" in
      :5) ok LINE-VOID-REOPEN "🔴 舊箱作廢後**重開新箱裝得下全量 5 件**(且真的寫進去)⇒ W3-2 的可出量算式有把已作廢的箱排除掉 = 員工真的能重新裝箱 ✓" ;;
      *)  bad LINE-VOID-REOPEN "重開新箱實得 例外=[${CVR:-無}] 寫入=[$WVR](期望 無例外 + 5)⇒ 已作廢的箱仍被當成佔用量" ;;
    esac
  fi
fi
# 🔴 R1 F7:新守門自己要有靶(檔頭判準四句第二條)。**靶放在這裡不放第 4 段** ——
#    第 4 段之後 `admin_create_shipment` 是殘廢版,行為靶在那裡建不出箱子(上面記過同一個坑)。
#    消融方式:此刻 BOXB 是**活著的**箱、裡面就是那 5 件 ⇒ 再開一箱要同樣 5 件必須被擋。
#    若擋不住,代表可出量對「活著的箱佔用」也沒反應 ⇒ 上面那格的綠沒有意義。
# 🔴 R2 A6:用 uuid 形狀判斷,不只擋空字串 —— `Q` 會把錯誤字串併回 stdout(非空)。
case "${BOXB:-}" in ????????-*) BOXB_OK=1 ;; *) BOXB_OK=0 ;; esac
if [ "$BOXB_OK" = "0" ]; then
  bad TMUT-VOID-REOPEN "🔴 前置沒成立(沒有 BOXB 可用)⇒ 這不是判別力的結論"
else
  BOXD="$(Q "SELECT ('$(Q "SELECT public.admin_create_shipment('vr-mut','$CUST','$SNAP'::jsonb,'hct')")'::jsonb ->> 'shipment_id')")"
  CMD="$(cap "public.admin_add_shipment_items('vr-mut2','$BOXD','[{\"order_item_id\":\"$OI3\",\"quantity\":5}]'::jsonb)")"
  # 🔴 R3(換模型換角度)must-fix:本格原本**只有一句結論**「⇒ 那格恆真」。
  #    但這一格會紅有**兩種完全相反的世界**,而原本的訊息把它們講成同一件事:
  #      (a) 產品端的可出量守門整個死掉 ⇒ 線上真的可以超裝。這時全檔**只有本格會紅**
  #          (LINE-VOID-REOPEN 照綠 —— 新箱當然裝得下),而訊息卻叫人去修 harness。
  #      (b) 靶自己失效(例如 BOXD 沒建成、品項不對)⇒ 才是「這格恆真」。
  #    災難當天讀到 (a) 卻被導去改測試 = 本 repo 記過的「教錯動作」家族。⇒ 拆句,並用
  #    「有沒有真的寫進去」把兩個世界分開:放行**且寫入 5** = 守門死了,那是產品端的事。
  WMD="$(Q "SELECT coalesce(pg_catalog.string_agg(shipped_quantity::text,','),'(無)') FROM public.shipment_items WHERE shipment_id='$BOXD' AND order_item_id='$OI3'")"
  case "$CMD:$WMD" in
    "P2B27|pcm_b2_w3b2_exceeds_instock:(無)")
      ok TMUT-VOID-REOPEN "🔴 同樣 5 件、但佔用它的箱**活著**時 ⇒ 當場被 P2B27 擋下且零寫入 = LINE-VOID-REOPEN 量的真的是可出量,不是恆真" ;;
    ":5")
      bad TMUT-VOID-REOPEN "🔴🔴 **這不是測試的問題,是產品端的問題**:活箱已佔滿 5 件,再開一箱要 5 件竟然**放行且真的寫進去** ⇒ W3-2 的可出量守門失效、線上可超裝。**去修 admin_add_shipment_items,不要動這格。**" ;;
    *)
      bad TMUT-VOID-REOPEN "靶自己沒成立:實得 例外=[${CMD:-無}] 寫入=[$WMD](期望 P2B27 + 零寫入)⇒ 先確認 BOXD 與品項是不是我以為的那個,再談判別力" ;;
  esac
fi
# 🔴 MF-3(守門窄):原本 fail-closed 斷言只驗 signature 與 ACL ——
#    **提權邊界**(owner / SECURITY DEFINER / search_path / lock_timeout)整組沒人看,
#    而本 harness 以 postgres 跑 ⇒ 就算漂掉也全綠。ACL 對了不代表這四件對:
#    少 `SECURITY DEFINER` = RPC 直接失效;`search_path` 不是空字串 = 可被搜尋路徑挾持;
#    少 `lock_timeout` = 卡死不放手。四件都在 `pg_proc` 上讀得到,與跑的人是誰無關。
#    🔴 R1 F5:第一版寫 `LIKE 'lock_timeout=%'` —— 那**收得下 `lock_timeout=0`(等於關掉逾時)**,
#       正好是本註解自己說的失敗情境。「規則存在」不等於「它做了什麼」⇒ 改比實際值 `5s`。
#       🔴 R2 A5:未來哪片合理地改成別的值時,處置是**回來重釘這個字面**,不是放寬成 `LIKE`
#          —— 放寬會同時收下 `0` 與 `1ms`,那正是本格要擋的東西。
#    🔴 `SET search_path = ''` 在 `proconfig` 裡存成 **`search_path=""`(帶兩個引號)**,不是 `search_path=`
#       —— 首跑我照後者比,五支全紅;是我把實際值一起印進失敗訊息才看到。診斷輸出保留著。
SDBAD=""
for fn in $(printf '%s' "$FIVE" | tr ',' ' '); do
  V="$(Q "SELECT p.prosecdef::text||':'||(EXISTS (SELECT 1 FROM pg_catalog.unnest(coalesce(p.proconfig,ARRAY[]::text[])) c WHERE c = 'search_path=\"\"'))::text||':'||(EXISTS (SELECT 1 FROM pg_catalog.unnest(coalesce(p.proconfig,ARRAY[]::text[])) c WHERE c = 'lock_timeout=5s'))::text||':'||coalesce(pg_catalog.array_to_string(p.proconfig,'|'),'(null)') FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='$fn'")"
  case "$V" in true:true:true:*) : ;; *) SDBAD="$SDBAD $fn($V)" ;; esac
done
# 🔴 owner 在裸 PG 一律是 postgres ⇒ 「等於 postgres」是恆真、零判別力。改問**五支彼此一致**:
#    有片被別的角色 CREATE OR REPLACE 掉,這格會紅,而那條在單片 harness 裡看不見。
OWN="$(Q "SELECT pg_catalog.count(DISTINCT p.proowner)::text FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname = ANY(pg_catalog.string_to_array('$FIVE',','))")"
{ [ -z "$SDBAD" ] && [ "$OWN" = "1" ]; } \
  && ok LINE-WRITER-SECDEF "五支 writer 逐支:**SECURITY DEFINER + search_path='' + lock_timeout 都在**,且五支 owner 一致(1 個)⇒ 提權邊界漂掉會紅在這裡(ACL 那格對此全盲)✓" \
  || bad LINE-WRITER-SECDEF "提權邊界漂了:${SDBAD:-(逐支屬性 OK)} / owner 有 $OWN 種"
# 🔴 R1 F6/F7:owner 那半原本是**換個形狀的恆真** —— 全部 migration 都以 `-U postgres` 重放、
#    樹裡的 `ALTER FUNCTION … OWNER TO` 一律指向 postgres ⇒ `count(DISTINCT)` 構造不出 2。
#    ⇒ 不用文字辯解,直接把它做成可構造的靶:兩條腿各打一個屬性(家族格的靶不得只打一個成員)。
Q "ALTER FUNCTION public.admin_void_shipment(text,uuid,text) RESET search_path" >/dev/null
MSP="$(Q "SELECT (EXISTS (SELECT 1 FROM pg_catalog.unnest(coalesce(p.proconfig,ARRAY[]::text[])) c WHERE c = 'search_path=\"\"'))::text FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='admin_void_shipment'")"
Q "ALTER FUNCTION public.admin_void_shipment(text,uuid,text) SET search_path = ''" >/dev/null
Q "ALTER FUNCTION public.admin_void_shipment(text,uuid,text) OWNER TO service_role" >/dev/null
MOW="$(Q "SELECT pg_catalog.count(DISTINCT p.proowner)::text FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname = ANY(pg_catalog.string_to_array('$FIVE',','))")"
Q "ALTER FUNCTION public.admin_void_shipment(text,uuid,text) OWNER TO postgres" >/dev/null
# 🔴 R2 A3:owner 來回會不會把 `service_role=X/postgres` 那條 grant 合併吃掉?
#    審查者跑不了 cluster、只能推理;我實測並把答案印在本格訊息裡(下面 MACL 就是量到的值)。
#    重點在:能抓這件事的 `LINE-RPC-ACL` 跑在突變**之前** ⇒ 真被吃掉的話本檔零格會紅
#    (memory `feedback_fix-that-moves-gate-earlier-erases-evidence` 同族)。⇒ 這裡自己驗、自己補。
# 🔴 **實測結果(不是推理)**:owner 來回之後 grantee 變成 `(無)` —— `service_role=X/postgres`
#    那條 grant 真的被 `aclnewowner` 的合併吃掉了。⇒ 必須補回,否則本靶自己會留下一個
#    「ACL 少一條」的世界給後面的格,而唯一抓得到的 `LINE-RPC-ACL` 早就跑完了。
Q "GRANT EXECUTE ON FUNCTION public.admin_void_shipment(text,uuid,text) TO service_role" >/dev/null
MACL="$(Q "SELECT coalesce(pg_catalog.string_agg(DISTINCT coalesce(r.rolname,'PUBLIC'), ',' ORDER BY coalesce(r.rolname,'PUBLIC')),'(無)') FROM pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a LEFT JOIN pg_catalog.pg_roles r ON r.oid = a.grantee WHERE p.proname='admin_void_shipment' AND a.grantee <> p.proowner")"
# 🔴 R2 A2:第一版的還原斷言寫成 `… GROUP BY p.proconfig LIMIT 1` —— 那對 owner 那半**恆真**:
#    RESET+SET 之後那支的 proconfig 順序變成 {lock_timeout, search_path}、其餘四支是 {search_path,
#    lock_timeout} ⇒ 分成兩群、每群 count(DISTINCT proowner) 都是 1,**owner 沒還原也照樣回 true:1**;
#    `LIMIT 1` 又沒有 ORDER BY,選到哪一群還不確定。⇒ 拆成兩個各自獨立的觀察。
RSP1="$(Q "SELECT (EXISTS (SELECT 1 FROM pg_catalog.unnest(coalesce(p.proconfig,ARRAY[]::text[])) c WHERE c = 'search_path=\"\"'))::text FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='admin_void_shipment'")"
RSP2="$(Q "SELECT pg_catalog.count(DISTINCT p.proowner)::text FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname = ANY(pg_catalog.string_to_array('$FIVE',','))")"
RSP="$RSP1:$RSP2"
{ [ "$MSP" = "false" ] && [ "$MOW" = "2" ] && [ "$RSP" = "true:1" ] && [ "$MACL" = "service_role" ]; } \
  && ok TMUT-WRITER-SECDEF "🔴 兩條腿各打一個屬性:RESET search_path ⇒ 翻 false;OWNER 改給別的角色 ⇒ owner 變 2 種;**還原後兩者都回來**(search_path=$RSP1 / owner 種類=$RSP2),**且 owner 來回沒有吃掉 ACL**(實測 grantee 仍是 [$MACL])= 這格對兩面都有判別力、owner 那半不是恆真" \
  || bad TMUT-WRITER-SECDEF "消融沒翻面或沒還原乾淨:search_path=[$MSP](期望 false)/ owner=[$MOW](期望 2)/ 還原後=[$RSP](期望 true:1)/ 來回後 grantee=[$MACL](期望 service_role)"

echo "══ 4. 🔴 突變靶 ═══════════════════════════════════════════"
# ① 結構 oracle 族:多長一支同名族的函式 ⇒ 集合格必須紅
Q "CREATE FUNCTION public.admin_bogus_shipment_x() RETURNS int LANGUAGE sql AS 'SELECT 1'" >/dev/null
M="$(Q "SELECT pg_catalog.string_agg(p.proname, ',' ORDER BY p.proname) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'admin\_%shipment%'")"
[ "$M" != "$FIVE" ] && ok TMUT-RPC-SET "🔴 多長一支 ⇒ RPC 集合真的變了 = LINE-RPC-SET 抓得到「多一支」" || bad TMUT-RPC-SET "集合沒變 ⇒ 恆真"
Q "DROP FUNCTION public.admin_bogus_shipment_x()" >/dev/null
# ② trigger 啟用態族:把一發改成 ORIGIN ⇒ 凍結格必須紅
Q "ALTER TABLE public.pcm_b2_shipping_idempotency ENABLE REPLICA TRIGGER pcm_b2_shipping_idem_block_delete" >/dev/null
M="$(trgstate)"
[ "$M" != "$TRG_EXP" ] && ok TMUT-TRIGGER-STATE "🔴 把一發 trigger 改成 REPLICA ⇒ 啟用態真的變了 = LINE-IDEM-TRIGGERS 抓得到「被降級」" || bad TMUT-TRIGGER-STATE "啟用態沒變 ⇒ 恆真"
Q "ALTER TABLE public.pcm_b2_shipping_idempotency ENABLE ALWAYS TRIGGER pcm_b2_shipping_idem_block_delete" >/dev/null
# ③ helper ACL 族:**逐支**打(家族格的靶不得只打一個成員)
ABAD=""
for fn in $(printf '%s' "$HELPERS_EXP" | tr ',' ' '); do
  SIG="$(Q "SELECT p.oid::regprocedure::text FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='$fn'")"
  # 🔴 例外那兩支基準就是 4(anon 已在內)⇒ 對它們改用 `REVOKE 一個角色`當突變,方向相反、一樣翻面。
  case " $ACL_EXEMPT " in
    *" $fn "*)
      Q "REVOKE ALL ON FUNCTION $SIG FROM anon" >/dev/null
      G="$(Q "SELECT pg_catalog.count(*)::text FROM pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a WHERE p.proname='$fn' AND a.grantee <> p.proowner")"
      [ "$G" = "3" ] || ABAD="$ABAD $fn(REVOKE 後應為 3,實得 $G)"
      Q "GRANT EXECUTE ON FUNCTION $SIG TO anon" >/dev/null ;;
    *)
      Q "GRANT EXECUTE ON FUNCTION $SIG TO anon" >/dev/null
      G="$(Q "SELECT pg_catalog.count(*)::text FROM pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a WHERE p.proname='$fn' AND a.grantee <> p.proowner")"
      [ "$G" = "1" ] || ABAD="$ABAD $fn($G)"
      Q "REVOKE ALL ON FUNCTION $SIG FROM anon" >/dev/null ;;
  esac
done
[ -z "$ABAD" ] && ok TMUT-HELPER-ACL "🔴 **十支逐一** GRANT ⇒ 每支的觀察值都翻面 = 零 GRANT 那族整族有判別力" || bad TMUT-HELPER-ACL "有成員不敏感:$ABAD"
# ③-b 🔴 W4-2 兩個新不變量的靶(F3 同批補;沒有靶的話上面兩格只是「看起來有守」)
Q "ALTER TABLE public.shipments ENABLE REPLICA TRIGGER shipments_no_batch_update_as" >/dev/null
M="$(nbstate)"
[ "$M" != "A" ] && ok TMUT-NOBATCH-TRIGGER "🔴 把禁批次那發降成 REPLICA ⇒ 啟用態真的變了(實得 [$M])= LINE-NOBATCH-TRIGGER 抓得到「被降級」" || bad TMUT-NOBATCH-TRIGGER "降級後啟用態沒變 ⇒ 該格恆真"
Q "ALTER TABLE public.shipments ENABLE ALWAYS TRIGGER shipments_no_batch_update_as" >/dev/null
# 🔴 **草稿箱**(E2E 那個已出貨,補掛會先撞 frozen_after_ship、走不到 23505)。本段必須排在 ④ 之前:
#    ④ 會把 admin_create_shipment 換成回空信封的殘廢版,之後就建不出箱子了。
MBOX="$(Q "SELECT ('$(Q "SELECT public.admin_create_shipment('mut-2a','$CUST','$SNAP'::jsonb,'hct')")'::jsonb ->> 'shipment_id')")"
case "$MBOX" in ????????-*) : ;; *) die "MUT_FIXTURE_FAIL(mbox): $MBOX" ;; esac
Q "SELECT public.admin_add_shipment_items('mut-2b','$MBOX','[{\"order_item_id\":\"$OI1\",\"quantity\":1}]'::jsonb)" >/dev/null
# 🔴 **首跑實錘**:直接打同一箱同一品項,紅的是 **P2B27(超過到貨量)** 不是 23505 ——
#    OI1 的 instock=4、E2E 已出 3、草稿箱又佔 1 ⇒ 可用量 0,**前緣先擋、根本走不到 UNIQUE**。
#    ⇒ 突變要打的那條路必須先通:補一筆到貨讓 instock 到 10,可用量才夠。
#    (這正是判準四句第三條:「我的 SQL 寫壞了」不得與「被別的守門擋住」共用同一句結論。)
Q "INSERT INTO public.order_item_procurement_receipts(procurement_id,quantity,received_at,received_by) SELECT id,6,now(),'mut' FROM public.order_item_procurement WHERE order_item_id='$OI1'" >/dev/null
# 🔴 把薄封裝換成「沒有 handler 的封裝」⇒ 轉譯格必須翻回 raw 23505(形狀照 ④ TMUT-E2E)
Q "CREATE OR REPLACE FUNCTION public.admin_add_shipment_items(p_idempotency_key text, p_shipment_id uuid, p_items jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS \$m\$ BEGIN RETURN public.pcm_b2_add_items_impl(p_idempotency_key, p_shipment_id, p_items); END \$m\$" >/dev/null
M="$(cap "public.admin_add_shipment_items('mut-2c','$MBOX','[{\"order_item_id\":\"$OI1\",\"quantity\":1}]'::jsonb)")"
case "$M" in
  23505*) ok TMUT-23505-TRANSLATED "🔴 拿掉薄封裝的 handler ⇒ 同箱補掛**又變回 raw 23505**(實得 [$M])= LINE-23505-TRANSLATED 有判別力" ;;
  *)      bad TMUT-23505-TRANSLATED "拿掉 handler 後實得 [$M] ⇒ 那格守的不是這段" ;;
esac
# 🔴 helper ACL 那兩支同樣逐支打(家族格的靶不得只打一個成員)
WMBAD=""
for fn in $(printf '%s' "$W4B_FN" | tr ',' ' '); do
  SIG="$(Q "SELECT p.oid::regprocedure::text FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='$fn'")"
  Q "GRANT EXECUTE ON FUNCTION $SIG TO anon" >/dev/null
  G="$(Q "SELECT pg_catalog.count(*)::text FROM pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a WHERE p.proname='$fn' AND a.grantee <> p.proowner")"
  [ "$G" = "1" ] || WMBAD="$WMBAD $fn($G)"
  Q "REVOKE ALL ON FUNCTION $SIG FROM anon" >/dev/null
done
# 🔴 **此後 `admin_add_shipment_items` 是殘廢版(無 handler)**,與 ④ 之後的 `admin_create_shipment` 同樣單向不還原。
#    現行後續格只讀 ACL / regprocedure,不受影響;**再往後加格的人請先還原或另建 fixture**。
[ -z "$WMBAD" ] && ok TMUT-W4B-HELPERS "🔴 **兩支逐一** GRANT ⇒ 觀察值都翻面 = LINE-W4B-HELPERS 有判別力" || bad TMUT-W4B-HELPERS "有成員不敏感:$WMBAD"

# ④ 端到端族:把建箱換成靜默回傳 ⇒ E2E 那族必須看得出來
Q "CREATE OR REPLACE FUNCTION public.admin_create_shipment(p_idempotency_key text, p_customer_user_id uuid, p_recipient_snapshot jsonb, p_carrier_code text, p_carrier_note text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS \$m\$ BEGIN RETURN '{}'::jsonb; END \$m\$" >/dev/null
M="$(Q "SELECT ('$(Q "SELECT public.admin_create_shipment('mut-1','$CUST','$SNAP'::jsonb,'hct')")'::jsonb ->> 'shipment_id')")"
[ -z "$M" ] && ok TMUT-E2E "🔴 把建箱換成靜默回空信封 ⇒ 拿不到 shipment_id(E2E-CREATE 的「前一步沒成立」分支會接手)= 端到端那族不會把失敗讀成成功" \
            || bad TMUT-E2E "換成空信封後仍拿到 [$M] ⇒ E2E 族量錯東西"

# ⑤ 🔴 跨模型審查 F2:`LINE-RPC-ACL` 原本**零靶** ⇒ 逐五支打(家族格的靶不得只打一個成員)
RBAD=""
for fn in $(printf '%s' "$FIVE" | tr ',' ' '); do
  SIG="$(Q "SELECT p.oid::regprocedure::text FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='$fn'")"
  Q "GRANT EXECUTE ON FUNCTION $SIG TO anon" >/dev/null
  V="$(Q "SELECT has_function_privilege('anon','$SIG','EXECUTE')::text")"
  [ "$V" = "true" ] || RBAD="$RBAD $fn($V)"
  Q "REVOKE ALL ON FUNCTION $SIG FROM anon" >/dev/null
done
[ -z "$RBAD" ] && ok TMUT-RPC-ACL "🔴 **五支逐一** GRANT 給 anon ⇒ 每支的觀察值都翻面 = LINE-RPC-ACL 整族有判別力" || bad TMUT-RPC-ACL "有成員不敏感:$RBAD"
# ⑥ 🔴 F2:第 3 節的線級不變式原本整族零靶 ⇒ 補兩發(各自只動自己那一格要看的東西)
# 🔴🔴 **R2 抓到的恆真(本片自己造的)**:③-b 為了構造 23505 建了 `mut-2a` / `mut-2b` 兩把鍵,
#    它們成功後各寫一列進鍵表 ⇒ 到這裡鍵表是**七列、action 重複**,`M` 在突變**還沒生效前**就已 ≠ 五列基準
#    ⇒ 下面兩格雙雙**恆真**(綠不反證)。這正是 12 行前那段註解記過的坑再犯一次,這次來源是 fixture 不是期望值。
#    ⇒ 兩格的觀察範圍一律收成 `idempotency_key LIKE 'e2e-%'`(只看端到端那五把鍵),與突變段的 fixture 隔離。
Q "ALTER TABLE public.pcm_b2_shipping_idempotency DISABLE TRIGGER pcm_b2_shipping_idem_block_identity_update" >/dev/null
Q "UPDATE public.pcm_b2_shipping_idempotency SET shipment_id = NULL WHERE action='ship' AND idempotency_key LIKE 'e2e-%'" >/dev/null
M="$(Q "SELECT pg_catalog.string_agg(action||':'||(shipment_id IS NOT NULL)::text, ',' ORDER BY action) FROM public.pcm_b2_shipping_idempotency WHERE idempotency_key LIKE 'e2e-%'")"
# 🔴🔴 **跨模型審查 F1**:我把 `LINE-IDEM-COMPLETE` 的期望值從三列改成四列,
#    **卻沒改它配對的這個靶** ⇒ 基準字串還是舊三列,而鍵表現在恆有四列
#    ⇒ `M != 舊三列` **恆真**,突變就算完全沒生效本格照樣綠 = 判別力歸零。
#    改斷言就要改它的靶,這兩個是一對。
[ "$M" != "add_items:true,create_shipment:true,ship:true,unvoid:true,void:true" ] \
  && ok TMUT-IDEM-COMPLETE "🔴 把一列的 shipment_id 打回 NULL ⇒ 觀察值真的變了(實得 [$M])= LINE-IDEM-COMPLETE 抓得到半成品" \
  || bad TMUT-IDEM-COMPLETE "打回 NULL 後觀察值沒變 ⇒ 該格恆真"
Q "UPDATE public.pcm_b2_shipping_idempotency SET result_snapshot = '{\"only_one_key\":1}'::jsonb WHERE action='ship' AND idempotency_key LIKE 'e2e-%'" >/dev/null
M="$(Q "SELECT pg_catalog.count(DISTINCT k)::text FROM (SELECT pg_catalog.string_agg(key,',' ORDER BY key) AS k FROM public.pcm_b2_shipping_idempotency i, pg_catalog.jsonb_object_keys(i.result_snapshot) key WHERE i.idempotency_key LIKE 'e2e-%' GROUP BY i.action) t")"
[ "$M" != "1" ] \
  && ok TMUT-SNAPSHOT-SHAPE "🔴 把一支的快照改成別的鍵集合 ⇒ 形狀種類數變成 $M = LINE-SNAPSHOT-SHAPE 抓得到「有片自己漂了」" \
  || bad TMUT-SNAPSHOT-SHAPE "改了鍵集合之後種類數仍是 1 ⇒ 該格恆真"
# 🔴 `LINE-REPLAY-NO-GROWTH` **沒有靶,而且我窮舉過維度才這樣寫**(不是懶):
#    要讓它翻面得讓「同鍵重放真的長出產物」,而擋住那件事的**不只冪等層** ——
#    ①claim 回 NULL ⇒ record() 撞 W0b 的 freeze_identity(改指別箱)整筆回滾
#    ②連 freeze 一起拆 ⇒ add_items 撞 S1b 的 UNIQUE(同箱同品項)整筆回滾
#    ③再拆 UNIQUE ⇒ 拆到這一步,被測的已經不是這條線了
#    ⇒ 它是**被多層嚴格蘊含**的格(memory `feedback_unconstructible-negative-test-means-noop-guard`)。
#    誠實結論:它證的是「端到端的 at-most-once 成立」這個**結果**,不獨占任何一層的歸屬。
Q "ALTER TABLE public.pcm_b2_shipping_idempotency ENABLE ALWAYS TRIGGER pcm_b2_shipping_idem_block_identity_update" >/dev/null

echo "══ 5. 覆蓋帳 ══════════════════════════════════════════════"
TOT=$((PASS+FAIL))
if [ "$TOT" = "$EXPECT_TOTAL" ]; then
  printf '  PASS %-34s %s\n' "CELL-ACCOUNT" "格數 $TOT = 凍結值 $EXPECT_TOTAL"; PASS=$((PASS+1))
else
  printf '  FAIL %-34s %s\n' "CELL-ACCOUNT" "格數 $TOT != 凍結值 $EXPECT_TOTAL"; FAIL=$((FAIL+1))
fi
DUP="$(printf '%s' "$KEYS" | tr ' ' '\n' | grep -v '^$' | sort | uniq -d | tr '\n' ' ')"
[ -z "$DUP" ] || { printf '  FAIL %-34s %s\n' "CELL-DUP" "重複格名 [$DUP]"; FAIL=$((FAIL+1)); }
KEYS_NOW="$(printf '%s' "$KEYS" | tr ' ' '\n' | grep -v '^$' | sort | tr '\n' ' ' | sed 's/ *$//')"
KEYS_FROZEN="E2E-ADD E2E-CREATE E2E-SHIP E2E-SUMMARY E2E-UNVOID E2E-VOID LINE-23505-TRANSLATED LINE-HELPER-ACL LINE-HELPER-SET LINE-IDEM-COMPLETE LINE-IDEM-TRIGGERS LINE-LEDGER-WRITE-SURFACE LINE-NOBATCH-TRIGGER LINE-NONOWNER-COMMIT LINE-REPLAY LINE-REPLAY-NO-GROWTH LINE-RPC-ACL LINE-RPC-SET LINE-SNAPSHOT-SHAPE LINE-STUB-DANGLING LINE-STUB-EMPTY-SNAPSHOT LINE-VOID-REOPEN LINE-W4B-HELPERS LINE-WRITER-SECDEF TMUT-23505-TRANSLATED TMUT-E2E TMUT-HELPER-ACL TMUT-IDEM-COMPLETE TMUT-LEDGER-WRITE-SURFACE TMUT-NOBATCH-TRIGGER TMUT-NONOWNER-COMMIT TMUT-RPC-ACL TMUT-RPC-SET TMUT-SNAPSHOT-SHAPE TMUT-STUB-ARTIFACT TMUT-TRIGGER-STATE TMUT-VOID-REOPEN TMUT-W4B-HELPERS TMUT-WRITER-SECDEF"
if [ "$KEYS_NOW" = "$KEYS_FROZEN" ]; then
  printf '  PASS %-34s %s\n' "CELL-KEYSET" "格名集合逐字符合凍結清單"; PASS=$((PASS+1))
else
  printf '  FAIL %-34s %s\n' "CELL-KEYSET" "格名集合漂了:[$KEYS_NOW]"; FAIL=$((FAIL+1))
fi

# 🔴 原本這裡有一份行內收尾;已交給 EXIT 的 trap teardown,避免兩條收尾路徑各走各的。
echo
# 🔴 **不再印 TCP「埠殘留」** —— server 只開 unix socket(listen_addresses=)⇒ TCP 恆 0、零判別力。
#    真正的殘留檢查在 teardown(EXIT 時跑、停完才量、量不到 0 就保留 datadir 並印警告)。
echo "════ PASS=$PASS FAIL=$FAIL ════  (殘留檢查見下一行 teardown 輸出)"

# 🔴🔴 **結束碼守門(跨模型審查 F1;家族回歸)**:少了這行,`FAIL>0` 時結束碼仍是 0
#    ⇒ 任何 `&&` 鏈、preflight、收割腳本都會把**紅跑讀成綠**。
#    `w0b-verify.sh` / `w1-verify.sh`(前一個 session 寫的)本來就有這道;
#    我從 `w2-verify.sh` 開始漏掉,然後一路複製到 w3a/w3b2/w3c3/w5 —— **五支全中**。
[ "$FAIL" -eq 0 ] || exit 1
