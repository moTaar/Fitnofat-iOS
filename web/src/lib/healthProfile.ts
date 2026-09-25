import type { HealthProfile, UserProfile } from "./types";

export type ProfileGap = "body stats" | "medical background";

/**
 * What the medical desk still needs before its reasoning is more than a guess.
 * Mirrors `profileGaps` in `server/src/health/reasoning.ts`, which raises the
 * "Complete your health profile" issue — keep the two rules identical, or the
 * page tells the user they're done while the review keeps asking.
 *
 * Any answered background question counts: someone healthy has no conditions to
 * list, and demanding one would leave the item open forever.
 */
export function profileGaps(
  profile: Pick<UserProfile, "bodyweightKg" | "heightCm" | "age"> | null,
  health: HealthProfile | null
): ProfileGap[] {
  const missing: ProfileGap[] = [];
  if (!profile?.bodyweightKg || !profile.heightCm || !profile.age) missing.push("body stats");
  const answered =
    !!health &&
    (health.conditions.length > 0 || health.allergies.length > 0 ||
      health.medications.length > 0 || health.surgeries.length > 0 ||
      health.familyHistory.length > 0 || !!health.smoking || !!health.alcohol ||
      !!health.notes?.trim());
  if (!answered) missing.push("medical background");
  return missing;
}

/** The issue key both the local and the AI review use for this reminder. */
export const PROFILE_ISSUE_KEY = "complete-health-profile";
