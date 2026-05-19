import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/lib/user-store/provider';
import { isUserOnFreeTier, getUserTier, UserSubscription } from '@/lib/utils/subscription';
import type { UserTier } from '@/lib/tier';

interface UseSubscriptionReturn {
  isFreeTier: boolean;
  tier: UserTier;
  subscriptions: UserSubscription[] | null;
  loading: boolean;
  error: string | null;
}

export function useSubscription(): UseSubscriptionReturn {
  const { user } = useUser();
  const [subscriptions, setSubscriptions] = useState<UserSubscription[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchSubscriptions() {
      if (!user?.id) {
        setLoading(false);
        return;
      }

      try {
        const supabase = createClient();
        if (!supabase) {
          throw new Error('Supabase client not available');
        }

        // Use the same pattern as other parts of the codebase to bypass TypeScript issues
        const { data, error: fetchError } = await (supabase as any)
          .from('user_subscriptions')
          .select(`
            status,
            subscription_plans (
              tier
            )
          `)
          .eq('user_id', user.id)
          .in('status', ['active', 'trialing', 'past_due']);

        if (fetchError) {
          throw fetchError;
        }

        setSubscriptions(data as UserSubscription[]);
        setError(null);
      } catch (err) {
        console.error('Error fetching subscriptions:', err);
        setError(err instanceof Error ? err.message : 'Unknown error');
        setSubscriptions(null);
      } finally {
        setLoading(false);
      }
    }

    fetchSubscriptions();
  }, [user?.id]);

  return {
    isFreeTier: isUserOnFreeTier(subscriptions),
    tier: getUserTier(subscriptions),
    subscriptions,
    loading,
    error
  };
}