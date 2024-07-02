import { useSession } from 'next-auth/react';
import { generateGuestId } from '~/lib/generate-guest-id';

export function useUserIdOrGuestId() {
  const { data: session } = useSession();
  const id = session?.user?.id ?? generateGuestId();
  return id;
}
