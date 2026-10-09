#!/usr/bin/env python3
"""A fake local LLM server speaking both llama.cpp's and Ollama's chat APIs, on 127.0.0.1.

    POST /v1/chat/completions   llama.cpp llama-server (OpenAI shape):
                                reply {"choices": [{"message": {"role": "assistant", "content": REPLY}}]}
    POST /api/chat              Ollama (with "stream": false):
                                reply {"model": ..., "message": {"role": "assistant", "content": REPLY}, "done": true}

In tests: `with serve() as server:` binds port 0 and yields the server; `server.url` is its base
URL, `server.requests` lists every request as {"path", "body"} (body parsed from JSON), and the
switches `server.reply`, `server.status` (an HTTP error code to answer with) and `server.delay`
(seconds to wait before answering) change its behaviour.

By hand: `python3 fake_llm_server.py [PORT]` serves until Ctrl+C and prints its URL.

Stdlib only, Python 3.8 syntax (like the other fakes).
"""

from __future__ import annotations

import contextlib
import json
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DEFAULT_REPLY = "Rewritten by the fake local model."


class FakeLlmServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, port=0):
        super().__init__(("127.0.0.1", port), _Handler)
        self.requests = []
        self.reply = DEFAULT_REPLY
        self.status = 200
        self.delay = 0.0

    @property
    def url(self):
        return "http://127.0.0.1:%d" % self.server_address[1]


class _Handler(BaseHTTPRequestHandler):
    server: FakeLlmServer

    def log_message(self, format, *args):  # quiet
        pass

    def _send(self, status, payload):
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        self._send(404, {"error": "not found"})

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length).decode("utf-8")
        try:
            body = json.loads(raw)
        except ValueError:
            body = raw
        server = self.server
        server.requests.append({"path": self.path, "body": body})
        if server.delay:
            time.sleep(server.delay)
        if server.status != 200:
            self._send(server.status, {"error": "fake failure %d" % server.status})
            return
        if self.path == "/v1/chat/completions":
            self._send(200, {"choices": [{"index": 0, "message": {"role": "assistant", "content": server.reply}}]})
        elif self.path == "/api/chat":
            model = body.get("model") if isinstance(body, dict) else None
            self._send(200, {"model": model, "message": {"role": "assistant", "content": server.reply}, "done": True})
        else:
            self._send(404, {"error": "not found"})


@contextlib.contextmanager
def serve(port=0):
    server = FakeLlmServer(port)
    thread = threading.Thread(target=server.serve_forever, args=(0.05,), daemon=True)
    thread.start()
    try:
        yield server
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


if __name__ == "__main__":
    with serve(int(sys.argv[1]) if len(sys.argv) > 1 else 0) as running:
        print(running.url, flush=True)
        try:
            while True:
                time.sleep(3600)
        except KeyboardInterrupt:
            pass
