# 儲值金紀錄靜默截斷 —— plan(鐵則 12① 錢,**等 Sean 批,code 已還原**)

> **狀態**:🔴 **試做過、codex 對抗審查 FAIL、已還原,零程式改動留在 repo。**
> **提出**:A 窗,2026-08-17 深夜。worktree `/Users/sean_1/pcm-bmw-m`。
> **嘗試版留存**:scratchpad `wallet-attempt.ts` / `wallet-attempt.test.ts`(**不在 repo**,session 結束即消失;
> 本檔記的是**知識**,不是那份 code —— 真要復原照 §4 重寫比撿回來快)。
>
> **來源**:codex 在審查推薦引擎那片時**順手抓到的第七條**(它不在我的搜尋範圍內)。

---

## 1. 病

```
packages/adapters/src/supabase/SupabaseWalletAdapter.ts  listEntries()
  .from('customer_wallet_ledger').select(...).eq('customer_user_id', id)
    .order('entry_date', desc).order('created_at', desc)
  ⇒ 沒有 .range() / .limit()
```
PostgREST `db-max-rows` 實測 **1000** ⇒ **靜默停在第 1000 筆**(HTTP 200、`content-range` 不反映、
無 `Preference-Applied`)⇒ 會員累積 1,001 筆時**最舊的那些直接消失**,而畫面上看不出異常。

**這是金額歷史** ⇒ 鐵則 12①。

### 母體實測(service_role 側 / production / 2026-08-17,**只取計數未取內容**)

```
customer_wallet_ledger 全表   3 列
有紀錄的客人                  1 位
單一客人最大                  3 筆
```
⚠️ **母體小不是降級的理由**(主視窗當夜的紀律):ledger 每次儲值/使用/退款各 +1、**單調成長**,
「今天是 3」不是「將來不會到 1001」。📎 前例:`order_items` 庫內只有 16 列,而 Sean 一句話
(「一張訂單品項可能到 200 個」)就讓它變成**營運上緣即斷點**。

---

## 2. 🔴 我試過的修法,以及它為什麼不夠 —— **這一節是本檔的價值**

試法三道:①走既有 `fetchAllPaginated` 撈完 ②排序加 `.order('id')` 唯一鍵 tiebreaker
③先 `count:'exact'` 取總數,撈完比對,`實得 < count` ⇒ throw。

三綠 20/20、全測 506 檔 8460 綠、兩發突變各恰好紅一格。**然後 codex FAIL,7 條 must-fix。**

| # | codex 擊破的 | 為什麼它是對的 |
|---|---|---|
| 1 | **OFFSET 分頁在並發寫入下會漂移** | 1,001 筆,第 1 頁之後插入一筆 X ⇒ 第 2 頁**重複**第 1000 筆、**漏掉** X,而 `實得 1002 ≥ count 1001` ⇒ **我的防線不會 throw** |
| 2 | **ledger 不是絕對 append-only** | `ON DELETE CASCADE`(`20260523034911_init_customers_and_subtables.sql`):刪 customer 會連帶刪 ledger;「無 UPDATE/DELETE policy」只約束一般角色,**service_role/owner 不受限** ⇒ 我「實得 < count 只可能是漏了」的推論**前提錯** |
| 3 | **我的測試對「防線 3」零判別力** | 那格造的是「count 1500、資料源 1000」,helper 是**正常遇空頁停止**、根本沒命中 `MAX_PAGES` ⇒ **刪掉 MAX_PAGES 防護那格仍會綠** |
| 4 | **mock 遮掉了真實行為** | 靜態 `slice()` 不模擬「每頁重新排序再 OFFSET」⇒ **頁界漂移這個病從構造上就測不出來** |
| 5 | **我的呼叫端敘述失實** | 客人端 `WalletTab` 目前是「尚未開放」stub、**根本不呼叫 adapter**;後台 `load-customer-detail.ts` 用 `allSettled` **區塊級降級**、整頁不掛 ⇒ 我註解寫的「後台與客人端都看不出異常」**是錯的** |

🔴 **最值得記的是 #3 與 #4 合起來的形狀**:
**我寫了一句「防線 3 會把它變成 throw」,配了一格會綠的測試,而那格根本沒走到防線 3。**
⇒ 綠的、有突變證據的、註解寫得很篤定 —— **而它證明的是另一件事。**
📎 這正是 house `feedback_assertion-measures-the-wrong-thing`,而我這次是**自己給自己發的背書**。

---

## 3. 我為什麼停下來(而不是連夜折完)

```
① 涉錢（鐵則 12①），而 codex FAIL ⇒ 依主視窗約束不得 commit
② 正解是【換分頁機制】不是補條件 ⇒ 那是設計決策，不是小修
③ 母體今天是 3 筆 ⇒ 現在【不會發生】⇒ 沒有連夜趕的理由
④ Sean 已就寢，這一類最需要清醒
```
⇒ **code 全數還原、樹乾淨、零半成品進 repo。**

---

## 4. 正確方向(等批)

### 4-0 🔴 下一版設計的**前提**(不是上一版的 finding)

```
ledger 【不是】絕對 append-only。
```
「無 UPDATE/DELETE policy」只約束**一般角色**;`ON DELETE CASCADE`
(`supabase/migrations/20260523034911_init_customers_and_subtables.sql`)在刪 customer 時會連帶刪 ledger,
而 **service_role / owner 不受 policy 限制**。

⇒ **任何「筆數只會增加」的推論都不成立**,包括:
- ❌「`實得 < count` 只可能是漏了」(上一版的防線 3 建立在這句上 ⇒ 它從前提就錯)
- ❌「兩次查詢之間總數不會變小」
- ❌ 任何拿「前後兩個數字比大小」當完整性證明的做法

📎 **這條要寫在設計的最前面,不是寫在 findings 裡** —— 它決定了「完整性可以怎麼證」這個問題的答案空間,
而不只是推翻某一個實作。**下一版若又想用某種計數對帳,先回來讀這一段。**

### 4-a keyset 分頁取代 OFFSET

OFFSET 分頁的頁界會被期間的寫入推動 ⇒ 重複與漏。**keyset**(`WHERE id < :lastId ORDER BY id DESC LIMIT n`)
的游標綁在**資料本身**、不綁位置 ⇒ 並發寫入不影響已翻過的頁。
⚠️ 要求排序鍵**全序且唯一** ⇒ 仍需 `id` 收尾(試做的第 ② 道是對的,留著)。

### 4-b `count` 的角色改成「不一致就說出來」,不是「擋下來」

`count` 與列讀是**兩個請求、兩個快照** ⇒ 它天生對不齊(codex 判定)。
⇒ 不當守門,只當**回報值**:讓呼叫端知道「我拿到 N 筆,伺服器說有 M 筆」。

### 4-c 顯示端(要 Sean 拍)

codex 的判定我同意並帶上來:**對帳資料應該「該區塊明確失敗」,不能顯示殘缺清單**。
後台現行的 `allSettled` 區塊級降級**方向是對的**,要補的是**那個區塊要說出它為什麼空**。
```
甲  區塊顯示「交易紀錄載入失敗，請重新整理」＋不顯示任何列   ← codex 與我都傾向這個
乙  顯示已取得的列＋一行「清單可能不完整」
```
🔴 **乙 的問題**:對帳的人看到一份**標著警告但可以照著算**的清單,通常還是會照著算。

---

## 5. 🔴 codex 順手抓到的第三支(不在本檔範圍,要另派)

```
packages/adapters/src/supabase/SupabaseOrderAdapter.ts:496
  單一會員 1,001 筆已付款訂單 ⇒ 頂層查詢無 range/limit ⇒ 最舊訂單靜默消失
  ⚠️ `order_items` 上的 referenced-table limit【不限制 orders 本身】
```
⇒ **同族、同樣涉錢**。我沒有碰它。

---

## 6. 誠實缺口

- **母體 3 筆是「今天」** —— 沒有任何守門會在它長到 1,000 時響。
- **keyset 分頁我沒有實作也沒有實測**,§4-a 是方向不是驗過的方案。
- **`fetchAllPaginated` 的 `PAGE_SIZE = 1000` 等於(不是小於)`max-rows`** ——
  今天剛好安全(請求正好 1000、伺服器上限也是 1000),但**若 `max-rows` 被調低,
  它會把「伺服器砍過的一頁」誤判成末頁而提早收工** ⇒ 這是**共用 helper 的既有風險**,
  影響所有用它的呼叫端,不只 Wallet。**未修,未立案。**

## 7. 我需要的批准

1. **鐵則 8 + 12①**(動金額讀取路徑)。
2. **§4-c 顯示端 甲/乙**(我推薦甲)。
3. **§5 那支要不要一起做**,還是另立一片。
