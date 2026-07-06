const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { rid } = req.query;
  if (!rid) return res.status(400).json({ error: 'Missing rid parameter' });

  const { data: reading, error: readingErr } = await supabase
    .from('readings')
    .select('*')
    .eq('id', rid)
    .single();

  if (readingErr || !reading) {
    return res.status(404).json({ error: 'Reading not found' });
  }

  const { data: subscriber, error: subErr } = await supabase
    .from('subscribers')
    .select('*')
    .eq('id', reading.subscriber_id)
    .single();

  if (subErr || !subscriber) {
    return res.status(404).json({ error: 'Subscriber not found' });
  }

  const { data: archive } = await supabase
    .from('readings')
    .select('*')
    .eq('subscriber_id', subscriber.id)
    .order('reading_date', { ascending: false })
    .limit(30);

  const { data: journalEntry } = await supabase
    .from('journal_entries')
    .select('*')
    .eq('reading_id', rid)
    .maybeSingle();

  const { data: allJournalEntries } = await supabase
    .from('journal_entries')
    .select('*')
    .eq('subscriber_id', subscriber.id)
    .order('reading_date', { ascending: false });

  const { count: readingsCount } = await supabase
    .from('readings')
    .select('*', { count: 'exact', head: true })
    .eq('subscriber_id', subscriber.id)
    .not('email_sent_at', 'is', null);

  return res.status(200).json({
    subscriber: {
      name: subscriber.name,
      zodiac_sign: subscriber.zodiac_sign,
      life_path_number: subscriber.life_path_number,
      plan: subscriber.plan,
    },
    today: reading,
    todayJournalEntry: journalEntry ? journalEntry.entry_text : '',
    archive: archive || [],
    journalEntries: allJournalEntries || [],
    stats: {
      readingsCount: readingsCount || 0,
      journalCount: (allJournalEntries || []).length,
    },
  });
};
