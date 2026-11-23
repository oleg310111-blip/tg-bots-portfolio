/**
 * Studio interactive module (Clean-Slate v4):
 * - Pricing calculator with 32/32 parity against calculator.py
 * - Strict synchronous brief validation & Telegram deep-link builder
 * - Orchestration of ambient_shader.js, hero_3d.js, and motion_scroll.js
 * - Interactive #showcase (bot, sheets, site), #services, #cases, #case-dialog, #contacts-popover
 */

import { initAmbientShader } from './ambient_shader.js';
import { initHero3D } from './hero_3d.js';
import {
  runViewTransition,
  closeTopLayer,
  enableDialogLightDismissFallback,
  initScrollChoreography,
} from './motion_scroll.js';

export const BASE_BOT_PRICE = 2500;
export const BASE_BOT_HOURS = 24;
export const USDT_RATE_RUB = 95;
export const TELEGRAM_USERNAME = 'SQUZZER_CODER';
export const TELEGRAM_BASE_URL = `https://t.me/${TELEGRAM_USERNAME}`;
export const MAX_TELEGRAM_URL_LENGTH = 1800;

const RATE_LIMIT_STORAGE_KEY = 'squzzer_studio_last_submit_ts';
const RATE_LIMIT_MS = 5000;
const PRICE_ANIMATION_MS = 260;

function isFalsy(value) {
  return value ? false : true;
}

function isNotEqual(left, right) {
  return left === right ? false : true;
}

export const CALCULATOR_OPTIONS = Object.freeze([
  Object.freeze({
    key: 'admin',
    title: 'Управление заявками и статусами в Telegram',
    shortTitle: 'Управление заявками',
    price: 1000,
    extraHours: 12,
  }),
  Object.freeze({
    key: 'payment',
    title: 'Настройка приема оплат',
    shortTitle: 'Прием оплат',
    price: 1500,
    extraHours: 12,
  }),
  Object.freeze({
    key: 'sheets_api',
    title: 'Передача заявок в таблицы и учет',
    shortTitle: 'Таблицы и учет',
    price: 1500,
    extraHours: 24,
  }),
  Object.freeze({
    key: 'crm_db',
    title: 'База клиентов и рассылка сообщений',
    shortTitle: 'База и рассылка',
    price: 1200,
    extraHours: 12,
  }),
  Object.freeze({
    key: 'urgent',
    title: 'Срочный запуск за 6-12 часов',
    shortTitle: 'Срочный запуск',
    price: 1500,
    extraHours: 0,
  }),
]);

const OPTIONS_BY_KEY = new Map(CALCULATOR_OPTIONS.map((opt) => [opt.key, opt]));

const NAME_FULL_RE = /^[А-Яа-яЁёA-Za-z]+(?:[ -][А-Яа-яЁёA-Za-z]+)*$/;
const REPEATED_CHAR_5_RE = /(.)\1{4,}/i;
const REPEATED_CHAR_6_RE = /(.)\1{5,}/i;
const TG_HANDLE_RE = /^@[A-Za-z][A-Za-z0-9_]{3,31}$/;
const TG_LINK_RE = /^(?:https?:\/\/)?t\.me\/[A-Za-z0-9_]{4,32}$/;
const PHONE_RE = /^\+?\d[\d\s()-]{8,17}\d$/;
const ALL_SAME_DIGIT_RE = /^(\d)\1+$/;
const TASK_WORD_RE = /[А-Яа-яЁёA-Za-z]{2,}/g;
const VOWEL_RE = /[аеёиоуыэюяaeiouy]/i;
const UNSAFE_MARKUP_RE = /[<>]|javascript\s*:|onerror\s*=/i;
const CONTROL_CHARS_INLINE_RE = /[\u0000-\u001F\u007F]/;
const CONTROL_CHARS_TASK_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const CSV_LEADING_LINE_RE = /(?:^|\r?\n)[ \t]*[=+\-@]/;

const QUICK_TOPICS = Object.freeze({
  bot: Object.freeze({
    targetSelector: '#showcase',
    scene: 'bot',
    summary: 'Направление: Telegram-бот для приема заявок и оплат (~ от 2 500 р, 1-2 дня)',
  }),
  sheets: Object.freeze({
    targetSelector: '#showcase',
    scene: 'sheets',
    summary: 'Направление: Автоматизация таблиц и сбора обращений из чатов (~ от 2 500 р, 1-2 дня)',
  }),
  site: Object.freeze({
    targetSelector: '#showcase',
    scene: 'site',
    summary: 'Направление: Быстрый сайт услуг и калькулятор заказа (~ от 3 000 р, 1-2 дня)',
  }),
});

const BOT_INITIAL_GREETING =
  'Здравствуйте. Выберите сценарий слева, чтобы проверить ответ клиенту и карточку заявки для вашего чата.';
const BOT_OWNER_DEFAULT_STATUS = 'Ожидание выбора клиента';
const BOT_OWNER_DEFAULT_TEXT =
  'После коротких ответов клиента готовая заявка с ориентиром цены и контактом сразу приходит в ваш личный чат.';

const BOT_SCENARIOS = Object.freeze({
  price: Object.freeze({
    userText: 'Сколько стоит бот для приема заявок и расчета заказа?',
    botText:
      'Базовый бот с меню и передачей заявок в чат стоит ~ 2 500 р и собирается ~ за 1 день. С приемом оплат и записью в таблицу ориентир ~ 5 500 р. Собрать легкий пробный вариант?',
    ownerStatus: 'Новый расчет в боте: ~ 5 500 р',
    ownerText:
      'Выбраны прием оплат и перенос заявок в таблицу. Контакт клиента прикреплен к обращению.',
  }),
  booking: Object.freeze({
    userText: 'Можно ли настроить запись клиентов на свободные часы?',
    botText:
      'Да, сделаем выбор даты и свободных окон, добавим напоминание за 2 часа до визита и удобный перенос. Сборка займет ~ 1-2 дня, сначала покажем пробный диалог.',
    ownerStatus: 'Новая запись: окно 14:00',
    ownerText:
      'Клиент выбрал свободное время и подтвердил контакт. Напоминание добавлено в расписание.',
  }),
  status: Object.freeze({
    userText: 'Как клиент узнает, на каком этапе его заказ?',
    botText:
      'Вы меняете статус одной кнопкой у себя в чате, а бот сразу пишет покупателю: В работе, Пробный вариант готов или Заказ выполнен.',
    ownerStatus: 'Статус обновлен: Пробный вариант готов',
    ownerText:
      'Уведомление автоматически отправлено клиенту в диалог без ручной переписки.',
  }),
});

const SHEETS_FLOW_ROWS = Object.freeze([
  Object.freeze({
    request: 'Запись на услугу и расчет цены',
    filter: 'Полезный запрос',
    status: 'В таблице и чате',
    pillClass: 'stage-status-pill stage-status-pill--active',
    timeline: '~ 1-2 дня',
    isFiltered: false,
  }),
  Object.freeze({
    request: 'Рекламная рассылка по открытым чатам',
    filter: 'Лишний шум',
    status: 'Отсеян',
    pillClass: 'stage-status-pill stage-status-pill--filtered',
    timeline: '-',
    isFiltered: true,
  }),
  Object.freeze({
    request: 'Нужен сайт и бот для приема заказов',
    filter: 'Полезный запрос',
    status: 'В таблице и чате',
    pillClass: 'stage-status-pill stage-status-pill--done',
    timeline: '~ 1 день',
    isFiltered: false,
  }),
]);

const SITE_SCENES = Object.freeze([
  Object.freeze({
    src: './assets/media/case_03_website.webp',
    alt: 'Главный экран быстрой страницы услуг',
    step: 'Шаг 01',
    title: 'Понятное предложение без лишнего шума',
    caption:
      'Посетитель с первых секунд видит суть услуги, ориентир сроков и проверку до оплаты.',
  }),
  Object.freeze({
    src: './assets/media/case_01_bot.webp',
    alt: 'Экран живого интерактива и примеров работы',
    step: 'Шаг 02',
    title: 'Живая проверка сценариев прямо на странице',
    caption:
      'Человек нажимает кнопки и сразу видит, как бот или таблица работают в реальном деле.',
  }),
  Object.freeze({
    src: './assets/media/case_02_monitor.webp',
    alt: 'Экран расчета примерной стоимости и сроков',
    step: 'Шаг 03',
    title: 'Наглядный выбор опций и бюджета',
    caption:
      'Клиент отмечает нужные задачи и сразу получает честный примерный расчет стоимости.',
  }),
  Object.freeze({
    src: './assets/media/case_04_miniapp.webp',
    alt: 'Экран отправки готовой заявки в Telegram',
    step: 'Шаг 04',
    title: 'Готовая заявка за одно нажатие',
    caption:
      'Страница проверяет заполненные поля, копирует текст в буфер и открывает чат @SQUZZER_CODER.',
  }),
]);

const SERVICE_CATALOG = Object.freeze([
  Object.freeze({
    index: '0',
    title: 'Telegram-боты для приема заявок и оплат',
    desc: 'Пошаговые вопросы клиенту, удобное меню услуг, примерный расчет заказа, прием оплат и мгновенная отправка заявки в ваш личный чат.',
    price: '~ от 2 500 р',
    time: '~ от 1-2 дней',
    steps: Object.freeze([
      '01 Вопросы клиенту',
      '02 Примерный расчет',
      '03 Карточка в чате',
    ]),
    accentRgb: Object.freeze([0.7059, 0.3255, 0.1647]),
  }),
  Object.freeze({
    index: '1',
    title: 'Автоматизация таблиц и сбора обращений из чатов',
    desc: 'Перенос всех заявок в удобную таблицу, отбор живых запросов из открытых групп Telegram по вашим темам и очистка от лишней рекламы.',
    price: '~ от 2 500 р',
    time: '~ от 1-2 дней',
    steps: Object.freeze([
      '01 Сбор обращений',
      '02 Отсев шума',
      '03 Запись в таблицу',
    ]),
    accentRgb: Object.freeze([0.1059, 0.3686, 0.2902]),
  }),
  Object.freeze({
    index: '2',
    title: 'Быстрые сайты услуг и калькуляторы заказа',
    desc: 'Легкие страницы услуг с живым расчетом стоимости и сроков, которые мгновенно открываются на телефоне и передают заявку в Telegram.',
    price: '~ от 3 000 р',
    time: '~ от 1-2 дней',
    steps: Object.freeze([
      '01 Ясный экран',
      '02 Подбор опций',
      '03 Заявка в Telegram',
    ]),
    accentRgb: Object.freeze([0.6039, 0.4824, 0.3098]),
  }),
  Object.freeze({
    index: '3',
    title: 'Мини-приложения и связка сайта с Telegram',
    desc: 'Удобные интерактивные окна с каталогом услуг и оформлением заказа прямо внутри Telegram, связанные с ботом и вашей таблицей учета.',
    price: '~ от 3 500 р',
    time: '~ от 2-3 дней',
    steps: Object.freeze([
      '01 Выбор в окне',
      '02 Общая база',
      '03 Быстрый запуск',
    ]),
    accentRgb: Object.freeze([0.5608, 0.2784, 0.1961]),
  }),
]);

const CASE_DETAILS = Object.freeze({
  'case-01': Object.freeze({
    kicker: 'Пример 01',
    title: 'Бот для приема заказов с расчетом цены',
    summary:
      'Посетитель открывает диалог в Telegram, отвечает на несколько простых вопросов по задаче, сразу видит примерный бюджет и отправляет готовую карточку заказа владельцу.',
    result:
      'Меньше однотипных переписок вручную: все ответы клиента, выбранные опции и контакт приходят в одном аккуратном сообщении.',
    timeline: '~ 1-2 дня, пробный сценарий показываем до основной оплаты.',
    estimateLabel:
      'Похожая задача: Бот для приема заказов с расчетом цены (~ от 2 500 р, 1-2 дня)',
    image: './assets/media/case_01_bot.webp',
    alt: 'Трехмерная сцена интерфейса Telegram-бота для приема заявок',
    highlights: Object.freeze([
      'Что сделано: пошаговый опрос, автоматический подсчет примерной стоимости и карточка заявки в личный чат.',
      'Проверка до оплаты: запускаем легкий рабочий фрагмент диалога прямо в Telegram на ваших текстах.',
      'Польза для бизнеса: клиент получает понятный ответ за 3 секунды, а владелец видит готовую заявку без уточнений.',
    ]),
  }),
  'case-02': Object.freeze({
    kicker: 'Пример 02',
    title: 'Отбор заявок из чатов Telegram и перенос в таблицу',
    summary:
      'Настройка автоматического отбора живых запросов из открытых групп по вашим ключевым фразам, с отсеиванием рекламного шума и случайных сообщений.',
    result:
      'Подходящие запросы приходят в отдельный личный чат и таблицу сразу после публикации, чтобы вы успели ответить первым.',
    timeline: '~ 1-2 дня, настройка под список ваших тем и правил отбора.',
    estimateLabel:
      'Похожая задача: Отбор заявок из чатов Telegram и перенос в таблицу (~ от 2 500 р, 1-2 дня)',
    image: './assets/media/case_02_monitor.webp',
    alt: 'Трехмерная схема отбора целевых обращений из чатов',
    highlights: Object.freeze([
      'Что сделано: сбор обращений по заданным словам, отсев лишнего шума и автоматическая запись в таблицу.',
      'Проверка до оплаты: показываем тестовую подборку реальных совпадений из открытых обсуждений.',
      'Польза для бизнеса: не нужно вручную листать десятки лент, подходящие заказы приходят первыми.',
    ]),
  }),
  'case-03': Object.freeze({
    kicker: 'Пример 03',
    title: 'Быстрый сайт услуг с калькулятором заказа',
    summary:
      'Быстрая одностраничная форма с понятными услугами, расчетом примерной цены на телефоне и передачей готового запроса в личную переписку Telegram.',
    result:
      'Надежная загрузка без сторонних сервисов, удобная работа с мобильного экрана и мгновенный переход к диалогу.',
    timeline: '~ 1-2 дня с учетом адаптации под мобильные и настольные экраны.',
    estimateLabel:
      'Похожая задача: Быстрый сайт услуг с калькулятором заказа (~ от 3 000 р, 1-2 дня)',
    image: './assets/media/case_03_website.webp',
    alt: 'Трехмерная сцена быстрого сайта услуг с расчетом стоимости',
    highlights: Object.freeze([
      'Что сделано: легкая автономная страница с выбором опций, проверкой полей и готовым переходом в Telegram.',
      'Проверка до оплаты: вы открываете живую тестовую ссылку со своего телефона и проверяете все кнопки.',
      'Польза для бизнеса: стабильная работа на любом соединении без лишних ежемесячных трат.',
    ]),
  }),
  'case-04': Object.freeze({
    kicker: 'Пример 04',
    title: 'Мини-приложение с каталогом внутри Telegram',
    summary:
      'Клиент открывает наглядный каталог прямо внутри диалога Telegram без перехода во внешний браузер, отмечает нужные позиции и сразу отправляет заказ.',
    result:
      'Удобное оформление заказа в два касания, автоматическая передача состава заявки владельцу и запись в таблицу учета.',
    timeline: '~ 2-3 дня, пробный интерактивный экран показываем до оплаты.',
    estimateLabel:
      'Похожая задача: Мини-приложение с каталогом внутри Telegram (~ от 3 500 р, 2-3 дня)',
    image: './assets/media/case_04_miniapp.webp',
    alt: 'Трехмерная сцена мини-приложения с каталогом внутри Telegram',
    highlights: Object.freeze([
      'Что сделано: каталог услуг внутри мессенджера, подбор опций и мгновенная связка с ботом.',
      'Проверка до оплаты: даем тестовый запуск прямо в Telegram, чтобы проверить удобство с телефона.',
      'Польза для бизнеса: клиент остается внутри привычного чата и быстрее доходит до заказа.',
    ]),
  }),
});

/**
 * Format an integer amount using spaces as thousands separators.
 */
export function formatPrice(amount) {
  const num = Math.round(Number(amount) || 0);
  const sign = num < 0 ? '-' : '';
  const digits = String(Math.abs(num));
  const groups = [];
  for (let i = digits.length; i > 0; i -= 3) {
    groups.unshift(digits.slice(Math.max(0, i - 3), i));
  }
  return `${sign}${groups.join(' ')}`;
}

/**
 * Filter unknown option keys and preserve canonical CALCULATOR_OPTIONS ordering.
 */
export function normalizeOptionKeys(keys) {
  if (isFalsy(keys) || isNotEqual(typeof keys[Symbol.iterator], 'function')) {
    return [];
  }
  const rawSet = new Set();
  for (const item of keys) {
    if (isNotEqual(typeof item, 'string')) continue;
    const trimmed = item.trim();
    if (trimmed && OPTIONS_BY_KEY.has(trimmed)) {
      rawSet.add(trimmed);
    }
  }
  return CALCULATOR_OPTIONS.filter((opt) => rawSet.has(opt.key)).map((opt) => opt.key);
}

function formatDeadlineLabel(totalHours, isUrgent) {
  if (isUrgent) {
    if (totalHours <= 12) {
      return '6-12 часов (срочно)';
    }
    return `до ${totalHours} ч (срочно)`;
  }

  const days = totalHours / 24;
  if (days <= 1) {
    return '1 день (24 ч)';
  }
  if (Number.isInteger(days)) {
    const word = days === 2 || days === 3 || days === 4 ? 'дня' : 'дней';
    return `${days} ${word}`;
  }
  return `${days.toFixed(1)} дня`;
}

/**
 * Calculate total price, turnaround hours, and display strings matching calculator.py.
 */
export function calculateEstimate(selectedKeys, currency = 'RUB') {
  const normalizedKeys = normalizeOptionKeys(selectedKeys);
  const selectedOptions = normalizedKeys.map((key) => OPTIONS_BY_KEY.get(key));

  const totalPrice =
    BASE_BOT_PRICE + selectedOptions.reduce((sum, opt) => sum + opt.price, 0);
  const isUrgent = normalizedKeys.includes('urgent');

  const rawHours =
    BASE_BOT_HOURS + selectedOptions.reduce((sum, opt) => sum + opt.extraHours, 0);
  const totalHours = isUrgent
    ? Math.max(8, Math.min(24, Math.floor(rawHours / 3)))
    : rawHours;

  const deadlineLabel = formatDeadlineLabel(totalHours, isUrgent);
  const normalizedCurrency = currency === 'USDT' ? 'USDT' : 'RUB';
  const usdtApprox = Math.max(1, Math.round(totalPrice / USDT_RATE_RUB));
  const formattedPrice =
    normalizedCurrency === 'USDT'
      ? `~ ${usdtApprox} USDT`
      : `~ ${formatPrice(totalPrice)} р`;
  const formattedDeadline = `~ ${deadlineLabel}`;

  const selectedTitles = selectedOptions.map((opt) => opt.title);
  const moduleSummary =
    selectedOptions.length > 0
      ? selectedOptions.map((opt) => opt.shortTitle).join(', ')
      : 'Базовый бот';
  const summaryLine = `${formattedPrice}, ${formattedDeadline}, состав: ${moduleSummary}`;

  return {
    selectedKeys: normalizedKeys,
    selectedOptions,
    selectedTitles,
    currency: normalizedCurrency,
    totalPrice,
    usdtApprox,
    totalHours,
    rawHours,
    isUrgent,
    deadlineLabel,
    formattedPrice,
    formattedDeadline,
    summaryLine,
  };
}

function validateName(rawName) {
  const cleanName = typeof rawName === 'string' ? rawName.trim() : '';
  if (isFalsy(cleanName)) {
    return { valid: false, value: '', error: 'Укажите ваше имя.' };
  }
  if (cleanName.length < 2 || cleanName.length > 60) {
    return {
      valid: false,
      value: cleanName,
      error: 'Имя должно содержать от 2 до 60 символов.',
    };
  }
  if (
    CONTROL_CHARS_INLINE_RE.test(cleanName) ||
    UNSAFE_MARKUP_RE.test(cleanName) ||
    /^[=+\-@]/.test(cleanName)
  ) {
    return {
      valid: false,
      value: cleanName,
      error: 'Уберите лишние знаки и спецсимволы из имени.',
    };
  }
  if (isFalsy(NAME_FULL_RE.test(cleanName))) {
    return {
      valid: false,
      value: cleanName,
      error: 'Используйте только буквы, пробелы или дефис между словами.',
    };
  }
  const letters = cleanName.replace(/[^А-Яа-яЁёA-Za-z]/g, '').toLowerCase();
  const uniqueLetters = new Set(letters).size;
  if (REPEATED_CHAR_5_RE.test(cleanName) || uniqueLetters < 2) {
    return {
      valid: false,
      value: cleanName,
      error: 'Введите настоящее имя, а не повтор одинаковых букв.',
    };
  }
  return { valid: true, value: cleanName, error: '' };
}

function validateContact(rawContact) {
  const cleanContact = typeof rawContact === 'string' ? rawContact.trim() : '';
  if (isFalsy(cleanContact)) {
    return { valid: false, value: '', error: 'Укажите контакт для ответа.' };
  }
  if (cleanContact.length < 3 || cleanContact.length > 80) {
    return {
      valid: false,
      value: cleanContact,
      error: 'Контакт должен содержать от 3 до 80 символов.',
    };
  }
  if (CONTROL_CHARS_INLINE_RE.test(cleanContact) || UNSAFE_MARKUP_RE.test(cleanContact)) {
    return {
      valid: false,
      value: cleanContact,
      error: 'Контакт содержит недопустимые символы.',
    };
  }

  const isTgHandle = TG_HANDLE_RE.test(cleanContact);
  const isTgLink = TG_LINK_RE.test(cleanContact);
  const isPhoneShape = PHONE_RE.test(cleanContact);

  if (cleanContact.startsWith('=') || cleanContact.startsWith('-')) {
    return {
      valid: false,
      value: cleanContact,
      error: 'Контакт не должен начинаться со знаков = или -.',
    };
  }
  if (cleanContact.startsWith('@') && isFalsy(isTgHandle)) {
    return {
      valid: false,
      value: cleanContact,
      error: 'Ник Telegram должен быть в формате @username без пробелов и скобок.',
    };
  }
  if (cleanContact.startsWith('+') && isFalsy(isPhoneShape)) {
    return {
      valid: false,
      value: cleanContact,
      error: 'Введите корректный номер телефона от 10 цифр или @username.',
    };
  }

  if (isPhoneShape) {
    const digits = cleanContact.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 15 || ALL_SAME_DIGIT_RE.test(digits)) {
      return {
        valid: false,
        value: cleanContact,
        error: 'Проверьте номер телефона: нужно от 10 до 15 разных цифр.',
      };
    }
    return { valid: true, value: cleanContact, error: '' };
  }

  if (isTgHandle || isTgLink) {
    return { valid: true, value: cleanContact, error: '' };
  }

  return {
    valid: false,
    value: cleanContact,
    error: 'Укажите @username, ссылку t.me/username или номер телефона.',
  };
}

function validateTask(rawTask) {
  const cleanTask = typeof rawTask === 'string' ? rawTask.trim() : '';
  if (isFalsy(cleanTask)) {
    return { valid: false, value: '', error: 'Опишите задачу своими словами.' };
  }
  if (cleanTask.length < 12 || cleanTask.length > 1000) {
    return {
      valid: false,
      value: cleanTask,
      error: 'Описание должно содержать от 12 до 1000 символов.',
    };
  }
  if (CONTROL_CHARS_TASK_RE.test(cleanTask) || UNSAFE_MARKUP_RE.test(cleanTask)) {
    return {
      valid: false,
      value: cleanTask,
      error: 'Уберите угловые скобки и небезопасные вставки из описания.',
    };
  }
  if (CSV_LEADING_LINE_RE.test(cleanTask)) {
    return {
      valid: false,
      value: cleanTask,
      error: 'Не начинайте строки со знаков =, +, - или @.',
    };
  }
  if (REPEATED_CHAR_6_RE.test(cleanTask)) {
    return {
      valid: false,
      value: cleanTask,
      error: 'Уберите длинный повтор одинаковых символов из текста задачи.',
    };
  }
  const words = cleanTask.match(TASK_WORD_RE) || [];
  if (words.length < 2 || isFalsy(VOWEL_RE.test(cleanTask))) {
    return {
      valid: false,
      value: cleanTask,
      error: 'Напишите хотя бы два понятных слова о том, что нужно сделать.',
    };
  }
  return { valid: true, value: cleanTask, error: '' };
}

/**
 * Validate brief payload with honeypot check, strict format rules, and injection guards.
 */
export function validateBriefPayload({ name, contact, task, website } = {}) {
  const rawWebsite = typeof website === 'string' ? website.trim() : '';
  if (rawWebsite.length > 0) {
    return {
      ok: false,
      honeypotTriggered: true,
      errors: {},
      sanitized: { name: '', contact: '', task: '' },
    };
  }

  const nameCheck = validateName(name);
  const contactCheck = validateContact(contact);
  const taskCheck = validateTask(task);

  const errors = {};
  if (isFalsy(nameCheck.valid)) errors.name = nameCheck.error;
  if (isFalsy(contactCheck.valid)) errors.contact = contactCheck.error;
  if (isFalsy(taskCheck.valid)) errors.task = taskCheck.error;

  return {
    ok: Object.keys(errors).length === 0,
    honeypotTriggered: false,
    errors,
    sanitized: {
      name: nameCheck.value,
      contact: contactCheck.value,
      task: taskCheck.value,
    },
  };
}

/**
 * Build a clean plain-text brief ready for Telegram or clipboard copy.
 */
export function buildBriefText({ name, contact, task, estimateSummary } = {}) {
  const cleanName = typeof name === 'string' ? name.trim() : '';
  const cleanContact = typeof contact === 'string' ? contact.trim() : '';
  const cleanTask = typeof task === 'string' ? task.trim() : '';
  const cleanEstimate = typeof estimateSummary === 'string' ? estimateSummary.trim() : '';

  const lines = [
    'Заявка для SQUZZER ATELIER',
    `Имя: ${cleanName}`,
    `Контакт: ${cleanContact}`,
  ];

  if (cleanEstimate) {
    lines.push(`Ориентир: ${cleanEstimate}`);
  }

  lines.push('', 'Задача:', cleanTask);
  return lines.join('\n');
}

/**
 * Build a safe Telegram deep-link keeping total URL length within MAX_TELEGRAM_URL_LENGTH.
 */
export function buildTelegramBriefUrl(briefText) {
  const trimmed = typeof briefText === 'string' ? briefText.trim() : '';
  if (isFalsy(trimmed)) {
    return TELEGRAM_BASE_URL;
  }

  const prefix = `${TELEGRAM_BASE_URL}?text=`;
  const maxEncodedLen = MAX_TELEGRAM_URL_LENGTH - prefix.length;
  const fullEncoded = encodeURIComponent(trimmed);
  if (fullEncoded.length <= maxEncodedLen) {
    return `${prefix}${fullEncoded}`;
  }

  const truncationNote = '\n... (полный текст заявки скопируйте со страницы)';
  const chars = Array.from(trimmed);
  let low = 0;
  let high = chars.length;
  let bestCandidate = '';

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = `${chars.slice(0, mid).join('').trimEnd()}${truncationNote}`;
    if (encodeURIComponent(candidate).length <= maxEncodedLen) {
      bestCandidate = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  if (isFalsy(bestCandidate)) {
    return TELEGRAM_BASE_URL;
  }

  return `${prefix}${encodeURIComponent(bestCandidate)}`;
}

// ============================================================================
// Browser Runtime Initialization (skipped safely when document is unavailable)
// ============================================================================

function supportsNativePopover() {
  return (
    isNotEqual(typeof HTMLElement, 'undefined') &&
    Object.hasOwn(HTMLElement.prototype, 'popover')
  );
}

function supportsNativeCommands() {
  return (
    isNotEqual(typeof HTMLButtonElement, 'undefined') &&
    'commandForElement' in HTMLButtonElement.prototype
  );
}

function supportsUserInvalidSelector() {
  try {
    return isNotEqual(typeof CSS, 'undefined') && CSS.supports('selector(:user-invalid)');
  } catch {
    return false;
  }
}

function prefersReducedMotion() {
  return Boolean(
    isNotEqual(typeof window, 'undefined') &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );
}

function supportsFineHoverPointer() {
  return Boolean(
    isNotEqual(typeof window, 'undefined') &&
      window.matchMedia?.('(hover: hover) and (pointer: fine)').matches
  );
}

function scrollToElement(targetEl) {
  if (isFalsy(targetEl) || isNotEqual(typeof targetEl.scrollIntoView, 'function')) return;
  targetEl.scrollIntoView({
    behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    block: 'start',
  });
}

function legacyCopyText(text) {
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.cssText = 'position:fixed;inset-block-start:0;opacity:0;';
  document.body.append(field);
  field.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    field.remove();
  }
}

async function copyTextWithFallback(text) {
  if (isFalsy(text)) return false;
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fallback to hidden textarea when Clipboard API is blocked.
  }
  return legacyCopyText(text);
}

function initOpticalSurfaceSpotlight() {
  if (isFalsy(supportsFineHoverPointer()) || prefersReducedMotion()) {
    return;
  }
  const surfaces = Array.from(document.querySelectorAll('[data-optical-surface]'));
  for (const surface of surfaces) {
    surface.addEventListener(
      'pointerenter',
      () => {
        surface.style.setProperty('--spotlight-opacity', '1');
      },
      { passive: true }
    );
    surface.addEventListener(
      'pointerleave',
      () => {
        surface.style.setProperty('--spotlight-opacity', '0');
      },
      { passive: true }
    );
  }
}

function initHero3DControls(hero3d) {
  const modeButtons = Array.from(document.querySelectorAll('[data-hero-3d-mode]'));
  if (modeButtons.length === 0) return;

  for (const btn of modeButtons) {
    btn.addEventListener('click', () => {
      const mode = btn.getAttribute('data-hero-3d-mode') || 'crystal';
      for (const item of modeButtons) {
        item.setAttribute(
          'aria-pressed',
          String(item.getAttribute('data-hero-3d-mode') === mode)
        );
      }
      hero3d.setMode(mode);
    });
  }
}

function createBotMessageNode(text, variant) {
  const wrap = document.createElement('div');
  wrap.className = variant === 'user' ? 'bot-msg bot-msg--user' : 'bot-msg bot-msg--bot';
  const p = document.createElement('p');
  p.className = 'bot-msg-text';
  p.textContent = text;
  wrap.append(p);
  return wrap;
}

function initBotSimulator(stageRoot) {
  if (isFalsy(stageRoot)) return;
  const actionButtons = Array.from(stageRoot.querySelectorAll('[data-bot-action]'));
  const resetBtn = document.getElementById('bot-reset-btn');
  const messagesEl = document.getElementById('bot-sim-messages');
  const typingEl = document.getElementById('bot-typing');
  const ownerStatusEl = document.getElementById('bot-owner-status');
  const ownerTextEl = document.getElementById('bot-owner-text');

  if (isFalsy(messagesEl)) return;

  let replyTimer = 0;

  const scrollMessagesToBottom = () => {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  };

  const clearPendingReply = () => {
    if (replyTimer) {
      window.clearTimeout(replyTimer);
      replyTimer = 0;
    }
    if (typingEl) typingEl.hidden = true;
  };

  const setActiveActionButton = (activeKey) => {
    for (const btn of actionButtons) {
      btn.setAttribute('aria-pressed', String(btn.dataset.botAction === activeKey));
    }
  };

  const finishScenarioReply = (scenario) => {
    if (typingEl) typingEl.hidden = true;
    messagesEl.append(createBotMessageNode(scenario.botText, 'bot'));
    if (ownerStatusEl) ownerStatusEl.textContent = scenario.ownerStatus;
    if (ownerTextEl) ownerTextEl.textContent = scenario.ownerText;
    scrollMessagesToBottom();
  };

  for (const btn of actionButtons) {
    btn.addEventListener('click', () => {
      const actionKey = btn.dataset.botAction || '';
      const scenario = BOT_SCENARIOS[actionKey];
      if (isFalsy(scenario)) return;

      clearPendingReply();
      setActiveActionButton(actionKey);

      messagesEl.append(createBotMessageNode(scenario.userText, 'user'));
      scrollMessagesToBottom();

      if (prefersReducedMotion()) {
        finishScenarioReply(scenario);
        return;
      }

      if (typingEl) typingEl.hidden = false;
      scrollMessagesToBottom();
      replyTimer = window.setTimeout(() => {
        replyTimer = 0;
        finishScenarioReply(scenario);
      }, 420);
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      clearPendingReply();
      setActiveActionButton('');
      messagesEl.replaceChildren(createBotMessageNode(BOT_INITIAL_GREETING, 'bot'));
      if (ownerStatusEl) ownerStatusEl.textContent = BOT_OWNER_DEFAULT_STATUS;
      if (ownerTextEl) ownerTextEl.textContent = BOT_OWNER_DEFAULT_TEXT;
      scrollMessagesToBottom();
    });
  }
}

function createSheetsTableRow(row) {
  const tr = document.createElement('tr');

  const tdReq = document.createElement('td');
  tdReq.textContent = row.request;

  const tdFilter = document.createElement('td');
  tdFilter.textContent = row.filter;

  const tdStatus = document.createElement('td');
  const pill = document.createElement('span');
  pill.className = row.pillClass;
  pill.textContent = row.status;
  tdStatus.append(pill);

  const tdTime = document.createElement('td');
  tdTime.textContent = row.timeline;

  tr.append(tdReq, tdFilter, tdStatus, tdTime);
  return tr;
}

function initSheetsFlow() {
  const runBtn = document.getElementById('sheets-run-btn');
  const tbody = document.getElementById('sheets-demo-tbody');
  const totalInEl = document.getElementById('sheets-count-in');
  const filteredEl = document.getElementById('sheets-count-qualified');
  const sentEl = document.getElementById('sheets-count-sent');

  if (isFalsy(runBtn) || isFalsy(tbody)) return;

  let stepTimers = [];

  const clearScheduledSteps = () => {
    for (const timerId of stepTimers) {
      window.clearTimeout(timerId);
    }
    stepTimers = [];
  };

  const updateCounters = (totalIn, filteredOut, sentToWork) => {
    if (totalInEl) totalInEl.textContent = String(totalIn);
    if (filteredEl) filteredEl.textContent = String(filteredOut);
    if (sentEl) sentEl.textContent = String(sentToWork);
  };

  runBtn.addEventListener('click', () => {
    clearScheduledSteps();
    tbody.replaceChildren();
    updateCounters(0, 0, 0);

    let totalIn = 0;
    let filteredOut = 0;
    let sentToWork = 0;

    const pushRow = (row) => {
      tbody.append(createSheetsTableRow(row));
      totalIn += 1;
      if (row.isFiltered) {
        filteredOut += 1;
      } else {
        sentToWork += 1;
      }
      updateCounters(totalIn, filteredOut, sentToWork);
    };

    if (prefersReducedMotion()) {
      for (const row of SHEETS_FLOW_ROWS) {
        pushRow(row);
      }
      return;
    }

    SHEETS_FLOW_ROWS.forEach((row, idx) => {
      const timerId = window.setTimeout(() => {
        pushRow(row);
      }, idx * 380);
      stepTimers.push(timerId);
    });
  });
}

function initSiteShowcase(stageRoot) {
  if (isFalsy(stageRoot)) {
    return { pauseAutoplay: () => {} };
  }

  const activeImg = document.getElementById('site-active-img');
  const stepEl = document.getElementById('site-scene-step');
  const titleEl = document.getElementById('site-scene-title');
  const captionEl = document.getElementById('site-scene-caption');
  const progressBar = document.getElementById('site-progress-bar');
  const autoplayBtn = document.getElementById('site-autoplay-btn');
  const timelineEl = stageRoot.querySelector('[data-site-timeline]');
  const sceneButtons = Array.from(stageRoot.querySelectorAll('[data-site-scene]'));

  let currentIndex = 0;
  let autoplayTimer = 0;
  let isPlaying = false;

  const renderScene = (rawIndex) => {
    const count = SITE_SCENES.length;
    currentIndex = ((Number(rawIndex) || 0) % count + count) % count;
    const scene = SITE_SCENES[currentIndex];

    if (activeImg) {
      activeImg.src = scene.src;
      activeImg.alt = scene.alt;
    }
    if (stepEl) stepEl.textContent = scene.step;
    if (titleEl) titleEl.textContent = scene.title;
    if (captionEl) captionEl.textContent = scene.caption;
    if (progressBar) {
      progressBar.style.setProperty('--site-progress', String((currentIndex + 1) / count));
    }

    for (const btn of sceneButtons) {
      btn.setAttribute('aria-pressed', String(Number(btn.dataset.siteScene) === currentIndex));
    }
  };

  const setAutoplayState = (nextPlaying) => {
    isPlaying = Boolean(nextPlaying) && isFalsy(prefersReducedMotion());
    if (autoplayTimer) {
      window.clearInterval(autoplayTimer);
      autoplayTimer = 0;
    }
    if (autoplayBtn) {
      autoplayBtn.setAttribute('aria-pressed', String(isPlaying));
      autoplayBtn.textContent = isPlaying ? 'Остановить обзор' : 'Листать экраны';
    }
    if (isPlaying) {
      autoplayTimer = window.setInterval(() => {
        renderScene(currentIndex + 1);
      }, 2800);
    }
  };

  for (const btn of sceneButtons) {
    btn.addEventListener('click', () => {
      const nextIdx = Number(btn.dataset.siteScene || 0);
      renderScene(nextIdx);
    });
  }

  if (timelineEl) {
    timelineEl.addEventListener('click', (event) => {
      const rect = timelineEl.getBoundingClientRect();
      if (rect.width <= 0) return;
      const ratio = Math.max(0, Math.min(0.999, (event.clientX - rect.left) / rect.width));
      const targetIdx = Math.floor(ratio * SITE_SCENES.length);
      renderScene(targetIdx);
    });
  }

  if (autoplayBtn) {
    autoplayBtn.addEventListener('click', () => {
      if (prefersReducedMotion()) {
        setAutoplayState(false);
        renderScene(currentIndex + 1);
        return;
      }
      setAutoplayState(isFalsy(isPlaying));
    });
  }

  renderScene(0);
  setAutoplayState(false);

  return {
    pauseAutoplay: () => {
      if (isPlaying) {
        setAutoplayState(false);
      }
    },
  };
}

function initShowcaseStage() {
  const stageRoot = document.getElementById('hero-stage');
  if (isFalsy(stageRoot)) {
    return { setStageScene: () => {} };
  }

  initBotSimulator(stageRoot);
  initSheetsFlow();
  const siteShowcaseApi = initSiteShowcase(stageRoot);

  const sceneButtons = Array.from(stageRoot.querySelectorAll('[data-stage-scene]'));
  const scenePanels = Array.from(stageRoot.querySelectorAll('[data-stage-panel]'));
  const validScenes = new Set(
    scenePanels.map((panel) => panel.dataset.stagePanel).filter(Boolean)
  );
  let activeScene = 'bot';

  const applySceneDom = (scene) => {
    if (isNotEqual(scene, 'site')) {
      siteShowcaseApi.pauseAutoplay();
    }
    for (const btn of sceneButtons) {
      btn.setAttribute('aria-pressed', String(btn.dataset.stageScene === scene));
    }
    for (const panel of scenePanels) {
      panel.hidden = isNotEqual(panel.dataset.stagePanel, scene);
    }
  };

  const setStageScene = (rawScene, { transition = true } = {}) => {
    const scene = validScenes.has(rawScene) ? rawScene : 'bot';
    if (scene === activeScene) {
      applySceneDom(scene);
      return;
    }
    activeScene = scene;

    if (isFalsy(transition)) {
      applySceneDom(scene);
      return;
    }

    runViewTransition(() => applySceneDom(scene), {
      documentObj: document,
    });
  };

  for (const btn of sceneButtons) {
    btn.addEventListener('click', () => {
      setStageScene(btn.dataset.stageScene || 'bot', { transition: true });
    });
  }

  return { setStageScene };
}

function initServicesCatalog(ambientShader) {
  const catalogEl = document.querySelector('.services-catalog');
  const rows = Array.from(document.querySelectorAll('[data-service-item]'));
  if (isFalsy(catalogEl) || rows.length === 0) return;

  const previewTitleEl = document.getElementById('service-preview-title');
  const previewDescEl = document.getElementById('service-preview-desc');
  const previewPriceEl = document.getElementById('service-preview-price');
  const previewTimeEl = document.getElementById('service-preview-time');
  const previewStepsEl = document.getElementById('service-preview-steps');

  let activeIndex = 0;

  const updatePreviewPanel = (index) => {
    const service = SERVICE_CATALOG[index] || SERVICE_CATALOG[0];
    if (isFalsy(service)) return;

    if (previewTitleEl) previewTitleEl.textContent = service.title;
    if (previewDescEl) previewDescEl.textContent = service.desc;
    if (previewPriceEl) previewPriceEl.textContent = service.price;
    if (previewTimeEl) previewTimeEl.textContent = service.time;
    if (previewStepsEl) {
      const items = service.steps.map((stepText) => {
        const li = document.createElement('li');
        li.textContent = stepText;
        return li;
      });
      previewStepsEl.replaceChildren(...items);
    }
  };

  const setActiveServiceRow = (index, { applyAccent = true } = {}) => {
    const safeIndex = Math.max(0, Math.min(SERVICE_CATALOG.length - 1, Number(index) || 0));
    activeIndex = safeIndex;

    for (const row of rows) {
      const isActive = Number(row.dataset.serviceItem) === safeIndex;
      row.setAttribute('data-active', String(isActive));
      const trigger = row.querySelector('.service-row-trigger');
      if (trigger) {
        trigger.setAttribute('aria-expanded', String(isActive));
      }
    }

    updatePreviewPanel(safeIndex);

    if (applyAccent && ambientShader && typeof ambientShader.setAccentOverride === 'function') {
      const service = SERVICE_CATALOG[safeIndex];
      ambientShader.setAccentOverride(service ? [...service.accentRgb] : null);
    }
  };

  for (const row of rows) {
    const idx = Number(row.dataset.serviceItem || 0);
    const trigger = row.querySelector('.service-row-trigger');

    if (trigger) {
      trigger.addEventListener('click', () => {
        setActiveServiceRow(idx, { applyAccent: true });
      });

      trigger.addEventListener('focusin', () => {
        setActiveServiceRow(idx, { applyAccent: true });
      });
    }

    row.addEventListener('pointerenter', (event) => {
      if (event.pointerType === 'touch') return;
      updatePreviewPanel(idx);
      const service = SERVICE_CATALOG[idx];
      if (service && ambientShader && typeof ambientShader.setAccentOverride === 'function') {
        ambientShader.setAccentOverride([...service.accentRgb]);
      }
    });
  }

  catalogEl.addEventListener('pointerleave', () => {
    updatePreviewPanel(activeIndex);
    if (ambientShader && typeof ambientShader.setAccentOverride === 'function') {
      ambientShader.setAccentOverride(null);
    }
  });

  catalogEl.addEventListener('focusout', (event) => {
    const nextTarget = event.relatedTarget;
    if (isFalsy(nextTarget) || isFalsy(catalogEl.contains(nextTarget))) {
      if (ambientShader && typeof ambientShader.setAccentOverride === 'function') {
        ambientShader.setAccentOverride(null);
      }
    }
  });

  setActiveServiceRow(0, { applyAccent: false });
}

function initCasesFilter() {
  const filterButtons = Array.from(document.querySelectorAll('[data-case-filter]'));
  const caseCards = Array.from(document.querySelectorAll('[data-case-card]'));
  const countEl = document.getElementById('cases-count');
  if (filterButtons.length === 0 || caseCards.length === 0) return;

  const applyFilter = (category) => {
    const updateDom = () => {
      let visibleCount = 0;
      for (const card of caseCards) {
        const matches = category === 'all' || card.dataset.category === category;
        card.hidden = isFalsy(matches);
        if (matches) visibleCount += 1;
      }

      for (const btn of filterButtons) {
        btn.setAttribute('aria-pressed', String(btn.dataset.caseFilter === category));
      }

      if (countEl) {
        countEl.textContent = `Показано примеров: ${visibleCount}`;
      }
    };

    runViewTransition(updateDom, { documentObj: document });
  };

  for (const btn of filterButtons) {
    btn.addEventListener('click', () => {
      applyFilter(btn.dataset.caseFilter || 'all');
    });
  }
}

function initOverlays() {
  const caseDialog = document.getElementById('case-dialog');
  const dialogKicker = document.getElementById('dialog-kicker');
  const dialogMediaImg = document.getElementById('dialog-media-img');
  const dialogTitle = document.getElementById('dialog-title');
  const dialogSummary = document.getElementById('dialog-summary');
  const dialogResult = document.getElementById('dialog-result');
  const dialogTimeline = document.getElementById('dialog-timeline');
  const dialogHighlights = document.getElementById('dialog-highlights');
  const dialogApplyBtn = document.getElementById('dialog-apply-btn');

  const contactsPopover = document.getElementById('contacts-popover');
  const openContactsBtn = document.getElementById('open-contacts-btn');
  const popoverCopyHandleBtn = document.getElementById('popover-copy-handle-btn');

  let lastDialogTrigger = null;
  let currentCaseId = 'case-01';
  let skipFocusReturnOnClose = false;
  let popoverCopyTimer = 0;

  const populateCaseDialog = (caseId) => {
    const data = CASE_DETAILS[caseId] || CASE_DETAILS['case-01'];
    currentCaseId = Object.hasOwn(CASE_DETAILS, caseId) ? caseId : 'case-01';
    if (dialogKicker) dialogKicker.textContent = data.kicker;
    if (dialogMediaImg) {
      dialogMediaImg.src = data.image;
      dialogMediaImg.alt = data.alt;
    }
    if (dialogTitle) dialogTitle.textContent = data.title;
    if (dialogSummary) dialogSummary.textContent = data.summary;
    if (dialogResult) dialogResult.textContent = data.result;
    if (dialogTimeline) dialogTimeline.textContent = data.timeline;
    if (dialogHighlights) {
      const items = (data.highlights || []).map((text) => {
        const li = document.createElement('li');
        li.textContent = text;
        return li;
      });
      dialogHighlights.replaceChildren(...items);
    }
  };

  document.addEventListener('click', (event) => {
    const targetEl = event.target instanceof Element ? event.target : null;
    const trigger = targetEl ? targetEl.closest('.case-detail-btn[data-case-id]') : null;
    if (isFalsy(trigger)) return;
    lastDialogTrigger = trigger;
    populateCaseDialog(trigger.dataset.caseId || 'case-01');
  });

  if (caseDialog) {
    enableDialogLightDismissFallback(caseDialog, { documentObj: document });

    caseDialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      closeTopLayer(caseDialog, { documentObj: document });
    });

    caseDialog.addEventListener('close', () => {
      caseDialog.removeAttribute('data-closing');
      if (skipFocusReturnOnClose) {
        skipFocusReturnOnClose = false;
        return;
      }
      if (lastDialogTrigger && lastDialogTrigger.isConnected) {
        lastDialogTrigger.focus();
      }
    });
  }

  const syncContactsExpanded = (isOpen) => {
    if (openContactsBtn) {
      openContactsBtn.setAttribute('aria-expanded', String(Boolean(isOpen)));
    }
  };

  const isPopoverVisible = (popoverEl) => {
    if (isFalsy(popoverEl)) return false;
    if (supportsNativePopover()) {
      return popoverEl.matches(':popover-open');
    }
    return popoverEl.classList.contains(':popover-open');
  };

  const setFallbackPopoverOpen = (popoverEl, open, { restoreFocus = false } = {}) => {
    if (isFalsy(popoverEl)) return;
    popoverEl.removeAttribute('data-closing');
    popoverEl.classList.toggle(':popover-open', open);
    syncContactsExpanded(open);
    if (isFalsy(open) && restoreFocus && openContactsBtn && openContactsBtn.isConnected) {
      openContactsBtn.focus();
    }
  };

  if (contactsPopover) {
    if (supportsNativePopover()) {
      contactsPopover.addEventListener('toggle', (event) => {
        const isOpen = event.newState === 'open';
        syncContactsExpanded(isOpen);
        if (isFalsy(isOpen) && openContactsBtn && openContactsBtn.isConnected) {
          const active = document.activeElement;
          if (isFalsy(active) || active === document.body || contactsPopover.contains(active)) {
            openContactsBtn.focus();
          }
        }
      });
    } else {
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && isPopoverVisible(contactsPopover)) {
          event.preventDefault();
          setFallbackPopoverOpen(contactsPopover, false, { restoreFocus: true });
        }
      });

      document.addEventListener('click', (event) => {
        if (isFalsy(isPopoverVisible(contactsPopover))) return;
        const target = event.target instanceof Element ? event.target : null;
        if (
          target &&
          (contactsPopover.contains(target) || target.closest('[commandfor="contacts-popover"]'))
        ) {
          return;
        }
        setFallbackPopoverOpen(contactsPopover, false, { restoreFocus: false });
      });
    }
  }

  if (isFalsy(supportsNativeCommands())) {
    document.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const btn = target ? target.closest('button[commandfor][command]') : null;
      if (isFalsy(btn)) return;
      const targetId = btn.getAttribute('commandfor');
      const command = btn.getAttribute('command');
      const targetEl = targetId ? document.getElementById(targetId) : null;
      if (isFalsy(targetEl)) return;

      if (command === 'show-modal' && typeof targetEl.showModal === 'function') {
        if (isFalsy(targetEl.open)) {
          targetEl.removeAttribute('data-closing');
          targetEl.showModal();
        }
      } else if (command === 'close') {
        closeTopLayer(targetEl, { documentObj: document });
      } else if (command === 'toggle-popover') {
        if (supportsNativePopover() && typeof targetEl.togglePopover === 'function') {
          targetEl.togglePopover();
        } else {
          const nextOpen = isFalsy(isPopoverVisible(targetEl));
          setFallbackPopoverOpen(targetEl, nextOpen, { restoreFocus: isFalsy(nextOpen) });
        }
      } else if (command === 'show-popover') {
        if (supportsNativePopover() && typeof targetEl.showPopover === 'function') {
          targetEl.showPopover();
        } else {
          setFallbackPopoverOpen(targetEl, true);
        }
      } else if (command === 'hide-popover') {
        if (supportsNativePopover() && typeof targetEl.hidePopover === 'function') {
          targetEl.hidePopover();
        } else {
          setFallbackPopoverOpen(targetEl, false, { restoreFocus: true });
        }
      }
    });
  } else if (contactsPopover) {
    const internalCloseBtn = contactsPopover.querySelector('[command="hide-popover"]');
    internalCloseBtn?.addEventListener('click', () => {
      window.setTimeout(() => {
        if (isFalsy(isPopoverVisible(contactsPopover)) && openContactsBtn?.isConnected) {
          openContactsBtn.focus();
        }
      }, 0);
    });
  }

  if (popoverCopyHandleBtn) {
    const defaultLabel = popoverCopyHandleBtn.textContent || `Скопировать @${TELEGRAM_USERNAME}`;
    popoverCopyHandleBtn.addEventListener('click', async () => {
      const handle =
        popoverCopyHandleBtn.getAttribute('data-copy-handle') || `@${TELEGRAM_USERNAME}`;
      const copied = await copyTextWithFallback(handle);
      window.clearTimeout(popoverCopyTimer);
      popoverCopyHandleBtn.textContent = copied
        ? 'Ник @SQUZZER_CODER скопирован'
        : 'Скопируйте @SQUZZER_CODER вручную';
      popoverCopyTimer = window.setTimeout(() => {
        popoverCopyHandleBtn.textContent = defaultLabel;
      }, 2600);
    });
  }

  return {
    getCurrentCase: () => CASE_DETAILS[currentCaseId] || CASE_DETAILS['case-01'],
    closeCaseDialogForOrder: async () => {
      skipFocusReturnOnClose = true;
      await closeTopLayer(caseDialog, { documentObj: document });
    },
    dialogApplyBtn,
  };
}

function initEstimateAttachment() {
  const box = document.getElementById('attached-estimate-box');
  const textEl = document.getElementById('attached-estimate-text');
  const inputEl = document.getElementById('attached-estimate-input');
  const clearBtn = document.getElementById('clear-estimate-btn');

  const attachEstimate = (summaryText) => {
    const clean = typeof summaryText === 'string' ? summaryText.trim() : '';
    if (isFalsy(clean)) return;
    if (inputEl) inputEl.value = clean;
    if (textEl) textEl.textContent = clean;
    if (box) box.hidden = false;
  };

  const clearEstimate = () => {
    if (inputEl) inputEl.value = '';
    if (textEl) textEl.textContent = '';
    if (box) box.hidden = true;
  };

  if (clearBtn) {
    clearBtn.addEventListener('click', clearEstimate);
  }

  return {
    attachEstimate,
    clearEstimate,
    getAttachedEstimate: () => inputEl?.value || '',
  };
}

function initCalculator(attachEstimate, revealOrderForm) {
  const checkboxes = Array.from(
    document.querySelectorAll('input[type="checkbox"][data-calc-option]')
  );
  const currencyButtons = Array.from(document.querySelectorAll('[data-currency-btn]'));
  const optionPriceNodes = Array.from(document.querySelectorAll('[data-option-price]'));
  const baseMetaEl = document.getElementById('calc-base-meta');
  const totalPriceEl = document.getElementById('calc-total-price');
  const totalDeadlineEl = document.getElementById('calc-total-deadline');
  const selectedSummaryEl = document.getElementById('calc-selected-summary');
  const calcLiveStatusEl = document.getElementById('calc-live-status');
  const applyBtn = document.getElementById('apply-estimate-btn');

  let currentCurrency = 'RUB';
  let displayedPriceValue = BASE_BOT_PRICE;
  let priceRafId = 0;
  let lastLiveAnnouncement = '';

  const getSelectedKeys = () =>
    checkboxes.filter((box) => box.checked).map((box) => box.value);

  const formatAnimatedPrice = (numericVal, currency) =>
    currency === 'USDT'
      ? `~ ${Math.max(1, Math.round(numericVal))} USDT`
      : `~ ${formatPrice(numericVal)} р`;

  const updateTotalPriceDisplay = (estimate, animate) => {
    if (isFalsy(totalPriceEl)) return;
    const targetValue =
      estimate.currency === 'USDT' ? estimate.usdtApprox : estimate.totalPrice;

    if (priceRafId) {
      window.cancelAnimationFrame(priceRafId);
      priceRafId = 0;
    }

    if (isFalsy(animate) || prefersReducedMotion() || displayedPriceValue === targetValue) {
      displayedPriceValue = targetValue;
      totalPriceEl.textContent = estimate.formattedPrice;
      return;
    }

    const startValue = displayedPriceValue;
    const delta = targetValue - startValue;
    const startTime = performance.now();

    const step = (now) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, Math.max(0, elapsed / PRICE_ANIMATION_MS));
      const eased = 1 - Math.pow(1 - progress, 3);
      displayedPriceValue = startValue + delta * eased;

      if (progress >= 1) {
        displayedPriceValue = targetValue;
        totalPriceEl.textContent = estimate.formattedPrice;
        priceRafId = 0;
        return;
      }

      totalPriceEl.textContent = formatAnimatedPrice(
        displayedPriceValue,
        estimate.currency
      );
      priceRafId = window.requestAnimationFrame(step);
    };

    priceRafId = window.requestAnimationFrame(step);
  };

  const renderCalculator = ({ animate = false, announce = false } = {}) => {
    const estimate = calculateEstimate(getSelectedKeys(), currentCurrency);

    if (baseMetaEl) {
      if (currentCurrency === 'USDT') {
        const baseUsdt = Math.max(1, Math.round(BASE_BOT_PRICE / USDT_RATE_RUB));
        baseMetaEl.textContent = `~ ${baseUsdt} USDT, 1 день`;
      } else {
        baseMetaEl.textContent = `~ ${formatPrice(BASE_BOT_PRICE)} р, 1 день`;
      }
    }

    for (const node of optionPriceNodes) {
      const key = node.dataset.optionPrice || '';
      const opt = OPTIONS_BY_KEY.get(key);
      if (isFalsy(opt)) continue;

      if (currentCurrency === 'USDT') {
        const deltaUsdt = Math.max(1, Math.round(opt.price / USDT_RATE_RUB));
        node.textContent =
          opt.key === 'urgent'
            ? `+~ ${deltaUsdt} USDT, ускорение срока`
            : `+~ ${deltaUsdt} USDT, +${opt.extraHours} ч`;
      } else {
        node.textContent =
          opt.key === 'urgent'
            ? `+${formatPrice(opt.price)} р, ускорение срока`
            : `+${formatPrice(opt.price)} р, +${opt.extraHours} ч`;
      }
    }

    for (const btn of currencyButtons) {
      btn.setAttribute(
        'aria-pressed',
        String(btn.dataset.currencyBtn === currentCurrency)
      );
    }

    updateTotalPriceDisplay(estimate, animate);
    if (totalDeadlineEl) totalDeadlineEl.textContent = estimate.formattedDeadline;
    if (selectedSummaryEl) {
      const names = estimate.selectedOptions.map((opt) => opt.shortTitle).join(', ');
      selectedSummaryEl.textContent = names
        ? `Выбрано: ${names}`
        : 'Выбрано: Базовый бот';
    }

    if (announce && calcLiveStatusEl) {
      const statusText = `${estimate.formattedPrice}, ${estimate.formattedDeadline}`;
      if (isNotEqual(statusText, lastLiveAnnouncement)) {
        lastLiveAnnouncement = statusText;
        calcLiveStatusEl.textContent = statusText;
      }
    }

    return estimate;
  };

  for (const checkbox of checkboxes) {
    checkbox.addEventListener('change', () => {
      renderCalculator({ animate: true, announce: true });
    });
  }

  for (const btn of currencyButtons) {
    btn.addEventListener('click', () => {
      currentCurrency = btn.dataset.currencyBtn === 'USDT' ? 'USDT' : 'RUB';
      renderCalculator({ animate: true, announce: true });
    });
  }

  if (applyBtn) {
    applyBtn.addEventListener('click', () => {
      const estimate = calculateEstimate(getSelectedKeys(), currentCurrency);
      attachEstimate(estimate.summaryLine);
      revealOrderForm();
      scrollToElement(document.getElementById('order'));
    });
  }

  renderCalculator({ animate: false, announce: false });
}

function initBriefForm(getAttachedEstimate) {
  const form = document.getElementById('brief-form');
  const nameInput = document.getElementById('brief-name');
  const contactInput = document.getElementById('brief-contact');
  const taskInput = document.getElementById('brief-task');
  const websiteInput = document.getElementById('brief-website');
  const liveStatus = document.getElementById('form-live-status');
  const resultBox = document.getElementById('brief-result');
  const previewEl = document.getElementById('brief-preview');
  const tgSendLink = document.getElementById('telegram-send-link');
  const copyBtn = document.getElementById('copy-brief-btn');
  const copyHandleBtn = document.getElementById('copy-handle-btn');
  const editBtn = document.getElementById('edit-brief-btn');
  const copyStatusEl = document.getElementById('copy-status');

  if (isFalsy(form) || isFalsy(nameInput) || isFalsy(contactInput) || isFalsy(taskInput)) {
    return { revealOrderForm: () => {} };
  }

  form.noValidate = true;

  const fields = [
    { key: 'name', input: nameInput },
    { key: 'contact', input: contactInput },
    { key: 'task', input: taskInput },
  ];

  const hasNativeUserInvalid = supportsUserInvalidSelector();
  const interactedFields = new WeakSet();
  const announcedFields = new WeakSet();

  let announceTimer = 0;
  let lastAnnouncedField = null;
  let copyTimer = 0;
  let lastCopyAnnouncement = '';

  const linkError = (input, shown) => {
    const errorId = input.dataset.error;
    if (isFalsy(errorId)) return;
    const current = (input.getAttribute('aria-describedby') || '')
      .split(/\s+/)
      .filter((id) => Boolean(id) && isNotEqual(id, errorId));
    if (shown) {
      current.push(errorId);
    }
    if (current.length > 0) {
      input.setAttribute('aria-describedby', current.join(' '));
    } else {
      input.removeAttribute('aria-describedby');
    }
  };

  const announceFieldError = (input, errorText) => {
    if (isFalsy(liveStatus) || isFalsy(errorText)) return;
    const labelText = input.labels?.[0]
      ? input.labels[0].textContent.replace(/\*/g, '').replace(/\s+/g, ' ').trim()
      : '';
    const message = labelText ? `${labelText}: ${errorText}` : errorText;

    window.clearTimeout(announceTimer);
    liveStatus.textContent = '';
    lastAnnouncedField = input;
    announceTimer = window.setTimeout(() => {
      liveStatus.textContent = message;
    }, 500);
  };

  const getFieldValidation = (key) => {
    const result = validateBriefPayload({
      name: nameInput.value,
      contact: contactInput.value,
      task: taskInput.value,
      website: '',
    });
    return {
      isValid: isFalsy(result.errors[key]),
      errorMsg: result.errors[key] || '',
    };
  };

  const applyFieldState = (field, { showErrors = false, announce = false } = {}) => {
    const { key, input } = field;
    const errorEl = input.dataset.error
      ? document.getElementById(input.dataset.error)
      : null;
    const { isValid, errorMsg } = getFieldValidation(key);

    if (isValid) {
      input.setCustomValidity('');
      input.setAttribute('aria-invalid', 'false');
      linkError(input, false);
      if (errorEl) {
        errorEl.textContent = '';
        errorEl.hidden = true;
      }
      input.classList.remove('user-invalid-fallback');
      if (isFalsy(hasNativeUserInvalid) && interactedFields.has(input)) {
        input.classList.add('user-valid-fallback');
      }
      announcedFields.delete(input);
      if (lastAnnouncedField === input && liveStatus) {
        window.clearTimeout(announceTimer);
        liveStatus.textContent = '';
      }
      return true;
    }

    if (isFalsy(showErrors)) {
      input.setCustomValidity('');
      return false;
    }

    input.setCustomValidity(errorMsg);
    input.setAttribute('aria-invalid', 'true');
    linkError(input, true);
    if (errorEl) {
      errorEl.textContent = errorMsg;
      errorEl.hidden = false;
    }

    input.classList.remove('user-valid-fallback');
    if (isFalsy(hasNativeUserInvalid) || isFalsy(input.matches(':user-invalid'))) {
      input.classList.add('user-invalid-fallback');
    }

    if (announce && isFalsy(announcedFields.has(input))) {
      announceFieldError(input, errorMsg);
      announcedFields.add(input);
    }
    return false;
  };

  const resetFormStates = () => {
    window.clearTimeout(announceTimer);
    if (liveStatus) liveStatus.textContent = '';
    for (const { input } of fields) {
      interactedFields.delete(input);
      announcedFields.delete(input);
      input.setCustomValidity('');
      input.setAttribute('aria-invalid', 'false');
      linkError(input, false);
      input.classList.remove('user-invalid-fallback', 'user-valid-fallback');
      const errorEl = input.dataset.error
        ? document.getElementById(input.dataset.error)
        : null;
      if (errorEl) {
        errorEl.textContent = '';
        errorEl.hidden = true;
      }
    }
  };

  resetFormStates();

  for (const field of fields) {
    const { input } = field;

    input.addEventListener('input', () => {
      input.setCustomValidity('');
      const hasShownError =
        interactedFields.has(input) || input.getAttribute('aria-invalid') === 'true';

      if (hasShownError) {
        applyFieldState(field, { showErrors: true, announce: false });
      } else {
        input.setAttribute('aria-invalid', 'false');
        linkError(input, false);
      }
    });

    input.addEventListener('blur', () => {
      interactedFields.add(input);
      applyFieldState(field, { showErrors: true, announce: true });
    });

    input.addEventListener('invalid', () => {
      interactedFields.add(input);
      announcedFields.add(input);
      applyFieldState(field, { showErrors: true, announce: false });
    });

    if (input.tagName === 'INPUT') {
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && (event.isComposing || event.keyCode === 229)) {
          event.preventDefault();
        }
      });
    }
  }

  form.addEventListener('reset', () => {
    window.setTimeout(resetFormStates, 0);
  });

  const revealOrderForm = ({ focusName = false } = {}) => {
    if (resultBox) resultBox.hidden = true;
    form.hidden = false;
    if (focusName) {
      nameInput.focus();
    }
  };

  const ensureRateLimitNotice = (message) => {
    let note = document.getElementById('form-rate-limit-note');
    if (isFalsy(message)) {
      if (note) {
        note.textContent = '';
        note.hidden = true;
      }
      return;
    }
    if (isFalsy(note)) {
      note = document.createElement('p');
      note.id = 'form-rate-limit-note';
      note.className = 'field-error';
      const actions = form.querySelector('.form-actions');
      if (actions) {
        actions.after(note);
      } else {
        form.append(note);
      }
    }
    note.textContent = message;
    note.hidden = false;
  };

  const showCopyFeedback = (btn, copied, successMessage) => {
    window.clearTimeout(copyTimer);
    let message = copied
      ? successMessage
      : 'Не удалось скопировать автоматически, выделите текст выше вручную.';

    if (message === lastCopyAnnouncement) {
      message += '\u00A0';
    }
    lastCopyAnnouncement = message;

    for (const candidateBtn of [copyBtn, copyHandleBtn]) {
      if (isFalsy(candidateBtn)) continue;
      candidateBtn.removeAttribute('data-copied');
      candidateBtn.removeAttribute('data-failed');
    }

    if (btn) {
      btn.setAttribute(copied ? 'data-copied' : 'data-failed', '');
    }

    if (copyStatusEl) {
      copyStatusEl.textContent = '';
      window.requestAnimationFrame(() => {
        copyStatusEl.textContent = message;
      });
    }

    copyTimer = window.setTimeout(() => {
      if (btn) {
        btn.removeAttribute('data-copied');
        btn.removeAttribute('data-failed');
      }
      if (copyStatusEl) copyStatusEl.textContent = '';
    }, 3000);
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    ensureRateLimitNotice('');

    const payload = {
      name: nameInput.value,
      contact: contactInput.value,
      task: taskInput.value,
      website: websiteInput ? websiteInput.value : '',
    };

    const validation = validateBriefPayload(payload);
    if (validation.honeypotTriggered) {
      form.reset();
      if (resultBox) resultBox.hidden = true;
      return;
    }

    if (isFalsy(validation.ok)) {
      let firstInvalidInput = null;
      for (const field of fields) {
        interactedFields.add(field.input);
        announcedFields.add(field.input);
        const isFieldValid = applyFieldState(field, {
          showErrors: true,
          announce: false,
        });
        if (isFalsy(isFieldValid) && isFalsy(firstInvalidInput)) {
          firstInvalidInput = field.input;
        }
      }
      if (firstInvalidInput) {
        firstInvalidInput.focus();
      }
      return;
    }

    const now = Date.now();
    try {
      const lastTs = Number(sessionStorage.getItem(RATE_LIMIT_STORAGE_KEY) || '0');
      if (lastTs && now - lastTs < RATE_LIMIT_MS) {
        const waitSec = Math.max(1, Math.ceil((RATE_LIMIT_MS - (now - lastTs)) / 1000));
        const limitMessage = `Подождите ${waitSec} сек перед повторной подготовкой заявки.`;
        ensureRateLimitNotice(limitMessage);
        if (liveStatus) liveStatus.textContent = limitMessage;
        return;
      }
      sessionStorage.setItem(RATE_LIMIT_STORAGE_KEY, String(now));
    } catch {
      // Allow submission when sessionStorage is restricted.
    }

    const briefText = buildBriefText({
      ...validation.sanitized,
      estimateSummary: getAttachedEstimate(),
    });
    const telegramUrl = buildTelegramBriefUrl(briefText);

    if (previewEl) previewEl.textContent = briefText;
    if (tgSendLink) tgSendLink.setAttribute('href', telegramUrl);
    if (copyStatusEl) copyStatusEl.textContent = '';

    form.hidden = true;
    if (resultBox) resultBox.hidden = false;

    if (liveStatus) {
      liveStatus.textContent = 'Заявка готова к отправке в Telegram.';
    }
    if (previewEl) {
      previewEl.focus();
    }
  });

  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      const text = previewEl ? previewEl.textContent.trim() : '';
      if (isFalsy(text)) return;
      const copied = await copyTextWithFallback(text);
      showCopyFeedback(copyBtn, copied, 'Текст заявки скопирован в буфер обмена.');
    });
  }

  if (copyHandleBtn) {
    copyHandleBtn.addEventListener('click', async () => {
      const copied = await copyTextWithFallback(`@${TELEGRAM_USERNAME}`);
      showCopyFeedback(
        copyHandleBtn,
        copied,
        'Ник @SQUZZER_CODER скопирован в буфер обмена.'
      );
    });
  }

  if (editBtn) {
    editBtn.addEventListener('click', () => {
      revealOrderForm({ focusName: true });
    });
  }

  return { revealOrderForm };
}

function initQuickTopics(attachEstimate, revealOrderForm, setStageScene) {
  const buttons = Array.from(document.querySelectorAll('[data-quick-topic]'));
  for (const btn of buttons) {
    btn.addEventListener('click', () => {
      const topicKey = btn.dataset.quickTopic || 'bot';
      const config = QUICK_TOPICS[topicKey] || QUICK_TOPICS.bot;
      if (config.scene) {
        setStageScene(config.scene, { transition: true });
      }
      attachEstimate(config.summary);
      if (config.targetSelector === '#order') {
        revealOrderForm();
      }
      scrollToElement(document.querySelector(config.targetSelector));
    });
  }
}

export function initStudio() {
  if (typeof document === 'undefined') return;

  if (isFalsy(prefersReducedMotion())) {
    document.documentElement.classList.add('motion-ready');
  }

  const ambientShader = initAmbientShader({
    canvas: document.getElementById('stage-backdrop-canvas'),
    fallbackTarget: document.documentElement,
    preset: 'alabaster',
    windowObj: window,
    documentObj: document,
  });

  const hero3d = initHero3D({
    canvas: document.getElementById('hero-3d-canvas'),
    fallbackEl: document.getElementById('hero-3d-fallback'),
    sectionEl: document.getElementById('hero'),
    paletteName: 'alabaster',
    windowObj: window,
    documentObj: document,
  });

  initHero3DControls(hero3d);

  initScrollChoreography({
    documentObj: document,
    windowObj: window,
    onScrollChange: (progress01, heroProgress01) => {
      ambientShader.setScrollProgress(progress01);
      hero3d.setScrollProgress(heroProgress01);
    },
    onActChange: (actIndex) => {
      ambientShader.setAct(actIndex);
    },
  });

  initOpticalSurfaceSpotlight();
  const stageApi = initShowcaseStage();
  initServicesCatalog(ambientShader);
  const overlays = initOverlays();
  initCasesFilter();
  const estimateAttachment = initEstimateAttachment();
  const formApi = initBriefForm(estimateAttachment.getAttachedEstimate);
  initCalculator(estimateAttachment.attachEstimate, formApi.revealOrderForm);
  initQuickTopics(
    estimateAttachment.attachEstimate,
    formApi.revealOrderForm,
    stageApi.setStageScene
  );

  if (overlays.dialogApplyBtn) {
    overlays.dialogApplyBtn.addEventListener('click', async () => {
      const activeCase = overlays.getCurrentCase();
      estimateAttachment.attachEstimate(activeCase.estimateLabel);
      await overlays.closeCaseDialogForOrder();
      formApi.revealOrderForm({ focusName: true });
      scrollToElement(document.getElementById('order'));
    });
  }
}

if (isNotEqual(typeof document, 'undefined')) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initStudio, { once: true });
  } else {
    initStudio();
  }
}
