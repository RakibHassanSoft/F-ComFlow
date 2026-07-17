// Product image uploads — hands out a short-lived Cloudinary upload signature.
import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { ApiError } from '../lib/errors';
import { isCloudinaryEnabled, signUpload } from '../services/cloudinary';

const router = Router();
router.use(requireAuth);

router.get('/signature', (_req, res, next) => {
  try {
    if (!isCloudinaryEnabled()) {
      throw new ApiError(422, 'Image uploads are not configured on this server');
    }
    res.json(signUpload());
  } catch (err) { next(err); }
});

export default router;
