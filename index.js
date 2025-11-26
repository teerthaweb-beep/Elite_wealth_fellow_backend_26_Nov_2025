const express = require('express');
const mongoose = require('mongoose');
const nodemailer = require('nodemailer');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const {
  addMonths,
  setDate,
  endOfMonth,
  startOfMonth,
  format,
} = require('date-fns');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const cron = require('node-cron');
require('dotenv').config();
const tokenBlacklist = new Set();

// ------------------- CONFIG -------------------
const MONGO_URI =
  process.env.MONGO_URI ||
  'mongodb+srv://teerthaweb_db_user:9763767457@cluster0.vcl6nth.mongodb.net/elite_wealth_db?retryWrites=true&w=majority';
const JWT_SECRET = process.env.JWT_SECRET || 'elite-wealth-secret-2025';
const GMAIL_EMAIL = process.env.GMAIL_EMAIL || 'rnmahakalkar@gmail.com';
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD || 'ukkj wfeb vqnh ztpv';
const PORT = process.env.PORT || 4000;

// ------------------- UPLOADS -------------------
// const uploadDir = path.join(__dirname, 'Uploads');
// if (!fs.existsSync(uploadDir)) {
//   fs.mkdirSync(uploadDir, { recursive: true });
//   console.log('Created uploads folder');
// }


const uploadDir = '/tmp/uploads';  // ONLY writable directory

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
  console.log('Created /tmp/uploads folder');
}
// ------------------- MONGOOSE CONNECTION -------------------
async function connectDB() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB Atlas');
  } catch (err) {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  }
}

// ------------------- SCHEMAS -------------------
const profileSchema = new mongoose.Schema({
  user_id: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  first_name: String,
  last_name: String,
  role: {
    type: String,
    enum: ['super_admin', 'manager', 'office_staff'],
    required: true,
  },
  active: { type: Boolean, default: true },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
});

const customerSchema = new mongoose.Schema({
  first_name: String,
  last_name: String,
  email: String,
  phone: String,
  address: String,
  pan_number: String,
  aadhar_number: String,
  plan_id: { type: String, required: true },
  investment_amount: Number,
  // investment_date: String,
  investment_date: {
    type: String,
    default: () => new Date().toISOString().split('T')[0]  // Auto today only on create
    // NOT immutable → can be edited later
  },
  return_method: {
    type: String,
    enum: ['Bank', 'Cash', 'USDT', 'Pre-IPO'],
    default: 'Bank',
    required: true
  },
  nominee: String,
  nominee_adhar_pan_number: String,
  approval_status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'settled'],
    default: 'pending',
  },
  submitted_by: String,
  reviewed_by: String,
  review_comments: String,
  approved_at: Date,
  created_at: { type: Date, default: Date.now },
  updated_at: Date,
  images: [String],
  agent_id: String,
  bank_name: String,
  account_number: String,
  ifsc_code: String,
  branch: String,
  payable_balance_amount_by_company: Number,
  total_paid_amount_to_customer: Number,
});

const agentSchema = new mongoose.Schema({
  first_name: String,
  last_name: String,
  email: String,
  phone: String,
  address: String,
  pan_number: String,
  agent_type: { type: String, enum: ['Main', 'Sub'], default: 'Main' },
  parent_agent_id: { type: String, default: null },
  commission_percentage: Number,
  approval_status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
  },
  submitted_by: String,
  reviewed_by: String,
  review_comments: String,
  approved_at: Date,
  created_at: { type: Date, default: Date.now },
  updated_at: Date,
  images: [String],
  bank_name: String,
  account_number: String,
  ifsc_code: String,
  branch: String,
});

const companyInvestmentSchema = new mongoose.Schema({
  investment_name: String,
  description: String,
  investment_amount: Number,
  expected_return: Number,
  return_percentage: Number,
  investment_date: String,
  duration_months: Number,
  approval_status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
  },
  submitted_by: String,
  reviewed_by: String,
  review_comments: String,
  approved_at: Date,
  created_at: { type: Date, default: Date.now },
  updated_at: Date,
  images: [String],
});

const planSchema = new mongoose.Schema({
  name: String,
  segment: {
    type: String,
    enum: ['PRE-IPO', 'REAL ESTATE', 'DIRECT', 'INFRASTRUCTURE', 'TRAVEL', 'INVESTMENT'],
  },
  investment_amount: Number,
  duration_months: Number,
  return_percentage: Number,
  discount_percentage: Number,
  payment_type: { type: String, enum: ['Monthly', 'Buyback'] },
  is_active: { type: Boolean, default: true },
  created_at: { type: Date, default: Date.now },
  updated_at: Date,
  created_by: String,
});

const paymentScheduleSchema = new mongoose.Schema({
  customer_id: String,
  amount: Number,
  payment_date: String,
  payment_type: String,
  is_paid: { type: Boolean, default: false },
  paid_at: { type: Date, default: null },
  created_at: { type: Date, default: Date.now },
  is_principal: Boolean,
  interest_amount: Number,
  principal_amount: Number,
  start_date: String,
  payout_month: Number,
  transaction_id: { type: String, default: null },
  payment_method: {
    type: String,
    enum: ['Cash', 'Online', 'Cheq', 'Other', 'None'],
    default: 'None',
  },
  images: { type: [String], default: [] },
});

const agentPaymentSchema = new mongoose.Schema({
  agent_id: String,
  customer_id: String,
  amount: Number,
  payment_date: String,
  is_paid: { type: Boolean, default: false },
  paid_at: { type: Date, default: null },
  created_at: { type: Date, default: Date.now },
  method: {
    type: String,
    enum: ['Cash', 'Online', 'Cheq', 'Other', 'None'],
    default: 'None',
  },
  transaction_id: { type: String, default: null },
  images: { type: [String], default: [] },
});

// const investmentPaymentSchema = new mongoose.Schema({
//   investment_id: String,
//   amount: Number,
//   payment_date: String,
//   is_paid: { type: Boolean, default: false },
//   paid_at: { type: Date, default: null },
//   created_at: { type: Date, default: Date.now },
//   transaction_id: { type: String, default: null },
//   payment_method: {
//     type: String,
//     enum: ['Cash', 'Online', 'Cheq', 'Other', 'None'],
//     default: 'None',
//   },
//   images: { type: [String], default: [] },
// });

const investmentPaymentSchema = new mongoose.Schema({
  investment_id: String,

  amount: Number,               // total amount = interest only
  interest_amount: Number,      // interest part (same as amount)
  principal_amount: Number,     // always 0 for monthly A-type model

  payment_type: {               // NEW FIELD
    type: String,
    enum: ['Monthly', 'Yearly'],
    required: true
  },

  payout_cycle: Number,         // month number (1..duration) or 1 for yearly

  payment_date: String,
  is_paid: { type: Boolean, default: false },
  paid_at: { type: Date, default: null },
  created_at: { type: Date, default: Date.now },

  transaction_id: { type: String, default: null },
  payment_method: {
    type: String,
    enum: ['Cash', 'Online', 'Cheq', 'Other', 'None'],
    default: 'None',
  },
  images: { type: [String], default: [] },
});


const giftPlanSchema = new mongoose.Schema({
  name: String,
  description: String,
  target_investors: Number,
  target_amount: Number,
  reward_type: { type: String, enum: ['BONUS', 'PHYSICAL'] },
  reward_value: Number,
  duration_months: Number,
  is_active: { type: Boolean, default: true },
  created_at: { type: Date, default: Date.now },
  updated_at: Date,
});

const agentRewardSchema = new mongoose.Schema({
  agent_id: String,
  gift_plan_id: String,
  performance_month: String,
  achieved_investors: Number,
  achieved_amount: Number,
  is_rewarded: { type: Boolean, default: false },
  rewarded_at: { type: Date, default: null },
  reward_method: {
    type: String,
    enum: ['Cash', 'Online', 'Cheq', 'Other', 'None'],
    default: 'None',
  },
  transaction_id: { type: String, default: null },
  images: { type: [String], default: [] },
  created_at: { type: Date, default: Date.now },
});

const otpTokenSchema = new mongoose.Schema({
  email: String,
  hashed_otp: String,
  created_at: { type: Date, default: Date.now },
});

const auditTrailSchema = new mongoose.Schema({
  table_name: String,
  record_id: String,
  action: String,
  old_values: Object,
  new_values: Object,
  performed_by: String,
  created_at: { type: Date, default: Date.now },
});

// ------------------- MODELS -------------------
const Profile = mongoose.model('Profile', profileSchema);
const Customer = mongoose.model('Customer', customerSchema);
const Agent = mongoose.model('Agent', agentSchema);
const CompanyInvestment = mongoose.model('CompanyInvestment', companyInvestmentSchema);
const Plan = mongoose.model('Plan', planSchema);
const PaymentSchedule = mongoose.model('PaymentSchedule', paymentScheduleSchema);
const AgentPayment = mongoose.model('AgentPayment', agentPaymentSchema);
const InvestmentPayment = mongoose.model('InvestmentPayment', investmentPaymentSchema);
const GiftPlan = mongoose.model('GiftPlan', giftPlanSchema);
const AgentReward = mongoose.model('AgentReward', agentRewardSchema);
const OtpToken = mongoose.model('OtpToken', otpTokenSchema);
const AuditTrail = mongoose.model('AuditTrail', auditTrailSchema);

// ------------------- EMAIL & MULTER -------------------
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: GMAIL_EMAIL, pass: GMAIL_APP_PASSWORD },
  secure: true,
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) =>
    cb(null, `${uuidv4()}${path.extname(file.originalname)}`),
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!['image/jpeg', 'image/png'].includes(file.mimetype)) {
      return cb(new Error('Only JPG/PNG allowed'));
    }
    cb(null, true);
  },
});

// ------------------- RATE LIMIT -------------------
const authLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10,
  message: { error: { code: 'RATE_LIMIT', message: 'Too many requests' } },
});

// ------------------- ZOD SCHEMAS -------------------
const ProfileCreateSchema = z.object({
  email: z.string().email(),
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  role: z.enum(['super_admin', 'manager', 'office_staff']),
});

const CustomerCreateSchema = z.object({
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  address: z.string().optional(),
  pan_number: z.string().optional(),
  aadhar_number: z.string().optional(),
  plan_id: z.string(),
  investment_amount: z.number().positive(),
  investment_date: z.string().optional(),
  nominee: z.string().optional(),
  nominee_adhar_pan_number: z.string().optional(),
  agent_id: z.string().optional(),
  bank_name: z.string().optional(),
  account_number: z.string().optional(),
  ifsc_code: z.string().optional(),
  branch: z.string().optional(),
  return_method: z.enum(['Bank', 'Cash', 'USDT', 'Pre-IPO']).optional()
});

const AgentCreateSchema = z.object({
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  address: z.string().optional(),
  pan_number: z.string().optional(),
  agent_type: z.enum(['Main', 'Sub']),
  parent_agent_id: z.string().optional(),
  commission_percentage: z.number().positive().max(100),
  bank_name: z.string().optional(),
  account_number: z.string().optional(),
  ifsc_code: z.string().optional(),
  branch: z.string().optional(),
});

const CompanyInvestmentCreateSchema = z.object({
  investment_name: z.string().min(1),
  description: z.string().optional(),
  investment_amount: z.number().positive(),
  expected_return: z.number().positive().optional(),
  return_percentage: z.number().positive().optional(),
  investment_date: z.string(),
  duration_months: z.number().positive(),
});

const PlanCreateSchema = z.object({
  name: z.string().min(1),
  segment: z.enum(['PRE-IPO', 'REAL ESTATE', 'DIRECT', 'INFRASTRUCTURE', 'TRAVEL', 'INVESTMENT']),
  investment_amount: z.number().positive(),
  duration_months: z.number().positive(),
  return_percentage: z.number().positive().max(100),
  discount_percentage: z.number().optional(),
  payment_type: z.enum(['Monthly', 'Buyback']).optional(),
  is_active: z.boolean().default(true),
});

const AgentPaymentCreateSchema = z.object({
  agent_id: z.string(),
  customer_id: z.string().optional(),
  amount: z.number().positive(),
  payment_date: z.string(),
  method: z.string().optional(),
  transaction_id: z.string().optional(),
});

const GiftPlanCreateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  target_investors: z.number().positive(),
  target_amount: z.number().positive(),
  reward_type: z.enum(['BONUS', 'PHYSICAL']),
  reward_value: z.number().positive(),
  duration_months: z.number().positive(),
  is_active: z.boolean().default(true),
});

const AgentRewardCreateSchema = z.object({
  agent_id: z.string(),
  gift_plan_id: z.string(),
  performance_month: z.string().regex(/^\d{4}-\d{2}$/),
  achieved_investors: z.number().min(0),
  achieved_amount: z.number().min(0),
});

// ------------------- UTILS -------------------
async function hashPassword(p) {
  return await bcrypt.hash(p, 10);
}
function generateToken(p) {
  return jwt.sign(p, JWT_SECRET, { expiresIn: '24h' });
}
// function verifyToken(t) {
//   try {
//     return jwt.verify(t, JWT_SECRET);
//   } catch {
//     throw new Error('Invalid token');
//   }
// }

function verifyToken(t) {
  try {
    if (tokenBlacklist.has(t)) {
      throw new Error('Token has been revoked');
    }
    return jwt.verify(t, JWT_SECRET);
  } catch (err) {
    throw new Error('Invalid or revoked token');
  }
}
async function auditLog(table, id, action, oldV, newV, by) {
  try {
    await AuditTrail.create({
      table_name: table,
      record_id: id,
      action,
      old_values: oldV,
      new_values: newV,
      performed_by: by,
    });
  } catch (e) {
    console.error('Audit error:', e);
  }
}
async function maskPII(data, role) {
  if (role === 'office_staff') {
    return {
      ...data,
      address: data.address ? 'HIDDEN' : undefined,
      pan_number: data.pan_number ? 'HIDDEN' : undefined,
      aadhar_number: data.aadhar_number ? 'HIDDEN' : undefined,
      nominee: data.nominee ? 'HIDDEN' : undefined,
      nominee_adhar_pan_number: data.nominee_adhar_pan_number ? 'HIDDEN' : undefined,
    };
  }
  return data;
}
async function uploadImages(files) {
  const urls = files.map(
    (f) => `http://localhost:${PORT}/uploads/${f.filename}`
  );
  await auditLog('images', uuidv4(), 'UPLOAD_IMAGE', null, { urls }, null);
  return urls;
}
function calculateReturnFields({
  investment_amount,
  expected_return,
  return_percentage,
  duration_months,
}) {
  if (expected_return && !return_percentage) {
    return_percentage =
      (expected_return / investment_amount) * 100 * 12 / duration_months;
  } else if (return_percentage && !expected_return) {
    expected_return =
      investment_amount * (return_percentage / 100) * duration_months / 12;
  }
  return { expected_return, return_percentage };
}

// ------------------- PAYMENT SCHEDULE -------------------
// async function generatePaymentSchedule(customer_id, amount, invDate, plan) {
//   const base = new Date(invDate || new Date());
//   const day = base.getDate();
//   const payDay = day <= 15 ? 15 : 30;
//   let first = setDate(base, payDay);
//   if (first <= base) first = addMonths(first, 1);
//   const start = first.toISOString().split('T')[0];
//   const schedules = [];

//   if (plan.segment === 'INFRASTRUCTURE') {
//     const adj = amount * (1 - (plan.discount_percentage || 0) / 100);
//     if (plan.payment_type === 'Buyback') {
//       schedules.push({
//         customer_id,
//         amount: adj,
//         payment_date: addMonths(first, plan.duration_months)
//           .toISOString()
//           .split('T')[0],
//         payment_type: 'Buyback',
//         is_paid: false,
//         is_principal: true,
//         principal_amount: adj,
//         interest_amount: 0,
//         start_date: start,
//         payout_month: 1,
//       });
//     } else {
//       const monthly = adj / plan.duration_months;
//       for (let i = 1; i <= plan.duration_months; i++) {
//         schedules.push({
//           customer_id,
//           amount: monthly,
//           payment_date: addMonths(first, i - 1).toISOString().split('T')[0],
//           payment_type: 'Monthly',
//           is_paid: false,
//           is_principal: i === plan.duration_months,
//           principal_amount: i === plan.duration_months ? adj : 0,
//           interest_amount: monthly,
//           start_date: start,
//           payout_month: i,
//         });
//       }
//     }
//   } else {
//     const monthlyInterest = (amount * plan.return_percentage) / 100 / 12;
//     if (plan.payment_type === 'Buyback') {
//       const totalReturn =
//         amount * plan.return_percentage / 100 * plan.duration_months / 12;
//       schedules.push({
//         customer_id,
//         amount: amount + totalReturn,
//         payment_date: addMonths(first, plan.duration_months)
//           .toISOString()
//           .split('T')[0],
//         payment_type: 'Buyback',
//         is_paid: false,
//         is_principal: true,
//         principal_amount: amount,
//         interest_amount: totalReturn,
//         start_date: start,
//         payout_month: 1,
//       });
//     } else {
//       for (let i = 1; i <= 13; i++) {
//         const isLast = i === 13;
//         const amt = isLast ? amount + monthlyInterest : monthlyInterest;
//         schedules.push({
//           customer_id,
//           amount: amt,
//           payment_date: addMonths(first, i - 1).toISOString().split('T')[0],
//           payment_type: 'Monthly',
//           is_paid: false,
//           is_principal: isLast,
//           principal_amount: isLast ? amount : 0,
//           interest_amount: monthlyInterest,
//           start_date: start,
//           payout_month: i,
//         });
//       }
//     }
//   }
//   const data = await PaymentSchedule.insertMany(schedules);
//   await auditLog(
//     'payment_schedules',
//     customer_id,
//     'GENERATE_SCHEDULE',
//     null,
//     { count: data.length },
//     null
//   );
//   return data;
// }


// ------------------- PAYMENT SCHEDULE (UPDATED) -------------------
// async function generatePaymentSchedule(customer_id, amount, invDate, plan) {
 
//   const base = new Date(invDate || new Date());
//   const day = base.getDate();

  
//   const payDay = day <= 15 ? 15 : new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();


//   let first = new Date(base.getFullYear(), base.getMonth() + 1, payDay);
//   const start = first.toISOString().split('T')[0];
//   const schedules = [];

//   // -----------------------------------------------------------------
//   // INFRASTRUCTURE segment
//   // -----------------------------------------------------------------
//   if (plan.segment === 'INFRASTRUCTURE') {
//     const adj = amount * (1 - (plan.discount_percentage || 0) / 100);

//     if (plan.payment_type === 'Buyback') {
//       schedules.push({
//         customer_id,
//         amount: adj,
//         payment_date: addMonths(first, plan.duration_months)
//           .toISOString()
//           .split('T')[0],
//         payment_type: 'Buyback',
//         is_paid: false,
//         is_principal: true,
//         principal_amount: adj,
//         interest_amount: 0,
//         start_date: start,
//         payout_month: 1,
//       });
//     } else {
//       const monthly = adj / plan.duration_months;
//       for (let i = 1; i <= plan.duration_months; i++) {
//         schedules.push({
//           customer_id,
//           amount: monthly,
//           payment_date: addMonths(first, i - 1).toISOString().split('T')[0],
//           payment_type: 'Monthly',
//           is_paid: false,
//           is_principal: i === plan.duration_months,
//           principal_amount: i === plan.duration_months ? adj : 0,
//           interest_amount: monthly,
//           start_date: start,
//           payout_month: i,
//         });
//       }
//     }

//   // -----------------------------------------------------------------
//   // ALL OTHER segments (PRE-IPO, REAL ESTATE, DIRECT, …)
//   // -----------------------------------------------------------------
//   } else {
   

//     if (plan.payment_type === 'Buyback') {
//       const totalReturn =
//         amount * plan.return_percentage / 100 * plan.duration_months / 12;
//       schedules.push({
//         customer_id,
//         amount: amount + totalReturn,
//         payment_date: addMonths(first, plan.duration_months)
//           .toISOString()
//           .split('T')[0],
//         payment_type: 'Buyback',
//         is_paid: false,
//         is_principal: true,
//         principal_amount: amount,
//         interest_amount: totalReturn,
//         start_date: start,
//         payout_month: 1,
//       });
//     // } else {
//     //   // 12 interest payments + 13th principal
//     //   for (let i = 1; i <= 13; i++) {
//     //     const isLast = i === 13;
//     //     const amt = isLast ? amount + monthlyInterest : monthlyInterest;
//     //     schedules.push({
//     //       customer_id,
//     //       amount: amt,
//     //       payment_date: addMonths(first, i - 1).toISOString().split('T')[0],
//     //       payment_type: 'Monthly',
//     //       is_paid: false,
//     //       is_principal: isLast,
//     //       principal_amount: isLast ? amount : 0,
//     //       interest_amount: monthlyInterest,
//     //       start_date: start,
//     //       payout_month: i,
//     //     });
//     //   }
//     // }
// }else {

//   // return percentage is already MONTHLY
//   const monthlyInterest = amount * ((plan.return_percentage || 0) / 100);

//   // pay monthly interest for duration months
//   for (let i = 1; i <= plan.duration_months; i++) {
//     schedules.push({
//       customer_id,
//       amount: monthlyInterest,
//       payment_date: addMonths(first, i - 1).toISOString().split('T')[0],
//       payment_type: 'Monthly',
//       is_paid: false,
//       is_principal: false,
//       principal_amount: 0,
//       interest_amount: monthlyInterest,
//       start_date: start,
//       payout_month: i,
//     });
//   }

//   // final payment → principal return
//   const maturityDate = addMonths(first, plan.duration_months);

//   schedules.push({
//     customer_id,
//     amount: amount,
//     payment_date: maturityDate.toISOString().split('T')[0],
//     payment_type: 'Monthly',
//     is_paid: false,
//     is_principal: true,
//     principal_amount: amount,
//     interest_amount: 0,
//     start_date: start,
//     payout_month: plan.duration_months + 1,
//   });
// }
//   }

//   const data = await PaymentSchedule.insertMany(schedules);
//   await auditLog(
//     'payment_schedules',
//     customer_id,
//     'GENERATE_SCHEDULE',
//     null,
//     { count: data.length, first_payment: start },
//     null
//   );
//   return data;
// }


// Replace the existing generatePaymentSchedule(...) implementation with this one
async function generatePaymentSchedule(customer_id, amount, invDate, plan) {
  // invDate = customer's investment_date (or created_at if not supplied)
  const base = new Date(invDate || new Date());
  const day = base.getDate();

  
  // const lastDayOfBaseMonth = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
  // const payDay = day >= 1 && day <= 15 ? 15 : Math.min(30, lastDayOfBaseMonth);

 
  // const first = new Date(base.getFullYear(), base.getMonth() + 1, payDay);
  // const start = first.toISOString().split('T')[0];

  let payDay;

if (day <= 15) {
  payDay = 15;
} else {
  // Check next month index
  const nextMonth = base.getMonth() + 1; // 0 = Jan, 1 = Feb
  const isFebruary = nextMonth === 1;

  if (isFebruary) {
    // Last day of February (28/29)
    payDay = new Date(base.getFullYear(), nextMonth + 1, 0).getDate();
  } else {
    // Always 30 for all other months
    payDay = 30;
  }
}

// Create payout date using UTC to avoid timezone shifting to 14 or 29
const first = new Date(Date.UTC(base.getFullYear(), base.getMonth() + 1, payDay));
const start = first.toISOString().split('T')[0];


  const schedules = [];
  const duration = Number(plan.duration_months || 12);

  // Helper to ISO date
  const iso = (d) => d.toISOString().split('T')[0];

  // ----------------------------------------------------------------
  // INFRASTRUCTURE - DO NOT CHANGE (keep existing behavior)
  // ----------------------------------------------------------------
  if (plan.segment === 'INFRASTRUCTURE') {
    const adjustedAmount = amount * (1 - (plan.discount_percentage || 0) / 100);

    if (plan.payment_type === 'Buyback') {
      // single buyback payment: principal only (interest handled elsewhere originally)
      schedules.push({
        customer_id,
        amount: adjustedAmount,
        payment_date: iso(addMonths(first, duration)),
        payment_type: 'Buyback',
        is_paid: false,
        is_principal: true,
        principal_amount: adjustedAmount,
        interest_amount: 0,
        start_date: start,
        payout_month: 1,
      });
    } else {
      // Monthly installments dividing adjusted principal across months
      const monthlyAmount = adjustedAmount / duration;
      for (let i = 1; i <= duration; i++) {
        schedules.push({
          customer_id,
          amount: monthlyAmount,
          payment_date: iso(addMonths(first, i - 1)),
          payment_type: 'Monthly',
          is_paid: false,
          is_principal: i === duration,
          principal_amount: i === duration ? adjustedAmount : 0,
          interest_amount: monthlyAmount,
          start_date: start,
          payout_month: i,
        });
      }
    }

  // ----------------------------------------------------------------
  // PRE-IPO
  // ----------------------------------------------------------------
  } else if (plan.segment === 'PRE-IPO') {
    if (plan.payment_type === 'Buyback') {
      // return_percentage is TOTAL interest percentage (per user)
      const totalInterest = amount * ((plan.return_percentage || 0) / 100);
      schedules.push({
        customer_id,
        amount: parseFloat((amount + totalInterest).toFixed(2)),
        payment_date: iso(addMonths(first, duration)),
        payment_type: 'Buyback',
        is_paid: false,
        is_principal: true,
        principal_amount: amount,
        interest_amount: parseFloat(totalInterest.toFixed(2)),
        start_date: start,
        payout_month: 1,
      });
    } else {
      // Monthly: return_percentage is MONTHLY interest percentage (per user)
      const monthlyInterest = amount * ((plan.return_percentage || 0) / 100);

      for (let i = 1; i <= duration; i++) {
        schedules.push({
          customer_id,
          amount: parseFloat(monthlyInterest.toFixed(2)),
          payment_date: iso(addMonths(first, i - 1)),
          payment_type: 'Monthly',
          is_paid: false,
          is_principal: false, // PRE-IPO monthly pays only interest (no principal return)
          principal_amount: 0,
          interest_amount: parseFloat(monthlyInterest.toFixed(2)),
          start_date: start,
          payout_month: i,
        });
      }
      // NOTE: per your instruction PRE-IPO monthly DOES NOT return principal at maturity.
    }

  // ----------------------------------------------------------------
  // DIRECT
  // ----------------------------------------------------------------
  } else if (plan.segment === 'DIRECT') {
    if (plan.payment_type === 'Buyback') {
      // return_percentage is TOTAL interest percentage
      const totalInterest = amount * ((plan.return_percentage || 0) / 100);
      schedules.push({
        customer_id,
        amount: parseFloat((amount + totalInterest).toFixed(2)),
        payment_date: iso(addMonths(first, duration)),
        payment_type: 'Buyback',
        is_paid: false,
        is_principal: true,
        principal_amount: amount,
        interest_amount: parseFloat(totalInterest.toFixed(2)),
        start_date: start,
        payout_month: 1,
      });
    } else {
      // Monthly: return_percentage is MONTHLY interest percentage
      const monthlyInterest = amount * ((plan.return_percentage || 0) / 100);

      for (let i = 1; i <= duration; i++) {
        const isLast = i === duration;
        schedules.push({
          customer_id,
          amount: parseFloat((isLast ? monthlyInterest + amount : monthlyInterest).toFixed(2)),
          payment_date: iso(addMonths(first, i - 1)),
          payment_type: 'Monthly',
          is_paid: false,
          is_principal: isLast,
          principal_amount: isLast ? amount : 0,
          interest_amount: parseFloat(monthlyInterest.toFixed(2)),
          start_date: start,
          payout_month: i,
        });
      }
    }

  // ----------------------------------------------------------------
  // TRAVEL  (behaves same as DIRECT per your rules)
  // ----------------------------------------------------------------
  } else if (plan.segment === 'TRAVEL') {
    if (plan.payment_type === 'Buyback') {
      const totalInterest = amount * ((plan.return_percentage || 0) / 100);
      schedules.push({
        customer_id,
        amount: parseFloat((amount + totalInterest).toFixed(2)),
        payment_date: iso(addMonths(first, duration)),
        payment_type: 'Buyback',
        is_paid: false,
        is_principal: true,
        principal_amount: amount,
        interest_amount: parseFloat(totalInterest.toFixed(2)),
        start_date: start,
        payout_month: 1,
      });
    } else {
      const monthlyInterest = amount * ((plan.return_percentage || 0) / 100);
      for (let i = 1; i <= duration; i++) {
        const isLast = i === duration;
        schedules.push({
          customer_id,
          amount: parseFloat((isLast ? monthlyInterest + amount : monthlyInterest).toFixed(2)),
          payment_date: iso(addMonths(first, i - 1)),
          payment_type: 'Monthly',
          is_paid: false,
          is_principal: isLast,
          principal_amount: isLast ? amount : 0,
          interest_amount: parseFloat(monthlyInterest.toFixed(2)),
          start_date: start,
          payout_month: i,
        });
      }
    }

  // ----------------------------------------------------------------
  // INVESTMENT (special: total return % then divide total amount across months)
  // ----------------------------------------------------------------
  } else if (plan.segment === 'INVESTMENT') {
    // As per your rule: return_percentage is TOTAL interest percentage
    const totalAmount = amount * (1 + ((plan.return_percentage || 0) / 100));
    const monthlyInstallment = totalAmount / (duration || 1);

    for (let i = 1; i <= duration; i++) {
      // Each installment contains principal + interest portion
      schedules.push({
        customer_id,
        amount: parseFloat(monthlyInstallment.toFixed(2)),
        payment_date: iso(addMonths(first, i - 1)),
        payment_type: 'Monthly',
        is_paid: false,
        is_principal: i === duration, // final installment flagged as principal return
        principal_amount: i === duration ? parseFloat(amount.toFixed(2)) : 0,
        interest_amount: parseFloat((monthlyInstallment - (amount / duration)).toFixed(2)),
        start_date: start,
        payout_month: i,
      });
    }

  // ----------------------------------------------------------------
  // DEFAULT / OTHER segments (fallback) - keep safe behavior
  // ----------------------------------------------------------------
  } else {
    // Fallback: if buyback treat return_percentage as TOTAL (like earlier default),
    // if monthly treat return_percentage as ANNUAL (old behavior) — but this should
    // rarely be used if your segments are covered above.
    if (plan.payment_type === 'Buyback') {
      const totalReturn = amount * ((plan.return_percentage || 0) / 100) * (duration / 12);
      schedules.push({
        customer_id,
        amount: parseFloat((amount + totalReturn).toFixed(2)),
        payment_date: iso(addMonths(first, duration)),
        payment_type: 'Buyback',
        is_paid: false,
        is_principal: true,
        principal_amount: amount,
        interest_amount: parseFloat(totalReturn.toFixed(2)),
        start_date: start,
        payout_month: 1,
      });
    } else {
      // treat return_percentage as ANNUAL -> monthly interest = (amount * annual%) / 12
      const monthlyInterest = (amount * ((plan.return_percentage || 0) / 100)) / 12;
      for (let i = 1; i <= duration; i++) {
        const isLast = i === duration;
        schedules.push({
          customer_id,
          amount: parseFloat((isLast ? monthlyInterest + amount : monthlyInterest).toFixed(2)),
          payment_date: iso(addMonths(first, i - 1)),
          payment_type: 'Monthly',
          is_paid: false,
          is_principal: isLast,
          principal_amount: isLast ? amount : 0,
          interest_amount: parseFloat(monthlyInterest.toFixed(2)),
          start_date: start,
          payout_month: i,
        });
      }
    }
  }

  // Persist and audit
  const data = await PaymentSchedule.insertMany(schedules);
  await auditLog('payment_schedules', customer_id, 'GENERATE_SCHEDULE', null, { count: data.length, first_payment: start }, null);
  return data;
}





// ------------------- AGENT PAYMENTS -------------------
// async function generateAgentPayments(customer_id, agent_id, amount, approved_at) {
//   const payments = [];
//   let agent = await Agent.findById(agent_id);
//   const payDate = addMonths(new Date(approved_at), 1).toISOString().split('T')[0];

//   while (agent) {
//     const comm = (amount * agent.commission_percentage) / 100;
//     payments.push({
//       agent_id: agent._id,
//       customer_id,
//       amount: comm,
//       payment_date: payDate,
//       is_paid: false,
//     });

//     if (agent.parent_agent_id) {
//       const parent = await Agent.findById(agent.parent_agent_id);
//       if (parent && parent.commission_percentage > agent.commission_percentage) {
//         const diff =
//           (amount * (parent.commission_percentage - agent.commission_percentage)) /
//           100;
//         if (diff > 0)
//           payments.push({
//             agent_id: parent._id,
//             customer_id,
//             amount: diff,
//             payment_date: payDate,
//             is_paid: false,
//           });
//       }
//       agent = parent;
//     } else break;
//   }

//   if (payments.length) {
//     const data = await AgentPayment.insertMany(payments);
//     await auditLog(
//       'agent_payments',
//       customer_id,
//       'GENERATE_PAYMENTS',
//       null,
//       { count: data.length },
//       null
//     );
//     return data;
//   }
//   return [];
// }


async function generateAgentPayments(customer_id, direct_agent_id, amount, approved_at) {
  const payments = [];
  const approvedDate = new Date(approved_at);
  const payment_date = approvedDate.toISOString().split('T')[0]; // SAME MONTH

  let current_agent = await Agent.findById(direct_agent_id);
  if (!current_agent || current_agent.approval_status !== 'approved') return [];

  let prev_commission = 0;

  while (current_agent) {
    const current_commission = current_agent.commission_percentage || 0;

    // Only pay if this agent has higher commission than child
    if (current_commission > prev_commission) {
      const payable = (amount * (current_commission - prev_commission)) / 100;
      payments.push({
        agent_id: current_agent._id,
        customer_id,
        amount: payable,
        payment_date,
        is_paid: false,
        created_at: new Date(),
      });
    }

    // Stop if no parent
    if (!current_agent.parent_agent_id) break;

    // Move to parent
    const parent = await Agent.findById(current_agent.parent_agent_id);
    if (!parent || parent.approval_status !== 'approved') break;

    prev_commission = current_commission;
    current_agent = parent;
  }

  if (payments.length > 0) {
    const data = await AgentPayment.insertMany(payments);
    await auditLog(
      'agent_payments',
      customer_id,
      'GENERATE_PAYMENTS',
      null,
      { count: data.length, payment_date },
      null
    );
    return data;
  }

  return [];
}
// ------------------- AGENT REWARDS -------------------
async function generateAgentRewards(customer_id, agent_id, amount, approved_at) {
  const month = approved_at.toISOString().slice(0, 7);
  let agent = await Agent.findById(agent_id);
  const rewards = [];

  while (agent) {
    const giftPlans = await GiftPlan.find({ is_active: true });
    for (const gp of giftPlans) {
      const customers = await Customer.find({
        agent_id: agent._id,
        approval_status: 'approved',
        approved_at: {
          $gte: startOfMonth(new Date(month)),
          $lte: endOfMonth(new Date(month)),
        },
      });
      const achieved_investors = customers.length;
      const achieved_amount = customers.reduce(
        (s, c) => s + c.investment_amount,
        0
      );
      if (
        achieved_investors >= gp.target_investors ||
        achieved_amount >= gp.target_amount
      ) {
        rewards.push({
          agent_id: agent._id,
          gift_plan_id: gp._id,
          performance_month: month,
          achieved_investors,
          achieved_amount,
          is_rewarded: false,
        });
      }
    }
    agent = agent.parent_agent_id
      ? await Agent.findById(agent.parent_agent_id)
      : null;
  }

  if (rewards.length) {
    const data = await AgentReward.insertMany(rewards);
    await auditLog(
      'agent_rewards',
      customer_id,
      'GENERATE_REWARDS',
      null,
      { count: data.length },
      null
    );
    return data;
  }
  return [];
}

// ------------------- INVESTMENT AUTO-PAYMENT -------------------
// async function generateInvestmentPaymentOnApproval(inv) {
//   const paymentDate = addMonths(
//     new Date(inv.investment_date),
//     inv.duration_months
//   )
//     .toISOString()
//     .split('T')[0];
//   let profit = 0;
//   if (inv.return_percentage)
//     profit =
//       inv.investment_amount *
//       (inv.return_percentage / 100) *
//       (inv.duration_months / 12);
//   else if (inv.expected_return) profit = inv.expected_return;
//   const total = inv.investment_amount + profit;

//   const payment = await InvestmentPayment.create({
//     investment_id: inv._id,
//     amount: parseFloat(total.toFixed(2)),
//     payment_date: paymentDate,
//     is_paid: false,
//   });

//   await auditLog(
//     'investment_payments',
//     inv._id,
//     'AUTO_GENERATE_ON_APPROVAL',
//     null,
//     { total, profit },
//     'system'
//   );
//   return payment;
// }


async function generateInvestmentPaymentOnApproval(inv) {
  if (!inv.duration_months) {
    throw new Error("duration_months is required");
  }
  if (inv.return_percentage === undefined || inv.return_percentage === null) {
    throw new Error("return_percentage is required");
  }

  const startDate = new Date(inv.investment_date);

  // Monthly percentage (A-Model)
  const monthlyRate = inv.return_percentage / 100;

  // Monthly interest
  const monthlyInterest = inv.investment_amount * monthlyRate;

  const schedule = [];

  for (let m = 1; m <= inv.duration_months; m++) {
    const payment_date = addMonths(startDate, m).toISOString().split("T")[0];

    schedule.push({
      investment_id: inv._id,

      amount: parseFloat(monthlyInterest.toFixed(2)),
      interest_amount: parseFloat(monthlyInterest.toFixed(2)),
      principal_amount: 0,

      payment_type: "Monthly",
      payout_cycle: m,

      payment_date,
      is_paid: false,
      created_at: new Date(),
    });
  }

  const payments = await InvestmentPayment.insertMany(schedule);

  await auditLog(
    "investment_payments",
    inv._id,
    "AUTO_GENERATE_MONTHLY_PAYMENTS",
    null,
    { monthlyInterest, months: inv.duration_months },
    "system"
  );

  return payments;
}


// ------------------- EXCEL EXPORT -------------------
async function exportToExcel(data, columns, filename) {
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Export');
  ws.columns = columns;
  ws.addRows(data);
  const buffer = await workbook.xlsx.writeBuffer();
  return { buffer, filename };
}

// ------------------- CLEANUP CRON -------------------
cron.schedule('0 0 * * *', async () => {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  await Customer.deleteMany({
    approval_status: 'rejected',
    updated_at: { $lte: twentyFourHoursAgo },
  });
  await CompanyInvestment.deleteMany({
    approval_status: 'rejected',
    updated_at: { $lte: twentyFourHoursAgo },
  });
  await auditLog('cleanup', null, 'DELETE_REJECTED', null, {}, null);
});

// ------------------- EXPRESS APP -------------------
const app = express();
app.use(helmet());
app.use(cors());
// app.use(cors({
//   origin: 'http://localhost:8080 ', // your frontend
//   credentials: true,
//   methods: ['GET', 'POST', 'PATCH', 'DELETE'],
//   allowedHeaders: ['Content-Type', 'Authorization'],
// }));
app.use(express.json({ limit: '10mb' }));
app.use('/uploads', express.static(uploadDir));
app.use('/auth', authLimiter);

// ------------------- MIDDLEWARE -------------------
const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token)
    return res
      .status(401)
      .json({ data: null, error: { code: 'UNAUTHORIZED', message: 'No token' } });
  try {
    req.user = verifyToken(token);
    next();
  } catch {
    res
      .status(401)
      .json({ data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid token' } });
  }
};

const rbacMiddleware = (roles) => (req, res, next) => {
  if (!roles.includes(req.user.role))
    return res
      .status(403)
      .json({ data: null, error: { code: 'FORBIDDEN', message: 'Insufficient role' } });
  next();
};

// ------------------- DATABASE SEEDING -------------------
async function setupDatabase() {
  try {
    const adminExists = await Profile.findOne({ email: 'ritikmahakalkar16@gmail.com' });
    if (!adminExists) {
      await Profile.create({
        user_id: uuidv4(),
        email: 'ritikmahakalkar16@gmail.com',
        first_name: 'Ritik',
        last_name: 'Mahakalkar',
        role: 'super_admin',
        active: true,
      });
      console.log('Seeded super_admin profile');
    }

    const plansCount = await Plan.countDocuments();
    if (plansCount === 0) {
      const samplePlans = [
        {
          name: 'PRE-IPO Fund',
          segment: 'PRE-IPO',
          investment_amount: 100000,
          duration_months: 12,
          return_percentage: 2,
          payment_type: 'Monthly',
          is_active: true,
        },
        {
          name: 'Real Estate Investment',
          segment: 'REAL ESTATE',
          investment_amount: 50000,
          duration_months: 12,
          return_percentage: 1.5,
          payment_type: 'Buyback',
          is_active: true,
        },
        {
          name: 'Direct Equity',
          segment: 'DIRECT',
          investment_amount: 200000,
          duration_months: 12,
          return_percentage: 3,
          payment_type: 'Monthly',
          is_active: true,
        },
        {
          name: 'Infrastructure Fund',
          segment: 'INFRASTRUCTURE',
          duration_months: 12,
          discount_percentage: 5,
          payment_type: 'Monthly',
          is_active: true,
        },
      ];
      await Plan.insertMany(samplePlans);
      console.log('Seeded sample plans');
    }
  } catch (error) {
    console.error('Seeding error:', error);
  }
}

// ------------------- AUTH ROUTES -------------------
async function sendOTP(email) {
  const profile = await Profile.findOne({ email });
  if (!profile) throw new Error('Email not found');

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const hashedOtp = await hashPassword(otp);
  await OtpToken.create({ email, hashed_otp: hashedOtp });

  await transporter.sendMail({
    from: GMAIL_EMAIL,
    to: email,
    subject: 'Elite Wealth OTP',
    html: `<h1>Elite Wealth OTP</h1><p>Your OTP is <strong>${otp}</strong>.</p>`,
  });
}

app.post('/auth/sessions', async (req, res) => {
  try {
    const { email } = ProfileCreateSchema.pick({ email: true }).parse(req.body);
    await sendOTP(email);
    res.json({ data: { success: true }, error: null });
  } catch (error) {
    res
      .status(400)
      .json({ data: null, error: { code: 'AUTH_ERROR', message: error.message } });
  }
});

// ------------------- RESEND OTP (WITH FULL sendOTP LOGIC) -------------------
app.post(
  '/auth/resend-session',
  authLimiter, // 10 requests per 5 min
  async (req, res) => {
    try {
      const { email } = ProfileCreateSchema.pick({ email: true }).parse(req.body);

      // 1. Check if profile exists
      const profile = await Profile.findOne({ email });
      if (!profile) {
        return res.status(404).json({
          data: null,
          error: { code: 'EMAIL_NOT_FOUND', message: 'Email not registered' },
        });
      }

      if (!profile.active) {
        return res.status(403).json({
          data: null,
          error: { code: 'ACCOUNT_INACTIVE', message: 'Account is deactivated' },
        });
      }

      // 2. Delete any existing OTP
      await OtpToken.deleteOne({ email });

      // 3. Generate new OTP
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const hashedOtp = await hashPassword(otp);
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

      // 4. Save new OTP
      await OtpToken.create({
        email,
        hashed_otp: hashedOtp,
        expires_at: expiresAt,
      });

      // 5. Send OTP via Gmail
      await transporter.sendMail({
        from: `"Elite Wealth" <${GMAIL_EMAIL}>`,
        to: email,
        subject: 'Elite Wealth - Your OTP Code',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
            <h2 style="color: #1f4e79;">Elite Wealth</h2>
            <p>Hello <strong>${profile.first_name || 'User'}</strong>,</p>
            <p>Your new OTP is:</p>
            <h1 style="font-size: 32px; letter-spacing: 5px; color: #1f4e79; text-align: center;">${otp}</h1>
            <p>This OTP is valid for <strong>5 minutes</strong>.</p>
            <p>If you didn't request this, please ignore.</p>
            <hr>
            <small style="color: #888;">© ${new Date().getFullYear()} Elite Wealth. All rights reserved.</small>
          </div>
        `,
      });

      // 6. Audit log
      await auditLog('auth', email, 'RESEND_OTP', null, { success: true }, null);

      // 7. Success response
      res.json({
        data: {
          success: true,
          message: 'OTP sent successfully to your email',
          expires_in: '5 minutes',
        },
        error: null,
      });
    } catch (error) {
      if (error.name === 'ZodError') {
        return res.status(400).json({
          data: null,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid email format' },
        });
      }

      console.error('Resend OTP Error:', error);
      await auditLog('auth', req.body.email || 'unknown', 'RESEND_OTP_FAILED', null, { error: error.message }, null);

      res.status(500).json({
        data: null,
        error: { code: 'RESEND_FAILED', message: 'Failed to resend OTP. Please try again.' },
      });
    }
  }
);

app.post('/auth/login', async (req, res) => {
  try {
    const { email, otp } = req.body;
    const tokenData = await OtpToken.findOne({ email });
    if (!tokenData || !(await bcrypt.compare(otp, tokenData.hashed_otp))) {
      throw new Error('Invalid OTP');
    }

    const user = await Profile.findOne({ email });
    if (!user.active) throw new Error('Account is deactivated');
    const token = generateToken({
      user_id: user.user_id,
      email: user.email,
      role: user.role,
    });
    await OtpToken.deleteOne({ email });

    res.json({
      data: {
        token,
        user: { user_id: user.user_id, email: user.email, role: user.role },
      },
      error: null,
    });
  } catch (error) {
    res
      .status(400)
      .json({ data: null, error: { code: 'AUTH_ERROR', message: error.message } });
  }
});


// ------------------- LOGOUT API -------------------
app.post('/auth/logout', authMiddleware, async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(400).json({
        data: null,
        error: { code: 'BAD_REQUEST', message: 'No token provided' },
      });
    }

    // Blacklist the token (in-memory)
    tokenBlacklist.add(token);

    // Optional: Auto-remove after expiry
    const decoded = jwt.decode(token);
    if (decoded?.exp) {
      const timeLeft = (decoded.exp * 1000) - Date.now();
      if (timeLeft > 0) {
        setTimeout(() => tokenBlacklist.delete(token), timeLeft);
      }
    }

    // Audit logout
    await auditLog(
      'auth',
      req.user.user_id,
      'LOGOUT',
      null,
      { message: 'User logged out' },
      req.user.user_id
    );

    res.json({
      data: { success: true, message: 'Logged out successfully' },
      error: null,
    });
  } catch (error) {
    res.status(500).json({
      data: null,
      error: { code: 'LOGOUT_ERROR', message: 'Logout failed' },
    });
  }
});




app.get('/auth/profile', authMiddleware, async (req, res) => {
  try {
    const data = await Profile.findOne({ user_id: req.user.user_id });
    res.json({ data, error: null });
  } catch (error) {
    res
      .status(400)
      .json({ data: null, error: { code: 'PROFILE_ERROR', message: error.message } });
  }
});

// ------------------- PROFILES -------------------
app.get('/profiles', authMiddleware, async (req, res) => {
  try {
    const { page = 1, page_size = 20, search } = req.query;
    const query = search ? { email: { $regex: search, $options: 'i' } } : {};
    const total = await Profile.countDocuments(query);
    const data = await Profile.find(query)
      .skip((page - 1) * page_size)
      .limit(Math.min(page_size, 100))
      .sort({ created_at: -1 });
    res.json({ data: { items: data, total }, error: null });
  } catch (error) {
    res
      .status(400)
      .json({ data: null, error: { code: 'PROFILE_ERROR', message: error.message } });
  }
});

app.post(
  '/profiles',
  authMiddleware,
  rbacMiddleware(['super_admin']),
  async (req, res) => {
    try {
      const validated = ProfileCreateSchema.parse(req.body);
      const user_id = uuidv4();
      const data = await Profile.create({
        ...validated,
        user_id,
        created_at: new Date(),
        updated_at: new Date(),
      });
      await auditLog(
        'profiles',
        data._id,
        'CREATE',
        null,
        data.toObject(),
        req.user.user_id
      );
      res.json({ data, error: null });
    } catch (error) {
      res
        .status(400)
        .json({ data: null, error: { code: 'VALIDATION_ERROR', message: error.message } });
    }
  }
);

app.patch('/profiles/:user_id', authMiddleware, async (req, res) => {
  try {
    if (
      req.user.role !== 'super_admin' &&
      req.params.user_id !== req.user.user_id
    ) {
      throw new Error('Not authorized');
    }
    if (req.params.user_id === req.user.user_id && req.body.active === false) {
      throw new Error('Cannot deactivate self');
    }
    const oldData = await Profile.findOne({ user_id: req.params.user_id });
    const data = await Profile.findOneAndUpdate(
      { user_id: req.params.user_id },
      { ...req.body, updated_at: new Date() },
      { new: true }
    );
    await auditLog(
      'profiles',
      data._id,
      'UPDATE',
      oldData?.toObject(),
      data.toObject(),
      req.user.user_id
    );
    res.json({ data, error: null });
  } catch (error) {
    res
      .status(400)
      .json({ data: null, error: { code: 'VALIDATION_ERROR', message: error.message } });
  }
});

// ------------------- CUSTOMERS -------------------
app.get('/customers', authMiddleware, async (req, res) => {
  try {
    const {
      page = 1,
      page_size = 20,
      status,
      plan_id,
      agent_id,
      search,
    } = req.query;
    const query = {};
    if (status) query.approval_status = status;
    if (plan_id) query.plan_id = plan_id;
    if (agent_id) query.agent_id = agent_id;
    if (search) query.email = { $regex: search, $options: 'i' };
    const total = await Customer.countDocuments(query);
    let data = await Customer.find(query)
      .skip((page - 1) * page_size)
      .limit(Math.min(page_size, 100))
      .sort({ created_at: -1 });
    data = await Promise.all(
      data.map((item) => maskPII(item.toObject(), req.user.role))
    );
    res.json({ data: { items: data, total }, error: null });
  } catch (error) {
    res
      .status(400)
      .json({ data: null, error: { code: 'CUSTOMER_ERROR', message: error.message } });
  }
});

// app.post(
//   '/customers',
//   authMiddleware,
//   rbacMiddleware(['office_staff', 'manager', 'super_admin']),
//   upload.array('files'),
//   async (req, res) => {
//     try {
//       const validated = CustomerCreateSchema.parse(
//         JSON.parse(req.body.data || '{}')
//       );
//       const images = req.files ? await uploadImages(req.files) : [];
//       const data = await Customer.create({
//         ...validated,
//         images,
//         submitted_by: req.user.user_id,
//         created_at: new Date(),
//         updated_at: new Date(),
//         investment_date:
//           validated.investment_date || new Date().toISOString().split('T')[0],
//       });
//       await auditLog(
//         'customers',
//         data._id,
//         'CREATE',
//         null,
//         data.toObject(),
//         req.user.user_id
//       );
//       res.json({ data, error: null });
//     } catch (error) {
//       res
//         .status(400)
//         .json({ data: null, error: { code: 'VALIDATION_ERROR', message: error.message } });
//     }
//   }
// );

app.post(
  '/customers',
  authMiddleware,
  rbacMiddleware(['office_staff', 'manager', 'super_admin']),
  upload.array('files'),
  async (req, res) => {
    try {
      const rawData = JSON.parse(req.body.data || '{}');
      const validated = CustomerCreateSchema.parse(rawData);
      const images = req.files ? await uploadImages(req.files) : [];

      // Auto-set investment_date only if not provided or empty
      const finalInvestmentDate = validated.investment_date && validated.investment_date.trim() !== ''
        ? validated.investment_date
        : new Date().toISOString().split('T')[0];

      const data = await Customer.create({
        ...validated,
        images,
        submitted_by: req.user.user_id,
        created_at: new Date(),
        updated_at: new Date(),

        // Final investment date (auto today if missing)
        investment_date: finalInvestmentDate,

        // New field: return_method (default 'Bank' if not sent)
        return_method: validated.return_method || 'Bank'
      });

      await auditLog(
        'customers',
        data._id,
        'CREATE',
        null,
        data.toObject(),
        req.user.user_id
      );

      res.json({ data, error: null });
    } catch (error) {
      console.error('Customer creation error:', error);
      res.status(400).json({
        data: null,
        error: { code: 'VALIDATION_ERROR', message: error.message || 'Invalid data' }
      });
    }
  }
);

app.post(
  '/customers/:id/approve',
  authMiddleware,
  rbacMiddleware(['manager', 'super_admin']),
  async (req, res) => {
    try {
      const { comments } = req.body;
      const oldData = await Customer.findById(req.params.id);
      if (!oldData) throw new Error('Customer not found');
      const data = await Customer.findByIdAndUpdate(
        req.params.id,
        {
          approval_status: 'approved',
          reviewed_by: req.user.user_id,
          review_comments: comments,
          approved_at: new Date(),
          updated_at: new Date(),
        },
        { new: true }
      );

      const plan = await Plan.findById(data.plan_id);
      if (plan) {
        await generatePaymentSchedule(
          data._id,
          data.investment_amount,
          data.investment_date || data.created_at,
          plan
        );
        if (data.agent_id) {
          await generateAgentPayments(
            data._id,
            data.agent_id,
            data.investment_amount,
            data.approved_at
          );
          await generateAgentRewards(
            data._id,
            data.agent_id,
            data.investment_amount,
            data.approved_at
          );
        }
      }

      await auditLog(
        'customers',
        data._id,
        'APPROVE',
        oldData?.toObject(),
        data.toObject(),
        req.user.user_id
      );
      res.json({ data: { success: true, updated: data }, error: null });
    } catch (error) {
      res
        .status(400)
        .json({ data: null, error: { code: 'APPROVAL_ERROR', message: error.message } });
    }
  }
);

app.post(
  '/customers/:id/reject',
  authMiddleware,
  rbacMiddleware(['manager', 'super_admin']),
  async (req, res) => {
    try {
      const { comments } = req.body;
      const oldData = await Customer.findById(req.params.id);
      if (!oldData) throw new Error('Customer not found');
      const data = await Customer.findByIdAndUpdate(
        req.params.id,
        {
          approval_status: 'rejected',
          reviewed_by: req.user.user_id,
          review_comments: comments,
          updated_at: new Date(),
        },
        { new: true }
      );
      await auditLog(
        'customers',
        data._id,
        'REJECT',
        oldData?.toObject(),
        data.toObject(),
        req.user.user_id
      );
      res.json({ data: { success: true, updated: data }, error: null });
    } catch (error) {
      res
        .status(400)
        .json({ data: null, error: { code: 'APPROVAL_ERROR', message: error.message } });
    }
  }
);

app.patch(
  '/customers/:id',
  authMiddleware,
  rbacMiddleware(['office_staff', 'manager', 'super_admin']),
  upload.array('files'),
  async (req, res) => {
    try {
      const validated = CustomerCreateSchema.partial().parse(
        JSON.parse(req.body.data || '{}')
      );
      const oldData = await Customer.findById(req.params.id);
      if (!oldData) throw new Error('Customer not found');
      const newImages = req.files ? await uploadImages(req.files) : [];
      const images = [...(oldData.images || []), ...newImages];
      const updateData = {
        ...validated,
        images,
        nominee: validated.nominee ?? oldData.nominee,
        nominee_adhar_pan_number:
          validated.nominee_adhar_pan_number ?? oldData.nominee_adhar_pan_number,
        email: validated.email ?? oldData.email,
        phone: validated.phone ?? oldData.phone,
        updated_at: new Date(),
      };
      const data = await Customer.findByIdAndUpdate(
        req.params.id,
        updateData,
        { new: true }
      );
      await auditLog(
        'customers',
        data._id,
        'UPDATE',
        oldData.toObject(),
        data.toObject(),
        req.user.user_id
      );
      res.json({ data, error: null });
    } catch (error) {
      res
        .status(400)
        .json({ data: null, error: { code: 'VALIDATION_ERROR', message: error.message } });
    }
  }
);



// ------------------- SETTLE CUSTOMER -------------------
app.post(
  '/customers/:id/settle',
  authMiddleware,
  rbacMiddleware(['manager', 'super_admin']),
  async (req, res) => {
    try {
      const { id } = req.params;

      // 1. Find the customer
      const customer = await Customer.findById(id);
      if (!customer) {
        return res.status(404).json({
          data: null,
          error: { code: 'NOT_FOUND', message: 'Customer not found' },
        });
      }

      // 2. Prevent double-settling
      if (customer.approval_status === 'settled') {
        return res.status(400).json({
          data: null,
          error: { code: 'ALREADY_SETTLED', message: 'Customer is already settled' },
        });
      }

      // 3. Update customer status
      const oldCustomer = customer.toObject();
      customer.approval_status = 'settled';
      customer.updated_at = new Date();
      await customer.save();

      // 4. Mark **ALL** payment schedules as paid (method = "none")
      const updateResult = await PaymentSchedule.updateMany(
        { customer_id: id },
        {
          $set: {
            is_paid: true,
            paid_at: new Date(),
            payment_method: 'none',
          },
        }
      );

      // 5. Audit log
      await auditLog(
        'customers',
        customer._id,
        'SETTLE',
        oldCustomer,
        customer.toObject(),
        req.user.user_id
      );

      // 6. Response
      res.json({
        data: {
          success: true,
          customer: {
            _id: customer._id,
            approval_status: customer.approval_status,
          },
          payments_updated: updateResult.modifiedCount,
        },
        error: null,
      });
    } catch (error) {
      console.error('Settle customer error:', error);
      res.status(500).json({
        data: null,
        error: { code: 'SETTLE_ERROR', message: error.message },
      });
    }
  }
);

// ------------------- GET SINGLE CUSTOMER FULL DETAILS -------------------
app.get(
  '/customers/:id',
  authMiddleware,
  rbacMiddleware(['manager', 'super_admin', 'office_staff']),
  async (req, res) => {
    try {
      const { id } = req.params;
      const userRole = req.user.role;

      // === 1. Find Customer ===
      const customer = await Customer.findById(id).lean();
      if (!customer) {
        return res.status(404).json({
          data: null,
          error: { code: 'CUSTOMER_NOT_FOUND', message: 'Customer not found' }
        });
      }

      // === 2. Mask PII for office_staff ===
      let safeCustomer = { ...customer };
      if (userRole === 'office_staff') {
        safeCustomer = await maskPII(safeCustomer, 'office_staff');
      }

      // === 3. Fetch Payment Schedules (All) ===
      const schedules = await PaymentSchedule.find({ customer_id: id })
        .sort({ payment_date: 1 })
        .lean();

      const formattedSchedules = schedules.map(s => ({
        _id: s._id,
        amount: s.amount || 0,
        payment_date: s.payment_date,
        is_paid: s.is_paid || false,
        paid_at: s.paid_at || null,
        is_principal: s.is_principal || false,
        interest_amount: s.interest_amount || 0,
        principal_amount: s.principal_amount || 0,
        payout_month: s.payout_month || 0,
        payment_method: s.payment_method || 'None',
        transaction_id: s.transaction_id || null,
        images: s.images || []
      }));

      // === 4. Summary Stats ===
      const totalInvested = safeCustomer.investment_amount || 0;
      const totalPaid = formattedSchedules
        .filter(s => s.is_paid)
        .reduce((sum, s) => sum + s.amount, 0);
      const totalDue = formattedSchedules
        .filter(s => !s.is_paid)
        .reduce((sum, s) => sum + s.amount, 0);

      // === 5. Final Response ===
      res.json({
        data: {
          customer: {
            _id: safeCustomer._id,
            first_name: safeCustomer.first_name || null,
            last_name: safeCustomer.last_name || null,
            email: safeCustomer.email || null,
            phone: safeCustomer.phone || null,
            address: safeCustomer.address || null,
            pan_number: safeCustomer.pan_number || null,
            aadhar_number: safeCustomer.aadhar_number || null,
            bank_name: safeCustomer.bank_name || null,
            account_number: safeCustomer.account_number || null,
            ifsc_code: safeCustomer.ifsc_code || null,
            branch: safeCustomer.branch || null,
            return_method: safeCustomer.return_method || 'Bank',
            nominee: safeCustomer.nominee || null,
            nominee_adhar_pan_number: safeCustomer.nominee_adhar_pan_number || null,
            investment_amount: safeCustomer.investment_amount || 0,
            investment_date: safeCustomer.investment_date || null,
            plan_id: safeCustomer.plan_id || null,
            approval_status: safeCustomer.approval_status || 'pending',
            created_at: safeCustomer.created_at,
            updated_at: safeCustomer.updated_at,
            // Extra
            display_name: `${safeCustomer.first_name || ''} ${safeCustomer.last_name || ''}`.trim() || 'N/A'
          },
          payment_schedules: formattedSchedules,
          summary: {
            total_invested: totalInvested,
            total_paid: totalPaid,
            total_due: totalDue,
            total_payments: formattedSchedules.length,
            paid_count: formattedSchedules.filter(s => s.is_paid).length,
            unpaid_count: formattedSchedules.filter(s => !s.is_paid).length
          }
        },
        error: null
      });

    } catch (error) {
      console.error('Customer Details API Error:', error);
      res.status(500).json({
        data: null,
        error: { code: 'CUSTOMER_DETAILS_ERROR', message: error.message }
      });
    }
  }
);



// ------------------- EXPORT ALL CUSTOMERS TO EXCEL -------------------
app.get(
  '/customers/export/excel',
  authMiddleware,
  rbacMiddleware(['manager', 'super_admin']),
  async (req, res) => {
    try {
      // 1. Fetch ALL customers (no pagination for export)
      const customers = await Customer.find({})
        .populate('plan_id', 'name segment return_percentage duration_months payment_type')
        .populate('agent_id', 'first_name last_name email phone')
        .lean();

      if (!customers || customers.length === 0) {
        return res.status(404).json({
          data: null,
          error: { code: 'NO_DATA', message: 'No customers found to export' },
        });
      }

      // 2. Transform data for Excel
      const rows = customers.map((c) => {
        const plan = c.plan_id || {};
        const agent = c.agent_id || {};

        return {
          'Customer ID': c._id.toString(),
          'First Name': c.first_name || '',
          'Last Name': c.last_name || '',
          'Email': c.email || '',
          'Phone': c.phone || '',
          'Address': c.address || '',
          'PAN': c.pan_number || '',
          'Aadhaar': c.aadhar_number || '',
          'Nominee': c.nominee || '',
          'Nominee Aadhaar/PAN': c.nominee_adhar_pan_number || '',
          'Investment Amount': c.investment_amount || 0,
          'Investment Date': c.investment_date || '',
          'Plan Name': plan.name || '',
          'Segment': plan.segment || '',
          'Return %': plan.return_percentage || 0,
          'Duration (Months)': plan.duration_months || 0,
          'Payment Type': plan.payment_type || '',
          'Agent Name': `${agent.first_name || ''} ${agent.last_name || ''}`.trim() || 'N/A',
          'Agent Email': agent.email || '',
          'Agent Phone': agent.phone || '',
          'Bank Name': c.bank_name || '',
          'Account Number': c.account_number || '',
          'IFSC Code': c.ifsc_code || '',
          'Branch': c.branch || '',
          'Payable Balance': c.payable_balance_amount_by_company || 0,
          'Total Paid to Customer': c.total_paid_amount_to_customer || 0,
          'Approval Status': c.approval_status || 'pending',
          'Submitted By': c.submitted_by || '',
          'Reviewed By': c.reviewed_by || '',
          'Review Comments': c.review_comments || '',
          'Approved At': c.approved_at ? new Date(c.approved_at).toLocaleDateString() : '',
          'Created At': new Date(c.created_at).toLocaleDateString(),
          'Updated At': new Date(c.updated_at).toLocaleDateString(),
        };
      });

      // 3. Define Excel columns (with width for better readability)
      const columns = [
        { header: 'Customer ID', key: 'Customer ID', width: 26 },
        { header: 'First Name', key: 'First Name', width: 15 },
        { header: 'Last Name', key: 'Last Name', width: 15 },
        { header: 'Email', key: 'Email', width: 25 },
        { header: 'Phone', key: 'Phone', width: 14 },
        { header: 'Address', key: 'Address', width: 30 },
        { header: 'PAN', key: 'PAN', width: 14 },
        { header: 'Aadhaar', key: 'Aadhaar', width: 16 },
        { header: 'Nominee', key: 'Nominee', width: 20 },
        { header: 'Nominee Aadhaar/PAN', key: 'Nominee Aadhaar/PAN', width: 20 },
        { header: 'Investment Amount', key: 'Investment Amount', width: 16 },
        { header: 'Investment Date', key: 'Investment Date', width: 16 },
        { header: 'Plan Name', key: 'Plan Name', width: 20 },
        { header: 'Segment', key: 'Segment', width: 12 },
        { header: 'Return %', key: 'Return %', width: 10 },
        { header: 'Duration (Months)', key: 'Duration (Months)', width: 12 },
        { header: 'Payment Type', key: 'Payment Type', width: 12 },
        { header: 'Agent Name', key: 'Agent Name', width: 20 },
        { header: 'Agent Email', key: 'Agent Email', width: 25 },
        { header: 'Agent Phone', key: 'Agent Phone', width: 14 },
        { header: 'Bank Name', key: 'Bank Name', width: 18 },
        { header: 'Account Number', key: 'Account Number', width: 18 },
        { header: 'IFSC Code', key: 'IFSC Code', width: 12 },
        { header: 'Branch', key: 'Branch', width: 16 },
        { header: 'Payable Balance', key: 'Payable Balance', width: 16 },
        { header: 'Total Paid to Customer', key: 'Total Paid to Customer', width: 20 },
        { header: 'Approval Status', key: 'Approval Status', width: 14 },
        { header: 'Submitted By', key: 'Submitted By', width: 18 },
        { header: 'Reviewed By', key: 'Reviewed By', width: 18 },
        { header: 'Review Comments', key: 'Review Comments', width: 30 },
        { header: 'Approved At', key: 'Approved At', width: 16 },
        { header: 'Created At', key: 'Created At', width: 16 },
        { header: 'Updated At', key: 'Updated At', width: 16 },
      ];

      // 4. Generate filename with timestamp
      const timestamp = format(new Date(), 'yyyy-MM-dd_HH-mm-ss');
      const filename = `customers_full_export_${timestamp}.xlsx`;

      // 5. Use your existing exportToExcel function
      const { buffer } = await exportToExcel(rows, columns, filename);

      // 6. Audit log
      await auditLog(
        'customers',
        null,
        'EXPORT_EXCEL',
        null,
        { count: customers.length, filename },
        req.user.user_id
      );

      // 7. Send file
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.send(buffer);
    } catch (error) {
      console.error('Customer Excel Export Error:', error);
      res.status(500).json({
        data: null,
        error: { code: 'EXPORT_ERROR', message: error.message },
      });
    }
  }
);
// ------------------- INVESTMENTS -------------------
app.get('/investments', authMiddleware, async (req, res) => {
  try {
    const { page = 1, page_size = 20, status, search } = req.query;
    const query = {};
    if (status) query.approval_status = status;
    if (search) query.investment_name = { $regex: search, $options: 'i' };
    const total = await CompanyInvestment.countDocuments(query);
    const data = await CompanyInvestment.find(query)
      .skip((page - 1) * page_size)
      .limit(Math.min(page_size, 100))
      .sort({ created_at: -1 });
    res.json({ data: { items: data, total }, error: null });
  } catch (error) {
    res
      .status(400)
      .json({ data: null, error: { code: 'INVESTMENT_ERROR', message: error.message } });
  }
});

app.post(
  '/investments',
  authMiddleware,
  rbacMiddleware(['office_staff', 'manager', 'super_admin']),
  upload.array('files'),
  async (req, res) => {
    try {
      const validated = CompanyInvestmentCreateSchema.parse(
        JSON.parse(req.body.data || '{}')
      );
      const images = req.files ? await uploadImages(req.files) : [];
      const { expected_return, return_percentage } = calculateReturnFields({
        investment_amount: validated.investment_amount,
        expected_return: validated.expected_return,
        return_percentage: validated.return_percentage,
        duration_months: validated.duration_months,
      });
      const data = await CompanyInvestment.create({
        ...validated,
        expected_return,
        return_percentage,
        images,
        submitted_by: req.user.user_id,
        created_at: new Date(),
        updated_at: new Date(),
      });
      await auditLog(
        'company_investments',
        data._id,
        'CREATE',
        null,
        data.toObject(),
        req.user.user_id
      );
      res.json({ data, error: null });
    } catch (error) {
      res
        .status(400)
        .json({ data: null, error: { code: 'VALIDATION_ERROR', message: error.message } });
    }
  }
);

app.post(
  '/investments/:id/approve',
  authMiddleware,
  rbacMiddleware(['manager', 'super_admin']),
  async (req, res) => {
    try {
      const { comments } = req.body;
      const oldData = await CompanyInvestment.findById(req.params.id);
      if (!oldData) throw new Error('Investment not found');
      const data = await CompanyInvestment.findByIdAndUpdate(
        req.params.id,
        {
          approval_status: 'approved',
          reviewed_by: req.user.user_id,
          review_comments: comments,
          approved_at: new Date(),
          updated_at: new Date(),
        },
        { new: true }
      );
      await generateInvestmentPaymentOnApproval(data);
      await auditLog(
        'company_investments',
        data._id,
        'APPROVE',
        oldData?.toObject(),
        data.toObject(),
        req.user.user_id
      );
      res.json({ data: { success: true, updated: data }, error: null });
    } catch (error) {
      res
        .status(400)
        .json({ data: null, error: { code: 'APPROVAL_ERROR', message: error.message } });
    }
  }
);

app.post(
  '/investments/:id/reject',
  authMiddleware,
  rbacMiddleware(['manager', 'super_admin']),
  async (req, res) => {
    try {
      const { comments } = req.body;
      const oldData = await CompanyInvestment.findById(req.params.id);
      if (!oldData) throw new Error('Investment not found');
      const data = await CompanyInvestment.findByIdAndUpdate(
        req.params.id,
        {
          approval_status: 'rejected',
          reviewed_by: req.user.user_id,
          review_comments: comments,
          updated_at: new Date(),
        },
        { new: true }
      );
      await auditLog(
        'company_investments',
        data._id,
        'REJECT',
        oldData?.toObject(),
        data.toObject(),
        req.user.user_id
      );
      res.json({ data: { success: true, updated: data }, error: null });
    } catch (error) {
      res
        .status(400)
        .json({ data: null, error: { code: 'APPROVAL_ERROR', message: error.message } });
    }
  }
);

app.patch(
  '/investments/:id',
  authMiddleware,
  rbacMiddleware(['office_staff', 'manager', 'super_admin']),
  upload.array('files'),
  async (req, res) => {
    try {
      const validated = CompanyInvestmentCreateSchema.partial().parse(
        JSON.parse(req.body.data || '{}')
      );
      const oldData = await CompanyInvestment.findById(req.params.id);
      if (!oldData) throw new Error('Investment not found');
      const merged = { ...oldData.toObject(), ...validated };
      const { expected_return, return_percentage } = calculateReturnFields({
        investment_amount: merged.investment_amount,
        expected_return: merged.expected_return,
        return_percentage: merged.return_percentage,
        duration_months: merged.duration_months,
      });
      const newImages = req.files ? await uploadImages(req.files) : [];
      const images = [...(oldData.images || []), ...newImages];
      const updateData = {
        ...validated,
        expected_return,
        return_percentage,
        images,
        updated_at: new Date(),
      };
      const data = await CompanyInvestment.findByIdAndUpdate(
        req.params.id,
        updateData,
        { new: true }
      );
      await auditLog(
        'company_investments',
        data._id,
        'UPDATE',
        oldData.toObject(),
        data.toObject(),
        req.user.user_id
      );
      res.json({ data, error: null });
    } catch (error) {
      res
        .status(400)
        .json({ data: null, error: { code: 'VALIDATION_ERROR', message: error.message } });
    }
  }
);

app.get(
  '/investments/export',
  authMiddleware,
  rbacMiddleware(['manager', 'super_admin']),
  async (req, res) => {
    try {
      const investments = await CompanyInvestment.find().lean();
      const columns = [
        { header: 'ID', key: '_id' },
        { header: 'Name', key: 'investment_name' },
        { header: 'Amount', key: 'investment_amount' },
        { header: 'Expected Return', key: 'expected_return' },
        { header: 'Return %', key: 'return_percentage' },
        { header: 'Duration (mo)', key: 'duration_months' },
        { header: 'Invest Date', key: 'investment_date' },
        { header: 'Status', key: 'approval_status' },
      ];
      const { buffer, filename } = await exportToExcel(
        investments,
        columns,
        'investments.xlsx'
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=${filename}`
      );
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.send(buffer);
    } catch (error) {
      res
        .status(500)
        .json({ data: null, error: { code: 'EXPORT_ERROR', message: error.message } });
    }
  }
);

// ------------------- INVESTMENT PAYMENTS -------------------
app.get(
  '/investment-payments',
  authMiddleware,
  rbacMiddleware(['super_admin']),
  async (req, res) => {
    try {
      const { page = 1, page_size = 20, investment_id } = req.query;
      const query = investment_id ? { investment_id } : {};
      const total = await InvestmentPayment.countDocuments(query);
      const data = await InvestmentPayment.find(query)
        .skip((page - 1) * page_size)
        .limit(Math.min(page_size, 100))
        .sort({ payment_date: 1 });

      const enriched = await Promise.all(
        data.map(async (p) => {
          const inv = await CompanyInvestment.findById(p.investment_id).select(
            'investment_name investment_amount'
          );
          return {
            ...p.toObject(),
            investment_name: inv?.investment_name,
            principal: inv?.investment_amount,
            profit: p.amount - (inv?.investment_amount || 0),
          };
        })
      );

      res.json({ data: { items: enriched, total }, error: null });
    } catch (error) {
      res
        .status(400)
        .json({
          data: null,
          error: { code: 'INVESTMENT_PAYMENT_ERROR', message: error.message },
        });
    }
  }
);

app.patch(
  '/investment-payments/:id/mark_paid',
  authMiddleware,
  rbacMiddleware(['super_admin']),
  upload.array('files'),
  async (req, res) => {
    try {
      const { transaction_id, payment_method } = req.body;
      const images = req.files ? await uploadImages(req.files) : [];
      const oldData = await InvestmentPayment.findById(req.params.id);
      if (!oldData) throw new Error('Not found');

      const updateData = {
        is_paid: true,
        paid_at: new Date(),
        transaction_id: transaction_id || oldData.transaction_id,
        payment_method: payment_method || oldData.payment_method,
        images: [...oldData.images, ...images],
      };

      const data = await InvestmentPayment.findByIdAndUpdate(
        req.params.id,
        updateData,
        { new: true }
      );
      await auditLog(
        'investment_payments',
        data._id,
        'PAYMENT_MARKED',
        oldData.toObject(),
        data.toObject(),
        req.user.user_id
      );
      res.json({ data: { success: true, updated: data }, error: null });
    } catch (error) {
      res
        .status(400)
        .json({ data: null, error: { code: 'PAYMENT_ERROR', message: error.message } });
    }
  }
);



// ===== AGENTS ROUTES - UNCOMMENT THESE =====

// GET /agents - List with pagination, search, filter
// app.get('/agents', authMiddleware, async (req, res) => {
//   try {
//     const { page = 1, page_size = 20, status, search } = req.query;
//     const query = {};
//     if (status) query.approval_status = status;
//     if (search) query.email = { $regex: search, $options: 'i' };
//     const total = await Agent.countDocuments(query);
//     let data = await Agent.find(query)
//       .skip((page - 1) * page_size)
//       .limit(Math.min(page_size, 100))
//       .sort({ created_at: -1 });
//     data = await Promise.all(data.map(item => maskPII(item.toObject(), req.user.role)));
//     res.json({ data: { items: data, total }, error: null });
//   } catch (error) {
//     res.status(400).json({ data: null, error: { code: 'AGENT_ERROR', message: error.message } });
//   }
// });



app.get('/agents', authMiddleware, async (req, res) => {
  try {
    // Fetch ALL agents — no query, no filters
    let data = await Agent.find({});

    // Apply PII masking based on requester's role
    data = await Promise.all(data.map(item => maskPII(item.toObject(), req.user.role)));

    // Total count
    const total = data.length;

    res.json({ data: { items: data, total }, error: null });
  } catch (error) {
    res.status(400).json({ 
      data: null, 
      error: { code: 'AGENT_ERROR', message: error.message } 
    });
  }
});
// POST /agents - Create agent with files
app.post('/agents', authMiddleware, rbacMiddleware(['office_staff', 'manager', 'super_admin']), upload.array('files'), async (req, res) => {
  try {
    const validated = AgentCreateSchema.parse(JSON.parse(req.body.data || '{}'));
    const images = req.files ? await uploadImages(req.files) : [];
    const data = await Agent.create({
      ...validated,
      images,
      submitted_by: req.user.user_id,
      created_at: new Date(),
      updated_at: new Date()
    });
    await auditLog('agents', data._id, 'CREATE', null, data.toObject(), req.user.user_id);
    res.json({ data, error: null });
  } catch (error) {
    res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: error.message } });
  }
});

// POST /agents/:id/approve - Approve agent
app.post('/agents/:id/approve', authMiddleware, rbacMiddleware(['manager', 'super_admin']), async (req, res) => {
  try {
    const { comments } = req.body;
    const oldData = await Agent.findById(req.params.id);
    if (!oldData) throw new Error('Agent not found');
    const data = await Agent.findByIdAndUpdate(
      req.params.id,
      {
        approval_status: 'approved',
        reviewed_by: req.user.user_id,
        review_comments: comments,
        approved_at: new Date(),
        updated_at: new Date()
      },
      { new: true }
    );
    await auditLog('agents', data._id, 'APPROVE', oldData?.toObject(), data.toObject(), req.user.user_id);
    res.json({ data: { success: true, updated: data }, error: null });
  } catch (error) {
    res.status(400).json({ data: null, error: { code: 'APPROVAL_ERROR', message: error.message } });
  }
});

// POST /agents/:id/reject - Reject agent
app.post('/agents/:id/reject', authMiddleware, rbacMiddleware(['manager', 'super_admin']), async (req, res) => {
  try {
    const { comments } = req.body;
    const oldData = await Agent.findById(req.params.id);
    if (!oldData) throw new Error('Agent not found');
    const data = await Agent.findByIdAndUpdate(
      req.params.id,
      {
        approval_status: 'rejected',
        reviewed_by: req.user.user_id,
        review_comments: comments,
        updated_at: new Date()
      },
      { new: true }
    );
    await auditLog('agents', data._id, 'REJECT', oldData?.toObject(), data.toObject(), req.user.user_id);
    res.json({ data: { success: true, updated: data }, error: null });
  } catch (error) {
    res.status(400).json({ data: null, error: { code: 'APPROVAL_ERROR', message: error.message } });
  }
});

// PATCH /agents/:id - Update agent
app.patch('/agents/:id', authMiddleware, rbacMiddleware(['office_staff', 'manager', 'super_admin']), upload.array('files'), async (req, res) => {
  try {
    const validated = AgentCreateSchema.partial().parse(JSON.parse(req.body.data || '{}'));
    const oldData = await Agent.findById(req.params.id);
    if (!oldData) throw new Error('Agent not found');
    const newImages = req.files ? await uploadImages(req.files) : [];
    const images = [...(oldData.images || []), ...newImages];
    const updateData = { ...validated, images, updated_at: new Date() };
    const data = await Agent.findByIdAndUpdate(req.params.id, updateData, { new: true });
    await auditLog('agents', data._id, 'UPDATE', oldData.toObject(), data.toObject(), req.user.user_id);
    res.json({ data, error: null });
  } catch (error) {
    res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: error.message } });
  }
});

// GET /agents/export - Export to Excel
app.get('/agents/export', authMiddleware, rbacMiddleware(['manager', 'super_admin']), async (req, res) => {
  try {
    const agents = await Agent.find().lean();
    const columns = [
      { header: 'ID', key: '_id' },
      { header: 'First Name', key: 'first_name' },
      { header: 'Last Name', key: 'last_name' },
      { header: 'Email', key: 'email' },
      { header: 'Phone', key: 'phone' },
      { header: 'Address', key: 'address' },
      { header: 'PAN Number', key: 'pan_number' },
      { header: 'Agent Type', key: 'agent_type' },
      { header: 'Parent Agent ID', key: 'parent_agent_id' },
      { header: 'Commission Percentage', key: 'commission_percentage' },
      { header: 'Approval Status', key: 'approval_status' },
      { header: 'Submitted By', key: 'submitted_by' },
      { header: 'Reviewed By', key: 'reviewed_by' },
      { header: 'Review Comments', key: 'review_comments' },
      { header: 'Approved At', key: 'approved_at' },
      { header: 'Created At', key: 'created_at' },
      { header: 'Updated At', key: 'updated_at' }
    ];
    const { buffer, filename } = await exportToExcel(agents, columns, 'agents.xlsx');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ data: null, error: { code: 'EXPORT_ERROR', message: error.message } });
  }
});
// ------------------- PLANS -------------------
app.get('/plans', authMiddleware, async (req, res) => {
  try {
    const query =
      req.query.is_active === 'true' ? { is_active: true } : {};
    const data = await Plan.find(query).sort({ created_at: -1 });
    res.json({ data, error: null });
  } catch (error) {
    res
      .status(400)
      .json({ data: null, error: { code: 'PLAN_ERROR', message: error.message } });
  }
});

app.post(
  '/plans',
  authMiddleware,
  rbacMiddleware(['manager', 'super_admin']),
  async (req, res) => {
    try {
      const validated = PlanCreateSchema.parse(req.body);
      const data = await Plan.create({
        ...validated,
        created_at: new Date(),
        updated_at: new Date(),
        created_by: req.user.user_id,
      });
      await auditLog(
        'plans',
        data._id,
        'CREATE',
        null,
        data.toObject(),
        req.user.user_id
      );
      res.json({ data, error: null });
    } catch (error) {
      res
        .status(400)
        .json({ data: null, error: { code: 'VALIDATION_ERROR', message: error.message } });
    }
  }
);

app.patch(
  '/plans/:id',
  authMiddleware,
  rbacMiddleware(['manager', 'super_admin']),
  async (req, res) => {
    try {
      const oldData = await Plan.findById(req.params.id);
      const data = await Plan.findByIdAndUpdate(
        req.params.id,
        { ...req.body, updated_at: new Date() },
        { new: true }
      );
      if (!data) throw new Error('Plan not found');
      await auditLog(
        'plans',
        data._id,
        'UPDATE',
        oldData?.toObject(),
        data.toObject(),
        req.user.user_id
      );
      res.json({ data, error: null });
    } catch (error) {
      res
        .status(400)
        .json({ data: null, error: { code: 'VALIDATION_ERROR', message: error.message } });
    }
  }
);

// ------------------- PAYMENT SCHEDULES -------------------
app.get('/payment_schedules', authMiddleware, async (req, res) => {
  try {
    const {
      page = 1,
      page_size = 20,
      customer_id,
      status,
    } = req.query;
    const query = {};
    if (customer_id) query.customer_id = customer_id;
    if (status) query.is_paid = status === 'paid';
    const total = await PaymentSchedule.countDocuments(query);
    const data = await PaymentSchedule.find(query)
      .skip((page - 1) * page_size)
      .limit(Math.min(page_size, 100))
      .sort({ payment_date: 1 });
    res.json({ data: { items: data, total }, error: null });
  } catch (error) {
    res
      .status(400)
      .json({
        data: null,
        error: { code: 'PAYMENT_SCHEDULE_ERROR', message: error.message },
      });
  }
});

app.post(
  '/payment_schedules/generate',
  authMiddleware,
  rbacMiddleware(['manager', 'super_admin']),
  async (req, res) => {
    try {
      const { customer_id, investment_amount, investment_date, plan_id } =
        req.body;
      const plan = await Plan.findById(plan_id);
      if (!plan) throw new Error('Plan not found');
      const schedules = await generatePaymentSchedule(
        customer_id,
        investment_amount,
        investment_date,
        plan
      );
      res.json({ data: schedules, error: null });
    } catch (error) {
      res
        .status(400)
        .json({ data: null, error: { code: 'GENERATION_ERROR', message: error.message } });
    }
  }
);

app.patch(
  '/payment_schedules/:id/mark_paid',
  authMiddleware,
  rbacMiddleware(['manager', 'super_admin']),
  upload.array('files'),
  async (req, res) => {
    try {
      const { transaction_id, payment_method } = req.body;
      const images = req.files ? await uploadImages(req.files) : [];
      const oldData = await PaymentSchedule.findById(req.params.id);
      if (!oldData) throw new Error('Not found');

      const updateData = {
        is_paid: true,
        paid_at: new Date(),
        transaction_id: transaction_id || oldData.transaction_id,
        payment_method: payment_method || oldData.payment_method,
        images: [...oldData.images, ...images],
      };

      const data = await PaymentSchedule.findByIdAndUpdate(
        req.params.id,
        updateData,
        { new: true }
      );
      await auditLog(
        'payment_schedules',
        data._id,
        'PAYMENT_MARKED',
        oldData.toObject(),
        data.toObject(),
        req.user.user_id
      );

      const allPaid = (
        await PaymentSchedule.find({ customer_id: oldData.customer_id })
      ).every((s) => s.is_paid);
      if (allPaid) {
        await Customer.findByIdAndUpdate(
          oldData.customer_id,
          { approval_status: 'settled', updated_at: new Date() }
        );
        await auditLog(
          'customers',
          oldData.customer_id,
          'SETTLED',
          null,
          { approval_status: 'settled' },
          req.user.user_id
        );
      }

      res.json({ data: { success: true, updated: data }, error: null });
    } catch (error) {
      res
        .status(400)
        .json({ data: null, error: { code: 'PAYMENT_ERROR', message: error.message } });
    }
  }
);

// ------------------- AGENT PAYMENTS -------------------
app.get('/agent-payments', authMiddleware, async (req, res) => {
  try {
    const { page = 1, page_size = 20, agent_id } = req.query;
    const query = agent_id ? { agent_id } : {};
    const total = await AgentPayment.countDocuments(query);
    const data = await AgentPayment.find(query)
      .skip((page - 1) * page_size)
      .limit(Math.min(page_size, 100))
      .sort({ payment_date: 1 });
    res.json({ data: { items: data, total }, error: null });
  } catch (error) {
    res
      .status(400)
      .json({ data: null, error: { code: 'AGENT_PAYMENT_ERROR', message: error.message } });
  }
});

app.post(
  '/agent-payments',
  authMiddleware,
  rbacMiddleware(['manager', 'super_admin']),
  upload.array('files'),
  async (req, res) => {
    try {
      const validated = AgentPaymentCreateSchema.parse(
        JSON.parse(req.body.data || '{}')
      );
      const images = req.files ? await uploadImages(req.files) : [];
      const data = await AgentPayment.create({
        ...validated,
        images,
        created_at: new Date(),
      });
      await auditLog(
        'agent_payments',
        data._id,
        'CREATE',
        null,
        data.toObject(),
        req.user.user_id
      );
      res.json({ data, error: null });
    } catch (error) {
      res
        .status(400)
        .json({ data: null, error: { code: 'VALIDATION_ERROR', message: error.message } });
    }
  }
);

app.patch(
  '/agent-payments/:id/mark_paid',
  authMiddleware,
  rbacMiddleware(['manager', 'super_admin']),
  upload.array('files'),
  async (req, res) => {
    try {
      const { transaction_id, method } = req.body;
      const images = req.files ? await uploadImages(req.files) : [];
      const oldData = await AgentPayment.findById(req.params.id);
      if (!oldData) throw new Error('Not found');

      const updateData = {
        is_paid: true,
        paid_at: new Date(),
        transaction_id: transaction_id || oldData.transaction_id,
        method: method || oldData.method,
        images: [...oldData.images, ...images],
      };

      const data = await AgentPayment.findByIdAndUpdate(
        req.params.id,
        updateData,
        { new: true }
      );
      await auditLog(
        'agent_payments',
        data._id,
        'PAYMENT_MARKED',
        oldData.toObject(),
        data.toObject(),
        req.user.user_id
      );
      res.json({ data: { success: true, updated: data }, error: null });
    } catch (error) {
      res
        .status(400)
        .json({ data: null, error: { code: 'PAYMENT_ERROR', message: error.message } });
    }
  }
);

// ------------------- GIFT PLANS -------------------
app.get('/gift-plans', authMiddleware, async (req, res) => {
  try {
    const data = await GiftPlan.find().sort({ created_at: -1 });
    res.json({ data, error: null });
  } catch (error) {
    res
      .status(400)
      .json({ data: null, error: { code: 'GIFT_PLAN_ERROR', message: error.message } });
  }
});

app.post(
  '/gift-plans',
  authMiddleware,
  rbacMiddleware(['manager', 'super_admin']),
  async (req, res) => {
    try {
      const validated = GiftPlanCreateSchema.parse(req.body);
      const data = await GiftPlan.create({
        ...validated,
        created_at: new Date(),
        updated_at: new Date(),
      });
      await auditLog(
        'gift_plans',
        data._id,
        'CREATE',
        null,
        data.toObject(),
        req.user.user_id
      );
      res.json({ data, error: null });
    } catch (error) {
      res
        .status(400)
        .json({ data: null, error: { code: 'VALIDATION_ERROR', message: error.message } });
    }
  }
);


// ------------------- UPDATE GIFT PLAN (PARTIAL) -------------------
app.patch(
  '/gift-plans/:id',
  authMiddleware,
  rbacMiddleware(['manager', 'super_admin']),
  async (req, res) => {
    try {
      const { id } = req.params;

      // Validate ID
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          data: null,
          error: { code: 'INVALID_ID', message: 'Invalid gift plan ID' },
        });
      }

      // Partial schema: all fields optional
      const UpdateSchema = GiftPlanCreateSchema.partial().extend({
        is_active: z.boolean().optional(),
      });

      const validated = UpdateSchema.parse(req.body);

      // Fetch old data for audit
      const oldData = await GiftPlan.findById(id);
      if (!oldData) {
        return res.status(404).json({
          data: null,
          error: { code: 'NOT_FOUND', message: 'Gift plan not found' },
        });
      }

      // Update only provided fields
      const updatedData = await GiftPlan.findByIdAndUpdate(
        id,
        { ...validated, updated_at: new Date() },
        { new: true }
      );

      // Audit log
      await auditLog(
        'gift_plans',
        updatedData._id,
        'UPDATE',
        oldData.toObject(),
        updatedData.toObject(),
        req.user.user_id
      );

      res.json({ data: updatedData, error: null });
    } catch (error) {
      if (error.name === 'ZodError') {
        return res.status(400).json({
          data: null,
          error: { code: 'VALIDATION_ERROR', message: error.errors[0].message },
        });
      }
      console.error('Update gift plan error:', error);
      res.status(500).json({
        data: null,
        error: { code: 'UPDATE_ERROR', message: error.message },
      });
    }
  }
);

// ------------------- GET ACTIVE GIFT PLANS ONLY -------------------
app.get(
  '/gift-plans/active',
  authMiddleware,
  async (req, res) => {
    try {
      const { page = 1, page_size = 20 } = req.query;
      const skip = (page - 1) * page_size;
      const limit = Math.min(parseInt(page_size), 100);

      const query = { is_active: true };

      const total = await GiftPlan.countDocuments(query);
      const data = await GiftPlan.find(query)
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(limit)
        .lean();

      res.json({
        data: {
          items: data,
          total,
          page: parseInt(page),
          page_size: limit,
        },
        error: null,
      });
    } catch (error) {
      console.error('Get active gift plans error:', error);
      res.status(500).json({
        data: null,
        error: { code: 'FETCH_ERROR', message: error.message },
      });
    }
  }
);

// ------------------- AGENT REWARDS -------------------
app.get('/agent-rewards', authMiddleware, async (req, res) => {
  try {
    const { agent_id, performance_month } = req.query;
    const query = {};
    if (agent_id) query.agent_id = agent_id;
    if (performance_month) query.performance_month = performance_month;
    const data = await AgentReward.find(query).sort({ created_at: -1 });
    res.json({ data, error: null });
  } catch (error) {
    res
      .status(400)
      .json({ data: null, error: { code: 'AGENT_REWARD_ERROR', message: error.message } });
  }
});

app.patch(
  '/agent-rewards/:id/mark_rewarded',
  authMiddleware,
  rbacMiddleware(['manager', 'super_admin']),
  upload.array('files'),
  async (req, res) => {
    try {
      const { reward_method, transaction_id } = req.body;
      const images = req.files ? await uploadImages(req.files) : [];
      const oldData = await AgentReward.findById(req.params.id);
      if (!oldData) throw new Error('Not found');

      const updateData = {
        is_rewarded: true,
        rewarded_at: new Date(),
        reward_method: reward_method || oldData.reward_method,
        transaction_id: transaction_id || oldData.transaction_id,
        images: [...oldData.images, ...images],
      };

      const data = await AgentReward.findByIdAndUpdate(
        req.params.id,
        updateData,
        { new: true }
      );
      await auditLog(
        'agent_rewards',
        data._id,
        'REWARD_MARKED',
        oldData.toObject(),
        data.toObject(),
        req.user.user_id
      );
      res.json({ data: { success: true, updated: data }, error: null });
    } catch (error) {
      res
        .status(400)
        .json({ data: null, error: { code: 'REWARD_ERROR', message: error.message } });
    }
  }
);


// ------------------- EXPORT PAYMENT SCHEDULE BY DAY (15th or 30th) -------------------
// async function exportPaymentScheduleByDay(day, res) {
//   try {
//     const today = new Date();
//     const year = today.getFullYear();
//     const month = today.getMonth(); // 0 = Jan

//     let targetDay, targetDate, targetDateStr;

//     if (day === 15) {
//       // 15th always exists
//       targetDay = 15;
//       targetDate = new Date(year, month, 15);
//     } else {
//       // For "30th" → use 30 if exists, else last day of month
//       const lastDayOfMonth = new Date(year, month + 1, 0).getDate(); // 28, 29, 30, or 31
//       targetDay = Math.min(30, lastDayOfMonth); // e.g., 28 in Feb non-leap
//       targetDate = new Date(year, month, targetDay);
//     }

//     targetDateStr = targetDate.toISOString().split('T')[0]; // YYYY-MM-DD

//     // Fetch unpaid schedules due on this date
//     const schedules = await PaymentSchedule.find({
//       payment_date: targetDateStr,
//       is_paid: false,
//     })
//       .populate({
//         path: 'customer_id',
//         select:
//           'first_name last_name email phone pan_number aadhar_number bank_name account_number ifsc_code branch',
//       })
//       .lean();

//     if (!schedules || schedules.length === 0) {
//       return res.status(404).json({
//         data: null,
//         error: {
//           code: 'NO_DATA',
//           message: `No pending payments scheduled for ${targetDateStr}`,
//         },
//       });
//     }

//     // Transform to Excel rows
//     const rows = schedules.map((s) => {
//       const cust = s.customer_id || {};
//       return {
//         'Customer Name': `${cust.first_name || ''} ${cust.last_name || ''}`.trim() || 'N/A',
//         'Email': cust.email || 'N/A',
//         'Phone': cust.phone || 'N/A',
//         'PAN Number': cust.pan_number || 'N/A',
//         'Aadhaar Number': cust.aadhar_number || 'N/A',
//         'Bank Name': cust.bank_name || 'N/A',
//         'Account Number': cust.account_number || 'N/A',
//         'IFSC Code': cust.ifsc_code || 'N/A',
//         'Branch': cust.branch || 'N/A',
//         'Amount Due': s.amount,
//         'Payment Date': s.payment_date,
//         'Payment Type': s.is_principal ? 'Principal + Interest' : 'Interest Only',
//         'Interest Amount': s.interest_amount || 0,
//         'Principal Amount': s.principal_amount || 0,
//         'Payout Month #': s.payout_month,
//         'Payment Method': s.payment_method || 'None',
//       };
//     });

//     // Excel column config
//     const columns = [
//       { header: 'Customer Name', key: 'Customer Name', width: 22 },
//       { header: 'Email', key: 'Email', width: 25 },
//       { header: 'Phone', key: 'Phone', width: 14 },
//       { header: 'PAN Number', key: 'PAN Number', width: 14 },
//       { header: 'Aadhaar Number', key: 'Aadhaar Number', width: 16 },
//       { header: 'Bank Name', key: 'Bank Name', width: 18 },
//       { header: 'Account Number', key: 'Account Number', width: 16 },
//       { header: 'IFSC Code', key: 'IFSC Code', width: 12 },
//       { header: 'Branch', key: 'Branch', width: 16 },
//       { header: 'Amount Due', key: 'Amount Due', width: 14 },
//       { header: 'Payment Date', key: 'Payment Date', width: 14 },
//       { header: 'Payment Type', key: 'Payment Type', width: 20 },
//       { header: 'Interest Amount', key: 'Interest Amount', width: 14 },
//       { header: 'Principal Amount', key: 'Principal Amount', width: 14 },
//       { header: 'Payout Month #', key: 'Payout Month #', width: 12 },
//       { header: 'Payment Method', key: 'Payment Method', width: 14 },
//     ];

//     // Filename
//     const filename = `payment-schedule-${targetDateStr}.xlsx`;

//     // Generate Excel
//     const { buffer } = await exportToExcel(rows, columns, filename);

//     // Send file
//     res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
//     res.setHeader(
//       'Content-Type',
//       'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
//     );
//     res.send(buffer);
//   } catch (error) {
//     console.error(`Payment Schedule Export Error (Day ${day}):`, error);
//     res.status(500).json({
//       data: null,
//       error: { code: 'EXPORT_ERROR', message: error.message },
//     });
//   }
// }




// async function exportPaymentScheduleByMonthDay(day, res) {
//   try {
//     const now = new Date();
//     const year = now.getFullYear();
//     const month = now.getMonth(); // 0 = Jan

//     let targetDay;

//     if (day === 15) {
//       targetDay = 15; // Always exists
//     } else {
//       // For "30th" → use 30 if exists, else last day of month
//       const lastDayOfMonth = new Date(year, month + 1, 0).getDate(); // 28, 29, 30, 31
//       targetDay = Math.min(30, lastDayOfMonth); // e.g., 28 in Feb
//     }

//     // Build target date string: YYYY-MM-DD (e.g., 2025-11-15)
//     const targetDateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`;

//     // QUERY: Only schedules with EXACT payment_date = targetDateStr AND unpaid
//     const schedules = await PaymentSchedule.find({
//       payment_date: targetDateStr,
//       is_paid: false,
//     })
//       .populate({
//         path: 'customer_id',
//         select:
//           'first_name last_name email phone pan_number aadhar_number bank_name account_number ifsc_code branch',
//       })
//       .lean();

//     if (!schedules || schedules.length === 0) {
//       return res.status(404).json({
//         data: null,
//         error: {
//           code: 'NO_DATA',
//           message: `No pending payments due on ${targetDateStr}`,
//         },
//       });
//     }

//     // Transform to Excel rows
//     const rows = schedules.map((s) => {
//       const c = s.customer_id || {};
//       return {
//         'Customer Name': `${c.first_name || ''} ${c.last_name || ''}`.trim() || 'N/A',
//         'Email': c.email || 'N/A',
//         'Phone': c.phone || 'N/A',
//         'PAN': c.pan_number || 'N/A',
//         'Aadhaar': c.aadhar_number || 'N/A',
//         'Bank Name': c.bank_name || 'N/A',
//         'Account No': c.account_number || 'N/A',
//         'IFSC': c.ifsc_code || 'N/A',
//         'Branch': c.branch || 'N/A',
//         'Amount Due': s.amount,
//         'Due Date': s.payment_date,
//         'Type': s.is_principal ? 'Principal + Interest' : 'Interest Only',
//         'Interest': s.interest_amount || 0,
//         'Principal': s.principal_amount || 0,
//         'Payout Month': s.payout_month,
//         'Payment Method': s.payment_method || 'None',
//       };
//     });

//     // Excel columns
//     const columns = [
//       { header: 'Customer Name', key: 'Customer Name', width: 22 },
//       { header: 'Email', key: 'Email', width: 25 },
//       { header: 'Phone', key: 'Phone', width: 14 },
//       { header: 'PAN', key: 'PAN', width: 14 },
//       { header: 'Aadhaar', key: 'Aadhaar', width: 16 },
//       { header: 'Bank Name', key: 'Bank Name', width: 18 },
//       { header: 'Account No', key: 'Account No', width: 16 },
//       { header: 'IFSC', key: 'IFSC', width: 12 },
//       { header: 'Branch', key: 'Branch', width: 16 },
//       { header: 'Amount Due', key: 'Amount Due', width: 14 },
//       { header: 'Due Date', key: 'Due Date', width: 14 },
//       { header: 'Type', key: 'Type', width: 20 },
//       { header: 'Interest', key: 'Interest', width: 12 },
//       { header: 'Principal', key: 'Principal', width: 12 },
//       { header: 'Payout Month', key: 'Payout Month', width: 12 },
//       { header: 'Payment Method', key: 'Payment Method', width: 14 },
//     ];

//     const filename = `payments-due-${targetDateStr}.xlsx`;
//     const { buffer } = await exportToExcel(rows, columns, filename);

//     res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
//     res.setHeader(
//       'Content-Type',
//       'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
//     );
//     res.send(buffer);
//   } catch (error) {
//     console.error(`Export failed for day ${day}:`, error);
//     res.status(500).json({
//       data: null,
//       error: { code: 'EXPORT_ERROR', message: error.message },
//     });
//   }
// }

async function exportPaymentScheduleByMonthDay(day, res) {
  try {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();

    let targetDay = day === 15 ? 15 : Math.min(30, new Date(year, month + 1, 0).getDate());

    const targetDateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(
      targetDay
    ).padStart(2, '0')}`;

    // Fetch schedules
    const schedules = await PaymentSchedule.find({
      payment_date: targetDateStr,
      is_paid: false,
    }).lean();

    if (!schedules.length) {
      return res.status(404).json({
        data: null,
        error: { code: "NO_DATA", message: `No pending payments due on ${targetDateStr}` },
      });
    }

    // ------- FIX: Manual Join ------- 
    const customerIds = schedules.map(s => s.customer_id);
    const customers = await Customer.find({ _id: { $in: customerIds } })
      .select("first_name last_name email phone pan_number aadhar_number bank_name account_number ifsc_code branch return_method")
      .lean();

    const customerMap = {};
    customers.forEach(c => {
      customerMap[c._id.toString()] = c;
    });

    // ------- SORT BY PAYMENT METHOD ---------
    const sortOrder = {
  Cash: 1,
  Online: 2,
  "Pre IPO": 3,
  "Pre-IPO": 3,
  Cheq: 4,
  Other: 5,
  Bank: 6,  
  None: 7,
  USDT:8,
  "PRE-IPO":3,
  
};

schedules.sort((a, b) => {
  const ac = customerMap[a.customer_id]?.return_method || "None";
  const bc = customerMap[b.customer_id]?.return_method || "None";
  return (sortOrder[ac] || 99) - (sortOrder[bc] || 99);
});


    // ------- FORMAT EXCEL ROWS -------
    const rows = schedules.map((s) => {
      const c = customerMap[s.customer_id] || {};

      return {
        "Customer Name": `${c.first_name || ''} ${c.last_name || ''}`.trim() || "N/A",
        "Email": c.email || "N/A",
        "Phone": c.phone || "N/A",
        "PAN": c.pan_number || "N/A",
        "Aadhaar": c.aadhar_number || "N/A",
        "Bank Name": c.bank_name || "N/A",
        "Account No": c.account_number || "N/A",
        "IFSC": c.ifsc_code || "N/A",
        "Branch": c.branch || "N/A",
        "Amount Due": s.amount,
        "Due Date": s.payment_date,
        "Type": s.is_principal ? "Principal + Interest" : "Interest Only",
        "Interest": s.interest_amount || 0,
        "Principal": s.principal_amount || 0,
        "Payout Month": s.payout_month,
        "Return Method": c.return_method || "None",
      };
    });

    // ------- EXCEL COLUMNS & EXPORT -------
    const columns = [
      { header: "Customer Name", key: "Customer Name", width: 22 },
      { header: "Email", key: "Email", width: 25 },
      { header: "Phone", key: "Phone", width: 14 },
      { header: "PAN", key: "PAN", width: 14 },
      { header: "Aadhaar", key: "Aadhaar", width: 16 },
      { header: "Bank Name", key: "Bank Name", width: 18 },
      { header: "Account No", key: "Account No", width: 16 },
      { header: "IFSC", key: "IFSC", width: 12 },
      { header: "Branch", key: "Branch", width: 16 },
      { header: "Amount Due", key: "Amount Due", width: 14 },
      { header: "Due Date", key: "Due Date", width: 14 },
      { header: "Type", key: "Type", width: 20 },
      { header: "Interest", key: "Interest", width: 12 },
      { header: "Principal", key: "Principal", width: 12 },
      { header: "Payout Month", key: "Payout Month", width: 12 },
      { header: "Return Method", key: "Return Method", width: 14 },
    ];

    const filename = `payments-due-${targetDateStr}.xlsx`;
    const { buffer } = await exportToExcel(rows, columns, filename);

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.send(buffer);

  } catch (error) {
    console.error("Export failed:", error);
    res.status(500).json({
      data: null,
      error: { code: "EXPORT_ERROR", message: error.message },
    });
  }
}



// ------------------- PAYMENT SCHEDULE EXPORT - 15th -------------------
app.get(
  '/payment-schedules/export/15th',
  authMiddleware,
  rbacMiddleware(['manager', 'super_admin']),
  async (req, res) => {
    await exportPaymentScheduleByMonthDay(15, res);
  }
);

// ------------------- PAYMENT SCHEDULE EXPORT - 30th (Smart: Last Day) -------------------
app.get(
  '/payment-schedules/export/30th',
  authMiddleware,
  rbacMiddleware(['manager', 'super_admin']),
  async (req, res) => {
    await exportPaymentScheduleByMonthDay(30, res);
  }
);


// ==================== GET SINGLE COMPANY INVESTMENT DETAILS ====================
app.get(
  '/investments/:id',
  authMiddleware,
  async (req, res) => {
    try {
      const { id } = req.params;

      // Validate ObjectId
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          data: null,
          error: { code: 'INVALID_ID', message: 'Invalid investment ID' },
        });
      }

      // Fetch investment with populated submitted_by & reviewed_by
      const investment = await CompanyInvestment.findById(id)
        .populate('submitted_by', 'first_name last_name email role')
        .populate('reviewed_by', 'first_name last_name email role')
        .lean();

      if (!investment) {
        return res.status(404).json({
          data: null,
          error: { code: 'NOT_FOUND', message: 'Investment not found' },
        });
      }

      // Fetch associated payment (if exists)
      const payment = await InvestmentPayment.findOne({ investment_id: id })
        .select('amount payment_date is_paid paid_at transaction_id payment_method images')
        .lean();

      // Fetch audit trail
      const audits = await AuditTrail.find({ table_name: 'company_investments', record_id: id })
        .populate('performed_by', 'first_name last_name email')
        .sort({ created_at: -1 })
        .limit(10)
        .lean();

      // Mask PII if office_staff
      const maskedInvestment = await maskPII(investment, req.user.role);

      // Format response
      const response = {
        investment: {
          id: maskedInvestment._id,
          name: maskedInvestment.investment_name,
          description: maskedInvestment.description || 'N/A',
          amount: maskedInvestment.investment_amount,
          expected_return: maskedInvestment.expected_return || null,
          return_percentage: maskedInvestment.return_percentage || null,
          investment_date: maskedInvestment.investment_date,
          duration_months: maskedInvestment.duration_months,
          approval_status: maskedInvestment.approval_status,
          review_comments: maskedInvestment.review_comments || null,
          images: maskedInvestment.images || [],
          submitted_by: maskedInvestment.submitted_by
            ? {
                id: maskedInvestment.submitted_by._id,
                name: `${maskedInvestment.submitted_by.first_name} ${maskedInvestment.submitted_by.last_name}`,
                email: maskedInvestment.submitted_by.email,
                role: maskedInvestment.submitted_by.role,
              }
            : null,
          reviewed_by: maskedInvestment.reviewed_by
            ? {
                id: maskedInvestment.reviewed_by._id,
                name: `${maskedInvestment.reviewed_by.first_name} ${maskedInvestment.reviewed_by.last_name}`,
                email: maskedInvestment.reviewed_by.email,
                role: maskedInvestment.reviewed_by.role,
              }
            : null,
          approved_at: maskedInvestment.approved_at || null,
          created_at: maskedInvestment.created_at,
          updated_at: maskedInvestment.updated_at,
        },
        payout: payment
          ? {
              amount: payment.amount,
              payment_date: payment.payment_date,
              is_paid: payment.is_paid,
              paid_at: payment.paid_at,
              transaction_id: payment.transaction_id || null,
              payment_method: payment.payment_method,
              images: payment.images || [],
            }
          : null,
        audit_trail: audits.map((a) => ({
          action: a.action,
          performed_by: a.performed_by
            ? `${a.performed_by.first_name} ${a.performed_by.last_name} (${a.performed_by.email})`
            : 'System',
          timestamp: a.created_at,
          changes: {
            old: a.old_values,
            new: a.new_values,
          },
        })),
      };

      res.json({ data: response, error: null });
    } catch (error) {
      console.error('Get investment detail error:', error);
      res.status(500).json({
        data: null,
        error: { code: 'INVESTMENT_DETAIL_ERROR', message: error.message },
      });
    }
  }
);



// ==================== CURRENT MONTH INVESTMENT PAYMENTS (Payment Table Only) ====================
app.get(
  '/investment-payments/current-month',
  authMiddleware,
  rbacMiddleware(['manager', 'super_admin']),
  async (req, res) => {
    try {
      const {
        page = 1,
        page_size = 50,
        is_paid, // 'true', 'false', or undefined
      } = req.query;

      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth() + 1;
      const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      const endDate = `${year}-${String(month).padStart(2, '0')}-${lastDay}`;

      // Query only from InvestmentPayment table
      const query = {
        payment_date: { $gte: startDate, $lte: endDate },
      };

      if (is_paid !== undefined) {
        query.is_paid = is_paid === 'true';
      }

      const total = await InvestmentPayment.countDocuments(query);

      const payments = await InvestmentPayment.find(query)
        .select(
          'investment_id amount payment_date is_paid paid_at transaction_id payment_method images'
        )
        .sort({ payment_date: 1 })
        .skip((page - 1) * page_size)
        .limit(Math.min(page_size, 100))
        .lean();

      res.json({
        data: {
          items: payments.map(p => ({
            payment_id: p._id,
            investment_id: p.investment_id,
            amount: p.amount,
            payment_date: p.payment_date,
            is_paid: p.is_paid,
            paid_at: p.paid_at,
            transaction_id: p.transaction_id || null,
            payment_method: p.payment_method || 'None',
            images: p.images || [],
          })),
          total,
          page: parseInt(page),
          page_size: parseInt(page_size),
          current_month: `${year}-${String(month).padStart(2, '0')}`,
          date_range: { start: startDate, end: endDate },
        },
        error: null,
      });
    } catch (error) {
      console.error('Simple investment payments error:', error);
      res.status(500).json({
        data: null,
        error: { code: 'PAYMENTS_SIMPLE_ERROR', message: error.message },
      });
    }
  }
);


// ==================== GET SINGLE AGENT DETAILS ====================
app.get('/agents/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        data: null,
        error: { code: 'INVALID_ID', message: 'Invalid agent ID' },
      });
    }

    // Fetch agent with full details
    const agent = await Agent.findById(id)
      .select(
        'first_name last_name agent_type phone email bank_name account_number ifsc_code pan_number aadhar_number address created_at updated_at'
      )
      .lean();

    if (!agent) {
      return res.status(404).json({
        data: null,
        error: { code: 'NOT_FOUND', message: 'Agent not found' },
      });
    }

    res.json({ data: agent, error: null });
  } catch (error) {
    console.error('Get agent detail error:', error);
    res.status(500).json({
      data: null,
      error: { code: 'AGENT_DETAIL_ERROR', message: error.message },
    });
  }
});




// Add this route in your Express app (after multer storage)
// app.get('/files/:filename', authMiddleware, (req, res) => {
//   const filename = req.params.filename;
//   const filePath = path.join(__dirname, 'uploads', filename);

//   fs.access(filePath, fs.constants.F_OK, (err) => {
//     if (err) {
//       return res.status(404).json({ error: { message: 'File not found' } });
//     }
//     res.sendFile(filePath);
//   });
// });

app.get('/files/:filename', authMiddleware, (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join('/tmp', 'uploads', filename);  // ← /tmp/uploads

  fs.access(filePath, fs.constants.F_OK, (err) => {
    if (err) {
      return res.status(404).json({ error: { message: 'File not found' } });
    }
    res.sendFile(filePath, (err) => {
      if (err) {
        console.error('Error sending file:', err);
        res.status(500).json({ error: { message: 'Failed to send file' } });
      } else {
        // Optional: delete after download
        fs.unlink(filePath, () => {});
      }
    });
  });
});



// ------------------- FETCH DUE PAYMENTS BY DAY (15th or 30th) -------------------
// async function getDuePaymentsByDay(day, res) {
//   try {
//     const now = new Date();
//     const year = now.getFullYear();
//     const month = now.getMonth(); // 0 = Jan

//     let targetDay;
//     if (day === 15) {
//       targetDay = 15;
//     } else {
//       // Use 30 or last day of month
//       const lastDay = new Date(year, month + 1, 0).getDate();
//       targetDay = Math.min(30, lastDay);
//     }

//     const targetDateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`;

//     const schedules = await PaymentSchedule.find({
//       payment_date: targetDateStr,
//       is_paid: false,
//     })
//       .populate({
//         path: 'customer_id',
//         select:
//           'first_name last_name email phone pan_number aadhar_number bank_name account_number ifsc_code branch',
//       })
//       .lean();

//     if (!schedules || schedules.length === 0) {
//       return res.status(200).json({
//         data: {
//           items: [],
//           total: 0,
//           due_date: targetDateStr,
//         },
//         error: null,
//       });
//     }

//     const formatted = schedules.map((s) => {
//       const c = s.customer_id || {};
//       return {
//         _id: s._id,
//         customer_name: `${c.first_name || ''} ${c.last_name || ''}`.trim() || 'N/A',
//         email: c.email || 'N/A',
//         phone: c.phone || 'N/A',
//         pan: c.pan_number || 'N/A',
//         aadhaar: c.aadhar_number || 'N/A',
//         bank_name: c.bank_name || 'N/A',
//         account_number: c.account_number || 'N/A',
//         ifsc_code: c.ifsc_code || 'N/A',
//         branch: c.branch || 'N/A',
//         amount_due: s.amount,
//         due_date: s.payment_date,
//         type: s.is_principal ? 'Principal + Interest' : 'Interest Only',
//         interest: s.interest_amount || 0,
//         principal: s.principal_amount || 0,
//         payout_month: s.payout_month,
//         payment_method: s.payment_method || 'None',
//       };
//     });

//     res.status(200).json({
//       data: {
//         items: formatted,
//         total: formatted.length,
//         due_date: targetDateStr,
//       },
//       error: null,
//     });
//   } catch (error) {
//     console.error(`Failed to fetch due payments for day ${day}:`, error);
//     res.status(500).json({
//       data: null,
//       error: { code: 'FETCH_ERROR', message: error.message },
//     });
//   }
// }

// ------------------- FETCH DUE PAYMENTS BY DAY (15th or 30th) -------------------
async function getDuePaymentsByDay(day, res) {
  try {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth(); // 0 = Jan

    let targetDay;
    if (day === 15) {
      targetDay = 15;
    } else {
      // Use 30 or last day of month
      const lastDay = new Date(year, month + 1, 0).getDate();
      targetDay = Math.min(30, lastDay);
    }

    const targetDateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`;

    // Populate customer_id to get name, email, etc. from Customer collection
    const schedules = await PaymentSchedule.find({
      payment_date: targetDateStr,
      is_paid: false,
    })
      .populate({
        path: 'customer_id',
        select: 'first_name last_name email phone pan_number aadhar_number bank_name account_number ifsc_code branch',
        model: 'Customer', // Explicitly specify model (optional but safe)
      })
      .lean();

    if (!schedules || schedules.length === 0) {
      return res.status(200).json({
        data: {
          items: [],
          total: 0,
          due_date: targetDateStr,
        },
        error: null,
      });
    }

    const formatted = schedules.map((s) => {
      const c = s.customer_id || {};
      return {
        _id: s._id,
        customer_name: `${c.first_name || ''} ${c.last_name || ''}`.trim() || 'Unknown Customer',
        email: c.email || 'N/A',
        phone: c.phone || 'N/A',
        pan: c.pan_number || 'N/A',
        aadhaar: c.aadhar_number || 'N/A',
        bank_name: c.bank_name || 'N/A',
        account_number: c.account_number || 'N/A',
        ifsc_code: c.ifsc_code || 'N/A',
        branch: c.branch || 'N/A',
        amount_due: s.amount,
        due_date: s.payment_date,
        type: s.is_principal ? 'Principal + Interest' : 'Interest Only',
        interest: s.interest_amount || 0,
        principal: s.principal_amount || 0,
        payout_month: s.payout_month,
        payment_method: s.payment_method || 'None',
      };
    });

    res.status(200).json({
      data: {
        items: formatted,
        total: formatted.length,
        due_date: targetDateStr,
      },
      error: null,
    });
  } catch (error) {
      console.error(`Failed to fetch due payments for day ${day}:`, error);
      res.status(500).json({
        data: null,
        error: { code: 'FETCH_ERROR', message: error.message },
      });
  }
}

// ------------------- GET DUE PAYMENTS ON 15TH (JSON) -------------------
app.get(
  '/payment-schedules/due/15th',
  authMiddleware,
  rbacMiddleware(['manager', 'super_admin']),
  async (req, res) => {
    await getDuePaymentsByDay(15, res);
  }
);

// ------------------- GET DUE PAYMENTS ON 30TH (OR LAST DAY) (JSON) -------------------
app.get(
  '/payment-schedules/due/30th',
  authMiddleware,
  rbacMiddleware(['manager', 'super_admin']),
  async (req, res) => {
    await getDuePaymentsByDay(30, res);
  }
);




//------------------- get payment of ther specific investment-------------


app.get("/investments/:investmentId/payments", authMiddleware, async (req, res) => {
  try {
    const id = req.params.investmentId;

    const investment = await CompanyInvestment.findById(id).lean();
    if (!investment) {
      return res.status(404).json({
        data: null,
        error: { code: "INVESTMENT_NOT_FOUND", message: "Investment not found" }
      });
    }

    const invSchedules = await InvestmentPayment.find({ investment_id: id })
      .sort({ payment_date: 1 })
      .lean();

    const totalPaid = invSchedules.filter(s => s.is_paid)
      .reduce((sum, s) => sum + s.amount, 0);

    const totalPending = invSchedules.filter(s => !s.is_paid)
      .reduce((sum, s) => sum + s.amount, 0);

    return res.json({
      data: {
        investment,
        investment_payments: invSchedules,
        summary: {
          total_schedules: invSchedules.length,
          total_paid: totalPaid,
          total_pending: totalPending
        }
      },
      error: null
    });

  } catch (error) {
    res.status(500).json({
      data: null,
      error: { code: "SERVER_ERROR", message: error.message }
    });
  }
});


//-------------------get details of payment of specific customer-----------------
app.get("/customers/:customerId/payments", authMiddleware, async (req, res) => {
  try {
    const id = req.params.customerId;

    const customer = await Customer.findById(id).lean();
    if (!customer) {
      return res.status(404).json({
        data: null,
        error: { code: "CUSTOMER_NOT_FOUND", message: "Customer not found" }
      });
    }

    const schedules = await PaymentSchedule.find({ customer_id: id })
      .sort({ payment_date: 1 })
      .lean();

    const agentPayments = await AgentPayment.find({ customer_id: id })
      .sort({ payment_date: 1 })
      .lean();

    const totalPaid = schedules.filter(s => s.is_paid)
      .reduce((sum, s) => sum + s.amount, 0);

    const totalPending = schedules.filter(s => !s.is_paid)
      .reduce((sum, s) => sum + s.amount, 0);

    return res.json({
      data: {
        customer,
        payment_schedules: schedules,
        agent_payments: agentPayments,
        summary: {
          total_schedules: schedules.length,
          total_paid: totalPaid,
          total_pending: totalPending
        }
      },
      error: null
    });

  } catch (error) {
    res.status(500).json({
      data: null,
      error: { code: "SERVER_ERROR", message: error.message }
    });
  }
});


// ------------------- STATS -------------------
app.get('/stats/customers', authMiddleware, async (req, res) => {
  try {
    const total = await Customer.countDocuments();
    const pending = await Customer.countDocuments({ approval_status: 'pending' });
    const approved = await Customer.countDocuments({ approval_status: 'approved' });
    const rejected = await Customer.countDocuments({ approval_status: 'rejected' });
    const settled = await Customer.countDocuments({ approval_status: 'settled' });
    res.json({
      data: {
        total_customers: total,
        pending_approvals: pending,
        approved_customers: approved,
        rejected_customers: rejected,
        settled_customers: settled,
      },
      error: null,
    });
  } catch (error) {
    res
      .status(500)
      .json({ data: null, error: { code: 'STATS_ERROR', message: error.message } });
  }
});

app.get('/profiles/:userId', authMiddleware, async (req, res) => {
 try {
    const { userId } = req.params;

    // Validate UUID format (optional but recommended)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(userId)) {
      return res.status(400).json({ error: { code: 'INVALID_UUID' } });
    }

    const profile = await Profile.findOne({ user_id: userId })
      .select('first_name last_name email role active')
      .lean();

    if (!profile) {
      return res.status(404).json({ error: { code: 'NOT_FOUND' } });
    }

    res.json({ data: profile, error: null });
  } catch (error) {
    console.error('Profile fetch by user_id error:', error);
    res.status(500).json({
      error: { code: 'PROFILE_FETCH_ERROR', message: error.message },
    });
  }
});
// ------------------- DASHBOARD STATS – COUNT OF INVESTMENTS -------------------
app.get(
  '/dashboard/stats',
  authMiddleware,
  rbacMiddleware(['manager', 'super_admin']),
  async (req, res) => {
    try {
      // 1. Total Customers
      const totalCustomers = await Customer.countDocuments({});

      // 2. Active Agents (only approved)
      const activeAgents = await Agent.countDocuments({ approval_status: 'approved' });

      // 3. Pending Customer Approvals
      const pendingCustomers = await Customer.countDocuments({ approval_status: 'pending' });

      // 4. Total Number of Investments – COUNT of records in CompanyInvestment
      const totalInvestmentsCount = await CompanyInvestment.countDocuments({});

      res.json({
        data: {
          total_customers: totalCustomers,
          active_agents: activeAgents,
          pending_customer_approvals: pendingCustomers,
          total_investments_count: totalInvestmentsCount, // ← Number of investment records
          last_updated: new Date().toISOString(),
        },
        error: null,
      });
    } catch (error) {
      console.error('Dashboard Stats Error:', error);
      res.status(500).json({
        data: null,
        error: { code: 'STATS_ERROR', message: error.message },
      });
    }
  }
);



// ------------------- CURRENT MONTH PAYMENT SCHEDULES (TABLE FIELDS ONLY) -------------------
app.get(
  '/payment-schedules/current-month',
  authMiddleware,
  rbacMiddleware(['manager', 'super_admin', 'office_staff']),
  async (req, res) => {
    try {
      // === 1. Current Month Range ===
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth(); // 0 = Jan

      const startDate = new Date(year, month, 1);
      const endDate = new Date(year, month + 1, 0, 23, 59, 59, 999);

      const startStr = startDate.toISOString().split('T')[0];
      const endStr = endDate.toISOString().split('T')[0];

      // === 2. Find All Payment Schedules in Current Month ===
      const schedules = await PaymentSchedule.find({
        payment_date: { $gte: startStr, $lte: endStr }
      }).lean(); // .lean() for faster response

      // === 3. Format (Ensure all fields exist with safe defaults) ===
      const formatted = schedules.map(s => ({
        _id: s._id,
        customer_id: s.customer_id,
        amount: s.amount || 0,
        payment_date: s.payment_date,
        is_paid: s.is_paid || false,
        paid_at: s.paid_at || null,
        is_principal: s.is_principal || false,
        interest_amount: s.interest_amount || 0,
        principal_amount: s.principal_amount || 0,
        payout_month: s.payout_month || 0,
        payment_method: s.payment_method || 'None',
        transaction_id: s.transaction_id || null,
        images: s.images || [],
        start_date: s.start_date || null
      }));

      // === 4. Summary ===
      const totalDue = formatted.reduce((sum, s) => sum + s.amount, 0);
      const paidCount = formatted.filter(s => s.is_paid).length;
      const unpaidCount = formatted.filter(s => !s.is_paid).length;

      res.json({
        data: {
          items: formatted,
          total: formatted.length,
          current_month: `${year}-${String(month + 1).padStart(2, '0')}`,
          date_range: { start: startStr, end: endStr },
          summary: {
            total_due: totalDue,
            paid_count: paidCount,
            unpaid_count: unpaidCount,
            total_payments: formatted.length
          }
        },
        error: null
      });

    } catch (error) {
      console.error('Current Month Payment Schedules Error:', error);
      res.status(500).json({
        data: null,
        error: { code: 'CURRENT_MONTH_SCHEDULES_ERROR', message: error.message }
      });
    }
  }
);



// ------------------- GET ALL AUDIT TRAILS (RAW) -------------------
app.get(
  '/audit-trails',
  authMiddleware,
  rbacMiddleware(['manager', 'super_admin']),
  async (req, res) => {
    try {
      const {
        page = 1,
        page_size = 50,
        action,
        table_name,
        performed_by,
        record_id,
        start_date,
        end_date,
      } = req.query;

      const pageNum = parseInt(page, 10) || 1;
      const pageSize = parseInt(page_size, 10) || 50;
      const skip = (pageNum - 1) * pageSize;

      // Base query
      const query = {};

      // Filters
      if (action) query.action = action;
      if (table_name) query.table_name = table_name;
      if (performed_by) query.performed_by = performed_by;
      if (record_id) query.record_id = record_id;
      if (start_date || end_date) {
        query.created_at = {};
        if (start_date) query.created_at.$gte = new Date(start_date);
        if (end_date) {
          const end = new Date(end_date);
          end.setHours(23, 59, 59, 999);
          query.created_at.$lte = end;
        }
      }

      // Count total
      const total = await AuditTrail.countDocuments(query);

      // Fetch raw audit logs
      const logs = await AuditTrail.find(query)
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(pageSize)
        .lean(); // No population – raw data only

      // Format timestamp
      const formatted = logs.map(log => ({
        _id: log._id,
        table_name: log.table_name || 'N/A',
        record_id: log.record_id ? log.record_id.toString() : 'N/A',
        action: log.action || 'N/A',
        old_values: log.old_values || null,
        new_values: log.new_values || null,
        performed_by: log.performed_by ? log.performed_by.toString() : 'System',
        created_at: format(log.created_at, 'yyyy-MM-dd HH:mm:ss'),
      }));

      res.json({
        data: {
          items: formatted,
          total,
          page: pageNum,
          page_size: pageSize,
          filters: { action, table_name, performed_by, record_id, start_date, end_date },
        },
        error: null,
      });
    } catch (error) {
      console.error('AuditTrail API Error:', error);
      res.status(500).json({
        data: null,
        error: { code: 'AUDIT_TRAIL_ERROR', message: error.message },
      });
    }
  }
);

// ——————— GET SETTLEMENT DETAILS ———————
app.get('/customers/:id/settlement-details', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        data: null,
        error: { code: 'INVALID_ID', message: 'Invalid customer ID' },
      });
    }

    const customer = await Customer.findById(id)
      .populate('plan_id', 'segment discount_percentage')
      .lean();

    if (!customer) {
      return res.status(404).json({
        data: null,
        error: { code: 'NOT_FOUND', message: 'Customer not found' },
      });
    }

    if (!customer.plan_id) {
      return res.status(400).json({
        data: null,
        error: { code: 'NO_PLAN', message: 'Customer has no associated plan' },
      });
    }

    const plan = customer.plan_id;
    const investment_amount = customer.investment_amount || 0;

    // Principal logic
    let principal_amount = investment_amount;
    if (plan.segment === 'INFRASTRUCTURE' && plan.discount_percentage > 0) {
      principal_amount = investment_amount * (1 - plan.discount_percentage / 100);
    }

    // Total paid
    const paidSchedules = await PaymentSchedule.find({
      customer_id: id,
      is_paid: true,
    }).select('amount');

    const total_paid = paidSchedules.reduce((sum, s) => sum + (s.amount || 0), 0);
    const settlement_amount = principal_amount - total_paid;

    res.json({
      data: {
        customer_id: id,
        customer_name: `${customer.first_name || ''} ${customer.last_name || ''}`.trim(),
        segment: plan.segment,
        investment_amount,
        discount_applied: plan.segment === 'INFRASTRUCTURE' ? plan.discount_percentage : 0,
        principal_amount: parseFloat(principal_amount.toFixed(2)),
        total_paid: parseFloat(total_paid.toFixed(2)),
        settlement_amount: parseFloat(settlement_amount.toFixed(2)),
        settlement_type: settlement_amount > 0 ? 'PAYABLE_TO_CUSTOMER' : 'OVERPAID',
      },
      error: null,
    });
  } catch (error) {
    console.error('Settlement API Error:', error);
    res.status(500).json({
      data: null,
      error: { code: 'SETTLEMENT_ERROR', message: error.message },
    });
  }
});



// GET PLAN BY ID
app.get('/plans/:id', authMiddleware, async (req, res) => {
  try {
    const plan = await Plan.findById(req.params.id).lean();
    if (!plan) return res.status(404).json({ data: null, error: { code: 'NOT_FOUND' } });
    res.json({ data: plan, error: null });
  } catch (error) {
    res.status(500).json({ data: null, error: { code: 'ERROR', message: error.message } });
  }
});

// GET TOTAL PAID
app.get('/customers/:id/total-paid', authMiddleware, async (req, res) => {
  try {
    const paid = await PaymentSchedule.find({ customer_id: req.params.id, is_paid: true });
    const total = paid.reduce((sum, p) => sum + p.amount, 0);
    res.json({ data: { total_paid: parseFloat(total.toFixed(2)) }, error: null });
  } catch (error) {
    res.status(500).json({ data: null, error: { code: 'ERROR', message: error.message } });
  }
});



// ------------------- CUSTOMER FULL EXCEL REPORT (MongoDB + Mongoose) -------------------
// Add this route directly into your existing backend code (after other routes)

app.get(
  '/customers/:id/full-excel',
  authMiddleware,
  rbacMiddleware(['manager', 'super_admin']),
  async (req, res) => {
    try {
      const { id } = req.params;

      // 1. Fetch Customer + FULL Plan + FULL Agent
      const customer = await Customer.findById(id)
        .populate({
          path: 'plan_id',
          select: 'name segment investment_amount return_percentage duration_months payment_type discount_percentage maturity_amount'
        })
        .populate({
          path: 'agent_id',
          select: 'first_name last_name email phone agent_type commission_percentage bank_name account_number ifsc_code branch'
        })
        .lean();

      if (!customer) {
        return res.status(404).json({ 
          data: null, 
          error: { code: 'NOT_FOUND', message: 'Customer not found' } 
        });
      }

      // 2. Fetch payments (no sorting)
      const payments = await PaymentSchedule.find({ customer_id: id }).lean();

      // 3. Calculate totals
      const totalPaid = payments
        .filter(p => p.is_paid)
        .reduce((sum, p) => sum + (p.amount || 0), 0);

      const totalExpected = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
      const pending = totalExpected - totalPaid;

      // 4. Excel Workbook
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Customer Full Report');

      // Title
      sheet.mergeCells('A1:O1');
      sheet.getCell('A1').value = 'ELITE WEALTH - COMPLETE CUSTOMER REPORT';
      sheet.getCell('A1').font = { size: 18, bold: true };
      sheet.getCell('A1').alignment = { horizontal: 'center' };

      sheet.mergeCells('A2:O2');
      sheet.getCell('A2').value = `${customer.first_name} ${customer.last_name} | ID: ${id} | ${new Date().toLocaleDateString('en-IN')}`;
      sheet.getCell('A2').font = { size: 14, bold: true };

      let row = 4;

      // Customer Details
      sheet.getCell(`A${row}`).value = 'CUSTOMER DETAILS';
      sheet.getCell(`A${row++}`).font = { bold: true, size: 13 };
      sheet.addRow(['Name', `${customer.first_name || ''} ${customer.last_name || ''}`.trim()]);
      sheet.addRow(['Email', customer.email || 'N/A']);
      sheet.addRow(['Phone', customer.phone || 'N/A']);
      sheet.addRow(['PAN', customer.pan_number || 'N/A']);
      sheet.addRow(['Aadhar', customer.aadhar_number || 'N/A']);
      sheet.addRow(['Address', customer.address || 'N/A']);
      sheet.addRow(['Nominee', customer.nominee || 'N/A']);
      sheet.addRow(['Bank', customer.bank_name || 'N/A']);
      sheet.addRow(['A/c No', customer.account_number || 'N/A']);
      sheet.addRow(['IFSC', customer.ifsc_code || 'N/A']);
      sheet.addRow(['Investment Date', customer.investment_date ? format(new Date(customer.investment_date), 'dd-MM-yyyy') : 'N/A']);
      sheet.addRow(['Status', customer.approval_status?.toUpperCase() || 'N/A']);
      row += 13;

      // PLAN DETAILS - NOW FULLY POPULATED
      const plan = customer.plan_id || {};
      sheet.getCell(`A${row}`).value = 'PLAN DETAILS';
      sheet.getCell(`A${row++}`).font = { bold: true, size: 13 };
      sheet.addRow(['Plan Name', plan.name || 'N/A']);
      sheet.addRow(['Segment', plan.segment || 'N/A']);
      sheet.addRow(['Investment Amount', `₹${(plan.investment_amount || customer.investment_amount || 0).toLocaleString('en-IN')}`]);
      sheet.addRow(['Return %', `${plan.return_percentage || 0}%`]);
      sheet.addRow(['Duration', `${plan.duration_months || 0} months`]);
      sheet.addRow(['Payment Type', plan.payment_type || 'N/A']);
      sheet.addRow(['Discount %', `${plan.discount_percentage || 0}%`]);
      sheet.addRow(['Maturity Amount', plan.maturity_amount ? `₹${plan.maturity_amount.toLocaleString('en-IN')}` : 'N/A']);
      row += 10;

      // AGENT DETAILS - NOW FULLY POPULATED
      const agent = customer.agent_id || {};
      sheet.getCell(`A${row}`).value = 'AGENT DETAILS';
      sheet.getCell(`A${row++}`).font = { bold: true, size: 13 };
      if (agent && agent._id) {
        sheet.addRow(['Agent Name', `${agent.first_name || ''} ${agent.last_name || ''}`.trim()]);
        sheet.addRow(['Email', agent.email || 'N/A']);
        sheet.addRow(['Phone', agent.phone || 'N/A']);
        sheet.addRow(['Agent Type', agent.agent_type || 'N/A']);
        sheet.addRow(['Commission %', `${agent.commission_percentage || 0}%`]);
        sheet.addRow(['Bank', agent.bank_name || 'N/A']);
        sheet.addRow(['A/c No', agent.account_number || 'N/A']);
        sheet.addRow(['IFSC', agent.ifsc_code || 'N/A']);
        sheet.addRow(['Branch', agent.branch || 'N/A']);
      } else {
        sheet.addRow(['Agent', 'DIRECT CUSTOMER (No Agent Assigned)']);
      }
      row += 11;

      // Payment Summary
      sheet.getCell(`A${row}`).value = 'PAYMENT SUMMARY';
      sheet.getCell(`A${row++}`).font = { bold: true, size: 13 };
      sheet.addRow(['Total Expected', `₹${totalExpected.toLocaleString('en-IN')}`]);
      sheet.addRow(['Total Paid', `₹${totalPaid.toLocaleString('en-IN')}`]);
      sheet.addRow(['Pending Amount', `₹${pending.toLocaleString('en-IN')}`]);
      sheet.addRow(['Progress', `${totalExpected > 0 ? ((totalPaid / totalExpected) * 100).toFixed(2) : 0}%`]);
      row += 6;

      // Payment Schedule
      sheet.addRow(['FULL PAYMENT SCHEDULE']).font = { bold: true, size: 14 };
      sheet.addRow([
        'Sr.', 'Due Date', 'Amount', 'Paid Date', 'Status',
        'Principal', 'Interest', 'Type', 'Payout Month', 'Method', 'Txn ID'
      ]).font = { bold: true };

      payments.forEach((p, i) => {
        const r = sheet.addRow([
          i + 1,
          format(new Date(p.payment_date), 'dd-MM-yyyy'),
          p.amount || 0,
          p.paid_at ? format(new Date(p.paid_at), 'dd-MM-yyyy') : '-',
          p.is_paid ? 'PAID' : 'PENDING',
          p.principal_amount || 0,
          p.interest_amount || 0,
          p.payment_type || 'N/A',
          p.payout_month || '-',
          p.payment_method || 'None',
          p.transaction_id || '-'
        ]);
        if (p.is_paid) r.getCell(5).font = { color: { argb: 'FF006400' }, bold: true };
        if (p.is_principal) r.eachCell(c => c.font = { bold: true });
      });

      // Column widths
      sheet.columns = [
        { width: 6 }, { width: 14 }, { width: 16 }, { width: 14 }, { width: 12 },
        { width: 14 }, { width: 14 }, { width: 12 }, { width: 14 }, { width: 12 }, { width: 20 }
      ];

      // Send file
      const filename = `EliteWealth_Customer_${id}_${customer.first_name || 'User'}_Report_${format(new Date(), 'yyyy-MM-dd')}.xlsx`;
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

      await workbook.xlsx.write(res);
      res.end();

    } catch (err) {
      console.error('Excel Report Error:', err);
      res.status(500).json({
        data: null,
        error: { code: 'EXCEL_ERROR', message: 'Failed to generate report', details: err.message }
      });
    }
  }
);


// ------------------- INVESTMENT DETAILS EXPORT TO EXCEL (MongoDB + Mongoose) -------------------
// app.get(
//   '/investments/:id/export-excel',
//   authMiddleware,
//   rbacMiddleware(['manager', 'super_admin']),
//   async (req, res) => {
//     try {
//       const investment_id = req.params.id;

     
//       const investment = await CompanyInvestment.findById(investment_id).lean();
//       if (!investment) throw new Error("Investment not found");

     
//       const payments = await InvestmentPayment.find({ investment_id })
//         .sort({ payout_cycle: 1 })
//         .lean();

      
//       const exportRows = [];

//       // Investment Base Info Row
//       exportRows.push({
//         Label: "Investment ID",
//         Value: investment._id,
//       });
//       exportRows.push({ Label: "Investment Name", Value: investment.investment_name });
//       exportRows.push({ Label: "Investment Amount", Value: investment.investment_amount });
//       exportRows.push({ Label: "Monthly Return %", Value: investment.return_percentage });
//       exportRows.push({ Label: "Duration (Months)", Value: investment.duration_months });
//       exportRows.push({ Label: "Investment Date", Value: investment.investment_date });
//       exportRows.push({ Label: "", Value: "" }); // empty row

//       exportRows.push({
//         Label: "---- MONTHLY PAYMENTS (INTEREST ONLY) ----",
//         Value: "",
//       });

//       // Payment Rows
//       payments.forEach((p, idx) => {
//         exportRows.push({
//           Label: `Month ${p.payout_cycle}`,
//           Value: `₹${p.amount} | ${p.payment_date} | Paid: ${p.is_paid ? "Yes" : "No"}`
//         });
//       });

      
//       const workbook = new ExcelJS.Workbook();
//       const ws = workbook.addWorksheet("Investment Details");

//       ws.columns = [
//         { header: "Label", key: "Label", width: 40 },
//         { header: "Value", key: "Value", width: 60 },
//       ];

//       ws.addRows(exportRows);

//       const fileBuffer = await workbook.xlsx.writeBuffer();

//       res.setHeader(
//         "Content-Disposition",
//         `attachment; filename=investment_${investment_id}.xlsx`
//       );
//       res.setHeader(
//         "Content-Type",
//         "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
//       );

//       return res.send(fileBuffer);

//     } catch (err) {
//       console.error("Excel Export Error:", err);
//       res.status(400).json({
//         data: null,
//         error: { code: "EXPORT_ERROR", message: err.message },
//       });
//     }
//   }
// );



app.get(
  '/investments/:id/export-excel',
  authMiddleware,
  rbacMiddleware(['manager', 'super_admin']),
  async (req, res) => {
    try {
      const investment_id = req.params.id;

      // 1. Fetch investment
      const investment = await CompanyInvestment.findById(investment_id).lean();
      if (!investment) throw new Error("Investment not found");

      // 2. Fetch monthly payments
      const payments = await InvestmentPayment.find({ investment_id })
        .sort({ payout_cycle: 1 })
        .lean();

      // 3. Create Excel workbook
      const workbook = new ExcelJS.Workbook();
      const ws = workbook.addWorksheet("Investment Report");

      // -------------------------------
      // 📌 SECTION 1 — INVESTMENT DETAILS
      // -------------------------------
      ws.addRow(["INVESTMENT DETAILS"]);
      ws.getRow(1).font = { bold: true, size: 14 };

      ws.addRow(["Investment ID", investment._id]);
      ws.addRow(["Investment Name", investment.investment_name || "-"]);
      ws.addRow(["Investment Amount", investment.investment_amount]);
      ws.addRow(["Monthly Return %", investment.return_percentage]);
      ws.addRow(["Duration (Months)", investment.duration_months]);
      ws.addRow(["Investment Date", investment.investment_date]);

      ws.addRow([]); // empty line

      // -------------------------------
      //  SECTION 2 — MONTHLY PAYMENTS
      // -------------------------------
      ws.addRow(["MONTHLY PAYMENT SCHEDULE"]);
      const headerRow = ws.addRow([
        "Month No.",
        "Payment Date",
        "Interest Amount",
        "Paid?",
        "Payment Method",
        "Transaction ID"
      ]);

      // Style header
      headerRow.eachCell((cell) => {
        cell.font = { bold: true };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFCCCCCC" },
        };
      });

      // Add monthly payments
      payments.forEach((p) => {
        ws.addRow([
          p.payout_cycle,
          p.payment_date,
          p.amount,
          p.is_paid ? "Yes" : "No",
          p.payment_method || "None",
          p.transaction_id || "-"
        ]);
      });

      // Auto column sizing
      ws.columns.forEach((column) => {
        let maxLength = 10;
        column.eachCell({ includeEmpty: true }, (cell) => {
          const len = cell.value ? cell.value.toString().length : 10;
          if (len > maxLength) maxLength = len;
        });
        column.width = maxLength + 5;
      });

      // 4. Generate Excel buffer
      const fileBuffer = await workbook.xlsx.writeBuffer();

      // 5. Send response
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=investment_${investment_id}.xlsx`
      );
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );

      res.send(fileBuffer);

    } catch (err) {
      console.error("Excel Export Error:", err);
      res.status(400).json({
        data: null,
        error: { code: "EXPORT_ERROR", message: err.message },
      });
    }
  }
);



// ------------------- ERROR HANDLER -------------------
app.use((error, req, res, next) => {
  console.error(error);
  res
    .status(500)
    .json({ data: null, error: { code: 'INTERNAL_ERROR', message: error.message } });
});


app.get("/", (req, res) => {
  res.send("server is running");

  
});
// ------------------- START SERVER -------------------
async function startServer() {
  await connectDB();
  await setupDatabase();
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();