"""Stage 1: Cross-chat anti-duplicate, anti-spam, and ad-forward filter for tg_hunter."""

from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import json
import math
from pathlib import Path
import re
from typing import Any

BASE_DIR = Path(__file__).resolve().parent
DEFAULT_DEDUP_STATE_PATH = BASE_DIR / "dedup_state.json"

_URL_RE = re.compile(r"(?:https?://\S+|t\.me/\S+|tg://\S+)", re.I)
_MENTION_RE = re.compile(r"@[a-zA-Z0-9_]{3,}")
_NON_WORD_RE = re.compile(r"[^\w\s]+", re.UNICODE)
_WHITESPACE_RE = re.compile(r"\s+")

# Bot moderation / verification prompts and explicit ad markers in forwards
_BOT_SERVICE_RE = re.compile(
    r"(?:🔖\s*ads:\s*бот\s+создан\s+в|"
    r"нажмите\s+кнопку\s+ниже\s+в\s+течение\s+\d+\s+мин|"
    r"нажмите\s+кнопку\s+[«\"']я\s+не\s+бот[»\"']|"
    r"чтобы\s+(?:иметь\s+возможность\s+)?писать\s+в\s+(?:группе|чате),?\s*(?:пожалуйста,?\s*)?(?:подпишитесь|пройдите\s+верификац|нажмите)|"
    r"сообщение\s+удалено\s*👮|"
    r"профессиональный\s+бот-помощник\s+для\s+модерации\s+групп|"
    r"@chatkeeperbot)",
    re.I,
)

_AD_FORWARD_RE = re.compile(
    r"(?:\berid\s*:|\butm_source=|\bреклам[аы]\b|\bпромокод\w*\b|\bскидк[аи]\s+\d+%|"
    r"перейти\s+в\s+магазин|скачать\s+гайд|бесплатный\s+(?:вебинар|гайд|урок|интенсив)|"
    r"подписывай(?:тесь|ся)\s+на\s+(?:наш\s+)?канал|@[\w]+bot\b)",
    re.I,
)

_PAYWALL_BOT_LINK_RE = re.compile(
    r"(?:freelance_find_bot|freelance_flowbot|leadradar|botsbaseru|"
    r"weekfreelance_bot|wflmanager_bot|search_leads_bot|freelancerai_bot)",
    re.I,
)
_PAYWALL_PLATFORM_RE = re.compile(
    r"(?:kwork\.ru|fl\.ru|youdo\.com|profi\.ru|work-zilla\.com|workzilla\.com|"
    r"freelance\.ru|freelancehunt\.com|freelance\.habr\.com|upwork\.com|fiverr\.com)",
    re.I,
)
_DIRECT_CONTACT_LINK_RE = re.compile(
    r"(?:tg://user\?id=\d+)",
    re.I,
)
_FOOTER_SEPARATOR_RE = re.compile(
    r"(?:^|\r?\n)\s*(?:━{3,}|〰{2,}|—{3,}|={3,}|─{3,})\s*(?:\r?\n|$)"
)
_REFERRAL_FOOTER_LINE_RE = re.compile(
    r"(?:прив[её]л\s+клиента|со\s+всех\s+его\s+оплат|работа\s*[—\-–]\s*мне|"
    r"тебе\s+\d+%\s+с(?:о\s+всех)?|реферальн\w*\s+(?:ссылк|программ|бонус)|"
    r"заберите\s+этот\s+заказ\s+раньше\s+всех|по\s+вопросам\s+рекламы|"
    r"купить\s+рекламу|разместить\s+рекламу)",
    re.I,
)
_AT_USERNAME_EXACT_RE = re.compile(r"^@[A-Za-z][A-Za-z0-9_]{3,31}$")
_TME_USER_LINK_RE = re.compile(
    r"(?:https?://)?(?:t\.me|telegram\.me)/([A-Za-z][A-Za-z0-9_]{3,31})(?:/|\b|\?)",
    re.I,
)
_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_PHONE_RE = re.compile(r"\+\d[\d\s\-()]{7,}\d")


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_ts(ts: datetime | str | None) -> datetime:
    if ts is None:
        return _utc_now()
    if isinstance(ts, datetime):
        return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)
    try:
        dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return _utc_now()


def normalize_for_dedup(text: str) -> str:
    """Normalize text for stable cross-chat hashing and shingling."""
    if not text:
        return ""
    cleaned = text.lower().replace("ё", "е")
    cleaned = _URL_RE.sub(" ", cleaned)
    cleaned = _MENTION_RE.sub(" ", cleaned)
    cleaned = cleaned.replace("_", " ")
    cleaned = _NON_WORD_RE.sub(" ", cleaned)
    cleaned = _WHITESPACE_RE.sub(" ", cleaned).strip()
    return cleaned


def exact_hash(text: str) -> str:
    """Return SHA-256 hex digest of normalized message text."""
    norm = normalize_for_dedup(text)
    return hashlib.sha256(norm.encode("utf-8")).hexdigest()


def _shingles_from_norm(norm: str, word_n: int = 4, char_n: int = 5) -> set[str]:
    if not norm:
        return set()

    shingles: set[str] = set()
    words = norm.split()
    if len(words) >= word_n:
        for i in range(len(words) - word_n + 1):
            shingles.add("w:" + " ".join(words[i : i + word_n]))
    elif words:
        for word in words:
            shingles.add("w1:" + word)

    compact = norm.replace(" ", "")
    if len(compact) >= char_n:
        for i in range(len(compact) - char_n + 1):
            shingles.add("c:" + compact[i : i + char_n])
    elif compact:
        shingles.add("c0:" + compact)

    return shingles


def compute_shingles(text: str, word_n: int = 4, char_n: int = 5) -> set[str]:
    """Compute hybrid 4-word and 5-char shingles for fuzzy matching."""
    return _shingles_from_norm(normalize_for_dedup(text), word_n=word_n, char_n=char_n)


def jaccard_similarity(a: set[str], b: set[str]) -> float:
    """Compute Jaccard similarity between two shingle sets."""
    if not a or not b:
        return 0.0
    inter = len(a & b)
    if inter == 0:
        return 0.0
    return inter / (len(a) + len(b) - inter)


def strip_promo_footer(text: str) -> tuple[str, str]:
    """Split off promo/referral footers after divider lines or affiliate tail lines."""
    raw = text or ""
    if not raw:
        return "", ""

    footer_parts: list[str] = []
    body = raw
    sep_match = _FOOTER_SEPARATOR_RE.search(raw)
    if sep_match:
        body = raw[: sep_match.start()]
        footer_parts.append(raw[sep_match.start() :])

    clean_lines: list[str] = []
    for line in body.splitlines():
        if _REFERRAL_FOOTER_LINE_RE.search(line):
            footer_parts.append(line)
        else:
            clean_lines.append(line)

    return "\n".join(clean_lines).strip(), "\n".join(footer_parts).strip()


def _extract_handles_from_text(text: str) -> set[str]:
    handles: set[str] = set()
    for m in _MENTION_RE.findall(text or ""):
        uname = m.lstrip("@").lower()
        if uname:
            handles.add(uname)
    for m in _TME_USER_LINK_RE.findall(text or ""):
        uname = m.lower()
        if uname:
            handles.add(uname)
    return handles


def _is_channel_sender(sender_id: str | int | None, source_type: str = "") -> bool:
    if str(source_type or "").strip().lower() == "channel":
        return True
    if sender_id is None:
        return False
    sid_str = str(sender_id).strip()
    if not sid_str or sid_str in ("0", "None"):
        return False
    if sid_str.startswith("-"):
        return True
    if sid_str.isdigit():
        return False
    if _AT_USERNAME_EXACT_RE.match(sid_str):
        return False
    # Non-numeric textual channel/feed name (e.g. web preview author)
    return True


def _has_free_direct_contact(
    text: str,
    *,
    extracted_links: list[str] | None = None,
    channel: str = "",
) -> bool:
    """Return True if message contains a direct free client contact (non-bot handle or tg://user)."""
    ch_clean = str(channel or "").strip().lstrip("@").lower()
    links_list = [str(x).strip() for x in (extracted_links or []) if str(x).strip()]
    raw_joined_links = " ".join(links_list)
    raw_combined = f"{text or ''} {raw_joined_links}"

    if _PAYWALL_PLATFORM_RE.search(raw_combined) or _PAYWALL_BOT_LINK_RE.search(raw_combined):
        return False

    clean_body, stripped_footer = strip_promo_footer(text or "")
    footer_only_handles = _extract_handles_from_text(stripped_footer) - _extract_handles_from_text(clean_body)

    filtered_links: list[str] = []
    for link in links_list:
        link_handles = _extract_handles_from_text(link)
        if link_handles and link_handles.issubset(footer_only_handles):
            continue
        filtered_links.append(link)

    joined_links = " ".join(filtered_links)
    combined = f"{clean_body} {joined_links}"

    if _DIRECT_CONTACT_LINK_RE.search(combined):
        return True
    if _EMAIL_RE.search(clean_body) or _PHONE_RE.search(clean_body):
        return True

    for m in _MENTION_RE.findall(combined):
        uname = m.lstrip("@").lower()
        if uname and uname != ch_clean and uname not in footer_only_handles and not uname.endswith("bot"):
            return True

    reserved = {"s", "c", "joinchat", "addstickers", "addemoji", "iv", "proxy", "socks", "share"}
    for m in _TME_USER_LINK_RE.findall(combined):
        uname = m.lower()
        if (
            uname
            and uname != ch_clean
            and uname not in reserved
            and uname not in footer_only_handles
            and not uname.endswith("bot")
        ):
            return True

    return False


def is_ad_or_service_message(
    text: str,
    *,
    via_bot: bool = False,
    fwd: bool = False,
    has_buttons: bool = False,
    extracted_links: list[str] | None = None,
    sender_id: str | int | None = None,
    channel: str = "",
    source_type: str = "",
) -> tuple[bool, str]:
    """Detect inline-bot messages, group-moderation bot prompts, paywall exchanges/bots, and ad forwards."""
    if via_bot:
        return True, "via_bot"
    if _BOT_SERVICE_RE.search(text or ""):
        return True, "bot_service_message"

    joined_links = " ".join(str(x).strip() for x in (extracted_links or []) if str(x).strip())
    combined_raw = f"{text or ''} {joined_links}"

    if _PAYWALL_PLATFORM_RE.search(combined_raw):
        return True, "paywall_platform"
    if _PAYWALL_BOT_LINK_RE.search(combined_raw):
        return True, "paywall_aggregator"

    is_channel_post = _is_channel_sender(sender_id, source_type=source_type)
    has_free_contact = _has_free_direct_contact(
        text, extracted_links=extracted_links, channel=channel
    )

    if has_buttons and not has_free_contact:
        if re.search(r"(?:t\.me/|@)[A-Za-z0-9_]+bot\b", combined_raw, re.I):
            return True, "paywall_aggregator"

    if is_channel_post and not has_free_contact:
        # Channel posts without any direct client @handle require paying an aggregator bot or have no contact
        if has_buttons or re.search(r"(?:t\.me/|@)[A-Za-z0-9_]+bot\b", combined_raw, re.I):
            return True, "paywall_aggregator"
        return True, "channel_no_contact"

    if fwd:
        if _AD_FORWARD_RE.search(text or ""):
            return True, "ad_forward"
        if has_buttons and len((text or "").strip()) >= 80:
            return True, "ad_forward_buttons"
    return False, ""


@dataclass(frozen=True)
class DedupDecision:
    """Outcome of Stage 1 deduplication & anti-spam filtering."""

    rejected: bool
    is_duplicate: bool
    reason: str
    text_hash: str
    similarity: float = 0.0
    matched_chat: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class DedupFilter:
    """Rolling-window cross-chat duplicate & cross-chat spammer filter."""

    def __init__(
        self,
        state_path: Path | None = DEFAULT_DEDUP_STATE_PATH,
        *,
        ttl_hours: float = 48.0,
        similarity_threshold: float = 0.72,
        spammer_chat_threshold: int = 2,
        spammer_window_hours: float = 24.0,
        max_records: int = 5000,
    ) -> None:
        self.state_path = state_path
        self.ttl_hours = float(ttl_hours)
        self.similarity_threshold = float(similarity_threshold)
        self.spammer_chat_threshold = int(spammer_chat_threshold)
        self.spammer_window_hours = float(spammer_window_hours)
        self.max_records = int(max_records)

        # Persisted records: [{"hash": str, "chat": str, "ts": str, "norm": str, "sender_id": str|None}]
        self._messages: list[dict[str, Any]] = []
        self._hash_index: dict[str, dict[str, Any]] = {}
        self._shingle_sets: dict[str, set[str]] = {}
        self._shingle_index: dict[str, set[str]] = defaultdict(set)
        self._senders: dict[str, list[dict[str, str]]] = {}
        self._flagged_spammers: dict[str, str] = {}

        if self.state_path is not None and self.state_path.exists():
            self.load()

    def _index_record(self, rec: dict[str, Any], shingles: set[str] | None = None) -> None:
        t_hash = rec["hash"]
        self._hash_index[t_hash] = rec
        if shingles is None:
            norm = rec.get("norm", "")
            shingles = _shingles_from_norm(norm) if norm else set(rec.get("shingles", ()))
        self._shingle_sets[t_hash] = shingles
        for sh in shingles:
            self._shingle_index[sh].add(t_hash)

    def _unindex_hash(self, t_hash: str) -> None:
        self._hash_index.pop(t_hash, None)
        shingles = self._shingle_sets.pop(t_hash, set())
        for sh in shingles:
            bucket = self._shingle_index.get(sh)
            if bucket is not None:
                bucket.discard(t_hash)
                if not bucket:
                    del self._shingle_index[sh]

    def load(self) -> None:
        """Load persisted rolling-window state from JSON."""
        if self.state_path is None or not self.state_path.exists():
            return
        try:
            raw = json.loads(self.state_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return
        if not isinstance(raw, dict):
            return

        self._messages = [m for m in raw.get("messages", []) if isinstance(m, dict) and "hash" in m]
        self._hash_index.clear()
        self._shingle_sets.clear()
        self._shingle_index.clear()
        for rec in self._messages:
            self._index_record(rec)

        self._senders = dict(raw.get("senders", {}))
        self._flagged_spammers = dict(raw.get("flagged_spammers", {}))
        self.prune()

    def save(self) -> Path | None:
        """Persist current dedup state to JSON atomically with low memory overhead."""
        if self.state_path is None:
            return None
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = self.state_path.with_suffix(".json.tmp")
        msgs = self._messages[-self.max_records :]
        for attempt in range(2):
            payload = {
                "updated_at": _utc_now().replace(microsecond=0).isoformat(),
                "messages": msgs,
                "senders": self._senders,
                "flagged_spammers": self._flagged_spammers,
            }
            try:
                with tmp_path.open("w", encoding="utf-8") as fh:
                    json.dump(payload, fh, ensure_ascii=False)
                tmp_path.replace(self.state_path)
                return self.state_path
            except MemoryError:
                tmp_path.unlink(missing_ok=True)
                msgs = msgs[len(msgs) // 2 :]
                self._messages = msgs
                if attempt == 1:
                    return None
        return None

    def prune(self, now: datetime | None = None) -> None:
        """Drop entries older than ``ttl_hours`` / ``spammer_window_hours``."""
        ref = now or _utc_now()
        msg_cutoff = ref - timedelta(hours=self.ttl_hours)
        spam_cutoff = ref - timedelta(hours=self.spammer_window_hours)

        kept_msgs: list[dict[str, Any]] = []
        for rec in self._messages:
            if _parse_ts(rec.get("ts")) >= msg_cutoff:
                kept_msgs.append(rec)
            else:
                self._unindex_hash(rec["hash"])

        if len(kept_msgs) > self.max_records:
            overflow = kept_msgs[: len(kept_msgs) - self.max_records]
            for rec in overflow:
                self._unindex_hash(rec["hash"])
            kept_msgs = kept_msgs[-self.max_records :]
        self._messages = kept_msgs

        new_senders: dict[str, list[dict[str, str]]] = {}
        for sid, events in self._senders.items():
            fresh = [ev for ev in events if _parse_ts(ev.get("ts")) >= spam_cutoff]
            if fresh:
                new_senders[sid] = fresh
        self._senders = new_senders

        self._flagged_spammers = {
            sid: ts for sid, ts in self._flagged_spammers.items() if _parse_ts(ts) >= spam_cutoff
        }

    def _record_sender_event(
        self,
        sender_key: str,
        chat_key: str,
        ts_iso: str,
        text_hash: str,
        shingles: set[str],
    ) -> tuple[bool, str]:
        """Track sender across chats and detect cross-chat spammers."""
        if sender_key in self._flagged_spammers:
            return True, "cross_chat_spammer"

        events = self._senders.setdefault(sender_key, [])
        events.append({"chat": chat_key, "ts": ts_iso, "hash": text_hash})
        if len(events) > 50:
            events[:] = events[-50:]

        distinct_chats = {ev["chat"] for ev in events}
        if len(distinct_chats) < self.spammer_chat_threshold:
            return False, ""

        other_hashes = {ev["hash"] for ev in events[:-1] if ev["chat"] != chat_key}
        if text_hash in other_hashes:
            self._flagged_spammers[sender_key] = ts_iso
            return True, "cross_chat_spammer"

        for oh in other_hashes:
            prev_shingles = self._shingle_sets.get(oh)
            if prev_shingles and jaccard_similarity(shingles, prev_shingles) >= 0.40:
                self._flagged_spammers[sender_key] = ts_iso
                return True, "cross_chat_spammer"

        if len(distinct_chats) >= max(3, self.spammer_chat_threshold + 1):
            self._flagged_spammers[sender_key] = ts_iso
            return True, "cross_chat_spammer"

        return False, ""

    def _find_fuzzy_match(self, shingles: set[str]) -> tuple[float, str]:
        """Find best fuzzy match >= similarity_threshold using exact inverted-index pruning."""
        if len(shingles) < 4:
            return 0.0, ""

        t = self.similarity_threshold
        min_overlap = max(1, math.ceil((t / (1.0 + t)) * len(shingles)))
        overlap_counts: Counter[str] = Counter()
        for sh in shingles:
            for h in self._shingle_index.get(sh, ()):
                overlap_counts[h] += 1

        best_sim = 0.0
        best_chat = ""
        for h, inter in overlap_counts.items():
            if inter < min_overlap:
                continue
            cand_shingles = self._shingle_sets.get(h)
            if not cand_shingles:
                continue
            union_size = len(shingles) + len(cand_shingles) - inter
            if union_size <= 0:
                continue
            sim = inter / union_size
            if sim > best_sim:
                best_sim = sim
                best_chat = str(self._hash_index[h].get("chat", ""))
            if sim >= t:
                return sim, best_chat
        return best_sim, best_chat

    def check_and_record(
        self,
        text: str,
        chat_id: str | int,
        *,
        sender_id: str | int | None = None,
        via_bot: bool = False,
        fwd: bool = False,
        has_buttons: bool = False,
        extracted_links: list[str] | None = None,
        timestamp: datetime | str | None = None,
        source_type: str = "",
    ) -> DedupDecision:
        """Check if message is duplicate/spam/bot-ad and record it into the rolling window."""
        now_dt = _parse_ts(timestamp)
        ts_iso = now_dt.replace(microsecond=0).isoformat()
        chat_key = str(chat_id)
        norm = normalize_for_dedup(text)
        t_hash = hashlib.sha256(norm.encode("utf-8")).hexdigest()

        is_bad_src, bad_reason = is_ad_or_service_message(
            text,
            via_bot=via_bot,
            fwd=fwd,
            has_buttons=has_buttons,
            extracted_links=extracted_links,
            sender_id=sender_id,
            channel=chat_key,
            source_type=source_type,
        )
        if is_bad_src:
            return DedupDecision(
                rejected=True,
                is_duplicate=False,
                reason=bad_reason,
                text_hash=t_hash,
            )

        if len(norm) < 12:
            return DedupDecision(
                rejected=False,
                is_duplicate=False,
                reason="short_untracked",
                text_hash=t_hash,
            )

        self.prune(now_dt)
        shingles = _shingles_from_norm(norm)

        if sender_id is not None and str(sender_id).strip() not in ("", "0", "None"):
            is_spammer, spam_reason = self._record_sender_event(
                str(sender_id), chat_key, ts_iso, t_hash, shingles
            )
            if is_spammer:
                return DedupDecision(
                    rejected=True,
                    is_duplicate=True,
                    reason=spam_reason,
                    text_hash=t_hash,
                    similarity=1.0,
                )

        existing = self._hash_index.get(t_hash)
        if existing is not None:
            return DedupDecision(
                rejected=True,
                is_duplicate=True,
                reason="duplicate_exact",
                text_hash=t_hash,
                similarity=1.0,
                matched_chat=str(existing.get("chat", "")),
            )

        best_sim, best_chat = self._find_fuzzy_match(shingles)
        if best_sim >= self.similarity_threshold:
            return DedupDecision(
                rejected=True,
                is_duplicate=True,
                reason="duplicate_fuzzy",
                text_hash=t_hash,
                similarity=round(best_sim, 3),
                matched_chat=best_chat,
            )

        record = {
            "hash": t_hash,
            "chat": chat_key,
            "ts": ts_iso,
            "norm": norm,
            "sender_id": str(sender_id) if sender_id is not None else None,
        }
        self._messages.append(record)
        self._index_record(record, shingles=shingles)

        return DedupDecision(
            rejected=False,
            is_duplicate=False,
            reason="unique",
            text_hash=t_hash,
            similarity=round(best_sim, 3),
        )
