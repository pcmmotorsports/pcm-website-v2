#!/usr/bin/env bash
# row-evidence — 餵一個錨(或關鍵字), 把【三格證據】擺在一起讓人自己判。
#
# 🛑 它【只擺證據, 不下判斷】(對齊 scripts/before-asking-sean.sh 的形狀)。
#
# 為什麼要它(成因是量到的, 2026-08-31):
#   29 列「等 Sean」逐列開檔讀內文末段 ⇒ 抓到 **2 列**的板上狀態是假的(6.9%):
#     `⟦b4-EMAILSHOULD⟧`  板上被判「他答過了」⇒ 而他答的是【隔壁那一題】
#     客戶篩選那一列       板上寫「plan 等批」⇒ 而生日那兩軸【已經上線】
#   🔴 兩列的共同形狀:**訂正寫進了內文末段, 而【態與誰欄】沒有跟著動。**
#   ⇒ 而人是靠【態與誰欄】決定要不要讀內文的 ⇒ 那個訂正等於不存在。
#
# ⚠️ 射程(先講死):
#   · 它答不出「這一列現在對不對」—— 那要人讀。它只保證【三格擺在同一個畫面上】
#   · 它只看本 repo 的板子 + before-asking-sean 的分母;掃不到別的 session 的對話、正式庫、OD 稿
#   · 內文末 N 行是【字元數】切的, 不是語意 —— 一段訂正若寫在中段, 它撈不到
#
# 用法:  bash 草稿-row-evidence.sh <錨或關鍵字> [末段行數, 預設 15]
#        bash 草稿-row-evidence.sh --selftest
set -uo pipefail
REPO="$(cd "$(dirname "$0")" && pwd)"
[ -d "$REPO/.git" ] || REPO=/Users/sean_1/pcm-website-v2
BOARD="$REPO/docs/launch-todo.md"
ASK="$REPO/scripts/before-asking-sean.sh"

emit_row() {  # $1=board $2=key $3=tail_lines
  python3 - "$1" "$2" "$3" <<'PY'
import io,sys,re
board,key,tail=sys.argv[1],sys.argv[2],int(sys.argv[3])
try: L=io.open(board,encoding='utf-8',errors='replace').read().splitlines()
except FileNotFoundError:
    print("🛑 查無板子:",board); sys.exit(3)
hits=[(i+1,l) for i,l in enumerate(L) if l.startswith('|') and key in l]
if not hits:
    print("🛑 板上查無這個錨/關鍵字 ⇒ 【不知道】, 不是【沒問題】"); sys.exit(3)
print("命中 %d 列"%len(hits))
for n,l in hits:
    c=[x.strip() for x in l.strip('|').split('|')]
    st=[x for x in c if x in ('open','doing','parked','done')]
    print("\n───────── 板 L%d ─────────"%n)
    print("① 態      :", st[0] if st else "🛑 讀不到(欄位可能錯位, 本列 %d 欄)"%len(c))
    print("① 錨      :", (c[1][:60] if len(c)>1 else ''))
    print("① 標題    :", (c[2][:110] if len(c)>2 else ''))
    print("① 誰欄    :", (c[3][:150] if len(c)>3 else '🛑 讀不到(欄位錯位)'))
    body=l
    seg=[s for s in re.split(r'<br>', body) if s.strip()]
    print("② 內文最後 %d 段(訂正通常住在這裡):"%tail)
    for s in seg[-tail:]:
        s=re.sub(r'\s+',' ',s).strip()
        print("   ·", s[:200])
PY
}

if [ "${1:-}" = "--selftest" ]; then
  rc=0
  echo "世界1 正對照:餵一個板上真的有的錨"
  emit_row "$BOARD" "b4-EMAILSHOULD" 3 | head -8 || rc=1
  echo
  echo "世界2 負對照:餵一個現造的錨 ⇒ 必須印【不知道】且 rc=3"
  NEG="ZZROW-$(date +%s)-$RANDOM"
  emit_row "$BOARD" "$NEG" 3; r2=$?
  [ "$r2" = "3" ] && echo "   ✅ rc=3" || { echo "   🛑 rc=$r2 應為 3"; rc=1; }
  echo
  echo "世界3 板子不存在 ⇒ 也要 rc=3(不是 0)"
  emit_row "/nonexistent-board-$$.md" "x" 3; r3=$?
  [ "$r3" = "3" ] && echo "   ✅ rc=3" || { echo "   🛑 rc=$r3 應為 3"; rc=1; }
  echo
  echo "世界4 突變:把正對照的錨改一個字 ⇒ 必須從命中變成不知道"
  emit_row "$BOARD" "b4-EMAILSHOULDX" 3 >/dev/null; r4=$?
  [ "$r4" = "3" ] && echo "   ✅ 突變後 rc=3(尺會動)" || { echo "   🛑 突變後 rc=$r4 —— 這把尺對錨不敏感"; rc=1; }
  echo
  echo "世界5 那支 before-asking-sean.sh 在不在"
  [ -x "$ASK" ] && echo "   ✅ 在: $ASK" || echo "   ⚠️ 不在或不可執行 ⇒ ③ 那一格會缺, 而本支會【明說】不會靜默"
  echo
  [ "$rc" = "0" ] && echo "✅ selftest 全過" || echo "🛑 selftest 有紅"
  exit $rc
fi

KEY="${1:-}"; TAIL="${2:-15}"
[ -n "$KEY" ] || { echo "用法: $0 <錨或關鍵字> [末段段數]   或  $0 --selftest"; exit 2; }

echo "═══ ①② 板上那一列:態 / 誰欄 / 內文末段 ═══"
emit_row "$BOARD" "$KEY" "$TAIL"; RC=$?
echo
echo "═══ ③ before-asking-sean 的五段 ═══"
if [ -x "$ASK" ]; then
  bash "$ASK" "$KEY" 2>&1 | head -60
else
  echo "🛑 找不到 $ASK ⇒ ③ 這一格【沒有跑】, 不是【沒有命中】"
fi
echo
echo "───────────────────────────────────────"
echo "🛑 本支只擺證據, 不下判斷。要判的是:"
echo "   【① 態與誰欄寫的】與【② 內文末段寫的】對不對得上?"
echo "   對不上 ⇒ 那一列的狀態是假的, 而讀的人只會讀①。"
echo "⚠️ 射程:掃不到別的 session 的對話 / 正式庫現況 / OD 稿 / 別的 repo"
exit $RC
