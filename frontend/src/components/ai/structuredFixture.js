// Dev/test mock of the backend's `reply.structured`. Real replies may omit any field.
export const longFixture = {
  verdict: 'long', confidence: 'medium', headline: 'Bounce setup above 0.0412', summary: 'Price holds support; a quick scalp toward resistance is possible.',
  price: 0.042,
  plan: { side: 'long', entry: 0.042, stop: 0.041, target: 0.044, sizeUsd: 20, leverage: 3, riskUsd: 0.5, rewardUsd: 1, rr: 2, horizon: '15m-1h' },
  levels: [{ label: 'Support', price: 0.0412, kind: 'support' }, { label: 'Resistance', price: 0.0445, kind: 'resistance' }, { label: 'Liq cluster', price: 0.04, kind: 'liquidation' }],
  bull: ['Holding support'], bear: ['Low volume'], risks: ['Wide spread'], needsData: ['order book'],
};
export const shortFixture = { ...longFixture, verdict: 'short', plan: { ...longFixture.plan, side: 'short', stop: 0.043, target: 0.04 } };
