#!/usr/bin/env bash
# ⟦f3-HALFWRITE1⟧ 拋棄式鑽機 —— 一次同步跑到一半失敗時, DB 裡【留下什麼】。
#
# 🔴 為什麼要這一發:板列自己標著 ⑤「**沒有實跑過任何一次同步**」,
#    而 `scripts/rpm-partial-report.ts` 檔頭逐字寫「缺的檢查 = 起拋棄式 PG 實跑一次」。
#    ⇒ 📌 **碼自己指名了缺的那一道, 這支就是那一道。**
#
# 🛑 零正式庫:整段只碰 `mktemp -d` 裡那個叢集。板列逐字「不論誰批准都不是施工窗做的事」。
# 🟢 三個世界(主視窗 A 2026-09-09 加的驗收:成功那一發也要跑):
#      成功 ⇒ 1200 · 中途失敗(第 700 列)⇒ 500 · ⚪ 負對照(第 100 列)⇒ 0
#    少了負對照, 那個 500 可以是任何原因;有了它, 500 才等於【分批的邊界】。
#
# 🛑 它答不出什麼:本機庫證的是【碼的行為】, 不是【正式資料下的筆數】。
#    表是照 `upsertBatched` 需要的形狀現造的, 不是真的 `product_variants`。
set -uo pipefail
export LC_ALL=C LANG=C
REPO="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${HW_PORT:-55731}"; RPORT="${HW_RPORT:-55732}"
D="$(mktemp -d "${TMPDIR:-/tmp}/hwprobe.XXXXXX")"
BIN="$(dirname "$(command -v pg_ctl)")"

cleanup() {
  [ -n "${PRESTPID:-}" ] && kill "$PRESTPID" 2>/dev/null
  "$BIN/pg_ctl" -D "$D/pg" -m immediate stop >/dev/null 2>&1
  rm -rf "$D"
}
trap cleanup EXIT

echo "── 起叢集(port $PORT;整段在 $D, 收攤時整個刪掉)──"
"$BIN/initdb" -D "$D/pg" -U postgres --no-sync >/dev/null 2>&1 || { echo "🔴 initdb 失敗"; exit 2; }
"$BIN/pg_ctl" -D "$D/pg" -o "-p $PORT -k $D -c listen_addresses=127.0.0.1" -l "$D/pg.log" -w start >/dev/null 2>&1 \
  || { echo "🔴 起不來, log:"; tail -5 "$D/pg.log"; exit 2; }

PSQL="$BIN/psql -h 127.0.0.1 -p $PORT -U postgres -d postgres -v ON_ERROR_STOP=1"
$PSQL -q <<'SQL' || { echo "🔴 建表/建角色失敗"; exit 2; }
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticator LOGIN NOINHERIT;
GRANT anon TO authenticator;
CREATE TABLE public.pcm_hw_probe (
  sku text PRIMARY KEY,
  n   integer NOT NULL CONSTRAINT pcm_hw_probe_n_nonneg CHECK (n >= 0)
);
GRANT USAGE ON SCHEMA public TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pcm_hw_probe TO anon;
SQL

echo "── 起 PostgREST(port $RPORT)──"
# 🔴 supabase-js 一定會送 `Authorization: Bearer <key>` ⇒ PostgREST 沒有 jwt-secret 會回
#    「Server lacks JWT secret」, 而那與「表不存在」在呼叫端都只是一個 error 字串。
JWTSEC="zzq-halfwrite1-probe-secret-at-least-32-bytes-long"
cat > "$D/prest.conf" <<CONF
db-uri = "postgres://authenticator@127.0.0.1:$PORT/postgres"
db-schemas = "public"
db-anon-role = "anon"
server-port = $RPORT
jwt-secret = "$JWTSEC"
CONF
postgrest "$D/prest.conf" > "$D/prest.log" 2>&1 &
PRESTPID=$!
for _ in $(seq 1 40); do
  curl -sf "http://127.0.0.1:$RPORT/pcm_hw_probe?limit=1" >/dev/null 2>&1 && break
  sleep 0.25
done
if ! curl -sf "http://127.0.0.1:$RPORT/pcm_hw_probe?limit=1" >/dev/null 2>&1; then
  echo "🔴 PostgREST 起不來, log:"; tail -8 "$D/prest.log"; exit 2
fi
echo "   ✅ PostgREST 活著(curl 拿得到那張表)"

echo
echo "── 三個世界(跑的是【真的那支】 scripts/rpm-load.ts 的 upsertBatched)──"
cd "$REPO" || exit 2
# 自己簽一顆 role=anon 的 HS256 token(node 內建 crypto, 不加任何套件)
TOKEN="$(node -e '
const c=require("node:crypto");
const b=o=>Buffer.from(JSON.stringify(o)).toString("base64url");
const h=b({alg:"HS256",typ:"JWT"}), p=b({role:"anon"});
const sig=c.createHmac("sha256",process.argv[1]).update(h+"."+p).digest("base64url");
process.stdout.write(h+"."+p+"."+sig);
' "$JWTSEC")"
[ -n "$TOKEN" ] || { echo "🔴 簽不出 token ⇒ 沒有跑"; exit 2; }
PGRST_URL="http://127.0.0.1:$RPORT" PGRST_KEY="$TOKEN" \
  node_modules/.bin/tsx "$REPO/scripts/halfwrite1-partial-write-probe.ts"
RC=$?
echo
echo "rc=$RC"
exit "$RC"
