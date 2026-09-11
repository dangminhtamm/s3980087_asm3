import type { RequestHandler, Response } from 'express';
import type { ZodType } from 'zod';

export interface RequestSchemas {
  body?: ZodType;
  params?: ZodType;
  query?: ZodType;
}

type RequestPart = keyof RequestSchemas;
type ValidatedValues = Partial<Record<RequestPart, unknown>>;

export const validateRequest =
  (schemas: RequestSchemas): RequestHandler =>
  (request, response, next) => {
    const validated: ValidatedValues = {};
    if (schemas.params) validated.params = schemas.params.parse(request.params);
    if (schemas.query) validated.query = schemas.query.parse(request.query);
    if (schemas.body) validated.body = schemas.body.parse(request.body);
    response.locals.validated = validated;
    next();
  };

export const validated = <T>(response: Response, part: RequestPart): T => {
  const values = response.locals.validated as ValidatedValues | undefined;
  return values?.[part] as T;
};
