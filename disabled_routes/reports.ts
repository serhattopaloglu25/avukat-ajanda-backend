import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { Parser } from 'json2csv';
import ExcelJS from 'exceljs';

const router = Router();
const prisma = new PrismaClient();

// Global search
router.get('/api/search', requireAuth, async (req: AuthRequest, res) => {
  try {
    const orgId = req.orgId;
    const { q } = req.query;

    if (!q || (q as string).length < 2) {
      return res.json({ results: [] });
    }

    const searchTerm = (q as string).toLowerCase();

    // Search across multiple entities
    const [clients, cases, invoices, documents] = await Promise.all([
      // Search clients
      prisma.client.findMany({
        where: {
          orgId,
          OR: [
            { name: { contains: searchTerm, mode: 'insensitive' } },
            { email: { contains: searchTerm, mode: 'insensitive' } },
            { phone: { contains: searchTerm, mode: 'insensitive' } },
            { tcKimlik: { contains: searchTerm, mode: 'insensitive' } },
            { vergiNo: { contains: searchTerm, mode: 'insensitive' } }
          ]
        },
        take: 5,
        select: {
          id: true,
          name: true,
          email: true,
          phone: true
        }
      }),

      // Search cases
      prisma.case.findMany({
        where: {
          orgId,
          OR: [
            { title: { contains: searchTerm, mode: 'insensitive' } },
            { caseNo: { contains: searchTerm, mode: 'insensitive' } },
            { court: { contains: searchTerm, mode: 'insensitive' } },
            { description: { contains: searchTerm, mode: 'insensitive' } }
          ]
        },
        take: 5,
        select: {
          id: true,
          title: true,
          caseNo: true,
          status: true,
          client: {
            select: {
              name: true
            }
          }
        }
      }),

      // Search invoices
      prisma.invoice.findMany({
        where: {
          orgId,
          OR: [
            { invoiceNo: { contains: searchTerm, mode: 'insensitive' } },
            { notes: { contains: searchTerm, mode: 'insensitive' } }
          ]
        },
        take: 5,
        select: {
          id: true,
          invoiceNo: true,
          totalAmount: true,
          status: true,
          client: {
            select: {
              name: true
            }
          }
        }
      }),

      // Search documents
      prisma.document.findMany({
        where: {
          orgId,
          name: { contains: searchTerm, mode: 'insensitive' }
        },
        take: 5,
        select: {
          id: true,
          name: true,
          mimeType: true,
          size: true
        }
      })
    ]);

    // Format results
    const results = [
      ...clients.map(c => ({
        type: 'client',
        id: c.id,
        title: c.name,
        subtitle: c.email || c.phone || '',
        url: `/clients/${c.id}`
      })),
      ...cases.map(c => ({
        type: 'case',
        id: c.id,
        title: c.title,
        subtitle: `${c.caseNo || ''} - ${c.client?.name || ''}`,
        url: `/cases/${c.id}`
      })),
      ...invoices.map(i => ({
        type: 'invoice',
        id: i.id,
        title: i.invoiceNo,
        subtitle: `${i.client.name} - ₺${i.totalAmount}`,
        url: `/invoices/${i.id}`
      })),
      ...documents.map(d => ({
        type: 'document',
        id: d.id,
        title: d.name,
        subtitle: `${Math.round(d.size / 1024)}KB`,
        url: `/files/${d.id}`
      }))
    ];

    res.json({ results });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Arama yapılamadı' });
  }
});

// Reports - Clients
router.get('/api/reports/clients', requireAuth, async (req: AuthRequest, res) => {
  try {
    const orgId = req.orgId;
    const { format = 'json', startDate, endDate } = req.query;

    let where: any = { orgId };
    
    if (startDate && endDate) {
      where.createdAt = {
        gte: new Date(startDate as string),
        lte: new Date(endDate as string)
      };
    }

    const clients = await prisma.client.findMany({
      where,
      include: {
        _count: {
          select: {
            cases: true,
            invoices: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    const data = clients.map(c => ({
      'ID': c.id,
      'Ad Soyad': c.name,
      'E-posta': c.email || '',
      'Telefon': c.phone || '',
      'TC Kimlik': c.tcKimlik || '',
      'Vergi No': c.vergiNo || '',
      'Adres': c.address || '',
      'Dava Sayısı': c._count.cases,
      'Fatura Sayısı': c._count.invoices,
      'Kayıt Tarihi': c.createdAt.toLocaleDateString('tr-TR')
    }));

    if (format === 'csv') {
      const parser = new Parser();
      const csv = parser.parse(data);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="muvekiller.csv"');
      res.send('\uFEFF' + csv); // UTF-8 BOM
    } else if (format === 'excel') {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Müvekiller');
      
      worksheet.columns = Object.keys(data[0] || {}).map(key => ({
        header: key,
        key: key,
        width: 20
      }));
      
      worksheet.addRows(data);
      
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="muvekiller.xlsx"');
      
      await workbook.xlsx.write(res);
      res.end();
    } else {
      res.json(data);
    }
  } catch (error) {
    console.error('Report error:', error);
    res.status(500).json({ error: 'Rapor oluşturulamadı' });
  }
});

// Reports - Cases
router.get('/api/reports/cases', requireAuth, async (req: AuthRequest, res) => {
  try {
    const orgId = req.orgId;
    const { format = 'json', status, startDate, endDate } = req.query;

    let where: any = { orgId };
    
    if (status) {
      where.status = status;
    }
    
    if (startDate && endDate) {
      where.createdAt = {
        gte: new Date(startDate as string),
        lte: new Date(endDate as string)
      };
    }

    const cases = await prisma.case.findMany({
      where,
      include: {
        client: true,
        _count: {
          select: {
            events: true,
            files: true,
            expenses: true,
            advances: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    const data = cases.map(c => ({
      'ID': c.id,
      'Dava No': c.caseNo || '',
      'Başlık': c.title,
      'Müvekkil': c.client.name,
      'Mahkeme': c.court || '',
      'Durum': c.status,
      'Etkinlik Sayısı': c._count.events,
      'Belge Sayısı': c._count.files,
      'Masraf Sayısı': c._count.expenses,
      'Avans Sayısı': c._count.advances,
      'Sonraki Duruşma': c.nextHearing?.toLocaleDateString('tr-TR') || '',
      'Kayıt Tarihi': c.createdAt.toLocaleDateString('tr-TR')
    }));

    if (format === 'csv') {
      const parser = new Parser();
      const csv = parser.parse(data);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="davalar.csv"');
      res.send('\uFEFF' + csv);
    } else if (format === 'excel') {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Davalar');
      
      worksheet.columns = Object.keys(data[0] || {}).map(key => ({
        header: key,
        key: key,
        width: 20
      }));
      
      worksheet.addRows(data);
      
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="davalar.xlsx"');
      
      await workbook.xlsx.write(res);
      res.end();
    } else {
      res.json(data);
    }
  } catch (error) {
    console.error('Report error:', error);
    res.status(500).json({ error: 'Rapor oluşturulamadı' });
  }
});

// Reports - Events
router.get('/api/reports/events', requireAuth, async (req: AuthRequest, res) => {
  try {
    const orgId = req.orgId;
    const { format = 'json', type, startDate, endDate } = req.query;

    let where: any = { orgId };
    
    if (type) {
      where.type = type;
    }
    
    if (startDate && endDate) {
      where.startAt = {
        gte: new Date(startDate as string),
        lte: new Date(endDate as string)
      };
    }

    const events = await prisma.event.findMany({
      where,
      include: {
        case: {
          include: {
            client: true
          }
        },
        createdBy: true
      },
      orderBy: { startAt: 'asc' }
    });

    const data = events.map(e => ({
      'ID': e.id,
      'Başlık': e.title,
      'Tip': e.type,
      'Dava': e.case?.title || '',
      'Müvekkil': e.case?.client?.name || '',
      'Başlangıç': e.startAt.toLocaleString('tr-TR'),
      'Bitiş': e.endAt?.toLocaleString('tr-TR') || '',
      'Konum': e.location || '',
      'Oluşturan': e.createdBy.name || e.createdBy.email,
      'Kayıt Tarihi': e.createdAt.toLocaleDateString('tr-TR')
    }));

    if (format === 'csv') {
      const parser = new Parser();
      const csv = parser.parse(data);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="etkinlikler.csv"');
      res.send('\uFEFF' + csv);
    } else if (format === 'excel') {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Etkinlikler');
      
      worksheet.columns = Object.keys(data[0] || {}).map(key => ({
        header: key,
        key: key,
        width: 20
      }));
      
      worksheet.addRows(data);
      
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="etkinlikler.xlsx"');
      
      await workbook.xlsx.write(res);
      res.end();
    } else {
      res.json(data);
    }
  } catch (error) {
    console.error('Report error:', error);
    res.status(500).json({ error: 'Rapor oluşturulamadı' });
  }
});

// Reports - Invoices
router.get('/api/reports/invoices', requireAuth, async (req: AuthRequest, res) => {
  try {
    const orgId = req.orgId;
    const { format = 'json', status, startDate, endDate } = req.query;

    let where: any = { orgId };
    
    if (status) {
      where.status = status;
    }
    
    if (startDate && endDate) {
      where.date = {
        gte: new Date(startDate as string),
        lte: new Date(endDate as string)
      };
    }

    const invoices = await prisma.invoice.findMany({
      where,
      include: {
        client: true,
        creator: true
      },
      orderBy: { date: 'desc' }
    });

    const data = invoices.map(i => ({
      'Fatura No': i.invoiceNo,
      'Müvekkil': i.client.name,
      'Tarih': i.date.toLocaleDateString('tr-TR'),
      'Vade': i.dueDate?.toLocaleDateString('tr-TR') || '',
      'Ara Toplam': i.amount.toNumber(),
      'KDV': i.tax?.toNumber() || 0,
      'Genel Toplam': i.totalAmount.toNumber(),
      'Durum': i.status,
      'Ödeme Tarihi': i.paidAt?.toLocaleDateString('tr-TR') || '',
      'Oluşturan': i.creator.name || i.creator.email
    }));

    if (format === 'csv') {
      const parser = new Parser();
      const csv = parser.parse(data);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="faturalar.csv"');
      res.send('\uFEFF' + csv);
    } else if (format === 'excel') {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Faturalar');
      
      worksheet.columns = Object.keys(data[0] || {}).map(key => ({
        header: key,
        key: key,
        width: 20
      }));
      
      worksheet.addRows(data);
      
      // Format currency columns
      const currencyColumns = ['Ara Toplam', 'KDV', 'Genel Toplam'];
      currencyColumns.forEach(col => {
        const colIndex = worksheet.columns.findIndex(c => c.header === col);
        if (colIndex >= 0) {
          worksheet.getColumn(colIndex + 1).numFmt = '₺#,##0.00';
        }
      });
      
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="faturalar.xlsx"');
      
      await workbook.xlsx.write(res);
      res.end();
    } else {
      res.json(data);
    }
  } catch (error) {
    console.error('Report error:', error);
    res.status(500).json({ error: 'Rapor oluşturulamadı' });
  }
});

// Reports - Time Entries
router.get('/api/reports/time-entries', requireAuth, async (req: AuthRequest, res) => {
  try {
    const orgId = req.orgId;
    const { format = 'json', caseId, userId, startDate, endDate } = req.query;

    // Get cases for org isolation
    const orgCases = await prisma.case.findMany({
      where: { orgId },
      select: { id: true }
    });
    
    let where: any = {
      caseId: { in: orgCases.map(c => c.id) }
    };
    
    if (caseId) {
      where.caseId = parseInt(caseId as string);
    }
    
    if (userId) {
      where.userId = parseInt(userId as string);
    }
    
    if (startDate && endDate) {
      where.startTime = {
        gte: new Date(startDate as string),
        lte: new Date(endDate as string)
      };
    }

    const entries = await prisma.timeEntry.findMany({
      where,
      include: {
        user: true,
        case: {
          include: {
            client: true
          }
        }
      },
      orderBy: { startTime: 'desc' }
    });

    const data = entries.map(e => ({
      'ID': e.id,
      'Dava': e.case.title,
      'Müvekkil': e.case.client.name,
      'Kullanıcı': e.user.name || e.user.email,
      'Başlangıç': e.startTime.toLocaleString('tr-TR'),
      'Bitiş': e.endTime?.toLocaleString('tr-TR') || '',
      'Süre (dk)': e.duration || 0,
      'Süre (saat)': ((e.duration || 0) / 60).toFixed(2),
      'Saat Ücreti': e.rate?.toNumber() || 0,
      'Toplam': ((e.duration || 0) / 60 * (e.rate?.toNumber() || 0)).toFixed(2),
      'Açıklama': e.description || ''
    }));

    if (format === 'csv') {
      const parser = new Parser();
      const csv = parser.parse(data);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="zaman-kayitlari.csv"');
      res.send('\uFEFF' + csv);
    } else if (format === 'excel') {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Zaman Kayıtları');
      
      worksheet.columns = Object.keys(data[0] || {}).map(key => ({
        header: key,
        key: key,
        width: 20
      }));
      
      worksheet.addRows(data);
      
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="zaman-kayitlari.xlsx"');
      
      await workbook.xlsx.write(res);
      res.end();
    } else {
      res.json(data);
    }
  } catch (error) {
    console.error('Report error:', error);
    res.status(500).json({ error: 'Rapor oluşturulamadı' });
  }
});

export default router;