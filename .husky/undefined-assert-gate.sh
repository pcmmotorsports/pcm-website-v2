#!/bin/sh
# .husky/undefined-assert-gate.sh — 殼。真閘在 scripts/undefined-assert-gate.py。
#
# 🔴 **它擋的是一種【安靜通過】的斷言**:`toHaveBeenCalledWith({ a:1, b:undefined })`
#    ⇒ `{b: undefined}` 與 `{}` 在 vitest 下**兩個方向都相等**
#    ⇒ 那個 `b` 只保證「它不是別的值」,**不保證那個鍵存在** ——
#      實作哪天整個不傳 `b`, 這一格照樣綠。
#
# 🔴 **repo 現況:54 處, 逐處量過【零判別力 54/54, 零例外】**(2026-09-01)。
#    ⇒ 而本閘**不是為了修那 53 處** —— 它們在豁免清單裡。
#    ⇒ 📌 **它的價值在【第 24 處進不來】。**
#
# ⚠️ **本閘的天花板寫在 .py 的檔頭那節** —— 最重要的兩格:
#    ① 值是**變數**而該變數是 undefined ⇒ 靜態看不出來
#    ② 🔴 **它只擋新進來的** ⇒ **本閘綠, 不代表 repo 裡沒有這種斷言。**
#
# fail-closed:.py 或豁免清單不見了 ⇒ rc=2 擋下。
#   理由與本目錄其他幾道相同:同一顆 commit 刪掉本閘、再做本閘要防的事 ——
#   fail-open 會讓這一片的守門【被它自己要防的那個動作關掉】。
set -u
if [ ! -f scripts/undefined-assert-gate.py ]; then
  printf '%s\n' '🔴 scripts/undefined-assert-gate.py 不見了 ⇒ 擋下(不放行)' >&2
  printf '%s\n' '   復原:git checkout -- scripts/undefined-assert-gate.py' >&2
  exit 2
fi
if [ ! -f scripts/undefined-assert-gate.exemptions.tsv ]; then
  printf '%s\n' '🔴 豁免清單不見了 ⇒ 擋下 —— 沒有它, 既有 23 處會全部變紅而人會直接拿掉本閘' >&2
  printf '%s\n' '   復原:git checkout -- scripts/undefined-assert-gate.exemptions.tsv' >&2
  exit 2
fi
python3 scripts/undefined-assert-gate.py
exit $?
