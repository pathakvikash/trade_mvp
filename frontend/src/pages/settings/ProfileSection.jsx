import React, { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import Avatar from '../../components/ui/Avatar';
import IconButton, { Icon } from '../../components/ui/IconButton';
import useUserStore from '../../store/userStore';
import { API, authed } from '../../lib/api';
import { fileToAvatarDataUrl } from './avatarImage';
import { Field, SaveBar, SectionCard, inputCls, isDirty, serverMsg, useDraft } from './shared';

const menuItem = 'focus-ring flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50';
const BROWSER_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const TIMEZONES = [...new Set([BROWSER_TZ, ...(typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [])])];
const EMOJIS = ['📈', '📉', '💹', '💰', '🪙', '💎', '🚀', '🌕', '🐂', '🐻', '🦁', '🐺', '🦊', '🐯', '🦅', '🦉', '🐋', '🦈', '🐙', '🐢',
  '🦄', '🐉', '🐸', '🐼', '🐵', '🦍', '🎯', '🎲', '🧠', '⚡', '🔥', '🌟', '🏆', '🛡', '⚔', '🔭', '🧭', '💡', '🎩', '🤖'];

// ISO-3166 alpha-2 codes the runtime knows a name for (Intl has no "list regions" call, so probe every AA..ZZ pair).
const NOT_COUNTRIES = new Set(['EU', 'UN', 'EZ', 'QO', 'XA', 'XB', 'ZZ']);
export const COUNTRIES = (() => {
  try {
    const dn = new Intl.DisplayNames(['en'], { type: 'region' });
    const out = [];
    for (let a = 65; a <= 90; a += 1) {
      for (let b = 65; b <= 90; b += 1) {
        const code = String.fromCharCode(a, b);
        const name = NOT_COUNTRIES.has(code) ? null : dn.of(code);
        if (name && name !== code && name !== 'Unknown Region') out.push({ code, name });
      }
    }
    return out.sort((x, y) => x.name.localeCompare(y.name));
  } catch {
    return [];
  }
})();

const ProfileSection = ({ user, notify }) => {
  const token = useUserStore((s) => s.token);
  const setUser = useUserStore((s) => s.setUser);
  const fileRef = useRef(null);
  const popRef = useRef(null);
  const editRef = useRef(null);
  // Edit-photo popover: null (closed) | 'menu' (Upload / Choose emoji / Remove) | 'emoji' (the grid).
  const [menu, setMenu] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const avatar = user.profile?.avatar || null;

  const saved = {
    name: user.name || '',
    bio: user.profile?.bio || '',
    country: user.profile?.country || '',
    timezone: user.profile?.timezone || BROWSER_TZ,
  };
  const [draft, setDraft, key] = useDraft(saved);
  const dirty = isDirty(draft, key);

  const run = async (fn, okText) => {
    setBusy(true);
    try {
      const r = await fn();
      setUser(r.data.user);
      notify.success(okText);
    } catch (e) {
      notify.error(e.response ? serverMsg(e) : e.message);
    }
    setBusy(false);
  };
  const putAvatar = (value) => run(() => axios.put(`${API}/api/auth/me/avatar`, { avatar: value }, authed(token)), 'Avatar updated.');
  const removeAvatar = () => run(() => axios.delete(`${API}/api/auth/me/avatar`, authed(token)), 'Avatar removed.');

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      await putAvatar(await fileToAvatarDataUrl(file));
    } catch (err) {
      notify.error(err.message);
      setBusy(false);
    }
  };

  const closeMenu = useCallback(() => {
    setMenu(null);
    editRef.current?.querySelector('button')?.focus();
  }, []);

  // Esc and click/tap outside close the popover; focus goes back to the Edit button.
  useEffect(() => {
    if (!menu) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') closeMenu(); };
    const onDown = (e) => {
      if (!popRef.current?.contains(e.target) && !editRef.current?.contains(e.target)) closeMenu();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    // Move focus into the popover so Tab continues from there.
    const pop = popRef.current;
    (pop?.querySelector('[aria-checked="true"]') || pop?.querySelector('button:not(:disabled)'))?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
    };
  }, [menu, closeMenu]);

  // Arrow keys move focus along the emoji radios; Enter/Space picks.
  const onEmojiKey = (e) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const all = [...e.currentTarget.querySelectorAll('[role="radio"]')];
    const i = all.indexOf(document.activeElement);
    all[(i + step + all.length) % all.length]?.focus();
  };

  const save = async () => {
    if (!draft.name.trim()) return notify.error('Name is required.');
    setSaving(true);
    try {
      const r = await axios.patch(`${API}/api/auth/me`, { name: draft.name.trim(), profile: { bio: draft.bio, country: draft.country, timezone: draft.timezone } }, authed(token));
      setUser(r.data.user);
      notify.success('Profile saved.');
    } catch (e) {
      notify.error(serverMsg(e));
    }
    setSaving(false);
  };

  const selected = avatar?.startsWith('emoji:') ? avatar.slice(6) : null;
  const countryKnown = !draft.country || COUNTRIES.some((c) => c.code === draft.country);

  return (
    <div className="space-y-3">
      <SectionCard title="Avatar" description="Shown in the top bar. Photos are cropped to a square, resized to 256 px and stored on your account (max 150 KB after resizing).">
        <div className="flex flex-wrap items-center gap-4">
          <div className="relative flex items-end gap-2">
            <Avatar avatar={avatar} name={draft.name || user.username} size="lg" />
            {/* Not `disabled` while saving: a disabled button drops focus, and focus must come back here after a pick. */}
            <span ref={editRef}>
              <IconButton icon="pencil" label="Edit photo" busy={busy} aria-disabled={busy || undefined} aria-haspopup="dialog" aria-expanded={!!menu}
                onClick={() => { if (menu) closeMenu(); else if (!busy) setMenu('menu'); }} />
            </span>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" aria-label="Upload a photo" onChange={onFile} />
            {menu && (
              // Bottom sheet on phones (never overflows a 390 px screen), anchored under the avatar from sm up.
              <div ref={popRef} role="dialog" aria-label={menu === 'emoji' ? 'Choose an emoji avatar' : 'Edit photo'}
                className="fixed inset-x-0 bottom-0 z-40 rounded-t-xl border border-slate-700 bg-slate-950 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-2xl sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-0 sm:top-full sm:mt-2 sm:w-72 sm:rounded-xl">
                {menu === 'menu' ? (
                  <div className="space-y-0.5">
                    <button type="button" className={menuItem} onClick={() => { closeMenu(); fileRef.current?.click(); }}><Icon name="upload" className="h-4 w-4" />Upload image</button>
                    <button type="button" className={menuItem} onClick={() => setMenu('emoji')}><Icon name="smile" className="h-4 w-4" />Choose emoji</button>
                    {avatar && <button type="button" className={menuItem.replace('text-slate-200', 'text-rose-300')} onClick={() => { closeMenu(); removeAvatar(); }}><Icon name="trash" className="h-4 w-4" />Remove</button>}
                  </div>
                ) : (
                  <>
                    <p className="mb-1.5 px-0.5 text-xs text-slate-400" id="emoji-avatar-label">Pick an emoji</p>
                    <div role="radiogroup" aria-labelledby="emoji-avatar-label" onKeyDown={onEmojiKey} className="grid max-h-56 grid-cols-8 gap-1 overflow-y-auto p-0.5">
                      {EMOJIS.map((em, i) => {
                        const on = selected === em;
                        return (
                          <button
                            key={em}
                            type="button"
                            role="radio"
                            aria-checked={on}
                            aria-label={`Emoji ${em}`}
                            tabIndex={on || (!selected && i === 0) ? 0 : -1}
                            disabled={busy}
                            onClick={() => { closeMenu(); putAvatar(`emoji:${em}`); }}
                            className={`focus-ring grid h-9 place-items-center rounded-md border text-lg disabled:opacity-50 ${on ? 'border-cyan-500/70 bg-cyan-500/10' : 'border-slate-800 hover:border-slate-600'}`}
                          >
                            {em}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
          <dl className="grid min-w-[14rem] flex-1 grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
            <div><dt className="text-slate-500">Username</dt><dd className="text-slate-200">{user.username || '-'}</dd></div>
            <div><dt className="text-slate-500">Email</dt><dd className="break-all text-slate-200">{user.email || '-'}</dd></div>
            <div><dt className="text-slate-500">Role</dt><dd className="text-slate-200">{user.role || '-'}</dd></div>
            <div><dt className="text-slate-500">Member since</dt><dd className="text-slate-200">{user.createdAt ? new Date(user.createdAt).toLocaleDateString() : '-'}</dd></div>
          </dl>
        </div>
      </SectionCard>

      <SectionCard title="About you">
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (dirty) save(); }}>
          <Field id="set-name" label="Full name" className="sm:col-span-2" hint={!draft.name.trim() ? 'Name is required.' : undefined}>
            <input id="set-name" className={inputCls} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </Field>
          <div className="sm:col-span-2">
            <label htmlFor="set-bio" className="mb-1 block text-xs text-slate-400">Bio</label>
            <textarea id="set-bio" rows={3} maxLength={160} className={inputCls} value={draft.bio} onChange={(e) => setDraft({ ...draft, bio: e.target.value })} />
            <p className="mt-0.5 text-right text-[11px] tabular-nums text-slate-500">{draft.bio.length}/160</p>
          </div>
          <Field id="set-country" label="Country">
            <select id="set-country" className={inputCls} value={draft.country} onChange={(e) => setDraft({ ...draft, country: e.target.value })}>
              <option value="">Not set</option>
              {!countryKnown && <option value={draft.country}>{draft.country}</option>}
              {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </select>
          </Field>
          <Field id="set-tz" label="Timezone">
            <select id="set-tz" className={inputCls} value={draft.timezone} onChange={(e) => setDraft({ ...draft, timezone: e.target.value })}>
              {[...new Set([draft.timezone, ...TIMEZONES])].map((z) => <option key={z} value={z}>{z}</option>)}
            </select>
          </Field>
        </form>
        <SaveBar dirty={dirty} saving={saving} onSave={save} onDiscard={() => setDraft(JSON.parse(key))} />
      </SectionCard>
    </div>
  );
};

export default ProfileSection;
