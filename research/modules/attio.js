import axios from 'axios';
import 'dotenv/config';

const BASE = 'https://api.attio.com/v2';
const headers = () => ({
  'Authorization': `Bearer ${process.env.ATTIO_API_KEY}`,
  'Content-Type': 'application/json'
});

export async function lookupByEmail(email) {
  try {
    const r = await axios.post(`${BASE}/objects/people/records/query`, {
      filter: {
        email_addresses: { contains: email }
      }
    }, { headers: headers() });

    const record = r.data?.data?.[0];
    if (!record) return null;

    const vals = record.values || {};
    const name = vals.name?.[0]?.full_name || '';
    const company = vals.company?.[0]?.target_record?.values?.name?.[0]?.value || '';
    return { id: record.id?.record_id, name, company };
  } catch (err) {
    console.error('Attio lookup error:', err.message);
    return null;
  }
}

export async function appendNote(recordId, title, noteText) {
  try {
    await axios.post(`${BASE}/notes`, {
      parent_object: 'people',
      parent_record_id: recordId,
      title,
      format: 'plaintext',
      content_plaintext: noteText
    }, { headers: headers() });
    return true;
  } catch (err) {
    console.error('Attio note error:', err.message);
    return false;
  }
}
