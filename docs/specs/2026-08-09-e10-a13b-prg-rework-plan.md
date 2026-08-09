# M-4b E10 · A13b 表單 PRG 整頁化 plan **v2**(換路)

> E 窗 · worktree `/Users/sean_1/pcm-cancel-ui` · branch `cancel-ui` · 基底 `76c27011`
> 主視窗裁決:`E-012-A` **Q1=A**(PRG 整頁化)+ 三條約束;**C 永久否決**;B 備而不用。
> 狀態:**待主視窗過目**(v2 = 折入 codex 關卡1 的 **15 條 must-fix**〔R1 判定 FAIL〕+ 主視窗 `E-014-A` 的 Q1=A / Q2=A)。
> 前情:`E-011-STOP`(停手理由與四輪嘗試實測)、`E-013-STOP`(v1 進度)。
>
> 🔴🔴 **開工硬前置(主視窗 `E-017-A` 寫死)**:codex 關卡1 **R1 判 FAIL / 15 must-fix**,本 v2 已逐條折入(§7),
> **但 v2 本身尚未再經任何審查** ⇒ **新窗開 C1 之前必須先跑關卡1 R2**,不得直接動 code。
> 理由:v2 動的是形狀(§1 目標形狀、§2-3 三道疊加、§3 片界重切),不是改字面。

---

## §0 v2 最重要的兩個更正(v1 的字面是錯的,先講)

1. 🔴 **v1 §2 說「不預選模式 ⇒ 形狀上不可能因為沒選而變成整單」—— 這句話是假的。**
   不寫 `checked` 只保證**HTML 初始值**;**autofill / bfcache / 瀏覽器表單狀態復原**都能把 `full` 勾回來,
   而解析器會正常接受(`cancel-form.ts:172-182`)。
   ⇒ 主視窗 `E-012-A` 第三條約束**在 v1 的落地方式下不成立**。v2 的解法見 §2-3(三道疊加 + 真瀏覽器負測)。
2. 🔴 **v1 §4 Q1 我主張「洩漏 token 做不了事,因為 RPC 還要 payload_hash」—— 不精確。**
   hash 是由 order/原因/說明/品項**重算**的;真正還需要 `service_role` 與有效 `actor`
   (`20260805100000:195-208`/`:354-356`/`:495-497`)。洩漏**不會**讓人取消訂單,
   但**會洩漏關聯、並且可以偽造畫面狀態**。
   ⇒ 我一度改推薦 flash cookie;**主視窗 `E-014-A` 裁 Q1=A(rt 進 URL)並正式改寫片 4 紀律**,
   v2 照 A 落地(§4)。偽造畫面狀態那一半由「**server 永遠先查帳本**」消掉(§1),不靠 URL 可信。

## §1 目標形狀(v2)

| 面 | v1 | **v2** |
|---|---|---|
| 成功 | `redirect(detail?r=order_cancelled)` | 不變 |
| 失敗 | `redirect(detail?r=<碼>&rt=<token>)` | 🔴 形狀不變,但**三前提到位**(§2-2):值單獨不可行使 + **看過即清除** + 不含業務內容 |
| 凍結判定 | 讀 query | 🔴 讀 query **但只當「要顯示哪一格」的線索**;所有事實一律**先查取消帳本**(拿 `rt` 對 `cancellations[].idempotencyKey`)才敢說 —— URL 被偽造也只能讓人看到帳本的真話 |
| `denied` / `order_id` 解不出來 | 導回明細頁 | 🔴 **導去固定安全頁 `/orders`**(那條路手上沒有可信 orderId,為了導頁去讀表單會破壞「未授權零讀欄位」) |
| 結果面板位置 | 表單內 | 🔴 **移到頁層、在取消資格閘之外**(否則 RPC 成功關單後表單消失,義務 5 的比對跟著消失) |
| 表單狀態 | client state | **零 client state**(純 `<form action>`) |
| history 語意 | (v1 沒想) | 🔴 `redirect()` 在 Server Action **預設 push** ⇒ 失敗導頁要用 **replace**;頁層再配 **canonical 清除出口**(讀過就把 `r`/`rt` 從網址拿掉)⇒ 重新整理不會重建凍結態、上一頁也重播不了 |

⇒ 成功那顆 `?r=order_cancelled` 維持既有機制;失敗那組看過即清。

## §2 三條約束的落地(v2;逐條對 `E-012-A`)

1. **跨片走關卡1**:v1 已跑(FAIL / 15 MF、零留痕)→ 本 v2 逐條折入(§7)。
   🔴 **v2 本身尚未再經審查**(交棒裁決 `E-014-A`:plan v2 落信箱 → 主視窗過目 → CLOSE → **實作換新窗**)
   ⇒ **建議新窗開 C1 之前先跑一輪關卡1 R2**(理由:v2 動了 §1 的形狀與 §2-3 的三道疊加,不是小改字面)。
2. 🔴 **URL 只帶碼不帶內容**(主視窗 `E-014-A` 改寫後的紀律,逐字落地):
   「授權性 token 不進 URL(原紀律保留);**非授權性一次性識別碼可進**,前提=
   ①**值單獨不可行使**(`rt` 需 `payload_hash` + `actor` 相符才有意義)
   ②**看過即清除**(canonical 清除出口)③**不含業務內容**」。
   ⇒ query **只准** `r`(結果碼)與 `rt`(uuid);金額/品名/數量/說明一律不進。
   🔴 同步改 `cancel-action-state.ts` 那段「不要把 token 塞 URL」的註解(B 片實作時一起改,不留過期字面)。
3. 🔴 **失敗後不得默默退回整單** —— v1 的做法被打掉,v2 改成**三道疊加**:
   - ①`cancel_mode` 的兩顆 radio 都不寫 `checked`,且 `<form autoComplete='off'>`;
   - ②原因 `<select>` 第一項是 `<option value=''>請選擇</option>` 並 `required`
     (沒有空 placeholder 時瀏覽器會自動選第一個 ⇒ 「重選」根本沒發生);
   - ③🔴 **server 端最終防線**:`cancel_mode` 只接受**明確送來的** `full`/`partial`,
     且 **`full` 必須額外帶一個一次性的 `full_confirm` 欄**(該欄只在員工真的點了「整單取消」時才被渲染出來)
     ⇒ **autofill/bfcache 把 radio 勾回 `full` 也送不出整單取消**,因為那顆確認欄不會被復原。
   - 驗收:**真瀏覽器負測**(不是 jsdom)——失敗一次 → bfcache 返回 → 再送 → 斷言送出的**不是**整單取消。
     🔴 **沒有這條真瀏覽器負測,約束 3 就只能宣稱、不能主張**(codex 逐字)。

## §3 拆片(v2;合併了 v1 被指出會產生假綠中間態的幾片)

| # | 片 | 內容 | 驗收 | 片型 |
|---|---|---|---|---|
| **C1** | **PRG 出口 + 表單重寫(合併)** | `cancel-actions.ts` 失敗改 `redirect(..., replace)` 帶 `r`+`rt`;`cancel-action-state.ts` 的 state 型別退場;`cancel-section.tsx` 整支重寫成零 state。🔴 **必須同片**:B1 若改簽章、舊 `useActionState` 立刻不相容;若保留簽章,純 `<form action>` 會把 `FormData` 當 `prevState` | 六個失敗碼各導到對的出口;`denied`/orderId 解不出 → `/orders`;**`revalidatePath` 拋錯仍必導頁**(用會拋的 redirect mock 驗它沒被 catch,且導頁前 log 與 revalidate 都已完成) | **高風險**(①錢) |
| **C2** | 頁層結果面板 + canonical 清除 + 接線 | `page.tsx` 讀 `r`/`rt` → **先查帳本**(token 對 `cancellations[].idempotencyKey`)→ 決定顯示什麼;面板掛在**取消資格閘之外**;同片把 `CancelReviewSection` 與 `CancelSection` 接上 `order-detail.tsx` | `rt` 缺失/非 uuid ⇒ **fail-closed 顯示「無法核對」**,不得當成「沒失敗」而開放表單;RPC 已關單時面板仍在;**看過即清除**(清除後重新整理不再出現凍結態) | 高風險 |
| **C3** | 真瀏覽器負測 | §2-3 的 autofill/bfcache 負測 + 「失敗→再送永不變整單」 | 負測在**修法拿掉時轉紅**(突變驗) | 高風險 |
| **C4** | 義務 5 收尾 | server 端比對 + 補 `cancellationsTruncated`(舊 token 落在被截的 100 筆外要說得出「可能在沒列出的那批」) | 三分支文案正確 | 高風險 |
| **C5** | 逐品項勾選 | 🔴 **不是「照原 plan」**:零 state 形狀要重新定義「切回 `full` 時怎麼排除殘留 `cancel_item`」「切離 `other` 時怎麼排除說明欄」——否則會一直被解析器擋 | 切換模式後送出不含殘留欄 | 高風險 |

估時:C1 60m / C2 45m / C3 45m / C4 30m / C5 45m。

🔴 **內容分級(鐵則 9,v1 漏標)**:新增的失敗文案與結果碼 = **L1**(年 0-1 次改、hardcode 可);
理由:它們是系統狀態說明,不是營運內容。**不需要後台 CRUD**。

## §4 兩題已裁(主視窗 `E-014-A`:Q1=A / Q2=A)

**Q1 = A(rt 進 URL)—— 主視窗 `E-014-A` 已裁,不是我推翻片 4。** 三前提落地在 §2-2。

🔴 **codex 對 A 提的兩個攻擊,v2 各給一個答案**(這是 A 案能成立的前提,不是附註):
- **「持有舊 token 的人組 `r=rejected&rt=…` 讓頁面把舊紀錄說成我剛送的」** ⇒
  **URL 不是事實來源**:頁層只把 `rt` 當「要對哪一筆」的線索,**顯示什麼一律由帳本查出來**
  (§1)。偽造者最多讓自己看到一段帳本裡本來就有的真話,騙不出「畫面說有、實際沒有」。
  ⚠️ 殘餘:它仍會**洩漏關聯**(誰有那顆 token 就知道那筆存在)—— 對象是已登入的後台使用者,收在此。
- **`redirect()` 預設 push ⇒ 進歷史、可重播** ⇒ 失敗導頁一律 **replace**,並配 canonical 清除出口(§1)。
⚠️ B 案(flash cookie)為了避一個小暴露面,要引進整套儲存 + 過期語意 = 在正要去風險的片上加故障面(主視窗理由,我同意)。

```
Q2: 失敗後員工填的內容要不要保留?
A: 全部不保留、一律重填(原因與模式都從**無效空值**起始 + required)  ← v2 仍推薦,但加了「空值起始」
```
🔴 v1 漏掉的一格:`<select>` 沒有空白 placeholder 時**瀏覽器會自動選第一個原因** ⇒
「員工重選七選一」根本沒發生、他會送出一個他沒選過的原因。v2 的 §2-3② 補上。

## §5 三視角 / rollback / 紅線

- 擴充性:C5 接上時,失敗路徑不必想「怎麼把勾選帶回來」——答案是不帶回、叫他重選(§2-3)。
- 可維護性:狀態單一來源(URL query → server **先查帳本** → props),沒有 client/DOM 兩份會分岔的真相。
- 追蹤性:失敗碼與 token 進 server log(不進 URL);`rt` 讓 log 與帳本對得起來。
- rollback 逆序 C4→C3→C2→C1;**C1 不可單獨 revert**(表單與 action 同片)。
- 紅線:不 push、不動 STATUS/CURRENT、不 apply migration、不碰 `.env*`、精準 add。
- 🔴 **不得為了讓測試變綠而弱化斷言**(`E-011-STOP` §2);C3 的真瀏覽器負測要配突變驗。

## §6 誠實邊界

1. **PRG + `revalidatePath` 在本 repo Next 版本上的實際互動仍未實測** ⇒ C1 第一動是最小實測,證不出來回頭改 plan。
2. **canonical 清除出口是本線第一次做的機制**,repo 內無同款前例 ⇒ C2 要連「清除後重新整理不再出現凍結態」一起配測試。
   ⚠️ 清除發生在 client(讀完把 query 拿掉)還是 server(再 redirect 一次)尚未定 —— C2 第一動先實測兩種在本 repo Next 版本上的行為,再挑。
3. **舊形狀已修的六條不整批帶過來**(形狀變了,語意不同)。
4. 🔴 **真瀏覽器負測本窗沒做過**(前面全是 jsdom)⇒ C3 可能需要額外工具面,估時可能不準。

## §7 codex 關卡1 R1 對帳(FAIL · 15 must-fix,逐條處置)

| # | finding | 處置 |
|---|---|---|
| 1 | PRG 仍有新賽跑(第二次送出的導頁後到會重開表單並換 token) | ✅ §1:凍結判定改「**先查帳本**」而非只看回傳碼 |
| 2 | `denied`/orderId 解不出時沒有可信路徑 | ✅ §1:導固定安全頁 `/orders`。🔴 主視窗 `E-014-A` 追加:**若要用 client 提供的 orderId 導回明細,必須先驗**(uuid 形狀 + 該單存在且本 actor 看得到);驗不過就退回 `/orders` |
| 3 | B1 改簽章 vs B3 純 form action 不相容 | ✅ §3:合併成 C1 |
| 4 | B2 對未追蹤的 B3 檔假綠 | ✅ §3:接線併入 C2、表單併入 C1 |
| 5 | 結果面板在資格閘內 ⇒ 關單後義務 5 消失 | ✅ §1/§3 C2:面板移到資格閘之外 |
| 6 | `redirect()` 預設 push ⇒ query 進歷史、可重播 | ✅ §1:失敗導頁改 **replace** + canonical 清除出口 |
| 7 | 未要求「revalidate 拋錯仍必導頁」的負測 | ✅ §3 C1 驗收 |
| 8 | 不寫 `checked` 擋不住 autofill/bfcache | ✅ §2-3 三道疊加 + 真瀏覽器負測 |
| 9 | `<select>` 無空 placeholder 會自動選第一個 | ✅ §2-3② + §4 Q2 |
| 10 | `invalid`/`denied`/`error` 碼已被別的流程佔用 | ✅ **結果碼一律 namespaced**:`order_cancel_invalid` / `order_cancel_denied` / … (成功那顆 `order_cancelled` 維持既有);C2 驗收含「與既有碼零碰撞」 |
| 11 | `Object.hasOwn` 不驗 query 真實性 ⇒ 可偽造畫面狀態 | ✅ §4:**URL 不是事實來源**,一切先查帳本;殘餘(關聯洩漏)誠實列出 |
| 12 | 「RPC 還要 payload_hash」不精確 | ✅ §0-2 更正 |
| 13 | `rt` 缺失/非 uuid 不得當「沒失敗」 | ✅ §3 C2 驗收(fail-closed) |
| 14 | B5「照原 plan」不成立 | ✅ §3 C5 重新定義 |
| 15 | 未標 L1/L2/L3(鐵則 9) | ✅ §3 標 L1 |
