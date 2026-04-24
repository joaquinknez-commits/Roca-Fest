module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const RESEND_KEY = 're_iMvSuNAo_JdzsxN1txJUpiqmpv7C5vP45';
  const { buyer_name, buyer_email, ticket_name, quantity, total } = req.body;

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${RESEND_KEY}`
    },
    body: JSON.stringify({
      from: 'ROCA Entradas <entradas@roccaeventos.com.ar>',
      to: 'roca.entradas@gmail.com',
      subject: `Nueva solicitud de transferencia — ${buyer_name}`,
      html: `
        <div style="font-family:Arial,sans-serif;padding:24px;max-width:480px;">
          <h2 style="margin-bottom:16px;">Nueva solicitud de transferencia</h2>
          <table style="width:100%;font-size:14px;">
            <tr><td style="padding:6px 0;color:#aaa;">Nombre</td><td style="text-align:right;">${buyer_name}</td></tr>
            <tr><td style="padding:6px 0;color:#aaa;">Email</td><td style="text-align:right;">${buyer_email}</td></tr>
            <tr><td style="padding:6px 0;color:#aaa;">Entrada</td><td style="text-align:right;">${ticket_name} × ${quantity}</td></tr>
            <tr><td style="padding:6px 0;color:#aaa;">Total</td><td style="text-align:right;">$${total.toLocaleString('es-AR')}</td></tr>
          </table>
          <div style="margin-top:20px;padding:14px;background:#f7f7f5;border-radius:8px;font-size:13px;color:#555;">
            Revisá el comprobante en el panel admin para aprobar o rechazar.
          </div>
        </div>`
    })
  });

  return res.status(200).json({ ok: true });
};api/notify-admin.js
