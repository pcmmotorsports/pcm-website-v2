# 2026-09-10 `⟦f3-ADPNARROWER1⟧` —— 三格今天還開著,而**那 6 支沒有變成 11 支**

> 板列的核心:那道被當成「根治」的 `ALTER DEFAULT PRIVILEGES` 射程比報的窄。
> 而板列自己說過一句**要求重跑**的話:**「204 是 2026-09-07 的讀數。這個數會長,引用前重跑。」**
> **這一份就是那次重跑,加上三格開著的複量。**

來源標籤:**【量的】**(命令 + 讀數,尺先證明會咬)/ **【推的】** / **【證不到】**

---

## 〇、🔴 先更正我自己 —— 我開檔前那句推測是錯的

我在上一份查證檔(`…grantgateblind…` §7)標了一句「**開檔前不要引用**」的推測:
> **推的**:我第五列量到 `pg_default_acl` 含 `pcm_readonly = 0`,那可能就是這一列的下半場。

🔴 **開檔之後:那句是錯的,而且錯在【受詞】。**
· 這一列講的是**「用 ADP 去【收】預設權限,而收的射程太窄」**。
· 我第五列量到的是**「一個【發】權限給 `pcm_readonly` 的 ADP 消失了」**。
⇒ 📌 **一個是收得不夠,一個是發的那條路斷了。兩件事。**

✅ **而那句話沒有害到任何人,因為它旁邊寫著「開檔前不要引用」。**
🎯 **⇒ 「這是推的」說不出什麼時候可以用它;「開檔前不要引用」說得出來。**

---

## 一、【量的】三格今天全部還開著

2026-09-10 唯讀查正式庫(零寫入)。板上 2026-09-08 `-auth` 那一發的三格:

```
① storage 的 ADP(板上:三個角色全開, 完全沒收)
   r  postgres=arwdDxtm, anon=arwdDxtm, authenticated=arwdDxtm, service_role=arwdDxtm
   f  postgres=X,        anon=X,        authenticated=X,        service_role=X
   S  postgres=rwU,      anon=rwU,      authenticated=rwU,      service_role=rwU
   ⇒ 🔴 一格都沒動

② public/SEQUENCES(板上:service_role=w 還在)
   postgres=rwU,anon=rwU,authenticated=rwU,service_role=rwU   /supabase_admin
   postgres=rwU,service_role=w                                /postgres
   ⇒ 🔴 service_role=w 還在

③ public/TABLES(板上:今天乾淨)
   postgres=arwdDxtm,anon=arwdDxtm,authenticated=arwdDxtm,service_role=arwdDxtm  /supabase_admin
   postgres=arwdDxtm                                                             /postgres
   ⇒ 🟡 見下

④ pg_default_acl 總列數(板上 27)  ⇒ 27      不變
```

### 🛑 而 ③ 那一格的字面要小心 —— 板上寫「今天乾淨」而那只講了一半

板上逐字:`🟡 public/r 今天乾淨 {postgres=arwdDxtm}`。
【量的】今天 `public/TABLES` 有**兩列**:`postgres` 那列確實只剩它自己,**而 `supabase_admin` 那列對三個角色全開**。

🔵 **板列並沒有寫錯** —— 它在上面另一格就寫了「`supabase_admin` + `public` 的預設是【全開】」。
🔴 **而「public/r 今天乾淨」這七個字被單獨引用時,會讀成兩列都乾淨。**
⇒ 📌 **那正是這一列自己抓到自己的那個病**:一個讀起來很硬的結論,**旁邊的限定不會跟著被複製走**。

---

## 二、【量的】`ON FUNCTIONS` 那一格今天仍然是空的

掃 `supabase/migrations/*.sql`,**剝掉整行註解**:
```
ALTER DEFAULT PRIVILEGES 非註解行命中      12 行
🔴 其中帶 ON FUNCTIONS 的                    0 行
🟢 正對照 帶 ON TABLES 的                    5 行  ⇒ 尺會咬
```
🔵 那 12 行裡有 6 行是 `RAISE` 訊息或 `format(...)` 字串(板列自己記過「我的尺只剝 `--` 註解,剝不掉字串字面 ⇒ 那個數是**上界**」)。
⇒ ✅ **板列那句「射程仍缺 `ON FUNCTIONS`」今天仍然成立。**

---

## 三、🎯 那 6 支函式 —— **還是 6 支,沒有變成 11 支**

板列 2026-09-08 點名 6 支:線上對三個角色都有 `EXECUTE`,而 **repo 裡零 `GRANT` 零 `REVOKE`**。

【量的】今天:**六支 × 三個角色,6/6 全部仍是 3。** 一支都沒被收掉。

### 🛑 而我差點把一個「另一把尺」的數字報成「問題長大了」

我先問的是「**三個角色全部都有 `EXECUTE` 的 public 函式有幾支**」⇒ **11 支**。
🔴 **而板上是 6 支** ⇒ 我當下的直覺是「多了 5 支,問題在長大」。

【量的】**去查那 5 支之前先停了** —— 多出來的是:
```
search_products_by_vehicle · catalog_brand_counts
search_catalog_by_vehicle(兩個多載)· storefront_search_product_ids
```
⇒ 這些是**顧客站以 `anon` 呼叫的搜尋/目錄 RPC** ⇒ **它們本來就該給 `anon`。**

【量的】用**板上那把尺**(repo 裡零 `GRANT` 零 `REVOKE`)逐支查:
```
set_updated_at                     🔴 零 GRANT 零 REVOKE     ← 板上 6 支
m3_jsonb_values_all_string         🔴 零 GRANT 零 REVOKE     ← 板上 6 支
sync_product_fitments              🔴 零 GRANT 零 REVOKE     ← 板上 6 支
prl_append_only_guard              🔴 零 GRANT 零 REVOKE     ← 板上 6 支
prl_no_cycle_guard                 🔴 零 GRANT 零 REVOKE     ← 板上 6 支
prl_one_effective_terminal_guard   🔴 零 GRANT 零 REVOKE     ← 板上 6 支
search_products_by_vehicle         ✅ GRANT 2 · REVOKE 2
catalog_brand_counts               ✅ GRANT 1 · REVOKE 1
search_catalog_by_vehicle          ✅ GRANT 9 · REVOKE 9
storefront_search_product_ids      ✅ GRANT 4 · REVOKE 3
```
⇒ ✅ **板上那 6 支今天還是那 6 支。問題【沒有】長大。**
⇒ 📌 **而我的 11 與板上的 6 是【兩個不同的問題】**:
· 板上問的是「**沒有人管它**」(零 GRANT 零 REVOKE ⇒ 出生自帶,沒被收過)
· 我問的是「**誰有權**」(三個角色都有 ⇒ 其中大部分是**刻意給的**)

🎯 **兩把尺印出來的都是一串函式名,而它們回答的不是同一題。**
🛑 **我停下來查那 5 支,不是因為我更小心 —— 是因為那五個名字裡有 `search` 與 `catalog`,而我今天讀過窗 A 那條線。**
⇒ 📌 **如果那五支的名字沒有意義,我會把 6 報成 11。**

---

## 四、【量的】那個「會長的數字」重跑了

板列自己要求的:**「204 是 2026-09-07 的讀數。這個數會長,引用前重跑。」**
```
public 底下函式    09-07 = 204   ·   09-08 = 206   ·   🔴 09-10 = 212
🟢 正對照 pg_catalog 函式  板上 3,319  ·  今天 3,319  ⇒ 逐字對上, 尺是穩的
```
⇒ ✅ **兩天多 6 支。板列那句預言成立,而它自己也預告了會這樣。**
🎯 **而 `pg_catalog` 逐字對上這件事本身有用** —— 它證明**變的是我們的東西,不是尺或版本**。

---

## 五、⇒ 這一列的狀態

| 板上寫的 | 今天 |
|---|---|
| 射程仍缺 `ON FUNCTIONS` | ✅ **仍成立**(版控 0 行,正對照 `ON TABLES` 5 行) |
| storage 的 ADP 線上完全沒收 | ✅ **仍成立**,一格沒動 |
| `public/SEQUENCES` 的 `service_role=w` 還在 | ✅ **仍成立** |
| 「`public/r` 今天乾淨」 | 🟡 **只對 `postgres` 那一列成立**;`supabase_admin` 那列仍對三個角色全開 |
| 6 支零管理的函式 | ✅ **仍是 6 支,6/6 仍是 3 個角色** |
| 「204 這個數會長」 | ✅ **成立** ⇒ 今天 **212** |

⇒ 🛑 **我沒有寫 plan、沒有動任何 `GRANT`/`REVOKE`/ADP、沒有改板。**
🔵 **要動它就是 migration ⇒ 鐵則 8 + 12 ⇒ 要 plan + codex + Sean。而板上這一列今天沒有被派成「去修」,是「去查」。**

---

## 六、🛑 我證不到什麼

· **【證不到】那三支補上的 migration(`20260905120000` / `350000` / `430000`)貼了沒** —— 板列自己標過同一格:平台那張表 `supabase_migrations.schema_migrations` **打不開**(`permission denied`)。
  ⇒ 我問的是**效果層**:它答得出「**效果不在**」,答不出「**是沒貼**還是**貼了沒生效**」。
· **【證不到】那 6 支是不是真的「從來沒被收過」** —— 我只證了 **repo 裡沒有**,而 dashboard / SQL Editor 那條路量不到。
· **【證不到】`graphql` / `graphql_public` 那 6 列是不是問題** —— 板列刻意不為它開新列,理由我認同,**我也不判**。
· **我的 repo 側尺只剝整行註解**,剝不掉字串字面 ⇒ **12 那個數是上界**(板列原話,今天仍適用)。
· **只看了 `pg_default_acl` 與函式層 `EXECUTE`。** 現有物件的 ACL、序列的實際權限,**沒做**。

---

## 七、🔗 接手用(2026-09-10 存檔)

### 我在哪一步
· **隊列**:主視窗第二輪 5 列,**第③列做完**。
  ① `⟦auth-HALFREVOKEDTRIGGERS⟧` ✅ · ② `⟦auth-GRANTGATEBLIND⟧` ✅ · ③ **本檔** ✅
  ④ `⟦b9-ACLDRIFT5⟧` ⏭️ **下一列** · ⑤ `⟦5b-AUDITGRANTEXPIRY⟧`
· **之後**:板子標記(憑據在 `docs/handoff/CURRENT.md`;🔴 **標之前先 `git fetch origin dev` 看那一列有沒有人標過** —— 我跟窗 A/D 撞過一次,主視窗解的;**撞了回報,不要自己選一邊**)。

### 🔴 我手上還沒落檔的判斷
· **④ `⟦b9-ACLDRIFT5⟧` 我還沒開檔。** 而我今天在 `NETPUBLICALL` 與本列都碰過那個偵測器:
  本列量到它的射程是**寫死在 `WHERE` 裡**的(`20260905140000:149-155` 只含 `storage` / `public` / NULL)。
  ⇒ **推的**:第④列講「dashboard 手動改權限沒人守」,而**那個 `WHERE` 可能就是它的一半**。
  🔴 **開檔前不要引用這句** —— 我上一次同樣形狀的推測(§0)**是錯的**。
· **那個「兩把尺回答不同的題」**(§3)是今天第二次同型(第一次是 `SRVMIN` 的「掃得到 ≠ 一定要留」)。**已落檔,不在 context 裡。**

**正式庫零寫入。**
