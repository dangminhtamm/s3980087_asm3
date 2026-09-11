import type { Request, RequestHandler, Response } from 'express';

type AsyncRequestHandler = (request: Request, response: Response) => Promise<void> | void;

/** Bridges promise-returning controllers to Express' error pipeline. */
export const asyncHandler =
  (handler: AsyncRequestHandler): RequestHandler =>
  (request, response, next) => {
    Promise.resolve(handler(request, response)).catch(next);
  };
