require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { getOrCreateUser, getUser, canCheck, incrementFreeChecks, saveCheck } = require('../db/queries');
const { searchDebts, parseName, REGIONS } = require('../fssp');
const { createYookassaPayment } = require('../payments');
const logger = require('../logger');

const bot = new Telegraf(process.env.BOT_TOKEN);

// State machine per user (in-memory, ok for MVP)
const sessions = new Map();

function setSession(id, data) { sessions.set(id, data); }
function getSession(id) { return sessions.get(id) || {}; }

// ─── /start ───────────────────────────────────────────────────────────────
bot.start(async (ctx) => {
  const user = await getOrCreateUser(ctx.from.id, ctx.from.username);
  const hasFreePassed = user.free_checks_used >= 1;

  await ctx.replyWithMarkdown(
    `👋 *DebtCheck* — проверка долгов по базе ФССП\n\n` +
    `Введите ФИО и дату рождения — покажу все исполнительные производства: долги МФО, банков, ЖКХ, штрафы.\n\n` +
    `${hasFreePassed ? '💳 У вас использована бесплатная проверка.' : '🆓 Первая проверка — бесплатно.'}`,
    Markup.inlineKeyboard([
      [Markup.button.callback('🔍 Проверить долги', 'start_check')],
      [Markup.button.callback('📋 Мои проверки', 'my_checks')],
      [Markup.button.callback('💰 Тарифы', 'plans')]
    ])
  );
});

// ─── Тарифы ───────────────────────────────────────────────────────────────
bot.action('plans', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.replyWithMarkdown(
    `💰 *Тарифы DebtCheck*\n\n` +
    `🆓 *Бесплатно* — 1 проверка\n` +
    `🔍 *Разовая проверка* — 99 ₽\n` +
    `📡 *Подписка на месяц* — 199 ₽\n` +
    `  • Неограниченные проверки\n` +
    `  • Мониторинг: уведомление о новых долгах\n` +
    `  • История всех проверок`,
    Markup.inlineKeyboard([
      [Markup.button.callback('Купить проверку — 99 ₽', 'buy_single')],
      [Markup.button.callback('Подписка — 199 ₽/мес', 'buy_sub')]
    ])
  );
});

bot.action('buy_single', async (ctx) => {
  await ctx.answerCbQuery();
  const user = await getUser(ctx.from.id);
  try {
    const url = await createYookassaPayment(user.id, 'single_check', ctx.from.id);
    await ctx.replyWithMarkdown(
      '💳 Оплатите проверку:',
      Markup.inlineKeyboard([[Markup.button.url('Оплатить 99 ₽', url)]])
    );
  } catch (e) {
    await ctx.reply('Ошибка создания платежа. Попробуйте позже.');
    logger.error('Payment error', { error: e.message });
  }
});

bot.action('buy_sub', async (ctx) => {
  await ctx.answerCbQuery();
  const user = await getUser(ctx.from.id);
  try {
    const url = await createYookassaPayment(user.id, 'subscription_month', ctx.from.id);
    await ctx.replyWithMarkdown(
      '💳 Оформите подписку:',
      Markup.inlineKeyboard([[Markup.button.url('Оплатить 199 ₽/мес', url)]])
    );
  } catch (e) {
    await ctx.reply('Ошибка создания платежа. Попробуйте позже.');
    logger.error('Payment error', { error: e.message });
  }
});

// ─── Начало проверки ──────────────────────────────────────────────────────
bot.action('start_check', async (ctx) => {
  await ctx.answerCbQuery();
  setSession(ctx.from.id, { step: 'await_name' });
  await ctx.replyWithMarkdown(
    `Введите *полное ФИО* через пробел:\n\n_Пример: Иванов Иван Иванович_`
  );
});

// ─── Мои проверки ─────────────────────────────────────────────────────────
bot.action('my_checks', async (ctx) => {
  await ctx.answerCbQuery();
  const user = await getUser(ctx.from.id);
  if (!user) return ctx.reply('Сначала напишите /start');

  const { getUserChecks } = require('../db/queries');
  const checks = await getUserChecks(user.id);

  if (checks.length === 0) return ctx.reply('Проверок пока нет. Нажмите "Проверить долги".');

  let text = '📋 *Последние проверки:*\n\n';
  for (const c of checks) {
    const date = new Date(c.created_at).toLocaleDateString('ru-RU');
    text += `• ${c.full_name} — ${date}\n`;
    text += `  Долгов: ${c.debts_count}, Сумма: ${c.total_amount.toLocaleString('ru-RU')} ₽\n\n`;
  }
  await ctx.replyWithMarkdown(text);
});

// ─── Обработка текстовых сообщений (ФИО и дата) ──────────────────────────
bot.on('text', async (ctx) => {
  const session = getSession(ctx.from.id);
  const text = ctx.message.text.trim();

  if (text.startsWith('/')) return;

  if (session.step === 'await_name') {
    const parts = text.split(/\s+/);
    if (parts.length < 2) {
      return ctx.reply('Введите минимум фамилию и имя. Пример: Иванов Иван Иванович');
    }
    setSession(ctx.from.id, { step: 'await_date', fullName: text });
    return ctx.replyWithMarkdown(
      `Теперь введите *дату рождения* в формате ДД.ММ.ГГГГ:\n\n_Пример: 15.03.1985_`
    );
  }

  if (session.step === 'await_date') {
    if (!/^\d{2}\.\d{2}\.\d{4}$/.test(text)) {
      return ctx.reply('Неверный формат. Введите дату так: 15.03.1985');
    }
    setSession(ctx.from.id, { ...session, step: 'await_region', birthDate: text });

    const regionButtons = Object.entries(REGIONS).map(([id, name]) =>
      [Markup.button.callback(name, `region_${id}`)]
    );
    return ctx.replyWithMarkdown(
      `Выберите регион (или "Все регионы" для поиска по всей России):`,
      Markup.inlineKeyboard(regionButtons)
    );
  }
});

// ─── Выбор региона и запуск проверки ─────────────────────────────────────
bot.action(/^region_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const regionId = parseInt(ctx.match[1]);
  const session = getSession(ctx.from.id);

  if (!session.fullName || !session.birthDate) {
    return ctx.reply('Сессия истекла. Начните заново с /start');
  }

  const user = await getOrCreateUser(ctx.from.id, ctx.from.username);
  const allowed = await canCheck(user);

  if (!allowed) {
    return ctx.replyWithMarkdown(
      `❌ *Бесплатная проверка уже использована*\n\nВыберите тариф для продолжения:`,
      Markup.inlineKeyboard([
        [Markup.button.callback('Купить проверку — 99 ₽', 'buy_single')],
        [Markup.button.callback('Подписка — 199 ₽/мес', 'buy_sub')]
      ])
    );
  }

  setSession(ctx.from.id, {});
  const loadingMsg = await ctx.reply('🔍 Ищу в базе ФССП...');

  try {
    const { lastName, firstName, middleName } = parseName(session.fullName);
    const result = await searchDebts({
      lastName, firstName, middleName,
      birthDate: session.birthDate,
      regionId
    });

    // Increment free check counter for first-time users
    if (user.free_checks_used < 1) {
      await incrementFreeChecks(user.id);
    }

    // Save to DB
    await saveCheck({
      user_id: user.id,
      full_name: session.fullName,
      birth_date: session.birthDate,
      region_id: regionId,
      result,
      debts_count: result.total,
      total_amount: result.totalAmount,
      is_paid: user.plan !== 'free' || user.free_checks_used === 0
    });

    await ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id).catch(() => {});
    await sendResult(ctx, session.fullName, result);

  } catch (e) {
    await ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id).catch(() => {});
    logger.error('FSSP search failed', { error: e.message });
    await ctx.reply(`Ошибка при запросе: ${e.message}`);
  }
});

async function sendResult(ctx, fullName, result) {
  if (!result.found) {
    return ctx.replyWithMarkdown(
      `✅ *${fullName}*\n\n` +
      `Исполнительных производств в базе ФССП *не найдено*.\n\n` +
      `_Долги у приставов отсутствуют._`,
      Markup.inlineKeyboard([
        [Markup.button.callback('🔍 Проверить ещё кого-то', 'start_check')],
        [Markup.button.callback('📡 Следить за изменениями', 'add_monitor')]
      ])
    );
  }

  let text = `⚠️ *${fullName}*\n\n`;
  text += `Найдено производств: *${result.total}* (активных: ${result.activeCount})\n`;
  text += `Общая сумма: *${result.totalAmount.toLocaleString('ru-RU')} ₽*\n\n`;

  const show = result.debts.slice(0, 5);
  for (const d of show) {
    text += `📌 *${d.creditor}*\n`;
    if (d.subject) text += `   ${d.subject}\n`;
    text += `   Сумма: ${d.amount.toLocaleString('ru-RU')} ₽\n`;
    text += `   Статус: ${d.status}\n\n`;
  }

  if (result.debts.length > 5) {
    text += `_...и ещё ${result.debts.length - 5} производств_\n\n`;
  }

  text += `_Данные из открытой базы ФССП России_`;

  await ctx.replyWithMarkdown(
    text,
    Markup.inlineKeyboard([
      [Markup.button.callback('📡 Следить за изменениями', 'add_monitor')],
      [Markup.button.callback('🔍 Проверить ещё кого-то', 'start_check')]
    ])
  );
}

bot.action('add_monitor', async (ctx) => {
  await ctx.answerCbQuery();
  const user = await getUser(ctx.from.id);
  if (user?.plan !== 'subscription') {
    return ctx.replyWithMarkdown(
      `📡 *Мониторинг* доступен на подписке (199 ₽/мес)\n\nБуду уведомлять когда появятся новые долги.`,
      Markup.inlineKeyboard([[Markup.button.callback('Оформить подписку', 'buy_sub')]])
    );
  }
  setSession(ctx.from.id, { step: 'await_name', forMonitor: true });
  await ctx.replyWithMarkdown('Введите ФИО для мониторинга:');
});

module.exports = bot;
