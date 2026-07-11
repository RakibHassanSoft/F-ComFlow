// Phase 4: Product catalog CRUD + low-stock visibility.
import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { ApiError } from '../lib/errors';

const router = Router();
router.use(requireAuth);

// GET /api/products — the tenant's catalog
router.get('/', async (req, res, next) => {
  try {
    const products = await prisma.product.findMany({
      where: { tenantId: req.tenantId },
      orderBy: { name: 'asc' },
    });
    res.json(products);
  } catch (err) { next(err); }
});

// POST /api/products — add a product
router.post('/', async (req, res, next) => {
  try {
    const { sku, name, price, stockQuantity, reorderThreshold } = req.body;
    if (!sku || !name || price == null) throw new ApiError(400, 'sku, name and price are required');
    if (Number(price) < 0 || Number(stockQuantity) < 0) throw new ApiError(400, 'Values cannot be negative');

    const product = await prisma.product.create({
      data: {
        tenantId: req.tenantId,
        sku,
        name,
        price: Number(price),
        stockQuantity: Number(stockQuantity) || 0,
        reorderThreshold: Number(reorderThreshold) || 5,
      },
    });
    res.status(201).json(product);
  } catch (err: any) {
    if (err?.code === 'P2002') return next(new ApiError(409, 'That SKU already exists'));
    next(err);
  }
});

// PATCH /api/products/:id — edit / restock
router.patch('/:id', async (req, res, next) => {
  try {
    const existing = await prisma.product.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId },
    });
    if (!existing) throw new ApiError(404, 'Product not found');

    const { name, price, stockQuantity, reorderThreshold } = req.body;
    const newStock = stockQuantity != null ? Number(stockQuantity) : existing.stockQuantity;
    if (newStock < 0) throw new ApiError(400, 'Stock cannot be negative');

    const product = await prisma.product.update({
      where: { id: existing.id },
      data: {
        name: name ?? existing.name,
        price: price != null ? Number(price) : existing.price,
        stockQuantity: newStock,
        reorderThreshold: reorderThreshold != null ? Number(reorderThreshold) : existing.reorderThreshold,
        // Restocking above the threshold re-arms the low-stock alert (Phase 4 exit gate)
        lowStockAlerted: newStock > (reorderThreshold ?? existing.reorderThreshold) ? false : existing.lowStockAlerted,
      },
    });
    res.json(product);
  } catch (err) { next(err); }
});

export default router;
