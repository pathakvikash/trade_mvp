import React, { useState } from 'react';
import axios from 'axios';
import PairPicker from '../../components/ui/PairPicker';
import SegTabs from '../../components/ui/SegTabs';
import useUserStore from '../../store/userStore';
import { API, authed } from '../../lib/api';
import { Field, SaveBar, SectionCard, Toggle, inputCls, isDirty, serverMsg, useDraft } from './shared';

const TF_TABS = ['1m', '5m', '15m', '1h', '4h', '1d'].map((t) => ({ id: t, label: t }));
const LANDING = [['dashboard', 'Dashboard'], ['trade', 'Trade'], ['market', 'Markets'], ['portfolio', 'Portfolio'], ['derivatives', 'Derivatives'], ['liquidation', 'Liquidations']];
const SPEEDS = [['slow', 'Slow'], ['normal', 'Normal'], ['fast', 'Fast']];
const TIME_FORMATS = [['auto', 'Automatic (browser locale)'], ['12h', '12-hour'], ['24h', '24-hour']];
const ORDER_TYPES = [{ id: 'market', label: 'Market' }, { id: 'limit', label: 'Limit' }];
const LEVERAGES = Array.from({ length: 50 }, (_, i) => i + 1); // the server accepts integers 1..50

// Only the preferences the app actually acts on. The trade defaults are read by components/trade (TradeForm,
// FuturesForm, PositionsTable) and lose to a choice the user persisted on the Trade page.
export const prefsFrom = (p = {}) => ({
  defaultSymbol: p.defaultSymbol || 'BTCUSDT',
  defaultTimeframe: p.defaultTimeframe || '1m',
  landingPage: p.landingPage || 'dashboard',
  compactTables: p.compactTables === true,
  tickerBar: p.tickerBar !== false,
  tickerSpeed: p.tickerSpeed || 'normal',
  fundingCountdown: p.fundingCountdown !== false,
  reduceMotion: p.reduceMotion === true,
  timeFormat: p.timeFormat || 'auto',
  alertToasts: p.alertToasts !== false,
  alertSound: p.alertSound === true,
  confirmClose: p.confirmClose !== false,
  defaultLeverage: Number.isInteger(p.defaultLeverage) ? p.defaultLeverage : 10,
  defaultOrderType: p.defaultOrderType === 'limit' ? 'limit' : 'market',
});

const PreferencesSection = ({ user, notify }) => {
  const token = useUserStore((s) => s.token);
  const setUser = useUserStore((s) => s.setUser);
  const [saving, setSaving] = useState(false);
  const saved = prefsFrom(user.preferences);
  const [draft, setDraft, key] = useDraft(saved);
  const dirty = isDirty(draft, key);
  const set = (k) => (v) => setDraft((d) => ({ ...d, [k]: v })); // functional: two quick edits must not drop one

  const save = async () => {
    const changed = Object.fromEntries(Object.entries(draft).filter(([k, v]) => v !== saved[k])); // send only what changed
    setSaving(true);
    try {
      const r = await axios.patch(`${API}/api/auth/me`, { preferences: changed }, authed(token));
      setUser(r.data.user);
      notify.success('Preferences saved.');
    } catch (e) {
      notify.error(serverMsg(e));
    }
    setSaving(false);
  };

  return (
    <div className="space-y-3">
      <SectionCard title="Trading defaults">
        <div className="space-y-4">
          <div>
            <span className="mb-1 block text-xs text-slate-400">Default pair</span>
            <PairPicker value={draft.defaultSymbol} onChange={set('defaultSymbol')} />
          </div>
          <div>
            <span className="mb-1 block text-xs text-slate-400">Default timeframe</span>
            <SegTabs tabs={TF_TABS} active={draft.defaultTimeframe} onChange={set('defaultTimeframe')} label="Default timeframe" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <span className="mb-1 block text-xs text-slate-400">Default order type</span>
              <SegTabs tabs={ORDER_TYPES} active={draft.defaultOrderType} onChange={set('defaultOrderType')} label="Default order type" />
            </div>
            <Field id="pref-leverage" label="Default futures leverage" hint="Capped at each market's maximum. A leverage you pick on the Trade page is remembered per market and wins.">
              <select id="pref-leverage" className={`${inputCls} max-w-[8rem]`} value={draft.defaultLeverage} onChange={(e) => set('defaultLeverage')(Number(e.target.value))}>
                {LEVERAGES.map((x) => <option key={x} value={x}>{x}x</option>)}
              </select>
            </Field>
          </div>
          <Toggle id="pref-confirm-close" checked={draft.confirmClose} onChange={set('confirmClose')} label="Confirm before closing a position" hint="When on, the close (X) button in the positions table needs a second click." />
        </div>
      </SectionCard>

      <SectionCard title="Layout">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="pref-landing" label="Landing page after sign-in">
            <select id="pref-landing" className={inputCls} value={draft.landingPage} onChange={(e) => set('landingPage')(e.target.value)}>
              {LANDING.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </Field>
          <Field id="pref-time" label="Time format">
            <select id="pref-time" className={inputCls} value={draft.timeFormat} onChange={(e) => set('timeFormat')(e.target.value)}>
              {TIME_FORMATS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </Field>
        </div>
        <div className="mt-2 divide-y divide-slate-800/70">
          <Toggle id="pref-compact" checked={draft.compactTables} onChange={set('compactTables')} label="Compact tables" hint="Tighter row spacing so more rows fit." />
          <Toggle id="pref-ticker" checked={draft.tickerBar} onChange={set('tickerBar')} label="Ticker bar" hint="Scrolling prices under the top bar." />
          <div className="py-1.5">
            <Field id="pref-speed" label="Ticker speed">
              <select id="pref-speed" className={`${inputCls} max-w-[12rem]`} disabled={!draft.tickerBar} value={draft.tickerSpeed} onChange={(e) => set('tickerSpeed')(e.target.value)}>
                {SPEEDS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
            </Field>
          </div>
          <Toggle id="pref-funding" checked={draft.fundingCountdown} onChange={set('fundingCountdown')} disabled={!draft.tickerBar} label="Funding countdown" hint="Time to the next 8-hour funding time on most perps. Paper futures here do not charge or pay funding." />
          <Toggle id="pref-motion" checked={draft.reduceMotion} onChange={set('reduceMotion')} label="Reduce motion" hint="Stops the ticker scrolling and shortens animations. Your system setting is respected too." />
        </div>
      </SectionCard>

      <SectionCard title="Alerts">
        <div className="divide-y divide-slate-800/70">
          <Toggle id="pref-toasts" checked={draft.alertToasts} onChange={set('alertToasts')} label="Show alert toasts" />
          <Toggle id="pref-sound" checked={draft.alertSound} onChange={set('alertSound')} label="Play a sound when an alert triggers" />
        </div>
        <SaveBar dirty={dirty} saving={saving} onSave={save} onDiscard={() => setDraft(JSON.parse(key))} />
      </SectionCard>
    </div>
  );
};

export default PreferencesSection;
