const axios = require('axios');

// FSSP official async API: api-ip.fssp.gov.ru
// Registration (free): https://api-ip.fssp.gov.ru/register
// Workflow: POST search → get task_id → poll until status=1 → read result

const BASE = 'https://api-ip.fssp.gov.ru/api/v1.0';

const REGIONS = {
  0:  'Все регионы',
  77: 'Москва',
  78: 'Санкт-Петербург',
  50: 'Московская область',
  23: 'Краснодарский край',
  16: 'Республика Татарстан',
  66: 'Свердловская область',
  54: 'Новосибирская область',
  74: 'Челябинская область',
  61: 'Ростовская область',
  63: 'Самарская область'
};

async function searchDebts({ lastName, firstName, middleName, birthDate, regionId = 0 }) {
  const token = process.env.FSSP_TOKEN;
  if (!token) throw new Error('FSSP_TOKEN не настроен');

  // Step 1: submit search
  const { data: submitData } = await axios.post(
    `${BASE}/search/group`,
    {
      token,
      request: [{
        type: 1,
        params: {
          lastname: lastName,
          firstname: firstName,
          secondname: middleName || '',
          birthdate: birthDate,   // DD.MM.YYYY
          region: regionId
        }
      }]
    },
    {
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000
    }
  );

  if (submitData.status !== 0) {
    throw new Error(`FSSP submit error: status=${submitData.status}`);
  }

  const taskId = submitData.task_id;
  if (!taskId) throw new Error('FSSP не вернул task_id');

  // Step 2: poll until done (status=1)
  return await pollResult(token, taskId);
}

async function pollResult(token, taskId, attempts = 10, delayMs = 2000) {
  for (let i = 0; i < attempts; i++) {
    await sleep(i === 0 ? 2000 : delayMs);

    const { data } = await axios.get(`${BASE}/result/group`, {
      params: { token, task_id: taskId },
      timeout: 15000
    });

    // status 1 = done, 0 = still processing
    if (data.status === 1) {
      return parseResult(data);
    }
  }
  throw new Error('ФССП не ответил за отведённое время, попробуйте позже');
}

function parseResult(data) {
  // result is array of request results, we sent 1 request so take [0]
  const items = data.result?.[0]?.items || [];

  const debts = items.map(item => ({
    caseNumber: item.ip_id || '',
    openedAt: item.ip_date || '',
    subject: item.subject || '',
    amount: parseFloat(String(item.sum || '0').replace(/[^\d.,]/g, '').replace(',', '.')) || 0,
    creditor: item.name || 'Не указан',
    department: item.ott || '',
    bailiff: item.bailiff || '',
    status: item.end_reason ? `Окончено: ${item.end_reason}` : 'Активное'
  }));

  const totalAmount = debts.reduce((s, d) => s + d.amount, 0);
  const activeDebts = debts.filter(d => !d.status.startsWith('Окончено'));

  return {
    found: debts.length > 0,
    total: debts.length,
    activeCount: activeDebts.length,
    totalAmount,
    debts
  };
}

function parseName(fullName) {
  const parts = fullName.trim().split(/\s+/);
  return {
    lastName: parts[0] || '',
    firstName: parts[1] || '',
    middleName: parts[2] || ''
  };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

module.exports = { searchDebts, parseName, REGIONS };
