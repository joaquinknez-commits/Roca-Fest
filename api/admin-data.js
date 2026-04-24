module.exports = async function handler(req, res) {
  const SUPABASE_URL = 'https://vdomxszqpikqsvcrfupb.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZkb214c3pxcGlrcXN2Y3JmdXBiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTM1MjE1MiwiZXhwIjoyMDkwOTI4MTUyfQ.wmJl_ZaOy6XnOXcxUYY1Ad2ZkJLXEU4YX6fW7s34Sv8';

  const headers = { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };

  try {
    if (req.method === 'GET') {
      const { action } = req.query;

      if (action === 'transfers') {
        const r = await fetch(
          `${SUPABASE_URL}/rest/v1/transfer_requests?select=*,ticket_types(name,price),events(name)&order=created_at.desc`,
          { headers }
        );
        return res.status(200).json(await r.json());
      }

      if (action === 'promoters') {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/promoters?select=*&order=name.asc`, { headers });
        return res.status(200).json(await r.json());
      }

      if (action === 'stats') {
        const r = await fetch(
          `${SUPABASE_URL}/rest/v1/orders?select=*,ticket_types(name),promoters(name)&status=eq.paid`,
          { headers }
        );
        return res.status(200).json(await r.json());
      }

      if (action === 'comprobante_url') {
        const { path } = req.query;
        const r = await fetch(
          `${SUPABASE_URL}/storage/v1/object/sign/${path}`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({ expiresIn: 3600 })
          }
        );
        const data = await r.json();
        return res.status(200).json({ url: `${SUPABASE_URL}/storage/v1${data.signedURL}` });
      }
    }

    if (req.method === 'POST') {
      const { action } = req.body;

      if (action === 'create_promoter') {
        const { name, slug, email } = req.body;
        const r = await fetch(`${SUPABASE_URL}/rest/v1/promoters`, {
          method: 'POST',
          headers: { ...headers, 'Prefer': 'return=representation' },
          body: JSON.stringify({ name, slug, email: email || '' })
        });
        return res.status(200).json(await r.json());
      }

      if (action === 'create_manual_ticket') {
        const { buyer_name, buyer_email, ticket_type_id, quantity } = req.body;
        const RESEND_KEY = 're_iMvSuNAo_JdzsxN1txJUpiqmpv7C5vP45';

        // Buscar evento activo
        const evRes = await fetch(
          `${SUPABASE_URL}/rest/v1/events?is_active=eq.true&select=*&limit=1`,
          { headers }
        );
        const events = await evRes.json();
        const event = events[0];

        // Buscar tipo de entrada
        const ttRes = await fetch(
          `${SUPABASE_URL}/rest/v1/ticket_types?id=eq.${ticket_type_id}&select=*`,
          { headers }
        );
        const ticketTypes = await ttRes.json();
        const ticketType = ticketTypes[0];

        // Crear orden
        const orderRes = await fetch(`${SUPABASE_URL}/rest/v1/orders`, {
          method: 'POST',
          headers: { ...headers, 'Prefer': 'return=representation' },
          body: JSON.stringify({
            event_id: event.id,
            ticket_type_id,
            buyer_name,
            buyer_email,
            quantity: parseInt(quantity),
            total_amount: ticketType.price * parseInt(quantity),
            status: 'paid',
            mp_payment_id: 'manual'
          })
        });
        const orders = await orderRes.json();
        const order = orders[0];

        // Generar tickets
        const tickets = [];
        for (let i = 0; i < parseInt(quantity); i++) {
          tickets.push({
            order_id: order.id,
            event_id: event.id,
            ticket_type_id,
            buyer_name,
            buyer_email,
            qr_code: require('crypto').randomUUID()
          });
        }

        const ticketRes = await fetch(`${SUPABASE_URL}/rest/v1/tickets`, {
          method: 'POST',
          headers: { ...headers, 'Prefer': 'return=representation' },
          body: JSON.stringify(tickets)
        });
        const insertedTickets = await ticketRes.json();

        // Mandar mail
        await sendManualEmail(event, ticketType, buyer_name, buyer_email, insertedTickets, RESEND_KEY);

        return res.status(200).json({ ok: true });
      }

      if (action === 'update_bank') {
        const { cbu, alias, titular } = req.body;
        // Guardar en una tabla de configuración simple
        const r = await fetch(`${SUPABASE_URL}/rest/v1/app_config?key=eq.bank_info`, {
          method: 'PATCH',
          headers: { ...headers, 'Prefer': 'return=representation' },
          body: JSON.stringify({ value: JSON.stringify({ cbu, alias, titular }) })
        });
        const data = await r.json();
        if (!data || data.length === 0) {
          await fetch(`${SUPABASE_URL}/rest/v1/app_config`, {
            method: 'POST',
            headers: { ...headers, 'Prefer': 'return=representation' },
            body: JSON.stringify({ key: 'bank_info', value: JSON.stringify({ cbu, alias, titular }) })
          });
        }
        return res.status(200).json({ ok: true });
      }

      if (action === 'get_bank') {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/app_config?key=eq.bank_info&select=value`, { headers });
        const data = await r.json();
        if (data && data.length > 0) {
          return res.status(200).json(JSON.parse(data[0].value));
        }
        return res.status(200).json({ cbu: '0720146888000037148636', alias: 'roccaeventos', titular: 'ROCA Eventos' });
      }
    }

    return res.status(404).json({ error: 'Not found' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};

async function sendManualEmail(event, ticketType, buyerName, buyerEmail, tickets, RESEND_KEY) {
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
        <tr><td style="padding:6px 0;color:#aaa;">Tipo</td><td style="text-align:right;color:#0f0f0f;">${ticketType.name}</td></tr>
        <tr><td style="padding:6px 0;color:#aaa;">A nombre de</td><td style="text-align:right;color:#0f0f0f;">${buyerName}</td></tr>
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
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
    body: JSON.stringify({
      from: 'ROCA Entradas <entradas@roccaeventos.com.ar>',
      to: buyerEmail,
      subject: `Tu entrada para ${event.name} — ROCA`,
      html
    })
  });
}
