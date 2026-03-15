/**
 * Replace all {{PLACEHOLDER}} tokens in a raw system prompt with values from user profile.
 * Returns the prompt with all placeholders resolved.
 */
export function buildSystemPrompt(rawPrompt, profile) {
  const proofPoints = (profile.proofPoints || [])
    .map((p, i) => `${i + 1}. ${p.company} (${p.role}): ${p.highlight}${p.note ? ' — ' + p.note : ''}`)
    .join('\n');

  const replacements = {
    '{{CANDIDATE_NAME}}': profile.name || '',
    '{{CANDIDATE_TITLE}}': profile.title || '',
    '{{CANDIDATE_POSITIONING}}': profile.positioning || '',
    '{{CANDIDATE_LOCATION}}': profile.location || '',
    '{{CANDIDATE_AI_EXPERIENCE}}': profile.ai_experience || '',
    '{{CANDIDATE_EDUCATION}}': profile.degree ? `${profile.degree}, ${profile.school || ''}`.trim() : '',
    '{{CANDIDATE_PROOF_POINTS}}': proofPoints,
    '{{CANDIDATE_TARGET_ROLES}}': (profile.targetRoles || []).join(', '),
    '{{CANDIDATE_TARGET_SECTORS}}': (profile.targetSectors || []).join(', '),
    '{{CANDIDATE_TARGET_GEOGRAPHIES}}': (profile.targetGeographies || []).join(', '),
    '{{CANDIDATE_PROOF_POINT_ORDER_RULE}}': profile.proof_point_order_rule || '',
    '{{CANDIDATE_BACKGROUND}}': profile.positioning || '',
    '{{CANDIDATE_BRIEF}}': [profile.name, profile.title, profile.positioning].filter(Boolean).join(' — '),
    '{{PROOF_POINT_ORDER_RULE}}': profile.proof_point_order_rule || '',
    // Company Assessment placeholders
    '{{TODAY}}': new Date().toISOString().split('T')[0],
    '{{COMPANY_NAME}}': profile.currentCompany || '',
    '{{COMPANY_GEOGRAPHY}}': (profile.targetGeographies || []).join(', '),
    '{{COMPANY_SECTOR}}': (profile.targetSectors || []).join(', '),
    '{{PRIOR_RESEARCH}}': '',
    '{{NAMED_PEOPLE}}': '',
  };

  let result = rawPrompt;
  for (const [placeholder, value] of Object.entries(replacements)) {
    result = result.replaceAll(placeholder, value);
  }
  return result;
}
