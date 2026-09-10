import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useCloudFleetAuth } from '../auth/CloudFleetAuth';

export const AuthCallbackPage = () => {
  const auth = useCloudFleetAuth();
  const navigate = useNavigate();
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    auth
      .completeLogin()
      .then((user) => {
        const target = user.roles.includes('ADMIN')
          ? '/admin'
          : user.roles.includes('DRIVER')
            ? '/driver'
            : '/';
        navigate(target, { replace: true });
      })
      .catch(() => setError('The sign-in session is invalid or has expired.'));
  }, [auth, navigate]);

  return (
    <main className="grid min-h-screen place-items-center bg-neutral-950 px-6 text-white">
      <div className="text-center">
        <div className="mx-auto size-6 animate-spin rounded-full border border-neutral-600 border-t-white" />
        <p className="mt-5 text-sm text-neutral-400">Completing sign-in…</p>
        {error && <p className="mt-4 text-sm text-red-300">{error}</p>}
      </div>
    </main>
  );
};
