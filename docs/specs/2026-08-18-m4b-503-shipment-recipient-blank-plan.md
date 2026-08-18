# `#503` plan · 出貨包裹的收件人可以是三個空字串

> **狀態:2026-08-18 20:2x 由 G2 寫,【尚未批准】。** 動 writer 線 ⇒ 鐵則 12 可能命中,要批才動手。
> 條目正本 `docs/phase-1-backlog.md` 的 `#503`(2026-08-15 D 窗立)。
> 🔴 **本檔對條目做了一處實質更正(§3),批之前請先讀那一段。**

## 1. 病(五層,逐層開檔複驗過,2026-08-18)

`shipments.recipient_snapshot` 的三個鍵可以**全是空字串**,而那是**合法寫入**、不是髒資料。

```
層1 shipment-launcher.tsx:157   recipient={open.data.recipient ?? { name: null, phone: null, line: null }}
層2 shipment-dialog.tsx:214     recipient: { name: recipient.name ?? '', phone: … ?? '', line: … ?? '' }
                                🔴 **最毒的一跳**：它不是漏擋，是**主動把「不知道」轉成「空字串」**
層3 shipment-actions.ts:170     原封轉送（對 recipient 零驗證、零 trim）
層4 create_shipment RPC         20260807170000:143-150 只驗「恰好三鍵的 object」，**不驗內容**
層5 DB CHECK                    20260805170000:120-126 shipments_recipient_snapshot_shape
                                只驗「三鍵 + m3_jsonb_values_all_string」
                                🔴 `''` 是 string ⇒ **過關**（函式本體 20260604120000:73-87 只看型別、不看長度）
```
⚠️ **條目原文寫「寫入鏈四層」** —— 實際是**五層**(RPC 那一道是 2026-08-07 才補的,條目沒算它)。
**五層沒有一層擋空。**

## 2. 後果

```
· 出貨單（#10 片2b）印出來沒有收件人，而員工會真的拿去寄
· 同檔 :181-184 的 COLUMN COMMENT 第一句逐字說它是「本包裹實際寄達的收件資料」
  ⇒ 讀的人會信它有內容
· 這是歷史資料問題：已經建好的箱子可能就是空的（**分佈未知，見 §5**）
```

## 3. 🔴 對條目的實質更正:**「三鍵皆非空」會擋掉一個【業務允許】的值**

條目的修法②逐字是「DB CHECK 收嚴成『三鍵皆非空白字串』」。**那條規則會退掉合法資料:**

```
create_order RPC（20260604130000:98）逐字：
  「coalesce '' 收乾淨（**空電話業務允許**、欄 DEFAULT ''）。name/line 為 NOT NULL、不需 coalesce。」
customer_addresses（20260523034911:44-46）：
  name text NOT NULL / phone text DEFAULT '' / line text NOT NULL
```
⇒ **`phone = ''` 是業務允許的正常值**(沒有電話的客人),而 `recipient_snapshot` 的來源就是這裡。
⇒ **正確的規則是:`name` 與 `line` 非空白;`phone` 允許空白。**
⚠️ 而 `NOT NULL` **不擋空字串** ⇒ `name` / `line` 在 DB 層目前也沒有非空保證
(storefront 表單是否擋,**未查證**)。

## 4. 修法(分三層,**建議一起做但可分片**)

```
甲（根因）  層2 不再把「不知道」轉成 ''。`recipient` 缺值時**不送出**，而不是送三個空字串。
            ⇒ 這一跳是謊言製造點：`?? ''` 把「我沒有資料」寫成「客人沒有名字」。
乙（體驗）  層1/2 缺 name 或 line 時，建箱按鈕**不給按**並說明原因（不要讓他按了才被 DB 退件）。
丙（保證）  層5 CHECK 收嚴：name/line 非空白（**phone 不納入**，見 §3）。
            🔴 **要先知道正式庫既有分佈**（§5）——有既有空列的話，加 CHECK 會讓那些列**連更新都做不了**。
```
**推薦:甲+乙 先做(純應用層、可逆、不碰 DB),丙 等 §5 的數字回來再決定。**
理由:甲乙擋住**新的**、且不需要任何 migration;丙是唯一能保證的,但它的風險完全取決於既有分佈。

## 5. 🔴 我拿不到的那一格:正式庫既有分佈(**要主視窗或 Sean 跑,唯讀**)

```sql
-- 唯讀，單一 SELECT，不寫入。目的：知道既有列裡有多少是空的（決定 §4 丙能不能做）。
select
  count(*)                                                              as total,
  count(*) filter (where btrim(coalesce(recipient_snapshot->>'name','')) = '') as name_blank,
  count(*) filter (where btrim(coalesce(recipient_snapshot->>'line','')) = '') as line_blank,
  count(*) filter (where btrim(coalesce(recipient_snapshot->>'phone','')) = '') as phone_blank,
  count(*) filter (where btrim(coalesce(recipient_snapshot->>'name','')) = ''
                     and btrim(coalesce(recipient_snapshot->>'line','')) = '') as name_and_line_blank
from public.shipments;
```
**判讀:**
```
name_blank = 0 且 line_blank = 0  ⇒ 丙可以直接做（沒有既有列會被擋）
其中任一 > 0                      ⇒ 丙要先決定那些列怎麼辦（補資料／放行既有列／不做丙）
                                    ⇒ 那是 Sean 的業務決定，不是工程判斷
phone_blank > 0                   ⇒ **預期會有**，而且它是合法的（§3）⇒ 不要因為這個數字收嚴 phone
```
⚠️ **我沒有正式庫存取,這一格是【未量】** —— 上面的判讀是規則,不是結果。

## 6. 驗收(甲+乙)

```
① 缺 name 或 line 時，建箱入口不給按，且畫面說得出「缺什麼」（不是通用錯誤）
② 層2 不再產生 ''：守門用突變（把 `?? ''` 加回去 ⇒ 對應那格要紅）
③ 既有正常路徑零回歸：有完整收件資料時，建箱流程與現在逐字相同
④ 四綠 + vitest 全綠
```

## 7. 這份 plan **沒有**主張什麼

```
· 沒有量過正式庫既有分佈（§5，未量）
· 沒有查證 storefront 下單表單是否擋空的 name/line（**未查證**）
· 沒有主張丙一定要做 —— 它取決於 §5 的數字與 Sean 的業務決定
· 沒有處理 #359（建箱與掛品項不是原子單位）——同一條動線的另一個缺口，不在本片
```
