#!/usr/bin/env bash
#
# W6c · **冪等重放 oracle:三表 Δ=0 / 併發恰一組產物 / 兩層牆歸屬**
#
# 用法:scripts/w6c-idem-replay.sh   (自建拋棄式 cluster、跑完自動 teardown)
# 真權威:plan v4.2 §6a B4 / `B-292-STOP` ③(備料)/ `B-211-A` ②③(開工令)
# 被測物:`admin_create_shipment`(W3-1,`…w3a…sql`)+ `pcm_b2_shipping_idem_claim`(W2,`…w2…sql:252`)
# 編排骨架:照 `scripts/w6b3-cancel-vs-receipt.sh`(advisory barrier、零 FIFO、全程有界輪詢)
#
# ══ 🔴🔴 申報一:**§6a B4 的字面第四次對不上,而這次錯的是「牆只有一層」** ═══
#   `B-292-STOP` ③ 把 B4 更正成「兩發都打」,其中第①發寫的是:
#     「打 claim 的分派,讓 23505 那條路回 NULL(被當成首次認領)⇒ 呼叫端接著建第二箱」。
#   **本窗實跑,前半對、後半錯**:
#     · claim 分派突變成回 NULL 之後,B 這一側**確實去建了第二箱**;
#     · 但它接著呼叫 `record()`,那句 UPDATE 撞上 **W0b 的 `pcm_b2_shipping_idem_freeze_identity`**
#       (「shipment_id 一旦回填即不可改指」)⇒ **P0001、整筆回滾** ⇒ **第二箱不會留下來**。
#   ⇒ 「新建第二箱」作為**持久結果**是錯的:單打 claim 分派**造不出**多出來的貨。
#   ⇒ 正確的形狀是**兩層牆**,本檔用**疊加消融**把歸屬釘死(`TMUT-W6C-CLAIM-DISPATCH`
#     與 `TMUT-W6C-CLAIM-PLUS-FREEZE` 兩格):
#       第一層 = claim 的 23505 分派;第二層 = W0b 的 freeze trigger。
#       **只拆第一層** ⇒ B 由「乾淨重放」變成「硬錯」,箱子不留;
#       **兩層都拆** ⇒ **兩箱都提交**(shipments +2、鍵列只有 1)、且**鍵列只指到其中一箱**
#                     ⇒ 另一箱**成為孤兒**:客人收到兩件,而重放紀錄只認得一件。
#   🔴 **第二層的物件歸屬要講精確**(R1 nit):trigger **物件**建在 W0b(`…w0b…sql:182`),
#      但**執行體**已被 W2 `CREATE OR REPLACE` 取代(`…w2…sql:461`)⇒ 本檔寫「W0b 的 freeze trigger」
#      指的是那個 trigger 物件,行為要看 W2 的版本。
#   🔴 這與 W6b-3 的 C7 **正好相反**:那一軸沒有第二層(C7 一倒就沒人接);這一軸有。
#      據實寫下,不把「有第二層」講成「所以不用管第一層」。
#      🔴 **也不把第一層講得比實測更嚴重**(R1 nit):**單拆第一層並不產生孤兒**——
#      整筆回滾、貨不會多出來,症狀是「合法的重試拿到一個看不懂的硬錯」。孤兒要**兩層皆倒**才出現。
#
# ══ 🔴🔴 申報二:**D5 的「audit 增量凍結」今天量不到,本檔不寫恆真格** ═══
#   `B-292-STOP` ③ 交辦「audit 增量凍結(D5 未在探針量,**開工要先驗它量得到**)」。
#   **開工先驗了,結論是:量不到。** 實查(本檔 `W6C-AUDIT-NOT-MEASURABLE` 格當場重跑):
#     · **十支** admin RPC 的 prosrc 會寫 `admin_audit_log`(adjust_wallet / append_order_note /
#       cancel_order / finalize_order_refund / initiate_order_refund / set_customer_tier /
#       update_order_item_workflow / update_order_workflow / upsert_item_procurement / upsert_supplier);
#     · **出貨五支一支都不寫**,`shipments` / `shipment_items` / 鍵表三張表上也**零審計 trigger**。
#   ⇒ 首次成功的 audit 增量本來就是 **0**,重放的增量也是 0 ⇒ 「重放時 audit Δ=0」這句
#     **對任何實作都恆真**、零判別力(`feedback_fixture-value-makes-guard-vacuous` 同型)。
#   ⇒ 本檔**不寫**那一格,改寫成**絆線**:釘住「出貨線今天零 audit」這個事實本身。
#     等有人替出貨線補上審計,絆線轉 FAIL,那時候 D5 要的那一格才**開始有意義**、該補。
#   🔴 絆線自己帶**四個正控制 + 一道名字存在性閘**,否則它跟「查詢打錯字所以永遠空」分不開:
#     ①**全庫查詢面**:種一支含該字面的假 writer,證明 AUDQ 抓得到;
#     ②**計數面**:實跑一支**真的會寫 audit 的產品 RPC**(`admin_upsert_supplier`),
#       證明本 cluster 的 audit 計數器**真的會動**(0 → 1)。
#       沒有②,「出貨側零 audit」可以被讀成「這個 harness 的 audit 整條是死的」。
#     🔴 ③④與名字閘是 **R1 F2/F3 補的** —— 首版只打了 AUDQ,而**真正讓本格放行的是出貨側那兩條查詢**,
#        它們自己沒有靶(同一個「存在性守門恆真」的坑,只是換位置犯):
#     ③**出貨側直接形 + 間接形**:種「自己寫 audit」與「只呼叫 audit helper」兩支假出貨函式,兩支都要被抓到
#       ——後者是補審計最常見的寫法,首版的查詢**看不到**它(F3 的漏形),故加一跳呼叫圖;
#     ④**trigger 面**:掛一支會寫 audit 的假 trigger 到 shipments 上,證明那條查詢抓得到;
#     ⑤**名字存在性閘**:五支出貨 RPC 的 proname 逐一驗在 `pg_proc` 裡,改名或拼錯 ⇒ **die**,
#       不讓「清單過期」偽裝成「乾淨的零」。
#
# ══ 🔴🔴 申報三:**R1 抓到本檔檔頭自己講錯 —— 已更正,且把那一軸做成真的** ═══
#   首版檔頭寫「掛品項(W3-2)與出貨(W3-3)**尚未實作**」並引 `…w2…sql:647/675` 的
#   「業務層尚未實作」當依據 ⇒ **錯的**。那兩句是 **W2 當時的 stub**,**已被後片取代**:
#     · W3-2 實作在 `…20260807180000…w3b2…sql:259`(逐字 `INSERT INTO public.shipment_items`),
#       且 `…20260807230000…w4b…sql:294` 又重定義了一次(本檔釘的尖端就是它);
#     · W3-3 實作在 `…20260807190000…w3c3…sql`(寫 `shipped_at`)。
#   ⇒ 我引用的是**已被推翻的舊字面**,而不是尖端的契約(本線 `feedback_assert-scope-only-after-reading-source-file` 同型)。
#   ⇒ 更正之外**還把那一軸做成真的**:首版 `shipment_items` 全程 0,**不是因為寫不進去,
#     是因為本檔沒建 order fixture** —— 那會讓「三表 Δ=0」有一軸恆 0 恆真、名不副實。
#     現在本檔建真 order/品項/採購/到貨,**先把品項掛進箱子**(`admin_add_shipment_items`),
#     再做重放 ⇒ Δ=0 是在 `shipment_items > 0` 的狀態下量的,那一軸**有判別力**
#     (`W6C-SERIAL-DELTA-ZERO` 格自帶「items 必須 > 0」的斷言,掉回 0 就轉 FAIL)。
#
# ══ 🔴 誠實邊界 ════════════════════════════════════════════════
#   · 本檔量的是**冪等層的重放語意**,不是「出貨線正確」。掛品項與出貨兩支 RPC 各有自己的冪等鍵與
#     前緣,**它們自己的重放**由它們自己的 harness 負責 —— 本檔只證「箱子裡有東西時,
#     **建箱**這把鍵的重放不動三表」,**不得**讀成「掛品項的重放已被驗過」。
#   · 併發只跑到**同鍵同 payload**。同鍵**不同** payload(P2B22)、跨 action 同鍵、
#     以及 `record()` 之後才崩的半成品路徑(P2B23)**不在本檔帳上**(W2 自己的 harness 有)。
#   · 突變②的 `shipments_pkey` 面是**本檔自己造出來的**:正式路徑上 `id` 走 `gen_random_uuid()`,
#     撞號等於亂數源壞了。本檔把 default 暫時釘成定值才讓那一面可構造 ⇒
#     **這證的是「分派會不會分辨」,不是「pkey 撞號會發生」**。第三面 `shipments_hct_request_id_key`
#     建箱不寫該欄、**本檔未構造**,分派對它的正確性沒被本檔驗證。
#   · 🔴 **本檔不可用於診斷正式庫**:自建拋棄式裸 PG、重放整個 migration 目錄、與正式庫零連線。
#     RLS / GRANT / PostgREST / 既有資料量全部不在量測範圍。
#   · 本檔**不提修法**,也**不把設計題丟給已收工的片**(R1 nit):「兩層都倒會留孤兒箱」要不要再加
#     第三道,是**產品/設計決策**,列進交接欠款交給主視窗,不在本檔拍板、不指派給 W3-2/W3-3。
#
# ══ 🔴 判準四句(承自 w0b/w1/w2/w3*/w5/w6a/w6b1/w6b2/w6b3)══════
#   🔴 消融必須由紅轉綠,否則判別力歸屬錯。
#   🔴 全綠的消融也可能恆真,隔離守門自己要有靶。
#   🔴 「我的 SQL 寫壞了」不得與「被別的守門擋住」共用同一句結論。
#   🔴 家族格的靶不得只打一個成員。
#
# 🔴 本檔跑在**裸 PG,不是 Supabase**。🔴 **格數全綠證的是「寫下的守門有判別力」,證不了「該有的守門都想到了」。**
set -u
export LC_ALL=C LANG=C
REPO="$(cd "$(dirname "$0")/.." && pwd)"
D="${W6CDB:-/tmp/w6cdb}"; SOCK="${W6CSOCK:-/tmp/w6csk}"; P="${W6CPORT:-54426}"
PASS=0; FAIL=0; KEYS=""
EXPECT_TOTAL=9   # 🔴 量出來的。全綠時 PASS = 9 + CELL-ACCOUNT + CELL-KEYSET = 11。
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
QF() { psql -X -v VERBOSITY=verbose -h "$SOCK" -p $P -U postgres -d postgres -qtA -f "$1" 2>&1 | tr '\n' ' '; }

# 🔴 **第七個釘值檔**(b2s2b / w5 / w6a / w6b1 / w6b2 / w6b3 / 本檔)—— 新片落檔要**同批重釘七個**。
#    🔴 本片**沒有新 migration** ⇒ 七個同值、其餘六個零改動(落檔申報)。
#    (`scripts/w4b-verify.sh` 用的是 `PREFIX_TS` 前綴重放錨,逐字寫明「不再對目錄尾端有意見」
#      ⇒ 它**不在**這七個之內,別把它一起改。)
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
LINE_TIP="20260811080000"  # 2026-08-11 重釘 20260811030000->20260811060000(L5b-2 片 2a=P 窗;claim RPC DROP+重建、回傳三欄->四欄。**述詞一字未動**〔md5(split_part(prosrc,'RETURNING',1)) 兩版皆 f15644b5…〕⇒ 對本檔被測面無交集;唯一連動是 l5b0-verify 的 claim 身分閘,已同批重釘);後續重釘 ->070000(D 翻種子收割)->080000(P 2c 收割;兩次皆主視窗收割時代釘,值已對、本註解 08-11 補齊)
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
[ "$(Q "SELECT (pg_catalog.to_regprocedure('public.admin_create_shipment(text,uuid,jsonb,text,text)') IS NOT NULL
             AND pg_catalog.to_regprocedure('public.pcm_b2_shipping_idem_claim(text,text,text)') IS NOT NULL
             AND pg_catalog.to_regprocedure('public.pcm_b2_shipping_idem_record(text,text,uuid,jsonb)') IS NOT NULL)::text")" = "true" ] \
  || die "UPSTREAM_MISSING: 建箱 writer 或 W2 冪等層(claim/record)不在"
[ "$(Q "SELECT pg_catalog.count(*)::text FROM pg_catalog.pg_trigger WHERE tgrelid='public.pcm_b2_shipping_idempotency'::regclass AND tgname='pcm_b2_shipping_idem_block_identity_update' AND NOT tgisinternal")" = "1" ] \
  || die "UPSTREAM_MISSING: W0b 的 freeze trigger 不在(本檔的第二層歸屬要靠它)"
ok W6C-REPLAY "全 migration 重放(尖端 $LINE_TIP)⇒ 建箱 writer + claim/record 冪等層 + W0b freeze trigger 都在 ✓(🔴 「真路徑」= **migration 線**的真路徑;本檔與正式庫零連線,**不可用於診斷正式庫**)"

# ── 共用 fixture ────────────────────────────────────────────
CUST='11111111-1111-1111-1111-111111111111'
SNAP='{"name":"王大明","phone":"0900000000","line":"L1"}'
# 🔴 `RETURNING` 哨兵不是裝飾(w6b3 首跑實錘):psql 帶 `-q` 時**不印** `INSERT 0 1`
#    ⇒ 成功的裸 DML 在輸出裡是空字串、會被判成失敗。讓成功自己講話,不靠「沒有錯誤」推論。
U="$(QM "INSERT INTO auth.users(id,email) VALUES('$CUST','w6c@test.local') RETURNING 'UOK'::text")"
case "$U" in *UOK*) : ;; *) die "FIXTURE_FAIL(auth.users): $U" ;; esac
[ "$(Q "SELECT pg_catalog.count(*)::text FROM public.customers WHERE user_id='$CUST'")" = "1" ] || die "FIXTURE_FAIL(customers 不存在)"
[ "$(Q "SELECT pg_catalog.count(*)::text FROM public.staff WHERE id='sean' AND is_active")" = "1" ] || die "FIXTURE_FAIL(staff)"

# 建箱呼叫(同鍵同 payload)。回傳信封形狀:{id, shipment_reference, customer_user_id, shipment_id, idempotent}
MK()    { printf "SELECT public.admin_create_shipment('%s','%s','%s'::jsonb,'hct')" "$1" "$CUST" "$SNAP"; }
# 三表計數(shipments / shipment_items / 鍵表)。🔴 三軸都是活的:§1 會先用 admin_add_shipment_items
#    把品項掛進箱子,Δ=0 是在 shipment_items > 0 下量的(見申報三)。掉回 0 有 fixture 看門狗 die。
counts(){ Q "SELECT (SELECT pg_catalog.count(*) FROM public.shipments)::text||'/'||(SELECT pg_catalog.count(*) FROM public.shipment_items)::text||'/'||(SELECT pg_catalog.count(*) FROM public.pcm_b2_shipping_idempotency)::text"; }
# 🔴 三種收場**各自判定式**,不共用(判準 #3:「我的 SQL 寫壞了」不得與「被守門擋住」同判)。
first() { case "$1" in *ERROR*) printf 'ERR' ;; *'"idempotent": false'*) printf 'FIRST' ;; *'"idempotent": true'*) printf 'REPLAY' ;; *) printf 'BAD' ;; esac; }
shipid(){ printf '%s' "$1" | sed -n 's/.*"shipment_id": "\([0-9a-f-]*\)".*/\1/p'; }

echo "══ 0. 🔴 audit 增量凍結量不量得到(絆線 + 四個正控制 + 名字存在性閘)══"
AUDQ="SELECT coalesce(pg_catalog.string_agg(p.proname,',' ORDER BY p.proname),'') FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosrc ~* '(insert\\s+into|update|delete\\s+from|merge\\s+into)\\s+(\"?public\"?\\.)?\"?admin_audit_log\"?'"
# 🔴 正控制①(查詢面):種一支含該字面的假 writer,證明這條查詢抓得到,再拆掉。
#    沒有它,pattern 打錯一個字就是**永遠空 = 永遠綠**,而它守的東西壞了沒人知道。
APC="$(QM "CREATE FUNCTION public.w6c_probe_audit() RETURNS void LANGUAGE plpgsql AS \$p\$ BEGIN INSERT INTO public.admin_audit_log(actor,action,entity_type,entity_id) VALUES('p','p','p','p'); END \$p\$")"
case "$APC" in *ERROR*) die "TRIPWIRE_SETUP_FAIL(audit probe): $APC" ;; esac
case "$(Q "$AUDQ")" in *w6c_probe_audit*) : ;; *) die "TRIPWIRE_DEAD(audit): 種了假 writer 卻抓不到 ⇒ 查詢恆空、本格無判別力" ;; esac
Q "DROP FUNCTION public.w6c_probe_audit()" >/dev/null
AUD_WRITERS="$(Q "$AUDQ")"
# 🔴🔴 R1 F2:**真正讓本格放行的是下面兩條查詢,而正控制①只打了 AUDQ** ——
#    那正是本格自己說要防的「打錯一個字 = 永遠空 = 永遠綠」,只是換了個位置犯。
#    ⇒ ①五個 proname **逐一驗它在 pg_proc 裡存在**(改名/拼錯 ⇒ die,不是靜默綠);
#      ②下面兩條查詢各自種一支假 writer,證明它們**抓得到**,再拆掉。
SHIP_FN_SET="'admin_create_shipment','admin_add_shipment_items','admin_mark_shipment_shipped','admin_void_shipment','admin_unvoid_shipment'"
# 🔴 R2 nit:名單**只留一份字面**($SHIP_FN_SET),存在性閘用 unnest 吃同一份 ——
#    寫兩份的話,未來加第六支只改其一,掃描面與存在性閘就漂了、F2 的洞對新成員重開。
MISSING="$(Q "SELECT coalesce(pg_catalog.string_agg(x.n,','),'') FROM pg_catalog.unnest(ARRAY[$SHIP_FN_SET]) x(n) WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.proname=x.n)")"
[ -z "$MISSING" ] || die "TRIPWIRE_STALE: 絆線清單裡的出貨 RPC 在 pg_proc 找不到 [$MISSING] ⇒ 名字漂了,這條查詢已恆空恆綠"
# 🔴 R1 F3:**間接寫入漏形** —— 出貨 RPC 呼叫一支「名字不含 pcm_b2_shipping」的 audit helper 時,
#    RPC 自己的 prosrc 沒有 admin_audit_log 字面、helper 也不掛在三表 trigger 上 ⇒ 兩條查詢雙空、絆線照綠。
#    而「補審計時抽一支 helper 出來共用」正是最常見的寫法 ⇒ 補**一跳呼叫圖**:
#    五支 RPC 的 prosrc 裡只要提到任何一個已知 audit writer 的名字,就算命中。
SHIP_AUD_Q="SELECT coalesce(pg_catalog.string_agg(DISTINCT p.proname,','),'') FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND (p.proname IN ($SHIP_FN_SET) OR p.proname LIKE 'pcm_b2_shipping%') AND (p.prosrc ~* 'admin_audit_log' OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc w JOIN pg_catalog.pg_namespace wn ON wn.oid=w.pronamespace WHERE wn.nspname='public' AND w.oid <> p.oid AND w.prosrc ~* '(insert\\s+into|update|delete\\s+from|merge\\s+into)\\s+(\"?public\"?\\.)?\"?admin_audit_log\"?' AND p.prosrc ~* ('\\m' || w.proname || '\\M')))"
SHIP_AUD_TG_Q="SELECT coalesce(pg_catalog.string_agg(t.tgname,','),'') FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid WHERE t.tgrelid IN ('public.shipments'::regclass,'public.shipment_items'::regclass,'public.pcm_b2_shipping_idempotency'::regclass) AND NOT t.tgisinternal AND p.prosrc ~* 'admin_audit_log'"
# 正控制:直接形(RPC 自己寫)與**間接形**(RPC 只呼叫 helper)各種一支,兩支都要被抓到。
DPC="$(QM "CREATE FUNCTION public.pcm_b2_shipping_probe_direct() RETURNS void LANGUAGE plpgsql AS \$p\$ BEGIN INSERT INTO public.admin_audit_log(actor,action,entity_type,entity_id) VALUES('p','p','p','p'); END \$p\$")"
case "$DPC" in *ERROR*) die "TRIPWIRE_SETUP_FAIL(direct): $DPC" ;; esac
IPC="$(QM "CREATE FUNCTION public.pcm_b2_shipping_probe_indirect() RETURNS void LANGUAGE plpgsql AS \$p\$ BEGIN PERFORM public.admin_append_order_note(NULL,NULL,NULL,NULL); END \$p\$")"
case "$IPC" in *ERROR*) die "TRIPWIRE_SETUP_FAIL(indirect): $IPC" ;; esac
PH="$(Q "$SHIP_AUD_Q")"
case "$PH" in *pcm_b2_shipping_probe_direct*) : ;; *) die "TRIPWIRE_DEAD(direct): 種了直接寫 audit 的假出貨函式卻抓不到(實得 [$PH])" ;; esac
case "$PH" in *pcm_b2_shipping_probe_indirect*) : ;; *) die "TRIPWIRE_DEAD(indirect): 種了「只呼叫 audit helper」的假出貨函式卻抓不到 ⇒ 一跳呼叫圖沒生效,R1 F3 的漏形還在(實得 [$PH])" ;; esac
# trigger 面也要有自己的正控制:掛一支會寫 audit 的 trigger 上去,證明那條查詢抓得到。
TPC="$(QM "CREATE FUNCTION public.pcm_b2_shipping_probe_tg() RETURNS trigger LANGUAGE plpgsql AS \$p\$ BEGIN INSERT INTO public.admin_audit_log(actor,action,entity_type,entity_id) VALUES('p','p','p','p'); RETURN NEW; END \$p\$; CREATE TRIGGER pcm_b2_probe_tg AFTER INSERT ON public.shipments FOR EACH ROW EXECUTE FUNCTION public.pcm_b2_shipping_probe_tg()")"
case "$TPC" in *ERROR*) die "TRIPWIRE_SETUP_FAIL(trigger): $TPC" ;; esac
case "$(Q "$SHIP_AUD_TG_Q")" in *pcm_b2_probe_tg*) : ;; *) die "TRIPWIRE_DEAD(trigger): 掛了會寫 audit 的假 trigger 卻抓不到 ⇒ 該條查詢恆空恆綠" ;; esac
Q "DROP TRIGGER pcm_b2_probe_tg ON public.shipments; DROP FUNCTION public.pcm_b2_shipping_probe_tg(); DROP FUNCTION public.pcm_b2_shipping_probe_direct(); DROP FUNCTION public.pcm_b2_shipping_probe_indirect()" >/dev/null
SHIP_AUD="$(Q "$SHIP_AUD_Q")"
SHIP_AUD_TG="$(Q "$SHIP_AUD_TG_Q")"
# 🔴 正控制②(計數面):實跑一支**真的會寫 audit 的產品 RPC**,證明本 cluster 的計數器會動。
#    沒有它,「出貨側零 audit」與「這個 harness 的 audit 整條是死的」分不開。
AUD_B="$(Q "SELECT pg_catalog.count(*)::text FROM public.admin_audit_log")"
SUPR="$(QM "SELECT public.admin_upsert_supplier(NULL,'W6c 正控制供應商',true,NULL,'sean',pg_catalog.gen_random_uuid()::text)")"
AUD_A="$(Q "SELECT pg_catalog.count(*)::text FROM public.admin_audit_log")"
case "$SUPR" in *ERROR*) die "AUDIT_POSCTL_FAIL: 正控制 RPC 自己就紅了 :: $SUPR" ;; esac
[ "$AUD_B" = "0" ] && [ "$AUD_A" = "1" ] || die "AUDIT_POSCTL_FAIL: 真 RPC 沒讓 audit 計數動($AUD_B -> $AUD_A)⇒ 計數面正控制不成立,絆線的「零」讀不出意義"
if [ -z "$SHIP_AUD" ] && [ -z "$SHIP_AUD_TG" ] && [ -n "$AUD_WRITERS" ]; then
  ok W6C-AUDIT-NOT-MEASURABLE "🔴 **D5 的「audit 增量凍結」今天量不到,故本檔不寫那一格**:出貨五支 + 冪等層 helper **零** audit 寫入、三張表上**零**審計 trigger,而同庫有 audit writer 十支($AUD_WRITERS)⇒ 首次成功的 audit 增量本來就是 0,「重放 Δ=0」對任何實作恆真、零判別力 ✓(🔴 **絆線**:有人替出貨線補上審計 ⇒ 本格轉 FAIL,**那時候 D5 要的凍結格才開始有意義、該補**。🔴 **四個正控制**當場跑過(R1 F2/F3 補的):全庫查詢面、出貨側**直接寫**形、出貨側**只呼叫 helper 的間接**形、三表 trigger 面各種一支假 writer 都被抓到;計數面=真 RPC 讓計數 $AUD_B→$AUD_A;另外五支 RPC 的名字**逐一驗過存在於 pg_proc**(改名即 die,不會靜默恆空)。🔴 **量到的範圍**=prosrc 四種 DML 形 + **一跳呼叫圖** + 三表的 trigger 函式,**看不到**:動態 SQL / BEGIN ATOMIC 的 prosqlbody / public 以外 schema / 應用層直接寫 audit / **兩跳以上的間接呼叫**)"
else
  bad W6C-AUDIT-NOT-MEASURABLE "出貨線的 audit 狀況變了:出貨側 writer=[$SHIP_AUD] 出貨側 trigger=[$SHIP_AUD_TG] 全庫 writer=[$AUD_WRITERS] ⇒ 若出貨側開始寫 audit,**D5 的增量凍結格現在要補上**"
fi

echo "══ 1. 序列同鍵重放:三表 Δ=0 + 信封逐鍵相同 ══════════════════"
C0="$(counts)"
R1="$(QM "$(MK S1)")"
ID1="$(shipid "$R1")"
[ -n "$ID1" ] || die "FIXTURE_FAIL(建箱沒回 shipment_id): $R1"

# 🔴🔴 R1 F1 的實質修法:**把 shipment_items 那一軸做成真的**。
#    首版該軸全程 0 ⇒ 「三表 Δ=0」有一軸恆 0 恆真(`feedback_fixture-value-makes-guard-vacuous` 同型)。
#    W3-2 其實**早就實作了**,首版只是沒建 order fixture ⇒ 這裡補齊,並把品項**真的掛進箱子**。
SUPP="$(Q "INSERT INTO public.suppliers(label) VALUES('W6c 供應商') RETURNING id")"
case "$SUPP" in ????????-*) : ;; *) die "FIXTURE_FAIL(suppliers): $SUPP" ;; esac
ORD="$(Q "SELECT pg_catalog.gen_random_uuid()")"
OI="$(Q "SELECT pg_catalog.gen_random_uuid()")"
PSNAP='{"title":"零件","sku":"S1","spec":{"color":"black"}}'
OC="$(QM "INSERT INTO public.orders(id,display_id,customer_user_id,shipping_address_snapshot,tier_at_checkout,subtotal,shipping_fee,total,shipping_method,invoice,shipping_method_at_checkout) VALUES('$ORD',public.pcm_generate_display_id(),'$CUST','$SNAP'::jsonb,(SELECT enumlabel::text::public.member_tier FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='member_tier' LIMIT 1),100,0,100,'home','{\"type\":\"personal\"}'::jsonb,'home') RETURNING 'ORDOK'::text")"
case "$OC" in *ORDOK*) : ;; *) die "FIXTURE_FAIL(orders): $OC" ;; esac
OIC="$(QM "INSERT INTO public.order_items(id,order_id,variant_sku,product_snapshot,quantity,unit_price,line_total) VALUES('$OI','$ORD','SKU-W6C','$PSNAP'::jsonb,3,10,30) RETURNING 'OIOK'::text")"
case "$OIC" in *OIOK*) : ;; *) die "FIXTURE_FAIL(order_items): $OIC" ;; esac
PID="$(Q "INSERT INTO public.order_item_procurement(order_item_id,allocated_quantity,supplier_id) VALUES('$OI',3,'$SUPP') RETURNING id")"
case "$PID" in ????????-*) : ;; *) die "FIXTURE_FAIL(procurement): $PID" ;; esac
# 到貨 3 件 ⇒ 摘要的 instock 才會 > 0,W3-2 的前緣(增量 ≤ instock − shipped − pending)才過得去。
RCV="$(QM "INSERT INTO public.order_item_procurement_receipts(procurement_id,quantity,received_at,received_by) VALUES('$PID',3,now(),'tester') RETURNING 'RECVOK'::text")"
case "$RCV" in *RECVOK*) : ;; *) die "FIXTURE_FAIL(receipt): $RCV" ;; esac
ADD="$(QM "SELECT public.admin_add_shipment_items('IT1','$ID1','[{\"order_item_id\":\"$OI\",\"quantity\":2}]'::jsonb)")"
case "$ADD" in *ERROR*) die "FIXTURE_FAIL(掛品項): $ADD" ;; esac
ITEMS="$(Q "SELECT pg_catalog.count(*)::text FROM public.shipment_items WHERE shipment_id='$ID1'")"
# 🔴 這道斷言是本修法的**看門狗**:哪天品項掛不進去(前緣改了、fixture 壞了),
#    這一軸會悄悄退回恆 0 恆真 ⇒ 讓它當場 die,而不是留一個「看起來三軸其實兩軸」的綠。
[ "$ITEMS" = "1" ] || die "FIXTURE_FAIL: 品項沒掛進箱子(shipment_items=$ITEMS)⇒ 那一軸會退回恆 0、Δ=0 變恆真"

C1="$(counts)"
R2="$(QM "$(MK S1)")"
C2="$(counts)"
ID2="$(shipid "$R2")"
ITEMS_NOW="$(printf '%s' "$C2" | cut -d/ -f2)"
if [ "$(first "$R1")" = "FIRST" ] && [ "$(first "$R2")" = "REPLAY" ] && [ "$ID1" = "$ID2" ] && [ "$C1" = "$C2" ] && [ "$ITEMS_NOW" -gt 0 ]; then
  ok W6C-SERIAL-DELTA-ZERO "🔴 同鍵序列兩發:第一發 idempotent=false、第二發 idempotent=true 且 **shipment_id 相同**($ID1),三表計數 $C1 → $C2 = **Δ=0**(建箱前 $C0)⇒ 重放不產生第二份產物 ✓ 🔴 **三軸都是活的**(R1 F1 修法):中間先用 admin_add_shipment_items 把品項真的掛進箱子 ⇒ Δ=0 是在 **shipment_items = $ITEMS_NOW(>0)** 的狀態下量的,那一軸**不是恆 0 恆真**;掉回 0 會被 fixture 看門狗當場 die"
else
  bad W6C-SERIAL-DELTA-ZERO "序列重放沒照預測:一發=[$(first "$R1")] 二發=[$(first "$R2")] id1=[$ID1] id2=[$ID2] 計數 $C1 → $C2 items=[$ITEMS_NOW]"
fi
# 🔴 W2 的 R1-F4 契約:首次成功與重放**逐鍵相同、只差 idempotent 旗標**。
#    只比 shipment_id 不夠 —— 兩邊都回對的 id、但 reference 少一個鍵,呼叫端一樣會壞。
ENVEQ="$(Q "SELECT (('$R1'::jsonb - 'idempotent') = ('$R2'::jsonb - 'idempotent'))::text")"
FLAGS="$(Q "SELECT (('$R1'::jsonb ->> 'idempotent') = 'false' AND ('$R2'::jsonb ->> 'idempotent') = 'true')::text")"
if [ "$ENVEQ" = "true" ] && [ "$FLAGS" = "true" ]; then
  ok W6C-RESPONSE-IDENTICAL "🔴 首次信封與重放信封**扣掉 idempotent 之後逐鍵完全相同**,而該旗標恰好 false → true ⇒ W2 的 R1-F4 契約(回傳形狀唯一產生處)在**建箱這條真路徑上**成立 ✓(🔴 只證 create_shipment 一支;W3-2/W3-3 落地要各自再證)"
else
  bad W6C-RESPONSE-IDENTICAL "信封不符契約:扣旗標後相等=[$ENVEQ] 旗標 false→true=[$FLAGS]"
fi

echo "══ 2. 🔴 真併發同鍵:恰一組產物 ═══════════════════════════════"
race() { # $1=代號 $2=冪等鍵 → 印 barrier 是否成立(1/0)
  local n="$1" k="$2" ctl barrier=0 _ x
  psql -X -h "$SOCK" -p $P -U postgres -d postgres -qtA \
    -c "SELECT pg_catalog.pg_advisory_lock(46); SELECT pg_catalog.pg_sleep(1.2); SELECT pg_catalog.pg_advisory_unlock(46);" >"$D/ctl.$n" 2>&1 &
  ctl=$!
  for _ in $(seq 1 40); do
    [ "$(Q "SELECT pg_catalog.count(*)::text FROM pg_catalog.pg_locks WHERE locktype='advisory' AND granted AND objid=46")" != "0" ] && break
    sleep 0.05
  done
  PGAPPNAME=w6c_a psql -X -v VERBOSITY=verbose -h "$SOCK" -p $P -U postgres -d postgres -qtA \
    -c "BEGIN; SELECT pg_catalog.pg_advisory_xact_lock_shared(46); $(MK "$k"); COMMIT;" >"$D/a.$n" 2>&1 &
  PGAPPNAME=w6c_b psql -X -v VERBOSITY=verbose -h "$SOCK" -p $P -U postgres -d postgres -qtA \
    -c "BEGIN; SELECT pg_catalog.pg_advisory_xact_lock_shared(46); $(MK "$k"); COMMIT;" >"$D/b.$n" 2>&1 &
  for _ in $(seq 1 60); do
    x="$(Q "SELECT pg_catalog.count(*)::text FROM pg_catalog.pg_locks l JOIN pg_catalog.pg_stat_activity a ON a.pid=l.pid WHERE l.locktype='advisory' AND NOT l.granted AND a.application_name IN ('w6c_a','w6c_b')")"
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
  CB="$(counts)"
  B="$(race "r$i" "R$i")"
  [ "$B" = "1" ] || BARRIER_BAD="$BARRIER_BAD r$i"
  OA="$(tr '\n' ' ' <"$D/a.r$i")"; OB="$(tr '\n' ' ' <"$D/b.r$i")"
  CA="$(counts)"
  SA="$(first "$OA")"; SB="$(first "$OB")"
  IA="$(shipid "$OA")"; IB="$(shipid "$OB")"
  # 🔴 「恰一組產物」要**同時**成立四件事,少一件就進 NOT_ONE(fail-closed):
  #    ①一邊 FIRST 一邊 REPLAY ②兩邊拿到**同一個** shipment_id
  #    ③shipments 這一輪只 +1 ④鍵表只 +1。只看①會漏掉「兩箱但回同一個 id」這種壞法。
  EXP="$(Q "SELECT ((SELECT pg_catalog.count(*) FROM public.shipments) = $(printf '%s' "$CB" | cut -d/ -f1) + 1
                AND (SELECT pg_catalog.count(*) FROM public.pcm_b2_shipping_idempotency) = $(printf '%s' "$CB" | cut -d/ -f3) + 1)::text")"
  case "$SA:$SB" in
    FIRST:REPLAY|REPLAY:FIRST)
      if [ -n "$IA" ] && [ "$IA" = "$IB" ] && [ "$EXP" = "true" ]; then WHO="$WHO r$i:$SA/$SB"
      else NOT_ONE="$NOT_ONE r$i(收場對但產物不對:ida=$IA idb=$IB 增量符合=$EXP 計數 $CB→$CA)"; fi ;;
    *) NOT_ONE="$NOT_ONE r$i(A=$SA/B=$SB 計數 $CB→$CA)" ;;
  esac
done
printf '  ——  各輪誰先誰後(敘述、非判定):%s\n' "$WHO"
if [ -z "$BARRIER_BAD" ]; then
  ok W6C-BARRIER "$ROUNDS 輪**每一輪**兩個 session 都真的卡在 barrier 46 上才被放行 ⇒ **同時放行**成立 ✓(🔴 本格只證這件事,不證兩者真的在冪等鍵上碰撞)"
else
  bad W6C-BARRIER "barrier 沒成立的輪次:$BARRIER_BAD"
fi
if [ -z "$NOT_ONE" ]; then
  ok W6C-CONCURRENT-EXACTLY-ONE "🔴 每一輪**恰一組產物**:一邊 idempotent=false、一邊 true、**兩邊回同一個 shipment_id**、且 shipments 與鍵表**各只 +1** ⇒ 同鍵並發被收斂成單一產物 ✓(🔴 輸的一方**不是失敗** —— 它拿到的是乾淨重放;這與 W6b-3 那種「一邊被擋死」的形狀不同族)"
else
  bad W6C-CONCURRENT-EXACTLY-ONE "有輪次不是恰一組產物:$NOT_ONE"
fi

echo "══ 3. 🔴🔴 突變發①:claim 的 23505 分派(兩層牆的第一層)════"
# 備份原件到實體表(psql 每個 -c 是新 session,temp table 留不住)。
Q "CREATE TABLE public.w6c_backup(k text PRIMARY KEY, v text)" >/dev/null
BK="$(QM "INSERT INTO public.w6c_backup(k,v) SELECT 'claim', pg_catalog.pg_get_functiondef('public.pcm_b2_shipping_idem_claim(text,text,text)'::regprocedure) RETURNING 'BKOK'::text")"
case "$BK" in *BKOK*) : ;; *) die "MUT_BACKUP_FAIL(claim): $BK" ;; esac
cat >"$D/mut1.sql" <<'MUT1'
DO $mut$
DECLARE d text; n int; L1 int; L2 int;
  a text := 'GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;';
BEGIN
  SELECT v INTO d FROM public.w6c_backup WHERE k = 'claim';
  L1 := pg_catalog.length(d);
  n := (L1 - pg_catalog.length(pg_catalog.replace(d, a, ''))) / pg_catalog.length(a);
  IF n <> 1 THEN RAISE EXCEPTION 'ANCHOR_COUNT=% (expect 1)', n; END IF;
  d := pg_catalog.replace(d, a, a || ' RETURN NULL;');
  L2 := pg_catalog.length(d);
  IF L2 = L1 THEN RAISE EXCEPTION 'MUT_NOOP'; END IF;
  EXECUTE d;
  RAISE NOTICE 'MUT1_OK anchor=% lendiff=%', n, L2 - L1;
END
$mut$;
MUT1
M1A="$(QF "$D/mut1.sql")"
case "$M1A" in *MUT1_OK*) : ;; *) die "MUT_APPLY_FAIL(claim 分派): $M1A" ;; esac
CB1="$(counts)"
# 🔴 R1 nit F5:突變輪的 barrier 旗標**不得丟掉**。丟掉的話,那一輪若退化成序列,
#    FAIL 訊息只會說「突變沒照預測」⇒「barrier 沒成立」與「判別力沒驗到」共用同一句結論(判準 #3)。
M1_BAR="$(race m1 M1)"
M1_A="$(tr '\n' ' ' <"$D/a.m1")"; M1_B="$(tr '\n' ' ' <"$D/b.m1")"
CA1="$(counts)"
# 🔴 誰贏誰輸由時序決定 ⇒ 兩側都可能是那個「硬錯」的一方,判定式要對稱。
# 🔴 R2 nit(我在 R2 回報裡宣稱寫了這句、實際沒落檔 —— 字面 vs 事實,補上):
#    下面抓的是 **constraint 名**,而 freeze trigger 同名之下有**兩個分支**(四欄凍結 / shipment_id 改指)
#    ⇒ 這個 grep **分不出**是哪一支在說話。本路徑只有「改指」可達(claim 回 NULL ⇒ record() 改指),
#    故結論不受影響;但要拿它去別條路徑歸因前,得先把分支分開。
M1_LOSER=""
case "$M1_A" in *pcm_b2_shipping_idem_freeze_identity*) M1_LOSER="A" ;; esac
case "$M1_B" in *pcm_b2_shipping_idem_freeze_identity*) M1_LOSER="$M1_LOSER B" ;; esac
M1_SHIPDELTA="$(Q "SELECT ((SELECT pg_catalog.count(*) FROM public.shipments) - $(printf '%s' "$CB1" | cut -d/ -f1))::text")"
if [ -n "$M1_LOSER" ] && [ "$M1_SHIPDELTA" = "1" ]; then
  ok TMUT-W6C-CLAIM-DISPATCH "🔴🔴 拆掉 claim 的 23505 分派(讓那條路回 NULL = 當成首次認領)⇒ 併發下輸的那一側($M1_LOSER)**不再拿到乾淨重放**,而是**硬錯在 W0b 的 pcm_b2_shipping_idem_freeze_identity**(shipment_id 一旦回填即不可改指)⇒ W6C-CONCURRENT-EXACTLY-ONE 那一格翻面、判別力歸屬成立 ✓ 🔴🔴 **但 shipments 仍只 +1($CB1 → $CA1)** ⇒ **§6a B4 說的「新建第二箱」作為持久結果是錯的**:它確實去建了,可是整筆被回滾。**單拆這一層造不出多出來的貨** —— 為什麼,下一格拆給你看"
else
  bad TMUT-W6C-CLAIM-DISPATCH "突變①沒照預測:輸家歸因=[$M1_LOSER] shipments 增量=[$M1_SHIPDELTA] 計數 $CB1 → $CA1 **barrier=[$M1_BAR]**(barrier=0 ⇒ 這一輪根本沒併發、不是判別力沒驗到,兩者不共用結論)"
fi

echo "══ 4. 🔴🔴 疊加消融:再拆第二層(freeze trigger)════════════"
# 🔴 這一格是**發①的歸屬腿**,不是第三發突變:它要回答的是
#    「擋住第二箱的到底是誰」—— 只有把第二層也拆掉、真的看到兩箱提交,
#    上一格「第一層倒了但貨沒多出來」才不是靠推論。
#    (`feedback_negative-test-observation-supplied-by-another-mechanism` 同型:
#      負測構造得出來,也要問那個觀察是不是別的機制提供的。)
# 🔴🔴 R1 F4:**還原前先把原始 tgenabled 存下來,不得事後拿一個手寫的字母去比。**
#    原始態是 `ENABLE ALWAYS`(`…w0b…sql:198`)= `tgenabled='A'`,而裸 `ENABLE TRIGGER` 只還原成
#    `'O'`(ORIGIN)⇒ `session_replication_role='replica'` 一句就能繞過,正是 W0b 立它時要防的東西
#    (`…w2…sql:568-570` 逐字)。首版還原成 'O' 又斷言 ='O',**「已還原」那句是假的**。
#    ⇒ 存原值、用 `ENABLE ALWAYS` 還原、拿**存下來的值**比對。
TGE_ORIG="$(Q "SELECT tgenabled::text FROM pg_catalog.pg_trigger WHERE tgrelid='public.pcm_b2_shipping_idempotency'::regclass AND tgname='pcm_b2_shipping_idem_block_identity_update'")"
[ "$TGE_ORIG" = "A" ] || die "UPSTREAM_DRIFT: freeze trigger 原始 tgenabled=[$TGE_ORIG],期望 'A'(ENABLE ALWAYS)⇒ 上游的 replica-mode 防護漂了,先查 W0b"
Q "ALTER TABLE public.pcm_b2_shipping_idempotency DISABLE TRIGGER pcm_b2_shipping_idem_block_identity_update" >/dev/null
[ "$(Q "SELECT tgenabled::text FROM pg_catalog.pg_trigger WHERE tgrelid='public.pcm_b2_shipping_idempotency'::regclass AND tgname='pcm_b2_shipping_idem_block_identity_update'")" = "D" ] \
  || die "MUT_APPLY_FAIL: freeze trigger 沒被停用 ⇒ 本格會拿一個沒生效的消融當證據"
CB2="$(counts)"
M2_BAR="$(race m2 M2)"
M2_A="$(tr '\n' ' ' <"$D/a.m2")"; M2_B="$(tr '\n' ' ' <"$D/b.m2")"
CA2="$(counts)"
M2_SHIPDELTA="$(Q "SELECT ((SELECT pg_catalog.count(*) FROM public.shipments) - $(printf '%s' "$CB2" | cut -d/ -f1))::text")"
M2_IDEMDELTA="$(Q "SELECT ((SELECT pg_catalog.count(*) FROM public.pcm_b2_shipping_idempotency) - $(printf '%s' "$CB2" | cut -d/ -f3))::text")"
M2_IA="$(shipid "$M2_A")"; M2_IB="$(shipid "$M2_B")"
M2_KEYPTR="$(Q "SELECT coalesce(shipment_id::text,'NULL') FROM public.pcm_b2_shipping_idempotency WHERE action='create_shipment' AND idempotency_key='M2'")"
# 孤兒 = 這一輪兩個 session 各自建的箱裡,鍵列**沒有**指到的那一個。
M2_ORPHAN=""
if [ -n "$M2_IA" ] && [ "$M2_IA" != "$M2_KEYPTR" ]; then M2_ORPHAN="$M2_IA"; fi
if [ -n "$M2_IB" ] && [ "$M2_IB" != "$M2_KEYPTR" ]; then M2_ORPHAN="$M2_ORPHAN $M2_IB"; fi
if [ "$(first "$M2_A")" = "FIRST" ] && [ "$(first "$M2_B")" = "FIRST" ] && [ "$M2_SHIPDELTA" = "2" ] && [ "$M2_IDEMDELTA" = "1" ] && [ -n "$M2_ORPHAN" ]; then
  ok TMUT-W6C-CLAIM-PLUS-FREEZE "🔴🔴 **兩層都拆**(claim 分派 + freeze trigger)⇒ **兩個 session 都回 idempotent=false、兩箱都提交**:shipments **+$M2_SHIPDELTA**、鍵表只 **+$M2_IDEMDELTA**($CB2 → $CA2),而那把鍵只指到 **$M2_KEYPTR** ⇒ 另一箱 **$M2_ORPHAN 成為孤兒**(客人收到兩件,重放紀錄只認得一件)✓ 🔴 **歸屬釘死**:擋住重複貨的是**兩層**,第一層=claim 的 23505 分派、第二層=W0b 的 freeze trigger;上一格「貨沒多出來」是**第二層接住的**,不是第一層不重要。🔴 與 W6b-3 的 C7 **正好相反**(那一軸沒有第二層)"
else
  bad TMUT-W6C-CLAIM-PLUS-FREEZE "疊加消融沒照預測:A=[$(first "$M2_A")] B=[$(first "$M2_B")] ship增量=[$M2_SHIPDELTA] 鍵表增量=[$M2_IDEMDELTA] 鍵指向=[$M2_KEYPTR] 孤兒=[$M2_ORPHAN] **barrier=[$M2_BAR]**"
fi
# 還原兩層。🔴 名字對不等於定義對(w6b3 R3 N3)⇒ 用 functiondef 與備份逐字比對,不靠肉眼。
Q "ALTER TABLE public.pcm_b2_shipping_idempotency ENABLE ALWAYS TRIGGER pcm_b2_shipping_idem_block_identity_update" >/dev/null
TGE_NOW="$(Q "SELECT tgenabled::text FROM pg_catalog.pg_trigger WHERE tgrelid='public.pcm_b2_shipping_idempotency'::regclass AND tgname='pcm_b2_shipping_idem_block_identity_update'")"
[ "$TGE_NOW" = "$TGE_ORIG" ] \
  || die "RESTORE_FAIL: freeze trigger 還原成 [$TGE_NOW],與原始 [$TGE_ORIG] 不同(裸 ENABLE 只會回到 'O'=replica mode 繞得過)"
RC1="$(QM "DO \$r\$ BEGIN EXECUTE (SELECT v FROM public.w6c_backup WHERE k='claim'); END \$r\$")"
case "$RC1" in *ERROR*) die "RESTORE_FAIL(claim): $RC1" ;; esac
[ "$(Q "SELECT (pg_catalog.pg_get_functiondef('public.pcm_b2_shipping_idem_claim(text,text,text)'::regprocedure) = (SELECT v FROM public.w6c_backup WHERE k='claim'))::text")" = "true" ] \
  || die "RESTORE_FAIL: claim 的定義與備份不同"
echo "  ——  兩層已還原(freeze trigger tgenabled 回到原始 [$TGE_ORIG]=ENABLE ALWAYS、claim 定義與備份逐字相同)✓"

echo "══ 5. 🔴 突變發②:建箱迴圈的 23505 分派(守的是另一件事)════"
# 🔴 與發①**不同族**:發①打的是「重複請求 → 重複產物」;本發打的是**錯誤歸因**——
#    分派沒了,一個誠實的 `shipments_pkey` 撞號會被**誤診**成「單號空間用光」。
#    🔴 `pkey` 面在正式路徑上不可達(id 走 gen_random_uuid)⇒ 本檔把 default 暫時釘成定值
#      才讓它可構造。這證的是「分派會不會分辨」,**不是**「pkey 撞號會發生」。
BK2="$(QM "INSERT INTO public.w6c_backup(k,v) SELECT 'mkship', pg_catalog.pg_get_functiondef('public.admin_create_shipment(text,uuid,jsonb,text,text)'::regprocedure) RETURNING 'BKOK'::text")"
case "$BK2" in *BKOK*) : ;; *) die "MUT_BACKUP_FAIL(mkship): $BK2" ;; esac
BK3="$(QM "INSERT INTO public.w6c_backup(k,v) SELECT 'iddef', pg_catalog.pg_get_expr(d.adbin,d.adrelid) FROM pg_catalog.pg_attrdef d JOIN pg_catalog.pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum WHERE d.adrelid='public.shipments'::regclass AND a.attname='id' RETURNING 'BKOK'::text")"
case "$BK3" in *BKOK*) : ;; *) die "MUT_BACKUP_FAIL(iddef): $BK3" ;; esac
FIXID='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
Q "ALTER TABLE public.shipments ALTER COLUMN id SET DEFAULT '$FIXID'::uuid" >/dev/null
# 基線:分派**還在**時,pkey 撞號應該原封拋回 raw 23505 + shipments_pkey。
P1="$(QM "$(MK PK1)")"
P2="$(QM "$(MK PK2)")"
BASE_OK=NO
case "$P2" in *23505*) case "$P2" in *shipments_pkey*) BASE_OK=YES ;; esac ;; esac
[ "$(first "$P1")" = "FIRST" ] && [ "$BASE_OK" = "YES" ] || die "MUT2_BASELINE_FAIL: 基線就不對(一發=[$(first "$P1")] 二發=[$P2])⇒ pkey 面沒被構造出來,本格的翻面沒有對象"
cat >"$D/mut2.sql" <<'MUT2'
DO $mut$
DECLARE d text; n int; L1 int; L2 int;
  a text := 'IF v_con IS DISTINCT FROM ''shipments_reference_unique'' THEN';
BEGIN
  SELECT v INTO d FROM public.w6c_backup WHERE k = 'mkship';
  L1 := pg_catalog.length(d);
  n := (L1 - pg_catalog.length(pg_catalog.replace(d, a, ''))) / pg_catalog.length(a);
  IF n <> 1 THEN RAISE EXCEPTION 'ANCHOR_COUNT=% (expect 1)', n; END IF;
  d := pg_catalog.replace(d, a, 'IF false THEN');
  L2 := pg_catalog.length(d);
  IF L2 = L1 THEN RAISE EXCEPTION 'MUT_NOOP'; END IF;
  EXECUTE d;
  RAISE NOTICE 'MUT2_OK anchor=% lendiff=%', n, L1 - L2;
END
$mut$;
MUT2
M2A="$(QF "$D/mut2.sql")"
case "$M2A" in *MUT2_OK*) : ;; *) die "MUT_APPLY_FAIL(建箱迴圈分派): $M2A" ;; esac
P3="$(QM "$(MK PK3)")"
MUT_OK=NO
case "$P3" in *P2B21*) case "$P3" in *pcm_b2_w3a_reference_exhausted*) MUT_OK=YES ;; esac ;; esac
if [ "$MUT_OK" = "YES" ]; then
  ok TMUT-W6C-BUILD-LOOP-DISPATCH "🔴 拆掉建箱迴圈的 23505 分派 ⇒ 同一個 shipments_pkey 撞號從**誠實的 raw 23505 + shipments_pkey 原封拋回**,變成重試 5 圈後的 **P2B21 / pcm_b2_w3a_reference_exhausted「連續 5 次都撞到重複的包裹單號」** = **誤診**:怪到單號空間頭上,而真因是 uuid 來源 ⇒ 這條分派守的是**錯誤歸因**,與發①的「重複請求→重複產物」**不同族** ✓(🔴 第三面 shipments_hct_request_id_key 建箱不寫該欄、**本檔未構造**,分派對它的正確性沒被驗證)"
else
  bad TMUT-W6C-BUILD-LOOP-DISPATCH "突變②沒翻面:基線=[$BASE_OK] 突變後=[$P3] ⇒ **本靶未觸發**,分派的判別力這次沒被驗證"
fi
# 還原:函式定義 + id default 都逐字比對回備份值。
RC2="$(QM "DO \$r\$ BEGIN EXECUTE (SELECT v FROM public.w6c_backup WHERE k='mkship'); END \$r\$")"
case "$RC2" in *ERROR*) die "RESTORE_FAIL(mkship): $RC2" ;; esac
[ "$(Q "SELECT (pg_catalog.pg_get_functiondef('public.admin_create_shipment(text,uuid,jsonb,text,text)'::regprocedure) = (SELECT v FROM public.w6c_backup WHERE k='mkship'))::text")" = "true" ] \
  || die "RESTORE_FAIL: 建箱 writer 的定義與備份不同"
RC3="$(QM "DO \$r\$ BEGIN EXECUTE 'ALTER TABLE public.shipments ALTER COLUMN id SET DEFAULT ' || (SELECT v FROM public.w6c_backup WHERE k='iddef'); END \$r\$")"
case "$RC3" in *ERROR*) die "RESTORE_FAIL(iddef): $RC3" ;; esac
[ "$(Q "SELECT (pg_catalog.pg_get_expr(d.adbin,d.adrelid) = (SELECT v FROM public.w6c_backup WHERE k='iddef'))::text FROM pg_catalog.pg_attrdef d JOIN pg_catalog.pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum WHERE d.adrelid='public.shipments'::regclass AND a.attname='id'")" = "true" ] \
  || die "RESTORE_FAIL: shipments.id 的 default 與備份不同"
Q "DROP TABLE public.w6c_backup" >/dev/null
echo "  ——  建箱 writer 與 shipments.id default 已還原(逐字比對備份)✓"

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
KEYS_FROZEN="TMUT-W6C-BUILD-LOOP-DISPATCH TMUT-W6C-CLAIM-DISPATCH TMUT-W6C-CLAIM-PLUS-FREEZE W6C-AUDIT-NOT-MEASURABLE W6C-BARRIER W6C-CONCURRENT-EXACTLY-ONE W6C-REPLAY W6C-RESPONSE-IDENTICAL W6C-SERIAL-DELTA-ZERO"
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
