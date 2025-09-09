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
      beforeSend(event) {
        // Remove PII
        if (event.user) {
          delete event.user.email;
          delete event.user.ip_address;
        }
        return event;
      },
    });
  }
}

export function requestHandler() {
  return (req: Request & { requestId?: string }, res: Response, next: NextFunction) => {
    req.requestId = uuidv4();
    Sentry.configureScope((scope) => {
      scope.setTag('request_id', req.requestId);
    });
    next();
  };
}

export function errorHandler() {
  return Sentry.Handlers.errorHandler();
}
