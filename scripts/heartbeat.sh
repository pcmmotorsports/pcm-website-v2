#!/usr/bin/env bash
# 心跳:每個窗做完一件事就追加一行。主視窗 `--who` 看誰安靜太久。
#
# 🔴 為什麼有這支(Sean 2026-09-02 拍甲):
#    「他們都回應在自己視窗後, 你也不知道就停擺也忘記去找他們」
#    ⇒ 而【窗在做事】與【窗停了】在主視窗這一端是【同一個訊號:什麼都沒有】。
#    ⇒ 而 Sean 同一輪補的那一句是它的真正理由:
#      **「只要一壓縮你就容易忘記。」**
#      ⇒ 壓縮會吃掉「哪一條線手上是什麼」, 而它消失時零訊號。
#    ⇒ ⇒ 所以這件事不能靠主視窗記得問, 也不能靠哨兵轉述 —— 要靠一支檔。
#
# 🔴 檔名【不帶日期】—— 2026-09-02 00:0x 踩過兩次:帶日期的檔名在跨午夜那一刻
#    把所有人指到一個空的地方, 而【查無】與【沒有人在做事】印同一個東西。
#
# 用法:
#   bash scripts/heartbeat.sh "<窗名>" "<剛做完什麼>" "<現在手上什麼>" ["<卡在什麼>"]
#   bash scripts/heartbeat.sh --who          # 每個窗最後一次心跳 + 距今多久
#   bash scripts/heartbeat.sh --selftest
set -u

HB="$HOME/pcm-mailbox/心跳.tsv"

init() {
  [ -f "$HB" ] && return 0
  {
    printf '%s\n' "# 心跳 —— 每個窗做完一件事追加一行。主視窗 bash scripts/heartbeat.sh --who"
    printf '%s\n' "# 🔴 這支檔存在的理由:窗在做事與窗停了, 在主視窗那端是同一個訊號(什麼都沒有)。"
    printf '%s\n' "# 🔴 而主視窗一壓縮就會忘記誰手上是什麼 ⇒ 所以答案要住在檔案裡, 不住在記憶裡。"
    printf '%s\n' "# 五欄 TAB 分隔:時刻 / 窗 / 剛做完 / 現在手上 / 卡在什麼(沒有就寫 -)"
  } > "$HB"
}

case "${1:-}" in
  --who)
    init
    printf '%s\n' "── 每個窗最後一次心跳(現在 $(date '+%H:%M'))──"
    NOW=$(date +%s)
    # 每個窗只取最後一筆 —— 而【取最後一筆】要按時間不按行序:
    # 同一支檔多個窗交錯追加, 行序恰好等於時間序, 而那是巧合不是保證。
    # 這裡按窗分組取最大時刻, 不靠行序。
    python3 - "$HB" "$NOW" <<'PY'
import io,sys,time,os
p,now=sys.argv[1],int(sys.argv[2])
last={}
for l in io.open(p,encoding='utf-8'):
    if l.startswith('#') or not l.strip(): continue
    f=l.rstrip('\n').split('\t')
    if len(f)<4: continue
    ts,who=f[0],f[1]
    try: t=time.mktime(time.strptime(ts[:16],'%Y-%m-%d %H:%M'))
    except ValueError: continue
    if who not in last or t>last[who][0]: last[who]=(t,f)
if not last:
    print('  (還沒有任何心跳 —— 而那與「大家都停了」印同一個東西 ⇒ 先確認有人被告知過這支檔)')
    raise SystemExit(0)
for who,(t,f) in sorted(last.items(), key=lambda kv: kv[1][0]):
    mins=int((now-t)//60)
    mark='🔴' if mins>=30 else ('⚠️ ' if mins>=15 else '  ')
    print('%s %-22s %3d 分前  剛做完:%s  |  手上:%s%s' % (
        mark, who, mins, f[2][:40], f[3][:40],
        ('  |  🛑 卡:'+f[4][:30]) if len(f)>4 and f[4] not in ('','-') else ''))
print('')
print('  🔴 = 30 分沒動靜  ⚠️ = 15 分  ⇒ 而【安靜】不等於【停了】:去問它, 不要判它。')
print('  🛑 射程:沒寫心跳的窗在這裡是隱形的 ⇒ 空白不代表沒人做。')
PY
    ;;
  --stale)
    # 🔴 存在理由(Sean 2026-09-03 01:2x 逐字):「如果有視窗超過 25 分鐘沒有回應你任何訊息…
    #    我們之前就是因為這樣子, 所以停擺非常多次」。
    # 🛑 而 --who 早就會標 🔴, 缺的不是那個標記, 是【有沒有人去跑它】
    #    ⇒ 本模式給機器讀:只印超時的窗, 零超時時【印一行明確的話】而不是空白。
    #    📌 空輸出與「大家都好」印同一個東西 —— 那正是這支檔要解的病本身。
    init
    MINS="${2:-25}"
    NOW=$(date +%s)
    python3 - "$HB" "$NOW" "$MINS" <<'PY2'
import io,sys,time
p,now,lim=sys.argv[1],int(sys.argv[2]),int(sys.argv[3])
last={}
for l in io.open(p,encoding='utf-8'):
    if l.startswith('#') or not l.strip(): continue
    f=l.rstrip('\n').split('\t')
    if len(f)<4: continue
    try: t=time.mktime(time.strptime(f[0][:16],'%Y-%m-%d %H:%M'))
    except ValueError: continue
    if f[1] not in last or t>last[f[1]][0]: last[f[1]]=(t,f)
# 🔴 上界不是裝飾 —— 第一發實測 11 個超時, 而其中 8 個是昨晚就收工的窗。
# 🛑 一道對常態叫的閘會被關掉(memory:閘死於誤報遠比死於漏報常見)⇒ 沉默【太久】的不是超時, 是【已收工】。
# ⇒ 上界 = 門檻 x 4(25 分 ⇒ 100 分)。射程:這是一個【選的值】不是量出來的, 改它請連驗收一起改。
ceil=lim*4
stale=[(w,int((now-t)//60),f) for w,(t,f) in last.items() if lim<=(now-t)//60<ceil]
gone=[w for w,(t,f) in last.items() if (now-t)//60>=ceil]
stale.sort(key=lambda x:-x[1])
if not stale:
    print('HEARTBEAT-STALE none (門檻 %d-%d 分, 在班 %d 個窗, 已收工 %d 個不算) — 分母只含【寫過心跳的窗】' % (lim,ceil,len(last)-len(gone),len(gone)))
    raise SystemExit(0)
print('🔴 HEARTBEAT-STALE %d 個窗超過 %d 分沒動靜 —— 去敲它, 不要判它:' % (len(stale),lim))
for w,m,f in stale:
    print('   %-20s %4d 分前  手上:%s' % (w,m,f[3][:46]))
print('   🛑 而【沒寫過心跳的窗在這裡是隱形的】⇒ 這個數字是下界, 不是全部。')
print('   🔵 另有 %d 個窗沉默超過 %d 分 ⇒ 判為【已收工】不在上面(名單:%s)' % (len(gone),ceil,' '.join(sorted(gone)) or '無'))
raise SystemExit(1)
PY2
    ;;
  --selftest)
    T=$(mktemp -d); mkdir -p "$T/pcm-mailbox"; HB="$T/pcm-mailbox/心跳.tsv"; init
    printf '%s\t%s\t%s\t%s\t%s\n' "$(date '+%Y-%m-%d %H:%M')" "zz-pos" "做完 A" "做 B" "-" >> "$HB"
    printf '%s\t%s\t%s\t%s\t%s\n' "2026-01-01 00:00" "zz-old" "很久以前" "不知道" "-" >> "$HB"
    OUT=$(HOME="$T" bash "$0" --who 2>&1) || true
    echo "$OUT" | grep -q 'zz-pos' && echo "🟢 正對照:剛寫的窗看得到" || echo "🔴 正對照失敗"
    echo "$OUT" | grep -q '🔴 .*zz-old' && echo "🟢 負對照:很舊的窗被標紅" || echo "🔴 負對照失敗(舊的沒被標紅)"
    echo "$OUT" | grep -q 'zzNoSuchWindow' && echo "🔴 現造字面竟然命中" || echo "🟢 現造字面 0 命中"
    rm -rf "$T"
    ;;
  "")
    echo "用法:bash scripts/heartbeat.sh \"<窗名>\" \"<剛做完>\" \"<手上>\" [\"<卡在什麼>\"]"
    echo "     bash scripts/heartbeat.sh --who"
    exit 2
    ;;
  *)
    init
    WHO="$1"; DONE="${2:--}"; NOWDOING="${3:--}"; BLOCKED="${4:--}"
    printf '%s\t%s\t%s\t%s\t%s\n' "$(date '+%Y-%m-%d %H:%M')" "$WHO" "$DONE" "$NOWDOING" "$BLOCKED" >> "$HB"
    echo "✅ 心跳已記:$WHO ⇒ 手上「$NOWDOING」"
    ;;
esac
