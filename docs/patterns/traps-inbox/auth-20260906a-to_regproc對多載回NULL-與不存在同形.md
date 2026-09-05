## `to_regproc` 對【多載】的函式名回 **NULL** —— 而那與「它不存在」印同一個東西

**線** `-auth` 2026-09-06 · `⟦01-LEDGERFALSENEG⟧` · **他述**(帳號窗量的讀數,我複驗時撞到)

### 事情
查 `20260901030000` 這支 migration 貼進正式庫了沒。帳號窗的讀數逐字:**「正式庫 `to_regproc` 0 支」**。
我複驗時**放了一個正對照** —— 拿一支**確定存在**的 `public.create_order` 去問同一把尺:

```
to_regproc('public.create_order') IS NOT NULL   ⇒  f      ← 🔴 它說不存在
同一發 pg_proc 逐名 count(*) 同一個名字          ⇒  2      ← 而它有兩支多載
```

⇒ 📌 **`to_regproc` 在名字【多載】時回 NULL** —— 它無法決定要指哪一支簽章,所以回空。
⇒ 🛑 **「`to_regproc` 回 0」與「這個函式不存在」在畫面上逐字相同。**

### 🔴 而最值得記的是:**這一次它的結論【碰巧是對的】**
`settle_zero_total_order` 用 `pg_proc` 逐名數**也是 0**(🔴 負對照 `zzq9_never_defined_fn` = 0 ⇒ 尺會動;
🟢 正對照 public 函式總數 = 187)。⇒ 那支**真的**沒貼。

⇒ 🎯 **對的答案 + 錯的方法 = 下一次會錯,而沒有人會回頭查。**
   一個被證實過一次的方法,會被下一個人直接沿用 —— 而它的失效條件(多載)**不在讀數裡**。

### 判別句
> **我這把尺,在【該說有】的時候會不會說有?**
> —— 而正對照要挑**最接近失效條件的那一種**:問函式存在性,正對照就要挑一支**確定存在【而且多載】**的。
> 🛑 挑一支「確定存在而只有一個簽章」的正對照 ⇒ **它會通過,而這個病照樣不現形。**

### 修法(可執行)
```sql
-- ❌ 不要:多載時回 NULL,而 NULL 讀起來像「不存在」
SELECT to_regproc('public.fn') IS NOT NULL;

-- ✅ 改成:逐名數,不受多載影響;而且一次把負對照與正對照放進同一發
SELECT nm,
       (SELECT count(*) FROM pg_catalog.pg_proc p
          JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = nm) AS n_overloads
  FROM (VALUES ('要問的那支'),
               ('某支確定存在【而且多載】的'),   -- 🟢 正對照:必須 > 1
               ('zzq9_never_defined_fn')          -- 🔴 負對照:必須 0
       ) AS t(nm);
```
🔵 而**函式「存在」對 `CREATE OR REPLACE` 那幾支零判別力** —— 要問的是 **body 裡有沒有新版才有的字面**
(`pg_get_functiondef` + `strpos`)。這兩件事要分開問,不要合成一句「它在不在」。

### 同族(母題相同,機制不同 —— 不要合併,要互指)
- `memory/reference_information-schema-lies-zero-to-unprivileged-audit-role.md`
  —— `information_schema` 依**你的權限**過濾。2026-09-06 同一夜我在序列那片又撞了一次:
  `information_schema.sequences` 回 **0** 而 `pg_class` 回 **9**。
- 🎯 **兩者的母題**:**一把誠實的尺,回答了一個你沒有問的問題。**
  `information_schema` 那把換掉的是**分母**(誰看得到);`to_regproc` 這把換掉的是**唯一性**(指不指得到)。
  ⇒ 📌 **兩個都不會報錯、都回一個合法的值** —— 而那個值可以直接寫進報告。
