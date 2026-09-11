# ⟦f3-ADPNARROWER1⟧ 複量 · 2026-09-11 · 窗 C

> 依「每一列的做法」四步。🟢 唯讀零寫入 · `pcm_readonly` @ 正式庫 · rc=0 · 真錯誤 0 格 · `2026-09-10 18:43:00 UTC`
> 🛑 **而結論是【仍成立】,而且它是 🧑Sean 那一類,不是窗做得完的** —— 見第五節。

---

## 一、① 那一列宣稱什麼

逐字:**「那道被當成『根治』的 `ALTER DEFAULT PRIVILEGES`,射程比報的窄一格。」**
經 09-07 / 09-08 三個窗補量之後,還活著的部分收窄成:
```
① 版控裡的 ADP 仍缺 ON FUNCTIONS
② 線上:storage 完全沒收 · public/SEQUENCES 的 service_role=w 還在
③ FOR ROLE postgres 以外的 owner 不在射程(supabase_admin + public 那組全開)
④ ACL 快照的 WHERE 只含 storage/public ⇒ 射程外 18 列, 其中 6 列含 anon(graphql 那兩個 schema)
⑤ 六支函式對 anon/authenticated/service_role 有 EXECUTE, 而 repo 零 GRANT 零 REVOKE
```

---

## 二、🔴 結論:**逐格【仍成立】,三天沒有一格被關掉**

```
pg_default_acl 全表          09-08 = 27 列 ⇒ 今天 = 27 列          ✅ 不變
🔴 storage(r/f/S 三列)      anon / authenticated / service_role 三個角色【全開】
                             r 各 arwdDxtm · f 各 EXECUTE · S 各 SELECT,UPDATE,USAGE
                             ⇒ 📌 `20260905120000` 要收的那一格, 線上【一個都沒收】
🔴 public/S(序列)          service_role=UPDATE 還在
                             ⇒ 📌 `20260905430000` 要收的那一格, 線上還沒生效
🟡 public/r 與 public/f      只有 postgres ⇒ 乾淨(而【分不出】是收乾淨還是本來就沒授出去)
🔴 supabase_admin + public   r/f/S 三列對 anon / authenticated / service_role 全開
                             ⇒ 📌 repo 的 ADP 只收 `FOR ROLE postgres`, 收不到這一組
FOR ROLE 分佈                postgres 6 · supabase_admin 18 · supabase_auth_admin 3(= 27)
                             ⇒ ✅ 仍是三個 owner, 與 09-07 一致
🔴 快照射程外 18 列          auth 3 · cron 3 · extensions 3 · realtime 3 · graphql 3 · graphql_public 3
                             其中【含 anon 的 = 6 列】, 全在 graphql / graphql_public
                             ⇒ ✅ 與 09-08 逐格相同
⚪ 負對照                    現造 schema 名 ⇒ 0 · 現造函式名 ⇒ 0
```

**✅ 而「今天是理論不是現況」那一格也仍然成立**:`public` 底下的
**relations 109 個 · functions 217 支,owner 全部是 `postgres`**(各只回一列)
⇒ 📌 **`supabase_admin` 那組全開的預設,今天仍然打不到任何東西。**

---

## 三、🔴 而【那個數字又長了】—— 而這一列自己預言過這件事

該列 2026-09-08 逐字寫著:
> 📌 **⇒ 差 2 是【時間】不是口徑** —— 09-07 到 09-08 多了 2 支函式。
> **204 是 2026-09-07 的讀數。這個數會長,引用前重跑。**

```
public 函式   09-07 = 204 · 09-08 = 206 · 🔴 2026-09-11 = 217   (三天 +11)
public 物件   09-08 = 102 ·              🔴 2026-09-11 = 109   (三天 +7)
🟢 正對照 pg_catalog 函式 = 3,319 ⇒ 尺數得到大數
```
> ## 🎯 **它寫下那句警告,而三天後同一個數字又長了 11。**
> 📌 **⇒ 那句話不是預防性的措辭,它是一個【會反覆發生】的事實。**
> 而今晚我在另一列(`f3-SVCROLEUNVERIFIED1`)也撞到同一件事:53/11 ⇒ 54/12。
> **⇒ 兩列各自獨立地證明了同一句話。**

---

## 四、🔴 而我這一發多量到一格:**那六支函式的授權範圍比該列寫的【更寬】**

該列逐字:「6 支函式在正式庫上對 `anon` / `authenticated` / `service_role` 有 EXECUTE」。
🔬 今天逐支實量的 grantee 集合(已排除 owner):
```
m3_jsonb_values_all_string        anon, authenticated, PUBLIC, service_role   INVOKER
prl_append_only_guard             anon, authenticated, PUBLIC, service_role   INVOKER
prl_no_cycle_guard                anon, authenticated, PUBLIC, service_role   INVOKER
prl_one_effective_terminal_guard  anon, authenticated, PUBLIC, service_role   INVOKER
set_updated_at                    anon, authenticated, PUBLIC, service_role   INVOKER
sync_product_fitments             anon, authenticated, PUBLIC, service_role   INVOKER
```
🔴 **六支都還多一個 `PUBLIC`**,而該列的文字沒有寫它。
📌 **⇒ 那與 `⟦tidy-NETPUBLICALL⟧` 是同一個受詞問題**:**收具名角色收不掉 `PUBLIC`。**
　 ⇒ 🛑 **若有人照該列的文字去寫 REVOKE(收那三個角色),`PUBLIC` 那一份會留著。**
🔵 而**可利用風險仍然是 0**:六支 `prosecdef = f`(INVOKER)⇒ 以呼叫者身分跑
　 —— 這一格與 09-08 `-refund` / `-auth` 的讀數一致。

---

## 五、🛑 而我在這裡停下:**它不是「窗做得完」的那一類**

我先前把本列分類成 🔧窗,而**那個分類今天要改**:
```
本列今天要的每一格修法都是【動權限】:
  · 補一支帶 ON FUNCTIONS 的 ADP
  · 對 storage / public.S 真的把那幾道收下去
  · 對那六支函式各自補 REVOKE(而且要連 PUBLIC 一起收)
  · 或把 ACL 快照的 WHERE 放寬(那也是 migration)
⇒ 鐵則 8 + 12 ⇒ 🧑 要 Sean 批, 我不寫。
```
🔵 而該列自己 2026-09-10 的尾巴就寫著 **⟨已查證 2026-09-10 · 仍成立 · plan 在(無, 只複量)· 等 Sean 批⟩**
⇒ 📌 **它早就已經在 Sean 那一堆了,而我把它分類成🔧是我讀漏了那一句。**
🛑 **我照自己先前標的紅線停下:結論若變成「要收 ADP」⇒ 當場升級成 🧑Sean,不自己往下做。**

---

## 六、🛑 我證不到什麼

1. **我只讀 `pg_default_acl` = 未來新建物件的預設,它不等於現有物件的 ACL。**
2. **我沒有問「那三支 migration 貼了沒」** —— `supabase_migrations.schema_migrations` 對 `pcm_readonly`
   是 `permission denied`(09-08 三發都是)⇒ 我答得出「**效果不在**」,答不出「**是沒貼**還是**貼了沒生效**」。
3. `public/r` 乾淨那一格的**歸因未確認** —— 分不出是收乾淨了還是本來就沒授出去。
4. **`graphql` / `graphql_public` 那 6 列是不是問題,我沒查** —— 我沒有查 Supabase 官方對那兩個
   schema 的預設,而 `anon` 對 GraphQL 端點全開**很可能是平台設計**。
   ✅ 而**「我們的偵測看不到它」這件事本身是真的**,那與它是不是問題無關。
5. 六支函式我只量了**授權**,**沒有量它們實際被誰呼叫**。
