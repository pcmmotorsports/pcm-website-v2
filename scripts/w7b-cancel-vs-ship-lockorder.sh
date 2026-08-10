#!/usr/bin/env bash
#
# W7b · **交棒 6 清償:`admin_cancel_order`(A8a2)× 出貨側重算 的跨函式取鎖序**
#
# 用法:scripts/w7b-cancel-vs-ship-lockorder.sh   (自建拋棄式 cluster、跑完自動 teardown)
# 真權威:plan `:707` R3-**D4** + 主視窗 `B-293-STOP` ⑦ / `B-213-A` ②
# 編排骨架:照 `w6b1`/`w6b2`/`w6b3`/`w6c`(advisory barrier、零 FIFO、有界輪詢、`mkround`)
#
# ══ 🔴🔴 這是**行為格**,不是結構錨 —— plan `:434` 的舊列已作廢 ═══════════
#   `plan:434`(§2 W7b 列)寫「a8a2 已釘 `ORDER BY oi.id` ⇒ **補一格**斷言取鎖序、20 分」。
#   `plan:707`(R3 **D4**)**已推翻它**:再補一格 `position('ORDER BY oi.id')` = **第二個恆真錨**。
#   🔴 實錘:a8a2 檔內**已經有三個** `ORDER BY` 結構錨(`…a8a2…sql:576-578`)
#      ⇒ 第四個純粹恆真。**本檔一格 position() 都不寫**,全部是真併發的行為觀察。
#   🔴🔴 **但 D4 的理由只對取消側成立,不得轉移到出貨側**(R3 換模型審查 must-fix-3):
#      那三個錨在 **a8a2**;**出貨側 `s2b` 全檔 `position(` 命中 = 0**(實查)⇒ 出貨側的排序契約
#      在**部署面零守門**,唯一守門就是這支**手動跑**、且 `LINE_TIP` 一到下一支 migration
#      就自我停用的 harness。`b2s2b-verify.sh:1762` 逐字:「它現在**沒有靶**」。
#      ⇒ 本檔**不替出貨側的部署面背書**;那個缺口據實記在這裡,不在本片修。
#   交棒 6 逐字(`plan:72`):「A8a2 多品項取消的 `order_items` 取鎖順序**未驗** ⇒ 與本片出貨重算
#   仍可能 `40P01`」——「未驗」要的是**驗**,不是再抄一次字串。
#
# ══ 被測的那一對(兩側都實查行號)══════════════════════════════
#   · 取消側 `admin_cancel_order`(A8a2):步3 `orders FOR UPDATE`(`…a8a2…sql:190`)
#     → 步8 `PERFORM 1 FROM public.order_items oi WHERE oi.order_id = p_order_id
#            ORDER BY oi.id FOR NO KEY UPDATE`(`…a8a2…sql:367-370`)= **一句鎖全單品項、升冪**。
#   · 出貨側 `admin_mark_shipment_shipped`(W3-3)`UPDATE public.shipments`(`…w3c3…sql:180-184`)
#     → CONSTRAINT TRIGGER `shipments_summary_recompute_ac`(`…s2b…sql:361-365`)
#     → `pcm_a4a_shipments_summary_recompute` 迴圈 `ORDER BY si.order_item_id`(`…s2b…sql:338-345`)
#     → 每圈 `pcm_a4a_recompute_order_item_summary` 各鎖一列 `FOR NO KEY UPDATE`(`…s2b…sql:195-198`)
#       = **一列一列鎖、升冪**。
#   ⇒ 不變量 = **兩側都依 `order_items.id` 升冪取鎖**。本檔證的就是這件事**有承重**:
#     兩側同向 ⇒ 後到的那個**等**;任一側反向 ⇒ **真 40P01**。
#   🔴 兩側的取鎖**形狀不同**(一句 vs 一列一列),這正是「同一個結構錨看起來對、行為未必對」
#      的來源 —— 也是為什麼 `position()` 那格答不了交棒 6。
#
# ══ 🔴 barrier 升級:advisory 只證「同時放行」,**證不到危險區重疊** ═══════
#   `w6b3` 自己寫過這條限制(該檔 `W6B3-BARRIER` 逐字「本格只證這件事,不證危險區重疊」)。
#   本檔實測到那條限制**會咬人**:只掛 advisory barrier 時,出貨側那一發突變
#   **4 輪只有 2 輪**構造得出 40P01(探針實跑)—— 兩側同時**開跑**,但不保證同時**進到取鎖相位**。
#   ⇒ 本檔在 advisory barrier 之上再加一道**列鎖 rendezvous**:
#     gate session 先把**兩列 `order_items` 都鎖住**,等到**觀察到兩側都停在鎖上、且等待鏈源頭是 gate**
#     (`pg_blocking_pids`)才放行 ⇒ 兩側必定各自停在自己的**第一把鎖**上,放行後**極可能**互相要對方手上的那一把(不是必然,見下段門檻)。
#   🔴 **判準不是「兩側都被 gate 直接擋住」**(首版這樣寫、實測從不成立,gate 因此壓滿 10s、
#      兩側雙雙 `lock_timeout` 死掉:取消側 raw `55P03`、出貨側被轉譯層吃成 `P2B29`)。
#      PG 的列鎖排隊是**鏈狀**的,實測快照逐字:
#        `w7b_ship   | Lock | transactionid | blocked by {gate}`
#        `w7b_cancel | Lock | tuple         | blocked by {w7b_ship}`
#      基線兩側都先要**同一列** ⇒ 只有先到的那個直接等 gate,後到的等**先到那一方**的 tuple 鎖;
#      突變輪則相反(兩側各要不同的第一列)⇒ 兩側都直接被 gate 擋。**兩種形狀判準都要認**,
#      故判準 = 「兩側都被擋 ∧ gate 在阻擋者集合裡」。
#   🔴 這不是「讓測試比較容易過」——方向相反:它把突變的命中率**拉高**(逐次數字見下段
#      「突變門檻」),基線的「零 40P01」因此才是在**危險區真的重疊**之下量到的,而不是兩側剛好錯開。
#
# ══ 🔴🔴 突變門檻是「**至少一輪**」,不是「每輪」—— 這是機制,不是放水 ═══
#   🔴 實測命中率**逐次記在這裡**(本檔跑出來的,不是估的;它會浮動正是設門檻的理由):
#     · 出貨側那一發:**2/4**(只有 advisory barrier)→ **2/3**(加了 rendezvous)→ **5/5** → **4/5** → **4/5** → **5/5** → **5/5**
#     · 取消側那一發:**4/4**(探針)→ **3/3** → **5/5** → **4/5** → **3/5** → **5/5** → **5/5**
#     ⇒ 同一份 code、同一台機器,**兩發都觀察到過沒成環的輪次**。
#       把門檻寫成「每輪必紅」的那一版,當場就紅給我看過(出貨側 `2/3` 那次);
#       之後取消側也出現 `4/5` ⇒ **不是出貨側特有的毛病**,是下面這個機制的共同後果。
#   為什麼**兩發都**做不到每輪:成環需要**兩側各自先拿到對方要的那一把**,那是個時序窗口,
#   而窗口大小由兩側的取鎖形狀決定 —— **兩側形狀不對稱**(與哪一側被突變無關):
#     · 取消側在**一句** SQL 內取兩列(`ORDER BY oi.id FOR NO KEY UPDATE`)。
#       🔴 **不是原子**(R1 審查 consider-2 更正我原本的錯誤字面):PG 的 `LockRows` 節點
#       仍是**逐列**取鎖的。真正的差別是**中間沒有 client round-trip、沒有 trigger 工作**
#       ⇒ 兩把鎖之間的空隙**極小但非零**,對手要插進來的機率低。
#     · 出貨側是**一列一列**鎖(trigger 迴圈每圈呼叫 helper 各鎖一列,中間隔著整個 helper 本體)
#       ⇒ 空隙大得多。
#     ⇒ 收場只有兩種:成環、或**沒成環而兩側都成功**。後者最可能是取消側先跑完取鎖段,
#       但**也可能**是出貨側整筆先完成 —— 🔴 本檔**沒有量到底是哪一種**,
#       CLEAN 那一欄是「沒成環」的**觀察**,附帶的成因說明是**推論、不是量測**,不得當證據引用。
#     ⇒ 「沒成環的輪次」在兩發突變上都會出現,它**不是**突變沒套上的訊號
#       (突變真的沒套上會走 `MUT_APPLY_FAIL` die,不會走到這裡)。
#   ⇒ gate 放行後的喚醒競賽由 PG 決定,**沒有不靠 FIFO 假設就能釘死它的做法**(本線紀律禁 FIFO 假設)。
#   ⇒ 門檻寫成「**≥1 輪成環,且沒有任何一輪落在無法解釋的收場**」:
#     ①成環(恰一側 40P01、另一側成功)②**沒成環而兩側都成功**(成因未量測,見上)
#     這兩種**都是**取鎖序反向下的合法收場;**其餘任何形狀**(lock_timeout 55P03 / 轉譯後的 P2B29 /
#     兩側都紅 / 歸因不到 40P01)一律進 `BAD` 轉 FAIL。
#   🔴 **有一種紅的成因是機器速度、不是被測物**(R3 nit-8,誠實列出):rendezvous 迴圈最多 100 次、
#     每次至少 spawn 一個 psql(~30ms)+ `sleep 0.02` ⇒ 最壞逼近 5s;而兩側的 `lock_timeout` 就是 **5s**。
#     **很慢或很忙的機器**上會先撞 55P03 / 轉譯後的 P2B29 ⇒ 落 `BAD` 轉 FAIL。
#     這是 fail-closed(不會假綠),但看到這種紅**先查機器與負載**,別直接判被測物壞了。
#   🔴 **而且門檻不只看收場**:該相位的 `barrier` 與 `rendezvous` 也要全數成立才准綠
#      (R1 must-fix-2:原版只在 §1 結尾判基線那幾輪,突變輪的 RDV/BARRIER 累積後沒人讀
#       ⇒ rendezvous 失效而兩側都成功的輪次會被靜默當成合法 CLEAN)。
#   🔴 把門檻寫成「每輪必紅」= 造一個**會隨機變紅的守門**,那是假訊號不是嚴格;
#      判別力該比的是**基線 0/4 vs 突變 ≥1**,不是要求突變達成它機制上做不到的事。
#   🔴 gate 的放行signal**不走 FIFO**(本線紀律):走 `w7b_signal` 表 + plpgsql 有界輪詢
#      (READ COMMITTED 下 plpgsql 逐句取新 snapshot ⇒ 看得到別的交易剛提交的列)。
#   🔴 rendezvous **沒成立的輪次不當作綠**:落 `RDV_BAD` 轉 FAIL(fail-closed),
#      不會出現「因為沒真的重疊所以沒死鎖」被讀成「取鎖序有效」。
#
# ══ 🔴🔴 被移除的那一格(R1 跨模型審查打掉、實測證實審查是對的)══════════
#   原本有第 10 格 `W7B-OVERLAP-CONTENTION`(移除前 EXPECT_TOTAL=10),想證「序列化是**鎖**造成的、不是兩個交易剛好錯開」,
#   做法是觀察「一側的 blocker 就是另一側」(而非 gate)。**兩個問題,審查各中一條:**
#   ① 我把這個觀察**同時在 rendezvous 迴圈裡計**(放行**前**)。基線的等待鏈本來就是
#      `cancel ← ship ← gate` ⇒ rendezvous 一成立、這個觀察**必然**成立
#      ⇒ 它被 RENDEZVOUS **蘊含**,是同一個事實數兩次,而格訊息卻寫著「gate 放行**之後**」= 字面 vs 事實。
#   ② 照審查修法把它**只在放行後**計 ⇒ **基線 4/4 輪全部量不到**(實跑)。原因不是不成立,是
#      **窗口太短**:gate 一走,贏家只剩下收尾與 COMMIT(本機裸 PG 只有幾 ms),
#      而本檔每次取樣都要 spawn 一個 psql(~30ms)⇒ 取樣頻率追不上被觀察的現象。
#   ⇒ 兩條路都不通:放行前 = 恆真的重複格;放行後 = 量不到。**移除,不留半格。**
#   🔴 它想證的事**沒有掉在地上**,由兩個仍在的證據面承接:
#     · `W7B-RENDEZVOUS`:兩側同時停在**同一組 order_items 列鎖**上 = 它們確實搶同一批資源;
#     · 兩發突變:只把一句 `ORDER BY` 反向就構造得出真 40P01 —— **死鎖本身就是「兩側都真的
#       各持一把、又都要對方那一把」的證明**,兩個交易沒碰到彼此是不可能成環的。
#   🔴 據實記在這裡而不是默默刪掉:這一格曾經是綠的,而它綠的理由是錯的。
#
# ══ 🔴 消融(歸屬腿;照 W6c 的疊加法紀律:靶不得只打家族的一個成員)════
#   不變量是「**兩側同向**」⇒ 家族有**兩個**成員,兩發都要打:
#     ① `TMUT-W7B-CANCEL-ORDER`:把 **a8a2 步8** 的 `ORDER BY oi.id` 改成 `DESC`
#     ② `TMUT-W7B-SHIP-ORDER`  :把 **出貨 trigger 函式**的 `ORDER BY si.order_item_id` 改成 `DESC`
#   兩發**各自**都該讓基線那一族翻面(零死鎖 → 真死鎖)。只打一發 = 只證「有個東西承重」,
#   證不到「a8a2 那一句自己承重」——而交棒 6 問的正是 a8a2 那一句。
#   🔴 突變用 `pg_get_functiondef` 取原文 → `perl` 定點換 → `CREATE OR REPLACE` 套回;
#      **換不到就 die**(`or die NO_SUB`),不接受「換了 0 處也繼續跑」的假綠。
#   🔴 還原**比對存值**(W6c F4 的教訓:「已還原」那句必須有證據,不能只看名字還在):
#      突變前把兩支的 functiondef 存進 `w7b_backup`,還原後逐字比對。
#
# ══ 🔴 誠實邊界 ════════════════════════════════════════════════
#   · 本檔量到的是**這個形狀**:1 張訂單 / 2 個品項 / 1 個包裹同時含這 2 個品項 / 各 1 件。
#     **沒跑到**:3 個以上品項、跨訂單、多包裹同時出貨、取消×取消、出貨×出貨、
#     `admin_add_shipment_items`(W4b 那條**自己帶 40P01 重試**、是另一族)、整單取消路徑
#     (`p_items` NULL)、以及**作廢/復原**兩支 writer 的取鎖序。全部不在本檔帳上。
#   · 🔴 「零 40P01」是**在跑過的輪數上**的觀察,不是證明。它的判別力**全部來自兩發突變**:
#     同樣的 fixture、同樣的 rendezvous,只把一句 `ORDER BY` 反向 ⇒ 就構造得出真 40P01
#     (基線 **0/4** vs 突變**至少一輪成環**)⇒ 基線的綠不是恆真。
#   · 🔴 危險面**只在未付款單**上可達(`…a8a2…sql:359-364` 步7 允許集合)。已付款的單
#     連取消 RPC 都進不去 ⇒ 不得讀成「所有訂單都會中」。
#   · 🔴 fixture 的數值不是隨便挑的(本線踩過「fixture 值讓被測面不可達」的老坑):
#     quantity 3 / 到貨 1 / 出貨 1 / 取消 1 ⇒ 取消前緣 1 ≤ 3−1−0 過、C9 `shipped ≤ instock` 1 ≤ 1 過、
#     `cancelled+shipped` 2 ≤ 3 過、C7 `instock+cancelled` 2 ≤ 3 過 ⇒ **兩側都過得了前緣**,
#     兩邊都成功才是預期收場 ⇒ 「恰一個成功」那種前緣互斥**不會**冒充成取鎖序的功勞。
#   · 🔴 本檔跑在**裸 PG,不是 Supabase**,與正式庫零連線,**不可用於診斷正式庫**。
#     RLS / GRANT / PostgREST / 既有資料量全部不在量測範圍。
#   · 🔴🔴 **交棒 6 只清償了一半 —— 第二道防線兩側都不存在**(R3 換模型審查 must-fix-4)。
#     同線契約逐字(`…w3b2…sql` 檔頭):「`40P01` 重試是**第二道**:排序對了就不該發生;
#     它防的是『**別的路徑沒照排序**』」。但被測的這一對**兩支都沒有那一道**(實查):
#       · `admin_mark_shipment_shipped` 的 handler 只 catch
#         `check_violation OR unique_violation OR lock_not_available OR raise_exception`
#         (`…w3c3…sql:191-192`)⇒ **不含 `deadlock_detected`**(全檔 `deadlock_detected` 命中 = 0);
#       · `admin_cancel_order` **零 handler**(`…a8a2…sql:567` 明文禁 `WHEN OTHERS`)。
#     ⇒ 真的出 40P01 時:**裸噴、無人話、無重試**,員工看到的是 raw 40P01。
#     🔴 **本檔全綠反而會讓這個缺口更不可見** ——「排序對了」只擋得住**本檔測過的這一對**,
#       擋不住任何「別的路徑沒照排序」。這一條**不在本片修**(要動 writer 的 handler = 另一片),
#       據實記在這裡並帶進 STOP。
#   · 🔴 **`orders × order_items` 那一軸完全沒被本檔施壓**(R3 nit-5):取消側的**第一把鎖**是
#     `orders FOR UPDATE`(`…a8a2…sql:190`),而出貨側**全檔零 `orders` 命中** ⇒ 兩側在 orders 上
#     沒有交集,本檔構造不出那一軸。**同族已有實錘**:`…a8c1…sql:25` 記載 genesis × begin
#     的真 40P01(單方 victim)。任何「先鎖 `order_items` 再寫 orders 子表」的 writer 都可能與
#     a8a2 成環 —— **是否真存在這種 writer:未確認**(本檔沒逐一走過那些子表的 writer)。
#   · 🔴 **本系統的既定口徑是「40P01 可以存在」**:`…a4a…sql:69-75` 已記三個**未關**的死結環
#     (環③ 逐字「排序關不掉…誠實列界」)⇒ 本檔的綠**只覆蓋這一對**,
#     **不得**讀成「出貨線無死鎖」,那三個環仍開著。
#
# ══ 🔴 判準四句(承自 w0b/w1/w2/w3*/w5/w6a/w6b*/w6c)══════════════
#   🔴 消融必須由紅轉綠(此處是綠轉紅),否則判別力歸屬錯。
#   🔴 全綠的消融也可能恆真,隔離守門自己要有靶。
#   🔴 「我的 SQL 寫壞了」不得與「被別的守門擋住」共用同一句結論。
#   🔴 家族格的靶不得只打一個成員。
#
# 🔴 **格數全綠證的是「寫下的守門有判別力」,證不了「該有的守門都想到了」。**
set -u
export LC_ALL=C LANG=C
REPO="$(cd "$(dirname "$0")/.." && pwd)"
# 🔴 54426 → 54427(2026-08-08 trap 掃掠一併修):原本與 `w6c-idem-replay.sh:94` **預設埠相同**。
#    `record all` 是序列跑所以現在不咬人,但兩支並排跑就撞、症狀是後起的那支 START_FAIL。
#    全線預設埠逐支查過(54329/54375/54383/54393/54395/54397/54399/54401-54403/54407/54409/54411/54421/54422/54425),54427 未被佔用。
D="${W7BDB:-/tmp/w7bdb}"; SOCK="${W7BSOCK:-/tmp/w7bsk}"; P="${W7BPORT:-54427}"
PASS=0; FAIL=0; KEYS=""
EXPECT_TOTAL=9    # 🔴 量出來的(R1 移除 OVERLAP-CONTENTION 後由 10 降為 9)。全綠時 PASS = 9 + CELL-ACCOUNT + CELL-KEYSET = 11。
BASE_ROUNDS=6; MUT_ROUNDS=5   # 🔴 基線輪數**不得少於**消融輪數(R3 nit-7):不准假綠的是基線,它的樣本反而更該厚
ok()  { PASS=$((PASS+1)); KEYS="$KEYS $1"; printf '  PASS %-30s %s\n' "$1" "$2"; }
bad() { FAIL=$((FAIL+1)); KEYS="$KEYS $1"; printf '  FAIL %-30s %s\n' "$1" "$2"; }

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

# 🔴 **第八個釘值檔**(b2s2b / w5 / w6a / w6b1 / w6b2 / w6b3 / w6c / 本檔)—— 新片落檔要**同批重釘八個**。
#    🔴 本片**無新 migration** ⇒ 其餘七個零改動(已逐一實查字面:六支寫 `LINE_TIP=`、
#       `b2s2b-verify.sh:351` 是行內字面,八個同值)。
#    🔴 `w4b-verify.sh` 用 `PREFIX_TS` 前綴錨、逐字寫明「不再對目錄尾端有意見」⇒ **不在這八個之內**。
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
LINE_TIP="20260811010000"  # 2026-08-11 重釘 20260810233000->20260811010000(#352 甲片 品項層額度守門落檔;前次為 #352-a2 兩支 writer RPC 落檔;取號由主視窗集中發、落筆當下實查目錄尾端,守門=w7-coverage.sh 的 MIG-PREFIX-UNIQ)
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
# 🔴 上游四件**逐一**驗:兩支 writer + trigger + helper。少任一件,本檔量的就不是那一對。
CANCEL_SIG='public.admin_cancel_order(uuid,uuid,text,text,text,jsonb)'
SHIPFN_SIG='public.pcm_a4a_shipments_summary_recompute()'
[ "$(Q "SELECT (pg_catalog.to_regprocedure('$CANCEL_SIG') IS NOT NULL
             AND pg_catalog.to_regprocedure('public.admin_mark_shipment_shipped(text,uuid,text)') IS NOT NULL
             AND pg_catalog.to_regprocedure('$SHIPFN_SIG') IS NOT NULL
             AND pg_catalog.to_regprocedure('public.pcm_a4a_recompute_order_item_summary(uuid)') IS NOT NULL)::text")" = "true" ] \
  || die "UPSTREAM_MISSING: 取消(六參)/ 出貨 / 重算 trigger 函式 / A4a helper 任一不在"
# 🔴 trigger **接線**也要驗:函式在但沒掛在 shipments 上,出貨側根本不會取 order_items 的鎖
#    ⇒ 基線恆綠、突變也恆綠(整族失去判別力)。
[ "$(Q "SELECT pg_catalog.count(*)::text FROM pg_catalog.pg_trigger t
         WHERE t.tgrelid='public.shipments'::regclass AND t.tgname='shipments_summary_recompute_ac' AND NOT t.tgisinternal")" = "1" ] \
  || die "UPSTREAM_MISSING: shipments_summary_recompute_ac 沒掛在 shipments 上"
ok W7B-REPLAY "全 migration 重放(尖端 $LINE_TIP)⇒ 取消 writer(六參)+ 出貨 writer + 重算 trigger **函式與接線**都在 ✓(🔴 「真路徑」= **migration 線**的真路徑;與正式庫零連線,**不可用於診斷正式庫**)"

# ── 共用 fixture ────────────────────────────────────────────
CUST='11111111-1111-1111-1111-111111111111'
SNAP='{"name":"王大明","phone":"0900000000","line":"L1"}'
PSNAP='{"title":"零件","sku":"S1","spec":{"color":"black"}}'
Q "INSERT INTO auth.users(id,email) VALUES('$CUST','w7b@test.local')" >/dev/null
Q "INSERT INTO public.customers(user_id,email) VALUES('$CUST','w7b@test.local')" >/dev/null
Q "INSERT INTO public.staff(id,label) VALUES('sean','Sean')" >/dev/null
[ "$(Q "SELECT pg_catalog.count(*)::text FROM public.staff WHERE id='sean' AND is_active")" = "1" ] || die "FIXTURE_FAIL(staff)"
SUPP="$(Q "INSERT INTO public.suppliers(label) VALUES('W7b 供應商') RETURNING id")"
case "$SUPP" in ????????-*) : ;; *) die "FIXTURE_FAIL(suppliers): $SUPP" ;; esac
Q "CREATE TABLE public.w7b_signal(k text PRIMARY KEY)" >/dev/null
Q "CREATE TABLE public.w7b_backup(k text PRIMARY KEY, v text)" >/dev/null

# 🔴 `mkround` 建一輪:**每輪自己的訂單**(取消是訂單級 RPC、會關單,共用會讓輪與輪互相污染)。
#    一單 **2 個品項**(取鎖序要有意義,至少要兩把鎖)、各 quantity 3 / 到貨 1;
#    一個**草稿箱**同時掛這 2 個品項各 1 件 ⇒ 兩側的鎖集合**完全重疊**。
# 🔴 錯誤不用 `die`(在 `$( )` 子 shell 裡呼叫,die 會關掉 server 卻只結束子 shell)
#    ⇒ 寫 `$D/mk.err`,呼叫端驗形狀。(w6a 實錘過的坑。)
mkround() { # $1=代號 → 印 "ORD|OI1|OI2|BOX"
  local n="$1" ord oi1 oi2 p1 p2 b rc
  ord="$(Q "SELECT pg_catalog.gen_random_uuid()")"
  Q "INSERT INTO public.orders(id,display_id,customer_user_id,shipping_address_snapshot,tier_at_checkout,subtotal,shipping_fee,total,shipping_method,invoice,shipping_method_at_checkout) VALUES('$ord',public.pcm_generate_display_id(),'$CUST','$SNAP'::jsonb,(SELECT enumlabel::text::public.member_tier FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='member_tier' LIMIT 1),100,0,100,'home','{\"type\":\"personal\"}'::jsonb,'home')" >/dev/null
  oi1="$(Q "SELECT pg_catalog.gen_random_uuid()")"; oi2="$(Q "SELECT pg_catalog.gen_random_uuid()")"
  Q "INSERT INTO public.order_items(id,order_id,variant_sku,product_snapshot,quantity,unit_price,line_total) VALUES('$oi1','$ord','SKU-$n-1','$PSNAP'::jsonb,3,10,30),('$oi2','$ord','SKU-$n-2','$PSNAP'::jsonb,3,10,30)" >/dev/null
  p1="$(Q "INSERT INTO public.order_item_procurement(order_item_id,allocated_quantity,supplier_id) VALUES('$oi1',3,'$SUPP') RETURNING id")"
  p2="$(Q "INSERT INTO public.order_item_procurement(order_item_id,allocated_quantity,supplier_id) VALUES('$oi2',3,'$SUPP') RETURNING id")"
  case "$p1" in ????????-*) : ;; *) printf 'FIXTURE_FAIL(procurement %s): %s\n' "$n" "$p1" >>"$D/mk.err"; return ;; esac
  case "$p2" in ????????-*) : ;; *) printf 'FIXTURE_FAIL(procurement %s): %s\n' "$n" "$p2" >>"$D/mk.err"; return ;; esac
  Q "INSERT INTO public.order_item_procurement_receipts(procurement_id,quantity,received_at,received_by) VALUES('$p1',1,now(),'tester'),('$p2',1,now(),'tester')" >/dev/null
  # 🔴 fixture 看門狗:到貨沒進去 ⇒ 出貨前緣(C9 shipped ≤ instock)會擋死出貨側,
  #    整輪變成「一邊本來就過不了」,而不是取鎖序。當場擋下、不讓它假綠。
  rc="$(Q "SELECT coalesce(pg_catalog.string_agg(instock_quantity::text,',' ORDER BY order_item_id),'(無列)') FROM public.order_item_quantity_summary WHERE order_item_id IN ('$oi1','$oi2')")"
  [ "$rc" = "1,1" ] || { printf 'FIXTURE_FAIL(instock %s): %s\n' "$n" "$rc" >>"$D/mk.err"; return; }
  b="$(Q "SELECT ('$(Q "SELECT public.admin_create_shipment('$n-c','$CUST','$SNAP'::jsonb,'hct')")'::jsonb ->> 'shipment_id')")"
  case "$b" in ????????-*) : ;; *) printf 'FIXTURE_FAIL(box %s): %s\n' "$n" "$b" >>"$D/mk.err"; return ;; esac
  rc="$(QM "SELECT public.admin_add_shipment_items('$n-i','$b','[{\"order_item_id\":\"$oi1\",\"quantity\":1},{\"order_item_id\":\"$oi2\",\"quantity\":1}]'::jsonb)")"
  case "$rc" in *ERROR*) printf 'FIXTURE_FAIL(add %s): %s\n' "$n" "$rc" >>"$D/mk.err"; return ;; esac
  # 🔴 兩個品項**真的都在箱子裡**才有兩把鎖可搶;掛成一個 = 取鎖序這一軸恆真。
  rc="$(Q "SELECT pg_catalog.count(*)::text FROM public.shipment_items WHERE shipment_id='$b'")"
  [ "$rc" = "2" ] || { printf 'FIXTURE_FAIL(box items %s): %s\n' "$n" "$rc" >>"$D/mk.err"; return; }
  printf '%s|%s|%s|%s' "$ord" "$oi1" "$oi2" "$b"
}
spl() { R_ORD="${1%%|*}"; local r="${1#*|}"; R_OI1="${r%%|*}"; r="${r#*|}"; R_OI2="${r%%|*}"; R_BOX="${r#*|}"; }
CANCEL() { printf "SELECT public.admin_cancel_order('%s',pg_catalog.gen_random_uuid(),'sean','customer_request',NULL,'[{\"order_item_id\":\"%s\",\"quantity\":1},{\"order_item_id\":\"%s\",\"quantity\":1}]'::jsonb)" "$1" "$2" "$3"; }
SHIP()   { printf "SELECT public.admin_mark_shipment_shipped('s-%s','%s','TRACK-%s')" "$1" "$2" "$1"; }
# 摘要四軸(instock/cancelled/shipped/quantity),兩個品項各一組。
sums()   { Q "SELECT coalesce(pg_catalog.string_agg(instock_quantity::text||'/'||cancelled_quantity::text||'/'||shipped_quantity::text||'/'||quantity::text,' ' ORDER BY order_item_id),'(無列)') FROM public.order_item_quantity_summary WHERE order_item_id IN ('$1','$2')"; }

# 🔴 逐邊判定(**存在量詞是坑**:兩邊串起來找一個 `idempotent`,一邊成功就綠 —— w6a 被抓過)。
side() { case "$1" in *ERROR*) printf 'ERR' ;; *idempotent*) printf 'OK' ;; *) printf 'BAD' ;; esac; }
# 🔴 輸家要**歸因到 40P01**,不是「有 ERROR 就算死鎖」:lock_timeout 的 55P03、前緣的 P2B26、
#    C7/C9 的 23514 都是 ERROR,但都**不是**取鎖序的證據。歸不到就進 NOT_DL、轉紅。
dl()   { case "$1" in *40P01*) printf 'DL' ;; *) printf 'NO' ;; esac; }

# ── 併發編排:advisory barrier(同時放行)+ 列鎖 rendezvous(同時進取鎖相位)──
race() { # $1=代號 $2=訂單 $3=品項1 $4=品項2 $5=箱 → 印 "barrier|rendezvous|tuplerel"(三欄;R1 移除 xb 後同步改掉契約字面)
  local n="$1" ctl gate barrier=0 rdv=0 trel="" _ x y
  # gate:先鎖住兩列 order_items,再等 signal(有界輪詢 500×0.02s = 10s 上限,逾時自行放行)
  PGAPPNAME=w7b_gate psql -X -h "$SOCK" -p $P -U postgres -d postgres -qtA -c "
    BEGIN;
    SELECT 1 FROM public.order_items WHERE id IN ('$3','$4') ORDER BY id FOR NO KEY UPDATE;
    SELECT pg_catalog.pg_advisory_xact_lock(49);
    DO \$g\$ DECLARE i int := 0; BEGIN
      LOOP EXIT WHEN EXISTS(SELECT 1 FROM public.w7b_signal WHERE k='go-$n') OR i >= 500;
        PERFORM pg_catalog.pg_sleep(0.02); i := i + 1; END LOOP; END \$g\$;
    COMMIT;" >"$D/gate.$n" 2>&1 &
  gate=$!
  for _ in $(seq 1 100); do
    [ "$(Q "SELECT pg_catalog.count(*)::text FROM pg_catalog.pg_locks WHERE locktype='advisory' AND granted AND objid=49")" != "0" ] && break
    sleep 0.05
  done
  # advisory barrier(骨架照 w6b1/w6b2/w6b3):控制 session 佔 47、睡 1.2s、放行
  psql -X -h "$SOCK" -p $P -U postgres -d postgres -qtA \
    -c "SELECT pg_catalog.pg_advisory_lock(47); SELECT pg_catalog.pg_sleep(1.2); SELECT pg_catalog.pg_advisory_unlock(47);" >"$D/ctl.$n" 2>&1 &
  ctl=$!
  for _ in $(seq 1 40); do
    [ "$(Q "SELECT pg_catalog.count(*)::text FROM pg_catalog.pg_locks WHERE locktype='advisory' AND granted AND objid=47")" != "0" ] && break
    sleep 0.05
  done
  PGAPPNAME=w7b_cancel psql -X -v VERBOSITY=verbose -h "$SOCK" -p $P -U postgres -d postgres -qtA \
    -c "BEGIN; SELECT pg_catalog.pg_advisory_xact_lock_shared(47); $(CANCEL "$2" "$3" "$4"); COMMIT;" >"$D/cancel.$n" 2>&1 &
  PGAPPNAME=w7b_ship psql -X -v VERBOSITY=verbose -h "$SOCK" -p $P -U postgres -d postgres -qtA \
    -c "BEGIN; SELECT pg_catalog.pg_advisory_xact_lock_shared(47); $(SHIP "$n" "$5"); COMMIT;" >"$D/ship.$n" 2>&1 &
  for _ in $(seq 1 60); do
    x="$(Q "SELECT pg_catalog.count(*)::text FROM pg_catalog.pg_locks l JOIN pg_catalog.pg_stat_activity a ON a.pid=l.pid WHERE l.locktype='advisory' AND NOT l.granted AND a.application_name IN ('w7b_cancel','w7b_ship')")"
    [ "$x" = "2" ] && { barrier=1; break; }
    sleep 0.05
  done
  # rendezvous:等到**兩側都停在鎖上、且等待鏈的源頭是 gate**才放行。
  # 🔴 **不能寫成「兩側都被 gate 直接擋住」**(首版就是這樣寫、實測從不成立):
  #    PG 的列鎖排隊是**鏈狀**的 —— 基線兩側都先要同一列 ⇒ 先到的等 gate 的 `transactionid`,
  #    後到的等**先到那一方**持有的 `tuple` 鎖。實測快照逐字:
  #      `w7b_ship | Lock | transactionid | blocked by {gate}`
  #      `w7b_cancel | Lock | tuple | blocked by {w7b_ship}`
  #    ⇒ 直接擋住兩側的**只有一個**是 gate。判準改成「**兩側都被擋** ∧ **gate 在阻擋者集合裡**」。
  #    (突變輪相反:兩側各要不同的第一列 ⇒ 兩側都直接被 gate 擋。兩種形狀本判準都認。)
  # 🔴 「被擋」必須**排除還卡在 advisory 47 上的那一側**(R1 審查 consider-1):
  #    只數 `pg_blocking_pids <> 0` 的話,一側還在 advisory barrier 上(blocker=ctl)也會被計入,
  #    只要另一側等到 gate 就 rdv=1 ⇒ 訊息說「兩側都停在 order_items 的**列鎖**上」就超出實際檢查。
  #    ⇒ 加一道 `NOT EXISTS(該 pid 有未授予的 advisory 鎖)`,advisory 等待者不算數。
  # 🔴 一次查回兩個數:①(非 advisory 等待的)被擋側數 ②gate 當阻擋者的次數。
  #    🔴 這裡**刻意不再計「一側被另一側擋住」**:那個觀察在放行**前**是被 rendezvous 蘊含的
  #       (基線等待鏈本來就是 `cancel ← ship ← gate`),放行**後**又量不到 ⇒ 整格已移除,
  #       原委見檔頭「被移除的那一格」段。留這句是避免有人「好心」把它加回來。
  for _ in $(seq 1 100); do
    y="$(Q "SELECT (SELECT pg_catalog.count(*) FROM pg_catalog.pg_stat_activity a
                     WHERE a.application_name IN ('w7b_cancel','w7b_ship')
                       AND pg_catalog.cardinality(pg_catalog.pg_blocking_pids(a.pid)) > 0
                       AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_locks l
                                        WHERE l.pid = a.pid AND NOT l.granted AND l.locktype = 'advisory'))::text
                 || '|' || (SELECT pg_catalog.count(*) FROM pg_catalog.pg_stat_activity a
                     JOIN LATERAL pg_catalog.unnest(pg_catalog.pg_blocking_pids(a.pid)) bp(pid) ON true
                     JOIN pg_catalog.pg_stat_activity g ON g.pid=bp.pid
                    WHERE a.application_name IN ('w7b_cancel','w7b_ship') AND g.application_name='w7b_gate')::text")"
    case "$y" in *'|'*) : ;; *) sleep 0.02; continue ;; esac
    case "${y#*|}" in 0) : ;; *) case "$y" in 2'|'*) rdv=1 ;; esac ;; esac
    [ "$rdv" = "1" ] && break
    sleep 0.02
  done
  Q "INSERT INTO public.w7b_signal(k) VALUES('go-$n')" >/dev/null
  # 放行**之後**的短窗:抓 tuple 鎖的 relation(死鎖歸因的即時證據面;
  # 呼叫端只在**突變輪**採用 —— 見 §2 前的 TREL 歸零)。
  for _ in $(seq 1 120); do
    trel="$(Q "SELECT coalesce(pg_catalog.string_agg(DISTINCT l.relation::regclass::text,','),'') FROM pg_catalog.pg_locks l JOIN pg_catalog.pg_stat_activity a ON a.pid=l.pid WHERE l.locktype='tuple' AND a.application_name IN ('w7b_cancel','w7b_ship')")"
    [ -n "$trel" ] && break
    sleep 0.02
  done
  wait $gate 2>/dev/null || true
  wait $ctl 2>/dev/null || true
  wait 2>/dev/null || true
  printf '%s|%s|%s' "$barrier" "$rdv" "$trel"
}

# 一輪跑完的共同判讀:回填 BARRIER_BAD / RDV_BAD / TREL / 各輪收場
BARRIER_BAD=""; RDV_BAD=""; TREL=""
runround() { # $1=代號 → 設 RC(取消側)RS(出貨側)RSUM(摘要)
  local n="$1" R B f1 f2 f3 rest
  R="$(mkround "$n")"; case "$R" in *"|"*"|"*"|"*) : ;; *) die "FIXTURE_FAIL($n): $(tail -2 "$D/mk.err" 2>/dev/null)" ;; esac
  spl "$R"
  B="$(race "$n" "$R_ORD" "$R_OI1" "$R_OI2" "$R_BOX")"
  f1="${B%%|*}"; rest="${B#*|}"; f2="${rest%%|*}"; f3="${rest#*|}"
  [ "$f1" = "1" ] || BARRIER_BAD="$BARRIER_BAD $n"
  [ "$f2" = "1" ] || RDV_BAD="$RDV_BAD $n"
  [ "$f3" = "order_items" ] && TREL="order_items"
  RC="$(tr '\n' ' ' <"$D/cancel.$n")"; RS="$(tr '\n' ' ' <"$D/ship.$n")"; RSUM="$(sums "$R_OI1" "$R_OI2")"
}

echo "══ 0. 序列對照:兩側前緣**都過得了**(危險面不是靠互斥擋掉的)════"
# 🔴 沒有這一格,下面「併發時兩邊都成功」可以被讀成「這條路本來就兩邊都會過,取鎖序沒在做事」。
#    反過來也要防:若序列時就有一邊被前緣拒,那併發的觀察量的是前緣、不是取鎖序。
# 🔴 這一格**真的是序列**:先取消、等它回來、再出貨,完全沒有 race/barrier/gate 介入。
SEQR="$(mkround seq)"; case "$SEQR" in *"|"*"|"*"|"*) : ;; *) die "FIXTURE_FAIL(seq): $(tail -2 "$D/mk.err" 2>/dev/null)" ;; esac
spl "$SEQR"
RC="$(QM "$(CANCEL "$R_ORD" "$R_OI1" "$R_OI2")")"
RS="$(QM "$(SHIP seq "$R_BOX")")"
RSUM="$(sums "$R_OI1" "$R_OI2")"
if [ "$(side "$RC")" = "OK" ] && [ "$(side "$RS")" = "OK" ] && [ "$RSUM" = "1/1/1/3 1/1/1/3" ]; then
  ok W7B-SERIAL-BOTH-OK "序列面對照:取消(2 品項各 1 件)與出貨(同 2 品項各 1 件)**兩邊都成功**、摘要 instock/cancelled/shipped/quantity = $RSUM ⇒ 這條路**不是「只能過一個」**,前緣沒有互斥掉任何一方 ⇒ 下面併發若出現失敗,不會是前緣的功勞 ✓"
else
  bad W7B-SERIAL-BOTH-OK "序列對照沒成立:取消=[$(side "$RC")] 出貨=[$(side "$RS")] 摘要=[$RSUM]"
fi

echo "══ 1. 🔴🔴 基線真併發:兩側同向升冪取鎖 ⇒ 零 40P01 ══════════"
DL_BASE=0; NOT_OK=""; WHO=""
for i in $(seq 1 $BASE_ROUNDS); do
  runround "b$i"
  if [ "$(dl "$RC")" = "DL" ] || [ "$(dl "$RS")" = "DL" ]; then DL_BASE=$((DL_BASE+1)); fi
  if [ "$(side "$RC")" = "OK" ] && [ "$(side "$RS")" = "OK" ] && [ "$RSUM" = "1/1/1/3 1/1/1/3" ]; then
    WHO="$WHO b$i:兩側都成功"
  else
    NOT_OK="$NOT_OK b$i(取消=$(side "$RC")/出貨=$(side "$RS")/摘要=$RSUM)"
  fi
done
printf '  ——  各輪收場(敘述、非判定):%s\n' "$WHO"
[ -z "$BARRIER_BAD" ] && ok W7B-BARRIER "每一輪兩個 session 都真的卡在 advisory barrier 上才被放行 ⇒ **同時開跑**成立 ✓(🔴 本格只證同時放行,**危險區重疊由下一格證** —— w6b3 明寫過這條限制,本檔補上)" \
                     || bad W7B-BARRIER "barrier 沒成立的輪次:$BARRIER_BAD"
[ -z "$RDV_BAD" ] && ok W7B-RENDEZVOUS "🔴 每一輪都觀察到**兩側都停在 \`order_items\` 的列鎖上、且等待鏈源頭是 gate**(\`pg_blocking_pids\`)才放行 ⇒ 兩側必定各自停在自己的**第一把鎖**上、**危險區真的重疊**;放行後兩側是在**彼此都已進場**的狀態下各自走完自己的取鎖序 = 這一軸**被真的施壓過** ✓(🔴 判準不是「兩側都被 gate **直接**擋住」—— 列鎖排隊是鏈狀的,基線後到的那側等的是**先到那側**的 tuple 鎖;寫成直接擋會恆不成立、實測已踩過。🔴 沒成立的輪次一律轉 FAIL,不接受「沒重疊所以沒死鎖」冒充「取鎖序有效」)" \
                  || bad W7B-RENDEZVOUS "rendezvous 沒成立的輪次:$RDV_BAD ⇒ 這些輪的「零死鎖」沒有判別力"
if [ "$DL_BASE" = "0" ] && [ -z "$NOT_OK" ]; then
  ok W7B-CONCURRENT-NO-DEADLOCK "🔴🔴 **交棒 6 的行為答案**:$BASE_ROUNDS 輪真併發(每輪都過 barrier + rendezvous),\`admin_cancel_order\` 與出貨重算搶同一組 2 列 \`order_items\` ⇒ **零 40P01**、兩側都成功、摘要每輪都是 1/1/1/3(取消與出貨各記各的、沒有丟失更新)⇒ 兩側同向升冪取鎖 ⇒ 後到的那個**等**,不是交錯 ✓(🔴 「零死鎖」是**跑過的輪數上**的觀察;判別力全部來自 §2/§3 兩發突變)"
else
  bad W7B-CONCURRENT-NO-DEADLOCK "基線不乾淨:死鎖輪數=$DL_BASE;非預期收場=$NOT_OK"
fi
# 🔴 這裡原本還有一格 `W7B-OVERLAP-CONTENTION`(「gate 放行**後**仍觀察到兩側互擋」)。
#    **R1 跨模型審查把它打掉,實測證實審查是對的,已移除** —— 理由記在檔頭「被移除的那一格」段。

echo "══ 2. 🔴 突變發①:把 **a8a2 步8** 的 ORDER BY oi.id 改成 DESC ══"
# 🔴 這一發是**交棒 6 自己那一句**的歸屬腿:證的不是「有東西承重」,是「a8a2 那一句承重」。
# 🔴 **TREL 在這裡歸零**(R1 must-fix-1):`trel` 每輪都抓,而**基線本來就有 order_items 的 tuple 競爭**
#    (鏈狀排隊:後到那側卡在先到那側的 tuple 鎖上)⇒ 不歸零的話,全域 TREL 在基線跑完就已經是
#    `order_items`,死鎖歸因那格會**在突變輪根本沒貢獻證據的情況下**照樣綠,還宣稱「紅的是取鎖序這一軸」。
#    ⇒ 歸零後,W7B-DEADLOCK-ATTRIB 的即時證據面**只**由突變輪供給。
TREL=""
# 🔴 rendezvous/barrier 的守門**要分相位讀**(R1 must-fix-2):§1 結尾判掉的只是基線那幾輪;
#    突變輪若 rendezvous 失效而兩側都成功,會被靜默計進 CLEAN、還印成「零無法解釋的收場」。
#    ⇒ 每個突變相位各自取差集,該相位不乾淨就不准綠。
MC_RDV0="$RDV_BAD"; MC_BAR0="$BARRIER_BAD"
Q "INSERT INTO public.w7b_backup(k,v) SELECT 'cancel', pg_catalog.pg_get_functiondef('$CANCEL_SIG'::regprocedure)" >/dev/null
[ "$(Q "SELECT pg_catalog.count(*)::text FROM public.w7b_backup WHERE k='cancel' AND v LIKE '%ORDER BY oi.id%'")" = "1" ] || die "BACKUP_FAIL(cancel)"
psql -X -h "$SOCK" -p $P -U postgres -d postgres -qtA -c "SELECT v FROM public.w7b_backup WHERE k='cancel'" >"$D/cancel.orig" 2>&1
# 🔴 換不到就 die:`or die NO_SUB` —— 不接受「換了 0 處也繼續跑」的假綠(突變沒套上=靶沒觸發)。
perl -0pe 's/ORDER BY oi\.id\n   FOR NO KEY UPDATE;/ORDER BY oi.id DESC\n   FOR NO KEY UPDATE;/ or die "NO_SUB"' "$D/cancel.orig" >"$D/cancel.mut" || die "MUT_SUBST_FAIL(cancel):步8 的取鎖 ORDER BY 字面沒命中"
printf ';\n' >>"$D/cancel.mut"
psql -X -h "$SOCK" -p $P -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f "$D/cancel.mut" >/dev/null 2>"$D/e1" || die "MUT_APPLY_FAIL(cancel): $(cat "$D/e1")"
[ "$(Q "SELECT (pg_catalog.strpos(pg_catalog.pg_get_functiondef('$CANCEL_SIG'::regprocedure),'ORDER BY oi.id DESC') > 0)::text")" = "true" ] || die "MUT_APPLY_FAIL(cancel):DESC 沒套上"
DL_MC=0; CLEAN_MC=0; MC_BAD=""
for i in $(seq 1 $MUT_ROUNDS); do
  runround "mc$i"
  if { [ "$(dl "$RC")" = "DL" ] && [ "$(side "$RS")" = "OK" ]; } || { [ "$(dl "$RS")" = "DL" ] && [ "$(side "$RC")" = "OK" ]; }; then
    DL_MC=$((DL_MC+1))
  elif [ "$(side "$RC")" = "OK" ] && [ "$(side "$RS")" = "OK" ]; then
    # 合法的第二種收場:**沒成環而兩側都成功**(成因未量測 —— 見檔頭「突變門檻」段;
    # 🔴 不得寫成「取消側原子拿完兩把鎖」:LockRows 逐列取鎖、非原子,且輸贏本檔沒量)
    CLEAN_MC=$((CLEAN_MC+1))
  else
    MC_BAD="$MC_BAD mc$i(取消=$(side "$RC")/出貨=$(side "$RS")/死鎖=$(dl "$RC")$(dl "$RS"))"
  fi
done
MC_RDV="${RDV_BAD#"$MC_RDV0"}"; MC_BAR="${BARRIER_BAD#"$MC_BAR0"}"
# 🔴 歸因證據**分相位收**(R2 nit-3):兩發共用一個池子的話,單一相位供給證據就能讓
#    W7B-DEADLOCK-ATTRIB 綠,而該格訊息寫的是「**兩發**突變紅的是取鎖序」= 字面比檢查寬。
#    ⇒ 這裡收下發①的 tuple 證據與 log 死鎖行數,收完歸零,讓發②從乾淨的池子重收。
TREL_MC="$TREL"; TREL=""
DLB_MC="$(grep -A 12 'deadlock detected' "$D/log" 2>/dev/null | grep -c 'order_items' | tr -d ' ')"
if [ "$DL_MC" -ge 1 ] && [ -z "$MC_BAD" ] && [ -z "$MC_RDV" ] && [ -z "$MC_BAR" ]; then
  ok TMUT-W7B-CANCEL-ORDER "🔴🔴 只把 **a8a2 步8** 的 \`ORDER BY oi.id\` 改成 \`DESC\`(其餘一字未動)⇒ $MUT_ROUNDS 輪中 **$DL_MC 輪真 40P01 死鎖**(恰一側被 PG 選作犧牲者、另一側成功)、$CLEAN_MC 輪沒成環、兩側都成功(合法收場;成因未量測)、**零**無法解釋的收場 ⇒ 基線那族的綠**不是恆真**,而且承重的就是**交棒 6 點名的那一句** ✓(🔴 門檻=≥1 輪成環,不是每輪 —— 理由見檔頭「突變門檻」段:成環需要一個時序窗口,兩側取鎖形狀不對稱 ⇒ 機制上做不到每輪必環。🔴 翻面只打了這個形狀:2 品項 / 1 箱 / 各 1 件)"
else
  bad TMUT-W7B-CANCEL-ORDER "突變沒翻面:成環輪數=$DL_MC/$MUT_ROUNDS(需 ≥1);無法解釋的收場=$MC_BAD;本相位 rendezvous 沒成立=$MC_RDV;barrier 沒成立=$MC_BAR ⇒ **本靶未觸發**,基線的判別力這次沒被驗證"
fi
psql -X -h "$SOCK" -p $P -U postgres -d postgres -v ON_ERROR_STOP=1 -q -c "$(cat "$D/cancel.orig")" >/dev/null 2>"$D/e2" || die "RESTORE_FAIL(cancel): $(cat "$D/e2")"

echo "══ 3. 🔴 突變發②:把**出貨 trigger 函式**的 ORDER BY 改成 DESC ══"
# 🔴 家族格的靶不得只打一個成員:不變量是「**兩側同向**」⇒ 出貨側那一句也要有自己的靶。
Q "INSERT INTO public.w7b_backup(k,v) SELECT 'ship', pg_catalog.pg_get_functiondef('$SHIPFN_SIG'::regprocedure)" >/dev/null
[ "$(Q "SELECT pg_catalog.count(*)::text FROM public.w7b_backup WHERE k='ship' AND v LIKE '%ORDER BY si.order_item_id%'")" = "1" ] || die "BACKUP_FAIL(ship)"
psql -X -h "$SOCK" -p $P -U postgres -d postgres -qtA -c "SELECT v FROM public.w7b_backup WHERE k='ship'" >"$D/ship.orig" 2>&1
perl -0pe 's/ORDER BY si\.order_item_id\n/ORDER BY si.order_item_id DESC\n/ or die "NO_SUB"' "$D/ship.orig" >"$D/ship.mut" || die "MUT_SUBST_FAIL(ship):迴圈的 ORDER BY 字面沒命中"
printf ';\n' >>"$D/ship.mut"
psql -X -h "$SOCK" -p $P -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f "$D/ship.mut" >/dev/null 2>"$D/e3" || die "MUT_APPLY_FAIL(ship): $(cat "$D/e3")"
[ "$(Q "SELECT (pg_catalog.strpos(pg_catalog.pg_get_functiondef('$SHIPFN_SIG'::regprocedure),'ORDER BY si.order_item_id DESC') > 0)::text")" = "true" ] || die "MUT_APPLY_FAIL(ship):DESC 沒套上"
MS_RDV0="$RDV_BAD"; MS_BAR0="$BARRIER_BAD"
DL_MS=0; CLEAN_MS=0; MS_BAD=""
for i in $(seq 1 $MUT_ROUNDS); do
  runround "ms$i"
  if { [ "$(dl "$RC")" = "DL" ] && [ "$(side "$RS")" = "OK" ]; } || { [ "$(dl "$RS")" = "DL" ] && [ "$(side "$RC")" = "OK" ]; }; then
    DL_MS=$((DL_MS+1))
  elif [ "$(side "$RC")" = "OK" ] && [ "$(side "$RS")" = "OK" ]; then
    CLEAN_MS=$((CLEAN_MS+1))
  else
    MS_BAD="$MS_BAD ms$i(取消=$(side "$RC")/出貨=$(side "$RS")/死鎖=$(dl "$RC")$(dl "$RS"))"
  fi
done
MS_RDV="${RDV_BAD#"$MS_RDV0"}"; MS_BAR="${BARRIER_BAD#"$MS_BAR0"}"
TREL_MS="$TREL"
DLB_ALL="$(grep -A 12 'deadlock detected' "$D/log" 2>/dev/null | grep -c 'order_items' | tr -d ' ')"
DLB_MS=$(( ${DLB_ALL:-0} - ${DLB_MC:-0} ))   # 發②自己的死鎖報告行數(全量減去發①收攤時的存量)
if [ "$DL_MS" -ge 1 ] && [ -z "$MS_BAD" ] && [ -z "$MS_RDV" ] && [ -z "$MS_BAR" ]; then
  ok TMUT-W7B-SHIP-ORDER "🔴🔴 把**出貨重算 trigger 函式**的迭代改成 \`DESC\`(\`…s2b…sql:342\`,其餘一字未動)⇒ $MUT_ROUNDS 輪中 **$DL_MS 輪真 40P01**、$CLEAN_MS 輪沒成環、兩側都成功(合法收場;成因未量測)、**零**無法解釋的收場 ⇒ 出貨側的**迭代方向**確實承重 ✓ 🔴🔴 **本格證的是「方向」,不是「那一句字面」**(R3 換模型審查 must-fix-1/2):姊妹 harness 已**實測推翻**「拿掉 \`ORDER BY\` 就會反序」——\`b2s2b-verify.sh:1749\` 逐字「這一靶翻不了面」、\`:1760\` 逐字「今天擋住反序取鎖的是 **\`DISTINCT\` 的排序**,不是 \`ORDER BY\` 那幾個字」(PG 把 DISTINCT 規劃成 Sort+Unique)。\`DESC\` 連 DISTINCT 的 Sort 一起翻,故**分不出**是哪一個承重 ⇒ **不得**拿本格宣稱 \`…s2b…sql:336-337\` 那句註解「被證實」。🔴 **兩發各自都能翻面** ⇒ 承重的是「**兩側同向**」這個跨函式不變量;至於**出貨側靠什麼**維持同向,今天是 DISTINCT 的 Sort,\`ORDER BY\` 是它哪天被拿掉時的唯一防線、但**本檔與 b2s2b 都沒有守住它的靶**"
else
  bad TMUT-W7B-SHIP-ORDER "突變沒翻面:成環輪數=$DL_MS/$MUT_ROUNDS(需 ≥1);無法解釋的收場=$MS_BAD;本相位 rendezvous 沒成立=$MS_RDV;barrier 沒成立=$MS_BAR ⇒ **本靶未觸發**"
fi
psql -X -h "$SOCK" -p $P -U postgres -d postgres -v ON_ERROR_STOP=1 -q -c "$(cat "$D/ship.orig")" >/dev/null 2>"$D/e4" || die "RESTORE_FAIL(ship): $(cat "$D/e4")"

echo "══ 4. 🔴 死鎖歸因 + 還原比對 ═══════════════════════════════"
# 🔴 「有 40P01」不等於「死在 order_items 上」:歸因要有證據面,否則突變格證的只是「紅了」。
#    兩個獨立來源:①即時 `pg_locks` 的 tuple 鎖 relation ②server log 的死鎖報告 CONTEXT。
LOGHIT="$(grep -c 'order_items' "$D/log" 2>/dev/null | tr -d ' ')"
# 🔴 **兩發各自都要有證據**(R2 nit-3):訊息說「兩發突變紅的是取鎖序」,檢查就得逐發驗,
#    不能讓一發的證據替另一發背書。每發各自接受「即時 tuple 鎖」或「該發自己的 log 死鎖行數」。
MC_OK=0; MS_OK=0
{ [ "$TREL_MC" = "order_items" ] || [ "${DLB_MC:-0}" -gt 0 ]; } && MC_OK=1
{ [ "$TREL_MS" = "order_items" ] || [ "${DLB_MS:-0}" -gt 0 ]; } && MS_OK=1
if [ "$MC_OK" = "1" ] && [ "$MS_OK" = "1" ]; then
  ok W7B-DEADLOCK-ATTRIB "🔴 死鎖**歸因到 \`order_items\`**,不是「哪裡紅都算」,而且**兩發各自**都有證據:發①(取消側)tuple relation=[$TREL_MC]、自己的 log 死鎖報告行數=$DLB_MC;發②(出貨側)tuple relation=[$TREL_MS]、自己的行數=$DLB_MS ⇒ 兩發紅的都是**取鎖序**這一軸 ✓(🔴 每發**各自**接受兩個來源任一;任一發兩個來源都空就轉 FAIL,不用「反正紅了」推論,也不讓一發替另一發背書)"
else
  bad W7B-DEADLOCK-ATTRIB "有突變發取不到死鎖歸因證據:發①=[$TREL_MC]/$DLB_MC(ok=$MC_OK) 發②=[$TREL_MS]/$DLB_MS(ok=$MS_OK)(全檔 order_items 命中=$LOGHIT)⇒ 該發只證了「紅了」,沒證「死在取鎖序上」"
fi
# 🔴 還原要**比對存值**(W6c F4 的教訓:「已還原」那句必須有證據,名字還在不算)。
CROK="$(Q "SELECT (pg_catalog.pg_get_functiondef('$CANCEL_SIG'::regprocedure) = (SELECT v FROM public.w7b_backup WHERE k='cancel'))::text")"
SROK="$(Q "SELECT (pg_catalog.pg_get_functiondef('$SHIPFN_SIG'::regprocedure) = (SELECT v FROM public.w7b_backup WHERE k='ship'))::text")"
if [ "$CROK" = "true" ] && [ "$SROK" = "true" ]; then
  ok W7B-MUT-RESTORE "兩支被突變的函式定義**逐字還原**(與突變前存進 w7b_backup 的 \`pg_get_functiondef\` 全文比對,不是只看名字或只看 DESC 不見了)✓"
else
  bad W7B-MUT-RESTORE "還原比對失敗:取消側=[$CROK] 出貨側=[$SROK]"
fi

echo "══ 5. 覆蓋帳 ══════════════════════════════════════════════"
TOT=$((PASS+FAIL))
if [ "$TOT" = "$EXPECT_TOTAL" ]; then
  printf '  PASS %-30s %s\n' "CELL-ACCOUNT" "格數 $TOT = 凍結值 $EXPECT_TOTAL"; PASS=$((PASS+1))
else
  printf '  FAIL %-30s %s\n' "CELL-ACCOUNT" "格數 $TOT != 凍結值 $EXPECT_TOTAL"; FAIL=$((FAIL+1))
fi
DUP="$(printf '%s' "$KEYS" | tr ' ' '\n' | grep -v '^$' | sort | uniq -d | tr '\n' ' ')"
[ -z "$DUP" ] || { printf '  FAIL %-30s %s\n' "CELL-DUP" "重複格名 [$DUP]"; FAIL=$((FAIL+1)); }
KEYS_NOW="$(printf '%s' "$KEYS" | tr ' ' '\n' | grep -v '^$' | sort | tr '\n' ' ' | sed 's/ *$//')"
KEYS_FROZEN="TMUT-W7B-CANCEL-ORDER TMUT-W7B-SHIP-ORDER W7B-BARRIER W7B-CONCURRENT-NO-DEADLOCK W7B-DEADLOCK-ATTRIB W7B-MUT-RESTORE W7B-RENDEZVOUS W7B-REPLAY W7B-SERIAL-BOTH-OK"
if [ "$KEYS_NOW" = "$KEYS_FROZEN" ]; then
  printf '  PASS %-30s %s\n' "CELL-KEYSET" "格名集合逐字符合凍結清單"; PASS=$((PASS+1))
else
  printf '  FAIL %-30s %s\n' "CELL-KEYSET" "格名集合漂了:[$KEYS_NOW]"; FAIL=$((FAIL+1))
fi

# 🔴 原本這裡有一份行內收尾;已交給 EXIT 的 trap teardown,避免兩條收尾路徑各走各的。
echo
# 🔴 **離場清點量的是資料目錄與 socket 目錄,不是 TCP 埠**(R1 審查 nit-1):
#    本檔的 cluster 以 `listen_addresses=`(空)啟動、**從不開 TCP** ⇒ `lsof -iTCP:$P` 永遠 0 行,
#    那個數字對「有沒有殘留」**零判別力**(恆真)。改量真的會殘留的兩個東西。
#    🔴 同線 w6b*/w6c 印的是那個恆真的埠數;本檔不跟進,據實換掉。
#    🔴 **2026-08-08 W7 跟片再修一次**:本檔的清點方向本來就是對的(上面那段 R1 nit-1 的理由仍成立),
#    但收尾改成 EXIT 的 trap teardown 之後,**這一行會跑在 teardown 之前** ⇒ 資料目錄必然還在、會誤報「殘留」。
#    ⇒ 清點整個移進 teardown(停完才量),這裡只留指路。
echo "════ PASS=$PASS FAIL=$FAIL ════  (殘留檢查見下一行 teardown 輸出)"
[ "$FAIL" -eq 0 ] || exit 1
