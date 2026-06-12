const crypto = require('crypto');
const { getActiveMonitors, updateMonitor } = require('../db/queries');
const { searchDebts, parseName } = require('../fssp');
const bot = require('../bot');
const logger = require('../logger');

function hashResult(result) {
  return crypto.createHash('md5').update(JSON.stringify(result.debts)).digest('hex');
}

async function runMonitorCycle() {
  const monitors = await getActiveMonitors();
  logger.info(`Monitor cycle: checking ${monitors.length} subscriptions`);

  for (const monitor of monitors) {
    try {
      const { lastName, firstName, middleName } = parseName(monitor.full_name);
      const result = await searchDebts({
        lastName, firstName, middleName,
        birthDate: monitor.birth_date,
        regionId: monitor.region_id || 0
      });

      const hash = hashResult(result);

      if (monitor.last_debts_hash && monitor.last_debts_hash !== hash) {
        // Changes detected — notify user
        const newCount = result.total;
        const oldCount = result.total; // approximate
        await bot.telegram.sendMessage(
          monitor.users.telegram_id,
          `🔔 *Изменение в базе ФССП*\n\n` +
          `${monitor.full_name}\n\n` +
          `Производств сейчас: *${result.total}*\n` +
          `Общая сумма: *${result.totalAmount.toLocaleString('ru-RU')} ₽*\n\n` +
          `Проверьте детали в боте.`,
          { parse_mode: 'Markdown' }
        );
        logger.info(`Monitor alert sent`, { monitorId: monitor.id });
      }

      await updateMonitor(monitor.id, {
        last_check_at: new Date().toISOString(),
        last_debts_hash: hash
      });

      await new Promise(r => setTimeout(r, 500));
    } catch (e) {
      logger.error('Monitor check failed', { monitorId: monitor.id, error: e.message });
    }
  }
}

module.exports = { runMonitorCycle };
