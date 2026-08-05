# 全站重設計線 · 派工單(視窗 D · 2026-08-05 開線)

> **給 D 窗看的唯一入口。** 主視窗寫。Sean 2026-08-05 拍板:Q1=A 地基優先 / Q2=A 開新視窗 + 吸收 C 線殘片。

## §0 你是誰、在哪、紅線

- **worktree**:`/Users/sean_1/pcm-site-redesign`(branch `site-redesign`,自 dev `c058ae4` 開)。
- **開工三件事**:①`pnpm install --frozen-lockfile` ②`git branch --show-current` 確認在 `site-redesign`
  ③讀 §1 那三份設計端文件。
- ⚠️ **已知環境坑(backlog #326)**:worktree 跑 root `pnpm typecheck` 最後一步會紅在
  `tsc -p tsconfig.scripts.json`(root 未宣告 typescript、主庫靠殘留 binary)。
  workaround=改呼叫 `./packages/adapters/node_modules/.bin/tsc -p tsconfig.scripts.json --noEmit`
  (**真的跑,不是跳過**);turbo 那 8 支不受影響。
- **紅線**:不 push、不動 `STATUS.md` / `docs/handoff/CURRENT.md`(主視窗負責)、
  commit 前寫 gate 標記(`.husky/reviewer-gate.sh` 檔頭)。收工寫 `D-2xx-STOP`,**掛背景等待迴圈**等 `D-1xx-A`。
- **信箱**:`/Users/sean_1/pcm-mailbox/`,先讀 README 全文。你的號段=`D-2xx`,主視窗=`D-1xx`。
  🔴 **每次寫 STOP/收工前先 `ls` 一次信箱**(本 repo 已栽三次)。

## §1 真權威(依序讀,不要跳)

| 檔案 | 位置 | 是什麼 |
|---|---|---|
| `DESIGN-HANDOFF-2026-08-05.md` | OD 專案 `pcm-home-redesign/` | **總交接單**,先讀完再動任何一行。§四(不可違反的設計規則)與 §十(五個坑)逐條讀 |
| `SITE-MAP.md` | 同上 | 路由↔檔案↔狀態的唯一地圖 |
| 各頁細節交接單 | 同上,索引在總交接單 §六 | 做哪一頁才讀哪一份 |

OD 專案絕對路徑:`/Users/sean_1/Library/Application Support/Open Design/namespaces/release-stable/data/projects/pcm-home-redesign/`

🔴 **鐵則 1 例外已成立**:本線真權威=上述 OD 目錄(CLAUDE.md 鐵則 1 明文例外);submodule `design-reference` 的 `components/HomePage.jsx` 是過期假稿、不得引用。

## §2 工作模式(Sean 拍板,每頁都照這個)

> **現況排版原封不動 + 純換色 + 新殼**

**不是重畫**。正式站 CSS 是逐段照抄進設計稿的,排版值一個都沒動。搬回來時:
- 🔴 **不要重寫 CSS**。每支設計稿 CSS 檔頭列了「本檔僅有的偏離清單」,**照那份改、其餘不碰**。
- 🔴 **不要搬**:`prototype-router.js`、`prototype-pending.html`(⚠️ 別跟對外的 `coming-soon.html` 搞混)、
  各頁 `<script>` 裡的示意 JS(表單驗證/狀態切換/付款遮罩都只是版位示意)、`?state=` `?v=` `?tab=` 預覽參數。
  每支檔案 script 開頭有紅字標明。

## §3 🔴 主視窗盤點出的三項落差(設計稿沒說、但你一定會撞到)

實查 dev `c058ae4`,附 `檔案:行號`:

1. **色票是「改值」不是「新增」,而且會一次改到非動作色的用途**
   `styles/tokens.css:28` `--c-red: #dc2626`(正紅)、`:30` `--c-red-dark: #991b1b`;
   **熔橘 `#f26722` 與深熔橘 `#c4470c` 全 repo 零命中**。
   ⇒ 換色=改這兩個既有 token 的值 ⇒ **全站所有吃 `--c-red` 的地方一次變**,
   包含錯誤訊息、`no-match` 標記這類**不是動作色**的用途。
   而總交接單 §4-1 明訂「**熔橘是動作色不是身分色**」。
   🔴 **第0批動手前必須先 grep 全樹列出 `--c-red` / `--c-red-dark` / `--c-red-soft` 的每一個消費點**,
   逐一判「這裡該不該變熔橘」;不該變的要改吃別的 token 或新增中性語意 token。
   **不要直接改值就宣稱完成** —— 那會把身分色一起染掉,而且測試看不見。

2. **殼不是 layout 注入,是逐頁 import**
   `components/Header.tsx`(201 行)與 `components/HomeFooter.tsx`(81 行)由**各頁 view 元件各自 import**,
   計 13 處(`ProductsPage.tsx:290`、`LegalDocPage.tsx:30`、`InfoShippingPage.tsx:41`、
   `CartView` / `CheckoutView` / `LoginPage` / `RegisterPage` / `AccountView` / `not-found.tsx` 等)。
   只有 `components/MobileTabBar.tsx`(130 行)掛在根 layout(`app/layout.tsx:35,106`)。
   全 `app/` 底下**無 nested layout**(只有 1 支根 layout)。
   ⇒ 「改一次全站生效」在**檔案層成立**(單一來源),但 **§4 新開的 3 條路由要自己 import 殼**,不會自動有。

3. **`cart-page-handoff.md` 自我矛盾,以 §五 為準**
   §1-4 與 §四驗收 3 寫「`.cart-checkout` 仍墨黑、照舊不動」,但 §五 寫「已拍板:主鈕=熔橘(Sean 選 B)」,
   總交接單 §4-1 也是「主 CTA 一律熔橘」。
   ⇒ **驗收條件那條是過期字面**(典型「只補到手碰過的行」)。做 /cart 時照 §五 改熔橘,
   並在 commit body 註明驗收條件第 3 條與 §五 衝突、以 §五 為準。

## §4 施工順序(Sean Q1=A 地基優先;一次一頁,每頁對照該頁交接單驗收條件逐條 yes/no)

| 批 | 內容 | 為什麼在這個位置 |
|---|---|---|
| **第0批** | 色票(tokens)+ 殼三件套(Header/HomeFooter/MobileTabBar)+ 寬度規範(殼 1440 置中、商品列表主體拉滿) | **全站地基**,做完後面每頁工作量大減;**風險最高**(一次全站變色)⇒ 標準片以上全流程、判定輪換模型;建議自拆成 0a 色票 / 0b 殼 兩片(超鐵則 4 就拆) |
| **第1批** | `/info/shipping` + `/terms` + `/privacy` + 404(共用 `pcm-content.css`) | 最安全:無互動、無金流、四頁一支 CSS |
| **第2批** | `/coming-soon` + `/stores` + `/install` + `/logout`(**四條真站都沒有,要新開 `app/*/page.tsx`**) | 全新建、不動既有行為;`/stores` `/install` 先掛 `coming-soon?v=`;`/logout` 真站現況是 server action(`app/account/actions.ts:17`)不是頁面 |
| **第3批** | `/products` + `/cart` | 電商核心 |
| **第4批** | `/login` + `/register` + `/account` | 帳號線 |
| **第5批** | `/checkout` | 🔴 **金流敏感=鐵則 12①,commit 前必過 codex 對抗審查**;放最後 |
| **殘片(併入對應頁)** | D5f 磚牆改讀資料 / D5c 分類區 icon chip(6欄×2列,Q1=A/Q2=A「跟設計稿一模一樣」)/ 標點遷移片 | C 線交接過來;做首頁與品牌頁那批時順手併入。🔴 **標點片範圍要重掃**(Sean 這輪動過 OD 資料檔,舊的 568 處數字可能過期) |

首頁 / `/brands` / 品牌頁三支是**已定案已上線**的自包含稿(殼自帶、不吃 `pcm-shell.css`),本輪只動殼與兩處文案 ⇒ 併進第0批的殼工作,**不要重做那三頁**。

## §5 交接單點名的兩件事(實查結果)

- **結帳頁行內新增地址**:`components/account/InlineAddressForm.tsx` **存在**(194 行),
  目前只有 `components/account/tabs/AddressTab.tsx:27,90,108` 在用;
  `CheckoutView.tsx:38` 只有一句註解「延後 → 連 /account 管理」、**零 import**。
  ⇒ 第5批照交接單**直接 import 它**,不要新寫表單。
- **TapPay `.tpfield` 不要改成 `<input>`**(iframe 掛載點,卡號只存在 iframe 內):
  `components/TapPayCardFields.tsx:92`(渲染)、`styles/checkout.css:329-331`(樣式)、
  `hooks/useTapPayCard.tsx:6,13`(註解);測試在 `TapPayCardFields.test.tsx` 與 `CheckoutView.test.tsx`。

## §6 已知問題與待補(不要自己編)

1. **`brand-page.html` div 標籤靜態掃描差 1**(設計端 §九;8/2 定案的 133KB 稿、本輪未動,瀏覽器容錯所以視覺正常)。搬移時順手處理。
2. **三筆資料 Sean 還沒給**:合作店家實際家數與名單 / 安裝預約工時費率 / 首頁「全台 N 家」實際數字。
   設計稿刻意留誠實佔位(顯示「資訊確認中」「依品項報價」、**沒有編造任何電話、地址或金額**)——
   🔴 **搬過去維持這個原則,不要自己填**。首頁那個數字已包成 `<span data-store-count>`,尚未接資料。
3. **coming-soon 底色必須純黑 `#000`**(logo 牆靠極低透明度浮在上面,底色不是純黑會浮出濁色)。不要「順手」改石墨。
4. **`coming-soon` 的 `noindex`**:整站版要、功能版不要 ⇒ 真站抽成元件後由各頁 metadata 決定。
5. **手機 390px 設計端只做規則層對應、未逐頁實機驗證** ⇒ 你這邊要實看(`agent-browser` CLI,viewport 390×844)。

## §7 驗收與審查

- 每頁對照該頁交接單的**驗收條件逐條 yes/no**(那些條件都寫成可判定的形式了)。
- 三綠(`turbo typecheck lint --force` + 動 .tsx 加 build)+ 全套 `pnpm test` 數字精確調和。
- **真瀏覽器實看**(動前台 TSX/CSS 收工前必做;桌機 1440 + 手機 390)。
- 片型:第0批與第5批=標準片以上、判定輪換模型;其餘照片型分級自判,跳審要在 commit body 寫理由。
- 🔴 **不要為了讓驗收過而改測試期望值或放寬守門** —— 那是立即停止訊號,寫 STOP 回報。

— 主視窗,2026-08-05
