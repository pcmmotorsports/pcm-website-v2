#!/usr/bin/env bash
# scripts/latest-definition-of.sh — 「這個 DB 物件的【最新一代】在哪,而【正在跑的】是哪一代」
#
# ══ 為什麼有這支(2026-08-30 夜,同一晚 n=4)═══════════════════════════════════
#   一支被改過很多次的 DB 物件,它的【最新一代在哪】**沒有任何東西會告訴你**。
#   而錯抄一代 ⇒ `CREATE OR REPLACE` 把後面幾代的行為**整個回捲**
#   ⇒ 🔴 **三綠不會紅、diff 上長得像一支正常的新 migration。**
#   當晚四個實例:
#     ① admin_cancel_order 三代(a8a1→a8a2→a8a3), 有人準備從【第一代】抄簽章(-e4 擋下)
#     ② 那把只找 `CREATE OR REPLACE` 的尺【漏掉 a8a2】—— 它用的是 DROP+CREATE
#     ③ pcm_order_refundable_remaining **五代全部已 apply**, 而需求交件引的是【第三代】
#     ④ -1c 的尺只認 `CREATE OR REPLACE` ⇒ 漏掉【裸 CREATE】那一代(第一次建的)
#        ⇒ 當場紅成「沒有任何一版已經 apply」。📌 **漏掉最早那一代的症狀太醒目,會被當成真發現。**
#   📌 ⇒ 所以本工具掃的是**四種形狀**(cor / 裸 create / drop / alter), 每一種都有自己的突變格。
#
# ══ 🔴 它自己的第一個坑(寫在最前面, 因為它會安靜)══════════════════════════
#   **【掃不到某種形狀】與【它真的只有一代】印同一個答案。**
#   ⇒ 所以 `--selftest` 帶三發**突變**(拿掉一種形狀 ⇒ 筆數必須變少)。
#   ⇒ 突變不過 = 字集沒有真的在承重 ⇒ 這支工具的結論全部不算數。
#
# ══ 🔴🔴 而【射程那一節本身也要有突變格】(-48 2026-08-30 立, 而它是量出來的)═══
#   R1 抓到的最貴一條:射程節原本逐字寫「動態 SQL 照樣會被算進來」,
#   而當時 `DROP/ALTER/CREATE` 三個都錨了行首 ⇒ **那句話對四分之三的形狀是假的**(鐵則 11)。
#   📌 **一句寫在「射程」那一節裡的話, 是最不會被人回頭驗的那一種** ——
#      因為它讀起來像作者在自我克制, 而**自我克制的句子天生帶著誠實的外觀**;
#      而它一旦錯, 錯的方向是**把工具說得比實際寬** ⇒ 下一個人會以為它蓋到了。
#   ⇒ **操作化:射程節每宣稱一件事, 就要有一格自檢在演它。**
#      現行對應:`⑩` 演「動態 SQL 抓得到」· `⑪` 演「`… ON tbl` 不算 tbl 的一代」
#      · `⑬` 演「帳本欄印得出兩種值」。**新增射程句時, 同一輪要新增它的格。**
#
# ══ 🔴 `newest` 與 `live` 是兩個答案(-1c 2026-08-30;R2 Important-2 同指)══════
#   `newest` = repo 裡最後一代 / `live` = **帳本上**最後一支已記的。
#   兩者不同 ⇒ 正式庫很可能還在跑舊的 ⇒ **本工具會自己說出來, 不讓讀的人去比欄位。**
#   🛑 而 `live` 答的是【帳本】**不是正式庫** —— 「帳上寫著 apply 了」與
#      「正式庫裡那支函式真的是那一版」**是兩個宣稱**(正本 `:5818`「帳本有那一列 ≠ 那件事被觀察過」)。
#
# ══ 審查紀錄 ════════════════════════════════════════════════════════════════
#   R1 (code-reviewer) FAIL:5 must-fix(錨不一致/other 靜靜丟掉/$NAME 未跳脫/ON 誤中/無 trap)+ 5 nit ⇒ 全修
#   R2 (code-reviewer) PASS:2 Important + 6 Minor ⇒ 全修,修法逐條記在下面各處
#     · Imp-1 `-d "$MIG"` 檢查在 dispatch 之【後】⇒ `--raw` 在沒有 migrations 的樹上 rc=0 零輸出
#              (成因是量到的:BSD grep 對不存在的 `-r` 目標回 **rc=1** 不是 2 ⇒ `-gt 1` 不觸發)
#     · Imp-2 `APPLIED.tsv` 不存在 ⇒ 整欄印「未記」而零警告(= 本檔自己點名的那個形狀)
#     · Min-1 錯字面「grep rc=N」印的其實是 raw_scan 的回傳值 · Min-2 other 桶全樹實測 0(原註寫 43)
#     · Min-3 `${LASTVER}` 比對漏 TAB · Min-4 case 樣式是 glob 不是字面 · Min-5 ⑬ 紅字賴錯對象
#     · Min-6 `ALTER … DROP CONSTRAINT` 被標成 drop(順序)· Min-7 死碼 · Min-8 最新一代是 DROP 時不該叫人抄
#
# 用法:  bash scripts/latest-definition-of.sh <物件名>
#        bash scripts/latest-definition-of.sh --selftest
#        (內部:--count <名> / --raw <名>,給 selftest 的突變用)
# rc:    0 找到 / 3 查無 / 2 用法錯 / 1 工具自壞   (對齊 greenlight.sh 那組三態)
set -u

RC_OK=0; RC_BROKEN=1; RC_USAGE=2; RC_NOTFOUND=3

REPO="$(cd "$(dirname "$0")/.." && pwd)"
MIG="$REPO/supabase/migrations"
APPLIED="$REPO/supabase/APPLIED.tsv"
TAB="$(printf '\t')"

TMPD="$(mktemp -d "${TMPDIR:-/tmp}/ldo.XXXXXXXX")" || {
  printf '🔴 工具自壞:mktemp -d 失敗\n' >&2; exit 1;
}
trap 'rm -rf "$TMPD"' EXIT INT TERM PIPE

SHAPES="${LDO_SHAPES:-cor,create,drop,alter}"

KINDS='MATERIALIZED[[:space:]]+VIEW|FUNCTION|PROCEDURE|VIEW|TABLE|TRIGGER|INDEX|POLICY|TYPE'
# 🔴 R1①:四種形狀一律【不錨行首】—— 動態 SQL(EXECUTE $x$CREATE …$x$)才進得來
VERBS="(CREATE|DROP|ALTER)[[:space:]]+(OR[[:space:]]+REPLACE[[:space:]]+)?(IF[[:space:]]+(NOT[[:space:]]+)?EXISTS[[:space:]]+)?($KINDS)"

usage() {
  {
    printf '用法: bash %s <物件名>\n' "$0"
    printf '      bash %s --selftest\n' "$0"
    printf '物件名只准 [A-Za-z0-9_](可帶一層 schema. 前綴)—— 這是刻意的:\n'
    printf '  含 regex 特殊字元的名字會讓比對過度匹配或整發報錯,而兩者都印出看起來正常的答案。\n'
    printf 'rc 的意思: 0=找到 / 3=查無 / 2=用法錯 / 1=工具自壞\n'
  } >&2
  exit "$RC_USAGE"
}

shape_on() { case ",$SHAPES," in *",$1,"*) return 0 ;; *) return 1 ;; esac; }

validate_name() {
  case "$1" in
    *[!A-Za-z0-9_.]*) return 1 ;;
    ""|.*|*.)         return 1 ;;
    *.*.*)            return 1 ;;
    *)                return 0 ;;
  esac
}

# 🔴 R2 Min-4:改成逐字元比對,不用 case 樣式(`'/*'` 在 case 裡是 glob ⇒
#    「第二個字元是空格」的碼行會被靜靜當成註解丟掉)。
is_comment_line() {
  local T C1 C2
  T="$(printf '%s' "$1" | sed 's/^[[:space:]]*//')"
  C1="$(printf '%s' "$T" | cut -c1)"
  C2="$(printf '%s' "$T" | cut -c2)"
  if [ "$C1" = "*" ]; then return 0; fi
  if [ "$C1" = "-" ] && [ "$C2" = "-" ]; then return 0; fi
  if [ "$C1" = "/" ] && [ "$C2" = "*" ]; then return 0; fi
  return 1
}

# 🔴 R2 Min-2/Min-7 的結構性修法:**一個掃描器、兩個消費者**。
#   原本 raw_scan 與 count_other 各自複製一份過濾條件 ⇒ 兩份要靠人維持一致。
#   現在 scan_all 產生含 `other` 的完整清單,raw_scan 與 count_other 都只是它的過濾。
#   ⇒ 「兩邊條件會不會漂」這個問題在結構上消失,不靠紀律。
scan_all() {
  local NAME BARE RC line FILE REST LNO TXT PREFIX SHAPE BASE VER
  NAME="$1"
  BARE="${NAME##*.}"
  grep -rniE --include='*.sql' -- "$VERBS" "$MIG" > "$TMPD/verbs" 2>/dev/null ; RC=$?
  if [ "$RC" -gt 1 ]; then return "$RC_BROKEN"; fi
  grep -iE "(^|[^A-Za-z0-9_])(public\.)?${BARE}([^A-Za-z0-9_]|\$)" "$TMPD/verbs" > "$TMPD/hits" 2>/dev/null ; RC=$?
  if [ "$RC" -gt 1 ]; then return "$RC_BROKEN"; fi
  while IFS= read -r line; do
    FILE="${line%%:*}"
    REST="${line#*:}"
    LNO="${REST%%:*}"
    TXT="${REST#*:}"
    is_comment_line "$TXT" && continue
    # 🔴 R1④:名字必須在 ` ON ` 之前 —— 否則 `CREATE INDEX … ON public.orders` 算成 orders 的一代
    PREFIX="$(printf '%s' "$TXT" | sed -E 's/[[:space:]][Oo][Nn][[:space:]].*$//')"
    printf '%s' "$PREFIX" | grep -qiE "(^|[^A-Za-z0-9_])(public\.)?${BARE}([^A-Za-z0-9_]|\$)" || continue
    # 🔴 R2 Min-6:ALTER 排在 DROP 之前 —— 否則 `ALTER … DROP CONSTRAINT` 被標成 drop
    SHAPE=other
    if   printf '%s' "$TXT" | grep -qiE 'CREATE[[:space:]]+OR[[:space:]]+REPLACE'; then SHAPE=cor
    elif printf '%s' "$TXT" | grep -qiE '(^|[^A-Za-z0-9_])ALTER[[:space:]]';       then SHAPE=alter
    elif printf '%s' "$TXT" | grep -qiE '(^|[^A-Za-z0-9_])DROP[[:space:]]';        then SHAPE=drop
    elif printf '%s' "$TXT" | grep -qiE '(^|[^A-Za-z0-9_])CREATE[[:space:]]';      then SHAPE=create
    fi
    BASE="$(basename "$FILE")"
    VER="${BASE%%_*}"
    printf '%s\t%s\t%s\t%s\t%s\n' "$VER" "$LNO" "$SHAPE" "$BASE" "$(printf '%s' "$TXT" | cut -c1-90)"
  done < "$TMPD/hits" | sort -t"$TAB" -k1,1 -k2,2n
  return "$RC_OK"
}

raw_scan() {
  local RC line SHAPE
  scan_all "$1" > "$TMPD/all" ; RC=$?
  if [ "$RC" -ne 0 ]; then return "$RC"; fi
  while IFS= read -r line; do
    SHAPE="$(printf '%s' "$line" | cut -f3)"
    shape_on "$SHAPE" && printf '%s\n' "$line"
  done < "$TMPD/all"
  return "$RC_OK"
}

count_other() {
  local RC
  scan_all "$1" > "$TMPD/all_o" ; RC=$?
  if [ "$RC" -ne 0 ]; then printf '0\n'; return "$RC"; fi
  cut -f3 "$TMPD/all_o" | grep -c '^other$'
  return "$RC_OK"
}

count_versions() {
  local RC
  raw_scan "$1" > "$TMPD/c" 2>/dev/null ; RC=$?
  if [ "$RC" -ne 0 ]; then printf 'ERR\n'; return "$RC"; fi
  cut -f1 "$TMPD/c" | sort -u | grep -c .
  return "$RC_OK"
}

print_scope() {
  cat <<'SCOPE'

🛑 本工具的射程(每次都印 —— 一個防「訊號沒帶分母」的工具,
   自己的輸出若沒帶,它就是下一件事故。**每一條下面都有一格自檢在演它**):
   · 🔴 它只看 **repo 裡的 supabase/migrations/*.sql** ⇒ **答不出「正式庫【現在】跑的是哪一代」**
     那要查 `pg_proc` / `pg_get_functiondef`,而那需要正式庫存取
   · 🔴 `live` 欄來自 `supabase/APPLIED.tsv` = **一本帳本** ⇒ 「帳上寫著 apply 了」與
     「正式庫裡那支函式真的是那一版」**是兩個宣稱**(自檢 ⑬ 演「這一欄印得出兩種值」)
   · 它只認【動詞與物件名同一行】的形狀 —— 名字被換行到下一行的寫法會被漏掉
   · 動詞**不錨行首** ⇒ 動態 SQL(`EXECUTE $x$CREATE …$x$`)也算得到(自檢 ⑩)
   · 註解行(`--` / `/*` / `*` 續行)會被跳過;而**同一行「碼 + 尾註解」裡的假 DDL 擋不掉**
   · 🔴 名字必須出現在該行 ` ON ` **之前** ⇒ `CREATE INDEX … ON public.orders`
     **不算** orders 的一代(自檢 ⑪);索引/trigger/policy 用**它自己的名字**查才找得到
   · 它不解析 schema:`public.foo` 與 `other_schema.foo` 對它是同一個
SCOPE
}

selftest() {
  FAIL=0
  printf '=== latest-definition-of --selftest(正/負/突變要印出不同的東西)===\n'

  # 🔴🔴 正對照斷言的是【那幾代在不在】+【至少幾代】,**不是恰好幾代** ——
  #   成因是量到的(2026-08-30 02:5x):本檔第一版寫 `admin_cancel_order == 3`,
  #   而它在寫完的幾分鐘內就紅了 —— 因為 `-e4` 當晚新增了第四代。
  #   📌 **一個把【筆數】寫死在活資料上的自檢,會為了一個【與工具好壞無關】的理由變紅** ——
  #      而那種紅比綠更貴:它訓練讀的人忽略自檢。
  #   ⇒ 代數只增不減 ⇒ 斷言「membership + 下界」是**單調**的,斷言「== N」不是。
  V1="$(count_versions pcm_order_refundable_remaining)"
  M1="$(raw_scan pcm_order_refundable_remaining | cut -f1 | sort -u | tr '\n' ' ')"
  OK1=1
  for want in 20260801120000 20260803150000 20260814190000 20260820010000 20260820100000; do
    case " $M1 " in *" $want "*) : ;; *) OK1=0 ;; esac
  done
  if [ "$OK1" = "1" ] && [ "$V1" -ge 5 ] 2>/dev/null; then
    printf '① 正對照A pcm_order_refundable_remaining ⇒ ✅ 已知五代全在,現共 %s 代\n' "$V1"
  else
    printf '① 正對照A pcm_order_refundable_remaining ⇒ 🔴 現共 %s 代,實得版本號 = %s\n' "$V1" "$M1"; FAIL=1
  fi

  V2="$(count_versions admin_cancel_order)"
  M2="$(raw_scan admin_cancel_order | cut -f1 | sort -u | tr '\n' ' ')"
  OK2=1
  for want in 20260804180000 20260805100000 20260820030000; do
    case " $M2 " in *" $want "*) : ;; *) OK2=0 ;; esac
  done
  if [ "$OK2" = "1" ] && [ "$V2" -ge 3 ] 2>/dev/null; then
    printf '② 正對照B admin_cancel_order(含 DROP+CREATE 那一代)⇒ ✅ 已知三代全在,現共 %s 代\n' "$V2"
  else
    printf '② 正對照B admin_cancel_order ⇒ 🔴 現共 %s 代,實得版本號 = %s\n' "$V2" "$M2"; FAIL=1
  fi

  N3="$(count_versions zzq6641_this_object_does_not_exist_20260830)"
  if [ "$N3" = "0" ]; then
    printf '③ 負對照 現造的不存在物件名 ⇒ ✅ 0 代(尺不亂報有)\n'
  else
    printf '③ 負對照 現造的不存在物件名 ⇒ 🔴 得 %s(期望 0)\n' "$N3"; FAIL=1
  fi

  N4="$(LDO_SHAPES=create,drop,alter bash "$0" --count pcm_order_refundable_remaining 2>/dev/null)"
  if [ -z "$N4" ] || [ "$N4" = "ERR" ]; then
    printf '④ 突變A 拿掉 cor ⇒ 🔴 子行程沒有回值(工具自壞,不是「沒變少」)\n'; FAIL=1
  elif [ "$N4" -lt "$V1" ] 2>/dev/null; then
    printf '④ 突變A 拿掉 cor ⇒ ✅ %s ⇒ %s(變少了 ⇒ cor 有在承重)\n' "$V1" "$N4"
  else
    printf '④ 突變A 拿掉 cor ⇒ 🔴 %s ⇒ %s(沒變少 ⇒ cor 沒在承重)\n' "$V1" "$N4"; FAIL=1
  fi

  D1="$(raw_scan admin_cancel_order | cut -f3 | grep -c '^drop$')"
  D2="$(LDO_SHAPES=cor,create,alter bash "$0" --raw admin_cancel_order 2>/dev/null | cut -f3 | grep -c '^drop$')"
  if [ "$D1" -gt 0 ] && [ "$D2" = "0" ]; then
    printf '⑤ 突變B 拿掉 drop ⇒ ✅ %s ⇒ %s(DROP 那一筆真的消失了)\n' "$D1" "$D2"
  else
    printf '⑤ 突變B 拿掉 drop ⇒ 🔴 %s ⇒ %s\n' "$D1" "$D2"; FAIL=1
  fi

  bash "$0" zzq6641_this_object_does_not_exist_20260830 > /dev/null 2>&1 ; R6=$?
  if [ "$R6" = "3" ]; then
    printf '⑥ 查無時 ⇒ ✅ rc=3(與「找到」的 0 分得開)\n'
  else
    printf '⑥ 查無時 ⇒ 🔴 rc=%s(期望 3)\n' "$R6"; FAIL=1
  fi

  bash "$0" > /dev/null 2>&1 ; R7=$?
  if [ "$R7" = "2" ]; then
    printf '⑦ 不給參數 ⇒ ✅ rc=2(與「查無」的 3 分得開)\n'
  else
    printf '⑦ 不給參數 ⇒ 🔴 rc=%s(期望 2)\n' "$R7"; FAIL=1
  fi

  bash "$0" 'admin_cancel_order(uuid' > /dev/null 2>&1 ; R8=$?
  if [ "$R8" = "2" ]; then
    printf '⑧ 名字含括號 ⇒ ✅ rc=2 用法錯(不是把 grep 的錯吞成「查無」)\n'
  else
    printf '⑧ 名字含括號 ⇒ 🔴 rc=%s(期望 2)\n' "$R8"; FAIL=1
  fi

  bash "$0" 'admin_cancel_.*' > /dev/null 2>&1 ; R9=$?
  if [ "$R9" = "2" ]; then
    printf '⑨ 名字含 regex 萬用字元 ⇒ ✅ rc=2(不是印出一張看起來正常的表)\n'
  else
    printf '⑨ 名字含 regex 萬用字元 ⇒ 🔴 rc=%s(期望 2)\n' "$R9"; FAIL=1
  fi

  bash "$0" idx_orders_display_id_trgm > /dev/null 2>&1 ; R10=$?
  if [ "$R10" = "0" ]; then
    printf '⑩ 射程句「動態 SQL 算得到」⇒ ✅ rc=0 真的抓得到\n'
  else
    printf '⑩ 射程句「動態 SQL 算得到」⇒ 🔴 rc=%s(期望 0;那句話是假的)\n' "$R10"; FAIL=1
  fi

  ONHIT="$(raw_scan orders | grep -c 'CREATE INDEX')"
  if [ "$ONHIT" = "0" ]; then
    printf '⑪ 射程句「… ON tbl 不算 tbl 的一代」⇒ ✅ CREATE INDEX … ON orders 被排掉\n'
  else
    printf '⑪ 射程句「… ON tbl 不算 tbl 的一代」⇒ 🔴 仍被算了 %s 筆\n' "$ONHIT"; FAIL=1
  fi

  V12="$(count_versions admin_create_manual_order)"
  N12="$(LDO_SHAPES=cor,drop,alter bash "$0" --count admin_create_manual_order 2>/dev/null)"
  if [ -z "$N12" ] || [ "$N12" = "ERR" ]; then
    printf '⑫ 突變C 拿掉裸 create ⇒ 🔴 子行程沒有回值(工具自壞)\n'; FAIL=1
  elif [ "$N12" -lt "$V12" ] 2>/dev/null; then
    printf '⑫ 突變C 拿掉裸 create ⇒ ✅ %s ⇒ %s(最早那一代消失了 ⇒ 裸 CREATE 有在承重)\n' "$V12" "$N12"
  else
    printf '⑫ 突變C 拿掉裸 create ⇒ 🔴 %s ⇒ %s(沒變少 ⇒ 裸 CREATE 沒在承重)\n' "$V12" "$N12"; FAIL=1
  fi

  # 🔴 R2 Min-5:先分開「帳本檔不在」與「這一欄沒有判別力」—— 原本兩者印同一句紅字
  if [ ! -f "$APPLIED" ]; then
    printf '⑬ 帳本欄兩種值 ⇒ 🔴 找不到 %s ⇒ 帳本欄整欄無效(這不是判別力問題)\n' "$APPLIED"; FAIL=1
  else
    L_YES="$(raw_scan admin_create_manual_order | cut -f1 | sort -u | while IFS= read -r v; do
               if grep -q "^${v}${TAB}" "$APPLIED"; then printf 'y\n'; fi
             done | grep -c .)"
    L_NO="$(raw_scan admin_create_manual_order | cut -f1 | sort -u | while IFS= read -r v; do
              if grep -q "^${v}${TAB}" "$APPLIED"; then :; else printf 'n\n'; fi
            done | grep -c .)"
    if [ "$L_YES" -gt 0 ] && [ "$L_NO" -gt 0 ] 2>/dev/null; then
      printf '⑬ 射程句「帳本欄印得出兩種值」⇒ ✅ 已記 %s 代 / 未記 %s 代\n' "$L_YES" "$L_NO"
    else
      printf '⑬ 射程句「帳本欄印得出兩種值」⇒ 🔴 已記 %s / 未記 %s ⇒ 本樣本上沒有判別力\n' "$L_YES" "$L_NO"; FAIL=1
    fi
  fi

  # 🔴 R2 Imp-1 的回歸格:在一棵沒有 migrations 的樹上,--raw 必須 rc=1 而不是 rc=0 零輸出
  #   (成因量到的:BSD grep 對不存在的 -r 目標回 rc=1 不是 2 ⇒ 舊版 `-gt 1` 不觸發)
  FAKE="$TMPD/faketree"
  mkdir -p "$FAKE/scripts"
  cp "$0" "$FAKE/scripts/ldo.sh"
  bash "$FAKE/scripts/ldo.sh" --raw admin_cancel_order > /dev/null 2>&1 ; R14=$?
  if [ "$R14" = "1" ]; then
    printf '⑭ 沒有 migrations 的樹 ⇒ ✅ rc=1 工具自壞(不是 rc=0 零輸出)\n'
  else
    printf '⑭ 沒有 migrations 的樹 ⇒ 🔴 rc=%s(期望 1;「掃不到」正在印成「沒有」)\n' "$R14"; FAIL=1
  fi

  if [ "$FAIL" = "0" ]; then
    printf '\n⇒ 自檢 PASS(十四格;正/負/三發突變/射程句四條各有自己的格)\n'
    return "$RC_OK"
  fi
  printf '\n⇒ 🔴 自檢 FAIL ⇒ 本工具的結論全部不算數\n'
  return "$RC_BROKEN"
}

# 🔴 R2 Imp-1:`-d "$MIG"` 檢查必須在 dispatch 【之前】——
#   否則 `--raw` / `--count` 在沒有 migrations 的樹上會 rc=0 零輸出,
#   而「掃不到」與「真的沒有」印同一個字。
if [ "$#" -eq 1 ] && [ "$1" = "--selftest" ]; then
  :
elif [ ! -d "$MIG" ]; then
  printf '🔴 工具自壞:找不到 %s\n' "$MIG" >&2
  exit "$RC_BROKEN"
fi

if [ "$#" -eq 1 ]; then
  case "$1" in
    --selftest) selftest; exit $? ;;
    -h|--help)  usage ;;
    --*)        usage ;;
  esac
elif [ "$#" -eq 2 ]; then
  case "$1" in
    --count) validate_name "$2" || usage; count_versions "$2"; exit $? ;;
    --raw)   validate_name "$2" || usage; raw_scan "$2";       exit $? ;;
    *)       usage ;;
  esac
else
  usage
fi

NAME="$1"
validate_name "$NAME" || usage

raw_scan "$NAME" > "$TMPD/out" ; RC=$?
if [ "$RC" -ne 0 ]; then
  # 🔴 R2 Min-1:原本印「grep rc=N」而那個 N 是 raw_scan 的回傳值,不是 grep 的
  #   ⇒ 去查手冊的人會查到「grep rc=1 = 零命中」而找錯方向。
  printf '🔴 工具自壞:掃描階段失敗(不是零命中)。先跑 --selftest\n' >&2
  exit "$RC_BROKEN"
fi

OTHER="$(count_other "$NAME")"

# 🔴 R2 Imp-2:帳本檔不在 ⇒ 要出聲。否則整欄印「未記」而看起來像「什麼都沒 apply」——
#   而本檔自己就寫著:那個結論太醒目,會被當成真的發現。
LEDGER_OK=1
if [ ! -f "$APPLIED" ]; then
  LEDGER_OK=0
  printf '⚠️ 找不到 %s ⇒ **帳本欄整欄無效**(下面每一列的「未記」都不算數)\n\n' "$APPLIED"
fi

HITS="$(grep -c . "$TMPD/out")"
if [ "$HITS" = "0" ]; then
  printf '查無:`%s` 在 supabase/migrations 裡沒有任何 CREATE/DROP/ALTER 定義點(掃描字集 = %s)\n' "$NAME" "$SHAPES"
  printf '⚠️ 而【掃不到某種形狀】與【它真的不存在】印同一個答案 ⇒ 先跑一次 --selftest\n'
  if [ "$OTHER" != "0" ]; then
    printf '⚠️ 另有 %s 筆命中 DDL 而【分不出形狀】—— 它們沒有進上面的結論\n' "$OTHER"
  fi
  print_scope
  exit "$RC_NOTFOUND"
fi

printf '=== `%s` 的每一代(依版本號排序;掃描字集 = %s)===\n\n' "$NAME" "$SHAPES"
printf '%-16s %-6s %-7s %-6s %s\n' 版本號 行號 形狀 帳本 檔名
while IFS="$TAB" read -r VER LNO SHAPE BASE TXT; do
  LEDGER=未記
  if [ "$LEDGER_OK" = "1" ] && grep -q "^${VER}${TAB}" "$APPLIED"; then LEDGER=已記; fi
  printf '%-16s %-6s %-7s %-6s %s\n' "$VER" "$LNO" "$SHAPE" "$LEDGER" "$BASE"
done < "$TMPD/out"

NEWEST="$(cut -f1 "$TMPD/out" | sort -u | tail -1)"
NVER="$(cut -f1 "$TMPD/out" | sort -u | grep -c .)"

LIVE=""
if [ "$LEDGER_OK" = "1" ]; then
  LIVE="$(cut -f1 "$TMPD/out" | sort -u | while IFS= read -r v; do
            if grep -q "^${v}${TAB}" "$APPLIED"; then printf '%s\n' "$v"; fi
          done | tail -1)"
fi

printf '\n'
printf 'newest = %s   (repo 裡最後一代;共 %s 代 / %s 個定義點)\n' "$NEWEST" "$NVER" "$HITS"
if [ "$LEDGER_OK" = "0" ]; then
  printf 'live   = 未知   ⇒ 帳本檔不在,這一格答不出來\n'
elif [ -z "$LIVE" ]; then
  printf 'live   = 查無   ⇒ 🔴 **帳本上沒有任何一代被記過** —— 正式庫可能一代都沒套\n'
else
  printf 'live   = %s   (帳本上最後一支已記的)\n' "$LIVE"
fi
printf '🛑 而 `live` 答的是【帳本 supabase/APPLIED.tsv】,**不是正式庫** ——\n'
printf '   「帳上寫著 apply 了」與「正式庫裡那支真的是那一版」是兩個宣稱。\n'

if [ "$LEDGER_OK" = "1" ] && [ -n "$LIVE" ] && [ "$LIVE" != "$NEWEST" ]; then
  printf '\n🔴🔴 **newest ≠ live** —— repo 最新的是 %s,而帳本上最後一支已記的是 %s\n' "$NEWEST" "$LIVE"
  printf '   ⇒ **正式庫很可能還在跑舊的那一代。**改它之前先確認要對哪一份下手。\n'
fi

# 🔴 R2 Min-3:比對加 TAB(版本號長度一旦不是 14 位就會多印別代的行)
# 🔴 R2 Min-8:最新一代是 DROP 時,不該叫人「從這一份抄簽章」
NEWSHAPE="$(grep "^${NEWEST}${TAB}" "$TMPD/out" | cut -f3 | tail -1)"
if [ "$NEWSHAPE" = "drop" ]; then
  printf '\n⚠️ 最新一代的形狀是 **DROP** ⇒ 這個物件最後一個動作是【被刪掉】,\n'
  printf '   **不要從它抄簽章** —— 要抄的話往上找最後一個 create/cor。\n'
else
  printf '\n🔴 要抄簽章 / 要寫 CREATE OR REPLACE ⇒ 從 **%s** 抄,不要從第一筆。\n' "$NEWEST"
fi
grep "^${NEWEST}${TAB}" "$TMPD/out" | while IFS="$TAB" read -r V L S B T; do
  printf '   ⇒ %s:%s  %s\n' "$B" "$L" "$T"
done

if [ "$OTHER" != "0" ]; then
  printf '\n⚠️ **另有 %s 筆命中 DDL 而分不出形狀** —— 它們【沒有】被算進上面那 %s 代。\n' "$OTHER" "$NVER"
  printf '   ⇒ 這一行存在的理由:原本它們被靜靜丟掉,而「丟掉」與「不存在」印同一個答案。\n'
fi
print_scope
exit "$RC_OK"
