



import React, { createContext, useContext, useState, ReactNode, useCallback, useEffect } from 'react';
import type { Review } from '../types';
import { useUserAuth } from './UserAuthContext';
import { getSupabaseClient } from '../supabase';
import { isAbortLikeError, localizeSupabaseError } from '../utils/errorUtils';


interface ReviewContextType {
  reviews: Review[];
  loading: boolean;
  getReviewsByItemId: (itemId: string) => Review[];
  addReview: (reviewData: Omit<Review, 'id' | 'userId' | 'userName' | 'userAvatarUrl' | 'createdAt'>) => Promise<void>;
  deleteReview: (reviewId: string) => Promise<void>;
  fetchReviews: () => Promise<void>;
}

const ReviewContext = createContext<ReviewContextType | undefined>(undefined);

export const ReviewProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const { currentUser } = useUserAuth();

  const fetchReviews = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        setReviews([]);
        return;
      }
      const { data: rows, error } = await supabase.from('reviews').select('id,data');
      if (error) throw error;
      const remoteReviews = (rows || []).map(row => row.data as Review).filter(Boolean);
      remoteReviews.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      setReviews(
        remoteReviews.map(r => ({
          ...r,
          userName: r.userName || 'Anonymous',
          userAvatarUrl: r.userAvatarUrl || `https://i.pravatar.cc/150?u=${r.userId}`,
        }))
      );
    } catch (error) {
      const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
      if (isOffline || isAbortLikeError(error)) return;
      const msg = localizeSupabaseError(error);
      if (msg && import.meta.env.DEV) console.error(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReviews();
  }, [fetchReviews]);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const channel = supabase
      .channel('public:reviews')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'reviews' },
        async () => {
          await fetchReviews();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchReviews]);

  const getReviewsByItemId = useCallback((itemId: string) => {
    return reviews.filter(review => review.menuItemId === itemId);
  }, [reviews]);

  const addReview = async (reviewData: Omit<Review, 'id' | 'userId' | 'userName' | 'userAvatarUrl' | 'createdAt'>) => {
    if (!currentUser) return;
    
    const newReview: Review = {
      id: crypto.randomUUID(),
      ...reviewData,
      userId: currentUser.id,
      userName: currentUser.fullName || 'Anonymous',
      userAvatarUrl: currentUser.avatarUrl || `https://i.pravatar.cc/150?u=${currentUser.id}`,
      createdAt: new Date().toISOString(),
    };
    const supabase = getSupabaseClient();
    if (!supabase) {
      throw new Error('Supabase غير مهيأ.');
    }
    let customerAuthUserId: string | null = null;
    try {
      const { data } = await supabase.auth.getUser();
      customerAuthUserId = data.user?.id ?? null;
    } catch {
      customerAuthUserId = null;
    }

    try {
      const { error } = await supabase.from('reviews').insert({
        id: newReview.id,
        menu_item_id: newReview.menuItemId,
        customer_auth_user_id: (customerAuthUserId || newReview.userId) as any,
        rating: newReview.rating,
        data: newReview,
      });
      if (error) throw error;
    } catch (err) {
      throw new Error(localizeSupabaseError(err));
    }
    await fetchReviews();
  };

  const deleteReview = async (reviewId: string) => {
    const supabase = getSupabaseClient();
    if (!supabase) {
      throw new Error('Supabase غير مهيأ.');
    }
    try {
      const { error } = await supabase.from('reviews').delete().eq('id', reviewId);
      if (error) throw error;
    } catch (err) {
      throw new Error(localizeSupabaseError(err));
    }
    await fetchReviews();
  };


  return (
    <ReviewContext.Provider value={{ reviews, loading, getReviewsByItemId, addReview, deleteReview, fetchReviews }}>
      {children}
    </ReviewContext.Provider>
  );
};

export const useReviews = () => {
  const context = useContext(ReviewContext);
  if (context === undefined) {
    throw new Error('useReviews must be used within a ReviewProvider');
  }
  return context;
};
