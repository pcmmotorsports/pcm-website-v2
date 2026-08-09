#!/usr/bin/env bash
#
# N3a / N3b 驗證 harness —— plan §4.1 / §4.1b / §4.1c / §4.1d 的執行器。
#   plan = docs/specs/2026-07-30-n3a-n3b-display-id-generator-plan.md
#
# 子命令:
#   scripts/n3-verify.sh n3a-mutations      # §4.1b:四個【改檔】突變,各自 fresh provision,
#                                           #   驗「死在該探針」(不是只驗 provision 失敗)
#   scripts/n3-verify.sh n3b-verbatim       # §4.1d:pg_get_functiondef 套用前後比對,
#                                           #   差異只准落在 DECLARE / 段 8;錢欄 INSERT 塊
#                                           #   另做 strip 後嚴格比對(M2)。需已 provision 的庫。
#   scripts/n3-verify.sh n3b-behaviour <workdir>
#                                           # §4.1 B/C/D 三段 + 消融 + 三個 OR-REPLACE 突變
#                                           #   (B-m1 / C-m1 / D-m1)+ 重試上限合約斷言
#   scripts/n3-verify.sh all                # 全部(自行 provision / teardown)
#
# 🔴 兩組突變的手法刻意不同(plan §4.1 F2 / §4.1b F3 —— 這是關卡1 抓出來的):
#   · §4.1b(本檔 n3a-mutations)= **改 migration 檔文字**,因為要驗的正是 apply-time 探針。
#     N3a 是新函式、沒有自指指紋閘 ⇒ 檔文字突變不會被無關的閘攔走。
#   · §4.1 (本檔 n3b-behaviour) = **provision 跑完後用 `CREATE OR REPLACE` 換函式本體**,
#     **絕不改 migration 檔** —— N3b 檔尾有自指指紋斷言,任何文字改動都會先死在那裡,
#     於是每個突變都紅在同一個與被測邏輯無關的閘上 = 沒有證據。
#
# 🔴 還原紀律(plan §4.1b N1):突變一律用 cp 從備份還原、**禁用 `git checkout`**
#   (它會清掉尚未 commit 的新檔 —— N3a/N3b 本身就是新檔 ⇒ 後續突變全變假紅;
#    reference_bash-background-kill-and-mutation-restore-traps 實錘)。
#   每個突變還原後以 shasum 逐位元組複驗。
#
# 誠實邊界(沿用 d1t2/d1t3 且不放寬):本機 PG17 非 Supabase、TapPay 未參與、
#   auth.uid() 是 shim、B 段跑在自造 fixture 上 = 煙霧測試,
#   「結帳真的能用」的唯一證據是 Sean 的 1 元真刷(plan §4.4)。
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

# shellcheck source=scripts/d1t2-rehearsal.sh
source scripts/d1t2-rehearsal.sh

N3A_FILE="supabase/migrations/20260730120000_m4b_e10_n3a_pcm_generate_display_id.sql"
N3B_FILE="supabase/migrations/20260730120100_m4b_e10_n3b_create_order_new_display_id.sql"
CO_SIG="public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text)"

pass() { echo "  ✅ $*" >&2; }
fail() { echo "  🔴 FAIL: $*" >&2; exit 1; }

# 🔴 前置閘:port 必須是空的。
#   首次實跑踩到:前一次 provision 的 postmaster 殘留在 54329 ⇒ 突變 1 的 provision
#   死在 "could not bind" 而不是死在該紅的探針。harness 當場拒收(死因不符 = 不算證明),
#   但那一輪等於白跑 ⇒ 把它擋在最前面,別讓環境問題偽裝成測試結果。
require_free_port() {
  local pids
  pids="$(lsof -nP -iTCP:${PORT} -sTCP:LISTEN -t 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    fail "port ${PORT} 已被佔用(pid: $(echo "$pids" | tr '\n' ' '))⇒ 先停掉殘留的 postmaster。
    停法:對每個殘留 workdir 跑 pg_ctl -D <workdir>/pgdata stop -m immediate,或 kill 上列 pid。
    🔴 不先清掉的話,每個突變都會死在 bind 失敗、而不是死在它該紅的探針上 = 整輪沒有證據。"
  fi
}

# ── §4.1b:改檔突變 ──────────────────────────────────────────────
# 每個 case = "描述|perl 表達式|預期死因必須含的字串"
n3a_mutations() {
  local BACKUP ORIG_SHA
  BACKUP="$(mktemp)"
  cp "$N3A_FILE" "$BACKUP"
  ORIG_SHA="$(shasum -a 256 < "$N3A_FILE" | cut -d' ' -f1)"
  echo "== §4.1b N3a 改檔突變(基準 sha=${ORIG_SHA:0:12})==" >&2
  require_free_port

  # 還原保險:任何離開路徑都先還原,絕不留髒檔
  # shellcheck disable=SC2064
  trap "cp '$BACKUP' '$N3A_FILE'; rm -f '$BACKUP'" EXIT

  # 🔴 突變矩陣的設計紀律(實跑修正過一輪):
  #   每條保留的探針都必須有一個【只紅它】的突變。第一版有兩個突變死在
  #   「函式自己的回傳前自我驗證」而不是該紅的探針 —— harness 當場拒收
  #   (死因不符 = 不算證明),追下去發現舊探針 3 / 4 在數學上被遮蔽、
  #   不可能單獨觸發 ⇒ 已從 migration 砍掉,不留無法證明的防護。
  #
  # 每個 case = "描述|perl 表達式(可多條、用 ;;; 分隔)|預期死因字串[|備選死因字串]"
  local -a CASES=(
    # ── 探針 3(卡方):唯一抓得到「取樣偏差」的一條 ──────────────
    "門檻 >=252 改成 >=253(off-by-one)|s/c_reject_at constant integer := 252;/c_reject_at constant integer := 253;/|N3a 探針 3 失敗"
    "拿掉 rejection、直接 % 28|s/^\s*CONTINUE WHEN v_b >= c_reject_at;.*$/      -- mutation: rejection removed/|N3a 探針 3 失敗"

    # ── 函式自我驗證(第一道、實測最先觸發)──────────────────────
    "字母表插入 0(自我驗證仍在)|s/'23456789BCDFGHJKMNPQRSTVWXYZ'/'023456789BCDFGHJKMNPQRSTVWXY'/|產出不符 §5.4a 合約"

    # ── 探針 1(regex):必須停用自我驗證才到得了 = 證明它是有效的第二道 ──
    "字母表插入 0 且停用自我驗證|s/'23456789BCDFGHJKMNPQRSTVWXYZ'/'023456789BCDFGHJKMNPQRSTVWXY'/;;;s/^  IF v_out !~ .*THEN\$/  IF false THEN/|N3a 探針 1 失敗"

    # ── 探針 2(不退化):回傳固定合法值 ⇒ 自我驗證照過、regex 照過,只有它紅 ──
    "退化成回傳固定合法值|s/^  RETURN v_out;\$/  RETURN 'K7MTQ3';/|N3a 探針 2 失敗"

    # ── N4 斷言(取模數↔字母表長度):卡方抓不到的形狀 ──────────────
    # 字母表補成 30 字元(全部合法、只是重複兩個)、取模數 % 28 不動 ⇒
    # 只有前 28 個字元可達 ⇒ 產出全合法、分布均勻 ⇒
    # 函式自我驗證 / 探針 1 regex / 探針 2 不退化 / 探針 3 卡方 **四條全綠**,
    # 唯一抓得到的是段 3.5 的「字母表字面逐字相等」。
    # 🔴 它必須排在探針之後才有這個意義(關卡2-B F2)。
    # 🔴 perl 必須**只改 c_alphabet 宣告那一行**:該字面在檔內出現 8 次(自我驗證 regex、
    #    探針 1、卡方 LEFT JOIN、3.5 的期望值、3.6 的期望值…)。第一版用無錨點的取代 ⇒
    #    連斷言自己的期望值一起被改掉 ⇒ 斷言拿被改過的期望值比被改過的程式碼、當然相等,
    #    最後死在 3.6 的 COMMENT 檢查 = 死在別的地方(harness 當場拒收)。
    #    這就是「突變連測試一起突變」的經典陷阱。
    "字母表補成 30 字元但取模數不動|s/(c_alphabet\s+constant text\s+:= ')23456789BCDFGHJKMNPQRSTVWXYZ'/\${1}23456789BCDFGHJKMNPQRSTVWXYZ22'/|字母表與 §5.4a 合約不符"
  )

  local i=0 desc expr want1 want2 log work out
  for c in "${CASES[@]}"; do
    i=$((i + 1))
    IFS='|' read -r desc expr want1 want2 <<<"$c"
    echo "-- 突變 ${i}/${#CASES[@]}:${desc}" >&2

    cp "$BACKUP" "$N3A_FILE"
    # 多條表達式用 ;;; 分隔(探針 1 的突變需要同時改兩處)
    local one
    while IFS= read -r one; do
      [ -n "$one" ] && perl -i -pe "$one" "$N3A_FILE"
    done <<<"$(printf '%s\n' "${expr//;;;/$'\n'}")"
    if [ "$(shasum -a 256 < "$N3A_FILE" | cut -d' ' -f1)" = "$ORIG_SHA" ]; then
      fail "突變 ${i} 沒有真的改到檔案(perl 表達式沒命中)⇒ 這一輪證明不了任何事"
    fi

    # 🔴 每個突變一次獨立 fresh provision(不在同一個庫上疊突變)
    require_free_port
    work="$(mktemp -d)"
    log="$(mktemp)"
    # 🔴 **必須包 subshell**:provision 失敗時走 d1t2 的 `die`,而 `die` 是 `exit 1`。
    #    它跑在同一個 shell 裡 ⇒ 會直接終止本腳本(`set +e` 攔不住明確的 exit)。
    #    首次實跑就是這樣在「突變 1/4」當場斷掉、後面三個突變一次都沒跑到。
    set +e
    ( provision "$work" ) >"$log" 2>&1
    out=$?
    set -e
    ( teardown "$work" ) >/dev/null 2>&1 || true
    rm -rf "$work"

    if [ "$out" -eq 0 ]; then
      rm -f "$log"
      fail "突變 ${i}(${desc})竟然套用成功 ⇒ 該探針沒有守住"
    fi

    # 🔴 驗收條件不是「失敗」,是「死因訊息指向該探針」
    if grep -q "$want1" "$log" || { [ -n "${want2:-}" ] && grep -q "$want2" "$log"; }; then
      pass "突變 ${i} 死在預期探針(${want1}${want2:+ 或 $want2});死因:$(grep -oE 'N3a 探針 [0-9] 失敗[^,]*' "$log" | head -1)"
    else
      echo "---- 實際 log 尾段 ----" >&2
      tail -6 "$log" >&2
      rm -f "$log"
      fail "突變 ${i} 失敗了,但死因不是預期探針(${want1}${want2:+/$want2})⇒ 死在別的地方不算證明"
    fi
    rm -f "$log"
  done

  cp "$BACKUP" "$N3A_FILE"
  [ "$(shasum -a 256 < "$N3A_FILE" | cut -d' ' -f1)" = "$ORIG_SHA" ] \
    || fail "還原後 sha 不符 —— 出貨檔被汙染,停止"
  pass "全部突變已還原,出貨檔 sha 逐位元組一致"
  rm -f "$BACKUP"
  trap - EXIT

  # 消融:未突變的出貨檔必須套用成功(證明上面的紅來自突變、不是環境壞了)
  echo "-- 消融:未突變出貨檔必須通過" >&2
  require_free_port
  work="$(mktemp -d)"; log="$(mktemp)"
  set +e; ( provision "$work" ) >"$log" 2>&1; out=$?; set -e
  ( teardown "$work" ) >/dev/null 2>&1 || true; rm -rf "$work"
  [ "$out" -eq 0 ] || { tail -6 "$log" >&2; rm -f "$log"; fail "消融失敗:未突變的出貨檔套用不過"; }
  grep -q "N3a 驗收全數通過" "$log" || { rm -f "$log"; fail "消融時未看到 N3a 驗收通過的 NOTICE"; }
  pass "消融通過(未突變 ⇒ 綠;突變 ⇒ 各自紅在自己的探針)"
  rm -f "$log"
}

# ── §4.1 B/C/D/E:行為段(突變一律用 CREATE OR REPLACE、不改 migration 檔)──
# 前提:workdir 已 provision 過(N3a + N3b 都已套用)。
# ⚠️ N7:workdir 參數目前只當「你確認已 provision」的旗標 —— 連線位址來自 d1t2 的全域
#    PORT/url(),故**不支援並行兩個 workdir**。
n3b_behaviour() {
  local WORK="${1:?缺 workdir}"
  : "$WORK"
  echo "== §4.1 N3b 行為段(fixture 配方見 plan §4.1c)==" >&2

  # ── fixture(三件,全是 §4.1c 實跑定案的)────────────────────
  # 🔴 這三件都是我自己造的 ⇒ B 段是**煙霧測試**,不是「結帳真的能用」的證據。
  #    真正的證據只有 Sean 的 1 元真刷(plan §4.4)。
  local UID_FIX ADDR VARIANT TERMS
  UID_FIX="$(runsql "SELECT customer_user_id FROM public.customer_addresses ORDER BY id LIMIT 1")"
  ADDR="$(runsql "SELECT id FROM public.customer_addresses ORDER BY id LIMIT 1")"
  VARIANT="$(runsql "SELECT id FROM public.product_variants ORDER BY sku LIMIT 1")"
  TERMS="$(runsql "SELECT version FROM public.legal_terms_versions ORDER BY version DESC LIMIT 1")"
  [ -n "$UID_FIX" ] && [ -n "$ADDR" ] && [ -n "$VARIANT" ] && [ -n "$TERMS" ] \
    || fail "fixture 取值失敗(uid=$UID_FIX addr=$ADDR variant=$VARIANT terms=$TERMS)"

  # fixture 1:shim 的 auth.uid() 寫死回 NULL ⇒ create_order 的 v_uid 為 NULL、fail-closed
  runsql "CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS \$\$SELECT '${UID_FIX}'::uuid\$\$" >/dev/null
  # fixture 2:seed 的 price_general 全為 NULL(它造的是訂單、不是可下單的商品)
  runsql "UPDATE public.product_variants SET price_general = 1500 WHERE id = '${VARIANT}'" >/dev/null
  # fixture 3:seed 插了 PCM-2026-0001… 卻沒推進序號(N3b 已不用它,留著讓 B-m1 突變可跑)
  runsql "SELECT setval('public.order_display_seq', 9000)" >/dev/null
  pass "fixture 三件就位(auth.uid 替換 / 變體給價 / 序號推進)"

  local CALL="SELECT public.create_order(
      jsonb_build_array(jsonb_build_object('variant_id','${VARIANT}','qty',2)),
      '${ADDR}'::uuid, 'home', jsonb_build_object('type','personal','carrier','/ABC1234'),
      gen_random_uuid(), '${TERMS}', '127.0.0.1', 'n3-verify', 'probe@example.com')"

  # 出貨版的函式體,供每個突變後還原(不改 migration 檔 —— plan §4.1 F2)
  local SHIPPED_DEF; SHIPPED_DEF="$(mktemp)"
  runsql "SELECT pg_get_functiondef('${CO_SIG}'::regprocedure)" > "$SHIPPED_DEF"
  restore_co() { psql "$(url)" -v ON_ERROR_STOP=1 -q -f "$SHIPPED_DEF" >/dev/null; }
  # 🔴 helper 也要能還原:C 段會把它換成 stub,中途失敗時 stub 會留在庫裡,
  #    下一次執行就死在 stub 的殘骸上(首次實跑實測:裸表名 stub 殘留 ⇒ 整段跑不起來)。
  restore_helper() {
    psql "$(url)" -v ON_ERROR_STOP=1 -q \
      -f "supabase/migrations/20260730120000_m4b_e10_n3a_pcm_generate_display_id.sql" >/dev/null
  }
  # shellcheck disable=SC2064
  trap "restore_co 2>/dev/null; restore_helper 2>/dev/null; psql '$(url)' -qtA -c 'DROP SEQUENCE IF EXISTS public.n3_call_seq' >/dev/null 2>&1; rm -f '$SHIPPED_DEF'" EXIT

  local out res
  # ── B 段:真 create_order 建單 ⇒ display_id 必須是新 6 碼 ──────
  # 🔴 舊格式基準【事前抓、不寫死】:seed 是 29 張 cohort + 2 張非 cohort 誘餌 = 31 張,
  #    而正式站是 30 張。寫死任何一個數字都會在另一個環境假紅
  #    (第一版寫死 29,首次實跑當場被自己的斷言打回)。
  local BASE_OLD BASE_NEW
  BASE_OLD="$(runsql "SELECT count(*) FROM public.orders WHERE display_id ~ '^PCM-'")"
  BASE_NEW="$(runsql "SELECT count(*) FROM public.orders WHERE display_id ~ '^[23456789BCDFGHJKMNPQRSTVWXYZ]{6}\$'")"
  echo "  B 段基準:舊格式 ${BASE_OLD} 張 / 新格式 ${BASE_NEW} 張" >&2

  res="$(runsql "$CALL")"
  echo "  B 段回傳:$res" >&2
  echo "$res" | grep -qE '"display_id" *: *"[23456789BCDFGHJKMNPQRSTVWXYZ]{6}"' \
    || fail "B 段:回傳的 display_id 不是新 6 碼格式($res)"
  runsql "SELECT count(*) FROM public.orders WHERE display_id ~ '^[23456789BCDFGHJKMNPQRSTVWXYZ]{6}\$'" \
    | grep -qx "$((BASE_NEW + 1))" || fail "B 段:新格式訂單數未 +1(基準 ${BASE_NEW})"
  # 既有舊格式單一張都不准被動到(這是 Sean 拍板 Q1=A 的核心:舊單完全不動)
  runsql "SELECT count(*) FROM public.orders WHERE display_id ~ '^PCM-'" | grep -qx "$BASE_OLD" \
    || fail "B 段:既有舊格式訂單筆數被動過(基準 ${BASE_OLD})"
  pass "B 段:真 create_order 產出 6 碼新號、舊格式 ${BASE_OLD} 張零異動"

  # ── C 段:重試路徑(helper 換成回傳「已存在值」的固定 stub)────
  local EXISTING; EXISTING="$(runsql "SELECT display_id FROM public.orders WHERE display_id ~ '^[23456789BCDFGHJKMNPQRSTVWXYZ]{6}\$' LIMIT 1")"
  runsql "CREATE OR REPLACE FUNCTION public.pcm_generate_display_id() RETURNS text LANGUAGE sql VOLATILE AS \$\$SELECT '${EXISTING}'::text\$\$" >/dev/null
  set +e; out="$(psql "$(url)" -v ON_ERROR_STOP=1 -qtA -c "$CALL" 2>&1)"; res=$?; set -e
  [ "$res" -ne 0 ] || fail "C 段:helper 固定回已存在值,建單竟然成功"
  echo "$out" | grep -q "pcm_display_id_exhausted" \
    || { echo "$out" | tail -3 >&2; fail "C 段:錯誤訊息不含 token pcm_display_id_exhausted"; }
  pass "C 段:重試 5 次後以 pcm_display_id_exhausted 明確報錯"

  # C 段消融:helper 換回真的產號器 ⇒ 同一句 CALL 必須成功
  restore_helper || fail "C 段消融:重新套用 N3a 失敗"
  runsql "$CALL" >/dev/null || fail "C 段消融:helper 還原後建單仍失敗 ⇒ C 段的紅不是來自重試邏輯"
  pass "C 段消融:helper 還原後同一句建單成功(證明 C 的紅來自重試路徑)"

  # ── B-m1 突變(M3):段 8 改回舊 nextval 產號 ⇒ B 段的斷言必須轉紅 ──
  local MUTB; MUTB="$(mktemp)"
  perl -pe "s/v_display_id := public\.pcm_generate_display_id\(\);/v_display_id := 'PCM-' || pg_catalog.to_char(pg_catalog.now(), 'YYYY') || '-' || pg_catalog.lpad(pg_catalog.nextval('public.order_display_seq')::text, 4, '0');/" "$SHIPPED_DEF" > "$MUTB"
  grep -q "order_display_seq" "$MUTB" || fail "B-m1:突變沒改到產號那行"
  psql "$(url)" -v ON_ERROR_STOP=1 -q -f "$MUTB" >/dev/null
  res="$(runsql "$CALL")"
  if echo "$res" | grep -qE '"display_id" *: *"[23456789BCDFGHJKMNPQRSTVWXYZ]{6}"'; then
    rm -f "$MUTB"; fail "B-m1 突變後仍產出 6 碼 ⇒ B 段的格式斷言證明不了產號器真的換了"
  fi
  pass "B-m1 突變證明有效:段 8 改回 nextval ⇒ 產出 $(echo "$res" | grep -oE 'PCM-[0-9]{4}-[0-9]+')、B 段斷言會紅"
  restore_co; rm -f "$MUTB"

  # ── C-m1 突變(M3 + N10):迴圈上限 5 → 1 ⇒ 必須在「第 1 次」就放棄 ──
  # 🔴 N10:光證明「會重試到上限並報 token」不夠 —— 上限寫成 2 也會全綠。
  #    這裡用「stub 計次」把 §5.4a 的「上限 = 5」這條可測合約真的驗出來。
  # 🔴 計次器必須用 **sequence**、不能用表:
  #    create_order 用盡重試後會 RAISE ⇒ 整句 psql 的隱式交易 rollback ⇒
  #    寫進表裡的計次會一起被回滾、永遠讀到 0(首次實跑實測 0 次,不是「沒被呼叫」,
  #    是「被呼叫了但紀錄被回滾」)。`nextval` 不受回滾影響,正是這裡需要的性質。
  #    另:stub 內的引用必須 schema-qualify —— create_order 是 search_path=''。
  runsql "DROP SEQUENCE IF EXISTS public.n3_call_seq" >/dev/null
  runsql "CREATE SEQUENCE public.n3_call_seq" >/dev/null
  local DUP; DUP="$(runsql "SELECT display_id FROM public.orders WHERE display_id ~ '^[23456789BCDFGHJKMNPQRSTVWXYZ]{6}\$' LIMIT 1")"
  [ -n "$DUP" ] || fail "C 段合約:找不到既有 6 碼訂單可當碰撞值"
  calls() { runsql "SELECT CASE WHEN is_called THEN last_value ELSE 0 END FROM public.n3_call_seq"; }
  stub_counting() {
    runsql "CREATE OR REPLACE FUNCTION public.pcm_generate_display_id() RETURNS text
            LANGUAGE plpgsql VOLATILE AS \$\$BEGIN
              PERFORM pg_catalog.nextval('public.n3_call_seq');
              RETURN '${DUP}'::text; END\$\$" >/dev/null
  }
  stub_counting
  set +e; psql "$(url)" -qtA -c "$CALL" >/dev/null 2>&1; set -e
  local N_CALLS; N_CALLS="$(calls)"
  [ "$N_CALLS" = "5" ] || fail "§5.4a 合約「重試上限 5」未成立:helper 實際被呼叫 ${N_CALLS} 次"
  pass "C 段合約:重試上限實測 = ${N_CALLS} 次(§5.4a 寫死 5)"

  runsql "ALTER SEQUENCE public.n3_call_seq RESTART WITH 1" >/dev/null
  runsql "SELECT setval('public.n3_call_seq', 1, false)" >/dev/null
  stub_counting
  local MUTC; MUTC="$(mktemp)"
  sed "s/FOR v_attempt IN 1 .. 5 LOOP/FOR v_attempt IN 1 .. 1 LOOP/; s/IF v_attempt = 5 THEN/IF v_attempt = 1 THEN/" "$SHIPPED_DEF" > "$MUTC"
  grep -q "IN 1 .. 1 LOOP" "$MUTC" || fail "C-m1:突變沒改到迴圈上限"
  psql "$(url)" -v ON_ERROR_STOP=1 -q -f "$MUTC" >/dev/null
  set +e; psql "$(url)" -qtA -c "$CALL" >/dev/null 2>&1; set -e
  N_CALLS="$(calls)"
  [ "$N_CALLS" = "1" ] \
    && pass "C-m1 突變證明有效:上限改 1 ⇒ helper 只被呼叫 1 次(合約斷言會紅)" \
    || { rm -f "$MUTC"; fail "C-m1 突變後呼叫次數為 ${N_CALLS}(應為 1)⇒ 上限斷言證明不了任何事"; }
  restore_co; rm -f "$MUTC"
  runsql "DROP SEQUENCE public.n3_call_seq" >/dev/null
    restore_helper || fail "C-m1 後重新套用 N3a 失敗"

  # ── D 段:非 display_id 的 unique violation 必須原樣上拋、不被重試吞 ──
  # 🔴 R2 nit N3:斷言必須驗【錯誤身分】(SQLSTATE 23505 + 約束名),不是只驗「失敗」。
  #    只驗失敗的話,D-m1 突變下會變成第 5 次的 P0001 pcm_display_id_exhausted、
  #    照樣失敗、D 段照樣綠 = 突變抓不到。
  # create_order 的 INSERT 不含 tappay_rec_trade_id(plan 事實 #5)⇒ 撞不到那條;
  # 改對 cart_session_id 加臨時 UNIQUE(它確實在 INSERT 欄位列裡)。
  # 冪等:上一次失敗的執行可能留下它(首次實跑踩到 "already exists")
  runsql "ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS n3_tmp_cart_uniq" >/dev/null
  runsql "ALTER TABLE public.orders ADD CONSTRAINT n3_tmp_cart_uniq UNIQUE (cart_session_id)" >/dev/null
  local FIXED_CS="11111111-2222-4333-8444-555555555555"
  runsql "UPDATE public.orders SET cart_session_id = '${FIXED_CS}' WHERE id = (SELECT id FROM public.orders ORDER BY created_at DESC LIMIT 1)" >/dev/null
  local CALL_DUP
  CALL_DUP="$(printf '%s' "$CALL" | sed "s/gen_random_uuid()/'${FIXED_CS}'::uuid/")"
  set +e
  # 🔴 SQLSTATE 要靠 VERBOSITY=verbose 才會出現在訊息裡;它是 psql 特殊變數,
  #    必須用 -v 帶(塞進 -c 會被當成 SQL 的一部分 —— 首次實跑就是這樣壞的)。
  out="$(psql "$(url)" -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -qtA -c "${CALL_DUP}" 2>&1)"
  res=$?
  set -e
  [ "$res" -ne 0 ] || fail "D 段:重複 cart_session_id 竟然建單成功(臨時 UNIQUE 沒生效?)"
  echo "$out" | grep -q "23505" \
    || { echo "$out" | tail -4 >&2; fail "D 段:SQLSTATE 不是 23505(unique_violation)⇒ 錯誤身分不符"; }
  echo "$out" | grep -q "n3_tmp_cart_uniq" \
    || { echo "$out" | tail -4 >&2; fail "D 段:錯誤未指向 n3_tmp_cart_uniq ⇒ 不能證明是它擋的"; }
  echo "$out" | grep -q "pcm_display_id_exhausted" \
    && fail "D 段:非 display_id 的碰撞被重試迴圈吞掉了(變成產號用盡)⇒ 這正是要防的"
  pass "D 段:非 display_id 的 unique violation 原樣上拋(23505 + n3_tmp_cart_uniq、無重試痕跡)"

  # ── D-m1 突變:拿掉 constraint_name 核對 ⇒ D 段必須轉紅 ──────
  local MUT; MUT="$(mktemp)"
  sed "s/IF v_cname IS DISTINCT FROM 'orders_display_id_key' THEN/IF false THEN/" "$SHIPPED_DEF" > "$MUT"
  grep -q "IF false THEN" "$MUT" || fail "D-m1:突變沒改到 constraint_name 核對那行"
  psql "$(url)" -v ON_ERROR_STOP=1 -q -f "$MUT" >/dev/null
  set +e
  out="$(psql "$(url)" -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -qtA -c "${CALL_DUP}" 2>&1)"
  set -e
  if echo "$out" | grep -q "pcm_display_id_exhausted"; then
    pass "D-m1 突變證明有效:拿掉核對後,cart_session_id 的碰撞被吞成「產號用盡」"
  else
    echo "$out" | tail -4 >&2
    fail "D-m1 突變後行為未改變 ⇒ D 段的斷言證明不了 constraint_name 核對真的在起作用"
  fi
  restore_co
  rm -f "$MUT"

  runsql "ALTER TABLE public.orders DROP CONSTRAINT n3_tmp_cart_uniq" >/dev/null
  pass "臨時 UNIQUE 已移除、函式已還原成出貨版"

  rm -f "$SHIPPED_DEF"
  trap - EXIT
  echo "== §4.1 行為段全數通過 ==" >&2
}

case "${1:-}" in
  n3a-mutations) n3a_mutations ;;
  n3b-verbatim)  python3 scripts/n3b-verbatim-check.py ;;
  n3b-behaviour) n3b_behaviour "${2:?缺 workdir}" ;;
  all)
    # 🔴 M1(關卡2-A):這三個子命令原本只寫在 usage 裡、case 沒有分支 ⇒ 實跑會落到 *)。
    #    §4.1d 那道「最大裸露面」的守門等於不在 harness 內、只能手跑 = 字面 vs 事實。
    n3a_mutations
    require_free_port
    WORK="$(mktemp -d)"
    # 🔴 W7 跟片⑥(2026-08-09,R3 F5 + R1 F1/F2):原本是
    #      trap '( teardown "$WORK" ) >/dev/null 2>&1 || true' EXIT
    #    輸出丟掉 + `|| true` ⇒ **teardown 失敗零可觀察**:workdir 留著、cluster 沒停,
    #    畫面上一個字都沒有、離場碼也是 0。
    # 🔴🔴 **但真正的洞比這個大**(R1 F1,我實測證了):`n3b_behaviour` 在自己尾端跑
    #    `trap - EXIT`(見該函式最後幾行)⇒ **綠路徑上這道 trap 早就被清掉、從來沒執行過**。
    #    檔頭寫的「all(自行 provision / teardown)」在成功路徑上是假的。
    #    實測:連跑兩次 `all`,留下兩支 `postgres -D <tmp>/pgdata`(54380 與 54390)還活著。
    #    ⇒ 綠路徑必須**自己顯式收**(照 s1b「顯式清理 + 收 trap」的形狀),trap 只負責異常路徑。
    # 🔴 本檔是 `set -euo pipefail` ⇒ trap 內 `TD_OUT="$(…)"` 一拿到非 0 就當場中止整個 trap,
    #    後面的判斷與 printf 一行都跑不到(實測:teardown 回 4 ⇒ 離場碼 4、警告零輸出,
    #    看起來就像我沒寫這段)。⇒ 捕捉狀態一律用 `|| rc=$?` 這種 `-e` 安全的形式。
    n3_teardown_now() {   # 🔴 不自己 exit —— 由呼叫端決定(顯式那側與 trap 那側的正確處置不同)
      local out rc=0
      out="$( ( teardown "$WORK" ) 2>&1 )" || rc=$?
      [ "$rc" -eq 0 ] || printf '🔴 TEARDOWN_WARN:teardown 失敗(rc=%s)⇒ 現場保留:%s\n%s\n' "$rc" "$WORK" "$out" >&2
      return "$rc"
    }
    trap 'TD_RC=$?; n3_teardown_now || { if [ "$TD_RC" -eq 0 ]; then exit 9; else exit "$TD_RC"; fi; }' EXIT
    ( provision "$WORK" ) >/dev/null 2>&1 || fail "all:provision 失敗"
    python3 scripts/n3b-verbatim-check.py || fail "all:§4.1d 機械比對失敗"
    n3b_behaviour "$WORK"
    # 🔴 R1 F1:`n3b_behaviour` 尾端的 `trap - EXIT` 已經把上面那道 trap 清掉了 ⇒ 走到這裡
    #    是**沒有任何 EXIT trap** 的狀態,綠路徑的 teardown 只能靠這一句。先收 trap 再收現場,
    #    避免「顯式收了一次、trap 又收一次」。
    trap - EXIT
    n3_teardown_now || exit 9
    ;;
  *)
    echo "用法:$0 n3a-mutations | n3b-verbatim | n3b-behaviour <workdir> | all" >&2
    exit 2
    ;;
esac
