# Confirmed field creation through farmer chat

Branch: `feat/agent-bot-catalog-integration`. Test date: 2026-11-15.

The `field-guide` mock workflow accepts one conversation across three farmer turns:

1. “Please add a field for me.” The bot asks for the missing field details.
2. “Call it North field. It is 4 hectares at latitude 42 and longitude -93.5. Soil is loam, irrigation is available, no planting history. Use the temperate demo crop settings.” The bot summarizes the exact values and waits for confirmation. The database still contains no new field.
3. “Yes, create the field.” The bot calls the existing `field.create` service, returns its saved field URL, and shows a screenshot captured from that actual result page. The operation is idempotent. “No, don't create it” cancels with no write.

The conversation and pending confirmation are stored in PostgreSQL, so a browser reload preserves the state. The screenshot endpoint checks conversation and field ownership, validates the service-generated local result path, and returns a private PNG. A screenshot failure leaves the saved field and result link intact.

## Evidence

- [Desktop conversation](evidence/agent-three-turn-chat-desktop.png)
- [Desktop result page](evidence/agent-three-turn-result-desktop.png)
- [Mobile conversation](evidence/agent-three-turn-chat-mobile.png)
- [Mobile result page](evidence/agent-three-turn-result-mobile.png)

The desktop and mobile Playwright journeys each passed against the dedicated local frontend, backend, and pgvector database. The synthetic account and mock knowledge were used; production identity, external NASA data, and a live model were not validated in this phase. The previous general dialogue evaluation remains separate from this completed operation.
