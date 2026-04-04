const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();

// ==========================================
// 1. MIDDLEWARE & CONFIGURATION
// ==========================================
// Allow requests from ANY origin to prevent "Load failed" errors while testing
app.use(cors());
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
    password: { type: String, required: true }, 
    accountID: String,
    totalBalance: { type: Number, default: 0 },
    invested: { type: Number, default: 0 },
    earnings: { type: Number, default: 0 }, // Lifetime profits
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
    method: { type: String, required: true }, 
    destination: String, 
    status: { type: String, enum: ['Pending', 'Completed', 'Rejected'], default: 'Pending' },
    createdAt: { type: Date, default: Date.now }
});
const Transaction = mongoose.model('Transaction', transactionSchema);

// Investment Schema (For Active Plans)
const investmentSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    planName: { type: String, required: true },
    amount: { type: Number, required: true },
    dailyROI: { type: Number, required: true }, // Treated as Total Target ROI %
    durationDays: { type: Number, required: true }, // Can be fractions (e.g., 0.25 for 6 hours)
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
        
        // Force email to lowercase and remove spaces
        const normalizedEmail = email.toLowerCase().trim();
        
        const existingUser = await User.findOne({ email: normalizedEmail });
        if (existingUser) return res.status(400).json({ error: 'Email already in use' });

        const accountID = Math.floor(10000000 + Math.random() * 90000000).toString();
        
        const user = await User.create({ 
            firstName, 
            lastName, 
            email: normalizedEmail, 
            password, 
            accountID 
        });
        
        res.status(201).json({ message: 'User registered successfully', user });
    } catch (err) {
        res.status(500).json({ error: 'Server error during registration' });
    }
});

// Login a user
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const normalizedEmail = email.toLowerCase().trim();
        
        const user = await User.findOne({ email: normalizedEmail, password: password });
        
        if (!user) return res.status(401).json({ error: 'Invalid email or password' });
        
        res.json({ message: 'Login successful', user });
    } catch (err) {
        res.status(500).json({ error: 'Server error during login' });
    }
});


// ==========================================
// 5. USER DASHBOARD ROUTES (WITH AUTO-SYNC)
// ==========================================
app.get('/api/user/:id', async (req, res) => {
    try {
        let user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ error: 'User not found' });

        // --- AUTO-MATURITY ENGINE ---
        // Checks if any active investments have finished their duration
        const activeInvestments = await Investment.find({ userId: user._id, status: 'Active' });
        let hasChanges = false;
        let totalNewProfit = 0;
        let totalFreedCapital = 0;

        const now = new Date();

        for (let plan of activeInvestments) {
            if (now >= plan.maturesAt) {
                // Plan is finished! Calculate profit.
                const profit = plan.amount * (plan.dailyROI / 100);
                
                plan.status = 'Completed';
                plan.accruedProfit = profit;
                await plan.save();

                totalFreedCapital += plan.amount;
                totalNewProfit += profit;
                hasChanges = true;
            }
        }

        // If plans matured, update the user's main wallet balances
        if (hasChanges) {
            user.invested -= totalFreedCapital;
            user.available += (totalFreedCapital + totalNewProfit);
            user.earnings += totalNewProfit;
            user.totalBalance = user.available + user.invested; 
            await user.save();
        }

        res.json(user);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/user/:id/investments', async (req, res) => {
    try {
        const investments = await Investment.find({ userId: req.params.id, status: 'Active' });
        res.json(investments);
    } catch (err) {
        res.status(500).json({ error: 'Server error fetching investments' });
    }
});

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
app.post('/api/wallet/deposit', async (req, res) => {
    try {
        const { userId, amount, method, phoneOrAddress } = req.body;
        const transaction = await Transaction.create({
            userId, type: 'Deposit', amount, method, destination: phoneOrAddress
        });
        res.json({ message: 'Deposit request submitted. Pending verification.', transaction });
    } catch (err) {
        res.status(500).json({ error: 'Server error processing deposit' });
    }
});

app.post('/api/wallet/withdraw', async (req, res) => {
    try {
        const { userId, amount, method, destination } = req.body;
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ error: 'User not found' });

        if (user.available < amount) return res.status(400).json({ error: 'Insufficient available funds' });

        user.available -= amount;
        user.totalBalance -= amount;
        await user.save();

        const transaction = await Transaction.create({
            userId, type: 'Withdrawal', amount, method, destination
        });

        res.json({ message: 'Withdrawal request submitted successfully.', transaction });
    } catch (err) {
        res.status(500).json({ error: 'Server error processing withdrawal' });
    }
});


// ==========================================
// 7. INVESTMENT ROUTES
// ==========================================
app.post('/api/invest', async (req, res) => {
    try {
        const { userId, planName, amount, dailyROI, durationDays } = req.body;
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ error: 'User not found' });

        if (user.available < amount) return res.status(400).json({ error: 'Insufficient available funds to invest' });

        // Update balances
        user.available -= amount;
        user.invested += amount;
        await user.save();

        // Calculate exact maturity date (supports fractional days like 0.25 for 6 hours)
        const maturesAt = new Date();
        maturesAt.setTime(maturesAt.getTime() + (durationDays * 24 * 60 * 60 * 1000));

        const investment = await Investment.create({
            userId, planName, amount, dailyROI, durationDays, maturesAt
        });

        res.json({ message: `Successfully invested into ${planName}`, investment });
    } catch (err) {
        res.status(500).json({ error: 'Server error processing investment' });
    }
});


// ==========================================
// 8. ADMIN ROUTES
// ==========================================

app.get('/api/make-admin/:email', async (req, res) => {
    try {
        const userEmail = req.params.email.toLowerCase().trim();
        const user = await User.findOneAndUpdate(
            { email: userEmail }, 
            { isAdmin: true }, 
            { new: true } 
        );
        if (!user) return res.status(404).json({ message: "User not found. Register them first!" });
        res.json({ message: `Success! ${user.email} is now an Admin.`, user });
    } catch (err) {
        res.status(500).json({ error: "Server error" });
    }
});

app.get('/api/admin/transactions/pending', async (req, res) => {
    try {
        const transactions = await Transaction.find({ status: 'Pending' }).populate('userId', 'firstName lastName email');
        res.json(transactions);
    } catch (err) {
        res.status(500).json({ error: 'Server error fetching admin data' });
    }
});

app.put('/api/admin/transaction/:id', async (req, res) => {
    try {
        const { action } = req.body; 
        const transaction = await Transaction.findById(req.params.id);
        
        if (!transaction) return res.status(404).json({ error: 'Transaction not found' });
        if (transaction.status !== 'Pending') return res.status(400).json({ error: 'Transaction is already processed' });

        const user = await User.findById(transaction.userId);

        if (action === 'Approve') {
            transaction.status = 'Completed';
            if (transaction.type === 'Deposit') {
                user.available += Number(transaction.amount);
                user.totalBalance += Number(transaction.amount);
                await user.save();
            }
        } else if (action === 'Reject') {
            transaction.status = 'Rejected';
            if (transaction.type === 'Withdrawal') {
                user.available += Number(transaction.amount);
                user.totalBalance += Number(transaction.amount);
                await user.save();
            }
        }

        await transaction.save();
        res.json({ message: `Transaction ${action}d successfully.`, transaction });
    } catch (err) {
        res.status(500).json({ error: 'Server error processing admin action' });
    }
});

app.get('/api/admin/users', async (req, res) => {
    try {
        const users = await User.find().select('-password').sort({ createdAt: -1 });
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: 'Server error fetching users' });
    }
});

app.put('/api/admin/user/:id/balance', async (req, res) => {
    try {
        const { available, invested, earnings, totalBalance } = req.body;
        const user = await User.findByIdAndUpdate(req.params.id, {
            available: Number(available),
            invested: Number(invested),
            earnings: Number(earnings),
            totalBalance: Number(totalBalance)
        }, { new: true });
        
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json({ message: 'Balances updated successfully', user });
    } catch (err) {
        res.status(500).json({ error: 'Server error updating balances' });
    }
});

app.delete('/api/admin/user/:id', async (req, res) => {
    try {
        const user = await User.findByIdAndDelete(req.params.id);
        if (!user) return res.status(404).json({ error: 'User not found' });
        
        await Transaction.deleteMany({ userId: req.params.id });
        await Investment.deleteMany({ userId: req.params.id });
        
        res.json({ message: 'User and associated data deleted permanently.' });
    } catch (err) {
        res.status(500).json({ error: 'Server error deleting user' });
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