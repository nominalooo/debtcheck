const supabase = require('./client');

async function getOrCreateUser(telegramId, username) {
  let { data } = await supabase
    .from('users')
    .select('*')
    .eq('telegram_id', telegramId)
    .single();

  if (!data) {
    const { data: created } = await supabase
      .from('users')
      .insert({ telegram_id: telegramId, username })
      .select()
      .single();
    data = created;
  }
  return data;
}

async function getUser(telegramId) {
  const { data } = await supabase
    .from('users')
    .select('*')
    .eq('telegram_id', telegramId)
    .single();
  return data;
}

async function canCheck(user) {
  if (user.free_checks_used < 1) return true;
  if (user.plan === 'subscription') {
    const expires = user.subscription_expires_at;
    if (expires && new Date(expires) > new Date()) return true;
  }
  return false;
}

async function incrementFreeChecks(userId) {
  await supabase.rpc('increment_free_checks', { uid: userId });
}

async function saveCheck(data) {
  const { data: check, error } = await supabase
    .from('checks')
    .insert(data)
    .select()
    .single();
  if (error) throw error;
  return check;
}

async function getUserChecks(userId, limit = 5) {
  const { data } = await supabase
    .from('checks')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return data || [];
}

async function createPayment(data) {
  const { data: p, error } = await supabase
    .from('payments')
    .insert(data)
    .select()
    .single();
  if (error) throw error;
  return p;
}

async function updatePaymentStatus(yookassaId, status) {
  const { data, error } = await supabase
    .from('payments')
    .update({ status })
    .eq('yookassa_payment_id', yookassaId)
    .select('*, users(*)')
    .single();
  if (error) throw error;
  return data;
}

async function activateSubscription(userId, months = 1) {
  const expires = new Date();
  expires.setMonth(expires.getMonth() + months);
  await supabase
    .from('users')
    .update({ plan: 'subscription', subscription_expires_at: expires.toISOString() })
    .eq('id', userId);
}

async function addMonitor(data) {
  const { data: m, error } = await supabase
    .from('monitors')
    .insert(data)
    .select()
    .single();
  if (error) throw error;
  return m;
}

async function getActiveMonitors() {
  const { data } = await supabase
    .from('monitors')
    .select('*, users(*)')
    .eq('is_active', true);
  return data || [];
}

async function updateMonitor(id, updates) {
  await supabase.from('monitors').update(updates).eq('id', id);
}

module.exports = {
  getOrCreateUser, getUser, canCheck, incrementFreeChecks,
  saveCheck, getUserChecks, createPayment, updatePaymentStatus,
  activateSubscription, addMonitor, getActiveMonitors, updateMonitor
};
