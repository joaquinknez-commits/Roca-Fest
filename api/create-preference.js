module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const SUPABASE_URL = 'https://vdomxszqpikqsvcrfupb.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZkb214c3pxcGlrcXN2Y3JmdXBiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTM1MjE1MiwiZXhwIjoyMDkwOTI4MTUyfQ.wmJl_ZaOy6XnOXcxUYY1Ad2ZkJLXEU4YX6fW7s34Sv8';
  const MP_TOKEN = 'APP_USR-4243972737547638-040423-a2ff61e68570ca76f0ed6d6a953578db-772975227';
  const BASE_URL = 'https://roca-fest.vercel.app';

  try {
    const { orderId } = req.body;
    if (!orderId) return res.status(400).json({ error: 'Missing orderId' });

    const orderRes = await fetch(
      `${SUPABASE_URL}/rest/v1/orders?id=eq.${orderId}&select=*,events(name,date),ticket_types(name,price)`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );
    const orders = await orderRes.json();
    if (!orders || orders.length === 0) return res.status(404).json({ error: 'Order not found' });
    const order = orders[0];

    const mpRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MP_TOKEN}`
      },
      body: JSON.stringify({
        items: [{
          title: `${order.ticket_types.name} — ${order.events.name}`,
          quantity: order.quantity,
          unit_price: Number(order.ticket_types.price),
          currency_id: 'ARS'
        }],
        payer: { name: order.buyer_name, email: order.buyer_email },
        external_reference: orderId,
        back_urls: {
          success: `${BASE_URL}/pago-ok.html?order=${orderId}`,
          failure: `${BASE_URL}/?pago=error`,
          pending: `${BASE_URL}/?pago=pendiente`
        },
        auto_return: 'approved',
        notification_url: `${BASE_URL}/api/webhook-mp`,
        statement_descriptor: 'ROCA ENTRADAS'
      })
    });

    const mpData = await mpRes.json();
    if (!mpData.init_point) return res.status(500).json({ error: 'MP error', detail: mpData });

    await fetch(`${SUPABASE_URL}/rest/v1/orders?id=eq.${orderId}`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ mp_payment_id: mpData.id })
    });

    return res.status(200).json({ init_point: mpData.init_point });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
