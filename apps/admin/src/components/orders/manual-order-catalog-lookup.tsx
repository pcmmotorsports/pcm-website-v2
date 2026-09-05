'use client';

import { useState } from 'react';
import { searchManualOrderCatalogAction } from '@/lib/orders/manual-order-catalog-actions';
import type { ManualOrderCatalogHit } from '@/lib/orders/manual-order-catalog';

// manual-order-catalog-lookup.tsx — ⟦b4-SKULOOKUP⟧ 片2:**查到的東西顯示在旁邊, 員工自己抄。**
//
// 🔴🔴 **為什麼是【顯示】不是【帶入】—— 這一段是本檔存在的理由, 不要當背景說明**:
//    Sean 2026-08-31 原本要的是「打料號 ⇒ 自動【帶入】品名、數量預設 1」。
//    而 `manual-order-lines.tsx:17-20` 有一道不變式逐字:
//      「送出值一律**不由 client state 產生或回寫;原生控制項才是送出來源**」
//      —— 那是 `E-011-STOP` **四輪修不穩 + 一次【誤送整單取消】**換來的, **不是風格**。
//    ⇒ 「帶入」就是回寫 ⇒ **規格與不變式直接相撞**(線 DB 在動手前撞到並停下)。
//    📌 **而這不是他答錯 —— 是他答的時候, 沒有人把那條規矩放進題目裡。**
//    ⇒ Sean 看過三個選項與各自代價之後拍**丙**(他看到的原話:
//      「查到的品名/數量【顯示在旁邊】, 你自己抄過去 —— 跟你在經銷價那題選的一樣」),
//      而**代價他也看過**:「比你想的多一個動作(要抄品名)」。
//
// 🔵 **⇒ 所以本檔【刻意是一支獨立元件】, 不是把查詢塞進 `manual-order-lines.tsx`。**
//    那支檔有**六道原始碼層守門**釘著不變式(不得有 `value=` / `onChange` / spread /
//    `useState<number[]>` / 恰好一個 `useState` / 正負對照)。
//    把查詢做在它裡面 ⇒ 要動那六道的其中兩道 ⇒ **那是把一道用事故換來的守門換鬆。**
//    ⇒ ⇒ 本檔自己有 state, 而它**一個字都不寫回任何 input** —— 兩支檔各自完好。
//
// 🛑 **而丙有一個後果要寫下來, 不要讓它靜靜發生**:
//    「商品編號」那一格 Sean 已裁「hidden 由系統填」(Q3)——
//    ⚠️🔴 **2026-09-04:上面那句拍板【查無來源】。兩個窗、三把尺、零命中, 而正對照證明尺會動**:
//      · `bash scripts/before-asking-sean.sh`(兩組關鍵字)⇒ 五段全零
//      · 逐字 grep 信箱 `hidden 由系統填` / `由系統填` ⇒ 0
//      · 主視窗獨立換關鍵字 `grep -rn 'hidden' ~/pcm-mailbox/等Sean*.md` ⇒ 0
//      · 🟢 正對照:同一把尺找「手動建單」⇒ **169 支** ⇒ 那個 0 不是尺沒接上
//      ⇒ 🔴 **它可能是真的而用了別的字, 也可能從來沒有人拍過。我們分不出來。**
//      🛑 **撞到這裡的人:不要照它做, 也【不要刪它】—— 端給 Sean 確認。**
//      📌 **刪掉的話下一個人會重新發明它, 而這一次的查證就消失了。**
//      🎯 而它今天真的擋住了一件事:主視窗判「留著那一格、改訊息」, 而這句話讓那個實作停了下來
//        —— ⇒ **一句沒有來源的拍板, 擋人的效果與真拍板【完全相同】。**
//    **而丙不回寫 ⇒ 系統填不了它** ⇒ 那一格仍然留白 ⇒ 那一列仍然走【代購】那條路。
//    ⇒ 亦即:本片讓員工**查得到**價格與品名, 而**訂單品項仍然不會對到目錄變體**。
//    📎 那與 `⟦b4-SPEC1⟧`(規格權威)是同一條鏈:那一片今天觸發條件為零, 正是因為這一格。

export type ManualOrderCatalogLookupProps = {
  /** 🔴 只給測試用 —— 讓它不必真的打 server action。生產路徑不傳。 */
  searchAction?: (keyword: string) => Promise<
    { ok: true; hits: ManualOrderCatalogHit[] } | { ok: false; reason: 'denied' | 'error'; message: string }
  >;
};

/** 🔴 金額一律整數元;`null` = 沒有這個價, **不得顯示成 0**(0 是一個合法價格)。 */
function money(v: number | null): string {
  return v === null ? '—' : `${v.toLocaleString('en-US')}`;
}

export function ManualOrderCatalogLookup({ searchAction }: ManualOrderCatalogLookupProps = {}) {
  const [keyword, setKeyword] = useState('');
  const [hits, setHits] = useState<ManualOrderCatalogHit[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    setProblem(null);
    // 🔴🔴 **codex R1 must-fix ③:上一版只有 `finally` 沒有 `catch`。**
    //    action / 網路若 reject(不是回 `ok:false`, 是直接拋)⇒ 這個函式整個往上拋
    //    ⇒ **三態一個都不出現**:沒有結果、沒有「查無」、沒有 alert —— 畫面就停在原樣。
    //    ⚠️ 而更毒的是**前一次查詢的結果會留在畫面上** ⇒ 員工以為那是這一次查的。
    //    📌 **⇒ 「三態互斥」我證過了, 而我沒有證「三態至少有一態」。那是兩個宣稱。**
    // 🔴 先把舊結果清掉再查 —— 清空這一步要在 await 之前, 否則拋出去時舊的還在。
    setHits(null);
    try {
      const r = await (searchAction ?? searchManualOrderCatalogAction)(keyword);
      // 🔴 三態分開接:`ok:false` 的兩種原因(denied / error)員工的下一步不同,
      //    而「查無」是 `ok:true` 且 hits 空 —— **它不是失敗**。
      if (r.ok) {
        setHits(r.hits);
      } else {
        setProblem(r.message);
      }
    } catch {
      // 🔴 **不把 thrown 原文放上畫面** —— 它可能含內部細節;而員工需要的是「這不是你的問題」。
      setProblem('查詢沒有回應,請再試一次;一直這樣請通知維護。這不是料號打錯。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className='rounded-md border p-3' data-testid='manual-order-catalog-lookup'>
      {/* 🔴🔴 **⛔ ~~「請自己填進【上面】那幾格」~~ —— 那句指錯方向**(⟦b4-LOOKUPCOPYDIR⟧,
          2026-09-05 本機後台走查當場撞到)。
          🔬 兩邊逐字讀過:`manual-order-form-body.tsx:220` 的碼註寫著「查商品排在品項列【上面】
             —— 員工的動線是『先查到資料, **再往下填**』」, 而渲染順序確實是本元件在前、
             `<ManualOrderLines/>` 在後 ⇒ 📌 **要填的格子在【下面】, 而畫面上的字說「上面」。**

          🛑 **而修法【不是】把「上面」換成「下面」** —— 那樣同一句話裡會有兩個「下面」
             (結果在下面、格子也在下面), 而它們指的是不同的東西。
          ✅ **改成點名那一區的【名字】**:`manual-order-lines.tsx:72` 的 `<legend>` 逐字就是「品項」。
             🎯 理由不是好聽:**方向詞會在下一次有人調整版面順序時再次變成假的, 而區塊名不會。**
             ⇒ 這一格順手把「同一個病下次還會發生」關掉, 不只修這一次。 */}
      <p className='text-sm font-medium' data-testid='catalog-lookup-hint'>
        查商品(查到的資料顯示在下面,請自己抄進「品項」那幾格)
      </p>
      <div className='mt-2 flex gap-2'>
        <input
          aria-label='要查的料號'
          autoComplete='off'
          placeholder='料號'
          className='block w-64 rounded-md border px-2 py-1'
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        <button
          type='button'
          onClick={run}
          disabled={busy || keyword.trim() === ''}
          className='rounded-md border px-3 py-1 text-sm disabled:opacity-50'
        >
          {busy ? '查詢中…' : '查詢'}
        </button>
      </div>

      {problem !== null && (
        <p className='mt-2 text-sm text-red-700' role='alert'>
          {problem}
        </p>
      )}

      {hits !== null && hits.length === 0 && (
        // 🔴 「查無」與「查詢失敗」在畫面上必須是兩句話 —— 前者他該改關鍵字, 後者他該找人。
        <p className='mt-2 text-sm'>查無這個料號 —— 那就純手動填,品名跟金額自己打。</p>
      )}

      {hits !== null && hits.length > 0 && (
        <ul className='mt-2 space-y-1 text-sm'>
          {/* 🔴 下面那個 <li> 的圓角類別**一定要帶後綴**(此處 `-md`)。少了後綴的那個裸形
              在 Tailwind v4 會產出 `3.40282e38px`(瀏覽器 computed `1.67772e+07px`)
              ⇒ 不是風格問題,**畫面真的會壞**。守門 `app/design-tokens.test.ts` 的案例表
              把「有後綴」逐字列為合規;本檔另外三處(:78/:85/:93)本來就帶後綴 ⇒ 那一行是漏網。
              ⚠️ **本註解刻意不寫出那個裸形** —— 守門連【無引號的註解散文】都會攔。
              🔴 **而這段註解第一版放在 `.map(h => (` 的正下方 ⇒ JSX parse error**
                 (箭頭函式那個位置只能回**一個**元素,註解會變成第二個同層節點)。
                 📌 **而那一版 `design-tokens` 那道守門【照樣印綠】—— 它掃的是文字,不編譯。**
                 ⇒ 一支**根本 parse 不過**的檔,在那道守門底下與一支正確的檔長得一樣。 */}
          {hits.map((h) => (
            <li key={h.variantId} className='rounded-md border px-2 py-1'>
              <span className='font-mono'>{h.sku}</span> · {h.title === '' ? '(無品名)' : h.title}
              {' · '}
              {/* 🔴🔴 **稅基標籤與數字在【同一個 <span> 裡】—— 那是刻意的, 不是排版**:
                  員工的動作是【選取數字複製】, 而他選取時眼睛在數字上。
                  標籤若放到別行 / 別的灰字區, 他不會在複製的那一刻看到它。
                  🛑 **而這個標籤是【含稅保證】今天唯一的持有人** ——
                     `manual-order-catalog.ts` 的「只讀 price_general」那個副作用已經被拿掉了
                     ⇒ 沒有這三個字, 員工把未稅價貼進單價 ⇒ 那張單少收 5%, 而沒有東西會叫。
                  🔵 **兩邊都標** —— 只標一邊, 讀的人會以為另一邊「沒標所以沒問題」。 */}
              <span data-testid='catalog-hit-price-general'>售價 {money(h.unitPrice)}(含稅)</span>
              {' / '}
              <span data-testid='catalog-hit-price-store'>
                經銷 {money(h.dealerPriceUntaxed)}(未稅)
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
