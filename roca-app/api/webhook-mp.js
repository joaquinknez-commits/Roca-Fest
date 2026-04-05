// api/webhook-mp.js
// Recibe notificaciones de Mercado Pago cuando un pago es aprobado.
// Genera las entradas con QR únicos y envía el mail al comprador.
//
// Variables de entorno requeridas en Vercel:
//   MP_ACCESS_TOKEN   → tu Access Token de Mercado Pago
//   SUPABASE_URL      → tu URL de Supabase
//   SUPABASE_KEY      → service_role key de Supabase
//   RESEND_API_KEY    → tu API key de Resend (resend.com, plan gratis)
//   FROM_EMAIL        → ej: entradas@roca.com.ar (dominio verificado en Resend)

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { type, data } = req.body;

  // MP envía varios tipos de notificación; solo procesamos pagos
  if (type !== 'payment') return res.status(200).json({ ok: true });

  const paymentId = data?.id;
  if (!paymentId) return res.status(400).json({ error: 'No payment id' });

  // Verificar pago con MP
  const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: { 'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}` }
  });
  const payment = await mpRes.json();

  if (payment.status !== 'approved') return res.status(200).json({ ok: true, status: payment.status });

  const orderId = payment.external_reference;
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

  // Verificar que la orden no fue procesada antes (idempotencia)
  const { data: order } = await sb
    .from('orders')
    .select('*, ticket_types(name, price), events(name, date, venue)')
    .eq('id', orderId)
    .single();

  if (!order || order.status === 'paid') return res.status(200).json({ ok: true });

  // Marcar orden como pagada
  await sb.from('orders').update({
    status: 'paid',
    mp_payment_id: String(paymentId)
  }).eq('id', orderId);

  // Actualizar stock
  await sb.from('ticket_types')
    .update({ sold_quantity: order.ticket_types.price }) // se recalcula abajo
    .eq('id', order.ticket_type_id);

  await sb.rpc('increment_sold', {
    ticket_type_id: order.ticket_type_id,
    amount: order.quantity
  });

  // Generar una entrada por cada unidad comprada
  const tickets = [];
  for (let i = 0; i < order.quantity; i++) {
    const qrCode = crypto.randomUUID();
    tickets.push({
      order_id:       orderId,
      event_id:       order.event_id,
      ticket_type_id: order.ticket_type_id,
      buyer_name:     order.buyer_name,
      buyer_email:    order.buyer_email,
      qr_code:        qrCode
    });
  }

  const { data: insertedTickets } = await sb.from('tickets').insert(tickets).select();

  // Enviar mail con QR(s)
  if (insertedTickets && process.env.RESEND_API_KEY) {
    await sendTicketEmail(order, insertedTickets);
  }

  return res.status(200).json({ ok: true });
};

async function sendTicketEmail(order, tickets) {
  const event = order.events;
  const d = new Date(event.date);
  const dateStr = d.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const timeStr = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

  // Generar imagen QR para cada entrada usando la API de qr-server (gratis, sin instalación)
  const ticketHtml = tickets.map((t, i) => `
    <div style="text-align:center;padding:24px 0;border-bottom:1px solid #eeeeec;">
      ${tickets.length > 1 ? `<div style="font-size:12px;letter-spacing:2px;color:#aaa;margin-bottom:12px;">ENTRADA ${i + 1} DE ${tickets.length}</div>` : ''}
      <img
        src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${t.qr_code}&bgcolor=ffffff&color=000000&margin=16"
        width="200"
        height="200"
        alt="QR Entrada"
        style="display:block;margin:0 auto 12px;"
      />
      <div style="font-family:monospace;font-size:11px;color:#aaa;letter-spacing:1px;">${t.qr_code.slice(0, 8).toUpperCase()}</div>
    </div>`).join('');

  const html = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f7f7f5;font-family:'DM Sans',Arial,sans-serif;">
  <div style="max-width:480px;margin:32px auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e0e0de;">

    <!-- Header -->
    <div style="background:#0f0f0f;padding:32px;text-align:center;">
      <div style="font-size:11px;letter-spacing:4px;color:#777;margin-bottom:8px;">BUENOS AIRES</div>
      <div style="font-size:72px;font-weight:900;letter-spacing:8px;color:#ffffff;line-height:1;font-family:Arial Black,sans-serif;">ROCA</div>
    </div>

    <!-- Body -->
    <div style="padding:32px;">
      <div style="font-size:12px;letter-spacing:2px;color:#aaa;margin-bottom:4px;text-transform:uppercase;">Tu entrada para</div>
      <div style="font-size:28px;font-weight:700;letter-spacing:2px;color:#0f0f0f;margin-bottom:16px;">${event.name}</div>

      <table style="width:100%;font-size:13px;color:#555;margin-bottom:24px;">
        <tr>
          <td style="padding:6px 0;color:#aaa;">Fecha</td>
          <td style="padding:6px 0;text-align:right;color:#0f0f0f;">${dateStr}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#aaa;">Hora</td>
          <td style="padding:6px 0;text-align:right;color:#0f0f0f;">${timeStr}hs</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#aaa;">Lugar</td>
          <td style="padding:6px 0;text-align:right;color:#0f0f0f;">${event.venue}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#aaa;">Tipo</td>
          <td style="padding:6px 0;text-align:right;color:#0f0f0f;">${order.ticket_types.name}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#aaa;">A nombre de</td>
          <td style="padding:6px 0;text-align:right;color:#0f0f0f;">${order.buyer_name}</td>
        </tr>
      </table>

      <div style="font-size:11px;letter-spacing:2px;color:#aaa;text-align:center;margin-bottom:16px;text-transform:uppercase;">
        ${tickets.length === 1 ? 'Tu QR de entrada' : 'Tus QRs de entrada'}
      </div>

      ${ticketHtml}

      <div style="margin-top:24px;padding:16px;background:#f7f7f5;border-radius:10px;font-size:12px;color:#aaa;text-align:center;line-height:1.6;">
        Presentá este QR en la puerta.<br>
        Cada QR es de un solo uso y personal.<br>
        No lo compartas en redes.
      </div>
    </div>

    <!-- Footer -->
    <div style="padding:20px 32px;border-top:1px solid #eeeeec;text-align:center;">
      <div style="font-size:11px;color:#aaa;letter-spacing:1px;">ROCA · ENTRADAS OFICIALES</div>
    </div>
  </div>
</body>
</html>`;

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`
    },
    body: JSON.stringify({
      from: process.env.FROM_EMAIL || 'ROCA Entradas <entradas@roca.com.ar>',
      to: order.buyer_email,
      subject: `🎟 Tu entrada para ${event.name} — ROCA`,
      html
    })
  });
}
