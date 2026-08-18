# 「客人沒收到信」查到底 —— 給 Sean 貼的兩段 SQL + 一個好消息

2026-08-19 04:0x CST,G3。**唯讀。沒有寄任何信、沒有改任何東西。**

> 起因:`email_outbox` 這張表**存在而且記著每封信到哪一步了**,
> 而 **後台零個檔讀它**(`grep -rl email_outbox apps/admin/src` ⇒ **0 檔**;
> 負向對照:同字串掃 storefront 與 packages ⇒ **3 檔** ⇒ 尺會動)。
> ⇒ 客人打來說「我沒收到信」,員工手上**沒有任何東西可以查**。

---

# 🔴 好消息先講:**要讓員工看得到,不需要 migration**

```
表已經在      supabase/migrations/20260717020000_m4a_email_outbox.sql:297
權限已經有    同檔 :391 REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role
              同檔 :396 **GRANT INSERT, SELECT, UPDATE ON TABLE public.email_outbox TO service_role**
而後台就是用 service_role 連的(BYPASSRLS)——
  出處:apps/admin/src/lib/customers/customer-repository.ts:12 逐字
  「admin 走 **service_role**(`createSupabaseServiceClient`、sb_secret_ 從 env)」
  (同族註解另見 profile-actions.ts:20、profile-form.ts:35)
```
⇒ **後台讀這張表是【純讀 + 現成權限】** ⇒ **零 migration、零 GRANT、零 apply。**
⚠️ 而「零 migration」不等於「零工」—— 還是要寫查詢與那一行 UI。**只是它不必碰 DB 結構。**

---

# 一、給 Sean 貼的:那三筆到底有沒有進 outbox

**在問什麼**:Sean 08-19 刷的三筆(`H7CPXQ` / `2DTX42` / `8X3N5Q`),
系統有沒有替它們排一封「訂單成立」通知信?排了的話,現在到哪一步?

```sql
-- Q1:那三筆的通知信狀態
select o.display_id,
       e.event_type,
       e.status,
       e.attempts,
       e.max_attempts,
       e.last_error_code,
       e.created_at,
       e.sent_at
from public.orders o
left join public.email_outbox e on e.order_id = o.id
where o.display_id in ('H7CPXQ', '2DTX42', '8X3N5Q')
order by o.display_id, e.created_at;
```

**什麼樣子代表什麼**
```
每一筆都有一列、status = 'sent'、sent_at 有時間
   ⇒ ✅ 信排了也寄了。客人說沒收到 ⇒ 問題在他的信箱(垃圾桶 / 擋信),不在我們
status = 'pending' 而 created_at 已經很久
   ⇒ ⚠️ 排了而【沒寄出去】—— 掃描器沒跑或跑了沒認領到
status = 'failed'
   ⇒ 🔴 寄失敗。看 attempts 與 max_attempts:
        attempts < max_attempts ⇒ 還會再試;attempts >= max_attempts ⇒ **不會再試了,這封信死了**
        (這一條寫在該 migration :351-353 的欄位註解,不是我推的)
status = 'skipped_no_real_email'
   ⇒ 🔴 我們**根本沒有他的真實信箱**(例:LINE 登入沒有 email)⇒ 這一筆本來就寄不出去
status = 'skipped_order_ineligible'
   ⇒ 這張單依規則不該寄
e 那幾欄整列是 NULL(left join 沒接到)
   ⇒ 🔴🔴 **那封信【從來沒有被排進去】** —— 而那是最壞的一種:
        不是寄失敗,是**沒有人試過**。而今天沒有任何東西會發現這件事。
```

**對照組(證明這段查詢會動,不是恆空)**
```sql
-- Q1-b:整張表現在到底有沒有東西(若這一段也回 0 列,代表不是那三筆的問題,是整條線沒動過)
select count(*) as 全表列數 from public.email_outbox;
```

---

# 二、給 Sean 貼的:整張表的狀態分布

**在問什麼**:「客人沒收到信」這件事,現在**規模有多大**?
而 `failed` 與 `skipped_no_real_email` 是**兩個完全不同的原因**,不能加在一起看。

```sql
-- Q2:狀態分布 + 每一種最老的那一筆有多久
select status,
       count(*)                                   as 列數,
       min(created_at)                            as 最早一筆,
       max(created_at)                            as 最新一筆,
       count(*) filter (where attempts >= max_attempts) as 已達重試上限
from public.email_outbox
group by status
order by 列數 desc;
```

**什麼樣子代表什麼**
```
sent 佔絕大多數、其餘個位數      ⇒ ✅ 這條線是健康的
failed 有列而【已達重試上限 > 0】 ⇒ 🔴 那幾封是【死信】:不會再試,而客人不知道
skipped_no_real_email 有列        ⇒ ⚠️ 那些客人我們**根本沒有信箱**
                                     ⇒ 這是產品題不是 bug(LINE 登入沒 email)——
                                       而它的量會告訴你「有多少客人本來就收不到通知」
pending 很多而最早一筆很舊        ⇒ 🔴 掃描器可能沒在跑(那是 CRON_SWEEPER_ENABLED 那個旗標)
整張表 0 列                       ⇒ 🔴 那條線從來沒動過,而不是「都寄成功了」
```
🔴 **最後那一格特別重要**:**「沒有壞消息」與「沒有消息」在這張表上長得一樣。**
所以 Q1-b 那個 count 要一起跑。

---

# 三、最小的形狀:讓員工看得到

```
放哪   訂單詳情頁,「發票」或「備註」附近加一行
長怎樣 通知信:已寄出(08-19 01:22) / 寄送失敗(已重試 5 次,不再重試) /
                未寄(排隊中) / 未排(沒有這封信) / 沒有可用信箱
要什麼 🔴 零 migration(權限已有、表已在)
       一支查詢(依 order_id 取最新一列)+ 一行 UI + 一個把六種狀態翻成人話的對照表
```
**而為什麼是「一行」不是「一頁」**:
```
員工那一刻要回答的問題只有一個 —— **「他到底收到了沒有?」**
⇒ 一行就夠。做成一整頁(收件人、payload、重試紀錄)是另一件事,而它現在沒有人在要。
```
⚠️ **這是我的建議,不是量到的** —— 真正要做要提 plan(而它不動 schema ⇒ 不是鐵則 8 的「動 schema」那一款,
但它在**金流相鄰**的訂單頁上 ⇒ 保守起見仍建議走一次審查)。

---

# 🔴 四、而這是「員工的一天」上**漏掉的一站**

```
那份 12 站清單(docs/runbooks/sean-admin-staff-day-checklist.md)裡:
  0 登入 / 1 收款 / 2 採購 / 3 到貨 / 4 尾款 / 5 出貨 / 6 退款 /
  7 備註 / 8 編輯 / 9 取消 / 10 首頁金額 / 11 篩選鈕
🔴 **沒有一站是「客人打電話來問東西」** ——
   而那才是客服一天裡最常做的事:查一張單、查一封信、查一筆退款到哪了。
```
⇒ 建議在那份清單補一站:**「客人打電話來問『我的單/我的信/我的退款』,員工查得到嗎?」**
⇒ 而今天那一站的答案是:
```
查單    ✅ 查得到(而要記得勾「顯示刷卡未付款」,否則看到的是子集)
查信    🔴 **查不到**(本檔)
查退款  ⚠️ 看情況 —— 系統內退的查得到;**系統外退的(如 PCM-2026-0102)什麼都沒有**
```

# 這一份沒有答到的
```
1. 那兩段 SQL 的實際結果 —— 我沒有 DB 憑證,**我沒有繞**
2. 那一行 UI 實際要花多久 —— 我沒有估
3. 「客人打電話」那一站要不要正式進 checklist —— 那是主視窗與 Sean 的決定
```
