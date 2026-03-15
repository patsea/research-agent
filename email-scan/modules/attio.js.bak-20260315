import axios from 'axios';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import 'dotenv/config';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load configurable field slugs from config/attio-fields.json
let attioFields;
try {
  const fieldsPath = join(__dirname, '..', '..', 'config', 'attio-fields.json');
  attioFields = JSON.parse(readFileSync(fieldsPath, 'utf-8'));
} catch {
  attioFields = { status_field: 'status_8', next_action_field: 'next_action', protected_statuses: ['Interested', 'Call scheduled', 'Call had', 'Mandate flagged', 'In process'] };
}

const STATUS_FIELD = attioFields.status_field;
const NEXT_ACTION_FIELD = attioFields.next_action_field;
const MEMBER_ID = process.env.ATTIO_MEMBER_ID;

const API = 'https://api.attio.com/v2';
const PROTECTED = new Set(attioFields.protected_statuses);

function headers() {
  return { Authorization: `Bearer ${process.env.ATTIO_API_KEY}`, 'Content-Type': 'application/json' };
}

export async function lookupByEmail(email) {
  try {
    const r = await axios.post(`${API}/objects/people/records/query`, {
      filter: { email_addresses: { $contains: email } }
    }, { headers: headers(), timeout: 10000 });
    const rec = r.data?.data?.[0];
    if (!rec) return null;
    const vals = rec.values || {};
    const name = [
      vals.first_name?.[0]?.first_name || '',
      vals.last_name?.[0]?.last_name || ''
    ].filter(Boolean).join(' ');
    const statusArr = vals[STATUS_FIELD] || [];
    const currentStatus = statusArr[0]?.option?.title || '';
    return { id: rec.id?.record_id, currentStatus, name };
  } catch (e) {
    console.error('[attio] lookup error:', e.message);
    return null;
  }
}

export async function updateStatus(recordId, newStatus) {
  if (PROTECTED.has(newStatus)) return; // never overwrite with a protected status via this function
  try {
    await axios.patch(`${API}/objects/people/records/${recordId}`, {
      data: { values: { [STATUS_FIELD]: newStatus } }
    }, { headers: headers(), timeout: 10000 });
  } catch (e) { console.error('[attio] updateStatus error:', e.message); }
}

export async function setNextAction(recordId, isoDateString) {
  try {
    await axios.patch(`${API}/objects/people/records/${recordId}`, {
      data: { values: { [NEXT_ACTION_FIELD]: isoDateString } }
    }, { headers: headers(), timeout: 10000 });
  } catch (e) { console.error('[attio] setNextAction error:', e.message); }
}

export async function appendNote(recordId, title, noteText) {
  try {
    await axios.post(`${API}/notes`, {
      data: {
        parent_object: 'people',
        parent_record_id: recordId,
        title,
        format: 'plaintext',
        content: noteText
      }
    }, { headers: headers(), timeout: 10000 });
  } catch (e) { console.error('[attio] appendNote error:', e.message); }
}

export async function createTask(recordId, content, dueDateISO) {
  try {
    await axios.post(`${API}/tasks`, {
      data: {
        content,
        format: 'plaintext',
        is_completed: false,
        linked_records: [{ target_object: 'people', target_record_id: recordId }],
        deadline_at: dueDateISO,
        assignees: MEMBER_ID ? [{ referenced_actor_type: 'workspace-member', referenced_actor_id: MEMBER_ID }] : []
      }
    }, { headers: headers(), timeout: 10000 });
  } catch (e) { console.error('[attio] createTask error:', e.message); }
}
