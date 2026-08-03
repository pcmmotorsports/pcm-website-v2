# 2026-08-03 日間視窗②交接:refund 線(sandbox 硬閘 probe + A7c 接線 plan)

> 執行環境:git worktree `/Users/sean_1/pcm-refund-wire`、branch `refund-wire`(自 dev@36cb453;主視窗預建)。
> 紅線遵守實況:**只打 TapPay sandbox、正式站零請求**(端點寫死+送出前 host 斷言)/ 金額全程 1-6 元 /
> **未 push、未 apply、未動 STATUS/CURRENT**、未跑 busboy-end(worktree=印表機)/ 動錢零 cron(全部本視窗同步執行)。

## 0. TL;DR(給主視窗/Sean)

1. **段① probe 收案**:Sean Q3=A 核准的兩個「從未證明的假設」全部定案 —— `bank_refund_id`
   同鍵重送被 `6002` 乾淨拒絕(**但 10024 拒絕也消耗鍵** ⇒ deferred 重試必須換鍵)、
   **同單併發重複退被 TapPay 序列化**(輸家 `10050`、無雙退;n=1)。外加 `refund_amount`=本次額定案。
   全文權威=`docs/reference/tappay-reference.md` **§2.3b**(逐發先預測後驗);memory 已同步。
2. **段② A7c 接線線 plan v3.1**:`docs/specs/2026-08-03-a7c-refund-wire-plan.md`
   (RW1a-RW4 拆片+⛔apply 硬停點 / S1-S7 schema 增補+G0-G12 守門 / 三態接點總表 /
   接線債三條處置)。關卡1 兩輪 FAIL 全折入,見 §3。
   ✅ **Sean 已拍板(08-03 下午,逐字「a,a,a,B,a」)**:refunded 硬擋/現行授權+確認碼/
   恢復走 Portal 真碼/**Q4=B 全額+部分一次做**/Q5=A Fable R3 換角度 PASS 才開工 RW1a。
   拍板落檔=plan §5 + memory `project_m3-a7c-wire-plan-0803-decisions`。
3. 🟡 **今晚殘項一條**(見 §4):T2 交易今晚 18:00 送批請款,20:00 後補兩發驗證(消耗鍵/新鍵)。

## 1. 段① probe:做了什麼(腳本 `scripts/tappay-sandbox-refund-probe2.py`,v1 原樣未動)

- 素材:舊交易 `D202607314b3cIL`(T1,剩 2 元)+ 官方 sandbox 測試 prime(實打驗證有效)
  新建 `D202608034SFpuL`(T2,6 元、AUTH 未請款)、`D20260803QkAvlo`(T3,6 元)。
- 八發(每發先寫預測、動作前後都 query;逐發原始回應見 §2.3b 表):
  P1 格式+語意 → P2 同鍵重試 → P2b 跨交易同鍵 → P3 未請款帶鍵 10024 → P3b 10024 後同鍵
  → P5a 超額 10051 → P5b 10051 後同鍵 → P4 barrier 併發全額×2(異鍵)。
- 收官狀態:T1 退畢(6/6、`record_status=3`)/ T3 退畢(P4)/ **T2 完好 6 元未請款 = 今晚素材**。

**六大定案**(細節與設計結論=`tappay-reference.md` §2.3b;A7c plan §0 已消費):

| # | 定案 | 對 A7c 的意義 |
|---|---|---|
| 1 | `refund_amount` = 本次退款額(非累計) | finalize 可拿它比對請求額 |
| 2 | 同鍵重送 → `6002 Duplicate bank_refund_id`,商戶全域、檢查先於請款狀態 | TapPay 端有 at-most-once 防線 |
| 3 | 🔴 **10024 拒絕消耗鍵**(被拒回應帶 refund_id) | deferred 重試**必須換鍵** ⇒ 一列一鍵機制化 |
| 4 | 10051 **不**消耗鍵(與 3 不對稱) | 別依賴不對稱;rotation-always |
| 5 | 🔴 `6002` ≠ 錢動過(可能是被拒嘗試佔鍵) | 恢復流程必走 Record 差額對帳、不得假設成功 |
| 6 | 併發全額×2:一發 0、一發 `10050`、`refunded=6` 非 12 | 有序列化但 **n=1 不當防線**;single-flight 仍自建 |

## 2. 段② plan:拆片一覽(詳 plan 檔)

RW1 `order_refunds` 寫入 RPC 對(initiate/finalize;RF2b 缺口實查確認=ACL 註解明文要求但 RPC 從未建)
→ RW2 endpoints 搬 packages/adapters + admin composition + 全額退縱切(sandbox 端到端)
→ RW3 部分退+deferred/rejected UI+讀模型 → RW4 恢復與覆核(6002 對帳/refundId 遺失窗/RF8)。
全線高風險(鐵則 12①②③)、每片關卡1+2 不降級。

## 3. 關卡1(codex `gpt-5.6-sol` -s read-only;前後 `git status --porcelain` 零留痕已比對)

- **R1 = FAIL:22 must-fix + 6 nit;逐條親驗、駁回 0、全折入 plan v2**(原文=scratchpad
  `codex-k1-out.txt`;plan 檔頭有折入紀錄)。最重的幾條:
  1. 🔴 我的 G3「remaining 當金額上限」**推翻拍板⑤而不自知**(且 remaining 是 Portal 盲區的
     衍生值 —— 同款教訓=memory `feedback_guard-reads-non-authoritative-cache`)⇒ 已降回
     「正整數 + 上界不設、超退交 TapPay 10051」。
  2. 🔴 deferred 映成 failed 會讓「還不能做」被讀成「失敗」(違 Q2=A 拍板語意)⇒ 升決策題 Q1。
  3. 🔴 accepted 但金額不符時留 processing = refundId 因 P7C10 無處可放而遺失 ⇒ 新增 S3
     證據欄(與結案點分離、不動 P7C07/09/10)。
  4. 🔴 「Record 差額對帳」原版不可執行(沒有 baseline)⇒ 新增 S2 `record_refunded_before`
     (initiate 時 Record 查存;查不到=整筆 RAISE 不發退款)。
  5. 🔴 G7 指紋引用了**不存在的 kind 欄**、request_id 無 UNIQUE 可跨單重用 ⇒ S1/S4 schema 增補。
  6. 🔴 G10 翻轉原版會在 failed+SUM=0 時把 paid 翻成 partiallyRefunded ⇒ 改 confirmed-only+單調不降級+精確 SQL 順序。
  7. 🔴 RW2 一片六件事超時+RW1→RW2 缺 apply 硬停點 ⇒ 重拆 RW1a/1b/⛔停點/RW2a-d。
  8. 🔴 Q3 sentinel 撞 `tappay_refund_id` UNIQUE+P7C07 write-once ⇒ 改「Portal 人工取真 DR 碼」路線(P7C09 不鬆綁)。
- **R2(窄複審)= FAIL:F1-F28 判 20 關 / 8 未關(F2/F4/F5/F12/F15/F17/F18/F24)+ 新增 N1-N3**。
  8 條未關全屬「規格要寫死、不能留給施工者」型+一條真矛盾(N3 outcome 不可達),無設計僵局;
  **已全折入 plan v3**,關鍵折法:F2/F12=deferred 併 failed 的選項刪除、升 §0 定案(承 Q2=A 拍板
  語意);F4=baseline 資料流改「action 先 recordQuery→驗證→傳 RPC」(DB 打不了 HTTP);
  F5=full 凍結額 := Record 回的 `amount`(TapPay 剩餘額=權威);F15/F17/F18=audit payload 鍵集合/
  outcome 五碼(刪不可達碼)/輸入衛生實際上限全部寫死;F24=RW4 判定碼表+30 分閾+harness 格;
  N1=S6 連動改 remaining 函式 WHERE;N2=S3 write-once 守門規格補齊;N3=S7 加 `failed_detail` 欄。
- **兩輪原文(逐字)= `docs/reviews/2026-08-03-a7c-wire-k1-codex.md`**;兩輪皆零留痕。
- **輪數上限 2 已滿(CLAUDE.md ③)⇒ 不跑 R3、停等 Sean**;第 3 輪按 00-work-rules §5 必須
  換模型換角度 ⇒ 處置本身列為 plan §5 Q5(A=Fable R3 審 v3 後開工/B=Sean 直接拍跳 R3)。

## 3b. RW1a 已實作收工(Sean 拍板後同視窗續行;Q5=A 前置=Fable R3 窄確認 PASS 已滿足)

- **產物**:`supabase/migrations/20260803150000_m3_a7c_rw1a_refund_write_rpcs.sql`(~1050 行:
  S1-S7 schema 增補〔kind/Record baseline/S3 證據欄/request_id UNIQUE/single-flight partial
  unique/deferred 第四態/failed_detail〕+ 三支既有函式改版〔狀態機+兩守門;原門行為逐字保留,
  新增 P7C12-P7C15〕+ remaining 函式改版 + `admin_initiate_order_refund`/`admin_finalize_order_refund`
  兩支 owner RPC〔A6 全套形狀〕+ 檔內 fail-closed 驗收)。**未 apply 正式站、未 db push**。
- **驗證**:本機 PG17 from-zero 全套 migration 重放**三輪綠**(54331 拋棄式、與視窗①的 54329
  隔離、已 teardown)+ 行為 smoke 十六路全符(冪等重放/重播穿透 LEDGER_FULL 拿 DUPLICATE/
  single-flight/deferred 釋額換鍵/金額不符 hold/hold 列零動錢出口擋下/恢復閘/Portal 真碼恢復/
  翻轉兩級/audit 帳目+reason 全 NULL)+ typecheck 8/8 lint 10/10(純 .sql 片)。
- **關卡2(鐵則 12①②③)**:code-reviewer(opus)R1 FAIL 1C+4I+8M + codex `gpt-5.6-sol` R1
  FAIL 7MF+5nit → 逐條親驗全折(駁回 1 條有據)→ **R2 兩線皆 PASS**。最重修法:P7C15 關
  「hold 列→零動錢終態→釋鎖再退」雙退路徑、G4 冪等移到一切業務前置之前、audit 全改 RETURNING
  實際列值、恢復出口加異常列閘。三輪逐字=`docs/reviews/2026-08-03-a7c-wire-k1-codex.md`。
- ⚠️ 兩份審查是**同 diff 平行開線**(SOP ⑥⑦ 我並行跑了;lesson 說擇一 —— 實況:重疊僅 2 條、
  互補為主,但下片照 SOP 序跑、不再並行)。
- **下一步**:⛔ 硬停點 = Sean `db push`(dry-run 應恰一支 20260803150000)→ read-back →
  regen types(+十處手動校正)→ typecheck → 才開 RW2a。RW1b harness(格+突變+交錯 barrier)
  在停點前後皆可做,建議先做完再 apply。

## 3c. RW1b harness 收工(主視窗收割 RW1a 後續行;plan §1 RW1b 列全項落地)

- **產物**:`scripts/a7c-rw1b-verify.sh`(新,1480 行;port **54331**、與視窗①的 54329 全程隔離)
  九段:from-zero provision(initdb PG17+shim+全套 migrations 重放+d1t2 seed)→ 兄弟 A
  (`a7c-verify.sh` 全套)→ **59 行為格**(兩 RPC 全部固定回傳碼/RAISE 面、fixture 三釘防恆真
  可執行斷言化、deferred×failed_consistency 相容格、稽核鍵形+筆數+hold 第七值、G8 單調與來源態
  allowlist、隔離閘)→ **16 直寫負測+n00 對照組**(紅對 constraint+SQLSTATE)→ **15 逐守門突變加
  2 版本回退消融**(NOOP 自檢;消融=狀態機 deferred 邊、remaining allowlist,各自帶新綠舊紅
  判別對)→ 結構指紋零漂移 → **G8×G12 barrier 交錯**(FIFO 雙 session+`pg_blocking_pids` 綁定
  blocker;三世界線判別:LEDGER_FULL=正確/IN_FLIGHT=沒等鎖/INITIATED=舊快照)→ 兄弟 A'
  (**A→B→A 閉環**)+行為格第二輪 → **rollback 實跑**(REVOKE+DROP RPC×2+DROP INDEX×2 →
  帳本/稽核零觸碰+舊守門 P7C04 健在 → ROLLBACK 指紋回基準)→ 留存清點+數量閘
  (57 all/55 run;code-reviewer R1 MF1 刪一恆真格後)。
- **兄弟對帳(本片重要發現)**:RW1a 的兩個 NOT NULL 新欄把 `a7c-verify.sh` 的全部
  `order_refunds` INSERT 打紅(佈 seed 即 23502)——A→B→A 正是抓這個。已對帳 13 處
  (PORT env 覆寫 + 每個 INSERT 補 `kind='partial', record_refunded_before=0`),對帳後
  兄弟兩輪(A/A')43 ✅ 全綠。
- **驗證**:54331 from-zero `all` 修前 58/58、兩線 R1 折入後 **57/57 全綠 exit 0 兩輪一致**
  (刪的那格=「B 零輸出」恆真格)。⚠️ `run=55` 那條路徑折入 §6 冪等守門後**無實跑證據**
  (跑過 §6 的 cluster 會被守門擋=設計如此;數字由 R2 靜態手算核對)—— 折入前 run 實跑過
  56/56 一致,可重現宣稱以 `all` 兩輪為準。
  三綠:turbo typecheck 8/8 + `tsc -p tsconfig.scripts.json` 綠(⚠️ worktree root
  `node_modules/.bin` 缺 tsc=環境既有缺口,用 pnpm store 的 typescript@5.9.3 補跑;主樹不缺)
  加 lint 0;未動 .ts/.tsx 免 build。
- **關卡2(全線高風險不降級;照 SOP 序列、不平行)**:code-reviewer(opus)R1 FAIL
  3MF+8nit(最重=「B 零輸出」恆真格 + 誠實邊界段引用了不存在的案例 id)→ 全折 →
  codex `gpt-5.6-sol` R1 FAIL 4MF+3nit(最重=`/tmp//` 穿過 workdir 閘 ⇒ `rm -rf /tmp//`;
  outcome 值域只數 7 不比集合;finalize 四道獨立衛生無負測;barrier substring grep)→ 全折
  (c56-c59 補格、55→59)→ 兩線 R2 窄複審(見下)。兩輪駁回 0 條。
- **誠實邊界**(檔頭同款字面):本機 PG 非 Supabase;RPC 內 5a/G5 不做文字手術消融(觀察各自
  可歸因:5a=RPC 訊息 vs P7C15=trigger constraint 名、由 c20/n14 兩兩獨立釘;G5=「CAS 失敗」
  訊息 c08);併發只做 plan 指定的 G8×G12 一種(兩 finalize 同單=S5 下物理不可達,fable F5);
  barrier 段刻意留存 3 張 harness 訂單+1 列 confirmed+2 筆稽核(§9 清點釘死)。
- **待辦登記(不在本片)**:A7b-T harness 家族(`a7bt-fixtures.sh` 的 `sql_ledger_and_e9`)
  直寫 `order_refunds` status='confirmed' 且無新欄 —— 推斷自 20260801120000(P7C01)起已紅、
  RW1a 新欄再疊一層;屬 A7b-T 線(order_refund_jobs)的 harness 對帳,**未修**(54329 被佔、
  未實跑證實;報主視窗排片)。

## 3d. apply 後三步(Sean 晚間指令:ff 併 dev → regen types → RW2a;順序固定、已全數完成)

- **ff 併 dev** ✅:refund-wire → `f781416`(A4a `20260803140000` + RW1a `20260803150000` 皆已
  apply 正式站、主視窗 read-back 全符)。
- **regen types** ✅(`7160be6`):`gen types --project-id`(不讀 .env.local);diff 健檢=41 行
  純新增零移除(兩支退款 RPC + order_refunds 新欄全進);**十處手動校正逐字重貼**(python 斷言
  10/10);檔頭 LIVE 基準段更至 08-03 + 前瞻註記(RW2c 要補退款 RPC Args 五處 `| null`);
  typecheck 真重編 8/8(3 task 非 cache)。
- **RW2a** ✅(`79cb4f2`):tappay endpoints 搬 `packages/adapters/src/tappay/endpoints.ts`
  (功能本體逐字等值=codex SHA 比對;出口 @pcm/adapters/server 與 ChargeAdapter 同 subpath;
  root 零曝露)。測試三格拆兩家:URL 兩格隨模組、composition 接線守門留 storefront 並補釘
  import 來源;scripts/d1-tappay-client.test.ts import 隨遷(首輪 grep 沒掃 scripts 漏抓、
  全套測試抓回 —— 查無斷言 grep 全樹再確認)。回歸:pnpm test 302/302(3840)+ tc/lint/build
  全綠。關卡2:code-reviewer PASS+3nit 全清 / codex PASS+2nit(措辭已修;AGENTS.md scope
  白名單與實務漂移=動規則檔需 Sean、僅記錄)。
- **下一片=RW2b**(admin composition + env 配對 fail-closed + route maxDuration ≥45s):
  🟡 admin Vercel `TAPPAY_*` env 未查證(Sean dashboard;不擋 dev 實作)。→ **已收工,見 §3e**。

## 3e. RW2b 收工(08-03 深夜第二個視窗;夜跑 Q1=A 指派的兩片之一)

**前置兩步(主視窗指令,順序固定)**

- `git merge --ff-only dev` ✅ `32f6b75 → 1b8f842`(A4a/RW1a/A5a 三支 migration 皆已 apply 正式站)。
- **regen types** ✅(`a55fc55`):`gen types --project-id`;body diff = **純新增**
  `admin_upsert_item_procurement`(11 參數)→ text、**零移除**(無 07-29 式 view 型別靜默消失);
  **十處手動校正逐字重貼**(python 斷言各恰一處)。⚠️ A5a 的 Args **五處可為 NULL 刻意不補**
  (`p_contact_channel / p_submitted_at / p_supplier_order_no / p_exception_reason /
  p_expected_arrival_date`;migration `:228-291` 逐欄實查)—— 理由=呼叫端 A10b 尚不存在,
  現在補不受 typecheck 守護、只多一筆重 gen 必掉的手工債;**A10b 開工時補上並把檔頭「共十處」改十五處**。
  typecheck 8/8 真重編 + scripts tsconfig 綠(🔴 本 worktree root 無 hoist 的 `tsc`,
  走 `packages/adapters/node_modules/.bin/tsc`;`pnpm typecheck` 尾端那行 `tsc: command not found`
  是這個環境事實、**不是**本片造成)。

**產物(1 commit;`apps/admin/src/lib/payment/` 新目錄)**

| 檔 | 是什麼 |
|---|---|
| `composition.ts`(133 行,鐵則 6 綠) | 後台唯一 TapPay 注入點:`getTapPayAdapter()` + `tapPayEnvPairingViolation()` + `PROD_SUPABASE_HOST` |
| `composition.test.ts` | 行為測試:配對矩陣、端點來源、fail-closed 十格(每格斷言 **adapter 未被建構**) |
| `composition-tappay-wiring.test.ts` | 結構守門:展開注入/import 來源唯一/動態 env 讀法/配對排在建構前/admin 全樹三格掃描/`maxDuration ≥45` |
| `app/orders/[id]/page.tsx` | 只加 `export const maxDuration = 60` + 論證註解 |

**三個設計要點(踩過才知道的)**

1. **環境配對斷言 = TapPay env ↔ 帳本 DB(`NEXT_PUBLIC_SUPABASE_URL`)必須同一側**,規則寫死不做成 env
   (判準交給 env,設錯 env 那刻判準也一起錯)。擋兩種誤配對:`production × 非正式帳本`(真錢動了、
   正式站零紀錄)/ `sandbox × 正式帳本`(正式訂單佔 single-flight 與可退額度、客人的錢一毛沒退)。
2. 🔴🔴 **env 必須用動態 `process.env[name]` 讀**(關卡2 codex C1):Next 會把**靜態**
   `process.env.NEXT_PUBLIC_*` 在 build 時內聯,而真正決定帳本去處的 `createSupabaseServiceClient()`
   是動態讀(`packages/adapters/src/supabase/client.ts:25-27`)⇒ 混用 = **守門量到的值和它要保護的值
   不是同一顆**。單元測試**看不到** build-time 內聯(vitest 只改 runtime env),只能靠結構斷言頂住。
3. **`maxDuration` 取 60 不是 45**(plan 只要求 ≥45):45 扣掉 adapter 的 30s 退款硬逾時後只剩十幾秒
   給授權/重讀/Record/兩次 RPC;60 在本 repo 有實際部署過的前例
   (`apps/storefront/src/app/api/cron/email-sweep/route.ts:47`)。**一手證據**=build 產物
   `apps/admin/.next/server/functions-config-manifest.json` 內 `"/orders/[id]": {"maxDuration": 60}`。

**🔴 契約債(RW2c 必還)**

- `recordQuery` **預設無逾時**(`packages/ports/src/ITapPayAdapter.ts:97-100`)⇒ action 必須自帶
  `AbortSignal.timeout(≤10s)`。精確講:Record **無限 hang** 會被砍在 Record 上(反而安全:錢沒動、
  帳本沒列);危險的是 Record **慢但有回應**、把餘額吃到不足 30s,退款送出後才被砍在 fetch 中途。
- 退款入口若不放在 `orders/[id]`(另開 route handler),**那條 route 也要帶同一個 `maxDuration`**;
  本片的斷言只釘得住這一個 segment。
- `getTapPayAdapter()` 回的是 `AdminRefundTapPay = Pick<TapPayChargeAdapter,'refund'|'recordQuery'>`
  (窄型別可塞替身;⚠️ **只是型別層**,runtime 仍是完整 adapter)。

**審查兩線(高風險片不降級;跑前後 `git status --porcelain` 逐字比對零留痕)**

- **code-reviewer(opus)R1 = FAIL 4 must-fix + 7 nit**,全部親驗屬實、全折:
  ①註解引用了不存在的 `page.test.ts` ②`new TapPayChargeAdapter` 純字串守門被 alias import 繞過
  ③`process.env.TAPPAY_` 漏 bracket/解構寫法 ④**`https://<正式host>./` 尾點 FQDN 繞過整道配對斷言**。
  外加 nit:45→60(採納)、`Pick` 取代具體類別(採納)、import 來源兩條分開斷言(採納)。
- **codex `gpt-5.6-sol` R1 = FAIL 13 must-fix + 2 nit** → 折入 → **R2 窄複審 = FAIL 3 must-fix** → 再折入:
  R2-1 `http://.` 剝完尾點 host 變空 ⇒ sandbox 側整個放行(**我自己在 R1 折入時捅出來的洞** ——
  當時憑「協定 allowlist 蘊含 host 非空」刪掉了空 host 檢查,那個蘊含只對**原始** hostname 成立);
  R2-2 wrapper 取名 `*.test.ts` 就整個消失在掃描外(豁免清單改成列舉本目錄三支檔);
  R2-3 幌子 import 放**行尾註解**可騙過來源斷言(改成數 import 行、數量必須恰 1)。
- **不修、改成縮小宣稱的三條**(codex C5/C6/C9/C10/C12):`Pick` 只是型別層 / source-text 掃描擋不住
  刻意規避(字串拼接、computed property、把 wrapper 藏進 `packages/`)。檔內逐字寫成
  「**攔回歸,不攔對手**」。判斷理由=把宣稱縮到實際能力,而不是為了讓宣稱成立去疊 runtime wrapper。

**⚠️ 需要主視窗/Sean 知情的一條(不是我能自己拍的)**

> **關卡2 停在「R2=FAIL 已全折入,但沒有第三輪確認」。** plan §6 與 SOP ⑦ 寫的是「每片硬上限 2 輪、
> round2 仍 FAIL 停下 raise Sean」;而 07-29 Sean 口頭推翻上限、改成「還在抓到真 finding 就繼續,
> **第 3 輪起必須換角度換模型**」。本片兩條規則指向同一個動作:**停**。
> 我的判斷=不自己再開同模型第三輪(R2 三條全在同一層:守門切片邊界 + URL 解析邊界),
> 改成把每條修法各配一個**會殺死它的突變**(下方 27 格)後停手。
> **要不要在 RW2c 開工前補一輪 Fable 換角度審 RW2b,請主視窗/Sean 決定。**

**驗證(數字皆為實跑輸出)**

- 三綠:typecheck **8/8**、lint **10/10**、admin build 綠、scripts tsconfig 綠;
  完整 vitest **304 檔 3866 passed + 1 todo**(RW2a 收工時為 302/3840)。
- **突變 27 格、逐格轉紅、還原後全綠**(腳本留在 scratchpad、不入 repo)。涵蓋:配對兩方向各自失守 /
  拿掉 throw / 斷言搬到建構後 / `hostname`→`host` / 尾點 FQDN 後門 / 協定 allowlist / 剝點後空 host 與
  **檢查順序** / PROD host 改成別的 ref / 靜態 env 讀法回歸 / partnerKey↔merchantId 對調 / 空字串 env /
  端點改 inline 字面 / admin 自建 endpoints 複本(值對調)+ 幌子 import 放整行註解與行尾註解 /
  別的 admin 檔用 alias import·bracket·解構·大寫端點·`*.test.ts` 命名規避 / `maxDuration` 降值與註解掉。
- 🔴 **誠實邊界**:本片**零真環境驗證**(沒打過 TapPay、沒連過 Supabase);`getTapPayAdapter()`
  **全 repo 零呼叫端** ⇒ 對 27 項驗收貢獻 **0**;admin Vercel 的 `TAPPAY_*` 仍未查證(Sean,死線 RW2d 前)。

## 4. ✅ 今晚殘項已收案(08-03 20:0x 實跑;預測三發全中、零意外)

T2 今日 11:10 建立(AUTH)→ 18:00 送批 → 20:0x 確認請款。**發前預測已登記於本節前版**
(git `b85527e` 可查),逐發對照:

| 發 | 動作 | 預測 | 實測 | |
|---|---|---|---|---|
| 1 | `query D202608034SFpuL` | `is_captured=True` | `record_status=1(OK)`、`is_captured=True`、`amount=6`、`refunded_amount=0` | ✅ |
| 2 | 消耗鍵 `pcm-p3-20260803` 退 1 | **`6002` 恆久** | `6002`;前後 `refunded_amount` 皆 0 | ✅ |
| 3 | 新鍵 `pcm-night-fresh1` 退 1 | `0`、`refund_amount=1` | `0 Success`、`refund_id=DR20260803gvcV5i`、`refund_amount=1`;事後 `record_status 1→2(PARTIALREFUNDED)`、`amount 6→5`、`refunded_amount 0→1` | ✅ |

**收穫兩條(已寫入 `docs/reference/tappay-reference.md` §2.3b P6/P6a/P6b + 結論 2 強化、結論 6/7 改寫)**:

1. 🔴 **鍵消耗恆久、跨「請款」狀態變化不重置(無 TTL)** —— 第 2 發是本次最重要的一格:
   它同時證了兩件事 ①rotation-always 從「保守選擇」升格為**必要**(不換鍵重試必撞 6002,
   而 6002 依結論 1 要走昂貴對帳)②**at-most-once 可被設計依賴** ⇒ RW1a G2「一列一鍵」的
   前提成立。若這發回 `0`,§2.3b 結論 5 要重寫且 RW2c 得停工 —— 沒有發生。
2. ✅ **「deferred→請款→換鍵重試」正向鏈端到端閉合**;且 `amount`(剩餘可退,G3 全額凍結額
   來源)與 `refunded_amount`(累計,S2 baseline / RW4 差額判定來源)**在同一筆真資料上同時
   驗證**:6→5 與 0→1 各自對上,兩個語意不再靠推論。

**probe 全案結束**,08-01 遺留的「未證、設計不得依賴」清單清空。仍未證者見 §2.3b 結論 7
(正式商戶請款時點 = sandbox 觀測不外推、不寫進 UI 文案;併發 n=1 只當 signal)。

## 5. 沒做什麼(誠實邊界)

- ~~零實作 code~~ **已過期**(本節寫於拍板前):Sean 拍板後 RW1a/RW1b/RW2a/**RW2b** 皆已實作收工,
  見 §3b/§3c/§3d/**§3e**;**RW2c 起未動工**(錢面片留白天、建議 Fable)。
- RW2b **零真環境驗證**、`getTapPayAdapter()` 全 repo 零呼叫端 ⇒ 對 27 項驗收貢獻 0;
  關卡2 停在 **R2=FAIL 已折入、無第三輪確認**(§3e 末段,需主視窗/Sean 決定要不要補 Fable 一輪)。
- probe 的併發結論是 **n=1 單次取樣**;「已請款後的部分退併發」未測(非必要:S5 single-flight
  已在 DB 端擋同單並行)。
- adapter JSDoc 兩處「語意未證」字面(`types.ts` refundAmount / TAPPAY_REFUND_STATUS 同鍵重試)已被
  本日 probe 推翻,**未改 code**(worktree 紀律:文件與 memory 先行,JSDoc 隨 RW1/RW2 實作片一併改,plan §0 已列)。
- admin Vercel 的 `TAPPAY_*` env 未查證(需 Sean 開 dashboard;plan §0 標未確認)。
- MEMORY.md 索引 21.4KB 逼近上限,hook 要求壓到 17.1KB —— 撤條目需 Sean 拍板
  (`reference_memory-index-trim-ceiling`),本視窗只壓了自己新增的一行,**待 Sean 決定瘦身**。

## 6. 檔案異動清單(本視窗 commit;不 push、主視窗驗併)

- 新:`scripts/tappay-sandbox-refund-probe2.py`(probe v2;v1 未動)
- 新:`docs/specs/2026-08-03-a7c-refund-wire-plan.md`(plan v3;兩輪關卡1 折入版)
- 新:`docs/reviews/2026-08-03-a7c-wire-k1-codex.md`(兩輪 findings 逐字)
- 新:`docs/handoff/2026-08-03-day-refund-wire.md`(本檔)
- 改:`docs/reference/tappay-reference.md`(§2.3a 兩處過期字面加指標;新增 §2.3b)
- 新:`supabase/migrations/20260803150000_m3_a7c_rw1a_refund_write_rpcs.sql`(RW1a;未 apply)
- 新:`scripts/a7c-rw1b-verify.sh`(RW1b harness;§3c)
- 改:`scripts/a7c-verify.sh`(RW1a 新欄對帳 13 處 + PORT env 覆寫;§3c)
- memory(不在 repo):`reference_tappay-refund-api-multiple-partial-and-overrefund` 補 ⑤ 段、
  frontmatter description 更新;`MEMORY.md` 對應行改寫。

**RW2b 追加(§3e)**

- 改:`packages/adapters/src/supabase/database.types.ts`(A5a 重 gen + 十處手動校正重貼;`a55fc55`)
- 新:`apps/admin/src/lib/payment/composition.ts` / `composition.test.ts` / `composition-tappay-wiring.test.ts`
- 改:`apps/admin/src/app/orders/[id]/page.tsx`(`export const maxDuration = 60` + 論證註解)
- 改:`docs/handoff/2026-08-03-day-refund-wire.md`(本檔 §3e/§5/§6)
- memory(不在 repo):新增 `reference_nextjs-public-env-static-read-inlined-at-build`;`MEMORY.md` 加一行。
