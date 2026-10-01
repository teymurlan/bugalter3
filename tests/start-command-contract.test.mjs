import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const wrangler = read('wrangler.jsonc');
const worker = read('src/production-start-fix.js');

test('start and menu are handled directly by the active production worker', () => {
  assert.match(wrangler, /"main"\s*:\s*"src\/production-start-fix\.js"/);
  assert.match(worker, /command === '\/start'/);
  assert.match(worker, /command === '\/menu'/);
  assert.match(worker, /handleStartOrMenu/);
  assert.match(worker, /return new Response\('OK'\)/);
  assert.match(worker, /production-public-order\.js/);
});

test('accepted client always receives a fresh menu with the correct role buttons', () => {
  assert.match(worker, /consent\?\.status === 'accepted'/);
  assert.match(worker, /Открыть HOUSE CLEANING/);
  assert.match(worker, /Панель администратора/);
  assert.match(worker, /isFullAdmin\(env, userId\)/);
  assert.match(worker, /sendMessage/);
  assert.match(worker, /saveMenuId/);
});

test('new and declined users still keep the consent flow', () => {
  assert.match(worker, /Согласен и продолжить/);
  assert.match(worker, /Политика обработки персональных данных/);
  assert.match(worker, /Не согласен/);
  assert.match(worker, /Доступ к записи ограничен/);
});

test('webhook secret is checked before the direct start handler', () => {
  assert.match(worker, /TELEGRAM_WEBHOOK_SECRET/);
  assert.match(worker, /X-Telegram-Bot-Api-Secret-Token/);
  assert.match(worker, /status: 401/);
});
