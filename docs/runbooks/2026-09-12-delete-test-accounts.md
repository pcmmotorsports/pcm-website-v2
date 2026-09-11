# 刪測試帳號 —— Sean 在場時照做(2026-09-12)

> 來源:`docs/handoff/CURRENT.md`「還要 Sean 答 / Sean 做的」第 ①(留 `bsas0830@gmail.com` + `uitest@pcmmotorsports.com`)。
> 🟢 **本檔寫的時候一發 DELETE 都沒跑。** 正式庫讀數全部 2026-09-11 下午窗 B 用 `scripts/readonly-prod-sql.sh` 唯讀查。
> 🛑 PII:信箱只印遮罩(前 2 字 + 網域),真值用 `user_id` 對。

---

## 0. 白話(先看這段)

- 要刪的 13 個裡,**3 個有訂單 ⇒ 系統會拒刪**(不會偷偷把訂單一起刪掉)。剩 **10 個刪得掉**。
- 那 10 個刪掉時,會**連帶刪掉 6 筆地址**;愛車 0、收藏 0、**儲值金流水 0**。
- 🔵 之前說的「儲值金流水 3 列會被靜靜刪掉」**不會發生** —— 那 3 列是 `bsas0830` 的,而它是你要留的那個。
- 🔴 刪掉**回不去**,而我們這邊的表**沒有留任何刪除紀錄**(沒有刪除 trigger)。
- 要你答兩題(§4),答完照 §3 做,約 5 分鐘。

---

## 1. 帳號清單(`public.customers` 共 **15** 列)

| # | user_id | 信箱(遮罩) | 建立(台北) | 訂單(付款狀態/金額) | 箱子 | 地址 | 愛車 | 收藏 | 儲值流水 | 處置 |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `c2707561-5f9c-4b17-987d-8395a670a00f` | bs***@gmail.com(= bsas0830) | 05-25 | 3(refunded/4 · refunded/10,500 · unpaid/13,800) | 2 | 1 | 1 | 6 | **3** | ✅ 留 |
| 2 | `cd06eb48-d41b-4158-9816-23b436a264df` | ui***@pcmmotorsports.com(= uitest) | 08-08 | 0 | 0 | 0 | 0 | 0 | 0 | ✅ 留 |
| 3 | `3bac8bc3-8706-47f6-ae00-0405724ac297` | in***@partscheaper.net | 05-25 | **1(unpaid/4,900)** | 0 | 1 | 0 | 0 | 0 | 🛑 會被擋 |
| 4 | `8d402365-5740-4c77-ac4a-1f5eb68f643b` | g3***@pcmmotorsports.com(g3-sandbox-test) | 08-18 | **3(unpaid/1,050 · 1,000 · 1)** | **1** | 1 | 0 | 0 | 0 | 🛑 會被擋 |
| 5 | `2cd553a0-457a-4b10-97ec-acdff8ecbf88` | ma***@manual.pcmmotorsports.local | 09-04 | **1(unpaid/100)** | **1** | 0 | 0 | 0 | 0 | 🛑 會被擋 |
| 6 | `d6164add-9e01-43e7-957a-ecdc8a16eaf5` | li***@line.pcmmotorsports.local | 05-25 | 0 | 0 | 1 | 0 | 0 | 0 | 可刪 |
| 7 | `7aa60c80-623d-4517-880d-68df28b45363` | li***@line.pcmmotorsports.local | 07-02 | 0 | 0 | 1 | 0 | 0 | 0 | 可刪 |
| 8 | `511f0ff2-2055-4156-ac1f-186b8819c0e2` | li***@line.pcmmotorsports.local | 07-03 | 0 | 0 | 0 | 0 | 0 | 0 | 可刪 |
| 9 | `904e85c7-3799-48b3-8fcc-d5f372fc3a18` | ho***@gmail.com | 08-08 | 0 | 0 | 0 | 0 | 0 | 0 | 可刪 |
| 10 | `52844439-7c6c-4c71-88b7-5c68a5dd4de3` | li***@line.pcmmotorsports.local | 08-08 | 0 | 0 | 1 | 0 | 0 | 0 | 可刪 |
| 11 | `5f16b069-a7d5-4942-8851-d55c254dc173` | bs***@gmail.com(**不是** bsas0830) | 08-08 | 0 | 0 | 0 | 0 | 0 | 0 | 可刪 |
| 12 | `fa6b9bfa-c19b-4e1f-99aa-2738d491af64` | li***@line.pcmmotorsports.local | 08-08 | 0 | 0 | 1 | 0 | 0 | 0 | 可刪 |
| 13 | `531f4336-4893-4259-8404-e145b49fe36e` | li***@line.pcmmotorsports.local | 08-12 | 0 | 0 | 1 | 0 | 0 | 0 | 可刪 |
| 14 | `d5e621ed-8632-49c0-80ff-039ea730a385` | g3***@pcmmotorsports.com(g3-preview-sandbox) | 08-19 | 0 | 0 | 1 | 0 | 0 | 0 | 可刪 |
| 15 | `def39baa-84ca-4edf-af50-27b0e864cc5f` | da***@gmail.com | 08-21 | 0 | 0 | 0 | 0 | 0 | 0 | 可刪 |

合計(要刪的 13 個):有訂單 3 · 可刪 10 · 可刪那 10 個的連帶:地址 **6** · 愛車 0 · 收藏 0 · 儲值流水 0 · 折價券核銷 0(全 15 列都是 0)。

🔴 **兩格我讀不到**(唯讀帳號對 `auth` schema 是 `permission denied`):
- **`auth.users` 總數**(登入帳號可能比 15 多 —— 有登入帳號而沒有 `customers` 那一列的,上表看不到)
- **最後登入時間**
⇒ 在場時先跑 §3 步驟 1 那支 SELECT(Dashboard 的 SQL Editor 讀得到 `auth`),**數字對上才往下**。

---

## 2. 刪一個登入帳號,會連帶動到什麼(`pg_constraint` 原文,正式庫唯讀查)

```
auth.users 被刪
├─ public.customers          customers_user_id_fkey          ON DELETE CASCADE   ← 客戶資料跟著刪
│  ├─ customer_addresses     ..._customer_user_id_fkey       ON DELETE CASCADE   ← 靜靜刪
│  │  └─ orders.address_id   orders_address_id_fkey          ON DELETE SET NULL
│  ├─ customer_vehicles      ..._customer_user_id_fkey       ON DELETE CASCADE   ← 靜靜刪
│  ├─ customer_favorites     ..._customer_user_id_fkey       ON DELETE CASCADE   ← 靜靜刪
│  ├─ customer_wallet_ledger ..._customer_user_id_fkey       ON DELETE CASCADE   ← 靜靜刪(儲值金流水)
│  ├─ orders                 orders_customer_user_id_fkey    ON DELETE RESTRICT  ← 🛑 擋:整筆刪除失敗
│  ├─ shipments              shipments_customer_user_id_fkey ON DELETE RESTRICT  ← 🛑 擋
│  └─ coupon_redemptions     coupon_redemptions_user_id_fkey ON DELETE RESTRICT  ← 🛑 擋
└─ auth.identities / sessions / refresh_tokens / mfa_* / one_time_tokens / oauth_* / webauthn_*   CASCADE(Supabase 自己的登入資料)
```

- 🛑 **RESTRICT 會讓整個刪除失敗**(Dashboard 會顯示「Database error deleting user」)⇒ 有訂單的帳號**不會**被刪掉一半。
- 🔴 **這幾張表沒有任何刪除 trigger**(`pg_trigger` 查:只有 `set_updated_at` 與儲值流水的 `AFTER INSERT`)
  ⇒ CASCADE 那四張被刪時,**我們這邊沒有任何紀錄**。`customers` / `customer_wallet_ledger` 有 RLS 但沒 FORCE,postgres 身分照刪。
- 🔵 沒有外鍵的東西**不會**被刪:例如 `email_outbox` 裡寄給這些人的信件紀錄(存的是信箱字串)會留著 —— 那一格我**沒有量**有幾列。

---

## 3. 怎麼刪(推薦:SQL 先看 → Dashboard 刪 → SQL 再看)

| 方法 | 會刪到哪 | 留不留痕 |
|---|---|---|
| **Dashboard → Authentication → Users → 逐個 Delete user** ✅ 推薦 | `auth.users` ⇒ CASCADE 到上面 §2 全部 | Supabase 會寫一筆 Auth 稽核紀錄(`auth.audit_log_entries`)—— 🔴 **我讀不到 auth,這一格沒有親驗** |
| SQL `DELETE FROM auth.users WHERE id IN (…)` | 同上 | 我們這邊零紀錄;Auth 稽核也不會寫(它是 Auth 服務寫的,不是 trigger) |
| SQL 只刪 `public.customers` | 只刪客戶資料 | 🛑 **不要用**:登入帳號還在,那個信箱**仍然登得進來**,下次登入可能又長出一列(`docs/evidence/2026-09-10-測試帳號-刪之前先查.md` §3) |

> 🔵 `docs/runbooks/apply-paste-board.md` §0-b① 那條「訂單一律 `DELETE` 不要 `TRUNCATE`」:只有 §4 Q1 選乙(連訂單一起刪)才會用到。
> 甲路線**完全不碰訂單**。

**步驟 1 · 刪之前(SQL Editor,只有 SELECT)**

```sql
SELECT count(*) AS auth_users_total FROM auth.users;
SELECT u.id, u.email, u.created_at, u.last_sign_in_at,
       EXISTS (SELECT 1 FROM public.customers c WHERE c.user_id = u.id) AS has_customer_row
  FROM auth.users u ORDER BY u.created_at;
```
✅ 對照:`has_customer_row = true` 的要剛好是 §1 那 15 個 user_id。
🛑 多出來的列(有登入帳號、沒有客戶資料)⇒ **停**,那幾個不在本清單裡,要另外決定。

**步驟 2 · Dashboard 刪**:只刪 §1 標「可刪」的那幾個(依 §4 答案)。**用 user_id 對,不用信箱對**(信箱改得動)。
🔴 有訂單的 3 個按下去會失敗 —— 那是對的,**不要想辦法繞過**。

**步驟 3 · 刪之後(SQL Editor,只有 SELECT)**

```sql
SELECT count(*) AS customers_left FROM public.customers;                 -- 甲:15 − 10 = 5
SELECT count(*) AS wallet_rows FROM public.customer_wallet_ledger
 WHERE customer_user_id = 'c2707561-5f9c-4b17-987d-8395a670a00f';       -- 必須仍是 3
SELECT user_id FROM public.customers ORDER BY created_at;               -- 必須剛好剩:#1 #2 #3 #4 #5
```
(以上期望值是 Q1 甲 + Q2 甲。Q2 選乙 ⇒ 剩 11 列,多 #6 #7 #8 #10 #12 #13。)

---

## 4. 要你答的兩題

```
Q1:這 3 個帳號名下有訂單,系統會拒刪。要怎麼辦?
    #3 in***@partscheaper.net   —— 你 09-10 說過是「公司在用的帳號」;1 張未付款 4,900
    #4 g3-sandbox-test          —— 3 張未付款測試單 + 新竹第一箱 CH6D75
    #5 ma***@manual…            —— 後台手動建的客人;1 張未付款 100 + 1 箱
A:  甲 這 3 個先留著,今天只刪另外 10 個(推薦)
       ⇒ 5 分鐘做完,不碰任何訂單、錢、箱子
  | 乙 連訂單一起刪
       ⇒ 要先刪訂單(會連到付款、退款、箱子那些表),另寫一份做法再做,今天做不完

Q2:09-10 查的時候(docs/evidence/2026-09-10-6d-怎麼判一個帳號是測試的.md:56-57),這 10 個裡有 9 個被判成「真客人」
    (6 個 LINE 登入的、ho*** / da*** / 另一個 bs*** 三個 Gmail)。它們全都是你們自己測的嗎?
A:  甲 對,全是自己人或測試,照刪(照你原本說的)
  | 乙 LINE 登入那 6 個先留,只刪另外 4 個
       ⇒ 如果裡面有真客人,刪了他下次用 LINE 登入會變成新帳號,原本存的地址不見
```

---

## 5. 我沒做 / 沒量到的

- **一發 DELETE 都沒跑。**
- `auth.users` 總數、最後登入、Auth 稽核紀錄 —— 唯讀帳號讀不到 auth,**全部沒量**(§3 步驟 1 補)。
- `email_outbox` 裡寄給這 13 人的信件紀錄有幾列 —— 沒量(沒有外鍵,不會被刪)。
- 查詢原文:scratchpad `fk.sql` / `acct.sql` / `trg.sql`(只有 SELECT)。
