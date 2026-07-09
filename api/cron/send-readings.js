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
          { subscriber_id: subscriber.id, reading_date: today, ...reading },
          { onConflict: 'subscriber_id,reading_date' }
        )
        .select()
        .single();

      if (saveErr) throw saveErr;

      await sendEmail(subscriber, reading, savedReading.id);

      await supabase
        .from('readings')
        .update({ email_sent_at: new Date().toISOString() })
        .eq('id', savedReading.id);

      sent++;
      await new Promise((r) => setTimeout(r, 200));
    } catch (err) {
      console.error(`Failed for ${subscriber.email}:`, err);
      errors.push({ email: subscriber.email, error: err.message });
      failed++;
    }
  }

  return res.status(200).json({ sent, failed, total: (subscribers || []).length, errors });
};

function getMoonPhase(dateStr) {
  const date = new Date(dateStr);
  const known = new Date('2000-01-06');
  const diff = (date - known) / (1000 * 60 * 60 * 24);
  const cycle = diff % 29.53;
  if (cycle < 1.85) return 'New Moon';
  if (cycle < 7.38) return 'Waxing Crescent';
  if (cycle < 9.22) return 'First Quarter';
  if (cycle < 14.77) return 'Waxing Gibbous';
  if (cycle < 16.61) return 'Full Moon';
  if (cycle < 22.15) return 'Waning Gibbous';
  if (cycle < 23.99) return 'Last Quarter';
  return 'Waning Crescent';
}

function getPersonalDay(dob, dateStr) {
  const rd = new Date(dateStr);
  const month = rd.getUTCMonth() + 1;
  const day = rd.getUTCDate();
  const year = rd.getUTCFullYear();
  const digits = (month + '' + day + '' + year).split('').map(Number);
  let sum = digits.reduce((a, b) => a + b, 0);
  while (sum > 9 && ![11, 22].includes(sum)) {
    sum = sum.toString().split('').map(Number).reduce((a, b) => a + b, 0);
  }
  return sum;
}

async function generateReading(subscriber, date) {
  const isPremium = subscriber.plan === 'premium';
  const hasCosmicPlus = subscriber.has_cosmic_plus;
  const moonPhase = getMoonPhase(date);
  const personalDay = getPersonalDay(subscriber.dob, date);

  const prompt = `Generate a personalized daily reading for ${subscriber.name}.
Sign: ${subscriber.zodiac_sign}
Life Path: ${subscriber.life_path_number}
Personal Day: ${personalDay}
Moon phase: ${moonPhase}
Date: ${date}
Plan: ${subscriber.plan}${hasCosmicPlus ? `
Chinese Zodiac: ${subscriber.chinese_zodiac}` : ''}

Return ONLY valid JSON:
{
  "headline": "compelling one-sentence insight, 15-20 words",
  "horoscope": "3-4 sentences, personalized, no clichés",
  "numerology_title": "4-6 word title for their personal day energy",
  "numerology_text": "2-3 sentences, practical and specific",
  "journal_prompt": "one focused thought-provoking question",
  "email_subject": "compelling subject line 6-10 words"${isPremium ? `,
  "moon_ritual": "2-3 sentence moon ritual for the ${moonPhase}",
  "compatibility_note": "2 sentence compatibility insight"` : ''}${hasCosmicPlus ? `,
  "cosmic_plus_insight": "2-3 sentences weaving together their Western sign (${subscriber.zodiac_sign}) and Chinese zodiac (${subscriber.chinese_zodiac}) into one cohesive insight for today"` : ''}
}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 900,
      system: 'You are Soulwrit — warm, perceptive, specific. Every soul carries a code, written in the stars and in numbers. Never use astrology clichés. Return only valid JSON, no preamble.',
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const data = await response.json();
  const text = (data.content?.[0]?.text || '').replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(text);

  return {
    headline: parsed.headline,
    horoscope: parsed.horoscope,
    numerology_title: parsed.numerology_title,
    numerology_text: parsed.numerology_text,
    journal_prompt: parsed.journal_prompt,
    email_subject: parsed.email_subject,
    personal_day: personalDay,
    moon_phase: moonPhase,
    moon_ritual: parsed.moon_ritual || null,
    compatibility_note: parsed.compatibility_note || null,
    cosmic_plus_insight: parsed.cosmic_plus_insight || null,
  };
}

async function sendEmail(subscriber, reading, readingId) {
  const portalLink = `https://soulwrit.ca/portal?rid=${readingId}`;
  const isPremium = subscriber.plan === 'premium';
  const hasCosmicPlus = subscriber.has_cosmic_plus;

  const premiumBlock = isPremium && reading.moon_ritual ? `
    <div style="background:#0B0912;border:1px solid rgba(212,175,106,0.25);border-radius:4px;padding:20px;margin-top:12px;">
      <p style="font-size:10px;color:#F3D9A4;text-transform:uppercase;letter-spacing:0.14em;margin:0 0 10px;">✦ Premium · ${reading.moon_phase}</p>
      <p style="font-size:13px;color:#9C93B0;line-height:1.7;margin:0 0 14px;">${reading.moon_ritual}</p>
      <p style="font-size:12.5px;color:#F3D9A4;font-weight:bold;margin:0 0 4px;">Today's Compatibility</p>
      <p style="font-size:13px;color:#9C93B0;line-height:1.7;margin:0;">${reading.compatibility_note || ''}</p>
    </div>` : '';

  const cosmicPlusBlock = hasCosmicPlus && reading.cosmic_plus_insight ? `
    <div style="background:linear-gradient(135deg,#241B38,#332648);border:1px solid rgba(212,175,106,0.25);border-radius:4px;padding:20px;margin-top:12px;">
      <p style="font-size:10px;color:#F3D9A4;text-transform:uppercase;letter-spacing:0.14em;margin:0 0 10px;">✦ Cosmic Plus · ${subscriber.chinese_zodiac}</p>
      <p style="font-size:13px;color:#9C93B0;line-height:1.7;margin:0;">${reading.cosmic_plus_insight}</p>
    </div>` : '';

  await resend.emails.send({
    from: `Soulwrit <hello@soulwrit.ca>`,
    to: subscriber.email,
    subject: reading.email_subject || `Your ${subscriber.zodiac_sign} reading for today`,
    html: `
      <div style="font-family:Georgia,Arial,sans-serif;max-width:560px;margin:0 auto;background:#0B0912;padding:24px 10px;">
        <p style="font-family:Georgia,serif;font-style:italic;font-size:20px;color:#F3D9A4;text-align:center;margin:0 0 20px;">Soulwrit</p>

        <div style="background:linear-gradient(135deg,#241B38,#332648);border:1px solid rgba(212,175,106,0.18);border-radius:4px;padding:26px;margin-bottom:12px;">
          <p style="font-size:11px;color:#F3D9A4;margin:0 0 12px;letter-spacing:0.04em;">${subscriber.zodiac_sign} · Life Path ${subscriber.life_path_number} · Personal Day ${reading.personal_day}</p>
          <p style="font-family:Georgia,serif;font-size:22px;font-style:italic;color:#EDE8DC;line-height:1.35;margin:0;">${reading.headline}</p>
        </div>

        <div style="background:#141020;border:1px solid rgba(212,175,106,0.18);border-radius:4px;padding:26px;">
          <p style="font-size:14px;color:#EDE8DC;margin:0 0 20px;">Good morning, <strong style="color:#F3D9A4;">${subscriber.name}</strong>.</p>

          <p style="font-size:10px;color:#9C93B0;text-transform:uppercase;letter-spacing:0.16em;margin:0 0 10px;">Horoscope</p>
          <p style="font-size:14px;color:#EDE8DC;opacity:0.85;line-height:1.8;margin:0 0 22px;">${reading.horoscope}</p>

          <div style="background:#241B38;border-radius:2px;padding:16px;margin-bottom:22px;">
            <p style="font-size:12.5px;color:#F3D9A4;font-weight:bold;margin:0 0 6px;">${reading.numerology_title}</p>
            <p style="font-size:13px;color:#9C93B0;line-height:1.6;margin:0;">${reading.numerology_text}</p>
          </div>

          <div style="background:rgba(143,174,148,0.08);border-left:2px solid #8FAE94;border-radius:0 2px 2px 0;padding:16px 18px;margin-bottom:24px;">
            <p style="font-size:10px;color:#8FAE94;text-transform:uppercase;letter-spacing:0.14em;margin:0 0 8px;">Journal Prompt</p>
            <p style="font-family:Georgia,serif;font-size:17px;font-style:italic;color:#EDE8DC;margin:0;">${reading.journal_prompt}</p>
          </div>

          ${premiumBlock}
          ${cosmicPlusBlock}

          <div style="text-align:center;margin-top:22px;">
            <a href="${portalLink}" style="display:inline-block;background:#D4AF6A;color:#0B0912;padding:12px 30px;border-radius:2px;font-family:Arial,sans-serif;font-size:13px;font-weight:bold;text-decoration:none;letter-spacing:0.04em;text-transform:uppercase;">Open your journal →</a>
          </div>
        </div>

        <p style="text-align:center;font-size:11px;color:#6B6480;margin-top:20px;line-height:1.7;">
          Soulwrit · Edmonton, AB<br/>
          <a href="https://soulwrit.ca/unsubscribe?id=${subscriber.id}" style="color:#6B6480;">Unsubscribe</a> ·
          <a href="https://soulwrit.ca/portal/account" style="color:#6B6480;">Manage preferences</a>
        </p>
      </div>
    `,
  });
}
