# 退款帳本 `manual` 沖銷 — 片級 plan **v8**(#405 + #417)

> **v8 = 關卡1 R2 確認輪**(2026-08-12):**3/4 通過**;唯一新提的 must-fix(「仍漏列會翻面的混合形狀」)
> **經逐值驗證後駁回** —— 它舉的三個形狀,兩個推錯、一個是已列的翻面 A(逐值表在 §11-6)。
> 但**採納其衍生建議**:apply 當下的盤點改成**全形狀盤點**(`GROUP BY` 每顆 refund 的 event_type 集合),
> 不只數自己想得到的那一種組合。**判停=收斂,不開 R3;plan 等 Sean 批准後才動手。**

> **v7 = 關卡1 R3 折完**(2026-08-12;codex `gpt-5.6-sol` high、唯讀、零留痕)。**FAIL → 2 must-fix + 1 nit,全折**:
> ① §11-4 的 A 正案例**沒釘死 fixture 的 `refunded` 值** ⇒ 用 `false` 的話,**沖銷邏輯整段拿掉那格照樣綠**(該格零判別力)。已釘成 `true`。
> ② **漏了第三個行為翻面 C**(同一顆 refund 有 `result_success` + `result_failed`):舊制 `needs_human`、新制**可結清**
>   —— 方向是「從保守變成自動結清」。已補進 §11-4 並明列接受理由 + apply 當下的盤點要求 + 三者同交易切換。
> ③ nit:四格抓不到 `COALESCE(…,true)` 被改成 `false`(NULL 路徑不可達)⇒ 補一格**定義層**結構斷言,並註明它擋的是編輯不是執行。
> 角度 1/2/3(COALESCE 方向、正向存在條件、§11-1 對 op6a 的宣稱)**審查者逐條確認無問題**。
> ⇒ **R1 FAIL ⇒ 照紀律修完要跑 R2 確認**。

> **v6 = Q-425 拍板後,述詞定稿、解除封鎖**(2026-08-12,主視窗 `P-533-A`;Sean 逐字「桌上五題 依照推薦」)。
> **Q-425=B**:有效 `manual` 且 `refunded=false` **視同 `result_failed`** —— 不算退款跡象、單子可自動結清;
> 員工看錯就用本片的沖銷改回 `true`,而 op6a 是即算函式 ⇒ 下一次呼叫立刻翻回 `needs_human`。
> ⇒ **§2d-1 的 canonical view 述詞已定稿(§11)**;§2d-1b 的必答項關閉。**下一步=關卡1**(鐵則 12①③ 不降級)。

> **v5 = P 八代開工前的實查重跑**(2026-08-11 23:4x)。只做兩件、零設計變更:
> ①**§7 的字面清單全部重跑**,結果推翻 v4 的兩個判斷(見 **§10**)——
>   v4 要我去改兩支回退腳本的逐字 pin,而那兩處 pin 是**順序閘本體**,改了等於拆守門。
> ②Q2 語意由主視窗 `P-523-A` 校正 = **每筆終局至多被沖一次、修正走鏈狀**(=v4 §6 我的 A 本義)⇒ **本文零改動**。
> ~~⏳ 仍卡一題:§2d-1b 那題送 Sean(`P-525-Q`)、未回覆前不定稿不進實作~~
>   ⇒ **v6 已解除**(Q-425=B),述詞見 §11。

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
   🔴 **v5 實查推翻了這句的後半**:兩支回退腳本的逐字 pin **不得動**(它們是順序閘本體,不是會過期的字面),
   必改的 harness 只有 `l5b2-2d-verify.sh` 一支。逐檔實查與理由見 **§10**。
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
- ✅ **已釘死(Q-425=B,2026-08-12)**:有效的 `manual` 且 `refunded=false` **視同 `result_failed`**。
  ~~舊字面:v3 沒釘、v4 列為必答項、開工前要確認~~ ⇒ **已關閉**,述詞見 **§11**。
  🔴 這是**對客金流面的行為改變**(原本這種單永遠落 `needs_human`),與 §2d-1b 上面那條翻面一起列入接受,
  並各配一格測試(§11-4)。

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
  ~~而 `scripts/l5b2-2c-rollback.sql` 的順序閘白名單要同批加一個形狀(§7)。~~
  🔴 **v5 撤回這句**:輪到 2c-rollback 執行時本片與 2d 都已退掉、值域已回六值 ⇒ 白名單本來就命中、**零改動**;
  把本片形狀加進白名單反而會重建 2c 對抗審查 R2 堵掉的死角。改為:**本片回退必須逐字還原 `pre_one_terminal_uniq`**,
  否則 2d-rollback 停在第一道閘。詳 **§10b-1 / §10c-1**。
- **風險**:①trigger 級保證的並發正確性**完全靠父列鎖** ②舊資料的 `actor` 是 NULL(本片之前沒有這個欄)
  ⇒ 新的必填約束只能對**新列**生效,舊列的「誰做的」永遠拿不回來,這是知情接受的邊界。

## §5 知情缺口
- **本片不含 UI**(§1c-1:L5b 帳本零畫面)⇒ Sean 的 UI 鐵律**這一片還兌現不了**,只能保證 RPC 的形狀讓 UI 之後接得上(一個動作、三個參數)。
- 不寫 `admin_audit_log`(沿用本線慣例);稽核靠帳本列本身 ⇒ **actor 欄是承重的**,不是裝飾。
- #417 的回退閘訊息要改指沖銷路——**那要等本片的 RPC 存在**,所以放本片收尾、不放前面。
- 🔴🔴 **第一筆沖銷寫進去之後,本片的回退就永久關閉**(v5 實查;推導在 §10c-2):
  沖銷會讓同一顆 refund 上有兩筆 `manual`,而回退必須還原的 `pre_one_terminal_uniq` 述詞含 `manual`
  ⇒ 唯一索引**物理上建不起來**(23505),除非刪掉那些 append-only 的稽核列。
  ⇒ 這不是政策而是**做不到**,apply 前要讓 Sean 知道:**這片的可回退性只存在到第一次有人用它為止**。
  ✅ **已實測**(2026-08-11 23:4x,拋棄式 PG 17.10、三格含正向對照,零留痕;複跑法見 §10c-2)。

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

~~(v4 的表已被 v5 的實查取代,見 §10。v4 表的兩個判斷是錯的:它要我去改兩支回退腳本的逐字 pin,
而那兩處 pin 正是順序閘的本體 —— 照 v4 做等於把 2c/2d 兩片對抗審查逼出來的守門拆掉。)~~

⚠️ 這張表是**落 plan 當下**用 grep 建的;實作當天要**再跑一次同樣的 grep**(中間可能有別的片再釘新字面)。
**v5 已照這句重跑,結果在 §10。**

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
| 5 | canonical 沒回答「有效 manual 但 `refunded=false`」算什麼 | ✅ 列為必答項 → **已答:Q-425=B**(§11) |
| 6 | 自我 FK 不保證同 refund / 被指的是 manual | ✅ §2a 改複合 FK + trigger 補型別 |
| 7 | `actor` CHECK 會掃舊列 ⇒ apply 失敗 | ✅ §2a 改 `NOT VALID`,並承認舊列拿不回來 |
| 8 | 「Q2 兩種讀法會合流」**不成立** | ✅ §6 撤回該說法,列為新代第一件要確認的事 |

**判停**:8 條全折進 v4,但**其中兩件不是我能拍的**——
Q2 的真意(§6)與 `refunded=false` 的語意(§2d-1b)⇒ **實作前必須先問**。
關卡1 已用滿 2 輪(R1 8 條 / R2 8 條,每輪都打掉一個核心)⇒ 不再開 R3;~~v4 交給 P 八代,開工前先問那兩題~~
**兩題皆已答**(Q2 語意=`P-523-A` 校正、Q-425=B=`P-533-A`)⇒ **v6 進關卡1 審實作前 plan**。

— v4,P 七代 2026-08-11 23:3x

---

## §10 §7 清單的**實查重跑**(v5,P 八代 2026-08-11 23:4x)—— 並推翻 v4 的兩個判斷

v4 §7 結尾自己寫了「實作當天要再跑一次同樣的 grep」。跑了,結果與 v4 的表**不一致**,
而且不一致的方向是**危險的那一邊**(v4 要我去拆守門)。

**數法(三條,可複跑)**:
```
grep -rn "reconcile" supabase/migrations/ scripts/ | grep -i manual
grep -rn "pre_one_terminal_uniq" --include='*.sql' --include='*.sh' supabase/ scripts/
```
第三條不是命令:**逐檔開來讀該行的上下文**。v4 的錯全部出在只看命中數、沒看那一行在做什麼。

### 10a 逐檔性質與處置

| 檔案(命中行) | 那一行的性質 | 本片動不動 |
|---|---|---|
| `20260810140000:132`(L5b-1 建表) | 六值原始 DDL | ❌ 已 apply 的歷史,不得動 |
| `20260811080000:174`(2c) | 2c 前置閘 pre-image | ❌ 同上 |
| `20260811110000:100 / :188 / :239 / :250-255`(2d) | 前置閘六值 + 值域 DDL 七值 + post assert 逐值/逐字 | ❌ 同上。**重放一律按時序**,本片是 `130000`、排在它後面 ⇒ 2d 求值時看到的仍是它自己的 pre/post-image,**不會過期** |
| `scripts/l5b2-2d-rollback.sql:56-58 / :60-79 / :86-101` | 前置閘 + 冪等分支 + post-image 逐字 pin | ❌ **不得動、更不得放寬**(理由 10b-2) |
| `scripts/l5b2-2c-rollback.sql:57-68` | 順序閘白名單(兩個合法形狀) | ❌ **不得動**(理由 10b-1) |
| `scripts/l5b2-2d-verify.sh:140 / :238 / :416 / :424` + 19 處索引名 | 它自建合成 schema 的 pre/post 基線 | ✅ **必改**(本片唯一必改的 harness) |
| `scripts/l5b2-2c-verify.sh:122` | `strpos(constraintdef,'result_confirmed')>0` **子字串** | 免疫(值域多一個值不會紅)。v4 寫「2 命中會紅」=**高估** |
| `scripts/l5b1-verify.sh:154 / :224` | 有柵欄 `PREFIX_TS="20260810140000"`(`:51`)⇒ 2c/2d 都沒進它的庫 | 免疫。v4 **漏列**,但結論無害 |
| `w5-line-verify.sh` `w6a` `w6b1` `w6b2` `w6b3` `w6c` `w7b`(各 1) | 只在 `LINE_TIP` 註解裡,非被測面 | ✅ apply 後**重釘錨**,照 2d 的老規矩 |

### 10b 🔴 v4 §7 錯的兩條(方向都是「拆掉守門」)

**(1) 「2c 回退的順序閘白名單要同批加一個形狀」= 錯,而且照做會重建死角。**
那道白名單(`l5b2-2c-rollback.sql:57-68`)只認兩個形狀:2c post-image 與 2c pre-image,**兩者都是六值**;
它的職責逐字是「本檔只准跑在『子表恰好是 2c 之後、沒有任何後續片』的庫上」(`:70-79`)。
回退鏈是 **本片 → 2d → 2c**:輪到 2c-rollback 時,本片與 2d 都已退掉、值域已回六值
⇒ **白名單本來就會命中,零改動**。
反過來,把本片的八值形狀加進白名單 = **允許 2c-rollback 在本片還活著時執行**
= 正好重建 2c 對抗審查 R2 must-fix 當初堵掉的那個死角(`:74-78` 寫了它長什麼樣)。

**(2) 「2d-rollback 三處會過期」= 錯。**
那三處逐字 pin 是 **fail-closed 的順序保證**:本片還在時它會拒退,並印出
「有別的片在 2d 之後動過值域或索引述詞…盲目往下會把那些改動無聲吃掉」(`:99-101`)。
那正是**正確行為**,不是過期。改掉它 = 拆掉 `:86-90` 那段註解花整段解釋的保護。

**兩條的共同形狀**:回退腳本的逐字 pin **不是「會過期的字面」,是順序閘本體**。
v4 把它們和 harness 基線混成同一類 —— 而 harness 基線該改、順序閘不該改,方向相反。

### 10c 🔴 本片回退腳本的兩條硬約束(v4 沒寫,是這次實查逼出來的)

1. **本片回退必須把 `pre_one_terminal_uniq` 逐字還原**。
   `l5b2-2d-rollback.sql:56-58` 的第一件事就是 `IF v_def IS NULL OR v_pred IS NULL THEN RAISE`,
   而 `v_pred` 正是該索引的 `pg_get_indexdef`。本片 `DROP` 它(§2b-1)⇒ 回退若沒建回來,
   **2d-rollback 會停在第一道閘**,整條鏈斷在第二棒。還原形狀必須逐字等於
   `l5b2-2d-rollback.sql:96-98` 釘的 2d post-image(述詞 = `result_confirmed / result_failed / manual`)。

2. 🔴🔴 **「已有 `manual_reversal` 列就拒退」的理由,v4 寫的那個不是最硬的**。
   v4 §4 寫「撤掉值域會讓既有列違反新 CHECK」。更硬的是:沖銷發生過 ⇒ 同一顆 refund 上
   **有兩筆 `manual`**(舊的 + 替代的)⇒ 而 `pre_one_terminal_uniq` 的述詞含 `manual`
   ⇒ 上一條要求的「原樣還原」**在物理上建不起來**(23505)。
   除非同時刪掉那些帳本列 —— 而它們是 append-only(`20260810140000:154-162`、`:183-184`)
   且正是「誰在什麼時候作廢了哪一筆判定」的稽核證據。
   ⇒ **拒退不是政策選擇,是做不到**;而且這表示 **第一筆沖銷一旦寫進去,本片的回退就永久關閉**。
   這件事屬 §5 知情缺口,要在 apply 前讓 Sean 知道,不能只寫在回退腳本的註解裡。

   ✅ **這條不是推導,是實測**(2026-08-11 23:4x;拋棄式 PG 17.10 叢集,跑完即刪、`git status --porcelain` → 0):
   建最小帳本(同形狀 CHECK + append-only trigger)→ 造出「舊 `manual` + `manual_reversal` + 替代 `manual`」
   三列同一顆 refund → 用 2d post-image 的逐字述詞重建 `pre_one_terminal_uniq`:
   | 格 | 結果 |
   |---|---|
   | ① 重建索引 | **SQLSTATE 23505** `could not create unique index` |
   | ② 唯一解法=刪掉那些列 | **SQLSTATE P5B01**(append-only trigger 擋住) |
   | ③ 🔴 正向對照:同一道索引、只剩一筆 `manual` | **建得起來** ⇒ ① 不是「索引本身寫壞了」的假象 |
   ⚠️ 第三格是這個 probe 的判別力來源;沒有它,① 只證明「有東西擋住」而證不出**是沖銷擋住的**。

### 10d 還沒做的

- ~~§2d-1b 那題仍在等 Sean~~ ✅ **已答:Q-425=B**(2026-08-12,`P-533-A`)⇒ 述詞已定稿於 **§11**。
- 本節只重跑了 §7 的**字面清單**;`l5b2-2d-verify.sh` 那 19 處索引引用要逐處改成什麼,屬實作當天。

— v5,P 八代 2026-08-11 23:4x

---

## §11 canonical view **述詞定稿**(v6;Q-425=B 之後)

### 11-1 先講一件實查到的既存落差(不是本片造成的,但本片必須處理)

`op6a`(`20260811030000:148-153`)用的兩個集合是 **2d 之前**的:

| 集合 | op6a 現行字面 | 2d 之後的真相(`20260811110000:200-201`,已 apply) |
|---|---|---|
| 終局 | `('result_success','result_failed','manual')` | **`('result_confirmed','result_failed','manual')`** |
| 「錢動過」 | `('result_success','manual')` | 見 11-2 |

⇒ **`result_success` 已經不是終局**(2d 逐字:「受理成功不代表錢已經退出去」,`:191-192` COMMENT)。
現況 op6a 對一顆只有 `result_confirmed` 的 refund **認不出它的終局** ⇒ 落 `needs_human`。
**結果碰巧是安全的**(保守),但**理由是錯的** —— 它不是「認出錢動過」,是「什麼都沒認出來」。
本片換吃 canonical view 時**一併修掉**;這是修既存 drift,不是本片新增行為。

### 11-2 定稿述詞

**有效終局**(canonical)= `event_type ∈ ('result_confirmed','result_failed','manual')`
**且** 沒有任何 `manual_reversal` 列的 `reverses_event_id` 指向它。

**該有效終局是否代表「錢動過」**(`indicates_refund`)—— **Q-425=B 的落點就在這一欄**:

| 有效終局 | `indicates_refund` | 依據 |
|---|---|---|
| `result_confirmed` | **true** | 確認退款成功 |
| `result_failed` | **false** | 退款失敗、錢沒動 |
| `manual` + `refunded=true` | **true** | 人工判定「有退成」 |
| `manual` + `refunded=false` | **false** | 🔴 **Q-425=B**:與 `result_failed` 一視同仁 |
| (沒有有效終局) | — | **不得除外**(§11-3) |

```sql
-- 述詞本體(view 的兩欄)
e.event_type IN ('result_confirmed','result_failed','manual')                    -- 是不是終局
AND NOT EXISTS (SELECT 1 FROM public.payment_refund_events r
                 WHERE r.refund_id = e.refund_id
                   AND r.event_type = 'manual_reversal'
                   AND r.reverses_event_id = e.id)                               -- 沒被沖掉

-- indicates_refund(🔴 fail-closed:判不出來一律當「錢動過」)
COALESCE(
  e.event_type = 'result_confirmed'
  OR (e.event_type = 'manual' AND (e.record_snapshot -> 'refunded') = 'true'::jsonb),
  true)
```

🔴 **`COALESCE(…, true)` 的方向是刻意的**:`indicates_refund=true` ⇒ 算跡象 ⇒ `needs_human` ⇒ **保守**。
若寫成 `COALESCE(…, false)` 就是 fail-**open**:判不出來 ⇒ 當作沒退 ⇒ **自動結清一張可能已退錢的單**。
(本 repo 的通例是 `COALESCE(…, false)`——**那是給 CHECK 用的**,因為 CHECK 的 false 才擋得住;
這裡是判定式,兩者的安全方向相反,**不可照抄**。同族 memory `reference_pg-check-passes-on-null-use-coalesce-false`。)
⚠️ 實務上 `manual` 列的 `refunded` 由 2c 的 `pre_manual_needs_verdict_chk`(`20260811080000:356-359`)保證是 boolean
⇒ NULL 分支**構造不出來**(除非那道 CHECK 被拿掉)。**它是縱深,不是主守門** —— 這句要寫進註解,
否則下一個人會以為它有被測到(同族 memory `feedback_negative-test-observation-supplied-by-another-mechanism`)。

### 11-3 op6a 換吃 canonical 之後的**正向存在條件必須保留**(關卡1 R2 F3)

```
除外(不算退款跡象) ⇔ EXISTS(該 refund 的有效終局)
                    AND NOT EXISTS(該 refund 的有效終局 且 indicates_refund)
```

- **左半不能省**:少了它,「零有效終局」(例如只有 `sent` 或只有 `result_unknown`,兩個最危險的未知態)
  會被空集合當成「全 failed」而除外 —— 這正是 op6a `:141-145` 註解記載的 Fable F5。
- 兩個 EXISTS 都吃 canonical view,**不得再自己問「有沒有 manual」**。
- 雖然 trigger 保證至多一列有效終局,**述詞仍寫成 EXISTS 對**:它不依賴那個保證,
  trigger 萬一被繞過也不會翻成 fail-open。

### 11-4 本片因此要接受的**兩個行為翻面**(各配一格測試)

| # | 情境 | 舊 | 新 | 測試 |
|---|---|---|---|---|
| A | 被沖銷的 `manual`(🔴 **該筆 `refunded` 必須是 `true`**)+ 有效的 `result_failed` | `needs_human` | 可結清 | 正:翻面成立;負:**替代 manual(refunded=true)存在時不得翻面** |
| B | 有效 `manual` + `refunded=false`(**Q-425=B**) | `needs_human`(永遠) | 可結清 | 正:可結清;負:**改成 `refunded=true` 後必須翻回 `needs_human`** |
| **C** | **同一顆 refund 有 `result_success` + `result_failed`**(受理成功、後來對帳判定失敗) | `needs_human` | **可結清** | 正:可結清;負:把 `result_failed` 換成 `result_confirmed` ⇒ 必須 `needs_human` |
| — | 零有效終局(只有 `sent`/`result_unknown`) | `needs_human` | **不變** | 負:仍 `needs_human`(守 11-3 的左半) |

🔴 **A 的 fixture 為什麼必須把被沖銷那筆釘成 `refunded=true`(關卡1 R3 must-fix,成立)**:
若 fixture 用 `refunded=false`,則**拿掉 (a) 的整段 `NOT EXISTS`(=沖銷完全失效)之後**——
那筆 manual 重新變成有效,但它的 `indicates_refund` 仍是 `false` ⇒ **照樣可結清、該格照樣綠**。
⇒ 這一格就證明不了「沖銷有沒有在運作」。釘成 `true` 之後,沖銷失效時它會翻成 `needs_human` ⇒ 紅。
(同族 memory `feedback_fixture-value-makes-guard-vacuous` 與
`feedback_negative-test-observation-supplied-by-another-mechanism`。)

🔴 **C 是關卡1 R3 抓出來的第三個翻面,v6 漏了(must-fix,成立)**。逐值走一次:
- **舊 op6a**:第一個 EXISTS 認 `('result_success','result_failed','manual')` ⇒ true;
  第二個 `NOT EXISTS ('result_success','manual')` ⇒ 因為有 `result_success` 而為 **false**
  ⇒ 除外條件 `true AND false` = false ⇒ **算跡象 ⇒ `needs_human`**。
- **新述詞**:有效終局集合 `('result_confirmed','result_failed','manual')` **不含 `result_success`**
  ⇒ 有效終局 = `result_failed` ⇒ `indicates_refund=false` ⇒ **除外 ⇒ 可結清**。
⇒ **方向是「從保守變成自動結清」**,必須明列接受,不能讓它從縫裡溜過去。
**為什麼接受**:2d 已經拍板「受理(`result_success`)≠ 確認(`result_confirmed`)」
(`20260811110000:191-192` COMMENT 逐字),`result_success` 本來就不該再被當終局;
舊 op6a 把它當終局是 **2d 之前的字面**(§11-1 的既存 drift)。新語意才是對的。
⚠️ **但這使本片的射程包含「修一個既存 drift 且該修正會讓某些單自動結清」** ——
apply 檢查表要明列這條給 Sean,與「回退永久關閉」同一格。
**遷移安全**:view / trigger / op6a 三者**必須在同一支 migration、同一交易內切換**(關卡1 R3 修法,採納);
落庫前先跑一次**全形狀盤點**(對每顆 refund 算它的 `event_type` 集合、`GROUP BY` 列出每種組合各幾顆;
**不只數 `success+failed` 這一種**,理由見 §11-6)——
現況正式庫該表 **0 列**(§11-5),所以今天是 0,但 **2e/2f/2g 上線後就不是**,
⇒ 這條盤點要放進 **apply 當下**而不是寫 plan 當下。

🔴 **B 的負測是本片最重要的一格**:它同時驗「沖銷真的改得了判定」與「op6a 真的即時重算」——
Sean 選 B 的整個安全網就是這一條回頭路,**它沒被測到 = B 的風險論證是空的**。

🔴 **一格結構斷言(關卡1 R3 nit,採納)**:上面四格**抓不到** `COALESCE(…, true)` 被改成 `false`
—— 因為 2c 的 verdict CHECK 讓 NULL 路徑**不可達**(§11-2 已寫明它是縱深不是主守門)。
⇒ 補一格**定義層**斷言:`pg_get_viewdef` 逐字含 `, true)` 那一段。
它證明不了行為(不可達的東西沒有行為),但它擋得住「有人順手把方向改成 fail-open」。
**不得**把這格說成「fail-open 已被測試擋住」——它擋的是編輯,不是執行。

### 11-5 零回溯風險(落筆當下實查)

正式庫 `payment_refund_events` / `payment_refunds` / `order_refunds` **三張表皆 0 列**
(2026-08-11 唯讀 SELECT 實跑,專案 `bmpnplmnldofgaohnaok`)⇒ 上述行為改變**不影響任何既有資料**,
純粹是定未來的語意。⚠️ 這是**當時**的觀察;apply 前要重查一次(它會從 0 變成非 0——2e/2f/2g 就是寫入面)。

### 11-6 關卡1 R2(確認輪)—— 3/4 通過,唯一新提的 must-fix **經逐值驗證後駁回**

R2 說「仍漏列會翻面的混合形狀」,舉三個。**我逐值走過,兩個推錯、一個是已列的 A**:

| R2 舉的形狀 | 舊 op6a | 新述詞 | 判 |
|---|---|---|---|
| 只有 `result_success` | 第一個 EXISTS=true(它把 success 當終局)、第二個 `NOT EXISTS('result_success','manual')`=**false** ⇒ 除外=false ⇒ **算跡象 ⇒ `needs_human`** | **零有效終局**(集合不含 `result_success`)⇒ §11-3 左半 `EXISTS(有效終局)`=**false** ⇒ 不除外 ⇒ **算跡象 ⇒ `needs_human`** | ❌ **不翻面**。這正是 §11-3 正向存在條件在做的事 —— 而 R1 的角度2 是**同一位審查者自己確認過**的 |
| `result_unknown` + `result_failed` | 第一個 EXISTS=true(有 failed)、第二個 NOT EXISTS=true ⇒ 除外=true ⇒ **可結清** | 有效終局=`result_failed` ⇒ `indicates_refund=false` ⇒ **可結清** | ❌ **兩制相同,不翻面** |
| 有效 `manual` + `result_failed` | — | — | ⚠️ **構造不出來**(2d 的唯一索引、本片之後的 trigger 都保證同一顆 refund 至多一個**有效**終局);唯一能成立的變形是「被沖銷的 manual + 有效 failed」=**已列的翻面 A** |

⇒ **駁回這條 must-fix**。依據=P 七代交接的教訓逐字「審查者給的事實要先驗再動手」
(R3 的 F1 照改反而弄壞 `l5b1-verify`),以及 memory `feedback_verify-subagent-function-behavior-before-decision-question`。

🔴 **但採納它的衍生建議(nit 級,便宜且更穩健)**:apply 當下的盤點**不要只數 `success+failed` 一種組合**,
改成**全形狀盤點** —— 對每顆 refund 算它的 `event_type` 集合,`GROUP BY` 後列出每種組合各幾顆。
理由:我上面能逐值走完是因為**形狀數量小**;真到 apply 那天,只數自己想得到的那一種
=「拿枚舉當窮舉」(同族 memory `feedback_claim-scope-exceeds-fact-three-shapes` 的「枚舉寫下即過期」)。
全形狀盤點的成本一樣,而且**它會把我沒想到的組合自己吐出來**。

**判停**:R2 三條通過 + 唯一新條經驗證不成立 ⇒ **收斂**,不開 R3。

— v6,P 八代 2026-08-12 00:5x
