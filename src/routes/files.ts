import express from 'express';
import { PrismaClient } from '@prisma/client';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import jwt from 'jsonwebtoken';

const router = express.Router();
const prisma = new PrismaClient();

// S3 Client (R2 uyumlu)
const s3Client = new S3Client({
  region: process.env.S3_REGION || 'auto',
  endpoint: process.env.S3_ENDPOINT,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY || '',
    secretAccessKey: process.env.S3_SECRET_KEY || ''
  }
});

const authMiddleware = (req: any, res: any, next: any) => {
  const token = req.headers.authorization?.substring(7);
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET || '') as any;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// POST /api/files/sign-upload
router.post('/sign-upload', authMiddleware, async (req: any, res) => {
  const { name, mimeType, size } = req.body;
  
  // Validations
  const maxSize = 10 * 1024 * 1024; // 10MB
  const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png'];
  
  if (size > maxSize) {
    return res.status(400).json({ error: 'File too large (max 10MB)' });
  }
  
  if (!allowedTypes.includes(mimeType)) {
    return res.status(400).json({ error: 'Invalid file type' });
  }
  
  const key = `${req.user.userId}/${Date.now()}-${name}`;
  
  const command = new PutObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key: key,
    ContentType: mimeType
  });
  
  const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
  
  res.json({ uploadUrl, key });
});

// POST /api/files/finalize
router.post('/finalize', authMiddleware, async (req: any, res) => {
  const { key, name, mimeType, size, clientId, caseId } = req.body;
  
  const file = await prisma.file.create({
    data: {
      key,
      name,
      mimeType,
      size,
      clientId,
      caseId,
      userId: req.user.userId
    }
  });
  
  res.status(201).json(file);
});

// GET /api/files/download/:id
router.get('/download/:id', authMiddleware, async (req: any, res) => {
  const file = await prisma.file.findFirst({
    where: { 
      id: parseInt(req.params.id),
      userId: req.user.userId 
    }
  });
  
  if (!file) {
    return res.status(404).json({ error: 'File not found' });
  }
  
  const command = new GetObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key: file.key
  });
  
  const downloadUrl = await getSignedUrl(s3Client, command, { expiresIn: 300 });
  
  res.json({ url: downloadUrl, name: file.name });
});

// GET /api/files
router.get('/', authMiddleware, async (req: any, res) => {
  const { clientId, caseId } = req.query;
  
  const where: any = { userId: req.user.userId };
  if (clientId) where.clientId = parseInt(clientId);
  if (caseId) where.caseId = parseInt(caseId);
  
  const files = await prisma.file.findMany({
    where,
    orderBy: { createdAt: 'desc' }
  });
  
  res.json(files);
});

// DELETE /api/files/:id
router.delete('/:id', authMiddleware, async (req: any, res) => {
  await prisma.file.deleteMany({
    where: { 
      id: parseInt(req.params.id),
      userId: req.user.userId 
    }
  });
  
  res.json({ message: 'File deleted' });
});

export default router;
