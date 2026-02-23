const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.use(express.json());

// Store active game sessions
const gameSessions = new Map();
const hostResponses = new Map();

// Host AI response generator
function generateHostResponse(question) {
    const responses = [
        "Ah, an interesting question... The truth is, James represents the part of ourselves we often hide from others.",
        "In the world of espionage, names are masks. Znob reversed is Bonz - sometimes the truth is right in front of us, just mirrored.",
        "The tale of A' and -oo7 teaches us that love and duty often conflict. What's your take on this?",
        "Every unanswered question holds a piece of your own truth. Keep seeking, and you shall find.",
        "The shadows hold many secrets, but the brightest light comes from within. What does your intuition tell you?",
        "James, Bonz, -oo7 - all are reflections of identity. Who do you see when you look in the mirror?",
        "The gift you received isn't just a symbol - it's a key to understanding deeper truths.",
        "Sometimes the question itself is more important than the answer. Why do you ask this?",
        "In the digital shadows of this game, every choice reveals a part of your own story.",
        "The piece of truth you seek isn't in the story - it's in how the story makes you feel."
    ];
    
    // Add context-aware responses
    if (question.toLowerCase().includes('james')) {
        return "James is Bonz - a mirror image of truth. Znob reversed reveals the answer you seek.";
    } else if (question.toLowerCase().includes('love') || question.toLowerCase().includes('relationship')) {
        return "Love in the shadows is complicated. A' and -oo7's story reminds us that even the strongest bonds can be tested by circumstance.";
    } else if (question.toLowerCase().includes('truth')) {
        return "Truth is like light - sometimes it's blinding, sometimes it's subtle. The real question is: are you ready to see it?";
    } else if (question.toLowerCase().includes('next') || question.toLowerCase().includes('continue')) {
        return "Your journey continues with every question you ask. The next clue is always within reach.";
    }
    
    return responses[Math.floor(Math.random() * responses.length)];
}

// REST API endpoints
app.post('/api/ask', (req, res) => {
    const { question, sessionId } = req.body;
    
    if (!question) {
        return res.status(400).json({ error: 'Question is required' });
    }
    
    const response = generateHostResponse(question);
    
    // Store in session if provided
    if (sessionId) {
        if (!gameSessions.has(sessionId)) {
            gameSessions.set(sessionId, []);
        }
        gameSessions.get(sessionId).push({ question, response, timestamp: Date.now() });
    }
    
    res.json({ 
        response,
        timestamp: Date.now(),
        sessionId: sessionId || generateSessionId()
    });
});

app.get('/api/session/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const history = gameSessions.get(sessionId) || [];
    res.json({ history });
});

// Socket.IO for real-time communication
io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);
    
    // Join a game room
    socket.on('join-game', (sessionId) => {
        socket.join(`game-${sessionId}`);
        console.log(`Socket ${socket.id} joined game-${sessionId}`);
        
        // Send welcome message
        socket.emit('host-message', {
            type: 'welcome',
            message: 'The host is ready to guide you. What would you like to know?',
            timestamp: Date.now()
        });
    });
    
    // Handle real-time questions
    socket.on('ask-question', (data) => {
        const { question, sessionId } = data;
        
        // Generate response
        const response = generateHostResponse(question);
        
        // Store in session
        if (sessionId) {
            if (!gameSessions.has(sessionId)) {
                gameSessions.set(sessionId, []);
            }
            gameSessions.get(sessionId).push({ 
                question, 
                response, 
                timestamp: Date.now(),
                socketId: socket.id 
            });
        }
        
        // Emit to the specific room
        io.to(`game-${sessionId}`).emit('host-response', {
            question,
            response,
            timestamp: Date.now(),
            type: 'answer'
        });
        
        // Send typing indicator first for realism
        socket.emit('host-typing', { typing: true });
        setTimeout(() => {
            socket.emit('host-typing', { typing: false });
        }, 1500);
    });
    
    // Handle custom clue responses
    socket.on('submit-clue-answer', (data) => {
        const { clueId, answer, sessionId } = data;
        
        let response = '';
        let correct = false;
        
        if (clueId === 1) {
            correct = answer === 'D';
            response = correct ? 
                'Correct! James comes from Kyengera. You have found the first piece of truth.' : 
                'Not quite. Listen carefully to what your mum asked James...';
        } else if (clueId === 2) {
            if (answer.toLowerCase() === 'bonz' || answer.toLowerCase() === 'znob') {
                correct = true;
                response = 'Excellent! Znob reversed is Bonz. You\'ve decoded the truth!';
            } else {
                response = 'The answer is hidden in plain sight. Try reversing what you see...';
            }
        }
        
        socket.emit('clue-result', {
            clueId,
            correct,
            response,
            timestamp: Date.now()
        });
        
        if (correct) {
            socket.emit('receive-gift', {
                gift: getRandomGift(),
                message: 'You\'ve earned a gift for your wisdom!'
            });
        }
    });
    
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });
});

function generateSessionId() {
    return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function getRandomGift() {
    const gifts = ['🎁', '🎉', '🏆', '💎', '🔮', '⭐', '🌙', '⚡', '🕯️', '🗝️'];
    return gifts[Math.floor(Math.random() * gifts.length)];
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});