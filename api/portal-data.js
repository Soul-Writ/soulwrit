const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { rid, sid } = req.query;
  if (!rid && !sid) return res.status(400).json({ error: 'Missing rid or sid parameter' });
  let subscriber, reading;
  if (rid) {
    const { data: readingData, error: readingErr } = await supabase
      .from('readings')
      .select('*')
      .eq('id', rid)
      .single();
    if (readingErr || !readingData) return res.status(404).json({ error: 'Reading not found' });
    reading = readingData;
    const { data: subData, error: subErr } = await supabase
      .from('subscribers')
      .select('*')
      .eq('id', reading.subscriber_id)
      .single();
    if (subErr || !subData) return res.status(404).json({ error: 'Subscriber not found' });
    subscriber = subData;
  } else {
    const { data: subData, error: subErr } = await supabase
      .from('subscribers')
      .select('*')
      .eq('id', sid)
      .single();
    if (subErr || !subData) return res.status(404).json({ error: 'Subscriber not found' });
    subscriber = subData;
    const { data: readingData } = await supabase
      .from('readings')
      .select('*')
      .eq('subscriber_id', subscriber.id)
      .order('reading_date', { ascending: false })
      .limit(1)
      .maybeSingle();
    reading = readingData;
    if (!reading) return res.status(404).json({ error: 'No readings yet for this subscriber' });
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
    .eq('reading_id', reading.id)
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
      id: subscriber.id,
      name: subscriber.name,
      zodiac_sign: subscriber.zodiac_sign,
      life_path_number: subscriber.life_path_number,
      plan: subscriber.plan,
      has_birth_chart: !!subscriber.birth_chart_reading,
    },
    today: reading,
    todayJournalEntry: journalEntry ? journalEntry.entry_text : '',
    archive: archive || [],
    journalEntries: allJournalEntries || [],
    stats: {
      readingsCount: readingsCount || 0,
      journalCount: (allJournalEntries || []).length,
    },
    birthChart: subscriber.birth_chart_reading ? JSON.parse(subscriber.birth_chart_reading) : null,
  });
};
