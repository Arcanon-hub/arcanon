// tests/fixtures/verify/source/orders.js
// Phase 112-02 fixture — DO NOT EDIT (the literal substring on the
// router.get line is referenced by the seeder as connection #2's evidence).
import { Router } from 'express';
const router = Router();
router.get('/orders', async (req, res) => {
  res.json([]);
});
export default router;
