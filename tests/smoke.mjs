#!/usr/bin/env node

/**
 * Smoke-тесты MCP-сервера стандартов 1С
 * 
 * Запуск:
 *   node tests/smoke.mjs                          # localhost:3000
 *   node tests/smoke.mjs http://localhost:3001     # другой порт
 * 
 * Требует запущенный MCP-сервер в HTTP-режиме.
 */

const BASE = process.argv[2] || "http://localhost:3000";
const MCP_URL = `${BASE}/mcp`;

let passed = 0;
let failed = 0;

// ── Helpers ──────────────────────────────────────────────────────────────────

async function mcpCall(method, params = {}) {
  // Инициализация сессии
  const initRes = await fetch(MCP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "smoke-test", version: "1.0.0" },
      },
    }),
  });

  const sessionId = initRes.headers.get("mcp-session-id");
  if (!sessionId) throw new Error("No session ID in initialize response");

  // Отправляем initialized
  await fetch(MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "mcp-session-id": sessionId,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    }),
  });

  // Вызов tool
  const toolRes = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "mcp-session-id": sessionId,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: method, arguments: params },
    }),
  });

  const json = await toolRes.json();
  if (json.error) throw new Error(`MCP error: ${json.error.message}`);
  return json.result;
}

function assert(name, condition, detail = "") {
  if (condition) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

function getResultText(result) {
  return result?.content?.map((c) => c.text || "").join("\n") || "";
}

// ── Tests ────────────────────────────────────────────────────────────────────

async function testHealth() {
  console.log("\n🏥 Health check");
  const res = await fetch(`${BASE}/health`);
  const json = await res.json();
  assert("status ok", json.status === "ok");
  assert("has standards > 0", json.standards > 0, `got ${json.standards}`);
  assert("has categories > 0", json.categories > 0, `got ${json.categories}`);
}

async function testSearchStandards() {
  console.log("\n🔍 search_standards");

  // Базовый поиск
  const r1 = await mcpCall("search_standards", { query: "запросы в цикле" });
  const t1 = getResultText(r1);
  assert("'запросы в цикле' находит результаты", t1.includes("std-"));
  assert("'запросы в цикле' содержит std-534", t1.includes("std-534"));

  // Повторный вызов — должен работать стабильно
  const r1b = await mcpCall("search_standards", { query: "запросы в цикле" });
  const t1b = getResultText(r1b);
  assert("повторный запрос стабилен", t1b.includes("std-534"));

  // Поиск на английском (синонимы)
  const r2 = await mcpCall("search_standards", { query: "transaction lock" });
  const t2 = getResultText(r2);
  assert("'transaction lock' (EN) находит результаты", t2.includes("std-"));

  // Стемминг
  const r3 = await mcpCall("search_standards", { query: "блокировок транзакциями" });
  const t3 = getResultText(r3);
  assert("стемминг 'блокировок транзакциями' работает", t3.includes("std-"));

  // Пустой результат
  const r4 = await mcpCall("search_standards", { query: "xyzzynonexistent12345" });
  const t4 = getResultText(r4);
  assert("несуществующий запрос — пусто", t4.includes("не найдено"));
}

async function testGetStandard() {
  console.log("\n📄 get_standard (ID normalization)");

  // Полный ID
  const r1 = await mcpCall("get_standard", { standard_id: "std-534" });
  const t1 = getResultText(r1);
  assert("'std-534' находит стандарт", t1.includes("std-534") && !t1.includes("не найден"));

  // Только число
  const r2 = await mcpCall("get_standard", { standard_id: "534" });
  const t2 = getResultText(r2);
  assert("'534' нормализуется в std-534", t2.includes("std-534") && !t2.includes("не найден"));

  // Без дефиса
  const r3 = await mcpCall("get_standard", { standard_id: "std534" });
  const t3 = getResultText(r3);
  assert("'std534' нормализуется в std-534", t3.includes("std-534") && !t3.includes("не найден"));

  // С подчёркиванием
  const r4 = await mcpCall("get_standard", { standard_id: "std_534" });
  const t4 = getResultText(r4);
  assert("'std_534' нормализуется в std-534", t4.includes("std-534") && !t4.includes("не найден"));

  // Fallback по заголовку
  const r5 = await mcpCall("get_standard", { standard_id: "Структура модуля" });
  const t5 = getResultText(r5);
  assert("fallback по заголовку 'Структура модуля'", !t5.includes("не найден"));

  // Несуществующий
  const r6 = await mcpCall("get_standard", { standard_id: "std-999999" });
  const t6 = getResultText(r6);
  assert("несуществующий ID — сообщение об ошибке", t6.includes("не найден"));
}

async function testListCategories() {
  console.log("\n📂 list_categories");
  const r = await mcpCall("list_categories", {});
  const t = getResultText(r);
  assert("возвращает категории", t.includes("Категории"));
  assert("содержит количество стандартов", t.includes("стандартов"));
}

async function testCheckCode() {
  console.log("\n🔎 check_code");

  // Код с запросом в цикле
  const r1 = await mcpCall("check_code", {
    code: `Для Каждого Док Из МассивДокументов Цикл
    Запрос = Новый Запрос;
    Запрос.Текст = "ВЫБРАТЬ * ИЗ Документ.Заказ ГДЕ Ссылка = &Ссылка";
    Результат = Запрос.Выполнить();
КонецЦикла;`,
  });
  const t1 = getResultText(r1);
  assert("детектирует запрос в цикле", t1.includes("std-534"));

  // Чистый код
  const r2 = await mcpCall("check_code", {
    code: `Процедура Тест()\n\tВозврат;\nКонецПроцедуры`,
  });
  const t2 = getResultText(r2);
  assert("чистый код — нет нарушений", t2.includes("✅"));
}

// ── Runner ───────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🚀 Smoke-тесты MCP-сервера: ${BASE}\n${"═".repeat(50)}`);

  try {
    await testHealth();
    await testSearchStandards();
    await testGetStandard();
    await testListCategories();
    await testCheckCode();
  } catch (err) {
    console.error(`\n💥 Фатальная ошибка: ${err.message}`);
    process.exit(2);
  }

  console.log(`\n${"═".repeat(50)}`);
  console.log(`Результат: ✅ ${passed} passed, ❌ ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
