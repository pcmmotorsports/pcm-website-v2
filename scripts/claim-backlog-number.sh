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
HITS="$(grep -rn '佔位\|RESERVED #6' "$CLAIM_ROOT"/*.md 2>/dev/null | grep -oE '#6[0-9][0-9]' | sort -u | tr '\n' ' ')"
echo "  信裡出現過的號:${HITS:-（無）}"
case " $HITS " in *" #$NEXT "*)
  echo "  🔴 #$NEXT 出現在信箱佔位宣告裡 ⇒ 停下，先去看那封信。" >&2; exit 1;;
esac

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
echo "  2. 寫條目進 docs/phase-1-backlog.md"
echo "  3. 🔴 **條目落檔之後記得釋放**:"
echo "       bash scripts/claim-backlog-number.sh --release $NEXT"
echo "     沒釋放的話這個號會一直被卡住(天花板寫在檔頭)。"
