# 2026-09-10 `⟦b9-RLSHARDEN⟧` —— **第三例:關閉條件前半 09-09 就達成了,而板上零命中**

> 主視窗要我開檔第一件事就驗那句「開檔前不要引用」的推測。**驗了 —— 成立,而且是可量的。**

來源標籤:**【量的】**(命令 + 讀數,尺先證明會咬)/ **【推的】** / **【證不到】**

---

## 一、【量的】那句推測成立 —— 而不是靠讀,是靠數

板列的關閉條件前半逐字(`docs/launch-todo.md:679`):
> 「**先補 3 條 policy(`admin_audit_log` 的 I · `admin_sso_login_events` 的 I · `staff` 的 I+U`)**」

而 `docs/plans/2026-09-09-rls-harden-who-goes-quiet-plan.md` §2 標題逐字(**我 09-09 自己寫的**):
> ## 2. 🎯 `⟦b9-RLSHARDEN⟧` —— **關閉條件的前半已經不成立了**
> 🎯 **要的是 I / I / I+U ——【今天都在】。前半達成。**

### 【量的】板上知不知道 —— 對整列(20,474 字)找那幾個字串

```
admin_audit_log_insert_service_role   0 次
staff_insert_service_role             0 次
staff_update_service_role             0 次
「已補」                               0 次
「前半達成」                           0 次
🟢 正對照「關閉條件」                   1 次   ⇒ 尺會咬, 那些 0 是真的 0
```
⇒ 🔴 **板上零命中。第三例成立。**

---

## 二、【量的】而那四條 policy 今天還在 —— 複量

```
表                      policy                                      命令    給誰          permissive
admin_audit_log         admin_audit_log_insert_service_role         INSERT  service_role  t
admin_audit_log         admin_audit_log_select_service_role         SELECT  service_role  t
admin_sso_login_events  admin_sso_login_events_insert_service_role  INSERT  service_role  t
staff                   staff_insert_service_role                   INSERT  service_role  t
staff                   staff_select_service_role                   SELECT  service_role  t
staff                   staff_update_service_role                   UPDATE  service_role  t

⚪ 負對照 admin_sso_login_events 的 SELECT policy(09-09 = 0)   ⇒ 0    ✅ 尺分得出兩堆
🟢 正對照 全庫 policy 共幾條(09-09 = 103)                      ⇒ 103  ✅
🟢 其中 restrictive(09-09 = 0)                                 ⇒ 0    ✅
```
⇒ ✅ **要的 I / I / I+U 今天都在,而且【給對角色】(六條全部是 `service_role`,不是 `authenticated`)。**
📌 **「命令別齊了」與「給對角色」是兩件事** —— 一條 INSERT policy 若給的是 `authenticated`,前者會綠而後者是假的。09-09 那份特地分兩步量,今天照量。

🔵 **順帶**:板列原文寫「**3 條**」而括號裡其實列了 **4 條**(`staff` 的 I 與 U 是兩條)。**四條今天都在,所以結論不變**,而引用時不要跟著寫 3。

---

## 三、🎯 三次同型,而它們的形狀一樣、後果不同

| # | 列 | 板上留的是 | 後果 |
|---|---|---|---|
| ① | `⟦b9-ACLDRIFT5⟧` | **擋工理由**(「那一題不存在 ⇒ 不可派」) | 🔴 **沒有人會來** —— 隱形 |
| ② | `⟦db-RLSHARDENZEROROWS⟧` | **「還沒量」** | 下一個人會來,把 51 張那份清單再量一次 |
| ③ | **本列** | **「關閉條件前半還沒做」** | 下一個人會去補**已經在庫上的 policy** |

🔴 **而第三例最花時間**:①②的浪費是「查一輪」,而**這一次的浪費是【去補一個已經存在的東西】** ——
📌 **而補一條已經存在的 policy,`CREATE POLICY` 會直接報錯** ⇒ 🔵 **它會被擋住,不會造成傷害。**
🎯 **⇒ 所以三例的傷害排序是:① 隱形 > ② 白工一輪 > ③ 白工幾分鐘然後撞到錯誤訊息。**

🛑 **而三次的共同成因是同一件事:2026-09-09 那一輪的產出,有一部分沒有走回板上。**
🔴 **而那是一個【範圍問題】,不是這三列的問題** ——
⇒ 📌 **主視窗說那要端給 Sean,不是我自己去掃。我不掃。**

---

## 四、⇒ 這一列剩什麼

| 板上寫的 | 今天 |
|---|---|
| 關閉條件前半「先補 3(4)條 policy」 | ✅ **已達成**(09-09 量過,今天複量六條全在、全給對角色) |
| 「客戶列表有、每人訂單數 0」那個畫面 | ✅ **不會發生**(四張表各有 `service_role` 的 SELECT policy `USING true`) |
| 收 `BYPASSRLS` 那天真的會變的表 = **0 張** | 🛑 **那個 0 是【推的】** —— 板列自己標的,**今天仍然沒有人真的收掉跑一次** |
| Sean 那句「貼前先走後台一遍」 | 🛑 **仍未做,而沒有人代得了** |

⇒ 🎯 **所以這一列真正卡的只剩【後半】,而後半是 Sean 的決定 + 他自己走一遍。**
🛑 **我沒有寫 plan、沒有動任何權限、沒有改板。**

---

## 五、🛑 我證不到什麼

· **【證不到】收掉 `BYPASSRLS` 之後會怎樣** —— 那要 apply 授權,而 Sean 2026-09-05 拍甲「先不驗」。**板列那個 0 仍是推的。**
· **【證不到】那三條寫入 policy 的 `WITH CHECK` 真的放行** —— 我只讀了字面(都是 `true`),**沒有實際寫一列去試**(那是正式庫寫入,不做)。09-09 同樣標過。
· **【證不到】板上為什麼零命中** —— 我只證了「今天零命中」與「我 09-09 寫過」。**中間發生什麼我不知道。**
· **【證不到】09-09 那一輪還有多少產出沒走回板上** —— 🛑 **那是範圍問題,主視窗說要端給 Sean。我沒掃。**
· 只量了那三張表的 policy 與三個全庫對照。**那 4 支非 `security_invoker` 的 view 那一格,沒碰。**

---

## 六、🔗 接手用(2026-09-10 存檔)

· **隊列**:主視窗第三輪 3 列,**第②列做完**。
  ① `⟦db-RLSHARDENZEROROWS⟧` ✅ · ② **本檔** ✅ · ③ `⟦f3-SVCROLEUNVERIFIED1⟧` ⏭️ **下一列**
· 🔵 **三例的形狀已落檔**(本檔 §3)—— 而**那個範圍問題主視窗要端給 Sean,不是我掃**。
· 🔴 **我手上還沒落檔的判斷**:第③列 `⟦f3-SVCROLEUNVERIFIED1⟧` 我還沒開檔。
  ⇒ **推的**:它講「`service_role` 讀得到那兩張表只在 mock 驗過」,而我今天量過 `service_role` 對 `orders` 的八格是 `10000111`
  ⇒ 那可能是同一組受詞。🔴 **開檔前不要引用這句。**(今天四次這種推測:兩次對兩次錯。)

**正式庫零寫入。**
