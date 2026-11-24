import { isSupabaseConfigured } from '../../lib/env';
import AuthView from '../../components/AuthView';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; authError?: string }>;
}) {
  const resolved = await searchParams;
  const authConfigured = isSupabaseConfigured();

  return (
    <div className="app view-login">
      <AuthView
        authConfigured={authConfigured}
        nextPath={resolved.next}
        initialError={resolved.authError || ''}
      />
    </div>
  );
}
