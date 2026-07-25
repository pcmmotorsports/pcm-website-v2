# PCM 後台重建研究 — 內容與營運周邊(Content & Ops)

> 範圍:內容管理(Pages/Blog/Nav/Metaobjects)、媒體庫、SEO 欄位、通知範本、匯入匯出、稽核與權限。
> 查證日期 2026-07-25。help.shopify.com 全程用 firecrawl_search / WebFetch(非瀏覽器),繞過 Turnstile。
> 「未確認」項目已於各節標示,不推測充答案。

---

## 1. 內容管理(Pages / Blog / Navigation / Metaobjects)

### 1.1 Pages(靜態頁面)
- 物件:`Page`(GraphQL `onlineStorePage` 底層)。
- 欄位(官方 Admin GraphQL):`title`、`body`(HTML)、`bodySummary`(前 150 字摘要)、`handle`、`isPublished`、`publishedAt`、`templateSuffix`(自訂版型後綴)、`metafield`/`metafields`、`createdAt`/`updatedAt`、`translations`。
  來源:https://shopify.dev/docs/api/admin-graphql/latest/objects/Page
- SEO 欄位不是 Page 物件的原生欄位,而是透過 `global.title_tag` / `global.description_tag` 兩個 metafield(namespace=`global`)承載,Admin UI 的「Edit website SEO」寫入的就是這兩個 metafield。
  來源:https://shopify.dev/docs/apps/build/marketing/optimize-storefront-seo、https://shopify.dev/docs/api/admin-rest/latest/resources/metafield
- 版面(Admin UI):標題 + 本文富文本編輯器 + 「Search engine listing preview」(可展開編輯 meta title/description,顯示字元數與 Google 預覽)+ Visibility(顯示/隱藏、排程發布)+ Theme template 選單。此為一般認知,未逐項對照官方畫面截圖,標記**未確認(UI 版面細節)**。

### 1.2 Blog(部落格文章)
- 物件:`Blog`(容器)+ `Article`(文章)。
- Blog 欄位:`title`、`handle`、`commentPolicy`(留言審核策略)、`templateSuffix`、`tags`(最近 200 篇文章的 tag 聯集)、`articles`(分頁連結)、`feed`(FeedBurner RSS 設定)、`metafields`、`translations`。
  來源:https://shopify.dev/docs/api/admin-graphql/latest/objects/Blog
- Article 欄位(此輪未完整抓到,依 Blog 頁面關聯段推斷:歸屬 blog、留言受 blog commentPolicy 管控、tags、metafields)——**未確認(Article 完整欄位清單,如 author/image/excerpt/publishedAt 需另查 Article 物件頁**:https://shopify.dev/docs/api/admin-graphql/latest/objects/Article,本輪未抓)。

### 1.3 Navigation(選單)
- 物件:`Menu` + `MenuItem`。
- Menu 欄位:`handle`(主題引用用,預設選單 handle 不可改)、`id`、`isDefault`(保護預設選單不被刪除/改 handle)、`title`、`items`、`translations`。
- MenuItem 可連結:Collection、Product、Page、Blog、自訂 URL。**巢狀最深 3 層**。
- Mutation:`menuCreate`、`menuUpdate`。
  來源:https://shopify.dev/docs/api/admin-graphql/latest/objects/Menu

### 1.4 Metaobjects(自訂內容型別 —— 對 PCM 最關鍵)
- `MetaobjectDefinition` = schema,定義一個自訂內容型別的欄位、驗證規則、能力(capabilities)。
  欄位:`id`、`type`(唯一命名空間識別碼)、`name`、`description`、`fieldDefinitions`(欄位陣列)、`displayNameKey`(哪個欄位當顯示名稱)、`access`(admin/storefront 存取權限,storefront 可設 `public_read`/`none`)、`capabilities`(如 publishable 發佈狀態、translatable 可翻譯)、`standardTemplate`、`hasThumbnailField`、`metaobjectsCount`。
  來源:https://shopify.dev/docs/api/admin-graphql/latest/objects/MetaobjectDefinition
- 支援欄位型別(本輪頁面只列出範例、非完整表):`single_line_text_field`、`multi_line_text_field`、`file_reference`、`number_decimal`。**未確認(完整型別清單)**——Shopify 官方另有完整 metafield/metaobject 型別頁(如 boolean、date、money、list.*、metaobject_reference、product_reference、url、rich_text_field 等),本輪未抓取,需查 https://shopify.dev/docs/apps/build/custom-data/metafields/list-of-data-types。
- 建立方式:①GraphQL `metaobjectDefinitionCreate`(merchant-owned,自訂 type 前綴,如 `size_chart`)②App-owned metaobjects 透過 `shopify.app.toml` 內 `metaobjects.app.<name>` 保留前綴。Admin UI 建立流程(Content > Metaobjects)本輪**未確認**(頁面未提供)。
- Storefront 綁定:`access.storefront` 控制 Storefront API 是否可讀(`public_read`/`none`);理論上主題透過 metaobject reference metafield(掛在 Product/Page 等資源上)取值渲染,**未確認(theme liquid 綁定的具體語法與 metaobject Liquid object 細節)**,來源頁未涵蓋。
  來源:https://shopify.dev/docs/apps/build/custom-data/metaobjects

**對 PCM 的對應**:PCM「品牌介紹」「安裝資源(手冊/影片)」性質等同 Metaobject——固定 schema、多筆實例、有 admin CRUD、前台按型別 render。若要做通用內容模型,建議走 Metaobject 的模式:①先定義 field schema(型別+必填+驗證)②admin 端生成通用 CRUD(而非每種內容類型各刻一套後台)③前台用 reference 欄位掛在對應資源或獨立路由。

---

## 2. 媒體庫(Files)

### 2.1 Shopify Files
- 位置:Admin > Content > Files。支援型別:圖片、影片、3D 模型、PDF、CSV。
- 上傳:單次最多同時上傳 **20 個檔案**(桌面/手機皆同)。
- 檔案限制:
  - 圖片:JPEG/PNG/WEBP/HEIC/GIF,**單檔 20 MB**、最大 **2000 萬像素**;檔名不可以句點開頭,也不可以 `medium`/`large` 等字尾結尾(會被 CDN 誤判為縮圖請求)。
  - 影片:MOV/MP4/WEBM,**單檔 1 GB**、**最長 10 分鐘**;建議 16:9、H.264、25/30/60fps。
  - 一般檔案(PDF/CSV 等):**單檔 20 MB**;Trial 方案限制檔案型別,付費方案除 HTML 外皆可上傳。
  - 儲存總量依方案分級:Basic 100GB → Enterprise 10TB;影片儲存 Starter 50GB → Enterprise 10TB;檔案數上限 250 → 100,000(依方案)。
- 搜尋/重用:可依大小、型別、alt text 狀態、使用位置篩選;搜尋列支援 `and`/`or` 邏輯運算子;可存篩選視圖。
- 操作:改檔名=改 URL Handle;可「替換」(保留原檔名換內容);可單筆/批次刪除;可下載原始未壓縮檔;可編輯 alt text。
  來源:https://help.shopify.com/en/manual/shopify-admin/productivity-tools/file-uploads
- Admin GraphQL 物件:`GenericFile` 欄位含 `url`、`alt`、`fileStatus`、`fileErrors`、`originalFileSize`、`mimeType`、`createdAt`、`preview`。**未確認(MediaImage 物件欄位、fileCreate/fileUpdate/fileDelete mutation 完整簽名)**——本輪只抓到 GenericFile,查詢範圍需擴大到 https://shopify.dev/docs/api/admin-graphql/latest/objects/MediaImage 與 https://shopify.dev/docs/api/admin-graphql/latest/mutations/fileCreate。
  來源:https://shopify.dev/docs/api/admin-graphql/latest/objects/GenericFile
- 刪除保護:官方頁面**未明確提及**「檔案被商品引用時是否鎖刪除」這類保護機制,PCM 若要做刪除保護需自行設計(查詢引用計數再擋刪除)。

### 2.2 Medusa File Module
- 架構:`@medusajs/medusa/file` 核心模組 + 抽換式 Provider(`file-local` 開發用、`file-s3` 正式環境用,S3-compatible 含 MinIO、DigitalOcean Spaces、**Supabase Storage**)。
  - 本地 Provider 官方明講「只給開發用,正式環境務必用 S3 Provider」。
  - S3 Provider 設定含 `file_url`、`access_key_id`、`secret_access_key`、`region`、`bucket`、`endpoint`;MinIO/Supabase 額外要 `additional_client_config: { forcePathStyle: true }`。
  來源:https://docs.medusajs.com/resources/infrastructure-modules/file、https://docs.medusajs.com/resources/infrastructure-modules/file/s3、https://docs.medusajs.com/resources/infrastructure-modules/file/local
- API 層面:核心只提供 `retrieveFile`、上傳等基礎方法,經 workflow/step 呼叫;**沒有內建 alt text、重用/搜尋 UI、CDN 轉檔** —— 這些都要應用層自己建(Medusa admin dashboard 本身的 file 管理 UI 較陽春,多數電商會外接如 Cloudflare Images/R2 + 自建媒體庫頁面)。**未確認(Medusa Admin Dashboard 內建媒體庫 UI 的完整功能,如是否有搜尋/篩選/reuse picker)**——本輪未抓 admin dashboard 相關頁面。

**對 PCM 的對應**:PCM 已用 Cloudflare R2(等同 Medusa 概念裡的自訂 S3-compatible Provider)。Shopify Files 的「alt text 強制編輯 + 依用途篩選 + 替換不換檔名」這套 UX 值得抄;Medusa 核心本身不提供這層 UX,PCM 需要自己在後台補一個「媒體庫」頁面(列表+搜尋+alt text 欄+重用選取器),不是接個 file module 就有。

---

## 3. SEO 欄位與 301 轉址

### 3.1 SEO 欄位模型
- `Seo` 物件本體只有兩個欄位:`title`、`description`。
  來源:https://shopify.dev/docs/api/admin-graphql/latest/objects/Seo
- 確認掛有 `seo` 欄位的資源:**Product**、**Collection**(本輪 fetch 到的頁面明確列出這兩個;Page 的 SEO 走的是 `global.title_tag`/`global.description_tag` metafield,不是獨立 `seo` 欄位——見 1.1)。**未確認**:Blog/Article/OnlineStore 是否也有 `seo{}` 欄位或同樣走 metafield 模式,需另查個別物件頁。
- Handle(URL slug)在各資源(Product/Page/Collection/Blog/Article)編輯頁可直接改,改了之後**不會自動產生 301**(見 3.2)。
- **Canonical URL**:Shopify 官方**沒有**逐頁可填的 canonical 欄位——canonical tag 是主題(theme.liquid)自動輸出、對應該頁面的正規 URL,商家不能像 title/description 一樣在 admin 逐頁改 canonical。**未確認(是否有例外設定入口)**,本輪未查到官方明文,以社群討論為輔證,非權威來源。
- **Robots(noindex/nofollow)**:Shopify **沒有 admin UI 開關**可逐頁設定 noindex。要隱藏某頁不被索引,官方建議編輯主題檔 `robots.txt.liquid`(Online Store > Edit Code > Templates)或用 `{% if %}` 邏輯輸出 meta robots tag,屬於**主題程式碼層**而非後台欄位。
  來源:https://help.shopify.com/en/manual/promoting-marketing/seo/editing-robots-txt、https://help.shopify.com/en/manual/promoting-marketing/seo/hide-a-page-from-search-engines
- **結構化資料(JSON-LD)**:Shopify 主題透過 **`structured_data` Liquid filter** 自動產生 Product/Article 頁面的 JSON-LD(`{{ product | structured_data }}`),商家在後台**沒有欄位可編輯 JSON-LD 內容**,要客製要改主題檔或裝 SEO app。
  來源:https://shopify.dev/docs/api/liquid/filters/structured_data

### 3.2 URL Redirects(301 轉址)
- 物件:`UrlRedirect`,欄位只有 `path`(舊路徑)與 `target`(新目標)。
- Mutation:`urlRedirectCreate`、`urlRedirectUpdate`(本輪未查到 delete/bulk import mutation,**未確認**)。
  來源:https://shopify.dev/docs/api/admin-graphql/latest/objects/UrlRedirect
- **關鍵**:官方頁面**未說明**改 handle 時是否自動建立轉址。依 Shopify 商家共識(社群討論,非本輪官方逐字確認),Product 改 handle 通常會自動留舊路徑轉址、但 Page/Collection 改 handle **不一定**自動轉,商家常需手動到 Admin > Online Store > Navigation > URL Redirects 補建,或用 CSV 批次匯入 redirect 規則。此點**未確認(官方逐字未查到)**——建議 PCM 決定要不要做「改 handle 自動寫一筆 redirect」時視為未驗證假設,自行測試 Shopify 行為或直接照自己邏輯設計(不依賴 Shopify 行為對齊)。

**對 PCM 的對應**:PCM 目前商品/分類 SEO 欄位若只做 title+description 已對齊 Shopify 最小集;canonical 與 robots 兩項 Shopify 本身也是「主題層」而非後台欄位,PCM 若想做得比 Shopify 更完整(給頁面逐條開 noindex 開關)反而是超越 Shopify 的功能,值得評估要不要做。301 redirect 表(path→target)是明確該做的 CRUD,且**必須自己觸發**(handle 改變時,不要假設有自動機制)。

---

## 4. 通知與 Email 範本

### 4.1 Shopify Notifications(Settings > Notifications)
- 完整分類(官方 Store notifications 總覽頁):
  - **Customer email notifications**:訂單/出貨/帳號相關自動信。
  - **SMS notifications**:訂單簡訊確認(限支援地區)。
  - **Staff notifications**:店員/團隊通知。
  - **Exchange notifications**:退換貨流程信。
  來源:https://help.shopify.com/en/manual/fulfillment/setup/notifications
- **Customer notifications 範本清單**(本輪頁面列出):Order confirmation、Shipping confirmation、Order refund、Order canceled、Shipping update、Out for delivery、Delivered(另有 Shop App 相關的到貨追蹤通知,非獨立命名範本)。
  來源:https://help.shopify.com/en/manual/fulfillment/setup/notifications/customer-notifications
- **Staff notifications 範本清單**:
  - Store order summary(週報,預設每週一早上 9 點、可調頻率/時間)
  - New order(顧客下單觸發)
  - New return request(顧客申請退貨觸發)
  - Sales attribution ended(訂單歸屬業務被改動時通知原通知收件人)
  - New draft order(顧客送出草稿訂單,只送給 store owner)
  來源:https://help.shopify.com/en/manual/fulfillment/setup/notifications/staff-notifications
- 編輯方式:每個範本可「Edit code」直接改 **Email subject** 與 **Email body(HTML + Liquid)**;也可用「Customize email template」做非程式碼的 logo/主色調整(套用到全部範本)。改壞可「Revert to default」一鍵還原,但還原後客製內容不可恢復(需自行先備份)。
  來源:https://help.shopify.com/en/manual/fulfillment/setup/notifications/customizing-notification-template
- 變數:用 **Liquid** 渲染,官方有完整「Notifications variables reference」頁列出 order 物件全部可用屬性(id、email、name、order_number、confirmation_number、financial_status、line_items、shipping_address、b2b?、company 等 40+ 個),含 B2B 專屬變數。
  來源:https://help.shopify.com/en/manual/fulfillment/setup/notifications/email-variables

### 4.2 Medusa Notification Module
- 核心模組(`@medusajs/medusa/notification`)本身**不寄信**,要接 Provider(如 SendGrid、Resend、自寫)。
- 呼叫方式全部是程式碼:`notificationModuleService.createNotifications({ to, channel: "email", template, data })`,由 subscriber(監聽 `order.placed` 等事件)觸發 workflow 呼叫。
- Resend 整合官方教學:範本用 **React Email components**(`@react-email/components`)寫成 `.tsx` 檔,放在 `src/modules/resend/emails/`,像 `order-placed.tsx`;無 admin UI 可編輯範本,純程式碼維護;可選用 `html_templates` 設定檔覆蓋。
  來源:https://docs.medusajs.com/resources/infrastructure-modules/notification、https://docs.medusajs.com/resources/integrations/guides/resend

**對照 PCM(Resend + email_outbox)**:PCM 走的是 app 層自建 outbox 模式,概念上比 Medusa 官方教學(直接在 subscriber 裡呼叫)多一層可靠性保障(outbox pattern 防漏送/防重送),這點 PCM 已經比 Medusa 官方範例更進階。**PCM 缺的是 Shopify 那種「後台可視化範本清單 + 逐項 Edit code + revert + 週報類統計信」**——Medusa 和 Shopify 都是純程式碼維護範本,没有後台 WYSIWYG,所以 PCM 現況（程式碼維護 email 範本）其實是業界常態，不是缺口；真正該補的是 Shopify 有的「Store order summary 週報」這類主動彙總通知，PCM 目前只有事件觸發信、沒有週期性摘要信。

---

## 5. 匯入 / 匯出

### 5.1 商品 CSV 匯入
- 唯一必填欄:**Title**(新增商品時);新增變體時 **URL handle** 也變必填;更新既有商品時 Title + URL handle 都要有值。
- 欄位依賴:填了 SKU/weight 等變體相關欄位,必須同時填 `Option1 name`/`Option1 value`,否則既有變體會被刪除(高風險陷阱)。
- 檔案限制:**單檔不超過 15 MB**,超過需拆檔分批上傳。
- 處理模式:背景處理、**匯入開始後不能取消**;完成或失敗都會寄**確認信**到店家 email(等同非同步 + email 通知,而非即時進度條)。
- 錯誤回報:欄位缺值型錯誤會在匯入時即時報「哪個欄位缺值」;更細的逐列錯誤報告機制官方頁面**未描述**(未確認)。
  來源:https://help.shopify.com/en/manual/products/import-export/using-csv、https://help.shopify.com/en/manual/products/import-export/import-products

### 5.2 客戶 CSV 匯入
- 檔案限制:**單檔不超過 15 MB**,第一行須為欄位標頭。
- 處理模式:同樣是背景非同步、完成或失敗**都寄 email 通知**(不會即時卡在畫面上等)。
- 錯誤類型(官方列出的常見錯誤):檔案超過 15MB、同時多筆上傳衝突、缺必要欄位標頭、欄位標頭名稱不符、編碼問題(含引號不成對/字元編碼錯)、檔案格式或換行設定錯誤、地區代碼(國家/州省)未用 ISO 3166-1 標準代碼。
- 錯誤呈現:標頭類錯誤會在錯誤訊息中**直接點名是哪個欄位標頭**,並引導去對照官方 CSV 範本。
  來源:https://help.shopify.com/en/manual/customers/import-export-customers、https://help.shopify.com/en/manual/customers/customer-csv-issues

### 5.3 訂單匯出(無匯入)
- Shopify **沒有訂單 CSV 匯入**功能,只有匯出。
- 匯出兩種格式:①完整訂單資料(含客戶/付款狀態/出貨/明細/地址)②交易紀錄(僅已請款交易,含付款方式/金流商/交易狀態)。
- 匯出量級決定交付方式:**≤50 筆**或當頁範圍→直接下載;**51 筆以上**或用日期區間篩選→改用 **email 寄送**(給店主+操作者)。
- 大量匯出耗時官方有給估算:< 10 萬筆約 1 小時內,40 萬筆約需 4 小時;失敗會 email 通知,**沒有即時進度條**。
  來源:https://help.shopify.com/en/manual/orders/export-orders

**對 PCM 的對應**:Shopify 三種匯入/匯出的共通模式是「背景處理 + 完成/失敗一律 email 通知 + 沒有即時進度條」,不是想像中的「進度條 UI」。PCM 若要做商品/客戶批次匯入,對齊 Shopify 的模式(非同步 + 明確錯誤欄位定位 + email 完成通知)比自建即時進度條 UI 更省工、也符合業界既有預期。訂單只做匯出、不做匯入,這點 PCM 也可直接照抄(訂單匯入風險太高,不需要這個功能)。

---

## 6. 稽核紀錄與員工權限

### 6.1 Activity Log(稽核紀錄)
- **Store activity log**(Settings > General > Activity,`admin.shopify.com/settings/general/activity`):顯示店主/員工/App/銷售通路在後台的近期操作,每筆記錄含**執行者名稱(人/App/通路)+ 時間**。
- 批次操作(如批次編輯多個商品)在 log 裡個別變更會顯示執行者為 **"Shopify"**(背景工作處理,不會精準顯示是哪個人觸發的批次)。
- 已安裝的 App 若有權限,可自動產生變更且會顯示在 log。
- **保留與匯出限制**:**最多顯示 250 筆**,無法匯出/下載,官方明講「若要合規稽核用途,只能自己截圖或手動記錄」。
- 員工帳號變動(新增/刪除/角色調整)有獨立的更細緻頁面:**User management activity log**(Settings > Users > Security),比 store activity log 更精確,能追到「誰刪除了某員工」這種一般 log 只會顯示「Shopify 刪除了 XX」的情況。
- POS(實體收銀)有獨立 activity log,專門記錄退款/作廢/人工折扣等高風險操作。
  來源:https://help.shopify.com/en/manual/shopify-admin/activity-logs、https://help.shopify.com/en/manual/your-account/users/security/user-management-activity-log

### 6.2 員工權限(Staff Permissions)
- 模型是**角色制(role-based)**,不是逐項打勾的權限矩陣——「建立角色、把角色指派給使用者」,角色內部才是細顆粒度的權限集合。
- 權限分四大類:Store-level(一般店家角色)、Organization-level(跨店組織角色)、POS app-level(收銀角色)、Partner organization(合作夥伴角色,僅適用 Partner 帳號)。
- 支援自訂角色(custom roles)。
- 但部分敏感操作(如使用者/角色管理本身)**不開放**做成可勾選的權限項,要另外走專屬管理流程。
  來源:https://help.shopify.com/en/manual/your-account/staff-accounts/staff-permissions

**對 PCM 的對應**:PCM 目前後台的權限模型(角色 vs 逐項權限)**未在本輪確認 PCM 現況**,需回頭核對 pcm-admin 現有 schema。若要補稽核紀錄,Shopify 的模式提示兩個重點:①一般 log 只需「誰+何時+做了什麼」,不必做到能重播每個欄位的完整 diff(除非是高風險操作如退款/折扣才需要更細)②log **不必**做成可匯出的合規報表——Shopify 自己都沒做,判斷這是低優先項,除非 PCM 有法規要求。

---

## 未確認清單(需要另外查證才能下判斷)

1. Metaobject 完整欄位型別清單(只查到 4 種範例,官方應有 boolean/date/money/list.*/reference 等完整表)。
2. Metaobject Admin UI(Content > Metaobjects)實際建立流程畫面、與前台 theme 綁定的 Liquid 語法細節。
3. Article(部落格文章)物件完整欄位清單(author/image/excerpt/publishedAt 等)。
4. GenericFile 以外的 `MediaImage` 物件欄位、`fileCreate`/`fileUpdate`/`fileDelete` mutation 簽名、檔案刪除保護機制(是否擋掉被商品引用中的檔案)。
5. Blog/Article/Shop 是否也有獨立 `seo{}` 欄位(本輪只確認 Product、Collection 有)。
6. Canonical URL 官方逐頁可控機制是否真的完全不存在(僅查到主題自動輸出、社群佐證,無官方逐字明文排除)。
7. 改 handle 時 Shopify 是否自動建立 301 redirect(社群共識、非官方逐字確認;Product 與 Page/Collection 行為可能不同)。
8. `UrlRedirect` 是否有刪除與 CSV 批次匯入的 mutation(本輪只查到 create/update)。
9. 商品/客戶 CSV 匯入的逐列(per-row)錯誤報告機制細節(官方頁面提到欄位缺值會報錯,但沒具體說是否有逐列錯誤清單下載)。
10. Medusa Admin Dashboard 內建的檔案/媒體管理 UI 實際功能(搜尋、reuse picker 有無)——本輪只查了 File Module 的程式碼層,沒查 admin dashboard UI 文件。
11. PCM pcm-admin 現有的權限模型(角色制 vs 逐項)與是否已有 activity log,本輪未讀 PCM repo(任務範圍限定為 Shopify/Medusa 外部研究)。

---

## PCM 最該補的 5 樣內容/營運工具

1. **通用 Metaobject 式內容模型**:「品牌介紹」「安裝資源」已經是兩個手刻的專用內容型別,若之後還會長出第 3、4 種(如常見問題 FAQ、活動頁),現在就該抽出一個通用 schema-defined 內容型別框架(欄位定義+CRUD 產生器),而不是每次都重刻一套後台頁面——這是 Shopify Metaobject 存在的核心理由,PCM 已經在往這個方向長,值得正式立項而非繼續各自刻。

2. **媒體庫(Media Library)頁面**:目前 R2 只是儲存,PCM 後台大概率沒有一個「搜尋/篩選/alt text/替換/使用位置」的媒體庫 UI(Medusa 核心也不提供這層,純靠自建)。沒有這個,圖片重複上傳、alt text 缺失(影響 SEO/無障礙)、孤兒檔案難清理都會持續累積。

3. **URL Redirect(301 轉址)管理表**:PCM 商品/分類已有改 handle/slug 的歷史(見 memory `reference_nextjs-duplicate-query-key-segment-collision.md`、分類樹調整記錄),若後台沒有一張 `path → target` 的轉址表 + 改 handle 時提示/自動建立,舊連結全部 404,SEO 排名與外部連回連結都會斷——這是「量小但漏了就是大洞」的典型。

4. **週期性彙總通知(Store order summary 類)**:PCM 的 email_outbox 目前只做事件觸發信,沒有 Shopify 那種「每週一 9AM 自動寄一封本週訂單/營收/熱銷摘要」給老闆的機制。這對 Sean 這種要盯營運數字的老闆特別有用,且和既有 pcm-monthly-report skill 的精神一致,可以考慮做成排程信而非只能手動跑報表。

5. **稽核紀錄(Activity Log)最小版**:誰在後台改了什麼、什麼時候——目前不確定 pcm-admin 有沒有這層(見「未確認清單」#11)。不需要做到 Shopify 那種完整分類,但金流/tier/退款這幾個高風險操作(PCM 鐵則 12 六類本身就點名的範圍)至少要有「誰在什麼時候改了什麼值,改前改後」的最小 log,這對應 Sean 本來就要求的「bug 可追蹤性」三視角檢查,現況若無此機制是明確缺口。
