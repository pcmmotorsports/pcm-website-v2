#!/usr/bin/env bash
# storefront-probe 的**單一設定來源** —— `up.sh` 與 `down.sh` 都 source 這一支。
# 2026-08-19 W3 建;做法與理由逐字對齊 `scripts/admin-probe/env.sh`(**不是重用檔案,是照抄做法**)。
#
# 🔴🔴 **為什麼是一支共用檔,而不是兩邊各自寫 `${VAR:-預設}`**:
#    埠一旦可覆寫,`up` 與 `down` 若各自持有一份預設值,就會長出:
#      起的時候覆寫了埠 → 收的時候忘了帶同一組 → `down.sh` 拿【預設埠】去查
#      ⇒ **兩層都印「已釋放」,而鑽機還活著。**
#    ⚠️ 而 `down.sh` 的埠層之所以是「真的判準」,**正是因為它原本寫死**
#      ⇒ 參數化做錯**會把那道最後的保險一起拿掉**。
#
# 🔴 **而這支檔的直接證據就在本專案裡**:落檔當下,兩支腳本各自寫了一份常數,
#    **而它們已經不一樣了** ——
#      `up.sh` 那一行只有 4 個埠(CORS 那個是寫死的字面 `3987`,散在三處)
#      `down.sh` 那一行有 5 個(多一個 `CORS=3987`)
#    ⇒ **不是「將來會分歧」,是【已經分歧】了,而沒有任何東西會紅。**
#
# 用法(並行跑第二份鑽機):
#   STOREFRONT_PROBE_DIR=/tmp/pcm-g3-probe-b \
#   STOREFRONT_PROBE_PG=55543 STOREFRONT_PROBE_PREST=3979 STOREFRONT_PROBE_PROXY=3978 \
#   STOREFRONT_PROBE_WEB=3030 STOREFRONT_PROBE_CORS=3997 \
#     bash scripts/storefront-probe/up.sh
#   🔴 **收的時候要帶【同一組】** —— `down.sh` 會把它讀到的埠印出來,與 `owner.txt` 那行對不上就是帶錯了。

: "${STOREFRONT_PROBE_DIR:=/tmp/pcm-g3-probe}"
: "${STOREFRONT_PROBE_PG:=55533}"
: "${STOREFRONT_PROBE_PREST:=3969}"
: "${STOREFRONT_PROBE_PROXY:=3968}"
: "${STOREFRONT_PROBE_WEB:=3020}"
# 🔴 CORS:給 `overflow-ruler.mjs` 用的最小 http server。
#    **它原本寫死在 `cors-server.py` 裡面**(`("127.0.0.1", 3987)`)⇒ 覆寫這個變數沒有用。
#    本片改成由 `up.sh` 用 argv 傳給它,那支 py 讀 `sys.argv[1]`。
: "${STOREFRONT_PROBE_CORS:=3987}"

S="$STOREFRONT_PROBE_DIR"
PG="$STOREFRONT_PROBE_PG"
PREST="$STOREFRONT_PROBE_PREST"
PROXY="$STOREFRONT_PROBE_PROXY"
WEB="$STOREFRONT_PROBE_WEB"
CORS="$STOREFRONT_PROBE_CORS"
