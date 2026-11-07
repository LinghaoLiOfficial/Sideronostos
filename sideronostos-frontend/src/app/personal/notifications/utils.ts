export function removeTrailingChineseFullStop(text: string) {
  return text.replace(/。+(\s*)$/u, "$1");
}

const invitationStatusLabels: Record<string, string> = {
  pending: "待处理",
  accepted: "已接受",
  declined: "已拒绝",
  expired: "已过期",
  revoked: "已撤销",
};

export function getInvitationStatusLabel(status: string) {
  return invitationStatusLabels[status] ?? "状态未知";
}

export function shouldLoadInvitationDetails(type: string) {
  return type === "group_invite";
}

export function getNotificationRowBackground(unread: boolean, selected: boolean, highlighted: boolean) {
  if (highlighted) return selected ? "#69315e" : "#512746";
  if (selected) return "#5c2b52";
  return unread ? "#40235a" : "transparent";
}
