import { db, collection, query, where, orderBy, limit, getDocs, writeBatch, Timestamp, doc, getDoc, setDoc } from './firebase-init.js';

const CLEANUP_INTERVAL = 24 * 60 * 60 * 1000; // 24시간
const BATCH_SIZE = 100;

export async function runCleanupIfNeeded(retentionDays = 30) {
  try {
    // Firestore 기반 협조: 모든 클라이언트가 공유하는 마지막 정리 시각
    const metaRef = doc(db, 'metadata', 'cleanup_last');
    const metaSnap = await getDoc(metaRef);
    const lastRun = metaSnap.exists() ? metaSnap.data().timestamp?.toMillis() || 0 : 0;

    if (Date.now() - lastRun < CLEANUP_INTERVAL) return;

    // 타임스탬프 먼저 기록하여 다른 클라이언트 중복 실행 방지
    await setDoc(metaRef, { timestamp: Timestamp.now() });

    const cutoff = Timestamp.fromDate(new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000));
    let totalDeleted = 0;

    while (true) {
      const q = query(
        collection(db, 'temperatures'),
        where('recorded_at', '<', cutoff),
        orderBy('recorded_at', 'asc'),
        limit(BATCH_SIZE)
      );

      const snapshot = await getDocs(q);
      if (snapshot.empty) break;

      const batch = writeBatch(db);
      snapshot.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
      totalDeleted += snapshot.size;

      if (snapshot.size < BATCH_SIZE) break;
    }

    if (totalDeleted > 0) {
      console.log(`[Cleanup] Deleted ${totalDeleted} documents older than ${retentionDays} days.`);
    }
  } catch (err) {
    console.warn('[Cleanup] Error during cleanup:', err);
  }
}
