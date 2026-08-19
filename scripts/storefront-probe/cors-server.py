# 只為了讓瀏覽器 import 得到 overflow-ruler.mjs 的最小 http server(帶 CORS)。
# 用完當回合就拆 —— down.sh 會處理。
import http.server, functools
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()
    def log_message(self, *a): pass
    def guess_type(self, path):
        if str(path).endswith('.mjs'): return 'text/javascript'
        return super().guess_type(path)
import os
# 服務本目錄(overflow-ruler.mjs 就在這裡);瀏覽器要 import 它 ⇒ 必須帶 CORS 標頭。
D = os.path.dirname(os.path.abspath(__file__))
# 🔴 埠從 argv 讀,**不再寫死**(2026-08-19 W3):寫死的話,`up.sh`/`env.sh` 覆寫埠對它無效,
#    而更貴的是 `down.sh` 只能用 `pkill -f "cors-server.py"` 這種**不帶埠的字面**去殺它
#    ⇒ **會連別的視窗起的那一支一起殺掉**(同一台機器上,那支的 cmdline 一模一樣)。
#    帶了埠之後,cmdline 是 `… cors-server.py 3987` ⇒ 收攤才殺得到【自己那一個】。
#    ⚠️ 沒帶參數時仍回 3987,讓舊的呼叫方式不會當場壞掉。
import sys
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 3987
http.server.ThreadingHTTPServer(("127.0.0.1", PORT), functools.partial(H, directory=D)).serve_forever()
