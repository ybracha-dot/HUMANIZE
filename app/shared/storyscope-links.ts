// Which taxonomy features each editorial check is inspired by. Kept separate so the build script and runtime agree.
export const CHECK_TAXONOMY_LINKS: Record<string, string[]> = {
  moral_restates_action: ['PLT_MOR_001', 'PLT_THM_005'],
  named_emotion: ['AGENT_EMO_001', 'AGENT_EMO_004'],
  stock_figure: ['STY_FIG_003'],
  narrator_verdict: ['STY_TON_002'],
};
