"""A local file server for model-download tests (binds 127.0.0.1, port 0; never the internet).

    with serve({"/ggerganov/whisper.cpp/resolve/main/ggml-x.bin": b"..."}) as base_url:
        ...  # point $JDF_STT_MODEL_BASE_URL at base_url

Unknown paths answer 404. The wrong-hash case is a registry entry whose sha256 does not
match the bytes served; `truncate={path: n}` sends a Content-Length of the full size but
only the first n bytes, then closes (a dropped connection). `server.requests` lists paths.
"""

from __future__ import annotations

import contextlib
import http.server
import threading


class _Server(http.server.ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, files, truncate):
        self.files = dict(files)
        self.truncate = dict(truncate)
        self.requests = []
        super().__init__(("127.0.0.1", 0), _Handler)


class _Handler(http.server.BaseHTTPRequestHandler):
    server: _Server

    def do_GET(self):  # noqa: N802 (http.server naming)
        self.server.requests.append(self.path)
        body = self.server.files.get(self.path)
        if body is None:
            self.send_error(404, "not found")
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        cut = self.server.truncate.get(self.path)
        self.wfile.write(body if cut is None else body[:cut])
        if cut is not None:
            self.close_connection = True

    def log_message(self, format, *args):  # keep test output quiet
        pass


@contextlib.contextmanager
def serve(files, truncate=None):
    """Serve `files` (url path -> bytes); yields the server, whose `.url` is the base URL."""
    server = _Server(files, truncate or {})
    server.url = "http://127.0.0.1:%d" % server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, args=(0.05,), daemon=True)
    thread.start()
    try:
        yield server
    finally:
        server.shutdown()
        server.server_close()
