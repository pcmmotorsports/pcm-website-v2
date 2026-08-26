# 2026-08-27 · 正式庫拓撲與 ACL 探針【結果】

> **這是輸出, 不是探針。** 探針本體 = `~/pcm-mailbox/cf-拓撲探針-service_role成員與三表ACL-20260827.sql`
> (273 行, `sha256` 前 12 `8c37ced7a1f5`;說明檔同目錄 `cf-拓撲探針-說明與自檢-20260827.md`)。
>
> **誰跑的 / 何時 / 怎麼跑**:Sean 本人, 2026-08-27, Supabase SQL Editor, 純 SELECT 包 `BEGIN…ROLLBACK`。
> 下面每一格**逐格抄自他貼回的結果表**, 我沒有重算、沒有改寫。
>
> ⚠️ **這份【不是】審查通過的意思**:cf 自陳探針本體當時還沒有被獨立審過
> (它交件時逐字:「探針本身我沒重審, 不要讀成『探針通過』」)。⇒ 值是量到的, 而**量具本身待審**。

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

## 二、🔴 唯一擋住的那一格 —— 而它比先前模擬的更寬

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
