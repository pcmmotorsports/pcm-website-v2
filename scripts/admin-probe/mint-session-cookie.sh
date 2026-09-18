#!/usr/bin/env bash
# 給後台鑽機簽一張【新的】admin session 票,寫進 $ADMIN_PROBE_DIR/session-cookie.txt,
# 並把那一行(`名=值`)印到 stdout 給呼叫端接。
#
# 🔴🔴 **為什麼這段要從 `up.sh` 搬出來獨立成一支**(2026-09-18 窗A,實撞出來的):
#    票只活 **15 分鐘**(`ADMIN_SESSION_MAX_AGE_SEC`,Sean `Q-B5b-2=乙` 拍的)。
#    而 `up.sh` 只在【起鑽機那一刻】寫那個檔 ⇒ **鑽機起超過 15 分鐘之後,那個檔就是一張死票。**
#    ⇒ 任何「讀 `session-cookie.txt` 然後用它」的東西(e2e、手貼 console)
#      在鑽機起了一天之後跑,拿到的一定是死票。
#
#    🔬 **2026-09-18 22:32 實測**(那台鑽機起於 09-17 11:25):
#      · 檔裡那張票 `exp = 2026-09-17 14:30:41`,量的當下 `2026-09-18 22:32:29` ⇒ **過期 32.0 小時**
#      · `POST /api/session/renew`:**新票 200 / 那張死票 401 / 完全不帶票 401**
#    📌 ⇒ **「好票」與「壞票」並不是長得一樣** —— 09-18 之前之所以看起來一樣,
#      是因為兩次拿的是【同一張死票】。**排除掉的那一格其實沒被量過。**
#
#    🛑 而失敗的外顯是畫面上那句「請先在右上角選擇操作人員」——
#      `authorizeAdminMutation()` 三道閘(session / Origin / actor)**回的是同一個 null**
#      ⇒ 那句話**分不出是哪一道** ⇒ 不要從那句話推原因,要去量。
#      (`apps/admin/src/lib/session/authorize.ts`、`lib/shipping/shipment-action-audit.ts` 的 NO_ACTOR_MESSAGE)
#
# 🔴 票的形狀【不是這裡發明的】,逐格對著 `apps/admin/src/lib/session/session.ts` 抄;
#    逐條對應寫在 `up.sh` ⑧b 那段註解裡,**不在這裡複製第二份**(兩份會漂)。
#
# 用法:
#   bash scripts/admin-probe/mint-session-cookie.sh          # 用預設 dir / secret / staff
#   ADMIN_PROBE_DIR=/tmp/pcm-admin-probe-b bash scripts/admin-probe/mint-session-cookie.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./env.sh
. "$HERE/env.sh"

SECRET="$ADMIN_PROBE_SECRET"
STAFF_ID="$ADMIN_PROBE_STAFF_ID"
COOKIE_NAME="pcm_admin_sess_dev"

COOKIE_VAL=$(SECRET="$SECRET" STAFF_ID="$STAFF_ID" python3 <<'MINT'
import base64, hashlib, hmac, json, os, time
secret = os.environ["SECRET"]; staff = os.environ["STAFF_ID"]
env_tag = "local"
material = f"v1:{len(secret)}:{secret}:{len(env_tag)}:{env_tag}".encode()
now = int(time.time())
payload = {
    "v": 2, "sid": os.urandom(16).hex(), "iat": now, "sso_at": now,
    "exp": now + 60 * 15,                      # 對齊 ADMIN_SESSION_MAX_AGE_SEC
    "amr": ["pwd"], "auth_time": now,
    "sub": {"kind": "user", "staff_id": staff},
}
# 🔴 separators 去空白:`verifySession` 驗的是【位元組】,簽名與 payload 是同一份 bytes。
data = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode()
b64 = lambda x: base64.urlsafe_b64encode(x).decode().rstrip("=")
sig = hmac.new(material, data, hashlib.sha256).digest()
print(f"{b64(data)}.{b64(sig)}")
MINT
)

mkdir -p "$S"
printf '%s\n' "$COOKIE_NAME=$COOKIE_VAL" > "$S/session-cookie.txt"
# 🛑 只印到 stdout 給呼叫端接;**不要在這裡 echo 任何說明文字**,否則呼叫端 `$(...)` 會吃到它。
printf '%s\n' "$COOKIE_NAME=$COOKIE_VAL"
