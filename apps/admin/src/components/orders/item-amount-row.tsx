'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import { ItemAmountForm, type ItemAmountFormProps } from './item-amount-form';

// item-amount-row.tsx — 品項列 + 「改金額」展開列(M-4b E10 #13 片1c-2 版面片)。
//
// 🔴 **為什麼要這一支**:1c-2 第一版把表單塞進「單價」那格,而那格是
//    `text-right tabular-nums whitespace-nowrap`、實測寬 **155px**(主視窗 2026-08-16 量;
//    品項表是該頁第 [1] 張、6 欄、表寬 1150)。
//    ⚠️ **口徑:那個「6 欄」是 2026-08-19 片5【之前】量的,現值 8 欄**(片5 三軸拆三欄)。
//       155px 那個結論(表單塞不進單價格)在 8 欄下只會更成立 ⇒ **不必重量,補上時點即可。**
//    表單裡有 label、輸入框、checkbox 與「我確認這個品項要改成 0 元」——
//    `nowrap` 會讓它一行到底,**要嘛擠爆別欄、要嘛整張表出現橫向捲軸**。
//
// 🔴🔴 **本檔是【唯一】的 client 島 —— `ItemsTable` 與 `order-detail.tsx` 仍是 server component。**
//    (`grep -c "use client" order-detail.tsx` ⇒ **0**,那個 0 要維持。)
//    ⚠️ 作法:**那幾格的內容仍由 server 算好、當 `ReactNode` 傳進來**(`before` / `priceText` / `after`),
//       (原字面「六格」= 片5 之前的欄數;現值 8,見上方口徑註記。)
//    本檔只負責「**展開誰**」這個狀態與那一列的殼。
//    ⇒ 不要為了方便把 `ItemsTable` 標成 `'use client'` —— 那會把整張表(含金額格式化、三軸彙總)
//    整包送進 client bundle。
//
// 🔴 **收合時不多一列**:trigger 就放在單價格裡(一個小連結),
//    **展開才多出那一列** ⇒ 品項多的訂單不會平白變兩倍長。

/**
 * 🔴 **「只展開正在編輯的那一項」需要【共用】狀態**(codex 版面片 R1 must-fix 1)。
 *
 * 第一版每一列各自 `useState(open)` ⇒ **點 A 再點 B,兩列會同時展開** —— 不符合那條約束。
 * ⇒ 改成一個 client provider 握 `openId`,每一列讀它。
 * ⚠️ **provider 包住的 children 仍是 server 算好的** ⇒ `ItemsTable` 與 `order-detail.tsx`
 * **維持 server component**(那個 `grep -c "use client" ⇒ 0` 要保持)。
 */
const OpenRowContext = createContext<{
  openId: string | null;
  setOpenId: (id: string | null) => void;
  /**
   * 🔴🔴 **使用者有沒有動過任何一列** —— 而它與 `openId === null` **不是同一件事**。
   *
   * `W6-030` M1:上一版用 `openId == null` 當「還沒有人動過」的判準,而**那個值正是「收起來」的結果**
   * ⇒ 兩個失敗都在預設路徑上:
   *   ① 員工收起缺料那張 ⇒ `openId=null` ⇒ `defaultOpen` 又說話 ⇒ **立刻又開**
   *   ② 打開品項 B(A 收起)⇒ **關掉 B** ⇒ `openId=null` ⇒ **A 自己彈開**
   * ⇒ 所以要**三個狀態**,不是兩個:沒動過 / 動過而開著某一列 / 動過而全部收起。
   */
  touched: boolean;
  /**
   * 🔴🔴 **片7:哪一列正在【改金額】—— 與「哪一張卡是開的」是兩個狀態,不是一個。**
   *
   * 片6a 時兩者可以共用一個 `openId`,因為卡片展開區裡**只有**改金額表單
   * ⇒ 「卡開著」與「正在改金額」在畫面上是同一件事。
   * 片7 把採購那一整層放進展開區之後,**那個等式不再成立**:
   *   員工打開卡片是為了**看採購 / 登錄到貨**,而那時不該有一張改金額表單跟著冒出來
   *   —— 那是一道「已收款 ⇒ 不得改金額」的閘所守的表單,不該在員工沒要求時出現。
   * ⚠️ `item-amount-row.tsx` 片6a 的檔頭自己預告過這一格,逐字:
   *    「片6b 把採購那層放進 `.icardbody` 之後,卡片要能【獨立於改金額】開合
   *      ⇒ 那時這裡的受控條件要一起重想,**不要照抄**。」
   * ⇒ 這裡就是那次重想。
   *
   * 🔴 **仍然只有一列**(不是 Set):改金額是錢的面,「同時開兩張」是**行為改動**,
   *    不在本片範圍。與 `openId` 各自獨立、但受同一條約束。
   */
  amountEditId: string | null;
  setAmountEditId: (id: string | null) => void;
} | null>(null);

export function ItemAmountRowGroup({ children }: { children: ReactNode }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [amountEditId, setAmountEditId] = useState<string | null>(null);
  // 🔴 每一次**使用者發起**的變更都要標記 touched —— 包含「收起來」(傳 null)。
  //    這一行就是 M1 的修法本體:**收起來之後,`defaultOpen` 再也不說話。**
  const set = (id: string | null) => {
    setTouched(true);
    setOpenId(id);
    // 🔴🔴 **片7:卡片收起來時,把「正在改金額」一起關掉。**
    //    不關的話會留下一個**看不見而仍然為真**的狀態:員工收起 A、再打開 A,
    //    改金額表單**自己又在那裡**,而他沒有再點過那顆入口。
    //    ⚠️ 而換開別張卡(`id !== null`)也要關 —— `amountEditId` 指的是**另一列**,
    //       留著它等於「B 的卡開著、而 A 的改金額狀態還亮著」,那是兩個真相。
    setAmountEditId(null);
  };
  return (
    <OpenRowContext.Provider
      value={{ openId, setOpenId: set, touched, amountEditId, setAmountEditId }}
    >
      {children}
    </OpenRowContext.Provider>
  );
}

export type ItemAmountRowProps = {
  /**
   * 單價格**之前**的那幾格 —— server 算好傳進來。
   * 🔴 2026-08-19 片5 更新(原字面「品項 / SKU / 數量」已過期):現在是**六格**
   * `商品名稱 / 料號 / 訂 / 到 / 出 / 數量`。**三軸在這裡,不在 `after`。**
   */
  /**
   * 片16(2026-08-19):品牌那一行,畫在 `<summary>` 裡、`.iline` 那個 grid **上方**。
   *
   * 🔴 **它不是第七軌**:確認稿 `:291`/`:304`/`:317` 是 `<div class="ibrand">BREMBO</div>`,
   *    **橫跨整列**、`:137` CSS `font-size:10px;font-weight:700;letter-spacing:.05em;color:muted`。
   *    ⇒ **六軌一格不動。** 判成「加一欄」會做出完全不同的東西,而**四綠與測試都不會發現那是錯的**。
   * ⚠️ **只有 `card-line` 殼畫它** —— `table-row` 是整頁版的舊殼,設計稿沒畫過它的品牌行。
   *    給了 `brandLine` 而 variant 是 `table-row` ⇒ **靜默不畫**(不是報錯):那個組合今天沒有呼叫端,
   *    而為一個不存在的呼叫端加一道 throw 是在沒有事的路上裝機制。
   */
  brandLine?: ReactNode;
  before: ReactNode;
  /** 單價格要顯示的字(已格式化)—— server 算好傳進來 */
  priceText: ReactNode;
  /**
   * 單價格**之後**的那幾格 —— server 算好傳進來。
   * 🔴 2026-08-19 片5 更新(原字面「小計 / 三軸」已過期):現在**只剩小計一格**,
   * 三軸已搬到 `before`。⚠️ 照舊字面接線會把三軸放到單價的**右邊**,而版面不會報錯。
   */
  after: ReactNode;
  /**
   * 片6a-1:那一列的**殼**要畫成什麼。
   *
   * · `table-row` —— 舊殼:`<tr>` + `<td>`(整頁版沿用)。
   * · `card-line` —— 新殼:`<details class="icard">`,`<summary>` 是 `.iline` grid
   *   (設計稿 08-17 `:280-299`;Sean 2026-08-19 逐字選「一個商品一張卡片,沒有表格」)。
   *
   * 🔴🔴 **兩個殼共用同一條錢的路徑,而那是本 prop 存在的理由**:
   *    `blockedReason` 同時決定①入口文案(「無法改金額(看原因)」)②傳給 `ItemAmountForm`。
   *    **殼換了,那條路徑一個字都不能變** —— 而「一道閘在殼被重寫的過程中被漏掉」
   *    **不會有東西紅**(主視窗 2026-08-19 裁本片中鐵則 12① 用的就是這個理由)。
   *    ⇒ 守門在 `item-amount-row.test.tsx`:**兩個 variant 各驗兩個世界**
   *      (已收款 ⇒ 擋住、未收款 ⇒ 放行)。**只驗放行那半不算過。**
   */
  variant?: 'table-row' | 'card-line';
  /**
   * 片6a-2:**這一張卡預設要不要是打開的**(= `item-stuck.ts` 判它卡住了)。
   *
   * 🔴🔴 **它與「改金額展開」是【兩個不同的理由】,而它們共用同一個 `open`** ——
   *    這是本 prop 最需要被讀懂的一格:
   *      · `defaultOpen` 只影響**第一次渲染時的初值**(卡住的那一項一打開頁面就是開的)
   *      · 之後任何一次點擊(卡片本身或那顆「改金額」)都會寫進 `OpenRowContext`,由它接管
   *    ⇒ **不是「卡住的卡永遠打不開/關不掉」** —— 員工照樣收得起來。
   * 🔴 **而它必然帶一個代價,寫出來不要假裝沒有**:`OpenRowContext` 只有一個 `openId`
   *    ⇒ **同時只能有一張卡是開的**。若一張單有**兩項**都卡住,**只有第一項會自己打開**。
   *    ⚠️ 那是既有約束(「只展開正在編輯的那一項」,codex 版面片 R1 must-fix 1)與本片需求的**真衝突**。
   *    ⇒ **本片選擇不動那個約束**(動它會讓改金額可以同時開兩張,那是錢的面)
   *      ⇒ **列成肉眼題送 Sean**:「兩項都缺料時,要不要兩張卡都自己打開?」
   *    ⇒ 而**沒有自己打開的那幾項,原因仍然看得見** —— `describeItemStuck` 那行字在卡頭底下,
   *      不依賴卡片開不開。**功能不是靜默失效,只是少了一個便利。**
   */
  defaultOpen?: boolean;
  /** 展開列要跨幾欄(= 表格欄數)。`card-line` 用不到它(卡片沒有欄)。 */
  colSpan: number;
  /** 單價格的 class(沿用表格既有的對齊與字體) */
  /**
   * 🔴 **只有 `table-row` 殼吃它** —— 卡片殼沒有 `<td>` / `<tr>` 可以掛 class。
   *    改成選填是為了讓**型別自己說出「這是舊殼專用」**,而不是留一個在卡片殼裡被默默忽略的 prop。
   */
  priceCellClassName?: string;
  /**
   * 🔴 **只有 `table-row` 殼吃它** —— 卡片殼沒有 `<td>` / `<tr>` 可以掛 class。
   *    改成選填是為了讓**型別自己說出「這是舊殼專用」**,而不是留一個在卡片殼裡被默默忽略的 prop。
   */
  rowClassName?: string;
  /**
   * 🔴 **片7:卡片展開區裡、改金額表單【之上】的內容**(= 那一項的採購與到貨)。
   *
   * server 算好傳進來 —— 本檔是 client 島,**不要在這裡長出任何取資料的邏輯**。
   * ⚠️ **只有 `card-line` 殼吃它**:`table-row` 那個舊殼的展開列只放改金額表單。
   *    選填是為了讓型別自己說出這件事(同 `priceCellClassName` / `rowClassName` 的理由)。
   */
  body?: ReactNode;
} & ItemAmountFormProps;

export function ItemAmountRow({
  brandLine,
  before,
  priceText,
  after,
  colSpan,
  priceCellClassName,
  rowClassName,
  blockedReason = null,
  variant = 'table-row',
  defaultOpen = false,
  body,
  ...formProps
}: ItemAmountRowProps) {
  const ctx = useContext(OpenRowContext);
  // 🔴 沒有 provider 就 fail-closed 成「永遠收合」——**不要退回各自為政的 local state**,
  //    那正是這條 must-fix 要修掉的行為。少包 provider 的症狀是「按了沒反應」,查得出來;
  //    退回 local state 的症狀是「兩列同時開」,而那**看起來像正常運作**。
  /**
   * 🔴🔴 判準是 **`touched`**,不是 `openId == null`(`W6-030` M1)。
   *
   * ⚠️ **上一版的意圖是對的、條件是錯的**:註解寫著要防「收起來之後又自己彈開」,
   *    而它用 `openId == null` 當「還沒有人動過」—— **那個值正是【收起來】的結果**
   *    ⇒ 它防的那件事,由它自己造成。
   * 🔴 **而當時那格測試釘的是【原始碼字面】`openId == null ? defaultOpen`**
   *    ⇒ **它確認了 bug 在場,不是抓到它。**
   *    ⇒ 現在那一格改成**行為測試**(開 → 收 → 那張卡必須仍是收的),見 shape test。
   */
  // 🔴 **`?? false` 少不得(`W6-031` N2)**:沒有 provider 時 `ctx?.touched` 是 `undefined`,
  //    而 `undefined === false` 為 **false** ⇒ 會落到「已經動過」那半 ⇒ **`defaultOpen` 靜靜失效、卡片永遠不開**。
  //    ⚠️ 今天不可觸發(唯一渲染點包在 `<ItemAmountRowGroup>` 裡,W6 grep 過全樹)——
  //    **但 `ctx?.` 這個寫法本身就在宣告「provider 是可選的」** ⇒ 日後有人單獨渲染它,
  //    **失效的方向是靜默的**(卡片不開,而沒有東西會紅)。
  const touched = ctx?.touched ?? false;
  const open = touched ? ctx?.openId === formProps.orderItemId : defaultOpen;
  /**
   * 🔴 **片7:改金額表單自己的開關。**
   * `table-row` 那個舊殼沒有 `body`、展開區只有表單 ⇒ 它照舊吃 `open`(行為一個字沒變)。
   * `card-line` 吃 `amountEditId` ⇒ **打開卡片不會順便把改金額表單掀開來。**
   * ⚠️ 沒有 provider 時 `ctx` 是 `null` ⇒ `amountOpen` 恆 false ⇒ **fail-closed**
   *    (與 `open` 那條同一個立場:少包 provider 的症狀是「按了沒反應」,查得出來)。
   */
  const amountOpen =
    variant === 'card-line' ? ctx?.amountEditId === formProps.orderItemId : open;

  /**
   * 🔴 **入口與表單抽成兩個區域變數,兩個殼吃【同一份】** ——
   *    複製一份到卡片殼裡,就是給那道錢閘開第二條路徑,而兩條會各自漂。
   */
  const trigger = (
    // 🔴 **不能改時,入口的字要先講出來**(codex must-fix 2)。
    //    第一版註解寫「改成一個停用的按鈕」而 code **根本沒有 disabled** —— 那是字面 vs 事實。
    //    ⚠️ 而**真的 disabled 也不對**:原因就寫在展開列裡,停用等於把原因鎖住看不到。
    //    ⇒ 折衷:**入口先說「無法改金額」,點開才看原因**。
    <button
      type='button'
      /**
       * 🔴🔴 **片7:這顆鈕現在只管「改金額表單」,不再等同於「卡片開合」。**
       * 打開時**順便把卡片撐開**(否則表單被 `<details>` 藏起來,按鈕看起來沒反應);
       * 關閉時**只收表單、卡片留著** —— 員工是為了看採購才打開那張卡的,
       * 收個表單把整張卡一起關掉會把他趕回起點。
       * ⚠️ `setOpenId` 會清掉 `amountEditId`(見 provider)⇒ **順序不可換**:
       *    先 `setOpenId` 再 `setAmountEditId`,反過來會被自己清掉。
       */
      onClick={(e) => {
        /**
         * 🔴🔴 **`e.preventDefault()` 不是修 bug,是把一個【沒有寫在任何地方的依賴】拿掉**
         *    (W6 `W6-056` 開了 must-fix、被我的真瀏覽器量測推翻成 nit,而殘留是結構性的)。
         *
         * 這顆鈕住在 `<summary>` 裡 ⇒ **點它,瀏覽器一定會原生切換一次 `<details>`**。
         * 片7 之前那無害(舊的 onClick 與原生想做同一件事);片7 之後**兩者不同意** ——
         * 而不同意的正好是本片的兩個賣點(打開卡片不掀表單 / 收表單不關卡片)。
         * ⚠️ 我在 chromium 1.60 上量到**它今天沒有壞**:③ 展開的卡 1→1、④ 表單收掉而卡仍是 1。
         *    但那份正確依賴「React 把 `open` 還原」早於「非同步 `toggle` 讀 `e.currentTarget.open`」,
         *    而**那個順序沒有寫在任何規格裡** ⇒ 一個瀏覽器、一次量測撐不起它。
         * ⇒ 擋掉原生行為,讓這顆鈕**只做 onClick 說的那件事**。
         */
        e.preventDefault();
        if (variant !== 'card-line') {
          ctx?.setOpenId(open ? null : formProps.orderItemId);
          return;
        }
        if (amountOpen) {
          ctx?.setAmountEditId(null);
          return;
        }
        ctx?.setOpenId(formProps.orderItemId);
        ctx?.setAmountEditId(formProps.orderItemId);
      }}
      className='mt-0.5 text-xs underline'
      aria-expanded={amountOpen}
    >
      {blockedReason
        ? amountOpen
          ? '收起'
          : '無法改金額(看原因)'
        : amountOpen
          ? '收起'
          : '改金額'}
    </button>
  );
  const form = <ItemAmountForm {...formProps} blockedReason={blockedReason} />;

  if (variant === 'card-line') {
    return (
      // 🔴 逐字搬設計稿 08-17 `:116-117`:`.icard` 只有 `border-bottom`、`summary` 去掉三角形。
      //    `open` 受控 —— 卡片在「改金額」展開時要跟著開,否則表單被 `<details>` 藏起來
      //    而按鈕看起來沒反應。⚠️ 片6b 把採購那層放進 `.icardbody` 之後,
      //    卡片要能【獨立於改金額】開合 ⇒ 那時這裡的受控條件要一起重想,不要照抄。
      <details
        className='icard'
        open={open}
        // 🔴🔴 **codex 關卡2 must-fix 2**:上一版寫 `open={open || undefined}`,
        //    那讓 DOM 與 `OpenRowContext` **會分岔**:表單展開後(`open === true`)使用者
        //    **直接點 `<summary>` 手動收合** ⇒ 瀏覽器把 DOM 的 `open` 拿掉,而 context 仍是開的
        //    ⇒ **表單被藏住、按鈕仍寫「收起」、`aria-expanded` 仍是 `true`,而要按兩次才回得來。**
        //    ⇒ 改成**單一狀態模型**:`open` 完全由 context 決定,而 `onToggle` 把使用者的手動操作
        //      同步回 context ⇒ **兩邊不可能分岔**(點卡片 = 展開改金額,與點那顆入口同一件事)。
        // ⚠️ **片6b 的交棒**:那時 `.icardbody` 會多出採購那層,**卡片就需要能【獨立於改金額】開合**
        //    ⇒ 到那時要拆成兩個狀態,**不要照抄這裡**。
        // 🔴 片7:這裡管的是**卡片**。使用者手動收合 ⇒ `setOpenId(null)`,
        //    而 provider 會順手把 `amountEditId` 清掉(見那段檔頭)。
        onToggle={(e) => {
          const next = e.currentTarget.open;
          if (next !== open) ctx?.setOpenId(next ? formProps.orderItemId : null);
        }}
      >
        {/* 🔴 `.iline` **必須包住全部六格** —— 它與 `.ihead` 共用同一組軌道,
            而設計稿 `:119-120` 記著:兩個獨立 grid 的 `auto` 欄各自依內容算寬
            ⇒ **實測整排錯開 8px**。少了這層包裹,六格就不在同一個 grid 裡。 */}
        <summary>
          {brandLine}
          <div className='iline'>
            {before}
            <div className='text-right'>
              <div className='tabular-nums text-xs whitespace-nowrap'>{priceText}</div>
              {trigger}
            </div>
            {after}
          </div>
        </summary>
        {/* 🔴 片7:展開區 = 採購那一層(`body`)+ 改金額表單(只有點過那顆鈕才出現)。
            兩者的開關不同,理由在 `amountEditId` 的檔頭。 */}
        {open ? (
          <div className='icardbody'>
            {body}
            {amountOpen ? form : null}
          </div>
        ) : null}
      </details>
    );
  }

  return (
    <>
      <tr className={rowClassName}>
        {before}
        <td className={priceCellClassName}>
          <div>{priceText}</div>
          {/* 🔴 **不能改時也要看得見那顆入口的位置** —— 直接不畫會讓員工找不到而懷疑自己。
              **入口本體已抽成上面的 `trigger`,兩個殼共用**(見 `variant` 那段:
              複製一份到卡片殼裡 = 給那道錢閘開第二條路徑,而兩條會各自漂)。 */}
          {trigger}
        </td>
        {after}
      </tr>
      {open ? (
        <tr className={rowClassName}>
          {/* 🔴 展開列**跨滿整張表** ⇒ 表單有自己的橫向空間,
              確認句、原因欄、之後的錯誤提示都放得下,不必再為每個新欄位打一次版面仗。 */}
          <td colSpan={colSpan} className='bg-muted/30 px-3 py-2'>
            {form}
          </td>
        </tr>
      ) : null}
    </>
  );
}
