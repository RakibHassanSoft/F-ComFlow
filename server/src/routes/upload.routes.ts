// Product image uploads — Cloudinary signed direct-upload.
//
// GET /api/uploads/signature -> a short-lived signature the browser uses to
// POST an image straight to Cloudinary (see client/src/lib/upload.ts). Auth is
// required so only logged-in merchants can mint upload signatures.
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
