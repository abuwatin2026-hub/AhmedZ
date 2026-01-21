import React, { createContext, useContext, useState, ReactNode, useMemo, useCallback } from 'react';
import type { CartItem, Coupon } from '../types';
import { useCoupons } from './CouponContext';
import { useToast } from './ToastContext';




// DELIVERY_FEE is now dynamic based on settings


interface CartContextType {
  cartItems: CartItem[];
  addToCart: (item: CartItem) => void;
  removeFromCart: (cartItemId: string) => void;
  updateQuantity: (cartItemId: string, quantity: number) => void;
  getCartSubtotal: () => number;
  getCartCount: () => number;
  clearCart: () => void;
  appliedCoupon: Coupon | null;
  discountAmount: number;
  applyCoupon: (code: string) => void;
  removeCoupon: () => void;
  getCartTotal: () => number;
  deliveryFee: number;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

export const CartProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [appliedCoupon, setAppliedCoupon] = useState<Coupon | null>(null);

  const { validateCoupon } = useCoupons();
  const { showNotification } = useToast();


  const addToCart = (item: CartItem) => {
    setCartItems(prevItems => [...prevItems, item]);
  };

  const removeFromCart = (cartItemId: string) => {
    setCartItems(prevItems => prevItems.filter(item => item.cartItemId !== cartItemId));
  };

  const updateQuantity = (cartItemId: string, quantity: number) => {
    if (quantity <= 0) {
      removeFromCart(cartItemId);
    } else {
      setCartItems(prevItems =>
        prevItems.map(item =>
          item.cartItemId === cartItemId ? { ...item, quantity } : item
        )
      );
    }
  };

  const getCartCount = () => {
    return cartItems.reduce((sum, item) => sum + item.quantity, 0);
  };

  const getCartSubtotal = useCallback(() => {
    return cartItems.reduce((total: number, item) => {
      // Calculate addons price
      const addonsPrice = Object.values(item.selectedAddons).reduce((sum: number, { addon, quantity }) => sum + (addon.price * quantity), 0);

      // Calculate item price based on unit type
      let itemPrice = item.price;
      let itemQuantity = item.quantity;

      // If item is weight-based (kg or gram), use weight instead of quantity
      if (item.unitType === 'kg' || item.unitType === 'gram') {
        itemQuantity = item.weight || item.quantity;
        // If unitType is gram but price is per kg, convert
        if (item.unitType === 'gram' && item.pricePerUnit) {
          itemPrice = item.pricePerUnit / 1000; // Convert to price per gram
        }
      }

      return total + (itemPrice + addonsPrice) * itemQuantity;
    }, 0);
  }, [cartItems]);


  const discountAmount = useMemo(() => {
    const subtotal = getCartSubtotal();
    if (!appliedCoupon || subtotal === 0) {
      return 0;
    }
    let calculatedDiscount = 0;
    if (appliedCoupon.type === 'percentage') {
      calculatedDiscount = subtotal * (appliedCoupon.value / 100);
    } else {
        calculatedDiscount = Math.min(appliedCoupon.value, subtotal);
    }

    if (appliedCoupon.maxDiscount && calculatedDiscount > appliedCoupon.maxDiscount) {
        calculatedDiscount = appliedCoupon.maxDiscount;
    }

    return calculatedDiscount;
  }, [appliedCoupon, getCartSubtotal]);

  const deliveryFee = useMemo(() => {
    // Delivery fee is now calculated at Checkout based on zone
    return 0;
  }, []);


  const getCartTotal = useCallback(() => {
    const subtotal = getCartSubtotal();
    if (subtotal === 0) return 0;
    const totalAfterDiscount = subtotal - discountAmount;
    return totalAfterDiscount + deliveryFee;
  }, [getCartSubtotal, discountAmount, deliveryFee]);

  const applyCoupon = (code: string) => {
    const coupon = validateCoupon(code);
    if (coupon) {
      // Validate Min Order Amount
      const subtotal = getCartSubtotal();
      if (coupon.minOrderAmount && subtotal < coupon.minOrderAmount) {
        showNotification(`الحد الأدنى للطلب لاستخدام الكوبون هو ${coupon.minOrderAmount} ر.ي`, 'error');
        setAppliedCoupon(null);
        return;
      }
      setAppliedCoupon(coupon);
      showNotification('تم تطبيق الكوبون بنجاح', 'success');
    } else {
      setAppliedCoupon(null);
      showNotification('كوبون غير صالح أو منتهي الصلاحية', 'error');
    }
  };

  const removeCoupon = () => {
    setAppliedCoupon(null);
  };

  const clearCart = () => {
    setCartItems([]);
    setAppliedCoupon(null);
  };

  return (
    <CartContext.Provider value={{
      cartItems,
      addToCart,
      removeFromCart,
      updateQuantity,
      getCartSubtotal,
      getCartCount,
      clearCart,
      appliedCoupon,
      discountAmount,
      applyCoupon,
      removeCoupon,
      getCartTotal,
      // Expose delivery fee so components can display it
      deliveryFee: deliveryFee
    }}>
      {children}
    </CartContext.Provider>
  );
};

export const useCart = () => {
  const context = useContext(CartContext);
  if (context === undefined) {
    throw new Error('useCart must be used within a CartProvider');
  }
  return context;
};
