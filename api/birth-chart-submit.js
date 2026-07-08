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

  try {
    const { subscriberId, birthTime, birthCity } = req.body;
    if (!subscriberId || !birthTime || !birthCity) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const { data: subscriber, error: subErr } = await supabase
      .from('subscribers')
      .select('*')
      .eq('id', subscriberId)
      .single();

    if (subErr || !subscriber) {
      return res.status(404).json({ error: 'Subscriber not found' });
    }

    // Step 1: Geocode the city using free Nominatim (OpenStreetMap)
    const geoRes = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(birthCity)}&format=json&limit=1`,
      { headers: { 'User-Agent': 'Soulwrit/1.0 (hello@soulwrit.ca)' } }
    );
    const geoData = await geoRes.json();
    if (!geoData || !geoData.length) {
      return res.status(400).json({ error: 'Could not find that city. Try being more specific (e.g. "Paris, France").' });
    }
    const lat = parseFloat(geoData[0].lat);
    const lng = parseFloat(geoData[0].lon);

    // Step 2: Get timezone for that lat/lng (using free TimeAPI)
    const tzRes = await fetch(
      `https://timeapi.io/api/timezone/coordinate?latitude=${lat}&longitude=${lng}`
    );
    const tzData = await tzRes.json();
    const timezone = tzData.timeZone || 'UTC';

    // Step 3: Parse birth date + time
    const [year, month, day] = subscriber.dob.split('-').map(Number);
    const [hour, minute] = birthTime.split(':').map(Number);

    // Step 4: Call Astrologer API for birth chart context
    const chartRes = await fetch('https://astrologer.p.rapidapi.com/api/v5/context/birth-chart', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-rapidapi-host': 'astrologer.p.rapidapi.com',
        'x-rapidapi-key': process.env.ASTROLOGER_API_KEY,
      },
      body: JSON.stringify({
        subject: {
          name: subscriber.name,
          year, month, day, hour, minute,
          longitude: lng,
          latitude: lat,
          timezone,
          city: birthCity,
          nation: 'XX',
        },
      }),
    });

    const chartData = await chartRes.json();
    if (!chartRes.ok || !chartData.context) {
      console.error('Astrologer API error:', JSON.stringify(chartData));
      return res.status(500).json({ error: 'Astrologer API error: ' + JSON.stringify(chartData.errors || chartData) });
    }

    // Step 5: Generate AI interpretation from the chart context
    const prompt = `You are writing a personalized birth chart reading for ${subscriber.name}.

Here is their real, calculated natal chart data:
${chartData.context}

Write a warm, insightful "Your Cosmic Blueprint" reading in this exact JSON format, using ONLY the real planetary data above — do not invent placements:
{
  "title": "a compelling 4-6 word title for their chart",
  "overview": "3-4 sentence overview of their core personality based on Sun, Moon, and Ascendant",
  "sun_moon_rising": "2-3 sentences specifically on their Sun/Moon/Ascendant combination and what it reveals",
  "key_placements": "3-4 sentences on their most notable planetary placements (Mercury, Venus, Mars) and what they mean practically",
  "growth_edge": "2-3 sentences on a placement that represents their biggest growth opportunity or challenge"
}
Return ONLY valid JSON, no preamble, no markdown formatting.`;

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        system: 'You are Soulwrit — warm, perceptive, specific. Every soul carries a code, written in the stars and in numbers. Never use astrology clichés. Return only valid JSON, no preamble.',
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const aiData = await aiRes.json();
    const text = (aiData.content?.[0]?.text || '').replace(/```json|```/g, '').trim();
    const reading = JSON.parse(text);

    // Step 6: Save everything to Supabase
    const { error: updateErr } = await supabase
      .from('subscribers')
      .update({
        birth_time: birthTime,
        birth_city: birthCity,
        birth_lat: lat,
        birth_lng: lng,
        birth_timezone: timezone,
        birth_chart_data: chartData,
        birth_chart_reading: JSON.stringify(reading),
      })
      .eq('id', subscriberId);

    if (updateErr) throw updateErr;

    return res.status(200).json({ success: true, reading });
  } catch (err) {
    console.error('Birth chart submit error:', err);
    return res.status(500).json({ error: 'Something went wrong generating your chart. Please try again.' });
  }
};
