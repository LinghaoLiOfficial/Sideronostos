import type { Locale } from "@/lib/i18n/locale";

export function removeTrailingChineseFullStop(text: string) {
  return text.replace(/。+(\s*)$/u, "$1");
}

const invitationStatusLabels: Partial<Record<string, Record<Locale, string>>> = {
  pending: { "zh-CN": "待处理", en: "Pending" },
  accepted: { "zh-CN": "已接受", en: "Accepted" },
  declined: { "zh-CN": "已拒绝", en: "Declined" },
  expired: { "zh-CN": "已过期", en: "Expired" },
  revoked: { "zh-CN": "已撤销", en: "Revoked" },
};

export function getInvitationStatusLabel(status: string, locale: Locale = "zh-CN") {
  return invitationStatusLabels[status]?.[locale] ?? (locale === "en" ? "Unknown status" : "状态未知");
}

export function shouldLoadInvitationDetails(type: string) {
  return type === "group_invite";
}

export function getNotificationRowBackground(unread: boolean, selected: boolean, highlighted: boolean) {
  if (highlighted) return selected ? "#3c5640" : "#304331";
  if (selected) return "#334a37";
  return unread ? "#243426" : "transparent";
}
