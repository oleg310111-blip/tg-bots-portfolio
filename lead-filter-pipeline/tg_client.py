"""Shared Telethon client factory with proxy, SQLite timeout, PID lock, and cached peer resolution."""

from __future__ import annotations

import atexit
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sqlite3
import sys
import time
from typing import Any
from urllib.parse import unquote, urlparse

from dotenv import load_dotenv

_SCHEME_MAP = {
    "socks5": "SOCKS5",
    "socks5h": "SOCKS5",
    "socks4": "SOCKS4",
    "http": "HTTP",
    "https": "HTTP",
}

DEFAULT_LOCK_FILENAME = "tg_hunter.lock"
DEFAULT_FLOOD_STATE_FILENAME = "flood_state.json"
DEFAULT_SQLITE_TIMEOUT = 30.0


def parse_proxy_url(proxy_url: str) -> dict[str, Any] | None:
    """Parse ``TG_PROXY`` URL (e.g. ``socks5://user:pass@ip:port``) for Telethon."""
    raw = (proxy_url or "").strip()
    if not raw:
        return None

    parsed = urlparse(raw)
    scheme = (parsed.scheme or "").lower()
    attr_name = _SCHEME_MAP.get(scheme)
    if not attr_name:
        raise ValueError(
            f"Unsupported TG_PROXY scheme {parsed.scheme!r}. Use socks5://, socks4://, or http://."
        )

    host = parsed.hostname
    try:
        port = parsed.port
    except ValueError as exc:
        raise ValueError(f"Invalid port in TG_PROXY: {exc}") from exc

    if not host or not port:
        raise ValueError("TG_PROXY must include host and port (e.g. socks5://user:pass@1.2.3.4:1080).")

    import socks

    proxy_cfg: dict[str, Any] = {
        "proxy_type": getattr(socks, attr_name),
        "addr": host,
        "port": port,
        "rdns": True,
    }
    if parsed.username is not None:
        proxy_cfg["username"] = unquote(parsed.username)
    if parsed.password is not None:
        proxy_cfg["password"] = unquote(parsed.password)
    return proxy_cfg


def is_pid_alive(pid: int) -> bool:
    """Return True if an OS process with ``pid`` currently exists."""
    if pid <= 0:
        return False
    if sys.platform == "win32":
        import ctypes

        PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
        STILL_ACTIVE = 259
        handle = ctypes.windll.kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, int(pid))
        if not handle:
            err = ctypes.windll.kernel32.GetLastError()
            # ERROR_ACCESS_DENIED (5) means process exists under another privilege level
            return err == 5
        try:
            exit_code = ctypes.c_ulong()
            if ctypes.windll.kernel32.GetExitCodeProcess(handle, ctypes.byref(exit_code)):
                return exit_code.value == STILL_ACTIVE
            return True
        finally:
            ctypes.windll.kernel32.CloseHandle(handle)
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return False


class SessionFileLock:
    """Single-instance PID lock file (``tg_hunter.lock``) with stale-PID cleanup."""

    def __init__(self, lock_path: Path, mode_label: str = "tg_hunter") -> None:
        self.lock_path = Path(lock_path)
        self.mode_label = mode_label
        self._acquired = False

    def _read_lock_info(self) -> dict[str, Any]:
        try:
            raw = self.lock_path.read_text(encoding="utf-8").strip()
            if not raw:
                return {}
            data = json.loads(raw)
            return data if isinstance(data, dict) else {}
        except (OSError, ValueError, json.JSONDecodeError):
            return {}

    def acquire(self) -> None:
        """Acquire lock file exclusively, removing stale lock if owner PID is dead."""
        if self._acquired:
            return
        self.lock_path.parent.mkdir(parents=True, exist_ok=True)
        my_pid = os.getpid()

        for _ in range(3):
            try:
                fd = os.open(str(self.lock_path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                payload = {
                    "pid": my_pid,
                    "mode": self.mode_label,
                    "acquired_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
                }
                with os.fdopen(fd, "w", encoding="utf-8") as fh:
                    fh.write(json.dumps(payload, ensure_ascii=False, indent=2))
                self._acquired = True
                return
            except FileExistsError:
                info = self._read_lock_info()
                existing_pid = int(info.get("pid") or 0)
                if existing_pid == my_pid:
                    self._acquired = True
                    return
                if existing_pid > 0 and is_pid_alive(existing_pid):
                    existing_mode = info.get("mode", "unknown")
                    raise RuntimeError(
                        f"Another tg_hunter instance is already running "
                        f"(PID={existing_pid}, mode={existing_mode!r}, lock={self.lock_path})."
                    )
                # Stale or corrupt lock file from a dead process
                try:
                    self.lock_path.unlink(missing_ok=True)
                except OSError as exc:
                    raise RuntimeError(f"Unable to clear stale lock {self.lock_path}: {exc}") from exc

        raise RuntimeError(f"Failed to acquire session lock {self.lock_path}.")

    def release(self) -> None:
        """Release lock file if owned by the current process."""
        if not self._acquired:
            return
        self._acquired = False
        try:
            info = self._read_lock_info()
            existing_pid = int(info.get("pid") or 0)
            if existing_pid in (0, os.getpid()):
                self.lock_path.unlink(missing_ok=True)
        except OSError:
            pass

    def __enter__(self) -> "SessionFileLock":
        self.acquire()
        return self

    def __exit__(self, *args: object) -> None:
        self.release()


# ---------------------------------------------------------------------------
# FloodWait state persistence (flood_state.json)
# ---------------------------------------------------------------------------


def load_flood_state(state_path: Path) -> dict[str, Any]:
    """Load persisted FloodWait cooldown state from JSON."""
    if not state_path.exists():
        return {}
    try:
        data = json.loads(state_path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError, json.JSONDecodeError):
        return {}


def _save_flood_state(state_path: Path, state: dict[str, Any]) -> None:
    state_path.parent.mkdir(parents=True, exist_ok=True)
    state_path.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def get_flood_wait_remaining(
    state_path: Path,
    key: str = "resolve_username",
    now_ts: float | None = None,
) -> float:
    """Return remaining FloodWait cooldown seconds for ``key``, or 0.0 if inactive."""
    state = load_flood_state(state_path)
    entry = state.get(key)
    if not isinstance(entry, dict):
        return 0.0
    until_ts = float(entry.get("until_ts") or 0.0)
    now = time.time() if now_ts is None else float(now_ts)
    remaining = until_ts - now
    return remaining if remaining > 0 else 0.0


def record_flood_wait(
    state_path: Path,
    seconds: float,
    key: str = "resolve_username",
    reason: str = "",
    now_ts: float | None = None,
) -> float:
    """Persist FloodWait cooldown expiration timestamp into ``flood_state.json``."""
    now = time.time() if now_ts is None else float(now_ts)
    wait_sec = max(1.0, float(seconds))
    until_ts = now + wait_sec
    state = load_flood_state(state_path)
    state[key] = {
        "until_ts": round(until_ts, 3),
        "until_iso": datetime.fromtimestamp(until_ts, tz=timezone.utc).replace(microsecond=0).isoformat(),
        "seconds": int(round(wait_sec)),
        "recorded_at": datetime.fromtimestamp(now, tz=timezone.utc).replace(microsecond=0).isoformat(),
        "reason": reason,
    }
    _save_flood_state(state_path, state)
    return until_ts


def clear_flood_wait(state_path: Path, key: str = "resolve_username") -> None:
    """Remove ``key`` cooldown from ``flood_state.json``."""
    state = load_flood_state(state_path)
    if key in state:
        del state[key]
        _save_flood_state(state_path, state)


# ---------------------------------------------------------------------------
# Telethon SQLiteSession with busy timeout + locked TelegramClient
# ---------------------------------------------------------------------------


def _make_locked_telegram_client(
    session_path: str,
    api_id: int,
    api_hash: str,
    proxy_cfg: dict[str, Any] | None,
    lock_path: Path,
    mode_label: str,
    use_lock: bool,
    sqlite_timeout: float,
) -> Any:
    from telethon import TelegramClient
    from telethon.sessions import SQLiteSession

    class TimeoutSQLiteSession(SQLiteSession):
        def __init__(self, session_id: str, timeout: float = DEFAULT_SQLITE_TIMEOUT) -> None:
            self._sqlite_timeout = float(timeout)
            super().__init__(session_id)

        def _cursor(self) -> sqlite3.Cursor:
            if self._conn is None:
                self._conn = sqlite3.connect(
                    self.filename,
                    timeout=self._sqlite_timeout,
                    check_same_thread=False,
                )
                self._conn.execute(f"PRAGMA busy_timeout = {int(self._sqlite_timeout * 1000)}")
            return self._conn.cursor()

    class LockedTelegramClient(TelegramClient):
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            self._session_lock = SessionFileLock(lock_path, mode_label=mode_label) if use_lock else None
            super().__init__(*args, **kwargs)
            if self._session_lock is not None:
                atexit.register(self._session_lock.release)

        async def connect(self) -> None:
            if self._session_lock is not None:
                self._session_lock.acquire()
            try:
                await super().connect()
            except Exception:
                if self._session_lock is not None:
                    self._session_lock.release()
                raise

        async def disconnect(self) -> None:
            try:
                await super().disconnect()
            finally:
                if self._session_lock is not None:
                    self._session_lock.release()

    session = TimeoutSQLiteSession(session_path, timeout=sqlite_timeout)
    return LockedTelegramClient(session, api_id, api_hash, proxy=proxy_cfg)


def build_telegram_client(
    base_dir: Path,
    mode_label: str,
    *,
    use_lock: bool = True,
    sqlite_timeout: float = DEFAULT_SQLITE_TIMEOUT,
    session_name_override: str | None = None,
    lock_filename_override: str | None = None,
    proxy_env_key: str = "TG_PROXY",
    api_id_env_key: str = "TG_API_ID",
    api_hash_env_key: str = "TG_API_HASH",
) -> Any:
    """Load credentials and optional proxy from ``.env`` and return a ``TelegramClient``.

    Configures SQLite ``timeout=30`` (``PRAGMA busy_timeout=30000``) and optionally
    guards concurrent monitor runs with ``tg_hunter.lock``.
    """
    load_dotenv(base_dir / ".env")
    api_id_raw = (os.getenv(api_id_env_key, "") or os.getenv("TG_API_ID", "")).strip()
    api_hash = (os.getenv(api_hash_env_key, "") or os.getenv("TG_API_HASH", "")).strip()
    session_name = (
        (session_name_override or "").strip()
        or os.getenv("TG_SESSION_NAME", "tg_hunter_session").strip()
        or "tg_hunter_session"
    )
    proxy_raw = (os.getenv(proxy_env_key, "") or os.getenv("TG_PROXY", "")).strip()

    if not api_id_raw or not api_hash:
        raise RuntimeError(f"TG_API_ID and TG_API_HASH must be set in .env for {mode_label}.")

    proxy_cfg = parse_proxy_url(proxy_raw)
    session_path = str(base_dir / session_name)
    lock_name = (lock_filename_override or "").strip() or DEFAULT_LOCK_FILENAME
    lock_path = base_dir / lock_name
    return _make_locked_telegram_client(
        session_path=session_path,
        api_id=int(api_id_raw),
        api_hash=api_hash,
        proxy_cfg=proxy_cfg,
        lock_path=lock_path,
        mode_label=mode_label,
        use_lock=use_lock,
        sqlite_timeout=sqlite_timeout,
    )


# ---------------------------------------------------------------------------
# Cached peer resolver (catalog -> session SQLite entities -> optional network)
# ---------------------------------------------------------------------------


def _normalize_bare_username(raw: str) -> str:
    cleaned = (raw or "").strip()
    for prefix in ("https://t.me/s/", "http://t.me/s/", "https://t.me/", "http://t.me/", "t.me/s/", "t.me/"):
        if cleaned.lower().startswith(prefix):
            cleaned = cleaned[len(prefix):]
            break
    return cleaned.lstrip("@").strip("/").split("?")[0].strip()


def _resolve_session_db_file(session_db_path: str | Path) -> Path | None:
    p = Path(session_db_path)
    if p.exists():
        return p
    if p.suffix != ".session":
        alt = Path(f"{p}.session")
        if alt.exists():
            return alt
    return None


def lookup_entity_in_session_db(
    session_db_path: str | Path,
    username: str,
    sqlite_timeout: float = DEFAULT_SQLITE_TIMEOUT,
) -> tuple[int, int | None, str] | None:
    """Look up ``(real_id, access_hash, peer_type_name)`` in Telethon's ``entities`` table."""
    db_file = _resolve_session_db_file(session_db_path)
    if db_file is None:
        return None
    uname = _normalize_bare_username(username).lower()
    if not uname:
        return None

    from telethon import utils

    conn: sqlite3.Connection | None = None
    try:
        conn = sqlite3.connect(str(db_file), timeout=sqlite_timeout)
        conn.execute(f"PRAGMA busy_timeout = {int(sqlite_timeout * 1000)}")
        row = conn.execute(
            "SELECT id, hash FROM entities WHERE lower(username) = ? LIMIT 1",
            (uname,),
        ).fetchone()
    except sqlite3.Error:
        return None
    finally:
        if conn is not None:
            conn.close()

    if not row:
        return None
    eid, access_hash = row[0], row[1]
    real_id, peer_type = utils.resolve_id(int(eid))
    return int(real_id), (int(access_hash) if access_hash is not None else None), peer_type.__name__


async def resolve_peer_cached(
    client: Any,
    session_db_path: str | Path,
    username: str,
    catalog_entry: dict[str, Any] | None = None,
    allow_network_resolve: bool = False,
    flood_state_path: str | Path | None = None,
) -> Any:
    """Resolve a Telegram peer without burning ``ResolveUsernameRequest`` unless explicitly allowed.

    Resolution order:
        1. ``catalog_entry['chat_id']`` + ``catalog_entry['access_hash']`` -> ``InputPeerChannel``.
        2. Local Telethon SQLite ``entities`` table in ``session_db_path`` (``utils.resolve_id``).
        3. Network ``ResolveUsernameRequest`` / ``get_input_entity`` ONLY when
           ``allow_network_resolve=True`` AND no ``resolve_username`` FloodWait cooldown is active
           in ``flood_state.json``. Any ``FloodWaitError`` is persisted to ``flood_state.json``.
    """
    from telethon import types
    from telethon.errors import FloodWaitError, RPCError

    uname = _normalize_bare_username(username)
    if not uname:
        return None

    # 1. Direct from catalog_entry
    if isinstance(catalog_entry, dict):
        cid = catalog_entry.get("chat_id")
        ahash = catalog_entry.get("access_hash")
        if cid is not None and ahash is not None:
            return types.InputPeerChannel(int(cid), int(ahash))

    # 2. Local SQLite entities cache
    cached = lookup_entity_in_session_db(session_db_path, uname)
    if cached is not None:
        real_id, ahash, peer_name = cached
        if peer_name == "PeerChannel" and ahash is not None:
            return types.InputPeerChannel(real_id, ahash)
        if peer_name == "PeerChat":
            return types.InputPeerChat(real_id)
        if peer_name == "PeerUser" and ahash is not None:
            return types.InputPeerUser(real_id, ahash)

    # 3. Optional guarded network resolution
    if not allow_network_resolve or client is None:
        return None

    state_path = (
        Path(flood_state_path)
        if flood_state_path is not None
        else Path(session_db_path).resolve().parent / DEFAULT_FLOOD_STATE_FILENAME
    )
    if get_flood_wait_remaining(state_path, key="resolve_username") > 0:
        return None

    try:
        return await client.get_input_entity(uname)
    except FloodWaitError as exc:
        record_flood_wait(
            state_path,
            seconds=getattr(exc, "seconds", 60),
            key="resolve_username",
            reason=f"FloodWaitError on @{uname}",
        )
        return None
    except (ValueError, RPCError):
        return None
