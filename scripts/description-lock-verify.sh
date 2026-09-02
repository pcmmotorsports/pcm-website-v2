#!/usr/bin/env bash
# description-lock-verify.sh · ⟦b4-QUOTEDESCLOCK⟧ 段 B+C
#   在【拋棄式 PG】上驗:被鎖的商品描述, 每日同步覆蓋不掉。
#
# ══════════════════════════════════════════════════════════════════════════════
# 🛑🛑 **在你拿這支的全綠去背書任何事之前 —— 先讀這三格。**
#  ① 🔴 **本檔【不驗】每日同步那條路真的會走到這個 trigger。**
#     它驗的是「一發 upsert 打進來時 trigger 擋不擋得住」,
#     **不驗**「`rpm-load` 真的會發出那樣一發 upsert」⇒ 那要跑那支腳本, 不在本檔分母裡。
#  ② 🔴 **那個逃生口是【誰記得設】不是【誰有權限】** ——
#     任何拿得到寫入權的人都設得起 `SET LOCAL pcm.allow_locked_description_write = 'on'`。
#     ⇒ 本檔證的是「忘記設的人會被擋」, **不是「壞人擋得住」**。**不要把它讀成安全機制。**
#  ③ 🔴 fixture 的 `products` / `staff` 是**最小手寫版**(只建 trigger 碰得到的欄)
#     ⇒ 「別的 NOT NULL 欄擋住寫入」那一族在這裡**結構上不可能出現**。
# ══════════════════════════════════════════════════════════════════════════════
#
# 用法:bash scripts/description-lock-verify.sh
# 出口:0=全綠 / 1=有世界不如預期 / 2=ENV-FAIL / 9=建不出暫存目錄
set -uo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
MIG="$REPO/supabase/migrations/20260902190000_m4b_quotedesclock_bc.sql"
MIG_PRODUCTS="$REPO/supabase/migrations/20260507004826_init_products.sql"

D=$(mktemp -d "${TMPDIR:-/tmp}/dlk.XXXXXXXX") || { echo "🔴 建不出暫存目錄 ⇒ exit 9"; exit 9; }
KEEP=0
cleanup(){ pg_ctl -D "$D/pg" stop -m immediate >/dev/null 2>&1
  if [ "$KEEP" = 1 ]; then printf '🛑 非綠 ⇒ log 保留在 %s\n' "$D"; else rm -rf "$D"; fi; }
trap cleanup EXIT
for f in "$MIG" "$MIG_PRODUCTS"; do [ -f "$f" ] || { echo "🔴 找不到 $f ⇒ ENV-FAIL"; KEEP=1; exit 2; }; done
for c in initdb pg_ctl psql; do command -v "$c" >/dev/null || { echo "🔴 缺 $c ⇒ ENV-FAIL"; KEEP=1; exit 2; }; done

# 🔴 port 不寫死 —— 七窗共用一台機器, 別窗的拋棄式 PG 會佔住同一個號碼。
PG=""
for p in $(seq 54400 54424); do
  if ! (command -v lsof >/dev/null && lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1); then PG="$p"; break; fi
done
[ -n "$PG" ] || { echo "🔴 54400-54424 沒有空的 port —— 這是環境, 不是這支腳本"; KEEP=1; exit 2; }
printf '🔵 本發用 port %s\n' "$PG"

export LC_ALL=C LANG=C
initdb -D "$D/pg" -U postgres --auth=trust --encoding=UTF8 --locale=C >"$D/i.log" 2>&1 \
  || { echo "🔴 initdb ⇒ ENV-FAIL"; KEEP=1; exit 2; }
pg_ctl -D "$D/pg" -o "-p $PG -k $D" -l "$D/pg.log" -w start >/dev/null 2>&1 || {
  echo "🔴 pg_ctl 起不來。下面那幾行是 PG 自己講的, 先讀它:"
  grep -E 'Address already in use|FATAL|could not' "$D/pg.log" 2>/dev/null | tail -3
  echo "   有 Address already in use ⇒ 環境(別窗佔住 port), 重跑就好, 不要查這支腳本"
  KEEP=1; exit 2; }
q(){ psql -h "$D" -p "$PG" -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }
PASS=0; FAIL=0

# fixture:最小手寫版(見檔頭第③格)。**只建 trigger 碰得到的欄 + FK 靶子。**
q -q -c "
DO \$r\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon')          THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role')  THEN CREATE ROLE service_role; END IF;
END \$r\$;
CREATE TABLE public.staff (id text PRIMARY KEY);
CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id text UNIQUE NOT NULL,
  title text NOT NULL,
  description text);
INSERT INTO public.staff VALUES ('staff_a');
" > "$D/base.log" 2>&1 || { echo "🔴 fixture 建不起來"; tail -3 "$D/base.log"; KEEP=1; exit 1; }

q -q -f "$MIG" > "$D/mig.log" 2>&1 || { echo "🔴 migration 跑不起來"; tail -6 "$D/mig.log"; KEEP=1; exit 1; }
grep -q ERROR "$D/mig.log" && { echo "🔴 migration 有 ERROR"; grep ERROR "$D/mig.log" | head -3; KEEP=1; exit 1; }
echo "✅ migration 八道事後閘全過(欄形狀 / trigger tgtype=19+tgfoid / search_path / COMMENT 三句 / 另兩欄 / CHECK 定義 / FK / 索引述詞)"

seed(){
  q -q -c "TRUNCATE public.products;
    INSERT INTO public.products (external_id,title,description,description_locked,description_locked_at,description_locked_by)
    VALUES ('LOCKED','t','員工手改的描述', true, now(), 'staff_a'),
           ('OPEN'  ,'t','來源給的描述',   false, NULL, NULL);" > "$D/seed.log" 2>&1
  local rc=$?
  if [ $rc -ne 0 ] || grep -q ERROR "$D/seed.log"; then
    printf '  🔴 種不進 fixture(rc=%s)⇒ 本輪作廢\n' "$rc"; head -3 "$D/seed.log"; KEEP=1; FAIL=$((FAIL+1)); return 1
  fi
}
d(){ q -tAc "SELECT description FROM public.products WHERE external_id='$1';" 2>&1 | tr -d ' '; }
chk(){ # $1=名 $2=期望 $3=實得
  if [ "$3" = "$2" ]; then printf '  %-46s ⇒ ✅ %s\n' "$1" "$3"; PASS=$((PASS+1))
  else printf '  %-46s ⇒ 🔴 要「%s」而實得「%s」\n' "$1" "$2" "$3"; KEEP=1; FAIL=$((FAIL+1)); fi
}

# ⚠️ codex nit(照留):正式那條路的衝突鍵是 `(supplier_slug, external_id)`,
#    而本 fixture 用的是 `UNIQUE(external_id)` ⇒ **不是實際的衝突鍵**。
#    ⇒ 它仍驗得了「upsert 的 UPDATE 那一支會不會觸發 trigger」這個語義,
#      但**不驗**「真實的衝突鍵組合下會不會走到同一條路」⇒ 那一格本檔沒有。
echo "── ① upsert(驗的是語義, 而衝突鍵不是真實的那組)────────────"
seed && {
  q -q -c "INSERT INTO public.products (external_id,title,description)
           VALUES ('LOCKED','t','同步覆蓋'),('OPEN','t','同步覆蓋')
           ON CONFLICT (external_id) DO UPDATE SET description = EXCLUDED.description;" > /dev/null 2>&1
  chk "①a 被鎖的 ⇒ 保住原值"   "員工手改的描述" "$(d LOCKED)"
  chk "①b 🔵 沒鎖的 ⇒ 照樣被覆蓋(負對照)" "同步覆蓋" "$(d OPEN)"
}

echo "── ② 普通 UPDATE(段 A 之前的任何腳本)──────────────────────"
seed && {
  q -q -c "UPDATE public.products SET description='腳本覆蓋';" > /dev/null 2>&1
  chk "②a 被鎖的 ⇒ 保住原值"   "員工手改的描述" "$(d LOCKED)"
  chk "②b 🔵 沒鎖的 ⇒ 照樣被覆蓋" "腳本覆蓋" "$(d OPEN)"
}

echo "── ③ 逃生口(段 A 走這條)──────────────────────────────────"
seed && {
  q -q -c "BEGIN; SET LOCAL pcm.allow_locked_description_write='on';
           UPDATE public.products SET description='後台改的新描述' WHERE external_id='LOCKED'; COMMIT;" > /dev/null 2>&1
  chk "③a 開了逃生口 ⇒ 寫得進去" "後台改的新描述" "$(d LOCKED)"
  q -q -c "UPDATE public.products SET description='下一發同步' WHERE external_id='LOCKED';" > /dev/null 2>&1
  chk "③b 🔴 交易結束後又擋住(SET LOCAL 的重點)" "後台改的新描述" "$(d LOCKED)"
}

echo "── 🔴 ④ 同一發 UPDATE 想【先解鎖再改】⇒ 仍然擋住 ────────────"
# 🔴 trigger 讀的是 OLD 不是 NEW ⇒ 同一發把 description_locked 設成 false 也繞不過去。
#    少了這一格, 一個「順手改成讀 NEW」的重構會讓整片失效而所有其他格照樣綠。
# 🔴🔴 而【收 rc 這一步當場抓到一件事, 值得留】:
#    收上去的第一發它就紅了 —— 因為新收緊的那條 CHECK 擋住了
#    「`locked=false` 而 `at`/`by` 還留著」這個狀態。
#    ⇒ 🎯 **那表示這個「同發解鎖」的繞法有【兩道】獨立的擋:CHECK 一道、trigger 一道。**
#    ⇒ 而要真的測到 trigger 那一道, 這一發必須**連 at/by 一起清掉** —— 否則它停在 CHECK 就結束了。
#    📌 **⇒ 而在收 rc 之前, 它會印綠 —— 因為「UPDATE 整句失敗」與「trigger 擋住了」對舊值的影響一模一樣。**
# 🔴 codex must-fix:這一發**沒收 rc** ——
#    若那句 UPDATE 因為任何理由失敗(trigger 拋例外、CHECK 擋、欄名打錯),
#    舊描述**自然不變** ⇒ chk 會把【作廢】印成【通過】。
#    ⇒ 而它是這支 harness 裡最容易假綠的一格:期望值恰好等於「什麼都沒發生」。
seed && {
  if q -q -c "UPDATE public.products SET description='繞過看看', description_locked=false, description_locked_at=NULL, description_locked_by=NULL WHERE external_id='LOCKED';" > "$D/w4.log" 2>&1; then
    chk "④ 同發解鎖 + 改描述 ⇒ 描述仍保住" "員工手改的描述" "$(d LOCKED)"
  else
    printf '  %-46s ⇒ 🔴 那句 UPDATE 自己失敗了 ⇒ 本格作廢(不是通過)\n' "④ 同發解鎖 + 改描述"
    head -2 "$D/w4.log"; KEEP=1; FAIL=$((FAIL+1))
  fi
}

echo "── 🧬 ⑤ 突變:把 trigger 的 OLD 換成 NEW ⇒ ④ 必須翻 ──────────"
q -q -c "
CREATE OR REPLACE FUNCTION public.products_description_lock_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS \$fn\$
BEGIN
  IF NEW.description_locked
     AND coalesce(pg_catalog.current_setting('pcm.allow_locked_description_write', true),'off') <> 'on'
  THEN NEW.description := OLD.description; END IF;
  RETURN NEW;
END \$fn\$;" > "$D/mut.log" 2>&1
if grep -q ERROR "$D/mut.log"; then
  echo "  🔴 突變版建不起來 ⇒ 本輪作廢"; head -3 "$D/mut.log"; KEEP=1; FAIL=$((FAIL+1))
else
  seed && {
    q -q -c "UPDATE public.products SET description='繞過看看', description_locked=false, description_locked_at=NULL, description_locked_by=NULL WHERE external_id='LOCKED';" > /dev/null 2>&1
    got=$(d LOCKED)
    if [ "$got" = "繞過看看" ]; then
      printf '  %-46s ⇒ ✅ 由「保住」翻成「被繞過」⇒ 那個 OLD 承重\n' "⑤ OLD→NEW"; PASS=$((PASS+1))
    else
      printf '  %-46s ⇒ 🔴 仍然是「%s」⇒ **我的 harness 到不了那個世界**(不是「洞不存在」)\n' "⑤ OLD→NEW" "$got"
      KEEP=1; FAIL=$((FAIL+1))
    fi
  }
fi

echo "────────────────────────────────────────────────────────────"
# 🔴 釘死格數:整塊被短路時它才會叫(改動格數時這一行要一起改, 而那就是它的用途)
EXPECT_TOTAL=8
TOTAL=$(( PASS + FAIL ))
if [ "$TOTAL" -ne "$EXPECT_TOTAL" ]; then
  printf '🔴 格數不對:跑了 %s 格, 應有 %s 格 ⇒ 有一塊沒跑到(而它不會自己紅)\n' "$TOTAL" "$EXPECT_TOTAL"
  KEEP=1; FAIL=$((FAIL+1)); TOTAL=$(( PASS + FAIL ))
fi
printf '結果:PASS=%s FAIL=%s(共 %s 格, 應有 %s)\n' "$PASS" "$FAIL" "$TOTAL" "$EXPECT_TOTAL"
printf '🛑 本檔【不驗】每日同步那條路真的會走到這個 trigger —— 那要跑 rpm-load。\n'
printf '🛑 逃生口是【誰記得設】不是【誰有權限】⇒ 這道 trigger 防的是忘記, 不是防惡意。\n'
[ "$FAIL" = 0 ] || exit 1
