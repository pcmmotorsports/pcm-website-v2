#!/usr/bin/env bash
#
# W6b-2 · **B3 barrier:`cancel × unvoid` 併發**(§6a 的第三組)
#
# 用法:scripts/w6b2-cancel-vs-unvoid.sh   (自建拋棄式 cluster、跑完自動 teardown)
# 真權威:plan v4.2 §6a 的 B3 列 / §2a(`W6b` 依賴 W6a・W4・W3)
# 編排骨架:照 `scripts/w6b1-ship-vs-unvoid.sh`(advisory barrier、零 FIFO、全程有界輪詢)
#
# ══ 🔴🔴 申報一:**交接信 `B-289-STOP` ⑥ 的 fixture 是死的**(開工探針實證)═════
#   ⑥ 寫的設計是「`quantity=3`、`instock=3`;箱 V 掛 3 → 出貨 → 作廢 ⇒ 部分取消 3 件
#   (可取消量 = `quantity − cancelled`,**不減 shipped**)⇒ 取消的前緣過得了」。
#   **實跑:過不了。連取消 1 件都被拒。**
#     · ⑥ 引 `…s2a…sql:176` 的逐字是對的 —— 那句講的是「**不減 shipped**」。
#     · 但真正在跑的可取消量守門是 `…a8a2…sql:395-405`:**增量 ≤ quantity − instock − cancelled**。
#       ⑥ 把「不減 shipped」讀成了「只減 cancelled」,**漏掉 `− instock` 那一項**。
#     · ⇒ `quantity 3 − instock 3 − cancelled 0 = 0` ⇒ 取消側在**前緣**就死,根本走不到 C6′。
#   🔴 這是**字面 vs 事實**的更正,不是等價替換;本檔把它做成格(`W6B2-STOP6-FIXTURE-DEAD`)釘住。
#
# ══ 🔴🔴 申報二:**§6a B3 的翻面靶不可構造 —— 而且 B3 這一對根本沒有危險面** ═══
#   §6a B3 列寫的翻面靶是「**拿掉其中一側的鎖** ⇒ 撞 C6′」。開工令 ③-1 已裁:
#   若如 B2 一樣無物可拿,靶改打 **C6′ 本身 + 轉譯層**。實查結果**比那還嚴重一層**:
#
#   兩支 writer 的前緣預算是**互補**的,而且各自只讀對方不寫的軸:
#     · 取消前緣(`…a8a2…sql:395-405`):增量 ΔC ≤ quantity − instock − cancelled
#     · 復原前緣(`…w3c2…sql:121-144`,P2B27):shipped + 本箱量 s ≤ instock
#     · ~~instock 兩邊都**不寫**~~;cancelled 只有取消寫;shipped 只有出貨/復原寫。
#
#   🔴 **更正(追加不改寫;W6b-3 實證、主視窗 `B-209-A` ⑥-1 裁定照追加式修)**:
#      上面兩條前緣句裡的「instock」**是誤名,兩側指的不是同一個物件**——
#        · **取消**前緣直讀的是 **`order_item_procurement_receipts` 真相表**
#          (`…a8a2…sql:400-402` 逐字 `sum(r.quantity) FROM … JOIN … receipts`,且**帶 `r.quantity > 0` 濾**);
#        · **復原**前緣讀的才是摘要欄 `order_item_quantity_summary.instock_quantity`
#          (`…w3c2…sql:130` `coalesce(q.instock_quantity,0)`),而 A4a 的 sum **不濾**(`…a4a…sql:170-173`)。
#      🔴 **本檔的結論不受影響**(互補代數仍成立,今天兩值恆等 —— 靠 `…a2…sql:198`
#         `CHECK (quantity BETWEEN 1 AND 100000)` 保證非負)。**受影響的是機制名**:
#         照舊字面去開修復片的人會把序列化點畫在**摘要列**,而取消前緣根本不碰那張表。
#      🔴 **機制名一律照 `scripts/w6b3-cancel-vs-receipt.sh` 讀**;第 2 批若引入沖銷/負值列,
#         兩個 I 分岔 ⇒ **W6b-2 與 W6b-3 兩片一起重估**(主視窗已收進 STATUS 同一格)。
#   ⇒ ΔC ≤ Q − I 且 s ≤ I ⇒ **ΔC + s ≤ Q 恆成立** ⇒ C6′(cancelled + shipped ≤ quantity)**摸不到**。
#   ⇒ 併發在這一對上**不提供任何新的交錯危險**:沒有一方讀到另一方會改的值,無陳舊可言。
#
#   🔴 這與 C6′ 自己的 catalog 註解一致(`…s2a…sql:178`:「代數冗餘、物理上無法單獨觸發」):
#      C9(shipped ≤ instock)∧ C7(instock + cancelled ≤ quantity)在非負整數上逐點蘊含 C6′。
#   🔴 **但「摸不到」不准用寫的**(本線教訓:負測構造不出來 = 先懷疑那條守門是 no-op,
#      而宣告「構造不出」前必須窮舉維度)。本檔的做法是**兩面都做**:
#        ① 正面:對可達參數空間做**有界掃描**,每一格先寫下**可證偽的預測**再比對實測
#           (`W6B2-BUDGET-COMPLEMENTARY`),並含 **instock 縮小**這個維度(`W6B2-SHRINK-DIM`)。
#        ② 反面:**把守門一層一層拿掉**,證明 C6′ 不是 no-op、只是被遮住:
#           拿掉 `− instock` 項 ⇒ 撞的是 **C7**(⇒ 該項與 C7 是同一條不變式的兩層,C6′ 仍摸不到);
#           再拿掉 C7 ⇒ **C6′ 單獨紅**(C9 同時成立)⇒ 它有真判別力、只是被 C7 嚴格遮蔽。
#
# ══ 🔴 誠實邊界 ════════════════════════════════════════════════
#   · 本檔**不宣稱**「B3 這一對永遠安全」——它宣稱的是:在**本檔跑過的維度**上
#     (instock **1-3**、箱量 1-3、取消增量 1-3、instock 事後縮小、兩支 writer **同時放行**)危險面不可達。
#     🔴 逐字校過的三件(跨模型審查 F1/F9;枚舉寫下即過期,所以寫的是實參不是印象):
#       · instock **0 一次都沒跑**(`mkround` 的實參只有 1/2/3)。0 也**不是 B3 的組態** ——
#         沒到貨就掛不出箱(C9 擋在出貨那一步),復原側根本沒有箱可以復原,這一對構不成。
#       · 「真併發」收斂成「**同時放行**」:barrier 證的就只有這件事(見 `W6B2-BARRIER` 自承),
#         **危險區有沒有重疊沒有任何格在證**。B3 的結論在序列與併發下同值,重疊非承重面。
#       · 沒跑到的維度(多品項同箱、多箱同品項併發、**取消 × 取消併發**、取消 × 到貨併發、
#         **冪等重放路徑**)**不在本檔的帳上**。
#     🔴 ~~**推論、本檔未實測**(所以只寫成欠款、不寫成結論):instock 是「取消」與「到貨」的
#        **共同軸**(取消前緣讀它、到貨寫它)⇒ 那一對才有陳舊面,而 §6a 四組 barrier 裡**沒有它**。
#        壞法應是同族的「紅在無辜交易」(`…s2a…sql:143` 對 C9 已寫過同型警語)。由主視窗裁,不歸本片。~~
#     🔴 **更正(追加不改寫,同上;這段有兩處過期)**:
#        ① **誤名同上** —— 共同軸是 **receipts 真相表**,不是摘要的 `instock` 欄。
#        ② **不再是推論** —— 主視窗已據此開 W6b-3(`B-208-A` ③),
#           `scripts/w6b3-cancel-vs-receipt.sh` **已實證**該對真有危險面(序列就成立、C7 唯一牆)。
#           🔴 但引用它必須連兩個限定詞一起讀:**今天正式站構造不出來**(應用 role 對 receipts 零寫入權)
#           且**只對未付款單成立** ⇒ 那是**第 2 批到貨 writer 的開工硬前置**,不是「線上現在有洞」。
#   · `W6B2-LOSER-HUMAN` 量的是 **C6′ 的轉譯**,而 C6′ 只在突變後可觀察
#     ⇒ 這一格**只能在突變過的 schema 上跑**,檔內已標。
#     🔴 **2026-08-08 W7d-1 更新**:它以前只證「是人話」、不證「引導是對的」(W6b-1 F3 同族欠款)。
#        W7d-1 讓 `admin_unvoid_shipment` 在自己的 handler 覆寫 C9 補救方向之後,
#        本格的判定式改認覆寫字面 ⇒ **連方向一起證了**,那筆欠款在這條路上結清。
#     🔴 但**證據等級仍只到「序列流程」** —— 驗訊息的 `seq_c6p` 是取消先提交再呼 unvoid,不是併發臂。
#
# ══ 🔴 判準四句(承自 w0b/w1/w2/w3*/w5/w6a/w6b1)══════════════════
#   🔴 消融必須由紅轉綠,否則判別力歸屬錯。
#   🔴 全綠的消融也可能恆真,隔離守門自己要有靶。
#   🔴 「我的 SQL 寫壞了」不得與「被別的守門擋住」共用同一句結論。
#   🔴 家族格的靶不得只打一個成員。
#
# 🔴 本檔跑在**裸 PG,不是 Supabase**。🔴 **格數全綠證的是「寫下的守門有判別力」,證不了「該有的守門都想到了」。**
set -u
export LC_ALL=C LANG=C
REPO="$(cd "$(dirname "$0")/.." && pwd)"
D="${W6B2DB:-/tmp/w6b2db}"; SOCK="${W6B2SOCK:-/tmp/w6b2sk}"; P="${W6B2PORT:-54422}"
PASS=0; FAIL=0; KEYS=""
EXPECT_TOTAL=11   # 🔴 量出來的。全綠時 PASS = 11 + CELL-ACCOUNT + CELL-KEYSET = 13。
                  #    🔴 12 → 11 是**刻意減一格**:跨模型審查判 `W6B2-C6P-NEVER` 恆真,已移出格帳(見 §1 註)。
ok()  { PASS=$((PASS+1)); KEYS="$KEYS $1"; printf '  PASS %-32s %s\n' "$1" "$2"; }
bad() { FAIL=$((FAIL+1)); KEYS="$KEYS $1"; printf '  FAIL %-32s %s\n' "$1" "$2"; }

# ══ 🔴 W7 跟片(2026-08-08):路徑閘 + trap teardown + fail-closed 殘留檢查 ══
#   參考實作 = scripts/w7d1-verify.sh(關卡2 兩輪審過);四件一起做,少任何一件都留破口。
#   🔴 **為什麼一定要 trap**(實測,不是推論):本檔 `set -u`,而**頂層**的 unbound variable
#      會讓 shell 當場中止 —— `die()` 不會跑、檔尾也到不了 ⇒ **留一支活叢集**。
#      B-301 的前置證據:在 w3c1 的 provision 之後注入一個頂層 unbound,
#      實測留下 `postgres -D /tmp/w3vdb -p 54401`(PID 69587)。Ctrl-C 同理。
#   🔴 trap 裝在 `pg_ctl start` **之前**:`-w start` 可能「postmaster 已起、只是等待逾時」
#      就走 START_FAIL 分支 ⇒ 那條路原本也漏。
#   🔴 `stop` 失敗時**不刪 datadir**,否則會變成「postmaster 還活著、資料目錄卻沒了」。
#   🔴 殘留用 `postmaster.pid` + `pgrep` 綁本 datadir,**不用 TCP 埠** ——
#      本檔的 server 是 `listen_addresses=`(只開 unix socket)⇒ TCP 恆為 0、零判別力。
# 🔴 `/private/tmp` 也要收:macOS 的 `/tmp` 是 `/private/tmp` 的 symlink,
#    而本線有 harness 的預設 datadir 就落在 scratchpad 的 `/private/tmp/...`(w0b:32)
#    ⇒ 只認字面 `/tmp/` 會把合法路徑擋掉。**這道閘是本次掃掠自己踩到的**,已修。
case "$D"    in /tmp/?*|/private/tmp/?*) : ;; *) echo "REFUSE: datadir 必須在 /tmp 或 /private/tmp 底下(現為 [$D])"; exit 1 ;; esac
case "$SOCK" in /tmp/?*|/private/tmp/?*) : ;; *) echo "REFUSE: socket 目錄必須在 /tmp 或 /private/tmp 底下(現為 [$SOCK])"; exit 1 ;; esac
case "$D"    in *..*) echo "REFUSE: datadir 不得含 .. (現為 [$D])"; exit 1 ;; esac
case "$SOCK" in *..*) echo "REFUSE: socket 目錄不得含 .. (現為 [$SOCK])"; exit 1 ;; esac
case "$D$SOCK" in *[!A-Za-z0-9/._-]*) echo "REFUSE: 路徑只允許 A-Za-z0-9/._- (pgrep -f 會把其餘字元當 regex ⇒ 殘留那道靜默失效)"; exit 1 ;; esac
# 🔴🔴 W7 跟片⑦(2026-08-09,R2 抓的):上面的 `/tmp/?*` **擋不住 `/tmp//`** ——
#    glob 的 `?` 吃得下 `/`,四道閘全過(前綴符合、無 `..`、字元集全合法),
#    而 `rm -rf "/tmp//"` 實測**會把整個 /tmp 刪掉**(含別窗還活著的 PG datadir),
#    且 `$D/postmaster.pid` = `/tmp//postmaster.pid` 不存在 ⇒ 併發護欄也不會響 = 靜默。
#    ⇒ 兩道一起補:①第一個字元必須是英數(順帶擋掉 `/tmp/.`、`/tmp/-x`)②路徑中不得有 `//`。
case "$D" in /tmp/[A-Za-z0-9]*|/private/tmp/[A-Za-z0-9]*) : ;; *) echo "REFUSE: 路徑第一段必須以英數開頭(現為 [$D])"; exit 1 ;; esac
case "$D" in *//*) echo "REFUSE: 路徑不得含連續斜線(現為 [$D])—— `/tmp//` 過得了前綴閘但 rm -rf 會刪掉整個 /tmp"; exit 1 ;; esac
case "$SOCK" in /tmp/[A-Za-z0-9]*|/private/tmp/[A-Za-z0-9]*) : ;; *) echo "REFUSE: 路徑第一段必須以英數開頭(現為 [$SOCK])"; exit 1 ;; esac
case "$SOCK" in *//*) echo "REFUSE: 路徑不得含連續斜線(現為 [$SOCK])—— `/tmp//` 過得了前綴閘但 rm -rf 會刪掉整個 /tmp"; exit 1 ;; esac
# 🔴 W7 跟片⑤(2026-08-09,codex #4 MF-4 的另一半):路徑閘只保證「刪的東西在 /tmp 底下」,
#    **擋不住「那個 /tmp 路徑正被別人的 live cluster 用著」** —— 本檔開場無條件 `rm -rf`,
#    兩個視窗用預設路徑並行跑就會互刪。夜跑多視窗是常態,這不是理論風險。
#    ⇒ 刪之前先問:那裡有沒有活著的 postmaster?有就 REFUSE,不猜、不等、不強刪。
# 🔴🔴 **本段必須排在 `trap teardown EXIT` 之前**:teardown 會 `pg_ctl -D "$D" stop`,
#    若這道 REFUSE 排在 trap 之後,`exit 1` 會觸發 teardown 去停掉**別人的** cluster
#    —— 那正是本段要防的事。(第一版我就寫在 trap 之後,自己抓到。)
# 🔴 R1 F2:`pgrep` 不存在/被 PATH 遮蔽時回非 0 ⇒ 連言 false ⇒ **靜默放行 rm -rf** = fail-open。
#    這道護欄的整個價值就在「不確定時不要刪」,所以工具缺席要當成不確定,不當成沒事。
command -v pgrep >/dev/null 2>&1 || { echo "REFUSE: 找不到 pgrep ⇒ 無法判斷 $D 是否正被別人使用,拒絕 rm -rf"; exit 1; }
# 🔴 R1 F3(誠實邊界,別把註解讀成全稱):本護欄只擋**穩態**。別的視窗正卡在 initdb / pg_ctl start
#    到 postmaster.pid 落地之間那個短窗口時,$D 有目錄但沒有 pid 檔 ⇒ 這裡仍會刪掉它。
#    要關那個窗口得改成 ownership marker 制(如 a1-verify / b2s2b 的作法),本片不做。
if [ -f "$D/postmaster.pid" ] && pgrep -f "postgres.*$D" >/dev/null 2>&1; then
  echo "REFUSE: $D 底下有活著的 postmaster(別的視窗正在用?)⇒ 拒絕 rm -rf,也不去停它。"
  echo "        處置:等它跑完,或改用別的 datadir —— 設定點在本檔頂端的 D= / SOCK= / P=(多數 harness 寫在同一行,w0b-verify.sh 是分三行)"
  echo "        (多數 harness 寫成 \${XXXDB:-預設},可用 env 覆寫;少數(如 w0b-verify.sh)是**寫死的**,要改檔)。"
  exit 1
fi
teardown() {
  TD_RC=$?   # 🔴 W7 跟片③:第一句就接住本來要離場的碼(EXIT trap 進來時的 $?)
  pg_ctl -D "$D" -w stop >/dev/null 2>&1
  LEFTOVER="$(pgrep -f "postgres.*$D" 2>/dev/null | wc -l | tr -d ' ')"
  if [ -f "$D/postmaster.pid" ] || [ "$LEFTOVER" != "0" ]; then
    echo "🔴 TEARDOWN_WARN:postmaster 沒停乾淨(殘留程序 $LEFTOVER 支)⇒ **保留 datadir 與 socket 目錄供診斷**:$D / $SOCK"
    # 🔴 W7 跟片③(2026-08-09,B-226 MF-3):原本這裡只 `return` —— 畫面上有紅字、**exit 仍是 0**
    #    ⇒ 跑過帳、CI、人眼掃 exit 全部看不到殘留。W5 那片修的是**主體**的 exit 守門,
    #    teardown 這條出口整條漏,含本支共 19 支同一個缺陷。⚠️ 在 EXIT trap 裡 `exit` 會覆寫
    #    離場碼且**不會遞迴觸發 trap**(bash 3.2.57 實測)。🔴 **限正常離場路徑** —— R1 F1 實測:
    #    由信號(INT/TERM/HUP/PIPE)觸發時 bash 會 re-raise,最終碼是 130/143/129/141,
    #    這個 `exit 9` 會被蓋掉(仍非 0,不是假綠,但別把這句讀成全稱)。本來就非 0 時保留原碼 —— 殘留不該把
    #    FAIL=1 洗成 9,那會弄丟「哪一格紅了」這個資訊。
    if [ "$TD_RC" -eq 0 ]; then exit 9; else exit "$TD_RC"; fi
  fi
  rm -rf "$D" "$SOCK"
  # 🔴 rm 之後**實測 -e**、不要只印「已收」——「宣稱」不是「檢查」(本 repo 記過的恆真格家族)。
  if [ -e "$D" ] || [ -e "$SOCK" ]; then
    echo "🔴 TEARDOWN_WARN:rm 之後仍看得到 資料目錄=$([ -e "$D" ] && echo 殘留 || echo 0) / socket 目錄=$([ -e "$SOCK" ] && echo 殘留 || echo 0)"
    # 🔴 W7 跟片③(2026-08-09,B-226 MF-3):原本這裡只 `return` —— 畫面上有紅字、**exit 仍是 0**
    #    ⇒ 跑過帳、CI、人眼掃 exit 全部看不到殘留。W5 那片修的是**主體**的 exit 守門,
    #    teardown 這條出口整條漏,含本支共 19 支同一個缺陷。⚠️ 在 EXIT trap 裡 `exit` 會覆寫
    #    離場碼且**不會遞迴觸發 trap**(bash 3.2.57 實測)。🔴 **限正常離場路徑** —— R1 F1 實測:
    #    由信號(INT/TERM/HUP/PIPE)觸發時 bash 會 re-raise,最終碼是 130/143/129/141,
    #    這個 `exit 9` 會被蓋掉(仍非 0,不是假綠,但別把這句讀成全稱)。本來就非 0 時保留原碼 —— 殘留不該把
    #    FAIL=1 洗成 9,那會弄丟「哪一格紅了」這個資訊。
    if [ "$TD_RC" -eq 0 ]; then exit 9; else exit "$TD_RC"; fi
  fi
  echo "  teardown:postmaster 已停、殘留程序 0、datadir 與 socket 目錄已收(-e 實測)"
}
trap teardown EXIT

rm -rf "$D" "$SOCK"; mkdir -p "$SOCK"
initdb -D "$D" -U postgres --no-sync -A trust -E UTF8 --locale=C >/dev/null 2>"$SOCK/initdb.err" \
  || { echo INITDB_FAIL; cat "$SOCK/initdb.err" 2>/dev/null; exit 1; }   # 🔴 R2 nit:原本 stderr 直接丟 /dev/null ⇒ 失敗只拿到六個字。隔壁 START_FAIL 有 cat log,這裡對齊。
pg_ctl -D "$D" -o "-p $P -k $SOCK -c listen_addresses=" -l "$D/log" -w start >/dev/null 2>&1 \
  || { echo START_FAIL; cat "$D/log" 2>/dev/null; exit 1; }
die() { echo "$1"; exit 1; }   # 🔴 收尾一律交給 EXIT 的 trap teardown(單一離場路徑)
Q()  { psql -X -h "$SOCK" -p $P -U postgres -d postgres -qtA -c "$1" 2>&1 | tr -d '\n'; }
QM() { psql -X -v VERBOSITY=verbose -h "$SOCK" -p $P -U postgres -d postgres -qtA -c "$1" 2>&1 | tr '\n' ' '; }
QF() { psql -X -v VERBOSITY=verbose -h "$SOCK" -p $P -U postgres -d postgres -qtA -v ON_ERROR_STOP=1 -f "$1" 2>&1 | tr '\n' ' '; }

# 🔴 **第五個釘值檔**(b2s2b / w5 / w6a / w6b1 / 本檔)—— 新片落檔要**同批重釘五個**。
#    機制承接仍在 backlog;在那之前這行是人工紀律,而人工紀律已經漏過一次(W4-1 漏了 w6a)。
# 🔴 重釘(2026-08-09 W7d-3 落檔 `20260809030000`):該片是 **assert-only** ——
#    逐條核過 `CREATE|ALTER|DROP|GRANT|REVOKE|INSERT|UPDATE|DELETE` **全部零命中**,
#    只有一個 DO block 與一個 `COMMENT ON FUNCTION`。⇒ **結構 oracle 無需增列**
#    (閘要求的第二步在本片是 no-op,但這是查出來的、不是跳過的)。
#    `COMMENT` 不進 `pg_get_functiondef` ⇒ 任何函式體 md5 釘值也不受影響。
# RE-PIN 2026-08-09 pm: lifecycle L2 20260809140000 = payment retry RPC CREATE OR REPLACE
#    (mark_attempt_settle_retry / mark_webhook_retry, allowlist + 'record_not_found' only).
#    Non-shipping functions; grep recompute|order_item_qty|oiqs = 0 hits => shipping oracles
#    unchanged, no md5 re-measure needed. Main-window re-pin + full re-record.
# RE-PIN 2026-08-09 evening: lifecycle L3 20260809160000/170000 = new fn pcm_cron.expire_unpaid_orders
#    (writes orders.cancelled_at only) + pg_cron schedule. No shipping tables/functions touched;
#    grep recompute|order_item_qty|oiqs|shipment = comment-only hit => shipping oracles unchanged.
#    Main-window re-pin + full re-record.
LINE_TIP="20260811070000"  # 2026-08-11 重釘 20260811030000->20260811060000(L5b-2 片 2a=P 窗;claim RPC DROP+重建、回傳三欄->四欄。**述詞一字未動**〔md5(split_part(prosrc,'RETURNING',1)) 兩版皆 f15644b5…〕⇒ 對本檔被測面無交集;唯一連動是 l5b0-verify 的 claim 身分閘,已同批重釘)
NEWEST_TS="$(ls "$REPO"/supabase/migrations/*.sql | sed 's|.*/||; s|_.*||' | sort | tail -1)"
[ "$NEWEST_TS" = "$LINE_TIP" ] || die "migration 尾端是 $NEWEST_TS,不是釘住的 $LINE_TIP —— 本檔跑在線的尖端,重釘後再跑。"

cd "$REPO" || die "CD_FAIL"
psql -X -h "$SOCK" -p $P -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f scripts/d1-supabase-shim.sql >/dev/null || die "SHIM_FAIL"
FIRST_FITMENTS="$(grep -l 'product_fitments_effective' supabase/migrations/*.sql | sort | head -1)"
for f in supabase/migrations/*.sql; do
  case "$f" in *20260723120000*|*20260809170000*) continue ;; esac  # skip pg_cron-dependent: settle sweeper + L3b schedule (bare PG has no pg_cron; L3a fn still replayed)
  if [ "$f" = "$FIRST_FITMENTS" ]; then
    psql -X -h "$SOCK" -p $P -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f scripts/d1-fitments-bootstrap.sql >/dev/null || die "FITBOOT_FAIL"
  fi
  psql -X -h "$SOCK" -p $P -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null 2>"$D/err" || die "MIG_FAIL: $f :: $(cat "$D/err")"
done
# 🔴 三支都要在:取消 writer 必須是 **A8a2 六參版**(五參版沒有 p_items ⇒ 根本沒有部分取消這條軸)。
[ "$(Q "SELECT (pg_catalog.to_regprocedure('public.admin_cancel_order(uuid,uuid,text,text,text,jsonb)') IS NOT NULL
             AND pg_catalog.to_regprocedure('public.admin_unvoid_shipment(text,uuid)') IS NOT NULL
             AND pg_catalog.to_regprocedure('public.pcm_b2_shipping_human_error(text,text)') IS NOT NULL)::text")" = "true" ] \
  || die "UPSTREAM_MISSING: A8a2 取消(六參)/ W3c-2 復原 / W3-3 轉譯層 有缺"
[ "$(Q "SELECT pg_catalog.count(*)::text FROM pg_catalog.pg_constraint
         WHERE conname IN ('oiqs_cancelled_shipped_le_quantity','oiqs_instock_cancelled_le_quantity','oiqs_shipped_le_instock')
           AND convalidated")" = "3" ] || die "UPSTREAM_MISSING: C6′/C7/C9 三條 CHECK 沒有全部就位且 validated"
ok W6B2-REPLAY "全 migration 重放(尖端 $LINE_TIP)⇒ 取消(六參)/復原/轉譯層三支都在、C6′+C7+C9 三條 CHECK 都 validated,探針跑在真路徑上 ✓"

# ── 共用 fixture ────────────────────────────────────────────
CUST='11111111-1111-1111-1111-111111111111'
SNAP='{"name":"王大明","phone":"0900000000","line":"L1"}'
PSNAP='{"title":"零件","sku":"S1","spec":{"color":"black"}}'
Q "INSERT INTO auth.users(id,email) VALUES('$CUST','w6b2@test.local')" >/dev/null
Q "INSERT INTO public.customers(user_id,email) VALUES('$CUST','w6b2@test.local')" >/dev/null
Q "INSERT INTO public.staff(id,label) VALUES('sean','Sean')" >/dev/null
[ "$(Q "SELECT pg_catalog.count(*)::text FROM public.staff WHERE id='sean' AND is_active")" = "1" ] || die "FIXTURE_FAIL(staff)"
SUPP="$(Q "INSERT INTO public.suppliers(label) VALUES('W6b-2 供應商') RETURNING id")"
case "$SUPP" in ????????-*) : ;; *) die "FIXTURE_FAIL(suppliers): $SUPP" ;; esac

# 🔴 `mkround` 每輪建**自己的訂單**(不是共用一張)—— 取消是**訂單級** RPC,
#    冪等格/帳本健康閘/關單等價都在訂單這一層對帳,共用一張訂單會讓輪與輪互相污染。
# 🔴 錯誤不用 `die`:`mkround` 在 `$( )` 裡被呼叫,`die` 的 exit 只結束子 shell 卻已經關掉 server
#    ⇒ 之後每一格都在對死連線發問、回空字串被讀成「沒有例外」。(w6a 實錘過的坑。)
# 🔴 `quantity` 一律 3;`$2`=到貨件數(instock)、`$3`=箱 V 的件數(0=不建箱)。
#    這兩個值是**掃描的自變數**,不是隨便挑的常數 —— 危險面可不可達正是它們決定的。
mkround() { # $1=代號 $2=instock $3=箱量 → 印 "ORD|OI|BOXV"
  local n="$1" recv="$2" bq="$3" ord oi pid v rc
  ord="$(Q "SELECT pg_catalog.gen_random_uuid()")"
  Q "INSERT INTO public.orders(id,display_id,customer_user_id,shipping_address_snapshot,tier_at_checkout,subtotal,shipping_fee,total,shipping_method,invoice,shipping_method_at_checkout) VALUES('$ord',public.pcm_generate_display_id(),'$CUST','$SNAP'::jsonb,(SELECT enumlabel::text::public.member_tier FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='member_tier' LIMIT 1),100,0,100,'home','{\"type\":\"personal\"}'::jsonb,'home')" >/dev/null
  oi="$(Q "SELECT pg_catalog.gen_random_uuid()")"
  Q "INSERT INTO public.order_items(id,order_id,variant_sku,product_snapshot,quantity,unit_price,line_total) VALUES('$oi','$ord','SKU-$n','$PSNAP'::jsonb,3,10,30)" >/dev/null
  pid="$(Q "INSERT INTO public.order_item_procurement(order_item_id,allocated_quantity,supplier_id) VALUES('$oi',3,'$SUPP') RETURNING id")"
  case "$pid" in ????????-*) : ;; *) printf 'FIXTURE_FAIL(procurement %s): %s\n' "$n" "$pid" >>"$D/mk.err"; return ;; esac
  if [ "$recv" -gt 0 ]; then
    Q "INSERT INTO public.order_item_procurement_receipts(procurement_id,quantity,received_at,received_by) VALUES('$pid',$recv,now(),'tester')" >/dev/null
    rc="$(Q "SELECT coalesce(pg_catalog.max(instock_quantity)::text,'(無列)') FROM public.order_item_quantity_summary WHERE order_item_id='$oi'")"
    [ "$rc" = "$recv" ] || { printf 'FIXTURE_FAIL(instock %s): %s\n' "$n" "$rc" >>"$D/mk.err"; return; }
  fi
  v=''
  if [ "$bq" -gt 0 ]; then
    # 箱 V:掛 $bq → 出貨 → 作廢(作廢後 shipped 退回 0、instock 不動)
    v="$(Q "SELECT ('$(Q "SELECT public.admin_create_shipment('$n-v','$CUST','$SNAP'::jsonb,'hct')")'::jsonb ->> 'shipment_id')")"
    case "$v" in ????????-*) : ;; *) printf 'FIXTURE_FAIL(boxV %s): %s\n' "$n" "$v" >>"$D/mk.err"; return ;; esac
    for stmt in "admin_add_shipment_items('$n-vi','$v','[{\"order_item_id\":\"$oi\",\"quantity\":$bq}]'::jsonb)" \
                "admin_mark_shipment_shipped('$n-vs','$v','TRACK-$n')" \
                "admin_void_shipment('$n-vv','$v','W6b-2 fixture')"; do
      rc="$(QM "SELECT public.$stmt")"
      case "$rc" in *ERROR*) printf 'FIXTURE_FAIL(V %s / %s): %s\n' "$n" "${stmt%%(*}" "$rc" >>"$D/mk.err"; return ;; esac
    done
  fi
  printf '%s|%s|%s' "$ord" "$oi" "$v"
}
splitr() { R_ORD="${1%%|*}"; local rest="${1#*|}"; R_OI="${rest%%|*}"; R_V="${rest#*|}"; }
sums()   { Q "SELECT coalesce(cancelled_quantity,0)::text||'+'||coalesce(shipped_quantity,0)::text||'/'||quantity::text FROM public.order_item_quantity_summary WHERE order_item_id='$1'"; }
csum()   { Q "SELECT (coalesce(cancelled_quantity,0)+coalesce(shipped_quantity,0))::text FROM public.order_item_quantity_summary WHERE order_item_id='$1'"; }

CANCEL() { printf "public.admin_cancel_order('%s',pg_catalog.gen_random_uuid(),'sean','customer_request',NULL,'[{\"order_item_id\":\"%s\",\"quantity\":%s}]'::jsonb)" "$1" "$2" "$3"; }

# ── 併發編排(骨架照 w6b1:advisory barrier、零 FIFO、有界輪詢;barrier 號 44)──
race() { # $1=代號 $2=訂單 $3=品項 $4=取消增量 $5=箱V → 印 barrier 是否成立(1/0)
  local n="$1" o="$2" i="$3" dc="$4" v="$5" ctl barrier=0 _ x
  psql -X -h "$SOCK" -p $P -U postgres -d postgres -qtA \
    -c "SELECT pg_catalog.pg_advisory_lock(44); SELECT pg_catalog.pg_sleep(1.2); SELECT pg_catalog.pg_advisory_unlock(44);" >"$D/ctl.$n" 2>&1 &
  ctl=$!
  for _ in $(seq 1 40); do
    [ "$(Q "SELECT pg_catalog.count(*)::text FROM pg_catalog.pg_locks WHERE locktype='advisory' AND granted AND objid=44")" != "0" ] && break
    sleep 0.05
  done
  PGAPPNAME=w6b2_cancel psql -X -v VERBOSITY=verbose -h "$SOCK" -p $P -U postgres -d postgres -qtA \
    -c "BEGIN; SELECT pg_catalog.pg_advisory_xact_lock_shared(44); SELECT $(CANCEL "$o" "$i" "$dc"); COMMIT;" >"$D/cancel.$n" 2>&1 &
  PGAPPNAME=w6b2_unvoid psql -X -v VERBOSITY=verbose -h "$SOCK" -p $P -U postgres -d postgres -qtA \
    -c "BEGIN; SELECT pg_catalog.pg_advisory_xact_lock_shared(44); SELECT public.admin_unvoid_shipment('u-$n','$v'); COMMIT;" >"$D/unvoid.$n" 2>&1 &
  for _ in $(seq 1 60); do
    x="$(Q "SELECT pg_catalog.count(*)::text FROM pg_catalog.pg_locks l JOIN pg_catalog.pg_stat_activity a ON a.pid=l.pid WHERE l.locktype='advisory' AND NOT l.granted AND a.application_name IN ('w6b2_cancel','w6b2_unvoid')")"
    [ "$x" = "2" ] && { barrier=1; break; }
    sleep 0.05
  done
  wait $ctl 2>/dev/null || true
  wait 2>/dev/null || true
  printf '%s' "$barrier"
}
# 🔴 逐邊判定(**存在量詞是坑**:把兩邊串起來找一個 `idempotent` = 一邊成功就綠,
#    而訊息寫著「兩邊都…」。w6a 被跨模型審查抓過這一條。)
side() { case "$1" in *ERROR*) printf 'ERR' ;; *idempotent*) printf 'OK' ;; *) printf 'BAD' ;; esac; }
# 🔴 **只判 ERR 是不夠的**(跨模型審查 F4,打的正是檔內 :53 自立的判準
#    「我的 SQL 寫壞了不得與被守門擋住共用同一句結論」):`side` 把任何 server error 都算 ERR
#    ⇒ 未來若在可取消量守門**之前**多一道拒絕(或我把 p_items 拼壞),這些格照樣全綠,
#      而 `W6B2-STOP6-FIXTURE-DEAD` 印出的因果句(可取消量 = Q−I−C = 0)就變成錯誤歸因、零格轉紅。
#    ⇒ 取消側的「被拒」一律要求是**業務拒絕**:P0001 + `…a8a2…sql:108` 那句通用訊息。
#      (它擋不掉「同一支函式裡別條業務拒絕」—— 那一層由突變①負責:拿掉 − instock 項後同一個
#       fixture 就過得了前緣,是這條因果的正向消融證據。)
bizrej() { case "$1" in *P0001*) case "$1" in *"admin_cancel_order: 取消失敗"*) printf 'BIZ'; return ;; esac ;; esac; printf 'NO'; }
# 🔴 C6′ 的兩種面貌要分開認,**不能共用一個 `human`**:
#    轉譯過的 = P2B29 + C6′ 專屬引導句;raw 的 = 23514 + conname。混在一起就分不出轉譯層有沒有作用。
# 🔴🔴 W7d-1(2026-08-08)改了這條路上的期望字面,而且是**往好的方向**:
#   原本比對共用轉譯層那句「已取消 + 已出貨…①先作廢這個包裹」——
#   但走到這裡的是**復原側的輸家**,那箱**本來就是作廢態** ⇒ 教它「先作廢」= 方向寫反
#   (B-220-A MF-1 / 教錯動作家族第三例)。W7d-1 讓 admin_unvoid_shipment 在自己 handler 內覆寫。
#   ⇒ 期望字面改認覆寫後那句的指紋「它現在就是作廢狀態」。
# 🔴 **本格因此升級**:原本自認「只證是人話、不證引導正確」(同 W6b-1 F3),
#   現在那句人話明文寫著「不要再去作廢它」⇒ **連方向一起證了**,該筆債在這條路上結清。
# 🔴 消融語意零改:覆寫排在 `IF v_msg IS NULL THEN RAISE;` **之後**
#   ⇒ 把轉譯層換成回 NULL 的 mutant 時照舊落 raw 23514,`c6p_raw` 不受影響。
# 🔴 **證據等級要說準**(關卡2 抓到我把它寫高了):驗這句訊息的 `seq_c6p` 是
#   「取消**先提交**、再呼 unvoid」的**序列**流程,**不是** barrier 併發。
#   ⇒ 它證的是「C6′ 在復原側浮出時,員工看到的是方向正確的人話」,
#     **不證**「真併發下也會這樣」。本檔的併發臂在別的格,不要拿這一格去頂。
c6p_human() { case "$1" in *P2B29*) case "$1" in *"它現在就是作廢狀態"*) printf 'HUMAN'; return ;; esac ;; esac; printf 'NO'; }
c6p_raw()   { case "$1" in *oiqs_cancelled_shipped_le_quantity*) case "$1" in *23514*) printf 'RAW'; return ;; esac ;; esac; printf 'NO'; }
conname()   { printf '%s' "$1" | sed -n 's/.*CONSTRAINT NAME:  *\([a-z0-9_]*\).*/\1/p' | head -1; }

echo "══ 0. 🔴 交接信 ⑥ 的 fixture:實跑判生死 ════════════════════"
R="$(mkround s6 3 3)"; case "$R" in *"|"*"|"*) : ;; *) die "FIXTURE_FAIL(s6): $(tail -2 "$D/mk.err" 2>/dev/null)" ;; esac
splitr "$R"; S6_OI="$R_OI"
S6_3="$(QM "SELECT $(CANCEL "$R_ORD" "$R_OI" 3)")"
S6_1="$(QM "SELECT $(CANCEL "$R_ORD" "$R_OI" 1)")"
# 🔴 兩發都要:只測 3 的話「被拒」可以被讀成 off-by-one;**連 1 都被拒**才證可取消量真的是 0。
if [ "$(bizrej "$S6_3")" = "BIZ" ] && [ "$(bizrej "$S6_1")" = "BIZ" ]; then
  ok W6B2-STOP6-FIXTURE-DEAD "🔴 ⑥ 的 fixture(Q3/instock3)**取消 3 與取消 1 都被前緣拒**⇒ 可取消量 = quantity − instock − cancelled = 0(不是 off-by-one)⇒ ⑥ 的「可取消量 = quantity − cancelled」漏了 − instock 項,B3 走不到 C6′ ✓"
else
  bad W6B2-STOP6-FIXTURE-DEAD "⑥ 的 fixture 沒被「業務拒絕」擋掉:取消3=[$(side "$S6_3")/$(bizrej "$S6_3")] 取消1=[$(side "$S6_1")/$(bizrej "$S6_1")] ⇒ 不是過得了就是紅在別的地方,本檔的整個前提要重估"
fi
[ "$(sums "$S6_OI")" = "0+0/3" ] || die "S6_STATE: 被拒之後摘要不是 0+0/3,是 [$(sums "$S6_OI")]"

echo "══ 1. 🔴🔴 B3 併發:部分取消 × unvoid,同一個品項 ════════════"
# 可達 fixture:instock=1、箱 V 掛 1(出貨後作廢 ⇒ shipped 退 0)、取消增量 2。
#   取消前緣:2 ≤ 3 − 1 − 0 = 2 ✓(**坐在邊界上**)  復原前緣:0 + 1 ≤ 1 ✓(**也坐在邊界上**)
#   兩邊都過 ⇒ 終值 cancelled 2 + shipped 1 = 3 = quantity ⇒ **C6′ 的邊界值**,差一就紅。
# 🔴 兩條前緣都刻意坐邊界:fixture 值讓被測面「離危險很遠」是本線踩過的老坑。
# 🔴 **這裡刻意「少一格」**(跨模型審查 F2,must-fix):第一版有一格 `W6B2-C6P-NEVER`
#    去查「有沒有列 cancelled + shipped > quantity」——那是**恆真格**:C6′ 是 validated CHECK
#    (REPLAY 那一格已斷言它 validated),已提交的列**依構造不可能**違反它,該格物理上永不 FAIL。
#    它與檔頭 :52「隔離守門自己要有靶」自相矛盾 ⇒ **移出格帳**、只留敘述。
#    真正的觀察在 `W6B2-BOUNDARY-TIGHT`:它比的是**逐字終值** 2+1/3,C6′ 若真的失守會直接對不上。
ROUNDS=4
BARRIER_BAD=""; NOT_BOTH=""; NOT_TIGHT=""
for i in $(seq 1 $ROUNDS); do
  R="$(mkround r$i 1 1)"; case "$R" in *"|"*"|"*) : ;; *) die "FIXTURE_FAIL(r$i): $(tail -2 "$D/mk.err" 2>/dev/null)" ;; esac
  splitr "$R"
  B="$(race "r$i" "$R_ORD" "$R_OI" 2 "$R_V")"
  [ "$B" = "1" ] || BARRIER_BAD="$BARRIER_BAD r$i"
  OC="$(tr '\n' ' ' <"$D/cancel.r$i")"; OU="$(tr '\n' ' ' <"$D/unvoid.r$i")"
  SC="$(side "$OC")"; SU="$(side "$OU")"
  [ "$SC:$SU" = "OK:OK" ] || NOT_BOTH="$NOT_BOTH r$i(cancel=$SC/unvoid=$SU)"
  ST="$(sums "$R_OI")"
  [ "$ST" = "2+1/3" ] || NOT_TIGHT="$NOT_TIGHT r$i($ST)"
done
[ -z "$BARRIER_BAD" ] && ok W6B2-BARRIER "$ROUNDS 輪**每一輪**兩個 session 都真的卡在 barrier 上才被放行 ⇒ **同時起跑**成立(🔴 本格只證這件事)✓" \
                      || bad W6B2-BARRIER "barrier 沒成立的輪次:$BARRIER_BAD ⇒ 那些輪的觀察不是併發證據"
# 🔴 這一格的期望值與 W6b-1 **相反**,不是筆誤:B2 打的是共用軸(instock)⇒ 恰一個成功;
#    B3 兩邊寫的是不同軸(cancelled / shipped)且互不讀 ⇒ **兩邊都該成功**。
#    若哪天這格轉 FAIL(某一邊被擋),代表有人把兩軸接到同一個守門上 —— 那才是要看的訊號。
[ -z "$NOT_BOTH" ] \
  && ok W6B2-BOTH-SUCCEED "🔴 每一輪**兩邊都成功**(取消寫 cancelled、復原寫 shipped、互不讀對方的軸)⇒ B3 這一對在併發下沒有互斥面 ✓" \
  || bad W6B2-BOTH-SUCCEED "有輪次不是兩邊都成功:$NOT_BOTH"
[ -z "$NOT_TIGHT" ] \
  && ok W6B2-BOUNDARY-TIGHT "🔴 每一輪終值**逐字** = cancelled 2 + shipped 1 = 3 = quantity ⇒ **恰好坐在 C6′ 的邊界上**(差一就紅)⇒ 「摸不到 C6′」不是因為離危險很遠 ✓" \
  || bad W6B2-BOUNDARY-TIGHT "有輪次沒坐到邊界(期望 2+1/3):$NOT_TIGHT"

echo "══ 2. 🔴 可達參數空間的有界掃描(先寫預測、再比對實測)══════"
# 🔴 「構造不出來」不准用寫的 —— 本節把兩條前緣的預算寫成**可證偽的預測**,逐格比對:
#      預測A:取消成功 ⟺ ΔC ≤ 3 − instock       (…a8a2…sql:395-405)
#      預測B:復原成功 ⟺ 箱量 ≤ instock          (…w3c2…sql:121-144)
#      預測C:兩邊都成功時**摘要實測** cancelled + shipped = ΔC + 箱量(而且 ≤ 3)
#    任何一格對不上,本格 FAIL 並印出是哪一格 —— 那就是 B3 真的有危險面的證據。
# 🔴 兩條**宣稱範圍**的自我節制(跨模型審查 F6/F8):
#   · 預測 B 的 ⟸ 方向(箱量 > instock ⇒ 復原被拒)在本掃描裡是**零樣本** —— `S` 只跑到 `I`,
#     因為箱量 > instock 的箱**建不起來**(出貨那一步先撞 C9)⇒ 那個方向由 `W6B2-SHRINK-DIM`
#     用「到貨事後縮小」構造,不在本格帳上。本格的訊息只宣稱跑過的方向。
#   · 「ΔC + 箱量 ≤ 3」在兩條預測都通過之後是**代數上被蘊含**的,寫成獨立觀察是自我恭維
#     ⇒ 已拿掉,只留 `csum` 那條**真的去查摘要表**的對帳。
SWEEP_BAD=""; SWEEP_N=0; SWEEP_BOTH=0; SWEEP_TIGHT=0
for I in 1 2 3; do
  for S in $(seq 1 $I); do
    for DC in 1 2 3; do
      SWEEP_N=$((SWEEP_N+1))
      R="$(mkround "w${I}${S}${DC}" "$I" "$S")"
      case "$R" in *"|"*"|"*) : ;; *) die "FIXTURE_FAIL(w${I}${S}${DC}): $(tail -2 "$D/mk.err" 2>/dev/null)" ;; esac
      splitr "$R"
      race "w${I}${S}${DC}" "$R_ORD" "$R_OI" "$DC" "$R_V" >/dev/null
      OCW="$(tr '\n' ' ' <"$D/cancel.w${I}${S}${DC}")"
      SC="$(side "$OCW")"
      SU="$(side "$(tr '\n' ' ' <"$D/unvoid.w${I}${S}${DC}")")"
      [ "$DC" -le $((3 - I)) ] && PC=OK || PC=ERR
      [ "$S"  -le "$I" ]       && PU=OK || PU=ERR
      [ "$SC" = "$PC" ] && [ "$SU" = "$PU" ] || SWEEP_BAD="$SWEEP_BAD I$I/s$S/dc$DC(預測 $PC/$PU 實測 $SC/$SU)"
      # 🔴 預測 ERR 的格要驗**是被業務守門拒的**,不是「紅在別的地方也算對」(F4 同族)。
      [ "$PC" = "ERR" ] && [ "$(bizrej "$OCW")" != "BIZ" ] \
        && SWEEP_BAD="$SWEEP_BAD I$I/s$S/dc$DC(取消側被拒但不是業務拒絕)"
      if [ "$SC:$SU" = "OK:OK" ]; then
        SWEEP_BOTH=$((SWEEP_BOTH+1))
        [ "$((DC + S))" -eq 3 ] && SWEEP_TIGHT=$((SWEEP_TIGHT+1))
        [ "$(csum "$R_OI")" = "$((DC + S))" ] || SWEEP_BAD="$SWEEP_BAD I$I/s$S/dc$DC(摘要 $(sums "$R_OI") 對不上 ΔC+箱量)"
      fi
    done
  done
done
printf '  ——  掃描 %s 格,兩邊都成功 %s 格,其中坐到 C6′ 邊界(和=3)%s 格\n' "$SWEEP_N" "$SWEEP_BOTH" "$SWEEP_TIGHT"
if [ -z "$SWEEP_BAD" ] && [ "$SWEEP_TIGHT" -gt 0 ]; then
  ok W6B2-BUDGET-COMPLEMENTARY "🔴 $SWEEP_N 格**逐格符合可證偽預測**(取消成功 ⟺ ΔC≤3−instock、且被拒時是業務拒絕;復原在本掃描恆成功=箱量≤instock 的那一側),兩邊都成功的 $SWEEP_BOTH 格**摘要實測**恰等於 ΔC+箱量、其中 $SWEEP_TIGHT 格坐到 C6′ 邊界 ⇒ 兩條前緣的預算**互補**,C6′ 在本空間內不可達 ✓"
else
  bad W6B2-BUDGET-COMPLEMENTARY "掃描對不上(坐到邊界 $SWEEP_TIGHT 格):$SWEEP_BAD"
fi

echo "══ 2b. 🔴 維度補洞:instock 事後縮小 ═════════════════════════"
# 🔴 上面的掃描 instock 是**固定**的。宣告「構造不出」之前要窮舉維度 ——
#    這一格補的是 `…w3c2…sql:10` 檔頭那條 M4 情境的軸:作廢退量 → 採購下修 instock → 復原。
#    Q3 / instock3 / 箱3 出貨後作廢,再把到貨砍到 1 ⇒ 取消預算變 2、復原預算變 1(箱是 3)。
R="$(mkround sh 3 3)"; case "$R" in *"|"*"|"*) : ;; *) die "FIXTURE_FAIL(sh): $(tail -2 "$D/mk.err" 2>/dev/null)" ;; esac
splitr "$R"; SH_OI="$R_OI"
Q "DELETE FROM public.order_item_procurement_receipts r USING public.order_item_procurement p WHERE p.id=r.procurement_id AND p.order_item_id='$SH_OI'" >/dev/null
Q "INSERT INTO public.order_item_procurement_receipts(procurement_id,quantity,received_at,received_by) SELECT p.id,1,now(),'tester' FROM public.order_item_procurement p WHERE p.order_item_id='$SH_OI'" >/dev/null
SH_IN="$(Q "SELECT instock_quantity::text FROM public.order_item_quantity_summary WHERE order_item_id='$SH_OI'")"
[ "$SH_IN" = "1" ] || die "SHRINK_FAIL: 到貨沒縮到 1,是 [$SH_IN]"
race sh "$R_ORD" "$SH_OI" 2 "$R_V" >/dev/null
SH_C="$(side "$(tr '\n' ' ' <"$D/cancel.sh")")"; SH_U="$(tr '\n' ' ' <"$D/unvoid.sh")"
if [ "$SH_C" = "OK" ] && [ "$(side "$SH_U")" = "ERR" ] && case "$SH_U" in *P2B27*) true ;; *) false ;; esac && [ "$(csum "$SH_OI")" = "2" ]; then
  ok W6B2-SHRINK-DIM "🔴 到貨事後由 3 縮到 1(M4 情境軸):取消 2 過、復原 3 被**前緣 P2B27** 擋下 ⇒ 終值 2+0 ≤ 3,縮小維度也摸不到 C6′ ✓"
else
  bad W6B2-SHRINK-DIM "縮小維度沒照預測:cancel=[$SH_C] unvoid=[$(side "$SH_U")/$(conname "$SH_U")] 和=[$(csum "$SH_OI")]"
fi

echo "══ 3. 🔴 突變靶:把守門一層一層拿掉,看 C6′ 什麼時候才紅 ══════"
# 🔴 保存原定義(還原用)。兩支都存:取消 writer + 轉譯層。
Q "CREATE TABLE public.w6b2_defs(k text PRIMARY KEY, d text NOT NULL)" >/dev/null
Q "INSERT INTO public.w6b2_defs SELECT 'cancel', pg_catalog.pg_get_functiondef('public.admin_cancel_order(uuid,uuid,text,text,text,jsonb)'::regprocedure)" >/dev/null
Q "INSERT INTO public.w6b2_defs SELECT 'human', pg_catalog.pg_get_functiondef('public.pcm_b2_shipping_human_error(text,text)'::regprocedure)" >/dev/null
MD5_CANCEL="$(Q "SELECT pg_catalog.md5(d) FROM public.w6b2_defs WHERE k='cancel'")"
MD5_HUMAN="$(Q "SELECT pg_catalog.md5(d) FROM public.w6b2_defs WHERE k='human'")"

# ── 突變①:拿掉可取消量守門的 `− instock` 項(= ⑥ 以為的那個守門)────
# 🔴 突變靶必須**唯一命中**,否則改到的不是我以為的那一處 ⇒ 命中數 <> 1 直接 die,不 fail-open。
cat >"$D/mut1.sql" <<'MUT1'
DO $mut$
DECLARE d text; pat text; n int;
BEGIN
  SELECT w.d INTO d FROM public.w6b2_defs w WHERE w.k = 'cancel';
  pat := 'oi\.quantity::bigint\s*\n\s*- coalesce\(\(SELECT sum\(r\.quantity\)::bigint FROM public\.order_item_procurement p\s*\n\s*JOIN public\.order_item_procurement_receipts r ON r\.procurement_id = p\.id\s*\n\s*WHERE p\.order_item_id = oi\.id AND r\.quantity > 0\), 0\)';
  SELECT count(*) INTO n FROM regexp_matches(d, pat, 'g');
  IF n <> 1 THEN RAISE EXCEPTION 'W6B2 突變①靶不唯一:命中 % 次(期望 1)', n; END IF;
  EXECUTE regexp_replace(d, pat, 'oi.quantity::bigint - 0');
END
$mut$;
MUT1
MO="$(QF "$D/mut1.sql")"; case "$MO" in *ERROR*) die "MUT1_APPLY_FAIL: $MO" ;; esac
[ "$(Q "SELECT pg_catalog.md5(pg_catalog.pg_get_functiondef('public.admin_cancel_order(uuid,uuid,text,text,text,jsonb)'::regprocedure))")" != "$MD5_CANCEL" ] \
  || die "MUT1_APPLY_FAIL: 定義沒有真的改變"
# 🔴 **本靶刻意用序列、不併發,而且不需要有界重試** —— 理由要寫下來,否則下一個人會以為是偷懶:
#    箱 V 維持作廢(shipped 0)、只跑取消 ⇒ 事後狀態 instock 3 / cancelled 3 / shipped 0,
#    此時 C6′(3+0≤3)與 C9(0≤3)**都成立**,**唯一**可能違反的是 C7 ⇒ 歸屬零歧義、零抖動。
#    🔴 首跑實錘:第一版把這一靶跑成併發,撞到的 conname 是 **C6′** 而不是 C7 ——
#       因為復原那一邊可能先提交(shipped 3),於是 C7 與 C6′ **同時**被違反、PG 報哪一條是它的實作序。
#       那個版本量到的是「哪條 CHECK 先被檢查」,不是「− instock 項擋的是什麼」。
R="$(mkround m1 3 3)"; case "$R" in *"|"*"|"*) : ;; *) die "FIXTURE_FAIL(m1): $(tail -2 "$D/mk.err" 2>/dev/null)" ;; esac
splitr "$R"
M1OUT="$(QM "SELECT $(CANCEL "$R_ORD" "$R_OI" 3)")"; M1CN="$(conname "$M1OUT")"
if [ "$(side "$M1OUT")" = "ERR" ] && [ "$M1CN" = "oiqs_instock_cancelled_le_quantity" ]; then
  ok TMUT-W6B2-CANCEL-INSTOCK-TERM "🔴 拿掉可取消量守門的 − instock 項 ⇒ ⑥ 的 fixture 過得了前緣,但取消側**撞 C7($M1CN)**(此局面下 C6′ 與 C9 都成立=唯一可能違反者)= 該項與 C7 是同一條不變式的前後兩層,**C6′ 這時仍摸不到** ✓"
else
  bad TMUT-W6B2-CANCEL-INSTOCK-TERM "沒撞到 C7:side=[$(side "$M1OUT")] conname=[$M1CN] 摘要=[$(sums "$R_OI")]"
fi

# ── 突變②:在①之上再把 C7 拿掉 ⇒ C6′ 這才單獨紅 ────────────────
Q "ALTER TABLE public.order_item_quantity_summary DROP CONSTRAINT oiqs_instock_cancelled_le_quantity" >/dev/null
[ "$(Q "SELECT pg_catalog.count(*)::text FROM pg_catalog.pg_constraint WHERE conname='oiqs_instock_cancelled_le_quantity'")" = "0" ] || die "MUT2_APPLY_FAIL: C7 沒拿掉"
M2HIT=""; M2WHO=""; M2CN=""
for t in 1 2 3; do
  R="$(mkround "m2$t" 3 3)"; case "$R" in *"|"*"|"*) : ;; *) die "FIXTURE_FAIL(m2$t): $(tail -2 "$D/mk.err" 2>/dev/null)" ;; esac
  splitr "$R"
  race "m2$t" "$R_ORD" "$R_OI" 3 "$R_V" >/dev/null
  OC="$(tr '\n' ' ' <"$D/cancel.m2$t")"; OU="$(tr '\n' ' ' <"$D/unvoid.m2$t")"
  SC="$(side "$OC")"; SU="$(side "$OU")"
  # 🔴 恰一邊失敗,且失敗可歸因到 **C6′ 這一條**(raw conname 或 C6′ 專屬人話 —— 不是「有 23514 就算」)。
  # 🔴 **不加「C9 同時成立」那道**(跨模型審查 F3):C9 全程沒被 DROP ⇒ 違反它的列本來就提交不了,
  #    那道查詢恆真、是裝飾。C9 在本局面成立是**構造出來的**:箱量 3 = instock 3,前緣 0+3≤3 本就過。
  if [ "$SC:$SU" = "OK:ERR" ] || [ "$SC:$SU" = "ERR:OK" ]; then
    LOSER="$OC"; M2WHO=cancel; [ "$SC" = "OK" ] && { LOSER="$OU"; M2WHO=unvoid; }
    M2CN="$(conname "$LOSER")"
    { [ "$(c6p_raw "$LOSER")" = "RAW" ] || [ "$(c6p_human "$LOSER")" = "HUMAN" ]; } && { M2HIT="$t"; break; }
  fi
done
[ -n "$M2HIT" ] \
  && ok TMUT-W6B2-C6P-ALONE "🔴🔴 ①之上再拿掉 C7 ⇒ **C6′ 單獨紅**(第 $M2HIT 次,輸的是 $M2WHO,conname=[${M2CN:-轉譯}];C9 由構造保證成立=箱量 3 ≤ instock 3)= C6′ **不是 no-op**,只是被 C7 嚴格遮蔽 ✓" \
  || bad TMUT-W6B2-C6P-ALONE "3 輪都沒讓 C6′ 單獨紅(最後一輪 who=[$M2WHO] conname=[$M2CN])⇒ **本靶未觸發**"

# ── 轉譯族:C6′ 只在突變後可觀察 ⇒ 這兩格**只能**跑在突變過的 schema 上(檔頭已標)──
# 🔴 用**序列**不用併發:誰輸是時序決定的,而這裡要量的是「輸的那一筆有沒有被轉譯」
#    ⇒ 先讓取消提交、再跑復原,輸的必定是復原 ⇒ 零抖動、不需要靠重試碰運氣。
# 🔴 **本函式不得呼叫 `die`**(跨模型審查 F5):它是在 `$( )` 裡被呼叫的 ⇒ 子 shell。
#    `die` 會把 server 關掉、然後只結束子 shell ⇒ 父 shell 後面每一格都在對死連線發問。
#    ⇒ 前置條件不成立時寫 `SEQFAIL|…` 進 stdout,由**父 shell** 判形並 die。(w6a/本檔還原段同一個坑。)
seq_c6p() { # $1=代號 → 印復原那一筆的完整輸出;前置失敗則印 "SEQFAIL|原因"
  local n="$1" r c
  r="$(mkround "$n" 3 3)"
  case "$r" in *"|"*"|"*) : ;; *) printf 'SEQFAIL|FIXTURE(%s): %s' "$n" "$(tail -2 "$D/mk.err" 2>/dev/null | tr '\n' ' ')"; return ;; esac
  splitr "$r"
  c="$(QM "SELECT $(CANCEL "$R_ORD" "$R_OI" 3)")"
  case "$(side "$c")" in OK) : ;; *) printf 'SEQFAIL|取消側沒成功(%s): %s' "$n" "$c"; return ;; esac
  QM "SELECT public.admin_unvoid_shipment('$n-u','$R_V')"
}
TH="$(seq_c6p t1)"; case "$TH" in SEQFAIL\|*) die "SEQ_C6P_FAIL: ${TH#SEQFAIL|}" ;; esac
[ "$(c6p_human "$TH")" = "HUMAN" ] \
  && ok W6B2-LOSER-HUMAN "🔴 C6′ 紅在復原側時帶的是**方向正確的人話**(P2B29 + W7d-1 的復原方向覆寫、含指紋「它現在就是作廢狀態」——即判定式驗的那一句),不是 raw 23514、也不再是教錯方向的「先作廢」✓(🔴 序列流程,不是併發臂;見上方註解)" \
  || bad W6B2-LOSER-HUMAN "復原側的 C6′ 錯誤不是人話:[$TH]"
MUTOUT="$(QM "CREATE OR REPLACE FUNCTION public.pcm_b2_shipping_human_error(p_sqlstate text, p_conname text) RETURNS text LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS \$m\$ SELECT NULL::text \$m\$")"
case "$MUTOUT" in *ERROR*) die "MUT_APPLY_FAIL(translation): $MUTOUT" ;; esac
TR="$(seq_c6p t2)"; case "$TR" in SEQFAIL\|*) die "SEQ_C6P_FAIL: ${TR#SEQFAIL|}" ;; esac
[ "$(c6p_raw "$TR")" = "RAW" ] \
  && ok TMUT-W6B2-TRANSLATION "🔴 把轉譯層打成回 NULL ⇒ 同一條路露出 **raw 23514 / oiqs_cancelled_shipped_le_quantity** = W6B2-LOSER-HUMAN 有判別力,不是恆真 ✓" \
  || bad TMUT-W6B2-TRANSLATION "打掉轉譯層後仍沒露出 raw:[$TR]"

echo "══ 4. 還原(價值不在「留乾淨給下一個人」——cluster 等下就銷毀)════"
# 🔴 **存在理由要寫對**(跨模型審查 F7):本檔跑完 :4xx 就 `rm -rf` 整座 cluster,沒有下一個讀者。
#    這一段真正買到的是兩件事,兩件都不是打掃:
#      ① **還原配方本身可執行** —— DROP 掉 C7 之後要加回去,必須先把違反列走真路徑清乾淨。
#         這正是日後真的要在正式庫上動這條 CHECK 時會遇到的順序問題,先在這裡踩過。
#      ② **突變是本次跑次唯一的差異** —— md5 逐字還原 = 我沒有順手改到別的東西。
#    🔴 擋不住的也寫下來:C7 的 catalog COMMENT 隨 DROP 消失、本段**沒有**還原它(拋棄式 cluster 上無害;
#       但這個配方若要搬去正式庫,COMMENT 必須一併補回,否則清償紀錄會憑空不見)。
# 🔴 順序有講究:C7 要加回去必須先讓所有列滿足 instock + cancelled <= quantity,
#    而突變輪留下的列是 instock 3 + cancelled 3。清法只能走**真路徑**:
#    先作廢箱(讓重算把 shipped 退回、否則刪到貨會反過來撞 C9)、再刪到貨(instock → 0)。
# 🔴 待清單子**用查的、不用記的**:首跑實錘 —— 原本靠 shell 變數累積 order_item_id,
#    而 `seq_c6p` 是在 `$( )` 裡被呼叫的(子 shell)⇒ 它 append 的兩筆**在父 shell 裡不存在**,
#    還原漏掉那兩列、C7 加不回去。同一個「子 shell 吞掉賦值」的坑,w6a 在 die 上踩過一次。
for oi in $(Q "SELECT coalesce(string_agg(order_item_id::text,' '),'') FROM public.order_item_quantity_summary WHERE instock_quantity + cancelled_quantity > quantity OR shipped_quantity > instock_quantity OR cancelled_quantity + shipped_quantity > quantity"); do
  for sid in $(Q "SELECT coalesce(string_agg(DISTINCT s.id::text,' '),'') FROM public.shipments s JOIN public.shipment_items si ON si.shipment_id=s.id WHERE si.order_item_id='$oi' AND s.deleted_at IS NULL AND s.shipped_at IS NOT NULL"); do
    RV="$(QM "SELECT public.admin_void_shipment('undo-$sid','$sid','還原突變輪')")"
    case "$RV" in *ERROR*) die "RESTORE_FAIL(void $sid): $RV" ;; esac
  done
  Q "DELETE FROM public.order_item_procurement_receipts r USING public.order_item_procurement p WHERE p.id=r.procurement_id AND p.order_item_id='$oi'" >/dev/null
done
BADROW="$(Q "SELECT pg_catalog.count(*)::text FROM public.order_item_quantity_summary WHERE instock_quantity + cancelled_quantity > quantity OR shipped_quantity > instock_quantity OR cancelled_quantity + shipped_quantity > quantity")"
[ "$BADROW" = "0" ] || die "RESTORE_FAIL: 仍有 $BADROW 列違反 C7/C9/C6′,加不回去"
Q "ALTER TABLE public.order_item_quantity_summary ADD CONSTRAINT oiqs_instock_cancelled_le_quantity CHECK (instock_quantity::bigint + cancelled_quantity::bigint <= quantity::bigint)" >/dev/null
[ "$(Q "SELECT pg_catalog.count(*)::text FROM pg_catalog.pg_constraint WHERE conname='oiqs_instock_cancelled_le_quantity' AND convalidated")" = "1" ] \
  || die "RESTORE_FAIL: C7 沒還原或沒 validated"
QF /dev/stdin <<'RESTORE' >/dev/null
DO $r$
DECLARE d text;
BEGIN
  SELECT w.d INTO d FROM public.w6b2_defs w WHERE w.k='cancel';  EXECUTE d;
  SELECT w.d INTO d FROM public.w6b2_defs w WHERE w.k='human';   EXECUTE d;
END
$r$;
RESTORE
[ "$(Q "SELECT pg_catalog.md5(pg_catalog.pg_get_functiondef('public.admin_cancel_order(uuid,uuid,text,text,text,jsonb)'::regprocedure))")" = "$MD5_CANCEL" ] \
  || die "RESTORE_FAIL: admin_cancel_order 沒還原成原定義"
[ "$(Q "SELECT pg_catalog.md5(pg_catalog.pg_get_functiondef('public.pcm_b2_shipping_human_error(text,text)'::regprocedure))")" = "$MD5_HUMAN" ] \
  || die "RESTORE_FAIL: 轉譯層沒還原成原定義"
echo "  ——  C7 已加回並 validated;取消 writer 與轉譯層 md5 逐字還原 ✓"

echo "══ 5. 覆蓋帳 ══════════════════════════════════════════════"
TOT=$((PASS+FAIL))
if [ "$TOT" = "$EXPECT_TOTAL" ]; then
  printf '  PASS %-32s %s\n' "CELL-ACCOUNT" "格數 $TOT = 凍結值 $EXPECT_TOTAL"; PASS=$((PASS+1))
else
  printf '  FAIL %-32s %s\n' "CELL-ACCOUNT" "格數 $TOT != 凍結值 $EXPECT_TOTAL"; FAIL=$((FAIL+1))
fi
DUP="$(printf '%s' "$KEYS" | tr ' ' '\n' | grep -v '^$' | sort | uniq -d | tr '\n' ' ')"
[ -z "$DUP" ] || { printf '  FAIL %-32s %s\n' "CELL-DUP" "重複格名 [$DUP]"; FAIL=$((FAIL+1)); }
KEYS_NOW="$(printf '%s' "$KEYS" | tr ' ' '\n' | grep -v '^$' | sort | tr '\n' ' ' | sed 's/ *$//')"
KEYS_FROZEN="TMUT-W6B2-C6P-ALONE TMUT-W6B2-CANCEL-INSTOCK-TERM TMUT-W6B2-TRANSLATION W6B2-BARRIER W6B2-BOTH-SUCCEED W6B2-BOUNDARY-TIGHT W6B2-BUDGET-COMPLEMENTARY W6B2-LOSER-HUMAN W6B2-REPLAY W6B2-SHRINK-DIM W6B2-STOP6-FIXTURE-DEAD"
if [ "$KEYS_NOW" = "$KEYS_FROZEN" ]; then
  printf '  PASS %-32s %s\n' "CELL-KEYSET" "格名集合逐字符合凍結清單"; PASS=$((PASS+1))
else
  printf '  FAIL %-32s %s\n' "CELL-KEYSET" "格名集合漂了:[$KEYS_NOW]"; FAIL=$((FAIL+1))
fi

# 🔴 原本這裡有一份行內收尾;已交給 EXIT 的 trap teardown,避免兩條收尾路徑各走各的。
echo
# 🔴 **不再印 TCP「埠殘留」** —— server 只開 unix socket(listen_addresses=)⇒ TCP 恆 0、零判別力。
#    真正的殘留檢查在 teardown(EXIT 時跑、停完才量、量不到 0 就保留 datadir 並印警告)。
echo "════ PASS=$PASS FAIL=$FAIL ════  (殘留檢查見下一行 teardown 輸出)"
[ "$FAIL" -eq 0 ] || exit 1
