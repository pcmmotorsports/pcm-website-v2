# plan · `coupon_revert_on_full_refund` 券的退回路徑 · 2026-09-11 · 窗 C

> **授權鏈**:Sean 2026-09-11 拍**乙**逐字「現在把退券那支做掉(碰錢 ⇒ plan + codex 審 + 你批)」,
> 經主視窗 `pcm-website-v2-59` 轉述。🛑 **不是我直接從 Sean 收到的。**
> 鐵則 8(動 schema ⇒ plan 等批)+ 鐵則 12(碰錢 + 碰權限 ⇒ codex 唯讀審)。
> 🟢 **本份零寫入、零貼板、沒有寫那支函式的任何一行 SQL。** DB 讀數皆 `pcm_readonly` @ 正式庫,
> `bash scripts/readonly-prod-sql.sh`,rc=0、真錯誤 0 格,`2026-09-10 16:45–17:1x UTC`。

---

## 0. 一句話 + 今天的曝險

**扣券的路今天在正式庫上是通的,而退回的路不存在。客人整筆退款之後,那張券永遠回不來。**

```
🔴 通的那一半(實量)
   create_order(… p_coupon_code)  兩個 overload 都在線上, 都呼 redeem_coupon
   redeem_coupon(…)               SECURITY DEFINER · owner postgres · EXECUTE 給 service_role
                                  prosrc 含 INSERT INTO public.coupon_redemptions
   coupon_redemptions(reverted_at, reverted_by)  都在線上
   後台券清單 view 那句 reverted_at IS NULL      在線上, 而它排除的永遠是 0 筆
🔴 不存在的那一半
   coupon_revert_on_full_refund(uuid)  repo 零支 CREATE · 正式庫 to_regprocedure ⇒ NULL
   🟢 正對照 admin_compute_order_settlement(uuid) ⇒ 在   ⚪ 負對照 現造函式名 ⇒ 不在
```

🛑 **今天曝險 = 0,而那不是因為安全,是因為 `coupons` 0 列、`coupon_redemptions` 0 列。**
📌 **0 列不是一道閘,是一個當下的事實** —— 它不會在有人建券的那一秒叫。

---

## 1. 已經有答案的五格(不必再問 Sean)

```
① 什麼情況退回   Sean 逐字「只有整筆退才退回券」
                 (supabase/migrations/20260829150000_m4b_coupon_p1_tables.sql:13)⇒ 部分退 ⇒ 不退
② 怎麼表示退回   不刪列, 寫 coupon_redemptions.reverted_at(timestamptz 可空)+ reverted_by(text 可空)
                 —— 兩欄今天都已經在正式庫上
③ 名額怎麼回來   後台券清單 view 已寫死 WHERE r.reverted_at IS NULL
                 ⇒ 📌 只要把 reverted_at 填上, 名額自己回來, **view 一個字都不用改**
④ 簽章          前置閘釘死 public.coupon_revert_on_full_refund(pg_catalog.uuid)
                 而且**必須是 function 不是 procedure**(閘用 to_regprocedure 查)
⑤ 版本號        scripts/coupon-revert-migration-order.test.ts 守著:
                 定義它的 migration 版本號**不得晚於 20260901021000**
```

---

## 2. 🔴 要 Sean 答的四題(每題兩個選項 + 一個推薦)

### Q1 · 那支函式由**誰**來呼?

🔬 **先給他今天的地形(這是量出來的,不是我想的)**:正式庫上退款/取消相關函式 **40 支**、退款相關表 **14 張**。
而它們有一個**匯流點**:`pcm_sync_order_refund_payment_status(uuid)` —— **9 支**退款函式都呼它
(`admin_finalize_order_refund` 卡片退款收尾 · `admin_record_manual_refund` 人工退款 ·
`admin_backfill_tappay_console_refund` · `admin_void_manual_refund` · `admin_void_backfilled_refund` ·
`admin_correct_backfilled_refund` · `admin_correct_order_refund_verdict` · `pcm_noncard_settle_recompute` ·
`record_manual_cancel_notice`)。
🟢 正對照 `pcm_order_refundable_remaining` ⇒ 4 個呼叫端 · ⚪ 負對照 現造函式名 ⇒ 0。

```
甲(推薦)= 掛在那個匯流點:退款狀態同步完之後, 由它判斷「這張單整筆退了沒」, 是就呼退券
        ✅ 一個落點蓋住九條路;之後新增第十條退款路, 它自動被蓋到
        ⚠️ 而 admin_cancel_order / admin_mark_order_cancelled 【不在】那九支裡
           ⇒ 「取消而沒有退款」那條路要另外判(見 Q2)
乙       = 四條主要退款路各自呼一次(finalize / record_manual / backfill / void)
        ⚠️ 四個落點要各自維護, 而漏掉第五條的那天沒有人會知道
```
🔵 **推薦甲的理由**:🎯 **一個守在所有人都會經過的路口的閘,比四個守在門口的閘小,而且它擋得住還沒被蓋出來的那扇門。**

### Q2 · 「整筆退」的判準是看**金額**還是看**狀態**?

```
甲(推薦)= 看金額:已退總額 >= 訂單應收總額 ⇒ 算整筆退
        ✅ 它與「客人實際拿回多少錢」對齊, 而那才是 Sean 那句話的意思
        ⚠️ 而「應收總額」在含稅 / 運費 / 部分取消之後怎麼算, 與
           ⟦b4-PARTCANCELTAX⟧ 是同一個受詞 —— 那一列在別的窗手上, 🔴 兩邊要用同一個算式
乙       = 看狀態:訂單 payment_status / refund 狀態走到某個值 ⇒ 算整筆退
        ⚠️ 狀態是被別的東西推的, 而 ⟦b4-CUTOFFWRONGCOLUMN⟧ 那一列證過:
           「契約寫的那一欄」與「真正決定行為的那一欄」可以是兩欄
```
🛑 **這一題與 `⟦auth-PARTIALREFUNDCANCELGAP⟧` 是同一族,而那一列 Sean 今天答過甲(上線前做最小版)。**
　 ⇒ 📌 **兩邊的「整筆 vs 部分」判準若不一致,會出現「信說全退而券沒退」。要一起裁。**

### Q3 · 退了又收、收了又退 ⇒ `reverted_at` 會被寫第二次嗎?能不能反悔?

```
甲(推薦)= 冪等 + 不可逆:reverted_at 已經有值 ⇒ 直接返回, 不覆寫、不報錯
        ✅ 同一張單重複呼叫是安全的(而上面九條路裡有 void / correct 這類會重跑的)
        ⚠️ 代價:若一張單退了又重新收款, 那張券【不會被再扣一次】—— 名額多還給客人一次
        🔵 而今天扣券只發生在 create_order(建單當下), 重新收款不會重新扣
           ⇒ 所以這個代價今天不成立, 而它會在「扣券改掛付款成功」那天成立
乙       = 可反悔:另做一支 un-revert, 收款成功時把 reverted_at 清掉
        ⚠️ 那是第二支碰錢的函式 + 第二輪 codex 審, 而今天沒有任何一條路會呼它
```

### Q4 · 誰有權限呼它?

🔬 **今天的地形(實量)**:`public` 底下 216 支函式,其中 **153 支是 `SECURITY DEFINER`** ——
📌 **這個庫的寫入慣例就是「表權限收乾淨,寫入走 SECURITY DEFINER 函式」。**
而 `coupons` / `coupon_redemptions` 的表權限實測:
```
INSERT / UPDATE / DELETE  ⇒ anon f · authenticated f · service_role f · authenticator f · pcm_readonly f
                             **只有 postgres(owner)是 t**
SELECT                     ⇒ service_role t · pcm_readonly t · 其餘 f
RLS 兩表都 enabled, 各 1 條 policy, 而**兩條都只給 service_role 的 SELECT**
🟢 正對照 public.orders × service_role INSERT ⇒ **f** ← 而訂單天天在寫
   ⇒ 📌 **「誰有 INSERT」根本不是「誰寫得進去」的那把尺**, 這個庫靠 SECURITY DEFINER 寫
```
```
甲(推薦)= SECURITY DEFINER · owner postgres · EXECUTE 只給 service_role
        ✅ 與 redeem_coupon 逐格同形(它就是 SECURITY DEFINER / owner postgres / EXECUTE 給 service_role)
        ✅ 表權限一格都不用動 ⇒ 不碰 coupons 的 relacl, 不碰 RLS
乙       = 直接 GRANT INSERT/UPDATE 給 service_role, 由後台程式直接寫
        🛑 那會破掉片1 刻意做的事 —— repo 逐字:「片1 把 coupons / coupon_redemptions REVOKE 到零表權限」
           (apps/admin/src/lib/coupons/coupon-repository.ts 檔頭)
```

---

## 3. 鐵則 8 四格

### 改什麼
```
新增一支 migration, 內容只有:
  · CREATE FUNCTION public.coupon_revert_on_full_refund(p_order_id pg_catalog.uuid)
    —— SECURITY DEFINER · owner postgres · SET search_path · SET lock_timeout
  · REVOKE ALL … FROM PUBLIC + GRANT EXECUTE TO service_role
  · 事後斷言:🔴 **問 ACL 現在長什麼樣, 不問 rc**
    (⟦tidy-NETPUBLICALL⟧ 那一發實測:REVOKE 會 rc=0 而 ACL 原封不動)
  · 一支對應的 supabase/rollbacks/<版本>_down.sql
🛑 本 plan 【不含】它由誰呼叫那一半 —— 那是 Q1 的答案決定的, 而它會是【第二支】migration。
```

### 為什麼
```
扣券路徑今天已通(實量)· 退回路徑不存在 ⇒ 客人整筆退款後名額只減不增
而後台那張券清單會一路顯示得很正常(那句 reverted_at IS NULL 排除的永遠是 0 筆)
⇒ 📌 錯了不會有人發現, 而發現的時候名額已經被吃掉了。
```

### 影響
```
🟢 對現有行為:零 —— 沒有任何一條路會呼它(呼叫端是第二支 migration 的事)
🟢 對 view:零 —— 名額口徑已經寫死 reverted_at IS NULL
🟢 對表權限:零 —— 走 SECURITY DEFINER, 不動 coupons 的 relacl / RLS(Q4 甲)
🔴 而它解除了兩支 migration 的封印:
     20260901021000 / 20260901030000 的第一道閘要的就是它
     ⇒ 它一貼, 那兩支就【變成貼得下去】—— 而那兩支會讓扣券真的跑起來
   ⇒ 🛑 **所以貼它之前, Q1(呼叫端)必須已經有答案**, 否則會出現
        「扣得動而退不了」的視窗期, 而那正是本列要解的那件事。
🔵 而後台今天【建不了券】(coupon-repository.ts 全 33 行, insert/update/upsert 零命中)
   ⇒ 補一個「新增券」按鈕**當天不會通** —— service_role 沒有 INSERT, 要另一支 migration。
   ⚠️ 而「後台沒有那個按鈕」同樣不是閘, 是事實。
```

### rollback
```
supabase/rollbacks/<版本>_down.sql ⇒ DROP FUNCTION IF EXISTS public.coupon_revert_on_full_refund(uuid);
🟢 安全:今天零呼叫端 ⇒ 移除它不會弄壞任何東西
🔴 而它有一個【單向】的部分:回捲之後, 已經被寫上 reverted_at 的那些列不會自己變回來
   ⇒ 今天 coupon_redemptions 0 列 ⇒ 這一格今天的代價是 0, 而它會隨時間長大。
```

---

## 4. 🔴 貼板順序:**三支是同一題,不是三題**

```
① <新版本號>  coupon_revert_on_full_refund   ← 🛑 版本號必須 ≤ 20260901021000(那支測試守著)
② 20260901021000  扣券 trigger + 前置閘        ← 裸 CREATE FUNCTION, 必須在 ③ 之前
③ 20260901030000  0 元結清 + 換掉函式本體      ← CREATE OR REPLACE
```
🔴 **而 ① 的版本號比 ② 小,代表它是「插隊到過去」** —— 貼板實際順序 = ① → ② → ③,
　 而檔名日期會讓它看起來像是最早寫的。📌 **這一格要寫進三支的檔頭,不是只寫在這裡。**
🛑 **`⟦db-SAMETRIGGERNAME⟧` 的 Q1 重裁(改名那一半撤不撤)Sean 還沒回。**
　 本 plan 先照「**只裁順序、不改名**」寫 —— 理由在 `docs/plans/2026-09-11-sametriggername-貼板順序-plan.md`:
　 改名會讓兩支 trigger 同時活著、綁同一支扣券函式 ⇒ **券扣兩次**,而沒有一道閘在問「是不是只有一支」。
　 ⇒ **它等他一句話。**

---

## 5. 🛑 我證不到什麼

1. **我沒有跑過任何一筆真的下單或退款。** 上面「扣券路徑是通的」是**讀 `prosrc` 字串位置**推的
   (`position('INSERT INTO public.coupon_redemptions' in prosrc) > 0`),帶了正負對照
   ⇒ 🎯 **它證的是【碼在】,不是【它會動】。**
2. **`pcm_sync_order_refund_payment_status` 是匯流點**這一格,同樣是 `position()` 在 `prosrc` 上數出來的
   ⇒ **證的是「它的原始碼裡有那個名字」,不是「它真的會在那條路上被執行到」。**
   🛑 **Q1 定案之前要有人把那九條路實際走一次**,而我沒有走。
3. **「只有整筆退才退回券」我沒有問過 Sean 本人**,是從 migration 檔頭逐字讀來的(2026-08-29 那一句)。
   ⚠️ 那是三週前的話,而**這中間退款那一塊改過很多**。
4. **`admin_cancel_order` / `admin_mark_order_cancelled` 不在那九支裡**是讀數;
   而「取消而沒退款算不算整筆退」**沒有人裁過**,我也沒有判。
5. 讀數是這幾發的。平台側與別的窗都可能在改這些物件。
