// tests/fixtures/verify/source/admin.js
// Phase 112-02 fixture — DO NOT EDIT (the literal substring on the
// router.get line is referenced by the seeder as connection #3's evidence).
import { Router } from 'express';
const router = Router();
router.get('/admin/dashboard', async (req, res) => {
  res.json({ ok: true });
});
export default router;
