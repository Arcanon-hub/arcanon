// tests/fixtures/verify/source/users.js
// Phase 112-02 fixture — DO NOT EDIT (the literal substring on the
// router.post line is referenced by the seeder as connection #1's evidence).
import { Router } from 'express';
const router = Router();
router.post('/users', async (req, res) => {
  res.json({ id: 1 });
});
export default router;
