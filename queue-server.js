import { Queue, Worker } from 'bullmq';
import { createTransport } from 'nodemailer';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

// Debug environment variables
console.log('EMAIL_USER:', process.env.EMAIL_USER ? 'Loaded' : 'Missing');
console.log('EMAIL_PASS:', process.env.EMAIL_PASS ? 'Loaded' : 'Missing');
console.log('REDIS_URL:', process.env.REDIS_URL ? 'Loaded' : 'Missing');

// Redis connection config - optimized for reduced operations
const redisUrl = process.env.REDIS_URL;
const redisConfig = redisUrl
  ? { 
      url: redisUrl,
      enableAutoPipelining: true,  // Batches Redis commands automatically
      maxRetriesPerRequest: 2,     // Reduced retries to limit operations
      lazyConnect: true,           // Connect only when needed
      keepAlive: 60000,           // Longer connection pooling
    }
  : {
      host: process.env.REDIS_HOST || "localhost",
      port: parseInt(process.env.REDIS_PORT || "6379"),
      password: process.env.REDIS_PASSWORD,
      enableAutoPipelining: true,  // Local development optimization
    };

console.log('Using Redis URL:', redisConfig);

// Nodemailer setup for sending emails
const transporter = createTransport({
  service: 'Gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Email queue - handles appointment notifications, confirmations, etc.
// Used by: app/api/appointments/doctor/route.ts, app/api/appointments/hospital/route.ts
const emailQueue = new Queue('email processing', {
  connection: redisConfig,
  defaultJobOptions: {
    attempts: 1,              // No retries to reduce failed job operations
    removeOnComplete: 1,      // Keep only 1 completed job (was 100)
    removeOnFail: 2,         // Keep only 2 failed jobs for debugging (was 50)
  },
});

// Notification queue - handles real-time notifications via Pusher
// Used by: lib/pusher-server.ts
const notificationQueue = new Queue('notification processing', {
  connection: redisConfig,
  defaultJobOptions: {
    attempts: 1,              // No retries for notifications
    removeOnComplete: true,   // Remove immediately after processing
    removeOnFail: true,      // Remove failed notifications (not critical)
  },
});

// Email worker - processes jobs from lib/mail-queue.ts functions
// Triggered by: queueAppointmentNotificationToDoctor, queueAppointmentConfirmationToUser, etc.
const emailWorker = new Worker('email processing', async (job) => {
  const { type, to, data } = job.data;
  
  try {
    // Send email regardless of type (simplified from switch statement)
    await transporter.sendMail({
      from: `"Clinical App Team" <${process.env.EMAIL_USER}>`,
      to,
      subject: data.subject,
      html: data.html,
    });
    
    console.log(`Email sent successfully: ${type} to ${to}`);
    return { success: true, type, to };
  } catch (error) {
    console.error(`Failed to send email: ${type} to ${to}`, error.message);
    return { success: false, error: error.message };  // Don't throw to prevent retries
  }
}, {
  connection: redisConfig,
  concurrency: 1,              // Reduced from 10 to 1 (90% less polling)
  settings: {
    stalledInterval: 60000,    // Check for stalled jobs every 60s (was 5s default)
    maxStalledCount: 1,        // Minimal stalled job monitoring
  },
});

// Notification worker - processes jobs from lib/pusher-server.ts
// Triggered by: notifyAppointmentUpdate, notifyDoctorNewAppointment, etc.
const notificationWorker = new Worker('notification processing', async (job) => {
  const { userId, message, type } = job.data;
  
  try {
    // TODO: Add actual Pusher notification logic here
    console.log(`Processing notification for user ${userId}: ${message}`);
    return { success: true, userId, message, type };
  } catch (error) {
    console.error(`Failed to process notification for user ${userId}`, error.message);
    return { success: false, error: error.message };  // Don't throw to prevent retries
  }
}, {
  connection: redisConfig,
  concurrency: 1,              // Reduced from 5 to 1 (80% less polling)
  settings: {
    stalledInterval: 120000,   // Check every 2 minutes for notifications
    maxStalledCount: 1,
  },
});

// Worker event handlers for logging
emailWorker.on('completed', (job, result) => {
  if (result.success) {
    console.log(`Email job ${job.id} completed`);
  }
});

emailWorker.on('failed', (job, error) => {
  console.error(`Email job ${job.id} failed:`, error.message);
});

notificationWorker.on('completed', (job, result) => {
  console.log(`Notification job ${job.id} completed`);
});

// Periodic cleanup to prevent Redis memory buildup
// Runs every 10 minutes to clean old completed/failed jobs
setInterval(async () => {
  try {
    await emailQueue.clean(300000, 100, 'completed');    // Remove completed jobs older than 5 min
    await emailQueue.clean(600000, 50, 'failed');        // Remove failed jobs older than 10 min
    console.log('Queue cleanup completed');
  } catch (error) {
    console.error('Queue cleanup error:', error.message);
  }
}, 600000);  // Every 10 minutes

// Graceful shutdown handler for production deployment
const gracefulShutdown = async () => {
  console.log('Shutting down queue server...');
  await emailWorker.close();
  await notificationWorker.close();
  await emailQueue.close();
  await notificationQueue.close();
  process.exit(0);
};

// Handle termination signals from Koyeb/Docker
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

console.log('Queue server started successfully');
console.log('Expected operations: ~5-10 per minute (reduced from ~18 per second)');
console.log('Email queue processing with 1 concurrent job');
console.log('Notification queue processing with 1 concurrent job');