# Plan · 優惠券 schema + 拒絕理由(M-4b)

> **狀態:等批。一行碼都還沒寫。**
> 上游:`docs/specs/2026-08-25-coupon-prd.md` §7(Sean 2026-08-26 的答案)。
> 命中 **鐵則 8**(新表 + CRUD + UI,跨 3+ 檔)、**鐵則 12①錢**、**鐵則 12③schema**
> ⇒ **高風險片,對抗審查不降級(codex,由本窗自己跑)。**
> 產出者:施工窗 pcm-website-v2-1d(線 4),2026-08-26。

---

## §0 這一片的第一段,要先講的不是欄位

**那 7 種拒絕理由,全部是 Sean 這一輪的答案造出來的。**
```
① 券碼不存在(打錯)            ② 這張券已停用          ← Q7甲(停用取代刪除)
③ 已過結束日      ← Q3甲       ④ 總量已用完            ← Q2乙
⑤ 你這個帳號已經用過了 ← Q2乙   ⑥ 還差 NT$ N 到最低消費 ← Q6甲
⑦ 這張券不能與你的會員價並用 ← Q4丙
```
而 `Q22 = 甲(說明原因)`。

🔴 **而 design 的合約只有一個布林,答得出「不能用」、答不出「為什麼」**:
```
design-reference/HANDOFF.md:202-203 逐字   "invalidCoupon": false,
原因欄位 grep -niE 'couponError|couponReason|invalidReason|reason' <該檔> ⇒ 0
正對照 grep -c 'couponDiscount' ⇒ 1  ⇒ 尺是活的
```
⇒ **契約要擴。** 而照鐵則 1:**這一面 design 沒有畫**
(券只有 `cart-coupon`/`-ok`/`-row` 三個 class、零錯誤態;而同一份 design 別處**有** `auth-err`/`spm-geo-error`
⇒ **不是那位作者不寫錯誤態,是這一格沒寫**)。
⇒ **這是【新增】不是【照抄】,而 Sean 要知道我們在新增。**

⇒ 📌 **所以「拒絕理由」在這一片是【規格】不是事後補的 UI** —— 它決定資料表要記什麼、API 要回什麼。

## 🔴 §0-b 而它連帶決定了這一片的成本階梯:**要不要第二張表**

`Q2乙`(每人可用 N 次)**必須查得到「這個帳號用過沒」**。
而 `orders.discount_total` 是**一個總數**:
```
supabase/migrations/20260604120000_m3_s2a_orders_order_items.sql:103 逐字
  discount_total  integer NOT NULL DEFAULT 0 CHECK (discount_total >= 0)
⇒ 它記得住「這單折了 500」, 記不住「這 500 是哪張券折的、誰用的」
```
⇒ 🔴 **`coupon_redemptions` 不是「加分」,是「必須」——沒有第二張表,「每人上限」做不出來。**
⇒ **這是這一片的成本分水嶺**:一張表 = 券的 CRUD;兩張表 = 券的 CRUD **+ 每一次結帳都要寫一筆**。

📌 **而金流那邊要知道的是另一句**:`orders` 那條 DB 不變式**不動**
(`:112` `CONSTRAINT orders_total_balances CHECK (total = subtotal + shipping_fee - discount_total)`)
⇒ **券只影響 `discount_total` 是怎麼算出來的,不碰那條不變式** ⇒ **對金流線零侵入。**

---

## §1 要改什麼

### 1-1 新增兩張表(鐵則 12③)
```
coupons               券本體
coupon_redemptions    誰、在哪張單、用了哪張券、折了多少
```
🔴 **為什麼一定要第二張表 ⇒ 見 §0-b**(全文在那裡,此處不重複)。一句話:
`orders.discount_total` 是**一個總數**,而 `Q2乙` 的「每人上限」要查得到「**這個帳號用過沒**」。

### 1-2 `coupons` 欄位(全部來自 Sean 的答案,逐欄標出處)
```
code               優惠碼(唯一;大小寫與前後空白照 design:trim + toUpperCase)
description        說明, 給員工看
discount_type      🔴 'fixed' | 'percent'                    ← Q1乙 兩種都要
discount_value     integer(fixed=金額分位 / percent=百分比整數)
ends_on            date                                      ← Q3甲 只做結束日
max_redemptions    integer NULL=不限                         ← Q2乙 總量
max_per_account    integer NULL=不限                         ← Q2乙「每人」
min_spend          integer NOT NULL DEFAULT 0                ← Q6甲 最低消費
stacks_with_tier   boolean                                   ← Q4丙 每張券一個開關
is_active          boolean NOT NULL DEFAULT true             ← Q7甲 停用取代刪除
created_by         staff id, 不給改                          ← Q5甲 的配套
```
🔴 **`max_per_account` 綁的是【帳號】不是 email** —— Sean 逐字「**同一個帳號, email 重複無所謂**」。
⇒ 綁 `customers.user_id`(= `auth.users.id`)。**同一個人開兩個帳號各用一次 = 兩次,不擋。**

### 1-2b `coupon_redemptions` 欄位 —— ✅ **`c 甲` 定下來的那一格在這裡**

Sean 2026-08-26 `c 甲` = **退貨之後那張券的次數退回去,客人可以再用一次。**
```
coupon_id · order_id · user_id · discount_applied  ← 原本就要的
🔴 reverted_at   timestamptz NULL   ← c甲 的實體:NULL = 還算數, 有值 = 已退回
   reverted_by   staff id NULL      ← 誰退的(退貨是人操作的, 見下)
```

🔴 **而這一欄的重點不是「多一欄」,是【每一個數次數的地方都要加同一個條件】:**
```
已用/總量(列表頁)      count(*) WHERE coupon_id = X AND reverted_at IS NULL
每人上限(結帳時檢查)    count(*) WHERE coupon_id = X AND user_id = Y AND reverted_at IS NULL
```
⇒ **漏掉任何一處 ⇒ 那張券【看起來已用完】而客人明明退過貨。**
⇒ **而它不會報錯、不會紅** —— 只會有客人打電話來說「我的券不見了」。
⇒ 📌 **所以這一格寫進【RPC 裡】,不是寫進呼叫端**(同 §2 的紀律)。

⚠️ **而有一件我【沒有】定,要在實作前確認 —— 這是 `c甲` 的真正代價**:
```
🔴 「退貨」這件事現在【是誰在做、在哪裡做】? 我沒查。
   Sean 這一批另外拍了「退貨和退款不綁在一起」
   ⇒ 退貨那條路上【不會有東西自動回頭碰那張券】
   ⇒ 所以「reverted_at 是誰寫進去的」有兩種可能, 而成本差很多:
     (a) 退貨流程裡自動寫    ⇒ 要接上退貨那條線, 不是券這一片能單獨做完
     (b) 客服在後台手動按    ⇒ 券這一片自己做得完, 而要多一顆按鈕 + 一支 RPC
   ⇒ **本 plan 傾向 (b)**, 理由:券這一片能自己收尾, 不卡在別條線上。
   ⇒ 🔴 **而這是我判的, 不是 Sean 拍的** —— 列進 §5。
```

### 1-3 🔴 ~~而有一格 Sean 還沒答~~ ✅ **已答**

`Q1乙` 要「打 N 折」⇒ **百分比會產生小數** ⇒ **進位規則沒有人拍過。**
```
既有前例(不是拍板, 是別處的做法):
  packages/domain/src/catalog/pricing.ts:53 逐字
    const resultAmount = Math.round(storePrice.amount * (1 - extraPct / 100));
  ⇒ 會員價那條線用 Math.round(四捨五入)
量法 grep -rln 'Math.round|Math.floor|roundTwd' packages/domain/src --include='*.ts' | grep -v test ⇒ 2 支
🔴 2026-08-31 訂正【配方】不是結論:那條 grep 少了 `-E`, 豎線被當字面 ⇒ 照抄重跑會拿到 **0**。正確寫法加 `-E` ⇒ **2 支**,與上面那個數字**逐字相同** ⇒ 作者跑的與寫下來的不是同一條。
負對照 'MathZZ.round' ⇒ 0
```
⚠️ **而「會員價這樣做」不等於「券也該這樣做」** —— 券是**折抵**不是**定價**,
**四捨五入會讓折抵多給 0.5 元、無條件捨去會少給**。金額小、次數多。
✅ **Sean 2026-08-26 已答:`a, 甲` = 四捨五入(與會員價一致)。**
```
⇒ percent 那一半【解鎖】, 兩半都定了。
⇒ 實作:Math.round —— 與 packages/domain/src/catalog/pricing.ts:53 同一個做法
⇒ 而它是【折抵】不是【定價】⇒ 四捨五入的方向是【可能多折 0.5 元給客人】, 這是他拍的
```
~~🔴 **這一片在這一格拍板之前,`discount_type='percent'` 那一半不動。**~~(前置已解除)`'fixed'` 那一半原本就不受影響。

### 1-4 拒絕理由 = 封閉集(這是 `Q22甲` 的實體)
```
coupon_reject_reason:
  not_found · inactive · expired · exhausted · already_used_by_account
  · below_min_spend · tier_conflict
```
🔴 **寫成 enum 不是字串** —— 理由與 `態` 封閉集同一條:**字串會長出第八種而沒有人發現**。
⇒ API 回 `{ valid: false, reason: <enum>, shortfall?: integer }`
   (`shortfall` 只在 `below_min_spend` 出現 ⇒ 「還差 NT$ N」)
⚠️ **而「要不要把差額算給客人看」Sean 還沒答**(PRD §7-3 列的三格待決之一)
⇒ **欄位留著、預設不回** ⇒ 他說要再開。**不要先做成回傳再拿掉。**

### 1-5 併發:限量券兩個人同時結帳
```
本 repo 有前例:grep -rln 'SKIP LOCKED|FOR UPDATE' supabase/migrations/*.sql ⇒ 75 支
🔴 2026-08-31 訂正【配方】:同款少 `-E` ⇒ 照抄重跑拿到 **0**。加 `-E` 今天 ⇒ **82 支**(原記 75)。⚠️ 82 與 75 的差我**分不出是「這五天長出來的」還是「範圍不同」** —— 未查歷史。🔵 而下一行那個負對照 `SKIP LOCKEDZZ ⇒ 0` **通過了** —— 因為它本來就該是 0,**而這把尺對什麼都回 0** ⇒ **一把恆回 0 的尺會通過所有負對照。**
負對照 'SKIP LOCKEDZZ' ⇒ 0
```
⇒ **`max_redemptions` 的扣減必須是原子的**(在同一個交易裡 `SELECT … FOR UPDATE` 券那一列再寫 redemption)。
⚠️ **我還沒挑定用哪一支當範本** —— 75 支裡要選一支形狀最接近的開檔讀,**那是實作階段的第一件事,不是現在猜。**

### 1-6 🔴 猜碼防護:**而我上一份 PRD 指錯了東西,這裡更正**
PRD §2-3 寫「repo 有 `lib/cron/rate-limit.ts` 的形狀可參考」。**我開檔讀了,它不合用。**
```
apps/storefront/src/lib/cron/rate-limit.ts 檔頭逐字:
  「**per-instance best-effort、非全域硬上限**。狀態在 module scope 記憶體
    → 每個 serverless 實例各有一份計數…有效上限 ≈ MAX_HITS × 熱實例數,**不是硬保證**」
```
⇒ 它是為 **cron route**(單一 secret 被盜刷)寫的,威脅模型是**放大倍率**。
⇒ **而猜碼是「攻擊者可以慢慢掃」** —— per-instance 記憶體限流**擋不住跨實例散開的低速掃描**。
⇒ **不是「套上去就好」,是需要一個共用狀態的限流**(DB 或 KV)。
✅ **Sean 2026-08-26 已答。而他的原話比「選甲」多了東西,照原話落:**
> **「沒關係,猜到就猜到」**

```
⇒ 🔴 這【不是】「先做便宜的那個, 之後補」—— 他是【明說這個風險他接受】。
   落檔一律寫「Sean 拍板:猜碼風險他接受」, 不要寫成「選了最小方案」——
   後者讀起來像我們幫他省, 而那不是他說的。
⇒ 實作:碼夠長夠亂 + ~~失敗記進 redemptions 供事後查~~。【不做限流】。
```
🛑 **2026-08-29 Sean 拍【甲:不留】⇒ 上面那句「失敗記進 redemptions 供事後查」正式作廢。**
```
理由（他答的是甲，這段理由是我們寫的）：
🔴 那張表【裝不下】失敗紀錄 —— coupon_id 與 order_id 都是 NOT NULL，
   而「打錯券碼」時根本沒有券可以指，驗券當下也還沒有訂單
⇒ 承諾與模型互斥 ⇒ 不是少做一件事，是這個承諾在這個模型下不成立
```
📌 **標作廢而不是刪掉** —— 刪掉的話,下一個讀舊版的人會以為它從來沒被承諾過;
   而默默不做的話,這份規格會變成「寫著要做而沒做,而沒有人知道它被撤了」。
⇒ 落地位置:`supabase/migrations/20260829150000_m4b_coupon_p1_tables.sql` 檔頭那一節。

🔴 **而原本規劃的配套「後台提示不要用連號或簡單碼」—— 他這句話直接降低了它的必要性。**
```
⇒ 那個提示【不因為原本規劃有就照做】。要留的話理由必須換一個,
   例如「避免員工彼此撞碼」(那是可用性問題, 不是防猜)。
⇒ 本 plan 判:提示保留, 而理由改為【避免撞碼】—— 見 CRUD spec §3-3。
```

---

## §2 為什麼(一句)
Sean 2026-08-24 逐字「優惠券／折扣碼:**開發啊,去做啊**」,而 2026-08-26 已把規格七題答完。

## §3 預期影響面
```
DB      新增 2 張表 + enum + 欄級 GRANT + 索引
        🔴 照 docs/patterns/revoking-function-execute-in-supabase.md:
           新物件【出生就自帶 anon 權限】、repo 內零 GRANT 字面可掃、三綠不紅
        ⇒ 建表同一支 migration 內就要 REVOKE + 明確 GRANT, 不留到下一片
金額    🔴 整數運算, 禁 number 浮點(Server 端鐵則)
        而 orders 那條 CHECK 不動:total = subtotal + shipping_fee - discount_total
        ⇒ 券只影響 discount_total 怎麼算出來, 不影響那條不變式
後台    新增「優惠券」CRUD 頁(我的檔案面)
顧客站  🔴 結帳頁接上 /api/coupons/validate + 錯誤態 UI —— **不是我的檔案面**
        ⇒ 列出來, 不動, 等主視窗協調
契約    🔴 invalidCoupon 布林 ⇒ 要擴成帶 reason(見 §0)—— **這是新增, 要讓 Sean 知道**
```

## §4 rollback
```
後台 CRUD 那半   單一 commit revert 即完全復原
schema 那半      🔴 DROP TABLE 可以, 而【已經開出去的券與已折抵的訂單記錄會一起沒了】
                 ⇒ 而訂單上的 discount_total 不會變(它自己存一份)
                 ⇒ **帳不會錯, 而「這 500 是哪張券折的」會永久失去**
                 ⇒ rollback 前先把兩張表倒出來。**不是純技術動作。**
顧客站那半       revert 之後, 已經送出的訂單不會回來
```

## §5 這份 plan 自己不確定的
```
· ~~打 N 折的進位規則~~ ✅ **2026-08-26 已答 = 四捨五入**(見 §1-3)
· ~~猜碼防護做到什麼程度~~ ✅ **2026-08-26 已答 = 風險他接受, 不做限流**(見 §1-6)
· 7 種原因的【文案】—— 品味題, Sean 的
·「還差 NT$ N」要不要顯示 —— Sean 未答
· 錯誤訊息出現在畫面哪裡 —— 🔴 design 沒畫 ⇒ Design session, 不是我畫
· SKIP LOCKED 用哪一支當範本 —— 75 支裡還沒挑, 實作第一件事
· 券能不能綁特定商品 / 分類 —— **本片不含**, Sean 沒點名
· 🔴 **`reverted_at` 由【誰】寫進去(退貨流程自動 vs 客服手動)—— §1-2b 我傾向手動,
  而【那是我判的不是 Sean 拍的】**⇒ 實作前要確認, 因為它決定這一片卡不卡別條線
· 🔴 **「退貨」現在在哪裡做 —— 我沒查。** 上面那一判是在沒查的情況下做的
· 同一張單能不能用兩張券 —— **本片不含**, Sean 沒點名(而 UI 只有一個輸入格)
· 退貨時券的次數怎麼退回去 —— **還沒問過他**(PRD §3 就標著, 至今未問)
```

📎 上游:[coupon-prd §7](2026-08-25-coupon-prd.md) · memory `project_0826-sean-answers-decision-table`
