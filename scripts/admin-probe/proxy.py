# admin 前綴代理:剝掉 /rest/v1 轉給 PostgREST。
#
# 🔴 **為什麼需要它**:supabase-js 打的是 `/rest/v1/...`,而 PostgREST 在**根** ——
#    直連會回 `PGRST125 Invalid path specified in request URL`(runbook §4 的坑⑤)。
#
# 🔴 **與顧客站那支的差別:這裡【沒有】`/auth/v1` 替身,而那是刻意的。**
#    admin 走 `ADMIN_DEV_BYPASS=1`(免登入)+ server 端 `service_role`,不經過 supabase auth。
#    ⇒ 少一個替身 = 少一個「它在這條鏈上恆綠」的題目。
#    ⚠️ 反面:**這條鏈證不了 admin 的登入閘** —— 它根本沒跑到那一段。
import http.server, urllib.request, urllib.error, sys

UP = "http://127.0.0.1:" + sys.argv[1]
HOP = ('host', 'content-length', 'connection', 'transfer-encoding')


class H(http.server.BaseHTTPRequestHandler):
    def relay(self):
        path = self.path
        if path.startswith('/rest/v1'):
            path = path[len('/rest/v1'):] or '/'
        body = None
        cl = self.headers.get('Content-Length')
        if cl:
            body = self.rfile.read(int(cl))
        req = urllib.request.Request(UP + path, data=body, method=self.command)
        for k, v in self.headers.items():
            if k.lower() not in HOP:
                req.add_header(k, v)
        try:
            with urllib.request.urlopen(req) as r:
                self.emit(r.status, r.headers, r.read())
        except urllib.error.HTTPError as e:
            # 🔴 錯誤也要原樣轉回去 —— 吞掉的話 PostgREST 的 400/404 會變成代理的 500,
            #    而那會讓「查詢寫錯」看起來像「環境壞了」。
            self.emit(e.code, e.headers, e.read())

    def emit(self, status, headers, data):
        self.send_response(status)
        for k, v in headers.items():
            if k.lower() not in HOP:
                self.send_header(k, v)
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    do_GET = do_POST = do_PATCH = do_DELETE = do_PUT = do_HEAD = relay

    def log_message(self, *a):
        pass


# 🔴 綁 127.0.0.1,不綁 0.0.0.0 —— 同 up.sh 檔頭那條(免登入的東西不對區網開)。
http.server.ThreadingHTTPServer(('127.0.0.1', int(sys.argv[2])), H).serve_forever()
