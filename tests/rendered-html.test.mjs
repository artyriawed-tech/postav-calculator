import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("сервер отдаёт приложение калькулятора", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /Постав/);
  assert.match(html, /калькулятор раскроя/i);
  assert.doesNotMatch(html, /Фактическая длина бревна|Готовая длина|Припуск по длине|Припуск к толщине|Припуск к ширине|Обязательный запас от коры/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/);
});

test("итоговый постав содержит только рабочее резюме без служебного аудита", async () => {
  const assets = new URL("../dist-static/assets/", import.meta.url);
  const files = await readdir(assets);
  const scripts = files.filter((file) => file.endsWith(".js"));
  const bundle = (await Promise.all(scripts.map((file) => readFile(new URL(file, assets), "utf8")))).join("\n");
  assert.match(bundle, /ПОЛЕЗНЫЙ ВЫХОД/);
  assert.match(bundle, /ЗАПОЛНЕНИЕ ТОРЦА/);
  assert.doesNotMatch(bundle, /РАЗМЕРОВ ПРОВЕРЕНО|СВОБОДНО ПО ПЛОЩАДИ|СПРАВОЧНЫЙ УЧЁТ СЫРЬЯ/);
});
