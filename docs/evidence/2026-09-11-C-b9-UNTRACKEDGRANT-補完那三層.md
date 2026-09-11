# ⟦b9-UNTRACKEDGRANT⟧ 複量 + **補完 09-10 自標「都沒做」的那三層** · 2026-09-11 · 窗 C

> 🟢 唯讀零寫入 · `pcm_readonly` @ 正式庫 · rc=0 · 真錯誤 0 格 · `2026-09-11 01:44:07 UTC`
> 🔵 **先讀 09-10 那一份再開工,沒有重跑它已經做完的** ——
> `docs/evidence/2026-09-10-untracked-grant-那格沒人做過的差集.md`。
> 本份做的是**它 §5 自標「都沒做」的那三格**。

---

## 一、複量 09-10 那幾格 ⇒ **逐格仍成立**

```
cron nspacl        supabase_admin=USAGE,CREATE · postgres=USAGE · 🔴 pcm_readonly=USAGE
                   ⇒ ✅ 「postgres 明確授給它的」仍成立(不是 PUBLIC)
pcm_readonly       rolbypassrls = true · rolconfig = default_transaction_read_only=on   ✅ 仍成立
表層相異表         pcm_readonly 72 · service_role 90 ⇒ ✅ 與 09-10 逐格相同
⚪ 負對照          現造角色 shdepend ⇒ 0 · pg_roles ⇒ 0
```

**🔴 而那個數字又長了(今晚第三列撞到同一件事)**
```
pcm_readonly 的 pg_shdepend  09-08 = 82 · 09-10 = 86 · 2026-09-11 = 86     ⇒ 這次沒動
🟢 正對照 postgres           09-08 = 517 · 09-10 = 527 · 2026-09-11 = 533  ⇒ 🔴 又 +6
```
📌 **⇒ 正對照那一側在動,而被觀察的那一側沒動 —— 這正好證明那把尺不是恆定的,
　 而 `pcm_readonly` 這三天真的沒有被加東西。** 兩個訊息要分開讀。

---

## 二、🔴 補完那三層 —— 09-10 §5 逐字標「都沒做」的

### 2-1 `payment_confirmer` 的表層 ⇒ **乾淨,1 = 1**
```
正式庫:相異表 1 張 ⇒ pcm_acl_drift_status
版控  :20260906970000_m4b_anomaly_reader_grants_payment_confirmer.sql:85
        `GRANT SELECT ON public.pcm_acl_drift_status TO payment_confirmer;`
⇒ ✅ 差集 0
```
⚠️ 09-10 那份寫「`payment_confirmer` 的表層 **45 條**」—— 🔴 **那個 45 是 ACL 條目數,不是相異表數。**
　 📌 **相異表只有 1 張。**(而 45 是它的**函式**數 —— 見下。兩個數字剛好一樣,而受詞不同。)

### 2-2 🔴 `payment_confirmer` 的函式層 ⇒ **乾淨,45 = 45,而且是【集合比對】不是相減**
```
正式庫 EXECUTE 相異函式        45
版控   GRANT … TO payment_confirmer 點名的相異函式  45
① 兩邊都有            45
② 版控有而正式庫沒有   0
③ 🔴 正式庫有而版控沒點名  0
🟢 正對照 prod 總數必須 45 ⇒ 45
```
🛑 **我刻意做集合比對而不是 `45 − 45 = 0`** —— 09-10 那一份就是在這裡踩到的:
> ⛔ ~~72 − 12 = 60~~ 🔴 **那個減法是錯的,而它看起來完全正常。** 真正的答案是 **63**。
📌 **一個算出來的數,與一個量出來的數,印同一個字。**

### 2-3 🔴 `pcm_readonly` 的函式層 ⇒ **乾淨,1 = 1**
```
正式庫:pcm_auth_provider_of(p_ids uuid[])
版控  :20260908120000_m4b_authprov1_provider_of_users.sql:148
        `GRANT EXECUTE ON FUNCTION public.pcm_auth_provider_of(uuid[]) TO pcm_readonly;`
⇒ ✅ 差集 0
```

🟢 **尺自檢**:同一把 grep 找 `TO pcm_readonly` ⇒ 9 檔命中(尺會咬)· ⚪ 負對照現造角色 ⇒ 0 檔。

---

## 三、⇒ 結論:**這一列的缺口收斂到【一個地方】,而它仍然成立**

```
我們自己的兩個角色 × 三層, 全部量完了:
                    schema 層            表層                函式層
pcm_readonly        🔴 cron USAGE 版控外   🔴 63 張版控外       ✅ 1 = 1 乾淨
                    ✅ public USAGE 在版控
payment_confirmer   ✅ public USAGE 在版控  ✅ 1 = 1 乾淨        ✅ 45 = 45 乾淨
```
> ## 🎯 **⇒ 「版控外的 GRANT」今天的完整答案是:`cron` USAGE 一道 + `pcm_readonly` 的 63 張表。**
> ## 📌 **其餘每一層都乾淨。而那是量出來的,不是「沒查到」。**

🔵 **⇒ 板上那句「這一列是【一個實例】,不是【一份清單】」**:
　 對**我們自己那兩個角色**而言,**它現在是一份清單了**(09-10 做了表層,本份做完另外三層)。
　 🛑 而對**全庫**仍然不是 —— 平台那 12 個角色沒做,理由(它們本來就不由我們版控建)**仍然是推的**。

---

## 四、🛑 我證不到什麼

1. **那 63 張是誰、什麼時候、為什麼授的** —— 關閉條件 ① 仍然沒答。我只證了「它們不在版控裡」。
2. **平台那 12 個角色的差集沒做** —— 而「它們本來就是平台給的」這個理由**是推的**,
   我沒有證「平台角色的 ACL 裡沒有一道是我們自己 GRANT 上去的」。
3. **關閉條件 ④(「寫不進去」從設定值升成示範過的阻擋)沒動** —— 那要真的試寫,
   而**唯讀與 apply 是兩個授權**。`default_transaction_read_only=on` 今天仍然是**設定值**,
   **不是示範過的阻擋**。
4. 版控那一側我用的是 **regex 剖 migrations**(剝行註解)⇒ 它看不到
   動態 `format(...)` 組出來的 GRANT、也看不到跨很多行的寫法。
   🟢 我用「`TO pcm_readonly` 9 檔」與「`payment_confirmer` 45 支」當正對照證明它會咬,
   🛑 **而那證不到它看得見第三種寫法。**
5. 🔴 **本列每一格修法都是【動 GRANT】** ⇒ 鐵則 8 ⇒ **要 Sean。我一行都沒改。**
