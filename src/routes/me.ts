import { Router } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = Router();

router.get('/me', requireAuth, async (req: AuthRequest, res) => {
  res.json({ 
    user: {
      id: req.user.id,
      email: req.user.email,
      name: req.user.name,
      memberships: req.user.memberships,
    }
  });
});

export default router;
