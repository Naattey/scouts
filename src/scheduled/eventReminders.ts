import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';

const db = admin.firestore();

/**
 * Scheduled: sendEventReminders
 * Runs daily at 8:00 AM to send reminders for upcoming events
 */
export const sendEventReminders = onSchedule({
  schedule: '0 8 * * *', // Every day at 8:00 AM
  timeZone: 'Indian/Maldives',
  region: 'us-central1',
}, async () => {
  console.log('Running event reminders job...');

  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(23, 59, 59, 999);

  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  try {
    // Get events happening tomorrow
    const eventsQuery = await db.collection('events')
      .where('isPublished', '==', true)
      .where('status', '==', 'published')
      .where('startDate', '>=', admin.firestore.Timestamp.fromDate(now))
      .where('startDate', '<=', admin.firestore.Timestamp.fromDate(tomorrow))
      .get();

    console.log(`Found ${eventsQuery.size} upcoming events`);

    for (const eventDoc of eventsQuery.docs) {
      const eventData = eventDoc.data();
      const eventId = eventDoc.id;

      // Get registered participants
      const registrations = await db.collection(`events/${eventId}/registrations`)
        .where('status', '==', 'registered')
        .get();

      for (const regDoc of registrations.docs) {
        const reg = regDoc.data();
        const roverId = reg.roverId;

        // Get rover's FCM token
        const roverDoc = await db.doc(`rovers/${roverId}`).get();
        const roverData = roverDoc.data();

        if (roverData?.fcmToken) {
          const eventDate = eventData.startDate.toDate();
          const formattedDate = eventDate.toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'short',
            day: 'numeric',
          });

          try {
            await admin.messaging().send({
              token: roverData.fcmToken,
              notification: {
                title: 'Event Reminder',
                body: `${eventData.title} is happening ${formattedDate}`,
              },
              data: {
                type: 'event_reminder',
                eventId,
              },
            });
          } catch (error) {
            console.error(`Failed to send reminder to rover ${roverId}:`, error);
          }
        }
      }
    }

    console.log('Event reminders job completed');

  } catch (error) {
    console.error('Error in event reminders job:', error);
    throw error;
  }
});

/**
 * Scheduled: sendMeetingReminders
 * Runs daily at 7:00 AM to send reminders for meetings today
 */
export const sendMeetingReminders = onSchedule({
  schedule: '0 7 * * *', // Every day at 7:00 AM
  timeZone: 'Indian/Maldives',
  region: 'us-central1',
}, async () => {
  console.log('Running meeting reminders job...');

  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);

  try {
    // Get meetings happening today
    const meetingsQuery = await db.collection('meetings')
      .where('status', '==', 'scheduled')
      .where('date', '>=', admin.firestore.Timestamp.fromDate(todayStart))
      .where('date', '<=', admin.firestore.Timestamp.fromDate(todayEnd))
      .get();

    console.log(`Found ${meetingsQuery.size} meetings today`);

    for (const meetingDoc of meetingsQuery.docs) {
      const meetingData = meetingDoc.data();
      const meetingId = meetingDoc.id;

      // Get expected attendees
      const attendees = meetingData.expectedAttendees || [];

      for (const roverId of attendees) {
        const roverDoc = await db.doc(`rovers/${roverId}`).get();
        const roverData = roverDoc.data();

        if (roverData?.fcmToken) {
          try {
            await admin.messaging().send({
              token: roverData.fcmToken,
              notification: {
                title: 'Meeting Today',
                body: `${meetingData.title} at ${meetingData.startTime}`,
              },
              data: {
                type: 'meeting_reminder',
                meetingId,
              },
            });
          } catch (error) {
            console.error(`Failed to send meeting reminder to rover ${roverId}:`, error);
          }
        }
      }
    }

    console.log('Meeting reminders job completed');

  } catch (error) {
    console.error('Error in meeting reminders job:', error);
    throw error;
  }
});
