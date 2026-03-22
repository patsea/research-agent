# Scorer Rubric Prompt

You are scoring "{{NAME}}" for executive targeting assessment.

Score EACH of the following dimensions using the supplied research context.
Return a JSON object with one key per dimension ID.

Dimensions:
{{DIMENSIONS}}

Research context provided:
{{RESEARCH_CONTEXT}}

Signal level definitions:
- High — strong public evidence supporting this dimension
- Medium — some evidence or reasonable inference
- Unknown — insufficient public evidence to assess this dimension. Use when you cannot find relevant information. Do NOT default to Low when evidence is absent. Low is reserved for evidence that actively contradicts the dimension.
- Low — evidence actively contradicts or negates this dimension

Return ONLY valid JSON:
{
{{JSON_SCHEMA}}
}
No preamble, no explanation, no markdown fences.
