import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';

const db = admin.firestore();

/**
 * Trigger: onActivityHistoryCreate
 * Fires when a new activity is added to a rover's history.
 *
 * Responsibilities:
 * - Update rover's activity statistics
 * - Update points/badges if applicable
 * - Trigger notifications for achievements
 */
export const onActivityHistoryCreate = onDocumentCreated({
  document: 'rovers/{roverId}/activities_history/{activityId}',
  region: 'us-central1',
}, async (event) => {
  const data = event.data?.data();
  const roverId = event.params.roverId;

  if (!data) {
    console.error('No data in activity document');
    return;
  }

  console.log(`New activity for rover ${roverId}: ${data.type}`);

  try {
    const roverRef = db.doc(`rovers/${roverId}`);
    const now = admin.firestore.FieldValue.serverTimestamp();

    // Base stats update
    const statsUpdate: Record<string, unknown> = {
      'stats.totalActivities': admin.firestore.FieldValue.increment(1),
      'stats.lastActivityDate': now,
      updatedAt: now,
    };

    // Activity-type specific updates
    switch (data.type) {
      case 'event_attended':
        statsUpdate['stats.eventsAttended'] = admin.firestore.FieldValue.increment(1);
        break;

      case 'meeting_attended':
        statsUpdate['stats.meetingsAttended'] = admin.firestore.FieldValue.increment(1);
        break;

      case 'course_completed':
        statsUpdate['stats.coursesCompleted'] = admin.firestore.FieldValue.increment(1);
        break;

      case 'class_completed':
        statsUpdate['stats.classesCompleted'] = admin.firestore.FieldValue.increment(1);
        break;

      case 'session_attended':
        statsUpdate['stats.sessionsAttended'] = admin.firestore.FieldValue.increment(1);
        break;

      case 'badge_earned':
        statsUpdate['stats.badgesEarned'] = admin.firestore.FieldValue.increment(1);
        await handleBadgeEarned(roverId, data);
        break;

      case 'points_earned':
        const points = data.metadata?.points || 0;
        if (points > 0) {
          statsUpdate['stats.totalPoints'] = admin.firestore.FieldValue.increment(points);
        }
        break;

      case 'service_hours':
        const hours = data.metadata?.hours || 0;
        if (hours > 0) {
          statsUpdate['stats.serviceHours'] = admin.firestore.FieldValue.increment(hours);
        }
        break;
    }

    await roverRef.update(statsUpdate);

    // Check for achievements/milestones
    await checkMilestones(roverId, data.type);

  } catch (error) {
    console.error('Error processing activity:', error);
    throw error;
  }
});

async function handleBadgeEarned(
  roverId: string,
  activityData: FirebaseFirestore.DocumentData
): Promise<void> {
  const badgeId = activityData.metadata?.badgeId;
  if (!badgeId) return;

  const roverDoc = await db.doc(`rovers/${roverId}`).get();
  const roverData = roverDoc.data();

  if (!roverData?.fcmToken) return;

  // Send push notification for badge
  try {
    await admin.messaging().send({
      token: roverData.fcmToken,
      notification: {
        title: 'Badge Earned!',
        body: `Congratulations! You earned the ${activityData.entityTitle} badge.`,
      },
      data: {
        type: 'badge_earned',
        badgeId: badgeId,
        activityId: activityData.entityId,
      },
    });
  } catch (error) {
    console.error('Failed to send badge notification:', error);
  }
}

async function checkMilestones(roverId: string, activityType: string): Promise<void> {
  const roverDoc = await db.doc(`rovers/${roverId}`).get();
  const roverData = roverDoc.data();

  if (!roverData?.stats) return;

  const stats = roverData.stats;
  const milestones: { key: string; thresholds: number[]; name: string }[] = [
    { key: 'eventsAttended', thresholds: [5, 10, 25, 50, 100], name: 'Events' },
    { key: 'meetingsAttended', thresholds: [10, 25, 50, 100, 200], name: 'Meetings' },
    { key: 'coursesCompleted', thresholds: [1, 5, 10, 25], name: 'Courses' },
    { key: 'serviceHours', thresholds: [10, 25, 50, 100, 250, 500], name: 'Service Hours' },
  ];

  for (const milestone of milestones) {
    const value = stats[milestone.key] || 0;

    for (const threshold of milestone.thresholds) {
      if (value === threshold) {
        // Check if milestone already awarded
        const existingMilestone = await db
          .collection(`rovers/${roverId}/milestones`)
          .where('type', '==', milestone.key)
          .where('threshold', '==', threshold)
          .limit(1)
          .get();

        if (existingMilestone.empty) {
          // Award milestone
          await db.collection(`rovers/${roverId}/milestones`).add({
            type: milestone.key,
            threshold: threshold,
            name: `${threshold} ${milestone.name}`,
            awardedAt: admin.firestore.FieldValue.serverTimestamp(),
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });

          // Notify rover
          if (roverData.fcmToken) {
            try {
              await admin.messaging().send({
                token: roverData.fcmToken,
                notification: {
                  title: 'Milestone Reached!',
                  body: `You've reached ${threshold} ${milestone.name}!`,
                },
                data: {
                  type: 'milestone_reached',
                  milestoneType: milestone.key,
                  threshold: String(threshold),
                },
              });
            } catch (error) {
              console.error('Failed to send milestone notification:', error);
            }
          }
        }
        break;
      }
    }
  }
}
