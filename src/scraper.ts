/**
 * Скрапер стандартов разработки 1С:Предприятие 8 с its.1c.ru
 * 
 * Авторизация: ITS_LOGIN + ITS_PASSWORD (подписка ИТС)
 * 
 * Использование:
 *   npx tsx src/scraper.ts
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");

// Разделы стандартов на its.1c.ru
const SECTIONS = [
  { id: "1", name: "Общие стандарты и методики разработки", path: "/db/v8std/browse/13/-1/1" },
  { id: "26", name: "Соглашения при написании кода", path: "/db/v8std/browse/13/-1/26" },
  { id: "31", name: "Стандарты для управляемых форм", path: "/db/v8std/browse/13/-1/31" },
  { id: "35", name: "Объектно-модельные стандарты", path: "/db/v8std/browse/13/-1/35" },
  { id: "36", name: "Права доступа и роли", path: "/db/v8std/browse/13/-1/36" },
  { id: "37", name: "Командный интерфейс и формы", path: "/db/v8std/browse/13/-1/37" },
  { id: "38", name: "Стандарты построения запросов", path: "/db/v8std/browse/13/-1/38" },
  { id: "39", name: "Обмен данными и интеграция", path: "/db/v8std/browse/13/-1/39" },
  { id: "40", name: "Стандарты по производительности", path: "/db/v8std/browse/13/-1/40" },
  { id: "7", name: "Дополнительные рекомендации для 8.3", path: "/db/v8std/browse/13/-1/7" },
  { id: "11", name: "Разработка пользовательских интерфейсов", path: "/db/v8std/browse/13/-1/11" },
];

const BASE_URL = "https://its.1c.ru";

// Cookie jar — дедупликация по имени, без разрастания
const cookieJar = new Map<string, string>();

function getCookieHeader(): string {
  return Array.from(cookieJar.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

function updateCookies(setCookieHeaders: string[]): void {
  for (const header of setCookieHeaders) {
    const pair = header.split(";")[0]; // берём только name=value, без path/expires
    const eqIndex = pair.indexOf("=");
    if (eqIndex > 0) {
      const name = pair.substring(0, eqIndex).trim();
      const value = pair.substring(eqIndex + 1).trim();
      cookieJar.set(name, value);
    }
  }
}

interface Standard {
  id: string;
  category: string;
  categoryName: string;
  title: string;
  url: string;
  tags: string[];
  content: string;
}

/**
 * Извлекает текстовый контент из HTML, удаляя теги
 */
function htmlToText(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Извлекает ссылки на статьи стандартов из страницы раздела
 */
function extractArticleLinks(html: string): { title: string; path: string }[] {
  const links: { title: string; path: string }[] = [];
  // Ищем ссылки вида /db/v8std/content/NNN/hdoc
  const regex = /<a[^>]+href="(\/db\/v8std\/content\/\d+\/hdoc)"[^>]*>([^<]+)<\/a>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    links.push({
      path: match[1],
      title: htmlToText(match[2]),
    });
  }
  return links;
}

function extractBrowseLinks(html: string): string[] {
  const links = new Set<string>();
  const regex = /<a[^>]+href="(\/db\/v8std\/browse\/[^"#?]+(?:\?[^"#]*)?)"[^>]*>/gi;
  let match;

  while ((match = regex.exec(html)) !== null) {
    links.add(match[1].split("#")[0]);
  }

  return Array.from(links);
}

async function collectSectionArticleLinks(sectionPath: string): Promise<{ title: string; path: string }[]> {
  const queue: string[] = [sectionPath];
  const queued = new Set<string>([sectionPath]);
  const visited = new Set<string>();
  const articleMap = new Map<string, { title: string; path: string }>();

  while (queue.length > 0) {
    const browsePath = queue.shift()!;
    queued.delete(browsePath);

    if (visited.has(browsePath)) continue;
    visited.add(browsePath);

    try {
      const html = await fetchPage(`${BASE_URL}${browsePath}`);

      for (const article of extractArticleLinks(html)) {
        if (!articleMap.has(article.path)) {
          articleMap.set(article.path, article);
        }
      }

      for (const subPath of extractBrowseLinks(html)) {
        if (!visited.has(subPath) && !queued.has(subPath)) {
          queue.push(subPath);
          queued.add(subPath);
        }
      }

      await new Promise((r) => setTimeout(r, 250));
    } catch (err) {
      console.error(`   [browse-error] ${browsePath}: ${(err as Error).message}`);
    }
  }

  return Array.from(articleMap.values());
}

/**
 * Извлекает содержимое статьи стандарта
 */
function extractArticleContent(html: string): string {
  // Ищем основной контент статьи
  const contentMatch = html.match(
    /<div[^>]+class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<div[^>]+class="[^"]*footer/i
  ) || html.match(
    /<div[^>]+class="[^"]*article[^"]*"[^>]*>([\s\S]*?)<\/div>/i
  ) || html.match(
    /<div[^>]+id="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>/i
  );

  if (contentMatch) {
    return htmlToText(contentMatch[1]);
  }

  // Fallback: берём весь body
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return bodyMatch ? htmlToText(bodyMatch[1]) : "";
}

/**
 * Генерирует теги из заголовка и содержимого
 */
function generateTags(title: string, content: string): string[] {
  const tagKeywords: Record<string, string[]> = {
    "запрос": ["запросы", "SQL"],
    "блокировк": ["блокировки", "параллельность"],
    "транзакц": ["транзакции", "данные"],
    "форм": ["формы", "интерфейс"],
    "модул": ["модуль", "код"],
    "перемен": ["переменные", "код"],
    "процедур": ["процедуры", "код"],
    "функц": ["функции", "код"],
    "справочник": ["справочник", "метаданные"],
    "документ": ["документ", "метаданные"],
    "регистр": ["регистр", "метаданные"],
    "обмен": ["обмен", "интеграция"],
    "рол": ["роли", "безопасность"],
    "прав": ["права", "безопасность"],
    "произво": ["производительность", "оптимизация"],
    "клиент": ["клиент-сервер"],
    "сервер": ["клиент-сервер"],
    "макет": ["печать", "макеты"],
    "печат": ["печать"],
    "подписк": ["подписки", "события"],
    "команд": ["команды", "интерфейс"],
  };

  const tags = new Set<string>();
  const lowerTitle = title.toLowerCase();
  const lowerContent = content.substring(0, 500).toLowerCase();

  for (const [keyword, keywordTags] of Object.entries(tagKeywords)) {
    if (lowerTitle.includes(keyword) || lowerContent.includes(keyword)) {
      keywordTags.forEach((t) => tags.add(t));
    }
  }

  return Array.from(tags);
}

async function fetchPage(url: string, retries: number = 2): Promise<string> {
  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.5",
  };

  const cookie = getCookieHeader();
  if (cookie) {
    headers["Cookie"] = cookie;
  }

  const response = await fetch(url, { headers, redirect: "follow" });

  if (!response.ok) {
    if (response.status === 400 && retries > 0) {
      // Возможно сервер сбросил сессию — пауза и повтор
      console.error(`   ⚠️  HTTP 400 на ${url.substring(0, 80)}... повтор через 3с (осталось ${retries})`);
      await new Promise((r) => setTimeout(r, 3000));
      return fetchPage(url, retries - 1);
    }
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  // Обновляем cookie jar (дедупликация по имени)
  const setCookies = response.headers.getSetCookie?.() || [];
  if (setCookies.length > 0) {
    updateCookies(setCookies);
  }

  // its.1c.ru использует Windows-1251
  const buffer = await response.arrayBuffer();
  const decoder = new TextDecoder("windows-1251");
  return decoder.decode(buffer);
}

/**
 * Авторизация на its.1c.ru через логин/пароль
 * its.1c.ru использует авторизацию через login.1c.ru (OAuth-подобный flow)
 */
async function authenticate(login: string, password: string): Promise<boolean> {
  console.log(`🔐 Авторизация на its.1c.ru как ${login}...`);

  try {
    // Шаг 1: Заходим на its.1c.ru — получаем redirect на login.1c.ru
    const itsPage = await fetchPage("https://its.1c.ru/user/auth");
    
    // Шаг 2: Отправляем форму авторизации на login.1c.ru
    const authUrl = "https://login.1c.ru/login";
    const formData = new URLSearchParams({
      username: login,
      password: password,
      execution: "",
      _eventId: "submit",
    });

    const authResponse = await fetch(authUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Cookie": getCookieHeader(),
      },
      body: formData.toString(),
      redirect: "follow",
    });

    // Собираем cookie из ответа
    const setCookies = authResponse.headers.getSetCookie?.() || [];
    if (setCookies.length > 0) {
      updateCookies(setCookies);
    }

    // Шаг 3: Проверяем, что авторизация прошла — пробуем загрузить защищённую страницу
    const testPage = await fetchPage("https://its.1c.ru/db/v8std");
    const isAuthed = !testPage.includes("/user/auth") || testPage.includes("v8std/browse");

    if (isAuthed) {
      console.log("✅ Авторизация успешна\n");
    } else {
      console.error("❌ Авторизация не удалась — страница требует входа.\n");
      console.error("   Проверьте ITS_LOGIN и ITS_PASSWORD.\n");
    }

    return isAuthed;
  } catch (err) {
    console.error(`❌ Ошибка авторизации: ${(err as Error).message}`);
    console.error("   Проверьте ITS_LOGIN и ITS_PASSWORD.\n");
    return false;
  }
}

async function scrapeAllStandards(): Promise<void> {
  console.log("🚀 Начинаем загрузку стандартов с its.1c.ru...\n");

  const itsLogin = process.env.ITS_LOGIN || "";
  const itsPassword = process.env.ITS_PASSWORD || "";

  if (itsLogin && itsPassword) {
    const success = await authenticate(itsLogin, itsPassword);
    if (!success) {
      console.error("⛔ Не удалось авторизоваться. Загрузка остановлена.");
      process.exit(1);
    }
  } else {
    console.warn(
      "⚠️  Нет данных для авторизации. its.1c.ru может потребовать вход.\n" +
      "   Задайте ITS_LOGIN и ITS_PASSWORD в .env\n"
    );
  }

  const allStandards: Standard[] = [];
  const categories: { id: string; name: string; order: number }[] = [];

  for (let i = 0; i < SECTIONS.length; i++) {
    const section = SECTIONS[i];
    console.log(`📂 [${i + 1}/${SECTIONS.length}] Раздел: ${section.name}`);
    categories.push({ id: section.id, name: section.name, order: i + 1 });

    try {
      const articles = await collectSectionArticleLinks(section.path);
      console.log(`   Найдено статей: ${articles.length}`);

      for (let j = 0; j < articles.length; j++) {
        const article = articles[j];
        console.log(`   📄 [${j + 1}/${articles.length}] ${article.title}`);

        try {
          const articleHtml = await fetchPage(`${BASE_URL}${article.path}`);
          const content = extractArticleContent(articleHtml);

          const idMatch = article.path.match(/content\/(\d+)\//);
          const id = idMatch ? `std-${idMatch[1]}` : `std-${section.id}-${j}`;

          allStandards.push({
            id,
            category: section.id,
            categoryName: section.name,
            title: article.title,
            url: `${BASE_URL}${article.path}`,
            tags: generateTags(article.title, content),
            content,
          });

          // Пауза между запросами — не нагружаем сервер
          await new Promise((r) => setTimeout(r, 500));
        } catch (err) {
          console.error(`   ❌ Ошибка загрузки: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      console.error(`   ❌ Ошибка раздела: ${(err as Error).message}`);
    }
  }

  // Сохраняем результат
  const outputPath = path.join(DATA_DIR, "standards.json");
  const data = { categories, standards: allStandards };

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), "utf-8");

  console.log(`\n✅ Загружено ${allStandards.length} стандартов`);
  console.log(`🍪 Cookies в сессии: ${cookieJar.size} (${getCookieHeader().length} байт)`);
  console.log(`📁 Сохранено в ${outputPath}`);
}

scrapeAllStandards().catch(console.error);
