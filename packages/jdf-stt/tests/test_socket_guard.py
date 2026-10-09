import socket
import threading
import urllib.request

import pytest


def test_connect_is_blocked():
    with socket.socket() as s, pytest.raises(OSError, match="network disabled in tests"):
        s.connect(("93.184.215.14", 80))


def test_loopback_is_blocked_without_the_marker():
    with socket.socket() as s, pytest.raises(OSError, match="network disabled in tests"):
        s.connect(("127.0.0.1", 9))
    with socket.socket() as s, pytest.raises(OSError, match="network disabled in tests"):
        s.connect_ex(("127.0.0.1", 9))


def test_create_connection_is_blocked_before_any_dns_lookup(monkeypatch):
    def no_dns(*args, **kwargs):
        raise AssertionError("DNS lookup attempted")

    monkeypatch.setattr(socket, "getaddrinfo", no_dns)
    with pytest.raises(OSError, match="network disabled in tests"):
        socket.create_connection(("huggingface.co", 443), timeout=1)


def test_urllib_is_blocked():
    with pytest.raises(OSError, match="network disabled in tests"):
        urllib.request.urlopen("http://example.com/", timeout=1)


@pytest.fixture
def echo_server():
    server = socket.socket()
    server.bind(("127.0.0.1", 0))
    server.listen(1)

    def serve():
        conn, _ = server.accept()
        with conn:
            conn.sendall(conn.recv(16))

    thread = threading.Thread(target=serve, daemon=True)
    thread.start()
    yield server.getsockname()
    server.close()
    thread.join(timeout=5)


@pytest.mark.localhost
def test_localhost_marker_allows_loopback(echo_server):
    with socket.create_connection(echo_server, timeout=5) as s:
        s.sendall(b"ping")
        assert s.recv(16) == b"ping"


@pytest.mark.localhost
def test_localhost_marker_still_blocks_everything_else():
    with socket.socket() as s, pytest.raises(OSError, match="network disabled in tests"):
        s.connect(("93.184.215.14", 80))
    with pytest.raises(OSError, match="network disabled in tests"):
        socket.create_connection(("huggingface.co", 443), timeout=1)
