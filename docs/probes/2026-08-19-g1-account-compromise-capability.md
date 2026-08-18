# 「客人說我帳號被盜了」—— 我們今天做得到什麼(2026-08-19 G1)

> 起因:`/terms` 逐字承諾「本公司知悉您的帳號遭第三人冒用時,將**立即暫停**該帳號之交易處理及後續利用」。
> 走查窗查到:後台**零顆鈕**做得到、`customers` 表**零欄位**標得了。
> 而它建議的替代文案「協助您變更密碼」**自己標了「我沒查我們是不是連這個都做得到」** ⇒ **本份查那一格。**
> **純讀。沒有寄任何信、沒有改任何帳號、沒有動 code。**

## ① 客人自己改得了密碼嗎 ⇒ **路是通的,而最後一哩我看不到**
```
路由（唯讀 GET，2026-08-19）:
  /login/forgot   ⇒ **HTTP 200**
  /login/reset    ⇒ **HTTP 200**
  /auth/callback  ⇒ HTTP 307（無 code 時導走，正常）
鏈條（逐層開檔）:
  ForgotPasswordPage:81 → app/login/forgot/actions.ts:36 requestPasswordResetAction
  → @pcm/use-cases requestPasswordReset → IAuthService.sendPasswordResetEmail
  → **SupabaseAuthAdapter.ts:89 `supabase.auth.resetPasswordForEmail()`**
```
🔴 **那封信不是我們寄的,是 Supabase Auth 寄的** —— **不經我們的 `email_outbox`**
⇒ 所以「今天寄不寄得出去」**取決於 Supabase 的 email 設定,而那在 Sean 的面板裡、我讀不到**。
⚠️ **我證的是「程式鏈完整、路由活著」,不是「信真的會到」。** 那一格**只有 Sean 或一次真的重設能證**。
📎 相關已知:`#173` 條目寫著「落地需 Sean 在 Supabase Auth 後台**關閉 Confirm email**」
⇒ **表示那個面板是有在用的**,而**重設信與註冊驗證信是兩個不同的開關**。

## ② 員工幫得上什麼忙 ⇒ **看得到,而動不了**
```
後台有客戶頁（apps/admin/src/app/customers/[id]/page.tsx）⇒ **查得到**
而「動客人帳號」那一族的識別字，全樹（apps + packages，排除測試）:
  banned_until 0 / ban_user 0 / suspendAccount 0 / deleteUser 0 / updateUserById 0 / admin.signOut 0
  正向對照:同範圍 `auth.` ⇒ **136 命中**（尺是活的）
```
⇒ 🔴 **「查得到」與「動得了」是兩件事,而我們只有前者。**
⚠️ **而我第一發的字集被污染過**:我用了 `凍結` ⇒ **66 命中,全部是【值凍結】**(下單當下凍結的金額、視覺凍結期)
**與帳號凍結無關** ⇒ 收緊字集之後才是上面的數字。**中文同形異義,第三次。**

## 🔴 ③ 若帳號真的被盜,攻擊者做得到什麼 —— **這決定那句承諾的份量**
```
會員中心七個分頁:總覽 / 訂單 / 儲值金 / 收藏 / 我的愛車 / 收件地址 / 個人資料
【動得了】的（各自有 server action，數量=該檔 export async function 數）:
  收件地址 **3 支** / 個人資料 1 支 / 我的愛車 3 支 / 收藏 3 支
【看得到】的:訂單歷史（含**收件人姓名、電話、地址快照**）、儲值金餘額
【下得了單】:是 —— 結帳只要登入；`charge-actions` 收 `addressId`
🔴 儲值金:客人端**沒有任何「花掉它」的路**（`wallet.*(deduct|spend|扣款)|使用儲值金` ⇒ **0 命中**）
   ⇒ 而那與 Sean 08-18 拍的「儲值金業務現在不開」一致
```
⇒ **份量**:攻擊者可以**看到全部歷史訂單的收件資料**、**改收件地址**、**用受害者的卡以外的方式下單**
(卡號我們不存,3DS 由發卡行擋)⇒ 🔴 **最實際的傷害是【個資外洩】與【改地址攔貨】,不是盜刷。**
⚠️ **而「改地址攔貨」我沒有驗到底** —— 沒查「已成立的訂單能不能改收件地址」,只查了「結帳時可以選地址」。

## 🔴 ④ Supabase Auth 的停權叫不叫得動 ⇒ **叫得動,而我們從沒寫**
走查窗查到 `banned_until` 零命中,**而它自己標了「那只證明我們沒用它」**。這一格我補上:
```
`auth.admin` 全樹 **2 命中**，都在 apps/storefront/src/lib/auth/line-admin.ts:
  :50 `admin.auth.admin.generateLink({ type: 'magiclink', email })`
  :77 `admin.auth.admin.createUser({ … })`
```
⇒ 🔴 **我們手上已經有一個能呼叫 Auth admin API 的 service-role client,而且正在用它建使用者。**
⇒ **`auth.admin.updateUserById(id, { ban_duration })` 這條路【能力上是通的】** —— 缺的只是沒人寫。
⚠️ **限定**:我證的是「**同一個 client 已經在呼叫 admin API 的其他方法**」,
**不是**「我實測 ban 成功」。要證那一格得真的對一個帳號下手 ⇒ **我沒做,也不該做。**

## ⑤ ⇒ 這給 Sean 的第三條路(他現在只有「改文案 vs 蓋東西」)
```
甲 改文案（把「立即暫停」改成做得到的事）
乙 蓋東西（後台加停權鈕）
🔴 丙 **把文案指向【已經存在的那條路】**:客人自己走 /login/forgot 重設密碼
   ⇒ 重設密碼會讓舊 session 失效（Supabase 預設行為）⇒ **實質上就是「停止第三人繼續使用」**
   ⚠️ 而丙有一個前提**我沒證**:那封信今天真的寄得出去（見 §①）
   ⇒ **丙要成立，只差 Sean 確認一次 Supabase 的 email 設定，或有人真的重設一次。**
```
⇒ 🔴 **而丙比甲乙都便宜:零 code、零 migration,只改一段文案指向既有的路。**

## ⑥ 我沒做/沒查的
```
· 沒有寄任何重設信 ⇒ 「信會不會到」未證（那是丙的唯一前提）
· 沒有驗「重設密碼是否真的讓舊 session 失效」—— 我寫的是 Supabase 預設行為，**未實測**
· 沒有查「已成立的訂單能不能改收件地址」（③ 那格只查到結帳時可選地址）
· 沒有查 service role 的 GRANT 細節 ⇒ ④ 是從「同 client 已在用 admin API」推的，不是實測 ban
· 沒有動任何帳號、沒有改任何文案
```
