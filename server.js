const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json()); // Allows us to read JSON data

// Serve static frontend files from the 'public' folder
app.use(express.static('public'));

// 1. Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB Connected Successfully'))
  .catch((err) => console.log('❌ MongoDB Connection Error: ', err));

// 2. Define a User Schema (How data looks in the database)
const userSchema = new mongoose.Schema({
    firstName: String,
    lastName: String,
    email: String,
    accountID: String,
    totalBalance: Number,
    invested: Number,
    earnings: Number,
    available: Number,
    isVerified: Boolean
});

const User = mongoose.model('User', userSchema);

// 3. Create an API Route to get user data
// For now, we'll just fetch the very first user in the database
app.api = app.get('/api/user/me', async (req, res) => {
    try {
        let user = await User.findOne();
        
        // If no user exists, create a dummy one for testing
        if (!user) {
            user = await User.create({
                firstName: 'Yashua',
                lastName: 'Doe',
                email: 'yashua@example.com',
                accountID: '0759277409',
                totalBalance: 12450.80,
                invested: 8000,
                earnings: 2850,
                available: 1600,
                isVerified: true
            });
        }
        
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// 4. Start the server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});