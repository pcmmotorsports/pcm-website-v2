#!/usr/bin/env bash
# claim-backlog-number.sh — 發 backlog 號之前，先【原子性佔住】它
#
# ══ 存在理由(2026-08-18 實錘，而且病因不是「忘了跑檢查」)═══════════════════════
# G2 發 `#644` 時**兩道既有檢查都跑了**:
#     bash scripts/next-backlog-number.sh                  ⇒ 回「下一個可用號 = #644」
#     grep -rn '佔位\|RESERVED #6' ~/pcm-mailbox/*.md      ⇒ 只有 #631 #636，不撞
# **而還是撞了** —— G5 在同一段時間也拿了 `#644`，兩條同號，merge 才發現。
#
# 🔴 **成因**:那兩道看的都是【已經落檔的東西】，看不到另一個窗【正在寫】的號。
#    ⇒ `next-backlog-number.sh` 給的是**下限**，不是**保留鎖**(它自己的輸出也這樣寫)。
#    ⇒ 「查號」與「條目落檔」之間那段時間，就是縫。
#
# 🔴🔴 **判別句(這才是本片要傳的東西，不是這支腳本)**:
#    · 這道檢查看的是【已經發生的事】還是【正在發生的事】?
#    · 如果兩個窗同時做這件事，會不會【兩個都通過】? 會 ⇒ **它擋不住併發**。
#    ⇒ 擋併發要靠**原子操作**。`mkdir` 是原子的:同一個目錄名，只有一個人建得起來。
#
# ══ 用法 ═══════════════════════════════════════════════════════════════════
#    bash scripts/claim-backlog-number.sh            # 佔住「下一個可用號」
#    bash scripts/claim-backlog-number.sh --release 646   # 條目落檔之後，把 claim 清掉
#    bash scripts/claim-backlog-number.sh --dry-run  # 只印①②(下一號 + 信箱佔位),【不佔號】(#830)
#    bash scripts/claim-backlog-number.sh --audit    # 掃 backlog:重號 / 格式變體 / 跳號(掛 lint-staged 在 backlog 檔上)
#    bash scripts/claim-backlog-number.sh --selftest # 本檔的證人(掛 lint-staged)
#
# ══ 2026-08-23 b8(#829 / #830)
#    #829 ② 信箱佔位掃描兩個寫死的 `6`(選行 'RESERVED #6' + 抽號 '#6[0-9][0-9]')⇒ 對現行 8xx 號段
#         【結構上不可能命中】而照樣印一行「信裡出現過的號:(無)」。修:號段通用 + **掃描器自檢** ——
#         每次跑先驗信箱目錄在、有 *.md,再餵一行合成的「RESERVED #<NEXT> 佔位」給同一條管線,
#         任一不成立 ⇒ exit 2「量具壞/缺席」,不是「乾淨」。
#         🔴 而「通用化」第一版把選行放寬到「同一行有佔位+數字」⇒ 連本工具自己交件裡的引號都被當宣告,
#            真 --dry-run rc=1 被自己擋住(code-reviewer R1 must-fix 3)—— 假零換成假命中,一樣不能用。
#         ⇒ 定案:只有【契約形狀】行首 `RESERVED #NNN` 會擋;散文命中只印「參考、不擋」。這條契約寫在這裡就是規矩:
#            **要用號碼佔位,請在信裡獨立一行寫 `RESERVED #NNN`;其他寫法工具只會提醒,不會替你擋。**
#    #830 想看它印什麼得付一個號 ⇒ --dry-run。
#    --audit 同日實錘:58 與 b8 各自 grep 到最大號 857、各自 append ⇒ 檔裡兩顆 ### #857,**沒有任何機制抓到**,
#         是 58 事後回頭數才發現 ⇒ --audit 掛在 backlog 檔的 lint-staged 上,commit 前掃重號。
#         🔴 誠實:它抓的是【事後】檔裡有重複(commit 前),**抓不到【同時】兩個人 append** ——
#            防寫壞的只有 mkdir 那道,而那道要【兩個人都用這支腳本】才成立;58 那次兩邊都沒用。
#
# ══ 🔴 天花板(它擋得住什麼、擋不住什麼)═══════════════════════════════════════
#    ✅ 擋得住  兩個窗【同時】發號 —— 慢的那個會拿不到，rc≠0
#    ❌ 擋不住  有人**不用這支腳本**、直接把條目寫進 backlog
#               ⇒ 這是【協定】不是【強制】。沒有做成 hook 去攔是刻意的:
#                  在沒有事的路上裝機制，機制本身是新的風險
#    ❌ 擋不住  跨機器(claim 目錄在本機 ~/pcm-mailbox，六窗共用同一台才有效)
#    ⚠️ 副作用  claim 沒清掉 ⇒ **那個號會一直被卡住**
#               ⇒ 手動解:`bash scripts/claim-backlog-number.sh --release <N>`
#                        或直接 `rmdir ~/pcm-mailbox/.backlog-claim-<N>`
#               ⇒ 而清之前先看一眼裡面的 `who` —— 那個人可能還在寫
#
# ══ 這支腳本【不取代】既有那兩道 ══════════════════════════════════════════
#    它自己會先跑 `next-backlog-number.sh`(那三層最大值仍然是判斷的依據)。
#    兩道舊檢查擋的是**疏忽**，這一道擋的是**併發** —— 三道各擋各的，不是誰取代誰。
set -uo pipefail
cd "$(dirname "$0")/.."

CLAIM_ROOT="${BACKLOG_CLAIM_ROOT:-$HOME/pcm-mailbox}"
BACKLOG_FILE="${BACKLOG_FILE:-docs/phase-1-backlog.md}"

# ── 共用:信箱佔位掃描 ────────────────────────────────────────────────
# 🔴 信箱裡「真的宣告」沒有一致的機器形狀(實查 25 行:`#489` 佔位 / `#498` 是佔位號 / 三個號都標佔位 /
#    也有大量純散文)⇒ 散文掃描天生沒辦法同時【靈敏】又【精確】(code-reviewer R1 must-fix 3:
#    選行寬到「同一行有佔位+數字」⇒ 連本工具自己的交件引號都被當宣告,真 --dry-run rc=1 被自己擋住)。
# ⇒ 兩層分開:
#    【契約形狀】行首 `RESERVED #NNN`(可前綴空白/`-`/`·`)⇒ 這是唯一會【擋下發號】的宣告,寫在這裡就是規矩;
#    【散文命中】同一行有「佔位|RESERVED」+ #3~4 位數 ⇒ 只印「參考,不擋」,讓人去看。
#    (假零讓你看不見;假命中讓你不能用 —— 兩者都壞。契約形狀是唯一能同時避開兩者的路。)
SCAN_IMPL="${SCAN_IMPL:-real}"   # selftest 用來做自檢的負對照(=dead 時掃描器回空)
scan_declared() { # $1=信箱目錄 → 行首契約形狀宣告的號(空白分隔)
  [ "$SCAN_IMPL" = "real" ] || return 0
  grep -rhoE '^[[:space:]]*[-·•]?[[:space:]]*RESERVED[[:space:]]+#[0-9]{3,4}' "$1"/*.md 2>/dev/null | grep -oE '#[0-9]{3,4}' | sort -u | tr '\n' ' '
}
scan_prose() { # $1=信箱目錄 → 散文命中的號(參考)
  grep -rhE '(佔位|RESERVED)' "$1"/*.md 2>/dev/null | grep -oE '#[0-9]{3,4}' | sort -u | tr '\n' ' '
}
# 🔴 掃描器自檢(code-reviewer R1 must-fix 1 補強):①信箱目錄要在、要有 *.md —— 不在 = 量具缺席,不是「乾淨」;
#    ②餵一行契約形狀的合成句給同一條管線,撈不到 ⇒ 量具壞了。回 0=活著、2=壞/缺席。
scan_selfcheck() { # $1=自檢用的號  $2=信箱目錄
  local _t _h _n
  [ -d "$2" ] || { echo "🔴 信箱目錄不存在:$2 ⇒ 量具缺席,不是乾淨" >&2; return 2; }
  _n=$(ls "$2"/*.md 2>/dev/null | wc -l | tr -d ' ')
  [ "$_n" -gt 0 ] || { echo "🔴 $2 裡零支 *.md ⇒ 分母是空的,不是乾淨" >&2; return 2; }
  _t=$(mktemp -d) || return 2
  printf 'RESERVED #%s 佔位(自檢合成句,不是真宣告)\n' "$1" > "$_t/probe.md"
  _h=$(scan_declared "$_t"); rm -rf "$_t"
  case " $_h " in *" #$1 "*) return 0;; *) echo "🔴 掃描器自檢失敗:餵一行『RESERVED #$1 佔位』它撈不到 ⇒ 量具壞了" >&2; return 2;; esac
}

# ── 共用:backlog 稽核(重號 / 格式變體 / 跳號)。回 0 乾淨、1 有新重號、2 量具壞 ──────
# 已認列的歷史重號以【號:顆數】為鍵(code-reviewer nit 5:只記號碼 ⇒ 第三顆 641 也綠):
#   #835 逐條開檔核過:641/672/676 各 2 顆真重號;220 是 #220./#220b/#220c 三顆(變體被 ^### #N 數成同號)。
# ⇒ 顆數【超過】認列值才紅 ⇒ 一裝就綠、新撞號才紅(一道長期紅著的閘訓練人略過整張清單)。
AUDIT_KNOWN_DUPES="${AUDIT_KNOWN_DUPES:-220:3 641:2 672:2 676:2}"
audit_backlog() { # $1=backlog 檔
  local _nums _total _counts _new _shapes _gaps _lead _n _c _known
  [ -f "$1" ] || { echo "🔴 找不到 $1 ⇒ 量具缺席" >&2; return 2; }
  # 🔴 行首帶空白的 `  ### #N` 也算一條(nit 9:縮排的撞號原版不紅)
  _nums=$(grep -oE '^[[:space:]]*### #[0-9]+' "$1" | grep -oE '[0-9]+')
  _total=$(printf '%s\n' "$_nums" | grep -c . || true)
  [ "$_total" -gt 0 ] || { echo "🔴 $1 裡一條 '### #N' 都沒有 ⇒ 尺對不上檔,不是乾淨" >&2; return 2; }
  _counts=$(printf '%s\n' "$_nums" | sort -n | uniq -c | awk '$1>1 {printf "%s:%s ", $2, $1}')
  _new=""
  for _c in $_counts; do
    _n=${_c%%:*}; _known=""
    for k in $AUDIT_KNOWN_DUPES; do [ "${k%%:*}" = "$_n" ] && _known=${k#*:}; done
    if [ -z "$_known" ] || [ "${_c#*:}" -gt "$_known" ]; then _new="$_new $_c"; fi
  done
  # 標題形狀:數字後第一個字元(行尾另成一桶;nit 7)+ 行首縮排另計
  _shapes=$(grep -oE '^[[:space:]]*### #[0-9]+.?' "$1" | sed -E 's/^[[:space:]]+/IND:/; s/[0-9]+//' | awk '{ if ($0 ~ /#$/) print $0 "<EOL>"; else print }' | sort | uniq -c | tr -s ' ' | tr '\n' ';')
  _lead=$(grep -cE '^[[:space:]]+### #[0-9]+' "$1" || true)
  _gaps=$(printf '%s\n' "$_nums" | sort -n | uniq | awk 'NR>1 && $1>p+1 {g++} {p=$1} END{print g+0}')
  if [ -z "$_new" ]; then
    echo "── backlog 稽核:$1 ── 條目 $_total / 重號 ${_counts:-（無）}⇒ 全部已認列(AUDIT_KNOWN_DUPES)/ 縮排標題 $_lead / 跳號段 $_gaps(只報不判)/ 標題形狀 $_shapes"
    return 0
  fi
  echo "── backlog 稽核:$1 ── 條目 $_total / 重號 ${_counts} / 縮排標題 $_lead / 跳號段 $_gaps / 標題形狀 $_shapes"
  echo "🔴 新的重號(號:顆數):$_new —— 兩個窗各自 grep 到同一個最大號、各自 append(2026-08-23 #857 實錘)。" >&2
  echo "   處置:後落地的那顆改號(讓號給先的),不要動對方的條目;已認列的歷史重號在 AUDIT_KNOWN_DUPES(號:顆數)。" >&2
  return 1
}

# ── --audit / --selftest / --dry-run ──────────────────────────────────
if [ "${1:-}" = "--audit" ]; then
  audit_backlog "$BACKLOG_FILE"; exit $?
fi
if [ "${1:-}" = "--selftest" ]; then
  fail=0; n=0
  ck() { n=$((n+1)); if [ "$2" = "$3" ]; then echo "  PASS $1"; else echo "  🔴 FAIL $1 —— 得 $2 該 $3"; fail=1; fi; }
  T=$(mktemp -d) || exit 2; trap 'rm -rf "$T"' EXIT
  mkdir -p "$T/mb" && printf 'RESERVED #857 佔位\n' > "$T/mb/a.md" && printf '交件引號裡提到「RESERVED #859 佔位」這個形狀,不是宣告\n' > "$T/mb/b.md"
  ck "契約掃描:行首 RESERVED #857 ⇒ 撈到 #857(原版對 8xx 結構上不可能命中)" "$(scan_declared "$T/mb" | tr -d ' ')" "#857"
  ck "契約掃描:散文/引號裡的同形狀 ⇒ 不算宣告(must-fix 3 那格:工具被自己的交件擋住)" "$(printf 'x\n' > "$T/mb/a.md"; scan_declared "$T/mb" | tr -d ' ')" ""
  ck "散文掃描:同一行仍撈得到 #859 當參考(印、不擋)" "$(scan_prose "$T/mb" | tr -d ' ')" "#859"
  scan_selfcheck 999 "$T/mb" >/dev/null 2>&1; ck "掃描器自檢:活著 ⇒ 0" "$?" "0"
  scan_selfcheck 999 "$T/nope" >/dev/null 2>&1; ck "掃描器自檢:信箱目錄不存在 ⇒ 2(量具缺席≠乾淨;must-fix 1)" "$?" "2"
  mkdir -p "$T/mb0"; scan_selfcheck 999 "$T/mb0" >/dev/null 2>&1; ck "掃描器自檢:目錄在但零 *.md ⇒ 2" "$?" "2"
  SCAN_IMPL=dead scan_selfcheck 999 "$T/mb" >/dev/null 2>&1; ck "掃描器自檢負對照:掃描器死掉 ⇒ 2(nit 6:自檢不能恆真)" "$?" "2"
  printf '### #856. a\n\n### #857. b\n' > "$T/clean.md"
  audit_backlog "$T/clean.md" >/dev/null 2>&1; ck "稽核:乾淨 ⇒ 0" "$?" "0"
  printf '### #856. a\n\n### #857. 窗一\n\n### #857. 窗二\n' > "$T/dup.md"
  audit_backlog "$T/dup.md" >/dev/null 2>&1; ck "稽核:兩顆 ### #857 ⇒ 1(今晚那次撞號的形狀)" "$?" "1"
  printf '### #856. a\n\n  ### #857. 縮排的撞號\n\n### #857. b\n' > "$T/lead.md"
  audit_backlog "$T/lead.md" >/dev/null 2>&1; ck "稽核:行首帶空白的撞號 ⇒ 1(nit 9)" "$?" "1"
  printf '### #641. a\n\n### #641. b\n' > "$T/known.md"
  audit_backlog "$T/known.md" >/dev/null 2>&1; ck "稽核:已認列 641 兩顆 ⇒ 0(一裝就綠)" "$?" "0"
  printf '### #641. a\n\n### #641. b\n\n### #641. c\n' > "$T/third.md"
  audit_backlog "$T/third.md" >/dev/null 2>&1; ck "稽核:641 第三顆 ⇒ 1(nit 5:白名單以顆數為鍵)" "$?" "1"
  printf 'no headings here\n' > "$T/empty.md"
  audit_backlog "$T/empty.md" >/dev/null 2>&1; ck "稽核:零條目 ⇒ 2(尺對不上檔≠乾淨)" "$?" "2"
  echo "  ── claim-backlog-number --selftest: $n 格, fail=$fail"
  [ "$n" = "13" ] || { echo "  🔴 格數 $n ≠ 13 ⇒ 有格沒跑到"; exit 1; }
  exit "$fail"
fi
DRY=0; if [ "${1:-}" = "--dry-run" ]; then DRY=1; fi

# ── --release：條目落檔之後清掉 ────────────────────────────────────────────
if [ "${1:-}" = "--release" ]; then
  N="${2:-}"
  if [ -z "$N" ]; then echo "用法: bash $0 --release <號碼>" >&2; exit 2; fi
  D="$CLAIM_ROOT/.backlog-claim-$N"
  if [ ! -d "$D" ]; then
    echo "⚠️  #$N 沒有 claim 目錄($D)—— 可能已經清過了，或當初就沒佔。"
    exit 0
  fi
  echo "── 清掉之前先看一眼它是誰的 ──"
  cat "$D/who" 2>/dev/null || echo "  (沒有 who 檔)"
  rm -rf "$D"
  if [ -d "$D" ]; then echo "🔴 刪不掉:$D" >&2; exit 1; fi
  echo "✅ 已釋放 #$N"
  exit 0
fi

echo "── ① 先跑既有那道(三層最大值。它擋疏忽，不擋併發)────────────────"
OUT="$(bash scripts/next-backlog-number.sh 2>&1)" || true
echo "$OUT" | sed -n '/三層各自的最大號/,/下一個可用號/p'

# 🔴 嚴格取號:取不到就【大聲失敗】，不要靜默給一個預設值
NEXT="$(printf '%s\n' "$OUT" | sed -n 's/.*下一個可用號 = #\([0-9][0-9]*\).*/\1/p' | head -1)"
if [ -z "$NEXT" ]; then
  echo "🔴 解析不出號碼 —— next-backlog-number.sh 的輸出格式可能改了。" >&2
  echo "   本腳本刻意【不猜】:寧可停下，也不要佔一個算錯的號。" >&2
  exit 1
fi

echo
echo "── ② 信箱佔位掃描(既有那道)──────────────────────────────────────"
# 🔴 先讓掃描器表演一次該紅的(目錄在、有檔、餵合成句撈得到);任一不成立 ⇒ 2,印什麼都不算數
#    (#829 那格的病:死尺印健康行;must-fix 1:目錄不存在也曾印「自檢 ✅」)。
scan_selfcheck "$NEXT" "$CLAIM_ROOT" || exit 2
DECL="$(scan_declared "$CLAIM_ROOT")"
PROSE="$(scan_prose "$CLAIM_ROOT")"
echo "  契約宣告(行首 RESERVED #NNN,會擋):${DECL:-（無）}"
echo "  散文提到(同一行含「佔位|RESERVED」+ #號,只供參考、不擋):${PROSE:-（無）}"
echo "  (掃描器自檢 ✅;分母=$CLAIM_ROOT/*.md 共 $(ls "$CLAIM_ROOT"/*.md 2>/dev/null | wc -l | tr -d ' ') 支)"
case " $DECL " in *" #$NEXT "*)
  echo "  🔴 #$NEXT 有人用契約形狀宣告了 ⇒ 停下，先去看那封信(grep -rn 'RESERVED #$NEXT' $CLAIM_ROOT)。" >&2; exit 1;;
esac
case " $PROSE " in *" #$NEXT "*)
  echo "  ⚠️ #$NEXT 在某封信的散文裡出現過 —— 不擋,但發之前開一眼:grep -rn '#$NEXT' $CLAIM_ROOT/*.md";;
esac
if [ "$DRY" = "1" ]; then
  echo
  echo "── (--dry-run)未佔號。要佔:去掉 --dry-run 再跑 ──"
  exit 0
fi

echo
echo "── ③ 🔴 原子性佔住(mkdir。這一道才擋得住併發)──────────────────"
D="$CLAIM_ROOT/.backlog-claim-$NEXT"
# 🔴 `mkdir` 不加 -p:目錄已存在時它會**失敗**，而那個失敗就是「別人先佔了」。
#    加了 -p 會靜默成功 ⇒ 整支腳本的判別力歸零。
if ! mkdir "$D" 2>/dev/null; then
  echo "🔴 #$NEXT 佔不到 —— 已經有人佔著。" >&2
  echo "   claim: $D" >&2
  echo "   ── 它是誰的 ──" >&2
  # 🔴 這裡本來寫 `cat "$D/who" 2>/dev/null >&2` —— **重導向順序把內容吃掉了**:
  #    先 `2>/dev/null` 把 stderr 丟掉，再 `>&2` 把 stdout 導去(已經是 /dev/null 的)stderr
  #    ⇒ who 檔明明在，而這一段【什麼都沒印】。
  #    ⚠️ 那個 bug 只有【看輸出】才發現得了 —— 只看 rc 的話兩個世界都「正確」。
  if [ -f "$D/who" ]; then
    sed 's/^/   /' "$D/who" >&2
  else
    echo "   (沒有 who 檔 —— 可能是殘留的空 claim)" >&2
  fi
  # 2026-08-19 W2 實錘:上面那個「佔用者」欄分不出是不是你自己 ——
  #   本機所有視窗都是同一個 user@host,而 pid 每次都是新的、跑完必然已死
  #   => 別人佔的、與我自己上一次跑的,印出來一模一樣。
  #   當天的誤判路徑:第一次跑其實成功佔住,而輸出被 tail -8 截掉了成功橫幅
  #   => 第二次再跑撞到自己,被讀成「別的窗搶走了、而且是殘留」—— 兩個結論都錯。
  #   只加輸出,不動 claim 的原子性邏輯(主視窗 2026-08-19 裁)。
  echo "   [!] 若上面那個時間就在你剛才跑的那一刻,那很可能是【你自己上一次跑的】——" >&2
  echo "       本機所有視窗都是同一個 user@host,而 pid 每次都是新的、必然已死。" >&2
  echo "       先比對時間再判斷是不是別人。" >&2
  echo "   ⇒ 去問那個人，或確認是殘留之後 --release 它。**不要自己拿下一個號硬上**" >&2
  echo "     (他可能正在寫，而你拿走的號會變成第二次撞號)。" >&2
  exit 3
fi
{ echo "號    : #$NEXT"
  echo "佔用者: ${WINDOW_ID:-$(whoami)@$(hostname -s)}"
  echo "時間  : $(date '+%Y-%m-%d %H:%M:%S %Z')"
  echo "pid   : $$"
} > "$D/who"

echo "  ✅ 拿到 #$NEXT"
echo "  claim: $D"
cat "$D/who" | sed 's/^/    /'
echo
echo "── ④ 接下來 ───────────────────────────────────────────────────"
echo "  1. 別名檢查(這道問的是【這件事有沒有人登記過】，與號碼無關):"
echo "       python3 scripts/backlog-duplicate-scan.py --search <症狀關鍵字> …"
echo "     🔴 命中要【開檔讀完整條】再判,不要看摘要 —— 一條裡可以同時住著已修的 B 案與沒做的 A 案"
echo "     🔴 而別名檢查【不在本腳本裡】,要人記得跑 —— 2026-08-21 發號者跑了 7 次,擋下 1 次重複開號、判錯 1 次"
echo "     反例(同日,發號者自己):#821 在命中表【排第一名、四個詞全中】,而我看著摘要判「不同件」"
echo "        ⇒ 工具沒失效,失效的是【看著命中做的那一步判斷】。開檔那一步不能省。"
echo "  2. 寫條目進 docs/phase-1-backlog.md"
echo "  3. 🔴 **條目落檔之後記得釋放**:"
echo "       bash scripts/claim-backlog-number.sh --release $NEXT"
echo "     沒釋放的話這個號會一直被卡住(天花板寫在檔頭)。"
