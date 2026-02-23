const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

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

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
});
app.use('/api/', limiter);

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/tales_game', {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => console.log('✅ MongoDB Connected'))
  .catch(err => console.error('MongoDB Connection Error:', err));

// ========== Database Schemas ==========

// User Schema
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    email: { type: String, unique: true, sparse: true },
    avatar: { type: String, default: 'default.png' },
    level: { type: Number, default: 1 },
    xp: { type: Number, default: 0 },
    gems: { type: Number, default: 100 },
    cluesSolved: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
    lastLogin: { type: Date },
    isOnline: { type: Boolean, default: false },
    currentRoom: { type: String, default: 'lobby' }
});

// Game Session Schema
const sessionSchema = new mongoose.Schema({
    sessionId: { type: String, required: true, unique: true },
    playerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    playerName: String,
    hostId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    hostName: String,
    status: { type: String, enum: ['waiting', 'active', 'completed'], default: 'waiting' },
    currentClue: { type: Number, default: 1 },
    score: { type: Number, default: 0 },
    hintsUsed: { type: Number, default: 0 },
    timeStarted: Date,
    timeCompleted: Date,
    messages: [{
        sender: String,
        message: String,
        timestamp: { type: Date, default: Date.now },
        type: { type: String, enum: ['text', 'hint', 'gift', 'system'], default: 'text' }
    }]
});

// Message Schema
const messageSchema = new mongoose.Schema({
    sessionId: { type: String, required: true },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    senderName: String,
    senderAvatar: String,
    message: String,
    type: { type: String, enum: ['text', 'hint', 'gift', 'system', 'emote'], default: 'text' },
    timestamp: { type: Date, default: Date.now },
    reactions: [{ userId: String, emoji: String }],
    isRead: { type: Boolean, default: false }
});

// Gift Schema
const giftSchema = new mongoose.Schema({
    name: String,
    description: String,
    icon: String,
    rarity: { type: String, enum: ['common', 'rare', 'epic', 'legendary'] },
    value: Number,
    effects: mongoose.Schema.Types.Mixed
});

// Player Inventory Schema
const inventorySchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', unique: true },
    gifts: [{
        giftId: { type: mongoose.Schema.Types.ObjectId, ref: 'Gift' },
        quantity: { type: Number, default: 1 },
        acquiredAt: { type: Date, default: Date.now }
    }],
    achievements: [{
        name: String,
        unlockedAt: Date
    }],
    totalScore: { type: Number, default: 0 }
});

// Question Schema (for host to answer)
const questionSchema = new mongoose.Schema({
    sessionId: String,
    playerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    playerName: String,
    question: String,
    answer: String,
    status: { type: String, enum: ['pending', 'answered'], default: 'pending' },
    askedAt: { type: Date, default: Date.now },
    answeredAt: Date,
    answeredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
});

// Host Reply Schema (for real-time AI or manual replies)
const hostReplySchema = new mongoose.Schema({
    keyword: String,
    response: String,
    category: String,
    emotion: String,
    giftReward: { type: mongoose.Schema.Types.ObjectId, ref: 'Gift' }
});

const User = mongoose.model('User', userSchema);
const Session = mongoose.model('Session', sessionSchema);
const Message = mongoose.model('Message', messageSchema);
const Gift = mongoose.model('Gift', giftSchema);
const Inventory = mongoose.model('Inventory', inventorySchema);
const Question = mongoose.model('Question', questionSchema);
const HostReply = mongoose.model('HostReply', hostReplySchema);

// ========== Gift Data ==========
const defaultGifts = [
    { name: 'Mystery Box', description: 'Contains a random surprise!', icon: '🎁', rarity: 'common', value: 10 },
    { name: 'Golden Key', description: 'Unlocks secret areas', icon: '🗝️', rarity: 'rare', value: 50 },
    { name: 'Crystal Ball', description: 'See the future... or hints', icon: '🔮', rarity: 'epic', value: 100 },
    { name: 'Phoenix Feather', description: 'Revive from mistakes', icon: '🪶', rarity: 'legendary', value: 500 },
    { name: 'Time Crystal', description: 'Pause the game timer', icon: '⏳', rarity: 'epic', value: 200 },
    { name: 'Truth Serum', description: 'Get an extra hint', icon: '🧪', rarity: 'rare', value: 75 },
    { name: 'Shadow Cloak', description: 'Hide your presence', icon: '🧥', rarity: 'legendary', value: 1000 },
    { name: 'Memory Orb', description: 'Recall past clues', icon: '🔮', rarity: 'epic', value: 150 }
];

// Initialize gifts
async function initGifts() {
    const count = await Gift.countDocuments();
    if (count === 0) {
        await Gift.insertMany(defaultGifts);
        console.log('✅ Default gifts created');
    }
}

// ========== Host Reply Data ==========
const hostReplies = [
    { keyword: 'james', response: 'James... ah yes, the one who calls late at night. His name reversed holds the truth.', category: 'clue', emotion: 'mysterious' },
    { keyword: 'bonz', response: 'You found it! Znob reversed is Bonz. You\'re getting closer to the truth!', category: 'success', emotion: 'excited', giftReward: 'Golden Key' },
    { keyword: 'kyengera', response: 'Correct! James comes from Kyengera. Now who could he be?', category: 'clue', emotion: 'pleased' },
    { keyword: 'love', response: 'Love in the shadows is complicated. A\' and -oo7\'s story teaches us that.', category: 'story', emotion: 'nostalgic' },
    { keyword: 'truth', response: 'The truth is like light - sometimes blinding, sometimes subtle. Keep seeking.', category: 'philosophical', emotion: 'wise' },
    { keyword: 'help', response: 'I\'m here to guide you. Ask me anything about the story or clues.', category: 'assistance', emotion: 'helpful' },
    { keyword: 'gift', response: 'Ah, you\'ve earned something special! *grants you a mystery box*', category: 'reward', emotion: 'generous', giftReward: 'Mystery Box' }
];

async function initHostReplies() {
    const count = await HostReply.countDocuments();
    if (count === 0) {
        await HostReply.insertMany(hostReplies);
        console.log('✅ Host replies initialized');
    }
}

// ========== Socket.IO with Real-time Features ==========

// Active players map
const activePlayers = new Map();
const gameRooms = new Map();

io.use(async (socket, next) => {
    const token = socket.handshake.auth.token;
    if (token) {
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
            socket.userId = decoded.userId;
            socket.username = decoded.username;
        } catch (err) {
            console.log('Invalid token');
        }
    }
    next();
});

io.on('connection', (socket) => {
    console.log(`🎮 Player connected: ${socket.id} ${socket.username || 'Guest'}`);
    
    // Track active player
    if (socket.userId) {
        activePlayers.set(socket.userId, {
            socketId: socket.id,
            username: socket.username,
            joinTime: Date.now()
        });
        User.findByIdAndUpdate(socket.userId, { isOnline: true, lastLogin: Date.now() }).exec();
    }
    
    // Join game room
    socket.on('join-game', async (data) => {
        const { sessionId, playerName } = data;
        const roomName = `game-${sessionId}`;
        
        socket.join(roomName);
        
        // Find or create session
        let session = await Session.findOne({ sessionId });
        if (!session) {
            session = new Session({
                sessionId,
                playerName: playerName || 'Adventurer',
                status: 'waiting',
                timeStarted: new Date()
            });
            await session.save();
            
            // Welcome message
            const welcomeMsg = new Message({
                sessionId,
                senderName: 'Host',
                message: 'Welcome to The Tales, brave adventurer! I am your host. Ask me anything.',
                type: 'system',
                timestamp: new Date()
            });
            await welcomeMsg.save();
            
            io.to(roomName).emit('system-message', {
                message: 'Welcome to The Tales, brave adventurer! I am your host. Ask me anything.',
                timestamp: Date.now()
            });
        }
        
        gameRooms.set(roomName, session);
        socket.emit('game-joined', { sessionId, playerName, status: session.status });
        
        // Send recent messages
        const recentMessages = await Message.find({ sessionId })
            .sort({ timestamp: -1 })
            .limit(50)
            .lean();
        
        socket.emit('message-history', recentMessages.reverse());
    });
    
    // Real-time messaging between player and host
    socket.on('send-message', async (data) => {
        const { sessionId, message, type = 'text' } = data;
        const roomName = `game-${sessionId}`;
        
        // Save message
        const newMessage = new Message({
            sessionId,
            senderId: socket.userId,
            senderName: socket.username || 'Player',
            message,
            type,
            timestamp: new Date()
        });
        await newMessage.save();
        
        // Broadcast to room
        io.to(roomName).emit('new-message', {
            id: newMessage._id,
            sender: socket.username || 'Player',
            message,
            type,
            timestamp: Date.now(),
            isOwn: false
        });
        
        // Host AI response for certain keywords
        const lowerMessage = message.toLowerCase();
        let hostResponse = null;
        
        // Check for keyword matches
        for (const [keyword, reply] of Object.entries(hostRepliesMap)) {
            if (lowerMessage.includes(keyword)) {
                hostResponse = reply;
                break;
            }
        }
        
        // If no keyword match, use general response
        if (!hostResponse) {
            const generalResponses = [
                "Interesting perspective. Tell me more about what you're thinking.",
                "The shadows hold many secrets. What else do you wonder about?",
                "Every question brings you closer to the truth. Keep asking.",
                "I sense you're on the right path. Trust your instincts.",
                "The tale of A' and -oo7 continues to unfold with each question."
            ];
            hostResponse = {
                response: generalResponses[Math.floor(Math.random() * generalResponses.length)],
                emotion: 'thoughtful'
            };
        }
        
        // Simulate typing delay
        setTimeout(async () => {
            const hostMsg = new Message({
                sessionId,
                senderName: 'Host',
                message: hostResponse.response,
                type: 'system',
                timestamp: new Date()
            });
            await hostMsg.save();
            
            io.to(roomName).emit('host-response', {
                message: hostResponse.response,
                emotion: hostResponse.emotion,
                timestamp: Date.now()
            });
            
            // Give gift if applicable
            if (hostResponse.giftReward) {
                const gift = await Gift.findOne({ name: hostResponse.giftReward });
                if (gift && socket.userId) {
                    let inventory = await Inventory.findOne({ userId: socket.userId });
                    if (!inventory) {
                        inventory = new Inventory({ userId: socket.userId, gifts: [] });
                    }
                    
                    const existingGift = inventory.gifts.find(g => 
                        g.giftId.toString() === gift._id.toString()
                    );
                    
                    if (existingGift) {
                        existingGift.quantity += 1;
                    } else {
                        inventory.gifts.push({
                            giftId: gift._id,
                            quantity: 1
                        });
                    }
                    
                    await inventory.save();
                    
                    io.to(roomName).emit('receive-gift', {
                        gift: gift.icon,
                        name: gift.name,
                        rarity: gift.rarity
                    });
                }
            }
        }, 2000);
    });
    
    // Real-time typing indicator
    socket.on('typing', (data) => {
        const { sessionId, isTyping } = data;
        const roomName = `game-${sessionId}`;
        socket.to(roomName).emit('player-typing', {
            player: socket.username || 'Player',
            isTyping
        });
    });
    
    // Submit clue answer
    socket.on('submit-answer', async (data) => {
        const { sessionId, clueId, answer } = data;
        const roomName = `game-${sessionId}`;
        
        let correct = false;
        let response = '';
        let giftReward = null;
        
        switch(clueId) {
            case 1:
                correct = answer === 'D';
                response = correct ? 
                    '✨ Correct! James comes from Kyengera. You have found the first piece of truth!' : 
                    '❌ Not quite. Think about what James would say to your mum...';
                break;
            case 2:
                correct = answer.toLowerCase() === 'bonz';
                response = correct ? 
                    '🎉 Amazing! Znob reversed is Bonz. You\'ve cracked the code!' : 
                    '💭 The answer is hidden in reverse. Try looking at it differently...';
                if (correct) giftReward = 'Golden Key';
                break;
        }
        
        if (correct) {
            await Session.findOneAndUpdate(
                { sessionId },
                { 
                    $inc: { score: 100, cluesSolved: 1 },
                    currentClue: clueId + 1
                }
            );
            
            io.to(roomName).emit('answer-correct', {
                clueId,
                message: response,
                nextClue: clueId + 1
            });
            
            if (giftReward) {
                const gift = await Gift.findOne({ name: giftReward });
                if (gift && socket.userId) {
                    // Award gift
                    io.to(roomName).emit('receive-gift', {
                        gift: gift.icon,
                        name: gift.name,
                        rarity: gift.rarity
                    });
                }
            }
        } else {
            socket.emit('answer-wrong', {
                message: response
            });
        }
    });
    
    // Player emote
    socket.on('send-emote', (data) => {
        const { sessionId, emote } = data;
        const roomName = `game-${sessionId}`;
        
        io.to(roomName).emit('player-emote', {
            player: socket.username || 'Player',
            emote,
            timestamp: Date.now()
        });
    });
    
    // Request hint
    socket.on('request-hint', async (data) => {
        const { sessionId, clueId } = data;
        const roomName = `game-${sessionId}`;
        
        const hints = {
            1: "Think about where James is from. The answer starts with 'K' and ends with 'A'.",
            2: "Look at option A. What happens if you read it backwards?",
            3: "The story of A' and -oo7 holds the key to understanding the truth."
        };
        
        const hint = hints[clueId] || "Trust your intuition. The answer is closer than you think.";
        
        await Session.findOneAndUpdate({ sessionId }, { $inc: { hintsUsed: 1 } });
        
        io.to(roomName).emit('receive-hint', {
            clueId,
            hint,
            usedBy: socket.username || 'Player'
        });
    });
    
    // Disconnect
    socket.on('disconnect', async () => {
        console.log(`👋 Player disconnected: ${socket.id}`);
        
        if (socket.userId) {
            activePlayers.delete(socket.userId);
            await User.findByIdAndUpdate(socket.userId, { isOnline: false });
            
            // Notify rooms
            const rooms = Array.from(socket.rooms).filter(r => r !== socket.id);
            rooms.forEach(room => {
                io.to(room).emit('player-left', {
                    player: socket.username,
                    timestamp: Date.now()
                });
            });
        }
    });
});

// ========== REST API Endpoints ==========

// Register
app.post('/api/register', async (req, res) => {
    try {
        const { username, password, email } = req.body;
        
        const existingUser = await User.findOne({ username });
        if (existingUser) {
            return res.status(400).json({ error: 'Username already exists' });
        }
        
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = new User({
            username,
            password: hashedPassword,
            email
        });
        
        await user.save();
        
        const token = jwt.sign(
            { userId: user._id, username: user.username },
            process.env.JWT_SECRET || 'your-secret-key',
            { expiresIn: '7d' }
        );
        
        res.json({ 
            success: true, 
            token, 
            user: { 
                id: user._id, 
                username: user.username, 
                level: user.level,
                gems: user.gems 
            } 
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Login
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (username === 'jovia' && password === 'jovia256') {
            // Special guest login
            const token = jwt.sign(
                { userId: 'guest', username: 'Jovia' },
                process.env.JWT_SECRET || 'your-secret-key',
                { expiresIn: '7d' }
            );
            
            return res.json({ 
                success: true, 
                token, 
                user: { 
                    id: 'guest',
                    username: 'Jovia',
                    level: 5,
                    gems: 500,
                    isGuest: true
                } 
            });
        }
        
        const user = await User.findOne({ username });
        if (!user) {
            return res.status(400).json({ error: 'Invalid credentials' });
        }
        
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(400).json({ error: 'Invalid credentials' });
        }
        
        const token = jwt.sign(
            { userId: user._id, username: user.username },
            process.env.JWT_SECRET || 'your-secret-key',
            { expiresIn: '7d' }
        );
        
        res.json({ 
            success: true, 
            token, 
            user: { 
                id: user._id, 
                username: user.username, 
                level: user.level,
                gems: user.gems,
                avatar: user.avatar
            } 
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get user inventory
app.get('/api/inventory/:userId', async (req, res) => {
    try {
        const inventory = await Inventory.findOne({ userId: req.params.userId })
            .populate('gifts.giftId');
        
        if (!inventory) {
            return res.json({ gifts: [], achievements: [], totalScore: 0 });
        }
        
        res.json(inventory);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get leaderboard
app.get('/api/leaderboard', async (req, res) => {
    try {
        const leaderboard = await User.find({})
            .select('username level xp cluesSolved avatar')
            .sort({ cluesSolved: -1, xp: -1 })
            .limit(10);
        
        res.json(leaderboard);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get active players count
app.get('/api/active-players', (req, res) => {
    res.json({ count: activePlayers.size });
});

// Get game stats
app.get('/api/stats', async (req, res) => {
    try {
        const totalPlayers = await User.countDocuments();
        const totalSessions = await Session.countDocuments();
        const totalMessages = await Message.countDocuments();
        
        res.json({
            totalPlayers,
            totalSessions,
            totalMessages,
            activeNow: activePlayers.size
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Initialize database
async function initializeDatabase() {
    await initGifts();
    await initHostReplies();
    
    // Create indexes
    await User.createIndexes();
    await Session.createIndexes();
    await Message.createIndexes();
}

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => {
    await initializeDatabase();
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📊 MongoDB connected`);
    console.log(`🎮 Socket.IO ready for connections`);
});