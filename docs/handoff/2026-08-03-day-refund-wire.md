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
  🟡 admin Vercel `TAPPAY_*` env 未查證(Sean dashboard;不擋 dev 實作)。

## 4. 🟡 今晚殘項(單視窗持有、不掛 cron;素材 T2=`D202608034SFpuL`)

T2 今日 11:10 建立(AUTH)→ 依中信批次今晚 18:00 送批、約 20:00 可確認請款。請款後兩發:

```bash
cd /Users/sean_1/pcm-refund-wire
python3 scripts/tappay-sandbox-refund-probe2.py query D202608034SFpuL
python3 scripts/tappay-sandbox-refund-probe2.py refund D202608034SFpuL 1 pcm-p3-20260803
python3 scripts/tappay-sandbox-refund-probe2.py refund D202608034SFpuL 1 pcm-night-fresh1
```

- 第 1 發前置:`is_captured=True` 才繼續(False=還沒請款,晚點再來)。
- 第 2 發(消耗鍵 `pcm-p3-20260803`)預測:**`6002` 恆久**;若 `status=0` = 鍵註冊會隨請款重置
  ⇒ 比預期嚴重(at-most-once 防線有 TTL),要回頭改 §2.3b 結論 5 並 raise。
- 第 3 發(新鍵)預測:`status=0`、`refund_amount=1` ⇒ 補完「deferred→請款→換鍵重試」正向鏈。

## 5. 沒做什麼(誠實邊界)

- **零實作 code**:`apps/admin`、`packages/*` 一行未動;RW1-RW4 全部未動工、等 Sean 拍板。
- probe 的併發結論是 **n=1 單次取樣**;「已請款後的部分退併發」未測(今晚 T2 請款後若 Sean 要可加測,非必要)。
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
