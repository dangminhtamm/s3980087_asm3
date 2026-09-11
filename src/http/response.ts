import type { Response } from 'express';

export const sendData = <T>(response: Response, statusCode: number, data: T): void => {
  response.status(statusCode).json({ data });
};

export const sendEmpty = (response: Response, statusCode: number): void => {
  response.status(statusCode).send();
};

export const sendCsv = (
  response: Response,
  statusCode: number,
  filename: string,
  content: string,
): void => {
  response.setHeader('Content-Type', 'text/csv; charset=utf-8');
  response.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  response.status(statusCode).send(`\uFEFF${content}`);
};
