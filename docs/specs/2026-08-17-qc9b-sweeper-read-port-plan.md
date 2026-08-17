# `Q-C9-b` 前置 · 出貨通知信要**讀得到主表** · **PLAN(等 Sean 批,鐵則 8)**

> **窗** C · **2026-08-17 夜** · 座標實測自 worktree `/Users/sean_1/pcm-print` 分支 `print-docs`
> tip 落筆當下 = `5da16975`(+ `#601` 未 commit,與本 plan 無關)。
> ⚠️ **出處一律用 grep 錨點文字或 `檔案:行號`,不憑記憶。**
>
> **這份 plan 不是 `Q-C9-b` 的全部** —— 它只解「**信裡要印的東西拿不到**」這一件前置。
> 母 plan = `docs/specs/2026-08-17-qc9-tracking-to-customer-plan.md`(Sean 已批 `Q4`=甲「批,開工」),
> 本檔對應它的 **§5-DONE-e**。
>
> **為什麼要單獨提一份**:母 plan 批准時,檔裡寫的是「管線是活的,只差 E4 那一段」,
> 而那句話**第二次被證明讀窄了**(第一次是 §5-DONE 第 3 條:生產端零呼叫端)。
> 本檔要動的是**共用 use-case 的依賴契約** ⇒ **超出已批准的影響面** ⇒ 依 R3 重新提 plan。
> 🔴 **方向(甲)已由主視窗裁定**;要 Sean 批的**不是甲還是乙**,是「**這個影響面可以動**」。
>
> ---
>
> ## 🔴 2026-08-17 深夜 · 重驗紀錄(本檔寫於 tip `5da16975`,之後樹前進 56 顆)
>
> **重跑了本檔自己的每一條數法。三處座標漂了、一處是錯的(不是漂的):**
>
> | 原本 | 現在 | 性質 |
> |---|---|---|
> | `sweep-email-outbox.ts:42-44` | `:42-45` | 漂一行(收尾 `}`) |
> | 數法 ⇒ 「2 行」 | **3 行**(多一行**註解** `route.ts:4`) | 分母漏算,結論〔呼叫端 = 1〕不變 |
> | §3 / §4 的 composition = `route.ts:140` | **`composition.ts:55`** | 🔴 **這一條是錯的,不是漂的** —— 詳 §4 那段更正 |
>
> ✅ **仍然成立、當場重驗過的**:
> `buildEmailText` 是純函式(`:108`)、`order_shipped` 現在 fail-closed throw(`:112-113`)、
> payload allowlist 只有三欄(`order-email-assembly.ts:43-47`)、
> 「渲染資料寄信時即時查主表」那句設計意圖(`order-email-assembly.ts:12`)、
> LINE cohort 那個洞的三個行號(`SupabaseEmailOutboxAdapter.ts:198/208/222`)。
>
> ⚠️ **重驗的是【座標與 code 現況】,不是【授權範圍】。** Sean 對 `D1` 的逐字只有「**批**」一個字,
> 而題目文字是主視窗寫的 ⇒ **實作範圍若超出那段描述,就不在他批的範圍裡**,要回去重問。

---

## §1 要改什麼(一句話版)

`sweepEmailOutbox` 這支 use-case **手上沒有任何可以讀 `orders` / `shipments` 的東西**,
而出貨通知信要印的**每一樣**都在那兩張表裡 ⇒ 給它一個**寄送時讀取用的 port**。

**當場量的(可重跑)**:
```
packages/use-cases/src/sweep-email-outbox.ts:42-45   ← 2026-08-17 深夜重驗（原寫 42-44，收尾 } 在 45）
  export type SweepEmailOutboxDeps = {
    outbox: IEmailOutbox;
    sender: IEmailSender;
  };                                   ← 就這兩個
同檔 :108-117   buildEmailText(job) 是【純函式】，只拿得到 job
同檔 :125-143   buildOrderCreatedText 只從 payload 取 display_id 一欄
```

而設計意圖早就寫了(`packages/adapters/src/email/order-email-assembly.ts:12` 逐字):
> 「品項/金額/地址等渲染資料**寄信時即時查主表**(E2a/E3),不進 payload(可後台改的欄存了會過期)」

⇒ **那個能力不存在。** 本 plan 就是把它做出來。

🔴 **這不只卡「品項清單」(`Q2`=乙)**:**追蹤碼本身也在 `shipments` 表、不在 payload**
⇒ **就算 `Q2` 選甲(只放單號 / 貨運商 / 追蹤碼)一樣查不到。**
**它卡的是整個 `C9-b`,不是只卡品項那一段。**

---

## §2 為什麼不走乙(把東西塞進 payload)—— **這一節不能刪**

> 🔴 **不寫下來的話,下一個人會覺得甲太重、回頭去做乙。**

| | 乙的代價 | 依據 |
|---|---|---|
| ① | **直接違反那份 code 裡唯一一道真防線** | `order-email-assembly.ts:4-11` 逐字:那層是「**PII 不落表的真防線**」、「payload **顯式逐欄 allowlist** 組裝 + runtime 型別檢查」、「**禁 spread、禁整包轉存**」 |
| ② | **追蹤碼後台可改 ⇒ 存了會過期** | 存進 payload 的是**當下那一刻**的值;員工改過之後,信裡帶的是**舊碼** |

🔴 **②的錯的形狀最貴**:客人拿**舊追蹤碼**去貨運網站查 ⇒ 查無 ⇒ 他打電話來,
而**信已經寄出去、收不回來**(鐵則 12⑤)。
📎 而這條錯**在寄出前看不出來** —— payload 裡那個字串是合法的、格式正確的、長度也對。

---

## §3 影響面(五項,逐項附落點)

| # | 動什麼 | 落點 | 性質 |
|---|---|---|---|
| 1 | **新增**一支讀取 port | `packages/ports/src/`(新檔) | 純新增 |
| 2 | `SweepEmailOutboxDeps` **多一個【選用】欄** | `packages/use-cases/src/sweep-email-outbox.ts:42-45` | 見 §4,**選用**是 rollback 的關鍵 |
| 3 | 實作那支 port | `packages/adapters/src/`(新檔) | 純新增 |
| 4 | composition 傳進去 | `apps/storefront/src/lib/email/composition.ts:55`(`return { outbox, sender };`) | 一處 |
| 5 | 既有測試的 deps 建構 | `packages/use-cases/src/sweep-email-outbox.test.ts` | 選用欄 ⇒ **不傳也編得過**,見 §4 |

**production 呼叫端 = 1 個**,數法(可重跑):
```
grep -rn 'sweepEmailOutbox(' apps packages --include='*.ts' | grep -v '\.test\.'
⇒ 2026-08-17 深夜重跑 = 3 行（原本寫 2 行，🔴 漏算了註解那一行）：
     sweep-email-outbox.ts:145   ← 定義本身
     route.ts:140                ← 真正的呼叫端
     route.ts:4                  ← 🔴 一行【註解】，這支 grep 會命中註解
  ⇒ 結論不變：真正的呼叫端只有 apps/storefront/src/app/api/cron/email-sweep/route.ts:140
  ⚠️ 但分母變了 ⇒ 誰要拿「幾行」當守門，先知道它把註解也算進去
正向對照（證明這支 grep 會命中）：同一支改找 claimDue( ⇒ 4 行（重跑仍是 4）
```

---

## §4 rollback —— **這一格我照實寫,它不是「純加法」那麼漂亮**

**最初的想法**:「新 port 是加不是改 ⇒ 直接退掉就好」。
🔴 **而那句話對第 2 項【不成立】**:`SweepEmailOutboxDeps` 是**必填欄的物件型別**
⇒ 加一個**必填**欄 = **breaking**,既有呼叫端與測試會 typecheck 紅。

**⇒ 所以本 plan 的設計把它做成【選用】欄**:

```ts
export type SweepEmailOutboxDeps = {
  outbox: IEmailOutbox;
  sender: IEmailSender;
  /** 只有 order_shipped 用得到；不給 ⇒ 那個事件維持今天的 fail-closed。 */
  shippedContext?: IShippedEmailContext;
};
```

這讓 rollback 變成**真的可退**,而且**三層各自可退**:

| 退到哪 | 動作 | 退完的行為 |
|---|---|---|
| 完全復原 | composition 那一行拿掉(`apps/storefront/src/lib/email/composition.ts:55` 的 `return { outbox, sender };`) | `shippedContext` 為 `undefined` ⇒ `order_shipped` **回到今天的 fail-closed throw**、`order_created` **一個字都沒變** |
| 只停出貨信 | 同上 | 同上(這就是同一個動作) |

> 🔴🔴 **2026-08-17 深夜 C 窗更正:上面這一格原本寫的是 `route.ts:140`,而那是【呼叫點】不是【composition】。**
> **照原字退會把整支寄信 sweeper 關掉** —— `route.ts:140` 是 `await sweepEmailOutbox(deps, {…})` 本身,
> 拿掉它 `order_created` 也不寄了,而那正是這一格宣稱「一個字都沒變」的東西。
> deps 是 `getSweepEmailOutboxDeps()` 建的(`route.ts:138` 呼叫、本體在 `composition.ts:46-56`),
> `shippedContext` 要加在 `composition.ts:55` 那個 return,退也退那一行。
> ⚠️ **而本檔 §3 的 `route.ts:140` 是對的** —— 那一句講的是「production 呼叫端在哪」,
> 不是「composition 在哪」。**同一個字面在這份檔裡一處對一處錯**,
> 掃字面的人請逐處開檔判斷,不要整份取代。
| 連型別一起退 | 三支新檔刪掉 + 那個選用欄刪掉 | 回到 `5da16975` 的形狀 |

🔴 **「退掉之後會怎樣」不是推的,它就是今天的行為**:
`packages/use-cases/src/sweep-email-outbox.ts:112-113` 現在逐字:
```
case 'order_shipped':
  throw new Error('sweepEmailOutbox:order_shipped 模板未定義(E4 未落地)、fail-closed 不寄');
```
⇒ **今天寄不出去**,而退掉之後**也是寄不出去**。**兩者是同一個狀態,不是兩個。**

⚠️ **選用欄的代價我也寫出來**:型別上「忘記傳」與「刻意不傳」**長得一樣**。
⇒ 落地時 `order_shipped` 那條路要**明確處理 `undefined`**(fail-closed + 錯誤訊息說明是組裝缺依賴,
不是資料有問題),並**配一格測試釘住「不傳 ⇒ 不寄且不靜默」**。
🔴 **不可以** 讓它變成「不傳就寄一封沒有追蹤碼的信」—— 那正是 DB COMMENT 明文禁止的
(`20260805170000` COLUMN COMMENT 逐字:「**不得寄出「已出貨但無單號」的通用信**」)。

---

## §5 鐵則判定(逐條過硬清單)

- **鐵則 8** ✅ **命中**:跨 3+ 檔 + 動**共用 use-case 的依賴契約** ⇒ **本檔就是那份 plan。**
- **鐵則 12⑤** ⚠️ **本片不命中,而【下一片必定命中】**:
  本片只把**讀取能力**接上去,**不寄任何信**(`order_shipped` 仍然 fail-closed)。
  🔴 **而真正寄出那一片(模板 + enqueue 呼叫端)命中 12⑤,不降級** ——
  **兩案(甲或乙)最後都要過那一關**,那與這裡選哪一案無關。
- **鐵則 12②** ⚠️ 不命中:本片不動 server→client 邊界(信是 server 端組的)。
  ⇒ 那條留給 `C9-a`(客人訂單頁)。
- **鐵則 9 分級**:本片零文案 ⇒ 不涉 L1/L2/L3。

---

## §6 誠實邊界

- 🔴 **本 plan 沒有動任何 code**:`git status --porcelain | grep -cv '\.md$'` 落筆當下 = 4
  (全部是 `#601` 那片的,**與本 plan 無關**;`#601` 卡在四綠三發紅,見 `~/pcm-mailbox/C-220`/`C-221`)。
- ⚠️ **那支 port 的介面形狀本 plan 【沒有定到欄位級】** —— 要印哪幾欄取決於 `Q2`=乙 的「辨識」定位
  (主視窗的解讀:**要能一眼看出這封講的是哪一箱**,不是拿去對帳)。
  ⇒ 欄位清單留給實作那一片,**而它會需要一次真的信件預覽**(`Q-C9` 母 plan §5-DONE 第 5 條:
  一格快照測試,快照檔本身就是預覽)。
- ⚠️ **我沒有跑過任何一封信**(沒有 DB、沒有 Resend 金鑰,施工窗做不到端到端)
  ⇒ 「今天寄不出去」是**讀 code 讀出來的**(那個 `throw` 我親眼看到),**不是量到的**。
- 🔴 **LINE cohort 那個洞不在本 plan 的範圍內**:合成假信箱 ⇒ `skipped_no_real_email`、
  **這封信永遠不會寄出**(`packages/adapters/src/email/SupabaseEmailOutboxAdapter.ts:198/208/222`;
  `packages/ports/src/IEmailOutbox.ts:166` 逐字「落表佔位但不進 due、不呼 Resend」)。
  **那不是本片造成的,也不是本片能修的**;主視窗已遞 Sean,人數未量、簡訊那半未查
  (⚠️ 而「簡訊」二字 Sean 2026-08-17 已澄清是口誤、實指 **LINE**)。
- ⚠️ **工期未估。** 母 plan §5-DONE 第 3 條已經寫過一次「工期要往上修,而修多少我沒有估」,
  本檔**同樣不估** —— 未估,不是估了很小。
