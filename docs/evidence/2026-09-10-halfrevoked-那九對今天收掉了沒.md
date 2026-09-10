# 2026-09-10 `⟦auth-HALFREVOKEDTRIGGERS⟧` —— 那支修法貼了,**而沒有人驗過它做到沒有**

> 板列今天是 **`done`**,理由是「那支 migration 2026-09-09 01:37 貼進正式庫了」(帳本落款逐字 `@20260909-013729-52210 貼板`)。
>
> 🛑 **而板上從頭到尾沒有一行寫著【那 9 對 `EXECUTE` 收掉了沒】。**
> 📌 **「migration 貼了」與「它做到了它說的事」是兩件事** —— 今晚已經有一次同型(「函式建起來了 ≠ 它叫得動」)。
> **這一份就是那一發。**

來源標籤:**【量的】**(命令 + 讀數,尺先證明會咬)/ **【推的】** / **【證不到】**

---

## 一、原本是什麼

板列開列時(`-auth` 2026-09-08)量到:三支 trigger 函式的 migration 裡各有一行 `REVOKE`,
而**三行逐字都只收 `FROM PUBLIC`**:

```
pcm_staff_touch_updated_at      20260726120000_m4b_e8a1_staff_table.sql:53
pcm_suppliers_block_delete      20260801140000_m4b_e10_s1a_suppliers.sql:112
pcm_suppliers_touch_updated_at  20260801140000_m4b_e10_s1a_suppliers.sql:77
```
⇒ 線上三支各自對 `anon` / `authenticated` / `service_role` **都有 `EXECUTE`** ⇒ **共 9 對**。

🎯 而板列最值錢的一句(不是我的):
> **一道半的守門會【關掉下一個人的檢查動作】** —— 沒有人守 ⇒ 讀 migration 的人看得出來沒收;
> 有人守了而只守一半 ⇒ **讀 migration 的人看到 `REVOKE` 就過去了**。

---

## 二、【量的】今天:**九對全部收掉了**

2026-09-10 唯讀查正式庫(`bash scripts/readonly-prod-sql.sh`,零寫入):

```
              函式              |     角色      | 還有 EXECUTE
--------------------------------+---------------+-------------
 pcm_staff_touch_updated_at     | anon          | f
 pcm_staff_touch_updated_at     | authenticated | f
 pcm_staff_touch_updated_at     | service_role  | f
 pcm_suppliers_block_delete     | anon          | f
 pcm_suppliers_block_delete     | authenticated | f
 pcm_suppliers_block_delete     | service_role  | f
 pcm_suppliers_touch_updated_at | anon          | f
 pcm_suppliers_touch_updated_at | authenticated | f
 pcm_suppliers_touch_updated_at | service_role  | f
```

⇒ ✅ **9/9 收掉了。那支 migration 真的做到了它說的事。**

### 🛑 而我第一發的正對照是死的,修了

我原本拿 `service_role` 對 `confirm_order_payment(uuid,text,text,text,jsonb,text)` 當「尺印得出 `true` 嗎」的對照
⇒ **回 `ERROR: function … does not exist`**(我猜的簽章)⇒ 📌 **那一發什麼都沒證到,而九個 `false` 就少了背書。**

✅ **改量**:
```
🟢 service_role 有 EXECUTE 的 public 函式有幾支     83 支
   舉三個  admin_add_shipment_items · admin_adjust_wallet · admin_append_order_note
⚪ 負對照 anon 對那三支 trigger 函式(必須 0)        0
```
⇒ ✅ **尺印得出 `true`(83 次)⇒ 那九個 `false` 是真的 `false`,不是尺瞎了。**

📌 **今天第二次踩同一格**(上一次是拿 `postgres:rolsuper` 當對照,而這個庫裡 `postgres` 不是 superuser)。
🎯 **兩次的形狀一樣:我挑了一個【我以為會是 true】的對照,而它本來就是 false / 不存在。**
⇒ **正對照要先驗它自己該是 `true`。**

---

## 三、順帶把板上那一格「證不到」也答了一半

板列自標的那一格逐字:
> 🛑 **它證不了【線上那 9 對為什麼是 true】** —— 線上的結果與【直接授權】和【角色繼承】兩種來源**都相容**,而本片**沒有分**。
> 若來源是繼承,**事後閘① 會擋下並整支回滾**(修得掉的只有直接授權那一種)。

⇒ 🔵 **今天的讀數把那一格答掉了一半,而是用【結果】答的不是用【分析】答的**:
· 那支 migration **貼成功了**(帳本有落款),而它自己的事後閘①**會在來源是繼承時擋下並整支回滾**。
· 而今天九格**全 `f`**。
⇒ 📌 **所以來源是【直接授權】那一種** —— 否則它會回滾,而九格不會全 `f`。

✅ **而我把它從【推的】變成【量的】了** —— 因為驗它很便宜(開檔即可),**便宜的就不該留著**:
`20260909020000_m4b_halfrevoke1_second_revoke_three_trigger_fns.sql` 逐字:
```
:174  -- 事後閘① 9 對(3 函式 x 3 角色)全部必須是 false
:179        IF has_function_privilege(v_role, v_fn, 'EXECUTE') THEN
:185      RAISE EXCEPTION '貼板107 事後閘①:仍有 EXECUTE 沒收乾淨 ⇒ %', v_still;
:159  -- ⇒ has_function_privilege() 仍會回 true ⇒ **事後閘① 會讓整支 migration 中止並回滾**
```
⇒ ✅ **它真的長那樣**:9 對任一格為 `true` 就 `RAISE EXCEPTION` ⇒ 整支回滾。
⇒ 📌 **所以「它貼成功了」這件事本身,就等於「當時九格都是 false」。**

🎯 **而那支檔自己還有一道我沒想到的守門**(`:188-189` 逐字):
> 事後閘② 🟢 **正對照 —— 它排除的是【一把對所有受測輸入一律回 false 的尺】。**
> 少了它,那種壞尺會讓事後閘①【無條件通過】。
📌 **那正是我今天自己踩了兩次的那一格** —— 而寫那支 migration 的人**把它寫進閘裡**,不是靠記得。

---

## 四、⚪ 三支的 `prosecdef` 今天仍是 `false`

```
pcm_staff_touch_updated_at=false · pcm_suppliers_block_delete=false · pcm_suppliers_touch_updated_at=false
```
⇒ ✅ 與板上 2026-09-08 量到的一致 ⇒ **非 `SECURITY DEFINER`,以呼叫者身分跑,嚴重度低一階**(板列原判,今天仍成立)。

---

## 五、⇒ 這一列的狀態

| 板上寫的 | 今天量到的 |
|---|---|
| 態 = `done`(因為 migration 貼了) | ✅ **而現在有【結果】的證據**:9/9 收掉了 |
| 「證不了那 9 對為什麼是 true」 | ✅ **答了一半,而是【量的】**:開檔核過事後閘① 真的是「9 對全 false 否則 RAISE」⇒ 它貼成功 = 當時九格全 false ⇒ 來源是直接授權 |
| 「非 DEFINER ⇒ 嚴重度低一階」 | ✅ 今天複量,仍成立 |

⇒ 🛑 **我沒有改板、沒有改態、沒有動任何權限。這一份只補一格:那個 `done` 現在站得住,而它原本只站在「貼了」上面。**

---

## 六、🛑 我證不到什麼

· **【證不到】那 9 對是什麼時候變 `false` 的** —— 我只知道「09-08 是 true、今天是 false」,而中間**只有那一支 migration** 是**推的**(可能有別的東西也收過)。
· **【證不到】那三支函式今天能不能被當一般函式直接呼叫** —— 板列 ① 那一格仍然空著,而它需要一個**對這三支有 `EXECUTE` 的身分**,而今天**沒有任何角色有**(那正是修好的樣子)⇒ 📌 **修好之後,那一格反而更難驗了。**
· **只量了那三支 × 三個角色。** 別的角色、別的函式、繼承路徑,都沒做。

**正式庫零寫入。**
