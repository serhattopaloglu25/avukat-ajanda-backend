import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

const router = Router();
const prisma = new PrismaClient();

// Validation schemas
const registerSchema = z.object({
  email: z.string().email('Geçersiz email'),
  password: z.string().min(6, 'Şifre en az 6 karakter olmalı'),
  name: z.string().optional()
});

const loginSchema = z.object({
  email: z.string().email('Geçersiz email'),
  password: z.string()
});

// Register endpoint
router.post('/auth/register', async (req, res) => {
  try {
    console.log('Register request:', req.body);
    
    const validatedData = registerSchema.parse(req.body);
    
    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { email: validatedData.email }
    });

    if (existingUser) {
      return res.status(400).json({ error: 'Bu email zaten kayıtlı' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(validatedData.password, 10);

    // Create user - SADECE passwordHash kullan
    const user = await prisma.user.create({
      data: {
        email: validatedData.email,
        passwordHash: passwordHash,  // Sadece passwordHash
        name: validatedData.name
      },
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true
      }
    });
    console.log('User created:', user);

    // Generate JWT
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET || 'dev-secret-key',
      { expiresIn: '7d' }
    );

    res.status(201).json({
      token,
      user
    });
  } catch (error: any) {
    console.error('Register error:', error);
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({ 
        error: 'Geçersiz veri',
        details: error.errors 
      });
    }
    
    res.status(500).json({ error: 'Kayıt oluşturulamadı' });
  }
});

// Login endpoint
router.post('/auth/login', async (req, res) => {
  try {
    const validatedData = loginSchema.parse(req.body);

    // Find user
    const user = await prisma.user.findUnique({
      where: { email: validatedData.email }
    });

    if (!user) {
      return res.status(401).json({ error: 'Geçersiz email veya şifre' });
    }

    // Verify password - sadece passwordHash kullan
    const validPassword = await bcrypt.compare(
      validatedData.password, 
      user.passwordHash
    );
    
    if (!validPassword) {
      return res.status(401).json({ error: 'Geçersiz email veya şifre' });
    }

    // Generate JWT
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET || 'dev-secret-key',
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        createdAt: user.createdAt
      }
    });
  } catch (error: any) {
    console.error('Login error:', error);
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({ 
        error: 'Geçersiz veri',
        details: error.errors 
      });
    }
    
    res.status(500).json({ error: 'Giriş yapılamadı' });
  }
});

export default router;
