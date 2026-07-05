const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');
const { buffer } = require('micro');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports.config = { api: { bodyParser: false } };

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  let event;
  try {
    const buf = await buffer(req);
    const sig = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: 'Webhook signature verification failed' });
  }

  try {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const status =
          sub.status === 'trialing' ? 'trialing' :
          sub.status === 'active' ? 'active' :
          sub.status === 'past_due' ? 'past_due' : 'cancelled';

        await supabase
          .from('subscribers')
          .update({
            stripe_subscription_id: sub.id,
            status,
            trial_ends_at: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
          })
          .eq('stripe_customer_id', sub.customer);
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        await supabase
          .from('subscribers')
          .update({ status: 'cancelled' })
          .eq('stripe_customer_id', sub.customer);
        break;
      }
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook handler error:', err);
    return res.status(500).json({ error: 'Webhook handler failed' });
  }
};
