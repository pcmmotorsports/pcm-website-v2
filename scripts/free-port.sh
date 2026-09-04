#!/usr/bin/env bash
# free-port.sh —— 取一個【現在沒人聽】的 TCP port, 印在 stdout 第一行。
#
# 為什麼有這一支(⟦f3-PGPORTCOLLISION⟧):
#   拋棄式 PG 的 port 原本由【窗別字串的 cksum】決定 ⇒ 兩個窗取同一個字母就【必撞】,
#   而 runbook 給的處置是「換 WIN 再來」—— 那是叫人重試, 不是讓它不撞。
#   🔬 2026-09-05 線 -db 一個人一夜用掉五個 port(54399/54401/54403/54405/54407), 全部手工分配;
#      七個窗同夜共用一台機器 ⇒ 手工分配遲早撞。
#
# 🛑 **它證不到什麼 —— 這一段比用法重要**:
#   · 這是 bind(0) 取號再放掉 ⇒ 從「放掉」到「PG 真的 listen」之間有一個空隙,
#     那個空隙裡別人【還是可能】搶走同一個號。
#     ⇒ 📌 **本支把【必然相撞】換成【很少相撞】—— 而價值全住在那個「很少」裡。**
#     ⇒ 所以起完 PG 之後仍然要驗它真的在你要的那個 port 上(runbook §1 那句 select version())。
#   · 它只看 127.0.0.1 的 TCP;不看 unix socket, 也不看別人「已經佔好但還沒 listen」的號。
#   · 它不記得自己上次給過什麼 ⇒ 連續呼叫兩次可能拿到同一個號
#     ⇒ 要兩個 port(PG + PostgREST)就用 --two, 它保證兩個值不同。
#
# 用法:
#   PORT=$(bash scripts/free-port.sh)
#   read -r PORT RPORT < <(bash scripts/free-port.sh --two)
#   bash scripts/free-port.sh --selftest
set -uo pipefail

one() {
  python3 -c 'import socket
s = socket.socket()
s.bind(("127.0.0.1", 0))
print(s.getsockname()[1])
s.close()'
}

two() {
  local a b i
  a=$(one) || return 1
  for i in 1 2 3 4 5; do
    b=$(one) || return 1
    if [ "$b" != "$a" ]; then printf '%s %s\n' "$a" "$b"; return 0; fi
  done
  echo "🔴 連續 5 次都拿到同一個 port($a)⇒ 這不正常, 停下來看" >&2
  return 2
}

selftest() {
  ok=0
  p=$(one)
  case "$p" in
    ''|*[!0-9]*) echo "  🔴 取到的不是純數字:$p"; ok=1 ;;
    *) if [ "$p" -ge 1024 ] && [ "$p" -le 65535 ]; then
         echo "  ✅ 取到一個合法 port($p)"
       else echo "  🔴 超出範圍:$p"; ok=1; fi ;;
  esac

  # 🟢 正對照:剛取到的號, 現在應該沒有人在聽
  if lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "  🔴 剛取到的 $p 竟然有人在聽 ⇒ 這支沒有判別力"; ok=1
  else
    echo "  ✅ 正對照:剛取到的 $p 沒有人在聽"
  fi

  # 🔵 負對照:同一把 lsof 尺對一個【真的有人在聽】的號要說有 ——
  #    否則上面那個「沒有人在聽」可能只是 lsof 對什麼都印空。
  # 🔴 而要問【那一個號】, 不要拿程序名去 grep ——
  #    2026-09-05 第一版寫 grep -c python3, 而 lsof 的 COMMAND 欄印的是 Python(大寫、無 3)
  #    ⇒ 負對照印 0, 看起來像「lsof 壞了」, 而壞的是我的 grep。
  _lout=$(mktemp)
  python3 -c 'import socket, time
s = socket.socket()
s.bind(("127.0.0.1", 0))
s.listen(1)
print(s.getsockname()[1], flush=True)
time.sleep(4)' > "$_lout" 2>&1 &
  _lpid=$!
  sleep 1
  _lp=$(head -1 "$_lout")
  if [ -n "${_lp:-}" ] && lsof -nP -iTCP:"$_lp" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "  ✅ 負對照:同一把 lsof 對【真的有人在聽】的 $_lp 說得出有"
  else
    echo "  🔴 負對照失敗:lsof 對真的在聽的 ${_lp:-?} 也說沒有 ⇒ 上面那個「沒人聽」不算數"; ok=1
  fi
  wait "$_lpid" 2>/dev/null
  rm -f "$_lout"

  if read -r x y < <(two); then
    if [ "$x" != "$y" ]; then echo "  ✅ --two 給出兩個不同的號($x / $y)"
    else echo "  🔴 --two 給了兩個一樣的"; ok=1; fi
  else
    echo "  🔴 --two 失敗"; ok=1
  fi

  if [ "$ok" = "0" ]; then echo "全部通過。"; else echo "🔴 有格沒過。"; fi
  return "$ok"
}

case "${1:-}" in
  --selftest) selftest; exit $? ;;
  --two)      two ;;
  '')         one ;;
  *)          echo "用法:free-port.sh [--two|--selftest]" >&2; exit 2 ;;
esac
