export function presenceStatus(lastSeen, now = new Date(), thresholds = {}) {
  const onlineSeconds = Number(thresholds.onlineSeconds ?? 120);
  const recentSeconds = Number(thresholds.recentSeconds ?? 900);
  const inactiveSeconds = Number(thresholds.inactiveSeconds ?? 86400);

  const seen = lastSeen instanceof Date ? lastSeen : new Date(lastSeen);
  const current = now instanceof Date ? now : new Date(now);

  if (Number.isNaN(seen.getTime()) || Number.isNaN(current.getTime())) return "inactive";

  const ageSeconds = Math.max(0, (current.getTime() - seen.getTime()) / 1000);
  if (ageSeconds <= onlineSeconds) return "online";
  if (ageSeconds <= recentSeconds) return "recent";
  if (ageSeconds <= inactiveSeconds) return "offline";
  return "inactive";
}

export const STATUS_COLORS = Object.freeze({
  online: "#54d878",
  recent: "#ffc64d",
  offline: "#ff6666",
  inactive: "#8a96a6"
});
