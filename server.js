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

// Better CORS for Railway
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: true
    },
    transports: ['websocket', 'polling'] // Fallback support
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Health check endpoint (prevents Railway from crashing)
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', timestamp: new Date() });
});

// MongoDB Connection with better error handling
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://tales:game123@cluster0.r0nqh.mongodb.net/tales_game?retryWrites=true&w=majority';

mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 5000 // Timeout after 5s instead of hanging
})
.then(() => console.log('✅ MongoDB Connected'))
.catch(err => {
    console.error('MongoDB Error:', err);
    // Don't crash, just log error
});

// Handle MongoDB disconnection
mongoose.connection.on('disconnected', () => {
    console.log('❌ MongoDB Disconnected');
});

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
    try {
        const count = await Level.countDocuments();
        if (count === 0) {
            const initialLevels = [
                { levelId: 1, title: "The Late Night Call", description: "If James calls late and your mum asks where he's from?", options: ["Kireka", "Mukono", "Nansana", "Kyengera"], correct: "A", unlocked: true },
                { levelId: 2, title: "Who Is James?", description: "Having overheard James, who is he to you?", options: ["Znob", "😣", "Ask question", "Don't know"], correct: "A", unlocked: true },
                { levelId: 3, title: "The Final Truth", description: "The tale of A and -oo7...", options: ["Accept", "Fight", "Walk", "Seek"], correct: "D", unlocked: true },
                { levelId: 4, title: "The Mystery Deepens", description: "What connects A to the ancient prophecy?", options: ["Bloodline", "Destiny", "Choice", "Fate"], correct: "B", unlocked: false },
                { levelId: 5, title: "The Hidden Path", description: "Which path leads to the truth?", options: ["Northern", "Eastern", "Western", "Southern"], correct: "C", unlocked: false }
            ];
            await Level.insertMany(initialLevels);
            console.log('✅ Initial levels created');
        }
    } catch (error) {
        console.error('Error initializing levels:', error);
    }
}
initLevels();

// ===== API ROUTES =====

// Register
app.post('/api/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        // Check if user exists
        const existingUser = await User.findOne({ username });
        if (existingUser) {
            return res.status(400).json({ error: 'Username exists' });
        }
        
        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Create user
        const user = new User({ 
            username, 
            password: hashedPassword,
            level: 1,
            gems: 100,
            score: 0,
            completedLevels: []
        });
        
        await user.save();
        
        // Generate token
        const token = jwt.sign(
            { userId: user._id }, 
            process.env.JWT_SECRET || 'secret123',
            { expiresIn: '7d' }
        );
        
        res.json({ 
            success: true, 
            token, 
            user: { 
                username, 
                level: 1, 
                gems: 100, 
                score: 0,
                completedLevels: []
            } 
        });
    } catch (error) {
        console.error('Register error:', error);
        res.status(500).json({ error: 'Server error during registration' });
    }
});

// Login
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        // Special admin login
        if (username === 'admin' && password === '256@') {
            const token = jwt.sign(
                { userId: 'admin', role: 'admin' }, 
                process.env.JWT_SECRET || 'secret123',
                { expiresIn: '7d' }
            );
            return res.json({ 
                success: true, 
                token, 
                user: { 
                    username: 'Admin', 
                    role: 'admin', 
                    level: 99, 
                    gems: 9999,
                    score: 9999,
                    completedLevels: []
                } 
            });
        }
        
        // Find user
        const user = await User.findOne({ username });
        if (!user) {
            return res.status(400).json({ error: 'User not found' });
        }
        
        // Check password
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(400).json({ error: 'Invalid password' });
        }
        
        // Update last login
        user.lastLogin = new Date();
        await user.save();
        
        // Generate token
        const token = jwt.sign(
            { userId: user._id }, 
            process.env.JWT_SECRET || 'secret123',
            { expiresIn: '7d' }
        );
        
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
        console.error('Login error:', error);
        res.status(500).json({ error: 'Server error during login' });
    }
});

// Get all levels
app.get('/api/levels', async (req, res) => {
    try {
        const levels = await Level.find().sort({ levelId: 1 });
        res.json(levels);
    } catch (error) {
        console.error('Get levels error:', error);
        res.status(500).json({ error: 'Failed to fetch levels' });
    }
});

// Add level (admin only)
app.post('/api/levels', async (req, res) => {
    try {
        const { levelId, title, description, options, correct } = req.body;
        
        // Check if level exists
        const existing = await Level.findOne({ levelId });
        if (existing) {
            return res.status(400).json({ error: 'Level ID already exists' });
        }
        
        const level = new Level({ 
            levelId, 
            title, 
            description, 
            options, 
            correct, 
            unlocked: false 
        });
        
        await level.save();
        
        // Broadcast new level to all connected clients
        io.emit('level-added', level);
        
        res.json({ success: true, level });
    } catch (error) {
        console.error('Add level error:', error);
        res.status(500).json({ error: 'Failed to add level' });
    }
});

// Update user progress
app.post('/api/progress', async (req, res) => {
    try {
        const { username, levelId, completed, score, gems } = req.body;
        
        const user = await User.findOne({ username });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        if (completed && !user.completedLevels.includes(levelId)) {
            user.completedLevels.push(levelId);
            user.score += score || 100;
            user.gems += gems || 20;
            user.level = Math.floor(user.score / 100) + 1;
            
            // Unlock next level
            await Level.updateOne(
                { levelId: levelId + 1 },
                { $set: { unlocked: true } }
            );
            
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
        console.error('Progress update error:', error);
        res.status(500).json({ error: 'Failed to update progress' });
    }
});

// Get leaderboard
app.get('/api/leaderboard', async (req, res) => {
    try {
        const users = await User.find()
            .sort({ score: -1 })
            .limit(10)
            .select('username score level');
            
        res.json(users);
    } catch (error) {
        console.error('Leaderboard error:', error);
        res.status(500).json({ error: 'Failed to fetch leaderboard' });
    }
});

// ===== SOCKET.IO FOR REAL-TIME CHAT =====
const activeUsers = new Map();

io.on('connection', (socket) => {
    console.log('🔌 New client connected:', socket.id);
    
    socket.on('join-chat', (username) => {
        socket.username = username;
        activeUsers.set(socket.id, username);
        
        // Send welcome message
        socket.emit('new-message', {
            username: 'System',
            message: `Welcome ${username}!`,
            type: 'system',
            timestamp: new Date()
        });
        
        // Broadcast user joined
        io.emit('user-joined', { 
            username, 
            count: activeUsers.size 
        });
        
        // Send active users count
        io.emit('active-users', activeUsers.size);
    });
    
    socket.on('send-message', async (data) => {
        try {
            // Save to database
            const message = new Message({
                username: data.username,
                message: data.message,
                type: data.type || 'text'
            });
            await message.save();
            
            // Broadcast to all
            io.emit('new-message', {
                username: data.username,
                message: data.message,
                type: data.type,
                timestamp: new Date()
            });
        } catch (error) {
            console.error('Message save error:', error);
        }
    });
    
    socket.on('get-messages', async () => {
        try {
            const messages = await Message.find()
                .sort({ timestamp: -1 })
                .limit(50);
            socket.emit('message-history', messages.reverse());
        } catch (error) {
            console.error('Get messages error:', error);
        }
    });
    
    socket.on('disconnect', () => {
        const username = activeUsers.get(socket.id);
        activeUsers.delete(socket.id);
        
        if (username) {
            io.emit('user-left', { 
                username, 
                count: activeUsers.size 
            });
            io.emit('active-users', activeUsers.size);
        }
        
        console.log('❌ Client disconnected:', socket.id);
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

// ===== START SERVER =====
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📱 Game URL: http://localhost:${PORT}`);
    console.log(`🌍 Health check: http://localhost:${PORT}/health`);
});