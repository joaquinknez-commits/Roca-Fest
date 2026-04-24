const { Readable } = require('stream');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const SUPABASE_URL = 'https://vdomxszqpikqsvcrfupb.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZkb214c3pxcGlrcXN2Y3JmdXBiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTM1MjE1MiwiZXhwIjoyMDkwOTI4MTUyfQ.wmJl_ZaOy6XnOXcxUYY1Ad2ZkJLXEU4YX6fW7s34Sv8';

  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);

    const contentType = req.headers['content-type'] || 'image/jpeg';
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;

    const uploadRes = await fetch(
      `${SUPABASE_URL}/storage/v1/object/comprobantes/${fileName}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': contentType,
          'x-upsert': 'true'
        },
        body: buffer
      }
    );

    if (!uploadRes.ok) {
      const err = await uploadRes.text();
      return res.status(500).json({ error: 'Upload failed', detail: err });
    }

    const publicUrl = `${SUPABASE_URL}/storage/v1/object/sign/comprobantes/${fileName}`;

    return res.status(200).json({ url: `comprobantes/${fileName}`, fileName });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
