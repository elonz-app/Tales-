const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: true
    }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://tales:game123@cluster0.mongodb.net/tales_game?retryWrites=true&w=majority';
mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => console.log('✅ MongoDB Connected'))
  .catch(err => console.error('MongoDB Error:', err));

// ===== SCHEMAS =====
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    level: { type: Number, default: 1 },
    gems: { type: Number, default: 100 },
    score: { type: Number, default: 0 },
    completedLevels: [{ type: Number }],
    createdAt: { type: Date, default: Date.now },
    lastLogin: { type: Date, default: Date.now }
});

const levelSchema = new mongoose.Schema({
    levelId: { type: Number, required: true, unique: true },
    title: { type: String, required: true },
    description: { type: String, required: true },
    options: [{ type: String }],
    correct: { type: String, required: true },
    unlocked: { type: Boolean, default: false },
    createdBy: { type: String, default: 'system' },
    createdAt: { type: Date, default: Date.now }
});

const messageSchema = new mongoose.Schema({
    username: String,
    message: String,
    type: { type: String, default: 'text' },
    timestamp: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Level = mongoose.model('Level', levelSchema);
const Message = mongoose.model('Message', messageSchema);

// ===== INITIAL LEVELS =====
async function initLevels() {
    const count = await Level.countDocuments();
    if (count === 0) {
        const initialLevels = [
            { levelId: 1, title: "The Late Night Call", description: "If James calls late and your mum asks where he's from?", options: ["Kireka", "Mukono", "Nansana", "Kyengera"], correct: "D", unlocked: true },
            { levelId: 2, title: "Who Is James?", description: "Having overheard James, who is he to you?", options: ["Znob", "😣", "Ask question", "Don't know"], correct: "A", unlocked: true },
            { levelId: 3, title: "The Final Truth", description: "The tale of A and -oo7...", options: ["Accept", "Fight", "Walk", "Seek"], correct: "D", unlocked: true }
        ];
        await Level.insertMany(initialLevels);
        console.log('✅ Initial levels created');
    }
}
initLevels();

// ===== API ROUTES =====

// Register
app.post('/api/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        const existingUser = await User.findOne({ username });
        if (existingUser) {
            return res.status(400).json({ error: 'Username exists' });
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = new User({ username, password: hashedPassword });
        await user.save();
        
        const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET || 'secret123');
        res.json({ success: true, token, user: { username, level: 1, gems: 100, score: 0 } });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Login
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        // Special admin login
        if (username === 'admin' && password === '256@') {
            const token = jwt.sign({ userId: 'admin', role: 'admin' }, process.env.JWT_SECRET || 'secret123');
            return res.json({ success: true, token, user: { username: 'Admin', role: 'admin', level: 99, gems: 9999 } });
        }
        
        const user = await User.findOne({ username });
        if (!user) {
            return res.status(400).json({ error: 'User not found' });
        }
        
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(400).json({ error: 'Invalid password' });
        }
        
        user.lastLogin = new Date();
        await user.save();
        
        const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET || 'secret123');
        res.json({ 
            success: true, 
            token, 
            user: { 
                username: user.username, 
                level: user.level, 
                gems: user.gems, 
                score: user.score,
                completedLevels: user.completedLevels 
            } 
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get all levels
app.get('/api/levels', async (req, res) => {
    try {
        const levels = await Level.find().sort({ levelId: 1 });
        res.json(levels);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Add level (admin only)
app.post('/api/levels', async (req, res) => {
    try {
        const { levelId, title, description, options, correct } = req.body;
        const level = new Level({ levelId, title, description, options, correct, unlocked: false });
        await level.save();
        res.json({ success: true, level });
        
        // Broadcast new level to all connected clients
        io.emit('level-added', level);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update user progress
app.post('/api/progress', async (req, res) => {
    try {
        const { username, levelId, completed, score, gems } = req.body;
        const user = await User.findOne({ username });
        if (!user) return res.status(404).json({ error: 'User not found' });
        
        if (completed && !user.completedLevels.includes(levelId)) {
            user.completedLevels.push(levelId);
            user.score += score || 100;
            user.gems += gems || 20;
            user.level = Math.floor(user.score / 100) + 1;
            await user.save();
        }
        
        res.json({ 
            success: true, 
            level: user.level, 
            gems: user.gems, 
            score: user.score,
            completedLevels: user.completedLevels 
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get leaderboard
app.get('/api/leaderboard', async (req, res) => {
    try {
        const users = await User.find().sort({ score: -1 }).limit(10);
        res.json(users.map(u => ({ username: u.username, score: u.score, level: u.level })));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ===== SOCKET.IO FOR REAL-TIME CHAT =====
const activeUsers = new Map();

io.on('connection', (socket) => {
    console.log('🔌 New client connected:', socket.id);
    
    socket.on('join-chat', (username) => {
        socket.username = username;
        activeUsers.set(socket.id, username);
        io.emit('user-joined', { username, count: activeUsers.size });
    });
    
    socket.on('send-message', async (data) => {
        const message = new Message({
            username: data.username,
            message: data.message,
            type: data.type || 'text'
        });
        await message.save();
        
        io.emit('new-message', {
            username: data.username,
            message: data.message,
            type: data.type,
            timestamp: new Date()
        });
    });
    
    socket.on('get-messages', async () => {
        const messages = await Message.find().sort({ timestamp: -1 }).limit(50);
        socket.emit('message-history', messages.reverse());
    });
    
    socket.on('disconnect', () => {
        const username = activeUsers.get(socket.id);
        activeUsers.delete(socket.id);
        io.emit('user-left', { username, count: activeUsers.size });
        console.log('❌ Client disconnected:', socket.id);
    });
});

// ===== START SERVER =====
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📱 Game URL: http://localhost:${PORT}`);
});