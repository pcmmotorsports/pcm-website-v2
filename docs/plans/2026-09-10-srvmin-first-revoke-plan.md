# 2026-09-10 `⟦b9-SRVMIN⟧` 的第一批 `REVOKE` —— plan

> 🛑 **等 Sean 批才動手。** 動 `GRANT`/`REVOKE` ⇒ 鐵則 8 + 12② ⇒ plan + codex 唯讀審,而 **migration 由主視窗代貼**。
> 來源標籤:**【量的】**(命令 + 讀數,尺先證明會咬)/ **【推的】** / **【證不到】**

---

## 0. 這一列今天卡在哪 —— **不是沒人量,是量完了沒人動手**

板列自己的結論逐字:
> 🔴 **⇒ 所以本列今天真正卡的是【④ 沒有做任何 `REVOKE`】** —— 📌 **它不是「沒人量」,是【量完了而沒有人動手】**
> —— **而這兩種狀態在板上都寫成 `open`,該派的下一步卻完全不同。**

四個窗量過(`-auth` 09-05 · `-ship` 09-07 · `-auth` 09-07 · `-db` 09-08)。**這一份不重量它們量過的,只做第一批 `REVOKE` 的 plan。**

---

## 1. 【量的】複量:板上點名那三張表今天還是全開嗎

`-db` 2026-09-08 量到「八種全開(`SIUDTRGM`)的 12 張」,並判**第一批不是那 12 張,是其中【3 張非目錄的】**。
【量的】2026-09-10 唯讀複量:

```
表                      S I U D T R G M
customer_addresses      1 1 1 1 1 1 1 1
customer_vehicles       1 1 1 1 1 1 1 1
customer_wallet_ledger  1 1 1 1 1 1 1 1   ← 🔴 含 TRUNCATE
🟢 正對照 orders         1 0 0 0 0 1 1 1   ← 尺分得出來, 不是什麼都印 1
🟢 正對照 products       1 1 1 1 1 1 1 1   ← 目錄那族, 全開是預期的
```

⇒ ✅ **三張都還是全開,板上那一格今天成立。**

---

## 2. 🔴 而這一格順手證了一件板上講得容易被誤讀的事

板上寫:
> 🔴🔴 **email/cron 收窄有一個【天花板】**:`service_role` 的 **`rolbypassrls = t`**
> ⇒ 📌 **收表級 `GRANT` 不會收掉它繞過 RLS 的能力。**

🛑 **那句話對,而它很容易被讀成「所以 `REVOKE` 沒有用」。**

【量的】**證據就在上面那張表裡**:`service_role` 的 `rolbypassrls = true`(2026-09-10 複量,6 個 BYPASSRLS 角色之一),
**而它對 `orders` 的 `TRUNCATE` 是 `0`。**

⇒ 📌 **`BYPASSRLS` 繞過的是【RLS 政策】,不是【表級 GRANT】。**
⇒ ✅ **所以 `REVOKE` 對寫入類權限是【真的有效的】** —— 收掉 `TRUNCATE` 之後它就是不能 `TRUNCATE`。
⇒ 🛑 **天花板只限制「靠 RLS 保護 `SELECT`」那一半**,不限制「拿掉它不該有的寫入權」那一半。

---

## 3. 🎯 第一批要收什麼 —— **只收【量到沒有人在用】的**

### 3-1 `customer_wallet_ledger` —— 一張只該追加的帳簿

【量的】**應用端**掃法(寫全,免得下一個人重跑得到別的數):
`os.walk('apps','packages')`,排除 `node_modules` / `.next` / `dist` / `build` / `.turbo` ⇒ **1802 支** `.ts`/`.tsx`;
樣式 `from(['"]<表>['"])` 與 `from(...)\s*\.\s*(insert|update|delete|upsert)`。
🔴 **而我第一版的 `orders` 數字是錯的**(codex 抓到,我重數,它對):`from('orders')` 字面命中 **21** 處,
**其中 6 處在註解行** ⇒ **實際程式 15 處**。📌 **又是那一格:grep 的分母是整支檔的全部字元。**
```
customer_wallet_ledger   from=4  insert=1  update=0  delete=0  upsert=0
🟢 正對照 customer_addresses  from=4  insert=1  update=1  delete=1
🟢 正對照 orders              from=15 insert=0  update=0  delete=0   ← 走 RPC, 不直接寫
```
【量的】**migration 端**(剝掉整行註解後掃 `supabase/migrations/*.sql`):
```
INSERT INTO   2 處  (20260716210000_m4a_admin_adjust_wallet_rpc.sql · 20260906800000_m4b_wallet_adjust_idempotency.sql)
UPDATE        0
DELETE FROM   0
TRUNCATE      0
```
⇒ ✅ **兩邊都只有 INSERT。`UPDATE` / `DELETE` / `TRUNCATE` 三格,沒有任何一個地方在用。**

**建議收**:`REVOKE UPDATE, DELETE, TRUNCATE ON public.customer_wallet_ledger FROM service_role;`

### 3-2 `customer_addresses` · `customer_vehicles` —— 本批只收 `TRUNCATE`

【量的】這兩張應用端**有** `insert` / `update` / `delete`(各 1 處),而 `TRUNCATE` **兩邊都是 0**。

🔴 **而我第一版從那個「有」推出「所以那三格不能收」—— 那個推論不成立**(codex must-fix,它對):
📌 **「應用端有一個 insert 方法」證明的是【那個方法存在】,不是【`service_role` 在用它】。**
那些寫入**很可能是走 `authenticated` + RLS**(客人自己管自己的地址與車輛),而**我沒有查它們用的是哪個 client**。
⇒ ✅ **正確的寫法**:**本批不處理那六格** —— 不是因為「確認必須保留」,是因為 **`service_role` 對它們的必要性【尚未建立】**。
🛑 **而這不代表本輪該擴大收** —— 未建立必要性 ≠ 已證明不需要。**那是下一批的題目。**

**建議收**:`REVOKE TRUNCATE ON public.customer_addresses, public.customer_vehicles FROM service_role;`

### ⇒ 第一批總共 5 格
```
customer_wallet_ledger   UPDATE · DELETE · TRUNCATE
customer_addresses       TRUNCATE
customer_vehicles        TRUNCATE
```
🔵 **其餘 9 張全開的是商品目錄那一族**(同步器整批重寫)⇒ 板上判 `I/U/D` 甚至 `TRUNCATE` 都說得通 ⇒ **本批不碰**。

---

## 4. 影響 / rollback

· 只動 `REVOKE`,**不新增任何物件、不改任何資料、不改 RLS**。
· 對客人:🔴 **不能說「零」**(codex must-fix)—— 正確說法是**本片不直接改 `anon`/`authenticated` 的授權**,
  而**客人的操作可能間接經過後端或背景工作**,所以功能影響**仍待驗收**,不是先驗為零。
· rollback:對應的 `GRANT` 一行還原。
· 號段:窗 C `20260909 08xxxx`(下一個未用號)。

---

## 5. 驗收(缺一不算 —— 🔴 第二版,codex must-fix 說我第一版容易得到假綠)

### 5-1 權限讀數
1. **貼前:那 5 格 `has_table_privilege` 必須全 `true`。**
   🔴 **任何一格不是 `true` 就停** —— 包含缺表、回 NULL、部分已被收過。**不是只有「全 false」才停。**
2. **貼前斷言 → `REVOKE` → 貼後斷言,三段放在【同一個交易】裡,`COMMIT` 之前**,並帶 `ON_ERROR_STOP=1`。
   📌 否則第二段炸掉會留下**收了一半**的狀態。
3. **貼後**:那 5 格全 `false`。
4. 🟢 **正對照**:`customer_wallet_ledger` 的 `SELECT`/`INSERT` **仍是 `true`**;
   而 `customer_addresses`/`customer_vehicles` 的 `INSERT`/`UPDATE`/`DELETE` **也仍是 `true`**
   ⇒ 📌 **只驗 ledger 兩格 + `products` 八格,證不到地址與車輛沒被誤傷。**
5. ⚪ **負對照**:`products` 八格**不變**。
6. 🔴 **`UPDATE` 那格要加驗 `has_any_column_privilege`** —— 排除**欄級授權**從別的來源補回來。
7. **`authenticated` 對那三張表的權限也要一起印**(貼前/貼後各一次)⇒ 證明本片沒有動到客人那條路。

### 5-2 行為測試(🔴 **五格都要,不是只有 ledger 的 TRUNCATE**)
在拋棄式 PG 上(照 `docs/runbooks/throwaway-postgres-for-migration-verification.md` §1 整段貼):
1. **先證明收之前會成功** —— 同一角色、同一張表、同一句話,收之前跑得動(假資料,交易回滾)。
   📌 **少了這一步,「收之後失敗」有兩種原因:權限收掉了,或那句話本來就不會成功。**
2. **套用【實際那支 migration】**,不是另手打一份簡化的 `REVOKE`。
3. 交易裡 `SET LOCAL ROLE service_role`,**先印 `current_user` 確認真的換了角色**
   ⇒ 🛑 **只設 JWT 的 role claim 不算換 PG 角色。**
4. **失敗必須是【目標表的權限被拒】** —— 缺 schema `USAGE`、表不存在、FK 擋、唯讀交易、換角色失敗,**都不算通過**。
5. 預期失敗用 savepoint / 例外區塊隔離;**操作意外成功必須讓測試紅**,不可以吞掉任意錯誤。
6. **還原權限之後,同一個操作要再成功一次。**
🔵 **角色怎麼建**(若 runbook bootstrap 沒建):
`CREATE ROLE service_role NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT BYPASSRLS;`
🛑 **表要交給另一個 owner** —— 不可以用 `service_role` 建表,也不可以拿本機的 `postgres` 超級使用者當它。

### 5-3 業務回歸
· 實際跑 `admin_adjust_wallet`:**成功新增 ledger 列 + 更新餘額 + 寫入稽核**,而**重送同一個 `request_id` 不重複入帳**。
· 🔵 **語義對照**:同一句 `UPDATE`,`SECURITY INVOKER` 被拒,而 owner 有權限的 `SECURITY DEFINER` 成功。
  📌 **只測 INSERT 型的 DEFINER 驗不到這個主張** —— 本批本來就保留 `INSERT`。

### 5-4 最後
· codex 唯讀審 `-m gpt-6-astra`,must-fix 折完才 commit。
· 🛑 **拋棄式 PG 只證得到 PostgreSQL 的語義。** 要代表正式庫還要重現角色屬性/繼承、owner、ACL、FK、trigger、
  函式定義與版本差異 ⇒ **那一格我不宣稱做得到。**

---

## 6. 🛑 我證不到什麼

· **【證不到】那三張表有沒有【我掃不到的】寫入路徑** —— 我的尺只認
  `from('<表>').insert/update/delete` 與 SQL 的 `INSERT/UPDATE/DELETE/TRUNCATE public.<表>`。
  **動態組出來的表名、`SECURITY DEFINER` 函式內部、Edge Function、外部工具,一個都掃不到。**
  ⇒ 📌 **這是【上界的反面】:我量到的「0 次使用」是【下界】,真實使用只會比它多。**
  🔴 **而那正是這一片最危險的一格** —— 板上路由表寫過的威脅模型逐字:
  **「不是攻擊者,是一個善意而看起來完全正確的收緊」**(收錯了三綠不紅、審查看不出來)。
· **【證不到】收了之後真實的付款/儲值流程還跑得動** —— 那要實跑,我做不到。
  🔴 **而我第一版寫「`SECURITY DEFINER` 那一族不受影響」—— 那句話的條件寫錯了**(codex must-fix,它對)。
  ✅ **正確條件是**:**函式【owner】所需的權限不受本次撤銷影響,而且呼叫鏈與自訂權限檢查沒有另外依賴呼叫者。**
  📌 `SECURITY DEFINER` 只保證「以 owner 身分跑」,**不保證 owner 是 `postgres`、也不保證 owner 有權限**。
  🔴 **codex 給的反例**:如果某支函式的 owner 就是 `service_role`,收掉它的 `UPDATE` 之後那支函式照樣失敗。
  ✅ **而我去量了,那個反例在這個庫裡不成立**(2026-09-10 唯讀):
  ```
  碰 customer_wallet_ledger 的函式  admin_adjust_wallet   owner=postgres   prosecdef=t   ← 只有這一支
  ⚪ 負對照:owner 是 service_role 的函式有幾支          0
  🟢 正對照:public 底下函式總數                      211   ⇒ 尺會咬
  ```
  ⇒ 🔵 **所以這個庫今天沒有那個反例,而【那是量出來的,不是設計保證的】** —— 哪天有人把某支函式的 owner 改成
    `service_role`,這一格就翻掉,而**不會有任何東西叫**。
· 🔴 **而我第一版還有一句自相矛盾**(codex nit,它對):我寫「`SECURITY DEFINER` 函式內部**一個都掃不到**」,
  而我自己的 migration 側讀數 `INSERT INTO = 2 處` **兩處都在 `SECURITY DEFINER` 函式內**。
  ✅ **正確說法**:**靜態 SQL 掃得到一部分,而【現役定義、owner、間接呼叫鏈】我沒有核完。**
· **【證不到】那兩處 `INSERT` 是不是兩條現役路徑** —— codex 指出它們是**同一支函式的歷史版本**。
· **【證不到】FK 連動刪除、可寫 view / trigger 的間接路徑、Auth Admin API、以及日後有人再 `GRANT` 回去。**
· 🛑 **rollback 只還原權限,不會自動補回停權期間失敗的工作。**
· **【證不到】板上那 `12 張全開` 今天是不是還是 12 張** —— 我只複量了它點名的 3 張 + 2 張對照。
· **本片不碰天花板** —— `service_role` 的 `BYPASSRLS` 要 `⟦b9-RLSHARDEN⟧`,**兩列不要各自派**(板上原話)。

---

## 7. 要 Sean 答的一題

> 🔴 **第二版。** 第一版兩個選項的效益與代價**都寫太滿**(codex must-fix,逐條它都對)。

```
Q:service_role 有一些【我掃不到有人在用】的寫入權限, 要不要收掉第一批 5 格?

    背景:service_role 是後台與背景工作用的身分。
      它今天對 customer_wallet_ledger(儲值金帳簿)有 UPDATE / DELETE / TRUNCATE ——
      而那是一張【只該一直往下加, 不該改也不該刪】的帳簿。
      我掃了應用端 1802 支檔與全部 migration:兩邊都【只有 INSERT】。
      🛑 而那個「只有 INSERT」是【下界】—— 動態 SQL / Edge Function / 外部工具我掃不到。

    甲(推薦)= 把角色與間接路徑核對完、回歸驗收跑過之後, 收這五格。
        給的:少掉【直接誤寫與清表】這條路。
        🛑 不給的(第一版我寫太滿, 這幾格要說清楚):
          · 它【不保證】一把被偷走的 service key 就傷不到帳簿 ——
            Auth Admin 刪人、FK 連動、其他高權限入口都還在。
          · 部署之後仍要確認業務結果, 不是收完就算數。
        代價:如果有一條我掃不到的路在用那些權限, 收了會壞。
          🔵 而【壞的樣子沒有我第一版說的那麼安靜】:權限被拒通常是明確錯誤,
            而 repo 的 wallet 呼叫端(customer-repository.ts:93)會 throw
            ⇒ 正確說法是「既有測試可能沒覆蓋到; 只有在呼叫端把錯誤吞掉時才會安靜」。

    乙 = 本輪暫緩。
        給的:不冒「收錯了」的風險。
        代價:直接權限的曝險維持原樣, 而【尚未查清的使用路徑與風險也一起維持】。
        🛑 而我第一版寫「今天沒有人在濫用它」——【那個我證不到】:
          掃原始碼證不到正式環境有沒有發生過。

A: 甲|乙
```

🛑 **兩句我第一版寫過而現在收回**:
· ⛔ ~~「那件事不會留下任何痕跡」~~ ⇒ **超出我量到的範圍**。昨天我量的是 **`orders` 的 DELETE trigger 不會因 `TRUNCATE` 新增稽核列**,
  **沒有量 ledger 的所有稽核路徑,也沒有量平台日誌**。而 PostgreSQL **是支援 `ON TRUNCATE` trigger 的**。
· ⛔ ~~「昨天沒有牆可以蓋,今天有」~~ ⇒ **比較的身分不同**:昨天談的是 owner / 管理連線,今天限制的是 `service_role`。
  ✅ 保留得住的只有那一句技術事實:**`BYPASSRLS` 繞過 RLS 政策,不繞過表級 `GRANT`** —— 那個 §2 量過。
