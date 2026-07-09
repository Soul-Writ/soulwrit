const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { data: subscribers, error } = await supabase
    .from('subscribers')
    .select('*')
    .in('status', ['active', 'trialing']);

  if (error) return res.status(500).json({ error: error.message });

  const today = new Date().toISOString().split('T')[0];
  let sent = 0;
  let failed = 0;
  const errors = [];

  for (const subscriber of subscribers || []) {
    try {
      const { data: existing } = await supabase
        .from('readings')
        .select('id, email_sent_at')
        .eq('subscriber_id', subscriber.id)
        .eq('reading_date', today)
        .maybeSingle();

      if (existing?.email_sent_at) continue;

      const reading = await generateReading(subscriber, today);

      const { data: savedReading, error: saveErr } = await supabase
        .from('readings')
        .upsert(
