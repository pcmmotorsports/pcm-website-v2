# 2026-08-08 codex 補審 findings 彙整(gpt-5.6-sol,唯讀,逐片累加)

> 對應清單=`2026-08-08-codex-backfill-checklist.md` §1。每片=結論+findings 原文摘錄;triage 與去向由主視窗標注。

## #7 W3c-2 復原 writer(cf3a3105)——結論=FAIL(1 runtime MF+2 harness MF+1 nit)

1. **MF(runtime)** `20260807210000_..._w3c2_unvoid_shipment.sql:160-165`+`20260807190000_..._w3c3:84-86`:併發出貨×復原前緣可同時放行;復原輸家撞 C9 後被共用 translator 教「先作廢」,但該箱本就是作廢態=**訊息方向寫反**(translator 誤導家族第三例;前例=W6b-1 F3「先作廢」教給已作廢箱)。→ **去向:併 W7d migration 批修**(translator 在 migration 內)。
2. **MF(harness)** `scripts/w3c2-verify.sh:213-245`:TMUT-M4 覆寫正式 RPC 後未還原 ⇒ `W3C2-DRAFT-SAFE` 格測到的是 mutant 非 commit writer;正式函式誤擋草稿仍全綠。→ **去向:W7 突變矩陣**。
3. **MF(harness)** `scripts/w5-line-verify.sh:202-208`:格子宣稱五支各重放、實際只呼叫 create/add/ship;觀察點(兩表列數)天生看不到 void/unvoid 重執行 ⇒ F3 宣稱修好但程式未修。→ **去向:W7**。
4. **nit** `scripts/w5-line-verify.sh:159-190`:void/unvoid 在前置成功分支外,建箱失敗會拿空 UUID 續跑=歸因錯誤連鎖 FAIL。→ W7 順手。

codex 查無面(照錄):M4 主 inequality 方向正確/void↔unvoid 守恆未破/C9 原子性未見半完成態。唯讀限制=未實跑 PG harness(靜態核對)。

## #4 W2 冪等層(6e4b1f8f+a1f12059)——結論=FAIL(4MF+1nit)

1. **MF(runtime)** `20260807160000_..._w2_shipping_idempotency_layer.sql:191`:canonical jsonb 保留數字 scale ⇒ 首送 `quantity=1` 回應遺失後重試 `1.0`=指紋不同誤拋 P2B22、無法重放(誤拒面;同類=NFC/NFD 不正規化)。→ 去向:runtime 修=候選併 W7d/下一 migration 批;與 W8 鍵契約一併設計。
2. **MF(runtime)** 同檔 `:448`:SECURITY DEFINER 面可直 INSERT「正確 hash+既存 shipment_id+空快照」假收據,INSERT 守門與 deferred 閘皆放行 ⇒ 重試回成功但 ship/unvoid 從未發生。=[[feedback_idempotency-key-must-be-verified-not-just-present]] 同族實例。→ 去向:B 先 triage 可利用性(誰有 INSERT 路徑),修法候選=重放回應前查產物存在+內容指紋。
3. **MF(歷史帳)** `scripts/w2-verify.sh:553`(受審兩顆當下):FAIL 只累計、exit 0。codex 自註=**HEAD 已補退出碼** ⇒ 驗一眼 HEAD 即可關帳,無新工。
4. **MF(harness)** `scripts/w2-verify.sh:34`:固定 `/tmp/w2db`+開場 rm+允許 env 任意覆寫 ⇒ 並行驗證會刪別人 live cluster、誤指 repo 路徑可刪工作區。→ 去向:W7(harness 衛生)。
5. **nit** 同 migration `:603`:harness 直呼 helper+winner 睡 4s vs 正式 wrapper lock_timeout 5s=邊界時序下重試得 55P03 非 23505。→ W7 順手。

codex 查無面(照錄):23505 歸屬多情境未破/鍵表 UPDATE/DELETE/TRUNCATE/replica/deferred 各面未破(僅 INSERT 面繞出)/回傳信封未見額外形狀錯/W8 已知不重列。

## #3 W3-3 出貨(0d612874)——結論=FAIL(5MF+1nit;框架級=轉譯層 fail-open)

🔴 **框架結論**:未知 SQLSTATE 在資料面 fail-closed(RAISE 回滾),但**員工/API 面 fail-open**(裸露 DB 錯誤)——共用轉譯層沒封閉實際可拋集合。這是 Fable 五輪沒打到的角度。

1. **MF** `..._w3c3_mark_shipped.sql:143`+`w3c3-verify.sh:104`:成功 fixture 全 `hct` 且 `hct_status` 預設 `draft=未送`;RPC 不讀該欄卻回出貨成功 ⇒「系統已出貨、HCT 根本沒收到送單」部分完成態。→ 去向:B triage=產品語意題(出貨定義是否含 HCT 送單),非純補丁。
2. **MF** 同檔 `:44,:191`:檔頭承認 add×ship 可達真 40P01、重試是承重件,handler 卻沒接 `deadlock_detected` ⇒ 裸噴無重試。→ **W7d-1 出貨側 handler**(與 B 已規劃的一致,codex 獨立佐證)。
3. **MF** 同檔 `:143,:180`:T1 讀 other 允許空單號、T2 改草稿成 hct/sf ⇒ T1 撞 `23514 shipments_shipped_needs_tracking`,轉譯表漏登錄裸噴。→ 轉譯表補登(併 W7d)。
4. **MF** 同檔 `:95`+`s1a2_shipments_guards.sql:130`:把 `frozen_after_ship` 與 write-once 歸同句「不要作廢」,但原守門補救正是「作廢重開」=**教錯動作家族第三例**(前兩例 W6b-1 F3/W3c-2 MF-1)。→ 轉譯訊息修(併 W7d)。
5. **MF** 同檔 `:81`+`w4b...sql:307`:add-items 捕捉 `P0001 shipment_items_parent_open` 但表內未登錄;並發作廢先提交 ⇒ parent guard 回裸 P0001。→ 轉譯表補登(併 W7d)。
6. **nit** `w3c3-verify.sh:160`:`WRITEONCE-TEXT` 只直呼轉譯函式沒跑雙擊併發 ⇒ 證不到 RPC 落 X2(敗方更可能 rowcount=0)。→ W7 跟片。

codex 查無面(照錄):出貨×取消/×重算未找到可提交 lost update;DB 半成品未見(確認的部分完成態是 HCT 工作流語意層)。

## #2 W3-2 掛品項(ea69ecc4)——結論=FAIL(8MF;codex 抓最多的一片)

⚠️ **與既有記錄的矛盾要 B 先解**:MF-1 說「`set -u` 下 OI3 先用後宣告,乾淨環境直接 unbound variable 中止、31 格根本跑不完」——但 STATUS 記 W3-2 收割時 harness 有跑綠(33 格)。兩者必有一真:或環境差異(B 當時 shell 非 `set -u` 乾淨態)、或 codex 讀的是被後片改過的行號。**B 親驗:在乾淨 `set -u` 跑一次 w3b2-verify 看是否真中止。**

1. **MF(harness)** `w3b2-verify.sh:21,166,197`:OI3 先用後宣告,`set -u` 乾淨環境 unbound 中止=31 格跑不完(見上矛盾)。
2. **MF(harness)** `w3b2-verify.sh:286-305`:FAIL 後尾端 echo 仍 exit 0=紅跑當綠(W2/W5 同族第三例)。→ W7 跟片。
3. **MF(runtime)** `..._w3b2...sql:240-250`:instock 5,草稿A掛5→作廢→草稿B掛5→復原A(W3c-2 `:119-146` 復原跳數量檢查)⇒ 活躍 pending 變 10=**pending 不變式未封閉**。→ B triage 併 W3c-2 復原路徑一起看(同根)。
4. **MF(runtime)** 同檔 `:109-140`:指紋吃原始 p_items,首次 `quantity:1`、重試 `1.0` scale 不同得 P2B22=**與 W2 MF-1 同一根因**(canonical 未收斂數字)。→ 併 W2 那條一起修。
5. **MF(runtime)** 同檔 `:51-52`:「只影響失敗時機」過強——拿掉前緣後掛7/到貨5轉 submitted,X1 只驗非空箱、C9 尚不發火 ⇒ 錯量包裹可先進「已送新竹」語意=**推翻檔頭結論**(與 W3-2 檔頭那句自相關)。→ B triage:前緣是否真只管時機。
6. **MF(runtime)** 同檔 `:164-188`:包裹狀態無鎖讀且在重試圈外,既有品項箱並發出貨 ⇒ 新增撞 parent trigger raw P0001(非宣稱人話 P2B26)=轉譯漏,W3-3 MF-5 同族。→ 併 W7d 轉譯補登。
7. **MF(harness)** `w3b2-verify.sh:134-135`:`W3B2-ROWS` 自己 ORDER BY 聚合,刪 INSERT 排序觀察值不變=證不到「排序寫入」(量錯東西)。→ W7 跟片。
8. **MF(harness)** `w3b2-verify.sh:257-260`:`M3-NO-C9-AT-ADD` 只驗沒捕例外、沒回查 7 件存在;BEFORE trigger 靜默抑制 INSERT 仍假綠。→ W7 跟片。

codex 查無面(照錄):W3-2 單式只多減非負 pending、無反向放更多;真反例只在跨作廢/草稿復原後 pending 契約被繞。

## #1 W3-1 建箱(f18d2420)——結論=FAIL(3 harness MF+1nit;runtime 主邏輯 codex 明示未擊破)

🔴 **codex 結論句**:「runtime 主邏輯未擊破,但驗證閘可假綠,不能以 23/0 作為放行依據」=**建箱 RPC 本體乾淨**(對照 Fable PASS),FAIL 全在 harness 判別力。

1. **MF(harness)** `w3a-verify.sh`:任何格 FAIL 只累加、尾端仍成功 echo=exit 0 紅跑當綠。codex 自註 **HEAD 已補 exit guard** ⇒ 驗一眼關帳。（W2/W3-2/W5 同族,全線 pattern）
2. **MF(harness)** 耗盡格未計產號器呼叫次數:上界改 6 或 `>=`→`>`,第 6 次才丟同一 P2B21、21 格仍全綠=**量錯東西**(觀察點沒盯到重試次數)。→ W7 跟片。
3. **MF(harness)** `W3ADB`/`W3ASOCK` 可任意覆寫後遞迴刪除=誤設工作區/活 cluster 路徑會刪資料(與 W2 MF-4 同族危險清理)。→ W7 跟片。
4. **nit** 檔頭要家族靶逐成員,實際 `TMUT-FRONTEDGE` 只餵 carrier_code、FRONTEDGE-2..6 沒各自翻面=21 格不可讀成 21 格都有獨立判別力。→ W7 跟片。

codex 查無面:建箱 runtime 主邏輯(產號重試/conname 分派/快照同源)未找到可擊破路徑。

---

## 🔴 B 窗 B-298-Q 判定(B-224 MF-1 矛盾解決)——併入本檔存證

codex 事實對(w3b2:166 真觸發 `OI3` unbound)、結論錯(說跑不完;實際跑完 exit 0)、STATUS 綠也對。**真病更糟**:`set -u` unbound 只殺 command-substitution 子 shell、父腳本活著 `C` 拿空字串,而 `:167` case 把 `""` 列進 PASS 分支 ⇒ `W3B2-QTY-SCALE` **自寫下起沒測到任何東西**,`(實得 [放行])` 是 harness 崩潰後的空值。=`feedback_negative-test-harness-self-false-green` 新形狀(失敗觀察與成功觀察共用空值編碼)。⇒ **B-296 的「379 格全綠」含金量降低≥1 格**;W7 跟片會把「空值當成功」當全線 pattern 掃(修類非修實例)。

## #5 W5 線級 harness(36d231e6)——結論=FAIL(3 harness MF+1nit;全假綠、無 runtime)

🔴 反諷:此片自己修的就是「五支 verify 的 exit 守門」,codex 確認**主體五支都補到了**(W2:559/W3a:262/W3b2:316/W3c3:267/W5:280,FAIL≥1 回 exit 1),但漏了 teardown 那條路。

1. **MF** `w5-line-verify.sh:152-154,219-223`:建箱 RPC 靜默回空物件時 `E2E-CREATE` 仍先記 PASS;突變靶另行直查沒重跑原判斷=格子字面假綠(與 B-298-Q 的「空值當成功」同族)。→ W7 跟片。
2. **MF** `w5-line-verify.sh:15,72,127-165`:實際只呼叫 create/add/ship 三支+fixture 直接 INSERT 多張業務表 ⇒ void/unvoid 未行為測、「五支 RPC 零直寫」宣稱不成立(與 W3c-2 codex MF-3 同一觀察)。→ W7 跟片。
3. **MF(家族)** `w2:551`/`w3a:254`/`w3b2:308`/`w3c3:259`/`w5:272`:五支都忽略 teardown 失敗——`pg_ctl stop` 失敗或埠殘留時畫面顯示殘留非零、但 `FAIL=0` exit 0=**exit guard 補了主體、teardown 出口仍假綠**。→ W7 跟片(全線收尾碼一起修)。
4. **nit** `w5-line-verify.sh:53-59`:尾端閘只比最大 timestamp,新增同/較舊 timestamp migration 不觸發 die=與「新片落檔必紅」不完全符。→ W7 跟片。

codex 已試未破:五支主體 exit guard 確實補到;正向出貨產物沒直寫 shipments/shipment_items(直寫在上游 fixture 與 mutation 段)。

## #6 W3c-1 作廢(00688c49)——結論=FAIL(3MF+1nit;runtime 乾淨=void×ship 查無對稱 TOCTOU、轉譯無 fail-open)

1. **MF(harness)** `w5-line-verify.sh:193`:宣稱四支皆重放、實際 :195-197 只 create/add/ship 沒呼叫 void ⇒ void 冪等漂掉 `LINE-REPLAY-NO-GROWTH` 仍綠(與 #5 MF-2/#7 MF-3 同一觀察三度出現)。→ W7 跟片。
2. **MF(oracle 缺口)** `w5-line-verify.sh:175`:作廢後只驗摘要 3→0、沒重開新箱驗可用量 ⇒ W3-2 pending 若忘排除已作廢箱,整線綠但員工無法重新裝箱=缺跨片 oracle。→ W7 跟片。
3. **MF(守門窄)** `..._w3c1_void_shipment.sql:152`:fail-closed 斷言只驗 signature/ACL,未驗 owner/SECURITY DEFINER/search_path/lock_timeout,且 harness 以 postgres 跑 ⇒ 提權邊界漂掉仍全綠。→ W7 跟片(斷言面擴)。
4. **nit** `w5-line-verify.sh:174`:註解稱 E2E-VOID 已移入前置成功分支、實際仍在 fi 外(=你 #7 nit-4 同處,註解與程式不符)。→ W7 跟片。

codex 查無面(照錄):void×ship 兩序皆無對稱 TOCTOU/作廢退量方向正確/SQLSTATE 未知碼原封 RAISE 無吞錯/兩支 exit guard 在。

---

# 全七片總表(2026-08-08 codex gpt-5.6-sol 補審收束)

| 片 | 結論 | MF | 去向摘要 |
|---|---|---|---|
| #1 W3-1 建箱 | FAIL | 3(全 harness) | runtime 乾淨;exit/耗盡計次/DB 路徑刪除 → W7 跟片 |
| #2 W3-2 掛品項 | FAIL | 8(3 runtime+5 harness) | pending 契約跨作廢復原被繞/前緣結論過強=B triage;scale 併 W2;餘 W7 跟片 |
| #3 W3-3 出貨 | FAIL | 5(框架級) | 轉譯層員工面 fail-open+教錯動作第三例+HCT 語意題(轉 Sean)→ W7d 為主 |
| #4 W2 冪等層 | FAIL | 4(2 runtime) | 指紋 scale 誤拒+假收據 INSERT 面 → W7d 後 triage;exit0 HEAD 已修 |
| #5 W5 harness | FAIL | 3(全假綠) | 主體 exit guard 已補對、teardown 出口全漏 → W7 跟片全線掃 |
| #6 W3c-1 作廢 | FAIL | 3(harness/oracle) | runtime 乾淨;跨片 oracle 缺口 → W7 跟片 |
| #7 W3c-2 復原 | FAIL | 3(1 runtime) | translator 方向寫反(第三例)→ W7d-1 已吃;harness → W7 跟片 |

**三大主題**:①轉譯層(裸噴未登錄碼+教錯動作×3)→ W7d 批修 ②harness 假綠家族(exit 0 出口/空值當成功/宣稱五支實跑三支/危險 rm)→ W7 跟片全線 pattern 掃 ③冪等指紋 scale(W2+W3-2 同根)→ 與 W8 鍵契約併設計。**runtime 主邏輯全線未被擊破**(建箱/作廢/出貨×取消交錯 codex 皆查無)——重點債在「證明品質」不在「行為正確性」,全數趕在 apply 前。
