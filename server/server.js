//server/server.js
import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import 'dotenv/config';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import requestIp from 'request-ip';

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '2h';

// Get the directory name
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:5173",
    methods: ["GET", "POST"]
  }
});

app.use(cors({
  origin: process.env.CLIENT_URL || "http://localhost:5173",
  credentials: true
}));
app.use(express.json());

const JWT_EXPIRES_IN_MS = 1000 * 60 * 60 * 2; // 2 hours

const PRIVATE_KEY = fs.readFileSync(
  path.resolve(__dirname, process.env.PRIVATE_KEY_PATH),
  'utf8'
);
const PUBLIC_KEY = fs.readFileSync(
  path.resolve(__dirname, process.env.PUBLIC_KEY_PATH),
  'utf8'
);

// Authentication middleware (RS‑256 only)
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  jwt.verify(token, PUBLIC_KEY, { algorithms: ['RS256'] }, (err, user) => {
    if (err) {
      return res.status(403).json({ message: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// In-memory storage for active rooms and participants
const rooms = new Map();
const participants = new Map();

console.log('→ Loaded DATABASE_URL =', process.env.DATABASE_URL);

// Database configuration
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/securedrive',
});

// Initialize database tables
const initializeDatabase = async () => {
  try {
    // Create podcast_sessions table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS podcast_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        host_id UUID NOT NULL,
        meeting_key TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        records_file_url TEXT,
        FOREIGN KEY (host_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `);
    
    console.log('Database tables initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
  }
};

// Initialize database on startup
initializeDatabase();

// Auth Routes
app.post('/api/auth/register', async (req, res) => {
  const { name, email, password } = req.body;
  
  try {
    // Check if user already exists
    const existingUser = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ message: 'User with this email already exists' });
    }
    
    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    // Create new user
    const result = await pool.query(
      'INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING id, name, email',
      [name, email, hashedPassword]
    );
    
    const user = result.rows[0];
    
    // Generate JWT token
    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email },
      PRIVATE_KEY,
      { algorithm: 'RS256', expiresIn: JWT_EXPIRES_IN }
    );
    
    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ message: 'Server error during registration' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password, deviceId } = req.body;

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);

    if (result.rows.length === 0) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    // Generate JWT ID and token
    const jwtId = uuidv4();
    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email, jti: jwtId },
      PRIVATE_KEY,
      { algorithm: 'RS256', expiresIn: JWT_EXPIRES_IN }
    );

    // Calculate expiry timestamp
    const now = new Date();
    const expiresAt = new Date(now.getTime() + JWT_EXPIRES_IN_MS);

    // Get IP Address
    const ipAddress = requestIp.getClientIp(req) || req.ip;

    // Insert into sessions table
    await pool.query(
      `INSERT INTO sessions (user_id, ip_address, device_id, jwt_id, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [user.id, ipAddress, deviceId, jwtId, expiresAt]
    );

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Server error during login' });
  }
});

app.post('/api/auth/logout', authenticateToken, async (req, res) => {
  try {
    console.log('→ [/api/auth/logout] handler invoked');

    const jwtId = req.user?.jti;
    if (!jwtId) {
      console.warn('→ [/api/auth/logout] no jti found on req.user');
      return res.status(400).json({ message: 'Invalid token: missing jti' });
    }

    const { rows: existingRows } = await pool.query(
      `SELECT id, jwt_id, revoked, created_at 
         FROM sessions 
        WHERE jwt_id = $1`,
      [jwtId]
    );
    console.log('→ [/api/auth/logout] lookup sessions by jwt_id:', existingRows);
    if (existingRows.length === 0) {
      console.warn(`→ [/api/auth/logout] no session row found for jwt_id = ${jwtId}`);
      return res.status(404).json({ message: 'Session not found (already revoked or invalid)' });
    }

    const updateResult = await pool.query(
      `UPDATE sessions
         SET revoked = true
       WHERE jwt_id = $1`,
      [jwtId]
    );
    console.log(`→ [/api/auth/logout] sessions rows updated:`, updateResult.rowCount);

    return res.json({ message: 'Logout successful' });
  } catch (err) {
    console.error('Logout error:', err);
    return res.status(500).json({ message: 'Server error during logout' });
  }
});

app.get('/api/auth/profile', authenticateToken, (req, res) => {
  res.json({
    user: {
      id: req.user.id,
      name: req.user.name,
      email: req.user.email,
    },
  });
});

// Meeting Routes
app.post('/api/meetings', authenticateToken, async (req, res) => {
  const { name } = req.body;
  const hostId = req.user.id;

  try {
    // Generate unique meeting key
    const meetingKey = generateMeetingKey();

    // Create meeting in database
    const result = await pool.query(
      `INSERT INTO podcast_sessions (name, host_id, meeting_key) 
       VALUES ($1, $2, $3) 
       RETURNING id, name, host_id, meeting_key, created_at`,
      [name, hostId, meetingKey]
    );

    const meeting = result.rows[0];

    res.status(201).json({
      id: meeting.id,
      name: meeting.name,
      meeting_key: meeting.meeting_key,
      host_id: meeting.host_id,
      created_at: meeting.created_at,
    });
  } catch (err) {
    console.error('Create meeting error:', err);
    res.status(500).json({ message: 'Failed to create meeting' });
  }
});

app.get('/api/meetings/:meetingKey', authenticateToken, async (req, res) => {
  const { meetingKey } = req.params;

  try {
    const result = await pool.query(
      `SELECT ps.*, u.name as host_name 
       FROM podcast_sessions ps 
       JOIN users u ON ps.host_id = u.id 
       WHERE ps.meeting_key = $1`,
      [meetingKey]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Meeting not found' });
    }

    const meeting = result.rows[0];
    res.json({
      id: meeting.id,
      name: meeting.name,
      meeting_key: meeting.meeting_key,
      host_id: meeting.host_id,
      host_name: meeting.host_name,
      created_at: meeting.created_at,
      records_file_url: meeting.records_file_url,
    });
  } catch (err) {
    console.error('Get meeting error:', err);
    res.status(500).json({ message: 'Failed to get meeting' });
  }
});

app.get('/api/meetings/user', authenticateToken, async (req, res) => {
  const userId = req.user.id;

  try {
    const result = await pool.query(
      `SELECT ps.*, u.name as host_name 
       FROM podcast_sessions ps 
       JOIN users u ON ps.host_id = u.id 
       WHERE ps.host_id = $1 
       ORDER BY ps.created_at DESC`,
      [userId]
    );

    const meetings = result.rows.map(meeting => ({
      id: meeting.id,
      name: meeting.name,
      meeting_key: meeting.meeting_key,
      host_id: meeting.host_id,
      host_name: meeting.host_name,
      created_at: meeting.created_at,
      records_file_url: meeting.records_file_url,
    }));

    res.json(meetings);
  } catch (err) {
    console.error('Get user meetings error:', err);
    res.status(500).json({ message: 'Failed to get meetings' });
  }
});

app.put('/api/meetings/:meetingKey/recording', authenticateToken, async (req, res) => {
  const { meetingKey } = req.params;
  const { recordsFileUrl } = req.body;

  try {
    const result = await pool.query(
      `UPDATE podcast_sessions 
       SET records_file_url = $1 
       WHERE meeting_key = $2 AND host_id = $3 
       RETURNING *`,
      [recordsFileUrl, meetingKey, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Meeting not found or unauthorized' });
    }

    res.json({ message: 'Recording URL updated successfully' });
  } catch (err) {
    console.error('Update recording error:', err);
    res.status(500).json({ message: 'Failed to update recording' });
  }
});

// Helper function to generate meeting key
function generateMeetingKey() {
  const chars = 'abcdefghijklmnopqrstuvwxyz';
  const segments = [];
  
  for (let i = 0; i < 3; i++) {
    let segment = '';
    for (let j = 0; j < 3; j++) {
      segment += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    segments.push(segment);
  }
  
  return segments.join('-');
}

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join-room', ({ meetingKey, userInfo }) => {
    console.log(`User ${socket.id} joining room ${meetingKey}`);
    
    socket.join(meetingKey);
    
    // Store participant info
    participants.set(socket.id, {
      socketId: socket.id,
      userId: userInfo.userId || socket.id,
      user: userInfo.user || { name: 'Anonymous' },
      audioEnabled: userInfo.audioEnabled || true,
      videoEnabled: userInfo.videoEnabled || true,
      meetingKey,
    });

    // Initialize room if it doesn't exist
    if (!rooms.has(meetingKey)) {
      rooms.set(meetingKey, new Set());
    }
    rooms.get(meetingKey).add(socket.id);

    // Get all participants in the room
    const roomParticipants = Array.from(rooms.get(meetingKey))
      .map(socketId => participants.get(socketId))
      .filter(Boolean);

    // Send current participants to the new user
    socket.emit('room-users', roomParticipants);

    // Notify others about the new participant
    socket.to(meetingKey).emit('user-joined', participants.get(socket.id));
  });

  socket.on('leave-room', ({ meetingKey }) => {
    console.log(`User ${socket.id} leaving room ${meetingKey}`);
    
    socket.leave(meetingKey);
    
    // Remove from room
    if (rooms.has(meetingKey)) {
      rooms.get(meetingKey).delete(socket.id);
      if (rooms.get(meetingKey).size === 0) {
        rooms.delete(meetingKey);
      }
    }

    // Notify others
    socket.to(meetingKey).emit('user-left', { socketId: socket.id });
    
    // Remove participant
    participants.delete(socket.id);
  });

  // WebRTC signaling
  socket.on('webrtc-offer', ({ meetingKey, offer, to }) => {
    socket.to(to).emit('webrtc-offer', {
      offer,
      from: socket.id,
      userId: participants.get(socket.id)?.userId,
    });
  });

  socket.on('webrtc-answer', ({ meetingKey, answer, to }) => {
    socket.to(to).emit('webrtc-answer', {
      answer,
      from: socket.id,
    });
  });

  socket.on('webrtc-ice-candidate', ({ meetingKey, candidate, to }) => {
    socket.to(to).emit('webrtc-ice-candidate', {
      candidate,
      from: socket.id,
    });
  });

  // Chat messages
  socket.on('chat-message', ({ meetingKey, message }) => {
    const participant = participants.get(socket.id);
    if (participant) {
      const chatMessage = {
        message,
        user: participant.user,
        timestamp: new Date().toISOString(),
      };
      
      io.to(meetingKey).emit('chat-message', chatMessage);
    }
  });

  // Screen sharing
  socket.on('start-screen-share', ({ meetingKey }) => {
    const participant = participants.get(socket.id);
    if (participant) {
      participant.isScreenSharing = true;
      socket.to(meetingKey).emit('user-started-screen-share', {
        userId: participant.userId,
        socketId: socket.id,
      });
    }
  });

  socket.on('stop-screen-share', ({ meetingKey }) => {
    const participant = participants.get(socket.id);
    if (participant) {
      participant.isScreenSharing = false;
      socket.to(meetingKey).emit('user-stopped-screen-share', {
        userId: participant.userId,
        socketId: socket.id,
      });
    }
  });

  // Recording
  socket.on('start-recording', ({ meetingKey }) => {
    const participant = participants.get(socket.id);
    if (participant) {
      io.to(meetingKey).emit('recording-started', {
        user: participant.user,
      });
    }
  });

  socket.on('stop-recording', ({ meetingKey }) => {
    const participant = participants.get(socket.id);
    if (participant) {
      io.to(meetingKey).emit('recording-stopped', {
        user: participant.user,
      });
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    
    // Clean up participant from all rooms
    const participant = participants.get(socket.id);
    if (participant) {
      const meetingKey = participant.meetingKey;
      
      // Remove from room
      if (rooms.has(meetingKey)) {
        rooms.get(meetingKey).delete(socket.id);
        if (rooms.get(meetingKey).size === 0) {
          rooms.delete(meetingKey);
        }
      }

      // Notify others
      socket.to(meetingKey).emit('user-left', { socketId: socket.id });
    }
    
    // Remove participant
    participants.delete(socket.id);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});