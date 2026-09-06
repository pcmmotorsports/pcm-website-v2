#!/bin/sh
# ============================================================
# lib-migration-header-marks.sh — migration 檔頭 `pcm:` 標記的【唯一】parser
# ============================================================
# 線 -db 2026-09-06 建。成因 = codex R1/R2 各抓 8 條、Fable R3 判 FAIL 的那個**形狀**:
#
# 🔴🔴 **四支工具各寫一份 parser ⇒ 每一個修法在結構上只能是局部的。**
#    R1 抓 8 條、我折完;R2 又抓 8 條、我又折完 —— 兩輪都是「只修了被點名的那個實例」。
#    📌 而那不是紀律問題:**N 份 parser + N 份訊息,一個修法本來就只能碰到其中一份。**
#
# 🔴 **實錘(Fable R3 F4,我當場複驗)**:同一個檔頭,兩把尺說「補版控型」、兩把尺說「一般檔」——
#      `deploy-order-gate.sh` / `is-migration-applied.sh` 用 `case *"-- pcm:ddl-into-vc:"*`
#         ⇒ `--` 後面**恰好一個空白**才算
#      `migrations-not-in-ledger.sh` / `migration-new-file-static-checks.sh` 用 `^--[[:space:]]*`
#         ⇒ 幾個空白都算, 而且要行首
#    ⇒ 餵 `--  pcm:ddl-into-vc: x`(兩個空白):前兩支說沒有、後兩支抽到 `x`。
#    🛑 **而畫面上沒有任何東西說兩邊不同** —— 那正是本 repo 記過的「兩把尺在錯的軸上一致」的反面。
#
# ── 文法(唯一權威, 四支工具都呼叫本檔)────────────────────────────
#   · 只看**檔頭前 20 行**。一支檔中段【提到】某個標記字面, 不該把它自己變成那一型。
#   · 形狀 = 行首 `--`、任意空白、`pcm:<key>`、(帶值的 key 再接 `:` 與值)。
#   · 值前後的空白剝掉;**值的字元白名單** = `A-Za-z0-9_., "-`(其餘剝掉)。
#     🔴 為什麼是白名單:codex R2 指出只刪反斜線不夠 —— ESC / CR 一樣能重畫終端、
#        把後面的安全提示蓋掉。**白名單不需要知道下一個沒想到的字元長什麼樣。**
#   · 帶值的 key 而值是空的 ⇒ **不算合法標記, 而且要出聲**(靜默的「看起來有標記」最貴)。
#
# ── 已知的 key(註冊表;新增 key 要同時加進這裡)────────────────────
#   never-apply        無值   本支不 apply 到正式庫。讀者:migration-ledger-divergence(⑨)· state-gates
#   not-needed-now:    帶值   目標已達成, 目前不需要貼;值 = 複查方法。讀者:migration-ledger-divergence(⑩)
#   ddl-into-vc:       帶值   補版控型:物件在正式庫上早就有了;值 = 物件名。
#                             讀者:is-migration-applied · deploy-order-gate · migrations-not-in-ledger
#                             · migration-new-file-static-checks
#   ⚠️ **本註冊表是【文件】不是【機制】** —— 沒有任何東西會在你加了新 key 而沒登記時叫。
#      (Fable R3 F8 點名:`pcm:` key 已有 5 個、6+ 份手寫 parser、未知 key 一律靜默。
#       本檔收攏了 `ddl-into-vc` 那一族;`never-apply` / `not-needed-now:` 的兩份仍在原處 ——
#       **那是已知缺口, 不是我漏掉**;收攏它們要動 pre-push 閘與 state-gates, 另片。)
#
# 用法(sh/bash 都可):
#   . "$(dirname "$0")/lib-migration-header-marks.sh"
#   mark_value <檔頭文字> <key>        → 印出值;沒有合法標記 ⇒ 印空字串
#   mark_present <檔頭文字> <key>      → rc 0 = 那個 key 的字面在(不論值空不空)
#   head20_of_file <路徑>              → 印檔頭前 20 行
#   head20_of_rev  <rev> <路徑>        → 印【那棵樹】的檔頭前 20 行(不是工作樹)
#   head20_of_index_or_worktree <路徑> → 有 staged ⇒ index 那版, 否則工作樹那版
# ============================================================

head20_of_file() { head -20 "$1" 2>/dev/null; }
head20_of_rev()  { git show "$1:$2" 2>/dev/null | head -20; }

# 🔴 這一個要與 `migration-new-file-static-checks.sh` 的 `no_regression` **選同一版**:
#    閘量的是 index 那版(有 staged 時), 訊息若講工作樹那版, 兩者可以相反而畫面看不出來。
head20_of_index_or_worktree() {
  if git diff --cached --name-only -- "$1" 2>/dev/null | grep -q .; then
    git show ":$1" 2>/dev/null | head -20
  else
    head -20 "$1" 2>/dev/null
  fi
}

# $1=檔頭文字 $2=key(帶值的 key 不含尾端冒號)
mark_present() {
  # 🔴 用 `grep -E`:BRE 的 `\(…\|…\)` 在 BSD grep 上對「行尾空群組」不可靠 —— 實測
  #    `-- pcm:never-apply` 回不命中 ⇒ **一個無值 key 的偵測整個失效, 而它靜默。**
  #    抓到它的是本檔自己的 selftest 那一格。
  printf '%s\n' "$1" | grep -Eq "^--[[:space:]]*pcm:$2([[:space:]]*$|:)"
}

# $1=檔頭文字 $2=key → 印出值(白名單過濾後);沒有或值空 ⇒ 印空
mark_value() {
  printf '%s\n' "$1" \
    | sed -n "s/^--[[:space:]]*pcm:$2:[[:space:]]*//p" \
    | head -1 \
    | LC_ALL=C tr -cd 'A-Za-z0-9_., "-' \
    | sed 's/[[:space:]]*$//'
}

# 便利式:$1=檔頭文字 $2=key $3=檔名(只用在訊息裡)
# rc 0 = 有合法標記(值印在 stdout);rc 1 = 沒有;rc 2 = 有字面而值是空的(已對 stderr 出聲)
mark_value_or_warn() {
  _mv=$(mark_value "$1" "$2")
  if [ -n "$_mv" ]; then printf '%s' "$_mv"; return 0; fi
  if mark_present "$1" "$2"; then
    printf '🔴 標記不完整:%s 的檔頭有 -- pcm:%s: 而【冒號後面是空的】⇒ 不算合法標記。\n' "${3:-該檔}" "$2" >&2
    return 2
  fi
  return 1
}

# ── selftest:兩個世界 + 文法邊界 ──────────────────────────────
# 🔴🔴 **`$0` 也要比** —— 本檔是被 `.` 進去的, 而**被 source 時 `$1` 是【母腳本的】參數**。
#    ⇒ 只看 `$1 = --selftest` 的話, 四支工具跑自己的 `--selftest` 時會**跑進這裡然後 `exit`**
#      ⇒ 📌 它們印的「通過 10 / 失敗 0」是**本檔的**格數, 而它們自己的格【一格都沒跑】。
#    🛑 實測就是這樣發生的:接線後三支工具同時印 `通過 10 / 失敗 0`(它們原本是 42 / 29 / 三個世界)。
#    ⇒ **一個借來的綠, 與自己的綠在畫面上一模一樣。**
case "$0" in
  *lib-migration-header-marks.sh) _MARKLIB_DIRECT=1 ;;
  *) _MARKLIB_DIRECT=0 ;;
esac
if [ "$_MARKLIB_DIRECT" = "1" ] && [ "${1:-}" = "--selftest" ]; then
  _p=0; _f=0
  _c() { # $1=標籤 $2=實得 $3=該得
    if [ "$2" = "$3" ]; then _p=$((_p+1)); printf '  ✅ %s\n' "$1"
    else _f=$((_f+1)); printf '  🔴 FAIL %s ⇒ 得到 [%s] 期望 [%s]\n' "$1" "$2" "$3"; fi
  }
  H1='-- pcm:ddl-into-vc: public.zz'
  H2='--  pcm:ddl-into-vc: public.zz'          # 兩個空白 —— 舊版兩把尺說沒有、兩把說有
  H3='--pcm:ddl-into-vc: public.zz'            # 零空白
  H4='-- pcm:ddl-into-vc:'                     # 值是空的
  H5='CREATE TABLE t (a int);'                 # 沒有標記
  H6='-- pcm:ddl-into-vc: public.zz'"$(printf '\033')"'[2Kevil'   # 控制字元注入
  # 🔴 期望值是 `public.zz2Kevil` 不是 `public.zz[2Kevil` —— ESC 與 `[` **都不在白名單**。
  #    ⛔ 我第一版把期望寫成保留 `[` ⇒ 那會逼我去放寬白名單來配合期望。
  #    📌 **期望值錯的時候, 要改的是期望值, 不是那道防線。**(R4 停止訊號的形狀)
  _c '一個空白 ⇒ 抽到值'        "$(mark_value "$H1" ddl-into-vc)" 'public.zz'
  _c '🔴 兩個空白 ⇒ 也要抽到(舊版四支尺在這裡分裂)' "$(mark_value "$H2" ddl-into-vc)" 'public.zz'
  _c '🔴 零空白 ⇒ 也要抽到'     "$(mark_value "$H3" ddl-into-vc)" 'public.zz'
  _c '值是空的 ⇒ 抽不到'        "$(mark_value "$H4" ddl-into-vc)" ''
  _c '🔵 沒有標記 ⇒ 抽不到(證明上面的綠不是恆綠)' "$(mark_value "$H5" ddl-into-vc)" ''
  _c '🔴 控制字元與 [ 都被剝掉(ESC 能重畫終端、蓋掉安全提示)' "$(mark_value "$H6" ddl-into-vc)" 'public.zz2Kevil'
  mark_present "$H4" ddl-into-vc && _c '值空但字面在 ⇒ mark_present 說有' yes yes || _c '值空但字面在 ⇒ mark_present 說有' no yes
  mark_present "$H5" ddl-into-vc && _c '🔵 沒標記 ⇒ mark_present 說沒有' yes no || _c '🔵 沒標記 ⇒ mark_present 說沒有' no no
  mark_present '-- pcm:never-apply' never-apply && _c '無值 key:never-apply 認得出' yes yes || _c '無值 key:never-apply 認得出' no yes
  mark_present '-- pcm:never-apply-until-B' never-apply && _c '🔵 never-apply-until-B 不得被當成 never-apply' yes no || _c '🔵 never-apply-until-B 不得被當成 never-apply' no no
  # 🔴 中段提到不算 —— 這一格由呼叫端的 head -20 保證, 這裡釘住那個責任歸屬:
  printf '  🔵 「中段提到不算」由呼叫端只餵前 20 行保證, 不在本檔 —— 見各呼叫端的 head20_of_*。\n'
  printf '\n通過 %s / 失敗 %s\n' "$_p" "$_f"
  [ "$_f" -eq 0 ]
  exit $?
fi
