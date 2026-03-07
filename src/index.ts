#!/usr/bin/env node

/**
 * MCP-сервер стандартов разработки 1С:Предприятие 8
 * 
 * Переменные окружения:
 *   DATA_DIR              — путь к data/standards.json (по умолчанию ./data)
 *   CUSTOM_STANDARDS_PATH — путь к файлу/директории с пользовательскими стандартами
 *   MCP_TRANSPORT         — транспорт: "stdio" (по умолчанию) или "http"
 *   MCP_PORT              — порт для HTTP-транспорта (по умолчанию 3000)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import * as http from "http";
import { fileURLToPath } from "url";

// ─── Data Loading ────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface Category {
  id: string;
  name: string;
  order: number;
}

interface Standard {
  id: string;
  category: string;
  title: string;
  url: string;
  tags: string[];
  content: string;
}

interface StandardsData {
  categories: Category[];
  standards: Standard[];
}

function loadStandards(): StandardsData {
  const dataDir = process.env.DATA_DIR || path.join(__dirname, "..", "data");

  const possiblePaths = [
    path.join(dataDir, "standards.json"),
    path.join(__dirname, "..", "data", "standards.json"),
    path.join(__dirname, "data", "standards.json"),
    path.join(process.cwd(), "data", "standards.json"),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, "utf-8");
      console.error(`📂 Загрузка стандартов из ${p}`);
      return JSON.parse(raw) as StandardsData;
    }
  }

  throw new Error(
    "Файл data/standards.json не найден. Запустите скрапер: npm run scrape"
  );
}

/**
 * Загружает пользовательские стандарты из файла или директории
 * и мержит их в основную базу.
 * 
 * Поддерживаемые форматы:
 * - Один JSON-файл формата StandardsData (с categories + standards)
 * - Один JSON-файл — массив Standard[]
 * - Директория с .json файлами (каждый — один стандарт или массив)
 */
function loadCustomStandards(customPath: string): { categories: Category[]; standards: Standard[] } {
  const categories: Category[] = [];
  const standards: Standard[] = [];

  if (!fs.existsSync(customPath)) {
    console.error(`⚠️  Путь к пользовательским стандартам не найден: ${customPath}`);
    return { categories, standards };
  }

  const stat = fs.statSync(customPath);

  if (stat.isFile() && customPath.endsWith(".json")) {
    const raw = JSON.parse(fs.readFileSync(customPath, "utf-8"));
    if (raw.standards && Array.isArray(raw.standards)) {
      // Формат StandardsData
      standards.push(...raw.standards);
      if (raw.categories) categories.push(...raw.categories);
    } else if (Array.isArray(raw)) {
      // Массив Standard[]
      standards.push(...raw);
    } else if (raw.id && raw.content) {
      // Один стандарт
      standards.push(raw);
    }
    console.error(`📎 Загружено ${standards.length} пользовательских стандартов из ${customPath}`);
  } else if (stat.isDirectory()) {
    const files = fs.readdirSync(customPath).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      const filePath = path.join(customPath, file);
      try {
        const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        if (Array.isArray(raw)) {
          standards.push(...raw);
        } else if (raw.standards && Array.isArray(raw.standards)) {
          standards.push(...raw.standards);
          if (raw.categories) categories.push(...raw.categories);
        } else if (raw.id && raw.content) {
          standards.push(raw);
        }
      } catch (err) {
        console.error(`⚠️  Ошибка чтения ${filePath}: ${(err as Error).message}`);
      }
    }
    console.error(`📎 Загружено ${standards.length} пользовательских стандартов из ${files.length} файлов в ${customPath}`);
  }

  return { categories, standards };
}

// Загрузка основной базы
const data = loadStandards();

// Мерж пользовательских стандартов
const customPath = process.env.CUSTOM_STANDARDS_PATH || "";
if (customPath) {
  const custom = loadCustomStandards(customPath);

  // Добавляем новые категории (без дублей)
  const existingCatIds = new Set(data.categories.map((c) => c.id));
  for (const cat of custom.categories) {
    if (!existingCatIds.has(cat.id)) {
      data.categories.push(cat);
      existingCatIds.add(cat.id);
    }
  }

  // Добавляем стандарты (пользовательские перезаписывают базовые с тем же id)
  const baseMap = new Map(data.standards.map((s) => [s.id, s]));
  for (const std of custom.standards) {
    baseMap.set(std.id, std);
  }
  data.standards = Array.from(baseMap.values());

  // Если у пользовательских стандартов есть категория "custom" — добавляем
  const customCats = new Set(custom.standards.map((s) => s.category));
  for (const catId of customCats) {
    if (!existingCatIds.has(catId)) {
      data.categories.push({
        id: catId,
        name: `Пользовательские: ${catId}`,
        order: 100 + data.categories.length,
      });
    }
  }
}

console.error(`✅ Итого: ${data.standards.length} стандартов, ${data.categories.length} категорий`);

// ─── Search Engine ───────────────────────────────────────────────────────────

/**
 * Простой полнотекстовый поиск по стандартам с поддержкой русского языка
 */
function searchStandards(
  query: string,
  options?: { category?: string; limit?: number }
): Standard[] {
  const limit = options?.limit ?? 10;
  const queryLower = query.toLowerCase();
  const queryWords = queryLower
    .split(/\s+/)
    .filter((w) => w.length > 2);

  let candidates = data.standards;

  // Фильтр по категории
  if (options?.category) {
    candidates = candidates.filter(
      (s) =>
        s.category === options.category ||
        s.category.toLowerCase().includes(options.category!.toLowerCase())
    );
  }

  // Подсчёт релевантности
  const scored = candidates.map((standard) => {
    let score = 0;
    const titleLower = standard.title.toLowerCase();
    const contentLower = standard.content.toLowerCase();
    const tagsStr = standard.tags.join(" ").toLowerCase();

    for (const word of queryWords) {
      // Точное совпадение в заголовке — макс. вес
      if (titleLower.includes(word)) score += 10;
      // В тегах
      if (tagsStr.includes(word)) score += 5;
      // В контенте
      if (contentLower.includes(word)) score += 2;
    }

    // Полная фраза в заголовке — бонус
    if (titleLower.includes(queryLower)) score += 20;
    // Полная фраза в контенте — бонус
    if (contentLower.includes(queryLower)) score += 8;

    return { standard, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.standard);
}

// ─── MCP Server ──────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "1c-standards",
  version: "1.0.0",
});

// ─── Tool: search_standards ──────────────────────────────────────────────────

server.tool(
  "search_standards",
  "Поиск по стандартам разработки 1С:Предприятие 8. Используйте для поиска правил именования, форматирования кода, работы с запросами, транзакциями, формами и другими аспектами разработки на платформе 1С.",
  {
    query: z.string().describe("Поисковый запрос на русском языке, например: 'именование переменных', 'запросы в цикле', 'блокировки данных'"),
    category: z.string().optional().describe("ID категории для фильтрации (опционально). Используйте list_categories для получения списка."),
    limit: z.number().min(1).max(20).default(5).describe("Максимальное количество результатов (по умолчанию 5)"),
  },
  async ({ query, category, limit }) => {
    const results = searchStandards(query, { category, limit });

    if (results.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: `По запросу "${query}" стандартов не найдено. Попробуйте другие ключевые слова.`,
          },
        ],
      };
    }

    const formatted = results.map((s, i) => {
      const preview = s.content.substring(0, 300).replace(/\n/g, " ");
      return `### ${i + 1}. ${s.title}\n**ID:** ${s.id} | **Категория:** ${getCategoryName(s.category)} | **Теги:** ${s.tags.join(", ")}\n**Ссылка:** ${s.url}\n\n${preview}...`;
    });

    return {
      content: [
        {
          type: "text" as const,
          text: `Найдено ${results.length} стандартов по запросу "${query}":\n\n${formatted.join("\n\n---\n\n")}`,
        },
      ],
    };
  }
);

// ─── Tool: get_standard ──────────────────────────────────────────────────────

server.tool(
  "get_standard",
  "Получить полный текст конкретного стандарта разработки 1С по его ID. Используйте после поиска, чтобы прочитать стандарт целиком.",
  {
    standard_id: z.string().describe("ID стандарта, например: 'std-456'"),
  },
  async ({ standard_id }) => {
    const standard = data.standards.find((s) => s.id === standard_id);

    if (!standard) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Стандарт с ID "${standard_id}" не найден. Используйте search_standards для поиска.`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: `# ${standard.title}\n\n**ID:** ${standard.id}\n**Категория:** ${getCategoryName(standard.category)}\n**Теги:** ${standard.tags.join(", ")}\n**Источник:** ${standard.url}\n\n---\n\n${standard.content}`,
        },
      ],
    };
  }
);

// ─── Tool: list_categories ───────────────────────────────────────────────────

server.tool(
  "list_categories",
  "Получить список всех категорий стандартов разработки 1С с количеством стандартов в каждой.",
  {},
  async () => {
    const categoryCounts = new Map<string, number>();
    for (const s of data.standards) {
      categoryCounts.set(s.category, (categoryCounts.get(s.category) || 0) + 1);
    }

    const lines = data.categories
      .sort((a, b) => a.order - b.order)
      .map((cat) => {
        const count = categoryCounts.get(cat.id) || 0;
        return `- **${cat.name}** (id: \`${cat.id}\`) — ${count} стандартов`;
      });

    return {
      content: [
        {
          type: "text" as const,
          text: `# Категории стандартов разработки 1С:Предприятие 8\n\nВсего стандартов: ${data.standards.length}\n\n${lines.join("\n")}`,
        },
      ],
    };
  }
);

// ─── Tool: check_code ────────────────────────────────────────────────────────

server.tool(
  "check_code",
  "Проверить фрагмент кода на 1С на соответствие стандартам разработки. Анализирует код и указывает, какие стандарты могут быть нарушены.",
  {
    code: z.string().describe("Фрагмент кода на языке 1С для проверки"),
    context: z.string().optional().describe("Контекст: где используется код (модуль объекта, модуль формы, общий модуль и т.п.)"),
  },
  async ({ code, context }) => {
    const issues: { rule: string; standardId: string; description: string }[] = [];

    // Проверка: запросы в цикле
    if (/Для\s+Каждого[\s\S]*?Запрос\s*=\s*Новый\s+Запрос/i.test(code) ||
        /Цикл[\s\S]*?\.Выполнить\(\)/i.test(code)) {
      issues.push({
        rule: "Запросы в цикле",
        standardId: "std-534",
        description: "Обнаружен запрос к базе данных внутри цикла. Вынесите запрос за пределы цикла и используйте оператор В (&МассивСсылок)."
      });
    }

    // Проверка: пустой блок Исключение
    if (/Попытка[\s\S]*?Исключение\s*\n\s*КонецПопытки/i.test(code)) {
      issues.push({
        rule: "Пустой блок Исключение",
        standardId: "std-547",
        description: "Обнаружен пустой блок Исключение. Необходимо обрабатывать ошибки: записывать в журнал регистрации или вызывать ВызватьИсключение."
      });
    }

    // Проверка: транзакция без Попытка
    if (/НачатьТранзакцию\(\)/.test(code) && !/Попытка/.test(code)) {
      issues.push({
        rule: "Транзакция без обработки исключений",
        standardId: "std-439",
        description: "НачатьТранзакцию() должна быть обёрнута в Попытка...Исключение...КонецПопытки с вызовом ОтменитьТранзакцию() в блоке Исключение."
      });
    }

    // Проверка: ОтменитьТранзакцию без ВызватьИсключение
    if (/ОтменитьТранзакцию/.test(code) && !/ВызватьИсключение/.test(code)) {
      issues.push({
        rule: "Нет ВызватьИсключение после ОтменитьТранзакцию",
        standardId: "std-439",
        description: "После ОтменитьТранзакцию() в блоке Исключение необходимо вызвать ВызватьИсключение для передачи ошибки вверх по стеку."
      });
    }

    // Проверка: однобуквенные переменные (кроме счётчиков)
    const shortVarMatch = code.match(/(\b[а-яА-Яa-zA-Z]\b)\s*=/g);
    if (shortVarMatch && shortVarMatch.length > 2) {
      issues.push({
        rule: "Однобуквенные имена переменных",
        standardId: "std-457",
        description: "Обнаружены однобуквенные имена переменных. Используйте осмысленные имена, отражающие суть данных."
      });
    }

    // Проверка: модальные вызовы
    if (/\bПредупреждение\s*\(/.test(code) || /\bВопрос\s*\(/.test(code)) {
      issues.push({
        rule: "Модальные вызовы",
        standardId: "std-505",
        description: "Обнаружены модальные вызовы (Предупреждение/Вопрос). Используйте асинхронные аналоги: ПоказатьПредупреждение/ПоказатьВопрос или Асинх/Ждать."
      });
    }

    // Проверка: отсутствие описания экспортных процедур
    if (/(?:Процедура|Функция)\s+\w+\s*\([^)]*\)\s+Экспорт/.test(code)) {
      const hasComment = /\/\/[^\n]*\n\s*(?:Процедура|Функция)\s+\w+\s*\([^)]*\)\s+Экспорт/.test(code);
      if (!hasComment) {
        issues.push({
          rule: "Нет описания экспортной процедуры/функции",
          standardId: "std-550",
          description: "Экспортные процедуры и функции должны иметь комментарий-описание с указанием назначения, параметров и возвращаемого значения."
        });
      }
    }

    // Проверка: закомментированный код
    const commentedCodePatterns = [
      /\/\/\s*(Если|Для|Пока|Попытка|Процедура|Функция)\s/,
      /\/\/\s*\w+\s*=\s*Новый\s/,
      /\/\/\s*\w+\.\w+\(/,
    ];
    for (const pattern of commentedCodePatterns) {
      if (pattern.test(code)) {
        issues.push({
          rule: "Закомментированный код",
          standardId: "std-467",
          description: "Обнаружен закомментированный код. Не оставляйте закомментированный код в модулях — используйте систему контроля версий."
        });
        break;
      }
    }

    // Проверка: РольДоступна вместо ПравоДоступа
    if (/РольДоступна\s*\(/.test(code)) {
      issues.push({
        rule: "Проверка роли вместо права",
        standardId: "std-689",
        description: "Вместо РольДоступна() следует использовать ПравоДоступа() для проверки прав. Проверяйте право, а не роль."
      });
    }

    // Формируем результат
    if (issues.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: `✅ Автоматическая проверка не выявила нарушений стандартов в предоставленном фрагменте кода.\n\n⚠️ Это базовая проверка. Рекомендуется дополнительно проверить:\n- Правила именования переменных и процедур\n- Структуру модуля (области #Область)\n- Оптимальность запросов\n- Корректность блокировок в транзакциях${context ? `\n\nКонтекст: ${context}` : ""}`,
          },
        ],
      };
    }

    const issueLines = issues.map(
      (issue, i) =>
        `### ⚠️ ${i + 1}. ${issue.rule}\n**Стандарт:** ${issue.standardId}\n${issue.description}\n\n_Подробнее: используйте get_standard с ID \`${issue.standardId}\`_`
    );

    return {
      content: [
        {
          type: "text" as const,
          text: `# Результаты проверки кода\n\nОбнаружено потенциальных нарушений: **${issues.length}**${context ? `\nКонтекст: ${context}` : ""}\n\n${issueLines.join("\n\n---\n\n")}`,
        },
      ],
    };
  }
);

// ─── Tool: get_standards_for_topic ───────────────────────────────────────────

server.tool(
  "get_standards_for_topic",
  "Получить все релевантные стандарты для конкретной темы разработки на 1С. Полезно при начале работы над новой функциональностью.",
  {
    topic: z.enum([
      "проведение_документов",
      "работа_с_формами",
      "написание_запросов",
      "обработка_ошибок",
      "именование",
      "блокировки_и_транзакции",
      "права_и_роли",
      "обмен_данными",
      "производительность",
      "структура_кода",
    ]).describe("Тема разработки"),
  },
  async ({ topic }) => {
    const topicMapping: Record<string, string[]> = {
      "проведение_документов": ["документ", "проведение", "регистр", "движения", "запрос"],
      "работа_с_формами": ["форм", "клиент", "сервер", "директив", "интерфейс"],
      "написание_запросов": ["запрос", "SQL", "временн", "индекс", "соединен"],
      "обработка_ошибок": ["исключен", "попытка", "ошибк", "журнал"],
      "именование": ["имен", "перемен", "процедур", "функц", "соглашен"],
      "блокировки_и_транзакции": ["блокировк", "транзакц", "параллельн"],
      "права_и_роли": ["рол", "прав", "доступ", "RLS", "безопасн"],
      "обмен_данными": ["обмен", "XML", "сериализ", "план обмена", "интеграц"],
      "производительность": ["производ", "оптимиз", "цикл", "кэш", "временн"],
      "структура_кода": ["структур", "модул", "област", "коммент", "формат"],
    };

    const keywords = topicMapping[topic] || [];
    const relevantStandards = data.standards.filter((s) => {
      const text = `${s.title} ${s.content} ${s.tags.join(" ")}`.toLowerCase();
      return keywords.some((kw) => text.includes(kw.toLowerCase()));
    });

    if (relevantStandards.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: `По теме "${topic}" стандартов не найдено.`,
          },
        ],
      };
    }

    const summaries = relevantStandards.map((s) => {
      const preview = s.content.substring(0, 200).replace(/\n/g, " ");
      return `- **${s.title}** (\`${s.id}\`): ${preview}...`;
    });

    return {
      content: [
        {
          type: "text" as const,
          text: `# Стандарты по теме: ${topic.replace(/_/g, " ")}\n\nНайдено: ${relevantStandards.length}\n\n${summaries.join("\n\n")}\n\n_Для получения полного текста используйте get_standard с нужным ID._`,
        },
      ],
    };
  }
);

// ─── Prompts ─────────────────────────────────────────────────────────────────

server.prompt(
  "code_review_1c",
  "Провести ревью кода 1С на соответствие стандартам разработки",
  { code: z.string().describe("Код на 1С для ревью") },
  ({ code }) => ({
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `Ты — опытный разработчик 1С:Предприятие 8, хорошо знающий стандарты разработки.

Проведи детальное код-ревью следующего фрагмента кода. Для каждого замечания:
1. Укажи конкретную строку или конструкцию с проблемой.
2. Сослаись на конкретный стандарт (используй search_standards для поиска).
3. Предложи исправленный вариант.

Проверь на соответствие стандартам:
- Именование переменных, процедур, функций
- Структура и форматирование кода
- Обработка исключений
- Работа с транзакциями и блокировками
- Оптимальность запросов
- Корректность использования директив компиляции
- Наличие описаний экспортных процедур

Код для ревью:
\`\`\`1c
${code}
\`\`\``,
        },
      },
    ],
  })
);

server.prompt(
  "explain_standard",
  "Объяснить стандарт разработки 1С простыми словами с примерами",
  { topic: z.string().describe("Тема или название стандарта") },
  ({ topic }) => ({
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `Найди стандарты разработки 1С по теме "${topic}" (используй search_standards) и объясни их:
1. Простым языком — зачем этот стандарт нужен.
2. Что будет, если его нарушить (конкретные последствия).
3. Пример НЕПРАВИЛЬНОГО кода.
4. Пример ПРАВИЛЬНОГО кода.
5. Частые ошибки разработчиков по этой теме.`,
        },
      },
    ],
  })
);

// ─── Helper Functions ────────────────────────────────────────────────────────

function getCategoryName(categoryId: string): string {
  return (
    data.categories.find((c) => c.id === categoryId)?.name ??
    categoryId
  );
}

// ─── Start Server ────────────────────────────────────────────────────────────

async function main() {
  const transport = process.env.MCP_TRANSPORT || "stdio";

  if (transport === "http") {
    const port = parseInt(process.env.MCP_PORT || "3000", 10);

    // Храним транспорты по session ID
    const transports = new Map<string, StreamableHTTPServerTransport>();

    const httpServer = http.createServer(async (req, res) => {
      const url = new URL(req.url || "/", `http://localhost:${port}`);

      // Health check
      if (url.pathname === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          status: "ok",
          standards: data.standards.length,
          categories: data.categories.length,
        }));
        return;
      }

      // MCP endpoint
      if (url.pathname === "/mcp") {
        // Для каждого нового запроса без session — создаём транспорт
        const sessionId = url.searchParams.get("sessionId") || req.headers["mcp-session-id"] as string;

        if (req.method === "POST") {
          let existingTransport = sessionId ? transports.get(sessionId) : undefined;

          if (!existingTransport) {
            const newTransport = new StreamableHTTPServerTransport({
              sessionIdGenerator: () => crypto.randomUUID(),
              onsessioninitialized: (sid) => {
                transports.set(sid, newTransport);
                console.error(`📡 Новая сессия: ${sid}`);
              },
            });

            newTransport.onclose = () => {
              const sid = [...transports.entries()].find(([, t]) => t === newTransport)?.[0];
              if (sid) {
                transports.delete(sid);
                console.error(`🔌 Сессия закрыта: ${sid}`);
              }
            };

            await server.connect(newTransport);
            existingTransport = newTransport;
          }

          await existingTransport.handleRequest(req, res);
          return;
        }

        if (req.method === "GET") {
          if (sessionId && transports.has(sessionId)) {
            await transports.get(sessionId)!.handleRequest(req, res);
            return;
          }
          res.writeHead(400, { "Content-Type": "text/plain" });
          res.end("Missing or invalid session ID");
          return;
        }

        if (req.method === "DELETE") {
          if (sessionId && transports.has(sessionId)) {
            await transports.get(sessionId)!.handleRequest(req, res);
            transports.delete(sessionId);
            return;
          }
          res.writeHead(404);
          res.end();
          return;
        }
      }

      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
    });

    httpServer.listen(port, "0.0.0.0", () => {
      console.error(`🚀 MCP-сервер стандартов 1С запущен на http://0.0.0.0:${port}/mcp`);
      console.error(`   Health check: http://0.0.0.0:${port}/health`);
    });
  } else {
    // Режим stdio — для локального запуска и Claude Code
    const stdioTransport = new StdioServerTransport();
    await server.connect(stdioTransport);
    console.error("🚀 MCP-сервер стандартов 1С запущен (stdio)");
  }
}

main().catch((err) => {
  console.error("Ошибка запуска MCP-сервера:", err);
  process.exit(1);
});
