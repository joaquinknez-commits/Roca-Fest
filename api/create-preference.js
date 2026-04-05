module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { orderId } = req.body;
    if (!orderId) return res.status(400).json({ error: 'Missing orderId' });

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_KEY;
    const BASE_URL = process.env.BASE_URL;
    const MP_TOKEN = process.env.MP_ACCESS_TOKEN;

    // Buscar orden en Supabase via REST
    const orderRes = await fetch(
      `${SUPABASE_URL}/rest/v1/orders?id=eq.${orderId}&select=*,events(name,date),ticket_types(name,price)`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );
    const orders = await orderRes.json();
    if (!orders || orders.length === 0) return res.status(404).json({ error: 'Order not found' });
    const order = orders[0];

    // Crear preferencia en MP
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

    // Actualizar orden con id de MP
    await fetch(
      `${SUPABASE_URL}/rest/v1/orders?id=eq.${orderId}`,
      {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ mp_payment_id: String(mpData.id) })
      }
    );

    return res.status(200).json({ init_point: mpData.init_point });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
