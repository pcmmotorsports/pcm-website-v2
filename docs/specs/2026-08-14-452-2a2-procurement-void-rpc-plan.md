# 片 2a-2 plan:採購作廢 RPC(`#452` 案 E 下半)

> # 🏁 v3 = C 案瘦身版(2026-08-14)
>
> **Sean 拍 `Q-452-換路` = C:只做「作廢」,「取消作廢」不做。**
> 他複製了警告行一起回 ⇒ **知情推翻 08-13「要能取消撤銷」那個拍板**(交接檔 `docs/handoff/2026-08-14-morning-window-rotation.md:67-69`)。
>
> **瘦身結果(先數後刪,數法與逐格判定在 `/Users/sean_1/pcm-mailbox/D-901-STOP.md`,主視窗 `D-902-A.md` 複驗背書)**:
> **46 格 → 35 格**(消失 11:突變靶 7 + 正面格 4),**再加 1 發新探針 = 36 格**。
>
> 🔴 **刪掉的東西一律用刪除線留在原地、不清場** —— 日後若要補回 unvoid,這些刪除線是唯一的地圖
> (Q-D1=A 的裁決理由,`D-902-A.md:18`)。**看到刪除線 = 「C 案下不做」,不是「做錯了」。**
>
> 🔴 **整包消失的五個設計**:`C1 advisory lock` / `U6` 總量重驗 / `U7` 兄弟列 /
> 冪等的「產物驗證」那一半 / §8.6 競態例外。**每一個都在原處留了為什麼死。**

> **本檔只是 plan。零 code、零 migration 執行、零正式庫連線。**
> 上游 = `docs/specs/2026-08-13-procurement-undo-plan.md`(母 plan,案 E 已由 Sean 08-13 `q1: a` 拍板)。
> 前一片 = 2a-1 schema,`supabase/migrations/20260813120000_m4b_e10_452_procurement_void_schema.sql`,
> **已 apply 正式庫**(2026-08-13 深夜,Sean 當面按;台帳 `supabase/APPLIED.tsv:187` = `20260813120000` / sha256 `6781c355…`。
> ⚠️ `STATUS.md:10` 也記著同一件事,但 STATUS 主表會滾動 ⇒ **以 `APPLIED.tsv` 為準,別釘 STATUS 的行號**)。
> 開工令 = `/Users/sean_1/pcm-mailbox/D-801-A.md`。片型 = **高風險片**(鐵則 12 ①錢的額度 + ③DB 寫入面與 ACL)⇒ 對抗審查不降級、Sean 批准才實作。
> 內容分級:RPC 非內容,不適用 L1/L2/L3。
>
> ## 字面來源標記法(全檔通用)
> - `檔案:行號` = **本 worktree(`/Users/sean_1/pcm-procure-void`,branch `procure-void` = dev `1a65b46b`)當場 `sed`/`grep` 讀到的字面**。
> - ⚠️ **例外(R1 important 折)**:`/Users/sean_1/pcm-mailbox/D-704-STOP.md` 與 `附件-D-*.md` **不在 repo 內**,實體在 `/Users/sean_1/pcm-mailbox/`。
>   全檔凡引這兩族一律當**絕對路徑**讀,不適用上面那條 repo-relative 規則。
> - 「**我推的**」= 我的推論,尚無觀察。
> - 「**已觀察**」= 前一片在拋棄式 PG 17.10 上實跑過,出處寫在該句。
> - 🔴 **我沒有連線正式庫**(見 §7 G1)。本檔所有「現況」都是 repo 檔案 + 2a-1 交接的字面,不是正式庫實查。

---

## §0 這一片要做什麼(三句)

1. **`admin_void_item_procurement` 一支 SECURITY DEFINER RPC**(🏁 C 案:~~`admin_unvoid_item_procurement`~~ 不做),
   形狀照 `20260811010000`(#352 甲片 `admin_record_item_receipt`,同一張表的現行寫入樣板),
   語意照 `20260807200000`(shipments 作廢樣板,母 plan §2 案 E 的來源;
   ~~`20260807210000` 復原樣板~~ 隨 unvoid 一起不用了)。
2. **它在自己的函式體內守自己那條不變式,一行都不依賴 A2b1**。
   精確版:**void 守的是「已有到貨不准作廢」(V7)** —— 理由與證明見 §2。
   ~~unvoid 重驗總量(U6)~~ 🏁 **C 案下整包消失**(§2.3 已標作廢)。
3. **同一支 migration 另補兩個相鄰 writer 對 voided 列的分流**(`admin_upsert_item_procurement` = A5a、
   `admin_record_item_receipt`)—— 它們與本片是**同一個 apply 單位**,理由見 §3(Q-P2 已裁 A,見 §8.1)。

---

## §0.5 🔴 動手前的硬前置(R1 MF-12 折)

🏁 **Q-S1 已於 2026-08-14 由 Sean 拍板 = A**(逐字「當成全新的一筆收下來,舊的作廢紀錄留著查帳」)⇒ **此硬前置已解除。**
🔴 **R3 折:v2 這裡還寫著「未裁定之前不得寫 code」,而 §3.2 已記已拍、§8.6 引了逐字**
   ⇒ **同一份檔裡同一題同時是「未裁硬前置 / 排隊中 / 已拍定」三態 = 殭屍題**(memory 明文警告的形狀)。
它決定的兩件事現在都有答案:①A5a 的 migration 內容 ②`scripts/452-verify.sh:197` B5 的新期望值(`CREATED`)。
~~③U7 與 A5a 的併發合約(§2.4,已定案 C1)~~ 🏁 **C 案下不存在**(沒有 unvoid 就沒有那條死結)。
🏁 **硬前置全部解除,無殘留阻塞。**
~~⚠️ **Q-S2**(unvoid 被擋時的人話出口)未裁~~ 🏁 **隨 C 案自動作廢** —— 沒有取消作廢就沒有那一題
(交接檔 `docs/handoff/2026-08-14-morning-window-rotation.md:70` 逐字)。

---

## §1 現況(逐條實查,附出處)

| # | 事實 | 出處(當場實讀) |
|---|---|---|
| F1 | `order_item_procurement` 有 `voided_at timestamptz` / `void_reason text` 兩欄 | `20260813120000:342-343` |
| F2 | 配對 CHECK `order_item_procurement_void_pair`:`(voided_at IS NULL) = (void_reason IS NULL) AND (void_reason IS NULL OR NOT pcm_b2_is_blank(void_reason))` | `20260813120000:348-350` |
| F3 | 業務鍵已從 UNIQUE 表約束換成**同名 partial unique index** `WHERE voided_at IS NULL` | `20260813120000:377-381` |
| F4 | 該索引註解逐字:「作廢後對同一家供應商重下單**不得撞鍵**」 | `20260813120000:383-385` |
| F5 | A2b1 的採購 SUM 已帶 `AND p.voided_at IS NULL` | `20260813120000:437-440` |
| F6 | A4a 的 **ordered 軸** SUM 已帶 `AND p.voided_at IS NULL` | `20260813120000:492-495` |
| F7 | 🔴 A4a 的 **instock 軸**走 receipts JOIN,**沒有** `voided_at` 述詞 | `20260813120000:497-500` |
| F8 | A2b1 早退條件 = `TG_OP='UPDATE' AND NEW.order_item_id = OLD.order_item_id AND NEW.allocated_quantity <= OLD.allocated_quantity → RETURN NULL` | 現行權威 `20260813120000:418-422`;原始 `20260803130000:125-129` |
| F9 | A2b1 trigger = `AFTER INSERT OR UPDATE ON public.order_item_procurement`,**無欄位清單** ⇒ 任何 UPDATE 都發火,是**函式自己早退** | `20260803130000:176-179` |
| F10 | A2b1 的總量式 = `IF v_alloc > v_qty - v_cancelled THEN RAISE`(`>` 不是 `>=`,恰好用滿合法) | `20260813120000:447` |
| F11 | 🔴 摘要表 C5 = `CONSTRAINT oiqs_instock_le_ordered CHECK (instock_quantity <= ordered_quantity)` | `20260730150000:113` |
| F12 | 摘要表 C4 = `oiqs_ordered_le_quantity CHECK (ordered_quantity <= quantity)` | `20260730150000:108` |
| F13 | A4a 重算 trigger = `AFTER INSERT OR UPDATE OR DELETE ON public.order_item_procurement`,**無欄位清單**,`DEFERRABLE INITIALLY IMMEDIATE` ⇒ 只改 `voided_at` 的 UPDATE **也會**發火 | `20260803140000:409-412`;R2 亦逐字確認(`/Users/sean_1/pcm-mailbox/附件-D-2a1-R2換模型-findings.md:125`) |
| F14 | `received_quantity` 直寫守門 `pcm_a4a_received_quantity_guard` 只在 `received_quantity` 真的變動時 RAISE ⇒ **不擋** void/unvoid | trigger 宣告 `20260803140000:404-406`;**真正的「只有值變才擋」在 `:195-213`**(nit 折:v1 寫「+ 該函式體」不符本檔自訂的精確行號規則) |
| F15 | 採購列 CHECK `order_item_procurement_received_range CHECK (received_quantity BETWEEN 0 AND allocated_quantity)` | `20260729020000:76-77` |
| F16 | A5a 的存在性分流 = `SELECT * FROM order_item_procurement WHERE order_item_id=… AND supplier_id=… FOR UPDATE`,**看不到 `voided_at`** | `20260806200000:313-319` |
| F17 | A5a 撞鍵時比對名字 `IF v_con IS DISTINCT FROM 'order_item_procurement_business_key' THEN RAISE;` ⇒ 唯一**索引**違反時 `CONSTRAINT_NAME` 回索引名、名字相同故仍認得(2a-1 **已觀察**,`/Users/sean_1/pcm-mailbox/D-704-STOP.md:15-19`) | `20260806200000:434-437` |
| F18 | `admin_record_item_receipt` 步 5 鎖採購列後**不看 `voided_at`** | `20260811010000:140-146` |
| F19 | 同表現行寫入樣板的鎖序 = `procurement 列 → order_items`,兩者皆 `FOR NO KEY UPDATE`(`FOR UPDATE` 與 FK 的 KEY SHARE 死結,A2b1 實測) | `20260811010000:216-229` |
| F20 | 同表現行冪等紀律逐字:「**凡是讀『會在兩次呼叫之間改變的狀態』的守門,都必須排在冪等判斷之後**」 | `20260811010000:155-156` |
| F21 | repo 已有「**用稽核帳當冪等帳本**」的先例(不另開表):A6 以 `action + request_id` 查、再比對 payload | `20260802150000:170-173` |
| F22 | shipments 樣板:「已作廢再作廢」**刻意不做 no-op**、一律人話拒絕(第二次帶的是另一個理由,吞掉 = 丟稽核) | `20260807200000:39-43`(理由)、`:106-110`(實作) |
| F23 | shipments unvoid 樣板的前緣守門形狀(算式 + 人話 + 兩條出路) | `20260807210000:118-146` |
| F24 | 新 RPC 的 ACL 慣例 = `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role` 後只 `GRANT EXECUTE … TO service_role` | `20260810233000:466-474` |
| F25 | `pcm_b2_is_blank` 對三個應用 role `REVOKE ALL` ⇒ 配對 CHECK 在**三個應用 role 直寫**時會噴權限錯;走 owner SECDEF 則可寫(母 plan §3-1b **已觀察**)。⚠️ R1 折:原寫「**只有** owner SECDEF 可寫」過強 —— owner 直接 DML 與其他特權路徑一樣寫得進(§7 G3) | `20260805170000:56`、`:77` |
| F26 | 「全表 `voided_at` 為 NULL」= **2a-1 apply 當下**由驗收 6e 觀察到的;本 repo 目前**零 void writer**(repo 字面)。⚠️ R1 折:原句寫成「目前全表現況」與 §7 G1(未連正式庫)衝突 ⇒ **正式庫現況一律走 apply 前置閘** | `20260813120000:664-666`(收工驗收 6e);2a-1 交接 |

---

## §2 🔴 開工令 §3 那條 must-fix:守門在哪裡跑(🏁 C 案:原文「兩支各自」)

### 2.1 為什麼 A2b1 對它是零覆蓋(這是**字面**,不是推論;🏁 C 案:原文「對兩支都是」)

- trigger 會發火(F9,無欄位清單);**早退發生在函式體內**(F8)。
- void = `SET voided_at = now(), void_reason = …`;unvoid = `SET voided_at = NULL, void_reason = NULL`。
  **兩者都不動 `allocated_quantity`** ⇒ `NEW.allocated_quantity <= OLD.allocated_quantity` 恆成立
  ⇒ `RETURN NULL`,守門的③④⑤(鎖 parent / 重算 / 總量式)**一行都沒跑**。
- ⇒ **A2b1 的③鎖 parent / ④重算 / ⑤總量式,對 void 與 unvoid 的覆蓋 = 0。**
  ⚠️ **R1 important 折:不能寫「覆蓋 = 0」** —— ①隔離閘(`20260813120000:410-414`)排在早退**之前**,
  它**會跑**,兩支若在非 read committed 下被呼叫仍會被它擋。**零覆蓋的是②之後那三段。**
  這條由 D 十二代抓出、R2 逐字核過並補了第三面(void 也算)
  (`/Users/sean_1/pcm-mailbox/附件-D-2a1-R2換模型-findings.md:117-119`)。

### 2.2 void 方向:總量不變式**單調安全**,但它有另一個承重點

**證明(我推的,附可反駁的形狀 —— 這是代數論證不是計數,沒有可跑的數法;要打它就打前提)**:
A2b1 守的不變式 = `SUM(allocated WHERE voided_at IS NULL) <= quantity − SUM(cancelled)`(F10 的算式,
出處 `20260813120000:437-440` + `:447`)。前提 = A2 假設 void 只寫兩個新欄、不動 `allocated_quantity`(見 §10 A2)。
void 只把一列從「未作廢」移到「已作廢」⇒ 左式**嚴格變小或不變**,右式不動 ⇒ 不變式不可能**因 void 而**破。
⇒ **void 不需要總量重驗**;它需要重驗的是**另一條**不變式。

🔴 **R1 MF-2 折 —— 這條的前提要寫死,原句藏了它**:上面說的「右式不動」只在**同一次呼叫內**成立。
不變式本身**可能在 void 之前就已經被取消動作打破** —— 部分取消 RPC 的可取消量守門算的是
`quantity − instock − cancelled`(`20260805100000:395-405`),**沒有減去已下的採購額度**
⇒ 取消 5 件之後,原本合法的 8 件有效採購就大於 `10 − 5`。
⇒ 精確版:**void 不會製造違反,但它也不會修復既有的違反**;
   而 **unvoid 的 U6 用的是同一條算式 ⇒ 既有違反下它會正確地擋住 unvoid**(fail-closed,方向對)。
⚠️ 「取消 RPC 不減採購額度」是我從 `:395-405` 讀到的字面,**這是否為刻意設計我沒查**,不在本片範圍。

🔴 **void 真正的承重守門 = 「已有到貨就不准作廢」**,而它**不只是** Sean Q3=A 的業務政策:

| 步 | 事實 | 出處 |
|---|---|---|
| 1 | void 讓 A4a 重算(F13) | `20260803140000:409-412` |
| 2 | ordered 軸**扣掉**這一列 | `20260813120000:492-495`(F6) |
| 3 | instock 軸**不扣**(receipts JOIN 沒有 voided 述詞) | `20260813120000:497-500`(F7) |
| 4 | ⇒ **在「作廢後 instock > ordered」時**撞 **C5**(🔴 **不是每次**;兄弟採購列撐著 ordered 時不撞 —— 見下方 MF-3 折) | `20260730150000:113`(F11) |
| 5 | C5 是**裸 CHECK** ⇒ 員工看到 `SQLSTATE 23514` 與一個英文 constraint 名 | 同上 |

🔴 **R1 MF-3 折 —— 上表第 4 步原本寫成全稱句,是假的**:
C5 比的是**品項層聚合**,不是這一列。若同品項還有**兄弟採購列**撐著 ordered
(例:兄弟列 ordered=10、本列 receipts=1),作廢本列之後 `instock=1 ≤ ordered=10` ⇒ **C5 不會發作**。
⇒ 精確版:**「作廢一筆已到貨的採購」在「作廢後 instock > ordered」時吐 raw 23514,不是每次都吐。**
⇒ **這反而讓 V7 更承重,不是更不承重**:C5 只在部分情形接得住 ⇒ **不能把 C5 當這條的守門**,
   V7 必須是**直接的、無條件的**「作廢列不得有到貨」斷言,不能靠 CHECK 偶然接住。
   而 `20260811010000:190-191` 才剛逐字寫過「不靠 CHECK 兜底:那條吐 raw 23514、員工看不懂」。
🔴 **判定**:Q3=A(擋掉、叫他先撤到貨)在本片**同時是正確性守門**,不是可降級的業務規則。

### ~~2.3 unvoid 方向:總量重驗必須自己做(數量有 C4 兜底,**訊息沒有**)~~

> 🏁 **整節作廢(C 案)。以下全文保留當歷程,不執行。**
> **這一節是本次瘦身最大的一塊,而它的死法有下游後果 —— 讀了再走:**
> `U6` 消失 ⇒ **void 不【顯式、提前】取 `order_items` 鎖** ⇒ §2.4「C1 advisory lock」那條死結的**一條邊不存在**
>
> 🔴🔴 **更正(2026-08-14,codex 對抗審查抓到)**:本行原本寫「void **全程不取** `order_items` 鎖」——**那是假的**。
> `pcm_a4a_recompute_order_item_summary(uuid)` 函式體內有 `FROM public.order_items oi … FOR NO KEY UPDATE`
> (實查該函式定義第 17-19 行)⇒ **void 的 UPDATE 觸發 A4a 重算,A4a 會替它取 parent NKU。**
> ⇒ 結論(不死結)沒變、而且是**量到的**;但**理由**我寫錯了。正確的機制:
> - **量到的**:探針發④⑤ 兩個方向跑四次,`40P01` 皆 0;被擋那方等的是 `transactionid ShareLock`(採購列的列鎖)。
> - **推的**(機制解釋,未直接觀察):死結環需要「**持 parent ∧ 等索引項**」同時成立。
>   unvoid 是**先**顯式取 parent(U6)、**再**讓 UPDATE 去插索引項 ⇒ 兩者同時成立。
>   void 相反:①A4a 是在列 UPDATE **之後**才取 parent ②`voided_at` 由 NULL 變非 NULL
>   ⇒ 新列版**不再滿足** partial index 的 `WHERE voided_at IS NULL` ⇒ **void 根本不插索引項、無從等它**。
> ⚠️ 這是 memory `feedback_new-rationale-written-while-folding-a-finding-is-unverified` 的實例。
> ⇒ **C1 才跟著死**。⚠️ **順序是 `U6` 死 → `C1` 死,不是各自死。**
> 日後若補回 unvoid,**這兩件事必須一起回來**,只補 `U6` 不補 `C1` = 直接復現 `40P01`。
> 隨本節一起消失:`UNVOID_EXCEEDS_ORDERABLE` 碼、§2.5 第二個人話出口、`Q-S2` 整題、
> `MUT-U6-neg`、`MUT-U6-bnd`。

⚠️ 標題刻意不寫「唯一沒有第二道」—— 那是全稱句,而我下面自己就找到 C4 是第二道。
W3c-2 檔頭 `20260807210000:50-54` 記著同一句被跨模型審查打回的前例。

情境(`/Users/sean_1/pcm-mailbox/D-801-A.md` §3 逐字,R2 補的第三面):
A 家 3 件作廢 → B 家補 3 件(合法,A2b1 放行,2a-1 **已觀察** = `scripts/452-verify.sh:183-188` B4 格)
→ **unvoid A 家** ⇒ 有效額度 6 件、品項只有 3 件。

- A2b1 不跑(§2.1)。
- **C4 會不會兜底?** **在上面那個具體情境裡**(quantity=3、alloc 3+3)unvoid 後 ordered=6 > 3 ⇒ 撞 C4(F12)。
  ⚠️ 同 MF-3 的形狀:**這是情境結論不是全稱句** —— 額度還有餘裕時 C4 一樣不出場。
  ⇒ 🔴 **數量那一維其實有裸 CHECK 兜底,但它吐的是 raw 23514。**
  這句話我**刻意寫出來**:W3c-2 的檔頭曾把「沒有第二道」寫太強、被跨模型審查打回
  (`20260807210000:50-54` 逐字)。**精確版 = 資料不會壞,壞的是訊息;而在本 repo,訊息是驗收條件的一部分。**
- ⇒ unvoid **必須自己重算**,算式**逐字對齊 A2b1**(F10):
  `SUM(allocated WHERE order_item_id = v_item AND voided_at IS NULL) + 本列的 allocated > oi.quantity − SUM(cancelled)` ⇒ 拒絕。
  🔴 **邊界 `>` 不是 `>=`**(恰好用滿合法)—— 對齊 `20260813120000:447`。
- 🔴 **鎖**:重算前先鎖 `order_items` **NKU**,鎖序 = `procurement 列 → order_items`,
  與 `20260811010000:216-229`(F19)**逐字相同** ⇒ 不新增鎖序、不需要新的無環論證。

### 2.4 守門清單(順序 = 合約)

**`admin_void_item_procurement(p_procurement_id uuid, p_void_reason text, p_actor text, p_request_id text) RETURNS text`**

| 步 | 守門 | 失敗出口 | 依據 |
|---|---|---|---|
| ~~**V0**~~ | ~~**C1 advisory:`pg_advisory_xact_lock(...)`,必須是第一把鎖**~~ | — | 🏁 **C 案刪除,且已【實測】不需要。** C1 為 `unvoid × A5a` 的死結而設;C 案下 unvoid 不存在,而 **void 不【顯式、提前】取 `order_items` 鎖**(§2.3 已死)⇒ 環的一條邊不存在。
🔴 **不是「不取」** —— A4a 的重算 helper 在列 UPDATE **之後**仍會取 parent NKU(見 §2.3 更正段)。<br>🔴 **這不是推的** —— 探針 `docs/probes/452-2a2-void-lockprobe.sh`(2026-08-14 跑兩次,結果相同):**發⓪ 正向對照(unvoid 形狀)`40P01=1`**、**發④(void 先持列鎖)`40P01=0`**、**發⑤(A5a 先持列鎖+parent)`40P01=0`**,且④⑤ 各有 **1 個 session 實際卡在 `wait_event_type='Lock'`** ⇒ 不是「沒併發」的假綠。⇒ 假設 `A7` 已從推論變成觀察 |
| V1 | 隔離閘:非 read committed 拒收 | RAISE `P2B02` | `20260811010000:69-73` 樣板 |
| V2 | `p_actor` / `p_request_id` 形狀 | **RAISE 不給固定碼**(caller bug) | `20260811010000:86-103` |
| V3 | `p_void_reason` 空白 | RETURN `REASON_REQUIRED` | 配對 CHECK 的訊息層,`20260807200000:96-99` 樣板 |
| V4 | 鎖採購列 `FOR NO KEY UPDATE`;查無 | RETURN `PROCUREMENT_NOT_FOUND` | `20260811010000:140-146` |
| V5 | **冪等快篩(只讀,不寫帳)** —— 帳本表見 §2.4b | RETURN `DUPLICATE_REQUEST` / 內容不符 RAISE<br>~~/ 狀態已變 ⇒ `REQUEST_ID_REUSED_STATE_CHANGED`~~ 🏁 C 案刪(§2.4b 單調性段) | F20 排序紀律 + `20260810230000` 樣板 |
| V6 | 已作廢 | RETURN `ALREADY_VOIDED`(**不做 no-op**) | F22 + 母 plan §6 Q4 |
| V7 | 🔴 **已有到貨** —— **順序釘死:①先驗兩來源【一致】(不一致 ⇒ fail-loud RAISE)②再驗【非零】(非零 ⇒ RETURN)** | `HAS_RECEIPTS_UNDO_FIRST` / 不一致 RAISE | §2.2,承重。🔴 **R3 折:v2 沒定順序** ⇒ 若「非零就擋」排前面,**RAISE 分支不可達 = 死枝**(repo 紀律:負測構造不出來先懷疑它是 no-op)。負測構造法 = owner 開 `pcm_a4a.received_sync` 旗標直寫 |
| **V8** 🔴 | **帳本 INSERT** —— 🔴 **必須排在【所有 RETURN 型守門之後】**(`20260811010000:192` 逐字「此時尚未寫入任何東西 ⇒ 可以用 RETURN」)。R3 折:步表原本沒有這一步 | 撞鍵 ⇒ 比對 payload 全欄 `IS NOT DISTINCT FROM` | §2.4b fold ② |
| — | UPDATE 一列(兩欄同時寫)+ `WHERE … AND voided_at IS NULL` 防 TOCTOU;`ROW_COUNT <> 1` 拒 | RAISE | `20260807200000:115-124` |
| — | 稽核 `admin_audit_log`(`action='procurement.void'`,before/after 逐欄快照)**不包 EXCEPTION handler** | — | `20260802150000:195-198` |
| — | 成功 | RETURN `VOIDED` | — |

🔴 **V7 用兩個來源交叉**(`received_quantity` 是**機器維護的累計欄**、receipts 是明細真相):
`20260811010000:203-211` 逐字立過「讀真相表,不讀衍生值」的紀律;這裡兩個都讀、**任一非零就擋**,
是 fail-closed 而不是選一個信。⚠️ 兩者不一致本身 = 不變式破損 ⇒ **fail-loud RAISE**,不靜默選大的。

### ~~unvoid 的守門清單~~ 🏁 **整支 RPC 作廢(C 案)。下表保留當歷程,不實作。**

> 隨它消失:`U0`(C1)/ `U5` `NOT_VOIDED` / `U6` `UNVOID_EXCEEDS_ORDERABLE` / `U7` `ACTIVE_SIBLING_EXISTS` / `UNVOIDED`
> 以及 `MUT-U5` `MUT-U7` `MUT-ADV` `MUT-ADV-KEY`、正面格 `B-unvoid` `B-U7`、
> `B-concurrent` 的兩個子格(unvoid×部分取消、unvoid×A5a)。
> ⚠️ `U1`/`U2`/`U3` 不是「消失」而是**併回 void 那一支的 V1/V2/V4** —— 對應的 `MUT-V1 / MUT-U1`、
> `MUT-V2 / MUT-U2`、`MUT-V4 / MUT-U3` 三列是**縮水成一半,不是整列刪掉**。
> 🔴 **刪那三列的 unvoid 半邊時,R2/R3 折出來的「恆綠修法」必須留著**
> (比對 `CONSTRAINT` 名 / 比對 `P0001` vs 帳本表 `23514`)—— 整列刪掉會把判準一起刪掉。

**~~`admin_unvoid_item_procurement(p_procurement_id uuid, p_actor text, p_request_id text) RETURNS text`~~**

| 步 | 守門 | 失敗出口 |
|---|---|---|
| **U0** 🔴 | **C1 advisory(同 V0,必須是第一把鎖)** | — |
| U1 | 隔離閘 | RAISE `P2B02` |
| U2 | actor / request_id 形狀 | RAISE |
| U3 | 鎖採購列 NKU;查無 | RETURN `PROCUREMENT_NOT_FOUND` |
| U4 | 冪等快篩(同 V5,`op='unvoid'`;**只讀不寫帳**) | RETURN `DUPLICATE_REQUEST` / `REQUEST_ID_REUSED_STATE_CHANGED` / RAISE |
| U5 | 本來就沒作廢 | RETURN `NOT_VOIDED` |
| U6 | 🔴 **鎖 `order_items` NKU → 總量重算**(§2.3 算式) | RETURN `UNVOID_EXCEEDS_ORDERABLE` + 人話 |
| U7 | 同鍵已有**未作廢**的兄弟列(= 作廢後同一家又重下過單,partial unique 允許共存,F3/F4) | RETURN `ACTIVE_SIBLING_EXISTS` |
| **U8** 🔴 | **帳本 INSERT(同 V8,所有 RETURN 守門之後)** | 撞鍵 ⇒ 比對 payload |
| — | UPDATE 兩欄清回 NULL + `WHERE … AND voided_at IS NOT NULL`;`ROW_COUNT <> 1` 拒 | RAISE |
| — | 稽核 + RETURN `UNVOIDED` | — |

🔴 **U7 是我新增的、母 plan 沒有的一條**
(數法:`grep -n "兄弟列\|同鍵.*未作廢\|ACTIVE_SIBLING" docs/specs/2026-08-13-procurement-undo-plan.md` = **零命中**,
2026-08-14 於本 worktree 實跑)。理由:partial unique 只在「未作廢」的子集上唯一(F3)
⇒ 作廢後對同一家重下單會產生第二列(F4 的設計意圖)⇒ **unvoid 回去就會有兩列同鍵同時未作廢**,
`ROW_COUNT` 不會發現、partial unique 也不會擋(UPDATE 後才違反 —— 🔴 **會**違反,索引是唯一索引,
UPDATE 當下就撞)⇒ 實際結果是**裸 23505 + 索引名**,員工看不懂。U7 把它變成人話。
⚠️ **這條是我推的**,harness 必須有一格把它變成觀察(§5 MUT-U7 的正面格)。

🔴 **U7 的序列化機制 = C1(advisory lock)。主視窗 2026-08-14 定案,`/Users/sean_1/pcm-mailbox/D-808-STOP.md` 的裁決回信。**

### ~~這一段的完整歷程(不刪掉死掉的候選)~~ 🏁 **C 案下整段不執行,全文保留**

> 🔴 **這一整段(含 C1 逐字實作、C2 比較、四個死掉的候選、40P01 實測表)是本 plan 最貴的資產,
> 一個字都不刪。** 它回答的是「**為什麼 unvoid 這麼難**」——
> 日後有人提議把「取消作廢」加回來時,這段是他唯一的地圖:
> 他會先看到 `40P01` 是**實測**不是理論,再看到 (a)(b) 兩條直覺解都已經死過。
> 🔴 **同時要讀 §2.4 V0 那列的新探針**:C 案下 `void × A5a` 已實測不死結(⓪1/④0/⑤0)
> ⇒ **死結是 unvoid 帶進來的,不是這張表本身有問題。**

**病名 = 鎖序反轉**(R1 MF-7 抓到方向、R2 用字面釘死、D 窗探針實測)。
死結的兩條腿(**已實測**,不是推的):
- A5a(Q-S1=A 之後):存在性查詢帶 `AND voided_at IS NULL` ⇒ **查不到那筆作廢列 ⇒ 不留任何鎖**
  (`20260806200000:138-139` 逐字「`FOR UPDATE` 對**不存在的列不留任何鎖**」)
  ⇒ INSERT 寫下索引項 ⇒ A2b1 的 AFTER trigger 才去等 `order_items` NKU
- unvoid:**UPDATE 之前**就持有 `order_items` NKU ⇒ UPDATE 時去等對方未提交的索引項
⇒ 互等。**PG 實測回 `40P01`,`CONTEXT` 逐字 = `while inserting index tuple in relation
"order_item_procurement_business_key"`**(拋棄式 PG 17.10,重跑一次結果相同)。

| 候選 | 判定 | 依據 |
|---|---|---|
| ~~(a) 鎖兄弟列~~ | 🔴 **死** | 兄弟列在對方 INSERT 之前**不存在**,鎖到空氣(同一句 `:138-139`)。而我當時寫的「A5a 新建路徑靠既有 parent 鎖對齊」**方向是反的** —— A5a 的 parent 鎖在 INSERT **之後**才由 trigger 取(`20260813120000:424-428`) |
| ~~(b) 靠既有錯誤轉譯層~~ | 🔴 **死** | `pcm_b2_shipping_human_error` 只被出貨線引用,**採購線零命中**(R2 `grep -rln` 實數)⇒ 我當時給的是空頭出口 |
| ~~統一取鎖序(改 A5a 先取 parent)~~ | 🔴 **死於字面** | A5a 結構錨 `20260806200000:733-736` 逐字:「本 RPC **不得**顯式取 order_items 的 NKU 鎖(**取鎖序反轉**);拒繼續」。⚠️ 那道錨正是為了防鎖序反轉而立的,而反轉仍從**索引**那條路發生 |
| ~~讓其中一支不走 INSERT~~ | 🔴 **無活候選** | unvoid 的 UPDATE **必然**重插索引項;A5a 改成「復活那列」則直接違反 Q-S1=A |
| **C1 advisory lock** | ✅ **定案** | 見下 |
| ~~C2 unvoid 先寫後驗~~ | 🔴 **未採用**(實測可行,但代價比較輸) | 見下 |

### C1 的內容(逐字,供實作照抄)

**void / unvoid / A5a 三支,在動業務鍵之前一律先取同一把 transaction 級 advisory lock:**
```
PERFORM pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(p_order_item_id::text || ':' || p_supplier_id::text, 0));
```
- **鍵 = `order_item_id || ':' || supplier_id`**,與 partial unique index 的欄組**逐字對齊**(F3)。
- 🔴 **碰撞只造成多餘的序列化,不影響正確性** —— `hashtextextended` 是 64-bit,兩組不同業務鍵撞同一個
  hash 只會讓它們互相等一下;**唯一性仍由索引保證,advisory 只是排隊器**。
  ⚠️ **這句要寫在 code 註解裡** —— 否則下一輪審查會把碰撞當缺陷報(主視窗交辦)。
- **交易結束自動釋放**(`_xact_` 版),不需要也不得手動 unlock。
- 🔴 **A5a 那一行必須有註解說明它在防什麼**,並釘一格回歸靶:**拿掉 advisory ⇒ 必須紅**(§5.1 MUT-ADV)。

**為什麼過得了 A5a 的三道結構錨**(逐條核過字面):
`:733-736` 禁 `for no key update` —— advisory 不含該字面;
`:783` 要求 `FOR UPDATE` 恰 1 次、`:780` 要求 `FOR SHARE` 恰 1 次 —— advisory 不是 row lock,不進計數。

**實測(拋棄式 PG 17.10,A 側模擬真 A5a 的兩圈重試 `20260806200000:313-447`):**

| | 40P01 | 外露 23505 | A5a 結果 | 最終狀態 |
|---|---|---|---|---|
| 基準線(無機制) | **1** | 0 | `CREATED` | 2 列 / 1 未作廢 |
| **C1** | **0** | **0** | `UPDATED` | 1 列 / 1 未作廢 |
| 循序無 U7 | — | **1** + 索引名 | — | 仍紅 ✅ |
| 對照(拍板前形狀) | **0** | 0 | — | harness 非恆紅 ✅ |

### 為什麼不是 C2(**我原本的代價表有一格是錯的,主視窗抓到**)

我原本寫「C2 不用改 A5a」當作它的招牌優勢。**那是假的** ——
**A5a 在本片本來就要改**(Q-S1=A 要加 `AND voided_at IS NULL`,§3.2;而 Q-P2=A 把它拉進本片)。
⇒ C2 省的不是「動 A5a」,只是「在 A5a 裡多加一行」⇒ 差距小一個量級。
🔴 **這個錯的形狀 = 跨信的自我矛盾**:兩件事都是我寫的,但分別寫在兩封信裡,沒有並排過。

剩下的差距全部指向同一個方向 —— **下一個維護者看到它會怎麼想**:
- C1 看到 `pg_advisory_xact_lock` ⇒「這裡在序列化某件事」= 標準模式,認得出來。
- C2 看到 unvoid「先寫後驗」⇒「這是 bug」⇒ **我自己都寫過「每個維護者都會想把它改回去」**。
⇒ **C2 的保護力依賴「沒有人把它改回正常寫法」= 慣例,不是機制**(違反 Sean 2026-07-22 的機制優先律)。
⇒ **C1 改回去會當場死結,不是安靜地壞掉。會叫的防線 > 不會叫的防線。**

⚠️ **C2 實測是可行的**(40P01=0、外露 23505=0、最終 1 列),它輸在代價不在正確性。**留著這段是為了下一個人不用重跑。**

🔴 **動 A5a = 鐵則 12③,折完照常送審,不因為只有一行而降級。**

### 2.4b 🔴 冪等帳本:改用專屬表,不用稽核帳(R1 MF-6 折)

**原設計(F21,A6 的 `admin_audit_log` 當帳本)被打掉了,理由是字面**:
`admin_audit_log_request_id_idx` 是**普通 INDEX、不是 UNIQUE**
(`20260712210000:78`,當場實讀;同檔 `:72-78` 五條索引沒有一條 unique)。
⇒ 同一個 `request_id` 併發打**兩列不同的採購**時,兩邊的存在性查詢**互相看不到對方未提交的列**,
  兩邊都判「沒用過」⇒ **雙雙成功**。
🔴 **R2 折 —— 我原本寫「A6 逃過這一劫是因為它先鎖 `orders`」,那句只對一半**:
  `20260802150000:168` 鎖的是 **`p_order_id` 那一列** ⇒ 只有**同一張單**才序列化;
  **同 `request_id` 打兩張不同訂單時,A6 有一模一樣的洞。**
  ⇒ 精確版:**A6 不是安全的,它只是洞比較窄。** 本片不修它(不在範圍),但**不得把它寫成背書**。
  ⚠️ 這是「折 finding 時順手寫的新理由」那一族 —— 我用一個沒驗過的安全宣稱去支撐一個結論正確的新表。

**改法**:照同表既有樣板 `order_item_receipt_requests`(`20260810230000` 建、`20260811010000:169-186` 用)
新開一張 `order_item_procurement_void_requests`,`request_id` 當 **PK**(跨全表唯一),
欄位 = `request_id / op('void'|'unvoid') / procurement_id / void_reason / actor`。
寫入順序照 `20260811010000:264-286`:**先寫帳、撞鍵則比對 payload 全欄 `IS NOT DISTINCT FROM`**
(⚠️ 不可用 `=`:`void_reason` 在 unvoid 時為 NULL,`=` 會讓合法重放被誤判)。

🔴 **R2 折 ①:帳本表的表級防護我一條都沒寫,而樣板有四樣**(`20260810230000:161-170,195-199` 逐字):
  `ENABLE ROW LEVEL SECURITY`(零 policy)+ `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role`
  + 只 `GRANT SELECT TO service_role` + 兩條形狀 CHECK(`request_id`:小寫/可列印 ASCII/≤200;`actor`)。
  ⇒ **照我 v1 的字面建表 = 新表帶 PostgREST 預設可達面 = 鐵則 12②。** 四樣一樣都不能少。
  另補 `created_at timestamptz NOT NULL DEFAULT now()`(樣板有,我漏了)。

🔴 **R2 折 ②:我抄了「先寫帳」四個字,沒抄它在樣板裡站的【位置】** ——
  樣板的帳本 INSERT 在 **步 8 = 所有 `RETURN` 型守門之後**(`20260811010000:192` 逐字
  「此時尚未寫入任何東西 ⇒ 可以用 RETURN」)。
  而我的步表把 V5 排在 V6/V7 **之前** ⇒ **失敗情境很具體**:員工拿到 `HAS_RECEIPTS_UNDO_FIRST`、
  去撤了到貨、回來用**同一個 request_id** 重按 ⇒ 回 `DUPLICATE_REQUEST` ⇒ **作廢永遠做不成。**
  ⇒ 修法:**冪等【快篩】留在 V5(讀,不寫);冪等【帳】的 INSERT 移到所有 RETURN 守門之後。**
  這兩件事樣板本來就是分開的,是我把它們併成一句。

🏁 **C 案更正:帳本表的 `op` 欄刪掉。** 原設計 `op ('void'|'unvoid')` 只剩一個值,表名 `..._void_requests` 已經表達了。
   ⚠️ **payload 比對維持 `IS NOT DISTINCT FROM`,不改成 `=`** —— 它原本的理由(`void_reason` 在 unvoid 時為 NULL)
   雖然隨 unvoid 消失(V3 保證 `void_reason` 永不為 NULL),但改成 `=` 是零收益的重新論證,不動。

### ~~R2 折 ③:冪等的「產物驗證」那一半~~ 🏁 **C 案下整包消失 —— 但它的消失【有條件】,讀完再改**

🔴 **為什麼能消失**:C 案下 `voided_at` 在**所有 RPC 路徑上單調**(`NULL → NOT NULL`,永不回頭)
⇒ 原本的失敗情境(`void → unvoid → 原 request_id 重放 ⇒ 回 DUPLICATE_REQUEST 而那列其實不是作廢狀態`)
**構造不出來** ⇒ `DUPLICATE_REQUEST` 恆為真話。
單調性的依據:①本 repo `voided_at` 的 writer 零支 —— 數法 `grep -rc 'voided_at' supabase/migrations/* | grep -v ':0'`
⇒ 只有 `20260813120000` 一檔命中 35 處,**逐行看過全是註解 / `ADD COLUMN`(`:342`)/ CHECK(`:349`)/
索引述詞(`:381`)/ 讀取述詞(`:440` `:495`)/ 驗收斷言(`:571-692`),無一處寫入**(2026-08-14 實跑);
②本片新增的 writer C 案下只有 void 一支,方向只有 `NULL → now()`;
③相鄰兩個 writer(A5a / receipt)只**讀** `voided_at` 做分流,不寫它(§3.1 / §3.2)。

🔴🔴 **邊界(這句是本次瘦身唯一會反咬未來的人的地方,必須進 COMMENT)**:
單調性只涵蓋 **RPC 路徑**。**owner 直寫繞得過** —— 那是本 plan 已立案的天花板 `B-owner-bypass`,
而 memory `project_0812-sean-order-ui-workflow-and-undo-needs` 逐字記著
「**採購撤銷是刻意不做的已知債,現行唯一救濟 = 手動 SQL**」
⇒ **半夜真的有人手動 SQL 把一列 unvoid 回去,這個簡化就破了、而且是 fail-open(靜默回 `DUPLICATE_REQUEST`)。**
⇒ 函式與帳本表的 COMMENT 必須逐字寫:
> 本冪等只做「鍵在不在」,**依賴 `voided_at` 單調**。若日後補上「取消作廢」、或有人手動 SQL 解除作廢,
> **產物驗證那一半必須同批回來**,否則就是 fail-open。

隨它消失:`REQUEST_ID_REUSED_STATE_CHANGED` 碼、`V5` 的第三個出口、`MUT-LEDGER-VERIFY`。

### ~~R2 折 ③(原文,保留當歷程)~~ ——
  `20260811010000:178-181` 逐字立過「查驗式冪等:**看到鍵在 ≠ 產物存在且屬本目標**」。
  void/unvoid 是**可逆切換**,這一半特別致命:void → unvoid → 用原 `request_id` 重放
  ⇒ 回 `DUPLICATE_REQUEST`,而**那一列其實不是作廢狀態** ⇒ 呼叫端信了 = **fail-open**。
  ⇒ 修法:回 `DUPLICATE_REQUEST` 之前**必須再讀一次那一列的現況**,與帳上的 `op` 比對;
  不符 ⇒ 回一個**不同的碼**(語意 = 「這個提交編號用過,但東西後來又被改了」),不得靜默當成功。

⚠️ **代價要講**:這是本片新增的**第二個物件**(🏁 C 案:一支 RPC + 一張表;原文「第三個/兩支 RPC」),ponytail 階梯上多爬了一階。
   我試過用既有物件解(稽核帳)——**它字面上做不到**,不是我懶得找。

### 2.4c 稽核與 `SET CONSTRAINTS` 立場(R1 important 折)

- **稽核逐欄**:`action` = `procurement.void` / `procurement.unvoid`;`target` = `procurement:<uuid>`;
  `before` / `after` 各含 `voided_at` / `void_reason` / `allocated_quantity` / `order_item_id` / `supplier_id`;
  `request_id` = 剝驗後的 `v_req`;`source_app` = `admin`;
  🔴 **`actor` = 剝驗後的 actor、`reason` = 作廢理由**(R2 折:我原本列六個面、**漏了 `actor` 與 `reason`**——
  而 `actor` 正是 §5.2 `B-actor` 要證明「完全自陳」的那一欄,漏了就沒有任何一格抓得到它寫錯;
  `admin_audit_log` 有專屬 `reason` 欄,理由塞進 `after` 會讓下游稽核檢視器查空)。
  **INSERT 不包 EXCEPTION handler**(`20260802150000:195-198`)。
  🔴 harness 要有一格**逐欄斷言這八個面**(action / target / before / after / request_id / source_app / actor / reason)。
- **`SET CONSTRAINTS` 立場 = 不下**,理由照 `20260811010000:75-83` 的形狀但**必須自己重證**:
  A4a 的採購重算 trigger 是 `DEFERRABLE INITIALLY IMMEDIATE`(F13)⇒ **caller 可以把它延到 COMMIT**。
  ⇒ 本片的守門 **V7(讀 receipts 真相)不讀衍生的摘要表** ⇒ 不受 deferral 影響(🏁 C 案:原文含 `U6 讀採購列真相`)。
  🔴 但 **C4/C5 的發作時機會被延到 COMMIT** ⇒ harness 必須跑 **immediate / deferred 兩種**,
  證明「錯誤在哪一刻出現」兩種模式下都仍被本片的人話守門先接住。**這一格 plan v1 沒有。**

### 2.4d 函式屬性(R2 important 折:v1 只在 MUT-ACL 出現,設計段零字面)

**這支 RPC** 逐字帶:`LANGUAGE plpgsql` / `SECURITY DEFINER` / `SET search_path = public, pg_temp`
/ 🔴 **`SET lock_timeout = '5s'`**(樣板 `20260813120000:469-470` 同款)。

🔴 **C 案:設定【照留】,但理由【必須重寫】—— 刪設定與留舊句子都是錯的(主視窗 `D-902-A.md:38-39` 點名)**
~~舊理由:C1 的 advisory lock 會讓兩支 RPC 真的互相等。~~
**C1 已刪 ⇒ 那句當場變成假話。** 但 `lock_timeout` 仍然承重,新理由是**實測**的:
探針 `452-2a2-void-lockprobe.sh` 發④⑤ 各觀察到 **1 個 session 卡在 `wait_event_type='Lock'`**
—— **採購列的 NKU 爭用是真的、只是不會成環**。沒有 `lock_timeout`,void 撞上一個長交易的 A5a 會**無限等**,
員工那一按就是永遠轉圈。⇒ **爭用仍在,只是死結沒了。**
⚠️ §5.1 的 ACL 矩陣**驗不到 timeout**(它只看 `proconfig` 的 search_path)⇒ 矩陣必須有一格:`proconfig` 含 `lock_timeout=5s`。

### 2.5 人話出口(引導訊息)

- `HAS_RECEIPTS_UNDO_FIRST` ⇒ 「這筆採購已經登錄過到貨,不能直接作廢。請先到到貨紀錄把那幾筆撤掉,再回來作廢。」
  🔴 撤到貨的出口 = `admin_delete_item_receipt(uuid,text,text)`(`20260810233000:280-283`)。
  ⚠️ **撤完之後那批貨在系統裡沒有去處** = 已立案的 `#462`(`docs/phase-1-backlog.md:12137-12143`),本片不做。
- ~~`UNVOID_EXCEEDS_ORDERABLE` ⇒ 給兩條出路(①改小別家 ②直接重下一筆新的)~~
  🏁 **C 案刪(隨 U6)。** ⚠️ 但 **F3/F4 的 partial unique 仍然承重** —— Q-S1=A 靠它讓「作廢後對同一家重下單」
  不撞鍵(`20260813120000:383-385` 索引註解逐字)。**索引不動,只是不再需要 U7 去接它的裸 23505。**

---

## §3 🔴 相鄰兩個 writer:同一個 apply 單位(Q-P2 = A,已裁)

**這兩件事在 `voided_at` 恆為 NULL 時是惰性的;void writer 一上線,它們立刻變成活的洞。**

### 3.1 `admin_record_item_receipt` 對已作廢列登錄到貨

現況 F18:步 5 鎖列後不看 `voided_at`。
⇒ 對已作廢列登錄到貨 ⇒ instock 上去(F7 不扣)、ordered 不含這一列(F6 已扣)。
🔴 **R1 MF-4 折**:原句寫「⇒ 撞 C5 ⇒ raw 23514」是**條件式因果被寫成必然**。
C5 比的是品項層聚合 ⇒ 若同品項的**兄弟採購列**還撐著 ordered=10、本次只收 1 件,
`instock=1 ≤ ordered=10` ⇒ **C5 不發作,那筆到貨就這樣掛在一筆已作廢的採購上、沒有任何人擋**。
⇒ **這比會撞 C5 更糟**:會撞的至少會停下來,不會撞的是靜默的壞資料。
⇒ 守門必須是**直接斷言**「作廢列不得收貨」,**不得依賴 C5 兜底**。
**修法(≈4 行)**:步 5 之後、步 6 冪等快篩**之前?之後?**
🔴 **之後** —— 照 F20 的紀律逐字:`voided_at` 是「會在兩次呼叫之間改變的狀態」
⇒ 排在冪等之後,否則「登錄成功 → 採購被作廢 → 合法重放」會回錯碼而不是 `DUPLICATE_REQUEST`。
出口 = RETURN `PROCUREMENT_VOIDED`。

🔴 **這個新碼會打破應用層已凍結的窮盡碼集(R2 must-fix)—— 實查後代價 = 2 檔 3 行,不是一片**

`apps/admin/src/lib/orders/receipt-repository.ts:15-17` 逐字「未知碼 / null 一律當呼叫端 bug 拋」
⇒ 不處理的話員工看到的是「系統狀態異常」,不是「這筆採購已作廢」。

**先問便宜的問題(主視窗交辦):既有 10 碼有沒有能誠實表達的?** 逐條看過 `receipt-repository.ts:21-31`,**沒有**:
- `PROCUREMENT_NOT_FOUND` 是**說謊** —— 那列在,只是作廢了,員工正看著它。
  本 repo 有明文判例反對說謊碼名(`20260811010000:246-252`:`ORDER_CANCELLED_USE_SPOT_STOCK` 就是因為
  「部分取消時是假話」才被改名成 `EXCEEDS_ROOM_AFTER_CANCELLATION`)。
- **RAISE 通道也不通**:`receipt-repository.ts:62-65` 的 `isCallerBugRaise` 只認 `P0001`/`P2B02`
  ⇒ 一律丟 `ReceiptCallerBugError`(= 叫員工停手);其他 SQLSTATE 走 `:127` 裸 `throw`。
  `P4A03` 那種「DB 白話原文帶給員工」的 pass-through **只存在於刪除那支**,而它**刻意不在這個檔**(`:8-13`)。

⇒ **必須新增一個碼。落點實查 = 2 檔 3 行**:
`receipt-repository.ts:21-31` 的 `RECEIPT_RECORD_RESULT_CODES` +1 /
`receipt-action-state.ts:58-77` 的 `ReceiptFailureCode` +1 / `:91` 的 `FAILURE_MESSAGES` +1 條文案。
**兩個編譯期守門會抓漏**(實查,不是推測):`receipt-repository.test.ts:35` 用 `it.each(碼集)` ⇒ **測試自動長格**;
`FAILURE_MESSAGES` 宣告成 `Record<ReceiptFailureCode, string>` ⇒ **漏寫文案會 typecheck 紅**。

🔴 **上線順序:應用層【先】,migration【後】—— 而且這不違反那條 memory,請逐字讀完再改**

`feedback_app-layer-must-not-ship-before-migration-apply` 講的是「**app 呼叫一個還不存在的東西**」
(08-07 A9h 正式站壞約 8 小時)。**本例不是那個形狀。** 三種形狀要分開:
1. 後上的那半還不存在、先上的那半會**呼叫**它 → **先上的壞**(A9h)
2. 先上的那半**改變了**後上那半正在讀的形狀 → **後上的壞**
3. 🔴 **先上的那半只是「多接受一種輸入」,而此刻沒有人會產生那種輸入 → 零風險,而且 app 先上才安全**(= 本例)

⇒ **判準不是「哪一層」,是「誰依賴誰還不存在的東西」。**
本例 app 只是**放寬它接受的碼集**,在 RPC 還不會吐那個碼之前**完全惰性**;
反過來(migration 先上)⇒ RPC 開始吐新碼、app 不認得 ⇒ 走 `receipt-repository.ts:134` 的
「回傳非預期碼」⇒ **員工看到「系統狀態異常」**。
⚠️ **這段必須留在 plan 裡** —— 下一個人讀到「app 先上」會以為違反那條 memory(主視窗交辦)。

### 3.2 `admin_upsert_item_procurement`(A5a)撞到已作廢列

現況 F16:存在性分流看不到 `voided_at` ⇒ 走 UPDATE 路徑,把已作廢列的 `allocated_quantity` 改掉、
而那一列**仍然是作廢狀態**(A2b1 因調降/持平早退,不守)。
**這是 2a-1 已觀察的行為**,不是我推的:`scripts/452-verify.sh:192-200`(B5 格)+ `/Users/sean_1/pcm-mailbox/D-704-STOP.md` §3。
員工端的症狀:他以為下了單,`ordered_quantity` 卻一動不動 ⇒ 會一直重下。

**兩條路(Q-S1,產品題,§8)**:
- **(i) 視同不存在、走新建**(在 `:315-318` 的 WHERE 加 `AND voided_at IS NULL`)—— 靠 partial unique 不撞鍵。
  🏁 **Sean 已拍 (i)。C 案下 A5a 的改動 = 兩處:①那一行 `AND voided_at IS NULL` ②說明它在防什麼的註解。**
  ~~🔴 R3 折:還要加一句 advisory(第一把鎖)⇒ 共三處~~ 🏁 **C 案刪第三處** ——
  advisory 是為 `unvoid × A5a` 而設,已實測 C 案下不需要(§2.4 V0 那列的探針三發:⓪1 / ④0 / ⑤0)。
- ~~**(ii) 回一個新固定碼**叫員工先「取消作廢」~~ 🏁 **C 案下這個選項不可能存在**(沒有取消作廢可叫他去做)。

⚠️ **(ii) 會讓 F4 那句索引註解變成空話**(「作廢後對同一家供應商重下單不得撞鍵」——
如果根本不准重下單,partial unique 就沒有存在理由)。**我推薦 (i)**,但這是 Sean 的題(§8 Q-S1)。

🔴 **連帶**:改了 A5a 的分流,`scripts/452-verify.sh:192-200` 的 B5 格期望值(`UPDATED`)必須改。
那一格自己就寫著「若 2a-2 已改成拒絕,請同步改 plan §3-4」(`:197` 逐字)。

🔴 **R1 important 折 —— 我把有限的預告擴張成無限的授權**:
`:197` 只預告了「**改成拒絕**」這一種結果;而我推薦的是 **(i) 回 `CREATED`**,
**那個結果那一格沒有預告過。** ⇒ 「作者自己預告的」這個理由**對我推薦的案不成立**。
⇒ 修正後的立場:改 B5 期望值的正當性**不來自那句預告**,來自 **Q-S1 的正式裁定**
⇒ **Q-S1 未裁之前先改 = 開後門**(這正是 §0.5 把 Q-S1 列為硬前置的理由)。
⇒ 裁定之後才可改,且必須**同時**新增三格證明新行為:①舊 voided 列一個欄位都沒被動
②新的 active 列真的建起來 ③摘要 `ordered_quantity` 是新列的量。**不是只把紅的那格調綠。**
⚠️ codex R1 的裁決逐字 = 「我只**條件式**同意,不是無條件例外」—— 條件就是上面那兩句。
✅ **條件已滿足**:Sean 2026-08-14 拍 **Q-S1 = A**(逐字「當成全新的一筆收下來,舊的作廢紀錄留著查帳」)。
🔴 **但那行預告本身現在是【說假話的過期字面】,不只是期望值要更新**:
`scripts/452-verify.sh:197` 預告的是「若 2a-2 已改成**拒絕**」,而 Sean 拍的是**新列** = **相反方向**。
⇒ 要處理兩件事:①B5 期望值 `UPDATED` → `CREATED` ②**那行預告的文字**要改成指向本 plan 與 Q-S1 裁定。
⇒ 動之前先 `grep -rn` 全樹重建清單(不只改被點名那一格)。

🔴 **R2 must-fix —— A5a 自己的結構錨在 2a-1 之後已經是死的,而我沒接**:
`20260806200000:715-718` 那道錨查 `pg_constraint … conname='order_item_procurement_business_key' AND contype='u'`,
而 2a-1 已把業務鍵改成 **partial unique index**(F3 自己記著)⇒ `pg_constraint` 裡**已經沒有那一列**。
⇒ 兩條路都壞:**逐條複製進 2a-2**(`/Users/sean_1/pcm-mailbox/D-704-STOP.md` §5 立的紀律)會**當場 RAISE**;
**不複製**則 `:733-736`(不得鎖 order_items)、`:783`(FOR UPDATE 恰 1 次)等錨會隨 `CREATE OR REPLACE` **一起消失**。
⇒ 修法:**那道錨要跟著 2a-1 的形狀改**(改查 `pg_index` 的同名唯一索引),其餘錨逐條複製。
⚠️ **這件事 2a-1 就該做而沒做** —— 它是 2a-1 換索引時漏掉的下游,不是 2a-2 新長出來的。

### 3.3 為什麼是同一個 apply 單位

`20260811010000:14-18` 逐字立過「同版本號不同內容」的事故形 ⇒ 兩個相鄰 writer 的修改**另開一支 migration**,
但**與 void/unvoid 同批 apply**。分批 apply 會產生「有 voided 列、相鄰 writer 不認得」的窗口 ——
而那正是 `feedback_app-layer-must-not-ship-before-migration-apply` 那條的同族。

🔴 **R1 MF-8 折 —— 「同批」不等於「原子」**:`supabase db push` 一次送多支,但**每支各自 commit**。
若 void/unvoid 那支先 commit、writer 修補那支後 commit,中間**仍然是真實存在的洞**(不是理論窗口)。
⇒ **順序必須寫死:writer 修補先、void/unvoid 後。**
  理由 = writer 的 voided 分流在還沒有任何 voided 列時是**惰性的、零行為改變**(F26)⇒ 先上零風險;
  反過來先上 void 就是先開洞。
⇒ 具體做法:兩支 migration 的**版本號排序**必須讓 writer 那支在前,
  並在 void/unvoid 那支的**前置閘**加一道:偵測不到 writer 的 voided 分流字面就 RAISE 拒 apply
  (形狀照 `20260807200000:53-60` 的 `to_regprocedure` 前置閘)。
  🔴 **這道閘是本片唯一能證明順序被遵守的東西**,不是裝飾。

---

## §4 rollback(🔴 順序承重寫明)

### 4.1 本片(2a-2)自己的回退

```
BEGIN;
  步 0  前置閘(四道,全部會自己 RAISE)
        P1 🏁 **C 案:那【一支】RPC 存在**(原文「兩支」)(不存在 ⇒ 沒 apply 過或已退過 ⇒ 不要重跑)
        P2 🔴 **刪除** —— 見 §4.2「fail-DANGEROUS」段:2a-2 的回退零資料損失,
           設這道閘等於「第一筆真實作廢之後就再也關不掉那支 RPC」。
           改設後置斷言:DROP 之後已作廢的列維持作廢、無 writer 能再動它。
        P3 A5a / receipt RPC 的指紋 = 2a-2 的版本(不是,代表有人在中間又改過 ⇒ 停)
        P4 2a-2 之後沒有新的 migration 引用這支 RPC 🏁 C 案:原文「這兩支」
  步 1  🔴 **先 DROP 那支新 RPC**(拿掉唯一的 voided writer)🏁 C 案:原文「兩支」
  步 2  還原 A5a 與 admin_record_item_receipt 成 2a-2 之前的版本(CREATE OR REPLACE,逐字由程式從原檔抽出)
  步 3  後置斷言:那支 RPC 已消失(🏁 C 案:原文「兩支」)/ 兩支相鄰 writer 指紋回到 2a-2 之前
        / 帳本表已消失 / 🔴 **已作廢的列【維持作廢】且欄位值逐欄未變**
        ⚠️ **不得斷言「voided 列數 = 0」** —— R3 抓到:那等於把 P2 那道 fail-dangerous 閘
           從後門裝回來,第一筆真實作廢之後整支回退會在步 3 RAISE ⇒ **正是最需要關掉它的時刻。**
COMMIT;
```

**順序為什麼不能反**:

| 反過來做 | 會怎樣 |
|---|---|
| 先還原相鄰 writer、再 DROP void RPC | 步序仍應維持,但**承重理由要更正**(R1 nit 折):整支包在單一交易裡 ⇒ 那個「中間狀態」**其他 session 看不見**,不是外部可見窗口。真正的理由是**交易內的後續語句與後置斷言會踩到它**,以及**交易中途失敗時的心智模型**要單向可推 |
| ~~P2 那道閘不過就硬退~~ | 🔴 **R2 折:這條承重理由是錯的,而且是從 2a-1 交叉污染過來的。** A4a 的 `AND p.voided_at IS NULL` 由 **2a-1** 加(`20260813120000:492-495`),而本 plan §6.2 自己逐字寫著「**本片不改 A4a**」⇒ **2a-2 的回退根本不會還原 A4a** ⇒ C4 那條後果不成立。**寫錯的閘 = 值班者照錯的心智模型判斷。** |

🔴 **R2 折 —— P2「零筆被作廢」對 2a-2 而言是 fail-DANGEROUS,不是 fail-safe**

我把 2a-1 的閘照抄過來,但**兩片的回退代價完全不同**:
- **2a-1 的回退 = 刪欄 = 資料損失** ⇒ 「有作廢列就擋下」是 fail-safe,對。
- **2a-2 的回退 = DROP 那支 RPC + 還原兩個 writer = 零資料損失**(🏁 C 案:原文「兩支」)⇒ 同一道閘變成
  **「已經有一筆真實作廢之後,就再也關不掉那支會出事的 RPC」**。
⇒ **半夜出事時,那正是你最需要關掉它的時刻。**
⇒ 修法:**2a-2 的 down 不設「零筆被作廢」閘**(它不刪任何資料);
  改設「**DROP RPC 之後,已作廢的列會維持作廢狀態、沒有 writer 能再動它**」的後置斷言。
  2a-1 的那道閘**留在 2a-1**,不往前搬。

🔴 **R2 折 —— down 腳本漏了新帳本表**:`order_item_procurement_void_requests` 不在任何一步、
也不在後置斷言 ⇒ 回退後再前推時 `CREATE TABLE` 會撞既有物件。
⇒ 步 2 要加:`DROP TABLE public.order_item_procurement_void_requests`(**步 3 後置斷言已同步加「表已消失」**)(**它只存冪等帳、零業務資料**;
  ⚠️ 但這代表**回退會丟掉冪等歷史** ⇒ 回退後同一個 `request_id` 會被當成新請求。**這句要寫進 runbook。**)

### 4.2 與 2a-1 回退的關係(🔴 這是全案最承重的一句)

**2a-2 必須在 2a-1 之前回退。** 依據 = `docs/runbooks/2026-08-13-452-procurement-void-rollback.md:51`
逐字寫的 P4 閘:「偵測到 `admin_void_item_procurement` / `admin_unvoid_item_procurement` ⇒
**必須先逆序回退 2a-2**,否則那兩支會引用已刪的欄位」。

🏁 **C 案下這兩處【刻意不改】,不是漏掉(全樹掃過,`grep -rn 'admin_unvoid_item_procurement'` 只有這兩處在 plan 外)**:
`scripts/452-down.sql:24` 的 `proname IN ('admin_void_item_procurement','admin_unvoid_item_procurement')`
與 `docs/runbooks/2026-08-13-452-procurement-void-rollback.md:51` 的同款描述。
理由:那是 `IN` 清單,C 案下只會有 `admin_void_item_procurement` 命中 ⇒ **閘的行為完全不變**;
留著多一個名字**零成本、且若日後補回 unvoid 就已經涵蓋**。⚠️ 這句必須留著,否則下一個人會把它當成過期字面去「修」。

🔴 **誠實邊界**:該檔 §4 逐字自陳「**未演練**:2a-2 已 apply 的情況(那時 2a-2 還不存在)
⇒ P4 那道閘是**寫下來的、沒被跑過**」。
⇒ **本片的驗收條件之一 = 把 P4 從「寫下來的」變成「跑過的」**。

🔴 **R1 MF-9 折 —— v1 的負向演練判準寫錯了,而且錯得很具體**:
v1 寫「照錯的順序退 ⇒ 期望炸在 `column p.voided_at does not exist`」。
**到不了那裡** —— `scripts/452-down.sql:22-25` 的步 0 有一道 P4 閘,
逐字 `proname IN ('admin_void_item_procurement','admin_unvoid_item_procurement')` ⇒
2a-2 還在的時候跑 2a-1 的 down,**第一件事就是被 P4 擋下**,根本走不到刪欄那一步。
⇒ **正確的演練是三發,不是兩發**:

| 發 | 做什麼 | 期望 |
|---|---|---|
| ① 正向 | 2a-2 down → 2a-1 down → **回退後真的寫一筆採購** | 全過、採購寫得進去。🔴 **R3 nit:前提 = 零 voided 列**(否則 2a-1 down 的零作廢閘 `452-down.sql:18-21` 會先紅)—— ②發寫了、①發漏了 |
| ② 錯序 | 2a-2 還在,直接跑 2a-1 down | **紅在 P4 的具名訊息**(不是缺欄錯);同時斷言**零漂移**。🔴 **R2 折:必須明寫前提 = 零 voided 列** —— `scripts/452-down.sql:18-21`(零筆被作廢)排在 `:22-26`(RPC 偵測)**之前**,若在有 voided 列的狀態下跑,**紅的是前者**,而我會把它當成 P4 的背書 |
| ③ 拔閘 | **刻意把 P4 拿掉**再跑錯序 | 🔴🔴 **R3 折:我 v2 重寫過一次,還是錯的。** `scripts/452-down.sql:175` 的**刪欄就在同一支腳本、同一個交易裡**,`:188` 的步 4 還斷言兩欄已消失 ⇒ **乾淨 COMMIT 之後欄位已經不在**。我 v2 寫的「兩支 RPC 仍在、但它們引用的欄位還在 ⇒ 真正的破壞要等再退 2a-1」**自相矛盾**(同一格先說會乾淨 COMMIT、又說欄位還在),而且**「再退 2a-1」那一步不存在 —— 這一步就是 2a-1 down**。<br>✅ **正確期望**:整支**乾淨 COMMIT**,兩支 void RPC **變成孤兒**(它們的函式體引用已被刪的 `voided_at`)⇒ **下一次呼叫任一支 void RPC 當場 `42703 undefined_column`**。⇒ **觀察點是「回退之後呼叫 RPC」,不是回退本身。** 這才是 P4 承重的證明:沒有 P4,回退會「成功」而系統壞在下一次呼叫。 |

⚠️ ③ 才是真正把「順序承重」變成觀察的那一發;v1 把 ②③ 混成一發 ⇒ 會拿 P4 的紅去背書一個它沒證明的因果。

🔴 **R1 important 折 —— 還漏了兩塊**:
- **P1-P4 各自失敗的演練**:每道閘都要有一發只讓它紅,且**紅完之後要斷言零漂移**
  (閘擋下來之前若已經有 DDL 落地、或例外被吞,光看錯誤訊息證明不了回退是安全的)。
- 🔴 **P2「零筆被作廢」在功能上線後就不再恆真**。
  ⚠️ **v2 更正**:我原本寫「這是 fail-safe(擋住比誤刪好)」—— **對 2a-1 成立,對 2a-2 不成立**(見 §4.2)。
  2a-2 的回退零資料損失 ⇒ 那道閘在 2a-2 是 fail-dangerous,**已刪**。
  但 **2a-1 的那道閘仍在**、且仍會擋 ⇒ 「已有作廢列時 2a-1 退不了」這件事**照樣成立**,所以仍需要出口:
  「已有 voided 列時怎麼辦」= **只能 roll-forward**(修 bug 往前推)或**人工處置那幾列**
  (逐列決定:清回 NULL 還是保留),**兩條都要 Sean 拍板、不是值班者自己決定**。
  ⚠️ 這一條要同時寫進本片的 runbook 檔頭,否則半夜值班者會以為「有 rollback 可以退」。

### 4.3 forward-only 的既有紀律(不重述,只指標)

回退不會拿掉 `supabase_migrations.schema_migrations` 那一列 ⇒ 回退當天必須在 `supabase/APPLIED.tsv`
與當日 handoff 寫明「已回退」(`docs/runbooks/2026-08-13-452-procurement-void-rollback.md:119-123`)。

---

## §5 驗收:怎麼證明每道守門會紅(突變靶)

**紀律(母 plan §4c 立的,本片沿用)**:每個突變格**先查物件定義字面、證明突變真的套上去了**,才跑判準。
只靠「該紅的紅了」是推論,分不出「突變沒套上」與「守門有效」。

### 5.1 突變靶(每條 = 拿掉/改壞一個東西,期望恰好一格翻紅)

| 靶 | 改什麼 | 期望 | 它證明了什麼 |
|---|---|---|---|
| **MUT-V7a** | 拿掉 V7,**fixture = 本品項只有這一列採購** | **紅在 raw 23514 / C5** | 🔴 **R3 折:我 v2 把 fixture 與期望配錯了。** 單列 fixture 下 void ⇒ A4a 重算 ordered=0、instock>0 ⇒ **當場撞 C5、RPC 中止** ⇒ 「靜默掛著」在這個 fixture 下**物理上到不了**。這一格證的是「**沒有 V7 就會吐員工看不懂的英文**」 |
| **MUT-V7b** | 拿掉 V7,**fixture = 本品項另有兄弟採購列撐著 ordered** | **不紅、登錄成功** ⇒ 那筆到貨**靜默掛在已作廢的採購上** | 這一格證的是**更糟的那一半**:C5 只在部分情形接得住 ⇒ **不能把 C5 當這條的守門**。⚠️ 判準不是「有沒有 error」,是**查那一列的 `voided_at IS NOT NULL` 且它有 receipts** |
| ~~🔴 **MUT-U6-neg**~~ 🏁C刪 | ~~拿掉 unvoid 的總量重驗(U6)~~ | A 家 3 作廢 → B 家補 3 → unvoid A ⇒ **紅在 raw 23514 / C4**(`oiqs_ordered_le_quantity`),**不是人話、也不是成功** | **把「A2b1 不會接住」從推論變成觀察** —— 本片最重要的一格。🔴 **R1 MF-5 折**:v1 寫「成功、ordered 變 6」與本檔 §2.3 自己承認的 C4 兜底矛盾 —— 拿掉 U6 之後 A4a 寫摘要當場撞 C4,**不可能成功**。判別力仍在:錯誤來源是 **C4 而不是 `a2b1_allocation_within_orderable`** ⇒ 證明 A2b1 真的沒出場 |
| ~~**MUT-U6-bnd**~~ 🏁C刪 | ~~U6 的 `>` 改成 `>=`~~ | 恰好用滿的**合法** unvoid 被誤擋 | 邊界對齊 `20260813120000:447`,不多擋一件 |
| ~~**MUT-U7**~~ 🏁C刪 | ~~拿掉 U7 兄弟列守門~~ | 作廢 → 同家重下單 → unvoid ⇒ 紅在**裸 23505 + 索引名** ✅ **已實測**(D 窗探針發③,`duplicate key … "order_item_procurement_business_key"`)| 🔴 **R2 折:fixture 前提必須明寫** —— 要紅在 23505,前提是 **U6 先放行** ⇒ 品項 `quantity` 必須容得下「作廢那筆 + 重下那筆」。照 §2.3 的 3+3 情境建 fixture 會**紅在 `UNVOID_EXCEEDS_ORDERABLE`(人話)、突變體存活**。探針用的是 `quantity=6` |
| **MUT-Ra** | 拿掉 receipt voided 分流,**fixture = 本品項只有這一列採購** | **紅在 raw 23514 / C5** | 🔴 **自掃折**:單列 fixture 下,對已作廢列登錄到貨 ⇒ instock 上去、ordered 不含它 ⇒ **當場撞 C5** ⇒「靜默掛著」**物理上到不了** |
| **MUT-Rb** | 同上,**fixture = 本品項另有兄弟採購列撐著 ordered** | **不紅、登錄成功** ⇒ 到貨**靜默掛在已作廢的採購上** | 🔴 **自掃折:MUT-R 與 MUT-V7 是同一個病,而 R3 只點名了 V7、我也只拆了 V7。**「**一處改了一處沒改**」**第三次**,而且這次是**在我剛被指出這個病的同一輪**。判準 = 查該列 `voided_at IS NOT NULL` 且 `EXISTS receipts`,不是查有沒有 error |
| **MUT-A5a** | 拿掉 A5a 的 voided 分流(§3.2) | 對已作廢列重下單 ⇒ 回 `UPDATED` 而不是 `CREATED` | 復現 2a-1 B5 已觀察的行為(`452-verify.sh:192-200`)。✅ **R2 當時指出「`CREATED` 先於 Q-S1 裁定寫死」—— 裁定已於 2026-08-14 到達(Q-S1=A)**,期望值現在有正式依據 |
| **MUT-IDEM** | 把 V5 的冪等快篩移到 V6/V7 之後(🏁 C 案:原文含 `U4`) | 合法重放被守門擋掉、拿不到 `DUPLICATE_REQUEST` | F20 那條紀律在本片成立(352c 實測抓過的真 bug) |
| **MUT-PAIR** | void 的 UPDATE 只寫 `voided_at`、不寫 `void_reason` | 紅在 `order_item_procurement_void_pair` | 配對 CHECK 是活的(F2) |
| ~~**MUT-TOCTOU**~~ | ~~UPDATE 的 WHERE 拿掉 `AND voided_at IS NULL`~~ | 🔴 **R1 折:撤下,它沒有鑑別力** —— 雙作廢會先被同一採購列的 NKU 鎖序列化,第二支就算拿掉述詞也會在 V6 回 `ALREADY_VOIDED` ⇒ 這一格**恆綠**。述詞本身**保留**(縱深),但**不宣稱它有測到** | 「恆真格」= 本 repo 明文禁止的形狀 |
| 🔴 **MUT-LEDGER-POS** | 把帳本 INSERT 從「所有 RETURN 守門之後」搬回 V5 的位置 | **必須紅**:V7 拒絕(`HAS_RECEIPTS_UNDO_FIRST`)→ 撤到貨 → **同 request_id 重試** ⇒ 回 `DUPLICATE_REQUEST` 而不是成功 | 🔴 **R3 折:§2.4b fold ② 零驗收。** R2 給的失敗情境(「作廢永遠做不成」)**沒有任何一格在守**,把 INSERT 寫回守門之前的實作 **B-idem / B-idem-bad / MUT-IDEM 全綠通過** |
| ~~🔴 **MUT-LEDGER-VERIFY**~~ 🏁C刪(隨單調性,§2.4b)| ~~拿掉「產物驗證」那一半(只比對鍵存不存在)~~ | **必須紅**:void → unvoid → **原 request_id 重放** ⇒ 回 `DUPLICATE_REQUEST`(fail-open)而不是新碼 | 🔴 **R3 折:§2.4b fold ③ 零驗收,而且那個碼【沒有名字】。** ⇒ 定名 **`REQUEST_ID_REUSED_STATE_CHANGED`**(語意=「這個提交編號用過,但那一列後來又被改了」),並寫進 §2.4b 與步表 |
| 🔴 **MUT-APPLY-GATE** | 把 §3.3 的 apply 前置閘(偵測 writer 分流字面)改成恆真 | **必須紅**:在**缺 writer 分流**的庫上跑 void migration ⇒ 應 RAISE 拒 apply | 🔴 **R3 折:§3.3 自稱「這道閘是本片唯一能證明順序被遵守的東西」,而 §5 零演練。** 閘寫壞(字面偵測打不中)= **順序保證整條蒸發且無人發現** |
| ~~🔴 **MUT-ADV-KEY**~~ 🏁C刪(隨 C1) | ~~把 advisory 的鍵改成**常數**(= 全碰撞)~~ | **兩個觀察缺一不可**:①B-concurrent 全部仍通過(**不得紅**)②🔴 **兩組【不同業務鍵】的交易現在會互相 block** —— 用第三條連線觀察 `pg_stat_activity` 的 `wait_event_type='Lock'` / `wait_event='advisory'` | 🔴 **自掃折:R3 要我補這格,我補的版本只驗了宣稱的一半。** 宣稱有兩半 ——「碰撞**不影響正確性**」與「碰撞**只造成多餘序列化**」。只寫「不得紅」⇒ **分不出「碰撞了而且乖乖排隊」與「這組 fixture 根本沒碰撞」** ⇒ 第二半未觀察。<br>⚠️ 這也是「期望值 = 保持綠」的格的通病:**它必須自帶第二個觀察,否則零鑑別力** |
| **MUT-V7-CONSIST** | 拿掉 V7 的「兩來源不一致 ⇒ fail-loud RAISE」分支 | **必須紅**:owner 開 `pcm_a4a.received_sync` 旗標直寫 `received_quantity` 製造不一致 ⇒ 應 RAISE 而不是靜默走 RETURN | 🔴 **R3 折**:我沒定 V7 內部順序 ⇒ 若「任一非零就擋」排在前面,**RAISE 分支不可達 = 死枝**。⇒ §2.4 已改成**先驗一致、再驗非零** |
| ~~🔴 **MUT-ADV**~~ 🏁C刪(隨 C1);**其保護力已由新探針反向證明**(§5.2 `B-VOID-ADV-FREE`) | ~~拿掉 **unvoid 或 A5a** 的 `pg_advisory_xact_lock`~~ | **必須紅** —— 兩條連線 rendezvous 下重現 `40P01` ✅ **已實測**(基準線 40P01=1、C1 40P01=0) | 主視窗交辦的回歸靶:**C1 的保護力在鎖本身,拿掉會當場死結、不是安靜地壞掉**。🔴 **R3 折:原寫「三支任一」對 void 腿是過強宣稱** —— 死結的兩條腿是 **unvoid × A5a**;void 與 A5a 由**採購列 row lock** 就序列化了 ⇒ 拿掉 **void** 的 advisory **無任何可觀察紅** = 恆綠。⇒ **void 那一支要不要保留 advisory,是「一致性 vs 可證明性」的取捨,已列 §10 A7 當待驗假設** |
| **MUT-ACL(擴)** 🏁C:矩陣從兩支 RPC 縮成**一支** | ①`GRANT … TO PUBLIC` ②改掉 `SECURITY DEFINER` ③拿掉 `SET search_path` ④改 owner | 四個各自紅在對應斷言 | 🔴 **R1 MF-11 折**:v1 只突變 ①,對高風險 SECDEF 遠遠不夠。ACL 斷言必須是**完整矩陣**:`prosecdef=true` / `proconfig` 含安全 `search_path` / 🔴 **`proconfig` 含 `lock_timeout=5s`**(R3 折:§2.4d 明令要加這一格,我卻沒加進矩陣 —— **「一處改了一處沒改」在同一輪內再現**)/ owner 正確 / `PUBLIC`·`anon`·`authenticated`·`authenticator` 四者皆無 EXECUTE 而 `service_role` 有 / **overload 數恰 1**(形狀照 `20260807200000:153-169`) |

🔴 **R1 MF-10 折 —— v1 的靶只蓋了「貴」的守門,V1-V6 ~~/ U1-U5~~ 全部零覆蓋。**
本節標題宣稱「證明每道守門會紅」,而那是全稱句 ⇒ **每一道都要有靶,沒有例外**。補上:

🔴 **C 案刪掉 unvoid 半邊時,下表三列的【恆綠修法】必須留著**(主視窗 `D-902-A.md:46-47` 點名):
`MUT-V1` 要比對 `CONSTRAINT` 名(否則 A2b1 自己的隔離閘會讓它恆綠)、
`MUT-V2` 要比對 `P0001` vs 帳本表 `23514`(否則形狀 CHECK 會讓它恆綠)。
**整列刪掉 = 把 R2/R3 折出來的判準一起刪掉**,那是「一處改了一處沒改」的反向版。

| 靶 | 改什麼 | 期望 |
|---|---|---|
| MUT-V1 ~~/ MUT-U1~~ 🏁C縮成一半 | 拿掉隔離閘 | 🔴 **R2 折:這格恆綠,反證寫在本檔 §2.1** —— A2b1 自己的隔離閘(`20260813120000:410-414`)排在早退**之前**、任何 UPDATE 都會跑 ⇒ 拿掉 RPC 的 V1 之後,RR 下**照樣紅在 `P2B02`**。⇒ **判準必須比對 `CONSTRAINT` 名**(本片的 vs `a2b1_isolation_read_committed_only`),否則零鑑別力 |
| MUT-V2 ~~/ MUT-U2~~ 🏁C縮成一半 | 拿掉 actor / request_id 形狀閘 | 🔴 **R3 折:恆綠(第五個)。** 拿掉 V2 之後,非法 actor 仍被 **§2.4b ① 我自己規定要抄的帳本表形狀 CHECK** 以 **23514** 擋下 ⇒ 「被收下」**永不發生**。⇒ **判準必須比對錯誤來源**:本片的具名 `P0001` RAISE **vs** 帳本表的 `23514`。**與我已修的 MUT-V1/U1 同型,而我沒把同一個修法套過來** |
| MUT-V3 | 拿掉理由空白閘 | 純空白理由 ⇒ 紅在裸 `order_item_procurement_void_pair` 而不是人話 |
| MUT-V4 ~~/ MUT-U3~~ 🏁C縮成一半 | 拿掉存在性判斷 | 不存在的 `procurement_id` ⇒ 不再回 `PROCUREMENT_NOT_FOUND` |
| MUT-V6 | 拿掉「已作廢」判斷 | 🔴 **自掃折:原期望【物理上不可達】(第 6 個恆綠嫌疑)。** UPDATE 帶著 TOCTOU 述詞 `AND voided_at IS NULL`(§2.4 步表)⇒ 二次作廢**改到 0 列** ⇒ `ROW_COUNT <> 1` **一定會 RAISE** ⇒ **永遠不可能變成 no-op、也不可能靜默覆蓋理由**。<br>✅ **正確期望**:**紅的來源從 V6 的人話 `ALREADY_VOIDED` 退化成 rowcount 的通用訊息**(「狀態剛剛被別人改過」)⇒ **判準是比對碼/訊息來源,不是比對紅不紅**。⚠️ 與已修的 MUT-V1/U1、MUT-V2/U2 **同型第三次** |
| ~~MUT-U5~~ 🏁C刪 | ~~拿掉「本來就沒作廢」判斷~~ | 對未作廢列 unvoid ⇒ `ROW_COUNT=0` 紅在通用訊息、不是 `NOT_VOIDED` |
| MUT-AUDIT | 把稽核 INSERT 包進 `EXCEPTION WHEN OTHERS THEN NULL` | 🔴🔴 **R3 折:我 v2 的修法【仍然】恆綠 —— 這是第四個恆綠格,而且是我修過之後還恆綠。** 「空字串 actor」**到不了稽核 INSERT**:V2 的形狀閘 `p_actor !~ '^[a-z0-9_]{1,64}$'`(`20260811010000:88-89` 樣板)**先 RAISE**;帳本表的 actor CHECK(`20260810230000:169-170` 同 regex)**第二道再攔**。⇒ **構造法要整個換成 fault injection**:harness 在跑該格前對 `admin_audit_log` **注入一條臨時 CHECK**(例如 `action <> 'procurement.void'`)讓稽核 INSERT 必失敗,跑完拆掉。⚠️ **這格若又構造不出來,先懷疑那個 handler 本來就是 no-op** |
| MUT-AUDIT-FIELD | 把 `target` 寫成固定字串 | §2.4c 的逐欄斷言紅(v1 沒有這一格 ⇒ 寫錯欄位不會被發現) |
| ~~MUT-IDEM-KEY~~ | 帳本表的 PK 拿掉 | 🔴 **R2 折:放錯章節,單 session 跑不出來。** 「同 `request_id` 打不同採購列雙雙成功」正是 §2.4b 說的「互相看不到對方未提交的列」⇒ **必須兩條真連線 rendezvous** ⇒ **移到 §5.2 `B-concurrent`**,不是 §5.1 突變表跑得動的格 |

### 5.2 正面格(不是突變,是「這件事真的發生了」)

> 🔴 **正面格的計數法要寫明,否則下一個人數不出 21**(這不是 grep 得到的數,主視窗 `D-902-A.md:36-37` 點名):
> 具名 4(`B-void` `B-unvoid` `B-idem` `B-idem-bad`)+ `B-concurrent` 拆 **4 個子格**
> + R3 補 **7 格**(`B-DEFER` `B-AUDIT-8` `B-QS1-3` `B-RCPT-IDEM` `B-CODE-LITERAL` `B-ORPHAN` `B-U7`)
> + `B-rollback` 拆 **3 發** + 天花板 **3** = **4+4+7+3+3 = 21**。
> ⚠️ 下面那句「**下面六格**」是**字面錯,實際七格**(`B-U7` 是第七個)—— 已在該處標註。
>
> 🏁 **C 案後**:21 − 4(`B-unvoid` / `B-U7` / unvoid×部分取消 / unvoid×A5a)**+ 1**(新增 `B-VOID-ADV-FREE`)= **18 格**。
> 全片合計 **突變靶 18 + 正面格 18 = 36 格**(原 46)。

- B-void:void 之後 `ordered_quantity` 掉、`instock` 不變、額度真的放出來(對照 2a-1 B3/B4 的做法)。
- ~~B-unvoid:合法 unvoid 之後 `ordered_quantity` 加回來。~~ 🏁 **C 案刪。**
- 🔴 **B-VOID-ADV-FREE(C 案新增,已跑完)**:證明拿掉 C1 之後 `void × A5a` 兩個方向都不死結。
  **證據 = `docs/probes/452-2a2-void-lockprobe.sh`,2026-08-14 跑【四】次結果相同(最後一次為現行版本):**
  發⓪ 正向對照(unvoid 形狀)`40P01=1` / 發④(void 先持列鎖)`40P01=0` / 發⑤(A5a 先持列鎖+parent)`40P01=0`,
  且 ④⑤ 各觀察到 **1 個 session 卡在 `wait_event_type='Lock'`**。
  🔴 **這一格的兩個觀察缺一不可**:沒有 ⓪ 就分不出「沒死結」與「harness 壞了」;
  沒有阻擋數就分不出「沒死結」與「根本沒併發」。**期望值 = 保持綠 的格必須自帶第二觀察。**
  ⇒ 假設 `A7` 已從推論變成觀察(§10)。
- B-idem:同 request_id 同 payload 重放 ⇒ `DUPLICATE_REQUEST`、**零額外稽核列**。
- B-idem-bad:同 request_id 不同 payload ⇒ RAISE(不是靜默吞)。
- 🔴 **B-concurrent(R1 important 折:v1 只列 G8,漏了三個會改結論的競態)**:
  - ~~🔴 **unvoid × 部分取消**~~ 🏁 **C 案刪**(**R3 折:v2 寫成「void ×」是主詞錯** —— **void 沒有 U6**,§2.2 明言它不做總量重驗
    ⇒ 照舊字面建格會測到一個**沒有互動的配對**):取消會改 `quantity − cancelled`(§2.3 U6 的右式)
    ⇒ 兩者交錯時 U6 讀到的是哪一版?⚠️ R3 另實查:摘要表**沒有** `ordered + cancelled ≤ quantity` 的 CHECK
    可以兜底(`20260730150000:103-123` 七條逐讀)⇒ **這一對沒有第二道**。
  - ~~**unvoid × A5a 新建同鍵**:就是 §2.4 MF-7 那條 —— 40P01 或裸 23505,**必須實測是哪一個**。~~
    🏁 **C 案刪 —— 但它【已經被實測完】**:姊妹探針 `452-2a2-lockprobe.sh` 發② = `40P01`(不是 23505),
    新探針 `452-2a2-void-lockprobe.sh` 發⓪ 重現同一結果。**答案留著,格子隨 unvoid 走。**
  - **同 `request_id` × 不同採購列**:MF-6 那個洞的直接負測(帳本表 PK 上線前後各跑一次)。
  - **G8 併發首建撞 partial unique index** —— 2a-1 的誠實缺口,
  `/Users/sean_1/pcm-mailbox/D-704-STOP.md` §2 已明文**排進 2a-2**。做法 = **兩條真連線 rendezvous**,
  🔴 **不得用 heredoc**(codex #14 的教訓:連線到 EOF 就結束、交易回滾 ⇒ 根本沒測到 blocking)。
  ⚠️ **這一格不准放進誠實缺口** —— 它已經被指派,而且兩個 psql 程序 + FIFO 就構造得出來。
- 🔴 **R3 折:下面~~六~~【七】格是「某節明令要有、而 §5 沒有」的 —— 全部補進來**(每格附它是哪一節要求的)
  (🏁 **字面更正**:原寫「六格」而下面實列七格,`B-U7` 是第七個 —— 主視窗 `D-902-A.md:35` 點名):
  - **B-DEFER**(§2.4c 要求,自注「plan v1 沒有」而 v2 仍沒有):同一組守門在 **immediate / deferred 兩種模式**下各跑一次,
    證明**人話守門仍先於 C4/C5 接住**。⚠️ 判準是「錯誤來源是本片的具名碼、不是裸 23514」,不是「跑了兩次」。
  - **B-AUDIT-8**(§2.4c 要求):稽核**八個面逐欄**斷言(action / target / before / after / request_id / source_app / **actor** / **reason**)。
    ⚠️ MUT-AUDIT-FIELD 預設這一格存在才有東西可翻紅 —— **它原本不存在。**
  - **B-QS1-3**(codex R1 條件式同意的三格,§3.2 承諾過卻沒收進 §5):改 B5 期望值的同時必須證明
    ①**舊 voided 列一個欄位都沒被動** ②**新的 active 列真的建起來** ③**摘要 `ordered_quantity` 是新列的量**。
  - **B-RCPT-IDEM**(§3.1 要求):「登錄成功 → 採購被作廢 → **同 request_id 合法重放**」⇒ 必須回 `DUPLICATE_REQUEST`
    而**不是** `PROCUREMENT_VOIDED`(證明那道閘排在冪等**之後**)。閘放錯位的實作照舊全綠。
  - **B-CODE-LITERAL**:每個固定碼在正常路徑回**逐字正確的字串**(🏁 C 案:**V3/V6/V7 各一**;原文含 ~~U5/U6/U7~~)。
    🔴 C 案下的完整碼集 = `REASON_REQUIRED` / `PROCUREMENT_NOT_FOUND` / `DUPLICATE_REQUEST` / `ALREADY_VOIDED`
    / `HAS_RECEIPTS_UNDO_FIRST` / `VOIDED`,加 receipt 那支的新碼 `PROCUREMENT_VOIDED`。
    🔴 理由(R3):`#476` 之前**沒有應用層窮盡集接手** ⇒ **typo 的碼會全綠出廠**,日後 UI 片接上時直接「系統狀態異常」。
  - **B-ORPHAN**(§4.2 第③發的觀察點):回退之後**呼叫那支 void RPC**(🏁 C 案:原文「任一支」)⇒ 期望 `42703 undefined_column`。
  - ~~🔴 **B-U7**~~ 🏁 **C 案刪**(§2.4 `:194` 逐字承諾「harness 必須有一格把它變成觀察」而 §5.2 只有它的**字面**格,**行為格不存在**):
    作廢 → 同家重下單(Q-S1=A ⇒ 建出第二列)→ unvoid ⇒ **必須回 `ACTIVE_SIBLING_EXISTS` 的人話**,
    **不是**裸 23505。⚠️ fixture 沿用 MUT-U7 的 `quantity=6`(否則會先紅在 `UNVOID_EXCEEDS_ORDERABLE`)。
    ⇒ 這一格與 MUT-U7 是**成對**的:一個證「有 U7 會給人話」、一個證「沒 U7 會給裸錯」。
- 🔴 **B-rollback**:§4.2 的**三發**演練(①正向 ②錯序紅在 P4 + 零漂移 ③拔掉 P4 才輪到缺欄錯)。
- 🔴 **從 §7 移進來的三格(R1 important 折:它們是天花板、不是缺口 ⇒ 要測)**:
  - **B-actor**:用兩個不同 `p_actor` 各呼叫一次,讀稽核 ⇒ 證明 actor **完全是自陳的**、DB 不驗。
  - **B-owner-bypass**:以 owner 直接 `UPDATE` 兩欄 ⇒ 證明 RPC 與稽核**雙雙被繞過**(零稽核列)。
  - **B-replica**:`SET session_replication_role = replica` 後更新 ⇒ 證明 A4a 沒發火、摘要**失真**。
  ⚠️ 三格的期望值都是「**繞得過**」——它們證明的是天花板真的存在,不是守門有效。
    這種格最容易被下一個人誤讀成「測試失敗」⇒ **每格的名字與註解都要寫明「期望繞得過」**。

### 5.3 harness 落點(Q-P3 = A,已裁)

2a-1 的 `scripts/452-verify.sh` 在 2a-2 之後**會紅**(B5 格,§3.2)。
R3 已點名這支 harness 會老化(`/Users/sean_1/pcm-mailbox/附件-D-2a1-R3換角度-findings.md:141-143` 第 6 條)。
**我的建議**:新開 `scripts/452b-verify.sh` 收本片的格,**同批**把 `452-verify.sh` 的 B5
改成新期望值 + 在該格註解裡釘「規格變更於 2a-2、出處 = 本 plan §3.2」。
理由:兩支各自證明自己那一片,不把 2a-1 的證明搬進 2a-2 的檔案裡。

### 5.4 三綠與本片的關係(不藏)

🔴 **`pnpm typecheck` / `lint` 不吃 `.sql`** ⇒ 三綠對本片是**空跑的綠**
(`20260807200000:7` 逐字)。本片的證據只有 harness 實跑。
`.sql` 的語法守門走 pre-commit(`docs/patterns/slice-checkpoint.md` §2.2a)。

---

## §6 相關既有紀錄與連動面

### 6.1 命中的既有紀錄

| 種類 | 命中項 | 與本片的關係 |
|---|---|---|
| 母 plan | `docs/specs/2026-08-13-procurement-undo-plan.md` §3(案 E 要改什麼)、§3-4 / §4c(2a-2 的兩條 must-fix)、§5 G8、§6 拍板四題 | 本片是它的下半 |
| 交接 | `docs/handoff/2026-08-13-night-run-handover.md` §2 | `#452` 現況 + 回退順序承重 |
| 前代信 | `/Users/sean_1/pcm-mailbox/D-704-STOP.md` §2(型別層/行為層兩分)、§3(B5 已觀察)、§7(W7 收據過期) | 三條都是本片的輸入 |
| runbook | `docs/runbooks/2026-08-13-452-procurement-void-rollback.md`(P4 閘未演練)、`scripts/452-down.sql` | §4.2 承重 |
| 審查 | `/Users/sean_1/pcm-mailbox/附件-D-2a1-codex關卡2-findings.md:49-50`(unvoid 繞過 A2b1)、`/Users/sean_1/pcm-mailbox/附件-D-2a1-R2換模型-findings.md:117-119`(void 也算) | §2.1 的來源 |
| backlog | `#462`(`docs/phase-1-backlog.md:12137-12143`)撤到貨之後貨沒去處 | §2.5 的已知下游缺口,本片不做 |
| backlog | `#450`(`:12065`)到貨「事後」撤銷只撤得掉剛剛那筆 | 影響 `HAS_RECEIPTS_UNDO_FIRST` 的出路好不好走 ⇒ 訊息要誠實,不能承諾撤得掉 |
| backlog | `#386`(`:10361`)到貨被額度擋下時導向溢收,DB 出口在、UI 沒接 | 同族:本片也只做 DB 出口 |
| memory | `project_0812-sean-order-ui-workflow-and-undo-needs` | 採購撤銷是刻意留的已知債、現行唯一救濟 = 手動 SQL |
| memory | `project_admin-ux-operation-intuitiveness` | 每個固定碼都要有一句「不用人教能做對」的文案 |
| memory | `feedback_honest-gap-is-for-unconstructible-not-for-cheap` | §7 的收斂紀律 |
| memory | `feedback_app-layer-must-not-ship-before-migration-apply` | §3.3 的同批 apply |
| lessons | `docs/lessons-learned.md` §12(未逐條讀,只在本片相關處按需引) | — |

### 6.2 連動檔(改本片會動到 / 被本片影響)

| 檔 | 怎麼連動 |
|---|---|
| `scripts/452-verify.sh:192-200` | B5 期望值會紅(§3.2) |
| `scripts/b2s2b-truth-sync.py:54` | `helper-452` 站點指 `20260813120000`;**本片不改 A4a** ⇒ 不受影響。⚠️ 若審查要求改 A4a 的 instock 軸,這支必須同批改 |
| `supabase/APPLIED.tsv` | apply 當天登 sha256 |
| `docs/runbooks/2026-08-13-452-procurement-void-rollback.md` | P4 閘從「寫下來的」變「跑過的」;本片另立自己的 runbook |
| `scripts/w7-coverage.sh` | 🔴 **收據現在就是紅的**(`TS_NOW=20260813120000`,交接檔 §2 逐字)⇒ 本片 apply preflight 要重跑 `bash scripts/w7-coverage.sh record all` |
| 🔴 `apps/admin/src/lib/orders/receipt-repository.ts:21-31` | 新碼 `PROCUREMENT_VOIDED` +1(§3.1)|
| 🔴 `apps/admin/src/lib/orders/receipt-action-state.ts:58-77` / `:91` | `ReceiptFailureCode` +1、`FAILURE_MESSAGES` +1(**漏寫會 typecheck 紅**)|
| `apps/admin/src/lib/orders/procurement-repository.ts:16-36` | **零改動** —— Q-S1=A 回 `CREATED`,**已在 17 碼窮盡集裡**(`:17`;R3 當場 grep 更正,我原寫 `:18`)|
| 🔴 `supabase/migrations/20260806200000:715-718` 的 A5a 錨 | 已因 2a-1 換索引而失效,本片要跟著改(§3.2)|
| `docs/phase-1-backlog.md` 的 **`#476`** | ~~13 支~~ **14 個面 / 8 支要動的檔**不認得「已作廢」,已立案、本片不做(數字 2026-08-14 V 窗逐一開檔更正;舊數法認表名、漏掉引用 domain 型別 `AdminOrderItemProcurement` 的消費端,且含 `.test.ts`) |
| 母 plan §0-C 的 **12 個讀者面** | 🔴 **v2 更正:「本片不碰應用層」已經是假的** —— §3.1 要動 2 個檔 3 行(碼集放寬)。精確版 = **本片只碰「碼集」那一面,不碰任何顯示面** ⇒ ~~**13 支讀者面**(實查數,非母 plan 的 12)~~ 🔴 **2026-08-14 V 窗再查更正 = 14 個面 / 8 支要動的檔**(舊數法 `grep -rln "order_item_procurement\|voided_at" apps packages` 認的是**表名**,漏掉引用 domain 型別 `AdminOrderItemProcurement` 的消費端 —— 漏的正好是表單新建/編輯判定、供應商下拉、採購表格本體;且舊數含 `.test.ts`)全部留給後續片,已立案 **`#476`**。⚠️ 這代表 **2a-2 apply 之後、`#476` 之前,後台畫面不會顯示「這筆撤了」**,而訂購數已把它扣掉 ⇒ **畫面列 3 件、總數說 0 件** |
| `docs/phase-1-backlog.md` | Q-P1 = A 已裁:`#452` 歸採購作廢並補條目、守門保鮮期改領 `#471`(§8.1) |

---

## §7 誠實缺口(只收**構造不出來**的)

| # | 缺口 | 為什麼構造不出來 |
|---|---|---|
| G1 | 🔴 **正式庫實際狀態未連線核對** | 我沒有正式庫連線權,且本片明令零連線。本檔所有「現況」= repo 字面 + 2a-1 交接 ⇒ **寫成 apply 前置閘,由 Sean 當面跑**(2a-1 的做法,`supabase/APPLIED.tsv:187` + `STATUS.md:10` 有先例) |
| G5 | `pg_get_functiondef` 格式**理論上**可能隨 PG 版本異 ⇒ 指紋閘可能非真漂移而紅 | 本機只有 PG 17.10 一個版本,構造不出第二個版本的輸出(`/Users/sean_1/pcm-mailbox/D-704-STOP.md` §4 同一條界) |

### 🔴 R1 折:v1 列了 5 條,**其中 3 條不合格,已移出**

我把「**架構上改不了**」誤當成「**測不出來**」。這兩件事不一樣 —— 前者是天花板,後者才是缺口。
缺口的判準只有一個:**能不能構造一個觀察**。移出的三條都能,而且都便宜:

| 原編號 | 為什麼不合格 | 移去哪 |
|---|---|---|
| ~~G2~~ `actor` 自陳 | 用兩個不同 `actor` 各呼叫一次、再讀稽核,**十幾行就證明得出 actor 可自陳** | ⇒ §5.2 正面格 **B-actor** |
| ~~G3~~ owner 可直寫 | 拋棄式庫上以 owner 直接 `UPDATE` 兩欄,證明 RPC 與稽核**雙雙被繞過** | ⇒ §5.2 正面格 **B-owner-bypass** |
| ~~G4~~ `replica` 跳 trigger | 拋棄式庫 `SET session_replication_role = replica` 後更新,證明 trigger 沒發火、摘要失真 | ⇒ §5.2 正面格 **B-replica** |

⚠️ 三條的**架構限制照舊成立**,仍要寫進函式 COMMENT 當誠實邊界 —— 
**但它們是「已知且已測的天花板」,不是「沒測的缺口」。** 這兩個詞在本 repo 不可互換。

🔴 **明文不准放進本節的**(照 `/Users/sean_1/pcm-mailbox/D-801-A.md` 驗收 4 與 memory `feedback_honest-gap-is-for-unconstructible-not-for-cheap`):
G8 併發首建(兩個 psql + FIFO 就構造得出來,且 `/Users/sean_1/pcm-mailbox/D-704-STOP.md` §2 已指派)、
U7 兄弟列守門的負測、任何「十幾行就能測」的守門、rollback 逆序演練、
**以及任何「架構上改不了」的東西**(那是天花板,要測、要寫 COMMENT,但不算缺口)、
以及「repo 裡有沒有現成樣板」(一條 `grep` 就查得到)。

---

## §8 待裁項

### 8.1 流程題 —— **三題已由主視窗裁定(`/Users/sean_1/pcm-mailbox/D-803-A.md`,2026-08-14),全裁 A**

**Q-P1 = A(已裁)🔴 `#452` 撞號:`#452` 歸採購作廢,「守門保鮮期」改領 `#471`**

發現的形狀:`docs/phase-1-backlog.md:12084` 的 `### #452.` 是「🔒 守門保鮮期:前置閘 P1-P8 的保證只活到
COMMIT 那一瞬」;而採購作廢線從 migration 檔名到 runbook 到開工令一律叫 `#452`,
連 `#462` 的條目本文也寫著「採購撤銷(`#452` 案 E)」(`docs/phase-1-backlog.md:12140`)。
⇒ **同一個號指兩件事,而採購作廢那件在 backlog 裡查無條目**
(數法 = 下面第一條 `grep -c` 只回 1,而那 1 條的標題是守門保鮮期,`docs/phase-1-backlog.md:12084`)。

數法(2026-08-14 於本 worktree 實跑,兩條都貼出來讓人重數;主視窗已獨立複跑同兩條,結果相同):
- `grep -c '^### #452\.' docs/phase-1-backlog.md` = **1**(就是守門保鮮期那條)
- `grep -oE '^### #[0-9]+[a-z]*\.' docs/phase-1-backlog.md | grep -oE '[0-9]+' | sort -n | tail -1` = **470**
  ⇒ `docs/phase-1-backlog.md:10255` 那行寫的「下一個可用號 = #457」**已過期**。
  ⚠️ 抽取式的字尾 `[a-z]*` 是刻意的 —— repo 記過「把 `#220`/`#220b`/`#220c` 壓成一條」的量具坑
  (該段 2026-08-14 01:07 由主視窗從 `STATUS.md` 搬進 `PROGRESS.md`;
  🔴 **不釘行號** —— `PROGRESS.md` 一直在長。數法 = `grep -n '#220 不是撞號' PROGRESS.md`。
  ⚠️ 這條是我自己上一段才寫下「別釘行號」、下一段就釘了 `PROGRESS.md:1441` 的自打臉,主視窗當場抓到)。

🔴 **號由主視窗直接指派,不由本片挑**(`/Users/sean_1/pcm-mailbox/D-803-A.md` §0):**D 用 `#471`、E 用 `#472`** ——
兩窗同時被指向 `#471` 是主視窗自陳的撞號,已攔下。
本片對 `#471` 只做 `ls`-式防撞確認:`grep -n '^### #471' docs/phase-1-backlog.md` = **零命中**(2026-08-14 實跑)。

裁 A 的理由(**主視窗補強了我原本那條**):我原寫「migration 檔名改不動」並自標「我推的、未實測」;
主視窗給的是實測版 —— `APPLIED.tsv` 釘的是 sha256(`supabase/APPLIED.tsv:187` = `20260813120000` / `6781c355…`),
而 08-13 D 窗**實測過「已 apply 的 migration 連純註解都不能動」**(加註解即失配、已還原複驗)
⇒ 那一側是**物理上凍結的**,不是不方便。**這條理由的出處是主視窗、不是我量的。**

⚠️ 落實時要修的字面:**我列的那張清單主視窗明說沒複驗** ⇒ 動之前先 `grep -rn '#452'` 全樹重建一張更大的清單
再逐條銷(本專案已復發 9+ 次、hook 擋過)。已知至少含:`docs/phase-1-backlog.md:12084` 標題、
`:12140` 的「採購撤銷(`#452` 案 E)」、`:10255` 的過期可用號、`STATUS.md` / `PROGRESS.md` 兩邊的 `#452` 字樣。
**另需補寫採購作廢自己的 backlog 條目**(現在查無),條目必須寫「不修未來會痛在哪」、禁空泛句。

**Q-P2 = A(已裁)片界:兩個相鄰 writer 進 2a-2,同批 apply、兩支 migration**
(void/unvoid 一支、相鄰 writer 一支)。理由見 §3.3。
主視窗補一條我沒寫的:**這也符合「一片 = 一個 apply 單位」** —— 把同一個語意變更拆成兩次 apply,
中間那段是沒人守的窗口,正是 `feedback_app-layer-must-not-ship-before-migration-apply` 的形狀。

**Q-P3 = A(已裁)新開 `scripts/452b-verify.sh`**,同批改 `scripts/452-verify.sh:197` B5 的期望值 + 註解釘出處。
🔴 **主視窗明說:§3.2 那句「這是規格變更、不是繞過守門」的判別句,不由我或他裁,由審查者裁,他不預先背書**
⇒ 已明文寫進交給 codex 的重點清單第 2 條。

### 8.2 產品題(排隊給 Sean,2-4 選項 + 推薦)

🏁 **Q-S1 = A(Sean 2026-08-14 已拍,本題結案,不得重問)**
逐字:「**當成全新的一筆收下來,舊的作廢紀錄留著查帳**」。代價他知道(同一家會看到兩列:一列已作廢、一列生效中)。
⚠️ **競態窗有例外,見 §8.6** —— 那是拍板字面的邊界,不是推翻。
🔴 **R3 折:v2 這裡還留著選項與推薦 = 殭屍題**;照它執行會把已拍的板重問一次。**已改成裁定紀錄。**

🏁 **~~Q-S2 取消作廢被「額度不夠」擋下時,那句話要給哪一種出路?~~ 隨 C 案自動作廢,不得再問。**
交接檔 `docs/handoff/2026-08-14-morning-window-rotation.md:70` 逐字:「**沒有取消作廢就沒有這一題**」。
~~A/B/C 三選項~~ 全部不適用。**§8.2 現在零待裁項。**

---

## §8.5 審查 findings 的處置紀錄(不靜默刪)

| 來源 | finding | 處置 |
|---|---|---|
| R2 important | 「§3.2 選項 (ii) 的新固定碼會同時打破 `procurement-repository.ts` 的 17 碼窮盡集 ⇒ Q-S1 兩個選項成本不對等」 | 🔴 **作廢,但不刪。** 它估的是 **(ii)** 的成本,而 Sean 2026-08-14 拍的是 **(i)**。(i) 回 `CREATED` = **已在 17 碼集裡**(`procurement-repository.ts:17`;R3 更正)⇒ 應用層零改動。**那條對應一個沒有發生的世界。** ⚠️ 但它當時是對的 —— 若 Sean 選 (ii),它就是 must-fix 級的成本漏報 |
| R2 important | 「MUT-A5a 期望值 `CREATED` 先於 Q-S1 裁定寫死」 | ✅ **已解**:裁定到達(Q-S1=A) |
| R1 CS(codex) | 「U7 在非併發下把裸 23505 轉成人話、不多餘」 | ✅ **兩輪都背書 + D 窗探針發③ 實測**(裸 23505 + 索引名)⇒ **保留 U7,問題從來不是「要不要」而是「靠什麼序列化」** |

## ~~§8.6 🔴 拍板字面的已知例外~~ 🏁 **整節作廢(C 案)**

> **這個例外的成因是「unvoid 贏了與 A5a 的競賽」** —— 沒有 unvoid 就沒有那個窗口。
> ⇒ **Sean 下一批決策題要把這條撤下來**,它本來排在那裡。
> 全文保留當歷程:

**Sean Q-S1=A 逐字**:「當成全新的一筆收下來,**舊的作廢紀錄留著查帳**」。

**實測發現那句話在競態窗有例外**(D 窗探針,C1 與 C2 皆同):
員工在「同事正在按取消作廢」的**那一瞬間**下單 ⇒ A5a 的結果是 **`UPDATED` 而不是 `CREATED`**,
最終**只剩 1 列**(那筆作廢被 unvoid 吃掉)⇒ **列上的 `void_reason` 沒了**。
- ✅ **查帳能力沒有消失**:`admin_audit_log` 裡的 void / unvoid 兩筆還在。
- ⚠️ 但「留在列上」這件事在這個窗口不成立。
- 🔴 **這不是候選案的缺陷** —— unvoid 贏了競賽本來就該這樣;是**拍板字面的邊界**。

**處置(主視窗 2026-08-14 裁)**:**不擋本片**;寫成已知例外,Sean 下一批決策題帶上。

## §9 我對本片的反對意見(不藏)

1. **本片 apply 之後、應用層片之前,後台畫面完全看不出「這筆撤了」** —— 母 plan §0-C 的 ~~12 個讀者~~ **14 個面**(2026-08-14 V 窗更正,見 `#476`)一個都沒改。
   員工會在列表上看到一筆「還在」的採購,而它其實已作廢。⇒ **這段期間不該讓員工用作廢功能**;
   要嘛應用層片緊接著做,要嘛 2a-2 apply 但功能不對外開。**這是要 Sean 知道的,不是技術細節。**
2. **`HAS_RECEIPTS_UNDO_FIRST` 指向的那條路現在不好走** —— `#450` 逐字說到貨「事後」撤銷只撤得掉剛剛那筆。
   ⇒ 訊息不能寫得像「去撤一下就好」。
3. ~~**U7 是我加的、母 plan 沒有** ⇒ 請審查者特別打這一條。~~ 🏁 **C 案刪(隨 U7)。**
4. 🔴 **C 案新增的反對意見:這一片的簡化【依賴一個不受機器保護的前提】。**
   §2.4b 的冪等簡化靠「`voided_at` 單調」,而**手動 SQL 解除作廢繞得過**
   (memory `project_0812-sean-order-ui-workflow-and-undo-needs` 逐字:採購撤銷現行唯一救濟 = 手動 SQL)。
   ⇒ 半夜有人手動 unvoid 一列之後,同 `request_id` 重放會**靜默回 `DUPLICATE_REQUEST`** = fail-open。
   **現行只靠 COMMENT 攔,沒有機制。** 這要 Sean 知道,不是技術細節。

---

## §10 假設清單(被推翻就要重估本 plan)

| # | 假設 | 推翻的訊號 |
|---|---|---|
| A1 | A4a 的 instock 軸**不加** voided 述詞(F7 維持現狀) | 若審查判定要加,§2.2 的整條論證與 `b2s2b-truth-sync.py` 都要重來 |
| A2 | void/unvoid 不動 `allocated_quantity` | 一旦改成「作廢即歸零」就變成母 plan 否決過的 C′ 案 |
| A3 | 正式庫現況 = repo 字面(G1) | apply preflight 任一格不符 ⇒ 停 |
| ~~A4~~ | ~~冪等用稽核帳(F21)~~ | 🔴 **R1 MF-6 已推翻,不再是假設**:`20260712210000:78` 的 `request_id` 索引**不是 unique** ⇒ 已改走專屬帳本表(§2.4b) |
| ~~A5~~ | ~~U7 走「鎖兄弟列」~~ | 🔴 **已推翻並定案**:(a)(b) 皆死,改走 **C1 advisory lock**(主視窗 2026-08-14 裁),且已實測 40P01=0。**不再是假設。** |
| ~~A5b~~ 🏁C刪(隨 C1) | ~~advisory 的 hash 碰撞只造成多餘序列化~~ | 🔴 **R3 折:我原本寫的逃生口不成立** —— `pg_advisory_xact_lock(int,int)` 兩個 int4 合計**仍是 64-bit**,兩個 uuid「拆開放」**放不進去**、照樣要 hash。⇒ **被推翻時沒有退路**,只能改設計(例如把序列化推到別的層)。⚠️ 已加 **MUT-ADV-KEY**(常數鍵 = 全碰撞)把這條宣稱變成觀察 |
| ~~A7~~ 🏁 **已不是假設 —— 升級成【觀察】** | ~~void 那一支也取 advisory 是為了一致性~~ | 🔴 **2026-08-14 實測**(`docs/probes/452-2a2-void-lockprobe.sh`,跑兩次結果相同):發⓪ 正向對照 `40P01=1` / 發④ `40P01=0` / 發⑤ `40P01=0`,④⑤ 各有 1 個 session 實卡在 `wait_event_type='Lock'`。<br>⇒ **`void × A5a` 兩個方向都不死結,且不是「沒併發」的假綠。** C1 整包移除有觀察支撐,不再是推論。<br>⚠️ 前提照舊:拋棄式 PG 17.10、模擬鎖形狀而非真 RPC 行為 |
| A6 | 兩支 migration 可用版本號排序保證 writer 先上(§3.3) | 若 `supabase db push` 的實際送出順序不照版本號 ⇒ 前置閘是唯一防線,要改成硬阻斷 |

— END —
