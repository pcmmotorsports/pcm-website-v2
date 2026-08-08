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
