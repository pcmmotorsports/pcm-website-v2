# ⟦b4-MAILRENDER1⟧ 與 ⟦mail-TXNMAILSPAM⟧ 查證(2026-09-10 · 線【SEO/GEO】窗 D)

> 🔴 **這兩列 2026-09-10 凌晨就查完了,而當時只發訊息、沒有落檔。** 本檔是補的。
> 📌 **補的理由不是形式**:同一天窗 B 去 grep 一句擋了它好幾天的話,發現**那句話不在任何一份文件裡,它活在視窗之間的轉述裡**。
> ⇒ **一份沒落檔的查證,跟沒查過的差別只在「我們記得」,而我們當天已經重開過一次機。**

---

## §1 ⟦b4-MAILRENDER1⟧ —— 付款成功信,四種情境真的開起來看過了

### 量法(🔴 零寄信)

不寄信。呼叫 `packages/use-cases/src/paid-email-html.ts` 的純函式
`renderPaidEmailHtml(ctx, chrome)`,把 HTML 吐到檔案,用瀏覽器 **414px 真觸控模擬**開起來逐封讀字。

### 讀數

| 情境 | 結果 |
|---|---|
| 01 一般單(2 品項) | 版寬 414 = 視窗 414,無橫向捲。logo `https://www.pcmmotorsports.com/pcm-logo.png` **200、66,739 bytes**(兩個網域同一份 ⇒ 換網域不會破)。小計 106,400 / 運費 0 / 折扣 −790 / 訂單金額 105,610,**加得對**。兩個連結:會員中心 + 官方 LINE。 |
| 02 沒付款時間、沒訂單網址 | 付款時間**整列消失**(不是留空格);會員中心按鈕整顆不見,只剩 LINE。**空白 `<tr>` 數 = 0**。 |
| 03 品名與 SKU 是 `null` | 印「(品名未記錄)」**不是空白**。 |
| 04 十二品項 + PDF 附件 | `tr` 28 列,版寬 414 無溢位,**被截字的元素數 = 0**(沒有任何元素 `scrollWidth > clientWidth`)。長品名正常換行。PDF 那段有出現。 |

### 🟢 每一個「沒有」的正對照

`/usr/bin/grep -c` 四封對照:

```
付款時間   01=1  02=0  03=1  04=1
會員中心   01=1  其餘=0
PDF        04=2  其餘=0
```

⇒ 📌 **02 的那個「沒有」是真的沒有,不是尺死了。**

### 結論

**四種情況(正常 / 缺資料 / 品名沒填 / 十二項含附件)都不會爆版、不會留空格、金額算得對。** 不用改碼。

### ⚠️ 證不到什麼

- **沒有寄過任何一封信** ⇒ 答不出「真的信箱裡長什麼樣」(Gmail / Outlook 會自己改 CSS)。這一列問的是「有沒有人用眼睛看過」,那一格關了;「在真信箱裡長什麼樣」**沒有關**。
- 只看 414px 一個寬度;桌機版沒量。

---

## §2 ⟦mail-TXNMAILSPAM⟧ —— 資料面查到底了,而它不是一片工

### 量法(全唯讀)

`scripts/readonly-prod-sql.sh` 掃 `email_outbox` 全表 + `dig @8.8.8.8` 查 DNS。**零寄信、零設定變更。**

### 讀數 · 正式庫

```
總共 6 列, 2026-09-02 02:55 → 2026-09-07 15:45
status         sent 6 · failed 0 · dead 0
last_error_code 非空 0 列      ⇒ 沒有供應商錯誤碼可讀
attempts       最大值 1        ⇒ 每一封第一次就送出去
分類           bank_order_created 2 · order_shipped 2 · order_created 2
```

🔵 `provider_message_id` 缺 3 列,全部是 2026-09-02 那三列 ⇒ 那一欄 2026-09-06 才加(`⟦mail-PROVMSGIDUI⟧`)⇒ **是時間差,不是漏寫。**

⇒ 🎯 **這一列用資料查不出來** —— 板上寫的就是對的:它不是一片工,是「要有人去看下一封信落在哪個匣」。

### 讀數 · DNS(`dig @8.8.8.8`)

```
根網域 SPF              v=spf1 include:_spf.google.com ~all
send.pcmmotorsports.com SPF  v=spf1 include:amazonses.com ~all
                        MX   feedback-smtp.ap-northeast-1.amazonses.com   ⇒ Resend 標準設定
DKIM  resend._domainkey.pcmmotorsports.com   有, 簽的是【根網域】⇒ 與 From 對齊
🔴 _dmarc.pcmmotorsports.com  逐字 v=DMARC1; p=none;   ⇒ 沒有 rua=
🟢 正對照 同一支 dig 問 google.com ⇒ 有回值 ⇒ 尺是活的
```

⇒ 寄信的身分證明(SPF / DKIM)**是對的**,不會因為這個進垃圾匣。
⇒ 🔴 缺口只有一個:DMARC 設成「只觀察、不回報」⇒ **真的有信被擋時,我們是瞎的。**

### 結論

- **碼面不用改。**
- DNS 那一格已交給 Sean(改 `_dmarc` 加 `rua=mailto:…`,policy 維持 `p=none` 不擋信)。
  ✅ **Sean 2026-09-10 回報「改好了」** ⇒ 那一格關了。

### ⚠️ 證不到什麼

- **0 筆失敗的分母是 6** ⇒ 那個 0 是「還沒發生過任何事」,**不是「不會發生」**。
- **沒有讀 Resend 那一側的投遞事件**(要帶 API key 打它們的 API,不在唯讀授權內)⇒ 答不出「對方收了沒、進了哪個匣」。
- 這一列真正要的東西**只有寄一封真信才拿得到**,而本線零寄信 ⇒ **它等的是觀察者,不是工。**
