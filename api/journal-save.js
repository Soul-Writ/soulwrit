const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { readingId, subscriberId, readingDate, entryText } = req.body;
  if (!readingId || !subscriberId || !readingDate) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const { error } = await supabase
    .from('journal_entries')
    .upsert(
      {
        reading_id: readingId,
        subscriber_id: subscriberId,
        reading_date: readingDate,
        entry_text: entryText,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'reading_id' }
    );

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ success: true });
};
