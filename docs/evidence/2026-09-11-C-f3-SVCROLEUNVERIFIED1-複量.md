# ⟦f3-SVCROLEUNVERIFIED1⟧ 複量 · 2026-09-11 · 窗 C

> 依「每一列的做法」四步。🟢 唯讀零寫入 · `pcm_readonly` @ 正式庫 ·
> `bash scripts/readonly-prod-sql.sh` · **rc=0 · 真錯誤 0 格** ·
> `current_user = pcm_readonly` · `transaction_read_only = on` · `2026-09-10 18:39:58 UTC`

---

## 一、① 那一列宣稱什麼

逐字:**「`service_role` 讀得到那兩張表」這件事,只在 mock 上驗過,沒有在正式庫驗過。**
來源 = codex 對抗審查第 3 條(`-f3` 2026-09-01 開列,**未獨立複量**)。
關閉條件(列自己寫的):一發唯讀正式庫 probe,配正對照 + 負對照。

---

## 二、🔴 結論:**這一列的宣稱今天【不成立】**

**它已經在正式庫上量過兩次**,而我這一發是第三次:
```
2026-09-08  線 -ship 跑了一發(該列自己記著讀數)
2026-09-08  線 -db  把「欄級沒量」那個限定關掉
2026-09-11  本份(我)—— 逐格複量, 與前兩發【一致】
```
⇒ 📌 **「只在 mock 上驗過」在 2026-09-01 是真的;今天是假的。而列首那句話沒有被劃掉。**

---

## 三、逐格讀數(2026-09-11)

```
(1) has_table_privilege
    service_role  × orders / order_items ⇒ SELECT t · INSERT f · UPDATE f · DELETE f
    authenticated × 兩張                  ⇒ SELECT t · 其餘 f
    pcm_readonly  × 兩張                  ⇒ SELECT t · 其餘 f
    ⚪ anon       × 兩張                  ⇒ 四個全 f      ← 尺會動

(2) 表級 relacl 逐字(兩張表同形)
    postgres      DELETE,INSERT,MAINTAIN,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE
    service_role  MAINTAIN,REFERENCES,SELECT,TRIGGER        ← 即 `rxtm`, 沒有寫
    authenticated SELECT
    pcm_readonly  SELECT
    any_grantable 全 f · relacl_is_null 兩張都 f
    ⇒ 與 09-08 的 `{postgres=arwdDxtm, service_role=rxtm, authenticated=r, pcm_readonly=r}` 逐字相同

(3) 欄級 ACL   orders 0/42 欄 · order_items 0/13 欄
(3b) 🟢 正對照 全庫真的在用欄級授權:customers 6 · products 20 · product_variants 11 ·
     staff 3 · supplier_sync_runs 5 · pcm_settle_retry_attempts 4
     ⇒ 📌 那個 0 不是「尺看不到欄級」

(4) RLS   兩張都 rls_enabled=t · forced=f · **policies=2**
    rolbypassrls  service_role t · pcm_readonly t · postgres t · anon f · authenticated f

(6) ⚪ 負對照 現造表名 ⇒ to_regclass NULL · pg_class 0 列
```

---

## 四、🔴 而正對照那一格【數字動了】,那本身是讀數

```
該列記著(2026-09-08):全庫 public 一般表 service_role 可讀 ⇒ t 53 張 / f 11 張(共 64)
本份(2026-09-11)   :                                    ⇒ t 54 張 / f 12 張(共 66)
```
📌 **三天多了兩張表。** 兩個意義:
1. ✅ **那把尺是活的** —— 它的分母會跟著庫變,不是一個抄在文件裡的死數字。
2. 🛑 **而任何引用「53/11」的地方,今天都已經舊了。**

---

## 五、🔵 順手看到、而**不是本列的題**(交出去,不自己判)

`authenticated` 對 `orders` / `order_items` **有表級 SELECT**,而它 `rolbypassrls = f`
⇒ 擋住一般會員只看得到自己訂單的,**是那兩條 RLS policy,不是授權**。
📌 那是 `⟦0e-RLSLIVE1⟧` / `⟦b9-RLSHARDEN⟧` 的射程,不是本列的。**我只記,不判。**

---

## 六、要誰做什麼

```
🛑 不修 —— 本列沒有東西要修, 它要的是一發量測, 而那一發做過了(這是第三發)
🔵 板檔那三格只有主視窗能改:
   ① 列首那句「只在 mock 上驗過」今天是假的 ⇒ 要劃掉
   ② 「53/11」那個正對照數字要更新成 54/12(或改成「跑的時候現數」)
   ③ 該列 `卡在:` 欄剩的三格, 每一格都指向【別的列】:
      · 只量了這兩張表        ⇒ 那就是本列的射程, 不是缺口
      · MAINTAIN/TRIGGER 該不該有 ⇒ ⟦b9-SRVMIN⟧ 的題
      · rolbypassrls ⇒ PII 面     ⇒ ⟦0e-RLSLIVE1⟧ / ⟦b9-RLSHARDEN⟧ 的題
      ⇒ 📌 **本列自己的問題已經沒有了。**
```

---

## 七、🛑 我證不到什麼

1. **我沒有用 `service_role` 的身分去 SELECT 一列** —— 我問的是**權限**,不是**行為**。
   這一格與 09-08 那兩發**同樣沒做到**,它從來沒有被關掉。
2. 這四個讀數是 **`pcm_readonly` 問出來的目錄讀數**,不是 `service_role` 自己跑的。
3. `has_table_privilege` 答的是**表權**,不是 **RLS policy**。
4. 只量了這兩張表。
5. 讀數是這一發的;平台側與別的窗都可能在改。
