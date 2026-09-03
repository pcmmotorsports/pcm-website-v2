'use client';

import { useEffect } from 'react';

// manual-order-leave-guard.tsx — 手動建單「離開前提醒」(Q32 甲;Sean 2026-09-03 拍)。
//
// 🔴🔴 **本檔存在的理由是【它不存任何值】** —— 那不是省事,是唯一走得通的形狀:
//    `manual-order-lines.tsx:17-20` 有一道不變式逐字
//      「送出值一律**不由 client state 產生或回寫;原生控制項才是送出來源**」
//    而它有三格測試在守。來源是 `E-011-STOP` **四輪修不穩 + 一次【誤送整單取消】**,**不是風格**。
//    ⇒ 🛑 「把填的東西存起來、重整後填回去」= 回寫 ⇒ **直接撞那道牆**。
//    ⇒ ✅ Sean 2026-09-03 看過三個選項與代價之後**選了不拆**
//       (`~/pcm-mailbox/等Sean拍的題-20260903.md:1841`,逐字「甲 離開前跳『你有未儲存的內容』」)。
//
// 🔵 **所以本檔零 state、零儲存、零外送** —— 它連「他填了什麼」都不知道,
//    只當場問 DOM「這張表單有沒有被動過」,而那個答案是一個布林,不留副本。
//
// ⚠️ **它擋不住什麼(先講,因為那決定 Sean 拿到的東西有多大)**:
//    · 🔴🔴 **面板內導航完全不觸發** —— 手動建單也長在 `/orders?panel=new`(平行路由槽)。
//      關面板 / 點側欄 / 點列表另一張單 = `next/link` 軟導航 ⇒ **`beforeunload` 根本不會跑**。
//      ⇒ 只有【重整 · 關分頁 · 關瀏覽器 · 打別的網址】會觸發。(R1 finding 8)
//    · 🔴 **分頁當掉 / 瀏覽器被砍** ⇒ 同樣不會跑。
//    · 🔴 而「重整之後【客人選取】也不見了」那半 **甲乙丙三案都沒碰**。
//    · 🔴 **收件資料那顆「同上」按下去之後,那兩格【結構上永遠不會被判髒】**(R2 抓到)——
//      `manual-order-ship-to.tsx:164-183` 是**換 key 重新掛載 + 新的 `defaultValue`**
//      ⇒ 被帶進去的值 `value === defaultValue`。今天被別的欄位遮住(他必先選客人),
//      ⇒ 但「按了同上就走人」這條路的訊號**不是來自那兩格自己**。
//    ⇒ 這四格是**已知而未做**,不是漏。
export const MANUAL_ORDER_FORM_ID = 'manual-order-form';

export function ManualOrderLeaveGuard({ formId }: { formId: string }) {
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      const form = document.getElementById(formId);
      if (!(form instanceof HTMLFormElement)) return;
      if (!isDirty(form)) return;
      // 🔵 現代瀏覽器吃的是 preventDefault();而 `returnValue` 那條路的 spec 條件是
      //    「**非空字串** 或事件被 cancel」⇒ 舊版 Chrome/Edge 與舊 Safari 靠它,而空字串什麼都不做。
      //    (R1 finding 7:我原本寫 `''` 並在註解說它「為了舊瀏覽器」—— 那句是假的。)
      e.preventDefault();
      e.returnValue = true;
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [formId]);
  return null;
}

/**
 * 這張表單有沒有被【動過】。
 *
 * 🔴 **判準是原生的「髒」:現在的值 vs 它出生時的值** —— 不是「有沒有東西」。
 *    ⚠️ **而那個差別不是風格, 是 R1 抓到的兩個真缺陷**:
 *    · 誤報:運費欄 `defaultValue='0'`(`manual-order-form-body.tsx:181`)⇒ 用「非空」判
 *      ⇒ **每一張沒填任何東西的表單都會被攔** —— 誤報率 100%。
 *    · 漏報:訂單來源 / 付款方式 / 取貨方式 / 發票類型**四格都是 `<select>`** ⇒ 我原本整族跳過
 *      ⇒ 員工把「匯款」改成「現金」再離開 ⇒ **零提醒**。
 *
 * 🔵 **只回布林,不回內容** —— 呼叫端拿不到值,所以它不可能變成草稿。
 * 🛑 **忽略 hidden 與無 name 的控制項**:前者是頁面自己塞的(冪等鍵 / in-panel 旗標),
 *    後者是查商品那個關鍵字框(`manual-order-catalog-lookup.tsx`,它的值不送出、
 *    而 Sean 拍丙明文不回寫)⇒ 兩者都不是「員工會丟掉的東西」。
 */
function isDirty(form: HTMLFormElement): boolean {
  for (const el of Array.from(form.elements)) {
    if (el instanceof HTMLInputElement) {
      if (el.type === 'hidden' || !el.name) continue;
      if (el.type === 'checkbox' || el.type === 'radio') {
        if (el.checked !== el.defaultChecked) return true;
        continue;
      }
      if (el.value !== el.defaultValue) return true;
    } else if (el instanceof HTMLTextAreaElement) {
      if (!el.name) continue;
      if (el.value !== el.defaultValue) return true;
    } else if (el instanceof HTMLSelectElement) {
      if (!el.name) continue;
      // 🔴🔴 **不可以用 `opt.selected !== opt.defaultSelected`** —— 實測(2026-09-03 探針):
      //    這張表單的四個下拉**都沒有寫 `defaultValue`** ⇒ 瀏覽器自動選第一項,
      //    而 `defaultSelected` 仍是 `false` ⇒ **一出生就四格全髒** ⇒ 空表單恆被攔。
      //    ⇒ 🎯 那是我上一版誤報(運費 `'0'`)的**同一個病換一個受詞**:
      //       「它現在的樣子」被拿來當「它出生時的樣子」。
      // ✅ 正解:先找出**它出生時會被選中的那一格**(有 `defaultSelected` 就是它,
      //    都沒有就是第一格 —— 那正是瀏覽器的規則),再比現在選的是不是同一格。
      if (el.selectedIndex !== bornIndex(el)) return true;
    }
  }
  return false;
}

/**
 * 這個下拉【出生時】會被選中的那一格是哪一格。
 *
 * 🔴 **三種會「出生即髒」的情況, R2 用 jsdom 實測抓到(今天表單裡沒有 ⇒ 是潛伏不是現行 bug)**:
 *    · `multiple` 或 `size > 1` ⇒ 瀏覽器**不自動選** ⇒ `selectedIndex` 是 `-1` 而我回 0
 *    · 第一個 `<option disabled>請選擇` ⇒ 瀏覽器跳過它選第 2 個 ⇒ `selectedIndex=1` 而我回 0
 * 🛑 **而「加一個【請選擇】的 placeholder」正是這種表單最常見的下一步** ⇒ 現在就擋掉。
 */
function bornIndex(el: HTMLSelectElement): number {
  const explicit = Array.from(el.options).findIndex((o) => o.defaultSelected);
  if (explicit !== -1) return explicit;
  // 多選 / 展開式:瀏覽器不自動選任何一項。
  if (el.multiple || el.size > 1) return -1;
  // 單選:瀏覽器選【第一個不是 disabled 的】,不是第 0 個。
  const first = Array.from(el.options).findIndex((o) => !o.disabled);
  return first;
}
