# `甲-11` 收件地址 —— 🔴 **停下來提 plan:主視窗指定的修法【方向是反的】**

量測戳:工作樹 `/Users/sean_1/pcm-wt-auth`(`agent/line-auth` `de1bf2b1`)· 2026-09-01 23:0x
指令逐字附在每一格。**本片零改檔** —— 我讀完才發現要停, 所以停在讀完那一刻。

---

# 🛑 主視窗給的修法:「只修【寄送時重讀】⇒ 那是小片, 而它把過期那一半解掉」

## 🔴 而我讀完那條路之後:**重讀會讓窗口【變大】, 不是變小。**

```
收件地址 = firstNonEmpty(row.notificationEmail, row.customerEmail)
              ↑ 訂單快照                ↑ 🔴 **活的帳號信箱**

出貨路徑 packages/use-cases/src/enqueue-order-shipped-emails.ts:136
付款路徑 packages/use-cases/src/enqueue-order-created-emails.ts:94   ← 兩條逐字相同
```

**而那個 `customerEmail` 是【什麼時候】讀的:**
```
出貨:supabase/migrations/20260822010000_..._scan_view.sql:246,253
        c.email AS customer_email … LEFT JOIN public.customers c ON c.user_id = o.customer_user_id
        ⇒ view 每次被查就重讀一次 ⇒ **掃描當下的活值**
付款:packages/adapters/src/email/SupabasePaidOrderScannerAdapter.ts:193 select 不含 email,
        而 :215 註解逐字「**無條件撈 fallback 信箱**」⇒ 掃描當下另查一次 ⇒ **一樣是活值**
```

## 📌 ⇒ 把 codex 的時間線攤開, 那個修法就自己垮了
```
t0  下單付款
t1  帳號 email 被改成【別人的】
t2  scanner 跑 ⇒ 讀活的 customers.email ⇒ **已經是 t1 那個錯的值** ⇒ 凍進 outbox 列
t3  sweeper 寄出

🛑 「寄送時重讀」= 把讀取從 t2 挪到 t3 ⇒ **t3 比 t2 更晚** ⇒ 窗口更長, 不是更短。
```
🔴 **⇒ 病不是「凍住」。病是【凍住的那個值本身就是後來才讀的活值】。**
📌 **⇒ 而這兩件事在 codex 的敘述裡長得一樣**(「排信當下凍住」)——
**⇒ ⇒ 而一個對的結論配一個錯的機制, 會產生一個【看起來很合理而方向相反】的修法。**
🔵 **⇒ 這與我 triage 裡那條「結論對而理由錯」是同一個病, 而這一次我差點自己照著做了。**

---

# ✅ 而真正的形狀:它不是獨立的洞, 它是【`甲-3` cutoff 貼錯】的後果之一

**因為 fallback 只在 `notification_email` 是 NULL 時才會被走到, 而:**
```
apps/storefront/src/app/checkout/charge-actions.ts:294
  notificationEmail: resolveNotificationRecipient([客人自填, user.email, built.addressEmail])
🔵 而它【不受 flag 管】—— 同檔 :290 逐字「只有『送不送第 9 參』拿出來」
⇒ ⇒ **B-4 之後的新單, notification_email 在【下單那一刻】就寫死了** = 正確語意(訂單時快照)
```
```
supabase/migrations/20260819160000_m4a_e2b_email_sweep_pgcron.sql:52 逐字:
  「填【早】了 ⇒ 掃到 B-4 之前建的舊單 ⇒ 那些單 notification_email 是 NULL ⇒ 走 customers.email」
```
🎯 **⇒ 所以 `B4_DEPLOY_CUTOFF` 貼對的世界裡, fallback 幾乎走不到。**

## 🔴 而「幾乎」那兩個字要拆開 —— 我量到一條【cutoff 貼對也還在】的路
```
resolve-notification-recipient.ts:31-41 ⇒ 三個候選全部驗不過 ⇒ **回 null**
⇒ 而驗不過的典型:LINE 合成域信箱 + 收件地址沒填 email
⇒ ⇒ **一張 B-4 之後的新單, notification_email 仍然是 NULL** ⇒ 走活的 customers.email
```
🛑 **而危險的那一格不是「客人後來補了真信箱」(那是我們要的),
    是【那個帳號的 email 後來被改成第三個人的】** —— 家人共用 / 轉手 / 打錯字。
⇒ **窄, 但不是零。而它牽 PII。**

---

# 🎯 ⇒ 三個選項(而我推薦丙)· **這是拍板題, 不是我可以順手做的**

| | 做什麼 | 代價 |
|---|---|---|
| 甲 | **拿掉 fallback** —— `notification_email` 是 NULL 就不寄 | 🔴 **那些單從「收得到」變成「一封都收不到」**, 而沒有人會發現(靜默) |
| 乙 | **補不變式**:排信時檢查「這個 email 屬於這張單」 | 🔴 DB 上**沒有這個關聯**(`-f3` 的 6a 量到的就是這件事)⇒ 要新欄位/新表 ⇒ **範圍大, 觸鐵則 8** |
| 🎯 **丙** | **只在 fallback 真的被走到時留痕 + 進告警計數**(不改寄不寄) | 只加觀測 ⇒ **今天不會少寄也不會多寄**;而我們**現在連它有沒有在發生都不知道** |

## 🔵 為什麼推丙
```
甲/乙 都在改「要不要寄給這個人」⇒ 而我們手上**沒有一個數字**說這條路一天走幾次。
⇒ 而 甲 的代價(靜默不寄)與這整條線在防的病是同一個。
📌 ⇒ 先讓它【會被看見】, 再決定要不要讓它【不會發生】—— 而那兩件不要合成一句。
```
🛑 **而丙【不解掉 PII 風險】—— 我明寫, 不要讀成「修好了」。** 它只是把分母量出來。

---

# ⚠️ 而有兩格我沒有查, 標出來
```
① 正式庫裡 notification_email 是 NULL 的【新單】有幾張 ⇒ **未查**
   (我有唯讀授權, 但這一發我沒跑 —— 因為它應該跟 甲-3 的分母一起量, 不是單獨量)
② customers.email 有沒有被改過的稽核軌 ⇒ **未查**(沒有它, 丙 的留痕只知道「走了 fallback」,
   不知道「而它與下單時不同」)⇒ ⇒ **這一格會決定丙做出來有多有用。**
```

---
# 🔵 而 `甲-9`(fetch 沒有 timeout)不受本篇影響, 可以照原順序做
它的機制我沒有推翻:`ResendEmailSenderAdapter` grep `AbortSignal|AbortController|signal:|timeout` ⇒ **零命中**。
⚠️ 而主視窗那句提醒成立:**timeout 的值要有理由** —— 而理由那一側是 `MIN_LEASE_SECONDS = 3600`
與 `SEND_TAIL_ALLOWANCE_SECONDS = 5`(`sweep-email-outbox.ts:301,316`)。
