#!/usr/bin/env bash
# ci-self-contained: yes
# double-charge-anomaly-state-probe.sh
#
# 證人:雙扣異常的那台**狀態機**在真的 PostgreSQL 上跑起來是對的 ——
#      `claim_double_charge_anomaly_for_refund()` 與 `resolve_double_charge_anomaly()`
#      (兩支同住 `20260624120004_m3_3ds_r1b1b_anomaly_claim_resolve_rpc.sql`)。
#
# 🔴 **檔名叫 `state` 是刻意的**:本檔驗的是【狀態轉移對不對】——
#    `open → refunding → refunded / open`, 四個 resolution, 多道禁跳。
#    ⇒ CI 紅的時候人先看到的是檔名。
#
# ══ 為什麼需要它 ═════════════════════════════════════════════════════════════
# 2026-09-01 量到:全 repo 測試檔提到這兩支 ⇒ **各 0 支**
#   🟢 正對照 同法找 `create_order` ⇒ 15 支 · 🔵 負對照 現造名 `zzq_no_such_fn_0901` ⇒ 0
# 而它們決定「一筆被重複扣款的錢要不要退、退了沒、誰認領的」。
#
# ══ 🔴 這台狀態機的真守門【不在函式裡】════════════════════════════════════════
#   `payment_double_charge_anomalies` 那條 `status_consistency_check` 才是它:
#     open      ⇒ 六個欄都必須 NULL
#     refunding ⇒ claimed_at/by 必須有, resolved_at/by 必須沒有
#     refunded  ⇒ 上面全有 + `refund_provider_reference` 非空白
#     dismissed ⇒ resolved_* 與 note 有, 而 provider_reference 必須 NULL
#   ⇒ 📌 **所以替身【必須照抄那條 CHECK】** —— 少了它, 好幾格會假綠:
#      函式忘了寫某個欄, 而測試只看回傳值 ⇒ 看不出來。
#
# ══ 突變打在哪 ═══════════════════════════════════════════════════════════════
#   被測段 = **那兩支函式本體**。突變只重建函式, base(建表 + CHECK + 種子)不重跑。
#   函式從 migration 切出來、不抄 —— 抄一份會漂, 而漂了之後這支 probe 仍然全綠。
#
# ══ 天花板 / 範圍 ════════════════════════════════════════════════════════════
#   只驗這兩支函式的狀態轉移與它們與那條 CHECK 的互動。
#
# 🔴 **替身缺了什麼(產出的一部分, 不是免責)**:
#   · `payment_charge_attempts` / `orders` / `customers` 是**最小形狀**
#     ⇒ 真表的其餘 CHECK 與 FK 不在 ⇒ 一個違反那些的情境本 probe 量不到。
#   · `payment_double_charge_anomalies` **照真表建**(18 欄 + 兩條 CHECK 逐字)。
#   · 🔴 **併發沒量**:`claim` 那支靠 `WHERE status='open'` 的 CAS 擋「兩個人同時認領」,
#     而本檔是**單連線** ⇒ **那個 CAS 在真正並行下的行為沒有被驗過。**
#     ⇒ 那需要兩條連線同時打, 是另一支 probe。**不假裝這裡涵蓋了。**
#   · `resolved_by` / `refund_claimed_by` 的來源(`session_user`)在本檔恆是 `postgres`
#     ⇒ **真實的 actor 歸屬沒有被驗。**
#   這份清單是我想得到的那些, 而我最可能漏掉的是「一個我沒想到要餵的轉移」。
#
# 🔴🔴 **上面那份「缺了什麼」由【撞到它的人】增補, 不是由我維護。**
#   ⇒ 所以它**不是完整清單**, 是第一版的猜測 + 後來每個打中它的人補的那幾行。
#   ⚠️ **最貴的誤讀:以為沒列到的方向【已經被想過而排除了】。**
#   📌 一個人標得出自己盲區的【方向】, 標不出自己盲區的【分母】。
#   ⇒ 打中它的人請直接在上面加一行、署自己的名 —— **守住與記住是兩件事**:
#     修好一格是守住【這一種】, 寫進上面那份清單才防得了【同族的下一種】。
#
# 🔴 **而本檔的併發缺口【板上沒有落點】—— 這是量的, 2026-09-01:**
#   `docs/launch-todo.md` 只有券那一族開了列(🟢 正對照該列標題 ⇒ 1);
#   本檔這一種 ⇒ **0**(🔵 負對照現造字面 ⇒ 0 ⇒ 那把尺是活的)。
#   🛑 **⇒ 所以上面那句「不假裝這裡涵蓋了」目前【只住在這支檔裡】** ——
#     而沒有人會為了找缺口來讀一支 probe 的檔頭。
#   ⇒ 📌 **寫下來與有落點是兩件事**;這一格是後者缺席, 不是前者。
#
# 用法:bash docs/probes/double-charge-anomaly-state-probe.sh
set -uo pipefail

# 🔴 兩個都要:`LC_ALL=C` 讓 postmaster 起得來(macOS multithreaded),
#    而 `--encoding=UTF8` 讓 Unicode 跳脫不炸。runbook :174-175 逐字「兩個都要」。
export LC_ALL=C
export LANG=C

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
MIG="$REPO/supabase/migrations/20260624120004_m3_3ds_r1b1b_anomaly_claim_resolve_rpc.sql"
[ -f "$MIG" ] || { echo "找不到 migration: $MIG"; exit 2; }

# ── 🔴 port 撞車:先說得出【誰占著】, 再換一個 ──────────────────────────────
#
# 🔴🔴 **兩件事的順序是【印出兇手】優先, 不是【換 port】優先** —— 那是反直覺的一格:
#   換 port 只讓「今天這一發」不紅;而下一個撞到【別的】port 的人, 拿到的還是
#   一句查不出來的訊息。⇒ ② 的產出對【所有未來的 port 撞車】都有效, ① 只對這一支。
#   (實錘:2026-09-04 `gh run 33852334049` 逐字 `HINT: Is another postmaster already
#    running on port 55442?` ⇒ 它說了「有人占著」而【沒說是誰】⇒ 線 -db 查不出來。)
#
# ⚠️ **為什麼要三把尺而不是一把**:`lsof` 對【不屬於自己的】socket 印 0 ——
#   「真的空了」與「我沒權限看」印同一個東西。⇒ `ss` / `netstat` 交叉。
#   🔵 而這三把**壞的方式不同**:lsof 是權限、ss 是 Linux 專有、netstat 是 macOS 格式
#   ⇒ 它們不共用前提(對照:同一天三把剝色碼的尺共用「那裡是真 ESC」⇒ 一致而全錯)。
port_holder () {
  local p="$1"
  local _h; _h="$(mktemp)"
  {
    lsof -nP -iTCP:"$p" -sTCP:LISTEN 2>/dev/null | tail -n +2
    ss -ltnp 2>/dev/null | grep -F ":$p "
    netstat -anv 2>/dev/null | grep -F ".$p " | grep -i listen
  } > "$_h" 2>/dev/null
  # 🔴 三把都空 ⇒ 明說「查不出來」, 不要留一片空白讓人讀成「沒有人占著」。
  #    (空白與「查無」在畫面上是同一個東西 —— 而它們給相反的答案。)
  #    ⚠️ 實測 2026-09-04 macOS:`ss` 根本不存在, 而 `lsof` 有一次對【自己的】socket
  #    也印 0 行 ⇒ 單靠一把尺這裡就會是空白。
  if [ -s "$_h" ]; then sed 's/^/      /' "$_h"
  else printf '      🔴 三把尺(lsof / ss / netstat)都查不出占用者 —— 這【不是】「沒有人占著」, 是查不出來。\n'
  fi
  rm -f "$_h"
}

# 回 0 = 這個 port 現在綁得起來。
# ⚠️ ponytail: 這是 check-then-act, 中間有 race —— 兩支探針同秒起才會撞到。
#    真撞到時 pg 起不來那一段會補印占用者, 不會靜靜地過去。
port_free () {
  python3 - "$1" <<'PYPORT'
import socket, sys
s = socket.socket()
try:
    s.bind(('127.0.0.1', int(sys.argv[1])))
except OSError:
    sys.exit(1)
finally:
    s.close()
PYPORT
}

# 🔴 **不用「撞到就 +1」** —— 隔壁探針的預設就在 55440/41/43,
#   往上數會【把它們推向彼此】(主視窗 2026-09-04 逐字:「不要讓它們塌成一個」)。
#   ⇒ 預設先試(留給人 `psql -p 55442` 進去看), 被占就【讓 OS 挑一個】——
#   ephemeral 範圍夠大, 而且它結構上不會撞到任何一支寫死的 port。
PORT_BASE="${PGPORT_PROBE:-55442}"
if port_free "$PORT_BASE"; then
  PORT="$PORT_BASE"
else
  printf '  🔵 預設 port %s 已被占用。占用者:\n' "$PORT_BASE"
  port_holder "$PORT_BASE"
  PORT="$(python3 - <<'PYPICK'
import socket
s = socket.socket()
s.bind(('127.0.0.1', 0))
print(s.getsockname()[1])
s.close()
PYPICK
)"
  printf '  🔵 改用 OS 挑的 port %s。\n' "$PORT"
fi
[ -n "$PORT" ] || { echo "🔴 取不到可用 port"; exit 1; }

D="$(mktemp -d)"
trap 'pg_ctl -D "$D/data" stop -m fast >/dev/null 2>&1 || true; rm -rf "$D"' EXIT

initdb -U postgres -A trust --encoding=UTF8 --locale=C "$D/data" > "$D/initdb.log" 2>&1 || { cat "$D/initdb.log"; exit 1; }
pg_ctl -D "$D/data" -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" \
  -l "$D/pg.log" start >/dev/null 2>&1
for _ in $(seq 1 40); do
  psql -h 127.0.0.1 -p "$PORT" -U postgres -tAc "select 1" >/dev/null 2>&1 && break
  sleep 0.25
done
psql -h 127.0.0.1 -p "$PORT" -U postgres -tAc "select 1" >/dev/null 2>&1 || {
  echo "🔴 起不了拋棄式 PG。log:"; cat "$D/pg.log"
  # 🔴 走到這裡代表【檢查完到起 pg 之間】有人搶走了 port(check-then-act 的 race),
  #    或 pg 因為別的理由起不來。兩種都要印占用者 —— 沒有人占著時它會說「查不出來」。
  printf '  🔵 port %s 現在的占用者:\n' "$PORT"; port_holder "$PORT"
  exit 1; }

pq () { psql -h 127.0.0.1 -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q "$@"; }
pv () { psql -h 127.0.0.1 -p "$PORT" -U postgres -tA "$@" 2>&1; }
# 🔴 `pv1`:給【要拿回傳值當資料用】的地方。`-q` 讓 psql 不印 `INSERT 0 1` 那種狀態行。
pv1 () { psql -h 127.0.0.1 -p "$PORT" -U postgres -tAq "$@" 2>&1; }

FAIL=0; PASS=0
ok  () { PASS=$((PASS+1)); printf '  ✅ %s\n' "$1"; }
bad () { FAIL=$((FAIL+1)); printf '  🔴 %s\n' "$1"; }

# ── 切檔:兩支函式從 migration 本身切出來 ─────────────────────────────────────
python3 - "$MIG" "$D" <<'PYEOF'
import io, sys
mig, d = sys.argv[1], sys.argv[2]
s = io.open(mig, encoding='utf-8').read()
i = s.index('CREATE OR REPLACE FUNCTION public.claim_double_charge_anomaly_for_refund')
# 🔴 切到【第一個 REVOKE 之前】, 不是找 `$$;`
#    ⛔ 第一版用 `s.index('\\n$$;', j)` 找 resolve 那支的收尾 —— **那找到的是檔尾 DO 區塊的 `$$;`**
#      (兩支函式用的收尾符號不是 `$$`)⇒ 切出來的東西含 REVOKE/GRANT/DO
#      ⇒ 每次重建函式都會把 ACL 與突變一起重置 ⇒ **正是範本記過的那種假綠**。
#    ✅ 而**切法自檢當場抓到它**(「fns.sql 含 REVOKE/GRANT/DO」)⇒ 那道自檢不是裝飾。
#    📌 一個「找結尾」的錨, 它找到的是【那個符號的下一次出現】, 不是【那個東西的結尾】。
k = s.index('REVOKE ALL ON FUNCTION public.claim_double_charge_anomaly_for_refund', i)
io.open(d + '/fns.sql', 'w', encoding='utf-8').write(s[i:k])
print('fns bytes=%d' % (k - i))
PYEOF

if ! head -1 "$D/fns.sql" | grep -q '^CREATE OR REPLACE FUNCTION public\.claim_double'; then
  bad "切法自檢:fns.sql 第一行不是 claim 那支 ⇒ 切錯了"
else
  ok "切法自檢:fns.sql 從 claim 開始"
fi
# 🔴 **剝掉 `--` 註解再看** —— 第一版直接 grep, 而它命中的是**函式檔頭註解裡在講 REVOKE 的那幾行**
#    ⇒ 一個誠實描述「這支函式被 REVOKE 到只剩 owner」的註解, 被這道自檢讀成「我切到了 REVOKE」。
#    📌 **一把讀原始碼字面的尺, 它的分母包含所有在講這件事的字, 而註解最會講。**
#      (今晚第三次同族 —— 前兩次在券片 3b 與那道 allowlist 閘。)
sed -e 's/--.*$//' "$D/fns.sql" > "$D/fns.nocomment.sql"
if grep -qE '^[[:space:]]*(REVOKE|GRANT|DO \$)' "$D/fns.nocomment.sql"; then
  bad "切法自檢:fns.sql 含 REVOKE/GRANT/DO(剝註解後仍命中)⇒ 重建函式會把突變清掉"
else
  ok "切法自檢:fns.sql 只有兩支函式本體(剝註解後零命中)"
fi
if ! grep -q 'CREATE OR REPLACE FUNCTION public.resolve_double_charge_anomaly' "$D/fns.sql"; then
  bad "切法自檢:fns.sql 裡沒有 resolve 那支 ⇒ 只切到一半"
else
  ok "切法自檢:兩支都在"
fi

# ── base ─────────────────────────────────────────────────────────────────────
pq >/dev/null <<'SQL'
CREATE TABLE public.customers (user_id uuid PRIMARY KEY);
INSERT INTO public.customers VALUES ('11111111-1111-1111-1111-111111111111');
CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_user_id uuid REFERENCES public.customers(user_id),
  total integer NOT NULL DEFAULT 0
);
CREATE TABLE public.payment_charge_attempts (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
SQL

# 🔴 這張表【照真表逐字建】—— 那兩條 CHECK 才是這台狀態機的真守門。
pq >/dev/null <<'SQL'
CREATE TABLE public.payment_double_charge_anomalies (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  old_attempt_id              uuid        NOT NULL UNIQUE REFERENCES public.payment_charge_attempts(id),
  old_order_id                uuid        NOT NULL REFERENCES public.orders(id),
  user_id                     uuid        NOT NULL,
  cart_session_id             uuid        NOT NULL,
  rec_trade_id                text        NOT NULL,
  refund_target_rec_trade_id  text        NOT NULL,
  released_at                 timestamptz NOT NULL,
  charged_at                  timestamptz NOT NULL,
  amount                      integer     NOT NULL CHECK (amount >= 0),
  status                      text        NOT NULL DEFAULT 'open',
  refund_claimed_at           timestamptz,
  refund_claimed_by           text,
  resolved_at                 timestamptz,
  resolved_by                 text,
  resolution_note             text,
  refund_provider_reference   text,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_double_charge_anomalies_status_check
    CHECK (status IN ('open', 'refunding', 'refunded', 'dismissed')),
  CONSTRAINT payment_double_charge_anomalies_status_consistency_check CHECK (
    CASE status
      WHEN 'open' THEN
            refund_claimed_at IS NULL AND refund_claimed_by IS NULL
        AND resolved_at IS NULL AND resolved_by IS NULL
        AND resolution_note IS NULL AND refund_provider_reference IS NULL
      WHEN 'refunding' THEN
            refund_claimed_at IS NOT NULL AND refund_claimed_by IS NOT NULL
        AND resolved_at IS NULL AND resolved_by IS NULL
      WHEN 'refunded' THEN
            refund_claimed_at IS NOT NULL AND refund_claimed_by IS NOT NULL
        AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL
        AND refund_target_rec_trade_id IS NOT NULL
        AND refund_provider_reference IS NOT NULL
        AND pg_catalog.btrim(refund_provider_reference) <> ''
      WHEN 'dismissed' THEN
            resolved_at IS NOT NULL AND resolved_by IS NOT NULL AND resolution_note IS NOT NULL
        AND refund_provider_reference IS NULL
      ELSE false
    END
  )
);
-- 🔴 這張【照真表建】—— 兩支函式都會寫一筆稽核事件進來, 而它有 event_type 的 CHECK。
--    少了它 ⇒ 函式當場炸 `relation does not exist`;而少了那條 CHECK ⇒
--    函式寫錯 event_type 也不會有人知道。
CREATE TABLE public.payment_double_charge_anomaly_events (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  anomaly_id          uuid        NOT NULL REFERENCES public.payment_double_charge_anomalies(id),
  event_type          text        NOT NULL,
  from_status         text,
  to_status           text,
  actor_session_role  text        NOT NULL,
  note                text        NOT NULL,
  provider_reference  text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_double_charge_anomaly_events_event_type_check
    CHECK (event_type IN ('claim', 'refund_confirmed', 'refund_not_executed', 'refund_uncertain', 'reopened', 'dismissed'))
);
SQL
ok "base 建好(anomaly 表照真表, 含兩條 CHECK)"

pq -f "$D/fns.sql" >/dev/null 2>&1 || { echo "🔴 兩支函式建不起來"; pq -f "$D/fns.sql"; exit 1; }
ok "兩支函式從 migration 切出來並建起來了"

# ── 一格一個世界 ─────────────────────────────────────────────────────────────
mk () {  # mk <anomaly_id> <status>  —— 造一張指定狀態的 anomaly
  local aid="$1" st="$2" oid attid
  # 🔴 用 `pv1`(帶 -q)不是 `pv` —— `pv` 沒有 `-q` ⇒ 回來的字串**尾巴帶著 `INSERT 0 1`**
  #    ⇒ 拿它當 uuid 塞回去 ⇒ `invalid input syntax for type uuid: "…-… INSERT 0 1"`
  #    📌 而那一發的後果是**整支 probe 22 格紅**, 而每一格的訊息都在講「anomaly 不存在」
  #      ⇒ 📌 **22 個紅指向 22 個不同的地方, 而根只有一個** —— 而讀第一眼會以為函式壞了。
  oid="$(pv1 -c "insert into public.orders (customer_user_id,total) values ('11111111-1111-1111-1111-111111111111',1000) returning id")"
  attid="$(pv1 -c "insert into public.payment_charge_attempts default values returning id")"
  case "$st" in
    open)      EXTRA=", NULL, NULL, NULL, NULL, NULL, NULL" ;;
    refunding) EXTRA=", now(), 'ops', NULL, NULL, NULL, NULL" ;;
    *)         EXTRA=", now(), 'ops', now(), 'ops', 'n', 'ref1'" ;;
  esac
  pq >/dev/null -c "insert into public.payment_double_charge_anomalies
    (id, old_attempt_id, old_order_id, user_id, cart_session_id, rec_trade_id,
     refund_target_rec_trade_id, released_at, charged_at, amount, status,
     refund_claimed_at, refund_claimed_by, resolved_at, resolved_by, resolution_note, refund_provider_reference)
    values ('$aid','$attid','$oid','11111111-1111-1111-1111-111111111111',gen_random_uuid(),'rec','recT',now(),now(),1000,'$st'$EXTRA)" \
    2>"$D/mk.err" || { bad "前提建不起來(anomaly $aid 狀態 $st):$(head -2 "$D/mk.err" | tr '\n' ' ')"; return 1; }
  ok "前提:一張 status=$st 的 anomaly($aid)"
}

cell () {  # cell <說明> <期望字串> <SQL>
  local desc="$1" want="$2" sql="$3" got
  got="$(pv -c "$sql")"
  case "$got" in *"$want"*) ok "$desc  ⇒ $(printf '%s' "$got" | head -1)" ;;
                 *)         bad "$desc  期望含【$want】而實得:$(printf '%s' "$got" | head -1)" ;;
  esac
}

A1=aaaa0000-0000-0000-0000-000000000001
A2=aaaa0000-0000-0000-0000-000000000002
A3=aaaa0000-0000-0000-0000-000000000003
A4=aaaa0000-0000-0000-0000-000000000004

echo ""
echo "── claim:open → refunding ────────────────────────────────────────────────"
mk "$A1" open
cell "認領一張 open 的 ⇒ claimed=true"  '"claimed": true'  "select public.claim_double_charge_anomaly_for_refund('$A1')"
cell "🔵 再認領同一張 ⇒ claimed=false(CAS 擋住)" '"claimed": false' "select public.claim_double_charge_anomaly_for_refund('$A1')"
cell "🔵 認領一張不存在的 ⇒ claimed=false" '"claimed": false' "select public.claim_double_charge_anomaly_for_refund('99999999-9999-9999-9999-999999999999')"
cell "🟢 而它真的翻成 refunding 了" 'refunding' "select status from public.payment_double_charge_anomalies where id='$A1'"

echo ""
echo "── resolve:輸入驗證 ─────────────────────────────────────────────────────"
cell "🔵 非法 resolution ⇒ 拒" '非法 resolution' "select public.resolve_double_charge_anomaly('$A1','zzqbogus','n')"
cell "🔵 note 空白 ⇒ 拒"       'resolution_note 必填非空' "select public.resolve_double_charge_anomaly('$A1','refunded','   ')"
cell "🔵 anomaly 不存在 ⇒ 拒"  '不存在' "select public.resolve_double_charge_anomaly('99999999-9999-9999-9999-999999999999','dismissed','n')"

echo ""
echo "── resolve → refunded(只允許 refunding)──────────────────────────────────"
cell "🔴 refunded 少了退款證據 ⇒ 拒" 'refund_provider_reference 必填非空' \
  "select public.resolve_double_charge_anomaly('$A1','refunded','已退款')"
cell "refunding + 有證據 ⇒ refunded" '"status": "refunded"' \
  "select public.resolve_double_charge_anomaly('$A1','refunded','已退款','PROV-1')"
mk "$A2" open
cell "🔵 open→refunded 直跳 ⇒ 拒(禁跳)" '僅允許 refunding' \
  "select public.resolve_double_charge_anomaly('$A2','refunded','x','PROV-2')"

echo ""
echo "── resolve → dismissed(只允許 open)─────────────────────────────────────"
cell "open ⇒ dismissed" '"status": "dismissed"' "select public.resolve_double_charge_anomaly('$A2','dismissed','不是雙扣')"
mk "$A3" refunding
cell "🔵 refunding→dismissed ⇒ 拒" '僅允許 open' "select public.resolve_double_charge_anomaly('$A3','dismissed','x')"
# 🔴 這一格要一張 **open** 的單 —— 我第一版餵 `$A3`(refunding)
#    ⇒ 它先撞上「dismissed 僅允許 open」那一道 ⇒ **量到的是狀態機那一格, 不是證據那一格**
#    ⇒ 📌 **兩道守門排在同一條路上, 而前面那道會替後面那道回答。**
#      而它印的是紅、訊息也是真的 —— 只是那不是我要測的東西。
A5=aaaa0000-0000-0000-0000-00000000000a
mk "$A5" open
cell "🔵 dismissed 帶退款證據 ⇒ 拒" '不得帶 refund_provider_reference' \
  "select public.resolve_double_charge_anomaly('$A5','dismissed','x','PROV-3')"

echo ""
echo "── reopen / uncertain(只允許 refunding)─────────────────────────────────"
cell "refunding ⇒ reopen 回 open" '"status": "open"' "select public.resolve_double_charge_anomaly('$A3','reopen','退不了')"
mk "$A4" refunding
cell "refunding ⇒ uncertain(仍 refunding, resolved=false)" '"resolved": false' \
  "select public.resolve_double_charge_anomaly('$A4','uncertain','等對方回覆')"
cell "🔵 open ⇒ reopen 拒(它只從 refunding 來)" '僅允許 refunding→open' \
  "select public.resolve_double_charge_anomaly('$A3','reopen','x')"

echo ""
echo "── 🔴🔴 突變:打在【函式本體】上, base 不重跑 ─────────────────────────────"
mutate () {  # mutate <說明> <sed 表達式> <該變的 SQL> <變之前會出現的字串>
  local desc="$1" expr="$2" sql="$3" nowant="$4" got
  sed "$expr" "$D/fns.sql" > "$D/mut.sql"
  if cmp -s "$D/fns.sql" "$D/mut.sql"; then
    bad "突變【$desc】沒有改到任何東西 ⇒ 這一發沒有判別力(anchor 錯了)"; return
  fi
  pq -f "$D/mut.sql" >/dev/null 2>&1 || { bad "突變【$desc】讓函式建不起來 ⇒ 那是語法錯, 不是守門抓到"; }
  got="$(pv -c "$sql")"
  case "$got" in *"$nowant"*) bad "突變【$desc】之後行為沒變(仍含 $nowant)⇒ 那一格是恆綠的" ;;
                 *)           ok "突變【$desc】⇒ 行為變了($(printf '%s' "$got" | head -1))" ;;
  esac
  pq -f "$D/fns.sql" >/dev/null 2>&1
}

mk aaaa0000-0000-0000-0000-000000000005 open
mutate "把 claim 的 CAS 條件(status='open')拿掉" \
  "s/AND a.status = 'open';/;/" \
  "select public.claim_double_charge_anomaly_for_refund('$A1')" '"claimed": false'

mk aaaa0000-0000-0000-0000-000000000006 refunding
# 🔴 anchor 是 `IF v_prov = '' THEN` —— 我第一版猜成 `pg_catalog.btrim(coalesce(...))`
#    ⇒ sed 沒改到任何東西 ⇒ 而 `mutate` 自己抓到了(「沒有改到任何東西 ⇒ 這一發沒有判別力」)
#    📌 **一個沒改到東西的突變, 它跑出來的結果與「守門有效」長得一模一樣** ——
#      要靠 `cmp` 那一格才分得開。
mutate "把 refunded 的退款證據檢查改成恆假" \
  "s/IF v_prov = '' THEN/IF false THEN/" \
  "select public.resolve_double_charge_anomaly('aaaa0000-0000-0000-0000-000000000006','refunded','x')" \
  'refund_provider_reference 必填非空'

echo ""
echo "── 🟢 還原驗證 ───────────────────────────────────────────────────────────"
mk aaaa0000-0000-0000-0000-000000000007 open
cell "還原後 claim 仍然只成功一次" '"claimed": true' \
  "select public.claim_double_charge_anomaly_for_refund('aaaa0000-0000-0000-0000-000000000007')"

echo ""
printf '════ 結果:%s 綠 / %s 紅 ════\n' "$PASS" "$FAIL"
[ "$FAIL" != "0" ] && exit 1
exit 0
