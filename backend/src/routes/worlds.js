import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import { getPhase1MessagesViewForUser, getWorld } from '../services/worldService.js';
import { phase1Greeting } from './chat.js';

const router = express.Router();
router.use(authMiddleware);

router.get('/', (req, res) => {
  const worlds = db.prepare('SELECT * FROM worlds WHERE user_id = ? ORDER BY created_at DESC').all(req.userId);
  res.json(worlds);
});

router.post('/', (req, res) => {
  const { name, description, requirement, comment, user_display_name, locale } = req.body;
  if (!name || !user_display_name) return res.status(400).json({ error: '缺少必要欄位' });

  const id = uuidv4();
  db.prepare('INSERT INTO worlds (id, user_id, name, description, requirement, comment, user_display_name, locale) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, req.userId, name, description, requirement, comment, user_display_name, locale || 'en');

  res.json(db.prepare('SELECT * FROM worlds WHERE id = ?').get(id));
});

router.get('/:worldId', (req, res) => {
  const world = db.prepare('SELECT * FROM worlds WHERE id = ? AND user_id = ?').get(req.params.worldId, req.userId);
  if (!world) return res.status(404).json({ error: "Could not find the world." });
  res.json(world);
});

router.delete('/:worldId', (req, res) => {
  const world = db.prepare('SELECT id FROM worlds WHERE id = ? AND user_id = ?').get(req.params.worldId, req.userId);
  if (!world) return res.status(404).json({ error: "Could not find the world." });

  db.prepare('DELETE FROM rounds WHERE world_id = ?').run(req.params.worldId);
  db.prepare('DELETE FROM worlds WHERE id = ?').run(req.params.worldId);
  res.json({ ok: true });
});

// Rounds
router.get('/:worldId/rounds', (req, res) => {
  const world = db.prepare('SELECT id FROM worlds WHERE id = ? AND user_id = ?').get(req.params.worldId, req.userId);
  if (!world) return res.status(404).json({ error: "Could not find the world." });

  const rounds = db.prepare('SELECT * FROM rounds WHERE world_id = ? ORDER BY created_at DESC').all(req.params.worldId);
  res.json(rounds.map(r => ({
    ...r,
    phase1_messages: getPhase1MessagesViewForUser(JSON.parse(r.phase1_messages)),
    phase2_messages: JSON.parse(r.phase2_messages),
    pending_start_chat: r.pending_start_chat ? JSON.parse(r.pending_start_chat) : null,
    phase2_meta: r.phase2_meta ? JSON.parse(r.phase2_meta) : null,
    review: r.review ? JSON.parse(r.review) : null,
  })));
});

router.post('/:worldId/rounds', async (req, res) => {
  const item = db.prepare('SELECT id FROM worlds WHERE id = ? AND user_id = ?').get(req.params.worldId, req.userId);
  if (!item) return res.status(404).json({ error: "Could not find the world." });

  const id = uuidv4();
  db.prepare('INSERT INTO rounds (id, world_id) VALUES (?, ?)').run(id, req.params.worldId);
  const round = db.prepare('SELECT * FROM rounds WHERE id = ?').get(id);

  round.phase1_messages = [];
  round.phase2_messages = [];

  if (process.env.PHASE1_GREETING) {
    const ntimes = parseInt(process.env.PHASE1_GREETING);
    if (ntimes > 0) {
      const ret = db.prepare('SELECT count(id) AS round_count FROM rounds WHERE world_id = ? AND finished_at IS NOT NULL').get(req.params.worldId);
      if (ret.round_count < ntimes) {
        const world = getWorld(req.params.worldId);
        await phase1Greeting(world, round);
      }
    } else if (ntimes === -1) {
      const world = getWorld(req.params.worldId);
      await phase1Greeting(world, round);
    }
  }

  res.json({ ...round, phase1_messages: getPhase1MessagesViewForUser(round.phase1_messages) } );
});

router.get('/:worldId/rounds/:roundId', (req, res) => {
  const world = db.prepare('SELECT id FROM worlds WHERE id = ? AND user_id = ?').get(req.params.worldId, req.userId);
  if (!world) return res.status(404).json({ error: "Could not find the world." });

  const round = db.prepare('SELECT * FROM rounds WHERE id = ? AND world_id = ?').get(req.params.roundId, req.params.worldId);
  if (!round) return res.status(404).json({ error: "Round not found." });

  res.json({
    ...round,
    phase1_messages: getPhase1MessagesViewForUser(JSON.parse(round.phase1_messages)),
    phase2_messages: JSON.parse(round.phase2_messages),
    pending_start_chat: round.pending_start_chat ? JSON.parse(round.pending_start_chat) : null,
    phase2_meta: round.phase2_meta ? JSON.parse(round.phase2_meta) : null,
    review: round.review ? JSON.parse(round.review) : null,
  });
});

export default router;