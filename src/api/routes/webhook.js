const express = require('express');
const { updatePaymentStatus, activateSubscription, getUser } = require('../../db/queries');
const bot = require('../../bot');
const logger = require('../../logger');

const router = express.Router();
router.use(express.json());

router.post('/yookassa', async (req, res) => {
  const event = req.body;
  if (event.type !== 'payment.succeeded') return res.sendStatus(200);

  const payment = event.object;
  const { product, telegram_id, user_id } = payment.metadata || {};

  try {
    await updatePaymentStatus(payment.id, 'succeeded');

    if (product === 'subscription_month' && user_id) {
      await activateSubscription(user_id, 1);
    }

    if (telegram_id) {
      const messages = {
        single_check: '✅ Оплата прошла! Проверка активирована. Вернитесь в бот и нажмите "Проверить долги".',
        subscription_month: '✅ Подписка активирована на 1 месяц! Теперь доступны неограниченные проверки и мониторинг.'
      };
      await bot.telegram.sendMessage(telegram_id, messages[product] || '✅ Оплата прошла!');
    }

    res.sendStatus(200);
  } catch (e) {
    logger.error('Webhook error', { error: e.message });
    res.sendStatus(500);
  }
});

module.exports = router;
