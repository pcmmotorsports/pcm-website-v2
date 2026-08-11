# 退款帳本 `manual` 沖銷 — 片級 plan **v4**(#405 + #417)

> **v4 = 關卡1 R2 折完**(8 findings,見 §9)。其中一條**又是我自相矛盾**:
> v2/v3 我寫「`pre_one_terminal_uniq` **維持不動**,改用 trigger 算有效終局」——
> **但舊的 manual 還在索引裡佔著 `refund_id`,新的 manual 一定撞它,而 trigger 繞不過索引**。
> ⇒ 那道索引**必須換掉**,不是「維持不動」。§2b 已改。

> **v3 = Sean 拍板後的收斂**(主視窗 P-521-A,2026-08-11 23:15):
> **Q1=B**(DB + RPC + **讀取面**現在做,UI 排主線後段)、**Q2=A**、**Q3=A**。
> 🔴 **Sean 的理由把我和關卡1 都推翻了,而且他是對的**:我與關卡1 都推「先做最小出口」,
> 論據是「沒有 UI ⇒ 員工看不到變化」。**但這條線還沒有正式使用者** ⇒ 那個缺點不存在;
> 而**先把「帳本有效事件」的正準語意定下來,2e 之後直接蓋在它上面**,省一次回頭改。
> ⇒ **前提錯了,推薦就錯了**——這是今晚第二次「論證正確但前提沒查」。
>
> **v3 的一級交付物因此改成:canonical 有效事件 predicate**(§2d-1),不是那三欄。

> **v1→v2:關卡1 打掉了我推薦的機制,也打掉了我推薦的範圍。**
> ① §2b 的 B 案(generation 欄)**不成立**:`(refund_id, generation)` 只保證「同一代不重複」,
>   任何人都能直接插一筆 gen=2 的終局而**沒有任何沖銷指向 gen=1** ⇒ 兩筆同時有效。
>   我宣稱它是「索引級保證」是錯的 —— 我只是把猜的地方從 trigger 搬到了 generation 的算法裡。
> ② §6-Q1 我推薦的「DB+RPC only」被指出:**沒有 UI、沒有讀取面**,等於先把一份高風險契約凍住,
>   而員工那邊一件事都沒變。
> ⇒ v2 換機制(§2b)、把讀取面拉進射程(§2d)、Q1 重寫(§6)。逐條回應在 §8。

> **拍板**:Sean 2026-08-11 拍 **A=沖銷事件路線**(主視窗 P-516-A);兩條 backlog 一起解。
> **UI 鐵律(Sean 逐字意旨)**:「介面不要複雜,就是簡單的修改;系統顯示上照現在設計的流程,只是操作介面簡單化」
> ⇒ **員工面 = 看到的是「直接改」一個動作;系統面 = 自動產沖銷事件 + 留痕**。沖銷是 RPC 內部機制,不是員工要學的概念。
> **片型**:高風險(鐵則 12① 錢 + 12③ 動已上正式庫的 schema)+ 鐵則 8 ⇒ **plan 先過關卡1 與批准,批准前零實作**。
> **分級**:L1。

---

## §1 現況實查(每條可複跑;設計由這幾件決定)

### 1a. 要動的那張表:`payment_refund_events`

| 事實 | 座標 / 數法 |
|---|---|
| **只有七欄,沒有 actor、沒有 reason、沒有「我在沖誰」** | `sed -n '/CREATE TABLE public.payment_refund_events/,/^);/p' 20260810140000_*.sql` → `id refund_id event_type seq lease_token record_snapshot created_at`;`grep -c 'actor' 20260810140000_*.sql` → **0** |
| append-only(UPDATE/DELETE/TRUNCATE 全擋,P5B01) | `20260810140000:154-162`(函式)、`:183-184`(兩支 trigger) |
| 每顆 refund 至多一筆終局事件 | 現行述詞在 **2d**:`20260811110000:199-201`,terminal = `result_confirmed / result_failed / manual` |
| `manual` 必須帶 boolean verdict | `20260811080000:356-359`(2c 的 `pre_manual_needs_verdict_chk`,全包 COALESCE) |
| `(refund_id, seq)` 唯一 | `20260810140000:136` |

⇒ **「填錯的 manual 改不了」的機制成因有兩層**:①append-only 不准改列 ②唯一索引不准再寫第二筆 manual。

### 1b. 要沿用的先例:`order_payments` 的沖銷(實查,不是「聽說有」)

| 件 | 座標 | 它在守什麼 |
|---|---|---|
| `reverses_payment_id` nullable | `20260810100000:215` | NULL=收款、非 NULL=沖銷 |
| `reversal_reason` | `:251` | 只有沖銷列用 |
| `order_payments_rail_fields` CHECK | `:262-281` | 沖銷列外部識別欄必空、理由必填非空白 |
| 複合自我 FK | `:306-311` | 沖銷必須**同單同軌** |
| `order_payments_one_reversal_uniq` | `:387-389` | **一列最多被沖一次** |
| `pcm_op2b_reversal_amount()` trigger | `20260810130000:154-191` | 金額=被沖列反號(**跨列不變量 CHECK 做不到 ⇒ 用 trigger**) |
| `pcm_op2b_immutable_columns()` | `:209-241` | **更正走沖銷、不是改列** |

**權限邊界(我自己在 #405 寫的警語「有現成的可沿用最容易出事」⇒ 這段是實查)**:
- 表**零 GRANT**:`20260810100000:409-410` `ENABLE ROW LEVEL SECURITY` + `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role, authenticator`。
- 寫入一律走 **SECURITY DEFINER RPC**;`admin_reverse_manual_payment` 的 EXECUTE **只給 `service_role`**(`20260810210000:329-331`)。
- actor 不是自由字串:`opa12` 的 **G2** 逐字檢查 `staff` 表且 `is_active`(`20260810210000:104-108`,ERRCODE `P2B42`)。

### 1c. 🔴 兩個會改變本片形狀的發現

1. **L5b 帳本目前零 admin UI**:`grep -rl 'payment_refund_events' apps/ | wc -l` → **0**;`payment_refunds` 同樣 **0**。
   現有的退款畫面(`refund-section.tsx` 等)寫的是 **M3 舊帳本 `order_refunds`**(`20260725130100:80`),**不同表**。
   ⇒ **Sean 的 UI 鐵律目前沒有可掛的畫面** —— 「員工面直接改」預設有一個顯示 manual 判定的地方,而它不存在。
2. **這條金流線不寫 `admin_audit_log`**:`opa12` 與 OP5 兩支 RPC 內 `grep -n admin_audit_log` 皆零命中;
   慣例是**帳本列本身即稽核**(actor + reason + append-only + 不可變欄)。
   ⇒ 本片若沿用形制,**不另接 audit log**;但 `payment_refund_events` 現在**沒有 actor 欄**(§1a)⇒ 得補。

---

## §2 設計

### 2a. 三件純加法(DB 面)

1. **`payment_refund_events` 加三欄**(皆 nullable、純加法):
   `reverses_event_id uuid`、`reversal_reason text`、`actor text`。
   🔴 **自我 FK 要複合、不能只指 id**(關卡1 R2):裸 `(reverses_event_id) → (id)` **不保證同一顆 refund**、
   也不保證被指的是 `manual` ⇒ 可以跨 refund 指,而「鎖 A 的父列」就擋不住對 B 的影響。
   改成複合 `(refund_id, reverses_event_id) → (refund_id, id)`(對照 `order_payments:306-311` 的同單同軌 FK),
   「被指的必須是 manual」由 trigger 補(FK 表達不了)。
   🔴 **`actor` 的 CHECK 必須 `NOT VALID`**(關卡1 R2):一般 validated CHECK 會掃既有列,
   而本欄在本片之前不存在 ⇒ 舊列全是 NULL、apply 當場失敗。⇒ 明寫「只約束未來列」,
   並在 plan 裡承認舊列的「誰做的」永遠拿不回來。
2. **一列最多被沖一次**:`CREATE UNIQUE INDEX pre_one_reversal_uniq ON payment_refund_events(reverses_event_id) WHERE reverses_event_id IS NOT NULL`(逐字對應 `order_payments:387-389`)。
3. **形狀 CHECK**(關卡1 修正了 v1 的對稱寫法):
   - `reverses_event_id` / `reversal_reason` **只有 `manual_reversal` 列可以有**、且有就必須非空白;
   - **`actor` 對「沖銷列」與「替代的新 manual 列」兩者皆必填** —— v1 寫成「三欄對稱」會逼新 manual 的 actor 是 NULL,
     而 §5 又宣稱 actor 是稽核承重欄,自相矛盾。

### 2b. 🔴 核心(v2):**「有效終局 = 還沒有人沖它的那個鏈尾」**,由 trigger + 鎖父列守

v1 想用 `(refund_id, generation)` 唯一索引拿到「索引級保證」。**關卡1 打掉它**:那個索引只保證同一代不重複,
**擋不住「直接插一筆 gen=2 的終局、而 gen=1 沒有被任何沖銷指向」** ⇒ 兩筆同時有效,而索引一聲不吭。

⇒ v2 承認一件事:**「至多一個有效終局」是跨列不變量,而跨列不變量在 PG 裡就是 trigger 的活**
(這正是 `op2b` 為什麼用 trigger 而不是 CHECK:`20260810130000:154-191`)。

**機制**:
1. 🔴 **`pre_one_terminal_uniq` 必須被換掉,不能「維持不動」**(關卡1 R2 第一條;v2/v3 我寫成維持不動=自相矛盾):
   舊的 manual 被沖銷之後**仍然在索引裡佔著那個 `refund_id`** ⇒ 新的 manual 一定撞唯一索引,
   而 **trigger 繞不過索引**。⇒ 本片 `DROP` 它,唯一性改由 2b-3 的 trigger 全權負責。
   ⚠️ 這讓本片的爆炸半徑變大(它是 2d 剛動過的物件)⇒ §7 的字面清單、2c/2d 兩支回退腳本的
   逐字 pin、兩支 harness 的基線斷言**全部要同批改**,且 2c 回退的順序閘白名單要多一個形狀。
2. 新增 `reverses_event_id`(自我 FK)+ `pre_one_reversal_uniq`(一列最多被沖一次,對照 `20260810100000:387-389`)。
3. **把 `pre_one_terminal_uniq` 的述詞改成「排除已被沖銷者」做不到**(索引述詞不能引用別列)⇒
   改成 **BEFORE INSERT trigger**:寫入 terminal 事件時,先 `SELECT … FOR NO KEY UPDATE` 鎖父列 `payment_refunds`,
   再算「**未被任何 reversal 指向的 terminal 事件數**」,>0 就 RAISE。
   ⚠️ 這是**把索引級保證降級成 trigger 級**——誠實寫明:並發正確性**完全靠那道父列鎖**,
   而那道鎖是本線既有的序列化點(母 plan §3a-4 的 advisory 共用點同一顆)。
4. **`manual_reversal` 明定 NOT terminal**(關卡1 must-fix):它不進 terminal 集合、不佔名額;
   它只是「把某一筆終局標記成作廢」的那張紙。

### 2d-1. 🔴🔴 **一級交付物:canonical「有效事件」predicate**(Sean 拍 B 之後,這才是本片的本體)

**契約**:一個**具名 view**(關卡1 R2 要求選定,不能停在「view 或 predicate」——
片語會散落各 consumer、各自快取、且**無法獨立測試**;view 可直接測、相依失效會刷新計畫)。
view 要明定 owner、`security_invoker`、**零 GRANT**,並對「被 SECDEF 函式消費時不得 fail-open」寫斷言。
它定義「這顆 refund 現在**有效**的終局事件是哪一筆」:

> 有效終局 = `event_type IN (terminal 集合)` **且** 沒有任何 `manual_reversal` 列的 `reverses_event_id` 指向它。

- **所有讀取面一律消費它**:2e 的排除條件、`op6a` 的結清判定(`20260811030000:148-153`)、
  未來 2m 的三支讀取面 —— **不得再自己問「有沒有 manual」**。
- **為什麼它是本體**:沖銷寫得進去但沒人讀 = 等於沒發生。Sean 選 B 的理由逐字是
  「先定正準語意,2e 之後直接蓋在它上面」⇒ **這片交付的其實是語意,不是三個欄位**。
- ⚠️ 動 `op6a` = **已上正式庫的錢面** ⇒ 鐵則 12①③ 全鏈(對抗審查不降級)。

### 2d-1b. 🔴 改 `op6a` 是**正式錢面的行為改變**,要明列接受(關卡1 R2)

- `20260811030000:147-154` 現行是**正向存在條件**:「確實存在 terminal、且沒有 success/manual」才排除退款。
  換吃 canonical view 之後**必須保留那個正向條件** —— 否則「零有效 terminal」會被空集合當成「全 failed」。
- **會翻面的情境**:「被沖銷的 manual + 現行有效的 `result_failed`」原本落 `needs_human`,
  之後可能變成可結清。**這是新語意的合理結果,但它是行為改變**,要:
  ①在 plan 明列接受 ②配兩格測試:「替代 manual 不翻面」「無替代事件時仍 `needs_human`」。
- 🔴 **canonical 只回答「哪一列有效」,不回答「有效的 `manual` 且 `refunded=false` 要算什麼」** ——
  現行程式把**所有** manual 都當退款跡象。**本片必須釘死**:維持現行(manual 一律算跡象)
  或改成「`refunded=false` 視同 failed」。**v3 沒釘 ⇒ v4 列為必答項**,新代開工前要跟主視窗確認。

### 2d-2. 讀取面逐點改寫(v1 整段漏掉,關卡1 抓出來)

沖銷只寫得進去還不夠 —— **下游若還用「有沒有 manual/terminal」判斷,被沖掉的那筆照樣算數**:
- 母 plan §4b `:457` 要求 2e 的排除條件認 `result_confirmed`(2e 尚未實作 ⇒ 本片要把「有效鏈尾」語意寫進它的規格)。
- `op6a` 的結清判定(`20260811030000:148-153`)用的是 EXISTS 形式 ⇒ **本片必須逐一查它們吃不吃得到作廢**。

⇒ **本片射程必須包含**:①一個「取有效終局」的判定式(view 或 SQL 片語,單一權威)
②逐一改寫現存的讀取點 ③每個讀取點各一格「舊的已作廢、讀不到它」的負測。
**這是 v1 最大的漏**:v1 只想著寫入面,而沖銷這種機制**寫入面做完等於零** —— 沒人讀它就等於沒發生。

### 2c. RPC(員工面只有一個動作)

`admin_correct_refund_manual_verdict(p_refund_id uuid, **p_expected_event_id uuid**, p_actor text, p_reason text, p_refunded boolean)`
—— 🔴 `p_expected_event_id` 是關卡1 逼出來的:只收 `refund_id` 的話,兩個交易同時修正時,
後到的那個會**改沖到前一個剛寫進去的新 manual**,兩邊都成功而員工以為只改了一次。
鎖父列之後先做 CAS(現行有效終局 ≠ 期望值 ⇒ 拒),這是**併發正確性的本體**,不是參數美觀。
—— SECURITY DEFINER、`SET search_path=''`、EXECUTE 只給 `service_role`(逐字對照 opa12 的開權段)。
內部一交易做三件:①鎖父列 ②寫 `manual_reversal`(指向現行 manual、帶 reason 與 actor)③寫新的 `manual`(generation+1、帶新 verdict)。
守門沿用 opa12 十道的形制:actor 存在且 active(`staff`)→ reason 必填非空白 → 鎖序 → 已被沖銷拒 → row_count 守。

⇒ **員工看到的是「修改判定」一個按鈕**;沖銷、generation、兩列寫入全在 RPC 裡面,員工不需要知道。

---

## §3 驗收條件(每條 yes/no,且每道守門都要有「拿掉就紅」的負測)
1. 正:對一筆已有 `manual` 的 refund 呼叫 RPC ⇒ 兩列寫入、舊 manual 仍在、新 manual 的 verdict 是新值。
2. 負:同一筆 manual 沖第二次 ⇒ 被 `pre_one_reversal_uniq` 擋(23505 + 索引名)。
3. 負:`p_reason` 空白 ⇒ 擋(自訂 ERRCODE + 約束名),且**零列寫入**。
4. 負:`p_actor` 不在 `staff` 或 `is_active=false` ⇒ 擋,且**在讀任何帳本資料之前**(對照 opa12 G2 的位置)。
5. 負:對**沒有** manual 的 refund 呼叫 ⇒ 擋(不是靜默建一筆)。
6. 結構:三欄純加法、既有約束一條都沒被動到、零直權面(表級 + 欄級兩本帳)。
7. 並發:兩個交易同時沖同一筆 ⇒ 只有一個成功(鎖父列 + 唯一索引兩層)。
8. 回退腳本 + 回退自驗;順序依賴寫明(本片在 2d 之後)。
9. 突變:每道守門一發,**預期紅格由實跑決定**。
10. 三綠 + harness 實跑格數由 `PASS=` 回填。

## §4 rollback 與風險(v2 重寫 —— v1 的「皆純加法」是假的)

v1 寫「三欄 + 一索引 + 一 RPC,皆純加法」。**關卡1 指出不實**,本片實際動的物件是:
新增 `reverses_event_id` / `reversal_reason` / `actor` 三欄、新增 `pre_one_reversal_uniq`、
新增形狀 CHECK、新增自我 FK、**新增 terminal 有效性 trigger**、**值域加 `manual_reversal`**、
**改寫下游讀取點**(§2d)、新增一支 SECDEF RPC。⇒ 回退腳本要逐物件列、逐物件驗,順序寫死。

- **回退的資料前提**:表內已有 `manual_reversal` 列時 ⇒ **拒退**(對照 2d 的資料閘),
  因為撤掉值域會讓既有列違反新 CHECK,而那些列是「誰在什麼時候作廢了哪一筆判定」的證據。
- **順序**:本片必須先於 2d 回退(它疊在 2d 的值域與索引上)⇒ 回退鏈變成 本片 → 2d → 2c,
  而 `scripts/l5b2-2c-rollback.sql` 的順序閘白名單要同批加一個形狀(§7)。
- **風險**:①trigger 級保證的並發正確性**完全靠父列鎖** ②舊資料的 `actor` 是 NULL(本片之前沒有這個欄)
  ⇒ 新的必填約束只能對**新列**生效,舊列的「誰做的」永遠拿不回來,這是知情接受的邊界。

## §5 知情缺口
- **本片不含 UI**(§1c-1:L5b 帳本零畫面)⇒ Sean 的 UI 鐵律**這一片還兌現不了**,只能保證 RPC 的形狀讓 UI 之後接得上(一個動作、三個參數)。
- 不寫 `admin_audit_log`(沿用本線慣例);稽核靠帳本列本身 ⇒ **actor 欄是承重的**,不是裝飾。
- #417 的回退閘訊息要改指沖銷路——**那要等本片的 RPC 存在**,所以放本片收尾、不放前面。

## §6 拍板紀錄(2026-08-11 23:15,主視窗 P-521-A)

| 題 | 拍板 | 我原本推的 | 差在哪 |
|---|---|---|---|
| Q1 這片做到哪 | **B**:DB + RPC + 讀取面現在做,UI 排主線後段 | v1 推 DB+RPC only、v2 改推最小出口 | **我和關卡1 的前提都是「有真用戶等著看到變化」,而這條線還沒有正式使用者** ⇒ 前提不成立,推薦跟著錯 |
| Q2 同一筆可以被沖幾次 | **A** | A | ⚠️ **標籤有歧義,見下** |
| Q3 要不要限時 | **A**(不限時、每次留痕) | A | 一致 |

🔴 **Q2 的標籤要對一次**:我 plan 裡的 `A` 逐字是「**一次**(沿用 `order_payments` 一列最多被沖一次;
要再改就沖新的那筆=**鏈狀**)」,`B` 是「不限次數」。回信寫的是「**Q2=A(不限次)**」。
🔴 **我原本寫「兩種讀法會合流」——關卡1 R2 直接推翻**:若同一列可被沖很多次,
`pre_one_reversal_uniq`、§2c 的「已沖銷拒」、§3-2、§3-7 的第二層保證、以及 CAS **全部會塌**
(CAS 本來就不允許再沖一個已失效的事件),而多筆沖銷只會折成同一個結果、卻留下互相衝突的稽核列。
⇒ **兩種讀法不相容**,不能靠「照合流讀法做」蒙混。
**新代開工第一件事:跟主視窗確認 Q2 的真意**(我的 A=一列最多被沖一次+鏈狀;回信字面=不限次)。
本 plan 目前照「一列一次 + 鏈狀」寫;若答案是另一種,§2a/§2c/§3 要重寫。

## §7 🔴 這片會作廢哪些**已經被逐字釘死**的字面(落筆前先建的清單,不是收尾才想)

`manual_reversal` 一旦進 `pre_event_type_chk` 的值域,**七值那個字面就過期**。而那個字面在本 repo 是**被逐字釘死**的
(這正是 2c/2d 兩片對抗審查逼出來的形制)⇒ 動它會連鎖到下列每一處。清單用 grep 建,不是憑印象列:

**數法**:`grep -rn "reconcile''::text, ''manual" supabase/ scripts/`(SQL 側的 `pg_get_constraintdef` 形式)
+ `grep -rn "'sent','result_success'" scripts/`(harness 側的 DDL 形式)。

| 檔案 | 命中數 | 那裡釘的是什麼 |
|---|---|---|
| `supabase/migrations/20260811080000_*(2c)` | 1 | 2c 的**前置閘 pre-image**(它釘的是 2c 之前的六值,**不受本片影響**——列出來是為了證明我查過) |
| `supabase/migrations/20260811110000_*(2d)` | 2 | 2d 的前置閘(六值,不受影響)+ **post assert 的逐字 catch-all(七值 ⇒ 會過期)** |
| `scripts/l5b2-2d-rollback.sql` | 3 | 前置閘的 **2d post-image pin**(七值)、冪等分支的逐字驗、④ 回退自驗 ⇒ **三處都會過期** |
| `scripts/l5b2-2c-rollback.sql` | 2 | **順序閘的白名單**(`c_child_after_2c` / `c_child_before_2c`)⇒ 本片一上,2c 回退會判「既不是 2c 之後也不是之前」而**拒退** |
| `scripts/l5b2-2d-verify.sh` | 2(另 `result_confirmed` 共 33 處) | `reset_preimage` 的基線逐字、結構格的值域逐字 ⇒ 會紅 |
| `scripts/l5b2-2c-verify.sh` | 2 | 同上族 |

⇒ **本片的驗收條件必須包含**:上表每一處都同批更新,且**兩支 harness(2c 42 格 / 2d 37 格)重跑全綠**、
w7 收據 `record` 重跑(它們的 sha 會變)。**沒做這件事的話,症狀是「2c 的回退在災難當天拒退」** ——
那正好是 2d 花了整片去修的那種東西。

⚠️ 這張表是**落 plan 當下**用 grep 建的;實作當天要**再跑一次同樣的 grep**(中間可能有別的片再釘新字面)。

— v1,P 七代 2026-08-11 22:2x

---

## §8 關卡1(codex,2026-08-11 22:3x)逐條回應 —— 8 must-fix

| # | finding | 處置 |
|---|---|---|
| 1 | `(refund_id, generation)` 擋不住「未被沖銷的 gen=2」⇒ B 不是索引級保證 | ✅ **打掉重畫**:改 trigger + 鎖父列(§2b),並誠實寫明這是降級 |
| 2 | RPC 只收 `refund_id` ⇒ 兩交易同時修正會各改各的 | ✅ 加 `p_expected_event_id` 做 CAS(§2c) |
| 3 | `manual_reversal` 是不是 terminal 沒定義 | ✅ 明定**不是** terminal(§2b-4) |
| 4 | 「三欄對稱」逼新 manual 的 actor 為 NULL,與「actor 承重」矛盾 | ✅ 拆開約束(§2a-3) |
| 5 | 下游讀取面仍會把被沖掉的 manual 當有效 | ✅ **新增 §2d 整節**,並列入射程與驗收 |
| 6 | §7 清單只有值域字面,漏 append-only / verdict CHECK / `pre_one_success_uniq` / 回退資料閘 | ✅ 併進 §4 與 §7 的驗收要求 |
| 7 | §4 宣稱「皆純加法」不實 | ✅ §4 整節重寫,逐物件列 |
| 8 | Q1 的推薦(DB+RPC only)等於凍契約卻不解決問題 | ✅ **推薦改掉**:改推「最小出口」,理由寫在 §6 |

**判停**:8 條全成立、全折;但其中兩條(#1 機制、#8 範圍)是**把 plan 的核心換掉**,不是收緊 ⇒
照紀律先把決策題送上去,**Q1 沒回之前不進實作**。

---

## §9 關卡1 R2(2026-08-11 23:2x)8 findings 逐條

| # | finding | 處置 |
|---|---|---|
| 1 | 保留 `pre_one_terminal_uniq` 與 trigger 方案**自相矛盾**(舊 manual 仍佔索引 ⇒ 新 manual 必撞;trigger 繞不過索引) | ✅ **§2b 改**:該索引本片 `DROP`,唯一性全交給 trigger;爆炸半徑寫進 §7 |
| 2 | canonical 必須選具名 **view**,不能停在「view 或片語」 | ✅ §2d-1 選定 view + owner/`security_invoker`/零 GRANT/不得 fail-open |
| 3 | `op6a` 換吃 canonical 後仍要保留**正向存在條件** | ✅ §2d-1b |
| 4 | 「被沖 manual + 有效 failed」會從 `needs_human` 翻面=**正式錢面行為改變** | ✅ §2d-1b 明列接受 + 兩格測試 |
| 5 | canonical 沒回答「有效 manual 但 `refunded=false`」算什麼 | ✅ 列為**必答項**(新代開工前確認) |
| 6 | 自我 FK 不保證同 refund / 被指的是 manual | ✅ §2a 改複合 FK + trigger 補型別 |
| 7 | `actor` CHECK 會掃舊列 ⇒ apply 失敗 | ✅ §2a 改 `NOT VALID`,並承認舊列拿不回來 |
| 8 | 「Q2 兩種讀法會合流」**不成立** | ✅ §6 撤回該說法,列為新代第一件要確認的事 |

**判停**:8 條全折進 v4,但**其中兩件不是我能拍的**——
Q2 的真意(§6)與 `refunded=false` 的語意(§2d-1b)⇒ **實作前必須先問**。
關卡1 已用滿 2 輪(R1 8 條 / R2 8 條,每輪都打掉一個核心)⇒ 不再開 R3;**v4 交給 P 八代,開工前先問那兩題**。

— v4,P 七代 2026-08-11 23:3x
