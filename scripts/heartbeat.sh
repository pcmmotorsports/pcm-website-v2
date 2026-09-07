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
    printf '%s\n' "# 六欄 TAB 分隔:時刻 / 窗 / 剛做完 / 現在手上 / 卡在什麼(沒有就寫 -) / 寫這行時那個窗的 HEAD(拿不到寫 -)"
    # 🔴 下一行用【單引號】—— 它含反引號, 而雙引號裡的反引號會被當命令替換執行(我 2026-09-07 當場踩了一次)。
    printf '%s\n' '#   🔴 第 6 欄是 2026-09-07 才加的(板列 ⟦b4-SHA1⟧);在那之前的行只有 5 欄, --who 對它們印 `@sha?`'
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
    # 🔴 第 6 欄是那個窗當下的 HEAD(板列 ⟦b4-SHA1⟧)。舊行只有 5 欄 ⇒ 印 `sha?`,
    #    而那與 `-`(拿不到)刻意印不同的字:一個是【那時還沒有這一欄】, 一個是【當時不在 git 樹裡】。
    sha = f[5] if len(f) > 5 else 'sha?'
    print('%s %-22s %3d 分前  @%-9s 剛做完:%s  |  手上:%s%s' % (
        mark, who, mins, sha, f[2][:40], f[3][:40],
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
    # ── 板列 ⟦b4-SHA1⟧:第 6 欄那一格, 三個世界要印不同的東西
    printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$(date '+%Y-%m-%d %H:%M')" "zz-sha" "做完 C" "做 D" "-" "deadbee" >> "$HB"
    OUT2=$(HOME="$T" bash "$0" --who 2>&1) || true
    echo "$OUT2" | grep -q '@deadbee' && echo "🟢 sha 正對照:帶 sha 的行印得出那顆" || echo "🔴 sha 正對照失敗"
    echo "$OUT2" | grep -q 'zz-pos.*@sha?' && echo "🟢 sha 負對照①:舊的 5 欄行印 sha?(沒炸, 也沒假裝有)" || echo "🔴 sha 負對照①失敗"
    echo "$OUT2" | grep -q '@0000000' && echo "🔴 sha 負對照②:現造 sha 竟然命中" || echo "🟢 sha 負對照②:現造 sha 0 命中"
    # ── 欄位裡有 TAB 時, sha 那一格不得被擠掉(code-reviewer 2026-09-07 nit)
    HOME="$T" bash "$0" "zz-tab" "$(printf 'A\tB')" "手上" >/dev/null 2>&1
    NF=$(tail -1 "$HB" | awk -F'\t' '{print NF}')
    LASTF=$(tail -1 "$HB" | awk -F'\t' '{print $6}')
    if [ "$NF" = "6" ]; then echo "🟢 TAB 正對照:餵含 TAB 的欄位 ⇒ 仍然 6 欄(沒被擠掉)"
    else echo "🔴 TAB 正對照:欄數變成 $NF ⇒ sha 那格被擠走了"; fi
    # 🔴 這一格第一版只比【形狀】(是不是 0-9a-f 或 -)—— 而突變測到:欄位被擠掉時它寫 `-`,
    #    而 `-` 也通過形狀檢查 ⇒ 壞掉的世界照樣印綠。📌 一個把兩個世界印成同一句的檢查。
    #    ⇒ 改成比【值】:自檢是在 git 樹裡跑的, 所以它必須等於當下真的 HEAD。
    REAL=$(git rev-parse --short HEAD 2>/dev/null || printf 'x')
    if [ "$LASTF" = "$REAL" ]; then echo "🟢 TAB 負對照:第 6 欄 = 當下真的 HEAD [$LASTF]"
    else echo "🔴 TAB 負對照:第 6 欄是 [$LASTF] 而真的 HEAD 是 [$REAL]"; fi
    rm -rf "$T"
    ;;
  "")
    echo "用法:bash scripts/heartbeat.sh \"<窗名>\" \"<剛做完>\" \"<手上>\" [\"<卡在什麼>\"]"
    echo "     bash scripts/heartbeat.sh --who"
    exit 2
    ;;
  *)
    init
    # 🔴 自由文字裡的 TAB / 換行會【把後面的欄位整排擠掉】—— 而擠進第 6 欄的東西
    #    長得像一個 sha, 於是 `git merge-base --is-ancestor <那個東西> HEAD` 會拿到一個假的答案。
    #    ⇒ 📌 這正是本欄存在的理由被反過來用:一個【看起來可驗】的欄位, 裝了一個不是 sha 的字。
    #    (code-reviewer 2026-09-07 抓到;今天沒有呼叫端會餵 TAB, 而「今天沒有」不是理由。)
    #    🛑 洗在【寫入端】不是讀取端 —— 讀取端修不了已經被擠掉的資料。
    clean() { printf '%s' "$1" | tr '\t\n\r' '   '; }
    WHO="$(clean "$1")"; DONE="$(clean "${2:--}")"; NOWDOING="$(clean "${3:--}")"; BLOCKED="$(clean "${4:--}")"
    # 🔴 第 6 欄 = 寫這一行的那個窗【當下的 HEAD】(板列 ⟦b4-SHA1⟧)。
    #    為什麼不是只有時間:一份 14:54 完全正確的報告, 15:03 就錯了 ——
    #    **時間要人自己去比對「那之後有沒有 commit」;sha 是直接可驗的**
    #    (`git merge-base --is-ancestor <sha> HEAD` 一行)。
    #    🛑 拿不到就寫 `-` —— 不是每個呼叫端都在 git 樹裡, 而【沒有 sha】與【sha 是 0】不可以印同一個東西。
    SHA=$(git rev-parse --short HEAD 2>/dev/null) || SHA=""
    [ -n "$SHA" ] || SHA="-"
    printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$(date '+%Y-%m-%d %H:%M')" "$WHO" "$DONE" "$NOWDOING" "$BLOCKED" "$SHA" >> "$HB"
    echo "✅ 心跳已記:$WHO ⇒ 手上「$NOWDOING」"
    ;;
esac
