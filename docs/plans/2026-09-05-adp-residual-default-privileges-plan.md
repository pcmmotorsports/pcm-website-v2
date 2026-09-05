# Plan(一頁):**新物件出生自帶的那四種權限 —— 改預設,不逐支收**

> Sean 2026-09-05 拍板逐字:「Q-ADP殘留 … **甲**」= 改預設(以後新建的不再自帶;現有的先記板上不動)。
> 主視窗 `-f8` 派工:版本號 **350000**、貼板 **40**(⛔ ~~37~~ —— 2026-09-05 撞號:`37_` 是線【信】的 380000, Sean 已貼;主視窗 -f8 重新指派)、檔頭三段、鐵則 12② ⇒ codex 對抗審查。

## 1. 前置量測(2026-09-05 唯讀實測,`scripts/readonly-prod-sql.sh`,帶正負對照)

`pg_default_acl`(schema `public`)**六列,兩個 grantor**:

```
postgres        r   postgres=arwdDxtm/postgres   service_role=Dxtm/postgres      ← 🔴 我們的, 這一片動它
postgres        S   postgres=rwU  anon=w  authenticated=w  service_role=w
postgres        f   postgres=X/postgres
supabase_admin  r   postgres=arwdDxtm  anon=arwdDxtm  authenticated=arwdDxtm  service_role=arwdDxtm
supabase_admin  S   postgres=rwU  anon=rwU  authenticated=rwU  service_role=rwU
supabase_admin  f   postgres=X  anon=X  authenticated=X  service_role=X          ← 🛑 平台的, 我們動不到
```

🎯 **`Dxtm` 逐字就是那四種**:`D`=TRUNCATE · `x`=REFERENCES · `t`=TRIGGER · `m`=MAINTAIN。
⇒ 📌 **它不是「順便多給」—— 那一列的內容【只有】那四種。** 移掉之後那一列會整個消失,而
`service_role` 的讀寫**一格都不會少**(它們來自各 migration 明寫的 `GRANT`,實測 `service_role`
對 **81** 個物件有 SELECT)。

## 2. 🔴 兩個數字要訂正,不要照抄 Sean 那題

- ⛔ ~~28 個~~ ⇒ ✅ **今天是 29 個**(Sean 那題的 28 是**早上**量的;之間有幾支 migration 被貼)。
  其中 **27 個四種都有**,2 個少了 `TRUNCATE`(`orders` / `order_items`)。**16 張表 + 13 支 view**。
- 🔵 負對照:今晚新建的 `pcm_incident` **不在那 29 個裡**(`has_table_privilege(service_role, …,
  'TRUNCATE')` = `f`)⇒ 那支檔的四道 `REVOKE` 真的收乾淨了 ⇒ **這把尺分得開「收了」與「沒收」**。

## 3. 🔴 而那 29 個裡有一格不是「差別不大」

Sean 那題的推薦語逐字寫著「收那四種**差別不大**」。**對其餘 25 個是對的,而有 4 個不是**:
(⚠️ 這裡是 29 − 4 = **25**;而 **27** 是另一個集合 = 「四種都有」的個數 —— codex 2026-09-05 nit:
 我原本把兩個不同的分母寫成同一個數。📌 **兩個都對, 而它們不是同一件事。**)

```
products_public · products_list_public · product_variants_public · vehicle_taxonomy_public   (都是 v)
```

🛑 **`TRIGGER` 權限在 view 上可以掛 `INSTEAD OF` trigger** ⇒ **它可能開出一條寫入路徑**。
⚠️ **而那不是一個字就成立的** —— codex 2026-09-05 nit,前提逐條寫出來:
  ① 建 trigger 的人另需那支 trigger function 的 `EXECUTE`;
  ② 呼叫端仍需要 view 本身的 DML 權限(而 `20260905260000` 剛把 anon/authenticated 那半收掉了);
  ③ **不需要**是 owner。
⇒ 📌 所以正確的說法是「**可能建立寫入路徑**」而不是「會變成可寫的」——
  ⛔ ~~一支唯讀 view 會變成可寫的~~ 那句太滿, 它跳過了兩個前提。
那四支正是 2026-09-05 `⟦b9-PUBLICVIEWALL⟧`(20260905260000)剛把 anon/authenticated 的寫入
收掉的顧客站 view。⇒ 📌 **「今天沒人用那四種」是對的,而「用了會怎樣」在這四支上與別的 25 個不同。**
⇒ 🔵 **本片不收那 4 支**(甲案就是不逐支收),而**這一格要記進板列**,不能被「差別不大」蓋掉。

## 4. 要做什麼(一行 SQL + 三道閘)

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLES FROM service_role;
```

- **前置閘**(⚠️ **與初稿不同, 這一段是實作之後訂正的** —— codex 2026-09-05 must-fix:
  初稿寫「不是精確字串就拒絕」, 而實作有一個**放行**的態, 兩者不對齊):
  · ⓪ **全域**預設權限(不綁 schema)若在給那四種 ⇒ **拒** —— per-schema 的 REVOKE 抵銷不掉它,
    貼下去會**成功而無效**。(2026-09-05 實測:全庫 27 列**全部綁 schema**, 今天一列全域的都沒有。)
  · ⓪b `service_role` / `postgres` 角色不存在 ⇒ 拒(否則 `to_regrole` 全是 NULL, 每一格都假綠)。
  · ① `service_role` 拿到的**恰好**是那四種 ⇒ 放行;多一格少一格 ⇒ 拒。
  · 🔵 **`service_role` 已經不在那一列 ⇒ 判【已經做過了】並 no-op 放行**(冪等)。
    ⛔ ~~初稿把這個世界也判成拒~~ ⇒ 📌 **那會讓「已經做過」與「被別人破壞」印同一個紅**,
    而它們的下一步完全不同。
  · 🔴 **逐條解析 ACL, 不比整串字面** —— 拋棄式 PG 實測:同一個設定在正式庫印
    `postgres=arwdDxtm  service_role=Dxtm`, 在空庫只印 `service_role=Dxtm`
    (PG 省略等於內建值的 owner 條目)⇒ 整串比對等於把閘綁死在一個環境的字串上。
- **事後閘六格**:①service_role 不再在那一列 ②postgres 那格未動 ③終態是兩種合法形狀之一
  ④ **supabase_admin 三列的【內容】**與抽取時相同(⛔ ~~只數列數 = 3~~ —— codex must-fix:
  內容被改而列數不變照樣通過, 而平台合法新增第四類 ⇒ 假紅。**數量不是內容。**)
  ⑤ 既有物件數 **改前 == 改後**(⛔ ~~判 `>= 1`~~ —— 29 個意外只剩 1 個也會通過,
  而哪天合法清到 0 反而假紅 ⇒ 改成用 `TEMP TABLE` 記下改前的讀數再比)
  ⑥ 事後再問一次全域那條路。
- **零留痕**:`ALTER DEFAULT PRIVILEGES` 不碰任何既有物件。

## 5. 🛑 這一片證不到 / 管不到什麼

- 🔴 **`supabase_admin` 那三列我們動不到** ⇒ **由 `supabase_admin` 建立的新物件照樣自帶全部四種**
  (而且連 `anon`/`authenticated` 都自帶 `arwdDxtm`)。⇒ 📌 **這一片只關掉【我們自己建】那條路。**
  ⇒ 而「誰建的」取決於貼的人當下是哪個角色 —— Sean 在 SQL Editor 貼是 `postgres`,所以涵蓋得到。
- 🔴 **它不追溯**:29 個現有物件一個都不會變。板列要寫清楚,否則下一個人會以為關掉就等於清乾淨。
- 🔴 它只管 `TABLES`(含 view);`SEQUENCES` 那一列(`anon=w` 等)**本片不動** —— 那是另一題。
- ⚠️ 序列那一列給 anon/authenticated `w`(UPDATE)是**另一個**看起來該問的東西,而 Sean 沒有被問過
  ⇒ **不在本片射程,記進板列。**
