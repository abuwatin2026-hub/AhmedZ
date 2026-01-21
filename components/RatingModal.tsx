import React, { useState } from 'react';
import { Order, CartItem } from '../types';
import { useReviews } from '../contexts/ReviewContext';
import { useToast } from '../contexts/ToastContext';
import { useOrders } from '../contexts/OrderContext';
import { CloseIcon, StarIcon } from './icons';

const StarInput: React.FC<{ rating: number; setRating: (rating: number) => void }> = ({ rating, setRating }) => {
    const [hover, setHover] = useState(0);
    return (
        <div className="flex items-center">
        {[...Array(5)].map((_, index) => {
            const starValue = index + 1;
            return (
            <button
                type="button"
                key={starValue}
                className={starValue <= (hover || rating) ? 'text-yellow-400' : 'text-gray-300'}
                onClick={() => setRating(starValue)}
                onMouseEnter={() => setHover(starValue)}
                onMouseLeave={() => setHover(0)}
            >
                <StarIcon className='w-7 h-7' />
            </button>
            );
        })}
        </div>
    );
};


interface RatingModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: Order;
}

type ItemRating = {
    rating: number;
    comment: string;
};

const RatingModal: React.FC<RatingModalProps> = ({ isOpen, onClose, order }) => {
  const { addReview } = useReviews();
  const { awardPointsForReviewedOrder } = useOrders();
  const { showNotification } = useToast();
  const [ratings, setRatings] = useState<Record<string, ItemRating>>(
    order.items.reduce((acc, item) => {
        acc[item.cartItemId] = { rating: 0, comment: '' };
        return acc;
    }, {} as Record<string, ItemRating>)
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleRatingChange = (cartItemId: string, rating: number) => {
    setRatings(prev => ({...prev, [cartItemId]: {...prev[cartItemId], rating}}));
  };
  
  const handleCommentChange = (cartItemId: string, comment: string) => {
    setRatings(prev => ({...prev, [cartItemId]: {...prev[cartItemId], comment}}));
  };

  const handleSubmit = async () => {
    // Validation logic
    const unratedWithComment = Object.entries(ratings).find(([, ratingInfo]) => {
        const info = ratingInfo as ItemRating;
        return info.comment.trim() !== '' && info.rating === 0;
    });

    if (unratedWithComment) {
        const cartItemId = unratedWithComment[0];
        const item = order.items.find(i => i.cartItemId === cartItemId);
        showNotification(`الرجاء إضافة تقييم للعنصر ${item?.name['ar'] || ''} المعلق عليه`, 'error');
        return;
    }

    const isAnythingRated = Object.values(ratings).some(r => (r as ItemRating).rating > 0);
    if (!isAnythingRated) {
        showNotification('الرجاء تقييم عنصر واحد على الأقل', 'error');
        return;
    }

    setIsSubmitting(true);
    let reviewsSubmitted = false;
    for (const item of order.items) {
        const itemRating = ratings[item.cartItemId];
        if (itemRating && itemRating.rating > 0) {
            await addReview({
                menuItemId: item.id,
                rating: itemRating.rating,
                comment: itemRating.comment,
            });
            reviewsSubmitted = true;
        }
    }

    if (reviewsSubmitted) {
        const pointsWereAwarded = await awardPointsForReviewedOrder(order.id);
        
        if (pointsWereAwarded && order.pointsEarned && order.pointsEarned > 0) {
             showNotification(`تم إرسال تقييمك بنجاح وحصلت على ${order.pointsEarned} نقطة`, 'success', 5000);
        } else {
             showNotification('تم إرسال تقييمك بنجاح', 'success');
        }
    }

    setIsSubmitting(false);
    onClose();
  };


  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex justify-center items-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-lg animate-fade-in-up">
        <div className="p-4 flex justify-between items-center border-b dark:border-gray-700">
          <h2 className="text-xl font-bold dark:text-white">قيم طلبك</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
             <CloseIcon />
          </button>
        </div>
        
        <div className="p-6 space-y-6 max-h-[min(70dvh,calc(100dvh-10rem))] overflow-y-auto">
            {order.items.map((item: CartItem) => (
                <div key={item.cartItemId} className="border-b dark:border-gray-700 pb-4">
                    <div className="flex items-start gap-4">
                        <img src={item.imageUrl} alt={item.name['ar']} className="w-16 h-16 object-cover rounded-md" />
                        <div className="flex-grow">
                            <p className="font-semibold text-gray-800 dark:text-white">{item.name['ar']}</p>
                            <p className="text-sm text-gray-500 dark:text-gray-400">تقييمك:</p>
                            <StarInput 
                                rating={ratings[item.cartItemId]?.rating || 0}
                                setRating={(rating) => handleRatingChange(item.cartItemId, rating)}
                            />
                        </div>
                    </div>
                     <textarea
                        value={ratings[item.cartItemId]?.comment || ''}
                        onChange={(e) => handleCommentChange(item.cartItemId, e.target.value)}
                        placeholder="أضف تعليقك هنا..."
                        rows={2}
                        className="mt-3 w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 focus:ring-2 focus:ring-gold-500 focus:border-gold-500 transition"
                    />
                </div>
            ))}
        </div>
        
        <div className="p-4 bg-gray-50 dark:bg-gray-700 flex justify-end">
            <button 
                onClick={handleSubmit} 
                disabled={isSubmitting}
                className="bg-primary-500 text-white font-bold py-2 px-6 rounded-lg shadow-md hover:bg-primary-600 transition-colors disabled:bg-primary-400 disabled:cursor-wait"
            >
              {isSubmitting ? 'جاري...' : 'إرسال التقييم'}
            </button>
        </div>
      </div>
    </div>
  );
};

export default RatingModal;
