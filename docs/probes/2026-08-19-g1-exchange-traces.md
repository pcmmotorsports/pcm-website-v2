# 換貨到底發生過沒有 —— 先問「它在資料上長什麼樣子」

2026-08-19 04:2x CST,G1。**全程唯讀。沒有連正式庫、沒有跑任何 SQL、沒有改任何 code。**

> 起因:商品頁那句承諾。⚠️ 它在 code 裡**被粗體標記切成五截**(`rpm-policies.ts:23-29`),
> 接起來逐字是:
> 「**收到商品請先檢查,如果有『瑕疵』、或是我們出錯(寄錯、出錯件),
> 請在『收貨 7 天內』用 LINE 告訴我們,我們會負責換貨處理。**」
> 📌 那個切法本身值得記一筆:**用 grep 找「7 天內用 LINE」會零命中** —— 它中間隔著一個 `{ b: … }`。
> 我們只證過「**後台沒有換貨功能**」,**沒有證「這件事有沒有在發生」。**
> 而店已經賣了一年 ⇒ 它一定在發生 ⇒ 真正的問題是「**他們現在都怎麼處理的**」。

---

# ⓪ 結論先講:**「什麼都不留」那個最壞的答案,不成立**

```
order_notes 這張表【是活的】:
  · 建表        supabase/migrations/20260729030000_*.sql
  · 掛在頁面上  apps/admin/src/components/orders/order-detail.tsx:227  ⇒ 無 flag、無條件渲染
  · append-only 刪不掉（proxy.ts:29 逐字「雙擊產生兩筆刪不掉的備註」）
  · note_type   internal / contact_log / customer_notified   （:87  CHECK）
  · channel     line / phone / email / in_person / other      （:133 CHECK）
                                    ↑ 🔴 **而那句承諾指定的管道就是 LINE**
```
⇒ 員工**有地方**把「客人 LINE 說東西壞了、我們答應換」記下來,而且記下來就刪不掉。

🔴 **而真正的缺口是另一個,不是「沒地方記」:**
**沒有任何一個欄位叫「這是換貨」。** 留下來的是**自由文字**
⇒ 只能用字串去撈 ⇒ **撈到的數字永遠是下界,不是總數。**
（而且它還要靠員工當時真的有去記 —— 那一步沒有任何東西強迫。）

---

# ① 換貨在我們的資料上,有六種可能的形狀

| # | 形狀 | 落點 | 現在活著嗎 |
|---|---|---|---|
| 1 | 客服對話紀錄 | `order_notes`(`contact_log` + `channel='line'`) | ✅ 活的、無 flag |
| 2 | 退款理由 | `order_refunds.reason`(**NOT NULL 且不得全空白**,`20260725130100:97`) | ✅ 表在 |
| 3 | 整單取消理由 | `orders.cancelled_reason`(`20260712203000:57`) | ✅ 欄在 |
| 4 | 補寄一件零元品項 | `admin_audit_log.after ->> 'zero_price_reason'`(`20260815040000:476`) | ⚠️ 見 ② |
| 5 | 寄錯 → 作廢出貨單 | `shipments.void_reason`(`20260805170000:90`) | ✅ 欄在 |
| 6 | 重開一張單 | 同客人 + 同 `variant_sku` 有兩張單 | 🔴 見 ③ |

📌 而第 1 條是**最可能**的落點 —— 因為它是唯一**不需要動錢**就能記的。

---

# ② 🔴 而第 4 條那個機制,**在換貨的情境下用不了**

唯一在**程式裡寫著「換貨」兩個字**的地方,是改品項金額那支 RPC 的錯誤訊息:
```
supabase/migrations/20260816040000_*.sql:87    （最新定義）
supabase/migrations/20260815040000_*.sql:367   （08-15 初版，同一句）
  RAISE EXCEPTION '單價改為 0 需要填原因(例:贈品 / 換貨補寄)'
apps/admin/src/components/orders/item-amount-form.tsx:144
  placeholder='例:贈品 / 換貨補寄'
```
**而同一支 RPC 上面幾行有一道收款閘**(`20260815040000:390`,逐字):
```
'這張單已經有收款紀錄(% 筆),目前不開放改金額 —— 因為「已收多少」的算法還沒定案。
  需要調整請走退款流程,或告知系統維護。'
```
而**換貨在定義上發生在收貨之後 ⇒ 一定已經付過錢 ⇒ 一定有收款列**:
```
OP3（付款確認同交易寫 card 腿）  20260810160000  ⇒ APPLIED.tsv 有  ✅
OP4（把 OP3 之前的舊單回填）      20260811050000  ⇒ APPLIED.tsv 有  ✅
```
⇒ 🔴 **唯一寫著「換貨補寄」四個字的功能,擋住了所有換得了貨的單。**

⚠️ **限定(我沒量到的)**:`APPLIED.tsv` 記的是「那支 migration 跑過」,
**不等於 OP4 的回填真的覆蓋了每一張舊單** —— 那要查庫才知道(見 ⑤ 的 Q7-e)。

---

# ③ 能不能「重開一張單、金額 0」?—— **不能**

```
後台手動建單     apps/admin/src/components/shared/admin-form.tsx:12 逐字:
                 「等 E10 手動建單/改單的頁面級大表單有真實消費端時再做」⇒ **沒做**
建單 RPC 的權限  create_order 的 GRANT 一路都只給 **authenticated**
                 （20260604130000:278 起，最新一支 20260719120000:514）
                 ⇒ 那是**客人自己的身分**，不是後台的 service_role
```
⇒ 「重開一張單」在後台**沒有按鈕、也沒有 API**。
⇒ 剩下的替代做法只有:**叫客人自己再下一張單,我們再把舊的退掉**
   —— 那會在資料上留下形狀 6(同客人同料號兩張單)+ 形狀 2(退款理由)。

---

# ④ 而後台自己已經明文承認退貨線不存在

```
apps/admin/src/components/orders/cancel-review-section.tsx:142 給員工看的字（逐字）:
  「已到貨的部分不能在這裡取消,而**退貨功能目前還沒有**;
    若你確定還有沒到貨的數量,請重新整理,仍相同就通知系統維護。」
同檔 :133-134 註解逐字:原文寫「要走退貨流程」是**指向一條不存在的流程**,2026-08-14 已止血。
```
📌 **這是一個做對的例子** —— 上一個人發現文案指向不存在的東西,**沒有補一條假流程,而是把話改成真的。**

---

# ⑤ 給 Sean 貼的唯讀 SQL(Q7 系列)

> 🔴 **要貼給 Sean 的那一份【正本不在這裡】**:
> `~/pcm-mailbox/G5-015-給Sean貼的唯讀查詢批次-20260819.md` 的 **Q7** 段(2026-08-19 04:5x 併入)。
> 查法(可重跑):`grep -n '^# Q7' ~/pcm-mailbox/G5-015-給Sean貼的唯讀查詢批次-20260819.md`
> ⇒ 落筆當下回 `483:# Q7 · 換貨到底有沒有在發生(G1,2026-08-19)`;
> 該檔同刻 `grep -c '^\`\`\`sql'` ⇒ `22`(目錄逐段相加同值)。**行號會漂,標題不會 —— 對標題不對行號。**
> 那份是**多窗共用的批次檔**,有目錄、有「什麼樣子代表什麼」、有「哪幾發保證回一列」的逐項清單,
> 而它會被繼續改 —— **要貼 SQL 請用那一份,不要用下面這幾段。**
>
> 下面留著的是**同樣的查詢 + 它們是怎麼推出來的**(每個欄位在哪支檔第幾行)。
> ⚠️ **兩份都活著就會漂**:下面這幾段若與正本不一致,**以正本為準**;
> 而改動請改正本,再回頭同步這裡(或直接把這一節改成只剩指標)。
>
> ⚠️ 全部是 `select`。**沒有 insert / update / delete。** 貼進 Supabase SQL Editor 跑。

```sql
-- Q7-a:備註裡有沒有換貨的痕跡（最可能的落點）
select o.display_id, n.note_type, n.channel, n.occurred_at, n.author, n.body
from public.order_notes n
join public.orders o on o.id = n.order_id
where n.body ~* '換貨|換一|瑕疵|壞|寄錯|重寄|不良|退換|再寄|補寄'
order by n.created_at desc
limit 100;
```
```sql
-- Q7-b:退款理由裡寫過什麼（reason 是 NOT NULL 非空 ⇒ 每一筆都有字）
select o.display_id, r.reason, r.created_at
from public.order_refunds r
join public.orders o on o.id = r.order_id
order by r.created_at desc
limit 100;
```
```sql
-- Q7-c:整單取消的理由
select display_id, cancelled_at, cancelled_reason
from public.orders
where cancelled_reason is not null
order by cancelled_at desc
limit 100;
```
```sql
-- Q7-d:同一個客人、同一個料號下過兩次以上（「重開一張單」的形狀）
select o.customer_user_id, i.variant_sku,
       count(distinct o.id) as 幾張單,
       min(o.created_at) as 第一張, max(o.created_at) as 最後一張
from public.order_items i
join public.orders o on o.id = i.order_id
group by o.customer_user_id, i.variant_sku
having count(distinct o.id) > 1
order by 最後一張 desc
limit 100;
```
```sql
-- Q7-e:改金額那支 RPC 的收款閘，實際上會擋掉多少單（= 已收款單的比例）
select count(*) filter (where p.n > 0) as 有收款列,
       count(*) filter (where p.n = 0) as 沒有收款列,
       count(*) as 總單數
from public.orders o
join lateral (select count(*) as n from public.order_payments x where x.order_id = o.id) p on true;
```
```sql
-- Q7-f:出貨單有沒有被作廢過（寄錯 → 作廢重出的形狀）
select void_reason, count(*)
from public.shipments
where void_reason is not null
group by void_reason
order by count(*) desc;
```

**怎麼讀**
```
Q7-a 回 0 列  ⇒ 🔴 **不是「沒發生過換貨」**，是「**沒有人把它記進系統**」
                  ⇒ 那才是更該修的事：換貨在發生，而系統一個字都不知道
Q7-a 有列     ⇒ ✅ 有人在記 ⇒ 看 author 是誰、看 channel 是不是 line
                  ⇒ 那就是現行的土法煉鋼流程，照著它做功能比重新設計快
Q7-d 有大量列 ⇒ ⚠️ 不一定是換貨（回購也長這樣）⇒ 要配 Q7-b 的退款理由一起看
Q7-e 有收款列 ≫ 沒有 ⇒ 印證 ② 那格：那個功能對絕大多數的單都按不動
```

---

# ⑥ 那兩封 Supabase 寄的信,什麼時候會被觸發

> 主視窗加的一格。**只讀 code,沒有觸發任何一封。**

### 重設密碼信 —— **常態,而且只有一條路**
```
兩個呼叫點，都在 /login/forgot 這一頁：
  ForgotPasswordPage.tsx:81   客人按「送出」
  ForgotPasswordPage.tsx:103  客人按「沒收到？再寄一次」
往下：requestPasswordResetAction → requestPasswordReset → sendPasswordResetEmail
     → supabase.auth.resetPasswordForEmail（SupabaseAuthAdapter.ts:89）
🔴 **沒有後台觸發的路徑、沒有自動觸發的路徑。** 客人自己按、按了就寄。
```
⇒ **客人一定收得到一封我們沒審過內容的信** —— 而且是他正在找路進來的那一刻。

### 註冊驗證信 —— **取決於一個我們看不到的開關**
```
觸發點只有 auth.signUp（SupabaseAuthAdapter.ts:40）
而【寄不寄】不在 code 裡，在 Sean 面板的 Confirm email 開關：
  packages/domain/src/identity/auth.ts:43 逐字：
    「Phase 1 = Q1=A『Confirm email OFF』（2026-05-23 Sean 拍板…）」
  code 只讀得到結果：needsEmailConfirmation = (data.session === null)
```
**而開關若被打開,客人不會被靜默卡住** —— 這條路有處理:
```
apps/storefront/src/app/register/actions.ts:73-75
  if (result.needsEmailConfirmation) {
    return { formError: '註冊成功，請至信箱完成 Email 驗證後再登入。' };
  }
註解 :12 逐字：「email confirm 重開後（backlog #173）… 回 formError 提示、不 redirect（防無 session 假導向）」
```
⇒ ✅ **「客人註冊完收不到信就進不來、而且畫面沒說」這個最壞情況,不成立** —— 畫面會告訴他去收信。
⇒ 🔴 **而我們仍然不知道那封信寫了什麼,也不知道那個開關現在是哪一邊。**
   「預期不命中」是**拍板紀錄**,不是量測 ⇒ 要量,見下面那段 SQL。

```sql
-- Q7-g（唯讀）：Confirm email 開關現在是哪一邊 —— 從結果反推
-- 若每個人的 email_confirmed_at 都等於 created_at ⇒ 是自動確認的 ⇒ 開關是 OFF
select count(*) as 總人數,
       count(*) filter (where email_confirmed_at is null)                as 從未確認,
       count(*) filter (where email_confirmed_at = created_at)           as 建立當下就確認,
       count(*) filter (where email_confirmed_at > created_at)           as 事後才確認
from auth.users;
```
📌 「事後才確認 > 0」⇒ 那些人**真的收過那封我們沒審過的信,而且點了它**。

---

# 這一份沒有答到的

```
· 🔴 沒有連正式庫 —— 上面每一段 SQL 都【沒有跑過】，它們是給 Sean 貼的，不是結果
· 🔴 Q7-a 的字集（換貨|瑕疵|寄錯|…）是我列的 ⇒ **員工用別的說法寫的撈不到**
     ⇒ 這一格永遠是下界。要收斂只能真的去讀那些 body
· 🔴 LINE 官方帳號裡的對話本身 —— 承諾指定的管道就是它，而它不在 repo、也不在 DB
     ⇒ 就算 order_notes 全空，換貨的證據可能全都在那支手機裡
· OP4 回填「跑過」≠「覆蓋了每一張舊單」（見 ② 的限定；Q7-e 才答得出來）
· 沒有查「換貨之後庫存怎麼平」—— 那是另一條線
```

**鐵則 8** 未命中(不動 code、不動 schema)。**鐵則 12** 六類逐字對過:未命中(純文件 + 唯讀 SQL 草稿,未執行)。**未 push。**
