# 首頁大圖「複製成新草稿」plan(2026-09-16 設計窗)

> 鐵則 8 的 plan。**Sean 批了才動碼。** 現在零改碼。
> 起因:Sean 2026-09-16 逐字「**我無法再上架時候改, 下架也沒辦法再改 然後上架**」——
> 他建了第一張大圖、發現文案要改,而**改不動**。

## 0. 先講一句:這不是壞掉,是從來沒做過

全庫 grep `duplicate|copy|clone|複製|unarchive|restore|回到草稿` ⇒ **0 命中**。
⇒ 📌 **這個功能沒有人做過。** 不是 regression,是一條沒鋪的路。

## 1. 根因(讀的是**活的正式庫** `prosrc`,不是 repo 的 migration)

```
admin_home_banner_save_draft   IF v_before.status <> 'draft' THEN RAISE '只有草稿可以修改(這張是 %)'
admin_home_banner_publish      IF v_before.status <> 'draft' THEN RAISE '只有草稿可以發布(這張是 %)'
admin_home_banner_archive      UPDATE ... SET status = 'archived'     ← 沒有任何回到 draft 的路
```
UI 那層也擋:`apps/admin/src/components/home-banners/home-banner-editor.tsx:151`
`<fieldset disabled={!isDraft}>` ⇒ **published 與 archived 整組欄位是灰的,連打字都打不了。**

```
draft ──發布──> published ──下架──> archived
  ↑                                     │
  └──────────── 沒有這條路 ──────────────┘
```

**兩層都擋,而底層是 RPC** —— 就算把 UI 的 `disabled` 拿掉,RPC 仍然 RAISE。

### 🔴 哪一半是刻意的、哪一半是漏的(不要一起拆)
- **刻意**:「published 不可直接改」。publish 那支還釘 `expected_updated_at`,註解逐字
  「**按發布的人批准的是他預覽的那一版**」⇒ 防的是**線上的東西被人偷偷改掉**。
  ⇒ ✅ **這個意圖是對的,本 plan 一個字都不碰它。**
- **漏掉**:archive 那支的註解逐字「主視窗 2026-09-16 裁:**發得出去就要收得回來**」——
  那天補的是**出來**的路,**沒有人補回去的路**。
  ⇒ 📌 **收得回來 ≠ 改得動。** 那句裁示只解了一半。

## 2. 做什麼:加一支 `admin_home_banner_duplicate`

**把一列複製成一張新的 `draft`,舊那列原封不動。**

### 2-1 逐欄:複製什麼、不複製什麼

| 欄 | 複製? | 為什麼 |
|---|---|---|
| `eyebrow` / `title_line1` / `title_line2` / `subtitle` / `cta_label` / `link_path` | ✅ | 要改的就是這些,複製過來才有得改 |
| `image_desktop_url` / `image_mobile_url` | ✅ | 🔵 **圖已經在圖床上,不用重傳**(那一格本來就收 https 網址) |
| `image_origin` / `image_kind` | ✅ | 跟著圖走;複製的是同一張圖 ⇒ 來源與類型不變 |
| `rights_note` | ✅ | 那是**這張圖**的來源紀錄,跟著圖走 |
| `starts_at` / `ends_at` | ❌ **不複製** | 舊的檔期已經開始甚至過了;新的一次要重新決定。留 NULL,發布時再給 |
| `rights_confirmed` | ❌ **不複製,固定 false** | 🔴 **那是一次人的確認,不是一個屬性。** 複製過來 = 讓人跳過那一勾 |
| `source_email_id` / `matched_variant_ids` | ❌ **不複製** | 那是「這一張是從哪封信來的」的身分。複製品不是那封信生的 |
| `status` | ❌ 固定 `'draft'` | 複製出來的一定是草稿 |
| `published_by` / `published_at` | ❌ **不複製** | 🔴 **那是一次批准的簽名。** 複製過去 = 偽造一個沒發生過的批准 |
| `archived_by` / `archived_at` | ❌ 不複製 | 同上,那是舊那列的歷史 |
| `created_by` / `updated_by` | ❌ 改成**按複製的那個人** | 新的一列是他建的 |
| `id` / `created_at` / `updated_at` | ❌ 新的 | — |

🔴 **`expected_updated_at` 不是欄位、是發布時前端帶的樂觀鎖** ⇒ 新草稿自然拿到自己的 `updated_at`,**不會沿用舊的**。

### 2-2 從哪些狀態可以複製
**`published` / `archived` / `draft` 三種都可以。**
- published / archived ⇒ 本 plan 的目的。
- 🔵 **draft 也開**:理由不是「順便」,是**不開反而要多寫一條規則**(「只有非草稿能複製」),
  而那條規則沒有任何人受益。想從一張草稿分岔兩版是合理的事。
- ⚠️ 唯一的例外處理:找不到那一列 ⇒ RAISE `找不到這張大圖`(沿用既有字面)。

### 2-3 權限
**與現有三支同一條:在職員工**(`PERFORM 1 FROM public.staff s WHERE s.id = v_actor AND s.is_active`)。
理由:複製**不會讓任何東西上線**,它只產生一張草稿 —— 比「發布」寬鬆不了,因為發布那一關還在原地。
稽核照既有形狀:RPC 同交易寫 `admin_audit_log`,action = `home_banner.duplicate`,
`target` 指**新那列**,而 `before` 放**被複製的那一列**(看得出從哪來)。

### 2-4 UI 放哪 —— 🔴 今天的教訓就是「入口看不出來」
- 那顆鈕放**編輯面板的頁尾**,與「封存 / 下架」同一排。
- 🔴 **而更重要的是那句話**:`published` / `archived` 打開時,面板上要有一行看得懂的:
  > **這張已經發布過,不能直接改(線上的內容要跟按發布的人看到的一樣)。要改請按「複製一張來改」。**
  ⇒ 📌 **今天的問題不是他找不到鈕,是他不知道「不能改」是規則而不是壞掉。** 那句話要先解釋,再給路。
- 複製成功 ⇒ 直接把新那張的編輯面板打開(`?edit=<新 id>`),不要讓他回列表自己找。

### 2-5 舊那列怎麼辦 —— **不動**
🔴 **這一格我實查過,不是猜:**
```
storefront 讀 home_banners_live_v,.order('starts_at', desc).limit(HOME_BANNER_MAX_SLIDES)
HOME_BANNER_MAX_SLIDES = 4          (apps/storefront/src/lib/home-banners.ts:112,142)
publish 那支 RPC 的註解逐字「🔵 Q9 乙:首頁可以同時掛多張 ⇒ 這裡【不動別…」
實查 home_banners 的索引與 trigger:只有 pkey 與一個 (status, updated_at) 的普通 index
⇒ **沒有任何「同時只能一張」的 UNIQUE 或 trigger**
```
⇒ **兩張同時 published 是支援的**:變成輪播兩格,`starts_at` 新的排前面。
⇒ 所以複製之後舊那張**留在原狀**;要它下線就照既有的「下架」按鈕。**本 plan 不自動下架舊的** ——
  那會變成「按複製結果東西不見了」,而複製不該有副作用。

🔴 **順手抓到一個假宣告(不是本 plan 要修,但要記)**:
`apps/storefront/src/lib/home-banners.ts:9` 註解逐字「**DB 端擋「任何時刻最多一張」**」
⇒ **實查:沒有那道閘。** 那是輪播片之前的舊話,沒人更新。
⇒ 📌 **一句宣告一道不存在的防線** —— 照它去推理的人會以為有東西在擋。**要改掉,但獨立一件。**

## 2-6 切片:片一要能自己解掉今天那件事

主視窗 2026-09-16 加的要求:**最小可上線的那一片,就要讓 Sean 改得動他那一列。**

```
片一(最小可上線)
  · 新 RPC admin_home_banner_duplicate(published / archived / draft 都能複製 —— 見下面「為什麼不縮」)
  · repository + server action 各一支
  · 編輯面板頁尾一顆「複製一張來改」+ 那句解釋
  · 複製成功 ⇒ 直接開新那張的面板
  ⇒ 這一片上線, 他就能把那兩句換掉。

片二以後(不擋今天)
  · 列表頁上也放那顆鈕(現在只在面板裡)
  · 「這張是從哪一張複製來的」在畫面上看得見(DB 已經有稽核, 只是沒畫)
  · home-banners.ts:9 那句假宣告(獨立一件, 不夾帶)
```

🔴 **而片一【不縮】的三格 —— 它們是「會不會把首頁弄壞」,不是支線:**
1. **複製什麼 / 不複製什麼**(§2-1 那張表整張)。少一格就可能讓一個沒發生過的批准被複製過去。
2. **舊那列怎麼辦**(§2-5):**不動**。而「兩張同時 published 會怎樣」我已經實查完
   (最多四格輪播、`starts_at` 新的在前、DB 沒有「只能一張」的閘)⇒ **片一就帶著這個答案上線**,不留給片二。
3. **權限**(§2-3):在職員工,與既有三支同一條。

🔵 **「draft 也能複製」為什麼不縮進片二**:縮掉反而要**多寫**一條規則(「只有非草稿能複製」)並多一格測試,
而那條規則沒有任何人受益。⇒ **不縮它不是貪多,是縮了比較貴。**

⚠️ **片一不做的**:不自動下架舊那張(複製不該有副作用)、不碰那道刻意的閘、不做刪除。

## 3. 影響 / rollback / migration

**要動的**
```
supabase/migrations/<新版本號>   新增 admin_home_banner_duplicate(SECURITY DEFINER,同既有三支的形狀)
apps/admin/src/lib/home-banners/home-banner-repository.ts   多一支 duplicateHomeBanner
apps/admin/src/lib/home-banners/home-banner-actions.ts      多一個 server action(PRG 同形狀)
apps/admin/src/lib/home-banners/home-banner-constants.ts    多一個欄位名 + 結果碼 'duplicated'
apps/admin/src/components/home-banners/home-banner-editor.tsx  那顆鈕 + 那句解釋
apps/admin/src/components/home-banners/home-banners.css     那句解釋的樣式(鐵則 5 同片)
```
🔴 **要一支 migration**(新函式)⇒ **貼板的人是 Sean 或主視窗,不是我。**
🔴 **順序:板先貼、碼後推。** 函式不存在時那顆鈕會 `PGRST202` ⇒ 碼先上 = 一顆按了就錯的鈕。

**rollback**
- 碼:revert 那顆 ⇒ 那顆鈕消失,**既有三條路一個字沒動**。
- 板:`DROP FUNCTION admin_home_banner_duplicate` ⇒ **沒有資料要退** —— 這支只**新增**列,
  複製出來的草稿留著也無害(它只是草稿,不會上線)。
- ⇒ 📌 **這一片的 rollback 比圖床那片乾淨**:它不建任何持久資源、不碰既有列。

**怎麼證它真的在複製,而不只是「按鈕按得下去」**
- 🔴 一格拿**被複製的那列**與**新那列**逐欄比:該複製的欄位逐欄相等、
  **不該複製的那七欄各自是 NULL / false / 'draft' / 新的人**。
  ⇒ 那格會在「有人順手把 `published_by` 也複製過去」時紅。
- 🔴 一格釘 `rights_confirmed` 複製後**必為 false** —— 那是本 plan 最容易被「順手」弄壞的一格。
- jsdom 證不到「他看不看得懂那句解釋」⇒ **留給 Sean 走一遍**,不宣稱測過。

## 4. 鐵則 12

碰 **RPC(SECURITY DEFINER)+ migration + 客人首頁會看到的東西** ⇒ **適用**。
codex 額度 09-20 12:12 才回 ⇒ 期間走 `adversarial-reviewer`。
R1 PASS 修完收工;R1 有必修才 R2;**R2 還有必修 ⇒ 停下端主視窗,不跑 R3**。
送審時點名三件:
1. 不該複製的那七欄有沒有真的沒複製(尤其 `published_by` / `published_at` / `rights_confirmed`)
2. 權限:複製會不會變成一條繞過發布閘的路
3. 兩張同時 published 時首頁的行為(輪播排序、最多四格)

## 5. 這一片**不做**的

- ❌ 不碰「published 不可直接改」那個閘(那是刻意的)。
- ❌ 不讓 archive 退回 draft(會把「封存」這個狀態的意義吃掉,稽核上分不出「下架過」與「沒發過」)。
- ❌ 不做「刪除大圖」(YAGNI;封存已經夠)。
- ❌ 不修 `home-banners.ts:9` 那句假宣告(**獨立一件**,不夾帶)。

## 6. 而在這一片做好之前,今天就能用的路

**建一列全新的,圖不用重傳** —— 那一格本來就收 https 網址,直接貼已經在圖床上的那張:
```
https://bmpnplmnldofgaohnaok.supabase.co/storage/v1/object/public/home-banners/1753f25e-b76e-4058-92b6-262f299919c7.jpg
```
⇒ 📌 **所以這一片不擋任何人做事,它擋的是「每次都要重打一遍」。** 優先序由 Sean 決定。
