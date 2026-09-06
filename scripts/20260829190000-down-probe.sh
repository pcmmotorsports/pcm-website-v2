#!/usr/bin/env bash
# 20260829190000-down-probe.sh —— 那支 down 腳本的四個世界, 可重跑的證物
#
# 🛑 **它為什麼在 repo 裡**:codex(gpt-6-astra)2026-09-06 提了一條 must-fix,
#   而我沒有照單全收 —— 我量了一發。**它是對的, 而且比它描述的更毒**:
#   舊版在 `ON_ERROR_ROLLBACK=on` 之下 **psql rc=0** 而那張表的 CHECK **不見了**
#   ⇒ 📌 「跑成功了」與「它拆掉了那張表的保護」在 rc 上是同一個值。
#   ⇒ 這支留著, 是為了讓下一個改那支 down 的人**可以再量一次**, 而不是讀我的結論。
#
# 四個世界(全部在拋棄式 PG, 零正式庫動作):
#   A 危險的 psql 設定 + 有一列 'ops'  ⇒ 約束必須【還在】(舊版這裡是 0)
#   B ON_ERROR_STOP=on + 有一列 'ops'  ⇒ 整筆回滾, 約束還在
#   C 沒有 'ops'                        ⇒ 真的退成兩值, 且 COMMENT 換回舊那份
#   D 對 C 的結果再跑一次              ⇒ 印【略過】, 不再鎖表
#   🔴 負對照:問一個現造的約束名 ⇒ 必須 0(證明這把尺會動)
# 量 codex MF1 的那個宣稱, 而不是照單全收:
#   psql 在 ON_ERROR_ROLLBACK=on + ON_ERROR_STOP=off 之下,
#   DO 的 RAISE EXCEPTION 只退到隱含 savepoint ⇒ DROP 生效 / ADD 失敗 / COMMIT 留下一張零 CHECK 的表。
#
# 🟢 正對照:同一支檔在 ON_ERROR_STOP=on 之下 ⇒ 約束必須還在(整筆回滾)。
# 🔴 負對照:一個【現造的】不存在約束名 ⇒ 必須查無, 證明這把尺會動。
set -u
export LC_ALL=C LANG=C
D=$(mktemp -d "${TMPDIR:-/tmp}/mf1probe.XXXXXX") || exit 9
PG=$(( 56000 + ($$ % 800) ))
while lsof -nP -iTCP:"$PG" -sTCP:LISTEN >/dev/null 2>&1; do PG=$((PG+1)); done
cleanup(){ pg_ctl -D "$D/pg" stop -m immediate >/dev/null 2>&1; rm -rf "$D"; }
trap cleanup EXIT
initdb -D "$D/pg" -U postgres --auth=trust --encoding=UTF8 --locale=C >"$D/i.log" 2>&1 || { echo "ENV-FAIL initdb"; exit 2; }
pg_ctl -D "$D/pg" -o "-p $PG -k /tmp" -l "$D/pg.log" start >/dev/null 2>&1 || { echo "ENV-FAIL start"; exit 2; }

seed() {  # $1 = db 名
  psql -h /tmp -p "$PG" -U postgres -d postgres -q -v ON_ERROR_STOP=1 \
    -c "DROP DATABASE IF EXISTS $1" -c "CREATE DATABASE $1" >/dev/null 2>&1 || return 1
  psql -h /tmp -p "$PG" -U postgres -d "$1" -q -v ON_ERROR_STOP=1 <<'SQL' >/dev/null 2>&1
CREATE TABLE public.admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor text NOT NULL, action text NOT NULL, request_id text NOT NULL,
  source_app text NOT NULL DEFAULT 'admin',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.admin_audit_log
  ADD CONSTRAINT admin_audit_log_source_app_check CHECK (source_app IN ('admin','quote','ops'));
COMMENT ON COLUMN public.admin_audit_log.source_app IS '三值版的舊註解';
INSERT INTO public.admin_audit_log (actor, action, request_id, source_app)
VALUES ('probe','seed', gen_random_uuid()::text, 'ops');
SQL
}

has_check() {  # 印 1 = 約束還在 / 0 = 不在
  psql -h /tmp -p "$PG" -U postgres -d "$1" -tAc \
    "SELECT count(*) FROM pg_constraint WHERE conname='admin_audit_log_source_app_check'"
}

DOWN=/Users/sean_1/pcm-wt-db/scripts/20260829190000-down.sql

echo "══ 世界 A:ON_ERROR_ROLLBACK=on + ON_ERROR_STOP 沒開(codex 說會留下零 CHECK 的表)"
seed wa || { echo "seed 失敗"; exit 2; }
psql -h /tmp -p "$PG" -U postgres -d wa -v ON_ERROR_ROLLBACK=on -f "$DOWN" > "$D/a.log" 2>&1
echo "   psql rc=$?"
echo "   約束還在嗎(1=在 / 0=不在) ⇒ $(has_check wa)"

echo "══ 世界 B(正對照):ON_ERROR_STOP=on ⇒ 整筆回滾, 約束必須【還在】"
seed wb || { echo "seed 失敗"; exit 2; }
psql -h /tmp -p "$PG" -U postgres -d wb -v ON_ERROR_STOP=1 -f "$DOWN" > "$D/b.log" 2>&1
echo "   psql rc=$?"
echo "   約束還在嗎(1=在 / 0=不在) ⇒ $(has_check wb)"

echo "══ 負對照:問一個現造的約束名, 必須 0(證明這把尺會動)"
psql -h /tmp -p "$PG" -U postgres -d wb -tAc \
  "SELECT count(*) FROM pg_constraint WHERE conname='zzq_never_existed_check'" | sed 's/^/   /'

echo "══ 世界 A 的 psql 輸出(前 6 行, 看它有沒有繼續往下跑)"
grep -v '^$' "$D/a.log" | head -6 | sed 's/^/   /'

echo "══ 世界 C(它到底做不做得成):沒有 ops 那一列 ⇒ 必須真的退成兩值 + 註解換回舊的"
seed wc >/dev/null 2>&1
psql -h /tmp -p "$PG" -U postgres -d wc -q -c "DELETE FROM public.admin_audit_log WHERE source_app='ops'" >/dev/null 2>&1
psql -h /tmp -p "$PG" -U postgres -d wc -v ON_ERROR_STOP=1 -f "$DOWN" > "$D/c.log" 2>&1
echo "   psql rc=$?"
psql -h /tmp -p "$PG" -U postgres -d wc -tAc \
  "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='admin_audit_log_source_app_check'" | sed 's/^/   CHECK ⇒ /'
psql -h /tmp -p "$PG" -U postgres -d wc -tAc \
  "SELECT left(col_description('public.admin_audit_log'::regclass,(SELECT attnum FROM pg_attribute WHERE attrelid='public.admin_audit_log'::regclass AND attname='source_app')),18)" | sed 's/^/   COMMENT 前 18 字 ⇒ /'
echo "══ 世界 D(跑第二次):必須印【略過】而不是再鎖一次表"
psql -h /tmp -p "$PG" -U postgres -d wc -v ON_ERROR_STOP=1 -f "$DOWN" 2>&1 | grep -iE 'NOTICE|ERROR' | head -2 | sed 's/^/   /'
