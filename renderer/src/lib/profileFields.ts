/*
  A student's gender, age range and ethnicity (creatorhive-app
  docs/affiliate-job-board-v2.md §4): the same options as an affiliate
  campaign's "Creator wanted". Asked in the welcome step, editable in
  Settings → Account → Profile, only when GET /api/profile says
  `askProfileFields` (Academy, Weekend Starter, Challenger students).
*/

export type Gender = "female" | "male" | "unspecified";
/** Students asked for the three fields (`askProfileFields`): Female or Male. */
export const GENDERS: { value: Gender; label: string }[] = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
];
/** Everyone else keeps the choice they had. */
export const GENDERS_WITH_UNSPECIFIED: { value: Gender; label: string }[] = [...GENDERS, { value: "unspecified", label: "Prefer not to say" }];

export const AGE_RANGES = ["18-24", "25-34", "35-44", "45-54", "55+"] as const;
/** "25–34": stored with a hyphen, shown with an en dash. */
export const ageLabel = (range: string) => range.replace("-", "–");

export const ETHNICITIES = ["White", "Black", "Hispanic", "East Asian", "South Asian", "Middle Eastern"] as const;

/** One or more ethnicities, toggled. */
export function toggleEthnicity(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}
