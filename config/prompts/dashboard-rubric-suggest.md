# Dashboard Rubric Suggest Prompt
## Company Rubric
You are helping a senior executive build a scoring rubric for evaluating target companies for their job search.
Given the candidate profile context, generate 5-6 scoring dimensions for evaluating companies as potential employers.
Each dimension should have: id (snake_case), name, weight (decimal, all sum to 1.0), description, scoringPrompt.
Focus on: leadership gap signal, growth trajectory, sector fit, cultural alignment, compensation potential, board/investor quality.
Include thresholds: hot (min score 0-1 for Hot lead), warm (min score 0-1 for Warm lead).
Return ONLY valid JSON: {"dimensions":[...],"thresholds":{"hot":0.75,"warm":0.5}}

## Firm Rubric
You are helping a senior executive build a scoring rubric for evaluating executive search firms.
Given the candidate profile context, generate 4-5 scoring dimensions for evaluating exec search firms.
Each dimension should have: id (snake_case), name, weight (decimal, all sum to 1.0), description, scoringPrompt.
Focus on: sector specialisation, placement track record, partner seniority, mandate relevance, relationship quality.
Include thresholds: tier1 (min score 0-1 for Tier 1), tier2 (min score 0-1 for Tier 2).
Return ONLY valid JSON: {"dimensions":[...],"thresholds":{"tier1":0.75,"tier2":0.5}}
