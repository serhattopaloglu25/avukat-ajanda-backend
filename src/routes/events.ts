import { Router } from 'express';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { generateICS } from '../services/calendar';

const router = Router();
const prisma = new PrismaClient();

// Export calendar
router.get('/events/export.ics', requireAuth, async (req: AuthRequest, res) => {
  try {
    const startDate = req.query.start ? new Date(req.query.start as string) : undefined;
    const endDate = req.query.end ? new Date(req.query.end as string) : undefined;
    
    const icsContent = await generateICS(req.orgId!, startDate, endDate);
    
    res.setHeader('Content-Type', 'text/calendar');
    res.setHeader('Content-Disposition', 'attachment; filename="calendar.ics"');
    res.send(icsContent);
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate calendar' });
  }
});

// Get events
router.get('/events', requireAuth, async (req: AuthRequest, res) => {
  try {
    const orgId = req.orgId;
    const start = req.query.start as string;
    const end = req.query.end as string;
    const scope = req.query.scope as string;
    
    const where: any = { orgId };
    
    if (scope === 'upcoming') {
      where.startAt = { gte: new Date() };
    } else if (start && end) {
      where.startAt = {
        gte: new Date(start),
        lte: new Date(end),
      };
    }

    const events = await prisma.event.findMany({
      where,
      include: { case: true },
      orderBy: { startAt: 'asc' },
      take: scope === 'upcoming' ? 10 : undefined,
    });

    res.json(events);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// Create event
const createEventSchema = z.object({
  caseId: z.number().optional(),
  type: z.enum(['hearing', 'meeting', 'reminder', 'deadline']),
  title: z.string().min(2),
  description: z.string().optional(),
  startAt: z.string(),
  endAt: z.string().optional(),
  location: z.string().optional(),
  reminder: z.boolean().default(false),
});

router.post('/events', requireAuth, async (req: AuthRequest, res) => {
  try {
    const data = createEventSchema.parse(req.body);
    
    const event = await prisma.event.create({
      data: {
        ...data,
        startAt: new Date(data.startAt),
        endAt: data.endAt ? new Date(data.endAt) : undefined,
        orgId: req.orgId!,
        createdByUserId: req.user.id,
      },
    });

    await prisma.auditLog.create({
      data: {
        orgId: req.orgId,
        userId: req.user.id,
        action: 'create',
        resource: 'event',
        resourceId: event.id.toString(),
      },
    });

    res.status(201).json(event);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(422).json({ error: 'Invalid data', details: error.errors });
    }
    res.status(500).json({ error: 'Failed to create event' });
  }
});

export default router;
