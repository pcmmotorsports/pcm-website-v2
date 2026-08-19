#!/usr/bin/env bash
# admin-probe 的**單一設定來源** —— `up.sh` 與 `down.sh` 都 source 這一支。
# 2026-08-19 W3 建,來由 = W6 `W6-043` n2 + W3 當晚被別窗佔埠擋住一次的實測。
#
# 🔴🔴 **為什麼是一支共用檔,而不是兩邊各自寫 `${VAR:-預設}`**(W6 在我動手前指出的坑):
#    埠一旦可覆寫,`up` 與 `down` 若各自持有一份預設值,就會長出這個形狀:
#      起的時候覆寫了埠 → 收的時候忘了帶同一組 → `down.sh` 拿【預設埠】去查
#      ⇒ **兩層都印「已釋放」,而鑽機還活著。**
#    ⚠️ 而它比 n2 原本講的更糟:`down.sh` 的埠層之所以是「真的判準」,**正是因為它寫死**
#      ⇒ 參數化如果做錯,**會把那道最後的保險一起拿掉**。
#    ⇒ 一份定義、兩支 source;而 `up.sh` 另外把**實際用的四個埠寫進 `owner.txt`**
#      ⇒ 收攤判紅時印得出來,人才查得到自己當初用的是哪一組。
#
# 用法(並行跑第二份鑽機):
#   ADMIN_PROBE_DIR=/tmp/pcm-admin-probe-b \
#   ADMIN_PROBE_PG=55544 ADMIN_PROBE_PREST=3989 ADMIN_PROBE_PROXY=3988 ADMIN_PROBE_WEB=3021 \
#     bash scripts/admin-probe/up.sh
#   🔴 **收的時候要帶【同一組】** —— 不帶就是上面那個形狀。
#      `down.sh` 會把它讀到的四個埠印出來,與 `owner.txt` 那行對不上就是你帶錯了。

# 🔴 `:` + `${VAR:=值}` 是**賦值**形式:呼叫端有給就用它的,沒給才落到預設。
#    不要改成 `VAR=${VAR:-值}` 以外的寫法而忘了 export —— 兩支都是 source,不需要 export。
: "${ADMIN_PROBE_DIR:=/tmp/pcm-admin-probe}"
: "${ADMIN_PROBE_PG:=55534}"
: "${ADMIN_PROBE_PREST:=3979}"
: "${ADMIN_PROBE_PROXY:=3978}"
: "${ADMIN_PROBE_WEB:=3011}"

S="$ADMIN_PROBE_DIR"
PG="$ADMIN_PROBE_PG"
PREST="$ADMIN_PROBE_PREST"
PROXY="$ADMIN_PROBE_PROXY"
WEB="$ADMIN_PROBE_WEB"
