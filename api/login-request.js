const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);
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

  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const { data: subscriber, error } = await supabase
      .from('subscribers')
      .select('id, name, email')
      .eq('email', email.toLowerCase().trim())
      .maybeSingle();

    // Always return success even if not found, to avoid leaking which emails are registered
    if (error || !subscriber) {
      return res.status(200).json({ success: true });
    }

    const portalLink = `https://www.soulwrit.ca/portal?sid=${subscriber.id}`;

    await resend.emails.send({
      from: `Soulwrit <hello@soulwrit.ca>`,
      to: subscriber.email,
      subject: 'Your Soulwrit portal link',
      html: `
        <div style="font-family:Georgia,Arial,sans-serif;max-width:480px;margin:0 auto;background:#0B0912;padding:32px 24px;">
          <p style="font-family:Georgia,serif;font-style:italic;font-size:20px;color:#F3D9A4;text-align:center;margin:0 0 24px;">Soulwrit</p>
          <div style="background:#141020;border:1px solid rgba(212,175,106,0.18);border-radius:4px;padding:28px;">
            <p style="font-size:14px;color:#EDE8DC;margin:0 0 20px;">Hi ${subscriber.name},</p>
            <p style="font-size:14px;color:#EDE8DC;opacity:0.85;line-height:1.7;margin:0 0 24px;">Click below to open your Soulwrit portal — your readings, journal, and birth chart.</p>
            <div style="text-align:center;">
              <a href="${portalLink}" style="display:inline-block;background:#D4AF6A;color:#0B0912;padding:12px 30px;border-radius:2px;font-family:Arial,sans-serif;font-size:13px;font-weight:bold;text-decoration:none;letter-spacing:0.04em;text-transform:uppercase;">Open my portal →</a>
            </div>
          </div>
          <p style="text-align:center;font-size:11px;color:#6B6480;margin-top:20px;">Soulwrit · Edmonton, AB</p>
        </div>
      `,
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Login request error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};
