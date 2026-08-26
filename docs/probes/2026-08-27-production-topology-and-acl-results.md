# 2026-08-27 · 正式庫拓撲與 ACL 探針【結果】

> **這是輸出, 不是探針。** 探針本體 = `~/pcm-mailbox/cf-拓撲探針-service_role成員與三表ACL-20260827.sql`
> (273 行, `sha256` 前 12 `8c37ced7a1f5`;說明檔同目錄 `cf-拓撲探針-說明與自檢-20260827.md`)。
>
> **誰跑的 / 何時 / 怎麼跑**:Sean 本人, 2026-08-27, Supabase SQL Editor, 純 SELECT 包 `BEGIN…ROLLBACK`。
> 🔴 **摘要非全部。** 下面每一格是**逐字抄自**他貼回的結果表, 我沒有重算、沒有改寫 ——
> **而我只抄了我要用的那幾格**(`0-2` / `1-1` / 區 2 五列 / 區 4 小計 / 區 5 / 區 6 / 區 7 小計 / 區 9 三列),
> **不是全文。完整輸出【沒有落檔】** —— 它只在 2026-08-27 那次對話裡。
> (b4 2026-08-27 複驗抓到:~~原寫「逐格抄自他貼回的結果表」~~ 讀起來像全文, 而檔內零處寫「摘要非全部」。
>  它的數法 `grep -l 170006 ~/pcm-mailbox/*` ⇒ 只命中說明檔 ⇒ **原始輸出不在 repo 也不在信箱。**)
> ⇒ 要完整輸出 ⇒ 請 Sean 用 `-v1-` 那支探針重跑, **不要拿本檔當全文。**
>
> ⚠️ **這份【不是】審查通過的意思**:cf 自陳探針本體當時還沒有被獨立審過
> (它交件時逐字:「探針本身我沒重審, 不要讀成『探針通過』」)。⇒ 值是量到的, 而**量具本身待審**。
>
> ---
>
> ✅ **2026-08-27 再追記 · v1【找回來了】, 而且 sha 是我自己量的不是轉述的。**
>
> ```
> ~/pcm-mailbox/cf-拓撲探針-service_role成員與三表ACL-v1-20260827.sql
>   實量 273 行 / sha256 前 12 = 8c37ced7a1f5   ← 與本檔檔頭那格【逐字相同】
> ~/pcm-mailbox/cf-拓撲探針-service_role成員與三表ACL-v2-20260827.sql
>   實量 317 行 / 55f5210b4071                  ← 負對照:同一把尺量它, 值不同 ⇒ 尺會動
> 量法 shasum -a 256 <檔> | cut -c1-12 ;  wc -l < <檔>
> ```
> ⇒ **下面每一格的值, 現在【可以照著重跑】了** —— 跑 `-v1-` 那支。
> ⚠️ 而無版號的那個路徑(本檔檔頭原本寫的那個)現在是 **v2 的副本** ⇒ **不要照它跑**, 它會給你不一樣的東西。
>
> 📌 而下面這一整段留著不刪 —— **它記的是「原地覆蓋會發生什麼」, 而那件事下次還會發生。**
>
> ---
>
> 🔴🔴 **2026-08-27 稍晚追記(當時的狀態)· 產出這份結果的那個量具, 在那個路徑上【已經不存在了】。**
>
> cf 後來把探針送審(code-reviewer opus fresh ⇒ FAIL 4 must-fix + 6 nit), 折完成 v2、**同檔名原地覆蓋**。
> 我當場量(`shasum -a 256 <該路徑> | cut -c1-12` / `wc -l`):
> ```
> 本檔檔頭原記(= 產出下面這些值的那一份)   273 行  8c37ced7a1f5
> cf 報 v2 時                                 304 行  1be623571b96
> 我實量現值                                  317 行  55f5210b4071   ← 第三個版本
> ```
> ⇒ **下面每一格的值仍然成立**(它們是 Sean 2026-08-27 用 v1 在正式庫親跑印出來的, 值不會因為量具改版而改變),
> **而「照檔頭那個路徑再跑一次就會得到同樣的東西」這句話【不成立】。**
> (⇒ 這一句已被上面那則「再追記」解掉:v1 找回來了, 照 `-v1-` 那個路徑跑就成立。)
>
> 📌 **形狀**:`sha256` 那一格的用途, 是讓「檔變了」成為一個**機械訊號**。
>    而它只在**舊版還找得到**的時候救得了人 —— 原地覆蓋留下了訊號、弄不見了東西
>    ⇒ 讀的人知道「不一樣」, 而**沒辦法知道哪裡不一樣**。
>
> ⚠️ v2 修的四條 must-fix 裡有一條**直接指向本檔的讀法**(cf 轉述 reviewer 的 F-B):
>    v1 的區 9 對 `email_outbox` 模擬了**片3a 才有的** `rolbypassrls` 閘, 而**片2 當時沒有那道閘**
>    ⇒ 那一列會被讀成「片2 也擋」。**下面「二、」節請照這一格重讀。**
>    (片2 已於 2026-08-27 補上該斷言 —— Sean 拍 `Q-27c = 甲` —— 所以那個誤讀現在恰好變成真的, 而**理由不同。**)
>
> ⚠️ v2 另加了一列 `0-0 表指紋`, 對應下面第一節那個「這是哪個 Supabase」的待辦。
>    cf 自陳:那個指紋用的表名(`model_dictionary`)是**從 MCP 的表名認的、沒有逐一開表核**
>    ⇒ **標未確認, 不要讀成「已經有辦法分辨了」。**

---

## 🔴 一格必須先讀:**這是哪一個 Supabase, 探針分不出來**

`current_database()` 回 `postgres` —— 而 **PCM 有兩個 Supabase 專案, 兩邊的 db 都叫這個名字**。
⇒ **「他跑在網站庫」這件事, 探針沒有印出來。**

**分得開的那一格(間接證據, 標明是推的)**:區 4 小計 = **3** ⇒ `email_outbox` / `shipments` / `shipment_items`
三張表**全部找得到**。那是網站庫的形狀;報價單庫沒有這三張。
⇒ 證據夠強, **而它是推出來的, 不是印出來的**。要印出來 ⇒ 下一版探針加 `current_setting('app.settings.project_ref')`
或直接回 `inet_server_addr()` / 專案 ref。**已記成探針的下一版待辦。**

---

## 一、關掉的四個「未確認」(這一節是本檔的主要價值)

| 之前的狀態 | 現在 | 出處 |
|---|---|---|
| 線上 PG 版本 —— 我 2026-08-27 只有 repo 內三處**紀錄**(17.6), 標「讀來的」 | ✅ **`server_version_num` = `170006`(17.6)** 親測 | 區 0 格 0-2 |
| `service_role` 的 `rolinherit` —— 上一班標「**全 repo 查無字面**」, 而它決定片3a 並排表一半的答案 | ✅ **`rolinherit = true`** | 區 1 格 1-1 |
| `shipments` / `shipment_items` 的 GRANT 面是不是真的只有 SELECT | ✅ **只有 `SELECT`**(`grantee=service_role priv=SELECT grantor=postgres grant_option=false`) ⇒ 片3a 檔頭那句成立 | 區 5 |
| 三張表的 RLS 開著沒 / owner 是誰 / 有沒有欄級授權 | ✅ `relrowsecurity=true` · `owner=postgres`(**不是 service_role**)· `relforcerowsecurity=false` · **欄級 ACL 0 項** | 區 4 / 區 6 |

⇒ 連帶:片3a 的 **⑦0(owner)· ⑦a(grant option 全 false)· ⑦b(shipments 兩張只有 SELECT)· ⑦c(RLS 開著)四格在正式庫全過。**
⇒ 段A 的**版本閘**(`170006 ≥ 160000`)、**正對照**(`pg_auth_members` 2 vs 2)、**負對照**(34 個角色裡 3 個是成員, 3 < 34)也全過。

---

## 二、🔴 擋住的那一格 —— 而它比先前模擬的更寬

> ⚠️ **~~原標題寫「唯一擋住的那一格」~~ —— 那個「唯一」的分母比我講出來的小。**
> b4 2026-08-27 複驗:我當時說「區 0/1/4/5/6/7 逐列看過沒有其他紅」,而**分母漏了區 2 與區 3**。
> 補上:**區 2 有三列是 🟡**(那三個 SET-only 角色;v1 對它們印 🟡 不是 🔴);**區 3 小計 = 0**。
> ⇒ 正確講法是「**沒有其他 🔴, 而區 2 有三列 🟡**」。
> 📌 **我報「沒有其他紅」的時候, 心裡的分母比我列出來的那串區號小 —— 而那串區號看起來就是分母。**

段A 的 `v_extra` 枚舉在**三張表**都非空, 內容相同:

```
[authenticator (USAGE=false SET=true),
 cli_login_postgres (USAGE=false SET=true),
 supabase_storage_admin (USAGE=false SET=true)]
```

⇒ **片2(`20260826150000`)與片3a(`20260826160000`)在正式庫都會被自己的段A 擋下。已證實。**

📌 **先前我在本機只模擬出 `authenticator` 一個** —— 正式庫是 **三個**。
   **「我造得出來的那個世界」與「它真正要跑的那個世界」不是同一個, 而前者看起來已經夠像了。**

### 三個都是同一種形狀:`USAGE=false` + `SET=true`
| 角色 | 直接成員? | 屬性 | grant 細節 |
|---|---|---|---|
| `authenticator` | 是 | `rolinherit=false rolbypassrls=false rolsuper=false rolcanlogin=true` | `inherit_option=false set_option=true admin_option=false grantor=supabase_admin` |
| `cli_login_postgres` | 否(間接) | `rolinherit=false rolbypassrls=false rolsuper=false rolcanlogin=true` | 間接 |
| `supabase_storage_admin` | 否(間接) | `rolinherit=false rolbypassrls=false rolsuper=false rolcanlogin=true` | 間接 |

被段A **正確排除**的兩個:`postgres`(`rolbypassrls=true`)· `supabase_admin`(`rolsuper=true`)——
它們本來就看得到, 排除是對的。

### 🔴 而錯誤訊息把這三個分類成「其餘 = 真的多一個看得到的人」—— 那個分類是**錯的**
`USAGE=false` ⇒ 它們**不繼承** service_role 的權限, **必須明確 `SET ROLE` 才變成 service_role**。
而一個能 `SET ROLE` 過去的角色, **今天就已經**能做 service_role 能做的每一件事(切過去之後它就是本人)。
⇒ 本片的政策**一條都沒有多給它們**。**擋它們是誤擋, 不是保守。**

⚠️ 三個都是 Supabase **平台自己的**角色(PostgREST 入口 / CLI 登入 / 儲存服務)⇒ 它們**永遠都會在**
⇒ **只要閘還對 `SET`-only 報警, 這兩支檔【永遠】apply 不進去**, 不是今天不行。

**處置待 Sean 拍板**(2026-08-27 已端出, 本檔寫成時未回):
- 甲 = 把 `SET` 從判準拿掉, 閘只看 `USAGE`
- 乙 = 仍然把 `SET`-only 撈出來**印在畫面上**, 但**不擋**;只有 `USAGE` 才擋(不用白名單 ⇒ 不會過期)
- 🔴 **拍板前兩支都不要 apply, 也不要為了讓它綠而動判準。**

---

## 三、順手量到而先前沒人問的一格

`email_outbox` 的 `service_role` 表級權限是 **`SELECT` + `INSERT` + `UPDATE`**(區 5)。
⇒ 那與片2 補三條政策(SELECT/INSERT/UPDATE)**對得起來**, 不是問題。
⚠️ **而它與片3a 的 ⑦b 判準不相容** —— ⑦b 要求「表級全集扣掉 SELECT 都不存在」。
   ⇒ **⑦b 這個形狀只適用於 SELECT-only 的表(shipments 兩張), 不能原樣搬去 email_outbox。**
   📌 記下來:**那 42 張裡, 每張的 GRANT 面不一樣 ⇒ 斷言不能整批複製。**

`政策數` 區 7 小計 = **0** ⇒ 三張表 apply 前零政策, 與兩片的前提一致。

---

## 四、這份【沒有】回答什麼

- 這是哪一個 Supabase —— 見檔頭第一節(間接證據夠, 而沒有印出來)
- 那 42 張裡的其他 39 張 —— 本探針只問三張
- 政策的 `USING` 內容 —— 三張表現在零政策, 沒得問
- Edge Function / 外部服務有沒有直打 —— 只有儀表板答得出來(cf 2026-08-27 另案標「分不開」)
- 探針本體對不對 —— **待審**(見檔頭)
