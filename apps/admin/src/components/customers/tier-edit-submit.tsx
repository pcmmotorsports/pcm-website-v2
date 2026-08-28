'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import type { MemberTier } from '@pcm/domain';
import { TIER_VALUE_FIELD } from '../../lib/customers/tier-form';
import { TIER_LABEL, TIER_VALUES } from '../../lib/customers/customer-list-view';

// tier 變更 submit 鈕(client island)。
//
// 🔴 **為什麼多一次確認** —— Sean 2026-08-28 傍晚題「**換等級護欄現在做?**」答**甲**
//   (逐字 `ｑ３：甲`;落點 memory `project_0828-evening-three-rulings.md`。
//    🔴 **這裡刻意抄題目文字、不抄題號** —— 同一天艦隊有多個 `Q3=甲`,抄題號 grep 得到三個不同的)。
//   今天改 tier = 改標籤;**經銷價上線那天,同一顆鈕就變成改價。**
//   而擋著經銷價的三層住在**三個 repo 的三次改動**裡
//   (報價單 view 物理無 `price_store` / `rpm-transform.ts:378`,`:419` 寫死 null /
//    我方 public view 排除 + `mappers/product.ts:220` 硬寫 0)
//   ⇒ **沒有任何一層會在鬆掉的那天通知這顆鈕。**
//   📌 為什麼不等那天再加:**【接通了】會自己冒出來(畫面看得到價),【沒護欄】不會**
//      —— 它安靜、沒畫面、沒紅燈 ⇒ 那天的清單上漏掉的一定是護欄那件。
//      而今天按錯的代價只是一個標籤 ⇒ **在代價最低的那一天把習慣建立起來。**
//
// 🔴🔴 **閘裝在【表單的 submit 事件】上,不是裝在那顆鈕上** —— 這是 R5 code-reviewer
//   MF1 換來的:第一版把鈕改成 `type='button'` ⇒ 表單**沒有 submit 鈕、只剩一個會擋隱式提交的欄位**
//   ⇒ **員工在「變更原因」打完字按 Enter,直接送出、確認段從未出現**(reviewer 真 Chromium 實測:
//   改動前 1 / 改動後 **1** / 負對照〔兩個必填文字欄〕0 ⇒ 那把尺兩個世界印不同的值)。
//   📌 **入口不只一個** —— 裝在鈕上 = 把護欄裝在其中一個入口上;
//      裝在 submit 事件上 ⇒ **按鈕 / Enter / `requestSubmit()` 走同一道閘**。
//   ⚠️ **而「所有送出路徑」是講得太滿的**(codex 2026-08-28 nit):程式直接呼叫 `form.submit()`
//      **不會觸發 submit 事件** ⇒ 這道閘看不到它。而那條路上 React 19 會自己擋
//      (它把 `action` 屬性設成 `javascript:throw new Error('A React form was unexpectedly submitted…')`)
//      ⇒ **tier 不會被改,但擋它的不是我們** ⇒ 射程照實寫,不寫「所有」。
//   ⚠️ 而 repo 早就有這條知識(`wallet-adjust-submit.tsx:11-22`、`#296`、Sean 2026-07-26 拍 A;
//      `admin-form-consumers.test.tsx:64-80` 的 `firstSubmitterOf` docstring)—— **第一版沒有回去對那一格。**
//
// 🔴 **為什麼確認框要印【從 X 變成 Y】,而不是只印 Y** —— 這一格是需求、不是視覺:
//   `<select>` 的 `defaultValue` 就是**現值** ⇒ **選錯的人看不到自己改了什麼**,
//   他看到的是一個「看起來對」的下拉選單。
//   📌 **一個只顯示結果的確認框,與一個沒有確認框的表單,擋掉的是同一群人(本來就沒看的那群)。**
//
// 🔴 **確認之後那個下拉【還是可以改】**(它住在 `AdminForm` 的 children,本島住在 `actions` 槽,
//   不同子樹)⇒ 所以送出那一刻**要重讀一次並比對**:不同就不送、換成新的 X→Y 要他再確認。
//   ⚠️ **不能改用 `disabled` 凍住它** —— disabled 的欄位**不會被送出**;
//      也不能補一個同名 hidden —— `tier-form.ts` 的 `anyMalformed` 會**拒收重複的 `tier` 欄**。
//   ⚠️ 副作用**刻意**:改了下拉之後要再確認一次。那不是 bug。
//
// 🔴🔴 **天花板 —— 而它的形狀是【一次沒有人知道的降級】,不只是「顯示可能不精確」**
//   (codex 2026-08-28 判 must-fix;**主視窗 2026-08-28 裁為本片的 ceiling、另開 `#954`**)。
//   `currentTier` 由 server render 帶下來(`customer-detail.tsx:197` 的 `customer.tier`)
//   ⇒ 那個【X】的新鮮度 = **這一頁上次 render 的時刻**,而那可能是幾分鐘前。
//   **具體後果(要寫出來,不然下一個人會覺得那只是不精確)**:
//   ```
//   甲開著頁面（畫面：一般會員）→ 乙在另一台把他改成【高級店家】
//   甲按下去，確認句寫「一般會員 → 店家會員」，他按了確認
//   ⇒ 實際發生的是【高級店家 → 店家會員】＝ 一次降級
//   ⇒ 而甲【從頭到尾沒有看到 premiumStore 這四個字】
//   ```
//   ✅ **稽核紀錄是對的**(RPC `FOR UPDATE` 鎖列後**現讀** `v_before`、同交易寫 `admin_audit_log`)
//   ⇒ **事後查得出來,而當下沒有人會知道。**
//   📌 **一個顯示用的舊值,與一個當下的真值,在那句話裡長得一模一樣。**
//   🔴 **真正的修法在 `docs/phase-1-backlog.md` `#954`**:送出時把這個 `from` 一起送給 RPC,
//      由 RPC 在 `FOR UPDATE` 之後比對(材料本來就在手上)、不同就拒絕。
//      ⚠️ 那**動 RPC ⇒ 命中鐵則 12②** ⇒ 是另一片,不能夾在這個前端片裡順手做。
//   ⚠️ **而「按確認時回查一次 DB」那條路被明文否決**:它只把窗口從「開頁→按確認」縮到
//      「按確認→送出」—— **縮小那個競賽,沒有關掉它**,而**一個把窗口縮小的修法,
//      會讓下一個人以為那個窗口沒有了**。
//
// ⚠️ **這道護欄擋得住【按錯】,擋不住【否認】** —— 稽核表上的 `actor` 是不是真名,
//   Sean 2026-08-28 回報 Vercel 把那個環境變數的值遮起來(逐字 `Q2 密碼看不到`,
//   落點 memory `project_0828-evening-three-rulings.md`)⇒ **本窗未讀到該值**。
//   ⚠️ 而反向證據也要帶著,不要只寫後半:memory `project_0825-real-identity-gate-is-live.md:10`
//   有 Sean 逐字「我剛剛加上去了 並且重新部署了」⇒ **08-25 設過、08-28 讀不回,兩者可並存**。
//   **兩件事不要混:護欄管的是「按錯」,那一格管的是「誰按的」。**
//
// 既有行為零改動:pending disable 防雙擊照舊;同值重送仍由 RPC `NO_CHANGE` 冪等吸收;
// back-resubmit 仍由 PRG redirect 吸收;`reportValidity()` 保住「變更原因必填」在原本那一步就擋。
// 🔴 本檔零資料存取:只碰 `useFormStatus` + DOM,無任何 service key/價格面。

/**
 * 🔴 **佔位文案,尚未拍板** —— Sean 只答了「護欄現在做」,**那句話實際長什麼樣他還沒給**。
 * TODO(`docs/phase-1-backlog.md` 的 `### #297.`「破壞性金錢動作缺二次確認」;
 * 它底下那一節的標題逐字是 `### ②-b`,**不帶 `§`** —— 用 `§②-b` grep 會查無,那是引用者的寫法):
 * 換成 Sean / OD 給的正式文案。
 * 🔴🔴 **在那之前,這一串會出現在【正式後台的畫面上】** —— `dev` 是 pcm-admin 的 production,
 * 而後台今天有人在用。前綴刻意寫成一眼看得出是暫定的,免得下一個人以為它拍過板了。
 */
const PLACEHOLDER_PREFIX = '【暫定文案・未拍板 #297】';

/** 確認那一刻要看到的那句話。**印【從 X 變成 Y】,不是只印 Y。** */
export function confirmSentence(from: MemberTier, to: MemberTier): string {
  return `${PLACEHOLDER_PREFIX}會員等級:${TIER_LABEL[from]} → ${TIER_LABEL[to]}`;
}

/**
 * 從表單讀 tier。**認不得就回 `null`,不退回現值** ——
 * 🔴 退回現值會讓畫面印「A → A(等於沒變)」而表單**照樣送出那個壞值**(R5 nit N4)。
 * 回 `null` ⇒ 呼叫端 fail-closed:不送出、退回第一段要他重選。
 */
function readTier(form: HTMLFormElement): MemberTier | null {
  const raw = (form.elements.namedItem(TIER_VALUE_FIELD) as HTMLSelectElement | null)?.value;
  return TIER_VALUES.includes(raw as MemberTier) ? (raw as MemberTier) : null;
}

export function TierEditSubmitButton({ currentTier }: { currentTier: MemberTier }) {
  const { pending } = useFormStatus();
  const [target, setTarget] = useState<MemberTier | null>(null);
  const [form, setForm] = useState<HTMLFormElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  // 兩段各有一顆鈕,而它們是不同的 DOM 節點 ⇒ 用 callback ref 抓「當下掛著的那顆」的 form。
  const anchor = useCallback((el: HTMLButtonElement | null) => {
    if (el?.form) setForm(el.form);
  }, []);

  // 🔴🔴 **唯一那道閘**:掛在表單的 submit 事件上 ⇒ 按鈕 / Enter / requestSubmit 走同一條路。
  useEffect(() => {
    if (!form) return;
    const onSubmit = (e: Event) => {
      const now = readTier(form);
      if (target === null) {
        // 第一段:任何送出都不放行,改成打開確認段。
        e.preventDefault();
        e.stopPropagation();
        if (!form.reportValidity()) return; // 保住「變更原因必填」擋在原本那一步
        if (now !== null) setTarget(now);
        return;
      }
      // 第二段:值變了(或變成認不得的)就不送,換成新的 X→Y 再確認一次。
      if (now === null || now !== target) {
        e.preventDefault();
        e.stopPropagation();
        setTarget(now);
      }
      // 相同 ⇒ **什麼都不做**,讓 React 的 action 照原路走(不 requestSubmit、不繞路)。
    };
    form.addEventListener('submit', onSubmit);
    return () => form.removeEventListener('submit', onSubmit);
  }, [form, target]);

  // 🔴 焦點:第一顆鈕被換掉之後,鍵盤使用者的焦點會掉到 body(reviewer 實測)⇒ 主動接住它。
  useEffect(() => {
    if (target !== null) confirmRef.current?.focus();
  }, [target]);

  if (target === null) {
    return (
      <button
        ref={anchor}
        type='submit'
        disabled={pending}
        className='bg-primary text-primary-foreground h-9 rounded-md px-4 text-sm font-medium disabled:opacity-50'
      >
        變更等級
      </button>
    );
  }

  return (
    <>
      {/* 🔴 `role='status'`:確認句出現的當下要被念出來(對齊 `settings-result-banner.tsx:42`、
          `supplier-label-input.tsx:72`;`admin-form.tsx:47` 逐字把 aria 定為「無障礙的地板」)。 */}
      <span className='mr-auto text-xs' role='status' data-testid='tier-confirm-sentence'>
        {confirmSentence(currentTier, target)}
      </span>
      <button
        type='button'
        disabled={pending}
        onClick={() => setTarget(null)}
        className='h-9 rounded-md px-4 text-sm font-medium underline disabled:opacity-50'
      >
        取消
      </button>
      <button
        ref={(el) => {
          confirmRef.current = el;
          anchor(el);
        }}
        type='submit'
        disabled={pending}
        className='bg-primary text-primary-foreground h-9 rounded-md px-4 text-sm font-medium disabled:opacity-50'
      >
        {pending ? '處理中…' : '確認變更'}
      </button>
    </>
  );
}
