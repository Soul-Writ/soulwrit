const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
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
    const { subscriberId } = req.body;
    if (!subscriberId) return res.status(400).json({ error: 'Missing subscriberId' });

    const { data: subscriber, error } = await supabase
      .from('subscribers')
      .select('*')
      .eq('id', subscriberId)
      .single();

    if (error || !subscriber) return res.status(404).json({ error: 'Subscriber not found' });

    if (subscriber.stripe_subscription_id) {
      try {
        await stripe.subscriptions.cancel(subscriber.stripe_subscription_id);
      } catch (stripeErr) {
        console.error('Stripe cancel error (may already be cancelled):', stripeErr.message);
      }
    }

    await supabase
      .from('subscribers')
      .update({ status: 'cancelled' })
      .eq('id', subscriberId);

    return res.status(200).json({ success: true, name: subscriber.name });
  } catch (err) {
    console.error('Unsubscribe error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};
