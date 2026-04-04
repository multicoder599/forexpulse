const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();

// ==========================================
// 1. MIDDLEWARE & CONFIGURATION
// ==========================================
// Allow requests from your local environment AND your live Render URL
app.use(cors({
    origin: ['http://localhost:5000', 'https://forexpulse-9rlp.onrender.com'],
    credentials: true
}));
app.use(express.json()); 

// Serve static frontend files from the 'public' folder
app.use(express.static('public'));

// ==========================================
// 2. DATABASE CONNECTION
// ==========================================
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB Connected Successfully'))
  .catch((err) => console.log('❌ MongoDB Connection Error: ', err));


// ==========================================
// 3. DATABASE MODELS (SCHEMAS)
// ==========================================

// User Schema
const userSchema = new mongoose.Schema({
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true }, // Note: In production, we will hash this!
    accountID: String,
    totalBalance: { type: Number, default: 0 },
    invested: { type: Number, default: 0 },
    earnings: { type: Number, default: 0 },
    available: { type: Number, default: 0 },
    isVerified: { type: Boolean, default: false },
    isAdmin: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

// Transaction Schema (For Deposits & Withdrawals)
const transactionSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['Deposit', 'Withdrawal'], required: true },
    amount: { type: Number, required: true },
    method: { type: String, required: true }, // e.g., 'M-Pesa', 'Crypto', 'Bank'
    destination: String, // e.g., M-Pesa number or Crypto address
    status: { type: String, enum: ['Pending', 'Completed', 'Rejected'], default: 'Pending' },
    createdAt: { type: Date, default: Date.now }
});
const Transaction = mongoose.model('Transaction', transactionSchema);

// Investment Schema (For Active Plans)
const investmentSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    planName: { type: String, required: true },
    amount: { type: Number, required: true },
    dailyROI: { type: Number, required: true },
    durationDays: { type: Number, required: true },
    accruedProfit: { type: Number, default: 0 },
    status: { type: String, enum: ['Active', 'Completed', 'Cancelled'], default: 'Active' },
    startedAt: { type: Date, default: Date.now },
    maturesAt: { type: Date, required: true }
});
const Investment = mongoose.model('Investment', investmentSchema);


// ==========================================
// 4. AUTHENTICATION ROUTES
// ==========================================

// Register a new user
app.post('/api/auth/register', async (req, res) => {
    try {
        const { firstName, lastName, email, password } = req.body;
        
        // Check if user already exists
        const existingUser = await User.findOne({ email });
        if (existingUser) return res.status(400).json({ error: 'Email already in use' });

        // Create new user (Generate a random 8-digit Account ID)
        const accountID = Math.floor(10000000 + Math.random() * 90000000).toString();
        
        const user = await User.create({ firstName, lastName, email, password, accountID });
        res.status(201).json({ message: 'User registered successfully', user });
    } catch (err) {
        res.status(500).json({ error: 'Server error during registration' });
    }
});

// Login a user
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email, password });
        
        if (!user) return res.status(401).json({ error: 'Invalid email or password' });
        
        res.json({ message: 'Login successful', user });
    } catch (err) {
        res.status(500).json({ error: 'Server error during login' });
    }
});


// ==========================================
// 5. USER DASHBOARD ROUTES
// ==========================================

// Get logged-in user data (Using an ID passed in the request for now)
app.get('/api/user/:id', async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Get user's active investments
app.get('/api/user/:id/investments', async (req, res) => {
    try {
        const investments = await Investment.find({ userId: req.params.id, status: 'Active' });
        res.json(investments);
    } catch (err) {
        res.status(500).json({ error: 'Server error fetching investments' });
    }
});

// Get user's transaction history
app.get('/api/user/:id/transactions', async (req, res) => {
    try {
        const transactions = await Transaction.find({ userId: req.params.id }).sort({ createdAt: -1 });
        res.json(transactions);
    } catch (err) {
        res.status(500).json({ error: 'Server error fetching transactions' });
    }
});


// ==========================================
// 6. WALLET ROUTES (DEPOSIT / WITHDRAW)
// ==========================================

// Request a Deposit
app.post('/api/wallet/deposit', async (req, res) => {
    try {
        const { userId, amount, method, phoneOrAddress } = req.body;
        
        // Creates a "Pending" transaction. Admin must approve it to add funds.
        const transaction = await Transaction.create({
            userId,
            type: 'Deposit',
            amount,
            method,
            destination: phoneOrAddress
        });
        
        res.json({ message: 'Deposit request submitted. Pending verification.', transaction });
    } catch (err) {
        res.status(500).json({ error: 'Server error processing deposit' });
    }
});

// Request a Withdrawal
app.post('/api/wallet/withdraw', async (req, res) => {
    try {
        const { userId, amount, method, destination } = req.body;
        
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ error: 'User not found' });

        // Check if user has enough available balance
        if (user.available < amount) {
            return res.status(400).json({ error: 'Insufficient available funds' });
        }

        // Deduct from available immediately to prevent double-spending, create pending tx
        user.available -= amount;
        user.totalBalance -= amount;
        await user.save();

        const transaction = await Transaction.create({
            userId,
            type: 'Withdrawal',
            amount,
            method,
            destination
        });

        res.json({ message: 'Withdrawal request submitted successfully.', transaction });
    } catch (err) {
        res.status(500).json({ error: 'Server error processing withdrawal' });
    }
});


// ==========================================
// 7. INVESTMENT ROUTES
// ==========================================

// Start a new investment plan
app.post('/api/invest', async (req, res) => {
    try {
        const { userId, planName, amount, dailyROI, durationDays } = req.body;

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ error: 'User not found' });

        if (user.available < amount) {
            return res.status(400).json({ error: 'Insufficient available funds to invest' });
        }

        // Move money from Available to Invested
        user.available -= amount;
        user.invested += amount;
        await user.save();

        // Calculate maturity date
        const maturesAt = new Date();
        maturesAt.setDate(maturesAt.getDate() + durationDays);

        const investment = await Investment.create({
            userId,
            planName,
            amount,
            dailyROI,
            durationDays,
            maturesAt
        });

        res.json({ message: `Successfully invested into ${planName}`, investment });
    } catch (err) {
        res.status(500).json({ error: 'Server error processing investment' });
    }
});


// ==========================================
// 8. ADMIN ROUTES
// ==========================================

// Get all pending transactions (Deposits & Withdrawals)
app.get('/api/admin/transactions/pending', async (req, res) => {
    try {
        // In a real app, check if req.user.isAdmin === true here
        const transactions = await Transaction.find({ status: 'Pending' }).populate('userId', 'firstName lastName email');
        res.json(transactions);
    } catch (err) {
        res.status(500).json({ error: 'Server error fetching admin data' });
    }
});

// Approve or Reject a Transaction
app.put('/api/admin/transaction/:id', async (req, res) => {
    try {
        const { action } = req.body; // 'Approve' or 'Reject'
        const transaction = await Transaction.findById(req.params.id);
        
        if (!transaction) return res.status(404).json({ error: 'Transaction not found' });
        if (transaction.status !== 'Pending') return res.status(400).json({ error: 'Transaction is already processed' });

        const user = await User.findById(transaction.userId);

        if (action === 'Approve') {
            transaction.status = 'Completed';
            
            // If it's a deposit, add the money to the user's available balance
            if (transaction.type === 'Deposit') {
                user.available += transaction.amount;
                user.totalBalance += transaction.amount;
                await user.save();
            }
            // If it's a withdrawal, the money was already deducted when requested, so we just approve the tx.
        } else if (action === 'Reject') {
            transaction.status = 'Rejected';
            
            // If rejecting a withdrawal, refund the money back to available balance
            if (transaction.type === 'Withdrawal') {
                user.available += transaction.amount;
                user.totalBalance += transaction.amount;
                await user.save();
            }
        }

        await transaction.save();
        res.json({ message: `Transaction ${action}d successfully.`, transaction });
    } catch (err) {
        res.status(500).json({ error: 'Server error processing admin action' });
    }
});

// Get all users
app.get('/api/admin/users', async (req, res) => {
    try {
        const users = await User.find().select('-password'); // Exclude passwords
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: 'Server error fetching users' });
    }
});

// ==========================================
// 9. START SERVER
// ==========================================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🌐 Live URL mapped for Render: https://forexpulse-9rlp.onrender.com`);
});