// Quick-reply templates — saved canned replies for the inbox.
import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { ApiError } from '../lib/errors';

const router = Router();
router.use(requireAuth);

// GET /api/templates — this tenant's saved replies
router.get('/', async (req, res, next) => {
  try {
    const templates = await prisma.template.findMany({
      where: { tenantId: req.tenantId },
      orderBy: { createdAt: 'asc' },
    });
    res.json(templates);
  } catch (err) { next(err); }
});

// POST /api/templates  { title, body }
router.post('/', async (req, res, next) => {
  try {
    const title = String(req.body.title || '').trim();
    const body = String(req.body.body || '').trim();
    if (!title || !body) throw new ApiError(400, 'title and body are required');
    const template = await prisma.template.create({
      data: { tenantId: req.tenantId, title, body },
    });
    res.status(201).json(template);
  } catch (err) { next(err); }
});

// PATCH /api/templates/:id  { title?, body? }
router.patch('/:id', async (req, res, next) => {
  try {
    const existing = await prisma.template.findFirst({ where: { id: req.params.id, tenantId: req.tenantId } });
    if (!existing) throw new ApiError(404, 'Template not found');
    const data: { title?: string; body?: string } = {};
    if (req.body.title !== undefined) data.title = String(req.body.title).trim();
    if (req.body.body !== undefined) data.body = String(req.body.body).trim();
    const template = await prisma.template.update({ where: { id: existing.id }, data });
    res.json(template);
  } catch (err) { next(err); }
});

// DELETE /api/templates/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const existing = await prisma.template.findFirst({ where: { id: req.params.id, tenantId: req.tenantId } });
    if (!existing) throw new ApiError(404, 'Template not found');
    await prisma.template.delete({ where: { id: existing.id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
