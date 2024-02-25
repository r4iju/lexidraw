// server/supabaseClient.js or similar server-side designated path

import { createClient } from '@supabase/supabase-js';
import { env } from '~/env.js';

// This global augmentation is used to ensure a single instance of the Supabase client
// is reused across the server-side application. DO NOT import this file on the client side.
const globalForSupabase = globalThis as unknown as {
  supabaseClient: ReturnType<typeof createClient> | undefined;
};

// Initialize the Supabase client with server-side credentials.
// These credentials MUST NOT be exposed to the client side.
export const supabase = globalForSupabase.supabaseClient ?? createClient(env.SUPABASE_URL, env.SUPABASE_KEY);

// In non-production environments, reuse the same Supabase client instance
// to leverage connection pooling and reduce initialization overhead.
if (env.NODE_ENV !== 'production') {
  globalForSupabase.supabaseClient = supabase;
}
