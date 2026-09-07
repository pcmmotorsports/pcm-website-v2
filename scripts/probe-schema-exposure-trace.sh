#!/usr/bin/env bash
# probe-schema-exposure-trace — 跑那支曝露探針, 並【留下一行痕跡】
#
# ══ 🔴 它為什麼存在(板列 ⟦0e-PROBENOSCHED⟧)════════════════════════
# `scripts/probe-schema-exposure.sh` **跑完不落任何檔**
# ⇒ 📌 **【真的跑過】與【從來沒跑過】在檔案系統上長得一模一樣。**
# ⇒ 🎯 **「有沒有人在跑」這件事, 在本檔存在之前【沒有任何人答得出來】** —— 包括開列的人。
#
# 🛑 **而排程【刻意還沒接】** —— 在痕跡存在之前接排程,
#    只會變成**第二個「跑了而沒有人知道」**。⇒ 接排程是下一題, 條件是本檔先有資料。
#
# ══ 🔴 痕跡放 repo 外, 而那不是隨手決定 ═══════════════════════════
# 落點 `~/pcm-mailbox/probe-schema-exposure-觀察.tsv`(append-only)
# 📌 **放 repo 裡的話, 每跑一次就一顆 commit** —— 而**那個雜訊會讓人把它關掉。**
# 🔵 形狀對齊 `~/pcm-mailbox/cron-live-觀察.tsv`(A 2026-09-06 指定的同一族)。
#
# ══ 🔴 一行四格, 少一格就答不出下一個人要問的事 ═══════════════════
#   ① 時間(本機時區, 到秒)
#   ② 目標(site / quote / both)
#   ③ **結果** —— `rc` 三態 + `checks` + `fails`
#      🛑 **只寫「跑過了」的話, 下一個人拿到的是「它有在跑」,**
#         **而答不出【它看到的東西有沒有變】。**
#   ④ 那一刻的 `origin/dev` hash
#      📌 **數字離開量測現場, 座標要跟著走**(A 2026-09-07 立)。
#
# 用法:  bash scripts/probe-schema-exposure-trace.sh [site|quote|both]
#        bash scripts/probe-schema-exposure-trace.sh --selftest    離線, 不打網路、不寫痕跡
set -u

TRACE="${HOME}/pcm-mailbox/probe-schema-exposure-觀察.tsv"
PROBE="$(cd "$(dirname "$0")" && pwd)/probe-schema-exposure.sh"

# 🔴 檔頭那句是【防下一個假讀數】的, 不是說明文字 ——
#    明天有人打開這份 log 看到只有一兩行, 他會讀成「幾乎沒有人在跑」,
#    而真相是「今天以前沒有資料」。
#    📌 **一個空的紀錄檔, 與一個「沒有人做過」的事實, 印同一個東西** —— 那正是本列的病,
#       而本檔正是用同一個形狀去修它 ⇒ 所以這句必須在第一行。
ensure_header() {
  [ -f "$TRACE" ] && return 0
  mkdir -p "$(dirname "$TRACE")"
  {
    printf '# 本檔自 2026-09-07 起才開始留痕。在此之前【有沒有人跑過】永遠答不出來 —— 那支探針當時不落任何檔。\n'
    printf '# 本檔的空白只代表「沒有資料」, 不代表「沒有人跑」。\n'
    printf '# rc 三態:0=全格通過 · 3=有格 FAIL(真發現)· 2=用法錯 · 1=工具自壞(連不上/認證失敗也算 1, 不是 3)\n'
    printf '# 🛑 排程刻意還沒接:在本檔有資料之前接排程 = 第二個「跑了而沒有人知道」。\n'
    printf 'ts\ttarget\trc\tchecks\tfails\torigin_dev\n'
  } > "$TRACE"
}

if [ "${1:-}" = "--selftest" ]; then
  # 🔵 自檢只演【痕跡那一行組得出來嗎】, 不打網路、不寫檔。
  #    🛑 它證不到那支探針本身對不對 —— 那支自己有 35 格 selftest。
  line=$(printf '%s\t%s\t%s\t%s\t%s\t%s' '2026-01-01T00:00:00' 'both' '0' '35' '0' 'deadbeef')
  n=$(printf '%s' "$line" | awk -F'\t' '{print NF}')
  if [ "$n" -eq 6 ]; then
    printf '✅ 痕跡一行 6 格(ts/target/rc/checks/fails/origin_dev)\n'
  else
    printf '❌ 欄數 %s, 期望 6\n' "$n"; exit 1
  fi
  # 🟢 負對照:少一格必須被抓到(否則上面那個 ✅ 是恆真)
  bad=$(printf '%s\t%s' 'a' 'b'); nb=$(printf '%s' "$bad" | awk -F'\t' '{print NF}')
  if [ "$nb" -eq 6 ]; then printf '❌ 負對照:2 格也被判成 6\n'; exit 1; fi
  printf '✅ 負對照:2 格的行【沒有】被判成合格 ⇒ 這個檢查會紅\n'
  printf '🛑 而本自檢【證不到】探針本身對不對, 也證不到痕跡真的寫得進去(那要真跑一次)。\n'
  exit 0
fi

TARGET="${1:-both}"
ensure_header

OUT=$(sh "$PROBE" "$TARGET" 2>&1) ; RC=$?
# 🔴 `$?` 每一個指令都會覆寫 ⇒ 上一行之後不准有任何東西(CLAUDE.md 終端機紀律)。

# 從探針自己的收尾行取數:`[db] 小計:N 格,FAIL M 格`
CHECKS=$(printf '%s\n' "$OUT" | awk -F'小計:' '/小計:/{split($2,a," 格");s+=a[1]} END{print s+0}')
FAILS=$(printf '%s\n' "$OUT" | awk -F'FAIL ' '/小計:/{split($2,a," 格");s+=a[1]} END{print s+0}')
DEV=$(git -C "$(dirname "$PROBE")/.." rev-parse --short origin/dev 2>/dev/null || printf 'unknown')
TS=$(date '+%Y-%m-%dT%H:%M:%S')

printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$TS" "$TARGET" "$RC" "$CHECKS" "$FAILS" "$DEV" >> "$TRACE"
printf '%s\n' "$OUT"
printf '\n📎 痕跡已寫:%s\n' "$TRACE"
printf '   %s\t%s\t%s\t%s\t%s\t%s\n' "$TS" "$TARGET" "$RC" "$CHECKS" "$FAILS" "$DEV"
exit "$RC"
