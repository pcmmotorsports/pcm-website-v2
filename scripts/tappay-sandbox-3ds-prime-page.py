#!/usr/bin/env python3
"""
TapPay **sandbox** 3DS 探針 —— 前台側:用 TPDirect SDK 產一顆真 prime。

🔴🔴 **本檔最後沒有被 probe 用到,保留是為了記住那個誤診**(2026-08-10 P-274 窗實測):
前代看到「帶 3DS 旗標卻回 `auth_code`、無 `payment_url`」,診斷成「官方固定測試 prime 做不出
3DS」,於是把「必須用 SDK prime」寫進交接。真因是**欄名打錯**——送的是 `three_domain_secret`,
正確欄名 `three_domain_secure`(對齊 TapPayChargeAdapter.ts:188)。TapPay 靜默忽略未知欄 ⇒
直接授權。欄名改對後,**固定測試 prime 一樣拿得到 `payment_url`**,本頁不是必要條件。
(本窗仍先照交接跑完 SDK prime 這條路並成功產出 prime 與交易 `D20260809xCwNLf`,才發現欄名問題;
留檔供未來真的需要 SDK prime 時直接用。)真權威 =
docs/specs/2026-08-10-l4-stale-3ds-url-probe-plan.md(三分支動手前已寫死)。

本檔只做一件事:在 127.0.0.1 起一個**只給 playwright 用**的小頁,頁上掛 TPDirect 卡欄,
暴露 `window.__probeGetPrime()`。**不建交易、不打任何 TapPay REST**——那是
tappay-sandbox-3ds-stale-url-probe.py 的職責(host 寫死 sandbox + 送出前再斷言)。

🔴 安全設計:
  · **serverType 寫死 `'sandbox'`**:不吃 env 的 NEXT_PUBLIC_TAPPAY_ENV(該值目前=production),
    SDK 因此只會走 sandbox 端點。呼叫端**另外**用 playwright 的 network log 實地驗一次
    (「寫死」是宣稱、network log 才是證據)。
  · **app_id/app_key 不進 stdout、不進 argv**:腳本內部讀 .env.local,只注入 HTTP 回應 body。
    (memory `reference_never-source-env-local-use-grep`:2026-08-02 真的外洩過一把 TapPay secret)
  · **只綁 127.0.0.1**:不對 LAN 開。
  · 卡號用官方測試卡 `4242 4242 4242 4242`(非真卡),由呼叫端輸入、本檔不預填。
"""
import http.server
import socketserver
import sys

ENV_PATH = "/Users/sean_1/pcm-website-v2/apps/storefront/.env.local"
SDK_URL = "https://js.tappaysdk.com/sdk/tpdirect/v5.19.2"  # 與 useTapPayCard.tsx:27 同版
SERVER_TYPE = "sandbox"  # 🔴 寫死;絕不吃 env


def load_app_credentials():
    """只取 SDK 用的 app_id/app_key;讀檔在腳本內部,值不經 shell、不入 stdout。"""
    vals = {}
    with open(ENV_PATH, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            vals[k.strip()] = v.strip().strip('"').strip("'")
    app_id = vals.get("NEXT_PUBLIC_TAPPAY_APP_ID")
    app_key = vals.get("NEXT_PUBLIC_TAPPAY_APP_KEY")
    if not app_id or not app_key:
        sys.exit("🔴 .env.local 缺 NEXT_PUBLIC_TAPPAY_APP_ID / NEXT_PUBLIC_TAPPAY_APP_KEY")
    if not app_id.isdigit():
        sys.exit("🔴 APP_ID 非正整數 —— 拒跑(useTapPayCard.tsx:82 同一道閘)")
    return app_id, app_key


PAGE = """<!doctype html>
<meta charset="utf-8">
<title>L4 probe · TPDirect prime</title>
<style>
  body {{ font-family: system-ui; padding: 24px; max-width: 560px }}
  .tpfield {{ height: 40px; border: 1px solid #999; padding: 4px 8px; margin: 6px 0 14px }}
  #out {{ white-space: pre-wrap; font-family: ui-monospace; background: #f4f4f4; padding: 12px }}
</style>
<h3>L4 stale-3DS-URL probe — prime 產生器(sandbox 寫死)</h3>
<label>卡號</label><div class="tpfield" id="card-number"></div>
<label>到期</label><div class="tpfield" id="card-expiration-date"></div>
<label>CCV</label><div class="tpfield" id="card-ccv"></div>
<button id="go">getPrime</button>
<div id="out">status: booting</div>
<script src="{sdk_url}"></script>
<script>
  // 探針結果只放 window,不 render 到畫面(prime 不落截圖)。
  window.__probeResult = null;
  const out = document.getElementById('out');
  TPDirect.setupSDK({app_id}, '{app_key}', '{server_type}');
  TPDirect.card.setup({{
    fields: {{
      number: {{ element: '#card-number', placeholder: '4242 4242 4242 4242' }},
      expirationDate: {{ element: '#card-expiration-date', placeholder: 'MM / YY' }},
      ccv: {{ element: '#card-ccv', placeholder: '123' }},
    }},
    styles: {{ input: {{ 'font-size': '16px' }} }},
  }});
  TPDirect.card.onUpdate(u => {{
    window.__canGetPrime = u.canGetPrime;
    out.textContent = 'canGetPrime: ' + u.canGetPrime + ' | status ' + JSON.stringify(u.status);
  }});
  window.__probeGetPrime = () => new Promise(resolve => {{
    TPDirect.card.getPrime(r => {{
      // 🔴 prime 只進 window.__probeResult,不寫進 DOM(避免落進截圖/快照)。
      window.__probeResult = r.status === 0
        ? {{ ok: true, prime: r.card.prime, lastfour: r.card.lastfour }}
        : {{ ok: false, status: r.status }};
      out.textContent = 'getPrime done, ok=' + (r.status === 0);
      resolve(window.__probeResult.ok);
    }});
  }});
  document.getElementById('go').onclick = () => window.__probeGetPrime();
</script>
"""


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8793
    app_id, app_key = load_app_credentials()
    body = PAGE.format(sdk_url=SDK_URL, app_id=app_id, app_key=app_key,
                       server_type=SERVER_TYPE).encode()

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_args):  # 不把 request log 噴進終端
            pass

    with socketserver.TCPServer(("127.0.0.1", port), Handler) as httpd:
        print(f"serving on http://127.0.0.1:{port}/ (serverType={SERVER_TYPE}, Ctrl-C 停)")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
