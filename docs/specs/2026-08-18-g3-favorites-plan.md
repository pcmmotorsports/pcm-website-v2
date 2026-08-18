# 收藏(favorites)做成真功能 — plan · 等 Sean 批

> **狀態:🔴 尚未批准。** 本檔是 plan,不是施工紀錄。**在 Sean 批之前不動任何一顆愛心的 code。**
> 觸發:Sean 2026-08-18 下午逐字「**愛心卡要完善功能與運作**」+ `Q-愛心=甲`(要登入才能收藏)。
> 命中 **鐵則 8**(動 schema)+ **鐵則 12②**(權限 / RLS)⇒ 提 plan 等批 + commit 前跑對抗審查。
> 撰寫 G3 / 2026-08-18 15:0x CST。

---

## 0. 為什麼要做這件事(現況,全部是我開檔或量到的)

```
點愛心 ⇒ 變紅（畫面告訴客人「收藏成功」）
localStorage ⇒ 零收藏（只有購物車那兩把鑰匙）
重新整理同一頁 ⇒ 12 顆愛心，紅的 0 顆
會員中心「收藏清單」⇒ 仍然「目前尚無收藏商品」
```
兩顆愛心的 onClick 都只有 `setLiked(!liked)` = **純 React 畫面狀態**:
`ProductCard.tsx:155` / `ProductInfo.tsx:197`。
`ProductInfo` 那半**可窮舉**:全檔 `liked` **6 個命中**(`:194 :197 :367 :368 :370 :376`),
**沒有任何一個在 effect / localStorage / 送 server 的路徑上**
(該檔唯一的 `useEffect`(`:202`)重設的是 `qty`)。

`FavoritesTab.tsx:40-52` 是**純靜態元件**(零 props / 零 state / 零 hook)⇒ 無條件印空狀態,
**不是「查到 0 筆」,是根本沒有資料源**。

後端是零(實掃,附分母):
```bash
grep -rln favorite supabase/migrations/                             ⇒ 0 命中
grep -rln favorite packages/ --include='*.ts' | grep -v '\.test\.'  ⇒ 0 命中
```

⇒ **病的形狀**:它不是「功能沒做」,是「**功能沒做,而畫面說做好了**」。
`.pd-like` 還會把假成功用 `aria-pressed` 講給讀螢幕軟體聽(實測 `"false"`→`"true"`)。

---

## 1. 要改什麼

### 1-a DB:一張新表 `customer_favorites`

照 `docs/phase-1-backlog.md:5055` 逐字的預期解法
(`customer_id × product_id` + 加入 / 移除 / 列表 + RLS `auth.uid()=customer_user_id` 自讀自寫)。
欄位形狀**抄同 repo 既有的客人自有子表** `customer_addresses`
(`supabase/migrations/20260523034911_init_customers_and_subtables.sql:40-52`),不自創慣例:

```sql
CREATE TABLE customer_favorites (
  customer_user_id uuid NOT NULL REFERENCES customers(user_id) ON DELETE CASCADE,
  product_id       uuid NOT NULL REFERENCES products(id)       ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_user_id, product_id)
);
```
- **複合主鍵取代 surrogate id**:同一人同一商品只能有一筆,**由 DB 保證**,不靠應用層去重。
  ⚠️ 這是**偏離** `customer_addresses` 的 `id uuid PRIMARY KEY` 慣例 —— 偏離理由就是上一行,寫進 migration 註解。
- `ON DELETE CASCADE` 兩邊都掛:**商品下架 / 客人刪帳號 ⇒ 收藏自動消失**,不留孤兒。
- 🔴 **不放任何商品快照欄**(標題 / 價格 / 圖):收藏是「指向一個商品」,不是「當時那個商品的樣子」。
  (⚠️ 與訂單相反 —— `order_items` 有 `product_snapshot` 是因為訂單要記成交當下;收藏沒有這個需求。)
- 🔴 **不與購物車混**:`docs/phase-1-backlog.md:5058` 逐字「favorites 與 cart(localStorage mock)
  語義不同、應各自 entity、別混」。購物車現在是 localStorage,**收藏不沿用它**。

### 1-b 🔴 權限 —— **這一段是必要條件,不是保險**

`docs/patterns/revoking-function-execute-in-supabase.md:7` 逐字:
> **新表的危害比新函式大**:ADP 給表的是**整套寫權限含 `TRUNCATE`**,而 `TRUNCATE` **不受 RLS 管**。

⇒ 新表**出生就自帶 `anon` 的 TRUNCATE**,而 RLS 擋不住它。因此:

```sql
-- 兩道 REVOKE（PUBLIC 那份與具名那份，少一道都是開的；同一行寫得下）
REVOKE ALL PRIVILEGES ON TABLE customer_favorites FROM PUBLIC, anon, authenticated;
-- 只補客人自己要用的三個動作（沒有 UPDATE：收藏只有「有」與「沒有」，沒有「改」）
GRANT SELECT, INSERT, DELETE ON TABLE customer_favorites TO authenticated;
```
- **刻意不給 `authenticated` UPDATE**:一筆收藏沒有可改的東西(複合主鍵 + created_at)。
  少一個權限就少一條路。⚠️ 這也**偏離** `customer_addresses` 的 `SELECT, INSERT, UPDATE, DELETE`
  (`:236`)—— 偏離理由如上,寫進 migration 註解。
- `service_role` 不顯式 GRANT(Supabase 預設全開),但**斷言要涵蓋它**,見下。

RLS(抄 `customer_addresses` 的四條,`:166-181`):
```sql
ALTER TABLE customer_favorites ENABLE ROW LEVEL SECURITY;
CREATE POLICY favorites_select_own ON customer_favorites FOR SELECT TO authenticated
  USING (auth.uid() = customer_user_id);
CREATE POLICY favorites_insert_own ON customer_favorites FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = customer_user_id);
CREATE POLICY favorites_delete_own ON customer_favorites FOR DELETE TO authenticated
  USING (auth.uid() = customer_user_id);
```
(無 UPDATE policy —— 對應上面不給 UPDATE。)

**fail-closed 斷言**(形狀抄 `20260712210000_m4a_admin_audit_log.sql:113-115`,✅ 我開檔核過):
migration 尾端 `DO $$ … RAISE EXCEPTION … $$`,任一條不成立就**讓 apply 失敗**:
```
anon         7 個權限全零（🔴 尤其 TRUNCATE —— 它不受 RLS 管，這條是本片的主角）
PUBLIC       7 個權限全零
authenticated 恰好只有 SELECT / INSERT / DELETE，其餘 4 個全零（含 TRUNCATE）
RLS          relrowsecurity = true，且 policy 恰好 3 條
```
🔴 **同檔 §3.5 明寫「兩道 REVOKE 是必要基線,不是『已經關上』的證明」** ⇒
**驗收看的是 `has_table_privilege` 的結果,不是「我下了 REVOKE」這個動作。**

⚠️ **不依賴 E683 已 apply**:MAIN 說 Sean 15:1x 已批 E683 apply、正在排。
**本片兩道 REVOKE 照寫** —— 它保護的是這一張表,不是整個庫。

### 1-c 應用層

```
packages/domain      Favorite entity（customer_user_id × product_id）
packages/ports       FavoritesRepo：list / add / remove
packages/adapters    SupabaseFavoritesAdapter（RLS own-only，不下 user_id 過濾也拿不到別人的）
apps/storefront      · 一支 useFavorites()（單一資料源，兩顆愛心共用）
                     · FavoritesTab 從純靜態改成讀真清單（殼不動，對齊既有 acc-empty 空狀態）
                     · ProductCard / ProductInfo 的 useState 換掉
```

### 1-d 兩顆愛心怎麼同步(MAIN 第 4 題)

現在各自 `useState(false)`,**連同一顆商品在列表與商品頁都不同步**(實測:重新整理 12 顆全滅)。
⇒ 做法:**一個 client 端的收藏集合(`Set<productId>`),兩顆愛心都只讀它**。
「要同步」不是額外功能,是**有單一資料源之後自然得到的東西** —— 不另寫同步邏輯。
⚠️ 樂觀更新(點了先變色、失敗再退回)**本片要做**,否則每次點都要等一趟網路。
   失敗時**必須退回並讓客人看得見** —— 不然又變成「畫面說成功、其實沒有」的同一種病。

### 1-e 🔴🔴 **兩顆愛心在手機上其實【都】看不見 —— 而其中一顆還會吃掉客人的點擊**

**這一段是 plan 寫到一半才量出來的,它改變了本片的範圍。**

```
.pcard-heart（商品卡那顆）  product-card.css:126  opacity: 0
                            product-card.css:143  .pcard:hover .pcard-heart { opacity: 1 }
  全樹無 @media (hover: none) 覆寫（grep 過，零命中）
  兩世界實測：未 hover ⇒ opacity 0 ／ 真 hover（:hover 偽類成立）⇒ opacity 1
  ⇒ 手機沒有 hover ⇒ 它在手機上【看不見】
🔴 而它照樣吃點擊：pointer-events: auto、32×32、貼在每張商品圖右上角
  實測點它的中心座標 ⇒ elementFromPoint 命中它的 <svg>、網址沒變（/products → /products）
  ⇒ 那一下【沒有打開商品】，而客人看不到任何東西擋在那裡

.pd-like（商品頁那顆）      390 display:none、rect 0×0 ／ 1440 看得見 48×48
```

⚠️ **我先前報過「`.pcard-heart` 390 看得見 2/2」,那是錯的** ——
我的判準是 `rect.width > 0`,而 `opacity:0` 的元素照樣有 rect。**尺說看得見,客人看不到。**
已在 `FavoritesTab.tsx` / manifest / 量具檔頭三處留痕更正。

⇒ **對本片的意思**:
1. 手機客人**今天沒有任何入口可以收藏** —— 兩顆都看不見。
   ⇒ 「做成真功能」若不處理這一格,**手機客人還是收藏不了**,只是後端多了一張空表。
2. 那個**看不見卻吃點擊**的 32×32 是**現在就存在的傷害**,與收藏做不做無關。
   ⇒ 本 plan 主張**順手修掉它**(它就在同一顆按鈕上),但**怎麼修是視覺決定** ⇒ 進 §2 的樣本一起送 Sean。
3. 🔴 **`#191:5055` 的預期解法寫的是「商品頁 / 卡片『加入收藏』鈕」** ——
   那是 2026-05 寫的,當時**還沒有這兩顆鈕**。今天鈕在了,但**手機上等於不存在**
   ⇒ 那條的意圖(讓客人能收藏)在手機上**尚未達成**,不要因為「鈕已經有了」就跳過這一格。

### 1-f `.pd-like` 在 390 看不見(MAIN 第 5 題)

**實測**:`.pd-like` 在 390 `display:none`、rect 0×0;1440 看得見 48×48。
`.pcard-heart` 390 與 1440 都看得見。
🔴 **我查不出這是刻意還是漏的** —— 我沒有找到任何一條註解或拍板寫著「商品頁的收藏鈕手機不顯示」。
⇒ **本片不改它**(改 = 在手機商品頁新增一顆按鈕 = 視覺決定 = Sean 的地盤)。
⇒ **寫成一條決策題跟 plan 一起送**,他答了再做。今天的狀態:手機客人只能從**商品卡**收藏。

---

## 2. 🔴 未登入的客人點愛心 —— **這一格我不定調,出樣本給 Sean**

`Q-愛心=甲` 定的是「要登入才能收藏」,而**甲有兩種長相**:
```
甲-1  沒登入時愛心【不出現】
甲-2  沒登入時愛心【出現、可點，點了請他登入】
```
現況:那兩顆元件**完全不知道有沒有登入**(`grep auth|session|user` ⇒ 0 命中)⇒ 兩種都要新增判斷。
⇒ 依 Sean 08-17 常設令,**做成 artifact 並排給他看**,不用文字讓他想像。**本 plan 不預設哪一種。**

---

## 3. 預期影響面

```
新增   supabase/migrations/<新一支>.sql（新表 + RLS + 兩道 REVOKE + fail-closed 斷言）
       packages/domain / ports / adapters 各一支
       apps/storefront hooks/useFavorites.tsx
改動   FavoritesTab.tsx（純靜態 → 讀真清單）
       ProductCard.tsx:155 / ProductInfo.tsx:197（useState → 共用資料源）
       docs/design-storefront-manifest.yaml（favoritesEmptyState 條目要改寫，它現在還在描述空狀態）
       docs/phase-1-backlog.md #191（做完要收掉）
不動   購物車（語義不同，#191:5058）／訂單／任何金流路徑
       .pd-like 在手機看不見那件（等 Sean 答）
```
🔴 **跨 3+ 檔 + 動 schema + 動權限** ⇒ 鐵則 8 + 12② 雙中標,**commit 前跑 codex 對抗審查**。

## 4. Rollback

```
DB    新表獨立、無人引用 ⇒ DROP TABLE customer_favorites CASCADE 即回到今天
      （FK 都是 ON DELETE CASCADE 指向別人，沒有別人指向它 ⇒ 拆掉不會扯到任何既有表）
      ⚠️ 客人已收藏的資料會一起消失 —— 但那是本片才產生的資料，回到今天等於回到「本來就沒有」
Code  三支新檔刪除 + 兩處 useState 還原 + FavoritesTab 還原 ⇒ 單一 revert 可回
順序  🔴 應用層【不得】先於 migration apply 上線（memory feedback_app-layer-must-not-ship-before-migration-apply）
      ⇒ apply 完，用 PostgREST 具名參數 smoke 過了，才推應用層
```

## 5. 驗收(每條可 yes/no)

```
□ apply 後 has_table_privilege('anon','customer_favorites', <7 權限>) 逐一為 false（含 TRUNCATE）
□ 同上 PUBLIC 逐一 false
□ authenticated 恰好 SELECT/INSERT/DELETE 為 true，其餘 4 個為 false
□ 負向對照:未登入（anon JWT）打 REST 拿收藏 ⇒ 401/403 或 0 列，【不是】拿到別人的
□ 兩個帳號各收藏一件 ⇒ 互相看不到對方的（RLS own-only 實跑，不是讀 policy 文字）
□ 點愛心 → 重新整理 → 仍然是紅的（今天這一步是紅的變沒有，那正是本片要解的）
□ 換一個瀏覽器登入同一帳號 ⇒ 收藏還在（甲的整個賣點）
□ 會員中心「收藏清單」列得出剛收藏的那一件
□ 取消收藏 → 清單少一件、愛心變回空心
□ 寫入失敗時愛心【退回】並讓客人看得見（不得停在假成功）
□ 三綠 + 全套 vitest；動 .css 加 build
□ codex 對抗審查跑過、findings 修完才 commit
```

## 6. 🔴 我不確定 / 需要 Sean 或別人答的

```
1. 未登入點愛心的長相（甲-1 / 甲-2）—— artifact 送他，見 §2
2. .pd-like 手機看不見 —— 刻意還是漏的？我查不出來，要不要一起處理
3. 收藏數量要不要上限？（沒有上限 = 一個帳號可以無限 INSERT）
   ⚠️ 這條我主動提，因為 memory 記著 08-17 Sean 拍過「儲值金無上限要修」——
      同一種形狀。但我沒有量過任何濫用風險，這是【我想到的】不是【我量到的】
4. 估時 2–3 小時 ⚠️ 這是我估的，不是量的。含 plan 修訂、對抗審查、守門
```

## 7. 已核過的引用(避免下一個人重查)

```
✅ supabase/migrations/20260712210000_m4a_admin_audit_log.sql:85 / :89 / :113-115
   （:85 REVOKE ALL / :89 GRANT INSERT / :113-115 fail-closed 斷言迴圈）—— 我開檔核過，MAIN 給的行號正確
✅ supabase/migrations/20260523034911_init_customers_and_subtables.sql:40-52 / :166-181 / :235-236
✅ docs/phase-1-backlog.md:5045 #191 條目 / :5055 預期解法 / :5058「別混」
✅ docs/patterns/revoking-function-execute-in-supabase.md:1 / :7 / §3.5
⚠️ 未核:E683 那支 migration 的內容與 apply 狀態（我沒開過，也刻意不依賴它）
```
