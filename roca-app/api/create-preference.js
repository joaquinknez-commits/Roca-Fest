// api/create-preference.js
// Vercel serverless function — crea la preferencia de pago en Mercado Pago
// y devuelve el link de checkout al frontend.
//
// Variables de entorno requeridas en Vercel:
//   MP_ACCESS_TOKEN   → tu Access Token de Mercado Pago (modo producción o sandbox)
//   SUPABASE_URL      → https://vdomxszqpikqsvcrfupb.supabase.co
//   SUPABASE_KEY      → tu service_role key de Supabase (Settings → API → service_role)
//   BASE_URL          → URL pública de tu sitio, ej: https://roca-app.vercel.app

const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { orderId } = req.body;
  if (!orderId) return res.status(400).json({ error: 'Missing orderId' });

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

  // Cargar la orden con datos del evento y tipo de entrada
  const { data: order, error } = await sb
    .from('orders')
    .select('*, events(name, date), ticket_types(name, price)')
    .eq('id', orderId)
    .single();

  if (error || !order) return res.status(404).json({ error: 'Order not found' });

  const BASE_URL = process.env.BASE_URL || 'https://roca-app.vercel.app';

  // Crear preferencia en Mercado Pago
  const mpRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}`
    },
    body: JSON.stringify({
      items: [{
        title: `${order.ticket_types.name} — ${order.events.name}`,
        quantity: order.quantity,
        unit_price: Number(order.ticket_types.price),
        currency_id: 'ARS'
      }],
      payer: {
        name: order.buyer_name,
        email: order.buyer_email
      },
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

  if (!mpData.init_point) {
    console.error('MP error:', mpData);
    return res.status(500).json({ error: 'Error creating MP preference' });
  }

  // Guardar el preference_id en la orden
  await sb.from('orders').update({ mp_payment_id: mpData.id }).eq('id', orderId);

  return res.status(200).json({ init_point: mpData.init_point });
};
