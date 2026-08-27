#!/usr/bin/env bash
# ============================================================
# L5b-2 片 2f 驗證 harness — admin_initiate_order_refund 序列化點與跨帳本否決
#   plan = docs/specs/2026-08-12-l5b2-2f-initiate-advisory-plan.md §8(**版號以該檔檔頭為準**,此處不複寫)
#
# 用法(叢集由本檔自己 provision;PORT 預設 54763,平行窗請改 PORT 避免撞):
#   scripts/l5b2-2f-verify.sh all          全跑(run + rb)
#   scripts/l5b2-2f-verify.sh run          正向/負向格(叢集需已在)
#   scripts/l5b2-2f-verify.sh rb           回退三態(叢集需已在)
#   scripts/l5b2-2f-verify.sh neg          守門負測:改**庫的狀態**(叢集需已在)
#   scripts/l5b2-2f-verify.sh mut          突變靶(每靶一座全新叢集;紅格由實跑決定)
#   scripts/l5b2-2f-verify.sh pins         只量 PIN 值(填 migration/rollback 用)
#
# 🔴 mut 與 neg 是兩個**不同的失效面**,兩個都要跑:
#    mut 改檔(migration 被寫壞)、neg 改庫(依賴的索引/trigger/COMMENT 被別人動過)。
#    只跑 mut ⇒ P6b/P6c/P7 與回退閘②b/②c 一條負測都沒有。
#
# 🔴 workdir **不再由外部傳入**(R1v6 MF:舊版只驗 `/tmp/*` 前綴就 `rm -rf`,誤傳 `/tmp/`
#    會清掉整個暫存區 —— 那是本片唯一會傷到「本片以外」的東西)。
#    改成一律由本檔自產:`/tmp/p2f-<PORT>`(mut 另掛 `-mut` 後綴)。
#    ① 形狀恆為 /tmp/<單一目錄> ⇒ 深度恆 =2,不可能退化成 `/tmp` 或 `/tmp/`;
#    ② PORT 先驗純數字才組進路徑 ⇒ 路徑字元集由本檔決定;
#    ③ 平行窗改 PORT 即可(本來就要改,否則撞埠),不需要也不能改路徑。
#    順帶滿足舊約束:PG 的 Unix socket 路徑上限 103 bytes,這個形狀恆短
#    (session scratchpad 那種長路徑會讓 pg_ctl 直接起不來,實測過)。
#
# 🔴 依賴檔指紋(**算法 = SHA-1**;量法逐字:`shasum <檔>`)
#    改了 migration/rollback 沒重量這裡 ⇒ 本檔拒跑(避免拿舊靶驗新檔)。
MIG_SHA_EXPECT="0611f55ca64bc74071e9201048011719d4d197a0"
RB_SHA_EXPECT="9713909a421cd409d5097cc86512e63d75ba14c2"
#    2f 的 post-image prosrc md5(算法 = md5;量法 = 本檔 pins 模式)
POST_MD5_EXPECT="6ad5549694cc49bc97b38958724e887a"
#    2f 的 pre-image prosrc md5(同上)
PRE_MD5_EXPECT="f98e25f58dde8306772e157f0c7cc5cb"
#
# ⚠️ 誠實邊界(這些格證不到的事,不要當成證到了):
#   · 否決條件在 2g 之前**恆假** ⇒ 所有 C 段格驗的都是本檔**直接 INSERT 造出來的**資料,
#     不是跑真流程長出來的。這是 plan §9-1 已認的限制。
#   · L2 死結消融若拿不到 40P01,**照實記「未證」**,不得改判準去遷就(55P03 只證明有人在等、不證明有環)。
# ============================================================
set -uo pipefail
cd "$(dirname "$0")/.."

MODE="${1:-all}"
PORT="${PORT:-54763}"
# 🔴 PORT 會被組進 workdir 路徑(那個路徑會被 rm -rf)⇒ 先證它是純數字。
#    這道不是防駭,是防「打錯一個字讓刪除目標變成別的東西」。
case "$PORT" in ''|*[!0-9]*) echo "🔴 PORT 必須是純數字,實得 [$PORT]" >&2; exit 1 ;; esac
WORK="/tmp/p2f-$PORT"
URL="postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres"
MIG="supabase/migrations/20260812170000_m4b_lifecycle_l5b2_2f_initiate_advisory.sql"
RB="scripts/l5b2-2f-rollback.sql"

log()  { printf '\n── %s ──\n' "$1"; }
die()  { echo "🔴 $*" >&2; exit 1; }   # 🔴 走 stderr:走 stdout 會被呼叫端的 >/dev/null 滅音,腳本靜默死
q()    { psql "$URL" -qtAX -c "$1" 2>&1; }
sqlx() { psql "$URL" -qtAX -v ON_ERROR_STOP=1 -c "$1" >/dev/null || die "fixture SQL 失敗:$1"; }

PASS=0; FAIL=0
val() {  # val <label> <want> <sql>
  local label="$1" want="$2" got
  got="$(q "$3")"
  if [ "$got" = "$want" ]; then PASS=$((PASS+1)); printf '  ✅ %s\n' "$label"
  else FAIL=$((FAIL+1)); printf '  ❌ %s\n     want=[%s]\n     got =[%s]\n' "$label" "$want" "$got"; fi
}
# 多語句查詢(BEGIN;...;ROLLBACK;)會把每一句的輸出都吐出來 ⇒ 只取最後一行那個值。
val_last() { # val_last <label> <want> <sql>
  local label="$1" want="$2" got
  got="$(q "$3" | tail -1)"
  if [ "$got" = "$want" ]; then PASS=$((PASS+1)); printf '  ✅ %s\n' "$label"
  else FAIL=$((FAIL+1)); printf '  ❌ %s\n     want=[%s]\n     got =[%s]\n' "$label" "$want" "$got"; fi
}
like() { # like <label> <substr> <sql>
  local label="$1" want="$2" got
  got="$(q "$3")"
  case "$got" in
    *"$want"*) PASS=$((PASS+1)); printf '  ✅ %s\n' "$label" ;;
    *) FAIL=$((FAIL+1)); printf '  ❌ %s\n     期望含=[%s]\n     got   =[%s]\n' "$label" "$want" "$got" ;;
  esac
}

check_sha() {
  command -v shasum >/dev/null || die "缺 shasum"
  local m r
  m="$(shasum "$MIG" | awk '{print $1}')"
  r="$(shasum "$RB"  | awk '{print $1}')"
  case "$MIG_SHA_EXPECT" in @@*) echo "⚠️  MIG_SHA_EXPECT 尚未釘(pins 模式會印出來);略過指紋閘";; *)
    [ "$m" = "$MIG_SHA_EXPECT" ] || die "migration SHA-1 = $m,與本檔釘的 $MIG_SHA_EXPECT 不符(算法=SHA-1、量法 shasum)";; esac
  case "$RB_SHA_EXPECT" in @@*) : ;; *)
    [ "$r" = "$RB_SHA_EXPECT" ] || die "rollback SHA-1 = $r,與本檔釘的 $RB_SHA_EXPECT 不符";; esac
}

# 🔴 遞迴刪除的**唯一入口**。兩個 rm -rf 呼叫點(provision / mut_prepare)都走這裡,
#    判準只有一份 ⇒ 不會再出現「修了一處、另一處還是舊形狀」。
#    允許形狀 = 本檔自產的 /tmp/p2f-<純數字>[-mut]:
#      · `/tmp` 與 `/tmp/` 不匹配 ⇒ 拒
#      · 任何只有一層的路徑不匹配 ⇒ 深度 ≥2 由形狀保證
#      · 外部傳入的路徑進不來(WORK 不再吃 $2)
safe_rm_workdir() {
  case "$1" in
    /tmp/p2f-[0-9]*) : ;;
    *) die "拒絕 rm -rf [$1]:只允許本檔自產的 /tmp/p2f-<port>[-mut]" ;;
  esac
  case "$1" in *..*) die "拒絕 rm -rf [$1]:路徑含 .." ;; esac
  rm -rf "$1"
}

provision() {
  # 🔴 先 teardown、確認埠空了再刪:直接 rm -rf 一個**還在跑**的叢集資料目錄,
  #    postmaster 不會跟著死 —— 它抱著已被刪掉的檔案繼續佔著埠,下一次 provision 綁不到,
  #    整條路死在「叢集沒起來」而看不出真因(本輪實際踩到兩次)。
  #    mut 那條路本來就先 teardown 再刪,這裡漏了。
  scripts/d1t2-rehearsal.sh teardown "$WORK" >/dev/null 2>&1
  wait_port_free
  safe_rm_workdir "$WORK"; mkdir -p "$WORK"
  PORT=$PORT scripts/d1t2-rehearsal.sh provision "$WORK" > "$WORK/prov.log" 2>&1 || true
  # provision 會跑到 2f 就停(PIN 未填時)或直接成功;本檔一律自己再 apply 一次確認狀態
  q "SELECT 1;" >/dev/null 2>&1 || die "叢集沒起來,見 $WORK/prov.log"
}
teardown() {
  scripts/d1t2-rehearsal.sh teardown "$WORK" >/dev/null 2>&1 || echo "⚠️ teardown 回傳非 0"
  if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "🔴 PORT=$PORT 仍有人聽 ⇒ 零留痕不成立"; return 1
  fi
  echo "  ✅ teardown 完成、PORT=$PORT 無人聽"
}

# ══ fixture:seed 沒有「已付款且有卡交易序號」的訂單,本檔自己造 ═══════════════
# 🔴 空叢集沒有 customers(seed 不建訂單線資料)⇒ 先借一顆既有 auth.users 建客戶,
#    否則 orders 的 FK 過不了。這一步失敗要當場死,不能讓後面每格都變成假紅。
ensure_customer() {
  sqlx "INSERT INTO public.customers (user_id, email, name, phone)
        SELECT u.id, COALESCE(u.email, 'harness@example.com'), 'harness', '0900000000'
          FROM auth.users u
         WHERE NOT EXISTS (SELECT 1 FROM public.customers c WHERE c.user_id = u.id)
         LIMIT 1;"
  local n; n="$(q "SELECT count(*)::text FROM public.customers;")"
  [ "$n" -ge 1 ] 2>/dev/null || die "ensure_customer 後 customers 仍為 $n 筆 ⇒ fixture 無法建立"
}

mk_order() { # mk_order <payment_status> → order_id
  q "INSERT INTO public.orders
       (display_id, customer_user_id, shipping_address_snapshot, tier_at_checkout,
        subtotal, shipping_fee, total, shipping_method, invoice, shipping_method_at_checkout,
        payment_status, tappay_rec_trade_id)
     VALUES ('PCM-2026-' || (900000 + floor(random()*99999)::int)::text,
             (SELECT c.user_id FROM public.customers c LIMIT 1), jsonb_build_object('name','harness','phone','0900000000','line','test addr'), 'general', 1000, 0, 1000, 'home', jsonb_build_object('type','personal'), 'home',
             '$1', 'rec_'||substr(replace(gen_random_uuid()::text,'-',''),1,16))
     RETURNING id::text;"
}
mk_attempt() { # mk_attempt <order_id> [status] → attempt_id
  # 🔴 status 預設 failed:唯一索引 payment_charge_attempts_order_lock_idx 只蓋
  #    {pending, charged, released} ⇒ 同一張單只能有一顆那三態的 attempt。
  #    本片的否決只 join order_id、不看 attempt 狀態 ⇒ 用 failed 造多顆是合法 fixture,
  #    而且 C5(同單另一顆 attempt 也擋)非要多顆不可。
  q "INSERT INTO public.payment_charge_attempts (order_id, customer_user_id, fallback_token_hash, status)
     SELECT '$1'::uuid, o.customer_user_id, repeat('a',64), '${2:-failed}'
       FROM public.orders o WHERE o.id='$1'::uuid
     RETURNING id::text;"
}
mk_refund() { # mk_refund <attempt_id> [supersedes] → refund_id
  local sup="${2:-NULL}"
  [ "$sup" = "NULL" ] || sup="'$sup'::uuid"
  q "INSERT INTO public.payment_refunds
       (attempt_id, idempotency_key, amount, currency, strong_key, lease_token, supersedes_refund_id)
     VALUES ('$1'::uuid, substr(replace(gen_random_uuid()::text,'-',''),1,20), 100, 'TWD',
             'bank:'||replace(gen_random_uuid()::text,'-',''), 0, $sup)
     RETURNING id::text;"
}
mk_event() { # mk_event <refund_id> <event_type> <seq>
  sqlx "INSERT INTO public.payment_refund_events (refund_id, event_type, seq, lease_token)
        VALUES ('$1'::uuid, '$2', $3, 0);"
}
uuid4() { q "SELECT gen_random_uuid()::text;"; }
# 🔴 fixture 失敗必須當場死:否則錯誤訊息會被當成 id 灌進下一句 SQL,
#    後面每一格都變成「拿錯誤字串當 uuid」的假紅,真正的根因被埋在第 5 層。
need_uuid() { case "$1" in   # 只驗不印(印了呼叫端就得導掉,一導就把 die 訊息也滅了)
  [0-9a-f]*-[0-9a-f]*-[0-9a-f]*-[0-9a-f]*-[0-9a-f]*) : ;;
  *) die "fixture 沒拿到 uuid,實得:$1" ;; esac; }

initiate() { # initiate <order_id> <request_id> → jsonb
  q "SELECT public.admin_initiate_order_refund('$1'::uuid, 'partial', 100, 0, NULL,
        '2f harness', 'harness_actor', '$2')::text;"
}

# ══════════════════════════════════════════════════════════════════════════
mode_pins() {
  log "PIN 量測(算法:SHA-1 用於檔案、md5 用於 prosrc/viewdef)"
  echo "  MIG_SHA_EXPECT=\"$(shasum "$MIG" | awk '{print $1}')\""
  echo "  RB_SHA_EXPECT=\"$(shasum "$RB" | awk '{print $1}')\""
  q "SELECT '  PRE_MD5  = ' || md5(p.prosrc) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='admin_initiate_order_refund';"
  q "SELECT '  SM_MD5   = ' || md5(p.prosrc) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='pcm_order_refund_status_transition';"
  q "SELECT '  CMT_MD5  = ' || md5(obj_description(p.oid,'pg_proc')) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='admin_initiate_order_refund';"
  q "SELECT '  VIEWDEF  = ' || md5(pg_get_viewdef('public.payment_refund_effective_terminal'))
             || '   ⚠️ 本機值,正式庫必須另量(pg_get_viewdef 隨版本正規化)';"
  q "SELECT '  PGVER    = ' || current_setting('server_version');"
}

mode_run() {
  log "0. 前置:2f 必須已在庫(post-image 相符)"
  val "0-1 post-image md5" "$POST_MD5_EXPECT" \
    "SELECT md5(p.prosrc) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='admin_initiate_order_refund';"

  log "A 結構(屬性保留;CREATE OR REPLACE 會把沒寫的子句打回預設)"
  val "A1 proconfig 含 search_path=public, pg_temp" true \
    "SELECT ('search_path=public, pg_temp' = ANY(proconfig))::text FROM pg_proc p
      JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='admin_initiate_order_refund';"
  val "A2 proconfig 含 lock_timeout=10s(Sean Q-2f-1)" true \
    "SELECT ('lock_timeout=10s' = ANY(proconfig))::text FROM pg_proc p
      JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='admin_initiate_order_refund';"
  # 🔴 A1/A2 只證「這兩個設定在」;migration 後置④ 已改成整串相等(多一個 SET 也要擋)⇒ 鏡像跟上
  val "A2b proconfig 整串相等(多一個 SET = 本片沒宣告過的行為改動)" '{"search_path=public, pg_temp",lock_timeout=10s}' \
    "SELECT proconfig::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='admin_initiate_order_refund';"
  val "A3 prosecdef 仍為真" true \
    "SELECT prosecdef::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='admin_initiate_order_refund';"
  val "A4 owner=postgres" postgres \
    "SELECT pg_get_userbyid(proowner) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='admin_initiate_order_refund';"
  val "A5 service_role 仍有 EXECUTE" true \
    "SELECT has_function_privilege('service_role',
      'public.admin_initiate_order_refund(uuid, text, integer, bigint, bigint, text, text, text)','EXECUTE')::text;"
  val "A6 anon 沒有 EXECUTE" false \
    "SELECT has_function_privilege('anon',
      'public.admin_initiate_order_refund(uuid, text, integer, bigint, bigint, text, text, text)','EXECUTE')::text;"
  like "A7 COMMENT 逐字含終局集合(母 plan :358)" "confirmed / failed / deferred" \
    "SELECT obj_description(p.oid,'pg_proc') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='admin_initiate_order_refund';"
  like "A8 COMMENT 保留既有 8 碼全集(未被截)" "REFUND_NOTHING_LEFT。" \
    "SELECT obj_description(p.oid,'pg_proc') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='admin_initiate_order_refund';"

  log "B 順序錨(剝註解後比字元位置;廉價前哨,真判別力在 L2 消融)"
  val "B1 advisory 早於 FOR NO KEY UPDATE" true \
    "SELECT (strpos(s,'pg_advisory_xact_lock') > 0
             AND strpos(s,'pg_advisory_xact_lock') < strpos(s,'FOR NO KEY UPDATE'))::text
       FROM (SELECT regexp_replace(p.prosrc,'--[^'||chr(10)||']*','','g') s
               FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='public' AND p.proname='admin_initiate_order_refund') t;"
  val "B2 否決晚於 G4 冪等查驗" true \
    "SELECT (strpos(s,'WHERE request_id = v_req') > 0
             AND strpos(s,'WHERE request_id = v_req') < strpos(s,'payment_refund_effective_terminal'))::text
       FROM (SELECT regexp_replace(p.prosrc,'--[^'||chr(10)||']*','','g') s
               FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='public' AND p.proname='admin_initiate_order_refund') t;"
  val "B3 剝註解後 FOR UPDATE 出現 0 次(NKU 不含該子字串,直接數即可)" 0 \
    "SELECT ((length(s) - length(replace(s,'FOR UPDATE','')))/10)::text
       FROM (SELECT regexp_replace(p.prosrc,'--[^'||chr(10)||']*','','g') s
               FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='public' AND p.proname='admin_initiate_order_refund') t;"
  # 🔴 B4 是 migration 後置② 的**鏡像**:那邊改了形狀而這裡沒跟著改,就會出現
  #    「migration 擋得住、harness 說沒事」的分裂(R1v6 逐字抓到過一次)。判準只准有一份意思:
  #    抽整個引數式子(不是其中的 substr 片段)+ 只正規化白名單那兩個識別字。
  val "B4 鎖鍵與 2e 逐字等價(抽整串引數;識別字白名單正規化)" true \
    "SELECT (btrim(regexp_replace(regexp_replace(substring(
              regexp_replace(a.prosrc,'--[^'||chr(10)||']*','','g'),
              'pg_advisory_xact_lock\\s*\\(([^;]*)\\)\\s*;'),'\\s+',' ','g'),
              '\\m(p_order_id|v_order_id_pre)\\M::text','ORDERID::text'))
          = btrim(regexp_replace(regexp_replace(substring(
              regexp_replace(b.prosrc,'--[^'||chr(10)||']*','','g'),
              'pg_advisory_xact_lock\\s*\\(([^;]*)\\)\\s*;'),'\\s+',' ','g'),
              '\\m(p_order_id|v_order_id_pre)\\M::text','ORDERID::text')))::text
       FROM pg_proc a, pg_proc b
      WHERE a.proname='admin_initiate_order_refund' AND b.proname='close_released_attempt';"
  # 🔴 B4b:plan §8 要的是「同一張單分別走 2e/2f、觀察到**同一個鎖鍵**」,而上面那格只比文字。
  #    文字相同是手段、同鍵才是結論 —— 兩支各自把式子**實際算一次**、比 bigint,才叫觀察到同一把鎖。
  #    做法:從各自 prosrc 抽出引數式子,把來源識別字換成同一顆訂單 uuid 字面,EXECUTE 求值。
  #    (呼叫 2e 本人需要 released attempt 的完整 fixture;求值路徑走的是同一段字面,結論一樣硬。)
  sqlx "CREATE OR REPLACE FUNCTION public.pcm_2f_eval_key(p_expr text) RETURNS bigint
        LANGUAGE plpgsql AS \$k\$ DECLARE v bigint; BEGIN EXECUTE 'SELECT ' || p_expr INTO v; RETURN v; END \$k\$;"
  val "B4b 2e/2f 的鍵式子對同一顆 order_id 求值 = 同一個 bigint(非 NULL)" true \
    "WITH x AS (
       SELECT p.proname,
              regexp_replace(regexp_replace(substring(
                regexp_replace(p.prosrc,'--[^'||chr(10)||']*','','g'),
                'pg_advisory_xact_lock\\s*\\(([^;]*)\\)\\s*;'),'\\s+',' ','g'),
                '\\m(p_order_id|v_order_id_pre)\\M',
                quote_literal('11111111-2222-4333-8444-555555555555')||'::uuid') AS e
         FROM pg_proc p
        WHERE p.proname IN ('admin_initiate_order_refund','close_released_attempt'))
     SELECT (k2f IS NOT NULL AND k2f = k2e)::text FROM (
       SELECT public.pcm_2f_eval_key((SELECT e FROM x WHERE proname='admin_initiate_order_refund')) k2f,
              public.pcm_2f_eval_key((SELECT e FROM x WHERE proname='close_released_attempt')) k2e) t;"
  sqlx "DROP FUNCTION public.pcm_2f_eval_key(text);"

  # 🔴 B5:「在途」述詞是**跨五處手抄**的(v9;diff 層 R3 IMP)——
  #    migration 的函式本體、migration 後置⑧、rollback 閘②c、rollback ②c-recheck、本檔的 RB0/PRED。
  #    鎖鍵因為 R1 MF4 拿到了跨函式等價斷言(後置②),而**同樣吃重的在途定義一份等價釘都沒有**。
  #    真正的失效時點不是今天:**2g 上線時那個定義必然被重新談判**(例如新增一種 event_type),
  #    改了函式那一份之後,閘②c 會用**過期定義**判「無在途、可回退」——放行的正是新定義下的在途單。
  #    ⇒ 機械判準:三個檔裡所有出現的述詞,剝註解 + 空白正規化之後**必須逐字同一份**。
  local pred_uniq pred_hits
  pred_hits="$(for f in "$MIG" "$RB" "$0"; do
      sed 's/--.*$//' "$f" | tr '\n' ' ' | tr -s ' ' \
        | grep -o "NOT EXISTS (SELECT 1 FROM public\.payment_refund_effective_terminal[^;]*result_success')"
    done)"
  pred_uniq="$(printf '%s\n' "$pred_hits" | grep -c . )"
  val "B5 在途述詞跨檔逐字等價(五處手抄;不同步 = 閘②c 用過期定義放行)" 1 \
    "SELECT '$(printf '%s\n' "$pred_hits" | sort -u | grep -c .)'::text;"
  if [ "$pred_uniq" -lt 5 ]; then
    FAIL=$((FAIL+1)); printf '  ❌ B5b 只抽到 %s 處述詞(期望 ≥5)⇒ 抽取式子過期,這格的綠燈不算數\n' "$pred_uniq"
  else
    PASS=$((PASS+1)); printf '  ✅ B5b 抽到 %s 處述詞(≥5;證明上面那格比的是**全部**副本不是零個)\n' "$pred_uniq"
  fi

  log "C 跨帳本否決(🔴 2g 未建 ⇒ 以下 payment_refunds 列全是本檔直接 INSERT 造的)"
  ensure_customer
  local O1 A1 A1b O2 A2 R RID
  O1="$(mk_order paid)";  need_uuid "$O1"
  A1="$(mk_attempt "$O1")"; need_uuid "$A1"
  A1b="$(mk_attempt "$O1")"; need_uuid "$A1b"
  O2="$(mk_order paid)";  need_uuid "$O2"
  A2="$(mk_attempt "$O2")"; need_uuid "$A2"

  # C1:父列存在、無任何事件 ⇒ 擋
  R="$(mk_refund "$A1")"
  RID="$(uuid4)"
  val "C1 無事件的在途退款 ⇒ REFUND_IN_FLIGHT" "REFUND_IN_FLIGHT" \
    "SELECT public.admin_initiate_order_refund('$O1'::uuid,'partial',100,0,NULL,'c1','harness_actor','$RID')->>'result';"
  val "C1b 回傳帶 blocking_payment_refund_id" "$R" \
    "SELECT public.admin_initiate_order_refund('$O1'::uuid,'partial',100,0,NULL,'c1b','harness_actor','$(uuid4)')->>'blocking_payment_refund_id';"

  # C2:補終局事件 ⇒ 放行,且**真的**多一列 order_refunds(不是「不再回 IN_FLIGHT」就算過)
  mk_event "$R" result_confirmed 1
  RID="$(uuid4)"
  val "C2 補 result_confirmed ⇒ INITIATED" "INITIATED" \
    "SELECT public.admin_initiate_order_refund('$O1'::uuid,'partial',100,0,NULL,'c2','harness_actor','$RID')->>'result';"
  val "C2b order_refunds 真的多一列" 1 \
    "SELECT count(*)::text FROM public.order_refunds WHERE order_id='$O1'::uuid AND request_id='$RID';"
  val "C2c 金額正確" 100 \
    "SELECT refund_amount::text FROM public.order_refunds WHERE request_id='$RID';"
  sqlx "UPDATE public.order_refunds SET status='failed', failed_reason='not_sent' WHERE request_id='$RID';"

  # C3:沿鏈重試 —— 舊列無終局、被新根接手;**新根自己帶終局**(R3 F1:否則兩臂不可分辨)
  local ROLD RNEW
  ROLD="$(mk_refund "$A1b")"
  RNEW="$(mk_refund "$A1b" "$ROLD")"
  mk_event "$RNEW" result_failed 1
  RID="$(uuid4)"
  val "C3 沿鏈重試(舊列被接手+新根已終局)⇒ 放行" "INITIATED" \
    "SELECT public.admin_initiate_order_refund('$O1'::uuid,'partial',100,0,NULL,'c3','harness_actor','$RID')->>'result';"
  sqlx "UPDATE public.order_refunds SET status='failed', failed_reason='not_sent' WHERE request_id='$RID';"

  # C4:只有 result_success(已受理未確認)⇒ **放行**(Sean Q-2f-2=B;v3 的「仍擋」已整格反向)
  local RS
  RS="$(mk_refund "$A2")"
  mk_event "$RS" result_success 1
  RID="$(uuid4)"
  val "C4 只有 result_success ⇒ 放行(Q-2f-2=B)" "INITIATED" \
    "SELECT public.admin_initiate_order_refund('$O2'::uuid,'partial',100,0,NULL,'c4','harness_actor','$RID')->>'result';"
  sqlx "UPDATE public.order_refunds SET status='failed', failed_reason='not_sent' WHERE request_id='$RID';"

  # C5:order 尺度 —— 同單**另一顆 attempt** 的在途退款也擋
  local RB2
  RB2="$(mk_refund "$A1b")"
  val "C5 同單另一顆 attempt 的在途退款也擋(order 尺度)" "REFUND_IN_FLIGHT" \
    "SELECT public.admin_initiate_order_refund('$O1'::uuid,'partial',100,0,NULL,'c5','harness_actor','$(uuid4)')->>'result';"
  # C6:別張單的在途退款不影響本單
  val "C6 別張單的在途退款不擋本單" "INITIATED" \
    "SELECT public.admin_initiate_order_refund('$O2'::uuid,'partial',100,0,NULL,'c6','harness_actor','$(uuid4)')->>'result';"
  sqlx "UPDATE public.order_refunds SET status='failed', failed_reason='not_sent' WHERE order_id='$O2'::uuid AND status='processing';"

  log "D 語意(位置正確才會有這些行為)"
  # D1:重播必須仍拿 DUPLICATE_REQUEST(證否決排在 G4 之後)
  local ODUP ADUP RDUP
  ODUP="$(mk_order paid)"; ADUP="$(mk_attempt "$ODUP")"
  RDUP="$(uuid4)"
  val "D1a 首次送出 ⇒ INITIATED" "INITIATED" \
    "SELECT public.admin_initiate_order_refund('$ODUP'::uuid,'partial',100,0,NULL,'d1','harness_actor','$RDUP')->>'result';"
  mk_refund "$ADUP" >/dev/null        # 事後掛一筆在途退款
  val "D1b 同 request_id 重播 + 身上有在途退款 ⇒ 仍是 DUPLICATE_REQUEST" "DUPLICATE_REQUEST" \
    "SELECT public.admin_initiate_order_refund('$ODUP'::uuid,'partial',100,0,NULL,'d1','harness_actor','$RDUP')->>'result';"

  # D2:訂單已 refunded ⇒ LEDGER_FULL 優先於 IN_FLIGHT(證 B 排在步 5/6 之後)
  local OFULL AFULL
  OFULL="$(mk_order refunded)"; AFULL="$(mk_attempt "$OFULL")"
  mk_refund "$AFULL" >/dev/null
  val "D2 已 refunded + 有在途退款 ⇒ 具體診斷 LEDGER_FULL 優先" "REFUND_LEDGER_FULL" \
    "SELECT public.admin_initiate_order_refund('$OFULL'::uuid,'partial',100,0,NULL,'d2','harness_actor','$(uuid4)')->>'result';"

  # D3:p_order_id NULL(R2 N1:結果無害,但要實跑釘住而不是推論)
  val "D3 p_order_id NULL ⇒ ORDER_NOT_FOUND" "ORDER_NOT_FOUND" \
    "SELECT public.admin_initiate_order_refund(NULL::uuid,'partial',100,0,NULL,'d3','harness_actor','$(uuid4)')->>'result';"

  log "E 回傳碼閉集(靜態抽 prosrc,抽樣證不到「不存在第 9 碼」)"
  # 🔴 E1/E2 也是 migration 後置⑦/⑥ 的鏡像。舊寫法是**枚舉式**:只認「'result', '大寫字面'」
  #    與「e.event_type = '字面'」這兩種寫法,改寫法就抽不到 ⇒ 零命中 ⇒ 綠燈(與 migration 同病)。
  #    改成與那邊同一個形狀:計數相等 + 絕對數,不去猜有哪些寫法。
  val "E1a result 鍵出現數 = 緊接 8 碼字面的數(改用變數/串接會讓兩數不等)" true \
    "WITH s AS (SELECT regexp_replace(regexp_replace(p.prosrc,'--[^'||chr(10)||']*','','g'),'\\s+',' ','g') n
                  FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
                 WHERE ns.nspname='public' AND p.proname='admin_initiate_order_refund')
     SELECT ((SELECT count(*) FROM s, regexp_matches(s.n,'''result''','g'))
           = (SELECT count(*) FROM s, regexp_matches(s.n,'''result'', ''(INITIATED|DUPLICATE_REQUEST|ORDER_NOT_FOUND|ORDER_NOT_REFUNDABLE|ORDER_NO_CARD_TRANSACTION|REFUND_LEDGER_FULL|REFUND_IN_FLIGHT|REFUND_NOTHING_LEFT)''','g')))::text;"
  val "E1b result 鍵的絕對數 = 10(串接組鍵會讓兩數**同步**變少、相等照樣成立)" 10 \
    "WITH s AS (SELECT regexp_replace(regexp_replace(p.prosrc,'--[^'||chr(10)||']*','','g'),'\\s+',' ','g') n
                  FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
                 WHERE ns.nspname='public' AND p.proname='admin_initiate_order_refund')
     SELECT (SELECT count(*) FROM s, regexp_matches(s.n,'''result''','g'))::text;"
  val "E2 carve-out:event_type 出現 1 處、且是唯一獲准形式(含左鄰 AND ⇒ 加否定詞會掉到 0)" true \
    "WITH s AS (SELECT regexp_replace(regexp_replace(p.prosrc,'--[^'||chr(10)||']*','','g'),'\\s+',' ','g') n
                  FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
                 WHERE ns.nspname='public' AND p.proname='admin_initiate_order_refund')
     SELECT ((SELECT count(*) FROM s, regexp_matches(s.n,'event_type','g')) = 1
         AND (SELECT count(*) FROM s, regexp_matches(s.n,'AND e\\.event_type = ''result_success''\\)','g')) = 1)::text;"
  val "E3 三條在途述詞的 NOT EXISTS 包裝都還在(EXISTS 化=語意反轉、座標不動)" true \
    "WITH s AS (SELECT regexp_replace(regexp_replace(p.prosrc,'--[^'||chr(10)||']*','','g'),'\\s+',' ','g') n
                  FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
                 WHERE ns.nspname='public' AND p.proname='admin_initiate_order_refund')
     SELECT ((SELECT count(*) FROM s, regexp_matches(s.n,'NOT EXISTS \\(SELECT 1 FROM public\\.payment_refund_effective_terminal ','g')) = 1
         AND (SELECT count(*) FROM s, regexp_matches(s.n,'NOT EXISTS \\(SELECT 1 FROM public\\.payment_refunds s WHERE s\\.supersedes_refund_id ','g')) = 1
         AND (SELECT count(*) FROM s, regexp_matches(s.n,'NOT EXISTS \\(SELECT 1 FROM public\\.payment_refund_events e ','g')) = 1)::text;"

  log "L 鎖(直接觀察 advisory 本身,不用「第二條有沒有排隊」推論)"
  # 🔴 R2 IMP-5:拿掉 advisory 之下「第二條被擋」照樣成立(既有 FOR NO KEY UPDATE 也會擋)
  #    ⇒ 必須量 advisory 鎖本身在 pg_locks 的存在與鍵值。
  local OL AL KEY
  OL="$(mk_order paid)"; AL="$(mk_attempt "$OL")"
  KEY="$(q "SELECT (('x'||substr(replace('$OL','-',''),1,16))::bit(64)::bigint)::text;")"
  # 🔴 bigint → oid 一律走 `& 4294967295 再 ::oid`,不可走 ::int(R1 折疊時實測):
  #    pg_locks 的 classid/objid 是 **oid = 無號 32 位**,而 int 是有號的
  #    ⇒ 半段值落在 2^31..2^32-1 時 `::int` 直接 ERROR: integer out of range,
  #      這格就變成「錯誤字串 ≠ 1」的假紅。鍵由 order_id 決定 ⇒ 這是**看訂單抽到什麼才發作**的 flake:
  #      先前跑綠只是那幾顆 uuid 剛好沒撞上,不是這格對。
  val_last "L1 呼叫中持有預期鍵的 advisory 鎖" 1 \
    "BEGIN;
     SELECT public.admin_initiate_order_refund('$OL'::uuid,'partial',100,0,NULL,'l1','harness_actor','$(uuid4)');
     SELECT count(*)::text FROM pg_locks
      WHERE locktype='advisory'
        AND classid = ((($KEY)::bigint >> 32) & 4294967295)::oid
        AND objid   = (($KEY)::bigint & 4294967295)::oid
        AND objsubid = 1;
     ROLLBACK;" 2>/dev/null || true
  val "L1b 交易結束後 advisory 已釋放" 0 \
    "SELECT count(*)::text FROM pg_locks WHERE locktype='advisory'
      AND classid = ((($KEY)::bigint >> 32) & 4294967295)::oid;"

  # 🔴 L2:lock_timeout 是**員工會直接看到**的行為,而 A2/A2b 只證了 catalog 裡有那個值。
  #    「設定寫著 10s」與「真的等到 10 秒就放手」是兩件事(函式層 SET 的 save/restore 邊界、
  #    advisory 等待是否吃這個 GUC —— 兩者都只能實跑才知道)。plan 規格要的是後者。
  #    做法:另一條連線先佔住同一把 advisory 並睡著,本連線呼叫 2f、量它多久失敗。
  local OT AT KEY2 holder t0 t1 el outp rc2
  OT="$(mk_order paid)"; need_uuid "$OT"
  AT="$(mk_attempt "$OT")"; need_uuid "$AT"
  KEY2="$(q "SELECT (('x'||substr(replace('$OT','-',''),1,16))::bit(64)::bigint)::text;")"
  psql "$URL" -qtAX -c "BEGIN; SELECT pg_advisory_xact_lock($KEY2); SELECT pg_sleep(30); ROLLBACK;" >/dev/null 2>&1 &
  holder=$!
  sleep 2
  t0=$(date +%s)
  # 🔴 判「被 lock_timeout 中止」**不撈訊息文字**(v9;diff 層 R3 IMP —— 這是同族第四例):
  #    v8 已經因為「從訊息撈 SQLSTATE、繁中語系下五格全誤判」修過 probe_* 家族,
  #    **卻沒回頭修 L2** —— L2 當時還在 `grep -qi 'lock timeout'` 撈英文字面。
  #    它現在在這台機器上過,是因為那句話剛好沒被翻譯 = **運氣不是設計**。
  #    ⇒ 改成讓 DB 自己吐 SQLSTATE(55P03 = lock_not_available),與語系、與 psql 版本都無關。
  #    教訓寫在這裡:**修一族的時候要問「這族還有誰」** —— 我修了 probe_*,漏了同族的 L2。
  outp="$(probe_sql "PERFORM public.admin_initiate_order_refund('$OT'::uuid,'partial',100,0,NULL,'l2','harness_actor','$(uuid4)');")"
  t1=$(date +%s); el=$((t1-t0))
  kill "$holder" >/dev/null 2>&1 || true
  wait "$holder" 2>/dev/null || true
  # 期望窗刻意寬(8-20 秒):要證的是「大約在 10 秒這個量級失敗」,不是毫秒級準度;
  # 窗太窄會變成量機器負載、窗太寬(例如只要 >0)就證不到那個值有生效。
  if printf '%s' "$outp" | grep -q 'PCM_PROBE_SQLSTATE=55P03' \
     && [ "$el" -ge 8 ] && [ "$el" -le 20 ]; then
    PASS=$((PASS+1)); printf '  ✅ L2 等鎖 %s 秒後被 lock_timeout 中止(SQLSTATE=55P03,期望窗 8-20 秒)\n' "$el"
  else
    FAIL=$((FAIL+1))
    printf '  ❌ L2 lock_timeout 沒在預期時間以預期方式失敗:elapsed=%ss\n' "$el"
    printf '     輸出尾=[%s]\n' "$(printf '%s' "$outp" | tail -2)"
  fi

  echo
  echo "════ run 小計:PASS=$PASS FAIL=$FAIL ════"
  [ "$FAIL" -eq 0 ]
}

mode_rb() {
  log "RB 回退三態"
  # 🔴 前置:run 模式的 C/D 格會留下**仍在途**的 payment_refunds(C5/D1/D2 那幾筆刻意不給終局)。
  #    回退閘②c 會因此拒絕回退 —— 那是它該做的事(撤掉否決 = 那些單立刻可再開一筆並行退款),
  #    不是 bug。⇒ 這裡先用**領域正確**的方式解除在途:補終局事件(append-only,不 DELETE)。
  #    閘②c 自己的負測在 neg 模式 N5,不靠這裡驗。
  sqlx "INSERT INTO public.payment_refund_events (refund_id, event_type, seq, lease_token)
        SELECT pr.id, 'result_confirmed',
               COALESCE((SELECT max(e2.seq) FROM public.payment_refund_events e2 WHERE e2.refund_id = pr.id), 0) + 1,
               0
          FROM public.payment_refunds pr
         WHERE NOT EXISTS (SELECT 1 FROM public.payment_refund_effective_terminal et WHERE et.refund_id = pr.id)
           AND NOT EXISTS (SELECT 1 FROM public.payment_refunds s WHERE s.supersedes_refund_id = pr.id)
           AND NOT EXISTS (SELECT 1 FROM public.payment_refund_events e
                            WHERE e.refund_id = pr.id AND e.event_type = 'result_success');"
  val "RB0 前置:已無在途 payment_refunds(否則閘②c 會擋、後面每格都假紅)" 0 \
    "SELECT count(*)::text FROM public.payment_refunds pr
      WHERE NOT EXISTS (SELECT 1 FROM public.payment_refund_effective_terminal et WHERE et.refund_id = pr.id)
        AND NOT EXISTS (SELECT 1 FROM public.payment_refunds s WHERE s.supersedes_refund_id = pr.id)
        AND NOT EXISTS (SELECT 1 FROM public.payment_refund_events e
                         WHERE e.refund_id = pr.id AND e.event_type = 'result_success');"
  # RB1:2g writer 在庫 ⇒ 閘① abort
  sqlx "CREATE FUNCTION public.rb2f_fake_2g() RETURNS void LANGUAGE plpgsql AS \$x\$
        BEGIN INSERT INTO public.payment_refunds(attempt_id) VALUES (NULL); END \$x\$;"
  local out
  out="$(psql "$URL" -v ON_ERROR_STOP=1 -f "$RB" 2>&1)"
  case "$out" in *l5b2_2f_rb_2g_present*|*"2g writer 疑似在庫"*)
      PASS=$((PASS+1)); echo "  ✅ RB1 2g writer 在庫 ⇒ 閘① abort" ;;
    *) FAIL=$((FAIL+1)); echo "  ❌ RB1 未被閘① 擋住"; echo "$out" | tail -3 ;;
  esac
  sqlx "DROP FUNCTION public.rb2f_fake_2g();"

  # RB2:正常回退
  out="$(psql "$URL" -v ON_ERROR_STOP=1 -f "$RB" 2>&1)"
  case "$out" in *"2f 回退完成"*) PASS=$((PASS+1)); echo "  ✅ RB2 正常回退成功" ;;
    *) FAIL=$((FAIL+1)); echo "  ❌ RB2 回退失敗"; echo "$out" | tail -5 ;; esac
  val "RB2b 回到 pre-image" "$PRE_MD5_EXPECT" \
    "SELECT md5(p.prosrc) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='admin_initiate_order_refund';"
  val "RB2c lock_timeout 已消失" false \
    "SELECT (proconfig::text LIKE '%lock_timeout%')::text FROM pg_proc p
      JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='admin_initiate_order_refund';"

  # RB3:再跑一次 = 冪等路徑
  out="$(psql "$URL" -v ON_ERROR_STOP=1 -f "$RB" 2>&1)"
  case "$out" in *"先前已回退過"*) PASS=$((PASS+1)); echo "  ✅ RB3 冪等路徑(非零寫入,字面已註明)" ;;
    *) FAIL=$((FAIL+1)); echo "  ❌ RB3 冪等路徑沒走到"; echo "$out" | tail -3 ;; esac

  # RB4:第三態 ⇒ abort
  sqlx "COMMENT ON FUNCTION public.admin_initiate_order_refund(uuid, text, integer, bigint, bigint, text, text, text) IS 'third state probe';"
  psql "$URL" -qtAX -v ON_ERROR_STOP=1 -c "CREATE OR REPLACE FUNCTION public.admin_initiate_order_refund(
      p_order_id uuid, p_kind text, p_amount integer, p_record_refunded_before bigint,
      p_record_amount bigint, p_reason text, p_actor text, p_request_id text)
    RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
    AS \$z\$ BEGIN RETURN jsonb_build_object('result','ORDER_NOT_FOUND'); END \$z\$;" >/dev/null
  out="$(psql "$URL" -v ON_ERROR_STOP=1 -f "$RB" 2>&1)"
  case "$out" in *l5b2_2f_rb_third_state*|*"既不是 2f post-image"*)
      PASS=$((PASS+1)); echo "  ✅ RB4 第三態 ⇒ abort" ;;
    *) FAIL=$((FAIL+1)); echo "  ❌ RB4 第三態沒被擋"; echo "$out" | tail -3 ;; esac

  echo
  echo "════ rb 小計:PASS=$PASS FAIL=$FAIL ════"
  [ "$FAIL" -eq 0 ]
}


# ══ mut:每靶一座全新叢集,改壞一處 → 記錄實際紅在哪 ═══════════════════════
# 🔴 紅格由**實跑輸出**決定,不由預測。靶分兩類:
#    ①apply 期靶:改壞的東西應該被前置/後置閘擋住 ⇒ 期望「apply 失敗」且訊息含指定 constraint。
#    ②行為期靶:apply 得過(閘看不到),但 run 模式應該有指定的格翻紅 ⇒ 期望「該格 FAIL」。
#    一個靶若兩類都不紅 = 那條守門沒有判別力,必須照實記。
# 🔴 teardown 失敗時,舊叢集仍在聽同一個埠 ⇒ 下一靶的 `psql` 會**連到那個殘留叢集**,
#    在錯誤的環境上跑出看起來正常的結果(這次是失敗跳過才被發現,它同樣可能默默給綠燈)。
#    ⇒ provision 前必須先證「埠是空的」,provision 後必須證「這是新叢集」。
wait_port_free() {
  local i
  for i in 1 2 3 4 5 6 7 8 9 10; do
    lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 || return 0
    sleep 1
  done
  die "PORT=$PORT 在 10 秒後仍有人聽 ⇒ 拒絕在殘留叢集上跑(結果會是假的)"
}
assert_fresh_cluster() {
  # 🔴 判別點必須是「只有本 harness 會寫」的東西。
  #    我一度用 orders 筆數當新鮮度指標 —— 錯的:那個「0」來自一次**失敗的** provision
  #    (2f 的 PIN 未填、seed 那步根本沒跑到)⇒ 我拿壞掉的狀態推出了不變量。
  #    provision 正常跑完會建種子訂單。payment_refunds 才是真的只有本檔會寫(2g 未建)。
  local n; n="$(q "SELECT count(*)::text FROM public.payment_refunds;")"
  [ "$n" = "0" ] || die "叢集不是新的:payment_refunds 已有 $n 筆(= 前一靶的殘留)⇒ 拒跑"
}

# 從 run 模式輸出抽「紅格集合」= 每個 ❌ 標籤的第一個 token(C3 / 0-1 / B4 …)
red_set() { printf '%s\n' "$1" | grep -o '❌ [^ ]*' | sed 's/❌ //' | sort -u; }

mode_mut() {
  local WORKM="${WORK}-mut" REPORT MUT_FAIL=0 BASE_RED="" M0_DONE=0
  # 🔴 報告檔名帶 PORT:/tmp 的固定檔名會被別的窗覆寫,而「檔案存在且非空」對覆寫零判別力
  #    (2026-08-13 D 窗實錘:差點拿別窗的內容當自己的產物)。PORT 是本檔既有的平行窗鑰匙。
  REPORT="/tmp/2f-mut-report-$PORT.txt"; : > "$REPORT"
  # 🔴 M0 基線(R1 D「判別力歸錯人」):行為靶必然改到 prosrc,而 run 裡有格
  #    (0-1 post-image md5)對**任何**源碼變動都會紅 ⇒ 用「有沒有出現那個標籤」當判準,
  #    等於把那一格的功勞記到被測守門頭上。
  #    ⇒ 先跑一個**行為惰性**突變(只改函式本體裡的註解文字),量出「純因源碼變動就會紅」的
  #      格集合 = BASE_RED;行為靶判準改成 期望格 ∈ (該靶紅格集合 − BASE_RED)。
  #      BASE_RED 是**實跑量出來的**,不是宣告的。
  local M0_SED='s/-- 步 1\. 輸入衛生/-- 步 1. 輸入衛生 [M0 惰性突變:只改這行註解]/'
  # sed 腳本 | 類型 | 期望紅在哪
  local -a T=(
    "s/pg_catalog.pg_advisory_xact_lock/pg_catalog.pg_advisory_xact_lock_shared/|apply|l5b2_2f_advisory_exclusive_only|M1 advisory 換成 shared 版(順序錨與鍵等價都綠,但互斥失效)"
    "s/, 1, 16)/, 1, 15)/|apply|l5b2_2f_key_equivalence|M2 鍵式子截 15 字(三方不再同一把鎖)"
    "s/SET lock_timeout = '10s'/-- lock_timeout 被拿掉/|apply|l5b2_2f_proconfig|M3 省略 lock_timeout 子句"
    "s/SET search_path = public, pg_temp/SET search_path = ''/|apply|l5b2_2f_proconfig|M4 照抄 2e 的 search_path=''(plan §1-2② 明文禁止)"
    "s/^SECURITY DEFINER$/SECURITY INVOKER/|apply|l5b2_2f_attrs_preserved|M5 省略 SECURITY DEFINER"
    "s/AND e.event_type = 'result_success')/AND e.event_type = 'result_confirmed')/|apply|l5b2_2f_carveout_scope|M6 carve-out 擴大到別的 event_type"
    # 🔴 M7 不能再用「換成 WHERE false」:那會把 supersedes_refund_id 的字面一起拿掉,
    #    新的後置①e-2(否定詞保存:該識別字出現數 = 包在 NOT EXISTS 裡的數 = 1)會在 **apply 期**攔下
    #    ⇒ 行為格 C3 跑不到、判別力歸給閘(與 M8 當初同一個坑)。
    #    改成**保留字面、只讓關聯條件錯掉**:對到 pr.attempt_id(型別合法、實務上恆不成立)
    #    ⇒ 沿鏈接手的舊列不再被排除 ⇒ C3 應該翻紅。
    "s/WHERE s.supersedes_refund_id = pr.id)/WHERE s.supersedes_refund_id = pr.attempt_id)/|behavior|C3|M7 沿鏈排除的關聯條件錯掉(R2 MF-B 那條)"
    # 🔴 M8 不能用「把整段換成 WHERE false」:那會連 event_type 的字面一起拿掉,
    #    後置⑥(現在要求 event_type 恰好出現 1 次、且恰好是獲准形式)會在 **apply 期**就攔下,
    #    行為格 C4 根本跑不到 ⇒ 判別力歸給了閘、C4 沒被驗到(第一次實跑就是這樣紅的)。
    #    改成**保留合約字面、只讓述詞失效**:把關聯條件換成恆不成立的 refund_id IS NULL
    #    ⇒ NOT EXISTS 恆真 ⇒ result_success 的排除等於沒有 ⇒ C4 應該翻紅。
    # 🔴 期望集合是 **C4 C6** 而不是只有 C4:兩格用的是同一張單 O2,
    #    這個突變讓 O2 身上那筆 result_success 退款重新算在途 ⇒ C4(該放行)與 C6(別張單不擋本單)
    #    一起翻紅。這是 fixture 共用造成的真實爆炸半徑,**照實跑填、不修剪期望值**。
    "s/WHERE e.refund_id = pr.id AND e.event_type/WHERE e.refund_id IS NULL AND e.event_type/|behavior|C4 C6|M8 讓 result_success 排除失效(Sean Q-2f-2=B 那條)"
    "s/'f4e3aa5b5afb9e886b0b2820a4c4b34b'/'00000000000000000000000000000000'/|apply|l5b2_2f_2e_postimage_required|M9 2e 成組閘餵錯 md5"
    "s/'d20e9c8e9702d4b9b975105b91e051d1'/'00000000000000000000000000000000'/|apply|l5b2_2f_viewdef_pinned|M10 canonical view 指紋餵錯"
    "s/::bit(64)::bigint)/::bit(64)::bigint + 1)/|apply|l5b2_2f_key_equivalence|M11 鍵尾巴 +1(舊形狀只比 substr 片段 ⇒ 片段一字未動、照樣綠)"
    "s/PERFORM pg_catalog.pg_advisory_xact_lock(/PERFORM pg_catalog.pg_advisory_xact_lock(0); PERFORM pg_catalog.pg_advisory_xact_lock(/|apply|l5b2_2f_advisory_call_once|M12 多鎖一顆常數鍵(抽取只看得到第一顆 ⇒ 等價斷言仍綠)"
    # P2 / P8 的負測走「把釘值餵錯」這條(它們釘的是庫裡的現況,改庫狀態反而不可逆)
    "s/'f98e25f58dde8306772e157f0c7cc5cb'/'00000000000000000000000000000000'/|apply|l5b2_2f_preimage_mismatch|M13 ② pre-image 指紋餵錯(P2)"
    "s/'9656887fa0b2032d03ac0e39fa2fac8d'/'00000000000000000000000000000000'/|apply|l5b2_2f_comment_baseline|M14 ② COMMENT 基線指紋餵錯(P8)"
    # 後置斷言的靶(⑦ 閉集 / ⑤ COMMENT 前綴 / 鎖強度)
    "s/'REFUND_NOTHING_LEFT')/'REFUND_NOTHING_LEFT_9')/|apply|l5b2_2f_result_code_closure|M15 冒出第 9 個回傳碼(後置⑦)"
    "s/M-3 A7c RW1a 退款登記 RPC/M-3 A7c RW1a 退款登記 RPC 改過/|apply|l5b2_2f_comment_prefix|M16 COMMENT 舊全文被改字(後置⑤;舊 LIKE 形狀對 _ 當萬用字元全盲)"
    # 🔴 期望值照**實跑**填:我原本預測會擋在 ①a(順序錨,因為 i_nku 變 0),
    #    實跑擋在 ①c 鎖強度。紅格由實跑決定、不由預測 —— 這條規矩對「期望值」本身也適用。
    "s/FOR NO KEY UPDATE/FOR UPDATE/|apply|l5b2_2f_anchor_lock_strength|M17 鎖強度改成 FOR UPDATE(與 FK RI 死結那條)"
    # ── v6 二折新增的守門,各自配一個「照著 codex 指出的繞法做一次」的靶 ──────────
    #    這四個靶就是 R1v6 那四條 must-fix 的繞法本身:靶不紅 = 那條 finding 沒有真的被修掉。
    "s/AND NOT EXISTS (SELECT 1 FROM public.payment_refund_effective_terminal et/AND EXISTS (SELECT 1 FROM public.payment_refund_effective_terminal et/|apply|l5b2_2f_veto_negation_terminal|M18 把 NOT EXISTS 改成 EXISTS(名稱座標不動、語意反轉;另兩條述詞同形狀)"
    "s/AND e.event_type = 'result_success')/AND NOT e.event_type = 'result_success')/|apply|l5b2_2f_carveout_scope|M19 carve-out 插一個否定詞(舊形狀兩個計數仍是 1)"
    # 🔴 這條 sed **不能用 `||` 串接**:T 陣列的欄位分隔字元就是 `|`,寫進去會被切成四段亂碼
    #    (本輪實跑撞到:kind 變成空字串 ⇒ 走 behavior 分支 ⇒ 18 格全紅、報告看起來像天塌了)。
    #    改用 concat() —— 同樣讓 'result' 字面消失,不含分隔字元。
    "s/'result', 'INITIATED'/concat('res','ult'), 'INITIATED'/|apply|l5b2_2f_result_code_closure|M20 用 concat 組 result 鍵(舊形狀兩個計數同步減少、照樣相等)"
    "s/pg_catalog.pg_advisory_xact_lock(/pg_catalog.PG_ADVISORY_XACT_LOCK(/|apply|l5b2_2f_anchor_advisory_before_lock|M21 advisory 改成大寫寫法(舊形狀的字面守門集體失明)"
    "s/WHERE request_id = v_req;/WHERE request_id = v_req for update;/|apply|l5b2_2f_anchor_lock_strength|M22 多一個**小寫** for update(①c 舊形狀大小寫敏感 ⇒ 一處都數不到)"
    # ── v7 三折(diff 層 R2)新增 ────────────────────────────────────────────────
    # 🔴 M23:我 v7 把 ①a2 寫成「誠實缺口:sed 搬不動整段」——**那是假的**。
    #    不必「搬」,**插入**一顆 advisory 讓 i_adv 前移就破得掉。R2 reviewer 給了這個構造,
    #    它證明我當時把**十行就能測的東西**歸進了誠實缺口。教訓:宣告構造不出來之前,先花十分鐘試著構造。
    "s/  -- 步 1. 輸入衛生/  PERFORM pg_catalog.pg_advisory_xact_lock(1);  -- 步 1. 輸入衛生/|apply|l5b2_2f_anchor_advisory_after_validation|M23 在步 1 之前插一顆 advisory(i_adv 前移 ⇒ ①a2 的下界被破)"
    # 🔴 M24:三條在途述詞裡**最吃重的那條(終局)一直沒有靶**;而 ①e-1 明文只守「NOT EXISTS 包裝還在」、
    #    不守述詞內部的關聯條件 ⇒ 這條述詞當時既無結構守門、行為格(C2)的判別力也從未被證明。
    #    `^ *WHERE` 只命中函式本體那一行(後置⑧ 的同款述詞寫在同一行的中段,不會被誤傷)。
    "s/^ *WHERE et.refund_id = pr.id)/                      WHERE et.refund_id = pr.attempt_id)/|behavior|C2 C2b C2c C3|M24 終局述詞的關聯條件錯掉(終局判定失效 ⇒ 補了終局事件也還是被當在途)"
    # 🔴 M25:①c 的**空白**那一面。v7 一度只吸收大小寫(走 upper(v_stripped))⇒ `FOR  UPDATE`(雙空格)
    #    或跨行寫法一處都數不到,M22 的繞法換個空白就復活;改走 upper(v_norm) 之後這靶才紅得起來。
    "s/WHERE request_id = v_req;/WHERE request_id = v_req FOR  UPDATE;/|apply|l5b2_2f_anchor_lock_strength|M25 多一個**雙空格** FOR  UPDATE(只吸收大小寫不吸收空白的話全盲)"
  )
  # 每靶共用的前置:全新叢集 → 回退到 pre-image → 套突變版。回 0 才可繼續。
  mut_prepare() { # mut_prepare <sedscript> → 產生 $WORKM/mut.sql
    scripts/d1t2-rehearsal.sh teardown "$WORKM" >/dev/null 2>&1
    wait_port_free
    safe_rm_workdir "$WORKM"; mkdir -p "$WORKM"
    # 用**未突變**的 repo 起叢集(provision 會把 2f 也套上)⇒ 先回退到 pre-image 再套突變版
    PORT=$PORT scripts/d1t2-rehearsal.sh provision "$WORKM" >"$WORKM/prov.log" 2>&1 || true
    q "SELECT 1;" >/dev/null 2>&1 || { echo "  ⚠️ 叢集沒起來" | tee -a "$REPORT"; return 1; }
    assert_fresh_cluster
    psql "$URL" -v ON_ERROR_STOP=1 -f "$RB" >/dev/null 2>&1 || { echo "  ⚠️ 回退失敗" | tee -a "$REPORT"; return 1; }
    sed "$1" "$MIG" > "$WORKM/mut.sql"
    cmp -s "$MIG" "$WORKM/mut.sql" && { echo "  🔴 突變沒改到任何字元(sed 沒命中)⇒ 這靶無效" | tee -a "$REPORT"; return 1; }
    return 0
  }

  # ── M0:量 BASE_RED(只有跑到行為靶才需要;apply 靶用不到)────────────────
  mut_baseline() {
    [ "$M0_DONE" = 1 ] && return 0
    echo "── M0 惰性突變(量 BASE_RED:純因源碼變動就會紅的格)──" | tee -a "$REPORT"
    if ! mut_prepare "$M0_SED"; then
      MUT_FAIL=$((MUT_FAIL+1)); echo "  ❌ M0 基線跑不起來 ⇒ 行為靶的判別力無法歸屬" | tee -a "$REPORT"; return 1
    fi
    local o r
    o="$(psql "$URL" -v ON_ERROR_STOP=1 -f "$WORKM/mut.sql" 2>&1)"; r=$?
    if [ $r -ne 0 ]; then
      MUT_FAIL=$((MUT_FAIL+1))
      echo "  ❌ M0 惰性突變竟然 apply 失敗 ⇒ 它不惰性,不能當基線" | tee -a "$REPORT"
      printf '%s\n' "$o" | tail -2 | tee -a "$REPORT"; return 1
    fi
    o="$(PORT=$PORT "$0" run 2>&1)"
    if ! printf '%s' "$o" | grep -q 'run 小計'; then
      MUT_FAIL=$((MUT_FAIL+1))
      echo "  ❌ M0 的子行程 run 沒跑完 ⇒ BASE_RED 是空的不是量到的" | tee -a "$REPORT"; return 1
    fi
    BASE_RED="$(red_set "$o")"
    # 🔴 BASE_RED 必須**恰好**是已知的那一格(0-1 post-image md5):行為靶必然改到 prosrc
    #    ⇒ 那格對任何源碼變動都會紅,這是預期的。除它以外還紅 = 基線本身壞了
    #    (叢集殘留、fixture 沒建起來、依賴 migration 沒套齊…)⇒ 此時扣 BASE_RED
    #    等於把**既有故障**從每個靶的紅格裡扣掉,靶會變成看起來沒判別力或看起來有判別力,兩個方向都錯。
    if [ "$BASE_RED" != "0-1" ]; then
      MUT_FAIL=$((MUT_FAIL+1))
      echo "  ❌ BASE_RED = [$(printf '%s' "$BASE_RED" | tr '\n' ' ')],期望恰為 [0-1]" | tee -a "$REPORT"
      echo "     ⇒ 基線本身有別的紅格,量具會把既有故障扣掉 ⇒ 行為靶結果全部不可信,停" | tee -a "$REPORT"
      return 1
    fi
    M0_DONE=1
    echo "  BASE_RED = [$(printf '%s' "$BASE_RED" | tr '\n' ' ')](= 期望的唯一格)" | tee -a "$REPORT"
    return 0
  }

  local t sedscript kind expect name out rc
  for t in "${T[@]}"; do
    sedscript="${t%%|*}"; local rest="${t#*|}"
    kind="${rest%%|*}"; rest="${rest#*|}"
    expect="${rest%%|*}"; name="${rest#*|}"
    # 🔴 量具自檢:sed 腳本裡若含 `|`(欄位分隔字元),四個欄位會整排錯位而**不會有任何錯誤訊息** ——
    #    kind 變成空字串就走 behavior 分支,輸出看起來像被測物大規模翻紅。
    #    量具自己壞掉不能被讀成被測物的結果 ⇒ 先證 kind 是合法值再往下跑。
    case "$kind" in
      apply|behavior) : ;;
      *) MUT_FAIL=$((MUT_FAIL+1))
         echo "  ❌ 靶定義解析錯誤:kind=[$kind] 不是 apply/behavior ⇒ 該列的 sed 腳本大概含有 | 分隔字元" | tee -a "$REPORT"
         continue ;;
    esac
    if [ -n "${MUT_ONLY:-}" ]; then
      case " $MUT_ONLY " in *" ${name%% *} "*) : ;; *) continue ;; esac
    fi
    [ "$kind" = behavior ] && { mut_baseline || { MUT_FAIL=$((MUT_FAIL+1)); continue; }; }
    echo "── $name ──" | tee -a "$REPORT"
    mut_prepare "$sedscript" || { MUT_FAIL=$((MUT_FAIL+1)); continue; }
    out="$(psql "$URL" -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -f "$WORKM/mut.sql" 2>&1)"; rc=$?
    if [ "$kind" = apply ]; then
      if [ $rc -ne 0 ] && printf '%s' "$out" | grep -q "$expect"; then
        echo "  ✅ 被閘擋住($expect)" | tee -a "$REPORT"
      elif [ $rc -ne 0 ]; then
        MUT_FAIL=$((MUT_FAIL+1))
        echo "  ❌ apply 失敗但不是期望的閘($expect);實際訊息尾:" | tee -a "$REPORT"
        printf '%s\n' "$out" | tail -2 | tee -a "$REPORT"
      else
        MUT_FAIL=$((MUT_FAIL+1))
        echo "  ❌ apply 竟然成功 ⇒ 這條守門沒有判別力" | tee -a "$REPORT"
      fi
    else
      if [ $rc -ne 0 ]; then
        MUT_FAIL=$((MUT_FAIL+1))
        echo "  ❌ 行為靶卻在 apply 就失敗 ⇒ 判別力歸給閘、這格沒被驗到(不是綠燈)" | tee -a "$REPORT"
        printf '%s\n' "$out" | tail -2 | tee -a "$REPORT"
        continue
      fi
      out="$(PORT=$PORT "$0" run 2>&1)"
      # 🔴 子行程沒跑完 ≠ 沒有紅格。實錘:我在 mut 跑到一半編了 rollback 檔,
      #    子行程的 check_sha 當場 die ⇒ 輸出零個 ❌ ⇒ 紅格集合是空的
      #    ⇒ 判準「期望格不在紅格裡」成立 ⇒ 報成「該格對這個突變沒有判別力」。
      #    **量具自己死掉被讀成了被測物沒反應。** 先證子行程真的跑完了再談紅格。
      if ! printf '%s' "$out" | grep -q 'run 小計'; then
        MUT_FAIL=$((MUT_FAIL+1))
        echo "  ❌ 子行程 run 沒跑完(找不到『run 小計』)⇒ 這靶**沒有結果**,不是沒有判別力" | tee -a "$REPORT"
        printf '%s\n' "$out" | tail -3 | tee -a "$REPORT"
        continue
      fi
      local this_red diff_red want_red
      this_red="$(red_set "$out")"
      # 🔴 判別力只算在「本靶紅、而 M0 惰性突變不紅」的格上(R1 D)
      diff_red="$(comm -23 <(printf '%s\n' "$this_red") <(printf '%s\n' "$BASE_RED"))"
      # 🔴 判準是**集合相等**、不是「期望格 ∈ 差集」(R1v6 IMP):只要求包含之下,
      #    一個同時打壞別的行為的突變照樣算通過 —— 而「這個突變只影響那一格」正是
      #    「該格在守什麼」的全部內容。多紅的那些格代表突變的爆炸半徑比宣稱的大,
      #    要嘛期望集合寫錯、要嘛突變設計得不夠外科 —— 兩種都必須看見。
      #    ⇒ 期望欄改成**空白分隔的集合**,實跑多紅什麼就照實補進期望集合(紅格由實跑決定)。
      #    這裡刻意不加引號:要的就是按空白切成多個 token。
      want_red="$(printf '%s\n' $expect | sort -u)"
      echo "  紅格集合 = [$(printf '%s' "$this_red" | tr '\n' ' ')]" | tee -a "$REPORT"
      echo "  扣掉 BASE_RED 之後 = [$(printf '%s' "$diff_red" | tr '\n' ' ')]" | tee -a "$REPORT"
      if [ "$diff_red" = "$want_red" ]; then
        echo "  ✅ 行為靶的紅格集合(扣 BASE_RED 後)恰等於期望 [$expect]" | tee -a "$REPORT"
      else
        MUT_FAIL=$((MUT_FAIL+1))
        echo "  ❌ 紅格集合 ≠ 期望:期望 [$expect]、實得 [$(printf '%s' "$diff_red" | tr '\n' ' ')]" | tee -a "$REPORT"
        echo "     ⇒ 少紅 = 那格對這個突變沒有判別力;多紅 = 突變的影響面比期望大,兩者都不算通過" | tee -a "$REPORT"
      fi
    fi
  done
  scripts/d1t2-rehearsal.sh teardown "$WORKM" >/dev/null 2>&1
  echo; echo "════ mut 報告:$REPORT ════"; cat "$REPORT"
  echo; echo "════ mut 小計:未通過靶數 = $MUT_FAIL ════"
  # 🔴 退出碼要能反映結果:舊版最後一句是 cat,整個模式恆 exit 0
  #    ⇒ 「10 靶全綠」的退出碼完全不可信(R1 A5)。
  [ "$MUT_FAIL" -eq 0 ]
}

# ══ neg:守門的負測(改**庫的狀態**、不是改檔)═══════════════════════════════
# 🔴 mut 模式只會 sed migration 檔 ⇒ 只驗得到「檔被改壞」那一面。
#    P6b/P6c/P7 與回退閘②b/②c 守的是**庫的現況**,那些失效路徑 sed 不出來
#    ⇒ 沒有這個模式,那五道守門一條負測都沒有(= 只證明了它們在正常狀態下不擋人)。
# 🔴 每格都附**舊形狀對照**:舊守門綠、新守門紅,判別力才歸得到新形狀身上;
#    只印「新的擋住了」證不到「這是新形狀的功勞」。
# ══ 行為探針(v7 三折;主視窗 P-607-A 換路裁決)═══════════════════════════════
# 🔴 為什麼要有這一族:結構斷言(比 catalog 文字)在 R1 被 `<>` 繞、R2 被 `NOT (...)` 繞 ——
#    同一道守門同型繞法第二次。等價寫法是開放集合,補一種就有第 N+1 種 ⇒ 換路:
#    **語意由行為證明**。這裡是臨時叢集、可以真的寫資料 ⇒ 該被擋的值要 23514、該過的要成功;
#    對 `<>` / `!=` / `NOT (...)` / `IN` 一視同仁,因為驗的是行為不是文字。
# 🔴 一律包在 BEGIN…ROLLBACK 裡:零留痕,且不影響後續格的 fixture。
# 🔴 SQLSTATE **不從訊息文字撈**:psql 的訊息會隨 locale 翻譯(本機是繁中,`ERROR:`/`SQLSTATE`
#    這些字面根本不出現)⇒ 第一版拿 grep 'SQLSTATE' 判,結果每一格都被判成「沒被擋」,
#    而實際上四格都確實被擋了。**量具用錯觀察點,看起來就像被測物壞掉。**
#    改成讓 DB 自己把 SQLSTATE 用固定字串吐出來:與語系、與 psql 版本都無關。
probe_sql() { # probe_sql <sql>:跑在 BEGIN…ROLLBACK 裡,印 PCM_PROBE_OK 或 PCM_PROBE_SQLSTATE=xxxxx
  psql "$URL" -qtAX -c "BEGIN;
    DO \$probe\$ BEGIN
      $1
      RAISE NOTICE 'PCM_PROBE_OK';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'PCM_PROBE_SQLSTATE=%', SQLSTATE;
    END \$probe\$;
    ROLLBACK;" 2>&1
}
probe_blocked() { # probe_blocked <label> <sqlstate> <sql>
  local label="$1" want="$2" out
  out="$(probe_sql "$3")"
  if printf '%s' "$out" | grep -q "PCM_PROBE_SQLSTATE=$want"; then
    PASS=$((PASS+1)); printf '  ✅ %s(實際被擋、SQLSTATE=%s)\n' "$label" "$want"
  else
    FAIL=$((FAIL+1)); printf '  ❌ %s:期望 SQLSTATE=%s,實得:\n' "$label" "$want"
    printf '%s\n' "$out" | tail -3
  fi
}
probe_blocked_any() { # probe_blocked_any <label> <sql>:只要求「被擋」,並印出**實際是哪一層**擋的
  # 🔴 為什麼要有這個變體(實跑撞出來的):order_refunds 的 INSERT 路徑上有既有 trigger
  #    `pcm_a7c_refund_insert_guard` 排在 CHECK 之前(`a7c_insert_status_must_be_processing`)
  #    ⇒ 把期望釘死成 SQLSTATE=23514 會變成「**量到的是 trigger、宣稱的是 CHECK**」。
  #    語意主張是「這個值進不來」,由哪一層擋住不影響那句話 ⇒ 只斷言被擋、把實際攔截碼印出來備查。
  local label="$1" out
  out="$(probe_sql "$2")"
  if printf '%s' "$out" | grep -q 'PCM_PROBE_SQLSTATE='; then
    PASS=$((PASS+1))
    printf '  ✅ %s(被擋;實際攔截 = %s)\n' "$label" \
      "$(printf '%s' "$out" | grep -o 'PCM_PROBE_SQLSTATE=[0-9A-Za-z]*' | head -1)"
  else
    FAIL=$((FAIL+1)); printf '  ❌ %s:竟然沒被擋,實得:\n' "$label"
    printf '%s\n' "$out" | tail -3
  fi
}
probe_allowed() { # probe_allowed <label> <sql>
  local label="$1" out
  out="$(probe_sql "$2")"
  if printf '%s' "$out" | grep -q 'PCM_PROBE_OK'; then
    PASS=$((PASS+1)); printf '  ✅ %s(合法操作照樣成功 = 沒有誤擋)\n' "$label"
  else
    FAIL=$((FAIL+1)); printf '  ❌ %s:合法操作竟然被擋(守門過嚴 = 誤擋),實得:\n' "$label"
    printf '%s\n' "$out" | tail -3
  fi
}

neg_expect_fail() { # neg_expect_fail <label> <constraint> <sqlfile>
  local label="$1" want="$2" f="$3" out rc
  out="$(psql "$URL" -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -f "$f" 2>&1)"; rc=$?
  if [ $rc -ne 0 ] && printf '%s' "$out" | grep -q "$want"; then
    PASS=$((PASS+1)); printf '  ✅ %s(擋在 %s)\n' "$label" "$want"
  elif [ $rc -ne 0 ]; then
    FAIL=$((FAIL+1)); printf '  ❌ %s:有擋但不是期望的閘(%s)\n' "$label" "$want"
    printf '%s\n' "$out" | tail -2
  else
    FAIL=$((FAIL+1)); printf '  ❌ %s:竟然成功 ⇒ 這條守門沒有判別力\n' "$label"
  fi
}

mode_neg() {
  log "N 守門負測(改庫的狀態;每格附舊形狀對照)"
  # 起點:回到 pre-image,才能反覆試 apply
  psql "$URL" -v ON_ERROR_STOP=1 -f "$RB" >/dev/null 2>&1 || die "neg:回退到 pre-image 失敗"

  # ── N1:索引 predicate 改成否定式(舊守門 LIKE '%processing%' 照樣命中)──
  sqlx "DROP INDEX public.order_refunds_single_processing_per_order;
        CREATE UNIQUE INDEX order_refunds_single_processing_per_order
          ON public.order_refunds (order_id) WHERE status <> 'processing';"
  val "N1-舊 舊形狀(LIKE '%processing%')仍判綠 = 假綠" true \
    "SELECT (pg_get_expr(i.indpred, i.indrelid) LIKE '%processing%')::text
       FROM pg_index i WHERE i.indexrelid='public.order_refunds_single_processing_per_order'::regclass;"
  neg_expect_fail "N1-新 predicate 否定化被 P7 擋" l5b2_2f_single_flight_index "$MIG"
  sqlx "DROP INDEX public.order_refunds_single_processing_per_order;
        CREATE UNIQUE INDEX order_refunds_single_processing_per_order
          ON public.order_refunds (order_id) WHERE status = 'processing';"

  # ── N1b:P7 的**鍵欄**那一面(R1v6 IMP:P7 只有 predicate 有負測)──────────
  #    predicate 一字未動、只把鍵換成別欄 ⇒ 同一張單可以開多筆 processing,single-flight 沒了。
  sqlx "DROP INDEX public.order_refunds_single_processing_per_order;
        CREATE UNIQUE INDEX order_refunds_single_processing_per_order
          ON public.order_refunds (bank_refund_id) WHERE status = 'processing';"
  neg_expect_fail "N1b 索引鍵換成別欄(predicate 不變)被 P7 擋" l5b2_2f_single_flight_index "$MIG"
  sqlx "DROP INDEX public.order_refunds_single_processing_per_order;
        CREATE UNIQUE INDEX order_refunds_single_processing_per_order
          ON public.order_refunds (order_id) WHERE status = 'processing';"

  # ── N1c:P7 的**唯一性**那一面 —— 名字與鍵與 predicate 全對,就是不唯一 ────
  sqlx "DROP INDEX public.order_refunds_single_processing_per_order;
        CREATE INDEX order_refunds_single_processing_per_order
          ON public.order_refunds (order_id) WHERE status = 'processing';"
  neg_expect_fail "N1c 索引改成非唯一被 P7 擋" l5b2_2f_single_flight_index "$MIG"
  sqlx "DROP INDEX public.order_refunds_single_processing_per_order;
        CREATE UNIQUE INDEX order_refunds_single_processing_per_order
          ON public.order_refunds (order_id) WHERE status = 'processing';"

  # ── N2:狀態機 trigger 重綁到 no-op(舊守門按名字查函式 ⇒ 照樣綠)──────────
  sqlx "CREATE OR REPLACE FUNCTION public.pcm_neg_noop_trigger() RETURNS trigger
          LANGUAGE plpgsql AS \$x\$ BEGIN RETURN NEW; END \$x\$;
        DROP TRIGGER order_refunds_status_transition_bu ON public.order_refunds;
        CREATE TRIGGER order_refunds_status_transition_bu
          BEFORE UPDATE OF status ON public.order_refunds
          FOR EACH ROW EXECUTE FUNCTION public.pcm_neg_noop_trigger();"
  val "N2-舊 舊形狀(按名字查函式 md5)仍判綠 = 假綠" true \
    "SELECT (md5(p.prosrc)='c97ed6ce3ae502e357994cb445621dcc')::text
       FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='pcm_order_refund_status_transition';"
  neg_expect_fail "N2-新 trigger 重綁 no-op 被 P6c 擋" l5b2_2f_status_machine_pinned "$MIG"
  sqlx "DROP TRIGGER order_refunds_status_transition_bu ON public.order_refunds;
        CREATE TRIGGER order_refunds_status_transition_bu
          BEFORE UPDATE OF status ON public.order_refunds
          FOR EACH ROW EXECUTE FUNCTION public.pcm_order_refund_status_transition();
        DROP FUNCTION public.pcm_neg_noop_trigger();"

  # ── N3:狀態機 trigger 被停用 ────────────────────────────────────────────
  sqlx "ALTER TABLE public.order_refunds DISABLE TRIGGER order_refunds_status_transition_bu;"
  neg_expect_fail "N3 狀態機 trigger 停用被 P6b 擋" l5b2_2f_status_machine_enabled "$MIG"
  sqlx "ALTER TABLE public.order_refunds ENABLE TRIGGER order_refunds_status_transition_bu;"

  # ── N3b/c/d:P6b 是**複合**述詞,只測停用那一支等於其餘三支零負測(R1v6 IMP)──
  #    三種中和手法都不動 tgenabled、也不動函式(P6c 全綠),但終態一樣轉得出去。
  # N3b:掛一個永遠不成立的 WHEN 子句(tgqual)
  sqlx "DROP TRIGGER order_refunds_status_transition_bu ON public.order_refunds;
        CREATE TRIGGER order_refunds_status_transition_bu
          BEFORE UPDATE OF status ON public.order_refunds
          FOR EACH ROW WHEN (NEW.status IS NULL)
          EXECUTE FUNCTION public.pcm_order_refund_status_transition();"
  neg_expect_fail "N3b trigger 掛永假 WHEN 子句被 P6b 擋(tgqual)" l5b2_2f_status_machine_enabled "$MIG"
  # N3c:UPDATE OF 換成別欄(tgattr)⇒ 改 status 時根本不觸發
  sqlx "DROP TRIGGER order_refunds_status_transition_bu ON public.order_refunds;
        CREATE TRIGGER order_refunds_status_transition_bu
          BEFORE UPDATE OF reason ON public.order_refunds
          FOR EACH ROW EXECUTE FUNCTION public.pcm_order_refund_status_transition();"
  neg_expect_fail "N3c trigger 的 UPDATE OF 換成別欄被 P6b 擋(tgattr)" l5b2_2f_status_machine_enabled "$MIG"
  # N3d:BEFORE 改成 AFTER(tgtype 的 BEFORE 位元)⇒ 攔不住轉移、只能事後抱怨
  sqlx "DROP TRIGGER order_refunds_status_transition_bu ON public.order_refunds;
        CREATE TRIGGER order_refunds_status_transition_bu
          AFTER UPDATE OF status ON public.order_refunds
          FOR EACH ROW EXECUTE FUNCTION public.pcm_order_refund_status_transition();"
  neg_expect_fail "N3d trigger 時機改成 AFTER 被 P6b 擋(tgtype 位元)" l5b2_2f_status_machine_enabled "$MIG"
  # N3e:反向 —— tgenabled='A'(ALWAYS)是合法且**更強**的設定,不得被誤擋(R1v6 IMP 那條的正面驗收)
  sqlx "DROP TRIGGER order_refunds_status_transition_bu ON public.order_refunds;
        CREATE TRIGGER order_refunds_status_transition_bu
          BEFORE UPDATE OF status ON public.order_refunds
          FOR EACH ROW EXECUTE FUNCTION public.pcm_order_refund_status_transition();
        ALTER TABLE public.order_refunds ENABLE ALWAYS TRIGGER order_refunds_status_transition_bu;"
  if psql "$URL" -v ON_ERROR_STOP=1 -f "$MIG" >/dev/null 2>&1; then
    PASS=$((PASS+1)); echo "  ✅ N3e tgenabled='A'(ALWAYS)未被誤擋(合法更強設定)"
    psql "$URL" -v ON_ERROR_STOP=1 -f "$RB" >/dev/null 2>&1 || die "neg N3e:回退失敗,後續格無法驗"
  else
    FAIL=$((FAIL+1)); echo "  ❌ N3e tgenabled='A' 被擋 ⇒ 合法更強的設定被誤判成失效"
  fi
  sqlx "ALTER TABLE public.order_refunds ENABLE TRIGGER order_refunds_status_transition_bu;"

  # ── N6:2e 的 lock_timeout 被 ALTER 掉(prosrc 一字未動)──────────────────
  sqlx "ALTER FUNCTION public.close_released_attempt(uuid, text) RESET lock_timeout;"
  neg_expect_fail "N6 2e 的 lock_timeout 被拿掉被 P1b 擋" l5b2_2f_2e_attributes_required "$MIG"
  sqlx "ALTER FUNCTION public.close_released_attempt(uuid, text) SET lock_timeout = '3s';"

  # ── N6c:P1b 的**值錯**那一支(N6 只測「被拿掉」;複合述詞只測一支正是 R2 抓的高估)──
  #    lock_timeout=0 = 無限等 = 本組要消掉的死結面,而設定名稱照樣在 ⇒ 舊形狀對它全綠。
  sqlx "ALTER FUNCTION public.close_released_attempt(uuid, text) SET lock_timeout = '0';"
  val "N6c-舊 舊形狀(只找設定名稱在不在)仍判綠 = 假綠" true \
    "SELECT (proconfig::text LIKE '%lock_timeout%')::text FROM pg_proc p
       JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='close_released_attempt';"
  neg_expect_fail "N6c-新 2e 的 lock_timeout 被改成 0(無限等)被 P1b 擋" l5b2_2f_2e_attributes_required "$MIG"
  sqlx "ALTER FUNCTION public.close_released_attempt(uuid, text) SET lock_timeout = '3s';"

  # ── N6b:2e 被多載一顆同名函式 ⇒ P1/P1b/P1c 的無簽章定位會拿到任意一顆 ──────
  sqlx "CREATE FUNCTION public.close_released_attempt(p_probe uuid) RETURNS void
          LANGUAGE plpgsql AS \$o\$ BEGIN RETURN; END \$o\$;"
  neg_expect_fail "N6b 2e 出現同名多載被 P1-0 擋" l5b2_2f_2e_overloaded "$MIG"
  sqlx "DROP FUNCTION public.close_released_attempt(uuid);"

  # ── N7:2e 的 EXECUTE 被多授一個角色 ─────────────────────────────────────
  sqlx "GRANT EXECUTE ON FUNCTION public.close_released_attempt(uuid, text) TO anon;"
  neg_expect_fail "N7 2e 被多授 EXECUTE 給 anon 被 P1c 擋" l5b2_2f_2e_acl_owner_only "$MIG"
  sqlx "REVOKE EXECUTE ON FUNCTION public.close_released_attempt(uuid, text) FROM anon;"

  # ── N8:② 的 proconfig 被 ALTER 加料 ─────────────────────────────────────
  sqlx "ALTER FUNCTION public.admin_initiate_order_refund(uuid, text, integer, bigint, bigint, text, text, text)
          SET statement_timeout = '9s';"
  neg_expect_fail "N8 ② 的 proconfig 被加料被 P3 擋" l5b2_2f_preimage_attrs "$MIG"
  sqlx "ALTER FUNCTION public.admin_initiate_order_refund(uuid, text, integer, bigint, bigint, text, text, text)
          RESET statement_timeout;"

  # ── N9:② 的 EXECUTE 被多授一個角色(Sean Q-P591-1=A 那道)────────────────
  sqlx "GRANT EXECUTE ON FUNCTION public.admin_initiate_order_refund(uuid, text, integer, bigint, bigint, text, text, text) TO anon;"
  neg_expect_fail "N9 ② 被多授 EXECUTE 給 anon 被 P3b 擋(既有誤授也擋)" l5b2_2f_preimage_acl_set "$MIG"
  sqlx "REVOKE EXECUTE ON FUNCTION public.admin_initiate_order_refund(uuid, text, integer, bigint, bigint, text, text, text) FROM anon;"

  # ── N9b:P3b 的 **grant option** 那一支(集合仍恰好 {owner, service_role},但可轉授)──
  sqlx "GRANT EXECUTE ON FUNCTION public.admin_initiate_order_refund(uuid, text, integer, bigint, bigint, text, text, text)
          TO service_role WITH GRANT OPTION;"
  val "N9b-舊 舊形狀(只比授權集合)仍判綠 = 假綠(集合沒變、只是變成可轉授)" true \
    "SELECT (EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
                      JOIN pg_roles r ON r.oid=a.grantee
                     WHERE p.proname='admin_initiate_order_refund'
                       AND a.privilege_type='EXECUTE' AND r.rolname='service_role'))::text;"
  neg_expect_fail "N9b-新 service_role 拿到**可轉授**的 EXECUTE 被 P3b 擋" l5b2_2f_preimage_acl_set "$MIG"
  sqlx "REVOKE GRANT OPTION FOR EXECUTE ON FUNCTION public.admin_initiate_order_refund(uuid, text, integer, bigint, bigint, text, text, text)
          FROM service_role;"

  # ── N10:canonical view 的 security_invoker 被關掉(viewdef md5 蓋不到)────
  sqlx "ALTER VIEW public.payment_refund_effective_terminal SET (security_invoker = false);"
  # 舊形狀對照:security_invoker 已經被關掉,但 viewdef 的 md5 **仍等於 P4 釘的那顆值**
  # ⇒ 只釘 viewdef 的守門對這個失效完全看不見。(釘值逐字同 migration 的 c_viewdef_md5)
  val "N10-舊 關掉 security_invoker 後 viewdef md5 仍等於 P4 釘值 = 假綠" true \
    "SELECT (md5(pg_get_viewdef('public.payment_refund_effective_terminal'))
             = 'd20e9c8e9702d4b9b975105b91e051d1')::text;"
  neg_expect_fail "N10-新 security_invoker 被關掉被 P4b 擋" l5b2_2f_viewdef_security_invoker "$MIG"
  sqlx "ALTER VIEW public.payment_refund_effective_terminal SET (security_invoker = true);"

  # ── N10b:P4b 的**反向格** —— `security_invoker = on` 是合法等價寫法,不得被誤擋 ──
  #    (v8 把單一字面比對改成「取值判布林」就是為了這個;沒有反向格就證不到誤擋真的消失了)
  sqlx "ALTER VIEW public.payment_refund_effective_terminal SET (security_invoker = on);"
  if psql "$URL" -v ON_ERROR_STOP=1 -f "$MIG" >/dev/null 2>&1; then
    PASS=$((PASS+1)); echo "  ✅ N10b security_invoker=on(合法等價寫法)未被 P4b 誤擋"
    psql "$URL" -v ON_ERROR_STOP=1 -f "$RB" >/dev/null 2>&1 || die "neg N10b:回退失敗,後續格無法驗"
  else
    FAIL=$((FAIL+1)); echo "  ❌ N10b security_invoker=on 被擋 ⇒ 合法等價寫法被誤判成失效"
  fi
  sqlx "ALTER VIEW public.payment_refund_effective_terminal SET (security_invoker = true);"

  # ── N11:payment_refund_events 被開 FORCE RLS(已結案退款會看起來永遠沒結案)
  sqlx "ALTER TABLE public.payment_refund_events FORCE ROW LEVEL SECURITY;"
  neg_expect_fail "N11 payment_refund_events 開 FORCE RLS 被 P5 擋" l5b2_2f_no_force_rls "$MIG"
  sqlx "ALTER TABLE public.payment_refund_events NO FORCE ROW LEVEL SECURITY;"

  # ── N11b:P5b 的負測(v7 三折)────────────────────────────────────────────
  #   🔴 我 v7 把這道寫成「本機恆綠、負測紅不了它」——**那是假的誠實缺口**,R2 reviewer 給了構造:
  #      neg 模式本來就在改庫狀態,`CREATE ROLE` + `ALTER FUNCTION … OWNER TO` 十行就做得到。
  #      我當時說「換 owner 會同時觸動 P3b 與後置③」是**推的不是量的**:
  #      ALTER OWNER 保留既有 GRANT(P3b 比的是授權集合,不動)、後置③ 比的是同一次 run 內拍的
  #      pre-image 快照(owner 在快照當下就已經是新的,也不動)。
  #      ⇒ 這一格的價值不只是多一個負測,是把「構造不出來」的成本重新校準:它比我以為的低很多。
  #   payment_refunds 早已 ENABLE RLS(20260810140000:150,零 policy)⇒ 只要換掉函式 owner 就夠。
  sqlx "DROP ROLE IF EXISTS pcm_neg_fnowner;
        CREATE ROLE pcm_neg_fnowner NOLOGIN;
        GRANT CREATE ON SCHEMA public TO pcm_neg_fnowner;
        ALTER FUNCTION public.admin_initiate_order_refund(uuid, text, integer, bigint, bigint, text, text, text)
          OWNER TO pcm_neg_fnowner;"
  val "N11b-舊 舊形狀(只驗三表沒開 FORCE RLS)仍判綠 = 假綠" 0 \
    "SELECT count(*)::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relforcerowsecurity
        AND c.relname IN ('payment_refunds','payment_charge_attempts','payment_refund_events');"
  neg_expect_fail "N11b-新 函式 owner 換成無 BYPASSRLS 的角色被 P5b 擋" l5b2_2f_secdef_owner_rls_reach "$MIG"
  sqlx "ALTER FUNCTION public.admin_initiate_order_refund(uuid, text, integer, bigint, bigint, text, text, text)
          OWNER TO postgres;
        REVOKE CREATE ON SCHEMA public FROM pcm_neg_fnowner;
        DROP ROLE pcm_neg_fnowner;"

  # ── N12:狀態值域多出第五個值(舊形狀「四個 LIKE 都命中」照樣全綠)──────────
  sqlx "ALTER TABLE public.order_refunds DROP CONSTRAINT order_refunds_status_check;
        ALTER TABLE public.order_refunds ADD CONSTRAINT order_refunds_status_check
          CHECK (status = ANY (ARRAY['processing'::text, 'confirmed'::text, 'failed'::text,
                                     'deferred'::text, 'cancelled'::text]));"
  val "N12-舊 舊形狀(四個 LIKE 都命中)仍判綠 = 假綠" true \
    "SELECT (d LIKE '%processing%' AND d LIKE '%confirmed%'
             AND d LIKE '%failed%' AND d LIKE '%deferred%')::text
       FROM (SELECT pg_get_constraintdef(c.oid) d FROM pg_constraint c
              WHERE c.conrelid='public.order_refunds'::regclass
                AND c.conname='order_refunds_status_check') t;"
  neg_expect_fail "N12-新 值域多一個值被 P6 擋(集合相等)" l5b2_2f_status_domain "$MIG"
  # ── N12b:字面集合一模一樣、只把運算子翻成 <>(集合相等對它全盲)──────────
  sqlx "ALTER TABLE public.order_refunds DROP CONSTRAINT order_refunds_status_check;
        ALTER TABLE public.order_refunds ADD CONSTRAINT order_refunds_status_check
          CHECK (status <> ANY (ARRAY['processing'::text, 'confirmed'::text, 'failed'::text,
                                      'deferred'::text]));"
  val "N12b-舊 舊形狀(抽字面比集合)仍判綠 = 假綠" true \
    "SELECT (array_agg(m[1] ORDER BY m[1]) = ARRAY['confirmed','deferred','failed','processing'])::text
       FROM regexp_matches(
              (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c
                WHERE c.conrelid='public.order_refunds'::regclass
                  AND c.conname='order_refunds_status_check'), '''([a-z_]+)''::text', 'g') AS m;"
  neg_expect_fail "N12b-新 運算子翻成 <> 被 P6-op 擋" l5b2_2f_status_domain_operator "$MIG"
  sqlx "ALTER TABLE public.order_refunds DROP CONSTRAINT order_refunds_status_check;
        ALTER TABLE public.order_refunds ADD CONSTRAINT order_refunds_status_check
          CHECK (status = ANY (ARRAY['processing'::text, 'confirmed'::text, 'failed'::text,
                                     'deferred'::text]));"

  # ══ N12c/N12d:值域的**行為探針**(換路裁決的落地;結構斷言不再加碼)═══════════
  ensure_customer
  local ODOM
  ODOM="$(mk_order paid)"; need_uuid "$ODOM"
  # 🔴 rec_trade_id 必須取那張單自己的值:既有 INSERT guard 會比對
  #    (`a7c_insert_rec_trade_id_mismatch`)—— 第一版寫死 'rec_probe' 之下**五個探針全紅**,
  #    而且紅的原因與被測的東西無關。探針自己也會量錯東西。
  # N12c:正常狀態下,行為必須兩向都對(擋該擋的、放該放的)
  probe_blocked_any "N12c-1 值域行為:status='cancelled' 進不來(哪一層擋的都算)" \
    "INSERT INTO public.order_refunds (order_id, bank_refund_id, rec_trade_id, refund_amount, status, reason, actor, request_id, kind, record_refunded_before)
     SELECT o.id, 'probeblocked000000aa', o.tappay_rec_trade_id, 100, 'cancelled', 'probe', 'harness_actor', '$(uuid4)', 'partial', 0
       FROM public.orders o WHERE o.id='$ODOM'::uuid;"
  probe_allowed "N12c-2 值域行為:status='processing' 必須成功" \
    "INSERT INTO public.order_refunds (order_id, bank_refund_id, rec_trade_id, refund_amount, status, reason, actor, request_id, kind, record_refunded_before)
     SELECT o.id, 'probeallowed000000aa', o.tappay_rec_trade_id, 100, 'processing', 'probe', 'harness_actor', '$(uuid4)', 'partial', 0
       FROM public.orders o WHERE o.id='$ODOM'::uuid;"
  # N12d:把 CHECK 翻成 `NOT (...)` —— **兩道結構斷言都判綠(假綠)**,行為探針當場抓到。
  #   這就是 R2 那條 must-fix 的繞法本身;結構層不再補第三個變體,改由行為層負責。
  sqlx "ALTER TABLE public.order_refunds DROP CONSTRAINT order_refunds_status_check;
        ALTER TABLE public.order_refunds ADD CONSTRAINT order_refunds_status_check
          CHECK (NOT (status = ANY (ARRAY['processing'::text, 'confirmed'::text, 'failed'::text,
                                          'deferred'::text])));"
  val "N12d-結構 P6 集合相等 + P6-op 正規式**兩道都仍判綠** = 假綠(這是 R2 的繞法)" true \
    "SELECT ((SELECT array_agg(m[1] ORDER BY m[1]) FROM regexp_matches(d,'''([a-z_]+)''::text','g') AS m)
              = ARRAY['confirmed','deferred','failed','processing']
         AND d ~ 'status = ANY \\(ARRAY\\[' AND d !~ '<>|!=')::text
       FROM (SELECT pg_get_constraintdef(c.oid) d FROM pg_constraint c
              WHERE c.conrelid='public.order_refunds'::regclass
                AND c.conname='order_refunds_status_check') t;"
  probe_blocked "N12d-行為 值域已翻面 ⇒ 合法的 'processing' 被 CHECK 擋(23514)= 行為層抓到結構層看不見的" 23514 \
    "INSERT INTO public.order_refunds (order_id, bank_refund_id, rec_trade_id, refund_amount, status, reason, actor, request_id, kind, record_refunded_before)
     SELECT o.id, 'probeflipped000000aa', o.tappay_rec_trade_id, 100, 'processing', 'probe', 'harness_actor', '$(uuid4)', 'partial', 0
       FROM public.orders o WHERE o.id='$ODOM'::uuid;"
  sqlx "ALTER TABLE public.order_refunds DROP CONSTRAINT order_refunds_status_check;
        ALTER TABLE public.order_refunds ADD CONSTRAINT order_refunds_status_check
          CHECK (status = ANY (ARRAY['processing'::text, 'confirmed'::text, 'failed'::text,
                                     'deferred'::text]));"

  # ══ N2b:狀態機的**行為探針**(P6b/P6c 只是結構面:trigger 在不在、綁哪支、什麼時機)═══
  #   結構全綠不等於「三終態真的轉不出去」。兩向都測:
  #   合法轉移(processing→confirmed)必須成功、終態轉出(confirmed→processing)必須被擋。
  local OSM
  OSM="$(mk_order paid)"; need_uuid "$OSM"
  probe_allowed "N2b-1 狀態機行為:processing→failed(合法)必須成功" \
    "INSERT INTO public.order_refunds (order_id, bank_refund_id, rec_trade_id, refund_amount, status, reason, actor, request_id, kind, record_refunded_before)
     SELECT o.id, 'probesm00000000000aa', o.tappay_rec_trade_id, 100, 'processing', 'probe', 'harness_actor', '$(uuid4)', 'partial', 0
       FROM public.orders o WHERE o.id='$OSM'::uuid;
     UPDATE public.order_refunds SET status='failed', failed_reason='probe' WHERE bank_refund_id='probesm00000000000aa';"
  probe_blocked_any "N2b-2 狀態機行為:failed→processing(終態轉出)必須被擋" \
    "INSERT INTO public.order_refunds (order_id, bank_refund_id, rec_trade_id, refund_amount, status, reason, actor, request_id, kind, record_refunded_before)
     SELECT o.id, 'probesm10000000000aa', o.tappay_rec_trade_id, 100, 'processing', 'probe', 'harness_actor', '$(uuid4)', 'partial', 0
       FROM public.orders o WHERE o.id='$OSM'::uuid;
     UPDATE public.order_refunds SET status='failed', failed_reason='probe' WHERE bank_refund_id='probesm10000000000aa';
     UPDATE public.order_refunds SET status='processing' WHERE bank_refund_id='probesm10000000000aa';"

  # ══ N1d:single-flight 索引的**行為探針**(P7 只是結構面:名字/鍵/predicate/唯一性)═══
  #   同單第二筆 processing 必須撞唯一索引 —— 本片「不重做 order_refunds 那半」的整個前提就是它。
  local OSF
  OSF="$(mk_order paid)"; need_uuid "$OSF"
  probe_blocked "N1d single-flight 行為:同單第二筆 processing 必須撞唯一索引(23505)" 23505 \
    "INSERT INTO public.order_refunds (order_id, bank_refund_id, rec_trade_id, refund_amount, status, reason, actor, request_id, kind, record_refunded_before)
     SELECT o.id, 'probesf00000000000aa', o.tappay_rec_trade_id, 100, 'processing', 'probe', 'harness_actor', '$(uuid4)', 'partial', 0
       FROM public.orders o WHERE o.id='$OSF'::uuid;
     INSERT INTO public.order_refunds (order_id, bank_refund_id, rec_trade_id, refund_amount, status, reason, actor, request_id, kind, record_refunded_before)
     SELECT o.id, 'probesf10000000000aa', o.tappay_rec_trade_id, 100, 'processing', 'probe', 'harness_actor', '$(uuid4)', 'partial', 0
       FROM public.orders o WHERE o.id='$OSF'::uuid;"

  # 以下兩格驗回退閘 ⇒ 需要現況 = 2f post-image
  psql "$URL" -v ON_ERROR_STOP=1 -f "$MIG" >/dev/null 2>&1 || die "neg:2f apply 失敗,後兩格無法驗"

  # ── N4:2f 之後只改 COMMENT(prosrc 一字未動)⇒ 回退必須拒絕覆蓋 ──────────
  sqlx "DO \$n4\$ DECLARE v_c text; BEGIN
          SELECT obj_description(p.oid,'pg_proc') INTO v_c FROM pg_proc p
            JOIN pg_namespace n ON n.oid=p.pronamespace
           WHERE n.nspname='public' AND p.proname='admin_initiate_order_refund';
          EXECUTE format('COMMENT ON FUNCTION public.admin_initiate_order_refund(uuid, text, integer, bigint, bigint, text, text, text) IS %L',
                         v_c || ' [neg N4 值班追記]');
        END \$n4\$;"
  val "N4-舊 舊形狀(只比 prosrc)仍判 post-image = 會直接覆蓋掉那筆追記" true \
    "SELECT (md5(p.prosrc)='$POST_MD5_EXPECT')::text FROM pg_proc p
       JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='admin_initiate_order_refund';"
  neg_expect_fail "N4-新 COMMENT 被改過 ⇒ 回退閘②b 拒絕" l5b2_2f_rb_third_state_sidecar "$RB"
  sqlx "DO \$n4r\$ DECLARE v_c text; BEGIN
          SELECT obj_description(p.oid,'pg_proc') INTO v_c FROM pg_proc p
            JOIN pg_namespace n ON n.oid=p.pronamespace
           WHERE n.nspname='public' AND p.proname='admin_initiate_order_refund';
          EXECUTE format('COMMENT ON FUNCTION public.admin_initiate_order_refund(uuid, text, integer, bigint, bigint, text, text, text) IS %L',
                         replace(v_c, ' [neg N4 值班追記]', ''));
        END \$n4r\$;"

  # ── N4b/N4c:閘②b 的另外兩面(R1v6 IMP:②b 只有 COMMENT 有負測)────────────
  #    prosrc 一字未動、COMMENT 一字未動,但本腳本的 CREATE OR REPLACE 會把它們打回預設 ⇒ 同樣是第三態。
  sqlx "ALTER FUNCTION public.admin_initiate_order_refund(uuid, text, integer, bigint, bigint, text, text, text)
          SET statement_timeout = '7s';"
  neg_expect_fail "N4b 2f 之後被加 SET statement_timeout ⇒ 回退閘②b 拒絕" l5b2_2f_rb_third_state_sidecar "$RB"
  sqlx "ALTER FUNCTION public.admin_initiate_order_refund(uuid, text, integer, bigint, bigint, text, text, text)
          RESET statement_timeout;"
  sqlx "ALTER FUNCTION public.admin_initiate_order_refund(uuid, text, integer, bigint, bigint, text, text, text)
          COST 200;"
  neg_expect_fail "N4c 2f 之後 COST 被改 ⇒ 回退閘②b 拒絕(七屬性面)" l5b2_2f_rb_third_state_sidecar "$RB"
  sqlx "ALTER FUNCTION public.admin_initiate_order_refund(uuid, text, integer, bigint, bigint, text, text, text)
          COST 100;"

  # ── N7b:回退**後置**的 proconfig 那一面(v8 三折;R2 指出 N4b/N4c 驗的是還原**前**的閘②b)──
  #    構造:sed 一份**回退腳本的突變副本**,在還原用的 CREATE OR REPLACE 上多加一個 SET。
  #    這樣 prosrc / COMMENT / 七屬性 全綠,只有 proconfig 多一項 ⇒ 只紅回退後置那一格。
  #    (原本想寫「rollback 檔沒有 mut 模式 ⇒ 這面測不到」—— 那又是一次假的構造不出來:
  #     sed 一份副本跑就是了,成本十行。)
  local RBMUT="${WORK}-rbmut.sql"
  sed "s|^SET search_path = public, pg_temp\$|SET search_path = public, pg_temp\\
SET row_security = off|" "$RB" > "$RBMUT"
  if cmp -s "$RB" "$RBMUT"; then
    FAIL=$((FAIL+1)); echo "  ❌ N7b 突變沒改到任何字元(sed 沒命中)⇒ 這格無效,不是通過"
  else
    neg_expect_fail "N7b 回退文字誤帶 SET row_security ⇒ 回退後置擋下(proconfig 面)" l5b2_2f_rb_proconfig "$RBMUT"
  fi
  rm -f "$RBMUT"

  # ── N7c:閘① 的「剝除後 0 命中、原文有命中」不一致偵測(v8 三折)────────────
  #    構造:一支函式,`--` 註解裡放一個 `/*`,真正的 INSERT 寫在後面。
  #    先剝 `--` 再剝區塊註解之下不會被吃掉 ⇒ 兩邊都命中 ⇒ 走的是閘① 本身;
  #    反過來(v6 的順序)才會出現「剝完 0 命中、原文有命中」。這一格證的是**那道不一致偵測在**。
  sqlx "CREATE FUNCTION public.rb2f_tricky_2g() RETURNS void LANGUAGE plpgsql AS \$x\$
        BEGIN
          -- 這行註解裡有一個 /* 開頭符號
          INSERT INTO public.payment_refunds(attempt_id) VALUES (NULL);
        END \$x\$;"
  neg_expect_fail "N7c 註解含 /* 的 2g writer 仍被閘① 抓到(不因剝除吃掉而放行)" l5b2_2f_rb_2g_present "$RB"
  sqlx "DROP FUNCTION public.rb2f_tricky_2g();"

  # ── N5:仍有在途補償退款時回退 ⇒ 撤掉否決會讓那些單立刻可再開一筆 ─────────
  ensure_customer
  local ON5 AN5 RN5
  ON5="$(mk_order paid)"; need_uuid "$ON5"
  AN5="$(mk_attempt "$ON5")"; need_uuid "$AN5"
  RN5="$(mk_refund "$AN5")"; need_uuid "$RN5"
  neg_expect_fail "N5 有在途退款時回退被閘②c 擋" l5b2_2f_rb_refund_in_flight "$RB"

  # ── N5c/N5d:閘②c 的**核准出口**兩個方向都要驗 ────────────────────────────
  #    出口存在的理由是「2f 自己卡住的單恰好撤不掉」;但出口若隨便就開得了,
  #    這道閘等於沒有。⇒ 帶錯數字必須仍然擋(N5c)、帶對數字才放行且留痕(N5d)。
  # 🔴 v7 三折:核准綁的是**身分指紋**不是筆數 ⇒ 這兩格跟著改(判準只准有一份意思)。
  #    N5c 的「帶錯」特意改成**筆數相同、身分不同**的形狀 —— 那正是綁 count 之下會誤放行的情境。
  local NIF FP FPWRONG out5 rc5
  local PRED="NOT EXISTS (SELECT 1 FROM public.payment_refund_effective_terminal et WHERE et.refund_id = pr.id)
        AND NOT EXISTS (SELECT 1 FROM public.payment_refunds s WHERE s.supersedes_refund_id = pr.id)
        AND NOT EXISTS (SELECT 1 FROM public.payment_refund_events e
                         WHERE e.refund_id = pr.id AND e.event_type = 'result_success')"
  NIF="$(q "SELECT count(*)::text FROM public.payment_refunds pr WHERE $PRED;")"
  FP="$(q "SELECT md5(COALESCE(string_agg(t.id::text, ',' ORDER BY t.id),''))
             FROM (SELECT pr.id FROM public.payment_refunds pr WHERE $PRED) t;")"
  # 「同筆數、不同身分」的指紋:把集合裡那顆 id 換成另一顆 uuid 再算(模擬觀察後被換掉的那一筆)
  FPWRONG="$(q "SELECT md5(gen_random_uuid()::text);")"
  out5="$(psql "$URL" -v ON_ERROR_STOP=1 -v VERBOSITY=verbose \
            -c "SET pcm.rb_2f_inflight_override = '$FPWRONG'" -f "$RB" 2>&1)"; rc5=$?
  if [ $rc5 -ne 0 ] && printf '%s' "$out5" | grep -q 'l5b2_2f_rb_refund_in_flight'; then
    PASS=$((PASS+1)); echo "  ✅ N5c override 指紋不符(筆數同為 $NIF、身分不同)⇒ 仍然擋"
  else
    FAIL=$((FAIL+1)); echo "  ❌ N5c override 指紋不符竟然放行 ⇒ 這個出口等於沒有判別力"
    printf '%s\n' "$out5" | tail -2
  fi
  out5="$(psql "$URL" -v ON_ERROR_STOP=1 -v VERBOSITY=verbose \
            -c "SET pcm.rb_2f_inflight_override = '$FP'" -f "$RB" 2>&1)"; rc5=$?
  if [ $rc5 -eq 0 ] && printf '%s' "$out5" | grep -q '經核准放行' \
     && printf '%s' "$out5" | grep -q '2f 回退完成'; then
    PASS=$((PASS+1)); echo "  ✅ N5d override 指紋相符($FP,$NIF 筆)⇒ 放行、且 WARNING 留痕"
    # 🔴 WARNING 只在客戶端輸出裡看得到(R2 IMP 點名);動錢的核准要**落一列在庫裡**才查得到。
    val "N5d-audit 核准落了一列 admin_audit_log(action=l5b2_2f_rollback.inflight_override)" 1 \
      "SELECT count(*)::text FROM public.admin_audit_log
        WHERE action='l5b2_2f_rollback.inflight_override' AND target='payment_refunds:$FP';"
  else
    FAIL=$((FAIL+1)); echo "  ❌ N5d override 指紋相符卻沒放行(或沒留痕):rc=$rc5"
    printf '%s\n' "$out5" | tail -3
  fi
  # N5d 走完現況已回到 pre-image;後面的 N5b 只數 payment_refunds,與函式版本無關。
  # 🔴 收尾不能 DELETE:payment_refunds 是 append-only(prl_append_only_guard 實測擋下)。
  #    用領域正確的方式解除在途 —— 補一筆終局事件,讓 canonical view 判它已結案。
  mk_event "$RN5" result_confirmed 1
  val "N5b 補終局事件後已不算在途" 0 \
    "SELECT count(*)::text FROM public.payment_refunds pr
      WHERE NOT EXISTS (SELECT 1 FROM public.payment_refund_effective_terminal et WHERE et.refund_id = pr.id)
        AND NOT EXISTS (SELECT 1 FROM public.payment_refunds s WHERE s.supersedes_refund_id = pr.id)
        AND NOT EXISTS (SELECT 1 FROM public.payment_refund_events e
                         WHERE e.refund_id = pr.id AND e.event_type = 'result_success');"

  # ══ N13:canonical view 缺席時,**回退不得跟著死**(v9 三折;diff 層 R3 MF)═══════
  #   view 被 drop 正是 2f 最壞的事故形態(② 的否決每次呼叫 42P01 ⇒ 有 payment_refunds 歷史的訂單
  #   全部退不了款),而那天要做的事就是撤掉 2f。舊寫法閘②c 自己也會 42P01 ⇒ 整筆 abort。
  #   兩向都驗:①沒帶核准 ⇒ 擋在具名 constraint(不是 42P01 裸錯)②帶 view-absent ⇒ 放行。
  #   🔴 位置很重要(第一版放錯):neg 的前段現況是 **pre-image**,閘② 會在 `v_md5 = c_pre_md5`
  #      那一支直接 RETURN,**根本走不到 ②c** ⇒ 兩格都判成「守門沒有判別力」。
  #      量具擺錯位置,長得跟被測物失效一模一樣(這族第五次)。⇒ 這裡先把 2f 套回去再測。
  psql "$URL" -v ON_ERROR_STOP=1 -f "$MIG" >/dev/null 2>&1 || die "neg N13:2f apply 失敗,這格無法驗"
  local VDEF
  VDEF="$(q "SELECT pg_get_viewdef('public.payment_refund_effective_terminal');")"
  [ -n "$VDEF" ] || die "N13:抽不到 canonical view 定義,拒繼續(避免刪了裝不回去)"
  sqlx "DROP VIEW public.payment_refund_effective_terminal;"
  neg_expect_fail "N13a view 缺席 + 未核准 ⇒ 擋在具名閘(不是 42P01 裸錯)" l5b2_2f_rb_terminal_view_missing "$RB"
  local out13 rc13
  out13="$(psql "$URL" -X -v ON_ERROR_STOP=1 -v VERBOSITY=verbose \
            -c "SET pcm.rb_2f_inflight_override = 'view-absent'" -f "$RB" 2>&1)"; rc13=$?
  if [ $rc13 -eq 0 ] && printf '%s' "$out13" | grep -q 'view 缺席、經核准放行'; then
    PASS=$((PASS+1)); echo "  ✅ N13b view 缺席 + 帶 view-absent 核准 ⇒ 回退跑得完(逃生門沒被自己焊死)"
  else
    FAIL=$((FAIL+1)); echo "  ❌ N13b view 缺席時即使核准也跑不完:rc=$rc13"
    printf '%s\n' "$out13" | tail -3
  fi
  sqlx "CREATE VIEW public.payment_refund_effective_terminal AS $VDEF;
        ALTER VIEW public.payment_refund_effective_terminal SET (security_invoker = true);"
  val "N13c view 已還原且定義 md5 與 P4 釘值相符(否則後續格全部假紅)" true \
    "SELECT (md5(pg_get_viewdef('public.payment_refund_effective_terminal'))
             = 'd20e9c8e9702d4b9b975105b91e051d1')::text;"


  echo
  echo "════ neg 小計:PASS=$PASS FAIL=$FAIL ════"
  [ "$FAIL" -eq 0 ]
}

case "$MODE" in
  pins) mode_pins ;;
  run)  check_sha; mode_run ;;
  rb)   check_sha; mode_rb ;;
  all)
    check_sha
    provision
    # 🔴 provision 會把 repo 的 migrations 全套上(含 2f)⇒ 現況通常已是 post-image。
    #    此時**不可以**再 apply 一次:前置閘 P2 釘的是 pre-image,重跑必然被擋
    #    —— 那是閘在做它該做的事,不是 apply 壞了。只有現況不是 post-image 才需要自己套。
    if [ "$(q "SELECT md5(p.prosrc) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                WHERE n.nspname='public' AND p.proname='admin_initiate_order_refund';")" \
         != "$POST_MD5_EXPECT" ]; then
      psql "$URL" -v ON_ERROR_STOP=1 -f "$MIG" >/dev/null 2>&1 \
        || die "2f apply 失敗(PIN 未填?)⇒ 先跑 pins 模式並填值"
    fi
    mode_run; r1=$?
    mode_rb;  r2=$?
    # 🔴 teardown 的回傳值要計入:它會驗「PORT 已無人聽」= 零留痕那一條。
    #    忽略它 ⇒ 殘留叢集仍在聽,而總結印綠(R1 B)。
    teardown; r3=$?
    echo; echo "════ 總計:PASS=$PASS FAIL=$FAIL / teardown rc=$r3 ════"
    [ "$r1" -eq 0 ] && [ "$r2" -eq 0 ] && [ "$r3" -eq 0 ]
    ;;
  mut)  check_sha; mode_mut ;;
  neg)  check_sha; mode_neg ;;
  *) die "未知模式:$MODE(all|run|rb|neg|mut|pins)" ;;
esac
