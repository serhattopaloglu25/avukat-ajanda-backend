import { Router } from 'express';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { getUploadUrl, deleteFile } from '../services/r2';
import { v4 as uuidv4 } from 'uuid';

const router = Router();
const prisma = new PrismaClient();

// Get signed upload URL
const signUploadSchema = z.object({
  name: z.string(),
  mimeType: z.string(),
  size: z.number(),
  caseId: z.number().optional(),
});

router.post('/files/sign', requireAuth, async (req: AuthRequest, res) => {
  try {
    const data = signUploadSchema.parse(req.body);
    const ext = data.name.split('.').pop();
    const key = `${req.orgId}/${uuidv4()}.${ext}`;
    
    const { uploadUrl, fileKey } = await getUploadUrl(key, data.mimeType);
    
    res.json({ uploadUrl, fileKey });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(422).json({ error: 'Invalid data' });
    }
    res.status(500).json({ error: 'Failed to generate upload URL' });
  }
});

// Create file record
router.post('/files', requireAuth, async (req: AuthRequest, res) => {
  try {
    const file = await prisma.file.create({
      data: {
        orgId: req.orgId!,
        name: req.body.name,
        key: req.body.key,
        mimeType: req.body.mimeType,
        size: req.body.size,
        caseId: req.body.caseId,
        uploadedBy: req.user.id,
      },
    });

    await prisma.auditLog.create({
      data: {
        orgId: req.orgId,
        userId: req.user.id,
        action: 'upload',
        resource: 'file',
        resourceId: file.id.toString(),
        meta: { name: file.name, size: file.size },
      },
    });

    res.status(201).json(file);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create file record' });
  }
});

// List files
router.get('/files', requireAuth, async (req: AuthRequest, res) => {
  try {
    const files = await prisma.file.findMany({
      where: {
        orgId: req.orgId,
        caseId: req.query.caseId ? parseInt(req.query.caseId as string) : undefined,
      },
      orderBy: { createdAt: 'desc' },
    });

    const publicUrl = process.env.R2_PUBLIC_BASE_URL || '';
    const filesWithUrls = files.map(file => ({
      ...file,
      url: publicUrl ? `${publicUrl}/${file.key}` : null,
    }));

    res.json(filesWithUrls);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch files' });
  }
});

// Delete file
router.delete('/files/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const file = await prisma.file.findFirst({
      where: {
        id: parseInt(req.params.id),
        orgId: req.orgId,
      },
    });

    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    await deleteFile(file.key);
    await prisma.file.delete({ where: { id: file.id } });

    await prisma.auditLog.create({
      data: {
        orgId: req.orgId,
        userId: req.user.id,
        action: 'delete',
        resource: 'file',
        resourceId: file.id.toString(),
      },
    });

    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

export default router;
