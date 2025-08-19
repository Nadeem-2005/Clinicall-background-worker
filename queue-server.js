import { Queue, Worker } from 'bullmq';
import { createTransport } from 'nodemailer';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

console.log('EMAIL_USER:', process.env.EMAIL_USER ? 'Loaded' : 'Missing');
console.log('EMAIL_PASS:', process.env.EMAIL_PASS ? 'Loaded' : 'Missing');
console.log('REDIS_URL:', process.env.REDIS_URL ? 'Loaded' : 'Missing');

const redisUrl = process.env.REDIS_URL;
const redisConfig = redisUrl
  ? { 
      url: redisUrl,
      enableAutoPipelining: true,
      maxRetriesPerRequest: 2,
      lazyConnect: true,
      keepAlive: 60000,
    }
  : {
      host: process.env.REDIS_HOST || "localhost",
      port: parseInt(process.env.REDIS_PORT || "6379"),
      password: process.env.REDIS_PASSWORD,
      enableAutoPipelining: true,
    };

console.log('Using Redis URL:', redisConfig);

const transporter = createTransport({
  service: 'Gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

const emailQueue = new Queue('email processing', {
  connection: redisConfig,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: 1,
    removeOnFail: 2,
  },
});

const notificationQueue = new Queue('notification processing', {
  connection: redisConfig,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: true,
    removeOnFail: true,
  },
});

const emailWorker = new Worker('email processing', async (job) => {
  const { type, to, data } = job.data;
  
  try {
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
    return { success: false, error: error.message };
  }
}, {
  connection: redisConfig,
  concurrency: 1,
  settings: {
    stalledInterval: 60000,
    maxStalledCount: 1,
  },
});

const notificationWorker = new Worker('notification processing', async (job) => {
  const { userId, message, type } = job.data;
  
  try {
    console.log(`Processing notification for user ${userId}: ${message}`);
    return { success: true, userId, message, type };
  } catch (error) {
    console.error(`Failed to process notification for user ${userId}`, error.message);
    return { success: false, error: error.message };
  }
}, {
  connection: redisConfig,
  concurrency: 1,
  settings: {
    stalledInterval: 120000,
    maxStalledCount: 1,
  },
});

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

setInterval(async () => {
  try {
    await emailQueue.clean(300000, 100, 'completed');
    await emailQueue.clean(600000, 50, 'failed');
    console.log('Queue cleanup completed');
  } catch (error) {
    console.error('Queue cleanup error:', error.message);
  }
}, 600000);

const gracefulShutdown = async () => {
  console.log('Shutting down queue server...');
  await emailWorker.close();
  await notificationWorker.close();
  await emailQueue.close();
  await notificationQueue.close();
  process.exit(0);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

console.log('Queue server started successfully');
console.log('Expected operations: ~5-10 per minute');
console.log('Email queue processing with 1 concurrent job');
console.log('Notification queue processing with 1 concurrent job');