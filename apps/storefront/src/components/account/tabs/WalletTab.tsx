// WalletTab.tsx — 會員中心「儲值金」分頁(#202 解凍第一片:只顯示餘額與明細)。
//
// 🔴 **`wal-tx-l` 這個 class 在 storefront 的 CSS 裡【沒有任何規則】, 而【沒有人看過它】。**
//    2026-08-30 線G 開真瀏覽器分了那 14 個「死 class」——14 個裡我實測 7 個(全是假警報),
//    而這一個【走不到】:`/account` 在 probe 上回 307（要先登入） ⇒ 標【未驗】。
//
// ⇒ **下一次有人為了任何理由走到這條動線時, 請順手看一眼它。**
//    🔴 「沒有規則」有四種解釋, 而只有第一種是問題:
//    ① 真的沒寫 CSS(可能真壞) ② 兄弟 class 撐著 ③ 完全沒有 CSS、靠父層版面
//    ④ 走 inline style ⇒ 它根本不需要 CSS 規則(而掃描器看不到 inline style)
//
// 🛑 **這句話刻意寫在這裡, 不是寫在一份清單裡** —— 一份「沒有人看過」的清單
//    若沒有人回頭讀它, 它會安靜地變成永久的。而你現在正在讀這支檔。
//    📎 兩份清單與判準見 `~/pcm-mailbox/線G-規格-死class守門兩份清單-20260830.md`。
//
// 🔴 **Sean 2026-08-26 拍板逐字**:「甲 只顯示餘額和明細」/「法規我確定了,解凍,但是之後再做,
//    現在先顯示就好」/「等網站上線後再補」。
//    ⚠️ **`#202` 的 hold 已解除,而【依據未載明】** —— 他沒說是怎麼確定的。
//    🔴 **本檔不得寫、也不得讓任何文案暗示「已合規」。**
//
// ── 這一片【刻意不做】什麼(逐條,而每一條都有拍板依據)──────────────────────
//
// ❌ **「立即儲值」鈕 + `DepositModal`**(design `WalletTab.jsx:54` 那顆鈕 / `:149` 起的 `DepositModal`)
//    ⇒ 那是 Sean 說的「之後再補」。`q5=乙`:那個位置**放一句灰字、不留白**。
//    🔴 灰字**不得承諾時程** —— 舊 stub 的註解逐字寫著「不寫『即將推出』(法規 hold、未承諾時程)」,
//       而**那條註解的理由已經不成立了**(法規那格他拍了解凍),**結論仍然成立**:
//       理由換成他自己說的「之後再補 / 等網站上線後再補」。
//
// ❌ **等級卡**(design `WalletTab.jsx` 的 `.wal-tier-card`)—— **Sean 2026-08-26 `Q2=乙`。**
//    🔴🔴 **這是【刻意偏離 design】,不是漏搬。對稿的人請讀這一段再判:**
//    design **兩個地方都畫了會員等級** —— `AccountPages.jsx:469-473`(總覽的 acc-stats)
//    與 `WalletTab.jsx` 的 `.wal-tier-card`。**而我們的總覽已經有了**
//    (`OverviewTab.tsx:87` 逐字 `<TierBadge tier={stats.tier} size="lg" />`,對齊 design `L469-496`)。
//    ⚠️ **`:79` 是 2026-08-26 審查訂正過的值,而 2026-08-27 重量它已經是一行註解** ——
//       真值 `:87`。📌 **同一個行號被訂正過一次,不表示它之後不會再漂。**
//    ⇒ 照鐵則 1「design 直接搬」本來指向**該搬**;Sean 拍板不搬。**兩個判斷都成立,他拍了。**
//    ⚠️ 上面那幾個 design 行號 **2026-08-26 對抗審查抓到我引錯、已逐一重量**
//       —— 而審查給的其中一個(Overview `:78`)**自己也差一行**,真值是 `:79`。
//       📌 **兩邊都要量。** 引用行號沒有型別在守,它只在有人回去開檔的時候才會被發現。
//
// ❌ **每一列右下角的「當時餘額」**(design `WalletTab.jsx:108` 的 `.wal-tx-bal`)—— **`Q3=乙`。**
//    🔴 而**那條禁令沒有跟著消失**(plan `§3-b`):**不得用前端累加算它。**
//    累加要從第一筆開始,而畫面上只有當頁那幾筆 ⇒ **第一頁碰巧會對、第二頁起全錯**,
//    而錯出來仍是格式正確、遞增合理的金額 ⇒ **沒有任何一格會紅。**
//    ⇒ 要做只有兩條路:後端給 running balance(SQL 視窗函式)、或不顯示。**他選了不顯示。**
//    ⚠️ **本禁令目前【沒有實例】** —— 而它**不是因為做對了才沒事,是因為沒做**。
//
// 🔴 **本檔零 client JS、零互動、零寫入。** 它只把 server 給的值排出來。

import type { WalletLedgerEntry } from '@pcm/domain';
import { PROFILE_UNREADABLE_NOTE } from '@/lib/account-profile-copy';

/**
 * 餘額數字底下那一行。**Sean 2026-08-26 `Q-錢包-3=乙`:只留「永久有效」。**
 *
 * 🔴🔴 **這是【刻意偏離 design】,不是漏搬**(與等級卡 `Q2=乙` 同形狀)。
 *    design `WalletTab.jsx:49` 逐字是「**可用於下單折抵 · 永久有效**」,
 *    而**前半現在是假的** —— 結帳的儲值金折抵沒有做,兩處自己寫著:
 *      `CheckoutStep2.tsx:35` 逐字「儲值金折抵(design N°05)+ 優惠券…**不做**」
 *      `CheckoutView.tsx:39`  逐字「優惠券 / 儲值金折抵**不做**」
 *    ⇒ 照搬 = **對客人印一句他到結帳頁會發現不成立的話。**
 *    ⇒ **對稿的人請讀到這裡再判** —— 當初查過,而且是有依據地拿掉的。
 *
 * 🔴 **而留下的那半,它的依據是【條件式】不是事實**:
 *    「永久有效」現在為真,**因為 `customer_wallet_ledger` 沒有到期欄位**
 *    (建表 `20260523034911_init_customers_and_subtables.sql:100-107` = **八行八欄,逐欄列全**:
 *     `id` / `customer_user_id` / `entry_date` / `entry_type` / `amount` / `note` /
 *     `related_order_id` / `created_at` —— **沒有任何一欄表示到期**)。
 *    ⚠️ **原本這裡只列了六欄而行號寫 `:100-107`** —— 少了 `id` 與 `customer_user_id`(2026-08-27 重量)。
 *       📌 **一份比行號範圍窄的清單,會讓「沒有任何一欄」這個全稱句在【沒被列出來的那兩欄】上失去依據。**
 *    ⚠️⚠️ **哪天有人給儲值金加了到期欄位,這句話就變成假的 —— 而【不會有任何東西紅】。**
 *    ⇒ **加那一欄的人:請一起改這個常數。** 這句話寫在這裡而不是只寫在 plan 裡,
 *      理由是**你會讀到這個檔,而你不會去讀那份 plan。**
 */
const BALANCE_META = '永久有效';

/**
 * 原「立即儲值」鈕那個位置的灰字。**`q5=乙`:不留白。**
 *
 * 🔴 **它是【一句】不是兩句** —— 儲值不開放與折抵不開放是同一件事的兩半,
 *    印兩句會讓客人讀到兩次「你不能」。
 * 🔴 **而它先說【現在能做什麼】** —— 客人到這頁是來看錢的。
 * ⚠️ **不得含任何時程字眼**(「即將」「近期」「很快」「月」…)——
 *    Sean 說的是「之後再補 / 等網站上線後再補」,**沒有人授權過任何時間點**。
 *    ⇒ 🔴 **這條約束有一道會紅的守門**:`WalletTab.test.tsx` 把那些字列成禁字掃這個常數。
 *      **順手加「即將」兩個字**就是一個沒有人授權過的承諾,而在守門裝上之前它不會紅。
 *
 * 依據:Sean `q5=乙`(灰字不留白)+ `Q-錢包-3=乙`(拿掉「可用於下單折抵」);
 * 措辭由線4 擬、主視窗 `-96` 2026-08-26 准並貼給 Sean 過目(他可否決)。
 */
const WALLET_UNAVAILABLE_NOTE = '目前可查看餘額與明細;儲值與折抵尚未開放';

export type WalletTabProps = {
  /** 餘額(元位整數;來源 `customers.wallet_balance`,DB trigger 同步)。 */
  balance: number;
  /** 明細,**已由 server 排好序**(新到舊)。空陣列 = 真的沒有交易。 */
  entries: readonly WalletLedgerEntry[];
  /**
   * 明細讀取失敗。
   * 🔴 **與 `entries: []` 是兩件事** —— 前者「我們不知道」、後者「他真的沒交易過」。
   *    合成一種顯示 ⇒ 讀取壞掉時畫面會說「尚無交易紀錄」,而那是**在對客人說謊**。
   */
  loadFailed?: boolean;
  /**
   * 這位客人的明細**總筆數**(不是這一頁的筆數)。`null` = 沒拿到。
   * 🔴 **沒有它,畫面上的「N 筆」會是【這一頁的筆數】假扮成【總筆數】**
   *    —— 第 21 筆起被截掉而畫面照樣說「20 ENTRIES」,而客人以為那就是他的全部交易。
   *    (對抗審查 must-fix,2026-08-26)
   */
  total?: number | null;
  /**
   * 🔴 **餘額【沒讀到】,與 `balance === 0` 是兩件事。**
   * customers 那一發失敗時餘額退化成 0,而明細那一發可能成功
   * ⇒ 「NT$ 0」配著一串真實交易 = **對客人顯示一個錯的金額**。
   */
  balanceFailed?: boolean;
};

export function WalletTab({
  balance,
  entries,
  loadFailed = false,
  total = null,
  balanceFailed = false,
}: WalletTabProps) {
  // 🔴 截斷了才說,沒截斷不多嘴 —— 而判準是【總筆數 > 顯示筆數】, 不是「剛好 20 筆」。
  //    用「= 20」判的話,一個剛好有 20 筆的客人會被告知「還有更多」而其實沒有。
  const truncated = total !== null && total > entries.length;
  return (
    <div className="acc-section wal-tab">
      <div className="acc-section-head">
        <h2>儲值金</h2>
      </div>

      {/* 餘額卡 — design WalletTab.jsx:40-61(`Balance card` 註解行 + `.wal-balance-card` 整塊;
          2026-08-27 當場重量:`.wal-balance-card` 開在 :41、對應收尾 `</div>` 在 :61,
          原寫的 :38-62 兩端各寬一行);右半的「立即儲值」鈕換成灰字(q5=乙) */}
      <div className="wal-balance-card">
        <div className="wal-balance-l">
          <div className="ap-mono">CURRENT BALANCE</div>
          {balanceFailed ? (
            /* 🔴 讀不到就說讀不到 —— **不得印 0**。印 0 = 告訴客人他沒有錢。 */
            <div className="wal-balance-amt">
              <span className="wal-balance-num">餘額讀不到</span>
            </div>
          ) : (
            <>
              <div className="wal-balance-amt">
                <span className="wal-balance-cur">NT$</span>
                <span className="wal-balance-num">{balance.toLocaleString()}</span>
              </div>
              <div className="wal-balance-meta">{BALANCE_META}</div>
            </>
          )}
        </div>
        <div className="wal-balance-r">
          {/* q5=乙:不留白。而**不承諾時程** —— 見檔頭。 */}
          {/* 🔴 **這一行是一次【拍板文案的條件性撤下】, 不是接線細節。**
              上面那句 `WALLET_UNAVAILABLE_NOTE` 的依據是 Sean `q5=乙` + `Q-錢包-3=乙`(見它旁邊的檔頭);
              而它說「**目前可查看餘額與明細**」—— 在 `balanceFailed` 這個世界, **餘額正是讀不到的那個東西**
              ⇒ 兩句同時出現 = 對客人講兩件相反的事。
              🛑 而 Sean 拍 `q5=乙` 時**沒有人問過他失敗世界要印什麼** ⇒ 這不是推翻他的板, 是一個他沒被問到的世界。
              📌 落檔在 manifest `business_overrides` 的 `walletUnavailableNoteReplacedOnFailure`
                 —— **因為「照拍板」與「偏離拍板」在 diff 上長得一樣, 差別只在有沒有那一筆。**
              ⚠️ 暫用字面, 定稿等 Sean(backlog `#964`)。 */}
          <p className="wal-balance-soon">{balanceFailed ? PROFILE_UNREADABLE_NOTE : WALLET_UNAVAILABLE_NOTE}</p>
        </div>
      </div>

      {/* 交易紀錄 — design WalletTab.jsx:87-113(`.wal-tx-section` 開在 :87、對應收尾 `</div>` 在 :113;
          2026-08-27 重量,原寫的 :86-112 起點是註解行、終點停在 `.wal-tx-list` 的收尾 = 結構中間),
          扣掉 .wal-tx-bal(Q3=乙) */}
      <div className="wal-tx-section">
        <div className="wal-tx-head">
          <h3>交易紀錄</h3>
          {/* 🔴 讀取失敗時**不印筆數** —— 印 `0 ENTRIES` 會被讀成「他沒有交易」。 */}
          {loadFailed ? null : (
            <div className="ap-mono">
              {/* 🔴 截斷了就**說出總數**,不要讓「這一頁的筆數」假扮成「總筆數」。 */}
              {truncated ? `${entries.length} / ${total} ENTRIES` : `${entries.length} ENTRIES`}
            </div>
          )}
        </div>
        <div className="wal-tx-list">
          {loadFailed ? (
            <div className="wal-tx-empty">
              <div>交易紀錄暫時讀不到</div>
              <div className="wal-tx-empty-sub">請稍後再試,或聯絡客服</div>
            </div>
          ) : entries.length === 0 ? (
            <div className="wal-tx-empty">
              <div>尚無交易紀錄</div>
              {/* design 原字是「儲值後將顯示於此」,而儲值現在不開放 ⇒ 同 BALANCE_META 的理由,
                  改成不預設他做得到儲值的說法。 */}
              <div className="wal-tx-empty-sub">有儲值或折抵時會顯示在這裡</div>
            </div>
          ) : (
            entries.map((tx) => (
              <div key={tx.id} className={`wal-tx wal-tx-${tx.entryType}`}>
                <div className="wal-tx-l">
                  <div className="ap-mono wal-tx-date">{tx.entryDate}</div>
                  <div className="wal-tx-note">{tx.note}</div>
                </div>
                <div className="wal-tx-r">
                  {/* 🔴 正負號**由 amount 的正負決定**,不由 entryType 決定 ——
                      DB 的 CHECK 保證兩者一致(`deposit`/`refund` > 0、`use` < 0),
                      而**讀 amount 是直接讀那個事實**;讀 entryType 是再推一次。
                      推一次就有推錯的機會,而錯出來仍是一個合理的金額。 */}
                  <div className={`wal-tx-amt ${tx.amount > 0 ? 'is-plus' : 'is-minus'}`}>
                    {/* 🔴 **逐字照 design `WalletTab.jsx:106`:正數印 `+`,負數【不印任何符號】** ——
                        負的靠 `.is-minus` 變色。我上一版印 `-`,那是**一處未揭示的 design 偏離**
                        (`code-reviewer` R1),而同一塊的註解宣稱「照搬」⇒ 兩句互相矛盾。
                        ⚠️ 而**判斷仍然讀 `amount` 的正負,不讀 `entryType`** —— 那一格沒有變。 */}
                    {tx.amount > 0 ? '+' : ''}NT$ {Math.abs(tx.amount).toLocaleString()}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
        {/* 🔴 截斷要**寫在客人看得到的地方**, 不是只寫在 log 裡。
            這一版沒有分頁(見 `page.tsx` 的 `WALLET_LEDGER_LIMIT`)⇒ 更舊的**現在真的看不到**
            ⇒ 那就要告訴他去哪裡問, 而不是讓他以為那就是全部。 */}
        {truncated ? (
          <p className="wal-tx-more">
            僅顯示最近 {entries.length} 筆,共 {total} 筆。需要更早的紀錄請聯絡客服。
          </p>
        ) : null}
      </div>
    </div>
  );
}
