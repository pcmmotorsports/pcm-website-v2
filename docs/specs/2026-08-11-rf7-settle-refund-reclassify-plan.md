# RF7 片級 plan **v2** — settle-charge 退款態重分類(`record_status ∈ {2,3}` 假告警)

> E 窗六代 / 2026-08-11 夜。派工 = `E-311-A`。樹 = `c1b65d99`。
> 🔴 **狀態:兩輪關卡 1 都 FAIL,本 plan 目前「不可批准實作」——**
> **而且 R2 打出來的是方向問題,不是折 finding 能解的**(見 §13)。**不實作。**
> 鐵則 12① 錢 = 命中;R1 = 13 must-fix、R2 = 10 must-fix + 1 nit(每輪都抓到真東西、非重複)。
> **v1 → v2 的來由:關卡 1 codex `FAIL`,13 must-fix。** 我逐條親驗後 **12 條成立、1 條關卡 1 自己講錯**
> (逐條對帳見 §11)。v2 不是補丁,是**核心策略被打掉重寫** ——
> v1 說「認任一本帳有**非 failed** 的紀錄、**零 migration 直讀**」,三個字都錯:
> **鍵錯**(該用 `recTradeId` 不是 `orderId`)、**狀態語意錯**(`deferred` 是「確定沒退」)、
> **直讀在正式庫根本沒權限**。
> 上游:PRD `docs/specs/2026-07-24-refund-automation-line-prd.md` RF7 段 `:79` + §3-1 `:64`。
> 邊界:P 窗地盤(`supabase/migrations/`、`scripts/l5b2-*`、`scripts/w7-coverage.sh`、`scripts/a7t-verify.sh`)**全程唯讀**。

---

## §0 一句話

**RF7 沒辦法只在應用層做完。** 要對帳就得讀退款帳本,而**正式庫裡 `payment_refunds` 只有 owner 有 SELECT**
(數法 = §2.1 那支 `aclexplode` 查詢,母體 = 三張退款表的 `relacl`;結果表也在 §2.1)
⇒ 任何讀它的做法都要動 P 的地盤(GRANT 或 RPC)。
⇒ 本 plan 的產出不是「怎麼改那一行」,而是**三個要 Sean 拍的範圍題**(§10),每個選項都走到終態、附代價。

---

## §1 現況(當場實查,附座標)

### 1.1 假告警的產生路徑

| 跳 | 座標 | 事實 |
|---|---|---|
| 分類 | `packages/use-cases/src/settle-charge.ts:409-411` | `case 2: case 3: return { kind: 'refund_anomaly' }` |
| 消費 | 同檔 `:181-188` | `console.error(...)` → `return { kind:'pending', reason:'record_unverified' }` |
| 自陳 | 同檔 `:291` | 註解逐字「2/3 **仍**走 `refund_anomaly` → pending + 告警」 |
| 帳本零耦合 | `grep -c order_refunds packages/use-cases/src/settle-charge.ts` = **0** | 整支檔不認識任何退款帳本 |

### 1.2 caller 盤點

數法(**數語法位置、不數關鍵字**;數關鍵字會得到三位數、幾乎全是註解):
```bash
grep -rnE "(await |=> )settleCharge\(" apps packages --include='*.ts' --include='*.tsx' | grep -v '\.test\.' | wc -l
# = 10 個語法呼叫點
```
10 個呼叫點 = **8 條消費路**:callback(`callback/page.tsx:125`)/ webhook(`tappay-notify/[secret]/route.ts:191`)/
sweeper(`sweep-settlements.ts:173,211`)/ 輪詢(`payment-status/route.ts:143`)/ 黑洞反查(`reconcile-actions.ts:101`)/
重刷裁決(`charge-actions.ts:391,538`)/ B1b 孤兒再確認(`reconfirm-expired-orphans.ts:96`)/
**preflight 兄弟單裁決**(`composition.ts:165` 注入 → `preflight-release-sibling.ts:91`)。

🔴 **v1 寫「7 路」漏掉第 8 條,是關卡 1 用它自己的 `rg` 打出來的。** 第 8 條特別重要,見 §5。
⚠️ **實作位置統一**:`classifyRecordStatus` 是**檔案私有函式**、只有 `settleCharge` 內部消費
(這面關卡 1 確認沒打穿)⇒ 本片改的是**消費端 `:181-188`**,不是分類函式。v1 兩處字面互撞,v2 以本句為準。

### 1.3 對 PRD 兩處字面的更正

| PRD 字面 | 實查 | 差在哪 |
|---|---|---|
| 「`settle-charge.ts:124-132`」 | 實際 **`:409-411` + `:181-188`** | 檔案演進;PRD `:64` 自己標過「行號 07-25 複核」 |
| 「**永久**假告警、**不收斂**」 | sweeper 路徑**會收斂**:pending → `markSettleRetry` → 退避封頂 16min → ceiling(>=8)→ `needs_manual_review=true`(`20260615120001:24,75`);claim RPC 濾 `needs_manual_review=false`(同檔 `:16`) | **不是無限重試,是「8 次假告警 + 掉進人工待審佇列」**;對員工未必比較好 |

---

## §2 三個把 v1 打死的事實(正式庫實查,`bmpnplmnldofgaohnaok`,2026-08-11 20:3x)

### 2.1 🔴 權限:`payment_refunds` **除 owner 外沒有任何 SELECT**

```sql
select c.relname, a.grantee::regrole::text, a.privilege_type
from pg_class c left join lateral aclexplode(c.relacl) a on true
where c.relname in ('order_refunds','payment_refunds','payment_refund_events')
  and a.privilege_type='SELECT';
```
| 表 | 有 SELECT 的角色 |
|---|---|
| `order_refunds` | `postgres`、**`service_role`** |
| `payment_refunds` | **只有 `postgres`** |
| `payment_refund_events` | **只有 `postgres`** |

⇒ **v1 的「零 migration 直讀兩本帳」在正式庫必然每次 throw**(依據 = 上表;母體 = 上面那支查詢的全部回列,
未查 `information_schema.role_table_grants` 交叉對照 ⇒ 若有繼承自 `PUBLIC` 的授權本查詢看得到、欄級授權則看不到)。
要讀 `payment_refunds` 只有兩條路:**加 GRANT** 或 **加 SECURITY DEFINER RPC** —— 兩條都是 migration、都在 **P 的地盤**。

### 2.2 🔴 狀態語意:`order_refunds.status` 有第四個值 `deferred`,而它的意思是「**確定沒退成**」

- `order_refunds_status_check` = `status IN ('processing','confirmed','failed','deferred')`
  —— **建表時(`20260725130100:96`)只有前三個**,`deferred` 是後來加的。
- `deferred` 對應 TapPay `10024`(受理未生效)⇒ **錢還沒動**;
  另有 `order_refunds_deferred_clean` CHECK 釘住 `deferred ⇒ tappay_refund_id IS NULL`。
- ⇒ v1 的「**非 `failed`** = 有退款」會把 `deferred` 與 `processing` 當成退款證據
  —— **方向是把「沒退」講成「退了」**,正是 §5 最壞情況那一邊。
- ✅ 只有 **`confirmed`** 能當證據。

### 2.3 🔴 `payment_refunds` **沒有 status 欄**

同一支查詢對 `payment_refunds` 的 status CHECK = **零命中**;L5b 是**兩表版**,
結果在 `payment_refund_events`(`20260810140000:124`)。
⇒ v1 的「非 failed」這個述詞**在那本帳上根本寫不出來**,要走事件表的狀態機。

---

## §3 v2 的修法方向

**判準改成:`recTradeId` + 終態成功,而不是 `orderId` + 非 failed。**

1. **對帳鍵 = `recTradeId`**:同一張單可能有「上一次退款」的舊列,而本次 Record 變 2/3 可能來自**另一筆交易**
   ⇒ 用 `orderId` 查會把舊列當成本次的證據。Record API 回的 `rec_trade_id` 才指得到本次那筆。
2. **只認終態成功**:`order_refunds.status='confirmed'`;`payment_refunds` 走事件表的成功終態
   —— **具體事件值本 plan 刻意留白**(要讀 L5b 兩表版狀態機,而那份 plan 正在被 P 動,見 §9-3)。
3. **`2` 與 `3` 分開**:`3`(全退)⇒ 淨收 0;`2`(部分退)⇒ **仍有淨收金額**。
   共用一個「合法終態」會遺失差額 ⇒ outcome 至少要帶得出「全退 vs 部分退」。
4. **fail-closed 不變**:查不到帳 / 讀取 throw → **維持現況(告警 + pending)**,不得放行。

---

## §4 片界(依 §10 拍板結果而變;此為 Q1=B 且 Q3 有解的版本)

| 片 | 內容 | 獨立驗收 |
|---|---|---|
| **RF7-0** | (**只有 Q1=B 才需要**)`payment_refunds` 的唯讀取用面(GRANT 或 RPC) | 🔴 **不是 E 的片**,要排進 P 的線 |
| **RF7-a** | 新 port `IRefundLedgerReader`(鍵 = `recTradeId`)+ `order_refunds` adapter + 單元測 | 零行為變更;可單獨三綠 |
| **RF7-b** | `SettleChargeDeps` 加第四支 + composition 注入 | ⚠️ **v1 寫「既有測試一條都不改」不可達**:deps 加必填欄 ⇒ 既有測試 helper **必須補 stub**。驗收改成「**既有測試的斷言一條都不改、只補 stub**」 |
| **RF7-c** | 改 `:181-188` 消費端 + 正負測 | 這片才改行為;**必須含 preflight 行為測**(§5) |

⚠️ RF7-b 與 RF7-c **不得合併**:合併後「注入壞了」與「判定壞了」在測試上不可分辨。

## §5 爆炸半徑與 rollback

- **半徑**:`settleCharge` 是**八路共呼的對帳脊椎**。最壞情況 = **把「其實沒退款」誤判成合法終態** ⇒ 該收的錢不再被追。
  §2.2 的 `deferred` 就是這條路的活門 —— **v1 真的踩下去了**。
- 🔴 **第 8 條路(preflight)不是只讀**:`preflight-release-sibling.ts:91` 拿 outcome 決定
  **兄弟 attempt 要 release 還是 hold**(`:76` 逐字「`sibling.kind === 'active'`:交 settle 即時裁決」)。
  ⇒ 「2/3 改回什麼」**會影響會不會放行重刷**,理論上能開出重複付款的窗。
  **RF7-c 驗收必含:現行 2/3 → hold;修法後不得變成 release。**
- **rollback**:
  - Q2=A(仍回 pending)⇒ 純應用層、revert 即可。
  - 🔴 **Q2=B(寫 attempt 終態)⇒「revert 即可、無資料面殘留」不成立**:
    已寫成終態的 attempt / 已標 processed 的 inbox **不會因為 revert 回來**,要另寫回填。

## §6 與 P 的 L5b-2 線相容性

- 讀 `order_refunds` 與 P 無關(A7c 線的表、`service_role` 已有 SELECT)。
- 讀 `payment_refunds` **一定會碰到 P**(§2.1)⇒ 這是 Q1 的真實代價,**不是「只讀所以不衝突」**。
- **`110000` 現況**:`select version from supabase_migrations.schema_migrations order by version desc limit 1`
  = **`20260811100000`** ⇒ **`110000` 尚未 apply**;本片對它零依賴。
  (關卡 1 **R1** 說這句「過時」= 它講錯,見 §11 第 12 列。)
  🔴 **但 R2 從另一個角度打穿了「零依賴」**:若 Q1=B,`110000` 會把 L5b 事件的成功終態
  由 `result_success` 改成 `result_confirmed`(`docs/specs/2026-08-10-l5b-2-compensation-writer-plan.md:335,556`)
  ⇒ 我 §3-2 「事件值刻意留白」等於**把相依藏起來**,不是消除它。**兩句話都對、但我的結論錯**:
  「110000 尚未 apply」為真、「本片對它零依賴」為假(只在 Q1=A 分支為真)。

---

## §7 急迫性:量測 + **量測擋不住的那半**

正式庫唯讀查(2026-08-11 20:2x):`order_refunds` **0 列** / `payment_refunds` **0** / `payment_refund_events` **0** /
`payment_charge_attempts.needs_manual_review` **0** / `orders.payment_status IN ('refunded','partiallyRefunded')` **1**(2026-07-24)/
現在 sweeper 可領的 attempt **1**。

🔴 **但「0 列 ⇒ 第一筆真退款尚未發生」這個推論不成立**(關卡 1 打穿、我認):
兩本帳只記錄**我們自己的兩條寫入路**;**TapPay Portal 上手動退的錢不會在本地留任何列**,
而 PCM 有 Portal 操作的前例(PRD `:80` 的 0072/0073 雙扣收口)。
⇒ 正確講法:**「本地兩條退款路都沒被走過」是量到的;「TapPay 端有沒有退過款」本地量不到,標未確認**
(要打 Record API 才知道,本 plan 沒打)。

🔴 **觸發條件也比 v1 寫的寬**(我親驗):
v1 說要「TapPay 已退 ∩ 本地仍 `unpaid`」,但那只是 **sweeper** 那條路的前提
(claim RPC 濾 `orders.payment_status='unpaid'`,`20260615120001:16`)。
**webhook 與 callback 都沒有 unpaid 前置** ——
`tappay-notify/[secret]/route.ts:189-191` 只有 `if (inserted)`;`callback/page.tsx:125` 只有歸屬閘。
⇒ 一筆**已 refunded** 的單只要再收到一次 notify,照樣走進 2/3 假告警。

---

## §8 驗收條件(每條可 yes/no)

1. RF7-a:port 以 `recTradeId` 為鍵;單元測涵蓋 **`confirmed` / `deferred` / `processing` / `failed` / 無列 / throw 六格**,
   其中 **`deferred` 那格必須判成「不是退款證據」**。
2. RF7-b:既有 `settle-charge` 測試**斷言一條都不改**(只補 deps stub);typecheck 0。
3. RF7-c:正負測每格只紅它自己那條;消融 = 拿掉修法 → `confirmed` 那格必紅。
4. 「查無帳 / 讀取 throw → 仍告警 + pending」有專屬負測,拿掉 fail-closed 分支必紅。
5. **preflight 行為測**:2/3 且無退款證據 → 仍 hold(不得 release)。
6. 三綠 + 動 `.ts` ⇒ 加 build;鐵則 12① ⇒ commit 前跑關卡 2。

## §9 誠實邊界

1. **沒實作、沒動任何 code**(本 plan 是唯一產出)。
2. **沒打 Record API** ⇒ 「那 1 筆可領的 attempt 在 TapPay 端是什麼狀態」未確認。
3. **`payment_refunds` 的成功終態事件值我沒定** —— 要讀 L5b 兩表版狀態機才寫得出來,
   而那份 plan 正在被 P 動 ⇒ **刻意留白,不猜**。
4. §7 的數字是 20:2x 快照;`order_refunds` 一有第一列,§7 全段作廢。
5. **我沒有逐個 caller 驗「新 outcome 在它們各自語意下都安全」** —— 只驗到 preflight 那條;
   其餘七條要等 Q2 拍完才逐條走。這是本 plan 最大的未驗面。

## §10 要 Sean 拍的題(三題;每個選項都走到終態)

```
Q1(範圍):RF7 要不要涵蓋 L5b 那本帳?
A: A|B|C
  A = 只認 order_refunds。零跨窗依賴、E 自己就能做完;代價=L5b 上線後
      「補償退款」那條路照樣噴假告警,而且看起來像 RF7 沒做好
  B = 兩本都認。要 P 先出一支唯讀取用面（GRANT 或 RPC；§2.1 實測現在沒權限）
      = 多一個跨窗前置片、要排進 P 的線
  C = 先做 A，把 B 立成 backlog 並在 code 註解寫明失效條件
      （推薦：今天兩本帳都 0 列，B 的價值要等 L5b 真的上線才兌現）

Q2(語意):查到「本次 recTradeId 有 confirmed 退款」時，settleCharge 回什麼?
A: A|B
  A = 仍回 pending，只是不再 console.error 告警
      → 錢的路徑零變化；但 sweeper 對任何 pending 都會重試到 ceiling
        ⇒「已退款單掉進人工待審」這個真傷害沒解掉
  B = 回終態並收斂 attempt
      → 真的解掉；但要指定 attempt 寫成什麼狀態、inbox 標不標 processed，
        而且 rollback 不能只靠 revert（§5）

Q3(前置):Q1 若選 B，P 那支唯讀取用面誰做?
A: A|B
  A = 併進 P 的 L5b-2 線當一片（P 最熟那本帳的狀態機）
  B = E 出 plan、P 審過後由 P apply（E 不碰 migrations 目錄）
```

## §11 關卡 1 對帳(13 must-fix + 2 nit 逐條;**我親驗過才折**)

| # | 關卡 1 說 | 我親驗 | 處置 |
|---|---|---|---|
| 1 | `orderId` 對帳會撈到別筆退款 | 成立 | ✅ 折入 §3-1(鍵改 `recTradeId`) |
| 2 | `deferred` 是「確定沒退」卻算證據 | **成立**(CHECK 實查 4 值) | ✅ 折入 §2.2 / §8-1 |
| 3 | `payment_refunds` 沒 status | **成立**(status CHECK 零命中) | ✅ 折入 §2.3 / §9-3 |
| 4 | 三表對執行角色無 SELECT | **半成立**:`order_refunds` **有** `service_role`;另兩表**只有 owner** | ✅ 折入 §2.1,**並更正它的範圍** |
| 5 | Q2=A 沒解掉假人工待審 | 成立 | ✅ 寫進 §10-Q2 的代價 |
| 6 | Q2=B 沒指定 attempt 寫入 | 成立 | ✅ 同上 |
| 7 | 新 reason/kind 要同步 caller 與 allowlist ⇒「不動 caller」不成立 | 成立 | ✅ §9-5 明列為最大未驗面 |
| 8 | deps 加必填欄 ⇒ 既有測試必改 | 成立 | ✅ §4 驗收改「斷言不改、只補 stub」 |
| 9 | `2` 與 `3` 淨收不同 | 成立 | ✅ 折入 §3-3 |
| 10 | 0 列不足以證「第一筆真退款尚未發生」 | 成立(Portal 退款不留本地列) | ✅ §7 改標未確認 |
| 11 | webhook/callback 無 unpaid 前置 | **成立**(`route.ts:189-191` / `page.tsx:125` 親驗) | ✅ §7 觸發條件改寫 |
| 12 | 「`110000` 在途」是過時正式狀態 | ❌ **關卡 1 講錯**:`schema_migrations` 最新 = `20260811100000`,`110000` 不在已套用清單 | ⛔ **不折**,§6 保留原句並附查詢 |
| 13 | Q2=B 的 rollback「無資料面殘留」不成立 | 成立 | ✅ 折入 §5 |
| nit-1 | §1.2 與 §3 實作位置字面互撞 | 成立 | ✅ §1.2 末段統一為「改消費端」 |
| nit-2 | RF7-b 仍寫「既有七路」 | 成立 | ✅ 全檔統一為八路 |

**沒打穿的面(關卡 1 自陳)**:caller 看不到 `verdict.kind`(私有函式)/ 讀帳失敗回 pending 的方向確實 fail-closed /
159 支 migration、兩本帳 0 列、2/3 現行分類與八條消費路盤點,均與現況相符。

## §12 🔴 順手掃到的過時合約字面(**我沒改,只列清單**)

§2.2 查到 `order_refunds.status` 現行值域是**四值**;全樹掃舊的三值字面:
```bash
grep -rn "processing.*confirmed.*failed" docs/ supabase/ packages/ \
  --include='*.md' --include='*.sql' --include='*.ts' | grep -v deferred | grep -v rf7-settle | wc -l
# = 24 列,分佈在 10 個檔
```

🔴 **本節第一版只列了 3 個檔,那是錯的** —— 我用 `head -5` 看輸出、卻把它當成全量寫成表。
**這正是本檔 §11 在數落 v1 的同一種病,而且是在同一份文件裡、寫完不到十分鐘又犯一次。**
(守門提示語逐字警告過「判不出掃描範圍對不對」;`head` 截斷不會報錯,所以只有回去數才擋得住。)

全量按檔聚合(母體 = 上面那條命令的 24 列):

| 檔案 | 命中數 | 性質 |
|---|---|---|
| `docs/specs/2026-07-25-m3-rf2a-refund-ledger-plan.md` | 6 | 片級 plan,`:144` 逐字寫 `CHECK IN (processing, confirmed, failed)` |
| `supabase/migrations/20260725130100_m3_rf2a2_order_refunds_ledger.sql` | 5 | **建表 migration 本體**(它當時就是三值,**歷史正確、不該改**) |
| `supabase/migrations/20260801120000_m4b_e10_a7c_refund_ledger_guards.sql` | 3 | 守門 migration |
| `supabase/migrations/20260803150000_m3_a7c_rw1a_refund_write_rpcs.sql` | 2 | 寫入 RPC |
| `docs/specs/2026-08-01-refund-ledger-redesign-proposal.md` | 2 | 提案 |
| `docs/handoff/2026-08-01-a7c-night-run-handoff.md` | 2 | 交接檔 |
| `docs/specs/research-2026-07-25/pcm-order-inventory.md` / `2026-08-03-a7c-refund-wire-plan.md` / `2026-07-28-e10-order-closure-master-plan-v2.md` / `2026-07-24-refund-automation-line-prd.md` | 各 1 | 敘述句 |

⚠️ **我一列都沒改,而且不建議盲改**:
- **migration 檔是歷史記錄**,寫的是它 apply 當下的值域 —— 改了反而變成假歷史。
- 但 `deferred` 是**哪一支 migration 加的、加在什麼語意下**,我**沒查**(不在派工範圍)⇒ 標未確認。
- **實作 RF7 的人若照 `2026-07-25-m3-rf2a-refund-ledger-plan.md:144` 寫狀態機,就會漏掉 `deferred`** ——
  這是本節存在的唯一理由:當路標,不是當待辦。
**要不要回頭修哪幾處,是另一個決定**(建議一併問 Sean,或由主視窗排制度片)。

---

## §13 🔴 關卡 1 R2 結論:**FAIL,而且是方向問題** —— 停下、把決策交回 Sean

R2 打出 **10 must-fix + 1 nit**,每一條都不是 R1 的重複。其中三條**指向同一件事**:
**§10 那三題的九個選項裡,有五個是死路** —— 而「選項自己走不到終態」正是**壞題**(memory
`feedback_decision-option-must-be-traced-to-end-state`)。我上桌之前沒把它們走完。

### 13.1 兩條把「E 自己做得完」徹底打死的事實(**我親驗**)

| # | 事實 | 驗法 |
|---|---|---|
| ① | **`settleCharge` 跑的角色是 `payment_confirmer`**(`composition.ts:126` `requireEnv('PAYMENT_CONFIRMER_DB_URL')`),而它對**四張表 SELECT 全部 false** —— 連 `order_refunds`、連它自己天天在動的 `payment_charge_attempts` 都沒有 | `select has_table_privilege('payment_confirmer', c.oid,'SELECT') …` 對 `order_refunds` / `payment_refunds` / `payment_refund_events` / `payment_charge_attempts` = **f,f,f,f** |
| ② | 那個角色是**RPC-only 窄權設計**(只有具名 SECURITY DEFINER RPC 的 EXECUTE)⇒ **任何「直讀帳本」的做法,在 A / B / C 三個分支都不成立**,不是只有 B | 同上 + `composition.ts:82-86` 註解 |

⇒ **§2.1 我寫「`order_refunds` 有 `service_role` 所以 A 分支不用動 P」是錯的** ——
`service_role` 有 SELECT 沒錯,但**跑這條路的不是 `service_role`**。
我量了「表給了誰」,卻沒量「**誰在跑**」——**量錯東西的第 N 種形狀**。

### 13.2 第三條:**Portal 手動退款,三個選項全都收斂不了**

我 §7 自己寫了「Portal 退的錢不會在本地留列」,卻在 §10 出了三個**全部以帳本為證據**的選項
⇒ Record=3 + 兩本帳皆 0 列時,**A/B/C 一律判「無證據」→ 維持假告警**。
**我自己承認的場景,我給的選項一個都蓋不到。**

### 13.3 ⇒ 現在該問 Sean 的,不是原來那三題

原三題(§10)**先擱置**。真正的前置題只有一個:

```
Q0(RF7 的定義):當「TapPay 說退了,但本地兩本帳都沒有那筆」時,系統該怎麼判?
A: A|B|C
  A = 一律當異常(= 現況)。Portal 退款繼續進人工待審佇列;RF7 縮成「只消掉
      我們自己退的那些假告警」,Portal 那類刻意不管
  B = 打 Record API 拿金額、與 orders 的已收金額對帳,不依賴本地帳本
      → 唯一蓋得到 Portal 的做法;但它是**新的對帳邏輯**,不是「重分類」,片會大很多
  C = 先讓 admin 有地方登記「這筆是 Portal 退的」,再回到帳本對帳
      → 等於先做一片後台功能
```
**Q0 拍完之前,§10 的三題沒有意義**(它們都預設了「帳本是證據來源」這個前提)。

### 13.4 我在這片上犯的三個錯(**都不是審查者發現前我不知道,是我沒去驗**)

1. **量了「表給了誰」,沒量「誰在跑」** —— ACL 表是對的,結論是錯的。
2. **選項沒走到終態** —— 我有這條 memory,今天還是把五個死選項端上桌。
3. **`head -5` 當全量**(§12)—— 同一份文件裡,我在數落 v1 的十分鐘後又犯一次。

### 13.5 誠實界

- **R2 的 10 條我只親驗了 3 條**(13.1 兩條 + §6 的 `110000` 事件值那條);
  其餘 7 條(§8 驗收沒判別力、Q2-B 無安全落點、Q3-B 沒人產 SQL、部分退金額對帳…)
  **我認為成立但沒逐條實查** ⇒ 標**未親驗**,不得當成已證。
- **沒有 R3**:不是因為收斂了,是因為 **R3 該打的東西已經不在 plan 層**(Q0 沒拍,重寫也是白寫)。

---

# RF7 plan **v3**(Q0=A;2026-08-11 夜)—— **修法縮成一個判斷,而且不需要任何新東西**

> 派工 = `E-314-A`。Sean 拍 **Q0=A**:「TapPay 退了、本地無帳」維持異常進人工待審;
> **RF7 縮成只消掉「我們自己退的」那些假告警**;Record API 對帳線立 backlog **`#419`**。
> **v2 的三題(§10)在 Q0=A 之下全部消失** —— 理由不是「不用問了」,是**下面這三條實查把它們的前提拆了**。

## v3-§1 三條實查,把 v2 的整個困難面移除

| # | 事實 | 座標 |
|---|---|---|
| ① | **`settleCharge` 手上已經有 `orders.payment_status`** —— `ActiveChargeAttempt.orderPaymentStatus`,而且 `settle-charge.ts:68` 早就在用它短路已 paid 的單 | `packages/domain/src/payment/types.ts:565`;`settle-charge.ts:68` |
| ② | **我們自己的退款會寫它**:`admin_finalize_order_refund` 步 7 依 `SUM(order_refunds.refund_amount) WHERE status='confirmed'` 對比 `orders.total`,`UPDATE orders SET payment_status = refunded / partiallyRefunded` | `20260803150000_m3_a7c_rw1a_refund_write_rpcs.sql:777-782` |
| ③ | **sweeper 的 claim 濾 `orders.payment_status='unpaid'`** ⇒ 已退款的單**根本不會被領** | `20260615120001_m3_3ds_4a2_attempt_sweeper_rpc.sql:16` |

⇒ **v2 那些困難全部消失**:
- 不需要讀任何帳本 ⇒ **`payment_confirmer` 沒有 SELECT 這件事不再是障礙**(v2 §2.1 的死結)
- 不需要新 port / 新 RPC / 新 migration / 不碰 P 的地盤 ⇒ **v2 §10 的 Q1、Q3 消失**
- **Q2 的死結被繞開**:v2 說 Q2-A「仍回 pending ⇒ 重試到 ceiling ⇒ 假人工待審沒解掉」,
  但那個推論**漏了 ③** —— 自己退的單 `payment_status` 已非 `unpaid`,**sweeper 從一開始就不領它**
  ⇒ 回 pending 不會產生任何重試,**不需要新的 attempt 終態**
  (而 `payment_charge_attempts.status` 實查 = `{pending, charged, failed, released}`、**確實沒有 refunded**,
  R2 那條說對了 —— 只是我們現在不需要它)

## v3-§2 修法(全部改動集中在 `settle-charge.ts` 的**一個分支**)

`:181-188` 的 `refund_anomaly` 消費端改成兩路:
- `attempt.orderPaymentStatus ∈ {refunded, partiallyRefunded}` ⇒ **我們自己退的**:
  不告警、回一個**具名的**非異常 pending(reason 另立,別沿用 `record_unverified` —— 它現在的意思是「查不出來」,
  而這裡是「查得出來、而且正常」)。
- 其餘(含 **Portal 手動退**)⇒ **維持現況:`console.error` + pending** ← 這就是 Q0=A 要的行為。

**不動**:`classifyRecordStatus`(純函式)、任何 caller、`SettleChargeDeps`、schema、ACL。

## v3-§3 🔴 一個誠實的缺口:**L5b 補償退款蓋不到**

`payment_refunds`(L5b)**不寫 `orders.payment_status`** —— 這不是我推的,是 **P 自己的 plan 寫下的證據**:
`docs/specs/2026-08-10-l5b-2-compensation-writer-plan.md:741` 逐字
「**本片零 `payment_status` 寫入的證據**:`20260810140000` 全檔 `payment_status` **零命中**(實 grep)」。

⇒ 嚴格講,**本修法沒有 100% 滿足 Q0=A**(L5b 退的也是「我們自己退的」)。
**但今天覆蓋率是 100%**:`payment_refunds` 正式庫 **0 列**、`110000` 未 apply ⇒ 那條路還沒有任何一筆。
**處置(建議,不自己決定)**:
- (a) 由 **L5b 側**在補償退款成立時一併寫 `orders.payment_status`(語意上本來就該寫)—— 我**不碰 P 的地盤**,只提出;
- (b) 或把它掛進 `#419`(Record API 對帳線)一起解;
- (c) 或另立條目。
⚠️ **無論哪個,RF7 這片都要在 code 註解裡留下「L5b 那條路不在本片覆蓋內」的字面**,
否則下一個人會以為 2/3 的假告警已經全解了(**這正是 v2 §2.2 那種「看起來已修好」的陷阱**)。

## v3-§4 片界:**一片**(15-45 分鐘)

v2 拆的三片(RF7-0/a/b/c)全部作廢 —— 那是為了「讀帳本」而拆的。
現在只有一片:改 `:181-188` 分支 + 具名 reason + 測試。

## v3-§5 驗收(每條可 yes/no)

1. `orderPaymentStatus='refunded'` ⇒ 不 `console.error`、回具名新 reason。
2. `='partiallyRefunded'` ⇒ 同上(**兩個值各一格,不共用一格**)。
3. `='unpaid'`(Portal 情境)⇒ **仍 `console.error` + pending**,且**該格拿掉修法後必須仍綠**
   —— 它是現況基線,**不能拿它當本片的證據**(R2 打過同型的假驗收,`plan §8-5`)。
4. **判別力**:把修法拿掉 ⇒ 第 1、2 格必紅;把條件寫成 `!== 'unpaid'` ⇒ 應有一格紅
   (`released`/`charged` 等其他值不得被誤放行)。
5. **不得新增** port / deps / migration ⇒ `SettleChargeDeps` 型別**逐字不變**(結構斷言釘住)。
6. 三綠 + 全套;鐵則 12 ①錢命中 ⇒ commit 前跑關卡 2。

## v3-§6 誠實邊界

1. **沒實作**(等批)。
2. **沒打 Record API** ⇒ 「那 1 筆 sweeper 可領的 attempt 在 TapPay 端是不是 2/3」仍未確認。
3. **L5b 缺口見 v3-§3**,已明列、不假裝蓋到。
4. v3 的三條實查是 **21:3x** 的觀察;`admin_finalize_order_refund` 我讀的是 migration 原文、
   **沒有實跑一次退款驗證它真的寫了 `payment_status`**(正式庫 `order_refunds` 0 列,構造不出來)
   ⇒ ② 標**讀碼確認、未實跑**。
5. **v2 的 §11 對帳表與 §13 停線段全部保留** —— 那是這片怎麼走到這裡的紀錄,不刪。

## v3-§7 🔴 窄審結論:**v3 也 FAIL(11 must-fix)—— 而且失敗形狀與 v1/v2 相同**

### 7.1 三條我親驗、直接打死 v3 中心主張的

| # | 事實 | 座標 | 打死了什麼 |
|---|---|---|---|
| ① | `if (attempt.orderPaymentStatus === 'paid') { … return paid }` —— **已 paid 的單根本不查 Record** | `settle-charge.ts:68-71` | v3-§2 說「其餘(含 Portal)維持現況告警」**是假的**:Portal 對**已 paid** 單退款,今天**連告警都不會有**(它在 Record 查詢之前就返回了)。⚠️ 該處註解自己寫「嚴格 `=== 'paid'`…避免誤短路退款/partiallyPaid 態」——**作者想過這件事,是我沒讀到那一行** |
| ② | webhook inbox 的 claim **不濾 `orders.payment_status`** | 4a1 webhook migration(grep `payment_status` 該檔 = 0 命中) | v3-§1 ③ 只對 **sweeper 的 attempt claim** 成立;**inbox 那條路照樣重試到 8 次並轉人工** ⇒「不會進人工佇列」為假 |
| ③ | **`flagNonUnpaidActive`** 存在 —— 把「訂單非 unpaid **且非 paid** 但 attempt 仍 active」標成人工 | `packages/adapters/src/payment/PgChargeAttemptAdapter.ts:210`;本體 `20260615120001…sql:155` | 系統**本來就有**一條針對這個狀態的設計動作。我完全沒盤到它 ⇒ RF7 的問題框架可能一開始就該從它出發 |

🔴 **2026-08-12 精化(④ 線讀本表出錯後回補)**:③ 原寫「非 unpaid」,**漏了排除集合的另一半**。
本體 `WHERE` 逐字 `o.payment_status NOT IN ('unpaid'…, 'paid'…)` ⇒ **`paid` 不在它射程**。
⚠️ 值得記一筆:**同一張表的 ① 已經寫了「已 paid 的單根本不查 Record」(`settle-charge.ts:68-71` 短路)**
—— ①③ 兩列對 `paid` 的說法其實互相牴觸,而它們並排放了一天沒人看出來。
④ 線後來照 ③ 的字面寫出「已取消+仍 paid 會被標人工」= 錯的
(更正見 `docs/specs/2026-08-12-4a-paid-cancel-rpc-plan.md` §7-2)。

### 7.2 另一條方向最危險的(審查者提、我認,未實跑構造)

**先本地部分退款、之後 Portal 再退一次**:`orders.payment_status` 仍是 `partiallyRefunded`
(那是**上一次**我們自己退的結果),而**這一次**的退款兩本帳都沒有列
⇒ v3 的判斷會把它**誤判成「我們自己退的」而靜音**。
**方向 = 漏報**(把「不知道發生什麼事」講成「一切正常」),正是 Q0=A 明確要留住的那一類。
🔴 **根因**:`orders.payment_status` 是**訂單層的累積狀態**,而我拿它當**這一次 Record 事件**的證據
—— **粒度不對**。同一個病 v2 也犯過(v2 用 `orderId` 當鍵、被打回改 `recTradeId`),**我換了證據來源卻把粒度錯誤原樣帶過來**。

### 7.3 🔴 三輪的失敗形狀是同一個(這才是該記的東西)

| 版本 | 中心主張 | 被什麼打死 |
|---|---|---|
| v1 | 「認任一本帳有非 failed 紀錄、零 migration 直讀」 | 我沒查**誰在跑**(角色 ACL)、沒查 `deferred` 語意 |
| v2 | 「三個選項涵蓋了問題空間」 | 我沒把選項走到終態(Portal 案三案全不收斂) |
| v3 | 「讀 `orderPaymentStatus` 就夠,七路都不累積」 | 我沒盤完七路(inbox 不濾、paid 短路、`flagNonUnpaidActive`) |

⇒ **共通形狀:每一版的中心主張都建立在「我列的那份清單是完整的」,而三次都不完整。**
而且**每次補完之後,新版又立刻建立在一份新的、同樣沒被證明完整的清單上**。
⇒ **這不是再寫一版 v4 能解的** —— v4 的中心主張會是「這次我盤完了」,而那正是前三次說過的話。

### 7.4 建議(**不是我能拍的**)

RF7 這片要能出一份站得住的 plan,前提是先有人把
**「`settleCharge` 的所有觸發路 × 訂單狀態 × Record 狀態」這張矩陣一次列完並各自標出現行處置**
—— 包含 `flagNonUnpaidActive` 這種我這次才發現的既有機制。
那是一份**偵察產出**,不是 plan;它做完之前,任何修法提案都會重複上面那個形狀。
⇒ 建議把 RF7 拆成 **RF7-recon(矩陣)** 與 **RF7-fix(等矩陣出來再寫)** 兩件,由主視窗排。
