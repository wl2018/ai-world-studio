import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

router.post('/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: '缺少帳號或密碼' });

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) return res.status(409).json({ error: '帳號已存在' });

  if (process.env.MAX_ACCOUNTS) {
    const max_accounts = parseInt(process.env.MAX_ACCOUNTS);
    const item = db.prepare('SELECT COUNT(id) as `count` FROM users').get();
    if (item.count >= max_accounts)
      return res.status(429).json({ error: '系統帳號數量已達上限' });
  }


  const hash = await bcrypt.hash(password, 10);
  const id = uuidv4();
  db.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)').run(id, username, hash);

  const token = jwt.sign({ userId: id }, process.env.JWT_SECRET || 'secret', { expiresIn: '7d' });
  res.json({ token, userId: id, username });
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return res.status(401).json({ error: '帳號或密碼錯誤' });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: '帳號或密碼錯誤' });

  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET || 'secret', { expiresIn: '7d' });
  res.json({ token, userId: user.id, username: user.username });
});

router.put('/password', authMiddleware, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: '缺少必要欄位' });
  if (newPassword.length < 6) return res.status(400).json({ error: '新密碼至少需要6個字元' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  if (!user) return res.status(404).json({ error: '使用者不存在' });

  const valid = await bcrypt.compare(currentPassword, user.password_hash);
  if (!valid) return res.status(401).json({ error: '目前密碼不正確' });

  const hash = await bcrypt.hash(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.userId);

  res.json({ success: true });
});

export default router;
