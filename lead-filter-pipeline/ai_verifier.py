"""Stage 3: Async Gemini Flash REST AI-verifier & Saved Messages packager."""

from __future__ import annotations

import asyncio
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import time
from typing import Any, Callable, Literal

from dotenv import load_dotenv
import httpx

try:
    from .classifier import ClassificationResult
    from .dedup import normalize_for_dedup
except ImportError:
    from classifier import ClassificationResult
    from dedup import normalize_for_dedup

BASE_DIR = Path(__file__).resolve().parent
DEFAULT_AI_CACHE_PATH = BASE_DIR / "ai_cache.json"
DEFAULT_GEMINI_MODEL = "gemini-3-flash-preview"
FALLBACK_GEMINI_MODEL = "gemini-3.8-flash,gemini-3.5-flash,gemini-flash-latest"
GEMINI_ENDPOINT_TEMPLATE = (
    "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
)

VerdictType = Literal["HOT_LEAD", "WARM_LEAD", "REJECT", "SKIPPED"]

_FORBIDDEN_REPLY_RE = re.compile(r"(?:витрин[а-яё]*|демо[- ]?бот[а-яё]*|demo[- ]?bot\w*)", re.I)

_SYSTEM_PROMPT = """Ты — строгий верификатор фриланс-лидов из Telegram-чатов для Python-разработчика (Telegram-боты на aiogram/Telethon, парсеры, скрипты автоматизации, ИИ-ассистенты; опционально монтаж Shorts/Reels).

Твоя задача — отделить РЕАЛЬНОГО ПОКУПАТЕЛЯ (заказчика, которому нужно решение) от любого шума.

Классифицируй сообщение строго по ролям:
- BUYER_HOT -> verdict="HOT_LEAD": человек или компания прямо сейчас ищет исполнителя/разработчика, ставит задачу, хочет заказать бота, парсер, скрипт, автоматизацию, ИИ-бота или монтаж.
- BUYER_WARM -> verdict="WARM_LEAD": потенциальный клиент спрашивает «кто разбирается / кто шарит / сколько стоит сделать бота / можно ли автоматизировать...» (ещё не оформил ТЗ, но есть коммерческий интерес).
- EXECUTOR_CASE -> verdict="REJECT": портфолио, кейс, разбор «Проект: ... Задача: ... Решение: ... Стек: ...», отчёт исполнителя «Собрал рабочего бота...».
- EXECUTOR_PROMO -> verdict="REJECT": самореклама разработчика/агентства/монтажёра, резюме, «сделаю под ключ», «мои услуги».
- HR_VACANCY -> verdict="REJECT": штатная вакансия (full-time, офис, оклад, outstaff, испытательный срок), мультивакансия рекрутера, набор в команду/агентство.
- SELLER_PRODUCT -> verdict="REJECT": продажа готового скрипта/бота/шаблона/курса/подписки/сервиса.
- CODER_QUESTION -> verdict="REJECT": разработчик спрашивает коллег про ошибки, Traceback, aiogram/telethon, библиотеки, хостинг, где искать заказы.
- AGGREGATOR -> verdict="REJECT": бот-агрегатор со скрытым контактом («контакт скрыт», «в LeadRadar», «заберите заказ в боте»).
- SPAM_OFFTOPIC -> verdict="REJECT": оффтоп, 1C-бухгалтерия, CAD/Revit/LoRA/генерация картинок без Telegram-бота, WhatsApp-only без Telegram, казино, арбитраж трафика, прочий нерелевант.

Верни СТРОГО JSON с полями:
{
  "verdict": "HOT_LEAD" | "WARM_LEAD" | "REJECT",
  "confidence": <целое 0..100>,
  "speaker_role": "<одна из ролей выше>",
  "reason": "<кратко 1 фраза на русском почему>",
  "task_summary": "<суть задачи клиента в 1 коротком предложении, до 120 символов>",
  "suggested_reply": "<короткий живой человеческий отклик 2-3 предложения на языке клиента, простыми словами без IT-жаргона и без домыслов, чтобы понял человек не из IT. Предложи сначала сделать легкий пробный вариант и показать в работе, а если все устроит, сделать полный проект после оплаты. СТРОГО ЗАПРЕЩЕНО: слова 'витрина', 'демо-бот', восклицательные знаки (!), длинные тире (—/–), эмодзи и спецсимволы. Если REJECT — пустая строка>"
}"""


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_ts(ts: str | None) -> datetime | None:
    if not ts:
        return None
    try:
        dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


_SPECIAL_DECOR_RE = re.compile(r"[•⚠️✅🔥🥇👉📌💳⚡🤖💻🚀✨🎉🙌👋🙏]+")


def _sanitize_reply(reply: str, fallback: str = "") -> str:
    """Enforce Rule #13 & Rule #16: no 'витрина'/'демо-бот', no '!', no long dashes, no special symbols."""
    cleaned = (reply or "").strip()
    if not cleaned:
        cleaned = fallback
    if _FORBIDDEN_REPLY_RE.search(cleaned):
        # Replace forbidden phrases cleanly or fall back to verified safe reply
        cleaned = re.sub(r"демо[- ]?бот[а-яё]*", "легкий пробный вариант", cleaned, flags=re.I)
        cleaned = re.sub(r"demo[- ]?bot\w*", "light test version", cleaned, flags=re.I)
        if re.search(r"витрин[а-яё]*", cleaned, re.I):
            cleaned = fallback or re.sub(r"витрин[а-яё]*", "рабочий вариант", cleaned, flags=re.I)
    cleaned = cleaned.replace("!", ".").replace("—", "-").replace("–", "-")
    cleaned = _SPECIAL_DECOR_RE.sub("", cleaned)
    cleaned = re.sub(r"\.\.+", ".", cleaned)
    cleaned = re.sub(r"\s{2,}", " ", cleaned).strip()
    return cleaned


def _resolve_httpx_proxy(proxy_url: str | None) -> str | None:
    raw = (proxy_url or "").strip()
    if not raw:
        return None
    lower = raw.lower()
    if lower.startswith(("http://", "https://")):
        return raw
    if lower.startswith("socks"):
        # httpx requires socksio for SOCKS proxies; skip gracefully if not installed
        if importlib.util.find_spec("socksio") is not None:
            return raw
        return None
    return None


def _extract_json_payload(raw_text: str) -> dict[str, Any]:
    text = (raw_text or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.S).strip()
    return json.loads(text)


@dataclass(frozen=True)
class VerificationResult:
    """Structured output of Stage 3 Gemini Flash AI verification."""

    enabled: bool
    verdict: VerdictType
    confidence: int
    speaker_role: str
    reason: str
    task_summary: str
    suggested_reply: str
    model_used: str = ""
    cached: bool = False
    error: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class GeminiLeadVerifier:
    """Async Gemini Flash REST verifier with disk cache, rate limit, retry & model fallback."""

    def __init__(
        self,
        *,
        api_key: str | None = None,
        model: str | None = None,
        fallback_model: str = FALLBACK_GEMINI_MODEL,
        proxy_url: str | None = None,
        cache_path: Path | None = DEFAULT_AI_CACHE_PATH,
        cache_ttl_hours: float = 72.0,
        max_cache_entries: int = 2000,
        min_interval_sec: float = 0.4,
        max_requests_per_run: int = 30,
        timeout_sec: float = 25.0,
        max_retries: int = 2,
        base_dir: Path = BASE_DIR,
        client_factory: Callable[[], httpx.AsyncClient] | None = None,
    ) -> None:
        env_path = base_dir / ".env"
        if env_path.exists():
            load_dotenv(env_path)

        resolved_key = api_key if api_key is not None else os.getenv("GEMINI_API_KEY", "")
        self.api_key = (resolved_key or "").strip()
        self.enabled = bool(self.api_key)

        env_model = os.getenv("GEMINI_MODEL", "").strip()
        self.model = (model or env_model or DEFAULT_GEMINI_MODEL).strip()
        self.fallback_model = fallback_model.strip()

        raw_proxy = (
            proxy_url
            if proxy_url is not None
            else (os.getenv("AI_PROXY", "").strip() or os.getenv("TG_PROXY", "").strip())
        )
        self.proxy_url = _resolve_httpx_proxy(raw_proxy)

        self.cache_path = cache_path
        self.cache_ttl_hours = float(cache_ttl_hours)
        self.max_cache_entries = int(max_cache_entries)
        self.min_interval_sec = float(min_interval_sec)
        self.max_requests_per_run = int(max_requests_per_run)
        self.timeout_sec = float(timeout_sec)
        self.max_retries = int(max_retries)
        self._client_factory = client_factory

        self._cache: dict[str, dict[str, Any]] = {}
        self._requests_made = 0
        self._last_request_monotonic = 0.0
        self._rate_lock = asyncio.Lock()

        if self.cache_path is not None and self.cache_path.exists():
            self._load_cache()

    def _load_cache(self) -> None:
        if self.cache_path is None or not self.cache_path.exists():
            return
        try:
            raw = json.loads(self.cache_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return
        if not isinstance(raw, dict):
            return
        entries = raw.get("entries", raw)
        if not isinstance(entries, dict):
            return
        cutoff = _utc_now() - timedelta(hours=self.cache_ttl_hours)
        fresh: dict[str, dict[str, Any]] = {}
        for k, v in entries.items():
            if not isinstance(v, dict):
                continue
            dt = _parse_ts(v.get("ts"))
            if dt is None or dt >= cutoff:
                fresh[k] = v
        self._cache = fresh

    def save_cache(self) -> Path | None:
        """Persist verification cache to JSON."""
        if self.cache_path is None:
            return None
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        # Keep most recent entries within max_cache_entries
        items = list(self._cache.items())[-self.max_cache_entries :]
        self._cache = dict(items)
        payload = {
            "updated_at": _utc_now().replace(microsecond=0).isoformat(),
            "entries": self._cache,
        }
        self.cache_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        return self.cache_path

    def _cache_key(self, text: str) -> str:
        norm = normalize_for_dedup(text)
        return hashlib.sha256(norm.encode("utf-8")).hexdigest()

    def _build_client(self) -> httpx.AsyncClient:
        if self._client_factory is not None:
            return self._client_factory()
        kwargs: dict[str, Any] = {"timeout": self.timeout_sec}
        if self.proxy_url:
            kwargs["proxy"] = self.proxy_url
        return httpx.AsyncClient(**kwargs)

    async def _respect_rate_limit(self) -> None:
        async with self._rate_lock:
            now = time.monotonic()
            elapsed = now - self._last_request_monotonic
            if self._last_request_monotonic > 0 and elapsed < self.min_interval_sec:
                await asyncio.sleep(self.min_interval_sec - elapsed)
            self._last_request_monotonic = time.monotonic()

    async def _call_gemini(self, client: httpx.AsyncClient, model_name: str, text: str, channel: str) -> dict[str, Any]:
        url = f"{GEMINI_ENDPOINT_TEMPLATE.format(model=model_name)}?key={self.api_key}"
        user_msg = f"Чат/канал: {channel or 'unknown'}\nСообщение:\n{text.strip()[:3500]}"
        payload = {
            "systemInstruction": {"parts": [{"text": _SYSTEM_PROMPT}]},
            "contents": [{"role": "user", "parts": [{"text": user_msg}]}],
            "generationConfig": {
                "responseMimeType": "application/json",
                "temperature": 0.1,
                "maxOutputTokens": 450,
                "thinkingConfig": {"thinkingBudget": 0},
            },
        }
        resp = await client.post(url, json=payload)
        resp.raise_for_status()
        body = resp.json()
        candidates = body.get("candidates") or []
        if not candidates:
            raise ValueError("Gemini returned empty candidates")
        parts = candidates[0].get("content", {}).get("parts", [])
        raw_json_text = "".join(str(p.get("text", "")) for p in parts)
        return _extract_json_payload(raw_json_text)

    async def verify(
        self,
        text: str,
        *,
        channel: str = "",
        stage2_result: ClassificationResult | None = None,
    ) -> VerificationResult:
        """Verify a candidate message via Gemini Flash REST API (with cache & fallback)."""
        fallback_reply = stage2_result.suggested_reply if stage2_result else ""
        fallback_summary = stage2_result.task_summary if stage2_result else ""

        if not self.enabled:
            return VerificationResult(
                enabled=False,
                verdict="SKIPPED",
                confidence=stage2_result.score if stage2_result else 0,
                speaker_role=stage2_result.speaker_role if stage2_result else "",
                reason="GEMINI_API_KEY не задан — оставлен вердикт Ступени 2",
                task_summary=fallback_summary,
                suggested_reply=_sanitize_reply(fallback_reply),
            )

        key = self._cache_key(text)
        cached = self._cache.get(key)
        if cached is not None:
            cutoff = _utc_now() - timedelta(hours=self.cache_ttl_hours)
            dt = _parse_ts(cached.get("ts"))
            if dt is None or dt >= cutoff:
                return VerificationResult(
                    enabled=True,
                    verdict=cached["verdict"],
                    confidence=int(cached["confidence"]),
                    speaker_role=str(cached.get("speaker_role", "")),
                    reason=str(cached.get("reason", "")),
                    task_summary=str(cached.get("task_summary", "")) or fallback_summary,
                    suggested_reply=_sanitize_reply(str(cached.get("suggested_reply", "")), fallback_reply),
                    model_used=str(cached.get("model_used", self.model)),
                    cached=True,
                )

        if self._requests_made >= self.max_requests_per_run:
            return VerificationResult(
                enabled=True,
                verdict="SKIPPED",
                confidence=stage2_result.score if stage2_result else 0,
                speaker_role=stage2_result.speaker_role if stage2_result else "",
                reason="достигнут лимит AI-запросов за запуск",
                task_summary=fallback_summary,
                suggested_reply=_sanitize_reply(fallback_reply),
                error="rate_budget_exhausted",
            )

        models_to_try: list[str] = [self.model]
        for fb in self.fallback_model.split(","):
            fb_clean = fb.strip()
            if fb_clean and fb_clean not in models_to_try:
                models_to_try.append(fb_clean)

        last_err = ""
        async with self._build_client() as client:
            for model_name in models_to_try:
                for attempt in range(self.max_retries + 1):
                    try:
                        await self._respect_rate_limit()
                        self._requests_made += 1
                        data = await self._call_gemini(client, model_name, text, channel)

                        verdict_raw = str(data.get("verdict", "REJECT")).upper().strip()
                        if verdict_raw not in ("HOT_LEAD", "WARM_LEAD", "REJECT"):
                            verdict_raw = "REJECT"
                        verdict: VerdictType = verdict_raw  # type: ignore[assignment]

                        conf_raw = data.get("confidence", 0)
                        try:
                            confidence = max(0, min(100, int(round(float(conf_raw)))))
                        except (TypeError, ValueError):
                            confidence = 0

                        role = str(data.get("speaker_role", "")).strip() or "UNKNOWN"
                        reason = str(data.get("reason", "")).strip()
                        summary = str(data.get("task_summary", "")).strip() or fallback_summary
                        raw_reply = str(data.get("suggested_reply", "")).strip()
                        safe_reply = "" if verdict == "REJECT" else _sanitize_reply(raw_reply, fallback_reply)

                        self._cache[key] = {
                            "ts": _utc_now().replace(microsecond=0).isoformat(),
                            "verdict": verdict,
                            "confidence": confidence,
                            "speaker_role": role,
                            "reason": reason,
                            "task_summary": summary,
                            "suggested_reply": safe_reply,
                            "model_used": model_name,
                        }
                        if self.cache_path is not None:
                            self.save_cache()

                        return VerificationResult(
                            enabled=True,
                            verdict=verdict,
                            confidence=confidence,
                            speaker_role=role,
                            reason=reason,
                            task_summary=summary,
                            suggested_reply=safe_reply,
                            model_used=model_name,
                            cached=False,
                        )
                    except httpx.HTTPStatusError as exc:
                        status = exc.response.status_code
                        last_err = f"HTTP {status} ({model_name})"
                        if status == 404:
                            # Model unavailable -> immediately try fallback model
                            break
                        if status == 429:
                            body_low = (exc.response.text or "").lower()
                            if "quota" in body_low or "exceeded" in body_low:
                                # Model quota exhausted -> switch to next fallback model immediately
                                break
                            if attempt < self.max_retries:
                                await asyncio.sleep(0.8 * (2**attempt))
                                continue
                            break
                        if status in (500, 502, 503, 504) and attempt < self.max_retries:
                            await asyncio.sleep(0.8 * (2**attempt))
                            continue
                        break
                    except (httpx.HTTPError, ValueError, json.JSONDecodeError) as exc:
                        last_err = f"{type(exc).__name__}: {exc}"
                        if attempt < self.max_retries:
                            await asyncio.sleep(0.5 * (attempt + 1))
                            continue
                        break

        return VerificationResult(
            enabled=True,
            verdict="SKIPPED",
            confidence=stage2_result.score if stage2_result else 0,
            speaker_role=stage2_result.speaker_role if stage2_result else "",
            reason="AI-верификация недоступна, использован вердикт Ступени 2",
            task_summary=fallback_summary,
            suggested_reply=_sanitize_reply(fallback_reply),
            error=last_err,
        )


def _format_msk_dt(date_iso: str) -> str:
    dt = _parse_ts(date_iso)
    if dt is None:
        return "не указана"
    msk = dt.astimezone(timezone(timedelta(hours=3)))
    return msk.strftime("%Y-%m-%d %H:%M:%S МСК")


def format_saved_message_alert(
    *,
    lead_tier: str,
    track: str,
    score: int,
    channel: str,
    message_url: str,
    text: str,
    suggested_reply: str,
    task_summary: str = "",
    author_handle: str = "",
    author_id: str | int | None = None,
    message_date: str = "",
    extracted_links: list[str] | None = None,
    ai_result: VerificationResult | None = None,
    max_text_len: int | None = 3200,
) -> str:
    """Format a full-text Saved Messages notification with timestamp and direct contacts."""
    tier_upper = (lead_tier or "WARM").upper()
    if ai_result and ai_result.enabled and ai_result.verdict in ("HOT_LEAD", "WARM_LEAD"):
        tier_upper = "HOT" if ai_result.verdict == "HOT_LEAD" else "WARM"

    badge = "[HOT]" if tier_upper == "HOT" else "[WARM]"
    score_line = f"{score}/100"
    if ai_result and ai_result.enabled and ai_result.verdict != "SKIPPED":
        score_line += f" | AI {ai_result.confidence}% ({ai_result.speaker_role})"

    chat_ref = f"@{channel.lstrip('@')}" if channel and not str(channel).lstrip("-").isdigit() else f"chat:{channel}"
    ch_clean = str(channel or "").strip().lstrip("@").lower()
    handle = ""
    if author_handle:
        cleaned_h = author_handle.strip()
        handle = cleaned_h if cleaned_h.startswith("@") else f"@{cleaned_h}"
    if not handle:
        # Fallback: pick a direct non-bot @username from extracted links or message text
        candidates = list(extracted_links or []) + re.findall(r"@[A-Za-z][A-Za-z0-9_]{3,31}", text or "")
        for cand in candidates:
            c_clean = str(cand).strip()
            if c_clean.startswith("@"):
                u_low = c_clean.lstrip("@").lower()
                if u_low and u_low != ch_clean and not u_low.endswith("bot"):
                    handle = c_clean
                    break
    author_line = handle if handle else "не указан (ответьте по ссылке на сообщение)"

    summary = (ai_result.task_summary if ai_result and ai_result.task_summary else task_summary).strip()
    full_text = (text or "").strip()
    if max_text_len is not None and len(full_text) > max_text_len:
        cut_at = max(100, max_text_len - 40)
        full_text = full_text[:cut_at].rstrip() + "\n... [полный текст в all_leads_full.md]"

    final_reply = _sanitize_reply(
        ai_result.suggested_reply if (ai_result and ai_result.suggested_reply) else suggested_reply
    )

    lines = [
        f"{badge} {track} | {score_line} | {chat_ref}",
        f"Время сообщения: {_format_msk_dt(message_date)}",
        f"Ссылка: {message_url}",
        f"Автор: {author_line}",
    ]
    if extracted_links:
        lines.append("Контакты/ссылки: " + " | ".join(extracted_links[:6]))
    if summary:
        lines.append(f"Суть: {summary}")
    lines.extend(["", full_text, "", f"Отклик для отправки:\n{final_reply}"])
    return "\n".join(lines)
