# `#16` 今日實收 RPC —— apply 當天的檢查單(`20260815010000`)

> 🔴 **本檔全部未在正式庫執行過。** 這是「該怎麼驗」的清單,不是「已驗過」的紀錄。
> 寫的人(A 窗)本機沒有資料庫連線,所有 SQL 都是照 migration 字面與 house 既有寫法組出來的。
> **第一次跑就是正式庫** ⇒ 每一段都是**唯讀**的(`select` / `has_*_privilege` / 系統表),
> 全檔**沒有任何一段會改動資料**。
>
> 對象:Sean(貼進 Supabase Dashboard → SQL Editor,看數字對不對)。細節在
> `docs/specs/2026-08-15-e10-16-payment-total-rpc-plan.md`。

## 這支東西在做什麼(一句話)

後台首頁那格「今日實收」要讀收款表,**但那張表對程式是完全鎖死的**(刻意的,錢帳只能走具名管道)。
這個更新開一扇**只能問「某段時間收了多少錢」的小窗**,不開整張表。

## 順序(**不要跳**)

**apply 前跑第 1、1b、2、3 道**(共 4 道)—— 它們驗的是「前提還成立嗎」。
**apply 後跑第 4-8 道**(共 5 道)—— 它們驗的是「結果跟預期一樣嗎」。
⚠️ **第 1b 道與今天要 apply 的東西無關**,是趁機順手問另一個功能好不好 —— 理由見該段。

🔴 **第 1 道特別重要**:它是整片的地基。**那道不過就不要 apply。**

---

# apply 之前

## 第 1 道 🔴 收款表對程式仍然是鎖死的

```sql
select has_table_privilege('service_role', 'public.order_payments', 'SELECT') as 程式讀得到嗎;
```

| 看到 | 意思 | 怎麼辦 |
|---|---|---|
| **`false`(或 `f`)** | ✅ **預期值。** 鎖著 ⇒ 這個更新有存在的理由 | 往下做 |
| `true`(或 `t`) | 🔴 **有人在某個時間點補過權限** ⇒ 整片的論證前提**失效**(那格根本不需要新開窗口) | **停,不要 apply。** 把結果傳出來,要重新評估 |

> 為什麼這道最重要:整個判斷「首頁那格上線會壞」目前是**五份檔案的文字互相佐證**推出來的,
> **從來沒有人真的問過資料庫**。這一句就是那個缺口(`#502`)。跑掉它,缺口就補起來了。

## 第 1b 道 🔴🔴 採購那支函式的參數個數 —— **同一個坑我們已經掉過一次**

> ⚠️ **這道跟今天要 apply 的東西無關**,是**趁著開著 SQL Editor 順手問的**。
> 它問的是**另一個功能**(採購)現在到底是好的還是壞的。**放在這裡是因為錯過就又要另外找機會。**

```sql
select p.pronargs as 參數個數
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'admin_upsert_item_procurement';
```

| 看到 | 意思 | 怎麼辦 |
|---|---|---|
| **`12`** | ✅ 預期值。採購那支是好的 | 往下做 |
| `11` | 🔴🔴 **後台的「採購」功能現在就是壞的** —— 而且畫面上不會有任何跡象 | **停,傳出來。** 這件事比今天要 apply 的東西更急 |
| 查不到 / 0 筆 | 函式不存在 | 停,傳出來 |

**為什麼特別問這一句**:2026-08-07 出過一次 —— 程式那邊的清單寫著「12 個參數」,
**而正式站實際上只有 11 個**,結果採購功能從上線那天起就是壞的(錯誤碼 `PGRST202`),
**一路沒人發現**,直到那天緊急修復。
現在的證據是「程式那邊的清單說 12」。
⚠️ **R2 N6 更正**:這裡原本寫「**跟上次騙過所有人的那份是同一種東西**」——**那句抹平了一個真實差別**:
上次那份 12 是**有人手寫補上去的**;現在這份是 **apply 之後從真的資料庫重新產生的**
(`packages/adapters/src/supabase/database.types.ts:146` 逐字「A9h-M 已 apply、本檔已重 gen ⇒ 12 參是**生成的**,不再是手寫補丁」)。
⇒ **份量差很多,不該講成一樣。**
🔴 **但仍然值得問這一句**,理由換成正確的那個:**那次「已修好」的驗證跑在拋棄式測試庫上,正式庫從來沒有人問過。**
⇒ 這一句是**唯一**能把「檔案說它好了」變成「資料庫說它好了」的方法。**便宜的保險,不是已知的火。**

## 第 2 道 名字沒有被別人用掉

```sql
select count(*) as 同名函式數
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'admin_today_payment_total';
```

| 看到 | 意思 | 怎麼辦 |
|---|---|---|
| **`0`** | ✅ 預期值,名字是空的 | 往下做 |
| 不是 0 | 已經有同名的東西 ⇒ 可能已經 apply 過,或撞名 | **停**,把數字傳出來 |

## 第 3 道 沒有「只開某幾欄」的隱藏授權

```sql
select count(*) as 欄位層授權數
  from pg_attribute
 where attrelid = 'public.order_payments'::regclass and attacl is not null;
```

| 看到 | 意思 | 怎麼辦 |
|---|---|---|
| **`0`** | ✅ 預期值 | 往下做 |
| 不是 0 | 有人對**個別欄位**開過權限 —— 第 1 道那種整張表的查法**看不到這種** | **停**,傳出來 |

> 這道存在的理由:house 踩過 —— 表層權限的查法對「欄位層授權」是全盲的。

---

# apply 之後

## 第 4 道 函式的四個屬性都對

```sql
select p.prosecdef                                as 用擁有者身分執行,
       array_to_string(p.proconfig, ',')          as 搜尋路徑,
       p.provolatile                              as 揮發性,
       l.lanname                                  as 語言
  from pg_proc p
  join pg_language l on l.oid = p.prolang
 where p.oid = 'public.admin_today_payment_total(timestamptz, timestamptz)'::regprocedure;
```

**預期逐欄**:`true` / `search_path=""` / `s` / `sql`。

| 哪一欄不對 | 意思 |
|---|---|
| `用擁有者身分執行` 不是 true | 那扇窗根本讀不到收款表 ⇒ 首頁那格會一直顯示「讀取失敗」 |
| `搜尋路徑` 不是 `search_path=""` | 函式可能被誘導去讀別的 schema 的同名表 ⇒ **安全問題** |
| `揮發性` 不是 `s` | 是 `i` ⇒ 資料庫有權把答案**記住不再重算**,首頁可能顯示昨天的數字而畫面看起來完全正常 |
| `語言` 不是 `sql` | 有人把它改寫成程序式 ⇒ 本片所有形狀前提失效 |

**任一欄不對 ⇒ 停,傳出來。**

## 第 5 道 🔴 只有程式帳號拿得到,外人拿不到

```sql
select r.rolname as 角色, has_function_privilege(r.rolname,
         'public.admin_today_payment_total(timestamptz, timestamptz)', 'EXECUTE') as 叫得動嗎
  from (values ('anon'),('authenticated'),('authenticator'),('service_role')) r(rolname);
```

**預期**:`anon` / `authenticated` / `authenticator` 三個都 **false**,`service_role` **true**。

| 不對的情況 | 意思 | 怎麼辦 |
|---|---|---|
| `anon` 或 `authenticated` 是 true | 🔴 **沒登入的訪客叫得動它 ⇒ 今天收了多少錢是公開的** | **停,立刻傳出來** |
| `service_role` 是 false | 程式叫不動 ⇒ 首頁那格永遠是「讀取失敗」 | 停,傳出來 |

> `authenticator` 是 false 是**正常的**,它要先切換身分才拿得到 —— 那是系統的正常路徑。

## 第 6 道 一整天沒收到錢時,回的是 0 不是空白

```sql
select * from public.admin_today_payment_total(
  '2099-01-01 00:00:00+08'::timestamptz,
  '2099-01-02 00:00:00+08'::timestamptz);
```

| 看到 | 意思 | 怎麼辦 |
|---|---|---|
| `total = 0`、`row_count = 0` | ✅ **預期值** | 往下 |
| `total` 是空白 / `null` | 🔴 首頁那格會壞在**每天早上第一筆收款進來之前** —— 而那是每天都會經過的狀態 | 停,傳出來 |

## 第 7 道 🔴 它算出來的錢,跟直接算的一樣

**這道是真正在驗「錢有沒有算對」。**

```sql
with last_day as (
  select date_trunc('day', p.received_at at time zone 'Asia/Taipei') as d
    from public.order_payments p
   order by p.received_at desc
   limit 1
), b as (
  select (d at time zone 'Asia/Taipei')                        as 起,
         ((d + interval '1 day') at time zone 'Asia/Taipei')   as 迄
    from last_day
)
select b.起, b.迄,
       (select coalesce(sum(p.amount), 0) from public.order_payments p
         where p.received_at >= b.起 and p.received_at < b.迄) as 直接加總,
       r.total     as 這支算的,
       r.row_count as 筆數
  from b, public.admin_today_payment_total(b.起, b.迄) r;
```

(取「最近一個有收款的日子」,不是今天 —— 今天可能還沒有任何收款,那樣這道就沒有判別力。)

| 看到 | 意思 | 怎麼辦 |
|---|---|---|
| `直接加總` = `這支算的` | ✅ **預期值** | 完成 |
| 兩個數字不一樣 | 🔴 **它算錢的方式跟直接算不一樣** ⇒ 首頁那個數字不能信 | **停,兩個數字都傳出來** |

## 第 8 道 沖銷(收錯錢又沖掉)的資料存不存在

```sql
select count(*) as 沖銷列數 from public.order_payments where reverses_payment_id is not null;
```

這道**不是通過/不通過**,是**決定第 7 道證明了多少**:

| 看到 | 第 7 道證明了什麼 |
|---|---|
| **大於 0**,且那些列落在第 7 道取到的那一天 | ✅ **連「沖銷要照算」都一起驗到了** —— 這是最強的情況 |
| **是 0**,或那些列不在那一天 | ⚠️ 第 7 道只驗到「一般收款算得對」,**「沖銷照算」還沒被實際驗過** |

> 🔴 **後者不算失敗,但要記著。** 那條要等到正式庫真的出現沖銷資料時,再把第 7 道跑一次。
> **不要為了驗它去手動塞測試資料進錢帳。**

---

## 🔴 這份清單**驗不到**的事(誠實記,不要以為跑完就沒事了)

1. **首頁畫面本身沒被看過。** 四格的版面、「讀取失敗」的樣子、手機上長怎樣 —— 一次都沒量過。
   ⇒ apply 完**還要有人真的打開後台首頁看一眼**,而那是另一件事。
2. **程式那一半還沒上線。** 這個更新只在資料庫開了那扇窗;
   後台程式接上去是**另一片**(要等這個 apply 完、型別重新產生之後才做得了)。
   ⇒ **apply 完當下,首頁那格不會有任何變化,那是正常的。**
3. **這支 SQL 沒有經過不同模型的對抗審查**(2026-08-15 codex 跑不出結果,已送 Sean 裁)。
   ⚠️ **「審查沒吐出問題」與「沒被審過」是兩件事** —— 這片是後者。
4. 🔴 **本檔每一段 SQL 都沒有被執行過。** 若某段語法就報錯,那是我寫錯,不是資料庫有事 ——
   把錯誤訊息傳出來即可,**不要自己改 SQL**。

## 相關

- plan:`docs/specs/2026-08-15-e10-16-payment-total-rpc-plan.md`(§5a rollback、§7 誠實缺口)
- backlog:`#502`(本檔就是它的可執行版本)
- migration:`supabase/migrations/20260815010000_m4b_e10_16_admin_today_payment_total.sql`
- 上線當天總表:`docs/runbooks/2026-08-14-apply-day-one-pager.md`
