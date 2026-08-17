# V-036 — P1+P6 字面綁定測試 · 規格(主視窗裁定:V 窗出規格、實作歸施工窗)

- **窗**:V(`pcm-website-v2-90`)　**時戳**:`date` 實跑 2026-08-17(落筆當場)
- **要修的病**(V-028 P1、V-035 P6 同族):SQL 判定式與 TS 判定式是同一事實的兩份實作,**任一半被改=零機械訊號**。手法先例=`#606` 的 readFileSync 文字層測試(不 import 型別,不被 A2 的型別雞生蛋鎖住)。

---

## §0 🔴 承重牆:活體定位,不得硬編檔名

**本規格寫作當天我自己差點踩**:P1 的 SQL 我先讀了 `20260814140000`(舊分母 `oi.quantity`)、差點報「現行分歧」——實際 live 是 `20260816050000`(#522 分母已修)。**綁錯層的測試會恆綠地守一個死檔。**

程序(測試 setup 內做,不是人工指定):
1. glob `supabase/migrations/*.sql`,grep 定義目標物件的檔(P1=`CREATE OR REPLACE VIEW public.admin_order_list_v`;P6=`CREATE OR REPLACE FUNCTION public.search_products_by_vehicle`)。
2. **取字典序最大**的那支綁定;斷言候選清單本身(找到幾支、最新是哪支)——**新 migration 重定義該物件時,這格要紅**,提醒把綁定跟上。
3. 失敗訊息必含:綁定的檔名+對側檔名+一句「改了哪半就要同步哪半、並更新本測試的期待值」。

## §1 P1 格:貨品軸判序(SQL CASE ↔ `goodsAxisOfLines`)

- **SQL 側 anchor**(今天=`20260816050000:85-`):斷言 ①判定出現順序=空單早退(`NOT EXISTS`)→ `'shipped'` → `'instock'` → `'ordered'` ②分母字面 `GREATEST(oi.quantity - COALESCE(s.cancelled_quantity, 0), 0)` 存在於**每一個** bool_and 判定(只驗一處,另兩處改了不紅)。
- **TS 側 anchor**(`apps/admin/src/lib/orders/order-status-axes.ts:288-290`):三行 `if (lines.every(...))` 的 return 順序=`'shipped'`→`'instock'`→`'ordered'`,且三行分母皆呼 `lineNeed(`;`:244` 空 lines 早退 `'none'`。
- **綁定斷言**:兩側抽出的判序 token 序列相等(`['none','shipped','instock','ordered']`)——不逐 byte 比(語言不同),比**序列**與**分母含 cancelled 語意**。

## §2 P6 格:年份公式(RPC ↔ `matchFitmentYear`)

**兩格互補,建議都做:**

1. **字面格**(抓「誰動了檔」):
   - SQL 側(今天=`20260712213000`,照 §0 定位):`(year_start IS NULL OR year_start <= p_year)` 與 `(year_end IS NULL OR year_end >= p_year)` **在兩個 UNION 半各出現一次**(共 4 個斷言——只驗一半,effective 那半改了不紅)。
   - TS 側(`packages/domain/src/catalog/year-range.ts`):`if (yearEnd === null) return Infinity;` 與 `actual.yearStart <= specEnd && spec.yearStart <= actualEnd` 存在。
2. **真值表格**(抓語意漂,獨立於字面):測試檔內把 SQL 公式直譯成 ~10 行 JS(`(ys===null||ys<=y)&&(ye===null||ye>=y)`),與 `matchFitmentYear({yearStart:ys??undefined, yearEnd:ye}, {yearStart:y, yearEnd:y})` 對打全組合真值表:ys/ye ∈ {null, 2018, 2020, 2022} × y ∈ {2017, 2018, 2020, 2022, 2023},含邊界 `==` 與開放式。⚠️ 組合須排除 `(null, 非null)`(DB CHECK 排除的形狀)——**並把「為什麼排除」寫進測試註解引 CHECK 行號**,這樣放寬 CHECK 的人 grep 得到自己。

- **前提 CHECK 綁定**:斷言 `20260708130000:33` 的 `year_state_valid` 字面仍在。🔴 **寫明缺口**:`product_fitments_effective` 的同款 CHECK 出生在 migrations ledger 外(`docs/archive/…/2026-07-12-s1-apply-sql.sql:76`,archive=死字面,綁它無意義)⇒ **repo 測試驗不到 production 那條 constraint 還在**;補法=在既有 preflight 類腳本加 `information_schema.check_constraints` 探針(要不要做歸排片的人,本規格只標缺口)。

## §3 🔴 雙世界驗法(交付驗收,不是可選)

實作者交付時要附一次跑過的紀錄(哪怕只是貼終端輸出):
1. 現樹跑 → **必綠**(該綠世界)。
2. `cp` 備份 → Edit 突變**被綁定那半**各一發:P1=把 SQL 兩個 WHEN 對調(或 TS 兩行 if 對調);P6=SQL 一處 `<=` 改 `<`(以及 TS `Infinity` 行刪掉)→ 跑 → **必紅且訊息指向被改的那個檔** → `cp` 還原 → 復綠。
3. 🔴 還原**只准 `cp`/Edit 精確還原,不准 `git checkout`**(B-579 §3-3:會把突變與實作一起收掉,產生假紅)。
4. SQL 側、TS 側**各至少一發**——證明兩個方向都有判別力,不是單向恆綠。

## §4 放哪、跑多快

- 位置:`scripts/*.test.ts` 慣例(與 `#606` 手法同窩);純 readFileSync+字串處理,零 DB、零網路,vitest 毫秒級,進三綠不加負擔。
- 動 `.ts` ⇒ 三綠含 build 照鐵則 11;片型=輕量片(純測試補齊)——但因它讀 `supabase/migrations`,**動那兩支 migration 的未來片會被它紅到,那正是它的用途**。

— END V-036 —
