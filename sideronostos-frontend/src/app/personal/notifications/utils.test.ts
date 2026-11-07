import { describe, expect, it } from "vitest";
import { getInvitationStatusLabel, getNotificationRowBackground, removeTrailingChineseFullStop, shouldLoadInvitationDetails } from "./utils";

describe("removeTrailingChineseFullStop", () => {
  it("removes Chinese full stops only at the end of a notification message", () => {
    expect(removeTrailingChineseFullStop("邀请你加入群组。 ")).toBe("邀请你加入群组 ");
    expect(removeTrailingChineseFullStop("邀请你加入群组。。")).toBe("邀请你加入群组");
    expect(removeTrailingChineseFullStop("请查看消息。邀请你加入群组。")).toBe("请查看消息。邀请你加入群组");
    expect(removeTrailingChineseFullStop("邀请你加入群组.")).toBe("邀请你加入群组.");
  });
});

describe("getInvitationStatusLabel", () => {
  it.each([
    ["pending", "待处理"],
    ["accepted", "已接受"],
    ["declined", "已拒绝"],
    ["expired", "已过期"],
    ["revoked", "已撤销"],
    ["unexpected", "状态未知"],
  ])("translates %s to %s", (status, label) => {
    expect(getInvitationStatusLabel(status)).toBe(label);
  });
});

describe("shouldLoadInvitationDetails", () => {
  it("loads the invitee-only endpoint only for actionable invitation notifications", () => {
    expect(shouldLoadInvitationDetails("group_invite")).toBe(true);
    expect(shouldLoadInvitationDetails("group_joined")).toBe(false);
    expect(shouldLoadInvitationDetails("group_role_changed")).toBe(false);
  });
});

describe("getNotificationRowBackground", () => {
  it("uses explicit colors and lets highlights override unread and selected states", () => {
    expect(getNotificationRowBackground(false, false, false)).toBe("transparent");
    expect(getNotificationRowBackground(true, false, false)).toBe("#40235a");
    expect(getNotificationRowBackground(false, true, false)).toBe("#5c2b52");
    expect(getNotificationRowBackground(true, false, true)).toBe("#512746");
    expect(getNotificationRowBackground(true, true, true)).toBe("#69315e");
  });
});
