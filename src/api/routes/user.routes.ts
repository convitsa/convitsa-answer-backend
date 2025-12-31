import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth.middleware';
import { User } from '../../db/schemas';
import { CreditService } from '../../services/credit.service';

const users = new Hono();

// All routes require authentication
users.use('*', authMiddleware);

/**
 * GET /users/me
 * Get current user profile
 */
users.get('/me', async (c) => {
  const start = Date.now();
  const user = c.get('user');

  const userData = await User.findById(user.userId).select('-passwordHash').lean();
  console.log(`📊 /users/me DB query took ${Date.now() - start}ms`);

  if (!userData) {
    return c.json({ error: 'User not found', code: 'NOT_FOUND' }, 404);
  }

  return c.json({
    user: {
      id: userData._id.toString(),
      email: userData.email,
      emailVerified: userData.emailVerified,
      createdAt: userData.createdAt,
    },
  });
});

/**
 * GET /users/me/credits
 * Get credit balance and transaction history
 */
users.get('/me/credits', async (c) => {
  const user = c.get('user');

  const [balance, history] = await Promise.all([
    CreditService.getBalance(user.userId),
    CreditService.getTransactionHistory(user.userId, 1, 10),
  ]);

  return c.json({
    balance,
    recentTransactions: history.transactions,
  });
});

/**
 * GET /users/me/credits/history
 * Get full credit transaction history with pagination
 */
users.get('/me/credits/history', async (c) => {
  const user = c.get('user');
  const page = parseInt(c.req.query('page') || '1', 10);
  const limit = Math.min(parseInt(c.req.query('limit') || '20', 10), 100);

  const history = await CreditService.getTransactionHistory(user.userId, page, limit);

  return c.json({
    transactions: history.transactions,
    total: history.total,
    page,
    limit,
    totalPages: Math.ceil(history.total / limit),
  });
});

export { users as userRoutes };


