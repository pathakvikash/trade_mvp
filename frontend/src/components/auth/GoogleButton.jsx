// "Continue with Google" via Google Identity Services. The backend says whether a client ID is configured.
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import useUserStore from '../../store/userStore';
import { API } from '../../lib/api';
import { landingPath } from '../../lib/landing';
import Spinner from '../ui/Spinner';

const GSI_SRC = 'https://accounts.google.com/gsi/client';

// The Google script is loaded once per page, however many times the button mounts.
let gsiLoading = null;
const loadGsi = () => {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (!gsiLoading) {
    gsiLoading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = GSI_SRC;
      script.async = true;
      script.onload = resolve;
      script.onerror = () => {
        gsiLoading = null;
        reject(new Error('Could not load Google sign-in'));
      };
      document.head.appendChild(script);
    });
  }
  return gsiLoading;
};

// GSI wants a pixel width (200..400): match the form's inner width so the button lines up with the inputs on phones.
const googleWidth = (el) => Math.min(400, Math.max(200, Math.round(el?.clientWidth || 320)));

const GoogleButton = () => {
  const navigate = useNavigate();
  const setLogin = useUserStore((state) => state.setLogin);
  const containerRef = useRef(null);
  const [clientId, setClientId] = useState(undefined); // undefined = loading, null = not configured
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    axios
      .get(`${API}/api/auth/config`)
      .then((r) => { if (!cancelled) setClientId(r.data?.googleClientId || null); })
      .catch(() => { if (!cancelled) setClientId(null); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!clientId) return undefined;
    let cancelled = false;

    const onCredential = async ({ credential }) => {
      setBusy(true);
      setError('');
      try {
        const { data } = await axios.post(`${API}/api/auth/google`, { credential });
        if (!data?.success || !data.token) throw new Error('Invalid response from server');
        const u = data.user;
        setLogin(data.token, { id: u._id, email: u.email, name: u.name, username: u.username, role: u.role, preferences: u.preferences, profile: u.profile });
        navigate(landingPath(u.preferences));
      } catch (err) {
        setError(err.response?.data?.message || err.message || 'Google sign-in failed. Please try again.');
      } finally {
        setBusy(false);
      }
    };

    loadGsi()
      .then(() => {
        if (cancelled) return;
        window.google.accounts.id.initialize({ client_id: clientId, callback: onCredential });
        window.google.accounts.id.renderButton(containerRef.current, { theme: 'filled_black', size: 'large', width: googleWidth(containerRef.current) });
      })
      .catch((err) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [clientId, navigate, setLogin]);

  return (
    <div className="space-y-3">
      {clientId === null ? (
        <>
          <button
            type="button"
            disabled
            className="w-full cursor-not-allowed rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-sm font-semibold text-slate-500"
          >
            Continue with Google
          </button>
          <p className="text-center text-xs text-slate-500">Not configured: set GOOGLE_CLIENT_ID in backend/.env</p>
        </>
      ) : (
        <div ref={containerRef} className="flex min-h-[44px] w-full max-w-full justify-center overflow-hidden" />
      )}

      {busy && (
        <div className="flex items-center justify-center gap-2 text-sm text-slate-400">
          <Spinner size={14} />
          Signing in with Google...
        </div>
      )}
      {error && (
        <div className="rounded-2xl border border-red-900/70 bg-red-950/40 px-4 py-3 text-sm text-red-300">{error}</div>
      )}
    </div>
  );
};

export default GoogleButton;
