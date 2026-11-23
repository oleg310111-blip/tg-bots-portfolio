"""Smart Russian/English lead classifier for Telegram freelance hunting.

Classifies incoming Telegram messages into:
- ``CLIENT_BOT``: real buyer request (HOT or WARM) for Telegram bot, parser, script, or automation.
- ``CLIENT_MOTION``: real buyer request (HOT or WARM) for Shorts / Reels / YouTube editing or motion graphics.
- ``IGNORE``: executor self-promo, portfolio cases, HR fulltime/outstaff vacancies, product sellers,
  coder-to-coder tech questions, spam, crypto/casino scams, aggregators, or off-topic.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
import re
from typing import Literal

TrackType = Literal["CLIENT_BOT", "CLIENT_MOTION", "IGNORE"]
LeadTier = Literal["HOT", "WARM", "NONE"]


@dataclass(frozen=True)
class ClassificationResult:
    """Structured classification output for a single Telegram message."""

    track: TrackType
    is_lead: bool
    score: int
    matched_reasons: list[str]
    suggested_reply: str
    lead_tier: LeadTier = "NONE"
    speaker_role: str = ""
    task_summary: str = ""

    def to_dict(self) -> dict[str, object]:
        """Return a JSON-serializable dictionary representation."""
        return asdict(self)


# ---------------------------------------------------------------------------
# Stage 2A: Hard Spam / Scam / Infobiz / Aggregator / HR Filters
# ---------------------------------------------------------------------------

_SPAM_SCAM_PATTERNS: list[tuple[str, str, re.Pattern[str]]] = [
    (
        "спам: казино/ставки",
        "SPAM_SCAM",
        re.compile(r"\b(?:казино|casino|ставки\s+на\s+спорт|букмекер|игров\w+\s+слот\w*|онлайн[- ]?слот\w*|слоты\s+казино|фриспин\w*|рулетк\w+|1xbet|melbet)\b", re.I),
    ),
    (
        "спам: крипто-схемы/сигналы",
        "SPAM_SCAM",
        re.compile(r"\b(?:сигналы\s+крипт\w*|арбитраж\s+крипт\w*|p2p\s+связк\w*|пампы|airdrop|аирдроп|темк[аиу]\s+на\s+крипт\w*)\b", re.I),
    ),
    (
        "спам: легкий заработок/без вложений",
        "SPAM_SCAM",
        re.compile(r"(?:заработок\s+(?:без\s+вложений|от\s+\d+)|пассивный\s+доход|быстрые\s+деньги|работа\s+без\s+опыта\s+от\s+\d+|пиши\s+в\s+лс\s+слово)", re.I),
    ),
    (
        "инфобиз: курсы/вебинары",
        "INFOBIZ",
        re.compile(
            r"(?:бесплатный\s+(?:вебинар|марафон|интенсив)|слив\s+курса|научу\s+зарабатывать|"
            r"приглашаю\s+на\s+курс|купить\s+курс|пахать\s+5/2|ученики\s+влада|"
            r"по\s+пошаговой\s+инструкции|приглашаю\s+на\s+обучение|выспался\.\s+создал|"
            r"проснулся\.\s+зашел|хватит\s+искать\s+работу)",
            re.I,
        ),
    ),
    (
        "спам: 18+/запрещенка",
        "SPAM_SCAM",
        re.compile(r"(?:интим|эскорт|вебкам|webcam|onlyfans\s+модел|кладмен|закладк\w+)", re.I),
    ),
    (
        "агрегатор со скрытым контактом",
        "AGGREGATOR",
        re.compile(
            r"(?:\[\s*контакт\s+скрыт\s*\]|\[\s*ссылка\s+скрыта\s*\]|\bконтакт\s+скрыт\b|"
            r"заберите\s+(?:этот\s+)?заказ(?:\s+раньше\s+всех)?|"
            r"@(?:freelance_flowbot|freelance_find_bot|weekfreelance_bot|wflmanager_bot|search_leads_bot|freelancerai_bot)\b|"
            r"\bleadradar\b|"
            r"контакт\s+заказчика\s*[—\-–:]?\s*в\s+|контакт\s+в\s+боте|"
            r"откликнуться\s+(?:в|через)\s+бот[ае]?|перейти\s+в\s+бот|"
            r"получить\s+контакт|открыть\s+контакт|доступ\s+к\s+(?:контактам|заказам)|"
            r"купить\s+(?:отклик|доступ|тариф)|\bконнект(?:ы|ов|ами)?\b|\bconnects\b|"
            r"vip[- ]?доступ|подписк[ауеи]\s+на\s+заказы|"
            r"устали\s+от\s+бирж|(?:telegram|телеграм)\s+бот\s+с\s+заказами)",
            re.I,
        ),
    ),
    (
        "платная биржа / агрегатор заказов (Kwork/Profi/YouDo/FL/Workzilla)",
        "AGGREGATOR",
        re.compile(
            r"(?:открыть\s+на\s+kwork|kwork\.ru|\bкворк(?:е|а|у)?\b|"
            r"\b\d+\s+просм\.|\bпредл\.\s*\||"
            r"задачи\s+чат[- ]?бота\s*:|техзадания\s+нет|техзадание\s+есть|"
            r"пожелания\s+и\s+особенности\s*:|платформа\s*:\s*telegram|рейтинг\s+заказчика\s*:|"
            r"profi\.ru|\bпрофи\.ру\b|"
            r"youdo\.com|\byoudo\b|\bюду\b|"
            r"\bfl\.ru\b|freelance\.ru|freelance\.habr\.com|"
            r"work-?zilla\.com|\bworkzilla\b|\bворкзилл\w*\b|"
            r"freelancehunt\.com|\bfreelancehunt\b|"
            r"upwork\.com|fiverr\.com|"
            r"источник\s*:\s*(?:youdo|kwork|profi|fl\.ru|workzilla|freelancehunt|workspace|habr))",
            re.I,
        ),
    ),
    (
        "HR-вакансия в штат/офис/outstaff",
        "HR_VACANCY",
        re.compile(
            r"(?:\bв\s+штат\b|\bофициальное\s+трудоустройство\b|\bполный\s+рабочий\s+день\b|"
            r"\bграфик\s+5/2\b|\bоформление\s+по\s+тк\b|\bдмс\b|\bсоцпакет\b|"
            r"\bfull[- ]?time\b|\bфулл[- ]?тайм\b|\bфултайм\b|\boutstaff\b|\bаутстафф\b|"
            r"\bиспытательн\w+\s+срок\w*\b|\bв\s+офис\b|\bгибридн\w+\s+формат\b|"
            r"занятость\s*:\s*(?:полная|full\s*time)|формат\s+работы\s*:\s*(?:outstaff|офис|гибрид)|"
            r"(?:^|\s)#(?:fulltime|офис|гибрид)\b|\b(?:з/?п|оклад)\s*(?:от|до)\s*\d+)",
            re.I,
        ),
    ),
    (
        "рекрутер / набор в команду / мультивакансия",
        "HR_VACANCY",
        re.compile(
            r"(?:\bрекрутер\b|открыты\s+вакансии\s+[\w\s\-]+к\s+разным\s+заказчикам|"
            r"(?:срочно\s+)?ищ(?:у|ем)\s+(?:людей|сотрудников|специалистов)\s+в\s+команду|"
            r"\bкого\s+рассматриваем\s*:|открыт\s+набор\s+в\s+[\w\-]*команду|"
            r"\bищем\s*:\s*\n[\s\S]{0,300}?(?:копирайтер|smm|дизайнер|менеджер)|"
            r"открываю\s+доступ\s+к\s+боту\s+с\s+шаблонами)",
            re.I,
        ),
    ),
]

# Portfolio cases & finished project showcases (e.g. aie_make, agency blogs)
_CASE_STUDY_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    (
        "кейс/портфолио: структура Проект + Задача/Решение/Стек",
        re.compile(
            r"(?:^|\n)\s*проект\s*:\s*[^\n]+[\s\S]{0,600}?(?:задача\s*:|решение\s*:|стек\s*:|архитектура\s+решения\s*:|результат\s*:)",
            re.I,
        ),
    ),
    (
        "кейс/портфолио: отчёт о собранном боте/решении",
        re.compile(
            r"(?:\b(?:собрал|реализовал|настроил|разработал|запустил|сделал)\s+(?:рабоч\w+|полноценн\w+|такого|свой)\s+(?:telegram[- ]?|тг[- ]?|чат[- ]?)?бот\w*|"
            r"первый\s+автоматизированный\s+пост|ключевые\s+решения\s*:|"
            r"(?:^|\n)\s*(?:делюсь\s+кейсом|кейс(?:\s+по|\s*:)|разбор\s+кейса|как\s+я\s+(?:сделал|собрал|настроил|автоматизировал))|"
            r"(?:^|\n)\s*стек\s*:[\s\S]{0,200}?(?:notion|make|integromat|n8n|telegram\s+bot))",
            re.I,
        ),
    ),
]

# Ready-made product / template / SaaS / bot-builder sellers
_SELLER_PRODUCT_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    (
        "продажа готового бота/скрипта/шаблона",
        re.compile(
            r"(?:\bпродам\s+(?:[\w\-]+\s+){0,2}(?:бот\w*|скрипт\w*|шаблон\w*|канал\w*)|"
            r"\bпродаю\s+(?:[\w\-]+\s+){0,3}(?:шаблон\w*|бот\w*|скрипт\w*)|"
            r"\bготовый\s+(?:бот|скрипт)\b|\bв\s+наличии\s+\d*\s*(?:telegram[- ]?|тг[- ]?)?бот\w*|"
            r"подключи(?:те)?\s+бота\s+за|попробуйте\s+(?:сервис|наш\w*\s+бот)|"
            r"конструктор\s+ботов|магазин\s+шаблонов|"
            r"ознакомиться\s+можно\s+в\s+прикрепленном\s+файле|"
            r"(?:цена\s*:\s*\d+\s*[₽руб$][\s\S]{0,120}?купить\s*:))",
            re.I,
        ),
    ),
]

# Coder-to-coder technical help questions (NOT paying clients)
_CODER_QUESTION_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    (
        "вопрос кодера коллегам: ошибка/стекбек",
        re.compile(
            r"(?:\btraceback\b|\bexception\b|почему\s+(?:ошибка|падает|вылетает|отлетает|не\s+работает\s+(?:код|бот|скрипт|парсер|хендлер))|"
            r"ошибк[ауи]\s+в\s+(?:коде|скрипте|aiogram|telethon|pyrogram|python)|"
            r"как\s+(?:исправить|пофиксить|решить|обойти)\s+[\w\s\-]{0,35}(?:aiogram|telethon|pyrogram|pydantic|django|selenium|playwright|капч|парсер|бот)|"
            r"подскажите\s+(?:библиотеку|либу|пакет|метод|функцию|документацию|как\s+в\s+(?:aiogram|telethon|pyrogram|python))|"
            r"какой\s+хостинг\s+(?:выбрать\s+)?для\s+бота|"
            r"у\s+кого\s+есть\s+(?:код|исходник|пример\s+кода)|"
            r"как\s+вообще\s+начать\s+парсинг|"
            r"аналог\s+tgstat|"
            r"на\s+каких\s+сайтах\s+можно\s+находить\s+(?:проекты|заказы))",
            re.I,
        ),
    ),
]

_SELF_PROMO_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("самореклама: сделаю/напишу/разработаю", re.compile(r"\b(?:сделаю|напишу|разработаю|соберу|создам)\s+(?:быстро\s+и\s+качественно|(?:для\s+вас\s+|вам\s+)?(?:тг[- ]?бот\w*|telegram[- ]?бот\w*|чат[- ]?бот\w*|бот\w*|монтаж|ролик\w*|видео|парсер\w*|скрипт\w*|шортс\w*|рилс\w*))", re.I)),
    ("самореклама: разрабатываю/создаю/пишу", re.compile(r"\b(?:разрабатываю|разрабатываем|создаю|созда[её]м|собираю|пишу|настраиваю)\s+(?:(?:программн\w+|цифров\w+|it)[- ]?решени\w*|решени\w*\s+под\s+ваши\s+задачи|тг[- ]?бот\w*|telegram[- ]?бот\w*|чат[- ]?бот\w*|бот\w*|сайты|парсер\w*|скрипт\w*|веб[- ]?сервис\w*)", re.I)),
    ("самореклама: что могу сделать / готовый результат", re.compile(r"(?:что\s+(?:я\s+)?могу\s+сделать\s*:|\bвы\s+получаете\s+(?:понятный\s+результат|готовый)|что\s+мы\s+предлагаем\s*:|что\s+умею\s*:|чем\s+могу\s+быть\s+полезен)", re.I)),
    ("самореклама: монтирую/делаю монтаж", re.compile(r"\b(?:монтирую|автоматизирую|делаю\s+(?:под\s+ключ|монтаж|ботов|скрипты|парсеры|шортсы|рилсы|ролики|лендинги)|занимаюсь\s+(?:монтажом|разработкой|созданием\s+ботов|внедрением\s+ии|моушн))\b", re.I)),
    ("самореклама: предлагаю услуги", re.compile(r"\b(?:предлагаю\s+(?:свои\s+)?услуги|мои\s+услуги|оказываю\s+услуги|выполню\s+заказ\w*|помогу\s+с\s+(?:разработкой|монтажом)|помогу\s+убрать\s+рутину|закрываю\s+техчасть|беру\s+техничку\s+на\s+себя|работаю\s+по\s+этапам|смотреть\s+кейсы|что\s+(?:я\s+)?могу\s+(?:создать|сделать)\s+для\s+вас|чем\s+помогу\s+вашему\s+бизнесу|если\s+нуж(?:ен|на|но)\s+[\w\s\-]{0,40}пишите\s+в\s+(?:лс|личк|личные\s+сообщения))\b", re.I)),
    ("самореклама: возьму заказ/свободен", re.compile(r"\b(?:возьму\s+(?:заказ\w*|в\s+работу|проект\w*)|свободен\s+для\s+заказ\w*|открыт\s+(?:к|для)\s+заказ\w*|жду\s+ваших\s+заказ\w*|готов\s+выполнить\s+работу)\b", re.I)),
    ("самореклама: ищу работу/клиентов", re.compile(r"\bищу\s+(?:[\w\-]+\s+){0,3}(?:работу|заказы|подработку|клиентов|первых\s+клиентов|экспертов|бренды|блогеров|партн[её]рство|технологического\s+партн[её]ра)\b|\bв\s+поиске\s+(?:работы|заказов)\b", re.I)),
    ("самореклама: представление/опыт/портфолио", re.compile(r"(?:(?:мо[её]|наше)\s+портфолио|пришлю\s+(?:вам\s+)?портфолио|портфолио\s+[—\-–]\s*в\s+профиле|из\s+портфолио\s*:|вот\s+мо[ий]\s+(?:работы|кейсы|примеры)|мой\s+(?:стек|опыт\s+работы)|прайс[- ]?лист\s*:|пишите\s+в\s+лс\s+за\s+примерами|\b\d+\s+(?:год|года|лет)\s+(?:коммерческого\s+)?опыта\b|(?:привет|здравствуйте),?\s+я\s+[А-ЯЁA-Z][а-яёa-z]+|меня\s+зовут\s+[А-ЯЁA-Z]|я\s+(?:веб[- ]?|fullstack[- ]?|python[- ]?)?разработчик|команда\s+разработчиков|студия\s+(?:цифровой\s+)?разработки|работаю\s+строго\s+по\s+тз|беру\s+ниже\s+рынка|услуги\s+кодера|обсудим\s+задачу,?\s+сроки)", re.I)),
    ("самореклама: хештег услуг/резюме", re.compile(r"(?:^|\s)#(?:резюме|услуги|предлагаю|исполнитель|портфолио|моиуслуги|помогу|ямогу|интро|cv|техспец)\b", re.I)),
    ("самореклама (EN): for hire / will build", re.compile(r"\b(?:for\s+hire|available\s+for\s+(?:work|hire|commissions)|i\s+will\s+(?:build|make|create|edit)|my\s+portfolio)\b", re.I)),
]

# ---------------------------------------------------------------------------
# Stage 2B: HOT vs WARM Buyer Intent & Domain Patterns
# ---------------------------------------------------------------------------

_BUYER_INTENT_PATTERNS: list[tuple[str, int, re.Pattern[str]]] = [
    (
        "запрос: нужен/нужна/нужно",
        30,
        re.compile(
            r"(?<!если\s)\bнуж(?:ен|на|но|ны)\s+(?:[\w\-]+\s+){0,3}?"
            r"(?:человек|прогер\w*|программист\w*|разработчик\w*|кодер\w*|исполнитель\w*|"
            r"монтаж[её]р\w*|моушн\w*|дизайнер\w*|специалист\w*|"
            r"(?:тг[- ]?|telegram[- ]?|tg[- ]?|чат[- ]?|ии[- ]?|ai[- ]?)?бот\w*|"
            r"скрипт\w*|парсер\w*|монтаж|ролик\w*)",
            re.I,
        ),
    ),
    (
        "запрос: ищу/ищем специалиста",
        30,
        re.compile(
            r"\bищ(?:у|ем|ут)\s+(?:человека|прогера|программиста|разработчика|кодера|исполнителя|"
            r"креативн\w+\s+монтаж[её]ра|монтаж[её]ра|моушн\w*|дизайнера|специалиста|фрилансера|подрядчика|кто\s+)",
            re.I,
        ),
    ),
    (
        "запрос: требуется специалист/разработка",
        28,
        re.compile(
            r"\bтребуется\s+(?:разработчик\w*|программист\w*|монтаж[её]р\w*|моушн\w*|дизайнер\w*|специалист\w*|"
            r"создать|сделать|разработать|написать|смонтировать|настроить|помощь\s+в)",
            re.I,
        ),
    ),
    (
        "запрос: кто может/умеет/сделает",
        28,
        re.compile(
            r"\bкто\s+(?:может|сможет|умеет|возьм[её]тся|напишет|пишет|смонтирует|монтирует|сделает|делает|собер[её]т|настроит|занимается)\b",
            re.I,
        ),
    ),
    (
        "запрос: нужно/создать/разработать",
        28,
        re.compile(
            r"(?:\b(?:нужно|надо|необходимо|хочу|планирую)\s+(?:написать|сделать|разработать|собрать|создать|настроить|смонтировать|оформить|нарезать|повторить|скопировать)\b|"
            r"(?:^|\n)\s*(?:создать|разработать|написать|сделать|скопировать|настроить)\s+(?:[\w\-]+\s+){0,3}(?:(?:тг[- ]?|telegram[- ]?|чат[- ]?|ии[- ]?)?бот\w*|программ\w*|систем\w*|сервис\w*|парсер\w*|скрипт\w*)|"
            r"(?:^|\n)\s*разработка\s+(?:чат[- ]?бот\w*|telegram[- ]?бот\w*|тг[- ]?бот\w*|ии[- ]?(?:ассистент\w*|бот\w*|менеджер\w*|инструмент\w*))|"
            r"задача\s+для\s+исполнителя\s*:|задачи\s+чат-бота\s*:)",
            re.I,
        ),
    ),
    ("запрос: посоветуйте/подскажите", 20, re.compile(r"\b(?:посоветуйте|подскажите)\s+(?:кто|хорошего|толкового|прогера|разработчика|монтаж[её]ра)", re.I)),
    ("запрос: задача/вакансия/проект", 24, re.compile(r"(?:\bзадача\s*:|\bтип\s+работы\s*:\s*разовая|\bпроектная\s+работа\b|\bposition\s*:|просьба\s+откликаться|📁\s*скрипты,\s*боты\s+и\s+mini\s*apps)", re.I)),
    ("хештег заказа/вакансии", 14, re.compile(r"(?:^|\s)#(?:заказ|вакансия|ищу|проект|поиск)\b", re.I)),
    ("запрос (EN): looking for / hiring / need", 28, re.compile(r"\b(?:looking\s+for|need\s+(?:a|an|someone\s+to)|hiring|seeking\s+(?:a|an)|who\s+can\s+(?:build|create|edit|make))\b", re.I)),
]

# Warm buyer inquiry patterns (consulting / pricing / feasibility before hiring)
_WARM_INQUIRY_PATTERNS: list[tuple[str, int, re.Pattern[str]]] = [
    (
        "тёплый запрос: кто шарит/разбирается",
        28,
        re.compile(
            r"\bкто\s+(?:шарит|разбирается|понимает|в\s+теме)\s+(?:в\s+|по\s+)?(?:[\w\-]+\s+){0,2}"
            r"(?:тг[- ]?|telegram[- ]?|чат[- ]?)?(?:бот\w*|парсинг\w*|парсер\w*|автоматизац\w*|скрипт\w*|монтаж\w*|рилс\w*|шортс\w*)",
            re.I,
        ),
    ),
    (
        "тёплый запрос: сколько стоит сделать",
        28,
        re.compile(
            r"\bсколько\s+(?:примерно\s+|ориентировочно\s+)?стоит\s+(?:сделать|написать|разработать|создать|заказать|настроить|смонтировать)\b",
            re.I,
        ),
    ),
    (
        "тёплый запрос: можно ли / реально ли реализовать",
        26,
        re.compile(
            r"\b(?:можно\s+ли|реально\s+ли|возможно\s+ли)\s+(?:сделать|реализовать|написать|автоматизировать|спарсить|настроить)\b",
            re.I,
        ),
    ),
    (
        "тёплый запрос: посоветуйте/ищу кто в теме",
        26,
        re.compile(
            r"(?:\bищу\s+кто\s+(?:в\s+теме|разбирается|шарит|подскажет)|"
            r"\b(?:посоветуйте|порекомендуйте)\s+(?:кого|кто|специалиста|разработчика|монтаж[её]ра))",
            re.I,
        ),
    ),
]

_DETAIL_BONUS_PATTERNS: list[tuple[str, int, re.Pattern[str]]] = [
    (
        "сигнал оплаты/ТЗ/бюджета",
        14,
        re.compile(
            r"(?:\bбюджет\b|\bоплата\b|\bтз\b|\bтехзадание\b|\bsalary\b|\bдедлайн\b|💰|"
            r"готов\s+оплатить|скиньте\s+(?:портфолио|кейсы|примеры|прайс)|жду\s+(?:отклики|предложения|примеры))",
            re.I,
        ),
    ),
]

_BOT_DOMAIN_PATTERNS: list[tuple[str, int, re.Pattern[str]]] = [
    (
        "бот: Telegram/ТГ/чат-бот",
        36,
        re.compile(
            r"(?:telegram[- ]?бот\w*|тг[- ]?бот\w*|tg[- ]?bot\w*|телеграм[- ]?бот\w*|телеграмм[- ]?бот\w*|"
            r"чат[- ]?бот\w*|бот(?:а|у|ом|ов)?\s+(?:в\s+)?(?:тг|tg|телеграм\w*|telegram)|"
            r"(?:система|платн\w+\s+подписк\w+)\s+на\s+(?:телеграм\w*|тг)\s+(?:групп\w*|канал\w*))",
            re.I,
        ),
    ),
    (
        "бот: функциональный бот (заявки/магазин/воронка/ИИ)",
        30,
        re.compile(
            r"\bбот(?:а|у|ом)?\s+(?:для\s+)?(?:заявок|обработки\s+заявок|магазина|воронки|оплат\w*|канала|группы|чата|записи|рассылки|поддержки|интеграц\w*)|"
            r"\b(?:ии|ai)[- ]?(?:бот\w*|ассистент\w*|агент\w*|менеджер\w*|инструмент\w*)|"
            r"(?:скопировать|повторить\s+функционал|подключение)\s+(?:[\w\-]+\s+){0,2}бот\w*",
            re.I,
        ),
    ),
    ("бот: стек Python/aiogram/telethon", 26, re.compile(r"\b(?:aiogram|telethon|pyrogram|pytelegrambotapi|telebot|python-telegram-bot)\b", re.I)),
    ("бот: парсер/скрапер", 28, re.compile(r"\b(?:парсер\w*|парсинг\w*|скрапер\w*|скрапинг\w*|scraper|web\s*scraping|мониторинг\w*\s+конкурентов)\b", re.I)),
    ("бот: скрипт/автоматизация/mini app", 24, re.compile(r"(?:\bавтоматизаци\w*|\bскрипт\w*\s+(?:на\s+python|для|в\s+тг)|mini\s*app|tg\s*web\s*app|\bautomation\s+script\b|скрипты,\s*боты\s+и\s+mini\s*apps)", re.I)),
    ("бот: Python/бот разработчик", 10, re.compile(r"\b(?:прогер\w*|программист\w*|python[- ]?разработчик\w*|разработчик\w*\s+бот\w*|bot\s+developer)\b", re.I)),
    ("бот: стек Python", 16, re.compile(r"\bpython\b", re.I)),
    ("бот (EN): telegram bot", 34, re.compile(r"\b(?:telegram\s+bot|tg\s+bot)\b", re.I)),
]

_MOTION_DOMAIN_PATTERNS: list[tuple[str, int, re.Pattern[str]]] = [
    ("монтаж: монтажёр/монтаж/смонтировать", 34, re.compile(r"\b(?:монтаж[её]р\w*|видеомонтаж\w*|монтаж\w*|смонтировать|монтировать|нарезать|нарезк[ауи]|reels[- ]?мейкер\w*)\b", re.I)),
    ("моушн: motion-дизайн/графика/анимация", 34, re.compile(r"(?:моушн[- ]?(?:дизайн\w*|график\w*|ролик\w*)|motion[- ]?(?:design\w*|graphics)|анимац\w+\s+(?:текста|график\w*|ролик\w*|видео)|\b(?:2d[- ]?)?аниматор\w*|\banimator\b)", re.I)),
    ("формат: Shorts/Reels/YouTube/TikTok", 24, re.compile(r"(?:\b(?:shorts|reels|tiktok|youtube)\b|шортс\w*|рилс\w*|ютуб\w*|ютюб\w*|тикток\w*)", re.I)),
    ("детали: инфографика/титры/динамика", 18, re.compile(r"(?:\bинфографик\w*|\bтитры\b|\bсубтитр\w*|оформлени[ея]\s+(?:ролик\w*|видео|канала)|динамичн\w+\s+монтаж|видеокреатив\w*)", re.I)),
    ("софт: After Effects/Premiere/DaVinci/CapCut", 18, re.compile(r"\b(?:after\s*effects|premiere\s*(?:pro)?|davinci\s*(?:resolve)?|capcut)\b", re.I)),
    ("монтаж (EN): video editor / motion designer", 34, re.compile(r"\b(?:video\s+editor|motion\s+designer|short[- ]form\s+editor)\b", re.I)),
]

# Strip explicit editing negations ("без монтажа", "монтаж не нужен") before motion scoring
_MOTION_NEGATION_RE = re.compile(r"(?:\bбез\s+монтажа\b|\bмонтаж\s+не\s+(?:нужен|требуется)\b)", re.I)

_CORE_MOTION_RE = re.compile(
    r"(?:\b(?:монтаж[её]р\w*|видеомонтаж\w*|монтаж\w*|смонтировать|монтировать|нарезать|нарезк[ауи]|"
    r"reels[- ]?мейкер\w*|моушн\w*|аниматор\w*|animator|инфографик\w*|титры|субтитр\w*|видеокреатив\w*|"
    r"шортс\w*|shorts|capcut|davinci|premiere|after\s*effects|video\s+editor|motion\s+designer)\b|"
    r"монтировать\s+(?:ролики|видео)|анимац\w+\s+(?:текста|график\w*|ролик\w*|видео))",
    re.I,
)

_CORE_BOT_RE = re.compile(
    r"(?:telegram[- ]?бот\w*|тг[- ]?бот\w*|tg[- ]?bot\w*|телеграм[- ]?бот\w*|телеграмм[- ]?бот\w*|чат[- ]?бот\w*|"
    r"бот(?:а|у|ом|ов)?\s+(?:в\s+)?(?:тг|tg|телеграм\w*|telegram)|"
    r"\bbot\b|\b(?:aiogram|telethon|pyrogram|pytelegrambotapi|telebot|python-telegram-bot)\b|"
    r"\b(?:python|парсер\w*|парсинг\w*|скрапер\w*|scraper|web\s*scraping|mini\s*app|tg\s*web\s*app|automation\s+script)\b|"
    r"\b(?:ии|ai)[- ]?(?:бот\w*|ассистент\w*|агент\w*|менеджер\w*|инструмент\w*)|"
    r"бот(?:а|у|ом)?\s+(?:для\s+)?(?:заявок|обработки\s+заявок|магазина|воронки|оплат\w*|поддержки)|"
    r"(?:создать|скопировать|настроить|подключение)\s+(?:[\w\-]+\s+){0,2}бот\w*|"
    r"(?:система|платн\w+\s+подписк\w+)\s+на\s+(?:телеграм\w*|тг)\s+(?:групп\w*|канал\w*)|"
    r"скрипт\w*\s+(?:на\s+python|для\s+тг|в\s+тг|автоматизац\w*))",
    re.I,
)

_OFFTOPIC_CMS_RE = re.compile(
    r"\b(?:wordpress|bitrix|битрикс24?|tilda|тильда|1[сc]|opencart|modx|shopify|webflow|приходн\w+\s+накладн\w+|кассовое\s+место|\bpcb\b|печатн\w+\s+плат\w+)\b",
    re.I,
)

_NON_TARGET_ROLE_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("непрофильная роль: трафик/УБТ/медиабайер", re.compile(r"(?:\bубт\s*специалист\b|\bлить\s+трафик\b|\bзалив\s+трафика\b|\bтрафик[- ]?менеджер\w*|\bмедиабайер\w*|\bmedia\s*buyer\b)", re.I)),
    ("непрофильная роль: SMM/маркетолог/контент-менеджер", re.compile(r"(?:^|\n)[^\n]{0,60}\b(?:помощниц[ауы]\s+smm|smm[- ]?(?:специалист|менеджер)|маркетолог(?:\s+по\s+автоворонкам)?|контент[- ]?менеджер)\b|\b(?:ищ(?:у|ем)|нуж(?:ен|на)|требуется)\s+(?:помощниц[ауы]\s+smm|smm[- ]?(?:специалист\w*|менеджер\w*)|маркетолог\w*|контент[- ]?менеджер\w*)", re.I)),
    ("непрофильная роль: ассистент/дизайнер/копирайтер/продажи/QA", re.compile(r"\b(?:ищ(?:у|ем)|нуж(?:ен|на)|требуется)\s+(?:ассистент\w*|помощни[кц]\w*|дизайнер\w*|копирайтер\w*|менеджер\w*\s+по\s+продажам|телемаркетолог\w*|таргетолог\w*|ручн\w+\s+тестировщик\w*|ментор\w*)", re.I)),
]

_DIRECT_BOT_DEV_RE = re.compile(
    r"(?:(?:написать|сделать|разработать|создать|собрать)\s+(?:[\w\-]+\s+){0,2}(?:тг[- ]?|telegram[- ]?)?бот\w*|"
    r"(?:нуж(?:ен|на)|ищ(?:у|ем)|требуется)\s+(?:разработчик|программист|прогер)\w*\s+(?:тг[- ]?|telegram[- ]?)?бот\w*)",
    re.I,
)
_DIRECT_EDITOR_REQ_RE = re.compile(
    r"(?:(?:нуж(?:ен|на)|ищ(?:у|ем)|требуется)\s+(?:креативн\w+\s+)?(?:монтаж[её]р\w*|моушн[- ]?дизайнер\w*|video\s+editor|motion\s+designer))",
    re.I,
)

_ENGLISH_HINT_RE = re.compile(r"[a-zA-Z]{3,}")
_CYRILLIC_HINT_RE = re.compile(r"[а-яА-ЯёЁ]{2,}")


def _is_mostly_english(text: str) -> bool:
    en_count = len(_ENGLISH_HINT_RE.findall(text))
    ru_count = len(_CYRILLIC_HINT_RE.findall(text))
    return en_count > 0 and ru_count == 0


def _extract_task_summary(text: str, max_len: int = 130) -> str:
    """Build a concise 1-line summary of the client's task."""
    lines = [re.sub(r"\s+", " ", ln).strip(" ·•|-—:") for ln in text.splitlines()]
    lines = [ln for ln in lines if len(ln) >= 6]
    if not lines:
        return re.sub(r"\s+", " ", text).strip()[:max_len]
    # Skip generic channel headers like "📁 Скрипты, боты и mini apps | 💰 50 000 ₽"
    for ln in lines:
        if ln.startswith(("📁", "📌", "🔥 НОВЫЙ ЗАКАЗ")):
            continue
        if len(ln) >= 14:
            return ln[: max_len - 3].rstrip() + "..." if len(ln) > max_len else ln
    joined = " — ".join(lines[:2])
    return joined[: max_len - 3].rstrip() + "..." if len(joined) > max_len else joined


def _build_bot_reply(text: str, reasons: list[str], lead_tier: LeadTier = "HOT") -> str:
    """Generate a natural human outreach reply without IT jargon, !, long dashes, or special symbols."""
    if _is_mostly_english(text):
        if lead_tier == "WARM":
            return (
                "Hello. I can help you with this Telegram bot and share rough timing and cost. "
                "I can make a light test version first so you see how it works, and if everything fits, we proceed to payment and the full project. "
                "Could you share a bit more detail on what you need."
            )
        return (
            "Hello. I can build this Telegram bot for you. "
            "I will make a light test version first so you can check how it works, and if everything fits, we move to payment and the full project. "
            "Could you send the details."
        )

    # Strip channel promo footers (e.g. "Привёл клиента ... со всех его оплат") before topic detection
    body = re.split(r"\n━{5,}\n", text, maxsplit=1)[0]
    lower = body.lower()
    focus = "такого бота в Telegram"
    if re.search(r"\b(?:парсер\w*|парсинг\w*|scraper|мониторинг\w*)\b", lower):
        focus = "такого бота для сбора и проверки данных"
    elif re.search(r"\b(?:ии|ai)[- ]?(?:бот\w*|ассистент\w*|агент\w*|менеджер\w*|инструмент\w*)\b|\bбаз[ауые]\s+знаний\b", lower):
        focus = "такого ИИ-бота с ответами по вашей базе"
    elif re.search(r"(?:подписк\w*|юkassa|ю-?касс\w*|эквайринг\w*|\bоплат[ауые]\b|\bмагазин\w*\b)", lower):
        focus = "такого бота для приема оплат и доступа"
    elif re.search(r"\bворонк\w*", lower):
        focus = "такого бота под ваши сценарии общения"
    elif re.search(r"\bзаяв(?:ка|ки|ок|ку|кам)\b", lower):
        focus = "такого бота для приема заявок"
    elif re.search(r"\b(?:скопировать|повторить)\b", lower):
        focus = "такого бота по вашему примеру"

    if lead_tier == "WARM":
        return (
            f"Здравствуйте. Могу подсказать по {focus} и сориентировать по срокам и цене. "
            "Если решите делать, сначала соберу легкий пробный вариант и покажу в работе, а если все устроит, договоримся об оплате и сделаем полный проект. "
            "Напишите в двух словах, что именно нужно сделать."
        )

    return (
        f"Здравствуйте. Могу сделать {focus}. "
        "Сначала сделаю легкий пробный вариант и покажу вам, как все работает. "
        "Если все устроит, перейдем к оплате и соберем полный проект. Пришлите, пожалуйста, детали или ТЗ."
    )


def _build_motion_reply(text: str, reasons: list[str], lead_tier: LeadTier = "HOT") -> str:
    if _is_mostly_english(text):
        return (
            "Hello. I can help with this video editing task. "
            "I can make a short rough sample first so you see the style, and if you like it, we proceed to payment and the full video. "
            "Could you share your clips or example."
        )

    lower = text.lower()
    fmt = "монтажу видео"
    if "shorts" in lower or "шортс" in lower or "reels" in lower or "рилс" in lower:
        fmt = "монтажу коротких роликов"
    elif "youtube" in lower or "ютуб" in lower or "ютюб" in lower:
        fmt = "монтажу роликов для YouTube"
    elif "инфограф" in lower or "моушн" in lower or "motion" in lower:
        fmt = "монтажу с графикой и текстом"

    if lead_tier == "WARM":
        return (
            f"Здравствуйте. Могу подсказать по {fmt} и сориентировать по цене. "
            "Если решите делать, сначала соберу легкий пробный кусок, а если все подойдет, сделаем полный ролик после оплаты. "
            "Какой примерно формат вам нужен."
        )

    return (
        f"Здравствуйте. Могу сделать такой ролик по {fmt}. "
        "Сначала соберу легкий пробный вариант, чтобы вы посмотрели подачу, а если все устроит, договоримся об оплате и доделаем полностью. "
        "Пришлите, пожалуйста, материалы или пример."
    )


def _score_patterns(
    text: str, patterns: list[tuple[str, int, re.Pattern[str]]]
) -> tuple[int, list[str]]:
    total = 0
    reasons: list[str] = []
    for label, weight, regex in patterns:
        if regex.search(text):
            total += weight
            reasons.append(label)
    return total, reasons


def classify_message(text: str, min_lead_score: int = 45) -> ClassificationResult:
    """Classify a Telegram message into CLIENT_BOT, CLIENT_MOTION, or IGNORE."""
    cleaned = (text or "").strip()
    if len(cleaned) < 12:
        return ClassificationResult(
            track="IGNORE",
            is_lead=False,
            score=0,
            matched_reasons=["слишком короткое сообщение"],
            suggested_reply="",
            lead_tier="NONE",
            speaker_role="OFFTOPIC",
        )

    # 1. Hard spam / scam / infobiz / aggregator / HR fulltime & recruiter filter
    for label, role, rx in _SPAM_SCAM_PATTERNS:
        if rx.search(cleaned):
            return ClassificationResult(
                track="IGNORE",
                is_lead=False,
                score=0,
                matched_reasons=[label],
                suggested_reply="",
                lead_tier="NONE",
                speaker_role=role,
            )

    # 2. Portfolio / case studies filter
    case_hits = [label for label, rx in _CASE_STUDY_PATTERNS if rx.search(cleaned)]
    if case_hits:
        return ClassificationResult(
            track="IGNORE",
            is_lead=False,
            score=5,
            matched_reasons=case_hits,
            suggested_reply="",
            lead_tier="NONE",
            speaker_role="EXECUTOR_CASE",
        )

    # 3. Ready-made product / template / SaaS seller filter
    seller_hits = [label for label, rx in _SELLER_PRODUCT_PATTERNS if rx.search(cleaned)]
    if seller_hits:
        return ClassificationResult(
            track="IGNORE",
            is_lead=False,
            score=5,
            matched_reasons=seller_hits,
            suggested_reply="",
            lead_tier="NONE",
            speaker_role="SELLER_PRODUCT",
        )

    # 4. Coder-to-coder technical questions filter
    coder_hits = [label for label, rx in _CODER_QUESTION_PATTERNS if rx.search(cleaned)]
    if coder_hits:
        return ClassificationResult(
            track="IGNORE",
            is_lead=False,
            score=10,
            matched_reasons=coder_hits,
            suggested_reply="",
            lead_tier="NONE",
            speaker_role="CODER_QUESTION",
        )

    # 5. Executor self-promo check (must reject resumes / offers even with domain keywords)
    promo_hits = [label for label, rx in _SELF_PROMO_PATTERNS if rx.search(cleaned)]
    if promo_hits:
        return ClassificationResult(
            track="IGNORE",
            is_lead=False,
            score=max(0, 15 - 5 * len(promo_hits)),
            matched_reasons=promo_hits,
            suggested_reply="",
            lead_tier="NONE",
            speaker_role="EXECUTOR_PROMO",
        )

    # 6. Strip standalone #hashtags for domain scoring & strip "без монтажа" negation
    domain_text = re.sub(r"(?:^|\s)#[a-zA-Zа-яА-ЯёЁ0-9_]+", " ", cleaned)
    motion_domain_text = _MOTION_NEGATION_RE.sub(" ", domain_text)

    buyer_score, buyer_reasons = _score_patterns(cleaned, _BUYER_INTENT_PATTERNS)
    warm_score, warm_reasons = _score_patterns(cleaned, _WARM_INQUIRY_PATTERNS)
    bot_score, bot_reasons = _score_patterns(domain_text, _BOT_DOMAIN_PATTERNS)
    motion_score, motion_reasons = _score_patterns(motion_domain_text, _MOTION_DOMAIN_PATTERNS)

    if bot_score > 0 and (
        not _CORE_BOT_RE.search(domain_text)
        or (
            _OFFTOPIC_CMS_RE.search(domain_text)
            and not re.search(
                r"(?:(?:создать|разработать|написать|сделать)\s+(?:[\w\-]+\s+){0,2}(?:telegram[- ]?бот\w*|тг[- ]?бот\w*|телеграм[- ]?бот\w*|чат[- ]?бот\w*)|"
                r"(?:нужен|нужна)\s+(?:telegram[- ]?бот\w*|тг[- ]?бот\w*|телеграм[- ]?бот\w*|чат[- ]?бот\w*)|"
                r"\b(?:aiogram|telethon|pyrogram|парсер\w*)\b)",
                domain_text,
                re.I,
            )
        )
        or re.search(r"(?:лить|залив\w*)\s+трафик\s+на\s+(?:тг|telegram)?[- ]?бот", domain_text, re.I)
    ):
        bot_score = 0
        bot_reasons = []

    if motion_score > 0 and not _CORE_MOTION_RE.search(motion_domain_text):
        motion_score = 0
        motion_reasons = []

    # 7. Filter non-target roles (SMM, Marketer, UBT/Traffic, Assistant, QA) unless direct dev/editor hire
    role_hits = [label for label, rx in _NON_TARGET_ROLE_PATTERNS if rx.search(cleaned)]
    if role_hits and not (_DIRECT_BOT_DEV_RE.search(cleaned) or _DIRECT_EDITOR_REQ_RE.search(cleaned)):
        return ClassificationResult(
            track="IGNORE",
            is_lead=False,
            score=20,
            matched_reasons=role_hits,
            suggested_reply="",
            lead_tier="NONE",
            speaker_role="HR_NON_TARGET",
        )

    effective_intent_score = max(buyer_score, warm_score)
    if effective_intent_score == 0:
        return ClassificationResult(
            track="IGNORE",
            is_lead=False,
            score=min(25, max(bot_score, motion_score) // 2),
            matched_reasons=["нет явного запроса заказчика"] + bot_reasons + motion_reasons,
            suggested_reply="",
            lead_tier="NONE",
            speaker_role="OFFTOPIC",
        )

    if bot_score == 0 and motion_score == 0:
        return ClassificationResult(
            track="IGNORE",
            is_lead=False,
            score=min(30, effective_intent_score),
            matched_reasons=buyer_reasons + warm_reasons + ["нецелевое направление (нет бота/скрипта/монтажа)"],
            suggested_reply="",
            lead_tier="NONE",
            speaker_role="OFFTOPIC",
        )

    if bot_score >= motion_score:
        track: TrackType = "CLIENT_BOT"
        domain_score = bot_score
        reasons = buyer_reasons + warm_reasons + bot_reasons
        if motion_reasons:
            reasons.append("дополнительно: " + ", ".join(motion_reasons))
    else:
        track = "CLIENT_MOTION"
        domain_score = motion_score
        reasons = buyer_reasons + warm_reasons + motion_reasons
        if bot_reasons:
            reasons.append("дополнительно: " + ", ".join(bot_reasons))

    # Bonus for actionable detail (budget/payment/TZ, length, question mark)
    detail_bonus, detail_reasons = _score_patterns(cleaned, _DETAIL_BONUS_PATTERNS)
    reasons.extend(detail_reasons)
    if "?" in cleaned:
        detail_bonus += 5
        reasons.append("прямой вопрос")
    if len(cleaned) >= 60:
        detail_bonus += 5

    # Determine HOT vs WARM tier
    is_warm_only = warm_score > 0 and buyer_score == 0
    if is_warm_only:
        raw_score = min(69, max(50, effective_intent_score + min(26, domain_score) + min(10, detail_bonus)))
        lead_tier: LeadTier = "WARM"
        speaker_role = "BUYER_WARM"
    else:
        raw_score = min(100, buyer_score + domain_score + detail_bonus)
        if buyer_score >= 25 and domain_score >= 26 and raw_score < 70:
            raw_score = 70
        lead_tier = "HOT" if raw_score >= 70 else "WARM"
        speaker_role = "BUYER_HOT" if lead_tier == "HOT" else "BUYER_WARM"

    is_lead = raw_score >= min_lead_score
    if not is_lead:
        return ClassificationResult(
            track="IGNORE",
            is_lead=False,
            score=raw_score,
            matched_reasons=reasons + [f"ниже порога {min_lead_score}"],
            suggested_reply="",
            lead_tier="NONE",
            speaker_role="LOW_CONFIDENCE",
        )

    task_summary = _extract_task_summary(cleaned)
    reply = (
        _build_bot_reply(cleaned, reasons, lead_tier=lead_tier)
        if track == "CLIENT_BOT"
        else _build_motion_reply(cleaned, reasons, lead_tier=lead_tier)
    )
    return ClassificationResult(
        track=track,
        is_lead=True,
        score=raw_score,
        matched_reasons=reasons,
        suggested_reply=reply,
        lead_tier=lead_tier,
        speaker_role=speaker_role,
        task_summary=task_summary,
    )
