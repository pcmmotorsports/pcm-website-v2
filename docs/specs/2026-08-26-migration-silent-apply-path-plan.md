# 關掉「套得動而兩本帳都不寫」那條路 —— plan

> 2026-08-26 · 線2 `ff` · 交辦 = 主視窗 `-96` · **本片是 plan,零 code 改動**
> 正本坑條目 `#795`(兩把尺會分岔且分岔時零訊號)/ `#800`(db push 會重跑已套的)
> 🔴 **本 plan【不開新 backlog 條目】** —— 兩條都已存在、我開檔讀完整條,這是它們的續集不是新病。

---

## §0 一句話

> **那條路不是沒有守門。守門存在、而且已經掛在 `pre-push` 上 ——**
> ## **問題是它的【綠燈裡就包含了我們要抓的那個東西】。**

---

## §1 先量,不先設計:那條路長什麼樣

### 1.1 三把尺已經被定義好了(不是我發明的)
`scripts/migration-ledger-divergence.sh:6-30` 檔頭逐字:
```
R = repo      supabase/migrations/*.sql          「我們寫了什麼」
H = 人帳本    supabase/APPLIED.tsv               「有人記下他 apply 了」
P = 平台帳本  supabase_migrations.schema_migrations  「supabase db push 會怎麼想」
```
而**為什麼 H 與 P 會分岔,那份檔頭也已經量過了**(2026-08-20 窗 c5):
```
Dashboard SQL Editor 貼上去 ⇒ 完全不寫 schema_migrations(P 不動、H 要人手記)
MCP apply_migration        ⇒ 寫 schema_migrations, 但【自派版本號】
supabase db push           ⇒ 讀 P。P 沒有的就當沒套過 ⇒ 重跑
```
### 1.1a ✅ **「Dashboard 貼的不進 P」—— 2026-08-26 補到官方文件,不再是單一來源**

**這一格原本標【單一來源】(只有 c5 2026-08-20 的實測),而整份 plan 的診斷都站在它上面。已補:**

**Supabase 官方文件逐字**(`https://supabase.com/docs/guides/troubleshooting/branch-in-migrations-failed-status`):
> This almost always means the migration history on `main` is out of sync with its actual live schema,
> **commonly because a change was made directly in the SQL Editor or through another manual edit
> that was never captured as a migration file.**

**同批查到的另外兩句,一起釘住:**
```
`https://supabase.com/docs/guides/deployment/database-migrations` 逐字:
  Supabase tracks which migrations have been applied ... in a table called
  `supabase_migrations.schema_migrations`. When you run `supabase db push`, it compares your local
  `supabase/migrations` folder against that table and runs only the ones not yet applied, in order.
  ⇒ 這就是 #800「會重跑」的官方依據。

`https://supabase.com/docs/reference/cli/supabase-db-push` 逐字:
  If you need to mutate the migration history table, such as deleting existing entries or
  **inserting new entries without actually running the migration**, use the `migration repair` command.
  ⇒ 這就是 §6 那格的官方處置法, 而且逐字寫著「不會真的去跑那支」—— 正是我們要的。
```
⇒ ✅ **兩個獨立來源(repo 內實測 + 官方文件)⇒ 這一格不再是單一來源。**
⚠️ 而**仍未複驗的那半**:c5 那發是對【本專案的正式庫】實測,我方無存取權;
官方文件講的是【一般行為】。**「官方說會這樣」與「我們這顆庫確實這樣」是兩個宣稱。**

### 1.1b 🔴 而官方文件多給了一個【本 plan 原本沒寫】的後果
```
建 Preview Branch 時, 平台會【重放 main 的 migration history】到一顆新庫
⇒ history 與實際 schema 對不上 ⇒ 分支停在 MIGRATIONS_FAILED, 空的或做到一半
   (出處同上 branch-in-migrations-failed-status)
```
⇒ 📌 **所以爆炸半徑不只 `db push`。** 之前只寫「重跑會炸」,而**建分支也會炸,而且它炸得比較安靜**
   —— 一個空的或半滿的 preview 分支,看起來像「還沒建好」。

### 1.2 守門不但存在,而且已經接線了
```
.husky/pre-push:66  逐字   sh "$_R/scripts/migration-ledger-divergence.sh" --if-pushing-main
自檢               `sh scripts/migration-ledger-divergence.sh --selftest` ⇒ rc=0, 21 PASS / 0 FAIL
被引用分母(全 repo, 排除自己)⇒ 16 檔命中;正對照 migration-post-commit-guard ⇒ 8;
                    負對照 zzz-nosuchscript-20260826 ⇒ 0
```
📌 **所以這一片【不是】「工具在那裡而沒有人跑」那一族。** 它跑,而且會擋。

---

## §2 🔴🔴 而它抓不到這一次的那支 —— **原因是結構性的**

`migration-ledger-divergence.sh:22-31` 的八種組合表,第四格逐字:
```
④ R H̄ P̄   待套 PENDING(正常,還沒 apply)      ok
```

**而 `20260825120000` 在被補帳之前的簽名,一格一格量:**
```
R  ls supabase/migrations/ | grep -c '^20260825120000'   ⇒ 1   有
H  grep -c '20260825120000' supabase/APPLIED.tsv(補帳前)⇒ 0   沒有
P  Sean 2026-08-26 本人跑 supabase_migrations            ⇒ No rows returned   沒有
⇒ R H̄ P̄ = ④ = 【待套 PENDING = ok】
```
**而它當時【已經在正式庫生效】**(live 函式 md5 `fb93f08d…`、`allows_zero = true`,
codex 走 MCP 一次 + Sean 走 SQL Editor 手跑一次,**兩條獨立路徑同值**)。

> ## 🔴 **「還沒 apply」與「apply 了而沒人記」在這三把尺底下印【同一個簽名】。**
> ## **而它們的處置完全相反:一個要去套,一個絕對不能再套。**

### 2.1 為什麼是結構性的,不是這支腳本寫壞了
```
R / H / P 三把尺量的都是【紀錄】:
  R 量「我們寫了一份檔」· H 量「有人寫了一列」· P 量「平台寫了一列」
🔴 沒有任何一把在量【資料庫現在實際長什麼樣】。
⇒ 一個「沒有人留下紀錄」的動作, 對三把尺而言與「沒有發生」是同一件事。
```
📌 **這就是為什麼補再多把「讀紀錄的尺」都補不到這一格。**

---

## §3 機制優先律:先答「為什麼機制做不到」

**先講一個【現在就適用】的事實:這條路不經過 `commit`,也不經過 `push`。**
```
有人打開 Dashboard SQL Editor、貼、按執行 ⇒ 從頭到尾沒有碰過這個 repo
⇒ pre-commit / pre-push / CI 【全部沒有機會被觸發】
⇒ 🔴 攔截式的機制在這條路上【不存在可以站的位置】
```
⇒ **所以問題要改寫成:既然攔不住,那能不能【必然被發現】?**

---

## §4 機制候選,與各自為什麼行 / 不行

### 甲 · 加第四把尺 = 量【DB 實際狀態】,不量紀錄
**做法**:每支 migration 自帶一句機器讀得懂的「我跑完之後,DB 裡該存在什麼」,
守門逐支去問正式庫「那個東西在不在」。Sean 那發 md5 查詢就是這種尺的手工版。
```
可行性量測:
  現有 migration 帶這種標記的  grep -rlE '^-- *(VERIFY|ASSERT|POSTCHECK|驗證斷言)' supabase/migrations/ ⇒ 0
  正對照 含 CREATE FUNCTION 的                                                      ⇒ 131
  負對照 zzzmarker20260826                                                          ⇒ 0
⇒ 🔴 零既有基礎建設。217 支 migration 要【回頭補】斷言。
```
- ✅ **它是唯一真的分得開 ④ 與「已套沒記」的做法。**
- ❌ 代價:①要正式庫唯讀存取(施工窗沒有)②217 支回補 ③斷言本身會過期
  ④**寫斷言的人與寫 migration 的是同一個人 ⇒ 他漏想到的那一格,斷言也不會有**。

### 乙 · 把守門從 `--if-pushing-main` 放寬到每次 push / 定期跑
- ❌ **不解決本題。** 放寬的是【頻率】,而本題是【那把尺看不見】。
  ④ 今天綠、明天綠、跑一百次還是綠。
- 📌 **這一格值得寫下來,因為它是最直覺、也最像在做事的那個答案。**

### 丙 · 禁止用 SQL Editor 套 migration(規則層)
- ❌ 機制優先律要求先問「為何機制做不到」:**這條沒有機制,它只是一句話。**
  而 `APPLIED.tsv` 現存列裡就有備註寫著「Sean(SQL Editor 本人貼)」
  ⇒ **那條路是現行實務的一部分,不是違規。** 禁掉等於禁掉 Sean 現在的工作方式。
- ⚠️ 而它有一個【可機制化的半格】:見丁。

### 丁 · 讓那條路自己留下紀錄(在【貼上去的那段 SQL 裡】)
**做法**:每支 migration 檔尾固定帶一段 `insert into` 自家的一張 `applied_log` 表
(或直接 `insert into supabase_migrations.schema_migrations`),
**貼的人不需要多做任何事 —— 他貼的那段 SQL 自己會記帳。**
- ✅ **它把「要記得記帳」從紀律變成機制**,而且對 SQL Editor / MCP / db push 三條路都成立。
- ✅ 不需要施工窗有正式庫存取權(寫在 migration 檔裡,審查看得到)。
- ❌ 代價:①要改 migration 範本 + 一道守門檢查新檔有沒有帶那段
  ②舊的 217 支不會回溯 ③**貼的人可以只貼前半段** ⇒ 它防漏不防繞
  ④直接寫 `schema_migrations` 是動平台自己的表,**風險要 Sean 或 codex 過**。

---

## §5 推薦

> ## **丁 為主(讓那條路自己記帳)+ 甲 只對【高風險那幾支】做,不做 217 支。**

理由:
```
丁 把成本壓在【寫 migration 的那一刻】, 而那一刻本來就有人在寫檔、有審查看得到
甲 全量做不划算(217 支回補 + 要正式庫), 而它是唯一分得開 ④ 的尺
   ⇒ 只給【錢 / 權限 / 不冪等】那幾支帶斷言, 其餘接受「只能對帳不能攔截」
```
🔴 **而要誠實寫出來的結論**:
> **這條路【攔不住】。丁 讓它留下痕跡,甲 讓少數幾支可以被獨立驗證 ——**
> **兩個都不是攔截。「只能對帳,不能攔截」就是這一格的答案,硬掰一道閘比承認它糟。**

---

## §6 🔴 一個【現在就會發生】的副作用 —— 補帳把燈從綠推成紅

`cc` 2026-08-26 已把那一列補進 `APPLIED.tsv`(`:291`,日期欄 `unknown-backfilled-20260826`)。
**而補完之後那支的簽名變了:**
```
補帳前  R✅ H❌ P❌  = ④ 待套 PENDING     ⇒ 閘判 ok(綠)
補帳後  R✅ H✅ P❌  = ② 🔴 危險          ⇒ 閘【擋】, exit 3
        (② 逐字:「人帳說套了、平台不知道 ⇒ db push 會重跑」← 擋)
```
### 6.1 ⚠️ **射程比上面那句窄 —— 逐字核過,先講清楚免得有人以為現在壞了**
`scripts/migration-ledger-divergence.sh:49-56` 誠實邊界節逐字:
```
· 只擋 refs/heads/main 的 push
· 推 dev 【刻意不擋】。dev 會上 admin production, 但那是應用層部署、不會跑 db push
· GitHub 網頁 merge、別台機器、--no-verify、直接跑 supabase db push 【都繞得過】
  ⇒ supabase db push 本身沒有 hook 點, 這是本閘的天花板, 不是漏寫
```
⇒ **Sean 的常態是推 `dev`(main 由他手動 merge)⇒ 【他現在不會被擋,現在也沒有東西壞掉】。**
⇒ 🔴 **會被擋的是「下一個推 `main` 的人」,而他不會知道為什麼。**
📌 **這一格的形狀值得記**:旗標名 `--if-pushing-main` 寫在**呼叫端**(`pre-push:66`),
而「推 dev 刻意不擋」寫在**被呼叫那支檔的註解裡**
⇒ **只讀呼叫端的人看得到旗標,看不到那個「刻意」。**

🔴 **而同一節還寫著一句直接支持 §2 的話**:
> **「H 是自陳帳:它說 apply 過不代表真的 apply 過。」**
⇒ **寫這支守門的人自己就知道這件事。** 本 plan 的 §2 不是新發現,是**把它的後果補完**:
   H 不可信 ⇒ 而 P 也只是另一本帳 ⇒ **三把尺沒有一把在量 DB 本身。**
⇒ **而那個擋是【對的】** —— `db push` 真的會重跑它,而 `#800` 已經量到不冪等的重跑會 `ERROR 42701`。
⇒ **處置**:對那個版本號跑一次 `supabase migration repair`(把 P 補上),
   前例:`STATUS.md:842` 記著 Sean 2026-08-21 本人跑過兩條、帳本閘因此從紅轉綠。
⚠️ **我沒有正式庫存取權 ⇒ 這一發不是我能跑的,端給 Sean。**
📌 **值得記的形狀:一個【正確的補帳】把一盞綠燈變成紅燈,而紅燈才是真相。**
**如果沒有人先講,下一個撞到的人最可能的反應是【想辦法讓它變綠】。**

---

## §7 沒查 / 沒量的(不要讀成查過了)

```
· ✅ 「Dashboard 貼的不寫 schema_migrations」已於 2026-08-26 補到官方文件(見 §1.1a)⇒ 不再是單一來源。
  ⚠️ 而仍未複驗的半格:官方講的是【一般行為】, c5 那發是對【本專案正式庫】實測而我無存取權
  ⇒ 「官方說會這樣」與「我們這顆庫確實這樣」仍是兩個宣稱。
· `20260825130000`(checkout/cart_total 那道閘)仍然是候選 —— 它沒有對應的驗證查詢,
  而 Sean 那四發只涵蓋 sync_product_variant_group 這一支函式。🔴 不要讓 120000 的確認外溢過去。
· 那條路【實際上是哪一條】(SQL Editor 手貼 / 別窗直跑 / MCP)查不出來 ——
  要正式庫的 DDL 稽核 log, 本窗無存取權。
· 丁 案「直接寫 supabase_migrations.schema_migrations」是不是被平台允許 / 會不會被覆蓋,
  【未查】。實作前要問 codex 或查官方文件。
· 全量 217 支回補斷言的工時【沒估】。
· 本 plan 沒有動任何 code, 也沒有跑三綠以外的驗證 —— 它是 plan。
```

---

## §9 🔴 `Q1 = 甲` 落地第一步:**判準 —— 而第一版判準【失敗了】,失敗本身是結論**

> 主視窗指定:先定判準、要能數、給名單 + 分母 + 負對照。**不要先寫斷言。**

### 9.1 第一版判準(照候選清單做的)⇒ **不是篩子,是全集**
```
分母  supabase/migrations/*.sql ⇒ 218 支(2026-08-26 當場數;不是 217, cf 當晚新增一支)
A 不冪等(重跑會炸)     118   子項 insert 無 on conflict 64 / create index 無 guard 43 /
                              add column 無 guard 38 / create table 無 guard 37 / create type 2 / alter type add value 1
B 靜默改行為            177   子項 grant|revoke 158 / security definer 119 / create or replace function 91 /
                              rls policy 51 / create or replace view 17
A ∪ B                   193  = 【88%】
兩者皆非                 25
負對照 zzzpattern20260826  ⇒ 0 支
```
> ## 🔴 **一個涵蓋 88% 的「高風險」不是篩子,是全集。第一版判準【不能用】。**

⚠️ **而量它的時候有一格差點錯**:本 repo 把 rollback 寫成**被註解掉的真 SQL**。
```
拿 grant|revoke 當樣本:不剝註解命中 172 支 · 剝了註解 158 支 ⇒ 差 14 支
⇒ 那 14 支是【被否決的 SQL】被數成【生效的】。
```
📌 **任何掃 `.sql` 的尺不剝註解,就會把「我們決定不做的」算進分母。**

### 9.2 🔴 第二版判準:**不問「這支重不重要」,問「它的狀態現在是不是【分不出來】」**
```
斷言存在的目的 = 分開 ④(還沒套)與(套了沒記)。
⇒ 一支【已經在兩本帳上】的 migration, 它的狀態沒有歧義 ⇒ 斷言對它沒有工作可做。
⇒ 需要斷言的母體 = R ∖ H(檔在, 而人帳沒有)
```
**當場量(2026-08-26):**
```
R repo 版本號      218
H APPLIED.tsv      215
R ∖ H              🔴 3 支
H ∖ R(幽靈)       0 支
正對照 交集        215
負對照 版本號 '20269925120000' ⇒ 在 R: False · 在 H: False(尺會回 False, 不是恆真)
```
**那 3 支逐支列出(不摘要):**
```
20260825130000_m4b_zero_price_checkout_and_cart_total_gate.sql
    🔴 真正身分不明的就是這一支 —— 它沒有對應的驗證查詢, 而它的同批兄弟已證實是「套了沒記」
20260826000035_m4b_q15_customers_select_service_role_policy.sql   ← 今晚才出生(別窗), 未記帳是【預期的】
20260826140000_m4b_admin_customer_list_view_birthday.sql          ← 同上, 今晚才出生
```
⇒ **扣掉兩支今晚才出生的 ⇒ 現在真正需要斷言的是【1 支】。**

### 9.3 🔴🔴 而這推翻了**我自己寫在 §4 甲 裡的成本估計**
```
我寫的      「217 支要【回頭補】斷言」⇒ 而主視窗把它當【誠實邊界】端給 Sean 了
實際上      斷言只對【狀態有歧義】的那些有工作可做 ⇒ 今天是 3 支, 扣掉新生兒是 1 支
⇒ 甲 的成本【不是 217 支的回補】, 是:
   ① 範本改一次(新 migration 一律自帶斷言)—— 前瞻, 零回補
   ② 對當下 R∖H 那幾支補斷言 —— 今天 1 到 3 支
```
⇒ 🔴 **Sean 是在「217 支」這個數字底下選的甲。** 真實成本**比他被告知的低很多**
   ⇒ **他的選擇不會因此反轉(變便宜了),而他被告知的那個數字是錯的 ⇒ 要更正。**
📌 **我寫錯的成因**:我把「有多少支檔」當成「有多少支需要這件事」——
   **那是兩個不同的分母,而我沒有問第二個。**

### 9.4 ⚠️ 而有一件事這個判準【不做】,要寫清楚
```
R ∖ H 只涵蓋「人帳沒記」的。而那 215 支【人帳說套了】的, 沒有任何東西驗證過那句話是真的
—— 守門檔頭自己寫著「H 是自陳帳:它說 apply 過不代表真的 apply 過」。
⇒ 要稽核那 215 支說的是不是實話, 那是【另一件事、另一個規模】, 不在本判準射程內。
⇒ 🔴 不要把「我們處理了 3 支」讀成「migration 帳本已經可信」。
```

---

## §8 要 Sean 拍的兩格

```
Q1: migration 記帳這條路怎麼關?
    甲 = 丁 為主 + 甲只給高風險那幾支          ← 我推薦
    乙 = 只做對帳、不做記帳(承認攔不住, 靠定期比對)
    丙 = 先不做, 記進 #795 等踩到再說

Q2: 20260825120000 會擋【推 main】, 而你平常推的是 dev ⇒ **現在沒有東西壞掉, 不急**。
    要不要現在 repair(官方 `supabase migration repair`, 逐字「插入紀錄而不真的跑那支」)?
    甲 = 現在跑
    乙 = 下次要推 main 之前再說
    🔴 不處理的話, 下一個推 main 的人會撞牆而不知道為什麼;而建 Preview Branch 也會踩到(§1.1b)。
```
