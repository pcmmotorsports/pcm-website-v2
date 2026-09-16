# Plan · 撤銷到貨要留「為什麼」(鐵則 8,等 Sean 批)

> 後台窗 · 2026-09-17 · worktree `/Users/sean_1/pcm-ops`
> 🛑 **本檔只是 plan,一行碼都沒動。** 要改 DB 函式簽章 ⇒ 正式庫 DDL ⇒ **要 Sean 批。**

---

## 0. 🟢 先講一件好消息:這件的【一半已經做完了】

| 那一半 | 狀態 |
|---|---|
| ② **看得到** | ✅ **2026-09-17 已完成**(`755bd229c` / `7e2004db7`):操作紀錄多一欄「為什麼」,沒填印「—」,並加一句「是選填的」免得被讀成壞掉 |
| ① **填得進去** | 🔴 **本 plan 要做的就是這一半** |

🔴 **而「填得進去」比想像中小** —— 查過之後(非推論,附出處):
```
admin_audit_log.reason 欄            20260712210000:50   逐字「內部原因(取消/tier 變更內部原因寫這)」
撤銷那支 RPC 的 audit INSERT          20260810233000:440-450
  INSERT INTO public.admin_audit_log (actor, action, target, before, after, reason, request_id, source_app)
  VALUES (v_actor, 'procurement_receipt.delete', …, <before jsonb>, NULL, NULL, v_req, 'admin');
                                                                    ↑after ↑reason ← **寫死的 NULL**
```
⇒ 📌 **欄位在、INSERT 也已經列了那一欄 —— 只是傳了 `NULL`。** 這不是「加欄位」,是**把寫死的 NULL 換成一個值**。

---

## 1. 改什麼

### (a) DB:`admin_delete_item_receipt` 加一個參數
```sql
-- 現況(20260810233000:280-284)
CREATE FUNCTION public.admin_delete_item_receipt(
  p_receipt_id uuid,
  p_actor      text,
  p_request_id text
)

-- 本片
  p_reason     text DEFAULT NULL      -- 🔴 DEFAULT 是承重的, 見 §3
```
並把步 7 那個寫死的 `NULL` 換成 `p_reason`(**只換那一個位置,`after` 的 NULL 不動**)。

### (b) TS:`receipt-repository.ts:257` 那一發多送一個 `p_reason`;表單多一格輸入
入口兩處(**兩處都要,漏一處就是「有些地方填得到有些填不到」**):
- `apps/admin/src/components/orders/receipt-delete-button.tsx`(明細頁每一筆的 `撤銷 → 確定撤銷`)
- `apps/admin/src/components/orders/receipt-undo-bar.tsx`(剛登記完那一條「回到貨登記」)

---

## 2. 🔴 必填還是選填 —— **兩案並列,要 Sean 拍**

```
Q 撤銷到貨要不要【一定】填原因?
A 甲 = 選填(不填就照舊送 NULL)
     🟢 不改變任何人今天按得動的東西;壞處是多數人不會填 ⇒ 那一欄大半仍是「—」
  乙 = 必填(沒填不給按)
     🟢 以後每一筆都查得到為什麼
     🔴 代價要講白:**它會擋住一個今天按得動的動作** —— 而 Sean 2026-09-16 08:07 自己用過
        那條路(`procurement_receipt.delete` 稽核列在)⇒ 下次他撤銷時會多一步
     ⚠️ 而「必填」擋不住敷衍:員工打一個「.」就過。實證:目前稽核表最近三筆 reason
        逐字是 `TEST` / `test`。⇒ **必填買到的是「有東西」, 不是「有意義」。**
```
🛑 **我不預設** —— 這一題碰的是他自己每天的操作。

---

## 3. 🔴 承重的三件(照抄, 不要憑記得)

### ① `p_reason` **一定要 `DEFAULT NULL`**
CLAUDE.md 逐字:「改既有函式的簽章(加/減參數)⇒ **兩個方向都有空窗**:板先貼 ⇒ 舊碼叫不動(PGRST202);碼先推 ⇒ 新碼叫不動。」
⇒ **`DEFAULT NULL` 是唯一避得開的寫法**:舊碼不送那個參數照樣叫得動 ⇒ 板可以先貼。
⚠️ 而它**只避開空窗,不免除「板與碼當同一次動作」那條** —— 中間時間仍然壓到最短。

### ② `SET search_path` 那一行**不是**這個 repo 的通例,不要「順手改對」
```
20260810233000:288   SET search_path = public, pg_temp      ← 這一支
其他多數 SECURITY DEFINER   SET search_path = ''
```
🔴 **本片是 `CREATE OR REPLACE`,而 `CREATE OR REPLACE` 會把 SET 子句整組換掉** ⇒ **必須原樣寫回 `public, pg_temp`**。
🛑 **想改成 `''` 是另一件事**(那會讓函式體裡所有裸名字失效)—— **不要夾帶**。

### ③ 成本遮罩:**這一支不受影響,而我查過才敢這樣說**
稽核頁的遮罩只掛在 `COST_AUDIT_ACTION = 'orders.item.costs.set'`(`settings/audit/page.tsx`)。
撤銷到貨是 `procurement_receipt.delete` ⇒ **不在那一族** ⇒ 它的 reason 全員看得到。
⚠️ **而那是對的**:那一筆的 before-image 是數量 / 到貨時間 / 收貨人,**沒有成本**。
🔴 **但要寫進實作時的註解**:若哪天有人把成本搬進這條路,遮罩那一格要跟著加 ——
📌 **一道遮罩的射程止於它遮的那幾欄與那幾個 action**(2026-09-17 加「為什麼」那一欄時踩過一次)。

---

## 4. 影響 / Rollback

- **資料**:0 筆既有資料被改寫。既有的 `procurement_receipt.delete` 稽核列 `reason` 仍是 NULL(畫面印「—」)。
- **射程**:只有**撤銷到貨**這一條路。其他寫 reason 的動作(取消 / tier / 作廢箱)一個字不動。
- **Rollback**:`CREATE OR REPLACE` 寫回 `20260810233000` 那一版的函式本體。
  🔴 **而這一次的 rollback 檔要一起寫**(不要再出現 `20260916210000` 那種「同日 21 支都有、獨缺它」),
  並且**要在拋棄式 PG 上真的跑一次** —— 📌 **一份沒有被跑過的還原檔,與沒有還原檔的差別只有「你以為有」。**
  ⚠️ 退之前要先退 TS?**不用** —— 有 `DEFAULT NULL` ⇒ 新碼送 `p_reason` 給舊函式會 PGRST202。
  🔴 **等一下 —— 那句是錯的,退的方向相反**:退回舊簽章之後,**新碼仍然會送 `p_reason`** ⇒ 舊函式收不到 ⇒ **PGRST202**。
  ⇒ ✅ **退的順序:先 revert TS 那一顆並部署,再跑還原檔。**(與貼板時相反。)

## 5. 驗收(yes/no)
1. 撤銷一筆到貨、填一句原因 ⇒ 操作紀錄那一頁的「為什麼」印得出那句話。
2. 撤銷一筆**不填**原因(若 Sean 選甲)⇒ 那一欄印「—」,不是空白、不是報錯。
3. 舊碼(不送 `p_reason`)對新函式**仍然叫得動** —— 拋棄式 PG 上驗,證 `DEFAULT NULL` 真的在。
4. 還原檔在拋棄式 PG 上**真的跑過一次**,md5 回到 `20260810233000` 那一代。
5. 🛑 **「那一格好不好填、手機上會不會擠」jsdom 證不到 ⇒ 留給 Sean 走一遍。**

## 6. 鐵則 12
碰**稽核 + 改既有 RPC 簽章** ⇒ 要唯讀審一輪。**codex 額度 09-20 12:12 才回** ⇒ 期間走 `adversarial-reviewer`。
R1 PASS 修完收工;R1 有必修才 R2;**R2 還有必修 ⇒ 停下端主視窗,不跑 R3。**
