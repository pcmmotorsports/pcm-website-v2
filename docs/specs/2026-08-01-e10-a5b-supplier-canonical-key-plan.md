# 🛑 已作廢 — A5b 供應商正規化 SQL 函式 片級 plan v3(2026-08-01)

> **2026-08-01 當日 SUPERSEDED,本片不施工。** Sean 拍板:供應商改「**主檔 + 下拉選單**」
> (可新增、可改名、**不可刪除**),不再讓員工手打自由文字 ⇒ **A5b 與 A5c 一併砍掉**。
> 現行權威 = memory `project_m4b-supplier-master-decisions`;新 plan 另開檔。
>
> **為什麼保留本檔不刪**:①§2 的 14 條 PG/Unicode 實測(NFKC 折疊、collation 釘死、
> `normalize` 語法糖、inline 與 proconfig)**與形狀無關、可直接重用** —— 新主檔若要對名稱做
> 唯一性歸一,同一批坑會原封不動再出現一次 ②§10 的三輪審查處置表是 37 條 findings 的唯一紀錄
> ③本檔本身就是「三輪審查把一個片打回框架層」的完整證據。
>
> 🔴 **本檔 §9 的連動落檔清單不得照做** —— R3 F13 已證明其中「master 四行 A7b-T 機械換成 A7c」
> 會產出假句並抹掉一筆 Sean 拍板紀錄;那批 master 修正改由退款線自己處理,見新 plan。

---

# (以下為作廢內容,備查)

# A5b 供應商正規化 SQL 函式 — 片級 plan **v3**(2026-08-01)

> 片號 = E10 第 1 批 **A5b**(master `docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md` §5.1 row 27)。
> 片型 = **高風險**(鐵則 12 ③)⇒ 關卡1/2 不降級。估時 30-40 分鐘(不含審查)。
>
> **審查軌跡**:v1 → codex K1 **R1 NO-GO(14 must-fix + 2 nit)** → v2 →
> codex K1 **R2 NO-GO(13 must-fix + 2 nit)** → 本 v3。**兩輪共 27 must-fix,逐條親驗全成立、駁回 0。**
> 🔴 **R2 的 findings 絕大多數是 v2 修 R1 時自己開的洞** —— 本 repo 的主流失敗模式,第 N 次重現。
> ~~v1 / v2 作廢~~。處置總表見 §10。

---

## §1 目標與範圍

建 `public.pcm_supplier_canonical_key(text)`:把員工手打的供應商名折成**比對用的鍵**,
顯示一律用原值 `supplier_name`。
**不做**:相似度比對(A5c)/ 接上寫入路徑(A5a)/ 回填(§2-12 實測:目標表 0 列)。

---

## §2 實測事實(正式站唯讀 + 本機 PG17 隔離庫;每條都是自己跑的)

| # | 實測 | 結果 | 影響 |
|---|---|---|---|
| 1 | 正式站 | PG **17.6** / collation `en_US.UTF-8` | — |
| 2 | `normalize(x,'NFKC')` | 全半形英數 + U+3000 + NBSP 全折平 | 🔴 偵察 subagent 說「PG 無法原生做全半形折疊」是**錯的** ⇒ 不需自建對照表 |
| 3 | `pg_catalog.normalize(x, NFKC)` | `ERROR 42703: column "nfkc" does not exist` | `NFKC` 是文法糖 ⇒ 第二參數傳字串 `'NFKC'` |
| 4 | 頭尾 tab / 換行 | v1 管線輸出 `[ rpm racing ]` | `btrim(x)` 單參數只剝 U+0020 ⇒ **btrim 排最後** |
| 5 | `lower('IZMIR' COLLATE "tr-TR-x-icu")` | `ızmır`(≠ `izmir`);土耳其 collation **已裝 3 個** | 同名產生兩個 key ⇒ **必須釘死 collation** |
| 6 | `lower('ÄÖÜ' COLLATE "C")` | `ÄÖÜ`(不轉) | 釘 `C` 會讓德文法文壞掉 |
| 7 | 五案 collation 對照 | **`und-x-icu` 與 DB 預設 5/5 全等**;`ucs_basic` 德法失敗 | ⇒ 釘 `und-x-icu` |
| 8 | translate 在 NFKC 前 vs 後 | 5 案全等 | v1「順序不可換」是**假論證**,已刪 |
| 9 | NFKC 生出空白 | `normalize('¨','NFKC')` = 空格 + U+0308 | 收斂與 btrim 都在其後 ⇒ 吃得掉 |
| 10 | 🔴 `¨` 單獨輸入 | 最終 key = **單獨一個組合用符號**(len 1、非空) | **K2 #13**:能通過 A2 的非空 CHECK ⇒ 幾乎不可用的鍵。見 §8 |
| 11 | `standard_conforming_strings` | `on` | `U&'…'` 安全 ⇒ 轉為驗收條目 |
| 12 | 目標表列數 | `order_item_procurement` **0** / `_receipts` **0** | 無回填。(v1 引 A7c 交接檔是**引錯表**,已換本查) |
| 13 | 🔴 SQL 函式帶 `SET search_path` 是否被 inline | **不會**(EXPLAIN 顯示函式名未展開;不帶 proconfig 者展開成 `lower()`) | **K2 #11**:v2 的「改 plpgsql 會失去 inline」是**我編的、不存在的取捨** ⇒ D1 理由重寫 |
| 14 | master 提 `A7b-T` 的行 | **247 / 248 / 305 / 356 共 4 行** | **K2 #3**:v2 只列 247 ⇒ 「只補摸過的那幾行」復發 |

---

## §3 函式定義

```sql
CREATE OR REPLACE FUNCTION public.pcm_supplier_canonical_key(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = ''
AS $$
  SELECT pg_catalog.btrim(
           pg_catalog.regexp_replace(
             pg_catalog.lower(
               pg_catalog.normalize(
                 pg_catalog.translate(p_name, U&'\200B\200C\200D\FEFF', ''),
                 'NFKC')
               COLLATE "und-x-icu"),
             '[ \t\n\r\f\v]+', ' ', 'g'))
$$;

REVOKE ALL ON FUNCTION public.pcm_supplier_canonical_key(text)
  FROM PUBLIC, anon, authenticated, service_role, payment_confirmer;
```

管線 = **translate → normalize('NFKC') → lower(釘 `und-x-icu`) → 收斂 → btrim**。

🔴 **migration 骨架必須含**(**K2 #5**;依 Sean 07-29 D0-1=A「全 repo migration 一律顯式 BEGIN/COMMIT」,
且 `SET LOCAL` 需要交易邊界才有意義):顯式 `BEGIN; … COMMIT;` +
`SET LOCAL lock_timeout` + `SET LOCAL statement_timeout`,與既有 40 餘支同款。
**不得「順手改成更好的寫法」**(D0-1 連動紀律)。

---

## §4 決策點

**D1 — 正規化後為空(或退化)時回傳該值,不 RAISE。**
🔴 **v2 的理由(「plpgsql 會失去 inline」)已由 §2-13 實測證偽,不得再引用。**
**正確理由**:canonical key 函式應該是**全函式(total)** —— 會 RAISE 的部分函式無法用在
CHECK、索引運算式或批次回填裡而不特例處理;而使用者面的驗證有完整上下文,屬 A5a。
⇒ **代價寫進 §9-4:A5a 必須前置拒收**「NULL / 正規化後為空 / 正規化後只剩組合用符號」三種輸入
(**K2 #10 + #13**),否則錯誤會以 A2 的 `23514` / `23502` 形式漏給員工。

**D2 — 空白收斂用明列碼位 `[ \t\n\r\f\v]`。**
🔴 **v2 給的理由(「regex 段仍受 locale 影響」)是假的**(**K2 #15**:此式只列六個確切 ASCII 碼位,
無 POSIX class、無 range、無 case folding ⇒ 構造不出 locale 反例)。
**保留寫法、改正理由** = 與 A7 的既有決定一致、且未來若有人改寫成 `[[:space:]]` 會立刻回到 #305 的風險面。

**D3 — ACL 收 `PUBLIC, anon, authenticated, service_role, payment_confirmer`。**
偏離 master row 27 字面(原僅三者)⇒ **§9-2 已回寫 master**,不由片級 plan 自批。

**D4 — NFKC 額外折疊語意:✅ Sean 2026-08-01 拍板 A(全折疊)。**
逐字:「**A 是的,出現也必然是對的**」⇒ `①Moto`=`1Moto`、`㈱RPM`=`(株)RPM`、`ﬁrst`=`first`、`ﾊﾞｲｸ`=`バイク`
一律視為同一家。落檔 = memory `project_m4b-a5b-canonical-key-decisions`。
🔴 **K2 #2 的兩處矛盾已消除**:v2 同時寫「開工前需答」與「開工不擋」⇒ 現已拍板,兩句都刪;
且原本「答案不同只改 harness 不改函式」的說法**本來就無效**(收窄必須改函式),一併刪除。

---

## §5 驗收條件(全部由 `scripts/a5b-verify.sh` 機器判定)

1. `prokind='f'` / `provolatile='i'` / `proisstrict=true` / `prosecdef=false`。
2. `proconfig` 含 `search_path=`。
3. 🔴 **ACL:先斷言 `proacl IS NOT NULL`,再驗 `aclexplode` grantee 集合恰等於 `{owner}`**
   (**K2 #6**;前例 `scripts/a7bt-acl-rollback-lock.sh:129` 逐字記載 `proacl IS NULL` 曾是假綠 ——
   NULL 語意是「PUBLIC 有 EXECUTE」= 最寬鬆,而 `aclexplode(NULL)` 回零列 ⇒ 讀成「只有 owner」)。
   **誠實邊界**(**K2 #7**):此檢查只證明**直接 ACL**;`GRANT owner_role TO x` 這類 role membership
   不改 `proacl` 卻可能讓 x 取得權限 ⇒ 驗收文字**不得寫「任何新角色都會轉紅」**。
4. 正向表:§7 逐筆相等。
5. 等價類:同一家的多種寫法 key 全等。
6. **不可誤併**:`RPM Racing` vs `RPM Racing 2` / `Café` vs `Cafe` / `İSTANBUL` vs `ISTANBUL` 三組 key 不等。
   🔴 **ZWJ 那組移出本條**(**K2 #1**:v2 的驗收 6 要求 ZWJ 兩串「必須不等」,但案例 14 明訂兩者皆為 `ab`
   —— **plan 自相矛盾**)。ZWJ 改列 §7 案例 14 的**已知合併**,由 §8 揭露。
7. 🔴 **collation 釘死的證明**:以 **`IZMIR Moto`**(**K2 #8**:必須用在土耳其 collation 下會分歧的向量;
   v2 只寫「同一輸入」,實作者若用 `RPM Racing` 則三種 collation 本來就同輸出 ⇒ 移除 pin 仍全綠)
   分別以 `COLLATE "tr-TR-x-icu"` / `"ucs_basic"` / DB 預設傳入,三者輸出必須相同。
8. `standard_conforming_strings = on` 前置斷言,不成立即 abort。
9. 🔴 **§9 的三項權威更新要有機器驗收**(**K2 #4**:v2 十條驗收無一核對它們 ⇒ 刪掉三項更新仍全綠):
   ①A2 COLUMN COMMENT 逐字含新順序 ②master 4 行 A7b-T 字面**零殘留**(`grep -c` = 0)
   ③master row 27 的 ACL 字面含 `payment_confirmer`。
10. **突變證明**,兩層:
    - **整段移除**五段各一(translate / normalize / lower / 收斂 / btrim)+ **移除 `COLLATE`** 第六個。
    - 🔴 **集合內局部退化**(**K2 #9**:v2 只做整段移除 ⇒ 把 translate 集合刪掉 `U+200C`/`U+FEFF`、
      或把 regex 刪掉 `\r`/`\f`/`\v`,§7 全部案例仍綠)⇒ **translate 四碼位、regex 六碼位各一個逐碼位案例**,
      每個碼位單獨刪掉必須有對應案例轉紅。
    - 判準:**該 mutant 至少讓它的指定案例轉紅**;逐 mutant 記錄實際轉紅集合,**不宣稱一對一**(K1 #9)。
11. 零留痕 + 三綠。

---

## §6 施工步驟

1. ✅ 隔離庫已備(`/tmp/a5b-work`,全既有 migration 已套)。
2. migration `20260801130000_m4b_e10_a5b_supplier_canonical_key.sql`(§3 骨架 + §9-1/-3 的更正句 + 檔內結構驗收)。
3. `scripts/a5b-verify.sh`(§5 十一條 + §7 案例 + §5-10 兩層突變)。
4. 全綠 + 所有 mutant 各自轉紅。
5. 三綠 → code-reviewer(opus)→ **R3 換模型換角度(Fable)** → 關卡2 codex 審 diff。
6. commit(精準 add + STATUS 七欄)、**不 apply、不 push**。

---

## §7 harness 案例表

| # | 輸入 | 期望 key | 釘住 |
|---|---|---|---|
| 1 | `RPM Racing` | `rpm racing` | baseline |
| 2 | `ＲＰＭ　Ｒａｃｉｎｇ` | `rpm racing` | normalize |
| 3 | `  RPM   Racing  ` | `rpm racing` | 收斂 + btrim |
| 4 | `RPM RACING` | `rpm racing` | lower |
| 5 | `RPM<ZWSP>Racing` | `rpmracing` | translate U+200B |
| 6 | 🆕 `RPM<ZWNJ>Racing` / `RPM<ZWJ>Racing` / `RPM<BOM>Racing` | 皆 `rpmracing` | **逐碼位**(§5-10 局部退化) |
| 7 | `ＲＰＭ１２３` | `rpm123` | 全形英數 |
| 8 | `RPM<TAB>Racing` | `rpm racing` | 中間 tab |
| 9 | `<TAB>RPM Racing<TAB>` / `<LF>…<LF>` | `rpm racing` | **K1 #3 的捕手** |
| 10 | 🆕 `RPM<CR>Racing` / `<FF>` / `<VT>` | 皆 `rpm racing` | **逐碼位**(regex 六碼位) |
| 11 | `¨RPM` | `̈rpm`(len 4) | NFKC 生出的空白被吃掉 |
| 12 | 🆕 `¨` 單獨 | 單一組合用符號(len 1) | §2-10 的退化鍵,**釘住現況並由 §8 揭露** |
| 13 | `ﾊﾞｲｸ ﾊﾟｰﾂ` | `バイク パーツ` | 半形片假名 |
| 14 | `Café` vs `Cafe` | 不等 | 不可誤併 |
| 15 | `İSTANBUL Moto` | `i̇stanbul moto` | 不與 `ISTANBUL` 併 |
| 16 | `A<ZWJ>B` vs `AB` | **皆 `ab`(已知合併)** | §8 揭露,**非**「不可誤併」 |
| 17 | `①Moto` / `㈱RPM` / `ﬁrst` | `1moto` / `(株)rpm` / `first` | D4=A 的語意 |
| 18 | `   ` / `NULL` | `` / `NULL` | D1 / STRICT |
| 19 | `IZMIR Moto` × 三種 collation | 三者相等 | 驗收 7 |

---

## §8 誠實邊界

- 🔴 **ICU 版本升級會讓 stored key 漂移,而風險不只 expression index**(**K2 #12**):
  A2 的 `supplier_canonical_key` 是**存下來的值**且帶 `UNIQUE (order_item_id, supplier_canonical_key)`
  ⇒ 升級前後兩套結果會**同時存在表內**,同一家供應商因此避開去重。
  ⇒ **A5a 上線前必須有 collation-version 監看 + 重算策略**(§9-4);本片只建函式、不解此題,
  但**不得寫成「已解決」**。同理**不得對本函式建 expression index**。
- 🔴 **`IMMUTABLE` 是宣告不是證明**。驗收 7 只證明「不隨引數 collation 漂移」。
- 🔴 **退化鍵**(§2-10):`¨` 這類輸入產出單一組合用符號,通過 A2 非空 CHECK 但實務上不可用 ⇒ D1 的代價,由 A5a 擋。
- 🔴 **刪 U+200C/U+200D 會合併不同字串**:它們是 ZWNJ/ZWJ,在波斯文正字與 emoji 序列帶語意。
  對拉丁/日文供應商名無影響;案例 16 是這條的紀錄。A3 那套碼位表是為「判斷內容是否為空」設計的,
  **不自動證成 canonical-key 的合併規則**。
- **ACL 驗收只涵蓋直接授權**,不涵蓋 role membership 繼承(**K2 #7**)。
- **隔離庫 C locale ≠ 正式站 en_US.UTF-8**(#305);釘 `und-x-icu` 讓 `lower()` 免疫,regex 段用明列碼位。
- **零業務資料列寫入**(`CREATE FUNCTION` / `REVOKE` / `COMMENT` 仍寫 system catalog)。零 TapPay 接觸面。

---

## §9 連動落檔(必須與本片同 commit)

| # | 位置 | 動作 |
|---|---|---|
| 1 | master **`:247` `:248` `:305` `:356`** 四行的 `A7b-T` 字面 | 改為 A7c(**K2 #3**:v2 只列 `:247`)。驗收 9-② 用 `grep -c` 釘死零殘留 |
| 2 | master row 27(`:358`) | 演算法順序改為「剝零寬 → NFKC → lower(釘 `und-x-icu`)→ 收斂 → trim」;ACL 補 `service_role, payment_confirmer` |
| 3 | A2 的 COLUMN COMMENT(已 apply) | 由本片 migration 一句 `COMMENT ON COLUMN` 就地更正。**慣例已確認**:A1 的 `20260730150000:165` 有同款前例,且無既有結構驗收釘死舊 COMMENT(K2 未擊破段落逐字確認) |
| 4 | master row 32(A5a,`:375`) | 🆕 補 A5a 的兩項契約債(**K2 #10 / #12**):①前置拒收 NULL / 空 / 退化鍵 ②collation-version 監看與重算策略 |

🔴 **為什麼規格字面的順序是錯的**:規格寫 **trim 先**,而 `btrim` 剝的是 U+0020 ——
**全形空白 U+3000 要等 NFKC 才變成 U+0020** ⇒ 照字面實作,`　RPM　` 的外層空白 trim 吃不到。
**v1 說「步驟已鎖死、不可偏離」是錯的宣稱** —— 我實際上已偏離卻寫成沒偏離。

---

## §10 findings 處置(R1 14+2、R2 13+2,**全成立、駁回 0**)

**R2 逐條**:#1 ZWJ 驗收自相矛盾→§5-6 移出 / #2 D4 兩處互斥→已拍板兩句皆刪 /
#3 master 漏三行→§9-1 + 驗收 9-② / #4 §9 無機器驗收→驗收 9 /
#5 migration 缺交易骨架→§3 / #6 `proacl IS NULL` 假綠→驗收 3 /
#7(nit)繼承授權→§5-3 + §8 措辭 / #8 collation mutant 未鎖向量→驗收 7 改用 `IZMIR Moto` /
#9 局部退化測不到→§5-10 兩層 + §7-6/-10 / #10 D1 代價未落契約→§9-4 /
#11 inline 取捨不存在→§2-13 實測 + D1 理由重寫 / #12 ICU 漂移不只 index→§8 + §9-4 /
#13 退化鍵→§2-10 + §7-12 + §8 / #14 rollback 不完整→§11 / #15(nit)D2 理由假→D2 改正理由。

**R1 逐條**:見 v2 §10(全數仍在 v3 生效);其中 #2 #3 #14 是主對話在 codex 回覆前自行實測抓到。

**codex 明說未擊破**:`COLLATE` 確實綁在 `normalize()` 結果即 `lower()` 的輸入、內層 explicit COLLATE
蓋過呼叫端 / 固定 ICU 版本下 explicit COLLATE 不破壞 IMMUTABLE 標記 /
用新 migration 改已套用的 COMMENT 安全且符合慣例(A1 有前例)/ `STRICT` 正確 / 無死碼。

---

## §11 rollback(**K2 #14**:v2 說「單句可退」不成立,本片還改了 A2 的 COMMENT)

```sql
BEGIN;
COMMENT ON COLUMN public.order_item_procurement.supplier_canonical_key IS
  '<A2 原字面,施工時從 20260729020000:120-121 逐字複製>';
DROP FUNCTION IF EXISTS public.pcm_supplier_canonical_key(text);
COMMIT;
```
🔴 **順序不可換**:先還原 COMMENT 再 DROP,否則中途失敗會留下「指向已刪函式的 COMMENT」。
🔴 master 的四處文字更正**不由 SQL rollback 涵蓋**,需 `git revert`。
🔴 **A5a 上線後本段失效**(RPC 會依賴此函式),屆時 rollback 要連 A5a 一起。

— END —
