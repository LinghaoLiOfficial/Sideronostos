/** Framework-independent presentation contracts; no farm or model-provider imports. */
export type BotMode = "collapsed" | "chat";
export type BotIdentity = {
  id: string;
  name: string;
  description: string;
  color?: string;
};
export type BotAnswerData = {
  paragraphs: { text: string; evidence_ids: string[] }[];
};
export type BotFact = { id: string; label: string; display: string };
