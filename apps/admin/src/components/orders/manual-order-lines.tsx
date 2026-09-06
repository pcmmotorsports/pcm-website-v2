'use client';

import { useEffect, useState } from 'react';
import { ManualOrderLinePriceCheck } from './manual-order-line-price-check';
import {
  MANUAL_ORDER_LINE_SEED_EVENT,
  type ManualOrderLineSeed,
} from '../../lib/orders/manual-order-line-seed';
import {
  MANUAL_ORDER_LINE_QTY_BASE,
  MANUAL_ORDER_LINE_SKU_BASE,
  MANUAL_ORDER_LINE_SPEC_BASE,
  MANUAL_ORDER_LINE_TAX_BASIS_BASE,
  MANUAL_ORDER_LINE_TAX_BASIS_TAXED,
  MANUAL_ORDER_LINE_TAX_BASIS_UNTAXED,
  MANUAL_ORDER_LINE_TITLE_BASE,
  MANUAL_ORDER_LINE_UNIT_PRICE_BASE,
  MANUAL_ORDER_LINE_VARIANT_BASE,
  MANUAL_ORDER_MAX_LINES,
  manualOrderLineField,
} from '@/lib/orders/manual-order-form';

// manual-order-lines.tsx — M12-A3-c:手動建單的**品項列**(主視窗 2026-08-24 裁「丙」)。
//
// 🔴🔴 **不變式(i),逐字抄自 `cancel-form-body.tsx`,而本檔比它更嚴**:
//    「送出值一律**不由 client state 產生或回寫;原生控制項才是送出來源**」
//    —— 那是 `E-011-STOP` 四輪修不穩 + 一次**誤送整單取消**換來的,不是風格。
//
//    **本檔的 state 只有一個東西:`rows`,一個 id 陣列。**
//    它決定「畫面上有幾列」,**一個值都不讀、不寫、不組**。
//    · 每個 input 都是**非受控**(`defaultValue` 或什麼都不給),沒有 `value=`、沒有 `onChange`
//    · 加一列 = `rows` 多一個 id;刪一列 = 少一個 id ⇒ 那一列的 DOM 消失 ⇒ 它的值自然不送
//    · **沒有任何一條路徑**把 state 寫回控制項、或拿 state 去組另一個送出值
//    ⇒ 「畫面顯示的品項」與「送出去的品項」**沒有可以分岔的地方**,不是靠小心。
//    🔴 有原始碼層守門釘住這件事(`manual-order-lines.test.tsx` 的「本檔不得出現 value=」那一格)。
//
// 🔴 **為什麼是六個平行欄位而不是一個 JSON 欄**:見 `manual-order-form.ts` 欄位常數那一段。
//    一句話:湊 JSON 一定得「讀值再組值」,那正是不變式 (i) 禁止的動作。
//
// ⚠️ **`line_spec` 沒有畫面入口**(任意鍵字典,原生控制項表達不出來)⇒ 送空字串。
//    **這是明說的缺口,不是做完了。** 那個欄位仍然逐列送出 —— 理由**不是**「長度要全等」
//    (那是第一版的形狀,已退場):現在是**這一列在席就六格全部都要在席**,少送任一格 ⇒ 整張表單被拒。
// 🔴🔴 **而這個缺口的真正代價已經量到了, 比「少一個輸入框」大**:
//    RPC 把送進去的 spec 直接寫成不可變的 `product_snapshot.spec`(`20260824020000:422`)
//    ⇒ 有顏色/尺寸的既有 variant, 手動建單之後那份快照**永遠是 `{}` 且補不回來**。
//    主視窗 2026-08-24 裁「乙 = server 依 variant_id 取權威 spec」為**另一片、上線前硬前置**。
//
// 🔴🔴 **React 19 表單 reset 在本檔【不是】取消線那個坑**,而理由要寫清楚,不要靠感覺:
//    取消線踩到的是「reset 把數量欄還原成 `defaultValue`(= 可取消上限)⇒ 第二次送出變多」。
//    本檔的 `defaultValue` 全部是**空的**(或 `0`)⇒ reset 只會把列清空,**不會把數量放大**。
//    而 `createManualOrderAction` 是**全 PRG**(每一條路徑都 `redirect()`)⇒ 送出後畫面本來就換掉。
//    ⚠️ **但 `rows` 是 state ⇒ reset 之後列數還在、值沒了。** 那個狀態是「幾個空列」,
//       而空列會被解析器跳過 ⇒ **不會產生一張少了品項卻說成功的單**。
//
// ⚠️ **本片【不含】「複製上一張單」**(A3-c 原本綁著它)——
//    那需要伺服器端去載上一張單並回填,是另一片。**它欠著,不是做完了。**
//    🔴 而它的坑已經寫在 `manual-order-form.ts` 的 `newManualRequestId` docstring 裡:
//       複製時**必須產新的冪等鍵**,沿用舊的且內容沒改 ⇒ RPC 回 `idempotent:true` + 舊單號
//       ⇒ 員工以為建了第二張,其實沒有,**而那條路回的是成功、不是錯誤**。

/** 一列的 id。**只用來當 React key 與刪除的標的,永遠不進 FormData。** */
let nextRowId = 0;
const newRowId = () => (nextRowId += 1);

/**
 * 一列 = 一個 id + 可選的種子。
 * 🔴 **種子只走 `defaultValue=`** —— 那是「開場值」, 瀏覽器拿一次之後這一格就歸員工。
 *    ⇒ 本檔那條不變式(送出的值不由 client state 產生或回寫)**仍然逐字成立**:
 *      沒有 `value=`、沒有 `onChange`、沒有 `.value =`。
 * 🛑 而 **id 必須跟著換**(`key` 換掉 ⇒ React 重建那一列)——
 *    只改 seed 不換 key 的話, `defaultValue` 對一個**已經存在**的 DOM 節點**沒有作用**,
 *    畫面會一格都不動, 而 state 上看起來是對的。
 */
type LineRow = { id: number; seed?: ManualOrderLineSeed };

export type ManualOrderLinesProps = {
  /** 一開始擺幾列空白。預設 1 —— 員工進來就看得到一列可以打字的東西。 */
  initialRows?: number;
};

export function ManualOrderLines({ initialRows = 1 }: ManualOrderLinesProps) {
  const [rows, setRows] = useState<LineRow[]>(() =>
    Array.from({ length: Math.max(1, initialRows) }, () => ({ id: newRowId() })),
  );

  // 🔴 「查商品 ⇒ 點一下加成一列」的接收端(⟦b4-建單加成一列⟧ 2026-09-06)。
  //  🔵 **只有這一側算 index** —— 查詢那一側只丟事件, 不碰表單。
  //     解析器 `manual-order-form.ts:339-347` 要求 `_0.._n` 連號, 兩邊各自算必撞。
  //  🔴🔴 **一律 append —— 而我第一版不是這樣寫的, 那一版會【弄丟員工打的字】。**
  //   ⛔ ~~`if (r.length === 1 && r[0]?.seed === undefined) return [{ id: newRowId(), seed }];`~~
  //      我的理由是「員工進來看到一列空的, 查完又多一列空的在上面, 那看起來像壞掉」。
  //   🛑 **而「沒有 seed」不等於「是空的」** —— 員工先在第 1 列手打一筆**代購**品項
  //      (代購本來就沒有料號、沒有 seed), 再去查第二樣東西按「加成一列」
  //      ⇒ 那一列被換成新 id ⇒ `key` 變 ⇒ React 重建那一列 ⇒ **他打的字全沒了, 零提示。**
  //   🔬 而**那個修法會綠的唯一機制, 就是舊 DOM 節點被丟掉**(見上面 `LineRow` 那段註解:
  //      `defaultValue` 對已存在的節點沒有作用 ⇒ 我必須換 key ⇒ 換 key 就是丟掉他打的字)。
  //      ⇒ 📌 **我寫的那格測試「種進那一列」, 斷言的正是這個 bug。**
  //   🛑 而既有那格「員工改過的字不會被蓋掉」**分母不含出事的世界** —— 它是【先種再打】,
  //      而出事的順序是【先打再種】。
  //   ✅ plan §4 驗收 ① A 逐字要的就是相反:「第 1 列已打的 'X' 仍是 'X'」、種進**第 2 列**。
  //   🔵 那個「上面一列空的」的顧慮仍然成立, 而它的代價是**畫面不好看**;
  //      弄丟他打的字的代價是**他要重打, 而且不知道自己被弄掉了**。兩者不對等。
  useEffect(() => {
    const onSeed = (e: Event) => {
      const seed = (e as CustomEvent<ManualOrderLineSeed>).detail;
      setRows((r) => {
        if (r.length >= MANUAL_ORDER_MAX_LINES) {
          setAddedNote(`已經有 ${MANUAL_ORDER_MAX_LINES} 個品項了,沒有加進去。`);
          return r;
        }
        // 🔴🔴 **同一個商品不得加第二列**(codex must-fix;提示擋不住這件事)——
        //  🛑 兩列同一個 `variant_id` ⇒ 建單 RPC `20260905360000:408-414`
        //     `RAISE EXCEPTION '重複品項'` ⇒ **整張單被拒**(不是那一列被跳過),
        //     而他打的其他東西也一起沒了。
        //  ⇒ 📌 我第一版只加了一句「已加成第 N 列」—— **那是回饋, 不是守門**:
        //     連按兩下、或隔一次搜尋再加同一筆, 照樣生出兩列。
        //  🔵 只比對【有商品編號的那些】—— 代購品項沒有編號, 而**同一張單開兩列代購是合法的**。
        if (seed.variantId !== '' && r.some((x) => x.seed?.variantId === seed.variantId)) {
          setAddedNote(`這個商品已經在單子上了(${seed.sku}),沒有再加一列。要買兩個請改數量。`);
          return r;
        }
        setAddedNote(`已加成第 ${r.length + 1} 列:${seed.sku}`);
        return [...r, { id: newRowId(), seed }];
      });
    };
    window.addEventListener(MANUAL_ORDER_LINE_SEED_EVENT, onSeed);
    return () => window.removeEventListener(MANUAL_ORDER_LINE_SEED_EVENT, onSeed);
  }, []);

  /**
   * 🔴 **按了要出聲**(code-reviewer R1 MF3)——
   * ⛔ 第一版按下去**一句話都沒有**:員工不確定有沒有成功 ⇒ 再按一次
   *    ⇒ 兩列同一個 `variant_id` ⇒ `20260905360000:408-414` `RAISE EXCEPTION '重複品項'`
   *    ⇒ 📌 **整張單被拒**(而他打的其他東西也一起沒了)。
   * 🛑 而本片之前那條路要**手打一模一樣的 uuid** 才碰得到 ⇒ 本片把它從「實務不可達」變成「按兩下」。
   * 🔵 這個 state **只餵一句畫面上的話**, 不進任何 `name=` 欄位 ⇒ 那條不變式不受影響。
   */
  const [addedNote, setAddedNote] = useState('');

  const atMax = rows.length >= MANUAL_ORDER_MAX_LINES;

  return (
    <fieldset className='space-y-2 rounded-md border p-3' data-testid='manual-order-lines'>
      <legend className='px-1 text-sm'>品項</legend>

      <p className='text-muted-foreground text-sm'>
        網站上沒有的東西(代購)就把「商品編號」留白,品名跟金額自己打。
      </p>
      {/*
        🔴 這一行是【安全標籤】,不是說明文字 —— 而它今天是這件事唯一的保護。

        事實(2026-08-29 線C 量,唯讀):
          · 代購品項的單價**員工手打**,一路到 DB。
          · 全程對它的檢查只有「是不是非負整數」——
            `manual-order-form.ts:219` 逐字 `const NON_NEG_INT_RE = /^\d+$/;`
            + RPC 側 `20260824020000:362-363` 的 `< 0` 一格。
          · 🔴 實演過:未稅 1000(少收 5%) 與 含稅 1050(正確)**兩個世界一起通過**;
            而負對照 `-1` / `10.5` / 空字串都擋下 ⇒ **尺是活的, 它只是對這個問題沒有判別力。**
          · 🔴 而「含稅/未稅」這個資訊**全 repo 沒有任何欄位存它**
            (`tax_inclusive` / `taxInclusive` / `is_tax_included` / `price_includes_tax` ⇒ **四個字面全 0**;
             正對照 `tax_total` ⇒ 2 檔, 而那兩檔都是 migration 且⛔ ~~**都還沒 apply**~~)。
            ⚠️ **2026-09-04 訂正:「還沒 apply」那句今天不成立。**
            🔬 `supabase/APPLIED.tsv:358` 逐字:`20260831180000` · `2026-09-02` ·
               「Sean(SQL Editor 本人貼, 回『Success. No rows returned』)」⇒ **它貼了。**
            📌 **舊字面留刪除線** —— 一句「還沒 apply」會讓下一個人以為那條路還沒通,
               而它在紙上與「永遠不會通」長得一樣。

        依據(Sean 2026-08-29 拍板;落點是註解, 不是欄位):
          `packages/domain/src/catalog/types.ts:167-169` —— general = 含稅 / store = 未稅。
          ⚠️ 同處 `:169` 標著「premiumStore 那格是**推的, 不是拍板的**」⇒ 引用時不要連它一起讀成拍板。
          `packages/domain/src/catalog/pricing.ts:35-36` 逐字:
            「回傳值的【單位隨 tier 而變】,而型別不變…三者都是 `Money`,**呼叫端分不出來**。」

        🛑 而這個標籤【沒有解決問題】—— 它把責任**指定給員工**。
        ✅ **可以推翻的形狀**:等「乙(讓價格在型別/欄位層說得出自己含不含稅)」做完,
           這一行就不再是唯一的保護, 那時可以降級成一般說明。
           **在那之前刪掉它 = 拿掉這條路上唯一的東西。**
      */}
      {/*
        ⚠️ 文案的精確度(code-reviewer 2026-08-29 nit,已改):
        原句「填成未稅會少收 5%」—— 那個 5% 是**加在未稅金額上的稅率**,
        而它讀起來像「正確金額的 5%」(1050 裡少了 50 ⇒ 其實是 4.76%)。
        ⇒ 改成**給一組實際數字**:比一個百分比不容易讀錯,而且不必解釋是誰的 5%。
      */}
      {/* 🔴🔴 **[2026-09-05 · Sean 拍 `⟦b4-PRICECOPYTAX⟧` 甲 ⇒ 這句話的方向【整個反過來】]**
          逐字:**單價填【未稅】, 系統算稅**。
          ⛔ ~~單價這一格請填**含稅**金額 —— 未稅 1,000 要填 1,050。填成未稅就少收那 5% 的稅~~
          ✅ ⇒ **請填未稅**;而填錯的後果也跟著反 —— 從「少收」變成「**多課一次**」。
          🛑🛑 **而這句話【不能單獨上線】** —— 今天 `admin_create_manual_order` 的
             `tax_total` 是**寫死 0**(`20260905130000:596`), 而它把送進來的單價**當成含稅**。
             ⇒ 只改這句 ⇒ 員工填未稅 1,000 ⇒ **系統當它含稅 ⇒ 那一單少收 50 元的稅。**
             ⇒ 🔴 **本片刻意留在分支 `agent/line-account-taxcopy`, 等 RPC 第 6 代貼進正式庫才收。**
             (形狀同 `agent/line-account-mailE` 與 `agent/line-account-csvtax`。)
          ⚠️ **而下面那段舊註解講的是【舊方向】的理由** —— 逐字留著不刪,
             它記著「主詞為什麼從『代購品項』擴成『單價這一格』」, 而那一格**現在仍然成立**。 */}
      <p className='text-sm font-medium text-amber-700 dark:text-amber-500'>
        {/* 🔴 **主詞從「代購品項」擴成「單價這一格」**(Sean 2026-08-31 拍甲「標未稅」,
              主視窗 15:5x 裁文案)—— ⛔ ~~原本寫「代購品項請填含稅金額」~~。
            成因:料號帶入之後多了一條**非代購**的路會撞到同一件事 ——
            員工把「經銷 Y(未稅)」複製貼進這一格, 而這一格假設含稅。
            📌 而不另寫第二句的理由:**那條規則本來就是全稱的**(單價一律填含稅,
              與是不是代購無關)⇒ 寫成兩句會讓讀的人以為有兩種規則, 而兩句都變輕。
            🛑 而「5% / 4.76%」那半句**刻意不動**(見下方註解)—— 改它是另一個文案題。 */}
        <strong>單價這一格</strong>請填<strong>未稅</strong>金額 —— 經銷價單上多少就填多少。
        稅由系統自己算,不要自己加上去;填成含稅會多課一次稅。
      </p>

      {rows.map((row, index) => (
        <div key={row.id} className='grid grid-cols-12 gap-2' data-testid='manual-order-line-row'>
          <label className='col-span-2 text-sm'>
            <span className='sr-only'>第 {index + 1} 列料號</span>
            <input
              autoComplete='off'
              name={manualOrderLineField(MANUAL_ORDER_LINE_SKU_BASE, index)}
              defaultValue={row.seed?.sku}
              placeholder='料號'
              className='block w-full rounded-md border px-2 py-1'
            />
          </label>
          {/* 🔴 ⛔ ~~`col-span-4`~~ ⇒ `col-span-3`(⟦b4-PURCHTAX1⟧ 2026-09-06)——
              騰一格出來給稅基那一欄。12 格是硬的:2+3+1+2+1+2+1 = 12,
              少算一格就會有東西被擠到下一行。⚠️ 代價明寫:**品名那一格變窄了**,
              而它是這一列最常被讀的。改回去的話要從別處拿一格, 不能只把這裡加寬。 */}
          <label className='col-span-3 text-sm'>
            <span className='sr-only'>第 {index + 1} 列品名</span>
            <input
              autoComplete='off'
              name={manualOrderLineField(MANUAL_ORDER_LINE_TITLE_BASE, index)}
              defaultValue={row.seed?.title}
              placeholder='品名'
              className='block w-full rounded-md border px-2 py-1'
            />
          </label>
          <label className='col-span-1 text-sm'>
            <span className='sr-only'>第 {index + 1} 列數量</span>
            <input
              autoComplete='off'
              name={manualOrderLineField(MANUAL_ORDER_LINE_QTY_BASE, index)}
              defaultValue={row.seed?.qty}
              inputMode='numeric'
              placeholder='數量'
              className='block w-full rounded-md border px-2 py-1'
            />
          </label>
          <label className='col-span-2 text-sm'>
            <span className='sr-only'>第 {index + 1} 列單價</span>
            <input
              autoComplete='off'
              name={manualOrderLineField(MANUAL_ORDER_LINE_UNIT_PRICE_BASE, index)}
              defaultValue={row.seed?.unitPrice}
              inputMode='numeric'
              placeholder='單價'
              className='block w-full rounded-md border px-2 py-1'
            />
          </label>
          {/* 🔴🔴 **稅基**(⟦b4-PURCHTAX1⟧ 2026-09-06,Sean `Q5 = 甲`:代購單價沒有含稅保證)。
              🎯 **它問一句, 而不是猜** —— 代購品項沒有權威價可比, 任何「看起來像含稅就擋」
                 在那一側只能是猜的;而把猜測講成指示正是隔壁比價元件被 codex 修掉的東西。
              🔴 **每一列都有它, 不是只有代購列** —— `manual-order-form.ts` 的 `readLines()`
                 不變式是「這一列在席 ⇒ 每一格都要在席」⇒ 只長在代購列會讓型錄列少一格
                 ⇒ **整張表單被拒**。型錄列預設值與今天相同(未稅)⇒ 零行為改變、零額外點擊。
              🛑 **它是 `defaultValue` 不是 `value`** —— 本檔那條不變式(送出的值不由 client
                 state 產生或回寫)對這一格一樣成立。換算在 server 端做, 瀏覽器只預覽。 */}
          <label className='col-span-1 text-sm'>
            <span className='sr-only'>第 {index + 1} 列單價是未稅還是含稅</span>
            <select
              // 🔴 `select` 也會被瀏覽器 autofill ⇒ 與同表單每一個文字類控制項同一條規矩
              //    (分母守門 `manual-order-form-body.test.tsx:227` 會數它)。
              autoComplete='off'
              name={manualOrderLineField(MANUAL_ORDER_LINE_TAX_BASIS_BASE, index)}
              defaultValue={MANUAL_ORDER_LINE_TAX_BASIS_UNTAXED}
              className='block w-full rounded-md border px-2 py-1'
            >
              <option value={MANUAL_ORDER_LINE_TAX_BASIS_UNTAXED}>未稅</option>
              <option value={MANUAL_ORDER_LINE_TAX_BASIS_TAXED}>含稅</option>
            </select>
          </label>
          <label className='col-span-2 text-sm'>
            <span className='sr-only'>第 {index + 1} 列商品編號(代購留白)</span>
            <input
              autoComplete='off'
              name={manualOrderLineField(MANUAL_ORDER_LINE_VARIANT_BASE, index)}
              defaultValue={row.seed?.variantId}
              placeholder='商品編號'
              className='block w-full rounded-md border px-2 py-1'
            />
          </label>
          {/* 🔴 規格這一格**沒有畫面入口**(見檔頭),而它仍然逐列送出。
              ⚠️ 用 `type='hidden'` 而不是不渲染:**這一列在席就六格全部都要在席**,
              少送它 ⇒ 解析器判「缺格」⇒ 整張表單被拒(不是靜默補空)。 */}
          <input type='hidden' name={manualOrderLineField(MANUAL_ORDER_LINE_SPEC_BASE, index)} />
          <div className='col-span-1 flex items-center'>
            {/* 🔴 只剩一列時**不出**刪除鈕 —— 刪光之後畫面上沒有東西可以打字,
                而員工看不出下一步是什麼(他會以為壞了)。 */}
            {rows.length > 1 && (
              <button
                type='button'
                aria-label={`刪掉第 ${index + 1} 列`}
                className='rounded-md border px-2 py-1 text-sm'
                onClick={() => setRows((r) => r.filter((x) => x.id !== row.id))}
              >
                刪掉
              </button>
            )}
          </div>

          {/* 🔴 ⟦b4-PURCHTAX1⟧ 甲案:比對型錄的權威含稅價。**它問一句, 不擋送出、不回寫欄位。**
              🛑 **刻意做成獨立元件** —— 本檔有一條不變式(送出的值不由 client state 產生或回寫)
                 與三道原始碼層守門在守它(`manual-order-lines.test.tsx:105-118`)。
                 我第一版把比價 state 寫進本檔 ⇒ 兩道當場紅 ⇒ **我沒有去改守門**(那是動驗證本身),
                 改成搬出去。那支元件**不渲染任何帶 `name=` 的 input** ⇒ 不變式仍然逐字成立。
              🔴 而它對**代購品項無效**(沒有權威價可比)⇒ 上面那句安全標籤仍是那一半唯一的保護。 */}
          <ManualOrderLinePriceCheck index={index} />
        </div>
      ))}

      <div className='flex items-center gap-2'>
        <button
          type='button'
          disabled={atMax}
          className='rounded-md border px-3 py-1 text-sm disabled:opacity-50'
          onClick={() => setRows((r) => [...r, { id: newRowId() }])}
        >
          加一列
        </button>
        {/* 🔴 撞到上限要**說出來**,不是讓那顆鈕安靜地按不動 ——
            按不動而沒有話,員工會以為是網頁壞了(`project_admin-ux-operation-intuitiveness`)。 */}
        {/* 🔴 按了要出聲(MF3)。🔵 `role='status'` 與旁邊那句同一種, 不自創樣式。 */}
        {addedNote !== '' && !atMax && (
          <span role='status' className='text-muted-foreground text-sm'>
            {addedNote}
          </span>
        )}
        {atMax && (
          <span role='status' className='text-sm text-amber-700'>
            一張單最多 {MANUAL_ORDER_MAX_LINES} 個品項,再多請拆成兩張單。
          </span>
        )}
      </div>

      {/* ⚠️ 這裡**沒有**小計 —— 金額由 RPC 自己算,它不信任何 client 送的合計
          (`manual-order-form.ts` 那段逐字)。在畫面上算一份會生出「畫面說 A、單子是 B」的第二個真相。 */}
    </fieldset>
  );
}
