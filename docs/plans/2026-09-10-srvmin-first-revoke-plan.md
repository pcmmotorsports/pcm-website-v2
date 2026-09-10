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

【量的】**應用端**(掃 `apps/` + `packages/` 共 **1802** 支 `.ts`/`.tsx`,已排除 `node_modules`):
```
customer_wallet_ledger   from=4  insert=1  update=0  delete=0  upsert=0
🟢 正對照 customer_addresses  from=4  insert=1  update=1  delete=1
🟢 正對照 orders              from=21 insert=0  update=0  delete=0   ← 走 RPC, 不直接寫
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

### 3-2 `customer_addresses` · `customer_vehicles` —— 只收 `TRUNCATE`

【量的】這兩張應用端**真的用到** `insert` / `update` / `delete`(各 1 處)⇒ **那三格不收**。
而 `TRUNCATE` **兩邊都是 0**。

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
· 對客人:**零**(客人走的是 `anon`/`authenticated`,不是 `service_role`)。
· rollback:對應的 `GRANT` 一行還原。
· 號段:窗 C `20260909 08xxxx`(下一個未用號)。

---

## 5. 驗收(缺一不算)

1. **貼前**:那 5 格 `has_table_privilege` 全 `true`(前提斷言 —— 全 `false` 的話代表已經有人收過,停)。
2. **貼後**:那 5 格全 `false`。
3. 🟢 **正對照**:同一發量 `customer_wallet_ledger` 的 `SELECT` / `INSERT` ⇒ **仍是 `true`**(證明只收了該收的)。
4. ⚪ **負對照**:量一張**沒被本片碰**的表(例如 `products`)⇒ 八格**不變**。
5. 🔴 **拋棄式 PG 真的試一次**:收完之後以 `service_role` 身分 `TRUNCATE customer_wallet_ledger` ⇒ **必須被拒**。
   📌 **這一格不能省** —— `has_table_privilege` 印 `false` 與「它真的擋得住」是兩件事,而今晚已經有一次
   「函式建起來了 ≠ 它叫得動」。
6. codex 唯讀審 `-m gpt-6-astra`,must-fix 折完才 commit。

---

## 6. 🛑 我證不到什麼

· **【證不到】那三張表有沒有【我掃不到的】寫入路徑** —— 我的尺只認
  `from('<表>').insert/update/delete` 與 SQL 的 `INSERT/UPDATE/DELETE/TRUNCATE public.<表>`。
  **動態組出來的表名、`SECURITY DEFINER` 函式內部、Edge Function、外部工具,一個都掃不到。**
  ⇒ 📌 **這是【上界的反面】:我量到的「0 次使用」是【下界】,真實使用只會比它多。**
  🔴 **而那正是這一片最危險的一格** —— 板上路由表寫過的威脅模型逐字:
  **「不是攻擊者,是一個善意而看起來完全正確的收緊」**(收錯了三綠不紅、審查看不出來)。
· **【證不到】收了之後真實的付款/儲值流程還跑得動** —— 那要實跑,我做不到。
  ⇒ 🔵 而 `SECURITY DEFINER` 那一族**不受影響**(它們以 owner 身分跑,不看呼叫端的表級權限)。
  🛑 **而這句是【推的】** —— 我沒有實測一支 `SECURITY DEFINER` 函式在呼叫端被 `REVOKE` 之後還寫不寫得進去。
    ⇒ **驗收第 5 格應該連這個一起試。**
· **【證不到】板上那 `12 張全開` 今天是不是還是 12 張** —— 我只複量了它點名的 3 張 + 2 張對照。
· **本片不碰天花板** —— `service_role` 的 `BYPASSRLS` 要 `⟦b9-RLSHARDEN⟧`,**兩列不要各自派**(板上原話)。

---

## 7. 要 Sean 答的一題

```
Q:service_role 有一些【沒有任何地方在用】的寫入權限, 要不要收掉第一批 5 格?

    背景:service_role 是後台與背景工作用的身分, 客人不會拿到它。
      而它今天對 customer_wallet_ledger(儲值金帳簿)有 UPDATE / DELETE / TRUNCATE ——
      🔴 而那是一張【只該一直往下加, 不該改也不該刪】的帳簿。
      我掃了應用端 1802 支檔與全部 migration:兩邊都【只有 INSERT】, 那三格沒有人在用。

    甲(推薦)= 收。第一批 5 格:
        customer_wallet_ledger  UPDATE · DELETE · TRUNCATE
        customer_addresses      TRUNCATE
        customer_vehicles       TRUNCATE
        給的:少掉「一次手滑或一個被打下來的鑰匙, 就把儲值金帳簿清空」這條路。
        代價:🔴 如果有一條【我掃不到的】路在用那些權限, 收了會壞 ——
              而它壞的樣子是【安靜的】:測試不會紅, 審查看不出來。
              🛑 我列的驗收有五格, 其中一格是在拋棄式 PG 上真的試 TRUNCATE 被不被拒。

    乙 = 不收, 記著就好。
        理由:今天沒有人在濫用它, 而收緊有「收錯了很難發現」的風險。
        代價:🔴 那張帳簿今天仍然可以被一行 SQL 清空, 而【那件事不會留下任何痕跡】
              (昨天那件 TRUNCATE 不留痕的結論同樣適用)。

A: 甲|乙
```

🔵 **我不預設,而有一句要先講**:這一題與昨天 `TRUNCATE` 那題**方向相反**。
昨天是「**要不要記下來**」(我判擋不住,所以選了寫規矩);
今天是「**要不要拿掉那個能力**」—— 而 `REVOKE` 是**真的拿得掉**的(§2 量過:`BYPASSRLS` 不會補回表級權限)。
⇒ 📌 **昨天沒有牆可以蓋,今天有。**
