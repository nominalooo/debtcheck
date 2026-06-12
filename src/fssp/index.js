const axios = require('axios');
const cheerio = require('cheerio');

// FSSP public search — fssp.gov.ru/iss/ip (no API key needed)
const BASE = 'https://fssp.gov.ru';

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
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'ru-RU,ru;q=0.9',
  'Referer': 'https://fssp.gov.ru/iss/ip/'
};

async function searchDebts({ lastName, firstName, middleName, birthDate, regionId = 0 }) {
  // Step 1: get session cookies
  const session = axios.create({ baseURL: BASE, headers: HEADERS, timeout: 20000 });

  await session.get('/iss/ip/');

  // Step 2: submit search form
  const params = new URLSearchParams({
    'is[0][last_name]': lastName,
    'is[0][first_name]': firstName,
    'is[0][patronymic]': middleName || '',
    'is[0][date]': birthDate,
    'is[0][region_id]': String(regionId),
    'captcha': '',
    'submit': 'Найти'
  });

  const { data } = await session.post('/iss/ip/', params.toString(), {
    headers: {
      ...HEADERS,
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  });

  return parseHtml(data);
}

function parseHtml(html) {
  const $ = cheerio.load(html);
  const debts = [];

  // FSSP results are in table rows
  $('table.tablesorter tbody tr, .results-table tbody tr, table tbody tr').each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length < 4) return;

    const getText = (i) => $(cells[i]).text().trim();

    const amount = parseFloat(getText(3).replace(/[^\d.]/g, '')) || 0;
    if (amount === 0 && !getText(2)) return; // skip empty rows

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

  // Fallback: try JSON embedded in page
  if (debts.length === 0) {
    const jsonMatch = html.match(/var\s+data\s*=\s*(\[.*?\]);/s) ||
                      html.match(/"items"\s*:\s*(\[.*?\])/s);
    if (jsonMatch) {
      try {
        const items = JSON.parse(jsonMatch[1]);
        items.forEach(item => {
          debts.push({
            caseNumber: item.ip_id || '',
            openedAt: item.ip_date || '',
            subject: item.subject || '',
            amount: parseFloat(item.sum) || 0,
            creditor: item.name || 'Не указан',
            department: item.ott || '',
            status: item.end_reason ? `Окончено: ${item.end_reason}` : 'Активное'
          });
        });
      } catch {}
    }
  }

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
