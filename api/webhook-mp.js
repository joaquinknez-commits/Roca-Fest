module.exports = async function handler(req, res) {
  if (req.method === 'GET') return res.status(200).end();

  const SUPABASE_URL = 'https://vdomxszqpikqsvcrfupb.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZkb214c3pxcGlrcXN2Y3JmdXBiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTM1MjE1MiwiZXhwIjoyMDkwOTI4MTUyfQ.wmJl_ZaOy6XnOXcxUYY1Ad2ZkJLXEU4YX6fW7s34Sv8';
  const MP_TOKEN = 'APP_USR-4243972737547638-040423-a2ff61e68570ca76f0ed6d6a953578db-772975227';

  try {
    const body = req.body || {};
    const query = req.query || {};

    const isPayment =
      body.type === 'payment' ||
      body.action === 'payment.created' ||
      body.action === 'payment.updated' ||
      query.topic === 'payment';

    if (!isPayment) return res.status(200).json({ ok: true });

    const paymentId = body?.data?.id || query?.id;
    if (!paymentId) return res.status(200).json({ ok: true });

    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { 'Authorization': `Bearer ${MP_TOKEN}` }
    });
    const payment = await mpRes.json();

    console.log('PAYMENT:', JSON.stringify({ status: payment.status, external_reference: payment.external_reference, id: payment.id }));

    if (payment.status !== 'approved') return res.status(200).json({ ok: true });

    const orderId = payment.external_reference;
    if (!orderId) return res.status(200).json({ ok: true });

    const orderRes = await fetch(
      `${SUPABASE_URL}/rest/v1/orders?id=eq.${orderId}&select=*,ticket_types(name,price),events(name,date,venue)`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );
    const orders = await orderRes.json();
    if (!orders || orders.length === 0) return res.status(200).json({ ok: true });
    const order = orders[0];

    // Si ya tiene tickets, no hacer nada (process-payment ya lo manejó)
    const ticketRes = await fetch(
      `${SUPABASE_URL}/rest/v1/tickets?order_id=eq.${orderId}&select=id`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );
    const existingTickets = await ticketRes.json();
    if (existingTickets && existingTickets.length > 0) {
      return res.status(200).json({ ok: true });
    }

    if (order.status === 'paid') return res.status(200).json({ ok: true });

    await fetch(`${SUPABASE_URL}/rest/v1/orders?id=eq.${orderId}`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ status: 'paid', mp_payment_id: String(paymentId) })
    });

    await fetch(`${SUPABASE_URL}/rest/v1/rpc/increment_sold`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ ticket_type_id: order.ticket_type_id, amount: order.quantity })
    });

    const tickets = [];
    for (let i = 0; i < order.quantity; i++) {
      tickets.push({
        order_id: orderId,
        event_id: order.event_id,
        ticket_type_id: order.ticket_type_id,
        buyer_name: order.buyer_name,
        buyer_email: order.buyer_email,
        qr_code: require('crypto').randomUUID()
      });
    }

    await fetch(`${SUPABASE_URL}/rest/v1/tickets`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(tickets)
    });

    return res.status(200).json({ ok: true });

  } catch (e) {
    console.error('Webhook error:', e.message);
    return res.status(500).json({ error: e.message });
  }
};
