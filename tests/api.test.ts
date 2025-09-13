import request from 'supertest';
import app from '../src/app';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

describe('API Tests', () => {
  let authToken: string;
  let orgId: number;
  let userId: number;

  beforeAll(async () => {
    // Clean test database
    await prisma.$executeRaw`TRUNCATE TABLE "User", "Organization", "Membership" CASCADE`;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('Auth Endpoints', () => {
    test('POST /api/auth/register - should create new user', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'test@example.com',
          password: 'Test123!',
          name: 'Test User',
          orgName: 'Test Law Firm'
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('token');
      expect(res.body.user.email).toBe('test@example.com');
      
      authToken = res.body.token;
      orgId = res.body.user.membership.orgId;
      userId = res.body.user.id;
    });

    test('POST /api/auth/login - should login user', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'test@example.com',
          password: 'Test123!'
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('token');
    });

    test('POST /api/auth/login - should fail with wrong password', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'test@example.com',
          password: 'WrongPassword'
        });

      expect(res.status).toBe(401);
    });
  });

  describe('Client Endpoints', () => {
    let clientId: number;

    test('POST /api/clients - should create client', async () => {
      const res = await request(app)
        .post('/api/clients')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'John Doe',
          email: 'john@example.com',
          phone: '+905551234567',
          tcKimlik: '12345678901'
        });

      expect(res.status).toBe(201);
      expect(res.body.name).toBe('John Doe');
      clientId = res.body.id;
    });

    test('GET /api/clients - should list clients', async () => {
      const res = await request(app)
        .get('/api/clients')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.clients).toBeInstanceOf(Array);
      expect(res.body.clients.length).toBeGreaterThan(0);
    });
  });

  describe('Error Handling', () => {
    test('Should return 401 for unauthenticated requests', async () => {
      const res = await request(app)
        .get('/api/clients');

      expect(res.status).toBe(401);
    });

    test('Should return 404 for non-existent endpoints', async () => {
      const res = await request(app)
        .get('/api/nonexistent')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(404);
    });
  });
});