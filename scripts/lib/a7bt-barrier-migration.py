#!/usr/bin/env python3
"""把一支自帶 BEGIN/COMMIT 的 migration 改成「停在 COMMIT 之前等放行」的 barrier 版。

用途 = A7b-T T4-2 的鎖窗探針:要在 migration 的**交易還開著**的時候,從第二條連線
去試著取得結帳 INSERT 需要的鎖。用「啟動後輪詢」會賽跑失敗(T1 只跑 ~50ms),
必須用 barrier;而沒探到就靜靜算過的話,那一格會永遠是假綠。

用法:a7bt-barrier-migration.py <migration.sql> <marker 前綴>
  <marker 前綴>-started 由 psql 在 COMMIT 前 touch;等到 <marker 前綴>-go 出現才 COMMIT。

🔴 **不能用 `endswith("COMMIT;")`**(2026-07-31 code-reviewer M2 抓到):
   A7b-M 的檔尾是 `COMMENT ON …` 註解區塊,`COMMIT;` 在中間 ⇒ endswith 版本
   對它**永遠 exit 3**,而那正是 plan §10 標為「真正的風險」的那一支。
   改用 `rindex("\nCOMMIT;")`:插在**最後一個** COMMIT 之前,其後原樣接回。
🔴 找不到 COMMIT 就 exit 3 —— 插入點失配時要大聲死,不要產出一個看起來能跑、
   其實沒有 barrier 的檔案(那會讓鎖探針變成永久假綠)。
🔴 **marker 會被塞進 `\\!` 的 shell 命令列 ⇒ 必須 quote**(2026-07-31 關卡2 #15):
   呼叫端的 workdir 閘允許路徑含空白、分號、`$(...)`,原版直接字串內插
   ⇒ 特製的 workdir 路徑等於任意命令執行。改用 `shlex.quote`,並另外白名單擋掉
   一望即知有問題的字元 —— 兩層都要,因為 quote 對後續維護者不明顯。
🔴 **`\\!` 的失敗不會中止 psql**(關卡2 #16):`ON_ERROR_STOP` 管的是 SQL 錯誤,
   shell 命令的非零退出只會設定 `:SHELL_ERROR`。等待逾時後原版會**照樣 COMMIT**
   ⇒ 探針沒探到、migration 卻正常結束 = 假綠。改成逾時就 `\\if :SHELL_ERROR` 主動
   拋 SQL 例外把整筆交易炸掉(fail-closed),並由 harness 的 `rc != 0` 看見。
"""
import shlex
import sys

if len(sys.argv) != 3:
    sys.stderr.write("用法:a7bt-barrier-migration.py <migration.sql> <marker 前綴>\n")
    sys.exit(2)
mig, marker = sys.argv[1], sys.argv[2]

# 白名單:marker 只允許路徑常見的安全字元。命中就死,不要試圖「清理後繼續」。
_BAD = set(" \t\n\"'`$;&|<>()*?[]{}!\\")
if not marker or set(marker) & _BAD:
    sys.stderr.write("barrier:marker 含不安全字元(會被塞進 shell 命令列)⇒ 拒絕產生\n")
    sys.exit(4)
q = shlex.quote(marker)

src = open(mig).read().rstrip()
needle = "\nCOMMIT;"
i = src.rfind(needle)
if i < 0:
    sys.stderr.write("barrier:檔內找不到 COMMIT; ⇒ 插入點失配\n")
    sys.exit(3)
print(src[:i])
print("\\! touch %s-started" % q)
print("\\! bash -c 'for i in $(seq 1 400); do [ -f %s-go ] && exit 0; sleep 0.05; done; exit 1'" % q)
# 🔴 fail-closed:等待逾時(上面那個 exit 1)⇒ SHELL_ERROR=true ⇒ 這裡主動炸掉交易,
#    不讓它靜靜 COMMIT。沒有這段的話「探針沒探到」與「探針探到了」在日誌上長得一樣。
print("\\if :SHELL_ERROR")
print("DO $barrier$ BEGIN RAISE EXCEPTION "
      "'barrier:等待 go 標記逾時(或 touch 失敗)⇒ 鎖探針沒有真的探到,交易主動中止'; END $barrier$;")
print("\\endif")
print("COMMIT;")
tail = src[i + len(needle):]
if tail.strip():
    print(tail)
