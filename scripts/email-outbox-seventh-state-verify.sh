#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
# 第七態 skipped_shipment_voided:**行為驗證的唯一落點**
#
# 🛑 2026-08-30 Sean 拍板【甲】之後,這支的角色變了 —— 讀之前先知道:
#    ~~舊角色:驗「那支 migration 內建的行為閘會不會叫」~~ **那道閘已經被拿掉了。**
#    ✅ 新角色:**由本 harness 自己**在拋棄式 PG 上寫一列第七態、回頭讀,看它有沒有留下來。
#    ⇒ 📌 **同一個檢查,搬了一個地方 —— 而那個地方的差別是:在這裡寫一列是免費的。**
#      在正式庫寫一列會踩到未知觸發器的交易外副作用、會與真交易死結;在這裡兩者都不存在。
#      (拿掉的完整理由在 migration 第 4 節,那一段很長而它值得。)
#
# 🔴 **這支不是「順便跑一下」——【它是這一片行為那一層的全部證據】。**
#    migration 只驗定義(CHECK 的字面 / 是否 validated / COMMENT 的字面)。
#    **「CHECK 的字面對了」與「它擋不擋得住東西」是兩個宣稱**,而後者只有這裡在答。
#
# ── 做法 ──────────────────────────────────────────────────────────────────────
#   每個世界:建 fixture(舊的六態世界)→ 種一種阻擋 → 跑【真的那支 migration】
#            → **由 harness 自己 INSERT 第七態 → 回頭讀那一列還在不在、status 對不對**
#   三種結果,分得開:
#     GREEN     migration 過了,而且第七態真的留在表裡
#     PROBE-RED migration 過了,但第七態【沒有留下來】(被擋 / 被靜默取消 / 被改寫 / 被導走)
#     MIG-RED   migration 自己就紅了(定義閘攔下)
#
# ── 🔴 射程(有分母才叫射程)────────────────────────────────────────────────
#   ✅ `email_outbox` 的建表 DDL **從 20260717020000 原樣抽出**,不是手抄
#      ⇒ 欄、CHECK(含 last_error_code 的真 regex)、FK、DEFAULT 全是真的那一份。
#   🔴 **而它仍然【不是】正式庫,少的東西列在這裡**:
#      · RLS / policies / FORCE RLS ⇒ 一格都沒有
#      · GRANT / 角色(以 owner 身分跑)
#      · 建表那支之後的索引,與後續 migration 對這張表做過的事
#      · 正式庫真實的資料分佈 —— 探針借的是本 harness 自己種的一筆空 order
#   ⇒ 📌 **它證得了「這些阻擋形狀會不會被抓到」,證不了「正式庫會不會綠」。**
#      而**正式庫那一格今天沒有人在證** —— 那是【甲】明知的代價,不是疏漏。
#
# 用法: bash scripts/email-outbox-seventh-state-verify.sh
# ══════════════════════════════════════════════════════════════════════════════
set -u
export LC_ALL=C LANG=C   # 🔴 postmaster 啟動時也要看到（見 scripts/admin-probe/up.sh:43）
REPO="$(cd "$(dirname "$0")/.." && pwd)"
M="$REPO/supabase/migrations/20260830060000_m4b_e4_outbox_shipment_voided_status.sql"
MIG_TABLE="$REPO/supabase/migrations/20260717020000_m4a_email_outbox.sql"
# 🔴 codex 抓:`mktemp` 失敗時 `D` 會是**空字串** ⇒ 後面每一個 "$D/xxx" 都變成 "/xxx"
#    ⇒ 有權限的環境會在**根目錄**留下殘骸,而 cleanup 也清不到它。
#    ⇒ 這不是量測結果、也不是「乾淨」⇒ 當場 ENV-FAIL(對齊 migration-static-checks.sh 的 exit 9)。
D=$(mktemp -d "${TMPDIR:-/tmp}/eo7.XXXXXXXX") || { echo "🔴 建不出暫存目錄(mktemp)⇒ 這不是量測結果, 也不是乾淨 ⇒ ENV-FAIL"; exit 9; }
PG=54372
KEEP=0
cleanup(){ pg_ctl -D "$D/pg" stop -m immediate >/dev/null 2>&1
  if [ "$KEEP" = 1 ]; then printf '🛑 非綠 ⇒ log 保留在 %s\n' "$D"; else rm -rf "$D"; fi; }
trap cleanup EXIT
for f in "$M" "$MIG_TABLE"; do [ -f "$f" ] || { echo "🔴 找不到 $f ⇒ ENV-FAIL"; KEEP=1; exit 2; }; done
for c in initdb pg_ctl psql; do command -v "$c" >/dev/null || { echo "🔴 缺 $c ⇒ ENV-FAIL"; KEEP=1; exit 2; }; done

# 🔴 建表 DDL 原樣抽出,不手抄(手抄的兩份一起抄錯時 harness 全綠,而正式的世界會炸)
sed -n '/^CREATE TABLE public\.email_outbox (/,/^);/p' "$MIG_TABLE" > "$D/ddl.sql"
DDL_BYTES=$(wc -c < "$D/ddl.sql" | tr -d ' ')
grep -q 'email_outbox_status_check' "$D/ddl.sql" && [ "$DDL_BYTES" -gt 800 ] \
  || { printf '🔴 抽不到建表 DDL(%s bytes)⇒ ENV-FAIL\n' "$DDL_BYTES"; KEEP=1; exit 2; }
printf '✅ email_outbox 建表 DDL 從 20260717020000 原樣抽出 %s bytes(不是手抄)\n' "$DDL_BYTES"

initdb -D "$D/pg" -U postgres --auth=trust --encoding=UTF8 --locale=C >"$D/i.log" 2>&1 || { echo "🔴 initdb ⇒ ENV-FAIL"; KEEP=1; exit 2; }
pg_ctl -D "$D/pg" -o "-p $PG -k /tmp" -l "$D/pg.log" start >/dev/null 2>&1 || { echo "🔴 pg_ctl ⇒ ENV-FAIL"; KEEP=1; exit 2; }
q(){ psql -h /tmp -p "$PG" -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }
PASS=0; FAIL=0

base(){
  { printf 'DROP RULE IF EXISTS zzr ON public.email_outbox;\n'
    printf 'DROP TABLE IF EXISTS public.email_outbox;\n'
    printf 'DROP TABLE IF EXISTS public.zzshadow;\n'
    printf 'DROP TABLE IF EXISTS public.orders;\n'
    printf 'DROP FUNCTION IF EXISTS public.zzf();\n'
    printf 'CREATE TABLE public.orders (id uuid primary key default gen_random_uuid());\n'
    cat "$D/ddl.sql"
    printf "COMMENT ON COLUMN public.email_outbox.status IS '6 態(種子;migration 會換掉它)';\n"
    printf 'INSERT INTO public.orders DEFAULT VALUES;\n'
  } > "$D/base.sql"
  q -q -f "$D/base.sql"
}

# 🔴 探針:harness 自己寫一列第七態,**然後回頭讀**。
#    「INSERT 沒有拋錯」不等於「那一列在表裡」—— BEFORE 觸發器 RETURN NULL、
#    AFTER 觸發器刪掉它、INSTEAD RULE 導去影子表,三種都不拋錯而那一列不在。
#    ⇒ 判準是**回頭數得到幾列**,不是 INSERT 的 rc。
cat > "$D/probe.sql" <<'PSQL'
INSERT INTO public.email_outbox (order_id, event_type, dedup_key, recipient_email, subject, payload, status)
SELECT o.id, 'order_shipped', '_pcm_probe_fixed',   -- 🔴 固定值:回頭讀要綁【這一列】
       'probe@example.invalid', '_pcm_probe', '{}'::jsonb, 'skipped_shipment_voided'
  FROM public.orders o ORDER BY o.id LIMIT 1;
PSQL
cat > "$D/readback.sql" <<'PSQL'
-- 🔴 codex R8 must-fix:原本只數「有幾列是第七態」⇒ **沒有綁定【我剛剛寫的那一列】** ——
-- 一個觸發器可以刪掉我的、同時另塞一筆別的第七態 ⇒ count 仍是 1 ⇒ 假綠。
-- ⇒ 連 dedup_key 一起比:問的是「我那一列在不在」,不是「表裡有沒有第七態」。
SELECT count(*) FROM public.email_outbox
 WHERE status = 'skipped_shipment_voided' AND dedup_key = '_pcm_probe_fixed';
PSQL

w(){ # $1=名 $2=額外SQL(種阻擋) $3=期望 GREEN|PROBE-RED|MIG-RED
  base > "$D/b.log" 2>&1 || { printf '  %-46s ⇒ 🔴 fixture 建不起來 ⇒ 本輪作廢\n' "$1"; KEEP=1; FAIL=$((FAIL+1)); return; }
  # 🔴 fixture 作廢一律計 FAIL:「沒量到」不可以與「量到綠」印同一個結果。
  grep -q ERROR "$D/b.log" && { printf '  %-46s ⇒ 🔴 fixture 有 ERROR ⇒ 本輪作廢\n' "$1"; KEEP=1; FAIL=$((FAIL+1)); return; }
  # 🔴 codex R9 must-fix:上一版只 grep 'ERROR' ⇒ **沒收 rc**。psql 的非零 rc 可以是 1/2/3,
  #    而**不保證輸出裡有 ERROR 這個字**(連不上、參數錯、檔讀不到)⇒ 前置 SQL 失敗了仍會往下判世界
  #    ⇒ 那個世界的「阻擋」根本沒種進去,而它會印一個合理的結果。
  #    ⇒ **rc 與字面兩個都收**:任一不對就作廢(而作廢一律計 FAIL)。
  if [ -n "$2" ]; then
    q -q -c "$2" > "$D/a.log" 2>&1 ; arc=$?
    if [ $arc -ne 0 ] || grep -q ERROR "$D/a.log"; then
      printf '  %-46s ⇒ 🔴 前置 SQL 失敗(rc=%s)⇒ 本輪作廢\n' "$1" "$arc"; KEEP=1; FAIL=$((FAIL+1)); return
    fi
  fi

  mo=$(q -f "$M" 2>&1); mrc=$?
  if [ $mrc -ne 0 ]; then
    # 🔴 非零 rc 要歸因:訊息裡沒有「閘」的,是無關的錯誤在冒充命中。
    if printf '%s' "$mo" | grep -q '前置閘\|事後閘'; then g=MIG-RED; else g=MIG-OTHER-ERR; fi
  else
    po=$(q -f "$D/probe.sql" 2>&1); prc=$?
    if [ $prc -ne 0 ]; then g=PROBE-RED
    else
      n=$(q -tAf "$D/readback.sql" 2>"$D/readback.err" | tr -d '[:space:]')
      case "$n" in
        1) g=GREEN ;;
        0) g=PROBE-RED ;;
        # 🔴 回讀不是 0 也不是 1 ⇒ 不當成任何一邊。而**判紅與診斷得出來是兩件事**:
        # 上一版把 stderr 丟掉、也沒記 n ⇒ 紅了而看不出是查詢失敗還是筆數奇怪。
        *) g=PROBE-WEIRD; printf 'readback n=[%s]\n--- stderr ---\n%s\n' \
             "$n" "$(cat "$D/readback.err" 2>/dev/null)" > "$D/readback-weird.log" ;;
      esac
    fi
  fi

  if [ "$g" = "$3" ]; then PASS=$((PASS+1)); m=✅; else FAIL=$((FAIL+1)); m=🔴; KEEP=1
    { printf '=== %s ===\n--- migration rc=%s ---\n%s\n--- probe ---\n%s\n' "$1" "$mrc" "$mo" "${po:-<未跑>}"; } > "$D/fail-$((PASS+FAIL)).log"; fi
  printf '  %-46s ⇒ %-13s (期望 %-9s) %s\n' "$1" "$g" "$3" "$m"
}

echo "══ 第七態行為驗證 · 十三個世界（由 harness 自己寫一列再回頭讀）"
w "① 乾淨舊世界（無阻擋）⇒ 第七態寫得進去" "" GREEN
w "② 殘留【不同名字】的六態 CHECK" "ALTER TABLE public.email_outbox ADD CONSTRAINT zz6 CHECK (status IN ('pending','sending'));" PROBE-RED
w "③ 禁 _voided 結尾（字串尺全瞎）" "ALTER TABLE public.email_outbox ADD CONSTRAINT zzv CHECK (status !~ '_voided\$');" PROBE-RED
w "④ 【同名】重建成排斥第七態（集合尺全瞎）" "ALTER TABLE public.email_outbox DROP CONSTRAINT email_outbox_subject_nonempty; ALTER TABLE public.email_outbox ADD CONSTRAINT email_outbox_subject_nonempty CHECK (subject <> '' AND status <> 'skipped_shipment_voided');" PROBE-RED
w "⑤ BEFORE 觸發器 RAISE 擋下" "CREATE FUNCTION zzf() RETURNS trigger AS \$x\$ BEGIN IF NEW.status='skipped_shipment_voided' THEN RAISE EXCEPTION 'blocked'; END IF; RETURN NEW; END \$x\$ LANGUAGE plpgsql; CREATE TRIGGER zzt BEFORE INSERT ON public.email_outbox FOR EACH ROW EXECUTE FUNCTION zzf();" PROBE-RED
# 🔴 下面三個是【不拋錯的】那一族 —— 它們正是「INSERT rc=0 不等於那一列在表裡」的證人。
#    少了回頭讀那一步,這三個世界會全部印綠。
w "⑥ BEFORE 觸發器 RETURN NULL（靜默取消）" "CREATE FUNCTION zzf() RETURNS trigger AS \$x\$ BEGIN IF NEW.status='skipped_shipment_voided' THEN RETURN NULL; END IF; RETURN NEW; END \$x\$ LANGUAGE plpgsql; CREATE TRIGGER zzt BEFORE INSERT ON public.email_outbox FOR EACH ROW EXECUTE FUNCTION zzf();" PROBE-RED
w "⑦ BEFORE 觸發器把 status 改寫成 pending" "CREATE FUNCTION zzf() RETURNS trigger AS \$x\$ BEGIN IF NEW.status='skipped_shipment_voided' THEN NEW.status='pending'; NEW.claimed_at=NULL; END IF; RETURN NEW; END \$x\$ LANGUAGE plpgsql; CREATE TRIGGER zzt BEFORE INSERT ON public.email_outbox FOR EACH ROW EXECUTE FUNCTION zzf();" PROBE-RED
w "⑧ AFTER 觸發器把那一列刪掉" "CREATE FUNCTION zzf() RETURNS trigger AS \$x\$ BEGIN IF NEW.status='skipped_shipment_voided' THEN DELETE FROM public.email_outbox WHERE id=NEW.id; END IF; RETURN NULL; END \$x\$ LANGUAGE plpgsql; CREATE TRIGGER zzt AFTER INSERT ON public.email_outbox FOR EACH ROW EXECUTE FUNCTION zzf();" PROBE-RED
w "⑨ INSTEAD RULE 導去影子表（自備 RETURNING）" "CREATE TABLE public.zzshadow (LIKE public.email_outbox INCLUDING DEFAULTS); CREATE RULE zzr AS ON INSERT TO public.email_outbox DO INSTEAD INSERT INTO public.zzshadow (id, order_id, event_type, dedup_key, recipient_email, subject, payload, status) VALUES (COALESCE(NEW.id, gen_random_uuid()), NEW.order_id, NEW.event_type, NEW.dedup_key, NEW.recipient_email, NEW.subject, NEW.payload, NEW.status) RETURNING zzshadow.*;" PROBE-RED
w "⑩ DEFERRED constraint trigger 拒第七態" "CREATE FUNCTION zzf() RETURNS trigger AS \$x\$ BEGIN IF NEW.status='skipped_shipment_voided' THEN RAISE EXCEPTION 'deferred block'; END IF; RETURN NULL; END \$x\$ LANGUAGE plpgsql; CREATE CONSTRAINT TRIGGER zzt AFTER INSERT ON public.email_outbox DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION zzf();" PROBE-RED
# 🔴 codex R8 點名的那一個繞法,要有自己的世界 —— 否則「已修」只是一句話:
#    觸發器刪掉【我那一列】,同時另塞一筆別的第七態 ⇒ 只數 status 的話 count 仍是 1 ⇒ 假綠。
#    ⇒ 這個世界只有在回頭讀【綁 dedup_key】時才會紅。
w "⑬ 掉包:刪掉我那列、另塞一筆別的第七態" "CREATE FUNCTION zzf() RETURNS trigger AS \$x\$ BEGIN IF NEW.dedup_key='_pcm_probe_fixed' THEN DELETE FROM public.email_outbox WHERE id=NEW.id; INSERT INTO public.email_outbox (order_id,event_type,dedup_key,recipient_email,subject,payload,status) VALUES (NEW.order_id,'order_shipped','_zz_other','x@example.invalid','x','{}'::jsonb,'skipped_shipment_voided'); END IF; RETURN NULL; END \$x\$ LANGUAGE plpgsql; CREATE TRIGGER zzt AFTER INSERT ON public.email_outbox FOR EACH ROW EXECUTE FUNCTION zzf();" PROBE-RED

# 🔴 定義閘自己的兩個負對照 —— 少了它們,上面十個世界【就算 migration 整支是空的】也可以全綠。
w "⑪ 舊 CHECK 與預期不同 ⇒ 前置閘該攔下" "ALTER TABLE public.email_outbox DROP CONSTRAINT email_outbox_status_check; ALTER TABLE public.email_outbox ADD CONSTRAINT email_outbox_status_check CHECK (status IN ('pending','sending','sent','failed','skipped_no_real_email'));" MIG-RED
# 🔴 codex R8 must-fix(誠實標註,不是修碼):世界⑫**分不出是哪一道閘攔的** ——
#    把前置閘②(forward-only)整個刪掉,前置閘③(舊 CHECK 逐字比對)照樣攔得下它,
#    因為七態的 CHECK 與六態的期望字面本來就對不上 ⇒ ⑫ 殺不掉「刪掉閘②」這個突變。
#    ⇒ 它仍有價值:**證明重跑不會靜默成功**(那是真的安全性質)。
#      但不要宣稱它在驗閘② —— 那兩道在這一層是【分不開的】。
w "⑫ 重跑(第七態已在)⇒ 該被攔下(②或③,分不出)" "ALTER TABLE public.email_outbox DROP CONSTRAINT email_outbox_status_check; ALTER TABLE public.email_outbox ADD CONSTRAINT email_outbox_status_check CHECK (status IN ('pending','sending','sent','failed','skipped_no_real_email','skipped_order_ineligible','skipped_shipment_voided'));" MIG-RED

echo
echo "── 結果: PASS=$PASS FAIL=$FAIL（世界數 13；PASS+FAIL 不等於 13 ⇒ 有格沒跑到）"
echo "🛑 射程: 見檔頭 —— 本機拋棄式庫、無 RLS/GRANT/索引;它證不出正式庫的行為。"
[ $((PASS+FAIL)) -eq 13 ] || { echo "🔴 只跑了 $((PASS+FAIL)) 格 ⇒ 少跑的那幾格沒有形狀 ⇒ 判紅"; exit 1; }
[ "$FAIL" -eq 0 ] || exit 1
exit 0
