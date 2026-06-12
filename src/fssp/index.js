const axios = require('axios');

// FSSP open API — free registration at https://api-ip.fssp.gov.ru
// Token obtained at fssp.gov.ru/api after email registration
const BASE = 'https://api-ip.fssp.gov.ru/api/v1.0';

const REGIONS = {
  77: 'Москва',
  78: 'Санкт-Петербург',
  50: 'Московская область',
  23: 'Краснодарский край',
  16: 'Республика Татарстан',
  66: 'Свердловская область',
  54: 'Новосибирская область',
  74: 'Челябинская область',
  61: 'Ростовская область',
  63: 'Самарская область',
  0: 'Все регионы'
};

async function searchDebts({ lastName, firstName, middleName, birthDate, regionId = 0 }) {
  const token = process.env.FSSP_TOKEN;

  const params = {
    token,
    region: regionId,
    lastname: lastName,
    firstname: firstName,
    secondname: middleName || '',
    birthdate: birthDate, // format: DD.MM.YYYY
    output: 1
  };

  try {
    const { data } = await axios.get(`${BASE}/search/physical`, {
      params,
      timeout: 15000,
      headers: { 'Accept': 'application/json' }
    });

    if (data.status !== 0) {
      throw new Error(`FSSP API error: status ${data.status}`);
    }

    const items = data.result?.items || [];
    return parseDebts(items);
  } catch (err) {
    if (err.response?.status === 401) throw new Error('FSSP_TOKEN не настроен или неверный');
    if (err.code === 'ECONNABORTED') throw new Error('FSSP API не отвечает, попробуйте позже');
    throw err;
  }
}

function parseDebts(items) {
  const debts = items.map(item => ({
    caseNumber: item.ip_id || '',
    creditor: item.name || 'Не указан',
    subject: item.subject || '',
    amount: parseFloat(item.sum) || 0,
    currency: 'RUB',
    department: item.ott || '',
    bailiff: item.bailiff || '',
    openedAt: item.ip_date || '',
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

module.exports = { searchDebts, parseName, REGIONS };
