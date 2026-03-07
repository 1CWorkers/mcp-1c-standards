# MCP-сервер стандартов разработки 1С:Предприятие 8

MCP-сервер для доступа к [стандартам и методикам разработки](https://its.1c.ru/db/v8std) конфигураций 1С:Предприятие 8.

Работает с **Cursor**, **Claude Code**, **VS Code**, **Claude Desktop**.

---

## Установка

### Вариант А: Docker pull (рекомендуется)

```bash
docker pull ghcr.io/YOUR_GITHUB_USER/mcp-1c-standards:latest
```

> Замените `YOUR_GITHUB_USER` на ваш GitHub username.
> После первого push в main образ собирается автоматически.

### Вариант Б: Собрать локально

```bash
git clone https://github.com/YOUR_GITHUB_USER/mcp-1c-standards.git
cd mcp-1c-standards
docker build -t mcp-1c-standards .
```

В примерах ниже используется `mcp-1c-standards` как имя образа.
Если вы тянули через `docker pull`, замените на `ghcr.io/YOUR_GITHUB_USER/mcp-1c-standards:latest`.

---

## Подключение к Cursor

### Шаг 1: Запустить сервер

```bash
docker run -d \
  --name mcp-1c \
  -p 3000:3000 \
  -e MCP_TRANSPORT=http \
  -v mcp-1c-data:/app/data \
  mcp-1c-standards
```

Проверить, что работает:

```bash
curl http://localhost:3000/health
# {"status":"ok","standards":15,"categories":10}
```

### Шаг 2: Настроить Cursor

Откройте (или создайте) файл `.cursor/mcp.json` в корне вашего проекта:

```json
{
  "mcpServers": {
    "1c-standards": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

### Шаг 3: Проверить

1. Перезапустите Cursor (или перезагрузите окно: `Ctrl+Shift+P` → `Reload Window`)
2. Откройте чат (Ctrl+L) и переключитесь в режим **Agent**
3. Напишите:

```
Найди стандарт 1С про запросы в цикле
```

Cursor должен вызвать tool `search_standards` и вернуть результат.

Ещё примеры для проверки:

```
Проверь этот код на соответствие стандартам 1С:

Для Каждого Док Из МассивДокументов Цикл
    Запрос = Новый Запрос;
    Запрос.Текст = "ВЫБРАТЬ * ИЗ Документ.Заказ ГДЕ Ссылка = &Ссылка";
    Запрос.УстановитьПараметр("Ссылка", Док);
    Результат = Запрос.Выполнить();
КонецЦикла;
```

```
Какие стандарты 1С нужно соблюдать при работе с транзакциями и блокировками?
```

### Шаг 4 (опционально): Глобальная настройка

Чтобы MCP-сервер был доступен во всех проектах Cursor, добавьте настройку глобально:

`~/.cursor/mcp.json` (тот же формат, что выше).

---

## Подключение к Claude Code

### Вариант 1: HTTP (сервер запущен в Docker)

```bash
# Запустить сервер (если ещё не запущен)
docker run -d --name mcp-1c -p 3000:3000 -e MCP_TRANSPORT=http -v mcp-1c-data:/app/data mcp-1c-standards

# Подключить
claude mcp add 1c-standards --transport http http://localhost:3000/mcp
```

### Вариант 2: Stdio (Docker запускается по требованию)

```bash
claude mcp add 1c-standards \
  --transport stdio \
  -- docker run -i --rm -v mcp-1c-data:/app/data mcp-1c-standards
```

### Проверить

```bash
claude mcp list
# Должен быть в списке: 1c-standards

# Запустить Claude Code и спросить
claude
> Используй инструмент search_standards чтобы найти стандарт 1С про именование переменных
```

### Удалить (если нужно)

```bash
claude mcp remove 1c-standards
```

---

## Подключение к Claude Desktop

Откройте файл настроек:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

Добавьте:

```json
{
  "mcpServers": {
    "1c-standards": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-v", "mcp-1c-data:/app/data",
        "mcp-1c-standards"
      ]
    }
  }
}
```

Перезапустите Claude Desktop. В списке инструментов (иконка 🔨) должны появиться tools сервера.

---

## Загрузка полной базы с its.1c.ru

Встроенная база содержит ~15 ключевых стандартов. Для загрузки всех стандартов нужна подписка ИТС.

```bash
docker run -d \
  --name mcp-1c \
  -p 3000:3000 \
  -e MCP_TRANSPORT=http \
  -e ITS_LOGIN=vasya@mail.ru \
  -e ITS_PASSWORD=mypassword123 \
  -e SCRAPE_ON_START=true \
  -v mcp-1c-data:/app/data \
  mcp-1c-standards
```

Первый запуск ~5-10 минут (загрузка). Данные сохраняются в volume `mcp-1c-data`, повторная загрузка не нужна.

Принудительное обновление:

```bash
docker run --rm \
  -e ITS_LOGIN=vasya@mail.ru \
  -e ITS_PASSWORD=mypassword123 \
  -e SCRAPE_ON_START=true \
  -e FORCE_RESCRAPE=true \
  -v mcp-1c-data:/app/data \
  mcp-1c-standards \
  sh -c "node build/scraper.js"
```

### Использование .env файла

Чтобы не передавать логин/пароль в командной строке:

```bash
cp .env.example .env
nano .env   # заполнить ITS_LOGIN, ITS_PASSWORD, SCRAPE_ON_START=true
```

```bash
docker run -d \
  --name mcp-1c \
  -p 3000:3000 \
  --env-file .env \
  -v mcp-1c-data:/app/data \
  mcp-1c-standards
```

---

## Пользовательские стандарты

Добавьте свои стандарты компании — они будут мержиться с базовыми.

### Шаг 1: Создать файл

```bash
mkdir my-standards
cat > my-standards/our-rules.json << 'EOF'
{
  "categories": [
    { "id": "company", "name": "Стандарты нашей компании", "order": 50 }
  ],
  "standards": [
    {
      "id": "company-001",
      "category": "company",
      "title": "Обязательный код-ревью перед мержем",
      "url": "",
      "tags": ["код-ревью", "процесс", "компания"],
      "content": "Каждый merge request должен быть проверен минимум одним разработчиком..."
    }
  ]
}
EOF
```

### Шаг 2: Запустить с монтированием

```bash
docker run -d \
  --name mcp-1c \
  -p 3000:3000 \
  -e MCP_TRANSPORT=http \
  -e CUSTOM_STANDARDS_PATH=/app/custom-standards \
  -v mcp-1c-data:/app/data \
  -v $(pwd)/my-standards:/app/custom-standards:ro \
  mcp-1c-standards
```

Если `id` пользовательского стандарта совпадает с базовым — пользовательский перезаписывает базовый.

---

## Docker Compose

Для тех, кому удобнее compose. Файл `docker-compose.yml` уже в репозитории.

```bash
cp .env.example .env
nano .env

# Быстрый старт (встроенная база)
docker compose up mcp-http -d

# Полная база с its.1c.ru
docker compose up mcp-http-full -d

# Со своими стандартами
docker compose up mcp-http-custom -d

# Всё вместе
docker compose --profile full up -d
```

---

## Инструменты MCP-сервера

| Инструмент | Описание |
|---|---|
| `search_standards` | Полнотекстовый поиск по стандартам |
| `get_standard` | Полный текст стандарта по ID |
| `list_categories` | Список категорий с количеством |
| `check_code` | Автопроверка кода 1С на нарушения |
| `get_standards_for_topic` | Подборка стандартов по теме |

Промпты: `code_review_1c`, `explain_standard`

### check_code выявляет

- Запросы к БД в цикле
- Пустой блок `Исключение`
- `НачатьТранзакцию` без `Попытка`
- `ОтменитьТранзакцию` без `ВызватьИсключение`
- Однобуквенные имена переменных
- Модальные вызовы (`Предупреждение`, `Вопрос`)
- Отсутствие описаний экспортных процедур
- Закомментированный код
- `РольДоступна` вместо `ПравоДоступа`

---

## Публикация образа на GitHub

### Первоначальная настройка

1. Создайте репозиторий на GitHub
2. Запушьте код:

```bash
cd mcp-1c-standards
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_GITHUB_USER/mcp-1c-standards.git
git push -u origin main
```

3. GitHub Actions автоматически соберёт и опубликует образ в `ghcr.io`
4. Зайдите в Settings → Packages → `mcp-1c-standards` → Package settings → Change visibility → **Public** (чтобы `docker pull` работал без авторизации)

### Теперь на любой машине

```bash
docker pull ghcr.io/YOUR_GITHUB_USER/mcp-1c-standards:latest

docker run -d \
  --name mcp-1c \
  -p 3000:3000 \
  -e MCP_TRANSPORT=http \
  -v mcp-1c-data:/app/data \
  ghcr.io/YOUR_GITHUB_USER/mcp-1c-standards:latest
```

### Теги образов

| Тег | Когда создаётся |
|---|---|
| `latest` | Каждый push в main |
| `v1.0.0` | При создании git tag `v1.0.0` |
| `v1.0` | При создании git tag `v1.0.x` |
| `abc1234` | Каждый commit (SHA) |

Создание релиза:

```bash
git tag v1.0.0
git push --tags
# Образ ghcr.io/YOUR_GITHUB_USER/mcp-1c-standards:v1.0.0 будет собран автоматически
```

---

## Архитектура

```
mcp-1c-standards/
├── .github/workflows/
│   └── docker-publish.yml    # CI: сборка и push в ghcr.io
├── src/
│   ├── index.ts              # MCP-сервер (tools, prompts, HTTP/stdio)
│   └── scraper.ts            # Скрапер its.1c.ru
├── data/
│   └── standards.json        # Встроенная база (~15 стандартов)
├── custom-standards/
│   └── example.json          # Пример пользовательских стандартов
├── Dockerfile                # Multi-stage build
├── docker-compose.yml        # Compose-сценарии
├── docker-entrypoint.sh      # Логика запуска контейнера
├── .env.example              # Шаблон переменных
├── package.json
└── tsconfig.json
```

### Что происходит при старте контейнера

```
docker-entrypoint.sh
    │
    ├── SCRAPE_ON_START=true?
    │   └── ITS_LOGIN+ITS_PASSWORD → авторизация → загрузка → /app/data/standards.json
    │
    ├── Нет standards.json?
    │   └── Копируем встроенную базу
    │
    ├── CUSTOM_STANDARDS_PATH задан?
    │   └── Мержим пользовательские стандарты при загрузке
    │
    └── node build/index.js
        ├── MCP_TRANSPORT=stdio → stdin/stdout
        └── MCP_TRANSPORT=http  → http://0.0.0.0:3000/mcp
```

## Лицензия

MIT

Стандарты разработки являются собственностью фирмы «1С».
