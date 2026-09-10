import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';

/**
 * API authentication shared by browser requests and n8n.
 * Browser: accepts the authenticated Supabase session cookie.
 * Automation: accepts the server-only INGEST_SECRET bearer token.
 */
export async function isApiAuthorized(request: NextRequest): Promise<boolean> {
  const secret = process.env.INGEST_SECRET;
  if (secret && request.headers.get('authorization') === `Bearer ${secret}`) {
    return true;
  }

  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => cookieStore.getAll(),
          setAll: () => {},
        },
      },
    );

    const { data: { user } } = await supabase.auth.getUser();
    return Boolean(user);
  } catch {
    return false;
  }
}
