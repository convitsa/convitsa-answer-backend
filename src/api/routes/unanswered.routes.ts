import { Hono } from 'hono';
import { Types } from 'mongoose';
import { authMiddleware } from '../middleware/auth.middleware';
import { Project, UnansweredQuestion } from '../../db/schemas';
import { UnansweredQuestionService } from '../../services/unanswered-question.service';
import type { UnansweredQuestionStatus } from '../../types';

const unanswered = new Hono();

// All routes require authentication
unanswered.use('*', authMiddleware);

/**
 * Helper to verify project ownership
 */
async function verifyProjectOwnership(userId: string, projectId: string) {
  const project = await Project.findOne({
    _id: new Types.ObjectId(projectId),
    userId: new Types.ObjectId(userId),
  });
  return project;
}

/**
 * GET /projects/:projectId/questions
 * List unanswered questions for a project
 */
unanswered.get('/:projectId/questions', async (c) => {
  const user = c.get('user');
  const projectId = c.req.param('projectId');
  const page = parseInt(c.req.query('page') || '1', 10);
  const limit = Math.min(parseInt(c.req.query('limit') || '20', 10), 100);
  const status = c.req.query('status') as UnansweredQuestionStatus | undefined;

  // Verify ownership
  const project = await verifyProjectOwnership(user.userId, projectId);
  if (!project) {
    return c.json({ error: 'Project not found', code: 'NOT_FOUND' }, 404);
  }

  const result = await UnansweredQuestionService.getQuestions(
    new Types.ObjectId(projectId),
    { status },
    page,
    limit
  );

  return c.json({
    questions: result.questions.map((q) => ({
      id: q._id.toString(),
      question: q.question,
      aiResponse: q.aiResponse,
      status: q.status,
      businessAnswer: q.businessAnswer,
      answeredAt: q.answeredAt,
      createdAt: q.createdAt,
    })),
    total: result.total,
    page,
    limit,
    totalPages: result.pages,
  });
});

/**
 * GET /projects/:projectId/questions/:questionId
 * Get a single question by ID
 */
unanswered.get('/:projectId/questions/:questionId', async (c) => {
  const user = c.get('user');
  const projectId = c.req.param('projectId');
  const questionId = c.req.param('questionId');

  // Verify ownership
  const project = await verifyProjectOwnership(user.userId, projectId);
  if (!project) {
    return c.json({ error: 'Project not found', code: 'NOT_FOUND' }, 404);
  }

  const question = await UnansweredQuestionService.getQuestionById(new Types.ObjectId(questionId));

  if (!question || question.projectId.toString() !== projectId) {
    return c.json({ error: 'Question not found', code: 'NOT_FOUND' }, 404);
  }

  return c.json({
    question: {
      id: question._id.toString(),
      question: question.question,
      aiResponse: question.aiResponse,
      status: question.status,
      businessAnswer: question.businessAnswer,
      answeredBy: question.answeredBy?.toString(),
      answeredAt: question.answeredAt,
      createdAt: question.createdAt,
    },
  });
});

/**
 * POST /projects/:projectId/questions/:questionId/answer
 * Submit an answer for a question (embeds to knowledge base)
 */
unanswered.post('/:projectId/questions/:questionId/answer', async (c) => {
  const user = c.get('user');
  const projectId = c.req.param('projectId');
  const questionId = c.req.param('questionId');

  // Verify ownership
  const project = await verifyProjectOwnership(user.userId, projectId);
  if (!project) {
    return c.json({ error: 'Project not found', code: 'NOT_FOUND' }, 404);
  }

  // Verify question belongs to project
  const existingQuestion = await UnansweredQuestion.findOne({
    _id: new Types.ObjectId(questionId),
    projectId: new Types.ObjectId(projectId),
  });

  if (!existingQuestion) {
    return c.json({ error: 'Question not found', code: 'NOT_FOUND' }, 404);
  }

  if (existingQuestion.status === 'answered') {
    return c.json({ error: 'Question already answered', code: 'ALREADY_ANSWERED' }, 400);
  }

  const body = await c.req.json();
  const { answer } = body;

  if (!answer || typeof answer !== 'string' || answer.trim().length === 0) {
    return c.json({ error: 'Answer is required', code: 'VALIDATION_ERROR' }, 400);
  }

  if (answer.length > 5000) {
    return c.json({ error: 'Answer is too long (max 5000 characters)', code: 'VALIDATION_ERROR' }, 400);
  }

  const question = await UnansweredQuestionService.answerQuestion(
    new Types.ObjectId(questionId),
    answer.trim(),
    new Types.ObjectId(user.userId)
  );

  if (!question) {
    return c.json({ error: 'Failed to answer question', code: 'UPDATE_FAILED' }, 500);
  }

  return c.json({
    message: 'Question answered and added to knowledge base',
    question: {
      id: question._id.toString(),
      question: question.question,
      businessAnswer: question.businessAnswer,
      status: question.status,
      answeredAt: question.answeredAt,
    },
  });
});

/**
 * PATCH /projects/:projectId/questions/:questionId/ignore
 * Mark a question as ignored
 */
unanswered.patch('/:projectId/questions/:questionId/ignore', async (c) => {
  const user = c.get('user');
  const projectId = c.req.param('projectId');
  const questionId = c.req.param('questionId');

  // Verify ownership
  const project = await verifyProjectOwnership(user.userId, projectId);
  if (!project) {
    return c.json({ error: 'Project not found', code: 'NOT_FOUND' }, 404);
  }

  // Verify question belongs to project
  const existingQuestion = await UnansweredQuestion.findOne({
    _id: new Types.ObjectId(questionId),
    projectId: new Types.ObjectId(projectId),
  });

  if (!existingQuestion) {
    return c.json({ error: 'Question not found', code: 'NOT_FOUND' }, 404);
  }

  const question = await UnansweredQuestionService.ignoreQuestion(new Types.ObjectId(questionId));

  if (!question) {
    return c.json({ error: 'Failed to ignore question', code: 'UPDATE_FAILED' }, 500);
  }

  return c.json({
    message: 'Question marked as ignored',
    question: {
      id: question._id.toString(),
      status: question.status,
    },
  });
});

/**
 * DELETE /projects/:projectId/questions/:questionId
 * Delete a question
 */
unanswered.delete('/:projectId/questions/:questionId', async (c) => {
  const user = c.get('user');
  const projectId = c.req.param('projectId');
  const questionId = c.req.param('questionId');

  // Verify ownership
  const project = await verifyProjectOwnership(user.userId, projectId);
  if (!project) {
    return c.json({ error: 'Project not found', code: 'NOT_FOUND' }, 404);
  }

  // Verify question belongs to project
  const existingQuestion = await UnansweredQuestion.findOne({
    _id: new Types.ObjectId(questionId),
    projectId: new Types.ObjectId(projectId),
  });

  if (!existingQuestion) {
    return c.json({ error: 'Question not found', code: 'NOT_FOUND' }, 404);
  }

  await UnansweredQuestionService.deleteQuestion(new Types.ObjectId(questionId));

  return c.json({ message: 'Question deleted successfully' });
});

/**
 * GET /projects/:projectId/questions/stats
 * Get statistics for unanswered questions
 */
unanswered.get('/:projectId/questions/stats', async (c) => {
  const user = c.get('user');
  const projectId = c.req.param('projectId');

  // Verify ownership
  const project = await verifyProjectOwnership(user.userId, projectId);
  if (!project) {
    return c.json({ error: 'Project not found', code: 'NOT_FOUND' }, 404);
  }

  const stats = await UnansweredQuestionService.getStats(new Types.ObjectId(projectId));

  return c.json({ stats });
});

export { unanswered as unansweredRoutes };
