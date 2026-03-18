# Scorer Rubric Prompt

You are scoring "{{NAME}}" for outreach relevance.

Score EACH of the following dimensions. Use web search to find current evidence.
Return a JSON object with one key per dimension ID.

Dimensions:
{{DIMENSIONS}}

Research context provided:
{{RESEARCH_CONTEXT}}

Return ONLY valid JSON:
{
{{JSON_SCHEMA}}
}
No preamble, no explanation, no markdown fences.
