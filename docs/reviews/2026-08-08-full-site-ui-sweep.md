# PCM 全站 UI/UX 掃測報告(P-203-A)

環境:http://localhost:3111(dev,BUILD_ID `9S8ef8gVVumyxD9xcals3`)
寬度:390(手機)/ 768(平板)/ 1200(桌機)
分級:A=壞掉/擋動線、B=行為怪/UX 傷、C=建議

---

## 進行中筆記(未分級原始觀察,底部彙整正式清單)

### [A] 全站搜尋功能完全死掉(桌機 + 手機,首頁與所有頁面共用 Header)
- `Header.tsx:61-64` `openSearch()` 只 `window.dispatchEvent(new CustomEvent('pcm-open-search', …))`;
  全 repo grep `pcm-open-search` **只有這一處**,沒有任何 `addEventListener` 接住(`git log -S "pcm-open-search"` 只命中
  M-1-03 初始搬遷那顆 commit,750+ 顆之後從沒人接線)。
- 桌機:搜尋框 `<input readonly value="">`(`searchQuery` state 沒有 setter、`Header.tsx:59`),點擊/focus 都只呼 `openSearch()`;
  playwright 真點擊+打字實測:`value` 恆空字串,無任何 modal/overlay/dropdown 出現,URL 不變。
- 手機:搜尋圖示鈕(`aria-label="搜尋商品"`)呼叫同一顆 `openSearch()`,同樣死路。
- 影響:客人**完全沒有任何方式用關鍵字搜商品**,只能靠導覽列分類/品牌/選車 finder 找東西。這是首頁與全站 header 最顯眼的功能之一。
- 不在已知清單裡,判定=新發現。

### [A] 收藏功能兩端都做了,中間沒接線:按鈕與 `/account` 收藏清單頁完全斷開,清單頁**永遠不可能顯示任何商品**
- `ProductInfo.tsx:365-379`(PDP)與 `ProductCard.tsx:203,243`(所有商品卡,含首頁/型錄列表)兩處收藏鈕都是
  `const [liked, setLiked] = useState(false)`,純元件內部 state,不寫 localStorage/sessionStorage/cookie/DB。
- 實測:PDP 點收藏 → `aria-pressed` 變 `true`(愛心變實心,視覺確實回饋)→ 重新整理同頁 → 變回 `false`。
- **登入後**(`uitest@pcmmotorsports.com`)確認 `/account` 底下確實有一個「收藏清單」分頁、空狀態文案寫
  「目前尚無收藏商品 · 您的收藏會顯示在此」——UI 框架是完整的,不是缺頁。
- 但因為收藏按鈕的狀態從不寫進任何持久層,這個清單頁**結構上不可能有內容**:不管客人在幾顆商品頁點過幾次收藏,
  這裡永遠是空的。原先誤判為「全站沒有收藏清單頁」,已更正——正解是「兩端各自做了一半,中間沒接線」,
  影響比單純「沒做」更隱蔽,因為兩邊分開看都像是完成品。
- 升級為 A 級(原判 B):因為這不只是「按鈕好看沒作用」,是一個橫跨多元件、有專屬頁面、卻結構性失效的完整功能線。

### [B] 全站四張帳號表單(登入/註冊/忘記密碼/重設密碼)驗證錯誤不會隨輸入即時清除,只在下次送出才更新
- 程式碼確認四頁共用同一個 pattern:`LoginPage.tsx`、`RegisterPage.tsx`、`ForgotPasswordPage.tsx`、`ResetPasswordPage.tsx`
  都是 `onChange={(e) => setForm({...form, x: e.target.value})}`,`fieldErrors` state 只在 `submit()` 內被整批
  設定/清空,`onChange` 完全不碰 `fieldErrors`。
- 真實 playwright 操作複現(非 evaluate 批次假象,已用 `pressSequentially` 真打字驗證):
  1. `/register` 空白提交 → 姓名/手機顯示「請填寫姓名」「請填寫手機」(Email/密碼那次剛好被瀏覽器自動填入、見環境註記)
  2. 在姓名欄真實逐字打入「UX 測試」→ 欄位值确认变成「UX 測試」,但旁邊「請填寫姓名」**原封不動沒消失**
  3. 只有再次點擊「建立帳號」重新送出後,錯誤才消失
- 影響:使用者填完欄位後仍看到刺眼的紅字錯誤,容易誤以為輸入沒被系統接收、重複刪打或放棄。
  這是表單 UX 的業界基本行為(邊打字邊清除已修正的欄位錯誤),四張表單全部缺這一步。

### [A] `/account` 至少兩個分頁(我的愛車、收件地址)的「新增」存檔成功但畫面不會即時反映——只有重新整理才看得到
- 實測(登入 `uitest@pcmmotorsports.com`,測試資料皆已刪除還原):
  1. **我的愛車**:新增 Honda CBR1000RR → 點「儲存」→ 彈窗關閉,清單區塊仍顯示「尚未新增愛車」,看起來像存檔失敗;
     手動重新整理後,「Honda CBR1000RR · PRIMARY」才真的出現。
  2. **收件地址**:新增測試地址 → 同樣現象,「儲存」後仍顯示「尚未新增地址」;重新整理後地址才出現。
- 兩處都證實資料**確實存進去了**,純粹是 client 端存檔成功後沒有 revalidate/refetch 清單畫面。
- 因為在兩個獨立分頁復現同一種缺陷(疑似共用的表單/清單元件或 mutation hook 漏了 revalidate 這一步),
  判定為 A 級、範圍可能不只這兩處,建議連帶檢查「個人資料」分頁的存檔是否也有同款行為。
- 對照組:兩處的「刪除」動作都**沒有這個問題**,點刪除後清單立即更新不用重整,只有「新增」路徑漏了這一步。
- 影響:使用者以為存檔沒生效,可能重複點擊新增造成重複資料,或誤以為功能壞掉而放棄。
- **個人資料**分頁另外測過(姓名/手機/生日就地表單、非清單新增),存檔+重新整理正確反映新值,**沒有**這個問題;
  清空姓名重新送出會正確擋下並顯示「請填寫姓名」(zod `min(1)`),防線正常,已排除誤判。

### [C] checkout 步驟②(發票與付款)載入 TapPay 反詐欺 SDK 時,瀏覽器 Permissions Policy 擋掉感測器存取
- 進到步驟②(收件資料→發票與付款,已在此止步,**未填卡號/未勾服務條款/未點確認付款**)時 console 出現:
  `Permissions policy violation: accelerometer is not allowed in this document. @ https://websdk.cherrix.co/ddca-sdk.js`
  (連帶 `deviceorientation`/`devicemotion` 事件被擋的 warning)。
- `websdk.cherrix.co` 應是 TapPay 串接的裝置指紋/反詐欺 SDK,讀不到加速度計等感測器資料,風控可蒐集的訊號會變少
  (SDK 本身應該會靜默降級、不影響頁面本身運作或看得到的付款流程)。
- 我不確定這對實際拒付率/風控評分有沒有可量測影響,列為 C 級技術觀察,建議工程側確認是否要在
  `next.config`/該 iframe 嵌入處補上對應的 `Permissions-Policy allow="accelerometer; gyroscope"` 之類設定。

## 環境註記(測試帳號資料殘留,非網站 bug,如實記錄)

- 測試過程把 `uitest@pcmmotorsports.com` 的「個人資料 · 姓名」從原本的空值改成了「UX 測試員」,
  且**無法透過前台 UI 還原成空**——姓名有 zod `min(1)` 必填驗證,清空重新送出會被正確擋下(這正是我拿來驗證
  「表單存檔行為」的測試動作本身)。已確認該信箱本來就不真實存在、純測試用途,殘留影響應該極低,
  但依紅線「會員資料編輯類需存檔驗證則事後還原並記明」,誠實記錄:**這一格改不回去了,如需要乾淨姓名請後台手動清或留著當測試痕跡**。
- 其餘測試資料(我的愛車 Honda CBR1000RR、收件地址測試地址)已透過「刪除」功能還原乾淨,重新整理確認過清單為空。
- 本機瀏覽器 profile 對 `/login`、`/register` 兩處表單自動填入過已儲存的非測試帳號憑證(email 開頭 `bsas0***@gmail.com`),
  已回報主視窗、主視窗已轉告 Sean 確認去留;全程沒有送出這組憑證。

