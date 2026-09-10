import { Navigate, Outlet, useLocation } from 'react-router-dom';

import { useCloudFleetAuth, type UserRole } from '../../auth/CloudFleetAuth';

export const ProtectedRoute = ({ allowedRoles }: { allowedRoles: UserRole[] }) => {
  const auth = useCloudFleetAuth();
  const location = useLocation();

  if (auth.isLoading) {
    return <div className="min-h-screen bg-neutral-50" aria-label="Authenticating" />;
  }

  if (!auth.user) {
    return <Navigate to="/login" replace state={{ returnTo: location.pathname }} />;
  }

  if (!auth.user.roles.some((role) => allowedRoles.includes(role))) {
    return (
      <main className="grid min-h-screen place-items-center bg-neutral-50 px-6">
        <div className="max-w-md border border-neutral-200 bg-white p-8">
          <p className="text-xs font-semibold tracking-widest text-neutral-400 uppercase">403</p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">Access denied</h1>
          <p className="mt-3 text-sm leading-6 text-neutral-500">
            Your account is not a member of the {allowedRoles.join(' or ')} Cognito group.
          </p>
        </div>
      </main>
    );
  }

  return <Outlet />;
};
