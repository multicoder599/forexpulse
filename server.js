const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();

// ==========================================
// 1. MIDDLEWARE & CONFIGURATION
// ==========================================
app.use(cors());
app.use(express.json()); 
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

const userSchema = new mongoose.Schema({
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true }, 
    phone: { type: String, default: '' }, // New Field
    currency: { type: String, default: 'USD' }, // New Field
    timezone: { type: String, default: 'UTC' }, // New Field
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

const notificationSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    type: { type: String, default: 'general' }, 
    isRead: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});
const Notification = mongoose.model('Notification', notificationSchema);


// ==========================================
// 4. AUTHENTICATION ROUTES
// ==========================================
app.post('/api/auth/register', async (req, res) => {
    try {
        const { firstName, lastName, email, password } = req.body;
        const normalizedEmail = email.toLowerCase().trim();
        
        const existingUser = await User.findOne({ email: normalizedEmail });
        if (existingUser) return res.status(400).json({ error: 'Email already in use' });

        const accountID = Math.floor(10000000 + Math.random() * 90000000).toString();
        
        const user = await User.create({ 
            firstName, lastName, email: normalizedEmail, password, accountID 
        });

        await Notification.create({
            userId: user._id,
            title: 'Welcome to ForexPulse',
            message: 'Your account has been created successfully. You can now fund your wallet.',
            type: 'general'
        });
        
        res.status(201).json({ message: 'User registered successfully', user });
    } catch (err) {
        res.status(500).json({ error: 'Server error during registration' });
    }
});

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
// 5. USER DASHBOARD & SETTINGS
// ==========================================
app.get('/api/user/:id', async (req, res) => {
    try {
        let user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ error: 'User not found' });

        // Auto-Maturity Engine
        const activeInvestments = await Investment.find({ userId: user._id, status: 'Active' });
        let hasChanges = false;
        let totalNewProfit = 0;
        let totalFreedCapital = 0;
        const now = new Date();

        for (let plan of activeInvestments) {
            if (now >= plan.maturesAt) {
                const profit = plan.amount * (plan.dailyROI / 100);
                
                plan.status = 'Completed';
                plan.accruedProfit = profit;
                await plan.save();

                totalFreedCapital += plan.amount;
                totalNewProfit += profit;
                hasChanges = true;

                await Notification.create({
                    userId: user._id,
                    title: 'Trade Matured',
                    message: `Your allocation in ${plan.planName} has completed. KES ${(plan.amount + profit).toLocaleString()} added to your wallet.`,
                    type: 'invest'
                });
            }
        }

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

// ✅ NEW: Update Profile Info
app.put('/api/user/:id/profile', async (req, res) => {
    try {
        const { firstName, lastName, phone } = req.body;
        const user = await User.findByIdAndUpdate(
            req.params.id, 
            { firstName, lastName, phone }, 
            { new: true }
        ).select('-password');
        
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: 'Server error updating profile' });
    }
});

// ✅ NEW: Update Password
app.put('/api/user/:id/password', async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const user = await User.findById(req.params.id);
        
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (user.password !== currentPassword) {
            return res.status(400).json({ error: 'Incorrect current password' });
        }

        user.password = newPassword;
        await user.save();
        res.json({ message: 'Password updated successfully' });
    } catch (err) {
        res.status(500).json({ error: 'Server error updating password' });
    }
});

// ✅ NEW: Update Preferences
app.put('/api/user/:id/preferences', async (req, res) => {
    try {
        const { currency, timezone } = req.body;
        const user = await User.findByIdAndUpdate(
            req.params.id, 
            { currency, timezone }, 
            { new: true }
        ).select('-password');
        
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: 'Server error updating preferences' });
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

app.get('/api/user/:id/notifications', async (req, res) => {
    try {
        const notifs = await Notification.find({ userId: req.params.id }).sort({ createdAt: -1 }).limit(30);
        res.json(notifs);
    } catch (err) {
        res.status(500).json({ error: 'Server error fetching notifications' });
    }
});

app.put('/api/user/:id/notifications/read', async (req, res) => {
    try {
        await Notification.updateMany({ userId: req.params.id, isRead: false }, { isRead: true });
        res.json({ message: 'Notifications marked as read' });
    } catch (err) {
        res.status(500).json({ error: 'Server error updating notifications' });
    }
});


// ==========================================
// 6. WALLET ROUTES (AUTO-DEPOSIT & WITHDRAW)
// ==========================================
app.post('/api/wallet/deposit', async (req, res) => {
    try {
        const { userId, amount, method, phoneOrAddress } = req.body;
        
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const transaction = await Transaction.create({
            userId, type: 'Deposit', amount, method, destination: phoneOrAddress, status: 'Completed'
        });

        user.available += Number(amount);
        user.totalBalance += Number(amount);
        await user.save();

        await Notification.create({
            userId,
            title: 'Deposit Successful',
            message: `Your deposit of KES ${amount.toLocaleString()} via ${method} has been credited to your wallet.`,
            type: 'deposit'
        });

        res.json({ message: 'Deposit successful.', transaction });
    } catch (err) {
        res.status(500).json({ error: 'Server error processing STK deposit' });
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
            userId, type: 'Withdrawal', amount, method, destination, status: 'Pending'
        });

        await Notification.create({
            userId,
            title: 'Withdrawal Requested',
            message: `Your withdrawal of KES ${amount.toLocaleString()} is being processed.`,
            type: 'withdraw'
        });

        res.json({ message: 'Withdrawal request submitted.', transaction });
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
        if (user.available < amount) return res.status(400).json({ error: 'Insufficient available funds' });

        user.available -= amount;
        user.invested += amount;
        await user.save();

        const maturesAt = new Date();
        maturesAt.setTime(maturesAt.getTime() + (durationDays * 24 * 60 * 60 * 1000));

        const investment = await Investment.create({
            userId, planName, amount, dailyROI, durationDays, maturesAt
        });

        await Notification.create({
            userId,
            title: 'Capital Staked',
            message: `You have successfully allocated KES ${amount.toLocaleString()} into ${planName}.`,
            type: 'invest'
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
        const user = await User.findOneAndUpdate({ email: userEmail }, { isAdmin: true }, { new: true });
        if (!user) return res.status(404).json({ message: "User not found. Register them first!" });
        res.json({ message: `Success! ${user.email} is now an Admin.`, user });
    } catch (err) {
        res.status(500).json({ error: "Server error" });
    }
});

app.get('/api/admin/transactions/all', async (req, res) => {
    try {
        const transactions = await Transaction.find()
            .populate('userId', 'firstName lastName email')
            .sort({ createdAt: -1 });
        res.json(transactions);
    } catch (err) {
        res.status(500).json({ error: 'Server error fetching all transactions' });
    }
});

app.get('/api/admin/transactions/pending', async (req, res) => {
    try {
        const transactions = await Transaction.find({ status: 'Pending' })
            .populate('userId', 'firstName lastName email')
            .sort({ createdAt: 1 });
        res.json(transactions);
    } catch (err) {
        res.status(500).json({ error: 'Server error fetching pending data' });
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

            await Notification.create({
                userId: user._id,
                title: `${transaction.type} Approved`,
                message: `Your ${transaction.type.toLowerCase()} of KES ${transaction.amount.toLocaleString()} was successful.`,
                type: transaction.type.toLowerCase() === 'deposit' ? 'deposit' : 'withdraw'
            });

            if (transaction.type === 'Withdrawal' && process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
                const tgMessage = `✅ *Withdrawal Approved*\n\n👤 *User:* ${user.firstName} ${user.lastName}\n✉️ *Email:* ${user.email}\n💰 *Amount:* KES ${transaction.amount.toLocaleString()}\n🏦 *Method:* ${transaction.method}\n📍 *Destination:* \`${transaction.destination}\``;
                
                try {
                    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            chat_id: process.env.TELEGRAM_CHAT_ID,
                            text: tgMessage,
                            parse_mode: 'Markdown'
                        })
                    });
                } catch (tgError) {
                    console.error("Failed to send Telegram notification:", tgError);
                }
            }

        } else if (action === 'Reject') {
            transaction.status = 'Rejected';
            
            if (transaction.type === 'Withdrawal') {
                user.available += Number(transaction.amount);
                user.totalBalance += Number(transaction.amount);
                await user.save();
            }
            
            await Notification.create({
                userId: user._id,
                title: `${transaction.type} Rejected`,
                message: `Your ${transaction.type.toLowerCase()} of KES ${transaction.amount.toLocaleString()} was declined. Funds have been returned to your wallet.`,
                type: 'general'
            });
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
            available: Number(available), invested: Number(invested), earnings: Number(earnings), totalBalance: Number(totalBalance)
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
        await Notification.deleteMany({ userId: req.params.id });
        
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