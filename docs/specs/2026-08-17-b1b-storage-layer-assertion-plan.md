# B1-b 第三道斷言 · 改走【儲存層白名單三層制】設計 plan(丙案)

- 日期:2026-08-17(`date` 實跑;交叉源 `git log -1 --format=%ad`)
- 作者:B 窗(真登入線 E8-B)　狀態:**設計,尚未寫 code**
- 由來:V 窗 R3 `~/pcm-mailbox/V-024-STOP.md`(換模型換角度打框架)→ 主視窗裁定**丙**
- ⛔ **本檔不含 code。** 主視窗硬要求:先出設計、經 V 窗複驗,才動 code
  (理由:先寫進 code 再改,diff 會長得像「我想清楚了才寫」,而**那個差別下一個人看不到**)

---

> ## 🔴🔴 引用前必讀:三方看過的是【論證】,不是【數字】
>
> 本線出現的 `32 格`、`30/1`、`31/1` 等突變數字,**目前是 B 窗單方面的量測**:
> codex R1/R2 自標「唯讀環境建不了叢集,未重新採信」;V 窗 R3 明說「不進 B 的樹撞叢集」。
> ⇒ **寫成「經 codex 兩輪 + V 窗 R3」時,讀的人會以為數字也被驗過了。沒有。**
> 要用請自己重跑:`sh scripts/run-rc.sh 25 -- bash scripts/b1b-acceptance-harness.sh`

---

## §1 這道斷言【是什麼、不是什麼】—— 檔頭定位(丙案多出來的那一半)

**這五條要逐字寫進 migration 檔頭。缺一條就等於沒寫。**

| # | 內容 |
|---|---|
| ① **它是什麼** | **apply-time sanity check** —— 隨 migration 跑的一次性快照 |
| ② **它不是什麼** | **不是持續守門。** apply 之後的誤授,它**結構性看不到** |
| ③ **為什麼看不到** | `GRANT <role> TO <role>` targets shared object ⇒ event trigger 官方**不觸發**(<https://www.postgresql.org/docs/17/event-trigger-definition.html>);`pg_cron` 已裁不建(`#554`) |
| ④ **那個缺口誰負責** | **`#554`**,不是這道斷言 |
| ⑤ 🔴 **給下一個人的一句** | **想為它加任何東西之前,先問:「我要擋的那件事,發生在 apply 之前還是之後?」** |

🔴 **⑤ 用「加任何東西」而不是主視窗原句的「加臂」** —— 丙落地之後**沒有「臂」這個詞了**,
下一個人要加的東西會叫別的名字。**規則綁在舊框架的詞彙上,換框架就自動失效。**
📎 實例就在本線:我寫過「四臂由行為格守」,拆掉 A14 之後**那句話還在**,而它已經不成立。

## §2 為什麼換(病根一句)

**「查的集合比世界窄」在這條線出現三次**(表級 → 欄級 → 欄位枚舉),R2 又添 `MAINTAIN` 與
`WITH GRANT OPTION` **兩個新成員**。
⇒ **只要用 `has_*()` 逐權限型別枚舉,這個債就永遠長。**

🔴 **決定性的證據(V 窗拋棄式 PG 17.10 實測 S0–S3)**:
| 狀態 | 實測 |
|---|---|
| S0 新表 | `pg_attribute.attacl` 非空欄數 = **0** |
| S1 `grant update (a)` + 表級 MAINTAIN | attacl 非空**恰 1 欄**;**表級授權不污染 attacl** |
| S2 revoke 欄級 | 歸 **0**、無空陣列殘留 ⇒ **零誤報** |
| S3 `grant references … with grant option` | `relacl` 逐字 `r1=x*/postgres`、MAINTAIN 顯示 `m` |

⇒ **`WITH GRANT OPTION`(`*`)與 `MAINTAIN`(`m`)在儲存層免費看到** ——
**而那正是我昨夜花一整段時間補進清單的兩樣東西。**

## §3 三層設計(各司其職,射程 = 儲存位置)

### 第 1 層 · 儲存層白名單(主力,免枚舉)
- **`relacl`**:現行 `v_extra` 已是 **grantee 級**;**升級為 aclitem 級** ⇒ 連 `*`(grant option)與 `m`(MAINTAIN)一起看到
- **`attacl` sweep**:**非空即紅,並印出來** ⇒ 覆蓋 **所有欄 × 所有權限型別(含未來 PG 新增)× 所有角色**,一道查詢
- 🔴 **射程明確**:relacl = 表級 / attacl = 欄級。**不用腦記,看儲存位置就知道。**

### 第 2 層 · 函數層(只留一道,**不可退役**)
- **predefined roles**(`pg_write_all_data` 族)的**隱含權限不進 `relacl`/`attacl`**
- V 窗實測:`grant pg_write_all_data to r3` ⇒ `has_table_privilege('r3','t','UPDATE')` = **t**,
  而 `relacl` = **NULL**、attacl 非空欄 = **0** ⇒ **儲存層對隱含權限全盲**
- ⚠️🔴 **不要因為「儲存層更完整」就把函數層整個拆掉** —— 那會長出新的靜默失敗面

### 第 3 層 · trigger(已有,不動)
- `no_rebind` / `no_delete` / `no_truncate` **常駐擋行為**,與誰持有什麼授權無關

## §4 R2 八條對照表(**初稿,待 V 窗代跑覆核**)

⚠️ **主視窗已批准 V 窗代跑這張表。下面是我的初判,不是結論。**
⚠️ **moot 不是自動銷** —— 每一條都要在新結構下**指出它由誰接手**,指不出來的一律標「仍活」。

| R2 # | 一句 | 初判 | 由誰接手 |
|---|---|---|---|
| 1 | A13c/A13d 世界漂表級 ⇒ A13b 照綠 | **變形** | 世界構造的前提斷言仍要,但守的東西改為「attacl 非空」 |
| 2 | A13b 缺 `pg_has_role(…,'SET')=t` 前提 | **已折** | 已補並實測會叫(拿掉 membership ⇒ 紅在前提②) |
| 3 | A15 只守 service_role 那份清單 | **moot** | 清單本身消失 ⇒ 第 1 層免枚舉 |
| 4 | `pg_maintain` SET-only ⇒ 無 relacl、可達段漏查 MAINTAIN/TRIGGER | **仍活** | 🔴 **第 2 層** —— 這正是函數層不可退役的那一道 |
| 5 | DELETE/TRUNCATE 可用 **owner 法**構造 | **變形** | owner 在 `v_extra` 射程外 ⇒ 新設計要明寫 owner 的處置 |
| 6 | `authenticated` 只有欄級 INSERT/UPDATE/REFERENCES ⇒ 放行 | **moot** | 第 1 層 attacl sweep(非空即紅) |
| 7 | 不可切換 outsider 的**欄級**權限,A16 表級世界抓不到 | **moot** | 同上 |
| 8 | `WITH GRANT OPTION` ⇒ 八項有效權限仍符合而已能轉授 | **moot** | 第 1 層 aclitem 級直讀(`*` 免費可見) |

**nit 四條**:`b1b:318`(函式迴圈只查 anon/authenticated)**仍活**;
`b1b:63`(版本斷言訊息不準)**仍活,便宜**;`b1b:358`(註解寫「七種權限」)**moot**(清單消失);
`harness:56`(未 fail-fast 擋 PG16)**仍活**。

## §5 驗收設計(要能被單獨打紅,否則不算)

每一格照本線既有紀律:**世界 + 負測 + 前提斷言**,且**突變只紅它自己**。
- attacl sweep → 突變:授一個欄級權限 ⇒ 必紅;撤掉 ⇒ 必綠(S2 已證零誤報)
- relacl aclitem 級 → 突變:加 `WITH GRANT OPTION` ⇒ 必紅(舊查法看不到,可做**新舊對照**)
- 第 2 層 predefined role → 突變:`grant pg_write_all_data` ⇒ 必紅,**而第 1 層對它必綠**
  🔴 **這一對是「兩層各自不可替代」的證據**,不是重複
- **owner 法**(R2 #5)→ 新設計必須答:owner 是不是白名單的一部分?答不出來就不能收工

## §6 誠實邊界

- S0–S3 與 predefined-role 實測都是 **generic PG 17.10 樁**,**Supabase 端未實跑 = 未確認**。
- **本 plan 尚未經任何對抗審查**(下一步就是交 V 窗)。
- 時程:走丙**淨延後估 2–3 小時**(⚠️ **估,非量**;依據是今晚同型工作的回想,我沒有精確工時紀錄)。
- 🔴 **`MAINTAIN` 擋板在丙落地之前仍然有效** —— 不因為「反正要重構」就先拿掉,那會有一個空窗。
- **甲乙丙都不解 §1② 的時間缺口。** 唯一解仍是 `#554`。**這一句不准在任何版本裡被刪掉。**
