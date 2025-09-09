import * as Sentry from '@sentry/node';
import { v4 as uuidv4 } from 'uuid';
import { Request, Response, NextFunction } from 'express';

export function initSentry() {
  const dsn = process.env.SENTRY_DSN;
  
  if (dsn) {
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV || 'development',
      tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
    });
  }
}

export function sentryMiddleware() {
  return (req: Request & { requestId?: string }, res: Response, next: NextFunction) => {
    req.requestId = uuidv4();
    if (process.env.SENTRY_DSN) {
      Sentry.configureScope((scope) => {
        scope.setTag('request_id', req.requestId);
      });
    }
    next();
  };
}

export function sentryErrorHandler() {
  if (process.env.SENTRY_DSN) {
    return Sentry.Handlers.errorHandler();
  }
  return (err: any, req: Request, res: Response, next: NextFunction) => {
    console.error('Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  };
}
