// /sso?token=&next= : Orrery hands the user over with a 60 s single-use token. We trade it for a normal Trade session
// (existing accounts only) and go to the same-origin `next`. No account -> the normal login with the email prefilled.
import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import useUserStore from '../store/userStore';
import { API } from '../lib/api';
import { landingPath } from '../lib/landing';
import { safeNext } from '../lib/orrery';

const Sso = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);
  const started = useRef(false); // the token is single use: StrictMode's second effect run must not spend it twice

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = params.get('token');
    const next = safeNext(params.get('next'));
    if (!token) { setFailed(true); return; }
    axios.post(`${API}/api/orrery/sso`, { token })
      .then(({ data }) => {
        const u = data.user;
        useUserStore.getState().setLogin(data.token, { id: u._id, email: u.email, name: u.name, username: u.username, role: u.role, preferences: u.preferences, profile: u.profile });
        navigate(next || landingPath(u.preferences), { replace: true });
      })
      .catch((err) => {
        if (err.response?.data?.code === 'NO_ACCOUNT') navigate('/login', { replace: true, state: { email: err.response.data.email, next } });
        else setFailed(true);
      });
  }, [params, navigate]);

  if (!failed) return <div className="p-4 text-sm text-slate-500">Signing you in...</div>;
  return (
    <div className="p-4 text-sm text-slate-300">
      The sign-in link from Orrery is invalid or has expired. <Link className="text-sky-400 underline" to="/login">Sign in here</Link>.
    </div>
  );
};

export default Sso;
