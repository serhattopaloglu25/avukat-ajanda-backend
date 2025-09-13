import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { z } from 'zod';

const router = Router();
const prisma = new PrismaClient();

// GET /me - Get current user
router.get('/me', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            clients: true,
            cases: true,
            events: true
          }
        }
      }
    });

    if (!user) {
      return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    }

    res.json(user);
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Kullanıcı bilgileri alınamadı' });
  }
});

// GET /api/stats - Dashboard stats
router.get('/api/stats', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;

    const [clientCount, activeCaseCount, events] = await Promise.all([
      prisma.client.count({ where: { userId } }),
      prisma.case.count({ where: { userId, status: 'active' } }),
      prisma.event.findMany({
        where: {
          userId,
          startsAt: { gte: new Date() }
        },
        orderBy: { startsAt: 'asc' },
        take: 1,
        include: {
          case: {
            select: {
              title: true,
              caseNo: true
            }
          }
        }
      })
    ]);

    const nextHearing = events.length > 0 ? {
      id: events[0].id.toString(),
      title: events[0].title,
      startAt: (events[0].startsAt || events[0].startAt)?.toISOString() || new Date().toISOString(),
      location: events[0].location
    } : null;

    res.json({
      clientCount,
      activeCaseCount,
      nextHearing,
      unpaidInvoiceCount: 0
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ error: 'İstatistikler yüklenemedi' });
  }
});

// Client CRUD
const clientSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  address: z.string().optional().nullable()
});

// POST /api/clients
router.post('/api/clients', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const validatedData = clientSchema.parse(req.body);
    
    const client = await prisma.client.create({
      data: {
        ...validatedData,
        userId: req.userId!
      }
    });

    res.status(201).json(client);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Geçersiz veri', details: error.errors });
    }
    console.error('Create client error:', error);
    res.status(500).json({ error: 'Müvekkil oluşturulamadı' });
  }
});

// GET /api/clients
router.get('/api/clients', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { q, email, phone } = req.query;
    const userId = req.userId!;

    const where: any = { userId };

    if (q) {
      where.OR = [
        { name: { contains: q as string, mode: 'insensitive' } },
        { email: { contains: q as string, mode: 'insensitive' } }
      ];
    }
    if (email) {
      where.email = { contains: email as string, mode: 'insensitive' };
    }
    if (phone) {
      where.phone = { contains: phone as string, mode: 'insensitive' };
    }

    const clients = await prisma.client.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });

    res.json(clients);
  } catch (error) {
    console.error('Get clients error:', error);
    res.status(500).json({ error: 'Müvekiller yüklenemedi' });
  }
});

// GET /api/clients/:id
router.get('/api/clients/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const client = await prisma.client.findFirst({
      where: {
        id: parseInt(req.params.id),
        userId: req.userId!
      },
      include: {
        cases: true
      }
    });

    if (!client) {
      return res.status(404).json({ error: 'Müvekkil bulunamadı' });
    }

    res.json(client);
  } catch (error) {
    console.error('Get client error:', error);
    res.status(500).json({ error: 'Müvekkil yüklenemedi' });
  }
});

// PUT /api/clients/:id
router.put('/api/clients/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const validatedData = clientSchema.partial().parse(req.body);
    
    const client = await prisma.client.updateMany({
      where: {
        id: parseInt(req.params.id),
        userId: req.userId!
      },
      data: validatedData
    });

    if (client.count === 0) {
      return res.status(404).json({ error: 'Müvekkil bulunamadı' });
    }

    const updated = await prisma.client.findUnique({
      where: { id: parseInt(req.params.id) }
    });

    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Geçersiz veri', details: error.errors });
    }
    console.error('Update client error:', error);
    res.status(500).json({ error: 'Müvekkil güncellenemedi' });
  }
});

// DELETE /api/clients/:id
router.delete('/api/clients/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const result = await prisma.client.deleteMany({
      where: {
        id: parseInt(req.params.id),
        userId: req.userId!
      }
    });

    if (result.count === 0) {
      return res.status(404).json({ error: 'Müvekkil bulunamadı' });
    }

    res.json({ message: 'Müvekkil silindi' });
  } catch (error) {
    console.error('Delete client error:', error);
    res.status(500).json({ error: 'Müvekkil silinemedi' });
  }
});

// Case CRUD
const caseSchema = z.object({
  caseNo: z.string().min(1),
  title: z.string().min(1),
  status: z.string().default('active'),
  clientId: z.number()
});

// POST /api/cases
router.post('/api/cases', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const validatedData = caseSchema.parse(req.body);
    
    // Check if client belongs to user
    const client = await prisma.client.findFirst({
      where: {
        id: validatedData.clientId,
        userId: req.userId!
      }
    });

    if (!client) {
      return res.status(404).json({ error: 'Müvekkil bulunamadı' });
    }

    const caseData = await prisma.case.create({
      data: {
        ...validatedData,
        userId: req.userId!
      },
      include: {
        client: true
      }
    });

    res.status(201).json(caseData);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Geçersiz veri', details: error.errors });
    }
    if ((error as any).code === 'P2002') {
      return res.status(400).json({ error: 'Bu dava numarası zaten kullanımda' });
    }
    console.error('Create case error:', error);
    res.status(500).json({ error: 'Dava oluşturulamadı' });
  }
});

// GET /api/cases
router.get('/api/cases', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { status, clientId } = req.query;
    const userId = req.userId!;

    const where: any = { userId };

    if (status) {
      where.status = status;
    }
    if (clientId) {
      where.clientId = parseInt(clientId as string);
    }

    const cases = await prisma.case.findMany({
      where,
      include: {
        client: true,
        _count: {
          select: {
            events: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json(cases);
  } catch (error) {
    console.error('Get cases error:', error);
    res.status(500).json({ error: 'Davalar yüklenemedi' });
  }
});

// GET /api/cases/:id
router.get('/api/cases/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const caseData = await prisma.case.findFirst({
      where: {
        id: parseInt(req.params.id),
        userId: req.userId!
      },
      include: {
        client: true,
        events: {
          orderBy: { startsAt: 'desc' }
        }
      }
    });

    if (!caseData) {
      return res.status(404).json({ error: 'Dava bulunamadı' });
    }

    res.json(caseData);
  } catch (error) {
    console.error('Get case error:', error);
    res.status(500).json({ error: 'Dava yüklenemedi' });
  }
});

// PUT /api/cases/:id
router.put('/api/cases/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const validatedData = caseSchema.partial().parse(req.body);
    
    const result = await prisma.case.updateMany({
      where: {
        id: parseInt(req.params.id),
        userId: req.userId!
      },
      data: validatedData
    });

    if (result.count === 0) {
      return res.status(404).json({ error: 'Dava bulunamadı' });
    }

    const updated = await prisma.case.findUnique({
      where: { id: parseInt(req.params.id) },
      include: { client: true }
    });

    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Geçersiz veri', details: error.errors });
    }
    console.error('Update case error:', error);
    res.status(500).json({ error: 'Dava güncellenemedi' });
  }
});

// DELETE /api/cases/:id
router.delete('/api/cases/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const result = await prisma.case.deleteMany({
      where: {
        id: parseInt(req.params.id),
        userId: req.userId!
      }
    });

    if (result.count === 0) {
      return res.status(404).json({ error: 'Dava bulunamadı' });
    }

    res.json({ message: 'Dava silindi' });
  } catch (error) {
    console.error('Delete case error:', error);
    res.status(500).json({ error: 'Dava silinemedi' });
  }
});

// Event CRUD
const eventSchema = z.object({
  title: z.string().min(1),
  type: z.string().default('hearing'),
  caseId: z.number().optional().nullable(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime().optional().nullable(),
  location: z.string().optional().nullable(),
  notes: z.string().optional().nullable()
});

// POST /api/events
router.post('/api/events', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const validatedData = eventSchema.parse(req.body);
    
    // If caseId provided, check ownership
    if (validatedData.caseId) {
      const caseData = await prisma.case.findFirst({
        where: {
          id: validatedData.caseId,
          userId: req.userId!
        }
      });

      if (!caseData) {
        return res.status(404).json({ error: 'Dava bulunamadı' });
      }
    }

    const event = await prisma.event.create({
      data: {
        ...validatedData,
        startsAt: new Date(validatedData.startsAt),
        endsAt: validatedData.endsAt ? new Date(validatedData.endsAt) : undefined,
        userId: req.userId!
      },
      include: {
        case: {
          select: {
            title: true,
            caseNo: true
          }
        }
      }
    });

    res.status(201).json(event);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Geçersiz veri', details: error.errors });
    }
    console.error('Create event error:', error);
    res.status(500).json({ error: 'Etkinlik oluşturulamadı' });
  }
});

// GET /api/events
router.get('/api/events', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { from, to, caseId } = req.query;
    const userId = req.userId!;

    const where: any = { userId };

    if (from && to) {
      where.startsAt = {
        gte: new Date(from as string),
        lte: new Date(to as string)
      };
    }
    if (caseId) {
      where.caseId = parseInt(caseId as string);
    }

    const events = await prisma.event.findMany({
      where,
      include: {
        case: {
          select: {
            title: true,
            caseNo: true,
            client: {
              select: {
                name: true
              }
            }
          }
        }
      },
      orderBy: { startsAt: 'asc' }
    });

    res.json(events);
  } catch (error) {
    console.error('Get events error:', error);
    res.status(500).json({ error: 'Etkinlikler yüklenemedi' });
  }
});

// GET /api/events/ics
router.get('/api/events/ics', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { from, to } = req.query;
    const userId = req.userId!;

    const where: any = { userId };

    if (from && to) {
      where.startsAt = {
        gte: new Date(from as string),
        lte: new Date(to as string)
      };
    }

    const events = await prisma.event.findMany({
      where,
      include: {
        case: {
          select: {
            title: true,
            caseNo: true
          }
        }
      },
      orderBy: { startsAt: 'asc' }
    });

    // Simple ICS format
    let ics = 'BEGIN:VCALENDAR\r\n';
    ics += 'VERSION:2.0\r\n';
    ics += 'PRODID:-//AvukatAjanda//EN\r\n';
    ics += 'CALSCALE:GREGORIAN\r\n';

    events.forEach(event => {
      if (!event.startsAt) return; // Skip if no start date
      
      ics += 'BEGIN:VEVENT\r\n';
      ics += `UID:${event.id}@avukatajanda.com\r\n`;
      ics += `DTSTAMP:${event.createdAt.toISOString().replace(/[-:]/g, '').replace('.000', '')}\r\n`;
      ics += `DTSTART:${event.startsAt.toISOString().replace(/[-:]/g, '').replace('.000', '')}\r\n`;
      if (event.endsAt) {
        ics += `DTEND:${event.endsAt.toISOString().replace(/[-:]/g, '').replace('.000', '')}\r\n`;
      }
      ics += `SUMMARY:${event.title}\r\n`;
      if (event.location) {
        ics += `LOCATION:${event.location}\r\n`;
      }
      if (event.notes) {
        ics += `DESCRIPTION:${event.notes}\r\n`;
      }
      ics += 'END:VEVENT\r\n';
    });

    ics += 'END:VCALENDAR\r\n';

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="events.ics"');
    res.send(ics);
  } catch (error) {
    console.error('Get ICS error:', error);
    res.status(500).json({ error: 'ICS oluşturulamadı' });
  }
});

// GET /api/events/:id
router.get('/api/events/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const event = await prisma.event.findFirst({
      where: {
        id: parseInt(req.params.id),
        userId: req.userId!
      },
      include: {
        case: {
          select: {
            title: true,
            caseNo: true,
            client: {
              select: {
                name: true
              }
            }
          }
        }
      }
    });

    if (!event) {
      return res.status(404).json({ error: 'Etkinlik bulunamadı' });
    }

    res.json(event);
  } catch (error) {
    console.error('Get event error:', error);
    res.status(500).json({ error: 'Etkinlik yüklenemedi' });
  }
});

// PUT /api/events/:id
router.put('/api/events/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const validatedData = eventSchema.partial().parse(req.body);
    
    const updateData: any = { ...validatedData };
    if (validatedData.startsAt) {
      updateData.startsAt = new Date(validatedData.startsAt);
    }
    if (validatedData.endsAt) {
      updateData.endsAt = new Date(validatedData.endsAt);
    }

    const result = await prisma.event.updateMany({
      where: {
        id: parseInt(req.params.id),
        userId: req.userId!
      },
      data: updateData
    });

    if (result.count === 0) {
      return res.status(404).json({ error: 'Etkinlik bulunamadı' });
    }

    const updated = await prisma.event.findUnique({
      where: { id: parseInt(req.params.id) },
      include: {
        case: {
          select: {
            title: true,
            caseNo: true
          }
        }
      }
    });

    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Geçersiz veri', details: error.errors });
    }
    console.error('Update event error:', error);
    res.status(500).json({ error: 'Etkinlik güncellenemedi' });
  }
});

// DELETE /api/events/:id
router.delete('/api/events/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const result = await prisma.event.deleteMany({
      where: {
        id: parseInt(req.params.id),
        userId: req.userId!
      }
    });

    if (result.count === 0) {
      return res.status(404).json({ error: 'Etkinlik bulunamadı' });
    }

    res.json({ message: 'Etkinlik silindi' });
  } catch (error) {
    console.error('Delete event error:', error);
    res.status(500).json({ error: 'Etkinlik silinemedi' });
  }
});

export default router;