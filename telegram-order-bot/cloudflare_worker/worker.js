/**
 * Cloudflare Worker: 24/7 Order Intake API & Telegram Notification Webhook
 * Owner: @SQUZZER_CODER
 *
 * Required encrypted secrets (`wrangler secret put ...`):
 *   - BOT_TOKEN: Telegram Bot API token
 *   - ADMIN_CHAT_ID: Numeric Telegram user/chat ID to receive order alerts
 * Optional secret:
 *   - WEBHOOK_SECRET: Secret header checked on POST /tg-webhook
 */

const STATUS_LABELS = {
  new: "НОВАЯ",
  progress: "В РАБОТЕ",
  done: "ГОТОВО",
};

const BASE_BOT_PRICE = 2500;
const BASE_BOT_HOURS = 24;
const MODULE_CATALOG = {
  admin: { title: "Админка", price: 1000, extraHours: 12 },
  payment: { title: "Оплата", price: 1500, extraHours: 12 },
  sheets_api: { title: "Google Sheets / API", price: 1500, extraHours: 24 },
  crm_db: { title: "База клиентов", price: 1200, extraHours: 12 },
  urgent: { title: "Срочный запуск", price: 1500, extraHours: 0 },
};

const NAME_ALLOWED_RE = /^[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё\s\-.'’]{1,59}$/;
const NAME_BAD_REPEAT_RE = /(?:--|\.\.|''|’’)/;
const LETTER_RE = /[A-Za-zА-Яа-яЁё]/g;
const WORD_WITH_LETTERS_RE = /[A-Za-zА-Яа-яЁё]{2,}/g;

const TG_HANDLE_RE = /^@[A-Za-z][A-Za-z0-9_]{4,31}$/;
const TG_LINK_RE = /^(?:https?:\/\/)?(?:t\.me|telegram\.me)\/([A-Za-z][A-Za-z0-9_]{4,31})\/?$/i;
const PHONE_FORMAT_RE = /^\+?[0-9][0-9\s\-\(\)]{5,18}[0-9]$/;
const EMAIL_RE = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,12}$/;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatPriceRub(amount) {
  const num = Math.max(0, Math.round(Number(amount) || 0));
  return `${num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ")} ₽`;
}

function formatDeadline(totalHours, isUrgent) {
  if (isUrgent) {
    return totalHours <= 12 ? "6–12 часов (срочно)" : `до ${totalHours} ч (срочно)`;
  }
  const days = totalHours / 24;
  if (days <= 1) return "1 день (24 ч)";
  if (Number.isInteger(days)) {
    const word = [2, 3, 4].includes(days) ? "дня" : "дней";
    return `${days} ${word}`;
  }
  return `${days.toFixed(1)} дня`;
}

function computeCanonicalEstimate(optionKeys) {
  const seen = new Set();
  const validKeys = [];
  for (const rawKey of optionKeys) {
    const k = String(rawKey ?? "").trim();
    if (Object.hasOwn(MODULE_CATALOG, k) && !seen.has(k)) {
      seen.add(k);
      validKeys.push(k);
    }
  }
  const price =
    BASE_BOT_PRICE + validKeys.reduce((acc, k) => acc + MODULE_CATALOG[k].price, 0);
  const isUrgent = seen.has("urgent");
  const rawHours =
    BASE_BOT_HOURS + validKeys.reduce((acc, k) => acc + MODULE_CATALOG[k].extraHours, 0);
  const totalHours = isUrgent ? Math.max(8, Math.min(24, Math.floor(rawHours / 3))) : rawHours;

  return {
    modules: validKeys.map((k) => MODULE_CATALOG[k].title),
    price,
    deadline: formatDeadline(totalHours, isUrgent),
  };
}

function corsHeaders(request, env) {
  const allowed = (env.ALLOWED_ORIGINS || "*").trim();
  const origin = request.headers.get("Origin") || "";
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Requested-With",
    "Access-Control-Max-Age": "86400",
  };

  if (allowed === "*") {
    headers["Access-Control-Allow-Origin"] = "*";
  } else if (origin) {
    const allowedList = allowed
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (allowedList.includes(origin)) {
      headers["Access-Control-Allow-Origin"] = origin;
      headers["Vary"] = "Origin";
    }
  }
  return headers;
}

function jsonResponse(payload, status, request, env) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(request, env),
    },
  });
}

export function validateName(raw) {
  const cleaned = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (cleaned.length < 2) {
    return { ok: false, error: "Имя слишком короткое — укажите минимум 2 буквы." };
  }
  if (cleaned.length > 60) {
    return { ok: false, error: "Имя слишком длинное (максимум 60 символов)." };
  }
  if (
    !NAME_ALLOWED_RE.test(cleaned) ||
    NAME_BAD_REPEAT_RE.test(cleaned) ||
    cleaned.endsWith("-") ||
    cleaned.includes("- -")
  ) {
    return { ok: false, error: "Имя может содержать только буквы, пробелы, дефис или апостроф." };
  }
  const letters = cleaned.match(LETTER_RE) || [];
  if (letters.length < 2) {
    return { ok: false, error: "Имя должно содержать минимум 2 буквы." };
  }
  return { ok: true, value: cleaned };
}

export function validateContact(raw) {
  const cleaned = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (cleaned.length < 5) {
    return { ok: false, error: "Контакт слишком короткий. Укажите @username, телефон или email." };
  }
  if (cleaned.length > 80) {
    return { ok: false, error: "Контакт слишком длинный (максимум 80 символов)." };
  }
  if (TG_HANDLE_RE.test(cleaned)) {
    return { ok: true, value: cleaned };
  }
  const tgMatch = TG_LINK_RE.exec(cleaned);
  if (tgMatch) {
    return { ok: true, value: `@${tgMatch[1]}` };
  }
  if (PHONE_FORMAT_RE.test(cleaned)) {
    const digits = cleaned.replace(/\D/g, "");
    if (digits.length >= 7 && digits.length <= 15) {
      return { ok: true, value: cleaned };
    }
  }
  if (EMAIL_RE.test(cleaned)) {
    return { ok: true, value: cleaned };
  }
  return {
    ok: false,
    error: "Укажите @username (от 5 символов), t.me/ник, телефон (+375/+7...) или email.",
  };
}

export function validateDescription(raw) {
  const cleaned = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (cleaned.length < 10) {
    return { ok: false, error: "Опишите задачу чуть подробнее (минимум 10 символов)." };
  }
  if (cleaned.length > 1000) {
    return { ok: false, error: "Описание слишком длинное (максимум 1000 символов)." };
  }
  const letters = cleaned.match(LETTER_RE) || [];
  const words = cleaned.match(WORD_WITH_LETTERS_RE) || [];
  if (letters.length < 5 || words.length < 2) {
    return { ok: false, error: "Опишите задачу словами (минимум 2 слова и 5 букв)." };
  }
  return { ok: true, value: cleaned };
}

export function validateOrderPayload(body) {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Invalid JSON payload." };
  }
  const honeypot = String(body._hp ?? body.company_fax_ext ?? "").trim();
  if (honeypot.length > 0) {
    return { ok: false, error: "Spam check rejected." };
  }

  const nameRes = validateName(body.name);
  if (!nameRes.ok) return { ok: false, error: nameRes.error };

  const contactRes = validateContact(body.contact);
  if (!contactRes.ok) return { ok: false, error: contactRes.error };

  const descRes = validateDescription(body.description);
  if (!descRes.ok) return { ok: false, error: descRes.error };

  const source = String(body.source ?? "Web Showcase").trim().slice(0, 60) || "Web Showcase";

  let modules;
  let price;
  let deadline;
  if (Array.isArray(body.optionKeys)) {
    const est = computeCanonicalEstimate(body.optionKeys);
    modules = est.modules;
    price = est.price;
    deadline = est.deadline;
  } else {
    modules = Array.isArray(body.modules)
      ? body.modules.map((m) => String(m).trim()).filter(Boolean).slice(0, 12)
      : [];
    price = Math.max(BASE_BOT_PRICE, Math.min(100_000, Math.round(Number(body.price) || BASE_BOT_PRICE)));
    deadline = String(body.deadline ?? "1 день").trim().slice(0, 60) || "1 день";
  }

  return {
    ok: true,
    order: {
      id: body.id ? String(body.id).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24) || "1" : String(Date.now()).slice(-6),
      name: nameRes.value,
      contact: contactRes.value,
      description: descRes.value,
      price,
      deadline,
      modules,
      source,
    },
  };
}

export function buildTelegramOrderText(order, statusKey = "new") {
  const statusText = STATUS_LABELS[statusKey] || STATUS_LABELS.new;
  const modulesText = order.modules.length ? order.modules.join(", ") : "Базовый бот";

  return [
    `<b>НОВАЯ ЗАЯВКА #${escapeHtml(order.id)}</b>  [${escapeHtml(statusText)}]`,
    "",
    `<b>Клиент:</b> ${escapeHtml(order.name)}`,
    `<b>Контакт:</b> ${escapeHtml(order.contact)}`,
    `<b>Оценка (примерно):</b> ~${escapeHtml(formatPriceRub(order.price))} · ~${escapeHtml(order.deadline)}`,
    `<b>Модули:</b> ${escapeHtml(modulesText)}`,
    `<b>Источник:</b> ${escapeHtml(order.source)}`,
    "",
    `<b>Задача:</b>`,
    escapeHtml(order.description),
  ].join("\n");
}

export function buildTelegramKeyboard(orderRef, contact) {
  const rows = [
    [
      { text: "Взять в работу", callback_data: `cf_status:progress:${orderRef}` },
      { text: "Готово", callback_data: `cf_status:done:${orderRef}` },
    ],
  ];

  const cleanContact = String(contact || "").trim();
  let tgUsername = "";
  if (TG_HANDLE_RE.test(cleanContact)) {
    tgUsername = cleanContact.slice(1);
  } else {
    const linkMatch = TG_LINK_RE.exec(cleanContact);
    if (linkMatch) {
      tgUsername = linkMatch[1];
    }
  }

  if (tgUsername) {
    rows.push([{ text: `Написать @${tgUsername}`, url: `https://t.me/${tgUsername}` }]);
  }

  return { inline_keyboard: rows };
}

function rebuildHtmlFromPlainCard(plainText, newStatusLabel) {
  const escaped = escapeHtml(plainText).replace(/\[(НОВАЯ|В РАБОТЕ|ГОТОВО)\]/, `[${newStatusLabel}]`);
  return escaped
    .replace(/^(НОВАЯ ЗАЯВКА #[^\s]+)/m, "<b>$1</b>")
    .replace(/^(Клиент:|Контакт:|Оценка(?: \(примерно\))?:|Модули:|Источник:|Задача:)/gm, "<b>$1</b>");
}

async function callTelegram(env, method, payload, fetchFn = fetch) {
  const resp = await fetchFn(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await resp.json();
  if (!resp.ok || !data.ok) {
    throw new Error(`Telegram ${method} error: ${data.description || resp.status}`);
  }
  return data.result;
}

async function checkRateLimit(request, cachesObj = typeof caches !== "undefined" ? caches : null) {
  if (!cachesObj || !cachesObj.default) return true;
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  const bucket = Math.floor(Date.now() / 60000);
  const cacheKey = new Request(`https://rate.internal/${encodeURIComponent(ip)}/${bucket}`);
  const hit = await cachesObj.default.match(cacheKey);
  const count = hit ? Number(await hit.text()) || 0 : 0;
  if (count >= 5) return false;
  await cachesObj.default.put(
    cacheKey,
    new Response(String(count + 1), { headers: { "Cache-Control": "max-age=65" } }),
  );
  return true;
}

export async function handleRequest(request, env, { fetchFn = fetch, cachesObj } = {}) {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  }

  if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
    return jsonResponse(
      {
        ok: true,
        service: "ClientFlow Orders API",
        owner: env.OWNER_HANDLE || "@SQUZZER_CODER",
        configured: Boolean(env.BOT_TOKEN && env.ADMIN_CHAT_ID),
      },
      200,
      request,
      env,
    );
  }

  if (request.method === "POST" && url.pathname === "/api/orders") {
    if (!env.BOT_TOKEN || !env.ADMIN_CHAT_ID) {
      return jsonResponse(
        { ok: false, error: "Server BOT_TOKEN or ADMIN_CHAT_ID is not configured." },
        503,
        request,
        env,
      );
    }

    const allowed = await checkRateLimit(request, cachesObj);
    if (!allowed) {
      return jsonResponse(
        { ok: false, error: "Слишком много запросов. Повторите через минуту." },
        429,
        request,
        env,
      );
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ ok: false, error: "Invalid JSON body." }, 400, request, env);
    }

    const parsed = validateOrderPayload(body);
    if (!parsed.ok) {
      return jsonResponse({ ok: false, error: parsed.error }, 422, request, env);
    }

    const order = parsed.order;
    const text = buildTelegramOrderText(order, "new");
    const replyMarkup = buildTelegramKeyboard(order.id, order.contact);

    try {
      const tgResult = await callTelegram(
        env,
        "sendMessage",
        {
          chat_id: env.ADMIN_CHAT_ID,
          text,
          parse_mode: "HTML",
          disable_web_page_preview: true,
          reply_markup: replyMarkup,
        },
        fetchFn,
      );

      return jsonResponse(
        {
          ok: true,
          orderId: order.id,
          telegramMessageId: tgResult.message_id,
        },
        201,
        request,
        env,
      );
    } catch (err) {
      return jsonResponse(
        {
          ok: false,
          error: "Не удалось доставить уведомление в Telegram.",
          detail: err && err.message ? err.message : "Telegram API error",
        },
        502,
        request,
        env,
      );
    }
  }

  if (request.method === "POST" && url.pathname === "/tg-webhook") {
    if (env.WEBHOOK_SECRET) {
      const tokenHeader = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
      if (tokenHeader !== env.WEBHOOK_SECRET) {
        return new Response("Forbidden", { status: 403 });
      }
    }

    let update;
    try {
      update = await request.json();
    } catch {
      return new Response("Bad Request", { status: 400 });
    }

    if (update.message && update.message.chat) {
      const chatId = update.message.chat.id;
      const text = String(update.message.text || "").trim();
      if (text.startsWith("/start") || text.startsWith("/id")) {
        try {
          await callTelegram(
            env,
            "sendMessage",
            {
              chat_id: chatId,
              text: [
                `<b>Приёмник заявок ${escapeHtml(env.OWNER_HANDLE || "@SQUZZER_CODER")}</b>`,
                "",
                `Ваш <code>ADMIN_CHAT_ID</code>: <code>${chatId}</code>`,
                "Новые заказы с веб-витрины будут приходить сюда автоматически.",
              ].join("\n"),
              parse_mode: "HTML",
            },
            fetchFn,
          );
        } catch (_err) {}
      }
      return new Response("ok", { status: 200 });
    }

    if (update.callback_query) {
      const cb = update.callback_query;
      const data = String(cb.data || "");
      const msg = cb.message;

      if (data.startsWith("cf_status:") && msg && msg.chat) {
        const [, statusKey] = data.split(":");
        const label = STATUS_LABELS[statusKey];
        if (label) {
          const oldText = String(msg.text || "");
          const alreadySame = oldText.includes(`[${label}]`);
          if (!alreadySame) {
            const updatedHtml = rebuildHtmlFromPlainCard(oldText, label);
            try {
              await callTelegram(
                env,
                "editMessageText",
                {
                  chat_id: msg.chat.id,
                  message_id: msg.message_id,
                  text: updatedHtml,
                  parse_mode: "HTML",
                  disable_web_page_preview: true,
                  reply_markup: msg.reply_markup,
                },
                fetchFn,
              );
            } catch (err) {
              const msgStr = String(err && err.message ? err.message : "");
              if (!msgStr.includes("message is not modified")) {
                try {
                  await callTelegram(
                    env,
                    "answerCallbackQuery",
                    { callback_query_id: cb.id, text: "Ошибка обновления статуса" },
                    fetchFn,
                  );
                } catch (_e) {}
                return new Response("ok", { status: 200 });
              }
            }
          }

          try {
            await callTelegram(
              env,
              "answerCallbackQuery",
              {
                callback_query_id: cb.id,
                text: alreadySame ? `Статус уже «${label}»` : `Статус обновлён: ${label}`,
              },
              fetchFn,
            );
          } catch (_e) {}
        }
      }
      return new Response("ok", { status: 200 });
    }

    return new Response("ok", { status: 200 });
  }

  return jsonResponse({ ok: false, error: "Not found" }, 404, request, env);
}

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
};
