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
  → **已收工,見 §3e**(admin Vercel `TAPPAY_*` 已查證 = 未設定,見 §5)。

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

**R3 = Fable 換角度(主視窗派、fresh context 唯讀)= ✅ PASS,0 must-fix / 5 nit**

信箱往返 `pcm-mailbox/A-01-Q.md` ↔ `A-01-A.md`(2026-08-04 00:2x-00:5x)。我原本停在「R2=FAIL 全折入、
無第三輪確認」並把「要不要補一輪」交出去(plan §6 硬上限 2 輪 + 07-29「第 3 輪起換模型」同時指向停,
而 Fable 是明文留給白天 RW2c 的資源、我不自己動);**主視窗答 C 並已代跑**。R3 的關鍵驗證(逐字轉錄):

- **代理變數選得對**:親驗 admin 唯一寫庫管道 `createSupabaseServiceClient` 讀同一顆
  `NEXT_PUBLIC_SUPABASE_URL`、**同機制**(`packages/adapters/src/supabase/client.ts:24-26,60-63`),全樹無第二變體。
- **URL 正規化邊界**:R3 自己 Node 實測 8 種(`%2E` 編碼 / userinfo / 雙尾點 / 大小寫混合 / IPv6 …),全被守門抓住。
- **災難當天可用性**:守門無 env 逃生閥;false positive 最便宜的解 = 修 env 根因(繞過要改 code+deploy)。未擊破。
- **「三條不修、改宣稱」不是縮驗證面**:拿掉守門後 `mocks.ctor` 必被呼叫 = 那個觀察由守門獨佔供給、有判別力。

5 nit 處置:**N1/N2/N3/N5 已清**(見下);**N4 不清、轉成 RW2c 前置債**。

- N1 「fail-closed 十格」原本實數 9 ⇒ 補第 10 格(`http://.` 在 factory 層的端到端觀察,原本只有純函式層測得到)。
- N2 掃描根停在 `apps/admin/src` 卻宣稱「admin 全樹」⇒ 加掃 `apps/admin` **根層設定檔**
  (`next.config.ts`/`vercel.json`/`postcss.config.mjs`;刻意非遞迴,遞迴會爬進 `node_modules`)。
- N3 單行雙 import 可騙過行尾錨定的來源計數 ⇒ 加一格「composition 的 **import 來源集合**恰為
  `{server-only, @pcm/adapters/server}`」—— 與排版無關,一次封掉整族「自建第二份正確值」的繞法。
- N5 `TAPPAY_ENV` 比對前 `.trim()`(Vercel dashboard 貼值常帶尾隨空白;方向仍 fail-closed,救的是摩擦)。

**🔴 RW2c 前置債(Fable R3 N4,本片刻意不修)**

> `getTapPayAdapter()` 拋的是**裸 `Error`** ⇒ 「設定錯(要找 Sean 補 env)」與「transient 失敗
> (可重試)」在 action 眼裡同形狀,會誘導 RW2c 把前者呈現成「退款失敗請重試」——
> 而那是值班按到天亮也不會好的一類。**RW2c 開工片要給具名 error class 或訊息前綴碼分流。**

**驗證(數字皆為實跑輸出)**

- 三綠:typecheck **8/8**、lint **10/10**、admin build 綠、scripts tsconfig 綠;
  完整 vitest **304 檔 3869 passed + 1 todo**(RW2a 收工時為 302/3840;本樹無 A9a-2 ⇒ 與 dev 上的數字有差,主視窗已調和)。
- **突變 30 格、逐格轉紅、還原後全綠**(腳本留在 scratchpad、不入 repo)。涵蓋:配對兩方向各自失守 /
  拿掉 throw / 斷言搬到建構後 / `hostname`→`host` / 尾點 FQDN 後門 / 協定 allowlist / 剝點後空 host 與
  **檢查順序** / PROD host 改成別的 ref / 靜態 env 讀法回歸 / partnerKey↔merchantId 對調 / 空字串 env /
  端點改 inline 字面 / admin 自建 endpoints 複本(值對調)+ 幌子 import 放整行註解與行尾註解 /
  別的 admin 檔用 alias import·bracket·解構·大寫端點·`*.test.ts` 命名規避 / `maxDuration` 降值與註解掉。
- 🔴 **誠實邊界**:本片**零真環境驗證**(沒打過 TapPay、沒連過 Supabase);`getTapPayAdapter()`
  **全 repo 零呼叫端** ⇒ 對 27 項驗收貢獻 **0**。

## 3f. RW2c 收工(08-04 深夜;refund-wire 視窗、Fable+xhigh;commit `d5da676`)

**產物**(細節=commit body;`apps/admin/src/lib/payment/` 五新檔+五測試檔):
`initiateRefundAction`(Q4=B 全額+部分一次做)+ 純解析器 + G0 baseline 檢查 +
兩支 owner RPC repository(判別聯合封互斥)+ N4 債已還(`TapPayConfigError`)+
database.types 五處 `| null`(計數 10→15)+ domain JSDoc probe 實證更新(§5 那條債已還)+
result-banner `refund_submitted` + wiring `TAPPAY_` 掃描改 case-sensitive(理由見 commit)。

**設計要點**:①unknown-state(含 resolve 出非三態)一律不 finalize、列留 processing;
②token 三去向集中 `FRESH_TOKEN_CODES`(deferred/rejected/not_sent 換新鍵=S4 已消耗;
其餘原樣帶回=G4 重播可認);③`REFUND_UI_ENABLED` 由 **action 端**驗(恰 `'1'` 才開、預設 off)
——RW2d 的按鈕只是同一旗標的顯示面;④DUPLICATE processing **不重打** refund()(wire 發過
沒有無從得知,交 S5+RW4)。

**審查**:關卡2 雙線不降級 —— code-reviewer(opus)R1 FAIL 4MF+5m / codex `gpt-5.6-sol`
R1 FAIL 2MF+2nit(**裸 else 第四態 fail-open 兩線同抓**=若未修,合約漂移時會 finalize 成
rejected+換新 token=雙退窗)→ 全折 → R2 雙線 PASS、nit 全清、codex 兩輪零留痕已比對。

**三綠**:typecheck 8/8+scripts 綠 / lint 10/10 / admin build 綠 / 全套 vitest 312 檔
4046 passed+1 todo。

**🔴 RW2d 前置(給主視窗/Sean)**:①admin Vercel `TAPPAY_*` 三顆仍未設(§5;Sean 動作)
②dev 驗證要 `REFUND_UI_ENABLED=1`(env、不入 repo)③RW2d 表單契約債:切到全額退必清空金額欄
(解析器 fail-closed 拒「full 帶金額」)、token 用 `state.requestToken ?? generateRefundRequestToken()`、
欄位名/常數從 `refund-action-state.ts` import。
**誠實邊界**:action 零呼叫端、零真環境驗證,對 27 項驗收貢獻仍為 0;sandbox 真退=RW2d。

## 3g. RW2d 收工(08-04;refund-wire 視窗、Fable+xhigh)

**產物(repo)**:退款入口 UI 全鏈接上 —— `refund-ui-flag.ts`(新;旗標單一判準,action 閘與顯示面
讀同一函式)/ `refund-section.tsx`(新 client 表單:kind radio+部分金額欄+確認碼+單行原因)
/ `order-detail.tsx` 掛載(顯示閘=旗標 && paymentChannel='tappay' && {paid,partiallyRefunded})
/ `page.tsx` 下傳 `isRefundUiEnabled()` / 測試三檔(section 12 格+refund-wiring 8 格+procurement-wiring 補 mock)。

**設計要點**:
1. RW2c 三條表單契約債全還:①「full 不帶 amount」用**不渲染**實作(FormData 結構上無鍵;
   autofill/表單還原無欄可塞)②token 兩態=失敗 state 那把 > serverToken(**無任何 client
   產鍵路徑**;初版曾有 bfcache 重產、被 codex MF1 打掉,見要點 4)③欄位名/常數全 import 零字面。
2. 退款原因用**單行 input** 非 textarea:解析器與 RPC 都拒控制字元(含換行)——textarea 按
   Enter = 保證 invalid 的形狀,結構上不給輸入。
3. `refund-ui-flag.ts` **刻意不掛 server-only**(檔頭論證):旗標非機密、client 誤用=恆 false=
   fail-closed;掛了會讓 jsdom 頁層測試(含既有 procurement-wiring)整族解析失敗。
4. 🔴🔴 **bfcache 絕不 client 換鍵**(codex R1 MF1,推翻我抄備註片的初版):退款的重送保護
   **就是**舊 token 撞 G4(同指紋=DUPLICATE 誠實回報、變指紋=RAISE 叫他重新整理,皆零動錢);
   換新鍵=舊表單變全新請求=餘額夠就真雙退。改 pageshow persisted → `router.refresh()`
   (procurement 同慣例;順帶把「狀態過期」窗口縮掉),新鍵唯一來源=server 渲染。
   備註片的換鍵**不必跟改**(備註無雙退面,其換鍵防的是 C9 內容不符;兩檔檔頭已互寫指標)。
   ⚠️ token 不是唯一防線、別這樣轉述(opus R2 措辭訂正):員工 F5 後手動重打=合法新請求,
   真正擋第二次的是 S5 單單一 processing + 步 5 refunded/LEDGER_FULL;換鍵移除關掉的是
   「舊表單**靜默**變全新請求」那條。
5. pending 全鎖 `<fieldset disabled>`(codex R1 MF2):送出後 FormData 已被捕捉在跑,
   欄位再可編輯=「眼前值」與「正在動的錢」分岔(看著 500、實退 100)。

**sandbox E2E(Sean 放行:≤6 元、恰全額+部分兩發)——兩發都跑了、全鏈綠**:
- 基建:本機**無 docker** ⇒ 「local supabase」以 **PG17(port 54332,RW1b provision 邏輯:
  initdb+shim+全套 migrations+d1t2 seed)+ brew PostgREST 14.16(54333)+ /rest/v1 前綴剝除
  proxy(54334)** 等效實現;admin dev server 送出(Origin localhost 需 ADMIN_DEV_BYPASS;
  production build 的 Origin 白名單只收正式網域=設計)。session cookie 以同 HMAC 規格自鑄、
  actor=staff seed `sean`。憑證 grep 單顆取自 `.env.tappay-sandbox`,不 source、不印值。
- 環境配對:TAPPAY_ENV=sandbox × 帳本 127.0.0.1(非正式 host)⇒ 放行;機制斷言在
  `getTapPayAdapter()` 每次送出都跑(RW2b 產物)。
- **第 1 發(全額)**:新建 sandbox AUTH 交易 `D20260804iWNwcM`(2 元,probe2 charge 模式)
  綁 fixture 單 PCM-2026-0001 → UI 送出 → PRG `?r=refund_submitted` banner ✅ →
  帳本列 `full/confirmed/2`、wire refund_id 有、actor=sean、稽核 2 筆 → TapPay Record
  `amount 2→0、record_status→3`。⚠️ orders 翻成 `partiallyRefunded` 非 `refunded` =
  **fixture 假象非 bug**:G8 判準=SUM(confirmed) ≥ orders.total(migration `:812`),
  fixture 訂單 total≠2 元交易額;正式流 charge=total 不會分岔。
- **第 2 發(部分)**:T2 `D202608034SFpuL`(已請款、剩 5)綁 PCM-2026-0002 → UI 部分退 1 →
  banner ✅ → 帳本列 `partial/confirmed/1`、`record_refunded_before=1`(G0 baseline 正確吃到
  T2 既有 1 元)→ TapPay `refunded_amount 1→2、amount 5→4`。
- **加碼(零動錢)**:注入已消耗鍵重放同指紋 → G4 `DUPLICATE_REQUEST`(confirmed)→ 視同成功
  redirect、帳本 count 不變 —— DUPLICATE 路第一次有真 E2E 證據。
- 動錢合計 **3 元、恰兩發**;E2E 腳本/截圖/porcelain 留 scratchpad(`rw2d-e2e/`),不入 repo。
- ⚠️ 誠實邊界(opus R2):兩發跑在**審查折入前**;折入後動到送出路徑的是 fieldset,
  由 [3]/[4] FormData 完整性測試+390 真機版面覆蓋,**未**再燒錢重跑(額度=恰兩發)。

**真機(production build,`next start`)**:1440 與 390 截圖皆正常(紅框危險區、欄位堆疊);
kind 切換互動實測(部分→金額欄現、全額→消失)。`__Host-` cookie 在 localhost 可設,登入閘真跑。

**審查(關卡2 雙線不降級)**:
- code-reviewer(opus)R1 = **FAIL 1 must-fix + 9 nit**,全折:MF1=頁層 token/order_id 斷言
  撈到**備註表單**的同名欄位(DOM 排前)=假綠 ⇒ 改錨定 kind radio 所在 form + 補「兩次 render
  換鍵」格(m15 突變閉環)。nit:N1 bfcache 黏住(初版修法後被 codex MF1 汰換)/N3 state 檔
  過期字面(修)/N4 型別釘 enum/N5 channel 顯示閘/N6 缺格(補 `[7b]` disabled 回填+頁層
  換鍵格;Math.random fallback 格隨換鍵機制整個移除而不再適用)/N7 confirm 欄
  autoCapitalize/N8 行號 530-532/N9 order-detail >300 警戒(理由見 commit body)。
  N2(成功 redirect 後失敗 state 殘留)= **真瀏覽器驗證不發生**:redirect 導航後元件重掛,
  無 alert 殘留、token 全新、kind 重置(上面 DUPLICATE 加碼那發同時就是這個實驗)。
  ⚠️ opus R1 的 N1 修法(seenServerToken 機制)後被 codex MF1 整個汰換 —— 見下。
- codex `gpt-5.6-sol` R1 = **FAIL 2 must-fix + 3 nit**,全折(第 1 輪跑到 10 分鐘牆被砍、
  零留痕已比對;第 2 輪背景跑完 ~25 分、費 25 萬 tokens、九檔雜湊鎖定審):
  **MF1=bfcache client 換鍵是雙退窗**(設計要點 4;兩個 reviewer 對同一段 code 一個給 nit
  一個抓到本質 —— 換模型換角度的實錘再 +1);**MF2=pending 欄位可編輯**(設計要點 5);
  nit=action 檔過期字面(修)/旗標單一判準無結構 oracle(補格+突變 m16)/pre-hydration
  宣稱過強(軟化為「未實測」)。R2 雙線窄複審:見下行補記。
- **R2 雙線窄複審**:opus(續 context)= 程式碼面 **0 must-fix**、R1+codex 兩 MF 全數確認折入,
  獨立重跑全套 vitest 326/4316 吻合;唯一 must-fix=handoff 一行過期字面(token 鏈仍寫 bfcache
  重產)+5 文字面 nit —— 全清(本檔本節即成品)。codex R2 = **PASS**(5 項皆已解、
  refresh 空窗重送安全性它自己對過 migration G4 三出口、零新 must-fix;2 nit 與 opus 重疊、已清)。
  雙輪 codex 前後 porcelain 零留痕已比對。
- note-compose-form 的 bfcacheToken 黏住(opus N1 同型)——別片的檔,登記不修;其「換鍵」
  設計本身**不必**跟著退款改(上面設計要點 4 末句的論證)。

**驗證數字(實跑,折入後末輪)**:typecheck 8/8+scripts tsc 綠 / lint 10/10 / admin build 綠 /
全套 vitest **326 檔 4316 passed + 1 todo** / **突變 16 格逐格轉紅、還原位元一致**(腳本留 scratchpad)/
fieldset 版面 390 真機再驗零變化。

**殘項/邊界**:①`REFUND_UI_ENABLED` 仍不得開 —— 開啟前置=RW4 收工 且 部分退 E2E 綠;
部分退 E2E 本片已綠,**RW4 未動** ⇒ 前置只剩一半;旗標未進任何會部署的設定(全 repo grep
只在 code/test/docs)。②~~admin Vercel `TAPPAY_*` 三顆仍未設~~ **已設**(Sean 08-04 04:1x 補
Preview+Production 三顆,主視窗 CLI read-back;A-05-A 更正,§5 該行同過時)。③E2E 基建
非 docker supabase stack(誠實邊界如上);PostgREST 版本(14.16)≠ Supabase 雲端版,錯誤碼
映射同層但未逐版比對。④無 JS(hydration 前)送出=只做得了全額、server 閘全數照常,未實測。
⑤送出中離站再 bfcache 還原,若 isPending 被還原成 true ⇒ fieldset 恆鎖到手動重新整理
(opus R2 登記、未實測;方向 fail-closed,`router.refresh()` 不重置 client state)。

## 3h. RW3 收工(08-04;refund-wire 視窗、Fable+xhigh;A-05-A 指派續行)

**產物(repo)**:退款帳本「看得見」的三件套 ——
`refund-ledger-view.ts`(純層:狀態/失敗碼字面、`isRefundException`、30 分常數單一真相)/
`refund-read.ts`(三讀:單訂單帳本列、帳本未登記額=走 DB 函式 `pcm_order_refundable_remaining`
不在 app 重算、異常清單=plan §4-1 判準)/ 訂單頁 `refund-ledger-section.tsx`(deferred/rejected
結果持久可見;processing 異常列帶 ⚠ 連結)/ `/orders/refund-exceptions` 清單頁(RW4 前置 UI、
刻意零操作按鈕)/ sidebar「退款異常」入口 / 測試五檔+兩支 wiring 補格。

**設計要點**:
1. 🔴 措辭鐵律(關卡1 F25)機制化:UI 只稱「**帳本未登記額**」;負向格(元件+頁)+
   **全域措辭 oracle**(剝註解掃 admin src,「還能退/剩餘可退」只准 refund-section 的
   TapPay 端字串)+ 突變 n01/n12 閉環。
2. 帳本顯示**不吃**退款入口旗標:帳本列是既成事實,processing 滯留列藏起來=值班盲區;
   讀失敗不靜默(區塊顯「勿在此期間發起退款」、頁層獨立容錯)。
3. 異常判準兩處共用一個常數與一份 predicate 語意(DB 查詢 or() ↔ 列級 isRefundException);
   evidence 非空=G7-hold 不等 30 分(fable N4)。
4. 投影紀律:rec_trade_id/request_id/bank_refund_id/tappay_refund_id/confirmed_at 全不進
   顯示查詢(零消費欄不留、RW4 對帳另開專用讀)。

**真機(prod build+local 真 PostgREST)**:E2E 基建重啟(PG17 54332+PostgREST 14.16+shim),
用守門**允許**的 evidence write-once UPDATE 造 G7-hold 列(`created_at` 回填被 INSERT 守門
`:275` 強制 now() 蓋掉=設計如此,**30 分滯留顯示路徑僅單測覆蓋**=誠實邊界)——
訂單頁帳本區(未登記額 997=1000−3 ✔、⚠ 異常連結)、異常清單頁 1440/390(真 display_id=
embed 回物件、`or()` 整串被真 PostgREST 接受 —— 命中的是 evidence 那支;**ISO 支=parse
通過而已,命中語意見殘項③**,opus R2 口徑訂正)、sidebar 入口,截圖 scratchpad
`rw2d-e2e/rw3-*.png`。仍註:PostgREST 14.16 ≠ Supabase 雲端版。

**審查(關卡2 雙線不降級)**:
- code-reviewer(opus)R1 = **FAIL 1 must-fix + 9 nit** 全折:MF=異常查詢押三個未驗 PostgREST
  語法賭注(embed 空格已刪對齊 house 字面;or()/ISO 其實已被上述真機段實證,審查時 handoff
  未載=我方紀錄債)。nit:恆真 '123' 撞號修 777 / 零消費欄剔除 / 第三個 30 改常數推導 /
  措辭全域 oracle / Object.hasOwn(原型鏈同型事故)/ 353 行警戒入 commit body。
- opus R2 = **PASS 0MF**(逐條核折入、獨立重放 oracle 判別力、自跑 vitest 吻合;1 新 nit=
  本檔口徑半格已收斂)。
- codex `gpt-5.6-sol` R1 = **FAIL 6 must-fix + 5 nit**,全折:
  **MF1=「無 .limit=誠實無截斷」被事實推翻**(Supabase PostgREST `max-rows=1000` 靜默截斷
  —— opus R1 判「可留」、codex 拿平台事實打掉,換模型的價值再 +1)⇒ 兩讀改
  {rows, truncated}(N+1 判斷、上限 100/200)、兩頁截斷警示;**MF2=讀失敗不 fail-closed**
  ⇒ page 雙旗標、發起入口閘加 `!refundsFailed && !refundUnregisteredFailed`、未登記額四態
  (讀失敗=紅色態≠查無);**MF3=未登記額可為負**(帳本登記可超過訂單總額)⇒ 負值顯
  「對帳異常」紅色態不當普通金額;MF4=mock 不裁切投影 ⇒ REQUIRED_COLUMNS 10 欄正向釘死;
  MF5=wiring 未斷言參數(A 單顯 B 單帳本抓不到)⇒ 補;MF6=exceptions repo 層 error 格 ⇒ 補。
  nit:oracle 繞法誠實邊界註記(攔回歸不攔對手)/恰 30 分邊界格/app 時鐘 vs DB now() 註解/
  0 值格(`||` 回歸防護)。
- **第二輪雙線**:opus R2b = PASS(0MF+3nit:負值也要關入口/REQUIRED_COLUMNS 子字串恆真
  兩欄/零列×失敗不變式註記);codex R2 = FAIL(2)(**與 opus 完全收斂**:同抓子字串恆真+
  負值入口)→ 三修全折(tokens 精確比對/入口閘加負值條件+wiring 格+突變 n19/不變式註記)
  → **codex R3 = PASS**(逐條實核、含「拿掉 id/reason 必紅」判別力自驗、零新副作用)。
  三輪 codex porcelain 零留痕皆比對。

**驗證數字(實跑,全折入後末輪)**:tc 8/8+scripts / lint 10/10 / build 綠 /
vitest **331 檔 4398+1 todo** / **RW3 突變 19 格逐格轉紅+還原位元一致**(rw3-mutations.py)。

**殘項/邊界**:①措辭相鄰面=帳本區顯數字、退款表單寫「不得超過剩餘可退額」不帶數字 ——
值班可能拿前者當後者上界;免責句已緩解,**進 Sean 肉眼定稿題**。②~~無 .limit=誠實無截斷~~
**已推翻**(codex MF1):顯式上限 100/200+truncated 旗標+兩頁警示。③30 分滯留的**顯示**
路徑無真機證據(created_at 不可回填=稽核設計);單測+突變覆蓋。④RW4 仍缺:人工結案
RPC(manual_failed/recovered_confirmed)+清單頁操作;本片刻意零按鈕。⑤負值未登記額顯示
為對帳異常=**顯示層**;負值的根因(超額登記)DB 不擋=拍板⑤既有邊界,RW4 對帳收。

## 3i. RW4 收工(08-04;refund-wire 視窗、Fable+xhigh;A-07-A 指派續行)

**內容(plan §1 RW4 列 + §4-1;純 app 層、零 migration)**:

- 判定碼表 `refund-judgment.ts`(純函式、**七碼**、每碼一正一負):delta=0 且無證據→not_executed(開「標記失敗」)/ delta=登記額且無其他在途→executed(開 Portal 真碼恢復)/ **delta=0 但有受理證據→evidence_contradiction(停+純人工;opus M1 折入)** / delta_mismatch、other_in_flight、record_shape_bad、record_state_bad=停+告警。判定式=S2 欄 COMMENT 逐字(`20260803150000:177`)。
- 🔴 判定 allowlist={0,1,2,3} 與 G0 {0,1,2} **刻意分岔**:3=REFUNDED 是全額退到底的正常終點,擋掉=卡列永遠結不了案(兩檔檔頭互註;E2E 真列實吃 3)。
- 兩支 action(`refund-recovery-actions.ts`):judge(唯讀,回讀數+RF8 結論)/ resolve(**送出當下重判**、不信畫面舊判定);閘序=便宜先跑(opus R2 N3):授權→解析→帳本重讀+入口鏡像(30 分或證據;created_at 不可解析=擋)→確認碼(mark;訂單號末 4 碼、大小寫不敏感、server 驗=opus C3/N1)/證據 P7C13 鏡像(recover)→Record 重判→判定閘→finalize。
- 恢復流程**不吃**退款發起旗標(死巷防止;閘=authorize+入口鏡像+三閘+RPC 5b/G5)。judge 無 server 節流=已知邊界(檔頭明記)。
- finalize 出口收斂四分流:RAISE→rejected(確定回滾)/ **回應解析失敗→`RefundFinalizeParseError` 子型別→finalize_unknown(codex R2 MF:交易已 commit、「沒寫入」會是假話)** / **23 類 SQLSTATE→rejected(必回滾=確定零寫入;E2E 實錘 23505=抄錯 Portal 編號撞 `tappay_refund_id` UNIQUE)** / 其他→finalize_unknown(codex R1 MF:「結果不明、可能已完成」,不宣稱沒完成)。statusAfter 語意斷言(manual_failed 必回 failed)。
- `finalizeRecoveryOrderRefund`(refund-repository;恢復判別聯合與同步四碼分型、型別層互斥)+ `refund-recovery-read.ts`(對帳窄讀:rec/baseline/證據/母單編號 embed+兄弟列三讀數;**非終態反面計數**=opus C4、超 500=IntegrityError 停手)。
- 清單頁每列掛 `refund-exception-resolve.tsx`;結案按鈕只在對應判定成立後渲染;**finalize_unknown 凍結整格**(舊判定+按鈕全消失、只剩告警);PRG 兩碼進 result-banner(受影響頁面數 6→7 同步=opus M2)。
- RF8 併 refundId 存在性:judge 回 ledgerConfirmedSum+confirmedMissingRefundId(>0=紅色告警)+**ledgerMatchesRecord(期望和含本列=opus C1;讀數不可信→不下結論)**。

**審查鏈(關卡2 雙線不降級;全程 porcelain 零留痕比對)**:

- opus R1=FAIL(2MF+4C+4nit):M1 evidence 矛盾零鏡像=二退窗 / M2 banner 爆炸半徑 6→7 / C1 RF8 假警報方向相反 / C2 交叉負測缺 / C3 標記失敗一鍵零摩擦 / C4 在途計數白名單 fail-open / 4 nit。
- codex R1=FAIL(1MF+3nit):MF=finalize 途中斷線被說成「沒有完成可再試」。
- 全折 → **opus R2=PASS(0MF+4nit)**:R1 九項逐條 CLOSED、23 類 pre-commit 保證獨立證明(非 DEFERRABLE UNIQUE+RPC 無 EXCEPTION handler);N4=判定依賴 Record 即時性(plan 已拍板前提、列給 Sean 知情)。
- **codex R2=FAIL(1MF+2nit)**:🔴 MF=`RefundCallerBugError` 混型 —— RAISE(確定回滾)與「交易成功後回應解析失敗(其實已寫入)」共用型別,後者被說成「沒寫入」=字面與事實相反 → 子型別分流修。
- 全折 → **codex R3=PASS(0MF+1nit 測試補斷言,已折)**。駁回 0;唯一互駁點=23 類映射,codex 質疑、opus 獨立證成立、codex R3 收口。

**驗證(末輪全折後)**:tc 8/8+scripts / lint 10/10 / admin build 綠;vitest 336 檔 **4487 passed + 1 todo**;突變 **32/32 轉紅+還原位元一致**(`rw4-mutations.py`:M1 矛盾閘/C3 確認碼(含大小寫)/C4 計數/C1 期望和/MF 降級/23 類/Parse 分流/凍結/交叉閘/兩格 oracle 防禦)。

**真機 E2E(local PG17+PostgREST 14.16+proxy+真 sandbox Record;零新退款、只打唯讀 Record 查詢;修後全鏈重跑)**:

1. evidence_contradiction:證據列+delta 0 → 矛盾訊息+零結案按鈕(M1 閘真機生效)✅
2. recover:executed+RF8 不一致告警同畫面(構造數據刻意不一致=C1 告警路實吃)→ 結案 confirmed+audit recovered_confirmed ✅;**中途實錘 23505**(借用已入帳 DR 碼撞 UNIQUE)→ 由此折入 23 類精準映射
3. mark_failed(滯留 30 分無證據列;**時間軸入口這次有真機證據**,補 §3h 殘項③):錯確認碼→confirm_mismatch 零寫入→對碼→PRG+failed+manual_failed detail 兩讀數+audit ✅
4. denied 真機路(session cookie 掉時 judge 回 denied)✅ 順帶實吃
   修前三鏈(含真碼 `DR20260803gvcV5i` recover、390 全鏈)紀錄仍在;**修後行為為準**(修前 mark_failed 走的 evidence 列在修後=矛盾列、不再開按鈕)。截圖 rw4-\*.png(scratchpad rw2d-e2e/)。收案後帳本零 processing 殘留、基建已拆(資料留 /tmp/rw2d)。

**殘項/邊界(誠實)**:①390 判定面板在表格橫向捲動容器內,讀數要橫捲才看得全 —— 進 Sean 肉眼定稿題;修後確認碼欄無 390 截圖(樣式與 DR 欄同款;修前 390 全鏈截圖在)。②not_exception_yet 的 UI 態無 E2E(單測+突變覆蓋;RPC 5b 同擋)。③E2E 走 dev server(prod origin allowlist 擋 server action=RW2d 同界);production build 綠、無 prod 截圖。④🔓 **旗標開啟前置(RW4 收工 且 部分退 E2E 綠)至此雙半皆備**;開旗標=部署 env=Sean 拍板+動作,A-07-A 明示「旗標繼續不開」→ 未動。⑤hold 列金額不符(真 G7-hold)→ delta_mismatch 純人工=刻意(登記額≠實退額時機器結案兩個方向都寫錯帳)。⑥opus N4:「delta=0 ⇒ 零動錢」依賴 Record 即時反映(sandbox 實測支持;正式站若有延遲窗,無證據崩潰列可能被判 not_executed)=plan 已拍板前提,列給 Sean 知情。⑦opus 未確認項:自架 PostgREST 若 max-rows<501 會讓兄弟列截斷守門恆真;Supabase 預設 1000(RW3 codex MF1 同源事實)、成立。

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
- ~~admin Vercel 的 `TAPPAY_*` env 未查證~~ **已查證 = 未設定**(2026-08-04 主視窗用 Vercel CLI 唯讀實查
  `pcm-admin` 專案 env 全清單 6 筆:`ADMIN_E10_ORDER_NUMBER_SEARCH` / `SUPABASE_SERVICE_ROLE_KEY` /
  `NEXT_PUBLIC_SUPABASE_URL` / `PCM_SSO_EXCHANGE_SECRET` / `PCM_QUOTE_SSO_BASE` / `ADMIN_SESSION_SECRET`,
  **`TAPPAY_*` 零筆**)。⇒ 補值是 **Sean 的動作**(或 Sean 授權 CLI 加),死線 = RW2d 開工前。
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

**RW2d 追加(§3g)**

- 新:`apps/admin/src/lib/payment/refund-ui-flag.ts` / `apps/admin/src/components/orders/refund-section.tsx`(+`.test.tsx`)/ `apps/admin/src/app/orders/[id]/refund-wiring.test.tsx`
- 改:`refund-actions.ts`(旗標抽 import+字面訂正)/ `refund-action-state.ts`(註解訂正)/
  `order-detail.tsx`(掛載+顯示閘)/ `page.tsx`(旗標下傳)/ `procurement-wiring.test.tsx`(補 mock)/
  `note-compose-form.tsx`(換鍵設計反向指標註解)/ 本檔 §3g
