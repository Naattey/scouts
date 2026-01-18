import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';

const db = admin.firestore();

/**
 * Scheduled: cleanupOldAuditLogs
 * Runs weekly to clean up audit logs older than 90 days
 */
export const cleanupOldAuditLogs = onSchedule({
  schedule: '0 2 * * 0', // Every Sunday at 2:00 AM
  timeZone: 'Indian/Maldives',
  region: 'us-central1',
}, async () => {
  console.log('Running audit log cleanup job...');

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 90); // 90 days ago

  try {
    // Get old audit logs
    const oldLogs = await db.collection('audit_logs')
      .where('createdAt', '<', admin.firestore.Timestamp.fromDate(cutoffDate))
      .limit(500)
      .get();

    if (oldLogs.empty) {
      console.log('No old audit logs to clean up');
      return;
    }

    console.log(`Deleting ${oldLogs.size} old audit logs`);

    const batch = db.batch();
    oldLogs.forEach(doc => {
      batch.delete(doc.ref);
    });

    await batch.commit();
    console.log('Audit log cleanup completed');

  } catch (error) {
    console.error('Error in audit log cleanup:', error);
    throw error;
  }
});

/**
 * Scheduled: cleanupExpiredSessions
 * Runs daily to clean up expired sessions and tokens
 */
export const cleanupExpiredSessions = onSchedule({
  schedule: '0 3 * * *', // Every day at 3:00 AM
  timeZone: 'Indian/Maldives',
  region: 'us-central1',
}, async () => {
  console.log('Running expired sessions cleanup job...');

  const now = new Date();

  try {
    // Clean up expired password reset tokens
    const expiredTokens = await db.collection('password_reset_tokens')
      .where('expiresAt', '<', admin.firestore.Timestamp.fromDate(now))
      .limit(500)
      .get();

    if (!expiredTokens.empty) {
      console.log(`Deleting ${expiredTokens.size} expired tokens`);
      const batch = db.batch();
      expiredTokens.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    }

    console.log('Expired sessions cleanup completed');

  } catch (error) {
    console.error('Error in expired sessions cleanup:', error);
    throw error;
  }
});

/**
 * Scheduled: updateEventStatuses
 * Runs hourly to update event statuses based on dates
 */
export const updateEventStatuses = onSchedule({
  schedule: '0 * * * *', // Every hour
  timeZone: 'Indian/Maldives',
  region: 'us-central1',
}, async () => {
  console.log('Running event status update job...');

  const now = new Date();

  try {
    // Find published events that have ended but are still "published"
    const endedEvents = await db.collection('events')
      .where('isPublished', '==', true)
      .where('status', '==', 'published')
      .where('endDate', '<', admin.firestore.Timestamp.fromDate(now))
      .limit(100)
      .get();

    if (!endedEvents.empty) {
      console.log(`Updating ${endedEvents.size} ended events`);

      const batch = db.batch();
      endedEvents.forEach(doc => {
        batch.update(doc.ref, {
          status: 'completed',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });

      await batch.commit();
    }

    // Find published events that are currently ongoing
    const ongoingEvents = await db.collection('events')
      .where('isPublished', '==', true)
      .where('status', '==', 'published')
      .where('startDate', '<=', admin.firestore.Timestamp.fromDate(now))
      .where('endDate', '>=', admin.firestore.Timestamp.fromDate(now))
      .limit(100)
      .get();

    if (!ongoingEvents.empty) {
      console.log(`Updating ${ongoingEvents.size} ongoing events`);

      const batch = db.batch();
      ongoingEvents.forEach(doc => {
        batch.update(doc.ref, {
          status: 'ongoing',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });

      await batch.commit();
    }

    console.log('Event status update job completed');

  } catch (error) {
    console.error('Error in event status update:', error);
    throw error;
  }
});

/**
 * Scheduled: generateDailyStats
 * Runs daily at midnight to generate daily statistics
 */
export const generateDailyStats = onSchedule({
  schedule: '0 0 * * *', // Every day at midnight
  timeZone: 'Indian/Maldives',
  region: 'us-central1',
}, async () => {
  console.log('Running daily stats generation job...');

  const now = new Date();
  const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD

  try {
    // Count active rovers
    const activeRovers = await db.collection('rovers')
      .where('isActive', '==', true)
      .where('isApproved', '==', true)
      .count()
      .get();

    // Count events this month
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    const eventsThisMonth = await db.collection('events')
      .where('startDate', '>=', admin.firestore.Timestamp.fromDate(monthStart))
      .where('startDate', '<=', admin.firestore.Timestamp.fromDate(monthEnd))
      .count()
      .get();

    // Count meetings this month
    const meetingsThisMonth = await db.collection('meetings')
      .where('date', '>=', admin.firestore.Timestamp.fromDate(monthStart))
      .where('date', '<=', admin.firestore.Timestamp.fromDate(monthEnd))
      .count()
      .get();

    // Save daily stats
    await db.collection('daily_stats').doc(dateStr).set({
      date: dateStr,
      activeRovers: activeRovers.data().count,
      eventsThisMonth: eventsThisMonth.data().count,
      meetingsThisMonth: meetingsThisMonth.data().count,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log('Daily stats generation completed');

  } catch (error) {
    console.error('Error in daily stats generation:', error);
    throw error;
  }
});

/**
 * Scheduled: updateDashboardAggregates
 * Runs every 15 minutes to update dashboard aggregate counts.
 *
 * Cost Optimization:
 * - Aggregates all collection counts into a single document
 * - Dashboard reads 1 doc instead of scanning multiple collections
 */
export const updateDashboardAggregates = onSchedule({
  schedule: '*/15 * * * *', // Every 15 minutes
  timeZone: 'Indian/Maldives',
  region: 'us-central1',
}, async () => {
  console.log('Running dashboard aggregates update...');

  try {
    // Run all count queries in parallel
    const [
      totalRovers,
      activeRovers,
      pendingApprovals,
      totalEvents,
      upcomingEvents,
      totalMeetings,
      totalCourses,
      activeCourses,
      totalBlogs,
      publishedBlogs,
    ] = await Promise.all([
      db.collection('rovers').count().get(),
      db.collection('rovers')
        .where('isActive', '==', true)
        .where('isApproved', '==', true)
        .count().get(),
      db.collection('rovers')
        .where('isApproved', '==', false)
        .count().get(),
      db.collection('events')
        .where('isDeleted', '==', false)
        .count().get(),
      db.collection('events')
        .where('isDeleted', '==', false)
        .where('isPublished', '==', true)
        .where('startDate', '>=', admin.firestore.Timestamp.now())
        .count().get(),
      db.collection('meetings')
        .where('isDeleted', '==', false)
        .count().get(),
      db.collection('courses')
        .where('isDeleted', '==', false)
        .count().get(),
      db.collection('courses')
        .where('isDeleted', '==', false)
        .where('isPublished', '==', true)
        .count().get(),
      db.collection('blogs')
        .where('isDeleted', '==', false)
        .count().get(),
      db.collection('blogs')
        .where('isDeleted', '==', false)
        .where('status', '==', 'published')
        .count().get(),
    ]);

    // Count rovers by island
    const roversSnapshot = await db.collection('rovers')
      .where('isActive', '==', true)
      .where('isApproved', '==', true)
      .select('island')
      .get();

    const byIsland: Record<string, number> = {};
    roversSnapshot.docs.forEach(doc => {
      const island = doc.data().island || 'Unknown';
      byIsland[island] = (byIsland[island] || 0) + 1;
    });

    // Save dashboard aggregates
    await db.collection('aggregates').doc('dashboard').set({
      rovers: {
        total: totalRovers.data().count,
        active: activeRovers.data().count,
        pendingApproval: pendingApprovals.data().count,
        byIsland,
      },
      events: {
        total: totalEvents.data().count,
        upcoming: upcomingEvents.data().count,
      },
      meetings: {
        total: totalMeetings.data().count,
      },
      courses: {
        total: totalCourses.data().count,
        active: activeCourses.data().count,
      },
      blogs: {
        total: totalBlogs.data().count,
        published: publishedBlogs.data().count,
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log('Dashboard aggregates updated successfully');

  } catch (error) {
    console.error('Error updating dashboard aggregates:', error);
    throw error;
  }
});
