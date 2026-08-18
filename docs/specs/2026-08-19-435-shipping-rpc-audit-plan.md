# Plan — `#435` 出貨線五支 RPC 補同交易稽核(抄 `#423`)

> **狀態:未批。** 命中 **鐵則 12③**(改 SECURITY DEFINER 函式本體 = migration)⇒ 要對抗審查。
> 🔴 **12① 不命中 —— 而這次是量到的,不是推的**(見 §0-b)。
> 偵察見 `docs/probes/2026-08-19-435-shipping-rpc-audit-probe.md`。

---

## 0-a 🔴 檔頭前置:**本片的 apply 順序排在 M-4a 那支之後**
```
repo 現在已經有一支在等 Sean apply:
  supabase/migrations/20260819010000_m4a_close_manual_review_attempt.sql
  ⇒ 而它在【不得 apply 清單】上(gate = 完整範圍就緒)
⇒ 🔴 **本片交出來之後也要等他,而且排在那支後面。**
⇒ 寫在檔頭而不是內文,因為「什麼時候輪得到」是讀這份 plan 的人第一個會問的。
```

## 0-b ✅ 12① 那格:**逐檔量過了,零命中**
```
五支的定義檔(最新版本):
  admin_create_shipment        20260807170000_…w3a_create_shipment.sql
  admin_add_shipment_items     20260807230000_…w4b_impl_extract_and_no_batch.sql
  admin_mark_shipment_shipped  20260808100000_…w7d1_ship_deadlock_retry.sql
  admin_void_shipment          同上
  admin_unvoid_shipment        同上

grep -ciE "amount|total|price|payment|refund|金額|付款|退款" <三檔> ⇒ **0 / 0 / 0**
負向對照(同一把尺對確定碰錢的檔):#423 那支 ⇒ **120** ⇒ 尺會動
```
🔴 **而 GR-069 MF-1 打到一個真的:上面那個分母【漏了被呼叫端】。**
```
五支的 body 會呼冪等層三支(w7d1:205,207,293,335,337,399,440 — GR grep 的),
而 w2(20260807160000,840 行)**不在我原本的三檔分母裡**。
⇒ 補掃(我自己重跑,不是採信轉述):
   w2 窄字集 grep -ciE "amount|total|price|payment|refund|金額|付款|退款"  ⇒ **0**
   w2 擴字集 grep -ciE "wallet|ledger|折抵|經銷|tier"                      ⇒ **0**
   三檔擴字集                                                              ⇒ **0 / 0 / 0**
   負向對照(擴字集對 #423)                                              ⇒ **2** ⇒ 尺會動
⇒ **結論不變(12① 仍不命中),而【分母與字集都要照這一版讀】。**
📌 形狀:**我掃了「宣稱要改的那五支」,而沒掃「它們會走進去的地方」** ——
  同族:`feedback_coupled-to-is-not-the-same-as-touches`。
```

⇒ **12① 不命中。** ⚠️ 而限定:**這是掃字面,不是逐行讀邏輯** —— 我讀了三檔的稽核相關段落,
沒有逐行讀完 683+ 行的全部本體。**若審查者要更硬的,那要逐行。**

---

## 1. `#423` 的形狀 —— **逐條列出來,標明哪些照抄**(第 1 格)

`20260812150000_m4b_e10_423_payment_audit.sql` 的稽核寫入(逐字):
```sql
INSERT INTO public.admin_audit_log
  (actor, action, target, request_id, before, after, reason, source_app)
VALUES
  (p_actor, 'payment.record.replay', 'payment:' || v_existing.id::text,
   p_request_id::text,
   pg_catalog.jsonb_build_object('payment_id', …, 'amount', …),
   pg_catalog.jsonb_build_object(…),
   NULL, 'admin');
GET DIAGNOSTICS v_audit_n = ROW_COUNT;
IF v_audit_n <> 1 THEN
  RAISE EXCEPTION '…稽核落 % 列(期望恰 1)…本交易整筆回滾', v_audit_n
    USING ERRCODE = 'P2B40', CONSTRAINT = 'pcm_op5_audit_replay_row_count';
END IF;
```

| # | `#423` 的做法 | 本片 |
|---|---|---|
| a | 八欄 `(actor, action, target, request_id, before, after, reason, source_app)` | ✅ **照抄** |
| b | **同交易**寫(不是 trigger、不是事後補) | ✅ **照抄** —— 稽核與狀態變更同生共死 |
| c | `GET DIAGNOSTICS` 驗 **ROW_COUNT 恰 1**,不是 1 就 `RAISE` 整筆回滾 | ✅ **照抄** |
| d | 專屬 `ERRCODE` + `CONSTRAINT` 名 | ✅ 照抄形狀,**而碼要換**(見 §2-4) |
| e | 稽核筆數用**獨立變數** `v_audit_n`,**刻意不共用** `v_n` | ✅ **照抄** —— 該檔檔頭寫明理由(既有 harness 的順序錨取首次命中) |
| f | 🔴 **重放路徑用不同的 `action` 碼** | ⚠️ **要判**:出貨線有沒有重放路徑?見 §3 未查 |
| g | `before`/`after` 只放識別欄,不放全量 | ✅ 照抄 |

🔴 **失敗時怎麼辦:照抄 c ⇒ 稽核寫不進去,整個動作回滾。**
```
理由(#423 的錯誤訊息逐字就寫了):「失敗的是稽核寫入,不是收款不存在;請勿重新登錄」
⇒ 出貨線的對應訊息要自己寫,而**形狀照抄**:講清楚失敗的是哪一半,免得員工重按。
```

---

## 2. 五支各自寫什麼進 log(第 2 格)

> 甲/乙 主視窗已裁 **甲(一律寫)**,理由逐字:「**判準說的是『至少要有』不是『不准多』**」。

```
admin_create_shipment       action 'shipment.create'
                            target 'shipment:<id>'
                            before NULL / after {shipment_id, order_id}
admin_add_shipment_items    action 'shipment.items.add'
                            after  {shipment_id, item_ids 或 筆數}
                            ⚠️ **放 id 還是筆數要判** —— #423 的原則是「只放識別欄」
admin_mark_shipment_shipped action 'shipment.ship'
                            after  {shipment_id, carrier, tracking_number}
                            🔴 **兩族都寫**(甲):有單號的照寫、`other` 那族 tracking_number 為 NULL
                            ⇒ 而那個 NULL **本身就是資訊**(它說明這一族沒有外部佐證)
admin_void_shipment         action 'shipment.void'
                            before {status 前} / after {status 後, reason}
                            ✅ **reason 必填 —— GR-069 裁定**(不是我建議了)
                            先例:`close_released_attempt:82`(同為人工可疑收尾,`p_resolution` 必填非空)
                            🔴 而「必填會擋住緊急作廢」**不成立**:打四個字 vs 三個月後查無理由,**代價不對稱**
admin_unvoid_shipment       action 'shipment.unvoid'
                            ✅ **reason 也必填(GR-069 新格:對稱)**
                            🔴 理由是我自己說的那句:**復原後狀態長得跟沒發生過一樣**
                            ⇒ 而我原本只給 void 加了 reason、**unvoid 沒有** —— 
                              **我把「最重要的那支」漏掉了對稱。**
                            🔴 **這支最重要** —— 作廢又復原之後狀態長得跟沒發生過一樣
                            ⇒ 稽核是**唯一**看得到那段時間的東西
```

### 2-4 ERRCODE 與 CONSTRAINT 名
```
#423 用 'P2B40' + 'pcm_op5_audit_replay_row_count'
⇒ 本片要**新的碼**,不可共用(否則呼叫端分不出是哪條線的稽核失敗)
⚠️ 而「哪些碼已被占用」我沒有全樹掃 ⇒ **實作前要掃一次 `P2B`/`P5A` 之類的既有碼**,標未查
```

---

## 2-5 🔴🔴 **補查改變了本節:出貨線【有】重放路徑,所以要兩組 action 碼**
> 主視窗指定先查的第 ② 格。**它不是補充,它改 plan 的內容。**

`20260807160000_…shipping_idempotency_layer.sql`(840 行)逐字:
```
:15 「pcm_b2_shipping_idem_response(shipment_id, snapshot, replay) —— **回傳形狀的唯一產生處**」
:16 「pcm_b2_shipping_idem_claim(action, key, hash) —— **認領 / 重放分派**」
:20 「五支 RPC 的 body 換成【隔離閘 → 指紋 → 認領 → **重放回傳** → 業務層】」
:93 「兩條路都必須呼叫這支,差別**只有** `idempotent` 那個旗標。**這是 W3 的硬契約。**」
```
⇒ **五支全部都有重放路徑,而且是統一的一層。**

🔴 **所以 `#423` 那條「重放用不同 action 碼」在這裡【必須抄】,理由是它的不變式**:
```
#423 檔頭逐字:「`action` 與正常路徑**刻意不同碼**:查『這張單有幾筆收款』的人濾 `payment.record`,
               重放列不會被誤算進去(**『稽核列數 = 狀態變更數』這條不變式靠 action 區隔保住**)」
⇒ 套到出貨:若重放與首次共用 `shipment.ship`,
  **「這張單出過幾次貨」會被重放灌水** —— 而那正是出貨線最會被問的問題。
```
⇒ **§2 的五個 action 各要一個 `.replay` 對應**:
```
shipment.create / shipment.create.replay
shipment.items.add / shipment.items.add.replay
shipment.ship / shipment.ship.replay
shipment.void / shipment.void.replay
shipment.unvoid / shipment.unvoid.replay
⇒ **十個碼,不是五個。** 而寫入點在冪等層的兩條路上,不是各支自己判。
```
⚠️ **而寫在哪一層要判**:冪等層是**共用的**(`:93` 逐字「兩條路都必須呼叫這支」)
  ⇒ 寫在冪等層 ⇒ 一處寫五支通吃,而 action 碼要能從 `p_action` 推出來
  ⇒ 寫在各支 ⇒ 五處重複,而各自可控
  ✅ **GR-069 裁【甲:寫在冪等層】,而帶三個 rider(缺一不可)**:
```
① p_action → action 碼的映射要【白名單 + 未知值 RAISE】
   🔴 理由:若用 fallback,**未來第六支動作會靜默無稽核** —— 而那正是本片在治的病
② md5 pre-image 閘要**涵蓋冪等層三支**(不只五支)
③ 「同交易」這個性質要**寫明**(GR 量過我的呼叫形狀,成立)
```
📌 而主視窗提的反面(「甲把稽核綁在所有人都會經過的地方 ⇒ 它的失敗會同時影響五支」)
  GR 算過:**稽核失敗回滾本來就是照抄 #423 的設計,乙一樣會停**;
  而乙的五份複本換來的是**艦隊每晚在數的漂移病**(五處要同時改對)。

## 2-6 ✅ ERRCODE:掃完了,`P2B` 這一段**已用到 44**
```
全樹已占用(82 個):P2B01-02 / P2B10-12 / P2B20-44 / P2B50 / P2C13 / P2E… / P5A… / P7C… / P8C…
量法:git grep -oh "'P[0-9A-Z]\{4\}'" -- 'supabase/migrations/*' | sort -u
🔴 而 **P2B22 / P2B24 正是這條出貨線自己的重放錯誤碼**(idempotency layer :40,:42)
⇒ 本片新碼建議走 **P2B45 起**(P2B50 已占 ⇒ 可用 45-49,五個剛好)
⚠️ 而「P2B 是不是這條線的專屬前綴」我沒查 ⇒ 標未確認
```

### 2-7 🔴 「一律寫」(主視窗裁的甲)**以 §2-5 的十碼方案為前提**
```
GR-069 ⑤:一律寫成立 —— **而它綁死在十碼上**。
⇒ 若十碼被砍(例如改成共用五碼),「一律寫」會讓
  **「這張單出過幾次貨」被重放灌水**(§2-5 那條不變式)
⇒ 🔴 **十碼被砍 ⇒ 甲要重裁。** 兩者不可分開改。
```

## 3. 影響面(鐵則 8 必備)—— 🔴 **本節前一版寫錯了,見 3-b**
```
動的檔:一支新 migration(改五支函式本體)
       🔴 **+ `apps/admin/src/lib/audit/audit-list-view.ts`**(見 §3-b)
~~不動:packages/ / apps/ / 任何前端 —— 稽核是 DB 層的事~~ **← 那句是假的**
下游:  admin_audit_log 多【十】種 action ⇒ ✅ **查完了,見 §3-b**
```


### 3-b ✅ **誰在讀 `admin_audit_log`、會不會被新 action 弄壞**(2026-08-19 查完)

**結論:不會壞,而會【變醜】—— 而修法是這片必須一起做的。**
```
app 層命中 admin_audit_log:41 檔
🔴 而關鍵那支是 apps/admin/src/lib/audit/audit-list-view.ts:38
   export const AUDIT_ACTION_LABEL: Record<string, string> = { … }   ← action → 中文標籤
   而 :73-75  formatAuditAction(action) { return AUDIT_ACTION_LABEL[action] ?? action; }
⇒ **字典沒有的代碼【原樣回傳代碼本身】** ⇒ 不會爆,而員工看到的是 `shipment.ship.replay`
```
**該檔自己的註解逐字(`:69-72`)把這件事講得比我好**:
> 「**『不會爆』與『顯示得體』是兩件事,這裡兩件都要**…
>  回 `未知動作` = 得體但**把資訊丟掉** ⇒ **原樣回代碼:醜,但可查。**
>  稽核紀錄的用途是追查,不是好看。」

### 🔴 而 `#423` 的先例證明【這一步是同一片的責任】
```
該字典裡已經有: 'payment.record.replay': '收款重送(冪等)'
⇒ **#423 補稽核的時候,同時把 replay 的中文標籤加進來了。**
⇒ 所以本片的十個 action 也要一起加,而**不是「之後再補」**。
```
### 🔴🔴 而那支檔自己記載著:**這件事被漏過一次**
```
同檔 :58-61 逐字:「這兩個是 E 窗 R1 must-fix 補的…**而我抄 plan §1 的清單時漏了。**
                   ⚠️ 那份清單是 **08-14 數的**,而**分母是那天的樹**」
同檔 :36 逐字:「🔴 **重掃時要掃兩個分母**:主樹 dev **與** 各窗分支的聯集
               —— 新 migration 可能還沒進 dev」
```
⇒ **這片的驗收條件要加一條**:
**十個 action 各在 `AUDIT_ACTION_LABEL` 裡有一筆**,而量法是 `grep -c` 逐個,不是「我加了」。

### 3-c ✅✅ **更硬的一版:讀取端【只有一個】,而它今天是關著的**(2026-08-19 實跑 + 實查)
```
真正【讀】admin_audit_log 的入口只有一支:AuditLogReader.listRecent(limit)
  介面    apps/admin/src/lib/audit/repository.ts:68
  實作    apps/admin/src/lib/audit/supabase-repository.ts:54
  呼叫端  **只有 apps/admin/src/app/settings/audit/page.tsx:91**(唯一一處實呼)
⇒ 其餘 38 個提到 admin_audit_log 的檔,絕大多數是【寫】(tier-actions / profile-actions / staff-actions…)

而 listRecent 的查詢本體(:54-72)逐行讀過:
  只驗 limit 是正整數 ⇒ this.selector.select(limit) ⇒ 回 data ?? []
  🔴 **沒有任何 action 條件、沒有 eq/filter** —— 它就是「最近 N 筆」

🔴 而那一頁**今天是關著的**:AUDIT_UI_ENABLED 預設未設,而 audit-ui-flag.ts 只認 `=== '1'`
   (Sean 2026-08-18 Q19 已答「開」,而**尚未執行**)
```
**⇒ 所以「十個新 action 碼會不會讓現有讀取端漏看」這個擔心【消失了】**:
```
· 讀取端只有一個,而它撈「最近 N 筆」不濾 action ⇒ 新碼一定會被撈到
· 而它現在還沒上線 ⇒ **連「既有使用習慣」都還沒形成**
⇒ 🔴 **本片不會弄壞任何既有功能。**
```
⚠️ **而 §3-b 那條【要一起加中文標籤】不受影響、仍然要做** ——
  那不是「怕弄壞」,是「開了之後員工看得懂」。**兩件事不要混。**

### ✅ 而【沒有人拿 action 當查詢條件】
```
git grep -n "'action'" -- 'apps/admin/src/*' 濾掉 label/format/type 之後:
  只有 audit-log-table.tsx:43 —— 那是**表格欄位定義**(cell: row => row.action),不是篩選
⇒ **沒有既有查詢會因為多了十個代碼而漏看。** 這一格是安全的。
```
⚠️ 限定:我掃的是 `apps/admin/src/`。**SQL 層有沒有人濾 action 我沒掃** ⇒ 標未確認。

---

## 3-d ✅ **十個中文標籤(要與 migration 同片交付,見 §3-b)**

🔴 **這是「一次把它寫對」最便宜的時刻**:那一頁**還沒上線**(旗標未開)⇒ **沒有任何既有習慣要遷就。**

**既有語氣(從 `AUDIT_ACTION_LABEL` 抄的,不是我發明的)**:
```
動詞在前、名詞在後:「登錄收款」「作廢採購」「撤銷到貨」「更新訂單狀態」
重放的寫法只有一個先例:'payment.record.replay': '收款重送(冪等)'
⇒ 格式 = 「<原標籤的動作>重送(冪等)」
```

**⇒ 十個**:
```
'shipment.create'          : '建立出貨箱'
'shipment.create.replay'   : '建立出貨箱重送(冪等)'
'shipment.items.add'       : '加入出貨品項'
'shipment.items.add.replay': '加入出貨品項重送(冪等)'
'shipment.ship'            : '標記已出貨'
'shipment.ship.replay'     : '標記已出貨重送(冪等)'
'shipment.void'            : '作廢出貨箱'
'shipment.void.replay'     : '作廢出貨箱重送(冪等)'
'shipment.unvoid'          : '復原出貨箱'
'shipment.unvoid.replay'   : '復原出貨箱重送(冪等)'
```

### 🔴 而「重放看得出來」不能只靠標籤 —— 那是主視窗指定的那一格
```
主視窗:「重放那五個的標籤要讓人看得出它是重放,否則畫面上會出現兩列看起來一樣的東西」
⇒ 標籤已經帶「重送(冪等)」四個字,而**那還不夠**:
  🔴 兩列的【時間 / 操作人 / 對象】會一模一樣(重放本來就是同一個人對同一張單再按一次)
  ⇒ 員工看到的是「同一件事出現兩次,而其中一列多了四個字」
⇒ 而 #423 是怎麼處理的:它的 before/after 逐字
  「**重放的資訊量在「這件事又發生一次」,不在內容**」⇒ before 與 after **放同一份識別欄**
  ⇒ 那讓「改了什麼」那一欄顯示 **0 個欄位有變動** ⇒ **那就是視覺上的差別**
⇒ ✅ **本片照抄:重放列的 before/after 相同 ⇒ 摘要行自然顯示「0 個欄位有變動」**
  (`audit-detail.tsx:26` 逐字:`if (changes.length === 0)` 走另一個分支)
✅ **那個分支我讀了(audit-detail.tsx:26-30),而它顯示的字正好就是我要的**:
  逐字 `<span …>沒有記錄欄位變動</span>`
  而它自己的註解逐字:「**不是空白**:…顯示空白會被讀成『這頁壞了』,
  而事實是『這筆沒有可展開的內容』」
🔴 ⇒ 所以重放列在畫面上會是:**同一時間、同一人、同一對象、標籤多「重送(冪等)」、
  而「改了什麼」那欄寫「沒有記錄欄位變動」** ⇒ **兩列的差別是【三處】不是一處。**
```

### 驗收(照 §3-b 的量法,不是「我加了」)
```
十個 action 各跑一發:grep -c "'<action>'" apps/admin/src/lib/audit/audit-list-view.ts ⇒ 各 ≥1
🔴 而該檔 :36 逐字警告:「重掃時要掃兩個分母:主樹 dev 與各窗分支的聯集」
```

## 3-e ✅ 補完 §5 兩格
```
admin_audit_log 完整欄位(20260712210000_m4a_admin_audit_log.sql):
  id / actor / action / target / before(jsonb)/ after(jsonb)/ reason /
  request_id(NOT NULL)/ source_app(DEFAULT 'admin')/ created_at
  + 三條非空 CHECK(actor / action / request_id)
🔴 而 before 欄的 COMMENT 逐字:「可含敏感內部狀態 → **全表零 client 權限保護**」
  ⇒ 這是 §3-b 那格 PII 結論的**第三層依據**:表本身對 client 零權限,只有 server 讀得到

#423 那 683 行的組成(體積估用):
  註解行 74 / CREATE OR REPLACE FUNCTION 2 支 / INSERT INTO audit 9 處 / RAISE EXCEPTION 54 處
  ⇒ 🔴 **RAISE 54 處 = 大部分份量在【斷言與錯誤訊息】,不是稽核本體**
  ⇒ 本片五支 + 冪等層,斷言密度若照抄,**體積會比「加十行 INSERT」大一個量級**
  ⚠️ 而我沒有逐行分類,這是從計數推的 ⇒ 標估
```

## 4. Rollback(鐵則 8 必備)
```
🔴 而這一片的 rollback 有一個特別的性質:**稽核寫入是【加】不是【改】**
⇒ 回滾 = 把五支函式貼回上一版(移除那段 INSERT)
⇒ **已經寫進 admin_audit_log 的列不必刪**(它們是真的發生過的事)
⇒ 這比 M-4a 那片的回滾便宜很多 —— 那片改的是【查詢的述詞】,回滾要對齊指紋

素材:五支的上一版本體在 20260807170000 / 20260807230000 / 20260808100000
✅ **而「中間有沒有別的 migration 改過」查完了(repo 側)**:
```
每支的【所有】定義出現在哪些 migration(不是只看最後一個):
  admin_create_shipment        20260807160000(冪等層佔位)/ **20260807170000** ← 最後
  admin_add_shipment_items     …160000 / …180000 / **20260807230000**        ← 最後
  admin_mark_shipment_shipped  …160000 / …190000 / **20260808100000**        ← 最後
  admin_void_shipment          …160000 / …200000 / **20260808100000**        ← 最後
  admin_unvoid_shipment        …160000 / …210000 / **20260808100000**        ← 最後
⇒ **我 §0-b 列的三檔就是最後一版,repo 側成立。**

而那三支【真的 apply 了】(帳本):
  grep -c 20260807170000 / 20260807230000 / 20260808100000 supabase/APPLIED.tsv ⇒ **1 / 1 / 1**
  負向對照(同尺對確定沒 apply 的 M-4a 那支)⇒ 20260819010000 ⇒ **0** ⇒ 尺會動
```
✅ **而 GR-069 MF-2 給了修法(不是只指出洞)**:
```
抄 L5b-0-s 的 **pre-image md5 閘**(20260810220000:187 —— 我在 M-4a 那條線讀過同一段):
  v_md5 := md5(pg_get_functiondef('…'::regprocedure));
  若與預期不符 ⇒ RAISE ⇒ **apply 當場停,而不是靜默把 hotfix 退掉**
⇒ 🔴 **五支 + 冪等層三支都要上**(GR 指定;因為五支的行為靠那三支)
⇒ 而先例證明 live hotfix 不是空想:APPLIED.tsv 裡有「SQL Editor 補記帳列」的痕跡(GR 給的)
```
📌 **這比我原本寫的好**:我只寫「要查」,而它給的是「**查不到就讓 apply 自己停**」——
**把一個需要人記得的檢查,換成一個機器會擋的閘。**

🔴 **而仍有一格【我在本機查不到】**:
```
「有沒有人在 migration 之外直接改過 live 的函式本體」—— 那要正式庫存取
⇒ 而本 repo 有前例證明那不是空想(`20260810170000:` COMMENT 逐字「**繞得過 owner 直寫**」)
⇒ **標未確認;要升成量到的,只差一發唯讀 `pg_get_functiondef` 比對**
  —— 而那要 Sean 的憑證,與 M-4a 那發 `pg_proc` 查詢同一類,建議併同一批問。
```
觸發判準:apply 後任一出貨動作開始 RAISE 稽核相關錯誤 ⇒ 立刻回滾,不要現場除錯
         (出貨是客人收不收得到貨,不能停在半路)
```

---

## 5. 我沒查的(實作前要補)
```
~~· 出貨線有沒有重放/冪等路徑~~ ✅ **查完,見 §2-5:有,而且是統一的一層 ⇒ 要十個 action 碼不是五個**
~~· admin_audit_log 有誰在讀、有沒有人濾 action~~ ✅ **查完,見 §3-b** ——
  不會壞而會變醜;而**十個中文標籤是本片的責任**(#423 就是這樣做的);沒有人拿 action 當查詢條件
~~· 五支 live 定義是不是等於那三檔~~ ✅ **repo 側查完**(見 §4:三檔是最後一版、且帳本各 1)
  🔴 **而「有沒有人繞過 migration 直改 live」查不到** ⇒ 要正式庫,已併進要問 Sean 的批次
~~· ERRCODE 哪些已被占用~~ ✅ **掃完,見 §2-6**(82 個;P2B 段已到 44 + 50 ⇒ 建議 P2B45 起)
```
