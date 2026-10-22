"""A chat client for a local LLM: llama.cpp's llama-server or Ollama, on this Mac only.

This and the model download in `models.py` are the only network code in jdf-stt. The URL must
name a loopback host (127.0.0.1, ::1 or localhost); anything else is refused before any
connection. Proxy settings are ignored and redirects are not followed, so the text cannot be
sent on elsewhere. Ollama can also run "cloud" models, which forward the text to ollama.com
even though the server is local: those are refused by name (`:cloud` or a `-cloud` tag, for every
backend) and, before any chat, by asking the server (`/api/show` reports `remote_host` for them).
The server is asked even with the llama.cpp backend when it answers Ollama's `/api/version`, since
Ollama also serves the OpenAI-compatible `/v1/chat/completions`; only a 404 or 405 there means
"not Ollama", and any other outcome (no answer, an error, a reply that is not Ollama's) stops before
the text is sent. There is no retry and
no fallback: if the local server is not there, the error says so.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request

from jdf_stt.types import SttError, TranscribeOptions

LOCAL_HOSTS = {"127.0.0.1", "::1", "localhost"}
LLAMA_CPP_URL = "http://127.0.0.1:8080"
OLLAMA_URL = "http://127.0.0.1:11434"
TIMEOUT = 120.0  # seconds; a long dictation on a small Mac can take a while

_BACKENDS = {
    # name: (path, label, how to start it)
    "llama.cpp": ("/v1/chat/completions", "llama.cpp", "start llama-server -m MODEL.gguf"),
    "ollama": ("/api/chat", "Ollama", "start it with `ollama serve`"),
}


def check_local(url: str) -> None:
    """Raise `SttError` unless `url` is http(s) to a loopback host."""
    try:
        parts = urllib.parse.urlsplit(url)
        local = (
            parts.scheme in ("http", "https")
            and (parts.hostname or "").lower() in LOCAL_HOSTS
            and parts.username is None
            and (parts.port is None or parts.port > 0)  # .port raises ValueError when malformed
        )
    except ValueError:
        local = False
    if not local:
        raise SttError(
            f"local models only: {url!r} is not on this Mac. Use a URL on 127.0.0.1, ::1 or localhost "
            f"(llama.cpp: {LLAMA_CPP_URL}, Ollama: {OLLAMA_URL})."
        )


def base_url(o: TranscribeOptions) -> str:
    """The server URL without a trailing slash. Ollama gets its own port when the URL was left alone."""
    url = o.llm_url
    if o.llm_backend == "ollama" and url == TranscribeOptions.llm_url:
        url = OLLAMA_URL
    return url.rstrip("/")


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # urllib then raises HTTPError for the 3xx


def _open(request: urllib.request.Request, timeout: float):
    # No proxies (an empty ProxyHandler overrides $http_proxy and the system settings) and no redirects.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect)
    return opener.open(request, timeout=timeout)


def _cloud_error(model: str) -> SttError:
    return SttError(
        f"local models only: Ollama runs {model!r} in its cloud, so the text would leave this Mac. "
        "Use a model that runs locally (see `ollama list`)."
    )


def check_options(o: TranscribeOptions) -> None:
    """Raise `SttError` for an unknown backend, a URL not on this Mac, an Ollama model that is
    missing, or a model (for any backend) named as an Ollama cloud one."""
    if o.llm_backend not in _BACKENDS:
        raise SttError(f"unknown LLM backend {o.llm_backend!r} (available: {', '.join(_BACKENDS)})")
    check_local(base_url(o))
    if o.llm_backend == "ollama" and not o.llm_model:
        raise SttError("Ollama needs a model name: pass --llm-model (for example --llm-model llama3.2)")
    # Whatever the backend: the URL may be an Ollama behind its OpenAI-compatible endpoint.
    tag = o.llm_model.rpartition(":")[2] if o.llm_model and ":" in o.llm_model else ""
    if tag == "cloud" or tag.endswith("-cloud"):
        raise _cloud_error(o.llm_model)


# What `_fetch(..., missing_ok=True)` returns for a 404 or 405, distinct from any JSON reply (even null).
_MISSING = object()


def _fetch(o: TranscribeOptions, request: urllib.request.Request, *, missing_ok: bool = False):
    """Send `request` to the local server and return the JSON reply; errors name backend and URL.
    With `missing_ok`, an HTTP 404 or 405 (no such endpoint) returns `_MISSING` instead."""
    _, label, start_hint = _BACKENDS[o.llm_backend]
    url = base_url(o)
    where = f"{label} at {url}"
    try:
        with _open(request, TIMEOUT) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if missing_ok and e.code in (404, 405):
            return _MISSING
        detail = e.read().decode("utf-8", "replace").strip()[:300]
        raise SttError(f"{where} answered HTTP {e.code}" + (f": {detail}" if detail else "")) from None
    except TimeoutError:
        raise SttError(f"{where} did not answer within {TIMEOUT:g} s") from None
    except urllib.error.URLError as e:
        if isinstance(e.reason, TimeoutError):
            raise SttError(f"{where} did not answer within {TIMEOUT:g} s") from None
        raise SttError(f"no {label} server answering at {url} ({e.reason}); {start_hint}, or pass --llm-url") from None
    except (ValueError, UnicodeDecodeError) as e:
        raise SttError(f"{where} sent an answer that is not JSON: {e}") from None


def _post(o: TranscribeOptions, path: str, body: dict) -> dict:
    """POST `body` as JSON to the local server and return the JSON reply."""
    request = urllib.request.Request(
        base_url(o) + path,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    return _fetch(o, request)


def _answers_as_ollama(o: TranscribeOptions) -> bool:
    """True when the server answers Ollama's GET /api/version, i.e. it is Ollama whatever the backend says.

    Fails closed: only a 404 or 405 (no such endpoint) means "not Ollama". Any other answer, or none,
    raises `SttError`, since an Ollama that could not be checked might send the text to its cloud."""
    try:
        reply = _fetch(o, urllib.request.Request(base_url(o) + "/api/version"), missing_ok=True)
        if reply is _MISSING:
            return False
        if isinstance(reply, dict) and "version" in reply:
            return True
        raise SttError(f"/api/version answered {str(reply)[:300]!r}")
    except SttError as e:
        raise SttError(
            f"could not tell whether the server is Ollama, whose cloud models would get the text, "
            f"so nothing was sent: {e}"
        ) from None


def chat(o: TranscribeOptions, system: str, user: str) -> str:
    """Send one system + user message to the local server in `o` and return its reply text."""
    check_options(o)
    path, label, _ = _BACKENDS[o.llm_backend]
    where = f"{label} at {base_url(o)}"
    if o.llm_backend == "ollama" or _answers_as_ollama(o):
        if not o.llm_model:
            raise SttError(f"{where} is Ollama, which needs a model name: pass --llm-model")
        info = _post(o, "/api/show", {"model": o.llm_model})
        if not isinstance(info, dict) or info.get("remote_host") or info.get("remote_model"):
            raise _cloud_error(o.llm_model)
    body: dict = {
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "stream": False,
    }
    if o.llm_model:
        body["model"] = o.llm_model
    payload = _post(o, path, body)
    try:
        if o.llm_backend == "ollama":
            text = payload["message"]["content"]
        else:
            text = payload["choices"][0]["message"]["content"]
    except KeyError, IndexError, TypeError:
        raise SttError(f"{where} sent an answer without a message: {str(payload)[:300]}") from None
    if not isinstance(text, str):
        raise SttError(f"{where} sent an answer without a message: {str(payload)[:300]}")
    return text.strip()
