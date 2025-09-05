import { Request, Response, NextFunction } from 'express';

export const requestLogger = (req: any, res: any, next: NextFunction) => {
  console.log(`${req.method} ${req.url}`);
  next();
};

export const errorHandler = (err: any, req: any, res: any, next: NextFunction) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message
  });
};
