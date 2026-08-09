#!/usr/bin/env bash
#
# W6b-3 · **B5 barrier:`取消 × 到貨(receipts)`**(§6a **漏列**的那一對;主視窗 `B-208-A` ③ 開片)
#
# 用法:scripts/w6b3-cancel-vs-receipt.sh   (自建拋棄式 cluster、跑完自動 teardown)
# 真權威:plan v4.2 §6a(B1-B4 四組**沒有這一對**)/ `B-290-STOP` ④-1 / `B-208-A` ③
# 編排骨架:照 `scripts/w6b2-cancel-vs-unvoid.sh`(advisory barrier、零 FIFO、全程有界輪詢)
#
# ══ 🔴🔴 申報:**開工令 `B-208-A` ③-① 的前提是錯的,而錯的方向讓這片更該做** ═══
#   ③-① 寫「到貨側 writer = 採購線 RPC(A5a upsert 家族),簽章與守門開工時親驗行號」。
#   親驗結果:**A5a 不是到貨 writer,而且到貨側根本沒有 writer。**
#     · `admin_upsert_item_procurement`(A5a → A9h-m)只寫 `order_item_procurement`,
#       且**被明文禁止寫 `received_quantity`** —— `…a9h_m_a5a…sql:512` 逐字
#       「received_quantity 不由本 RPC 寫(A4a 的 P4A01 守門)」,A4a 的 BEFORE guard 擋直寫。
#     · **應用層**原始碼:`order_item_procurement_receipts` **零 writer**(只有生成型別與兩句註解;
#       🔴 「全 repo」是不準的字面 —— migration 的驗收探針與 verify 腳本裡有 INSERT,那些不是產品路徑);
#       建表檔 `…a2…sql:180-181` 逐字「更正機制 = **第 2 批**批次到貨 UI 落地時才設計」。
#   ⇒ 到貨這一側**今天沒有任何 RPC 前緣**:一筆 `INSERT` 進 receipts,直接走 A4a 重算、
#     在**該 INSERT 語句結束時**撞 C7。這正是本片要釘住的東西,見下。
#   🔴 **時點寫準**(跨模型審查 F1):重算 trigger 是 `NOT DEFERRABLE` CONSTRAINT TRIGGER
#      (`…a4a…sql:414-417`)、C7 是普通 CHECK ⇒ 爆在**語句結束**,**不是 COMMIT**。
#      autocommit 下兩者看起來一樣,但 §4 的顯式交易裡分得出來 ⇒ 不得寫成 COMMIT。
#
# ══ 🔴🔴 這一對與 B3(W6b-2)**完全相反**:它真的有危險面,而且**不需要併發** ═══
#   共同軸是 **receipts 真相表本身**,不是摘要的 `instock_quantity`(🔴 R3 更正我原本寫錯的名字):
#     · 取消前緣**直讀 receipts**(`…a8a2…sql:400-402` 逐字 `sum(r.quantity) FROM … JOIN … receipts`);
#     · 到貨**寫 receipts**;
#     · 摘要的 `instock_quantity` **不在前緣的讀取集裡** —— 它只被 C7 壓著。
#   🔴 **這個名字很要緊**:照舊字面去開修復片的人會把序列化點畫在摘要列(鎖 summary / FOR UPDATE),
#      而前緣根本不碰那張表 ⇒ 修法上線後陳舊面原封不動,而本檔全部格照樣綠。
#   實測到的形狀(序列就成立,併發只是把窗口拉大):
#     ① 到貨真相 sum 為 0(= 摘要 `instock` 0)時取消全量 ⇒ 前緣過(3 ≤ 3−0−0)、**訂單被關**(`closed: true`);
#     ② 供應商的貨**真的到了** ⇒ 登錄到貨的那一筆 `INSERT` 撞 **C7** ⇒ **貨進不了系統**;
#     ③ 紅的是**到貨**那一筆 —— 完全無辜的一方;真凶(取消)早就提交了。
#   🔴 這正是 `…s2a…sql:143` 對 C9 寫過的同型警語(「紅在無辜交易、離真凶任意遠」)
#      在 **C7 這一軸**的實例,而該處只把它交辦給了 S2b 的出貨軸。
#
# ══ 🔴 到貨側的錯誤**沒有轉譯**(與出貨線的落差,本片據實釘住,不在本片修)═══
#   出貨/復原線有 `pcm_b2_shipping_human_error`(W3-3)把 23514 轉成人話;
#   到貨側**沒有呼叫端**可以掛 handler(沒有 RPC)⇒ 員工看到的是三層 trigger 堆疊的
#   raw `23514 oiqs_instock_cancelled_le_quantity`。本檔把它做成格,**不宣稱**該由誰修。
#
# ══ 🔴 誠實邊界 ════════════════════════════════════════════════
#   · 🔴🔴 **本檔測到的洞今天在正式站「構造不出來」,原因不是它被擋住,是到貨根本還登錄不了**(R3 F2):
#     `…a2…sql:233-234` 逐字 `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role`
#     + 只 `GRANT SELECT … TO service_role` ⇒ **沒有任何應用 role 能寫 receipts**;本檔是用
#     **superuser** 直寫的,那是 harness 自造的非產品狀態。
#     ⇒ 本檔的正確讀法**不是**「線上現在有洞」,而是:**第 2 批的到貨 writer 一落地就會撞 C7**。
#     🔴 拿本檔去開「線上有洞」的修復片 = 誤讀。要開的是「到貨 writer 落地前先解決這條」。
#   · 本檔的到貨側是**直寫 receipts**,因為今天沒有別的路。等第 2 批的批次到貨 UI/RPC 落地,
#     **本檔的結論要重估** —— 那時到貨側可能長出前緣,`W6B3-RECEIPT-NO-FRONTEDGE` 會自己轉 FAIL
#     (它是**絆線**,不是守門:它的價值在「情況變了會紅」,不在「它擋住了什麼」)。
#   · 跑過的維度:quantity 3、到貨量 2-3、取消增量 2-3、序列雙向、真併發同時放行。
#     **沒跑到**:多採購列拆單、多品項、到貨×到貨、取消×取消、冪等重放、
#     **整單取消路徑(`p_items` NULL)** —— 它的前緣是另一條規則(`…a8a2…sql:410-415`
#     「任一品項有到貨 ⇒ 拒」),與部分取消的算術預算不同族 —— 全部不在本檔帳上。
#   · 🔴 **危險面只存在於「未付款且無非 failed 付款嘗試」的訂單**(R3 F3;`…a8a2…sql:359-364` 步7
#     允許集合逐字)。本檔 fixture 靠 `orders.payment_status` 預設 `unpaid` 才走得通。
#     ⇒ **不得**把它讀成「所有訂單都會中」;已付款的單今天連取消 RPC 都進不去。
#   · 本檔**不提修法**。「未付款單取消後貨還是會到」要嘛擋在取消前緣、要嘛讓到貨可登錄後補退貨,
#     那是**產品決策**、不是我能拍的板。本檔只證洞在哪、長什麼樣。
#   · 🔴 **本檔不可用於診斷正式庫**(R3 F4):它自建拋棄式裸 PG、重放整個 migration 目錄、與正式庫
#     **零連線**;`W6B3-REPLAY` 的「真路徑」指的是**migration 線的真路徑**,不是正式庫的現況。
#     RLS / GRANT / PostgREST / service_role / 既有資料量 **全部不在本檔量測範圍**。
#     半夜要判「正式庫是不是也中了」,要查的是正式庫自己的 `pg_constraint` 與 apply 進度。
#   · 🔴 **與 W6b-2 的相依**(R3 N2):W6b-2 的互補代數把「兩個 I」當同一值,但取消側直讀 receipts
#     且**帶 `r.quantity > 0` 濾**(`…a8a2…sql:402`),復原側讀的是摘要欄(`…w3c2…sql:130`),
#     而 A4a 的 sum **不濾**(`…a4a…sql:170-173`)—— 今天兩者恆等只因 `…a2…sql:198`
#     `CHECK (quantity BETWEEN 1 AND 100000)` 保證非負。**第 2 批若引入沖銷/負值列,兩個 I 分岔,
#     W6b-2「B3 無危險面」的字面即失準** ⇒ 那批落地時兩片一起重估。
#     🔴 **而且不只是未來式**(R4 N-a):已 commit 的 `scripts/w6b2-cancel-vs-unvoid.sh` 對取消側
#     **現在**就把共同軸叫作 `instock`,與本檔 F1 更正前同一個誤名 —— 它的**結論不受影響**
#     (互補代數仍成立),但**機制名要照本檔讀**。單讀 w6b2 的人今天就會拿到錯的機制名。
#
# ══ 🔴 判準四句(承自 w0b/w1/w2/w3*/w5/w6a/w6b1/w6b2)══════════════
#   🔴 消融必須由紅轉綠,否則判別力歸屬錯。
#   🔴 全綠的消融也可能恆真,隔離守門自己要有靶。
#   🔴 「我的 SQL 寫壞了」不得與「被別的守門擋住」共用同一句結論。
#   🔴 家族格的靶不得只打一個成員。
#
# 🔴 本檔跑在**裸 PG,不是 Supabase**。🔴 **格數全綠證的是「寫下的守門有判別力」,證不了「該有的守門都想到了」。**
set -u
export LC_ALL=C LANG=C
REPO="$(cd "$(dirname "$0")/.." && pwd)"
D="${W6B3DB:-/tmp/w6b3db}"; SOCK="${W6B3SOCK:-/tmp/w6b3sk}"; P="${W6B3PORT:-54425}"
PASS=0; FAIL=0; KEYS=""
EXPECT_TOTAL=10   # 🔴 量出來的。全綠時 PASS = 10 + CELL-ACCOUNT + CELL-KEYSET = 12。
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

# 🔴 **第六個釘值檔**(b2s2b / w5 / w6a / w6b1 / w6b2 / 本檔)—— 新片落檔要**同批重釘六個**。
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
LINE_TIP="20260810100000"  # 2026-08-10 重釘 20260809200000->20260809210000(L4a-1 落檔;我的 200000 排它前面、不動尖端)
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
[ "$(Q "SELECT (pg_catalog.to_regprocedure('public.admin_cancel_order(uuid,uuid,text,text,text,jsonb)') IS NOT NULL
             AND pg_catalog.to_regprocedure('public.pcm_a4a_recompute_order_item_summary(uuid)') IS NOT NULL)::text")" = "true" ] \
  || die "UPSTREAM_MISSING: A8a2 取消(六參)或 A4a 重算不在"
[ "$(Q "SELECT pg_catalog.count(*)::text FROM pg_catalog.pg_constraint WHERE conname='oiqs_instock_cancelled_le_quantity' AND convalidated")" = "1" ] \
  || die "UPSTREAM_MISSING: C7 不在或未 validated"
ok W6B3-REPLAY "全 migration 重放(尖端 $LINE_TIP)⇒ 取消 writer(六參)+ A4a 重算都在、C7 validated ✓(🔴 「真路徑」= **migration 線**的真路徑;本檔與正式庫零連線,**不可用於診斷正式庫**)"

# ── 共用 fixture ────────────────────────────────────────────
CUST='11111111-1111-1111-1111-111111111111'
SNAP='{"name":"王大明","phone":"0900000000","line":"L1"}'
PSNAP='{"title":"零件","sku":"S1","spec":{"color":"black"}}'
Q "INSERT INTO auth.users(id,email) VALUES('$CUST','w6b3@test.local')" >/dev/null
Q "INSERT INTO public.customers(user_id,email) VALUES('$CUST','w6b3@test.local')" >/dev/null
Q "INSERT INTO public.staff(id,label) VALUES('sean','Sean')" >/dev/null
[ "$(Q "SELECT pg_catalog.count(*)::text FROM public.staff WHERE id='sean' AND is_active")" = "1" ] || die "FIXTURE_FAIL(staff)"
SUPP="$(Q "INSERT INTO public.suppliers(label) VALUES('W6b-3 供應商') RETURNING id")"
case "$SUPP" in ????????-*) : ;; *) die "FIXTURE_FAIL(suppliers): $SUPP" ;; esac

# 🔴 每輪自己的訂單(取消是訂單級 RPC,共用會讓輪與輪互相污染 —— W6b-2 同款理由)。
# 🔴 錯誤不用 `die`(在 `$( )` 子 shell 裡呼叫)⇒ 寫 `$D/mk.err`,呼叫端驗形狀。
mkitem() { # $1=代號 $2=先到貨幾件(0=還沒到) → 印 "ORD|OI|PROC"
  local n="$1" pre="$2" ord oi pid rc
  ord="$(Q "SELECT pg_catalog.gen_random_uuid()")"
  Q "INSERT INTO public.orders(id,display_id,customer_user_id,shipping_address_snapshot,tier_at_checkout,subtotal,shipping_fee,total,shipping_method,invoice,shipping_method_at_checkout) VALUES('$ord',public.pcm_generate_display_id(),'$CUST','$SNAP'::jsonb,(SELECT enumlabel::text::public.member_tier FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='member_tier' LIMIT 1),100,0,100,'home','{\"type\":\"personal\"}'::jsonb,'home')" >/dev/null
  oi="$(Q "SELECT pg_catalog.gen_random_uuid()")"
  Q "INSERT INTO public.order_items(id,order_id,variant_sku,product_snapshot,quantity,unit_price,line_total) VALUES('$oi','$ord','SKU-$n','$PSNAP'::jsonb,3,10,30)" >/dev/null
  pid="$(Q "INSERT INTO public.order_item_procurement(order_item_id,allocated_quantity,supplier_id) VALUES('$oi',3,'$SUPP') RETURNING id")"
  case "$pid" in ????????-*) : ;; *) printf 'FIXTURE_FAIL(procurement %s): %s\n' "$n" "$pid" >>"$D/mk.err"; return ;; esac
  if [ "$pre" -gt 0 ]; then
    rc="$(QM "INSERT INTO public.order_item_procurement_receipts(procurement_id,quantity,received_at,received_by) VALUES('$pid',$pre,now(),'tester')")"
    case "$rc" in *ERROR*) printf 'FIXTURE_FAIL(pre-receipt %s): %s\n' "$n" "$rc" >>"$D/mk.err"; return ;; esac
  fi
  printf '%s|%s|%s' "$ord" "$oi" "$pid"
}
splitr() { R_ORD="${1%%|*}"; local rest="${1#*|}"; R_OI="${rest%%|*}"; R_PID="${rest#*|}"; }
sums()   { Q "SELECT coalesce(instock_quantity,0)::text||'+'||coalesce(cancelled_quantity,0)::text||'/'||quantity::text FROM public.order_item_quantity_summary WHERE order_item_id='$1'"; }

CANCEL()  { printf "public.admin_cancel_order('%s',pg_catalog.gen_random_uuid(),'sean','customer_request',NULL,'[{\"order_item_id\":\"%s\",\"quantity\":%s}]'::jsonb)" "$1" "$2" "$3"; }
# 🔴 `RETURNING` **不是裝飾**(首跑實錘):psql 帶 `-q` 時**不印** `INSERT 0 1`
#    ⇒ 成功的到貨在輸出裡是**空字串**,被判成 `BAD`,四輪全部誤判成「不是恰一個成功」。
#    ⇒ 讓成功自己講話:`RETURNING` 一個哨兵字串,成功與失敗都有正面證據、不靠「沒有錯誤」推論。
RECEIPT() { printf "INSERT INTO public.order_item_procurement_receipts(procurement_id,quantity,received_at,received_by) VALUES('%s',%s,now(),'tester') RETURNING 'RECVOK'::text" "$1" "$2"; }

side()   { case "$1" in *ERROR*) printf 'ERR' ;; *idempotent*) printf 'OK' ;; *) printf 'BAD' ;; esac; }
# 🔴 到貨側**自己的**判定式:不與取消側共用(共用會讓「我的 SQL 寫壞了」與「被守門擋住」同判)。
rside()  { case "$1" in *ERROR*) printf 'ERR' ;; *RECVOK*) printf 'OK' ;; *) printf 'BAD' ;; esac; }
# 🔴 取消側的「被拒」要是**業務拒絕**,不是「紅在別的地方也算對」(W6b-2 跨模型審查 F4 的教訓)。
bizrej() { case "$1" in *P0001*) case "$1" in *"admin_cancel_order: 取消失敗"*) printf 'BIZ'; return ;; esac ;; esac; printf 'NO'; }
# 🔴 到貨側的「被拒」要**歸因到 C7**,不是任何 23514 都算。
c7raw()  { case "$1" in *oiqs_instock_cancelled_le_quantity*) case "$1" in *23514*) printf 'C7'; return ;; esac ;; esac; printf 'NO'; }

echo "══ 0. 🔴 到貨側有沒有前緣(catalog 實查,不看檔案)════════════"
# 🔴 **這一格是絆線不是守門**:它證的是「今天到貨側沒有任何 RPC 前緣」,
#    而不是「有什麼東西擋住了什麼」。第 2 批的批次到貨 UI/RPC 一落地,它就該轉 FAIL
#    ——那正是它存在的理由:本檔全部結論的前提變了,要有人喊。
# 🔴 **pattern 必須含 UPDATE/MERGE/DELETE 形**(跨模型審查 R2 F5):第一版只抓
#    「INSERT + 單空白 + public. 限定」。但 `…a2…sql:180` 明寫第 2 批要設計的是「登錄錯了的
#    **更正機制**」—— 更正天然是 **UPDATE 形** ⇒ 絆線會在它該絆的那一刻**絆不到**。
#    一併放寬空白/換行與「未 schema 限定」兩種寫法。
WRQ="SELECT coalesce(pg_catalog.string_agg(p.proname,','),'') FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosrc ~* '(insert\\s+into|update|delete\\s+from|merge\\s+into)\\s+(\"?public\"?\\.)?\"?order_item_procurement_receipts\"?'"
# 🔴 **絆線自己要有正控制**(跨模型審查 F4):`prosrc ILIKE` 這種存在性查詢,pattern 打錯一個字
#    就**永遠空=永遠綠**,而它守的東西壞了也不會有人知道(`guard-checks-existence-not-effect` 同型)。
#    ⇒ 當場種一支含該字面的假 writer,證明這條查詢**抓得到**,再拆掉。
# 🔴 正控制種**兩種形狀**:①INSERT + schema 限定 ②**UPDATE + 未限定 + 換行**(F5 點名的那一類)。
#    兩支都要被抓到,否則放寬等於沒放寬。
# 🔴 `CREATE` 失敗與「查詢恆空」**分開判**(R2 N6;判準 #3:兩件事不共用同一句結論)。
PIC="$(QM "CREATE FUNCTION public.w6b3_probe_ins() RETURNS void LANGUAGE plpgsql AS \$p\$ BEGIN INSERT INTO public.order_item_procurement_receipts(procurement_id,quantity,received_at,received_by) VALUES(NULL,0,now(),'probe'); END \$p\$")"
case "$PIC" in *ERROR*) die "TRIPWIRE_SETUP_FAIL(ins): $PIC" ;; esac
PUC="$(QM "CREATE FUNCTION public.w6b3_probe_upd() RETURNS void LANGUAGE plpgsql AS \$p\$ BEGIN UPDATE
     order_item_procurement_receipts SET quantity = quantity WHERE false; END \$p\$")"
case "$PUC" in *ERROR*) die "TRIPWIRE_SETUP_FAIL(upd): $PUC" ;; esac
PHIT="$(Q "$WRQ")"
case "$PHIT" in *w6b3_probe_ins*) : ;; *) die "TRIPWIRE_DEAD(ins): 種了 INSERT 形假 writer 卻抓不到 ⇒ 查詢恆空、本格無判別力(實得 [$PHIT])" ;; esac
case "$PHIT" in *w6b3_probe_upd*) : ;; *) die "TRIPWIRE_DEAD(upd): 種了 UPDATE 形假 writer 卻抓不到 ⇒ 放寬沒生效、第 2 批的更正機制落地時絆線絆不到(實得 [$PHIT])" ;; esac
Q "DROP FUNCTION public.w6b3_probe_ins(); DROP FUNCTION public.w6b3_probe_upd()" >/dev/null
FN_W="$(Q "$WRQ")"
RULE_W="$(Q "SELECT coalesce(pg_catalog.string_agg(r.rulename,','),'') FROM pg_catalog.pg_rewrite r WHERE r.ev_class='public.order_item_procurement_receipts'::regclass AND r.rulename <> '_RETURN'")"
TG_B="$(Q "SELECT coalesce(pg_catalog.string_agg(t.tgname,','),'') FROM pg_catalog.pg_trigger t WHERE t.tgrelid='public.order_item_procurement_receipts'::regclass AND NOT t.tgisinternal AND (t.tgtype & 2) <> 0")"
TG_A="$(Q "SELECT coalesce(pg_catalog.string_agg(t.tgname,','),'') FROM pg_catalog.pg_trigger t WHERE t.tgrelid='public.order_item_procurement_receipts'::regclass AND NOT t.tgisinternal AND (t.tgtype & 2) = 0")"
if [ -z "$FN_W" ] && [ -z "$TG_B" ] && [ -z "$RULE_W" ] && [ -n "$TG_A" ]; then
  ok W6B3-RECEIPT-NO-FRONTEDGE "🔴 到貨側**零前緣**:public schema 內無任何函式 prosrc 對 receipts 下 DML(零 writer RPC;**同一條查詢剛用兩支假 writer 證過抓得到 —— INSERT 限定形與 UPDATE 未限定跨行形各一**)、receipts 上**零 BEFORE trigger**、**零 RULE**,只有 AFTER 的重算鏈($TG_A)⇒ 一筆 INSERT 在**語句結束**就撞 CHECK(重算 trigger NOT DEFERRABLE),中間沒有人攔 ✓(🔴 絆線;🔴 **量到的範圍**=prosrc 的 INSERT/UPDATE/DELETE/MERGE 四種形(含未 schema 限定、跨行空白),**看不到**:動態 SQL/format() 拼出來的、BEGIN ATOMIC 的 prosqlbody、public 以外 schema、以及**應用層直接對表下 DML**)"
else
  bad W6B3-RECEIPT-NO-FRONTEDGE "到貨側的前緣狀況變了:writer=[$FN_W] BEFORE=[$TG_B] RULE=[$RULE_W] AFTER=[$TG_A] ⇒ 本檔全部結論的前提要重估"
fi

echo "══ 1. 🔴🔴 序列就已經紅(不需要併發)════════════════════════"
# 到貨真相 sum 為 0(= 摘要 instock 0)時全量取消 ⇒ 前緣過(3 ≤ 3−0−0)、訂單被關;之後貨真的到了 ⇒ 登錄不進去。
R="$(mkitem s1 0)"; case "$R" in *"|"*"|"*) : ;; *) die "FIXTURE_FAIL(s1): $(tail -2 "$D/mk.err" 2>/dev/null)" ;; esac
splitr "$R"
S1C="$(QM "SELECT $(CANCEL "$R_ORD" "$R_OI" 3)")"
S1S="$(sums "$R_OI")"
S1R="$(QM "$(RECEIPT "$R_PID" 3)")"
S1S2="$(sums "$R_OI")"
S1CLOSED="$(Q "SELECT (cancelled_at IS NOT NULL)::text FROM public.orders WHERE id='$R_ORD'")"
if [ "$(side "$S1C")" = "OK" ] && [ "$(c7raw "$S1R")" = "C7" ]; then
  ok W6B3-SERIAL-BLOCKS-ARRIVAL "🔴🔴 到貨真相為 0 時全量取消**成功**(前緣 3 ≤ 3−0−0 過),之後供應商的貨到了 ⇒ 登錄到貨的 INSERT **撞 C7 被擋死**(摘要停在 $S1S2)= 貨到了進不了系統,序列就成立、不需要併發 ✓ 🔴**這行被複製走時必須連著讀**:①只對**未付款**單成立(取消 RPC 要 unpaid)②今天正式站**構造不出來**(應用 role 對 receipts 零寫入權)⇒ 這是「**第 2 批到貨 writer 落地前要先解決**」,**不是**「線上現在有洞」"
else
  bad W6B3-SERIAL-BLOCKS-ARRIVAL "沒照預測:取消=[$(side "$S1C")] 到貨=[$(c7raw "$S1R")] 摘要 $S1S→$S1S2"
fi
# 🔴 「紅在無辜交易」不是形容詞:真凶(取消)**已提交且把訂單關掉了**,紅的是完全無辜的到貨那筆。
if [ "$S1CLOSED" = "true" ] && [ "$S1S" = "0+3/3" ] && [ "$S1S2" = "0+3/3" ]; then
  ok W6B3-LOSER-IS-INNOCENT "🔴 真凶已離場:取消側**已提交**、訂單 cancelled_at 已寫(closed)、摘要在到貨前後都是 $S1S2(到貨那筆整個回滾)⇒ 紅的是無辜的一方,沒有任何紀錄留下貨曾經到過 ✓ 🔴**同上限定**:未付款單、且今天正式站到貨還寫不進去 ⇒ 這是未來式的洞,不是現行事故"
else
  bad W6B3-LOSER-IS-INNOCENT "closed=[$S1CLOSED] 到貨前=[$S1S] 到貨後=[$S1S2]"
fi
# 🔴 到貨側**沒有呼叫端可以掛 handler** ⇒ 錯誤是 raw。與出貨線(W3-3 有轉譯層)的落差,據實釘住。
if [ "$(c7raw "$S1R")" = "C7" ] && case "$S1R" in *P2B29*) false ;; *) true ;; esac; then
  ok W6B3-ARRIVAL-RAW "🔴 到貨側的錯誤是 **raw 23514 + oiqs_instock_cancelled_le_quantity**、無 P2B29 轉譯(到貨側沒有 RPC ⇒ 沒有呼叫端可以掛 handler)⇒ 員工看到的是 trigger 堆疊 ✓(🔴 只陳述落差,不宣稱該由誰修)"
else
  bad W6B3-ARRIVAL-RAW "到貨側錯誤形狀不符:[$S1R]"
fi

echo "══ 2. 🔴 反序對照組:證明不對稱是真的 ═══════════════════════"
# 🔴 沒有這一格,上面的「到貨被擋」可以被讀成「這條路怎樣都紅」。
R="$(mkitem s2 3)"; case "$R" in *"|"*"|"*) : ;; *) die "FIXTURE_FAIL(s2): $(tail -2 "$D/mk.err" 2>/dev/null)" ;; esac
splitr "$R"
S2C="$(QM "SELECT $(CANCEL "$R_ORD" "$R_OI" 3)")"
if [ "$(bizrej "$S2C")" = "BIZ" ] && [ "$(sums "$R_OI")" = "3+0/3" ]; then
  ok W6B3-REVERSE-ASYMMETRY "🔴 反序(先到貨 3、再取消 3):取消被**前緣業務拒絕**(可取消量 = 3−3−0 = 0)、摘要停在 3+0/3 ⇒ 先來的那一方贏,**不對稱是真的**,不是「這條路怎樣都紅」 ✓"
else
  bad W6B3-REVERSE-ASYMMETRY "反序沒照預測:取消=[$(bizrej "$S2C")] 摘要=[$(sums "$R_OI")]"
fi

echo "══ 3. 🔴 部分維度:不是只有全量才中 ═════════════════════════"
R="$(mkitem s3 0)"; case "$R" in *"|"*"|"*) : ;; *) die "FIXTURE_FAIL(s3): $(tail -2 "$D/mk.err" 2>/dev/null)" ;; esac
splitr "$R"
S3C="$(QM "SELECT $(CANCEL "$R_ORD" "$R_OI" 2)")"
S3R="$(QM "$(RECEIPT "$R_PID" 2)")"
if [ "$(side "$S3C")" = "OK" ] && [ "$(c7raw "$S3R")" = "C7" ]; then
  ok W6B3-PARTIAL-DIM "🔴 部分取消 2 + 部分到貨 2(2+2 > quantity 3)⇒ 同樣撞 C7 ⇒ **不是只有全量取消才中**,任何 I+C 超過訂購量的組合都中 ✓"
else
  bad W6B3-PARTIAL-DIM "部分維度沒照預測:取消=[$(side "$S3C")] 到貨=[$(c7raw "$S3R")]"
fi

echo "══ 4. 🔴🔴 真併發:誰輸是時序決定的(序列時恆定是到貨輸)════"
# 🔴 序列時**永遠是到貨輸**(取消先提交)。併發要看的正是:輸的那一方會不會換人。
race() { # $1=代號 $2=訂單 $3=品項 $4=採購列 → 印 barrier 是否成立(1/0)
  local n="$1" o="$2" i="$3" pid="$4" ctl barrier=0 _ x
  psql -X -h "$SOCK" -p $P -U postgres -d postgres -qtA \
    -c "SELECT pg_catalog.pg_advisory_lock(45); SELECT pg_catalog.pg_sleep(1.2); SELECT pg_catalog.pg_advisory_unlock(45);" >"$D/ctl.$n" 2>&1 &
  ctl=$!
  for _ in $(seq 1 40); do
    [ "$(Q "SELECT pg_catalog.count(*)::text FROM pg_catalog.pg_locks WHERE locktype='advisory' AND granted AND objid=45")" != "0" ] && break
    sleep 0.05
  done
  PGAPPNAME=w6b3_cancel psql -X -v VERBOSITY=verbose -h "$SOCK" -p $P -U postgres -d postgres -qtA \
    -c "BEGIN; SELECT pg_catalog.pg_advisory_xact_lock_shared(45); SELECT $(CANCEL "$o" "$i" 3); COMMIT;" >"$D/cancel.$n" 2>&1 &
  PGAPPNAME=w6b3_recv psql -X -v VERBOSITY=verbose -h "$SOCK" -p $P -U postgres -d postgres -qtA \
    -c "BEGIN; SELECT pg_catalog.pg_advisory_xact_lock_shared(45); $(RECEIPT "$pid" 3); COMMIT;" >"$D/recv.$n" 2>&1 &
  for _ in $(seq 1 60); do
    x="$(Q "SELECT pg_catalog.count(*)::text FROM pg_catalog.pg_locks l JOIN pg_catalog.pg_stat_activity a ON a.pid=l.pid WHERE l.locktype='advisory' AND NOT l.granted AND a.application_name IN ('w6b3_cancel','w6b3_recv')")"
    [ "$x" = "2" ] && { barrier=1; break; }
    sleep 0.05
  done
  wait $ctl 2>/dev/null || true
  wait 2>/dev/null || true
  printf '%s' "$barrier"
}
ROUNDS=4
BARRIER_BAD=""; NOT_ONE=""; WHO=""
for i in $(seq 1 $ROUNDS); do
  R="$(mkitem c$i 0)"; case "$R" in *"|"*"|"*) : ;; *) die "FIXTURE_FAIL(c$i): $(tail -2 "$D/mk.err" 2>/dev/null)" ;; esac
  splitr "$R"
  B="$(race "c$i" "$R_ORD" "$R_OI" "$R_PID")"
  [ "$B" = "1" ] || BARRIER_BAD="$BARRIER_BAD c$i"
  OC="$(tr '\n' ' ' <"$D/cancel.c$i")"; OR="$(tr '\n' ' ' <"$D/recv.c$i")"
  SC="$(side "$OC")"; SR="$(rside "$OR")"
  # 🔴 **已知的第三種合法收場**(R2 N5,本次 4 輪未出現):取消過了前緣、到貨先提交,
  #    取消自己的重算撞 **C7**(23514)而輸 —— READ COMMITTED 下可達。它會落 NOT_ONE 轉紅
  #    (fail-closed,不會假綠),但**那是新 interleaving、不是 harness 壞了**,看到請照這句判讀。
  # 🔴 **輸家要歸因,不能只看「有沒有 ERROR」**(跨模型審查 F2;正是本檔判準 #3 與 W6b-2 F4 的教訓):
  #    取消若輸在 40P01 死鎖、或我把 SQL 拼壞,只看 ERR 會照樣綠著寫「取消輸」。
  #    ⇒ 到貨輸必須是 **C7**;取消輸必須是**業務拒絕**(P0001 + 取消失敗)。歸不到就進 NOT_ONE。
  case "$SC:$SR" in
    OK:ERR) if [ "$(c7raw "$OR")" = "C7" ]; then WHO="$WHO c$i:到貨輸(C7)"
            else NOT_ONE="$NOT_ONE c$i(到貨輸但歸因不到 C7)"; fi ;;
    ERR:OK) if [ "$(bizrej "$OC")" = "BIZ" ]; then WHO="$WHO c$i:取消輸(業務拒絕)"
            else NOT_ONE="$NOT_ONE c$i(取消輸但不是業務拒絕)"; fi ;;
    *)      NOT_ONE="$NOT_ONE c$i(取消=$SC/到貨=$SR)" ;;
  esac
done
# 🔴 **刻意不查「instock + cancelled > quantity」**(跨模型審查 F3):C7 全程掛著 ⇒ 已提交的列
#    依構造不可能違反它,那是恆真格(W6b-2 已為同一形狀移除過一格)。原本我量了卻從不斷言 =
#    **死檢查**,比恆真格更糟:讀者以為不變量被釘住。要嘛真斷言、要嘛拿掉 —— 這裡拿掉。
printf '  ——  各輪輸的是誰(敘述、非判定):%s\n' "$WHO"
[ -z "$BARRIER_BAD" ] && ok W6B3-BARRIER "$ROUNDS 輪**每一輪**兩個 session 都真的卡在 barrier 上才被放行 ⇒ **同時放行**成立(🔴 本格只證這件事,不證危險區重疊)✓" \
                      || bad W6B3-BARRIER "barrier 沒成立的輪次:$BARRIER_BAD"
[ -z "$NOT_ONE" ] \
  && ok W6B3-CONCURRENT-EXACTLY-ONE "🔴 每一輪**恰一個成功且輸家可歸因**(到貨輸=C7、取消輸=業務拒絕)⇒ 共同軸(**receipts 真相表**,不是摘要的 instock 欄)上的互斥是真的。🔴 **輸家由時序決定的證據不在本節內部**(本次 4 輪同向),而在**與 §1 的對照**:序列(取消先提交)⇒ 到貨輸;併發 ⇒ 本次 4/4 取消輸。**同形** fixture(同參數的新列,取消會關單故必然重建)、只換時序就換人輸 ✓" \
  || bad W6B3-CONCURRENT-EXACTLY-ONE "有輪次不是恰一個成功:$NOT_ONE"

echo "══ 5. 🔴 突變靶:C7 在本檔打過的點上是這一軸唯一的承重牆 ════"
C7DEF="$(Q "SELECT pg_catalog.pg_get_constraintdef(oid) FROM pg_catalog.pg_constraint WHERE conname='oiqs_instock_cancelled_le_quantity'")"
# 🔴 拿掉 C7 ⇒ 上面 SERIAL/INNOCENT/RAW/PARTIAL/EXACTLY-ONE 那一族**全部**該翻面:
#    到貨不再被擋、instock + cancelled 靜默超過 quantity。
#    這正是「到貨側零前緣」的代價:**沒有第二層**,C7 一倒就沒人接。
Q "ALTER TABLE public.order_item_quantity_summary DROP CONSTRAINT oiqs_instock_cancelled_le_quantity" >/dev/null
[ "$(Q "SELECT pg_catalog.count(*)::text FROM pg_catalog.pg_constraint WHERE conname='oiqs_instock_cancelled_le_quantity'")" = "0" ] || die "MUT_APPLY_FAIL: C7 沒拿掉"
R="$(mkitem m1 0)"; case "$R" in *"|"*"|"*) : ;; *) die "FIXTURE_FAIL(m1): $(tail -2 "$D/mk.err" 2>/dev/null)" ;; esac
splitr "$R"; MUT_OI="$R_OI"; MUT_PID="$R_PID"
M1C="$(QM "SELECT $(CANCEL "$R_ORD" "$R_OI" 3)")"
M1R="$(QM "$(RECEIPT "$R_PID" 3)")"
M1S="$(sums "$R_OI")"
# 🔴 加驗 `c7raw = NO`:讓「翻面」有**直接證據**(到貨那筆不再帶 C7),不只靠「成功了」推論。
if [ "$(side "$M1C")" = "OK" ] && [ "$(rside "$M1R")" = "OK" ] && [ "$(c7raw "$M1R")" = "NO" ] && [ "$M1S" = "3+3/3" ]; then
  ok TMUT-W6B3-C7 "🔴🔴 拿掉 C7 ⇒ 取消與到貨**兩邊都成功**、摘要變 **3+3/3**(instock + cancelled = 6 > quantity 3)**靜默提交** = 上面那一族全靠 C7 撐著,而到貨側零前緣 ⇒ **在本檔打過的這個點上沒有第二層**,C7 一倒就沒人接 ✓(🔴 翻面只打了一點:取消 3 + 到貨 3 vs quantity 3;不宣稱全參數空間)"
else
  bad TMUT-W6B3-C7 "拿掉 C7 後沒翻面:取消=[$(side "$M1C")] 到貨=[$(rside "$M1R")] 摘要=[$M1S] ⇒ **本靶未觸發**,上面那一族的判別力這次沒被驗證"
fi
# 🔴 還原:走真路徑把 instock 退回(刪到貨列 ⇒ A4a 重算)才加得回 C7;直接 ADD 會被既有壞列拒絕。
Q "DELETE FROM public.order_item_procurement_receipts r USING public.order_item_procurement p WHERE p.id=r.procurement_id AND p.order_item_id='$MUT_OI'" >/dev/null
BADROW="$(Q "SELECT pg_catalog.count(*)::text FROM public.order_item_quantity_summary WHERE instock_quantity + cancelled_quantity > quantity")"
[ "$BADROW" = "0" ] || die "RESTORE_FAIL: 仍有 $BADROW 列違反 C7,加不回去"
# 🔴 還原的 CHECK 字面與原始定義**逐字同**(`…a1…sql:123-124`;含 `::bigint` 防 22003 溢位)。
#    R3 N3:名字對不等於定義對 —— 用 `pg_get_constraintdef` 與還原前存下的字面比對,不靠肉眼。
Q "ALTER TABLE public.order_item_quantity_summary ADD CONSTRAINT oiqs_instock_cancelled_le_quantity CHECK (instock_quantity::bigint + cancelled_quantity::bigint <= quantity::bigint)" >/dev/null
[ "$(Q "SELECT pg_catalog.count(*)::text FROM pg_catalog.pg_constraint WHERE conname='oiqs_instock_cancelled_le_quantity' AND convalidated")" = "1" ] \
  || die "RESTORE_FAIL: C7 沒還原或沒 validated"
[ "$(Q "SELECT pg_catalog.pg_get_constraintdef(oid) FROM pg_catalog.pg_constraint WHERE conname='oiqs_instock_cancelled_le_quantity'")" = "$C7DEF" ] \
  || die "RESTORE_FAIL: C7 定義與還原前不同(原=[$C7DEF])"
echo "  ——  C7 已加回並 validated(還原配方:先刪到貨列讓重算退回,再 ADD)✓"

echo "══ 6. 覆蓋帳 ══════════════════════════════════════════════"
TOT=$((PASS+FAIL))
if [ "$TOT" = "$EXPECT_TOTAL" ]; then
  printf '  PASS %-32s %s\n' "CELL-ACCOUNT" "格數 $TOT = 凍結值 $EXPECT_TOTAL"; PASS=$((PASS+1))
else
  printf '  FAIL %-32s %s\n' "CELL-ACCOUNT" "格數 $TOT != 凍結值 $EXPECT_TOTAL"; FAIL=$((FAIL+1))
fi
DUP="$(printf '%s' "$KEYS" | tr ' ' '\n' | grep -v '^$' | sort | uniq -d | tr '\n' ' ')"
[ -z "$DUP" ] || { printf '  FAIL %-32s %s\n' "CELL-DUP" "重複格名 [$DUP]"; FAIL=$((FAIL+1)); }
KEYS_NOW="$(printf '%s' "$KEYS" | tr ' ' '\n' | grep -v '^$' | sort | tr '\n' ' ' | sed 's/ *$//')"
KEYS_FROZEN="TMUT-W6B3-C7 W6B3-ARRIVAL-RAW W6B3-BARRIER W6B3-CONCURRENT-EXACTLY-ONE W6B3-LOSER-IS-INNOCENT W6B3-PARTIAL-DIM W6B3-RECEIPT-NO-FRONTEDGE W6B3-REPLAY W6B3-REVERSE-ASYMMETRY W6B3-SERIAL-BLOCKS-ARRIVAL"
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
