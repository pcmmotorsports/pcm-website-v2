#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
# 🛑🛑 讀之前先看這段:**本腳本驗的那道閘【不在 HEAD 裡】。**
#
# 它驗的是 20260830060000 那支 migration 的【事後閘④ 第五版(行為·打真表)】,
# 而那一版 2026-08-30 收工時【沒有 commit】—— 理由:鐵則 12③(schema)要求
# commit 前過 codex 對抗審查,而第四輪審查還沒回來,不打折。
#
# ⇒ 所以在 HEAD 上直接跑這支,世界 ①-⑤ 會【全部不如預期】—— 那不是它壞了。
# ✅ 要重跑,先還原那一版:
#     git apply ~/pcm-mailbox/線A-e9-v5事後閘-未過審-diff-20260830.patch
#   （全檔副本:~/pcm-mailbox/線A-e9-v5事後閘-未過審-全檔-20260830.sql）
#   （來龍去脈:~/pcm-mailbox/交接-線A-e9-email_outbox第七態-20260830.md）
# 🔴 而還原之後【第一件事是跑 codex】,不是直接 commit。
# ══════════════════════════════════════════════════════════════════════════════
# ══════════════════════════════════════════════════════════════════════════════
# 20260830060000 事後閘④(行為·打真表) 的世界對照 —— 【可重跑的證據落點】
#
# 🛑 為什麼這支存在:codex R3 #10 逐字指出「五個世界實測」而沒有可重跑的產物 ——
#    那個宣稱在下一個人手上【等於零】。這支就是那個產物。
#
# 做法:拋棄式 PG 17.10 建一個【與正式庫同形】的 fixture,逐個世界跑整支 migration,
#      比對 GREEN/RED 與期望。fixture 自己也驗(建不起來 ⇒ 印「本輪作廢」,不印紅)。
# 🔴 射程:本機拋棄式庫;它證不出正式庫的行為。
# 用法: bash scripts/email-outbox-seventh-state-verify.sh
# ══════════════════════════════════════════════════════════════════════════════
set -u
export LC_ALL=C LANG=C   # 🔴 postmaster 啟動時也要看到（見 scripts/admin-probe/up.sh:43）
REPO="$(cd "$(dirname "$0")/.." && pwd)"
M="$REPO/supabase/migrations/20260830060000_m4b_e4_outbox_shipment_voided_status.sql"
D=$(mktemp -d "${TMPDIR:-/tmp}/eo7.XXXXXXXX"); PG=54372
KEEP=0
cleanup(){ pg_ctl -D "$D/pg" stop -m immediate >/dev/null 2>&1
  if [ "$KEEP" = 1 ]; then printf '🛑 非綠 ⇒ log 保留在 %s\n' "$D"; else rm -rf "$D"; fi; }
trap cleanup EXIT
for c in initdb pg_ctl psql; do command -v "$c" >/dev/null || { echo "🔴 缺 $c ⇒ ENV-FAIL"; KEEP=1; exit 2; }; done
initdb -D "$D/pg" -U postgres --auth=trust --encoding=UTF8 --locale=C >"$D/i.log" 2>&1 || { echo "🔴 initdb ⇒ ENV-FAIL"; KEEP=1; exit 2; }
pg_ctl -D "$D/pg" -o "-p $PG -k /tmp" -l "$D/pg.log" start >/dev/null 2>&1 || { echo "🔴 pg_ctl ⇒ ENV-FAIL"; KEEP=1; exit 2; }
q(){ psql -h /tmp -p "$PG" -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }
PASS=0; FAIL=0

base(){ q -q -f /dev/stdin <<'SQL'
DROP TABLE IF EXISTS public.email_outbox;
CREATE TABLE IF NOT EXISTS public.orders (id uuid primary key default gen_random_uuid());
-- 🔴 每個世界都要從乾淨的 orders 開始:2026-08-30 實測踩過 ——
--    orders 的列跨世界殘留 ⇒ 「空庫」那個世界拿到上一輪種下的 order ⇒ 印綠而不是 SKIPPED。
--    📌 而那與 fixture 建不起來是同一族:【世界之間的狀態外溢】。
DELETE FROM public.orders;
CREATE TABLE public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  event_type text NOT NULL, order_id uuid NOT NULL REFERENCES public.orders(id),
  dedup_key text NOT NULL, recipient_email text NOT NULL, subject text NOT NULL,
  payload jsonb NOT NULL, status text NOT NULL DEFAULT 'pending',
  attempts int NOT NULL DEFAULT 0, max_attempts int NOT NULL DEFAULT 5,
  last_error_code text, created_at timestamptz NOT NULL DEFAULT now(),
  next_retry_at timestamptz NOT NULL DEFAULT now(), claimed_at timestamptz,
  CONSTRAINT email_outbox_event_type_check CHECK (event_type IN ('order_created','order_shipped')),
  CONSTRAINT email_outbox_status_check CHECK (status IN ('pending','sending','sent','failed',
    'skipped_no_real_email','skipped_order_ineligible')),
  CONSTRAINT email_outbox_dedup_key_nonempty CHECK (dedup_key <> ''),
  CONSTRAINT email_outbox_recipient_nonempty CHECK (recipient_email <> ''),
  CONSTRAINT email_outbox_subject_nonempty CHECK (subject <> ''),
  CONSTRAINT email_outbox_payload_is_object CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT email_outbox_attempts_nonneg CHECK (attempts >= 0),
  CONSTRAINT email_outbox_max_attempts_positive CHECK (max_attempts >= 1),
  CONSTRAINT email_outbox_last_error_code_format CHECK (last_error_code IS NULL OR last_error_code <> ''),
  CONSTRAINT email_outbox_sending_has_claimed_at CHECK ((status='sending')=(claimed_at IS NOT NULL)));
CREATE UNIQUE INDEX email_outbox_event_uniq ON public.email_outbox (event_type, dedup_key);
COMMENT ON COLUMN public.email_outbox.status IS 'pending/sending/sent/failed/skipped_no_real_email/skipped_order_ineligible';
SQL
}
w(){ # $1=名 $2=額外 SQL $3=期望
  base > "$D/b.log" 2>&1 || { printf '  %-46s ⇒ 🔴 fixture 建不起來 ⇒ 本輪作廢\n' "$1"; KEEP=1; return; }
  grep -q ERROR "$D/b.log" && { printf '  %-46s ⇒ 🔴 fixture 有 ERROR ⇒ 本輪作廢\n' "$1"; KEEP=1; return; }
  [ "${4:-seed}" = "noseed" ] || q -q -c "INSERT INTO public.orders DEFAULT VALUES;" >/dev/null 2>&1
  if [ -n "$2" ]; then q -q -c "$2" > "$D/a.log" 2>&1; grep -q ERROR "$D/a.log" && { printf '  %-46s ⇒ 🔴 前置 SQL 失敗 ⇒ 本輪作廢\n' "$1"; KEEP=1; return; }; fi
  o=$(q -f "$M" 2>&1); rc=$?
  # 🔴 哨兵要用【完整前綴】不能用裸字 SKIPPED：2026-08-30 實測踩過 ——
  #    那支 migration 的【通過訊息】裡也有 SKIPPED 這個字（它在提醒讀的人），
  #    ⇒ 用裸字當哨兵 ⇒ 連 GREEN 的世界都被判成 SKIPPED。
  #    📌 同族：負對照/哨兵的字面不該與被掃描的內容共用。
  if printf '%s' "$o" | grep -q '事後閘④(行為) SKIPPED'; then g=SKIPPED
  elif [ $rc -eq 0 ]; then g=GREEN; else g=RED; fi
  if [ "$g" = "$3" ]; then PASS=$((PASS+1)); m=✅; else FAIL=$((FAIL+1)); m=🔴; KEEP=1; fi
  printf '  %-46s ⇒ %-7s (期望 %-7s) %s\n' "$1" "$g" "$3" "$m"
}

echo "══ 事後閘④(行為·打真表) · 六個世界"
w "① 正式庫現況（那次假紅的現場）" "" GREEN
w "② 殘留【不同名字】的六態 CHECK" "ALTER TABLE public.email_outbox ADD CONSTRAINT zz6 CHECK (status IN ('pending','sending'));" RED
w "③ codex#4 禁 _voided 結尾（字串尺全瞎）" "ALTER TABLE public.email_outbox ADD CONSTRAINT zzv CHECK (status !~ '_voided\$');" RED
w "④ codex#2 【同名】重建成排斥第七態（集合尺全瞎）" "ALTER TABLE public.email_outbox DROP CONSTRAINT email_outbox_subject_nonempty; ALTER TABLE public.email_outbox ADD CONSTRAINT email_outbox_subject_nonempty CHECK (subject <> '' AND status <> 'skipped_shipment_voided');" RED
w "⑤ codex#6 BEFORE INSERT 觸發器擋（v3/v4 全瞎）" "CREATE FUNCTION zzf() RETURNS trigger AS \$x\$ BEGIN IF NEW.status='skipped_shipment_voided' THEN RAISE EXCEPTION 'blocked by trigger'; END IF; RETURN NEW; END \$x\$ LANGUAGE plpgsql; CREATE TRIGGER zzt BEFORE INSERT ON public.email_outbox FOR EACH ROW EXECUTE FUNCTION zzf();" RED
w "🔵 ⑥ 空庫（沒有 order 可借）⇒ 必須 SKIPPED，不是綠" "" SKIPPED noseed

echo
echo "── 結果: PASS=$PASS FAIL=$FAIL"
echo "🛑 射程: 本機拋棄式庫;它證不出正式庫的行為。"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
