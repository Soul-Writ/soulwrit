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
    if (!subscriber.stripe_subscription_id) {
      return res.status(400).json({ error: 'No active subscription found' });
    }

    await stripe.subscriptionItems.create({
      subscription: subscriber.stripe_subscription_id,
      price: process.env.STRIPE_PRICE_COSMIC_PLUS,
    });

    const year = new Date(subscriber.dob).getUTCFullYear();
    const animals = ['Rat', 'Ox', 'Tiger', 'Rabbit', 'Dragon', 'Snake', 'Horse', 'Goat', 'Monkey', 'Rooster', 'Dog', 'Pig'];
    const elements = ['Metal', 'Water', 'Wood', 'Fire', 'Earth'];
    const animal = animals[(year - 4) % 12];
    const element = elements[Math.floor(((year - 4) % 10) / 2)];
    const chineseZodiac = `${element} ${animal}`;

    await supabase
      .from('subscribers')
      .update({ has_cosmic_plus: true, chinese_zodiac: chineseZodiac })
      .eq('id', subscriberId);

    return res.status(200).json({ success: true, chineseZodiac });
  } catch (err) {
    console.error('Add Cosmic Plus error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};
