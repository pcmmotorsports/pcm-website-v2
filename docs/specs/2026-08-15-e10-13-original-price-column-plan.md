# `#13` 原價欄 · 片級 plan

> **片型**:🔴 **高風險片**(鐵則 12① 錢 + ③ schema)⇒ **關卡1 審 plan、關卡2 審 diff,都不降級。**
> **作者**:A 窗 `void-readers`。**每個 `檔案:行號` 都是我開檔查的,不是轉抄。**
> **狀態**:🔴 **凍結,不動手** —— §0 查到的事實**推翻了 `Q-折扣欄位=甲` 的前提**
> (那個拍板預設「經銷商下單會用經銷價」,而今天沒有任何一張訂單的 `unit_price` 是經銷價)。
> **2026-08-15 主視窗已把三題決策題連同這個前提推翻送回 Sean。在他重答之前本片零動作。**
> **本檔零行 code。**
> **上游拍板**:Sean `Q-折扣欄位 = 甲`(逐字:「加欄位,照你說的做(新單有折扣,舊單那格空白)」)
> **排程拍板**:Sean `Q-出貨單排程 = 乙` ⇒ 本片成為出貨單 C1-C4 的**硬前置**。

---

## §0 🔴🔴 先講一件會改變整片問題的事實:**「經銷價」在今天這條線上不存在**

**這不是風險章節,是前提檢查。三個獨立來源都指向同一件事:**

### 0-1 建單 RPC 逐字:只取 `price_general`,`tier` 寫死 `general`

`supabase/migrations/20260730120100_m4b_e10_n3b_create_order_new_display_id.sql`(**最新一版 `create_order`**):

```sql
:331    v_unit_price := v_variant.price_general;
:333    RAISE EXCEPTION 'create_order: 變體無有效 price_general(variant=%)', v_variant.id;
:440    v_display_id, v_uid, p_address_id, v_addr_snapshot, 'general'::public.member_tier,
```

⚠️ 前一版 `20260614130000:189` 的註解逐字寫得更白:
> **「🔴 server 取價(D3=B general-only:取 variant 自己的 `price_general`;**零 `price_store` path**)」**

### 0-2 前台:`price_store` 是**物理排除**的,不是「沒顯示」

```
apps/storefront/src/app/products/[slug]/page.tsx:8
  // public view 排除 price_store、store/premiumStore 走 dummy 0;若傳真 tier 會顯「NT$ 0」。
apps/storefront/src/app/cart/actions.ts:13
  //   priceByTier/store(public view 物理排除 price_store、UIVariant 型別無 priceByTier)。
docs/design-storefront-manifest.yaml:1194
  reason: "…階段① general-only、tier-aware 待階段⓪ 解 gate"
```

### 0-3 backlog 明寫這件事還沒做

```
docs/phase-1-backlog.md:5626
### #215. 🔴 pcm-tier cookie 非身分權威 —— M-2-08 接真經銷價前必改 server 端認證查 DB tier(經銷價洩漏地雷)
```

### 0-4 ⇒ 三個推論,逐條

| # | 推論 | 為什麼 |
|---|---|---|
| ① | **今天沒有任何一張訂單的 `unit_price` 是經銷價** | 唯一寫入者 `create_order` 只取 `price_general` |
| ② | 🔴 **「原價欄」若照字面存 `price_general`,它會與 `unit_price` 逐筆相等** | 同一個值的兩份拷貝 |
| ③ | 🔴🔴 **⇒ 出貨單那行「折扣 = 原價 − 經銷價」會恆等於 0,而欄位加了、線一樣不通** | 折扣的來源不存在 |

> 🔴 **判別句:Sean 的需求(「新單有折扣」)預設了一個【會產生折扣的機制】,而那個機制今天不在。**
> **加欄位解的是「沒地方存」,而現況的問題是「沒東西可存」。**
> ⇒ **這正是 `1a` plan §-1 診斷的那個病的又一例:拿一個保證去回答它不負責的問題。**
> **只是這次我是在【動手前】抓到,不是動手後。**

---

## §1 那折扣到底會從哪來?**有兩條路,而它們的「原價」語意不同**

### 路 A:tier 定價真的接上(`#215` → tier-aware 取價)

那時 `create_order` 對店家會員取 `price_store` ⇒ `unit_price` = 經銷價、原價 = `price_general` ⇒ **折扣天然成立**。
🔴 **但那是另一片,而且它自己就命中鐵則 12②(權限)**(`#215` 標題逐字寫「經銷價洩漏地雷」)。
⇒ **本片無法讓那條路變通。**

### 路 B:🔴 **員工手動改價 —— 而那條路【我自己的 `1a` 就是】**

`admin_update_order_item_amount`(片1a)讓員工把 `unit_price` 改成任意值。
⇒ **`1a` apply 之後,它就是本 repo 史上第一個會讓 `unit_price ≠ price_general` 的機制。**

⚠️ **而在這條路上,「原價」有兩種可能語意,兩種都講得通**:

| 語意 | 值 | 出貨單上會印成 |
|---|---|---|
| **甲:商品定價** | 下單當下的 `price_general` | 「相對定價打了多少折」 |
| **乙:改價前的成交價** | 這張單被改之前的 `unit_price` | 「這次幫你少算了多少」 |

🔴 **兩者在「員工連改兩次價」時會分岔**,而分岔之後**改不回來**(歷史值只在稽核紀錄裡)。
⇒ **這是 R3「兩案都像對且選錯難回頭」⇒ 必須停下問 Sean,不由我拍。**

---

## §2 五題逐一回答(主視窗指定)

### 2-1 欄位放哪?**新欄,不進 `product_snapshot`**

| 方案 | 影響面 | 判定 |
|---|---|---|
| **A. `order_items` 新欄** `list_price_at_checkout integer NULL` | 純 `ADD COLUMN`,不動任何既有 CHECK | ✅ **建議** |
| B. 塞進 `product_snapshot` | **要動 `order_items_snapshot_whitelist`** | 🔴 **不建議** |

**B 不建議的理由不是「比較麻煩」,是那條 CHECK 的存在理由正好相反**:

```
20260604120000:170  COMMENT ON COLUMN order_items.product_snapshot IS
  '🔴 鐵則 12 經銷價零滲入:逐欄白名單 title/sku/spec…DB CHECK order_items_snapshot_whitelist 縱深拒經銷價鍵。'
20260604120000:157  CONSTRAINT order_items_snapshot_whitelist CHECK (…
    AND (product_snapshot - ARRAY['title','sku','spec']) = '{}'::jsonb
    AND NOT ((product_snapshot->'spec') ?| ARRAY['price_store','price_by_tier','cost']))
```

⇒ **那條白名單是【經銷價防護鏈】的一環。為了塞價格欄而放寬它 = 拆掉一道防線來裝一個價格。**
⚠️ 而 `create_order:338` 還有一道**同語意的前置檢查**(`spec ?| array['price_store','price_by_tier','cost'] ⇒ RAISE`)
⇒ **走 B 要同時動兩處,而它們是刻意重複的縱深。**

### 2-2 值從哪來?`create_order` 要改 —— **而它與 `1a` 的關係要寫清楚**

- 來源 = 下單當下的 `v_variant.price_general`(`20260730120100:331` 已經在變數裡,**不必多查一次**)。
- 🔴 **`create_order` 是唯一寫入者這件事,`1a` 的 §0 已經證過,本片沿用該證明、不重證。**
- ⚠️ **兩片的關係(這條要進 §0 給關卡1 看)**:
  - `1a` 改 `unit_price`,**不動**原價欄 ⇒ **正確**(定價沒變、成交價變了)。
  - **但那只在「原價 = 甲(商品定價)」的語意下正確。若 Sean 選乙,`1a` 的 RPC 必須一起改原價欄** ⇒ **那會變成改 `1a`,而 `1a` 是凍結送審中的**。
  - 🔴 **⇒ 這是 §1 那道決策題會不會回頭動 `1a` 的關鍵,所以它排在最前面問。**

### 2-3 舊單怎麼辦?**可為 NULL、不 backfill(照 Sean 拍板),而 NULL 的處置要跟 D 對齊**

Sean 拍「舊單那格空白」⇒ `ADD COLUMN … NULL`,**零 backfill、零資料遷移**。
🔴 **而下游要處理 NULL,那是 D 的出貨單那片的事,不是本片。**

⚠️ **我原本把兩件事並列成「都找不到出處」,而主視窗給了出處之後,它們的來源等級【不一樣】** ——
**並列會讓弱的那條沾到強的那條的權威。逐條標**:

| 說法 | 來源等級 | 逐字 / 依據 |
|---|---|---|
| 「單子商品寫原價,折扣就是原價 − 經銷價的差額」 | 🟡 **Sean 逐字,對話來源,未進 repo** | Sean 2026-08-15:**「我是想說 單子商品寫原價,折扣就是 原價-經銷價 的 差額 金額, 我以為這樣比較簡單。」** |
| 「D 的個人發票不留白原則」 | ⚪ **主視窗裁定**(不是 Sean 拍的) | 主視窗 2026-08-15 訊息;**本檔不把它當拍板** |

🔴 **兩者都不是 repo 事實** —— 我實查:
```bash
grep -n '折扣\|原價\|經銷' docs/specs/2026-08-14-e10-10-print-docs-recon.md   # 零命中
```
⇒ **「Sean 逐字」比「轉述」強,但仍不是可被下一個人 grep 到的東西。**
**⇒ 本片若成案,那句逐字要進 repo(進本 plan 或 backlog),否則下一個人一樣找不到。**

### 2-4 🔴 經銷價會不會被推導出來?**今天不會,而未來會 —— 兩個答案都要寫**

**今天不會**,理由是 §0:`unit_price` 恆等於 `price_general` ⇒ `原價 − unit_price = 0` ⇒ **零資訊**。

🔴 **但這正是「這只影響 X」那種未驗邊界宣稱的形狀,所以我把條件寫出來**:

> **一旦 tier 定價接上(`#215` 之後),同一列就同時有 `price_general`(原價欄)與 `price_store`(= `unit_price`)**
> **⇒ 經銷折扣率 = 1 − unit_price / 原價,【逐筆商品可算】。**

⇒ **本片是在為一個未來的洩漏面預先鋪管線。** 那個面成不成立,取決於**誰讀得到 `order_items`**,而我查到的是:

```
20260611120000:240  REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.order_items FROM service_role;  -- 保留 SELECT
```
⚠️ **我只查到這一條,沒有查到 `order_items` 的 RLS policy 全貌。**
🔴 **⇒ 「經銷價會不會外洩」這題我現在答不完整,而它是鐵則 12② ⇒ 不能用推的。**
**⇒ 本片開工前必須補一次「誰讀得到 `order_items` 的每一欄」的完整盤點(見 §4 前置)。**

### 2-5 `1a` 的 L7:**標成【已觸發】**

`1a` plan `:521` 的 L7 逐字預告:
> **「本片的 RPC 改 `unit_price`,而訂單目前【沒有存原價】…屆時要答:片1 的 RPC 要不要一起改原價?(改單價而原價不動 ⇒ 折扣顯示會跟著漂)」**

✅ **觸發條件(「原價欄那片開工的那一刻」)已達成。**
⇒ **處置 = §2-2 那條:答案取決於 §1 的決策題,而那題會不會回頭動 `1a`,是它排最前面的理由。**
⚠️ **L7 的守門(`1a` 的 L1 寫入者 allowlist)會在本片動 `order_items` 欄位時紅** ⇒ **那是預期行為,不是回歸。**
**而「原價欄要不要進 allowlist」本身就是本片要答的題 —— 見 §4。**

---

## §3 🔴 決策題(排最前面的會改變另一片,請照順序答)

```
Q-原價-1（🔴 這題的答案可能回頭改動【已送審凍結】的片1a，所以排第一）
  「原價」指哪一個？
  A: 商品定價 —— 下單當下的 price_general。員工事後改價不動它。
     ⇒ 出貨單印「相對定價打幾折」。片1a 不用改。
  B: 改價前的成交價 —— 這張單被改之前的 unit_price。
     ⇒ 出貨單印「這次幫你少算多少」。🔴 片1a 的 RPC 要一起改，而它正在送審。
A: A|B

Q-原價-2
  §0 查到「今天沒有任何訂單的 unit_price 是經銷價」（create_order 只取 price_general、
  tier 寫死 general、前台物理排除 price_store）。那出貨單的「折扣」現在要怎麼辦？
  A: 先加欄位鋪管線，折扣那行暫時恆為 0（等 tier 上線或員工改價才有值）。
  B: 先不做這片，等「tier 定價」或「員工改價」其中一條真的產生折扣再做。
A: A|B

Q-原價-3
  欄位放哪？
  A: order_items 新欄（不動既有 CHECK）。
  B: 塞進 product_snapshot（要放寬經銷價白名單那條 CHECK）。
A: A|B
```

**我的推薦**:`Q-原價-1 = A`(不回頭動送審中的 `1a`)、`Q-原價-2 = A`(Sean 已拍乙要做出貨單,鋪管線讓那條線不再卡)、`Q-原價-3 = A`。
🔴 **但 `Q-原價-2` 我要誠實標一句**:選 A 等於**先加一個今天恆為 0 的欄位**。
**那不是浪費 —— 它讓出貨單那條線可以動工;但它也【不會讓折扣那行變得有意義】,而那件事要讓 Sean 知道再選。**

---

## §4 假設 Sean 選 A/A/A,實作長怎樣(**未批准前不動手**)

| 子片 | 內容 | 停點 |
|---|---|---|
| **P1** | migration:`ALTER TABLE order_items ADD COLUMN list_price_at_checkout integer NULL` + `CHECK (… IS NULL OR … > 0)` + 改 `create_order` 寫入 + 檔尾結構斷言 + `scripts/<版本號>-down.sql` | 🔴 **等 Sean apply** |
| **P2** | 型別重 gen + 讀取面(出貨單那片自己接) | 依賴 P1 已 apply |

🔴 **P1 的硬約束(從 `1a` 學到的,逐條沿用)**:
1. **`.sql` 對三綠恆綠零判別力** ⇒ **必須在丟棄式 PG 實跑**,而本片可**直接沿用 `scripts/e13-slice1a-verify.sh` 的骨架**
   (provision / template clone / `assert_mut` 機器裁判 / `cp`+sha256 還原,**都是現成的**)。
2. **回退腳本同片交**,含**應用層先退的硬 checkpoint**(抄 `scripts/20260815040000-down.sql`)。
3. **結構斷言不得照抄別片** —— `create_order` 是 `plpgsql`+`VOLATILE`,而它是 **`DROP`+`CREATE` 整支重寫**
   ⇒ 斷言要含「舊簽章不存在 / 新簽章存在 / ACL 仍是 `authenticated` 唯一」。
4. 🔴 **`1a` 的 L1 寫入者 allowlist 守門會紅** ⇒ **本片要主動把新欄登記進去**,而不是把守門放寬。

### 🔴 開工前置(兩條,缺一不可)

**① 「誰讀得到 `order_items` 每一欄」的完整盤點** —— §2-4 那題我現在答不完整,而它是鐵則 12②。
量法要含:RLS policy 全文 / 逐欄 GRANT / 所有 `SELECT … FROM order_items` 的 view 與 RPC / admin 端有沒有把整列吐給前端。

**② 🔴 改 `create_order` 之前,先掃「誰把它當【素材】而不是【資料】」** ——
主視窗轉來 D 窗當天的實例:Sean 把地址正典從「一樓」改成「1樓」⇒ D 的突變 `.replace('一樓','1樓')` **當場變成 no-op**
(匹配不到 ⇒ 兩格都綠 ⇒ **假通過**)。
> **判別句:我剛改的這個值,有沒有別的東西把它當【素材】而不是【資料】?**

⇒ `create_order` 被大量測試與 harness 當素材(**含我自己的 `scripts/e13-slice1a-verify.sh` seed**)。
**改它的簽章或回傳形狀之前,要先列出所有把它當素材的地方,不然那些格會靜默失效。**

---

## §5 誠實邊界

1. 🔴 **§0 的三條證據是我開檔查的**(`檔案:行號` 都在),**但它們證的是「repo 裡的字面」**。
   **線上正式庫的 `create_order` 是不是就是 `20260730120100` 那一版,我沒有授權查 —— 標未證。**
   ⚠️ 而這正是今天 E 抓到的那個形狀:**`supabase/migrations/` 是【歷史】不是【現況】**。
   **⇒ 開工前請主視窗用它的授權查一次線上 `create_order` 的 `prosrc`。**
2. 🔴 **兩條需求來源的等級不同,不要並列**(見 §2-3 的表):
   「折扣 = 原價 − 經銷價」= **Sean 逐字、對話來源、未進 repo**;
   「D 的個人發票不留白原則」= **主視窗裁定,不是 Sean 拍的**。
   兩者在 `docs/specs/2026-08-14-e10-10-print-docs-recon.md` 都**零命中**。
   ⚠️ **我原本把它們並列成「都是轉述」—— 那會讓弱的那條沾到強的那條的權威。**
   🔴 **⇒ 而 §0 查到的事實會推翻 Sean 那句逐字的前提**(它預設「經銷商下單會用經銷價」,而那今天不成立)
   **⇒ 主視窗已把這條送回給 Sean 重答。在他重答之前,本片不動手。**
3. **`order_items` 的 RLS 全貌未盤** —— 見 §4 前置①。**在那之前 §2-4 的「今天不會洩漏」只涵蓋「推導」這一路,不涵蓋「直接讀取」。**
4. **本檔零行 code、零實跑。** 上面所有「會怎樣」都是設計推論,**不是量出來的**。

---

## §6 我在等什麼

- **`Q-原價-1/2/3` 三題等 Sean。** 第一題的答案可能回頭改動送審中的 `1a` ⇒ **在它回來之前我不動 `1a`,也不開始 P1。**
- **`1a` 仍在 E 的 R2**,本片與它**不同 migration、不同版本號**,不會撞。
- **未 commit、未 push。**

— A 窗
