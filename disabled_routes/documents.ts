import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { z } from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';
import PDFDocument from 'pdfkit';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';

const router = Router();
const prisma = new PrismaClient();

// S3 Configuration (fallback to disk if not configured)
const useS3 = process.env.R2_ACCESS_KEY && process.env.R2_SECRET && process.env.R2_BUCKET;
const s3Client = useS3 ? new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT || 'https://api.cloudflare.com',
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY!,
    secretAccessKey: process.env.R2_SECRET!,
  },
}) : null;

// Multer configuration for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/jpeg',
      'image/png',
      'image/gif',
      'text/plain'
    ];
    
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Desteklenmeyen dosya tipi'));
    }
  }
});

// Validation schemas
const createTemplateSchema = z.object({
  name: z.string().min(1, 'Şablon adı zorunludur'),
  fields: z.array(z.object({
    name: z.string(),
    type: z.enum(['text', 'number', 'date', 'select']),
    required: z.boolean().optional(),
    options: z.array(z.string()).optional()
  })),
  bodyMd: z.string().min(1, 'Şablon içeriği zorunludur')
});

// Get all documents with filtering
router.get('/api/documents', requireAuth, async (req: AuthRequest, res) => {
  try {
    const orgId = req.orgId;
    const { 
      caseId,
      clientId,
      search,
      page = '1',
      limit = '20'
    } = req.query;

    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const take = parseInt(limit as string);

    const where: any = { orgId };
    
    if (caseId) {
      where.caseId = parseInt(caseId as string);
    }
    
    if (clientId) {
      where.clientId = parseInt(clientId as string);
    }
    
    if (search) {
      where.name = { contains: search as string, mode: 'insensitive' };
    }

    const [documents, total] = await Promise.all([
      prisma.document.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          case: {
            select: {
              id: true,
              title: true,
              caseNo: true
            }
          },
          client: {
            select: {
              id: true,
              name: true
            }
          }
        }
      }),
      prisma.document.count({ where })
    ]);

    res.json({
      documents,
      pagination: {
        page: parseInt(page as string),
        limit: take,
        total,
        totalPages: Math.ceil(total / take)
      }
    });
  } catch (error) {
    console.error('Get documents error:', error);
    res.status(500).json({ error: 'Belgeler yüklenemedi' });
  }
});

// Upload document
router.post('/api/documents/upload', requireAuth, upload.single('file'), async (req: AuthRequest, res) => {
  try {
    const orgId = req.orgId!;
    const file = req.file;
    const { caseId, clientId } = req.body;

    if (!file) {
      return res.status(400).json({ error: 'Dosya seçilmedi' });
    }

    const key = `${orgId}/${uuidv4()}-${file.originalname}`;
    
    // Upload to S3 or save to disk
    if (s3Client) {
      await s3Client.send(new PutObjectCommand({
        Bucket: process.env.R2_BUCKET!,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
        Metadata: {
          orgId: orgId.toString(),
          uploadedBy: req.userId!.toString()
        }
      }));
    } else {
      // Fallback to local disk storage
      const uploadDir = path.join(process.cwd(), 'uploads', orgId.toString());
      await fs.mkdir(uploadDir, { recursive: true });
      await fs.writeFile(path.join(uploadDir, key.split('/').pop()!), file.buffer);
    }

    // Save document metadata to database
    const document = await prisma.document.create({
      data: {
        orgId,
        caseId: caseId ? parseInt(caseId) : undefined,
        clientId: clientId ? parseInt(clientId) : undefined,
        key,
        name: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        uploadedBy: req.userId!
      },
      include: {
        case: {
          select: {
            id: true,
            title: true
          }
        },
        client: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        orgId,
        userId: req.userId!,
        action: 'upload',
        entityType: 'document',
        entityId: document.id.toString(),
        meta: {
          fileName: file.originalname,
          fileSize: file.size,
          mimeType: file.mimetype
        }
      }
    });

    res.status(201).json(document);
  } catch (error) {
    console.error('Upload document error:', error);
    res.status(500).json({ error: 'Dosya yüklenemedi' });
  }
});

// Get document download URL
router.get('/api/documents/:id/download', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const orgId = req.orgId;

    const document = await prisma.document.findFirst({
      where: { 
        id: parseInt(id),
        orgId 
      }
    });

    if (!document) {
      return res.status(404).json({ error: 'Belge bulunamadı' });
    }

    let url: string;
    
    if (s3Client) {
      // Generate presigned URL for S3
      const command = new GetObjectCommand({
        Bucket: process.env.R2_BUCKET!,
        Key: document.key
      });
      url = await getSignedUrl(s3Client, command, { expiresIn: 3600 }); // 1 hour
    } else {
      // Generate URL for local file
      url = `/api/documents/${id}/file`;
    }

    res.json({ 
      url,
      name: document.name,
      mimeType: document.mimeType
    });
  } catch (error) {
    console.error('Get download URL error:', error);
    res.status(500).json({ error: 'İndirme bağlantısı oluşturulamadı' });
  }
});

// Serve local file (fallback when S3 is not configured)
router.get('/api/documents/:id/file', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const orgId = req.orgId;

    const document = await prisma.document.findFirst({
      where: { 
        id: parseInt(id),
        orgId 
      }
    });

    if (!document) {
      return res.status(404).json({ error: 'Belge bulunamadı' });
    }

    const filePath = path.join(process.cwd(), 'uploads', document.key);
    const fileBuffer = await fs.readFile(filePath);
    
    res.setHeader('Content-Type', document.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${document.name}"`);
    res.send(fileBuffer);
  } catch (error) {
    console.error('Serve file error:', error);
    res.status(500).json({ error: 'Dosya indirilemedi' });
  }
});

// Delete document
router.delete('/api/documents/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const orgId = req.orgId!;
    const userId = req.userId!;

    const document = await prisma.document.findFirst({
      where: { 
        id: parseInt(id),
        orgId 
      }
    });

    if (!document) {
      return res.status(404).json({ error: 'Belge bulunamadı' });
    }

    // Delete from S3 or disk
    if (s3Client) {
      await s3Client.send(new DeleteObjectCommand({
        Bucket: process.env.R2_BUCKET!,
        Key: document.key
      }));
    } else {
      const filePath = path.join(process.cwd(), 'uploads', document.key);
      await fs.unlink(filePath).catch(() => {}); // Ignore if file doesn't exist
    }

    // Delete from database
    await prisma.document.delete({
      where: { id: parseInt(id) }
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        orgId,
        userId,
        action: 'delete',
        entityType: 'document',
        entityId: id,
        meta: { fileName: document.name }
      }
    });

    res.json({ message: 'Belge başarıyla silindi' });
  } catch (error) {
    console.error('Delete document error:', error);
    res.status(500).json({ error: 'Belge silinemedi' });
  }
});

// Templates CRUD
router.get('/api/templates', requireAuth, async (req: AuthRequest, res) => {
  try {
    const orgId = req.orgId;

    const templates = await prisma.template.findMany({
      where: { orgId },
      orderBy: { name: 'asc' }
    });

    res.json(templates);
  } catch (error) {
    console.error('Get templates error:', error);
    res.status(500).json({ error: 'Şablonlar yüklenemedi' });
  }
});

router.post('/api/templates', requireAuth, async (req: AuthRequest, res) => {
  try {
    const orgId = req.orgId!;
    const validatedData = createTemplateSchema.parse(req.body);

    const template = await prisma.template.create({
      data: {
        orgId,
        ...validatedData
      }
    });

    res.status(201).json(template);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ 
        error: 'Geçersiz veri',
        details: error.errors 
      });
    }
    console.error('Create template error:', error);
    res.status(500).json({ error: 'Şablon oluşturulamadı' });
  }
});

// Generate PDF from template
router.post('/api/templates/:id/render', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const orgId = req.orgId!;
    const userId = req.userId!;
    const { data, caseId, clientId } = req.body;

    const template = await prisma.template.findFirst({
      where: { 
        id: parseInt(id),
        orgId 
      }
    });

    if (!template) {
      return res.status(404).json({ error: 'Şablon bulunamadı' });
    }

    // Replace placeholders in template body
    let content = template.bodyMd;
    const fields = template.fields as any[];
    
    fields.forEach(field => {
      const value = data[field.name] || '';
      const placeholder = new RegExp(`{{${field.name}}}`, 'g');
      content = content.replace(placeholder, value);
    });

    // Generate PDF
    const doc = new PDFDocument();
    const chunks: Buffer[] = [];
    
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', async () => {
      const pdfBuffer = Buffer.concat(chunks);
      const key = `${orgId}/generated/${uuidv4()}.pdf`;
      
      // Save PDF to S3 or disk
      if (s3Client) {
        await s3Client.send(new PutObjectCommand({
          Bucket: process.env.R2_BUCKET!,
          Key: key,
          Body: pdfBuffer,
          ContentType: 'application/pdf',
          Metadata: {
            orgId: orgId.toString(),
            templateId: id,
            generatedBy: userId.toString()
          }
        }));
      } else {
        const uploadDir = path.join(process.cwd(), 'uploads', orgId.toString(), 'generated');
        await fs.mkdir(uploadDir, { recursive: true });
        await fs.writeFile(path.join(uploadDir, key.split('/').pop()!), pdfBuffer);
      }

      // Save document metadata
      const document = await prisma.document.create({
        data: {
          orgId,
          caseId: caseId ? parseInt(caseId) : undefined,
          clientId: clientId ? parseInt(clientId) : undefined,
          key,
          name: `${template.name}-${new Date().toISOString().split('T')[0]}.pdf`,
          mimeType: 'application/pdf',
          size: pdfBuffer.length,
          uploadedBy: userId
        }
      });

      res.status(201).json(document);
    });

    // Add content to PDF
    doc.fontSize(12);
    
    // Convert markdown-like content to PDF
    const lines = content.split('\n');
    lines.forEach(line => {
      if (line.startsWith('# ')) {
        doc.fontSize(20).text(line.substring(2), { align: 'center' });
        doc.fontSize(12);
      } else if (line.startsWith('## ')) {
        doc.fontSize(16).text(line.substring(3));
        doc.fontSize(12);
      } else if (line.startsWith('### ')) {
        doc.fontSize(14).text(line.substring(4));
        doc.fontSize(12);
      } else if (line.trim()) {
        doc.text(line);
      }
      doc.moveDown(0.5);
    });

    doc.end();
  } catch (error) {
    console.error('Render template error:', error);
    res.status(500).json({ error: 'PDF oluşturulamadı' });
  }
});

export default router;