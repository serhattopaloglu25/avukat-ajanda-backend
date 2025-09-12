import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { z } from 'zod';
import * as ics from 'ics';

const router = Router();
const prisma = new PrismaClient();

// Validation schemas
const createEventSchema = z.object({
  title: z.string().min(1, 'Başlık zorunludur'),
  type: z.enum(['hearing', 'meeting', 'reminder', 'deadline']),
  caseId: z.number().optional().nullable(),
  description: z.string().optional().nullable(),
  startAt: z.string().datetime(),
  endAt: z.string().datetime().optional().nullable(),
  location: z.string().optional().nullable(),
  reminders: z.array(z.number()).optional().default([]) // Minutes before event
});

const updateEventSchema = createEventSchema.partial();

// Get all events with filtering
router.get('/api/events', requireAuth, async (req: AuthRequest, res) => {
  try {
    const orgId = req.orgId;
    const { 
      type,
      caseId,
      startDate,
      endDate,
      view = 'month' // month, week, day
    } = req.query;

    // Build date range based on view
    let dateRange: { startAt?: any, endAt?: any } = {};
    const now = new Date();
    
    if (startDate && endDate) {
      dateRange = {
        startAt: { gte: new Date(startDate as string) },
        endAt: { lte: new Date(endDate as string) }
      };
    } else if (view === 'day') {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      const end = new Date(now);
      end.setHours(23, 59, 59, 999);
      dateRange = {
        startAt: { gte: start, lte: end }
      };
    } else if (view === 'week') {
      const start = new Date(now);
      start.setDate(now.getDate() - now.getDay());
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      dateRange = {
        startAt: { gte: start, lte: end }
      };
    } else { // month
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      end.setHours(23, 59, 59, 999);
      dateRange = {
        startAt: { gte: start, lte: end }
      };
    }

    // Build where clause
    const where: any = { 
      orgId,
      ...dateRange
    };
    
    if (type) {
      where.type = type;
    }

    if (caseId) {
      where.caseId = parseInt(caseId as string);
    }

    const events = await prisma.event.findMany({
      where,
      orderBy: { startAt: 'asc' },
      include: {
        case: {
          select: {
            id: true,
            title: true,
            caseNo: true,
            client: {
              select: {
                id: true,
                name: true
              }
            }
          }
        },
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });

    res.json(events);
  } catch (error) {
    console.error('Get events error:', error);
    res.status(500).json({ error: 'Etkinlikler yüklenemedi' });
  }
});

// Get single event
router.get('/api/events/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const orgId = req.orgId;

    const event = await prisma.event.findFirst({
      where: { 
        id: parseInt(id),
        orgId 
      },
      include: {
        case: {
          include: {
            client: true
          }
        },
        createdBy: true
      }
    });

    if (!event) {
      return res.status(404).json({ error: 'Etkinlik bulunamadı' });
    }

    res.json(event);
  } catch (error) {
    console.error('Get event error:', error);
    res.status(500).json({ error: 'Etkinlik bilgileri yüklenemedi' });
  }
});

// Create event
router.post('/api/events', requireAuth, async (req: AuthRequest, res) => {
  try {
    const orgId = req.orgId!;
    const userId = req.userId!;
    
    const validatedData = createEventSchema.parse(req.body);

    const event = await prisma.event.create({
      data: {
        ...validatedData,
        startAt: new Date(validatedData.startAt),
        endAt: validatedData.endAt ? new Date(validatedData.endAt) : undefined,
        orgId,
        createdByUserId: userId,
        reminder: validatedData.reminders.length > 0 // Legacy field
      },
      include: {
        case: {
          select: {
            id: true,
            title: true,
            client: {
              select: {
                id: true,
                name: true
              }
            }
          }
        }
      }
    });

    // If it's a hearing, update case hearingDates
    if (validatedData.type === 'hearing' && validatedData.caseId) {
      const caseData = await prisma.case.findUnique({
        where: { id: validatedData.caseId }
      });
      
      if (caseData) {
        const hearingDates = [...(caseData.hearingDates || []), new Date(validatedData.startAt)];
        hearingDates.sort((a, b) => a.getTime() - b.getTime());
        
        await prisma.case.update({
          where: { id: validatedData.caseId },
          data: {
            hearingDates,
            nextHearing: hearingDates.find(d => d > new Date()) || null
          }
        });
      }
    }

    // Audit log
    await prisma.auditLog.create({
      data: {
        orgId,
        userId,
        action: 'create',
        entityType: 'event',
        entityId: event.id.toString(),
        meta: validatedData
      }
    });

    res.status(201).json(event);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ 
        error: 'Geçersiz veri',
        details: error.errors 
      });
    }
    console.error('Create event error:', error);
    res.status(500).json({ error: 'Etkinlik oluşturulamadı' });
  }
});

// Update event
router.put('/api/events/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const orgId = req.orgId!;
    const userId = req.userId!;
    
    const validatedData = updateEventSchema.parse(req.body);

    // Check if event exists and belongs to org
    const existing = await prisma.event.findFirst({
      where: { 
        id: parseInt(id),
        orgId 
      }
    });

    if (!existing) {
      return res.status(404).json({ error: 'Etkinlik bulunamadı' });
    }

    const updateData: any = { ...validatedData };
    if (validatedData.startAt) {
      updateData.startAt = new Date(validatedData.startAt);
    }
    if (validatedData.endAt) {
      updateData.endAt = new Date(validatedData.endAt);
    }
    if (validatedData.reminders) {
      updateData.reminder = validatedData.reminders.length > 0;
    }

    const event = await prisma.event.update({
      where: { id: parseInt(id) },
      data: updateData,
      include: {
        case: {
          select: {
            id: true,
            title: true,
            client: {
              select: {
                id: true,
                name: true
              }
            }
          }
        }
      }
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        orgId,
        userId,
        action: 'update',
        entityType: 'event',
        entityId: id,
        meta: validatedData
      }
    });

    res.json(event);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ 
        error: 'Geçersiz veri',
        details: error.errors 
      });
    }
    console.error('Update event error:', error);
    res.status(500).json({ error: 'Etkinlik güncellenemedi' });
  }
});

// Delete event
router.delete('/api/events/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const orgId = req.orgId!;
    const userId = req.userId!;

    const event = await prisma.event.findFirst({
      where: { 
        id: parseInt(id),
        orgId 
      }
    });

    if (!event) {
      return res.status(404).json({ error: 'Etkinlik bulunamadı' });
    }

    await prisma.event.delete({
      where: { id: parseInt(id) }
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        orgId,
        userId,
        action: 'delete',
        entityType: 'event',
        entityId: id,
        meta: { eventTitle: event.title }
      }
    });

    res.json({ message: 'Etkinlik başarıyla silindi' });
  } catch (error) {
    console.error('Delete event error:', error);
    res.status(500).json({ error: 'Etkinlik silinemedi' });
  }
});

// Export events as ICS (iCalendar)
router.get('/api/events/ics', requireAuth, async (req: AuthRequest, res) => {
  try {
    const orgId = req.orgId;
    const { range = '30' } = req.query; // Days to export
    
    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + parseInt(range as string));

    const events = await prisma.event.findMany({
      where: {
        orgId,
        startAt: {
          gte: startDate,
          lte: endDate
        }
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

    // Convert to ICS format
    const icsEvents = events.map(event => {
      const start = new Date(event.startAt);
      const end = event.endAt ? new Date(event.endAt) : new Date(start.getTime() + 60 * 60 * 1000);
      
      const description = [
        event.description,
        event.case ? `Dava: ${event.case.title}` : null,
        event.case?.client ? `Müvekkil: ${event.case.client.name}` : null,
        event.case?.caseNo ? `Dosya No: ${event.case.caseNo}` : null
      ].filter(Boolean).join('\\n');

      return {
        start: [start.getFullYear(), start.getMonth() + 1, start.getDate(), start.getHours(), start.getMinutes()],
        end: [end.getFullYear(), end.getMonth() + 1, end.getDate(), end.getHours(), end.getMinutes()],
        title: event.title,
        description,
        location: event.location || '',
        status: 'CONFIRMED',
        busyStatus: 'BUSY',
        alarms: event.reminders.map(minutes => ({
          action: 'display',
          description: `Hatırlatma: ${event.title}`,
          trigger: { before: true, minutes }
        }))
      };
    });

    // Generate ICS
    ics.createEvents(icsEvents as any, (error, value) => {
      if (error) {
        console.error('ICS generation error:', error);
        return res.status(500).json({ error: 'Takvim dosyası oluşturulamadı' });
      }

      res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="avukatajanda-takvim.ics"');
      res.send(value);
    });
  } catch (error) {
    console.error('Export ICS error:', error);
    res.status(500).json({ error: 'Takvim dışa aktarılamadı' });
  }
});

// Get upcoming events summary
router.get('/api/events/upcoming', requireAuth, async (req: AuthRequest, res) => {
  try {
    const orgId = req.orgId;
    const { days = '7' } = req.query;
    
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + parseInt(days as string));

    const events = await prisma.event.findMany({
      where: {
        orgId,
        startAt: {
          gte: new Date(),
          lte: endDate
        }
      },
      orderBy: { startAt: 'asc' },
      take: 10,
      include: {
        case: {
          select: {
            id: true,
            title: true,
            caseNo: true
          }
        }
      }
    });

    const grouped = events.reduce((acc, event) => {
      const date = new Date(event.startAt).toLocaleDateString('tr-TR');
      if (!acc[date]) {
        acc[date] = [];
      }
      acc[date].push(event);
      return acc;
    }, {} as Record<string, typeof events>);

    res.json(grouped);
  } catch (error) {
    console.error('Get upcoming events error:', error);
    res.status(500).json({ error: 'Yaklaşan etkinlikler yüklenemedi' });
  }
});

export default router;