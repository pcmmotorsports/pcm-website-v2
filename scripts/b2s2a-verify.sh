#!/usr/bin/env bash
# ============================================================
# B2-S2a 可重現驗證 harness ── 結構段(S2a-2)+ 行為段(S2a-3)+ 回滾/故障注入段(S2a-4)
# ============================================================
# 標的 = supabase/migrations/20260806100000_m4b_e10_b2_s2a_summary_shipped_quantity.sql
# 片級 plan = docs/specs/2026-08-06-e10-b2-s2a-summary-columns-plan.md(v2、已凍結、只當意圖文件)
# 審查總帳 = docs/reviews/2026-08-06-b2-s2a1-reviews.md(migration 片)
#          + docs/reviews/2026-08-06-b2-s2a2-reviews.md(本 harness 結構段四輪)
#
# 用法:
#   PORT=54355 scripts/b2s2a-verify.sh all /tmp/b2s2av   從零 provision pre-S2a 基準庫,再跑全部
#   PORT=54355 scripts/b2s2a-verify.sh run /tmp/b2s2av   重用既有基準庫
#   scripts/b2s2a-verify.sh gate "<目標連線字串>"        apply 當下的唯讀前置閘(不需 PORT / workdir)
#   🔴 PORT 一律顯式帶(a1/a4a 共用 54329 的同埠地雷)—— 沒帶會在參數閘直接退出,不會用預設值。
#      (gate 模式例外:它不 provision 任何東西,連線字串由呼叫端直接給。)
#
# ── 這支腳本在證明什麼 ──────────────────────────────────────
# 證明:①本片落地後的欄形狀 / 三條 CHECK 定義 / CHECK 具名集合 / 七個物件的 COMMENT
#        被**外部** oracle 鎖住(不是靠 migration 自己那段 DO block 自我背書);
#      ②靶①-⑤ 覆蓋 **4 個斷言族、17 格中的 7 格**(項1、項2 的兩條、項3、9a×1、9-excl×1、9c),
#        每發都紅在指定的那一格。
# 🔴 **不證明**:其餘 10 格**沒有**對應突變 —— 它們只被對照組證明「可以滿足」,不是被證明「壞了會紅」。
#   (其中 9 條是**註解錨**,經人工查證非恆真:A1 `20260730150000_…sql:141/144/162` 分別含
#    「三個 0」/「讓四條「跟 quantity 比」」/「三個數量」、S1b `20260805170200_…sql:94` 含
#    「強制點未定案」且**不含** `oiqs_shipped_le_instock` ⇒ 舊字面確實會讓它們紅。
#    第 10 格 `C2-oiqs_cancelled_shipped_le_quantity` **不是錨、是 constraintdef 逐字比對**
#    (Fable R3 F3:上面那段論證沒涵蓋它);它非恆真的理由是 pre-S2a 根本沒有這條約束
#    ⇒ 沒被建出來時會拿到「(缺漏或未 validated)」而轉紅。但同樣是**閱讀**,不是實跑證據。)
#      ③(S2a-3 併入後)C8/C9 **真的擋得住**:項5/7 負測各紅在自己的 conname、項4 被擋在具名 ERROR、
#        項6/7b 正測回查落庫值 —— **這五格才是關於本 migration 的行為證據**;
#        八個行為突變靶(⑥⑦⑧a⑧b⑧c⑩⑫⑬)各自只讓指定那一格轉紅。
# 🔴 **項8 不是證據**:它是不碰受測 DB 的純代數 smoke(C9 ∧ C7 ⇒ C6′),
#    migration 根本沒套也會回 0;保留只因為它一旦非 0、§1 的冗餘論證就作廢。
# 🔴 **項8 沒有對應突變**(其餘五格都有)。
# 🔴 **八發不等於八個獨立的改動面**:bmut6/bmut7/bmut12 與結構段的 mut2/mut3/mut1 **逐字相同**,
#    只是換一組 oracle 跑;真正只在行為段出現的突變是 ⑧a ⑧b ⑧c ⑩ ⑬ 五發。
#      ④(S2a-4 併入後)**中途失敗不會留下半套狀態**:故障注入 marker 在 COMMIT 之前 ⇒
#        欄名集合 / CHECK 具名集合 / 七物件註解**三維逐維**回到 pre-S2a(靶⑨ 把 marker 挪到
#        COMMIT 之後,三維必須各自都不回復 —— 合併成單一指紋時「欄名那一維必然不同」會蓋掉
#        其餘兩維的判別力,項12b 另外證明註解那一維不是常數);
#        並照 **runbook 那一行真的列了什麼** 重放 forward 重建(靶⑪ 直接從 runbook 拿掉 S2a,
#        重現「清單漏了本片 ⇒ 少一欄且零告警」);gate 模式**五條**路徑實跑(項15)。
# 🔴 **回滾段的突變覆蓋(逐格,不對稱處講清楚)**:6 格中
#    項12 / 項13 / 項14 / 項16 各有對應突變靶(⑨ / ⑪ / ⑭ / ⑮);
#    **項10、項12b、項15 沒有對應突變靶**(codex 關卡2 R2 指出檔尾原本漏講項15)——
#    項10 與項12b 只被對照組證明「可以滿足」,與結構段那 10 格同級;
#    項15 的五條路徑觀察值互為對照(改壞任一條判斷會讓那一位變號),但**沒有**外部突變檔證明它。
# 🔴🔴 **災難日路徑的覆蓋範圍,講清楚**(Fable R3):runbook 說災難重建的**主情境**是出貨線已上線,
#    那時整檔重放必被 §1 閘擋下 ⇒ 真正會走的是**替代路徑 A**(手動補 BEGIN、跑 §2→§3→§4)。
#    項16/靶⑮ 釘住的是「**那段文件還在、而且它引用的數字與 migration 對得上**」——
#    **不是**「路徑 A 被實跑演練過」。項13 演練的是整檔重放,那條在主情境根本走不到。
#    ⇒ 「災難重建已被驗證」這句話**不成立**;成立的是「災難重建的說明不會無聲消失或過期」。
# 不證明:正式站行為(本機 PG17 非 Supabase);
#        🔴 rehearsal **跳過 A4a <u>與 S2b</u> 的重放**(2026-08-06 B2-S2b-3b 補上 S2b:
#        兩者都需要先做 runbook 步驟④ 的 trigger/函式拆除,不在本片;S2b 另外還會被自己的
#        三軸指紋閘擋)——跳過的是重放動作,**清單裡有沒有它們仍被斷言**;所以項13 證的是「清單列了哪些 +
#        列到且重放得動的那些長什麼樣」,不是整條步驟⑥ 都被演練過。
# 🔴 **也不證明**(Fable R3 F4):migration §4 的三族斷言在本 harness **沒有外部對應格** ——
#   4b 欄名集合、4e A1 七條定義逐字、4g 摘要表零 trigger。突變環境剝掉 §4 之後那三族零守門。
#   ⇒ 檔頭「不是靠 DO block 自我背書」指的是**本檔驗的那 17 格**,不是 §4 的全部內容。
#
# 🔴🔴 **永久警語 ①:pre-S2a 狀態只能是「排除本檔的從零 provision」** 🔴🔴
#   絕對不可以用「在已套過本片的庫上 DROP 欄 + 三條約束」當捷徑。
#   實錘(2026-08-06,Fable R3 的翻案條件② 當場實測):DROP 欄**不會還原 COMMENT** ⇒
#   上一次成功套用留下的正確註解還留在 catalog ⇒ **把整句 COMMENT 語句刪掉的突變照樣全綠**。
#   症狀跟「這族斷言根本是裝飾」長得一模一樣,而且沒有任何東西會提醒你。
#   本腳本的做法:pre-S2a 基準庫 = **只重放時間戳早於本檔的 migration 前綴**(不是「全部減本檔」——
#   後者在日後新增更晚的 migration 之後會把它們一起套進「pre-S2a」,定義靜默漂移),
#   每個案例都用 `CREATE DATABASE … TEMPLATE` 從它複製一份乾淨副本。
#
# 🔴🔴 **永久警語 ②:突變必須先剝掉 migration 自己的 §4 結構驗收 DO block** 🔴🔴
#   否則突變會先被 migration 的自我檢查擋下、apply 直接 abort ⇒
#   你證明的是「migration 會自我檢查」(S2a-1 已證),**不是**「本 harness 的 oracle 有判別力」。
#   剝除本身也要有對照組:MUT0 = 只剝不改,所有 oracle 必須全綠。
#
# 🔴 判定紀律(A1 / A7-t 家族既有教訓,不重蹈)
#  ① 突變必須**紅在指定的那一格**,不是「反正紅了就算抓到」。
#  ② 每個突變都要驗「真的改到東西」:**比對象是 mut0(只剝不改的基準),不是原檔** ——
#     比原檔恆為不同(因為一律先剝 §4)⇒ 那道守門會恆真、從來不可能觸發(code-reviewer R1 實錘)。
#     另有一道真守門在 make_mutant 內:取代錨必須**恰命中一次**(assert n == 1)。
#  ③ 對照組必跑:沒有對照組,全紅毫無意義。
#  ④ 格數由本腳本**自斷言**(見 EXPECT_*),不靠人去數輸出 —— 少跑一格自己紅。
# ============================================================
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

MODE="${1:?用法: b2s2a-verify.sh all|run <workdir>  或  b2s2a-verify.sh gate <目標連線字串>}"
# 🔴 白名單:原本「非 all 一律當 run」⇒ 打成 alll 會靜默重用舊基準庫而不是重新 provision。
case "$MODE" in all|run|gate) : ;; *) echo "🔴 MODE 只能是 all / run / gate(收到:$MODE)" >&2; exit 2 ;; esac

# ══ gate 模式:apply 當下的唯讀前置閘(Fable R3 F1)══════════════════════════
# 🔴 為什麼要有這個模式:all/run 的前置閘只跑在**本腳本自己 provision 的拋棄庫**上
#    (身分閘保證了這件事)⇒ 它在正式站 apply 當下**結構上不可能被執行**,
#    等於一道永不觸發的死保險。判準要能在要緊的那一刻真的跑,才不是文件。
# 用法(正式站):設好 libpq 標準環境變數 + `~/.pgpass`,然後**不帶任何連線參數**跑
#     PGHOST=… PGPORT=… PGDATABASE=… PGUSER=… scripts/b2s2a-verify.sh gate
#   本機拋棄庫可用:scripts/b2s2a-verify.sh gate "postgresql://postgres@127.0.0.1:54355/xxx"
# 🔴 唯讀:只跑兩個 count(*),不建庫、不建表、不下任何 DDL、不寫任何資料。
if [ "$MODE" = "gate" ]; then
  # 🔴🔴 **憑證一律不進 argv**(codex 關卡2 R2 打掉我上一輪的半吊子修法):
  #   上一輪我改成「優先吃 B2S2A_GATE_URL」,但那個值最後仍被展開成 `psql "$URL"` 的參數 ⇒
  #   同機 `ps` 照樣看得到完整 URI;而 `export B2S2A_GATE_URL=…` 本身也還是進了 shell history。
  #   真正的修法是**根本不要傳連線字串**:psql/libpq 原生會讀 PGHOST/PGPORT/PGDATABASE/PGUSER
  #   與 `~/.pgpass`(權限 600、不進 argv、不進 history)⇒ 正式站走這條,psql 命令列上零憑證。
  #   位置參數保留給**本機拋棄庫**(無密碼),它會覆寫環境設定 —— 這是覆寫關係,不是「環境優先」。
  GATE_URL="${2:-}"
  if [ -n "$GATE_URL" ]; then
    set -- "$GATE_URL"                 # 本機拋棄庫:連線字串當參數
    GATE_SRC="位置參數(僅限本機無密碼拋棄庫)"
  else
    set --                             # 正式站:零參數,完全靠 libpq 環境變數 + .pgpass
    GATE_SRC="libpq 環境變數 PGHOST=${PGHOST:-未設} PGPORT=${PGPORT:-未設} PGDATABASE=${PGDATABASE:-未設} PGUSER=${PGUSER:-未設}"
    [ -n "${PGHOST:-}${PGDATABASE:-}${PGSERVICE:-}" ] || {
      echo "🔴 gate 模式沒有目標:請設 libpq 環境變數(PGHOST/PGDATABASE/PGUSER,密碼放 ~/.pgpass)" >&2
      echo "   或對**本機拋棄庫**用 b2s2a-verify.sh gate \"<連線字串>\"(該寫法會讓憑證進 argv,勿用於正式站)" >&2
      exit 2; }
  fi
  # 🔴 psql 的 exit code 要**顯式接**(codex 關卡2):原本只看合併輸出猜成功與否 ——
  #    非零退出但輸出剛好是純數字時會被當成查詢成功 ⇒ 前置閘在連線半壞時放行。
  # 🔴🔴 **每一種結局都要印出「我到底連到誰」**(Fable R3 must-fix,實跑實錘):
  #   零參數模式吃的是**當下 shell 殘留的 PG* 變數**。operator 剛跑完本機拋棄庫、
  #   PGHOST/PGDATABASE 還留著,再跑一次 gate 就會對**錯的庫**拿到 0/0 → exit 0,
  #   然後帶著「正式站已過閘」的錯誤結論去對有真實出貨資料的正式站 apply DEFAULT 0。
  #   (只設 PGHOST 忘了 PGDATABASE 時,libpq 預設連 OS 使用者同名庫 —— 同型錯目標。)
  #   實錘:`PGHOST=127.0.0.1 PGPORT=54355 PGDATABASE=s2a_ctl … gate` 對拋棄庫回了 ✅ 且零識別。
  GATE_WHO="$(psql -X "$@" -qtAc "SELECT current_database()||' @ '||coalesce(host(inet_server_addr())||':'||inet_server_port()::text,'(local socket)')||' as '||current_user" 2>&1)"
  [ -n "$GATE_SRC" ] || GATE_SRC="未知"
  gn_ship="$(psql -X "$@" -qtAc 'SELECT count(*) FROM public.shipments' 2>&1)";      rc_ship=$?
  gn_item="$(psql -X "$@" -qtAc 'SELECT count(*) FROM public.shipment_items' 2>&1)"; rc_item=$?
  echo "🎯 連線目標:${GATE_WHO}(連線來源:${GATE_SRC})"
  echo "   🔴 **動手前先確認上面這一行就是你要驗的那個庫** —— 不是的話立刻停,不要往下走。"
  if [ "$rc_ship" -ne 0 ] || [ "$rc_item" -ne 0 ]; then
    echo "🔴 查詢出貨表失敗(psql rc:shipments=$rc_ship shipment_items=$rc_item)—— 當成不通過" >&2
    echo "   shipments=[$gn_ship] shipment_items=[$gn_item]" >&2; exit 3
  fi
  # 🔴 兩個值**各自**驗(codex 關卡2 R2):串接後再驗空值時,只有一邊是空字串不會進這個分支,
  #    會掉到下面被誤報成「資料非零」—— 仍然 exit 3,但錯因講錯會讓人往錯的方向查。
  case "${gn_ship}" in ""|*[!0-9]*) echo "🔴 查不到 shipments 列數([$gn_ship])—— 當成不通過" >&2; exit 3 ;; esac
  case "${gn_item}" in ""|*[!0-9]*) echo "🔴 查不到 shipment_items 列數([$gn_item])—— 當成不通過" >&2; exit 3 ;; esac
  if [ "$gn_ship" != "0" ] || [ "$gn_item" != "0" ]; then
    echo "🛑 apply 前置閘不通過:shipments=$gn_ship / shipment_items=$gn_item"
    echo "   → **停,問人**。有真實資料時 B2-S2a 的 DEFAULT 0 語意要重新確認 —— 這不是技術問題,是決定。"
    echo "   (DB 層另有一道精確的 fail-closed 閘在 migration §1:有效已寄出的品項列數必須為 0。)"
    exit 3
  fi
  echo "✅ apply 前置閘通過:shipments=0 / shipment_items=0(唯讀查詢,未寫入任何資料)"
  echo "   目標 = ${GATE_WHO} —— 這一行必須就是你要 apply 的那個庫,否則本次通過無效。"
  exit 0
fi
WORK="${2:?缺 workdir(必須是 /tmp 直屬短路徑,例 /tmp/b2s2av)}"
PORT="${PORT:?🔴 PORT 必須顯式帶(a1/a4a 共用 54329 的同埠地雷;本家族用 543xx 未占用埠)}"
MIG="supabase/migrations/20260806100000_m4b_e10_b2_s2a_summary_shipped_quantity.sql"
SUMMARY="public.order_item_quantity_summary"
export LC_ALL=C
# 🔴 使用者的 ~/.psqlrc 可以覆寫 ON_ERROR_STOP / 輸出格式,甚至執行額外命令 ⇒ 整支的比對值都會漂。
#    一行擋掉,比逐處加 -X 不容易漏(codex 關卡2)。
# 🔴 每個 psql 呼叫點都帶 -X(codex 關卡2 R2:`PSQLRC=/dev/null` 只換掉使用者 rc,
#    **system-wide psqlrc 照樣載入**,仍可改輸出、覆寫變數、執行命令 ⇒ 比對值會漂)。
export PSQLRC=/dev/null   # 第二道,不是唯一那道

BASE_URL="postgresql://postgres@127.0.0.1:${PORT}/postgres"     # pre-S2a 基準(template 來源)
ADMIN_URL="postgresql://postgres@127.0.0.1:${PORT}/template1"   # 只用來 CREATE/DROP DATABASE

# ══ 凍結的期望格數(F2:harness 自斷言,不靠人寫死的結語)═══════════════════
EXPECT_STRUCT=17   # 一次結構驗收跑幾格(項1 ×1 + 項2 ×3 + 項3 ×1 + 項9 ×12)
EXPECT_SRC=3       # 項9b:原始碼註解錨 3 條
EXPECT_MUT=6       # 結構段突變靶:MUT0 對照 + 靶①②③④⑤
EXPECT_BEH=6       # 行為段格數:項 4 / 5 / 6 / 7 / 7b(**五格真的碰受測 DB**)+ 項 8(純代數 smoke,不碰 DB)
EXPECT_BEH_MUT=8   # 行為段突變靶:⑥ ⑦ ⑧a ⑧b ⑧c ⑩ + ⑫⑬(補上原本沒有突變殺得死的 B6 / B7b)
EXPECT_ROLL=7      # 回滾/故障注入段格數:項 10 / 12 / 12b / 13 / 14 / 15(gate 五路徑)/ 16(災難日路徑 A)
EXPECT_ROLL_MUT=4  # 該段突變靶:⑨(marker 挪到 COMMIT 之後)⑪(runbook 拿掉 S2a)⑭(前置閘段落降級)⑮(刪掉路徑 A 整段)
# 🔴 全跑一輪**應該通過哪些格**(逐 key 凍結,不是只凍結總數;codex 關卡2 R2:
#    只凍結總數時「刪掉一個具名檢查 + 另一個 ok 重複一次」照樣得到 15 —— 與紅格那條同一個病)。
EXPECT_PASS_KEYS="ID-GATE PRE-S2A CTL-STRUCT SRC-ANCHOR-1 SRC-ANCHOR-2 SRC-ANCHOR-3 \
MUT-0 MUT-1 MUT-2 MUT-3 MUT-4 MUT-5 MUT-COUNT BASE-CLEAN COPIES-DROPPED \
BEH-CTL BEH-MUT-6 BEH-MUT-7 BEH-MUT-8a BEH-MUT-8b BEH-MUT-8c BEH-MUT-10 BEH-MUT-12 BEH-MUT-13 BEH-MUT-COUNT \
R10-rerun R12-fault R12b-fpdim R13-rehearsal R14-applynote R15-gate R16-pathA \
ROLL-MUT-9 ROLL-MUT-11 ROLL-MUT-14 ROLL-MUT-15 ROLL-MUT-COUNT"

PASS=0; FAIL=0; MUT=0; STRUCT_RUN=0; SRC_RUN=0
# 🔴 七物件註解的凍結指紋(**測量值**,2026-08-06 對照組實跑取得)。
#    Sean 2026-08-06 Q2=A:測量值寫在 harness 與報告、不回填 plan。
#    🔴 原版是「對照組自己算出來再跟自己比」⇒ 對照組那一格**恆綠、零判別力**(codex 關卡2 R1 同型病)。
#    改成凍結常數後:任何 COMMENT 合法改動都會讓對照組**大聲轉紅**,必須有人回來改這一行 —— 那是設計。
COMMENT_FP="f5798812892bb484b52083ad068a48a6"
PASS_KEYS=""
ok()  { PASS_KEYS="$PASS_KEYS $1"; printf '  ✅ %s\n' "$2"; PASS=$((PASS+1)); }
bad() { printf '  🔴 %s\n' "$1"; FAIL=$((FAIL+1)); }
log() { echo "== $* =="; }
die() { echo "🔴 $*" >&2; exit 1; }

q() { psql -X "$1" -qtA -c "$2" 2>&1; }

# ══ 0a. workdir 與埠的硬閘 ═══════════════════════════════════════════════════
# 🔴 先驗 canonical 整數再談黑名單(codex 關卡2 R2):
#    「054329」會繞過黑名單、含空白的值會被塞進 `pg_ctl -o` 當額外啟動選項。
case "$PORT" in
  ""|*[!0-9]*) die "PORT 必須是純數字(收到:[$PORT])" ;;
  0*) die "PORT 不得有前導零(收到:$PORT)—— 前導零可繞過下面的保留埠黑名單" ;;
esac
[ "$PORT" -ge 1024 ] && [ "$PORT" -le 65535 ] || die "PORT 必須介於 1024-65535(收到:$PORT)"
case "$PORT" in
  54329|54331|54342) die "埠 $PORT 是既有 harness 的地雷(a1/a4a/d1t2 共用),換一個" ;;
esac
while [ "${WORK%/}" != "$WORK" ]; do WORK="${WORK%/}"; done
[ -L "$WORK" ] && die "workdir 不得是 symlink(收到:$WORK)"
[ -L "$WORK/.b2s2a-throwaway" ] && die "ownership marker 不得是 symlink —— 預埋 symlink 可繞過 marker 閘"
case "$WORK" in /tmp/?*) : ;; *) die "workdir 必須在 /tmp 底下(本腳本會 rm -rf 它)" ;; esac
case "$WORK" in /tmp/*/*) die "workdir 必須是 /tmp 的直屬子目錄" ;; esac
case "$WORK" in *..*) die "workdir 不得含 .." ;; esac
[ ${#WORK} -le 40 ] || die "workdir 太長(${#WORK})—— unix socket 路徑上限 103 bytes"
test -f "$MIG" || die "找不到 $MIG"
# 🔴 把受測 migration 釘在已 commit 的那一版(code-reviewer R1 must-fix):
#    §2 定義與 §3 COMMENT 有凍結字面擋著,但 §1 gate、§4 DO block、檔尾 rollback 區塊
#    被改動時**沒有任何一格會紅** ⇒ 本 harness 會安靜地在驗一份不是它以為的檔案。
MIG_SHA_FROZEN="a93ff0a3d1e9277f53848b735bbb887ec164fd0712f7861f9f5edd0d979b7690"
MIG_SHA_NOW="$(shasum -a 256 "$MIG" | awk '{print $1}')"
[ "$MIG_SHA_NOW" = "$MIG_SHA_FROZEN" ] || die "受測 migration 已被改動 —— 凍結 sha256 $MIG_SHA_FROZEN / 實測 $MIG_SHA_NOW。
   本 harness 的凍結值**全部**綁在那一版,逐項是:
     ①三條新 CHECK 的 constraintdef 字面 ②CHECK 具名集合(項3)③七個必含註解錨
     ④四個排除舊字面 ⑤註解指紋 COMMENT_FP ⑥剝除行數 STRIP_LINES_FROZEN
     ⑦五個突變的取代錨 ⑧EXPECT_STRUCT / EXPECT_SRC / EXPECT_MUT / EXPECT_PASS_KEYS
     ⑨三條原始碼註解錨(項9b)⑩時間序前綴 cutoff
   改了 migration 就必須回頭把這些一起更新,**不是把這道閘拿掉**。"

MARK="$WORK/.b2s2a-throwaway"
# 🔴 marker 不只要存在、還要**內容相符**(codex 關卡2 R2:埠連不上時完全沒驗身分,
#    只憑一個空 marker 就 pg_ctl stop + rm -rf 整個 workdir)。
MARK_SIG="b2s2a-verify.sh throwaway cluster — 本目錄可被本腳本 rm -rf"
CIDFILE="$WORK/cluster-id"
PGBIN="$(dirname "$(command -v initdb 2>/dev/null || echo /opt/homebrew/opt/postgresql@17/bin/initdb)")"

# ══ 0b. provision:pre-S2a 基準庫(**排除本檔**的從零全套重放)════════════════
if [ "$MODE" = "all" ]; then
  if [ -e "$WORK" ]; then
    [ -f "$MARK" ] || die "$WORK 已存在但缺 ownership marker($MARK)—— 不是本腳本建的,拒絕 rm -rf"
    [ "$(cat "$MARK" 2>/dev/null)" = "$MARK_SIG" ] \
      || die "$WORK 的 marker 內容不符(可能是預埋的空檔)—— 拒絕 rm -rf"
    # 🔴 只有在 pgdata 真的是一個 PG 資料目錄時才動它;否則那個路徑不是我們以為的東西。
    if [ -e "$WORK/pgdata" ] && [ ! -f "$WORK/pgdata/PG_VERSION" ]; then
      die "$WORK/pgdata 存在但不是 PG 資料目錄(無 PG_VERSION)—— 拒絕 pg_ctl stop / rm -rf"
    fi
  fi
  [ -L "$WORK/pgdata" ] && die "pgdata 不得是 symlink —— 會讓 rm -rf 打到別人的資料目錄"
  # 🔴 停機前先確認埠上那台**是本 workdir 的**(codex 關卡2:原版先停再驗,順序反了)。
  if psql -X "$BASE_URL" -qtA -c 'SELECT 1' >/dev/null 2>&1; then
    RUNNING_DD="$(psql -X "$BASE_URL" -qtAc 'SHOW data_directory' 2>/dev/null)"
    case "$RUNNING_DD" in
      "$WORK/pgdata"|"$(cd "$WORK" 2>/dev/null && pwd -P)/pgdata") : ;;
      *) die "埠 $PORT 上活著的 postmaster 的 data_directory 是 [$RUNNING_DD],不是 $WORK/pgdata —— 不停別人的" ;;
    esac
  fi
  if [ -d "$WORK/pgdata" ]; then
    "$PGBIN/pg_ctl" -D "$WORK/pgdata" stop -m fast >/dev/null 2>&1 || true
    sleep 1
  fi
  if psql -X "$BASE_URL" -qtA -c 'SELECT 1' >/dev/null 2>&1; then
    die "埠 $PORT 上仍有活著的 postmaster 且不是本 workdir 的 —— 不硬殺別人的,停下"
  fi
  log "0/9 provision pre-S2a 基準庫(port ${PORT};**排除 ${MIG##*/}**)"
  rm -rf "$WORK"; mkdir -p "$WORK"; printf '%s\n' "$MARK_SIG" > "$MARK"
  "$PGBIN/initdb" --version | grep -q ' 17\.' || die "PATH 的 initdb 非 PG17"
  psql -X --version | grep -q ' 17\.' || die "PATH 的 psql 非 PG17(協定相容但錯誤字面可能漂)"
  "$PGBIN/initdb" -U postgres --auth=trust --locale=C --encoding=UTF8 -D "$WORK/pgdata" >/dev/null 2>&1 \
    || die "initdb 失敗"
  "$PGBIN/pg_ctl" -D "$WORK/pgdata" -l "$WORK/pg.log" \
    -o "-p ${PORT} -c unix_socket_directories='${WORK}'" start >/dev/null \
    || { cat "$WORK/pg.log" >&2; die "pg_ctl 啟動失敗"; }
  psql -X "$BASE_URL" -v ON_ERROR_STOP=1 -q -f scripts/d1-supabase-shim.sql || die "shim 失敗"
  # 🔴 fitments 相容 stub 的插序沿用 d1t2 家族(public.product_fitments_effective 在 repo 內
  #    沒有任何建立來源,backlog #299)⇒ 這裡的「全綠」不等於「repo 能從零重建正式站 schema」。
  FIRST_FITMENTS="$(grep -l 'product_fitments_effective' supabase/migrations/*.sql | sort | head -1)"
  for f in supabase/migrations/*.sql; do
    case "$f" in *20260723120000*|*20260809170000*) continue ;; esac  # skip pg_cron-dependent: settle sweeper + L3b schedule (bare PG has no pg_cron; L3a fn still replayed)
    # 🔴 pre-S2a 的正確定義 = **時間戳早於本檔**的前綴,不是「全部減本檔」(codex 關卡2):
    #    後者在日後新增更晚的 migration 之後會把它們一起套進「pre-S2a」,定義靜默漂移。
    case "$(basename "$f")" in
      [0-9]*) TS="${f##*/}"; TS="${TS%%_*}" ;;
      *) die "migration 檔名不是時間戳開頭:$f" ;;
    esac
    [ "$TS" \< "20260806100000" ] || continue
    if [ "$f" = "$FIRST_FITMENTS" ]; then
      psql -X "$BASE_URL" -v ON_ERROR_STOP=1 -q -f scripts/d1-fitments-bootstrap.sql || die "fitments bootstrap 失敗"
    fi
    psql -X "$BASE_URL" -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null || die "migration 失敗:$f"
  done
  # 🔴 行為段(§7)的 fixture 來源:d1t2 seed。放進**基準庫**,讓每份副本都帶著它。
  #    不影響結構段:seed 不建任何 shipments / shipment_items(前置閘仍看到 0 / 0)。
  pnpm exec tsx scripts/d1t2-seed.ts > "$WORK/seed.sql" 2>"$WORK/seed.err" \
    || die "seed 產生失敗(見 $WORK/seed.err)"
  test -s "$WORK/seed.sql" || die "seed.sql 為空"
  psql -X "$BASE_URL" -v ON_ERROR_STOP=1 -q -f "$WORK/seed.sql" >/dev/null || die "seed 套用失敗"
  [ "$(q "$BASE_URL" 'SELECT count(*) FROM public.order_items')" = "41" ] \
    || die "seed 後 order_items 應為 41 列,實為 $(q "$BASE_URL" 'SELECT count(*) FROM public.order_items')"
  psql -X "$BASE_URL" -qtAc 'SELECT system_identifier FROM pg_control_system()' > "$CIDFILE"
else
  [ -f "$MARK" ] || die "run 模式需要既有基準庫($WORK 缺 marker);先跑 all"
  [ "$(cat "$MARK" 2>/dev/null)" = "$MARK_SIG" ] || die "$WORK 的 marker 內容不符;拒絕重用"
fi

# ══ 0c. 身分閘(marker / cluster-id / datadir / db / locale)═════════════════
[ -f "$MARK" ] || die "$WORK 缺 ownership marker;拒絕動任何 DDL"
[ "$(cat "$MARK" 2>/dev/null)" = "$MARK_SIG" ] || die "$WORK 的 marker 內容不符;拒絕動任何 DDL"
psql -X "$BASE_URL" -qtA -c 'SELECT 1' >/dev/null 2>&1 || die "連不上 $BASE_URL(先跑 all)"
CID="$(psql -X "$BASE_URL" -qtAc 'SELECT system_identifier FROM pg_control_system()' 2>/dev/null)"
[ -n "$CID" ] || die "讀不到 cluster system_identifier"
[ -f "$CIDFILE" ] || die "缺 $CIDFILE —— 無法確認這是本腳本 provision 的拋棄式 cluster"
[ "$CID" = "$(cat "$CIDFILE")" ] || die "cluster 身分不符(實 $CID / 期望 $(cat "$CIDFILE"))—— 零寫入退出"
canon() { [ -d "$1" ] && (cd "$1" && pwd -P) || echo "$1"; }
[ "$(canon "$(q "$BASE_URL" 'SHOW data_directory')")" = "$(canon "$WORK")/pgdata" ] \
  || die "port ${PORT} 的 data_directory 不是 $WORK/pgdata;拒跑"
[ "$(q "$BASE_URL" 'SHOW lc_messages')" = "C" ] || die "lc_messages 非 C(錯誤字面比對會漂)"
# 🔴 伺服器版本要在**兩個模式**都驗(原本只在 all 驗 initdb 版本;run 可重用非 PG17 cluster)。
case "$(q "$BASE_URL" 'SHOW server_version')" in 17.*) : ;; *) die "伺服器非 PG17(實為 $(q "$BASE_URL" 'SHOW server_version'))" ;; esac
ok ID-GATE "身分閘通過(marker 內容 + cluster-id + datadir + locale + server 版本)"

# ══ 0d. 基準庫真的是 pre-S2a(不是「以為是」)═══════════════════════════════
[ "$(q "$BASE_URL" "SELECT count(*) FROM pg_attribute WHERE attrelid='${SUMMARY}'::regclass AND attname='shipped_quantity' AND NOT attisdropped")" = "0" ] \
  || die "基準庫已經有 shipped_quantity 欄 —— 它不是 pre-S2a,整支 harness 的判別力歸零(見檔頭警語①)"
[ "$(q "$BASE_URL" "SELECT position('強制點未定案' IN col_description('public.shipment_items'::regclass,(SELECT attnum FROM pg_attribute WHERE attrelid='public.shipment_items'::regclass AND attname='shipped_quantity')))>0")" = "t" ] \
  || die "基準庫的 shipment_items 註解已經不是 S1b 原文 —— pre-S2a 前提不成立(見檔頭警語①)"
# 🔴 run 模式重用舊 base 時,若那座是 seed 之前的版本,行為段會炸在「fixture 缺 order_items」
#    而不是「base 過期」—— 錯誤訊息指錯方向。在這裡就擋掉。
[ "$(q "$BASE_URL" 'SELECT count(*) FROM public.order_items')" = "41" ] \
  || die "基準庫的 order_items 不是 41 列(實 $(q "$BASE_URL" 'SELECT count(*) FROM public.order_items'))—— 這座 base 沒帶 seed 或版本過期,重跑 all"
ok PRE-S2A "基準庫確認為乾淨 pre-S2a(無 shipped_quantity 欄 + shipment_items 仍是 S1b 舊註解 + seed 41 列)"

# ══ 0e. 🔴 apply 前置閘(Fable R3 F1;本片唯一的「停下問人」判準)═════════════
# 判準逐字:**apply 當下任一出貨表非 0 → 停、問人。**
# 這條是保守面、交人決定;DB 層另有一道精確的 fail-closed 閘寫在 migration §1
#(有效已寄出的**品項列數**必須為 0)。
# 🔴 兩者刻意不同:草稿箱有品項但**未寄出**時真值仍為 0,不該被裸列數擋下來 ——
#    但那種狀態值得一個人看一眼,所以保守判準放這裡、精確判準放 DB。
# 🔴 **這裡這一份恆為 0、沒有守門價值**(Fable R3 F1):身分閘已保證只有本腳本 provision 的
#    拋棄庫走得到這裡 ⇒ 它在正式站 apply 當下**結構上不可能執行**。留著只是讓輸出完整。
#    **真正要在 apply 當下跑的是 `gate` 模式**(見檔案上方),對正式站唯讀查兩張表。
#    ✅ S2a-4 已把它寫成 runbook 的**必跑步驟**(`docs/runbooks/a4a-summary-rollback.md`
#    「B2-S2a apply 前置步驟」),由本檔項14 斷言那一段還在且還是必跑語氣、靶⑭ 證明該格有判別力。
SHIPMENTS_N="$(q "$BASE_URL" 'SELECT count(*) FROM public.shipments')"
SHIPITEMS_N="$(q "$BASE_URL" 'SELECT count(*) FROM public.shipment_items')"
if [ "$SHIPMENTS_N" != "0" ] || [ "$SHIPITEMS_N" != "0" ]; then
  echo "🛑 apply 前置閘:出貨表非 0(shipments=$SHIPMENTS_N / shipment_items=$SHIPITEMS_N)"
  echo "   → **停,問人**。有真實資料時本片 DEFAULT 0 的語意要重新確認,不是技術問題、是決定。"
  exit 3
fi
echo "  ℹ️  apply 前置閘:兩張出貨表皆 0 列(shipments=$SHIPMENTS_N / shipment_items=$SHIPITEMS_N)"
echo "     🔴 這在從零 provision 的拋棄庫上**恆真**,所以不計入 PASS —— 真正的執行時機是正式站 apply 當下。"

# ══ 共用:從基準庫複製一份乾淨副本 ═══════════════════════════════════════════
# 🔴 不用命令替換回傳 URL:die 在子 shell 裡 exit 只殺得掉子 shell,父 shell 會帶著空字串繼續跑。
#    改成設全域 FRESH_URL。
FRESH_URL=""
fresh_db() {   # $1 = db 名 → 設 FRESH_URL
  psql -X "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS $1" >/dev/null 2>&1
  # 前一個 psql backend 偶爾還沒完全退出 ⇒ "source database is being accessed by other users"。
  # 重試一次(仍失敗才 die;不假綠,只是避免偶發紅在無關處)。
  if ! psql -X "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE $1 TEMPLATE postgres" >/dev/null 2>&1; then
    sleep 1
    psql -X "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE $1 TEMPLATE postgres" >/dev/null 2>&1 \
      || die "CREATE DATABASE $1 TEMPLATE postgres 兩次都失敗(基準庫可能還有連線沒關)"
  fi
  FRESH_URL="postgresql://postgres@127.0.0.1:${PORT}/$1"
}
drop_db() { psql -X "$ADMIN_URL" -q -c "DROP DATABASE IF EXISTS $1" >/dev/null 2>&1; }

# 🔴 七物件註解指紋的 SQL **只在這裡寫一次**(codex 關卡2:原本比對用與印給人看的抄了兩份,
#    改一處漏另一處就會「印出來的數字不是比對用的數字」)。
#    ORDER BY 放進 string_agg 內 —— 放在子查詢是靠未保證的順序保留。
fp_sql() {
  printf "SELECT md5(string_agg(t.c, E'\\n' ORDER BY t.i)) FROM (%s) t" \
    "SELECT 1 AS i, COALESCE($(comment_sql COL:summary.shipped_quantity),'-') AS c
     UNION ALL SELECT 2, COALESCE($(comment_sql TABLE:summary),'-')
     UNION ALL SELECT 3, COALESCE($(comment_sql COL:summary.quantity),'-')
     UNION ALL SELECT 4, COALESCE($(comment_sql FK:summary.item_fk),'-')
     UNION ALL SELECT 5, COALESCE($(comment_sql C:oiqs_instock_cancelled_le_quantity),'-')
     UNION ALL SELECT 6, COALESCE($(comment_sql C:oiqs_cancelled_shipped_le_quantity),'-')
     UNION ALL SELECT 7, COALESCE($(comment_sql COL:shipment_items.shipped_quantity),'-')"
}

# ══ 共用:結構 oracle(**外部**斷言,不看 migration 自己那段 DO block)═════════
# 回傳 0 = 全格通過;非 0 = 有格紅。紅的格會印出「哪一格 + 期望 vs 實際」。
comment_sql() {  # $1 = key → 產生取該物件註解的 SQL 片段
  case "$1" in
    COL:summary.shipped_quantity) echo "col_description('${SUMMARY}'::regclass,(SELECT attnum FROM pg_attribute WHERE attrelid='${SUMMARY}'::regclass AND attname='shipped_quantity'))" ;;
    TABLE:summary)                echo "obj_description('${SUMMARY}'::regclass,'pg_class')" ;;
    COL:summary.quantity)         echo "col_description('${SUMMARY}'::regclass,(SELECT attnum FROM pg_attribute WHERE attrelid='${SUMMARY}'::regclass AND attname='quantity'))" ;;
    FK:summary.item_fk)           echo "(SELECT obj_description(oid,'pg_constraint') FROM pg_constraint WHERE conrelid='${SUMMARY}'::regclass AND conname='order_item_quantity_summary_item_fk')" ;;
    C:oiqs_instock_cancelled_le_quantity) echo "(SELECT obj_description(oid,'pg_constraint') FROM pg_constraint WHERE conrelid='${SUMMARY}'::regclass AND conname='oiqs_instock_cancelled_le_quantity')" ;;
    C:oiqs_cancelled_shipped_le_quantity) echo "(SELECT obj_description(oid,'pg_constraint') FROM pg_constraint WHERE conrelid='${SUMMARY}'::regclass AND conname='oiqs_cancelled_shipped_le_quantity')" ;;
    COL:shipment_items.shipped_quantity)  echo "col_description('public.shipment_items'::regclass,(SELECT attnum FROM pg_attribute WHERE attrelid='public.shipment_items'::regclass AND attname='shipped_quantity'))" ;;
    *) die "comment_sql:未知 key $1(新增物件時忘了加分支)" ;;
  esac
}

# 🔴 回傳紅格數,並把**紅在哪一格**的機器可辨識 ID 寫進全域 REDS_IDS(codex 關卡2 must-fix:
#    原版只比紅格「數量」⇒ 指定格失效、另一格意外轉紅但總數相同時照樣 PASS,
#    等於檔頭判定紀律① 那句「必須紅在指定的那一格」從來沒有被機器檢查過)。
REDS_IDS=""
red() { printf '     ▸ [%s] %s\n' "$TAG" "$2"; REDS_IDS="$REDS_IDS $1"; reds=$((reds+1)); }
struct_oracle() {  # $1 = URL、$2 = 情境標籤;回傳紅格數,同時設 REDS_IDS
  local U="$1" TAG="$2" reds=0 got exp key sqlfrag
  STRUCT_RUN=0; REDS_IDS=""

  # ── 項 1:新欄形狀逐字 ──
  got="$(q "$U" "SELECT COALESCE(format_type(a.atttypid,a.atttypmod)||CASE WHEN a.attnotnull THEN '/NOT NULL' ELSE '/NULL' END||'/DEFAULT '||COALESCE(pg_get_expr(d.adbin,d.adrelid),'(none)'),'(欄不存在)') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid='${SUMMARY}'::regclass AND a.attname='shipped_quantity' AND a.attnum>0 AND NOT a.attisdropped")"
  STRUCT_RUN=$((STRUCT_RUN+1))
  if [ "$got" = "integer/NOT NULL/DEFAULT 0" ]; then :; else
    red "C1-col" "$(printf '項1 欄形狀:期望「integer/NOT NULL/DEFAULT 0」實為「%s」' "$got")"
  fi

  # ── 項 2:三條新 CHECK 的定義逐字 ──
  while IFS='|' read -r key exp; do
    [ -n "$key" ] || continue
    got="$(q "$U" "SELECT COALESCE((SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='${SUMMARY}'::regclass AND conname='$key' AND contype='c' AND convalidated),'(缺漏或未 validated)')")"
    STRUCT_RUN=$((STRUCT_RUN+1))
    if [ "$got" != "$exp" ]; then
      red "C2-$key" "$(printf '項2 %s:期望「%s」實為「%s」' "$key" "$exp" "$got")"
    fi
  done <<'EOF'
oiqs_shipped_nonneg|CHECK ((shipped_quantity >= 0))
oiqs_shipped_le_instock|CHECK ((shipped_quantity <= instock_quantity))
oiqs_cancelled_shipped_le_quantity|CHECK ((((cancelled_quantity)::bigint + (shipped_quantity)::bigint) <= (quantity)::bigint))
EOF

  # ── 項 3:CHECK 具名集合**雙向**恰等十條(偷加第十一條或砍一條都要紅)──
  got="$(q "$U" "SELECT string_agg(conname,',' ORDER BY conname) FROM pg_constraint WHERE conrelid='${SUMMARY}'::regclass AND contype='c'")"
  exp='oiqs_cancelled_le_quantity,oiqs_cancelled_nonneg,oiqs_cancelled_shipped_le_quantity,oiqs_instock_cancelled_le_quantity,oiqs_instock_le_ordered,oiqs_instock_nonneg,oiqs_ordered_le_quantity,oiqs_ordered_nonneg,oiqs_shipped_le_instock,oiqs_shipped_nonneg'
  STRUCT_RUN=$((STRUCT_RUN+1))
  if [ "$got" != "$exp" ]; then
    red "C3-set" "$(printf '項3 CHECK 具名集合不符:\n        期望 %s\n        實為 %s' "$exp" "$got")"
  fi

  # ── 項 9:七個物件的 COMMENT ──
  #   9a 逐物件「必含新錨」;**9-excl** 四個物件「不得含舊字面」;9c 全集指紋
  #   🔴 內部這組叫 9-excl,不叫 9b —— plan 的「項9b」是**原始碼**註解錨(見 §2),兩者不同東西。
  #   🔴 錨與 migration 檔內 DO block 用的是**同一組語意**但這裡是外部獨立查詢:
  #      migration 那段被整個刪掉時,這裡照樣會紅(MUT0 對照組就是在證這件事)。
  while IFS='|' read -r key exp; do
    [ -n "$key" ] || continue
    sqlfrag="$(comment_sql "$key")"
    got="$(q "$U" "SELECT CASE WHEN $sqlfrag IS NULL THEN '(無註解)' WHEN position('$exp' IN $sqlfrag)>0 THEN 'OK' ELSE '(缺錨)' END")"
    STRUCT_RUN=$((STRUCT_RUN+1))
    if [ "$got" != "OK" ]; then
      red "C9a-$key" "$(printf '項9a %s:%s —— 缺新錨「%s」' "$key" "$got" "$exp")"
    fi
  done <<'EOF'
COL:summary.shipped_quantity|大線 B2-S2b
TABLE:summary|四個 0
COL:summary.quantity|**四條直接跟 quantity 比**
FK:summary.item_fk|**四個數量**
C:oiqs_instock_cancelled_le_quantity|契約債 ① 已清償
C:oiqs_cancelled_shipped_le_quantity|代數冗餘
COL:shipment_items.shipped_quantity|oiqs_shipped_le_instock
EOF

  while IFS='|' read -r key exp; do
    [ -n "$key" ] || continue
    sqlfrag="$(comment_sql "$key")"
    got="$(q "$U" "SELECT CASE WHEN $sqlfrag IS NULL THEN '(無註解)' WHEN position('$exp' IN $sqlfrag)>0 THEN '(舊字面仍在)' ELSE 'OK' END")"
    STRUCT_RUN=$((STRUCT_RUN+1))
    if [ "$got" != "OK" ]; then
      red "C9x-$key" "$(printf '項9-excl %s:%s —— 舊字面「%s」' "$key" "$got" "$exp")"
    fi
  done <<'EOF'
TABLE:summary|三個 0
COL:summary.quantity|讓四條「跟 quantity 比」
FK:summary.item_fk|三個數量
COL:shipment_items.shipped_quantity|強制點未定案
EOF

  # 9-c 全集指紋:任何一個字改動都會轉紅(錨檢查抓不到「錨還在但別處被亂改」)。
  # 🔴 指紋是**測量值**,由對照組實跑取得後凍結在這裡(Sean 2026-08-06 Q2=A:
  #    測量值屬 harness 與報告,不回填 plan)。
  # 🔴 **它實際抓的是什麼(兩輪連續更正我的說法,最後以 Fable R3 F2 為準)**:
  #    ①改 migration 裡的 COMMENT 會先撞上 sha256 閘、走不到這裡;
  #    ②「日後某支 migration 覆寫同一物件的註解」在**本 harness 的拓樸內不可達** ——
  #    晚於本檔的 migration 被時間序前綴閘永久排除,而本檔 §3 對七物件全部下 COMMENT
  #    且恆為最後套用 ⇒ 任何先行者的蓋寫都會被覆回。
  # ⇒ **本格是突變 oracle 專用**(靶⑤ 的第三個紅點),不是常設的蓋寫守門。
  # 🔴 交棒:「註解被日後 migration 蓋寫」**目前沒有任何守門**,S2b 那片要自己建,
  #    不得因為看到這一格就以為已經有了(A1 重放蓋寫 A2 註解是既有前科)。
  got="$(q "$U" "$(fp_sql)")"
  STRUCT_RUN=$((STRUCT_RUN+1))
  if [ "$got" != "$COMMENT_FP" ]; then
    red "C9c-fp" "$(printf '項9c 七物件註解指紋不符:期望 %s 實為 %s' "$COMMENT_FP" "$got")"
  fi

  [ "$STRUCT_RUN" -eq "$EXPECT_STRUCT" ] || {
    red "C0-count" "$(printf '🔴 結構 oracle 只跑了 %s 格,期望 %s —— 清單被改短了' "$STRUCT_RUN" "$EXPECT_STRUCT")"; }
  return $reds
}

# ══ 共用:突變檔產生器 ═══════════════════════════════════════════════════════
# 🔴 一律先剝掉 migration 自己的 §4 DO block(見檔頭警語②),再套用該靶的字面改動。
# 🔴 這是**起訖索引區間刪除**,會靜默吃掉落在兩個錨之間的任何新內容
#    (memory feedback_range-delete-silently-eats-neighbors 的形狀:三綠全綠、零紅)。
#    ⇒ 唯一抓得到的方式 = 對帳「預期 Δ vs 實際 Δ」,所以下面把剝掉的行數凍結起來。
STRIP_AWK='/══ 4\. 結構驗收/{skip=1} /^COMMIT;$/{skip=0} !skip{print}'
STRIP_LINES_FROZEN=235   # §4 結構驗收整段的行數(516 → 281,2026-08-06 實測)
make_mutant() {  # $1 = 輸出檔、$2 = python 取代來源、$3 = 取代目標(空 = 只剝)
  awk "$STRIP_AWK" "$MIG" > "$1" || die "剝除 §4 失敗"
  cmp -s "$MIG" "$1"; local mrc=$?
  case "$mrc" in
    0) die "🔴 剝除 §4 沒有改到任何東西 —— STRIP_AWK 的錨失效了,整組突變作廢" ;;
    1) : ;;
    *) die "🔴 cmp 讀不到檔(rc=$mrc)—— 不當成「有差異」放行(codex 關卡2 R2)" ;;
  esac
  local removed=$(( $(wc -l < "$MIG") - $(wc -l < "$1") ))
  [ "$removed" -eq "$STRIP_LINES_FROZEN" ] || die "🔴 剝除了 $removed 行,期望 $STRIP_LINES_FROZEN 行 ——
   起訖區間之間多了或少了東西(例如有人在 §4 與 COMMIT; 之間插了新段,會被一起靜默刪掉)。
   確認之後更新 STRIP_LINES_FROZEN,不要把這道對帳拿掉。"
  # 🔴 行數對帳不夠:錨整體偏移但仍好死不死刪掉 235 行時它會通過(codex 關卡2)。
  #    再對帳「該消失的消失了、該留的都留著」——內容面,與行數面互相獨立。
  grep -q 'S2A-COMMENT-COUNT' "$1" && die "🔴 §4 沒被剝乾淨(仍看得到 S2A-COMMENT-COUNT)"
  # 🔴 只看**非註解行**(codex 關卡2 R2):檔尾的 rollback 範例把同樣的字面寫在 `--` 註解裡,
  #    直接 grep 全檔會讓「forward 那句被誤刪」照樣餵綠 —— 恆真的內容對帳比沒有還糟。
  grep -v '^[[:space:]]*--' "$1" > "$1.code" || die "抽非註解行失敗"
  for keep in 'S2A-GATE-SHIPPED-NONZERO' \
              'ADD CONSTRAINT oiqs_shipped_le_instock' \
              'COMMENT ON COLUMN public.shipment_items.shipped_quantity' \
              '^COMMIT;$'; do
    grep -q "$keep" "$1.code" || die "🔴 剝除把不該刪的東西一起吃掉了:非註解行裡找不到「$keep」"
  done
  rm -f "$1.code"
  if [ -n "${3-}" ] || [ -n "${2-}" ]; then
    SRC="$2" DST="$3" OUT="$1" python3 - <<'PY' || die "突變取代失敗"
import io, os
out = os.environ['OUT']; src = os.environ['SRC']; dst = os.environ['DST']
s = io.open(out, encoding='utf-8').read()
n = s.count(src)
# 🔴 同上:不用 assert(PYTHONOPTIMIZE=1 會把它移除,突變就變成「什麼都沒改也算數」)。
if n != 1:
    raise SystemExit('🔴 突變錨命中 %d 次(必須恰 1):%s' % (n, src[:60]))
io.open(out, 'w', encoding='utf-8').write(s.replace(src, dst))
PY
  fi
}

run_mutant() {  # $1 = 靶名、$2 = 突變檔、$3 = **期望紅的格 ID 集合**(空字串 = 應全綠)、$4 = 比對基準檔
  local name="$1" file="$2" expect="$3" baseline="$4" key="$5" db="s2a_mut" U reds got_ids exp_ids
  # 🔴 比對象是 baseline(靶①-⑤ 比 mut0;MUT0 自己比原檔)—— 比原檔對靶①-⑤ 而言恆為不同、零判別力。
  # 🔴 cmp 的 rc:0=相同 / 1=有差異 / **2=讀取失敗**。原版把 2 當成「有差異」放行 ⇒
  #    基準檔缺漏或不可讀時整道守門被繞過(codex 關卡2)。
  cmp -s "$baseline" "$file"; local crc=$?
  case "$crc" in
    0) bad "突變 $name:與基準檔 ${baseline##*/} 無差異(取代沒命中)"; MUT=$((MUT+1)); return ;;
    1) : ;;
    *) bad "突變 $name:cmp 讀不到檔(rc=$crc,基準 $baseline / 突變 $file)"; MUT=$((MUT+1)); return ;;
  esac
  fresh_db "$db"; U="$FRESH_URL"
  if ! psql -X "$U" -v ON_ERROR_STOP=1 -q -f "$file" > "$WORK/mut-$name.log" 2>&1; then
    bad "突變 $name:apply 就失敗了(期望能套進去、由 harness 的 oracle 抓)— $(tail -1 "$WORK/mut-$name.log")"
    MUT=$((MUT+1)); drop_db "$db"; return
  fi
  struct_oracle "$U" "$name"; reds=$?
  MUT=$((MUT+1))
  # 🔴 比的是**格 ID 集合**逐字相等,不是紅格數量 —— 「指定格沒紅、別格意外紅」總數相同也要被抓出來。
  got_ids="$(printf '%s\n' $REDS_IDS | sort | tr '\n' ' ' | sed 's/ *$//')"
  exp_ids="$(printf '%s\n' $expect | sort | tr '\n' ' ' | sed 's/ *$//')"
  if [ "$got_ids" = "$exp_ids" ]; then
    if [ -z "$exp_ids" ]; then ok "MUT-$key" "突變 $name(對照組):結構 oracle 全綠 ⇒ 剝除 §4 本身不會造成紅"
    else ok "MUT-$key" "突變 $name:紅在 [$got_ids](逐格相符)"; fi
  else
    bad "突變 $name:紅在 [$got_ids] 但期望 [$exp_ids] —— 判別力不符(見上方逐格輸出)"
  fi
  drop_db "$db"
}

# ══ 1. 對照組:套真檔,結構 oracle 必須全綠 ═══════════════════════════════════
log "1/9 對照組:pre-S2a 副本套**真檔**,外部結構 oracle 應全綠"
fresh_db s2a_ctl; CTL_URL="$FRESH_URL"
psql -X "$CTL_URL" -v ON_ERROR_STOP=1 -q -f "$MIG" > "$WORK/ctl.log" 2>&1 \
  || die "對照組套真檔就失敗了:$(tail -3 "$WORK/ctl.log")"
grep -q 'S2A 結構驗收全數通過' "$WORK/ctl.log" || die "對照組沒看到 migration 自己的驗收 NOTICE"

# 印出實測指紋供人核對(比對本身在 struct_oracle 的項9c,對的是上面那個凍結常數)。
CTL_FP="$(q "$CTL_URL" "$(fp_sql)")"
[ ${#CTL_FP} -eq 32 ] || die "取不到七物件註解指紋(實得「$CTL_FP」)"
echo "   ▸ 七物件註解指紋:凍結 $COMMENT_FP / 實測 $CTL_FP"

struct_oracle "$CTL_URL" "對照組"; CTL_REDS=$?
if [ "$CTL_REDS" -eq 0 ]; then ok CTL-STRUCT "對照組結構 oracle $STRUCT_RUN 格全綠"
else bad "對照組結構 oracle 紅 $CTL_REDS 格 —— 真檔就過不了,後面的突變全部沒有意義"; fi

# ══ 2. 項 9b:原始碼註解錨(catalog 查不到的那三項)═══════════════════════════
log '2/9 項9b:A1 契約債 ① 清償聲明三項(原始碼註解,obj_description 查不到)'
while IFS='|' read -r label anchor; do
  [ -n "$label" ] || continue
  SRC_RUN=$((SRC_RUN+1))
  # 🔴 grep -c 數的是**行數**:同一行出現兩次仍回 1 ⇒ 量錯東西(codex 關卡2)。改數實際命中次數。
  n="$(grep -oF -- "$anchor" "$MIG" | wc -l | tr -d ' ')"
  # 🔴 驗「恰一次」不是「存在」—— 只驗存在就是 migration §0.6-3 記的 presence oracle 恆綠病。
  if [ "$n" = "1" ]; then ok "SRC-ANCHOR-$SRC_RUN" "項9b $label(錨恰命中 1 次)"
  else bad "項9b $label:錨「$anchor」在 migration 內命中 $n 次(期望恰 1)"; fi
done <<'EOF'
①加欄|① 加 shipped_quantity 欄
②納入 C6′、C7 不動|② 納入 **C6'(C7 不動)**
③刻意不做|③ 🔴 **刻意不做**:不把 shipped 從 C6/C7 減去
EOF
[ "$SRC_RUN" -eq "$EXPECT_SRC" ] || bad "項9b 只跑了 $SRC_RUN 格,期望 $EXPECT_SRC —— 清單被改短了"

# ══ 3. 突變靶(環境 A;每靶 fresh DB from template)═══════════════════════════
log "3/9 結構段突變靶:每靶一份乾淨 pre-S2a 副本 + 剝除 §4 + 單一字面改動"

make_mutant "$WORK/mut0.sql" "" ""
run_mutant "MUT0-只剝不改" "$WORK/mut0.sql" "" "$MIG" 0

make_mutant "$WORK/mut1.sql" \
  'ADD CONSTRAINT oiqs_shipped_le_instock CHECK (shipped_quantity <= instock_quantity)' \
  'ADD CONSTRAINT oiqs_shipped_le_instock CHECK (shipped_quantity < instock_quantity)'
run_mutant "靶①-C9改成嚴格小於" "$WORK/mut1.sql" "C2-oiqs_shipped_le_instock" "$WORK/mut0.sql" 1

make_mutant "$WORK/mut2.sql" \
  '  ADD CONSTRAINT oiqs_shipped_le_instock CHECK (shipped_quantity <= instock_quantity),
' ''
run_mutant "靶②-拿掉C9" "$WORK/mut2.sql" "C2-oiqs_shipped_le_instock C3-set" "$WORK/mut0.sql" 2

make_mutant "$WORK/mut3.sql" \
  '  ADD CONSTRAINT oiqs_shipped_nonneg CHECK (shipped_quantity >= 0),
' ''
run_mutant "靶③-拿掉C8" "$WORK/mut3.sql" "C2-oiqs_shipped_nonneg C3-set" "$WORK/mut0.sql" 3

make_mutant "$WORK/mut4.sql" \
  'ADD COLUMN shipped_quantity integer NOT NULL DEFAULT 0,' \
  'ADD COLUMN shipped_quantity integer NOT NULL DEFAULT 1,'
run_mutant "靶④-DEFAULT改1" "$WORK/mut4.sql" "C1-col" "$WORK/mut0.sql" 4

# 靶⑤ = Fable R3 F4 指名的那一發:同時走「必含錨」與「排除舊字面」兩條路徑,
#        還會動到指紋 ⇒ 期望紅 3 格(9a 缺錨 / 9b 舊字面仍在 / 9c 指紋不符)。
MUT5_SRC="$(MIG="$MIG" python3 - <<'PY'
import io, os
s=io.open(os.environ['MIG'],encoding='utf-8').read()
i=s.index("COMMENT ON COLUMN public.shipment_items.shipped_quantity IS")
print(s[i:s.index("';",i)+3], end='')
PY
)"
[ -n "$MUT5_SRC" ] || die "靶⑤ 取不到要刪的 COMMENT 語句 —— 否則會靜默退化成 MUT0"
make_mutant "$WORK/mut5.sql" "$MUT5_SRC" ""
run_mutant "靶⑤-刪掉forward-override那句COMMENT" "$WORK/mut5.sql" \
  "C9a-COL:shipment_items.shipped_quantity C9x-COL:shipment_items.shipped_quantity C9c-fp" "$WORK/mut0.sql" 5

# ══ 4. 收尾:格數自斷言 ═════════════════════════════════════════════════════
# ══ 行為段用的 SQL 產物(在這裡生成,不散在各處)═════════════════════════════
# 🔴 措辭要準(codex 關卡2):下面四段字面是**寫死在這裡的副本**,不是從 MIG 剖析出來的;
#    真正的機制是**對 MIG 全檔 count 必須恰 1 次** ⇒ 一旦 migration 改了字面,這裡當場 die。
#    ⚠️ 它對「MIG 的註解裡剛好也寫了同一段字面」不設防(那會讓 count 變 2、同樣 die,方向安全)。
MIG="$MIG" OUT="$WORK" python3 - <<'PYGEN' || die "行為段 SQL 產生失敗"
import io, os
mig = io.open(os.environ['MIG'], encoding='utf-8').read()
out = os.environ['OUT']
C8  = 'ADD CONSTRAINT oiqs_shipped_nonneg CHECK (shipped_quantity >= 0)'
C9  = 'ADD CONSTRAINT oiqs_shipped_le_instock CHECK (shipped_quantity <= instock_quantity)'
C6P = ('ADD CONSTRAINT oiqs_cancelled_shipped_le_quantity\n'
       '    CHECK (cancelled_quantity::bigint + shipped_quantity::bigint <= quantity::bigint)')
ADD = 'ADD COLUMN shipped_quantity integer NOT NULL DEFAULT 0'
# 🔴 **不得用 assert 當守門**(codex 關卡2 R2 實證):`PYTHONOPTIMIZE=1`(或 python -O)
#    會把所有 assert 整句移除 ⇒ 這道字面對帳靜默消失,C8/C6′ 的副本漂移後項4 與靶⑩ 仍可能全綠。
for frag in (C8, C9, C6P, ADD):
    n = mig.count(frag)
    if n != 1:
        raise SystemExit(
            '🔴 在 migration 內找不到(或不只一處)這段字面,行為段的 variant 會與正式檔脫節:'
            '%r 命中 %d 次' % (frag[:50], n))

io.open(out + '/v-addcol.sql', 'w', encoding='utf-8').write(
    '-- 行為段 temp variant:**只加欄、不加約束**(plan §4 項4)\n'
    'ALTER TABLE public.order_item_quantity_summary\n  ' + ADD + ';\n')
io.open(out + '/v-constraints.sql', 'w', encoding='utf-8').write(
    '-- 行為段 temp variant:**只加三條約束**(字面逐字抽自正式 migration)\n'
    'ALTER TABLE public.order_item_quantity_summary\n  '
    + C8 + ',\n  ' + C9 + ',\n  ' + C6P + ';\n')
# 靶⑩ 用:**同一條約束段但拿掉 C9**。
# 🔴 舊版靶⑩ 是「不執行約束段、直接 echo NOT-BLOCKED」⇒ 完全繞過量測器,
#    把量測器改寬時對照組與靶⑩ 會雙綠(code-reviewer R1 抓)。
#    改成走**同一條路徑**、只是少了 C9 —— 觀察值必須由同一個匹配器產生。
io.open(out + '/v-constraints-noC9.sql', 'w', encoding='utf-8').write(
    '-- 靶⑩:只加 C8 與 C6′,**拿掉 C9** ⇒ shipped=3/instock=2 的既有壞列應該活下來\n'
    'ALTER TABLE public.order_item_quantity_summary\n  '
    + C8 + ',\n  ' + C6P + ';\n')

BEH = r"""
-- 行為段 oracle(輸出 `格|觀察值`,由 shell 逐格比對)。全程 BEGIN…ROLLBACK,零殘留。
BEGIN;
CREATE TEMP TABLE _r(i int, k text, v text);
DO $beh$
DECLARE v_item uuid; st text; cn text; got integer; n bigint;
  -- 🔴 got 每格前必須重設:SELECT INTO 抓不到列時會**沿用上一格的值**,
  --    目前兩格期望值恰好不同(2 vs 0)所以會轉紅 —— 那是巧合,不是設計(R1)。
BEGIN
  SELECT id INTO v_item FROM public.order_items ORDER BY id LIMIT 1;
  IF v_item IS NULL THEN RAISE EXCEPTION '行為段 fixture 缺 order_items(基準庫沒 seed?)'; END IF;
  -- fixture:五值互異 q/o/i/c/s = 10/9/2/4/3;line_total 必須同步(order_items_line_balances)。
  UPDATE public.order_items SET quantity = 10, line_total = unit_price * 10 WHERE id = v_item;

  -- 項5:C9 只紅它負測
  BEGIN
    INSERT INTO public.order_item_quantity_summary
      (order_item_id, quantity, ordered_quantity, instock_quantity, cancelled_quantity, shipped_quantity)
      VALUES (v_item, 10, 9, 2, 4, 3);
    INSERT INTO _r VALUES (1, 'B5-c9-neg', 'NOT-BLOCKED');
    DELETE FROM public.order_item_quantity_summary WHERE order_item_id = v_item;
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS st = RETURNED_SQLSTATE, cn = CONSTRAINT_NAME;
    INSERT INTO _r VALUES (1, 'B5-c9-neg', st || '/' || COALESCE(cn, '(無 conname)'));
  END;

  -- 項6:C9 邊界正測 shipped = instock 恰等放行,回查落庫值
  BEGIN
    INSERT INTO public.order_item_quantity_summary
      (order_item_id, quantity, ordered_quantity, instock_quantity, cancelled_quantity, shipped_quantity)
      VALUES (v_item, 10, 9, 2, 4, 2);
    got := NULL;
    SELECT shipped_quantity INTO got FROM public.order_item_quantity_summary WHERE order_item_id = v_item;
    INSERT INTO _r VALUES (2, 'B6-c9-boundary', COALESCE(got::text, '(讀不到列)'));
    DELETE FROM public.order_item_quantity_summary WHERE order_item_id = v_item;
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS st = RETURNED_SQLSTATE;
    INSERT INTO _r VALUES (2, 'B6-c9-boundary', 'REJECTED/' || st);
  END;

  -- 項7:C8 只紅它負測
  BEGIN
    INSERT INTO public.order_item_quantity_summary
      (order_item_id, quantity, ordered_quantity, instock_quantity, cancelled_quantity, shipped_quantity)
      VALUES (v_item, 10, 9, 2, 4, -1);
    INSERT INTO _r VALUES (3, 'B7-c8-neg', 'NOT-BLOCKED');
    DELETE FROM public.order_item_quantity_summary WHERE order_item_id = v_item;
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS st = RETURNED_SQLSTATE, cn = CONSTRAINT_NAME;
    INSERT INTO _r VALUES (3, 'B7-c8-neg', st || '/' || COALESCE(cn, '(無 conname)'));
  END;

  -- 項7b:C8 零值正測(v1 只折了一半:只有負測、沒有 0 可以寫進去的正測)
  BEGIN
    INSERT INTO public.order_item_quantity_summary
      (order_item_id, quantity, ordered_quantity, instock_quantity, cancelled_quantity, shipped_quantity)
      VALUES (v_item, 10, 9, 2, 4, 0);
    got := NULL;
    SELECT shipped_quantity INTO got FROM public.order_item_quantity_summary WHERE order_item_id = v_item;
    INSERT INTO _r VALUES (4, 'B7b-c8-zero', COALESCE(got::text, '(讀不到列)'));
    DELETE FROM public.order_item_quantity_summary WHERE order_item_id = v_item;
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS st = RETURNED_SQLSTATE;
    INSERT INTO _r VALUES (4, 'B7b-c8-zero', 'REJECTED/' || st);
  END;

  -- 項8:C6' 的代數蘊含在有限域上的 smoke(C9 ∧ C7 ⇒ C6')。
  -- 🔴🔴 **這一格不碰受測 DB**(R1 抓:兩條前提式是手抄的純算術,migration 根本沒套也會回 0)
  --    ⇒ 它**不是關於本 migration 的證據**,只是「§1 那句『C6' 是代數冗餘』還成立」的 smoke。
  --    保留是因為它一旦非 0,§1 的整個論證就作廢;但**不得把它算進行為覆蓋率**。
  SELECT count(*) INTO n
    FROM generate_series(0,6) q, generate_series(0,6) i,
         generate_series(0,6) c, generate_series(0,6) sh
   WHERE sh <= i                                  -- C9
     AND i::bigint + c <= q                       -- C7
     AND NOT (c::bigint + sh <= q);               -- C6' 被違反
  INSERT INTO _r VALUES (5, 'B8-c6prime-smoke', n::text);
END
$beh$;
SELECT k || '|' || v FROM _r ORDER BY i;
ROLLBACK;
"""
io.open(out + '/beh.sql', 'w', encoding='utf-8').write(BEH)
PYGEN
for f in v-addcol v-constraints v-constraints-noC9 beh; do
  test -s "$WORK/$f.sql" || die "行為段 SQL 產物 $f.sql 為空"
done
# 🔴 plan §4 項4 逐字要求:cmp 驗 variant 檔與正式檔確實不同。
cmp -s "$MIG" "$WORK/v-addcol.sql" && die "v-addcol.sql 與正式檔相同 —— variant 沒生出來"
cmp -s "$MIG" "$WORK/v-constraints.sql" && die "v-constraints.sql 與正式檔相同 —— variant 沒生出來"

# ══ 行為段(S2a-3):C8 / C9 真的擋得住嗎 ═════════════════════════════════════
# 🔴 結構段證的是「約束長得對」,行為段證的是「約束真的會擋」。兩者不可互相替代:
#    定義字面全等但 PG 沒有 enforce(例如 NOT VALID)時,結構段照樣全綠。
# 🔴 fixture 五值全寫死互異 q/o/i/c/s = 10/9/2/4/3(plan §4 項5):
#    C4 9≤10 ✅ / C5 2≤9 ✅ / C7 2+4≤10 ✅ / C6′ 4+3≤10 ✅ ⇒ **只違反 C9**(3>2)。
#    這組值同時讓靶⑧a(shipped≤quantity)⑧b(≤ordered)⑧c(≤cancelled)三個錯式**全部放行** ——
#    plan v1 的 4/2/1/3 在 ⑧c 會 3>1 仍紅在同一個 conname,那叫**假裝抓到**。
BEH_RUN=0
beh_oracle() {   # $1 = URL(已套真檔或突變檔的副本)、$2 = 標籤;設 REDS_IDS、回傳紅格數
  local U="$1" TAG="$2" reds=0 line k v exp
  BEH_RUN=0; REDS_IDS=""
  psql -X "$U" -v ON_ERROR_STOP=1 -qtA -f "$WORK/beh.sql" > "$WORK/beh-$TAG.out" 2>"$WORK/beh-$TAG.err" \
    || { printf '     ▸ [%s] 行為段 SQL 執行失敗:%s\n' "$TAG" "$(head -1 "$WORK/beh-$TAG.err")"
         REDS_IDS=" B0-sqlfail"; return 1; }
  while IFS='|' read -r k v; do
    [ -n "$k" ] || continue
    BEH_RUN=$((BEH_RUN+1))
    case "$k" in
      B5-c9-neg)        exp='23514/oiqs_shipped_le_instock' ;;
      B6-c9-boundary)   exp='2' ;;
      B7-c8-neg)        exp='23514/oiqs_shipped_nonneg' ;;
      B7b-c8-zero)      exp='0' ;;
      B8-c6prime-smoke) exp='0' ;;
      *) printf '     ▸ [%s] 行為段出現未知的格 %s\n' "$TAG" "$k"; REDS_IDS="$REDS_IDS B0-unknown"; reds=$((reds+1)); continue ;;
    esac
    if [ "$v" != "$exp" ]; then
      printf '     ▸ [%s] %s:期望「%s」實為「%s」\n' "$TAG" "$k" "$exp" "$v"
      REDS_IDS="$REDS_IDS $k"; reds=$((reds+1))
    fi
  done < "$WORK/beh-$TAG.out"
  # 🔴 只驗**列數**會被「拿掉 B8、改塞第二筆合法 B5」騙過:仍是 5 列、八靶紅格集合也不變
  #    ⇒ 整支可以全綠(codex 關卡2:與紅格那條、PASS 那條同一族的第三次)。改驗 **key 集合**。
  local gotk expk
  gotk="$(cut -d'|' -f1 "$WORK/beh-$TAG.out" | sort | tr '\n' ' ' | sed 's/ *$//')"
  expk="B5-c9-neg B6-c9-boundary B7-c8-neg B7b-c8-zero B8-c6prime-smoke"
  if [ "$gotk" != "$expk" ]; then
    printf '     ▸ [%s] 🔴 行為段回傳的格集合不符:\n        實際 [%s]\n        期望 [%s]\n' "$TAG" "$gotk" "$expk"
    REDS_IDS="$REDS_IDS B0-keyset"; reds=$((reds+1))
  fi
  # beh.sql 回的格數 = EXPECT_BEH 減掉項4(項4 在別的環境、由 beh_item4 量)。
  [ "$BEH_RUN" -eq $((EXPECT_BEH - 1)) ] || {
    printf '     ▸ [%s] 🔴 行為段只回了 %s 格,期望 %s —— SQL 被改短了\n' "$TAG" "$BEH_RUN" "$((EXPECT_BEH - 1))"
    REDS_IDS="$REDS_IDS B0-count"; reds=$((reds+1)); }
  return $reds
}

# 項 4:**既有列違反 C9 必紅**。正式 migration 同一個 ALTER 加欄+CHECK,照字面構造不出來
# ⇒ temp variant:先只加欄 → 造 shipped=3/instock=2 的既有列 → **單獨執行約束段**。
# $1 = 要跑的約束段檔名、$2 = 標籤 → **設全域 I4_OUT**(不用命令替換:`fresh_db` 內含 die,
#   放進 $( ) 只殺得掉子 shell —— 本檔 fresh_db 上方自己的警告)。
# 🔴 兩種情境走**完全同一條路徑**,差別只在約束段少了 C9;不再有「直接 echo 結果」的分支。
I4_OUT=""
beh_item4() {
  local cfile="$1" tag="$2" db="s2a_beh4" U out rowleft
  fresh_db "$db"; U="$FRESH_URL"
  psql -X "$U" -v ON_ERROR_STOP=1 -q -f "$WORK/v-addcol.sql" >/dev/null 2>&1 \
    || { I4_OUT="SQLFAIL-addcol"; drop_db "$db"; return; }
  psql -X "$U" -v ON_ERROR_STOP=1 -q >/dev/null 2>&1 <<'SQL'
UPDATE public.order_items SET quantity = 10, line_total = unit_price * 10
 WHERE id = (SELECT id FROM public.order_items ORDER BY id LIMIT 1);
INSERT INTO public.order_item_quantity_summary
  (order_item_id, quantity, ordered_quantity, instock_quantity, cancelled_quantity, shipped_quantity)
SELECT id, 10, 9, 2, 4, 3 FROM public.order_items ORDER BY id LIMIT 1;
SQL
  # 🔴 fixture 要驗**值**、不只驗列數(R1):否則哪天 seed 開始建摘要列,拿到別的列還以為對。
  [ "$(q "$U" "SELECT count(*) FROM public.order_item_quantity_summary WHERE shipped_quantity = 3 AND instock_quantity = 2")" = "1" ] \
    || { I4_OUT="FIXTURE-MISSING"; drop_db "$db"; return; }

  # 🔴 VERBOSITY=verbose 讓 psql 把 SQLSTATE 印進 ERROR 行 —— 沒有它就只能比名字,
  #    而 `42710 duplicate_object` 之類的錯誤訊息**同樣含那個約束名**,會被誤認成「成功擋下」(codex 關卡2)。
  out="$(psql -X "$U" -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -q -f "$WORK/$cfile" 2>&1)"
  rowleft="$(q "$U" 'SELECT count(*) FROM public.order_item_quantity_summary')"
  # 🔴 判「被擋」要看 **ERROR 行**,不是整段輸出含不含那個名字(R1):
  #    psql 語法錯誤會回顯 `LINE 3:   ADD CONSTRAINT oiqs_shipped_le_instock …`,同樣命中 ⇒ 誤判成 BLOCKED。
  if printf '%s' "$out" | grep -qE 'ERROR: *23514:.*"oiqs_shipped_le_instock"'; then
    I4_OUT="BLOCKED/23514/oiqs_shipped_le_instock"
  elif [ -z "$out" ] && [ "$rowleft" = "1" ]; then
    I4_OUT="NOT-BLOCKED"
  elif [ -z "$out" ]; then
    I4_OUT="NOT-BLOCKED-BUT-ROW-GONE($rowleft)"
  else
    I4_OUT="OTHER:$(printf '%s' "$out" | grep -m1 'ERROR:' | cut -c1-70)"
  fi
  drop_db "$db"
}

log "4/9 行為段對照組(項 4 / 5 / 6 / 7 / 7b / 8)"
fresh_db s2a_beh; BEH_URL="$FRESH_URL"
psql -X "$BEH_URL" -v ON_ERROR_STOP=1 -q -f "$MIG" > "$WORK/beh-apply.log" 2>&1 \
  || die "行為段對照組套真檔失敗:$(tail -3 "$WORK/beh-apply.log")"
beh_oracle "$BEH_URL" "行為對照組"; BEH_REDS=$?
beh_item4 v-constraints.sql 對照; I4="$I4_OUT"
BEH_TOTAL=$((BEH_RUN + 1))
[ "$BEH_TOTAL" -eq "$EXPECT_BEH" ] || bad "行為段只跑了 $BEH_TOTAL 格,期望 $EXPECT_BEH"
if [ "$BEH_REDS" -eq 0 ] && [ "$I4" = "BLOCKED/23514/oiqs_shipped_le_instock" ]; then
  ok BEH-CTL "行為段 $BEH_TOTAL 格全綠 —— **其中 5 格真的碰受測 DB**(項4 既有壞列被 C9 擋下、項5/7 負測各紅在自己的 conname、項6/7b 正測回查落庫值);項8 是不碰 DB 的代數 smoke=0,不算行為證據"
else
  bad "行為段對照組:oracle 紅 $BEH_REDS 格 / 項4 觀察值 = $I4(期望 BLOCKED/23514/oiqs_shipped_le_instock)"
fi
drop_db s2a_beh

log "5/9 行為段突變靶(⑥ ⑦ ⑧a ⑧b ⑧c ⑫ ⑬ ⑩ —— 共 8 發)"
BMUT=0
run_beh_mutant() {  # $1 = 靶名、$2 = 突變檔、$3 = 期望紅格 ID 集合、$4 = key
  local name="$1" file="$2" expect="$3" key="$4" db="s2a_bmut" U got exp
  cmp -s "$WORK/mut0.sql" "$file"; local c=$?
  case "$c" in 0) bad "行為靶 $name:與 mut0 無差異(取代沒命中)"; BMUT=$((BMUT+1)); return ;;
                1) : ;; *) bad "行為靶 $name:cmp 讀不到檔(rc=$c)"; BMUT=$((BMUT+1)); return ;; esac
  fresh_db "$db"; U="$FRESH_URL"
  if ! psql -X "$U" -v ON_ERROR_STOP=1 -q -f "$file" > "$WORK/bmut-$key.log" 2>&1; then
    bad "行為靶 $name:apply 就失敗了 — $(tail -1 "$WORK/bmut-$key.log")"; BMUT=$((BMUT+1)); drop_db "$db"; return
  fi
  beh_oracle "$U" "$name" >/dev/null
  got="$(printf '%s\n' $REDS_IDS | sort | tr '\n' ' ' | sed 's/ *$//')"
  exp="$(printf '%s\n' $expect | sort | tr '\n' ' ' | sed 's/ *$//')"
  BMUT=$((BMUT+1))
  if [ "$got" = "$exp" ]; then ok "BEH-MUT-$key" "行為靶 $name:紅在 [$got](逐格相符)"
  else bad "行為靶 $name:紅在 [$got] 但期望 [$exp]"; fi
  drop_db "$db"
}

make_mutant "$WORK/bmut6.sql" \
  '  ADD CONSTRAINT oiqs_shipped_le_instock CHECK (shipped_quantity <= instock_quantity),
' ''
run_beh_mutant "靶⑥-拿掉C9" "$WORK/bmut6.sql" "B5-c9-neg" 6

make_mutant "$WORK/bmut7.sql" \
  '  ADD CONSTRAINT oiqs_shipped_nonneg CHECK (shipped_quantity >= 0),
' ''
run_beh_mutant "靶⑦-拿掉C8" "$WORK/bmut7.sql" "B7-c8-neg" 7

make_mutant "$WORK/bmut8a.sql" \
  'CHECK (shipped_quantity <= instock_quantity)' 'CHECK (shipped_quantity <= quantity)'
run_beh_mutant "靶⑧a-C9改成比quantity" "$WORK/bmut8a.sql" "B5-c9-neg" 8a

make_mutant "$WORK/bmut8b.sql" \
  'CHECK (shipped_quantity <= instock_quantity)' 'CHECK (shipped_quantity <= ordered_quantity)'
run_beh_mutant "靶⑧b-C9改成比ordered" "$WORK/bmut8b.sql" "B5-c9-neg" 8b

make_mutant "$WORK/bmut8c.sql" \
  'CHECK (shipped_quantity <= instock_quantity)' 'CHECK (shipped_quantity <= cancelled_quantity)'
run_beh_mutant "靶⑧c-C9改成比cancelled" "$WORK/bmut8c.sql" "B5-c9-neg" 8c

make_mutant "$WORK/bmut12.sql" \
  'CHECK (shipped_quantity <= instock_quantity)' 'CHECK (shipped_quantity < instock_quantity)'
run_beh_mutant "靶⑫-C9收緊成嚴格小於" "$WORK/bmut12.sql" "B6-c9-boundary" 12

make_mutant "$WORK/bmut13.sql" \
  'CHECK (shipped_quantity >= 0)' 'CHECK (shipped_quantity > 0)'
run_beh_mutant "靶⑬-C8收緊成嚴格大於" "$WORK/bmut13.sql" "B7b-c8-zero" 13

# 靶⑩:項4 的約束段**拿掉 C9** ⇒ shipped=3/instock=2 的壞列應該活下來。
beh_item4 v-constraints-noC9.sql 靶⑩; I4M="$I4_OUT"
BMUT=$((BMUT+1))
[ "$I4M" = "NOT-BLOCKED" ] && ok BEH-MUT-10 "行為靶⑩-約束段拿掉C9:壞列活下來(NOT-BLOCKED,同一個量測器)⇒ 項4 有判別力" \
  || bad "行為靶⑩:觀察值 = $I4M(期望 NOT-BLOCKED)"

[ "$BMUT" -eq "$EXPECT_BEH_MUT" ] && ok BEH-MUT-COUNT "行為段突變靶跑滿 $BMUT 個(期望 $EXPECT_BEH_MUT)" \
  || bad "行為段突變靶只跑了 $BMUT 個,期望 $EXPECT_BEH_MUT"

# ══ 回滾 / 故障注入段(S2a-4)═══════════════════════════════════════════════
# 🔴 這一段證的是「**中途失敗會不會留下半套狀態**」與「**災難重建清單少了本片會怎樣**」。
#    兩件都不是論證題,是實跑題 —— plan §4 項10/12/13/14 + §5 靶⑨⑪。
# 🔴 審查後的實際內容(比 plan 多出來的都是審查補的,別照 plan 讀):
#    格 = 項10 / 項12 / **項12b**(註解維非退化)/ 項13 / 項14 / **項15**(gate 五路徑)/ **項16**(災難日路徑 A);
#    靶 = ⑨(marker 挪到 COMMIT 之後)/ ⑪(runbook 拿掉 S2a)/ **⑭**(前置閘段落降級)/ **⑮**(刪掉路徑 A 整段)。
ROLL=0; RMUT=0
# 整體狀態指紋。🔴 **三個維度分開回**(code-reviewer R1 must-fix):
#   原版把三維 concat 成單一 md5 ⇒ 靶⑨ 只要**任一維**不同就得到 differ,而「欄名集合」那一維
#   在 marker 挪到 COMMIT 之後時**必然**不同 ⇒ 就算註解那一維退化成常數(例如 comment_sql 的
#   regclass 子查詢全回 NULL),項12 與靶⑨ 仍會雙綠,「七物件註解逐字回復」那部分從未被證明。
#   分維之後:項12 要求三維**逐維**相等;另有項12b 專門證明「註解那一維不是常數」。
state_fp() {  # $1 = URL → 印出 "<欄名集合 md5>|<CHECK 具名集合 md5>|<七物件註解 md5>"
  q "$1" "SELECT concat(
      md5(coalesce((SELECT string_agg(attname, ',' ORDER BY attname) FROM pg_attribute
                 WHERE attrelid = to_regclass('${SUMMARY}') AND attnum > 0 AND NOT attisdropped), '(無表)')),
      '|',
      md5(coalesce((SELECT string_agg(conname, ',' ORDER BY conname) FROM pg_constraint
                 WHERE conrelid = to_regclass('${SUMMARY}') AND contype = 'c'), '(無)')),
      '|',
      coalesce(($(fp_sql)), md5('(無)')))"
}
fp_dim() { printf '%s' "$1" | cut -d'|' -f"$2"; }   # $1 = 指紋、$2 = 1|2|3

log "6/9 回滾 / 故障注入(項 10 / 12 / 12b / 13 / 14 / 15 / 16)"

# ── 項10:重跑本片必紅 42701(只證「拒絕重跑」,**不證原子回復** —— 那是項12 的事)──
psql -X "$CTL_URL" -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -q -f "$MIG" > "$WORK/rerun.log" 2>&1
ROLL=$((ROLL+1))
# 🔴 連**是哪一欄**重複一起驗(R1 nit;行為段的負測就是連 conname 一起比的)——
#    只驗 SQLSTATE 的話,日後 migration 多一個 ADD COLUMN 時紅在別欄也算通過。
# 🔴🔴 錨**不可以只是欄名**(codex 關卡2 實錘):psql 的錯誤行開頭是
#    `psql:supabase/migrations/20260806100000_..._shipped_quantity.sql:149: ERROR: ...`
#    ⇒ 檔名本身就含 `shipped_quantity`,任何一欄的 42701 都會被檔名餵綠。改比對錯誤訊息本體。
if grep -qE 'ERROR: *42701: *column "shipped_quantity" of relation "order_item_quantity_summary" already exists' "$WORK/rerun.log"; then
  ok R10-rerun "項10 重跑本片紅在 42701 且錯誤本體指名 shipped_quantity/order_item_quantity_summary(只證拒絕重跑,不證原子回復)"
else
  bad "項10 重跑本片沒有紅在 42701、或錯誤本體不是 shipped_quantity 那一欄:$(tail -1 "$WORK/rerun.log")"
fi

# ── 項12 / 靶⑨:故障注入 ──
# marker 放在 COMMIT **之前** ⇒ 整片回滾,指紋必須逐字回到 pre-S2a。
# 靶⑨ 把同一個 marker 挪到 COMMIT **之後** ⇒ 已經提交了,指紋不會回復 ⇒ 項12 必須轉紅。
MIG="$MIG" OUT="$WORK" python3 - <<'PYFAULT' || die "故障注入 variant 產生失敗"
import io, os
mig = io.open(os.environ['MIG'], encoding='utf-8').read()
out = os.environ['OUT']
MARK = "DO $fault$ BEGIN RAISE EXCEPTION 'S2A-FAULT-MARKER'; END $fault$;\n"
if mig.count('\nCOMMIT;\n') != 1:
    raise SystemExit('🔴 找不到唯一的 COMMIT; —— 故障注入的插點不明確')
io.open(out + '/fault-in.sql', 'w', encoding='utf-8').write(mig.replace('\nCOMMIT;\n', '\n' + MARK + 'COMMIT;\n'))
io.open(out + '/fault-after.sql', 'w', encoding='utf-8').write(mig.replace('\nCOMMIT;\n', '\nCOMMIT;\n' + MARK))
PYFAULT

fault_case() {  # $1 = variant 檔、$2 = 標籤 → 設 FAULT_OUT = "<維1><維2><維3>" 三個 s|d,或 <異常>
  local f="$1" tag="$2" db="s2a_fault" U before after i r=""
  fresh_db "$db"; U="$FRESH_URL"
  before="$(state_fp "$U")"
  [ ${#before} -eq 98 ] || { FAULT_OUT="FP-FAIL-before"; drop_db "$db"; return; }
  psql -X "$U" -v ON_ERROR_STOP=1 -q -f "$WORK/$f" > "$WORK/$tag.log" 2>&1
  grep -q 'S2A-FAULT-MARKER' "$WORK/$tag.log" || { FAULT_OUT="MARKER-NOT-FIRED"; drop_db "$db"; return; }
  after="$(state_fp "$U")"
  [ ${#after} -eq 98 ] || { FAULT_OUT="FP-FAIL-after"; drop_db "$db"; return; }
  # 🔴 逐維比,不是比合併值 —— 合併值讓「欄名那一維必然不同」蓋掉其餘兩維的判別力。
  for i in 1 2 3; do
    [ "$(fp_dim "$before" $i)" = "$(fp_dim "$after" $i)" ] && r="${r}s" || r="${r}d"
  done
  FAULT_OUT="$r"
  drop_db "$db"
}

fault_case fault-in.sql fault-in
ROLL=$((ROLL+1))
[ "$FAULT_OUT" = "sss" ] \
  && ok R12-fault "項12 故障注入(marker 在 COMMIT 之前):整片回滾,欄名集合 / CHECK 具名集合 / 七物件註解**三維逐維**回到 pre-S2a" \
  || bad "項12 故障注入:三維觀察值 = $FAULT_OUT(期望 sss;s=該維相同 d=不同,位序 = 欄名 / CHECK / 註解)"

fault_case fault-after.sql fault-after
RMUT=$((RMUT+1))
# 🔴 要求 **ddd** 而不是「有任何一維 d」:三維都必須各自看得見差異,
#    否則註解那一維退化成常數時這一格照樣綠(這正是原版的漏洞)。
[ "$FAULT_OUT" = "ddd" ] \
  && ok ROLL-MUT-9 "靶⑨ marker 挪到 COMMIT 之後:三維**各自**都不回復(ddd)⇒ 項12 的三維各自有判別力" \
  || bad "靶⑨:三維觀察值 = $FAULT_OUT(期望 ddd —— 任何一維是 s 代表項12 的那一維恆綠、零判別力)"

# ── 項12b:證明「註解那一維」不是常數(否則上面兩格對它全盲)──
# 🔴 判別力的另一半:靶⑨ 只證明「apply 後 ≠ apply 前」。若 comment_sql 整組回 NULL,
#    pre 與 post 會是同一個 md5('(無)') ⇒ 這一格立刻紅,而靶⑨ 靠其他兩維仍可能被湊綠。
ROLL=$((ROLL+1))
FP_PRE_C="$(fp_dim "$(state_fp "$BASE_URL")" 3)"
FP_CTL_C="$(fp_dim "$(state_fp "$CTL_URL")" 3)"
if [ ${#FP_PRE_C} -eq 32 ] && [ ${#FP_CTL_C} -eq 32 ] && [ "$FP_PRE_C" != "$FP_CTL_C" ] && [ "$FP_CTL_C" = "$COMMENT_FP" ]; then
  ok R12b-fpdim "項12b 註解維非退化:pre-S2a($FP_PRE_C)≠ 套用後($FP_CTL_C),且後者=凍結 COMMENT_FP"
else
  bad "項12b 註解維退化:pre=[$FP_PRE_C] post=[$FP_CTL_C] 凍結=[$COMMENT_FP] —— 兩者相同或長度不對時,項12/靶⑨ 對註解那一維全盲"
fi

# ── 項13 / 靶⑪:runbook 步驟⑥ forward 重建 rehearsal ──
# 🔴 這裡重現的是 runbook 的真實地雷:A1 只把摘要表重建成**五欄**,而 `db push` 不會重跑已登記的 S2a
#    ⇒ 清單漏了 S2a 就永久少一欄,而且**零告警**。
# 🔴 誠實範圍:本 rehearsal **不重放 A4a**(那需要先做 runbook 步驟④ 的 trigger/函式拆除,不在本片)。
#    它證的是「清單裡有沒有 S2a」這一件事,不是整條步驟⑥ 都被演練過。
RUNBOOK="docs/runbooks/a4a-summary-rollback.md"
# 🔴🔴 **守門畫在被守護的那個面**(code-reviewer R1 must-fix):
#   原版把重建清單 hardcode 在這個函式裡,與 runbook 的 Forward 重建那一行**零連結** ——
#   有人把 `20260806100000` 從 runbook 刪掉(正是這兩格存在的理由),harness 照樣全綠、零告警。
#   改成:清單**從 runbook 的 Forward 重建那一行讀出來**,rehearsal 重放它真的列了什麼。
#   ⇒ 靶⑪ 也隨之改成「拿一份**把 S2a 從 runbook 刪掉**的副本重跑」,而不是腳本自己少跑一支。
runbook_migs() {  # $1 = runbook 檔 → 印出 Forward 重建那一行列到的時間戳;異常印 ERR:<原因>
  # 🔴 **不去重**(codex 關卡2):`awk '!seen[$0]++'` 會把「清單重複列了 A1 或 S2a」抹平 ——
  #    照文件操作的人會真的重跑第二次(S2a 重跑必紅 42701),rehearsal 卻看不到。不去重才對齊真實動作。
  # 🔴 **必須恰好一行**且**不得含刪除線**(codex 關卡2 當場構造出的假綠):
  #    舊的完整清單被 `~~` 劃掉、現行那行漏了 S2a 時,原本的 grep 會把兩行的時間戳聯集起來 ⇒
  #    parser 仍組得出正確三支而全綠,但真正要照著做的那一行是錯的。
  local lines n
  lines="$(grep -F -- '**Forward 重建**' "$1")"
  n="$(printf '%s\n' "$lines" | grep -c .)"
  [ "$n" = "1" ] || { printf 'ERR:FWD-LINES=%s' "$n"; return; }
  case "$lines" in *'~~'*) printf 'ERR:FWD-LINE-STRUCK'; return ;; esac
  printf '%s' "$lines" | grep -oE '\b20[0-9]{12}\b'
}
# 時間戳 → 檔案路徑(只認本 harness 重放得動的那些)
mig_path() {  # $1 = 時間戳 → 印出路徑;找不到印空字串
  local hits; hits="$(ls supabase/migrations/"$1"_*.sql 2>/dev/null)"
  [ "$(printf '%s\n' "$hits" | grep -c .)" = "1" ] && printf '%s' "$hits"
}
rehearse() {  # $1 = 要照哪一份 runbook → 設 REH_OUT = "<欄數>/<CHECK 數>" 或 <異常碼>
  local rb="$1" db="s2a_reh" U ts p
  fresh_db "$db"; U="$FRESH_URL"
  psql -X "$U" -v ON_ERROR_STOP=1 -q -f "$MIG" >/dev/null 2>&1 || { REH_OUT="APPLY-FAIL"; drop_db "$db"; return; }
  # 災難起點:摘要表與複合唯一鍵都不在了(逐字照 runbook 的 rollback 區塊,含**不帶** IF EXISTS)。
  # 🔴 這裡不能吞錯(R1 nit):吞掉之後真因會被後面的 A1-REPLAY-FAIL 蓋掉。
  psql -X "$U" -v ON_ERROR_STOP=1 -q > "$WORK/reh-preclean.log" 2>&1 <<'SQL'
DROP TABLE public.order_item_quantity_summary;
ALTER TABLE public.order_items DROP CONSTRAINT order_items_id_quantity_key;
SQL
  [ $? -eq 0 ] || { REH_OUT="PRECLEAN-FAIL:$(tail -1 "$WORK/reh-preclean.log")"; drop_db "$db"; return; }
  local migs A4A_SEEN=0 S2B_SEEN=0; migs="$(runbook_migs "$rb")"
  case "$migs" in ERR:*) REH_OUT="RUNBOOK-$migs"; drop_db "$db"; return ;; esac
  for ts in $migs; do
    # 🔴 A4a 刻意跳過:重放它要先做 runbook 步驟④ 的 trigger/函式拆除,不在本片範圍。
    #    跳過的是「重放動作」,不是「它有沒有被列在清單裡」—— 後者由下面的清單集合斷言顧。
    # 🔴 A4a 的跳點與 runbook 清單對帳(Fable R3 nit):失配時要紅在「跳點過期」,
    #    不要讓它以 REPLAY-FAIL 的形狀冒出來指錯方向。
    if [ "$ts" = "20260803140000" ]; then A4A_SEEN=1; continue; fi
    # 🔴 S2b 同樣刻意跳過(2026-08-06 B2-S2b-3b,plan 項31(i)):它的 §1 前置閘 pin **A4a helper 的
    #    三軸指紋**,而 A4a 在上一行被跳過 ⇒ helper 根本不在,直接重放必 RAISE、紅在 REPLAY-FAIL
    #    而指錯方向。跳的是「重放動作」,清單裡有沒有它由下面的 S2B_SEEN 顧。
    #    🔴 本檔量的是**摘要表的欄數與 CHECK 數**,而 S2b 不加欄不加 CHECK ⇒ 它對本檔的觀察值
    #    結構上全盲;S2b 產物的 rehearsal 斷言在 `scripts/b2s2b-verify.sh`(項31③)。
    if [ "$ts" = "20260806180000" ]; then S2B_SEEN=1; continue; fi
    p="$(mig_path "$ts")"
    [ -n "$p" ] || { REH_OUT="NO-SUCH-MIG:$ts"; drop_db "$db"; return; }
    psql -X "$U" -v ON_ERROR_STOP=1 -q -f "$p" > "$WORK/reh-$ts.log" 2>&1 \
      || { REH_OUT="REPLAY-FAIL:$ts:$(tail -1 "$WORK/reh-$ts.log")"; drop_db "$db"; return; }
  done
  [ "$A4A_SEEN" = "1" ] || { REH_OUT="A4A-SKIP-STALE(清單裡沒有 20260803140000,跳點該重估)"; drop_db "$db"; return; }
  [ "$S2B_SEEN" = "1" ] || { REH_OUT="S2B-SKIP-STALE(清單裡沒有 20260806180000,跳點該重估)"; drop_db "$db"; return; }
  REH_OUT="$(q "$U" "SELECT count(*) FROM pg_attribute WHERE attrelid='${SUMMARY}'::regclass AND attnum>0 AND NOT attisdropped")/$(q "$U" "SELECT count(*) FROM pg_constraint WHERE conrelid='${SUMMARY}'::regclass AND contype='c'")"
  drop_db "$db"
}

# 項13:照**真的 runbook** 重放。誠實範圍:清單裡的 A4a 被跳過(見上),
# 所以這一格證的是「清單列了哪些 + 列到的那些重放後長什麼樣」,不是整條步驟⑥ 都被演練過。
rehearse "$RUNBOOK"
ROLL=$((ROLL+1))
REH_LIST="$(runbook_migs "$RUNBOOK" | tr '\n' ',' | sed 's/,$//')"
# 🔴 凍結清單 2026-08-06 由 B2-S2b-3b 同批更新(plan 項31):runbook 的 Forward 那一行加了 S2b
#    ⇒ 這個硬比字串**必須同批加**,否則本格會先紅(而它紅的是「清單變了」,不是「清單錯了」)。
REH_LIST_FROZEN="20260730150000,20260803140000,20260806100000,20260806180000"
if [ "$REH_OUT" = "6/10" ] && [ "$REH_LIST" = "$REH_LIST_FROZEN" ]; then
  ok R13-rehearsal "項13 rehearsal:runbook Forward 清單 = [$REH_LIST],照它重放(A4a / S2b 跳過)後 = 6 欄 / 10 CHECK"
else
  bad "項13 rehearsal:觀察值 = $REH_OUT(期望 6/10)/ runbook 清單 = [$REH_LIST](期望 $REH_LIST_FROZEN)"
fi

# 靶⑪:把 S2a 從 **runbook** 的 Forward 那一行拿掉(不是讓腳本少跑一支)⇒ 項13 必須轉紅。
# 🔴 取代字串**不得含 14 位數字**,否則 runbook_migs 會把它當成另一支 migration
#    (實錘:原本取代成 `20260806000000-REMOVED`,結果拿到 NO-SUCH-MIG 而不是「少一支」)。
rm -f "$WORK/runbook-no-s2a.md"
sed 's/20260806100000/S2A-已從清單移除/g' "$RUNBOOK" > "$WORK/runbook-no-s2a.md" \
  || die "靶⑪:產生突變 runbook 失敗(run 模式下若沿用上一輪的舊檔會假綠)"
# 🔴 `cmp` 的 rc=2 是**讀取失敗**,不是「有差異」(codex 關卡2 R2:`&&…||…` 把 2 歸到 else
#    ⇒ 檔案讀不到時照樣往下跑,rehearsal 剛好回 5/7 就假綠)。逐值分流,不用 &&/||。
cmp -s "$RUNBOOK" "$WORK/runbook-no-s2a.md"; c11=$?
case "$c11" in
  0) bad "靶⑪:runbook 副本與原檔無差異(取代沒命中)" ;;
  1) rehearse "$WORK/runbook-no-s2a.md"
     [ "$REH_OUT" = "5/7" ] \
       && ok ROLL-MUT-11 "靶⑪ 從 runbook 拿掉 S2a:重建後只剩 5 欄 / 7 CHECK ⇒ 項13 真的綁在 runbook 那一行(這就是原本零告警的地雷)" \
       || bad "靶⑪ 觀察值 = $REH_OUT(期望 5/7 —— 若是 6/10 代表項13 沒有綁到 runbook、恆綠)" ;;
  *) bad "靶⑪:cmp 讀不到檔(rc=$c11)—— 不當成有差異,判紅" ;;
esac
RMUT=$((RMUT+1))

# ── 項14 / 靶⑭:migration 的 apply 說明錨 + runbook 的 apply 前置閘段落 ──
# 🔴 **兩位審查者在 migration 側那一半上結論相反,兩邊都對、只是時點不同 —— 保留並標註**:
#   · code-reviewer R1:`grep S2A-APPLY-NOTE "$MIG"` 恰 1 次被 `MIG_SHA_FROZEN` **嚴格蘊含** ——
#     要讓它變 0 就得改 $MIG,而改了會先 die 在 sha 閘 ⇒ **今天**構造不出只紅這一半的負測。
#   · codex 關卡2:sha 是**會被合法更新**的凍結值;更新的那一天,這道就是唯一還在看 marker 的東西。
#   ⇒ 判定:**保留**,但誠實標註「今天零獨立判別力」——它屬於深度防禦的排序(窄的先、寬的後),
#     不是判別力宣稱。若日後把它刪掉,sha 一被合法更新,marker 遺失或重複就再也沒有東西會紅。
# 🔴 runbook 那一半必須驗「它**說了什麼**」而不是「字串存在」(存在性斷言對「還在但失效」全盲):
#   把段落改寫成「舊做法,已廢止」時命中數仍 ≥1,而正式站前置閘已實質失效。
runbook_gate_ok() {  # $1 = runbook 檔 → 0 = 段落還在且仍是必跑語氣
  local rb="$1" sect
  # 只取「apply 前置步驟」那一節(到下一個 ### 或 **Forward 為止),避免錨命中別節。
  # 🔴 段落的**結束條件要跟註解一致**(codex 關卡2:原本只停在 Forward 重建,
  #    gate 內容被搬到下一節時這一節仍被判完整)⇒ 下一個 `### ` 也是結束。
  # 🔴 標題必須**恰好一節**(codex 關卡2 R2):原本起始規則排在終止規則之前 ⇒ 第二個同名
  #    `###` 會**重新啟動**而不是截斷,於是把必備錨拆散在兩節裡也能湊齊、項14 照樣綠。
  local heads; heads="$(grep -c '^### .*B2-S2a apply 前置步驟' "$rb")"
  [ "$heads" = "1" ] || return 1
  sect="$(awk '/^### .*B2-S2a apply 前置步驟/{s=1; print; next}
               s && (/^### /||/^\*\*Forward 重建\*\*/){s=0}
               s' "$rb")"
  [ -n "$sect" ] || return 1
  # 🔴 刪除線 = 語意失效但字串還在(codex 關卡2)。`~~**必跑,不是建議**~~` 仍含該子字串,
  #    純 grep 存在性會照樣綠 ⇒ 整節出現 `~~` 一律判不通過。
  case "$sect" in *'~~'*) return 1 ;; esac
  printf '%s' "$sect" | grep -qF '**必跑,不是建議**'        || return 1
  printf '%s' "$sect" | grep -qF 'b2s2a-verify.sh gate'      || return 1
  printf '%s' "$sect" | grep -qF '不通過(exit 3)= 停'      || return 1
  # 🔴 Fable R3:「停」之後必須答得出**問誰**,否則半夜的 operator 停在原地不知道找誰。
  printf '%s' "$sect" | grep -qF '問 Sean'                   || return 1
  # 🔴 同上:兩個情境(首次 apply / 災難重建)必須都在,否則「必跑的閘在主情境必紅」無人接得住。
  printf '%s' "$sect" | grep -qF '出貨線已上線'              || return 1
  printf '%s' "$sect" | grep -qF '接下方替代路徑 A'          || return 1
  return 0
}
ROLL=$((ROLL+1))
APPLY_HITS="$(grep -oF -- 'S2A-APPLY-NOTE' "$MIG" | wc -l | tr -d ' ')"
if [ "$APPLY_HITS" = "1" ] && runbook_gate_ok "$RUNBOOK"; then
  ok R14-applynote "項14 apply 說明:migration 內 S2A-APPLY-NOTE 恰 1 次(今天由 sha 閘蘊含,見上方註解)+ runbook 前置閘段落恰一節、無刪除線,且六項齊全(必跑字樣 / gate 指令 / 「停」的處置 / 問 Sean / 出貨線已上線情境 / 接下方替代路徑 A)"
else
  if [ "$APPLY_HITS" != "1" ]; then
    bad "項14(migration 側):S2A-APPLY-NOTE 命中 $APPLY_HITS 次,期望 1"
  else
    bad "項14(runbook 側):apply 前置閘段落缺漏、標題不只一節、被刪除線劃掉,或六項必備內容缺一 —— 必跑字樣 / gate 指令 / 「停」的處置 / 問 Sean / 出貨線已上線情境 / 接下方替代路徑 A"
  fi
fi

# 靶⑭:把段落降級成「已廢止」⇒ 項14 必須轉紅(證明它驗的是內容、不是字串存在)。
rm -f "$WORK/runbook-gate-void.md"
sed 's/\*\*必跑,不是建議\*\*/舊做法,已廢止(保留備查)/' "$RUNBOOK" > "$WORK/runbook-gate-void.md" \
  || die "靶⑭:產生突變 runbook 失敗(run 模式下若沿用上一輪的舊檔會假綠)"
RMUT=$((RMUT+1))
# 🔴 同上:rc=2 是讀取失敗,不得落進「有效突變」那一支(codex 關卡2 R2)。
cmp -s "$RUNBOOK" "$WORK/runbook-gate-void.md"; c14=$?
case "$c14" in
  0) bad "靶⑭:runbook 副本與原檔無差異(取代沒命中)" ;;
  1) if runbook_gate_ok "$WORK/runbook-gate-void.md"; then
       bad "靶⑭:段落被降級成「已廢止」後項14 照樣綠 ⇒ 它只驗字串存在、不驗說了什麼(恆真格)"
     else
       ok ROLL-MUT-14 "靶⑭ 把前置閘段落降級成「已廢止」:項14 轉紅 ⇒ 它驗的是段落內容不是字串存在"
     fi ;;
  *) bad "靶⑭:cmp 讀不到檔(rc=$c14)—— 不當成有效突變,判紅" ;;
esac

# ── 項15:gate 模式**五條**路徑的實跑覆蓋 ──
# 🔴 **gate 是這一片唯一會在正式站執行的程式碼**,卻原本零覆蓋(code-reviewer R1 must-fix):
#   把 `!=` 打成 `=` 之類的錯誤沒有任何一格會紅。五條路徑一次量,觀察值合成一個字串比對。
# 🔴 **兩張表要各自隔離**(codex 關卡2):只構造 shipments 非零時,把第二個 count 整句刪掉
#   或釘死成 0,其餘路徑仍全綠 ⇒ shipment_items 那一句從未被證明有作用。第四條路徑專門隔離它。
ROLL=$((ROLL+1))
bash scripts/b2s2a-verify.sh gate "$CTL_URL" >/dev/null 2>&1;                    G_ZERO=$?
fresh_db s2a_gate; GATE_URL="$FRESH_URL"
psql -X "$GATE_URL" -v ON_ERROR_STOP=1 -q > "$WORK/gate-seed.log" 2>&1 <<'SQL'
INSERT INTO public.shipments (shipment_reference, customer_user_id, recipient_snapshot, carrier_code)
SELECT '23456B', c.user_id,
       '{"name":"驗證用","phone":"0900000000","line":"none"}'::jsonb, 'hct'
FROM public.customers c LIMIT 1;
SQL
GATE_SEEDED="$(q "$GATE_URL" 'SELECT count(*) FROM public.shipments')"
# 🔴 子表也要斷言為 0(codex 關卡2 R2):否則 seed 若有副作用產生子列,
#    「刪掉第一個 count」的突變會被第二個 count 餵綠 ⇒ 這條路徑失去隔離性。
GATE_SEEDED_I="$(q "$GATE_URL" 'SELECT count(*) FROM public.shipment_items')"
bash scripts/b2s2a-verify.sh gate "$GATE_URL" >/dev/null 2>&1;                   G_NONZERO=$?
bash scripts/b2s2a-verify.sh gate "postgresql://postgres@127.0.0.1:1/nope" >/dev/null 2>&1; G_DEAD=$?
drop_db s2a_gate

# 第四條:**只有 shipment_items 非零、shipments 為 0**。FK 是 ON DELETE RESTRICT,
# 所以要在拋棄副本上先拆掉那條 FK 才構造得出來 —— 目的就是讓「刪掉第二個 count」變得看得見。
fresh_db s2a_gate_i; GATEI_URL="$FRESH_URL"
psql -X "$GATEI_URL" -v ON_ERROR_STOP=1 -q > "$WORK/gate-seed-items.log" 2>&1 <<'SQL'
INSERT INTO public.shipments (shipment_reference, customer_user_id, recipient_snapshot, carrier_code)
SELECT '23456B', c.user_id,
       '{"name":"驗證用","phone":"0900000000","line":"none"}'::jsonb, 'hct'
FROM public.customers c LIMIT 1;
INSERT INTO public.shipment_items (shipment_id, order_item_id, shipped_quantity)
SELECT s.id, oi.id, 1 FROM public.shipments s CROSS JOIN public.order_items oi LIMIT 1;
-- 🔴 shipments 是 append-only(trigger `shipments_block_delete_bd`),shipment_items 的 FK 又是
--    ON DELETE RESTRICT ⇒ 「只有子表非零」在正常規則下**構造不出來**(實測紅在
--    pcm_b2_shipments_block_delete)。在**拋棄副本**上把那兩道拆掉才做得出這個隔離情境 ——
--    拆的是這份副本的規則,不是產品的規則;正式站的 append-only 不受影響。
ALTER TABLE public.shipment_items DROP CONSTRAINT shipment_items_shipment_id_fkey;
DROP TRIGGER shipments_block_delete_bd ON public.shipments;
DELETE FROM public.shipments;
SQL
GATEI_SHIP="$(q "$GATEI_URL" 'SELECT count(*) FROM public.shipments')"
GATEI_ITEM="$(q "$GATEI_URL" 'SELECT count(*) FROM public.shipment_items')"
bash scripts/b2s2a-verify.sh gate "$GATEI_URL" >/dev/null 2>&1;                  G_ITEMONLY=$?
drop_db s2a_gate_i

# 第五條:**runbook 推薦給正式站的那條路徑**(零參數、純 libpq 環境變數)——
# 🔴 codex 關卡2 R2:前四條全走位置參數 ⇒ env-only 那條壞掉也照樣 PASS,
#   而它才是 runbook 叫人在正式站用的那一條。這裡對對照組副本用 PG* 變數跑一次。
G_ENV=$(PGHOST=127.0.0.1 PGPORT="$PORT" PGUSER=postgres PGDATABASE=s2a_ctl \
        bash scripts/b2s2a-verify.sh gate >/dev/null 2>&1; echo $?)

# 🔴 先確認兩個負測**真的構造出來了**(seed 插 0 列時 exit code 會是 0,看起來像 gate 壞了 ——
#    S2a-2 的 gate 負測第一次就是這樣沒觸發。負測構造不出來時先懷疑自己。)
if [ "$GATE_SEEDED" != "1" ]; then
  bad "項15:gate 負測沒構造出來(seed 後 shipments=$GATE_SEEDED,期望 1)—— $(tail -1 "$WORK/gate-seed.log")"
elif [ "$GATEI_SHIP/$GATEI_ITEM" != "0/1" ]; then
  bad "項15:shipment_items 隔離負測沒構造出來(shipments=$GATEI_SHIP / shipment_items=$GATEI_ITEM,期望 0/1)—— $(tail -1 "$WORK/gate-seed-items.log")"
elif [ "$GATE_SEEDED_I" != "0" ]; then
  bad "項15:shipments 負測不夠隔離(seed 後 shipment_items=$GATE_SEEDED_I,期望 0)—— 子表非 0 會讓「刪掉第一個 count」的突變被餵綠"
elif [ "$G_ZERO/$G_NONZERO/$G_DEAD/$G_ITEMONLY/$G_ENV" = "0/3/3/3/0" ]; then
  ok R15-gate "項15 gate 五路徑:兩表皆 0→0 / shipments 非 0→3 / 連不上→3 / **只有 shipment_items 非 0**→3(隔離第二個 count)/ **零參數純 libpq 環境變數**→0(runbook 給正式站的那一條)"
else
  bad "項15 gate 五路徑觀察值 = $G_ZERO/$G_NONZERO/$G_DEAD/$G_ITEMONLY/$G_ENV(期望 0/3/3/3/0)"
fi

# ── 項16 / 靶⑮:災難日**真正會走的那條路徑 A** 的守門 ──
# 🔴🔴 Fable R3 must-fix:項13 演練的是**整檔重放**,而 runbook 自己說那條在主情境(出貨線已上線)
#   必然 abort ⇒ **災難日真正要走的是路徑 A(手動補 BEGIN、跑 §2→§3→§4),而它零機器守門**。
#   把路徑 A 整段刪掉、或它引用的字面數字過期,PASS 照樣全綠 —— 讀的人會以為災難路徑被覆蓋了。
# 🔴 這一格同時把路徑 A 的**數字**釘回 migration 本體:§2 的 ADD 個數與 §3 的 COMMENT 句數
#   由 migration 實測算出來,不是抄 runbook 的字面 ⇒ 日後 sha 合法更新而數字沒同步時會紅。
pathA_ok() {  # $1 = runbook 檔 → 0 = 路徑 A 段落還在且與 migration 對得上
  local rb="$1" sect adds comments amark
  # 🔴 「恰好一處」(Fable R3 複驗 nit):沒有這道時,日後文件出現第二個同形 `· **A**` 區塊,
  #    awk 會把多塊串接,必備錨可拆散在兩塊之間湊齊 —— 與 runbook_gate_ok 在 R2 修掉的是同型病。
  amark="$(grep -c '^  · \*\*A\*\*' "$rb")"
  [ "$amark" = "1" ] || return 1
  sect="$(awk '/^  · \*\*A\*\*/{s=1} s&&/^  · \*\*B\*\*/{s=0} s' "$rb")"
  [ -n "$sect" ] || return 1
  case "$sect" in *'~~'*) return 1 ;; esac
  printf '%s' "$sect" | grep -qF '必須自己補 `BEGIN;` … `COMMIT;`'        || return 1
  printf '%s' "$sect" | grep -qF '§4 的結構驗收 DO block 一起跑'          || return 1
  printf '%s' "$sect" | grep -qF 'S2A 結構驗收全數通過(6 欄 / 10 CHECK / 7 註解物件)' || return 1
  # 字面數字對回 migration 實測值(四個 ADD、七句 COMMENT)
  adds="$(grep -cE '^\s+ADD (COLUMN|CONSTRAINT)' "$MIG")"
  comments="$(grep -cE '^COMMENT ON ' "$MIG")"
  [ "$adds" = "4" ] && [ "$comments" = "7" ]                              || return 1
  printf '%s' "$sect" | grep -qF '四個 ADD'                               || return 1
  printf '%s' "$sect" | grep -qF '七句 COMMENT'                           || return 1
  return 0
}
ROLL=$((ROLL+1))
if pathA_ok "$RUNBOOK"; then
  ok R16-pathA "項16 災難日路徑 A:段落還在,且交易邊界 / §4 驗收 / 驗收字串三項齊全,四個 ADD + 七句 COMMENT 與 migration 實測相符"
else
  bad "項16:runbook 的替代路徑 A 缺漏、被刪除線劃掉、或其字面數字與 migration 實測不符(ADD=$(grep -cE '^\s+ADD (COLUMN|CONSTRAINT)' "$MIG") COMMENT=$(grep -cE '^COMMENT ON ' "$MIG"))"
fi

# 靶⑮:把路徑 A 整段拿掉 ⇒ 項16 必須轉紅(Fable 的翻案條件 3 就是這個實測)。
rm -f "$WORK/runbook-no-pathA.md"
awk '/^  · \*\*A\*\*/{s=1} s&&/^  · \*\*B\*\*/{s=0} !s' "$RUNBOOK" > "$WORK/runbook-no-pathA.md" \
  || die "靶⑮:產生突變 runbook 失敗"
RMUT=$((RMUT+1))
cmp -s "$RUNBOOK" "$WORK/runbook-no-pathA.md"; c15=$?
case "$c15" in
  0) bad "靶⑮:runbook 副本與原檔無差異(路徑 A 段落沒被刪掉)" ;;
  1) if pathA_ok "$WORK/runbook-no-pathA.md"; then
       bad "靶⑮:路徑 A 整段被刪掉後項16 照樣綠 ⇒ 災難日路徑零守門(恆真格)"
     else
       ok ROLL-MUT-15 "靶⑮ 刪掉 runbook 的路徑 A 整段:項16 轉紅 ⇒ 災難日真正要走的那條路徑確實被釘住了"
     fi ;;
  *) bad "靶⑮:cmp 讀不到檔(rc=$c15)—— 不當成有效突變,判紅" ;;
esac

[ "$ROLL" -eq "$EXPECT_ROLL" ] || bad "回滾段只跑了 $ROLL 格,期望 $EXPECT_ROLL"
[ "$RMUT" -eq "$EXPECT_ROLL_MUT" ] && ok ROLL-MUT-COUNT "回滾段突變靶跑滿 $RMUT 個(期望 $EXPECT_ROLL_MUT)" \
  || bad "回滾段突變靶只跑了 $RMUT 個,期望 $EXPECT_ROLL_MUT"

log "7/9 格數自斷言(F2:少跑一格自己紅,不靠人數輸出)"
[ "$MUT" -eq "$EXPECT_MUT" ] && ok MUT-COUNT "突變靶跑滿 $MUT 個(期望 $EXPECT_MUT)" \
  || bad "突變靶只跑了 $MUT 個,期望 $EXPECT_MUT —— 清單被改短了"

# ══ 5. 零殘留 ═══════════════════════════════════════════════════════════════
log "8/9 零殘留:基準庫必須仍是 pre-S2a(所有動作都在副本上)"
[ "$(q "$BASE_URL" "SELECT count(*) FROM pg_attribute WHERE attrelid='${SUMMARY}'::regclass AND attname='shipped_quantity' AND NOT attisdropped")" = "0" ] \
  && ok BASE-CLEAN "基準庫零殘留(仍無 shipped_quantity 欄)" \
  || bad "🔴 基準庫被污染了(長出 shipped_quantity 欄)—— 之後的 run 模式全部不可信"
LEFT="$(q "$ADMIN_URL" "SELECT COALESCE(string_agg(datname,','),'(無)') FROM pg_database WHERE datname LIKE 's2a\\_%' AND datname <> 's2a_ctl'")"
[ "$LEFT" = "(無)" ] && ok COPIES-DROPPED "突變用的副本資料庫已全數清除" || bad "殘留副本資料庫:$LEFT"

# ══ 6. 結語 ═════════════════════════════════════════════════════════════════
log "9/9 結果"
# 🔴 這道必須排在印摘要**之前**(codex 關卡2 R2:原本先印 FAIL=0 再檢查,
#    唯一那行計數摘要在失配時仍是假綠,雖然最終 RC=1)。
GOT_KEYS="$(printf '%s\n' $PASS_KEYS | sort | tr '\n' ' ' | sed 's/ *$//')"
EXP_KEYS="$(printf '%s\n' $EXPECT_PASS_KEYS | sort | tr '\n' ' ' | sed 's/ *$//')"
[ "$GOT_KEYS" = "$EXP_KEYS" ] || {
  echo "🔴 通過的格子集合不符 —— 有檢查被刪掉、重複、或改了名"
  echo "   實際 [$GOT_KEYS]"
  echo "   期望 [$EXP_KEYS]"
  FAIL=$((FAIL+1)); }
# 🔴 teardown(2026-08-11 W-c1 新增):本支原本跑完**不收 cluster**(「零留痕」指交易 ROLLBACK,
#    不是關 postmaster)⇒ 連錄兩次第二次必被自己上一輪佔埠。
# 🔴 兩段式:d1t2 的 teardown **要求 workdir 有 `.d1t2-harness` ownership marker**
#    (它對沒有 marker 的目錄會 die,是刻意的安全設計)。自己 provision 的 harness 沒有那個 marker
#    ⇒ 第一段會靜默無效(實測:b2s2a 就是這樣留下一座 postmaster)。
#    ⇒ 第二段自己收,但**只收 `$WORK/pgdata` 這一座**,絕不對別人的 datadir 動手。
# 🔴🔴 **順序不可調(W-c1 R1 C1)**:這一段會 `FAIL+1`,必須跑在總結行**之前**。原本印在後面
#    ⇒ 留痕時收據記 `FAIL=0` 而 exit=1、自相矛盾,而「留痕」正是本片新增的這道檢查
#    唯一要抓的失敗模式 ⇒ 唯一會用到它的那個情境,收據剛好在說謊。
bash "$(dirname "$0")/d1t2-rehearsal.sh" teardown "$WORK" >/dev/null 2>&1 || true
if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
  if [ -d "$WORK/pgdata" ]; then
    "$(dirname "$(command -v initdb)")/pg_ctl" -D "$WORK/pgdata" stop -m immediate >/dev/null 2>&1 || true
  fi
fi
if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
  echo "  🔴 teardown 後 port $PORT 仍有人聽(留痕)"; FAIL=$((FAIL+1))
else
  echo "  ✅ teardown 後 port $PORT 無人聽(零留痕)"
fi

# 🔴 MUT0 是**只剝不改的對照組**,不是突變靶(codex 關卡2)⇒ 合計要扣掉它,不然會多報一發。
# 🔴 W-c1:`PASS=n` 與 `FAIL=n` 之間原本是**兩個空格**,而 w7-coverage 的 recorder
#    要單空格相鄰(`sed -n 's/.*PASS=\([0-9]*\) FAIL=\([0-9]*\).*/…/p'`)⇒ 解析不到、收據恆紅。
#    只改分隔字元,數值與判定未動。
printf 'PASS=%s FAIL=%s  MUT=%s(結構段,含 MUT0 對照) BMUT=%s(行為段) RMUT=%s(回滾段) 合計 %s 發突變靶 + 1 組對照\n' \
  "$PASS" "$FAIL" "$MUT" "$BMUT" "$RMUT" "$((MUT - 1 + BMUT + RMUT))"
# 🔴 沒有這道:整段刪掉身分閘 / pre-S2a 確認 / 零殘留之後,會變成 PASS=14 FAIL=0 照樣 exit 0。

# 🔴 W-c1 R1 折面順手更正:這兩行原本寫「可直接連上去看落地後的樣子 / psql …」——
#    自從本片加了 teardown,cluster 跑完就被收掉,那句話當場失效(貼了也連不上)。
#    s2a_ctl 這個庫沒有被 DROP、datadir 也還在,但**要看得自己先重啟**。
#    這裡不給重啟指令:沒有親手貼過的指令不寫進別人照做的輸出。
echo "對照組副本 s2a_ctl 沒有被 DROP,datadir 留在 $WORK/pgdata —— 但 cluster 已在上面 teardown 收掉,"
echo "  要看落地後的樣子得自己把它重新啟動再連 s2a_ctl。"
echo
echo "🔴 本支**不涵蓋**(誠實邊界,詳見檔頭):正式站行為(這裡是本機 PG17、非 Supabase);"
echo "   結構段 17 格中只有 7 格由突變證明;行為段的項8 不碰受測 DB、也沒有對應突變;"
echo "   回滾段 7 格中**項10、項12b、項15 沒有對應突變靶**(項12/13/14/16 各有 ⑨/⑪/⑭/⑮;"
echo "   項15 靠五條路徑互為對照,不是靠外部突變檔);"
echo "   🔴 **災難日的替代路徑 A 只被「文件還在且數字對得上」釘住,從未被實跑演練**"
echo "   (項13 演練的是整檔重放,而 runbook 自己說那條在出貨線已上線時必然 abort);"
echo "   🔴 gate 的第五條路徑只測到 libpq 環境變數,**~/.pgpass 取密機制從未實跑**;"
echo "   rehearsal **跳過 A4a 與 S2b 的重放**(兩者都要先做 runbook 步驟④ 的拆除;清單裡有沒有它們仍被斷言)。"
echo "   🔴 **本檔對 S2b 的產物結構上全盲**(只量摘要表欄數與 CHECK 數,而 S2b 不加欄不加 CHECK)——"
echo "      那一面由 scripts/b2s2b-verify.sh 的 REH-PRODUCTS 格承擔(B2-S2b-3b 第二段)。"

[ "$FAIL" -eq 0 ] || exit 1
