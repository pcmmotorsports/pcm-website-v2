// 🔴🔴 這是【探針】,不是功能。M-4b E8-B「票綁環境」片 0。
//
// ★退場條件(寫在這裡,而【真正的機制在別處】)★
//   片 1(丁:getKey() 金鑰材料加 env)的【同一顆 commit】必須刪掉本檔與 page.test.tsx。
//   🔴 而註解攔不住任何人 ⇒ 機制 = `docs/specs/2026-08-19-admin-session-env-binding-plan.md`
//      §6 驗收表那一格:片 1 收工前跑 `test -e apps/admin/src/app/diag/env/page.tsx` **必須為假**。
//   ⚠️ 誠實界線:那一格要有人去跑。它比註解硬,而它不是編譯器等級的保證。
//
// ★為什麼存在★
//   丁把「這是哪個環境」摻進 HMAC 金鑰材料。若 production 的 runtime 讀不到 VERCEL_ENV,
//   兩個環境會推導出同一把金鑰 ⇒ 那道閘【等於沒裝,而且不會有任何東西紅】。
//   ⇒ 本頁只回答一件事:**這台正在跑的機器,讀到的環境值是什麼。**
//
// ★這一頁【不做】什麼(片 0 的零風險界線)★
//   · 不碰 session / payload / validator / getKey():不簽、不驗、不讀 cookie、不設 cookie
//   · 不寫 log、不寫 DB、不呼叫外部服務
//   · 🔴 **對 `lib/session/*` 零 import**(W6 審查後拿掉)——
//     原本印「它會簽的 v」那一欄需要 import `session.ts`,而**丁根本不動 `v`**
//     (§3-丁.1 逐字「payload 不動、`isPayload()` 不動、`buildAdminSession()` 不動、v 不升」)
//     ⇒ 那一欄對「VERCEL_ENV 讀不讀得到」**零貢獻**,卻讓「零風險」變成一件要論證的事。
//     📌 **拿掉之後,「不碰 session」不再需要論證 —— 它是結構上顯然的。**。
//
// ★閘★ 本頁走 proxy 的登入閘(`proxy.ts:39`)⇒ 要 admin session 才看得到。
//   🔴 因此它【只答得出 production】。preview 上沒有 admin session,而報價單 authorize
//      寫死回導 production(`authorize/route.ts:10-11`)⇒ 在 preview 走不完 SSO。
//      preview 那半改用【零部署】的方式量掉了(部署 sha + 釘 sha 讀原始碼),見上述 plan §0.1。

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** 讀不到時的顯式哨兵 —— 🔴 不用空字串:空字串與「讀到了但是空的」在畫面上長一樣。 */
const ABSENT = '__讀不到__';

export default function DiagEnvPage() {
  const vercelEnv = process.env.VERCEL_ENV ?? ABSENT;
  const nodeEnv = process.env.NODE_ENV ?? ABSENT;
  // 🔴 正向對照:NODE_ENV 幾乎一定讀得到。若【兩個都是 __讀不到__】,那代表
  //    「這段程式沒跑到」或「env 整個沒進來」,而不是「VERCEL_ENV 這一個沒有」。
  //    ⇒ 沒有這一欄,「讀不到」與「沒跑到」印出同一個畫面。
  return (
    <main style={{ padding: '48px 32px', fontFamily: 'system-ui, sans-serif', lineHeight: 1.6 }}>
      <p style={{ fontSize: 18, color: '#555', margin: 0 }}>這台機器認為自己是</p>
      {/* 🔴 data-testid 是給測試釘【這一格】用的 —— 不是裝飾。
          理由(實際踩到,不是預想):本頁下方的說明文字裡含有哨兵字面,
          全文掃描會永遠命中它 ⇒ 「有值」與「沒值」在那把尺下長一樣。
          ⇒ 尺要釘在【值】上,不是釘在整頁的文字上。 */}
      <p data-testid="vercel-env" style={{ fontSize: 72, fontWeight: 700, margin: '8px 0 32px' }}>{vercelEnv}</p>

      <p style={{ fontSize: 18, color: '#555', margin: 0 }}>對照用（這一欄幾乎一定讀得到）</p>
      <p data-testid="node-env" style={{ fontSize: 32, fontWeight: 600, margin: '8px 0 40px' }}>{nodeEnv}</p>

      <hr style={{ margin: '32px 0', border: 0, borderTop: '1px solid #ddd' }} />
      <p style={{ fontSize: 16, color: '#666', maxWidth: 640 }}>
        這一頁是<strong>臨時的檢查頁</strong>，做完那項改動就會被刪掉。
        它<strong>不會</strong>改動任何東西，只是把這台機器讀到的值印出來。
      </p>
      <p style={{ fontSize: 16, color: '#666', maxWidth: 640 }}>
        第一行如果印的是 <code>{ABSENT}</code>，而第三行印得出東西
        —— 那就是我們要找的那個問題。
      </p>
    </main>
  );
}
