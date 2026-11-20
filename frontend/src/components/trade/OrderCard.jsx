import React from 'react';
import usePersistedState, { oneOf } from '../../lib/usePersistedState';
import Panel from '../ui/Panel';
import SegTabs from '../ui/SegTabs';
import TradeForm from './TradeForm';
import FuturesForm, { PaperBadge } from './FuturesForm';

const MODES = [{ id: 'spot', label: 'Spot' }, { id: 'futures', label: 'Futures' }];
const LEGACY_KEY = 'order-mode'; // pre-persisted-state key; still honoured until the user picks a mode
const legacy = () => {
  try { return localStorage.getItem(LEGACY_KEY) === 'futures' ? 'futures' : 'spot'; } catch { return 'spot'; }
};

// One Order panel with a Spot | Futures switch (choice remembered). Spot = TradeForm (props passed through);
// Futures = FuturesForm. The parent keys this by symbol so switching symbols resets both forms.
const OrderCard = ({ spot, futures, className = '' }) => {
  const [mode, pick] = usePersistedState('trade.mode', legacy(), { validate: oneOf('spot', 'futures') });
  const header = <SegTabs tabs={MODES} active={mode} onChange={pick} label="Market type" className="mb-3 -ml-2" />;
  if (mode === 'spot') return <TradeForm {...spot} className={className} header={header} />;
  return (
    <Panel title="Order" className={`h-fit ${className}`} right={<PaperBadge />}>
      {header}
      <FuturesForm {...futures} />
    </Panel>
  );
};

export default OrderCard;
