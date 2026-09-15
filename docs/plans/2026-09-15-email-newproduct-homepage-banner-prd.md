# PRD:廠商新品信 → 首頁大圖草稿 → Sean 按「發布」

> 2026-09-15 起草。只是需求文件,還沒寫任何程式,也還沒動 DB。
> 依據:Sean 2026-09-15 的拍板(每天自動讀廠商新品信、只做草稿、Sean 在後台按發布才上線;第一階段首頁大圖,第二階段 FB/IG)。
> 行號都是 2026-09-15 `dev` @ `4a5dc5b09` 當下查到的;標「未確認」的是沒有親自驗過的。
> 碰 schema / RPC / cron / 對外發布 ⇒ 開工前照鐵則 8 另寫 plan 給 Sean 批,碰權限與發布的片照鐵則 12 審一輪。

---

## 0. 現況(查到的事實)

| 題目 | 現況 | 出處 |
|---|---|---|
| 首頁大圖怎麼做 | `HomeHero` 是**寫死**的四張輪播,文案寫在 `SLIDES` 常數裡,圖是 `public/hero/hero-01.jpg`~`04`(外加 `-m` 手機版) | `apps/storefront/src/components/HomeHero.tsx:13-21`、`:146-147`;`apps/storefront/public/hero/` |
| 大圖有沒有連結 | 查 `HomeHero.tsx:120-194` 沒有 `href` / `Link`,大圖本身點不下去;選車器是以 children 塞進 hero | `apps/storefront/src/app/page.tsx:87-93` |
| 首頁快取 | 整頁 `force-dynamic`,每次請求都重跑;「最新商品」走內層 `unstable_cache` 60 秒 | `page.tsx:46`;`apps/storefront/src/lib/products.ts:315`、`:397-398` |
| 有沒有後台管的內容表 | **沒有**。479 支 migration 裡 `CREATE TABLE` 名稱含 banner / hero / homepage / content / announce / promo / setting 的 = 0 筆。品牌介紹、品牌焦點也是 TS 寫死 | `grep` supabase/migrations;`apps/storefront/src/data/brand-content.ts`、`brand-focus.ts` |
| 後台寫入授權 | `authorizeAdminMutation()`:session 自驗 + Origin fail-closed + 具名員工;管理者另一道 `authorizeManagerMutation` | `apps/admin/src/lib/session/authorize.ts:31`、`:99`;`apps/admin/src/lib/staff.ts:206` |
| 畫面上「是不是管理者」 | `resolveManagePermission()` 三態 yes / no / unknown(不是安全邊界) | `apps/admin/src/lib/session/resolve-manage-permission.ts:14` |
| 可抄的後台 CRUD | 供應商設定頁:server component + 網址驅動彈窗 `?new=1` / `?edit=<id>`,改名停用只給管理者 | `apps/admin/src/app/settings/suppliers/page.tsx` |
| 可抄的 server action | `'use server'` → `authorizeAdminMutation()` → RPC(稽核寫在 RPC 裡)→ `revalidatePath` | `apps/admin/src/lib/products/product-listing-actions.ts:1`、`:50`、`:155` |
| 稽核表 | `admin_audit_log`(actor / action / target / before / after / request_id) | `supabase/migrations/20260712210000_m4a_admin_audit_log.sql:43` |
| 側欄 | 主軌 5 格 + 「設定」群組(員工 / 供應商 / 優惠券 / 寄不出去的信 / 匯率 / 事故紀錄) | `apps/admin/src/components/layout/nav-items.ts:55-76`;Sean 0914 Q1 甲「側欄 6 項維持」 |
| 前台篩選網址 | `?pbrands=a,b`(品牌 slug)、`?categories=a,b` / 舊 `?category=`、`?search=`、`?filter=new`(唯一白名單值)、`?vehicle=`;全部可同時解析 | `apps/storefront/src/lib/catalog-query.ts:16`、`:79`、`:121`、`:123`、`:240-282`;導覽列 `Header.tsx:173` |
| 有 `search` 時 | 走另一條資料路(ILIKE),**`search` + `pbrands` 疊在一起會不會一起縮小:未確認** | `catalog-query.ts:65-79` 註解 |
| 圖片放哪 | 商品圖是 `products.images` jsonb 裡的網址,多半是廠商站的圖(程式裡有擋 `extreme-components.com/…/noimage.jpg`)。`brands.logo_url` 註解寫 Supabase Storage,但 apps 程式裡 `storage.from(` = 0 筆 ⇒ **目前沒有程式在用 Supabase Storage**;另有一支 migration 收掉 anon 對 storage 的寫權 | `init_products.sql:32`;`products.ts:383-384`;`20260505130758_init_brands_categories.sql:27`;`20260905120000_m4b_storage_revoke_anon_write.sql:123` |
| 圖片縮圖 | `next.config.ts` 沒有 images 設定;Sean 0915 Q6 乙「Vercel 縮圖不做」 ⇒ **本案不提** | memory `project_0915-night-eleven-questions.md:15` |
| 排程 | **不用 Vercel cron**(`vercel.json` 無 crons)。做法是 pg_cron → `pcm_cron.invoke_cron_route('/api/cron/…')` → pg_net 帶 vault 裡的 `cron_secret` 打 storefront 的 route | `20260723120000_m3_s2_settle_sweep_pgcron.sql:95-133`;`20260819160000_m4a_e2b_email_sweep_pgcron.sql:213` |
| cron route 範本 | `GET` + `CRON_SECRET` Bearer timingSafeEqual、`runtime='nodejs'`、`maxDuration=60` | `apps/storefront/src/app/api/cron/email-sweep/route.ts:23`、`:89`、`:98`、`:500` |
| 寄信 | Resend(`RESEND_API_KEY`),經 email_outbox + sweep | `apps/storefront/src/lib/email/composition.ts:3-10` |
| Gmail | **完全沒有**。apps / packages / scripts / migrations 搜 gmail、googleapis、google-auth-library = 0 | `grep` |
| AI | **沒有**任何 LLM SDK 依賴(package.json 搜 anthropic / openai / ai = 0) | `grep` |
| 商品配對鍵 | `product_variants` 有 `UNIQUE (supplier_slug, sku)`;`products.brand_id → brands.slug` | `20260602192455_s3a_composite_keys_drop_rpm_prefix.sql:58`;`init_products.sql:34`;`init_brands_categories.sql:25` |
| 供應商表 | `suppliers` 只有 label / is_active,**沒有寄件信箱、沒有對應品牌**;它跟 `product_variants.supplier_slug` 怎麼對應:未確認 | `20260801140000_m4b_e10_s1a_suppliers.sql:30` |
| design 稿 | `design-reference/` 裡沒有「首頁新品橫幅」的稿 ⇒ 鐵則 1 要先有 OD 稿 | `grep banner design-reference` 只命中錢包 / 商品頁無關字 |

---

## 1. 目標與不做什麼

**目標**
1. 廠商寄新品信到 sean@pcmmotorsports.com,隔天早上後台就有一張「首頁大圖草稿」:圖、標題、副標、連到篩好的商品列表。
2. Sean 看過、改字、勾「圖文授權已確認」、按**發布**,首頁才出現。可設上架 / 下架時間,可手動下架。
3. 就算沒有信,Sean 也能在同一頁手動新增大圖(同一套 CRUD)。
4. 首頁沒有已發布大圖時,長得跟今天一模一樣。

**不做什麼**
- 不自動發布。任何路徑都不能讓草稿不經人按鈕就上首頁。
- 不存信件全文、不存附件、不回信、不動信箱(不標已讀、不刪、不搬)。
- 不做 Vercel 圖片縮圖(Q6 乙)。
- 第一階段不發 FB / IG,只留欄位不接 API。
- 不自動上架商品、不改商品資料。配不到商品就標出來給 Sean 看。
- 不做 A/B、點擊統計、多語系。

---

## 2. 使用流程

**Sean 每天**
1. 早上打開後台 → 設定 → 「首頁大圖」。上面一條字:「今天新進 3 張草稿(另 1 封信讀不懂,點開看)」。
2. 點一張草稿 → 右邊彈窗:看圖、看配到哪些商品、改標題副標、確認連結點下去是對的列表。
3. 勾「我確認這家廠商的圖文可以用」→ 選上架時間(預設現在)與下架時間(預設 14 天後,Q 待答)→ 按「發布」。
4. 不要的按「封存」。

**後台畫面(文字線框)**

```
設定 › 首頁大圖                                  [+ 手動新增]
─────────────────────────────────────────────────────────────
[草稿 3] [已發布 1] [已排程 0] [已封存]      今天 08:00 讀信:4 封 / 3 張草稿 / 1 封失敗 ▸

 縮圖      標題                    來源              配到商品   狀態    上/下架
 ▢▢▢      Akrapovic 2027 新款尾段   信:Akrapovic 9/15  6 件      草稿    —
 ▢▢▢      RIZOMA 新色把手           信:Rizoma 9/14     0 件 ⚠    草稿    —
 ▢▢▢      (手動)秋季改裝季          —                 —         已發布  9/10 → 9/24
```

```
編輯大圖(彈窗)
─────────────────────────────────────────────
預覽  [桌機圖 ▢▢▢▢▢▢]  [手機圖 ▢▢▢]
桌機圖網址 [__________]  手機圖網址 [__________](空白 = 用桌機圖)
眉標   [AKRAPOVIC ‧ 新品到貨]
標題   [第一行______] [第二行______]      ← 跟現有 hero 一樣兩行寫死斷行
按鈕字 [看新品]
連結   品牌 [Akrapovic ▾]  分類 [排氣系統 ▾]  關鍵字 [____]  □只看新品
       → /products?pbrands=akrapovic&categories=排氣系統   [在新分頁打開]
配到商品:6 件(列出料號 / 品名,點得開)
來源信:Akrapovic <news@…>  主旨「New for 2027…」 9/15 06:12   解析說明 ▸
授權:此廠商設定 = 每次確認   □ 我確認圖與文字可以用(必勾)   備註 [____]
上架 [2026-09-16 00:00]  下架 [2026-09-30 00:00]
                                   [封存]  [存草稿]  [發布](管理者才看得到)
```

---

## 3. 資料結構(草案,要走板)

**3.1 `home_banners`**

| 欄位 | 型別 | 說明 |
|---|---|---|
| id | uuid PK | |
| status | text CHECK in (`draft`,`published`,`archived`) | 「已排程」= published 且 starts_at 在未來,不另開狀態 |
| eyebrow / title_line1 / title_line2 / cta_label | text | 長度上限用 CHECK |
| link_path | text NOT NULL | **只准站內相對路徑**:CHECK `link_path ~ '^/[^/]'`(擋 `//evil.com` 與外站) |
| image_desktop_url / image_mobile_url | text | https 才收;mobile 可空 |
| image_origin | text CHECK in (`supplier_url`,`storage`) | 看 Q2 |
| rights_confirmed | boolean NOT NULL DEFAULT false | 發布 RPC 要求 true |
| rights_note | text | Sean 的備註 |
| starts_at / ends_at | timestamptz | ends_at > starts_at;發布時 starts_at 必填 |
| sort_order | int | 看 Q9 |
| source_email_id | uuid FK → `supplier_inbound_emails.id` NULL | 手動新增為 NULL |
| matched_variant_ids | uuid[] | 配到的商品,給畫面看 |
| created_by | text | `system:mail-draft` 或員工 id |
| reviewed_by / published_by / published_at / archived_by / archived_at | text / timestamptz | |
| created_at / updated_at | timestamptz | |

- 表本身 anon / authenticated 零權限;寫入只走 SECURITY DEFINER RPC(`home_banner_save_draft` / `home_banner_publish` / `home_banner_unpublish` / `home_banner_archive`),EXECUTE 只給 service_role,每支寫 `admin_audit_log`(抄 `product-listing-actions.ts` 那條路)。
- 前台讀一支 view `home_banners_live_v`:`status='published' AND starts_at <= now() AND (ends_at IS NULL OR ends_at > now())`,只露前台要的欄位(不露 source_email_id、審核人)。GRANT 寫法先查 `docs/patterns/revoking-function-execute-in-supabase.md`。

**3.2 `supplier_mail_senders`(寄件者白名單)**

| 欄位 | 說明 |
|---|---|
| id uuid PK | |
| supplier_id uuid FK → suppliers NULL | |
| sender text | 完整信箱或 `@網域`;小寫、trim |
| brand_slugs text[] | 這家信通常講哪些品牌(配對與連結用) |
| rights_policy text CHECK in (`allowed`,`ask_each_time`,`not_allowed`) | `not_allowed` ⇒ 只出文字草稿、不帶圖 |
| rights_evidence text | 條款網址或「某年某月 email 同意」 |
| is_active boolean | |

**3.3 `supplier_inbound_emails`(只存必要欄位)**

| 欄位 | 說明 |
|---|---|
| id uuid PK | |
| gmail_message_id text UNIQUE | **去重鍵** |
| gmail_thread_id text | |
| sender text / subject text / received_at timestamptz | |
| sender_id FK → supplier_mail_senders NULL | |
| auth_passed boolean | SPF / DKIM 是否對齊寄件網域(見 §4) |
| status text CHECK in (`drafted`,`no_products`,`skipped_sender`,`skipped_auth`,`failed`) | |
| extracted jsonb | 抽出的品名 / 料號 / 圖網址 / 廠商連結;**不含信件內文** |
| error_code text | 只放分類,不放內容 |
| created_at | |

保留 90 天後由同一支 cron 刪(天數看 Q8)。

---

## 4. 每日 email → 草稿 流程

1. **觸發**:pg_cron 每天台灣 08:00(UTC 00:00)跑 `pcm_cron.invoke_cron_route('/api/cron/supplier-newproduct-drafts')`,新 route 抄 `email-sweep/route.ts` 的 CRON_SECRET 閘與 `maxDuration=60`。排程本身是 migration ⇒ 走板。
2. **拿信**:Gmail API `users.messages.list`,查詢式 `label:PCM新品 newer_than:3d`(Sean 在 Gmail 設篩選器貼標籤;3 天重疊是為了補前一天失敗)。**只讀 `gmail.readonly`**。一輪最多處理 20 封,超過留到下一輪(60 秒上限)。
3. **去重**:`gmail_message_id` 已在 `supplier_inbound_emails` ⇒ 跳過。INSERT 用 `ON CONFLICT DO NOTHING`,兩輪重疊也不會出兩張草稿。
4. **篩寄件者**(兩道都要過):
   - From 位址對上 `supplier_mail_senders`(完整信箱或網域)。沒對上 ⇒ `skipped_sender`。
   - 讀 Gmail 已經算好的 `Authentication-Results` 標頭,DKIM 或 SPF pass 且網域與 From 對齊 ⇒ 才算。不過 ⇒ `skipped_auth`(擋冒名寄信)。
5. **解析**(不存全文,在記憶體裡處理完就丟):
   - 取 `text/plain`;沒有就把 HTML 去標籤。
   - 抽圖:HTML 裡 `<img src>` 取 https、寬 ≥ 800(有寫 width 才判;沒寫的留著給 Sean 挑),排除追蹤像素(1×1、網址含 open / track)。
   - 抽連結:廠商商品頁網址。
   - 抽料號:用 `supplier_mail_senders.brand_slugs` 找出這些品牌現有 `product_variants.sku` 的長相,再在內文與連結裡找同樣長相的字串。
6. **配對商品**:料號 ∈ `product_variants.sku` 且品牌對得上 ⇒ 配到。
   - 配到 ≥1 件且同一品牌 ⇒ 連結 `/products?pbrands=<slug>`,多件同分類再加 `&categories=<分類>`。
   - 配到 0 件(常見:廠商先發信、我們還沒匯入)⇒ status `no_products`,草稿照出、連結先放 `/brands/<slug>`(品牌頁存在才放)、畫面標 ⚠,看 Q6。
   - 🔴 `search` 跟 `pbrands` 疊著用會不會一起縮小:未確認,實作第一片先驗,驗完才讓連結產生器用 `search`。
7. **起草文字**:看 Q4。若用 AI:只送主旨 + 純文字前 2,000 字 + 已配到的品名,要它回 JSON(eyebrow / 兩行標題 / 按鈕字),**連結與圖一律由程式決定、不讓 AI 產**。AI 輸出只當草稿文字,畫面用純文字渲染。
8. **寫草稿**:呼叫 `home_banner_save_draft`(created_by = `system:mail-draft`),`rights_confirmed` 永遠 false。
9. **失敗處理**:
   - 單封失敗 ⇒ 該封 `failed` + error_code,繼續下一封。下一輪不會重試已記錄的 id;Sean 在後台「讀不懂的信」按「重跑這封」(清掉那列再跑)。
   - Gmail 權杖失效 / API 掛 ⇒ 整輪停,後台頂部紅字「今天沒讀到信:授權失效」,並沿用現有告警管道寄一封給 Sean(告警管道位置:`composition.ts:81` 附近,細節未確認)。
   - 同一天連 3 次失敗不重試,等人看。

---

## 5. 首頁怎麼讀已發布的大圖

- `page.tsx` 的 `Promise.all` 多一支 `fetchLiveBanners()`,讀 `home_banners_live_v`,包 `unstable_cache` 60 秒(跟最新商品同一個節奏)。
  - 後台與前台是兩個 app,後台按發布**打不到前台的 revalidateTag** ⇒ 發布後最慢約 1 分鐘出現,畫面上寫明「約 1 分鐘內生效」。
  - 上下架時間在 view 裡用 `now()` 判;加上 60 秒快取,實際上下架誤差 ≤ 60 秒。
- 讀取失敗 ⇒ 當作沒有大圖,首頁照舊,server log 記一行分類(不印內容)。不讓首頁 500。
- 沒有大圖 ⇒ 現有四張輪播完全不變(預設)。
- 放在哪裡看 Q1;不論哪種都要先出 OD 稿(鐵則 1)。
- 圖用原生 `<img>` + `<picture>` 手機圖(跟 `HomeHero.tsx:146-147` 同寫法),不接 Vercel 縮圖;上傳 / 選圖時限制檔案大小(例如 ≤ 500KB,數字待定),避免拖慢首屏。
- 連結只吃 `link_path`(DB 已擋外站),`<a href>` 前端再驗一次開頭是 `/`。

---

## 6. 權限與安全

- **誰能發布**:看 Q5,推薦只有管理者 ⇒ 發布 / 下架 action 走 `authorizeManagerMutation`,畫面用 `resolveManagePermission` 藏鈕;草稿存檔所有員工可做。
- **DB 層**:三張表 anon / authenticated 零權限;RPC 只給 service_role;前台只讀 view。發布 RPC 自己再擋一次 `rights_confirmed = true` 與 `starts_at` 必填,不信 client。
- **Gmail 權限最小化**:只要 `gmail.readonly`;只讀有 `PCM新品` 標籤的信;不要 `gmail.modify` / `send`。權杖放 Supabase vault(跟 `cron_secret` 同一種放法)或 storefront 的 Vercel env,**不進 client bundle、不進 repo、不印進 log**。看 Q3。
- **不存信件全文**:只存 §3.3 那幾欄;`extracted` 裡不放信件內文、不放收件人清單、不放廠商業務的個人電話。
- **個資**:廠商寄件者是公司信箱,屬業務聯絡資料;不存個人姓名以外的東西。Gmail 其他信(客人信、私人信)因為查詢式只抓標籤,程式碰不到。
- **冒名與注入**:SPF/DKIM 對齊才收;信件文字只當 AI 輸入的資料、不當指令;連結與圖片網址由程式從白名單流程產生。
- **稽核**:存草稿 / 發布 / 下架 / 封存都寫 `admin_audit_log`。

---

## 7. 需要 Sean 準備的東西

1. **Google 授權**(看 Q3,以推薦甲為例):
   - Google Workspace 管理員登入 Google Cloud Console → 建一個專案 → 開 Gmail API。
   - OAuth 同意畫面選「內部」(只限 pcmmotorsports.com)。 ※「內部 app 不用 Google 審核、refresh token 不會 7 天過期」是我的理解,**未確認**,開工第一步查官方文件。
   - 建 OAuth 用戶端,拿到 client id / secret,由 Sean 自己放進 Vercel env(不要貼在對話)。
   - 用 sean@ 登入授權一次拿 refresh token(可用 Google 官方 OAuth Playground,不必我們加腳本),一樣自己放進 env / vault。
2. **Gmail 篩選器**:把各廠商新品信貼上 `PCM新品` 標籤。
3. **廠商寄件者清單**(填成表,我們匯進 `supplier_mail_senders`):

   | 廠商 | 寄件信箱或網域 | 對應品牌 | 圖文可以用嗎(可以 / 每次確認 / 不行) | 依據(條款網址或同意信) |
   |---|---|---|---|---|

4. **圖片授權確認方式**:每家先填上表的「依據」;沒有依據的一律「每次確認」,發布時勾選 + 備註。
5. **最近 5–10 封真實新品信**:轉寄或在 Gmail 標好,給解析片做樣本(會去掉個資後才進測試)。
6. 回答 §10 的題目。

---

## 8. 分片實作順序

| # | 片 | 時間 | 類型 |
|---|---|---|---|
| 0 | OD 出「首頁新品大圖」稿(看 Q1) | — | 設計,不寫碼;沒稿不開工第 5 片 |
| 1 | plan:三張表 + view + 4 支 RPC + GRANT(鐵則 8) | 30 分 | 文件,等 Sean 批 |
| 2 | migration:`home_banners` + view + RPC + rollback | 45 分 | **schema / 走板 / 審一輪(權限)** |
| 3 | 後台「首頁大圖」列表頁 + 側欄入口(看 Q7) | 30 分 | 純 TS |
| 4 | 手動新增 / 編輯彈窗 + 連結產生器(品牌 / 分類 / 關鍵字下拉)+ 存草稿 action;先驗 `search`+`pbrands` 疊加 | 45 分 | 純 TS |
| 5 | 首頁讀 view + 大圖元件 CSS/TSX + 沒大圖時照舊 | 45 分 | 純 TS/CSS(**對外可見 / 審一輪**) |
| 6 | 發布 / 下架 / 封存 action(管理者閘、授權必勾、排程時間) | 30 分 | 純 TS(**對外發布 / 審一輪**) |
| — | 🟢 **到這裡 Sean 可以先手動用**,走一遍:新增 → 發布 → 首頁看到 → 點連結 → 下架 | | |
| 7 | migration:`supplier_mail_senders` + `supplier_inbound_emails` | 30 分 | **schema / 走板** |
| 8 | 後台寄件者白名單頁(抄供應商頁) | 30 分 | 純 TS |
| 9 | Gmail 讀信 client(fetch 換 access token + list/get,不加新套件)+ env | 30 分 | 純 TS(**env / 審一輪**) |
| 10 | 解析 + 寄件者 / SPF·DKIM 判定 + 料號配對 + 連結產生(用第 7 項的樣本信寫測試) | 45 分 | 純 TS |
| 11 | 起草文字(規則版;若 Q4 乙再加 AI 呼叫) | 30–45 分 | 純 TS(乙要加 API key ⇒ env) |
| 12 | cron route `/api/cron/supplier-newproduct-drafts`(CRON_SECRET、去重、失敗分類、90 天清理) | 45 分 | 純 TS |
| 13 | migration:`cron.schedule` 每天 00:00 UTC | 15 分 | **schema / 走板**(板先貼、再推碼) |
| 14 | 後台頂部「今天讀信結果」+ 「讀不懂的信」清單與重跑 | 30 分 | 純 TS |
| 15 | (若 Q2 甲)Supabase Storage bucket + 發布時複製圖 | 45 分 | **storage 權限 / 走板 / 審一輪** |
| — | 🟢 Sean 走一遍:收到真信 → 隔天草稿 → 發布 → 首頁 | | |

備註:codex 額度到 09-20 12:12 用完(memory `project_0911-codex-quota-fable-as-second-review.md`),之前的審查走 adversarial-reviewer。

---

## 9. 第二階段:FB / IG(只列大綱)

- **帳號**:Meta 商業管理平台(Business Manager);FB 粉專與 IG 專業帳號互相連結;商家驗證。
- **App**:建 Meta App(商業類型),申請 `pages_manage_posts`、`pages_read_engagement`、`instagram_basic`、`instagram_content_publish`,要過 App 審核(要錄操作影片)。權限名稱與審核流程**未確認**,開工前查 Meta 官方文件。
- **權杖**:用商業管理平台的「系統使用者」長效權杖,存 vault / env;不用個人帳號權杖(會跟人走、會過期)。
- **發文限制**:IG 發文要一張**公開可抓的 JPEG 網址** ⇒ 跟 Q2 綁在一起,圖若只連廠商網址很可能發不出去。IG 每日發文上限有數字(未確認)。
- **資料**:`home_banners` 旁邊加 `social_posts`(banner_id、channel fb/ig、caption、status draft/published/failed、external_post_id、published_by / at)。一樣草稿 → Sean 按發布。
- **授權**:社群發文等於再散佈廠商圖文,授權門檻比首頁高;`rights_policy` 可能要分「官網可 / 社群可」兩欄。

---

## 10. 風險與未決問題(給 Sean)

**會改方向的先問**

```
Q1:新品大圖放首頁哪裡?
A: 甲|乙
  甲 塞進現在的 hero 輪播,當第一張(選車器照舊壓在上面,廠商圖會被選車器蓋掉一塊)
  乙 hero 下面另開一條「新品」橫幅,現在的輪播不動
  推薦 乙:hero 那四張是品牌宣言、斷行寫死;廠商圖比例不一,放下面比較不會壞版。兩個都要先出 OD 稿。
```

```
Q2:大圖用的圖放哪?
A: 甲|乙
  甲 按發布時複製一份到我們自己的 Supabase Storage
  乙 直接連廠商網站的圖
  推薦 甲:廠商換圖或刪圖首頁就破圖;客人瀏覽紀錄也不會送到廠商那邊;第二階段 IG 也要穩定網址。代價是多一片 storage 權限要走板。
```

```
Q3:Gmail 授權用哪種?
A: 甲|乙
  甲 只授權 sean@ 一個信箱(OAuth,權杖放 env / vault)
  乙 服務帳號 + 全網域委派(可以讀公司任何人的信)
  推薦 甲:權限最小;乙一旦外洩等於全公司信箱都可讀。
```

```
Q4:草稿文字要不要用 AI 寫?
A: 甲|乙
  甲 不用 AI:程式抓料號配商品,標題先放信件主旨,Sean 自己改
  乙 用 Claude API 起草眉標 / 兩行標題 / 按鈕字(只送主旨 + 內文前段,連結和圖由程式決定)
  推薦 乙:廠商信多半英文或義大利文,甲的草稿幾乎每張都要重打;乙要多一把 API key、每月少量費用。
```

```
Q5:誰可以按「發布」?
A: 甲|乙
  甲 只有管理者;一般員工只能存草稿
  乙 所有員工都可以發布
  推薦 甲:這是對外公開、還牽涉廠商授權。
```

**細節**

```
Q6:商品還沒匯入(配到 0 件)的草稿可以發布嗎?
A: 甲|乙
  甲 可以,連結改到品牌介紹頁 /brands/<品牌>(沒有品牌頁就不准發)
  乙 不行,一定要配到商品才准發
  推薦 甲:廠商常常先發信、我們晚幾天才上架,甲可以先預告。
```

```
Q7:後台入口放哪?
A: 甲|乙
  甲 放「設定」群組裡(側欄維持 6 項)
  乙 主軌多一格「首頁大圖」
  推薦 甲:對齊 0914 Q1 甲側欄 6 項。
```

```
Q8:讀過的信留多久紀錄?
A: 甲|乙
  甲 只存主旨 / 寄件者 / 時間 / 抽出的料號與圖網址,90 天後刪
  乙 另外存信件全文,方便日後重跑
  推薦 甲:少存少風險;要重跑時 Gmail 裡的原信還在。
```

```
Q9:首頁同時可以掛幾張?
A: 甲|乙
  甲 一次一張,發布新的會自動把舊的下架
  乙 可以多張輪播
  推薦 甲:第一版最簡單;真的常常同時有好幾家新品再改乙。
```

```
Q10:沒填下架時間時預設多久?
A: 甲|乙
  甲 14 天後自動下架
  乙 不自動下架,一直掛到有人按下架
  推薦 甲:新品大圖放太久會變舊聞,忘了下架也不會一直掛著。
```

**其他風險(不用答,開工時處理)**
- 廠商信格式五花八門,料號抽不到的比例可能很高 ⇒ 第 10 片用 Sean 給的真信當樣本,抽不到就在草稿標 ⚠,不猜。
- 冒名寄信:SPF/DKIM 判定依賴 Gmail 的 `Authentication-Results` 標頭格式,解析要寫測試。
- 大圖檔案太大會拖慢首頁(沒有縮圖)⇒ 發布時擋檔案大小。
- 發布後最慢約 1 分鐘才出現在首頁(兩個 app 之間沒辦法即時清快取)。
- `search` + `pbrands` 疊加行為未確認(§4 第 6 步)。
- `suppliers` 與 `product_variants.supplier_slug` 的對應未確認,白名單表先用 `brand_slugs` 自己帶,不靠那層對應。

---

## 11. Sean 拍板(2026-09-15 23:5x–00:0x)

- §10 十題答「乙」:**Q1 大圖直接混進既有首頁輪播**(不另開一條);**Q7 後台入口放主側欄**(不放設定群組);其餘 Q2–Q6、Q8–Q10 照推薦(圖複製到自家空間 / Gmail 只授權 sean@ / Claude 起草 / 限管理者發布 / 配不到商品可連品牌頁 / 信件只存必要欄位 90 天 / 一次一張 / 14 天自動下架)。
- **每日 email → 草稿跑在網站雲端排程**(pg_cron → 前台 cron route,同既有 email-sweep 形狀),不放 mac mini、不靠任何一台電腦開著(Sean 甲)。
- ⇒ 開工前:OD 出輪播混合版的橫幅稿(鐵則 1);Sean 準備 Google Workspace 的 Gmail 唯讀授權 + 各廠商寄件者清單。

---

## 12. Gmail 唯讀授權怎麼設(給 Sean 一步一步做)+ 片 4 骨架狀態(2026-09-16 施工窗)

### 12.1 先講結論

- **用「OAuth · 內部 app」,只授權 sean@ 一個信箱。** 這就是你 §11 已經拍的 Q3 甲,這裡只是把步驟寫出來。
- 另一種「服務帳號 + 全網域委派」**不建議**,理由在 12.2。

### 12.2 兩種做法,白話比一次

| | 甲 OAuth · 內部 app(推薦,§11 已拍) | 乙 服務帳號 + 全網域委派 |
|---|---|---|
| 讀得到誰的信 | **只有 sean@**(你登入授權的那個人) | **公司網域裡任何人**(委派是整個網域一起開) |
| 鑰匙外洩會怎樣 | 別人讀得到 sean@ 的信(唯讀) | 別人讀得到**全公司每個信箱**(唯讀) |
| 要不要 Workspace 管理員 | 要登 Google Cloud 建專案;不用開委派 | 要進 Workspace 管理控制台開「全網域委派」 |
| 會不會過期 | refresh token 長期有效;你改 Google 密碼、撤銷授權、或 6 個月沒用會失效(⚠️ 規則以 Google 文件為準,**未確認**,開工第一步查) | 金鑰檔不會自己過期,但要自己輪替 |
| 失效時的樣子 | 今天:那一輪回 503 + log 寫 `gmail_auth_failed`(後台顯示「授權失效」是 §8 #14 那一片);你重做一次 12.3 第 5–6 步 | 同 |

### 12.3 甲的步驟(大約 15 分鐘)

1. 用 **sean@pcmmotorsports.com** 登入 [Google Cloud Console](https://console.cloud.google.com/),上方「選取專案 → 新增專案」,名稱例如 `pcm-mail-drafts`。
2. 左邊「API 和服務 → 程式庫」,搜尋 **Gmail API**,按「啟用」。
3. 「API 和服務 → OAuth 同意畫面」(Google 新版介面把這一區叫「Google Auth Platform」,名字對不上就找它):
   - 使用者類型選 **內部**(只有 pcmmotorsports.com 的人能授權)。
   - 應用程式名稱填 `PCM 新品信讀取`,支援信箱填 sean@。
   - 範圍(Scopes)只加一個:**`https://www.googleapis.com/auth/gmail.readonly`**。不要加任何寄信、修改、刪除的範圍。
4. 「API 和服務 → 憑證 → 建立憑證 → OAuth 用戶端 ID」:
   - 類型選「網頁應用程式」。
   - 「已授權的重新導向 URI」加:`https://developers.google.com/oauthplayground`
   - 建好會出現 **用戶端 ID** 與 **用戶端密鑰** —— 先不要關視窗,也**不要貼到對話或任何聊天室**。
5. 開 [OAuth 2.0 Playground](https://developers.google.com/oauthplayground):
   - 右上齒輪 → 勾「Use your own OAuth credentials」→ 貼上第 4 步的用戶端 ID 與密鑰。
   - 左邊「Input your own scopes」貼 `https://www.googleapis.com/auth/gmail.readonly` → 按「Authorize APIs」→ 用 sean@ 登入並允許。
6. 回到 Playground 按「Exchange authorization code for tokens」,畫面會出現 **Refresh token**。
7. 把三個值放進 **Vercel → 顧客站(storefront)專案 → Settings → Environment Variables → Production**(名字照抄,值你自己貼):

   | 名字 | 值從哪來 |
   |---|---|
   | `GMAIL_OAUTH_CLIENT_ID` | 第 4 步的用戶端 ID |
   | `GMAIL_OAUTH_CLIENT_SECRET` | 第 4 步的用戶端密鑰 |
   | `GMAIL_OAUTH_REFRESH_TOKEN` | 第 6 步的 Refresh token |
   | `ANTHROPIC_API_KEY` | Claude API key(Anthropic Console 建;名字**暫定**,要換名字跟主視窗說) |
   | `SUPPLIER_MAIL_DRAFTS_ENABLED` | **先不要設**。全部準備好、要開跑那天才設 `on` |

   ⚠️ Vercel 改完 env 要**重新部署一次**才會生效。

8. Gmail 設篩選器:廠商新品信 → 「套用標籤」**`PCM新品`**(程式只讀這個標籤、最近 3 天)。
9. 把各廠商寄件者清單填成 §7 第 3 點那張表,交給施工窗放進 `apps/storefront/src/data/supplier-mail-senders.ts`。

### 12.4 乙的步驟(只列大綱,不建議)

Google Cloud 建服務帳號 + 金鑰 JSON → Workspace 管理控制台「安全性 → API 控制 → 全網域委派」加那個服務帳號的用戶端 ID 與 `gmail.readonly` → 程式用金鑰「冒充」sean@ 讀信。⚠️ 委派一旦開,那把金鑰可以冒充網域裡任何人。

### 12.5 片 4 骨架目前做到哪(2026-09-16)

- ✅ cron route `/api/cron/supplier-newproduct-drafts`:`CRON_SECRET` 閘;**預設關**(`SUPPLIER_MAIL_DRAFTS_ENABLED` 不是 `on` ⇒ 不讀信);env 缺 ⇒ 只 log 缺哪幾個【名字】並跳過;白名單空 ⇒ 跳過。
- ✅ 流程(`packages/use-cases/src/draft-supplier-newproduct-banners.ts`):列信 20 封 → 去重 → 白名單 → **只信 Gmail 自己寫的那條驗證結果**(`mx.google.com`;信裡自己塞的不算、顯示名稱藏假信箱也擋)→ 抽料號與圖(排除追蹤像素、小圖、過長網址)→ 配商品 → Claude 起草(失敗或超過 10 秒用主旨)→ 記信 + 建草稿;45 秒後不再開始新的一封(剩下下一輪讀);測試用假 Gmail / 假 Claude / 假 DB 端到端跑過。⚠️ 經過轉寄的廠商信會被當成驗證不過(寧可漏,不要被冒名)。
- ✅ Gmail(fetch + refresh token)、Claude(fetch,`claude-sonnet-5`)、DB 讀寫的 adapter 寫好,**都還沒真的連過**。
- ✅ 寄件者白名單:`apps/storefront/src/data/supplier-mail-senders.ts`,**空的** + 範例。
- ❌ **系統建草稿還沒接**:`admin_home_banner_save_draft` 要在職員工當 actor,系統進不去;要另開一支 RPC(記信 + 建草稿同一個交易)⇒ migration,下一片走板。在那之前,旗標就算開,每封會記成 `failed`(`draft_sink_not_wired`),看得見、不假裝成功。
- ❌ 排程(pg_cron 每天 08:00 台北打這支 route)還沒建 ⇒ migration,§8 #13。
- ❌ 圖複製到自家空間(Sean Q2 甲)⇒ §8 #15。
- ❌ **記成 failed 的信今天會永遠跳過**(去重看的是「有沒有那一列」,service_role 沒有 UPDATE)⇒ 系統建草稿那支 RPC 的 plan 要一起決定重跑規則(排除 failed 重讀,或 RPC 用 upsert)。
- 🛑 **開旗標之前**:系統建草稿 RPC、排程、90 天清理排程(§8 #12/#13)都要先到;否則信件紀錄不會被清,違反 Sean Q8。
