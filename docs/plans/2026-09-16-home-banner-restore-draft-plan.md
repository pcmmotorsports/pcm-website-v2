# 首頁大圖「封存之後拿得回來」(重新開成草稿)

> 依據:Sean 2026-09-16 批「要做」(那批 16 題裡的一題,逐字「全部依照建議」)。
> 這一份是**做法**的 plan —— 他批的是「要做」,還沒批「怎麼做」。動資料庫 ⇒ 照鐵則 8 先批再寫 migration。
> 寫的人:施工窗(worktree `pcm-admin-ui`),2026-09-16。

## 一句話

首頁大圖按了「封存」之後,**現在一顆鈕都沒有、永遠拿不回來**。
加一個「重新開成草稿」,把它放回草稿區,要重新發布得再走一次原本的發布檢查。

## 現在是什麼情況(逐字查過,不是印象)

| 事實 | 在哪裡 |
|---|---|
| 資料庫只有**三個動作**:存草稿 / 發布 / 封存,**沒有回頭的路** | `20260916180000` 裡只有 `admin_home_banner_save_draft` / `_publish` / `_archive` 三支 |
| 想用「存草稿」把它改回去 ⇒ **資料庫當場擋掉** | `save_draft` 逐字 `IF v_before.status <> 'draft' THEN RAISE EXCEPTION '只有草稿可以修改(這張是 %)'` |
| 表上自己寫著狀態是**單向**的 | 表的說明逐字:「draft ⇒ published ⇒ archived」 |
| 畫面上封存後**沒有任何鈕** | `home-banner-editor.tsx:240` 逐字 `banner !== null && state !== 'archived'` ⇒ 封存的列連「下架」鈕都不畫;`:247` 的「存草稿」只給草稿 |

⇒ 今天**真的是死路**,不是「藏起來了」。

## 為什麼值得做

「封存」是一按就好、不問第二次的動作,而且**所有在職員工都能按**(Sean 09-16 Q5 乙 + 主視窗「發得出去就要收得回來」)。
⇒ **按錯的人自己救不回來** —— 他得重新建一張、重新填字、重新等圖。
⇒ 而「掛得上去、拿不下來」我們已經避開了;它的反面(**拿得下來、放不回去**)同樣是個單向門。

## 要動哪三處

### ① 資料庫:新增**一支**動作 `admin_home_banner_restore_draft`

只做一件事:把 `archived` 的那一列改回 `draft`。**不收任何內容參數、不碰任何文字或圖片欄位。**

骨架逐字照抄現有的 `admin_home_banner_archive`(同樣三個參數 `p_banner_id / p_actor / p_request_id`):
- 權限:`staff.is_active`(在職就可以,理由見下面〈權限〉)
- **冪等**:本來就是草稿 ⇒ 回 `changed:false`,不報錯、不寫第二筆稽核(照 `_archive` 對已封存的那招)
- 寫一筆 `admin_audit_log`,action 叫 **`home_banner.restore`**
- `SECURITY DEFINER` + `SET search_path = ''`,兩道 `REVOKE`(`FROM PUBLIC, anon, authenticated`)+ `GRANT EXECUTE ... TO service_role`(房規 `docs/patterns/revoking-function-execute-in-supabase.md`:少一道都是開的)
- 後置閘照 `20260916180000` 那一段,把新函式加進 `v_functions` 陣列一起驗(anon/authenticated 不可執行、service_role 要能執行、`search_path` 是空字串、是 SECURITY DEFINER)

### 🔴 為什麼是**新增一支**,不是把「存草稿」放寬

| | 新增一支(**建議**) | 放寬 `save_draft` |
|---|---|---|
| 那道 `status <> 'draft'` 的擋 | **原封不動** | 要拆開 —— 而它正在保證「已發布 / 已封存的內容不會被人偷偷改掉」 |
| 能碰到什麼 | **只有一個狀態欄位**,收不到任何內容參數 | 同一支要同時管「改內容」與「換狀態」,多一個分支;那個分支寫錯,**已發布的列也可能被改到** |
| 稽核查得到嗎 | `home_banner.restore` 自己一筆 ⇒ 查「這張被復原過幾次」一個動作名就夠 | 混在一堆「改了字」的 `save_draft` 裡,分不出來 |

⇒ **建議新增一支。** 那道擋是承重的,不該為了省一支函式去動它。

### 🔴 `archived_by` / `archived_at` 復原時怎麼辦 ⇒ **留著**

**決定:留著。理由是【歷史事實不該因為復原而消失】** —— 「誰在什麼時候把這張圖下架過」,是之後要查「這張圖為什麼消失過」的唯一線索。

🛑 **而以下這件事【不可以】拿來當理由**:我查過 `archived_by` 在程式碼裡**零命中**、`archived_at` 有被撈出來但沒有任何一處真的在用。
📌 **「今天沒人讀」與「不該留」是兩句話,而它們在 grep 的輸出上長得一模一樣。** 那個零命中只證明今天沒人讀,證明不了可以丟。**下一個人不要拿它當依據。**

🟢 技術上也不卡:`home_banners_archived_shape_check` 逐字是 `status <> 'archived' OR (archived_by IS NOT NULL AND archived_at IS NOT NULL)` ⇒ **它只管 archived 那一態** ⇒ 改回 draft 之後那兩欄留著**不違反任何約束**。

### 🟢 復原之後仍然要過原本的發布檢查 —— **自動成立,不用多做東西**

而且要寫清楚**為什麼**自動成立,不是只寫結論:

那三條把關的 CHECK —— `home_banners_published_shape_check`、`home_banners_mail_published_needs_match`(信件來的要配到商品)、`home_banners_published_link_scope`(連結要指到站內商品頁)——
**每一條的條件都寫成「`status <> 'published'` 或 (…)」** ⇒ 它們**只在那一列是 published 的時候才有意見**。
⇒ ① 復原成 draft ⇒ 三條都自動成立 ⇒ **復原本身不會被擋**
⇒ ② 之後要再發布 ⇒ 那一列又變成 published ⇒ **三條原封不動地再擋一次**
⇒ 📌 **「復原」這條路沒有繞過任何一道發布閘,而我們一行程式都不用寫。**

### 🔴 同一支 migration 要**一併改掉表的說明** —— 不然它會開始說謊

表 `home_banners` 的 COMMENT 逐字寫著狀態是 **「draft ⇒ published ⇒ archived」**。
⇒ 這一片做完之後,**那句話就是假的**(它會有一條回頭的路),而它是下一個人查狀態機時第一個讀到的東西。
📌 這不是龜毛:`20260916180000-rollback.sql` 自己 `:13-14` 就記著同一件事 —— 逐字「不然目錄註解會繼續寫著新世界的規則,而行為是舊世界(**讀註解的人會被騙**)」。
⇒ 新 migration 一併把表的 COMMENT 改成 `draft ⇒ published ⇒ archived ⇒(可復原回 draft)`,並把新函式寫進那句「寫入只走 …」的清單。

### ② 網站程式:兩層,各一小段

- `home-banner-repository.ts`:加 `restoreHomeBannerDraft()`,逐字照 `archiveHomeBanner()`(打 RPC、錯就 throw、回傳形狀不對也 throw)
- `home-banner-actions.ts`:加 `restoreHomeBannerDraftAction`,逐字照 `archiveHomeBannerAction`(`authorizeAdminMutation` → 解析 id → 記 attempt → try/catch 分類錯誤 → `revalidatePath` → 導回)
- `home-banner-constants.ts`:結果代碼加 `restored`(文案:「已重新開成草稿。」)與 `nochange` 的第二種說法
  ⚠️ 現有 `nochange` 的文案逐字是「**這張本來就已經封存了。**」—— 復原若也用 `nochange`,員工會看到一句**意思相反**的話。⇒ 復原要有自己的 `restore_nochange`(「這張本來就是草稿了。」)
- `home-banner-editor.tsx`:封存狀態時畫一顆「重新開成草稿」(今天 `:240` 那一行只在 `state !== 'archived'` 畫鈕 ⇒ 加一條 else)

### ③ 部署順序:**板先貼、碼後推**

新函式 ⇒ 部署時序閘會擋(它認 `.rpc(`)。而且反過來會壞:碼先上 ⇒ 按鈕打一支不存在的函式 ⇒ 員工拿到 PGRST202。
⚠️ **這次沒有改既有函式的簽章** ⇒ 沒有 2026-09-16 板 199 那種「兩個方向都有空窗」的問題;舊碼不受影響(它根本不知道有這支)。

## 不會改變任何現有行為

- 沒有動 `save_draft` / `publish` / `archive` 任何一支
- 沒有動任何 CHECK、沒有加減欄位
- 沒有動前台顧客站(草稿本來就不見客)
- 封存的列在復原之前,畫面與今天**逐字相同**

## 出錯了怎麼退(rollback)

`supabase/rollbacks/<版本>-rollback.sql`:`DROP FUNCTION IF EXISTS public.admin_home_banner_restore_draft(uuid, text, text);`
- **順序**:先 revert 後台那顆(把鈕拿掉),再跑本檔。反過來 ⇒ 員工按那顆鈕會拿到「函式不存在」。
- 🔵 **退得乾淨**:這支不改任何既有資料。已經被復原過的列會停在 `draft`(那是它們現在真正的狀態,不是壞掉),`archived_by` / `archived_at` 仍在 ⇒ 要人工改回 `archived` 的話那兩欄都還在。
- 退完同批跑 `pcm_acl_approve_latest`(`p_note` 帶版本號與「rollback」)。

## 驗收(怎麼知道做對了)

1. 封存一張 ⇒ 畫面出現「重新開成草稿」鈕 ⇒ 按下去 ⇒ 它回到「草稿」分頁、文字圖片一個字沒變
2. **負對照**:同一張復原後**直接按發布** ⇒ 信件來的若沒配到商品,**照樣被擋**(訊息逐字「這張還沒配到商品,配到商品才能發布」)
3. **負對照**:對一張**本來就是草稿**的按復原 ⇒ 回「這張本來就是草稿了。」,**稽核不多一筆**
4. 復原後去查 `admin_audit_log` ⇒ 有一筆 `home_banner.restore`,而**原本那筆 `home_banner.archive` 還在**
5. 復原後那一列的 `archived_by` / `archived_at` **仍然是原本的值**(不是 NULL)
6. 一般員工(非管理者)按得動;**離職的員工**按不動(拿到「無權執行此操作」)

## 要 Sean 決定的

```
Q:大圖「重新開成草稿」誰可以按?
  甲 所有在職員工(跟「封存」同一條規則)
  乙 只有管理者
  推薦 甲 —— 封存是所有員工都能按的; 若只有管理者能復原, 按錯的人自己救不回來,
       而他要等的那個人可能今天不在。復原本身不會讓任何東西上首頁(還是草稿)。
A: 甲|乙
```

## 版本號

取號那一刻要**再確認一次**(今天已經用到 `20260916190000`,而別的視窗可能同時在取)。
預計 `20260916200000`,取號前跑一次 `ls supabase/migrations/ | tail -3` 核對。
