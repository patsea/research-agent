import { randomUUID } from 'crypto';
import { contacts } from '../db.js';

export function assembleContactCard({ identified, enriched, campaignType, context }) {
  const card = {
    id: randomUUID(),
    name: enriched.fullName || identified.name || null,
    title: enriched.jobTitle || identified.title || null,
    company: enriched.companyName || identified.company || null,
    email: enriched.email || null,
    emailStatus: enriched.emailStatus || 'Not found',
    linkedinUrl: enriched.linkedinUrl || identified.linkedinUrl || null,
    confidence: identified.confidence || 'Low',
    inputTypeUsed: identified.linkedinUrl ? 'LinkedIn URL' : 'Name + Company',
    source: identified.source || 'unknown',
    campaignType,
    targetTitleLogicApplied: identified.targetTitlesSearched || 'N/A',
    context: context || '',
    status: 'pending',
    createdAt: new Date().toISOString(),
    closelyExportReady: !!(enriched.emailStatus !== 'Verified' && (enriched.linkedinUrl || identified.linkedinUrl))
  };

  contacts.insert(card);
  return card;
}
