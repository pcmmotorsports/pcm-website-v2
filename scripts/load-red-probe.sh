#!/usr/bin/env bash
# scripts/load-red-probe.sh —— **有負載時會不會紅**
#
# 🎯 板列 ⟦01-TREESCANTIMEOUT⟧ 逐字:「修法之前, 先要有一個量得到【在有負載時會不會紅】的方法,
#    而今天沒有。」⇒ 這支就是那把尺。
#
# 🔴🔴 **它要解的病, 它自己最容易犯**:
#    三個人量了三次同一件事 —— 主視窗判「是負載造成的」· 線 -account 用**閒置**重量說某支貼線 ·
#    而本線量到**閒置那個數字本身低報 3-5 倍**。
#    ⇒ 🎯 **三發都誠實, 而【空機上的秒數】這個量法從頭到尾就答不了那個問題。**
#    ⇒ 📌 **所以本支【每一發都把當下的 load average 記下來】** —— 一個沒帶 load 的秒數,
#      與那三發犯的是同一個錯。
#
# 🛑 **它不改任何測試, 不改 vitest.config, 不裝任何東西。** 只跑、只量、只印。
#
# 用法
#   bash scripts/load-red-probe.sh --selftest        自我驗證(帶正負對照)
#   bash scripts/load-red-probe.sh --list            只印它要跑哪幾支(先看分母)
#   bash scripts/load-red-probe.sh --idle            空機那一欄(不製造負載)
#   bash scripts/load-red-probe.sh --load [N]        有負載那一欄(預設 N = 核心數)
#   bash scripts/load-red-probe.sh --both [N]        兩欄都跑, 印對照表
#
# ⚠️ **跑之前先看 load** —— 本支開頭會印, 而**它不會替你決定**:
#    在 load 已經很高的機器上量到的「空機」欄, **不是空機**。
set -u
cd "$(dirname "$0")/.." || exit 2

NCPU=$(sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null || echo 4)

load_now() { uptime | sed 's/.*load averages*: *//' | awk '{print $1}'; }

banner() {
  printf '🔬 當下 load average(1 分鐘)= %s · 核心數 = %s\n' "$(load_now)" "$NCPU"
  printf '   ⚠️ 這個數字要跟著結果走 —— **一個沒帶 load 的秒數答不了「有負載時會不會紅」**。\n'
}

# 🔵 判準與板列逐字同一把:一支算「掃樹型」= 它在跑的時候從檔案系統列舉 repo 檔案。
#    🛑 刻意不用「檔名有 scan」當判準 —— 那會按命名習慣抽樣。
list_targets() {
  grep -rlE "readdirSync|readdir\(|globSync|fast-glob|from 'glob'|git ls-files" \
    --include='*.test.ts' --include='*.test.tsx' apps packages scripts 2>/dev/null | sort
}

# 製造可控負載:N 個純 CPU 迴圈。
# 🔵 用 `yes > /dev/null` 而不是第二份 vitest —— 後者的負載【不可控也不可重現】
#    (它自己會受機器狀態影響)⇒ 那會讓兩欄各自浮動而看不出差。
LOADPIDS=""
start_load() {
  local n="$1"; local i=0
  while [ "$i" -lt "$n" ]; do yes > /dev/null 2>&1 & LOADPIDS="$LOADPIDS $!"; i=$((i+1)); done
  sleep 3   # 讓 load average 追上來, 否則第一支測試量到的是還沒升上去的那一刻
  printf '   🔵 已起 %s 個負載行程 · load 現在 = %s\n' "$n" "$(load_now)"
}
stop_load() {
  [ -n "$LOADPIDS" ] || return 0
  for p in $LOADPIDS; do kill "$p" 2>/dev/null; done
  LOADPIDS=""
  sleep 1
}
trap 'stop_load' EXIT INT TERM

# 跑一支, 回 "<毫秒> <rc>"
run_one() {
  local f="$1" t0 t1
  t0=$(python3 -c 'import time;print(int(time.time()*1000))')
  pnpm exec vitest run "$f" > /tmp/lrp-one.log 2>&1
  local rc=$?
  t1=$(python3 -c 'import time;print(int(time.time()*1000))')
  printf '%s %s' "$((t1 - t0))" "$rc"
}

column() {   # $1 = 欄名  $2 = 負載數(0 = 不製造)
  # 🔴 **拆成三行, 不要寫成 `local a="$1" b="$2" c="...$a..."`** ——
  #    在同一個 `local` 宣告裡引用**它自己剛設的變數**, bash 的行為是未定義的;
  #    實測(2026-09-06)在 `set -u` 之下當場 `name: unbound variable`,
  #    而 📌 **錯誤訊息指的是【那一行】, 讀起來像「呼叫端沒傳參數」** —— 我因此先去改了呼叫端與迴圈,
  #    兩次都沒修到。**一個指錯地方的錯誤訊息, 會讓人把對的地方改壞。**
  local name; name="$1"
  local n;    n="$2"
  local out;  out="/tmp/lrp-$name.tsv"
  : > "$out"
  # 🔵 **空機欄開跑前先等** —— 不等的話它量到的是上一件事的餘熱。
  #    🔴 2026-09-06 實測:「空機」欄 load 中位數 **25.74**, 而「有負載」欄 **9.41** ⇒ **兩欄是反的**
  #      ⇒ 那一發的「0 支紅」完全不能用。成因 = `load average` 是**過去一分鐘的追尾平均**,
  #        而空機欄緊接在我剛跑完的全套之後開跑。
  #    ⚠️ 它**不會無限等**:最多 90 秒, 等不到就照跑而**把當下的 load 記進去**,
  #      由最後那道「這一發算不算數」的閘去判。📌 **等不到不是失敗, 是一個要被記錄的條件。**
  if [ "$n" -eq 0 ]; then
    local w=0
    while [ "$w" -lt 90 ]; do
      case "$(load_now)" in
        [0-9].*|1[0-2].*) break ;;
      esac
      sleep 5; w=$((w+5))
    done
    printf '   🔵 空機欄開跑前等了 %s 秒 · load 現在 = %s\n' "$w" "$(load_now)"
  fi
  [ "$n" -gt 0 ] && start_load "$n"
  local L; L=$(load_now)
  # 🔴 **不要在這個迴圈裡用 `set --`** —— 它會把 `column` 自己的位置參數蓋掉,
  #    而 `local name="$1"` 在【下一輪】就讀到空的 ⇒ `set -u` 當場炸
  #    (2026-09-06 實測:`line 73: name: unbound variable`, 而它炸在【第二欄】不是第一欄)。
  #    📌 **一個在第一輪好好的迴圈, 第二輪才炸** —— 那種錯不會在小樣本上出現。
  local ms rc pair
  while IFS= read -r f; do
    pair=$(run_one "$f")
    ms=${pair%% *}; rc=${pair##* }
    printf '%s\t%s\t%s\t%s\n' "$f" "$ms" "$rc" "$L" >> "$out"
  done < /tmp/lrp-targets.txt
  [ "$n" -gt 0 ] && stop_load
  printf '   ✅ %s 欄跑完 ⇒ %s\n' "$name" "$out"
}

# 用 `--root` 跑暫存目錄裡的一支 fixture。回 "<毫秒> <rc>"。
run_root() {
  local d="$1" which="$2" t0 t1
  mkdir -p "$d/run"; rm -f "$d/run"/*.test.ts
  cp "$d/$which.test.ts" "$d/run/"
  t0=$(python3 -c 'import time;print(int(time.time()*1000))')
  pnpm exec vitest run --root "$d/run" > /tmp/lrp-one.log 2>&1
  local rc=$?
  t1=$(python3 -c 'import time;print(int(time.time()*1000))')
  printf '%s %s' "$((t1 - t0))" "$rc"
}

# ⚠️ **下面 selftest 裡還有 4 個 `set --`, 而它們是安全的** —— 理由寫出來不要靠人記得:
#    它們在 `selftest()` 的**直線碼**裡, 不在迴圈裡, 而 `selftest` **不讀自己的位置參數**
#    ⇒ 蓋掉了也沒有人會再讀。
#    🔴 而 `column()` 那個不一樣:它在 `while` 迴圈裡, 而 `local name="$1"` 在**下一輪**要讀
#    ⇒ 📌 **同一個寫法, 安不安全取決於【後面還有沒有人讀它】** —— 不是取決於寫法本身。
selftest() {
  echo "=== selftest:這把尺分得開【紅】與【綠】嗎 ==="
  local d; d=$(mktemp -d) || exit 2
  local ok=0
  # 正對照:一支必定超時的假測試 ⇒ 必須 rc != 0
  cat > "$d/pos.test.ts" <<'T'
import { it } from 'vitest';
it('🔴 正對照:故意睡超過 testTimeout ⇒ 這一格必須紅', async () => {
  await new Promise((r) => setTimeout(r, 20_000));
});
T
  # 負對照:一支立刻結束的 ⇒ 必須 rc == 0
  cat > "$d/neg.test.ts" <<'T'
import { expect, it } from 'vitest';
it('🔵 負對照:立刻結束 ⇒ 這一格必須綠(證明上面那個紅不是恆紅)', () => {
  expect(1).toBe(1);
});
T
  # 🔴🔴 **這裡踩過一次, 留著**:第一版用 `vitest run <檔路徑>` 跑 /tmp 底下的 fixture ⇒
  #   vitest 的 `include` 是 `{packages,apps,scripts}/**` ⇒ **那兩支根本沒被收**
  #   ⇒ 它回「找不到測試」而 rc=1 ⇒ 📌 **正對照「紅了」, 而紅的理由是錯的**(20 秒的睡眠只跑了 778ms)。
  #   ⇒ 🛑 **紅了不等於守到 —— 要看它紅在哪一句, 也要看它花了多久。**
  #   ✅ 改用 `--root <暫存目錄>`(實測收得到), 並加下面那一格釘住「它真的睡滿了」。
  set -- $(run_root "$d" pos)
  POS_MS=$1; POS_RC=$2
  # 🔴 **釘的是「紅在哪一句」不是「幾秒」** —— 第二次踩到:`--root` 之下 vitest 讀不到 repo 的
  #    `vitest.config.ts`(那裡才寫著 `testTimeout: 15_000`)⇒ 它用**預設 5 秒**
  #    ⇒ 一個釘死 >15000 的判準會把**正確的紅**判成假的。
  #    📌 **兩次都是同一個病:我拿一個【與紅的理由無關的數】去驗那個紅。**
  #    ✅ 判準改成:rc 非 0 **且**輸出裡出現 `Test timed out` ⇒ 才算「它真的跑到超時」。
  if [ "$POS_RC" -ne 0 ] && grep -q 'Test timed out' /tmp/lrp-one.log; then
    printf '  ✅ 正對照:rc=%s · 用時 %sms · 輸出含「Test timed out」⇒ 它真的跑到超時\n' "$POS_RC" "$POS_MS"
  else
    printf '  🔴 正對照:rc=%s 用時 %sms, 而輸出【沒有】Test timed out ⇒ **紅在別的理由**\n' "$POS_RC" "$POS_MS"
    grep -m1 -E 'Error|include:' /tmp/lrp-one.log | sed 's/^/       /'
    ok=1
  fi
  set -- $(run_root "$d" neg)
  if [ "$2" -eq 0 ]; then printf '  ✅ 負對照:正常測試 rc=0 · 用時 %sms\n' "$1"
  else printf '  🔴 負對照:正常測試竟然非 0 ⇒ 這把尺恆紅, 上面那個綠沒有意義\n'; ok=1; fi
  # 🔴 第三格:秒數本身要動 —— 一把「rc 對而秒數恆定」的尺量不出負載影響
  local a b
  set -- $(run_root "$d" neg); a=$1
  start_load "$NCPU"
  set -- $(run_root "$d" neg); b=$1
  stop_load
  printf '  🔬 同一支測試:空機 %sms · 有負載 %sms\n' "$a" "$b"
  if [ "$b" -gt "$a" ]; then printf '  ✅ 秒數會動 ⇒ 這把尺量得到負載\n'
  else printf '  ⚠️ 有負載反而不慢 —— 不判紅, 而**這一欄的結論不可信**(機器狀態或負載沒起來)\n'; fi
  rm -rf "$d"
  [ "$ok" -eq 0 ] && echo "✅ selftest PASS" || echo "🔴 selftest FAIL"
  return "$ok"
}

MODE="${1:-}"
case "$MODE" in
  --selftest) banner; selftest; exit $? ;;
  --list)     banner; list_targets | tee /tmp/lrp-targets.txt | wc -l | xargs printf '   掃樹型測試 = %s 支\n'; exit 0 ;;
  --idle)     banner; list_targets > /tmp/lrp-targets.txt; column idle 0 ;;
  --load)     banner; list_targets > /tmp/lrp-targets.txt; column load "${2:-$NCPU}" ;;
  --both)     banner; list_targets > /tmp/lrp-targets.txt; column idle 0; column load "${2:-$NCPU}" ;;
  *) sed -n '1,30p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac

# 兩欄都在就印對照
if [ -s /tmp/lrp-idle.tsv ] && [ -s /tmp/lrp-load.tsv ]; then
  echo
  echo "=== 空機 vs 有負載(只印【有負載時紅】或【慢 1.5 倍以上】的)==="
  python3 - <<'PY'
import io
def rd(p):
    d={}
    for l in io.open(p,encoding='utf-8'):
        f,ms,rc,ld=l.rstrip('\n').split('\t'); d[f]=(int(ms),int(rc),ld)
    return d
i=rd('/tmp/lrp-idle.tsv'); o=rd('/tmp/lrp-load.tsv')
red=[f for f in o if o[f][1]!=0]
# 🔴🔴 **這一發算不算數 —— 先問, 再印結論。**
#    2026-09-06 實測打穿:「空機」欄 load 中位數 25.74 而「有負載」欄 9.41 ⇒ **兩欄是反的**,
#    而那一發印出來的「0 支紅」看起來完全正常。📌 **一個不可比的比較, 長得跟一個好消息一樣。**
li=sorted(float(v[2]) for v in i.values()); lo=sorted(float(v[2]) for v in o.values())
mi=li[len(li)//2]; mo=lo[len(lo)//2]
print('  load 中位數:空機欄 %.2f · 有負載欄 %.2f' % (mi, mo))
if mi >= mo:
    print('  🔴🔴 **這一發作廢** —— 「空機」欄的 load 中位數【不低於】有負載欄')
    print('     ⇒ 📌 兩欄不可比, 下面那個「紅幾支」【不能讀成結論】。')
    print('     ⇒ 成因多半是:空機欄緊接在別的重工作之後開跑(load average 是一分鐘追尾平均),')
    print('       或別的窗同時在跑東西。⇒ 等機器閒下來重跑一發。')
    print('     🛑 **本閘刻意印在結論【之前】** —— 印在後面的話, 讀的人已經把那個數字記住了。')
else:
    print('  ✅ 兩欄可比(空機欄的 load 中位數確實比較低)⇒ 下面的結論可以讀。')
print('  分母 %d 支 · 空機紅 %d 支 · 有負載紅 %d 支' % (len(i), sum(1 for f in i if i[f][1]!=0), len(red)))
print('  load:空機欄 %s · 有負載欄 %s' % (next(iter(i.values()))[2], next(iter(o.values()))[2]))
if red:
    print('\n  🔴 有負載時紅的:')
    for f in sorted(red): print('     %s  空機 %sms(rc=%s)⇒ 有負載 %sms(rc=%s)' % (f, i[f][0], i[f][1], o[f][0], o[f][1]))
else:
    print('\n  🔵 有負載時【沒有一支紅】—— ⚠️ 而那不等於「不會紅」:'
          '本發的負載強度、機器狀態、測試順序都只是一個樣本。')
slow=[(o[f][0]/max(i[f][0],1), f) for f in o if i.get(f) and o[f][0] > i[f][0]*1.5]
if slow:
    print('\n  🔵 慢 1.5 倍以上的前 10 支(沒紅, 而它們是下一個候選):')
    for r,f in sorted(slow, reverse=True)[:10]: print('     %.1f×  %s' % (r,f))
PY
fi
