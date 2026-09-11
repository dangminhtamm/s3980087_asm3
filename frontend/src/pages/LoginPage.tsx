import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { useCloudFleetAuth } from '../auth/CloudFleetAuth';
import { BrandMark } from '../components/BrandMark';

export const LoginPage = () => {
  const auth = useCloudFleetAuth();
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);
  const returnTo = (location.state as { returnTo?: string } | null)?.returnTo || '/';

  useEffect(() => {
    if (!auth.isEnabled && !auth.isLoading) {
      setError('Cognito is disabled; the application is using a local development account.');
    }
  }, [auth.isEnabled, auth.isLoading]);

  if (auth.user) return <Navigate to={returnTo} replace />;

  return (
    <main className="grid min-h-screen place-items-center bg-neutral-950 px-5 text-white">
      <section className="w-full max-w-md border border-white/15 bg-white/[0.03] p-8 sm:p-10">
        <BrandMark inverse />
        <p className="mt-12 text-[10px] font-bold tracking-[0.2em] text-neutral-500 uppercase">
          Secure workspace
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Sign in to CloudFleet</h1>
        <p className="mt-4 text-sm leading-6 text-neutral-400">
          Use the Cognito account assigned to an administrator or driver.
        </p>
        {error && (
          <p className="mt-5 border border-amber-700/40 bg-amber-900/20 p-3 text-xs text-amber-200">
            {error}
          </p>
        )}
        <button
          type="button"
          onClick={() =>
            auth.login(returnTo).catch(() => setError('Unable to open the Cognito sign-in page.'))
          }
          className="mt-8 w-full bg-white px-5 py-3.5 text-sm font-bold text-neutral-950 transition hover:bg-neutral-200"
        >
          Continue with Cognito
        </button>
      </section>
    </main>
  );
};
