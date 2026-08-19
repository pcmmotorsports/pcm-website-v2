# 後台商品分頁改造 · slice plan(2026-08-19,G3)

> **規格來源 = Sean 逐字**(經主視窗轉述,我沒有直接看到他打字):
> > **單頁要能看到 200-500 以上,下方頁數選擇要可以自填頁數**
> > `1.2.3.4.5[]6.7.8.9.10> >>`

**片型 = 標準片**(動 `apps/admin` 4 檔 + 測試)。**命中鐵則 8**(跨 3+ 檔 + 動共用元件)⇒ 本檔即等批准的 plan。
**未命中鐵則 12**:零金流 / 零 auth / 零 schema·migration / 零平台設定 / 零對外發送 / **非 `packages/ui`**
⇒ 關卡2 走 code-reviewer,不跑 codex。**L1**(每頁筆數選項是 hardcode 常數、年 0-1 次會動)。

---

# §1 現況(全部親讀,附行號)

```
apps/admin/src/app/products/page.tsx:20   export const PRODUCTS_PAGE_SIZE = 20;   ← 寫死
                                    :106  <ListPagination …/>                     ← 只有「上一頁/下一頁」
apps/admin/src/components/shared/list-pagination.tsx  70 行,**5 個其他呼叫端**
   customers/page · orders/page · customer-detail · settings/supplier-table · shared/admin-data-table
apps/admin/src/lib/products/product-list-view.ts      網址三軸 set_by / q / page 的唯一組裝點
apps/admin/src/lib/products/product-repository.ts:226 .range(offset, offset + limit - 1)
                                    :~220 .order('created_at',desc).order('id',asc)
```

## ✅ 五條準則裡,**repository 這一側已經是對的** —— 本片不動它
```
準則 2 兩端皆含   ✅ `offset + limit - 1`,已正確
準則 3 中途 throw ✅ `if (error) throw error`(:229 附近);本頁不是迴圈、單發查詢
準則 4 count 不當終止判準 ✅ 本頁不翻迴圈;count 只拿來顯示總數
準則 5 排序帶唯一鍵 ✅ `created_at DESC, id ASC` —— 而 :125 逐字寫著為什麼
                        「也可能兩頁都不出現。這不是理論,是 .range() 分頁對非唯一排序鍵的固有行為」
準則 1 頁大小 < db-max-rows  🔴 **這一條就是本片的全部風險** ⇒ §2
準則 6 集合翻頁期間會被寫    ⚠️ 會(每日同步是 writer)⇒ §5,本片不修、只記
```

---

# 🔴 §2 主視窗指名要看的第一格:**我打算怎麼處理 `db-max-rows`**

## 我**不打算**靠那個數字。理由:它靠不住,而且不必靠。

```
現值   db-max-rows = 2000
出處   docs/patterns/pagination-loop-review.md §1(V 窗 2026-08-18 量:
       products?select=id&limit=5000 ⇒ 206 / content-range: 0-1999/19777)
       + Sean 口頭「已經調整到 2000」
⚠️ 而同一段自己寫著:**主視窗與 I 窗均未自驗** ⇒ 這是【轉錄的、二手的】值
🔴 而更硬的一句也在同一段:**餘裕是【設定給的】,不是程式保證的**
   —— Dashboard 上點一下改回去,這裡就歸零,而**不會有任何東西紅**
```

## ⇒ 兩層,而第二層才是承重的那層

### 第一層(便宜、但只擋已知值):**選項白名單封頂 1000**
```
可選 = [20, 50, 100, 200, 500, 1000]   ← 白名單,不收任意整數
上限取 1000 的理由寫進常數旁邊:1000 < 2000 ⇒ 有一倍餘裕
🔴 **不放 2000** —— 那是準則 1 逐字點名的「零餘裕 = 現在能動、伺服器一調就死」
✅ 而它同時滿足 Sean 的「200-500【以上】」:200 / 500 都在,而且**上面還有一格**
```

### 🔴🔴 第二層(承重):**不問上限是多少,直接偵測「這一頁被砍過」**

伺服器砍頁的症狀是**安靜地少幾筆**。而在這一頁上,那個症狀**算得出來** ——
因為 `count: 'exact'` 與那一頁的列**來自同一次請求**(PostgREST 的 `content-range`)
⇒ 沒有 TOCTOU、兩個數字必定同一個時刻。

```
判準(純函式,零 DB):一頁是完整的 ⟺
    shownCount === limit                  (這一頁滿了)
  ∨ offset + shownCount === total          (這是最後一頁,本來就不滿)
  ∨ (offset >= total ∧ shownCount === 0)   (頁碼超界,本來就空)
其餘所有組合 = 🔴 **有列被安靜吃掉了**
```
⇒ 落地兩件:
```
① 純函式 `assertPageComplete(...)` + 單元測試,**含負向對照**:
   餵一組「limit=1000 / shownCount=500 / offset=0 / total=20341」⇒ **必須紅**
   (沒有這一發,這個守門就是恆綠的 —— guard-and-instrument-traps 的第一個母題)
② 判為不完整時,分頁列上方**渲染一條紅色警示帶**,寫出那四個數字
   🔴 理由:這個病的本體就是【安靜】。把它變吵,才叫修好
```

## ⇒ 而這一層比「查出 db-max-rows」強在哪
```
它不在乎上限是 2000、500、還是被誰改成 300 ——
**任何原因造成的截斷它都看得到**(伺服器上限 / PostgREST 版本差異 / proxy 截斷)
⇒ 🔴 **這是唯一一個【不依賴那個二手數字】的做法**
```

---

# 🔴 §3 主視窗指名的第二格:**我打算怎麼證明「第 87 頁沒有漏掉東西」**

## 先把「漏掉」拆成**三種不同的病** —— 它們的證法不一樣,混在一起答不了

```
病 A 伺服器截斷(這一頁少給了列)        ⇒ §2 第二層的不變式,**每一頁每一次都在驗**
病 B 排序鍵不唯一 ⇒ 頁界上跨頁重複/漏列  ⇒ 已由 `created_at DESC, id ASC` 結構性關掉
                                          (`product-repository.ts:125` 逐字寫了為什麼)
病 C 翻頁期間集合被改(同步寫進來)       ⇒ 🔴 **證不了,而且本片也修不了** ⇒ §5 誠實列
```

## ⇒ 我能給的證明,與我給不了的

```
✅ 可證(機械、可重跑):
   1. 不變式 `assertPageComplete` 在【每一次渲染】跑,含負向對照測試
   2. 往返測試:buildProductListHref(filter, size, page) → parse → 三軸原值不變
      (照 product-list-view.ts:100/:109 既有的編譯期窮舉守門的**形狀**,見【自我更正 A】)
   3. 覆蓋不重不漏的算術:第 n 頁 offset = (n-1)*size ⇒ 相鄰兩頁區間相接不相交
      ⇒ 單元測試對 size ∈ 白名單 × n ∈ {1,2,87,最後一頁} 逐組斷言

❌ 給不了(現在就寫出來,不要等人問):
   · **我沒有正式庫的寫入權,也不會去要** ⇒ 我不會真的翻完 102 頁去比對 20,341 個 id
   · 真要那個證明,唯一形狀是:對真 DB 依序翻完全部頁、收集 id、驗 |集合| === total 且零重複
     ⇒ 那需要 DB access ⇒ **Sean**。我會把那支腳本寫好放著,不自己跑
   · 病 C 在有 writer 的表上**理論上就證不了**(除非快照隔離)
```

---

# §4 要改什麼(逐檔)

```
1. lib/products/product-list-view.ts      + SIZE_PARAM / PAGE_SIZE_OPTIONS / DEFAULT_PAGE_SIZE
                                          + parseProductPageSize()(白名單,認不得 → 預設)
                                          + buildProductListHref 多吃一個 size
                                          🔴 size 的窮舉守門見下方【自我更正 A】
2. lib/shared/list-params.ts              + pageWindow(current, totalPages, radius)  純函式
                                          + assertPageComplete(...)                 純函式
3. components/shared/list-pagination.tsx  🔴 **加【可選】props,預設關 ⇒ 其餘 5 個呼叫端渲染逐字不變**
                                            pageNumbers?: boolean / jumpBox?: boolean
                                            pageSizeOptions?: readonly number[]
                                            + `>` `>>`(以及 `<` `<<`,見下方唯一的判斷題)
4. app/products/page.tsx                  用解析出來的 size 取代寫死的 20;傳新 props
```

## 每頁筆數選單與跳頁框 = **零 JS 的 `<form method="get">`**
```
抄同頁既有做法:product-keyword-search.tsx 就是零 JS 的 GET form(該檔頭寫了為什麼)
⇒ 跳頁框 = <input name="page"> + 三個 hidden(set_by / q / size)
⇒ 筆數選單 = <select name="size"> + onChange 不用 JS,附一顆「套用」鈕
🔴 不引入任何 client component、不動 use-hook ⇒ react-nextjs-rules 那條不觸發
```

## ⚠️ 唯一的判斷題(我做了決定,列出來讓你推翻)
```
Sean 只畫了 `>` 與 `>>`,沒畫 `<` `<<`。
而現況有「上一頁」。照字面做 ⇒ **往回的按鈕消失** = 拿掉一個現有功能。
⇒ 我的決定:**保留往回,做成對稱的 `<<` `<`**。
   理由:那是「他沒說的不要加」與「不要做一半」相衝的一格,而我選了不減功能。
   🔴 這一格你或 Sean 說改,我當場改,不辯。
```

## 預設每頁筆數 = **200**
```
他逐字「單頁要能看到 200-500 以上」⇒ 200 是他講的範圍的下緣 ⇒ 預設踩在那裡最不會錯
20,341 件 ÷ 200 = 102 頁(現在是 1,018 頁)
不預設 1000 的理由 = §6 那個 DOM 量級,而 1000 仍然選得到
```

---

# 🔴 §5 這一片**不修**、而必須被寫下來的三件

```
1. **病 C**:`products` 有 writer(每日同步)⇒ 翻頁期間集合會變 ⇒ 跨頁漏/重**理論上關不掉**
   而本片讓它**變輕**:頁數 1,018 → 102 ⇒ 翻頁次數少一個數量級 ⇒ 暴露窗變小
   (這是副作用,不是我設計的目標 —— 分開寫)
2. **db-max-rows 是 dashboard 設定** ⇒ 它變小時本片的白名單不會自己跟著變
   ⇒ 這正是 §2 第二層存在的理由;而**白名單那個 1000 仍然可能過大**,只是會【被看見】
3. **本片不做篩選** —— 另一個窗在查資料模型(主視窗明講)⇒ 我不碰
```

# 🔴 §6 這一片會踩到一段**別人寫下的天花板** —— 而它就是被我這一片推過線的

```
apps/admin/src/components/shared/admin-data-table.tsx:14-15 逐字:
  ponytail: 桌機列與手機卡各渲染一次 cell(共兩份 DOM),換來零 JS、零視窗偵測、
    server component 直出。**單頁 20-50 列的量級可忽略。**
🔴 products-table.tsx:3 確實 import AdminDataTable ⇒ 商品列表吃這個雙渲染
⇒ 每頁 1000 列 ⇒ **2000 份列的 DOM**,而手機那半是 CSS 隱藏、不是條件渲染 ⇒ HTML 照樣送
⇒ 那段註解自己標的適用範圍是 20-50,**我這一片把它推到 20 倍以上**
```
## ⇒ 我的處置:**量,不猜;而且不在這一片動那個元件**
```
驗收會量:size=200 / 500 / 1000 各一發,記 HTML bytes 與 TTFB(本機、附命令)
· 量得動 ⇒ 照做,把數字寫進 commit body(**不寫「應該還好」**)
· 量出來難看 ⇒ **不自己改共用表格元件**(那是另一片、另一個風險面)
  ⇒ 改成把預設壓在 200、把 1000 留在選單裡並在選單旁註明「較慢」
🔴 **我不會在沒量之前先寫任何一句「效能可接受」。**
```

---

# §7 驗收條件(逐條 yes/no)

```
1. `?size=` 收 20/50/100/200/500/1000;其餘值(含 3000、abc、陣列)→ 回預設 200,不報錯   □
2. 換筆數 / 換篩選 / 換搜尋詞 ⇒ page 回 1(沿用既有 buildProductListHrefResetPage 的理由)  □
3. 翻頁保留 set_by + q + size 三軸(往返測試釘住;漏一軸 tsc 紅)                          □
4. 分頁列:頁碼窗(當前頁前後各 5)+ 可自填頁碼的輸入框 + `>` + `>>`(+ `<` `<<`)          □
5. `assertPageComplete` 負向對照測試會紅(shownCount 500 / limit 1000 / 非末頁)           □
6. 截斷發生時畫面出現紅色警示帶並印出四個數字                                              □
7. 🔴 其餘 5 個 ListPagination 呼叫端**渲染輸出逐字不變**(快照或字串比對測試釘住)        □
8. 三綠 + build,全部 `TURBO_FORCE=1` 前綴,零 cached                                      □
9. §6 的三發量測數字寫進 commit body(不是「應該還好」)                                    □
10. 不 push、不 apply、不碰 .env*                                                          □
```

# §8 rollback
```
單一 commit、只動 apps/admin 4 支 + 測試,零 migration、零設定檔
⇒ `git revert <sha>` 即可;共用元件的新 props 全是可選 ⇒ revert 不影響其他頁
```

# §9 相關既有紀錄與連動面
```
· docs/patterns/pagination-loop-review.md          五條 + 第 6 條(本檔 §1/§2 逐條對過)
· docs/design/admin-design-system.md               UI 真權威(BMW M)⇒ 動工前 grep,不憑記憶
· backlog #661                                     商品搜尋(已落地,本片沿用它的網址模型)
· product-list-view.ts:100(說明)/ :109(那個 Record)  編譯期窮舉守門(行號當場核過)
· admin-data-table.tsx:14-15                       §6 那段天花板
· product-repository.ts:125 / :215                 排序唯一鍵 / 「.range 先分頁再回列」
```

---

# 🔴 §10 自我更正 A:**`size` 不能放進那個 Record —— 我原本寫錯了**

寫完 §4 之後我去核那個守門的實際形狀,發現我原本的寫法**在接觸的第一分鐘就會壞**:

```
product-list-view.ts:109 逐字:
  const byFilterKey: Record<keyof AdminProductFilter, HrefEntry> = {
                            ↑ 它 key 在 **AdminProductFilter**(篩選軸)
而 AdminProductFilter 只有兩軸:setBy / keyword
🔴 **`page` 根本不在那個 Record 裡** —— 它在函式尾端另外處理(`if (page > 1)`)
```
⇒ **`size` 與 `page` 同類:它們是「看的方式」,不是「篩什麼」。**
把 `size` 塞進 `AdminProductFilter` 會讓型別說謊,而且會污染
`buildProductListHrefResetPage`(換篩選要重設 page、**但不該重設 size**)。

## ⇒ 改成:**兩個 Record,兩道守門**
```ts
// 篩選軸(既有,一個字不動)
const byFilterKey: Record<keyof AdminProductFilter, HrefEntry> = { setBy: …, keyword: … };

// 檢視軸(新增;page 從函式尾端的 if 收編進來)
interface AdminProductView { readonly page: number; readonly size: number }
const byViewKey: Record<keyof AdminProductView, HrefEntry> = {
  page: [PAGE_PARAM, page > 1 ? String(page) : undefined],           // 既有行為不變
  size: [SIZE_PARAM, size !== DEFAULT_PAGE_SIZE ? String(size) : undefined],
};
```
🔴 **兩軸都保住「漏一軸 tsc 直接紅」這個性質**,而型別不再說謊。
✅ 副作用:`page` 從一個裸 `if` 變成受守門管的一軸 —— 那是**既有的一個缺口**,順手關掉。
⚠️ 而**渲染輸出必須逐字不變**(`page=1` 與 `size=200` 都不寫進網址)⇒ 往返測試釘住。

## 而這一格值得記的不是這個 bug,是**它怎麼被抓到的**
```
我在 plan 裡寫「加一軸 size 進那個 Record」的時候,**手上沒有那個 Record 的內容** ——
我是照著它的【名字】(「編譯期窮舉守門」)推的,而那個名字聽起來就該收所有軸。
🔴 去核行號的時候才看到它 key 在 AdminProductFilter,而 page 不在裡面。
⇒ **那個錯與行號錯是同一次動作抓到的** —— 我本來只是要核數字。
📌 核字面值不只是在核字面值:它會順便把【照名字推出來的設計】撞開。
```
