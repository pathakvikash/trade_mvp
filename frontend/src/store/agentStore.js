import { create } from 'zustand';

const scopeOf = (c) => `${c?.kind}:${c?.symbol}`;
const fresh = { conversationId: null, messages: [], loading: false, error: null };

// One in-flight chat request at a time. Anything that changes the conversation (close, new scope, reset, open a
// past one, sign-out) aborts it, so a late reply can never be appended to a different conversation.
let ctl = null;
const abortChat = () => { if (ctl) ctl.abort(); ctl = null; };

// AI analyst dock state. ctx = {kind:'perp'|'instrument', symbol, page, interval?}. A new scope starts a new conversation.
const useAgentStore = create((set, get) => ({
  open: false,
  ctx: null,
  ...fresh,
  openWith: (ctx) => {
    if (scopeOf(ctx) === scopeOf(get().ctx)) return set({ open: true, ctx });
    abortChat();
    return set({ open: true, ctx, ...fresh });
  },
  close: () => { abortChat(); set({ open: false, loading: false }); },
  reset: () => { abortChat(); set({ ...fresh }); },
  signOut: () => { abortChat(); set({ open: false, ctx: null, ...fresh }); },
  // a past conversation: its scope ('kind:symbol') becomes the context, page unchanged
  openConv: ({ conversationId, messages, scope }) => {
    abortChat();
    const [kind, ...rest] = String(scope || '').split(':');
    const symbol = rest.join(':');
    const cur = get().ctx;
    const ctx = kind && symbol && scopeOf(cur) !== scope ? { kind, symbol, page: cur?.page } : cur;
    set({ conversationId, messages, ctx, loading: false, error: null });
  },
  // starts a chat request; returns its AbortController (the caller drops the reply if signal.aborted)
  beginChat: () => { abortChat(); ctl = new AbortController(); return ctl; },
  patch: (p) => set(p),
}));

export default useAgentStore;
