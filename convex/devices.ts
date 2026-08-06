import { query } from "./_generated/server";
import { authComponent } from "./auth";

export const getMyCliDevices = query({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) return [];

    const now = Date.now();
    const sessions = await ctx.db
      .query("gxCliSessions")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .collect();

    const activeDevices = sessions
      .filter((session) => cliDeviceStatus(session, now) === "active")
      .map((session) => ({
        id: session._id,
        machineId: session.machineId,
        machineName: session.machineName,
        gxVersion: session.gxVersion ?? null,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt ?? null,
        lastUsedAt: session.lastUsedAt ?? null,
        revokedAt: session.revokedAt ?? null,
        status: cliDeviceStatus(session, now),
      }))
      .sort((a, b) => {
        const aTime = a.lastUsedAt ?? a.createdAt;
        const bTime = b.lastUsedAt ?? b.createdAt;
        return bTime - aTime;
      });

    const seenMachineIds = new Set<string>();
    return activeDevices.filter((device) => {
      if (seenMachineIds.has(device.machineId)) return false;
      seenMachineIds.add(device.machineId);
      return true;
    });
  },
});

function cliDeviceStatus(
  session: { revokedAt?: number; expiresAt?: number },
  now: number,
) {
  if (session.revokedAt || !session.expiresAt || session.expiresAt <= now) {
    return "inactive" as const;
  }

  return "active" as const;
}
