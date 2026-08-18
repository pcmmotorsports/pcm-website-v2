# scripts/lib/pg-connect-env.sh — 把一個 postgres 連線字串拆成 PG* 環境變數。
#
# 🔴 為什麼要有這支:`psql "$CONN"` 會把【含密碼的連線字串放進 psql 的 argv】,
#    而 argv 在 process table 裡(同一台機器上的其他程序 `ps` 看得到)。
#    走 env 只是讓它不進 shell history,**沒有解決 argv 這一半**。
#    (2026-08-18 codex 對 triage 腳本指出;G4 補這支共用件,三支腳本共用一份修法。)
#
# 用法(呼叫端已經把連線字串放進 shell 變數,例如 $CONN):
#   . "$(dirname "$0")/lib/pg-connect-env.sh"
#   pg_connect_env "$CONN" || exit 1     # 之後 psql 不帶連線字串直接跑
#
# ⚠️ 效度限度:環境變數在 /proc/<pid>/environ(Linux)或 `ps -E`(需權限)仍讀得到,
#    但那需要同使用者或 root;argv 是**所有人**都看得到。這是降風險、不是零風險。
# ⚠️ 實測(2026-08-18,PostgreSQL 17.10):把 URI 直接塞進 `PGDATABASE` **不會**被 libpq 展開
#    —— 它會去連預設 socket。所以必須像下面這樣逐欄拆開。
pg_connect_env() {
  local url="${1:-}"
  if [ -z "$url" ]; then
    echo "🔴 工具問題:pg_connect_env 沒收到連線字串" >&2
    return 1
  fi
  command -v python3 > /dev/null 2>&1 || {
    echo "🔴 工具問題:找不到 python3(拆連線字串要用),這不是查詢結果" >&2
    return 1
  }
  local exports
  exports=$(PG_CONNECT_URL="$url" python3 - <<'PY'
import os, shlex, sys, urllib.parse as u
p = u.urlparse(os.environ['PG_CONNECT_URL'])
if p.scheme not in ('postgres', 'postgresql'):
    sys.stderr.write("🔴 工具問題:連線字串不是 postgres:// 或 postgresql:// 開頭\n")
    sys.exit(1)
q = dict(u.parse_qsl(p.query))
env = {
    'PGHOST': p.hostname or '',
    'PGPORT': str(p.port or 5432),
    'PGUSER': u.unquote(p.username or ''),
    'PGPASSWORD': u.unquote(p.password or ''),
    'PGDATABASE': (p.path or '/postgres').lstrip('/') or 'postgres',
    'PGSSLMODE': q.get('sslmode', 'require'),
}
for k, v in env.items():
    print('export %s=%s' % (k, shlex.quote(v)))
PY
  ) || return 1
  eval "$exports"
}
