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
http.server.ThreadingHTTPServer(("127.0.0.1", 3987), functools.partial(H, directory=D)).serve_forever()
