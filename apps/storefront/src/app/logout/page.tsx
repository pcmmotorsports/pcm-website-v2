// app/logout/page.tsx — /logout 登出確認頁(全站重設計 第2批;2026-08-06)
//
// 真權威 = OD `logout-page.html`。Sean 2026-08-05 指出「登出頁面也沒有做」。
//
// ✅ **這一頁已經接上了(2026-08-18 G3)。** 登出之後客人會落在這裡,不是登入表單。
//    `app/account/actions.ts` 的 `logoutAction` 已 `redirect('/logout')`;守門在
//    `styles/coming-soon.test.ts`(那一格【翻過面】了:原本釘「不准沒過審查就接線」,
//    現在釘「目的地必須是 /logout」)。plan:`docs/specs/2026-08-18-g3-logout-wiring-plan.md`。
//
//    🔴 **接線的身分要分開講,不要合併:**
//      · **「要接線」= Sean 本人拍的**(2026-08-06 `Q2=A`,逐字見下)
//      · **「現在做」= 主視窗【代裁】** —— 原拍板附帶「排白天、夜間不動」,
//        代裁的理由是**那個條件的目的是「有人看著」,而 Sean 今晚在線上**
//        ⇒ 條件的【目的】滿足了,**不是條件被廢掉**。射程只到他在線上為止。
//      · Sean 原拍板明寫的 **鐵則 12② 對抗審查不降級** —— 代裁沒動它,已照跑。
//    ```
//    memory project_site-redesign-content-pages-decisions.md:17 逐字:
//      「Q2=A:/logout 道別頁要接線 —— 登出 redirect 由 /login 改 /logout；
//        動 logoutAction（auth server action）= 鐵則 12② 高風險片，
//        排白天 + codex 對抗審查不降級，夜間不動」
//    ```
//    ⚠️ 設計端檔頭寫的是「redirect 目的地由 `'/'` 改成 `'/logout'`」,而**真站當時是 `'/login'`**
//       (不是 `'/'`)⇒ 實際換掉的落點是**登入表單**,不是首頁。照抄設計稿那行會描述錯現況。
//
//    📎 這一筆本身是個教訓:**拍板落了 memory,而【那個決定指著的這支檔】曾經不知道自己被拍過。**
//       (同族 memory:`feedback_a-ruling-must-update-the-files-it-points-at`)
//
// 🔴 **字面全部是設計稿新寫的,沒有真站來源可對照**(`SITE-MAP.md` 2026-08-05 追加那節逐字)。
//    所以這裡一個字都沒有自己發明,全部逐字照搬 `logout-page.html:88-99`。
//
// 樣式:零新增元件級 CSS,`.lo-*` 那組已進 `styles/auth.css` 檔尾(設計端「沿用 pcm-auth.css」)。
// 內容分級 L1。

// ── 🔴 `#883`(2026-08-23):這一頁曾經【斷言一個它自己沒有造成的狀態】────────────
// 病徵(真瀏覽器實測):直接輸入 `http://…/logout` ⇒ 畫面印「您已登出」,
//   而 `sb-…-auth-token` cookie **還在**,再開 `/account` **正常渲染會員頁** ⇒ 人根本沒登出。
// 🔴 **它不是壞掉的登出** —— 真正的登出在 `account/actions.ts` 的 `logoutAction`
//   (清完 cookie 才 `redirect('/logout')`),而這頁的工作**就是**說再見,設計上不該清任何東西。
//   ⇒ 缺陷是:**一張任何人都能單獨拿到的收據**。走那條路的時候,那句話是假的。
//   ⇒ 而我(cf)第一輪測登出時就是走那條路 ⇒ 當時記成「登出不清購物車」——
//     **一個假的畫面,讓一個真的測試得出一個錯的結論。**
//
// 修法為什麼不是「那頁自己也登出一次」:
//   · 那會把 GET 頁面變成副作用端點,而 Next `<Link>` 預設 prefetch
//     ⇒ 站內任何指向 `/logout` 的連結都可能**誤把人登出**,而**誤登出不會有人來告訴我們**。
//   · 而且它會推翻 Sean `Q2=A` 拍的形狀(道別頁,不是登出端點)。
// ⇒ 採用的是:**不動登出行為,只讓每一句話都綁在一個它自己讀到的值上**。
//
// 🔴 三態(與 `contexts/CartContext.tsx` 的 `serverOwnerId` 同一個形狀,同一晚同一個坑):
//   `signedOut`  確定沒有 session ⇒ 「您已登出」        ← 唯一為真的世界,也是每次真實登出走的路
//   `signedIn`   確定還登著       ⇒ 「您目前仍在登入中」+ 一顆**真的**登出按鈕
//   `unknown`    **讀不到**       ⇒ 兩句都不說,中性文字 + 同一顆按鈕
//   ⚠️ **「我沒辦法判斷」不可以被講成「他登出了」** —— 那正是這一條缺陷的本體,
//     修的時候用同一個錯誤形狀去修,只是把它搬到另一行。
import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { Header } from '@/components/Header';
import { HomeFooter } from '@/components/HomeFooter';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { logoutAction } from '@/app/account/actions';

export const metadata: Metadata = {
  // 🔴🔴 **codex R1 must-fix(2026-08-23):~~`'已登出 — …'`~~ 是一句【固定的】斷言。**
  //   我把三態做在 `<h1>` 與內文上,而**頁籤標題沒跟著** ⇒ 狀態不明或還登著的時候,
  //   瀏覽器頁籤照樣寫「已登出」⇒ **假訊息沒有消失, 只是搬到頁籤上。**
  //   ⇒ 改成**中性的頁名**:它描述「這是哪一頁」,不宣稱「你現在是什麼狀態」。
  // 🔴 為什麼不用 `generateMetadata()` 去讀同一份狀態:那會**再打一次 `getUser()`**,
  //   而兩發之間可以不一致 ⇒ **頁籤與內文互相矛盾**,那比中性標題更糟。
  //   ⇒ 一句話:**讀不到就不要說;而讀得到也不必在兩個地方各說一次。**
  title: '登出 — PCM重機零件販售',
  // 登出確認頁沒有可索引的內容,而且被搜尋引擎收錄只會讓人從搜尋結果直接掉進來。
  robots: { index: false, follow: true },
};

/**
 * 這台瀏覽器現在到底登著沒有 —— **三態,不是兩態**。
 *
 * 🔴 `unknown` 不是「沒登入」:讀不到就是讀不到,而把它講成「他登出了」正是 `#883` 本身。
 * 用 `getUser()` 不用 `getSession()`:對齊 `app/checkout/page.tsx:49`(向 auth server 驗 JWT)。
 * 判「確定沒有」的依據 = **auth cookie 在不在**,而 cookie 名字**從 client 用的同一個 env 推**
 * (規則在 `@supabase/supabase-js@2.105.3/dist/index.cjs:369`)—— 不用 regex 猜,
 * 因為猜錯的時候它會**恆不命中** ⇒ 每次「驗不出來」都變成「確定沒人」⇒ 又印一次假話。
 */
async function readSignedInState(): Promise<'signedIn' | 'signedOut' | 'unknown'> {
  const cookieStore = await cookies();
  let base: string | null = null;
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (url) base = `sb-${new URL(url).hostname.split('.')[0]}-auth-token`;
  } catch {
    // URL 壞掉 ⇒ 推不出名字 ⇒ 下面當「不知道」,不當「沒登入」。
  }
  const hasAuthCookie: boolean | null =
    base === null
      ? null
      : cookieStore.getAll().some((c) => c.name === base || c.name.startsWith(`${base}.`));
  try {
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase.auth.getUser();
    if (data?.user) return 'signedIn';
    // `!== false` = 有 cookie **或** 不知道有沒有 ⇒ 都不敢說他登出了。
    if (error && hasAuthCookie !== false) return 'unknown';
    return 'signedOut';
  } catch {
    return hasAuthCookie === false ? 'signedOut' : 'unknown';
  }
}

export default async function LogoutPage() {
  const state = await readSignedInState();
  return (
    <div className="ap-page" data-screen-label="Logout">
      <Header currentPage="logout" />
      <main className="auth-main">
        <div className="auth-card lo-card">
          <div className="lo-icon" aria-hidden="true">
            <svg
              width="26"
              height="26"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <path d="m16 17 5-5-5-5" />
              <path d="M21 12H9" />
            </svg>
          </div>
          {/* 🔴 每一句話都綁在 `state` 上。`signedOut` 那一支【逐字沿用設計稿】,一個字沒動 ——
              它是今天每一次真實登出都會走的路,誤改它的代價最大。 */}
          {state === 'signedOut' ? (
            <>
              <div className="ap-mono">N°ACCOUNT · SIGNED OUT</div>
              <h1>您已登出</h1>
              <p className="lo-note">
                感謝使用 PCM MOTOR PARTS,
                <br />
                期待再次為您服務。
              </p>
              <div className="lo-actions">
                <Link className="auth-submit" href="/login">
                  重新登入
                </Link>
                <Link className="lo-secondary" href="/products">
                  繼續逛商品
                </Link>
                <Link className="lo-secondary" href="/">
                  回首頁
                </Link>
              </div>
            </>
          ) : (
            <>
              {/* ⚠️ 以下文案是**新寫的**(設計稿沒有這兩個狀態)⇒ **尚未經 Sean 定字**。
                  🔴 ~~「已列進待定清單」~~ —— **那句話 2026-08-23 寫下來的時候是假的**(R1 must-fix):
                  `grep -rl '尚未確認您的登入狀態' docs STATUS.md` ⇒ **0**
                  (對照組 `grep -rl '您已登出' docs` ⇒ `docs/phase-1-backlog.md` 命中 ⇒ 尺是活的)。
                  📌 **我寫「已列進」的那一刻,並沒有去列** —— 而那句話讀起來像一件已經發生的事。
                  ⇒ 現況:**沒有列進任何清單**;由主視窗在 `#883` backlog 條目補記(那支檔當時 dirty)。 */}
              {/* 🔴🔴 **codex R1 must-fix(2026-08-23):~~固定 `STILL SIGNED IN`~~ 把「不知道」說成「仍登入」。**
                  這一格是本片最該記的一件:**我把三態實作在【我當時正在想的那個元素】上**
                  (`<h1>` 與內文),而這個標籤**看起來不像在陳述狀態** ⇒ 它沒有跟著改。
                  ⇒ 它跟 `metadata.title` 一樣,是**同一件事在畫面上的另一個出口**。 */}
              <div className="ap-mono">
                {state === 'signedIn' ? 'N°ACCOUNT · STILL SIGNED IN' : 'N°ACCOUNT · STATUS UNKNOWN'}
              </div>
              <h1>{state === 'signedIn' ? '您目前仍在登入中' : '尚未確認您的登入狀態'}</h1>
              <p className="lo-note">
                {state === 'signedIn'
                  ? '這一頁只是道別頁,它不會替您登出。要真的登出,請按下面那顆按鈕。'
                  : '我們這次沒有讀到您的登入狀態,所以不敢說您已經登出了。要確保登出,請按下面那顆按鈕。'}
              </p>
              <div className="lo-actions">
                {/* 🔴 登出仍然只由這一顆 POST 觸發,走的是與會員中心【同一支】`logoutAction` ——
                    沒有複製第二份登出邏輯,也沒有把這個 GET 頁面變成副作用端點。 */}
                <form action={logoutAction}>
                  <button className="auth-submit" type="submit">
                    登出
                  </button>
                </form>
                <Link className="lo-secondary" href="/products">
                  繼續逛商品
                </Link>
                <Link className="lo-secondary" href="/">
                  回首頁
                </Link>
              </div>
            </>
          )}
        </div>
      </main>
      <HomeFooter />
    </div>
  );
}
