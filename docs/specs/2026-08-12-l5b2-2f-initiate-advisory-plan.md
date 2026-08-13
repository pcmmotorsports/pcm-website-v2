# L5b-2 片 **2f** — `admin_initiate_order_refund` 加入序列化點與跨帳本否決 · 片級 plan **v9**

> **v2** = 折完 **R1 codex**(10 MF + 10 IMP,FAIL)——§14。
> **v3** = 折完 **R2 Opus**(7 MF + 7 IMP + 4 nit,FAIL)——§15。
> **v4** = 折完 **R3 Fable**(2 MF + 4 IMP + 2 consider + 2 nit,FAIL)——§16。**三輪三引擎。**
> **v5** = Sean 三題全回後**述詞定稿**(§16-1 走「維持 B」路)。
> **v6** = 折完 **diff 層 R1 codex**(9 MF + 18 IMP + 2 nit,FAIL)——§18。
>   **其中五處是守門「形狀」重做,不是字面修** —— 病根一句話:**「找得到這個字串」不是守門**。
> **v7** = 折完 **diff 層 R1 第二輪 codex**(12 MF + 18 IMP + 3 nit,FAIL)——§19。
>   病根一句話:**v6 的修法自己製造了同型的洞** —— 加一個否定詞 / 換一種寫法 / 改大小寫,
>   守門照樣綠(逐格盤點見 `docs/handoff/2026-08-12-2f-diffR1v6-fold-handover.md` §2 繞過測試表)。
>   v7 的形狀一律走「**全稱計數 + 絕對數 + 連著左鄰形式一起比**」,不再靠「找得到這個字串」。
> **v8** = 折完 **diff 層 R2(換模型輪,Opus fresh-context)**(4 MF + 10 IMP + 5 nit,FAIL)——§20。
>   這一輪帶了一條**換路裁決**(主視窗 `P-607-A`):P6-op 被 `NOT (...)` 繞過 = 同一道守門同型繞法第二次,
>   照 R4 不再補第三個運算子變體 ⇒ **承認結構斷言的能力邊界,把語意保證移到行為層**(§7-11)。
> **v9** = 折完 **diff 層 R3(換模型 Fable + 換角度:框架層)**(2 MF + 5 IMP + 3 nit,FAIL)——§21。
>   R3 逐字「**技術正確性層無新增**」⇒ 主視窗裁定**折完就收、不跑 R4**(判停依據是那一層榨乾了,不是輪數)。
>   兩條 MF 都在**災難當天的回退路徑**:①pooler 連線讓核准出口恆失效 ②canonical view 缺席時回退自己 42P01。
>   🔒 同輪落地 **§7-13 凍結裁決** —— 結構斷言電池停止加碼,這是本片最重要的一段。
> ✅ R3 正面確認:§3-2⑥ 的沿鏈排除**不漏擋**(本片唯一被審查者正面背書的設計)。
> ✅ diff 層 R1 正面確認:函式本體 150 行**逐字比對未見未申報差異**(機械切自原始檔的搬運乾淨)。
> 🏁 拍板全集:`Q-2f-1`=**10s** / `Q-2f-2`=**B 放行**(複判維持) / `Q-超退閘`=**做,獨立片排 2g 前**(#445,知情推翻拍板⑤)
>   / `Q-P591-1`=**A**(ACL 比對期望集合、含既有授權;**翻紅即停下寫信、不自行放行**——主視窗 `P-592-A`)。
> 🟡 **實作完成、本機臨時叢集實跑全綠**(v9 重跑:run **37/37** · rb 7/7 · **neg 51/51** · mut **25 靶 + M0** 見 §17);**未 apply、未 push**。
>   量法逐字(v7 起 workdir 由腳本自產,**不再吃第二個位置參數**):
>   `PORT=54763 scripts/l5b2-2f-verify.sh all`(印 `run 小計 PASS=37 FAIL=0`、
>   `rb 小計 PASS=44 FAIL=0` —— PASS 跨模式累計,rb 自己的格數 = 44−37 = 7、`teardown rc=0`)、
>   叢集另起後 `PORT=54763 scripts/l5b2-2f-verify.sh neg`(印 `neg 小計 PASS=51 FAIL=0`);兩者 `echo $?` 皆 0。
>   ⚠️ 全綠只涵蓋**這些格量得到的面**;§9 誠實邊界逐條仍然成立,沒有一條被這次全綠推翻。
> ⛔ apply = **Sean 停點**,由主視窗執行;本窗只交 commit。

> **migration = `20260812170000_m4b_lifecycle_l5b2_2f_initiate_advisory.sql`**(主視窗 `P-580-A` 發號,已驗空號)。
> 母 plan = `docs/specs/2026-08-10-l5b-2-compensation-writer-plan.md`(v8);本片 = §2 v5 片表 `:577`。
> 姊妹片 = **2e**(`20260812160000`,**已 apply 正式庫**)。**2e / 2f / 2g 成組**(母 plan `:718`)。
> 開工令 = `pcm-mailbox/P-578-A`。
>
> **內容分級**:不適用 L1/L2/L3(本片不產生任何對客內容;純 DB 函式行為)⇒ 按 **L1** 處理(改動頻率年 0-1 次)。
> **片型 = 🔴 高風險片**(鐵則 12 ①錢 + ③DB 結構與不可逆寫入路徑;動的是**已上線、正在退錢**的 SECDEF RPC)。
> **鐵則 8 = 命中**(動 API/schema 面)⇒ 本 plan 送 Sean 批准 + 關卡1 codex 對抗審查,批准才實作。
> **審查新制(`P-578-A`)**:diff 層 R1 = codex。

---

## §1 開工前置實查(全部附 `檔案:行號`,無一憑印象)

### 1-1 母 plan `:357-358` 指定的那條:`order_refunds.status` 值域 —— **已收**

| 項目 | 實查結果 | 來源 |
|---|---|---|
| 現行 CHECK | `CHECK (status IN ('processing','confirmed','failed','deferred'))` | `20260803150000:185-186` |
| **在途集合** | `{'processing'}` | 狀態機 `20260803150000:211`:**只有** `OLD.status='processing'` 能轉出 |
| **終局集合** | `{'confirmed','failed','deferred'}` | 同上 `:214` 訊息逐字「confirmed/failed/deferred 皆為終態」 |

🔴 **依據不是那條 CHECK**(它只管值域、不管誰能轉出),是**狀態機 trigger 函式**。
這三個字要**逐字寫進 2f 的 COMMENT**(母 plan `:358` 硬要求)。

⚠️ `deferred` 是**終局**(`20260803150000:183` 逐字「S6:status 加第四值 deferred(終態;10024=還不能做)」、
`:220` 逐字「重試=新列新鍵,不轉回 processing」)—— 與 2e §1-3 的實查結論一致,兩片同一份事實。

### 1-2 `P-578-A` 的兩條硬前置(我自己提的,本片兌現)

| # | 前置 | 值 / 實查 |
|---|---|---|
| ① | preflight 釘 **2e 的 post-image** | `f4e3aa5b5afb9e886b0b2820a4c4b34b`(正式庫 apply 後 NOTICE 逐字,`P-578-A` §1) |
| ② | **不得照抄 2e 的 `search_path = ''`** | ② 的 SET 子句實查 = `SET search_path = public, pg_temp`(`20260803150000:436`) |

②的理由:2e 的 `''` 是它自己那支的既有設定;兩支 `proconfig` **本來就不同**,
`CREATE OR REPLACE` **省略 SET 子句會把 proconfig 打成 NULL**(2e §5 實測)⇒ 抄錯 = 靜默改掉 search_path 解析。

### 1-3 ② 的現況屬性(`CREATE OR REPLACE` 保留清單的量測基準)

| 屬性 | 現況 | 來源 |
|---|---|---|
| 簽章 | `(uuid, text, integer, bigint, bigint, text, text, text)` | `20260803150000:423-432` |
| 回傳 | `jsonb` | `:433` |
| 語言 / secdef | `plpgsql` / `SECURITY DEFINER` | `:434-435` |
| `proconfig` | `search_path=public, pg_temp`(**無 `lock_timeout`**) | `:436` |
| `proacl` | `REVOKE ALL FROM PUBLIC, anon, authenticated` + `GRANT EXECUTE TO service_role` | `:816-819` |
| owner | `postgres` | migration 執行身分 |
| pre-image `prosrc` md5 | `f98e25f58dde8306772e157f0c7cc5cb`(7006 字元) | 母 plan §1 當日對正式庫量 ⇒ **實作時要再量一次對帳** |

🔴 **1-3a 母 plan §3a-10 的「員工可見」揭露對本片是 _真的_**(與 2e 相反)
2e 的 grantee 只有 owner/postgres(受控人工流程);**②的 grantee 有 `service_role`** ⇒ 它就是後台應用層走的那條路。
`service_role` 的 `lock_timeout` 現況 = **未設**(無 role 層 `ALTER ROLE ... SET lock_timeout`)⇒ 本片加 3s **不是死碼**,
是**對員工可見的行為改變**:原本「等一下就成功」的正常競爭,現在可能直接失敗。**必須在 apply 停點對 Sean 講一句話**(§10 Q1)。

### 1-4 🔴 本輪最重要的實查:**`REFUND_IN_FLIGHT` 已經存在,`order_refunds` 那半已經有 DB 權威在擋**

母 plan `:330` 寫「在 `order_refunds` 或 `payment_refunds` **任一本**有在途 ⇒ 不開新的」,像是兩半都要新做。**實查不是**:

- 回傳碼 `REFUND_IN_FLIGHT` 早在 8 碼全集內(`20260803150000:416`)。
- 現行來源 = **步 8 INSERT 撞唯一索引** `order_refunds_single_processing_per_order`
  (索引定義 `:197-198`,`ON (order_id) WHERE status='processing'`;收斂點 `:558-560` 逐字)。

⇒ **2f 真正新增的只有 `payment_refunds` 那半。** `order_refunds` 那半**不動**(它已經由索引擋住,
再加一道「查 order_refunds 有沒有 processing」= 被唯一索引嚴格蘊含的守門 = 寫不出只紅它的負測,
正是 memory `feedback_unconstructible-negative-test-means-noop-guard` 那族,**不做**)。

---

## §2 現況本體與新順序(**寫錨之前先開本體**;母 plan `:318` 自陳這條已犯過兩次,我不再犯第三次)

**現行九步(`20260803150000:450-590`,逐行開過)**

```
1 輸入衛生(RAISE)              :450-469
2 kind/金額互斥(RAISE)          :471-497
3 鎖訂單 FOR NO KEY UPDATE       :499-508
4 冪等查驗 G4                    :510-524
5 業務前置 G12/白名單/卡交易     :526-535
6 full 的 NOTHING_LEFT           :537-540
7 產 bank_refund_id              :542-545
8 單列 INSERT(+ 例外收斂)       :547-574
9 稽核 audit                     :576-590
```

**2f 後的順序(v3;B 的位置已依 R2 MF-E 後移,見 §3-2a)**

```
1 輸入衛生 → 2 kind/金額互斥 → 🆕 A. 取 advisory → 3 鎖訂單 → 4 冪等查驗 G4
  → 5 業務前置 → 6 NOTHING_LEFT → 🆕 B. 跨帳本否決 → 7 產鍵 → 8 INSERT → 9 稽核
```

> ⚠️ 母 plan `:292` 的**圖示**把 B 畫在步 5 之前;它**綁定的約束**(`:290`)只有「晚於 G4」與「早於動錢」。
> v3 取圖示與約束不一致時**以約束為準**,並把差異列進 §11 偏-4。

兩個插入點各有各的**硬約束**,不能綁成一句(母 plan `:283-294`):

| 動作 | 位置 | 為什麼**必須**在那裡 |
|---|---|---|
| **A. 取 advisory** | 步 2 之後、**步 3 之前** | ①它**不拒絕任何請求**,只排隊 ⇒ 提前取**不改變任何回傳碼** ②必須早於步 3,否則就是「持 `orders` 列鎖等 advisory」× ③ 的「持 advisory 等 `orders`」= **AB-BA 40P01 重生** |
| **B. 跨帳本否決** | **步 6 之後、步 7 之前** | 下界:必須晚於 G4(否則合法重播會從 `DUPLICATE_REQUEST` 變成被拒 = 改既有語意)。上界:必須早於步 8 的 INSERT(唯一的寫入)。**在這個區間內取最後一格** ⇒ 四個具體業務診斷優先於籠統的 `REFUND_IN_FLIGHT`(§3-2a) |

🔴 ② 的列鎖型別是 **`FOR NO KEY UPDATE`,不是 `FOR UPDATE`**(`:499-505`);
整支函式裡 `FOR UPDATE` 這串字**只出現在 `:499` 那句解釋為何不能用它的註解裡**
(P 窗八代實測表:剝註解後 ② 的 `FOR UPDATE` 位置 = **0**、`FOR NO KEY UPDATE` = 2459;
母 plan `:299-316`、完整實測 `docs/specs/2026-08-12-2e2f-precheck-recon.md` §3)。
⇒ **順序錨不得與 2e 共用字串**,②找 `FOR NO KEY UPDATE`、③找 `FOR UPDATE`。

---

## §3 三個改動點,逐點論證

### 3-1 A. 序列化點(advisory)

鍵式子**與 2e 逐字相同**(三方必須逐字一致,否則不是同一條隊伍;母 plan §3a-4):

```sql
PERFORM pg_catalog.pg_advisory_xact_lock(
  ('x' || pg_catalog.substr(pg_catalog.replace(p_order_id::text, '-', ''), 1, 16))::bit(64)::bigint);
```

差別:**② 的鍵直接來自參數 `p_order_id`,不必預讀**(③ 只收 `attempt_id` 才需要無鎖預讀)
⇒ **2e 的 order_id 復核(P2E02)在 2f 沒有對應物**,不搬。

⚠️ 🆕 **`p_order_id IS NULL` 這格要寫出來,不能靠「應該不會發生」**(R2 N1):
步 1-2 的輸入衛生**沒有驗 `p_order_id`**(親開 `20260803150000:450-497`,它驗的是 actor/request_id/reason/kind/金額)。
NULL 之下鍵式子求值為 NULL、步 3 `WHERE o.id = NULL` 零列 ⇒ 回 `ORDER_NOT_FOUND`。
**結果無害**,但「無害」是**推出來的、不是量出來的** ⇒ §8 補一格實跑釘住它,免得日後有人改鍵式子時默默變成 RAISE。

⚠️ `_xact_` 版**持到交易結束**、不是函式返回;② 由 `service_role` 從應用層單語句呼叫
⇒ 一次呼叫 = 一個交易 = 鎖在函式返回時隨 commit 釋放。**這句話的前提是「單語句交易」**(§9-2)。

### 3-2 B. 跨帳本否決 —— 只新增 `payment_refunds` 那半

> 🔴 **v3 對本節做了兩件事,都是 R2 打出來的,都不是微調**:
> ①**述詞加一條排除**(MF-B:沒有它,設計內的重試鏈會讓該單**永久**被擋)
> ②**位置從「步 4 之後」往後挪到「步 6 之後」**(MF-E:v2 拿一條不存在的約束擋掉了自己的理由)。

```sql
-- 位置:步 6 之後、步 7 產鍵之前(§3-2⑥ 論證;仍滿足母 plan「必須晚於 G4、早於動錢」)
SELECT pr.id INTO v_blocking
  FROM public.payment_refunds pr
  JOIN public.payment_charge_attempts a ON a.id = pr.attempt_id
 WHERE a.order_id = p_order_id
   AND NOT EXISTS (SELECT 1 FROM public.payment_refund_effective_terminal et
                    WHERE et.refund_id = pr.id)
   -- 🔴 MF-B:已被沿鏈接手的舊列**不算在途**。母 plan `:483-489` 的重試路徑
   --    (delta 說沒退 ⇒ 沿鏈開新根)**沒有任何一步給舊列寫終局** ⇒ 舊列永遠不在 canonical view。
   --    少這一條 = 每走一次設計內的重試,該單此後所有退款被**永久**擋住。
   AND NOT EXISTS (SELECT 1 FROM public.payment_refunds s
                    WHERE s.supersedes_refund_id = pr.id)
   -- 🔴 Sean Q-2f-2 = B(2026-08-12,複判維持):**已受理即不算在途**。
   --    `result_success` 不在 canonical view 的終局集合裡(`20260811110000:197-198`)
   --    ⇒ 只能直讀 events;這是本函式**唯一**獲准直讀的 event_type(§3-2④ carve-out,後置錨釘死)。
   --    它是**受理判定**,不是終局判定 —— 不得拿它當「終局」的同義詞。
   AND NOT EXISTS (SELECT 1 FROM public.payment_refund_events e
                    WHERE e.refund_id = pr.id AND e.event_type = 'result_success')
 -- 🔴 R3 F9:`LIMIT 1` 沒有 ORDER BY ⇒ 回哪一列由計畫決定、非決定性
 --    ⇒ `blocking_payment_refund_id` 會在多筆阻擋時飄,測試 flake、值班對帳也對不起來。
 ORDER BY pr.created_at, pr.id
 LIMIT 1;
IF v_blocking IS NOT NULL THEN
  RETURN jsonb_build_object('result', 'REFUND_IN_FLIGHT', 'blocking_payment_refund_id', v_blocking);
END IF;
```

六個決定,各自論證:

1. **複用 `REFUND_IN_FLIGHT`、不新增第 9 碼。**
   8 碼全集寫死在 COMMENT `:414-416`,逐字「**呼叫端必斷言 ∈ 全集,未知碼=呼叫端 bug**」
   ⇒ 新增碼 = **破壞已上線呼叫端合約**。語意也真的同一件事(這張單有退款在途)。
   🔴 **v2 補:這不再是推論,是機械事實**(我自查時實開應用層):
   `apps/admin/src/lib/payment/refund-repository.ts:17-26` 是呼叫端的碼 allowlist,
   `:211` 逐字對不在 allowlist 的碼 `throw new RefundCallerBugError` ⇒ 第 9 碼會**當場炸掉後台送出流程**。
   附帶 key `blocking_payment_refund_id` 是**加欄不是加碼**(既有 `DUPLICATE_REQUEST` 也帶額外 key,`:517-519`)。
2. **走回傳碼、不走 RAISE**(與 2e 的 P2E01 不同)。
   ② 的既有 house 慣例逐字 `:417-418`:「**業務態=回傳碼、caller bug 與完整性異常=RAISE**」。
   「有退款在途」是業務態 ⇒ 照 ② 的慣例,不照 ③ 的。**不是抄漏,是刻意對齊各自本體。**
3. **尺度 = order,不是 rec_trade_id**(偏離母 plan `:330` 字面,理由三條):
   - `payment_refunds` **沒有 `order_id` 欄**(只有 `attempt_id`,`20260810140000:79`)⇒ 本來就得 join 到 attempt。
   - `payment_refunds.rec_trade_id` 是 **nullable**(`20260811080000:239`;`:290` 逐字「刻意」,弱識別情境可能不存在)
     ⇒ 用它當尺度會**漏掉 NULL 的列 = 否決有洞**。
   - **與現況一致**:`order_refunds` 那半的既有唯一索引本來就是 **order 尺度**(`:197-198`)。
     選 order = 兩本帳同尺度;選 rec_trade_id = 兩本帳尺度不同。
   ⚠️ **代價要認**:同一張單若有多顆 attempt,A 顆的在途補償會擋住 B 顆的新退款。方向 fail-closed
   ⇒ 可接受,但**寫進誠實清單**(§9-3)。
   🔴 **v1 在這裡多寫了一句沒有根據的話**:「在途必然走向終局(不是永久封死)」——**刪掉**(R1 MF3)。
   全篇同義字面已於 v3 用 `grep -n '必然走向終局\|非永久封死\|暫時性阻擋'` 掃過清乾淨(R2 MF-A;見 §15)。
   `payment_refunds` 的終局**沒有任何機制保證會到達**:一筆補償退款若停在 `result_unknown`/`reconcile`
   而沒有人跑 `admin_correct_refund_manual_verdict` 補判定,**這張單的後續合法退款就被永久擋住**。
   ⇒ 唯一出口是**人工**。這件事要:①寫進 §9 誠實清單 ②列為 **2g 的硬前置**(卡住的補償退款必須有值班可見度
   與人工出口,否則 2g 上線 = 給營運裝了一顆會卡死訂單的機關)③開 backlog。
   ⚠️ 這條在 2f 期間**構造不出來**(2g 未建、`payment_refunds` 無 writer)——
   **失效條件寫死**:2g 的 writer 一進庫,它當場變成活的。
4. **終局定義一律消費 canonical view `payment_refund_effective_terminal`**,本函式**不得自己問「有沒有 manual」**
   (沖銷片 §2d-1 契約;2e `:252` 同一句)。
   🏁 **carve-out 已生效(Sean 複判維持放行,2026-08-12)**:述詞要排除 `result_success`,
   而它**不在那個 view 裡** ⇒ 必須直讀 `payment_refund_events` ⇒ 與本條契約字面衝突。
   **明文 carve-out(寫進 COMMENT)**:
   > 終局判定**一律**消費 canonical view;**唯一例外 = 讀 `event_type='result_success'` 判「已受理」**,
   > 它**不是終局判定、是受理判定**。
   **配套後置錨(不可省)**:斷言本函式 `prosrc` 裡出現的 `payment_refund_events` 直讀,
   其 `event_type` 字面**只有 `result_success` 一個** ——
   🔴 沒有這道錨,carve-out 會退化成「以後想直讀什麼都行」的破口,
   而破口的形狀正是本片一路在修的那種:**規則還在,但不再約束任何東西**。
5. 🔴 **`attempt.order_id` 可變 ⇒ order 尺度有一個靜默漂移洞**(R1 MF2,v1 完全沒寫)
   本片用 `a.order_id = p_order_id` 定尺度,但 `payment_charge_attempts.order_id`
   **沒有 immutable 守門**(無 CHECK、無 trigger 擋 UPDATE;母 plan §3a-5 `:264-266` 對 2e 已認過同一件事)。
   **失敗情境**:某退款父列原屬訂單 A,其 attempt 的 `order_id` 被改成 B
   ⇒ A 的在途退款**漏擋**(A 可以再開一筆)、B **被誤擋**。兩個方向都錯,而且**無聲**。
   **本片不修**(加 immutable 守門 = 動 `payment_charge_attempts`,超出片界、且 2e 已依賴同一個假設)
   ⇒ **射程照實寫**:這是「目前沒有人改」的**時點觀察**,不是 schema 不變量。
   失效條件 = 任何人加一條會 UPDATE 該欄的路徑。**與 2e 共用同一個假設 ⇒ 兩片會一起失效**,列 backlog。
6. 🆕 **排除「已被沿鏈接手的舊列」**(R2 MF-B;沒有它本片會製造永久封單)
   **證據鏈(我親開母 plan 逐字核過,不是轉抄 reviewer)**:
   - 母 plan `:483-489`「被拒的根:完整路徑一次寫完」五步 —— 步 1 寫 `result_unknown`、
     步 4 逐字「delta 說退了 ⇒ 補 `result_confirmed`;**說沒退 ⇒ 可沿鏈開新根(帶 `supersedes_refund_id`)**」。
     **五步之中沒有任何一步給舊列寫終局事件。**
   - 終局集合 `20260811110000:201` 逐字 = `result_confirmed / result_failed / manual`。
   ⇒ 舊列**永遠**不進 canonical view ⇒ 少了這條排除,`NOT EXISTS` 永遠命中
   ⇒ **走過一次設計內重試的訂單,此後所有退款被永久擋死**。
   🔴 **這是 `10024`/`10051` 之下的正常路徑,不是異常路徑**(母 plan `:480` 逐字:
   這類 wire code「到得了 adapter,但不會變成 domain 的 `deferred`/`rejected`」⇒ 落 `result_unknown`)。
   ⚠️ **翻案條款已查、不成立**:R2 允許「若母 plan/2k 有明文『沿鏈前必先寫終局』則降 nit」——
   我逐行讀了 `:478-503` 全段,**查無**。⇒ 照第一修法(述詞加排除)辦。
7. 🆕 **位置從步 4 之後改到步 6 之後**(R2 MF-E)—— 見 §3-2a。

### 🔴 3-2a 位置:v2 拿一條**不存在的約束**擋掉了自己的理由(R2 MF-E)

v2 把 B 放「步 4 之後」,並在 §11 偏-2a 說「不把它移到步 5 之後,因為那會違反母 plan `:290`」。
**`:290` 不是那樣寫的。** 逐字只有:

> | **共同否決條件** | **步 4(冪等查驗 G4)之後** | 它**會拒絕** ⇒ 若排在 G4 前,合法的同 `request_id` 重播會…改了既有語意 |

⇒ 綁定的約束只有兩條:**晚於 G4**、**早於動錢**。「動錢」= 步 8 的 INSERT
(步 5 讀既有值、步 6 判金額、步 7 產鍵,**三步皆無寫入、無外呼**)。
⇒ **把 B 放在步 6 之後、步 7 之前,兩條約束都滿足。** v2 引的那條禁令不存在。

**而且 v2 的自相矛盾更嚴重**:偏-2a 我自己的新理由是「現行優先序刻意保留四個具體診斷比籠統的
IN_FLIGHT 有用」—— 那條理由**正好支持把 B 往後移**,v2 卻拿它論證完之後做了相反的事。

**v3 定案:B 移到步 6 之後。** 效果:
`REFUND_LEDGER_FULL` / `ORDER_NOT_REFUNDABLE` / `ORDER_NO_CARD_TRANSACTION` / `REFUND_NOTHING_LEFT`
四個具體診斷**優先於** `REFUND_IN_FLIGHT`,與 `order_refunds` 那半(步 8 才擋)的既有優先序**一致**。
⇒ 順帶把 v2 §9-3 那條「四種輸入下行為改變」**消掉**(不再有那個行為改變)。
⚠️ 這是對母 plan `:292` **圖示順序**的偏離(它把否決畫在步 5 之前)⇒ 記進 §11 偏-4。

🔴 **這條否決現在恆假**(`payment_refunds` 尚無任何 writer,2g 未建)⇒ 它是**前瞻守門**。
harness 必須**直接 INSERT 構造父列**才驗得到,不能靠跑既有流程。同 2e 的處境。

### 3-3 `lock_timeout = '3s'` —— 放**函式層 SET 子句**,不放 body

2e 實測結論逐字沿用:body 內的 `SET LOCAL` 是**交易尺度**、**不隨函式返回還原**
(會汙染同交易後續語句);函式層 `SET` 子句才有 save/restore 邊界。

🔴 **必須同時保留 `search_path = public, pg_temp`** —— 兩條並列寫,漏一條 = §1-2② 那個坑。

```sql
SET search_path = public, pg_temp
SET lock_timeout = '3s'
```

值本身**沒有量過**(母 plan `:398` 自陳)⇒ §10 Q1 交 Sean。

---

## §4 死結:advisory 什麼時候**不會**成環,什麼時候**會**

**不會**:A 在步 3 之前取 ⇒ ② 取鎖時**手上沒有任何列鎖** ⇒ 它只可能「等 advisory」,不可能「持列鎖等 advisory」。
③(2e)同構:無鎖預讀 → advisory → 才 `FOR UPDATE`。補償 writer(2g)也先取 advisory(母 plan §3a-9)。
⇒ 三方都是「先進隊伍、才拿列鎖」,**在函式內部不存在 AB-BA**。

> 🔴 **射程限定(R2 IMP-4;v2 那句「不存在 AB-BA」講得比 2e 大)**
> 2e 已 apply 的 COMMENT `20260812160000:307` 逐字認過:呼叫端交易只要在本呼叫之外**還持有、或之後還會等待
> 任何可爭用資源**(不限於該訂單相關列),就可能與另一條同單呼叫成環 —— 「A 呼完續等資源 R × B 持 R 再呼同單」。
> ⇒ 本片的正確宣稱與 2e 對齊:**「在『單語句交易』前提成立之下,advisory 不會出現在環上」**,
> **不是**「本片消滅了死結」。前提本身沒有機制守(§9-2),只能寫進 COMMENT。
> ⚠️ §13-4 的驗收條件騎在本節上 ⇒ 它驗的是**消融靶能不能造出環**,不是「正式庫沒有環」。

**會**(消融靶,母 plan `:320-321` 硬要求):把 A 移回**步 3 之後**
⇒ ② 持 `orders` 的 NKU 等 advisory × ③ 持 advisory 等 `orders`
⇒ **必須實際構造出 40P01**。🔴 **構造不出來 = 這格沒有判別力,不得宣稱死結已解**(不得寫「理論上會」)。

### 🔴 4-1 v1 的靶判準是錯的 —— 接受 55P03 等於把判別力送掉(R1 MF5)

v1 寫「靶要接受 40P01 **或** lock_timeout 逾時二者之一為紅」。**這條要刪掉。**

`55P03`(lock_timeout 逾時)只證明「**有人在等**」,**證不到有環**:
變異版持 NKU 等 advisory,而 advisory 的持有人若**根本不去碰那張訂單**,就沒有環 —— 它一樣會在 `lock_timeout` 到期時吐 55P03。
⇒ 拿 55P03 當紅 = 這格對「有沒有 AB-BA」**零判別力**,而那正是本片唯一要證的事。

**v2 判準(寫死)**:消融靶**必須觀察到 `40P01`**,其他 SQLSTATE 一律不算紅。
可行性:`deadlock_timeout` 預設 1s **早於** `lock_timeout`(**拍板值 10s**,Q-2f-1)發火 ⇒ 真有環時死結偵測器會先動手,拿得到 40P01。
(🔴 這兩處原本寫死 3s = v1 殘值,而 Q-2f-1 早已拍 10s ⇒ 與 §13-9「不寫死 3s」自相矛盾,code-reviewer 抓到。)
🔴 **構造時必須讓對手方真的去等那張訂單的列鎖**(否則構造的是「兩個各自等待」不是環)。
🔴 若實跑拿不到 40P01:**照實寫「未證」,不得宣稱死結已解**,並把當下觀察到的 SQLSTATE 與雙方鎖清單
(`pg_locks` + `pg_blocking_pids`)一併記進報告 —— 拿不到環的原因本身就是情報。

---

## §5 `CREATE OR REPLACE` 的屬性保留清單(逐條在 migration 內斷言)

🔴 **v2 補完(R1 IMP7)**:v1 只列了五個屬性,漏了一整族「省略即回預設」的欄。
`CREATE OR REPLACE` 的規則是**整份宣告重寫**,凡是沒寫的子句一律回 PostgreSQL 預設 ——
不是只有 `SET` 子句會被吃掉。下表**以 `pg_proc` 的欄為單位**列,不以「我記得有哪些子句」列。

| `pg_proc` 欄 | 現況(§1-3 量) | 省略會變成 | 本片作法 |
|---|---|---|---|
| `proconfig` | `{search_path=public, pg_temp}` | 🔴 NULL | 兩條 SET 顯式寫;後置逐字比**兩條都在** |
| `prosecdef` | `true` | 🔴 false(= INVOKER,權限全變) | 顯式 `SECURITY DEFINER`;後置斷言 |
| `provolatile` | 實作日量 | `v`(volatile) | 顯式對齊現況;後置斷言 |
| `proisstrict` | 實作日量 | false(`CALLED ON NULL INPUT`) | 同上 |
| `proparallel` | 實作日量 | `u`(unsafe) | 同上 |
| `proleakproof` | 實作日量 | false | 同上 |
| `procost` / `prorows` | 實作日量 | 100 / 1000 | 同上 |
| `proacl` | §1-3 那組 | 不會掉(REPLACE 保留) | 仍後置斷言逐字比 |
| owner | `postgres` | 不會變 | 後置斷言 |
| 簽章 / 回傳型別 | §1-3 | 改了就不是 REPLACE 而是**新函式** | 逐字照抄 |
| COMMENT | 見下 | 不會掉(掛同一 oid) | **仍重下**,見 §5a |

🔴 **「實作日量」四個字是承諾**:這幾欄我**現在沒有量**(正式庫唯讀查詢要在實作片跑)。
落 migration 前逐欄量一次、把值寫進前置斷言 P3。**沒量到就不准寫死一個猜的值**。

### §5a COMMENT 的「逐字保留」要有基線,不能靠人眼(R1 IMP8)

v1 寫「既有字面逐字保留 + 追加 2f 段落」,但**沒有任何機制擋住把既有段落截掉** ——
重下時只留新段落,後置斷言(只檢查「含終局三字」)照樣綠。

**修法**:前置 P8 先把**現行 COMMENT 全文的 md5** 釘住;後置斷言改成
「新 COMMENT **以那段舊全文為前綴**(`starts_with`),且長度嚴格大於它」
⇒ 截掉任何一段都會紅。配突變靶:刪掉舊全文的最後一句 ⇒ 必須翻紅。

---

## §6 Rollback(母 plan `:718-726` 的硬形狀)

`scripts/l5b2-2f-rollback.sql`,**單一交易可執行腳本**、禁止只抄座標逐句手跑(這句寫進檔尾 rollback 段本身)。

**閘的順序固定;道數 = 五道**(v5 設計三道、v6 擴為五道 ②b/②c、v7 未增道數只改形狀 —— 現況逐道形狀見 §7-10):
1. 🔴 **成組回退閘(2a 沒有、抄骨架時不會自己長出來)**:查 **2g 的 writer 是否在庫**,在就 `abort`,
   訊息指回母 plan §2b —— 非先撤 2g 不可,不靠人記得逆序。**形狀沿用 2e rollback 閘①**
   (顯式名單 + 剝註解後的放寬正規式;2g 落地時把函式名填進顯式名單)。
2. **三態閘**:只接受「現況 = 2f post-image」或「現況已 = 2f pre-image」,其餘 abort。
   🔴 **pre-image 那一態不是 no-op**(v7 更正:v5/v6 這句寫成 no-op 是錯的):
   `RETURN` 只跳出 DO 區塊,底下的 `CREATE OR REPLACE` 與 `COMMENT` **仍然會執行**、
   用同一份 pre-image 字面覆寫一次 ⇒ 結果相同但**不是零寫入**。
   ⇒ 兩態都要逐項比旁支(閘②b),否則回退後的追記會被「再跑一次」靜默吃掉。
3. **還原來源**:② 的 body 與 COMMENT 來源 = `20260803150000`。
   🔴 **2e 的教訓要複製**:2e 的 body 與 COMMENT 來自**兩個不同世代的檔**,v1 寫錯過一次。
   ⇒ 本片實作時**逐一開檔確認 body 與 COMMENT 各自的最新來源座標**,不假設同一支 migration。

---

## §7 前置 / 後置斷言清單(migration 內,fail-closed)

### 🔴 7-0 migration 本體**必須顯式包在單一交易裡**(R2 MF-F;v2 只對 rollback 腳本講了)

v2 §6 要求 rollback 腳本「單一交易可執行」,**卻沒對 migration 本體提同樣要求** ——
而本片的整個 fail-closed 設計(「前置任一不符 ⇒ 整片回滾」)**完全建立在那個前提上**。

**為什麼這是真的洞而不是形式**:`psql -f` 逐句執行之下,`DO` 區塊裡的 `RAISE` **會被滾過去**,
而前面已經跑完的 `CREATE OR REPLACE FUNCTION` **已經落地** ⇒ 守門邏輯完好無缺,但**沒有後果**。
這正是 memory `feedback_guard-effect-depends-on-how-it-is-executed` 的本尊情境。

**同族三支全都顯式包**(不是我發明的形制):`20260812160000:64`(2e)、`20260803150000:42`(② 的源檔)。

**v3 作法**:檔案以 `BEGIN;` 開頭、`COMMIT;` 結尾;緊接 `BEGIN;` 之後下三條(R2 IMP-7,
形制同 2e `:66-68`、沖銷片 `20260812140000:38-45`):

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL transaction_timeout = '120s';
```

🔴 **7-0a 包了交易還不夠 —— 執行方式本身有一條逃逸(R3 F5)**
`BEGIN;` 只保證「同一個交易」,**不保證失敗會回滾**:使用者的 `~/.psqlrc` 若開了 `ON_ERROR_ROLLBACK`,
psql 會在**每句之前**下 savepoint,`RAISE` 只回滾**那一句** ⇒ 前面已跑的 `CREATE OR REPLACE FUNCTION`
**照樣留在庫裡**,而守門看起來完全正常。這與 §7-0 的病同源(memory
`feedback_guard-effect-depends-on-how-it-is-executed`),但**多包一層 `BEGIN` 擋不住它**。

**明文寫進檔尾 apply 段**:本檔**只准** `supabase db push`,或 `psql -f <檔> -v ON_ERROR_STOP=1`。
**禁止**互動式 `\i`、禁止逐句貼進 SQL Editor —— 那兩條路上這道閘不存在。

⚠️ **這三條是 migration 執行期的保險,與函式層那個 `10s` 是兩回事**,不要混:
前者管「這支 migration 卡住時自己放手」,後者管「函式被呼叫時等鎖多久放棄」。

---

> 🔴 **v2 全節重寫的共同病根(R1 一次打中五道)**:v1 的 P4/P5/P6/P7 全是**存在性檢查**
> ——「那個東西在不在」,不是「**它還在做它該做的事嗎**」。
> 存在性斷言對「**還在但已失效**」全盲(memory `feedback_guard-checks-existence-not-effect`)。
> 我在 2e 已經被同一條打過一次,v1 又寫成同樣的形狀。

**前置(pre-gate,任一不符整片回滾)**

| # | 斷言(v2) | v1 錯在哪 / 為什麼要這樣 |
|---|---|---|
| P1 | 2e 的 **`prosrc` md5 = `f4e3aa5b…`** ➕ `proconfig` 含 `lock_timeout` ➕ `prosecdef=true` ➕ **`proacl` 逐字等於 2e 當時那組集合** | R1 IMP4:`ALTER FUNCTION` 可拿掉 2e 的 `lock_timeout`/SECDEF/ACL 而**不動 `prosrc`**。🔴 **R2 IMP-2 再打**:v2 寫的「`proacl` **非空**」又是存在性檢查(本節檔頭自己說要根治的病)——多 GRANT 一個角色照樣非空 ⇒ 改**逐字比集合** |
| P2 | ② pre-image `prosrc` md5(實作日重量) | 底稿漂移就停 |
| P3 | ② 的 **§5 整張表逐欄**(`proacl`/`proconfig`/owner/`prosecdef`/`provolatile`/`proisstrict`/`proparallel`/`proleakproof`/`procost`/`prorows`) | R1 IMP7:v1 只列五欄,漏的那族會被 REPLACE 靜默重設 |
| P4 | 🔴 **v3 改法**:釘 `md5(pg_get_viewdef('public.payment_refund_effective_terminal'))` = 沖銷片交付時的 post-image。🔴 **v4 補量法(R3 F10)**:`pg_get_viewdef` 回的是 **PG 正規化重寫後的文字、不是源檔字面** ⇒ 基線**必須在正式庫、用同一個呼叫式(同參數、同 PG 版本)當場量**,不得拿源檔算。落值那行要註明「算法=md5、量法=`SELECT md5(pg_get_viewdef('…'))`、量測日與環境」 | R1 MF6 指出「存在性擋不住語意被換掉」是對的,但 **v2 開的藥方(語意探針)在正式庫做不到**(R2 MF-G):帳本 append-only(`20260810140000:154-158` P5B01)+ FK ⇒ 探針要捏三層假列**而且刪不掉**。釘 viewdef 是**零寫入**、且判別力更強(語意被換掉 = 定義變 = md5 變) |
| P5 | `payment_refunds` / `payment_charge_attempts` **➕ `payment_refund_events`** 無 FORCE RLS | R1 IMP2:v1 漏了 `payment_refund_events` —— 它才是 canonical view 判終局的資料來源,它被 FORCE 住 ⇒ 已結案退款**永久擋單** |
| P6 | 值域四值 ➕ **狀態機 trigger 存在且 `tgenabled='O'`** ➕ 其函式 `prosrc` md5 | R1 IMP3:v1 驗的是 CHECK(值域),但 §1-1 的終局集合**依據的是狀態機**;trigger 被 disable 後 CHECK 照綠、COMMENT 卻仍宣稱三態終局 |
| P7 | 索引 **`indisvalid` ➕ `indisunique` ➕ `indkey` = `order_id` ➕ `indpred` 逐字含 `status='processing'`** | R1 MF7:v1 只驗名稱;同名索引可被重建成錯 key / 錯 predicate / invalid,步 8 就不再保證單筆 processing |
| P8 | 現行 COMMENT **全文 md5**(§5a 的基線) | R1 IMP8:沒有基線就擋不住「重下時把舊段落截掉」 |

**後置(post-assert)**

1. 順序錨兩發(剝註解後 `pg_advisory_xact_lock` < `FOR NO KEY UPDATE`;否決字面 > G4 字面)。
   🔴 **只是廉價前哨**(母 plan `:314` 逐字)——真判別力在 §4 的消融。
2. 🆕 **跨函式鎖鍵等價**(R1 MF4):從 2e 的 `prosrc` 抽出 `pg_advisory_xact_lock(...)` 那段字面,
   與本片抽出的那段**逐字相同才過**(僅允許鍵來源識別字不同:`v_order_id_pre` vs `p_order_id`)。
   **為什麼非要這道**:鍵式子寫錯(截 15 字、取錯段 UUID)之下,順序錨綠、同函式併發也綠 ——
   但 2e/2g 用的是**另一把鎖**,三方根本不在同一條隊伍。這是「兩邊各自綠、中間那一跳沒人守」那族。
3. §5 整張表逐欄未變(P3 的鏡像)。
4. COMMENT **以 P8 的舊全文為前綴** 且長度嚴格大於它,且新增段含 §1-1 的終局三字。
5. `proconfig` 含 `search_path` **與** `lock_timeout`,且 `lock_timeout` 的值 **= §10 Sean 拍板的那個值**
   (R1 MF10:v1 把 `3s` 寫死進後置,Sean 若選 10 秒則驗收條件自己永遠不可能達成)。
6. 🔴 **「無有效終局的 `payment_refunds` 父列數」>0 ⇒ `RAISE EXCEPTION` 整片回滾,不是 NOTICE**(R2 IMP-3)。
   v2 寫成只印 NOTICE = 把一道**免費的 fail-closed** 放掉:apply 當下若真有這種列,
   代表本片一上線就會擋住那些單,而那是 apply 的人**應該先知道再決定**的事,不是事後翻 log 才發現。
   (2e 當時 NOTICE 是對的 —— 它的預期值有實測背書且真的是 0;本片的述詞不同、又多了 §3-2⑥ 的排除,
   ⚠️ 但**這個數字我沒有量過** ⇒ 若 apply 時真的 >0,正確處置是**停下來問**,不是自動放行也不是硬擋到底。
   實作時把這句寫進 RAISE 訊息裡。)

### 🆕 7-9 v5 → v6 閘清單差異(**已被 §7-10 取代**;本表保留為 v5→v6 的推導史)

> 讀法:上面兩張表講「為什麼要有這道閘」,本表講「v6 那一輪把形狀改成什麼」。
> 🔴 **實作現況一律看 §7-10**(v6→v7);本表與 §7-10 衝突時**以 §7-10 為準**。

| 閘 | v5 形狀 | **v6 現況** | 負測 |
|---|---|---|---|
| **P1c** | 逐一問 4 個角色有無 EXECUTE(抽樣) | 從 `proacl` 反向展開比**整個授權集合** = 僅 owner;`proacl IS NULL` **判失敗**(預設 = PUBLIC 可執行) | — |
| 🆕 **P3b** | (無) | ② 的 EXECUTE 授權集合 = **恰好 {owner, service_role}**(Sean `Q-P591-1`=A);翻紅**停下回報、不得改授權讓它過** | — |
| 🆕 **P4b** | (無) | canonical view 必須 `security_invoker=true`(viewdef md5 蓋不到它,關掉 = 無聲換 RLS 適用對象) | — |
| **P6** | 四個 `LIKE` 都命中 | 值域**集合相等** = `{processing, confirmed, failed, deferred}` | — |
| **P6b** | 只看 `tgenabled='O'` | ➕ `tgqual IS NULL`(永假 WHEN)➕ `tgtype=19`(BEFORE UPDATE FOR EACH ROW)➕ `tgattr` 含 status 的 attnum | `neg` **N3** |
| **P6c** | **按名字**查函式 md5 | 沿 **`pg_trigger.tgfoid`** 取「這顆 trigger 實際綁的函式」再算 md5 | `neg` **N2** |
| **P7** | `indpred LIKE '%processing%'` + `indexdef LIKE '%(order_id)%'` | predicate **整串相等** `(status = 'processing'::text)`;鍵查 `indkey[0]` 實際欄名;➕ `indisready`/`indislive`/`indnkeyatts=1`/非運算式索引 | `neg` **N1** |
| 後置 **①b2** | (無) | 否決必須**早於**步 8 的 `INSERT INTO public.order_refunds`(v5 只證晚於 G4 = 只有下界) | — |
| 後置 **②** | 只比 `substr(...)` 片段 | 比**整個引數式子**(`[^;]*` 界定範圍;不可用 `.*?` —— PG 的 ARE 整體貪婪度由第一個量詞決定) | `mut` **M11** |
| 🆕 後置 **②a** | (無) | `pg_advisory_xact_lock` 呼叫**恰好 1 次** | `mut` **M12** |
| 後置 **⑤** | `LIKE comment_full \|\| '%'` | `starts_with()`(`LIKE` 會把舊全文裡的 `_` 當萬用字元) | — |
| 後置 **⑥** | 枚舉寫法的 regex | `event_type` **出現次數**與**合格形式次數**都必須恰好 1(不枚舉寫法) | `mut` **M6** |
| 後置 **⑦** | 枚舉寫法的 regex | `'result'` 鍵出現次數 **=** 緊接 8 碼字面的次數 | — |

**回退腳本(`scripts/l5b2-2f-rollback.sql`)同批**:

| 閘 | v5 形狀 | **v6 現況** | 負測 |
|---|---|---|---|
| 閘① 2g 偵測 | 只剝 `--` 註解 | **兩種註解都剝**(`/* */` 非巢狀 + `--`);寫在區塊註解裡的說明文字不再被當成真 writer | — |
| 🆕 閘 **②b** | (無;三態閘只比 `prosrc`) | 逐項比**本腳本有能力覆寫的每一面**:`proconfig` / COMMENT md5 / 七個屬性。**ACL 與 owner 刻意不列入**(REPLACE 保留權限、覆寫不到,列進去只會製造假性第三態) | `neg` **N4** |
| 🆕 閘 **②c** | (無) | 庫裡仍有**在途** `payment_refunds` ⇒ 拒回退(撤掉否決 = 那些單立刻可再開一筆並行退款) | `neg` **N5** |
| 回退後置 | 只驗 `prosrc` + `proconfig` | ➕ **COMMENT 全文 md5 回到 pre-image**(body 回去了而 COMMENT 停在 2f 版 = 合約字面與行為不一致) | — |

### 🆕 7-10 v6 → v7 閘清單差異(**已被 §7-12 補正**;7-9 降為 v5→v6 的推導史)

> 讀法同上:與 7-9 衝突時**以本表為準**。
> 本表每一列都對應 diff 層 R1 第二輪的一條 finding —— 它們有一個共同形狀:
> **v6 的守門看的是「某個字串在不在」或「某個座標的先後」,而語意可以在字串與座標都不動的情況下反轉。**

| 閘 | v6 形狀 | **v7 現況** | 負測 |
|---|---|---|---|
| **P1b** | `proconfig::text LIKE '%lock_timeout%'`(只問名稱在不在) | 逐值比 + `cardinality=2`:`{SECDEF, search_path=, lock_timeout=3s}`。🔴 `lock_timeout=0` = 無限等 = 本組要消掉的死結面,舊形狀對它全綠 | `neg` **N6** |
| **P3b** | 授權集合相等 | ➕ **非 owner 的 EXECUTE 不得可轉授**(`is_grantable`):集合現在對、但 service_role 自己就能轉授出去 | `neg` **N7/N9**(集合面) |
| 🆕 **P5b** | (無) | SECDEF 的執行身分 = 函式 owner;該角色必須是三張 RLS 表的 owner **或**有 `BYPASSRLS`,否則 policy 會裁列 ⇒ 在途判定**漏擋**且無症狀 | ⚠️ **未驗**(見下方註) |
| **P4b** | 比 `'security_invoker=true'` 單一字面 | 取該鍵的**值**再判布林真值(`on`/`1`/`yes` 等合法等價寫法不再被誤擋) | `neg` **N10** |
| **P6b** | `tgenabled='O'` + `tgtype=19` | `tgenabled IN ('O','A')`(ALWAYS 是**更強**設定、不得誤擋)+ tgtype **逐位元**(ROW\|BEFORE\|UPDATE、排除 INSTEAD),不釘整數 | `neg` **N3/N3b/N3c/N3d** ➕ **N3e**(反向:ALWAYS 不得被擋) |
| **P7** | predicate 整串相等 | 形狀不變(fail-closed 主視窗裁定接受),但**檔內寫明誤擋症狀與值班動作** | `neg` **N1/N1b/N1c**(predicate / 鍵欄 / 唯一性三面) |
| 後置 **①a2** | (無) | advisory 必須**晚於步 2 的參數檢查**:v6 只證早於列鎖 ⇒ 移到輸入驗證前照樣綠,無效請求也去排隊等滿 10 秒 | ⚠️ 未驗(sed 搬不動整段) |
| 🆕 後置 **①e** | (無) | 三條在途述詞的 `NOT EXISTS (SELECT 1 FROM public.<名>` 出現數 = 該關聯名出現數 = 1。**`NOT EXISTS`→`EXISTS` 座標一字不動、語意整個反轉**,①b/①b2 的位置錨對它全盲 | `mut` **M18** |
| 後置 **①d / ②a** | 大小寫敏感的 regex | 掃描一律 `'gi'`:`PG_ADVISORY_XACT_LOCK` 是合法同一支函式,大寫寫法在舊形狀下**一處都數不到** | `mut` **M21** |
| 後置 **②** | 把 `[a-z_]+::text` 一律正規化成 ORDERID | 只正規化**白名單** `p_order_id\|v_order_id_pre`:舊形狀等於宣告「鍵來自哪個變數無所謂」,改鎖 `p_request_id` 仍判同鍵 | `mut` **M2/M11** |
| 後置 **④** | proconfig 含兩個片段 | **整串相等** `{"search_path=public, pg_temp",lock_timeout=10s}`(多一個 SET = 本片沒宣告過的行為改動);與 rollback 閘②b 同一顆字面 | `mut` **M3/M4** |
| 後置 **⑤b** | 含 `confirmed / failed / deferred` | 字面拉長成合約句 `終局集合逐字 = …`,並**在檔內寫明這只是「字面在位」不是合約被驗證** | ⚠️ 未驗(自由文字無法機械證) |
| 後置 **⑥** | 兩個計數都 = 1 | 合格形式**連著左鄰 `AND ` 一起比**:`AND NOT e.event_type = '…'` 在舊形狀下兩個計數**仍然都是 1** | `mut` **M6/M19** |
| 後置 **⑦** | 兩個計數相等 | ➕ **絕對數 = 10**:串接組鍵(`'res'\|\|'ult'`)會讓兩個計數**同步減少**、相等照樣成立 | `mut` **M15/M20** |

**回退腳本 v6 → v7:**

| 閘 | v6 形狀 | **v7 現況** | 負測 |
|---|---|---|---|
| 閘① 2g 偵測 | 只掃 `public` schema | 掃**全部非系統 schema**(private schema 的 writer 舊形狀整支隱形)➕ 訊息印出**命中清單**(巢狀註解誤判時值班才查得動) | — |
| 閘 **②b** | 只有 post-image 態逐項比 | **pre-image 態也逐項比**:早退只跳出 DO 區塊、下面的 `CREATE OR REPLACE`/`COMMENT` 照跑 ⇒ 「早退=安全」不成立,回退後的追記會被二次執行吃掉 | `neg` **N4/N4b/N4c** |
| 閘 **②c** | 任一在途列 ⇒ 無條件封死 | 保留封死 ➕ **核准出口**:操作者把**當下筆數**逐字帶進 `SET pcm.rb_2f_inflight_override` 才放行,放行 `RAISE WARNING` 留痕 | `neg` **N5/N5c/N5d**(無 override / 帶錯 / 帶對) |
| 回退後置 | prosrc + proconfig + COMMENT | ➕ **七屬性**(誤帶 IMMUTABLE/PARALLEL/COST 仍會宣稱「完整還原」) | `neg` **N4c** 同源 |

### 🆕 7-11 結構斷言 × 行為靶對照(v8;主視窗 `P-607-A` 換路裁決的交件物)

> **裁決原文的意思**:migration 內的前置/後置斷言本質是「比對 catalog 文字」,等價寫法是**開放集合**
> (`<>` → 補 → `NOT (...)` → 補 → 第 N+1 種),補到死也補不完。
> ⇒ 它的合理定位是「**擋 apply 當下的明顯形狀變動**」;**語意**由 `neg` 模式的行為測試保證 ——
> 那裡是臨時叢集,可以真的寫資料:該被擋的值要出錯、該過的要成功,**對所有等價寫法一視同仁**。
> ⚠️ 兩者不互相取代:行為測試跑不到正式庫,結構斷言跑不出語意。本表就是逐道講清楚誰守什麼。

| 結構斷言 | 它實際證的 | 行為靶 | 行為靶證的 |
|---|---|---|---|
| **P6 / P6-op**(值域集合 + 運算子) | constraintdef 的**字面**沒被換掉 | 🆕 **N12c-1/2**(正常)、🆕 **N12d**(翻面) | 「四個值以外進不來、`processing` 進得來」。N12d 就是 R2 那條繞法本身:**兩道結構斷言都判綠**,行為探針當場紅 |
| **P6b / P6c**(狀態機 trigger) | trigger 在、綁的是那支函式、時機/欄位對 | 🆕 **N2b-1/2** | 「`processing→failed` 過得去、`failed→processing` 轉不出去」。⚠️ **只探了這一格**(R3 nit):三終態 × 多目標的其餘組合未探,不要把它讀成「終態一律轉不出去」的全稱背書 |
| **P7**(single-flight 唯一索引) | 索引存在、鍵/predicate/唯一性沒被換 | 🆕 **N1d** | 「同單第二筆 `processing` 真的插不進去」(23505) |
| **P5b**(SECDEF owner 的 RLS 觸及面) | owner 是表 owner 或有 BYPASSRLS | 🆕 **N11b**(改庫狀態) | 換成無 BYPASSRLS 的 owner ⇒ 這道真的會紅(v7 誤標「本機恆綠」已更正) |
| **P1 / P1b / P1c / P2 / P3 / P3b / P8** | 2e 與 ② 自身的 catalog 現況沒漂移 | `neg` N6/N6b/N7/N8/N9 + `mut` M9/M13/M14 | **不適用行為層**:它們釘的就是 catalog 狀態本身,不是可以「跑出來」的語意 |
| **P4 / P4b**(canonical view) | viewdef 指紋 + `security_invoker` | `neg` N10 | ⚠️ **未配行為靶**:要證「view 的列集合語意」需要建 RLS policy 與多角色 fixture,本輪未做 —— 照實記 |
| 後置 ①a/①a2/①b/①b2/①c/①d/①e/②/②a/③/④/⑤/⑤b/⑥/⑦ | 本片**自己寫下的源碼**沒被改壞 | `mut` M1-M25(逐格見 §17) | 這些的「行為層」就是突變靶:改壞源碼之後行為格會不會紅 |
| 回退閘 ①/②/②b/②c/後置 | 回退腳本自己的守門 | `neg` N4/N4b/N4c/N5/N5c/N5d/**N7b**/**N7c** | 🆕 N7b(還原文字誤帶 SET)與 N7c(註解含 `/*` 的 writer)是 v8 新增 —— 兩者都曾被我當成「構造不出來」 |

> 🔴 **一句話結論**:v8 之後,**三道最吃重的結構斷言(值域 / 狀態機 / single-flight)各自配上了行為靶**;
> P4/P4b 那一組**明說未配**。這張表本身就是驗收面 —— 沒配上的不要靠結構斷言的綠燈當語意背書。

### 🔒 7-13 **結構斷言電池:凍結裁決**(v9;主視窗 `P-607-A` → `P-610-A` 一般化。**這是本片最重要的一段**)

> 依據:diff 層 R3 §3 逐字 ——
> **「52 條 diff 層 findings 幾乎全數打在守門 / 回退 / harness 自己身上 = 守門電池已是本片的主要缺陷產生器」**、
> **「結構斷言的反繞過軍備防的敵人,必須先通過同一條審查鏈才存在」**。
> P-607-A 對 P6 的換路裁決是對的,主視窗裁定**一般化到整個電池並明文凍結**。

**四條,適用於本片所有結構斷言(P1-P8 前置 + ①-⑧ 後置 + 回退五閘):**

1. **定位** = 「**apply 當下的明顯形狀變動偵測**」,**不是語意保證**。
   語意歸行為靶(§7-11 那張對照表);兩者不互相取代,加碼的方向只往行為層加。
2. **此後對結構斷言的「可繞過」類 finding,預設 by-design 收下**(記錄下來、**不加碼**)——
   **除非那個繞法「不需要通過審查鏈就會自然發生」**(例:PG 版本升級改寫 catalog 文字、
   PG 預設值變更)。判準就是這一句:**繞法的前提是不是「有人先騙過整條審查鏈」**;
   是的話,再加一道結構斷言擋的仍然是同一個已經被擋住的人。
3. **2g 不得再手長一套** —— 要用就**抽共用模板**。理由收 R3 的:否則同款維護面 ×3。
   🔴 **數字我自己量過再寫**:三檔實數 = **3,057 行**(`wc -l` 實測 1048 + 685 + 1324,v9 當下)——
   R3 原話寫「3,400 行」,我上一版**直接轉抄沒自量**,那正是 memory「別人給的理由不得轉抄+背書」那條。
4. **不拆已建成的**(沉沒成本且已實測全綠);凍結的是**繼續加碼**,不是既有的東西。

🔴 **給下一代的一句話**:看到「這道守門可以被 XX 寫法繞過」的 finding,先問**第 2 條的判準**,
再決定要不要動手。三輪 diff 層審查的教訓是 —— **反繞過軍備競賽本身,已經比它防的東西更會產生缺陷。**

---

### 🆕 7-12 v7 → v8 閘清單差異(**這張才是實作現況**;與 §7-9/§7-10 衝突時以本表為準)

| 閘 | v7 形狀 | **v8 現況** | 負測 |
|---|---|---|---|
| **P6-op** | 釘運算子、禁 `<>`/`!=` | **形狀不再加碼**(換路裁決):維持現狀當「明顯形狀變動」偵測,語意交給行為靶 §7-11 | `neg` **N12b**(結構)+ **N12c/N12d**(行為) |
| 後置 **①c** | `upper(v_stripped)` | **`upper(v_norm)`**:v7 只吸收大小寫、沒吸收空白 ⇒ `FOR  UPDATE`(雙空格)/跨行寫法一處都數不到;順手刪掉 `i_nku + 7` 那個**永遠不成立**的豁免(死碼) | `mut` **M17/M22/M25** |
| 後置 **①a**(座標系) | i_adv 走 v_stripped、i_nku 走 upper(v_stripped) | **同一座標系**(都走 v_stripped):跨座標比大小只靠「upper 不改長度」這個沒有普遍性的假設撐著 | `mut` **M17** |
| 後置 **①a2** | ⚠️ 標「未驗:sed 搬不動」 | **有靶了**:不必搬,**插入**一顆 advisory 讓 i_adv 前移即可 —— v7 那句是**假的誠實缺口** | `mut` **M23** |
| 後置 **④** | 整串相等 | 同左 ➕ **檔內補上誤擋症狀與值班動作**(P4/P7 都寫了,只有它漏) | `mut` **M3/M4** |
| **P5b** | ⚠️ 標「本機恆綠、負測紅不了」 | **有負測了**:`CREATE ROLE` + `ALTER FUNCTION … OWNER TO` 就只紅它;v7 說「會觸動 P3b 與後置③」是**推的不是量的** | `neg` **N11b** |
| **終局述詞** | 無靶(①e-1 明文不守述詞內部關聯) | **有靶了**:關聯條件改錯 ⇒ C2/C2b/C2c/C3 翻紅 | `mut` **M24** |

**回退腳本 v7 → v8:**

| 閘 | v7 形狀 | **v8 現況** | 負測 |
|---|---|---|---|
| 閘① 剝註解 | 先剝 `/* */` 再剝 `--` | **順序反過來**(先 `--` 後 `/* */`)➕ **另掃一次未剝除原文**,兩者不一致就停下讓人判。v7 的順序是 **fail-open**:`--` 註解或字串含 `/*` 會讓區塊剝除吃掉真正的 INSERT | `neg` **N7c** |
| 閘① 動詞 | 只認 `INSERT\|MERGE INTO` | ➕ **`UPDATE` / `COPY`**(2g 可能用 UPDATE 推進在途狀態;顯式名單至今為空 ⇒ 不能再窄) | — |
| 閘 **②c** 核准 | 綁**筆數** | **綁身分指紋** `md5(string_agg(id ORDER BY id))`:count 不變而換了一組人 ⇒ 放行的是**沒有人看過**的在途列(動錢不可逆)➕ 核准值不得被 `ALTER ROLE/DATABASE` 常駐(查 `pg_db_role_setting`) | `neg` **N5c/N5d** |
| 閘 **②c** 留痕 | 只有 `RAISE WARNING` | ➕ **寫一列 `admin_audit_log`**(包 EXCEPTION:寫失敗只警告、**不擋回退** —— 災難當天回退能力優先於留痕) | `neg` **N5d-audit** |
| 🆕 **②c-recheck** | (無) | 還原做完、COMMIT 前**再量一次指紋**:本腳本對 payment_refunds 無鎖,讀完到 COMMIT 之間新列仍可能進來。**窗口縮小、不是關閉** | — ⚠️ 未配(需雙連線競態構造) |
| 回退後置 proconfig | 子字串比對(含/不含兩個 LIKE) | **整串相等**(用同檔既有的 `c_pre_proconfig`):v7 擋得住「lock_timeout 沒消失」,擋不住「多了一個 `SET row_security = off`」 | `neg` **N7b** |

---


## §8 測試設計與突變靶(`scripts/l5b2-2f-verify.sh`,形制沿用 2e 的四模式 **+ v6 新增 `neg`**)

`all` / `run`(正向+負向格)/ `rb`(rollback 三態)/ **`mut`**(每靶一座全新叢集、CHECK-before-read)
/ 🆕 **`neg`**(v6 新增)。

🔴 **`mut` 與 `neg` 是兩個不同的失效面,不可互相替代**(diff 層 R1 折疊時才補上):
- `mut` 改的是**檔**(migration 被寫壞)——sed 突變 migration 再 apply。
- `neg` 改的是**庫的狀態**(依賴的索引 / 狀態機 trigger / 既有 COMMENT 被別人動過)。
  P6b / P6c / P7 與回退閘②b / ②c 守的正是庫的現況,**那些失效路徑 sed 不出來**
  ⇒ v5 之前這五道守門**一條負測都沒有**,只證明了「正常狀態下它們不擋人」。
  數法(v7 現況):`grep -c '^    "s/' scripts/l5b2-2f-verify.sh` = **22**(v6 那次寫 12 是**落後成品的舊數**,
  diff 層 R1 第二輪逐字抓到 —— 數字寫下的那一刻就開始過期,引用前重數一次),即 mut 的靶**全部**是 sed 檔案的靶、
  無一改庫狀態;那五道守門的 constraint 名(`l5b2_2f_status_machine_enabled` / `..._pinned` /
  `l5b2_2f_single_flight_index` / `l5b2_2f_rb_third_state_sidecar` / `l5b2_2f_rb_refund_in_flight`)
  在本檔內**只出現在 `mode_neg` 的格裡**,mut 靶清單一個都沒有。
  數法逐字(v7 重驗,五個名字逐一跑):`grep -c "^    \"s/.*<constraint 名>" scripts/l5b2-2f-verify.sh` = **0**;
  同名在全檔的出現數 = 4/1/3/3/2(全部落在 neg 格與其還原句)。
- `neg` 的每一格都附**舊形狀對照**(舊守門判綠 = 假綠、新守門判紅),
  否則只印「新的擋住了」證不到判別力屬於新形狀。

**必備格(每條守門配自己的靶,紅格由_實跑_決定不由預測)**

| 面 | 格(v2) | v1 錯在哪 |
|---|---|---|
| **序列化** | 🔴 用 `pg_locks` **直接觀察 advisory 鎖本身**(`locktype='advisory'`、`classid`/`objid` = 鍵的高低 32 位),不用「第二條有沒有排隊」推論 | R1 IMP5:v1 那格拿掉 advisory **照樣綠** —— 第二條會被既有 `FOR NO KEY UPDATE` 擋在步 3。**量到的是列鎖不是 advisory** |
| **死結消融** | advisory 移回步 3 之後 ⇒ **必須觀察到 `40P01`**;55P03 不算紅(§4-1) | R1 MF5 |
| 🆕 **鎖鍵等價** | 同一張單分別由 2e 與 2f 取鎖 ⇒ `pg_locks` 看到的 `(classid, objid)` **必須同一組** | R1 MF4:v1 完全沒有這個面 |
| 否決 | 構造 `payment_refunds` 父列無終局 ⇒ `REFUND_IN_FLIGHT`;補終局事件 ⇒ **放行且拿到 `INITIATED` + 真的多出一列 + 金額正確** | R1 MF9:v1 只驗「不再回 IN_FLIGHT」= 沒退款也算放行 |
| 🆕 **合法第二次部分退款** | 前一筆部分退款**已終局** ⇒ 第二筆**必須 `INITIATED`** 並 INSERT 出新列 | R1 MF9;這正是母 plan `:325` 記載 v5 曾寫錯的那條述詞,**必須有正向對照** |
| 🆕 **沿鏈重試不封單**(R2 MF-B) | 舊列 `result_unknown`(無終局)+ 新列 `supersedes_refund_id` 指向它 **➕ 新根自己帶一筆終局(`result_failed`)** ⇒ **必須放行**;拿掉 §3-2⑥ 那條排除 ⇒ **必須翻紅** | 沒有這格,本片會把設計內的重試路徑變成永久封單而全綠。<br>🔴 **v4 修 fixture(R3 F1)**:v3 的 fixture **沒給新根終局** ⇒ 新根自己「無終局、未被接手」⇒ **正確實作也會擋在新根上**(正向格紅在對的 code 上),而拿掉排除的突變**同樣**輸出 `IN_FLIGHT` ⇒ **兩臂不可分辨、零判別力**。這正是我上一輪自己寫下的「折 finding 順手寫的新格沒自己走過」那族 |
| 🔄 **受理未確認須放行**(R2 MF-C → Sean Q-2f-2=B) | 只有 `result_success` 沒有 `result_confirmed` ⇒ **必須放行、拿到 `INITIATED`**;拿掉 success 排除 ⇒ **必須翻紅** | 🔴 **v5 整格反向**(R3 F6):v3 寫的是「仍擋」=**選 A 的語意**,Sean 拍 B 之後那格會變成**測試在替一個已被推翻的規格站崗**、而且全綠 —— 正是「斷言量錯東西」第七形狀,正式站踩過一次 |
| 🆕 **兩條排除各自可分辨**(R3 F6) | ①只有 success 的列 ②只有被接手的列 —— **兩個 fixture 分開造,不得同時滿足兩條**;各配「只紅它」的突變 | fixture 同時滿足兩條 ⇒ 拿掉任一條都還有另一條擋著 ⇒ 重演 F1 的兩臂不可分辨 |
| 🆕 **`p_order_id IS NULL`**(R2 N1) | 實跑須回 `ORDER_NOT_FOUND`(不是 RAISE、不是別的碼) | v2 只有推論說「無害」 |
| 否決語意 | 同 `request_id` 重播 + 身上掛在途退款 ⇒ **仍拿 `DUPLICATE_REQUEST`**(證 B 排在 G4 之後) | — |
| 否決尺度 | 同單**另一顆 attempt** 的在途退款也擋 | — |
| 🆕 **回傳碼全集** | ①靜態:從 `prosrc` 抽出**所有** `'result',` 後面的字面,集合 ⊆ 8 碼 ②動態:各格輸出 ∈ 8 碼 | R1 IMP6:v1 只有動態抽樣 —— 抽樣證不到「不存在第 9 碼」,靜態抽取才是全稱 |
| lock_timeout | 他人先佔住**同一把 advisory** ⇒ ② 在 **§10 拍板值** 附近失敗而非無限等。<br>🔴 **v7 才真的實作**(`run` 的 **L2** 格):v6 只有 catalog 值檢查(A2/A2b)= 只證「設定寫著 10s」,證不到「真的等到 10 秒就放手」。量法 = 背景連線持鎖 30 秒、本連線呼叫 2f、量 elapsed 並要求訊息含 lock timeout;期望窗刻意寬(8-20 秒)—— 要證的是量級不是毫秒準度 | R1 MF10:v1 寫死 3s;diff 層 R1v6:規格要實測、harness 只有 catalog |
| 屬性保留 | §5 整張表逐欄(不只五欄) | R1 IMP7 |
| **前置閘 P1-P8** | 🔴 **每一道各自一個負測**,見下 | R1 MF8 |

### 8-1 前置閘的負測(R1 MF8:v1 §13 宣稱「P1-P7 每道有負測」,§8 只給了三道 ⇒ 驗收條件當時不可能達成)

| 閘 | 負測(要能只紅它) |
|---|---|
| P1 | ①餵錯 2e md5 ②`ALTER FUNCTION` 拿掉 2e 的 `lock_timeout`(`prosrc` 不動)⇒ **仍須擋** |
| P2 | 改一個字元的 ② pre-image |
| P3 | `ALTER FUNCTION ... IMMUTABLE`(改 `provolatile`)⇒ 須擋 |
| P4 | `CREATE OR REPLACE VIEW` 成「每列都終局」⇒ 須擋(**這是 v1 完全擋不住的那個**)。🔴 **v2 的第二個負測(整個 DROP)已刪**(R2 IMP-1):view 缺席本來就 `42P01` fail-loud ⇒ 拿掉 P4 那個觀察照樣出現 = **零判別力**,屬「觀察被別的機制供給」族 |
| P5 | 對 `payment_refund_events` 開 `FORCE ROW LEVEL SECURITY` ⇒ 須擋 |
| P6 | ①改 CHECK 值域 ②`ALTER TABLE ... DISABLE TRIGGER` 狀態機 ⇒ **兩者都須擋** |
| P7 | ①`DROP INDEX` ②同名重建但 predicate 改成 `status='confirmed'` ⇒ **兩者都須擋** |
| P8 | 重下 COMMENT 時截掉舊全文最後一句 ⇒ 後置須紅 |

⚠️ **P5 的既有難處要照實寫**(R1 IMP2 後半):正式庫 `postgres` 目前 `bypassrls=true`
(`P-578-A` §1 實查)⇒ FORCE RLS 的**行為層災難在本機構造不出來**,負測只證得到「catalog 條件被讀到」。
⇒ P5 是**結構型早期預警**,與 2e 的 A12 同性質。**不得宣稱它擋住了行為層的洩漏。**

**突變靶**:每條斷言配一個「只紅它那一條」的突變(拿掉 advisory / A 移到步 3 後 / B 移到 G4 前 /
鍵式子截 15 字 / 省略 `lock_timeout` / 省略 `search_path` / 省略 `SECURITY DEFINER` / view 換成恆終局 /
索引改 predicate / 狀態機 trigger disable / COMMENT 截尾 / 否決改成 rec_trade_id 尺度)。
🔴 **消融必須等長同形**;紅格數以**實跑輸出**入表,**不預測**。

---

## §9 誠實邊界(沒有機制的不宣稱擋住)

1. **否決條件現在恆假** —— `payment_refunds` 無 writer(2g 未建)⇒ 正式庫上線後**行為零變化**,直到 2g 上線。
   它的價值是「2g 上線那天已經在位」,不是「今天擋住了什麼」。
   ⇒ 連帶:§8 所有否決相關的格**驗的都是 harness 直接 INSERT 造出來的假資料**,不是跑真流程長出來的。
2. **advisory 隨交易釋放的前提 = 單語句交易 —— 已實查,但射程有限**(v1 寫「實作時要查」,v2 查完了)。
   唯一呼叫點 `apps/admin/src/lib/payment/refund-repository.ts:195` 走
   `createSupabaseServiceClient().rpc(fn, {...})` = PostgREST 單一 RPC = **單語句交易**。
   🔴 **這只證「目前唯一的呼叫點是它」**,不是禁止(R1 IMP1)。**失效條件**:任何人把它包進多語句交易
   (應用層 BEGIN、SQL Editor 手跑、未來的 batch 腳本)⇒ advisory 會持到那個外層交易結束,
   而外層交易可能持有別的資源 ⇒ **AB-BA 從函式外面重生**。
   ⚠️ **做不成守門**:函式內看不到自己被誰包著(`pg_catalog` 沒有「我是不是隱式交易」這個問題的可靠答案)
   ⇒ **改成把這條前提寫進 COMMENT**,讓下一個人在改呼叫端時看得到。**不假裝有機制擋住。**
3. **order 尺度的過度阻擋**(§3-2③):同單多 attempt 時會擋到不相干的那顆。fail-closed,但**是行為改變**。
4. 🆕 **卡住的補償退款會永久擋住這張單**(§3-2③ 後半,R1 MF3)—— 沒有機制保證終局會到達,唯一出口是人工。
   **2g 的硬前置**,不是本片能收的。
5. 🆕 **`attempt.order_id` 可變**(§3-2⑤,R1 MF2)—— order 尺度的漂移洞,時點觀察非不變量,與 2e 共用同一假設。
6. 🆕 **員工看到的那句話對新那半是假的**(R1 IMP9,我自查也獨立命中):
   `REFUND_IN_FLIGHT` → `refund-actions.ts:290-291` → `refund-action-state.ts:123-124` 逐字
   「…**若超過 30 分鐘未完成,會出現在異常清單**」;而異常清單 `refund-read.ts:121` 逐字 `.from('order_refunds')`
   ⇒ **它看不到 `payment_refunds`**。阻擋源是新那半時,那句承諾**永遠不會兌現**,
   且員工**無從分辨**兩種阻擋源(`blocking_payment_refund_id` 在 caller 被丟掉)。
   ⇒ 本片**不改應用層**(片界:一片=一支 migration 或一個純應用層改動,不混;
   且 memory `feedback_app-layer-must-not-ship-before-migration-apply`)⇒ 列 **2g 硬前置** + backlog。
   ⚠️ 同 §9-1:2g 前不可達;**失效條件 = 2g writer 進庫**。
6a. ~~**2g 之後,「每筆正常成功的補償退款都會擋這張單約一天」**~~(R2 MF-C)
   🏁 **已被 Sean `Q-2f-2`=B 消滅,本條**不再是現行行為**(diff 層 R1 C 段點名:此段與實作相反)。**
   當初的推論成立於 A(擋)案:`result_success`(TapPay 已受理)**不是**終局(`20260811110000:197-198` 逐字)、
   `result_confirmed` 隔日才到 ⇒ 受理到確認之間該單員工退款一律 `REFUND_IN_FLIGHT`。
   **B 案把 `result_success` 直接排除在「在途」之外**(migration 的第三條 `NOT EXISTS`,
   `20260812170000` 步 6 之後那段;harness C4 格實跑 = `INITIATED`)⇒ **擋一天的情境不會發生。**
   🔴 留著這段是為了保留推論鏈,**不是描述現況** —— 引用本節前先看這兩行。
   B 換來的代價寫在 §9-7 與 backlog #442(從「永久擋單」變「永久隱形」)。
7. 🔴🔴 **Σ 超退:TapPay 從「最後防線」變成「唯一防線」**(R3 F2;Sean Q-2f-2=B 之後)。
   母 plan `:339-341` 把 TapPay 伺服器端原子拒絕寫成**最後**防線 —— 那句話成立的前提是前面還有別的防線。
   **B 之下前面沒有了**,而這道唯一的防線有**兩個洞疊在一起**:
   - ① **只有 sandbox 實證**,正式環境從未驗過(母 plan 逐字,本 plan 不改寫成已驗)。
   - ② 🔴 **partial 路徑根本不查任何帳**:`v_frozen := p_amount`(`20260803150000:485` 逐字)——
     員工輸入多少就是多少,**不對 `order_refunds` 加總、不對 `payment_refunds` 加總**。
     (full 走 Record 剩餘額,但 Record 對「已受理未結算」是否即時反映 **未確認**。)
   ⇒ **本片不宣稱任何本地超退防護。** 這件事已升級成 **backlog #445**(Sean 2026-08-12 拍板要做、排 2g 前)。
   ⚠️ **這句要在 apply 停點對 Sean 講**,不是只寫在文件裡(R3 F2 第二件)。
8. **P2/P3 的值是「實作日重量」** —— 本 plan 引用的 `f98e25f5…` 是母 plan §1 當日的值,
   §5 那族屬性欄**現在根本沒量**。落進 migration 前必須自己量一次,**不轉抄、不猜**。
9. 🆕 **`lock_timeout` 逾時目前是「無名失敗」**(R1 IMP10):超時之下員工只拿到 generic failure、
   系統只留 generic log;母 plan §3a-11 的具名診斷與排隊可觀測性**要到後片才有**。
   ⇒ 2f apply 之後到那片之間有一段**風險窗**:真的開始逾時了,值班第一時間看不出原因。
   **這件事要在 apply 停點對 Sean 講**(§10 Q1 的下層資訊),不是埋在文件裡。
10. 🆕 **連線拓樸是回退能力的前提**(v9;diff 層 R3 MF1)。閘②c 的核准出口靠 session GUC 跨語句存活,
   而 **Supabase 預設常給的是 transaction pooler(6543)** —— 那條路上 `-c` 與 `-f` 可能落在不同 backend
   ⇒ `current_setting` 恆 NULL ⇒ **指紋帶對也永遠被擋**。
   ⇒ 回退**必須直連 / session mode(5432)**;這句已寫進 rollback 檔頭與 ②c 的失敗訊息
   (訊息會直接告訴值班「這是拓樸問題不是你抄錯」)。
   ⚠️ **未確認**:Supavisor 目前版本對 session GUC 有沒有轉發特例(沒連正式環境驗過)——
   不影響處置(前提寫下來就不會在凌晨被誤判成人為疏失),但不得寫成「已驗證 pooler 不行」。
11. 🆕 **前置閘 P1-P8 的保證只活到 COMMIT 那一瞬**(v9;diff 層 R3 IMP)。
   apply 之後 canonical view 被換、狀態機 trigger 被停、single-flight 索引被砍 —— **全部零偵測**,
   直到下一支 migration 跑過或事故爆開為止;而本片的否決語意整個騎在這些物件上。
   ⇒ **本片不做**排程探針(那是新工作面,主視窗裁定不塞進來);方向記在 backlog(由主視窗發號):
   把同一批唯讀檢查抽成**可排程探針**,比在 apply 再加第九道閘值錢。
   🔴 這條的意思是:**「apply 當天全綠」不等於「明天還綠」** —— 引用本片的守門結論時要帶上這個時效。
12. 🆕 **行為靶的證據全部產自 macOS / PG 17.10 臨時叢集**,而正式庫是 Linux / 17.6(v9;R3 nit)。
   版本差只在 P4 viewdef 那顆講過;`mut` / `neg` 的**平台可攜性假設之前沒寫**。
   前科擺在那裡:`pg_trgm` 對中文在 macOS 抽零 trigram、Linux 正常(memory 有整條)——
   **本機綠不等於 Linux 綠**。⇒ 引用本片實跑數字時,一律帶上「本機叢集」這個限定詞。

---

## §10 決策題(Sean 拍板;一次批次)

> ### 🏁 已拍板(2026-08-12 晚):**`lock_timeout = '10s'`**
>
> 主視窗轉達 + memory `project_0812-fuzzy-logdrain-dirty-decisions.md:38` 逐字:
> 「**Q-2f-1=A(08-12 晚)**:2f 沖銷否決搶鎖 `lock_timeout` = **10 秒**(照推薦;
> 3s 尖峰易誤報、不設上限員工畫面卡死等)。寫進 20260812170000 的 SET 子句」。
>
> 🔴 **代號與選項字母不符,以「值」為準,不以字母為準**:
> 本節的選項是 **A=3 秒 / B=10 秒 / C=不設**,我推薦的是 **B**。
> 落檔字面寫「=A」但值寫「10 秒」+「照推薦」+ 理由同時否掉 3s 與不設
> ⇒ **三處互相印證,實際拍板值 = 10 秒 = 本節的 B**。字母 A 是筆誤。
> ⚠️ **不改掉這條註記** —— 後人若只引「Sean 拍了 A」再回頭讀本節,會讀成 3 秒,**方向剛好相反**。
> 已請主視窗更正 memory 那一行。
>
> **實作照 10 秒寫**:`SET lock_timeout = '10s'`;§7 後置與 §8 測試比對的「採用值」= `10s`。
> 與母 plan `:393`「建議 **3s**」的字面差異 → 記進 §11(偏-3a)。

> 🔴 **v2 修掉一個壞題**(R1 MF10):v1 把 `3s` 寫死進 §7 後置與 §8 測試,但選項有 B(10 秒)與 C(不設)
> ⇒ **Sean 只要不選 A,驗收條件就自己永遠不可能達成**;C 另外**直接違反母 plan `:393`「三方都設」**。
> 這正是 memory `feedback_decision-option-must-be-traced-to-end-state` 那條 —— 我又把沒走到終態的選項端上桌。
> **v2 修法**:①後置與測試改成比對「**本片實際採用的值**」,三個選項都到得了終態
> ②C 選項附上它與母 plan 衝突的事實,由 Sean 明知而選,不假裝它是等價選項。

```
Q-2f-1: admin_initiate_order_refund 加的等鎖上限要設多少?
  這支是後台「送出退款」按下去走的那支。設了之後,若同一張單同時有別的操作
  佔著,員工會在等待 N 秒後看到失敗訊息,而不是像現在一直轉圈等成功。
  A) 3 秒 — 與 2e 一致、卡住時最快讓員工重試;代價=正常的短暫競爭也可能被判失敗
  B) 10 秒 — 先設寬,上線後看實際觀測再收斂(母 plan 建議的保守路)
  C) 不設 — 維持現況無限等。注意:這與母 plan「三方都要設」的約定衝突,
     等於本片放掉 idle-in-transaction 排隊那道防護,要明知而選
A: A|B|C
```

> 🏁 **本題已收 = 10 秒**(見本節檔頭)。
> 🔴 **C 是死路選項,如實標註**(R2 MF-D):選 C 之下,§7 後置 5(`proconfig` 必須含 `lock_timeout`)
> 與 §8 的逾時格**兩條恆假** ⇒ 驗收條件不可能達成。v2 §10 曾寫「三選項都到得了終態」——**那句話不對**,
> 正確的是「**A/B 到得了,C 到不了**」。C 若真被選中,正確做法是**回頭改驗收條件**,不是硬跑。
> 留著這段是為了讓後人看到「這題當時有一個選項是壞的」,不是為了美化 v2。

**我的推薦 = B。** 理由:2e 的 grantee 只有 owner(Sean 自己人工跑),3s 卡住只影響一個人;
② 是**員工日常操作路徑**,而 3s 這個值**沒有任何量測依據**(母 plan `:398` 自陳)。
先寬後收的代價只是「排隊多忍幾秒」,設太短的代價是**員工被誤判失敗、重複送單**。
⚠️ 兩者的 `lock_timeout` 不同**不影響互斥正確性**(它只影響「等多久放棄」,不影響「誰先進隊伍」)。

🔴 **選 A 或 B 都要在 apply 停點附帶講一句**(§9-9):逾時目前是**無名失敗** ——
員工只看到 generic 失敗訊息、值班在 log 裡也分不出「是等鎖等太久」還是別的錯,
具名診斷要到後片才有。這段風險窗是明知的,不是漏掉的。

### 🆕 Q-2f-2(R2 MF-C 升級而來;**這題會改變員工每天做得到什麼**)

**事實鏈(三處逐字,全部親開)**
1. 終局集合 `20260811110000:201` = `result_confirmed / result_failed / manual`。
2. 同檔 `:197-198` 逐字:「`result_success` 之後**不再是終局** ⇒ 一顆 refund 可以先有 `result_success`
   (**已受理**)、再有 `result_confirmed`(**隔日確認**)」。
3. memory `reference_tappay-integration-reference`:**TapPay 退款隔日生效**。

⇒ 一筆**完全正常、成功**的補償退款,從「TapPay 受理」到「隔日確認」之間**算在途**
⇒ 依本片述詞,**那張訂單的員工退款在這段期間一律被擋**。2g 上線後這是**主要情境,不是異常**。

🔴 **這不是我偏離母 plan** —— 母 plan 對「在途」的定義(`:354`「父列存在且無終局事件」)就是這個結果。
但它的**營運後果**母 plan 沒算過,而後果落在員工身上 ⇒ 交 Sean。

```
Q-2f-2: 補償退款「已送出、TapPay 已受理、但要等隔天才確認」的這段期間,
        這張訂單還能不能再做退款?
  背景:退款送到 TapPay 後,對方當下只回「收到了」,真正確認要到隔天。
        補償退款是系統自動幫忙補送的那種(下一片 2g 上線後才會有)。
  A) 擋住 — 這段期間員工對這張單送退款會看到「已有退款處理中」,要等隔天。
     好處:絕不可能同一張單重複退到錢。代價:正常情況下也會擋約一天,
           員工當天想再退第二筆(例如客人加退運費)得等。
  B) 放行 — 只要 TapPay 已受理就不算在途,員工可以繼續退。
     好處:不影響日常作業。代價:同一張單可能同時有兩筆退款在飛,
           金額由 TapPay 端擋(超額會被拒),但我們本地帳面會短暫看到兩筆在途。
  C) 擋住,但給員工一個出口 — 畫面上告訴他「這張單有一筆退款等確認中,
     預計明天完成」,並讓值班可以看到清單。(需要多做一片後台頁面,2f 不含)
A: A|B|C
```

> ### 🏁 已拍板:**Q-2f-2 = B(放行)**(Sean 2026-08-12;memory `project_0812…` #23)
> 已受理未確認**不算在途**、員工可繼續退,防重複退交 TapPay 端。
> Sean 知情的代價(題文 B 選項逐字):「本地帳面會短暫看到兩筆在途」。
>
> 🔴 **我在 A 選項裡寫了一句過大的宣稱(R3 F8)**:「**絕不可能同一張單重複退到錢**」——**不成立**。
> 親驗 `20260803150000:723-730`:`admin_finalize_order_refund` 在 `p_outcome='accepted'` 且金額相符時
> **當下就把 `order_refunds` 翻成 `confirmed`**,而 single-flight 唯一索引只擋 `status='processing'`
> ⇒ **今天本來就可以同一張單同日再開一筆**。A 並不提供我宣稱的那種絕對性。
> ⚠️ 誤導方向**偏向 A**,而 Sean 拍的是 B ⇒ **不重問**,但字面必須改正(這是我寫的題,錯是我的)。
>
> ✅ **同一次查證挖到一件支持 B 的事實(Sean 值得知道)**:兩本帳對「受理」的處理**本來就不同** ——
> `order_refunds` 受理當下即 `confirmed`(終局);`payment_refunds` 的 `result_success` 卻不是終局
> (`20260811110000:197-198`)。⇒ **選 B 讓 2f 與 `order_refunds` 既有行為一致**,
> 選 A 反而是在同一張單上放兩把寬嚴不同的尺。B 不只是「接受風險」,也是「對齊現況」。

**我原本的推薦 = A**(已被 B 取代,保留原文與但書供追溯):A 的代價是真的(擋一天),而 C 才是「既安全又不擋人」的完整解,
只是它要多一片後台工。若你選 A,我建議把 C 的那片直接排進 2g 之前 —— 因為 **2g 上線那天 A 的代價才會開始發生**,
在那之前完全沒有影響。**選 B 我不推薦**:它把「不會重複退」這件事整個交給 TapPay 端,
而我們對正式環境的超退拒絕**只有 sandbox 實證**(§9-7)。

⚠️ **這題不擋 plan 審查,擋實作**(述詞要不要加 `result_success` 例外,寫法不同)。

---

**無需 Sean 拍的(我自己決定、審查會打)**:複用 `REFUND_IN_FLIGHT`(§3-2①)、走回傳碼不走 RAISE(§3-2②)、
order 尺度(§3-2③)、沿鏈舊列排除(§3-2⑥)、B 的位置(§3-2a)、不做 `order_refunds` 那半(§1-4)。

---

## §11 🔴 與母 plan **字面**的偏離清單(主視窗 `P-580-A` §2 硬要求;關卡1 prompt 會點名讓 codex 專審這一節)

> 偏離母 plan 的地方 = 審查最該打的面。**逐字列母 plan 原句 vs 本片實作**,不摘要、不美化。

### 偏-1 否決的**尺度**:母 plan 寫 rec_trade_id,本片做 order

**母 plan `:330-331` 逐字**
> 「這張單的這顆 `rec_trade_id`,在 `order_refunds` 或 `payment_refunds` **任一本**,
> 有**在途(未達終局)**的退款」⇒ **不開新的**。

**本片實作**:`JOIN payment_charge_attempts a ON a.id = pr.attempt_id WHERE a.order_id = p_order_id` —— **order 尺度**。

**理由(三條,§3-2③ 全文)**:①`payment_refunds` 沒有 `order_id` 欄(`20260810140000:79`)②`payment_refunds.rec_trade_id`
**nullable**(`20260811080000:239`、`:290` 逐字「刻意」)⇒ rec 尺度會漏掉 NULL 列 = **否決有洞**
③既有 `order_refunds` 那半的唯一索引本來就是 order 尺度(`20260803150000:197-198`)⇒ 選 order = 兩本帳同尺度。

**這個偏離帶來的行為差**:同一張單有多顆 attempt 時,A 顆的在途補償會擋住 B 顆的新退款(母 plan 字面**不會**擋)。
方向 fail-closed。**已入誠實清單 §9-3。**

> 🔴🔴 **v3 在這裡刪掉一句撤回過的保證(R2 MF-A)**:v2 這行原本還留著
> 「且在途必然走向終局 ⇒ 暫時性阻擋,非永久封死」——**那正是 §3-2③ 已宣告刪除的同一句**(R1 MF3)。
> 我當時只改了被 codex 點名的那一段,沒 grep 全篇 ⇒ `feedback_claimed-sync-but-only-patched-touched-lines`
> **字面重演,第 10 次**。而且它不是裝飾句:它是「**所以不必做人工出口**」的理由,
> 留著就等於用一個已知為假的前提替一個省略辯護。
> **v3 的機械處置**:`grep -n '必然走向終局\|非永久封死\|暫時性阻擋'` 全檔掃 ⇒ 命中兩處、
> §3-2③(宣告刪除那處)保留、本處刪除,收工前再掃一次確認歸零(§15)。

**這個偏離的真實射程(R2 之後)**:
- 合法的第二次**部分**退款:**不會**被擋 —— 母 plan `:326` 的合法多次部分退款是**前一次已達終局**才開下一次。
- ⚠️ **但「已達終局」比想像窄**:`result_success`(TapPay 已受理)**不是**終局(`20260811110000:197-198` 逐字)
  ⇒ 受理到隔日確認之間**會擋**。這是 **Q-2f-2**(§10),不是我能自己裁的。
- ⚠️ 走過設計內重試鏈的舊列本來會**永久**擋 ⇒ 已由 §3-2⑥ 的排除條件修掉(R2 MF-B)。

### 偏-2 母 plan **沒寫**「`order_refunds` 那半已經存在」⇒ 2f 只新增 `payment_refunds` 那半

**母 plan 字面**:`:330` 的「**任一本**」讀起來像兩本都要新做;**全篇未提** `order_refunds_single_processing_per_order`。

**實查**(§1-4):`REFUND_IN_FLIGHT` 早在 8 碼全集內(`20260803150000:416`),現行由步 8 INSERT 撞唯一索引
`order_refunds_single_processing_per_order`(`:197-198`)收斂而來(`:558-560`)⇒ **`order_refunds` 那半已有 DB 權威在擋**。

**本片實作**:**不動** `order_refunds` 那半,只新增 `payment_refunds` 那半;複用 `REFUND_IN_FLIGHT` 不加第 9 碼。

**理由**:再加一道「查 order_refunds 有沒有 processing」會被那條唯一索引**嚴格蘊含** ⇒ 寫不出只紅它的負測
(memory `feedback_unconstructible-negative-test-means-noop-guard`)。新增回傳碼則會破壞 `:414-418` 逐字要求
「呼叫端必斷言 ∈ 全集」的已上線合約。

### 🔴 偏-2a v1 在這裡的自答是**錯的**,關卡1 打中(R1 MF1)

v1 我自答:「步 5-7 只有讀取與產鍵,無外呼、無寫入 ⇒ **等價**」。**這句話錯了,而且我親驗過才確認它錯。**

**反證(親開本體,不是轉抄 codex)**:`20260803150000:538-539` 逐字
```sql
IF p_kind = 'full' AND v_frozen < 1 THEN
  RETURN jsonb_build_object('result', 'REFUND_NOTHING_LEFT');
```
⇒ 一張單已有 `order_refunds.processing`、又以 `full` + `p_record_amount=0` 呼叫時:
**現行**在步 6 就回 `REFUND_NOTHING_LEFT`,**根本走不到步 8**,拿不到 `REFUND_IN_FLIGHT`;
若照母 plan 字面把 order_refunds 那半提到步 4 之後,同樣輸入會拿到 `REFUND_IN_FLIGHT`。**兩者不等價。**

🔴 **而且分歧不只 codex 舉的那一個**:步 5 還有三個早退碼(`:527-535`)——
`REFUND_LEDGER_FULL` / `ORDER_NOT_REFUNDABLE` / `ORDER_NO_CARD_TRANSACTION`。
⇒ **共四種輸入下,早擋與晚擋的回傳碼不同**。我的自答漏掉了整個步 5。

**結論改寫(決定不變、理由換掉)**:不加早期 order_refunds 檢查**不是因為等價**。

🔴 **理由分成兩半,出處不同,不混講(R2 IMP-5:v2 把整段講成「現行優先序是刻意的」= 借了不存在的權威)**

| | 內容 | 地位 |
|---|---|---|
| **有出處那半** | 本體 `20260803150000:419-420` 逐字只宣告了**一條**優先序:「**G4 必須在 G12 之前**」(關卡2 codex MF4) | **合約**,不可動 |
| **我判斷那半** | 「步 5/6 的四個具體診斷應優先於籠統的 `REFUND_IN_FLIGHT`」 | 🔴 **我的判斷,全 repo 查無出處**。理由:那四碼告訴員工**下一步該做什麼**,`IN_FLIGHT` 只告訴他等 |

⇒ **不得寫成「現行優先序是刻意的」** —— 現行那個順序是「步 8 才撞索引」的**副作用**,不是有人特意排的。
v3 改寫成:**我選擇保留它,理由是診斷品質,而這是判斷不是合約。**

✅ **而且 v3 把這條判斷貫徹到底了**:v2 說「本片新增的否決放步 4 之後,對它自己有同樣的分歧」
然後就停在那裡 —— 等於**一邊論證診斷優先、一邊自己製造相反的行為**。
v3 依 R2 MF-E 把 B 移到步 6 之後(§3-2a)⇒ **那個自我矛盾與那個行為改變一起消失。**

### 偏-5 🆕 認 `result_success` 為「不必再擋」——**有一句已上線的註解明文警告過這個模式**

**`20260811110000:206` 逐字**
> 「🔴 **2e 的排除條件必須認 `result_confirmed` 而不是 `result_success`,否則訊號會提前消失**(母 plan §4b)。」

**本片實作**(Sean Q-2f-2=B + 複判維持):否決排除 `result_success`。

**為什麼不算違反**:那句話的主詞是 **2e**,2f 是另一支函式;兩者的後果可逆性不同(§12-0)。
**但理由是通用的** —— 任何消費該 view 的否決,認 `result_success` 就是讓訊號提前消失。

🔴 **Sean 的知情狀態,照實記(這是本條存在的主要理由)**:
他拍板時**知道實質代價**(題文 B 選項逐字:「同一張單可能同時有兩筆退款在飛…本地帳面會短暫看到兩筆在途」),
**但當時不知道有這句寫下來的警告**。我在拍板後發現、**主動報回主視窗轉呈**,
Sean **複判維持放行**(2026-08-12)⇒ **現在是知情之下的決定**。
⚠️ 記這條不是為了留後路,是因為「他權衡的是我描述的風險」與「他權衡的是我們自己寫下的警告」**不是同一件事**。

**訊號提前消失的實際後果已經找到了**:就是 **#442 的隱形卡單**(§12-1)——
訊號消失 ⇒ 卡住的補償退款不再擋單 ⇒ 也不再被任何人看到。那句警告是對的,只是後果落在可見度上,不是正確性上。

### 偏-4 🆕 B 的位置:母 plan **圖示**畫在步 5 之前,本片放步 6 之後(R2 MF-E)

**母 plan `:292` 逐字(圖示)**
> ② 的 v7 順序:`1 輸入衛生 → 2 kind/金額互斥 → 🆕 advisory → 3 鎖訂單 → 4 冪等查驗 G4 → 🆕 共同否決 → 5…9`

**母 plan `:290` 逐字(約束)**:共同否決放「**步 4(冪等查驗 G4)之後**」,理由=它會拒絕、排 G4 前會改重播語意。

**本片實作**:放**步 6 之後、步 7 之前**。

**為什麼這不算違反**:`:290` 綁的是**下界**(晚於 G4);上界由「早於動錢」給,而唯一的寫入是步 8。
步 5-7 全無寫入與外呼(親開 `20260803150000:526-545`)⇒ 兩條約束都滿足。
**圖示與約束衝突時以約束為準** —— 圖示是 v7 當時順手畫的一行,`:290` 才是逐條論證過的那張表。

**換到的好處**:四個具體業務診斷優先於籠統的 `REFUND_IN_FLIGHT`,與 `order_refunds` 那半的既有優先序一致
⇒ 順帶消掉 v2 自己製造的行為改變(§11 偏-2a 末段)。

⚠️ **要認的代價**:B 越晚,advisory 之後、否決之前的視窗越長。**但這不構成正確性差異** ——
整段都在同一把 advisory 之內、同一個交易之內,沒有第二方能在中間插隊寫入。

### 偏-3a 🆕 `lock_timeout` 取 **10s**,母 plan 字面**建議 3s**

**母 plan `:393` 逐字**:「**三方都 `SET LOCAL lock_timeout`**(建議 **3s**)」。

**本片實作**:`SET lock_timeout = '10s'`(函式層 SET 子句,非 `SET LOCAL`;§3-3 已論證)。

**理由**:Sean 08-12 晚拍板(§10 檔頭),逐字「3s 尖峰易誤報、不設上限員工畫面卡死」。
且母 plan **自陳那個 3s 沒有量測依據**(`:398` 逐字「3 秒是我憑判斷選的,沒有量過…**本 plan 不假裝 3 秒有依據**」)
⇒ 這不是推翻一個有依據的值,是在兩個都沒量過的值之間選較保守的那個。

⚠️ **連帶的不一致要認**:2e 已 apply 的值是 **3s**(`20260812160000` 函式層 SET 子句)
⇒ **三方的 timeout 不再同值**。這**不影響互斥正確性**(timeout 只決定「等多久放棄」,不決定「誰先進隊伍」),
但母 plan「三方都設」那句的**隱含齊一性**已經不成立 ⇒ 2g 落地時要明確決定它自己的值,**不得預設抄任一支**。

### 偏-3(附帶,非 `P-580-A` 點名,但同性質)否決走**回傳碼**不走 **RAISE**

母 plan 通篇用 2e 的 `RAISE ... USING ERRCODE` 形制描述否決;本片改回傳碼,依據是 ② 自己的 house 慣例
`20260803150000:417-418` 逐字「業務態=回傳碼、caller bug 與完整性異常=RAISE」。**兩支形制不同是刻意,不是抄漏。**

---

## §12 相關既有紀錄與連動面

| 命中 | 連動 |
|---|---|
| 母 plan §3a-4/6a/7/9/10、§2b `:718-726` | 本片的順序、否決述詞、鎖清單、成組閘全部源自它 |
| **2e**(`20260812160000`,已 apply) | 鍵式子逐字相同;P1 釘它的 post-image;rollback 閘①同形 |
| **2g**(未建) | 它的 preflight 要**同時釘 2e + 2f 兩顆**;本片 rollback 的顯式名單等它填 |
| 沖銷片(`20260812140000`,已 apply) | 交付 canonical view;§3-2④ 的「不自行判讀 manual」是它的契約 |
| `docs/specs/2026-08-12-2e2f-precheck-recon.md` §3 | `FOR NO KEY UPDATE` vs `FOR UPDATE` 的實測表 |
| memory `feedback_unconstructible-negative-test-means-noop-guard` | §1-4 不做 order_refunds 那半的判準 |
| memory `reference_report-hash-with-algorithm-and-command` | 本片所有指紋落筆必附算法(md5 = `prosrc` 內容;檔案 SHA-1 = `shasum`) |
| backlog **#440**(2e 留的 D2b 缺口) | 不在本片範圍,但同一支 RPC 家族 —— 實作時不順手擴 |

### 🆕 12-0 **2e 與 2f 的「在途」語意分家 —— 寫明白,免得 2g 抄錯邊**(R3 F4)

| | 認什麼是終局 | 為什麼可以不同 |
|---|---|---|
| **2e**(已 apply) | 只認 `result_confirmed`/`result_failed`/`manual`(canonical view) | 它擋的是**人工結案**,結了就**不可逆**;擋住的代價幾乎為零(Sean 自己晚一天結) |
| **2f**(本片,Sean Q-2f-2=B) | **額外把 `result_success`(已受理)也當作「不必再擋」** | 它擋的是**員工日常退款**,擋一天有真代價;且後面還有 TapPay Σ 這道殘防線 |

🔴 **2g 的作者請注意:不要看到 2f 這樣寫就回頭放寬 2e。**
兩者差別**不在技術而在後果的可逆性**:2e 放寬 = 可能把身上還有未結退款的 attempt 永久結掉;
2f 放寬 = 最壞情況是同一張單兩筆退款同時在飛,而那個情況**今天本來就會發生**
(`20260803150000:723-730`,受理當下即 `confirmed`)。

### 🆕 12-1 本片推遲出去的三件事 —— **都有 backlog 載體,不只活在本檔**(R2 IMP-6)

> R2 打的是:三條 2g 推遲項只寫在一份 **untracked 的 plan §9** 裡 ⇒ 檔案沒進版控就等於會蒸發。
> 號由主視窗發(`#442`/`#443`/`#444`,台帳下一空號 `#445`)。**條目內容我寫,含「不修未來會痛在哪」**(鐵則 10)。

| # | 條目 | 不修會痛在哪 |
|---|---|---|
| **#442** 🔄 **已依 Sean Q-2f-2=B 改寫形狀(R3 F2)** | 卡住的補償退款(已寫 `result_success`、`result_confirmed` 永遠不來)**變成永久隱形** | 🔴 **這條在 B 之下比原本更嚴重,不是更輕**。<br>**A(擋)之下**:它會擋單 ⇒ 很吵、**一定會被發現**、有人會去處理。<br>**B(放行)之下**:它**不擋、也不顯示** ⇒ 沒有任何訊號、沒有人會去跑 `admin_correct_refund_manual_verdict`(`20260812140000:572`)⇒ 那筆錢的狀態**永遠停在未確認**,帳面上像沒事。<br>🔴 **B 拿掉的正是「卡住」唯一的生命週期壓力。** 修法=值班要看得到「已受理但久未確認」的補償退款。**2g 硬前置** |
| **#443** | 退款異常清單只讀 `order_refunds`(`refund-read.ts:121`),看不到 `payment_refunds` | 員工被擋時看到的文案逐字承諾「超過 30 分鐘未完成會出現在異常清單」(`refund-action-state.ts:123-124`)——阻擋源是新那本帳時**那句話永遠不會兌現**,員工照著等一場空。**2g 硬前置** |
| **#444** | `payment_charge_attempts.order_id` 無 immutable 守門 | 2e 與 2f **共用**「order_id 不變」這個假設。任何人加一條會 UPDATE 它的路徑,兩片的鎖鍵與否決尺度**同時**開始認錯單,而且**無聲**(不會報錯、只會擋錯人或漏擋) |

| 🆕 **#445** | **本地超退閘**(Sean 2026-08-12 拍板要做、**排 2g 之前**;**知情推翻拍板⑤**) | 現況**零本地防護**:partial 的金額是員工輸入、`v_frozen := p_amount`(`20260803150000:485`),不對任何帳本加總;唯一上界是 PG int32 約 21 億(`refund-form.ts:35,107`)⇒ 100 元的單可以送出 99999。而 Q-2f-2=B 之後,TapPay 是**唯一**防線,且**只有 sandbox 實證** |

**#445 要做的三件事**(給估工用):
1. 剩餘額式子**擴成兩本帳都算**(`order_refunds` 在途 + `payment_refunds` 在途),
   現行 `pcm_order_refundable_remaining`(`20260803150000:394-408`)**只算前者**。
2. 從「顯示用」升格為「守門」,並**明確決定 fail-open / fail-closed 方向**。
3. 輸入端同步:表單上界改成該單剩餘額,不是 int32。
4. 🆕 **順帶把 #442 的隱形卡單可見化**(同一個式子要能列出「已受理未確認」的補償退款)。

🔴 **#445 完成後仍不得宣稱「本地擋得住超退」** —— Sean 在 TapPay Portal 場外退的錢**永遠在帳本之外**
(`20260803150000:410` 逐字「真實剩餘額 ≤ 本值」)⇒ 只能宣稱「**擋得住本系統自己造成的超退**」。
名字大於實力的防護比沒有防護更危險(memory `feedback_control-named-beyond-its-actual-power`)。

⚠️ #442/#443/#444 在 2g 之前**都不可達**(`payment_refunds` 無 writer)⇒ 不是現在的活 bug;
**失效條件**:2g 的 writer 一進庫,#442/#443 當場變成活的;#444 是任何時候有人動那個欄。
**#445 不同 —— 它現在就是活的**(partial 超退今天就送得出去),只是本片不修。

---

## §13 驗收條件(逐條 yes/no;v2 依 R1 收緊,v3 依 R2 再收)

> 🔴 **v9 逐條回填**(commit `378b4fb9` 當下的實況)。這張表是 **Sean 唯一讀得懂的帳本** ——
> **未打勾在讀者眼裡等於未驗**,所以不能放著不填;但也**不為了好看全打勾**:
> 沒過的照 §13-4 的形狀標 ❌ 並寫明理由。
> 現況 = **☑ 18 / ❌ 2(第 4、第 14)/ 🏁 1(第 16)= 全 21 條**(含 1a/1b/1c 三條子項)。
> 數法逐字(v9 實測):`grep -c '^[0-9]*[a-c]*\. ☑'` = 18、`grep -c '^[0-9]*\. ❌'` = 2、`grep -c '^16\. 🏁'` = 1。
> 🔴 我第一版把 ☑ 寫成 16(**沒數就寫**),是上面那三條命令當場把我打回來的 —— 帳本自己也要有量法。
> 每條的證據都指得出是哪一格 / 哪一道在驗;指不出來的就不打勾。

1. ☑ migration 檔存在、版本號 = `20260812170000`(`P-580-A` 核發),**本體顯式 `BEGIN;`…`COMMIT;` 包住**(§7-0)
1a. ☑ `BEGIN;` 之後三條 `SET LOCAL`(lock/statement/transaction timeout)齊(§7-0)
1b. ☑ 🆕 **沿鏈排除條款在述詞裡**,且動它的突變**實跑翻紅**(§3-2⑥)。
    ⚠️ 形狀有變、照實記:v7 起「整段拿掉」會被後置①e-2 在 **apply 期**擋下(不再是行為靶),
    行為面改由 **M7**(關聯條件錯掉)承接,實跑紅格 = `[C3]`,恰等於期望。兩個方向都有覆蓋。
1c. ☑ 🆕 B 的位置 = 步 6 之後、步 7 之前(§3-2a),順序錨釘住(後置①b/①b2;負測 M18)
2. ☑ 前置**八道 P1-P8** 全在,且**每道有自己的負測**(§8-1 逐格,不是「大致有測」)
    🔴 **v7 更正一個高估**(diff 層 R1 第二輪逐字):v6 這裡寫「十四道、十四格,無空格」——
    那是**以閘為單位**數的,而 P1b/P6b/P7 都是**複合述詞**,一格只紅得到其中一支。
    以**子述詞**為單位重數,v6 的實際覆蓋是:P6b 四支只測了 `tgenabled`、P7 三面只測了 predicate、
    回退閘②b 三面只測了 COMMENT ⇒ 至少**六支子述詞零負測**,而驗收條款寫的是「每條守門都有負測」。
    v7 的補法見 §7-10 負測欄(N1b/N1c/N3b/N3c/N3d/N3e/N4b/N4c/N5c/N5d);
    仍為未驗的三處(P5b、①a2、⑤b)**逐條寫在 §7-10 註裡,不併進「已覆蓋」**。
    🔴 **v6 逐道對帳(含 v6 新增的 P1c 收緊 / P3b / P4b;每道都指得出是哪一格在驗)**:
    P1→`mut` M9 / P1b→`neg` N6 / P1c→`neg` N7 / P2→`mut` M13 / P3→`neg` N8 / **P3b→`neg` N9** /
    P4→`mut` M10 / **P4b→`neg` N10** / P5→`neg` N11 / P6→`neg` N12 / P6b→`neg` N3 / P6c→`neg` N2 /
    P7→`neg` N1 / P8→`mut` M14。**十四道、十四格,無空格。**
    ⚠️ **後置斷言的覆蓋是不完整的,這裡照實記**(v7 現況):①d→M1/**M21**、②→M2/M11、②a→M12、③→M5、
    ④→M3/M4、⑤→M16、⑥→M6/**M19**、⑦→M15/**M20**、鎖強度/順序→M17、🆕①e→**M18**;
    **①b(否決晚於 G4)、①b2(否決早於 INSERT)、①a2(advisory 晚於步 2)、⑤b(合約句在位)、
    ⑧(在途觀察)目前沒有自己的靶** —— 前三者要把述詞或呼叫整段搬位置,
    sed 構造得出但會連帶動到別的錨,**沒做就是沒做,不寫成「已覆蓋」**。
3. ☑ 順序錨兩發(①a/①a2 + ①b/①b2)+ **跨函式鎖鍵等價斷言**(後置②;harness B4 文字面 + **B4b 實際求值比 bigint**)
4. ❌ **本片未達成** —— 消融實跑觀察到 `40P01`(55P03 不算)。**照主視窗 `P-599-A` 裁決處置,不打勾、不降標準:**
    - 事實層:本片**從未宣稱**死結已消除;§17-3 與檔頭一直逐字寫「未證、只有結構前哨」⇒ 沒有不實宣稱。
    - 問題在**這一條當初寫得比本片範圍大**(要求實構 40P01 雙連線消融)。
    - 處置:**標記未達成 + 另立 backlog 條目承接消融實證**(條目號待這批 backlog 進 dev 後補);
      本片對外宣稱維持「**結構前哨、未證消融**」。
    - 🔴 **後續任何一代不得自行改回或悄悄打勾。** 這是把錯置的驗收項移到對的片,不是降低標準。
5. ☑ 回傳碼:①靜態(後置⑦ 計數相等 **+ 絕對數 10**;harness E1a/E1b)②動態各格 ∈ 8 碼(run C/D 段)
6. ☑ 🆕 **合法第二次部分退款正向格**:C2 拿到 `INITIATED`、C2b 真的多一列、C2c 金額正確
7. ☑ §5 **整張屬性表**逐欄未變(後置③ 七欄 + acl + owner;負測 M5)
8. ☑ COMMENT **以 P8 基線為前綴**且更長(後置⑤ `starts_with`,負測 M16)+ 新增段含終局合約句(後置⑤b)
9. ☑ `lock_timeout` = 拍板值 **10s**;後置④ 整串相等含 `lock_timeout=10s`、harness A2/A2b 比同一顆值、
    **L2 實測等鎖 10 秒後 55P03**(不是只看 catalog)
10. ☑ rollback 腳本**五道閘**齊(①/②/②b/②c/回退後置;逐道形狀 §7-10)、單一交易、`rb` 模式全綠
11. ☑ `mut` 每靶紅格為**實跑輸出**,零預測(M8 期望值就是照實跑從 `C4` 改成 `C4 C6` 的)
12. ☑ 三綠:`pnpm typecheck` rc=0 / `pnpm lint` rc=0 / `bash -n` rc=0(零 .ts/.tsx ⇒ 不需 build)
13. ☑ 關卡1 三輪(codex/Opus/Fable)全折才實作;diff 層 R1(codex,兩輪)+ R2(Opus)+ R3(Fable 換角度)全折
14. ❌ **部分未達成(照實標,不含糊)** —— commit 精準 add ✅(七條路徑逐一列出、未用 `git add .`)、
    **不 apply、不 push** ✅;但「**§9 誠實清單逐條寫進 commit body**」這一半**沒有做到**:
    body 寫的是**指標**(「逐條見 plan §9」)而不是逐條展開。
    - 為什麼改成指標:§9 現有十二條、多條帶量法與座標,逐條抄進 body = 同一份字面存兩處,
      而**兩份字面漂移**正是本片一路在修的病(§13-14 自己那句「寫死數量就會變成假話」是同一個道理)。
    - 🔴 **但規避風險不等於達成驗收條件。** 這條當初要的是「Sean 只看 commit 就讀得到全部誠實邊界」,
      指標做不到那件事 ⇒ **標 ❌、寫明理由**,與 §13-4 同一個處置形狀。
      (code-reviewer 指出:只揭露不標記 = **誠實標記不對稱**。這條是它抓的。)
    - 後續要真正達成有兩條路:①body 逐條展開並接受漂移風險 ②把「誠實清單」改成 §9 的**單一權威**、
      驗收條款改寫成「body 必須指向它且不得複述」。**兩條都要 Sean 或主視窗拍板,本片不自行改條款。**
15. ☑ 🆕 backlog **#442 / #443 / #444 / #445** 條目已寫進 backlog 檔,**且與本片 migration 同一顆 commit**(`378b4fb9`)
    (拆開 = 載體又斷一次;主視窗裁示)
16. 🏁 `Q-2f-1`=10s、`Q-2f-2`=B(複判維持放行)、`Q-超退閘`=做(#445)—— **三題全回**,述詞可定稿
17. ☑ 🆕 述詞**兩條排除都在**(supersedes + result_success),各配可分辨的突變(M7 紅 `[C3]` / M8 紅 `[C4 C6]`,
    兩組互不重疊;M8 多紅的 C6 是**同一張單 O2 的 fixture 共用**造成、已照實入表),
    且**兩個 fixture 不得同時滿足兩條**(否則重演 R3 F1 的兩臂不可分辨)
18. ☑ 🆕 carve-out 後置錨(後置⑥ 含左鄰 `AND ` 的形式 + 總數 = 1;負測 M6/M19、harness E2)
19. ☑ 🆕 apply 停點對 Sean 講兩句:①`lock_timeout` 逾時是無名失敗(§9-9)②**TapPay 是唯一超退防線且 partial 不查帳**(§9-7)
    **2026-08-13 已講並已 apply**(主視窗銷帳)。實際講了四條 —— 除上述兩條,另加
    ③回退必須直連 5432、**且這條無負測**、Supavisor 特例未確認(§9-10)
    ④行為證據全產自 macOS / PG 17.10、正式庫 Linux / 17.6(§9-12)。
    🔴 **主視窗在這裡犯了一個錯,照實記**:第一次講的時候**沒有先讀 migration 檔頭**,
    只轉述本 plan §9 的素材 ⇒ 四條並排講出來,讓 Sean 以為 2f 帶來四個當下就活著的風險,
    他當場反問「那為何還沒處理好的 2f 要先上」。**檔頭誠實邊界第 1 條逐字寫著
    「否決條件現在恆假 —— `payment_refunds` 尚無 writer(2g 未建)⇒ apply 後行為零變化」**,
    那是整件事最能左右決策的一句話,而它不在 §9 裡。已當場更正後 Sean 拍 A。
    ⇒ 教訓與 memory `feedback_assert-scope-only-after-reading-source-file` 同型:
    **apply 停點的風險陳述,素材要以 migration 檔頭為準,plan §9 只是補充。**
    apply 實況:`supabase db push` 三行 NOTICE 逐字中預期、在途筆數 = **0**;
    `APPLIED.tsv` 已補登(sha256 `7a467ffd…`),全樹 PENDING 掃描 = 零。

---

## §14 v1 → v2 折疊對照:關卡1 codex R1(10 must-fix + 10 important,**FAIL**)

> 逐字輸出 **絕對路徑** =
> `/private/tmp/claude-502/-Users-sean-1-pcm-website-v2/767c198d-f764-4362-9cf3-167c0f7f646b/scratchpad/2f-gate1-r1.txt`
> (6715+ 行含讀檔軌跡;findings 去重後 20 條)。
> ⚠️ **這是 session 專屬 scratchpad,別的 session 看不到那個目錄** —— R2 的 reviewer 就是因此
> 回報「檔案不存在、折疊完整性未經驗證」(`P-583-A` 檔頭)。往後**寫絕對路徑,不寫相對路徑**。
> codex 跑前/跑後 `git status --porcelain` 逐字相同(只有本檔 untracked)= **零留痕**。

| # | 嚴重度 | codex 打到什麼 | 折進哪 |
|---|---|---|---|
| 1 | must-fix | 步 5-7 **不等價**,我自答錯 | §11 偏-2a(親驗反證 + 發現分歧有**四種**不只一種) |
| 2 | must-fix | `attempt.order_id` 可變 ⇒ order 尺度漂移洞 | §3-2⑤ + §9-5 |
| 3 | must-fix | 「在途必然終局」無機制 ⇒ 可能**永久擋單** | §3-2③ 刪掉那句 + §9-4 + 2g 硬前置 |
| 4 | must-fix | 鍵式子寫錯 ⇒ 三方不同鎖,現有格全綠 | §7 後置 2 + §8 新「鎖鍵等價」面 |
| 5 | must-fix | 消融接受 55P03 ⇒ 零判別力 | §4-1(改成**只認 40P01**) |
| 6 | must-fix | P4 存在性 ≠ 效力;且 view 缺席其實是 **42P01 fail-loud**,v1 連失效模式都寫錯 | §7 P4 改成語意探針 + §8-1 負測 |
| 7 | must-fix | P7 只驗名稱,同名索引可被重建成錯 predicate | §7 P7 改驗 `indisvalid`/`indkey`/`indpred` |
| 8 | must-fix | §13 宣稱 P1-P7 每道有負測,§8 只有三道 ⇒ **驗收當時不可達成** | §8-1 逐閘負測表 |
| 9 | must-fix | 「不再回 IN_FLIGHT」不等於放行 | §8 正向格改成要 `INITIATED` + 新列 + 金額 |
| 10 | must-fix | 決策題 B/C **走不到終態** | §10 重寫 + §7 後置改比「採用值」 |
| 11 | important | 外層交易可讓 AB-BA 從函式外重生 | §9-2(附失效條件 + 明說做不成守門、改寫 COMMENT) |
| 12 | important | P5 漏 `payment_refund_events` | §7 P5 + §8-1 的 bypassrls 誠實註 |
| 13 | important | P6 驗值域、不是驗狀態機效力 | §7 P6 加 trigger 存在+啟用+函式 md5 |
| 14 | important | P1 只釘 `prosrc`,`ALTER FUNCTION` 可繞 | §7 P1 加三欄 |
| 15 | important | 序列化格量到 **row lock 不是 advisory** | §8 改用 `pg_locks` 直接觀察 |
| 16 | important | 八碼抽樣證不到「無第 9 碼」 | §8 加靜態抽取 |
| 17 | important | §5 屬性清單不完整 | §5 改成以 `pg_proc` 欄為單位重列 |
| 18 | important | COMMENT 逐字保留無基線 | §5a + P8 + 截尾突變 |
| 19 | important | caller 丟掉 `blocking_…_id`、異常清單看不到新那半 | §9-6(**我自查也獨立命中同一條**,兩邊合併) |
| 20 | important | 逾時是無名失敗,2f 先 apply 有風險窗 | §9-9 + §10 尾段(apply 停點要講) |

### 我自己在等 codex 時抓到、codex 也命中的一條

§9-6 那條(文案承諾異常清單、但異常清單只讀 `order_refunds`)是我在等待期間追三層應用層 code 抓到的,
codex 從另一個角度(caller 丟掉 blocking id)獨立命中同一處。**兩邊合併寫,不重複計。**

### 這一輪的自評

R1 **FAIL**,而且 10 條 must-fix 裡有 **3 條是我自己寫下的「保證」被打掉**
(等價/必然終局/驗收條件宣稱每道有負測)——都是**沒有機制、只有措辭**的那種保證。
§7 的五道存在性閘更是 2e 已經被教訓過一次的同一個形狀。**這一輪不是抓漏,是抓習慣。**

---

## §15 v2 → v3 折疊對照:R2 adversarial-reviewer / Opus(7 MF + 7 IMP + 4 nit,**FAIL**)

> 來源 = `pcm-mailbox/P-583-A.md`(主視窗轉)。真跨模型第二輪(R1=codex `gpt-5.6-sol`)。
> ⚠️ reviewer 回報找不到 R1 逐字檔(session 專屬 scratchpad 目錄)⇒ **本輪的「折疊完整性」未經第三方驗證**,
> 只有我自己逐條對照。R3 要能驗,絕對路徑已補進 §14。

| # | 嚴重度 | 打到什麼 | 折進哪 | 我親驗了嗎 |
|---|---|---|---|---|
| MF-A | must-fix | §11 偏-1 逐字仍留著 §3-2③ 已宣告刪除的那句「必然走向終局」 | §11 偏-1 刪除 + 全檔 grep 掃 | ✅ grep 命中兩處,屬實 |
| MF-B | must-fix | 沿鏈重試的舊列**永不終局** ⇒ 該單此後退款**全被永久擋** | §3-2⑥ 述詞加 supersedes 排除 + §8 新格 | ✅ 親開母 plan `:478-503` 全段,**翻案條款查無**,成立 |
| MF-C | must-fix | 每筆**正常成功**的補償退款會擋該單約一天 | §9-6a + **升級成 Q-2f-2 交 Sean** | ✅ 親開 `20260811110000:197-201` 逐字 |
| MF-D | must-fix | §10 選項 C 走不到終態,而 v2 宣稱「三選項都到得了」 | §10 如實標註 C 是死路 | ✅ 對照 §7 後置 5 屬實 |
| MF-E | must-fix | v2 拿**不存在的約束**(母 plan `:290`)擋掉自己的理由 | §3-2a + 偏-4:**B 移到步 6 之後** | ✅ 親讀 `:290`,只綁「晚於 G4」 |
| MF-F | must-fix | migration 本體沒要求包單一交易(只有 rollback 講了) | §7-0 | ✅ 同族三支確有 `BEGIN;` |
| MF-G | must-fix | P4 的語意探針在正式庫**構造不出**(append-only + FK) | P4 改釘 `md5(pg_get_viewdef(...))` | ✅ 採納(零寫入、判別力更強) |
| IMP-1 | important | P4 負測②(DROP view)零判別力 | 刪掉那個負測 | ✅ |
| IMP-2 | important | P1「`proacl` 非空」又是存在性檢查 | 改逐字比集合 | ✅ 本節檔頭自己罵過同一件事 |
| IMP-3 | important | 後置 6 只 NOTICE,放掉免費的 fail-closed | 改 RAISE;但**數字我沒量過**⇒ 訊息寫「停下來問」 | ✅ |
| IMP-4 | important | §4「不存在 AB-BA」講得比 2e 大 | §4 加射程限定,對齊 2e COMMENT `:307` | ✅ |
| IMP-5 | important | 偏-2a「現行優先序是刻意的」**借權威**(全 repo 查無出處) | 拆成「有出處那半」與「我判斷那半」 | ✅ 本體只宣告過 G4 before G12 |
| IMP-6 | important | 三條 2g 推遲項只活在 untracked plan | §12-1 + backlog **#442/#443/#444** | ✅ 號向主視窗要來 |
| IMP-7 | important | 缺 migration 層三條 `SET LOCAL` | §7-0 | ✅ |
| N1 | nit | `p_order_id IS NULL` 那格沒寫出來 | §3-1 尾 + §8 新格 | ✅ 親驗步 1-2 確實沒驗它 |
| N2 | nit | §3-2 條號 1,2,3,5,4 錯序 | 已重排 1-7 | ✅ |
| N3 | nit | 「請 codex 專打」是過期字面 | 隨 §11 改寫消失(grep 零命中) | ✅ |
| N4 | nit | §13-14 寫死「九條」= 加條即假 | 改「逐條」 | ✅ |

### 這一輪的自評

**兩輪加起來,10 條 must-fix 打的是同一種東西:我寫下的保證沒有機制撐著。**
R2 最重的三條尤其誠實:

1. **MF-A = 第 10 次同一個病**。R1 才剛因為 MF3 刪掉那句話,我只改了被點名那段,**沒 grep 全篇**。
   而且它不是裝飾句,是「所以不必做人工出口」的**理由** —— 留著等於拿已知為假的前提替省略辯護。
2. **MF-B 讓我看清一件事**:我三次引用母 plan §4c 那張表,**每次都只看我要的那一格**。
   「沿鏈開新根」我讀到了,「五步之中沒有一步給舊列寫終局」我沒讀出來 —— 差別在於前者是**寫著的**,
   後者是**沒寫的**。查「有什麼」容易,查「少了什麼」要把整條路徑走一遍。
3. **MF-E 是自我矛盾**:我在偏-2a 論證「具體診斷優先於籠統碼」,然後在 §3-2 做了相反的事,
   還拿一條**不存在的約束**當理由擋回。論證與實作在同一份文件裡打架,而我沒發現。

**MF-C 不是我的錯,但它是本片最重要的產出** —— 母 plan 對「在途」的定義照做就會擋單一天,
這件事**在 2g 上線前沒有人會發現**。它現在是 Sean 桌上的 Q-2f-2。

---

## §16 v3 → v4 折疊對照:R3 Fable(2 MF + 4 IMP + 2 consider + 2 nit,**FAIL**)

> 來源 = `pcm-mailbox/P-586-A.md`(主視窗轉)。第三輪**換引擎換角度**(R1 codex / R2 Opus / R3 Fable)。
> ✅ **正面確認一條**:§3-2⑥ 的沿鏈排除**不漏擋** —— 複合 FK + `pr_supersedes_uniq` 保證鏈不跨 attempt、不分叉,
> 鏈尖必被抓到,**不需要遞迴**。(這是本片第一條被審查者正面背書的設計。)

| # | 嚴重度 | 打到什麼 | 折進哪 | 我親驗了嗎 |
|---|---|---|---|---|
| F1 | must-fix | 沿鏈格 fixture **兩臂不可分辨**:新根自己無終局 ⇒ 正確實作也擋、突變也擋 | §8 fixture 補「新根帶 `result_failed`」 | ✅ 推一遍即成立 |
| **F2** | must-fix | B 之下 §9-7 從「最後防線」變**唯一防線**;更毒的是**卡住的補償退款從「永久擋單」變「永久隱形」** | 🏁 **已折**(§9-7 改寫 + apply 停點 + #442 改隱形卡單形狀;§16-1) | ✅ partial 的 `v_frozen := p_amount` 無任何加總,`20260803150000:485` 逐字 |
| F3 | important | B 述詞要直讀 events ⇒ 違反自家「終局一律消費 view」契約 | §3-2④ 加**條件式** carve-out + 後置錨 | ✅ `result_success` 確不在 view 的終局集合 |
| F4 | important | 2e(認 confirmed)與 2f-B(認 success)語意分家 ⇒ 2g 會抄錯邊 | §12-0 新表,寫明「差別在後果可逆性」 | ✅ |
| F5 | important | `psqlrc` 的 `ON_ERROR_ROLLBACK` ⇒ 包了 `BEGIN` 也逃得掉 | §7-0a:明文只准 `db push` / `psql -f -v ON_ERROR_STOP=1` | ✅ 機制上成立 |
| F6 | important | B 下兩條排除各要「只紅它」的突變,fixture 不得同時滿足;`:419` 那格是 A 語意要整格反向 | 🏁 **已折**(`:419` 整格反向 + 兩條排除各配可分辨 fixture 與突變;§16-1) | ✅ 我 v3 自己就記過這格要翻面 |
| F7 | consider | 「約一天/預計明天」是**雙重未驗字面**(隔日=文件層;`result_confirmed` 的寫入者是**還沒建的** 2g reconcile,節奏未定) | 任何 UI/文案**不寫死時間**;§9/§10 的敘述標成未驗 | ✅ 2g 未建=事實 |
| F8 | consider | 我在 Q-2f-2 **A 選項**寫的「絕不可能重複退到錢」是**過大宣稱** | §10 檔頭修正 + 附反證座標 | ✅ 親驗 `20260803150000:723-730`,受理當下即 `confirmed` |
| F9 | nit | 否決 `SELECT … LIMIT 1` 無 `ORDER BY` ⇒ blocking id 非決定性、測試會 flake | §3-2 SQL 加 `ORDER BY pr.created_at, pr.id` | ✅ |
| F10 | nit | P4 的 viewdef md5 沒寫量法(`pg_get_viewdef` ≠ 源文字) | §7 P4 補算法+量法+環境 | ✅ |

### §16-1 🏁 **已定稿**(Sean 2026-08-12 兩題全回:`Q-超退閘 = 做`、`Q-2f-2 複判 = 維持放行`)

⇒ 走**「維持 B」那條路**,五件事全做完(對照下方原文逐條):
①§9-7 改寫成「唯一防線 + 兩個洞疊加」✅ ②apply 停點那句已標 ✅
③#442 改寫成隱形卡單形狀 ✅ ④§8 兩條排除各配可分辨 fixture 與突變 ✅ ⑤`:419` 那格已整格反向 ✅
➕ 新增 **#445**(超退閘;Sean 知情推翻拍板⑤)與 §11 偏-5(那句已上線的警告 + Sean 知情狀態)。

<details><summary>原文保留(當時兩條路各要做什麼)</summary>

Sean 桌上還有兩題未回:**Q-超退閘**(要不要做本地金額閘)與 **Q-2f-2 複判**(維持 B 還是改回擋)。
這兩題會直接改述詞語意 ⇒ 以下**不先定稿**,只把要做的事寫死,免得答案回來時又靠記憶重建:

**若維持 B(現況)**:
1. §9-7 改寫 —— 「TapPay 伺服器端拒絕」從**最後防線**升格為**唯一防線**,而它①只有 sandbox 實證
   ②**partial 路徑根本不查任何帳**(`v_frozen := p_amount`,`20260803150000:485`)⇒ 兩個洞疊加,要照實寫。
2. **這句進 apply 停點對 Sean 講**,不是只寫在文件裡。
3. 🔴 **#442 條目要改寫成「隱形卡單」形狀**:A 之下卡住的補償退款會**擋單**(吵、會被發現);
   **B 之下它不擋也不顯示 = 永久隱形**,不會有人去跑 `admin_correct_refund_manual_verdict`
   (`20260812140000:572`)。**B 刪掉的是「卡住」唯一的生命週期壓力** —— 這比原本的 #442 更嚴重,
   仍列 2g 硬前置。
4. §8 兩條排除各配「只紅它」的突變,且 fixture **不得同時滿足兩條**(否則重演 F1 那個不可分辨)。
5. `:419` 那格「受理未確認仍算在途」是 **A 語意** ⇒ **整格反向**成「須放行」。

**若改回擋(或選過渡案)**:上述 1-5 全部不做;§3-2④ 的 carve-out 也不做;
`:419` 那格維持原樣。**兩條路的差異只在述詞與那幾格,advisory / 鎖序 / 前置八道不受影響。**

</details>

**實際走的是「維持 B」。** 上面那段「若改回擋」已作廢,保留只為追溯。

### 這一輪的自評

三輪三引擎,**每一輪都抓到上一輪沒抓到的**,而且形狀不同:codex 抓「沒有機制的保證」、
Opus 抓「跨檔的因果」、Fable 抓「**我剛剛才寫下的修法本身有沒有效力**」。

F1 最值得記:那個 fixture 是我**折 R2 MF-B 時順手寫的**,寫完當下還很滿意 ——
但它兩臂不可分辨,等於用一個永遠證明不了東西的測試去背書一條剛修好的守門。
我在 v3 §15 的自評裡**逐字寫過**「折 finding 時順手寫的新理由是全篇最沒被驗過的字面」,
然後在同一份文件的另一節**犯了它的測試版本**。知道規則不等於執行規則。

---

## §17 突變靶實測結果(**v8 = 25 靶 + M0 基線**;v6=17、v7=22,紅格由實跑決定,非預測)

> 量法逐字(v7:workdir 由腳本自產、報告檔名帶 PORT):`PORT=54771 scripts/l5b2-2f-verify.sh mut`
> (每靶一座全新叢集;報告 `/tmp/2f-mut-report-54771.txt`;末行印 `mut 小計:未通過靶數 = 0`,`echo $?` = **0**)。
> 同一支 harness 的其他模式(v9 實測):`run` = **37/37**、`rb` = **7/7**、`neg` = **51/51**(§17-4)。
> 🔴 **入表的是「檔案 SHA 重釘之後」那一輪** —— 跑的就是要 commit 的那份檔。
> 之所以要講這句:折疊中我曾**在 mut 跑到一半編輯 rollback 檔**,子行程 `check_sha` 當場死,
> 輸出零個 ❌ ⇒ 紅格集合是空的 ⇒ M8 被判成「該格沒有判別力」(§18-E-6)。
> **量具死掉被讀成了被測物沒反應。** 已補守門(子行程沒印 `run 小計` 就報「這靶沒有結果」),
> 並回頭自檢:最終輪兩個行為靶紅格集合皆非空(`M7=[0-1 C3]`、`M8=[0-1 C4 C6]`)⇒ 無污染數字沿用。
> 🔴 **v6 之前這張表的退出碼不可信**(A5:`mode_mut` 最後一句是 `cat` ⇒ 恆 exit 0);
> 逐格結果是人眼讀報告讀出來的,那部分仍成立。**本輪的 0 是退出碼與逐格報告兩者一致。**
> 🔴 **行為靶的判別力以「紅格集合 − `BASE_RED`」認定**(§18-B);`BASE_RED` 實測 = `[0-1]`。

| 靶 | 改壞什麼 | 實測紅在哪 |
|---|---|---|
| **M0** | 惰性突變:只改函式本體一行註解文字 | `BASE_RED = [0-1]`(= 只有 post-image md5 那格;**這格對任何源碼變動都會紅**) |
| M1 | `pg_advisory_xact_lock` → `..._shared` | ✅ `l5b2_2f_advisory_exclusive_only`(**這道守門是被本靶逼出來的**,見 §17-1) |
| M2 | 鍵式子截 15 字 | ✅ `l5b2_2f_key_equivalence` |
| M3 | 省略 `SET lock_timeout` | ✅ `l5b2_2f_proconfig` |
| M4 | 照抄 2e 的 `search_path=''` | ✅ `l5b2_2f_proconfig`(v5 標籤修正後**本輪已重跑確認**) |
| M5 | 省略 `SECURITY DEFINER` | ✅ `l5b2_2f_attrs_preserved` |
| M6 | carve-out 擴大到別的 `event_type` | ✅ `l5b2_2f_carveout_scope` |
| M7 | 沿鏈排除的**關聯條件錯掉**(v7 改寫,見下) | ✅ 紅格 `[0-1 C3]` − BASE_RED = **`[C3]`**,**恰等於**期望集合 |
| M8 | **讓** `result_success` 排除**失效**(v6 改寫,見下) | ✅ 紅格 `[0-1 C4 C6]` − BASE_RED = **`[C4 C6]`**,**恰等於**期望集合(v7 把期望改成兩格,見下) |
| M9 | 2e 成組閘餵錯 md5 | ✅ `l5b2_2f_2e_postimage_required` |
| M10 | canonical view 指紋餵錯 | ✅ `l5b2_2f_viewdef_pinned` |
| 🆕 **M11** | 鍵尾巴 `+1`(A2 的舊形狀只比 substr 片段 ⇒ 片段一字未動、照樣綠) | ✅ `l5b2_2f_key_equivalence` |
| 🆕 **M12** | 多鎖一顆常數鍵(抽取只看得到第一顆 ⇒ 等價斷言仍綠) | ✅ `l5b2_2f_advisory_call_once` |
| 🆕 **M13** | ② pre-image 指紋餵錯(P2 的負測) | ✅ `l5b2_2f_preimage_mismatch` |
| 🆕 **M14** | ② COMMENT 基線指紋餵錯(P8 的負測) | ✅ `l5b2_2f_comment_baseline` |
| 🆕 **M15** | 冒出第 9 個回傳碼 | ✅ `l5b2_2f_result_code_closure`(後置⑦) |
| 🆕 **M16** | COMMENT 舊全文被改字(舊 `LIKE` 形狀對 `_` 當萬用字元全盲) | ✅ `l5b2_2f_comment_prefix`(後置⑤) |
| 🆕 **M17** | 鎖強度改成 `FOR UPDATE` | ✅ `l5b2_2f_anchor_lock_strength`(後置①c)<br>🔴 **我預測的是 ①a、實跑是 ①c** —— 期望值也照實跑改。「紅格由實跑決定不由預測」這條規矩對**期望值本身**同樣適用 |
| 🆕 **M18**(v7) | `NOT EXISTS` → `EXISTS`(名稱座標一字不動、語意整個反轉) | ✅ `l5b2_2f_veto_negation_terminal`(後置①e-1) |
| 🆕 **M19**(v7) | carve-out 插一個否定詞 `AND NOT e.event_type = …` | ✅ `l5b2_2f_carveout_scope`(後置⑥;**v6 形狀之下兩個計數仍是 1 = 全綠**) |
| 🆕 **M20**(v7) | 用 `concat('res','ult')` 組 result 鍵 | ✅ `l5b2_2f_result_code_closure`(後置⑦;**靠新加的絕對數 10 才擋得到** —— 計數相等對「同步減少」全盲) |
| 🆕 **M21**(v7) | advisory 改成大寫 `PG_ADVISORY_XACT_LOCK` | ✅ `l5b2_2f_anchor_advisory_before_lock`(①a 先擋;①d/②a 的 `'gi'` 是第二道) |
| 🆕 **M22**(v7) | 多一個**小寫** `for update` | ✅ `l5b2_2f_anchor_lock_strength`(①c 改看 `upper()` 之後才數得到) |
| 🆕 **M23**(v8) | 在步 1 之前**插入**一顆 advisory(i_adv 前移) | ✅ `l5b2_2f_anchor_advisory_after_validation`(①a2)—— 🔴 v7 把這面寫成「sed 搬不動 = 誠實缺口」,**是假的** |
| 🆕 **M24**(v8) | 終局述詞的關聯條件改錯(`et.refund_id = pr.attempt_id`) | ✅ 紅格 `[0-1 C2 C2b C2c C3]` − BASE_RED = **`[C2 C2b C2c C3]`**,恰等於期望。三條在途述詞裡最吃重的那條,v7 之前**一個靶都沒有** |
| 🆕 **M25**(v8) | 多一個**雙空格** `FOR  UPDATE` | ✅ `l5b2_2f_anchor_lock_strength` —— ①c 改走 `upper(v_norm)` 之後才紅得起來(v7 只吸收大小寫、不吸收空白) |

**M8 為什麼改寫**:原本的 sed 是「整段換成 `WHERE false`」,那會**連 `event_type` 的字面一起拿掉**;
v6 的後置⑥(要求 `event_type` 恰好出現 1 次且恰好是獲准形式)因此在 **apply 期**就攔下它
⇒ 行為格 C4 根本跑不到、**判別力歸給了閘而 C4 沒被驗到**(第一次實跑就是這樣紅的,`mut-exit=1`)。
改成**保留合約字面、只讓述詞失效**(關聯條件換成恆不成立的 `e.refund_id IS NULL`)。
🔴 這件事本身就是 A5 的驗收:**退出碼真的抓到了東西,不是我宣稱它會抓。**
M8 連帶紅 C6(同一張單 O2 上的退款把 C6 也擋了)—— 這種連帶**現在報告裡看得到**,不再被藏起來。

**v7 又動了兩件事(逐字記):**
1. **M7 的 sed 改寫**:原本「整段換成 `WHERE false`」會把 `supersedes_refund_id` 的字面一起拿掉,
   而 v7 新增的後置①e-2 會在 **apply 期**攔下它 ⇒ 行為格 C3 又會跑不到(M8 那個坑的第二次)。
   改成**保留字面、只讓關聯條件錯掉**(對到 `pr.attempt_id`)。實跑紅格 `[C3]`,判別力歸位。
2. **M8 的期望值從 `C4` 改成 `C4 C6`**:v7 把行為靶判準從「包含」改成**集合相等**之後,
   M8 立刻紅了 —— 因為它一直都多紅 C6,只是舊判準把它藏起來。**期望值照實跑填,不修剪。**
   (這就是那條 IMP 的驗收:改成相等之後,量具當場抓到一個一直存在的落差。)
3. **M20 的 sed 一開始寫成 `'res' || 'ult'`**,而 `|` 正是靶清單的欄位分隔字元
   ⇒ 四個欄位整排錯位、`kind` 變成空字串走了 behavior 分支,報告印出 18 格全紅。
   **量具自己壞掉,長得跟被測物大規模翻紅一模一樣。** 已改用 `concat()`,並在解析後加一道
   「`kind` 必須是 apply/behavior」的自檢 —— 下次錯位會當場說「靶定義解析錯誤」而不是誣賴被測物。

### 🔴 17-1 M1 是本片最重要的產出:三輪 48 條人工審查全部沒抓到

把加鎖函式換成**共享鎖**版本 ⇒ 序列化完全失效(共享鎖彼此不互斥),而 v5 的守門**一道都不會叫**:
- 順序錨用 `strpos` 找 `pg_advisory_xact_lock` —— **`_shared` 版含它當前綴**,照樣命中;
- 鍵等價那道只比 `substr(...)` 算式,**不比鎖的種類**。

⇒ 補上後置 ①d:抽出所有 `pg_[a-z_]*advisory[a-z_]*` 字面,**必須恰好只有 `pg_advisory_xact_lock`**。
**人審查的是「我寫的對不對」,突變測試問的是「把它弄壞,有沒有人會叫」——這兩件事不能互相替代。**

### 17-2 harness 自己被抓到兩個會產生假結果的 bug(都已修)

1. **拿 constraint 名比對 psql 訊息 ⇒ 恆假**:psql 預設不印 `CONSTRAINT` 欄,七個靶因此被判成「⚠️ 不是期望的閘」,
   實際上每一個都**被正確的閘擋住**。修法=`-v VERBOSITY=verbose`。(同族:memory「psql 不印 SQLSTATE ⇒ 比對恆假」)
2. **teardown 失敗後,下一靶會連到殘留的舊叢集** ⇒ 在錯誤環境上跑出看似正常的結果。
   這次是失敗跳過才被發現,但它**同樣可能默默給綠燈**。修法=provision 前證埠已空、provision 後證叢集是新的。
   ⚠️ 而我第一版的「新鮮度指標」用 `orders` 筆數 —— **錯的**:那個 0 來自一次**失敗的** provision(seed 沒跑到),
   我拿壞掉的狀態推出了不變量。改用 `payment_refunds`(2g 未建 ⇒ 只有 harness 會寫)。

### 🆕 17-4 `neg` 守門負測實測結果(v6 新增;**改庫的狀態**,mut 構造不出來的那一面)

> 量法逐字(v7:workdir 由腳本自產、不吃位置參數):`PORT=54763 scripts/l5b2-2f-verify.sh neg`
> (叢集需已 provision;末行印 `neg 小計:PASS=51 FAIL=0`,`echo $?` = **0**)。
> 🔴 每格都配**舊形狀對照**:舊守門判綠(= 假綠)、新守門判紅 —— 否則只證明「新的擋住了」,
> 證不到**判別力屬於新形狀**;那正是 diff 層 R1 D 段點名的毛病。

| 格 | 改壞庫的什麼 | 舊形狀 | 新形狀 |
|---|---|---|---|
| **N1** | 索引 predicate 改成 `WHERE status <> 'processing'` | `LIKE '%processing%'` 仍判綠 = **假綠** | ✅ 擋在 `l5b2_2f_single_flight_index`(P7) |
| **N2** | 狀態機 trigger 重綁到 no-op 函式(舊函式仍留庫裡) | 按名字查函式 md5 仍判綠 = **假綠** | ✅ 擋在 `l5b2_2f_status_machine_pinned`(P6c) |
| **N3** | 停用狀態機 trigger | —(這道 v5 就有) | ✅ 擋在 `l5b2_2f_status_machine_enabled`(P6b) |
| **N6** | 2e 的 `lock_timeout` 被 `ALTER … RESET`(prosrc 一字未動) | — | ✅ 擋在 `l5b2_2f_2e_attributes_required`(P1b) |
| **N7** | 2e 的 EXECUTE 多授給 `anon` | 舊寫法逐一問四個角色(抽樣)—— anon 剛好在那四個裡才擋得到 | ✅ 擋在 `l5b2_2f_2e_acl_owner_only`(P1c,改比整個集合) |
| **N8** | ② 的 `proconfig` 被 `ALTER … SET statement_timeout` 加料 | — | ✅ 擋在 `l5b2_2f_preimage_attrs`(P3) |
| **N9** | ② 的 EXECUTE 多授給 `anon` | v5 只在 apply 前後比「有沒有變」⇒ **既有誤授原樣保留且全綠** | ✅ 擋在 `l5b2_2f_preimage_acl_set`(P3b;Sean `Q-P591-1`=A) |
| **N10** | canonical view 的 `security_invoker` 被關掉 | **viewdef md5 仍等於 P4 釘值** = 假綠(實測,不是推論) | ✅ 擋在 `l5b2_2f_viewdef_security_invoker`(P4b) |
| **N11** | `payment_refund_events` 開 FORCE RLS | — | ✅ 擋在 `l5b2_2f_no_force_rls`(P5) |
| **N12** | 狀態值域多出第五個值 `cancelled` | 四個 `LIKE` **仍全部命中** = 假綠 | ✅ 擋在 `l5b2_2f_status_domain`(P6,改集合相等) |
| **N4** | 2f 之後只改 COMMENT(prosrc 一字未動) | 只比 prosrc 仍判 post-image ⇒ **會直接覆蓋掉那筆追記** | ✅ 擋在 `l5b2_2f_rb_third_state_sidecar` |
| **N5** | 庫裡仍有在途 `payment_refunds` 時跑回退 | —(v5 無此閘) | ✅ 擋在 `l5b2_2f_rb_refund_in_flight` |
| **N5b** | 補終局事件後應解除在途 | — | ✅ 在途數回到 0(**用補事件、不 DELETE**:`prl_append_only_guard` 實測擋 DELETE) |

#### 🆕 v7 新增的 neg 格(補「複合述詞只測一支」那個高估;逐條理由見 §13-2)

| 格 | 改壞庫的什麼 | 舊形狀 | 新形狀 |
|---|---|---|---|
| **N1b** | 索引**鍵欄**換成 `bank_refund_id`(predicate 一字未動) | —(P7 v6 只有 predicate 有負測) | ✅ 擋在 `l5b2_2f_single_flight_index` |
| **N1c** | 索引改成**非唯一**(名字/鍵/predicate 全對) | — | ✅ 擋在 `l5b2_2f_single_flight_index` |
| **N3b** | trigger 掛永假 `WHEN` 子句(`tgqual`) | —(P6b v6 只有停用那一支) | ✅ 擋在 `l5b2_2f_status_machine_enabled` |
| **N3c** | trigger 的 `UPDATE OF` 換成別欄(`tgattr`) | — | ✅ 擋在 `l5b2_2f_status_machine_enabled` |
| **N3d** | trigger 時機改成 `AFTER`(`tgtype` 位元) | — | ✅ 擋在 `l5b2_2f_status_machine_enabled` |
| **N3e** | **反向格**:`ENABLE ALWAYS`(合法且更強) | v6 釘 `tgenabled='O'` ⇒ **誤擋合法設定** | ✅ apply 成功 = 不再誤擋 |
| **N6b** | 2e 出現**同名多載** | —(P1/P1b/P1c 定位不帶簽章 ⇒ 取到任意一顆) | ✅ 擋在 `l5b2_2f_2e_overloaded`(v7 新增 P1-0) |
| **N12b** | 值域字面不動、只把運算子翻成 `<>` | 抽字面比集合**仍然相等** = 假綠(本格附實測對照) | ✅ 擋在 `l5b2_2f_status_domain_operator`(v7 新增 P6-op) |
| **N4b** | 2f 之後 `ALTER … SET statement_timeout` | —(②b v6 只有 COMMENT 那一面有負測) | ✅ 擋在 `l5b2_2f_rb_third_state_sidecar` |
| **N4c** | 2f 之後 `ALTER … COST 200`(七屬性面) | — | ✅ 擋在 `l5b2_2f_rb_third_state_sidecar` |
| **N5c** | 閘②c 的核准出口**帶錯筆數**(2 vs 實際 1) | —(v6 無出口) | ✅ 仍然擋在 `l5b2_2f_rb_refund_in_flight` |
| **N5d** | 閘②c 的核准出口**帶對指紋** | — | ✅ 放行、且輸出含「經核准放行」WARNING 與「2f 回退完成」 |

#### 🆕 v8 新增的 neg 格(折 diff 層 R2;31 → 48 格)

| 格 | 改壞庫的什麼 / 探什麼 | 舊形狀 | 新形狀 |
|---|---|---|---|
| **N6c** | 2e 的 `lock_timeout` 被改成 **0**(無限等) | 只找設定名稱在不在 ⇒ **假綠**(本格附實測對照) | ✅ 擋在 `l5b2_2f_2e_attributes_required`(P1b 的**值錯**那一支;v7 只測到「被拿掉」) |
| **N9b** | service_role 拿到**可轉授**的 EXECUTE | 授權集合仍恰好 {owner, service_role} ⇒ **假綠** | ✅ 擋在 `l5b2_2f_preimage_acl_set`(P3b 的 grant option 面) |
| **N10b** | `security_invoker = on`(合法等價寫法) | v7 比單一字面 ⇒ **會誤擋** | ✅ **反向格**:apply 成功 = 誤擋已消失 |
| **N11b** | 函式 owner 換成無 `BYPASSRLS` 的角色 | 只驗三表沒開 FORCE RLS ⇒ **假綠** | ✅ 擋在 `l5b2_2f_secdef_owner_rls_reach`(P5b;v7 誤標「本機恆綠」) |
| **N12c-1/2** | **行為探針**:`cancelled` 進不來 / `processing` 進得來 | —(v7 只有結構斷言) | ✅ 兩向都對(前者由既有 trigger 攔、後者成功) |
| **N12d** | 值域 CHECK 翻成 `NOT (...)` | **P6 + P6-op 兩道結構斷言都判綠 = 假綠**(這就是 R2 的 must-fix) | ✅ **行為探針**當場紅(合法的 `processing` 被 CHECK 擋,23514) |
| **N2b-1/2** | **行為探針**:`processing→failed` 合法 / `failed→processing` 終態轉出 | —(P6b/P6c 只證 trigger 在、綁哪支) | ✅ 前者成功、後者被擋(P0001) |
| **N1d** | **行為探針**:同單第二筆 `processing` | —(P7 只證索引形狀) | ✅ 撞唯一索引(23505) |
| **N7b** | 回退**還原文字**誤帶 `SET row_security = off`(sed 一份腳本副本) | v7 回退後置是**子字串比對** ⇒ 四面全綠 | ✅ 擋在 `l5b2_2f_rb_proconfig`(改整串相等之後) |
| **N7c** | 2g writer 的 `--` 註解裡含 `/*` | v7 先剝 `/* */` 再剝 `--` ⇒ **fail-open**、真 INSERT 被吃掉 | ✅ 仍擋在 `l5b2_2f_rb_2g_present`(順序反過來 + 原文對照) |
| **N5c**(改判準) | 核准值**指紋不符**(筆數相同、身分不同) | v7 綁 count ⇒ 這個情境**會放行** | ✅ 仍然擋 |
| **N5d-audit** | 核准放行是否真的落了一列 `admin_audit_log` | —(v7 只有 RAISE WARNING) | ✅ 落了一列;🔴 第一版 `source_app='script'` 撞 CHECK 被 EXCEPTION **吞成 WARNING**,就是這格抓到的 |

> 實測小計 **v7 = 31、v8 = 48、v9 = 51**(v6 是 18)。v9 新增 N13a/N13b/N13c 三格(見下)。
> 數法逐字:`PORT=54763 scripts/l5b2-2f-verify.sh neg` 末行印 `neg 小計:PASS=51 FAIL=0`,`echo $?` = 0。

#### 🆕 v9 新增的 neg 格(折 diff 層 R3;48 → 51)

| 格 | 改壞庫的什麼 | 舊形狀 | 新形狀 |
|---|---|---|---|
| **N13a** | **drop 掉 canonical view** 之後跑回退(未帶核准) | 閘②c 無條件查那顆 view ⇒ 自己 **42P01** ⇒ 整筆 abort ⇒ **回退在最需要它那天死掉** | ✅ 擋在具名閘 `l5b2_2f_rb_terminal_view_missing`(訊息說明「這正是你來跑回退的原因」並給出口) |
| **N13b** | 同上,帶 `view-absent` 核准值 | — | ✅ **回退跑得完**(逃生門沒被自己焊死)+ WARNING + audit 留痕 |
| **N13c** | 收尾:view 還原後定義 md5 與 P4 釘值相符 | — | ✅ 相符(否則後續格會全部假紅) |

> 🔴 N13 第一版**放錯位置**(放在 neg 前段、現況是 pre-image)⇒ 閘② 在 `v_md5 = c_pre_md5` 直接 RETURN、
> 走不到 ②c ⇒ 兩格都印「這條守門沒有判別力」。**量具擺錯位置,長得跟被測物失效一模一樣**(同族第五例)。
> 🔴 這張表最該讀的不是右欄而是**第三欄**:那五格「假綠」是**實跑量出來的**,
> 不是我推論舊守門守不住 —— 沒有它們,右欄的✅只證明「新守門在這個狀態下會叫」,
> 證不到**判別力來自新形狀**。

### 17-3 誠實邊界

- 否決相關格驗的都是 harness **直接 INSERT 造出來的**資料(2g 未建、否決條件恆假)。
- **死結消融(plan §4-1 要求實際觀察到 40P01)本輪未做** —— 它需要雙連線互相等待的構造,**不在 mut 的靶面上**
  (mut 是「改壞檔再 apply」,構造不出兩條連線互等;v9 現況 25 靶。🔴 這句原本寫「不在本次 10 靶內」,
  是 §13-4 同義句改了、**孿生句沒跟著改**留下的殘值 —— 折 finding 只處理被指名那一處那族,code-reviewer 抓到)。
  ⇒ **「死結已解」這句話目前沒有實測背書**,只有「advisory 早於列鎖」這個結構前哨。
  🔴 **v6 覆核:這條**沒有**被 v6 的任何一次全綠推翻**,原樣成立(diff 層 R1 §5-2 也點名它是已宣告項)。

---

## §18 v5 → v6 折疊對照:**diff 層 R1 codex**(9 MF + 18 IMP + 2 nit,**FAIL**)

> 這一輪與前三輪的差別:前三輪審的是 **plan**,這一輪審的是 **diff**。
> 抓到的東西也不同 —— 前三輪都在問「這個設計對不對」,這一輪問的是
> 「**你寫的守門,真的守得住它自己宣稱要守的東西嗎**」。答案有五處是「守不住」。

### 18-0 一句話病根

**「找得到這個字串」不是守門。**

P 九代在突變測試裡被 M1 教過一次(共享鎖函式名**包含**互斥鎖名當前綴 ⇒ 順序錨與鍵等價兩道全綠),
**然後在 P7 上又犯了一次**(索引 predicate 用 `LIKE '%processing%'`,改成 `<> 'processing'` 照樣命中)。
同一個病在同一份 diff 裡出現至少五次 —— 它不是筆誤,是一種**預設的寫法**:
想守住某個語意時,直覺去找「那個語意會出現的字串」,而不是去問「**這個語意被破壞時,長什麼樣子**」。

**折疊時採用的判準:寫任何 `LIKE` / `strpos` / 枚舉式 regex 守門前,先問三個問題 ——**
1. 加一個否定詞會怎樣?(`= 'x'` → `<> 'x'`)
2. 換個寫法會怎樣?(`=` → `IN (...)`、換別名、改成變數、字串串接)
3. 多一份會怎樣?(多一顆 advisory、多一個 event_type 條件)
**三個都答得出「會被擋」才算守門;有一個答不出來,那是註解不是守門。**

### 18-A 五處「形狀」重做(主要工作;每處都附**舊綠新紅**的實測對照)

| # | 原本的形狀 | 為什麼守不住 | 改成的形狀 |
|---|---|---|---|
| **A1** | P7:`pg_get_expr(indpred) LIKE '%processing%'` | `WHERE status <> 'processing'` 照樣含該字串 ⇒ 全綠,而 processing **完全不受限**、同單可開多筆退款 | predicate **整串相等** `(status = 'processing'::text)`;鍵改查 `indkey[0]` 的實際欄名(舊的 `indexdef LIKE '%(order_id)%'` 會被 predicate 裡的 order_id 誤中);加 `indisready`/`indislive`/`indnkeyatts=1`/非運算式索引 |
| **A2** | 後置②:只抽 `substr(replace(...),1,16)` 片段比對 | 前綴 `'x'` 換字、或尾巴 `+1` ⇒ **片段一字未動**、斷言全綠,而兩支算出的 bigint 已是不同的鎖 | 比**整個引數式子**(`pg_advisory_xact_lock(` 起、該句 `;` 前的 `)` 止,以 `[^;]*` 界定);**加後置②a:呼叫恰好 1 次**(多一顆常數鍵時,抽取只看得到第一顆) |
| **A3** | P6b 只看 `tgenabled`;P6c **按名字**查函式 md5 | 同名 trigger 可被重建、**綁到 no-op 函式**,舊函式仍留庫裡 ⇒ 兩道都綠而終態可被轉出 | P6c 沿 **`pg_trigger.tgfoid`** 取「這顆 trigger 實際綁的函式」;P6b 同族中和手法一併釘:`tgqual IS NULL`(永假 WHEN)、`tgtype=19`(BEFORE UPDATE FOR EACH ROW)、`tgattr` 含 status 的 attnum(改 `UPDATE OF` 欄位就不觸發) |
| **A4** | 回退三態閘只比 `prosrc` | 2f 之後只改 COMMENT / `ALTER FUNCTION ... SET` ⇒ prosrc 未動、仍判 post-image ⇒ **把那些改動靜默覆蓋掉**(`CREATE OR REPLACE` 是整份宣告重寫) | 閘②b **逐項比對本腳本有能力覆寫的每一面**:proconfig / COMMENT md5 / 七個屬性。<br>🔴 **ACL 與 owner 刻意不列入**:`CREATE OR REPLACE` 保留權限、覆寫不到它們,列進去只會讓「正式庫授權現況 ≠ 本機臨時叢集」變成**假性第三態擋住合法回退**。同理不用 `pg_get_functiondef` 的 md5(正規化文字、跨庫不可攜)。<br>⚠️ **pre-image 那一態維持 prosrc md5**:它只導向冪等早退、方向安全。**這個不對稱是刻意的,不假裝兩態同強度。** |
| **A5** | `mode_mut` 最後一句是 `cat` ⇒ **整個模式恆 exit 0** | 「10 靶全綠」的退出碼完全不可信 | 累計 `MUT_FAIL`、以 `[ "$MUT_FAIL" -eq 0 ]` 收尾。<br>✅ **不是宣稱修好,是實際被它抓到**:折疊過程中 M8 真的失敗,`mut-exit=1`(見 §18-E) |

### 18-B 判別力歸屬(R1 的 D 段:「突變表沒有『只紅那一格』的證據」)

行為靶必然改到 `prosrc`,而 `run` 裡的 `0-1 post-image md5` 那格**對任何源碼變動都會紅**
⇒ 舊判準「有沒有出現那個標籤」等於把那一格的功勞記到被測守門頭上。

**改法**:先跑一個**行為惰性**的突變(只改函式本體裡的一行註解文字),
量出「純因源碼變動就會紅」的格集合 = `BASE_RED`;行為靶的判準改成
**期望格 ∈(該靶紅格集合 **−** `BASE_RED`)**,且報告逐靶印出**完整紅格集合**。
`BASE_RED` 是**實跑量出來的**(實測 = `[0-1]`),不是我宣告的。

### 18-C 「找得到字串」的其餘四處(B 段字面/範圍修,但病同源)

| 處 | 舊形狀怎麼繞過 | 新形狀 |
|---|---|---|
| 後置⑤ COMMENT 前綴 | `LIKE` 把舊全文裡的 `_` 當萬用字元 ⇒ `request_id` 被改成 `requestXid` 仍判「逐字保留」 | `starts_with()` |
| 後置⑥ carve-out 範圍 | regex 只認「別名 `e.` + `=` + 字面」;改 `IN (...)`、換別名、串接組字串 ⇒ **零命中 ⇒ 綠燈** | 不枚舉寫法:`event_type` 的**出現次數**與**合格形式次數**都必須恰好 1 —— 不必知道那是什麼新寫法就能擋 |
| 後置⑦ 回傳碼閉集 | 同上;寫成 `'result', v_code` 就抽不到 | `'result'` 鍵的出現次數 **=** 緊接 8 碼字面的次數 |
| P6 值域 | 四個 `LIKE` 只證明「**至少**有這四個」;多出第五個值照樣全綠 | 抽出集合與 `{processing, confirmed, failed, deferred}` **相等** |

### 18-D 範圍擴大的兩處(Sean 裁 `Q-P591-1`=A;主視窗 `P-592-A`)

- **P1c / P3b ACL**:舊寫法逐一問四個角色「有沒有 EXECUTE」= **抽樣**,第五個角色被授權時全綠。
  改成從 `proacl` 反向展開、比對**整個授權集合**(2e = 僅 owner;② = 恰好 {owner, service_role})。
  🔴 `proacl IS NULL` 一律判失敗 —— 函式的預設 ACL 是 **PUBLIC 可 EXECUTE**,
  NULL 代表「從沒動過權限」= 全世界都能執行,不是「沒有人有權限」。
  ⚠️ **這道翻紅代表正式庫授權現況與預期不符 ⇒ 停下來寫信給主視窗、由 Sean 裁,
     不得為了讓 apply 過去改授權。**(P 十代 `P-591-NOTE` 承諾 / 主視窗 `P-592-A` 明文)
- **P4b `security_invoker`**:`pg_get_viewdef` 只涵蓋「SELECT 寫了什麼」。
  `security_invoker` 被關掉 ⇒ view 改以 owner 身分讀底表、RLS 適用對象整個換人
  ⇒ 終局判定看到的列集合變了,而 **viewdef 一字未改、md5 照樣相符** = 無聲失效。
  ⚠️ owner 與 relacl **刻意不釘**:它們被改的失效模式是「讀不到 ⇒ 42501 fail-loud」,
  不是無聲改語意;跨庫 owner 名稱也不同,釘了只製造假性漂移。

### 18-E 折疊過程中**自己**踩到的五個坑(不在 R1 findings 內,實跑抓出來的)

這幾條的共同點:**都是「守門/量具自己壞掉」而不是被守的東西壞掉** —— 與 §17-2 同族。

1. **`format('%s', boolean)` 印的是 `t`/`f` 不是 `true`/`false`** ⇒ 我拿 `::text` 量出來的期望字面
   寫進閘②b,結果**期望值與量法用不同的渲染**、恆不相等。是那道新閘自己在第一次實跑時把我攔下的。
2. **L1 格的 `bigint → oid` 走 `::int` 會溢位**:`pg_locks.classid/objid` 是 **oid = 無號 32 位**,
   而 `int` 有號 ⇒ 半段值落在 `2^31..2^32-1` 時直接 `ERROR: integer out of range`。
   鍵由 `order_id` 決定 ⇒ 這是**看訂單抽到什麼才發作的 flake**;
   🔴 **先前跑綠只是那幾顆 uuid 剛好沒撞上,不是那格對。** 改 `& 4294967295` 再 `::oid`
   (實測:`('x'||'ffffffff00000001')::bit(64)::bigint` 之下舊式 ERROR、新式回 `4294967295`)。
3. **`provision()` 在 `rm -rf` 之前沒先 teardown**:直接刪一個**還在跑**的叢集資料目錄,
   postmaster 不會死,它抱著已被刪掉的檔案繼續佔埠 ⇒ 下一次 provision 綁不到,
   整條路死在「叢集沒起來」而看不出真因(本輪踩到兩次)。`mut` 那條路本來就先 teardown,
   **`all` 那條路漏了** —— 同一個坑,一條路修過、另一條沒有。
4. **`all` 會把 2f apply 兩次**:`provision` 已套過 repo 全部 migrations(含 2f),
   `all` 又套一次 ⇒ 前置閘 P2(釘 pre-image)必然擋下。那**不是 apply 壞了,是閘在做它該做的事**;
   改成「現況已是 post-image 就不重套」。(這條 v5 就存在,只是九代跑的是 `run`/`rb` 分開模式、沒走到。)
5. **`mode_rb` 與新閘②c 互相踩**:`run` 的 C/D 格會刻意留下**仍在途**的 `payment_refunds`,
   回退閘②c 因此拒絕回退 —— **那是它該做的事**(撤掉否決 = 那些單立刻可再開一筆並行退款)。
   修法是在 `rb` 前用**領域正確**的方式解除在途:補終局事件(append-only,**不 DELETE** ——
   `payment_refunds` 有 `prl_append_only_guard`,實測擋下我第一版的 DELETE 清理)。
   閘②c 自己的負測留在 `neg` N5,不靠 `rb` 驗。

---

## §19 v6 → v7 折疊對照:**diff 層 R1 第二輪 codex**(12 MF + 18 IMP + 3 nit,**FAIL**)

> findings 逐字(去重 39 行)= `pcm-mailbox/附件-P-2f-diffR1v6-findings.md`;
> codex 全文 5764 行 = `pcm-mailbox/P-2f-diffR1v6-codex-full.txt`(R2 換模型時要對照全文,不能只看去重版)。
> 逐條形狀改動 = §7-10 那兩張表;本節只寫**為什麼這一輪會長成這樣**。

### 19-0 一句話病根

**v6 的修法自己製造了同型的洞。** 上一代在 §18-0 逐字寫下判準
(「加一個否定詞 / 換個寫法 / 多一份會怎樣」),然後在同一輪的修法裡三個都沒真的問完。
33 條裡有一半打的不是 v5 的舊形狀,而是 **v6 新寫的守門**。

三個具體形狀,每一個都出現不只一次:

| 形狀 | 例 | 為什麼守門看不見 |
|---|---|---|
| **加一個否定詞** | `NOT EXISTS`→`EXISTS`(①b/①b2)、`AND NOT e.event_type`(⑥)、`NOT e.event_type` 之下計數不變 | 守門數的是「名字/字面出現幾次」,而否定詞既不改名字也不改次數 |
| **換一種寫法** | `'res'\|\|'ult'`(⑦)、`lock_timeout=0`(P1b)、識別字換成 `p_request_id`(②) | 守門比的是「有沒有這個片段」或「兩個計數相不相等」,而換寫法可以讓兩個計數**同步**變化 |
| **改大小寫** | `PG_ADVISORY_XACT_LOCK`(①d/②a) | SQL 識別字不分大小寫,但 regex 分 |

⇒ v7 的守門形狀一律要能回答這三問。**做法不是多寫幾條斷言,是換形狀**:
全稱計數(總數 = 合格數)+ **絕對數**(擋同步減少)+ **連著左鄰的語法一起比**(擋插入否定詞)。

### 19-1 這一輪自己踩到 / 自己認的四件事

1. **「以閘為單位」數負測覆蓋率會系統性高估**(§13-2 已更正)。複合述詞的一格只紅得到一支,
   而驗收條款寫的是「每條守門」。**重數要以子述詞為單位**。
2. **守門守到把逃生門焊死**(回退閘②c)。回退腳本被拿出來用的主要情境就是「這片自己把單卡住」,
   而 v6 讓「有在途列」無條件封死回退 ⇒ 條件退化成「只有不需要回退時才准回退」。
   v7 的出口不是放寬,是**讓「知情」變成可機械驗證的條件**(帶對當下筆數才放行、放行留痕)。
3. **一道恆綠的守門要照實說**(P5b)。本機叢集 owner 是 superuser ⇒ `rolbypassrls` 恆真 ⇒ 那道紅不了,
   而「只紅它」的負測會同時觸動 P3b 與後置③ ⇒ **未驗就寫未驗**,不寫成「已覆蓋」。
4. **改判準前先 grep 全樹找鏡像**。v6 改了 migration 後置②,漏了 harness 的 B4 鏡像,codex 直接抓出來;
   v7 一律三份一起改:migration 後置斷言 / harness 的 B、E 段格 / 本檔 §7-9-7-10 表。

### 19-2 一個**沒有**照 finding 字面做的地方(逐字記,不埋)

`rm -rf` 那條 finding 說的是「workdir 只驗 `/tmp/*` 前綴」。字面上的修法是把前綴驗得更嚴,
但那樣**外部仍然決定刪除目標**。v7 改成 workdir 完全由本檔自產(`/tmp/p2f-<PORT>`、PORT 先驗純數字)、
所有 `rm -rf` 只走 `safe_rm_workdir()` 一個入口。⇒ 比 finding 要求的更靠上游,
代價是 `run/rb/neg` 不再吃第二個位置參數(用法字串已同步改)。

---

## §20 v7 → v8 折疊對照:**diff 層 R2(換模型輪,Opus fresh-context)**(4 MF + 10 IMP + 5 nit,**FAIL**)

> findings 逐字 = `pcm-mailbox/P-2f-diffR2-findings.md`(含 reviewer 自報「看過但沒找到問題的面」全段)。
> 主視窗裁決 = `pcm-mailbox/P-607-A.md`。逐條形狀改動見 §7-11 / §7-12,本節只寫**這一輪學到什麼**。

### 20-0 換路裁決:結構斷言補不完,語意要下沉到行為層

`P6-op` 在 R1 被 `<>` 繞、我補了運算子、R2 立刻被 `NOT (...)` 繞 —— **同一道守門、同型繞法第二次**。
照 R4「相同錯法第 2 次 = 換路」,主視窗裁定**不准再補第三個變體**。

換路的內容不是放棄守門,是**認清兩層各自能證什麼**:

| | 結構斷言(migration 內) | 行為靶(`neg` 模式) |
|---|---|---|
| 證的是 | catalog **文字**沒被換掉 | 語意**真的**是那樣(寫得進去 / 寫不進去) |
| 對等價寫法 | 永遠有第 N+1 種繞法 | **一視同仁**(驗行為不驗文字) |
| 跑得到正式庫嗎 | ✅ apply 當下就跑 | ❌ 需要寫測試資料 |

⇒ 兩者**不互相取代**,但**加碼的方向要對**:語意面加在行為層,結構層只留「明顯形狀變動」的偵測。
交件物 = §7-11 那張逐道對照表(哪幾道配上了行為靶、哪幾道明說沒配)。

### 20-1 這一輪最貴的一課:**「構造不出來」的成本比我以為的低很多**

R2 命中我 v7 寫下的**兩條誠實缺口**,而且各給了一個十行就做得到的構造:

| 我 v7 寫的 | 實際上 | 現在 |
|---|---|---|
| P5b「本機 owner 是 superuser ⇒ 恆綠,負測紅不了它;換 owner 會同時觸動 P3b 與後置③」 | `CREATE ROLE` + `ALTER FUNCTION … OWNER TO` 就只紅它。ALTER OWNER **保留** GRANT(P3b 不動)、後置③ 比的是同一次 run 內拍的快照(也不動)。**我那句是推的,不是量的。** | `neg` **N11b** |
| ①a2「要把呼叫整段搬到步 1 之前,sed 搬不動」 | 不必**搬**,**插入**一顆 advisory 讓 `i_adv` 前移就破得掉 | `mut` **M23** |

🔴 這兩條的形狀與 memory `feedback_false-unconstructible-claim-is-worse-than-false-verified` 一字不差:
**假的「構造不出來」披著謙虛的外衣,把工作從 plan 裡拿掉。** 而它比假的「已驗證」更難被抓 ——
因為它讀起來像誠實。⇒ 規則:**寫下「構造不出來」之前,先花十分鐘真的試著構造一次。**
v8 順著這條把另外兩處也補了:N7b(回退文字誤帶 SET)、N7c(註解含 `/*` 的 writer)——
兩者我原本也打算寫成「rollback 沒有 mut 模式 ⇒ 測不到」,實際上 sed 一份副本就跑得起來。

### 20-2 「表填錯比沒有表更危險」

R2 只抽驗了交接檔 §2 表的 5-8 列就抓到**兩列填錯**(§2-3 回退後置、§2-2 ①c)。
兩列的共同形狀:**我把「有一個負測存在」讀成了「這一面被守住」**,而那個負測驗的是隔壁那一面
(N4b/N4c 驗的是還原**前**的閘②b,不是還原**後**的 proconfig;M17 驗的是整串替換,不是空白變體)。
⇒ 修完那兩列之後**全表逐列重驗**(不是只改被點名的兩格),並在每一列寫清楚**是哪一格在驗哪一面**。

### 20-3 這一輪自己撞出來的三件事(不在 findings 內)

1. **行為探針第一版量錯東西**:`order_refunds` 的 INSERT 路徑上有既有 trigger
   (`pcm_a7c_refund_insert_guard`)排在 CHECK 之前 ⇒ 把期望釘死成 `SQLSTATE=23514`
   會變成「量到的是 trigger、宣稱的是 CHECK」。改成 `probe_blocked_any`(只斷言被擋、印出實際攔截碼),
   要釘死 SQLSTATE 的只留 N12d(翻面之後確實由 CHECK 擋)。
2. **探針的 SQLSTATE 不能從訊息文字撈**:本機 psql 是繁中語系,`ERROR:`/`SQLSTATE` 這些字面**根本不出現**
   ⇒ 第一版 `grep 'SQLSTATE'` 判成「五格全都沒被擋」,而實際上全都擋了。
   **量具用錯觀察點,看起來就像被測物壞掉。** 改成讓 DB 自己用固定字串吐 SQLSTATE(與語系無關)。
3. **刻意吞例外的設計,一定要配一個「正常情況下真的有寫進去」的斷言**:
   核准留痕的 `INSERT admin_audit_log` 包了 `EXCEPTION WHEN OTHERS`(為了不讓 audit 故障擋住回退),
   而第一版 `source_app='script'` 撞 CHECK(只吃 `{admin,quote}`)⇒ 被**吞成一行 WARNING**,
   「核准會落一列」當時是假的。是 N5d-audit 那格把它抓出來的。

### 20-4 沒有照 findings 字面做的一處(逐字記)

R2 對 `pcm.rb_2f_inflight_override` 的 nit 建議「用 `pg_settings.source` 擋常駐值」。
**本機實測(PG 17.10):自訂 GUC 不論用 `SET` 或 `ALTER DATABASE … SET`,在 `pg_settings` 都查不到列**
(`current_setting` 讀得到值)⇒ 那條路走不通。改查 `pg_db_role_setting.setconfig` ——
它只收 `ALTER ROLE/DATABASE` 那一類,正好就是要擋的東西。**建議的方向對、量法要自己驗過再用。**

---

## §21 v8 → v9 折疊對照:**diff 層 R3(換模型 Fable + 換角度:框架層)**(2 MF + 5 IMP + 3 nit,**FAIL**)

> findings 逐字 = `pcm-mailbox/P-2f-diffR3-findings.md`;主視窗裁決 = `pcm-mailbox/P-610-A.md`。
> reviewer 自報已對照 R1/R2 兩份 findings、**無一條重複**(pooler / 42P01 / L2 語系 / 述詞鏡像四個關鍵字在兩份舊 findings 檔 grep 均 0 命中)。
> **這是最後一輪** —— R3 逐字「技術正確性層無新增」,主視窗據此判停(不是憑輪數)。

### 21-0 換角度之後,抓到的東西整個不一樣

| 輪次 | 模型 | 打什麼 | 抓到的形狀 |
|---|---|---|---|
| R1 | codex | **形狀** | 「找得到這個字串」不是守門 |
| R2 | Opus | **形狀 + 語意** | 修法自己製造同型洞;結構斷言補不完 |
| R3 | Fable | **框架** | 守門在**唯一需要它的那天**是壞的 |

R3 的兩條 MF 都不是「這行寫錯了」,而是 **「這扇門在災難當天打不開」**:

1. **pooler 連線恆失效** —— 我們花三輪把核准出口做對(綁身分、擋常駐、留痕),
   而它在 **Supabase 預設常給的連線字串**上整扇焊死:`-c` 的 SET 與 `-f` 的本體落在不同 backend
   ⇒ `current_setting` 恆 NULL ⇒ **指紋帶對也永遠被擋**,症狀只有一行「現況帶入值 = <未設定>」,
   讀起來像值班抄錯指紋。**全案零字提過要直連 5432。**
   ⇒ 修:檔頭把連線拓樸寫成前提、②c 失敗訊息直接告訴值班「這是拓樸問題不是你抄錯」、§9 列進假設。
2. **canonical view 缺席時回退跟著死** —— 那顆 view 被 drop **正是 2f 最壞的事故形態**
   (② 的否決每次呼叫 42P01 ⇒ 有 `payment_refunds` 歷史的訂單全部退不了款),
   而那天要做的事就是撤掉 2f;舊寫法閘②c 與 ②c-recheck 都無條件查它 ⇒ 自己 42P01 ⇒ 整筆 abort。
   **D1 前科同型:回滾守門在唯一需要它的那天擋死自己。**
   ⇒ 修:`to_regclass` 先測;缺席時**轉核准路徑**(`view-absent` 這個明確核准值)+ 留痕;
   recheck 缺席時跳過並大聲說「這趟沒有集合未變動的保證」。負測 **N13a/N13b/N13c** 三格。

### 21-1 「修一族的時候要問:這族還有誰」

R3 答了主視窗的加題:我自報的三個量具坑修對了,但**同族還有第四例** ——
`L2` 判「被 lock_timeout 中止」還在 `grep -qi 'lock timeout'` **撈英文訊息文字**,
而我在 v8 才因為「從訊息撈 SQLSTATE、繁中語系下五格全誤判」修過 `probe_*` 家族。
**它在這台機器上會過,是因為那句話剛好沒被翻譯 —— 運氣不是設計。**
⇒ 改成讓 DB 自己吐 `SQLSTATE=55P03`。教訓寫進檔內註解:**修一族的時候要問「這族還有誰」。**

➕ 這一輪自己又踩了同族**第五例**:N13 第一版**放錯位置** —— 放在 neg 前段,
那時現況是 pre-image,閘② 會在 `v_md5 = c_pre_md5` 那一支直接 RETURN、**根本走不到 ②c**
⇒ 兩格都印「這條守門沒有判別力」。**量具擺錯位置,長得跟被測物失效一模一樣。**

### 21-2 在途述詞:九份手抄,零跨檔等價釘

R3 點名五處,我實際數出來是 **9 處**(`migration` 函式本體 + 後置⑧、`rollback` ②c + recheck、
`verify.sh` RB0/PRED/N5b… 等)。數法逐字:

```
for f in <migration> <rollback> <verify.sh>; do
  sed 's/--.*$//' "$f" | tr '\n' ' ' | tr -s ' ' \
    | grep -o "NOT EXISTS (SELECT 1 FROM public\.payment_refund_effective_terminal[^;]*result_success')"
done | sort | uniq -c        # → 9 份、全部逐字相同
```

鎖鍵因為 R1 MF4 拿到了跨函式等價斷言(後置②),**同樣吃重的在途定義卻一份都沒有**。
真正的失效時點不是今天,是 **2g 上線時那個定義必然被重新談判** —— 改了函式那一份之後,
閘②c 會用**過期定義**判「無在途、可回退」,放行的正是新定義下的在途單。
⇒ harness 補 **B5**(九份剝註解+空白正規化後必須逐字同一份)+ **B5b**(抽到的份數 ≥5,
證明上面那格比的是**全部副本**不是零個 —— 沒有 B5b 的話,抽取式子一過期,B5 就變成恆綠)。

### 21-3 ②b 的不對稱:出口給了最不需要的人

R3 的論證我特別服氣:**製造第三態的最可能的人,就是值班自己** ——
凌晨事故的第一手緩解幾乎必然是 `ALTER FUNCTION … SET lock_timeout='3s'`(把 10s 調小),
而那個動作當場就把現況變成 ②b sidecar 第三態。②c 拿到了完整核准出口、②b 沒有,
訊息只有「先查清楚誰改的」——**不對稱恰好壓在自救過的人身上**。
⇒ 修:訊息直接寫下一步(把旁支 ALTER 回上面印出來的 post-image 字面再重跑),
並說明**為什麼這道刻意不給核准出口**(它擋的是會被靜默吃掉的改動,而改回來成本很低)。

### 21-4 這一輪**沒有**發現的事(逐字保留,供下一代判覆蓋度)

R3 自報:**未發現前兩輪修法互打的實例**(①c 換 v_norm 未動 ①a 座標系;④ 與回退後置兩側已對稱;
audit「寫失敗不擋回退」的不對稱是刻意且方向正確);恆綠化檢查 —— `probe_blocked_any` **沒有**
掏空 N12d 的判別力;§7-11 抽驗 N12d(釘 23514)/ N1d(釘 23505)**只紅對應那一道**;
M24 的紅格集合相等判準已實跑。§9 已列的六條假設逐條核過,**沒發現「被證偽即價值反轉」而未自陳的**。
