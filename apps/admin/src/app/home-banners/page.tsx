import Link from 'next/link';
import { HOME_BANNER_MAX_SLIDES } from '@pcm/domain';
import '../../components/home-banners/home-banners.css';
import { HomeBannerEditor } from '../../components/home-banners/home-banner-editor';
import { SettingsResultBanner } from '../../components/settings/settings-result-banner';
import { HOME_BANNERS_PATH, HOME_BANNER_RESULT_MESSAGES } from '../../lib/home-banners/home-banner-constants';
import { listHomeBanners } from '../../lib/home-banners/home-banner-repository';
import {
  BANNER_STATE_LABEL,
  HOME_BANNER_TABS,
  HOME_BANNER_TAB_LABEL,
  bannerState,
  currentLive,
  filterByTab,
  formatBannerTime,
  parseTab,
  tabCounts,
  type HomeBannerRow,
  type HomeBannerTab,
} from '../../lib/home-banners/home-banner-view';

export const dynamic = 'force-dynamic';

// app/home-banners/page.tsx — 後台「首頁大圖」(PRD 2026-09-15 §8 片 3/4/6;Sean Q7 乙 主側欄)。
// 稿:OD pcm-524f/admin-home-banners-v1.html。
// ⚠️ 稿上的「今天讀信」摘要、來源信 / 供應商 / 配到商品三欄、品牌分類連結產生器屬後面的 Gmail 片,本頁先不畫(沒有資料來源)。
// 🔴 網址驅動:?view=<分頁> · ?edit=<id> 開右側面板 · ?new=1 開空白面板 · ?r=<結果碼>(只查表,不渲染原字)。

type SearchParams = Record<string, string | string[] | undefined>;

function single(v: string | string[] | undefined): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function TitleCell({ row, href }: { row: HomeBannerRow; href: string }) {
  const title = [row.titleLine1, row.titleLine2].filter(Boolean).join('');
  const sub = [row.eyebrow, row.imageKind === 'product' ? '白底商品照' : null].filter(Boolean).join(' · ');
  return (
    <td>
      <Link href={href} className='t1'>{title || '(沒有標題)'}</Link>
      {sub ? <div className='t2'>{sub}</div> : null}
    </td>
  );
}

export default async function HomeBannersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const raw = await searchParams;
  const tab = parseTab(single(raw.view));
  const editId = single(raw.edit) ?? null;
  const newOpen = single(raw.new) === '1';
  const resultCode = single(raw.r);

  let rows: HomeBannerRow[] = [];
  let loadFailed = false;
  try {
    rows = await listHomeBanners();
  } catch (error) {
    console.error('[admin/home-banners] 首頁大圖讀取失敗', error);
    loadFailed = true;
  }

  const now = new Date();
  const counts = tabCounts(rows, now);
  const live = currentLive(rows, now);
  const shown = filterByTab(rows, tab, now);
  const tabHref = (t: HomeBannerTab) => `${HOME_BANNERS_PATH}?view=${t}`;
  const closeHref = tabHref(tab);
  const editRow = editId === null ? null : rows.find((r) => r.id === editId) ?? null;

  return (
    <div className='hb-page'>
      <div className='hb-head'>
        <h1>首頁大圖</h1>
        <span className='sp' />
        {loadFailed ? null : <Link href={`${tabHref(tab)}&new=1`} className='hb-btn hb-btn-p'>+ 手動新增</Link>}
      </div>

      <nav className='hb-views' aria-label='首頁大圖分頁'>
        {HOME_BANNER_TABS.map((t) => (
          <Link key={t} href={tabHref(t)} aria-current={t === tab ? 'page' : undefined}>
            {HOME_BANNER_TAB_LABEL[t]}
            {t === 'all' ? null : <span className='n'>{counts[t]}</span>}
          </Link>
        ))}
      </nav>

      <SettingsResultBanner code={resultCode} messages={HOME_BANNER_RESULT_MESSAGES} />

      {loadFailed ? (
        <div className='border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-6 text-sm'>
          首頁大圖讀取失敗,請重新整理;還是一樣請回報。讀不到之前不能新增,免得重複建草稿。
        </div>
      ) : (
        <>
          <div className='hb-live' data-testid='home-banner-live'>
            {live ? (
              <>
                {live.imageDesktopUrl ? <img src={live.imageDesktopUrl} alt='' /> : null}
                <span>
                  首頁輪播的第一張:<b>{[live.titleLine1, live.titleLine2].filter(Boolean).join('')}</b>
                  ({live.startsAt ? formatBannerTime(live.startsAt) : '—'} 上架 → {live.endsAt ? formatBannerTime(live.endsAt) : '—'} 自動下架)
                  {/* 🔴🔴 **2026-09-16:這一句原本是【假的,而且會讓員工做錯事】。**
                      ⛔ ~~「但首頁只會顯示最近上架的那一張(多張輪播還沒做)」~~
                      🔬 顧客站 `apps/storefront/src/lib/home-banners.ts:142` 逐字
                         `.limit(HOME_BANNER_MAX_SLIDES)`,而那個常數 `:112` 是 **4**
                         ⇒ **多張輪播早就做完了**(`07ecf61f5`,已在 main 上)。
                      🎯 **嚴重度不是「文案不準」,是【它對員工下的指令是錯的】** ——
                         讀完他會以為「再發一張也沒用」⇒ 放棄發、或先把現在那張下架讓位。
                         **兩種都是錯的動作。**
                      ⚠️ 而它**正好只在「同時兩張以上發布」那一刻才跳出來** ⇒ 平常看不到,
                         所以沒有人發現它壞了。📌 **只在出事那一刻才出現的字,沒有人在看。** */}
                  {counts.published > 1 ? <>,連同這張共 <b>{counts.published}</b> 張在發布中,首頁會一起輪播(最多 {HOME_BANNER_MAX_SLIDES} 張,<b>最新上架的排最前面</b>)</> : null}·
                  {/* 🔴 2026-09-17:⛔ ~~「發布新的不會把【這張】下架;要收起來請按【那張】的『下架』。」~~
                      那句話**指錯列**:整段住在 live 區塊裡,而 `currentLive` 挑的是 starts_at 最大的那張
                      ⇒ 「這張 / 那張」預設指向**剛發布的新那張**,而員工需要收掉的是**舊的**。
                      📌 **「這」與「那」在一行字裡沒有錨點** —— 讀的人得自己推,而多數人會推錯。
                      ⇒ 改成用**身分**講(舊的 / 要收的那一張),不用指示代名詞。
                      ⚠️ 這一句**刻意不放進 `counts.published > 1` 那個三元式**:只有一張時它仍然為真,
                         而那時它是**下一次**的提醒 —— 那正是這句話最需要被看到的時機。 */}
                  <b>發布新的不會自動收掉舊的</b>;要收起來,到下面列表點開<b>要收的那一張</b>,按它的「下架」。
                </span>
              </>
            ) : (
              <span>首頁目前沒有新品大圖(輪播照原本那幾張)。</span>
            )}
          </div>

          <table className='hb-table'>
            <thead>
              <tr><th>縮圖</th><th>標題</th><th>狀態</th><th>上架 → 下架</th><th>最後修改</th></tr>
            </thead>
            <tbody>
              {shown.length === 0 ? (
                <tr><td colSpan={5} className='muted'>這個分頁沒有大圖。</td></tr>
              ) : (
                shown.map((row) => {
                  const state = bannerState(row, now);
                  const href = `${tabHref(tab)}&edit=${row.id}`;
                  return (
                    <tr key={row.id} className={row.id === editId ? 'sel' : undefined}>
                      <td className='th'>
                        {row.imageDesktopUrl ? <img src={row.imageDesktopUrl} alt='' className={row.imageKind === 'product' ? 'prod' : undefined} /> : null}
                      </td>
                      <TitleCell row={row} href={href} />
                      <td><span className={`hb-cap ${state}`}>{BANNER_STATE_LABEL[state]}</span></td>
                      <td className='muted'>
                        {row.startsAt || row.endsAt
                          ? `${row.startsAt ? formatBannerTime(row.startsAt) : '發布當下'} → ${row.endsAt ? formatBannerTime(row.endsAt) : '14 天後'}`
                          : '—'}
                      </td>
                      <td className='small muted'>{row.updatedBy} · {formatBannerTime(row.updatedAt)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
          {/* 🔴 同上那句的常駐版 —— ⛔ ~~「首頁只會顯示最近上架的那一張(多張輪播還沒做)」~~
              兩句是同一個假前提的兩個出口, **只改一句等於沒改**(員工在另一個地方照樣讀到錯的)。 */}
          <p className='small muted' style={{ margin: '8px 2px' }}>發布後約 1 分鐘內出現在首頁。同時發布多張時,首頁會<b>一起輪播</b>(最多 {HOME_BANNER_MAX_SLIDES} 張,<b>最新上架的排最前面</b>;超過就只取最前面那幾張)。下架時間沒填 = 14 天後自動下架。發布與下架所有員工都能做。連結要指到 /products… 或 /brands…;廠商信來的大圖還要先配到商品才發得出去。</p>

          {newOpen || editId !== null ? (
            <>
              <Link href={closeHref} className='hb-shade' aria-label='關閉面板' />
              {newOpen || editRow !== null ? (
                <HomeBannerEditor
                  key={editRow?.id ?? 'new'}
                  banner={newOpen ? null : editRow}
                  state={newOpen || editRow === null ? null : bannerState(editRow, now)}
                  live={live}
                  liveCount={counts.published}
                  closeHref={closeHref}
                  view={tab}
                  nowIso={now.toISOString()}
                />
              ) : (
                <aside className='hb-panel' aria-label='找不到這張大圖'>
                  <div className='hd'><h3>找不到這張大圖</h3><Link href={closeHref} className='x' aria-label='關閉'>×</Link></div>
                  <div className='bd'><p className='muted'>它可能已經被刪掉或網址不對,請回列表重新點一次。</p></div>
                </aside>
              )}
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
