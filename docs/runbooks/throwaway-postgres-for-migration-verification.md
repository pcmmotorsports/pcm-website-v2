# Runbook · 在 macOS 起一個能跑 PCM migration 的拋棄式 Postgres

> **用途**:要驗一支 migration 而**沒有 DB access**時(施工窗的常態),用本檔在本機起一個真的 Postgres 把它 apply 起來。
> **紅線**:只在拋棄式叢集、**不碰正式庫**、不進別人的 worktree 寫東西(要檔 `cp` 出來)。
> **實跑驗證**:2026-08-16 E 窗跑 `#518`(PostgREST 錯誤欄位)與 `#525`(客戶搜尋 RPC)兩次,本檔是那兩次的實際步驟。

---

## 🔴 這份檔為什麼要存在(不是因為沒人寫過)

**三個 macOS 坑,repo 裡【早就寫過】:**

| 坑 | 已存在的座標 | 寫於 |
|---|---|---|
| Unix socket 路徑 >103 bytes ⇒ postmaster 啟動即死 | `docs/handoff/2026-07-30-a7t-consistency-trigger-handoff.md:71`、`docs/handoff/2026-07-30-a7-cancellations-handoff.md:69` | **2026-07-30** |
| 少 `LC_ALL=C` ⇒ `postmaster became multithreaded during startup` | `docs/handoff/2026-07-30-a7t-consistency-trigger-handoff.md:72` | **2026-07-30** |
| zsh **不對變數做詞分割** ⇒ `PSQL="psql -h …"` 後 `$PSQL` 被當成單一命令名 | memory `feedback_claim-scope-exceeds-fact-three-shapes.md:114`(C 窗踩過) | 2026-08 |

> 🔴 **而 2026-08-16 我還是從頭踩了其中兩個。**
> **病不是「沒寫」,是【寫在只有當事人會回去讀的載體】** ——
> handoff 是一次性的;memory 要有人記得 recall。
> **而「我現在要起一個拋棄式 PG」這個動作,在那一刻沒有任何東西會叫。**
> ⇒ **本檔的唯一價值是【可被那個動作觸發】** —— 放 `runbooks/`,檔名就是那個動作。

> ## 🔴🔴 復發紀錄 —— **本檔存在之後,`LC_ALL` 那個坑又被踩了一次**
> **2026-08-19,G5**:起拋棄式 PG 驗一支 migration 的 `CHECK`,**第一發就死在
> `FATAL: postmaster became multithreaded during startup`** —— 而它逐字寫在上面那張表、
> 也逐字寫在 §1 那段可貼指令的註解裡(`export LC_ALL=C LANG=C` 那行)。
>
> 🔴 **它是怎麼被踩到的(這一格才是重點)**:我**確認過本檔存在**(`test -f` ⇒ 有),
> **然後自己手打 `initdb` / `pg_ctl`,沒有打開它。**
> ⇒ **「知道有這份 runbook」與「讀了這份 runbook」是兩件事**,而前者讓人**更不會**去讀後者
> —— 因為「有 runbook」這件事本身就給了安心感。
>
> 📌 **可機械執行的那一句**(比「記得讀 runbook」強,因為它不依賴記性):
> ```
> 要起拋棄式 PG ⇒ 【不要自己打指令】,去 §1 複製整段。
> 判別句:我這一發的 initdb/pg_ctl,是【貼來的】還是【打出來的】?
>          打出來的 ⇒ 我沒有讀這份檔,只是知道它在。
> ```
> ⚠️ **而本檔的自我評價要跟著降級**:上面那句「本檔的唯一價值是【可被那個動作觸發】」——
> **這一次它沒有被觸發成功。** 檔名對了、位置對了、內容對了,而讀者只確認了它存在。
> ⇒ **「放對地方」不等於「會被讀到」**,這是本檔第二次證明同一件事(第一次是 2026-08-16 那段)。

---

## 0. 🔴🔴 先讀這段 —— **跑完之後你會覺得做完了,而那一刻正是要讀它的時候**

> **這段原本排在第 4 節。移到最前面的理由:照著指令跑完、看到 `exit 0`,人就停了。**

1. **`apply 成功` ≠ 那些斷言通過。**
   DO 區塊通常**只在失敗時 RAISE、成功時零輸出** ⇒ `exit 0` 只證明**整塊**沒炸,**不證明每一條都跑到**。
   ⇒ **要逐條突變**:一次破壞一個前提,確認**對應那一條**紅,而且**紅的是預期那條訊息**。
2. **先跑一個「本來就該紅」的對照,再信任任何綠。**
   (例:空表時 apply —— 若該 migration 的正向對照斷言是 fail-closed,它**應該炸**。它沒炸才是問題。)
3. **零命中 / 空結果一律配正向對照**:先打一個保證命中的輸入,證明管線是活的。
   **沒有正向對照的 0,與「函式恆回空」在觀察上不可分辨。**
4. **斷言炸掉時,先查是不是自己的環境缺前置**,不要直接報成對方的 bug。
   **實例**:`#525` 第一次 apply 炸在「索引不存在」,查了才知道那支索引由**前一支 migration** 建、
   而對方檔裡明文引了來源(`:146`)⇒ **是我環境不完整,差點報成假 finding。**

   > #### ➕ **給第 4 條配一把尺**(2026-08-19 G2 後加;**上面那三行是原作者的,一個字沒動**)
   >
   > 第 4 條說的是對的,而它**只給了提醒,沒給動作** —— 而「先查是不是環境問題」靠的是注意力。
   > **可執行的版本**:炸掉的當下,**在同一個環境裡跑一支【已知會過】的 migration**。
   > ```
   > 它過了  ⇒ 環境是好的 ⇒ 炸的是【你在驗的那一支】
   > 它也炸  ⇒ 環境缺東西 ⇒ 先修環境，不要報 finding
   > 🔴 兩個世界印不同的東西 ⇒ 這一發才有判別力
   > ```
   > 🔴 **這一條就是【正向對照】,只是對照的對象是【跑的那個環境】,不是 pattern 或尺。**
   > (我們慣常把正向對照用在「這把尺量得到東西嗎」;**很少有人想到拿它問「這個環境活著嗎」**。)
   >
   > **指名一支**(不指名的話,下一個人會卡在「哪一支算已知會過」):
   > ```
   > supabase/migrations/20260505130758_init_brands_categories.sql
   > 理由：它是全樹最早的一支，而它的外部依賴【剛好只有 §2 bootstrap 建的那三個角色】
   >      （service_role / anon / authenticated，RLS policy 要用）
   >      ⇒ 🔴 它等於「把 §2 bootstrap 本身跑一遍」——
   >        它炸 ⇒ 你的 bootstrap 不完整；它過 ⇒ bootstrap 是好的
   > ```
   > **自己挑的規則**(換一支時照這個挑,不要隨手抓一支):
   > ```
   > ✅ 沒有前置閘（不含 to_regclass / pg_attribute 的 DO 檢查）
   > ✅ 不依賴任何「別的 migration 才會建的表 / 欄 / 型別」
   > ✅ 在【乾淨叢集 + §2 bootstrap】之上單獨跑得完
   > ❌ 不要拿【你正在驗的那一支】當對照 —— 它有前置閘，炸了分不出是閘還是環境
   > ```
   > 📌 **為什麼這一發【一定要自己先跑過】,而不能靠讀**:
   > 這支 migration 在本節裡的角色是**環境的金絲雀** ——
   > 🔴 **而一隻不會死的金絲雀,與一個安全的礦坑,在觀察上完全一樣。**
   > ⇒ 換掉它、或把它搬到別的環境時,**照下面那兩行重跑一次**,不要沿用這裡的結論。
   >
   > ✅ **而上面那句「它跑得完」是【量到的】不是推的**(2026-08-19 G2 當場跑,兩個方向都跑):
   > ```
   > 乾淨叢集 + 只建三個角色 + pgcrypto ⇒ 那支 apply ⇒ psql rc=0            ← 該綠有綠
   > 乾淨叢集 + 【不建角色】          ⇒ 那支 apply ⇒ ERROR: role "service_role" does not exist
   >                                                （炸在 :66，policy 那行）  ← 🔴 該紅有紅
   > ⇒ 兩個世界印不同的東西 ⇒ 它【真的】驗得到 bootstrap 在不在，不是恆綠
   > ```
   > ⚠️ **射程**:這一發只驗得到「**環境的地基**在不在」。
   > 你要驗的那支若依賴**更後面的 migration** 建的東西,這一發**過了也不代表它的前置齊**
   > ⇒ 那一格仍然要照第 4 條**逐個去查它引的來源**。

5. 🔴🔴 **而第 4 條有一個【鏡像】,它危險得多:本環境給的「擋住了」預設不可信。**
   ```
   第 4 條：環境缺東西 ⇒ 炸了 ⇒ 我報成產品的 bug     ⇒ 假 finding ⇒ 有人會去查 ⇒ 會被抓
   🔴 第 5 條：環境缺東西 ⇒ 擋住了 ⇒ 我記成產品擋的  ⇒ **假綠** ⇒ 沒有人會去查一個通過的檢查
   ```
   ⇒ 不對稱的根源:**「擋住了」正是我想看到的結果** ——
   **當結果符合期望時,沒有人會去問「它是被誰擋的」。**
   ⇒ 而**這個環境天生缺東西**(角色、GRANT、schema、平台預設),
   **而缺的每一樣都是一道額外的、不屬於產品的閘。**

   **🔴 2026-08-19 實例(G2,驗一支 RPC 的 EXECUTE 權限)**:
   ```
   目標：證明【產品的 REVOKE】擋住 authenticated
   結果：HTTP 403 ✅「擋住了」
   而訊息是：permission denied to **set role** "authenticated"
   我期望的：permission denied for **function** admin_set_product_listing
   成因：本環境的 authenticator 只被 GRANT 了 anon 與 service_role
        ⇒ 請求在【換角色】那一步就死了，**根本沒走到那支函式**
   ⇒ 🔴 產品的 ACL 在那一發裡【一次都沒有被執行到】，而 403 與「通過」在報告上長得一樣
   ```
   🔴 **兩句都是「不准」,而只有第二句說得出【誰不准】。**

   **⇒ 這一節要給的是一個【動作】,不是一個提醒**(理由見下):
   > **每一發「擋住了」,都去讀那句訊息在講哪一層。讀不出來 ⇒ 標【未驗】,不要標【通過】。**
   > **狀態碼(`401` / `403` / `42501`)只說「不准」,不說「誰不准」** ⇒ 不要只看狀態碼。

   **⇒ 而要蓋住它,需要兩份【不同原理】的證據,它們各自蓋不住**:
   ```
   A（wire 層）打 HTTP ⇒ 403                         ← 證明「打不進去」，不證明是誰擋的
   B（DB 層） has_function_privilege('authenticated', …, 'EXECUTE') ⇒ f
                                                      ← 直接問產品 ACL，完全不經過換角色那一層
   正向對照要對【同一層】做：同一發 wire 測試裡 service_role 打得進去（HTTP 200）
   ⚠️ 不要用「另一個角色也被擋」當正向對照 —— 那兩發可能是【同一個原因】
   ```
   📌 **為什麼寫成動作而不是提醒(作者自陳,照實記)**:那一發之所以被抓到,
   **不是因為我謹慎,是因為那句錯誤訊息長得不對**。
   **若 PostgREST 回的是同一句「permission denied for function」,我到現在都不會知道。**
   ⇒ 🔴 **救它的是【訊息夠具體】,不是判斷力 —— 而那不是每次都會有。**
   ⇒ 所以寫「要小心分辨」沒有用:讀的人會以為靠注意力就夠。**要跑的動作才擋得住。**

---

## 1. 起叢集(整段可貼)

> ## 🔴 先改一件事:**路徑與埠是【共用變數】,不要照抄一組寫死的**
> **2026-08-20 W1 實錘**:照本檔原本寫死的 `/tmp/pgprobe` + 埠 `55501` 跑,**第一發就撞**
> (`could not bind IPv4 address "127.0.0.1": Address already in use`),
> 而同一台機器當時另有 W2 的叢集在 `/tmp/pcm-probe-w2` 埠 `55521`。
> 🔴 **更壞的是上面那行 `rm -rf "$D"`** —— 我在撞到之前已經跑掉了。
> 那一次事後查證沒有刪到別人**正在跑**的叢集(唯一在跑的是 W2、路徑不同),
> **而「有沒有刪到別人【停著】的叢集」我證不到。**
> ⇒ ⇒ 修法**不是**加一句「rm 之前先確認」(提醒改不了行為),
> 是**讓路徑與埠天生不撞** —— 那樣那句提醒就不需要。
> (母題:memory `feedback_shared-names-across-windows` —— 多窗共用一台機器,**任何名字都是共用變數**。)

```bash
export LC_ALL=C LANG=C                        # 🔴 少這行會 multithreaded 啟動失敗

# 🔴 窗別自己填(W1/W2/G3/…);沒有窗別就用一個只有你會用的字。**不要沿用別人的。**
WIN=w1                                        # ← 改這一個字,下面全部跟著走
D=/tmp/pcm-probe-$WIN                         # 🔴 短路徑;scratchpad 全路徑會超過 socket 103 bytes 上限
PORT=555$(printf '%02d' $(( $(echo -n "$WIN" | cksum | cut -d' ' -f1) % 90 + 10 )))
RPORT=$(( PORT + 3000 ))                      # PostgREST 那一層的埠,同樣跟著 WIN 走

# 🔴 出生就檢查:埠被佔 / 目錄已存在 ⇒ 停,不要 rm 別人的東西
lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1 && { echo "🔴 埠 $PORT 已被佔用,換 WIN 再來"; return 2>/dev/null || exit 1; }
[ -e "$D" ] && { echo "🔴 $D 已存在 —— 可能是【別人的】或【你上次沒收攤的】。自己看過再決定,本檔不替你 rm"; return 2>/dev/null || exit 1; }

mkdir -p "$D"
# 🔴 --encoding=UTF8 --locale=C 兩個都要(2026-08-25 cf 實測,見下方「兩個獨立的坑」)
initdb -U postgres -A trust --encoding=UTF8 --locale=C "$D/data" > "$D/initdb.log" 2>&1
# 🔴 LC_ALL 一定要在【環境裡】,不是只給 initdb —— 少了它 postmaster 起不來
LC_ALL=C pg_ctl -D "$D/data" \
  -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" \
  -l "$D/pg.log" start
sleep 3
psql -h 127.0.0.1 -p $PORT -U postgres -tAc "select version()"
```
**起不來就看 `$D/pg.log` 最後 6 行,不要猜。**

### 🔴 起來之後還有三個坑(2026-08-26 cf 踩過而只散在對話裡;2026-08-27 cf 在拋棄式 PG 17.10 逐一重現,每格帶正負對照)

| 坑 | 症狀(逐字) | 怎麼避 | 對照 |
|---|---|---|---|
| **角色名不能 `pg_` 開頭** | `ERROR:  role name "pg_cf_test" is reserved` | 探針/世界用的角色改別的前綴(`cf_`、`w1_`…) | 正對照 `CREATE ROLE cf_test` ⇒ `CREATE ROLE` |
| **PG15+ `public` schema 對非 owner 預設無 CREATE** | 用非 postgres 的角色 `CREATE TABLE` ⇒ `ERROR:  permission denied for schema public` | 在**每個新 DB** 裡 `GRANT CREATE ON SCHEMA public TO <角色>` | 同一句 GRANT 之後 ⇒ `CREATE TABLE` |
| 🔴 **角色是【叢集】層級的,`DROP DATABASE` 不會帶走它** | 換一個 DB 之後 `pg_roles` 裡上一個世界的角色**還在** ⇒ 第二個世界 `CREATE ROLE service_role` 直接 `already exists`;而**先 `DROP ROLE` 再 `DROP DATABASE`** 會撞 `role cannot be dropped because some objects depend on it` | 世界之間**先 `DROP DATABASE`、再 `DROP ROLE`**,順序不能反;每個世界開頭都做 | `SELECT count(*) FROM pg_roles WHERE rolname='cf_app'` 在新 DB ⇒ **1**;負對照 `zzz_nope` ⇒ 0;`DROP ROLE` 後 ⇒ 0 |

📌 第三個坑的形狀:**rc 一樣是非零,而兩個世界沒建成的原因不同** —— 只看 rc 會讀成「探針壞了」。2026-08-27 cf 的三世界 harness 第一發就是這樣死的(三個世界 rows 全 0)。

### 🔴🔴 兩個**獨立**的坑,而它們會被合成一個(2026-08-25 cf 實測,四格 2×2)

> ⚠️ **先講為什麼要分開寫**:這兩個都在「叢集起不來 / 跑到一半炸」的階段出現,
> 而它們的**變數不同**。合成一句的話,修了一個而另一個還在,**而症狀看起來一樣。**

**坑一 · `initdb` 沒指定編碼 ⇒ 叢集是 `SQL_ASCII`**
```
LC_ALL=C initdb -U postgres -A trust <dir>                        ⇒ initdb.log 逐字:
    "The default database encoding has accordingly been set to \"SQL_ASCII\"."
    起起來之後 SHOW server_encoding  ⇒ **SQL_ASCII**
LC_ALL=C initdb -U postgres -A trust --encoding=UTF8 --locale=C   ⇒ SHOW server_encoding ⇒ **UTF8**
```
🔴 **後果**:PCM 有 migration 會在 UTF8 ↔ SQL_ASCII 之間轉換而失敗
(2026-08-25 線 06 的 215 支 replay 裡,**兩支**因此炸)。
⚠️ **而 cf 用自己構造的 SQL(`convert_to` / `convert`)【沒有】重現那個錯誤訊息** ——
**重現到的是【成因】(叢集真的是 SQL_ASCII),不是 06 報的那一句。**
⇒ 要看那句原文,去 06 的交件包;**不要引用成「cf 重現了那個錯誤」。**

**坑二 · `pg_ctl` 的環境沒有 `LC_ALL` ⇒ postmaster 直接死**
```
pg.log 逐字:
  FATAL:  postmaster became multithreaded during startup
  HINT:   Set the LC_ALL environment variable to a valid locale.
```
🔴 **2×2 實測(叢集編碼 × 環境有無 `LC_ALL`)——它是 `LC_ALL` 造成的,【不是編碼】**:
```
叢集 SQL_ASCII · 環境無 LC_ALL ⇒ 🔴 起不來(上面那則 FATAL)
叢集 SQL_ASCII · 環境有 LC_ALL ⇒ ✅ 起得來
叢集 UTF8      · 環境無 LC_ALL ⇒ 🔴 起不來(**同一則 FATAL**)
叢集 UTF8      · 環境有 LC_ALL ⇒ ✅ 起得來
```
> 📌 **四格全跑過才分得出來。** 只跑「SQL_ASCII + 無 LC_ALL」那一格的人,
> 會把它記成「SQL_ASCII 叢集起不來」—— **而那句話會讓下一個人修錯東西。**
⚠️ 上面那兩道檢查**會在該紅的時候紅**(埠被佔 / 目錄已存在),而它們**擋不到**
「別人待會才要用這個名字」。⇒ 收攤時把 `$D` 刪乾淨,別留給下一個人去猜。

🔴 **zsh 陷阱**:不要寫 `PQ="psql -h 127.0.0.1 …"` 然後 `$PQ -c …` —— zsh 不做詞分割,整串會被當成命令名。
**用 shell function**:
```bash
pq () { psql -h 127.0.0.1 -p $PORT -U postgres -v ON_ERROR_STOP=1 "$@"; }
```

> ### 🔴🔴 而上面那句警告**已經在本檔裡,而 2026-08-20 W1 照樣打了出來**
> ```
> 我寫了 PSQL="psql -h …" 然後 $PSQL,每一發都是 command not found、一發都沒跑。
> 而我的判定是 [ "$A1" = "$B1" ] —— 兩邊都是空字串 ⇒ **印出兩個 ✅**。
> ⇒ 那不是「rollback 驗過了」,是「量具沒接上,而它印了我想看的答案」。
> ```
> **⇒ 提醒改不了行為,機制可以。凡是拿指紋/計數當判準的比對,配一道 guard:**
> ```bash
> guard () { case "$1" in ''|*'|EMPTY') echo "🔴 指紋空/EMPTY ⇒ 量具沒接上,本輪作廢"; exit 1;; esac; }
> # 指紋一律帶 count 前綴 + coalesce(...,'EMPTY'),讓「查無」與「沒跑」在字面上分得開:
> #   SELECT count(*)||'|'||coalesce(md5(string_agg(...)),'EMPTY') FROM ...
> B=$(fp); guard "$B"      # 取基準就驗一次
> A=$(fp); guard "$A"      # 取終值再驗一次
> [ "$A" = "$B" ] && echo "回到基準" || echo "與基準不同"
> ```
> 🔴 **並且加一道【前提斷言】**:動作做完之後指紋**必須先變過**,否則那把尺是死的 ——
> 「套了卻沒變」與「回到基準」在最後那一步長得一樣。

## 2. 🔴 PCM 專屬 bootstrap(這段是本檔真正新的部分)

**Supabase 平台幫你準備好、而本機沒有的東西**,一個都不能少:

```sql
-- 角色:🔴 `supabase/migrations/` 全樹零 `CREATE ROLE service_role` —— 它是 Supabase 平台給的,
-- 🔴🔴 **而【本檔下面兩行】自己就 `CREATE ROLE service_role`** —— 反例與宣稱只隔一行。
--    (⚠️ 2026-08-16 校正:原寫「repo 全樹零」是假的全稱句 —— 量法 `git grep -nE '全樹.{0,8}CREATE ROLE'` 曾回 5 命中,且本說法的反例包含【拋棄式測試環境自己造角色】。真值=`supabase/migrations/` 底下零,那目錄只有 `payment_confirmer`。)
CREATE ROLE service_role NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE anon NOLOGIN;
-- 🔴 **`authenticator` 也要**(2026-08-29 線A `-e9` 量到,拋棄式 PG 17.10):
--    `20260810100000_m4b_e10_op1_order_payments_m.sql:410` 要它 ⇒ 少了它那支炸
--    `ERROR:  role "authenticator" does not exist` ⇒ 而 `order_payments` 建不出來
--    ⇒ 下游每一支碰帳本的都跟著死,**而失敗數看起來只是「這個環境比較嚴格」**。
--    **量到的**:照檔名序套到 `20260823030000`(209 支),
--      補這一行【之前】失敗 **65** 支 ⇒ 補上【之後】失敗 **43** 支。
-- 🛑 **而 43 支【仍然】失敗 —— 本清單還是不完整,不要讀成「照著跑就會全綠」。**
--    ⇒ 你要驗的那支若在下游,**先看第一支失敗的錯是什麼**,不要看總數
--      (2026-08-29 同一輪的第二個自踩:總數 164 看起來像環境嚴格,
--       而真相是【第一支就斷了、`orders` 根本沒建起來】—— 抓到它的是開檔讀那個錯)。
CREATE ROLE authenticator NOLOGIN;

-- auth schema 骨架
-- 🔴 codex 2026-08-30 nit(更正,原字面留痕):~~「只需要被 FK 參照的那張表」~~ 已經不對了 ——
--    下面除了 `auth.users`,還要 `auth.uid()` 與對 schema 的 USAGE。
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
-- 🔴 **`auth.uid()` 也要**(2026-08-30 線 DB `-08` 量到,拋棄式 PG 17.10)——
--    同 `authenticator` 那一條的形狀:少了它,`20260523034911_init_customers_and_subtables.sql`
--    的 RLS policy 就炸 `ERROR: function auth.uid() does not exist`,
--    而 `customers` 建不出來 ⇒ **下游每一支碰客戶的都跟著死**。
--    **量到的**(全樹 237 支依序跑完,`scripts/migrations-replay-from-zero.sh`):
--      補這一行【之前】失敗 **50** 支 ⇒ 補上【之後】失敗 **47** 支。
--    🔴 **而真正值錢的不是那 3 支,是【第一支失敗換人了】**:
--      補之前的第一支失敗是這個 `auth.uid()`(= bootstrap 自己的缺件),
--      補之後變成 `relation "public.product_fitments_effective" does not exist`
--      ⇒ **那才是 `#299` 記了一個月的那個真正的斷點。**
--      📌 **⇒ 一個 bootstrap 缺件會【站在真正的問題前面】,而它們在總數上長得一樣。**
--    🛑 **而 47 支仍然失敗 ⇒ 本清單【還是】不完整**(這一行不改上面那句警告,只是又補了一格)。
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
-- 🛑 **這個 `auth.uid()` 恆回 NULL** —— 它只夠讓 migration【建得起來】。
--    ⇒ 拿它驗 RLS 會**恆得 0 列**(`auth.uid() = customer_id` 永遠不成立),
--      而那個 0 與「policy 寫錯」印同一個東西。⇒ **要驗 RLS 就換一版會回真值的**,例如
--      `SELECT current_setting('request.jwt.claim.sub', true)::uuid` 再用 `SET` 餵值。
--    (codex 2026-08-30 抓;而本檔 §1 那句「兩個世界印不同的東西」正是它要防的。)
-- 🔴 GRANT:少了它,以 authenticated/anon 身分跑的驗證會在【錯的一層】被擋
--    ⇒ 你會以為是 policy 擋的,而其實是 schema 沒有 USAGE。
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

-- 🔴 extensions schema —— migration 裡寫 `extensions.gin_trgm_ops`,沒有這個 schema 會在 DDL 那行就炸
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA extensions;

-- 業務型別(依你要驗的那支 migration 需要什麼再加)
CREATE TYPE member_tier AS ENUM ('general','store','premiumStore');
```

**⚠️ 建表 DDL 一律從 repo 取,不要憑欄位名自己編** —— 「我造的表跟正式庫不一樣」是這類驗證最大的效度風險。
| 要什麼 | 逐字取自 |
|---|---|
| `public.customers` | `supabase/migrations/20260523034911_init_customers_and_subtables.sql:14-25` |
| `idx_customers_name_trgm` / `idx_customers_phone_trgm` | `supabase/migrations/20260812130000_m4b_347_fuzzy_admin_search_orders.sql:432-438` |

**找法**:`grep -ln "CREATE TABLE.*<表名>" supabase/migrations/*.sql`

---

### 🔴🔴 而在 bootstrap 之前先問一句 —— **它比上面整段都重要**

> ## **任何一句「我在完整 schema 上驗過」,在這棵 repo 上都要先問:你的 replay 幾支失敗?**

**為什麼**:`supabase/migrations/` **不是**這個資料庫的完整定義。從零依序跑完會有一批失敗,
而失敗的那幾支所要建立的東西,**在你的拋棄式庫裡是不存在的** ——
🔴 **而你的查詢對「這張表不存在」與「這張表存在但沒資料」會給出不同的錯,對「這個欄位不存在」
卻可能安靜地回空。⇒ 「我驗過了」在一個殘缺的 schema 上,是一句沒有射程的話。**

### 🔴🔴 而它有**第二個問題**,而它與第一個一樣重要

> ## **你用的是哪一份 bootstrap?**

**同一棵 repo、同一份 migrations,在兩份 bootstrap 之下差【一倍】**:
```
手打 §2 那段            ⇒ 41 支失敗(2026-08-25 線 06)
用 repo 內建的 shim     ⇒ **19 支失敗**(2026-08-25 cf 自己跑的,見下)
```
🔴 **⇒ 兩個問題要一起問。只問「幾支失敗」而不問「用哪份 bootstrap」,拿到的數字沒有意義。**

### ✅ **先跑這一支,不要手打**(2026-08-25 cf 補;它一直都在,而 §2 教的是手打)
```bash
psql -h 127.0.0.1 -p $PORT -U postgres -v ON_ERROR_STOP=1 -q -f scripts/d1-supabase-shim.sql
```
`scripts/d1-supabase-shim.sql`(**54 行**)檔頭逐字:
> 「migrations 之前先跑。範圍 = **實掃 85 支 migration 的最小集合**(角色 TO 清單 + auth 引用)」
> —— 角色四個 / `auth.users` 含 `email` 與 `raw_user_meta_data` / `auth.uid()` / `extensions` + pgcrypto

📌 **又是同一個母題**:**一把工具【存在】與【下一個人找得到它】是兩件事。**
(同族:`scripts/tool-final-css.py` 躺在信箱一個月、`scripts/traps-neighbours.py` 沒有人跑。)

**cf 2026-08-25 自己跑的一發(不是引用別人的數字)**:
```
initdb --encoding=UTF8 --locale=C ⇒ server_encoding = UTF8
psql -f scripts/d1-supabase-shim.sql          ⇒ rc=0
for f in supabase/migrations/*.sql (216 支, filename 順序, ON_ERROR_STOP=1)
  ⇒ **成功 197 · 失敗 19 · 分母 216**
失敗的成因大致三族:pg_cron / net 類(5 支, 檔名多帶 pgcron)· 缺 relation(catalog / vehicle_taxonomy)
                   · manual refund 那一串(D1/D2/D3/866 —— 多半是前面失敗的下游)
收攤:pg_ctl stop rc=0 · pgrep 無殘留程序 · 目錄已刪並驗
```

---

**當天的量**(⚠️ **數字帶著量法與時刻走,它會過期而過期時零機械訊號**):
```
🔴 2026-08-25 線 06:215 支照 filename 順序全跑 ⇒ **41 支失敗**
   ⚠️ **2026-08-25 cf 補:這個 41 是【手打 §2 bootstrap】之下的數字, 不是這棵 repo 的性質。**
   ⇒ 換成 scripts/d1-supabase-shim.sql ⇒ **19 支**。**原句留著, 因為它記錄了「手打會發生什麼」。**
   🔴 而【不要】因此讀成「所以其實沒問題」——**一個數字變小, 與那個問題變小, 是兩件事。**
      那 19 支仍然是真的失敗。
2026-08-25 線 1  :全新空庫依序跑 214 支     ⇒ **195 成功 / 19 失敗**(首個失敗在第 55 支)
                  插入 scripts/d1-fitments-bootstrap.sql 之後 ⇒ **199 / 15**
🔴 兩個數字不同, 而它們【不是互相矛盾】—— 分母(215 vs 214)、順序、是否插 stub 都不同
⇒ **要引用就自己重跑一發, 並把「你跑的是哪一種」寫在數字旁邊。**
```

### 三族失敗(2026-08-25 線 06 分的堆;cf 只重驗了 (a) 與 (c))

**(a) `public.product_fitments_effective` 不存在 —— 而它【不是遺失】**
```
量法(cf 2026-08-25 重跑, 與 06 一致):
  grep -ln "CREATE.*VIEW.*product_fitments_effective" supabase/migrations/*.sql  ⇒ **0**
  grep -ln "product_fitments_effective"               supabase/migrations/*.sql  ⇒ **7**(引用它)
  負對照 一個編造的 view 名 ⇒ 0
```
🔴 **而「migrations 裡沒有」這句話不可以單獨寫** —— 照本 repo 紀律,同一句要答得出 canonical 在哪:
```
✅ canonical DDL(七個物件, 312 行:三表 + 一 view + 三函式 + 索引 + RLS + GRANT)
   docs/archive/2026-07-25-docs-cleanup/reviews/2026-07-12-s1-apply-sql.sql
   (cf 實查:存在 · 312 行 · 建 product_fitments_effective 的敘述 3 處 · 負對照 0)
✅ migration 相容性 stub(只建其中 1 張, 明寫「本檔不是 #299 的解」)
   scripts/d1-fitments-bootstrap.sql(cf 實查:存在 · 49 行 · 5 個 CREATE)
📎 完整脈絡與三顆地雷:docs/launch-todo.md 的 `#299` 那一列
```
> 🔴 **那份 DDL 一直都在,而它住在 `docs/archive/`。**
> **而 `docs/archive/*` 在規矩裡是「絕不動」—— 大家把它讀成「不要碰」⇒ 連讀都不去讀。**
> 📌 **一條保護性的規矩,把一份完整的資料變成了隱形的。**
> ⚠️ 而那份存檔是 **2026-07-12** 的 ⇒ 「DDL 找得到」與「DDL 等於正式庫現況」是**兩個宣稱**,
> 只成立第一個。**照抄前先讀 `#299` 那一列列的三顆地雷。**

**(b) `pg_cron` / 平台物件缺席** —— 與上面 bootstrap 那段同族:本機沒有 Supabase 平台給的東西。
⚠️ **cf 沒有重驗這一族**,照 06 原文轉錄。

**(c) 叢集編碼** ⇒ **已上移到 §1**(它是起叢集那一步的事,不是 bootstrap 的事),見「兩個獨立的坑」。

## 2c. 🔴 地面真相:`sr_nobypass` 實讀(RLS / 政策類 migration 的第三方裁判)

> **為什麼要有這段**:兩把尺(探針 A 與探針 B、或 migration 自檢與審查者的 grep)一致,**不是效度 —— 它們可以用同一種方式一起錯**。
> 2026-08-26 cf 造了第三方:**把 BYPASSRLS 拿掉,真的去讀,數回幾列**。v1 探針六張錯兩張、v2 六張全中,是這樣分出來的;
> 2026-08-27 下手窗 de 用同一手量到片3a 舊版「migration 全綠而 `shipments` 實讀 **0 列**」(`4b0c47cc` commit body)。
> 8d 稱它「這兩天最好的一手」而它一直只活在信箱與 commit body 裡 —— 本段是它第一次落成可引用的一段。

**做法(整段可貼;接在 §2 bootstrap 之後、跑完要驗的 migration 之後)**

```sql
-- 一個「拿得到 service_role 的一切政策與權限、但自己沒有 BYPASSRLS」的角色
-- ⇒ 這就是「Supabase 哪天把 BYPASSRLS 拿掉」(Q15)的那個世界
CREATE ROLE sr_nobypass LOGIN INHERIT NOBYPASSRLS;
GRANT service_role TO sr_nobypass;
```
```bash
# 真的去讀,數回幾列(每張要驗的表各一發)
psql -h 127.0.0.1 -p $PORT -U sr_nobypass -d <db> -tAc "SELECT count(*) FROM public.<表>"
```

**怎麼讀結果**

| 你看到的 | 意思 |
|---|---|
| `permission denied for table` | GRANT 面沒給 ⇒ 政策再對也碰不到(片3a 方向1 就是這樣證出「寫入在 GRANT 層就被擋」) |
| 回 **0** 而表裡明明有列 | RLS 開著、政策沒套到 service_role(或被 RESTRICTIVE 殺掉)⇒ **這是 migration 全綠時最危險的那一格** |
| 回 N = 表裡的列數 | 政策真的套到了 |

**對照(不做就等於沒量)**
- 正對照:一張你**確定**有 `TO service_role` permissive SELECT 政策的表 ⇒ 要回 N
- 負對照:一張 RLS 開著、**零政策**的表 ⇒ 要回 0(2026-08-26 / 08-27 兩班都量到 0)
- 🔴 用同一個 `sr_nobypass` 讀 `INSERT/UPDATE/DELETE` ⇒ 三個都該 `permission denied`(GRANT 只有 SELECT 時);不是的話 GRANT 面已經不是你以為的那樣

**效度限制**
- 它答的是「**這個拋棄式庫**的 GRANT + RLS + 政策合起來讓 service_role 讀到幾列」;正式庫的角色拓撲(有沒有 `authenticator`、`service_role` 的 `rolinherit`)本機不知道 ⇒ 要另量(2026-08-27 cf 拓撲探針)。
- **分割表**:讀父表不需要子表的 GRANT(2026-08-26 實測 rc=0)⇒ 子表 `relacl` 是 NULL 不是紅。
- `sr_nobypass` 是**你造的角色**,收攤要 `DROP ROLE`(它是叢集層級的,見 §1 三個坑)。

## 3. 要 PostgREST 那一層時(驗錯誤欄位 / RPC 介面才需要)

```bash
cat > "$D/prest.conf" <<CONF
db-uri = "postgres://authenticator@127.0.0.1:$PORT/postgres"
db-schemas = "public"
db-anon-role = "anon"
server-port = $RPORT
CONF
# 需要先 CREATE ROLE authenticator LOGIN NOINHERIT; GRANT anon TO authenticator;
postgrest "$D/prest.conf" > "$D/prest.log" 2>&1 &
```
🔴 **改完 schema 一定要重載 cache**,否則回 `PGRST202`(「找不到那個函式」)而不是你要測的東西:
```sql
NOTIFY pgrst, 'reload schema';
```

## 4. 驗證紀律 → **已移到 §0**

**跑到這裡表示你已經 apply 成功了 —— 回去讀 §0。**
`exit 0` 是「整塊沒炸」,不是「每一條斷言都跑到」。

## 4b. 🔴 要彩排 `supabase db push` 本身(不是只跑 SQL)—— 2026-08-18 實測

> **本節與上面幾節的差別**:上面驗的是「這支 SQL 做了什麼」;本節驗的是「**CLI 那條路長什麼樣**」。
> 存在理由:真 apply 那一刻 Sean 在場、全隊在等 —— **那是最不該當第一次的時刻。**
> 全文與逐格輸出:`docs/probes/2026-08-18-db-push-rehearsal.txt`

**① `db push` 強制 TLS,而 `sslmode=disable` 它【不理】**
拋棄式叢集預設沒有 TLS ⇒ `tls error (server refused TLS connection)`,加 `?sslmode=disable` 得到**一模一樣的錯**。
```bash
openssl req -new -x509 -days 1 -nodes -subj "/CN=localhost" \
  -keyout "$D/data/server.key" -out "$D/data/server.crt"
chmod 600 "$D/data/server.key"
printf "ssl = on\nssl_cert_file = 'server.crt'\nssl_key_file = 'server.key'\n" >> "$D/data/postgresql.conf"
pg_ctl -D "$D/data" -l "$D/pg.log" restart -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=''"
```
⚠️ **這是【本機彩排】才會撞的**,正式 Supabase 本來就有 TLS ⇒ **不要誤讀成真 apply 的前置。**

🔴 **① -b 更便宜的那條路:加 `--debug` 就連得上,不必自簽憑證**(2026-08-18 G6 量,CLI `2.98.1`)
```
同一台叢集、同一個 --db-url、同一條命令,唯一差別是那個旗標:
  supabase db push --db-url "$U" --include-all           ⇒ rc=1  tls error (server refused TLS connection)
  supabase db push --db-url "$U" --include-all --debug    ⇒ rc=0  Applying migration … / Finished
```
📌 **而那句錯誤訊息自己就寫著** `Try rerunning the command with --debug to troubleshoot the error.`
—— **照做之後它不是「幫你診斷」,是【直接成功】。**
⚠️ **成因我沒查 ⇒ 標未確認**;我只證了「這兩發在同一台叢集上結果不同」。
⇒ 上面那段自簽憑證的做法**仍然有效、留著**;要快的話先試 `--debug`。

**② push 不是整批原子的 —— 一支一支來,成功一支記一支**
實測:182 支推空庫、第 55 支炸 ⇒ 帳本 **54** 筆、失敗那支 **0** 筆。
⇒ **中途失敗 = 前面的東西已經在庫裡了**,不會因為後面炸而一起退回。

**③ 重跑從失敗那支續跑,已記帳的一支都不重跑**
原封再推:`Applying migration` 出現 **1** 次、帳本仍 **54**。
⇒ 🔴 **「不帶 `IF NOT EXISTS` 的 migration 重跑會不會炸」的答案是:不會** —— 它根本不會被再執行到。

**④ 一支跑到一半失敗 ⇒ 整支回滾,不留半成品**
構造(`CREATE TABLE` → `CREATE INDEX` → `SELECT 1/0`):那張表**不存在**(0),
而前一支建的表**在**(1,**正向對照** —— 證明這把尺量得到「存在」)。
⇒ 失敗的 migration 不留殘留 ⇒ 重跑不會撞到自己上一次的半成品。

**⑤ 帳本裡有一支本機目錄沒有的版本 ⇒ 整發拒絕、一支都不推(fail-closed)**
```
Remote migration versions not found in local migrations directory.
修復(已彩排,rc=0):supabase migration repair --status reverted <version> --db-url <本機>
```
📎 與 memory `reference_quote-repo-migration-ledger-desync`(報價單 repo 本地 146 檔 vs ledger 160 筆)
**是同一個機制** —— 那條現在有可重跑的量法了。

**⑥ 從零重放全部歷史【這條路不通】**
`db push --include-all` 到空庫在第 55 支就炸(缺 `product_fitments_effective`)。
⇒ 要彩排「推 N 支上去」,做法是**只把那 N 支放進一個乾淨目錄**,前置表逐字從 repo 的 migration 取(見 §2)。

**⑦ 🔴 時間戳【插隊】的那一支:不加旗標會擋住全隊;加了 `--include-all` 則【執行順序與檔名順序不一致】**
(2026-08-18 G6 量,CLI `2.98.1`;測資=三支各自把自己的名字寫進一張 `exec_log`,`serial id` 就是真實執行序)
```
先推 A(…000000) 與 C(…000002) ⇒ exec_log = 1 A / 2 C
再放進 B(…000001) —— 時間戳【夾在 A 與 C 之間】

不加 --include-all ⇒ rc=1
   "Found local migration files to be inserted before the last migration on remote database."
   ⇒ 它**失敗、指名那支檔、並告訴你要加哪個旗標** —— 不會安靜地跳過它

加 --include-all   ⇒ rc=0,只跑 B 一支(A 與 C **沒有**重跑)
   🔴 執行順序:1 A → 2 C → **3 B**            ← B 最後才跑
   🔴 帳本(按 version 排序印出來):000000 / **000001** / 000002   ← B 看起來在中間
```
⇒ **帳本順序(按檔名)與實際執行順序【永久不一致】**,而 `schema_migrations` 只有 version、
**沒有任何欄位記著真實順序** ⇒ **下一個人讀檔名推不出執行順序。**
🔴 **而危險的不是「它會炸」,是【它不炸】**:`rc=0`、`Finished`、帳本看起來整齊。
   若那支 SQL 依賴後面某支建的東西 ⇒ 會炸(**那反而是好的**);不依賴 ⇒ 靜靜留下一個永久錯位的帳本。
📌 對照:草稿檔搬進 `supabase/migrations/` 之前先看**目前最大的版本號**
   (`ls -1 supabase/migrations/*.sql | sed 's#.*/##; s/_.*//' | sort | tail -1`),
   命名排在它之後 ⇒ 只有「會被一起推」的問題;排在它之前 ⇒ **會擋住所有人的 `db push`。**

**🔴 兩件本節【沒有】驗到的(不要當成已驗)**
```
· #628「記帳被拒」：本機你是 superuser ⇒ 帳本 INSERT 當然過。**對它零判別力。**
· 你彩排的是【已 commit 的那份】。主樹工作檔可能是別人未 commit 的 WIP
  —— 2026-08-18 實例：同一支 dev 上 205 行、主樹 287 行，差的那段有一個 trigger 函式。
  ⇒ **先 `git show dev:<path> | wc -l` 跟工作檔對一次**，否則你會把「那份沒有那段」報成「apply 少建了東西」。
```

## 5. ⚠️ 本機效度限制(必讀,否則會下錯結論)

🔴 **`pg_trgm` 在 macOS 對中文抽零 trigram**(memory `reference_pg-trgm-cjk-zero-on-macos-libc`)。
**2026-08-16 本機實測**:
```
extensions.show_trgm('abcdef')  ⇒ 7      ← 正向對照
extensions.show_trgm('王小明')  ⇒ 0      ← 抽零,實錘成立
```
**但適用範圍要分清楚(2026-08-16 E 窗實測後縮小)**:
| 查詢形狀 | 抽零的後果 |
|---|---|
| trgm 相似度運算子(`%` / `<%` / `similarity()`) | 🔴 **正確性壞掉** —— 本機結果不可信 |
| `LIKE '%…%'`(trgm GIN 只當索引加速) | ✅ **只是走全表掃,結果仍正確** |

**實測佐證**:`#525` 三軸全走 `LIKE … ESCAPE '\'`,而 `admin_search_customers('王小明',100)` **正確回 1 筆**,
即使 `show_trgm('王小明')` 是 0。
⇒ **「斷言索引真的被用到」(EXPLAIN 類)在本機無判別力;「斷言索引存在且是 trgm」不受影響。**

## 6. 收攤(逐 PID 驗,不看指令回傳)

```bash
pgrep -f "postgrest $D/prest.conf" | while read p; do kill "$p"; done   # 🔴 帶 $D:別殺到別的窗的
pg_ctl -D "$D/data" stop -m fast
# 🔴 驗【世界的狀態】不是【動作的回傳值】
pgrep -f "postgrest $D/prest.conf" | wc -l     # 期望 0
pgrep -f "postgres.*$PORT"        | wc -l     # 期望 0
curl -s -m 2 -o /dev/null -w "%{http_code}\n" http://127.0.0.1:$RPORT/ # 期望 000(連不上)
rm -rf "$D" && { test -d "$D" && echo "🔴 沒刪掉" || echo "✅ 已刪"; }
# 🔴 收攤【一定要做】:$D 留著,下一個用同一個 WIN 的人會被 §1 那道「目錄已存在」擋下來
git -C <你的 worktree> status --porcelain --untracked-files=all   # 期望零行
```

---

**維護**:本檔由實跑產生。**改它之前先跑一次** —— 指令過期比沒有 runbook 更糟。
