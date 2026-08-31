# Plan · ⟦b4-SPEC1⟧ 手動建單的規格快照 —— **DB 那一側沒有守**

> 量測 **2026-08-31 13:28:42**(`date` 當場印)· 樹 `/Users/sean_1/pcm-website-v2` · dev @ `be3b62a8`
> 提案人 = 線 DB `[6cdb1c]` · 收件 = 主視窗 `[16689c]` → Sean
> 🛑 **未經批准, 我不動任何一行。**

---

## 0. 先做兩道規定動作, 而其中一道翻出板子引錯了代

### row-evidence:那一列的四格事實**全部仍然成立**(我逐格獨立複驗, 不是抄轉述)
```
① manual-order-lines.tsx:32  「`line_spec` 沒有畫面入口…⇒ 送空字串」命中 1
   🔵 正對照 同檔 line_spec ⇒ 1 · 🔵 負對照現造字面 ⇒ 0
② 284ee4cf 動的檔:supabase/ 底下 **0 支**(只有 manual-order-repository.ts + 它的測試)
   ⇒ 修法整個在應用層 —— 板子這一格是對的
③ RPC `v_spec := COALESCE(v_line -> 'spec', '{}'::jsonb)` 在 `:369`(第 1 代)
④ repository:265 `l.variant_id === null ? l : { …l, spec: bySpec.get(…) }` 在
```

### before-asking-sean:五段**全零**
```
① 有人 commit 做掉了 ② Sean 答過了(決策板/板子/memory)③ 碼註解 ④ COMMENT ON ⑤ 就地訂正
⇒ 五段皆零命中
```
⚠️ 而該工具自己印的射程照抄不放寬:**五段全零 = 「這五段掃過的地方沒有」, 不是「沒有人答過」** ——
它掃不到別的 session 的對話 / 正式庫現況 / OD 稿。

### 🔴 而規定動作之外我多跑一發, 它翻出板子引錯了代
`bash scripts/latest-definition-of.sh admin_create_manual_order`:
```
20260824020000  已記  create              ← 帳本上最後一支已記的(live)
20260829140000  未記  CREATE OR REPLACE   ← repo 裡最後一代(newest)
🔴 newest ≠ live
```
⇒ **板子 `:488` 引的是第 1 代 `20260824020000:369`** —— 而 repo 裡已經有第 2 代。
✅ 我開第 2 代核過, **結論不變、而座標要換**:
```
20260829140000:280  v_spec := COALESCE(v_line -> 'spec', '{}'::jsonb);   ← 一模一樣
第 2 代查 product_variants ⇒ 0 處(🔵 正對照 同檔 order_items ⇒ 5)⇒ 仍然不查權威 spec
帳本 20260829140000 ⇒ 0 列(🔵 正對照 20260824020000 ⇒ 1)⇒ **它未 apply**
```
📌 **⇒ 缺口在最新那一代仍然在, 而板子的證據句指著一份已經被取代的定義。**
**⇒ 而【指錯代】與【指對代】這一次印同一個答案 —— 兩代那一行逐字相同。**
🛑 **要寫 `CREATE OR REPLACE` 一律從 `20260829140000` 抄, 不是從板子引的那一支。**

---

## 1. 要改什麼

**已裁的修法(主視窗 2026-08-24)= 乙:server 依 `variant_id` 取權威 spec。**
應用層那一半 `284ee4cf` 已經做了;**本片是 DB 那一半**。

RPC 現在對 `spec` 做的是**形狀驗證**, 不是**來源驗證**:
```
:280  v_spec := COALESCE(v_line -> 'spec', '{}'::jsonb)    ← 信呼叫端送的
:281  jsonb_typeof(v_spec) = 'object'                       ← 是不是物件
:290  m3_jsonb_values_all_string(v_spec)                    ← 值全是字串
:294  NOT (v_spec ?| ARRAY['price_store','price_by_tier','cost'])  ← 不得含價格欄
:301  兩側 btrim 正規化
🔴 ⇒ 五道全部在問「這份 spec 長得對不對」, 沒有一道問「這份 spec 是不是【那個 variant 的】」。
```
⇒ **要加的是第六道**:`v_variant_id IS NOT NULL` 時, **從權威來源取 spec、覆蓋呼叫端送的那一份**。

### ✅ 權威 spec 住在哪 —— **追到了**(原本被我誤標成決策題, 見 §6 Q1)
```
public.product_variants.spec   (jsonb NOT NULL DEFAULT '{}')
```
逐層追法(每層附座標):
```
1 manual-order-repository.ts:251-254  bySpec = new Map(); bySpec.set(norm(row.id), row.spec)
2 manual-order-repository.ts:233-236  createSupabaseServiceClient().from('product_variants')
                                        .select('id, spec').in('id', ids)
3 20260531142533_init_product_variants.sql:43  spec jsonb NOT NULL DEFAULT '{}'
                                        :62  CONSTRAINT pv_spec_is_object CHECK (jsonb_typeof(spec)='object')
                                        :40  id uuid PRIMARY KEY  ⇒ 一個 variant 恰一份 spec ✅
🔵 正對照 同檔另一個已知欄 images ⇒ 2 · 🔵 負對照 現造欄名 zzq_spec_20260831 ⇒ 0
🔵 第二把尺:有沒有 ALTER 動過這一欄 ⇒ 印 0 行(沒有)
```
⇒ **所以 RPC 那一道要做的就是**:`v_variant_id IS NOT NULL` 時
`SELECT spec FROM public.product_variants WHERE id = v_variant_id`,**覆蓋**呼叫端送的那一份。
⚠️ 而 `SET search_path = ''` ⇒ 表名必須寫全 `public.product_variants`。

---

## 2. 片型:🔴 **高風險片**(而我是開 diff 與開檔判的, 不是從題目那行字判)

主視窗提醒「不要從題目那一行字判片型」。我逐條對鐵則 12 六類:
| 類 | 命中? | 依據 |
|---|---|---|
| ①錢 order/payment | ✅ | 它寫的是**訂單品項快照**, 而快照是退款分母的一部分 |
| ②權限 | ✅ | `SECURITY DEFINER` + `search_path=''` + 兩道 REVOKE + service_role only |
| ③schema/migration | ✅ | 一支新的 `CREATE OR REPLACE` migration |
| ④平台設定 | ❌ | 不動 env / CI / next.config |
| ⑤對外不可回收 | ❌ | 不寄信、不對外發布 |
| ⑥packages/ui | ❌ | 不動共用元件 |
⇒ **三類命中 ⇒ 高風險片, codex 對抗審查不降級**(由本窗自己跑)。

---

## 3. 爆炸半徑

```
要動的:1 支新 migration(CREATE OR REPLACE 整個函式本體)
       + 可能 1 支測試(見 §5)
       + APPLIED.tsv 一列(apply 之後)+ order-state-gates.md 重產
呼叫端:apps/admin/src/lib/orders/manual-order-repository.ts:283
       (走 createSupabaseServiceClient ⇒ service_role)
       🔵 正對照 同尺查 admin_initiate_order_refund ⇒ 6 支檔 · 🔵 負對照現造 ⇒ 0
```
**壞掉會怎樣**
- 取錯 spec ⇒ 客人訂單明細上的顏色/尺寸**是別的品項的** —— 比空白更糟, 因為它看起來是對的。
- 取不到而 RAISE ⇒ **員工建不了單**(而手動建單是「客人匯款那條路」的唯一入口)。
- `CREATE OR REPLACE` 抄錯代 ⇒ 把 `20260829140000` 的稅額改動**整個回捲**, 而**三綠不會紅**。

**Rollback**
🛑 **沒有一行還原** —— `CREATE OR REPLACE` 換掉整個本體。要還原就是把 `20260829140000:97` 起那一段
原樣 `CREATE OR REPLACE` 回去。**從那支檔抄, 不要憑記憶重打。**

---

## 4. 🔴 而有一個【順序約束】, 它不是本片造成的

```
repo:20260824020000(已 apply)⇒ 20260829140000(**未 apply**)⇒ 本片(第 3 代)
```
⇒ 本片會**疊在一支還沒 apply 的 migration 上**。兩個後果:
1. 本片的**前置閘**要對到哪一版的指紋?對第 2 代 ⇒ 正式庫今天過不了(它還是第 1 代)。
2. Sean apply 時**必須先貼 `20260829140000` 再貼本片**, 否則第 2 代的稅額改動會被本片蓋掉。
🛑 **這一格我不自己決定** ⇒ §6 Q2。

---

## 5. 怎麼驗(而我先講【我打算怎麼證明它有效】, 不是「會測」)

```
拋棄式 PG(沿用 scripts/pcm03stars-apply-probe.sh 的形狀):
  世界 A  呼叫端送【空 spec】+ 有 variant_id  ⇒ 快照裡的 spec 必須是【權威那一份】
  世界 B  呼叫端送【錯的 spec】(別的 variant 的)⇒ 快照仍必須是權威那一份
  世界 C  variant_id 為 NULL(代購)          ⇒ 維持現況、不得 RAISE(這是刻意的已知限制)
  🔵 正對照 送【對的 spec】⇒ 結果不變(新閘不得改變本來就對的那條路)
突變(寫在做之前):
  M1 拿掉新那一道 ⇒ 世界 A 必須紅
  M2 讓它只在 spec 為空時才覆蓋 ⇒ 世界 B 必須紅(擋「只修了看得見的那一半」)
  M3 讓它對 variant_id=NULL 也去查 ⇒ 世界 C 必須紅
  M4 🔵 純註解改動 ⇒ 不得有任何一格紅
```
⚠️ **拋棄式 PG 的效度上限照抄不放寬**:本機 apply 成功 ≠ 正式庫 apply 成功。

---

## 6. 三題的下落(Q1 已追到 · Q2/Q3 主視窗已裁)

```
✅ Q1 **已追到, 而它本來就不是決策題** —— `public.product_variants.spec`(追法見 §1)。
🔴 **主視窗退回這一題的理由值得留**:逐字「那不是我答得出來的, 是你追得出來的 ——
   我答它 = 我用猜的代替你的查證, 而我手上沒有比你多的東西」。
   📌 **⇒ 我把一個【還沒查完】包裝成了一個【要人拍板的岔路】** ——
   而兩者在「Q1」那個標籤底下長得一樣, 端出去都會停下來等人。
   ⇒ 判別句:**這一題的答案, 是不是我多敲幾個指令就會出現?** 是 ⇒ 那不是決策題。

✅ Q2 **甲**(主視窗 2026-08-31 裁):對第 2 代寫。乙 會讓第 2 代的稅額改動被蓋掉 ⇒ 不收。
   而「一次要他貼兩支」的代價由主視窗吸收:兩支都做成 `~/Desktop/貼這個-<序號>-<名字>.sql`,
   🔴 **順序約束要寫進兩支檔的【第一行註解】, 不是只寫在訊息裡 —— 訊息會被滑掉, 檔頭不會。**

✅ Q3 **照板子**:代購品項(`variant_id = NULL`)維持恆 `{}` —— 既有的刻意限制。
   而 M3 突變正好守住它。
```

---

## 7. L 分級與相關紀錄
**L1**(不是內容, 是後台功能)。無 L3。
- 板 `⟦b4-SPEC1⟧`(`:488`, 態 open, 誰欄「要提 plan」)
- 硬約束(線A 已寫進那片驗收條):**料號打字帶入那片不得在本列落地前上線** ——
  它會把「選中 variant」從少數變成常態 ⇒ 每選中一次多一份補不回來的空快照。
- CLAUDE.md 路由表「要抄一支既有的 DB 函式來改」⇒ `scripts/latest-definition-of.sh`(本 plan 已跑)

🛑 **本 plan 未經批准, 我不動任何一行。**
