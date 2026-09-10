import type { RequestHandler } from 'express';

import { AppError } from '../errors/app-error.js';
import type { OrderService } from '../services/order.service.js';

/**
 * Admins may access every order. A DRIVER Cognito username must match the
 * driverId assigned to the requested order (for example username DRV-018).
 */
export const requireOrderOwnerOrAdmin = (
  orderService: OrderService,
): RequestHandler =>
  async (request, _response, next) => {
    try {
      const user = request.authenticatedUser;
      if (!user) {
        next(new AppError(401, 'Authentication is required', 'AUTHENTICATION_REQUIRED'));
        return;
      }
      if (user.roles.includes('ADMIN')) {
        next();
        return;
      }

      const orderId = request.params.id;
      if (typeof orderId !== 'string' || !orderId) {
        next(new AppError(400, 'Order ID is required', 'ORDER_ID_REQUIRED'));
        return;
      }

      const order = await orderService.getOrder(orderId);
      if (!user.roles.includes('DRIVER') || order.driverId !== user.username) {
        next(
          new AppError(
            403,
            'Drivers may only access orders assigned to their account',
            'ORDER_ACCESS_DENIED',
          ),
        );
        return;
      }

      next();
    } catch (error: unknown) {
      next(error);
    }
  };

/** Drivers can view only their own profile; admins can view every driver. */
export const requireDriverOwnerOrAdmin: RequestHandler = (
  request,
  _response,
  next,
) => {
  const user = request.authenticatedUser;
  if (!user) {
    next(new AppError(401, 'Authentication is required', 'AUTHENTICATION_REQUIRED'));
    return;
  }

  if (user.roles.includes('ADMIN') || request.params.id === user.username) {
    next();
    return;
  }

  next(
    new AppError(
      403,
      'Drivers may only access their own profile',
      'DRIVER_ACCESS_DENIED',
    ),
  );
};
