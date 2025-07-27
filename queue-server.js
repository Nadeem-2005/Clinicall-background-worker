import { Queue, Worker } from 'bullmq';
import { createTransport } from 'nodemailer';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

//For debugging purposes
console.log('EMAIL_USER:', process.env.EMAIL_USER ? 'Loaded' : 'Missing');
console.log('EMAIL_PASS:', process.env.EMAIL_PASS ? 'Loaded' : 'Missing');
console.log('REDIS_URL:', process.env.REDIS_URL ? 'Loaded' : 'Missing');
// Redis connection configuration for BullMQ (local development)
// const redisConfig = {
//   host: process.env.REDIS_HOST || 'localhost',
//   port: parseInt(process.env.REDIS_PORT || '6379'),
//   password: process.env.REDIS_PASSWORD,
// };

// Redis connection configuration for production using Upstash
const redisUrl = process.env.REDIS_URL;
const redisConfig = redisUrl
  ? { url: redisUrl }
  : {
      host: process.env.REDIS_HOST || "localhost",
      port: parseInt(process.env.REDIS_PORT || "6379"),
      password: process.env.REDIS_PASSWORD,
    };
console.log('Using Redis URL:', redisConfig);
// Email transporter configuration
const transporter = createTransport({
  service: 'Gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Email queue configuration
const emailQueue = new Queue('email processing', {
  connection: redisConfig,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: 100,
    removeOnFail: 50,
  },
});

// Notification queue for real-time notifications
const notificationQueue = new Queue('notification processing', {
  connection: redisConfig,
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: 'fixed',
      delay: 1000,
    },
    removeOnComplete: 50,
    removeOnFail: 25,
  },
});

// Process email jobs
const emailWorker = new Worker('email processing', async (job) => {
  const { type, to, data } = job.data;
  
  try {
    switch (type) {
      case 'appointment_confirmation':
        await transporter.sendMail({
          from: `"Clinical App Team" <${process.env.EMAIL_USER}>`,
          to,
          subject: data.subject,
          html: data.html,
        });
        break;
        
      case 'appointment_notification':
        await transporter.sendMail({
          from: `"Clinical App Team" <${process.env.EMAIL_USER}>`,
          to,
          subject: data.subject,
          html: data.html,
        });
        break;
        
      case 'appointment_status_update':
        await transporter.sendMail({
          from: `"Clinical App Team" <${process.env.EMAIL_USER}>`,
          to,
          subject: data.subject,
          html: data.html,
        });
        break;
        
      case 'approval':
      case 'rejection':
        await transporter.sendMail({
          from: `"Clinical App Team" <${process.env.EMAIL_USER}>`,
          to,
          subject: data.subject,
          html: data.html,
        });
        break;
        
      default:
        throw new Error(`Unknown email type: ${type}`);
    }
    
    console.log(`Email sent successfully: ${type} to ${to}`);
    return { success: true, type, to };
  } catch (error) {
    console.error(`Failed to send email: ${type} to ${to}`, error);
    throw error;
  }
}, {
  connection: redisConfig,
  concurrency: 10,
});

// Process notification jobs
const notificationWorker = new Worker('notification processing', async (job) => {
  const { userId, message, type } = job.data;
  
  try {
    // Here you would typically save to database and send via Pusher
    console.log(`Processing notification for user ${userId}: ${message}`);
    
    // Add your notification processing logic here
    // e.g., save to database, send via Pusher, etc.
    
    return { success: true, userId, message, type };
  } catch (error) {
    console.error(`Failed to process notification for user ${userId}`, error);
    throw error;
  }
}, {
  connection: redisConfig,
  concurrency: 5,
});

// Queue event handlers
emailWorker.on('completed', (job, result) => {
  console.log(`Email job ${job.id} completed`);
});

emailWorker.on('failed', (job, error) => {
  console.error(`Email job ${job.id} failed:`, error);
});

notificationWorker.on('completed', (job, result) => {
  console.log(`Notification job ${job.id} completed`);
});

notificationWorker.on('failed', (job, error) => {
  console.error(`Notification job ${job.id} failed:`, error);
});

// Graceful shutdown
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
console.log(`Listening for jobs on Redis URL: ${redisConfig}`);
console.log('Email queue processing up to 10 concurrent jobs');
console.log('Notification queue processing up to 5 concurrent jobs');