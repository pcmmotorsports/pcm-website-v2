#!/bin/bash
# ============================================================
# L5a-M verify:`20260809230000` 三欄 + 五條 CHECK 的判別力,以及「本片零行為」這句宣稱。
#
# 用法:scripts/l5am-verify.sh   (自建拋棄式 cluster、跑完自動 teardown;不碰任何正式庫)
# 真權威:母 plan docs/specs/2026-08-09-l4-l5-settlement-compensation-plan.md §3.1/§3.2/§7-2
#         + 片級 plan P-280-STOP §5 + 主視窗核准 P-282-A。
#
# 🔴 **前綴重放**:PREFIX_TS = 被測物自己。只重放 TS < 被測物 的前綴,被測物最後才套。
#
# 🔴 本檔證的是「約束擋得住壞資料」,不是「約束寫上去了」。
#    `pg_constraint` 查得到某個名字 = 存在性斷言,對「還在但條件寫錯」全盲。
#    ⇒ 每條約束配一個**只有它會拒絕**的資料格,再配一發突變(DROP)驗那格會翻。
#
# 🔴 codex 關卡2 R1 抓到的三個 harness 缺陷,本版逐條補(每條都標了 R1 代號):
#    · R1-F6:DROP 突變抓不到「名字還在、述詞被放寬」⇒ 新增 DEF-PIN(釘正規化約束定義的 md5)
#             + MUT-DEFDRIFT(裝一條同名但放寬的述詞,證明 DEF-PIN 會紅、而 7 格**負向**矩陣全盲)。
#             (R3 N-2 校正:MUT-DEFDRIFT 重放的是 run_neg_matrix 的 7 格負向格,不是 14 格全矩陣。)
#    · R1-F7:EXPECT_TOTAL 只數次數、不驗身分 ⇒ 改成 label manifest 逐字比對(少一格/重複一格都紅)。
#    · R1-F5:DORMANT 只掃 public.pg_proc.prosrc,對「migration 直接 DML / DO 區塊」全盲
#             ⇒ 縮窄成「未新增任何 DB writer 物件」(函式+trigger+rule 套前套後比對)
#             + STATIC-NO-DML(直接對 migration 檔做語句白名單,擋 DML/DO/CREATE FUNCTION|TRIGGER|RULE)。
#
# ⚠️ 本檔證不到的:L5a-1 之後真的會**正確地**寫這三欄(那是 L5a-1 自己的 harness),
#    以及 L5b 真的會**只認** superseded_at(那是 L5b 自己的 harness)。
#    本檔只證「地基的形狀對、擋得住半套資料、且現在還沒有人在用它」。
# ============================================================
set -u
export LC_ALL=C LANG=C
REPO="$(cd "$(dirname "$0")/.." && pwd)"

# 🔴 R1-F8(codex 關卡2,已用實跑證實):原本 datadir/sock 吃環境變數、只用 case 閘擋。
#    `L5AMDB=/tmp//` 通得過 `/tmp/?*` 與字元閘兩道 ⇒ teardown 的 `rm -rf "$D"` 會指向**整個 /tmp**。
#    修法不是把閘寫得更聰明(那是跟自己的 pattern 賽跑),而是**把輸入面拿掉**:
#    路徑固定前綴 + 本行程 PID,無環境覆寫 ⇒ 沒有可注入的字串,整族風險消失。
#    R2 再打(nit-2):固定 `/tmp` + PID 仍是**可預測**名稱,且只擋既存 datadir、沒擋既存 socket 路徑
#    ⇒ 還留著 symlink/race 的寫入面。改用 mktemp -d 建一個 0700 的專屬父目錄,data 與 socket 都放它底下:
#    名稱不可預測、權限鎖死、父目錄本身由 mktemp 保證是新建的。
ROOT="$(mktemp -d /tmp/l5am.XXXXXXXX)" || { echo "REFUSE: mktemp 失敗"; exit 1; }
chmod 700 "$ROOT" || { echo "REFUSE: chmod 700 失敗"; exit 1; }
case "$ROOT" in /tmp/l5am.????????) : ;; *) echo "REFUSE: mktemp 給出非預期路徑 [$ROOT]"; exit 1 ;; esac
D="$ROOT/pgdata"; SOCK="$ROOT/sock"; P=54431

PASS=0; FAIL=0; LABELS=""
ok()  { PASS=$((PASS+1)); LABELS="$LABELS $1"; printf '  PASS %-24s %s\n' "$1" "$2"; }
bad() { FAIL=$((FAIL+1)); LABELS="$LABELS $1"; printf '  FAIL %-24s %s\n' "$1" "$2"; }

# 🔴 R1-F7:結尾比對的是**這份 label 清單逐字**,不是格數。少跑一格、重複跑一格、把某格改名,三種都會紅。
# ⚠️ R2 校正(F5):**不要**把這句讀成「同步修改的繞道消失了」——那句原本寫得太滿。
#    這份 manifest 與被它守的格子住在同一個檔,有人把格子和 manifest 一起刪,照樣全綠。
#    它真正擋得住的只有**非同步**的漏跑(改了一邊忘了另一邊),擋不住有意的同步修改。
#    要擋後者只能把 oracle 搬到這個檔以外(CI 側),那不在本片範圍 —— 誠實寫在這裡,不假裝有。
MANIFEST="ACL-NO-COLUMN-GRANT ACL-UNIVERSAL C1 C10 C11 C12 C13 C14 C2 C3 C4 C5 C6 C7 C8 C9 DEF-PIN DORMANT MUT-DEFDRIFT MUT-after_release MUT-by_order MUT-not_self MUT-pair MUT-reason RLS-ENABLED STATIC-NO-DML ZERO-REG-INDEX ZERO-REG-STATUS-CHECK"

PMPID=""
teardown() {
  TD_RC=$?
  # 🔴 R1-F9:原本 `pg_ctl stop` 的離場碼被丟掉,而 `pgrep | wc -l` 會把 pgrep 自己的執行錯誤
  #    洗成字串 "0" ⇒ 印得出「殘留程序 0」卻其實沒查成功。改成釘 postmaster PID + kill -0。
  # 🔴 R2 再打(F7):PMPID 只在 start 成功後才讀。若 start 部分成功後回非零、或 postmaster.pid
  #    讀不到,PMPID 會是空的 ⇒ 舊版**跳過 stop 卻照樣 rm -rf datadir**,等於把還活著的 server
  #    的資料目錄從它腳下刪掉。修法:PMPID 空時**不假設沒開起來**,改回讀 postmaster.pid;
  #    仍拿不到 ⇒ 一律不刪、保留現場。
  if [ -z "$PMPID" ] && [ -f "$D/postmaster.pid" ]; then
    PMPID="$(head -1 "$D/postmaster.pid" 2>/dev/null)"
  fi
  if [ -z "$PMPID" ]; then
    if [ -e "$D" ]; then
      echo "🔴 TEARDOWN_WARN:拿不到 postmaster PID 但 datadir 存在 ⇒ **不刪**、保留 $ROOT 供診斷"
      if [ "$TD_RC" -eq 0 ]; then exit 9; else exit "$TD_RC"; fi
    fi
  else
    if kill -0 "$PMPID" 2>/dev/null; then
      pg_ctl -D "$D" -w stop >/dev/null 2>&1 || echo "🔴 TEARDOWN_WARN:pg_ctl stop 非零離場"
    fi
    if kill -0 "$PMPID" 2>/dev/null; then
      echo "🔴 TEARDOWN_WARN:postmaster PID $PMPID 仍活著 ⇒ 保留 $ROOT 供診斷"
      if [ "$TD_RC" -eq 0 ]; then exit 9; else exit "$TD_RC"; fi
    fi
  fi
  rm -rf "$ROOT"
  if [ -e "$ROOT" ]; then
    echo "🔴 TEARDOWN_WARN:rm 之後 $ROOT 仍在"
    if [ "$TD_RC" -eq 0 ]; then exit 9; else exit "$TD_RC"; fi
  fi
  echo "  teardown:postmaster 已停(kill -0 實測)、$ROOT 已收(-e 實測)"
}
trap teardown EXIT

mkdir -p "$SOCK" "$D"
initdb -D "$D" -U postgres --no-sync -A trust -E UTF8 --locale=C >/dev/null 2>"$SOCK/initdb.err" \
  || { echo INITDB_FAIL; cat "$SOCK/initdb.err" 2>/dev/null; exit 1; }
pg_ctl -D "$D" -o "-p $P -k $SOCK -c listen_addresses=" -l "$D/log" -w start >/dev/null 2>&1 \
  || { echo START_FAIL; cat "$D/log" 2>/dev/null; exit 1; }
PMPID="$(head -1 "$D/postmaster.pid" 2>/dev/null)"
[ -n "$PMPID" ] || { echo "🔴 拿不到 postmaster PID,teardown 的殘留檢查會失去判別力"; exit 1; }
die() { echo "🔴 $1"; exit 1; }

PSQL() { psql -X -h "$SOCK" -p "$P" -U postgres -d postgres "$@"; }
# 🔴 R1-F4:原本 Q() 沒有 ON_ERROR_STOP、又把 stderr 併進 stdout 再 pipe 給 tr
#    ⇒ psql 出錯時回傳的是**錯誤字串**、離場碼是 tr 的 0。套前套後同樣壞掉時兩邊字串相等
#    ⇒ ZERO-REG 兩格假綠。改成:錯誤走 stderr、離場碼實查、查詢失敗一律 die。
Q() {
  local out rc
  out="$(PSQL -v ON_ERROR_STOP=1 -qtA -c "$1" 2>"$SOCK/q.err")"; rc=$?
  [ "$rc" -eq 0 ] || die "psql 查詢失敗(rc=$rc):$1 :: $(tr -d '\n' < "$SOCK/q.err")"
  printf '%s' "$out" | tr -d '\n'
}

PREFIX_TS="20260809230000"
MIG="$REPO/supabase/migrations/20260809230000_m4b_lifecycle_l5a_m_superseded_marker.sql"
[ -f "$MIG" ] || die "MIG_MISSING: $MIG"

# ── 前綴重放 ────────────────────────────────────────────────────────────────
cd "$REPO" || die "CD_FAIL"
PSQL -v ON_ERROR_STOP=1 -q -f scripts/d1-supabase-shim.sql >/dev/null || die "SHIM_FAIL"
FIRST_FITMENTS="$(grep -l 'product_fitments_effective' supabase/migrations/*.sql | sort | head -1)"
for f in supabase/migrations/*.sql; do
  # 裸 PG 無 pg_cron:settle sweeper 排程 + L3b 排程兩支跳過(L3a 函式本體照樣重放)
  case "$f" in *20260723120000*|*20260809170000*) continue ;; esac
  case "$(basename "$f")" in [0-9]*) : ;; *) die "MIG_NAME_NOT_TS: $f" ;; esac
  TS="${f##*/}"; TS="${TS%%_*}"
  [ "$TS" \> "$PREFIX_TS" ] && continue
  [ "$TS" = "$PREFIX_TS" ] && continue    # 被測物留到快照拍完才套
  if [ "$f" = "$FIRST_FITMENTS" ]; then
    PSQL -v ON_ERROR_STOP=1 -q -f scripts/d1-fitments-bootstrap.sql >/dev/null || die "FITBOOT_FAIL"
  fi
  PSQL -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null 2>"$D/err" || die "MIG_FAIL: $f :: $(cat "$D/err")"
done
[ "$(Q "SELECT (pg_catalog.to_regclass('public.payment_charge_attempts') IS NOT NULL)::text")" = "true" ] \
  || die "UPSTREAM_MISSING: payment_charge_attempts 不存在,整份 harness 會打空"

# ── 套被測物**之前**的快照(零回歸 + DB writer 物件)────────────────────────
IDX_BEFORE="$(Q "SELECT string_agg(indexdef, '|' ORDER BY indexname) FROM pg_indexes WHERE schemaname='public' AND tablename='payment_charge_attempts'")"
STATUSCHK_BEFORE="$(Q "SELECT pg_catalog.pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='payment_charge_attempts_status_check'")"
# 🔴 R1-F5:DB writer 物件全集 = public 函式 + 所有 trigger + 所有 rule。
#    原本只掃 pg_proc.prosrc 找字樣 ⇒ 對「migration 直接 UPDATE / 一次性 DO 區塊」完全看不見
#    (那些跑完不留 pg_proc)。改成比對**物件集合**套前套後有無新增。
# 🔴 R2 再打(F3):原本只 hash **OID**,而 `ALTER FUNCTION` 換掉函式本體、
#    `ALTER TABLE ... ENABLE/DISABLE TRIGGER` 換掉啟用狀態,OID 都不變 ⇒ 指紋照樣相同、這格全盲。
#    改成 hash **定義本身**(functiondef / trigger def / rule def)加上啟用旗標。
writers_md5() {
  Q "SELECT md5(string_agg(k, '|' ORDER BY k)) FROM (
       SELECT 'f:' || p.oid::text || ':' || pg_catalog.pg_get_functiondef(p.oid) AS k
         FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.prokind IN ('f','p')
       UNION ALL
       SELECT 't:' || t.oid::text || ':' || t.tgenabled || ':' || pg_catalog.pg_get_triggerdef(t.oid)
         FROM pg_trigger t WHERE NOT t.tgisinternal
       UNION ALL
       SELECT 'r:' || r.oid::text || ':' || pg_catalog.pg_get_ruledef(r.oid)
         FROM pg_rewrite r) s"
}
WRITERS_BEFORE="$(writers_md5)"
[ -n "$IDX_BEFORE" ] && [ -n "$STATUSCHK_BEFORE" ] && [ -n "$WRITERS_BEFORE" ] || die "SNAPSHOT_EMPTY: 快照拍空,零回歸格會恆真"

echo "== L5a-M verify(port=$P, datadir=$D)=="

# ── STATIC-NO-DML:直接對 migration 檔做語句白名單 ──────────────────────────
# 🔴 R1-F5 的另一半:上面的物件比對抓「新增了 writer 物件」,這一格抓「這支 migration 自己就在寫資料」。
#    先剝掉 -- 註解(檔內 CJK 註解含 UPDATE 等字樣),再看有沒有 DML / DO / CREATE FUNCTION|TRIGGER|RULE。
# 🔴 R2 再打(F2):原本是**行首黑名單**,名字卻叫白名單——`WITH x AS (UPDATE … RETURNING *) SELECT …`、
#    `COPY`、`CALL`、跨行或夾 block comment 的 `CREATE FUNCTION` 全都繞得過。
#    改成真白名單:剝掉註解與空白後,**每一條語句的開頭**都必須落在本片明確用到的那五種之內,
#    出現任何其他開頭一律紅(新語句型要進來,得先改這份清單、被人看見)。
# 🔴 R3 C-3:白名單無詞界,而且「任何 ALTER TABLE 本表」太寬——`ALTER TABLE … DISABLE ROW LEVEL SECURITY`
#    完全通得過,那正好會拆掉 provenance 防線的一半。收窄成只允許 ADD COLUMN / ADD CONSTRAINT,
#    並補詞界(`BEGIN` 不得放行 `BEGINX`)。
ALLOWED='^(BEGIN|COMMIT)$|^ALTER[[:space:]]+TABLE[[:space:]]+public\.payment_charge_attempts[[:space:]]+(ADD[[:space:]]+COLUMN|ADD[[:space:]]+CONSTRAINT)[[:space:]]|^COMMENT[[:space:]]+ON[[:space:]]+COLUMN[[:space:]]+public\.payment_charge_attempts\.'
# 🔴 切句前必須先剝掉**單引號字串常值**:本檔的 COMMENT 內文自己就含 `;`
#    (第一版沒剝 ⇒ 把一段中文註解切成「語句」,白名單當場誤判紅。切句器不懂字串=經典坑)。
BAD_STMTS="$(
  sed -e 's/--.*//' "$MIG" \
  | tr '\n' ' ' \
  | sed -e 's/\/\*[^*]*\*\///g' \
  | sed -e "s/'[^']*'/QUOTED/g" \
  | tr ';' '\n' \
  | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' \
  | grep -v '^$' \
  | grep -vE "$ALLOWED" || true
)"
if [ -z "$BAD_STMTS" ]; then
  ok "STATIC-NO-DML" "剝註解後每條語句開頭都在白名單內(BEGIN/COMMIT/ALTER TABLE 本表/COMMENT ON COLUMN 本表)"
else
  bad "STATIC-NO-DML" "出現白名單外的語句:$(printf '%s' "$BAD_STMTS" | head -3 | tr '\n' ' ' | cut -c1-140)"
fi

PSQL -v ON_ERROR_STOP=1 -q -f "$MIG" >/dev/null 2>"$D/err" || die "APPLY_FAIL: $(cat "$D/err")"

IDX_AFTER="$(Q "SELECT string_agg(indexdef, '|' ORDER BY indexname) FROM pg_indexes WHERE schemaname='public' AND tablename='payment_charge_attempts'")"
STATUSCHK_AFTER="$(Q "SELECT pg_catalog.pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='payment_charge_attempts_status_check'")"
WRITERS_AFTER="$(writers_md5)"

[ "$IDX_AFTER" = "$IDX_BEFORE" ] \
  && ok "ZERO-REG-INDEX" "index 定義集合套前套後逐字相同" \
  || bad "ZERO-REG-INDEX" "index 集合被動過:before=[$IDX_BEFORE] after=[$IDX_AFTER]"
[ "$STATUSCHK_AFTER" = "$STATUSCHK_BEFORE" ] \
  && ok "ZERO-REG-STATUS-CHECK" "status CHECK 逐字相同" \
  || bad "ZERO-REG-STATUS-CHECK" "status CHECK 被動過:before=[$STATUSCHK_BEFORE] after=[$STATUSCHK_AFTER]"
[ "$WRITERS_AFTER" = "$WRITERS_BEFORE" ] \
  && ok "DORMANT" "函式/trigger/rule 的**定義+啟用狀態**指紋套前套後相同(未新增、也未改寫任何 DB writer)" \
  || bad "DORMANT" "DB writer 定義被動過:before=$WRITERS_BEFORE after=$WRITERS_AFTER"

# ── DEF-PIN:釘住 superseded 族**六條**約束的正規化述詞(R1-F6)──────────────
# 🔴 R3 N-1 校正:LIKE 'payment_charge_attempts_superseded%' 命中的是 **5 條 CHECK + 1 條 FK**,
#    共六條。前一版寫「五條」= 字面 vs 事實(而且會讓人以為 FK 述詞漂移沒被釘住,其實有)。
# 🔴 DROP 突變證的是「拿掉它會怎樣」,證不到「名字還在、述詞被放寬」——
#    後者對 7 格負向矩陣是**完全隱形**的(下面 MUT-DEFDRIFT 會把這件事演一次)。
#    釘 md5 而非逐字:改了 migration 就必須手動重釘(跑一次把印出來的值貼回本行)。
#    忘記重釘 = false-stop(紅、但庫是好的),安全方向;不會假綠。
defs_md5() {
  Q "SELECT md5(string_agg(conname || '=' || pg_catalog.pg_get_constraintdef(oid), '|' ORDER BY conname))
       FROM pg_constraint
      WHERE conrelid='public.payment_charge_attempts'::regclass
        AND conname LIKE 'payment_charge_attempts_superseded%'"
}
DEF_MD5="$(defs_md5)"
# 🔴 R2 再打(F4):原本寫成 `${EXPECT_DEF_MD5:-…}` ⇒ **環境變數可以覆寫這個釘值**。
#    把 reason 值域偷偷放寬、再把 EXPECT_DEF_MD5 設成新 md5,DEF-PIN、資料矩陣、MUT-DEFDRIFT
#    可以同時全綠 —— 這道釘等於裝了一個外部開關。改成硬寫死,重釘只能改這一行(改動看得見、進 diff)。
EXPECT_DEF_MD5=7cbf1cc2ca2c5f10c18d3a0263f7dd4f
[ "$DEF_MD5" = "$EXPECT_DEF_MD5" ] \
  && ok "DEF-PIN" "superseded 族六條約束(5 CHECK + 1 FK)正規化述詞 md5=$DEF_MD5(與釘值相符)" \
  || bad "DEF-PIN" "述詞 md5=$DEF_MD5,釘值=$EXPECT_DEF_MD5。剛改過 migration ⇒ 重釘;沒改過 ⇒ 述詞被動過"

# ── fixture ─────────────────────────────────────────────────────────────────
U='9e000000-0000-4000-8000-000000000001'
O1='9f000000-0000-4000-8000-000000000001'
O2='9f000000-0000-4000-8000-000000000002'
A1='9d000000-0000-4000-8000-000000000001'

# probe <status> <rec 表達式> <released_at> <superseded_at> <reason> <by_order> → OK 或約束名
# 🔴 R2 再打(F8):原本不看 psql 離場碼、只用 `*INSERT_OK*` 子字串比對,也不驗 SQLSTATE
#    ⇒ 分類靠的是「輸出裡有沒有那七個字」而不是「這條 INSERT 到底成不成功」。
#    改成:ON_ERROR_STOP=1 + VERBOSITY=verbose,離場碼實查,並且**強制 SQLSTATE 必須是
#    23514(check_violation)或 23503(foreign_key_violation)**——被別種錯誤(打錯欄名、
#    fixture 壞掉、連線斷)頂替成「看起來像被約束擋下」的路徑就此關掉。
probe() {
  local out rc sqlstate
  out="$(PSQL -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -qtA <<SQL 2>&1
BEGIN;
INSERT INTO auth.users (id, email) VALUES ('$U', 'l5am@example.test');
INSERT INTO public.orders
  (id, display_id, customer_user_id, shipping_address_snapshot, tier_at_checkout,
   subtotal, shipping_fee, total, shipping_method, invoice, cart_session_id)
VALUES
  ('$O1', 'PCM-2099-5001', '$U', jsonb_build_object('name','l5am','phone','0900000000','line','x'),
   'general'::public.member_tier, 100, 0, 100, 'store', jsonb_build_object('type','personal'), gen_random_uuid()),
  ('$O2', 'PCM-2099-5002', '$U', jsonb_build_object('name','l5am','phone','0900000000','line','x'),
   'general'::public.member_tier, 100, 0, 100, 'store', jsonb_build_object('type','personal'), gen_random_uuid());
INSERT INTO public.payment_charge_attempts
  (id, order_id, customer_user_id, status, fallback_token_hash, rec_trade_id,
   released_at, superseded_at, superseded_reason, superseded_by_order_id)
VALUES
  ('$A1', '$O1', '$U', '$1', public.charge_attempt_token_hash('$A1'), $2,
   $3, $4, $5, $6);
SELECT 'INSERT_OK';
ROLLBACK;
SQL
)"; rc=$?
  if [ "$rc" -eq 0 ]; then
    case "$out" in
      *INSERT_OK*) printf 'OK'; return ;;
      *) printf 'UNEXPECTED_RC0_NO_MARKER: %s' "$(printf '%s' "$out" | tr '\n' ' ' | cut -c1-140)"; return ;;
    esac
  fi
  sqlstate="$(printf '%s' "$out" | sed -n 's/.*ERROR:[[:space:]]*\([0-9A-Z]\{5\}\):.*/\1/p' | head -1)"
  case "$sqlstate" in
    23514) printf '%s' "$out" | sed -n 's/.*violates check constraint "\([^"]*\)".*/\1/p' | head -1 | tr -d '\n' ;;
    23503) printf '%s' "$out" | sed -n 's/.*violates foreign key constraint "\([^"]*\)".*/\1/p' | head -1 | tr -d '\n' ;;
    *)     printf 'UNEXPECTED_SQLSTATE[%s]: %s' "${sqlstate:-none}" "$(printf '%s' "$out" | tr '\n' ' ' | cut -c1-140)" ;;
  esac
}
cell() { # cell <label> <期望> <status> <rec> <released_at> <superseded_at> <reason> <by_order>
  local label="$1" want="$2"; shift 2
  local got; got="$(probe "$@")"
  [ "$got" = "$want" ] && ok "$label" "→ $got" || bad "$label" "得到 [$got],期望 [$want]"
}

NOW='pg_catalog.now()'
AGO="pg_catalog.now() - interval '1 minute'"
R_NF="'record_not_found'"; R_SP="'stuck_pending'"
CHK_REASON='payment_charge_attempts_superseded_reason_chk'
CHK_PAIR='payment_charge_attempts_superseded_pair_chk'
CHK_BYORD='payment_charge_attempts_superseded_by_order_chk'
CHK_SELF='payment_charge_attempts_superseded_not_self_chk'
CHK_AFTER='payment_charge_attempts_superseded_after_release_chk'
REC="'l5am-rec-1'"

# 每格只讓**一條**約束的前提成立(其餘四條前提刻意為假)⇒ 拒絕理由不會被別條供出來。
echo "-- 14 格資料矩陣 --"
cell C1  OK           released NULL   NULL   NULL   NULL    NULL
cell C2  OK           released NULL   "$AGO" "$NOW" "$R_NF" "'$O2'"
cell C3  OK           released NULL   "$AGO" "$NOW" "$R_SP" NULL
cell C4  "$CHK_PAIR"  released NULL   "$AGO" "$NOW" NULL    NULL
cell C5  "$CHK_PAIR"  released NULL   "$AGO" NULL   "$R_SP" NULL
cell C6  "$CHK_BYORD" released NULL   NULL   NULL   NULL    "'$O2'"
cell C7  "$CHK_SELF"  released NULL   "$AGO" "$NOW" "$R_SP" "'$O1'"
cell C8  "$CHK_REASON" released NULL  "$AGO" "$NOW" "'bogus'" NULL
# 🔴 C9 = codex 關卡2 R1-F1 的攻擊列逐字重現:status='charged'、**從未 released**(released_at NULL)、
#    卻帶著合法的 superseded 標記。R1 當下四條 CHECK 全過 ⇒ L5b 若認「標記=可退款」就會退到一筆
#    從來沒被 L5 讓路過的正常交易。新增的 after_release 約束就是為了讓這一列進不來。
cell C9  "$CHK_AFTER" charged  "$REC" NULL   "$NOW" "$R_SP" NULL
# 🔴 C10 = after_release 的另一半:先讓路、後 release(時序倒過來)也不合法。
#    少了這格,把述詞弱化成「released_at IS NOT NULL」的突變會存活。
cell C10 "$CHK_AFTER" released NULL   "$NOW" "$AGO" "$R_SP" NULL
# 🔴 C11(R3 MF-2)= **等號邊界**,而等號正是 L5a-1 的主線形狀:
#    release CAS 寫 `released_at = COALESCE(released_at, now())`(20260624120002:55,已自驗存在),
#    同交易讓路 ⇒ `released_at` 與 `superseded_at` **同為那次 now()、完全相等**。
#    前十格全用 AGO/NOW 嚴格不等 ⇒ 有人把 `<=` 收成 `<`,十格全綠、只有 DEF-PIN 紅
#    (而 DEF-PIN 靠人工重釘 = 橡皮圖章)⇒ 正式站讓路的**第一筆**就吃 23514。
cell C11 OK           released NULL   "$NOW" "$NOW" "$R_SP" NULL
# 🔴 C12/C13(R3 MF-3)= 釘住檔頭「刻意不綁 status='released'」那句話。
#    原本三個正向格 status 全是 released ⇒ 有人把 CHECK ⑤ 收嚴成 `status='released' AND …`,
#    整份 harness 全綠,而 released→charged(genesis)與 released→failed(close)兩條既有合法轉移
#    會在正式站上炸。這兩格就是那句宣稱的**唯一**證人。
cell C12 OK           charged  "$REC" "$AGO" "$NOW" "$R_SP" NULL
cell C13 OK           failed   NULL   "$AGO" "$NOW" "$R_SP" NULL
# 🔴 C14(R3 N-3)= 讓 23503 那條分支真的被走到一次。原本 probe 寫了 FK 分支卻沒有任何一格觸發
#    ⇒ 那段程式碼是死的,而「inline FK 真的擋得住不存在的 order_id」也從來沒被證過。
cell C14 payment_charge_attempts_superseded_by_order_id_fkey \
                      released NULL   "$AGO" "$NOW" "$R_SP" "'00000000-0000-4000-8000-0000000000ff'"

# ── ACL ─────────────────────────────────────────────────────────────────────
# 🔴 R1-F10:原本宣稱 service_role「唯 SELECT」卻只否決 UPDATE、沒否決 INSERT
#    ⇒ 它若拿得到表級 INSERT,新增 attempt 時就能直接種入退款標記,而這一格照樣綠。
#    改成把所有非 SELECT 欄級權限逐項否決。
echo "-- ACL --"
# 🔴 R2 再打(F6):欄級權限只有 SELECT/INSERT/UPDATE/REFERENCES 四種,
#    **DELETE / TRUNCATE / TRIGGER 根本沒有欄級**、只存在表級 ⇒ 上游若漂移授了其中一個,
#    純欄級的這格照樣綠,而「唯 SELECT」那句宣稱已經不成立。兩個層級都要查
#    (memory reference_pg-table-acl-flatten-blind-to-column-grants 的反向:那條講表級看不到欄級,
#     這裡是欄級看不到表級,同一枚硬幣兩面)。
# 🔴 R3 C-1:原本是**三個角色的枚舉**,不是全稱斷言 —— 有人 GRANT 給第四個角色(或未來新增的角色),
#    這格照樣綠。改成掃 `aclexplode(relacl)` + `pg_attribute.attacl` 的**全集**:
#    「非 owner、且拿到 SELECT 以外任何權限」的任何 grantee 一律紅。這樣才封得住整族,
#    而不是封住我今天想得到的那三個名字(repo 先例 20260611120000:98-99 同款)。
ACL_BAD="$(Q "SELECT COALESCE(string_agg(x, ','), '') FROM (
  SELECT 'tbl:' || CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END
         || ':' || a.privilege_type AS x
    FROM pg_class c, aclexplode(c.relacl) a
   WHERE c.oid = 'public.payment_charge_attempts'::regclass
     AND a.grantee <> c.relowner
     AND a.privilege_type <> 'SELECT'
  UNION ALL
  SELECT 'col:' || att.attname || ':'
         || CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END
         || ':' || a.privilege_type
    FROM pg_attribute att
    JOIN pg_class c ON c.oid = att.attrelid,
         aclexplode(att.attacl) a
   WHERE att.attrelid = 'public.payment_charge_attempts'::regclass
     AND a.grantee <> c.relowner
     AND a.privilege_type <> 'SELECT'
  UNION ALL
  SELECT 'grantopt:' || CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END
    FROM pg_class c, aclexplode(c.relacl) a
   WHERE c.oid = 'public.payment_charge_attempts'::regclass
     AND a.grantee <> c.relowner AND a.is_grantable
) t")"
[ -z "$ACL_BAD" ] \
  && ok "ACL-UNIVERSAL" "全稱斷言:表級+欄級 ACL 全集裡,非 owner 者一律只有 SELECT、零 GRANT OPTION" \
  || bad "ACL-UNIVERSAL" "權限面異常:[$ACL_BAD]"
# 🔴 R3 C-3:檔頭把「RLS enable 零 policy」列為 provenance 防線的一半,全片卻零斷言 ⇒ 那半句沒有證人。
RLS_STATE="$(Q "SELECT c.relrowsecurity::text || ':' || (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid)::text
                  FROM pg_class c WHERE c.oid = 'public.payment_charge_attempts'::regclass")"
[ "$RLS_STATE" = "true:0" ] \
  && ok "RLS-ENABLED" "RLS 已啟用且 policy 數=0(檔頭那半句防線有證人了)" \
  || bad "RLS-ENABLED" "relrowsecurity:policy數=[$RLS_STATE],期望 [true:0]"
COLACL="$(Q "SELECT count(*)::text FROM pg_attribute WHERE attrelid='public.payment_charge_attempts'::regclass AND attname IN ('superseded_at','superseded_reason','superseded_by_order_id') AND attacl IS NOT NULL")"
[ "$COLACL" = "0" ] \
  && ok "ACL-NO-COLUMN-GRANT" "三欄 pg_attribute.attacl 全 NULL(無欄級 GRANT 後門)" \
  || bad "ACL-NO-COLUMN-GRANT" "有 $COLACL 欄被種了欄級 ACL"

# ── 突變 A:DROP 一條約束 ⇒ 恰好對應的那些格翻掉 ────────────────────────────
echo "-- 5 發 DROP 突變 --"
# 🔴 R3 C-4:原本比不等於 OK 就算「沒翻」——**包括 probe 回 `UNEXPECTED*` 的時候**。
#    fixture 壞掉、欄名打錯、連線斷,全都會被靜靜讀成「守門有效」⇒ 負測的觀察被「壞掉」本身頂替。
#    改成只認 OK 與具名約束兩種,出現 UNEXPECTED 一律 die。
neg_probe() {
  local got; got="$(probe "$@")"
  case "$got" in UNEXPECTED*) die "負測 probe 回非預期結果 [$got] —— 本輪所有突變結論皆不可信" ;; esac
  printf '%s' "$got"
}
run_neg_matrix() { # 印出「現在會被放行」的負向格代號
  [ "$(neg_probe released NULL "$AGO" "$NOW" NULL    NULL   )" = OK ] && printf 'C4 '
  [ "$(neg_probe released NULL "$AGO" NULL   "$R_SP" NULL   )" = OK ] && printf 'C5 '
  [ "$(neg_probe released NULL NULL   NULL   NULL    "'$O2'")" = OK ] && printf 'C6 '
  [ "$(neg_probe released NULL "$AGO" "$NOW" "$R_SP" "'$O1'")" = OK ] && printf 'C7 '
  [ "$(neg_probe released NULL "$AGO" "$NOW" "'bogus'" NULL )" = OK ] && printf 'C8 '
  [ "$(neg_probe charged "$REC" NULL  "$NOW" "$R_SP" NULL   )" = OK ] && printf 'C9 '
  [ "$(neg_probe released NULL "$NOW" "$AGO" "$R_SP" NULL   )" = OK ] && printf 'C10 '
  true
}
mutate_drop() { # $1=約束名 $2=short label $3=期望翻掉的格
  local con="$1" label="MUT-$2" want="$3" def flipped
  def="$(Q "SELECT pg_catalog.pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='$con'")"
  [ -n "$def" ] || { bad "$label" "拿不到約束定義,這一發的結論無效"; return; }
  PSQL -v ON_ERROR_STOP=1 -q -c "ALTER TABLE public.payment_charge_attempts DROP CONSTRAINT $con" >/dev/null 2>&1 \
    || { bad "$label" "DROP 失敗,這一發的結論無效"; return; }
  flipped="$(run_neg_matrix)"; flipped="$(printf '%s' "$flipped" | sed 's/ *$//')"
  PSQL -v ON_ERROR_STOP=1 -q -c "ALTER TABLE public.payment_charge_attempts ADD CONSTRAINT $con $def" >/dev/null 2>&1 \
    || die "$label 之後裝不回約束,庫已髒 —— 停下(後面所有格的結果都不可信)"
  [ "$flipped" = "$want" ] \
    && ok "$label" "翻掉的格=[$flipped](與期望逐字相同)" \
    || bad "$label" "翻掉的格=[$flipped],期望=[$want] ⇒ 該約束的判別力不成立"
}
mutate_drop "$CHK_PAIR"   pair          "C4 C5"
mutate_drop "$CHK_BYORD"  by_order      "C6"
mutate_drop "$CHK_SELF"   not_self      "C7"
mutate_drop "$CHK_REASON" reason        "C8"
mutate_drop "$CHK_AFTER"  after_release "C9 C10"

# ── 突變 B:名字還在、述詞被放寬(R1-F6 的正題)─────────────────────────────
# 🔴 這一發同時證兩件事:①DEF-PIN 抓得到述詞漂移 ②7 格負向矩陣對它**全盲**。
#    第二件才是重點 —— 沒有 DEF-PIN 的話,有人把值域偷偷放寬,整份 harness 一格都不會紅。
echo "-- 1 發述詞漂移突變 --"
DEF_ORIG="$(Q "SELECT pg_catalog.pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='$CHK_REASON'")"
# 🔴 還原後比對的基準取「漂移前當下實測值」,不取 EXPECT_DEF_MD5:
#    否則有人只是忘了重釘,就會在這裡 die 成「庫已髒」——把重釘問題誤報成資料庫問題。
DEF_MD5_PRE_DRIFT="$(defs_md5)"
PSQL -v ON_ERROR_STOP=1 -q >/dev/null 2>&1 <<SQL
ALTER TABLE public.payment_charge_attempts DROP CONSTRAINT $CHK_REASON;
ALTER TABLE public.payment_charge_attempts ADD CONSTRAINT $CHK_REASON
  CHECK (superseded_reason IS NULL OR superseded_reason IN ('record_not_found', 'stuck_pending', 'evil'));
SQL
DRIFT_MD5="$(defs_md5)"
DRIFT_NEG="$(run_neg_matrix)"; DRIFT_NEG="$(printf '%s' "$DRIFT_NEG" | sed 's/ *$//')"
PSQL -v ON_ERROR_STOP=1 -q >/dev/null 2>&1 <<SQL
ALTER TABLE public.payment_charge_attempts DROP CONSTRAINT $CHK_REASON;
ALTER TABLE public.payment_charge_attempts ADD CONSTRAINT $CHK_REASON $DEF_ORIG;
SQL
[ "$(defs_md5)" = "$DEF_MD5_PRE_DRIFT" ] || die "述詞漂移突變之後裝不回原述詞,庫已髒 —— 停下"
if [ "$DRIFT_MD5" != "$DEF_MD5_PRE_DRIFT" ] && [ -z "$DRIFT_NEG" ]; then
  ok "MUT-DEFDRIFT" "同名放寬述詞:DEF-PIN 紅(md5 變)、7 格負向矩陣全盲(0 格翻)⇒ 這道釘是唯一看得見它的人"
else
  bad "MUT-DEFDRIFT" "漂移後 md5=$DRIFT_MD5(應與漂移前 $DEF_MD5_PRE_DRIFT 不同)、負向矩陣翻了 [$DRIFT_NEG](應為空)"
fi

# ── 結尾:label manifest 逐字比對(R1-F7)────────────────────────────────────
echo
GOT_LABELS="$(printf '%s\n' $LABELS | sort | tr '\n' ' ' | sed 's/ *$//')"
WANT_LABELS="$(printf '%s\n' $MANIFEST | sort | tr '\n' ' ' | sed 's/ *$//')"
echo "PASS=$PASS FAIL=$FAIL"
[ "$GOT_LABELS" = "$WANT_LABELS" ] || {
  echo "🔴 label 清單不符(少跑/重複/改名都會到這裡)"
  echo "   實跑=[$GOT_LABELS]"
  echo "   期望=[$WANT_LABELS]"
  exit 1
}
[ "$FAIL" = 0 ] || exit 1
echo "✅ L5a-M 全綠(28 條斷言:2 零回歸 + 1 STATIC-NO-DML + 1 DEF-PIN + 14 資料格 + 1 dormant + 1 RLS + 2 ACL + 5 DROP 突變 + 1 述詞漂移突變)"
