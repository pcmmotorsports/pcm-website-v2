# 首頁 OD 定案稿 vs 真站深度逐區塊差異(2026-08-06)

真權威:OD `pcm-home-redesign/direction-b-layout-01-graphite-ember.html`(1358 行,已全文讀取)
真站:`apps/storefront/src/components/*.tsx` + `styles/home.css`(1466 行,已全文讀取)+ `Header.tsx`/`header.css`/`MobileTabBar.tsx`

排除項(已知未做,不列):車型獨立選、D8 Showcase 刪除、家數不報(N04/N06 拍板)、N°02 凍結副標與 CTA、缺 icon 純文字 chip(`b-cat-chip--noicon`)、TabBar 讓位修、hero 高度吃站台 token。

---

## 一、Hero + 選車器 Dock(N°01)—— 差異 2 條(1 漏搬、1 待判)

| OD 值(檔:行) | 站上值(檔:行) | 量級 | 判定 |
|---|---|---|---|
| `.ed-finder-go{background:var(--c-red);color:#fff}` 常駐熔橘、hover 轉 `--c-ember-ink`(OD:190-191) | `.ed-finder-go{background:var(--ed-c-paper-2);color:var(--ed-c-ink-mute)}`,僅 `.is-ready` 才轉黑 `var(--ed-c-ink)`,hover 轉 `#000`(home.css:349-367)。真瀏覽器 curl 確認首屏無 `is-ready` class,按鈕現況=灰底灰字 | 色(熔橘↔灰/墨黑) | **漏搬**(任務點名的已知例,尚未修) |
| `.ed-finder-slot:focus-within{outline:2px solid var(--c-ember-ink);outline-offset:-2px}`(OD:189,明文 WCAG 1.4.11 修正)| home.css 全檔零 `.ed-finder-slot:focus-within` 規則(僅 `.vsc-input--finder{outline:none}` 蓋掉原生框,home.css:1411 一帶);`brand-page.css:330` 卻引用此選擇器當作既有先例 | 態(鍵盤 focus 可見度) | 待判(combobox 元件是否有自帶 focus 樣式未查證,若無則是 a11y 漏洞) |

其餘(hero 漸層、輪播、tick、標題斷字、CJK 排版三值、TabBar margin、`.b-dock-jump` 隱藏)逐條核對 OD 與 home.css 註解,字面/邏輯一致,**對齊**。

## 二、N°02 最新商品橫捲 —— 對齊

軌道寬公式、gap、箭頭 disabled 邏輯(站上多接線,OD 原型未接、屬修正非偏離)、tabIndex/role a11y 補強均已核對,零差異。已知凍結副標/CTA 依規則不列。

## 三、N°03 部品分類 —— 對齊

11 顆 icon path 逐筆比對 OD `:934-986` 與 `CategoryGrid.tsx:59-172`,一劃未改;色碼、統一版面 6→4→3→2 欄折疊、`stroke-linecap/linejoin` 全域規格均已補齊(home.css:754-777 有專門註記修過一次遺漏)。零差異。

## 四、N°04 服務宣言(黑色 slab)—— 差異 1 條、**本輪最大漏搬**

| OD(檔:行) | 站上(檔:行) | 量級 | 判定 |
|---|---|---|---|
| 三欄各帶 `.b-stat-icon`(34×34 描邊圓框 + svg,授權徽章/扳手/對話框三顆,OD:1010-1023) | `HomeStatement.tsx:29-56` 三欄**完全沒有 icon 元素**;home.css 全檔零 `b-stat-icon`/`stat-icon` 字串 | 結構+色(整組視覺元件消失,不是顏色/間距級小差) | **漏搬**,查無任何 manifest/commit 註記為刻意 |

三欄文案的「不報家數」偏離已由 Sean 拍板記在案(manifest `HomeStatement.business_overrides`),但那份文件完全沒提到 icon —— icon 缺失是文案改版之外、獨立被漏掉的一塊。

## 五、N°05 品牌焦點(Editorial)—— 差異 1 條(小)

| OD(檔:行) | 站上(檔:行) | 量級 | 判定 |
|---|---|---|---|
| 圖說 mono 小標固定字面「品牌焦點」(OD:1054) | `FeatureEditorial.tsx:115` 寫死「Fig. 01」 | 文案(英文標籤取代中文標籤) | 漏搬,manifest/commit 查無此項紀錄 |

CTA 動線(品牌介紹+分類列)、中文排版六值刻意未搬(已申報 manifest)、照片退路順位等均已核對,其餘對齊。

## 六、N°06 品牌磚牆 —— 對齊

`BrandIndex.tsx` 檔頭自帶完整「申報偏離台帳」(選擇器改形、`.is-empty`、`.ed-sr-only`、logo 真 DOM 化四項,附回寫債 backlog #322),全部核對屬實且已申報,無新差異。

## 七、頁尾 —— 差異 1 條、**語意最矛盾**

| OD(檔:行) | 站上(檔:行) | 量級 | 判定 |
|---|---|---|---|
| 頁尾標語固定「專業重機零件・改裝精品/一站式服務」(OD:1079);OD 註解逐字說明原因——「改裝不只是升級配件…」那句**已升格為 hero 主標,同頁講兩次會稀釋掉它,故頁尾改講服務範圍」** | `HomeFooter.tsx:58-63` 預設 tagline 仍是「改裝不只是升級配件,是風格與態度的延伸。」—— 與 hero 主標(HomeHero.tsx SLIDES[0].title)字面幾乎相同 | 文案(整句重複、違背 OD 明文設計理由) | **漏搬**,`HomeFooter.test.tsx:116` 甚至把這句錯字面寫進斷言、鎖死成「正確答案」 |

其餘欄位(logo、社群連結、購物/服務/門市三欄、版權列動態年份)均對齊。

## 八、殼(Header / 搜尋框 / MobileTabBar)—— 對齊(局部待判)

Nav 七項、mobile tabbar 五顆 icon/路由、logo 素材均與 OD 逐字對齊。`.pcm-search:focus-within` 缺 OD 明文的 WCAG 焦點框修正(OD:97-99),但站上搜尋框行為已改成「focus 即 blur 並開啟搜尋 overlay」,原始互動模式不同 ⇒ 列**待判**,不確定原 a11y 修正是否仍適用。

---

## 尾節

### ① 漏搬總數與 Top 5(依可見度排序)

漏搬 4 條 + 待判 2 條 + 對齊 5 個區塊。

1. **搜尋部品鈕未熔橘常駐**(hero dock 主 CTA,任務點名的已知例,curl 實測仍是灰底灰字)—— `home.css:349-367`
2. **N°04 服務宣言三顆 icon 整組消失**(授權徽章/扳手/對話框)—— `HomeStatement.tsx`、`home.css` 零 `b-stat-icon`
3. **頁尾標語與 hero 主標重複**,恰是 OD 明文要避免的狀況 —— `HomeFooter.tsx:58-63`
4. **N°05 圖說小標「Fig. 01」取代「品牌焦點」**—— `FeatureEditorial.tsx:115`
5. **`.ed-finder-slot:focus-within` 焦點框缺失**(鍵盤使用者選車時看不到焦點在哪格)—— home.css 全檔零命中,`brand-page.css:330` 誤引用不存在的先例

### ② 掃不到的面

- 全程用原始碼/CSS 靜態比對 + 一次 curl 200 驗證首頁可載,**未用真瀏覽器(chrome-devtools/playwright)實際互動**:hover/active/focus 視覺結果、輪播過場時序、`prefers-reduced-motion`、深色模式(若有)均未肉眼或 DOM 快照驗證。
- 未驗證 `.pcm-search:focus-within` 待判項在站上 combobox / overlay 互動下鍵盤使用者實際能否看到焦點框(需要真瀏覽器 Tab 走一輪)。
- 未展開檢查 `VehicleSelect.tsx`/`GarageChips.tsx`/`ProductCard.tsx` 內部樣式是否有其獨立於 home.css 的 OD 差異(僅核對它們掛載進 dock/carousel 的外層 class,未逐屬性比對這些子元件自身 CSS)。
- 響應式斷點(≤1400/1200/1000/900/700/640/560)僅比對 CSS 規則文字是否存在對應差異,未用不同 viewport 實際截圖比對版面。
