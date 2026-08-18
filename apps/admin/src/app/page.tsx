// 🔴 **相對路徑、不用 `@/`**:根 `vitest.config.ts:27-29` 的 `@` alias 指向 **storefront** 的 src,
//    admin 檔案用 `@/` 在 vitest 裡 resolve 不到 ⇒ 本頁就永遠測不到。
//    姊妹頁 `app/orders/page.tsx` 為了同一個理由做過同一件事(`orders/page.test.tsx:15-17` 有記)。
// ⚠️ #612 更新(2026-08-17):上述 alias 限制已由 #606 修除(vitest projects、admin 自帶 @ alias)⇒ 新 code 可用 @/;既有相對 import 保留、不回改。
import { selectActorAction } from '../lib/session/actor-actions';
import { ACTOR_ID_FIELD, getSessionActor } from '../lib/session/actor';
import { listActiveStaff } from '../lib/staff';
import { loadTodaySummary, type TodaySummary } from '../lib/dashboard/today-read';
import { TodaySummaryCards } from '../components/dashboard/today-summary';

// ~~M0-S1 骨架占位頁~~ + M0-S2 具名身分選人。
// 🔴 **`#16` 今日對帳(2026-08-14,Sean 拍「批」)**:骨架說明卡下架,換成對帳數字。
//    🪦 **原為四格;「今日退款」於 2026-08-15 拆掉 ⇒ 現為三格**(理由見 `lib/dashboard/today-view.ts` 墓碑段)。
//    判定與加總全在 `lib/dashboard/today-read.ts`,本頁只負責取資料 + 擺位置。
//    ⚠️ 具名身分那一區(M0-S2)**一字未動** —— 它是這頁原本唯一在用的功能。
//
// 🔴 **顯式 `force-dynamic`**:對帳數字**不得被快取**。本頁目前是動態渲染只因為 layout 讀了
//    `cookies()`(`app/layout.tsx:27-30`)—— 那是「現況剛好如此」,不是保證。
//    不顯式宣告,哪天 layout 改了就會有人看到昨天的數字、還以為是今天的。
//
// 🔴 **對帳讀取失敗只倒那一區、不倒整頁**(reviewer MF6):`today-read.ts` 那句「寧可炸也不要
//    顯示少算的數字」只證成**那幾格**該炸,**不證成把 `selectActorAction` 一起帶走** ——
//    具名身分是這頁原本唯一在用的功能,對帳掛掉不該讓員工連身分都切不了。
//    做法逐字抄同 repo 既有形狀:`app/settings/staff/page.tsx:24-31,47-53`(try/catch +
//    `console.error` + 失敗卡),不自創第二種寫法。
export const dynamic = 'force-dynamic';

export default async function AdminHomePage() {
  // 🔴 三支**併發**、不串行(R2 nit4):彼此無依賴,串著跑等於白等兩個 round-trip,
  //    而這是每次進站都跑的首頁。
  // 🔴 用 `allSettled` 不用 `all`:`all` 會讓對帳的失敗直接吃掉另外兩支的結果 —— 那正是 MF6 要擋的事。
  //    身分與員工名單失敗**仍照舊往上拋**(它們掛了這頁本來就沒東西可看,不該假裝正常)。
  const [actorSettled, staffSettled, todaySettled] = await Promise.allSettled([
    getSessionActor(),
    listActiveStaff(),
    loadTodaySummary(),
  ]);
  if (actorSettled.status === 'rejected') throw actorSettled.reason;
  if (staffSettled.status === 'rejected') throw staffSettled.reason;
  const actor = actorSettled.value;
  const staff = staffSettled.value;

  let today: TodaySummary | null = null;
  if (todaySettled.status === 'fulfilled') {
    today = todaySettled.value;
  } else {
    console.error('[admin/home] 今日對帳載入失敗', todaySettled.reason);
  }

  // 🔴 `max-w-4xl` **刻意留著,不是漏做**(`7f6d0ac1` 那次六支列表頁拿掉時逐支判過):
  //    本頁是**總覽**、沒有表格,拉滿寬只會讓幾張卡片攤在一片空白裡。
  //    規則:沒有表格 ⇒ 留 `max-w-`(長文字行過寬更難讀);有表格的列表頁一律吃滿寬
  //    (`#640` 守門在 `app/design-tokens.test.ts`)。
  return (
    <div className='mx-auto max-w-4xl space-y-4 py-10'>
      <h1 className='text-2xl font-semibold'>PCM 後台</h1>

      {today === null ? (
        <div className='border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-6 text-sm'>
          今日對帳載入失敗,這一區的數字暫時看不到。請稍後重新整理,或聯絡系統維護。
          <span className='block'>這頁其他功能不受影響。</span>
        </div>
      ) : (
        <TodaySummaryCards summary={today} />
      )}

      <div className='rounded-lg border bg-card p-6 text-card-foreground'>
        <p className='text-sm font-medium'>具名身分(M-4a M0-S2)</p>
        <p className='text-muted-foreground mt-2 text-sm leading-relaxed'>
          目前身分:
          <span className='text-foreground font-medium'>
            {actor ? actor.label : '尚未選擇'}
          </span>
          {
            '。稽核 log 會把這個身分記成操作者。🔴 這個身分是你自己選的、系統並未驗證 —— 目前登入只確認「有人通過認證」,不確認「是誰」。真實帳號驗證待報價單端建立個人帳號後接上。'
          }
        </p>
        <form action={selectActorAction} className='mt-4 flex items-center gap-2'>
          {/* #388:欄名走共用常數 —— 三處都吃同一顆(`htmlFor`/`id` 綁 a11y、`name` 是 wire 契約)。 */}
          <label htmlFor={ACTOR_ID_FIELD} className='sr-only'>
            選擇具名身分
          </label>
          <select
            id={ACTOR_ID_FIELD}
            name={ACTOR_ID_FIELD}
            defaultValue={actor?.id ?? ''}
            className='border-input bg-background h-9 rounded-md border px-3 text-sm'
          >
            <option value='' disabled>
              選擇身分…
            </option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <button
            type='submit'
            className='bg-primary text-primary-foreground h-9 rounded-md px-4 text-sm font-medium'
          >
            切換
          </button>
        </form>
      </div>
    </div>
  );
}
