const axios = require('axios');
const cheerio = require('cheerio');

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

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/html, */*',
  'Accept-Language': 'ru-RU,ru;q=0.9',
  'Referer': 'https://fssp.gov.ru/iss/ip/'
};

async function searchDebts({ lastName, firstName, middleName, birthDate, regionId = 0 }) {
  // FSSP search via GET with query params
  const params = {
    'is[0][last_name]': lastName,
    'is[0][first_name]': firstName,
    'is[0][patronymic]': middleName || '',
    'is[0][date]': birthDate,
    'is[0][region_id]': String(regionId),
    'is[0][type]': 'PHYSICAL'
  };

  try {
    const { data } = await axios.get('https://fssp.gov.ru/iss/ip/', {
      params,
      headers: HEADERS,
      timeout: 20000
    });

    // Try to parse JSON response
    if (typeof data === 'object') {
      return parseJson(data);
    }

    // Parse HTML response
    return parseHtml(data);
  } catch (err) {
    // Fallback: try the old API endpoint
    return searchFallback({ lastName, firstName, middleName, birthDate, regionId });
  }
}

async function searchFallback({ lastName, firstName, middleName, birthDate, regionId }) {
  // Alternative endpoint used by mobile apps
  const { data } = await axios.get('https://api-ip.fssp.gov.ru/api/v1.0/search/physical', {
    params: {
      region: regionId,
      lastname: lastName,
      firstname: firstName,
      secondname: middleName || '',
      birthdate: birthDate,
      output: 1
    },
    headers: HEADERS,
    timeout: 20000
  });

  const items = data?.result?.items || data?.items || [];
  return parseJsonItems(items);
}

function parseJson(data) {
  const items = data?.result?.items || data?.items || data?.data || [];
  if (!Array.isArray(items)) return { found: false, total: 0, activeCount: 0, totalAmount: 0, debts: [] };
  return parseJsonItems(items);
}

function parseJsonItems(items) {
  const debts = items.map(item => ({
    caseNumber: item.ip_id || '',
    openedAt: item.ip_date || '',
    subject: item.subject || '',
    amount: parseFloat(String(item.sum || '0').replace(/[^\d.]/g, '')) || 0,
    creditor: item.name || 'Не указан',
    department: item.ott || '',
    status: item.end_reason ? `Окончено: ${item.end_reason}` : 'Активное'
  }));

  const totalAmount = debts.reduce((s, d) => s + d.amount, 0);
  return {
    found: debts.length > 0,
    total: debts.length,
    activeCount: debts.filter(d => !d.status.startsWith('Окончено')).length,
    totalAmount,
    debts
  };
}

function parseHtml(html) {
  const $ = cheerio.load(html);
  const debts = [];

  $('table tbody tr').each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length < 3) return;
    const getText = i => $(cells[i]).text().trim();
    const amount = parseFloat(getText(3).replace(/[^\d.]/g, '')) || 0;
    debts.push({
      caseNumber: getText(0),
      openedAt: getText(1),
      subject: getText(2),
      amount,
      creditor: getText(4) || 'Не указан',
      department: getText(5) || '',
      status: getText(6) || 'Активное'
    });
  });

  const totalAmount = debts.reduce((s, d) => s + d.amount, 0);
  return {
    found: debts.length > 0,
    total: debts.length,
    activeCount: debts.filter(d => !d.status.startsWith('Окончено')).length,
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
