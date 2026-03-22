# Email Sender Classification Prompt

Classify this email sender into exactly one category.

You are running in Claude Sonnet 4.6 unless explicitly stated otherwise.

## Goal

Determine what kind of sender this is, using only the evidence available in:
- sender email address
- display name
- subject
- recent subject lines
- any explicit cues in the email body if provided

Be conservative.
Do not guess beyond the evidence.

## Allowed categories

- "recruiter"
  Use for recruiters, talent partners, executive search, recruiting agencies, in-house talent teams, or hiring managers writing explicitly in a recruiting capacity.

- "operator"
  Use for company operators such as executives, product leaders, functional leaders, chiefs of staff, or managers contacting in an operating role.

- "founder"
  Use for founders, co-founders, or entrepreneurs clearly contacting as such.

- "investor"
  Use for VC, PE, angel, family office, portfolio team, operating partner, or investor-platform senders.

- "network"
  Use for peers, former colleagues, warm intros, personal contacts, advisors, or generally known professional contacts who are not clearly acting as recruiter, operator, founder, or investor.

- "generic_inbox"
  Use for shared inboxes, team aliases, no-reply addresses, support/admin addresses, or obviously non-personal mailboxes.

- "automated"
  Use for system-generated senders, auto-mailers, scheduling tools, ATS tools, newsletters, or machine-sent email.

- "unknown"
  Use when there is not enough evidence to classify reliably.

## Classification rules

1. Return exactly one category.
2. Prioritise explicit evidence over inference.
3. Use the sender’s role, not the email’s emotional tone.
4. If a person appears to be recruiting or discussing a role in an official hiring capacity, use "recruiter" even if they hold an operating title.
5. If the sender is clearly from an investor or fund context, use "investor".
6. If the sender is clearly a founder contacting directly, use "founder".
7. If the mailbox is shared, alias-based, or non-personal, prefer "generic_inbox" or "automated" as appropriate.
8. If evidence is weak or mixed, use "unknown".
9. Ignore signatures and quoted chains unless they add strong evidence.
10. Do not classify reply intent. This is about sender identity only.

## Output format

Return strict JSON only in this exact shape:

{
  "type": "one of: recruiter, operator, founder, investor, network, generic_inbox, automated, unknown",
  "summary": "1-2 sentence factual explanation for the classification"
}

## Summary rules

- Keep it factual and brief.
- State the evidence used.
- Do not add recommendations.
- Do not invent background.

## Input

Sender: {{EMAIL_ADDRESS}}
Display name: {{DISPLAY_NAME}}
Subject: {{SUBJECT}}
Recent subjects: {{RECENT_SUBJECTS}}
Body:
{{BODY}}

Classify now.