# L5b-2 片 **2e** — `close_released_attempt` 加入序列化點與退款否決 · 片級 plan **v4**

> **母 plan**=`docs/specs/2026-08-10-l5b-2-compensation-writer-plan.md`(v8)。本檔**不重新設計**,只把該檔 §3a-4/3a-5/3a-6a/§2b 對 ③ 的要求**落成可實作的一支 migration**,並記錄**實查之後與母 plan 字面不同的地方**。
> **片型=🔴 高風險片**(母 plan §2 片表逐字「鐵則 12 ①②③」;動的是**已上線、正在收錢/退錢**的 SECDEF RPC)⇒ 全 9 步、對抗審查不降級、**單獨審不與 2f 合併**(母 plan `:592`)。
> **依賴**:2d(`20260811110000`,已 apply)+ 沖銷片(`20260812140000`,已 apply,交付 canonical view)。
> **migration 號=`20260812160000`**(主視窗 `P-561-A` 發;150000=D 之 #423)。
> **序**:🔴 **2e 必須早於 2f** —— 母 plan `:718` 要求 2f 的 preflight 釘 **2e 的 post-image `prosrc` 指紋**,那顆指紋要 2e 落地才存在。片表寫的 `2e ‖ 2f` 在**實作面不成立**。
>
> **版本**:v2=關卡1 折疊 / v3=code-reviewer R1 折疊(§12)/ **v4=codex R2 折疊(§13)**。
> **v2 折了什麼**:關卡1 Fable 替身 3 must-fix + 4 nit(`P-564-A`)+ 我自己拋棄式叢集六條實測翻出的一處自錯(`P-562-NOTE`)+ 回退來源查核翻出的一處自錯(§6)。逐條對照見 §11。

---

## §1 開工前置實查(2026-08-12 當天對正式庫 `bmpnplmnldofgaohnaok` 唯讀重量)

母 plan §2a-X 第 1 條要求「指紋逐函式逐環境重量,不得沿用」;`docs/specs/2026-08-12-2e2f-precheck-recon.md:24` 自己也寫「實作當天要重查一次再落字面」。**已重查,兩顆皆未漂移**:

| 項 | `close_released_attempt`(本片) | `admin_initiate_order_refund`(2f 用) |
|---|---|---|
| `md5(prosrc)` | `fa8afcc2bf0f3c683e156a719fea80f0` | `f98e25f58dde8306772e157f0c7cc5cb` |
| `length(prosrc)` | 2891(**字元**,非位元組) | 7006 |
| 簽章 | `(p_attempt_id uuid, p_resolution text)` | (8 參數,見 recon §1) |
| SECDEF / owner | ✅ / `postgres` | ✅ / `postgres` |
| 🆕 **`proconfig`** | **`search_path=""`** | 🔴 **`search_path=public, pg_temp`** |
| 🆕 **`proacl`** | **`postgres=X/postgres`**(僅 owner) | `postgres=X/postgres \| service_role=X/postgres` |

### 1-1 🔴 recon §1 漏記的一欄:`proconfig` 兩支不同

recon 的表只記「SECDEF / owner」兩格。實查發現兩支的 `search_path` **不一樣**。
對本片的直接後果:**`CREATE OR REPLACE FUNCTION` 會整支重寫函式屬性,子句沒寫到的一律回預設。**

✅ **已實測**(拋棄式 PG17.10,`P-562-NOTE` 探針 P1):建立時 `SECURITY DEFINER SET search_path = ''` ⇒ `proconfig=search_path=""` / `prosecdef=true`;
再 `CREATE OR REPLACE` **不帶子句** ⇒ `proconfig` → **NULL**、`prosecdef` → **false**。
⇒ 漏寫的代價**比原本假設的更重**:不只失去 search_path 釘死,**連 SECURITY DEFINER 都會掉**(變 INVOKER ⇒ 該函式對 owner 以外的呼叫者直接失去它存在的理由)。
(對 2f 的後果更大——不得照抄 2e 的 `search_path = ''`;那會改掉一支 7006 字元、識別子未必全 qualified 的已上線 RPC 的解析規則。**寫在這裡是為了讓 2f 不必再踩一次**。)

### 1-2 🔴 母 plan §3a-10 的「員工可見」論述對本片**不成立**

母 plan `:395-397` 要求在 apply 停點對 Sean 講一句「`lock_timeout` 會讓員工原本『等一下就成功』的正常競爭直接失敗」。
實查 `proacl`:本函式 **只有 `postgres` 有 EXECUTE**,COMMENT 逐字「REVOKE 5 角色含 payment_confirmer、無 GRANT = owner/postgres only(Phase 1 受控人工流程)」
⇒ **沒有員工路徑**,它是 owner 手動、低頻的收尾操作。該句揭露**照抄過來會是假的**。
**主視窗 `P-561-A` 已裁 Q-2e-3=照實改**:揭露文字寫「owner 手動路徑,從**無限等**改成 3s 快速失敗」;母 plan 該句由主視窗標作廢註記。

順帶查到的角色層設定(它們決定 `lock_timeout` 是不是死碼):

| 角色 | `statement_timeout` | `lock_timeout` |
|---|---|---|
| `postgres`(本片唯一呼叫者) | **無** | **無**(✅ 實測 `current_setting` = `0`) |
| `service_role`(2f 的呼叫者) | 300s | 無 |
| `payment_confirmer` | 8s | **5s** |
| `authenticated` / `anon` | 8s / 3s | 無 |

⇒ ① 本片加 `lock_timeout` **不是死碼**(postgres 角色目前是**無限等**)。
⇒ ② 母 plan `:399` 建議的「先設寬如 10s」若套在 `payment_confirmer` 身上會是**放寬 5s→10s 且永遠打不到**(8s statement_timeout 先炸,而且吐的是 57014 不是 55P03,反而更難診斷)。**幸好該角色呼不到這兩支** —— 但這條要寫進 2f/2g,不能等到那時再發現。

### 1-3 母 plan `:357` 指定的開工前置:`order_refunds.status` 值域 —— **已收**

⚠️ **片別註記**(nit N4):母 plan `:358` 把這件事指派給 **2f**;2e 先收是因為 §3-2 要論證「為什麼不查這本帳」,**先收無害、不代表 2f 可以不看**。

實查正式庫 `order_refunds_status_check`:`CHECK (status = ANY (ARRAY['processing','confirmed','failed','deferred']))`
定義處 `supabase/migrations/20260803150000_m3_a7c_rw1a_refund_write_rpcs.sql:184-186`。

| 集合 | 值 | 證據 |
|---|---|---|
| **在途** | **`processing`(只有這一個)** | 狀態機 trigger `order_refunds_status_transition_bu`(**catalog 親驗在庫**,函式 `pcm_order_refund_status_transition`,`md5=c97ed6ce3ae502e357994cb445621dcc`)本體逐字:`OLD.status = 'processing' AND NEW.status IN ('confirmed','failed','deferred') THEN RETURN NEW; … RAISE '…(confirmed/failed/deferred 皆為終態);拒繼續'` |
| **終局** | `confirmed` / `failed` / **`deferred`** | 同上;定義處 `20260803150000:201-217`,`deferred` 建欄註解 `:183` 逐字「status 加第四值 deferred(**終態**;10024=還不能做)」 |

🔴 **`deferred` 是終局不是在途** —— 這格若判反,「有在途退款就不准開新的」會**永久封死**那張單後續所有合法退款。
⚠️ 證據取得方式的分層(誠實):值域與 trigger 存在性/本體=**主對話對 catalog 親驗**;「全 repo 無任何路徑改得動 deferred」=subagent 掃檔案得出、**我只複驗了 trigger 這一道 DB 側 fail-closed**。**本片不依賴應用層那半**(見 §3-2:2e 根本不查 `order_refunds`)。

---

## §2 現況本體與新順序(**寫錨之前先開本體**;母 plan `:318` 自陳這條已犯過兩次)

`prosrc` 已逐字取回。現況九段:

```
1 DECLARE(v_actor := session_user …)
2 p_resolution 必填非空 → RAISE
3 SELECT a.status, a.released_closed_at, a.order_id … FROM payment_charge_attempts a
    WHERE a.id = p_attempt_id FOR UPDATE          ← 第一個觸資料動作、也是取得 order_id 的唯一來源
4 NOT FOUND → RAISE 'attempt % 不存在'
5 冪等:v_status='failed' AND v_closed_at IS NOT NULL → RETURN {closed:true, idempotent:true}
6 v_status <> 'released' → RAISE
7 SELECT o.payment_status … FROM orders o WHERE o.id = v_order_id FOR UPDATE
    NOT FOUND OR <> 'unpaid' → RAISE(order-paid guard,fail-closed)
8 UPDATE payment_charge_attempts SET status='failed', released_closed_* …
9 GET DIAGNOSTICS ROW_COUNT <> 1 → RAISE;RETURN {closed:true, idempotent:false}
```

**2e 之後的順序**(🆕 = 本片新增;其餘**逐字不動**):

```
   函式層 SET 子句:SECURITY DEFINER SET search_path = '' 🆕 SET lock_timeout = '3s'
1 DECLARE(🆕 + v_order_id_pre uuid, + v_blocking_refund uuid)
2 p_resolution 必填非空 → RAISE                                   不動
🆕 A  無鎖 SELECT a.order_id INTO v_order_id_pre … WHERE a.id = p_attempt_id
       NOT FOUND → RAISE 'attempt % 不存在'(訊息與步 4 逐字相同)
🆕 B  PERFORM pg_catalog.pg_advisory_xact_lock(<order 鍵 from v_order_id_pre>)
3 …FOR UPDATE(原樣;仍 INTO v_order_id)                           不動
4 NOT FOUND → RAISE                                              不動(防 A→3 之間被刪)
🆕 C  v_order_id IS DISTINCT FROM v_order_id_pre → RAISE(P2E02)   ← MF3
5 冪等 → RETURN idempotent:true                                   不動
6 status <> 'released' → RAISE                                   不動
🆕 D  未結案退款否決 → RAISE(P2E01)
7 order-paid guard                                                不動
8 UPDATE                                                          不動
9 ROW_COUNT guard + RETURN                                        不動
```

🔴 **v1 的步 A(body 內 `SET LOCAL lock_timeout`)已刪除** —— 改放函式層 SET 子句,理由與實測見 §3-3。
**碼段**:`P2E01` / `P2E02`。✅ 已 grep 全 `supabase/migrations/*.sql`,`P2E` 碼段命中 **0**,不撞號。

---

## §3 三個改動點,逐點論證

### 3-1 序列化點(A/B)+ order_id 復核(C)

**為什麼不能沿用現況直接在步 3 之後取鎖**:母 plan `:258-260` 已證——那會構成「close 持 attempt 列鎖等 advisory ╱ 補償持 advisory 等 attempt `KEY SHARE`」= **40P01**。
**修法**=母 plan `:261` 的 v6 形狀:**無鎖讀 order_id → 取 advisory → 才走原本的 `FOR UPDATE`**。

- **鍵**(母 plan `:245-246` 逐字,不改):
  `pg_catalog.pg_advisory_xact_lock(('x' || pg_catalog.substr(pg_catalog.replace(v_order_id_pre::text,'-',''),1,16))::bit(64)::bigint)`
  取 uuid 前 64 bit、**不經 `hashtext`**(後者只有 32-bit,碰撞會讓不相干訂單共用隊伍,母 plan `:242`)。
  ✅ **已實跑**(探針 P3):對 `11111111-2222-…` 回 `1229782938533638963`,與母 plan `:248` 例值**逐字相同**。
  🔴 **三方必須用逐字相同的式子**,否則彼此不互斥而且**完全無症狀**。本片落點=把該式子當**字面契約**寫進 COMMENT;**跨函式一致性斷言歸 2f 與 2g**(它們才有第二、三份可比)。
  ⛔ **已評估並否決**「抽成 `pcm_order_advisory_key(uuid)` 共用函式」:它確實消滅漂移,但代價是在金流路徑上多一個可被單獨 `CREATE OR REPLACE` 的物件(改它=三方同時無聲改變),且母 plan 已審過的形狀是 inline。**不為此擴張範圍**。
- **無鎖讀為什麼安全**:`payment_charge_attempts.order_id` 是建立時寫入的 FK,母 plan `:262-263` 已實查「全 repo 無任何 UPDATE 改它」。
  🔴 **射程照抄母 plan `:264-266` 不打折**:這是**時點觀察,不是資料庫層不變量**(沒有 CHECK、沒有 trigger 擋 UPDATE)。
- 🆕 **C:復核(MF3)** —— 步 3 本來就重讀 `order_id`,**且會覆蓋同一個變數**。v1 就這樣放著 ⇒ 若該欄真的被人改了,函式會**鎖住舊單的隊伍、卻對新單動手**,而且**完全靜默**。
  v1 把這個風險整個押在靶 M4(文字掃描),而文字掃描對 dynamic SQL / owner 手動 `UPDATE` 全盲。
  ⇒ **改成函式內 fail-closed**:`v_order_id IS DISTINCT FROM v_order_id_pre` ⇒ `RAISE P2E02`。
  **成本=零**:合法請求下兩值恆等(沒有路徑改得動它),不拒任何現行請求、不改任何述詞。**M4 仍保留**,但它從「唯一防線」降級成「早期預警」。
  **位置=步 4 之後、步 5 冪等之前**:承重假設一旦被違反,連冪等回應都不該給(那份回應是在錯的隊伍下算出來的)。⚠️ 代價=**冪等路徑也可能 RAISE**,但只在一個「不該發生」的世界裡;fail-closed 優先。
- **NOT FOUND 必須 fail-closed**:✅ **已實測**(探針 P4):`pg_advisory_xact_lock(NULL)` **回 NULL、該交易 advisory 持鎖數 = 0、不報錯**。
  ⇒ 若 A 讀不到列而不 RAISE,函式會**完全無鎖地繼續往下走**。這道 RAISE **不是防禦性裝飾,是必要的**。

**🔴 一個對外可觀察的行為改變(誠實列出)**:
重複 close 一顆**已結案**的 attempt,現況是**立刻**回 `idempotent:true`;2e 之後它會**先排隊等 advisory**(上限 3s)才走到步 5。
**沒有把冪等分支提到 advisory 之前**,理由:那需要在無鎖狀態下判「已結案」為終態,而 `failed + released_closed_at` 是否**永不回頭**我沒有 schema 層證據(只有 COMMENT 說本 RPC 是唯一寫該欄者)⇒ 不拿一個沒證據的終態假設換 3 秒。

### 3-2 未結案退款否決(D)

**述詞**:
```
該 attempt 存在 payment_refunds 父列,且該父列在 canonical view 中沒有有效終局
⇒ RAISE(P2E01),不准結案
```
```sql
SELECT pr.id INTO v_blocking_refund
  FROM public.payment_refunds pr
 WHERE pr.attempt_id = p_attempt_id
   AND NOT EXISTS (SELECT 1 FROM public.payment_refund_effective_terminal et
                    WHERE et.refund_id = pr.id)
 LIMIT 1;
```
- 🔴 **消費 canonical view,不自己問「有沒有 manual」** —— 沖銷片交接的硬約束(線圖 `:74`、沖銷 plan §2d-1 契約)。母 plan `:476` 原本要求「認 `result_confirmed`」,**該字面已被沖銷片取代**:終局的定義由 view 給,2e 不得有第二份。
- **放在步 6 之後、步 7 之前**:
  - 必須**晚於步 5 的冪等分支** —— 否則「重複 close 一顆已結案、且身上掛著未結案退款的 attempt」會從 `idempotent:true` 變成被拒 = **改了既有語意**(同構母 plan `:290` 對 ② 的論證)。
  - 必須**晚於步 6** —— 非 `released` 的既有拒絕訊息優先,新碼不搶既有診斷。
  - 必須**早於步 8** —— 它要擋的就是那次 UPDATE。
- **為什麼只查 `payment_refunds`、不查 `order_refunds`**:母 plan `:576` 的字面是「**該 attempt** 有未結案退款」=attempt 尺度,而 `order_refunds` 是 order 尺度(無 attempt 欄)。**加查=改述詞、觸母 plan `:268`** ⇒ 不加。
  另一半論證:`order_refunds` 若有 `processing` 列,代表該單已付款過;而步 7 的既有 order-paid guard 要求 `payment_status = 'unpaid'`,**該情形本來就過不了**。
  🔴 **v1 在這裡寫錯了一句**(MF2):v1 說「⇒ 列入 §9,並在 §8 補一格觀察(靶 M6)」——**M6 驗的是 `payment_refunds` 那半**,`order_refunds` 那半當時**零觀察格**,而 §9 卻寫得像有。
  ⇒ **v2 真的補一格**(§8 靶 M9):fixture=該單有 `status='processing'` 的 `order_refunds` 列 ⇒ close **必須在步 7 被既有 order-paid guard 擋下**。它驗的不是我新增的守門,而是**我拿來當論證的那道既有守門真的在該情境下發火**。
- **`LIMIT 1` + `SELECT INTO`**:`INTO` 對多列**只靜默取第一列**;這裡只要「存在與否」,`LIMIT 1` 是為了讓意圖與行為一致,不是效能。
- **回傳形狀**:走 `RAISE`(與步 6 的既有拒絕同形),**不新增回傳碼** —— 本 RPC 的既有契約是「成功回 jsonb、拒絕一律 RAISE」,不破壞。

### 3-3 `lock_timeout = '3s'` —— **放函式層 SET 子句,不放 body**(v1 這節整個改寫)

🔴 **v1 錯在哪**:v1 §3-3 寫「本函式 `proconfig` 非空 ⇒ 進出函式有 save/restore 邊界,body 內的 `SET LOCAL` 函式返回時即還原」。
✅ **實測推翻**(探針 P2):呼叫前 `0` → 函式內 `3s` → **返回後仍 `3s`**。
**真相**:save/restore 只涵蓋**該函式 SET 子句自己列出的那些 GUC**(這裡只有 `search_path`);body 內對**別的** GUC 下 `SET LOCAL` 是**交易尺度**,不隨函式返回還原。
**影響**:正式路徑上這支是單語句 RPC(一語句=一交易)⇒ 外溢無害;但**任何把它包進更大交易的呼叫端**(psql `BEGIN` 區塊、或未來被別的函式呼叫)會被順帶套上 3s —— 而那正是本函式最常見的呼叫形態(owner 手動 psql)。

✅ **修法(已驗證,非提議)**:`lock_timeout` 寫進**函式自己的 `SET` 子句**:
```sql
CREATE OR REPLACE FUNCTION public.close_released_attempt(…)
  … SECURITY DEFINER SET search_path = '' SET lock_timeout = '3s'
```
- **射程正確**(探針 P5):`proconfig = search_path="" | lock_timeout=3s`;呼叫前 `0` → 函式內 `3s` → **返回後 `0`**。
- **效力還在**(探針 P6):對手持同鍵 advisory ⇒ **55P03 `canceling statement due to lock timeout`**,13:38:14→13:38:17 = **準 3 秒**。
- **這格不恆真**(P6 消融):同情境、函式**無** `lock_timeout` ⇒ 等到持有者釋放才回 `GOT`(6 秒)。**結果面與時間面兩個觀察都可分辨。**

**值 = 3s**,取母 plan `:393` 的建議值。**誠實**:母 plan `:398` 自陳「3 秒是憑判斷選的、沒有量過」,本片**沒有把它變成有依據** —— 但本片的處境比母 plan 假設的好:呼叫者 `postgres` 目前是**無限等**(實測 `current_setting('lock_timeout')` = `0`),任何有限值都是嚴格改善,而且**沒有員工路徑**(§1-2)⇒ 選錯的代價是「Sean 手動 close 偶爾要重按一次」,不是對客可見。
**覆蓋面**:它包住的是本函式執行期間的**所有**鎖(advisory + 兩道 `FOR UPDATE`),不只 advisory。

---

## §4 死結:advisory 什麼時候**不會**成環,什麼時候**會**(v1 的全稱句已被擊破,本節重寫)

PG 的死結偵測器**會**把 advisory lock 算進等待圖 ⇒ 「advisory 不在列鎖圖上」不能當免死金牌。

**v1 寫的全稱句**:「三方沒有任何一方在持有列鎖的狀態下去等 advisory ⇒ advisory 不可能在環上。」
🔴 **它是錯的(關卡1 MF1)**:那句只管得到**三支函式體內部**的取鎖順序,管不到**呼叫端交易先前已經持有的鎖**。

**可構造的環**(替身給的構造法,N2 要求寫進 plan,也正是靶 M5 的對手構造):
```
S1: BEGIN; UPDATE orders SET … WHERE id = Y;      ← 持 orders(Y) 列鎖
    SELECT public.close_released_attempt(<Y 的 attempt>, '…');
                                                   ← 進函式、等 advisory(Y)
S2: SELECT public.close_released_attempt(<Y 的另一 attempt>, '…');
                                                   ← 已持 advisory(Y),走到步 7 等 orders(Y) FOR UPDATE
⇒ S1 等 S2 的 advisory、S2 等 S1 的列鎖 = 40P01
```
🔴 **`lock_timeout` 不消滅這個環**,它只把「無限 hang」變成「快速失敗」——而且 `deadlock_timeout`(預設 1s)比 3s 早,實際會先吐 40P01。

**修正後的正確不變量(帶前提,不是全稱句)**:
> **只要每個呼叫端交易在呼叫這三支函式之前,沒有持有該訂單相關的列鎖**,則三方各自都在無鎖狀態下取 advisory ⇒ advisory 節點的入邊全部來自無鎖狀態 ⇒ 它不會出現在環上。

| 方 | 取 advisory 的位置 | 函式**體內**取鎖時手上有沒有列鎖 |
|---|---|---|
| ① 補償 writer(2g) | 第一個觸資料動作 | 無 |
| ② `admin_initiate_order_refund`(2f) | 步 2 之後、**步 3 鎖訂單之前**(母 plan `:292`) | 無 |
| ③ `close_released_attempt`(本片) | 無鎖讀之後、**步 3 `FOR UPDATE` 之前** | 無 |

**前提怎麼守**(函式管不到呼叫端,所以只能靠這三件,且要誠實說它們不是機制):
1. **寫進 COMMENT**(對外唯一可見的契約面):「🔴 勿在**已動過該訂單相關列**的交易內呼叫本函式 —— 會與另一條同單呼叫構成 40P01。」
2. ②③ 的正式呼叫路徑都是**單語句 RPC**(一語句=一交易)⇒ 前提自動成立;**風險面只有 owner 手動 psql 的多語句交易**。
3. 靶 M5 的**宣稱射程同步收斂**:它證的是「**在前提成立之下**,把取鎖位置往後挪會成環」,**不是**「本片消滅了所有死結」。

⚠️ **本片不宣稱消滅既有的 `begin` × close 阻塞**:現行 COMMENT 逐字記著「E10-A8c1 起 begin 持 orders 先鎖 ⇒『無反向鎖序⇒無死結』舊字面失效——本函式對 begin **只阻塞不死結**(實測 `scripts/a8c1-verify.sh L3b`)」。該結論不受本片影響,**也不被本片改善**。

> 🔴 **本行原本寫「`begin` 不參與 advisory」= 字面錯(R1 important 3),已改寫。**
> 實查 `20260804120000_m4b_e10_a8c1_begin_cancel_guard.sql`:`begin_charge_attempt` **有 advisory**(`:126`,per-user 鍵 `pg_advisory_xact_lock(pg_catalog.hashtextextended(v_order.customer_user_id::text, 0))`),而且它的鎖序是 **`orders FOR UPDATE`(`:100`)先於 advisory(`:126`)= 與本片相反**。
> 仍然不成環的**正確**理由:**兩把鍵不同**(per-user vs per-order = advisory 空間裡的**不同鎖物件**)⇒ begin 等的那個 advisory 節點不是本片持有的那個,沒有共用節點就構不成環。
> 為什麼這條非改不可:2f/2g 會照本節做鎖序推理。照舊字面(「begin 沒有 advisory」)推出來的「所以怎麼排都安全」是**假前提**;照新字面推,下一個作者才會問對問題 ——「**我的鍵會不會跟別人的鍵撞**」。
> ⚠️ 附帶射程:64-bit 鍵空間下 per-user 與 per-order 鍵**理論上仍可能碰撞**,那是機率不是不變量;本片不宣稱碰撞不可能,只宣稱它不是可構造的風險面。

---

## §5 `CREATE OR REPLACE` 的屬性保留清單

母 plan §2a-X 第 7 條:**不改回傳形狀就走 `CREATE OR REPLACE`,不走 `DROP`+重建**(後者會帶走 owner/ACL/COMMENT)。本片**不改簽章、不改回傳型別** ⇒ `CREATE OR REPLACE`。

| 屬性 | `CREATE OR REPLACE` 會怎樣 | 本片動作 |
|---|---|---|
| `proacl`(`postgres=X/postgres`) | **保留** | 後置斷言逐字釘住(含負向:`service_role`/`authenticated`/`anon`/`payment_confirmer` 皆**不得**有 EXECUTE) |
| owner(`postgres`) | **保留** | 後置斷言 |
| `proconfig` | 🔴 **不寫就回 NULL**(✅ 探針 P1 實測) | DDL 顯式 `SET search_path = ''` **與** `SET lock_timeout = '3s'`;後置斷言**逐 GUC 各一格**(理由見 §8) |
| `prosecdef` | 🔴 **不寫就變 `false`**(✅ 探針 P1 實測,非推論) | DDL 顯式 `SECURITY DEFINER`;後置斷言 |
| COMMENT | **保留** | 仍重寫(要補四件新語意:advisory 鍵式子、P2E01/P2E02 兩碼、`lock_timeout`、§4 的呼叫端前提) |

**前置閘**:釘 pre-image `md5(prosrc) = fa8afcc2bf0f3c683e156a719fea80f0`,不符即整片 abort(形制照沖銷片 §①)。
**後置斷言**:post-image `md5(prosrc)` 記進檔尾**供 2f 的 preflight 引用**(母 plan `:718`)—— 🔴 該顆值**要等本片實作定案後才量得到**,plan 階段留空,**不預先編造**。

---

## §6 Rollback(母 plan §2b `:718-726` 的硬形狀)

🔴 **必須是「單一交易可執行腳本」**,不是檔尾座標逐句手跑 —— 母 plan `:719-724` 已實測:`psql -f` 逐句 autocommit、無 `ON_ERROR_STOP` 之下,`DO … RAISE` 之後**後續每一句照跑**,閘等於被滾過去(散跑靶表 1 列 / 單一交易 0 列)。

### 🔴 6-1 還原來源是**兩個不同的檔**(v1 寫錯,本輪自查抓到)

v1 §6 寫「還原 pre-image 本體 + COMMENT,逐字節取自 `20260624120010` 的 sic 版」。
實查 `grep -n 'close_released_attempt' supabase/migrations/20260804120000_*.sql` → 四處:`:27` 註解 / `:62`+`:64` preflight md5 閘 / **`:215` `COMMENT ON FUNCTION` 重寫**。
⇒ **A8c1 只重寫 COMMENT、沒動本體。**

| 回退對象 | 正確來源 | 驗證狀態 |
|---|---|---|
| **本體** | `20260624120010:70-136` | ✅ **機械驗過**:`{ printf '\n'; sed -n '71,135p' <檔>; }` 的 md5 = `fa8afcc2bf0f3c683e156a719fea80f0` = 正式庫 `prosrc`,字元數 **2891** 逐字相符 |
| **COMMENT** | 🔴 **`20260804120000:215`**(不是 20260624120010) | 正式庫 COMMENT 內含「E10-A8c1(2026-08-04)起 begin 持 orders 先鎖」= A8c1 世代字面 |

**為什麼重要**:這與沖銷片被 codex 抓到的 **RB-1 同族**(那次正是把 COMMENT 從錯的世代還原)。本次在實作前抓到。
⚠️ **量的是字元不是位元組**:`length(prosrc)` 數**字元**、`wc -c` 數**位元組**,CJK 一字 3 bytes ⇒ 第一次比對 3364 vs 2891 看似差很多,實際只差一個多餘的尾隨換行。**用 `wc -m` 比。**

### 6-2 腳本形狀

`scripts/l5b2-2e-rollback.sql`:
```
BEGIN;
  SET LOCAL lock_timeout/statement_timeout/transaction_timeout    照 20260811110000:67-69 逐字
  DO 閘①:2g writer 在庫 ⇒ RAISE(成組回退,母 plan :718)
  DO 閘②:現況 prosrc md5 必須 = 2e 的 post-image ⇒ 否則 RAISE(不對著陌生版本回退)
  CREATE OR REPLACE FUNCTION …  還原本體(來源 20260624120010:70-136)
  COMMENT ON FUNCTION …          還原 COMMENT(來源 🔴 20260804120000:215)
  DO 後置:md5(prosrc) = fa8afcc2…、proconfig 回 search_path="" 單一項、prosecdef/proacl/owner、COMMENT 逐字
COMMIT;
```
🔴 **「禁止只抄座標逐句手跑」這句要寫進腳本檔頭本身**,不是只寫在 plan(母 plan `:726`)。
⚠️ 閘① 是**成組回退閘**,2a 的 rollback 骨架**沒有這道**(母 plan §2a-X 第 6 條:「不會自己長出來」)。

🔴 **閘① 的判準射程(R1 must-fix 1;v2 的窄版有假陰性**與**假陽性,實測消融見下)**:
判準 = `prokind IN ('f','p')` 且 `prosrc ~* '(INSERT|MERGE)[[:space:]]+INTO[[:space:]]+(public\.)?payment_refunds\y'`。

| 假 writer 形狀 | v2 窄判準 | v3 放寬後 |
|---|---|---|
| FUNCTION + `public.payment_refunds` | ✅ 擋 | ✅ 擋 |
| **PROCEDURE** | ❌ **靜默放行** | ✅ 擋 |
| **未 schema-qualified** | ❌ **靜默放行** | ✅ 擋 |
| **`MERGE INTO`** | ❌ **靜默放行** | ✅ 擋 |
| `payment_refunds_archive`(不相干的表) | ❌ **誤擋**(前綴命中) | ✅ 正確排除(靠 `\y`) |

實測(PG17.10,五支假函式):v2 命中 `[ab_arch, ab_f]`、v3 命中 `[ab_f, ab_m, ab_p, ab_u]`、v3 拿掉 `\y` 命中 `[ab_arch, ab_f, ab_m, ab_p, ab_u]` ⇒ **`\y` 是承重的**。
🔴 **誤擋那半 R1 沒點出來,是本輪做消融時量到的** —— 它比漏擋更難發現,因為症狀是「回退永遠跑不動」而不是「回退跑過頭」。
前四格由 harness `rb` 模式的 RB2/RB4/RB5/RB6 釘住(見 §8)。
❌ **仍不涵蓋**:只做 `UPDATE payment_refunds` 而不新增列的函式(2g 是**新增**補償退款 ⇒ 不納入;納入會讓一般維護函式把回退卡死)、動態 SQL、trigger 以外路徑、owner 直接 DML、其他 schema。⇒ 降低機率,**不是不變量**;fail-closed 方向(誤擋只要求人工判斷,不會放行)。
⚠️ 後置要驗 `proconfig` **回到只剩 `search_path=""` 一項**(本片加的 `lock_timeout` 必須跟著消失)—— 少了這道,回退後會留一個「本體是舊的、GUC 是新的」的混種。

---

## §7 前置/後置斷言清單(migration 內)

① pre-image `md5(prosrc)` 相符 ② 隔離閘(本函式所屬 schema 物件未被他片同時改)③ 沖銷片的 canonical view 在庫且**本片引用得到**(缺它則否決條件恆假=無聲失效)④ 2d 的 `result_confirmed` 值域仍在 ⑤ post-image:`proacl` 正負向、owner、`proconfig`(**逐 GUC 兩格**)、`prosecdef` ⑥ post-image `prosrc` 含 advisory 鍵式子的**逐字子字串** ⑦ 順序錨(見下)。

🆕 **⑨ canonical view 不只「在庫」還要「讀得到」(R1 must-fix 2)**:`payment_refunds` / `payment_refund_events` 已 ENABLE RLS 且**零 policy**(`20260810140000:150`)。任一被開 **FORCE ROW LEVEL SECURITY** ⇒ 連 owner 都被自己的 RLS 擋死 ⇒ 否決那道 SELECT 回 0 列 = **P2E01 恆假、無聲失效**(不是報錯)。
⇒ 前置閘加一格 `relforcerowsecurity` 斷言(形制照先例 `20260803130000:292-299`,repo 已有五處、此片原本獨缺),harness 對應格 = A12。
射程:只擋 FORCE 這個**靜默**模式;owner 換人導致無 SELECT 權是 fail-loud(會報錯),不需要這道。

🆕 **⑩ COMMENT 的呼叫端前提句(R1 must-fix 4)**:§4 的死結不變量**唯一**的防線就是 COMMENT 那一句,而 `COMMENT ON FUNCTION` 是任何後續片都能整支覆寫的,覆寫掉**完全無聲**(`prosrc` 不變 ⇒ md5 那格照樣綠)。⇒ 後置加一格 `strpos(obj_description(…), '勿在已動過該訂單相關列的交易內呼叫') > 0`。

🆕 **⑧ apply 時點觀察(nit N3)**:輸出「現存 `payment_refunds` 中**無有效終局**的父列數」。
**預期 0**;**>0 代表 apply 之後那些 attempt 會被 P2E01 擋住人工結案** ⇒ 這個數字要進 apply 檢查表給 Sean 看,不能等他撞到才知道。

**順序錨(母 plan `:295-318` 的修正版)**:
- 🔴 **先剝註解再比位置**:`regexp_replace(prosrc,'--[^'||chr(10)||']*','','g')`,理由=recon §3 實測(② 的 `FOR UPDATE` 只存在於註解;③ 目前量對**純屬運氣**,那句註解往上搬幾行就開始量註解)。
- 🔴 **③ 找 `FOR UPDATE`、② 找 `FOR NO KEY UPDATE`**,兩支**不共用字串**。
- 🔴 **它只是廉價前哨,不是判別力來源**。真判別力在 §8 靶 M5 的消融。**只做 strpos = 拿一條會量錯的東西當保證。**

---

## §8 測試設計與突變靶(`scripts/l5b2-2e-verify.sh`;每條守門配自己的靶,紅格由**實跑**決定不由預測)

| 靶 | 突變 | 必紅的格(預期) |
|---|---|---|
| **M1** | `CREATE OR REPLACE` 拿掉 `SET search_path = ''` | `proconfig` 的 **search_path 那一格** |
| **M1b** | 拿掉 `SECURITY DEFINER` | `prosecdef` 那格(P1 實測它會變 false) |
| **M2** | 步 A 的 NOT FOUND `RAISE` 拿掉 | 「不存在的 attempt 必須 RAISE 而非**無鎖**繼續前進」那格(P4 已證無鎖前進是真的會發生) |
| **M3** | 拿掉 `SET lock_timeout = '3s'` 子句 | `proconfig` 的 **lock_timeout 那一格** + 行為格 L1。🔴 **L1 那格的 harness 必須自帶外層 timeout**(nit N1):postgres 角色無限等 ⇒ 突變後的症狀是 **hang 不是紅**,沒有外層 timeout 會變成 harness 自己掛住 |
| **M4** | 加一支會 `UPDATE payment_charge_attempts.order_id` 的路徑 | 文字掃描那格(母 plan `:855-856` 指定)。⚠️ **v2 起它是早期預警、不是唯一防線**(見 M4b) |
| **M4b** | 拿掉步 C 的 `IS DISTINCT FROM` 復核 | 「order_id 在 A→3 之間被改 ⇒ 必須 P2E02」那格。fixture 直接 `UPDATE` 該欄製造分歧(harness 內合法) |
| **M5** | 把 B(取 advisory)移到步 3 `FOR UPDATE` 之後 | 🔴 **必須構造得出 40P01**;構造不出 = 本格無判別力,**不得宣稱死結已解**(母 plan `:853-854`)。**對手構造法見 §4 的 S1/S2**(nit N2:寫進 plan,防「構造不出」假宣稱)。🔴 **宣稱射程**=「在 §4 前提成立之下」,不是全稱 |
| **M6** | 否決條件的 `NOT EXISTS(canonical view)` 改成恆假 | 「掛著未結案退款的 attempt 必須被 P2E01 擋下」那格 |
| **M7** | 把否決條件**移到步 5 冪等分支之前** | 「已結案 + 有未結案退款 ⇒ 仍回 `idempotent:true`」那格(§3-2 的語意保護) |
| **M8** | 順序錨改成**不剝註解** | recon §3 的形狀;本靶驗的是**守門自己**不是函式 |
| 🆕 **M9** | 拿掉既有的 order-paid guard(步 7) | 「該單有 `status='processing'` 的 `order_refunds` 列 ⇒ close 必被擋」那格(MF2:補上 v1 承諾了卻不存在的觀察格)。⚠️ 它驗的是**我拿來當論證的既有守門**,不是我新增的守門 |
| 🆕 **M10** | `payment_refunds` 開 **FORCE ROW LEVEL SECURITY** | R1 must-fix 2 對應靶:A12(病因格)。⚠️ **行為格不會紅** —— 本機 owner 是 superuser+bypassrls,災難構造不出來(§9-3b) |
| 🆕 **M11** | per-order 鎖 index 的 predicate 拿掉 `released` | A13。本靶來自**駁回** R2 的一條 nit(見 §13):與其只說「你讀到舊定義」,不如把現況從 catalog 釘住 |

🆕 **突變輪本身進了交付物(R2 important 5)**:`scripts/l5b2-2e-verify.sh mut <workdir>` —— **12 靶、每靶一個乾淨叢集、跑前先驗「突變真的落地」**(CHECK 不過=本靶無結論、不讀紅格)。v3 的 driver 寫在 `/tmp`,那張表只能靠我口頭回報。

🆕 **回退不再只靠一次性手跑(R1 important 5)**:harness 增 `rb` 模式 10 格 —— 四種假 2g writer(FUNCTION / PROCEDURE / 未 qualified / MERGE)各自被閘①擋、擋下時**尚未還原任何東西**、拆掉後回退成功、`md5`+`proconfig`+COMMENT 世代三驗、最後重新 apply 回 post-image。⇒ §6 那張射程表的前四列**由 RB2/RB4/RB5/RB6 逐格釘住**,不是宣稱。

🔴 **`proconfig` 的兩個 GUC 必須是兩格獨立斷言**,不可合成一格 —— 否則 M1 與 M3 會紅在同一格、彼此的判別力互相遮蔽(同族=memory `feedback_negative-test-observation-supplied-by-another-mechanism`)。

**併發格**(真並發,advisory barrier 形制沿用 `scripts/w6a-unvoid-race.sh:257-284`)。
⚠️ **本表的代號 = harness 實際格名**(R2 nit 14:v3 這裡的 L2/L3 與 harness 對不上,追溯表形同虛設):

| plan | harness 格 | 內容 |
|---|---|---|
| L1 | `L1a/L1b/L1c` | 對手持 advisory → close 於 ~3s 回 **55P03**(不是無限等)。✅ 端到端驗過(P6:準 3 秒;消融 6 秒回 GOT) |
| L2 | `L2a/L2b` | order_id 在無鎖預讀與鎖下重讀之間被改 ⇒ **P2E02** fail-closed(TOCTOU) |
| L3 | `L3a/L3b` | 兩條同時對同一 attempt close ⇒ **恰一條** `idempotent:false`,另一條 `true` 或 55P03,**不得兩條都寫成功** |
| 正向對照 | `B1` / `C2` / `C5` / `C6` | 沒有未結案退款(或退款已達有效終局)的 released attempt ⇒ close **必須成功**。防「把什麼都擋掉」拿高分 |
| L4 | `L4` | §4 前提**被違反**時真的會爆(40P01)⇒ COMMENT 那句警告不是空話 |
| 🆕 L5 | `L5a/L5b` | **鎖序本身的判別力**(R2 MF4):對手持 advisory 後才要 attempt 列鎖 ⇒ 基線 close 手上無列鎖、**不成環**(只有 55P03);M5 下 close 先抓列鎖再等 advisory ⇒ **40P01**。**紅綠只由取鎖順序決定** |

**零留痕**:harness 每輪自檢(沖銷片 §F 形制)—— `psql -c` 成功即 autocommit,少了這道會出現「20/20 綠但 14 列真的寫進去了」。

---

## §9 誠實邊界(沒有機制的不宣稱擋住)

1. §3-2「只查 `payment_refunds` 一本帳」是**經裁定的可接受邊界**(加查=改述詞、觸母 plan `:268`)。`order_refunds` 那半靠的是**既有 order-paid guard**。
   🔴 **v4 把這條的實況量清楚了(R2 codex must-fix 3)**,分三段,別再混講:
   - (i) **論證其實有 DB 層依據,比 v3 寫的強**:a7c 的 `INSERT guard`(`P7C02` / `a7c_insert_order_payment_not_captured`)在**登記退款當下**就要求 `orders.payment_status ∈ {paid, partiallyRefunded, refunded}` ⇒ 「有退款 ⇒ 該單曾經 paid」不只是業務推論。**harness D2a 實測**。
   - (ii) 🔴 **但缺口真實存在,而且我實跑確認過**:先 paid → 登記 `processing` 的 `order_refunds` → **再把 `orders` 改回 unpaid**,此時呼叫 close **回 `{"closed": true}`、完全沒被擋**(harness **D2b** 把這個行為釘住)。本片的否決只查 `payment_refunds`(attempt 尺度),在途的 `order_refunds` 沒有任何一道擋它。
   - (iii) **v3 的靶 M9 / 格 D1 名不副實**:它們的 SQL **從來沒有建立或檢查任何 `order_refunds` 列**,只把 `orders` 改成 paid ⇒ 量的是 order-paid guard 本身,不是 order_refunds 連動。v4 已改名,並補上 D2a/D2b 兩格量真的東西。
   ✅ **已裁(2026-08-12,Sean:`Q-2e-D2b=A`)**:**2e 照現況收,(ii) 的缺口另片補** —— backlog **#440** 已由主視窗立案進 `dev`(`29a3ac98`),內含 D2b 的契約(**這格變紅=有人補好了,請改本節、不要改期望值**)與「改述詞需自己一輪」的理由。
   ⇒ 本片**明列 (ii) 為已知缺口**、不在本片修;`order_refunds` 那半的否決歸 #440。
2. §3-1 的無鎖讀正當性=**時點觀察**(母 plan `:264-266`)。v2 之後**多了一道函式內 fail-closed**(步 C / P2E02),但它只擋「A→3 之間改變」這個窗口;**A 之前就已經是錯的值**仍然擋不住(那要 schema 層不變量才行,本片不做)。
3. `lock_timeout = 3s` **沒有量測依據**(§3-3),只有「比無限等好」這個相對論證。射程與效力已實測,**值本身沒有**。

3b. 🔴 **前置閘那道 FORCE RLS 斷言目前沒有行為層證據**(R2 important 1):superuser / `BYPASSRLS` **永遠**繞過 RLS,而本機拋棄式叢集的 `postgres` 正是兩者皆是(實測:FORCE 開/關,owner 都讀得到列)⇒ 靶 M10 只紅 A12(結構格),C1/C3 不紅。**它是結構型早期預警,不是被行為證明過的防線**;正式庫 `postgres` 的 `rolsuper`/`rolbypassrls` 由 apply preflight 查(主視窗 `P-570-A` §1 已裁)。

3c. 🔴 **步 A 的 NOT FOUND RAISE 在安全性上不是承重的**(R2 important 4 校正 v3 的誇大字面):實測 M2b —— 拿掉它之後 `v_order_id_pre` 為 NULL 一路走到步 C,`<uuid> IS DISTINCT FROM NULL` = TRUE ⇒ **被步 C 的 P2E02 嚴格攔住**(靶 M2 也只紅 md5 那格)。它剩下的價值=清楚的錯誤訊息 + 不做一次無意義的 NULL 鍵 advisory 呼叫。**承重的是步 C。**
4. 🔴 §4 的不變量**帶前提**,而 **v3 的前提寫得太窄、被 R2 codex must-fix 1 擊破**:
   舊寫法「呼叫端交易在呼叫前沒有持有**該訂單相關列鎖**」放行了這個反例 —— A 呼完 close(已持 advisory,交易未結束)接著等第三資源 R;B 持 R 再呼同單 close ⇒ 成環,而 **B 從沒碰過該訂單任何列**。
   根因:`pg_advisory_xact_lock` 持有到**整個交易結束**,不是函式返回。
   ✅ 正確前提:**本函式只能在單語句交易內呼叫**(呼叫端交易在本呼叫之外不得持有、也不得後續等待任何可爭用資源)。
   🔴 而且比 v3 說的更弱:全 repo grep,`close_released_attempt` **沒有任何應用層 caller**(只有 `database.types.ts` 的產生型別)⇒ 「正式路徑是單語句 RPC」**不是既成事實,是對未來 caller 的要求**。前提**完全沒有機制守**,只有 COMMENT 一句話。**不得把本片寫成「消滅了死結」。**
   ⚠️ 違反前提時吐的 SQLSTATE **是環境相依的**(R2 important 6):本機 `deadlock_timeout=1s < lock_timeout=3s` ⇒ 40P01;正式庫該值**未量**,若 ≥3s 會先得 **55P03**。安全方向相同、**診斷字面不同**,別把 40P01 寫進 runbook 當判斷依據。
5. 本片**不改善**既有的 `begin` × close 阻塞(§4 末),也**不宣稱**消滅它。
6. 三方鍵式子的一致性,本片**只能單邊釘住**(§3-1);真正的跨函式比對要等 2f/2g。
7. 母 plan `:341` 的「TapPay 伺服器端原子拒絕」是 **sandbox 實測**,不等於正式環境 —— 本片不依賴它,但它是超退的最後防線,**射程照抄不打折**。

---

## §10 決策題

**零題。** v1 的三題已由主視窗 `P-561-A` 全裁:
Q-2e-1 發號=**`20260812160000`** / Q-2e-2=**A 照做**(`:576` 已授權;`:268` 不觸發——加否決非改述詞語意;知會 Sean 由主視窗做)/ Q-2e-3=**照實改**(揭露文字已改寫進 §1-2)。

---

## §11 v1 → v2 逐條折疊對照

### 關卡1 Fable 替身(`P-564-A`,3 must-fix + 4 nit)

| # | findings | 折法 | 落在哪 |
|---|---|---|---|
| **MF1** | §4 全稱句漏「呼叫端交易先前不持鎖」前提;可構造 S1/S2 環 | **認,全稱句作廢** ⇒ 改成帶前提版 + COMMENT 寫警告 + M5 宣稱射程收斂 + 新增靶 L4 示範前提被違反時真的爆 | §4 全節重寫、§8 M5/L4、§9-4 |
| **MF2** | §3-2 引用了不存在的觀察格(M6 是另一半) | **認**,取「真補一格」而非降級 | §3-2、§8 靶 **M9**、§9-1 |
| **MF3** | order_id 復核:步 3 本來就重讀,加 `IS DISTINCT FROM` fail-closed | **認**,且比 v1 的「押在 M4 文字掃描」明顯好。無否決理由 | §2 步 C、§3-1、§8 **M4b**、§9-2 |
| N1 | M3 突變的症狀是 hang 不是紅 | 認 | §8 M3(harness 自帶外層 timeout) |
| N2 | 40P01 對手構造法寫進 plan | 認 | §4 的 S1/S2 程式碼區塊、§8 M5 |
| N3 | apply 時點觀察「無有效終局列數」 | 認 | §7 ⑧ |
| N4 | §1-3 標註來源片別(`:357` 指派給 2f) | 認 | §1-3 檔頭註記 |

### 我自己抓的(`P-562-NOTE` 六條實測 + 本輪回退來源查核)

| # | 自錯 | 折法 |
|---|---|---|
| **A1** | §3-3「body 內 `SET LOCAL` 函式返回即還原」= 錯(P2 推翻) | 改放函式層 SET 子句(P5 射程正確 / P6 效力 3s 55P03 / 消融 6s) ⇒ §3-3 全節改寫、§2 刪步 A |
| **A2** | §5 的 `prosecdef` 原為推論 | 升級為 **P1 實測值**;新增靶 M1b |
| **A3** | §8 原本 M1/M3 會紅在同一格 | `proconfig` **逐 GUC 兩格**斷言 |
| **A4** | §3-1 的 fail-closed RAISE 原寫成「防禦性」 | P4 實證為**必要**(NULL 鍵靜默 0 鎖前進) |
| **A5** | §6 回退來源寫成單一檔 | 🔴 **本體 `20260624120010:70-136`(md5 機械驗過)/ COMMENT `20260804120000:215`** 兩個不同來源;RB-1 同族 |

---

## §12 v2 → v3 折疊:code-reviewer R1(`P-568-A`,2 must-fix + 3 important + 6 nit)

R1 = **FAIL**。逐條折疊如下,無「已知但不修」項。

| # | 級別 | findings | 折法 | 落點 |
|---|---|---|---|---|
| 1 | must-fix | 回退閘① 只掃 `prokind='f'` + 逐字 `public.payment_refunds` ⇒ PROCEDURE / 未 qualified / MERGE **靜默放行** | 判準放寬成 `prokind IN ('f','p')` + `(INSERT\|MERGE) INTO (public.)?payment_refunds\y`;**四種形狀各配一格實跑**;誠實射程逐條重寫。🔴 **消融時另外量到 v2 還有假陽性**(`payment_refunds_archive` 前綴命中 ⇒ 回退會永遠卡死),用 `\y` 修掉 | rollback 閘①、§6 射程表、harness `rb` RB2/RB4/RB5/RB6 |
| 2 | must-fix | 前置閘只驗 canonical view **存在**、沒驗**讀得到**;FORCE RLS ⇒ SECDEF 被自己擋死 ⇒ 否決恆假無聲 | 前置閘加 `relforcerowsecurity` 斷言(照先例 `20260803130000:292-299`);harness 加 A12;**加靶 M10 行使它** | migration ①、§7 ⑨、harness A12 |
| 3 | important | 「`begin` 不參與 advisory」= 字面錯(`20260804120000:126` 有 per-user advisory,且鎖序與本片相反) | 改寫成**正確理由**:兩把鍵不同=不同鎖物件;plan 與 migration 檔頭都改;附 64-bit 碰撞的誠實射程 | §4 末、migration 檔頭 |
| 4 | important | COMMENT 是 §4 前提的唯一防線,卻零斷言;被覆寫完全無聲 | 後置加 ④-9:COMMENT 必含「勿在已動過該訂單相關列的交易內呼叫」 | migration ④-9、§7 ⑩ |
| 5 | important | rollback 從未被 harness 執行 ⇒「雙向驗過」不可重現 | 新增 `rb` 模式 **10 格** | harness `rb`、§8 |
| 6 | nit | B4/B5/B6/D1 的 code 傳 `"ERROR"` = 對任何錯誤恆真 | 檔頭就地註明不一致 + 為何不補(打的是既有本體的無 ERRCODE RAISE) | harness 檔頭紀律段 |
| 7 | nit | L2 漂移注入依賴 holder2 的 1.5s 窗、`wait_blocked` 最長 4s ⇒ 編排慢時假紅 | 改**受控解鎖**(holder 抱住不放 → 確認卡上 → 注入 → `pg_terminate_backend`);`wait_blocked` 預算收成 2s;55P03 單獨分流成「編排太慢、本格無結論」 | harness L2 |
| 8 | nit | `sqlx()` 缺 `-X` | 補上 | harness |
| 9 | nit | A11 誠實射程未列 `ON CONFLICT DO UPDATE SET order_id` 與 `MERGE` | 射程逐條重寫(五項不涵蓋);另**加 `\y`**(同 #1 的前綴風險,實測名單仍 15 支) | harness A11 |
| 10 | nit | 「逐角色各報」vs 實際第一命中即 abort | 就地校正字面,並說明為何不改成收集後一次報 | migration ④-2 |
| 11 | nit | 正向對照只有 `result_confirmed`,`result_failed` 那半終局零觀察 | 新增 C6:終局=`result_failed`(`indicates_refund=false`)⇒ 仍放行 | harness C6 |

🆕 **順手補的一道(不在 findings 內)**:harness 加「乾淨叢集閘」。同叢集重跑時前一輪造的退款會讓 B1/B2/B3/C2 紅在「尚有未結案退款」—— 那是**否決條件正確發火**,但看起來跟守門壞掉一模一樣(本輪真的花時間辨認過一次)。⇒ fail-fast 停下並講白,不讓人去讀四行像 bug 的訊息。

**格數**:`run` 36 → **38**(+A12 +C6);`rb` 新增 **10**。
**突變輪**:因格數改變,**十一靶全部重跑**(不是把舊表的 PASS 欄改成 38 減一減 —— 那是預測不是實測)。

---

## §13 v3 → v4 折疊:codex R2 兼關卡2(4 must-fix + 6 important + 5 nit)

R2 由 **codex** 跑(code-reviewer subagent 撞帳號週限額、零產出 ⇒ 換模型,同時滿足鐵則 12 關卡2,一條線不開兩條)。verdict=**FAIL**。
**14 條折、1 條實查後不折**(下方單列)。

| # | 級別 | finding | 折法 | 落點 |
|---|---|---|---|---|
| 1 | MF | 呼叫端前提太窄:第三資源 R 就能成環,B 沒碰該訂單任何列 | 前提改寫成「**只能在單語句交易內呼叫**」;附「advisory 持有到交易結束」的根因;附「**全 repo 無應用層 caller**」⇒ 前提是對未來 caller 的要求 | migration 檔頭 + COMMENT + §4 + §9-4 |
| 2 | MF | 閘① 仍有假陰性(`ONLY`/quoted/點號空白) | 正規式吸收 `ONLY`+可選引號+點號空白;**加顯式函式名單**(2g 前置義務)= 唯一不是啟發式的那半;`\y` 換成顯式字元類(加引號後 `\y` 會失效) | rollback 閘① + §6 + rb RB6b/RB6c |
| 3 | MF | D1 名不副實:宣稱驗 order_refunds,SQL 只改 orders | D1 改名;**新增 D2a**(P7C02 在登記時就擋)+ **D2b**(缺口實測:改回 unpaid 後 close 真的成功) | harness D1/D2a/D2b + §9-1 |
| 4 | MF | M5 規格要求構造出 40P01,實際沒有任何格觀察到環 | **新增 L5**:對手持 advisory 再要列鎖 ⇒ 基線 55P03(不成環)、M5 下 40P01 ⇒ 紅綠**只由取鎖順序決定** | harness L5a/L5b + §8 |
| 5 | IMP | FORCE RLS 斷言仍寫成「連 owner 都被擋」 | 補「owner 非 superuser 且無 BYPASSRLS」前提 + 本機實測反證 | migration 前置閘 + §9-3b |
| 6 | IMP | L3b 只數 false=1,另一條爆掉也綠 | 加驗另一條 ∈ {true, 55P03} | harness L3b |
| 7 | IMP | A11 射程寫錯(`[public.]` 暗示可選、trigger 函式其實有涵蓋) | 逐條重寫;明列 regex **強制** `public.`、trigger 函式**在**射程內 | harness A11 |
| 8 | IMP | 步 A RAISE 仍被說成安全必要 | 改成「被步 C 嚴格蘊含,承重的是步 C」 | migration 步 A + §9-3c |
| 9 | IMP | 突變輪 driver 不在交付物裡 ⇒ 表不可重現 | **新增 `mut` 模式**(12 靶、每靶乾淨叢集、先驗突變落地) | harness `mut` |
| 10 | IMP | 40P01 是本機 deadlock_timeout 的產物 | 標成環境相依,正式值未量;55P03 也可能 | migration 檔頭 + §9-4 |
| 11 | nit | 閘① 掃 raw prosrc,註解裡的字樣會誤擋 | 先剝 `--` 註解再比 | rollback 閘① |
| 12 | nit | 寫「十一靶」實為十二靶 | 改正(v4 起為 **12 靶**) | §8 / harness 檔頭 |
| 13 | nit | 檔頭稱 v2、§12 稱 v3 | 版本字面折齊為 **v4**,migration 引用同步 | 檔頭 + migration :4 |
| 14 | nit | plan 的 L2/L3 命名與 harness 實際格名漂移 | 追溯表照 harness 實際格名重寫 | §8 併發格段 |

### 🔴 不折的一條(附證據)

**nit「migration:261 註解說 released→failed 才離開 per-order partial index,但 predicate 只含 pending/charged」= 實查後判定 finding 本身有誤。**
`payment_charge_attempts_order_lock_idx` 在 `20260612150000:102-103` 的**初版** predicate 確實是 `('pending','charged')`,但它在 **`20260624120000:62-64` 被重新定義**成 `('pending','charged','released')`;catalog 親驗現況 `pg_get_expr(indpred)` = `(status = ANY (ARRAY['pending','charged','released']))`。
⇒ 註解正確,codex 讀到的是**被取代的舊定義**(同族=memory `reference_count-objects-from-catalog-not-create-statements`:數 CREATE 敘述 ≠ 現況)。
**但我沒有只是駁回**:新增 harness **A13** 從 catalog 釘住「predicate 仍含 `released`」+ 靶 **M11**(把 released 從 predicate 拿掉)⇒ 將來有人改 predicate,那句註解不會靜靜變成假話。

### 我自己在這輪抓到、codex 也沒說的兩件

- **codex MF2 舉的第一個例子造不出來**:`INSERT INTO ONLY <表>` 在 PostgreSQL **不是合法語法**(吃 `ONLY` 的是 UPDATE/DELETE/SELECT/MERGE)—— 實測 `syntax error at or near "ONLY"`。底層顧慮仍成立(MERGE 吃 ONLY)⇒ RB6b 改打 `MERGE INTO ONLY`。
- **harness 需要「乾淨叢集閘」**(v3 已補)與 **`mut` 的產物不能放 workdir**(teardown 會整個砍掉,第一輪之後報表就消失 —— 本輪實際踩到)。

---

— P 九代,2026-08-12;母 plan v8 / recon 2026-08-12 / 沖銷片 `20260812140000`(已 apply)/ 關卡1 `P-564-A` / 實測 `P-562-NOTE` / code-reviewer R1 `P-568-A` / codex R2 兼關卡2
