#!/usr/bin/env bash
#
# W3-1 驗收 harness —— `admin_create_shipment` 業務層 + W0 三件(產號重試 / 23505 三面分派 / 耗盡碼)
#
# 用法:scripts/w3a-verify.sh        (自建拋棄式 cluster、跑完自動 teardown)
# 格數:凍結在 `EXPECT_TOTAL`;新增/刪格必同批更新,否則 `CELL-ACCOUNT` 紅。
# 真權威:plan v4.2 §2 W3 列 / §1d / §7 F2 + 主視窗 `B-195-A` ③ 的四條硬前置
# 被測物:supabase/migrations/20260807170000_m4b_e10_b2_w3a_create_shipment.sql(**實檔,非內嵌副本**)
#
# ══ 判準四句(承自 w0b/w1/w2-verify.sh)══════════════════════════
#   🔴 消融必須由紅轉綠,否則判別力歸屬錯。
#   🔴 全綠的消融也可能恆真,隔離守門自己要有靶。
#   🔴 「我的 SQL 寫壞了」不得與「被別的守門擋住」共用同一句結論。
#   🔴 家族格的靶不得只打一個成員。
# 🔴 `cap()` 只吃**運算式**;語句(UPDATE/INSERT/DELETE)一律用 `capstmt()`
#    —— 餵錯會在 plpgsql 編譯期爆、`RAISE NOTICE` 沒跑到 ⇒ 回空字串被讀成「無錯誤」。
#    (w2-verify 在這個坑上跌過兩次,第二次是跨模型審查才抓到的恆真格。)
#
# 🔴 本檔跑在**裸 PG,不是 Supabase** ⇒ ACL 格證不了正式站最終權限,只有 apply 後在 A 庫驗才消。
# 🔴 **格數全綠證的是「寫下的守門有判別力」,證不了「該有的守門都想到了」。**
set -u
export LC_ALL=C LANG=C
REPO="$(cd "$(dirname "$0")/.." && pwd)"
D="${W3ADB:-/tmp/w3adb}"; SOCK="${W3ASOCK:-/tmp/w3ask}"; P="${W3APORT:-54393}"
PASS=0; FAIL=0; KEYS=""
EXPECT_TOTAL=21   # 🔴 量出來的。全綠時 PASS = 21 + CELL-ACCOUNT + CELL-KEYSET = 23。
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
capstmt() {
  psql -X -h "$SOCK" -p $P -U postgres -d postgres -qtA -c \
    "DO \$cs\$ DECLARE c text; n text; BEGIN BEGIN $1; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS c = RETURNED_SQLSTATE, n = CONSTRAINT_NAME; RAISE NOTICE 'CAP|%|%', c, coalesce(n,'(null)'); END; END \$cs\$;" 2>&1 \
    | sed -n 's/.*CAP|\(.*\)/\1/p' | tr -d '\n'
}

W3AMIG="${W3AMIG:-$REPO/supabase/migrations/20260807170000_m4b_e10_b2_w3a_create_shipment.sql}"
[ -f "$W3AMIG" ] || die "W3A_MIG_MISSING: $W3AMIG"
# 🔴🔴 **前綴重放(取代原本的 NEWEST_TS 尾端閘)。**
#    原本的做法是「先套所有不是被測物的 migration、最後才套被測物」——
#    那在**被測物之後又多了片**的當天就會出錯:更晚的片會先被套、再被被測物覆蓋回舊版,
#    而本檔照樣全綠(測的是一個現實中不存在的狀態)。W3-1 落檔當天這道閘真的響了。
#    ⇒ 處置照該閘 die 訊息的字面:**重排重放順序** —— 只重放 `TS <= 被測物` 的前綴,
#      被測物自然就是尖端。本檔因此**不再對「目錄尾端」有意見**,新增更晚的片不會再誤紅。
#    🔴 代價寫明:本檔**證不了**「被測物在更晚的片之上仍成立」—— 那是那些片自己的 harness 的事。
PREFIX_TS="20260807170000"

cd "$REPO" || die "CD_FAIL"
psql -X -h "$SOCK" -p $P -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f scripts/d1-supabase-shim.sql >/dev/null || die "SHIM_FAIL"
FIRST_FITMENTS="$(grep -l 'product_fitments_effective' supabase/migrations/*.sql | sort | head -1)"
for f in supabase/migrations/*.sql; do
  case "$f" in *20260723120000*) continue ;; esac
  case "$(basename "$f")" in [0-9]*) : ;; *) die "MIG_NAME_NOT_TS: $f" ;; esac
  TS="${f##*/}"; TS="${TS%%_*}"   # 🔴 原本誤寫成 %%%%_*(永不匹配)⇒ TS=完整檔名,下面的 `=` 分支是死的、被測物是靠字典序**碰巧**被排除。Fable 用 od 驗位元組抓到。
  [ "$TS" \> "$PREFIX_TS" ] && continue          # 前綴外的片不套
  [ "$TS" = "$PREFIX_TS" ] && continue            # 被測物留到 DDL-SYNTAX 才套
  if [ "$f" = "$FIRST_FITMENTS" ]; then
    psql -X -h "$SOCK" -p $P -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f scripts/d1-fitments-bootstrap.sql >/dev/null || die "FITBOOT_FAIL"
  fi
  psql -X -h "$SOCK" -p $P -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null 2>"$D/err" || die "MIG_FAIL: $f :: $(cat "$D/err")"
done
[ "$(Q "SELECT (pg_catalog.to_regprocedure('public.pcm_b2_shipping_idem_claim(text,text,text)') IS NOT NULL)::text")" = "true" ] \
  || die "UPSTREAM_MISSING: W2 的冪等層不在"

echo "══ 0. DDL 語法(被測物 = migration 實檔) ══════════════════"
OUT="$(psql -X -h "$SOCK" -p $P -U postgres -d postgres -qtA -f "$W3AMIG" 2>&1)"
case "$OUT" in
  *ERROR*) bad DDL-SYNTAX "migration 跑不起來:$OUT"; exit 1 ;;   # 🔴 收尾交給 trap teardown(原本這裡是無條件 rm -rf = fail-open)
  *) ok DDL-SYNTAX "migration 實檔在 PG $(Q "SHOW server_version") 實跑成功" ;;
esac

# ── fixture ───────────────────────────────────────────────────
CUST='11111111-1111-1111-1111-111111111111'
Q "INSERT INTO auth.users(id,email) VALUES('$CUST','w3a@test.local')" >/dev/null
Q "INSERT INTO public.customers(user_id,email) VALUES('$CUST','w3a@test.local')" >/dev/null
RCP='{"name":"王大明","phone":"0900000000","line":"L1"}'

echo "══ 1. 建箱成功路徑 + 回傳形狀契約 ═════════════════════════"
R1="$(Q "SELECT public.admin_create_shipment('k-ok','$CUST','$RCP'::jsonb,'hct')")"
case "$R1" in
  *'"idempotent": false'*'"shipment_id"'*) ok W3A-CREATE-OK "建箱成功,回的是 record() 的信封(idempotent=false + shipment_id + 快照)✓" ;;
  *) bad W3A-CREATE-OK "回傳形狀不對:[$R1]" ;;
esac
SID="$(Q "SELECT ('$R1'::jsonb ->> 'shipment_id')")"
ROW="$(Q "SELECT (shipment_reference ~ '^[23456789BCDFGHJKMNPQRSTVWXYZ]{6}\$')::text||'|'||(customer_user_id::text='$CUST')::text||'|'||carrier_code||'|'||coalesce(carrier_note,'(null)') FROM public.shipments WHERE id='$SID'")"
[ "$ROW" = "true|true|hct|(null)" ] && ok W3A-ROW-SHAPE "實際列:單號合格式 / 客人正確 / carrier=hct / note 為 NULL ✓" \
                                   || bad W3A-ROW-SHAPE "實際列不符:[$ROW]"
# 🔴 開工令 ②:快照必須 to_jsonb 同源 ⇒ 重放時逐值比對必然相等。
R2="$(Q "SELECT public.admin_create_shipment('k-ok','$CUST','$RCP'::jsonb,'hct')")"
SAME="$(Q "SELECT (('$R1'::jsonb - 'idempotent') = ('$R2'::jsonb - 'idempotent'))::text||'|'||('$R2'::jsonb->>'idempotent')")"
[ "$SAME" = "true|true" ] && ok W3A-REPLAY-IDENTICAL "同鍵同 payload 重放:**逐鍵與首次相同、只差 idempotent** ⇒ to_jsonb 同源契約成立 ✓" \
                          || bad W3A-REPLAY-IDENTICAL "重放與首次不一致:[$SAME] 首次=[$R1] 重放=[$R2]"
N="$(Q "SELECT pg_catalog.count(*)::text FROM public.shipments WHERE customer_user_id='$CUST'")"
[ "$N" = "1" ] && ok W3A-REPLAY-NO-SECOND-BOX "🔴 重放之後包裹數仍是 1 ⇒ **沒有多開一箱**(這一整層存在的理由)✓" \
               || bad W3A-REPLAY-NO-SECOND-BOX "🔴 包裹數 = $N ⇒ 同鍵重試多開了箱"

echo "══ 2. 🔴 開工令 ②:快照的**值的字面形**(Fable F3 那條)═════"
# 🔴 反證:手工用「大寫 uuid」種一份快照 ⇒ 重放必須紅在 P2B24。
#    這格證的是「為什麼一定要 to_jsonb 同源」,不是「我有記得照做」。
UPPER="$(Q "SELECT pg_catalog.upper('$SID')")"
Q "ALTER TABLE public.pcm_b2_shipping_idempotency DISABLE TRIGGER pcm_b2_shipping_idem_block_bad_snapshot_insert" >/dev/null
Q "ALTER TABLE public.pcm_b2_shipping_idempotency DISABLE TRIGGER pcm_b2_shipping_idem_require_complete" >/dev/null
Q "INSERT INTO public.pcm_b2_shipping_idempotency(action,idempotency_key,payload_hash,shipment_id,result_snapshot) VALUES('create_shipment','k-upper', public.pcm_b2_shipping_idem_payload_hash('create_shipment', pg_catalog.jsonb_build_object('customer_user_id','$CUST'::uuid,'recipient_snapshot','$RCP'::jsonb,'carrier_code','hct','carrier_note',NULL)), '$SID', pg_catalog.jsonb_build_object('id','$UPPER'))" >/dev/null
Q "ALTER TABLE public.pcm_b2_shipping_idempotency ENABLE ALWAYS TRIGGER pcm_b2_shipping_idem_block_bad_snapshot_insert" >/dev/null
Q "ALTER TABLE public.pcm_b2_shipping_idempotency ENABLE ALWAYS TRIGGER pcm_b2_shipping_idem_require_complete" >/dev/null
C="$(cap "public.admin_create_shipment('k-upper','$CUST','$RCP'::jsonb,'hct')")"
[ "$C" = "P2B24|pcm_b2_w2_idem_invariant_broken" ] \
  && ok W3A-SNAPSHOT-LITERAL-FORM "🔴 快照用大寫 uuid(非 to_jsonb 同源)⇒ 合法重試當場 P2B24 = 那條契約**真的有後果**,不是散文 ✓" \
  || bad W3A-SNAPSHOT-LITERAL-FORM "實得 [$C](期望 P2B24 invariant_broken)⇒ 這格證不了那條契約"

echo "══ 3. 前緣人話驗證(訊息層;非正確性層)═══════════════════"
i=0
for t in "'x-bad1','$CUST','$RCP'::jsonb,'fedex'|P2B26|pcm_b2_w3a_carrier_code_domain" \
         "'x-bad2','$CUST','$RCP'::jsonb,'other'|P2B26|pcm_b2_w3a_carrier_note_pair" \
         "'x-bad3','$CUST','$RCP'::jsonb,'hct','有話說'|P2B26|pcm_b2_w3a_carrier_note_pair" \
         "'x-bad4','99999999-9999-9999-9999-999999999999','$RCP'::jsonb,'hct'|P2B26|pcm_b2_w3a_customer_missing" \
         "'x-bad5','$CUST',NULL,'hct'|P2B26|pcm_b2_w3a_recipient_shape" \
         "'x-bad6','$CUST','{\"name\":\"A\"}'::jsonb,'hct'|P2B26|pcm_b2_w3a_recipient_shape"; do
  i=$((i+1)); ARGS="${t%%|*}"; WANT="${t#*|}"
  C="$(cap "public.admin_create_shipment($ARGS)")"
  [ "$C" = "$WANT" ] && ok "W3A-FRONTEDGE-$i" "前緣拒絕碼/名逐字相符($WANT)✓" \
                     || bad "W3A-FRONTEDGE-$i" "實得 [$C] 期望 [$WANT]"
done
# 🔴 訊息層**不是**正確性層:拿掉它資料仍然進不去。這格證那句話。
C="$(capstmt "INSERT INTO public.shipments(shipment_reference,customer_user_id,recipient_snapshot,carrier_code) VALUES('4TFBFH','$CUST','$RCP'::jsonb,'fedex')")"
case "$C" in
  23514*) ok W3A-FRONTEDGE-NOT-THE-GUARD "🔴 繞過 RPC 直寫壞 carrier_code ⇒ 仍被 CHECK 擋(23514)= 前緣那段是訊息層、不是唯一防線 ✓" ;;
  *) bad W3A-FRONTEDGE-NOT-THE-GUARD "實得 [$C] ⇒ 前緣段可能是唯一防線" ;;
esac

echo "══ 4. 🔴 零 RETURN 錯誤值(開工令 ①)═══════════════════════"
# 🔴 拒絕路徑若 RETURN 一個錯誤 jsonb,冪等鍵列會**照樣 commit** ⇒ 那把鍵被燒掉、
#    下次合法重試拿到假成功。⇒ 斷言「錯誤路徑跑完之後,鍵表沒有那把鍵」。
KN="$(Q "SELECT pg_catalog.count(*)::text FROM public.pcm_b2_shipping_idempotency WHERE idempotency_key IN ('x-bad1','x-bad2','x-bad3','x-bad4','x-bad5','x-bad6')")"
# 🔴 **歸屬誠實化(跨模型審查 Fable)**:本格觀察到的「鍵表零列」**不只由本片的 RAISE 供給** ——
#    就算把前緣改成 `RETURN` 錯誤 jsonb,W2 的 DEFERRED `require_complete` 也會在 commit 當下擋下、
#    鍵表照樣零列 ⇒ 本格**證不了「本片有 RAISE」**,它證的是「**鍵不會外洩**」這個結果(兩層供給)。
#    真正釘住「本片全路徑 RAISE」的是 `W3A-FRONTEDGE-1..4` 的 SQLSTATE 逐字比對。
#    (memory `feedback_negative-test-observation-supplied-by-another-mechanism`)
[ "$KN" = "0" ] && ok W3A-NO-BURNED-KEY "六條拒絕路徑跑完鍵表零列 ⇒ **鍵不外洩**(本片 RAISE + W2 commit 閘兩層供給;本格不獨占歸屬)✓" \
                || bad W3A-NO-BURNED-KEY "🔴 鍵表殘留 $KN 列 ⇒ 兩層都沒擋住,鍵被燒掉了"

echo "══ 5. 🔴 W0 三件:產號重試 / 三面分派 / 耗盡碼 ══════════════"
# ① 把產號器換成**常數** ⇒ 第二次建箱必撞 `shipments_reference_unique`,重試 5 次後耗盡
# 🔴 **不得用 `Q()` 取函式定義**:它會 `tr -d '\n'` 把多行定義壓成一行,
#    body 裡的 `--` 註解會把後面整段吃掉 ⇒ 還原失敗、而且**失敗是靜默的**。
#    首跑實錘:還原沒生效、產號器仍是計數版(永遠回 '5TFBFH')⇒ 後面兩格全部紅在莫名其妙的地方。
#    ⇒ 存成檔案再 `-f` 回放。
psql -X -h "$SOCK" -p $P -U postgres -d postgres -qtA \
  -c "SELECT pg_catalog.pg_get_functiondef('public.pcm_generate_display_id()'::regprocedure)" > "$D/gen.sql" 2>&1
grep -q 'CREATE OR REPLACE FUNCTION' "$D/gen.sql" || die "GEN_SNAPSHOT_FAIL: 取不到產號器定義"
Q "CREATE OR REPLACE FUNCTION public.pcm_generate_display_id() RETURNS text LANGUAGE sql AS \$m\$ SELECT '4TFBFH'::text \$m\$" >/dev/null
Q "SELECT public.admin_create_shipment('k-const1','$CUST','$RCP'::jsonb,'hct')" >/dev/null
C="$(cap "public.admin_create_shipment('k-const2','$CUST','$RCP'::jsonb,'hct')")"
[ "$C" = "P2B21|pcm_b2_w3a_reference_exhausted" ] \
  && ok W3A-RETRY-EXHAUSTED "🔴 產號器變常數 ⇒ 重試耗盡走**自己的碼** P2B21(不是靜默失敗、也不是無限迴圈)✓" \
  || bad W3A-RETRY-EXHAUSTED "實得 [$C](期望 P2B21|pcm_b2_w3a_reference_exhausted)"
KN="$(Q "SELECT pg_catalog.count(*)::text FROM public.pcm_b2_shipping_idempotency WHERE idempotency_key='k-const2'")"
[ "$KN" = "0" ] && ok W3A-EXHAUSTED-NO-BURN "耗盡路徑鍵表零列(同上:兩層供給、本格不獨占歸屬)✓" || bad W3A-EXHAUSTED-NO-BURN "鍵表殘留 $KN 列"
# ② 🔴 重試**真的有在重試**:產號器改成「前 3 次回同一個既有值、第 4 次回新值」⇒ 必須成功
Q "CREATE TABLE public.w3a_gen_calls(n int)" >/dev/null
Q "CREATE OR REPLACE FUNCTION public.pcm_generate_display_id() RETURNS text LANGUAGE plpgsql AS \$m\$ DECLARE c int; BEGIN INSERT INTO public.w3a_gen_calls VALUES (1); SELECT pg_catalog.count(*) INTO c FROM public.w3a_gen_calls; IF c >= 4 THEN RETURN '5TFBFH'; END IF; RETURN '4TFBFH'; END \$m\$" >/dev/null
R3="$(Q "SELECT public.admin_create_shipment('k-retry','$CUST','$RCP'::jsonb,'hct')")"
CALLS="$(Q "SELECT pg_catalog.count(*)::text FROM public.w3a_gen_calls")"
case "$R3:$CALLS" in
  *'"idempotent": false'*:4) ok W3A-RETRY-WORKS "🔴 前 3 次撞號、第 4 次拿到新號 ⇒ **建箱成功且產號器恰被呼叫 4 次** = 迴圈真的在重試 ✓" ;;
  *) bad W3A-RETRY-WORKS "回傳=[$R3] 產號呼叫次數=[$CALLS](期望成功 + 4 次)" ;;
esac
psql -X -h "$SOCK" -p $P -U postgres -d postgres -qtA -f "$D/gen.sql" >/dev/null 2>&1   # 還原真產號器
# 🔴 還原的驗收**不能只驗格式** —— 計數版回的 '5TFBFH' 也合格式 ⇒ 那樣是恆真格(首跑實錘)。
#    真正分得出「真產號器 vs 常數」的是**變異性**。
GENN="$(Q "SELECT pg_catalog.count(DISTINCT public.pcm_generate_display_id())::text FROM pg_catalog.generate_series(1,200)")"
GENOK="$(Q "SELECT (public.pcm_generate_display_id() ~ '^[23456789BCDFGHJKMNPQRSTVWXYZ]{6}\$')::text")"
case "$GENOK:$GENN" in
  true:*) [ "$GENN" -gt 100 ] 2>/dev/null \
            && ok W3A-GEN-RESTORED "真產號器已還原:200 抽 $GENN 個相異值 + 格式合格 ⇒ 不是常數(後面的格量的是真的那支)✓" \
            || bad W3A-GEN-RESTORED "🔴 200 抽只有 $GENN 個相異 ⇒ 還原失敗、仍是常數版(後面每一格都會紅在錯的地方)" ;;
  *)      bad W3A-GEN-RESTORED "還原後格式不合:[$GENOK]" ;;
esac
# ③ 🔴 三面分派:非 reference 的 23505 **不得**被當成撞號重產
#    構造:臨時在 shipments 加一條 UNIQUE(recipient_snapshot),用同一份收件資料再建一箱。
# 🔴 首跑實錘:原本加在 `recipient_snapshot` 上,而前面幾格已經用同一份收件資料建了多箱
#    ⇒ ADD CONSTRAINT 失敗。本格的「前置沒成立」分支正確擋下了錯誤結論(判準第三句在做事)。
#    ⇒ 改用**現存零列命中**的 partial unique index:`carrier_code='sf'`(前面全是 hct)。
ALT="$(QM "CREATE UNIQUE INDEX w3amut_uq ON public.shipments(carrier_code) WHERE carrier_code = 'sf'" | tr -d '\n')"
Q "SELECT public.admin_create_shipment('k-sf1','$CUST','$RCP'::jsonb,'sf')" >/dev/null
if [ "$(Q "SELECT (pg_catalog.to_regclass('public.w3amut_uq') IS NOT NULL)::text")" != "true" ]; then
  bad W3A-DISPATCH-FOREIGN "🔴 本格的**前置**沒成立(臨時 UNIQUE 沒建起來:$ALT)⇒ 這不是分派的結論"
else
  C="$(cap "public.admin_create_shipment('k-sf2','$CUST','$RCP'::jsonb,'sf')")"
  case "$C" in
    23505*w3amut_uq*) ok W3A-DISPATCH-FOREIGN "撞到**非 reference** 的唯一面 ⇒ 原封拋回 23505(實得 [$C]),沒被當撞號重產 ✓" ;;
    P2B21*)           bad W3A-DISPATCH-FOREIGN "🔴 被當成撞號重產到耗盡 ⇒ 分派沒有按 conname" ;;
    *)                bad W3A-DISPATCH-FOREIGN "實得 [$C]" ;;
  esac
  Q "DROP INDEX public.w3amut_uq" >/dev/null
fi

echo "══ 6. 🔴 突變靶 ═══════════════════════════════════════════"
# ① 冪等層被搬進迴圈(plan §1c 面 4 點名的災難)⇒ 必須看得出來
#    做法:把 claim 換成「每次都回 NULL」的版本 ⇒ 同鍵重試會**真的多開一箱**。
Q "CREATE OR REPLACE FUNCTION public.pcm_b2_shipping_idem_claim(p_action text, p_key text, p_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS \$m\$ BEGIN RETURN NULL; END \$m\$" >/dev/null
# 🔴🔴 **首跑推翻了我原本的預期**:我以為拿掉冪等層就會「真的多開一箱」,實測**箱數沒變**。
#    原因是 `record()` 會去 UPDATE 那把鍵既有的列,而 W0b 的 `freeze_identity` 擋住「改指別箱」
#    ⇒ 整筆 rollback。**第二箱是被第二層擋掉的,不是沒發生。**
#    ⇒ 本格改成**歸屬格**:斷言「拿掉冪等層之後,擋下它的是 W0b 的 freeze_identity」。
#      這比原本那個斷言誠實,也才是真正在證的事(memory
#      `feedback_negative-test-observation-supplied-by-another-mechanism`:一根因多症狀 ≠ 多證據)。
BEFORE="$(Q "SELECT pg_catalog.count(*)::text FROM public.shipments")"
M="$(cap "public.admin_create_shipment('k-ok','$CUST','$RCP'::jsonb,'hct')")"
AFTER="$(Q "SELECT pg_catalog.count(*)::text FROM public.shipments")"
case "$M:$BEFORE:$AFTER" in
  "P0001|pcm_b2_shipping_idem_freeze_identity:$BEFORE:$BEFORE")
     ok TMUT-IDEMPOTENCY "🔴 把 claim 換成永遠回 NULL ⇒ **不是多開一箱,而是被 W0b 的 freeze_identity 擋下**(箱數 $BEFORE 不變)= 第二箱有兩層在守,歸屬已釘" ;;
  *) bad TMUT-IDEMPOTENCY "實得 [$M]、箱數 $BEFORE→$AFTER ⇒ 與預期的歸屬不符,要重新查是誰擋的" ;;
esac
# ② 前緣驗證族:拿掉 carrier_code 那道 ⇒ 該格必須翻面(改由 CHECK 接手、碼會變)
Q "CREATE OR REPLACE FUNCTION public.admin_create_shipment(p_idempotency_key text, p_customer_user_id uuid, p_recipient_snapshot jsonb, p_carrier_code text, p_carrier_note text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS \$m\$ DECLARE v jsonb; BEGIN INSERT INTO public.shipments(shipment_reference,customer_user_id,recipient_snapshot,carrier_code) VALUES(public.pcm_generate_display_id(),p_customer_user_id,p_recipient_snapshot,p_carrier_code) RETURNING pg_catalog.to_jsonb(shipments.*) INTO v; RETURN v; END \$m\$" >/dev/null
M="$(cap "public.admin_create_shipment('x-mut','$CUST','$RCP'::jsonb,'fedex')")"
case "$M" in
  P2B26*) bad TMUT-FRONTEDGE "拿掉前緣段後仍回 P2B26 ⇒ 那族守的不是這段" ;;
  23514*) ok  TMUT-FRONTEDGE "🔴 拿掉前緣人話段 ⇒ 員工拿到的變成 raw 23514(實得 [$M])= 訊息層那族有判別力,且證實它不是唯一防線" ;;
  *)      bad TMUT-FRONTEDGE "實得 [$M]" ;;
esac

echo "══ 7. 覆蓋帳 ══════════════════════════════════════════════"
TOT=$((PASS+FAIL))
if [ "$TOT" = "$EXPECT_TOTAL" ]; then
  printf '  PASS %-34s %s\n' "CELL-ACCOUNT" "格數 $TOT = 凍結值 $EXPECT_TOTAL"; PASS=$((PASS+1))
else
  printf '  FAIL %-34s %s\n' "CELL-ACCOUNT" "格數 $TOT != 凍結值 $EXPECT_TOTAL ⇒ 有格被刪、被跳過、或新增未更新凍結值"; FAIL=$((FAIL+1))
fi
DUP="$(printf '%s' "$KEYS" | tr ' ' '\n' | grep -v '^$' | sort | uniq -d | tr '\n' ' ')"
[ -z "$DUP" ] || { printf '  FAIL %-34s %s\n' "CELL-DUP" "重複格名 [$DUP]"; FAIL=$((FAIL+1)); }
KEYS_NOW="$(printf '%s' "$KEYS" | tr ' ' '\n' | grep -v '^$' | sort | tr '\n' ' ' | sed 's/ *$//')"
KEYS_FROZEN="DDL-SYNTAX TMUT-FRONTEDGE TMUT-IDEMPOTENCY W3A-CREATE-OK W3A-DISPATCH-FOREIGN W3A-EXHAUSTED-NO-BURN W3A-FRONTEDGE-1 W3A-FRONTEDGE-2 W3A-FRONTEDGE-3 W3A-FRONTEDGE-4 W3A-FRONTEDGE-5 W3A-FRONTEDGE-6 W3A-FRONTEDGE-NOT-THE-GUARD W3A-GEN-RESTORED W3A-NO-BURNED-KEY W3A-REPLAY-IDENTICAL W3A-REPLAY-NO-SECOND-BOX W3A-RETRY-EXHAUSTED W3A-RETRY-WORKS W3A-ROW-SHAPE W3A-SNAPSHOT-LITERAL-FORM"
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
