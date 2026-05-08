// HomeFooter.tsx — 字面從 design-reference/components/HomePage.jsx @ d5ea3aa 直接搬
// (© MMXXVI · PCM MOTOR PARTS LTD.、新莊化成路 736 巷 18 號)
'use client';

import { useCallback, type MouseEvent } from 'react';

export function HomeFooter() {
  const onNav = useCallback((target: string, ctx?: object) => {
    console.log('[onNav]', target, ctx);
  }, []);

  const handle = (e: MouseEvent, target: string, ctx?: object) => {
    e.preventDefault();
    onNav(target, ctx);
  };

  return (
    <footer className="ed-footer">
      <div className="ed-footer-inner">
        <div className="ed-footer-brand">
          <div className="ed-footer-logo">PCM MOTORSPORTS</div>
          <p className="ed-footer-tagline">
            改裝不只是升級配件,<br/>
            是風格與態度的延伸。
          </p>
          <div className="ed-footer-social">
            <a href="#">Facebook</a>
            <a href="#">Instagram</a>
            <a href="#">LINE</a>
          </div>
        </div>
        <div className="ed-footer-cols">
          <div>
            <div className="ed-mono ed-footer-h">購物</div>
            <a href="#" onClick={(e) => handle(e, 'catalog')}>商品目錄</a>
            <a href="#" onClick={(e) => handle(e, 'brands')}>品牌專區</a>
            <a href="#" onClick={(e) => handle(e, 'new')}>新品上架</a>
            <a href="#" onClick={(e) => handle(e, 'sale')}>特價專區</a>
          </div>
          <div>
            <div className="ed-mono ed-footer-h">服務</div>
            <a href="#" onClick={(e) => handle(e, 'install')}>安裝預約</a>
            <a href="#" onClick={(e) => handle(e, 'stores')}>合作店家</a>
            <a href="#" onClick={(e) => handle(e, 'shipping')}>配送 & 退貨</a>
            <a href="#">聯絡客服</a>
          </div>
          <div>
            <div className="ed-mono ed-footer-h">門市</div>
            <p>新北市新莊區化成路<br/>736 巷 18 號一樓</p>
            <p>週一-週六 10:00-20:00</p>
            <p>02-2998-xxxx</p>
          </div>
        </div>
      </div>
      <div className="ed-footer-base">
        <span className="ed-mono">© MMXXVI · PCM MOTOR PARTS LTD.</span>
        <span className="ed-mono">統編 · xxxxxxxx</span>
      </div>
    </footer>
  );
}
