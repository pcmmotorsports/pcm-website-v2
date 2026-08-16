# 環境值 → 誰站在它上面(「這個值錯了會塌掉幾件事」的可查版)

> **來源**:V 窗 `~/pcm-mailbox/V-027-環境值依賴表.md`(2026-08-17 10:3x)。
> **V 窗是唯讀窗、不落 repo 檔** ⇒ 主視窗裁由 I 窗落檔。**內容一字未改,只重排順序並加本檔頭。**
>
> ## 🔴 這張表【自己就是狀態性資訊】
>
> **每一列的效期只到它「量測時點」那一格為止。**
> ⚠️ **不要因為它進了 repo 就以為它比信箱版新** —— 它會用完全一樣的方式過期,差別只在**這裡有人會回來改**。
>
> 📎 **而「時點」那一欄就是它自己的過期指標**:「量的」四列裡**三列在 48 小時內**、
> `statement_timeout` 是 **8 天前** ⇒ **列了時點,就自帶「該不該重量」的答案。**
> **這正是這張表比散落在各處的註解強的地方。**
>
> ## 📎 它與 `STATUS.md` 那條常設規矩是同一條線的兩端
>
> `STATUS.md` 附屬區「🧭 世界狀態句附量法」:**每一句描述現況的話,旁邊附一條可重跑的量法**。
> **本檔**:把**被很多句話共用的那幾個值**集中起來,免得同一個值在十個地方各附一次量法、而它們會各自過期。
>
> ## ⚠️ 兩條落檔紀律(V 窗立,不要在引用時拿掉)
>
> 1. **「讀來的」不升級成「量的」** —— 表裡標了哪一列是哪一種,**那個標記是結論的一部分**。
> 2. **量不到的寫「量不到」+ 缺哪一道檢查**,不留空白。

---

## 🔴🔴 第一列:**`db-max-rows` 不是一個值,是一個「dashboard 上點一下就能改」的專案設定**

> **它不是這張表的一列,它是這張表的【地基】。**
> V 窗原表把它排在第三列 —— **落檔時提到最前面,免得它被排在中段然後沒有人讀到。**

| | |
|---|---|
| **記載數** | —(它是設定,不是值) |
| **量的還是讀來的** | 讀來的(`order-notes.ts:28` 自文件化「程式裡釘不住它」) |
| **量法** | Supabase dashboard → API settings **親看** |
| **範圍** | 平台設定 |
| **誰站在它上面** | 🔴 **下面 `db-max-rows` 那兩列的【一切】** |

🔴 **為什麼它是地基**:值被調低時 ——

```
所有 `rows.length >= LIMIT` 的截斷旗標    恆 false
fetchAllPaginated 的 PAGE_SIZE 餘裕      歸零
⇒ 而這一切【零機械訊號】：沒有測試會紅、沒有 grep 數會變
```

⚠️ **目前沒有任何守門在監控它的現值。**
⇒ **今晚幾乎每一條與截斷有關的 finding 都站在它上面,而它可以被一次點擊同時作廢。**

---

## 其餘各列(順序照 V 窗原表)

| 值／平台行為 | 記載數 | 量的還是讀來的 | 量法(可重跑) | 範圍標籤 | 誰站在它上面 |
|---|---|---|---|---|---|
| PostgREST `db-max-rows`(**頂層**) | 1000 | **量的**(A 窗) | anon 對 production 任一表不帶 Range 拉一次、數回列 | production／anon／頂層／2026-08-17 凌晨 | `fetchAllPaginated` PAGE_SIZE==1000 零餘裕;F-S3 手刻迴圈;所有 `rows.length >= LIMIT` 截斷旗標的有效性 |
| `db-max-rows` **對內嵌資源** | 「也套用」 | 🔴 **讀來的**(issue #2776 作者敘述;**官方文件沒寫**,C 窗查證) | 要量得構造一張內嵌 >1000 列的單(A 窗自陳:無可寫正式庫的環境,**量不到**)⇒ 缺的檢查=正式庫構造測試單或 staging | **未確認** | embed-truncation 整條線的前提;Q2=甲 的觸發面;itemCount／貨品軸 `.every()` 誤判情境 |
| `statement_timeout` | anon=3s／authenticated·authenticator=8s／service_role=300s | **量的**(08-09 實量,落 `20260809180000` 檔頭;⚠️ repo 註解曾寫錯一次,08-11 更正在 memory `reference_supabase-anon-rpc-verify-generic-plan-timeout`) | 各角色連線跑 `show statement_timeout` | production／各角色／**2026-08-09**(⚠️ 全表最舊的一列) | 車型 view「最終不修」裁定(3047ms>3s);anon RPC 效能驗證方法論;翻頁保留搜尋詞那片 |
| vitest 測試環境 TZ | `Asia/Taipei` 釘死 | **量的**(`vitest.config.ts:64` 逐字＋C 窗 §8.1 探針證明 naive/fixed 在此 TZ 下 960 個整點零差異) | `grep -n "TZ" vitest.config.ts` | repo／CI／測試環境 | **所有時區類守門的判別力**;F-D1 五份 `Asia/Taipei` 複本的測試各自全盲;出貨日那格的假綠機制 |
| pcm-admin 的 production 分支 | `dev` | 讀來的(memory `project_pcm-admin-production-tracks-dev`,多輪引用;**未見有人本輪親看 dashboard**) | Vercel dashboard → pcm-admin → production branch 親看 | 平台設定 | 「push 即上線」全部紀律;「CI 是事後警報」那條 Blocker;收割窗不推的份量 |
| Vercel 方案 | Hobby | 讀來的(memory reference,07-25 實查;**已隔 3 週**) | dashboard 親看 | 平台帳務 | 排程設計禁綁 Vercel cron;部署額度打滿事故的復發條件 |
| GoTrue 設定(Q-AUTH-1 前提③) | 截圖為證 | 🔴 **讀圖的**(B-554 §6:**SQL 原理上查不到**,住 GoTrue config 不在 DB) | 量不到(DB 內無)⇒ 缺的檢查=Supabase Auth dashboard 親看或 Auth admin API | Supabase Auth／截圖時點 | 真登入線甲案前提③ —— B 窗自標「證據是截圖不是機器輸出」 |
| 報價單庫「108 放大倍數」 | 108 | 讀來的(E 窗自標;🔴 **本列是主視窗轉述,V 窗無第一手**) | 出處與量法在 E 窗檔,本表只登記它的證據等級 | 報價單庫 | `#553`／E-694 相關判讀 —— **引用前先去 E 窗檔核出處** |
| PG 版本(正式庫) | 17.6(拋棄式 17.10,同 major) | 讀來的(B-554 引;**本輪未重查**) | `select version()` 唯讀帳號 | production／08-16 | event trigger shared-object 結論的適用性;MAINTAIN 權限存在性;丙案 acldefault 推導集的內容 |

---

## ⚠️ 引用本表時的三個限定

1. **`108` 那一列標著「主視窗轉述、V 窗無第一手」** —— **落檔時沒有拿掉那個限定,引用時也不要拿掉。**
2. **「讀來的」那六列都沒有本輪的第一手量測** —— 其中 `pcm-admin production 分支` 與 `Vercel 方案`
   是**平台 dashboard 的東西,repo 內原理上查不到** ⇒ 要驗只能有人去點開。
3. **`statement_timeout` 是全表最舊的一列(8 天前)** ⇒ **它最該被重量,而那正是「時點」欄的用途。**
