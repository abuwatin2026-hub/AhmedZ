import React, { createContext, useContext, useState, ReactNode, useCallback, useEffect } from 'react';
import type { Challenge, UserChallengeProgress, Order } from '../types';
import { useUserAuth } from './UserAuthContext';
import { useToast } from './ToastContext';
import { getSupabaseClient } from '../supabase';
import { logger } from '../utils/logger';
import { localizeSupabaseError, isAbortLikeError } from '../utils/errorUtils';

interface ChallengeContextType {
  challenges: Challenge[];
  userProgress: UserChallengeProgress[];
  loading: boolean;
  updateChallengeProgress: (order: Order) => Promise<void>;
  claimReward: (progress: UserChallengeProgress) => Promise<void>;
}

const ChallengeContext = createContext<ChallengeContextType | undefined>(undefined);

export const ChallengeProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [userProgress, setUserProgress] = useState<UserChallengeProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const { currentUser, addLoyaltyPoints } = useUserAuth();
  const { showNotification } = useToast();

  const getCustomerAuthUserId = useCallback(async () => {
    const supabase = getSupabaseClient();
    if (!supabase) return null;
    try {
      const { data } = await supabase.auth.getUser();
      return data.user?.id ?? null;
    } catch {
      return null;
    }
  }, []);

  const fetchChallenges = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = getSupabaseClient();
      if (supabase) {
        const { data: rows, error: rowsError } = await supabase.from('challenges').select('id,status,end_date,data');
        if (rowsError) throw rowsError;

        const merged = (rows || [])
          .map((row: any) => {
            const raw = row?.data as Challenge | undefined;
            if (!raw) return undefined;
            const status = typeof row?.status === 'string' ? row.status : raw.status;
            const endDate = typeof raw.endDate === 'string' && raw.endDate
              ? raw.endDate
              : (row?.end_date ? String(row.end_date) : raw.endDate);
            const startDate = typeof raw.startDate === 'string' && raw.startDate
              ? raw.startDate
              : (row?.start_date ? String(row.start_date) : raw.startDate);

            return {
              ...raw,
              id: String(row.id),
              status,
              startDate,
              endDate,
            } as Challenge;
          })
          .filter(Boolean) as Challenge[];

        const nowMs = Date.now();
        const byId = new Set<string>();
        const bySignature = new Set<string>();
        const unique = merged.filter((challenge) => {
          if (!challenge?.id) return false;
          if (byId.has(challenge.id)) return false;

          const titleAr = (challenge.title as any)?.ar ?? '';
          const titleEn = (challenge.title as any)?.en ?? '';
          const signature = [
            challenge.type,
            challenge.targetCategory ?? '',
            String(challenge.targetCount ?? ''),
            String(challenge.rewardType ?? ''),
            String(challenge.rewardValue ?? ''),
            String(challenge.startDate ?? ''),
            String(challenge.endDate ?? ''),
            String(challenge.status ?? ''),
            String(titleAr),
            String(titleEn),
          ].join('|');

          byId.add(challenge.id);
          if (bySignature.has(signature)) return false;
          bySignature.add(signature);
          return true;
        });

        const activeChallenges = unique.filter((challenge) => {
          if (challenge.status !== 'active') return false;
          const endMs = Date.parse(String(challenge.endDate || ''));
          return Number.isFinite(endMs) && endMs > nowMs;
        });

        setChallenges(activeChallenges);
        return;
      }

      setChallenges([]);
    } catch (error) {
      const msg = localizeSupabaseError(error);
      if (import.meta.env.DEV && msg) {
        logger.error("Error fetching challenges:", new Error(msg));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchUserProgress = useCallback(async () => {
    if (!currentUser) {
      setUserProgress([]);
      return;
    }
    try {
      const supabase = getSupabaseClient();
      if (supabase) {
        const authUserId = await getCustomerAuthUserId();
        if (!authUserId) {
          setUserProgress([]);
          return;
        }
        const { data: rows, error } = await supabase
          .from('user_challenge_progress')
          .select('id, customer_auth_user_id, challenge_id, is_completed, data, updated_at')
          .eq('customer_auth_user_id', authUserId);
        if (error) throw error;
        const entries = (rows || [])
          .map((row: any) => {
            const data = row?.data as UserChallengeProgress | undefined;
            if (!data) return undefined;
            const progress = {
              ...data,
              id: String(row.id),
              challengeId: typeof row?.challenge_id === 'string' ? row.challenge_id : data.challengeId,
            } as UserChallengeProgress;
            const updatedAtMs = Date.parse(String(row?.updated_at || ''));
            return { progress, updatedAtMs: Number.isFinite(updatedAtMs) ? updatedAtMs : 0 };
          })
          .filter(Boolean) as Array<{ progress: UserChallengeProgress; updatedAtMs: number }>;

        const byChallengeId = new Map<string, { progress: UserChallengeProgress; updatedAtMs: number }>();
        for (const entry of entries) {
          const p = entry.progress;
          const key = String(p.challengeId || '');
          if (!key) continue;
          const current = byChallengeId.get(key);
          if (!current) {
            byChallengeId.set(key, { progress: p, updatedAtMs: entry.updatedAtMs });
            continue;
          }
          if (entry.updatedAtMs >= current.updatedAtMs) {
            byChallengeId.set(key, { progress: p, updatedAtMs: entry.updatedAtMs });
          }
        }

        setUserProgress(Array.from(byChallengeId.values()).map(v => v.progress));
        return;
      }

      setUserProgress([]);
    } catch (error) {
      if (isAbortLikeError(error)) {
        return;
      }
      const msg = localizeSupabaseError(error);
      if (import.meta.env.DEV && msg) {
        logger.error("Error fetching user progress:", new Error(msg));
      }
    }
  }, [currentUser]);

  useEffect(() => {
    fetchChallenges();
  }, [fetchChallenges]);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const scheduleRefetch = () => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      void fetchChallenges();
    };

    const onFocus = () => scheduleRefetch();
    const onVisibility = () => scheduleRefetch();
    const onOnline = () => scheduleRefetch();
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', onFocus);
      window.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('online', onOnline);
    }

    const channel = supabase
      .channel('public:challenges')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'challenges' }, async () => {
        await fetchChallenges();
      })
      .subscribe();
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', onFocus);
        window.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('online', onOnline);
      }
      supabase.removeChannel(channel);
    };
  }, [fetchChallenges]);

  useEffect(() => {
    fetchUserProgress();
  }, [fetchUserProgress]);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase || !currentUser) return;
    let cancelled = false;
    let channel: any | null = null;
    const scheduleRefetch = () => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      void fetchUserProgress();
    };

    const onFocus = () => scheduleRefetch();
    const onVisibility = () => scheduleRefetch();
    const onOnline = () => scheduleRefetch();
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', onFocus);
      window.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('online', onOnline);
    }

    void (async () => {
      const authUserId = await getCustomerAuthUserId();
      if (cancelled || !authUserId) return;
      channel = supabase
        .channel(`public:user_challenge_progress:${authUserId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'user_challenge_progress', filter: `customer_auth_user_id=eq.${authUserId}` },
          async () => {
            await fetchUserProgress();
          }
        )
        .subscribe();
    })();
    return () => {
      cancelled = true;
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', onFocus);
        window.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('online', onOnline);
      }
      if (channel) supabase.removeChannel(channel);
    };
  }, [currentUser, fetchUserProgress, getCustomerAuthUserId]);

  const updateChallengeProgress = async (order: Order) => {
    if (!currentUser) return;
    const supabase = getSupabaseClient();
    if (!supabase) {
      throw new Error('Supabase غير مهيأ.');
    }
    const authUserId = await getCustomerAuthUserId();
    if (!authUserId) {
      throw new Error('لم يتم تسجيل الدخول في Supabase.');
    }

    for (const challenge of challenges) {
      let progressMade = 0;
      let progress = userProgress.find(entry => entry.challengeId === challenge.id);

      if (!progress) {
        try {
          const { data: row, error } = await supabase
            .from('user_challenge_progress')
            .select('id, customer_auth_user_id, challenge_id, is_completed, data')
            .eq('customer_auth_user_id', authUserId)
            .eq('challenge_id', challenge.id)
            .maybeSingle();
          if (error) throw error;
          const data = row?.data as UserChallengeProgress | undefined;
          progress = data ? ({ ...data, id: String((row as any).id), challengeId: String((row as any).challenge_id || data.challengeId) } as UserChallengeProgress) : undefined;
        } catch (err) {
          if (import.meta.env.DEV) {
            logger.warn("Failed to load existing challenge progress", new Error(localizeSupabaseError(err)));
          }
        }
      }

      if (!progress) {
        progress = {
          id: crypto.randomUUID(),
          userId: currentUser.id,
          challengeId: challenge.id,
          currentProgress: 0,
          isCompleted: false,
          rewardClaimed: false,
          _completedItems: [],
        };
      }

      if (progress.isCompleted) continue;

      if (challenge.type === 'category_count') {
        const target = String(challenge.targetCategory || '').trim();
        progressMade = !target ? 1 : (order.items.some(item => item.category === target) ? 1 : 0);
      } else if (challenge.type === 'distinct_items') {
        const completedItems = progress._completedItems || [];
        const newItems = order.items.filter(item => !completedItems.includes(item.id));
        progressMade = newItems.length;
        progress._completedItems = [...completedItems, ...newItems.map(item => item.id)];
      }

      if (progressMade > 0) {
        progress.currentProgress += progressMade;
        if (progress.currentProgress >= challenge.targetCount) {
          progress.isCompleted = true;
          showNotification(`🎉 اكتمل التحدي: ${challenge.title.ar}`, 'success');
        }
        try {
          const { data: existingRow, error: existingError } = await supabase
            .from('user_challenge_progress')
            .select('id')
            .eq('customer_auth_user_id', authUserId)
            .eq('challenge_id', challenge.id)
            .maybeSingle();
          if (existingError) throw existingError;

          const payload = {
            customer_auth_user_id: authUserId,
            challenge_id: challenge.id,
            is_completed: Boolean(progress.isCompleted),
            data: progress,
          };

          const write = existingRow?.id
            ? supabase.from('user_challenge_progress').update(payload).eq('id', existingRow.id)
            : supabase.from('user_challenge_progress').insert({ id: progress.id, ...payload });
          const { error } = await write;
          if (error) throw error;
        } catch (err) {
          if (import.meta.env.DEV) {
            logger.warn("Failed to upsert challenge progress", new Error(localizeSupabaseError(err)));
          }
          continue;
        }
      }
    }
    await fetchUserProgress(); // Refresh progress state
  };

  const claimReward = async (progress: UserChallengeProgress) => {
    if (!currentUser || !progress.isCompleted || progress.rewardClaimed) return;

    const challenge = challenges.find(c => c.id === progress.challengeId);
    if (!challenge) return;

    if (challenge.rewardType === 'points') {
      const supabase = getSupabaseClient();
      if (!supabase) {
        throw new Error('Supabase غير مهيأ.');
      }
      const authUserId = await getCustomerAuthUserId();
      if (!authUserId) {
        throw new Error('لم يتم تسجيل الدخول في Supabase.');
      }
      await addLoyaltyPoints(currentUser.id, challenge.rewardValue);
      const updatedProgress = { ...progress, rewardClaimed: true };
      try {
        const { data: existingRow, error: existingError } = await supabase
          .from('user_challenge_progress')
          .select('id')
          .eq('customer_auth_user_id', authUserId)
          .eq('challenge_id', updatedProgress.challengeId)
          .maybeSingle();
        if (existingError) throw existingError;
        if (!existingRow?.id) return;
        const { error } = await supabase
          .from('user_challenge_progress')
          .update({ is_completed: Boolean(updatedProgress.isCompleted), data: updatedProgress })
          .eq('id', existingRow.id);
        if (error) throw error;
      } catch (err) {
        showNotification(localizeSupabaseError(err), 'error');
        return;
      }
      showNotification(`تم استلام الجائزة: +${challenge.rewardValue} نقطة!`, 'success');
      await fetchUserProgress(); // Refresh state
    }
  };

  return (
    <ChallengeContext.Provider value={{ challenges, userProgress, loading, updateChallengeProgress, claimReward }}>
      {children}
    </ChallengeContext.Provider>
  );
};

export const useChallenges = () => {
  const context = useContext(ChallengeContext);
  if (context === undefined) {
    throw new Error('useChallenges must be used within a ChallengeProvider');
  }
  return context;
};
