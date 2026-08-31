# Plan:讓「沒有規格的商品」賣得出去 ⟦b4-NOVARIANT1⟧

> 線【出貨】`-1e` · 2026-08-31 19:0x · HEAD `63a9fb51` · 工作樹 0
> **Sean 拍甲 =「賣」,而他是【看過真實成本之後】重答的**(主視窗端的字面含「要動到金流的資料庫程式,會走完整 plan + 對抗審查」)。
> 🛑 **鐵則 8 硬觸發**(跨 3+ 檔 + 動活著的金流 RPC)⇒ **本檔是提案,一行碼都沒動,等批。**
> 🔴 **鐵則 12 ①錢 + ③schema ⇒ codex 對抗審查不降級,本線自己跑。**

## 1. 動機 —— 而它有一半是「今天還看不到的」

```
症狀:一件沒有規格的商品加得進購物車 ⇒ 填完卡號按下確認付款【之後】才跳
     「購物車有商品缺少規格資訊,請返回購物車重新確認」
     而購物車上【沒有東西可以修】—— 那支商品本來就沒有規格可選 ⇒ 客人卡死
```
🔴 **而今天沒有客人撞得到**:零變體商品 10 支、**架上 0 支**、歷來被下單 **0** 行。
🛑 **「撞不到」不等於「修好了」**:那 10 支裡 **8 支的 `availability` 仍是 `in-stock`**,
擋住它們的只有 `delisted_at` **一個欄位** —— 而後台有一顆上架切換,**按一下就回到架上**。
📌 **⇒ 正確字面是【休眠】不是【已解決】。**
🔵 **而做完本片之後,那 8 支就【真的會被賣】** ⇒ 「上架前要不要有守門」變成一個**新問題**,不是消失(見 §5 Q2)。

## 2. 為什麼不是「放寬一個 `if`」—— 逐格量到的

我讀的是**正式庫上活著的那一版**(`pg_proc.prosrc`,331 行;那支 migration 在 repo 裡有 7+ 代):
```
簽名 create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text)
:96   v_variant_id := nullif(v_line->>'variant_id','')::uuid;   ← 缺 variant_id 它【本來就收】
:100  IF v_variant_id IS NOT NULL      → FROM public.product_variants pv JOIN products p …
:107  ELSIF supplier_slug 與 sku 都在  → **也是** FROM public.product_variants pv JOIN products p …
:113  ELSE RAISE 'line 缺 variant_id 或 (supplier_slug,sku)'
:118  IF v_variant.id IS NULL THEN RAISE '找不到 variant(…)'      ← 🔴 零變體一定停在這裡
```
🔴 **兩條分支都查 `product_variants`,而零變體商品在那張表裡一列都沒有。**
⇒ 📌 **它不是「拒絕沒有 variantId」,是【整支函式的價格與規格來源就是那張表】。**

**而下游每一格都吃 `v_variant`**(這才是範圍的真正大小):
```
:127  v_variant.delisted_at        ← 🔵 這一格已經是 products 的(JOIN 來的)⇒ 無變體時仍成立
:131  v_unit_price := v_variant.price_general        ← 🔴 變體的價 ⇒ 要換 products.price_general
:139  v_variant.spec 必須是 object / 值全字串 / 不含 price_store·price_by_tier·cost
:202  insert 'variant_id',   v_variant.id
:203  insert 'variant_sku',  v_variant.sku           ← 🔴 §5 Q1 那一題
:204  product_snapshot{title, sku, spec}
:209  variant_availability = 'in-stock' **AND** product_availability = 'in-stock'
```

## 3. 目標表側的現況(量到的,不是假設)

```
order_items.variant_id   uuid  **NULL 可** ✅  外鍵 → product_variants(NULL 時不成立, 無妨)
order_items.variant_sku  text  🔴 **NOT NULL**  ← 零變體商品沒有變體 sku ⇒ §5 Q1
products.price_general   integer NULL 可 —— 🟢 而那 10 支【10/10 都有值且 > 0】(不是空的)
products.availability    text  NOT NULL   products.delisted_at 可空   products.external_id NOT NULL
🔴 product_variants.sku  = 54,000 distinct / 54,000 列 ⇒ **今天 variant_sku 的來源是全站唯一的**
🔴 products.external_id  = 22,734 唯一 / 22,788 支 ⇒ **54 支商品共用重複的 external_id**
   🟢 而那 10 支零變體商品**沒有一支在重複名單裡**(0 支)⇒ 今天不痛, 而它是一個【會長大的】前提
```

## 4. 分片

```
片1 · migration:create_order 加第三條分支(無變體 ⇒ 從 products 取)
     · 價 = products.price_general(NULL 或 <=0 ⇒ 照現有 :136 那道 RAISE 的形狀擋)
     · spec = '{}'::jsonb —— 🛑 而 :139 那道驗證對空物件會【自動通過】
       ⇒ 要明寫「無變體時那道驗證沒有判別力」, 不要讓下一個人以為它守著什麼
     · availability:無變體時只看 products.availability(:209 那個 AND 只剩一半)
     · 去重鍵:v_seen_variants 以 variant id 為鍵 ⇒ 無變體沒有 id
       ⇒ **要一個等價的鍵(product id)**, 否則「同一支零變體商品下兩行」不會被合併
     🔴 鐵則 12 ①③ ⇒ codex 不降級
片2 · TS:useChargePayment 那道 `if (!it.variantId)` + packages/schemas 的 variantId
     🔴 **而這一片的驗收是「把兩個世界分開」, 不是放寬**(見 §6)
片3 · 交 SQL 給 Sean 貼 + 貼完唯讀七格複驗(含 prosrc 逐字比)
```

## 5. 🔴 要 Sean 拍的兩題(跟本 plan 一起端)

```
Q1: order_items.variant_sku 現在不准空, 而零變體商品沒有「變體 sku」。那一欄要放什麼?
A: 甲 改成可以空 —— 那一欄以後的意思是「**有變體時才有值**」
      ⇒ 讀那一欄的人要自己處理空值; 而它誠實:沒有變體就是沒有
   乙 塞商品自己的料號(external_id) —— 那一欄以後的意思是
      「**這一行賣的東西的料號**(有變體時是變體的, 沒有時是商品的)」
      🔴 代價(量到的):今天 variant_sku 的來源 `product_variants.sku` 是**全站唯一**的
        (54,000/54,000), 而 `products.external_id` **不是**(54 支商品共用重複值)
        ⇒ **那一欄會從「唯一」變成「不保證唯一」**, 而任何拿它當鍵的查詢會安靜地變寬。
        🟢 而那 10 支零變體商品今天**沒有一支重複** ⇒ 今天不痛, 明天不保證。
🛑 這一題問的是【那一欄以後代表什麼】, 不是欄位型別 —— 所以是他答, 不是我們選。

Q2: 做完之後那 8 支(現在下架、而 availability 仍是 in-stock)就【真的賣得出去】了。
    上架之前要不要有一道守門?
A: 甲 不用 —— 員工想上架就上架(它本來就賣得出去了, 這才是本片的目的)
   乙 要 —— 上架時若商品沒有規格, 跳一句提醒讓人確認一次(擋錯誤上架, 而不擋刻意上架)
```

## 6. 🔴 驗收:一發突變證明【兩個世界分開了】,不是放寬了一個 if

```
世界 A(真的無變體商品)      ⇒ 收得下、而且價格取自 products.price_general
世界 B(有變體商品而 variantId 掉了)⇒ **仍然拒**
🔴 突變:把 B 那道拒絕拿掉 ⇒ **必須紅**。
   不紅 ⇒ 那就是「放寬了一個 if」, 不是「分開兩個世界」。
```
📌 **為什麼 B 這麼重要**:`variantId: z.uuid()` 今天是一道 **fail-closed 的價格守門** ——
一個**有變體**的商品若掉了 variantId 而被放行, 它會走到「用商品價」那條路 ⇒ **回錯價**(群價 vs 變體價)。

## 7. 這份 plan 答不出什麼

```
· 那 10 支【為什麼】沒有變體(供應商資料缺? 匯入漏了?)⇒ **未查**。
  ⇒ 若成因是匯入漏了, 本片會把一個【資料問題】變成一個【賣得出去的商品】,
    而那未必是壞事, 但要知道它是這樣。
· ✅ ~~顧客站前台還有沒有別的地方假設「一定有變體」~~ **查了(2026-08-31 19:2x),而答案是【範圍不變】**:
```
storefront 非測試碼裡【唯一】拒絕無變體的地方 = useChargePayment.tsx:140
  (尺:grep 'if (!it.variantId|!line.variantId|!variantId)' ⇒ **1 處**)
而其餘每一處都【已經】handle 掉 null 了:
  cart/actions.ts:112      variantIdRaw !== undefined 才檢查型別(明文允許 undefined)
  CartView.tsx:42          line.variantId ?? null      useResolvedCart.tsx:58  同
  CheckoutSummaryAside:41  item.variantId ?? ''        CheckoutStep2ReviewSections:162 同
非空斷言 / variants[0] 這種會炸的寫法 ⇒ **2 命中而【兩處都在註解裡】**(ProductCard.tsx:83 `*` 續行 / :89 `//`)
🟢 正對照:同尺打 `variantId` 全 storefront 非測試 ⇒ **63 命中**(尺是活的, 不是恆空)
```
📌 **⇒ 片2 的 TS 範圍確實只有那一支檔那一道**,不是我原本估的「四五支」——
**而我是查了才敢把它縮小的, 不是因為它聽起來小。**
· 🔴 **仍然未查**:零變體商品的**前台顯示**(商品頁的規格區塊會長什麼樣、加入購物車鈕的文案)
  ⇒ 那不影響「賣得成嗎」, 但影響「他看起來像不像一件正常的商品」。**本 plan 不涵蓋。**
```
