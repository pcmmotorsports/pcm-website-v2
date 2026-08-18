# TapPay Sandbox 測試卡(官方文件實查,2026-08-18)

> **這些是【公開的測試卡】,不是任何人的真卡** —— TapPay 官方文件公開列出,可以進 repo。
> 🔴 **沙盒 = 假錢。正式站的付款一次都不要碰。**

## 來源(三來源律:親讀 DOM、附 URL,不憑記憶)
```
中文版:https://docs.tappaysdk.com/tutorial/zh/reference.html   （測試卡段）
英文版:https://docs.tappaysdk.com/tutorial/en/reference.html   （Test Card 段）
查閱時間:2026-08-18 夜（G3）
✅ 兩個語言版本【逐張對照過，卡號與 CVV 完全一致】
```

## 卡表(逐字)

| 卡別 | 卡號 | CVV | 官方註記 |
|---|---|---|---|
| VISA | `4242 4242 4242 4242` | `123` | Success |
| JCB | `3543 9234 8838 2426` | `123` | Success |
| **AMEX(美國運通)** | `3454 5465 4604 563` | `1234` | Success |
| MasterCard | `5451 4178 2523 0575` | `123` | 「3D 驗證時會直接授權成功」/ en:「Complete three-domain-secure transaction without OTP validation」 |
| UnionPay | `6234 5774 3859 4899` | `123` | Success |
| VISA | `4716 3139 6829 4359` | `123` | 這張回傳的 `bank_id` 與 `issuer_zh_tw` 會是空的 |

**AMEX 的卡號是 15 碼、CVV 是 4 碼**(其餘是 16 碼 / 3 碼)—— 這不是打錯,AMEX 本來就這樣。

## 有效期限
官方逐字(en 版):**"Use a valid future date for card expired year and expired month"**
⇒ **任何未來的年月都可以**,文件沒有指定某一組。

## KYC 測試值(zh 版同頁)
```
身分證字號:A123456789
電話號碼:0912345678
```

## 🔴 一個【對不起來】的地方,原樣記下,不要替它調和

```
Sean 逐字(2026-08-18，經 MAIN 轉述):
  「要刷 AE（美國運通卡）才會跳 3D 驗證」

而官方文件把 3DS 的註記掛在 **MasterCard 5451 4178 2523 0575** 上，
AMEX 那一列的註記只有 "Success"，**一個字都沒提 3DS**。
```
**兩者不一定衝突** —— 文件那句講的是「進了 3DS 之後會怎樣(直接過、不用 OTP)」,
不是「哪張卡【會觸發】3DS」。觸發與否還受商戶端的 `three_domain_secure` 設定影響。
⇒ **這一格用實測回答,不要用推論回答。** 實測結果寫進本檔下方。

## 實測紀錄
**（尚未實測 —— 卡在下面那道，等 Sean 拍板。）**

## 🔴🔴 開刷之前先看這一段:本機刷沙盒卡,訂單會寫進【正式站 DB】

三件都是量到的,不是推論:
```
① storefront 的 TapPay composition **沒有** env↔DB 配對守門
   數法:`git grep -c PROD_SUPABASE_HOST -- apps/storefront` ⇒ 0 個檔命中
   （admin 有:apps/admin/src/lib/payment/composition.ts:97-100）
② 正式站 project ref 是公開字面,釘在 apps/admin/src/lib/payment/composition.test.ts:84
③ 本機 apps/storefront/.env.local 含那個 ref 的行數 = 2
   數法:`grep -c '<ref>' apps/storefront/.env.local` ⇒ 2（只印行數,沒印任何值）
```
⇒ **本機跑結帳 = 假錢(沙盒)+ 真資料(正式站 DB)。**
   錢是假的沒錯,但 `orders` 之類的列會**真的寫進正式站**,而那是不可逆寫入(鐵則 12③)。
🔴 **這不是我可以自己拍的板(R3:動 prod DB 必停問 Sean)。**

⚠️ 而且這道**不會有紅可看** —— storefront 沒有那個配對守門,
   所以它**不會擋、不會警告、就是安靜地寫進去**。
   (admin 那道會擋,而它的訊息講 env 配對 ⇒ 兩者是完全不同的兩件事,別混。)

## 已知天花板(先寫,免得把沙盒的綠當成正式站的保證)
```
· 3DS 態 5 CANCEL 沙盒【構造得出來】；態 -1 ERROR 【構造不出來】(backlog #353)
  ⇒ 「3DS 全部驗過」這句話在沙盒裡永遠講不出來
· 沙盒證明的是「我們送出去的東西對不對」，不證明「真的發卡行會怎麼回」
· 持卡人 email 有 ≤40 字元硬限制 ⇒ 失敗可能【跟 3DS 無關】，是踩到這條
· 退款要隔日才看得到可退金額，當日退不了
```
