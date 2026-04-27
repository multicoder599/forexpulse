const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const axios = require('axios'); // Added for MegaPay & Telegram requests
require('dotenv').config();

const app = express();

// ==========================================
// 1. MIDDLEWARE & CONFIGURATION
// ==========================================
app.use(cors());
app.use(express.json()); 
app.use(express.static('public'));

// Telegram Helper Function for Webhook & Admin Alerts
const sendTelegramMessage = async (message) => {
    if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) return;
    try {
        await axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
            chat_id: process.env.TELEGRAM_CHAT_ID,
            text: message,
            parse_mode: 'HTML'
        });
    } catch (err) { 
        console.error('Telegram Notification Error:', err.message); 
    }
};

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
    phone: { type: String, default: '' }, 
    currency: { type: String, default: 'USD' }, 
    timezone: { type: String, default: 'UTC' }, 
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
    refId: { type: String }, // Added to track MegaPay References/Receipts
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
            title: 'Welcome to ChainTrade',
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
// 6. WALLET ROUTES (MEGAPAY DEPOSIT & WITHDRAW)
// ==========================================

// ✅ MEGAPAY DEPOSIT API
app.post('/api/wallet/deposit', async (req, res) => {
    try {
        // Accommodate both frontend field names and direct API tests
        const amount = parseFloat(req.body.amount);
        const rawPhone = req.body.phoneOrAddress || req.body.userPhone;
        const userId = req.body.userId;
        const method = req.body.method || 'M-Pesa STK';

        if (!rawPhone) return res.status(400).json({ error: 'Phone number is required.' });
        if (isNaN(amount) || amount < 10) return res.status(400).json({ error: 'Minimum deposit is KES 10.' });

        const user = await User.findById(userId) || await User.findOne({ phone: rawPhone });
        if (!user) return res.status(404).json({ error: 'User not found.' });

        // Phone normalization (handles +254, 254, 07)
        let formattedPhone = rawPhone.replace(/\D/g, '');
        if (formattedPhone.startsWith('0')) formattedPhone = '254' + formattedPhone.slice(1);
        else if (/^[71]/.test(formattedPhone)) formattedPhone = '254' + formattedPhone;
        else if (!formattedPhone.startsWith('254')) formattedPhone = '254' + formattedPhone;

        if (formattedPhone.length !== 12) {
            return res.status(400).json({ error: 'Invalid phone number format. Use 07XXXXXXXX or 254XXXXXXXXX.' });
        }

        const reference = 'DEP' + Date.now();

        const payload = {
            api_key:      process.env.MEGAPAY_API_KEY  || 'MGPYDgkkstpA',
            email:        process.env.MEGAPAY_EMAIL    || 'kanyingiwaitara@gmail.com',
            amount:       amount,
            msisdn:       formattedPhone,
            callback_url: `${process.env.APP_URL || 'https://forexpulse-9rlp.onrender.com'}/api/megapay/webhook`,
            description:  'ChainTrade Deposit',
            reference:    reference
        };

        try {
            const mpRes = await axios.post(
                'https://megapay.co.ke/backend/v1/initiatestk',
                payload,
                {
                    headers: { 'Content-Type': 'application/json' },
                    timeout: 15000 
                }
            );

            const mpData = mpRes.data;
            if (mpData && (mpData.status === false || mpData.success === false || mpData.ResponseCode === '1')) {
                return res.status(400).json({ error: mpData.errorMessage || mpData.message || 'MegaPay rejected the request.' });
            }

        } catch (mpErr) {
            console.error('MegaPay STK error:', mpErr.message);
            return res.status(502).json({ error: 'Payment gateway failed to send STK push.' });
        }

        // Record as Pending 
        const transaction = await Transaction.create({
            userId: user._id,
            refId: reference,
            type: 'Deposit',
            method: method,
            amount: amount,
            destination: formattedPhone,
            status: 'Pending'
        });

        res.status(200).json({
            message: 'STK Push sent! Check your phone and enter your M-Pesa PIN.',
            transactionId: transaction._id
        });

    } catch (error) {
        console.error('Deposit endpoint error:', error);
        res.status(500).json({ error: 'Internal server error during deposit.' });
    }
});

// ✅ MEGAPAY WEBHOOK
app.post('/api/megapay/webhook', async (req, res) => {
    // MegaPay requires a fast 200 OK acknowledgment
    res.status(200).send("OK");
    
    const data = req.body;
    try {
        if ((data.ResponseCode !== undefined ? data.ResponseCode : data.ResultCode) != 0) return;
        
        const amount = parseFloat(data.TransactionAmount || data.amount || data.Amount);
        const receipt = data.TransactionReceipt || data.MpesaReceiptNumber;
        const last9 = (data.Msisdn || data.phone || data.PhoneNumber || "").toString().replace(/\D/g, '').slice(-9);
        
        if (last9.length < 9) return;

        // Find user by matching the end of the phone number
        const user = await User.findOne({ 
            $or: [
                { phone: { $regex: new RegExp(last9 + '$') } },
                { _id: (await Transaction.findOne({ destination: { $regex: new RegExp(last9 + '$') }, status: 'Pending' }))?.userId }
            ]
        });
        
        if (!user) return;

        // Check if this receipt was already processed to prevent double-crediting
        const existingTx = await Transaction.findOne({ refId: receipt });
        if (existingTx && existingTx.status === 'Completed') return;

        // Find the pending transaction and update it, or create a new one
        let tx = await Transaction.findOne({ destination: { $regex: new RegExp(last9 + '$') }, status: 'Pending', amount: amount });
        
        if (tx) {
            tx.status = 'Completed';
            tx.refId = receipt;
            await tx.save();
        } else {
            tx = await Transaction.create({ 
                userId: user._id, 
                refId: receipt, 
                type: "Deposit", 
                method: "M-Pesa", 
                amount: amount, 
                destination: data.Msisdn,
                status: "Completed" 
            });
        }

        // Credit User
        user.available += amount;
        user.totalBalance += amount;
        await user.save();
        
        // Notify User
        await Notification.create({ 
            userId: user._id, 
            title: "Deposit Successful", 
            message: `Your deposit of KES ${amount} has been credited. Receipt: ${receipt}`,
            type: "deposit"
        });
        
        // Alert Admin
        sendTelegramMessage(`💵 <b>SUCCESSFUL DEPOSIT</b>\n👤 User: ${user.firstName} ${user.lastName}\n📱 Phone: ${user.phone || data.Msisdn}\n💰 Amount: KES ${amount}\n🧾 Ref: ${receipt}`);
        
    } catch (err) {
        console.error("Webhook Processing Error:", err);
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

            if (transaction.type === 'Withdrawal') {
                sendTelegramMessage(`✅ <b>WITHDRAWAL APPROVED</b>\n\n👤 User: ${user.firstName} ${user.lastName}\n✉️ Email: ${user.email}\n💰 Amount: KES ${transaction.amount.toLocaleString()}\n🏦 Method: ${transaction.method}\n📍 Destination: <code>${transaction.destination}</code>`);
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