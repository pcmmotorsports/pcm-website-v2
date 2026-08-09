#!/usr/bin/env bash
# ============================================================
# B2-S2b 可重現驗證 harness ── 行為段(S2b-2a 建檔)+ 行為突變矩陣(S2b-2b 第一段)
# ============================================================
# 標的 = supabase/migrations/20260806180000_m4b_e10_b2_s2b_shipped_recompute_wire.sql
# 片級 plan = docs/specs/2026-08-06-e10-b2-s2b-recompute-wire-plan.md(v2、已凍結)
#
# 本檔由**十一片**累積而成,**各片的範圍分開寫,不要混成一句**:
#   · **S2b-2a**(commit `14daef0`)= 建檔 + plan §4.99 的驗收項 10 / 10b / 11 / 12 / 12b / 12c / 14 / 15 / 18 / 20。
#   · **S2b-2b 第一段**(commit `3f8dce0`)= ①pre-S2b 基準庫(突變環境的 TEMPLATE 來源;plan §2.2 W2 逐字定義)
#     ②**環境 B(行為)突變矩陣**:MUT0 對照 + 五發靶 ③**S2b-1 消融重證**(主視窗 `B-147-A` ③)。
#     🔴 2b 依鐵則 4 切段;**第二段**原含三塊 —— 環境 A 矩陣 / 項19 barrier / 項29 stale-high;
#     再依鐵則 4 拆成三小段(之一 環境A 矩陣 / 之二 項19 barrier / 之三 項29 stale-high),**三小段都已做**。
#   · **S2b-2b 第二段之一**(commit `55afe53`)= **環境 A(結構)突變矩陣**:外部結構 oracle **十維**
#     + 八發靶(A1-A8)+ 零突變對照 SMUT-0。詳見下方 ⓒ。
#   · **S2b-2b 第二段之二**(commit `9f48bf9`)= **項19 barrier**:三 session 真併發編排(`barrier_oracle`)
#     + 零突變對照 BMUT-0 + 三發靶(L1 / L2a / L2b)。**標 `inconclusive`**,詳見下方 ⓓ。
#   · **S2b-4b**(commit `f70ff20e`)= 本檔新增 `PORT-DEFAULTS` 格(讀 `a1-verify` / `a4a-verify` 的預設埠字面,
#     期望值**回讀自 plan §3.6 的表**);a1/a4a 兩支的分埠與 teardown 改在那兩支檔案裡,不在本檔。
#   · **S2b-5**(本輪)= **項30 註解蓋寫守門**:`6h/8` 段,expected-before / after 兩組凍結指紋
#     + 三邊同源 + before 分支實跑 + 維度格 + 負測ⓐⓑⓒ。詳見下方 ⓖ。
#   · **S2b-2b 第二段之三**(commit `18d35294`)= **項29 stale-high 三格**:(a) 前態可達(**pre-S2b 基準**)/
#     (b) 本線自癒 /(c) 真超出貨仍紅。詳見下方 ⓔ。
#   · **S2b-3a 後段**(commit `b3340ac`)= **真相式六塊同步守門**(`scripts/b2s2b-truth-sync.py` + 對照組格)
#     + **九發守門突變**(T1-T5 全等半逐塊各一、T6/T7 per-site 半(helper 與 backfill 的述詞恆等式)、
#       T8 位置集合被「刪一格+重複另一格」、T9 標記被刪)。
#     3a 前段(四處四軸化 + 標記註解)= commit `ff366bf`,不在本檔。
#   · **S2b-3b 第一段**(commit `5ca71ba`)= plan §4 的 **項26 / 26b / 27**:`RB-STOPWRITE`(runbook 停寫在步驟①、
#     回權在步驟⑦ 的文字面 + 三發突變 S1/S2/S3)、`B26b-enable-restores`(回權後真的重新跟動)、
#     `B27-divergence-4th`(從 runbook 抽 SQL 實跑的第四軸驗收)。
#   · **S2b-3b 第三段**(commit `482ce423`)= plan §4 的 **項22(PR4 造洞實證)+ 項28(出貨資料面集合斷言)**。
#     ⇒ **3b 七項(21b / 22 / 26 / 26b / 27 / 28 / 31)全部結清。**
#   · **S2b-3b 第二段**(commit `94e78e92`)= plan §4 的 **項21b + 項31**:runbook 依賴枚舉四支→**五支**、
#     步驟④ 的 **DROP 序**補出貨側、Forward 重建清單加 **S2b** + 重放方式;
#     `b2s2a-verify.sh` 凍結清單與 `rehearse()` 跳點同批更新;
#     本檔新增 `REH-PRODUCTS` 格(**DROP 清單與 Forward 清單都從 runbook 抽**)
#     + **兩發負測**:`TMUT-REH`(拿掉 Forward 的 S2b ⇒ 產物斷言紅)、`TMUT-REH2`(拿掉步驟④ 的出貨側 DROP ⇒ 拆除清單計數紅)。
#
# 用法:
#   PORT=54365 scripts/b2s2b-verify.sh all /tmp/b2s2bv   從零 provision post-S2b 基準庫,再跑全部
#   PORT=54365 scripts/b2s2b-verify.sh run /tmp/b2s2bv   重用既有基準庫
#   🔴 **`all` 跑完會把自己 provision 的叢集停掉**(2026-08-08 W7 順手片補的 teardown;
#      在此之前每跑一次就留一支活著的 postmaster,B 窗與主視窗各自復現過)。
#      要接著跑 `run` ⇒ 前一次 `all` 加 `B2S2B_KEEP_CLUSTER=1` 明確保留(收尾自己負責)。
#      `run` 模式重用的是別人起的叢集,**不收**(誰起的誰收)。
#   🔴 PORT **無預設、必須顯式帶**(plan §3.6:a1/a4a 共用 54329 的同埠地雷;建議值 54365)。
#      本家族已占用、不得重用:54329 / 54331 / 54342 / 54351 / 54353 / 54355 / 54357 / 54359
#      / **54361(a1-verify)/ 54363(a4a-verify)**(S2b-4b 分埠後新增;與程式的黑名單同步)。
#
# ── 這支腳本在證明什麼 ──────────────────────────────────────
# 證明:S2b-1 接上去的第四軸**在真的跑起來時**行為正確 —— 由**外部** oracle 回查落庫值,
#      不是靠 migration 自己那段 §5 結構驗收自我背書(那段只證得了 catalog 長相)。
#   ①出貨真的讓 `shipped_quantity` 跟動(項10)、草稿箱**不算**(項10b)、
#     作廢退量(項11,含 `submitted` 態)、unvoid 回升(項12);
#   ②§0.3 那個「shipped 只能經 UPDATE 升值」的**前提**被 X3 / X1 / append-only 三支釘住
#     (項12b / 12c)—— 前提倒了會讓 shipped 靜默算少,而**沒有任何一格會自己紅**;
#     🔴 12c 是**兩格**:結構面(外殼 triggerdef + **函式本體 md5**)與行為面(真的擋得住 UPDATE)。
#     只驗外殼時,把函式 body 換成 `RETURN NEW` 會讓 triggerdef 逐字不變 ⇒ 全綠而守門已失效。
#   ③C9 真的擋得住重算寫出來的超額 shipped(項14),而且它是**承重件**(項15:拿掉就過);
#   ④X1 在 **COMMIT** 失敗時,摘要與品項**兩邊都回滾**(項18)—— 這格用真 COMMIT,不是模擬;
#   ⑤helper 四軸活體:蓋掉摘要四軸 → 直呼 helper → 四軸新值全對(項20;輸出的 `quantity`
#     前綴是報表維,由 A1 複合 FK 釘死、不具判別力)。
#
# 🔴 **本檔不證明**(逐條寫死,不留給下一棒推測):
#   ⓐ **突變覆蓋是 25 格中的 14 格,不是全部**。🔴 **數字不再手寫** —— 由 `COVERED_CELLS` /
#     `UNCOVERED_CELLS` 兩個具名集合算出來,並斷言兩者相加 = `EXPECT_CELL`(格 `COVERAGE-ACCOUNT`);
#     新增一格卻忘了歸類,那一格會當場紅。逐格清單也印在跑完的結語裡。
#     **有靶的 14 格**(🔴 下面這份是說明用的 prose,**權威清單是 `COVERED_CELLS`**;兩者若不一致以變數為準):B10 / B10b / B11 / B11b / B12 / B14 / B20(行為靶①-⑤)
#     + **TRUTH-SYNC**(3a 的守門靶 **T1-T9**)+ **RB-STOPWRITE**(3b 的靶 **S1/S2/S3**)
#     + **REH-PRODUCTS**(3b 第二段的靶 **TMUT-REH / TMUT-REH2**)。
#     + **B28-datasurface**(3b 第三段的靶 **D1/D2**)
#     + **STRUCT-ORACLE**(2b 第二段之一的靶 **A1-A8** + 零突變對照 SMUT-0)
#     + **B29b-line-self-heals**(靶⑤)+ **B29c-real-overship-still-red**(靶①)(2b 第二段之三)。
#     🔴 **B22-pr4-hole 沒有靶**(靶要重建庫、成本高;它自帶對照:同一筆資料舊三軸回 0、四軸 RAISE)。
#     🔴 **其中 B14 只紅在它自己的「前提斷言」那一段**(靶①⑤ 都讓 shipped 根本沒被寫上去)——
#     也就是說 B14 的 C9 判別 oracle **從未被任何一發突變證明有判別力**;它的對照是 B15(消融),
#     不是突變。B12 在靶②④ 下紅在本輪新加的「作廢後必須是 0」中途斷言(那是它自己的內容),
#     但它宣稱的另一半「**unvoid 真的回升**」仍**沒有**任何一發靶殺得到 —— 本線的靶動不到
#     「只壞 unvoid、不壞 void」那條路。兩者都逐字寫在這裡,不要在報告裡簡化成「7 格已證」。
#     **沒靶的 11 格**:B12b-x3 / B12b-x1 / B12c-blocks(驗的是 **S1b** 守門,本檔的突變全在 S2b
#     那支 migration 上、**結構上動不到它們**;那三發靶是 plan 項25b = S2b-4c 的範圍)、
#     B12c-append-only(結構面)/ B15 / B18 / **ABLATION**(B10 的負向對照)/
#     **B26b-enable-restores** / **B27-divergence-4th** / **B22-pr4-hole** /
#     **B29a-stale-high-reachable**(刻意無外部靶:它與 B29b 是同一段 body 跑在兩個基準上,
#       觀察值不同 ⇒ **它的對照組就是 B29b**)——
#     前三格自帶對照(ABLATION 的 0/3、舊三軸述詞的 0 列),B22 自帶對照(同一筆資料舊三軸回 0、
#     四軸 RAISE),但**都沒有**外部突變檔證明它們(B22 的靶要重建庫,成本高)。
#     🔴 **B28-datasurface 不在這裡** —— 它有靶(D1/D2),靶是純文字、零 DB 成本。
#   ⓑ **plan §5 環境B 九列只做了五列**(逐列交代,不含糊):
#     做了列 1-4(拿掉 trigger / 漏 `deleted_at IS NULL` / 漏 `shipped_at IS NOT NULL` / 漏 `deleted_at` 事件面)
#     與增補靶末列(`ON CONFLICT` 漏 `shipped_quantity`)。
#     **沒做**:列 5/6(oracle = 項19 barrier,見 ⓒ)、**列 7「backfill 漏候選品項」**
#     (oracle = 項17 差集段,在 migration 檔內;要在 pre 庫上先造出貨資料才構造得出來)、
#     **列 8/9(五份真相式本體 / 第 5 處述詞改恆等式)** —— 那兩列的 oracle 是項21,認領給 **S2b-3a**。
#   ⓕ ✅ **項29 stale-high 三格已做**(2b 第二段之三),三格都跑出預期觀察值:
#     (a) `step2=ok|step3=23514/oiqs_shipped_le_instock` —— 超額出貨**零違規提交**(這就是「靜默」),
#         紅的是**下一筆無辜的採購更正**,離真凶任意遠;
#     (b) `step2=ok|step3=ok|0/2` —— 本線重算把殘留 shipped 3 修回真值 0、instock 修回 2,該筆**不紅**;
#     (c) `23514 / oiqs_shipped_le_instock` —— 真超出貨仍紅,且紅在**出貨那一筆**。
#     🔴 **(a) 與 (b) 是<u>同一段 body</u> 跑在兩個基準上**(pre-S2b 副本 vs post):
#       body 逐字相同、觀察值不同 ⇒ 「三格各自 pin 基準」不是裝飾,**基準本身就是判別式**。
#       這也是 (a) 沒有外部突變靶的原因 —— 它的對照組就是 (b)。
#     🔴 **(b)(c) 已掛進 `beh_oracle`** ⇒ 現成的靶打得到:靶⑤(ON CONFLICT 漏 shipped)紅 (b)、
#       靶①(拿掉重算 trigger)紅 (c)。掛進去之前它們**零靶**,只被對照組證明「可以滿足」。
#     🔴 構造法逐字照小線 C9 註解(`20260806100000_…:139-142`):**不是**直寫 `shipped=3 / instock=2`
#       (那會當場被 C9 擋下、證明的是「C9 會擋」),而是先讓 **instock 快取 stale-high** 再寫 shipped。
#     🔴 **四條誠實邊界(R1 nit 7-10,寫在這裡不是藏在別處)**:
#       ①「零違規提交」的**實際觀察**是「C9 這條**不可 deferred 的 CHECK** 沒有拒絕」——
#         整格在 `BEGIN … ROLLBACK` 內、step2 又包子交易,本檔量不到真正的 COMMIT。
#       ②`B29a-…-reachable` 這個名字**超過它證的東西**:前態是靠**直寫快取**造出來的。
#         plan §0.3 自陳 stale-high「是可達狀態,只是沒有常規 writer」⇒ 本格證的是
#         「**若**前態成立則會靜默」,**不是**「前態在正式站可達」。
#       ③`STALE_HIGH_I4` 讓 ordered=3 / instock 快取=3 / shipped=3 **三值相同**,表面違反本檔
#         「值不得相等」的規矩。**判別力由步驟③ 救回來**(它把 ordered→4、instock→2,三值當場分開)
#         —— 這個理由寫在這裡,下一棒才知道那三個 3 不是可以隨手改的。
#       ④(c) 用 `cell_err`,只拿得到**第一個**例外 ⇒「紅在出貨那一筆」目前由 **body 裡沒有更後面的交易**
#         這個**構造**保證,不是由斷言保證。(審查另以 PG 錯誤 CONTEXT 逐字確認過紅在 `UPDATE shipments`。)
#   ⓓ ⚠️ **項19 barrier 已做,但整格標 `inconclusive`**(2b 第二段之二;plan §8.1 第二列,
#     項19 是該規則**唯一**預先授權的一格)。舉證義務照第三列同一標準,逐條寫在這裡:
#     · **真路徑嘗試被什麼擋住**:出貨 writer RPC **今天不存在**(plan §9 交棒 1 才建)
#       ⇒ 兩個 session 的 `UPDATE public.shipments SET shipped_at` 是 **owner 直寫**。
#     · **它真的證到的**:trigger → helper 的**逐列取鎖順序**、以及「鎖排在讀真相之前」這件事,
#       在**三個真 session、真 COMMIT、真死結偵測**下的效果(不是模擬、不是單 session 推論)。
#     · **它證不到的**:①未來那支出貨 RPC 會不會在進 trigger 前先取別的鎖(順序可能與此不同)
#       ②A8a2 多品項的取鎖順序(plan §9 交棒 6)。**這兩條一律不宣稱已擋。**
#     🔴 **plan §8.1 有兩條升級條款,一條未觸發、一條<u>成立</u>**:
#       ①「項19 與**項26 停寫**兩格若**都**只能 inconclusive ⇒ 進 STOP」= **未觸發**
#         (項26 是真的 DISABLE trigger 後觀察摘要不動、且有 S1/S2/S3 三發靶,不是 inconclusive)。
#       ②「**若項19 最終是本線唯一的併發證據 ⇒ 進 STOP**」= **成立** —— 項26 是單 session 觀察、
#         不是併發證據(2026-08-07 R3 抓到我只評估了①)。⇒ 已依規定進 STOP 呈報主視窗。
#     🔴🔴 **「這一格算不算過」有兩種相衝的讀法,執行者不選邊**(詳 plan §4.19 ⑧):
#       甲(R3):§8.1 第三列「構造不出來 ⇒ 不算通過」已經給了裁定,再開待裁態是重新標籤 ⇒ 應判紅。
#       乙(執行者當時):第三列講的是**該格**,而該格構造出來了(L1/L2b 都翻面);
#         構造不出來的是**其中一發靶** ⇒ 不適用。
#       現況(離開碼 3、不入 PASS 帳)是兩者的**保守中點**。
#     🔴🔴 **主視窗已裁:Q1 = C —— 維持第三態,終局判定綁 apply 前 preflight**(`B-159-A`,2026-08-07)。
#       甲不採:把格記成 PASS = 宣稱 > 事實(整格 inconclusive 的真因是 writer RPC 不存在)。
#       乙不採:紅的語意是「編排抓不到反序取鎖」,但 L2b 實測真丟 `40P01` = 抓得到 ⇒ 判紅也是字面 ≠ 事實。
#       ⇒ **C 也沒把它算通過**;爭點只剩離開碼形狀,而本檔零自動化消費者 ⇒ 兩讀法無行為差,取誠實的那個。
#     🔴 **併發驗證已正式移交**(同信):項19 重新定性 = **編排可行性證明**,不是本線的併發證據;
#       真併發證據 + 交棒 10 的批次鎖序面,**同在「出貨 writer RPC 片」一起證,不拆**。
#     🔴 **凍結值是後驗的**(R3 must-fix 3):L2a 的期望空集合與 `EXPECT_INCONC*` 都是先實測後寫下,
#       **不符 §2.1 片級 DoD 的 W1「開工前先凍結」**;此事同時記在 plan §4.19 ⑦ 與 commit body。
#     🔴🔴 **本編排完全沒測到的第三個併發面**(R3 must-fix 7,已進 plan §9 交棒 10):
#       本片 trigger 是 `AFTER … FOR EACH ROW` ⇒ 一句 `UPDATE shipments … WHERE <多列>` 會逐列發火,
#       **跨 shipment 的取鎖順序 = 該 UPDATE 的列序、無任何排序保證**。兩個這種語句併發即可能真 `40P01`。
#       本 barrier 每個 session 只更新一列,看不到這一面。**不宣稱已擋。**
#     🔴 **plan §5 指定的靶 L2a(拿掉 `ORDER BY`)實測翻不了面**,期望紅點是**空集合**:
#       PG 把 `DISTINCT` 規劃成 `Sort + Unique`(EXPLAIN 實跑),輸出序等同 `ORDER BY order_item_id`;
#       兩個 session 跑同一支函式 ⇒ 順序只是值集合的函式、兩邊恆等,反序取鎖**構造不出來**。
#       ⇒ **今天擋住反序取鎖的是 `DISTINCT` 的排序,不是 `ORDER BY` 那幾個字。**
#       `ORDER BY` 仍留著(把保證寫成明文、且是 `DISTINCT` 哪天被拿掉時的唯一防線),
#       但**不得宣稱本 harness 守得住它** —— 它現在沒有靶。
#     🔴 那個空集合**不是 fail-open**:判別力由**同一套編排**下的靶 L2b 背書(連 `DISTINCT` 一起拿掉
#       ⇒ 真的丟 `40P01`)。沒有 L2b,「L2a 全綠」與「rig 根本抓不到死結」不可分。
#   ⓒ ✅ **環境 A(結構)突變矩陣已做**(2b 第二段之一):外部結構 oracle **十維** + 五發靶 + 零突變對照。
#     🔴 **但 plan §5 環境A 的七個靶只做了五個**:
#     ①「trigger 改 `BEFORE`」**構造不出來** —— PG 文法不接受 `CREATE CONSTRAINT TRIGGER … BEFORE`
#       (實測 `syntax error at or near "BEFORE"`)⇒ 換成「降級成普通 TRIGGER」,
#       **那打的是 tgconstraint 維、不是 tgtype 維;tgtype 維本輪無靶**。
#     ②「拿掉閘」與③「閘改 pin `prosrc`」**沒做** —— 它們的 oracle 不是 catalog 事實而是「閘會拒絕」,
#       照 plan §3.2 要走**雙獨立庫**負測,留給後續。
#     ✅ **項29 stale-high 已做**(2b 第二段之三,見 ⓕ);項19 barrier 見 ⓓ。
#     🔴 **「拿掉閘」「閘改 pin prosrc」兩靶的認領家**(R2 F3:上一版只寫「留給後續」= 活字):
#       它們要走 plan §3.2 的**雙獨立庫**負測(同一 provision 快照複製兩份、一份 control 一份 mutant),
#       與本檔「單一 pre 庫複製副本」的骨架不同 ⇒ **認領給 S2b-2b 第二段之四**(項19/項29 之後那一段);
#       若屆時仍不做,必須進 STOP 讓主視窗裁,不得默默蒸發。
#     (memory `feedback_guard-checks-existence-not-effect`:存在性斷言對「還在但失效」全盲。)
#   ⓓ **正式站行為**:本機 PG17,不是 Supabase;RLS / ACL 的實際行為未驗。
#   ⓔ **W2 的落點**(對凍結 plan 的偏離,已同批改 plan §2.2 的 W2 適用列,不留活字):
#     **S2b-2a** 判 `W2: N/A` —— 它那 13 格逐格檢查後沒有一格需要 pre-S2b 庫。
#     **S2b-2b(本輪)判 W2 適用**,並且真的建了 `b2s2b_pre`(`all` 模式,只重放時間戳早於本檔
#     的前綴)—— 因為突變的對象是 migration 檔本身,必須有一座「還沒套它」的庫才套得上突變版。
#     ⇒ plan `:322` 把 2a 與 2b 並列在 W2 適用範圍**只有 2a 那半不成立**,2b 這半是對的。
#
# 🔴🔴 **永久警語 ①:期望值一律正向寫死,不得由受測 DB 自算** 🔴🔴
#   小線 R1 實錘:「對照組自己算出來再跟自己比」= 恆綠。本檔每一格的 `exp` 都是常數字面。
#
# 🔴🔴 **永久警語 ②:0 值格必須先證明 fixture 真的建起來了** 🔴🔴
#   期望值含 0 的有**五格**:項10b(`1/0/3`)、項11(`0/3`)、項11b(`0/3`)、項18(`0/0/0/3`)、
#   **ABLATION(`0/3`)**(2b R2 nit 1:枚舉寫下即過期,這一條就是實例)。
#   這些 0 在「fixture 根本沒建成」時**同樣會出現** ⇒ 每一格的 oracle 都**併回非 0 的存在性維度**,
#   而且 11 / 11b / 12 另外在 body 內先斷言「作廢前 shipped 真的是 2」(`PRE_SHIPPED_2`)——
#   光靠 instock 那一維不夠:它是 **receipts 軸**寫的,證不到「作廢事件觸發了重算」。
#   memory `feedback_fixture-value-makes-guard-vacuous` / `feedback_negative-test-...` 同族。
#
# 🔴 判定紀律
#  ① 每格的觀察值是**回查落庫值**,不是「沒噴錯」(plan §4 通則)。
#  ② 負測比 **SQLSTATE + CONSTRAINT_NAME 兩者**,不只比 SQLSTATE(S1 消融 #20/#21 教訓)。
#  ③ 格數與**具名 key 集合**都由本腳本自斷言(W1),不靠人數輸出。
#  ④ 拿不到觀察值(空字串)一律判紅 —— fail-closed,不得掉進「等於期望值」的分支。
# ============================================================
set -uo pipefail
# 🔴 自身絕對路徑必須在 cd 之前算好(cd 之後相對路徑就失效了);收尾的自檢要讀本檔原始碼。
SELF_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
cd "$(dirname "${BASH_SOURCE[0]}")/.."

MODE="${1:?用法: b2s2b-verify.sh all|run <workdir>}"
case "$MODE" in all|run) : ;; *) echo "🔴 MODE 只能是 all / run(收到:$MODE)" >&2; exit 2 ;; esac
WORK="${2:?缺 workdir(必須是 /tmp 直屬短路徑,例 /tmp/b2s2bv)}"
PORT="${PORT:?🔴 PORT 必須顯式帶(plan §3.6:本支無預設值;建議 54365)}"

MIG="supabase/migrations/20260806180000_m4b_e10_b2_s2b_shipped_recompute_wire.sql"
SUMMARY="public.order_item_quantity_summary"
HELPER="public.pcm_a4a_recompute_order_item_summary(uuid)"
TG_SS="shipments_summary_recompute_ac"
export LC_ALL=C
# 🔴 使用者 rc 可覆寫 ON_ERROR_STOP / 輸出格式 ⇒ 比對值會漂。每個 psql 呼叫點另外都帶 -X。
export PSQLRC=/dev/null

# 🔴 `connect_timeout=5`(R1 nit 7):teardown 的 12 個 `drop_db` 排在 `stop_cluster` 之前,
#    postmaster 若卡在 recovery / 被 SIGSTOP,無 timeout 的 psql 會無限等 ⇒ **teardown 那條末端
#    永遠跑不到**,欠款照樣復發而且看起來像「腳本掛住了」。
BASE_URL="postgresql://postgres@127.0.0.1:${PORT}/postgres?connect_timeout=5"
ADMIN_URL="postgresql://postgres@127.0.0.1:${PORT}/template1?connect_timeout=5"

# ══ 凍結的期望格數 + 具名 key 集合(W1)═══════════════════════════════════════
# 🔴 只凍結總數擋不住「刪一格 + 重複另一格」(小線同一支腳本上中過三次)⇒ 兩者都凍。
EXPECT_CELL=25     # 行為/結構格(項 10 / 10b / 11 ×2 / 12 / 12b ×2 / 12c ×2 / 14 / 15 / 18 / 20 + 消融重證
                   #   + 同步守門對照組 + 3b 第一段三格(RB-STOPWRITE / 項26b / 項27)
                   #   + 3b 第二段一格(REH-PRODUCTS)+ 3b 第三段兩格(項22 / 項28)
                   #   + 2b 第二段之一一格(STRUCT-ORACLE)
                   #   + 2b 第二段之三三格(項29 stale-high:(a) 前態可達 /(b) 自癒 /(c) 真超出貨仍紅))
EXPECT_SMUT=9      # 環境A 結構突變靶:SMUT-0 零突變對照 + A1 降級成普通 TRIGGER(**不是** BEFORE,那個構造不出)
                   #   / A2 換 tgfoid / A3 tgattr 清空 / A4 search_path 改 public / A5 漏 REVOKE
                   #   / A6 SECURITY INVOKER / A7 DEFERRABLE INITIALLY DEFERRED / A8 多掛 INSERT 事件面(R2 F2 補)
EXPECT_BMUT=4      # 項19 barrier 靶:BMUT-0 零突變對照 + L1 鎖移到讀之後 + L2a 拿掉 ORDER BY(**實測不翻面**)
                   #   + L2b 連 DISTINCT 一起拿掉(L2a 空集合的判別力背書)
EXPECT_MUT=6       # **行為**突變靶:MUT0 對照 + 靶①②③④⑤(環境 B);環境 A 的結構靶另計於 EXPECT_SMUT
EXPECT_TMUT=16     # 文字層突變靶:T1-T5 全等半、T6/T7 per-site 半、T8 位置集合、T9 標記被刪、
                   #   S1/S2/S3 停寫/回權/搬段(3b 第一段)、
                   #   REH 拿掉 Forward 清單的 S2b、REH2 拿掉步驟④ 的出貨側 DROP(3b 第二段)、
                   #   D1 真相式多加總一欄、D2 把 gate 那句註解掉(3b 第三段)
EXPECT_TOTAL=78    # 25 格 + ID-GATE + BASE-POST + PRE-BASE + 6 行為突變 + MUT-COUNT + 16 文字層突變 + TMUT-COUNT
                   #   + 9 結構突變(含 SMUT-0)+ SMUT-COUNT
                   #   + **3** barrier 突變入 PASS 帳(BMUT-0 / L1 / L2b;**L2a 走待裁、不入帳**)
                   #   + BMUT-COUNT + BAR-PLAN-SHAPE + SELF-REPORT-BACKTICK + COVERAGE-ACCOUNT
                   #   + PORT-DEFAULTS(S2b-4b)
                   #   + 項30 註解蓋寫守門**七格**(S2b-5:三邊同源 / 常設格 / before 分支 / 維度 / 負測ⓐⓑⓒ)
                   #   + COPIES-DROPPED
# 🔴 **待裁格的 key 集合另外凍結**(R2 F1):不入 PASS 帳不代表可以消失 ——
#    沒有這一組,把那一行 run_bmut 整行刪掉會全綠。
# 🔴🔴 **機制,不是規則**(機制優先律;R1 nit 13):本檔的「覆蓋 N 格 / 沒靶 M 格」以前是**手寫字面**,
#    每加一片就漏改一次(本輪 R1 一次抓到四處自相矛盾)。改成:**兩個具名集合** + 由它們算數字
#    + 斷言「兩者相加 = `EXPECT_CELL` 且無重複」⇒ 新增一格卻忘了歸類,`COVERAGE-ACCOUNT` 當場紅。
#    🔴 這道**不驗「歸類正確」**,只驗「每一格都被歸過類、且沒有被算兩次」——
#       歸錯類仍要靠人讀突變矩陣的實跑輸出。宣稱不得超過這個面。
COVERED_CELLS="B10-shipped-lands B10b-draft-not-counted B11-void-returns B11b-void-submitted B12-unvoid-restores \
B14-c9-neg B20-helper-live TRUTH-SYNC RB-STOPWRITE REH-PRODUCTS B28-datasurface STRUCT-ORACLE \
B29b-line-self-heals B29c-real-overship-still-red"
UNCOVERED_CELLS="B12b-x3-blocks B12b-x1-blocks B12c-blocks B12c-append-only B15-c9-loadbearing \
B18-x1-commit-rollback ABLATION B26b-enable-restores B27-divergence-4th B22-pr4-hole B29a-stale-high-reachable"
nwords() { printf '%s' "$1" | tr ' ' '\n' | grep -vc '^$'; }
EXPECT_INCONC=1
EXPECT_INCONC_KEYS="BMUT-L2A-INCONCLUSIVE"
EXPECT_PASS_KEYS="ID-GATE BASE-POST PRE-BASE \
B10-shipped-lands B10b-draft-not-counted B11-void-returns B11b-void-submitted B12-unvoid-restores \
B12b-x3-blocks B12b-x1-blocks B12c-append-only B12c-blocks B14-c9-neg B15-c9-loadbearing \
B18-x1-commit-rollback B20-helper-live ABLATION \
B29a-stale-high-reachable B29b-line-self-heals B29c-real-overship-still-red \
MUT-0 MUT-1 MUT-2 MUT-3 MUT-4 MUT-5 MUT-COUNT \
STRUCT-ORACLE SMUT-0 SMUT-A1 SMUT-A2 SMUT-A3 SMUT-A4 SMUT-A5 SMUT-A6 SMUT-A7 SMUT-A8 SMUT-COUNT \
TRUTH-SYNC TMUT-1 TMUT-2 TMUT-3 TMUT-4 TMUT-5 TMUT-6 TMUT-7 TMUT-8 TMUT-9 \
BMUT-0 BMUT-L1 BMUT-L2B BMUT-COUNT \
RB-STOPWRITE TMUT-S1 TMUT-S2 TMUT-S3 B26b-enable-restores B27-divergence-4th \
REH-PRODUCTS TMUT-REH TMUT-REH2 B22-pr4-hole B28-datasurface TMUT-D1 TMUT-D2 TMUT-COUNT SELF-REPORT-BACKTICK BAR-PLAN-SHAPE COVERAGE-ACCOUNT PORT-DEFAULTS \
CFP-SAMESOURCE CFP-DISPATCH CFP-BEFORE-BRANCH CFP-DIMENSIONS CFP-MUT-A CFP-MUT-B CFP-MUT-C COPIES-DROPPED"

# 🔴 helper 四軸指紋:**測量值**,不是 migration 檔內的字面(migration 只在執行期
#    `RAISE NOTICE` 公告它,`20260806180000_…:462`;全 repo grep 這個字串只命中本行)。
#    ⇒ 它是**單一來源**,重新取得的方法寫在這裡:對已套完全前綴的庫跑
#      `SELECT md5(pg_get_functiondef('public.pcm_a4a_recompute_order_item_summary(uuid)'::regprocedure))`。
#    它一漂,代表 helper 被換過 ⇒ 本檔所有行為格驗的都不是它以為的那支函式(下方 BASE-POST 直接 die)。
MD5_HELPER_4AXIS="4ac2989a58985beae91a491a816086f7"

PASS=0; FAIL=0; CELL=0
# 🔴🔴 **第三態**(R2 must-fix F1):有一格的通過與否**不歸執行者認定**(plan §4 項19)。
#    第一版把它記成 ok ⇒ PASS 數、凍結 key 集合、離開碼三個**機器可讀**的面全部說「過了」,
#    而「未滿足 plan 字面、待裁」只活在 prose —— 往上被引用的一定是前者。
#    ⇒ 這一格改走 inconc:**不入 PASS 帳**、另外凍結它自己的 key 集合(才不會默默蒸發)、
#      收尾離開碼 3(0=全過 / 1=有紅 / 3=無紅但有待裁格)。
#    🔴 這**不是**替主視窗判它紅 —— 是拒絕在裁定之前把它記成過。裁定回來後改一行即可歸位。
INCONC=0; INCONC_KEYS=""
PASS_KEYS=""
ok()  { PASS_KEYS="$PASS_KEYS $1"; printf '  ✅ %s\n' "$2"; PASS=$((PASS+1)); }
bad() { printf '  🔴 %s\n' "$1"; FAIL=$((FAIL+1)); }
inconc() { INCONC_KEYS="$INCONC_KEYS $1"; printf '  WAIT %s\n' "$2"; INCONC=$((INCONC+1)); }
log() { echo; echo "== $* =="; }
die() { echo "🔴 $*" >&2; exit 1; }

q() { psql -X "$1" -qtA -c "$2" 2>&1; }

# ══ 0a. workdir 與埠的硬閘(照 b2s2a-verify.sh:196-210 同型)══════════════════
case "$PORT" in
  ""|*[!0-9]*) die "PORT 必須是純數字(收到:[$PORT])" ;;
  0*) die "PORT 不得有前導零(收到:$PORT)—— 前導零可繞過下面的保留埠黑名單" ;;
esac
[ "$PORT" -ge 1024 ] && [ "$PORT" -le 65535 ] || die "PORT 必須介於 1024-65535(收到:$PORT)"
# 🔴 54361 / 54363 是 plan §3.6 指派給 a1-verify / a4a-verify 的**專屬埠**(S2b-4b 落地時生效);
#    🔴 **2026-08-07 S2b-4b 已落地**:`a1-verify.sh` 改預設 **54361**、`a4a-verify.sh` 改預設 **54363**
#    ⇒ 上面那句「現在兩支都還是 54329」已兌現、不再是預告(本行就是它自己預告要做的那次更新)。
case "$PORT" in
  54329|54331|54342|54351|54353|54355|54357|54359|54361|54363)
    die "埠 $PORT 是既有 harness / 本夜跑在用的拋棄庫 / plan §3.6 已指派的專屬埠,換一個(建議 54365)" ;;
esac
while [ "${WORK%/}" != "$WORK" ]; do WORK="${WORK%/}"; done
[ -L "$WORK" ] && die "workdir 不得是 symlink(收到:$WORK)"
[ -L "$WORK/.b2s2b-throwaway" ] && die "ownership marker 不得是 symlink —— 預埋 symlink 可繞過 marker 閘"
case "$WORK" in /tmp/?*) : ;; *) die "workdir 必須在 /tmp 底下(本腳本會 rm -rf 它)" ;; esac
case "$WORK" in /tmp/*/*) die "workdir 必須是 /tmp 的直屬子目錄" ;; esac
case "$WORK" in *..*) die "workdir 不得含 .." ;; esac
[ ${#WORK} -le 40 ] || die "workdir 太長(${#WORK})—— unix socket 路徑上限 103 bytes"
test -f "$MIG" || die "找不到 $MIG"

# 🔴 把受測 migration 釘在已 commit 的那一版:本檔的期望值(四軸指紋、trigger 名、
#    conname、C9 語意)全部綁在那一版;改了 migration 就必須回頭一起更新,不是把閘拿掉。
MIG_SHA_FROZEN="f7ca9ba5877cea3306efc088764da44a4b7808a68f136fa5141027b5638bff24"
MIG_SHA_NOW="$(shasum -a 256 "$MIG" | awk '{print $1}')"
[ "$MIG_SHA_NOW" = "$MIG_SHA_FROZEN" ] || die "受測 migration 已被改動 —— 凍結 sha256 $MIG_SHA_FROZEN / 實測 $MIG_SHA_NOW。
   本 harness 的凍結值全部綁在那一版,逐項是:
     ①helper 四軸指紋 MD5_HELPER_4AXIS ②trigger 名 $TG_SS ③三個 conname
     (shipment_items_parent_open / shipments_items_presence / oiqs_shipped_le_instock)
     ④append-only 三支的 triggerdef 全等字面 ⑤EXPECT_CELL / EXPECT_TOTAL / EXPECT_PASS_KEYS
   改了 migration 就必須回頭把這些一起更新。"

# 🔴 「post-S2b」= **本檔就是 migration 目錄的時間序尾端**。
#    provision 迴圈套的是 `*.sql` 全部、沒有時間戳上界 ⇒ 日後新增更晚的 migration 會被**靜默**
#    納入「post-S2b 基準庫」,定義就漂了(plan §2.2 W2 對 pre 側的同一個警告,對稱適用)。
# 🔴 **兩個模式都要驗**(2b R1 nit 4):原本只寫在 `all` 分支內 ⇒ `run` 會在已漂移的
#    base + pre 上全綠零告警,而這道 die 訊息正是為那個情境寫的。
NEWEST_TS="$(ls supabase/migrations/*.sql | sed 's|.*/||; s|_.*||' | sort | tail -1)"
# 🔴🔴 **2026-08-07 併 dev 之後改釘**(主視窗 `B-166-A` ②-2 拍板 P1 = **基準含 dev 那三支**):
#    理由逐字 —— 那三支 `20260806200000` / `20260807120000` / `20260807130000` 在 remote **全部 pending 未 apply**
#    (主視窗以 `supabase migration list` 當場輸出佐證)、未來必套 ⇒ **基準含它們 = 對齊未來現實**。
#    釘值由 `20260806180000` 改成 `20260807130000`;`MD5_HELPER_4AXIS` 同批重量(見下方該常數)。
#    🔴 這道閘**沒有被拿掉**,只是把釘值換成新的尾端 —— 那正是它 die 訊息要求的處置。
# 🔴🔴 **2026-08-07 W0b 開工後再釘一次**(本次處置照本 die 訊息的字面辦,不是把閘拿掉):
#    新增 `20260807140000_m4b_e10_b2_w0b_shipping_idempotency.sql`(出貨冪等落腳表)。
#    **決定 = 基準含它**,理由與 `B-166-A` ②-2 那次同一條:它未來必套 ⇒ 基準含它 = 對齊未來現實。
#    🔴 它與 S2b 的被測面**無交集**(冪等帳表 vs shipped 重算)⇒ 預期 `MD5_HELPER_4AXIS` 不變;
#    但**預期不是量測** —— 釘值更新後整支重跑,由 `SA-*` 與 helper 指紋格自己說話。
# 🔴🔴 **2026-08-07 W1+W2 之後第三次釘**(處置照本 die 訊息的字面辦,不是把閘拿掉):
#    新增 `20260807150000_m4b_e10_b2_w1_shipping_rpc_skeletons.sql`(五支 writer 骨架 + ACL)與
#         `20260807160000_m4b_e10_b2_w2_shipping_idempotency_layer.sql`(冪等層:指紋/認領/重放/回填)。
#    **決定 = 基準含這兩支**,理由與前兩次同一條:兩支未來必套 ⇒ 基準含它們 = 對齊未來現實。
#    🔴 **這道閘從 W1 起就已經在紅了,而 W1 收割時沒有人重跑本檔**(W1 只重跑了 `w1-verify.sh`)
#       ⇒ 不是 W2 弄壞的,是 W2 才發現的。**跨片新增 migration 要順手重跑本檔**,已寫進 W2 的 STOP。
#    🔴 兩支與 S2b 的被測面**無交集**(RPC 骨架 / 冪等帳表 vs shipped 重算)⇒ 預期 `MD5_HELPER_4AXIS` 不變;
#       但**預期不是量測** —— 釘值更新後整支重跑,由 `SA-*` 與 helper 指紋格自己說話。
# 🔴🔴 **2026-08-07 W 線 writer 面收齊後一次補釘**(前一次釘在 `20260807160000` = W2 那天,
#    之後 W3-1/2/3、W3c-1/2、W6a、W4-1/2 陸續落檔 ⇒ 這道閘從 W3-1 起就一直在 die,無人重跑)。
#    **決定 = 基準含全部新片**,理由與前三次同一條:它們未來必套 ⇒ 基準含它們 = 對齊未來現實。
#    🔴 那些片與 S2b 的被測面**無交集**(RPC/冪等/契約 vs shipped 重算)⇒ 預期 `MD5_HELPER_4AXIS` 不變;
#       **但預期不是量測** —— 釘值更新後整支重跑,由 `SA-*` 與 helper 指紋格自己說話。
#    🔴 **本次施工窗只重釘、未重跑**(全跑成本高、且主視窗 `B-199-A` ④ 已裁「收割不重跑它、
#       職責由 W5 線級接手一半、**apply 前 preflight 重釘+全跑一次**」)⇒ 這條仍是 apply 前的欠款,
#       不得因為釘值更新了就當它已驗。
# 🔴 重釘(2026-08-09 W7d-3 落檔 `20260809020000`):該片是 **assert-only** ——
#    逐條核過 `CREATE|ALTER|DROP|GRANT|REVOKE|INSERT|UPDATE|DELETE` **全部零命中**,
#    只有一個 DO block 與一個 `COMMENT ON FUNCTION`。⇒ **結構 oracle 無需增列**
#    (閘要求的第二步在本片是 no-op,但這是查出來的、不是跳過的)。
#    `COMMENT` 不進 `pg_get_functiondef` ⇒ 任何函式體 md5 釘值也不受影響。
#    🔴 閘點名的 `MD5_HELPER_4AXIS`(:274)**不需重量**,而且這是**實測**不是推理:
#       `scripts/w7d3-verify.sh` 的 `BASE_MD5` 在被測物套用**之前**抓,`RESTORE-CLEAN` 格在
#       migration(含那句 `COMMENT ON FUNCTION`)套完之後比對 —— **相同**、該格綠。
#       ⇒ 實測證明本片沒動到 `pg_get_functiondef` 的輸出;4AXIS 是它扣掉述詞行的子集,更不會變。
#    🔴 本片同樣**只重釘、未重跑** b2s2b —— 沿用主視窗 `B-199-A` ④ 的裁定(見上方),
#       apply 前 preflight 仍要重釘+全跑一次,這條欠款不因釘值更新而消失。
# 🔴 再重釘(2026-08-09 中午,`20260809030000` P 線 COMMENT 修正落檔):
#    主視窗 `B-312-A` ② 代跑的那輪重釘只涵蓋**七支線級 w 檔**,**本檔漏了** ——
#    因為 `w7-coverage.sh` 的 `harness_set()` 用 `^w[0-9]` 撈不到 `b2s2b-verify.sh`
#    ⇒ **跑過帳看不見本檔**,`check` 27/0 的綠對這個漏**零判別力**(coverage 檔頭自記的「慣例債」)。
#    `MD5_HELPER_4AXIS` 不需重量:`20260809030000` 只有一句
#    `COMMENT ON COLUMN public.customer_addresses.email`,與 recompute helper / oiqs **零交集**(grep=0 實查)。
#    🔴 上方那句「W7d-3 落檔 20260809020000」是**歷史註記**、刻意不跟著改。
# RE-PIN 2026-08-09 pm: lifecycle L2 20260809140000 = payment retry RPC CREATE OR REPLACE
#    (mark_attempt_settle_retry / mark_webhook_retry, allowlist + 'record_not_found' only).
#    Non-shipping functions; grep recompute|order_item_qty|oiqs = 0 hits => shipping oracles
#    unchanged, no md5 re-measure needed. Main-window re-pin + full re-record.
[ "$NEWEST_TS" = "20260809140000" ] \
  || die "migration 目錄的時間序尾端是 $NEWEST_TS,不是釘住的 20260809140000 ——
   本檔的「post-S2b 基準庫」與「pre-S2b 前綴」兩個定義都已經漂了。
   處置 = 決定基準要不要含那些新片,並同批更新本行與 MD5_HELPER_4AXIS,**不是把這道閘拿掉**。"

MARK="$WORK/.b2s2b-throwaway"
MARK_SIG="b2s2b-verify.sh throwaway cluster — 本目錄可被本腳本 rm -rf"
CIDFILE="$WORK/cluster-id"
PGBIN="$(dirname "$(command -v initdb 2>/dev/null || echo /opt/homebrew/opt/postgresql@17/bin/initdb)")"

# ══ teardown:收掉**本次自己 provision 的**叢集 ═══════════════════════════════
# 欠款來源=B 窗 `B-295-STOP` ⑥ 自報 + 主視窗 `B-217-A` ③ 當輪立刻復現:
# 原本的 `trap` 只 `drop_db`、**不停 postmaster** ⇒ 每跑一次留一支活叢集,
# 要等下一次 `MODE=all` 的 provision 才被停掉;先 `rm -rf` workdir 的話還會變孤兒 postmaster。
#
# 🔴 **誰起的誰收**:只收 `all`(叢集是本次自己起的);`run` 重用別人起的 ⇒ 不收。
# 🔴 `B2S2B_KEEP_CLUSTER=1` 明確保留(給 `all` → `run` 連續調試;收尾自己負責)。
# 🔴🔴 **四道 ownership 閘,缺一不停**(R1 實測構造出「停到別人的」才補齊的):
#   ① marker 內容 ② `postmaster.pid` 的埠 ③ cluster-id ④ `SHOW data_directory`
#   —— 連不上時 ③④ 整包跳過,由 ①② 承重;其中 ② 的獨特貢獻是**把「正在跑的那支 postmaster」
#   綁到本次 PORT**(① 只證這個 workdir 是本腳本建的,不證跑在上面的是誰)。
#   R1 構造了「同 workdir、不同 PORT 的第二個視窗」⇒ `BASE_URL` 連不上 ⇒ ④ 被跳過
#   ⇒ 首版直接把別人的叢集停掉。
#   ③ 在 provision 中途 die 時可能還沒寫(`cluster-id` 在 ID-GATE 前才落檔)⇒ 不存在時
#   **不當作通過、改由 ①② 承重**,而不是放行。
stop_cluster() {
  [ "$MODE" = "all" ] || return 0
  if [ "${B2S2B_KEEP_CLUSTER:-0}" = "1" ]; then
    printf '  NOTE B2S2B_KEEP_CLUSTER=1 ⇒ 保留叢集(自己收:pg_ctl -D %s/pgdata stop)\n' "$WORK"
    return 0
  fi
  [ -d "$WORK/pgdata" ] || return 0
  [ -f "$WORK/pgdata/PG_VERSION" ] || return 0          # 不是 PG 資料目錄 ⇒ 不碰
  [ -L "$WORK/pgdata" ] && return 0                     # symlink ⇒ 不碰(同 provision 段紀律)
  # ① marker:這個 workdir 是不是本腳本建的
  [ "$(cat "$MARK" 2>/dev/null)" = "$MARK_SIG" ] || {
    printf '  WARN %s 缺 marker 或內容不符 ⇒ 不是本腳本建的,不收\n' "$WORK"; return 0; }
  # ② postmaster.pid 第 4 行 = 它正在聽的埠。**連不連得上都成立**。
  # 🔴 已知殘窗(R2 nit 2,記錄不假裝沒有):對方 postmaster **正在啟動、第 4 行還沒寫**時
  #    PMPORT 為空 ⇒ 本閘空泛通過。前提(同 workdir 併行)本身就違反 provision 段的
  #    「先驗再停 + rm -rf marker」紀律、會先在那裡撞上,現實構造不出;不為它加更多機制。
  PMPORT="$(sed -n 4p "$WORK/pgdata/postmaster.pid" 2>/dev/null)"
  if [ -n "$PMPORT" ] && [ "$PMPORT" != "$PORT" ]; then
    printf '  WARN %s/pgdata 上的 postmaster 聽的是埠 %s、本次是 %s ⇒ 別人的,不收\n' "$WORK" "$PMPORT" "$PORT"
    return 0
  fi
  # ③④ 連得上時再加驗 cluster-id 與 datadir(連不上時由 ①② 承重)
  if psql -X "$BASE_URL" -qtA -c 'SELECT 1' >/dev/null 2>&1; then
    RDD="$(psql -X "$BASE_URL" -qtAc 'SHOW data_directory' 2>/dev/null)"
    case "$RDD" in
      "$WORK/pgdata"|"$(cd "$WORK" 2>/dev/null && pwd -P)/pgdata") : ;;
      *) printf '  WARN 埠 %s 上的 postmaster data_directory=[%s],不是本 workdir ⇒ 不收\n' "$PORT" "$RDD"; return 0 ;;
    esac
    if [ -f "$CIDFILE" ]; then
      RCID="$(psql -X "$BASE_URL" -qtAc 'SELECT system_identifier FROM pg_control_system()' 2>/dev/null)"
      [ "$RCID" = "$(cat "$CIDFILE" 2>/dev/null)" ] || {
        printf '  WARN cluster-id 不符(實 %s / 期望 %s)⇒ 不收\n' "$RCID" "$(cat "$CIDFILE" 2>/dev/null)"; return 0; }
    fi
  fi
  "$PGBIN/pg_ctl" -D "$WORK/pgdata" stop -m fast >/dev/null 2>&1 || true
  # 🔴 **停完要回檢**(R1:首版 `|| true` 吞掉結果、停完不看 ⇒ 只做了動作沒觀察效果,
  #    `pg_ctl` 逾時 / PGBIN 不對 / 權限不足時欠款原樣復發且零診斷)。
  if psql -X "$BASE_URL" -qtA -c 'SELECT 1' >/dev/null 2>&1; then
    printf '  WARN teardown 後埠 %s 仍連得上 ⇒ 叢集**沒停成**(datadir %s/pgdata),請手動收\n' "$PORT" "$WORK"
  fi
}

# ══ 0b. provision:post-S2b 基準庫(**全前綴**從零重放,含本線)═════════════════
if [ "$MODE" = "all" ]; then
  if [ -e "$WORK" ]; then
    [ -f "$MARK" ] || die "$WORK 已存在但缺 ownership marker($MARK)—— 不是本腳本建的,拒絕 rm -rf"
    [ "$(cat "$MARK" 2>/dev/null)" = "$MARK_SIG" ] \
      || die "$WORK 的 marker 內容不符(可能是預埋的空檔)—— 拒絕 rm -rf"
    if [ -e "$WORK/pgdata" ] && [ ! -f "$WORK/pgdata/PG_VERSION" ]; then
      die "$WORK/pgdata 存在但不是 PG 資料目錄(無 PG_VERSION)—— 拒絕 pg_ctl stop / rm -rf"
    fi
  fi
  [ -L "$WORK/pgdata" ] && die "pgdata 不得是 symlink —— 會讓 rm -rf 打到別人的資料目錄"
  # 🔴 停機前先確認埠上那台**是本 workdir 的**(先驗再停,順序不可反)。
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
  log "0a/8 provision post-S2b 基準庫(port ${PORT};**全前綴、含 ${MIG##*/}**)"
  rm -rf "$WORK"; mkdir -p "$WORK"; printf '%s\n' "$MARK_SIG" > "$MARK"
  "$PGBIN/initdb" --version | grep -q ' 17\.' || die "PATH 的 initdb 非 PG17"
  psql -X --version | grep -q ' 17\.' || die "PATH 的 psql 非 PG17(協定相容但錯誤字面可能漂)"
  "$PGBIN/initdb" -U postgres --auth=trust --locale=C --encoding=UTF8 -D "$WORK/pgdata" >/dev/null 2>&1 \
    || die "initdb 失敗"
  "$PGBIN/pg_ctl" -D "$WORK/pgdata" -l "$WORK/pg.log" \
    -o "-p ${PORT} -c unix_socket_directories='${WORK}'" start >/dev/null \
    || { cat "$WORK/pg.log" >&2; die "pg_ctl 啟動失敗"; }
  # 🔴🔴 **叢集一起來就掛 teardown**(R1 must-fix 1):下面到 `drop_db` 那個完整 trap 之間
  #    還有十幾個 `die`(shim / migration / seed / pre 基準庫全段)——首版把 trap 只裝在
  #    那個完整版的位置 ⇒ **provision 中途失敗那條路完全沒被涵蓋**,而那正是最容易踩到的一條。
  #    R1 實測構造:`PGOPTIONS='-c default_transaction_read_only=on'` ⇒ die 在 shim ⇒ 殘留 1 支。
  #    ⇒ 這裡先掛「只收叢集」的版本;副本資料庫此時都還不存在,不需要 drop_db。
  #    後面那個完整 trap 會覆蓋本行(bash 的 trap 是覆蓋不是疊加,兩者都含 stop_cluster)。
  trap 'stop_cluster' EXIT
  psql -X "$BASE_URL" -v ON_ERROR_STOP=1 -q -f scripts/d1-supabase-shim.sql || die "shim 失敗"
  # 🔴 fitments 相容 stub 的插序沿用 d1t2 家族(public.product_fitments_effective 在 repo 內
  #    沒有任何建立來源,backlog #299)⇒ 這裡的「全綠」不等於「repo 能從零重建正式站 schema」。
  FIRST_FITMENTS="$(grep -l 'product_fitments_effective' supabase/migrations/*.sql | sort | head -1)"
  for f in supabase/migrations/*.sql; do
    case "$f" in *20260723120000*) continue ;; esac
    case "$(basename "$f")" in
      [0-9]*) : ;;
      *) die "migration 檔名不是時間戳開頭:$f" ;;
    esac
    if [ "$f" = "$FIRST_FITMENTS" ]; then
      psql -X "$BASE_URL" -v ON_ERROR_STOP=1 -q -f scripts/d1-fitments-bootstrap.sql || die "fitments bootstrap 失敗"
    fi
    psql -X "$BASE_URL" -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null || die "migration 失敗:$f"
  done
  # fixture 的上游來源 = d1t2 seed(customers / orders / order_items / suppliers / staff)。
  pnpm exec tsx scripts/d1t2-seed.ts > "$WORK/seed.sql" 2>"$WORK/seed.err" \
    || die "seed 產生失敗(見 $WORK/seed.err)"
  test -s "$WORK/seed.sql" || die "seed.sql 為空"
  psql -X "$BASE_URL" -v ON_ERROR_STOP=1 -q -f "$WORK/seed.sql" >/dev/null || die "seed 套用失敗"
  # ── 🔴 S2b-2b:pre-S2b 基準庫(突變環境的 TEMPLATE 來源)────────────────────
  # 為什麼一定要它:突變的對象是**本片 migration 檔本身** ⇒ 必須有一座「還沒套它」的庫
  #   才套得上突變版。post 庫上做不到(套第二次會撞既有物件)。
  # 🔴 定義逐字照 `scripts/b2s2a-verify.sh:274-280` 的永久警語①:
  #   **只重放時間戳早於本檔的 migration 前綴**,不是「全部減本檔」——
  #   後者在日後新增更晚的 migration 之後會把它們一起套進「pre」,定義靜默漂移。
  #   (上面那道「時間序尾端必須是本檔」的閘擋的是 post 側的同一種漂移,兩邊都要。)
  log "0b/8 provision pre-S2b 基準庫 b2s2b_pre(只重放時間戳 < 20260806180000 的前綴)"
  psql -X "$ADMIN_URL" -q -c "DROP DATABASE IF EXISTS b2s2b_pre" >/dev/null 2>&1
  psql -X "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE b2s2b_pre" >/dev/null \
    || die "建 b2s2b_pre 失敗"
  PRE_URL="postgresql://postgres@127.0.0.1:${PORT}/b2s2b_pre"
  psql -X "$PRE_URL" -v ON_ERROR_STOP=1 -q -f scripts/d1-supabase-shim.sql || die "pre:shim 失敗"
  for f in supabase/migrations/*.sql; do
    case "$f" in *20260723120000*) continue ;; esac
    # 🔴 檔名必須時間戳開頭(2b R1 nit 7:post 迴圈有這道、pre 漏抄):
    #    非時間戳檔名在 LC_ALL=C 下 `\<` 會比成 false ⇒ **靜默 continue**,那一支就沒進 pre 庫。
    case "$(basename "$f")" in
      [0-9]*) : ;;
      *) die "pre:migration 檔名不是時間戳開頭:$f" ;;
    esac
    TS="${f##*/}"; TS="${TS%%_*}"
    [ "$TS" \< "20260806180000" ] || continue
    if [ "$f" = "$FIRST_FITMENTS" ]; then
      psql -X "$PRE_URL" -v ON_ERROR_STOP=1 -q -f scripts/d1-fitments-bootstrap.sql || die "pre:fitments bootstrap 失敗"
    fi
    psql -X "$PRE_URL" -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null || die "pre:migration 失敗:$f"
  done
  psql -X "$PRE_URL" -v ON_ERROR_STOP=1 -q -f "$WORK/seed.sql" >/dev/null || die "pre:seed 套用失敗"
  psql -X "$BASE_URL" -qtAc 'SELECT system_identifier FROM pg_control_system()' > "$CIDFILE"
else
  [ -f "$MARK" ] || die "run 模式需要既有基準庫($WORK 缺 marker);先跑 all"
  [ "$(cat "$MARK" 2>/dev/null)" = "$MARK_SIG" ] || die "$WORK 的 marker 內容不符;拒絕重用"
fi

# ══ 0c. 身分閘(marker / cluster-id / datadir / locale / server 版本)═════════
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
case "$(q "$BASE_URL" 'SHOW server_version')" in 17.*) : ;; *) die "伺服器非 PG17(實為 $(q "$BASE_URL" 'SHOW server_version'))" ;; esac
ok ID-GATE "身分閘通過(marker 內容 + cluster-id + datadir + locale + server 版本)"

# ══ 0d. 基準庫真的是 post-S2b(不是「以為是」)═══════════════════════════════
BASE_MD5="$(q "$BASE_URL" "SELECT md5(pg_get_functiondef('${HELPER}'::regprocedure))")"
[ "$BASE_MD5" = "$MD5_HELPER_4AXIS" ] \
  || die "helper 指紋不符(實 $BASE_MD5 / 期望 $MD5_HELPER_4AXIS)—— 這座庫上的 helper 不是 S2b-1 那支四軸版,行為格全部無意義"
[ "$(q "$BASE_URL" "SELECT count(*) FROM pg_trigger WHERE tgname='${TG_SS}' AND NOT tgisinternal")" = "1" ] \
  || die "找不到 ${TG_SS} —— 基準庫沒套 S2b"
[ "$(q "$BASE_URL" "SELECT count(*) FROM pg_attribute WHERE attrelid='${SUMMARY}'::regclass AND attname='shipped_quantity' AND NOT attisdropped")" = "1" ] \
  || die "摘要表沒有 shipped_quantity 欄 —— 基準庫沒套 S2a"
[ "$(q "$BASE_URL" "SELECT count(*) FROM pg_constraint WHERE conrelid='${SUMMARY}'::regclass AND conname='oiqs_shipped_le_instock'")" = "1" ] \
  || die "找不到 C9(oiqs_shipped_le_instock)—— 項14/15 沒有受測對象"
# 🔴 fixture 上游存在性:缺了會讓每一格紅在「建不出 fixture」而不是「行為不對」,錯因指錯方向。
for t in customers suppliers staff order_items; do
  n="$(q "$BASE_URL" "SELECT count(*) FROM public.$t")"
  case "$n" in ""|*[!0-9]*) die "讀不到 public.$t 列數([$n])" ;; esac
  [ "$n" -gt 0 ] || die "public.$t 為 0 列 —— 這座 base 沒帶 seed,重跑 all"
done
# 🔴 起跑前出貨表必須是空的:非空代表上一輪留痕,本檔所有「回查落庫值」都會被污染。
[ "$(q "$BASE_URL" 'SELECT count(*) FROM public.shipments')" = "0" ] \
  && [ "$(q "$BASE_URL" 'SELECT count(*) FROM public.shipment_items')" = "0" ] \
  || die "基準庫的出貨表非 0 列 —— 上一輪留痕,重跑 all"
ok BASE-POST "基準庫確認為 post-S2b(helper 四軸指紋逐字相符 + ${TG_SS} 在 + C9 在 + seed 齊 + 出貨表 0 列)"

# ══ 0e. pre-S2b 基準庫真的是 pre(突變環境的前提)═══════════════════════════
# 🔴 `run` 模式重用舊 cluster 時,這座庫可能根本不存在或是舊版 ⇒ 在這裡就擋掉,
#    不要等到突變段才紅在「套不上去」。
PRE_URL="postgresql://postgres@127.0.0.1:${PORT}/b2s2b_pre"
psql -X "$PRE_URL" -qtA -c 'SELECT 1' >/dev/null 2>&1 \
  || die "連不上 pre-S2b 基準庫 b2s2b_pre —— 先跑 all(run 模式不會建它)"
# 🔴 兩向都要驗:**S2a 在**(否則本片 migration 的前置閘會擋、突變全部紅在閘而不是紅在 oracle)
#                **S2b 不在**(否則它根本不是 pre,突變版套不上去)。
[ "$(q "$PRE_URL" "SELECT count(*) FROM pg_attribute WHERE attrelid='${SUMMARY}'::regclass AND attname='shipped_quantity' AND NOT attisdropped")" = "1" ] \
  || die "pre 基準庫沒有 shipped_quantity 欄 —— 它連 S2a 都沒套,不是 pre-S2b"
[ "$(q "$PRE_URL" "SELECT count(*) FROM pg_trigger WHERE tgname='${TG_SS}' AND NOT tgisinternal")" = "0" ] \
  || die "pre 基準庫已經有 ${TG_SS} —— 它不是 pre-S2b,整段突變矩陣的判別力歸零"
[ "$(q "$PRE_URL" 'SELECT count(*) FROM public.order_items')" -gt 0 ] 2>/dev/null \
  || die "pre 基準庫沒有 seed(order_items 0 列)—— 突變環境跑不出 fixture"
# 🔴 pre 是**六發突變副本的 TEMPLATE**(2b R1 nit 6):它一髒,整個矩陣一次被污染,
#    而症狀會長得像「某幾發突變沒抓到」。與 base 側同一道起跑閘,不能只有 base 有。
[ "$(q "$PRE_URL" 'SELECT count(*) FROM public.shipments')" = "0" ] \
  && [ "$(q "$PRE_URL" 'SELECT count(*) FROM public.shipment_items')" = "0" ] \
  || die "pre 基準庫的出貨表非 0 列 —— 它被污染過,整個突變矩陣的判別力歸零;重跑 all"
ok PRE-BASE "pre-S2b 基準庫確認(S2a 的 shipped_quantity 欄**在** + ${TG_SS} **不在** + seed 齊 + 出貨表 0 列)"

# ══ 共用:從基準庫複製一份乾淨副本(只給需要真 COMMIT / DDL 的格用)═════════════
FRESH_URL=""
fresh_db() {   # $1 = db 名 → 設 FRESH_URL
  psql -X "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS $1" >/dev/null 2>&1
  if ! psql -X "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE $1 TEMPLATE postgres" >/dev/null 2>&1; then
    sleep 1
    psql -X "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE $1 TEMPLATE postgres" >/dev/null 2>&1 \
      || die "CREATE DATABASE $1 TEMPLATE postgres 兩次都失敗(基準庫可能還有連線沒關)"
  fi
  FRESH_URL="postgresql://postgres@127.0.0.1:${PORT}/$1"
}
drop_db() { psql -X "$ADMIN_URL" -q -c "DROP DATABASE IF EXISTS $1" >/dev/null 2>&1; }
# 🔴 `stop_cluster()` 定義在**上方 provision 之前**(叢集一起來就掛得上 trap);
#    這裡不重複定義,只把它併進完整版的 trap。
# 🔴 **順序**:`stop_cluster` 必須排在所有 `drop_db` **之後** ——
#    反過來的話叢集已停、`drop_db` 全部連不上,副本反而殘留。
# 🔴 `run` 模式不收叢集(誰起的誰收),但收尾講一聲 —— 欠款的原始抱怨正是
#    「預設留一支沒人知道」,對 `run` 每次都還成立(R1 nit 8)。
run_mode_notice() {
  [ "$MODE" = "run" ] || return 0
  psql -X "$BASE_URL" -qtA -c 'SELECT 1' >/dev/null 2>&1 || return 0
  printf '  NOTE run 模式重用既有叢集、不代收(誰起的誰收):pg_ctl -D %s/pgdata stop\n' "$WORK"
}
# 🔴 任何 `die` 都會跳過下方的 drop_db ⇒ 副本殘留,而下一輪 `CREATE DATABASE … TEMPLATE postgres`
#    會因為那些副本還連著而失敗、錯因指向「基準庫有連線沒關」= 指錯方向(R1 nit 13)。
# 🔴 `trap … EXIT` 對 **exit 0 / 1 / 3 三條路都生效**;本檔的常態出口正是 **exit 3**
#    (無紅但有待裁格)⇒ 漏掉 teardown 的其實是**最常走的那條**。
trap 'drop_db b2s2b_29a; drop_db b2s2b_c9; drop_db b2s2b_x1; drop_db b2s2b_mut; drop_db b2s2b_abl; drop_db b2s2b_enb; drop_db b2s2b_div; drop_db b2s2b_reh; drop_db b2s2b_pr4; drop_db b2s2b_smut; drop_db b2s2b_bar; drop_db b2s2b_cfp; run_mode_notice; stop_cluster' EXIT

# ══ 共用:fixture 前奏(每格自己建、隨交易回滾)═══════════════════════════════
# 🔴 值全部寫死且**互異**:quantity P4=4 / P6=6、receipts 2+1、shipped 2 或 3、cancelled 1。
#    互異是刻意的 —— 值撞在一起時,「守門比錯欄位」與「守門正確」會產生同樣的觀察值
#    (memory `feedback_fixture-value-makes-guard-vacuous`)。
FIXTURE='
  SELECT user_id INTO v_cust FROM public.customers ORDER BY user_id LIMIT 1;
  IF v_cust IS NULL THEN RAISE EXCEPTION "S2b fixture:customers 為空"; END IF;
  SELECT id INTO v_sup FROM public.suppliers ORDER BY id LIMIT 1;
  SELECT id INTO v_staff FROM public.staff ORDER BY id LIMIT 1;
  INSERT INTO public.orders (display_id, customer_user_id, shipping_address_snapshot, tier_at_checkout,
                             subtotal, shipping_fee, total, shipping_method, invoice)
  VALUES ("PCM-9994-0001", v_cust,
          jsonb_build_object("name","S2b 探針","phone","0900000000","line","測試地址"),
          "general"::public.member_tier, 0, 0, 0, "store", jsonb_build_object("type","personal"))
  RETURNING id INTO v_order;
  INSERT INTO public.order_items (order_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
  VALUES (v_order, "S2BV-P4", jsonb_build_object("title","s2b p4","sku","S2BV-P4","spec",jsonb_build_object()), 4, 0, 0)
  RETURNING id INTO v_i4;
  INSERT INTO public.order_items (order_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
  VALUES (v_order, "S2BV-P6", jsonb_build_object("title","s2b p6","sku","S2BV-P6","spec",jsonb_build_object()), 6, 0, 0)
  RETURNING id INTO v_i6;'
# 🔴 上面用單引號寫 SQL 會與 shell 的單引號打架 ⇒ 一律寫成 " 再在這裡換回 '。
#    (直接寫 '' 逃逸在多層 heredoc 下曾經改出過錯字面,改用單一轉換點。)
FIXTURE="$(printf '%s' "$FIXTURE" | tr '"' "'")"

# 🔴 `v_staff` 是 **text** 不是 uuid:`public.staff.id` 是 text(實查 `format_type`,值形如 `sean`),
#    `order_cancellations.actor` 同樣是 text。宣告成 uuid 會讓**每一格**都紅在 22P02
#    —— 而且錯因指向 fixture、不指向受測行為(本輪第一跑實錘)。
DECLS='DECLARE v_cust uuid; v_order uuid; v_i4 uuid; v_i6 uuid; v_sup uuid; v_staff text;
       v_ship uuid; v_ship2 uuid; v_got text; v_n integer;
       v_probe text; v_con2 text;'

# ══ 共用:格 runner ═══════════════════════════════════════════════════════════
# 🔴 兩種形狀共用同一條路徑:body 執行 → SET CONSTRAINTS ALL IMMEDIATE(強制跑掉 DEFERRED 的 X1)
#    → 由呼叫端給的 oracle 回查落庫值 → 與**寫死的期望常數**比對。
#    ⚠️ `SET CONSTRAINTS ALL IMMEDIATE` **不等於真 COMMIT**(b2s1b 檔頭同一句誠實邊界):
#       它證明「這個終態通得過所有延遲約束」,不證明正式站 commit 一定沒事。項18 才是真 COMMIT。
# ── 🔴 S2b-2b:同一組格要跑在**兩種庫**上 ────────────────────────────────────
#   ①`report` 模式 = 對照組(post-S2b 基準庫):逐格 ok/bad,計入 PASS/CELL。
#   ②`collect` 模式 = 突變環境(pre-S2b 副本 + 突變版 migration):**不計入 PASS/CELL**,
#     只把紅掉的格 key 收進 `REDS_IDS`,由突變 runner 與**指定的紅點集合**逐字比對。
#   🔴 只比「紅了幾格」會被「指定格失效 + 另一格意外轉紅」騙過(小線 codex 關卡2 實錘)
#     ⇒ 一律比**集合**。
ORACLE_URL=""; ORACLE_MODE="report"; REDS_IDS=""
cell_result() {   # $1 = key、$2 = 是否通過(0/1)、$3 = 成功訊息、$4 = 失敗訊息
  RUN_KEYS="$RUN_KEYS $1"
  if [ "$ORACLE_MODE" = "collect" ]; then
    [ "$2" -eq 0 ] || REDS_IDS="$REDS_IDS $1"
    return 0
  fi
  CELL=$((CELL+1))
  if [ "$2" -eq 0 ]; then ok "$1" "$3"; else bad "$4"; fi
}

cell_land() {   # $1 = key、$2 = body、$3 = oracle SQL、$4 = 期望值、$5 = 標籤
  local key="$1" body="$2" oracle="$3" want="$4" label="$5" got
  got="$(psql -X "$ORACLE_URL" -v ON_ERROR_STOP=0 -qtA 2>&1 <<SQL | sed -n 's/^NOTICE:  GOT:\(.*\)$/\1/p' | head -1
BEGIN;
DO \$cell\$
$DECLS
BEGIN
$FIXTURE
$body
  SET CONSTRAINTS ALL IMMEDIATE;
  SELECT ($oracle)::text INTO v_got;
  RAISE NOTICE 'GOT:%', COALESCE(v_got, '<NULL>');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'GOT:ERR:%:%', SQLSTATE, SQLERRM;
END
\$cell\$;
ROLLBACK;
SQL
)"
  # 🔴 **空觀察值必須排在相等比對之前**(2b R2 nit 2):放在後面時,未來若有人傳一個空的 `want`,
  #    「空 == 空」會走進通過那一支 = 潛伏的 fail-open。順序本身就是斷言的一部分。
  if [ -z "$got" ]; then
    cell_result "$key" 1 "" "$label —— 🔴 拿不到觀察值(測試自身異常;fail-closed 判紅)"
  elif [ "$got" = "$want" ]; then
    cell_result "$key" 0 "$label(oracle=$want)" ""
  else
    cell_result "$key" 1 "" "$label —— 期望 oracle=「$want」,實得「$got」"
  fi
}

cell_err() {   # $1 = key、$2 = 期望 SQLSTATE、$3 = 期望 conname、$4 = body、$5 = 標籤
  local key="$1" want_state="$2" want_con="$3" body="$4" label="$5" got
  got="$(psql -X "$ORACLE_URL" -v ON_ERROR_STOP=0 -qtA 2>&1 <<SQL | sed -n 's/^NOTICE:  GOT:\(.*\)$/\1/p' | head -1
BEGIN;
DO \$cell\$
$DECLS
DECLARE v_con text;
BEGIN
$FIXTURE
$body
  SET CONSTRAINTS ALL IMMEDIATE;
  RAISE NOTICE 'GOT:NOT-BLOCKED|<無>';
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
  RAISE NOTICE 'GOT:%|%', SQLSTATE, COALESCE(NULLIF(v_con, ''), '<無>');
END
\$cell\$;
ROLLBACK;
SQL
)"
  # 🔴 同上:空觀察值排最前(2b R2 nit 2)。
  if [ -z "$got" ]; then
    cell_result "$key" 1 "" "$label —— 🔴 拿不到觀察值(測試自身異常;fail-closed 判紅)"
  elif [ "$got" = "${want_state}|${want_con}" ]; then
    cell_result "$key" 0 "$label(${want_state} / CONSTRAINT=${want_con})" ""
  else
    cell_result "$key" 1 "" "$label —— 期望「${want_state}|${want_con}」,實得「$got」"
  fi
}

# ── 共用 SQL 片段(shell 變數,插進 body)────────────────────────────────────
MK_DRAFT="  INSERT INTO public.shipments (shipment_reference, customer_user_id, recipient_snapshot, carrier_code)
  VALUES ('BCDFGH', v_cust, '{\"name\":\"王小明\",\"phone\":\"0900000000\",\"line\":\"lineid\"}'::jsonb, 'hct')
  RETURNING id INTO v_ship;"
SHIP_NOW="  UPDATE public.shipments SET shipped_at = now(), tracking_number = 'S2BT1' WHERE id = v_ship;"
# 🔴 **出貨前必須先有庫存**:C9 = `shipped <= instock`,而 instock 的真相是 receipts。
#    第一跑實錘:沒有這段時,項10/11/12/18「出貨 2」全部紅在 `23514 / oiqs_shipped_le_instock`
#    —— 紅得完全正確,是我的 fixture 少了上游。留這段註解,下一棒才不會以為 C9 有問題。
# 🔴 值選 ordered=3 / receipts 2+1 = instock **3**,出貨量刻意選 **2**:
#    兩者**不得相等** —— 相等時「真相式讀錯來源(讀成 instock)」與「讀對」會產生同樣的觀察值
#    (memory `feedback_fixture-value-makes-guard-vacuous`)。
STOCK_I4="  INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity)
  VALUES (v_i4, v_sup, 3);
  INSERT INTO public.order_item_procurement_receipts (procurement_id, quantity, received_at, received_by)
  SELECT p.id, 2, now(), 'b2s2b_verify' FROM public.order_item_procurement p WHERE p.order_item_id = v_i4;
  INSERT INTO public.order_item_procurement_receipts (procurement_id, quantity, received_at, received_by)
  SELECT p.id, 1, now(), 'b2s2b_verify' FROM public.order_item_procurement p WHERE p.order_item_id = v_i4;"
# 🔴 oracle 一律回**兩維**`shipped/instock`:單看 shipped 時,「摘要列根本沒被重算」與
#    「重算後正確」在期望值是 0 的那幾格會產生同樣的觀察值(永久警語②)。
#    instock 那一維恆為 3 且來自另一條軸 ⇒ 它非 0 就證明這一列真的被 helper 寫過。
# ══ 項29 stale-high 用的共用片段(2b 第二段之三)══════════════════════════════
# 🔴 **構造法逐字照小線 C9 的註解**(`20260806100000_…:139-142`),不是直寫 shipped:
#   codex 在 plan v2-R2 抓過 —— 直寫 `shipped=3 / instock=2` 會**當場**被 C9 以 23514 擋下,
#   那證明的是「C9 會擋」,不是「stale-high 讓超額出貨靜默提交」。
# 🔴 真正的前態:採購 3 / 到貨**只有 2** ⇒ 真值 instock = 2、快取也是 2;
#   然後**直寫快取** `instock_quantity = 3` ⇒ 快取 stale-high(3)而真值仍是 2。
#   摘要表上**沒有任何 trigger**(實查 `pg_trigger` 零列)⇒ 這個直寫不會被就地修正,前態成立。
STALE_HIGH_I4="  INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity)
  VALUES (v_i4, v_sup, 3);
  INSERT INTO public.order_item_procurement_receipts (procurement_id, quantity, received_at, received_by)
  SELECT p.id, 2, now(), 'b2s2b_verify' FROM public.order_item_procurement p WHERE p.order_item_id = v_i4;
  UPDATE ${SUMMARY} SET instock_quantity = 3 WHERE order_item_id = v_i4;"
# 🔴 步驟③ 的「下一筆 A4a 重算」刻意選**採購更正**(改 allocated_quantity)而不是到貨更正:
#   它會觸發重算、但**不動 instock 的真值** ⇒ 紅或不紅只取決於「重算怎麼處理 shipped」,
#   不會被「這一步自己改了 instock」污染(fixture 不得讓待測維度與別的維度綁在一起)。
BUMP_PROCUREMENT="  UPDATE public.order_item_procurement SET allocated_quantity = 4 WHERE order_item_id = v_i4;"
# 🔴 兩步各自包在**子交易**裡,觀察值同時帶出「步驟② 有沒有過」與「步驟③ 紅在哪」——
#   plan 項29(a) 逐字要求「斷言紅的是步驟③那筆、不是步驟②」,只比一個 SQLSTATE 分不出來。
PROBE_2_3="  BEGIN
    UPDATE ${SUMMARY} SET shipped_quantity = 3 WHERE order_item_id = v_i4;
    v_probe := 'step2=ok';
  EXCEPTION WHEN OTHERS THEN
    v_probe := 'step2=' || SQLSTATE;
  END;
  BEGIN
$BUMP_PROCUREMENT
    v_probe := v_probe || '|step3=ok';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_con2 = CONSTRAINT_NAME;
    v_probe := v_probe || '|step3=' || SQLSTATE || '/' || COALESCE(NULLIF(v_con2, ''), '<無>');
  END;"

SHIPPED_OF_I4="SELECT shipped_quantity::text || '/' || instock_quantity::text FROM ${SUMMARY} WHERE order_item_id = v_i4"

# ══ 行為 oracle:同一組格,跑在對照組庫與每一個突變庫上 ═══════════════════════
# 🔴 每格各自包成一支函式**放在它原本的位置**(不搬動),由下方 `beh_oracle` 依序呼叫。
#    這樣「格的定義」只有一份 —— plan §2 不拆 2b 的理由正是「拆開會讓 fixture 定義出現兩份」。
CELL_B10() {
# ── 項10:建箱掛品項 → UPDATE shipped_at → shipped = 該量 ──────────────────
cell_land B10-shipped-lands \
"$STOCK_I4
$MK_DRAFT
  INSERT INTO public.shipment_items (shipment_id, order_item_id, shipped_quantity) VALUES (v_ship, v_i4, 2);
$SHIP_NOW" \
  "$SHIPPED_OF_I4" "2/3" \
  "項10 正測:進貨 3 → 建箱掛品項(2)→ 設 shipped_at ⇒ 摘要 shipped/instock 落庫 = 2/3"
}

CELL_B10b() {
# ── 項10b:草稿箱(有品項、未設 shipped_at)⇒ shipped 仍 0 ────────────────
# 🔴 這一格的 0 **不能單獨當觀察值**(永久警語②):沒建成 fixture 時同樣是 0/沒有列。
#    ⇒ oracle 回「品項列數 / shipped / instock」三維,期望 `1/0/3` —— 前後兩維非 0,
#      證明箱子真的有貨、摘要列真的被重算過。
# 🔴🔴 **`PERFORM` 那一行(下方)為什麼不可以刪**(R1 must-fix 1 更正我原本寫錯的理由):
#    摘要列**不是**它建的 —— `STOCK_I4` 的 `INSERT order_item_procurement` 就已觸發
#    `order_item_procurement_summary_recompute_zc`(`20260803140000:409-413`)建好了列
#    (instock=3、shipped=0)。`PERFORM` 的真正作用是**把最後一次重算挪到掛品項之後**。
#    少了它,「真相式漏掉 `shipped_at IS NOT NULL`」那個突變(2b 靶③,唯一 oracle = 本格)
#    會存活而本格照樣綠 —— 因為最後一次重算發生在品項還不存在的時候。**它是本格的判別力本身。**
# 🔴 這一格也要進貨 3:草稿箱裡放的量刻意也是 **3**,讓「真相式漏掉 shipped_at IS NOT NULL」
#    這個突變(2b 的靶③)算出來的是**合法的 3**、只在值上翻面 —— 沒有庫存的話它會紅在 C9,
#    那是紅對了但**紅在別的理由**,靶就殺不到這一格(memory `feedback_negative-test-...`)。
cell_land B10b-draft-not-counted \
"$STOCK_I4
$MK_DRAFT
  INSERT INTO public.shipment_items (shipment_id, order_item_id, shipped_quantity) VALUES (v_ship, v_i4, 3);
  PERFORM public.pcm_a4a_recompute_order_item_summary(v_i4);" \
  "(SELECT count(*) FROM public.shipment_items WHERE order_item_id = v_i4)::text || '/' ||
   ($SHIPPED_OF_I4)" "1/0/3" \
  "項10b 草稿箱格:掛了品項(1 列、量 3、庫存 3)但沒設 shipped_at ⇒ 真相式的 shipped_at IS NOT NULL 把它排除,shipped = 0"
}

# 🔴 三格共用的前提斷言(R1 nit 6):作廢/unvoid **之前** shipped 必須真的是 2。
#    少了它,期望值 0 的那兩格會與「這條路徑從頭到尾沒把 shipped 寫上去」共用同一個觀察值;
#    非 0 的 instock 維是 **receipts 軸**寫的(`20260803140000:415-418`),證不到「作廢事件觸發了重算」。
#    形狀與 B14 的前提斷言(下方)同構,不另立一種寫法。
PRE_SHIPPED_2="  SELECT shipped_quantity INTO v_n FROM ${SUMMARY} WHERE order_item_id = v_i4;
  IF v_n IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION '前提破了:作廢/unvoid 之前 shipped 應為 2,實為 %(這條路徑沒把 shipped 寫上去,不是作廢的事)', COALESCE(v_n::text, '<無列>');
  END IF;"

CELL_B11() {
# ── 項11:已出貨 → 作廢 ⇒ 退量 ────────────────────────────────────────────
cell_land B11-void-returns \
"$STOCK_I4
$MK_DRAFT
  INSERT INTO public.shipment_items (shipment_id, order_item_id, shipped_quantity) VALUES (v_ship, v_i4, 2);
$SHIP_NOW
$PRE_SHIPPED_2
  UPDATE public.shipments SET deleted_at = now(), void_reason = '裝錯箱' WHERE id = v_ship;" \
  "$SHIPPED_OF_I4" "0/3" \
  "項11 Q3=A 退量:已出貨(2)後作廢 ⇒ 摘要 shipped 退回 0(instock 仍 3 ⇒ 這一列真的被重算過,不是沒建)"
}

CELL_B11b() {
# ── 項11b:submitted 態(已送新竹)+ 已出貨 → 作廢 ⇒ 一樣退量 ─────────────
# 🔴 X4 要求 submitted 必須有非空白的 hct_request_id;X1 要求離開草稿態時必有品項。
cell_land B11b-void-submitted \
"$STOCK_I4
$MK_DRAFT
  INSERT INTO public.shipment_items (shipment_id, order_item_id, shipped_quantity) VALUES (v_ship, v_i4, 2);
  UPDATE public.shipments SET hct_status = 'submitted', hct_request_id = 'HCTREQ-1' WHERE id = v_ship;
$SHIP_NOW
$PRE_SHIPPED_2
  UPDATE public.shipments SET deleted_at = now(), void_reason = '客戶取消' WHERE id = v_ship;" \
  "$SHIPPED_OF_I4" "0/3" \
  "項11 第二半:submitted(已送新竹)且已出貨的箱子作廢 ⇒ 一樣退回 0(狀態欄不影響真相式)"
}

CELL_B12() {
# ── 項12:由「已出貨作廢態」unvoid ⇒ 回升 ────────────────────────────────
# 🔴 X7 是雙向配對((deleted_at IS NULL) = (void_reason IS NULL))⇒ unvoid 必須兩欄一起清。
# 🔴 plan 項12 的字面是「unvoid 回升(**含**由已出貨作廢態 unvoid)」—— 本格做的就是括號內那個。
#    另一個可能的讀法(從未出貨的作廢箱 unvoid)**刻意不做**:那條路徑的觀察值是 0 → 0,
#    真相式怎麼寫都成立 = 恆真格,加了只是把格數變好看。理由寫在這裡,不是省略。
# 🔴🔴 **中途斷言不可省**(2b R1 must-fix 4:本格原本是恆綠格):
#    只斷言「最後是 2」時,任何讓 void 與 unvoid **都不發火**的突變(例如靶④ 拿掉
#    `deleted_at` 事件面)會讓值全程凍在 2 ⇒ 本格照樣綠,而它宣稱在證的「unvoid 回升」
#    根本沒被觀察到。⇒ 中間插一道「作廢後必須是 0」,讓 2 → 0 → 2 三個點都被釘住。
cell_land B12-unvoid-restores \
"$STOCK_I4
$MK_DRAFT
  INSERT INTO public.shipment_items (shipment_id, order_item_id, shipped_quantity) VALUES (v_ship, v_i4, 2);
$SHIP_NOW
$PRE_SHIPPED_2
  UPDATE public.shipments SET deleted_at = now(), void_reason = '誤作廢' WHERE id = v_ship;
  SELECT shipped_quantity INTO v_n FROM ${SUMMARY} WHERE order_item_id = v_i4;
  IF v_n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '項12 中途斷言破了:作廢後 shipped 應為 0,實為 %(value 全程凍住 ⇒ 本格量不到 unvoid 回升)', COALESCE(v_n::text, '<無列>');
  END IF;
  UPDATE public.shipments SET deleted_at = NULL, void_reason = NULL WHERE id = v_ship;" \
  "$SHIPPED_OF_I4" "2/3" \
  "項12 unvoid 回升:由已出貨作廢態 unvoid ⇒ shipped 回到 2(deleted_at 事件面真的掛上了)"
}

CELL_B12b_x3() {
# ── 項12b 第一格:INSERT 帶 shipped_at + 加品項 ⇒ 必被 X3 擋 ────────────────
cell_err B12b-x3-blocks P0001 shipment_items_parent_open \
"  INSERT INTO public.shipments (shipment_reference, customer_user_id, recipient_snapshot, carrier_code, tracking_number, shipped_at)
  VALUES ('BCDFGJ', v_cust, '{\"name\":\"王小明\",\"phone\":\"0900000000\",\"line\":\"lineid\"}'::jsonb, 'hct', 'S2BT2', now())
  RETURNING id INTO v_ship;
  INSERT INTO public.shipment_items (shipment_id, order_item_id, shipped_quantity) VALUES (v_ship, v_i4, 2);" \
  "🔴 項12b-①:INSERT 一筆帶 shipped_at 的包裹再加品項 ⇒ 被 X3 擋(這條倒了,shipped 會有 UPDATE 以外的來源)"
}

CELL_B12b_x1() {
# ── 項12b 第二格:INSERT 帶 shipped_at 但不加品項 ⇒ COMMIT 時必被 X1 擋 ────
cell_err B12b-x1-blocks P0001 shipments_items_presence \
"  INSERT INTO public.shipments (shipment_reference, customer_user_id, recipient_snapshot, carrier_code, tracking_number, shipped_at)
  VALUES ('BCDFGK', v_cust, '{\"name\":\"王小明\",\"phone\":\"0900000000\",\"line\":\"lineid\"}'::jsonb, 'hct', 'S2BT3', now())
  RETURNING id INTO v_ship;" \
  "🔴 項12b-②:同一筆 INSERT 但不加品項 ⇒ 延遲檢查 X1 擋下(兩條路都不通 = §0.3 前提成立)"
}

CELL_B12c_blocks() {
# ── 項12c 行為面:三支真的會擋 ────────────────────────────────────────────
# 🔴 結構面(上一格)證不到「它真的會擋」—— 只有把一筆已入箱的品項拿去 UPDATE 才證得到。
#    這一格是「守門畫在不變量成立的面」的行為那半:改壞 body 而保留外殼時,上一格靠 md5 紅、
#    本格靠 `NOT-BLOCKED` 紅,兩層各自獨立。
cell_err B12c-blocks P0001 shipment_items_append_only \
"$MK_DRAFT
  INSERT INTO public.shipment_items (shipment_id, order_item_id, shipped_quantity) VALUES (v_ship, v_i4, 2);
  UPDATE public.shipment_items SET shipped_quantity = 9 WHERE shipment_id = v_ship;" \
  "🔴 項12c 行為面:改一筆已入箱品項的數量 ⇒ append-only 擋下(P0001 + conname)——「改箱」這條路真的不通"
}

# ── 項14:C9 擋得住重算寫出來的超額 shipped ────────────────────────────────
# fixture 四值互異 4 / 2 / 1 / 3(plan §4 項14 逐字):
#   quantity=4、receipts 2+1(instock 3 → 刪掉 quantity=1 那筆後 2)、shipped=3。
#   刪除前:C4 3≤4 ✓ C5 3≤3 ✓ C7 3+0≤4 ✓ C6′ 0+3≤4 ✓ C9 3≤3 ✓ ⇒ 全過。
#   刪除後:instock 2、shipped 3 ⇒ **只有 C9 被違反**(3>2);
#   四個值互異讓「比錯欄位」的錯式(shipped≤quantity=4、shipped≤ordered=3)照樣放行
#   ⇒ 紅在 C9 是可歸因的,不是碰巧。
C9_BODY="  INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity)
  VALUES (v_i4, v_sup, 3);
  INSERT INTO public.order_item_procurement_receipts (procurement_id, quantity, received_at, received_by)
  SELECT p.id, 2, now(), 'b2s2b_verify' FROM public.order_item_procurement p WHERE p.order_item_id = v_i4;
  INSERT INTO public.order_item_procurement_receipts (procurement_id, quantity, received_at, received_by)
  SELECT p.id, 1, now(), 'b2s2b_verify' FROM public.order_item_procurement p WHERE p.order_item_id = v_i4;
$MK_DRAFT
  INSERT INTO public.shipment_items (shipment_id, order_item_id, shipped_quantity) VALUES (v_ship, v_i4, 3);
$SHIP_NOW
  SELECT shipped_quantity INTO v_n FROM ${SUMMARY} WHERE order_item_id = v_i4;
  IF v_n IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION '項14 前提破了:出貨後 shipped 應為 3,實為 %(fixture 沒建成,不是 C9 的事)', COALESCE(v_n::text, '<無列>');
  END IF;
  DELETE FROM public.order_item_procurement_receipts r
   USING public.order_item_procurement p
   WHERE r.procurement_id = p.id AND p.order_item_id = v_i4 AND r.quantity = 1;"
CELL_B14() {
cell_err B14-c9-neg 23514 oiqs_shipped_le_instock "$C9_BODY" \
  "🔴 項14 C9 負測:instock 3→2(刪掉 quantity=1 那筆到貨)而 shipped 已是 3 ⇒ 重算被 C9 擋(23514 + conname)"
}

CELL_B15() {
# ── 項15:C9 承重性 —— DROP 掉之後同一條路徑必須**全綠** ────────────────────
# 🔴 仍被擋 = C9 不是承重件、§1 的蘊含圖錯了(plan §4 項15 逐字)。
#    走 fresh copy 而不是交易內 DDL:DROP CONSTRAINT 後要跑的是**同一段 body**,
#    留在同一個交易裡會讓「被誰擋下」多一層可能性。
CELL=$((CELL+1))
fresh_db b2s2b_c9; C9_URL="$FRESH_URL"
psql -X "$C9_URL" -v ON_ERROR_STOP=1 -q \
  -c "ALTER TABLE ${SUMMARY} DROP CONSTRAINT oiqs_shipped_le_instock" >/dev/null 2>&1 \
  || die "項15:DROP C9 失敗(這座副本不是 post-S2a?)"
C9_DROPPED="$(psql -X "$C9_URL" -qtA -c "SELECT count(*) FROM pg_constraint WHERE conrelid='${SUMMARY}'::regclass AND conname='oiqs_shipped_le_instock'" 2>&1)"
[ "$C9_DROPPED" = "0" ] || die "項15:C9 竟然還在(實得 [$C9_DROPPED])—— 承重性測試的前提沒成立"
C9_OFF_GOT="$(psql -X "$C9_URL" -v ON_ERROR_STOP=0 -qtA 2>&1 <<SQL | sed -n 's/^NOTICE:  GOT:\(.*\)$/\1/p' | head -1
BEGIN;
DO \$cell\$
$DECLS
BEGIN
$FIXTURE
$C9_BODY
  SET CONSTRAINTS ALL IMMEDIATE;
  SELECT (SELECT shipped_quantity FROM ${SUMMARY} WHERE order_item_id = v_i4)::text || '/' ||
         (SELECT instock_quantity FROM ${SUMMARY} WHERE order_item_id = v_i4)::text INTO v_got;
  RAISE NOTICE 'GOT:%', COALESCE(v_got, '<NULL>');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'GOT:ERR:%:%', SQLSTATE, SQLERRM;
END
\$cell\$;
ROLLBACK;
SQL
)"
if [ "$C9_OFF_GOT" = "3/2" ]; then
  ok B15-c9-loadbearing "🔴 項15 C9 承重性:DROP 掉 C9 之後同一條路徑**全綠**,終態 shipped=3 > instock=2 ⇒ C9 確實是唯一承重件"
elif [ -z "$C9_OFF_GOT" ]; then
  bad "項15:拿不到觀察值(測試自身異常;fail-closed 判紅)"
else
  bad "項15 C9 承重性:期望「3/2」(全綠且呈超額),實得「$C9_OFF_GOT」—— 仍被擋代表承重件不是 C9,§1 蘊含圖要重畫"
fi
drop_db b2s2b_c9
}

CELL_B18() {
# ── 項18 ─────────────────────────────────────────────────────────────────
# 🔴 這是全檔唯一用**真 COMMIT** 的一格:X1 是 DEFERRED,它的失敗只在 COMMIT 當下發生。
#    `SET CONSTRAINTS ALL IMMEDIATE` 證不到「COMMIT 失敗後外面看到什麼」。
# 🔴 fixture 必須**先 commit** 才能在交易外回查(否則 0/0/0 是因為 fixture 也回滾了,
#    那是永久警語②那個恆真陷阱)⇒ 走 fresh copy,fixture 單獨 commit。
# 🔴 交易內另外 RAISE NOTICE 出「摘要當下確實被寫成 2」,證明回滾前真的有東西可回滾。
CELL=$((CELL+1))
fresh_db b2s2b_x1; X1_URL="$FRESH_URL"
psql -X "$X1_URL" -v ON_ERROR_STOP=1 -q >/dev/null 2>&1 <<SQL || die "項18:fixture commit 失敗(含庫存 —— 少了它出貨 2 會紅在 C9,錯因指錯方向)"
DO \$fx\$
$DECLS
BEGIN
$FIXTURE
$STOCK_I4
END
\$fx\$;
SQL
X1_ITEM="$(psql -X "$X1_URL" -qtAc "SELECT id FROM public.order_items WHERE variant_sku = 'S2BV-P4'" 2>&1)"
case "$X1_ITEM" in
  ????????-????-????-????-????????????) : ;;
  *) die "項18:取不到已 commit 的 fixture 品項([$X1_ITEM])" ;;
esac
X1_OUT="$(psql -X "$X1_URL" -v ON_ERROR_STOP=0 -v VERBOSITY=verbose -qtA 2>&1 <<SQL
BEGIN;
DO \$x1\$
DECLARE v_cust uuid; v_i4 uuid; v_ship uuid; v_ship2 uuid; v_n integer;
BEGIN
  SELECT customer_user_id INTO v_cust FROM public.orders WHERE display_id = 'PCM-9994-0001';
  SELECT id INTO v_i4 FROM public.order_items WHERE variant_sku = 'S2BV-P4';
  -- 第一箱:正常出貨 ⇒ 重算把摘要寫成 2
  INSERT INTO public.shipments (shipment_reference, customer_user_id, recipient_snapshot, carrier_code)
  VALUES ('BCDFGM', v_cust, '{"name":"王小明","phone":"0900000000","line":"lineid"}'::jsonb, 'hct')
  RETURNING id INTO v_ship;
  INSERT INTO public.shipment_items (shipment_id, order_item_id, shipped_quantity) VALUES (v_ship, v_i4, 2);
  UPDATE public.shipments SET shipped_at = now(), tracking_number = 'S2BT4' WHERE id = v_ship;
  SELECT shipped_quantity INTO v_n FROM public.order_item_quantity_summary WHERE order_item_id = v_i4;
  RAISE NOTICE 'INTXN:%', COALESCE(v_n::text, '<無列>');
  -- 第二箱:離開草稿態但零品項 ⇒ X1 會在 COMMIT 當下炸,整筆交易一起回滾
  INSERT INTO public.shipments (shipment_reference, customer_user_id, recipient_snapshot, carrier_code, hct_status, hct_request_id)
  VALUES ('BCDFGN', v_cust, '{"name":"王小明","phone":"0900000000","line":"lineid"}'::jsonb, 'hct', 'submitted', 'HCTREQ-9')
  RETURNING id INTO v_ship2;
END
\$x1\$;
COMMIT;
SQL
)"
# 🔴 `-v VERBOSITY=verbose` 會在 `NOTICE:  ` **之後插入 SQLSTATE** ——
#    實測(PG17,port 54365)拿到的是 `NOTICE:  00000: INTXN:2`,**不是**加位置前綴。
#    ⇒ 錨成 `^NOTICE:  INTXN:` 會抓不到、那一維靜默變空字串(本輪第一跑實錘)。改成不錨前段。
#    🔴 下面 `^ERROR:  ` 那條之所以還能用,是同一個機制:verbose 讓 ERROR 行變成
#    `ERROR:  P0001: …`,SQLSTATE 剛好落在被抓的位置。**兩條都依賴這件事,改一條要想到另一條。**
X1_INTXN="$(printf '%s' "$X1_OUT" | sed -n 's/.*INTXN:\(.*\)$/\1/p' | head -1)"
X1_ERR="$(printf '%s' "$X1_OUT" | grep -m1 '^ERROR:' | sed -n 's/^ERROR:  \([0-9A-Z]*\).*/\1/p')"
X1_CON="$(printf '%s' "$X1_OUT" | sed -n 's/^CONSTRAINT NAME:  *\(.*\)$/\1/p' | head -1)"
# 🔴 摘要那一維**不能數列數**:fixture 的進貨(STOCK_I4)在 commit 當下就經 A4a 建好了摘要列
#    ⇒ 那一列本來就在,期望 0 列是錯的期望(本輪實錘,實得 0/0/1)。
#    正確的觀察 = 那一列的 **shipped 回到 0**、而 instock 仍是 3(證明列是真的、不是讀不到)。
X1_AFTER="$(psql -X "$X1_URL" -qtAc \
  "SELECT (SELECT count(*) FROM public.shipments)::text || '/' ||
          (SELECT count(*) FROM public.shipment_items)::text || '/' ||
          (SELECT shipped_quantity::text || '/' || instock_quantity::text
             FROM public.order_item_quantity_summary WHERE order_item_id = '$X1_ITEM')" 2>&1)"
X1_OBS="${X1_INTXN}|${X1_ERR}|${X1_CON}|${X1_AFTER}"
if [ "$X1_OBS" = "2|P0001|shipments_items_presence|0/0/0/3" ]; then
  ok B18-x1-commit-rollback "🔴 項18:交易內摘要確實被寫成 shipped=2 → X1 在**真 COMMIT** 炸(P0001/shipments_items_presence)→ 交易外回查 shipments=0 / shipment_items=0 / 摘要 shipped=0(instock 仍 3)⇒ 兩邊都回滾"
else
  bad "項18:期望「2|P0001|shipments_items_presence|0/0/0/3」,實得「$X1_OBS」
     (六維依序 = 交易內觀察到的 shipped / COMMIT 的 SQLSTATE / conname / 交易外 shipments 列數 / shipment_items 列數 / 摘要 shipped/instock)"
fi
drop_db b2s2b_x1
}

CELL_B20() {
# ── 項20 ─────────────────────────────────────────────────────────────────
# 五值互異 quantity=6 / ordered=5 / instock=4 / cancelled=1 / shipped=2:
#   C4 5≤6 ✓ C5 4≤5 ✓ C7 4+1≤6 ✓ C6′ 1+2≤6 ✓ C9 2≤4 ✓。
# 🔴 「rc=0」不是證據(plan §4 通則)⇒ 先把摘要**四軸**蓋成 0,再直呼 helper,回查新值。
#    四軸若有任一軸沒被 helper 寫回,這格就會停在 0。
# 🔴 oracle 的第一維 `quantity` **不具判別力,是報表維**(R1 nit 7):它由 A1 的複合 FK
#    物理釘在 `order_items.quantity` 上,蓋不動也不會被 helper 以外的東西改 ⇒ 恆為 6。
#    真正被證明的是後四維。留著只是讓輸出一眼看得出 fixture 是哪一組。
cell_land B20-helper-live \
"  INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity)
  VALUES (v_i6, v_sup, 5);
  INSERT INTO public.order_item_procurement_receipts (procurement_id, quantity, received_at, received_by)
  SELECT p.id, 3, now(), 'b2s2b_verify' FROM public.order_item_procurement p WHERE p.order_item_id = v_i6;
  INSERT INTO public.order_item_procurement_receipts (procurement_id, quantity, received_at, received_by)
  SELECT p.id, 1, now(), 'b2s2b_verify' FROM public.order_item_procurement p WHERE p.order_item_id = v_i6;
  INSERT INTO public.order_cancellations (order_id, reason_code, idempotency_key, payload_hash, actor)
  VALUES (v_order, 'customer_request', gen_random_uuid(), encode(sha256('b2s2b-c1'::bytea), 'hex'), v_staff);
  INSERT INTO public.order_cancellation_items (cancellation_id, order_id, order_item_id, cancelled_quantity)
  SELECT c.id, v_order, v_i6, 1 FROM public.order_cancellations c WHERE c.order_id = v_order;
$MK_DRAFT
  INSERT INTO public.shipment_items (shipment_id, order_item_id, shipped_quantity) VALUES (v_ship, v_i6, 2);
$SHIP_NOW
  UPDATE ${SUMMARY}
     SET ordered_quantity = 0, instock_quantity = 0, cancelled_quantity = 0, shipped_quantity = 0
   WHERE order_item_id = v_i6;
  PERFORM public.pcm_a4a_recompute_order_item_summary(v_i6);" \
  "(SELECT quantity::text || '/' || ordered_quantity::text || '/' || instock_quantity::text || '/' ||
           cancelled_quantity::text || '/' || shipped_quantity::text
      FROM ${SUMMARY} WHERE order_item_id = v_i6)" "6/5/4/1/2" \
  "🔴 項20 四軸活體:摘要四軸先被蓋成 0 → 直呼 helper → ordered/instock/cancelled/shipped 回到 5/4/1/2(前綴的 quantity=6 是報表維、由複合 FK 釘死,不具判別力)"
}

# ── 項12c 結構面:三支 append-only 的外殼 + 函式本體 md5 ────────────────────
# 🔴 為什麼要這一格(plan §4 項12c / Fable 翻案條件③):X3 / X1 只擋「加品項」與「零品項出貨」,
#    **改/刪已寄出箱的品項**是這三支在擋。它們被放寬時,shipped 真值變動不經 UPDATE shipments
#    ⇒ 本線 trigger 不發火、摘要靜默漂移,而項 10-12 全綠。
# 🔴 `tgenabled` 是 "char" 不是 text,不 cast 會 42725 operator is not unique(2026-08-06 實錘)。
# 🔴🔴 **必須連函式本體一起 pin**(2a 的 R1 must-fix 2):三支 trigger 指的是同一支函式,
#    把 body 換成 `RETURN NEW`,`tgname / tgenabled / pg_get_triggerdef` **逐字都不會變**
#    ⇒ 只比外殼的話本格全綠,而「改/刪已寄出箱品項」已經全面放行
#    (memory `feedback_guard-checks-existence-not-effect`)。
# 🔴 本格**只跑在對照組庫**:它驗的是 **S1b** 的產物,S2b 的突變動不到它 ⇒ 放進突變 oracle
#    只會製造一格恆綠的雜訊。理由寫在這裡,不是漏掉。
APPEND_ONLY_FN="public.pcm_b2_shipment_items_append_only()"
APPEND_ONLY_EXPECT="shipment_items_block_delete_bd|O|CREATE TRIGGER shipment_items_block_delete_bd BEFORE DELETE ON public.shipment_items FOR EACH ROW EXECUTE FUNCTION pcm_b2_shipment_items_append_only()
shipment_items_block_truncate_bt|O|CREATE TRIGGER shipment_items_block_truncate_bt BEFORE TRUNCATE ON public.shipment_items FOR EACH STATEMENT EXECUTE FUNCTION pcm_b2_shipment_items_append_only()
shipment_items_block_update_bu|O|CREATE TRIGGER shipment_items_block_update_bu BEFORE UPDATE ON public.shipment_items FOR EACH ROW EXECUTE FUNCTION pcm_b2_shipment_items_append_only()
FN|cf589a111f46fd9ce9f2fc960b21c5ad"
CELL_B12c_struct() {
CELL=$((CELL+1))
# 🔴 兩段**分開查再在 shell 併**:`ORDER BY` 之後接 `UNION ALL` 在 PG 是語法錯(2a 實測),
#    而把 ORDER BY 塞進子查詢又是靠未保證的順序保留 —— 兩個都不做。
APPEND_ONLY_TG="$(psql -X "$BASE_URL" -qtA -c \
  "SELECT t.tgname || '|' || t.tgenabled::text || '|' || pg_get_triggerdef(t.oid)
     FROM pg_trigger t
    WHERE t.tgrelid = 'public.shipment_items'::regclass
      AND t.tgname LIKE 'shipment_items_block_%'
      AND NOT t.tgisinternal
    ORDER BY t.tgname" 2>&1)"
APPEND_ONLY_FP="$(psql -X "$BASE_URL" -qtA -c \
  "SELECT 'FN|' || md5(pg_get_functiondef('${APPEND_ONLY_FN}'::regprocedure))" 2>&1)"
APPEND_ONLY_NOW="$APPEND_ONLY_TG
$APPEND_ONLY_FP"
if [ "$APPEND_ONLY_NOW" = "$APPEND_ONLY_EXPECT" ]; then
  ok B12c-append-only "🔴 項12c 結構面:append-only 三支(delete/update/truncate)全在、全 enabled=O、triggerdef 逐字全等,**且函式本體 md5 逐字相符**(換 body 保留外殼那一發殺得死)"
else
  bad "項12c:append-only 的外殼或本體不符(**全等比對**,不是存在性)。實得:
$APPEND_ONLY_NOW"
fi
}

# ══ 行為 oracle 的呼叫序(**唯一一份**,對照組與每個突變靶共用)════════════════
# 🔴 這一組(格數見 `BEH_KEYS`,執行期由 `$BEH_N` 印出)是「S2b 的行為面」⇒ 每個突變都要拿它們當 oracle。
#    B12c 結構面 / B15 / B18 **不在**這裡:前者驗的是 S1b 產物,後兩者自己開副本庫
#    (`fresh_db` 從 `postgres` 複製),在突變環境下複製到的會是**未突變**的基準庫 ⇒
#    放進來會是三格恆綠的雜訊。誠實列出,不是漏掉。
CELL_B29a() {
  local db="b2s2b_29a" saved="$ORACLE_URL"
  psql -X "$ADMIN_URL" -q -c "DROP DATABASE IF EXISTS $db" >/dev/null 2>&1
  if ! psql -X "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE $db TEMPLATE b2s2b_pre" >/dev/null 2>&1; then
    sleep 1
    psql -X "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE $db TEMPLATE b2s2b_pre" >/dev/null 2>&1 \
      || { bad "項29(a):複製 pre 副本失敗 —— 這一格沒有跑"; return; }
  fi
  ORACLE_URL="postgresql://postgres@127.0.0.1:${PORT}/$db"
  # 🔴 期望值的意義:step2=ok = **超額出貨零違規提交**(這就是「靜默」);
  #    step3 紅在 23514 / oiqs_shipped_le_instock = **紅在無辜的採購更正那一筆**,離真凶任意遠。
  cell_land B29a-stale-high-reachable \
"$STALE_HIGH_I4
$PROBE_2_3" \
    "v_probe" "step2=ok|step3=23514/oiqs_shipped_le_instock" \
    "🔴 項29(a) 前態可達(**pre-S2b 基準**):stale-high 快取讓 shipped=3 零違規寫入,下一筆採購更正才紅"
  ORACLE_URL="$saved"
  drop_db "$db"
}
CELL_B29b() {
  # 🔴 本線自癒:同一組前態,套上本線之後第一次重算會**把 shipped 重算成真值**(此處真值 = 0,
  #    因為沒有任何已寄出的 shipment_items)⇒ 殘留消失、且**那一筆交易不紅**。
  #    觀察值同時帶 shipped 與 instock 兩維:只看「沒紅」分不出「自癒了」與「重算根本沒跑」。
  cell_land B29b-line-self-heals \
"$STALE_HIGH_I4
$PROBE_2_3" \
    "v_probe || '|' || (SELECT shipped_quantity::text || '/' || instock_quantity::text FROM ${SUMMARY} WHERE order_item_id = v_i4)" \
    "step2=ok|step3=ok|0/2" \
    "🔴 項29(b) 本線自癒:重算把殘留 shipped 3 修回真值 0、instock 修回真值 2,該筆交易不紅"
}
CELL_B29c() {
  # 🔴 負向安全格:真值本身就超出貨(shipment_items 出 3、到貨只有 2)⇒ helper **必紅**,
  #    而且要斷言紅的是**這一筆**(出貨那一筆),不是後面某筆無辜交易。
  # 🔴 措辭(plan v2-R3 Fable nit):本線關掉的是「stale-high 讓超額出貨靜默提交」那個**機制**,
  #    **不是**「紅在無辜到貨更正」這個症狀 —— 合法出貨後把 instock 壓到已出貨量以下,那筆更正**仍會紅**,
  #    那正是本格,而且是**正確行為**。營運端的引導訊息仍必要(plan §9 交棒 2),不得因本線撤掉。
  cell_err B29c-real-overship-still-red "23514" "oiqs_shipped_le_instock" \
"  INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity)
  VALUES (v_i4, v_sup, 3);
  INSERT INTO public.order_item_procurement_receipts (procurement_id, quantity, received_at, received_by)
  SELECT p.id, 2, now(), 'b2s2b_verify' FROM public.order_item_procurement p WHERE p.order_item_id = v_i4;
$MK_DRAFT
  INSERT INTO public.shipment_items (shipment_id, order_item_id, shipped_quantity) VALUES (v_ship, v_i4, 3);
$SHIP_NOW" \
    "🔴 項29(c) 真超出貨仍紅在出貨那一筆(不是後面某筆無辜交易)"
}

# 🔴 `BEH_KEYS` **必須被比對**,不能只是長得像凍結值(2b R1 nit 1;與 `EXPECT_TOTAL` 同型)——
#    少呼叫一格時 `collect` 模式不計 CELL、上游的 CELL 斷言看不見它 ⇒ 那一格靜默消失,
#    而「紅點集合相符」在少了一格的情況下**還是可能成立**。⇒ 每輪逐字對 key 集合。
BEH_KEYS="B10-shipped-lands B10b-draft-not-counted B11-void-returns B11b-void-submitted B12-unvoid-restores B12b-x3-blocks B12b-x1-blocks B12c-blocks B14-c9-neg B20-helper-live B29b-line-self-heals B29c-real-overship-still-red"
RUN_KEYS=""
beh_oracle() {   # $1 = URL、$2 = 模式(report|collect)
  ORACLE_URL="$1"; ORACLE_MODE="$2"; REDS_IDS=""; RUN_KEYS=""
  CELL_B10; CELL_B10b; CELL_B11; CELL_B11b; CELL_B12
  CELL_B12b_x3; CELL_B12b_x1; CELL_B12c_blocks; CELL_B14; CELL_B20
  # 🔴 項29 的 (b)(c) **掛進突變矩陣**(2b 第二段之三):它們原本只跑對照組 = 零靶。
  #   掛進來之後現成的靶就打得到:靶① 拿掉 shipments 那支重算 trigger ⇒ (c) 的出貨那筆不再重算、不紅;
  #   靶⑤ helper 的 ON CONFLICT 漏掉 shipped 欄 ⇒ (b) 的殘留自癒失敗。
  #   🔴 (a) **掛不進來** —— 它必須跑在 pre-S2b 基準上,而本 oracle 的每個環境都已套上 S2b。
  CELL_B29b; CELL_B29c
  REDS_IDS="$(printf '%s' "$REDS_IDS" | tr ' ' '\n' | grep -v '^$' | sort | tr '\n' ' ' | sed 's/ *$//')"
  local rgot rexp
  rgot="$(printf '%s' "$RUN_KEYS" | tr ' ' '\n' | grep -v '^$' | sort | tr '\n' ' ' | sed 's/ *$//')"
  rexp="$(printf '%s' "$BEH_KEYS" | tr ' ' '\n' | grep -v '^$' | sort | tr '\n' ' ' | sed 's/ *$//')"
  [ "$rgot" = "$rexp" ] || bad "🔴 beh_oracle 實際跑過的格集合不符(URL=$1):
     實際 [$rgot]
     期望 [$rexp]"
}

BEH_N="$(printf '%s' "$BEH_KEYS" | tr ' ' '\n' | grep -vc '^$')"
# 🔴 格數由 `BEH_KEYS` 算,不手寫(R1 must-fix 4:掛進兩格之後這裡仍印「10 格」)。
log "1/8 行為對照組(post-S2b 基準庫;$BEH_N 格)"
beh_oracle "$BASE_URL" report

log "2/8 只跑在對照組的三格(項12c 結構面 / 項15 C9 承重性 / 項18 真 COMMIT 回滾)"
CELL_B12c_struct
CELL_B15
CELL_B18

log "2b/8 項29 stale-high 殘留:前態可達 / 本線自癒 / 真超出貨仍紅(2b 第二段之三)"
# 🔴🔴 **三格各自 pin 基準**(plan 項29 v2-R3;Fable 翻案條件⑤):
#   (a) 只有在 **pre-S2b**(三軸 helper)上才構造得出來 —— 全前綴庫上本線已經把它治好了,
#       照著做只會卡死。⇒ 它跑在 **b2s2b_pre 的副本**上,不是 BASE。
#   (b)(c) 跑在 **post**(BASE)上。三格都必須跑出預期觀察值才算過,
#       **不接受「構造不出來也算完成」**(plan 逐字:那是同一項無論結果如何都能登記完成)。
# 🔴 (a) 只在這裡跑一次(pre-S2b 副本);(b)(c) 已移進 `beh_oracle`,由突變矩陣一併跑。
CELL_B29a

# ══ 3/8-6/8:突變矩陣(環境 B = 行為)═══════════════════════════════════════
# 🔴🔴 **永久警語 ③:突變必須先剝掉 migration 自己的 §5 結構驗收 DO block** 🔴🔴
#   否則突變會先被 migration 的自我檢查擋下、apply 直接 abort ⇒ 你證明的是
#   「migration 會自我檢查」(S2b-1 已證),**不是**「本 harness 的 oracle 有判別力」。
#   剝除本身要有對照組:**MUT0 = 只剝不改,`BEH_KEYS` 那一組必須全綠**(格數見 `$BEH_N`,不手寫)。
# 🔴 比對象 = **mut0**,不是原檔(plan §2.2 W5 ①):比原檔恆為不同(因為一律先剝 §5)
#   ⇒ 那道「真的改到東西」的守門會恆真、從來不可能觸發(小線 code-reviewer R1 實錘)。
# 🔴 `cmp` 的 **rc=2 是讀不到檔、判紅**,不得用 `&&…||…` 把它歸進「有差異」那一支(W5 ③)。
MUT=0
STRIP_BEGIN='-- ══ 5. 檔內結構驗收'
STRIP_END='-- ══ 6. 註解'
make_mutant() {   # $1 = 輸出檔、$2 = 取代來源(空 = 只剝)、$3 = 取代目標
  MIG="$MIG" OUT="$1" SRC="$2" DST="$3" SB="$STRIP_BEGIN" SE="$STRIP_END" python3 - <<'PY'
import io, os
s = io.open(os.environ['MIG'], encoding='utf-8').read()
sb, se = os.environ['SB'], os.environ['SE']
i, j = s.find(sb), s.find(se)
if i < 0 or j < 0 or j <= i:
    raise SystemExit('🔴 剝除錨找不到或順序反了 —— migration 的 §5 段落標題被改過了')
s = s[:i] + s[j:]
src, dst = os.environ['SRC'], os.environ['DST']
if src:
    n = s.count(src)
    if n != 1:
        raise SystemExit('🔴 突變錨在剝除後的檔內命中 %d 次(必須恰 1 次):%r' % (n, src[:60]))
    s = s.replace(src, dst)
io.open(os.environ['OUT'], 'w', encoding='utf-8').write(s)
PY
}
# 🔴 `make_mutant` 的 rc 一定要接(2b R1 nit 3):python 的 SystemExit 若被吞掉,
#    後面會拿殘留的舊檔繼續跑。所有靶一律走這支 wrapper。
make_mutant_or_die() { make_mutant "$@" || die "make_mutant 失敗(輸出檔 $1)—— 突變錨可能已隨 migration 改動而失效"; }
# 🔴 逐發突變:期望紅點集合**寫死**,不是「反正紅了就算抓到」(判定紀律①)。
run_mutant() {   # $1 = 靶名、$2 = 突變檔、$3 = 期望紅格集合(空 = 應全綠)、$4 = key、$5 = 比對基準檔
  # 🔴 `$6` 是選用參數 —— `set -u` 下直接引用未給的 `$6` 會整支炸掉,先收進 local 帶預設。
  local name="$1" file="$2" want="$3" key="$4" basefile="$5" structflag="${6:-}" db="b2s2b_mut" rc
  MUT=$((MUT+1))
  # 🔴 產物存在且非空(2b R1 nit 3):`make_mutant` 的 python 若 SystemExit,`run` 模式會拿
  #    `$WORK` 裡**上一輪殘留的**同名檔去跑而仍可能判過。這道是它的直接守門。
  [ -s "$file" ] || { bad "$name:突變檔 $file 不存在或為空 —— make_mutant 失敗,這一發沒有跑"; return; }
  # ①先證「真的改到東西」——rc=0 相同 / rc=1 有差異 / rc=2 讀不到檔(判紅,不歸進「有差異」)
  if [ -n "$basefile" ]; then
    cmp -s "$basefile" "$file"; rc=$?
    case "$rc" in
      1) : ;;
      0) bad "$name:突變檔與基準檔**逐字相同** —— sed/replace 沒改到東西,這一發等於沒跑"; return ;;
      *) bad "$name:cmp 讀不到檔(rc=$rc)—— 判紅,不當成「有差異」"; return ;;
    esac
  fi
  psql -X "$ADMIN_URL" -q -c "DROP DATABASE IF EXISTS $db" >/dev/null 2>&1
  psql -X "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE $db TEMPLATE b2s2b_pre" >/dev/null 2>&1 \
    || { sleep 1; psql -X "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE $db TEMPLATE b2s2b_pre" >/dev/null 2>&1 \
         || { bad "$name:從 b2s2b_pre 複製副本失敗"; return; }; }
  local U="postgresql://postgres@127.0.0.1:${PORT}/$db"
  if ! psql -X "$U" -v ON_ERROR_STOP=1 -q -f "$file" > "$WORK/mut-$key.log" 2>&1; then
    bad "$name:突變版 migration 套不上去($(grep -m1 ERROR "$WORK/mut-$key.log" | cut -c1-90))
     🔴 套不上去 ≠ 抓到 —— 這一發沒有量到任何 oracle,不得算過"
    drop_db "$db"; return
  fi
  # 🔴 **MUT0 專用的結構對照**(2b R1 nit 8):行為那一組看不見「剝多了」——
  #    若剝除區間不小心吃掉 REVOKE / COMMENT / §5 以外的結構,行為格仍會全綠。
  #    ⇒ 對照組另外在**突變庫上**驗三件事:helper 四軸指紋、trigger 在、新函式 proacl 非 NULL。
  #    只對 MUT0 做 —— 靶①-⑤ 本來就會改動這些,對它們做等於要求突變不生效。
  if [ "$structflag" = "struct" ]; then
    local smd5 stg sacl
    smd5="$(q "$U" "SELECT md5(pg_get_functiondef('${HELPER}'::regprocedure))")"
    stg="$(q "$U" "SELECT count(*) FROM pg_trigger WHERE tgname='${TG_SS}' AND NOT tgisinternal")"
    sacl="$(q "$U" "SELECT proacl IS NOT NULL FROM pg_proc WHERE oid='public.pcm_a4a_shipments_summary_recompute()'::regprocedure")"
    if [ "$smd5" != "$MD5_HELPER_4AXIS" ] || [ "$stg" != "1" ] || [ "$sacl" != "t" ]; then
      bad "$name:**剝多了** —— 剝除 §5 之後的結構與 post 基準不一致
     helper md5=[$smd5](期望 $MD5_HELPER_4AXIS)/ trigger 數=[$stg](期望 1)/ 新函式 proacl 非 NULL=[$sacl](期望 t)
     🔴 行為格($BEH_N 格)對這種偏差全盲,所以這道只在 MUT0 上跑"
      drop_db "$db"; return
    fi
  fi
  beh_oracle "$U" collect
  drop_db "$db"
  if [ "$REDS_IDS" = "$want" ]; then
    if [ -z "$want" ]; then ok "$key" "$name:$BEH_N 格全綠(對照組成立 —— 剝除 §5 本身不改變任何行為)"
    else ok "$key" "$name ⇒ 紅點集合逐字相符:[$want]"; fi
  else
    bad "$name:紅點集合不符
     實際 [$REDS_IDS]
     期望 [$want]"
  fi
}

log "3/8 突變對照組 MUT0(只剝 §5、零改動)"
make_mutant "$WORK/mut0.sql" "" "" || die "mut0 產生失敗(make_mutant 非零退出)"
test -s "$WORK/mut0.sql" || die "mut0.sql 為空"
# 🔴 `cmp` 的 rc=2(讀不到檔)不得被 `&&` 歸進「相同/不同」任何一支(本檔 W5 ③ 自己立的規矩;
#    2b R1 nit 2:run_mutant 三分支寫對了,唯獨這裡沒有)。
cmp -s "$MIG" "$WORK/mut0.sql"; MUT0_RC=$?
case "$MUT0_RC" in
  1) : ;;
  0) die "mut0 與原檔逐字相同 —— §5 根本沒被剝掉,整段突變在證明 migration 自我檢查而不是本檔 oracle" ;;
  *) die "mut0 的 cmp 讀不到檔(rc=$MUT0_RC)—— 判紅,不當成「有差異」" ;;
esac
run_mutant "MUT0-只剝不改" "$WORK/mut0.sql" "" MUT-0 "" struct

log "4/8 靶① 拿掉 shipments 那支重算 trigger"
# plan §5 環境B 第一列:唯一 oracle = 項10(shipped 恆 0 且**零錯誤**)。
make_mutant_or_die "$WORK/mut1.sql" \
'CREATE CONSTRAINT TRIGGER shipments_summary_recompute_ac
  AFTER UPDATE OF shipped_at, deleted_at ON public.shipments
  NOT DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW
  EXECUTE FUNCTION public.pcm_a4a_shipments_summary_recompute();' \
'SELECT 1;'
run_mutant "靶①-拿掉重算 trigger" "$WORK/mut1.sql" \
  "B10-shipped-lands B11-void-returns B11b-void-submitted B12-unvoid-restores B14-c9-neg B29c-real-overship-still-red" \
  MUT-1 "$WORK/mut0.sql"

log "5/8 靶②③ 真相式各漏一條述詞"
# 🔴 兩發都動 helper 的第四軸真相式(§1),各漏一個過濾條件。
make_mutant_or_die "$WORK/mut2.sql" \
'     AND s.deleted_at IS NULL          -- Q3=A:作廢即退量
     AND s.shipped_at IS NOT NULL;     -- 未寄出的草稿箱不算' \
'     AND s.shipped_at IS NOT NULL;'
run_mutant "靶②-真相式漏 deleted_at IS NULL" "$WORK/mut2.sql" \
  "B11-void-returns B11b-void-submitted B12-unvoid-restores" MUT-2 "$WORK/mut0.sql"

make_mutant_or_die "$WORK/mut3.sql" \
'     AND s.deleted_at IS NULL          -- Q3=A:作廢即退量
     AND s.shipped_at IS NOT NULL;     -- 未寄出的草稿箱不算' \
'     AND s.deleted_at IS NULL;'
run_mutant "靶③-真相式漏 shipped_at IS NOT NULL" "$WORK/mut3.sql" \
  "B10b-draft-not-counted" MUT-3 "$WORK/mut0.sql"

log "6/8 靶④ 漏 deleted_at 事件面 / 靶⑤ ON CONFLICT 漏第四軸"
make_mutant_or_die "$WORK/mut4.sql" \
'  AFTER UPDATE OF shipped_at, deleted_at ON public.shipments' \
'  AFTER UPDATE OF shipped_at ON public.shipments'
run_mutant "靶④-trigger 漏 deleted_at 事件面" "$WORK/mut4.sql" \
  "B11-void-returns B11b-void-submitted B12-unvoid-restores" MUT-4 "$WORK/mut0.sql"
# 🔴 **靶②與靶④ 的紅點集合完全相同**(2b R1 nit 9)——「真相式漏述詞」與「trigger 漏事件面」
#    在本組 oracle 下**區分不了**。兩發都留是刻意的:它們壞的是不同層(函式體 vs trigger 綁定),
#    未來若有人以「重複靶」為由砍掉一發,另一層就沒有任何靶了。要區分它們需要一格
#    「作廢後**沒有任何重算被觸發**」的觀察(例如比對 xact 內的 trigger 執行痕跡),本輪沒做。

# plan §5 增補靶最後一列:「helper 的 ON CONFLICT 漏掉 shipped_quantity 欄」,唯一 oracle = 項20。
# 🔴 這一發專打 §0.6b 的病根(既有 shipped 值被原樣保留 ⇒ stale-high 殘留)。
make_mutant_or_die "$WORK/mut5.sql" \
'        cancelled_quantity = EXCLUDED.cancelled_quantity,
        shipped_quantity   = EXCLUDED.shipped_quantity;' \
'        cancelled_quantity = EXCLUDED.cancelled_quantity;'
run_mutant "靶⑤-ON CONFLICT 漏 shipped_quantity" "$WORK/mut5.sql" \
  "B10-shipped-lands B11-void-returns B11b-void-submitted B12-unvoid-restores B14-c9-neg B20-helper-live B29b-line-self-heals" \
  MUT-5 "$WORK/mut0.sql"

[ "$MUT" -eq "$EXPECT_MUT" ] && ok MUT-COUNT "突變靶跑了 $MUT 發,與凍結值相符" \
  || bad "突變靶只跑了 $MUT 發,期望 $EXPECT_MUT —— 有靶被刪掉或沒被呼叫"

# 🔴 突變段結束:把全域旗標重設回 report(2b R1 nit 12)——
#    停在 collect + 已 DROP 的 mut URL 時,日後在這之後加的任何 cell 會**靜默不計** CELL/PASS。
ORACLE_MODE="report"; ORACLE_URL="$BASE_URL"

log "6f/8 環境 A(結構)突變矩陣(S2b-2b 第二段;plan §5 環境A)"
# 🔴 **為什麼需要一組<u>外部</u>結構 oracle**:環境A 的靶要改 migration,而突變一律先剝掉它自己的
#    §5 結構驗收(永久警語③)—— 剝掉之後 catalog 面就沒有任何東西在看了。
#    S2b-1 的結構驗收寫在 migration 檔內,對突變環境**結構上不可用** ⇒ 這裡另建一份。
# 🔴 期望值是**實測常數**(2026-08-07 對 post-S2b 基準庫量得),不是執行期自算再跟自己比。
# 🔴🔴 **逐維查詢、每維各自接 psql 的離開碼**(R1 Critical A):上一版把兩組維度串成一條字串
#    且用 `2>&1` —— 查詢壞掉時**錯誤訊息本身**變成觀察值,非空、不等於凍結值,
#    於是產出的紅點**剛好就是五發靶期望的那一個** ⇒ 靶全部 vacuous pass。
#    (memory `reference_pg-sql-percent-escape-and-rollback-safe-counter` ④ 記的同一族,今天第二次。)
# 🔴 **per-dim key**:A1/A2/A3 原本共用單一 `SA-trigger`,機器分不出它們動到哪一維
#    ⇒ 錨失效而改到別維時仍全綠。改成一維一個 key,want 自然變成互不相同的集合。
so_reds=""
so_dim() {   # $1 = key、$2 = SQL、$3 = 期望值;查詢非零退出 ⇒ 紅在 `<key>-ERR`(與值不符可分辨)
  local v rc
  v="$(psql -X "$SO_URL" -qtAc "$2" 2>"$WORK/so-$1.err")"; rc=$?
  if [ "$rc" -ne 0 ]; then so_reds="$so_reds ${1}-ERR"
  elif [ "$v" != "$3" ]; then so_reds="$so_reds $1"; fi
}
SO_URL=""
struct_oracle() {   # $1 = URL → 印紅點 key(全綠零輸出)
  SO_URL="$1"; so_reds=""
  local T="FROM pg_trigger t WHERE t.tgname='${TG_SS}' AND NOT t.tgisinternal"
  local F="FROM pg_proc p WHERE p.oid='public.pcm_a4a_shipments_summary_recompute()'::regprocedure"
  # ── trigger 五維(物件不存在時每維都回 0 列 ⇒ 空字串 ⇒ 五維齊紅,與查詢壞掉的 -ERR 可分辨)
  so_dim SA-tgtype       "SELECT t.tgtype::text $T" '17'
  so_dim SA-tgfoid       "SELECT (SELECT p2.proname FROM pg_proc p2 WHERE p2.oid=t.tgfoid) $T" 'pcm_a4a_shipments_summary_recompute'
  so_dim SA-tgattr       "SELECT coalesce(array_to_string(ARRAY(SELECT a.attname FROM unnest(t.tgattr) k JOIN pg_attribute a ON a.attrelid=t.tgrelid AND a.attnum=k ORDER BY a.attname),','),'<NULL>') $T" 'deleted_at,shipped_at'
  so_dim SA-tgdefer      "SELECT t.tgdeferrable::text || '|' || t.tginitdeferred::text $T" 'false|false'
  so_dim SA-tgconstraint "SELECT (t.tgconstraint <> 0)::text $T" 'true'
  # ── 函式五維(函式不存在時 `::regprocedure` 直接丟錯 ⇒ 五維齊紅在 -ERR)
  so_dim SA-proconfig    "SELECT array_to_string(p.proconfig,',') $F" 'search_path="",lock_timeout=5s'
  so_dim SA-secdef       "SELECT p.prosecdef::text $F" 'true'
  so_dim SA-aclnotnull   "SELECT (p.proacl IS NOT NULL)::text $F" 'true'
  so_dim SA-grantee0     "SELECT (SELECT count(*) FROM aclexplode(p.proacl) a WHERE a.grantee <> p.proowner)::text $F" '0'
  # 🔴 **這一維非有不可**(R1 Important):`aclexplode(NULL)` 回**零列** ⇒ 漏 REVOKE(proacl 為 NULL、
  #    PUBLIC 仍有 EXECUTE)時上面那維同樣是 `0`,與健康態不可分。四角色點名才殺得到那個形狀。
  so_dim SA-rolesnone    "SELECT has_function_privilege('anon','public.pcm_a4a_shipments_summary_recompute()','EXECUTE')::text || '|' || has_function_privilege('authenticated','public.pcm_a4a_shipments_summary_recompute()','EXECUTE')::text || '|' || has_function_privilege('service_role','public.pcm_a4a_shipments_summary_recompute()','EXECUTE')::text || '|' || has_function_privilege('authenticator','public.pcm_a4a_shipments_summary_recompute()','EXECUTE')::text" 'false|false|false|false'
  printf '%s' "$(printf '%s' "$so_reds" | tr ' ' '\n' | grep -v '^$' | sort | tr '\n' ' ' | sed 's/ *$//')"
}
CELL=$((CELL+1))
SA_CTL="$(struct_oracle "$BASE_URL")"
if [ -z "$SA_CTL" ]; then
  ok STRUCT-ORACLE "🔴 環境A 外部結構 oracle 對照組全綠:**十維逐維各自接 rc**(trigger 的 tgtype / tgfoid / tgattr / deferrable 對 / constraint-ness;函式的 proconfig / secdef / proacl 非 NULL / owner 外 grantee 數 / 四角色點名)"
else
  bad "環境A 結構 oracle 對照組竟然有紅點:[$SA_CTL]"
fi

# 🔴 五發靶:每發改 migration **一處**、套到 pre-S2b 副本、期望只紅指定那一維。
#    比對象 = **mut0**(只剝 §5 的基準;plan §2.2 W5 ①),不是原檔。
run_smut() {   # $1 = 靶名、$2 = 突變檔、$3 = 期望紅點、$4 = key
  local name="$1" file="$2" want="$3" key="$4" db="b2s2b_smut" U got rc
  SMUT=$((SMUT+1))
  [ -s "$file" ] || { bad "$name:突變檔不存在或為空"; return; }
  if [ "$key" != "SMUT-0" ]; then   # 🔴 對照組本來就等於 mut0,不套這道
    cmp -s "$WORK/mut0.sql" "$file"; rc=$?
    case "$rc" in
      1) : ;;
      0) bad "$name:與 mut0 逐字相同 —— 沒改到東西"; return ;;
      *) bad "$name:cmp 讀不到檔(rc=$rc)—— 判紅"; return ;;
    esac
  fi
  psql -X "$ADMIN_URL" -q -c "DROP DATABASE IF EXISTS $db" >/dev/null 2>&1
  psql -X "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE $db TEMPLATE b2s2b_pre" >/dev/null 2>&1 \
    || { sleep 1; psql -X "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE $db TEMPLATE b2s2b_pre" >/dev/null 2>&1 \
         || { bad "$name:複製 pre 副本失敗"; return; }; }
  U="postgresql://postgres@127.0.0.1:${PORT}/$db"
  if ! psql -X "$U" -v ON_ERROR_STOP=1 -q -f "$file" > "$WORK/smut-$key.log" 2>&1; then
    bad "$name:突變版 migration 套不上去($(grep -m1 ERROR "$WORK/smut-$key.log" | cut -c1-90))
     🔴 套不上去 ≠ 抓到 —— 沒有量到任何 oracle,不得算過"
    drop_db "$db"; return
  fi
  got="$(struct_oracle "$U")"
  drop_db "$db"
  if [ "$got" = "$want" ]; then ok "$key" "$name ⇒ 紅點逐字相符:[$want]"
  else bad "$name:紅點不符 —— 實際 [$got] / 期望 [$want]"; fi
}
SMUT=0
# 🔴 **零突變對照組**(R1 Important;本檔永久警語③ 立的規矩):五發靶跑在「pre 庫 + 剝了 §5 的突變版」,
#    而凍結值量在「post base + 未剝」。沒有這一格就沒有任何東西證明**那兩個環境的 catalog 是同一個**
#    —— 若有差異,A1-A5 會一起 vacuous pass。
run_smut "SMUT0-只剝 §5、零改動(對照組)" "$WORK/mut0.sql" "" SMUT-0
# 🔴🔴 **plan §5 環境A 列的第一個靶「trigger 改 `BEFORE`」<u>構造不出來</u>**(2026-08-07 實測):
#    PG 的文法**不接受** `CREATE CONSTRAINT TRIGGER … BEFORE` ——
#    實跑 `CREATE CONSTRAINT TRIGGER zz_probe BEFORE UPDATE ON public.shipments …`
#    得到 `ERROR: syntax error at or near "BEFORE"`;同一句改成普通 `CREATE TRIGGER` 就過。
#    ⇒ 那個靶對「constraint trigger」這個形狀是**不可達**的,不是我沒寫好。
# 🔴 **換成打同一個面、而且構造得出的靶**:把 `CONSTRAINT TRIGGER` **降級成普通 TRIGGER**
#    (`tgconstraint` 由非 0 變 0 —— 那是 oracle 的第六維)。這個突變也正好解鎖 BEFORE:
#    普通 trigger 之後就能改 BEFORE,所以它是「改 BEFORE」在真實世界裡唯一的前置條件。
#    🔴 語意差別不是裝飾:constraint trigger 才有 `SET CONSTRAINTS` 的可延遲語意與
#    「與 X1 的發火序」契約(plan §3.3);降成普通 trigger 之後那些全部沒了。
make_mutant_or_die "$WORK/smut1.sql" \
'CREATE CONSTRAINT TRIGGER shipments_summary_recompute_ac
  AFTER UPDATE OF shipped_at, deleted_at ON public.shipments
  NOT DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW' \
'CREATE TRIGGER shipments_summary_recompute_ac
  AFTER UPDATE OF shipped_at, deleted_at ON public.shipments
  FOR EACH ROW'
run_smut "靶A1-CONSTRAINT TRIGGER 降級成普通 TRIGGER" "$WORK/smut1.sql" "SA-tgconstraint" SMUT-A1

make_mutant_or_die "$WORK/smut2.sql" \
'  EXECUTE FUNCTION public.pcm_a4a_shipments_summary_recompute();' \
'  EXECUTE FUNCTION public.pcm_a4a_procurement_summary_recompute();'
run_smut "靶A2-trigger 指向另一支函式" "$WORK/smut2.sql" "SA-tgfoid" SMUT-A2

make_mutant_or_die "$WORK/smut3.sql" \
'  AFTER UPDATE OF shipped_at, deleted_at ON public.shipments' \
'  AFTER UPDATE ON public.shipments'
run_smut "靶A3-UPDATE OF 改成任意 UPDATE" "$WORK/smut3.sql" "SA-tgattr" SMUT-A3

make_mutant_or_die "$WORK/smut4.sql" \
"SET search_path = ''          -- 🔴 新建函式一律 ''" \
'SET search_path = public      -- 🔴 新建函式一律 '"''"''
run_smut "靶A4-新函式 search_path 改 public" "$WORK/smut4.sql" "SA-proconfig" SMUT-A4

make_mutant_or_die "$WORK/smut5.sql" \
'REVOKE ALL ON FUNCTION public.pcm_a4a_shipments_summary_recompute()
  FROM PUBLIC, anon, authenticated, service_role;' \
'-- (REVOKE 被拿掉了)'
# 🔴🔴 **實測推翻了我與審查共同的假設**(2026-08-07):我們都以為「漏 REVOKE ⇒ `proacl` 為 NULL」,
#    於是預期紅在 `SA-aclnotnull`。**實跑不是那樣** —— 在本 shim 環境下,
#    `proacl = {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}`
#    ⇒ **非 NULL、owner 外 grantee = 4**。真正翻面的是 `SA-grantee0` 與 `SA-rolesnone`。
# 🔴 連帶結論:審查說「`SA-grantee0` 對 A5 零判別力(因為 `aclexplode(NULL)` 回 0 列)」——
#    **在這個環境下不成立**,它有判別力;反而是 **`SA-aclnotnull` 這一維沒有任何靶**(見結語的無靶清單)。
run_smut "靶A5-新函式漏 REVOKE" "$WORK/smut5.sql" "SA-grantee0 SA-rolesnone" SMUT-A5

# ── R2 F2 補的三發:那三維本來被我列進「無靶」,但**構造得出便宜的靶** ──────────
# 🔴 判準與 B28 那次一致:「沒有靶」不成立為「構造不出」。plan §5 沒列這三個,是我加的。
make_mutant_or_die "$WORK/smut6.sql" \
'CREATE FUNCTION public.pcm_a4a_shipments_summary_recompute()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER' \
'CREATE FUNCTION public.pcm_a4a_shipments_summary_recompute()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER'
run_smut "靶A6-新函式改 SECURITY INVOKER" "$WORK/smut6.sql" "SA-secdef" SMUT-A6

# 🔴 tgdefer 這一維直接承載 X1 的發火序契約(migration 檔頭:重算 NOT DEFERRABLE ⇒ 排在 X1 之前)。
make_mutant_or_die "$WORK/smut7.sql" \
'  NOT DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW
  EXECUTE FUNCTION public.pcm_a4a_shipments_summary_recompute();' \
'  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.pcm_a4a_shipments_summary_recompute();'
run_smut "靶A7-trigger 改成 DEFERRABLE INITIALLY DEFERRED" "$WORK/smut7.sql" "SA-tgdefer" SMUT-A7

# 🔴 tgtype:plan 指定的「改 BEFORE」構造不出(PG 文法),但**加一個事件面**構造得出(17→21)。
make_mutant_or_die "$WORK/smut8.sql" \
'  AFTER UPDATE OF shipped_at, deleted_at ON public.shipments
  NOT DEFERRABLE' \
'  AFTER INSERT OR UPDATE OF shipped_at, deleted_at ON public.shipments
  NOT DEFERRABLE'
run_smut "靶A8-trigger 多掛 INSERT 事件面(tgtype 17→21)" "$WORK/smut8.sql" "SA-tgtype" SMUT-A8

[ "$SMUT" -eq "$EXPECT_SMUT" ] && ok SMUT-COUNT "環境A 結構突變靶跑了 $SMUT 發,與凍結值相符" \
  || bad "環境A 結構突變靶只跑了 $SMUT 發,期望 $EXPECT_SMUT"

# ══ 6g/8:項19 barrier(2b 第二段之二)═════════════════════════════════════════
# 🔴 這一段是**唯一**真的碰到併發面的地方:三個真 psql session、真 trigger、真取鎖。
#    它整段活在**突變環境**(pre 副本 + 套上突變版 migration),沒有任何一格跑在 post base ——
#    因為 barrier 一定要**真 COMMIT** 才有意義,而 commit 進 base 會弄髒後面所有格的基準斷言。
#    ⇒ 對照組由 `BMUT-0`(只剝 §5、零改動)擔任,catalog 等價由 `SMUT-0` 另外證。
# 🔴🔴 **本格標 `inconclusive`(plan §8.1 第二列;項19 是該規則<u>唯一</u>預先授權的一格)**:
#    出貨 writer RPC 今天不存在 ⇒ 兩個 session 的 `UPDATE shipments` 是 **owner 直寫**。
#    **它證到的**:trigger 內 helper 的逐列取鎖順序、以及「鎖在讀真相之前」這件事,在真併發下的效果。
#    **它證不到的**:①未來那支出貨 RPC 會不會在進 trigger 前自己先取別的鎖(順序可能與此不同)
#                    ②A8a2 多品項的取鎖順序(plan §9 交棒 6,本線一律不宣稱)。
BAR_FIX='
  SELECT user_id INTO v_cust FROM public.customers ORDER BY user_id LIMIT 1;
  SELECT id INTO v_sup FROM public.suppliers ORDER BY id LIMIT 1;
  INSERT INTO public.orders (display_id, customer_user_id, shipping_address_snapshot, tier_at_checkout,
                             subtotal, shipping_fee, total, shipping_method, invoice)
  VALUES ("PCM-9993-0001", v_cust, jsonb_build_object("name","barrier","phone","0900000000","line","x"),
          "general"::public.member_tier, 0, 0, 0, "store", jsonb_build_object("type","personal"))
  RETURNING id INTO v_order;
  INSERT INTO public.order_items (order_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
  VALUES (v_order,"BAR-X",jsonb_build_object("title","x","sku","BAR-X","spec",jsonb_build_object()),9,0,0) RETURNING id INTO v_a;
  INSERT INTO public.order_items (order_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
  VALUES (v_order,"BAR-Y",jsonb_build_object("title","y","sku","BAR-Y","spec",jsonb_build_object()),9,0,0) RETURNING id INTO v_b;
  v_lo := LEAST(v_a,v_b); v_hi := GREATEST(v_a,v_b);
  UPDATE public.order_items SET variant_sku="BAR-A" WHERE id=v_lo;
  UPDATE public.order_items SET variant_sku="BAR-B" WHERE id=v_hi;
  INSERT INTO public.order_items (order_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
  VALUES (v_order,"BAR-C",jsonb_build_object("title","c","sku","BAR-C","spec",jsonb_build_object()),9,0,0) RETURNING id INTO v_c;
  INSERT INTO public.order_items (order_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
  VALUES (v_order,"BAR-D",jsonb_build_object("title","d","sku","BAR-D","spec",jsonb_build_object()),9,0,0) RETURNING id INTO v_d;
  INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity)
  SELECT x, v_sup, 5 FROM unnest(ARRAY[v_lo,v_hi,v_c,v_d]) x;
  INSERT INTO public.order_item_procurement_receipts (procurement_id, quantity, received_at, received_by)
  SELECT p.id, 5, now(), "bar" FROM public.order_item_procurement p WHERE p.order_item_id IN (v_lo,v_hi,v_c,v_d);
  INSERT INTO public.shipments (shipment_reference, customer_user_id, recipient_snapshot, carrier_code)
  VALUES ("BCDFGJ",v_cust,"{}"::jsonb || jsonb_build_object("name","a","phone","0900000000","line","x"),"hct") RETURNING id INTO v_p1;
  INSERT INTO public.shipments (shipment_reference, customer_user_id, recipient_snapshot, carrier_code)
  VALUES ("BCDFGK",v_cust,"{}"::jsonb || jsonb_build_object("name","b","phone","0900000000","line","x"),"hct") RETURNING id INTO v_p2;
  INSERT INTO public.shipments (shipment_reference, customer_user_id, recipient_snapshot, carrier_code)
  VALUES ("BCDFGM",v_cust,"{}"::jsonb || jsonb_build_object("name","c","phone","0900000000","line","x"),"hct") RETURNING id INTO v_q1;
  INSERT INTO public.shipments (shipment_reference, customer_user_id, recipient_snapshot, carrier_code)
  VALUES ("BCDFGN",v_cust,"{}"::jsonb || jsonb_build_object("name","d","phone","0900000000","line","x"),"hct") RETURNING id INTO v_q2;
  INSERT INTO public.shipment_items (shipment_id, order_item_id, shipped_quantity) VALUES (v_p1,v_lo,1),(v_p1,v_hi,1);
  INSERT INTO public.shipment_items (shipment_id, order_item_id, shipped_quantity) VALUES (v_p2,v_hi,1),(v_p2,v_lo,1);
  INSERT INTO public.shipment_items (shipment_id, order_item_id, shipped_quantity) VALUES (v_q1,v_c,1),(v_q1,v_d,1);
  INSERT INTO public.shipment_items (shipment_id, order_item_id, shipped_quantity) VALUES (v_q2,v_c,1),(v_q2,v_d,1);
  INSERT INTO public.order_items (order_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
  VALUES (v_order,"BAR-E1",jsonb_build_object("title","e","sku","BAR-E1","spec",jsonb_build_object()),9,0,0) RETURNING id INTO v_e;
  INSERT INTO public.order_items (order_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
  VALUES (v_order,"BAR-E2",jsonb_build_object("title","f","sku","BAR-E2","spec",jsonb_build_object()),9,0,0) RETURNING id INTO v_f;
  INSERT INTO public.order_items (order_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
  VALUES (v_order,"BAR-E3",jsonb_build_object("title","g","sku","BAR-E3","spec",jsonb_build_object()),9,0,0) RETURNING id INTO v_g;
  SELECT array_agg(x ORDER BY x) INTO v_sorted FROM unnest(ARRAY[v_e,v_f,v_g]) x;
  UPDATE public.order_items SET variant_sku="BAR-E" WHERE id=v_sorted[1];
  UPDATE public.order_items SET variant_sku="BAR-F" WHERE id=v_sorted[2];
  UPDATE public.order_items SET variant_sku="BAR-G" WHERE id=v_sorted[3];
  INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity)
  SELECT x, v_sup, 5 FROM unnest(v_sorted) x;
  INSERT INTO public.order_item_procurement_receipts (procurement_id, quantity, received_at, received_by)
  SELECT p.id, 5, now(), "bar" FROM public.order_item_procurement p WHERE p.order_item_id = ANY(v_sorted);
  INSERT INTO public.shipments (shipment_reference, customer_user_id, recipient_snapshot, carrier_code)
  VALUES ("BCDFGP",v_cust,"{}"::jsonb || jsonb_build_object("name","e","phone","0900000000","line","x"),"hct") RETURNING id INTO v_r1;
  INSERT INTO public.shipments (shipment_reference, customer_user_id, recipient_snapshot, carrier_code)
  VALUES ("BCDFGQ",v_cust,"{}"::jsonb || jsonb_build_object("name","f","phone","0900000000","line","x"),"hct") RETURNING id INTO v_r2;
  INSERT INTO public.shipment_items (shipment_id, order_item_id, shipped_quantity)
  VALUES (v_r1,v_sorted[1],1),(v_r1,v_sorted[2],1),(v_r1,v_sorted[3],1);
  INSERT INTO public.shipment_items (shipment_id, order_item_id, shipped_quantity)
  VALUES (v_r2,v_sorted[3],1),(v_r2,v_sorted[2],1);'
BAR_FIX="$(printf '%s' "$BAR_FIX" | tr '"' "'")"
# 🔴 `BAR-A` / `BAR-B` 是**用 `LEAST/GREATEST` 事後改名**的,不是插入順序決定的:
#    整個死結構造靠「阻擋者握住<u>迭代序的第一顆</u>」,而迭代序由 uuid 升序決定。
#    若改成靠插入順序命名,uuid 隨機會讓這一格**時綠時紅**(=沒有 barrier 的競賽測試,memory 明令不算數)。
# 🔴 `P1 = (lo,hi)` 而 `P2 = (hi,lo)` 是**實體列序**刻意反的:唯一能讓兩個 session 反序取鎖的來源
#    就是「順序取決於該包裹的實體佈局」。真相式一旦把順序正規化(`DISTINCT` 或 `ORDER BY`),這個反序就消失。

BAR_REDS=""
bar_nap() { perl -e 'select undef,undef,undef,0.05'; }
bar_start() {   # $1 = 名稱、$2 = fd 號
  mkfifo "$BARW/$1.in" || { BAR_REDS="$BAR_REDS BAR-RIGFAIL-$1"; return 1; }
  psql -X "postgresql://postgres@127.0.0.1:${PORT}/${BARDB}?application_name=bar_$1" \
       -v ON_ERROR_STOP=0 -v VERBOSITY=verbose -qtA < "$BARW/$1.in" > "$BARW/$1.out" 2>&1 &
  eval "exec ${2}> $BARW/$1.in"
}
bar_mark() {    # $1 = 名稱、$2 = 標記;等不到 ⇒ 紅(fail-closed,絕不當成「大概好了」往下走)
  local i=0
  while [ "$i" -lt 300 ]; do
    grep -qx "$2" "$BARW/$1.out" 2>/dev/null && return 0
    bar_nap; i=$((i+1))
  done
  BAR_REDS="$BAR_REDS BAR-TIMEOUT-$2"; return 1
}
# 🔴 這就是「barrier」本體:**不用 sleep 猜**,直接問 PG「這個 session 現在是不是被誰擋住」。
#    `pg_blocking_pids` 非空 = **它正在等一把別人握著的鎖** —— 這是可觀察的狀態,不是時間上的希望
#    (memory `feedback_race-test-without-barrier-proves-nothing`)。
# 🔴 **它不證明「已取到前綴鎖」**(R1 nit 4):等待中的 session 可能一把都還沒取到。
#    本編排不需要那個更強的性質 —— 死結的決定性來自**放行順序 + FIFO 鎖佇列**,不是前綴假設。
bar_blocked() { # $1 = 名稱
  local i=0 who
  while [ "$i" -lt 200 ]; do
    who="$(psql -X "$BARU" -qtAc "SELECT coalesce(array_to_string(pg_blocking_pids(pid),','),'') FROM pg_stat_activity WHERE application_name='bar_$1'" 2>/dev/null)"
    [ -n "$who" ] && return 0
    bar_nap; i=$((i+1))
  done
  BAR_REDS="$BAR_REDS BAR-NOTBLOCKED-$1"; return 1
}
bar_shipped() { psql -X "$BARU" -qtAc "SELECT coalesce((SELECT s.shipped_quantity::text FROM ${SUMMARY} s JOIN public.order_items oi ON oi.id=s.order_item_id WHERE oi.variant_sku='$1'),'<none>')" 2>/dev/null; }

barrier_oracle() {   # $1 = 庫名 → 印紅點 key(全綠零輸出)
  # 🔴 R2 F7:對應 psql 若早死,printf 寫進已關的 fifo 會吃到 SIGPIPE。本函式跑在命令替換的
  #    **子 shell** 裡,所以父層不受影響。(精確地說:SIG_IGN 會被 exec 出去的 psql 子行程繼承,
  #    實害低但不是「完全只影響這一段」。)不設它的話整支 harness 被 141 殺掉,連總結行都沒有。
  #    忽略之後 printf 只是失敗,後續的 bar_mark / bar_blocked 會照常逾時轉紅,診斷指得到人。
  trap "" PIPE
  BARDB="$1"; BARU="postgresql://postgres@127.0.0.1:${PORT}/${BARDB}"; BAR_REDS=""
  BARW="$WORK/bar-$BARDB"; rm -rf "$BARW"; mkdir -p "$BARW"
  local P1 P2 Q1 Q2 ALO R1 R2 ids
  ids="$(psql -X "$BARU" -qtAc "SELECT (SELECT id FROM public.shipments WHERE shipment_reference='BCDFGJ')::text||' '||(SELECT id FROM public.shipments WHERE shipment_reference='BCDFGK')::text||' '||(SELECT id FROM public.shipments WHERE shipment_reference='BCDFGM')::text||' '||(SELECT id FROM public.shipments WHERE shipment_reference='BCDFGN')::text||' '||(SELECT id FROM public.order_items WHERE variant_sku='BAR-A')::text||' '||(SELECT id FROM public.shipments WHERE shipment_reference='BCDFGP')::text||' '||(SELECT id FROM public.shipments WHERE shipment_reference='BCDFGQ')::text" 2>/dev/null)"
  set -- $ids
  if [ "$#" -ne 7 ]; then printf 'BAR-FIXTURE-MISSING'; return; fi
  P1="$1"; P2="$2"; Q1="$3"; Q2="$4"; ALO="$5"; R1="$6"; R2="$7"

  # ── 情境 A:兩個包裹含**同一對**品項、實體列序相反 ⇒ 期望「無死結」──────────
  #    阻擋者 B 先握住迭代序第一顆(BAR-A);S1 卡在它上面,S2 再排到 S1 後面;
  #    兩者都確認**真的被擋住**之後才放行 B —— 這樣交錯是被觀察到的,不是等來的。
  # 🔴 R1 nit 5:**不要**寫成「此時 S1 已握有它自己的前綴」—— 在 BAR-A 就是第一顆的形狀下那是空真。
  #    真正讓 L2b 死結成為決定性的是:B 放行時 **S1 排在 S2 前面**(FIFO),
  #    而 L2b 的 S2 早已握著 BAR-B ⇒ S1 拿到 BAR-A 後要 BAR-B、S2 要 BAR-A,互卡。
  # 🔴 R1 nit 9:`bar_start` 失敗(mkfifo)時就地收攤,不要讓後面每個 bar_mark 各空燒 15 秒。
  bar_start b 7 && bar_start s1 8 && bar_start s2 9 \
    || { exec 7>&- 8>&- 9>&- 2>/dev/null; printf 'BAR-RIGFAIL'; return; }
  printf "BEGIN;\nSELECT id FROM public.order_items WHERE id='%s' FOR NO KEY UPDATE;\n\\\\echo B-HOLD\n" "$ALO" >&7
  bar_mark b B-HOLD
  printf "BEGIN;\nUPDATE public.shipments SET shipped_at=now(), tracking_number='BARX1' WHERE id='%s';\n\\\\echo S1-DONE\n" "$P1" >&8
  bar_blocked s1
  printf "BEGIN;\nUPDATE public.shipments SET shipped_at=now(), tracking_number='BARX2' WHERE id='%s';\n\\\\echo S2-DONE\n" "$P2" >&9
  bar_blocked s2
  printf 'COMMIT;\n\\echo B-RELEASED\n' >&7
  bar_mark b B-RELEASED
  bar_mark s1 S1-DONE; printf 'COMMIT;\n\\echo S1-C\n' >&8; bar_mark s1 S1-C
  bar_mark s2 S2-DONE; printf 'COMMIT;\n\\echo S2-C\n' >&9; bar_mark s2 S2-C
  exec 7>&- 8>&- 9>&-
  wait 2>/dev/null
  grep -q '40P01' "$BARW/s1.out" "$BARW/s2.out" 2>/dev/null && BAR_REDS="$BAR_REDS BAR-deadlock"
  # 🔴 `55P03` 單獨一個 key:helper 的 `lock_timeout=5s` 若因為機器忙而先觸發,觀察值會長得
  #    很像「摘要沒算對」。分開報,才不會把**測試環境的雜訊**讀成一條 finding。
  grep -q '55P03' "$BARW/s1.out" "$BARW/s2.out" 2>/dev/null && BAR_REDS="$BAR_REDS BAR-locktimeout"
  { [ "$(bar_shipped BAR-A)" = "2" ] && [ "$(bar_shipped BAR-B)" = "2" ]; } || BAR_REDS="$BAR_REDS BAR-shipped"

  # ── 情境 B:先寫者**尚未提交**時後寫者進場 ⇒ 期望後寫者在鎖之後才讀真相(不 stale-low)──
  # 🔴 R2 F5:提前收攤要把**已經開起來的** fd 關掉,否則殘留的背景 psql 還握著連線
  #    ⇒ drop_db 靜默失敗、下一發報「複製 pre 副本失敗」= 診斷指錯方向。
  bar_start t1 4 && bar_start t2 5 || { exec 4>&- 5>&- 2>/dev/null; printf 'BAR-RIGFAIL'; return; }
  printf "BEGIN;\nUPDATE public.shipments SET shipped_at=now(), tracking_number='BARY1' WHERE id='%s';\n\\\\echo T1-DONE\n" "$Q1" >&4
  bar_mark t1 T1-DONE
  printf "BEGIN;\nUPDATE public.shipments SET shipped_at=now(), tracking_number='BARY2' WHERE id='%s';\n\\\\echo T2-DONE\n" "$Q2" >&5
  bar_blocked t2
  printf 'COMMIT;\n\\echo T1-C\n' >&4; bar_mark t1 T1-C
  bar_mark t2 T2-DONE; printf 'COMMIT;\n\\echo T2-C\n' >&5; bar_mark t2 T2-C
  exec 4>&- 5>&-
  wait 2>/dev/null
  grep -q '55P03' "$BARW/t1.out" "$BARW/t2.out" 2>/dev/null && BAR_REDS="$BAR_REDS BAR-locktimeout"
  # 🔴 R1 nit 8:情境 B 若真的死結,只 grep 55P03 會讓它以 `BAR-stale` 的名義紅 —— key 指錯方向。
  grep -q '40P01' "$BARW/t1.out" "$BARW/t2.out" 2>/dev/null && BAR_REDS="$BAR_REDS BAR-deadlock"
  { [ "$(bar_shipped BAR-C)" = "2" ] && [ "$(bar_shipped BAR-D)" = "2" ]; } || BAR_REDS="$BAR_REDS BAR-stale"

  # ══ 情境 C:**部分重疊 + 三品項**(R3 must-fix 6)══════════════════════════
  # 🔴 情境 A 的兩個包裹**品項集合完全相同** ⇒ 任何「順序 = 值集合的函式」都自動兩邊同序,
  #    那組 fixture **分不出「全域總序」與「只是 per-set 決定性」**。真實出貨更常是部分重疊。
  # 🔴 形狀刻意選 P={E,F,G} / Q={G,F}(共用 **兩顆**):共用一顆時死結**不可能**成環 ⇒ 那種
  #    形狀的負測構造不出來、等於沒有判別力。共用兩顆才是能真正翻面的最小形狀。
  # 🔴 期望值刻意**不全相等**(E=1、F=2、G=2):全部都是 2 時,「數列數」與「加總」會產生同樣的觀察值。
  bar_start cb 7 && bar_start cs1 8 && bar_start cs2 9 \
    || { exec 7>&- 8>&- 9>&- 2>/dev/null; printf 'BAR-RIGFAIL'; return; }
  printf "BEGIN;\nSELECT id FROM public.order_items WHERE variant_sku='BAR-F' FOR NO KEY UPDATE;\n\\\\echo CB-HOLD\n" >&7
  bar_mark cb CB-HOLD
  printf "BEGIN;\nUPDATE public.shipments SET shipped_at=now(), tracking_number='BARZ1' WHERE id='%s';\n\\\\echo C1-DONE\n" "$R1" >&8
  bar_blocked cs1
  printf "BEGIN;\nUPDATE public.shipments SET shipped_at=now(), tracking_number='BARZ2' WHERE id='%s';\n\\\\echo C2-DONE\n" "$R2" >&9
  bar_blocked cs2
  printf 'COMMIT;\n\\echo CB-RELEASED\n' >&7
  bar_mark cb CB-RELEASED
  bar_mark cs1 C1-DONE; printf 'COMMIT;\n\\echo C1-C\n' >&8; bar_mark cs1 C1-C
  bar_mark cs2 C2-DONE; printf 'COMMIT;\n\\echo C2-C\n' >&9; bar_mark cs2 C2-C
  exec 7>&- 8>&- 9>&-
  wait 2>/dev/null
  grep -q '40P01' "$BARW/cs1.out" "$BARW/cs2.out" 2>/dev/null && BAR_REDS="$BAR_REDS BAR-deadlock-partial"
  grep -q '55P03' "$BARW/cs1.out" "$BARW/cs2.out" 2>/dev/null && BAR_REDS="$BAR_REDS BAR-locktimeout"
  { [ "$(bar_shipped BAR-E)" = "1" ] && [ "$(bar_shipped BAR-F)" = "2" ] && [ "$(bar_shipped BAR-G)" = "2" ]; } \
    || BAR_REDS="$BAR_REDS BAR-partial"

  # 🔴 R1 nit 10:fifo 收工清掉(`.out` 留著,失敗時要靠它診斷);`COPIES-DROPPED` 只看 DB,看不到這類殘留。
  rm -f "$BARW"/*.in
  # 🔴 R1 nit 11:`sort` 的定序 —— 本檔第 150 行已 `export LC_ALL=C`,凍結的紅點串就是照 C 序寫的,一致。
  printf '%s' "$(printf '%s' "$BAR_REDS" | tr ' ' '\n' | grep -v '^$' | sort -u | tr '\n' ' ' | sed 's/ *$//')"
}

# 🔴 **實測常數**(2026-08-07,PG17 / 本 fixture):`EXPLAIN (COSTS OFF)` 去空白後只取 Unique/Sort 那幾行。
BAR_PLAN_SHAPE="Unique/->Sort/SortKey:si.order_item_id/|Unique/->Sort/SortKey:order_item_id/"
BMUT=0
run_bmut() {   # $1 = 靶名、$2 = 突變檔、$3 = 期望紅點、$4 = key
  local name="$1" file="$2" want="$3" key="$4" db="b2s2b_bar" got rc
  BMUT=$((BMUT+1))
  [ -s "$file" ] || { bad "$name:突變檔不存在或為空"; return; }
  if [ "$key" != "BMUT-0" ]; then
    cmp -s "$WORK/mut0.sql" "$file"; rc=$?
    case "$rc" in
      1) : ;;
      0) bad "$name:與 mut0 逐字相同 —— 沒改到東西"; return ;;
      *) bad "$name:cmp 讀不到檔(rc=$rc)—— 判紅"; return ;;
    esac
  fi
  psql -X "$ADMIN_URL" -q -c "DROP DATABASE IF EXISTS $db" >/dev/null 2>&1
  psql -X "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE $db TEMPLATE b2s2b_pre" >/dev/null 2>&1 \
    || { sleep 1; psql -X "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE $db TEMPLATE b2s2b_pre" >/dev/null 2>&1 \
         || { bad "$name:複製 pre 副本失敗"; return; }; }
  if ! psql -X "postgresql://postgres@127.0.0.1:${PORT}/$db" -v ON_ERROR_STOP=1 -q -f "$file" > "$WORK/bmut-$key.log" 2>&1; then
    bad "$name:突變版 migration 套不上去($(grep -m1 ERROR "$WORK/bmut-$key.log" | cut -c1-90))
     🔴 套不上去 ≠ 抓到 —— 沒有量到任何 oracle,不得算過"
    drop_db "$db"; return
  fi
  if ! psql -X "postgresql://postgres@127.0.0.1:${PORT}/$db" -v ON_ERROR_STOP=1 -q \
       -c "DO \$bar\$ DECLARE v_cust uuid; v_order uuid; v_a uuid; v_b uuid; v_lo uuid; v_hi uuid; v_c uuid; v_d uuid; v_sup uuid; v_p1 uuid; v_p2 uuid; v_q1 uuid; v_q2 uuid; v_e uuid; v_f uuid; v_g uuid; v_sorted uuid[]; v_r1 uuid; v_r2 uuid; BEGIN $BAR_FIX END \$bar\$;" \
       > "$WORK/bmut-fix-$key.log" 2>&1; then
    bad "$name:barrier fixture 載入失敗($(grep -m1 ERROR "$WORK/bmut-fix-$key.log" | cut -c1-90))"
    drop_db "$db"; return
  fi
  # 🔴 R1 nit 6:整個 L2a 的結論(「拿掉 ORDER BY 不翻面」)壓在**查詢計畫的形狀**上,
  #    而那本來只是我跑過一次的 EXPLAIN。這裡把它釘成斷言 —— 形狀一變(改用 HashAggregate、
  #    或未來換 PG 版本 / 列數 / `enable_hashagg`),這一格立刻紅,不會讓那段結論靜默過期。
  #    只在對照組量:L2b 的受測查詢本來就沒有 `DISTINCT`,形狀本該不同。
  if [ "$key" = "BMUT-0" ]; then
    local shape
    # 🔴 R2 F6:第一版量的是**手寫代理查詢**(字面子查詢),而 plpgsql 裡是
    #    WHERE si.shipment_id = NEW.id 的**參數化**語句 —— 兩者的 custom / generic 計畫可能分歧。
    #    ⇒ 兩種都量、兩種都凍:plan_cache_mode = force_generic_plan + PREPARE/EXECUTE 拿 generic 那一份。
    local sid
    sid="$(psql -X "postgresql://postgres@127.0.0.1:${PORT}/$db" -qtAc "SELECT id FROM public.shipments WHERE shipment_reference='BCDFGJ'" 2>/dev/null)"
    shape="$(psql -X "postgresql://postgres@127.0.0.1:${PORT}/$db" -qtAc "EXPLAIN (COSTS OFF) SELECT DISTINCT si.order_item_id FROM public.shipment_items si WHERE si.shipment_id=(SELECT id FROM public.shipments WHERE shipment_reference='BCDFGJ')" 2>/dev/null | tr -d ' ' | grep -E 'Unique|Sort' | tr '\n' '/')"
    shape="${shape}|$(psql -X "postgresql://postgres@127.0.0.1:${PORT}/$db" -qtA -v sid="$sid" 2>/dev/null <<'PLANSQL' | tr -d ' ' | grep -E 'Unique|Sort' | tr '\n' '/'
SET plan_cache_mode = force_generic_plan;
PREPARE bshape(uuid) AS SELECT DISTINCT si.order_item_id FROM public.shipment_items si WHERE si.shipment_id = $1;
EXPLAIN (COSTS OFF) EXECUTE bshape(:'sid');
PLANSQL
)"
    if [ "$shape" = "$BAR_PLAN_SHAPE" ]; then
      ok BAR-PLAN-SHAPE "DISTINCT 的查詢計畫仍是 Sort+Unique —— **custom 與 generic 兩種都量**(逐字 [$shape])⇒ 迭代序仍由值決定、兩 session 恆等,靶 L2a 的空集合結論仍成立"
    else
      bad "DISTINCT 的查詢計畫變了:實得 [$shape] / 期望 [$BAR_PLAN_SHAPE]
     🔴 靶 L2a「拿掉 ORDER BY 不翻面」的結論**建立在這個形狀上**,形狀變了就要重測,不得沿用"
    fi
  fi
  got="$(barrier_oracle "$db")"
  drop_db "$db"
  if [ "$got" != "$want" ]; then
    bad "$name:紅點不符 —— 實際 [$got] / 期望 [$want]"
  elif [ "${key%-INCONCLUSIVE}" != "$key" ]; then
    inconc "$key" "$name ⇒ 紅點逐字相符:[$want] —— 🔴 **不入 PASS 帳**:plan §4 項19 的翻面條件未滿足。主視窗已裁 C(維持第三態),**終局判定綁 apply 前 preflight**"
  else
    ok "$key" "$name ⇒ 紅點逐字相符:[$want]"
  fi
}

log "6g/8 項19 barrier(三 session 真併發;**inconclusive** —— 見上方註解)"
# 🔴 對照組:整組編排在**未改動**的 migration 上必須零紅點。它同時是「rig 還活著」的下限證明。
run_bmut "BAR0-只剝 §5、零改動(對照組)" "$WORK/mut0.sql" "" BMUT-0

# ── 靶 L1:helper 的 NKU 鎖**移到讀真相之後** ────────────────────────────────
# 🔴 plan §5 逐字點名這一靶「**必須真的翻面**」——它是小線 S1 消融 #25 的回歸點
#    (那次拿掉 NKU,整個 harness 全綠 = 那把鎖當時沒有任何東西在看)。
# 🔴 它為什麼會 stale-low:read committed 下每個 statement 各自取快照。鎖若排在讀之後,
#    後到的 session 會**先讀到看不見對方未提交出貨的真相**、再去排隊等鎖;等到了才把那個
#    過期的值寫回去,直接蓋掉先提交者算對的值。鎖排在讀之前,它會先卡住、醒來後重讀 ⇒ 讀到全貌。
make_mutant_or_die "$WORK/bmut1.sql" \
'   FOR NO KEY UPDATE;
  IF NOT FOUND THEN' \
'   ;
  IF NOT FOUND THEN'
BMUT1_TMP="$WORK/bmut1.sql"
BMUT1_SRC='  -- SHIPPED-TRUTH-END
'
BMUT1_DST='  -- SHIPPED-TRUTH-END

  SELECT oi2.quantity INTO v_qty FROM public.order_items oi2
   WHERE oi2.id = p_order_item_id FOR NO KEY UPDATE;
'
# 🔴 這一靶要動**兩處**(拆掉原位的鎖 + 在讀完之後補回同一把鎖),`make_mutant` 只吃一處
#    ⇒ 第二處在這裡補,並且**同樣要求恰 1 次命中**,錨失效就 die,不允許默默沒改到。
F="$BMUT1_TMP" SRC="$BMUT1_SRC" DST="$BMUT1_DST" python3 - <<'PY' || die "靶L1 第二處錨失效"
import io, os
f = os.environ['F']; s = io.open(f, encoding='utf-8').read()
src, dst = os.environ['SRC'], os.environ['DST']
n = s.count(src)
if n != 1:
    raise SystemExit('靶L1 第二處錨命中 %d 次(必須恰 1 次)' % n)
io.open(f, 'w', encoding='utf-8').write(s.replace(src, dst))
PY
run_bmut "靶L1-NKU 鎖移到讀真相之後" "$WORK/bmut1.sql" "BAR-partial BAR-shipped BAR-stale" BMUT-L1

# ── 靶 L2a:plan 指定的「迭代拿掉 ORDER BY」──────────────────────────────────
# 🔴🔴 **實測:這一靶翻不了面,期望紅點是空集合。** 原因是 PG 把 `DISTINCT` 規劃成
#    `Sort + Unique`(實跑 EXPLAIN:`Unique → Sort(Sort Key: order_item_id) → Bitmap Heap Scan`),
#    輸出順序與 `ORDER BY order_item_id` 相同;而兩個 session 跑的是**同一支函式**
#    ⇒ 順序只是值集合的函式,兩邊恆等,反序取鎖構造不出來。
# 🔴 這個「空集合」**不是 fail-open**,它的判別力由**同一套編排下的靶 L2b** 背書:
#    L2b 在完全相同的 rig 上真的丟出 `40P01`。沒有 L2b,這一格與「rig 根本抓不到死結」不可分。
# 🔴🔴 **key 名自己承載事實 + 這一格不入 PASS 帳**(R1 must-fix 2 / R2 must-fix F1):
#    key 叫 `BMUT-L2A-INCONCLUSIVE`,而且走 `inconc` 不走 `ok` —— 因為機器可讀的那三個面
#    (離開碼、PASS 數、凍結 key 集合)才是會被往上引用的東西;只把「plan §4 的翻面條件沒被滿足」
#    寫在 prose 裡等於沒寫,R2 的原話是「rc-only 消費者會在裁定發生前把項19 讀成已過」。
#    ⇒ 它自己有一組凍結的待裁 key 集合,收尾離開碼 3。**這不是替主視窗判它紅,是拒絕先記成過。**
# 🔴 因此結論要寫準:**今天擋住反序取鎖的是 `DISTINCT` 的排序,不是 `ORDER BY` 那幾個字。**
#    `ORDER BY` 仍留著(它把保證寫成明文、且在 `DISTINCT` 哪天被拿掉時才是唯一防線)——
#    但**不得宣稱本 harness 守得住它**;它現在沒有靶。
make_mutant_or_die "$WORK/bmut2.sql" \
'     ORDER BY si.order_item_id
  LOOP' \
'  LOOP'
run_bmut "靶L2a-迭代拿掉 ORDER BY(plan 指定;實測不翻面)" "$WORK/bmut2.sql" "" BMUT-L2A-INCONCLUSIVE

# ── 靶 L2b:連 `DISTINCT` 一起拿掉 ⇒ 順序退化成該包裹的實體列序 ────────────────
# 🔴 這一靶存在的理由**不是**因為有人會這樣改,而是為了證明「這套 barrier 抓得到反序取鎖」。
#    沒有它,L2a 的空集合只是一句沒有證據的話。
make_mutant_or_die "$WORK/bmut3.sql" \
'    SELECT DISTINCT si.order_item_id
      FROM public.shipment_items si
     WHERE si.shipment_id = NEW.id
     ORDER BY si.order_item_id' \
'    SELECT si.order_item_id
      FROM public.shipment_items si
     WHERE si.shipment_id = NEW.id'
# 🔴 情境 C(部分重疊 + 三品項)也真的翻面 ⇒ 紅點多了 `BAR-deadlock-partial` 與 `BAR-partial`。
#    這正是 R3 must-fix 6 要的:反序取鎖的危險**不是**只在「兩包裹品項集合相同」那種人造形狀下才有。
run_bmut "靶L2b-連 DISTINCT 一起拿掉(rig 判別力背書)" "$WORK/bmut3.sql" "BAR-deadlock BAR-deadlock-partial BAR-partial BAR-shipped" BMUT-L2B

[ "$BMUT" -eq "$EXPECT_BMUT" ] && ok BMUT-COUNT "項19 barrier 靶跑了 $BMUT 發,與凍結值相符" \
  || bad "項19 barrier 靶只跑了 $BMUT 發,期望 $EXPECT_BMUT"


log "6b/8 真相式六塊同步守門(S2b-3a 後段;plan §1.1 v3.1)"
# 🔴 守門本體在 `scripts/b2s2b-truth-sync.py`(抽取 + 判定,純文字、不碰 DB)。
#    本段負責:①對照組必須零紅 ②**九發突變逐發只紅指定的紅點集合**(`B-151-A`:兩半各至少一發)。
# 🔴 突變比對象 = **原檔**(plan §2.2 W5 ②:文件/腳本突變沒有 mut0,也不該剝掉受測 guard)。
# 🔴 **九發的分配與 plan §5 字面的對應關係(逐條寫,不用「嚴格強於」這種不可查證的講法)**:
#    plan 字面 = 「五發改本體(逐處一發)+ 一發把述詞改恆等式(**指定打第 5 處 = backfill**)」。
#    · T1-T5 = plan 的「五發改本體」,逐塊各一發(五個嵌入形區塊)。
#    · **T7 = plan 指定的那一發**(backfill 塊的述詞改恆等式)—— R1 抓到我上一版把它挪到 helper、
#      導致 plan 點名的那個縫沒被驗;現在 T6(helper)與 T7(backfill)兩發都在。
#    · T8 / T9 = plan 沒要求的兩發:位置集合被「刪一格+重複另一格」、標記被刪。
#      前者是 R1 實測可繞過守門的活洞,後者打的是塊數/配對那條(其餘七發都只打字面)。
# 🔴 **仍然沒有靶的**:`FROZEN`(凍結表自我一致性)與 `FILE:` 的讀檔失敗路徑。
#    前者在本片開發中**真的紅過一次**(helper 與 COMMON 碰巧共用一行,見 truth-sync 檔內註解),
#    但那不是提交在案的突變 ⇒ 不得算進覆蓋率。
TSYNC="scripts/b2s2b-truth-sync.py"
TMUT=0
CELL=$((CELL+1))
# 🔴 **必須同時看 rc**(R1 must-fix 2 實測):守門 crash(例如檔案含非 UTF-8 位元組)時
#    stdout 是空的、rc=1 —— 只看「stdout 空」會把 crash 讀成全綠,正是本檔自己列的 fail-closed 紀律④。
TS_CTL="$(python3 "$TSYNC" . 2>"$WORK/tsync-ctl.err")"; TS_RC=$?
if [ -z "$TS_CTL" ] && [ "$TS_RC" -eq 0 ]; then
  ok TRUTH-SYNC "🔴 同步守門對照組:六塊**整塊序列**逐字相符(含順序)+ 凍結表自我一致性(分半原則 5+1 / helper 整塊)+ 位置 key 集合 + 三個檔的 BEGIN/END 配對與塊數"
else
  bad "同步守門對照組不通過(rc=$TS_RC):紅點 [$(printf '%s' "$TS_CTL" | tr '\n' ' ')]
$(head -5 "$WORK/tsync-ctl.err")"
fi

run_tmut() {   # $1 = 靶名、$2 = 目標檔、$3 = 原字面、$4 = 新字面、$5 = 期望紅點集合、$6 = key
  local name="$1" f="$2" src="$3" dst="$4" want="$5" key="$6" root="$WORK/tsync-$6" got rc
  TMUT=$((TMUT+1))
  rm -rf "$root"; mkdir -p "$root/supabase/migrations" "$root/docs/runbooks" "$root/scripts"
  cp "$MIG" "$root/$MIG" && cp docs/runbooks/a4a-summary-rollback.md "$root/docs/runbooks/" \
    && cp scripts/a4a-verify.sh "$root/scripts/" && cp "$TSYNC" "$root/scripts/" \
    || { bad "$name:複製受守檔失敗"; rm -rf "$root"; return; }
  SRC="$src" DST="$dst" F="$root/$f" python3 - <<'PY' || { bad "$name:突變產生失敗(錨命中次數不是 1?)"; rm -rf "$root"; return; }
import io, os
p = os.environ['F']; src = os.environ['SRC']; dst = os.environ['DST']
s = io.open(p, encoding='utf-8').read()
n = s.count(src)
if n != 1:
    raise SystemExit('突變錨命中 %d 次(必須恰 1 次):%r' % (n, src[:70]))
io.open(p, 'w', encoding='utf-8').write(s.replace(src, dst))
PY
  cmp -s "$f" "$root/$f"; rc=$?
  case "$rc" in
    1) : ;;
    0) bad "$name:突變檔與原檔**逐字相同** —— 沒改到東西,這一發等於沒跑"; rm -rf "$root"; return ;;
    *) bad "$name:cmp 讀不到檔(rc=$rc)—— 判紅,不當成「有差異」"; rm -rf "$root"; return ;;
  esac
  got="$(python3 "$root/$TSYNC" "$root" 2>"$WORK/tsync-$key.err" | tr '\n' ' ' | sed 's/ *$//')"
  rm -rf "$root"
  if [ "$got" = "$want" ]; then ok "$key" "$name ⇒ 紅點逐字相符:[$want]"
  else bad "$name:紅點集合不符
     實際 [$got]
     期望 [$want]
     診斷:$(head -3 "$WORK/tsync-$key.err" 2>/dev/null | tr '\n' ' ')"; fi
}

# ── T1-T5:打**全等半**(五個嵌入形區塊各一發)────────────────────────────────
run_tmut "靶T1-runbook 對帳欄位塊改 JOIN 條件" docs/runbooks/a4a-summary-rollback.md \
'AS truth_cancelled,
-- SHIPPED-TRUTH-BEGIN
COALESCE((SELECT sum(si.shipped_quantity)
FROM public.shipment_items si
JOIN public.shipments sh ON sh.id = si.shipment_id' \
'AS truth_cancelled,
-- SHIPPED-TRUTH-BEGIN
COALESCE((SELECT sum(si.shipped_quantity)
FROM public.shipment_items si
JOIN public.shipments sh ON sh.id = si.id' \
  "rb-div-col" TMUT-1

run_tmut "靶T2-runbook 對帳 WHERE 塊把 deleted_at 反向" docs/runbooks/a4a-summary-rollback.md \
'WHERE si.order_item_id = u.order_item_id
AND sh.deleted_at IS NULL
AND sh.shipped_at IS NOT NULL), 0)
-- SHIPPED-TRUTH-END
      ;' \
'WHERE si.order_item_id = u.order_item_id
AND sh.deleted_at IS NOT NULL
AND sh.shipped_at IS NOT NULL), 0)
-- SHIPPED-TRUTH-END
      ;' \
  "rb-div-where" TMUT-2

run_tmut "靶T3-runbook 步驟⑤塊改加總的欄" docs/runbooks/a4a-summary-rollback.md \
'       OR s.shipped_quantity   IS DISTINCT FROM
-- SHIPPED-TRUTH-BEGIN
COALESCE((SELECT sum(si.shipped_quantity)' \
'       OR s.shipped_quantity   IS DISTINCT FROM
-- SHIPPED-TRUTH-BEGIN
COALESCE((SELECT sum(si.quantity_shipped)' \
  "rb-step5" TMUT-3

run_tmut "靶T4-a4a-verify 塊漏掉 shipped_at 那行" scripts/a4a-verify.sh \
'AND sh.deleted_at IS NULL
AND sh.shipped_at IS NOT NULL), 0)
-- SHIPPED-TRUTH-END' \
'AND sh.deleted_at IS NULL
AND sh.shipped_at IS NOT NULL), 0) -- 夾帶
-- SHIPPED-TRUTH-END' \
  "av-oracle" TMUT-4

run_tmut "靶T5-migration backfill 塊改 FROM 的表" "$MIG" \
'-- SHIPPED-TRUTH-BEGIN
COALESCE((SELECT sum(si.shipped_quantity)
FROM public.shipment_items si' \
'-- SHIPPED-TRUTH-BEGIN
COALESCE((SELECT sum(si.shipped_quantity)
FROM public.shipment_items_v2 si' \
  "backfill" TMUT-5

# ── T6:打 **per-site 半**(helper 塊整塊 per-site、不參與全等半)────────────────
# 🔴 這一發同時是 plan §5 指定的「述詞改恆等式」形狀:`si.order_item_id = si.order_item_id`
#    = 加總**全店**出貨。它滿足「存在一條等式」⇒ 只驗「有等式」的寫法對它全盲(plan §1.1 自承的恆真族)。
run_tmut "靶T6-helper 塊述詞改恆等式(per-site 半)" "$MIG" \
'   WHERE si.order_item_id = p_order_item_id' \
'   WHERE si.order_item_id = si.order_item_id' \
  "helper" TMUT-6

# ── T7:plan §5 **指定打第 5 處**(backfill oracle)的述詞恆等式 ─────────────────
# 🔴 R1 must-fix 4:我上一版只把恆等式打在 helper,而 plan 逐字指定的是**第 5 處**
#    (理由:它是「唯一開工才定值的一列」,打已有具體凍結值的處驗不到那個縫)⇒ 補這一發。
#    T6 與 T7 不重複:一個打 helper 塊、一個打 backfill 塊,是 per-site 半的兩個代表。
run_tmut "靶T7-backfill 塊述詞改恆等式(plan 指定的第 5 處)" "$MIG" \
'WHERE si.order_item_id = s.order_item_id
AND sh.deleted_at IS NULL
AND sh.shipped_at IS NOT NULL), 0)
-- SHIPPED-TRUTH-END
         ;' \
'WHERE si.order_item_id = si.order_item_id
AND sh.deleted_at IS NULL
AND sh.shipped_at IS NOT NULL), 0)
-- SHIPPED-TRUTH-END
         ;' \
  "backfill" TMUT-7

# ── T8:攻擊守門**自己的位置集合**(R1 must-fix 1 的那一發)────────────────────
# 🔴 「刪一格 + 重複另一格」——只凍個數時它會全綠(R1 實測過),凍 key 集合才殺得掉。
#    這一發同時是 plan §1.1 要求的「把別的東西丟進集合 ⇒ 必須紅在集合本身」那個負測的等價形狀。
run_tmut "靶T8-守門的 SITES 刪一格+重複另一格" scripts/b2s2b-truth-sync.py \
"    ('rb-step5',      RB,  3, True)," \
"    ('rb-div-col',    RB,  1, True)," \
  "SITES" TMUT-8

# ── T9:刪掉一個標記 ⇒ 必須紅在「檔案塊數不符」與「取不到該塊」───────────────
# 🔴 這一發打的是 `extract_all` 與塊數自斷言那條(其餘八發都打字面比對)。
run_tmut "靶T9-刪掉 runbook 收尾段的 BEGIN 標記" docs/runbooks/a4a-summary-rollback.md \
'       OR s.shipped_quantity   IS DISTINCT FROM
-- SHIPPED-TRUTH-BEGIN
COALESCE((SELECT sum(si.shipped_quantity)' \
'       OR s.shipped_quantity   IS DISTINCT FROM
COALESCE((SELECT sum(si.shipped_quantity)' \
  "FILE:a4a-summary-rollback.md rb-step5" TMUT-9

log "6c/8 債①②:出貨側停寫/回權 + divergence 第四軸(S2b-3b;項26 / 26b / 27)"
# 🔴 **文字斷言 + 行為斷言兩層,缺一不可**(memory `feedback_guard-checks-existence-not-effect`):
#    只斷言「runbook 裡有 DISABLE 那行」證不到它有效;只跑 DB 行為證不到災難日的人**會照著做**。
RUNBOOK="docs/runbooks/a4a-summary-rollback.md"
# 🔴 trigger 名走 $TG_SS(檔頭單一定義),不在這裡再寫死一份(R1 nit 10)。
STOPWRITE_DISABLE="ALTER TABLE public.shipments DISABLE TRIGGER ${TG_SS};"
STOPWRITE_ENABLE="ALTER TABLE public.shipments ENABLE TRIGGER ${TG_SS};"

# ── 項26/26b 的文字面:兩句都在,而且**在對的步驟裡** ──────────────────────────
# 🔴 只查「檔案裡有這句」不夠:兩句寫在同一個步驟裡也會過,而那是壞的
#    (停寫寫在步驟⑦ = 災難日根本沒停到)。⇒ 用步驟標題切段,逐段查。
stopwrite_check() {   # $1 = runbook 路徑 → 印出紅點 key(全綠零輸出)
  RB="$1" D="$STOPWRITE_DISABLE" E="$STOPWRITE_ENABLE" python3 - <<'PY'
import io, os, re
s = io.open(os.environ['RB'], encoding='utf-8').read()
D, E = os.environ['D'], os.environ['E']
parts = re.split(r'(?m)^## 步驟 ', s)
seg = {}
for p in parts[1:]:
    seg[p[0]] = p
reds = []
if D not in seg.get('①', ''):
    reds.append('RB-STOPWRITE-disable')
if E not in seg.get('⑦', ''):
    reds.append('RB-STOPWRITE-enable')
# 🔴 兩句都必須**全檔恰一次**:重複寫兩處時,刪掉其中一處的突變會抓不到。
if s.count(D) != 1:
    reds.append('RB-STOPWRITE-disable-count')
if s.count(E) != 1:
    reds.append('RB-STOPWRITE-enable-count')
for r in reds:
    print(r)
print('OK-SENTINEL')      # 成功哨兵:checker 自己 crash 時不會印它(R2 nit F6)
PY
}
CELL=$((CELL+1))
# 🔴 認**哨兵**而不是認「輸出為空」:checker 自己 crash 時 stdout 也是空的(R2 nit F6)。
SW_RAW="$(stopwrite_check "$RUNBOOK" 2>"$WORK/sw.err")"
SW_CTL="$(printf '%s' "$SW_RAW" | grep -v '^OK-SENTINEL$' | tr '\n' ' ' | sed 's/ *$//')"
SW_SENT="$(printf '%s' "$SW_RAW" | grep -c '^OK-SENTINEL$')"
if [ -z "$SW_CTL" ] && [ "$SW_SENT" = "1" ]; then
  ok RB-STOPWRITE "🔴 項26/26b 文字面:停寫 DISABLE 在**步驟①**、回權 ENABLE 在**步驟⑦**,各全檔恰一次"
else
  bad "項26/26b 文字面不符:[$SW_CTL](哨兵=$SW_SENT;0 代表 checker 自己炸了 —— $(head -2 "$WORK/sw.err" 2>/dev/null | tr '\n' ' '))"
fi

# ── 兩發突變:拿掉任一句,對應那格必須翻面 ────────────────────────────────────
# 🔴 支援**第二組替換**($6/$7,選用):像「把一句從①搬到⑦」這種突變,單一替換做不出來
#    —— 只刪不插會讓全檔計數變 0(紅在 count 而不是紅在段落),證不到「切段」那一半。
run_swmut() {   # $1 靶名、$2 原字面、$3 新字面、$4 期望紅點、$5 key、[$6 第二組原字面、$7 第二組新字面]
  local name="$1" src="$2" dst="$3" want="$4" key="$5" src2="${6:-}" dst2="${7:-}" f="$WORK/rb-$5.md" got
  TMUT=$((TMUT+1))
  SRC="$src" DST="$dst" SRC2="$src2" DST2="$dst2" IN="$RUNBOOK" OUT="$f" python3 - <<'PY' || { bad "$name:突變產生失敗"; return; }
import io, os
s = io.open(os.environ['IN'], encoding='utf-8').read()
pairs = [(os.environ['SRC'], os.environ['DST'])]
if os.environ.get('SRC2'):
    pairs.append((os.environ['SRC2'], os.environ['DST2']))
for src, dst in pairs:
    n = s.count(src)
    if n != 1:
        raise SystemExit('突變錨命中 %d 次(必須恰 1 次):%r' % (n, src[:60]))
    s = s.replace(src, dst)
io.open(os.environ['OUT'], 'w', encoding='utf-8').write(s)
PY
  cmp -s "$RUNBOOK" "$f"; case "$?" in
    1) : ;;
    0) bad "$name:突變檔與原檔逐字相同 —— 沒改到東西"; rm -f "$f"; return ;;
    *) bad "$name:cmp 讀不到檔 —— 判紅"; rm -f "$f"; return ;;
  esac
  got="$(stopwrite_check "$f" 2>/dev/null | grep -v '^OK-SENTINEL$' | tr '\n' ' ' | sed 's/ *$//')"
  rm -f "$f"
  if [ "$got" = "$want" ]; then ok "$key" "$name ⇒ 紅點逐字相符:[$want]"
  else bad "$name:紅點不符 —— 實際 [$got] / 期望 [$want]"; fi
}
run_swmut "靶S1-拿掉步驟① 的停寫" "$STOPWRITE_DISABLE" '-- (停寫那行被拿掉了)' \
  "RB-STOPWRITE-disable RB-STOPWRITE-disable-count" TMUT-S1
run_swmut "靶S2-拿掉步驟⑦ 的回權" "$STOPWRITE_ENABLE" '-- (回權那行被拿掉了)' \
  "RB-STOPWRITE-enable RB-STOPWRITE-enable-count" TMUT-S2
# 🔴 **S3 專打「切段」那一半**(R1 important 6):S1/S2 只證明「那句在檔案裡」——
#    把判定退化成全檔 grep,S1/S2 的紅點集合**逐字不變**(R1 實測)。
#    這一發把停寫**從步驟①刪掉、改插進步驟⑦**:全檔仍恰一次、但不在①裡
#    ⇒ 只有真的切段判斷才紅得到「-disable」而不紅「-disable-count」。
run_swmut "靶S3-把停寫從步驟①搬到步驟⑦" \
  "$STOPWRITE_DISABLE" '-- (從①移走)' \
  "RB-STOPWRITE-disable" TMUT-S3 \
  "$STOPWRITE_ENABLE" "$STOPWRITE_DISABLE
$STOPWRITE_ENABLE"

# ── 項26b 行為面:**恢復之後真的重新跟動**(項26 的停用面由 ABLATION 格承擔)────────
# 🔴 這一格是債① 的另一半:停了不恢復 ⇒ 出貨側永久停寫,而三軸對帳仍全綠、零告警。
CELL=$((CELL+1))
fresh_db b2s2b_enb; ENB_URL="$FRESH_URL"
ENB_GOT="$(psql -X "$ENB_URL" -v ON_ERROR_STOP=0 -qtA 2>&1 <<SQL | sed -n 's/^NOTICE:  GOT:\(.*\)$/\1/p' | head -1
BEGIN;
ALTER TABLE public.shipments DISABLE TRIGGER ${TG_SS};
ALTER TABLE public.shipments ENABLE TRIGGER ${TG_SS};
DO \$enb\$
$DECLS
BEGIN
$FIXTURE
$STOCK_I4
$MK_DRAFT
  INSERT INTO public.shipment_items (shipment_id, order_item_id, shipped_quantity) VALUES (v_ship, v_i4, 2);
$SHIP_NOW
  SET CONSTRAINTS ALL IMMEDIATE;
  SELECT ($SHIPPED_OF_I4) INTO v_got;
  RAISE NOTICE 'GOT:%', COALESCE(v_got, '<NULL>');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'GOT:ERR:%:%', SQLSTATE, SQLERRM;
END
\$enb\$;
ROLLBACK;
SQL
)"
if [ "$ENB_GOT" = "2/3" ]; then
  ok B26b-enable-restores "🔴 項26b:DISABLE → **ENABLE** 之後跑完整出貨串 ⇒ shipped 重新跟動 = 2/3(對照組:只 DISABLE 不 ENABLE 的 ABLATION 格是 0/3)"
elif [ -z "$ENB_GOT" ]; then
  bad "項26b:拿不到觀察值(fail-closed 判紅)"
else
  bad "項26b:期望「2/3」,實得「$ENB_GOT」—— ENABLE 之後沒有恢復跟動,出貨側等於永久停寫"
fi
drop_db b2s2b_enb

# ── 項27:divergence 第四軸的**驗收 fixture** ──────────────────────────────────
# plan 逐字:造只有 shipped 漂移、前三軸完全正確的資料 ⇒ 舊三軸版**回 0 列**(證明它真的瞎)、
#           四軸版**回 1 列且指名該品項**。
# 🔴 受測對象是 **runbook 檔內那段 SQL 本身**(從檔案抽出來跑),不是抄一份到這裡 ——
#    抄一份的話 runbook 改壞了本格照樣綠。
CELL=$((CELL+1))
fresh_db b2s2b_div; DIV_URL="$FRESH_URL"
RB_IN="$RUNBOOK" OUT="$WORK/rb-div.sql" python3 - <<'PY' || die "項27:抽不出 runbook 的 divergence 段"
import io, os
s = io.open(os.environ['RB_IN'], encoding='utf-8').read()
i = s.index('CREATE TABLE public.a4a_rollback_divergence AS')
j = s.index('-- received_quantity drift', i)
io.open(os.environ['OUT'], 'w', encoding='utf-8').write(s[i:j])
PY
psql -X "$DIV_URL" -v ON_ERROR_STOP=1 -q >/dev/null 2>&1 <<SQL || die "項27:fixture 建立失敗"
ALTER TABLE public.shipments DISABLE TRIGGER ${TG_SS};
DO \$fx\$
$DECLS
BEGIN
$FIXTURE
$STOCK_I4
$MK_DRAFT
  INSERT INTO public.shipment_items (shipment_id, order_item_id, shipped_quantity) VALUES (v_ship, v_i4, 2);
$SHIP_NOW
END
\$fx\$;
SQL
DIV_ITEM="$(psql -X "$DIV_URL" -qtAc "SELECT id FROM public.order_items WHERE variant_sku = 'S2BV-P4'" 2>&1)"
DIV_PRE="$(psql -X "$DIV_URL" -qtAc "SELECT ordered_quantity::text||'/'||instock_quantity::text||'/'||cancelled_quantity::text||'/'||shipped_quantity::text FROM ${SUMMARY} WHERE order_item_id='$DIV_ITEM'" 2>&1)"
DIV_OLD="$(psql -X "$DIV_URL" -qtAc "SELECT count(*) FROM ${SUMMARY} s
  WHERE s.ordered_quantity   IS DISTINCT FROM COALESCE((SELECT sum(p.allocated_quantity) FROM public.order_item_procurement p WHERE p.order_item_id=s.order_item_id),0)
     OR s.cancelled_quantity IS DISTINCT FROM COALESCE((SELECT sum(c.cancelled_quantity) FROM public.order_cancellation_items c WHERE c.order_item_id=s.order_item_id),0)
     OR s.instock_quantity   IS DISTINCT FROM COALESCE((SELECT sum(r.quantity) FROM public.order_item_procurement_receipts r
           WHERE r.procurement_id IN (SELECT p2.id FROM public.order_item_procurement p2 WHERE p2.order_item_id=s.order_item_id)),0)" 2>&1)"
psql -X "$DIV_URL" -v ON_ERROR_STOP=1 -q -f "$WORK/rb-div.sql" >/dev/null 2>"$WORK/rb-div.err" \
  || die "項27:runbook 的 divergence 段執行失敗($(head -1 "$WORK/rb-div.err"))"
DIV_NEW="$(psql -X "$DIV_URL" -qtAc "SELECT count(*)::text || '/' || coalesce(max(order_item_id::text),'-') || '/' || coalesce(max(snap_shipped)::text,'-') || '/' || coalesce(max(truth_shipped)::text,'-') FROM public.a4a_rollback_divergence" 2>&1)"
drop_db b2s2b_div
if [ "$DIV_PRE" = "3/3/0/0" ] && [ "$DIV_OLD" = "0" ] && [ "$DIV_NEW" = "1/$DIV_ITEM/0/2" ]; then
  ok B27-divergence-4th "🔴 項27:前三軸完全正確(3/3/0)、只有 shipped 漂移 ⇒ **舊三軸版回 0 列(真的瞎)**、runbook 的四軸版回 **1 列且指名該品項**(snap 0 / truth 2)"
else
  bad "項27:期望「前三軸 3/3/0/0 + 舊版 0 + 新版 1/$DIV_ITEM/0/2」,實得「$DIV_PRE + $DIV_OLD + $DIV_NEW」"
fi

log "6d/8 契約債④:Forward 重建清單的**產物** rehearsal(S2b-3b;plan 項31③④)"
# 🔴 為什麼這一格非建不可(plan 項31 逐字):`scripts/b2s2a-verify.sh` 的項13 只量**摘要表的欄數與
#    CHECK 數**,而 S2b **不加欄、不加 CHECK** ⇒ 它對 S2b 的產物**結構上全盲**;
#    把 S2b 從 runbook 清單拿掉,那一格照樣綠。債④ 真正的守門只能建在這裡。
# 🔴 重放前**必須先照 runbook 步驟④ 的 DROP 序拆掉五 trigger / 六函式**:
#    A4a 有 5 個裸 `CREATE FUNCTION`(無 OR REPLACE)⇒ 在已 provision 的庫上直接重放必 `42723`。
# 🔴 清單**從 runbook 檔內抽**(不是抄一份到這裡)—— 抄一份的話,runbook 漏掉 S2b 本格照樣綠。
reh_products() {   # $1 = 要照哪一份 runbook → 印出「<helper 四軸?>/<trigger 在?>」或 <異常碼>
  local rb="$1" db="b2s2b_reh" U migs ts p
  fresh_db "$db"; U="$FRESH_URL"
  # ① 照步驟④ 的 DROP 序拆除(出貨側先、helper 最後)+ 摘要表與複合鍵(A1 要重建它們)
  # 🔴🔴 **DROP 清單從 runbook 步驟④ <u>抽出來</u>,不是手抄**(R1 must-fix 5):
  #    手抄的話,把 `runbook` 步驟④ 的那兩行出貨側 DROP 刪掉,本格照樣綠 ⇒ **項21b 就沒有守門**,
  #    只剩散文。抽出來之後,這一格同時守住 21b(拆除清單)與 31(重放清單)——
  #    「兩項共用同一次 rehearsal」這句才成立。
  RB2="$rb" OUT="$WORK/reh-drop.sql" python3 - <<'PY' || { printf 'RUNBOOK-DROP-PARSE-FAIL'; drop_db "$db"; return; }
import io, os, re
s = io.open(os.environ['RB2'], encoding='utf-8').read()
i = s.index('## 步驟 ④')
j = s.index('## 步驟 ⑤', i)
blocks = re.findall(r'```sql\n(.*?)```', s[i:j], re.S)
if len(blocks) != 1:
    raise SystemExit('步驟④ 的 sql 區塊不是恰一個(%d)' % len(blocks))
sql = blocks[0]
n_tg = len(re.findall(r'(?m)^DROP TRIGGER ', sql))
n_fn = len(re.findall(r'(?m)^DROP FUNCTION ', sql))
if (n_tg, n_fn) != (5, 6):
    raise SystemExit('步驟④ 列了 %d trigger / %d 函式,plan 項21b 要求 5 / 6' % (n_tg, n_fn))
io.open(os.environ['OUT'], 'w', encoding='utf-8').write(
    sql + '\nDROP TABLE public.order_item_quantity_summary;\n'
          'ALTER TABLE public.order_items DROP CONSTRAINT order_items_id_quantity_key;\n')
PY
  psql -X "$U" -v ON_ERROR_STOP=1 -q -f "$WORK/reh-drop.sql" > "$WORK/reh-pre.log" 2>&1
  [ $? -eq 0 ] || { printf 'PRECLEAN-FAIL:%s' "$(tail -1 "$WORK/reh-pre.log")"; drop_db "$db"; return; }
  # ② 照 runbook 的 Forward 那一行**逐支重放**(這一次不跳過任何一支)
  migs="$(RB="$rb" python3 - <<'PY'
import io, os, re
s = io.open(os.environ['RB'], encoding='utf-8').read()
m = [l for l in s.split('\n') if l.startswith('**Forward 重建**')]
if len(m) != 1:
    raise SystemExit('ERR:Forward 行不是恰一行(%d)' % len(m))
if '~~' in m[0]:      # 與 b2s2a-verify.sh 的刪除線閘對齊(R1 nit 2:兩支判定不得不一致)
    raise SystemExit('ERR:Forward 行含刪除線標記')
print(' '.join(re.findall(r'`(\d{14})`', m[0])))
PY
)" || { printf 'RUNBOOK-PARSE-FAIL'; drop_db "$db"; return; }
  [ -n "$migs" ] || { printf 'RUNBOOK-EMPTY-LIST'; drop_db "$db"; return; }
  for ts in $migs; do
    p="$(ls supabase/migrations/${ts}_*.sql 2>/dev/null | head -1)"
    [ -n "$p" ] || { printf 'NO-SUCH-MIG:%s' "$ts"; drop_db "$db"; return; }
    psql -X "$U" -v ON_ERROR_STOP=1 -q -f "$p" > "$WORK/reh-$ts.log" 2>&1 \
      || { printf 'REPLAY-FAIL:%s:%s' "$ts" "$(grep -m1 ERROR "$WORK/reh-$ts.log" | cut -c1-80)"; drop_db "$db"; return; }
  done
  # ③ 斷言 **S2b 的產物**(這兩樣才是本格量得到、而項13 量不到的)
  printf '%s/%s' \
    "$(q "$U" "SELECT (md5(pg_get_functiondef('${HELPER}'::regprocedure)) = '${MD5_HELPER_4AXIS}')::text")" \
    "$(q "$U" "SELECT count(*) FROM pg_trigger WHERE tgname='${TG_SS}' AND NOT tgisinternal")"
  drop_db "$db"
}
CELL=$((CELL+1))
REH_CTL="$(reh_products "$RUNBOOK")"
# 🔴 `(… = …)::text` 在 psql `-qtA` 下回的是 **`true` / `false`**,不是顯示層的 `t` / `f`
#    (本輪第一跑實測:期望寫成 t/1 時實得 true/1)。
if [ "$REH_CTL" = "true/1" ]; then
  ok REH-PRODUCTS "🔴 債④ rehearsal(**DROP 清單與 Forward 清單都從 runbook 抽**,同時守 21b 與 31):拆除→重放四支之後,**helper 是四軸(md5)且 ${TG_SS} 在** —— 這兩樣是 b2s2a-verify 項13 結構上量不到的。🔴 **只演練「出貨表 0 列」那條路**:副本源自出貨表 0 列的基準庫,而 runbook 說災難重建的**主情境**是出貨線已上線、S2a 必走替代路徑 A ⇒ 本格**不等於**整條步驟⑥ 被演練過"
else
  bad "債④ rehearsal:期望「true/1」(helper 四軸 + trigger 在),實得「$REH_CTL」"
fi

# ── 負測:把 S2b 從 runbook 的 Forward 那一行拿掉 ⇒ 本格必紅 ─────────────────
# 🔴 取代字串**不得含 14 位數字**(b2s2a 實錘:含數字會被解析成另一支 migration,
#    拿到 NO-SUCH-MIG 而不是「少一支」)。
TMUT=$((TMUT+1))
REH_MUT="$WORK/runbook-no-s2b.md"
IN="$RUNBOOK" OUT="$REH_MUT" python3 - <<'PY' || die "債④負測:突變產生失敗"
import io, os
s = io.open(os.environ['IN'], encoding='utf-8').read()
src = '、**B2-S2b(`20260806180000`)**四支 migration 檔'
if s.count(src) != 1:
    raise SystemExit('錨命中 %d 次(必須恰 1 次)' % s.count(src))
io.open(os.environ['OUT'], 'w', encoding='utf-8').write(s.replace(src, '三支 migration 檔'))
PY
cmp -s "$RUNBOOK" "$REH_MUT"; case "$?" in
  1) : ;;
  0) bad "債④負測:突變檔與原檔逐字相同 —— 沒改到東西" ;;
  *) bad "債④負測:cmp 讀不到檔 —— 判紅" ;;
esac
REH_NEG="$(reh_products "$REH_MUT")"
rm -f "$REH_MUT"
if [ "$REH_NEG" = "false/0" ]; then
  ok TMUT-REH "🔴 債④負測:把 S2b 從 runbook 的 Forward 行拿掉 ⇒ 重放後 **helper 停在三軸、trigger 不存在**(false/0)—— 正是「漏了它零告警」那個形狀,本格抓得到"
else
  bad "債④負測:期望「false/0」(helper 三軸 + trigger 不在),實得「$REH_NEG」—— 拿掉 S2b 竟然沒翻面,本格沒有判別力"
fi

log "6e/8 項22 PR4 造洞實證 + 項28 出貨資料面集合(S2b-3b 第三段)"

# ══ 項22:只動 shipped 真相、前三軸完全不動 ⇒ 舊三軸 oracle 通過、四軸版必 RAISE ═════
# 🔴 plan 逐字:DISABLE **五支** → 只動 shipped 真相 → ENABLE → 舊三軸 oracle **通過**、四軸版 **必 RAISE**。
#    「只動 shipped」是紀律:v2 原本引用的「DELETE receipt」會讓舊 oracle 先紅在 instock drift,
#    **測不到 shipped 軸**(R1 #12)。本格用「先建好正確四軸 → 停 trigger → 再出一箱 → 復原」造洞。
# 🔴 四軸版的 SQL **從 migration 檔內抽**(backfill oracle①),不是抄一份到這裡 ——
#    抄一份的話 migration 改壞了本格照樣綠。
CELL=$((CELL+1))
fresh_db b2s2b_pr4; PR4_URL="$FRESH_URL"
MIG_IN="$MIG" OUT="$WORK/oracle4.sql" python3 - <<'PY' || die "項22:抽不出 migration 的 backfill oracle①"
import io, os
s = io.open(os.environ['MIG_IN'], encoding='utf-8').read()
i = s.index('  SELECT count(*) INTO v_bad')
# 🔴 終錨要含 `END IF;` —— 切在 RAISE 之後會留下**沒收尾的 IF**,整段 42601
# (本輪第一跑實測:抽出來的 DO 區塊語法不完整,四軸 oracle 根本沒跑到)。
j = s.index('END IF;', s.index("USING ERRCODE = 'P2B11';", i)) + len('END IF;')
body = s[i:j]
io.open(os.environ['OUT'], 'w', encoding='utf-8').write(
    'DO $o4$\nDECLARE v_bad integer;\nBEGIN\n' + body + '\n  RAISE NOTICE \'ORACLE4:CLEAN\';\nEND\n$o4$;\n')
PY
# fixture:trigger 全開時建出**四軸完全正確**的一列(quantity 4 / ordered 3 / instock 3 / shipped 2)
psql -X "$PR4_URL" -v ON_ERROR_STOP=1 -q >/dev/null 2>&1 <<SQL || die "項22:fixture 建立失敗"
DO \$fx\$
$DECLS
BEGIN
$FIXTURE
$STOCK_I4
$MK_DRAFT
  INSERT INTO public.shipment_items (shipment_id, order_item_id, shipped_quantity) VALUES (v_ship, v_i4, 2);
$SHIP_NOW
END
\$fx\$;
SQL
PR4_BEFORE="$(psql -X "$PR4_URL" -qtAc "SELECT ordered_quantity::text||'/'||instock_quantity::text||'/'||cancelled_quantity::text||'/'||shipped_quantity::text FROM ${SUMMARY} s JOIN public.order_items oi ON oi.id=s.order_item_id WHERE oi.variant_sku='S2BV-P4'" 2>&1)"
# 造洞:停五支 → **只**再出一箱(shipped 真相 2→3;前三軸的來源表一個字都沒動)→ 復原五支
psql -X "$PR4_URL" -v ON_ERROR_STOP=1 -q >/dev/null 2>&1 <<SQL || die "項22:造洞失敗"
ALTER TABLE public.order_item_procurement          DISABLE TRIGGER order_item_procurement_received_quantity_guard_bt;
ALTER TABLE public.order_item_procurement          DISABLE TRIGGER order_item_procurement_summary_recompute_zc;
ALTER TABLE public.order_item_procurement_receipts DISABLE TRIGGER order_item_procurement_receipts_received_sync_ac;
ALTER TABLE public.order_cancellation_items        DISABLE TRIGGER order_cancellation_items_summary_recompute_ac;
ALTER TABLE public.shipments                       DISABLE TRIGGER ${TG_SS};
DO \$hole\$
DECLARE v_cust uuid; v_i4 uuid; v_ship uuid;
BEGIN
  SELECT customer_user_id INTO v_cust FROM public.orders WHERE display_id = 'PCM-9994-0001';
  SELECT id INTO v_i4 FROM public.order_items WHERE variant_sku = 'S2BV-P4';
  INSERT INTO public.shipments (shipment_reference, customer_user_id, recipient_snapshot, carrier_code)
  VALUES ('BCDFGW', v_cust, '{"name":"a","phone":"0900000000","line":"x"}'::jsonb, 'hct') RETURNING id INTO v_ship;
  INSERT INTO public.shipment_items (shipment_id, order_item_id, shipped_quantity) VALUES (v_ship, v_i4, 1);
  UPDATE public.shipments SET shipped_at = now(), tracking_number = 'PR4' WHERE id = v_ship;
END
\$hole\$;
ALTER TABLE public.order_item_procurement          ENABLE TRIGGER order_item_procurement_received_quantity_guard_bt;
ALTER TABLE public.order_item_procurement          ENABLE TRIGGER order_item_procurement_summary_recompute_zc;
ALTER TABLE public.order_item_procurement_receipts ENABLE TRIGGER order_item_procurement_receipts_received_sync_ac;
ALTER TABLE public.order_cancellation_items        ENABLE TRIGGER order_cancellation_items_summary_recompute_ac;
ALTER TABLE public.shipments                       ENABLE TRIGGER ${TG_SS};
SQL
PR4_AFTER="$(psql -X "$PR4_URL" -qtAc "SELECT ordered_quantity::text||'/'||instock_quantity::text||'/'||cancelled_quantity::text||'/'||shipped_quantity::text FROM ${SUMMARY} s JOIN public.order_items oi ON oi.id=s.order_item_id WHERE oi.variant_sku='S2BV-P4'" 2>&1)"
# 舊三軸 oracle(手寫,當**對照**):必須回 0 —— 證明它對這個洞真的瞎
PR4_OLD="$(psql -X "$PR4_URL" -qtAc "SELECT count(*) FROM ${SUMMARY} s
  WHERE s.ordered_quantity   IS DISTINCT FROM COALESCE((SELECT sum(p.allocated_quantity) FROM public.order_item_procurement p WHERE p.order_item_id=s.order_item_id),0)
     OR s.cancelled_quantity IS DISTINCT FROM COALESCE((SELECT sum(c.cancelled_quantity) FROM public.order_cancellation_items c WHERE c.order_item_id=s.order_item_id),0)
     OR s.instock_quantity   IS DISTINCT FROM COALESCE((SELECT sum(r.quantity) FROM public.order_item_procurement_receipts r
           WHERE r.procurement_id IN (SELECT p2.id FROM public.order_item_procurement p2 WHERE p2.order_item_id=s.order_item_id)),0)" 2>&1)"
# 四軸 oracle(**從 migration 抽的原文**):必須 RAISE P2B11
# 🔴 `-f <檔>` 時 psql 的錯誤行**帶檔名前綴**(`psql:/tmp/…:32: ERROR:  …`)
#    ⇒ 錨在行首的 `^ERROR:` 抓不到、那一維會靜默變空(本輪第一跑實測)。改成不錨行首。
PR4_NEW="$(psql -X "$PR4_URL" -v ON_ERROR_STOP=0 -v VERBOSITY=verbose -qtA -f "$WORK/oracle4.sql" 2>&1 | grep -m1 'ERROR:' | sed -n 's/.*ERROR:  \([0-9A-Z]*\).*/\1/p')"
drop_db b2s2b_pr4
PR4_OBS="${PR4_BEFORE}|${PR4_AFTER}|${PR4_OLD}|${PR4_NEW}"
if [ "$PR4_OBS" = "3/3/0/2|3/3/0/2|0|P2B11" ]; then
  ok B22-pr4-hole "🔴 項22 PR4 造洞:停五支 trigger 後**只**多出一箱(shipped 真相 2→3;前三軸來源表一個字沒動)⇒ 摘要前後皆 3/3/0/2、**舊三軸 oracle 回 0(真的瞎)**、**migration 檔內的四軸 oracle① RAISE P2B11**"
else
  bad "項22:期望「3/3/0/2|3/3/0/2|0|P2B11」,實得「$PR4_OBS」
     (四維 = 造洞前摘要 / 造洞後摘要 / 舊三軸 oracle 列數 / 四軸 oracle 的 SQLSTATE)"
fi

# ══ 項28:出貨資料面集合 before/after 相等 + gate 兩個 count(*) 逐字未變 ═══════════
# 🔴 plan 定義逐字:「任何持有 `shipped_quantity` 或等價已寄出數量、**且會被 §1 真相式讀到**的表」,
#    今日恰為 `shipments` 與 `shipment_items` 兩張。
# 🔴 **不能只看「有沒有新建 table」**(codex R2):以 `ALTER` 擴既有表、或改真相來源時,
#    新建集合仍為空而該格照樣綠。⇒ 改成**枚舉集合本身**,兩份逐字相等。
# 🔴 集合從**真相式區塊的文字**推導(`FROM` / `JOIN` 的表名),不是寫死一份 —— 真相來源改了它就會變。
# 🔴🔴 **表 <u>與欄</u> 都要枚舉**(R1 must-fix 4;plan 逐字:「§1 真相式讀到的**表** + 持有已寄出數量的**欄**」)。
#    只枚舉表時,審查實測示範過一發活的 fail-open:把 `sum(si.shipped_quantity)` 改成
#    `sum(si.shipped_quantity)+COALESCE(si.shipped_qty_b,0)`(= 以 ALTER 擴既有表)⇒ **表集合逐字不變、本格照樣綠**
#    —— 那正是 plan 點名這一格存在的理由。
# 🔴 推導**同時吃三份真相式副本**(migration / runbook / a4a-verify),不是只吃被 `MIG_SHA_FROZEN`
#    釘死的那一份(R1 important 7:只吃 migration 時,本 harness 內它必然是常數 = 零判別力)。
# 🔴 凍結值 = **實測值**(2026-08-07 全 token 掃描)。含述詞欄與外層別名是刻意的:
#    判別面取嚴格超集,真相式動任何一欄/任何一個關聯參照都會翻面。
DATASURF_FROZEN="COL:<未知別名:s>.order_item_id|COL:<未知別名:u>.order_item_id|COL:public.shipment_items.order_item_id|COL:public.shipment_items.shipment_id|COL:public.shipment_items.shipped_quantity|COL:public.shipments.deleted_at|COL:public.shipments.id|COL:public.shipments.shipped_at|TAB:public.shipment_items|TAB:public.shipments"
datasurface_check() {   # $1 = migration、$2 = runbook、$3 = a4a-verify → 印集合;crash 時印空
  M1="$1" M2="$2" M3="$3" python3 - <<'PY'
import io, os, re
out = set()
for key in ('M1', 'M2', 'M3'):
    lines = io.open(os.environ[key], encoding='utf-8').read().split('\n')
    # 🔴 **逐行精確比對**,不可用子字串 find:runbook 的散文裡有一句提到
    #    `-- SHIPPED-TRUTH-BEGIN/END`,子字串會命中它的前綴 ⇒ 區塊一路吃到下面的真 END,
    #    把 divergence 的前三軸來源表全部拖進集合(本輪第一跑實測)。
    #    `b2s2b-truth-sync.py` 從一開始就是逐行 `strip() ==`,這裡對齊它。
    blocks, st = [], None
    for n, l in enumerate(lines):
        t = l.strip()
        if t == '-- SHIPPED-TRUTH-BEGIN':
            st = n
        elif t == '-- SHIPPED-TRUTH-END' and st is not None:
            blocks.append('\n'.join(lines[st + 1:n])); st = None
    for blk in blocks:
        # ①表:FROM / JOIN 後的限定名(不帶 public. 前綴的來源會讓集合縮 ⇒ fail-closed)
        alias = {}
        for tab, al in re.findall(r'(?:FROM|JOIN)\s+(public\.\w+)\s+(\w+)', blk):
            out.add('TAB:' + tab)
            alias[al] = tab
        # ②欄:掃區塊內**每一個** `<alias>.<col>` token(R2 F3:只認 `sum(...)` / `COALESCE(...)`
        #    兩形時,`+ max(si.x)`、`+ sh.adjust_qty`、無別名子查詢三種加欄寫法都繞得過)。
        #    掃全部 token ⇒ 判別面是嚴格超集;代價是集合會含述詞欄(deleted_at / shipped_at / id …),
        #    那沒關係 —— 凍結值照實寫,真相式動任何一欄都會翻面。
        for al, col in re.findall(r'\b(\w+)\.(\w+)\b', blk):
            if al in alias:
                out.add('COL:' + alias[al] + '.' + col)
            elif al != 'public':
                out.add('COL:<未知別名:' + al + '>.' + col)
print('|'.join(sorted(out)))
PY
}
# 🔴 gate 那兩句:**連賦值形狀一起釘住**(R1 important 5 實測:只比表名時,把整行註解掉
#    `grep -c` 仍回 1 ⇒ gate 的那道已經死了而本格照樣綠;`grep -c` 數的是行數不是出現次數)。
# 🔴🔴 **改成整行字面比對**(R2 must-fix 2:上一版用 ERE 且**尾端沒錨**,實測把 query 改成
#    `SELECT count(*) FROM public.shipments WHERE false`(⇒ gate 恆讀 0、有真資料也放行)
#    照樣命中、本格照樣綠 —— 而 plan 逐字要求「兩個 count(*) 查詢**逐字未變**」)。
#    `grep -cxF` = 整行、固定字串、不解析正規式 ⇒ 「逐字」這兩個字才名副其實。
# 🔴 代價要講明:任何合法重排(多一格空白、換旗標順序)都會誤紅 = fail-closed,
#    處置是回頭同批更新這兩個常數,不是把閘放寬。
cat > "$WORK/gate-ship.txt" <<'GATELINE1'
  gn_ship="$(psql -X "$@" -qtAc 'SELECT count(*) FROM public.shipments' 2>&1)";      rc_ship=$?
GATELINE1
cat > "$WORK/gate-item.txt" <<'GATELINE2'
  gn_item="$(psql -X "$@" -qtAc 'SELECT count(*) FROM public.shipment_items' 2>&1)"; rc_item=$?
GATELINE2
gate_shape_check() {   # $1 = b2s2a-verify 路徑 -> 印 "<ship>/<item>"
  printf '%s/%s' "$(grep -cxFf "$WORK/gate-ship.txt" "$1")" "$(grep -cxFf "$WORK/gate-item.txt" "$1")"
}
CELL=$((CELL+1))
DATASURF_NOW="$(datasurface_check "$MIG" "$RUNBOOK" scripts/a4a-verify.sh 2>"$WORK/ds.err")"
GATE_NOW="$(gate_shape_check scripts/b2s2a-verify.sh)"
if [ "$DATASURF_NOW" = "$DATASURF_FROZEN" ] && [ "$GATE_NOW" = "1/1" ]; then
  ok B28-datasurface "🔴 項28 債③:出貨資料面集合(**表 + 欄**,從 migration / runbook / a4a-verify **三份**真相式副本推導)= [$DATASURF_NOW] 與凍結值逐字相等 ⇒ 本線沒有新增出貨真值面;gate 那兩句**整行字面**(以 grep -cxF 比對)逐字未變"
else
  bad "項28:資料面集合 = [$DATASURF_NOW]
     期望 [$DATASURF_FROZEN]
     gate 形狀 = $GATE_NOW(期望 1/1)$(head -2 "$WORK/ds.err" 2>/dev/null | tr '\n' ' ')"
fi

# ── 兩發突變:B28 的靶是純文字、零 DB 成本(R1 important 6:「沒有靶」不成立為「構造不出」)──
run_dsmut() {   # $1 = 靶名、$2 = 目標檔、$3 = 原字面、$4 = 新字面、$5 = 期望結果(SET-CHANGED / GATE-DEAD)、$6 = key
  local name="$1" f="$2" src="$3" dst="$4" want="$5" key="$6" tmp="$WORK/ds-$6" got
  TMUT=$((TMUT+1))
  cp "$f" "$tmp" || { bad "$name:複製失敗"; return; }
  SRC="$src" DST="$dst" F="$tmp" python3 - <<'PY' || { bad "$name:突變產生失敗(錨命中次數不是 1?)"; rm -f "$tmp"; return; }
import io, os
p = os.environ['F']; s = io.open(p, encoding='utf-8').read()
src, dst = os.environ['SRC'], os.environ['DST']
n = s.count(src)
if n != 1:
    raise SystemExit('錨命中 %d 次(必須恰 1 次)' % n)
io.open(p, 'w', encoding='utf-8').write(s.replace(src, dst))
PY
  cmp -s "$f" "$tmp"; case "$?" in
    1) : ;;
    0) bad "$name:突變檔與原檔逐字相同 —— 沒改到東西"; rm -f "$tmp"; return ;;
    *) bad "$name:cmp 讀不到檔 —— 判紅"; rm -f "$tmp"; return ;;
  esac
  case "$want" in
    SET-CHANGED) got="$(datasurface_check "$tmp" "$RUNBOOK" scripts/a4a-verify.sh 2>/dev/null)"
                 if [ -n "$got" ] && [ "$got" != "$DATASURF_FROZEN" ]; then
                   ok "$key" "$name ⇒ 資料面集合真的變了(不再等於凍結值)⇒ 本格抓得到"
                 else bad "$name:集合竟然沒變(實得 [$got])—— 這一發殺不到,本格對它全盲"; fi ;;
    GATE-DEAD)   got="$(gate_shape_check "$tmp")"
                 if [ "$got" != "1/1" ]; then
                   ok "$key" "$name ⇒ gate 形狀斷言翻面($got ≠ 1/1)⇒ 「整行被註解掉照樣綠」那個洞已補"
                 else bad "$name:gate 形狀竟然仍是 1/1 —— 只比表名的老毛病還在"; fi ;;
  esac
  rm -f "$tmp"
}
# 靶D1:**以 ALTER 擴既有表**(plan 點名的那個 fail-open)—— 真相式多加總一個欄
run_dsmut "靶D1-真相式多加總一個欄(ALTER 擴既有表)" "$MIG" \
'COALESCE((SELECT sum(si.shipped_quantity)
FROM public.shipment_items si
JOIN public.shipments sh ON sh.id = si.shipment_id
WHERE si.order_item_id = s.order_item_id' \
'COALESCE((SELECT sum(si.shipped_quantity) + COALESCE(si.shipped_qty_b, 0)
FROM public.shipment_items si
JOIN public.shipments sh ON sh.id = si.shipment_id
WHERE si.order_item_id = s.order_item_id' \
  SET-CHANGED TMUT-D1
# 靶D2:把 gate 的 shipments 那一句**整行註解掉**(R1 實測:舊寫法 grep -c 仍回 1)
run_dsmut "靶D2-把 gate 的 shipments 那句註解掉" scripts/b2s2a-verify.sh \
'  gn_ship="$(psql -X "$@" -qtAc' \
'  # gn_ship="$(psql -X "$@" -qtAc' \
  GATE-DEAD TMUT-D2

# ── 負測②:把出貨側那兩行從 runbook 步驟④ 拿掉 ⇒ **項21b 的拆除清單**必須紅 ─────────
# 🔴 這一發專打 R1 must-fix 5 的修法:上一版 DROP 清單是**手抄**的,刪掉 runbook 那兩行照樣綠
#    ⇒ 項21b 等於只有散文。改成從 runbook 抽之後,這一發才殺得到。
TMUT=$((TMUT+1))
REH_MUT2="$WORK/runbook-no-shipdrop.md"
IN="$RUNBOOK" OUT="$REH_MUT2" python3 - <<'PYX' || die "項21b 負測:突變產生失敗"
import io, os
s = io.open(os.environ['IN'], encoding='utf-8').read()
src = ('DROP TRIGGER shipments_summary_recompute_ac ON public.shipments;\n'
       'DROP FUNCTION public.pcm_a4a_shipments_summary_recompute();\n')
if s.count(src) != 1:
    raise SystemExit('錨命中 %d 次(必須恰 1 次)' % s.count(src))
io.open(os.environ['OUT'], 'w', encoding='utf-8').write(s.replace(src, ''))
PYX
cmp -s "$RUNBOOK" "$REH_MUT2"; case "$?" in
  1) : ;;
  0) bad "項21b 負測:突變檔與原檔逐字相同 —— 沒改到東西" ;;
  *) bad "項21b 負測:cmp 讀不到檔 —— 判紅" ;;
esac
REH_NEG2="$(reh_products "$REH_MUT2")"
rm -f "$REH_MUT2"
case "$REH_NEG2" in
  RUNBOOK-DROP-PARSE-FAIL*)
    ok TMUT-REH2 "🔴 項21b 負測:把出貨側那兩行從 runbook 步驟④ 拿掉 ⇒ 守門紅在**拆除清單只有 4 trigger / 5 函式**(項21b 要求 5/6)—— 證明 21b 的清單真的被守著,不是散文" ;;
  *)
    bad "項21b 負測:期望紅在 RUNBOOK-DROP-PARSE-FAIL,實得「$REH_NEG2」—— 拿掉那兩行竟然沒翻面,21b 的清單沒有守門" ;;
esac

# 🔴 TMUT 計數斷言必須排在**所有**文字層突變之後(S1/S2 在 6c 段)——
#    上一版把它放在 6b 段尾,S1/S2 還沒跑就先數,當場紅在「只跑了 9 發」(本輪實測)。
[ "$TMUT" -eq "$EXPECT_TMUT" ] && ok TMUT-COUNT "文字層突變靶跑了 $TMUT 發,與凍結值相符" \
  || bad "文字層突變靶只跑了 $TMUT 發,期望 $EXPECT_TMUT —— 有靶被刪掉或沒被呼叫"

log "7/8 S2b-1 消融重證(主視窗 B-147-A ③:推論轉觀察)"
# 🔴 為什麼要這一格:S2b-1 交付時的行為實證第⑤條(停用本 trigger 後 shipped 不再跟動)
#    是在**修關卡2 findings 之前**的那座拋棄庫上證的;修完的新庫上只重跑了 ①-④,
#    ⑤ 因「同一交易內有 pending trigger events 不能 ALTER TABLE」構造不出來。
#    S2b-1 當時的說法是「修的是閘不是函式本體,所以結論不變」——**那是推論,不是觀察**。
# 🔴 構造法(plan §4.99 逐字):獨立交易**開頭**先 DISABLE TRIGGER(此時無 pending events),
#    再跑完整出貨串,斷言 shipped 凍在 0。走 fresh copy,DDL 不碰基準庫。
CELL=$((CELL+1))
fresh_db b2s2b_abl; ABL_URL="$FRESH_URL"
ABL_GOT="$(psql -X "$ABL_URL" -v ON_ERROR_STOP=0 -qtA 2>&1 <<SQL | sed -n 's/^NOTICE:  GOT:\(.*\)$/\1/p' | head -1
BEGIN;
ALTER TABLE public.shipments DISABLE TRIGGER ${TG_SS};
DO \$abl\$
$DECLS
BEGIN
$FIXTURE
$STOCK_I4
$MK_DRAFT
  INSERT INTO public.shipment_items (shipment_id, order_item_id, shipped_quantity) VALUES (v_ship, v_i4, 2);
$SHIP_NOW
  SET CONSTRAINTS ALL IMMEDIATE;
  SELECT ($SHIPPED_OF_I4) INTO v_got;
  RAISE NOTICE 'GOT:%', COALESCE(v_got, '<NULL>');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'GOT:ERR:%:%', SQLSTATE, SQLERRM;
END
\$abl\$;
ROLLBACK;
SQL
)"
# 期望 `0/3`:shipped **凍在 0**(trigger 沒跑),instock 仍 3(receipts 軸照常 ⇒ 這一列是真的、
# 不是「整條路徑都沒跑」)。對照組同一條路徑是 `2/3`(項10),兩者只差在 trigger 有沒有停用。
if [ "$ABL_GOT" = "0/3" ]; then
  ok ABLATION "🔴 消融重證(**最終版的庫**):停用 ${TG_SS} 後跑完整出貨串 ⇒ shipped 凍在 0、instock 仍 3;對照組同路徑是 2/3 ⇒ 那 2 確實是這支 trigger 寫的"
elif [ -z "$ABL_GOT" ]; then
  bad "消融重證:拿不到觀察值(測試自身異常;fail-closed 判紅)"
else
  bad "消融重證:期望「0/3」(shipped 凍在 0),實得「$ABL_GOT」
     🔴 若得到 2/3,代表**停用這支 trigger 之後摘要仍然跟動** = 有第二條未知的寫入路徑,
     那會推翻 S2b-1「只掛一支」的整個論證(Fable 當時給的翻案條件,逐字)。"
fi
drop_db b2s2b_abl

# ══ 收尾:副本清除 + 格數與具名 key 集合自斷言(W1)═══════════════════════════
# ══ 6h/8:項30 註解蓋寫守門(S2b-5;plan §4.30)═════════════════════════════════
# 🔴 **為什麼不放在 migration 結尾**(codex 關卡1 打掉 v1):檔內斷言只保護它自己那一支——
#    下一支 migration 在它 COMMIT **之後**蓋寫 COMMENT,不會觸發任何東西。⇒ 守門必須是**外部 oracle**,
#    在整條 migration 前綴套完之後對**真實 catalog** 取指紋。
# 🟡 **它擋的是「蓋寫後沒有人回來更新凍結值」,不是「禁止蓋寫」** —— 有意的蓋寫照樣可以發生,
#    只是必須有人回來改常數。**fail-visible,不是 fail-closed**;寫清楚免得下一棒以為註解被鎖死了。
#   ⓖ ✅ **項30 註解蓋寫守門已做**(S2b-5,即本段):七格 —— 三邊同源 / 常設格(兩組凍結值 + 分流)/
#     before 分支實跑 / 維度格 / 負測ⓐⓑⓒ。**plan 要求的「ledger 尾」沒有另開一格**,理由見下方。
log "6h/8 項30 註解蓋寫守門(S2b-5;expected-before / after 兩組凍結值)"

# 🔴 **兩組期望值,不是一組**(plan §4.30 must-fix):小線那句受保護的註解**逐字寫著**
#    「大線 B2-S2b,**尚未施工**」與 A4a「**完全不碰本欄**」—— 本線落地後這兩句就是假的。
#    若守門仍要求等於小線指紋,等於**把已知假字面凍結起來**:功能接線正確而 catalog 仍宣稱沒有 writer。
CFP_BEFORE="f5798812892bb484b52083ad068a48a6"   # 小線 B2-S2a 的值(與 b2s2a-verify.sh 的 COMMENT_FP 同值)
CFP_AFTER="f2794c052c359f08c366429090e8fa53"    # 本線改寫欄註解 + 表註解之後的值

# 🔴 **分流判準不得依受守的 COMMENT 本身、也不得依 live 指紋**(兩者都是被守護物 ⇒ 自我引用,
#    實作者會退化成 live 自算 = 恆綠)。判準 = **catalog 內是否存在本線的產物**:
#    `shipments_summary_recompute_ac` 在 ⇒ after,不在 ⇒ before。它與 COMMENT 文字**完全無關**。
cfp_expected() {   # $1 = 庫 URL
  local n
  n="$(psql -X "$1" -qtAc "SELECT count(*) FROM pg_trigger WHERE tgname='${TG_SS}' AND NOT tgisinternal" 2>/dev/null)"
  case "$n" in
    1) printf '%s' "$CFP_AFTER" ;;
    0) printf '%s' "$CFP_BEFORE" ;;
    *) printf 'DISPATCH-ERR' ;;
  esac
}
# 🔴 七個物件**逐物件列名**(plan 禁寫「七物件」這種會過期的集合描述);
#    第七個是 `COL:shipment_items.shipped_quantity` —— **不在摘要表上**,v1 的「摘要表七物件」是錯的。
# 🔴 **七列的 SQL 只寫一份**(`cfp_rows_sql`),指紋與維度格都從它衍生 ——
#    第一版把 md5 包裝寫死在 `cfp_sql` 裡,維度格只好用 sed 把包裝剝掉,**剝失敗時回空字串**
#    (第一次實跑實錘:`有 [] 個物件取不到 COMMENT`)。共用一份就沒有那道剝除。
cfp_rows_sql() {
  printf '%s' \
"SELECT 1 AS i, COALESCE(col_description('${SUMMARY}'::regclass,(SELECT attnum FROM pg_attribute WHERE attrelid='${SUMMARY}'::regclass AND attname='shipped_quantity')),'-') AS c
 UNION ALL SELECT 2, COALESCE(obj_description('${SUMMARY}'::regclass,'pg_class'),'-')
 UNION ALL SELECT 3, COALESCE(col_description('${SUMMARY}'::regclass,(SELECT attnum FROM pg_attribute WHERE attrelid='${SUMMARY}'::regclass AND attname='quantity')),'-')
 UNION ALL SELECT 4, COALESCE((SELECT obj_description(oid,'pg_constraint') FROM pg_constraint WHERE conrelid='${SUMMARY}'::regclass AND conname='order_item_quantity_summary_item_fk'),'-')
 UNION ALL SELECT 5, COALESCE((SELECT obj_description(oid,'pg_constraint') FROM pg_constraint WHERE conrelid='${SUMMARY}'::regclass AND conname='oiqs_instock_cancelled_le_quantity'),'-')
 UNION ALL SELECT 6, COALESCE((SELECT obj_description(oid,'pg_constraint') FROM pg_constraint WHERE conrelid='${SUMMARY}'::regclass AND conname='oiqs_cancelled_shipped_le_quantity'),'-')
 UNION ALL SELECT 7, COALESCE(col_description('public.shipment_items'::regclass,(SELECT attnum FROM pg_attribute WHERE attrelid='public.shipment_items'::regclass AND attname='shipped_quantity')),'-')"
}
cfp_sql() { printf "SELECT md5(string_agg(t.c, E'\\n' ORDER BY t.i)) FROM (%s) t" "$(cfp_rows_sql)"; }
cfp_of() { psql -X "$1" -qtAc "$(cfp_sql)" 2>/dev/null; }

# ── 同源斷言:清單與 `b2s2a-verify.sh` 的 `fp_sql()` 不一致即紅 ────────────────
# 🔴 plan 逐字:「清單與 `b2s2a-verify.sh` 的 `fp_sql()` **同源**,兩處不一致即紅」。
#    做法 = 從那支抽出它 `fp_sql()` 用到的 key 序列,與本檔凍結的序列逐字比;
#    順序也比 —— 指紋是 `ORDER BY i` 的字串接合,**換順序就換值**。
CFP_KEYS_FROZEN="COL:summary.shipped_quantity TABLE:summary COL:summary.quantity FK:summary.item_fk C:oiqs_instock_cancelled_le_quantity C:oiqs_cancelled_shipped_le_quantity COL:shipment_items.shipped_quantity"
CFP_KEYS_SIS="$(sed -n '/^fp_sql() {/,/^}/p' scripts/b2s2a-verify.sh | grep -oE 'comment_sql [A-Za-z0-9:._]+' | sed 's/^comment_sql //' | tr '\n' ' ' | sed 's/ *$//')"
CFP_SIS_FP="$(grep -oE '^COMMENT_FP="[0-9a-f]{32}"' scripts/b2s2a-verify.sh | grep -oE '[0-9a-f]{32}' | head -1)"
# 🔴🔴 **第三邊:本檔自己的 `cfp_sql` 也要進來比**(R1 must-fix 3)。第一版只比
#    「姊妹檔抽出的序列 vs 一個手寫凍結字串」—— 在 `cfp_sql` 裡加第八個物件、再照守門提示重凍
#    `CFP_AFTER`,六格會全綠而兩支真的分歧了。**那正是本格宣稱要抓的東西。**
#    ⇒ 從本檔 `cfp_sql` 的函式體抽出它實際查的物件識別碼,三邊(姊妹檔 / 凍結字串 / 本檔實作)一起比。
CFP_KEYS_SELF="$(sed -n '/^cfp_rows_sql() {/,/^}/p' "$SELF_PATH" \
  | grep -oE "attname='[^']+'|conname='[^']+'|attrelid='[^']+'|conrelid='[^']+'|'pg_class'" | tr '\n' ' ' | sed 's/ *$//')"
# 🔴 R2 F3:pattern **必須捕 relation 限定詞**(`attrelid=` / `conrelid=`)—— 只捕 `conname` 時,
#    把 row 4-6 的 `conrelid='…'::regclass AND` 整段拿掉,抽取序列不變、今天的指紋也不變
#    (conname 現況全域唯一)⇒ 七格全綠而兩支的量測述詞已經分歧,日後他表出現同名 constraint 就靜默量錯。
# 🔴 `${SUMMARY}` 要跳脫成 `\${SUMMARY}` —— 這個凍結值是**原始碼字面**,不是展開後的值;
#    用雙引號包而不跳脫時 shell 會當場展開,與 sed 抽出來的字面永遠對不上(實跑當場紅)。
CFP_KEYS_SELF_FROZEN="attrelid='\${SUMMARY}' attname='shipped_quantity' 'pg_class' attrelid='\${SUMMARY}' attname='quantity' conrelid='\${SUMMARY}' conname='order_item_quantity_summary_item_fk' conrelid='\${SUMMARY}' conname='oiqs_instock_cancelled_le_quantity' conrelid='\${SUMMARY}' conname='oiqs_cancelled_shipped_le_quantity' attrelid='public.shipment_items' attname='shipped_quantity'"
if [ "$CFP_KEYS_SIS" = "$CFP_KEYS_FROZEN" ] && [ "$CFP_SIS_FP" = "$CFP_BEFORE" ] \
   && [ "$CFP_KEYS_SELF" = "$CFP_KEYS_SELF_FROZEN" ]; then
  # 🔴 R1 nit 10:plan §4.30「守什麼」那列**明文禁止**用「七物件」這種會過期的集合描述
  #    ⇒ PASS 訊息也要逐物件列名,不能只有 bad 分支才看得到。
  ok CFP-SAMESOURCE "項30 同源(**三邊**:姊妹檔 fp_sql / 本檔凍結清單 / 本檔 cfp_sql 實作)逐字同序 —— COL:summary.shipped_quantity、TABLE:summary、COL:summary.quantity、FK:summary.item_fk、C:oiqs_instock_cancelled_le_quantity、C:oiqs_cancelled_shipped_le_quantity、COL:shipment_items.shipped_quantity;且姊妹檔 COMMENT_FP = 本檔 expected-before"
else
  bad "項30 同源不符:
     姊妹檔清單 [$CFP_KEYS_SIS]
     本檔凍結   [$CFP_KEYS_FROZEN]
     本檔 cfp_sql 實查 [$CFP_KEYS_SELF]
     本檔 cfp_sql 凍結 [$CFP_KEYS_SELF_FROZEN]
     姊妹檔 COMMENT_FP [$CFP_SIS_FP] / 本檔 expected-before [$CFP_BEFORE]
     🔴 兩處各自演化 = 兩份指紋守著不同的東西,而且誰也不會發現"
fi

# ── ledger 尾:**不另開一格**(R1 must-fix 1)────────────────────────────────
# 🔴 plan §4.30 末段要求「守門必須在要驗的前綴全部套完之後才跑」。我原本為它另開一格
#    (比 `ls supabase/migrations/*.sql | sort | tail -1` 與 `$MIG`)—— **那一格近乎恆真**:
#    本檔的 **`NEWEST_TS`** 閘(grep 這個字找得到 —— **不寫行號**,R2 抓到我寫的 318 從來就是錯的)
#    早就在同一份 `ls` 上 `die` 了,「有更新的 migration」那條路根本走不到這裡;
#    唯一可紅的情境是「同時間戳撞檔名」,而我的 bad 訊息描述的正是那條不可達的路。
#    ⇒ **拿掉那一格**,在這裡留指標。(本 repo 的紀律:負測構造不出來 ⇒ 先懷疑守門是 no-op。)
#    DB 那一面由 `BASE-POST`(helper 四軸指紋)證,不是由檔名序證 —— 兩者不可互相冒領。

# ── 常設格本體 ───────────────────────────────────────────────────────────────
CFP_WANT="$(cfp_expected "$BASE_URL")"
CFP_GOT="$(cfp_of "$BASE_URL")"
if [ "$CFP_WANT" = "DISPATCH-ERR" ] || [ -z "$CFP_GOT" ]; then
  bad "項30:分流或取指紋失敗(want=[$CFP_WANT] got=[$CFP_GOT])—— fail-closed 判紅"
elif [ "$CFP_GOT" = "$CFP_WANT" ]; then
  ok CFP-DISPATCH "項30 註解指紋相符:本線產物在 ⇒ 走 **expected-after**([$CFP_WANT]);七個物件的 COMMENT 逐字未被蓋寫"
else
  bad "項30 註解指紋不符:期望 [$CFP_WANT] 實得 [$CFP_GOT]
     🔴 有人蓋寫了七個被守物件之一的 COMMENT 而沒有回來更新凍結值(這道是 fail-visible,不是禁止蓋寫)"
fi

# ── before 分支:對 **pre 基準庫**跑一次(R1 must-fix 5)────────────────────────
# 🔴 第一版的 `0)` 分支**全程零執行** —— BASE 與兩個突變庫的 trigger 都在,
#    把 `0)` 改成任意值都零紅 ⇒「兩組期望值分流」只有一半被跑過。`b2s2b_pre` 就在旁邊。
CFP_PRE_WANT="$(cfp_expected "$PRE_URL")"
CFP_PRE_GOT="$(cfp_of "$PRE_URL")"
if [ "$CFP_PRE_WANT" = "$CFP_BEFORE" ] && [ "$CFP_PRE_GOT" = "$CFP_BEFORE" ]; then
  ok CFP-BEFORE-BRANCH "項30 before 分支實跑:pre 基準庫沒有本線的 trigger ⇒ 分流走 expected-before,且它的實際指紋逐字 = [$CFP_BEFORE]"
else
  bad "項30 before 分支:pre 基準庫的分流或指紋不對(want=[$CFP_PRE_WANT] got=[$CFP_PRE_GOT] / 凍結 before=[$CFP_BEFORE])
     🔴 兩組期望值的分流有一半沒被跑過 = 那一半可以被改成任意值而零紅"
fi

# ── 維度格:七個物件都必須真的有 COMMENT(R1 must-fix 4)───────────────────────
# 🔴 指紋是七段字串的接合;某一段若退化成 `'-'`(attname 打錯 / 欄改名 / conname 改名),
#    指紋只會漂**一次**,重凍 `CFP_AFTER` 之後那一維就**永久失明**,而且沒有任何格會紅。
#    ⇒ 直接斷言「零個 `-`」。姊妹檔用 `R12b-fpdim` 擋這一族,本檔原本沒有對應。
CFP_DASH="$(psql -X "$BASE_URL" -qtAc "SELECT count(*) FROM ($(cfp_rows_sql)) t WHERE t.c = '-'" 2>/dev/null)"
if [ "$CFP_DASH" = "0" ]; then
  ok CFP-DIMENSIONS "項30 維度:七個被守物件**全部真的有 COMMENT**(零個退化成 '-')⇒ 七段都對指紋有貢獻,不是有幾段恆為 '-' 的裝飾"
else
  bad "項30 維度:有 [$CFP_DASH] 個物件取不到 COMMENT(值為 '-')
     🔴 那幾維對指紋**永久失明** —— 多半是 attname / conname 打錯或物件被改名,而不是註解真的被刪"
fi

# ── 負測ⓒ:把 expected-after 誤填成 expected-before ────────────────────────────
# 🔴 這一發**專打**「凍結已知假字面」那條:沒有它,兩組期望值的分流可能整條沒接上而沒人知道。
# 🔴 R2 F4:`CFP_GOT` 若取指紋失敗而為空,「空 != before」會成立 ⇒ 常設格紅了本格卻仍綠。加前提。
if [ -n "$CFP_GOT" ] && [ "$CFP_BEFORE" != "$CFP_AFTER" ] && [ "$CFP_GOT" != "$CFP_BEFORE" ]; then
  ok CFP-MUT-C "項30 負測ⓒ:兩組期望值**不相等**,且本線已套的庫拿 expected-before 去比**會紅** ⇒ 分流真的接上了(誤填會被抓到)"
else
  bad "項30 負測ⓒ:expected-before 與 after 相等,或本線已套卻仍等於 before
     🔴 那代表分流沒接上 / 兩組值其實是同一組 ⇒ 這道守門在凍結一句已知為假的敘述"
fi

# ── 負測ⓐ:在**本線 migration 內**插一句蓋寫 COMMENT ⇒ 必紅 ────────────────────
# 🔴 **蓋寫必須插在第 6 節「之後」**(第一次實跑實錘):插在 `-- ══ 6. 註解` 之前時,
#    第 6 節會把表註解**再設回正確值** ⇒ 指紋不變、這一發沒有翻面。
#    ⇒ 錨改用檔尾那一行,確保它是**最後一句**跑到的 COMMENT。
make_mutant_or_die "$WORK/cfp-a.sql" \
'--   · A8a2 多品項取消的取鎖順序未驗(plan §9 交棒 6)' \
"--   · A8a2 多品項取消的取鎖順序未驗(plan §9 交棒 6)
COMMENT ON TABLE public.order_item_quantity_summary IS '被蓋寫了';"
run_cfp_mut() {   # $1 = 靶名、$2 = 要套的檔(可空 = 只套 mut0)、$3 = key、$4 = 套完再跑的 SQL(可空)
  local name="$1" file="$2" key="$3" extra="$4" db="b2s2b_cfp" U got want
  psql -X "$ADMIN_URL" -q -c "DROP DATABASE IF EXISTS $db" >/dev/null 2>&1
  # 🔴 R1 nit 13:與 `run_mutant` / `run_smut` 同形 —— 複製失敗先 `sleep 1` 重試一次,
  #    否則同一顆 TEMPLATE 來源在兩處有不同行為,會產生偶發假紅。
  psql -X "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE $db TEMPLATE b2s2b_pre" >/dev/null 2>&1 \
    || { sleep 1; psql -X "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE $db TEMPLATE b2s2b_pre" >/dev/null 2>&1 \
         || { bad "$name:複製 pre 副本失敗"; return; }; }
  U="postgresql://postgres@127.0.0.1:${PORT}/$db"
  if ! psql -X "$U" -v ON_ERROR_STOP=1 -q -f "$file" > "$WORK/cfp-$key.log" 2>&1; then
    bad "$name:套不上去($(grep -m1 ERROR "$WORK/cfp-$key.log" | cut -c1-90))—— 套不上去 ≠ 抓到"
    drop_db "$db"; return
  fi
  if [ -n "$extra" ]; then
    psql -X "$U" -v ON_ERROR_STOP=1 -q -c "$extra" >/dev/null 2>&1 \
      || { bad "$name:後續的蓋寫語句沒套上"; drop_db "$db"; return; }
  fi
  want="$(cfp_expected "$U")"; got="$(cfp_of "$U")"
  drop_db "$db"
  # 🔴🔴 **fail-open**(R1 must-fix 2):`cfp_expected` 在 psql 掛掉時回 `DISPATCH-ERR`,
  #    那是個**合法的非 md5 字串**、必然 `!= got` ⇒ 第一版會判 ok。常設格有擋這條,這裡漏了。
  if [ "$want" = "DISPATCH-ERR" ] || [ -z "$got" ] || [ -z "$want" ]; then
    bad "$name:分流或取指紋失敗(want=[$want] got=[$got])—— fail-closed 判紅,**不當成「翻面了」**"
  elif [ "$got" != "$want" ]; then
    ok "$key" "$name ⇒ 指紋真的翻面(期望 [$want] 實得 [$got])"
  else
    bad "$name 沒有翻面:want=[$want] got=[$got] —— 那代表這道守門對蓋寫是瞎的"
  fi
}
run_cfp_mut "項30 負測ⓐ-在本線 migration 內蓋寫表註解" "$WORK/cfp-a.sql" CFP-MUT-A ""
# ── 負測ⓑ:**守門跑完之後**再套一支只含一句蓋寫的 throwaway migration ⇒ 重跑必紅 ──
# 🔴 這才是「日後蓋寫」的真實形狀(codex R2:v2 沿用了 migration 內設計的措辭,對外部 oracle 無語意)。
# 🔴 **ⓐ 與 ⓑ 對外部 oracle 其實不可區分**(R1 nit 8,誠實列):守門沒有時序面 ——
#    「migration 內蓋寫」與「下一支 migration 蓋寫」對它都只是「量測時 DB 裡有一句被蓋寫的 COMMENT」。
#    兩發真正的差別是**打不同的物件**(ⓐ 打 TABLE:summary、ⓑ 打 COL:summary.shipped_quantity)。
#    ⇒ 靶名保留 plan 的措辭(它描述的是**現實中的兩種發生方式**),但不得宣稱本守門分得出時序。
run_cfp_mut "項30 負測ⓑ-守門跑完後由下一支 migration 蓋寫(對本守門 = 打第 1 個物件)" "$WORK/mut0.sql" CFP-MUT-B \
  "COMMENT ON COLUMN public.order_item_quantity_summary.shipped_quantity IS '下一支 migration 蓋寫的';"

log "收尾"
# 🔴 `b2s2b_pre` **不是副本、是常駐的 pre-S2b 基準庫**(突變環境的 TEMPLATE 來源),
#    每輪重用 ⇒ 必須排除,否則這一格永遠紅(本輪實測)。排除的是**具名的那一個**,
#    不是把 pattern 放寬成「開頭是 b2s2b 的都算」—— 後者會把真的殘留副本一起放行。
LEFT="$(psql -X "$ADMIN_URL" -qtAc "SELECT coalesce(string_agg(datname, ',' ORDER BY datname), '') FROM pg_database WHERE datname LIKE 'b2s2b\\_%' AND datname <> 'b2s2b_pre'" 2>&1)"
if [ -z "$LEFT" ]; then
  ok COPIES-DROPPED "本輪建的副本庫已全數清除(b2s2b_% 零殘留;常駐的 b2s2b_pre 不計)"
else
  bad "副本庫殘留:[$LEFT] —— 下一輪的 TEMPLATE 複製會踩到它"
fi
# 🔴🔴 **機制,不是規則**(機制優先律):本檔自己的報告字串若混進反引號,shell 會把它當**命令替換
#    執行**,字面被靜默改掉而三綠、PASS 數全部照樣綠 —— 2026-08-07 兩次實錘:
#    ①結語那行的維名被吃掉、只印出「無靶只剩 」,stderr 冒出 command not found;
#    ②`B28-datasurface` 的 PASS 訊息把 grep 真的執行掉,印出殘缺字面 + stderr 噴 grep usage。
# 🔴🔴 **第一版的守門畫在最窄的面(只掃 `echo "`),而第 ② 個違規在 `ok "…"` 行 ⇒ 掃不到,
#    而且那一格自己還印著「報告字面不會被 shell 靜默改寫」= 恆真的假話。**
#    (memory `feedback_guard-drawn-at-narrowest-surface-not-invariant`;R1 用活體反例當場打掉。)
#    ⇒ 不變量是「**任何報告類命令的字串**不得含反引號」,面就畫在那裡:echo / ok / bad / log / die / printf。
# ══ 埠分配守門(S2b-4b;plan §3.6 的決定做成機制,不只寫在註解)═══════════════
# 🔴 本片修的 bug 就是「`a1-verify` 與 `a4a-verify` 預設同為 54329」⇒ 併行起跑必撞埠。
#    光把數字改掉、再寫一行註解說「已分埠」,下一個人複製貼上時照樣會撞回去。
#    ⇒ 這一格直接讀那兩支的**預設值字面**,斷言:①各自是 plan §3.6 定的值 ②兩者不同
#    ③兩者都在本檔的埠黑名單裡(本家族不得重用)。
# 🔴 **抽取前要先剔掉註解行**(第一次實跑當場中):兩支檔案的**註解裡都寫著舊值 54329**
#    (解釋「以前共用同一埠」),不剔就會抽到註解裡那個數字、報一個假的不符。
#    這與本檔 `SELF-REPORT-BACKTICK` 踩過的是同一件事:**掃原始碼的守門要先定義「什麼算程式碼」**。
PD_A1="$(grep -vE '^[[:space:]]*#' scripts/a1-verify.sh | grep -oE 'PORT="\$\{PORT:-[0-9]+\}"' | grep -oE '[0-9]+' | head -1)"
PD_A4A="$(grep -vE '^[[:space:]]*#' scripts/a4a-verify.sh | grep -oE 'PORT:-[0-9]+' | grep -oE '[0-9]+' | head -1)"
PD_BL="$(grep -oE '^  543[0-9|]+\)' scripts/b2s2b-verify.sh | head -1)"
# 🔴 **期望值回讀 plan §3.6 的表,不在這裡硬寫**(R1 nit 14):硬寫的話,ok 訊息說「符合 plan §3.6」
#    卻在 plan 改值時**不會紅** —— 那句話就是名過其實。回讀之後,兩邊任一方漂移都會紅。
#    🔴 讀不到(表格被改名/搬走)也要紅,不得因為期望值變空而恆綠。
PD_PLAN="docs/specs/2026-08-06-e10-b2-s2b-recompute-wire-plan.md"
PD_W_A1="$(grep -E '^\| `scripts/a1-verify\.sh` \|' "$PD_PLAN" | grep -oE '5[0-9]{4}' | head -1)"
PD_W_A4A="$(grep -E '^\| `scripts/a4a-verify\.sh` \|' "$PD_PLAN" | grep -oE '5[0-9]{4}' | head -1)"
if [ -z "$PD_W_A1" ] || [ -z "$PD_W_A4A" ]; then
  bad "埠分配:讀不到 plan §3.6 的埠表(a1=[$PD_W_A1] a4a=[$PD_W_A4A])—— 期望值來源不見了,fail-closed 判紅"
elif [ "$PD_A1" = "$PD_W_A1" ] && [ "$PD_A4A" = "$PD_W_A4A" ] && [ "$PD_A1" != "$PD_A4A" ] \
   && printf '%s' "$PD_BL" | grep -q "$PD_A1" && printf '%s' "$PD_BL" | grep -q "$PD_A4A"; then
  ok PORT-DEFAULTS "埠分配與 plan §3.6 的表逐字相符:a1-verify=$PD_A1 / a4a-verify=$PD_A4A(期望值**回讀自 plan**,非硬寫),兩者不同且都已列進本檔黑名單"
else
  bad "埠分配不符:a1-verify 碼內=[$PD_A1] / plan=[$PD_W_A1];a4a-verify 碼內=[$PD_A4A] / plan=[$PD_W_A4A];黑名單行=[$PD_BL]
     🔴 兩支預設同埠正是 S2b-4b 修掉的那個 bug —— 改回去會讓它們併行起跑時撞埠"
fi

SELF_BT="$(printf '\140')"
# 🔴 R2 F2:第一版只掃**行首**,而全檔有 89 個 `… && ok …` / `then ok …` 形的非行首呼叫在面外。
#    面擴到「命令位置」= 行首、或接在 && / || / ; / then / else / do 之後。
# 🔴 **純註解行要先剔掉**:本檔的註解裡本來就會引用命令片語(例如這一段自己就寫了 && ok),
#    不剔掉的話守門會把自己的說明文字判成違規 —— 第一版實跑當場中(FAIL=3)。
#    剔的是「第一個非空白字元是井字號」的整行,不是「含井字號」;行尾註解仍留在面內。
# 🔴 R3 must-fix 4:第一版的清單漏掉**同一個 commit 剛新增的報告命令 `inconc`** ——
#    同一片內第二次重犯「面比不變量窄」。清單本身就是那個面,新增報告命令必須同批加進來。
# 🔴 R3 must-fix 9:`grep -n` 要排在**濾除註解之前**,否則回報的是「濾掉註解後的序號」、
#    違規時診斷指到錯的行(自己就是報告字面出錯的守門,指錯行特別諷刺)。
SELF_HITS="$(grep -nE '(^|&&|\|\||;|then|else|do)[[:space:]]*(echo|ok|bad|log|die|printf|inconc)[[:space:]]' "$SELF_PATH" | grep -vE '^[0-9]+:[[:space:]]*#' | grep -F "$SELF_BT" | head -3 | cut -c1-80 | tr '\n' ' ')"
if [ -n "$SELF_HITS" ]; then
  bad "本檔有報告行混進反引號 —— 字面會被 shell 當命令替換靜默改寫:$SELF_HITS"
else
  # 🔴 宣稱要與實作等寬(R2 F2 打掉的正是「宣稱面 > 實作面」):**只**掃命令位置那一行,
  #    多行字串的**續行**(例如 bad 訊息第二行)仍在面外 —— 這句話寫在 PASS 訊息裡,不藏在註解。
  ok SELF-REPORT-BACKTICK "本檔在**命令位置**(行首或接 && / || / ; / then / else / do 之後)的 echo/ok/bad/log/die/printf/inconc 零反引號;**面外三類已寫明**:純註解行、多行字串的續行、以及單引號字串內的反引號(那不會被執行,本守門仍會判紅 = 刻意從嚴)"
fi
# 🔴 起跑前是 0/0,收尾也必須是 0/0:BEGIN…ROLLBACK 的格若有哪一格漏了 ROLLBACK,這裡會抓到。
END_SHIP="$(q "$BASE_URL" 'SELECT count(*) FROM public.shipments')"
END_ITEM="$(q "$BASE_URL" 'SELECT count(*) FROM public.shipment_items')"
END_ORD="$(q "$BASE_URL" "SELECT count(*) FROM public.orders WHERE display_id = 'PCM-9994-0001'")"
[ "$END_SHIP" = "0" ] && [ "$END_ITEM" = "0" ] && [ "$END_ORD" = "0" ] \
  || bad "🔴 基準庫留痕:shipments=$END_SHIP / shipment_items=$END_ITEM / 探針訂單=$END_ORD(應全為 0)"

[ "$CELL" -eq "$EXPECT_CELL" ] || bad "只跑了 $CELL 格行為/結構格,期望 $EXPECT_CELL —— 有格被刪掉或沒被呼叫"
# 🔴 `EXPECT_TOTAL` 原本只出現在下方的 echo、**從未被斷言**,卻被檔頭列進「凍結值」(R1 nit 8)。
#    key 集合等式已經蘊含它,但一個從不比對的凍結值本身就是誤導 ⇒ 補上。
COV_N="$(nwords "$COVERED_CELLS")"; UNCOV_N="$(nwords "$UNCOVERED_CELLS")"
COV_DUP="$(printf '%s %s' "$COVERED_CELLS" "$UNCOVERED_CELLS" | tr ' ' '\n' | grep -v '^$' | sort | uniq -d | tr '\n' ' ')"
# 🔴 R2 consider:只驗「計數 + 跨集合重複」擋不住**集合裡放過期或打錯的格名而計數恰好還是 25**
#    ——那正是本檔 `EXPECT_PASS_KEYS` 那一段自己寫的教訓(只凍總數會被「刪一格 + 重複另一格」湊過去)。
#    ⇒ 補一道:兩個集合裡的每個名字都**必須真的是本檔會產出的 key**(`EXPECT_PASS_KEYS` 的子集)。
COV_ALIEN="$(printf '%s %s' "$COVERED_CELLS" "$UNCOVERED_CELLS" | tr ' ' '\n' | grep -v '^$' | sort -u \
  | comm -23 - <(printf '%s' "$EXPECT_PASS_KEYS" | tr ' ' '\n' | grep -v '^$' | sort -u) | tr '\n' ' ' | sed 's/ *$//')"
if [ "$((COV_N + UNCOV_N))" -eq "$EXPECT_CELL" ] && [ -z "$COV_DUP" ] && [ -z "$COV_ALIEN" ]; then
  ok COVERAGE-ACCOUNT "覆蓋帳對得上:有靶 $COV_N + 無靶 $UNCOV_N = $EXPECT_CELL 格、零重複、且兩集合的名字全是真格(EXPECT_PASS_KEYS 的子集)。🔴 **本格不驗「歸類正確」** —— 把一格從有靶挪到無靶仍會綠,那一面要人讀突變矩陣的實跑輸出"
else
  bad "覆蓋帳不符:有靶 $COV_N + 無靶 $UNCOV_N = $((COV_N + UNCOV_N)),但 EXPECT_CELL=$EXPECT_CELL;重複項 [$COV_DUP];不存在的格名 [$COV_ALIEN]
     🔴 多半是新增了一格卻沒歸類 —— 歸進 COVERED_CELLS 或 UNCOVERED_CELLS,不要改數字了事"
fi
[ "$PASS" -eq "$EXPECT_TOTAL" ] || bad "PASS=$PASS,期望 $EXPECT_TOTAL —— 總格數與凍結值不符"
GOT_KEYS="$(printf '%s' "$PASS_KEYS" | tr ' ' '\n' | grep -v '^$' | sort | tr '\n' ' ' | sed 's/ *$//')"
EXP_KEYS="$(printf '%s' "$EXPECT_PASS_KEYS" | tr ' ' '\n' | grep -v '^$' | sort | tr '\n' ' ' | sed 's/ *$//')"
if [ "$GOT_KEYS" = "$EXP_KEYS" ]; then
  echo "  ✅ 具名 key 集合逐字相符(W1;只凍總數會被「刪一格 + 重複另一格」湊過去)"
else
  bad "🔴 具名 key 集合不符(W1):
     實際 [$GOT_KEYS]
     期望 [$EXP_KEYS]"
fi

echo
# 🔴 R3 must-fix 5:待裁集合等式**必須排在總結行之前** —— 排在後面時,有人把那一格刪掉/換掉,
#    人讀到的仍是 `FAIL=0`(只有離開碼變 1)。與 R2 F1 要修的是同一族:人可讀面先說了不實的話。
GOT_INC="$(printf '%s' "$INCONC_KEYS" | tr ' ' '\n' | grep -v '^$' | sort | tr '\n' ' ' | sed 's/ *$//')"
EXP_INC="$(printf '%s' "$EXPECT_INCONC_KEYS" | tr ' ' '\n' | grep -v '^$' | sort | tr '\n' ' ' | sed 's/ *$//')"
if [ "$GOT_INC" = "$EXP_INC" ] && [ "$INCONC" -eq "$EXPECT_INCONC" ]; then
  echo "  OK 待裁格集合逐字相符([$GOT_INC];$INCONC 個)—— 它不入 PASS 帳,但也刪不掉"
else
  bad "待裁格集合不符:實際 [$GOT_INC]($INCONC 個)/ 期望 [$EXP_INC]($EXPECT_INCONC 個)"
fi
echo "PASS=$PASS FAIL=$FAIL INCONCLUSIVE=$INCONC (CELL=$CELL / 期望 $EXPECT_CELL、總格 $EXPECT_TOTAL)"
if [ "$INCONC" -gt 0 ]; then
  echo "WAIT 待裁格 $INCONC 個(**不計入 PASS**):[$(printf '%s' "$INCONC_KEYS" | sed 's/^ //')]"
  echo "   項19-barrier:plan §4 項19 的「翻面必出 40P01」**未滿足**(理由見結語與 plan §4.19);"
  echo "   主視窗已裁 C(維持第三態;B-159-A),**終局判定綁 apply 前 preflight**。離開碼 3 = 無紅但有待裁,不是全過。"
fi
echo "🔴 突變覆蓋(**逐格,不四捨五入**):$EXPECT_CELL 格裡 **$COV_N 格**被至少一發突變紅過 ——"
echo "   B10 / B10b / B11 / B11b / B12 / B14 / B20(行為靶①-⑤)+ **TRUTH-SYNC**(守門靶 T1-T9,六塊全覆蓋)"
echo "   + **RB-STOPWRITE**(靶 S1/S2/S3)+ **REH-PRODUCTS**(靶 TMUT-REH / TMUT-REH2)+ **B28-datasurface**(靶 D1/D2)"
echo "   + **STRUCT-ORACLE**(靶 A1-A8 + 零突變對照 SMUT-0)"
echo "   + **B29b-line-self-heals**(靶⑤)+ **B29c-real-overship-still-red**(靶①)。"
echo "   🔴 但「被紅過」≠「它自己的判別 oracle 被證明有效」,兩格要降級敘述:"
echo "     · **B14** 在靶①⑤ 下紅的是**前提斷言**(shipped 根本沒被寫上去),它的 C9 判別 oracle 無靶;"
echo "       C9 的對照是 B15(消融),不是突變。"
echo "     · **B12** 在靶②④ 下紅的是「作廢後必須是 0」那道中途斷言;它宣稱的另一半"
echo "       「**unvoid 真的回升**」**沒有**任何一發靶殺得到(本線的靶動不到「只壞 unvoid」那條路)。"
echo "   **另外 $UNCOV_N 格沒有對應突變靶**,只被對照組證明「可以滿足」:"
echo "   ①B12b-x3 / B12b-x1 / B12c-blocks —— 驗的是 **S1b** 的守門(X3 / X1 / append-only),"
echo "     本檔的突變全在 S2b 那支 migration 上、**結構上動不到它們**;那三發靶是 plan 項25b(S2b-4c)的範圍。"
echo "   ②B12c-append-only(結構面)/ B15 / B18 —— 各自開副本庫或只查 catalog,無對應靶。"
echo "   ③**ABLATION** —— 消融格本身無靶;它是 B10 的負向對照(同路徑 2/3 vs 0/3)。"
echo "   ④**B26b-enable-restores / B27-divergence-4th**(3b 第一段)—— 兩格自帶對照(ABLATION 的 0/3、舊三軸述詞的 0 列),但**沒有**外部突變檔。"
echo "   ⑤**B22-pr4-hole**(3b 第三段)—— 自帶對照(同一筆資料舊三軸回 0、四軸 RAISE),但**沒有**外部突變檔(靶要重建庫、成本高)。"
echo "   ⑥**B29a-stale-high-reachable** —— **刻意無外部靶**:它與 B29b 是同一段 body 跑在兩個基準上,"
echo "     觀察值不同(pre 紅在 23514 / post 全過)⇒ **它的對照組是 B29b 本身**,不是裝飾格。"
echo "   🔴 **B28-datasurface 不在沒靶那份** —— 它有 D1/D2 兩發(真相式多加總一欄、把 gate 那句註解掉)。"
echo "   🔴 plan §5 環境B **九列只做了五列**(見檔頭 ⓑ)。"
echo "   🔴 環境A **七個靶只做了五個**:「trigger 改 BEFORE」**構造不出來**(PG 不接受 CONSTRAINT TRIGGER 用 BEFORE)"
echo "     ⇒ 換成「降級成普通 TRIGGER」= 打 tgconstraint 維,**tgtype 維本輪無靶**;"
echo "     「拿掉閘」「閘改 pin prosrc」兩靶未做(oracle 是「閘會拒絕」、要走雙獨立庫負測)。"
echo "   🔴 結構 oracle **十維裡只剩一維無靶**(九維有靶):"
echo "     ⇒ 有靶 = tgconstraint(A1)/ tgfoid(A2)/ tgattr(A3)/ proconfig(A4)/ grantee0+rolesnone(A5)"
echo "            / secdef(A6)/ tgdefer(A7)/ tgtype(A8)。"
echo "       🔴 **無靶只剩「SA-aclnotnull」** —— 在本 shim 環境下它**構造不出紅**:"
echo "         shim 的 ALTER DEFAULT PRIVILEGES 讓新函式出生就有非 NULL 的 proacl。"
echo "         它**不是裝飾維**,是給 plain-PG(無 default ACL)的環境保險 —— 那裡漏 REVOKE ⇒ proacl 為 NULL。"
echo "   ⚠️ **項19 barrier 已做,但整格標 <u>inconclusive</u>**(2b 第二段之二;plan §8.1 第二列):"
echo "     出貨 writer RPC 今天不存在 ⇒ 兩個 session 的 UPDATE 是 **owner 直寫**。"
echo "     證到的 = helper 逐列取鎖順序 + 「鎖排在讀真相之前」在真併發下的效果(三 session、真 COMMIT、真死結偵測);"
echo "     證不到的 = ①未來出貨 RPC 進 trigger 前會不會先取別的鎖 ②A8a2 多品項取鎖順序(plan §9 交棒 6)。"
echo "   🔴 **plan §5 指定的靶「拿掉 ORDER BY」實測翻不了面**(期望紅點 = 空集合):"
echo "     PG 把 DISTINCT 規劃成 Sort+Unique,輸出序等同 ORDER BY;兩 session 同一支函式 ⇒ 順序恆等。"
echo "     ⇒ **今天擋住反序取鎖的是 DISTINCT 的排序,不是 ORDER BY 那幾個字**;ORDER BY 現在**沒有靶**。"
echo "     該空集合的判別力由**同一套編排**下的靶 L2b 背書(連 DISTINCT 一起拿掉 ⇒ 真的丟 40P01)。"
echo "   🔴🔴 **plan §4 項19 寫的「翻面必出 40P01,測不出則該格判紅」<u>沒有被滿足</u>** ——"
echo "     它指定的翻面動作(拿掉 ORDER BY)在本形狀下根本沒有移除排序,不是「被別的鎖序意外救了」。"
echo "     ⇒ **本格算不算通過 = 主視窗待裁;本檔不自行認定、也不自行改 plan 的驗收字面。**"
echo "   🔴🔴 **本編排沒測到的第三個併發面**(已進 plan §9 交棒 10):本片 trigger 是 AFTER ROW ⇒"
echo "     一句 UPDATE shipments WHERE 多列 會逐列發火,**跨 shipment 的取鎖順序 = 該 UPDATE 的列序、無排序保證**;"
echo "     兩個這種語句併發即可能真 40P01。barrier 每個 session 只改一列,看不到這一面。**不宣稱已擋。**"
echo "   🔴 barrier 的三個情境:A 兩包裹**品項集合相同**、B 先寫者未提交、C **部分重疊 + 三品項**(靶 L2b 在 A 與 C 都翻面)。"
echo "   ✅ **項29 stale-high 三格已做**:(a) 前態可達(pre-S2b 基準)/(b) 本線自癒 /(c) 真超出貨仍紅。"
echo "     🔴 (a) 與 (b) 是**同一段 body 跑在兩個基準上**,觀察值不同 ⇒ 基準 pin 本身就是判別式;"
echo "       (a) 因此**沒有外部突變靶**,它的對照組就是 (b)。(b)(c) 已掛進突變矩陣,由靶⑤ / 靶① 打。"
# 🔴 離開碼三態:0 = 全過;1 = 有紅;**3 = 無紅但有待裁格**(不得被讀成全過)。
[ "$FAIL" -eq 0 ] || exit 1
[ "$INCONC" -eq 0 ] || exit 3
