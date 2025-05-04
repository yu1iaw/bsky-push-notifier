import { AtpAgent } from '@atproto/api';
import dotenv from 'dotenv';
import admin from 'firebase-admin';
import { createClient } from 'redis';


dotenv.config();
admin.initializeApp({ credential: admin.credential.cert('./serviceAccountKey.json') });

const redisClient = createClient({
    socket: {
        host: process.env.REDIS_HOST,
        port: process.env.REDIS_PORT,
        tls: true
    },
    password: process.env.REDIS_PASSWORD,
})
    .on("error", (err) => console.error('Redis connection error: ', err))


const agent = new AtpAgent({
    service: 'https://bsky.social',
    persistSession: (evt, session) => {
        console.log('Persisting session', evt);
    }
});

const login = async () => {
    try {
        const { data, headers } = await agent.login({
            identifier: process.env.BSKY_LOGIN,
            password: process.env.BSKY_PASSWORD,
        });

        return { success: true };
    } catch (error) {
        return { success: false };
    }
}

const sendFCMPush = async (title) => {
    const message = {
        notification: { title, body: 'Go to bsky.app' },
        data: { url: 'https://bsky.app' },
        android: {
            priority: 'high',
            notification: {
                click_action: 'OPEN_URL',
            },
        },
        token: process.env.FCM_TOKEN
    };

    try {
        const response = await admin.messaging().send(message);
    } catch (error) {
        console.error('Error sending push notification:', error);
    }
}

const checkNotifications = async () => {
    try {
        const response = await agent.listNotifications();
        const unreadNotifications = response.data.notifications.filter(n => !n.isRead);
    
        if (unreadNotifications.length) {
            if (!redisClient.isReady) {
                await redisClient.connect();
            }
    
            for (const notification of unreadNotifications) {
                const isProcessed = await redisClient.get(notification.cid);
                if (isProcessed) continue;
    
                let message = '';
                if (notification.reason === 'mention') {
                    message = `📨 New mention from ${notification.author.handle}!`;
                } else if (notification.reason === 'reply') {
                    message = `💬 New reply from ${notification.author.handle}!`;
                }
                if (message) {
                    await sendFCMPush(message);
                    await redisClient.set(notification.cid, 'processed', { EX: 60 * 60 * 36 });
                    // await agent.updateSeenNotifications();
                }
            }
        }
    } catch (error) {
        console.error('Error checking notifications:', error);
    } finally {
        if (redisClient.isOpen) {
            redisClient.disconnect();
        }
    }
}

(async () => {
    const { success } = await login();
    if (!success) return;

    setInterval(checkNotifications, 60000 * 20);
})()