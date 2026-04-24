module.exports = async function handler(req, res) {
  if (req.method === 'GET') return res.status(200).end();

  const SUPABASE_URL = 'https://vdomxszqpikqsvcrfupb.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZkb214c3pxcGlrcXN2Y3JmdXBiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTM1MjE1MiwiZXhwIjoyMDkwOTI4MTUyfQ.wmJl_ZaOy6XnOXcxUYY1Ad2ZkJLXEU4YX6fW7s34Sv8';
  const MP_TOKEN = 'APP_USR-4243972737547638-040423-a2ff61e68570ca76f0ed6d6a953578db-772975227';
  const RESEND_KEY = 're_iMvSuNAo_JdzsxN1txJUpiqmpv7C5vP45';

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

    // Verificar si ya tiene tickets — si sí, solo mandar el mail si no fue enviado
    const ticketRes = await fetch(
      `${SUPABASE_URL}/rest/v1/tickets?order_id=eq.${orderId}&select=*`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );
    const existingTickets = await ticketRes.json();

    if (existingTickets && existingTickets.length > 0) {
  // Tickets ya creados por process-payment, no mandar mail de nuevo
  return res.status(200).json({ ok: true });
}

    // Si no hay tickets, crear todo desde cero
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

    const newTicketRes = await fetch(`${SUPABASE_URL}/rest/v1/tickets`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(tickets)
    });
    const insertedTickets = await newTicketRes.json();

    if (insertedTickets && insertedTickets.length > 0) {
      await sendEmail(order, insertedTickets, RESEND_KEY);
    }

    return res.status(200).json({ ok: true });

  } catch (e) {
    console.error('Webhook error:', e.message);
    return res.status(500).json({ error: e.message });
  }
};

async function sendEmail(order, tickets, RESEND_KEY) {
  const event = order.events;
  const d = new Date(event.date);
  const dateStr = d.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const timeStr = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

  const ticketHtml = tickets.map((t, i) => `
    <div style="text-align:center;padding:24px 0;border-bottom:1px solid #eeeeec;">
      ${tickets.length > 1 ? `<div style="font-size:12px;letter-spacing:2px;color:#aaa;margin-bottom:12px;">ENTRADA ${i + 1} DE ${tickets.length}</div>` : ''}
      <img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${t.qr_code}&bgcolor=ffffff&color=000000&margin=16"
        width="200" height="200" alt="QR" style="display:block;margin:0 auto 12px;">
      <div style="font-family:monospace;font-size:11px;color:#aaa;letter-spacing:1px;">${t.qr_code.slice(0,8).toUpperCase()}</div>
    </div>`).join('');

  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f7f7f5;font-family:Arial,sans-serif;">
  <div style="max-width:480px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e0e0de;">
    <div style="background:#0f0f0f;padding:32px;text-align:center;">
      <div style="font-size:11px;letter-spacing:4px;color:#777;margin-bottom:8px;">BUENOS AIRES</div>
      <div style="font-size:72px;font-weight:900;letter-spacing:8px;color:#fff;line-height:1;">ROCA</div>
    </div>
    <div style="padding:32px;">
      <div style="font-size:12px;letter-spacing:2px;color:#aaa;margin-bottom:4px;">TU ENTRADA PARA</div>
      <div style="font-size:28px;font-weight:700;color:#0f0f0f;margin-bottom:16px;">${event.name}</div>
      <table style="width:100%;font-size:13px;margin-bottom:24px;">
        <tr><td style="padding:6px 0;color:#aaa;">Fecha</td><td style="text-align:right;color:#0f0f0f;">${dateStr}</td></tr>
        <tr><td style="padding:6px 0;color:#aaa;">Hora</td><td style="text-align:right;color:#0f0f0f;">${timeStr}hs</td></tr>
        <tr><td style="padding:6px 0;color:#aaa;">Lugar</td><td style="text-align:right;color:#0f0f0f;">${event.venue}</td></tr>
        <tr><td style="padding:6px 0;color:#aaa;">Tipo</td><td style="text-align:right;color:#0f0f0f;">${order.ticket_types.name}</td></tr>
        <tr><td style="padding:6px 0;color:#aaa;">A nombre de</td><td style="text-align:right;color:#0f0f0f;">${order.buyer_name}</td></tr>
      </table>
      <div style="font-size:11px;letter-spacing:2px;color:#aaa;text-align:center;margin-bottom:16px;">TU QR DE ENTRADA</div>
      ${ticketHtml}
      <div style="margin-top:24px;padding:16px;background:#f7f7f5;border-radius:10px;font-size:12px;color:#aaa;text-align:center;line-height:1.6;">
        Presentá este QR en la puerta.<br>Cada QR es de un solo uso y personal.
      </div>
    </div>
    <div style="padding:20px 32px;border-top:1px solid #eee;text-align:center;">
      <div style="font-size:11px;color:#aaa;letter-spacing:1px;">ROCA · ENTRADAS OFICIALES</div>
    </div>
  </div>
</body></html>`;

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${RESEND_KEY}`
    },
    body: JSON.stringify({
      from: 'ROCA Entradas <entradas@roccaeventos.com.ar>',
      to: order.buyer_email,
      subject: `Tu entrada para ${event.name} — ROCA`,
      html
    })
  });
}
